/**
 * 系统设置 API 处理模块
 */

import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { ValidationError, errorToResponse, logError } from '../utils/errors.js';

const KV_SETTINGS_KEY = 'settings';

// 默认设置
const DEFAULT_SETTINGS = {
	jwtExpiryDays: 30,
	maxBackups: 100,
};

// 验证规则
const SETTINGS_VALIDATORS = {
	jwtExpiryDays: (value) => {
		const days = Number(value);
		if (!Number.isFinite(days) || days < 1 || days > 365) {
			return '登录有效期必须在 1~365 天之间';
		}
		return null;
	},
	maxBackups: (value) => {
		const type = typeof value;
		if (type !== 'number' && type !== 'string') {
			return '备份保留数量必须是数字';
		}
		const trimmed = type === 'string' ? value.trim() : value;
		if (trimmed === '') {
			return '备份保留数量不能为空';
		}
		const num = Number(trimmed);
		if (!Number.isInteger(num) || num < 0 || num > 1000) {
			return '备份保留数量必须在 0~1000 之间的整数（0 表示不限制）';
		}
		return null;
	},
};

/**
 * 获取系统设置
 */
export async function handleGetSettings(request, env) {
	const logger = getLogger(env);

	try {
		const raw = await env.SECRETS_KV.get(KV_SETTINGS_KEY);
		const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };

		return createJsonResponse(settings, 200, request);
	} catch (error) {
		logger.error('获取设置失败', { errorMessage: error.message }, error);
		return createErrorResponse('获取设置失败', '读取设置时发生错误', 500, request);
	}
}

/**
 * 保存系统设置
 */
export async function handleSaveSettings(request, env) {
	const logger = getLogger(env);

	try {
		// 🛡️ Rate Limiting: 防止频繁修改设置
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('保存设置速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const body = await request.json();

		// 读取现有设置
		const raw = await env.SECRETS_KV.get(KV_SETTINGS_KEY);
		const current = raw ? JSON.parse(raw) : {};

		// 验证并合并
		const updated = { ...current };
		for (const [key, value] of Object.entries(body)) {
			if (SETTINGS_VALIDATORS[key]) {
				const error = SETTINGS_VALIDATORS[key](value);
				if (error) {
					throw new ValidationError(error, { field: key, value });
				}
				updated[key] = Number(value);
			}
		}

		await env.SECRETS_KV.put(KV_SETTINGS_KEY, JSON.stringify(updated));

		logger.info('设置已更新', { updated: Object.keys(body) });

		return createJsonResponse(
			{
				success: true,
				message: '设置已保存',
				settings: { ...DEFAULT_SETTINGS, ...updated },
			},
			200,
			request,
		);
	} catch (error) {
		if (error instanceof ValidationError) {
			logError(error, logger, { operation: 'save_settings' });
			return errorToResponse(error, request);
		}

		logger.error('保存设置失败', { errorMessage: error.message }, error);
		return createErrorResponse('保存设置失败', '保存设置时发生错误', 500, request);
	}
}
