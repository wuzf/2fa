/**
 * 批量导入功能测试
 * 测试 src/api/secrets/batch.js 模块
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBatchAddSecrets } from '../../src/api/secrets/batch.js';

// Mock KV 存储
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    if (type === 'json') {
      // 如果已经是对象，直接返回；否则解析 JSON
      if (typeof value === 'object') return value;
      return JSON.parse(value);
    }
    return value;
  }

  async put(key, value, options = {}) {
    // 存储时保持原始类型（支持对象存储）
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys())
      .filter(key => !options.prefix || key.startsWith(options.prefix))
      .sort()
      .slice(0, options.limit || 1000);
    return {
      keys: keys.map(name => ({ name })),
      list_complete: true
    };
  }
}

// 创建 Mock 环境
function createMockEnv() {
  return {
    SECRETS_KV: new MockKV(),
    ENCRYPTION_KEY: 'NxB5r5mR1wCuEr0QDpmEmqpuPskz/GPLn4Xew2NRY4c=', // base64 encoded 32 bytes
    LOG_LEVEL: 'ERROR'
  };
}

// 创建 Mock Request
function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/secrets/batch') {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.1'
    },
    body: JSON.stringify(body)
  });
}

describe('Batch Import API Module', () => {
  describe('handleBatchAddSecrets - 批量导入', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('应该成功批量导入多个密钥', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            name: 'GitHub',
            account: 'user1@example.com',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP'
          },
          {
            name: 'Google',
            account: 'user2@example.com',
            secret: 'JBSWY3DPEHPK3PXQ',
            type: 'TOTP'
          },
          {
            name: 'AWS',
            secret: 'JBSWY3DPEHPK3PXR',
            type: 'TOTP'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.successCount).toBe(3);
      expect(data.failCount).toBe(0);
      expect(data.totalCount).toBe(3);
      expect(data.results).toHaveLength(3);
      expect(data.results[0].success).toBe(true);
      expect(data.results[0].secret).toBeDefined();
      expect(data.results[0].secret.id).toBeDefined();
    });

    it('应该处理部分成功的批量导入', async () => {
      const env = createMockEnv();

      // 先添加一个密钥
      await env.SECRETS_KV.put('secrets', JSON.stringify([{
        id: '1',
        name: 'GitHub',
        account: 'user1@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      }]));

      const request = createMockRequest({
        secrets: [
          {
            name: 'GitHub', // 重复
            account: 'user1@example.com',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP'
          },
          {
            name: 'Google', // 成功
            account: 'user2@example.com',
            secret: 'JBSWY3DPEHPK3PXQ',
            type: 'TOTP'
          },
          {
            name: 'AWS', // 无效密钥
            secret: 'INVALID!!!',
            type: 'TOTP'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.successCount).toBe(1);
      expect(data.failCount).toBe(2);
      expect(data.totalCount).toBe(3);

      // 检查结果详情
      expect(data.results[0].success).toBe(false);
      expect(data.results[0].error).toContain('已存在');
      expect(data.results[1].success).toBe(true);
      expect(data.results[2].success).toBe(false);
    });

    it('应该验证必需字段', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            // 缺少 name
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.successCount).toBe(0);
      expect(data.failCount).toBe(1);
      expect(data.results[0].success).toBe(false);
      expect(data.results[0].error).toBeDefined();
    });

    it('应该验证密钥格式', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            name: 'Test',
            secret: 'invalid-base32!!!',
            type: 'TOTP'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.successCount).toBe(0);
      expect(data.failCount).toBe(1);
      expect(data.results[0].success).toBe(false);
    });

    it('应该处理空数组', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: []
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      // 空数组可能被视为无效请求，返回 400 或 200 都合理
      expect([200, 400].includes(response.status)).toBe(true);

      if (response.status === 200) {
        expect(data.successCount).toBe(0);
        expect(data.failCount).toBe(0);
        expect(data.totalCount).toBe(0);
      }
    });

    it('应该支持 HOTP 类型', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            name: 'HOTP Service',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'HOTP',
            counter: 0
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successCount).toBe(1);
      expect(data.results[0].secret.type).toBe('HOTP');
      expect(data.results[0].secret.counter).toBe(0);
    });

    it('应该设置默认值', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            name: 'Test Service',
            secret: 'JBSWY3DPEHPK3PXP'
            // 不指定 type, digits, period, algorithm
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successCount).toBe(1);
      const secret = data.results[0].secret;
      expect(secret.type).toBe('TOTP');
      expect(secret.digits).toBe(6);
      expect(secret.period).toBe(30);
      expect(secret.algorithm).toBe('SHA1');
    });

    it('应该检查重复（同名同账户）', async () => {
      const env = createMockEnv();

      // 先添加一个密钥
      await env.SECRETS_KV.put('secrets', JSON.stringify([{
        id: '1',
        name: 'GitHub',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      }]));

      const request = createMockRequest({
        secrets: [
          {
            name: 'GitHub',
            account: 'user@example.com', // 重复
            secret: 'JBSWY3DPEHPK3PXP'   // 相同的 secret 才算重复
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.successCount).toBe(0);
      expect(data.failCount).toBe(1);
      expect(data.results[0].error).toContain('已存在');
    });

    it('应该允许同名不同账户', async () => {
      const env = createMockEnv();

      // 先添加一个密钥
      await env.SECRETS_KV.put('secrets', JSON.stringify([{
        id: '1',
        name: 'GitHub',
        account: 'user1@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      }]));

      const request = createMockRequest({
        secrets: [
          {
            name: 'GitHub',
            account: 'user2@example.com', // 不同账户
            secret: 'JBSWY3DPEHPK3PXQ'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.successCount).toBe(1);
      expect(data.failCount).toBe(0);
    });

    it('应该触发 Rate Limiting', async () => {
      const env = createMockEnv();

      const body = {
        secrets: [{ name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }]
      };

      // 连续调用多次触发限制（bulk preset: 20/5分钟）
      for (let i = 0; i < 20; i++) {
        const req = createMockRequest(body);
        await handleBatchAddSecrets(req, env);
      }

      // 第21次应该被限制
      const response = await handleBatchAddSecrets(createMockRequest(body), env);
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toBeDefined();
      expect(data.error).toContain('请求过于频繁');
    });

    it('应该生成唯一的密钥 ID', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          { name: 'Service1', secret: 'JBSWY3DPEHPK3PXP' },
          { name: 'Service2', secret: 'JBSWY3DPEHPK3PXQ' }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      const id1 = data.results[0].secret.id;
      const id2 = data.results[1].secret.id;

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      // UUID 格式验证
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });


    it('应该处理加密的现有数据', async () => {
      const env = createMockEnv();

      // 先添加一个加密的密钥
      const { encryptData } = await import('../../src/utils/encryption.js');
      const existingSecrets = [{
        id: '1',
        name: 'Existing',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      }];
      const encrypted = await encryptData(existingSecrets, env);
      await env.SECRETS_KV.put('secrets', encrypted);

      const request = createMockRequest({
        secrets: [
          { name: 'New Service', secret: 'JBSWY3DPEHPK3PXQ' }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successCount).toBe(1);
    });

    it('应该返回详细的结果索引', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          { name: 'Service1', secret: 'JBSWY3DPEHPK3PXP' },
          { name: 'Service2', secret: 'INVALID!!!' },
          { name: 'Service3', secret: 'JBSWY3DPEHPK3PXR' }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.results[0].index).toBe(0);
      expect(data.results[1].index).toBe(1);
      expect(data.results[2].index).toBe(2);
      expect(data.results[0].success).toBe(true);
      expect(data.results[1].success).toBe(false);
      expect(data.results[2].success).toBe(true);
    });

    it('应该验证请求体格式', async () => {
      const env = createMockEnv();

      // 缺少 secrets 字段
      const request = createMockRequest({
        wrongField: []
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error || data.message).toBeDefined();
    });

    it('应该拒绝非数组的 secrets', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: 'not an array'
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error || data.message).toBeDefined();
    });

    it('应该支持自定义 OTP 参数', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          {
            name: 'Custom Service',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP',
            digits: 8,
            period: 60,
            algorithm: 'SHA256'
          }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successCount).toBe(1);
      const secret = data.results[0].secret;
      expect(secret.digits).toBe(8);
      expect(secret.period).toBe(60);
      expect(secret.algorithm).toBe('SHA256');
    });

    it('应该处理混合成功和失败的场景', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        secrets: [
          { name: 'Valid1', secret: 'JBSWY3DPEHPK3PXP' },
          { name: '', secret: 'JBSWY3DPEHPK3PXQ' }, // 空名称
          { name: 'Valid2', secret: 'JBSWY3DPEHPK3PXR' },
          { name: 'Invalid', secret: '!!!' }, // 无效密钥
          { name: 'Valid3', secret: 'JBSWY3DPEHPK3PXS' }
        ]
      });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(data.totalCount).toBe(5);
      expect(data.successCount).toBe(3);
      expect(data.failCount).toBe(2);

      // 验证具体哪些成功/失败
      expect(data.results[0].success).toBe(true);
      expect(data.results[1].success).toBe(false);
      expect(data.results[2].success).toBe(true);
      expect(data.results[3].success).toBe(false);
      expect(data.results[4].success).toBe(true);
    });

    it('应该处理大批量导入', async () => {
      const env = createMockEnv();

      // 创建 50 个密钥
      const secrets = Array.from({ length: 50 }, (_, i) => ({
        name: `Service${i}`,
        secret: 'JBSWY3DPEHPK3PXP',
        account: `user${i}@example.com`
      }));

      const request = createMockRequest({ secrets });

      const response = await handleBatchAddSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.successCount).toBe(50);
      expect(data.failCount).toBe(0);
      expect(data.results).toHaveLength(50);
    });
  });
});
