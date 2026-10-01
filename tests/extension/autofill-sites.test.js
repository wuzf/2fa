import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	hasAutofillSite,
	isPermissionPatternInUse,
	pruneRevokedAutofillSites,
	readAutofillSites,
	restoreAutofillSites,
	setAutofillSite,
} from '../../extension/src/shared/autofill-sites.js';
import { originToPermissionPattern, targetOriginToPermissionPattern } from '../../extension/src/shared/origin.js';
import { saveSettings } from '../../extension/src/shared/storage.js';

const INSTANCE = 'https://twofa.example';
const OTHER_INSTANCE = 'https://other-twofa.example';
const TARGET = 'https://login.example';
const SITE = { instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: TARGET };
let values;
let permissions;

function defer() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	values = { settings: { instanceOrigin: INSTANCE } };
	permissions = new Set([originToPermissionPattern(TARGET)]);
	globalThis.chrome = {
		storage: {
			local: {
				get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })),
				set: vi.fn(async (entries) => Object.assign(values, structuredClone(entries))),
			},
		},
		permissions: {
			contains: vi.fn(async ({ origins }) => origins.every((origin) => permissions.has(origin))),
			remove: vi.fn(async () => true),
			request: vi.fn(async () => true),
		},
	};
});

afterEach(() => {
	delete globalThis.chrome;
});

