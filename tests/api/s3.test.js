/**
 * S3 API 端点单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const { mockAwsFetch } = vi.hoisted(() => ({
  mockAwsFetch: vi.fn(),
}));

vi.mock('aws4fetch', () => ({
  AwsClient: class {
    constructor() {}

    fetch(...args) {
      return mockAwsFetch(...args);
    }
  },
}));

import {
  handleGetS3Configs,
  handleSaveS3Config,
  handleTestS3,
  handleDeleteS3Config,
  handleToggleS3,
} from '../../src/api/s3.js';

// --- MockKV ---
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined || value === null) return null;
    if (type === 'json') {
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return typeof value === 'object' ? JSON.stringify(value) : value;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys());
    const prefix = options.prefix || '';
    const filteredKeys = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    return { keys: filteredKeys.map((name) => ({ name })), list_complete: true };
  }

  clear() {
    this.store.clear();
  }
}

function createMockEnv() {
  const kv = new MockKV();
  const encryptionKey = Buffer.from('12345678901234567890123456789012').toString('base64');
  return {
    SECRETS_KV: kv,
    ENCRYPTION_KEY: encryptionKey,
    LOG_LEVEL: 'ERROR',
  };
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/s3/config') {
  return {
    method,
    url,
    headers: new Headers({
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.1',
    }),
    json: async () => body,
  };
}

describe('S3 API Module (Multi-Destination)', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
    mockAwsFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== handleGetS3Configs ====================
  describe('handleGetS3Configs', () => {
    it('未配置时应返回空目标列表', async () => {
      const request = createMockRequest({}, 'GET');
      const response = await handleGetS3Configs(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.destinations).toEqual([]);
      expect(data.count).toBe(0);
      expect(data.maxAllowed).toBe(5);
    });

    it('已配置时应返回目标列表（密钥为空）', async () => {
      const configs = [
        {
          id: 'uuid-1',
          name: 'R2',
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'backup',
          region: 'auto',
          accessKeyId: 'ak',
          secretAccessKey: 'secret-sk',
          prefix: '2fa/',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ];
      await env.SECRETS_KV.put('s3_configs', JSON.stringify(configs));

      const request = createMockRequest({}, 'GET');
      const response = await handleGetS3Configs(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.destinations.length).toBe(1);
      expect(data.count).toBe(1);

      const dest = data.destinations[0];
      expect(dest.id).toBe('uuid-1');
      expect(dest.name).toBe('R2');
      expect(dest.enabled).toBe(true);
      expect(dest.config.endpoint).toBe('https://s3.example.com');
      expect(dest.config.secretAccessKey).toBe('');
      expect(dest.config.hasSecretKey).toBe(true);
    });

    it('应返回各目标的推送状态', async () => {
      const configs = [
        {
          id: 'uuid-1',
          name: 'R2',
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'backup',
          region: 'auto',
          accessKeyId: 'ak',
          secretAccessKey: 'sk',
          prefix: '',
        },
      ];
      await env.SECRETS_KV.put('s3_configs', JSON.stringify(configs));
      await env.SECRETS_KV.put(
        's3_status_uuid-1',
        JSON.stringify({
          lastSuccess: { backupKey: 'backup.json', timestamp: '2026-03-01T00:00:00Z' },
        }),
      );

      const request = createMockRequest({}, 'GET');
      const response = await handleGetS3Configs(request, env);
      const data = await response.json();

      expect(data.destinations[0].status.lastSuccess.timestamp).toBe('2026-03-01T00:00:00Z');
      expect(data.destinations[0].status.lastError).toBeNull();
    });
  });

  // ==================== handleSaveS3Config ====================
  describe('handleSaveS3Config', () => {
    it('应成功保存新配置', async () => {
      const request = createMockRequest({
        name: 'TestR2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '2fa/',
      });

      const response = await handleSaveS3Config(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.id).toBeTruthy();
      expect(data.encrypted).toBe(true);
    });

    it('缺少 name 字段时应返回 400', async () => {
      const request = createMockRequest({
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
      });

      const response = await handleSaveS3Config(request, env);
      expect(response.status).toBe(400);
    });

    it('首次配置时 Secret Access Key 为空应返回 400', async () => {
      const request = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: '',
      });

      const response = await handleSaveS3Config(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toContain('Secret Access Key');
    });

    it('更新配置时 Secret Access Key 为空应保留旧密钥', async () => {
      // 先保存初始配置
      const addReq = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'old-sk',
        prefix: '',
      });
      const addResp = await handleSaveS3Config(addReq, env);
      const addData = await addResp.json();

      // 更新配置时不提供密钥
      const updateReq = createMockRequest({
        id: addData.id,
        name: 'R2-Updated',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'us-east-1',
        accessKeyId: 'new-ak',
        secretAccessKey: '',
        prefix: 'new/',
      });

      const response = await handleSaveS3Config(updateReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('缺少 ENCRYPTION_KEY 时不应覆盖已有加密配置', async () => {
      const addResp = await handleSaveS3Config(createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'old-sk',
        prefix: '',
      }), env);
      const addData = await addResp.json();
      const rawBefore = await env.SECRETS_KV.get('s3_configs', 'text');
      delete env.ENCRYPTION_KEY;

      const response = await handleSaveS3Config(createMockRequest({
        id: addData.id,
        name: 'R2-Updated',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'us-east-1',
        accessKeyId: 'new-ak',
        secretAccessKey: '',
        prefix: 'new/',
      }), env);
      const data = await response.json();
      const rawAfter = await env.SECRETS_KV.get('s3_configs', 'text');

      expect(response.status).toBe(500);
      expect(data.message).toContain('ENCRYPTION_KEY');
      expect(rawAfter).toBe(rawBefore);
    });
  });

  // ==================== handleDeleteS3Config ====================
  describe('handleDeleteS3Config', () => {
    it('应成功删除指定配置', async () => {
      // 先添加
      const addReq = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });
      const addResp = await handleSaveS3Config(addReq, env);
      const addData = await addResp.json();

      // 删除
      const deleteReq = createMockRequest({}, 'DELETE', `https://example.com/api/s3/config?id=${addData.id}`);
      const response = await handleDeleteS3Config(deleteReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('缺少 id 参数应返回 400', async () => {
      const request = createMockRequest({}, 'DELETE', 'https://example.com/api/s3/config');
      const response = await handleDeleteS3Config(request, env);

      expect(response.status).toBe(400);
    });

    it('删除不存在的 id 应返回 404', async () => {
      const request = createMockRequest({}, 'DELETE', 'https://example.com/api/s3/config?id=non-existent');
      const response = await handleDeleteS3Config(request, env);

      expect(response.status).toBe(404);
    });
  });

  // ==================== handleTestS3 ====================
  describe('handleTestS3', () => {
    it('连接成功时应返回 200', async () => {
      mockAwsFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const request = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      const response = await handleTestS3(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('密钥为空且有已保存配置（通过 id）应使用保存的密钥', async () => {
      // 先保存配置
      const addReq = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'saved-sk',
        prefix: '',
      });
      const addResp = await handleSaveS3Config(addReq, env);
      const addData = await addResp.json();

      mockAwsFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const request = createMockRequest({
        id: addData.id,
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: '',
        prefix: '',
      });

      const response = await handleTestS3(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('无 id 且密钥为空时应返回 400（不得回退已保存凭据）', async () => {
      // 先保存一个配置（确保 KV 中有凭据可被误用）
      await handleSaveS3Config(
        createMockRequest({
          name: 'R2',
          endpoint: 'https://s3.example.com',
          bucket: 'backup',
          region: 'auto',
          accessKeyId: 'ak',
          secretAccessKey: 'saved-sk',
          prefix: '',
        }),
        env,
      );

      // 不带 id、密钥为空 → 必须 400，不能回退使用已保存的密钥
      const request = createMockRequest({
        name: 'Other',
        endpoint: 'https://evil.example.com',
        bucket: 'evil-bucket',
        region: 'auto',
        accessKeyId: 'attacker-ak',
        secretAccessKey: '',
        prefix: '',
      });

      const response = await handleTestS3(request, env);
      expect(response.status).toBe(400);
    });
  });

  // ==================== handleToggleS3 ====================
  describe('handleToggleS3', () => {
    it('应成功启用/禁用目标', async () => {
      // 先添加
      const addReq = createMockRequest({
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });
      const addResp = await handleSaveS3Config(addReq, env);
      const addData = await addResp.json();

      // 禁用
      const toggleReq = createMockRequest(
        { id: addData.id, enabled: false },
        'POST',
        'https://example.com/api/s3/toggle',
      );
      const response = await handleToggleS3(toggleReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('已禁用');
    });

    it('不存在的 id 应返回 404', async () => {
      const request = createMockRequest(
        { id: 'non-existent', enabled: false },
        'POST',
        'https://example.com/api/s3/toggle',
      );
      const response = await handleToggleS3(request, env);

      expect(response.status).toBe(404);
    });
  });
});
