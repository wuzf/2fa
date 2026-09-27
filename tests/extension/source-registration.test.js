import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let reconcileSourceWatcher;
import { originToPermissionPattern } from '../../extension/src/shared/origin.js';
import { getConnectionStatus, getSettings } from '../../extension/src/shared/storage.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

vi.mock('../../extension/src/shared/storage.js', () => ({ getConnectionStatus: vi.fn(), getSettings: vi.fn() }));

const SOURCE = 'https://2fa.example';
const OTHER = 'https://other.example';
const ID = 'twofa-source-watch';
const TARGET_SCRIPT = { id: 'twofa-auto-sites', matches: ['https://login.example/*'], js: ['automatic.js'] };
let scripts;
let tabs;

function descriptor(origin = SOURCE) {
	return {
		id: ID,
		matches: [originToPermissionPattern(origin)],
		js: ['source-watch.js'],
		world: 'ISOLATED',
		allFrames: false,
		runAt: 'document_idle',
		persistAcrossSessions: true,
	};
}

beforeEach(async () => {
	vi.resetModules();
	({ reconcileSourceWatcher } = await import('../../extension/src/background/source-registration.js'));
	vi.clearAllMocks();
	getSettings.mockResolvedValue({ instanceOrigin: SOURCE });
	getConnectionStatus.mockResolvedValue({ mode: 'offline' });
	scripts = new Map();
	tabs = [];
	globalThis.chrome = {
		permissions: { contains: vi.fn(async () => true) },
		tabs: { query: vi.fn(async () => structuredClone(tabs)), sendMessage: vi.fn(async () => ({})) },
		scripting: {
			getRegisteredContentScripts: vi.fn(async () => structuredClone([...scripts.values()])),
			registerContentScripts: vi.fn(async (items) => items.forEach((item) => scripts.set(item.id, structuredClone(item)))),
			updateContentScripts: vi.fn(async (items) => items.forEach((item) => scripts.set(item.id, structuredClone(item)))),
			unregisterContentScripts: vi.fn(async ({ ids }) => ids.forEach((id) => scripts.delete(id))),
			executeScript: vi.fn(async () => []),
		},
	};
});

afterEach(() => {
	vi.useRealTimers();
	delete globalThis.chrome;
});

