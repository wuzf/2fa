import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';

async function navigationHarness(cachedResponse, fetchImpl, { cacheUnavailable = false, openCache = null } = {}) {
	const listeners = new Map();
	const self = { location: { origin: 'https://2fa.example.com' }, addEventListener: (type, callback) => listeners.set(type, callback) };
	const fetch = fetchImpl || vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
	const put = vi.fn(async () => {});
	const caches = { match: vi.fn().mockResolvedValue(cachedResponse), open: vi.fn(async () => ({ put })) };
	if (openCache) {
		caches.open.mockImplementation(async () => {
			await openCache;
			return { put };
		});
	}
	if (cacheUnavailable) {
		caches.match.mockRejectedValue(new Error('Storage unavailable'));
		caches.open.mockRejectedValue(new Error('Storage unavailable'));
	}
	const quietConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'offline-page-test' }).text();
	// Execute the emitted worker so malformed escaping in embedded HTML also fails this test.
	// eslint-disable-next-line no-new-func
	new Function('self', 'fetch', 'caches', 'console', source)(self, fetch, caches, quietConsole);

	let responsePromise;
	let background;
	listeners.get('fetch')({
		request: new Request('https://2fa.example.com/'),
		respondWith: (response) => {
			responsePromise = response;
		},
		waitUntil: (operation) => {
			background = operation;
		},
	});
	return { responsePromise, background, fetch, put };
}

async function navigateOffline(cachedResponse) {
	return (await navigationHarness(cachedResponse)).responsePromise;
}

afterEach(() => vi.useRealTimers());

describe('Service Worker offline navigation', () => {
	it.each([401, 403])('preserves authorization denial %s even with a never-ending body', async (status) => {
		vi.useFakeTimers();
		const denied = new Response(new ReadableStream(), { status });
		const h = await navigationHarness(
			new Response('Cached app'),
			vi.fn(async () => denied),
		);
		expect(await h.responsePromise).toBe(denied);
		expect(h.put).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('serves a complete network page when cache storage is unavailable', async () => {
		const h = await navigationHarness(
			null,
			vi.fn(async () => new Response('New app')),
			{ cacheUnavailable: true },
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		await h.background;
	});

	it('retains a cacheable copy when the page consumes HTML before cache storage opens', async () => {
		let finishOpen;
		const openCache = new Promise((resolve) => {
			finishOpen = resolve;
		});
		const h = await navigationHarness(
			null,
			vi.fn(async () => new Response('New app')),
			{ openCache },
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		finishOpen();
		await h.background;
		expect(await h.put.mock.calls[0][1].text()).toBe('New app');
	});

	it('uses the cached shell during a server outage without caching the error response', async () => {
		const cached = new Response('Cached app');
		const h = await navigationHarness(
			cached,
			vi.fn(async () => new Response('Unavailable', { status: 503 })),
		);
		expect(await h.responsePromise).toBe(cached);
		expect(h.put).not.toHaveBeenCalled();
	});
	it('returns a complete offline document with a retry link when the page is not cached', async () => {
		const response = await navigateOffline();
		const html = await response.text();

		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain('name="viewport"');
		expect(html).toContain('href="/" data-standalone-i18n="offlineReload">Reload</a>');
		const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
		expect(scripts).toHaveLength(2);
		for (const script of scripts) {
			// eslint-disable-next-line no-new-func
			expect(() => new Function(script[1])).not.toThrow();
		}
	});

	it('serves the cached app before falling back to the offline document', async () => {
		const cachedResponse = new Response('<!DOCTYPE html><title>Cached app</title>');
		const response = await navigateOffline(cachedResponse);

		expect(response).toBe(cachedResponse);
		expect(response.status).toBe(200);
	});

	it.each(['headers', 'body'])('falls back to cached HTML within 1.5 seconds when %s never arrives', async (phase) => {
		vi.useFakeTimers();
		const cached = new Response('Cached app');
		const fetch = vi.fn(() => (phase === 'headers' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream()))));
		const h = await navigationHarness(cached, fetch);
		await vi.advanceTimersByTimeAsync(1500);
		expect(await h.responsePromise).toBe(cached);
		expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.put).not.toHaveBeenCalled();
	});

	it('returns the offline document within 8 seconds without a cached shell', async () => {
		vi.useFakeTimers();
		const h = await navigationHarness(
			null,
			vi.fn(() => new Promise(() => {})),
		);
		await vi.advanceTimersByTimeAsync(8000);
		expect((await h.responsePromise).status).toBe(503);
	});

	it('never replaces the cached shell with a timed-out body that finishes later', async () => {
		vi.useFakeTimers();
		let stream;
		const response = new Response(
			new ReadableStream({
				start(controller) {
					stream = controller;
				},
			}),
		);
		const h = await navigationHarness(
			new Response('Cached app'),
			vi.fn(async () => response),
		);
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await h.responsePromise).text()).toBe('Cached app');
		stream.enqueue(new TextEncoder().encode('Late app'));
		stream.close();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.put).not.toHaveBeenCalled();
	});

	it('returns and caches a complete successful network document and clears the deadline', async () => {
		vi.useFakeTimers();
		const h = await navigationHarness(
			new Response('Old app'),
			vi.fn(async () => new Response('New app', { headers: { 'Content-Type': 'text/html' } })),
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		await h.background;
		expect(await h.put.mock.calls[0][1].text()).toBe('New app');
		expect(vi.getTimerCount()).toBe(0);
	});
});
