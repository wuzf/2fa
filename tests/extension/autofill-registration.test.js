import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let reconcileAutofillScripts;
import { originToPermissionPattern, targetOriginToPermissionPattern } from '../../extension/src/shared/origin.js';

const INSTANCE = 'https://twofa.example';
const TARGET = 'https://login.example';
const OTHER_INSTANCE = 'https://another-twofa.example';
const OTHER_TARGET = 'https://other-login.example';
const SITE = { instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: TARGET };
const SCRIPT_ID = 'twofa-auto-sites';
const FOREIGN_SCRIPT = { id: 'other-feature', matches: ['https://foreign.example/*'], js: ['other.js'] };

let values;
let permissions;
let scripts;
let openTabs;

function descriptor(origins = [TARGET]) {
	return {
		id: SCRIPT_ID,
		matches: [...new Set(origins.map(targetOriginToPermissionPattern))].sort(),
		js: ['automatic.js'],
		runAt: 'document_idle',
		allFrames: false,
		world: 'ISOLATED',
		persistAcrossSessions: true,
	};
}

beforeEach(async () => {
	vi.resetModules();
	({ reconcileAutofillScripts } = await import('../../extension/src/background/autofill-registration.js'));
	values = { settings: { instanceOrigin: INSTANCE }, autofillSites: [SITE] };
	permissions = new Set([INSTANCE, TARGET].map(originToPermissionPattern));
	scripts = new Map();
	openTabs = [];
	globalThis.chrome = {
		storage: { local: { get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })) } },
		permissions: { contains: vi.fn(async ({ origins }) => origins.every((origin) => permissions.has(origin))) },
		tabs: {
			query: vi.fn(async () => structuredClone(openTabs)),
			sendMessage: vi.fn(async () => ({})),
		},
		scripting: {
			getRegisteredContentScripts: vi.fn(async () => structuredClone([...scripts.values()])),
			unregisterContentScripts: vi.fn(async ({ ids }) => ids.forEach((id) => scripts.delete(id))),
			registerContentScripts: vi.fn(async (entries) => entries.forEach((entry) => scripts.set(entry.id, structuredClone(entry)))),
			updateContentScripts: vi.fn(async (entries) => entries.forEach((entry) => scripts.set(entry.id, structuredClone(entry)))),
			executeScript: vi.fn(async () => [{ frameId: 0 }]),
		},
	};
});

afterEach(() => {
	vi.useRealTimers();
	delete globalThis.chrome;
});

