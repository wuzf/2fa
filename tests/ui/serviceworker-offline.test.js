import { describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';

async function navigateOffline(cachedResponse) {
	const listeners = new Map();
	const self = { addEventListener: (type, callback) => listeners.set(type, callback) };
	const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
	const caches = { match: vi.fn().mockResolvedValue(cachedResponse) };
	const quietConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'offline-page-test' }).text();
	// Execute the emitted worker so malformed escaping in embedded HTML also fails this test.
	// eslint-disable-next-line no-new-func
	new Function('self', 'fetch', 'caches', 'console', source)(self, fetch, caches, quietConsole);

	let responsePromise;
	listeners.get('fetch')({
		request: new Request('https://2fa.example.com/'),
		respondWith: (response) => {
			responsePromise = response;
		},
	});
	return responsePromise;
}

describe('Service Worker offline navigation', () => {
	it('returns a complete offline document with a retry link when the page is not cached', async () => {
		const response = await navigateOffline();
		const html = await response.text();

		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain('name="viewport"');
		expect(html).toContain('href="/">重新加载</a>');
		const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
		expect(scripts).toHaveLength(1);
		// eslint-disable-next-line no-new-func
		expect(() => new Function(scripts[0][1])).not.toThrow();
	});

	it('serves the cached app before falling back to the offline document', async () => {
		const cachedResponse = new Response('<!DOCTYPE html><title>Cached app</title>');
		const response = await navigateOffline(cachedResponse);

		expect(response).toBe(cachedResponse);
		expect(response.status).toBe(200);
	});
});
