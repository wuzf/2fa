/**
 * 智能备份系统
 * 实现事件驱动 + 防抖的备份策略
 *
 * 策略：
 * 1. 数据变化时立即触发备份（事件驱动）
 * 2. 使用防抖机制，避免频繁备份（5分钟内只备份一次）
 * 3. 保留定时备份作为兜底（每10分钟检查一次）
 * 4. 自动清理旧备份（默认保留最新100个，超过后自动删除最早的备份）
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

/**
 * 备份配置
 */
const BACKUP_CONFIG = {
	// 防抖时间（毫秒）- 5分钟内只备份一次
	DEBOUNCE_INTERVAL: 5 * 60 * 1000, // 5 minutes

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
		this.lastBackupTime = 0;
		this.pendingBackup = null;
		this.backupInProgress = false;
	}

	/**
	 * 检查是否应该执行备份（防抖检查）
	 */
	shouldBackup() {
		const now = Date.now();
		const timeSinceLastBackup = now - this.lastBackupTime;

		// 如果距离上次备份不到5分钟，跳过
		if (timeSinceLastBackup < BACKUP_CONFIG.DEBOUNCE_INTERVAL) {
			this.logger.debug('⏭️ 备份防抖：距离上次备份不到5分钟，跳过', {
				timeSinceLastBackup,
				debounceInterval: BACKUP_CONFIG.DEBOUNCE_INTERVAL,
			});
			return false;
		}

		return true;
	}

	/**
	 * 触发备份（事件驱动）
	 * 带防抖机制，避免频繁备份
	 */
	async triggerBackup(secrets, options = {}) {
		const { immediate = false, reason = 'event-driven' } = options;

		this.logger.info('🔔 收到备份触发请求', {
			reason,
			immediate,
			secretCount: secrets?.length || 0,
			lastBackupTime: this.lastBackupTime,
		});

		// 如果未启用事件驱动备份，跳过
		if (!BACKUP_CONFIG.EVENT_DRIVEN_ENABLED && !immediate) {
			this.logger.warn('⏭️ 事件驱动备份未启用', { reason });
			return null;
		}

		// 检查是否正在备份
		if (this.backupInProgress) {
			this.logger.debug('⏳ 备份已在进行中，跳过本次触发');
			return null;
		}

		// 防抖检查（除非是立即备份）
		if (!immediate && !this.shouldBackup()) {
			// 取消之前的待处理备份
			if (this.pendingBackup) {
				clearTimeout(this.pendingBackup);
			}

			// 设置延迟备份（在防抖间隔后执行）
			const remainingTime = BACKUP_CONFIG.DEBOUNCE_INTERVAL - (Date.now() - this.lastBackupTime);
			this.logger.info('⏰ 延迟备份已调度', {
				delay: remainingTime,
				reason,
			});

			this.pendingBackup = setTimeout(() => {
				this.executeBackup(secrets, reason).catch((err) => {
					this.logger.error('延迟备份失败', { reason }, err);
				});
			}, remainingTime);

			return { scheduled: true, delay: remainingTime };
		}

		// 立即执行备份
		return this.executeBackup(secrets, reason);
	}

	/**
	 * 执行备份
	 */
	async executeBackup(secrets, reason = 'manual') {
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
				lastBackup: this.lastBackupTime ? new Date(this.lastBackupTime).toISOString() : 'never',
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

			const duration = Date.now() - startTime;
			this.lastBackupTime = Date.now();

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
		}
	}

	/**
	 * 生成备份文件名
	 * @private
	 */
	_generateBackupKey() {
		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
		return `backup_${dateStr}_${timeStr}.json`;
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

	/**
	 * 获取上次备份时间
	 */
	getLastBackupTime() {
		return this.lastBackupTime;
	}

	/**
	 * 获取距离上次备份的时间
	 */
	getTimeSinceLastBackup() {
		if (this.lastBackupTime === 0) {
			return null;
		}
		return Date.now() - this.lastBackupTime;
	}

	/**
	 * 取消待处理的备份
	 */
	cancelPendingBackup() {
		if (this.pendingBackup) {
			clearTimeout(this.pendingBackup);
			this.pendingBackup = null;
			this.logger.debug('⏹️ 已取消待处理的备份');
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
