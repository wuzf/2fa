import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';

function getNotifyPayloads(source, messageType) {
	return [...source.matchAll(/await notifyClients\(\{([\s\S]*?)\n\s*\}\);/g)]
		.map((match) => match[1])
		.filter((payload) => payload.includes(`type: '${messageType}'`));
}

function createPWAHarness({ online = true } = {}) {
	const controller = { postMessage: vi.fn() };
	const registration = { scope: '/', addEventListener: vi.fn(), update: vi.fn() };
	const serviceWorker = {
		controller,
		addEventListener: vi.fn(),
		register: vi.fn().mockResolvedValue(registration),
		ready: Promise.resolve(registration),
	};
	const navigator = {
		onLine: online,
		serviceWorker,
	};
	const window = {
		navigator,
		addEventListener: vi.fn(),
		matchMedia: vi.fn(() => ({ matches: false })),
	};
	const document = {
		hidden: false,
		addEventListener: vi.fn(),
		getElementById: vi.fn(() => null),
		createElement: vi.fn(() => ({ classList: { add: vi.fn() } })),
		body: {
			classList: { add: vi.fn(), remove: vi.fn() },
			prepend: vi.fn(),
		},
	};
	const loadSecrets = vi.fn();
	const showCenterToast = vi.fn();
	const quietConsole = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
	const setTimeout = vi.fn();

	// eslint-disable-next-line no-new-func
	const api = new Function(
		'navigator',
		'window',
		'document',
		'loadSecrets',
		'showCenterToast',
		'console',
		'setInterval',
		'setTimeout',
		`${getPWACode()}
      return { requestPendingOperationSync, handleServiceWorkerMessage };
    `,
	)(navigator, window, document, loadSecrets, showCenterToast, quietConsole, vi.fn(), setTimeout);

	return {
		api,
		controller,
		navigator,
		window,
		setTimeout,
		loadSecrets,
		showCenterToast,
	};
}

async function createServiceWorkerHarness(operations = []) {
	const pending = new Map(operations.map((operation) => [operation.id, globalThis.structuredClone(operation)]));
	const request = (action) => {
		const result = {};
		globalThis.queueMicrotask(() => {
			result.result = action();
			result.onsuccess();
		});
		return result;
	};
	const store = {
		index: () => ({ getAll: () => request(() => globalThis.structuredClone([...pending.values()])) }),
		get: (id) => request(() => globalThis.structuredClone(pending.get(id))),
		put: (operation) => request(() => pending.set(operation.id, globalThis.structuredClone(operation))),
		delete: (id) => request(() => pending.delete(id)),
	};
	const indexedDB = {
		open: () => request(() => ({ transaction: () => ({ objectStore: () => store }) })),
	};
	const listeners = new Map();
	const messages = [];
	const navigator = { onLine: true };
	const self = {
		navigator,
		addEventListener: (type, listener) => {
			const callbacks = listeners.get(type) || [];
			callbacks.push(listener);
			listeners.set(type, callbacks);
		},
		clients: { matchAll: async () => [{ postMessage: (message) => messages.push(message) }] },
	};
	const fetch = vi.fn().mockResolvedValue({ ok: true });
	const quietConsole = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'offline-behavior-test' }).text();
	// eslint-disable-next-line no-new-func
	const api = new Function('self', 'indexedDB', 'fetch', 'console', `${source}\nreturn { syncPendingOperations };`)(
		self,
		indexedDB,
		fetch,
		quietConsole,
	);
	const dispatch = (type, details) => {
		const promises = [];
		for (const listener of listeners.get(type) || []) {
			listener({ ...details, waitUntil: (promise) => promises.push(promise) });
		}
		return Promise.all(promises);
	};
	return { api, dispatch, fetch, messages, navigator, pending };
}

function queuedUpdate(id = 'offline-edit') {
	return {
		id,
		type: 'UPDATE_SECRET',
		method: 'PUT',
		url: `/api/secrets/${id}`,
		data: { name: 'Updated service' },
		timestamp: 1,
		status: 'pending',
		retryCount: 0,
	};
}

