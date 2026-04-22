/**
 * Backup API 模块集成测试
 * 测试备份创建、列表、恢复、导出功能
 * 目标覆盖率: 70%+
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../src/worker.js';
import {
  handleBackupSecrets,
  handleGetBackups
} from '../../src/api/secrets/backup.js';
import {
  handleRestoreBackup,
  handleExportBackup
} from '../../src/api/secrets/restore.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';
import { encryptSecrets } from '../../src/utils/encryption.js';
import { createBackupEntry } from '../../src/utils/backup-format.js';
import { buildBackupIndexMetadata, createBackupIndexKey, ensureBackupIndexes, putBackupRecord } from '../../src/utils/backup-index.js';

// ==================== Mock 模块 ====================

// Mock KV 存储
class MockKV {
  constructor() {
    this.store = new Map();
    this.metadata = new Map();
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
    this.metadata.set(key, options.metadata || null);
  }

  async delete(key) {
    this.store.delete(key);
    this.metadata.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys()).sort();
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
        metadata: this.metadata.get(name) || { created: new Date().toISOString() }
      })),
      list_complete: startIndex + limit >= filteredKeys.length,
      cursor: (startIndex + limit < filteredKeys.length) ? String(startIndex + limit) : undefined
    };
  }

  clear() {
    this.store.clear();
    this.metadata.clear();
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

function waitForTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(predicate, maxTicks = 20) {
  for (let attempt = 0; attempt < maxTicks; attempt += 1) {
    if (predicate()) {
      return;
    }
    await waitForTick();
  }

  throw new Error('Condition was not met in time');
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
      expect(data.backupKey).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}-[a-z0-9]{4}\.json$/);
      expect(data.count).toBe(1);
      expect(data.encrypted).toBe(true);
      expect(data.format).toBe('json');
    });

    it('索引状态写入失败时仍应保留备份并通过列表接口可见', async () => {
      const env = createMockEnv();
      const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);

      await originalPut('backup_index_state_v1', JSON.stringify({ version: 2, count: 0 }));
      await originalPut('secrets', await encryptSecrets([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], env));

      env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
        if (key === 'backup_index_state_v1') {
          throw new Error('state write failed');
        }
        return originalPut(key, value, options);
      });

      const response = await handleBackupSecrets(createMockRequest(), env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(await env.SECRETS_KV.get(data.backupKey, 'text')).toBeTruthy();
      expect(await env.SECRETS_KV.get('backup_index_state_v1', 'text')).toBeNull();

      const listResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup'),
        env
      );
      const listData = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listData.backups.map((backup) => backup.key)).toContain(data.backupKey);
    });

    it('应按设置使用 txt 作为手动备份格式', async () => {
      const env = createMockEnv();
      await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'txt' }));

      await env.SECRETS_KV.put('secrets', await encryptSecrets([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], env));

      const response = await handleBackupSecrets(createMockRequest(), env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.format).toBe('txt');
      expect(data.backupKey).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}-[a-z0-9]{4}\.txt$/);

      const stored = await env.SECRETS_KV.get(data.backupKey, 'text');
      expect(stored.startsWith('v1:')).toBe(true);
    });

    it('应按设置使用 csv 作为手动备份格式并在列表中返回格式', async () => {
      const env = createMockEnv();
      await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'csv' }));

      await env.SECRETS_KV.put('secrets', await encryptSecrets([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], env));

      const backupResp = await handleBackupSecrets(createMockRequest(), env);
      const backupData = await backupResp.json();
      const listResp = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
      const listData = await listResp.json();
      const found = listData.backups.find(item => item.key === backupData.backupKey);

      expect(backupData.format).toBe('csv');
      expect(backupData.backupKey.endsWith('.csv')).toBe(true);
      expect(found.format).toBe('csv');
      expect(found.count).toBe(1);
    });

    it('应按设置使用 html 作为手动备份格式并可恢复', async () => {
      const env = createMockEnv();
      await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'html' }));

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const backupResp = await handleBackupSecrets(createMockRequest(), env);
      const backupData = await backupResp.json();

      const restoreResp = await handleRestoreBackup(createMockRequest({
        backupKey: backupData.backupKey,
        preview: true
      }), env);
      const restoreData = await restoreResp.json();

      expect(backupData.format).toBe('html');
      expect(backupData.backupKey.endsWith('.html')).toBe(true);
      expect(restoreResp.status).toBe(200);
      expect(restoreData.data.count).toBe(1);
      expect(restoreData.data.format).toBe('html');
    });

    it('应在 html 手动备份文件中嵌入二维码图片', async () => {
      const env = createMockEnv();
      delete env.ENCRYPTION_KEY;
      await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'html' }));

      await saveSecretsToKV(env, [
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], 'test');

      const backupResp = await handleBackupSecrets(createMockRequest(), env);
      const backupData = await backupResp.json();
      const stored = await env.SECRETS_KV.get(backupData.backupKey, 'text');
      const exportResp = await handleExportBackup(
        createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'html' }),
        env,
        backupData.backupKey
      );
      const exportContent = await exportResp.text();

      expect(backupResp.status).toBe(200);
      expect(backupData.backupKey.endsWith('.html')).toBe(true);
      expect(stored).toContain('<img src="data:image/svg+xml;base64,');
      expect(stored).toContain('__2fa_backup_data__');
      expect(exportResp.status).toBe(200);
      expect(exportContent).toContain('<img src="data:image/svg+xml;base64,');
      expect(exportContent).toContain('__2fa_backup_data__');
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

    it('应该在检测到无效密钥条目时阻止生成备份', async () => {
      const env = createMockEnv();

      await env.SECRETS_KV.put('secrets', await encryptSecrets([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        },
        {
          id: '2',
          name: 'Broken entry',
          account: 'broken@example.com',
          secret: '   ',
          type: 'TOTP'
        }
      ], env));

      const response = await handleBackupSecrets(createMockRequest(), env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('备份数据无效');
      expect(data.message).toContain('备份包含无效密钥');
      expect(Array.from(env.SECRETS_KV.store.keys()).filter((key) => key.startsWith('backup_'))).toHaveLength(0);
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
      expect(data.format).toBe('json');

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

    it('应该通过 ctx.waitUntil 托管 WebDAV 推送', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }
      ], 'test');

      // 配置 WebDAV（触发推送路径）
      await env.SECRETS_KV.put('webdav_config', JSON.stringify({
        url: 'https://dav.example.com',
        username: 'user',
        password: 'pass',
        path: '/'
      }));

      const ctx = { waitUntil: vi.fn() };
      const request = createMockRequest();
      const response = await handleBackupSecrets(request, env, ctx);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(4); // WebDAV + S3 + OneDrive + Google Drive 推送
      // waitUntil 接收的应该是一个 Promise
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('没有 ctx 时 WebDAV 推送不应报错', async () => {
      const env = createMockEnv();

      await saveSecretsToKV(env, [
        { id: '1', name: 'Test', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }
      ], 'test');

      await env.SECRETS_KV.put('webdav_config', JSON.stringify({
        url: 'https://dav.example.com',
        username: 'user',
        password: 'pass',
        path: '/'
      }));

      const request = createMockRequest();
      // 不传 ctx，验证不会抛异常
      const response = await handleBackupSecrets(request, env);
      const data = await response.json();

      expect(data.success).toBe(true);
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

    it('应优先使用 metadata 返回备份详情而不回读正文', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-16_00-00-00-000-large.html';
      const backupContent = '<!DOCTYPE html><html><body>large backup payload</body></html>';
      await env.SECRETS_KV.put(backupKey, backupContent, {
        metadata: {
          created: '2026-04-16T00:00:00.000Z',
          format: 'html',
          count: 250,
          encrypted: false,
          skippedInvalidCount: 0,
          size: 1024 * 1024,
          version: 2
        }
      });

      const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
      const getSpy = vi.fn((...args) => originalGet(...args));
      env.SECRETS_KV.get = getSpy;

      const response = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups).toHaveLength(1);
      expect(data.backups[0]).toMatchObject({
        key: backupKey,
        format: 'html',
        count: 250,
        encrypted: false,
        partial: false,
        size: 1024 * 1024
      });
      expect(getSpy.mock.calls.filter(([key]) => key === backupKey)).toHaveLength(0);
    });

    it('应对新创建的完整备份直接使用 metadata 而不回读正文', async () => {
      const env = createMockEnv();
      const entry = await createBackupEntry([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        }
      ], env, {
        format: 'json',
        reason: 'manual',
        strict: true
      });

      await env.SECRETS_KV.put(entry.backupKey, entry.backupContent, {
        metadata: entry.metadata
      });

      const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
      const getSpy = vi.fn((...args) => originalGet(...args));
      env.SECRETS_KV.get = getSpy;

      const response = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups).toHaveLength(1);
      expect(data.backups[0]).toMatchObject({
        key: entry.backupKey,
        format: 'json',
        count: 1,
        encrypted: true,
        partial: false,
        skippedInvalidCount: 0
      });
      expect(getSpy.mock.calls.filter(([key]) => key === entry.backupKey)).toHaveLength(0);
    });

    it('应在列表中识别 metadata 丢失后的 HTML 不完整备份', async () => {
      const env = createMockEnv();
      const entry = await createBackupEntry([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        },
        {
          id: '2',
          name: 'Broken',
          account: 'broken@example.com',
          secret: '   ',
          type: 'TOTP'
        }
      ], {}, {
        format: 'html',
        reason: 'scheduled',
        strict: false
      });
      const damagedHtml = String(entry.backupContent)
        .replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '')
        .replace(/<meta[^>]*name="2fa-backup-meta"[^>]*>/i, '')
        .replace(/\sdata-skipped-invalid-count="\d+"/gi, '')
        .replace(/<p class="partial-warning">[\s\S]*?<\/p>/i, '')
        .replace('</tbody>', '<tr><td>Broken</td><td></td><td></td></tr></tbody>');
      const metadataWithoutPartial = { ...entry.metadata };
      delete metadataWithoutPartial.skippedInvalidCount;

      await env.SECRETS_KV.put(entry.backupKey, damagedHtml, {
        metadata: metadataWithoutPartial
      });

      const response = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups).toHaveLength(1);
      expect(data.backups[0]).toMatchObject({
        key: entry.backupKey,
        format: 'html',
        count: 1,
        partial: true,
        skippedInvalidCount: 1
      });
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

    it('应该在分页模式下按最新优先返回备份', async () => {
      const env = createMockEnv();
      const backupKeys = [
        'backup_2026-04-14_00-00-00-000-a.json',
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-16_00-00-00-000-c.json',
        'backup_2026-04-17_00-00-00-000-d.json'
      ];

      for (const [index, backupKey] of backupKeys.entries()) {
        await env.SECRETS_KV.put(
          backupKey,
          JSON.stringify({
            timestamp: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
            version: '1.0',
            count: 1,
            secrets: [{ id: String(index + 1), name: `Test${index + 1}`, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          {
            metadata: {
              created: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
              count: 1,
              encrypted: false,
              format: 'json',
              version: 2
            }
          }
        );
      }

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(firstPageData.pagination.cursor).toBeTruthy();
      expect(firstPageData.pagination.hasMore).toBe(true);

      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: firstPageData.pagination.cursor
        }),
        env
      );
      const secondPageData = await secondPageResponse.json();

      expect(secondPageResponse.status).toBe(200);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-14_00-00-00-000-a.json'
      ]);
      expect(secondPageData.pagination.cursor).toBeNull();
      expect(secondPageData.pagination.hasMore).toBe(false);
    });
    it('应在毫秒级时间差下保持最新备份优先，并忽略旧索引状态键', async () => {
      const env = createMockEnv();

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 1 }));
      await env.SECRETS_KV.put(
        'backup_2026-04-16_00-00-00-000-a.json',
        JSON.stringify({
          timestamp: '2026-04-16T00:00:00.000Z',
          version: '1.0',
          count: 1,
          secrets: [{ id: '1', name: 'Older', secret: 'JBSWY3DPEHPK3PXP' }]
        }),
        {
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2
          }
        }
      );
      await env.SECRETS_KV.put(
        'backup_2026-04-16_00-00-00-001-b.json',
        JSON.stringify({
          timestamp: '2026-04-16T00:00:00.001Z',
          version: '1.0',
          count: 1,
          secrets: [{ id: '2', name: 'Newer', secret: 'MFRGGZDFMZTWQ2LK' }]
        }),
        {
          metadata: {
            created: '2026-04-16T00:00:00.001Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2
          }
        }
      );

      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '10' }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-16_00-00-00-001-b.json',
        'backup_2026-04-16_00-00-00-000-a.json'
      ]);
      expect(data.backups.some((backup) => backup.key === 'backup_index_state_v1')).toBe(false);
    });

    it('应该在翻页期间有新备份写入时避免重复上一页结果', async () => {
      const env = createMockEnv();
      const seedKeys = [
        'backup_2026-04-14_00-00-00-000-a.json',
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-16_00-00-00-000-c.json',
        'backup_2026-04-17_00-00-00-000-d.json'
      ];

      for (const [index, backupKey] of seedKeys.entries()) {
        await env.SECRETS_KV.put(
          backupKey,
          JSON.stringify({
            timestamp: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
            version: '1.0',
            count: 1,
            secrets: [{ id: String(index + 1), name: `Test${index + 1}`, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          {
            metadata: {
              created: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
              count: 1,
              encrypted: false,
              format: 'json',
              version: 2
            }
          }
        );
      }

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      await env.SECRETS_KV.put(
        'backup_2026-04-18_00-00-00-000-new.json',
        JSON.stringify({
          timestamp: '2026-04-18T00:00:00.000Z',
          version: '1.0',
          count: 1,
          secrets: [{ id: '5', name: 'Newest', secret: 'MFRGGZDFMZTWQ2LK' }]
        }),
        {
          metadata: {
            created: '2026-04-18T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2
          }
        }
      );

      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: firstPageData.pagination.cursor
        }),
        env
      );
      const secondPageData = await secondPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(secondPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-14_00-00-00-000-a.json'
      ]);
      expect(secondPageData.backups.some((backup) => backup.key === 'backup_2026-04-16_00-00-00-000-c.json')).toBe(false);
    });

    it('应在完成首次索引回填后按页直接读取索引而不是再次全量扫描备份键', async () => {
      const env = createMockEnv();
      const backupKeys = [
        'backup_2026-04-14_00-00-00-000-a.json',
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-16_00-00-00-000-c.json',
        'backup_2026-04-17_00-00-00-000-d.json'
      ];

      for (const [index, backupKey] of backupKeys.entries()) {
        await env.SECRETS_KV.put(
          backupKey,
          JSON.stringify({
            timestamp: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
            version: '1.0',
            count: 1,
            secrets: [{ id: String(index + 1), name: `Test${index + 1}`, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          {
            metadata: {
              created: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
              count: 1,
              encrypted: false,
              format: 'json',
              version: 2
            }
          }
        );
      }

      const ctx = { waitUntil: vi.fn() };

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env,
        ctx
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(firstPageData.pagination.cursor).toBe('backup_2026-04-16_00-00-00-000-c.json');
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('reads later pages from backup indexes when a current index already exists', async () => {
      const env = createMockEnv();
      const backupKeys = [
        'backup_2026-04-14_00-00-00-000-a.json',
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-16_00-00-00-000-c.json',
        'backup_2026-04-17_00-00-00-000-d.json'
      ];

      for (const [index, backupKey] of backupKeys.entries()) {
        const metadata = {
          created: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
          count: 1,
          encrypted: false,
          format: 'json',
          version: 2,
          skippedInvalidCount: 0
        };

        await env.SECRETS_KV.put(
          backupKey,
          JSON.stringify({
            timestamp: metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: String(index + 1), name: `Test${index + 1}`, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(backupKey, metadata), '', {
          metadata: buildBackupIndexMetadata(backupKey, metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupKeys.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const listSpy = vi.fn((options = {}) => originalList(options));
      env.SECRETS_KV.list = listSpy;

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(firstPageData.pagination.cursor).toBe('idx:2');

      listSpy.mockClear();

      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: firstPageData.pagination.cursor
        }),
        env
      );
      const secondPageData = await secondPageResponse.json();

      expect(secondPageResponse.status).toBe(200);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-14_00-00-00-000-a.json'
      ]);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(false);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backupidx_')).toBe(true);
    });

    it('falls back from an opaque indexed cursor without repeating the first page when the indexed page is incomplete', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-14_00-00-00-000-a.json',
          metadata: {
            created: '2026-04-14T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-15_00-00-00-000-b.json',
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        }
      ];

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(entry.key, entry.metadata), '', {
          metadata: buildBackupIndexMetadata(entry.key, entry.metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupEntries.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const opaqueCursor = 'opaque-page-2';
      const indexPages = [
        buildBackupIndexMetadata(backupEntries[3].key, backupEntries[3].metadata),
        buildBackupIndexMetadata(backupEntries[2].key, backupEntries[2].metadata),
        buildBackupIndexMetadata(backupEntries[1].key, backupEntries[1].metadata),
        buildBackupIndexMetadata(backupEntries[0].key, backupEntries[0].metadata)
      ].map((metadata) => ({
        name: createBackupIndexKey(metadata.backupKey, metadata),
        metadata
      }));

      env.SECRETS_KV.list = vi.fn(async (options = {}) => {
        if (options.prefix === 'backupidx_') {
          if (!options.cursor) {
            return {
              keys: indexPages.slice(0, 2),
              list_complete: false,
              cursor: opaqueCursor
            };
          }

          if (options.cursor === opaqueCursor) {
            return {
              keys: indexPages.slice(2, 3),
              list_complete: false,
              cursor: 'opaque-page-3'
            };
          }
        }

        return originalList(options);
      });

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[3].key,
        backupEntries[2].key
      ]);
      expect(firstPageData.pagination.cursor).toBe(`idx:2:${opaqueCursor}|${backupEntries[2].key}`);

      const ctx = { waitUntil: vi.fn() };
      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: firstPageData.pagination.cursor
        }),
        env,
        ctx
      );
      const secondPageData = await secondPageResponse.json();

      expect(secondPageResponse.status).toBe(200);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[1].key,
        backupEntries[0].key
      ]);
      expect(secondPageData.pagination.cursor).toBeNull();
      expect(env.SECRETS_KV.list.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(true);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('does not fall back from an opaque indexed cursor when the later page is complete for the remaining count', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-14_00-00-00-000-a.json',
          metadata: {
            created: '2026-04-14T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-15_00-00-00-000-b.json',
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        }
      ];

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(entry.key, entry.metadata), '', {
          metadata: buildBackupIndexMetadata(entry.key, entry.metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupEntries.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const opaqueCursor = 'opaque-page-2';
      const indexPages = [
        buildBackupIndexMetadata(backupEntries[2].key, backupEntries[2].metadata),
        buildBackupIndexMetadata(backupEntries[1].key, backupEntries[1].metadata),
        buildBackupIndexMetadata(backupEntries[0].key, backupEntries[0].metadata)
      ].map((metadata) => ({
        name: createBackupIndexKey(metadata.backupKey, metadata),
        metadata
      }));

      env.SECRETS_KV.list = vi.fn(async (options = {}) => {
        if (options.prefix === 'backupidx_') {
          if (!options.cursor) {
            return {
              keys: indexPages.slice(0, 2),
              list_complete: false,
              cursor: opaqueCursor
            };
          }

          if (options.cursor === opaqueCursor) {
            return {
              keys: indexPages.slice(2, 3),
              list_complete: true,
              cursor: undefined
            };
          }
        }

        return originalList(options);
      });

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2', details: 'false' }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[2].key,
        backupEntries[1].key
      ]);
      expect(firstPageData.pagination.cursor).toBe(`idx:2:${opaqueCursor}|${backupEntries[1].key}`);

      const ctx = { waitUntil: vi.fn() };
      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          details: 'false',
          cursor: firstPageData.pagination.cursor
        }),
        env,
        ctx
      );
      const secondPageData = await secondPageResponse.json();

      expect(secondPageResponse.status).toBe(200);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[0].key
      ]);
      expect(secondPageData.pagination.cursor).toBeNull();
      expect(env.SECRETS_KV.list.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(false);
      expect(ctx.waitUntil).not.toHaveBeenCalled();
    });

    it('falls back to the legacy raw backup cursor without repeating the first page', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-14_00-00-00-000-a.json',
          metadata: {
            created: '2026-04-14T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-15_00-00-00-000-b.json',
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        }
      ];

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(entry.key, entry.metadata), '', {
          metadata: buildBackupIndexMetadata(entry.key, entry.metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupEntries.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const legacyCursor = 'legacy-backup-page-2';
      env.SECRETS_KV.list = vi.fn(async (options = {}) => {
        if (options.prefix === 'backup_' && options.cursor === legacyCursor) {
          return {
            keys: [backupEntries[0], backupEntries[1]].map((entry) => ({
              name: entry.key,
              metadata: entry.metadata
            })),
            list_complete: true,
            cursor: undefined
          };
        }

        return originalList(options);
      });

      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: legacyCursor
        }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual([
        backupEntries[1].key,
        backupEntries[0].key
      ]);
      expect(data.pagination.cursor).toBeNull();
      expect(env.SECRETS_KV.list.mock.calls.some(([options]) => options && options.prefix === 'backupidx_')).toBe(false);
    });

    it('converts opaque legacy backup cursors into backup-key anchors for subsequent pages', async () => {
      const env = createMockEnv();
      const backupEntries = [
        'backup_2026-04-12_00-00-00-000-a.json',
        'backup_2026-04-13_00-00-00-000-b.json',
        'backup_2026-04-14_00-00-00-000-c.json',
        'backup_2026-04-15_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-e.json',
        'backup_2026-04-17_00-00-00-000-f.json'
      ].map((key, index) => ({
        key,
        metadata: {
          created: `2026-04-${String(12 + index).padStart(2, '0')}T00:00:00.000Z`,
          count: 1,
          encrypted: false,
          format: 'json',
          version: 2,
          skippedInvalidCount: 0
        }
      }));

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(entry.key, entry.metadata), '', {
          metadata: buildBackupIndexMetadata(entry.key, entry.metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupEntries.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const legacyCursor = 'legacy-backup-page-2';
      env.SECRETS_KV.list = vi.fn(async (options = {}) => {
        if (options.prefix === 'backup_' && options.cursor === legacyCursor) {
          return {
            keys: [backupEntries[2], backupEntries[3]].map((entry) => ({
              name: entry.key,
              metadata: entry.metadata
            })),
            list_complete: false,
            cursor: 'legacy-backup-page-3'
          };
        }

        return originalList(options);
      });

      const firstPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: legacyCursor
        }),
        env
      );
      const firstPageData = await firstPageResponse.json();

      expect(firstPageResponse.status).toBe(200);
      expect(firstPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[3].key,
        backupEntries[2].key
      ]);
      expect(firstPageData.pagination.cursor).toBe(backupEntries[2].key);

      const secondPageResponse = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', {
          limit: '2',
          cursor: firstPageData.pagination.cursor
        }),
        env
      );
      const secondPageData = await secondPageResponse.json();

      expect(secondPageResponse.status).toBe(200);
      expect(secondPageData.backups.map((backup) => backup.key)).toEqual([
        backupEntries[1].key,
        backupEntries[0].key
      ]);
      expect(secondPageData.pagination.cursor).toBeNull();
    });

    it('reads the first indexed page without rescanning all backup keys when the index count is current', async () => {
      const env = createMockEnv();
      const backupKeys = [
        'backup_2026-04-14_00-00-00-000-a.json',
        'backup_2026-04-15_00-00-00-000-b.json',
        'backup_2026-04-16_00-00-00-000-c.json',
        'backup_2026-04-17_00-00-00-000-d.json'
      ];

      for (const [index, backupKey] of backupKeys.entries()) {
        const metadata = {
          created: `2026-04-${String(14 + index).padStart(2, '0')}T00:00:00.000Z`,
          count: 1,
          encrypted: false,
          format: 'json',
          version: 2,
          skippedInvalidCount: 0
        };

        await env.SECRETS_KV.put(
          backupKey,
          JSON.stringify({
            timestamp: metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: String(index + 1), name: `Test${index + 1}`, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata }
        );
        await env.SECRETS_KV.put(createBackupIndexKey(backupKey, metadata), '', {
          metadata: buildBackupIndexMetadata(backupKey, metadata)
        });
      }

      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupKeys.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const listSpy = vi.fn((options = {}) => originalList(options));
      env.SECRETS_KV.list = listSpy;

      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '2' }),
        env
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(false);
      expect(listSpy.mock.calls.filter(([options]) => options && options.prefix === 'backupidx_')).toHaveLength(1);
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

      // 绠€鍗曟ā寮忎笉搴旇鍖呭惈 count 鍜?encrypted
      const backup = data.backups[0];
      expect(backup.key).toBeDefined();
      expect(backup.created).toBeDefined();
      expect(backup.count).toBeUndefined();
      expect(backup.encrypted).toBeUndefined();
    });

    it('falls back to scanning backup keys when the index state is current but index entries are missing', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-17_00-00-00-000-d.json';
      const metadata = {
        created: '2026-04-17T00:00:00.000Z',
        count: 1,
        encrypted: false,
        format: 'json',
        version: 2,
        skippedInvalidCount: 0
      };

      await env.SECRETS_KV.put(
        backupKey,
        JSON.stringify({
          timestamp: metadata.created,
          version: '1.0',
          count: 1,
          secrets: [{ id: '1', name: 'Test1', secret: 'JBSWY3DPEHPK3PXP' }]
        }),
        { metadata }
      );
      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: 1 }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const listSpy = vi.fn((options = {}) => originalList(options));
      env.SECRETS_KV.list = listSpy;

      const ctx = { waitUntil: vi.fn() };
      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup'),
        env,
        ctx
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups).toHaveLength(1);
      expect(data.backups[0]).toMatchObject({
        key: backupKey,
        format: 'json',
        count: 1,
        partial: false,
        skippedInvalidCount: 0
      });
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backupidx_')).toBe(true);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(true);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('falls back to scanning real backup keys when indexed entries point to deleted backups', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          },
          secretName: 'Newest'
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          },
          secretName: 'Still real'
        }
      ];
      const staleBackupKey = 'backup_2026-04-15_00-00-00-000-b.json';

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.secretName, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
      }

      await env.SECRETS_KV.put(
        createBackupIndexKey(backupEntries[0].key, backupEntries[0].metadata),
        '',
        {
          metadata: buildBackupIndexMetadata(backupEntries[0].key, backupEntries[0].metadata)
        }
      );
      await env.SECRETS_KV.put(
        createBackupIndexKey(staleBackupKey, {
          created: '2026-04-15T00:00:00.000Z',
          count: 1,
          encrypted: false,
          format: 'json',
          version: 2,
          skippedInvalidCount: 0
        }),
        '',
        {
          metadata: buildBackupIndexMetadata(staleBackupKey, {
            created: '2026-04-15T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          })
        }
      );
      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: 2 }));

      const ctx = { waitUntil: vi.fn() };
      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { details: 'false' }),
        env,
        ctx
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual(backupEntries.map((entry) => entry.key));
      expect(data.backups.some((backup) => backup.key === staleBackupKey)).toBe(false);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('falls back to real backup keys when a stale indexed entry appears beyond the first three results', async () => {
      const env = createMockEnv();
      const realBackupEntries = [
        {
          key: 'backup_2026-04-18_00-00-00-000-e.json',
          metadata: {
            created: '2026-04-18T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-14_00-00-00-000-a.json',
          metadata: {
            created: '2026-04-14T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        }
      ];
      const staleBackupKey = 'backup_2026-04-15_00-00-00-000-b.json';
      const staleMetadata = {
        created: '2026-04-15T00:00:00.000Z',
        count: 1,
        encrypted: false,
        format: 'json',
        version: 2,
        skippedInvalidCount: 0
      };

      for (const entry of realBackupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
      }

      for (const entry of [...realBackupEntries.slice(0, 3), { key: staleBackupKey, metadata: staleMetadata }, realBackupEntries[3]]) {
        await env.SECRETS_KV.put(createBackupIndexKey(entry.key, entry.metadata), '', {
          metadata: buildBackupIndexMetadata(entry.key, entry.metadata)
        });
      }
      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: 5 }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const listSpy = vi.fn((options = {}) => originalList(options));
      env.SECRETS_KV.list = listSpy;

      const ctx = { waitUntil: vi.fn() };
      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '5' }),
        env,
        ctx
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual(realBackupEntries.map((entry) => entry.key));
      expect(data.backups.some((backup) => backup.key === staleBackupKey)).toBe(false);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backupidx_')).toBe(true);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(true);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('falls back to scanning backup keys when only part of the current index exists', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2,
            skippedInvalidCount: 0
          }
        }
      ];

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
      }

      await env.SECRETS_KV.put(
        createBackupIndexKey(backupEntries[0].key, backupEntries[0].metadata),
        '',
        { metadata: buildBackupIndexMetadata(backupEntries[0].key, backupEntries[0].metadata) }
      );
      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: backupEntries.length }));

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      const listSpy = vi.fn((options = {}) => originalList(options));
      env.SECRETS_KV.list = listSpy;

      const ctx = { waitUntil: vi.fn() };
      const response = await handleGetBackups(
        createMockRequest({}, 'GET', 'https://example.com/api/backup', { limit: '10' }),
        env,
        ctx
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.backups.map((backup) => backup.key)).toEqual([
        'backup_2026-04-17_00-00-00-000-d.json',
        'backup_2026-04-16_00-00-00-000-c.json'
      ]);
      expect(data.pagination.cursor).toBeNull();
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backupidx_')).toBe(true);
      expect(listSpy.mock.calls.some(([options]) => options && options.prefix === 'backup_')).toBe(true);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it('deduplicates concurrent backup index rebuilds', async () => {
      const env = createMockEnv();
      const backupEntries = [
        {
          key: 'backup_2026-04-17_00-00-00-000-d.json',
          metadata: {
            created: '2026-04-17T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2
          }
        },
        {
          key: 'backup_2026-04-16_00-00-00-000-c.json',
          metadata: {
            created: '2026-04-16T00:00:00.000Z',
            count: 1,
            encrypted: false,
            format: 'json',
            version: 2
          }
        }
      ];

      for (const entry of backupEntries) {
        await env.SECRETS_KV.put(
          entry.key,
          JSON.stringify({
            timestamp: entry.metadata.created,
            version: '1.0',
            count: 1,
            secrets: [{ id: entry.key, name: entry.key, secret: 'JBSWY3DPEHPK3PXP' }]
          }),
          { metadata: entry.metadata }
        );
      }

      const originalList = env.SECRETS_KV.list.bind(env.SECRETS_KV);
      let releaseIndexList;
      let firstIndexListPending = true;
      env.SECRETS_KV.list = vi.fn(async (options = {}) => {
        if (firstIndexListPending && options.prefix === 'backupidx_') {
          firstIndexListPending = false;
          await new Promise((resolve) => {
            releaseIndexList = resolve;
          });
        }

        return originalList(options);
      });

      const firstRun = ensureBackupIndexes(env, { force: true });
      const secondRun = ensureBackupIndexes(env, { force: true });

      await waitForCondition(() => env.SECRETS_KV.list.mock.calls.length > 0);
      expect(env.SECRETS_KV.list.mock.calls.filter(([options]) => options.prefix === 'backupidx_')).toHaveLength(1);

      releaseIndexList();
      await Promise.all([firstRun, secondRun]);

      expect(env.SECRETS_KV.list.mock.calls.filter(([options]) => options.prefix === 'backupidx_')).toHaveLength(1);
      expect(env.SECRETS_KV.list.mock.calls.filter(([options]) => options.prefix === 'backup_')).toHaveLength(1);
    });

    it('keeps the backup index count accurate when multiple writes commit concurrently', async () => {
      const env = createMockEnv();
      await env.SECRETS_KV.put('backup_index_state_v1', JSON.stringify({ version: 2, count: 0 }));

      const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
      const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);

      env.SECRETS_KV.get = vi.fn(async (key, type = 'text') => {
        if (key === 'backup_index_state_v1') {
          await waitForTick();
        }
        return originalGet(key, type);
      });

      env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
        if (key === 'backup_index_state_v1') {
          await waitForTick();
        }
        return originalPut(key, value, options);
      });

      await Promise.all([
        putBackupRecord(env, 'backup_2026-04-17_00-00-00-000-a.json', '{"count":1}', {
          created: '2026-04-17T00:00:00.000Z',
          count: 1,
          format: 'json',
          encrypted: false,
          skippedInvalidCount: 0
        }),
        putBackupRecord(env, 'backup_2026-04-17_00-00-00-001-b.json', '{"count":1}', {
          created: '2026-04-17T00:00:00.001Z',
          count: 1,
          format: 'json',
          encrypted: false,
          skippedInvalidCount: 0
        })
      ]);

      const indexState = JSON.parse(await originalGet('backup_index_state_v1', 'text'));
      expect(indexState.count).toBe(2);
    });

    it('keeps details=false responses lean after index fallback checks', async () => {
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

    it('应该正确恢复 txt 备份中包含冒号的服务名称', async () => {
      const env = createMockEnv();
      const backupEntry = await createBackupEntry(
        [
          {
            id: '1',
            name: 'Foo:Bar',
            account: 'alice',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP'
          }
        ],
        env,
        {
          format: 'txt',
          reason: 'test',
          strict: true
        }
      );
      await env.SECRETS_KV.put(backupEntry.backupKey, backupEntry.backupContent, {
        metadata: backupEntry.metadata
      });

      const previewResp = await handleRestoreBackup(createMockRequest({
        backupKey: backupEntry.backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResp.json();

      expect(previewResp.status).toBe(200);
      expect(previewData.data.format).toBe('txt');
      expect(previewData.data.secrets).toHaveLength(1);
      expect(previewData.data.secrets[0].name).toBe('Foo:Bar');
      expect(previewData.data.secrets[0].account).toBe('alice');
    });

    it('应该正确恢复 csv 备份中的多行字段而不清空现有数据', async () => {
      const env = createMockEnv();
      const backupEntry = await createBackupEntry(
        [
          {
            id: '1',
            name: 'Foo',
            account: 'alice\nops',
            secret: 'JBSWY3DPEHPK3PXP',
            type: 'TOTP'
          }
        ],
        env,
        {
          format: 'csv',
          reason: 'test',
          strict: true
        }
      );
      await env.SECRETS_KV.put(backupEntry.backupKey, backupEntry.backupContent, {
        metadata: backupEntry.metadata
      });

      const previewResp = await handleRestoreBackup(createMockRequest({
        backupKey: backupEntry.backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResp.json();

      expect(previewResp.status).toBe(200);
      expect(previewData.data.format).toBe('csv');
      expect(previewData.data.secrets).toHaveLength(1);
      expect(previewData.data.secrets[0].account).toBe('alice\nops');

      await saveSecretsToKV(env, [
        { id: '2', name: 'Different', account: 'user@example.com', secret: 'MFRGGZDFMZTWQ2LK', type: 'TOTP' }
      ], 'test');

      const restoreResp = await handleRestoreBackup(createMockRequest({
        backupKey: backupEntry.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const restoreData = await restoreResp.json();
      const restoredSecrets = await getAllSecrets(env);

      expect(restoreResp.status).toBe(200);
      expect(restoreData.count).toBe(1);
      expect(restoredSecrets).toHaveLength(1);
      expect(restoredSecrets[0].name).toBe('Foo');
      expect(restoredSecrets[0].account).toBe('alice\nops');
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

    it('应该拒绝恢复空备份以避免覆盖当前数据', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-15_00-00-00-000-empty.json';

      await env.SECRETS_KV.put(
        backupKey,
        JSON.stringify({
          timestamp: '2026-04-15T00:00:00.000Z',
          version: '1.0',
          count: 0,
          secrets: []
        }),
        {
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            format: 'json',
            count: 0,
            encrypted: false,
            version: 2
          }
        }
      );

      const response = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('备份内容为空');
    });

    it('应该拒绝预览和恢复包含无效 TXT 条目的备份', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-15_00-00-00-000-invalid.txt';

      await saveSecretsToKV(env, [
        { id: 'current', name: 'Current', secret: 'MFRGGZDFMZTWQ2LK', type: 'TOTP' }
      ], 'test');

      await env.SECRETS_KV.put(
        backupKey,
        'otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub\nnot-a-valid-backup-line',
        {
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            format: 'txt',
            count: 2,
            encrypted: false,
            version: 2
          }
        }
      );

      const previewResp = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResp.json();

      expect(previewResp.status).toBe(400);
      expect(previewData.error).toContain('解析失败');

      const restoreResp = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const restoreData = await restoreResp.json();
      const secretsAfterFailure = await getAllSecrets(env);

      expect(restoreResp.status).toBe(400);
      expect(restoreData.error).toContain('解析失败');
      expect(secretsAfterFailure).toHaveLength(1);
      expect(secretsAfterFailure[0].name).toBe('Current');
    });

    it('应该在预览中标记不完整备份并阻止恢复', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-15_00-00-00-000-partial.json';

      await env.SECRETS_KV.put(
        backupKey,
        JSON.stringify({
          timestamp: '2026-04-15T00:00:00.000Z',
          version: '1.0',
          count: 1,
          secrets: [
            {
              id: '1',
              name: 'GitHub',
              account: 'user@example.com',
              secret: 'JBSWY3DPEHPK3PXP',
              type: 'TOTP'
            }
          ]
        }),
        {
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            format: 'json',
            count: 1,
            encrypted: false,
            version: 2,
            skippedInvalidCount: 1
          }
        }
      );

      const previewResp = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResp.json();

      expect(previewResp.status).toBe(200);
      expect(previewData.data.partial).toBe(true);
      expect(previewData.data.skippedInvalidCount).toBe(1);
      expect(previewData.data.warnings[0]).toContain('已跳过 1 条无效密钥');

      const restoreResp = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const restoreData = await restoreResp.json();

      expect(restoreResp.status).toBe(400);
      expect(restoreData.error).toContain('备份不完整');
    });

    it('should keep partial HTML backups blocked even when the embedded JSON is removed', async () => {
      const env = createMockEnv();
      const entry = await createBackupEntry([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        },
        {
          id: '2',
          name: 'Broken',
          account: 'broken@example.com',
          secret: '   ',
          type: 'TOTP'
        }
      ], {}, {
        format: 'html',
        reason: 'scheduled',
        strict: false
      });

      const damagedHtml = String(entry.backupContent)
        .replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '')
        .replace(/<meta[^>]*name="2fa-backup-meta"[^>]*>/i, '')
        .replace(/\sdata-skipped-invalid-count="\d+"/gi, '')
        .replace(/<p class="partial-warning">[\s\S]*?<\/p>/i, '')
        .replace('</tbody>', '<tr><td>Broken</td><td></td><td></td></tr></tbody>');
      const metadataWithoutPartial = { ...entry.metadata };
      delete metadataWithoutPartial.skippedInvalidCount;

      await env.SECRETS_KV.put(entry.backupKey, damagedHtml, {
        metadata: metadataWithoutPartial
      });

      const previewResp = await handleRestoreBackup(createMockRequest({
        backupKey: entry.backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResp.json();

      expect(previewResp.status).toBe(200);
      expect(previewData.data.format).toBe('html');
      expect(previewData.data.partial).toBe(true);
      expect(previewData.data.skippedInvalidCount).toBe(1);

      const restoreResp = await handleRestoreBackup(createMockRequest({
        backupKey: entry.backupKey,
        preview: false
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const restoreData = await restoreResp.json();

      expect(restoreResp.status).toBe(400);
      expect(restoreData.error).toContain('备份不完整');
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

    it('应该拒绝导出创建阶段已跳过无效密钥的不完整备份', async () => {
      const env = createMockEnv();
      const backupKey = 'backup_2026-04-15_00-00-00-000-partial.json';

      await env.SECRETS_KV.put(
        backupKey,
        JSON.stringify({
          timestamp: '2026-04-15T00:00:00.000Z',
          version: '1.0',
          count: 1,
          secrets: [
            {
              id: '1',
              name: 'GitHub',
              account: 'user@example.com',
              secret: 'JBSWY3DPEHPK3PXP',
              type: 'TOTP'
            }
          ]
        }),
        {
          metadata: {
            created: '2026-04-15T00:00:00.000Z',
            format: 'json',
            count: 1,
            encrypted: false,
            version: 2,
            skippedInvalidCount: 1
          }
        }
      );

      const exportResp = await handleExportBackup(
        createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupKey}`, { format: 'json' }),
        env,
        backupKey
      );
      const exportData = await exportResp.json();

      expect(exportResp.status).toBe(400);
      expect(exportData.error).toContain('备份不完整');
      expect(exportData.message).toContain('已跳过 1 条无效密钥');
    });

    it('should reject exporting partial HTML backups when only the portable metadata survives', async () => {
      const env = createMockEnv();
      const entry = await createBackupEntry([
        {
          id: '1',
          name: 'GitHub',
          account: 'user@example.com',
          secret: 'JBSWY3DPEHPK3PXP',
          type: 'TOTP'
        },
        {
          id: '2',
          name: 'Broken',
          account: 'broken@example.com',
          secret: '   ',
          type: 'TOTP'
        }
      ], {}, {
        format: 'html',
        reason: 'scheduled',
        strict: false
      });

      const damagedHtml = String(entry.backupContent)
        .replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '')
        .replace(/<meta[^>]*name="2fa-backup-meta"[^>]*>/i, '')
        .replace(/\sdata-skipped-invalid-count="\d+"/gi, '')
        .replace(/<p class="partial-warning">[\s\S]*?<\/p>/i, '')
        .replace('</tbody>', '<tr><td>Broken</td><td></td><td></td></tr></tbody>');
      const metadataWithoutPartial = { ...entry.metadata };
      delete metadataWithoutPartial.skippedInvalidCount;

      await env.SECRETS_KV.put(entry.backupKey, damagedHtml, {
        metadata: metadataWithoutPartial
      });

      const exportResp = await handleExportBackup(
        createMockRequest({}, 'GET', `https://example.com/api/backup/export/${entry.backupKey}`, { format: 'json' }),
        env,
        entry.backupKey
      );
      const exportData = await exportResp.json();

      expect(exportResp.status).toBe(400);
      expect(exportData.error).toContain('备份不完整');
      expect(exportData.message).toContain('已跳过 1 条无效密钥');
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
      const formats = ['txt', 'json', 'csv', 'html'];
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

describe('Backup auto-backup resilience', () => {
  it('keeps event-driven backups running when invalid secrets are present', async () => {
    const env = createMockEnv();

    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'GitHub',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      },
      {
        id: '2',
        name: 'Broken entry',
        account: 'broken@example.com',
        secret: '   ',
        type: 'TOTP'
      }
    ], 'test');

    const backupKeys = Array.from(env.SECRETS_KV.store.keys()).filter((key) => key.startsWith('backup_'));
    expect(backupKeys).toHaveLength(1);

    const backupKey = backupKeys[0];
    const metadata = env.SECRETS_KV.metadata.get(backupKey);
    expect(metadata.skippedInvalidCount).toBe(1);

    const previewResp = await handleRestoreBackup(createMockRequest({
      backupKey,
      preview: true
    }, 'POST', 'https://example.com/api/backup/restore'), env);
    const previewData = await previewResp.json();

    expect(previewResp.status).toBe(200);
    expect(previewData.data.count).toBe(1);
    expect(previewData.data.secrets[0].name).toBe('GitHub');
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();

    await worker.scheduled({ cron: '0 0 * * *' }, env, { waitUntil: vi.fn() });

    const backupKeysAfterScheduled = Array.from(env.SECRETS_KV.store.keys()).filter(
      (key) => key.startsWith('backup_') && key !== 'backup_index_state_v1'
    );
    expect(backupKeysAfterScheduled).toHaveLength(2);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();
  });

  it('waits for immediate backups even when a request context is available', async () => {
    const env = createMockEnv();
    const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
    let releaseBackupWrite;
    let backupWriteStarted = false;

    env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
      if (String(key).startsWith('backup_') && !String(key).startsWith('backupidx_')) {
        backupWriteStarted = true;
        await new Promise((resolve) => {
          releaseBackupWrite = resolve;
        });
      }

      return originalPut(key, value, options);
    });

    const ctx = { waitUntil: vi.fn() };
    let resolved = false;
    const savePromise = saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Immediate',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      }
    ], 'backup-restored', { immediate: true }, ctx).then(() => {
      resolved = true;
    });

    await waitForCondition(() => backupWriteStarted === true);

    expect(backupWriteStarted).toBe(true);
    expect(resolved).toBe(false);
    expect(ctx.waitUntil).not.toHaveBeenCalled();

    releaseBackupWrite();
    await savePromise;

    const backupKeys = Array.from(env.SECRETS_KV.store.keys()).filter((key) => key.startsWith('backup_'));
    expect(backupKeys).toHaveLength(1);
  });

  it('preserves queued immediate backups when a newer deferred backup arrives before the current write finishes', async () => {
    const env = createMockEnv();
    const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
    let releaseFirstBackupWrite;
    let backupWriteCount = 0;

    env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
      if (String(key).startsWith('backup_') && !String(key).startsWith('backupidx_')) {
        backupWriteCount += 1;
        if (backupWriteCount === 1) {
          await new Promise((resolve) => {
            releaseFirstBackupWrite = resolve;
          });
        }
      }

      return originalPut(key, value, options);
    });

    const firstCtx = { waitUntil: vi.fn() };
    const restoreCtx = { waitUntil: vi.fn() };
    const laterCtx = { waitUntil: vi.fn() };

    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Initial snapshot',
        account: 'initial@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      }
    ], 'secret-added', {}, firstCtx);

    await waitForCondition(() => typeof releaseFirstBackupWrite === 'function');

    const restorePromise = saveSecretsToKV(env, [
      {
        id: '2',
        name: 'Restored snapshot',
        account: 'restored@example.com',
        secret: 'NB2W45DFOIZA====',
        type: 'TOTP'
      }
    ], 'backup-restored', { immediate: true }, restoreCtx);

    await waitForTick();

    await saveSecretsToKV(env, [
      {
        id: '3',
        name: 'Later deferred snapshot',
        account: 'later@example.com',
        secret: 'ONSWG4TFOQ======',
        type: 'TOTP'
      }
    ], 'secret-added', {}, laterCtx);

    expect(restoreCtx.waitUntil).not.toHaveBeenCalled();
    expect(firstCtx.waitUntil).toHaveBeenCalledTimes(1);
    expect(laterCtx.waitUntil).toHaveBeenCalledTimes(1);

    releaseFirstBackupWrite();
    await Promise.all([
      firstCtx.waitUntil.mock.calls[0][0],
      restorePromise,
      laterCtx.waitUntil.mock.calls[0][0]
    ]);

    const backupKeys = Array.from(env.SECRETS_KV.store.keys())
      .filter((key) => key.startsWith('backup_'))
      .sort();

    expect(backupKeys).toHaveLength(3);

    const previewedBackupNames = [];
    for (const backupKey of backupKeys) {
      const previewResponse = await handleRestoreBackup(createMockRequest({
        backupKey,
        preview: true
      }, 'POST', 'https://example.com/api/backup/restore'), env);
      const previewData = await previewResponse.json();
      previewedBackupNames.push(previewData.data.secrets[0].name);
    }

    expect(previewedBackupNames).toHaveLength(3);
    expect(previewedBackupNames).toEqual(expect.arrayContaining([
      'Initial snapshot',
      'Restored snapshot',
      'Later deferred snapshot'
    ]));
  });

  it('does not update the backup hash before a deferred backup succeeds', async () => {
    const env = createMockEnv();
    const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
    let releaseBackupWrite;

    env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
      if (String(key).startsWith('backup_') && !String(key).startsWith('backupidx_')) {
        await new Promise((resolve) => {
          releaseBackupWrite = resolve;
        });
      }

      return originalPut(key, value, options);
    });

    const ctx = { waitUntil: vi.fn() };
    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Deferred',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      }
    ], 'secret-added', {}, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();

    await waitForCondition(() => typeof releaseBackupWrite === 'function');
    releaseBackupWrite();
    await ctx.waitUntil.mock.calls[0][0];

    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeTruthy();
  });

  it('does not treat a committed partial deferred backup as satisfying the pending backup hash', async () => {
    const env = createMockEnv();
    const ctx = { waitUntil: vi.fn() };

    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Valid deferred secret',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      },
      {
        id: '2',
        name: 'Broken deferred secret',
        account: 'broken@example.com',
        secret: '   ',
        type: 'TOTP'
      }
    ], 'secret-added', {}, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await ctx.waitUntil.mock.calls[0][0];

    const listBackupKeys = () => Array.from(env.SECRETS_KV.store.keys()).filter(
      (key) => key.startsWith('backup_') && key !== 'backup_index_state_v1'
    );

    expect(listBackupKeys()).toHaveLength(1);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();
    expect(await env.SECRETS_KV.get('pending_backup_hash')).toBeTruthy();

    await worker.scheduled({ cron: '0 0 * * *' }, env, { waitUntil: vi.fn() });

    expect(listBackupKeys()).toHaveLength(2);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();
  });

  it('creates a scheduled backup when a matching deferred backup is still pending but no backup has been committed yet', async () => {
    const env = createMockEnv();
    const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
    let releaseBackupWrite;
    let backupWriteCount = 0;

    env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
      if (String(key).startsWith('backup_') && !String(key).startsWith('backupidx_')) {
        backupWriteCount += 1;
        if (backupWriteCount === 1) {
          await new Promise((resolve) => {
            releaseBackupWrite = resolve;
          });
        }
      }

      return originalPut(key, value, options);
    });

    const eventCtx = { waitUntil: vi.fn() };
    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Pending event backup',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      }
    ], 'secret-added', {}, eventCtx);

    expect(eventCtx.waitUntil).toHaveBeenCalledTimes(1);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();
    await waitForCondition(() => typeof releaseBackupWrite === 'function');

    const cronCtx = { waitUntil: vi.fn() };
    await worker.scheduled({ cron: '0 0 * * *' }, env, cronCtx);

    expect(cronCtx.waitUntil).toHaveBeenCalled();
    expect(Array.from(env.SECRETS_KV.store.keys()).filter((key) => key.startsWith('backup_'))).toHaveLength(1);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeTruthy();

    releaseBackupWrite();
    await eventCtx.waitUntil.mock.calls[0][0];

    expect(Array.from(env.SECRETS_KV.store.keys()).filter((key) => key.startsWith('backup_'))).toHaveLength(2);
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeTruthy();
  });

  it('keeps the previous backup hash when a deferred backup fails', async () => {
    const env = createMockEnv();
    const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);

    env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
      if (String(key).startsWith('backup_') && !String(key).startsWith('backupidx_')) {
        throw new Error('backup write failed');
      }

      return originalPut(key, value, options);
    });

    const ctx = { waitUntil: vi.fn() };
    await saveSecretsToKV(env, [
      {
        id: '1',
        name: 'Failed backup',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP'
      }
    ], 'secret-added', {}, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await ctx.waitUntil.mock.calls[0][0];
    expect(await env.SECRETS_KV.get('last_backup_hash')).toBeNull();
  });
});

describe('Backup HTML export regression', () => {
  it('exports HTML backups through the export API', async () => {
    const env = createMockEnv();

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

    const exportReq = createMockRequest(
      {},
      'GET',
      `https://example.com/api/backup/export/${backupData.backupKey}`,
      { format: 'html' }
    );

    const response = await handleExportBackup(exportReq, env, backupData.backupKey);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');

    const content = await response.text();
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('GitHub');
    expect(content).toContain('二维码');
    expect(content).toContain('<img src="data:image/svg+xml;base64,');
    expect(content).toContain('__2fa_backup_data__');
  });
});