describe('persistent automatic-fill registration', () => {
	it('removes old broad registrations when only legacy origin grants remain', async () => {
		values.autofillSites = [{ instanceOrigin: INSTANCE, targetOrigin: TARGET }];
		scripts.set(SCRIPT_ID, descriptor());
		await reconcileAutofillScripts();
		expect(scripts.has(SCRIPT_ID)).toBe(false);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('keeps one host runner while either of its separately authorized routes remains', async () => {
		values.autofillSites = [SITE, { ...SITE, targetPath: '/other-totp' }];
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID).matches).toEqual([originToPermissionPattern(TARGET)]);
		values.autofillSites = [{ ...SITE, targetPath: '/other-totp' }];
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID).matches).toEqual([originToPermissionPattern(TARGET)]);
	});
	it.each(['http', 'https'])('registers an %s private host but starts only the explicitly authorized origin', async (scheme) => {
		const target = `${scheme}://172.16.0.10:8080`;
		const pattern = targetOriginToPermissionPattern(target);
		values.autofillSites = [{ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: target }];
		permissions.add(pattern);
		openTabs = [
			{ id: 1, url: `${target}/login` },
			{ id: 2, url: `${scheme}://172.16.0.10:8081/login` },
			{ id: 3, url: `${scheme === 'http' ? 'https' : 'http'}://172.16.0.10:8080/login` },
			{ id: 4, url: `${scheme}://172.16.0.11:8080/login` },
		];
		await reconcileAutofillScripts();
		expect(chrome.scripting.registerContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor([target])]);
		expect(chrome.permissions.contains.mock.calls).toEqual([
			[{ origins: [originToPermissionPattern(INSTANCE)] }],
			[{ origins: [pattern] }],
		]);
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 1, frameIds: [0] },
			files: ['automatic.js'],
			world: 'ISOLATED',
		});
		permissions.delete(pattern);
		chrome.scripting.executeScript.mockClear();
		await reconcileAutofillScripts();
		expect(scripts.has(SCRIPT_ID)).toBe(false);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('retains and starts a saved HTTP page authorization with a live host grant', async () => {
		const target = 'http://172.16.0.10:8080';
		values.autofillSites = [{ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: target }];
		permissions.add('http://172.16.0.10/*');
		scripts.set(SCRIPT_ID, { ...descriptor(), matches: ['http://172.16.0.10/*'] });
		openTabs = [{ id: 1, url: `${target}/totp` }];
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor([target]));
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 1, frameIds: [0] },
			files: ['automatic.js'],
			world: 'ISOLATED',
		});
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, { type: 'AUTO_STOP' }, { frameId: 0 });
		expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['http://172.16.0.10/*'] });
	});

	it('keeps other sites registered while a revoked HTTP page has not acknowledged its stop', async () => {
		vi.useFakeTimers();
		const revoked = 'http://172.16.0.10:8080';
		values.autofillSites = [SITE, { instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: revoked }];
		scripts.set(SCRIPT_ID, { ...descriptor(), matches: ['http://172.16.0.10/*', targetOriginToPermissionPattern(TARGET)] });
		openTabs = [
			{ id: 1, url: `${revoked}/totp` },
			{ id: 2, url: `${TARGET}/totp` },
		];
		// The revoked page does not answer its first stop message.
		chrome.tabs.sendMessage.mockImplementationOnce(() => new Promise(() => {}));
		const first = reconcileAutofillScripts();
		await vi.advanceTimersByTimeAsync(2_000);
		await first;
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
		chrome.tabs.sendMessage.mockClear();
		chrome.scripting.unregisterContentScripts.mockClear();
		// The next reconciliation retries that stop without a pattern for the
		// retired address, and never drops the scripts of other websites.
		await expect(reconcileAutofillScripts()).resolves.toBeUndefined();
		expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, { type: 'AUTO_STOP' }, { frameId: 0 });
	});

	it('does not treat a private HTTP source as a valid vault', async () => {
		values.settings.instanceOrigin = 'http://172.16.0.10';
		values.autofillSites = [{ instanceOrigin: 'http://172.16.0.10', targetPath: '/totp', targetOrigin: TARGET }];
		permissions.add('http://172.16.0.10/*');
		await reconcileAutofillScripts();
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expect(chrome.permissions.contains).not.toHaveBeenCalled();
	});
	it('registers only current-instance sites with source and target permissions', async () => {
		values.autofillSites.push({ instanceOrigin: OTHER_INSTANCE, targetPath: '/totp', targetOrigin: OTHER_TARGET });
		permissions.add(originToPermissionPattern(OTHER_TARGET));
		await reconcileAutofillScripts();
		expect(chrome.scripting.registerContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor()]);
		expect(chrome.permissions.contains.mock.calls).toEqual([
			[{ origins: [originToPermissionPattern(INSTANCE)] }],
			[{ origins: [originToPermissionPattern(TARGET)] }],
		]);
		expect(chrome.tabs.query).toHaveBeenCalledWith({ url: [originToPermissionPattern(TARGET)] });
	});

	it('shares permission checks and match patterns across exact target ports and the instance host', async () => {
		values.settings.instanceOrigin = `${TARGET}:9443`;
		values.autofillSites = [TARGET, `${TARGET}:8443`].map((targetOrigin) => ({
			instanceOrigin: `${TARGET}:9443`,
			targetPath: '/totp',
			targetOrigin,
		}));
		await reconcileAutofillScripts();
		expect(chrome.permissions.contains).toHaveBeenCalledExactlyOnceWith({ origins: [originToPermissionPattern(TARGET)] });
		expect(scripts.get(SCRIPT_ID).matches).toEqual([originToPermissionPattern(TARGET)]);
	});

	it('updates its own existing registration and removes obsolete owned IDs without touching others', async () => {
		scripts.set(SCRIPT_ID, descriptor([OTHER_TARGET]));
		scripts.set('twofa-auto-legacy', { id: 'twofa-auto-legacy', matches: [originToPermissionPattern(OTHER_TARGET)] });
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
		await reconcileAutofillScripts();
		expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledExactlyOnceWith({ ids: ['twofa-auto-legacy'] });
		expect(chrome.scripting.updateContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor()]);
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
	});

	it('keeps an identical persistent registration while refreshing existing runners', async () => {
		scripts.set(SCRIPT_ID, descriptor());
		openTabs = [{ id: 7, url: `${TARGET}/login` }];
		await reconcileAutofillScripts();
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.updateContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(7, { type: 'AUTO_STOP' }, { frameId: 0 });
		expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
	});

	it.each(['source', 'target', 'disabled', 'not configured'])(
		'removes owned scripts and stops runners when %s no longer authorizes automatic filling',
		async (reason) => {
			scripts.set(SCRIPT_ID, descriptor());
			scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
			openTabs = [{ id: 3, url: `${TARGET}/login` }];
			if (reason === 'source') {
				permissions.delete(originToPermissionPattern(INSTANCE));
			}
			if (reason === 'target') {
				permissions.delete(originToPermissionPattern(TARGET));
			}
			if (reason === 'disabled') {
				values.autofillSites = [];
			}
			if (reason === 'not configured') {
				values.settings = null;
			}
			await reconcileAutofillScripts();
			expect(scripts.has(SCRIPT_ID)).toBe(false);
			expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
			expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(3, { type: 'AUTO_STOP' }, { frameId: 0 });
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expect(chrome.tabs.query).toHaveBeenCalledExactlyOnceWith({});
		},
	);

	it('removes a revoked target while preserving an allowed target registration', async () => {
		values.autofillSites.push({ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: OTHER_TARGET });
		permissions.add(originToPermissionPattern(OTHER_TARGET));
		scripts.set(SCRIPT_ID, descriptor([TARGET, OTHER_TARGET]));
		permissions.delete(originToPermissionPattern(TARGET));
		await reconcileAutofillScripts();
		expect(chrome.scripting.updateContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor([OTHER_TARGET])]);
	});

	it('stops old-instance runners before registering and starting only the new instance sites', async () => {
		scripts.set(SCRIPT_ID, descriptor());
		values.settings.instanceOrigin = OTHER_INSTANCE;
		values.autofillSites.push({ instanceOrigin: OTHER_INSTANCE, targetPath: '/totp', targetOrigin: OTHER_TARGET });
		permissions.add(originToPermissionPattern(OTHER_INSTANCE));
		permissions.add(originToPermissionPattern(OTHER_TARGET));
		openTabs = [
			{ id: 1, url: TARGET },
			{ id: 2, url: OTHER_TARGET },
		];
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor([OTHER_TARGET]));
		expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 2, frameIds: [0] },
			files: ['automatic.js'],
			world: 'ISOLATED',
		});
		expect(Math.max(...chrome.tabs.sendMessage.mock.invocationCallOrder)).toBeLessThan(
			chrome.scripting.updateContentScripts.mock.invocationCallOrder[0],
		);
	});
});

