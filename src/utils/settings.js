/**
 * Shared settings helpers.
 */

export const KV_SETTINGS_KEY = 'settings';
export const DEFAULT_EXPORT_FORMAT = 'json';
export const VALID_EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];

export const DEFAULT_SETTINGS = {
	jwtExpiryDays: 30,
	maxBackups: 100,
	defaultExportFormat: DEFAULT_EXPORT_FORMAT,
};

export function sanitizeDefaultExportFormat(value) {
	if (typeof value !== 'string') {
		return DEFAULT_EXPORT_FORMAT;
	}

	const normalized = value.trim().toLowerCase();
	return VALID_EXPORT_FORMATS.includes(normalized) ? normalized : DEFAULT_EXPORT_FORMAT;
}

function buildInvalidSettingsError(message) {
	return new Error(`设置数据已损坏：${message}`);
}

function buildSanitizedSettings(parsed = {}) {
	return {
		...DEFAULT_SETTINGS,
		...parsed,
		defaultExportFormat: sanitizeDefaultExportFormat(parsed.defaultExportFormat),
	};
}

export async function getSettings(env, options = {}) {
	if (!env?.SECRETS_KV) {
		return { ...DEFAULT_SETTINGS };
	}

	let raw;
	try {
		raw = await env.SECRETS_KV.get(KV_SETTINGS_KEY);
	} catch (error) {
		throw new Error(`读取设置失败：${error.message}`);
	}

	if (!raw) {
		return { ...DEFAULT_SETTINGS };
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		options.onInvalid?.(buildInvalidSettingsError(error.message));
		return { ...DEFAULT_SETTINGS };
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		options.onInvalid?.(buildInvalidSettingsError('根对象必须是 JSON 对象'));
		return { ...DEFAULT_SETTINGS };
	}

	return buildSanitizedSettings(parsed);
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
