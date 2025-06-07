/**
 * 2FA OTP Generator - Cloudflare Worker
 * 重构后的主入口文件
 *
 * 功能模块：
 * - router/handler.js - 路由处理
 * - api/secrets/ - 密钥管理API（模块化：shared/crud/batch/backup/restore/otp）
 * - otp/generator.js - OTP生成
 * - ui/page.js - 页面渲染
 * - utils/ - 工具函数
 *
 * 🔒 安全特性：所有2FA密钥使用 AES-GCM 256位加密存储
 * 📊 监控特性：结构化日志、错误追踪、性能监控
 */

import { handleRequest, handleCORS } from './router/handler.js';
import { decryptSecrets } from './utils/encryption.js';
import { encryptData } from './utils/encryption.js';
import { getLogger, createRequestLogger, PerformanceTimer } from './utils/logger.js';
import { getMonitoring, ErrorSeverity } from './utils/monitoring.js';
import { KV_KEYS } from './utils/constants.js';

/**
 * 获取所有密钥
 * 🔒 自动解密数据
 * @param {Object} env - 环境变量对象
 * @returns {Array} 密钥列表
 */
async function getAllSecrets(env) {
	const logger = getLogger(env);

	try {
		// 从 KV_KEYS.SECRETS 键获取所有密钥（可能是加密的）
		const secretsData = await env.SECRETS_KV.get(KV_KEYS.SECRETS, 'text');

		if (!secretsData) {
			logger.info('没有找到密钥数据');
			return [];
		}

		// 🔒 解密数据（自动检测是否加密）
		const secrets = await decryptSecrets(secretsData, env);

		// 确保返回的是数组
		if (Array.isArray(secrets)) {
			return secrets;
		} else {
			logger.warn('密钥数据格式不正确，期望数组', {
				actualType: typeof secrets,
			});
			return [];
		}
	} catch (error) {
		logger.error('获取密钥列表失败', {}, error);
		return [];
	}
}

/**
 * 生成数据的哈希值，用于检测数据变化
 * 使用 SHA-256 算法，避免哈希碰撞
 * @param {Array} secrets - 密钥数组
 * @param {Object} env - 环境变量对象（可选，用于日志）
 * @returns {Promise<string>} 数据的 SHA-256 哈希值（十六进制）
 */
export async function generateDataHash(secrets, env = null) {
	const logger = env ? getLogger(env) : null;

	// 创建一个包含关键字段的简化版本，用于计算哈希
	const hashData = secrets.map((secret) => ({
		id: secret.id,
		name: secret.name,
		secret: secret.secret,
		account: secret.account,
		type: secret.type,
		digits: secret.digits,
		period: secret.period,
		algorithm: secret.algorithm,
		counter: secret.counter,
	}));

	// 按ID排序确保一致性
	hashData.sort((a, b) => (a.id || '').localeCompare(b.id || ''));

	// 生成 JSON 字符串
	const dataString = JSON.stringify(hashData);

	// 调试：输出前3个密钥的关键信息用于哈希计算
	if (hashData.length > 0 && logger) {
		const sampleData = hashData.slice(0, 3).map((item) => ({
			name: item.name,
			account: item.account || '',
			type: item.type,
			secretLength: item.secret?.length || 0,
		}));
		logger.debug('哈希计算数据样本', { sampleData });
	}

	// 使用 Web Crypto API 的 SHA-256 计算哈希
	const encoder = new TextEncoder();
	const data = encoder.encode(dataString);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);

	// 转换为十六进制字符串
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

	if (logger) {
		logger.debug('SHA-256 哈希生成', {
			hashPreview: hashHex.substring(0, 16) + '...',
			secretCount: secrets.length,
		});
	}

	return hashHex;
}

/**
 * 检查数据是否发生变化
 * @param {Object} env - 环境变量对象
 * @param {Array} currentSecrets - 当前密钥数据
 * @returns {Promise<boolean>} 数据是否发生变化
 */
