/**
 * Backup 备份系统测试
 * 测试智能备份、防抖机制、加密、自动清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BackupManager,
  BACKUP_CONFIG,
  getBackupManager,
  triggerBackup,
  executeImmediateBackup,
  sanitizeMaxBackups
} from '../../src/utils/backup.js';

// ==================== Mock 模块 ====================

// Mock encryption
vi.mock('../../src/utils/encryption.js', () => ({
  encryptData: vi.fn(async (data, env) => {
    return JSON.stringify({ encrypted: true, data });
  })
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn((env) => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

// Mock monitoring
vi.mock('../../src/utils/monitoring.js', () => ({
  getMonitoring: vi.fn((env) => ({
    getPerformanceMonitor: () => ({
      recordMetric: vi.fn()
    }),
    getErrorMonitor: () => ({
      captureError: vi.fn()
    })
  }))
}));

// Mock webdav
vi.mock('../../src/utils/webdav.js', () => ({
  pushToAllWebDAV: vi.fn(async () => ({ success: true }))
}));

// ==================== Mock 工具 ====================

/**
 * 创建 Mock Environment
 */
function createMockEnv({ withEncryption = true } = {}) {
  return {
    SECRETS_KV: {
      get: vi.fn(async (key) => null),
      put: vi.fn(async (key, value) => {}),
      delete: vi.fn(async (key) => {}),
      list: vi.fn(async () => ({ keys: [] }))
    },
    ENCRYPTION_KEY: withEncryption ? 'test-encryption-key-32-bytes-base64' : undefined
  };
}

/**
 * 创建测试密钥数据
 */
function createTestSecrets(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `secret-${i + 1}`,
    name: `Test ${i + 1}`,
    secret: `JBSWY3DPEHPK3PXP${i}`
  }));
}

