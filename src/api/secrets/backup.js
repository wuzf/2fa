/**
 * 备份处理器 - 备份创建和获取
 *
 * 包含功能:
 * - handleBackupSecrets: 创建新备份（带 Rate Limiting）
 * - handleGetBackups: 获取备份列表
 * - parseBackupTimeFromKey: 从备份文件名解析时间
 *
 * 注意: 备份使用 encryptData/decryptData（加密整个对象）
 *       与 CRUD 的 encryptSecrets/decryptSecrets（加密数组）不同
 */

import { getAllSecrets } from './shared.js';
import { getLogger } from '../../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';
import { encryptData, decryptData } from '../../utils/encryption.js';
import { createJsonResponse, createErrorResponse } from '../../utils/response.js';
import { saveDataHash } from '../../worker.js';
import { ValidationError, StorageError, CryptoError, BusinessLogicError, errorToResponse, logError } from '../../utils/errors.js';

/**
 * 处理手动备份密钥
 * 🔒 备份数据也会加密存储（使用 encryptData）
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response} HTTP响应
 */
export async function handleBackupSecrets(request, env) {
	const logger = getLogger(env);

	try {
		// 🛡️ Rate Limiting: 防止频繁备份滥用
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('备份操作速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo);
		}

		logger.info('开始执行手动备份任务', {
			clientIP,
			timestamp: new Date().toISOString(),
		});

		// 获取所有密钥（已解密）
		const secrets = await getAllSecrets(env);

		if (secrets && secrets.length > 0) {
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
				// 向后兼容:如果没有配置加密密钥，仍然以明文保存
				backupContent = JSON.stringify(backupData, null, 2);
				logger.warn('备份数据以明文保存', {
					backupKey,
					reason: '未配置 ENCRYPTION_KEY',
				});
			}

			// 存储备份到KV
			await env.SECRETS_KV.put(backupKey, backupContent);

			logger.info('手动备份完成', {
				backupKey,
				secretCount: secrets.length,
				encrypted: isEncrypted,
			});

			// 更新数据哈希值（手动备份也需要更新哈希值）
			await saveDataHash(env, secrets);

			return createJsonResponse({
				success: true,
				message: `备份完成，共备份 ${secrets.length} 个密钥`,
				backupKey: backupKey,
				count: secrets.length,
				timestamp: backupData.timestamp,
				encrypted: isEncrypted,
			});
		} else {
			throw new BusinessLogicError('没有密钥需要备份', {
				operation: 'backup',
				secretsCount: 0,
			});
		}
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (error instanceof BusinessLogicError || error instanceof StorageError || error instanceof CryptoError) {
			logError(error, logger, { operation: 'handleBackupSecrets' });
			return errorToResponse(error);
		}

		// 未知错误
		logger.error(
			'手动备份任务执行失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('备份失败', `备份过程中发生错误：${error.message}`, 500);
	}
}

/**
 * 从备份文件名解析时间
 *
 * @param {string} keyName - 备份文件名，如 backup_2025-09-14_07-52-16.json
 * @returns {string} ISO时间字符串，解析失败时返回 'unknown'
 */
function parseBackupTimeFromKey(keyName) {
	try {
		// 解析 backup_2025-09-14_07-52-16.json 格式
		const match = keyName.match(/backup_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.json/);
		if (match) {
			const dateStr = match[1]; // 2025-09-14
			const timeStr = match[2]; // 07-52-16
			const isoTime = `${dateStr}T${timeStr.replace(/-/g, ':')}.000Z`;
			return isoTime;
		}

		// 兼容旧格式 backup_2025-09-14.json
		const oldMatch = keyName.match(/backup_(\d{4}-\d{2}-\d{2})\.json/);
		if (oldMatch) {
			return `${oldMatch[1]}T00:00:00.000Z`;
		}

		return 'unknown';
	} catch {
		// 解析失败时返回默认值（静默处理，避免日志污染）
		return 'unknown';
	}
}

/**
 * 处理获取备份列表
 * 🔒 检测并显示备份的加密状态
 * ⚡ 性能优化：使用KV原生prefix过滤和分页
 *
 * 查询参数:
 * - limit: 返回的备份数量（默认50，最大1000，或者使用 'all'/'0' 加载所有）
 * - cursor: 分页游标（用于获取下一页，仅在非loadAll模式下有效）
 * - details: 是否获取详细信息（默认true）
 *
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response} HTTP响应
 */