async function _hasDataChanged(env, currentSecrets) {
	const logger = getLogger(env);

	try {
		// 计算当前数据的哈希值（使用 SHA-256）
		const currentHash = await generateDataHash(currentSecrets, env);

		// 获取上次备份时的数据哈希值
		const lastHash = await env.SECRETS_KV.get('last_backup_hash');

		logger.info('数据变化检测开始', {
			currentHashPreview: currentHash.substring(0, 16) + '...',
			lastHashPreview: lastHash ? lastHash.substring(0, 16) + '...' : 'null',
			currentSecretCount: currentSecrets.length,
		});

		// 如果没有上次的哈希值，说明是第一次备份，应该执行备份
		if (!lastHash) {
			logger.info('首次备份检测', {
				reason: '没有找到上次备份的哈希值',
			});
			return true;
		}

		// 比较哈希值
		const hasChanged = currentHash !== lastHash;

		logger.info('哈希值比较完成', {
			hasChanged,
			currentHash: currentHash.substring(0, 16) + '...',
			lastHash: lastHash.substring(0, 16) + '...',
		});

		// 如果数据没有变化，但密钥数量不同，也认为有变化
		if (!hasChanged && currentSecrets.length > 0) {
			// 获取最新备份的密钥数量进行比较
			try {
				const list = await env.SECRETS_KV.list();
				const backupKeys = list.keys.filter((key) => key.name.startsWith('backup_'));
				if (backupKeys.length > 0) {
					backupKeys.sort((a, b) => b.name.localeCompare(a.name));
					const latestBackupKey = backupKeys[0].name;
					const latestBackup = await env.SECRETS_KV.get(latestBackupKey, 'json');

					if (latestBackup && latestBackup.count !== currentSecrets.length) {
						logger.info('密钥数量发生变化', {
							currentCount: currentSecrets.length,
							lastBackupCount: latestBackup.count,
							difference: currentSecrets.length - latestBackup.count,
						});
						return true;
					} else if (latestBackup) {
						logger.debug('密钥数量未变化', {
							currentCount: currentSecrets.length,
							lastBackupCount: latestBackup.count,
						});
					}
				}
			} catch (error) {
				logger.warn('检查密钥数量变化失败', {}, error);
			}
		}

		const finalResult = hasChanged;
		logger.info('数据变化检测完成', {
			result: finalResult ? '需要备份' : '跳过备份',
			hasChanged,
			secretCount: currentSecrets.length,
		});

		return finalResult;
	} catch (error) {
		logger.error('检查数据变化失败', {}, error);
		// 如果检查失败，默认认为数据已变化，执行备份
		return true;
	}
}

/**
 * 保存当前数据的哈希值
 * @param {Object} env - 环境变量对象
 * @param {Array} secrets - 密钥数据
 */
export async function saveDataHash(env, secrets) {
	const logger = getLogger(env);

	try {
		const hash = await generateDataHash(secrets, env);
		await env.SECRETS_KV.put('last_backup_hash', hash);
		logger.info('数据哈希值已保存', {
			hashPreview: hash.substring(0, 16) + '...',
			secretCount: secrets.length,
		});
	} catch (error) {
		logger.error('保存数据哈希值失败', {}, error);
	}
}

/**
 * 清理旧备份文件（保留最新100个备份）
 * @param {Object} env - 环境变量对象
 */
