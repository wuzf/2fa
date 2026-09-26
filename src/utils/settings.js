import { LANGUAGE_PREFERENCES } from '../shared/languages.js';

/**
 * Shared settings helpers.
 */

export const KV_SETTINGS_KEY = 'settings';
export const DEFAULT_EXPORT_FORMAT = 'json';
export const VALID_EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];
export const VALID_LANGUAGES = LANGUAGE_PREFERENCES;
export const DEFAULT_LANGUAGE = 'auto';

export const DEFAULT_SETTINGS = {
	jwtExpiryDays: 30,
	maxBackups: 100,
	defaultExportFormat: DEFAULT_EXPORT_FORMAT,
	language: DEFAULT_LANGUAGE,
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

function buildInvalidSettingsError(message) {
	return new Error(`设置数据已损坏：${message}`);
}

function buildSanitizedSettings(parsed = {}, options = {}) {
	const settings = {
		...DEFAULT_SETTINGS,
		...parsed,
		defaultExportFormat: sanitizeDefaultExportFormat(parsed.defaultExportFormat),
		language: sanitizeLanguage(parsed.language),
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
	} catch (error) {
		options.onInvalid?.(buildInvalidSettingsError(error.message));
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
