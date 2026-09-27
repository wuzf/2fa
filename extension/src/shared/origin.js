import { localizedError } from './localized-error.js';

const LOCAL_INSTANCE_HOSTS = new Set(['localhost', '127.0.0.1']);

function parseHttpUrl(value) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw localizedError('error_ORIGIN_REQUIRED');
	}

	let url;
	try {
		url = new URL(value.trim());
	} catch {
		throw localizedError('error_ORIGIN_INVALID');
	}

	if (!['https:', 'http:'].includes(url.protocol)) {
		throw localizedError('error_ORIGIN_PROTOCOL');
	}
	if (url.username || url.password) {
		throw localizedError('error_ORIGIN_CREDENTIALS');
	}
	return url;
}

export function normalizeInstanceOrigin(value) {
	const url = parseHttpUrl(value);
	if (url.protocol !== 'https:' && !LOCAL_INSTANCE_HOSTS.has(url.hostname)) {
		throw localizedError('error_ORIGIN_HTTPS');
	}
	return url.origin;
}

export function normalizeTargetOrigin(value) {
	const url = parseHttpUrl(value);
	return url.origin;
}

export function isPrivateIPv4Host(host) {
	if (typeof host !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)) {
		return false;
	}
	const octets = host.split('.').map(Number);
	if (octets.some((octet) => octet > 255)) {
		return false;
	}
	return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

// Target-site grants are distinct from permissions to read the 2FA vault.
// Automatic filling needs a destination that cannot silently be another device:
// HTTPS authenticates the host and loopback is this device. Plain-HTTP network
// addresses such as 192.168.1.1 repeat across networks and can be impersonated
// on the local segment, so those pages support manual filling only.
export function normalizeAutofillTargetOrigin(value) {
	const url = parseHttpUrl(value);
	if (url.protocol === 'https:' || LOCAL_INSTANCE_HOSTS.has(url.hostname)) {
		return url.origin;
	}
	throw localizedError('error_AUTOFILL_ORIGIN_PROTOCOL');
}

/** A plain-HTTP page on another host: fillable manually, never automatically. */
export function isManualOnlyTargetOrigin(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' && !LOCAL_INSTANCE_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

export function originFromTabUrl(value) {
	try {
		return normalizeTargetOrigin(value);
	} catch {
		return null;
	}
}

function pagePath(url) {
	// Hash routers keep their route in the fragment. Ordinary anchors do not
	// change the page authorization; transient query values are never persisted.
	const route = /^#!?\//.test(url.hash) ? url.hash.split('?')[0] : '';
	return `${url.pathname}${route}`;
}

export function normalizeAutofillPath(value) {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.length > 8192 ||
		/[\s\\\p{Cc}]/u.test(value) ||
		/%(?![\da-f]{2})/i.test(value) ||
		pagePath(new URL(`https://scope.invalid${value}`)) !== value
	) {
		throw localizedError('error_AUTOFILL_PATH_INVALID');
	}
	return value;
}

export function autofillPathFromUrl(value) {
	try {
		return normalizeAutofillPath(pagePath(parseHttpUrl(value)));
	} catch {
		return null;
	}
}

export function originToPermissionPattern(origin) {
	const normalized = normalizeInstanceOrigin(origin);
	const url = new URL(normalized);
	return `${url.protocol}//${url.hostname}/*`;
}

export function targetOriginToPermissionPattern(origin) {
	const url = new URL(normalizeAutofillTargetOrigin(origin));
	return `${url.protocol}//${url.hostname}/*`;
}

export function isExactOrigin(value, expectedOrigin) {
	try {
		return new URL(value).origin === normalizeTargetOrigin(expectedOrigin);
	} catch {
		return false;
	}
}
// Host permission removal is an event, even if the same grant is restored before
// queued cleanup runs. Match Chrome's scheme/host wildcards without substring matching.
export function permissionPatternCoversOrigin(pattern, origin) {
	try {
		const target = new URL(origin);
		if (!['https:', 'http:'].includes(target.protocol)) {
			return false;
		}
		if (pattern === '<all_urls>') {
			return true;
		}
		const match = /^(\*|https?):\/\/([^/]+)\/.*$/.exec(pattern);
		if (!match || (match[1] !== '*' && `${match[1]}:` !== target.protocol)) {
			return false;
		}
		const host = match[2].toLowerCase();
		return (
			host === '*' ||
			host === target.hostname ||
			(host.startsWith('*.') && (target.hostname === host.slice(2) || target.hostname.endsWith(`.${host.slice(2)}`)))
		);
	} catch {
		return false;
	}
}