describe('offline source watcher registration', () => {
	it('registers an isolated persistent top-frame watcher only for the configured permitted source', async () => {
		await reconcileSourceWatcher();
		expect(chrome.permissions.contains).toHaveBeenCalledExactlyOnceWith({ origins: [originToPermissionPattern(SOURCE)] });
		expect(getConnectionStatus).toHaveBeenCalledExactlyOnceWith(SOURCE);
		expect(chrome.scripting.getRegisteredContentScripts).toHaveBeenCalledExactlyOnceWith();
		expect(chrome.scripting.registerContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor()]);
	});

	it.each(['session', 'no source', 'no permission'])('stops and unregisters its watcher for %s', async (reason) => {
		scripts.set(ID, descriptor());
		scripts.set(TARGET_SCRIPT.id, TARGET_SCRIPT);
		tabs = [{ id: 1, url: SOURCE }];
		if (reason === 'no source') {
			getSettings.mockResolvedValue({ instanceOrigin: null });
		} else if (reason === 'no permission') {
			chrome.permissions.contains.mockResolvedValue(false);
		} else {
			getConnectionStatus.mockResolvedValue({ mode: reason });
		}
		await reconcileSourceWatcher();
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, { type: MESSAGE.SOURCE_STOP }, { frameId: 0 });
		expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledExactlyOnceWith({ ids: [ID] });
		expect(scripts.get(TARGET_SCRIPT.id)).toEqual(TARGET_SCRIPT);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('updates a changed source without touching target or similarly named registrations', async () => {
		scripts.set(ID, descriptor(OTHER));
		scripts.set(TARGET_SCRIPT.id, TARGET_SCRIPT);
		const unrelated = { id: 'twofa-source-other', js: ['other.js'] };
		scripts.set(unrelated.id, unrelated);
		await reconcileSourceWatcher();
		expect(chrome.scripting.updateContentScripts).toHaveBeenCalledExactlyOnceWith([descriptor()]);
		expect(chrome.scripting.unregisterContentScripts).not.toHaveBeenCalled();
		expect(scripts.get(TARGET_SCRIPT.id)).toEqual(TARGET_SCRIPT);
		expect(scripts.get(unrelated.id)).toEqual(unrelated);
	});

	it('preserves an identical registration but refreshes current renderers', async () => {
		scripts.set(ID, descriptor());
		tabs = [{ id: 2, url: `${SOURCE}/accounts` }];
		await reconcileSourceWatcher();
		expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.updateContentScripts).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
			target: { tabId: 2, frameIds: [0] },
			files: ['source-watch.js'],
			world: 'ISOLATED',
		});
		expect(chrome.tabs.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(chrome.scripting.executeScript.mock.invocationCallOrder[0]);
	});

	it('injects only the exact source port and skips pending navigation, private and suspended tabs', async () => {
		getSettings.mockResolvedValue({ instanceOrigin: `${SOURCE}:8443` });
		tabs = [
			{ id: 1, url: `${SOURCE}:8443/secrets` },
			{ id: 2, url: SOURCE },
			{ id: 3, url: `${SOURCE}:9443` },
			{ id: 4, url: 'http://2fa.example:8443' },
			{ id: 5, url: 'https://sub.2fa.example:8443' },
			{ id: 6, url: `${SOURCE}:8443`, pendingUrl: `${SOURCE}:8443/next` },
			{ id: 7, url: `${SOURCE}:8443`, incognito: true },
			{ id: 8, url: `${SOURCE}:8443`, frozen: true },
			{ id: 9, url: `${SOURCE}:8443`, discarded: true },
			{ id: -1, url: `${SOURCE}:8443` },
			{ url: `${SOURCE}:8443` },
		];
		await reconcileSourceWatcher();
		expect(scripts.get(ID)).toEqual(descriptor(`${SOURCE}:8443`));
		expect(chrome.tabs.sendMessage.mock.calls.map(([id]) => id)).toEqual([1, 6]);
		expect(chrome.scripting.executeScript.mock.calls.map(([entry]) => entry.target.tabId)).toEqual([1]);
	});

	it('continues through missing receivers and a source tab closed during injection', async () => {
		tabs = [
			{ id: 1, url: SOURCE },
			{ id: 2, url: SOURCE },
		];
		chrome.tabs.sendMessage.mockRejectedValue(new Error('no receiver'));
		chrome.scripting.executeScript.mockRejectedValueOnce(new Error('closed'));
		await reconcileSourceWatcher();
		expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
		expect(scripts.get(ID)).toEqual(descriptor());
	});

	it('bounds each concurrent renderer phase to two seconds and releases the reconciliation queue', async () => {
		vi.useFakeTimers();
		tabs = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, url: SOURCE }));
		chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
		chrome.scripting.executeScript.mockImplementation(() => new Promise(() => {}));
		const completed = vi.fn();
		const first = reconcileSourceWatcher().then(completed);
		const second = reconcileSourceWatcher().then(completed);
		await vi.advanceTimersByTimeAsync(1999);
		expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(4);
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(2000);
		expect(completed).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(4000);
		await Promise.all([first, second]);
		expect(completed).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['register', 'update', 'permission'])('clears only its registration after a %s failure and permits retry', async (operation) => {
		scripts.set(TARGET_SCRIPT.id, TARGET_SCRIPT);
		if (operation !== 'register') {
			scripts.set(ID, descriptor(OTHER));
		}
		const failure = new Error('unavailable');
		if (operation === 'register') {
			chrome.scripting.registerContentScripts.mockRejectedValueOnce(failure);
		}
		if (operation === 'update') {
			chrome.scripting.updateContentScripts.mockRejectedValueOnce(failure);
		}
		if (operation === 'permission') {
			chrome.permissions.contains.mockRejectedValueOnce(failure);
		}
		await expect(reconcileSourceWatcher()).rejects.toBe(failure);
		expect(scripts.has(ID)).toBe(false);
		expect(scripts.get(TARGET_SCRIPT.id)).toEqual(TARGET_SCRIPT);
		await reconcileSourceWatcher();
		expect(scripts.get(ID)).toEqual(descriptor());
	});

	it('retains the original failure when cleanup also fails', async () => {
		const original = new Error('registration failed');
		chrome.scripting.registerContentScripts.mockRejectedValueOnce(original);
		chrome.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error('cleanup failed'));
		await expect(reconcileSourceWatcher()).rejects.toBe(original);
		await reconcileSourceWatcher();
		expect(scripts.get(ID)).toEqual(descriptor());
	});
});
