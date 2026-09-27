import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import {
	collectServiceDomains,
	sanitizeServiceIcons,
	fetchServiceIcons,
	readWebServiceIcons,
} from '../../extension/src/shared/service-icons.js';

const ORIGIN = 'https://twofa.example';
const PNG = 'data:image/png;base64,AQID';
const ACCOUNTS = [{ name: 'GitHub' }, { name: 'github' }, { name: 'Google', account: 'private@example.com', secret: 'SECRET' }];

function response(size = 3, type = 'image/png') {
	return new Response(size === 3 ? new Uint8Array([1, 2, 3]) : new Uint8Array(size), {
		headers: { 'content-type': type },
	});
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => response()),
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('bounded offline service icons', () => {
	it('uses the shared service resolver, removes duplicates and limits domains', () => {
		expect(collectServiceDomains([...ACCOUNTS, { name: 'alice@example.com' }, { name: '../private' }, null])).toEqual([
			'github.com',
			'google.com',
		]);
		expect(collectServiceDomains(null)).toEqual([]);
		expect(collectServiceDomains(Object.keys(SERVICE_LOGOS).map((name) => ({ name })))).toHaveLength(128);
	});

	it('accepts canonical image data only and ignores malformed or oversized entries', () => {
		const good = { 'github.com': PNG, 'google.com': 'data:image/svg+xml;base64,PHN2Zy8+' };
		expect(
			sanitizeServiceIcons({
				...good,
				'bad.example': 'data:image/png;base64,AR==',
				'missing-padding.example': 'data:image/png;base64,AQI',
				'empty.example': 'data:image/png;base64,',
				'html.example': 'data:text/html;base64,AQID',
				'remote.example': 'https://remote.example/icon.png',
				'large.example': `data:image/png;base64,${btoa('x'.repeat(32769))}`,
				'../../private': PNG,
				'-invalid.example': PNG,
				'UPPER.example': PNG,
				'nil.example': null,
			}),
		).toEqual(good);
		expect(sanitizeServiceIcons(good, ['google.com'])).toEqual({ 'google.com': good['google.com'] });
		expect(sanitizeServiceIcons(null)).toEqual({});
		expect(sanitizeServiceIcons([])).toEqual({});
	});

	it('caps stored icon count and the total encoded size', () => {
		const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`icon${index}.example`, PNG]));
		expect(Object.keys(sanitizeServiceIcons(many))).toHaveLength(128);
		const large = `data:image/png;base64,${btoa('x'.repeat(32768))}`;
		const entries = Object.fromEntries(Object.keys(many).map((domain) => [domain, large]));
		const sanitized = sanitizeServiceIcons(entries);
		expect(Object.keys(sanitized)).toHaveLength(23);
		expect(Object.values(sanitized).reduce((sum, icon) => sum + icon.length, 0)).toBeLessThanOrEqual(1024 * 1024);
	});

	it('requests only unique service domains from the configured instance without credentials', async () => {
		expect(await fetchServiceIcons(ORIGIN, ACCOUNTS)).toEqual({ 'github.com': PNG, 'google.com': PNG });
		expect(fetch).toHaveBeenCalledTimes(2);
		for (const [url, options] of fetch.mock.calls) {
			expect([`${ORIGIN}/api/favicon/github.com`, `${ORIGIN}/api/favicon/google.com`]).toContain(url);
			expect(options).toEqual({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal),
			});
		}
	});

	it('keeps valid cached icons on network failure and never refetches them', async () => {
		fetch.mockRejectedValue(new Error('offline'));
		expect(await fetchServiceIcons(ORIGIN, ACCOUNTS, { cached: { 'github.com': PNG, 'unrelated.example': PNG } })).toEqual({
			'github.com': PNG,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/favicon/google.com`);
	});

	it.each(['https://twofa.example/private', 'https://user:password@twofa.example', 'http://remote.example', 'invalid'])(
		'does not fetch for invalid or noncanonical origin %s',
		async (origin) => {
			expect(await fetchServiceIcons(origin, ACCOUNTS, { cached: { 'github.com': PNG } })).toEqual({ 'github.com': PNG });
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it('rejects HTML, unsuccessful, redirected, empty and explicitly oversized responses', async () => {
		const redirected = response();
		Object.defineProperty(redirected, 'redirected', { value: true });
		const oversized = response();
		oversized.headers.set('content-length', '32769');
		for (const item of [response(3, 'text/html'), new Response('no', { status: 404 }), redirected, response(0), oversized]) {
			fetch.mockResolvedValueOnce(item);
			expect(await fetchServiceIcons(ORIGIN, [{ name: 'GitHub' }])).toEqual({});
		}
	});

	it('stops reading an oversized stream even without content-length', async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(20000));
				controller.enqueue(new Uint8Array(20000));
			},
			cancel,
		});
		fetch.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'image/png' } }));
		expect(await fetchServiceIcons(ORIGIN, [{ name: 'GitHub' }])).toEqual({});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('limits concurrency to four and applies a single eighteen-second budget to stalled requests', async () => {
		vi.useFakeTimers();
		fetch.mockImplementation(() => new Promise(() => {}));
		const accounts = Object.keys(SERVICE_LOGOS).map((name) => ({ name }));
		const pending = fetchServiceIcons(ORIGIN, accounts);
		expect(fetch).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(18000);
		expect(await pending).toEqual({});
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
	});

	it('allows the API to finish a six-second fallback after a five-second primary timeout', async () => {
		vi.useFakeTimers();
		fetch.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(response()), 6000)));
		const pending = fetchServiceIcons(ORIGIN, [{ name: 'GitHub' }]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({ 'github.com': PNG });
	});

	it('uses a caller remaining budget and clamps it to zero through eighteen seconds', async () => {
		vi.useFakeTimers();
		fetch.mockImplementation(() => new Promise(() => {}));
		for (const [timeoutMs, elapsed] of [
			[700, 700],
			[60000, 18000],
		]) {
			const pending = fetchServiceIcons(ORIGIN, [{ name: 'GitHub' }], { timeoutMs });
			await vi.advanceTimersByTimeAsync(elapsed);
			expect(await pending).toEqual({});
		}
		fetch.mockClear();
		for (const timeoutMs of [0, -1]) {
			expect(await fetchServiceIcons(ORIGIN, ACCOUNTS, { timeoutMs, cached: { 'github.com': PNG } })).toEqual({
				'github.com': PNG,
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('continues with unstarted domains on the next sync and retains the valid cache filter', async () => {
		vi.useFakeTimers();
		const origin = 'https://resume.example';
		const accounts = Object.keys(SERVICE_LOGOS).map((name) => ({ name }));
		const domains = collectServiceDomains(accounts);
		fetch.mockImplementation(() => new Promise(() => {}));
		const first = fetchServiceIcons(origin, accounts, { timeoutMs: 100 });
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(domains.slice(0, 4).map((domain) => `${origin}/api/favicon/${domain}`));
		await vi.advanceTimersByTimeAsync(100);
		await first;
		fetch.mockClear();
		const second = fetchServiceIcons(origin, accounts, { timeoutMs: 100, cached: { [domains[0]]: PNG, [domains[4]]: PNG } });
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(domains.slice(5, 9).map((domain) => `${origin}/api/favicon/${domain}`));
		await vi.advanceTimersByTimeAsync(100);
		expect(await second).toEqual({ [domains[0]]: PNG, [domains[4]]: PNG });
		fetch.mockClear();
		const switched = fetchServiceIcons('https://switched.example', accounts, { timeoutMs: 100 });
		expect(fetch.mock.calls[0][0]).toBe(`https://switched.example/api/favicon/${domains[0]}`);
		await vi.advanceTimersByTimeAsync(100);
		await switched;
	});

	it('honors cancellation during a stalled stream and retains already cached images', async () => {
		const cancel = vi.fn();
		fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'image/png' } }));
		const controller = new AbortController();
		const pending = fetchServiceIcons(ORIGIN, ACCOUNTS, { cached: { 'github.com': PNG }, signal: controller.signal });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		controller.abort();
		expect(await pending).toEqual({ 'github.com': PNG });
		expect(cancel).toHaveBeenCalledOnce();
		fetch.mockClear();
		expect(await fetchServiceIcons(ORIGIN, ACCOUNTS, { signal: controller.signal })).toEqual({});
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('website cache import', () => {
	function injectedReader(overrides = {}) {
		const match = vi.fn(async () => response());
		const scope = {
			URL,
			location: { origin: ORIGIN },
			caches: { match },
			AbortController,
			setTimeout,
			clearTimeout,
			btoa,
			fetch,
			...overrides,
		};
		// Executing the serialized function in a fresh context verifies the scripting API contract.
		const read = runInNewContext(`(${readWebServiceIcons.toString()})`, scope);
		return { read, match: scope.caches.match };
	}

	it('imports only matching same-origin cache entries with no network fallback', async () => {
		const { read, match } = injectedReader();
		match.mockImplementation(async (url) => (url.endsWith('github.com') ? response() : undefined));
		expect(await read(ORIGIN, ['github.com', 'github.com', 'google.com', '../private'])).toEqual({ 'github.com': PNG });
		expect(match.mock.calls).toEqual([[`${ORIGIN}/api/favicon/github.com`], [`${ORIGIN}/api/favicon/google.com`]]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses to read a different website origin', async () => {
		const { read, match } = injectedReader({ location: { origin: 'https://another.example' } });
		expect(await read(ORIGIN, ['github.com'])).toEqual({});
		expect(match).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('skips corrupt, oversized, cross-origin and unavailable cache responses', async () => {
		const { read, match } = injectedReader();
		const crossOrigin = response();
		Object.defineProperty(crossOrigin, 'url', { value: 'https://another.example/api/favicon/github.com' });
		for (const item of [response(32769), response(3, 'text/html'), crossOrigin]) {
			match.mockResolvedValueOnce(item);
			expect(await read(ORIGIN, ['github.com'])).toEqual({});
		}
		match.mockRejectedValueOnce(new Error('Cache Storage unavailable'));
		expect(await read(ORIGIN, ['github.com'])).toEqual({});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('bounds a stalled cache lookup and never attempts a fetch', async () => {
		vi.useFakeTimers();
		const { read, match } = injectedReader();
		match.mockImplementation(() => new Promise(() => {}));
		const pending = read(ORIGIN, ['github.com']);
		await vi.advanceTimersByTimeAsync(3000);
		expect(await pending).toEqual({});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('applies the total size and domain limits when reading website caches', async () => {
		const { read, match } = injectedReader();
		match.mockImplementation(async () => response(32768));
		const icons = await read(
			ORIGIN,
			Array.from({ length: 150 }, (_, index) => `icon${index}.example`),
		);
		expect(Object.keys(icons)).toHaveLength(23);
		expect(match).toHaveBeenCalledTimes(128);
		expect(Object.values(icons).reduce((sum, icon) => sum + icon.length, 0)).toBeLessThanOrEqual(1024 * 1024);
	});
});
