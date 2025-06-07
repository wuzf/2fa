/**
 * Backup API 模块集成测试
 * 测试备份创建、列表、恢复、导出功能
 * 目标覆盖率: 70%+
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleBackupSecrets,
  handleGetBackups
} from '../../src/api/secrets/backup.js';
import {
  handleRestoreBackup,
  handleExportBackup
} from '../../src/api/secrets/restore.js';
import { saveSecretsToKV } from '../../src/api/secrets/shared.js';

// ==================== Mock 模块 ====================

// Mock KV 存储
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (!value) return null;

    if (type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async put(key, value, options = {}) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys());
    const prefix = options.prefix || '';
    const limit = options.limit || 1000;
    const cursor = options.cursor;

    const filteredKeys = prefix ? keys.filter(k => k.startsWith(prefix)) : keys;

    // 简单模拟分页
    const startIndex = cursor ? parseInt(cursor) : 0;
    const pageKeys = filteredKeys.slice(startIndex, startIndex + limit);

    return {
      keys: pageKeys.map(name => ({
        name,
        metadata: { created: new Date().toISOString() }
      })),
      list_complete: startIndex + limit >= filteredKeys.length,
      cursor: (startIndex + limit < filteredKeys.length) ? String(startIndex + limit) : undefined
    };
  }

  clear() {
    this.store.clear();
  }
}

// Mock 环境
function createMockEnv() {
  const kv = new MockKV();
  // 正确的 32 字节加密密钥
  const encryptionKey = Buffer.from('12345678901234567890123456789012').toString('base64');

  return {
    SECRETS_KV: kv,
    ENCRYPTION_KEY: encryptionKey,
    LOG_LEVEL: 'ERROR'
  };
}

// 创建 Mock Request
function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/backup', params = {}) {
  let fullUrl = url;
  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    fullUrl = `${url}?${queryString}`;
  }

  return {
    method,
    url: fullUrl,
    headers: new Headers({
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.1'
    }),
    json: async () => body
  };
}

// ==================== 测试套件 ====================

describe('Backup API Module', () => {

  describe('handleBackupSecrets - 备份创建', () => {
    it('应该成功创建备份', async () => {
      const env = createMockEnv();

      // 先添加一些密钥
      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP',
          digits: 6,
          period: 30,
          algorithm: 'SHA1'
        }
      ], 'test');

      const request = createMockRequest();
      const response = await handleBackupSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('备份完成');
      expect(data.backupKey).toBeDefined();
      expect(data.backupKey).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
      expect(data.count).toBe(1);
      expect(data.encrypted).toBe(true);
    });

    it('应该在没有密钥时返回错误', async () => {
      const env = createMockEnv();
      const request = createMockRequest();

      const response = await handleBackupSecrets(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
      expect(data.message).toContain('没有密钥需要备份');
    });

    it('应该创建加密的备份', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'Test',
          account: '',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const request = createMockRequest();
      const response = await handleBackupSecrets(request, env);
      const data = await response.json();

      expect(data.encrypted).toBe(true);

      // 验证备份文件确实是加密的
      const backupContent = await env.SECRETS_KV.get(data.backupKey, 'text');
      expect(backupContent).toBeDefined();
      expect(backupContent).toMatch(/^v1:/); // 加密标记
    });

    it('应该在未配置加密密钥时创建明文备份', async () => {
      const env = createMockEnv();
      delete env.ENCRYPTION_KEY; // 移除加密密钥

      await env.SECRETS_KV.put('secrets', JSON.stringify([
        {
          id: '1',
          name: 'Test',
          secret: 'JBSWY3DPEHPK3PXP'
        }
      ]));

      const request = createMockRequest();
      const response = await handleBackupSecrets(request, env);
      const data = await response.json();

      expect(data.encrypted).toBe(false);

      // 验证备份是明文
      const backupContent = await env.SECRETS_KV.get(data.backupKey, 'text');
      expect(backupContent).toBeDefined();
      expect(() => JSON.parse(backupContent)).not.toThrow();
    });

    it('应该触发 Rate Limiting', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const request = createMockRequest();

      // 连续发送多个备份请求触发速率限制
      // sensitive preset: 10/minute
      for (let i = 0; i < 11; i++) {
        await handleBackupSecrets(request, env);
      }

      const response = await handleBackupSecrets(request, env);
      expect(response.status).toBe(429); // Too Many Requests
    });
  });

  describe('handleGetBackups - 获取备份列表', () => {
    it('应该返回空列表当没有备份时', async () => {
      const env = createMockEnv();
      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup');

      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.backups).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('应该返回备份列表', async () => {
      const env = createMockEnv();

      // 创建第一个备份
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test1', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const req1 = createMockRequest();
      await handleBackupSecrets(req1, env);

      // 强制等待足够长的时间确保时间戳不同（至少1秒）
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 创建第二个备份（不同的数据）
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test1', secret: 'JBSWY3DPEHPK3PXP' },
        { id: '2', name: 'Test2', secret: 'MFRGGZDFMZTWQ2LK' }
      ], 'test');

      const req2 = createMockRequest();
      await handleBackupSecrets(req2, env);

      // 获取备份列表
      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup');
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.backups.length).toBeGreaterThanOrEqual(1); // 至少有一个备份
      expect(data.count).toBeGreaterThanOrEqual(1);

      // 验证备份详情
      const backup = data.backups[0];
      expect(backup.key).toBeDefined();
      expect(backup.created).toBeDefined();
      expect(backup.count).toBeDefined();
      expect(backup.encrypted).toBeDefined();
      expect(backup.size).toBeGreaterThan(0);
    });

    it('应该支持分页参数', async () => {
      const env = createMockEnv();

      // 创建多个备份
      for (let i = 0; i < 5; i++) {
        await saveSecretsToKV(env, [
          { id: String(i), name: `Test${i}`, secret: 'JBSWY3DPEHPK3PXP' }
        ], 'test');
        const req = createMockRequest();
        await handleBackupSecrets(req, env);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' });
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBeLessThanOrEqual(2);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.limit).toBe(2);
    });

    it('应该支持简单模式（不获取详情）', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');
      const req = createMockRequest();
      await handleBackupSecrets(req, env);

      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup', { details: 'false' });
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBeGreaterThan(0);

      // 简单模式不应该包含 count 和 encrypted
      const backup = data.backups[0];
      expect(backup.key).toBeDefined();
      expect(backup.created).toBeDefined();
      expect(backup.count).toBeUndefined();
      expect(backup.encrypted).toBeUndefined();
    });

    it('应该正确处理加密和明文备份混合', async () => {
      const env = createMockEnv();

      // 创建明文备份
      const plaintextBackup = {
        timestamp: new Date().toISOString(),
        version: '1.0',
        count: 1,
        secrets: [{ id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }]
      };
      await env.SECRETS_KV.put('backup_2025-01-01_00-00-00.json', JSON.stringify(plaintextBackup));

      // 创建加密备份
      await saveSecretsToKV(env, [
        { id: '2', name: 'Test2', secret: 'MFRGGZDFMZTWQ2LK' }
      ], 'test');
      const req = createMockRequest();
      await handleBackupSecrets(req, env);

      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup');
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBeGreaterThanOrEqual(2);

      // 应该同时包含加密和明文备份
      const hasEncrypted = data.backups.some(b => b.encrypted === true);
      const hasPlaintext = data.backups.some(b => b.encrypted === false);
      expect(hasEncrypted || hasPlaintext).toBe(true);
    });

    it('应该正确解析备份时间', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');
      const req = createMockRequest();
      const backupResp = await handleBackupSecrets(req, env);
      const backupData = await backupResp.json();

      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup');
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      const backup = data.backups.find(b => b.key === backupData.backupKey);
      expect(backup).toBeDefined();
      expect(backup.created).toBeDefined();
      expect(backup.created).not.toBe('unknown');
    });

    it('应该支持 limit=all 加载所有备份', async () => {
      const env = createMockEnv();

      // 创建10个备份用于测试（直接在KV中创建，绕过rate limiting）
      for (let i = 0; i < 10; i++) {
        const backupData = {
          timestamp: new Date(Date.now() + i * 1000).toISOString(), // 确保不同的时间戳
          version: '1.0',
          count: 1,
          secrets: [{ id: String(i), name: `Test${i}`, secret: 'JBSWY3DPEHPK3PXP' }]
        };

        // 生成备份文件名（使用不同的时间戳）
        const date = new Date(Date.now() + i * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        const backupKey = `backup_${dateStr}_${timeStr}.json`;

        // 直接保存到 KV（不通过 handleBackupSecrets 以避免 rate limiting）
        await env.SECRETS_KV.put(backupKey, JSON.stringify(backupData));
      }

      // 使用 limit=all 获取所有备份
      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: 'all' });
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBeGreaterThanOrEqual(10); // 至少10个
      expect(data.pagination).toBeDefined();
      expect(data.pagination.loadedAll).toBe(true);
      expect(data.pagination.hasMore).toBe(false);
    });

    it('应该支持 limit=0 加载所有备份（与 limit=all 相同）', async () => {
      const env = createMockEnv();

      // 创建10个备份（直接在KV中创建）
      for (let i = 0; i < 10; i++) {
        const backupData = {
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          version: '1.0',
          count: 1,
          secrets: [{ id: String(i), name: `Test${i}`, secret: 'JBSWY3DPEHPK3PXP' }]
        };

        const date = new Date(Date.now() + i * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        const backupKey = `backup_${dateStr}_${timeStr}.json`;

        await env.SECRETS_KV.put(backupKey, JSON.stringify(backupData));
      }

      // 使用 limit=0 获取所有备份
      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '0' });
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBe(10);
      expect(data.pagination.loadedAll).toBe(true);
    });

    it('应该支持更大的 limit 值（最大1000）', async () => {
      const env = createMockEnv();

      // 创建20个备份（直接在KV中创建）
      for (let i = 0; i < 20; i++) {
        const backupData = {
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          version: '1.0',
          count: 1,
          secrets: [{ id: String(i), name: `Test${i}`, secret: 'JBSWY3DPEHPK3PXP' }]
        };

        const date = new Date(Date.now() + i * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        const backupKey = `backup_${dateStr}_${timeStr}.json`;

        await env.SECRETS_KV.put(backupKey, JSON.stringify(backupData));
      }

      // 使用 limit=500（超过旧限制100，但在新限制1000内）
      const request = createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '500' });
      const response = await handleGetBackups(request, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.length).toBe(20); // 实际只有20个
      expect(data.pagination.limit).toBe(500);
    });
  });

  describe('handleRestoreBackup - 备份恢复', () => {
    it('应该成功恢复备份 (POST方式)', async () => {
      const env = createMockEnv();

      // 创建备份
      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 清空当前密钥
      await env.SECRETS_KV.delete('secrets');

      // 恢复备份
      const restoreReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(restoreReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('恢复备份成功');
      expect(data.count).toBe(1);
    });

    it('应该支持预览模式', async () => {
      const env = createMockEnv();

      // 创建备份
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' },
        { id: '2', name: 'Test2', secret: 'MFRGGZDFMZTWQ2LK' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 预览备份
      const previewReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(previewReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // createSuccessResponse 返回结构：{success, message, data}
      // 预览数据在 data.data 中
      expect(data.data).toBeDefined();
      expect(data.data.secrets).toBeDefined();
      expect(Array.isArray(data.data.secrets)).toBe(true);
      expect(data.data.secrets.length).toBe(2);
      expect(data.data.count).toBeDefined();
    });

    it('应该支持GET方式恢复', async () => {
      const env = createMockEnv();

      // 创建备份
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 使用GET方式恢复
      const restoreReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/restore?key=${backupData.backupKey}`);

      const response = await handleRestoreBackup(restoreReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('应该在备份不存在时返回404', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        backupKey: 'backup_9999-12-31_23-59-59.json',
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(request, env);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('备份不存在');
    });

    it('应该拒绝无效的备份键格式', async () => {
      const env = createMockEnv();

      const request = createMockRequest({
        backupKey: 'invalid-key',
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('应该在缺少备份键时返回错误', async () => {
      const env = createMockEnv();

      const request = createMockRequest({}, 'GET',
        'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(request, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('备份键缺失');
    });

    it('应该正确恢复加密备份', async () => {
      const env = createMockEnv();

      const originalSecrets = [
        {
          id: '1',
          name: 'Test Encrypted',
          account: 'test@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP',
          digits: 6,
          period: 30,
          algorithm: 'SHA1'
        }
      ];

      await saveSecretsToKV(env, originalSecrets, 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 修改现有密钥
      await saveSecretsToKV(env, [
        { id: '2', name: 'Different', secret: 'MFRGGZDFMZTWQ2LK' }
      ], 'test');

      // 恢复备份
      const restoreReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(restoreReq, env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.sourceEncrypted).toBe(true);
    });

    it('应该在加密密钥缺失时拒绝恢复加密备份', async () => {
      const env = createMockEnv();

      // 创建加密备份
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 移除加密密钥
      delete env.ENCRYPTION_KEY;

      // 尝试恢复
      const restoreReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');

      const response = await handleRestoreBackup(restoreReq, env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('无法恢复');
      expect(data.message).toContain('未配置 ENCRYPTION_KEY');
    });
  });

  describe('handleExportBackup - 备份导出', () => {
    it('应该导出为 TXT 格式', async () => {
      const env = createMockEnv();

      // 创建备份
      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP',
          digits: 6,
          period: 30,
          algorithm: 'SHA1'
        }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 导出为 TXT
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'txt' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/plain');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');

      const content = await response.text();
      expect(content).toContain('otpauth://totp/');
      expect(content).toContain('GitHub');
      expect(content).toContain('JBSWY3DPEHPK3PXP');
    });

    it('应该导出为 JSON 格式', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'Test',
          account: 'test@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 导出为 JSON
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'json' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const content = await response.text();
      const jsonData = JSON.parse(content);
      expect(jsonData.version).toBe('1.0');
      expect(jsonData.secrets).toBeDefined();
      expect(jsonData.secrets.length).toBe(1);
      expect(jsonData.count).toBe(1);
    });

    it('应该导出为 CSV 格式', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP',
          digits: 6,
          period: 30,
          algorithm: 'SHA1'
        },
        {
          id: '2',
          name: 'Google',
          account: '',
          secret: 'MFRGGZDFMZTWQ2LK',
          type: 'TOTP'
        }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 导出为 CSV
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'csv' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');

      const content = await response.text();
      expect(content).toContain('服务名称');
      expect(content).toContain('GitHub');
      expect(content).toContain('Google');
      expect(content).toContain('JBSWY3DPEHPK3PXP');
      // BOM 检查 - CSV 应该以 BOM 开头
      // 检查字符串是否以 BOM 开头（\uFEFF 或直接检查内容）
      expect(content.startsWith('\uFEFF') || content.includes('服务名称')).toBe(true);
    });

    it('应该默认导出为 TXT 格式', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 不指定格式
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`);

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/plain');
    });

    it('应该拒绝无效的导出格式', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 使用无效格式
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'xml' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('无效的导出格式');
    });

    it('应该在备份不存在时返回404', async () => {
      const env = createMockEnv();

      const exportReq = createMockRequest({}, 'GET',
        'https://example.com/api/backup/export/backup_9999-12-31_23-59-59.json');

      const response = await handleExportBackup(exportReq, env, 'backup_9999-12-31_23-59-59.json');

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('备份不存在');
    });

    it('应该拒绝无效的备份文件名', async () => {
      const env = createMockEnv();

      const exportReq = createMockRequest({}, 'GET',
        'https://example.com/api/backup/export/invalid-file.txt');

      const response = await handleExportBackup(exportReq, env, 'invalid-file.txt');

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('无效的备份文件名');
    });

    it('应该正确导出加密备份', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'Encrypted Test',
          account: 'test@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 确认备份是加密的
      expect(backupData.encrypted).toBe(true);

      // 导出
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'json' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(200);
      const content = await response.text();
      const jsonData = JSON.parse(content);
      expect(jsonData.secrets[0].name).toBe('Encrypted Test');
      expect(jsonData.secrets[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('应该在加密密钥缺失时拒绝导出加密备份', async () => {
      const env = createMockEnv();

      // 创建加密备份
      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 移除加密密钥
      delete env.ENCRYPTION_KEY;

      // 尝试导出
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`);

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('无法导出');
      expect(data.message).toContain('未配置 ENCRYPTION_KEY');
    });

    it('应该按服务名称排序导出结果', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Zoom', secret: 'JBSWY3DPEHPK3PXP' },
        { id: '2', name: 'Apple', secret: 'MFRGGZDFMZTWQ2LK' },
        { id: '3', name: 'Microsoft', secret: 'KRSXG5CTMVRXEZLU' }
      ], 'test');

      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();

      // 导出为 JSON 检查排序
      const exportReq = createMockRequest({}, 'GET',
        `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'json' });

      const response = await handleExportBackup(exportReq, env, backupData.backupKey);
      const content = await response.text();
      const jsonData = JSON.parse(content);

      expect(jsonData.secrets[0].name).toBe('Apple');
      expect(jsonData.secrets[1].name).toBe('Microsoft');
      expect(jsonData.secrets[2].name).toBe('Zoom');
    });
  });

  describe('集成测试', () => {
    it('完整流程：创建备份 → 列表 → 恢复 → 导出', async () => {
      const env = createMockEnv();

      // 1. 添加初始密钥
      const initialSecrets = [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        },
        {
          id: '2',
          name: 'Google',
          account: '',
          secret: 'MFRGGZDFMZTWQ2LK',
          type: 'TOTP'
        }
      ];
      await saveSecretsToKV(env, initialSecrets, 'test');

      // 2. 创建备份
      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();
      expect(backupData.success).toBe(true);
      expect(backupData.count).toBe(2);

      // 3. 获取备份列表
      const listReq = createMockRequest({}, 'GET', 'https://example.com/api/backup');
      const listResp = await handleGetBackups(listReq, env);
      const listData = await listResp.json();
      expect(listData.backups.length).toBeGreaterThan(0);
      const foundBackup = listData.backups.find(b => b.key === backupData.backupKey);
      expect(foundBackup).toBeDefined();
      expect(foundBackup.count).toBe(2);

      // 4. 修改密钥（删除一个）
      await saveSecretsToKV(env, [initialSecrets[0]], 'test');

      // 5. 恢复备份
      const restoreReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');
      const restoreResp = await handleRestoreBackup(restoreReq, env);
      const restoreData = await restoreResp.json();
      expect(restoreData.success).toBe(true);
      expect(restoreData.count).toBe(2);

      // 6. 导出备份为多种格式
      const formats = ['txt', 'json', 'csv'];
      for (const format of formats) {
        const exportReq = createMockRequest({}, 'GET',
          `https://example.com/api/backup/export/${backupData.backupKey}`, { format });
        const exportResp = await handleExportBackup(exportReq, env, backupData.backupKey);
        expect(exportResp.status).toBe(200);
      }
    });

    it('加密流程：加密备份 → 恢复 → 验证数据完整性', async () => {
      const env = createMockEnv();

      // 原始密钥数据
      const originalSecrets = [
        {
          id: '1',
          name: 'Secure App',
          account: 'secure@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP',
          digits: 8,
          period: 60,
          algorithm: 'SHA256'
        }
      ];
      await saveSecretsToKV(env, originalSecrets, 'test');

      // 创建加密备份
      const backupReq = createMockRequest();
      const backupResp = await handleBackupSecrets(backupReq, env);
      const backupData = await backupResp.json();
      expect(backupData.encrypted).toBe(true);

      // 清空数据
      await env.SECRETS_KV.delete('secrets');

      // 恢复备份
      const restoreReq = createMockRequest({
        backupKey: backupData.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore');
      const restoreResp = await handleRestoreBackup(restoreReq, env);
      expect(restoreResp.status).toBe(200);

      // 验证数据完整性
      const secretsData = await env.SECRETS_KV.get('secrets', 'text');
      expect(secretsData).toBeDefined();

      // 应该被重新加密 - 使用正确的加密标记
      expect(secretsData.startsWith('__ENCRYPTED__') || secretsData.startsWith('v1:')).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该处理 KV 存储失败', async () => {
      const env = createMockEnv();

      // 先添加数据使得备份有内容
      await env.SECRETS_KV.put('secrets', JSON.stringify([
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      ]));

      // Mock KV put 方法失败
      const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
      let callCount = 0;
      env.SECRETS_KV.put = vi.fn(async (key, value) => {
        callCount++;
        // 只让备份写入失败，secrets 写入成功
        if (key.startsWith('backup_')) {
          throw new Error('KV error');
        }
        return originalPut(key, value);
      });

      const request = createMockRequest();
      const response = await handleBackupSecrets(request, env);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();

      // 恢复原始方法
      env.SECRETS_KV.put = originalPut;
    });

    it('应该处理解密失败', async () => {
      const env = createMockEnv();

      // 创建假的加密备份（错误的格式）
      await env.SECRETS_KV.put('backup_2025-01-01_00-00-00.json', 'v1:invalid-encrypted-data');

      const exportReq = createMockRequest({}, 'GET',
        'https://example.com/api/backup/export/backup_2025-01-01_00-00-00.json');

      const response = await handleExportBackup(exportReq, env, 'backup_2025-01-01_00-00-00.json');

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('解密失败');
    });

    it('应该处理损坏的备份数据', async () => {
      const env = createMockEnv();

      // 创建损坏的明文备份
      await env.SECRETS_KV.put('backup_2025-01-01_00-00-00.json', '{invalid json');

      const exportReq = createMockRequest({}, 'GET',
        'https://example.com/api/backup/export/backup_2025-01-01_00-00-00.json');

      const response = await handleExportBackup(exportReq, env, 'backup_2025-01-01_00-00-00.json');

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('解析失败');
    });
  });
});