describe('autofill site preferences', () => {
	it('authorizes exact paths independently and retains the shared host grant', async () => {
		await setAutofillSite(INSTANCE, TARGET, '/aaa', true);
		for (const path of ['/bbb', '/aaa/child', '/aaa/', '/AAA', '/#/aaa']) {
			expect(await hasAutofillSite(INSTANCE, TARGET, path)).toBe(false);
		}
		expect(await hasAutofillSite(INSTANCE, TARGET, '/aaa')).toBe(true);
		await setAutofillSite(INSTANCE, TARGET, '/#/aaa', true);
		await setAutofillSite(INSTANCE, TARGET, '/aaa', false);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/aaa')).toBe(false);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/#/aaa')).toBe(true);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/#/bbb')).toBe(false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(TARGET))).toBe(true);
	});

	it('disables and prunes old origin-only grants without turning them into root grants', async () => {
		values.autofillSites = [{ instanceOrigin: INSTANCE, targetOrigin: TARGET }];
		expect(await readAutofillSites()).toEqual([]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/')).toBe(false);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		await pruneRevokedAutofillSites();
		expect(values.autofillSites).toEqual([]);
		await setAutofillSite(INSTANCE, TARGET, '/totp', true);
		expect(await readAutofillSites()).toEqual([SITE]);
	});

	it.each([undefined, null, '', '/aaa?session=secret', '/aaa#anchor', '/aaa#/route?token=secret'])(
		'refuses grants with missing or noncanonical path %s',
		async (path) => {
			await expect(setAutofillSite(INSTANCE, TARGET, path, true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
			expect(chrome.storage.local.set).not.toHaveBeenCalled();
		},
	);
	it.each(['http', 'https'])(
		'requires an exact saved %s private-IPv4 origin even though the browser grant covers every port',
		async (scheme) => {
			const target = `${scheme}://172.16.0.10:8080`;
			const pattern = targetOriginToPermissionPattern(target);
			permissions.add(pattern);
			await setAutofillSite(INSTANCE, target, '/totp', true);
			expect(await hasAutofillSite(INSTANCE, target, '/totp')).toBe(true);
			for (const different of [
				`${scheme}://172.16.0.10`,
				`${scheme}://172.16.0.10:8081`,
				`${scheme === 'http' ? 'https' : 'http'}://172.16.0.10:8080`,
				`${scheme}://172.16.0.11:8080`,
			]) {
				expect(await hasAutofillSite(INSTANCE, different, '/totp')).toBe(false);
			}
			expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: [`${scheme}://172.16.0.10/*`] });
			expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(true);
			await setAutofillSite(INSTANCE, `${scheme}://172.16.0.10:8081`, '/totp', true);
			await setAutofillSite(INSTANCE, target, '/totp', false);
			expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(true);
			await setAutofillSite(INSTANCE, `${scheme}://172.16.0.10:8081`, '/totp', false);
			expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(false);
		},
	);

	it('prunes all private-IP ports on a revocation event without removing another scheme or host', async () => {
		const targets = ['http://172.16.0.10:8080', 'http://172.16.0.10:8081', 'https://172.16.0.10:8080', 'http://172.16.0.11:8080'];
		for (const target of targets) {
			permissions.add(targetOriginToPermissionPattern(target));
			await setAutofillSite(INSTANCE, target, '/totp', true);
		}
		await pruneRevokedAutofillSites(['http://172.16.0.10/*']);
		expect(values.autofillSites.map((site) => site.targetOrigin)).toEqual(targets.slice(2));
		expect(await hasAutofillSite(INSTANCE, targets[0], '/totp')).toBe(false);
	});

	describe('plain-HTTP network pages', () => {
		const HTTP_TARGETS = ['http://192.168.1.1', 'http://172.16.0.10:8080', 'http://10.0.0.1:8443'];

		it.each([...HTTP_TARGETS, 'http://169.254.1.1', 'http://router.local', 'http://login.example', 'http://[fd00::1]'])(
			'enables automatic filling on %s only after a host grant and an explicit page authorization',
			async (target) => {
				await expect(setAutofillSite(INSTANCE, target, '/login', true)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
				expect(chrome.storage.local.set).not.toHaveBeenCalled();
				permissions.add(targetOriginToPermissionPattern(target));
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(false);
				await setAutofillSite(INSTANCE, target, '/login', true);
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(true);
				expect(await hasAutofillSite(INSTANCE, target, '/other')).toBe(false);
				permissions.delete(targetOriginToPermissionPattern(target));
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(false);
			},
		);

		it('honors saved HTTP page authorizations with live browser permissions', async () => {
			values.autofillSites = [
				...HTTP_TARGETS.map((targetOrigin) => ({ instanceOrigin: INSTANCE, targetOrigin, targetPath: '/login' })),
				SITE,
			];
			for (const target of HTTP_TARGETS) {
				permissions.add(targetOriginToPermissionPattern(target));
			}
			expect(await readAutofillSites(INSTANCE)).toEqual(values.autofillSites);
			for (const target of HTTP_TARGETS) {
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(true);
			}
			expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
			expect(await isPermissionPatternInUse('http://192.168.1.1/*', INSTANCE)).toBe(true);
		});

		it('retains HTTP grants and host permissions during cleanup while pruning revoked sites', async () => {
			values.autofillSites = [
				{ instanceOrigin: INSTANCE, targetOrigin: 'http://192.168.1.1', targetPath: '/login' },
				{ instanceOrigin: OTHER_INSTANCE, targetOrigin: 'http://192.168.1.1:8080', targetPath: '/login' },
				{ instanceOrigin: INSTANCE, targetOrigin: 'http://10.0.0.1:8443', targetPath: '/login' },
				{ instanceOrigin: INSTANCE, targetOrigin: 'http://login.example', targetPath: '/login' },
				SITE,
			];
			for (const pattern of ['http://192.168.1.1/*', 'http://10.0.0.1/*']) {
				permissions.add(pattern);
			}
			const retained = values.autofillSites.filter((site) => site.targetOrigin !== 'http://login.example');
			await expect(pruneRevokedAutofillSites()).resolves.toEqual(retained);
			expect(values.autofillSites).toEqual(retained);
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
			chrome.storage.local.set.mockClear();
			await pruneRevokedAutofillSites();
			expect(chrome.storage.local.set).not.toHaveBeenCalled();
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		});

		it('does not restore a revoked HTTP page authorization after the browser permission is granted again', async () => {
			values.autofillSites = [{ instanceOrigin: INSTANCE, targetOrigin: 'http://192.168.1.1', targetPath: '/login' }, SITE];
			await expect(pruneRevokedAutofillSites()).resolves.toEqual([SITE]);
			expect(values.autofillSites).toEqual([SITE]);
			permissions.add('http://192.168.1.1/*');
			expect(await hasAutofillSite(INSTANCE, 'http://192.168.1.1', '/login')).toBe(false);
		});

		it.each(['http://localhost:8123', 'http://127.0.0.1:8123'])(
			'keeps automatic filling available on this device at %s',
			async (target) => {
				permissions.add(targetOriginToPermissionPattern(target));
				await setAutofillSite(INSTANCE, target, '/login', true);
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(true);
			},
		);
	});

	it('keeps the 2FA source HTTPS requirement even when the target is a private HTTP host', async () => {
		const source = 'http://172.16.0.10';
		values.settings = { instanceOrigin: source };
		await expect(setAutofillSite(source, 'http://10.0.0.1', '/totp', true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(chrome.permissions.contains).not.toHaveBeenCalled();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});
	it('requires a previously granted host permission before enabling a site', async () => {
		permissions.clear();
		await expect(setAutofillSite(INSTANCE, TARGET, '/totp', true)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(values.autofillSites).toBeUndefined();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		permissions.add(originToPermissionPattern(TARGET));
		expect(await setAutofillSite(INSTANCE, TARGET, '/totp', true)).toEqual([SITE]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
		expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://login.example/*'] });
	});

	it('treats unavailable or failed permission checks as ungranted', async () => {
		chrome.permissions.contains.mockRejectedValue(new Error('unavailable'));
		await expect(setAutofillSite(INSTANCE, TARGET, '/totp', true)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		values.autofillSites = [SITE];
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		delete chrome.permissions;
		await expect(setAutofillSite(INSTANCE, TARGET, '/totp', true)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
	});

	it('normalizes origins and makes repeated enabling idempotent', async () => {
		await Promise.all([
			setAutofillSite(`${INSTANCE}/settings`, `${TARGET}/totp?step=2`, '/totp', true),
			setAutofillSite('https://TWOFA.example:443/', 'https://LOGIN.example:443/', '/totp', true),
		]);
		expect(values.autofillSites).toEqual([SITE]);
		expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
	});

	it('serializes additions and removal without losing another site', async () => {
		const otherTarget = 'https://second.example';
		permissions.add(originToPermissionPattern(otherTarget));
		await Promise.all([
			setAutofillSite(INSTANCE, TARGET, '/totp', true),
			setAutofillSite(INSTANCE, otherTarget, '/totp', true),
			setAutofillSite(INSTANCE, TARGET, '/totp', false),
		]);
		expect(values.autofillSites).toEqual([{ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: otherTarget }]);
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
	});

	it('disables a site without requiring or removing browser permissions', async () => {
		values.autofillSites = [SITE];
		permissions.clear();
		expect(await setAutofillSite(INSTANCE, TARGET, '/totp', false)).toEqual([]);
		expect(values.autofillSites).toEqual([]);
		expect(chrome.permissions.contains).not.toHaveBeenCalled();
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
	});

	it('keeps preferences exact by port even when a browser permission covers all ports', async () => {
		await setAutofillSite(INSTANCE, `${TARGET}:8443`, '/totp', true);
		expect(await hasAutofillSite(INSTANCE, `${TARGET}:8443/login`, '/totp')).toBe(true);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		expect(await hasAutofillSite(INSTANCE, `${TARGET}:9443`, '/totp')).toBe(false);
		await setAutofillSite(INSTANCE, `${TARGET}:9443`, '/totp', true);
		await setAutofillSite(INSTANCE, `${TARGET}:8443`, '/totp', false);
		expect(await hasAutofillSite(INSTANCE, `${TARGET}:9443`, '/totp')).toBe(true);
	});

	it('preserves inactive instance preferences without authorizing them', async () => {
		await setAutofillSite(INSTANCE, TARGET, '/totp', true);
		await saveSettings(OTHER_INSTANCE);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		await setAutofillSite(OTHER_INSTANCE, TARGET, '/totp', true);
		expect(await readAutofillSites()).toEqual([SITE, { ...SITE, instanceOrigin: OTHER_INSTANCE }]);
		expect(await readAutofillSites(INSTANCE)).toEqual([SITE]);
		expect(await hasAutofillSite(OTHER_INSTANCE, TARGET, '/totp')).toBe(true);
		await setAutofillSite(OTHER_INSTANCE, TARGET, '/totp', false);
		expect(await readAutofillSites()).toEqual([SITE]);
		await saveSettings(INSTANCE);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
	});

	it('does not authorize a previously enabled site after its permission is revoked', async () => {
		values.autofillSites = [SITE];
		permissions.clear();
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		expect(await readAutofillSites()).toEqual([SITE]);
	});

	it('removes revoked preferences so a later unrelated host grant cannot reactivate them', async () => {
		const retainedTarget = 'https://retained.example';
		const retainedSite = { ...SITE, targetOrigin: retainedTarget };
		values.autofillSites = [SITE, { ...SITE, instanceOrigin: OTHER_INSTANCE, targetOrigin: `${TARGET}:8443` }, retainedSite];
		permissions.clear();
		permissions.add(originToPermissionPattern(retainedTarget));
		expect(await pruneRevokedAutofillSites()).toEqual([retainedSite]);
		expect(values.autofillSites).toEqual([retainedSite]);
		// Both ports and instances share one browser host permission lookup.
		expect(chrome.permissions.contains).toHaveBeenCalledTimes(2);
		permissions.add(originToPermissionPattern(TARGET));
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		expect(await hasAutofillSite(INSTANCE, retainedTarget, '/totp')).toBe(true);
	});

	it('honors a queued removal event even if the host was granted again before cleanup', async () => {
		values.autofillSites = [SITE, { ...SITE, instanceOrigin: OTHER_INSTANCE, targetOrigin: `${TARGET}:8443` }];
		// contains is true again, but the earlier removal must still discard both preferences.
		expect(await pruneRevokedAutofillSites([originToPermissionPattern(TARGET)])).toEqual([]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		await setAutofillSite(INSTANCE, TARGET, '/totp', true);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
	});

	it('does not rewrite preferences if every saved site still has permission', async () => {
		values.autofillSites = [SITE];
		expect(await pruneRevokedAutofillSites()).toEqual([SITE]);
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it.each([true, false])('rejects stale instance messages when enabled=%s', async (enabled) => {
		values.autofillSites = [SITE];
		await saveSettings(OTHER_INSTANCE);
		await expect(setAutofillSite(INSTANCE, TARGET, '/totp', enabled)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(values.autofillSites).toEqual([SITE]);
	});

	it('rejects an instance switch while an enabling permission check is pending', async () => {
		const pending = defer();
		const started = defer();
		chrome.permissions.contains.mockImplementationOnce(() => {
			started.resolve();
			return pending.promise;
		});
		const result = setAutofillSite(INSTANCE, TARGET, '/totp', true);
		const rejected = expect(result).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await started.promise;
		await saveSettings(OTHER_INSTANCE);
		pending.resolve(true);
		await rejected;
		expect(values.autofillSites).toBeUndefined();
		await setAutofillSite(OTHER_INSTANCE, TARGET, '/totp', true);
		expect(values.autofillSites).toEqual([{ ...SITE, instanceOrigin: OTHER_INSTANCE }]);
	});

	it('rejects a settings switch during a stored-site read before disabling', async () => {
		values.autofillSites = [SITE];
		const pending = defer();
		const started = defer();
		const originalGet = chrome.storage.local.get.getMockImplementation();
		chrome.storage.local.get.mockImplementation(async (key) => {
			if (key === 'autofillSites') {
				started.resolve();
				await pending.promise;
			}
			return originalGet(key);
		});
		const result = setAutofillSite(INSTANCE, TARGET, '/totp', false);
		const rejected = expect(result).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await started.promise;
		await saveSettings(OTHER_INSTANCE);
		pending.resolve();
		await rejected;
		expect(values.autofillSites).toEqual([SITE]);
	});

	it('does not return an active authorization if the instance switches during its permission check', async () => {
		values.autofillSites = [SITE];
		const pending = defer();
		const started = defer();
		chrome.permissions.contains.mockImplementationOnce(() => {
			started.resolve();
			return pending.promise;
		});
		const result = hasAutofillSite(INSTANCE, TARGET, '/totp');
		await started.promise;
		await saveSettings(OTHER_INSTANCE);
		pending.resolve(true);
		expect(await result).toBe(false);
	});

	it.each([
		['file:///tmp/login', true],
		['https://user:pass@login.example', true],
		[INSTANCE, true],
		[`${INSTANCE}/totp`, true],
		[TARGET, 'true'],
		[null, true],
	])('rejects invalid target or switch %s %s', async (target, enabled) => {
		await expect(setAutofillSite(INSTANCE, target, '/totp', enabled)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it.each(['http://localhost:8080', 'http://127.0.0.1:8080'])('allows HTTP on the local development host %s', async (target) => {
		permissions.add(originToPermissionPattern(target));
		expect(await setAutofillSite(INSTANCE, target, '/totp', true)).toEqual([
			{ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: target },
		]);
	});

	it('filters invalid and duplicate stored entries and returns independent records', async () => {
		values.autofillSites = [
			null,
			{},
			SITE,
			{ ...SITE, targetOrigin: `${TARGET}/step` },
			{ ...SITE, targetOrigin: 'ftp://invalid.example' },
			{ ...SITE, instanceOrigin: 'http://insecure.example' },
			{ ...SITE, targetOrigin: INSTANCE },
			{ ...SITE, targetOrigin: 'https://user:pass@login.example' },
			{ ...SITE, instanceOrigin: OTHER_INSTANCE, secret: 'unexpected' },
		];
		const sites = await readAutofillSites();
		expect(sites).toEqual([SITE, { ...SITE, instanceOrigin: OTHER_INSTANCE }]);
		sites[0].targetOrigin = 'https://changed.example';
		sites.pop();
		expect(await readAutofillSites()).toEqual([SITE, { ...SITE, instanceOrigin: OTHER_INSTANCE }]);
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it.each([undefined, null, {}, 'invalid'])('treats non-array stored value %s as no sites', async (raw) => {
		values.autofillSites = raw;
		expect(await readAutofillSites()).toEqual([]);
	});

	it('limits reads to 128 valid unique records and rejects new sites when full without discarding existing entries', async () => {
		values.autofillSites = Array.from({ length: 129 }, (_, index) => ({
			instanceOrigin: INSTANCE,
			targetOrigin: `https://site-${index}.example`,
			targetPath: '/totp',
		}));
		const before = structuredClone(values.autofillSites);
		expect(await readAutofillSites()).toHaveLength(128);
		await expect(setAutofillSite(INSTANCE, TARGET, '/totp', true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(values.autofillSites).toEqual(before);
		permissions.add(originToPermissionPattern(before[0].targetOrigin));
		expect(await setAutofillSite(INSTANCE, before[0].targetOrigin, '/totp', true)).toHaveLength(128);
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
		await setAutofillSite(INSTANCE, before[0].targetOrigin, '/totp', false);
		await setAutofillSite(INSTANCE, TARGET, '/totp', true);
		expect(values.autofillSites).toHaveLength(128);
		expect(values.autofillSites).toContainEqual(SITE);
	});

	it('never reads account, credential or offline secret storage', async () => {
		await setAutofillSite(INSTANCE, TARGET, '/totp', true);
		await hasAutofillSite(INSTANCE, TARGET, '/totp');
		await isPermissionPatternInUse(originToPermissionPattern(TARGET), INSTANCE);
		expect(new Set(chrome.storage.local.get.mock.calls.map(([key]) => key))).toEqual(new Set(['settings', 'autofillSites']));
	});
});

describe('site-wide autofill grants', () => {
	const WHOLE = { instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath: '*', pagePath: '/totp' };
	const page = (targetPath, targetOrigin = TARGET) => ({ instanceOrigin: INSTANCE, targetOrigin, targetPath });

	it('covers every path of the exact origin and records the page it was made on', async () => {
		expect(await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' })).toEqual([WHOLE]);
		for (const path of ['/totp', '/', '/settings/2fa', '/#/mfa']) {
			expect(await hasAutofillSite(INSTANCE, TARGET, path)).toBe(true);
		}
		permissions.add(targetOriginToPermissionPattern('http://login.example'));
		permissions.add(targetOriginToPermissionPattern('https://sub.login.example'));
		for (const origin of [`${TARGET}:8443`, 'https://sub.login.example', 'http://login.example']) {
			expect(await hasAutofillSite(INSTANCE, origin, '/totp')).toBe(false);
		}
		expect(values.autofillSites).toEqual([WHOLE]);
	});

	it('never treats the site marker as a live page path', async () => {
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' });
		await expect(hasAutofillSite(INSTANCE, TARGET, '*')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
	});

	it('does not authorize another instance or a revoked host', async () => {
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' });
		values.settings = { instanceOrigin: OTHER_INSTANCE };
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(false);
		values.settings = { instanceOrigin: INSTANCE };
		permissions.clear();
		expect(await hasAutofillSite(INSTANCE, TARGET, '/settings')).toBe(false);
	});

	it('replaces the page grants of its origin, and turning it off removes every grant of the origin', async () => {
		const other = 'https://other.example';
		permissions.add(originToPermissionPattern(other));
		await setAutofillSite(INSTANCE, TARGET, '/a', true);
		await setAutofillSite(INSTANCE, TARGET, '/b', true);
		await setAutofillSite(INSTANCE, other, '/a', true);
		values.autofillSites.push({ ...SITE, instanceOrigin: OTHER_INSTANCE });
		expect(await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/a' })).toEqual([
			page('/a', other),
			{ ...WHOLE, pagePath: '/a' },
		]);
		expect(values.autofillSites).toEqual([page('/a', other), { ...SITE, instanceOrigin: OTHER_INSTANCE }, { ...WHOLE, pagePath: '/a' }]);
		expect(await setAutofillSite(INSTANCE, TARGET, '*', false)).toEqual([page('/a', other)]);
		expect(values.autofillSites).toEqual([page('/a', other), { ...SITE, instanceOrigin: OTHER_INSTANCE }]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/a')).toBe(false);
	});

	it('narrows a site-wide grant when its page is enabled on its own', async () => {
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' });
		expect(await setAutofillSite(INSTANCE, TARGET, '/totp', true)).toEqual([page('/totp')]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/settings')).toBe(false);
	});

	it('keeps a site-wide grant when only one page is turned off', async () => {
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' });
		expect(await setAutofillSite(INSTANCE, TARGET, '/totp', false)).toEqual([WHOLE]);
		expect(chrome.storage.local.set).toHaveBeenCalledOnce();
	});

	it('moves the recorded page when a site-wide grant is made again elsewhere', async () => {
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' });
		expect(await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/verify' })).toEqual([{ ...WHOLE, pagePath: '/verify' }]);
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/verify' });
		expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
	});

	it.each([undefined, null, '', '*', 'totp', '/totp?token=secret'])(
		'requires a canonical page for a site-wide grant: %s',
		async (pagePath) => {
			await expect(setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
			expect(chrome.storage.local.set).not.toHaveBeenCalled();
		},
	);

	it('requires the host permission for a site-wide grant', async () => {
		permissions.clear();
		await expect(setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/totp' })).rejects.toMatchObject({
			code: 'PERMISSION_REQUIRED',
		});
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it('ignores and prunes stored site-wide grants without a valid page, keeping valid records', async () => {
		values.autofillSites = [
			{ instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath: '*' },
			{ ...WHOLE, targetOrigin: 'https://other.example', pagePath: 'totp' },
			{ ...SITE, pagePath: '/totp' },
			WHOLE,
		];
		expect(await readAutofillSites()).toEqual([page('/totp'), WHOLE]);
		expect(await pruneRevokedAutofillSites()).toEqual([page('/totp'), WHOLE]);
		expect(values.autofillSites).toEqual([page('/totp'), WHOLE]);
	});

	it('does not rewrite a permitted site-wide grant during cleanup', async () => {
		values.autofillSites = [WHOLE];
		expect(await pruneRevokedAutofillSites()).toEqual([WHOLE]);
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it('prunes a site-wide grant with its revoked host permission', async () => {
		values.autofillSites = [WHOLE];
		expect(await pruneRevokedAutofillSites([targetOriginToPermissionPattern(TARGET)])).toEqual([]);
		expect(values.autofillSites).toEqual([]);
	});

	it("puts back an origin's grants exactly as they were read", async () => {
		const other = 'https://other.example';
		permissions.add(originToPermissionPattern(other));
		await setAutofillSite(INSTANCE, TARGET, '/a', true);
		await setAutofillSite(INSTANCE, TARGET, '/b', true);
		await setAutofillSite(INSTANCE, other, '/a', true);
		const before = await readAutofillSites(INSTANCE);
		await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/a' });
		expect(await restoreAutofillSites(INSTANCE, TARGET, before)).toEqual([page('/a', other), page('/a'), page('/b')]);
		expect(await hasAutofillSite(INSTANCE, TARGET, '/c')).toBe(false);
		expect(await restoreAutofillSites(INSTANCE, TARGET, [])).toEqual([page('/a', other)]);
		values.settings = { instanceOrigin: OTHER_INSTANCE };
		await expect(restoreAutofillSites(INSTANCE, TARGET, before)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it('counts a site-wide grant as one record against the limit', async () => {
		values.autofillSites = [
			...Array.from({ length: 126 }, (_, index) => page('/totp', `https://site-${index}.example`)),
			page('/a'),
			page('/b'),
		];
		expect(await setAutofillSite(INSTANCE, TARGET, '*', true, { pagePath: '/a' })).toHaveLength(127);
	});
});

describe('shared permission ownership', () => {
	it('protects the active instance permission even without automatic sites', async () => {
		expect(await isPermissionPatternInUse(originToPermissionPattern(INSTANCE), INSTANCE)).toBe(true);
		expect(await isPermissionPatternInUse(originToPermissionPattern(INSTANCE))).toBe(true);
		expect(await isPermissionPatternInUse(originToPermissionPattern(TARGET), INSTANCE)).toBe(false);
	});

	it('protects a permission shared by different target ports until the last site is disabled', async () => {
		await setAutofillSite(INSTANCE, `${TARGET}:8443`, '/totp', true);
		await setAutofillSite(INSTANCE, `${TARGET}:9443`, '/totp', true);
		await setAutofillSite(INSTANCE, `${TARGET}:8443`, '/totp', false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(TARGET), INSTANCE)).toBe(true);
		await setAutofillSite(INSTANCE, `${TARGET}:9443`, '/totp', false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(TARGET), INSTANCE)).toBe(false);
	});

	it('protects a target permission also used by the active instance on a different port', async () => {
		const target = `${INSTANCE}:8443`;
		permissions.add(originToPermissionPattern(target));
		await setAutofillSite(INSTANCE, target, '/totp', true);
		await setAutofillSite(INSTANCE, target, '/totp', false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(target), INSTANCE)).toBe(true);
	});

	it('does not retain permissions for inactive instances or when there is no current instance', async () => {
		values.autofillSites = [{ ...SITE, instanceOrigin: OTHER_INSTANCE }];
		expect(await isPermissionPatternInUse(originToPermissionPattern(TARGET), INSTANCE)).toBe(false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(OTHER_INSTANCE), INSTANCE)).toBe(false);
		expect(await isPermissionPatternInUse(originToPermissionPattern(INSTANCE), null)).toBe(false);
		values.settings = {};
		expect(await isPermissionPatternInUse(originToPermissionPattern(INSTANCE))).toBe(false);
	});
});
