/**
 * Settings API handlers.
 */

import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { ValidationError, errorToResponse, logError } from '../utils/errors.js';
import { DEFAULT_SETTINGS, getSettings, KV_SETTINGS_KEY, sanitizeDefaultExportFormat, VALID_EXPORT_FORMATS } from '../utils/settings.js';

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
	defaultExportFormat: (value) => {
		if (typeof value !== 'string') {
			return '默认导出格式必须是字符串';
		}

		const normalized = value.trim().toLowerCase();
		if (!VALID_EXPORT_FORMATS.includes(normalized)) {
			return `默认导出格式仅支持：${VALID_EXPORT_FORMATS.join(', ')}`;
		}

		return null;
	},
};

function createSettingsFallbackHandler(logger, message) {
	return (error) => {
		logger.warn(message, {
			errorMessage: error.message,
		});
	};
}

/**
 * Get system settings.
 */
export async function handleGetSettings(request, env) {
	const logger = getLogger(env);

	try {
		const settings = await getSettings(env, {
			onInvalid: createSettingsFallbackHandler(logger, '设置数据已损坏，已回退默认配置'),
		});
		return createJsonResponse(settings, 200, request);
	} catch (error) {
		logger.error('获取设置失败', { errorMessage: error.message }, error);
		return createErrorResponse('获取设置失败', '读取设置时发生错误', 500, request);
	}
}

/**
 * Save system settings.
 */
export async function handleSaveSettings(request, env) {
	const logger = getLogger(env);

	try {
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
		const current = await getSettings(env, {
			onInvalid: createSettingsFallbackHandler(logger, '设置数据已损坏，保存时将使用默认配置覆盖'),
		});

		const updated = { ...current };
		for (const [key, value] of Object.entries(body)) {
			if (!SETTINGS_VALIDATORS[key]) {
				continue;
			}

			const error = SETTINGS_VALIDATORS[key](value);
			if (error) {
				throw new ValidationError(error, { field: key, value });
			}

			if (key === 'defaultExportFormat') {
				updated[key] = sanitizeDefaultExportFormat(value);
			} else {
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