describe('already-open page activation', () => {
	it('skips discarded and frozen tabs for both stop messages and injection', async () => {
		openTabs = [
			{ id: 1, url: TARGET, discarded: true },
			{ id: 2, url: TARGET, frozen: true },
			{ id: 3, url: TARGET },
		];
		await reconcileAutofillScripts();
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(3, { type: 'AUTO_STOP' }, { frameId: 0 });
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 3, frameIds: [0] },
			files: ['automatic.js'],
			world: 'ISOLATED',
		});
	});

	it('injects only exact allowed origins, excluding other ports, schemes, hosts and incognito pages', async () => {
		openTabs = [
			{ id: 1, url: `${TARGET}/login` },
			{ id: 2, url: `${TARGET}:8443/login` },
			{ id: 3, url: 'http://login.example/login' },
			{ id: 4, url: 'https://sub.login.example/login' },
			{ id: 5, url: `${TARGET}/login`, incognito: true },
			{ id: 6, url: 'chrome://settings/' },
			{ id: 7 },
			{ id: -1, url: TARGET },
			{ url: TARGET },
		];
		await reconcileAutofillScripts();
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 1, frameIds: [0] },
			files: ['automatic.js'],
			world: 'ISOLATED',
		});
	});

	it('accepts both ports only when each exact origin is explicitly enabled', async () => {
		values.autofillSites.push({ instanceOrigin: INSTANCE, targetPath: '/totp', targetOrigin: `${TARGET}:8443` });
		openTabs = [
			{ id: 1, url: TARGET },
			{ id: 2, url: `${TARGET}:8443` },
			{ id: 3, url: `${TARGET}:9443` },
		];
		await reconcileAutofillScripts();
		expect(chrome.scripting.executeScript.mock.calls.map(([entry]) => entry.target.tabId)).toEqual([1, 2]);
	});

	it('waits for navigation instead of injecting into pages with any pending URL', async () => {
		openTabs = [
			{ id: 1, url: TARGET, pendingUrl: `${TARGET}/next-step` },
			{ id: 2, url: TARGET, pendingUrl: OTHER_TARGET },
			{ id: 3, url: OTHER_TARGET, pendingUrl: TARGET },
		];
		await reconcileAutofillScripts();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('continues through missing receivers and tabs that navigate or close during injection', async () => {
		openTabs = [
			{ id: 1, url: TARGET },
			{ id: 2, url: TARGET },
		];
		chrome.tabs.sendMessage.mockRejectedValue(new Error('no receiver'));
		chrome.scripting.executeScript.mockRejectedValueOnce(new Error('tab closed'));
		await reconcileAutofillScripts();
		expect(chrome.scripting.executeScript.mock.calls.map(([entry]) => entry.target.tabId)).toEqual([1, 2]);
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
	});
});

