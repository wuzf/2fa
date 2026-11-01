import { serializeBrowserFunction } from './browserSource.js';
/** Pure helpers are serialized into the editor without exposing raw server messages. */
export function appearanceErrorKey(data, status) {
	const code = typeof data === 'string' ? data : data?.code || data?.error || '';
	const groups = {
		appearanceErrorFormat: [
			'THEME_INVALID_ZIP',
			'THEME_UNSUPPORTED_ZIP',
			'THEME_DUPLICATE_PATH',
			'THEME_FILE_TYPE',
			'THEME_INVALID_JSON',
			'THEME_EMPTY_FILE',
			'THEME_MISSING_CSS',
			'THEME_MISSING_MANIFEST',
			'THEME_UNSUPPORTED_VERSION',
			'THEME_INVALID_ID',
			'THEME_RESERVED_ID',
			'THEME_INVALID_VERSION',
			'THEME_INVALID_PATH',
			'THEME_INVALID_ENCODING',
			'THEME_ASSET_TYPE',
			'THEME_HASH_MISMATCH',
			'THEME_ASSET_HASH_MISMATCH',
			'THEME_RESERVED_PATH',
			'THEME_APP_HASH',
			'THEME_APP_INVENTORY',
			'THEME_APP_JAVASCRIPT',
			'THEME_APP_REFERENCE',
			'THEME_APP_DYNAMIC_IMPORT',
			'THEME_PUBLIC_FONT',
			'THEME_PUBLIC_FONT_RANGE',
		],
		appearanceErrorLimit: [
			'THEME_PACKAGE_LIMIT',
			'THEME_UPLOAD_LIMIT',
			'THEME_CSS_LIMIT',
			'THEME_MANIFEST_LIMIT',
			'THEME_APPEARANCE_LIMIT',
			'THEME_SIZE_LIMIT',
			'THEME_TOO_LARGE',
			'THEME_CAPACITY',
			'THEME_VERSION_CAPACITY',
			'THEME_REQUEST_LIMIT',
			'THEME_REDIRECT_LIMIT',
			'THEME_CSS_DEPTH',
			'THEME_APP_JS_LIMIT',
			'THEME_PUBLIC_APPEARANCE_LIMIT',
			'THEME_PUBLIC_FONT_LIMIT',
			'THEME_CATALOG_SOURCE_LIMIT',
		],
		appearanceErrorDownload: [
			'THEME_CATALOG_INVALID',
			'THEME_CATALOG_UNAVAILABLE',
			'THEME_CATALOG_CHANGED',
			'THEME_INVALID_URL',
			'THEME_PRIVATE_URL',
			'THEME_TIMEOUT',
			'THEME_DOWNLOAD_FAILED',
			'THEME_RELEASE_NOT_FOUND',
			'THEME_RELEASE_ASSET_NOT_FOUND',
		],
		appearanceErrorMissing: [
			'THEME_MISSING_ASSET',
			'THEME_MISSING_FILE',
			'THEME_NOT_FOUND',
			'THEME_ASSET_MISSING',
			'THEME_ASSET_INCOMPLETE',
			'THEME_CATALOG_SOURCE_UNKNOWN',
		],
		appearanceErrorCss: ['THEME_INVALID_CSS', 'THEME_UNRESOLVED_CSS', 'THEME_DEPENDENCY_CYCLE'],
		appearanceErrorLayout: [
			'THEME_INVALID_LAYOUT',
			'THEME_INVALID_COMPONENT',
			'THEME_DUPLICATE_COMPONENT',
			'THEME_REQUIRED_COMPONENT',
			'THEME_INVALID_CONTENT',
		],
		appearanceErrorSettings: [
			'THEME_INVALID_FIELD',
			'THEME_UNKNOWN_FIELD',
			'THEME_INVALID_BINDING',
			'THEME_INVALID_LINK',
			'THEME_INVALID_TOKENS',
			'THEME_INVALID_SETTINGS',
			'THEME_INVALID_DEFAULT',
			'THEME_UNKNOWN_SETTING',
			'THEME_INVALID_SETTING',
			'THEME_OPERATION_REUSED',
			'THEME_INVALID',
			'THEME_PUBLIC_APPEARANCE',
			'THEME_PUBLIC_VARIANT',
		],
		appearanceErrorCatalogSource: ['THEME_CATALOG_SOURCE_INVALID'],
		appearanceErrorRestore: ['THEME_RESTORE_REQUIRED'],
		appearanceErrorSdk: ['THEME_UNSUPPORTED_SDK', 'THEME_HOST_VERSION_UNSUPPORTED'],
		appearanceErrorAppRuntime: ['THEME_APP_RUNTIME_UNAVAILABLE'],
		appearanceErrorBusy: ['THEME_RATE_LIMIT', 'THEME_RESOURCE_BUSY', 'THEME_PREVIEW_CAPACITY'],
		appearancePreviewExpired: ['THEME_PREVIEW_EXPIRED'],
		appearanceErrorInUse: ['THEME_BUILTIN', 'THEME_IN_USE'],
		appearanceErrorNoPrevious: ['THEME_NO_PREVIOUS'],
		appearanceConflict: ['THEME_REVISION_CONFLICT'],
		appearanceNoBinding: ['需要配置主题存储'],
	};
	for (const [key, codes] of Object.entries(groups)) {
		if (codes.includes(code)) {
			return key;
		}
	}
	if (status === 401) {
		return 'loginModalDesc';
	}
	if (status === 413) {
		return 'appearanceErrorLimit';
	}
	if (status === 429) {
		return 'appearanceErrorBusy';
	}
	return 'appearanceErrorUnavailable';
}

/** Returned strings are plain text. UI callers must use textContent, never innerHTML. */
export function localizeAppearanceError(data, translate, status, resolveKey = appearanceErrorKey) {
	const key = resolveKey(data, status);
	const parts = [];
	const details = data && typeof data === 'object' ? data.details : null;
	if (details && typeof details === 'object') {
		for (const name of ['field', 'key', 'component', 'type', 'region', 'path']) {
			const value = details[name];
			if (typeof value === 'string' && value.length && !value.includes('://')) {
				parts.push(
					[...value]
						.filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 && !'<>'.includes(character))
						.join('')
						.slice(0, 160),
				);
			}
		}
		if (Number.isSafeInteger(details.line) && details.line > 0) {
			parts.push(String(details.line) + (Number.isSafeInteger(details.column) && details.column > 0 ? ':' + details.column : ''));
		}
	}
	return translate(key) + (parts.length ? ' [' + parts.slice(0, 3).join(' · ') + ']' : '');
}

export function getAppearanceErrorCode() {
	return `(function() { const resolveKey = ${serializeBrowserFunction(appearanceErrorKey)}; const localizeError = ${serializeBrowserFunction(localizeAppearanceError)}; window.localizeAppearanceError = function(data, status) { return localizeError(data, function(key) { return window.t ? window.t(key) : key; }, status, resolveKey); }; })();`;
}
