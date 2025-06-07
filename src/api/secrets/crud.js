/**
 * CRUD 操作处理器 - 密钥的创建、读取、更新、删除
 *
 * 包含功能:
 * - handleGetSecrets: 获取所有密钥列表
 * - handleAddSecret: 添加新密钥
 * - handleUpdateSecret: 更新现有密钥
 * - handleDeleteSecret: 删除密钥 (带 Rate Limiting)
 */

import { saveSecretsToKV, getAllSecrets } from './shared.js';
import { decryptSecrets } from '../../utils/encryption.js';
import { getLogger } from '../../utils/logger.js';
import { PerformanceTimer } from '../../utils/logger.js';
import { getMonitoring, ErrorSeverity } from '../../utils/monitoring.js';
import { validateRequest, addSecretSchema, checkDuplicateSecret, validateBase32 } from '../../utils/validation.js';
import { createJsonResponse, createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';
import {
	ValidationError,
	NotFoundError,
	ConflictError,
	StorageError,
	CryptoError,
	ErrorFactory,
	errorToResponse,
	logError,
} from '../../utils/errors.js';
import { KV_KEYS } from '../../utils/constants.js';

const monitoring = getMonitoring();

/**
 * 获取所有密钥列表
 *
 * @param {Object} env - Cloudflare Workers 环境对象
 * @returns {Response} 密钥列表响应
 */
export async function handleGetSecrets(env) {
	const logger = getLogger(env);
	const timer = new PerformanceTimer('GetSecrets', logger);

	try {
		const secretsData = await env.SECRETS_KV.get(KV_KEYS.SECRETS, 'text');
		timer.checkpoint('KV fetched');

		const secrets = await decryptSecrets(secretsData, env);
		timer.checkpoint('Decrypted');

		timer.end({ count: secrets.length });

		return createJsonResponse(secrets);
	} catch (error) {
		timer.cancel();

		// 如果是已知的错误类型，记录并转换
		if (error instanceof StorageError || error instanceof CryptoError || error instanceof ValidationError) {
			logError(error, logger, { operation: 'handleGetSecrets' });
			if (monitoring && monitoring.getErrorMonitor) {
				monitoring.getErrorMonitor().captureError(error, { operation: 'handleGetSecrets' }, ErrorSeverity.ERROR);
			}
			return errorToResponse(error);
		}

		// 未知错误
		logger.error('获取密钥列表失败', { operation: 'handleGetSecrets' }, error);
		if (monitoring && monitoring.getErrorMonitor) {
			monitoring.getErrorMonitor().captureError(error, { operation: 'handleGetSecrets' }, ErrorSeverity.ERROR);
		}
		return createErrorResponse('获取密钥列表失败', `从存储中获取密钥时发生错误: ${error.message}`, 500);
	}
}

/**
 * 添加新密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @returns {Response} 添加结果响应
 */
export async function handleAddSecret(request, env) {
	const logger = getLogger(env);

	try {
		// 🔍 使用验证中间件解析和验证请求
		const secretData = await validateRequest(addSecretSchema)(request);
		if (secretData instanceof Response) {
			return secretData;
		} // 验证失败

		// 获取现有密钥
		const existingSecrets = await getAllSecrets(env);

		// 检查重复（服务名+账户+密钥都相同才视为重复）
		const isDuplicate = checkDuplicateSecret(existingSecrets, secretData.name, secretData.account, secretData.secret);

		if (isDuplicate) {
			throw new ConflictError(`服务"${secretData.name}"${secretData.account ? ` (账户: ${secretData.account})` : ''} 已存在`, {
				operation: 'addSecret',
				name: secretData.name,
				account: secretData.account,
			});
		}

		// 创建密钥对象（数据已经通过验证和转换）
		const newSecret = {
			id: crypto.randomUUID(),
			name: secretData.name,
			account: secretData.account,
			secret: secretData.secret,
			type: secretData.type,
			digits: secretData.digits,
			period: secretData.period,
			algorithm: secretData.algorithm,
			counter: secretData.type === 'HOTP' ? secretData.counter : undefined,
		};

		existingSecrets.push(newSecret);

		// 保存到 KV (自动加密、排序、触发备份)
		await saveSecretsToKV(env, existingSecrets, 'secret-added');

		logger.info('密钥添加成功', {
			operation: 'handleAddSecret',
			secretId: newSecret.id,
			name: newSecret.name,
		});

		// 检查是否有密钥强度警告
		const validation = validateBase32(secretData.secret);
		const responseData = {
			success: true,
			message: validation.warning ? `⚠️ 密钥添加成功，但${validation.warning}` : '密钥添加成功',
			data: { secret: newSecret },
		};

		if (validation.warning) {
			responseData.data.warning = validation.warning;
		}

		return createJsonResponse(responseData, 201, request);
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof ConflictError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError
		) {
			logError(error, logger, { operation: 'handleAddSecret' });
			if (monitoring && monitoring.getErrorMonitor) {
				monitoring.getErrorMonitor().captureError(error, { operation: 'handleAddSecret' }, ErrorSeverity.WARNING);
			}
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error('添加密钥失败', { operation: 'handleAddSecret', errorMessage: error.message }, error);
		if (monitoring && monitoring.getErrorMonitor) {
			monitoring.getErrorMonitor().captureError(error, { operation: 'handleAddSecret' }, ErrorSeverity.ERROR);
		}
		return createErrorResponse('添加密钥失败', `添加密钥时发生内部错误`, 500, request);
	}
}

/**
 * 更新现有密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @returns {Response} 更新结果响应
 */
export async function handleUpdateSecret(request, env) {
	const logger = getLogger(env);

	try {
		const url = new URL(request.url);
		const secretId = url.pathname.split('/').pop();

		// 🔍 使用验证中间件解析和验证请求
		const secretData = await validateRequest(addSecretSchema)(request);
		if (secretData instanceof Response) {
			return secretData;
		} // 验证失败

		// 获取现有密钥
		const existingSecrets = await getAllSecrets(env);

		// 查找要更新的密钥
		const secretIndex = existingSecrets.findIndex((s) => s.id === secretId);
		if (secretIndex === -1) {
			throw ErrorFactory.secretNotFound(secretId, {
				operation: 'updateSecret',
			});
		}

		// 检查是否与其他密钥重复（排除自己，服务名+账户+密钥都相同才视为重复）
		const isDuplicate = checkDuplicateSecret(existingSecrets, secretData.name, secretData.account, secretData.secret, secretIndex);

		if (isDuplicate) {
			throw new ConflictError(`服务"${secretData.name}"${secretData.account ? ` (账户: ${secretData.account})` : ''} 已被其他密钥使用`, {
				operation: 'updateSecret',
				name: secretData.name,
				account: secretData.account,
			});
		}

		const existingSecret = existingSecrets[secretIndex];

		// 检测内容是否实际发生变化（数据已经通过验证和规范化）
		const contentChanged =
			existingSecret.name !== secretData.name ||
			existingSecret.account !== secretData.account ||
			existingSecret.secret !== secretData.secret ||
			existingSecret.type !== secretData.type ||
			existingSecret.digits !== secretData.digits ||
			existingSecret.period !== secretData.period ||
			existingSecret.algorithm !== secretData.algorithm ||
			(secretData.type === 'HOTP' && existingSecret.counter !== secretData.counter);

		// 更新密钥对象
		const updatedSecret = {
			id: secretId, // 保留原 ID
			name: secretData.name,
			account: secretData.account,
			secret: secretData.secret,
			type: secretData.type,
			digits: secretData.digits,
			period: secretData.period,
			algorithm: secretData.algorithm,
			counter: secretData.type === 'HOTP' ? secretData.counter : undefined,
		};

		existingSecrets[secretIndex] = updatedSecret;

		// 保存到 KV (自动加密、排序、触发备份)
		await saveSecretsToKV(env, existingSecrets, 'secret-updated');

		logger.info('密钥更新成功', {
			operation: 'handleUpdateSecret',
			secretId: updatedSecret.id,
			name: updatedSecret.name,
			contentChanged,
		});

		return createSuccessResponse({ secret: updatedSecret }, '密钥更新成功', request);
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof NotFoundError ||
			error instanceof ConflictError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError
		) {
			logError(error, logger, { operation: 'handleUpdateSecret' });
			if (monitoring && monitoring.getErrorMonitor) {
				monitoring.getErrorMonitor().captureError(error, { operation: 'handleUpdateSecret' }, ErrorSeverity.WARNING);
			}
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error('更新密钥失败', { operation: 'handleUpdateSecret', errorMessage: error.message }, error);
		if (monitoring && monitoring.getErrorMonitor) {
			monitoring.getErrorMonitor().captureError(error, { operation: 'handleUpdateSecret' }, ErrorSeverity.ERROR);
		}
		return createErrorResponse('更新密钥失败', `更新密钥时发生内部错误`, 500, request);
	}
}

/**
 * 删除密钥 (带 Rate Limiting)
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @returns {Response} 删除结果响应
 */
export async function handleDeleteSecret(request, env) {
	const logger = getLogger(env);

	try {
		// Rate Limiting: 敏感操作限流
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('删除密钥被限流', { clientIP, operation: 'handleDeleteSecret' });
			return createRateLimitResponse(rateLimitInfo);
		}

		const url = new URL(request.url);
		const secretId = url.pathname.split('/').pop();

		// 获取现有密钥
		const existingSecrets = await getAllSecrets(env);

		// 查找要删除的密钥
		const secretIndex = existingSecrets.findIndex((s) => s.id === secretId);
		if (secretIndex === -1) {
			throw ErrorFactory.secretNotFound(secretId, {
				operation: 'deleteSecret',
			});
		}

		const deletedSecret = existingSecrets[secretIndex];
		existingSecrets.splice(secretIndex, 1);

		// 保存到 KV (自动加密、排序、触发备份)
		await saveSecretsToKV(env, existingSecrets, 'secret-deleted');

		logger.info('密钥删除成功', {
			operation: 'handleDeleteSecret',
			secretId: deletedSecret.id,
			name: deletedSecret.name,
		});

		return createSuccessResponse({ id: secretId }, '密钥删除成功');
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof NotFoundError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError
		) {
			logError(error, logger, { operation: 'handleDeleteSecret' });
			if (monitoring && monitoring.getErrorMonitor) {
				monitoring.getErrorMonitor().captureError(error, { operation: 'handleDeleteSecret' }, ErrorSeverity.WARNING);
			}
			return errorToResponse(error);
		}

		// 未知错误
		logger.error('删除密钥失败', { operation: 'handleDeleteSecret', errorMessage: error.message }, error);
		if (monitoring && monitoring.getErrorMonitor) {
			monitoring.getErrorMonitor().captureError(error, { operation: 'handleDeleteSecret' }, ErrorSeverity.ERROR);
		}
		return createErrorResponse('删除密钥失败', `删除密钥操作时发生内部错误`, 500);
	}
}
