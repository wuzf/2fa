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
 *   node scripts/deploy.js --env development # 部署到 wrangler.toml 中的 [env.development] 环境
 *   不带 --env 时部署顶层配置，即生产环境；也可以用 CLOUDFLARE_ENV 选择环境，--env 优先
 *
 * wrangler.toml 全程只读：注入版本和补全 KV id 后的配置写入项目根目录的临时文件
 * （wrangler.deploy.<pid>.tmp.toml，已被 .gitignore 忽略），通过 --config 交给 Wrangler，结束后删除。
 * 临时文件与 wrangler.toml 同目录，main、assets 等相对路径的基准不变。部署中途按 Ctrl+C 或进程被杀时，
 * 最多残留这个被忽略的临时文件，wrangler.toml 不会停在改过的状态。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { injectWorkerVersion } from './deploy-config.js';
import { applyKvBinding, parseDeploymentArgs, readWorkerNameOverride, resolveKvBinding } from './deploy-namespace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const { versionStrategy, envName: explicitEnvName } = parseDeploymentArgs(args);
// Match Wrangler's environment selection before resolving any storage binding.
const envName = explicitEnvName || process.env.CLOUDFLARE_ENV || null;
const envArg = envName ? `--env ${envName}` : '';
const wranglerCli = fileURLToPath(import.meta.resolve('wrangler'));

console.log('');
console.log('🚀 ========================================');
console.log('   2FA Manager 自动化部署');
console.log('========================================');
console.log('');

try {
	const version = generateVersion(versionStrategy);
	const projectRoot = join(__dirname, '..');
	const wranglerPath = join(projectRoot, 'wrangler.toml');
	// 每个进程独立的文件名，避免同时部署两个环境时互相覆盖
	const deployConfigPath = join(projectRoot, `wrangler.deploy.${process.pid}.tmp.toml`);
	const originalConfig = readFileSync(wranglerPath, 'utf-8');

	console.log(`   ✅ 版本号: ${version}`);
	console.log('');

	console.log('📝 Step 2: 注入版本到配置...');

	let modifiedConfig = injectWorkerVersion(originalConfig, version);

	console.log(`   ✅ 已注入版本: ${version}`);
	console.log('');

	// Step 2.5: 自动检测并绑定已有 KV namespace，防止重复创建
	console.log('🔍 Step 2.5: 检测已有 KV namespace...');
	// Cloudflare Workers Builds 部署到所连接的 Worker，其名称可能与配置文件中的 name 不同
	const workerNameOverride = readWorkerNameOverride();
	if (workerNameOverride !== undefined) {
		console.log(`   ℹ️ 按 Cloudflare 提供的实际 Worker 名称查找: ${workerNameOverride}`);
	}
	const binding = await resolveKvBinding(
		modifiedConfig,
		envName,
		() =>
			JSON.parse(
				execFileSync(
					process.execPath,
					[wranglerCli, 'kv', 'namespace', 'list', '--config', wranglerPath, ...(envName ? ['--env', envName] : [])],
					{ encoding: 'utf-8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] },
				),
			),
		{ workerNameOverride },
	);
	if (binding.kind === 'configured') {
		console.log('   ✅ 保留配置中明确指定的 SECRETS_KV');
	} else if (binding.kind === 'existing') {
		modifiedConfig = applyKvBinding(modifiedConfig, envName, binding);
		console.log(`   ✅ 复用唯一匹配的 KV: ${binding.title}`);
	} else {
		console.log('   ℹ️ 未找到当前 Worker 的明确匹配 KV，将由 Wrangler 按绑定创建');
	}
	console.log('');

	console.log('🚀 Step 3: 部署到 Cloudflare Workers...');
	console.log(`   命令: npx wrangler deploy --config ${basename(deployConfigPath)} ${envArg}`.trim());
	console.log('   （wrangler.toml 保持不变，修改后的配置只写入上述临时文件）');
	console.log('');

	try {
		// 写入放在 try 内：写入失败留下的半截文件同样会在 finally 中删除
		writeFileSync(deployConfigPath, modifiedConfig, 'utf-8');
		execFileSync(process.execPath, [wranglerCli, 'deploy', '--config', deployConfigPath, ...(envName ? ['--env', envName] : [])], {
			stdio: 'inherit',
			encoding: 'utf-8',
			cwd: projectRoot,
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
		console.log('🧹 Step 4: 删除临时部署配置...');
		rmSync(deployConfigPath, { force: true });
		console.log('   ✅ 已删除，wrangler.toml 未被修改');
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
	return execFileSync(
		process.execPath,
		[join(__dirname, 'generate-version.js'), ...(versionStrategyArg ? [versionStrategyArg] : []), '--verbose'],
		{ encoding: 'utf-8', cwd: join(__dirname, '..') },
	)
		.trim()
		.split('\n')[0];
}
