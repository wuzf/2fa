import { LANGUAGE_PREFERENCES } from '../shared/languages.js';

/**
 * Shared settings helpers.
 */

export const KV_SETTINGS_KEY = 'settings';
export const DEFAULT_EXPORT_FORMAT = 'json';
export const VALID_EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];
export const VALID_LANGUAGES = LANGUAGE_PREFERENCES;
export const DEFAULT_LANGUAGE = 'auto';
export const MAX_CUSTOM_CODE_LENGTH = 100000;
export const MAX_CUSTOM_CODE_ITEMS = 50;
export const MAX_CUSTOM_CODE_NAME_LENGTH = 100;

export const DEFAULT_SETTINGS = {
	jwtExpiryDays: 30,
	maxBackups: 100,
	defaultExportFormat: DEFAULT_EXPORT_FORMAT,
	language: DEFAULT_LANGUAGE,
	customCode: '',
	customCodes: [],
};

export function sanitizeDefaultExportFormat(value) {
	if (typeof value !== 'string') {
		return DEFAULT_EXPORT_FORMAT;
	}

	const normalized = value.trim().toLowerCase();
	return VALID_EXPORT_FORMATS.includes(normalized) ? normalized : DEFAULT_EXPORT_FORMAT;
}

export function sanitizeLanguage(value) {
	if (typeof value !== 'string') {
		return DEFAULT_LANGUAGE;
	}

	const normalized = value.trim();
	return VALID_LANGUAGES.includes(normalized) ? normalized : DEFAULT_LANGUAGE;
}

export function sanitizeCustomCode(value) {
	return typeof value === 'string' && value.length <= MAX_CUSTOM_CODE_LENGTH ? value : '';
}

export function validateCustomCodes(value) {
	if (!Array.isArray(value)) {
		return '自定义代码列表必须是数组';
	}
	if (value.length > MAX_CUSTOM_CODE_ITEMS) {
		return `自定义代码最多支持 ${MAX_CUSTOM_CODE_ITEMS} 项`;
	}
	const ids = new Set();
	let totalLength = 0;
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return '自定义代码条目必须是对象';
		}
		if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) {
			return '自定义代码标识只能包含 1~64 位字母、数字、下划线或短横线';
		}
		if (ids.has(item.id)) {
			return '自定义代码标识不能重复';
		}
		ids.add(item.id);
		if (typeof item.name !== 'string' || item.name.length > MAX_CUSTOM_CODE_NAME_LENGTH) {
			return `自定义代码名称必须是最多 ${MAX_CUSTOM_CODE_NAME_LENGTH} 个字符的字符串`;
		}
		if (typeof item.enabled !== 'boolean') {
			return '自定义代码开关必须是布尔值';
		}
		if (typeof item.code !== 'string') {
			return '自定义代码必须是字符串';
		}
		totalLength += item.code.length;
		if (totalLength > MAX_CUSTOM_CODE_LENGTH) {
			return `自定义代码总长度不能超过 ${MAX_CUSTOM_CODE_LENGTH} 个字符`;
		}
	}
	return null;
}

/** Invalid lists fail closed; never recover old code from a malformed new list. */
export function sanitizeCustomCodes(value) {
	if (validateCustomCodes(value)) {
		return [];
	}
	return value.map(({ id, name, enabled, code }) => ({ id, name, enabled, code }));
}

function getCustomCodes(settings) {
	if (Object.prototype.hasOwnProperty.call(settings, 'customCodes')) {
		return sanitizeCustomCodes(settings.customCodes);
	}
	const code = sanitizeCustomCode(settings.customCode);
	return code === '' ? [] : [{ id: 'legacy-custom-code', name: '', enabled: true, code }];
}

export function getEnabledCustomCode(settings = {}) {
	return getCustomCodes(settings)
		.filter((item) => item.enabled)
		.map((item) => item.code)
		.join('\n');
}

function buildInvalidSettingsError(message) {
	return new Error(`设置数据已损坏：${message}`);
}

function buildSanitizedSettings(parsed = {}, options = {}) {
	const customCodes = getCustomCodes(parsed);
	const settings = {
		...DEFAULT_SETTINGS,
		...parsed,
		defaultExportFormat: sanitizeDefaultExportFormat(parsed.defaultExportFormat),
		language: sanitizeLanguage(parsed.language),
		customCodes,
		customCode: getEnabledCustomCode({ customCodes }),
	};
	// Preference clients must distinguish an unset language from an explicit auto choice.
	if (options.omitUnsetLanguage && (typeof parsed.language !== 'string' || !VALID_LANGUAGES.includes(parsed.language.trim()))) {
		delete settings.language;
	}
	return settings;
}

export async function getSettings(env, options = {}) {
	if (!env?.SECRETS_KV) {
		return buildSanitizedSettings({}, options);
	}

	let raw;
	try {
		raw = await env.SECRETS_KV.get(KV_SETTINGS_KEY);
	} catch (error) {
		throw new Error(`读取设置失败：${error.message}`);
	}

	if (!raw) {
		return buildSanitizedSettings({}, options);
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Keep saved source out of parser error excerpts and fallback logs.
		options.onInvalid?.(buildInvalidSettingsError('JSON 格式无效'));
		return buildSanitizedSettings({}, options);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		options.onInvalid?.(buildInvalidSettingsError('根对象必须是 JSON 对象'));
		return buildSanitizedSettings({}, options);
	}

	return buildSanitizedSettings(parsed, options);
}

export async function getDefaultExportFormat(env, options = {}) {
	try {
		const settings = await getSettings(env, {
			onInvalid: options.onError,
		});
		return sanitizeDefaultExportFormat(settings.defaultExportFormat);
	} catch (error) {
		if (options.fallbackOnError === true) {
			options.onError?.(error);
			return DEFAULT_EXPORT_FORMAT;
		}
		throw error;
	}
}
