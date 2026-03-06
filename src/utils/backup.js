/**
 * 智能备份系统
 * 实现事件驱动的即时备份策略
 *
 * 策略：
 * 1. 数据变化时立即备份并推送 WebDAV（事件驱动，每次变更都备份）
 * 2. 保留定时备份作为兜底（每日检查一次）
 * 3. 自动清理旧备份（默认保留最新100个，超过后自动删除最早的备份）
 *
 * 配置选项（BACKUP_CONFIG）：
 * - MAX_BACKUPS: 最大保留备份数（默认100，设置为0表示不限制）
 * - AUTO_CLEANUP_ENABLED: 是否启用自动清理（默认true）
 *
 * 清理机制：
 * - 每次备份完成后自动触发清理检查
 * - 如果备份数量 > MAX_BACKUPS，保留最新的 MAX_BACKUPS 个，删除其余的
 * - 备份按时间戳排序，最早的备份优先被删除
 */

import { encryptData } from './encryption.js';
import { getLogger } from './logger.js';
import { getMonitoring } from './monitoring.js';
import { pushToWebDAV } from './webdav.js';

/**
 * 备份配置
 */
const BACKUP_CONFIG = {
	// 最大保留备份数（默认100，可通过环境变量覆盖）
	// 设置为 0 表示不限制（禁用自动清理）
	MAX_BACKUPS: 100,

	// 是否启用自动清理旧备份（默认true，可通过环境变量覆盖）
	AUTO_CLEANUP_ENABLED: true,

	// 是否启用事件驱动备份
	EVENT_DRIVEN_ENABLED: true,

	// 是否启用定时备份
	SCHEDULED_BACKUP_ENABLED: true,
};

/**
 * 备份管理器
 */
class BackupManager {
	constructor(env) {
		this.env = env;
		this.logger = getLogger(env);
		this.backupInProgress = false;
		this.pendingSecrets = null; // 并发期间暂存最新的密钥快照
		this.pendingReason = null;
		this.pendingCtx = null;
	}

	/**
	 * 触发备份（事件驱动，每次数据变更立即执行）
	 */
	async triggerBackup(secrets, options = {}) {
		const { immediate = false, reason = 'event-driven', ctx } = options;

		this.logger.info('🔔 收到备份触发请求', {
			reason,
			immediate,
			secretCount: secrets?.length || 0,
		});

		// 如果未启用事件驱动备份，跳过
		if (!BACKUP_CONFIG.EVENT_DRIVEN_ENABLED && !immediate) {
			this.logger.warn('⏭️ 事件驱动备份未启用', { reason });
			return null;
		}

		// 检查是否正在备份：暂存最新快照，待当前备份完成后自动执行
		if (this.backupInProgress) {
			this.pendingSecrets = secrets;
			this.pendingReason = reason;
			this.pendingCtx = ctx;
			this.logger.debug('⏳ 备份已在进行中，已暂存最新数据等待执行');
			return { queued: true };
		}

		// 立即执行备份
		return this.executeBackup(secrets, reason, ctx);
	}

