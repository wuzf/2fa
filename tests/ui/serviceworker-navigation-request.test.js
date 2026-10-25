import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

const origin = 'https://vault.test';
function navigation(path = '/', options = {}) {
	const request = new Request(origin + path, options);
	// Node forbids constructing browser-created navigation Requests. Preserve
	// its native URL/headers/policy and expose only the browser event metadata.
	Object.defineProperties(request, { mode: { value: 'navigate' }, destination: { value: 'document' } });
	return request;
}
async function harness({ fetch = vi.fn(async () => new Response('complete app')), cached = null, legacy = false, pin } = {}) {
	vi.stubGlobal('__2FA_BUILD_ID__', 'a'.repeat(64));
	const listeners = new Map();
	const self = { location: { origin }, addEventListener: (type, listener) => listeners.set(type, listener) };
	const pinBodies = [];
	const runtime = {
		matchNavigation: vi.fn(async () => cached),
		pinNavigation: vi.fn(async (...args) => {
			pinBodies.push(args[2].clone());
			return pin?.(...args);
		}),
	};
	const snapshots = { match: vi.fn(async () => cached) };
	const put = vi.fn(async () => {});
	const caches = { match: vi.fn(async () => cached), open: vi.fn(async () => ({ put })) };
	const source = (await createServiceWorker().text())
		.replace(/const snapshotManager = [\s\S]*?\nconst runtimeProtocol =/, 'const snapshotManager = testSnapshots;\nconst runtimeProtocol =')
		.replace(/const runtimeSnapshots = [\s\S]*?\nconst QR_VENDORS/, 'const runtimeSnapshots = testRuntime;\nconst QR_VENDORS');
	// Only storage/runtime dependencies are explicit ports; execute the actual
	// emitted fetch listener, its request construction, complete body and timer.
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', 'testRuntime', 'testSnapshots', source)(
		self,
		self.location,
		fetch,
		caches,
		{ log() {}, warn() {}, error() {} },
		legacy ? null : runtime,
		legacy ? null : snapshots,
	);
	function start(request) {
		let response;
		const lifetime = [];
		listeners.get('fetch')({
			request,
			clientId: 'old-client',
			resultingClientId: 'new-client',
			respondWith: (value) => {
				response = value;
			},
			waitUntil: (value) => lifetime.push(value),
		});
		return { response, lifetime };
	}
	return { start, fetch, runtime, snapshots, caches, put, pinBodies };
}
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('emitted homepage navigation Request boundary', () => {
	it.each(['/', '/?safeMode=1&lang=zh-CN', '/?disableCustomCode=1&language=de&test-navigation=1'])(
		'normalizes only the network request while keeping the exact navigation URL and pin identity: %s',
		async (path) => {
			const h = await harness();
			const original = navigation(path, {
				headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN' },
				credentials: 'include',
				cache: 'reload',
				referrer: origin + '/otp',
				referrerPolicy: 'strict-origin-when-cross-origin',
			});
			expect(await (await h.start(original).response).text()).toBe('complete app');
			const [outbound, init] = h.fetch.mock.calls[0];
			expect(outbound).not.toBe(original);
			expect(outbound).toBeInstanceOf(Request);
			expect(outbound.url).toBe(original.url);
			expect(outbound.mode).toBe('same-origin');
			expect(outbound.destination).toBe('');
			for (const key of ['method', 'credentials', 'cache', 'referrer', 'referrerPolicy']) {
				expect(outbound[key]).toBe(original[key]);
			}
			expect([...outbound.headers]).toEqual([...original.headers]);
			expect(outbound.redirect).toBe('follow');
			expect(init.redirect).toBe('follow');
			expect(init.signal.aborted).toBe(false);
			expect(h.runtime.matchNavigation).toHaveBeenCalledWith(original);
			expect(h.runtime.pinNavigation).toHaveBeenCalledWith(
				original,
				'new-client',
				expect.any(Response),
				expect.objectContaining({ isCurrent: expect.any(Function) }),
			);
			expect(await h.pinBodies[0].text()).toBe('complete app');
		},
	);
	it('keeps the original navigation as the legacy cache key, including its query', async () => {
		const h = await harness({ legacy: true });
		const original = navigation('/?disableCustomCode=1&lang=fr');
		const operation = h.start(original);
		await operation.response;
		await Promise.all(operation.lifetime);
		expect(h.caches.match).toHaveBeenCalledWith(original);
		expect(h.put.mock.calls[0][0]).toBe(original);
		expect(await h.put.mock.calls[0][1].text()).toBe('complete app');
	});
	it.each([
		['ordinary root fetch', () => new Request(origin + '/')],
		['non-home navigation', () => navigation('/setup')],
		['root POST', () => new Request(origin + '/', { method: 'POST', body: 'synthetic' })],
		['account API write', () => new Request(origin + '/api/secrets', { method: 'PUT', body: '{"synthetic":true}' })],
		['external resource', () => new Request('https://external.invalid/')],
	])('does not normalize or retry %s', async (_label, input) => {
		const h = await harness();
		const original = input();
		await h.start(original).response;
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(h.fetch.mock.calls[0][0]).toBe(original);
		if (original.method !== 'GET') {
			expect(await original.text()).toMatch(/synthetic/);
		}
		if (new URL(original.url).pathname !== '/' || original.method !== 'GET' || new URL(original.url).origin !== origin) {
			expect(h.runtime.matchNavigation).not.toHaveBeenCalled();
			expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
		}
	});
	it('allows a followed same-origin setup response and buffers its complete HTML', async () => {
		const fetch = vi.fn(async (request, init) => {
			expect(request.mode).toBe('same-origin');
			expect(init.redirect).toBe('follow');
			const response = new Response('<!doctype html><title>Setup</title>');
			Object.defineProperties(response, { url: { value: origin + '/setup' }, redirected: { value: true } });
			return response;
		});
		const h = await harness({ fetch });
		expect(await (await h.start(navigation()).response).text()).toBe('<!doctype html><title>Setup</title>');
		expect(fetch).toHaveBeenCalledOnce();
	});
	it('retains same-origin redirect policy and never retries a rejected external redirect with cors/no-cors', async () => {
		// Browser Fetch enforces this policy. The port models its rejection;
		// actual cookie/referrer/redirect behavior is covered by root's Chrome run.
		const fetch = vi.fn(async (request) => {
			expect(request.mode).toBe('same-origin');
			expect(request.credentials).toBe('include');
			throw new TypeError('Cross-origin redirect blocked by same-origin mode');
		});
		const cached = new Response('verified prior shell');
		const h = await harness({ fetch, cached });
		expect(await h.start(navigation('/', { credentials: 'include' })).response).toBe(cached);
		expect(fetch).toHaveBeenCalledOnce();
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
	});
	it.each([401, 403])('returns explicit %i without consuming a hanging denial body or using a cached shell', async (status) => {
		vi.useFakeTimers();
		const denied = new Response(new ReadableStream(), { status });
		const h = await harness({ cached: new Response('old shell'), fetch: vi.fn(async () => denied) });
		expect(await h.start(navigation()).response).toBe(denied);
		expect(denied.bodyUsed).toBe(false);
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each(['5xx', 'network'])('falls back on %s with no replacement publication', async (failure) => {
		const fetch = vi.fn(async () => {
			if (failure === 'network') {
				throw new TypeError('offline');
			}
			return new Response('unavailable', { status: 503 });
		});
		const cached = new Response('prior complete shell');
		const h = await harness({ fetch, cached });
		const original = navigation();
		expect(await h.start(original).response).toBe(cached);
		expect(h.runtime.matchNavigation).toHaveBeenLastCalledWith(original, 'new-client');
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
	});
	it.each([
		[false, 'headers'],
		[true, 'headers'],
		[false, 'body'],
		[true, 'body'],
	])('keeps the exact deadline and aborts the normalized request (cached=%s, phase=%s)', async (cached, phase) => {
		vi.useFakeTimers();
		const h = await harness({
			cached: cached ? new Response('cached') : null,
			fetch: vi.fn(async () => (phase === 'headers' ? new Promise(() => {}) : new Response(new ReadableStream()))),
		});
		let complete = false;
		const operation = h.start(navigation());
		void operation.response.then(() => {
			complete = true;
		});
		await vi.advanceTimersByTimeAsync((cached ? 1500 : 8000) - 1);
		expect(complete).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect((await operation.response).status).toBe(cached ? 200 : 503);
		expect(h.fetch.mock.calls[0][0].signal.aborted).toBe(true);
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
	});
	it('does not publish a partial or late body after the offline response has already been selected', async () => {
		vi.useFakeTimers();
		let stream;
		const body = new ReadableStream({
			start(controller) {
				stream = controller;
				controller.enqueue(new TextEncoder().encode('partial'));
			},
		});
		const h = await harness({ cached: new Response('cached'), fetch: vi.fn(async () => new Response(body)) });
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await operation.response).text()).toBe('cached');
		stream.enqueue(new TextEncoder().encode(' late remainder'));
		stream.close();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
	});
	it('invalidates a slow pin before a fallback pin wins, preventing its late completion from replacing it', async () => {
		vi.useFakeTimers();
		let release;
		let pinState = 'previous';
		const h = await harness({
			cached: new Response('cached'),
			pin: (_request, _client, _response, guard) =>
				new Promise((resolve) => {
					release = () => {
						if (guard.isCurrent()) {
							pinState = 'late-network';
						}
						resolve();
					};
				}),
		});
		h.runtime.matchNavigation.mockImplementation(async (_request, clientId) => {
			if (clientId) {
				pinState = 'fallback';
			}
			return new Response('cached');
		});
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await operation.response).text()).toBe('cached');
		expect(h.runtime.pinNavigation.mock.calls[0][3].isCurrent()).toBe(false);
		release();
		await vi.advanceTimersByTimeAsync(1);
		expect(pinState).toBe('fallback');
	});
});
