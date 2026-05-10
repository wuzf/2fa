#!/usr/bin/env node

/**
 * 自动化部署脚本
 *
 * 功能：
 * 1. 自动生成 Service Worker 版本号
 * 2. 注入版本到环境变量
 * 3. 执行 wrangler 部署
 *
 * 使用方式：
 *   node scripts/deploy.js                  # 使用时间戳版本
 *   node scripts/deploy.js --git            # 使用 git commit 版本
 *   node scripts/deploy.js --package        # 使用 package.json 版本
 *   node scripts/deploy.js --env production # 部署到生产环境
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { extractWorkerName, injectKvNamespaceId, injectWorkerVersion } from './deploy-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const versionStrategy = args.includes('--git') ? '--git' :
  args.includes('--package') ? '--package' :
    '';

const envIndex = args.indexOf('--env');
const envName = envIndex !== -1 && args[envIndex + 1] ? args[envIndex + 1] : null;
const envArg = envName ? `--env ${envName}` : '';

console.log('');
console.log('🚀 ========================================');
console.log('   2FA Manager 自动化部署');
console.log('========================================');
console.log('');

try {
  const version = generateVersion(versionStrategy);
  const wranglerPath = join(__dirname, '..', 'wrangler.toml');
  const originalConfig = readFileSync(wranglerPath, 'utf-8');

  console.log(`   ✅ 版本号: ${version}`);
  console.log('');

  console.log('📝 Step 2: 注入版本到配置...');

  let modifiedConfig = injectWorkerVersion(originalConfig, version);

  console.log(`   ✅ 已注入版本: ${version}`);
  console.log('');

  // Step 2.5: 自动检测并绑定已有 KV namespace，防止重复创建
  console.log('🔍 Step 2.5: 检测已有 KV namespace...');
  const workerName = extractWorkerName(modifiedConfig, envName);
  const existingKv = findExistingKvId(workerName, envName);
  if (existingKv) {
    modifiedConfig = injectKvNamespaceId(modifiedConfig, existingKv.id, envName);
    console.log(`   ✅ 复用已有 KV: ${existingKv.title} (${existingKv.id})`);
  } else {
    console.log('   ℹ️ 未检测到已有 KV，将由 Wrangler 自动创建');
  }
  console.log('');

  writeFileSync(wranglerPath, modifiedConfig, 'utf-8');

  console.log('🚀 Step 3: 部署到 Cloudflare Workers...');
  console.log(`   命令: npx wrangler deploy ${envArg}`.trim());
  console.log('');

  try {
    execSync(`npx wrangler deploy ${envArg}`.trim(), {
      stdio: 'inherit',
      encoding: 'utf-8',
    });

    console.log('');
    console.log('✅ ========================================');
    console.log('   部署成功！');
    console.log('========================================');
    console.log('');
    console.log(`📦 版本: ${version}`);
    console.log(`🌐 环境: ${envArg || '生产环境 (production)'}`);
    console.log('');
  } catch (deployError) {
    console.error('');
    console.error('❌ ========================================');
    console.error('   部署失败');
    console.error('========================================');
    console.error('');
    throw deployError;
  } finally {
    console.log('🔄 Step 4: 恢复配置文件...');
    writeFileSync(wranglerPath, originalConfig, 'utf-8');
    console.log('   ✅ 配置已恢复');
    console.log('');
  }
} catch (error) {
  console.error('');
  console.error('❌ 部署流程失败:');
  console.error('   ', error.message);
  console.error('');
  process.exit(1);
}

function generateVersion(versionStrategyArg) {
  console.log('📦 Step 1: 生成 Service Worker 版本号...');
  const versionCmd = `node ${join(__dirname, 'generate-version.js')} ${versionStrategyArg} --verbose`;
  return execSync(versionCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
}

function findExistingKvId(workerName, envName = null) {
  if (!workerName) return null;

  let namespaces;
  try {
    const output = execSync('npx wrangler kv namespace list', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    namespaces = JSON.parse(output);
  } catch {
    return null;
  }
  if (!namespaces.length) return null;

  // 短名映射：开发环境常缩写为 dev / prod
  const ENV_ALIASES = { development: 'dev', production: 'prod' };
  const envAlias = envName ? (ENV_ALIASES[envName] || envName) : null;

  // 推断 base 名（去除可能的 env 后缀）：worker "2fa-dev" + envAlias "dev" → base "2fa"
  const stripSuffix = (name, suffix) =>
    suffix && name.endsWith(`-${suffix}`) ? name.slice(0, -(suffix.length + 1)) : name;
  const baseName = envAlias ? stripSuffix(workerName, envAlias) : workerName;

  // 候选 title 列表，越靠前越优先
  const candidates = [];
  if (envName) {
    candidates.push(
      `${workerName}-secrets-kv`,                // 2fa-dev-secrets-kv
      `${workerName}-SECRETS_KV`,
      `${baseName}-secrets-kv-${envAlias}`,      // 2fa-secrets-kv-dev  ← 当前命名
      `${baseName}-secrets-kv-${envName}`,       // 2fa-secrets-kv-development
      `${envAlias}-${baseName}-SECRETS_KV`,
      `${envName}-${baseName}-SECRETS_KV`,
      `${envName}-SECRETS_KV`,                   // development-SECRETS_KV（旧命名）
    );
  } else {
    candidates.push(
      `${workerName}-secrets-kv`,                // 2fa-secrets-kv  ← 当前命名
      `${workerName}-SECRETS_KV`,
      'SECRETS_KV',
      workerName,
    );
  }

  for (const title of candidates) {
    const match = namespaces.find(ns => ns.title === title);
    if (match) return { id: match.id, title: match.title };
  }

  // env 部署只走精确匹配，避免误把生产 KV 命中给 dev
  if (envName) return null;

  // 顶层部署的 fuzzy 兜底（保持原有兼容性）
  const fuzzy =
    namespaces.find(ns => ns.title.includes('SECRETS_KV')) ||
    namespaces.find(ns => ns.title.includes('secrets-kv')) ||
    (namespaces.length === 1 ? namespaces[0] : null);

  return fuzzy ? { id: fuzzy.id, title: fuzzy.title } : null;
}
