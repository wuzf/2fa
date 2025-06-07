#!/usr/bin/env node

/**
 * Service Worker 自动版本管理补丁脚本
 * 修改 serviceworker.js 以支持动态版本注入
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swPath = join(__dirname, '..', 'src', 'ui', 'serviceworker.js');

console.log('📝 正在修补 Service Worker...');

// 读取原始文件
let content = readFileSync(swPath, 'utf-8');

// 修补 1: 修改函数签名以接收 env 参数
content = content.replace(
  /export function createServiceWorker\(\) \{/,
  'export function createServiceWorker(env = {}) {'
);

// 修补 2: 在函数开头添加版本管理逻辑
const versionLogic = `  // 🚀 自动版本管理：从环境变量读取版本号
  // 支持多种版本策略：
  // 1. env.SW_VERSION - 构建时注入的版本号（推荐）
  // 2. env.BUILD_TIMESTAMP - 构建时间戳
  // 3. 'v1' - 默认版本（后备）
  const version = env.SW_VERSION || env.BUILD_TIMESTAMP || 'v1';

  // 生成缓存名称
  const CACHE_NAME = \`2fa-cache-\${version}\`;
  const RUNTIME_CACHE = \`2fa-runtime-\${version}\`;

`;

content = content.replace(
  /(export function createServiceWorker\(env = \{\}\) \{\s*)(const swScript = `)/,
  `$1${versionLogic}$2`
);

// 修补 3: 更新 Service Worker 内部的版本信息
content = content.replace(
  /const CACHE_NAME = '2fa-v1';/,
  "const CACHE_NAME = '${CACHE_NAME}';"
);

content = content.replace(
  /const RUNTIME_CACHE = '2fa-runtime-v1';/,
  "const RUNTIME_CACHE = '${RUNTIME_CACHE}';"
);

// 修补 4: 添加版本常量和日志
content = content.replace(
  /(const STORE_NAME = 'pending-operations';)/,
  `const SW_VERSION = '\${version}';\n$1\n\n// 版本信息（用于调试）\nconsole.log('[SW] Service Worker 版本:', SW_VERSION);\nconsole.log('[SW] 缓存名称:', CACHE_NAME);`
);

// 修补 5: 更新 JSDoc 注释
content = content.replace(
  / \* 版本: 1\.0\.0/,
  ` * 版本: \${version}\n * 生成时间: \${new Date().toISOString()}\n *\n * ⚡ 自动版本管理：\n * - 每次部署自动更新缓存版本\n * - 自动清理旧版本缓存\n * - 无需手动维护版本号`
);

// 写回文件
writeFileSync(swPath, content, 'utf-8');

console.log('✅ Service Worker 修补完成！');
console.log('   - 支持动态版本管理');
console.log('   - 自动清理旧缓存');
console.log('   - 版本号从环境变量注入');
