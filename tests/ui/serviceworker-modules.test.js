import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';

afterEach(() => vi.unstubAllGlobals());

async function requestModule({ fetchImpl, cached = null, put = vi.fn(async () => {}), currentBuild = '', requestedBuild = null }) {
	vi.stubGlobal('__2FA_BUILD_ID__', currentBuild);
	vi.stubGlobal('indexedDB', {});
	const listeners = new Map();
	const self = { location: { origin: 'https://2fa.example.com' }, addEventListener: (type, callback) => listeners.set(type, callback) };
	const caches = { match: vi.fn().mockResolvedValue(cached), open: vi.fn(async () => ({ put, match: async () => cached })), keys: vi.fn(async () => []) };
	const quietConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'module-test' }).text();
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', source)(self, self.location, fetchImpl, caches, quietConsole);

	let responsePromise;
	const lifetime = [];
	listeners.get('fetch')({
		request: new Request('https://2fa.example.com/modules/import.js' + (requestedBuild ? '?build=' + requestedBuild : '')),
		respondWith: (response) => {
			responsePromise = response;
		},
		waitUntil: (promise) => lifetime.push(promise),
	});
	const response = await responsePromise;
	return { response, caches, put, lifetime };
}

describe('Service Worker lazy modules', () => {
	it('keeps a copy of a module loaded online in the runtime cache of this version', async () => {
		const { response, caches, put, lifetime } = await requestModule({ fetchImpl: vi.fn(async () => new Response('module code')) });
		await Promise.all(lifetime);
		expect(await response.text()).toBe('module code');
		expect(caches.open).toHaveBeenCalledWith('2fa-runtime-module-test');
		expect(put).toHaveBeenCalledOnce();
		expect(await put.mock.calls[0][1].text()).toBe('module code');
	});

	it('keeps the worker alive until the copy is written', async () => {
		let finishWrite;
		const put = vi.fn(() => new Promise((resolve) => (finishWrite = resolve)));
		const { response, lifetime } = await requestModule({ fetchImpl: vi.fn(async () => new Response('module code')), put });
		expect(await response.text()).toBe('module code');
		expect(lifetime).toHaveLength(1);

		let settled = false;
		const kept = lifetime[0].then(() => (settled = true));
		await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The page already has the module, but the worker must stay until the write ends.
		expect(settled).toBe(false);
		finishWrite();
		await kept;
		expect(settled).toBe(true);
	});

	it('serves the kept copy offline', async () => {
		const cached = new Response('cached module code');
		const { response } = await requestModule({
			fetchImpl: vi.fn().mockRejectedValue(new TypeError('Network unavailable')),
			cached,
		});
		expect(response).toBe(cached);
	});

	it('does not keep an error response', async () => {
		const { response, put } = await requestModule({ fetchImpl: vi.fn(async () => new Response('Unauthorized', { status: 401 })) });
		expect(response.status).toBe(401);
		expect(put).not.toHaveBeenCalled();
	});

	it('answers 503 offline when the module was never loaded', async () => {
		const { response } = await requestModule({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('Network unavailable')) });
		expect(response.status).toBe(503);
	});
	it('stores by the requested build even when the controlling worker is newer', async () => {
		const requestedBuild = 'a'.repeat(64);
		const h = await requestModule({ currentBuild: 'b'.repeat(64), requestedBuild,
			fetchImpl: async () => new Response('old module', { headers: { 'X-2FA-Build': requestedBuild } }),
		});
		await Promise.all(h.lifetime);
		expect(h.caches.open).toHaveBeenCalledWith('2fa-modules-' + requestedBuild);
		expect(await h.response.text()).toBe('old module');
	});
	it('uses an old matching cached module after deployment instead of executing the new build', async () => {
		const h = await requestModule({ currentBuild: 'b'.repeat(64), requestedBuild: 'a'.repeat(64),
			cached: new Response('cached old module'), fetchImpl: async () => new Response('refresh', { status: 409 }),
		});
		expect(await h.response.text()).toBe('cached old module');
		expect(h.put).not.toHaveBeenCalled();
	});
	it('requires a refresh if no matching module exists after deployment', async () => {
		const h = await requestModule({ currentBuild: 'b'.repeat(64), requestedBuild: 'a'.repeat(64),
			fetchImpl: async () => new Response('wrong new module', { headers: { 'X-2FA-Build': 'b'.repeat(64) } }),
		});
		expect(h.response.status).toBe(409);
		expect(h.put).not.toHaveBeenCalled();
	});
	it('never masks online authorization denial with an old module', async () => {
		const h = await requestModule({ currentBuild: 'b'.repeat(64), requestedBuild: 'a'.repeat(64),
			cached: new Response('old module'), fetchImpl: async () => new Response('login', { status: 401 }),
		});
		expect(h.response.status).toBe(401);
	});
	it('does not execute a successful unidentified module in a legacy page controlled by the new worker', async () => {
		const h = await requestModule({ currentBuild: 'b'.repeat(64), fetchImpl: async () => new Response('new module') });
		expect(h.response.status).toBe(409);
		expect(h.put).not.toHaveBeenCalled();
	});
});