describe('generated Service Worker offline sync contract', () => {
	let source;

	beforeAll(async () => {
		source = await createServiceWorker({ SW_VERSION: 'hotp-contract-test' }).text();
	});

	it('does not queue HOTP counter reservations for unsafe offline replay', () => {
		expect(source).not.toContain("operationType = 'ADVANCE_HOTP';");
	});

	it('supports manual replay through the SYNC_OPERATIONS message', () => {
		const condition = "event.data.type === 'SYNC_OPERATIONS'";
		const conditionIndex = source.indexOf(condition);

		expect(conditionIndex).toBeGreaterThan(0);
		expect(source.slice(conditionIndex, conditionIndex + 180)).toContain('event.waitUntil(syncPendingOperations());');
	});

	it('shares one in-flight replay across background and manual triggers', () => {
		expect(source).toContain('let syncPendingOperationsPromise = null;');
		expect(source).toContain('if (syncPendingOperationsPromise) return syncPendingOperationsPromise;');
		expect(source).toContain('const operation = performPendingOperationSync();');
	});

	it('includes operation identity and type in success and terminal failure notifications', () => {
		const successPayloads = getNotifyPayloads(source, 'SYNC_SUCCESS');
		const failedPayloads = getNotifyPayloads(source, 'SYNC_FAILED');

		expect(successPayloads).toHaveLength(1);
		expect(failedPayloads).toHaveLength(2);
		for (const payload of [...successPayloads, ...failedPayloads]) {
			expect(payload).toContain('operationId: operation.id');
			expect(payload).toContain('operationType: operation.type');
		}
		expect(source.match(/if \(newRetryCount >= 5\)/g)).toHaveLength(2);
	});
});

