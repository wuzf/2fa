import { describe, expect, it } from 'vitest';

import {
	autofillPathFromUrl,
	normalizeAutofillPath,
	isExactOrigin,
	isManualOnlyTargetOrigin,
	isPrivateIPv4Host,
	normalizeAutofillTargetOrigin,
	normalizeInstanceOrigin,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	permissionPatternCoversOrigin,
} from '../../extension/src/shared/origin.js';

describe('automatic fill page paths', () => {
	it.each([
		['https://example.com/aaa?session=secret#heading', '/aaa'],
		['https://example.com/aaa/child', '/aaa/child'],
		['https://example.com/aaa/', '/aaa/'],
		['https://example.com/AAA', '/AAA'],
		['https://example.com/a%2Fb', '/a%2Fb'],
		['https://example.com/?session=secret#/aaa?token=secret', '/#/aaa'],
		['https://example.com/app#!/verify?session=secret', '/app#!/verify'],
		['http://172.16.0.10/core/auth/login/mfa/', '/core/auth/login/mfa/'],
		['https://example.com', '/'],
	])('extracts only the exact route from %s', (url, path) => {
		expect(autofillPathFromUrl(url)).toBe(path);
		expect(normalizeAutofillPath(path)).toBe(path);
	});
	it.each([
		undefined,
		null,
		'',
		'aaa',
		'https://other.example/aaa',
		'/a?secret=x',
		'/a#heading',
		'/a#/b?secret=x',
		'/a/../b',
		'/a\\b',
		'/a\nb',
		'/a%zz',
	])('rejects invalid or noncanonical saved path %s', (path) => {
		expect(() => normalizeAutofillPath(path)).toThrow();
	});
	it.each(['chrome://settings', 'javascript:alert(1)', 'invalid', 'https://user:pass@example.com/aaa'])(
		'does not extract a path from unsupported URL %s',
		(url) => {
			expect(autofillPathFromUrl(url)).toBeNull();
		},
	);
});

describe('removed browser permission scope', () => {
	it.each([
		['https://example.com/*', 'https://example.com:8443', true],
		['http://example.com/*', 'https://example.com', false],
		['*://example.com/*', 'https://example.com', true],
		['*://example.com/*', 'http://example.com:8080', true],
		['https://*.example.com/*', 'https://example.com', true],
		['https://*.example.com/*', 'https://login.example.com:8443', true],
		['https://*.example.com/*', 'https://badexample.com', false],
		['https://example.com/*', 'https://example.com.evil.test', false],
		['https://*/*', 'http://localhost', false],
		['*://*/*', 'https://example.com', true],
		['<all_urls>', 'https://example.com', true],
		['invalid', 'https://example.com', false],
		['<all_urls>', 'chrome://settings', false],
	])('matches %s against %s as %s', (pattern, origin, expected) => {
		expect(permissionPatternCoversOrigin(pattern, origin)).toBe(expected);
	});
});

