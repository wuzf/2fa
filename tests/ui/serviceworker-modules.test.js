import { describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';

async function requestModule({ fetchImpl, cached = null, put = vi.fn(async () => {}) }) {
	const listeners = new Map();
	const self = { location: { origin: 'https://2fa.example.com' }, addEventListener: (type, callback) => listeners.set(type, callback) };
	const caches = { match: vi.fn().mockResolvedValue(cached), open: vi.fn(async () => ({ put })) };
	const quietConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'module-test' }).text();
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', source)(self, self.location, fetchImpl, caches, quietConsole);

	let responsePromise;
	const lifetime = [];
	listeners.get('fetch')({
		request: new Request('https://2fa.example.com/modules/import.js'),
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
});
