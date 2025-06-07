/**
 * Rate Limiting 滑动窗口算法测试
 * 重点测试窗口边界攻击防护
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  checkRateLimitSlidingWindow,
  resetRateLimit,
  getRateLimitInfo
} from '../../src/utils/rateLimit.js';

// Mock KV 存储
function createMockKV() {
  const store = new Map();

  return {
    async get(key, type = 'text') {
      const value = store.get(key);
      if (!value) return null;

      if (type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    },
    async put(key, value, options = {}) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store // 用于测试检查
  };
}

// Mock 环境
function createMockEnv() {
  return {
    SECRETS_KV: createMockKV(),
    LOG_LEVEL: 'ERROR' // 减少测试输出
  };
}

describe('Rate Limiting - 滑动窗口算法', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
  });

  describe('基本功能', () => {
    it('应该允许限制内的请求', async () => {
      const result1 = await checkRateLimitSlidingWindow('test-key', env, {
        maxAttempts: 5,
        windowSeconds: 60
      });

      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4);
      expect(result1.algorithm).toBe('sliding-window');

      const result2 = await checkRateLimitSlidingWindow('test-key', env, {
        maxAttempts: 5,
        windowSeconds: 60
      });

      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(3);
    });

    it('应该拒绝超过限制的请求', async () => {
      const options = { maxAttempts: 3, windowSeconds: 60 };

      // 发送3个请求（达到限制）
      await checkRateLimitSlidingWindow('test-key', env, options);
      await checkRateLimitSlidingWindow('test-key', env, options);
      await checkRateLimitSlidingWindow('test-key', env, options);

      // 第4个请求应该被拒绝
      const result = await checkRateLimitSlidingWindow('test-key', env, options);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.algorithm).toBe('sliding-window');
    });

    it('应该正确计算 resetAt 时间', async () => {
      const now = Date.now();
      const windowSeconds = 60;

      const result = await checkRateLimitSlidingWindow('test-key', env, {
        maxAttempts: 5,
        windowSeconds
      });

      expect(result.resetAt).toBeGreaterThan(now);
      expect(result.resetAt).toBeLessThanOrEqual(now + windowSeconds * 1000 + 100);
    });
  });

  describe('窗口边界攻击防护（关键测试）', () => {
    it('应该防止窗口边界突发攻击', async () => {
      const options = { maxAttempts: 5, windowSeconds: 2 }; // 2秒窗口，5次限制
      let now = Date.now();

      vi.spyOn(Date, 'now').mockImplementation(() => now);

      try {
        // t=0s: 发送5个请求（达到限制）
        for (let i = 0; i < 5; i++) {
          const result = await checkRateLimitSlidingWindow('attack-test', env, options);
          expect(result.allowed).toBe(true);
        }

        // t=0s: 第6个请求应该被拒绝
        let result = await checkRateLimitSlidingWindow('attack-test', env, options);
        expect(result.allowed).toBe(false);

        // t=1.0s: 窗口内还有5个请求，仍应拒绝
        now += 1000;
        result = await checkRateLimitSlidingWindow('attack-test', env, options);
        expect(result.allowed).toBe(false);

        // t=2.001s: 所有旧请求刚过期，应该允许新请求
        now += 1001; // 总共2.001秒
        result = await checkRateLimitSlidingWindow('attack-test', env, options);
        expect(result.allowed).toBe(true);

        // 继续发送4个请求，填满窗口（现在窗口内有5个请求）
        for (let i = 0; i < 4; i++) {
          result = await checkRateLimitSlidingWindow('attack-test', env, options);
          expect(result.allowed).toBe(true);
        }

        // 下一个请求应该被拒绝（窗口内已有5个请求）
        result = await checkRateLimitSlidingWindow('attack-test', env, options);
        expect(result.allowed).toBe(false);

      } finally {
        vi.restoreAllMocks();
      }
    });

    it('对比：固定窗口容易受到窗口边界攻击', async () => {
      // 这个测试演示固定窗口的问题
      const options = { maxAttempts: 5, windowSeconds: 2, algorithm: 'fixed-window' };
      const startTime = Date.now();
      let now = startTime;

      const realDateNow = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => now);

      try {
        // t=0s: 发送5个请求（达到限制）
        for (let i = 0; i < 5; i++) {
          const result = await checkRateLimit('fixed-attack', env, options);
          expect(result.allowed).toBe(true);
        }

        // t=0s: 第6个请求被拒绝
        let result = await checkRateLimit('fixed-attack', env, options);
        expect(result.allowed).toBe(false);

        // t=2.1s: 窗口重置后，立即可以再发5个请求
        now = startTime + 2100; // 新窗口开始
        for (let i = 0; i < 5; i++) {
          result = await checkRateLimit('fixed-attack', env, options);
          expect(result.allowed).toBe(true);
        }

        // 结果：固定窗口允许在极短时间内发送10个请求（窗口切换时）

      } finally {
        vi.restoreAllMocks();
      }
    });

    it('滑动窗口应该平滑限流，无突发漏洞', async () => {
      const options = { maxAttempts: 5, windowSeconds: 3 };
      let now = Date.now();

      vi.spyOn(Date, 'now').mockImplementation(() => now);

      try {
        // 模拟均匀分布的请求
        const results = [];

        // 每500ms发送一个请求，持续4秒
        for (let i = 0; i < 8; i++) {
          const result = await checkRateLimitSlidingWindow('smooth-test', env, options);
          results.push({ time: now, allowed: result.allowed });
          now += 500;
        }

        // 验证结果
        // t=0.0s: 允许 (1/5)
        // t=0.5s: 允许 (2/5)
        // t=1.0s: 允许 (3/5)
        // t=1.5s: 允许 (4/5)
        // t=2.0s: 允许 (5/5)
        // t=2.5s: 拒绝 (窗口内还有5个)
        // t=3.0s: 允许 (t=0s的请求过期)
        // t=3.5s: 允许 (t=0.5s的请求过期)

        expect(results[0].allowed).toBe(true);
        expect(results[1].allowed).toBe(true);
        expect(results[2].allowed).toBe(true);
        expect(results[3].allowed).toBe(true);
        expect(results[4].allowed).toBe(true);
        expect(results[5].allowed).toBe(false); // 窗口满
        expect(results[6].allowed).toBe(true);  // 旧请求过期
        expect(results[7].allowed).toBe(true);  // 旧请求过期

      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('时间戳清理和性能', () => {
    it('应该自动清理过期的时间戳', async () => {
      const options = { maxAttempts: 5, windowSeconds: 2 };
      let now = Date.now();

      vi.spyOn(Date, 'now').mockImplementation(() => now);

      try {
        // 发送5个请求
        for (let i = 0; i < 5; i++) {
          await checkRateLimitSlidingWindow('cleanup-test', env, options);
        }

        // 检查存储的数据
        const data1 = await env.SECRETS_KV.get('ratelimit:v2:cleanup-test', 'json');
        expect(data1.timestamps.length).toBe(5);

        // 等待窗口过期
        now += 3000;

        // 发送新请求
        await checkRateLimitSlidingWindow('cleanup-test', env, options);

        // 旧的时间戳应该被清理
        const data2 = await env.SECRETS_KV.get('ratelimit:v2:cleanup-test', 'json');
        expect(data2.timestamps.length).toBe(1); // 只有新请求

      } finally {
        vi.restoreAllMocks();
      }
    });

    it('应该限制时间戳数组的最大长度', async () => {
      const options = { maxAttempts: 5, windowSeconds: 60 };

      // 发送大量请求（超过 maxAttempts * 2）
      for (let i = 0; i < 15; i++) {
        await checkRateLimitSlidingWindow('size-test', env, options);
      }

      // 检查数组长度
      const data = await env.SECRETS_KV.get('ratelimit:v2:size-test', 'json');
      expect(data.timestamps.length).toBeLessThanOrEqual(20); // maxAttempts * 2 或 20
    });
  });

  describe('getRateLimitInfo', () => {
    it('应该返回滑动窗口的准确信息', async () => {
      const options = { maxAttempts: 5, windowSeconds: 60 };

      // 发送3个请求
      await checkRateLimitSlidingWindow('info-test', env, options);
      await checkRateLimitSlidingWindow('info-test', env, options);
      await checkRateLimitSlidingWindow('info-test', env, options);

      // 获取信息
      const info = await getRateLimitInfo('info-test', env, options);

      expect(info.count).toBe(3);
      expect(info.remaining).toBe(2);
      expect(info.algorithm).toBe('sliding-window');
    });
  });

  describe('resetRateLimit', () => {
    it('应该清理两个版本的数据', async () => {
      // 创建v1和v2数据
      await env.SECRETS_KV.put('ratelimit:reset-test', JSON.stringify({ count: 5 }));
      await env.SECRETS_KV.put('ratelimit:v2:reset-test', JSON.stringify({ timestamps: [Date.now()] }));

      // 重置
      await resetRateLimit('reset-test', env);

      // 验证清理
      const v1Data = await env.SECRETS_KV.get('ratelimit:reset-test');
      const v2Data = await env.SECRETS_KV.get('ratelimit:v2:reset-test');

      expect(v1Data).toBeNull();
      expect(v2Data).toBeNull();
    });
  });

  describe('算法选择', () => {
    it('默认应该使用滑动窗口', async () => {
      const result = await checkRateLimit('default-test', env, {
        maxAttempts: 5,
        windowSeconds: 60
      });

      expect(result.algorithm).toBe('sliding-window');
    });

    it('应该支持显式选择固定窗口', async () => {
      const result = await checkRateLimit('fixed-test', env, {
        maxAttempts: 5,
        windowSeconds: 60,
        algorithm: 'fixed-window'
      });

      expect(result.algorithm).toBe('fixed-window');
    });
  });
});
