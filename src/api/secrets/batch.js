/**
 * 批量导入处理器 - 批量添加密钥
 *
 * 包含功能:
 * - handleBatchAddSecrets: 批量导入密钥（带 Rate Limiting）
 */

import { saveSecretsToKV } from './shared.js';
import { decryptSecrets } from '../../utils/encryption.js';
import { getLogger } from '../../utils/logger.js';
import { validateRequest, batchImportSchema, addSecretSchema, checkDuplicateSecret } from '../../utils/validation.js';
import { createJsonResponse, createErrorResponse } from '../../utils/response.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';
import { ValidationError, StorageError, CryptoError, ConfigurationError, errorToResponse, logError } from '../../utils/errors.js';
import { KV_KEYS } from '../../utils/constants.js';

/**
 * 批量添加密钥 (带 Rate Limiting)
 *
 * 处理流程:
 * 1. Rate limiting 检查（防止批量操作滥用）
 * 2. 验证输入数据格式
 * 3. 逐个验证和创建密钥对象
 * 4. 检查重复
 * 5. 一次性保存所有成功的密钥
 * 6. 返回详细的成功/失败统计
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} 批量导入结果响应
 */
export async function handleBatchAddSecrets(request, env, ctx) {
	const logger = getLogger(env);

	try {
		// 🛡️ Rate Limiting: 防止批量操作滥用
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.bulk);

		if (!rateLimitInfo.allowed) {
			logger.warn('批量添加速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo);
		}

		// 🔍 使用验证中间件解析和验证请求（仅验证顶层结构）
		const data = await validateRequest(batchImportSchema)(request);
		if (data instanceof Response) {
			return data;
		} // 验证失败

		const { secrets } = data;

		// 从KV存储获取现有密钥列表（可能是加密的）
		const existingSecretsData = await env.SECRETS_KV.get(KV_KEYS.SECRETS, 'text');
		const existingSecrets = await decryptSecrets(existingSecretsData, env);

		const results = [];
		let successCount = 0;
		let failCount = 0;

		// 批量处理所有密钥（逐个验证）
		for (let i = 0; i < secrets.length; i++) {
			const secretData = secrets[i];

			try {
				// 验证单个密钥数据
				const validation = addSecretSchema.validate(secretData);
				if (!validation.valid) {
					results.push({
						index: i,
						success: false,
						error: validation.errors.join('; '),
					});
					failCount++;
					continue;
				}

				const validated = validation.data;

				// 检查是否已存在完全相同的密钥（服务名+账户+密钥都相同）
				if (checkDuplicateSecret(existingSecrets, validated.name, validated.account, validated.secret)) {
					results.push({
						index: i,
						success: false,
						error: `服务"${validated.name}"${validated.account ? `的账户"${validated.account}"` : ''}密钥已存在`,
					});
					failCount++;
					continue;
				}

				// 创建新密钥对象（数据已经通过验证和规范化）
				const newSecret = {
					id: crypto.randomUUID(),
					name: validated.name,
					account: validated.account,
					secret: validated.secret,
					type: validated.type,
					digits: validated.digits,
					period: validated.period,
					algorithm: validated.algorithm,
					counter: validated.type === 'HOTP' ? validated.counter : undefined,
				};

				// 添加到现有列表
				existingSecrets.push(newSecret);
				results.push({
					index: i,
					success: true,
					secret: newSecret,
				});
				successCount++;
			} catch (error) {
				results.push({
					index: i,
					success: false,
					error: error.message,
				});
				failCount++;
			}
		}

		// 一次性保存所有密钥到KV存储（自动排序）
		// 🔄 触发事件驱动备份（批量导入使用 immediate: true 强制立即备份）
		await saveSecretsToKV(env, existingSecrets, 'batch-import', { immediate: true }, ctx);

		logger.info('✅ 批量导入完成', {
			successCount,
			failCount,
			totalCount: secrets.length,
		});

		return createJsonResponse(
			{
				success: true,
				message: `批量导入完成: 成功 ${successCount} 个, 失败 ${failCount} 个`,
				successCount,
				failCount,
				totalCount: secrets.length,
				results,
			},
			200,
			request,
		);
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleBatchAddSecrets' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'批量导入失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('批量导入失败', `批量导入密钥时发生内部错误：${error.message}`, 500, request);
	}
}
