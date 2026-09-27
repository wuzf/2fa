import { ERROR_LOCALES } from '../locales/errors.js';

// Errors carry stable translation metadata across worker/view boundaries.
// The canonical message is only a compatibility fallback, never shared mutable locale state.
export function localizedError(messageKey, code = 'INVALID_REQUEST', params) {
	const key = Object.hasOwn(ERROR_LOCALES['zh-CN'], messageKey) ? messageKey : 'error_UNKNOWN_ERROR';
	const message = ERROR_LOCALES['zh-CN'][key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match));
	return Object.assign(new Error(message), { code, messageKey: key, ...(params ? { params } : {}) });
}
