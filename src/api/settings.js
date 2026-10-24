/**
 * Settings API handlers.
 */

import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';
import {
	checkRateLimit,
	scopedRateLimitKey,
	getClientIdentifier,
	createRateLimitResponse,
	RATE_LIMIT_PRESETS,
} from '../utils/rateLimit.js';
import { ValidationError, ConflictError, errorToResponse, logError } from '../utils/errors.js';
import {
	getSettings,
	KV_SETTINGS_KEY,
	sanitizeDefaultExportFormat,
	sanitizeLanguage,
	VALID_EXPORT_FORMATS,
	VALID_LANGUAGES,
	MAX_CUSTOM_CODE_LENGTH,
	validateCustomCodes,
	sanitizeCustomCodes,
	getEnabledCustomCode,
} from '../utils/settings.js';

// Code edits autosave after a short pause, so settings need their own quota.
const SETTINGS_RATE_LIMIT = { ...RATE_LIMIT_PRESETS.sensitive, maxAttempts: 180 };

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
	language: (value) => {
		if (typeof value !== 'string') {
			return '语言偏好必须是字符串';
		}

		const normalized = value.trim();
		if (!VALID_LANGUAGES.includes(normalized)) {
			return `语言偏好仅支持：${VALID_LANGUAGES.join(', ')}`;
		}

		return null;
	},
	customCode: (value) => {
		if (typeof value !== 'string') {
			return '自定义代码必须是字符串';
		}
		if (value.length > MAX_CUSTOM_CODE_LENGTH) {
			return `自定义代码不能超过 ${MAX_CUSTOM_CODE_LENGTH} 个字符`;
		}
		return null;
	},
	customCodes: validateCustomCodes,
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
			omitUnsetLanguage: true,
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
		const rateLimitInfo = await checkRateLimit(scopedRateLimitKey('settings', clientIP), env, SETTINGS_RATE_LIMIT);

		if (!rateLimitInfo.allowed) {
			logger.warn('保存设置速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		let body;
		try {
			body = await request.json();
		} catch {
			// JSON parser errors may include the submitted source in their messages.
			throw new ValidationError('设置数据必须是有效的 JSON');
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new ValidationError('设置数据必须是 JSON 对象');
		}
		if (Object.hasOwn(body, 'customCode') && Object.hasOwn(body, 'customCodes')) {
			throw new ValidationError('请勿同时提交新旧自定义代码', { field: 'customCodes' });
		}
		const current = await getSettings(env, {
			onInvalid: createSettingsFallbackHandler(logger, '设置数据已损坏，保存时将使用默认配置覆盖'),
			omitUnsetLanguage: true,
		});
		if (
			Object.hasOwn(body, 'customCode') &&
			(current.customCodes.length > 1 ||
				current.customCodes.some((item) => item.id !== 'legacy-custom-code' || item.name !== '' || item.enabled !== true))
		) {
			throw new ConflictError('请刷新页面后再修改自定义代码', { field: 'customCode' });
		}

		const updated = { ...current };
		for (const [key, value] of Object.entries(body)) {
			if (!Object.hasOwn(SETTINGS_VALIDATORS, key)) {
				continue;
			}

			const error = SETTINGS_VALIDATORS[key](value);
			if (error) {
				// User snippets can contain secrets or be very large. Never echo them into logs/errors.
				throw new ValidationError(error, { field: key });
			}

			if (key === 'defaultExportFormat') {
				updated[key] = sanitizeDefaultExportFormat(value);
			} else if (key === 'language') {
				updated[key] = sanitizeLanguage(value);
			} else if (key === 'customCode') {
				updated.customCodes = value === '' ? [] : [{ id: 'legacy-custom-code', name: '', enabled: true, code: value }];
			} else if (key === 'customCodes') {
				updated.customCodes = sanitizeCustomCodes(value);
			} else {
				updated[key] = Number(value);
			}
		}
		updated.customCode = getEnabledCustomCode(updated);

		await env.SECRETS_KV.put(KV_SETTINGS_KEY, JSON.stringify(updated));

		logger.info('设置已更新', { updated: Object.keys(body) });

		return createJsonResponse(
			{
				success: true,
				message: '设置已保存',
				settings: updated,
			},
			200,
			request,
		);
	} catch (error) {
		if (error instanceof ValidationError || error instanceof ConflictError) {
			logError(error, logger, { operation: 'save_settings' });
			return errorToResponse(error, request);
		}

		logger.error('保存设置失败', { errorMessage: error.message }, error);
		return createErrorResponse('保存设置失败', '保存设置时发生错误', 500, request);
	}
}