export async function handleGetBackups(request, env) {
	const logger = getLogger(env);

	try {
		// 解析查询参数
		const url = new URL(request.url);
		const limitParam = url.searchParams.get('limit') || '50';
		const cursor = url.searchParams.get('cursor') || undefined;
		const includeDetails = url.searchParams.get('details') !== 'false';

		// 支持 limit=all 或 limit=0 来加载所有备份
		let limit;
		let loadAll = false;

		if (limitParam.toLowerCase() === 'all' || limitParam === '0') {
			loadAll = true;
			limit = 1000; // KV list() 单次最大限制
		} else {
			// 移除100的限制，允许更大的值（最大1000，KV的单次限制）
			limit = Math.min(parseInt(limitParam, 10), 1000);
		}

		logger.debug('获取备份列表', { limit, loadAll, cursor, includeDetails });

		// ⚡ 使用KV原生prefix过滤，避免内存过滤
		const listOptions = {
			prefix: 'backup_',
			limit: limit,
		};

		if (cursor && !loadAll) {
			listOptions.cursor = cursor;
		}

		// 🔄 如果需要加载所有备份，循环获取所有分页
		let allBackupKeys = [];
		let currentCursor = cursor;
		let hasMore = true;

		if (loadAll) {
			// 循环获取所有备份，直到没有更多数据
			while (hasMore) {
				const pageOptions = {
					prefix: 'backup_',
					limit: 1000, // 每页最大1000
				};

				if (currentCursor) {
					pageOptions.cursor = currentCursor;
				}

				const pageResult = await env.SECRETS_KV.list(pageOptions);
				allBackupKeys = allBackupKeys.concat(pageResult.keys);

				hasMore = !pageResult.list_complete;
				currentCursor = pageResult.cursor;

				logger.debug('获取备份分页', {
					pageSize: pageResult.keys.length,
					totalSoFar: allBackupKeys.length,
					hasMore,
				});
			}
		} else {
			// 单次获取（分页模式）
			const listResult = await env.SECRETS_KV.list(listOptions);
			allBackupKeys = listResult.keys;
			hasMore = !listResult.list_complete;
			currentCursor = listResult.cursor;
		}

		const backupKeys = allBackupKeys;

		// 备份key格式: backup_YYYY-MM-DD_HH-MM-SS.json
		// 天然按时间顺序排列，但我们需要倒序（最新的在前）

		// 🔄 倒序排列（最新的在前）
		// 由于key名称格式为 backup_YYYY-MM-DD_HH-MM-SS.json
		// 字典序倒序即为时间倒序
		backupKeys.reverse();

		let backupDetails;

		if (includeDetails) {
			// 详细模式：获取每个备份的count和加密状态
			backupDetails = await Promise.all(
				backupKeys.map(async (key) => {
					try {
						const backupContent = await env.SECRETS_KV.get(key.name, 'text');

						// 🔒 检测备份是否加密
						const isEncrypted = backupContent && backupContent.startsWith('v1:');

						let count = 0;
						if (isEncrypted) {
							// 加密的备份，需要解密才能获取数量
							try {
								const decryptedData = await decryptData(backupContent, env);
								count = decryptedData?.secrets?.length || decryptedData?.count || 0;
							} catch (error) {
								logger.error(
									'解密备份失败',
									{
										backupKey: key.name,
										errorMessage: error.message,
									},
									error,
								);
								count = -1; // 表示无法读取
							}
						} else {
							// 明文备份，直接解析
							try {
								const backupData = JSON.parse(backupContent);
								count = backupData?.secrets?.length || 0;
							} catch (error) {
								logger.error(
									'解析备份失败',
									{
										backupKey: key.name,
										errorMessage: error.message,
									},
									error,
								);
								count = -1;
							}
						}

						return {
							key: key.name,
							created: key.metadata?.created || parseBackupTimeFromKey(key.name),
							count: count,
							encrypted: isEncrypted,
							size: backupContent?.length || 0,
							metadata: key.metadata,
						};
					} catch (error) {
						logger.error(
							'获取备份详情失败',
							{
								backupKey: key.name,
								errorMessage: error.message,
							},
							error,
						);
						return {
							key: key.name,
							created: key.metadata?.created || 'unknown',
							count: -1,
							encrypted: false,
							size: 0,
							metadata: key.metadata,
						};
					}
				}),
			);
		} else {
			// 简单模式：仅返回key和时间戳，不读取备份内容
			backupDetails = backupKeys.map((key) => ({
				key: key.name,
				created: key.metadata?.created || parseBackupTimeFromKey(key.name),
				metadata: key.metadata,
			}));
		}

		const response = {
			success: true,
			backups: backupDetails,
			count: backupDetails.length,
			pagination: {
				limit: loadAll ? backupDetails.length : limit,
				hasMore: loadAll ? false : hasMore,
				cursor: loadAll ? null : currentCursor || null,
				loadedAll: loadAll,
			},
		};

		logger.info('备份列表获取成功', {
			count: backupDetails.length,
			includeDetails,
			loadAll,
			hasMore: loadAll ? false : hasMore,
		});

		return createJsonResponse(response, 200, request);
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (error instanceof StorageError || error instanceof CryptoError || error instanceof ValidationError) {
			logError(error, logger, { operation: 'handleGetBackups' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'获取备份列表失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('获取备份列表失败', `获取备份列表时发生错误：${error.message}`, 500, request);
	}
}