describe('private IPv4 automatic-fill targets', () => {
	it.each(['10.0.0.0', '10.255.255.255', '172.16.0.0', '172.16.0.10', '172.31.255.255', '192.168.0.0', '192.168.255.255'])(
		'keeps the canonical private host %s manual-only over HTTP and automatic over HTTPS',
		(host) => {
			expect(isPrivateIPv4Host(host)).toBe(true);
			// The same LAN address can be another device on another network.
			expect(() => normalizeAutofillTargetOrigin(`http://${host}:8123/login`)).toThrow();
			expect(() => targetOriginToPermissionPattern(`http://${host}:8123`)).toThrow();
			expect(isManualOnlyTargetOrigin(`http://${host}:8123`)).toBe(true);
			expect(normalizeAutofillTargetOrigin(`https://${host}:8123/login`)).toBe(`https://${host}:8123`);
			expect(targetOriginToPermissionPattern(`https://${host}:8123`)).toBe(`https://${host}/*`);
			expect(isManualOnlyTargetOrigin(`https://${host}:8123`)).toBe(false);
			expect(() => normalizeInstanceOrigin(`http://${host}:8123`)).toThrow();
			expect(() => originToPermissionPattern(`http://${host}:8123`)).toThrow();
		},
	);
	it.each([
		['http://192.168.1.1', true],
		['http://169.254.1.1', true],
		['http://router.local:8080', true],
		['http://[fd00::1]', true],
		['http://login.example', true],
		['http://localhost:8123', false],
		['http://127.0.0.1:8123', false],
		['https://192.168.1.1', false],
		['https://login.example', false],
		['chrome://settings', false],
		['not a url', false],
		[null, false],
	])('classifies %s as a manual-only fill target: %s', (origin, expected) => {
		expect(isManualOnlyTargetOrigin(origin)).toBe(expected);
	});
	it.each([
		'9.255.255.255',
		'11.0.0.0',
		'172.15.255.255',
		'172.32.0.0',
		'192.167.255.255',
		'192.169.0.0',
		'8.8.8.8',
		'169.254.1.1',
		'100.64.0.1',
		'127.0.0.2',
	])('rejects HTTP hosts outside the supported private/local ranges: %s', (host) => {
		expect(isPrivateIPv4Host(host)).toBe(false);
		expect(() => normalizeAutofillTargetOrigin(`http://${host}`)).toThrow();
	});
	it.each([
		'172.16.0.10.evil.example',
		'172.016.0.10',
		'172.16.0.010',
		'172.16.0.256',
		'10.1',
		'0x0a000001',
		'167772161',
		'10.0.0.1.',
		'%31%30.0.0.1',
		'router.local',
		'[fd00::1]',
		'[::1]',
	])('rejects noncanonical or unsupported HTTP host spellings: %s', (host) => {
		expect(isPrivateIPv4Host(host)).toBe(false);
		expect(() => normalizeAutofillTargetOrigin(`http://${host}`)).toThrow();
	});
	it.each(['http://user@172.16.0.10', 'http://user:password@172.16.0.10', 'ftp://172.16.0.10'])(
		'rejects credential-bearing or non-HTTP target URLs: %s',
		(input) => expect(() => normalizeAutofillTargetOrigin(input)).toThrow(),
	);
	it.each(['https://public.example:8443', 'http://localhost:8123', 'http://127.0.0.1:8123'])(
		'preserves the previously supported target %s',
		(origin) => expect(normalizeAutofillTargetOrigin(`${origin}/login`)).toBe(origin),
	);
});

describe('extension instance origins', () => {
	it.each([
		['https://2fa.example.com', 'https://2fa.example.com'],
		['https://2fa.example.com/vault?view=all#codes', 'https://2fa.example.com'],
		['http://localhost:8787/settings?tab=extension#setup', 'http://localhost:8787'],
		['http://127.0.0.1:8787/api/secrets', 'http://127.0.0.1:8787'],
	])('normalizes the allowed instance URL %s', (input, expected) => {
		expect(normalizeInstanceOrigin(input)).toBe(expected);
	});

	it.each([
		'http://2fa.example.com',
		'http://192.168.1.20:8787',
		'http://127.0.0.2:8787',
		'http://localhost.evil.example:8787',
		'ftp://2fa.example.com',
		'javascript:alert(1)',
		'chrome-extension://extension-id/options.html',
		'https://user@2fa.example.com',
		'https://user:password@2fa.example.com',
	])('rejects an unsafe instance URL: %s', (input) => {
		expect(() => normalizeInstanceOrigin(input)).toThrow();
	});

	it('collapses ports only for host permission matching while retaining exact-origin checks', () => {
		expect(originToPermissionPattern('https://2fa.example.com:8443')).toBe('https://2fa.example.com/*');
		expect(originToPermissionPattern('https://2fa.example.com:9443')).toBe('https://2fa.example.com/*');

		expect(isExactOrigin('https://2fa.example.com:8443/api/secrets', 'https://2fa.example.com:8443')).toBe(true);
		expect(isExactOrigin('https://2fa.example.com:9443/api/secrets', 'https://2fa.example.com:8443')).toBe(false);
	});
});
