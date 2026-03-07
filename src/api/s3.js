/**
 * S3 配置 API 端点
 * 提供 S3 兼容存储配置的 CRUD 操作和连接测试
 *
 * 所有写操作接口使用 checkRateLimit + RATE_LIMIT_PRESETS.sensitive
 */

import { getS3Config, saveS3Config, testS3Connection } from '../utils/s3.js';
import { getLogger } from '../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { validateRequest, s3ConfigSchema } from '../utils/validation.js';

/**
 * 获取 S3 配置
 * secretAccessKey 字段返回空字符串，附加 hasSecretKey 标记
 * 同时返回推送状态信息
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response}
 */
export async function handleGetS3Config(request, env) {
	const logger = getLogger(env);

	try {
		const config = await getS3Config(env);

		// 读取推送状态
		const [lastError, lastSuccess] = await Promise.all([
			env.SECRETS_KV.get('s3_last_error', 'json'),
			env.SECRETS_KV.get('s3_last_success', 'json'),
		]);

		if (!config) {
			return createJsonResponse(
				{
					configured: false,
					config: null,
					lastError: lastError || null,
					lastSuccessAt: lastSuccess?.timestamp || null,
				},
				200,
				request,
			);
		}

		return createJsonResponse(
			{
				configured: true,
				config: {
					endpoint: config.endpoint,
					bucket: config.bucket,
					region: config.region || 'auto',
					accessKeyId: config.accessKeyId,
					secretAccessKey: '',
					hasSecretKey: !!(config.secretAccessKey && config.secretAccessKey.length > 0),
					prefix: config.prefix || '',
				},
				lastError: lastError || null,
				lastSuccessAt: lastSuccess?.timestamp || null,
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('获取 S3 配置失败', { error: error.message }, error);
		return createErrorResponse('获取配置失败', error.message, 500, request);
	}
}

/**
 * 保存 S3 配置
 * secretAccessKey 为空时保留 KV 中的旧密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response}
 */
export async function handleSaveS3Config(request, env) {
	const logger = getLogger(env);

	try {
		// Rate Limiting
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		// 验证输入
		const body = await validateRequest(s3ConfigSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		// secretAccessKey 为空时保留旧密钥
		if (!body.secretAccessKey) {
			const existingConfig = await getS3Config(env);
			if (existingConfig && existingConfig.secretAccessKey) {
				body.secretAccessKey = existingConfig.secretAccessKey;
			} else {
				// 首次配置时 secretAccessKey 必填
				return createErrorResponse('请求验证失败', '首次配置时 Secret Access Key 不能为空', 400, request);
			}
		}

		// 保存配置
		const result = await saveS3Config(env, body);

		logger.info('S3 配置已保存', {
			endpoint: body.endpoint,
			bucket: body.bucket,
			region: body.region,
			prefix: body.prefix,
			encrypted: result.encrypted,
		});

		const response = {
			success: true,
			message: 'S3 配置已保存',
			encrypted: result.encrypted,
		};

		if (result.warning) {
			response.warning = result.warning;
		}

		return createJsonResponse(response, 200, request);
	} catch (error) {
		logger.error('保存 S3 配置失败', { error: error.message }, error);
		return createErrorResponse('保存配置失败', error.message, 500, request);
	}
}

/**
 * 测试 S3 连接
 * secretAccessKey 为空时从 KV 读取已保存的密钥
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response}
 */
export async function handleTestS3(request, env) {
	const logger = getLogger(env);

	try {
		// Rate Limiting
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		// 验证输入
		const body = await validateRequest(s3ConfigSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		// secretAccessKey 为空时从 KV 读取已保存的密钥
		if (!body.secretAccessKey) {
			const existingConfig = await getS3Config(env);
			if (existingConfig && existingConfig.secretAccessKey) {
				body.secretAccessKey = existingConfig.secretAccessKey;
			} else {
				return createErrorResponse('请求验证失败', 'Secret Access Key 不能为空（无已保存的配置）', 400, request);
			}
		}

		// 测试连接
		logger.info('开始测试 S3 连接', { endpoint: body.endpoint, bucket: body.bucket });
		const result = await testS3Connection(body);

		if (result.success) {
			logger.info('S3 连接测试成功');
		} else {
			logger.warn('S3 连接测试失败', { message: result.message });
		}

		return createJsonResponse(result, result.success ? 200 : 400, request);
	} catch (error) {
		logger.error('测试 S3 连接失败', { error: error.message }, error);
		return createErrorResponse('测试连接失败', error.message, 500, request);
	}
}

/**
 * 删除 S3 配置
 *
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response}
 */
export async function handleDeleteS3Config(request, env) {
	const logger = getLogger(env);

	try {
		// Rate Limiting
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		// 删除配置和状态
		await Promise.all([
			env.SECRETS_KV.delete('s3_config'),
			env.SECRETS_KV.delete('s3_last_error'),
			env.SECRETS_KV.delete('s3_last_success'),
		]);

		logger.info('S3 配置已删除');

		return createJsonResponse(
			{
				success: true,
				message: 'S3 配置已删除',
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('删除 S3 配置失败', { error: error.message }, error);
		return createErrorResponse('删除配置失败', error.message, 500, request);
	}
}
