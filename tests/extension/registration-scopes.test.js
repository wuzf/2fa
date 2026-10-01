import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { originToPermissionPattern } from '../../extension/src/shared/origin.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

const SOURCE = 'https://twofa.example';
const OTHER_SOURCE = 'https://other-twofa.example';
const TARGET = 'https://login.example';
const OTHER_TARGET = 'https://other-login.example';
const UNRELATED = 'https://unrelated.example';
const AUTO_ID = 'twofa-auto-sites';
const SOURCE_ID = 'twofa-source-watch';
const FOREIGN_SCRIPT = { id: 'other-feature', matches: [`${UNRELATED}/*`], js: ['other.js'] };

let values;
let sessionValues;
let permissions;
let scripts;
let tabs;
let reconcileAutofillScripts;
let reconcileSourceWatcher;
let observeAutofillRenderer;
let observeSourceRenderer;

function site(targetOrigin = TARGET, targetPath = '/totp', instanceOrigin = SOURCE) {
	return { instanceOrigin, targetOrigin, targetPath };
}

function descriptor(id, origins) {
	return {
		id,
		matches: [...new Set(origins.map(originToPermissionPattern))].sort(),
		js: [id === SOURCE_ID ? 'source-watch.js' : 'automatic.js'],
		runAt: 'document_idle',
		allFrames: false,
		world: 'ISOLATED',
		persistAcrossSessions: true,
	};
}

function area(store) {
	return {
		get: vi.fn(async (keys) => {
			const requested =
				keys === null || keys === undefined
					? Object.keys(store)
					: typeof keys === 'string'
						? [keys]
						: Array.isArray(keys)
							? keys
							: Object.keys(keys);
			return Object.fromEntries(requested.map((key) => [key, structuredClone(store[key])]));
		}),
		set: vi.fn(async (entries) => Object.assign(store, structuredClone(entries))),
		remove: vi.fn(async (keys) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				delete store[key];
			}
		}),
	};
}

function matchesUrl(url, pattern) {
	if (!url) {
		return false;
	}
	const parsed = new URL(url);
	const expected = new URL(pattern);
	return parsed.protocol === expected.protocol && (expected.hostname === '*' || parsed.hostname === expected.hostname);
}

async function restartWorker() {
	vi.resetModules();
	({ reconcileAutofillScripts, observeAutofillRenderer } = await import('../../extension/src/background/autofill-registration.js'));
	({ reconcileSourceWatcher, observeSourceRenderer } = await import('../../extension/src/background/source-registration.js'));
}

function clearEffects() {
	chrome.tabs.query.mockClear();
	chrome.tabs.sendMessage.mockClear();
	for (const name of ['registerContentScripts', 'updateContentScripts', 'unregisterContentScripts', 'executeScript']) {
		chrome.scripting[name].mockClear();
	}
}

function stopped(type) {
	return chrome.tabs.sendMessage.mock.calls
		.filter(([, message]) => message.type === type)
		.map(([tabId]) => tabId)
		.sort((a, b) => a - b);
}

function started(file) {
	return chrome.scripting.executeScript.mock.calls
		.filter(([entry]) => entry.files.includes(file))
		.map(([entry]) => entry.target.tabId)
		.sort((a, b) => a - b);
}

function expectNoRegistrationWrites() {
	expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
	expect(chrome.scripting.updateContentScripts).not.toHaveBeenCalled();
	expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
}

