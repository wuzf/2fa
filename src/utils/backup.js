/**
 * 智能备份系统
 * 实现事件驱动的即时备份策略
 *
 * 策略：
 * 1. 数据变化时立即备份并推送 WebDAV（事件驱动，每次变更都备份）
 * 2. 保留定时备份作为兜底（每日检查一次）
 * 3. 自动清理旧备份（保留数量由用户设置的 maxBackups 控制，默认100个）
 *
 * 配置选项（BACKUP_CONFIG）：
 * - MAX_BACKUPS: 默认最大保留备份数（100），用户可在设置中自定义（0表示不限制）
 * - AUTO_CLEANUP_ENABLED: 是否启用自动清理（默认true）
 *
 * 清理机制：
 * - 每次备份完成后自动触发清理检查
 * - 如果备份数量 > MAX_BACKUPS，保留最新的 MAX_BACKUPS 个，删除其余的
 * - 备份按时间戳排序，最早的备份优先被删除
 */

import { getLogger } from './logger.js';
import { getMonitoring } from './monitoring.js';
import { pushToAllWebDAV } from './webdav.js';
import { pushToAllS3 } from './s3.js';
import { pushToAllOneDrive } from './onedrive.js';
import { pushToAllGoogleDrive } from './gdrive.js';
import { deleteBackupRecord, listAllBackupKeys, putBackupRecord } from './backup-index.js';
import { createBackupEntry } from './backup-format.js';
import { clearPendingDataHash, saveDataHash } from './data-hash.js';
import { DEFAULT_EXPORT_FORMAT, getDefaultExportFormat } from './settings.js';

/**
 * 备份配置
 */
const BACKUP_CONFIG = {
	// 默认最大保留备份数，用户可在设置中自定义（KV key: settings.maxBackups）
	// 设置为 0 表示不限制（禁用自动清理）
	MAX_BACKUPS: 100,

	// 是否启用自动清理旧备份
	AUTO_CLEANUP_ENABLED: true,

	// 是否启用事件驱动备份
	EVENT_DRIVEN_ENABLED: true,

	// 是否启用定时备份
	SCHEDULED_BACKUP_ENABLED: true,
};

export async function resolveConfiguredBackupFormat(env, logger) {
	return getDefaultExportFormat(env, {
		fallbackOnError: true,
		onError: (error) => {
			logger?.warn?.('读取默认备份格式失败，已回退为 JSON', {
				errorMessage: error.message,
				fallbackFormat: DEFAULT_EXPORT_FORMAT,
			});
		},
	});
}

/**
 * 校验 maxBackups 值，非法值回退默认 100
 * @param {*} value - 待校验值
 * @returns {number} 合法的整数值（0~1000）
 */
function sanitizeMaxBackups(value) {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
		return BACKUP_CONFIG.MAX_BACKUPS;
	}
	return value;
}

/**
 * 备份管理器
 */
class BackupManager {
	constructor(env) {
		this.env = env;
		this.logger = getLogger(env);
		this.backupInProgress = false;
		this.pendingBackups = [];
		this.pendingSecrets = null; // 并发期间暂存最新的密钥快照
		this.pendingReason = null;
		this.pendingCtx = null;
		this.pendingCompletion = null;
	}

