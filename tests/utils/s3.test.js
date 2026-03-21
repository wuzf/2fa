/**
 * S3 工具模块单元测试
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
  pushToAllS3,
  getS3Configs,
  saveS3Configs,
  saveS3SingleConfig,
  deleteS3SingleConfig,
  getS3Status,
  getS3Config,
  saveS3Config,
  pushToS3,
  testS3Connection,
} from '../../src/utils/s3.js';

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
      return JSON.parse(value);
    }
    return value;
  }

  async put(key, value) {
    this.store.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
  }

  async delete(key) {
    this.store.delete(key);
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

describe('S3 Utils Module (Multi-Destination)', () => {
  let env;

  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
    mockAwsFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== getS3Configs ====================
  describe('getS3Configs', () => {
    it('未配置时应返回空数组', async () => {
      const configs = await getS3Configs(env);
      expect(configs).toEqual([]);
    });

    it('应读取新格式配置数组', async () => {
      const testConfigs = [
        {
          id: 'uuid-1',
          name: 'R2',
          enabled: true,
          endpoint: 'https://r2.example.com',
          bucket: 'backup',
          region: 'auto',
          accessKeyId: 'ak',
          secretAccessKey: 'sk',
          prefix: '2fa/',
        },
      ];
      await env.SECRETS_KV.put('s3_configs', JSON.stringify(testConfigs));

      const configs = await getS3Configs(env);
      expect(configs).toEqual(testConfigs);
      expect(configs.length).toBe(1);
    });

    it('应自动迁移旧格式到新格式', async () => {
      const oldConfig = {
        endpoint: 'https://s3.example.com',
        bucket: 'backup',
        region: 'us-east-1',
        accessKeyId: 'old-ak',
        secretAccessKey: 'old-sk',
        prefix: 'old/',
      };
      await env.SECRETS_KV.put('s3_config', JSON.stringify(oldConfig));
      await env.SECRETS_KV.put(
        's3_last_success',
        JSON.stringify({ backupKey: 'test.json', timestamp: '2026-01-01T00:00:00Z' }),
      );

      const configs = await getS3Configs(env);

      expect(configs.length).toBe(1);
      expect(configs[0].endpoint).toBe('https://s3.example.com');
      expect(configs[0].bucket).toBe('backup');
      expect(configs[0].name).toBe('S3');
      expect(configs[0].enabled).toBe(true);
      expect(configs[0].id).toBeTruthy();

      // 旧 key 应被删除
      expect(await env.SECRETS_KV.get('s3_config')).toBeNull();
      expect(await env.SECRETS_KV.get('s3_last_success')).toBeNull();

      // 新格式应已保存
      const saved = await env.SECRETS_KV.get('s3_configs');
      expect(saved).toBeTruthy();

      // 状态应迁移到新 key
      const status = await env.SECRETS_KV.get(`s3_status_${configs[0].id}`, 'json');
      expect(status.lastSuccess.backupKey).toBe('test.json');
    });

    it('KV 读取失败时应抛出错误', async () => {
      env.SECRETS_KV.get = vi.fn().mockRejectedValue(new Error('KV error'));

      await expect(getS3Configs(env)).rejects.toThrow('KV error');
    });
  });

  // ==================== saveS3SingleConfig ====================
  describe('saveS3SingleConfig', () => {
    it('应成功新增配置', async () => {
      const config = {
        name: 'TestR2',
        endpoint: 'https://r2.example.com',
        bucket: 'backup',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '2fa/',
      };

      const result = await saveS3SingleConfig(env, config);

      expect(result.success).toBe(true);
      expect(result.id).toBeTruthy();

      const configs = await getS3Configs(env);
      expect(configs.length).toBe(1);
      expect(configs[0].name).toBe('TestR2');
      expect(configs[0].enabled).toBe(true);
      expect(configs[0].createdAt).toBeTruthy();
    });

    it('应成功更新已有配置', async () => {
      // 先新增
      const result1 = await saveS3SingleConfig(env, {
        name: 'R2-1',
        endpoint: 'https://r2-1.example.com',
        bucket: 'bucket-1',
        region: 'auto',
        accessKeyId: 'ak-1',
        secretAccessKey: 'sk-1',
        prefix: 'old/',
      });

      // 更新
      const result2 = await saveS3SingleConfig(env, {
        id: result1.id,
        name: 'R2-1-Updated',
        endpoint: 'https://r2-2.example.com',
        bucket: 'bucket-2',
        region: 'us-east-1',
        accessKeyId: 'ak-2',
        secretAccessKey: 'sk-2',
        prefix: 'new/',
      });

      expect(result2.success).toBe(true);

      const configs = await getS3Configs(env);
      expect(configs.length).toBe(1);
      expect(configs[0].name).toBe('R2-1-Updated');
      expect(configs[0].endpoint).toBe('https://r2-2.example.com');
      expect(configs[0].bucket).toBe('bucket-2');
    });

    it('更新不存在的 id 时应返回错误', async () => {
      const result = await saveS3SingleConfig(env, {
        id: 'non-existent',
        name: 'Test',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteS3SingleConfig ====================
  describe('deleteS3SingleConfig', () => {
    it('应成功删除配置和状态', async () => {
      const result = await saveS3SingleConfig(env, {
        name: 'ToDelete',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      await env.SECRETS_KV.put(`s3_status_${result.id}`, JSON.stringify({ lastSuccess: {} }));

      const deleteResult = await deleteS3SingleConfig(env, result.id);
      expect(deleteResult.success).toBe(true);

      const configs = await getS3Configs(env);
      expect(configs.length).toBe(0);

      const status = await env.SECRETS_KV.get(`s3_status_${result.id}`);
      expect(status).toBeNull();
    });

    it('删除不存在的 id 应返回错误', async () => {
      const result = await deleteS3SingleConfig(env, 'non-existent');
      expect(result.success).toBe(false);
    });
  });

  // ==================== pushToAllS3 ====================
  describe('pushToAllS3', () => {
    it('无配置时应返回 null', async () => {
      const result = await pushToAllS3('backup_test.json', '{}', env);
      expect(result).toBeNull();
    });

    it('所有目标禁用时应返回 null', async () => {
      await saveS3SingleConfig(env, {
        name: 'Disabled',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });
      const configs = await getS3Configs(env);
      configs[0].enabled = false;
      await saveS3Configs(env, configs);

      const result = await pushToAllS3('backup_test.json', '{}', env);
      expect(result).toBeNull();
    });

    it('应并行推送到多个启用的目标', async () => {
      await saveS3SingleConfig(env, {
        name: 'R2-1',
        endpoint: 'https://s3-1.example.com',
        bucket: 'bucket-1',
        region: 'auto',
        accessKeyId: 'ak-1',
        secretAccessKey: 'sk-1',
        prefix: '',
      });
      await saveS3SingleConfig(env, {
        name: 'R2-2',
        endpoint: 'https://s3-2.example.com',
        bucket: 'bucket-2',
        region: 'auto',
        accessKeyId: 'ak-2',
        secretAccessKey: 'sk-2',
        prefix: '',
      });

      mockAwsFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await pushToAllS3('backup_test.json', '{}', env);

      expect(result).toBeTruthy();
      expect(result.successCount).toBe(2);
      expect(result.failCount).toBe(0);
      expect(result.results.length).toBe(2);
      expect(mockAwsFetch).toHaveBeenCalledTimes(2);
    });

    it('单目标推送成功时应记录状态', async () => {
      const addResult = await saveS3SingleConfig(env, {
        name: 'R2-1',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: 'backup/',
      });

      mockAwsFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await pushToAllS3('backup_test.json', '{}', env);

      expect(result.successCount).toBe(1);

      const status = await getS3Status(env, addResult.id);
      expect(status.lastSuccess).toBeTruthy();
      expect(status.lastSuccess.backupKey).toBe('backup_test.json');
      expect(status.lastError).toBeNull();

      const fetchCall = mockAwsFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://s3.example.com/bucket/backup/backup_test.json');
    });

    it('单目标推送失败时应记录错误状态', async () => {
      const addResult = await saveS3SingleConfig(env, {
        name: 'R2-1',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      mockAwsFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await pushToAllS3('backup_test.json', '{}', env);

      expect(result.successCount).toBe(0);
      expect(result.failCount).toBe(1);

      const status = await getS3Status(env, addResult.id);
      expect(status.lastError).toBeTruthy();
      expect(status.lastError.error).toContain('403');
    });
  });

  // ==================== 兼容性导出 ====================
  describe('Backward Compatibility', () => {
    it('getS3Config 应返回第一个配置', async () => {
      await saveS3SingleConfig(env, {
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      const config = await getS3Config(env);
      expect(config).toBeTruthy();
      expect(config.endpoint).toBe('https://s3.example.com');
    });

    it('getS3Config 无配置时应返回 null', async () => {
      const config = await getS3Config(env);
      expect(config).toBeNull();
    });

    it('saveS3Config 应等价于 saveS3SingleConfig', async () => {
      const result = await saveS3Config(env, {
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeTruthy();
    });

    it('pushToS3 应调用多目标推送逻辑', async () => {
      await saveS3SingleConfig(env, {
        name: 'R2',
        endpoint: 'https://s3.example.com',
        bucket: 'bucket',
        region: 'auto',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        prefix: '',
      });

      mockAwsFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await pushToS3('backup_test.json', '{}', env);
      expect(result.successCount).toBe(1);
    });
  });

  // ==================== testS3Connection ====================
  describe('testS3Connection', () => {
    const testConfig = {
      endpoint: 'https://s3.example.com',
      bucket: 'backup',
      region: 'auto',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      prefix: '',
    };

    it('List + Put 成功时应返回连接成功', async () => {
      mockAwsFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const result = await testS3Connection(testConfig);
      expect(result.success).toBe(true);
      expect(mockAwsFetch).toHaveBeenCalledTimes(2);
    });

    it('认证失败（403）应返回错误', async () => {
      mockAwsFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const result = await testS3Connection(testConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('认证失败');
    });

    it('连接超时应返回超时错误', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockAwsFetch.mockRejectedValueOnce(abortError);

      const result = await testS3Connection(testConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('超时');
    });

    it('写入阶段超时应返回写入超时错误', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      mockAwsFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockRejectedValueOnce(abortError);

      const result = await testS3Connection(testConfig);
      expect(result.success).toBe(false);
      expect(result.message).toContain('写入测试超时');
    });
  });
});