beforeEach(async () => {
	values = { settings: { instanceOrigin: SOURCE }, autofillSites: [site()], offlineInstances: [SOURCE, OTHER_SOURCE] };
	sessionValues = {};
	permissions = new Set([SOURCE, OTHER_SOURCE, TARGET, OTHER_TARGET].map(originToPermissionPattern));
	scripts = new Map();
	tabs = [
		{ id: 1, url: `${TARGET}/totp` },
		{ id: 2, url: `${OTHER_TARGET}/totp` },
		{ id: 3, url: `${SOURCE}/accounts` },
		{ id: 4, url: `${OTHER_SOURCE}/accounts` },
		{ id: 5, url: `${UNRELATED}/login` },
	];
	vi.stubGlobal('chrome', {
		runtime: { id: 'registration-tests' },
		storage: { local: area(values), session: area(sessionValues) },
		permissions: { contains: vi.fn(async ({ origins }) => origins.every((pattern) => permissions.has(pattern))) },
		tabs: {
			query: vi.fn(async ({ url } = {}) =>
				structuredClone(tabs.filter((tab) => !url || (Array.isArray(url) ? url : [url]).some((pattern) => matchesUrl(tab.url, pattern)))),
			),
			sendMessage: vi.fn(async () => ({})),
		},
		scripting: {
			getRegisteredContentScripts: vi.fn(async ({ ids } = {}) =>
				structuredClone([...scripts.values()].filter((entry) => !ids || ids.includes(entry.id))),
			),
			registerContentScripts: vi.fn(async (entries) => entries.forEach((entry) => scripts.set(entry.id, structuredClone(entry)))),
			updateContentScripts: vi.fn(async (entries) => entries.forEach((entry) => scripts.set(entry.id, structuredClone(entry)))),
			unregisterContentScripts: vi.fn(async ({ ids }) => ids.forEach((id) => scripts.delete(id))),
			executeScript: vi.fn(async () => [{ frameId: 0 }]),
		},
	});
	await restartWorker();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('registration changes affect only their source and target pages', () => {
	it.each(['autofill', 'source'])('does not query or interrupt pages when the %s configuration is unchanged', async (kind) => {
		const reconcile = kind === 'autofill' ? reconcileAutofillScripts : reconcileSourceWatcher;
		await reconcile();
		clearEffects();

		await reconcile();
		await reconcile();

		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expectNoRegistrationWrites();
	});

	it.each(['autofill', 'source'])(
		'explicitly refreshes only the currently authorized %s pages when the user reconnects unchanged settings',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			await reconcile();
			clearEffects();

			await reconcile({ refreshCurrent: true });

			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([automatic ? 1 : 3]);
			expect(started(automatic ? 'automatic.js' : 'source-watch.js')).toEqual([automatic ? 1 : 3]);
			expectNoRegistrationWrites();
			clearEffects();
			await reconcile();
			expect(chrome.tabs.query).not.toHaveBeenCalled();
			expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		},
	);

	it('ignores site ordering and duplicate authorizations without interrupting runners', async () => {
		values.autofillSites = [site(), site(OTHER_TARGET), site(TARGET, '/backup')];
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites = [site(TARGET, '/backup'), site(OTHER_TARGET), site(), site()];

		await reconcileAutofillScripts();

		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expectNoRegistrationWrites();
	});

	it('refreshes only the origin whose authorized path changes even though its host registration stays identical', async () => {
		values.autofillSites = [site(), site(OTHER_TARGET)];
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites = [site(TARGET, '/replacement'), site(OTHER_TARGET)];

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
		expect(started('automatic.js')).toEqual([1]);
		expectNoRegistrationWrites();
		expect(chrome.tabs.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(chrome.scripting.executeScript.mock.invocationCallOrder[0]);
	});

	it('refreshes only the origin whose page grants become one site-wide grant', async () => {
		values.autofillSites = [site(), site(TARGET, '/backup'), site(OTHER_TARGET)];
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites = [site(OTHER_TARGET), { ...site(TARGET, '*'), pagePath: '/totp' }];

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
		expect(started('automatic.js')).toEqual([1]);
		expectNoRegistrationWrites();
		clearEffects();
		// Moving the recorded page of the same site-wide grant changes nothing it covers.
		values.autofillSites = [site(OTHER_TARGET), { ...site(TARGET, '*'), pagePath: '/verify' }];
		await reconcileAutofillScripts();
		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([]);
		expect(started('automatic.js')).toEqual([]);
	});

	it('activates a newly authorized origin without stopping or restarting the existing origin', async () => {
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites.push(site(OTHER_TARGET));

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([2]);
		expect(started('automatic.js')).toEqual([2]);
		expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET, OTHER_TARGET]));
	});

	it('stops only a removed origin and preserves other live runners', async () => {
		values.autofillSites.push(site(OTHER_TARGET));
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites = [site()];

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([2]);
		expect(started('automatic.js')).toEqual([]);
		expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET]));
	});

	it('keeps another authorized port running when only one exact origin changes paths', async () => {
		const otherPort = `${TARGET}:8443`;
		values.autofillSites.push(site(otherPort));
		tabs.push({ id: 6, url: `${otherPort}/totp` });
		await reconcileAutofillScripts();
		clearEffects();
		values.autofillSites = [site(TARGET, '/replacement'), site(otherPort)];

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
		expect(started('automatic.js')).toEqual([1]);
		expectNoRegistrationWrites();
	});

	it('refreshes a target when its source instance changes despite keeping the same registered target host', async () => {
		values.autofillSites.push(site(TARGET, '/totp', OTHER_SOURCE));
		await reconcileAutofillScripts();
		clearEffects();
		values.settings.instanceOrigin = OTHER_SOURCE;

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
		expect(started('automatic.js')).toEqual([1]);
		expectNoRegistrationWrites();
	});

	it('refreshes the same target when the current instance switches between offline and session access', async () => {
		await reconcileAutofillScripts();
		for (const offlineInstances of [[], [SOURCE]]) {
			clearEffects();
			values.offlineInstances = offlineInstances;

			await reconcileAutofillScripts();

			expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
			expect(started('automatic.js')).toEqual([1]);
			expectNoRegistrationWrites();
		}
	});

	it('stops the previous instance watcher and starts the new source without contacting target or unrelated pages', async () => {
		await reconcileSourceWatcher();
		clearEffects();
		values.settings.instanceOrigin = OTHER_SOURCE;

		await reconcileSourceWatcher();

		expect(stopped(MESSAGE.SOURCE_STOP)).toEqual([3, 4]);
		expect(started('source-watch.js')).toEqual([4]);
		expect(scripts.get(SOURCE_ID)).toEqual(descriptor(SOURCE_ID, [OTHER_SOURCE]));
	});

	it('stops only the source watcher when offline source access is disabled', async () => {
		await reconcileSourceWatcher();
		clearEffects();
		values.offlineInstances = [];

		await reconcileSourceWatcher();

		expect(stopped(MESSAGE.SOURCE_STOP)).toEqual([3]);
		expect(started('source-watch.js')).toEqual([]);
		expect(scripts.has(SOURCE_ID)).toBe(false);
	});

	it.each(['autofill', 'source'])(
		'refreshes already open %s pages after a worker restart with an identical persistent registration',
		async (kind) => {
			await (kind === 'autofill' ? reconcileAutofillScripts() : reconcileSourceWatcher());
			clearEffects();
			await restartWorker();

			await (kind === 'autofill' ? reconcileAutofillScripts() : reconcileSourceWatcher());

			const automatic = kind === 'autofill';
			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([automatic ? 1 : 3]);
			expect(started(automatic ? 'automatic.js' : 'source-watch.js')).toEqual([automatic ? 1 : 3]);
			expectNoRegistrationWrites();
		},
	);

	it.each(['autofill', 'source'])(
		'stops known %s renderers after permission revocation hides their URLs without contacting unrelated tabs',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			const observe = automatic ? observeAutofillRenderer : observeSourceRenderer;
			const origin = automatic ? TARGET : SOURCE;
			const existingId = automatic ? 1 : 3;
			await reconcile();
			// This page starts from the registered content script after reconciliation,
			// so it was never in the background's explicit injection batch.
			const laterTab = { id: 6, url: `${origin}/totp` };
			tabs.push(laterTab);
			observe({ id: chrome.runtime.id, tab: laterTab, url: laterTab.url, frameId: 0, documentId: 'later-document' });
			clearEffects();
			permissions.delete(originToPermissionPattern(origin));
			tabs = tabs.map((tab) => ([existingId, 6].includes(tab.id) ? { id: tab.id } : tab));
			tabs.push({ id: 7 });

			await reconcile();

			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([existingId, 6]);
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expect(scripts.has(automatic ? AUTO_ID : SOURCE_ID)).toBe(false);
		},
	);

	it('retries only the target whose renderer injection failed without requiring a configuration change', async () => {
		values.autofillSites.push(site(OTHER_TARGET));
		chrome.scripting.executeScript.mockImplementation(async ({ target }) => {
			if (target.tabId === 2) {
				throw new Error('renderer navigated during injection');
			}
			return [];
		});
		await reconcileAutofillScripts();
		clearEffects();
		chrome.scripting.executeScript.mockResolvedValue([]);

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([2]);
		expect(started('automatic.js')).toEqual([2]);
		expectNoRegistrationWrites();
		clearEffects();
		await reconcileAutofillScripts();
		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('retries a failed source renderer on an unchanged configuration and stops retrying after success', async () => {
		chrome.scripting.executeScript.mockRejectedValueOnce(new Error('source page navigated'));
		await reconcileSourceWatcher();
		clearEffects();

		await reconcileSourceWatcher();

		expect(stopped(MESSAGE.SOURCE_STOP)).toEqual([3]);
		expect(started('source-watch.js')).toEqual([3]);
		expectNoRegistrationWrites();
		clearEffects();
		await reconcileSourceWatcher();
		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it.each(['autofill', 'source'])(
		'performs one conservative %s cleanup after a cold restart with no registration and hidden tab URLs',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			permissions.delete(originToPermissionPattern(automatic ? TARGET : SOURCE));
			tabs = [{ id: 6 }, { id: 5, url: `${UNRELATED}/login` }];

			await reconcile();

			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([6]);
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expectNoRegistrationWrites();
			clearEffects();
			await reconcile();
			expect(chrome.tabs.query).not.toHaveBeenCalled();
			expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		},
	);

	it.each(['autofill', 'source'])(
		'uses the revocation hint to stop a visible %s page after Chrome already cleared its registration',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			const revoked = automatic ? TARGET : SOURCE;
			permissions.delete(originToPermissionPattern(revoked));
			if (automatic) {
				values.autofillSites = [];
			} else {
				values.settings.instanceOrigin = null;
			}
			scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);

			await reconcile({ cleanupPatterns: [originToPermissionPattern(revoked)] });

			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([automatic ? 1 : 3]);
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expect([...scripts.values()]).toEqual([FOREIGN_SCRIPT]);
			expectNoRegistrationWrites();
		},
	);

	it.each(['autofill', 'source'])(
		'uses %s cleanup hints only to stop old pages while preserving exact authorization for injection',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			const id = automatic ? AUTO_ID : SOURCE_ID;
			const origin = automatic ? TARGET : SOURCE;
			const file = automatic ? 'automatic.js' : 'source-watch.js';
			const stop = automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP;
			await reconcile();
			clearEffects();

			await reconcile({ cleanupPatterns: [originToPermissionPattern(UNRELATED)] });

			expect(stopped(stop)).toEqual([5]);
			expect(started(file)).toEqual([]);
			expect(scripts.get(id)).toEqual(descriptor(id, [origin]));
			expectNoRegistrationWrites();
			clearEffects();
			// A queued removal hint can outlive a quick regrant. Stop the prior runner
			// but restore it only because the current saved policy still allows it.
			await reconcile({ cleanupPatterns: [originToPermissionPattern(origin)] });
			expect(stopped(stop)).toEqual([automatic ? 1 : 3]);
			expect(started(file)).toEqual([automatic ? 1 : 3]);
			expect(scripts.get(id)).toEqual(descriptor(id, [origin]));
			expectNoRegistrationWrites();
		},
	);

	it.each(['autofill', 'source'])('trusts a current visible URL over stale %s renderer ownership after navigation', async (kind) => {
		const automatic = kind === 'autofill';
		const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
		await reconcile();
		clearEffects();
		const previousTab = automatic ? 1 : 3;
		tabs = tabs.map((tab) => (tab.id === previousTab ? { ...tab, url: `${UNRELATED}/now-unrelated` } : tab));
		permissions.delete(originToPermissionPattern(automatic ? TARGET : SOURCE));

		await reconcile();

		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expect(scripts.has(automatic ? AUTO_ID : SOURCE_ID)).toBe(false);
	});

	it('bounds a hung STOP and retries only its affected origin on the next unchanged reconciliation', async () => {
		vi.useFakeTimers();
		values.autofillSites.push(site(OTHER_TARGET));
		chrome.tabs.sendMessage.mockImplementationOnce(() => new Promise(() => {}));
		const completed = vi.fn();
		const pending = reconcileAutofillScripts().then(completed);

		await vi.advanceTimersByTimeAsync(1999);
		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1, 2]);
		expect(completed).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(completed).toHaveBeenCalledOnce();
		expect(started('automatic.js')).toEqual([1, 2]);
		expect(vi.getTimerCount()).toBe(0);
		clearEffects();

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1]);
		expect(started('automatic.js')).toEqual([1]);
		expectNoRegistrationWrites();
		clearEffects();
		await reconcileAutofillScripts();
		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('stops pages from a legacy registration while preserving foreign registrations and unrelated tabs', async () => {
		scripts.set('twofa-auto-legacy', { id: 'twofa-auto-legacy', matches: [`${OTHER_TARGET}/*`], js: ['automatic.js'] });
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1, 2]);
		expect(started('automatic.js')).toEqual([1]);
		expect(scripts.has('twofa-auto-legacy')).toBe(false);
		expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
	});

	it('cleans a newly discovered legacy registration even when the current policy has not changed', async () => {
		await reconcileAutofillScripts();
		clearEffects();
		scripts.set('twofa-auto-legacy', { id: 'twofa-auto-legacy', matches: [`${OTHER_TARGET}/*`], js: ['automatic.js'] });
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([2]);
		expect(started('automatic.js')).toEqual([]);
		expect(scripts.has('twofa-auto-legacy')).toBe(false);
		expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET]));
		expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
	});

	it.each([`${TARGET}/*`, 'https://*/*'])(
		'restarts a still-authorized target after cleaning the overlapping legacy pattern %s',
		async (pattern) => {
			await reconcileAutofillScripts();
			clearEffects();
			scripts.set('twofa-auto-legacy', { id: 'twofa-auto-legacy', matches: [pattern], js: ['automatic.js'] });
			scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);

			await reconcileAutofillScripts();

			expect(stopped(MESSAGE.AUTO_STOP)).toEqual(pattern === 'https://*/*' ? [1, 2, 3, 4, 5] : [1]);
			expect(started('automatic.js')).toEqual([1]);
			expect(scripts.has('twofa-auto-legacy')).toBe(false);
			expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET]));
			expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
		},
	);

	it('repairs a registration changed outside reconciliation and refreshes both its old and desired scopes', async () => {
		await reconcileAutofillScripts();
		clearEffects();
		scripts.set(AUTO_ID, descriptor(AUTO_ID, [OTHER_TARGET]));
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);

		await reconcileAutofillScripts();

		expect(stopped(MESSAGE.AUTO_STOP)).toEqual([1, 2]);
		expect(started('automatic.js')).toEqual([1]);
		expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET]));
		expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
	});

	it('does not mark an unsuccessful registration change as applied and safely retries it', async () => {
		await reconcileAutofillScripts();
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
		clearEffects();
		values.autofillSites.push(site(OTHER_TARGET));
		const failure = new Error('registration update failed');
		chrome.scripting.updateContentScripts.mockRejectedValueOnce(failure);

		await expect(reconcileAutofillScripts()).rejects.toBe(failure);

		expect(started('automatic.js')).toEqual([]);
		expect(scripts.has(AUTO_ID)).toBe(false);
		expect(scripts.get(FOREIGN_SCRIPT.id)).toEqual(FOREIGN_SCRIPT);
		clearEffects();
		await reconcileAutofillScripts();
		expect(started('automatic.js')).toEqual([1, 2]);
		expect(scripts.get(AUTO_ID)).toEqual(descriptor(AUTO_ID, [TARGET, OTHER_TARGET]));
	});

	it.each(['autofill', 'source'])(
		'stops previously running %s pages on a permission check failure and refreshes them after recovery',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			await reconcile();
			clearEffects();
			const failure = new Error('permission service unavailable');
			chrome.permissions.contains.mockRejectedValueOnce(failure);

			await expect(reconcile()).rejects.toBe(failure);

			expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([automatic ? 1 : 3]);
			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expect(scripts.has(automatic ? AUTO_ID : SOURCE_ID)).toBe(false);
			clearEffects();
			await reconcile();
			expect(started(automatic ? 'automatic.js' : 'source-watch.js')).toEqual([automatic ? 1 : 3]);
		},
	);

	it.each(['autofill', 'source'])('stops known %s renderers even when registry enumeration fails again during cleanup', async (kind) => {
		const automatic = kind === 'autofill';
		const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
		await reconcile();
		scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
		clearEffects();
		const failure = new Error('registry unavailable');
		chrome.scripting.getRegisteredContentScripts.mockRejectedValue(failure);

		await expect(reconcile()).rejects.toBe(failure);

		expect(stopped(automatic ? MESSAGE.AUTO_STOP : MESSAGE.SOURCE_STOP)).toEqual([automatic ? 1 : 3]);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expect([...scripts.values()]).toEqual([FOREIGN_SCRIPT]);
	});

	it.each(['autofill', 'source'])(
		'removes only owned %s registrations when tab enumeration fails during a policy change and cleanup',
		async (kind) => {
			const automatic = kind === 'autofill';
			const reconcile = automatic ? reconcileAutofillScripts : reconcileSourceWatcher;
			await reconcile();
			scripts.set(FOREIGN_SCRIPT.id, FOREIGN_SCRIPT);
			clearEffects();
			if (automatic) {
				values.autofillSites = [site(TARGET, '/changed')];
			} else {
				values.offlineInstances = [];
			}
			const failure = new Error('tab enumeration unavailable');
			chrome.tabs.query.mockRejectedValue(failure);

			await expect(reconcile()).rejects.toBe(failure);

			expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
			expect([...scripts.values()]).toEqual([FOREIGN_SCRIPT]);
		},
	);
});