	/**
	 * 触发备份（事件驱动，每次数据变更立即执行）
	 */
	async triggerBackup(secrets, options = {}) {
		const { immediate = false, reason = 'event-driven', ctx, waitForCompletion = false } = options;

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
			this.logger.debug('⏳ 备份已在进行中，已暂存最新数据等待执行');
			return this._queuePendingBackup(secrets, {
				reason,
				ctx,
				immediate,
				waitForCompletion,
			});
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

			const backupFormat = await resolveConfiguredBackupFormat(this.env, this.logger);
			const backupEntry = await createBackupEntry(secrets, this.env, {
				format: backupFormat,
				reason,
				includeUtcMarker: true,
				strict: reason === 'manual',
			});
			const { backupKey, backupContent, encrypted: isEncrypted, count: storedCount, metadata } = backupEntry;

			if (isEncrypted) {
				this.logger.debug('🔒 备份数据已加密');
			} else {
				this.logger.warn('⚠️ 备份数据以明文保存（未配置 ENCRYPTION_KEY）');
			}
			if (backupEntry.skippedInvalidCount > 0) {
				this.logger.warn('⚠️ 备份已跳过无效密钥', {
					reason,
					skippedInvalidCount: backupEntry.skippedInvalidCount,
				});
			}

			// 存储备份
			await putBackupRecord(this.env, backupKey, backupContent, metadata);

			// WebDAV 自动推送（通过 ctx.waitUntil 托管，确保 Worker 响应后推送仍能完成）
			const webdavPromise = pushToAllWebDAV(backupKey, backupContent, this.env).catch((err) => {
				this.logger.warn('WebDAV 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(webdavPromise);
			}

			// S3 自动推送
			const s3Promise = pushToAllS3(backupKey, backupContent, this.env).catch((err) => {
				this.logger.warn('S3 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(s3Promise);
			}

			const oneDrivePromise = pushToAllOneDrive(backupKey, backupContent, this.env).catch((err) => {
				this.logger.warn('OneDrive 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(oneDrivePromise);
			}

			const googleDrivePromise = pushToAllGoogleDrive(backupKey, backupContent, this.env).catch((err) => {
				this.logger.warn('Google Drive 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(googleDrivePromise);
			}

			await saveDataHash(this.env, secrets, {
				reason,
				skippedInvalidCount: backupEntry.skippedInvalidCount,
			});

			const duration = Date.now() - startTime;

			this.logger.info('✅ 备份完成', {
				backupKey,
				reason,
				secretCount: storedCount,
				encrypted: isEncrypted,
				format: backupEntry.format,
				duration,
			});

			// 记录性能指标
			try {
				const monitoring = getMonitoring(this.env);
				if (monitoring && monitoring.getPerformanceMonitor) {
					monitoring.getPerformanceMonitor().recordMetric('backup_duration', duration, 'ms', {
						reason,
						encrypted: isEncrypted,
						count: storedCount,
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
				secretCount: storedCount,
				encrypted: isEncrypted,
				format: backupEntry.format,
				skippedInvalidCount: backupEntry.skippedInvalidCount,
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

			const nextPendingBackup = this._dequeuePendingBackup();
			if (nextPendingBackup) {
				this.logger.info('🔁 执行暂存的补偿备份', {
					reason: nextPendingBackup.reason,
					immediate: nextPendingBackup.exact === true,
				});
				this.executeBackup(nextPendingBackup.secrets, nextPendingBackup.reason, nextPendingBackup.ctx)
					.then((result) => {
						this._resolveCompletionHandles(nextPendingBackup.completionHandles, result);
					})
					.catch((err) => {
						this._rejectCompletionHandles(nextPendingBackup.completionHandles, err);
						this.logger.error('补偿备份失败', { reason: nextPendingBackup.reason }, err);
					});
			}
		}
	}

	_queuePendingBackup(secrets, options = {}) {
		const completionHandle = options.immediate === true || options.waitForCompletion === true ? this._createCompletionHandle() : null;
		const queuedBackup = {
			secrets,
			reason: options.reason || 'event-driven',
			ctx: options.ctx || null,
			exact: options.immediate === true,
			completionHandles: completionHandle ? [completionHandle] : [],
		};
		const lastPendingBackup = this.pendingBackups[this.pendingBackups.length - 1];

		if (lastPendingBackup && lastPendingBackup.exact !== true && queuedBackup.exact !== true) {
			this.pendingBackups[this.pendingBackups.length - 1] = {
				...lastPendingBackup,
				secrets: queuedBackup.secrets,
				reason: queuedBackup.reason,
				ctx: queuedBackup.ctx || lastPendingBackup.ctx || null,
				completionHandles: [...lastPendingBackup.completionHandles, ...queuedBackup.completionHandles],
			};
		} else if (queuedBackup.exact === true) {
			const supersededDeferredBackup =
				this.pendingBackups.length > 0 && this.pendingBackups[this.pendingBackups.length - 1].exact !== true
					? this.pendingBackups.pop()
					: null;

			if (!queuedBackup.ctx && supersededDeferredBackup?.ctx) {
				queuedBackup.ctx = supersededDeferredBackup.ctx;
			}
			if (supersededDeferredBackup) {
				this._supersedeDeferredPendingBackup(supersededDeferredBackup, queuedBackup.reason);
			}

			this.pendingBackups.push(queuedBackup);
		} else {
			if (!queuedBackup.ctx && lastPendingBackup?.ctx) {
				queuedBackup.ctx = lastPendingBackup.ctx;
			}
			this.pendingBackups.push(queuedBackup);
		}

		this._syncPendingState();
		return completionHandle ? completionHandle.promise : { queued: true };
	}

	_createCompletionHandle() {
		let resolve;
		let reject;
		const promise = new Promise((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});

		return {
			promise,
			resolve,
			reject,
		};
	}

	_dequeuePendingBackup() {
		if (this.pendingBackups.length > 0) {
			const nextPendingBackup = this.pendingBackups.shift();
			this._syncPendingState();
			return nextPendingBackup;
		}

		if (!this.pendingSecrets) {
			return null;
		}

		const legacyPendingBackup = {
			secrets: this.pendingSecrets,
			reason: this.pendingReason || 'event-driven',
			ctx: this.pendingCtx || null,
			exact: false,
			completionHandles: this.pendingCompletion ? [this.pendingCompletion] : [],
		};

		this.pendingSecrets = null;
		this.pendingReason = null;
		this.pendingCtx = null;
		this.pendingCompletion = null;
		return legacyPendingBackup;
	}

	_resolveCompletionHandles(completionHandles = [], result) {
		completionHandles.forEach((completionHandle) => completionHandle?.resolve?.(result));
	}

	_rejectCompletionHandles(completionHandles = [], error) {
		completionHandles.forEach((completionHandle) => completionHandle?.reject?.(error));
	}

	_supersedeDeferredPendingBackup(pendingBackup, exactReason) {
		if (!pendingBackup) {
			return;
		}

		if (pendingBackup.completionHandles?.length > 0) {
			this._resolveCompletionHandles(pendingBackup.completionHandles, {
				queued: true,
				superseded: true,
				reason: pendingBackup.reason,
				supersededBy: exactReason,
			});
		}

		void clearPendingDataHash(this.env, { silent: true });
		this.logger.debug('已丢弃过期的暂存事件备份，优先保留立即备份', {
			supersededReason: pendingBackup.reason,
			exactReason,
		});
	}

	_syncPendingState() {
		const lastPendingBackup = this.pendingBackups[this.pendingBackups.length - 1] || null;
		this.pendingSecrets = lastPendingBackup?.secrets || null;
		this.pendingReason = lastPendingBackup?.reason || null;
		this.pendingCtx = lastPendingBackup?.ctx || null;
		this.pendingCompletion = lastPendingBackup?.completionHandles?.[0] || null;
	}

	/**
	 * 从 KV 读取用户配置的 maxBackups，回退到 BACKUP_CONFIG.MAX_BACKUPS
	 * @private
	 */
	async _getMaxBackups() {
		try {
			const raw = await this.env.SECRETS_KV.get('settings');
			if (raw) {
				const settings = JSON.parse(raw);
				if (settings.maxBackups !== undefined) {
					return sanitizeMaxBackups(settings.maxBackups);
				}
			}
		} catch {
			// 读取失败时使用默认值
		}
		return BACKUP_CONFIG.MAX_BACKUPS;
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

		const maxBackups = await this._getMaxBackups();

		// 检查是否设置了备份限制（0表示不限制）
		if (maxBackups === 0) {
			this.logger.debug('⏭️ 备份数量不限制（maxBackups=0），跳过清理');
			return;
		}

		try {
			const backupKeys = (await listAllBackupKeys(this.env)).sort((a, b) => b.name.localeCompare(a.name));

			this.logger.debug('🔍 检查备份文件', { count: backupKeys.length });

			if (backupKeys.length <= maxBackups) {
				this.logger.debug('✅ 备份文件数量正常', {
					current: backupKeys.length,
					max: maxBackups,
				});
				return;
			}

			// 按文件名排序（最新的在前）
			backupKeys.sort((a, b) => b.name.localeCompare(a.name));

			// 保留最新的备份，删除其余的
			const keysToDelete = backupKeys.slice(maxBackups);

			this.logger.info('🧹 开始清理旧备份', {
				totalBackups: backupKeys.length,
				toDelete: keysToDelete.length,
				toKeep: maxBackups,
			});

			// 批量删除（避免阻塞太久）
			const deletePromises = keysToDelete.map((key) =>
				deleteBackupRecord(this.env, key.name, key.metadata)
					.then((result) => {
						if (!result?.success) {
							this.logger.warn(`删除备份失败: ${key.name}`, {}, result?.error);
						}
					})
					.catch((err) => {
						this.logger.warn(`删除备份失败: ${key.name}`, {}, err);
					}),
			);

			await Promise.all(deletePromises);

			this.logger.info('✅ 旧备份清理完成', {
				deleted: keysToDelete.length,
				remaining: maxBackups,
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
export { BACKUP_CONFIG, BackupManager, sanitizeMaxBackups };

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
