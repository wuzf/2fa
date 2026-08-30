/**
 * Rate Limiting 功能测试
 * 测试固定窗口计数器算法、客户端识别、响应生成
 */

import { describe, it, expect, vi } from 'vitest';
import {
  checkRateLimit,
  resetRateLimit,
  getRateLimitInfo,
  createRateLimitResponse,
  getClientIdentifier,
  RATE_LIMIT_PRESETS,
  withRateLimit
} from '../../src/utils/rateLimit.js';

describe('Rate Limiting Utils', () => {

  // 模拟 KV 存储
  class MockKV {
    constructor() {
      this.store = new Map();
    }

    async get(key, type = 'text') {
      const value = this.store.get(key);
      if (!value) {
        return null;
      }

      if (type === 'json') {
        return JSON.parse(value);
      }
      return value;
    }

    async put(key, value, options = {}) {
      this.store.set(key, value);

      // 模拟 TTL 过期
      if (options.expirationTtl) {
        setTimeout(() => {
          this.store.delete(key);
        }, options.expirationTtl * 1000);
      }
    }

    async delete(key) {
      this.store.delete(key);
    }

    clear() {
      this.store.clear();
    }
  }

  // 模拟环境
  function createMockEnv() {
    return {
      SECRETS_KV: new MockKV(),
      LOG_LEVEL: 'ERROR'
    };
  }

  // 创建模拟请求
  function createMockRequest(headers = {}) {
    return {
      headers: new Headers(headers)
    };
  }

  describe('checkRateLimit', () => {
    it('首次请求应该允许', async () => {
      const env = createMockEnv();
      const result = await checkRateLimit('test-client', env, {
        maxAttempts: 5,
        windowSeconds: 60
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
      expect(result.limit).toBe(5);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('应该正确计数多次请求', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 5, windowSeconds: 60 };

      // 第 1 次请求
      let result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      // 第 2 次请求
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);

      // 第 3 次请求
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('超过限制后应该拒绝请求', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 3, windowSeconds: 60 };

      // 发送 3 次请求（达到限制）
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);

      // 第 4 次请求应该被拒绝
      const result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('窗口过期后应该重置计数', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 3, windowSeconds: 1 }; // 1 秒窗口

      // 第 1 次请求
      const result1 = await checkRateLimit(key, env, config);
      expect(result1.remaining).toBe(2);

      // 等待窗口过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 新窗口第 1 次请求
      const result2 = await checkRateLimit(key, env, config);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(2); // 重置为 3 - 1 = 2
    });

    it('不同客户端应该独立计数', async () => {
      const env = createMockEnv();
      const config = { maxAttempts: 3, windowSeconds: 60 };

      // 客户端 A
      await checkRateLimit('client-a', env, config);
      await checkRateLimit('client-a', env, config);
      await checkRateLimit('client-a', env, config);

      // 客户端 A 达到限制
      const resultA = await checkRateLimit('client-a', env, config);
      expect(resultA.allowed).toBe(false);

      // 客户端 B 应该仍然可以请求
      const resultB = await checkRateLimit('client-b', env, config);
      expect(resultB.allowed).toBe(true);
      expect(resultB.remaining).toBe(2);
    });

    it('应该使用默认配置', async () => {
      const env = createMockEnv();

      const result = await checkRateLimit('test-client', env);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5); // 默认 maxAttempts
      expect(result.remaining).toBe(4);
    });

    it('KV 错误时应该 fail open（允许请求）', async () => {
      const env = {
        SECRETS_KV: {
          get: vi.fn().mockRejectedValue(new Error('KV error')),
          put: vi.fn()
        },
        LOG_LEVEL: 'ERROR'
      };

      const result = await checkRateLimit('test-client', env);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it('resetAt 时间应该正确计算', async () => {
      const env = createMockEnv();
      const windowSeconds = 120; // 2 分钟
      const before = Date.now();

      const result = await checkRateLimit('test-client', env, {
        maxAttempts: 5,
        windowSeconds
      });

      const after = Date.now();

      // resetAt 应该在 now + windowSeconds 范围内
      expect(result.resetAt).toBeGreaterThanOrEqual(before + windowSeconds * 1000);
      expect(result.resetAt).toBeLessThanOrEqual(after + windowSeconds * 1000);
    });

    it('达到限制时 remaining 应该为 0', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 2, windowSeconds: 60 };

      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);

      const result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(2);
    });
  });

  describe('resetRateLimit', () => {
    it('应该清除限流数据', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 2, windowSeconds: 60 };

      // 发送 2 次请求（达到限制）
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);

      // 验证已达到限制
      let result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(false);

      // 重置限流
      await resetRateLimit(key, env);

      // 重置后应该可以再次请求
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 2 - 1
    });

    it('重置不存在的键不应报错', async () => {
      const env = createMockEnv();

      await expect(
        resetRateLimit('non-existent-key', env)
      ).resolves.not.toThrow();
    });

    it('KV 错误时不应抛出异常', async () => {
      const env = {
        SECRETS_KV: {
          delete: vi.fn().mockRejectedValue(new Error('KV error'))
        },
        LOG_LEVEL: 'ERROR'
      };

      await expect(
        resetRateLimit('test-client', env)
      ).resolves.not.toThrow();
    });
  });

  describe('getRateLimitInfo', () => {
    it('未使用时应该返回完整限额', async () => {
      const env = createMockEnv();

      const info = await getRateLimitInfo('test-client', env, 10);

      expect(info.count).toBe(0);
      expect(info.remaining).toBe(10);
      expect(info.limit).toBe(10);
    });

    it('应该返回当前使用情况（不增加计数）', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 5, windowSeconds: 60 };

      // 发送 2 次请求
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);

      // 获取信息（不应增加计数）
      const info = await getRateLimitInfo(key, env, 5);

      expect(info.count).toBe(2);
      expect(info.remaining).toBe(3);
      expect(info.limit).toBe(5);

      // 再次获取信息，计数应该不变
      const info2 = await getRateLimitInfo(key, env, 5);
      expect(info2.count).toBe(2);
    });

    it('窗口过期后应该返回重置状态', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 5, windowSeconds: 1, algorithm: 'fixed-window' };

      // 发送请求
      await checkRateLimit(key, env, config);

      // 等待窗口过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 获取信息
      const info = await getRateLimitInfo(key, env, { maxAttempts: 5, algorithm: 'fixed-window' });
      expect(info.count).toBe(0);
      expect(info.remaining).toBe(5);
    });

    it('KV 错误时应该返回默认值', async () => {
      const env = {
        SECRETS_KV: {
          get: vi.fn().mockRejectedValue(new Error('KV error'))
        },
        LOG_LEVEL: 'ERROR'
      };

      const info = await getRateLimitInfo('test-client', env, 10);

      expect(info.count).toBe(0);
      expect(info.remaining).toBe(10);
      expect(info.limit).toBe(10);
    });

    it('remaining 不应该小于 0', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 2, windowSeconds: 60 };

      // 达到限制
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config); // 被拒绝

      const info = await getRateLimitInfo(key, env, 2);
      expect(info.remaining).toBe(0);
      expect(info.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createRateLimitResponse', () => {
    it('应该创建 429 状态码响应', () => {
      const rateLimitInfo = {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60000,
        limit: 5
      };

      const response = createRateLimitResponse(rateLimitInfo);

      expect(response.status).toBe(429);
    });

    it('应该包含正确的响应头', () => {
      const resetAt = Date.now() + 60000;
      const rateLimitInfo = {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: 5
      };

      const response = createRateLimitResponse(rateLimitInfo);

      expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(response.headers.get('X-RateLimit-Reset')).toBe(resetAt.toString());
      expect(response.headers.get('Retry-After')).toBeDefined();
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('应该计算正确的 Retry-After 值', async () => {
      const resetAt = Date.now() + 45000; // 45 秒后
      const rateLimitInfo = {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: 5
      };

      const response = createRateLimitResponse(rateLimitInfo);
      const retryAfter = parseInt(response.headers.get('Retry-After'));

      expect(retryAfter).toBeGreaterThanOrEqual(44);
      expect(retryAfter).toBeLessThanOrEqual(46);
    });

    it('响应体应该包含错误信息', async () => {
      const rateLimitInfo = {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60000,
        limit: 5
      };

      const response = createRateLimitResponse(rateLimitInfo);
      const body = await response.json();

      expect(body.error).toBe('请求过于频繁');
      expect(body.message).toContain('秒后重试');
      expect(body.retryAfter).toBeDefined();
      expect(body.limit).toBe(5);
      expect(body.remaining).toBe(0);
      expect(body.resetAt).toBeDefined();
    });

    it('没有 request 参数时应该包含 CORS 头', () => {
      const rateLimitInfo = {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60000,
        limit: 5
      };

      const response = createRateLimitResponse(rateLimitInfo);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Headers')).toBeDefined();
    });
  });

  describe('getClientIdentifier', () => {
    it('应该从 CF-Connecting-IP 提取 IP', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const identifier = getClientIdentifier(request, 'ip');
      expect(identifier).toBe('203.0.113.1');
    });

    it('应该回退到 X-Real-IP', () => {
      const request = createMockRequest({
        'X-Real-IP': '198.51.100.1'
      });

      const identifier = getClientIdentifier(request, 'ip');
      expect(identifier).toBe('198.51.100.1');
    });

    it('应该回退到 X-Forwarded-For 的第一个 IP', () => {
      const request = createMockRequest({
        'X-Forwarded-For': '192.0.2.1, 198.51.100.1, 203.0.113.1'
      });

      const identifier = getClientIdentifier(request, 'ip');
      expect(identifier).toBe('192.0.2.1');
    });

    it('优先级: CF-Connecting-IP > X-Real-IP > X-Forwarded-For', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1',
        'X-Real-IP': '198.51.100.1',
        'X-Forwarded-For': '192.0.2.1'
      });

      const identifier = getClientIdentifier(request, 'ip');
      expect(identifier).toBe('203.0.113.1');
    });

    it('没有 IP 头时应该返回 unknown', () => {
      const request = createMockRequest({});

      const identifier = getClientIdentifier(request, 'ip');
      expect(identifier).toBe('unknown');
    });

    it('应该从 Authorization 头提取 token', () => {
      const request = createMockRequest({
        'Authorization': 'Bearer abcdef1234567890xyz'
      });

      const identifier = getClientIdentifier(request, 'token');
      expect(identifier).toBe('token:abcdef1234567890');
      expect(identifier).toHaveLength(22); // 'token:' + 16 字符
    });

    it('没有 token 时应该返回 no-token', () => {
      const request = createMockRequest({});

      const identifier = getClientIdentifier(request, 'token');
      expect(identifier).toBe('no-token');
    });

    it('应该组合 IP 和 token', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1',
        'Authorization': 'Bearer abcdef1234567890xyz'
      });

      const identifier = getClientIdentifier(request, 'combined');
      expect(identifier).toBe('203.0.113.1:abcdef1234567890');
    });

    it('combined 模式没有 token 时应该只返回 IP', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const identifier = getClientIdentifier(request, 'combined');
      expect(identifier).toBe('203.0.113.1');
    });

    it('默认应该使用 ip 模式', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const identifier = getClientIdentifier(request);
      expect(identifier).toBe('203.0.113.1');
    });

    it('无效的 type 应该回退到 ip 模式', () => {
      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const identifier = getClientIdentifier(request, 'invalid');
      expect(identifier).toBe('203.0.113.1');
    });
  });

  describe('RATE_LIMIT_PRESETS', () => {
    it('应该包含所有预设配置', () => {
      expect(RATE_LIMIT_PRESETS).toHaveProperty('login');
      expect(RATE_LIMIT_PRESETS).toHaveProperty('loginStrict');
      expect(RATE_LIMIT_PRESETS).toHaveProperty('api');
      expect(RATE_LIMIT_PRESETS).toHaveProperty('sensitive');
      expect(RATE_LIMIT_PRESETS).toHaveProperty('bulk');
      expect(RATE_LIMIT_PRESETS).toHaveProperty('global');
    });

    it('login 预设应该配置正确', () => {
      expect(RATE_LIMIT_PRESETS.login).toEqual({
        maxAttempts: 5,
        windowSeconds: 60,
        algorithm: 'sliding-window'
      });
    });

    it('loginStrict 应该比 login 更严格', () => {
      expect(RATE_LIMIT_PRESETS.loginStrict.maxAttempts)
        .toBeLessThan(RATE_LIMIT_PRESETS.login.maxAttempts);
    });

    it('api 预设应该比 login 更宽松', () => {
      expect(RATE_LIMIT_PRESETS.api.maxAttempts)
        .toBeGreaterThan(RATE_LIMIT_PRESETS.login.maxAttempts);
    });

    it('bulk 预设应该有更长的窗口', () => {
      expect(RATE_LIMIT_PRESETS.bulk.windowSeconds)
        .toBeGreaterThan(RATE_LIMIT_PRESETS.api.windowSeconds);
    });

    it('所有预设都应该有必要的配置', () => {
      Object.values(RATE_LIMIT_PRESETS).forEach(preset => {
        expect(preset).toHaveProperty('maxAttempts');
        expect(preset).toHaveProperty('windowSeconds');
        expect(preset).toHaveProperty('algorithm');
        expect(preset.maxAttempts).toBeGreaterThan(0);
        expect(preset.windowSeconds).toBeGreaterThan(0);
        expect(preset.algorithm).toBe('sliding-window');
      });
    });
  });

  describe('withRateLimit', () => {
    it('应该允许未超限的请求', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler, {
        preset: 'api'
      });

      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const response = await wrappedHandler(request, env);

      expect(response.status).toBe(200);
      expect(mockHandler).toHaveBeenCalled();
    });

    it('应该拒绝超限的请求', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler, {
        preset: 'login'
      });

      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      // 发送 5 次请求（达到限制）
      for (let i = 0; i < 5; i++) {
        await wrappedHandler(request, env);
      }

      // 第 6 次应该被拒绝
      const response = await wrappedHandler(request, env);

      expect(response.status).toBe(429);
      expect(mockHandler).toHaveBeenCalledTimes(5); // 只调用了 5 次
    });

    it('应该在响应中添加 rate limit headers', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler, {
        preset: 'api'
      });

      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const response = await wrappedHandler(request, env);

      expect(response.headers.get('X-RateLimit-Limit')).toBe('30');
      expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('应该支持自定义 key', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler, {
        preset: 'login',
        customKey: 'custom-identifier'
      });

      const request1 = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });
      const request2 = createMockRequest({
        'CF-Connecting-IP': '198.51.100.1'
      });

      // 使用相同的自定义 key，即使 IP 不同也会共享限制
      for (let i = 0; i < 5; i++) {
        await wrappedHandler(request1, env);
      }

      const response = await wrappedHandler(request2, env);
      expect(response.status).toBe(429); // 被拒绝，因为共享 key
    });

    it('应该支持自定义 key 函数', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler, {
        preset: 'login',
        customKey: (request) => request.headers.get('X-User-ID') || 'anonymous'
      });

      const request = createMockRequest({
        'X-User-ID': 'user-123'
      });

      const response = await wrappedHandler(request, env);
      expect(response.status).toBe(200);
    });

    it('应该使用默认预设 (api)', async () => {
      const env = createMockEnv();
      const mockHandler = vi.fn(async () =>
        new Response('OK', { status: 200 })
      );

      const wrappedHandler = withRateLimit(mockHandler);

      const request = createMockRequest({
        'CF-Connecting-IP': '203.0.113.1'
      });

      const response = await wrappedHandler(request, env);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('30'); // api 的限制
    });
  });

  describe('性能测试', () => {
    it('checkRateLimit 应该快速执行', async () => {
      const env = createMockEnv();

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(`client-${i}`, env);
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(1000); // 100 次检查应该在 1 秒内
    });

    it('应该处理并发请求', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 10, windowSeconds: 60 };

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(checkRateLimit(key, env, config));
      }

      const results = await Promise.all(promises);

      // 所有请求都应该被允许
      results.forEach(result => {
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('边界条件', () => {
    it('应该处理极长的 key', async () => {
      const env = createMockEnv();
      const longKey = 'a'.repeat(1000);

      const result = await checkRateLimit(longKey, env);
      expect(result.allowed).toBe(true);
    });

    it('应该处理特殊字符的 key', async () => {
      const env = createMockEnv();
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key@with@symbols',
        'key-中文-unicode',
        'key🔐emoji'
      ];

      for (const key of specialKeys) {
        const result = await checkRateLimit(key, env);
        expect(result.allowed).toBe(true);
      }
    });

    it('maxAttempts 为 1 应该立即限制', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 1, windowSeconds: 60 };

      const result1 = await checkRateLimit(key, env, config);
      expect(result1.allowed).toBe(true);

      const result2 = await checkRateLimit(key, env, config);
      expect(result2.allowed).toBe(false);
    });

    it('极短窗口应该正常工作', async () => {
      const env = createMockEnv();
      const key = 'test-client';
      const config = { maxAttempts: 2, windowSeconds: 1 };

      await checkRateLimit(key, env, config);
      await checkRateLimit(key, env, config);

      const result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(false);

      // 等待窗口过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result2 = await checkRateLimit(key, env, config);
      expect(result2.allowed).toBe(true);
    });

    it('极大的 maxAttempts 应该正常工作', async () => {
      const env = createMockEnv();
      const config = { maxAttempts: 10000, windowSeconds: 60 };

      const result = await checkRateLimit('test-client', env, config);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10000);
    });
  });

  describe('集成测试', () => {
    it('完整的限流场景', async () => {
      const env = createMockEnv();
      const key = 'integration-test';
      const config = { maxAttempts: 3, windowSeconds: 2 };

      // 场景 1: 正常请求
      let result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      // 场景 2: 继续请求
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);

      // 场景 3: 达到限制
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);

      // 场景 4: 被拒绝
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);

      // 场景 5: 获取信息不应增加计数
      const info = await getRateLimitInfo(key, env, 3);
      expect(info.count).toBe(3);

      // 场景 6: 重置
      await resetRateLimit(key, env);

      // 场景 7: 重置后可以再次请求
      result = await checkRateLimit(key, env, config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('多客户端并发场景', async () => {
      const env = createMockEnv();
      const config = { maxAttempts: 5, windowSeconds: 60 };

      // 10 个不同客户端同时请求
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(checkRateLimit(`client-${i}`, env, config));
      }

      const results = await Promise.all(promises);

      // 每个客户端都应该独立计数
      results.forEach(result => {
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4);
      });
    });
  });
});
