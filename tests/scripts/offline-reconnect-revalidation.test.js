// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

const CACHE_KEY = '2fa-secrets-cache';
const ACCOUNT = {
	id: 'example',
	name: 'Example',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const UPDATED = { ...ACCOUNT, name: 'Updated on the server' };

function response(data, status = 200) {
	return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => data };
}

async function flush() {
	for (let index = 0; index < 100; index += 1) {
		await Promise.resolve();
	}
}

// Real account reads, 401 handling and reconnect logic from the emitted page
// scripts; only card rendering, the clock and the worker transport are stubbed.
function harness(queued = []) {
	document.body.innerHTML =
		'<div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div><input id="searchInput">' +
		'<div id="loginModal" style="display:none"><input id="loginToken"><div id="loginError"></div></div>' +
		'<section id="offlineQueue" hidden><span id="offlineQueueSummary"></span><button id="offlineQueueLogin"></button>' +
		'<button id="offlineQueueReload"></button><button id="offlineQueueToggle"></button>' +
		'<p id="offlineQueueFeedback"></p><ul id="offlineQueueList"></ul></section>';
	const values = new Map([[CACHE_KEY, JSON.stringify({ data: [ACCOUNT], timestamp: 1 })]]);
	const storage = {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, value)),
		removeItem: vi.fn((key) => values.delete(key)),
	};
	const listeners = new Map();
	const workerMessages = [];
	class Channel {
		constructor() {
			this.port1 = { onmessage: null, close() {} };
			this.port2 = { close() {}, reply: (data) => this.port1.onmessage?.({ data }) };
		}
	}
	const controller = {
		postMessage: vi.fn((message, ports) => {
			workerMessages.push(message.type);
			// The worker keeps the queue; the page only reads its summary.
			if (ports) {
				ports[0].reply({ ok: true, operations: queued, authRequired: false });
			}
		}),
	};
	const registration = { active: controller, addEventListener() {}, update: async () => {} };
	const navigator = {
		onLine: false,
		language: 'zh-CN',
		serviceWorker: { controller, register: async () => registration, addEventListener() {}, ready: Promise.resolve(registration) },
	};
	const window = {
		navigator,
		isSecureContext: true,
		addEventListener: (type, callback) => listeners.set(type, callback),
		matchMedia: () => ({ matches: false }),
	};
	const fetch = vi.fn(async () => response([UPDATED]));
	const render = vi.fn(async (accounts) => {
		document.getElementById('secretsList').textContent = accounts.map((account) => account.name).join(',');
	});
	const toast = vi.fn();
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'fetch',
		'MessageChannel',
		'ensureServerTimeSynchronized',
		'render',
		'showCenterToast',
		'console',
		'setInterval',
		'requestAnimationFrame',
		`
		${getI18nCode()}${getStateCode()}${getAuthCode()}${getCoreCode()}${getPWACode()}
		const originalRenderSecrets = renderSecrets;
		renderSecrets = () => secrets.length ? render(secrets) : originalRenderSecrets();
		return { loadSecrets, refreshOfflineQueue, handleServiceWorkerMessage,
			getSecrets: () => secrets, getBlocked: () => secretReadsBlocked };
	`,
	)(
		document,
		window,
		navigator,
		storage,
		fetch,
		Channel,
		async () => true,
		render,
		toast,
		{ log() {}, warn() {}, error() {} },
		vi.fn(),
		(callback) => callback(),
	);
	return {
		...api,
		fetch,
		storage,
		navigator,
		workerMessages,
		online: () => {
			navigator.onLine = true;
			listeners.get('online')();
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('offline page reconnect revalidation', () => {
	it('replaces a page opened offline with the server list when only a stopped change is queued', async () => {
		const h = harness([{ id: 'stopped', type: 'UPDATE', name: 'Example', timestamp: 1, status: 'failed' }]);
		await h.loadSecrets();
		await h.refreshOfflineQueue();
		expect(document.getElementById('secretsList').textContent).toBe('Example');
		expect(h.fetch).not.toHaveBeenCalled();
		h.online();
		await flush();
		expect(h.fetch).toHaveBeenCalledWith('/api/secrets', expect.anything());
		expect(h.getSecrets()).toEqual([UPDATED]);
		expect(document.getElementById('secretsList').textContent).toBe('Updated on the server');
		expect(JSON.parse(h.storage.getItem(CACHE_KEY)).data).toEqual([UPDATED]);
	});

	it('clears cached codes like an online 401 when a replay finds the session expired, keeping the queue', async () => {
		const h = harness([{ id: 'pending', type: 'ADD', name: 'Offline', timestamp: 1, status: 'pending' }]);
		await h.loadSecrets();
		await h.refreshOfflineQueue();
		h.online();
		await flush();
		// Pending changes replay first; the worker then reports the login pause.
		expect(h.fetch).not.toHaveBeenCalled();
		h.fetch.mockResolvedValueOnce(response({ error: 'Login required' }, 401));
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 0,
			deferredCount: 0,
			authRequired: true,
			totalCount: 1,
		});
		await flush();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.getBlocked()).toBe(true);
		expect(h.getSecrets()).toEqual([]);
		expect(h.storage.getItem(CACHE_KEY)).toBeNull();
		expect(document.getElementById('secretsList').textContent).toBe('');
		expect(h.workerMessages).not.toContain('OFFLINE_QUEUE_CANCEL');
		await vi.advanceTimersByTimeAsync(1500);
		expect(document.getElementById('loginModal').style.display).toBe('flex');
	});

	it('keeps a still-valid session working after a stale login pause', async () => {
		const h = harness();
		await h.loadSecrets();
		h.online();
		await flush();
		h.fetch.mockClear();
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 0,
			deferredCount: 0,
			authRequired: true,
			totalCount: 1,
		});
		await flush();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.getBlocked()).toBe(false);
		expect(h.getSecrets()).toEqual([UPDATED]);
	});
});
