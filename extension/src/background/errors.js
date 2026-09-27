import { localizedError } from '../shared/localized-error.js';

// Public background errors share one identity across all workflows.
export class ExtensionError extends Error {
	constructor(code, messageKey = `error_${code}`, params) {
		const localized = localizedError(messageKey, code, params);
		super(localized.message);
		this.name = 'ExtensionError';
		this.code = code;
		this.messageKey = localized.messageKey;
		if (localized.params) {
			this.params = localized.params;
		}
	}
}

export function throwFromResponse(response, fallbackCode) {
	const code = typeof response?.error?.code === 'string' ? response.error.code : fallbackCode;
	throw new ExtensionError(code, response?.error?.messageKey || `error_${code}`, response?.error?.params);
}
