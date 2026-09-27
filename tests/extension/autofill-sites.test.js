import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	hasAutofillSite,
	isPermissionPatternInUse,
	pruneRevokedAutofillSites,
	readAutofillSites,
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
	it('requires an exact saved HTTPS private-IPv4 origin even though the browser grant covers every port', async () => {
		const target = 'https://172.16.0.10:8080';
		const pattern = targetOriginToPermissionPattern(target);
		permissions.add(pattern);
		await setAutofillSite(INSTANCE, target, '/totp', true);
		expect(await hasAutofillSite(INSTANCE, target, '/totp')).toBe(true);
		for (const different of ['https://172.16.0.10', 'https://172.16.0.10:8081', 'http://172.16.0.10:8080', 'https://172.16.0.11:8080']) {
			expect(await hasAutofillSite(INSTANCE, different, '/totp')).toBe(false);
		}
		expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://172.16.0.10/*'] });
		expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(true);
		await setAutofillSite(INSTANCE, 'https://172.16.0.10:8081', '/totp', true);
		await setAutofillSite(INSTANCE, target, '/totp', false);
		expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(true);
		await setAutofillSite(INSTANCE, 'https://172.16.0.10:8081', '/totp', false);
		expect(await isPermissionPatternInUse(pattern, INSTANCE)).toBe(false);
	});

	it('prunes all private-IP ports on a revocation event without removing another scheme or host', async () => {
		const targets = ['https://172.16.0.10:8080', 'https://172.16.0.10:8081', 'http://localhost:8080', 'https://172.16.0.11:8080'];
		for (const target of targets) {
			permissions.add(targetOriginToPermissionPattern(target));
			await setAutofillSite(INSTANCE, target, '/totp', true);
		}
		await pruneRevokedAutofillSites(['https://172.16.0.10/*']);
		expect(values.autofillSites.map((site) => site.targetOrigin)).toEqual(targets.slice(2));
		expect(await hasAutofillSite(INSTANCE, targets[0], '/totp')).toBe(false);
	});

	describe('plain-HTTP network pages', () => {
		const LEGACY = ['http://192.168.1.1', 'http://172.16.0.10:8080', 'http://10.0.0.1:8443'];

		it.each([...LEGACY, 'http://169.254.1.1', 'http://router.local', 'http://login.example'])(
			'refuses to enable automatic filling on %s',
			async (target) => {
				permissions.add(`http://${new URL(target).hostname}/*`);
				await expect(setAutofillSite(INSTANCE, target, '/login', true)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
				expect(chrome.storage.local.set).not.toHaveBeenCalled();
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(false);
			},
		);

		it('never executes a grant saved before these pages became manual-only', async () => {
			values.autofillSites = [...LEGACY.map((targetOrigin) => ({ instanceOrigin: INSTANCE, targetOrigin, targetPath: '/login' })), SITE];
			for (const target of LEGACY) {
				permissions.add(`http://${new URL(target).hostname}/*`);
			}
			expect(await readAutofillSites(INSTANCE)).toEqual([SITE]);
			for (const target of LEGACY) {
				expect(await hasAutofillSite(INSTANCE, target, '/login')).toBe(false);
			}
			expect(await hasAutofillSite(INSTANCE, TARGET, '/totp')).toBe(true);
			expect(await isPermissionPatternInUse('http://192.168.1.1/*', INSTANCE)).toBe(false);
		});

		it('deletes such grants and releases only their private host permissions during cleanup', async () => {
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
			await expect(pruneRevokedAutofillSites()).resolves.toEqual([SITE]);
			expect(values.autofillSites).toEqual([SITE]);
			expect(chrome.permissions.remove).toHaveBeenCalledExactlyOnceWith({ origins: ['http://192.168.1.1/*', 'http://10.0.0.1/*'] });
			chrome.permissions.remove.mockClear();
			await pruneRevokedAutofillSites();
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		});

		it('keeps cleaning up stored grants when the browser refuses to remove the host permission', async () => {
			values.autofillSites = [{ instanceOrigin: INSTANCE, targetOrigin: 'http://192.168.1.1', targetPath: '/login' }, SITE];
			chrome.permissions.remove.mockRejectedValue(new Error('Permission is required'));
			await expect(pruneRevokedAutofillSites()).resolves.toEqual([SITE]);
			expect(values.autofillSites).toEqual([SITE]);
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
		['http://login.example', true],
		['http://172.15.1.1', true],
		['http://172.32.1.1', true],
		['http://172.16.0.10.evil.example', true],
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
			{ ...SITE, targetOrigin: 'http://insecure.example' },
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