describe('registration failures and serialization', () => {
	it('bounds an unanswered STOP and releases the queue for the next reconciliation', async () => {
		vi.useFakeTimers();
		openTabs = [
			{ id: 1, url: TARGET },
			{ id: 2, url: TARGET },
		];
		chrome.tabs.sendMessage.mockImplementationOnce(() => new Promise(() => {}));
		const completed = vi.fn();
		const first = reconcileAutofillScripts().then(completed);
		const second = reconcileAutofillScripts().then(completed);
		await vi.advanceTimersByTimeAsync(0);
		expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_999);
		expect(completed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await Promise.all([first, second]);
		expect(completed).toHaveBeenCalledTimes(2);
		expect(chrome.scripting.executeScript.mock.calls.map(([entry]) => entry.target.tabId)).toEqual([1, 2, 1, 2]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('starts other tabs without waiting for a hung injection and bounds the whole injection phase', async () => {
		vi.useFakeTimers();
		openTabs = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, url: TARGET }));
		for (let index = 0; index < 4; index += 1) {
			chrome.scripting.executeScript.mockImplementationOnce(() => new Promise(() => {}));
		}
		const completed = vi.fn();
		const first = reconcileAutofillScripts().then(completed);
		const second = reconcileAutofillScripts().then(completed);
		await vi.advanceTimersByTimeAsync(0);
		expect(chrome.scripting.executeScript.mock.calls.map(([entry]) => entry.target.tabId)).toEqual([1, 2, 3, 4, 5]);
		expect(completed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);
		await Promise.all([first, second]);
		expect(completed).toHaveBeenCalledTimes(2);
		expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(10);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('finishes within two phase timeouts when every renderer call stays pending', async () => {
		vi.useFakeTimers();
		openTabs = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, url: TARGET }));
		chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
		chrome.scripting.executeScript.mockImplementation(() => new Promise(() => {}));
		const completed = vi.fn();
		const operation = reconcileAutofillScripts().then(completed);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(4);
		expect(completed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);
		await operation;
		expect(completed).toHaveBeenCalledOnce();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects registration errors and permits a successful retry', async () => {
		const failure = new Error('registration failed');
		chrome.scripting.registerContentScripts.mockRejectedValueOnce(failure);
		await expect(reconcileAutofillScripts()).rejects.toBe(failure);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
	});

	it('cleans obsolete registrations if an update fails while preserving unrelated scripts', async () => {
		scripts.set(SCRIPT_ID, descriptor([OTHER_TARGET]));
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
		const failure = new Error('update failed');
		chrome.scripting.updateContentScripts.mockRejectedValueOnce(failure);
		await expect(reconcileAutofillScripts()).rejects.toBe(failure);
		expect([...scripts.values()]).toEqual([FOREIGN_SCRIPT]);
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
	});

	it('fails closed and removes owned registrations when a permission check fails', async () => {
		scripts.set(SCRIPT_ID, descriptor());
		const failure = new Error('permission service unavailable');
		chrome.permissions.contains.mockRejectedValueOnce(failure);
		await expect(reconcileAutofillScripts()).rejects.toBe(failure);
		expect(scripts.has(SCRIPT_ID)).toBe(false);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('does not mask the first failure or poison the queue if cleanup also fails', async () => {
		scripts.set(SCRIPT_ID, descriptor([OTHER_TARGET]));
		const failure = new Error('update failed');
		chrome.scripting.updateContentScripts.mockRejectedValueOnce(failure);
		chrome.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error('cleanup failed'));
		await expect(reconcileAutofillScripts()).rejects.toBe(failure);
		await reconcileAutofillScripts();
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor());
	});

	it('serializes simultaneous reconciliations and reads the latest settings when each starts', async () => {
		let release;
		const hold = new Promise((resolve) => {
			release = resolve;
		});
		const original = chrome.scripting.registerContentScripts.getMockImplementation();
		chrome.scripting.registerContentScripts.mockImplementationOnce(async (entries) => {
			await hold;
			return original(entries);
		});
		const first = reconcileAutofillScripts();
		await vi.waitFor(() => expect(chrome.scripting.registerContentScripts).toHaveBeenCalledOnce());
		values.settings.instanceOrigin = OTHER_INSTANCE;
		values.autofillSites.push({ instanceOrigin: OTHER_INSTANCE, targetPath: '/totp', targetOrigin: OTHER_TARGET });
		permissions.add(originToPermissionPattern(OTHER_INSTANCE));
		permissions.add(originToPermissionPattern(OTHER_TARGET));
		const second = reconcileAutofillScripts();
		await Promise.resolve();
		expect(chrome.scripting.getRegisteredContentScripts).toHaveBeenCalledOnce();
		release();
		await Promise.all([first, second]);
		expect(scripts.get(SCRIPT_ID)).toEqual(descriptor([OTHER_TARGET]));
	});
});

describe('registration patterns', () => {
	it('registers and starts the convertible scopes when another scope no longer converts to a pattern', async () => {
		const { createRegistrationController } = await import('../../extension/src/background/registration-controller.js');
		const controller = createRegistrationController({
			id: 'pattern-test',
			ownsScript: (script) => script.id === 'pattern-test',
			file: 'pattern-test.js',
			stopMessage: 'PATTERN_TEST_STOP',
			getScopes: async () =>
				new Map([
					[TARGET, '/totp'],
					['ftp://172.16.0.10:8080', '/totp'],
				]),
			permissionPattern: targetOriginToPermissionPattern,
		});
		openTabs = [{ id: 2, url: `${TARGET}/totp` }];
		await expect(controller.reconcile()).resolves.toBeUndefined();
		expect(scripts.get('pattern-test').matches).toEqual([targetOriginToPermissionPattern(TARGET)]);
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 2, frameIds: [0] },
			files: ['pattern-test.js'],
			world: 'ISOLATED',
		});
	});
});