/**
 * 等待指定时间
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 测试套件 ====================

describe('Backup System', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('BACKUP_CONFIG', () => {
    it('应该有正确的配置值', () => {
      expect(BACKUP_CONFIG.MAX_BACKUPS).toBe(100);
      expect(BACKUP_CONFIG.AUTO_CLEANUP_ENABLED).toBe(true);
      expect(BACKUP_CONFIG.EVENT_DRIVEN_ENABLED).toBe(true);
      expect(BACKUP_CONFIG.SCHEDULED_BACKUP_ENABLED).toBe(true);
    });
  });

  describe('sanitizeMaxBackups', () => {
    it('合法整数应原样返回', () => {
      expect(sanitizeMaxBackups(0)).toBe(0);
      expect(sanitizeMaxBackups(50)).toBe(50);
      expect(sanitizeMaxBackups(1000)).toBe(1000);
    });

    it('负数应回退默认值', () => {
      expect(sanitizeMaxBackups(-1)).toBe(100);
    });

    it('超范围应回退默认值', () => {
      expect(sanitizeMaxBackups(1001)).toBe(100);
    });

    it('小数应回退默认值', () => {
      expect(sanitizeMaxBackups(3.5)).toBe(100);
    });

    it('非数字类型应回退默认值', () => {
      expect(sanitizeMaxBackups(null)).toBe(100);
      expect(sanitizeMaxBackups(undefined)).toBe(100);
      expect(sanitizeMaxBackups('50')).toBe(100);
      expect(sanitizeMaxBackups(NaN)).toBe(100);
    });
  });

  describe('BackupManager - 构造函数', () => {
    it('应该正确初始化', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      expect(manager.env).toBe(env);
      expect(manager.backupInProgress).toBe(false);
      expect(manager.pendingSecrets).toBeNull();
      expect(manager.pendingReason).toBeNull();
      expect(manager.logger).toBeDefined();
    });
  });

  describe('并发控制 - 队列机制', () => {
    it('首次触发应该立即执行', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      const result = await manager.triggerBackup(secrets, { reason: 'test' });

      expect(result.success).toBe(true);
    });

    it('备份进行中时应该暂存数据', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      manager.backupInProgress = true;

      const result = await manager.triggerBackup(secrets, { reason: 'test' });

      expect(result).toMatchObject({ queued: true });
      expect(manager.pendingSecrets).toEqual(secrets);
    });

    it('暂存数据应该在备份完成后执行', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets1 = createTestSecrets(1);
      const secrets2 = createTestSecrets(2);

      // Spy on executeBackup
      const executeSpy = vi.spyOn(manager, 'executeBackup');

      // Start first backup; while it runs, queue a second
      const firstPromise = manager.executeBackup(secrets1, 'first');

      // Simulate queuing during backup
      manager.pendingSecrets = secrets2;
      manager.pendingReason = 'queued';

      await firstPromise;

      // The finally block should trigger a compensating backup
      // Wait for async compensating backup
      await vi.advanceTimersByTimeAsync(0);

      expect(executeSpy).toHaveBeenCalledTimes(2);
    });

    it('补偿备份应该复用暂存的 ctx 并触发 waitUntil', async () => {
      const { pushToAllWebDAV } = await import('../../src/utils/webdav.js');
      pushToAllWebDAV.mockResolvedValue({ success: true });

      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets1 = createTestSecrets(1);
      const secrets2 = createTestSecrets(2);
      const ctx = { waitUntil: vi.fn() };

      // Start first backup (with ctx)
      const firstPromise = manager.executeBackup(secrets1, 'first', ctx);

      // Simulate queuing during backup — stash ctx alongside data
      manager.pendingSecrets = secrets2;
      manager.pendingReason = 'queued';
      manager.pendingCtx = ctx;

      // First backup's waitUntil call count before compensating
      await firstPromise;
      const callsAfterFirst = ctx.waitUntil.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

      // Wait for async compensating backup to finish
      await vi.advanceTimersByTimeAsync(0);

      // Compensating backup should have called waitUntil again
      expect(ctx.waitUntil.mock.calls.length).toBeGreaterThan(callsAfterFirst);
      // Each waitUntil call receives a Promise
      ctx.waitUntil.mock.calls.forEach(([arg]) => {
        expect(arg).toBeInstanceOf(Promise);
      });
    });
  });

  describe('executeBackup - 执行备份', () => {
    it('应该成功执行备份（带加密）', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(3);

      const result = await manager.executeBackup(secrets, 'manual');

      expect(result).toMatchObject({
        success: true,
        backupKey: expect.stringContaining('backup_'),
        secretCount: 3,
        encrypted: true,
        duration: expect.any(Number)
      });
      expect(env.SECRETS_KV.put).toHaveBeenCalledTimes(1);
      expect(manager.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('备份完成'),
        expect.any(Object)
      );
    });

    it('应该成功执行备份（无加密）', async () => {
      const env = createMockEnv({ withEncryption: false });
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(3);

      const result = await manager.executeBackup(secrets, 'manual');

      expect(result.encrypted).toBe(false);
      expect(manager.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('明文保存')
      );
    });

    it('空密钥列表应该返回 null', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const result = await manager.executeBackup([], 'manual');

      expect(result).toBeNull();
      expect(manager.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('无密钥需要备份')
      );
    });

    it('null 密钥应该返回 null', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const result = await manager.executeBackup(null, 'manual');

      expect(result).toBeNull();
    });

    it('应该设置 backupInProgress 标志', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      expect(manager.backupInProgress).toBe(false);

      const promise = manager.executeBackup(secrets, 'test');

      // 备份进行中
      expect(manager.backupInProgress).toBe(true);

      await promise;

      // 备份完成后
      expect(manager.backupInProgress).toBe(false);
    });

    it('应该在备份完成后重置 backupInProgress', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await manager.executeBackup(secrets, 'test');

      expect(manager.backupInProgress).toBe(false);
    });

    it('应该创建正确的备份数据结构', async () => {
      const { encryptData } = await import('../../src/utils/encryption.js');
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(2);

      await manager.executeBackup(secrets, 'manual');

      expect(encryptData).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          version: '1.0',
          count: 2,
          reason: 'manual',
          secrets: secrets
        }),
        env
      );
    });

    it('应该记录性能指标', async () => {
      const mockPerformanceMonitor = {
        recordMetric: vi.fn()
      };
      const mockMonitoring = {
        getPerformanceMonitor: vi.fn(() => mockPerformanceMonitor),
        getErrorMonitor: vi.fn()
      };

      const { getMonitoring } = await import('../../src/utils/monitoring.js');
      getMonitoring.mockReturnValue(mockMonitoring);

      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await manager.executeBackup(secrets, 'test');

      expect(mockPerformanceMonitor.recordMetric).toHaveBeenCalledWith(
        'backup_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          reason: 'test',
          encrypted: true,
          count: 1
        })
      );
    });

    it('应该异步清理旧备份', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      // Spy on the cleanup method
      const cleanupSpy = vi.spyOn(manager, '_cleanupOldBackupsAsync').mockResolvedValue();

      await manager.executeBackup(secrets, 'test');

      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('备份失败时应该抛出错误', async () => {
      const env = createMockEnv();
      env.SECRETS_KV.put.mockRejectedValueOnce(new Error('KV put failed'));

      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await expect(
        manager.executeBackup(secrets, 'test')
      ).rejects.toThrow('KV put failed');

      expect(manager.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('备份失败'),
        expect.any(Object),
        expect.any(Error)
      );
    });

    it('备份失败时应该重置 backupInProgress', async () => {
      const env = createMockEnv();
      env.SECRETS_KV.put.mockRejectedValueOnce(new Error('KV error'));

      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await expect(
        manager.executeBackup(secrets, 'test')
      ).rejects.toThrow();

      expect(manager.backupInProgress).toBe(false);
    });

    it('备份失败时应该捕获错误到监控系统', async () => {
      const mockErrorMonitor = {
        captureError: vi.fn()
      };
      const mockMonitoring = {
        getPerformanceMonitor: vi.fn(),
        getErrorMonitor: vi.fn(() => mockErrorMonitor)
      };

      const { getMonitoring } = await import('../../src/utils/monitoring.js');
      getMonitoring.mockReturnValue(mockMonitoring);

      const env = createMockEnv();
      env.SECRETS_KV.put.mockRejectedValueOnce(new Error('Test error'));

      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await expect(
        manager.executeBackup(secrets, 'test')
      ).rejects.toThrow();

      expect(mockErrorMonitor.captureError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ operation: 'backup', reason: 'test' })
      );
    });
  });

  describe('triggerBackup - 事件驱动备份', () => {
    it('应该立即执行备份（首次）', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(2);

      const result = await manager.triggerBackup(secrets, { reason: 'test' });

      expect(result).toMatchObject({
        success: true,
        secretCount: 2
      });
      expect(manager.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('备份触发请求'),
        expect.any(Object)
      );
    });

    it('备份进行中时应该暂存并返回 queued', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      // 设置备份进行中
      manager.backupInProgress = true;

      const result = await manager.triggerBackup(secrets, { reason: 'test' });

      expect(result).toMatchObject({ queued: true });
      expect(manager.pendingSecrets).toEqual(secrets);
      expect(manager.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('备份已在进行中')
      );
    });

    it('事件驱动未启用时应该跳过', async () => {
      // 临时禁用事件驱动备份
      const originalConfig = BACKUP_CONFIG.EVENT_DRIVEN_ENABLED;
      BACKUP_CONFIG.EVENT_DRIVEN_ENABLED = false;

      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      const result = await manager.triggerBackup(secrets, { reason: 'test' });

      expect(result).toBeNull();
      expect(manager.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('事件驱动备份未启用'),
        expect.any(Object)
      );

      // 恢复配置
      BACKUP_CONFIG.EVENT_DRIVEN_ENABLED = originalConfig;
    });

    it('immediate=true 在事件驱动未启用时仍应执行', async () => {
      const originalConfig = BACKUP_CONFIG.EVENT_DRIVEN_ENABLED;
      BACKUP_CONFIG.EVENT_DRIVEN_ENABLED = false;

      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      const result = await manager.triggerBackup(secrets, {
        immediate: true,
        reason: 'forced'
      });

      // immediate bypasses the EVENT_DRIVEN_ENABLED check
      expect(result).toMatchObject({
        success: true,
        secretCount: 1
      });

      BACKUP_CONFIG.EVENT_DRIVEN_ENABLED = originalConfig;
    });

    it('连续触发不在进行中时应该每次都立即执行', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      const result1 = await manager.triggerBackup(secrets, { reason: 'first' });
      expect(result1.success).toBe(true);

      const result2 = await manager.triggerBackup(secrets, { reason: 'second' });
      expect(result2.success).toBe(true);

      // Both executed immediately (no debounce)
      expect(env.SECRETS_KV.put).toHaveBeenCalledTimes(2);
    });
  });

  describe('_generateBackupKey - 备份文件名生成', () => {
    it('应该生成正确格式的备份文件名', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const key = manager._generateBackupKey();

      // 格式: backup_YYYY-MM-DD_HH-MM-SS-mmm-UTC-xxxx.json（含毫秒和UTC标记）
      expect(key).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}-UTC-[a-z0-9]{4}\.json$/);
    });

    it('应该包含当前日期和时间', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const now = new Date();
      const key = manager._generateBackupKey();

      const dateStr = now.toISOString().split('T')[0];
      expect(key).toContain(dateStr);
    });

    it('连续生成的文件名应该不同', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const key1 = manager._generateBackupKey();

      // 等待1秒
      vi.advanceTimersByTime(1000);

      const key2 = manager._generateBackupKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('_cleanupOldBackupsAsync - 清理旧备份', () => {
    it('备份数量未超过限制时不应清理', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      // Mock 50个备份文件（未超过100）
      const mockKeys = Array.from({ length: 50 }, (_, i) => ({
        name: `backup_2024-01-${String(i + 1).padStart(2, '0')}_12-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
      expect(manager.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('备份文件数量正常'),
        expect.any(Object)
      );
    });

    it('备份数量超过限制时应该清理', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      // Mock 150个备份文件（超过100）
      const mockKeys = Array.from({ length: 150 }, (_, i) => ({
        name: `backup_2024-01-01_${String(i).padStart(2, '0')}-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      // 应该删除50个旧备份
      expect(env.SECRETS_KV.delete).toHaveBeenCalledTimes(50);
      expect(manager.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('旧备份清理完成'),
        expect.any(Object)
      );
    });

    it('应该按文件名排序并保留最新的备份', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const mockKeys = [
        { name: 'backup_2024-01-01_12-00-00.json' },  // 旧
        { name: 'backup_2024-01-03_12-00-00.json' },  // 最新
        { name: 'backup_2024-01-02_12-00-00.json' }   // 中间
      ];
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      // 通过 KV 设置限制为1，只保留最新的
      env.SECRETS_KV.get.mockImplementation(async (key) => {
        if (key === 'settings') return JSON.stringify({ maxBackups: 1 });
        return null;
      });

      await manager._cleanupOldBackupsAsync();

      // 应该删除2个旧备份
      expect(env.SECRETS_KV.delete).toHaveBeenCalledWith('backup_2024-01-01_12-00-00.json');
      expect(env.SECRETS_KV.delete).toHaveBeenCalledWith('backup_2024-01-02_12-00-00.json');
      expect(env.SECRETS_KV.delete).not.toHaveBeenCalledWith('backup_2024-01-03_12-00-00.json');
    });

    it('应该从 KV 设置读取用户自定义的 maxBackups', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      // 用户设置 maxBackups 为 2
      env.SECRETS_KV.get.mockImplementation(async (key) => {
        if (key === 'settings') return JSON.stringify({ maxBackups: 2 });
        return null;
      });

      const mockKeys = Array.from({ length: 5 }, (_, i) => ({
        name: `backup_2024-01-0${i + 1}_12-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      // 保留最新2个，删除3个
      expect(env.SECRETS_KV.delete).toHaveBeenCalledTimes(3);
    });

    it('maxBackups 设为 0 时不应清理', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      env.SECRETS_KV.get.mockImplementation(async (key) => {
        if (key === 'settings') return JSON.stringify({ maxBackups: 0 });
        return null;
      });

      await manager._cleanupOldBackupsAsync();

      expect(env.SECRETS_KV.list).not.toHaveBeenCalled();
      expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
    });

    it('KV 设置读取失败时应回退到默认值', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      env.SECRETS_KV.get.mockImplementation(async (key) => {
        if (key === 'settings') throw new Error('KV read error');
        return null;
      });

      // 50 个备份，默认 100，不应清理
      const mockKeys = Array.from({ length: 50 }, (_, i) => ({
        name: `backup_2024-01-${String(i + 1).padStart(2, '0')}_12-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
    });

    it('KV 中 maxBackups 为非法值时应回退到默认值', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      // KV 被手工写入负数
      env.SECRETS_KV.get.mockImplementation(async (key) => {
        if (key === 'settings') return JSON.stringify({ maxBackups: -5 });
        return null;
      });

      // 50 个备份，回退默认 100，不应清理
      const mockKeys = Array.from({ length: 50 }, (_, i) => ({
        name: `backup_2024-01-${String(i + 1).padStart(2, '0')}_12-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
    });

    it('应该只清理 backup_ 开头的文件', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const mockKeys = [
        { name: 'backup_2024-01-01_12-00-00.json' },
        { name: 'secrets' },  // 非备份文件
        { name: 'other_file.json' }  // 非备份文件
      ];
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      await manager._cleanupOldBackupsAsync();

      // 不应该删除非备份文件
      expect(env.SECRETS_KV.delete).not.toHaveBeenCalledWith('secrets');
      expect(env.SECRETS_KV.delete).not.toHaveBeenCalledWith('other_file.json');
    });

    it('KV 错误时应该记录错误但不抛出', async () => {
      const env = createMockEnv();
      env.SECRETS_KV.list.mockRejectedValueOnce(new Error('KV list failed'));

      const manager = new BackupManager(env);

      // 不应该抛出错误
      await expect(
        manager._cleanupOldBackupsAsync()
      ).resolves.toBeUndefined();

      expect(manager.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('清理旧备份失败'),
        expect.any(Object),
        expect.any(Error)
      );
    });

    it('删除单个备份失败时应该继续删除其他', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const mockKeys = Array.from({ length: 105 }, (_, i) => ({
        name: `backup_2024-01-01_${String(i).padStart(2, '0')}-00-00.json`
      }));
      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: mockKeys });

      // Mock 第一次删除失败，后续成功
      env.SECRETS_KV.delete
        .mockRejectedValueOnce(new Error('Delete failed'))
        .mockResolvedValue();

      await manager._cleanupOldBackupsAsync();

      // 应该尝试删除所有5个
      expect(env.SECRETS_KV.delete).toHaveBeenCalledTimes(5);
      expect(manager.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('删除备份失败'),
        expect.any(Object),
        expect.any(Error)
      );
    });
  });

  describe('pendingSecrets - 暂存机制', () => {
    it('初始状态应该为 null', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      expect(manager.pendingSecrets).toBeNull();
      expect(manager.pendingReason).toBeNull();
    });

    it('备份进行中触发时应该暂存', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      manager.backupInProgress = true;

      await manager.triggerBackup(secrets, { reason: 'queued' });

      expect(manager.pendingSecrets).toEqual(secrets);
      expect(manager.pendingReason).toBe('queued');
    });

    it('多次暂存应该只保留最新的数据', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets1 = createTestSecrets(1);
      const secrets2 = createTestSecrets(2);

      manager.backupInProgress = true;

      await manager.triggerBackup(secrets1, { reason: 'first' });
      await manager.triggerBackup(secrets2, { reason: 'second' });

      expect(manager.pendingSecrets).toEqual(secrets2);
      expect(manager.pendingReason).toBe('second');
    });
  });

  describe('getBackupManager - 工厂函数', () => {
    it('应该返回 BackupManager 实例', () => {
      const env = createMockEnv();
      const manager = getBackupManager(env);

      expect(manager).toBeInstanceOf(BackupManager);
      expect(manager.env).toBe(env);
    });

    it('相同 env 应该返回相同实例', () => {
      const env = createMockEnv();

      const manager1 = getBackupManager(env);
      const manager2 = getBackupManager(env);

      expect(manager1).toBe(manager2);
    });

    it('不同 env 应该返回不同实例', () => {
      const env1 = createMockEnv();
      const env2 = createMockEnv();

      const manager1 = getBackupManager(env1);
      const manager2 = getBackupManager(env2);

      expect(manager1).not.toBe(manager2);
    });
  });

  describe('triggerBackup - 快捷方法', () => {
    it('应该调用 BackupManager.triggerBackup', async () => {
      const env = createMockEnv();
      const secrets = createTestSecrets(2);

      const result = await triggerBackup(secrets, env, { reason: 'test' });

      expect(result).toMatchObject({
        success: true,
        secretCount: 2
      });
    });

    it('应该传递所有参数', async () => {
      const env = createMockEnv();
      const secrets = createTestSecrets(1);

      const result = await triggerBackup(secrets, env, {
        immediate: true,
        reason: 'custom'
      });

      expect(result).toMatchObject({
        success: true,
        secretCount: 1
      });
    });
  });

  describe('executeImmediateBackup - 立即备份快捷方法', () => {
    it('应该立即执行备份', async () => {
      const env = createMockEnv();
      const secrets = createTestSecrets(2);

      const result = await executeImmediateBackup(secrets, env, 'immediate-test');

      expect(result).toMatchObject({
        success: true,
        secretCount: 2,
        backupKey: expect.stringContaining('backup_')
      });
    });
  });

  describe('集成测试', () => {
    it('完整的备份流程', async () => {
      const env = createMockEnv();
      const secrets = createTestSecrets(3);

      // 1. 首次备份（应该立即执行）
      const result1 = await triggerBackup(secrets, env, { reason: 'first' });
      expect(result1.success).toBe(true);

      // 2. 再次触发（不在进行中，也应该立即执行）
      const result2 = await triggerBackup(secrets, env, { reason: 'second' });
      expect(result2.success).toBe(true);

      // 3. 立即备份
      const result3 = await triggerBackup(secrets, env, {
        immediate: true,
        reason: 'third'
      });
      expect(result3.success).toBe(true);

      // 4. 验证 KV 写入 3 次
      expect(env.SECRETS_KV.put).toHaveBeenCalledTimes(3);
    });

    it('加密和明文备份对比', async () => {
      const secrets = createTestSecrets(2);

      // 有加密密钥
      const envWithEncryption = createMockEnv({ withEncryption: true });
      const result1 = await executeImmediateBackup(secrets, envWithEncryption, 'encrypted');
      expect(result1.encrypted).toBe(true);

      // 无加密密钥
      const envWithoutEncryption = createMockEnv({ withEncryption: false });
      const result2 = await executeImmediateBackup(secrets, envWithoutEncryption, 'plain');
      expect(result2.encrypted).toBe(false);
    });

    it('并发备份场景', async () => {
      const env = createMockEnv();
      const manager = getBackupManager(env);
      const secrets1 = createTestSecrets(1);
      const secrets2 = createTestSecrets(2);

      // 1. 首次备份
      const result1 = await manager.executeBackup(secrets1, 'first');
      expect(result1.success).toBe(true);

      // 2. 第二次备份（不在进行中，立即执行）
      vi.advanceTimersByTime(1);
      const result2 = await manager.triggerBackup(secrets2, { reason: 'second' });
      expect(result2.success).toBe(true);

      // 3. 验证 KV 存储了两次
      expect(env.SECRETS_KV.put).toHaveBeenCalledTimes(2);
    });
  });

  describe('边界条件', () => {
    it('应该处理极大数量的密钥', async () => {
      const env = createMockEnv();
      const secrets = createTestSecrets(1000);

      const result = await executeImmediateBackup(secrets, env, 'large');

      expect(result.success).toBe(true);
      expect(result.secretCount).toBe(1000);
    });

    it('应该处理空备份列表清理', async () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      env.SECRETS_KV.list.mockResolvedValueOnce({ keys: [] });

      await manager._cleanupOldBackupsAsync();

      expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
    });

    it('应该处理特殊字符的密钥名称', async () => {
      const env = createMockEnv();
      const secrets = [{
        id: 'test-1',
        name: '测试!@#$%^&*()_+',
        secret: 'JBSWY3DPEHPK3PXP'
      }];

      const result = await executeImmediateBackup(secrets, env, 'special-chars');

      expect(result.success).toBe(true);
    });

    it('性能指标记录失败不应影响备份', async () => {
      const mockMonitoring = {
        getPerformanceMonitor: vi.fn(() => {
          throw new Error('Metrics error');
        }),
        getErrorMonitor: vi.fn()
      };

      const { getMonitoring } = await import('../../src/utils/monitoring.js');
      getMonitoring.mockReturnValue(mockMonitoring);

      const env = createMockEnv();
      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      // 应该成功完成备份
      const result = await manager.executeBackup(secrets, 'test');

      expect(result.success).toBe(true);
      expect(manager.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('性能指标记录失败'),
        expect.any(Object),
        expect.any(Error)
      );
    });

    it('监控系统错误不应影响错误处理', async () => {
      const mockMonitoring = {
        getPerformanceMonitor: vi.fn(),
        getErrorMonitor: vi.fn(() => {
          throw new Error('Monitoring error');
        })
      };

      const { getMonitoring } = await import('../../src/utils/monitoring.js');
      getMonitoring.mockReturnValue(mockMonitoring);

      const env = createMockEnv();
      env.SECRETS_KV.put.mockRejectedValueOnce(new Error('Backup error'));

      const manager = new BackupManager(env);
      const secrets = createTestSecrets(1);

      await expect(
        manager.executeBackup(secrets, 'test')
      ).rejects.toThrow('Backup error');

      expect(manager.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('监控系统捕获错误失败'),
        expect.any(Object),
        expect.any(Error)
      );
    });
  });

  describe('性能测试', () => {
    it('备份操作应该快速完成', async () => {
      vi.useRealTimers(); // 使用真实计时器

      const env = createMockEnv();
      const secrets = createTestSecrets(10);

      const start = performance.now();
      await executeImmediateBackup(secrets, env, 'perf-test');
      const end = performance.now();

      expect(end - start).toBeLessThan(1000); // < 1秒

      vi.useFakeTimers(); // 恢复假计时器
    });

    it('备份文件名生成应该高效', () => {
      const env = createMockEnv();
      const manager = new BackupManager(env);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        manager._generateBackupKey();
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // 1000次 < 100ms
    });
  });
});
