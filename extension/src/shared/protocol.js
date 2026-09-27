import { t } from './i18n.js';
import { ERROR_LOCALES } from '../locales/errors.js';

export const MESSAGE = Object.freeze({
	GET_LANGUAGE: 'GET_LANGUAGE',
	SAVE_LANGUAGE: 'SAVE_LANGUAGE',
	LANGUAGE_CHANGED: 'LANGUAGE_CHANGED',
	START_FLOW: 'START_FLOW',
	SET_FAVORITE: 'SET_FAVORITE',
	FILL_ACCOUNT: 'FILL_ACCOUNT',
	COPY_ACCOUNT_CODE: 'COPY_ACCOUNT_CODE',
	COPY_ACCOUNT_CODES: 'COPY_ACCOUNT_CODES',
	CHECK_INSTANCE: 'CHECK_INSTANCE',
	REFRESH_OFFLINE_ACCOUNTS: 'REFRESH_OFFLINE_ACCOUNTS',
	IMPORT_OFFLINE: 'IMPORT_OFFLINE',
	CLEAR_OFFLINE: 'CLEAR_OFFLINE',
	OFFLINE_STATUS: 'OFFLINE_STATUS',
	OFFLINE_ICONS: 'OFFLINE_ICONS',
	OPEN_INSTANCE: 'OPEN_INSTANCE',
	SAVE_INSTANCE: 'SAVE_INSTANCE',
	GET_SETTINGS: 'GET_SETTINGS',
	REMOVE_BINDING: 'REMOVE_BINDING',
	GET_AUTOFILL_SITES: 'GET_AUTOFILL_SITES',
	GET_AUTOFILL_CONTEXT: 'GET_AUTOFILL_CONTEXT',
	SET_AUTOFILL_SITE: 'SET_AUTOFILL_SITE',
	BEGIN_AUTOFILL_AUTHORIZATION: 'BEGIN_AUTOFILL_AUTHORIZATION',
	COMPLETE_AUTOFILL_AUTHORIZATION: 'COMPLETE_AUTOFILL_AUTHORIZATION',
	CANCEL_AUTOFILL_AUTHORIZATION: 'CANCEL_AUTOFILL_AUTHORIZATION',
	AUTO_STATUS: 'AUTO_STATUS',
	AUTO_DISCOVER: 'AUTO_DISCOVER',
	AUTO_SELECT: 'AUTO_SELECT',
	AUTO_PROBE: 'AUTO_PROBE',
	AUTO_PREPARE: 'AUTO_PREPARE',
	AUTO_FILL: 'AUTO_FILL',
	AUTO_REFRESH: 'AUTO_REFRESH',
	AUTO_STOP: 'AUTO_STOP',
	ACCOUNTS_CHANGED: 'ACCOUNTS_CHANGED',
	ICONS_CHANGED: 'ICONS_CHANGED',
	SOURCE_STATUS: 'SOURCE_STATUS',
	SOURCE_DIRTY: 'SOURCE_DIRTY',
	SOURCE_STOP: 'SOURCE_STOP',
	SOURCE_REFRESH: 'SOURCE_REFRESH',
	SOURCE_PING: 'SOURCE_PING',
	PREPARE_TARGET: 'PREPARE_TARGET',
	TARGET_PING: 'TARGET_PING',
	FILL_CODE: 'FILL_CODE',
});

export const LIMITS = Object.freeze({
	MAX_ACCOUNTS: 5000,
	PENDING_TTL_MS: 5 * 60 * 1000,
});

const ACCOUNT_KEYS = ['id', 'name', 'account', 'type', 'digits'];

export function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createNonce() {
	const bytes = new Uint8Array(18);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function isValidNonce(value) {
	return typeof value === 'string' && /^[a-f0-9]{36}$/.test(value);
}

export function sanitizeAccountMetadata(value) {
	if (!isPlainObject(value)) {
		return null;
	}

	if (
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		value.id.length > 200 ||
		typeof value.name !== 'string' ||
		value.name.length === 0 ||
		value.name.length > 200 ||
		typeof value.account !== 'string' ||
		value.account.length > 500 ||
		value.type !== 'TOTP' ||
		![6, 8].includes(value.digits) ||
		(Object.hasOwn(value, 'searchFamily') &&
			(typeof value.searchFamily !== 'string' || value.searchFamily.trim().length === 0 || value.searchFamily.length > 200)) ||
		(Object.hasOwn(value, 'searchFamilyKind') && value.searchFamilyKind !== 'other')
	) {
		return null;
	}

	return Object.freeze({
		id: value.id,
		name: value.name,
		account: value.account,
		type: value.type,
		digits: value.digits,
		...(Object.hasOwn(value, 'searchFamily') ? { searchFamily: value.searchFamily } : {}),
		...(value.searchFamilyKind === 'other' ? { searchFamilyKind: 'other' } : {}),
	});
}

export function sanitizeAccountList(value) {
	if (!Array.isArray(value) || value.length > LIMITS.MAX_ACCOUNTS) {
		return null;
	}

	const accounts = [];
	const ids = new Set();
	for (const item of value) {
		const account = sanitizeAccountMetadata(item);
		if (!account || ids.has(account.id)) {
			return null;
		}
		ids.add(account.id);
		accounts.push(account);
	}

	return accounts;
}

export function accountMetadataMatches(left, right) {
	const a = sanitizeAccountMetadata(left);
	const b = sanitizeAccountMetadata(right);
	return Boolean(a && b && ACCOUNT_KEYS.every((key) => a[key] === b[key]));
}

export function makePublicError(code, message, messageKey, params) {
	return {
		ok: false,
		error: {
			code: typeof code === 'string' && code ? code : 'UNKNOWN_ERROR',
			message: typeof message === 'string' && message ? message : t('error_UNKNOWN_ERROR'),
			...(messageKey ? { messageKey } : {}),
			...(params ? { params } : {}),
		},
	};
}

export function getErrorResponse(error, language) {
	if (isPlainObject(error) && typeof error.code === 'string' && typeof error.message === 'string') {
		const key = Object.hasOwn(ERROR_LOCALES['zh-CN'], error.messageKey)
			? error.messageKey
			: Object.hasOwn(ERROR_LOCALES['zh-CN'], `error_${error.code}`)
				? `error_${error.code}`
				: 'error_UNKNOWN_ERROR';
		return makePublicError(error.code, t(key, error.params, language), key, error.params);
	}
	return makePublicError('UNKNOWN_ERROR', t('error_UNKNOWN_ERROR', {}, language), 'error_UNKNOWN_ERROR');
}