describe('PWA offline replay fallback', () => {
	it('posts SYNC_OPERATIONS when Background Sync is unavailable', () => {
		const harness = createPWAHarness();

		harness.api.requestPendingOperationSync({});

		expect(harness.controller.postMessage).toHaveBeenCalledWith({ type: 'SYNC_OPERATIONS' });
	});

	it('does not replay on repeated offline loads or controller changes and resumes on online', async () => {
		const harness = createPWAHarness({ online: false });
		const load = harness.window.addEventListener.mock.calls.find(([type]) => type === 'load')[1];
		for (let attempt = 0; attempt < 6; attempt++) {
			await load();
			const controllerChange = harness.navigator.serviceWorker.addEventListener.mock.calls.find(([type]) => type === 'controllerchange')[1];
			controllerChange();
		}
		expect(harness.controller.postMessage).not.toHaveBeenCalled();

		harness.navigator.onLine = true;
		const online = harness.window.addEventListener.mock.calls.find(([type]) => type === 'online')[1];
		online();
		await Promise.resolve();
		expect(harness.controller.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SYNC_OPERATIONS' });
	});

	it('does not fall back to manual replay if the network drops during sync registration', async () => {
		const harness = createPWAHarness();
		let rejectRegistration;
		const registration = {
			sync: { register: vi.fn(() => new Promise((_, reject) => (rejectRegistration = reject))) },
		};
		harness.api.requestPendingOperationSync(registration);
		harness.navigator.onLine = false;
		rejectRegistration(new Error('Sync unavailable'));
		await Promise.resolve();
		expect(harness.controller.postMessage).not.toHaveBeenCalled();
	});

	it('retries deferred operations once without showing a permanent failure and rechecks connectivity', async () => {
		const harness = createPWAHarness();
		harness.api.handleServiceWorkerMessage({ type: 'SYNC_COMPLETE', successCount: 0, failCount: 0, deferredCount: 1 });
		expect(harness.setTimeout).toHaveBeenCalledTimes(1);
		expect(harness.showCenterToast).not.toHaveBeenCalled();
		harness.navigator.onLine = false;
		harness.setTimeout.mock.calls[0][0]();
		await Promise.resolve();
		expect(harness.controller.postMessage).not.toHaveBeenCalled();
	});
});

describe('generated Service Worker offline replay behavior', () => {
	it('leaves repeated offline triggers pending without using retries and succeeds after reconnecting', async () => {
		const operation = queuedUpdate();
		const harness = await createServiceWorkerHarness([operation]);
		harness.navigator.onLine = false;
		for (let attempt = 0; attempt < 6; attempt++) {
			await harness.dispatch('message', { data: { type: 'SYNC_OPERATIONS' } });
		}
		expect(harness.fetch).not.toHaveBeenCalled();
		expect(harness.pending.get(operation.id)).toEqual(operation);
		expect(harness.messages.at(-1)).toMatchObject({ type: 'SYNC_COMPLETE', deferredCount: 1, failCount: 0 });

		harness.navigator.onLine = true;
		await harness.dispatch('message', { data: { type: 'SYNC_OPERATIONS' } });
		expect(harness.fetch).toHaveBeenCalledTimes(1);
		expect(harness.pending.size).toBe(0);
		expect(harness.messages.at(-1)).toMatchObject({ successCount: 1, deferredCount: 0 });
	});

	it('keeps transport failures retryable even when navigator reports online', async () => {
		const operation = { ...queuedUpdate(), retryCount: 3 };
		const harness = await createServiceWorkerHarness([operation]);
		harness.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
		for (let attempt = 0; attempt < 6; attempt++) {
			await harness.api.syncPendingOperations();
		}
		expect(harness.fetch).toHaveBeenCalledTimes(6);
		expect(harness.pending.get(operation.id)).toEqual(operation);
		expect(harness.messages.some((message) => message.type === 'SYNC_FAILED')).toBe(false);

		harness.fetch.mockResolvedValue({ ok: true });
		await harness.api.syncPendingOperations();
		expect(harness.pending.size).toBe(0);
	});

	it.each(['reported offline', 'fetch rejection'])('stops the batch when a request is followed by %s', async (failure) => {
		const operations = [queuedUpdate('first'), queuedUpdate('second'), queuedUpdate('third')];
		const harness = await createServiceWorkerHarness(operations);
		harness.fetch.mockImplementationOnce(async () => {
			if (failure === 'reported offline') {
				harness.navigator.onLine = false;
			}
			return { ok: true };
		});
		if (failure === 'fetch rejection') {
			harness.fetch.mockRejectedValue(new TypeError('Connection lost'));
		}
		await harness.api.syncPendingOperations();
		expect(harness.fetch).toHaveBeenCalledTimes(failure === 'reported offline' ? 1 : 2);
		expect([...harness.pending.values()]).toEqual(operations.slice(1));
		expect(harness.messages.at(-1)).toMatchObject({ successCount: 1, failCount: 0, deferredCount: 2 });

		harness.navigator.onLine = true;
		harness.fetch.mockResolvedValue({ ok: true });
		await harness.api.syncPendingOperations();
		expect(harness.pending.size).toBe(0);
	});

	it('preserves terminal failure after five HTTP responses', async () => {
		const operation = queuedUpdate();
		const harness = await createServiceWorkerHarness([operation]);
		harness.fetch.mockResolvedValue({ ok: false, status: 409, statusText: 'Conflict' });
		for (let attempt = 0; attempt < 6; attempt++) {
			await harness.api.syncPendingOperations();
		}
		expect(harness.fetch).toHaveBeenCalledTimes(5);
		expect(harness.pending.get(operation.id)).toMatchObject({ status: 'failed', retryCount: 5 });
		expect(harness.messages.filter((message) => message.type === 'SYNC_FAILED')).toHaveLength(1);
	});

	it('shares a replay between concurrent manual and background triggers', async () => {
		const harness = await createServiceWorkerHarness([queuedUpdate()]);
		let finishFetch;
		harness.fetch.mockImplementation(() => new Promise((resolve) => (finishFetch = resolve)));
		const manual = harness.dispatch('message', { data: { type: 'SYNC_OPERATIONS' } });
		const background = harness.dispatch('sync', { tag: 'sync-operations' });
		await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1));
		finishFetch({ ok: true });
		await Promise.all([manual, background]);
		expect(harness.pending.size).toBe(0);
		expect(harness.messages.filter((message) => message.type === 'SYNC_SUCCESS')).toHaveLength(1);
	});

	it('rejects deferred background sync so the browser retries, then clears the shared replay', async () => {
		const operation = queuedUpdate();
		const harness = await createServiceWorkerHarness([operation]);
		harness.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(harness.dispatch('sync', { tag: 'sync-operations' })).rejects.toThrow('网络不可用');
		expect(harness.pending.get(operation.id)).toEqual(operation);
		harness.fetch.mockResolvedValue({ ok: true });
		await harness.dispatch('sync', { tag: 'sync-operations' });
		expect(harness.pending.size).toBe(0);
	});
});
