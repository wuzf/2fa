// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

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

const fixtures = [];
// Use the actual assembled account store, OTP engine, official view and PWA/auth
// handlers. Only network/worker transport and the clock are test boundaries.
async function harness(queued = []) {
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
	const fetch = vi.fn(async () => response([UPDATED]));
	const fixture = await createRuntimeFixture({
		// Account replay/revalidation assertions count account reads. The assembled
		// host also performs independent appearance reads when reconnecting.
		fetch: (url, options) => (url === '/api/secrets' ? fetch(url, options) : Promise.resolve(response({}, 503))),
		extraSource: `Object.assign(window.__runtimeFixture, {
			refreshOfflineQueue, handleServiceWorkerMessage,
			getSecrets: () => accountStore.getRecords(), getBlocked: () => accountStore.getState().blocked,
			getQueue: () => getOfflineQueueSnapshot()
		});`,
	});
	fixtures.push(fixture);
	const { window } = fixture;
	const navigator = window.navigator;
	Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: { controller, register: async () => registration, addEventListener() {}, ready: Promise.resolve(registration) },
	});
	window.MessageChannel = Channel;
	window.setTimeout = globalThis.setTimeout.bind(globalThis);
	window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
	window.setInterval = globalThis.setInterval.bind(globalThis);
	window.clearInterval = globalThis.clearInterval.bind(globalThis);
	window.localStorage.setItem(CACHE_KEY, JSON.stringify({ data: [ACCOUNT], timestamp: 1 }));
	fixture.setClock(1700000000000);
	fixture.getOfficialAccountView();
	window.dispatchEvent(new window.Event('offline'));
	return {
		...fixture,
		fetch,
		storage: window.localStorage,
		navigator,
		workerMessages,
		online: () => {
			navigator.onLine = true;
			window.dispatchEvent(new window.Event('online'));
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.dispose();
	}
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('offline page reconnect revalidation', () => {
	it('replaces a page opened offline with the server list when only a stopped change is queued', async () => {
		const h = await harness([{ id: 'stopped', type: 'UPDATE', name: 'Example', timestamp: 1, status: 'failed' }]);
		await h.loadSecrets();
		await h.refreshOfflineQueue();
		expect(h.document.querySelector('.secret-name').textContent).toBe('Example');
		expect(h.getOtpEngine().readCopyTarget(ACCOUNT.id, 'current').status).toBe('ready');
		expect(h.fetch).not.toHaveBeenCalled();
		h.online();
		await flush();
		expect(h.fetch).toHaveBeenCalledWith('/api/secrets', expect.anything());
		expect(h.getSecrets()).toEqual([UPDATED]);
		expect(h.document.querySelector('.secret-name').textContent).toBe('Updated on the server');
		expect(JSON.parse(h.storage.getItem(CACHE_KEY)).data).toEqual([UPDATED]);
	});

	it('clears cached codes like an online 401 when a replay finds the session expired, keeping the queue', async () => {
		const h = await harness([{ id: 'pending', type: 'ADD', name: 'Offline', timestamp: 1, status: 'pending' }]);
		await h.loadSecrets();
		expect(h.getOtpEngine().readCommitted(ACCOUNT.id)).not.toBeNull();
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
		expect(h.getOtpEngine().readCommitted(ACCOUNT.id)).toBeNull();
		expect(h.storage.getItem(CACHE_KEY)).toBeNull();
		expect(h.document.getElementById('secretsList').textContent).toBe('');
		expect(h.workerMessages).not.toContain('OFFLINE_QUEUE_CANCEL');
		expect(h.getQueue().operations.map((operation) => operation.id)).toEqual(['pending']);
		await vi.advanceTimersByTimeAsync(1500);
		expect(h.document.getElementById('loginModal').style.display).toBe('flex');
	});

	it('keeps a still-valid session working after a stale login pause', async () => {
		const h = await harness();
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