async function cleanupOldBackups(env) {
	const logger = getLogger(env);

	try {
		const list = await env.SECRETS_KV.list();
		const backupKeys = list.keys.filter((key) => key.name.startsWith('backup_'));

		logger.info('检查备份文件', {
			totalBackups: backupKeys.length,
		});

		if (backupKeys.length <= 100) {
			logger.debug('备份文件数量正常', {
				current: backupKeys.length,
				max: 100,
			});
			return;
		}

		// 按文件名排序（文件名包含日期，最新的在前）
		backupKeys.sort((a, b) => b.name.localeCompare(a.name));

		// 保留最新的100个备份，删除其余的
		const keysToKeep = backupKeys.slice(0, 100);
		const keysToDelete = backupKeys.slice(100);

		logger.info('开始清理旧备份', {
			toKeep: keysToKeep.length,
			toDelete: keysToDelete.length,
		});

		for (const key of keysToDelete) {
			await env.SECRETS_KV.delete(key.name);
			logger.debug('删除旧备份', {
				backupKey: key.name,
			});
		}

		logger.info('清理旧备份完成', {
			deleted: keysToDelete.length,
			remaining: keysToKeep.length,
		});
	} catch (error) {
		logger.error('清理旧备份失败', {}, error);
	}
}

/**
 * Cloudflare Worker 主入口点
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象，包含KV存储等
 * @param {Object} ctx - 执行上下文
 * @returns {Response} HTTP响应
 */
