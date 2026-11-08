import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

const origin = 'https://vault.test';
// These cases cover the network-first path a reload takes; fresh launches are covered separately.
function navigation(path = '/', options = {}) {
	const request = new Request(origin + path, { cache: 'no-cache', ...options });
	// Node forbids constructing browser-created navigation Requests. Preserve
	// its native URL/headers/policy and expose only the browser event metadata.
	Object.defineProperties(request, { mode: { value: 'navigate' }, destination: { value: 'document' } });
	return request;
}
async function harness({ fetch = vi.fn(async () => new Response('complete app')), cached = null, legacy = false, pin } = {}) {
	vi.stubGlobal('__2FA_BUILD_ID__', 'a'.repeat(64));
	const listeners = new Map();
	const posted = [];
	const self = {
		location: { origin },
		addEventListener: (type, listener) => listeners.set(type, listener),
		clients: { get: vi.fn(async (id) => ({ id, postMessage: (message) => posted.push([id, message]) })) },
	};
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
	// A page message, from this app's window unless another source is given.
	function message(data, source = { type: 'window', id: 'old-client', url: origin + '/' }) {
		const replies = [];
		listeners.get('message')({ data, source, ports: [{ postMessage: (reply) => replies.push(reply) }], waitUntil() {} });
		return replies;
	}
	return { start, message, fetch, runtime, snapshots, caches, put, pinBodies, posted };
}
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('emitted homepage navigation Request boundary', () => {
	it.each([200, 401, 403])('finishes network %i while the independent cache lookup is still pending', async (status) => {
		vi.useFakeTimers();
		let release;
		const denied = new Response(status === 200 ? 'online shell' : new ReadableStream(), { status });
		const h = await harness({ fetch: vi.fn(async () => denied) });
		h.runtime.matchNavigation.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(0);
		expect(h.fetch).toHaveBeenCalledOnce();
		const response = await operation.response;
		expect(response.status).toBe(status);
		if (status === 200) {
			expect(await response.text()).toBe('online shell');
			expect(h.runtime.pinNavigation).toHaveBeenCalledOnce();
		} else {
			expect(response).toBe(denied);
			expect(response.bodyUsed).toBe(false);
			expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
		}
		let backgroundFinished = false;
		void Promise.all(operation.lifetime).then(() => {
			backgroundFinished = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(backgroundFinished).toBe(false);
		release(new Response('late cached shell'));
		await Promise.all(operation.lifetime);
		await vi.advanceTimersByTimeAsync(9000);
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		expect(h.runtime.matchNavigation).toHaveBeenCalledTimes(1);
	});
	it.each([400, 1700])('keeps the original short deadline when the cached candidate arrives at %i ms', async (arrival) => {
		vi.useFakeTimers();
		let release;
		const h = await harness({ fetch: vi.fn(async () => new Promise(() => {})) });
		h.runtime.matchNavigation.mockImplementation(async (_request, clientId) =>
			clientId
				? new Response('bound fallback')
				: new Promise((resolve) => {
						release = resolve;
					}),
		);
		let finished = false;
		const operation = h.start(navigation());
		void operation.response.then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(arrival);
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(finished).toBe(false);
		release(new Response('candidate'));
		if (arrival < 1500) {
			await vi.advanceTimersByTimeAsync(1499 - arrival);
			expect(finished).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
		} else {
			await vi.advanceTimersByTimeAsync(0);
		}
		expect(await (await operation.response).text()).toBe('bound fallback');
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.runtime.matchNavigation).toHaveBeenLastCalledWith(expect.any(Request), 'new-client');
	});
	it.each(['missing', 'error'])('does not shorten the long deadline for a %s cache candidate', async (outcome) => {
		vi.useFakeTimers();
		let finishLookup;
		const h = await harness({ fetch: vi.fn(async () => new Promise(() => {})) });
		h.runtime.matchNavigation.mockImplementation((_request, clientId) =>
			clientId
				? Promise.resolve(null)
				: new Promise((resolve, reject) => {
						finishLookup = () => (outcome === 'error' ? reject(new Error('cache unavailable')) : resolve(null));
					}),
		);
		let finished = false;
		const operation = h.start(navigation());
		void operation.response.then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		finishLookup();
		await vi.advanceTimersByTimeAsync(7499);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect((await operation.response).status).toBe(503);
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
	});
	it('does not reinstall a deadline when the speculative lookup settles after fallback', async () => {
		vi.useFakeTimers();
		let release;
		const h = await harness({ fetch: vi.fn(async () => new Promise(() => {})) });
		h.runtime.matchNavigation.mockImplementation(async (_request, clientId) =>
			clientId
				? new Response('fallback')
				: new Promise((resolve) => {
						release = resolve;
					}),
		);
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(8000);
		expect(await (await operation.response).text()).toBe('fallback');
		release(new Response('late candidate'));
		await Promise.all(operation.lifetime);
		expect(vi.getTimerCount()).toBe(0);
		expect(h.runtime.matchNavigation).toHaveBeenCalledTimes(2);
	});
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

describe('fresh launch from the stored page', () => {
	const build = 'a'.repeat(64);
	const shell = (body, config = 'config-1', hostBuild = build) =>
		new Response(body, { headers: { 'X-2FA-Build': hostBuild, 'X-2FA-Shell-Config': config } });
	const launch = () => navigation('/', { cache: 'default' });

	it('opens the stored page without waiting for the server and stays quiet when it is current', async () => {
		let answer;
		const fetch = vi.fn(
			() =>
				new Promise((resolve) => {
					answer = resolve;
				}),
		);
		const h = await harness({ fetch, cached: shell('stored') });
		const operation = h.start(launch());
		const response = await operation.response;
		expect(await response.text()).toBe('stored');
		expect(h.runtime.matchNavigation).toHaveBeenCalledWith(expect.anything(), 'new-client');
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.fetch.mock.calls[0][0].cache).toBe('no-store');
		answer(shell('server'));
		await Promise.all(operation.lifetime);
		expect(h.posted).toEqual([]);
		expect(h.runtime.pinNavigation).not.toHaveBeenCalled();
	});

	it.each([
		['appearance or custom code', () => shell('newer', 'config-2')],
		['version', () => shell('newer', 'config-1', 'b'.repeat(64))],
		['login', () => new Response('denied', { status: 401 })],
		['setup', () => new Response('not found', { status: 404 })],
	])('asks the page to reload when the server has a different page (%s)', async (_, server) => {
		const h = await harness({ fetch: vi.fn(async () => server()), cached: shell('stored') });
		const operation = h.start(launch());
		expect(await (await operation.response).text()).toBe('stored');
		await Promise.all(operation.lifetime);
		expect(h.posted).toEqual([['new-client', { type: 'SHELL_STALE' }]]);
	});

	it('serves the newer page it found to a launch right after, without another check', async () => {
		const h = await harness({ fetch: vi.fn(async () => shell('newer', 'config-2')), cached: shell('stored') });
		const first = h.start(launch());
		await first.response;
		await Promise.all(first.lifetime);
		const second = h.start(launch());
		expect(await (await second.response).text()).toBe('newer');
		expect(h.runtime.pinNavigation).toHaveBeenCalledOnce();
		expect(await h.pinBodies[0].text()).toBe('newer');
		expect(h.fetch).toHaveBeenCalledOnce();
	});

	it.each([
		['an outage', () => Promise.resolve(new Response('down', { status: 503 }))],
		['no network', () => Promise.reject(new TypeError('offline'))],
	])('keeps the stored page quietly during %s', async (_, server) => {
		const h = await harness({ fetch: vi.fn(server), cached: shell('stored') });
		const operation = h.start(launch());
		expect(await (await operation.response).text()).toBe('stored');
		await Promise.all(operation.lifetime);
		expect(h.posted).toEqual([]);
	});

	it('goes to the network first for a stored page without its identity', async () => {
		const h = await harness({ cached: new Response('legacy stored') });
		const operation = h.start(launch());
		expect(await (await operation.response).text()).toBe('complete app');
		await Promise.all(operation.lifetime);
		expect(h.posted).toEqual([]);
	});

	it.each(['no-cache', 'reload'])('goes to the network first for a reload (%s)', async (cache) => {
		const h = await harness({ cached: shell('stored') });
		const operation = h.start(navigation('/', { cache }));
		expect(await (await operation.response).text()).toBe('complete app');
		expect(h.runtime.pinNavigation).toHaveBeenCalledOnce();
	});

	it('goes to the network first for a page with a query', async () => {
		const h = await harness({ cached: shell('stored') });
		const operation = h.start(navigation('/?safeMode=1', { cache: 'default' }));
		expect(await (await operation.response).text()).toBe('complete app');
	});
});

describe('reload for another saved appearance', () => {
	const build = 'a'.repeat(64);
	const shell = (body) => new Response(body, { headers: { 'X-2FA-Build': build, 'X-2FA-Shell-Config': 'config-1' } });
	const slowServer = (afterMs) => vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(new Response('new theme')), afterMs)));

	it('waits for the server instead of serving the stored page after the short deadline', async () => {
		vi.useFakeTimers();
		const h = await harness({ fetch: slowServer(4000), cached: shell('old theme') });
		expect(h.message({ type: 'EXPECT_FRESH_SHELL' })).toEqual([{ ok: true }]);
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(4000);
		expect(await (await operation.response).text()).toBe('new theme');
	});

	it('does not open the stored page first for a launch-style navigation', async () => {
		vi.useFakeTimers();
		const h = await harness({ fetch: slowServer(2000), cached: shell('old theme') });
		h.message({ type: 'EXPECT_FRESH_SHELL' });
		const operation = h.start(navigation('/', { cache: 'default' }));
		await vi.advanceTimersByTimeAsync(2000);
		expect(await (await operation.response).text()).toBe('new theme');
	});

	it('still falls back when the server never answers', async () => {
		vi.useFakeTimers();
		const h = await harness({ fetch: vi.fn(() => new Promise(() => {})), cached: shell('old theme') });
		h.message({ type: 'EXPECT_FRESH_SHELL' });
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(8000);
		expect(await (await operation.response).text()).toBe('old theme');
	});

	it('applies to one navigation only and expires', async () => {
		vi.useFakeTimers();
		const h = await harness({ fetch: slowServer(4000), cached: shell('old theme') });
		h.runtime.matchNavigation.mockImplementation(async () => shell('old theme'));
		h.message({ type: 'EXPECT_FRESH_SHELL' });
		await vi.advanceTimersByTimeAsync(0);
		const first = h.start(navigation());
		await vi.advanceTimersByTimeAsync(4000);
		expect(await (await first.response).text()).toBe('new theme');
		const second = h.start(navigation());
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await second.response).text()).toBe('old theme');
		h.message({ type: 'EXPECT_FRESH_SHELL' });
		await vi.advanceTimersByTimeAsync(30000);
		const late = h.start(navigation());
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await late.response).text()).toBe('old theme');
	});

	it('ignores the request from anything but an app window', async () => {
		vi.useFakeTimers();
		const h = await harness({ fetch: slowServer(4000), cached: shell('old theme') });
		h.message({ type: 'EXPECT_FRESH_SHELL' }, { type: 'worker', id: 'w', url: origin + '/' });
		const operation = h.start(navigation());
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await operation.response).text()).toBe('old theme');
	});
});
