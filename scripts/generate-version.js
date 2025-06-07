#!/usr/bin/env node

/**
 * 自动版本生成脚本
 * 用于 Service Worker 缓存版本管理
 *
 * 支持多种版本策略：
 * 1. 时间戳（默认）：格式 v20250102-123456
 * 2. Git Commit：格式 v<short-hash>
 * 3. Package版本：格式 v1.0.0
 *
 * 使用方式：
 * - node scripts/generate-version.js            # 时间戳版本
 * - node scripts/generate-version.js --git      # Git commit版本
 * - node scripts/generate-version.js --package  # Package.json版本
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
const strategy = args.includes('--git') ? 'git' :
                 args.includes('--package') ? 'package' :
                 'timestamp';

/**
 * 生成时间戳版本
 * @returns {string} 格式: v20250102-123456
 */
function generateTimestampVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `v${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * 生成 Git commit 版本
 * @returns {string} 格式: v<short-hash> 或 v<short-hash>-dirty
 */
function generateGitVersion() {
  try {
    // 获取短 commit hash
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

    // 检查是否有未提交的更改
    const isDirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim().length > 0;

    return `v${hash}${isDirty ? '-dirty' : ''}`;
  } catch (error) {
    console.error('❌ Git 版本生成失败，回退到时间戳版本');
    console.error('   原因:', error.message);
    return generateTimestampVersion();
  }
}

/**
 * 从 package.json 读取版本
 * @returns {string} 格式: v1.0.0
 */
function generatePackageVersion() {
  try {
    const packagePath = join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return `v${packageJson.version}`;
  } catch (error) {
    console.error('❌ Package 版本读取失败，回退到时间戳版本');
    console.error('   原因:', error.message);
    return generateTimestampVersion();
  }
}

/**
 * 生成版本号
 * @param {string} strategy - 版本策略
 * @returns {string} 版本号
 */
function generateVersion(strategy) {
  switch (strategy) {
    case 'git':
      return generateGitVersion();
    case 'package':
      return generatePackageVersion();
    case 'timestamp':
    default:
      return generateTimestampVersion();
  }
}

// 主逻辑
function main() {
  const version = generateVersion(strategy);

  // 输出版本信息（用于 wrangler 读取）
  console.log(version);

  // 如果有 --verbose 参数，输出详细信息
  if (args.includes('--verbose')) {
    console.error(`\n📦 版本信息:`);
    console.error(`   策略: ${strategy}`);
    console.error(`   版本: ${version}`);
    console.error(`   时间: ${new Date().toISOString()}\n`);
  }

  return version;
}

// 执行
main();
