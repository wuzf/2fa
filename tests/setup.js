/**
 * Vitest 测试环境设置
 * 为 Node.js 环境提供 Web Crypto API polyfill
 */

import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// 将 Node.js 的 webcrypto 挂载到全局对象
// 在 Node.js 19+ 中，crypto 已经可用，但我们需要确保它正确配置
// 注意：globalThis.crypto 在某些 Node.js 版本中是只读的，需要使用 defineProperty
try {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      writable: true,
      configurable: true
    });
  }
} catch (error) {
  // 如果已经有 crypto 对象且不可配置，则忽略
  console.warn('Warning: crypto object already exists and is not configurable');
}

// 添加 btoa 和 atob（Base64 编码/解码）
// 这些函数在浏览器和 Workers 中可用，但在 Node.js 中需要 polyfill
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => {
    return Buffer.from(str, 'binary').toString('base64');
  };
}

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (str) => {
    return Buffer.from(str, 'base64').toString('binary');
  };
}

// 添加 TextEncoder 和 TextDecoder（如果不存在）
// Node.js 18+ 已经提供这些，但为了兼容性还是确保全局可用
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// 添加 performance.now()（如果不存在）
// Node.js 16+ 已经有 performance，但确保可用
if (typeof globalThis.performance === 'undefined' || typeof globalThis.performance.now === 'undefined') {
  globalThis.performance = globalThis.performance || {};
  globalThis.performance.now = () => {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1000 + nanoseconds / 1000000;
  };
}

console.log('✅ Vitest setup complete - Web Crypto API ready');

