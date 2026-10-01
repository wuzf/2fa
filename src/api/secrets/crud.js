/**
 * CRUD 操作处理器 - 密钥的创建、读取、更新、删除
 *
 * 包含功能:
 * - handleGetSecrets: 获取所有密钥列表
 * - handleAddSecret: 添加新密钥
 * - handleUpdateSecret: 更新现有密钥
 * - handleDeleteSecret: 删除密钥 (带 Rate Limiting)
 */

import { saveSecretsToKV, getAllSecrets, decodeSecretIdSegment } from './shared.js';
import { deleteHOTPCounterState, generateHOTPGenerationHash } from './counter-state.js';
import { getLogger } from '../../utils/logger.js';
import { PerformanceTimer } from '../../utils/logger.js';
import { getMonitoring, ErrorSeverity } from '../../utils/monitoring.js';
import {
	validateRequest,
	addSecretSchema,
	checkDuplicateSecret,
	createEditSecretSchema,
	findDuplicateSecret,
	hasSameOtpParameters,
	validateBase32,
} from '../../utils/validation.js';
import { createJsonResponse, createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import { getSecurityHeaders } from '../../utils/security.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';
import {
	ValidationError,
	NotFoundError,
	ConflictError,
	StorageError,
	CryptoError,
	ConfigurationError,
	ErrorFactory,
	errorToResponse,
	logError,
} from '../../utils/errors.js';

function ensureNoStore(response, request) {
	if (request) {
		for (const name of [...response.headers.keys()]) {
			if (name.startsWith('access-control-')) {
				response.headers.delete(name);
			}
		}
		for (const [name, value] of Object.entries(getSecurityHeaders(request))) {
			response.headers.set(name, value);
		}
	}
	response.headers.set('Cache-Control', 'no-store');
	return response;
}

/**
 * 获取所有密钥列表
 *
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Request|null} request - HTTP 请求，用于生成安全响应头
 * @returns {Response} 密钥列表响应
 */
export async function handleGetSecrets(env, request = null) {
	const logger = getLogger(env);
	const timer = new PerformanceTimer('GetSecrets', logger);

	try {
		const secrets = await getAllSecrets(env);
		timer.checkpoint('Fetched, decrypted, and overlaid');

		timer.end({ count: secrets.length });

		return createJsonResponse(secrets, 200, request, { 'Cache-Control': 'no-store' });
	} catch (error) {
		timer.cancel();

		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ValidationError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleGetSecrets' });
			getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleGetSecrets' }, ErrorSeverity.ERROR);
			return ensureNoStore(errorToResponse(error, request), request);
		}

		// 未知错误
		logger.error('获取密钥列表失败', { operation: 'handleGetSecrets' }, error);
		getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleGetSecrets' }, ErrorSeverity.ERROR);
		return ensureNoStore(createErrorResponse('获取密钥列表失败', `从存储中获取密钥时发生错误: ${error.message}`, 500, request), request);
	}
}

/**
 * 添加新密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} 添加结果响应
 */