	/**
	 * 执行备份
	 */
	async executeBackup(secrets, reason = 'manual', ctx) {
		if (!secrets || secrets.length === 0) {
			this.logger.info('📭 无密钥需要备份');
			return null;
		}

		this.backupInProgress = true;
		const startTime = Date.now();

		try {
			this.logger.info('🔄 开始执行备份', {
				reason,
				secretCount: secrets.length,
			});

			// 创建备份数据
			const backupData = {
				timestamp: new Date().toISOString(),
				version: '1.0',
				count: secrets.length,
				reason, // 备份原因（event-driven, scheduled, manual）
				secrets: secrets,
			};

			// 生成备份文件名
			const backupKey = this._generateBackupKey();

			// 加密备份数据（如果配置了密钥）
			let backupContent;
			let isEncrypted = false;

			if (this.env.ENCRYPTION_KEY) {
				backupContent = await encryptData(backupData, this.env);
				isEncrypted = true;
				this.logger.debug('🔒 备份数据已加密');
			} else {
				backupContent = JSON.stringify(backupData, null, 2);
				this.logger.warn('⚠️ 备份数据以明文保存（未配置 ENCRYPTION_KEY）');
			}

			// 存储备份
			await this.env.SECRETS_KV.put(backupKey, backupContent);

			// WebDAV 自动推送（通过 ctx.waitUntil 托管，确保 Worker 响应后推送仍能完成）
			const webdavPromise = pushToWebDAV(backupKey, backupContent, this.env).catch((err) => {
				this.logger.warn('WebDAV 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(webdavPromise);
			}

			const duration = Date.now() - startTime;

			this.logger.info('✅ 备份完成', {
				backupKey,
				reason,
				secretCount: secrets.length,
				encrypted: isEncrypted,
				duration,
			});

			// 记录性能指标
			try {
				const monitoring = getMonitoring(this.env);
				if (monitoring && monitoring.getPerformanceMonitor) {
					monitoring.getPerformanceMonitor().recordMetric('backup_duration', duration, 'ms', {
						reason,
						encrypted: isEncrypted,
						count: secrets.length,
					});
				}
			} catch (metricsError) {
				// 性能指标记录失败不影响备份
				this.logger.debug('性能指标记录失败', {}, metricsError);
			}

			// 异步清理旧备份（不阻塞）
			this._cleanupOldBackupsAsync().catch((err) => {
				this.logger.warn('清理旧备份失败（不影响主流程）', {}, err);
			});

			return {
				success: true,
				backupKey,
				secretCount: secrets.length,
				encrypted: isEncrypted,
				duration,
			};
		} catch (error) {
			this.logger.error('❌ 备份失败', { reason }, error);

			// 尝试捕获错误到监控系统
			try {
				const monitoring = getMonitoring(this.env);
				if (monitoring && monitoring.getErrorMonitor) {
					monitoring.getErrorMonitor().captureError(error, { operation: 'backup', reason });
				}
			} catch (monitoringError) {
				// 监控系统错误不影响主流程
				this.logger.debug('监控系统捕获错误失败', {}, monitoringError);
			}

			throw error;
		} finally {
			this.backupInProgress = false;

			// 如果并发期间有新数据暂存，立即执行一次补偿备份
			if (this.pendingSecrets) {
				const secrets = this.pendingSecrets;
				const pendingReason = this.pendingReason || 'event-driven';
				const pendingCtx = this.pendingCtx;
				this.pendingSecrets = null;
				this.pendingReason = null;
				this.pendingCtx = null;
				this.logger.info('🔁 执行暂存的补偿备份', { reason: pendingReason });
				this.executeBackup(secrets, pendingReason, pendingCtx).catch((err) => {
					this.logger.error('补偿备份失败', { reason: pendingReason }, err);
				});
			}
		}
	}

	/**
	 * 生成备份文件名（使用 UTC 保证排序一致性）
	 * @private
	 */
	_generateBackupKey() {
		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').replace('.', '-').replace('Z', '');
		const rand = Math.random().toString(36).slice(2, 6);
		return `backup_${dateStr}_${timeStr}-UTC-${rand}.json`;
	}

	/**
	 * 异步清理旧备份
	 * @private
	 */
	async _cleanupOldBackupsAsync() {
		// 检查是否启用自动清理
		if (!BACKUP_CONFIG.AUTO_CLEANUP_ENABLED) {
			this.logger.debug('⏭️ 自动清理已禁用，跳过');
			return;
		}

		// 检查是否设置了备份限制（0表示不限制）
		if (BACKUP_CONFIG.MAX_BACKUPS === 0) {
			this.logger.debug('⏭️ 备份数量不限制（MAX_BACKUPS=0），跳过清理');
			return;
		}

		try {
			const list = await this.env.SECRETS_KV.list();
			const backupKeys = list.keys.filter((key) => key.name.startsWith('backup_'));

			this.logger.debug('🔍 检查备份文件', { count: backupKeys.length });

			if (backupKeys.length <= BACKUP_CONFIG.MAX_BACKUPS) {
				this.logger.debug('✅ 备份文件数量正常', {
					current: backupKeys.length,
					max: BACKUP_CONFIG.MAX_BACKUPS,
				});
				return;
			}

			// 按文件名排序（最新的在前）
			backupKeys.sort((a, b) => b.name.localeCompare(a.name));

			// 保留最新的备份，删除其余的
			const keysToDelete = backupKeys.slice(BACKUP_CONFIG.MAX_BACKUPS);

			this.logger.info('🧹 开始清理旧备份', {
				totalBackups: backupKeys.length,
				toDelete: keysToDelete.length,
				toKeep: BACKUP_CONFIG.MAX_BACKUPS,
			});

			// 批量删除（避免阻塞太久）
			const deletePromises = keysToDelete.map((key) =>
				this.env.SECRETS_KV.delete(key.name).catch((err) => {
					this.logger.warn(`删除备份失败: ${key.name}`, {}, err);
				}),
			);

			await Promise.all(deletePromises);

			this.logger.info('✅ 旧备份清理完成', {
				deleted: keysToDelete.length,
				remaining: BACKUP_CONFIG.MAX_BACKUPS,
			});
		} catch (error) {
			this.logger.error('清理旧备份失败', {}, error);
			// 不抛出错误，避免影响主流程
		}
	}
}

/**
 * 全局备份管理器实例
 */
let backupManager = null;

/**
 * 获取备份管理器实例
 */
export function getBackupManager(env) {
	if (!backupManager || backupManager.env !== env) {
		backupManager = new BackupManager(env);
	}
	return backupManager;
}

/**
 * 快捷方法：触发备份
 */
export async function triggerBackup(secrets, env, options = {}) {
	const manager = getBackupManager(env);
	return manager.triggerBackup(secrets, options);
}

/**
 * 快捷方法：立即执行备份
 */
export async function executeImmediateBackup(secrets, env, reason = 'manual') {
	const manager = getBackupManager(env);
	return manager.executeBackup(secrets, reason);
}

/**
 * 导出配置和类
 */
export { BACKUP_CONFIG, BackupManager };

/**
 * 使用示例：
 *
 * // 在 API 中触发事件驱动备份
 * import { triggerBackup } from './utils/backup.js';
 *
 * // 添加密钥后
 * await triggerBackup(secrets, env, { reason: 'secret-added' });
 *
 * // 更新密钥后
 * await triggerBackup(secrets, env, { reason: 'secret-updated' });
 *
 * // 删除密钥后
 * await triggerBackup(secrets, env, { reason: 'secret-deleted' });
 *
 * // 立即备份（忽略防抖）
 * await triggerBackup(secrets, env, { immediate: true, reason: 'manual' });
 */
