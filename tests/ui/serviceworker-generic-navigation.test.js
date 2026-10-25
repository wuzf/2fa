import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

const origin = 'https://vault.test';
function browserNavigation(path, options = {}) {
	const request = new Request(origin + path, {
		redirect: 'manual',
		headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN' },
		credentials: 'include',
		cache: 'reload',
		referrer: origin + '/?from=account',
		referrerPolicy: 'strict-origin-when-cross-origin',
		...options,
	});
	// Only browsers can construct navigate/document metadata; Node still owns
	// the genuine request URL, policy, headers, credentials and body behavior.
	Object.defineProperties(request, { mode: { value: 'navigate' }, destination: { value: 'document' } });
	return request;
}
async function harness(fetch) {
	vi.stubGlobal('__2FA_BUILD_ID__', '');
	const listeners = new Map();
	const self = { location: { origin }, addEventListener: (type, listener) => listeners.set(type, listener) };
	const caches = { match: vi.fn(), open: vi.fn() };
	const source = await createServiceWorker().text();
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', source)(self, self.location, fetch, caches, {
		log() {},
		error() {},
		warn() {},
	});
	async function run(request) {
		let result;
		listeners.get('fetch')({
			request,
			respondWith: (value) => {
				result = value;
			},
			waitUntil() {},
		});
		return result;
	}
	return { run, caches };
}
afterEach(() => vi.unstubAllGlobals());

describe('emitted generic navigation redirect policy', () => {
	it.each(['/setup', '/setup?safeMode=1', '/setup?disableCustomCode=1&lang=zh-CN'])(
		'passes the exact manual navigation and opaque redirect through for %s',
		async (path) => {
			const original = browserNavigation(path);
			const before = {
				url: original.url,
				headers: [...original.headers],
				credentials: original.credentials,
				referrer: original.referrer,
				referrerPolicy: original.referrerPolicy,
				redirect: original.redirect,
				mode: original.mode,
				cache: original.cache,
			};
			const redirect = new Response(null);
			// Model the browser's filtered response. No Location/body is exposed to
			// the handler; the actual redirect sequence belongs to the browser.
			Object.defineProperties(redirect, { type: { value: 'opaqueredirect' }, status: { value: 0 } });
			const read = vi.spyOn(redirect, 'arrayBuffer');
			const clone = vi.spyOn(redirect, 'clone');
			const fetch = vi.fn(async () => redirect);
			const h = await harness(fetch);
			expect(await h.run(original)).toBe(redirect);
			expect(fetch).toHaveBeenCalledExactlyOnceWith(original);
			expect({
				url: original.url,
				headers: [...original.headers],
				credentials: original.credentials,
				referrer: original.referrer,
				referrerPolicy: original.referrerPolicy,
				redirect: original.redirect,
				mode: original.mode,
				cache: original.cache,
			}).toEqual(before);
			expect(read).not.toHaveBeenCalled();
			expect(clone).not.toHaveBeenCalled();
			expect(h.caches.match).not.toHaveBeenCalled();
			expect(h.caches.open).not.toHaveBeenCalled();
		},
	);
	it('avoids returning a followed response to a manual navigation, at the modeled respondWith boundary', async () => {
		const original = browserNavigation('/setup?safeMode=1');
		const opaque = new Response(null);
		Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
		const followed = new Response('safe root HTML');
		Object.defineProperty(followed, 'redirected', { value: true });
		const fetch = vi.fn(async (_request, init) => (init?.redirect === 'follow' ? followed : opaque));
		const h = await harness(fetch);
		const response = await h.run(original);
		// Node does not implement FetchEvent.respondWith validation. Assert the
		// two policy constraints directly, alongside real Chrome evidence from root.
		expect(response.redirected && original.redirect !== 'follow').toBe(false);
		expect(response.type === 'opaqueredirect' && original.redirect !== 'manual').toBe(false);
		expect(response).toBe(opaque);
	});
	it.each([200, 401, 403, 503])('passes a direct %i response through without buffering or substitution', async (status) => {
		const response = new Response(new ReadableStream(), { status });
		const fetch = vi.fn(async () => response);
		const h = await harness(fetch);
		expect(await h.run(browserNavigation('/setup?safeMode=1'))).toBe(response);
		expect(response.bodyUsed).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it.each([
		['ordinary generic GET', () => new Request(origin + '/setup')],
		['generic POST navigation', () => browserNavigation('/setup', { method: 'POST', body: 'synthetic' })],
		[
			'cross-origin navigation metadata',
			() => {
				const request = new Request('https://external.invalid/setup', { redirect: 'manual' });
				Object.defineProperty(request, 'mode', { value: 'navigate' });
				return request;
			},
		],
	])('retains existing follow behavior for %s', async (_label, makeRequest) => {
		const request = makeRequest();
		const response = new Response('unchanged response');
		const fetch = vi.fn(async () => response);
		const h = await harness(fetch);
		expect(await h.run(request)).toBe(response);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(request, { redirect: 'follow' });
		if (request.method === 'POST') {
			expect(await request.text()).toBe('synthetic');
		}
	});
	it('does not move API writes into the generic redirect branch', async () => {
		const request = new Request(origin + '/api/secrets', { method: 'PUT', body: '{"synthetic":true}' });
		const fetch = vi.fn(async () => new Response('{}'));
		const h = await harness(fetch);
		expect((await h.run(request)).status).toBe(200);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(request);
		expect(await request.text()).toBe('{"synthetic":true}');
	});
	it('keeps the existing plain 503 on network rejection without retrying or caching', async () => {
		const request = browserNavigation('/setup?disableCustomCode=1');
		const fetch = vi.fn(async () => {
			throw new TypeError('network unavailable');
		});
		const h = await harness(fetch);
		const response = await h.run(request);
		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
		expect(fetch).toHaveBeenCalledExactlyOnceWith(request);
		expect(h.caches.open).not.toHaveBeenCalled();
	});
});