export async function handleAddSecret(request, env, ctx) {
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
		const duplicate = findDuplicateSecret(existingSecrets, secretData.name, secretData.account, secretData.secret);

		if (duplicate) {
			throw new ConflictError(`服务"${secretData.name}"${secretData.account ? ` (账户: ${secretData.account})` : ''} 已存在`, {
				operation: 'addSecret',
				name: secretData.name,
				account: secretData.account,
				// true: the existing record generates the same codes, so a replayed add has already been applied.
				identical: hasSameOtpParameters(duplicate, secretData),
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
		await saveSecretsToKV(env, existingSecrets, 'secret-added', {}, ctx);

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
			error instanceof CryptoError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleAddSecret' });
			getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleAddSecret' }, ErrorSeverity.WARNING);
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error('添加密钥失败', { operation: 'handleAddSecret', errorMessage: error.message }, error);
		getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleAddSecret' }, ErrorSeverity.ERROR);
		return createErrorResponse('添加密钥失败', `添加密钥时发生内部错误`, 500, request);
	}
}

/**
 * 更新现有密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} 更新结果响应
 */
export async function handleUpdateSecret(request, env, ctx) {
	const logger = getLogger(env);

	try {
		const url = new URL(request.url);
		const secretId = decodeSecretIdSegment(url.pathname.split('/').pop());
		if (secretId === null) {
			return createErrorResponse('无效路径', '路径中的密钥ID编码无效', 400, request);
		}

		// 先读取现有记录：校验规则需要知道记录当前保存的周期
		const existingSecrets = await getAllSecrets(env);

		// 查找要更新的密钥
		const secretIndex = existingSecrets.findIndex((s) => s.id === secretId);
		if (secretIndex === -1) {
			throw ErrorFactory.secretNotFound(secretId, {
				operation: 'updateSecret',
			});
		}

		// 🔍 使用验证中间件解析和验证请求（原样提交的非标准 TOTP 周期视为保留原值）
		const secretData = await validateRequest(createEditSecretSchema(existingSecrets[secretIndex]))(request);
		if (secretData instanceof Response) {
			return secretData;
		} // 验证失败

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
		const existingWasHOTP = String(existingSecret.type || '').toUpperCase() === 'HOTP';
		const sameHOTPGeneration =
			existingWasHOTP &&
			secretData.type === 'HOTP' &&
			(await generateHOTPGenerationHash(existingSecret)) === (await generateHOTPGenerationHash(secretData));
		const existingCounter = Number.isSafeInteger(existingSecret.counter) && existingSecret.counter >= 0 ? existingSecret.counter : 0;
		if (sameHOTPGeneration && secretData.counter < existingCounter) {
			throw new ConflictError('HOTP计数器已推进，不能通过编辑操作降低计数器', {
				operation: 'updateSecret',
				secretId,
				requestedCounter: secretData.counter,
				currentCounter: existingCounter,
			});
		}
		const updatedCounter = secretData.type === 'HOTP' ? secretData.counter : undefined;

		// 检测内容是否实际发生变化（数据已经通过验证和规范化）
		const contentChanged =
			existingSecret.name !== secretData.name ||
			existingSecret.account !== secretData.account ||
			existingSecret.secret !== secretData.secret ||
			existingSecret.type !== secretData.type ||
			existingSecret.digits !== secretData.digits ||
			existingSecret.period !== secretData.period ||
			existingSecret.algorithm !== secretData.algorithm ||
			(secretData.type === 'HOTP' && existingSecret.counter !== updatedCounter);

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
			counter: updatedCounter,
			...(secretData.type === 'HOTP' && {
				hotpCounterNamespace: sameHOTPGeneration ? existingSecret.hotpCounterNamespace : crypto.randomUUID(),
			}),
		};

		existingSecrets[secretIndex] = updatedSecret;

		// A fresh namespace becomes active only with this base write. Keep the old
		// sidecar so a failed/interrupted write or an old request cannot lose state.
		await saveSecretsToKV(env, existingSecrets, 'secret-updated', {}, ctx);

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
			error instanceof CryptoError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleUpdateSecret' });
			getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleUpdateSecret' }, ErrorSeverity.WARNING);
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error('更新密钥失败', { operation: 'handleUpdateSecret', errorMessage: error.message }, error);
		getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleUpdateSecret' }, ErrorSeverity.ERROR);
		return createErrorResponse('更新密钥失败', `更新密钥时发生内部错误`, 500, request);
	}
}

/**
 * 删除密钥 (带 Rate Limiting)
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} 删除结果响应
 */
export async function handleDeleteSecret(request, env, ctx) {
	const logger = getLogger(env);

	try {
		// Rate Limiting: 敏感操作限流
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('删除密钥被限流', { clientIP, operation: 'handleDeleteSecret' });
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const url = new URL(request.url);
		const secretId = decodeSecretIdSegment(url.pathname.split('/').pop());
		if (secretId === null) {
			return createErrorResponse('无效路径', '路径中的密钥ID编码无效', 400, request);
		}

		// 获取现有密钥
		const existingSecrets = await getAllSecrets(env);

		// 查找要删除的密钥
		const secretIndex = existingSecrets.findIndex((s) => s.id === secretId);
		if (secretIndex === -1) {
			// Without the deleted object we cannot identify its namespace safely.
			// Unreferenced sidecars remain inactive, as with generation changes.
			throw ErrorFactory.secretNotFound(secretId, {
				operation: 'deleteSecret',
			});
		}

		const deletedSecret = existingSecrets[secretIndex];
		existingSecrets.splice(secretIndex, 1);

		// 保存到 KV (自动加密、排序、触发备份)
		await saveSecretsToKV(env, existingSecrets, 'secret-deleted', {}, ctx);
		try {
			await deleteHOTPCounterState(env, deletedSecret);
		} catch (cleanupError) {
			// The secret is already deleted. Its counter record is no longer referenced by
			// any secret and is removed by the next counter cleanup.
			logger.warn('删除HOTP计数器记录失败，密钥已删除', { secretId: deletedSecret.id, errorMessage: cleanupError.message });
		}

		logger.info('密钥删除成功', {
			operation: 'handleDeleteSecret',
			secretId: deletedSecret.id,
			name: deletedSecret.name,
		});

		return createSuccessResponse({ id: secretId }, '密钥删除成功', request);
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof NotFoundError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleDeleteSecret' });
			getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleDeleteSecret' }, ErrorSeverity.WARNING);
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error('删除密钥失败', { operation: 'handleDeleteSecret', errorMessage: error.message }, error);
		getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleDeleteSecret' }, ErrorSeverity.ERROR);
		return createErrorResponse('删除密钥失败', `删除密钥操作时发生内部错误`, 500, request);
	}
}