export default {
	async fetch(request, env, _ctx) {
		// 初始化日志和监控
		const logger = getLogger(env);
		const requestLogger = createRequestLogger(logger);
		const monitoring = getMonitoring(env);

		// 初始化监控系统（仅首次）
		if (!monitoring._initialized) {
			await monitoring.initialize().catch((err) => {
				logger.warn('Failed to initialize monitoring', {}, err);
			});
			monitoring._initialized = true;
		}

		// 开始请求追踪
		const timer = requestLogger.logRequest(request, env);
		const traceId = monitoring.getPerformanceMonitor().startTrace(`${request.method} ${new URL(request.url).pathname}`, {
			method: request.method,
			url: request.url,
			userAgent: request.headers.get('user-agent'),
			cf: request.cf,
		});

		try {
			// 处理CORS预检请求
			const corsResponse = handleCORS(request);
			if (corsResponse) {
				monitoring.getPerformanceMonitor().endTrace(traceId, {
					type: 'cors-preflight',
					status: corsResponse.status,
				});
				return corsResponse;
			}

			// 处理实际请求
			const response = await handleRequest(request, env);

			// 记录响应
			requestLogger.logResponse(timer, response);
			monitoring.getPerformanceMonitor().endTrace(traceId, {
				status: response.status,
				success: response.status < 400,
			});

			return response;
		} catch (error) {
			// 捕获并记录错误
			logger.error(
				'Request handling failed',
				{
					method: request.method,
					url: request.url,
					traceId,
				},
				error,
			);

			// 发送到错误监控
			const errorInfo = monitoring.getErrorMonitor().captureError(
				error,
				{
					method: request.method,
					url: request.url,
					traceId,
					userAgent: request.headers.get('user-agent'),
				},
				ErrorSeverity.ERROR,
			);

			// 记录失败的追踪
			requestLogger.logResponse(timer, null, error);
			monitoring.getPerformanceMonitor().endTrace(traceId, {
				success: false,
				errorId: errorInfo.errorId,
			});

			// 返回错误响应
			return new Response(
				JSON.stringify({
					error: '服务器错误',
					message: '请求处理失败，请稍后重试',
					errorId: errorInfo.errorId,
					timestamp: new Date().toISOString(),
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						'X-Error-Id': errorInfo.errorId,
					},
				},
			);
		}
	},

	/**
	 * 定时任务处理函数
	 * 定时自动备份密钥（仅在数据发生变化时执行）
	 * @param {Object} event - 定时事件对象
	 * @param {Object} env - 环境变量对象
	 * @param {Object} ctx - 执行上下文
	 */
	async scheduled(event, env, _ctx) {
		const logger = getLogger(env);
		const timer = new PerformanceTimer('ScheduledBackup', logger);

		try {
			logger.info('定时备份任务开始', {
				scheduledTime: new Date().toISOString(),
				cron: event.cron || 'manual',
			});

			// 获取所有密钥
			const secrets = await getAllSecrets(env);
			logger.info('获取密钥完成', {
				secretCount: secrets ? secrets.length : 0,
			});

			// 输出前几个密钥的详细信息用于调试
			if (secrets && secrets.length > 0) {
				const sampleSecrets = secrets.slice(0, 3).map((s) => ({
					id: s.id,
					name: s.name,
					account: s.account,
					type: s.type,
					hasUpdatedAt: !!s.updatedAt,
				}));
				logger.debug('密钥样本信息', { sampleSecrets });
			}

			if (!secrets || secrets.length === 0) {
				logger.info('没有密钥需要备份，任务结束');
				return;
			}

			// 强制检查数据变化（增强调试）
			logger.info('开始数据变化检测');
			timer.checkpoint('检测开始');

			const currentHash = await generateDataHash(secrets, env);
			const lastHash = await env.SECRETS_KV.get('last_backup_hash');

			logger.info('详细数据变化检测', {
				currentHashPreview: currentHash.substring(0, 16) + '...',
				lastHashPreview: lastHash ? lastHash.substring(0, 16) + '...' : 'null',
				secretCount: secrets.length,
			});

			// 如果哈希值不存在或不匹配，强制执行备份
			const dataChanged = !lastHash || currentHash !== lastHash;
			logger.info('数据变化检测结果', {
				changed: dataChanged,
				reason: !lastHash ? '首次备份' : dataChanged ? '数据已变化' : '数据未变化',
			});

			if (!dataChanged) {
				logger.info('数据未变化，跳过备份', {
					tip: '如果修改了密钥但未触发备份，请检查 saveDataHash 调用',
				});
				timer.end({ skipped: true });
				return;
			}

			logger.info('检测到数据变化，开始创建备份');
			timer.checkpoint('开始备份');

			// 创建备份数据结构
			const backupData = {
				timestamp: new Date().toISOString(),
				version: '1.0',
				count: secrets.length,
				secrets: secrets,
			};

			// 生成备份文件名（按日期和时间戳）
			const now = new Date();
			const dateStr = now.toISOString().split('T')[0];
			const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
			const backupKey = `backup_${dateStr}_${timeStr}.json`;

			// 🔒 加密备份数据（如果配置了 ENCRYPTION_KEY）
			let backupContent;
			let isEncrypted = false;

			if (env.ENCRYPTION_KEY) {
				// 加密整个备份对象
				backupContent = await encryptData(backupData, env);
				isEncrypted = true;
				logger.info('备份数据已加密', {
					backupKey,
					encrypted: true,
				});
			} else {
				// 向后兼容：如果没有配置加密密钥，仍然以明文保存
				backupContent = JSON.stringify(backupData, null, 2);
				logger.warn('备份数据以明文保存', {
					backupKey,
					reason: '未配置 ENCRYPTION_KEY',
				});
			}

			// 存储备份到KV
			await env.SECRETS_KV.put(backupKey, backupContent);
			timer.checkpoint('备份已保存');

			logger.info('自动备份完成', {
				backupKey,
				secretCount: secrets.length,
				encrypted: isEncrypted,
			});

			// 保存当前数据的哈希值
			logger.debug('更新数据哈希值');
			await saveDataHash(env, secrets);
			timer.checkpoint('哈希已更新');

			// 清理旧备份（保留最新100个备份）
			logger.debug('清理旧备份文件');
			await cleanupOldBackups(env);
			timer.checkpoint('清理完成');

			const duration = timer.end({
				success: true,
				backupKey,
				secretCount: secrets.length,
			});

			logger.info('定时备份任务执行完成', {
				duration,
				backupKey,
			});
		} catch (error) {
			logger.error(
				'定时备份任务执行失败',
				{
					duration: timer.getDuration(),
				},
				error,
			);
			timer.end({ success: false, error: error.message });
		}
	},
};
