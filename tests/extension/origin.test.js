import { describe, expect, it } from 'vitest';

import {
	autofillPathFromUrl,
	normalizeAutofillPath,
	isExactOrigin,
	isPrivateIPv4Host,
	normalizeAutofillTargetOrigin,
	normalizeInstanceOrigin,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	permissionPatternCoversOrigin,
	normalizeAutofillScope,
	autofillCoverage,
	AUTOFILL_SITE_SCOPE,
} from '../../extension/src/shared/origin.js';

describe('automatic fill grant scopes', () => {
	const INSTANCE = 'https://vault.example';
	const TARGET = 'https://login.example';
	const grant = (targetPath, extra = {}) => ({ instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath, ...extra });

	it('accepts the site marker or a canonical page path, and nothing else', () => {
		expect(normalizeAutofillScope(AUTOFILL_SITE_SCOPE)).toBe('*');
		expect(normalizeAutofillScope('/login')).toBe('/login');
		// A literal page path that ends in an asterisk stays one page.
		expect(normalizeAutofillScope('/*')).toBe('/*');
		for (const value of [undefined, null, '', '**', 'login', '/login?x=1']) {
			expect(() => normalizeAutofillScope(value)).toThrow();
		}
	});

	it('reports whether a page is covered by the whole site or by its own page grant', () => {
		expect(autofillCoverage([grant('*', { pagePath: '/a' })], INSTANCE, TARGET, '/anything')).toBe('site');
		expect(autofillCoverage([grant('/a'), grant('*', { pagePath: '/a' })], INSTANCE, TARGET, '/a')).toBe('site');
		expect(autofillCoverage([grant('/a')], INSTANCE, TARGET, '/a')).toBe('page');
		expect(autofillCoverage([grant('/a')], INSTANCE, TARGET, '/b')).toBeNull();
	});

	it('never lets a grant cover another origin or another instance', () => {
		const sites = [grant('*', { pagePath: '/a' })];
		expect(autofillCoverage(sites, INSTANCE, 'https://login.example:8443', '/a')).toBeNull();
		expect(autofillCoverage(sites, INSTANCE, 'http://login.example', '/a')).toBeNull();
		expect(autofillCoverage(sites, INSTANCE, 'https://sub.login.example', '/a')).toBeNull();
		expect(autofillCoverage(sites, 'https://other-vault.example', TARGET, '/a')).toBeNull();
		expect(autofillCoverage(undefined, INSTANCE, TARGET, '/a')).toBeNull();
		expect(autofillCoverage([null], INSTANCE, TARGET, '/a')).toBeNull();
	});
});

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

describe('automatic-fill target origins', () => {
	it.each(['10.0.0.0', '10.255.255.255', '172.16.0.0', '172.16.0.10', '172.31.255.255', '192.168.0.0', '192.168.255.255'])(
		'allows the canonical private host %s over HTTP and HTTPS while retaining vault restrictions',
		(host) => {
			expect(isPrivateIPv4Host(host)).toBe(true);
			expect(normalizeAutofillTargetOrigin(`http://${host}:8123/login`)).toBe(`http://${host}:8123`);
			expect(targetOriginToPermissionPattern(`http://${host}:8123`)).toBe(`http://${host}/*`);
			expect(normalizeAutofillTargetOrigin(`https://${host}:8123/login`)).toBe(`https://${host}:8123`);
			expect(targetOriginToPermissionPattern(`https://${host}:8123`)).toBe(`https://${host}/*`);
			expect(() => normalizeInstanceOrigin(`http://${host}:8123`)).toThrow();
			expect(() => originToPermissionPattern(`http://${host}:8123`)).toThrow();
		},
	);
	it.each([
		'http://192.168.1.1',
		'http://169.254.1.1',
		'http://router.local:8080',
		'http://[fd00::1]',
		'http://[::1]:8123',
		'http://login.example',
		'http://localhost:8123',
		'http://127.0.0.1:8123',
		'https://192.168.1.1',
		'https://login.example:8443',
	])('accepts HTTP and HTTPS target %s', (origin) => {
		expect(normalizeAutofillTargetOrigin(`${origin}/login?step=2#input`)).toBe(origin);
		const url = new URL(origin);
		expect(targetOriginToPermissionPattern(origin)).toBe(`${url.protocol}//${url.hostname}/*`);
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
	])('recognizes %s as outside private IPv4 ranges without excluding it from HTTP filling', (host) => {
		expect(isPrivateIPv4Host(host)).toBe(false);
		expect(normalizeAutofillTargetOrigin(`http://${host}`)).toBe(`http://${host}`);
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
	])('does not classify a noncanonical or non-IPv4 host as private IPv4: %s', (host) => {
		expect(isPrivateIPv4Host(host)).toBe(false);
	});
	it.each([
		'http://user@172.16.0.10',
		'http://user:password@172.16.0.10',
		'http://172.16.0.256',
		'ftp://172.16.0.10',
		'file:///tmp/login',
		'chrome://settings',
		'javascript:alert(1)',
		'not a url',
		null,
	])('rejects credential-bearing, invalid or non-HTTP target URLs: %s', (input) =>
		expect(() => normalizeAutofillTargetOrigin(input)).toThrow(),
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
