import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sharedSearch from '../../src/shared/search-filter.js';
import { LIMITS } from '../../extension/src/shared/protocol.js';
import {
	BRIDGE_ERROR_CODES,
	BridgeError,
	generateTotpCode,
	generateTotpCodes,
	listTotpAccounts,
	loadOfflineSnapshot,
	serializeBridgeError,
} from '../../extension/src/bridge/api.js';

const INSTANCE_ORIGIN = 'https://twofa.example';
// The instance's own error body for a missing or expired login (createErrorResponse).
const SERVICE_AUTH_ERROR = { error: '身份验证失败', message: '请提供有效的访问令牌。', timestamp: '2026-01-01T00:00:00.000Z' };
// Behavioral cases use the configured source. Origin validation cases below call
// the public functions directly so this helper cannot hide a missing argument.
const source = {
	list: (options) => listTotpAccounts({ instanceOrigin: INSTANCE_ORIGIN, ...options }),
	generate: (options) => generateTotpCode({ instanceOrigin: INSTANCE_ORIGIN, ...options }),
};

function jsonResponse(data, { status = 200, contentType = 'application/json; charset=utf-8', redirected = false } = {}) {
	const response = new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': contentType },
	});
	if (redirected) {
		Object.defineProperty(response, 'redirected', { value: true });
	}
	return response;
}

function makeSecret(overrides = {}) {
	return {
		id: 'github-main',
		name: 'GitHub',
		account: 'user@example.com',
		secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
		type: 'TOTP',
		digits: 8,
		period: 30,
		algorithm: 'SHA1',
		...overrides,
	};
}

function metadataFor(secret = makeSecret()) {
	return {
		id: secret.id,
		name: secret.name,
		account: secret.account || '',
		type: 'TOTP',
		digits: secret.digits ?? 6,
	};
}

const onlineRequests = [
	['list', listTotpAccounts],
	['single code', (options) => generateTotpCode({ id: makeSecret().id, metadata: metadataFor(), ...options })],
	['code batch', (options) => generateTotpCodes({ accounts: [metadataFor()], ...options })],
	['snapshot synchronization', loadOfflineSnapshot],
];

afterEach(() => vi.unstubAllGlobals());

describe('background source API access', () => {
	it.each(onlineRequests)('requires an explicit origin for %s even when a webpage origin exists', async (_name, request) => {
		vi.stubGlobal('location', { origin: INSTANCE_ORIGIN });
		for (const address of [{}, { instanceOrigin: undefined }, { instanceOrigin: null }]) {
			const fetchImpl = vi.fn();
			await expect(request({ ...address, fetchImpl })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	});
	it('uses the saved HTTPS origin with browser-managed credentials from an extension worker', async () => {
		vi.stubGlobal('location', { origin: 'chrome-extension://extension-id' });
		vi.stubGlobal('chrome', { runtime: { id: 'extension-id' } });
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([makeSecret()]));
		const accounts = await listTotpAccounts({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl });

		expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(new URL(`${INSTANCE_ORIGIN}/api/secrets`), {
			credentials: 'include',
			cache: 'no-store',
			redirect: 'error',
			signal: expect.any(AbortSignal),
		});
		expect(accounts).toEqual([{ ...metadataFor(), searchFamily: '其他服务', searchFamilyKind: 'other' }]);
		expect(JSON.stringify(accounts)).not.toContain(makeSecret().secret);
		expect(chrome).not.toHaveProperty('cookies');
	});

	it('never places account IDs with reserved URL characters in an instance request path', async () => {
		const secret = makeSecret({ id: 'team/github?x=1#frag%2F..' });
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [secret]));
		await generateTotpCode({ instanceOrigin: INSTANCE_ORIGIN, id: secret.id, metadata: metadataFor(secret), fetchImpl, now: () => 1000 });
		await generateTotpCodes({ instanceOrigin: INSTANCE_ORIGIN, accounts: [metadataFor(secret)], fetchImpl, now: () => 1000 });
		const paths = fetchImpl.mock.calls.map(([url]) => `${url.pathname}${url.search}${url.hash}`);
		expect([...new Set(paths)].sort()).toEqual(['/api/secrets', '/api/time']);
	});

	it('generates current and next codes against only the configured endpoints without a source page', async () => {
		vi.stubGlobal('location', undefined);
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [makeSecret()]));
		const result = await generateTotpCode({
			instanceOrigin: `${INSTANCE_ORIGIN}:8443`,
			id: makeSecret().id,
			metadata: metadataFor(),
			includeNext: true,
			fetchImpl,
			now: () => 1000,
		});
		expect(result).toMatchObject({ code: '94287082', nextCode: '37359152', generatedAt: 1000, remainingMs: 30000 });
		expect(fetchImpl.mock.calls.map(([url]) => url.href)).toEqual([
			`${INSTANCE_ORIGIN}:8443/api/time`,
			`${INSTANCE_ORIGIN}:8443/api/secrets`,
		]);
		for (const [, options] of fetchImpl.mock.calls) {
			expect(options).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store' });
			expect(options).not.toHaveProperty('headers');
		}
		expect(JSON.stringify(result)).not.toContain(makeSecret().secret);
	});

	it.each([
		'http://untrusted.example',
		'https://user:password@twofa.example',
		'https://twofa.example/path',
		'chrome-extension://extension-id',
		'null',
		null,
	])('rejects an invalid explicit instance origin %j before fetching', async (instanceOrigin) => {
		const fetchImpl = vi.fn();
		for (const [, request] of onlineRequests) {
			await expect(request({ instanceOrigin, fetchImpl })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		}
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		[401, {}],
		[401, SERVICE_AUTH_ERROR],
		[403, SERVICE_AUTH_ERROR],
	])('reports status %i without retrying or opening a login page', async (status, body) => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body, { status }));
		await expect(listTotpAccounts({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it.each([
		[
			'a region block page',
			() => new Response('<!DOCTYPE html><title>Access denied</title>', { status: 403, headers: { 'content-type': 'text/html' } }),
		],
		[
			'a managed challenge',
			() =>
				new Response('<!DOCTYPE html><title>Just a moment...</title>', {
					status: 403,
					headers: { 'content-type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' },
				}),
		],
		[
			'a challenge marker on a JSON body',
			() =>
				new Response(JSON.stringify(SERVICE_AUTH_ERROR), {
					status: 403,
					headers: { 'content-type': 'application/json', 'cf-mitigated': 'challenge' },
				}),
		],
		[
			'JSON without the instance error fields',
			() => jsonResponse({ title: 'Error 1020: Access denied', status: 403 }, { status: 403, contentType: 'application/problem+json' }),
		],
		['an empty Access denial', () => new Response('', { status: 403 })],
		['an unreadable JSON body', () => new Response('{', { status: 403, headers: { 'content-type': 'application/json' } })],
	])('treats %s from a rule in front of the instance as unreachable, not as an expired login', async (_description, responseFactory) => {
		const fetchImpl = vi.fn();
		for (const [, request] of onlineRequests) {
			fetchImpl.mockClear().mockResolvedValue(responseFactory());
			await expect(request({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
			expect(fetchImpl).toHaveBeenCalledOnce();
		}
	});

	it('does not follow login or cross-origin redirects', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 302 }));
		await expect(listTotpAccounts({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
		expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('forwards cancellation to an in-flight request and does not issue another fetch', async () => {
		const controller = new AbortController();
		const fetchImpl = vi.fn(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
				}),
		);
		const pending = listTotpAccounts({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl, signal: controller.signal });
		const rejection = expect(pending).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		controller.abort();
		await rejection;
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
	});

	it('rejects an already cancelled task before fetching any seed', async () => {
		const fetchImpl = vi.fn();
		const signal = AbortSignal.abort();
		await expect(
			generateTotpCode({ instanceOrigin: INSTANCE_ORIGIN, fetchImpl, signal, id: makeSecret().id, metadata: metadataFor() }),
		).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('does not re-fetch a seed after cancellation during the rollover wait', async () => {
		const controller = new AbortController();
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 59000 } : [makeSecret()]));
		const generateImpl = vi.fn();
		await expect(
			generateTotpCode({
				instanceOrigin: INSTANCE_ORIGIN,
				fetchImpl,
				signal: controller.signal,
				id: makeSecret().id,
				metadata: metadataFor(),
				now: () => 1000,
				sleep: async () => controller.abort(),
				generateImpl,
			}),
		).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(generateImpl).not.toHaveBeenCalled();
	});

	it('drops a code completed after cancellation during cryptographic generation', async () => {
		const controller = new AbortController();
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [makeSecret()]));
		await expect(
			generateTotpCode({
				instanceOrigin: INSTANCE_ORIGIN,
				fetchImpl,
				signal: controller.signal,
				id: makeSecret().id,
				metadata: metadataFor(),
				now: () => 1000,
				generateImpl: async () => {
					controller.abort();
					return '12345678';
				},
			}),
		).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
	});
});

describe('bridge LIST', () => {
	it.each([0, 42, Number.MAX_SAFE_INTEGER])('lists and generates legacy numeric account ID %s using a canonical string ID', async (id) => {
		const record = makeSecret({ id });
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [record]));
		const accounts = await source.list({ fetchImpl });
		expect(accounts).toEqual([{ ...metadataFor(record), id: String(id), searchFamily: '其他服务', searchFamilyKind: 'other' }]);
		expect(JSON.stringify(accounts)).not.toContain(record.secret);
		const options = { fetchImpl, now: () => 1000, includeNext: true };
		await expect(source.generate({ ...options, id: accounts[0].id, metadata: accounts[0] })).resolves.toMatchObject({
			code: '94287082',
			nextCode: '37359152',
		});
		await expect(generateTotpCodes({ ...options, instanceOrigin: INSTANCE_ORIGIN, accounts })).resolves.toEqual([
			expect.objectContaining({ id: String(id), code: '94287082', nextCode: '37359152' }),
		]);
	});

	it('excludes both numeric and string records when their canonical IDs collide', async () => {
		const records = [makeSecret({ id: 42 }), makeSecret({ id: '42' }), makeSecret({ id: 'unrelated' })];
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : records));
		const result = await source.list({ fetchImpl, withDiagnostics: true });
		expect(result.accounts.map((account) => account.id)).toEqual(['unrelated']);
		expect(result.unavailableAccounts).toEqual([
			{ id: '42', name: 'GitHub', reason: 'duplicate' },
			{ id: '42', name: 'GitHub', reason: 'duplicate' },
		]);
		await expect(source.generate({ fetchImpl, id: '42', metadata: metadataFor(records[1]), now: () => 1000 })).rejects.toMatchObject({
			code: 'ACCOUNT_NOT_FOUND',
		});
	});

	it('does not coerce invalid legacy IDs into selectable accounts', async () => {
		const invalidIds = [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, true, {}, []];
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(invalidIds.map((id) => makeSecret({ id }))));
		const result = await source.list({ fetchImpl, withDiagnostics: true });
		expect(result.accounts).toEqual([]);
		expect(result.unavailableAccounts).toEqual(invalidIds.map(() => ({ id: null, name: 'GitHub', reason: 'invalid' })));
	});

	it('uses only the configured instance endpoint and returns whitelisted TOTP metadata', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse([
				makeSecret(),
				makeSecret({
					id: 'legacy',
					name: 'Legacy',
					account: undefined,
					type: undefined,
					digits: undefined,
					period: undefined,
					algorithm: undefined,
				}),
				makeSecret({ id: 'counter', type: 'HOTP' }),
			]),
		);

		const accounts = await source.list({ fetchImpl });

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, options] = fetchImpl.mock.calls[0];
		expect(url).toBeInstanceOf(URL);
		expect(url.href).toBe(`${INSTANCE_ORIGIN}/api/secrets`);
		expect(options).toEqual({ credentials: 'include', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
		expect(accounts).toEqual([
			{ id: 'github-main', name: 'GitHub', account: 'user@example.com', type: 'TOTP', digits: 8, searchFamily: 'GitHub' },
			{ id: 'legacy', name: 'Legacy', account: '', type: 'TOTP', digits: 6, searchFamily: '其他服务', searchFamilyKind: 'other' },
		]);
		expect(Object.keys(accounts[0])).toEqual(['id', 'name', 'account', 'type', 'digits', 'searchFamily']);
		expect(JSON.stringify(accounts)).not.toContain('GEZDGNB');
		expect(JSON.stringify(accounts)).not.toContain('algorithm');
		expect(JSON.stringify(accounts)).not.toContain('period');
	});

	it('uses the full vault for visible search groups without passing secrets into aggregation caches', async () => {
		const gmail = makeSecret({ id: 'gmail', name: 'Gmail' });
		const youtube = makeSecret({ id: 'youtube', name: 'YouTube', type: 'HOTP' });
		const familyNamesSpy = vi.spyOn(sharedSearch, 'getSearchFamilyNames');
		try {
			const accounts = await source.list({
				fetchImpl: vi.fn().mockResolvedValue(jsonResponse([gmail, youtube])),
			});

			expect(accounts).toEqual([{ ...metadataFor(gmail), searchFamily: 'Google' }]);
			expect(familyNamesSpy).toHaveBeenCalledTimes(1);
			const [groupedAccounts] = familyNamesSpy.mock.calls[0];
			expect(groupedAccounts).toEqual([metadataFor(gmail), { ...metadataFor(youtube), type: 'HOTP' }]);
			for (const account of groupedAccounts) {
				expect(Object.keys(account)).toEqual(['id', 'name', 'account', 'type', 'digits']);
			}
			expect(JSON.stringify({ groupedAccounts, accounts })).not.toContain(gmail.secret);
		} finally {
			familyNamesSpy.mockRestore();
		}
	});

	it('preserves the displayed service label for repeated names and uses the fallback group for singletons', async () => {
		const accounts = await source.list({
			fetchImpl: vi
				.fn()
				.mockResolvedValue(
					jsonResponse([
						makeSecret({ id: 'gmail-1', name: 'Gmail' }),
						makeSecret({ id: 'gmail-2', name: 'Gmail' }),
						makeSecret({ id: 'unknown', name: 'My service' }),
					]),
				),
		});

		expect(accounts.map(({ id, searchFamily }) => ({ id, searchFamily }))).toEqual([
			{ id: 'gmail-1', searchFamily: 'Gmail' },
			{ id: 'gmail-2', searchFamily: 'Gmail' },
			{ id: 'unknown', searchFamily: '其他服务' },
		]);
	});

	it.each([0, 45, undefined])('accepts an unused HOTP period %j while retaining full-vault search groups', async (period) => {
		const gmail = makeSecret({ id: 'gmail', name: 'Gmail' });
		const youtube = makeSecret({ id: 'youtube', name: 'YouTube', type: 'HOTP', period, counter: 7 });
		const familyNamesSpy = vi.spyOn(sharedSearch, 'getSearchFamilyNames');
		try {
			const accounts = await source.list({ fetchImpl: vi.fn().mockResolvedValue(jsonResponse([gmail, youtube])) });
			expect(accounts).toEqual([{ ...metadataFor(gmail), searchFamily: 'Google' }]);
			const [publicRecords] = familyNamesSpy.mock.calls[0];
			expect(publicRecords).toEqual([metadataFor(gmail), { ...metadataFor(youtube), type: 'HOTP' }]);
			expect(JSON.stringify({ publicRecords, accounts })).not.toContain(gmail.secret);
		} finally {
			familyNamesSpy.mockRestore();
		}
	});

	it.each([
		['invalid counter', { counter: -1 }],
		['unsafe counter', { counter: Number.MAX_SAFE_INTEGER + 1 }],
		['non-integer counter', { counter: 0.5 }],
		['string counter', { counter: '7' }],
		['invalid digits', { digits: 7 }],
		['unsupported algorithm', { algorithm: 'MD5' }],
		['invalid seed', { secret: 'not-base32' }],
	])('isolates a HOTP record with %s', async (_description, overrides) => {
		await expect(
			source.list({
				fetchImpl: vi
					.fn()
					.mockResolvedValue(jsonResponse([makeSecret(), makeSecret({ id: 'hotp', type: 'HOTP', period: 0, counter: 0, ...overrides })])),
			}),
		).resolves.toEqual([{ ...metadataFor(), searchFamily: '其他服务', searchFamilyKind: 'other' }]);
	});

	it.each([
		['authentication status', () => jsonResponse({}, { status: 401 }), BRIDGE_ERROR_CODES.AUTH_REQUIRED],
		['redirected response', () => jsonResponse([], { redirected: true }), BRIDGE_ERROR_CODES.AUTH_REQUIRED],
		['HTML response', () => jsonResponse([], { contentType: 'text/html' }), BRIDGE_ERROR_CODES.INVALID_RESPONSE],
		['non-array body', () => jsonResponse({ secrets: [] }), BRIDGE_ERROR_CODES.INVALID_RESPONSE],
		[
			'item count above limit',
			() => jsonResponse(Array.from({ length: LIMITS.MAX_ACCOUNTS + 1 }, (_, index) => makeSecret({ id: `id-${index}` }))),
			BRIDGE_ERROR_CODES.INVALID_RESPONSE,
		],
	])('rejects %s with a stable error code', async (_description, responseFactory, code) => {
		await expect(source.list({ fetchImpl: vi.fn().mockResolvedValue(responseFactory()) })).rejects.toMatchObject({
			name: 'BridgeError',
			code,
		});
	});

	it('maps network failures to SOURCE_OFFLINE without exposing the original message', async () => {
		let error;
		try {
			await source.list({ fetchImpl: vi.fn().mockRejectedValue(new Error('secret network diagnostic')) });
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(BridgeError);
		expect(error.code).toBe(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
		expect(error.message).not.toContain('secret network diagnostic');
	});
});

describe('bridge GENERATE', () => {
	it('generates a selected TOTP in a mixed vault containing a valid HOTP with period zero', async () => {
		const selected = makeSecret();
		const hotp = makeSecret({ id: 'hotp', name: 'HOTP account', type: 'HOTP', period: 0, counter: 7 });
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [selected, hotp]));
		const result = await source.generate({
			instanceOrigin: INSTANCE_ORIGIN,
			id: selected.id,
			metadata: metadataFor(selected),
			includeNext: true,
			fetchImpl,
			now: () => 1000,
		});
		expect(result).toMatchObject({ code: '94287082', nextCode: '37359152', digits: 8, period: 30, remainingMs: 30000 });
		expect(JSON.stringify(result)).not.toContain(selected.secret);
	});

	it('continues to reject a HOTP account as a TOTP generation target even with period zero', async () => {
		const hotp = makeSecret({ type: 'HOTP', period: 0, counter: 7 });
		const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 30000 } : [hotp]));
		await expect(source.generate({ id: hotp.id, metadata: metadataFor(hotp), fetchImpl, now: () => 1000 })).rejects.toMatchObject({
			code: 'ACCOUNT_CHANGED',
		});
	});

	it('times out a stalled network request without revealing fetch diagnostics', async () => {
		vi.useFakeTimers();
		try {
			const fetchImpl = vi.fn(() => new Promise(() => {}));
			const pending = source.list({ fetchImpl });
			const assertion = expect(pending).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
			await vi.advanceTimersByTimeAsync(8000);
			await assertion;
			expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('calibrates with milliseconds, re-fetches the selected account and returns one current code', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 30 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]));

		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => 1000,
			sleep: vi.fn(),
		});

		expect(result).toEqual({ code: '94287082', digits: 8, period: 30, validUntil: 60 * 1000, generatedAt: 1000, remainingMs: 30000 });
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets']);
		for (const [, options] of fetchImpl.mock.calls) {
			expect(options).toEqual({ credentials: 'include', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
		}
	});

	it('returns the current and next counter codes only when requested', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 30 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]));
		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			includeNext: true,
			fetchImpl,
			now: () => 1000,
		});

		expect(result).toEqual({
			code: '94287082',
			nextCode: '37359152',
			digits: 8,
			period: 30,
			validUntil: 60000,
			generatedAt: 1000,
			remainingMs: 30000,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(result)).not.toContain(selected.secret);
	});

	it.each([60, 120])('generates the next code at the account-specific %i-second boundary', async (period) => {
		const selected = makeSecret({ period });
		const fetchImpl = vi.fn(async (url) =>
			url.pathname === '/api/time' ? jsonResponse({ serverTimeMs: 86000 }) : jsonResponse([selected]),
		);
		const generateImpl = vi.fn().mockResolvedValueOnce('11111111').mockResolvedValueOnce('22222222');
		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			includeNext: true,
			fetchImpl,
			now: () => 0,
			generateImpl,
		});

		expect(generateImpl.mock.calls.map(([, time]) => time)).toEqual([86000, 120000]);
		expect(result).toMatchObject({ code: '11111111', nextCode: '22222222', period, validUntil: 120000, remainingMs: 34000 });
	});

	it.each([5500, 7000])('discards both preview codes when generation spends %i ms entering an unsafe window', async (elapsed) => {
		const selected = makeSecret();
		const fetchImpl = vi.fn(async (url) =>
			url.pathname === '/api/time' ? jsonResponse({ serverTimeMs: 54000 }) : jsonResponse([selected]),
		);
		const generateImpl = vi
			.fn()
			.mockResolvedValueOnce('11111111')
			.mockResolvedValueOnce('22222222')
			.mockResolvedValueOnce('33333333')
			.mockResolvedValueOnce('44444444');
		const clockValues = [0, 0, 0, elapsed, Math.max(elapsed, 6000), Math.max(elapsed, 6000)];
		const sleep = vi.fn();
		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			includeNext: true,
			fetchImpl,
			now: () => clockValues.shift() ?? Math.max(elapsed, 6000),
			sleep,
			generateImpl,
		});

		expect(generateImpl).toHaveBeenCalledTimes(4);
		expect(generateImpl.mock.calls.map(([, time]) => time)).toEqual([54000, 60000, Math.max(60000, 54000 + elapsed), 90000]);
		expect(result).toMatchObject({ code: '33333333', nextCode: '44444444', validUntil: 90000 });
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets', '/api/secrets']);
		if (elapsed === 5500) {
			expect(sleep).toHaveBeenCalledWith(500);
		} else {
			expect(sleep).not.toHaveBeenCalled();
		}
	});

	it.each([null, 1, 'true', {}])('rejects a non-boolean future-code request (%j) before fetching secrets', async (includeNext) => {
		const selected = makeSecret();
		const fetchImpl = vi.fn();
		await expect(source.generate({ id: selected.id, metadata: metadataFor(selected), includeNext, fetchImpl })).rejects.toMatchObject({
			code: 'INVALID_REQUEST',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each(['1234567', '1234567x', 12345678, undefined])('rejects a malformed next code (%j)', async (nextCode) => {
		const selected = makeSecret();
		const fetchImpl = vi.fn(async (url) =>
			url.pathname === '/api/time' ? jsonResponse({ serverTimeMs: 30000 }) : jsonResponse([selected]),
		);
		const generateImpl = vi.fn().mockResolvedValueOnce('94287082').mockResolvedValueOnce(nextCode);
		await expect(
			source.generate({ id: selected.id, metadata: metadataFor(selected), includeNext: true, fetchImpl, now: () => 0, generateImpl }),
		).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
	});

	it('LIST and GENERATE use separate secret fetches and ignore stale display group metadata', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse([selected]))
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 30 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]));

		await source.list({ fetchImpl });
		await source.generate({
			id: selected.id,
			metadata: { ...metadataFor(selected), searchFamily: 'Old display group' },
			fetchImpl,
			now: () => 0,
			sleep: vi.fn(),
		});

		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/secrets', '/api/time', '/api/secrets']);
	});

	it('releases an unsafe read, waits for the boundary and fetches the secret again', async () => {
		const selected = makeSecret();
		const events = [];
		let clientTime = 0;
		const fetchImpl = vi.fn(async (url) => {
			events.push(`fetch:${url.pathname}`);
			return url.pathname === '/api/time' ? jsonResponse({ serverTimeMs: 56 * 1000 }) : jsonResponse([selected]);
		});
		const sleep = vi.fn(async (delayMs) => {
			events.push(`sleep:${delayMs}`);
			clientTime += delayMs;
		});

		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => clientTime,
			sleep,
		});

		expect(sleep).toHaveBeenCalledWith(4000);
		expect(events).toEqual(['fetch:/api/time', 'fetch:/api/secrets', 'sleep:4000', 'fetch:/api/secrets']);
		expect(result.validUntil).toBe(90 * 1000);
		expect(result.generatedAt).toBe(4000);
		expect(result.remainingMs).toBe(30000);
	});

	it('rechecks the safety window after time spent fetching secrets', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 55 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]))
			.mockResolvedValueOnce(jsonResponse([selected]));
		const sleep = vi.fn();
		const clockValues = [0, 0, 1000, 5000];

		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => clockValues.shift() ?? 5000,
			sleep,
		});

		expect(sleep).toHaveBeenCalledWith(4000);
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets', '/api/secrets']);
		expect(result.validUntil).toBe(90 * 1000);
	});

	it.each([
		[60, 86 * 1000],
		[120, 86 * 1000],
	])('does not wait at a 30-second boundary that is safe for a %i-second account', async (period, serverTimeMs) => {
		const selected = makeSecret({ period });
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs }))
			.mockResolvedValueOnce(jsonResponse([selected]));
		const sleep = vi.fn();

		await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => 0,
			sleep,
		});

		expect(sleep).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('discards a code that enters the unsafe window during WebCrypto', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 54 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]))
			.mockResolvedValueOnce(jsonResponse([selected]));
		const sleep = vi.fn();
		const generateImpl = vi.fn().mockResolvedValue('12345678');
		const clockValues = [0, 0, 0, 2000, 6000, 6000];

		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => clockValues.shift() ?? 6000,
			sleep,
			generateImpl,
		});

		expect(generateImpl).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(4000);
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets', '/api/secrets']);
		expect(result).toEqual({ code: '12345678', digits: 8, period: 30, validUntil: 90 * 1000, generatedAt: 6000, remainingMs: 30000 });
	});

	it('discards a code when WebCrypto finishes in the next counter window', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 54 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]))
			.mockResolvedValueOnce(jsonResponse([selected]));
		const sleep = vi.fn();
		const generateImpl = vi.fn().mockResolvedValue('12345678');
		const clockValues = [0, 0, 0, 7000, 7000, 7000];

		const result = await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			fetchImpl,
			now: () => clockValues.shift() ?? 7000,
			sleep,
			generateImpl,
		});

		expect(generateImpl).toHaveBeenCalledTimes(2);
		expect(sleep).not.toHaveBeenCalled();
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets', '/api/secrets']);
		expect(result).toEqual({ code: '12345678', digits: 8, period: 30, validUntil: 90 * 1000, generatedAt: 7000, remainingMs: 29000 });
	});

	it.each([
		['missing account', [], BRIDGE_ERROR_CODES.ACCOUNT_NOT_FOUND],
		['changed metadata', [makeSecret({ name: 'GitHub Enterprise' })], BRIDGE_ERROR_CODES.ACCOUNT_CHANGED],
		['changed type', [makeSecret({ type: 'HOTP' })], BRIDGE_ERROR_CODES.ACCOUNT_CHANGED],
	])('rejects a %s after the fresh read', async (_description, secrets, code) => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 30 * 1000 }))
			.mockResolvedValueOnce(jsonResponse(secrets));

		await expect(
			source.generate({
				id: selected.id,
				metadata: metadataFor(selected),
				fetchImpl,
				now: () => 0,
				sleep: vi.fn(),
			}),
		).rejects.toMatchObject({ code });
	});

	it('rejects mismatched requested metadata before any network access', async () => {
		const selected = makeSecret();
		const fetchImpl = vi.fn();
		await expect(
			source.generate({
				id: selected.id,
				metadata: { ...metadataFor(selected), id: 'another-id' },
				fetchImpl,
			}),
		).rejects.toMatchObject({ code: BRIDGE_ERROR_CODES.INVALID_REQUEST });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('ignores arbitrary URL-like input and never calls refresh-token', async () => {
		const selected = makeSecret();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ serverTimeMs: 30 * 1000 }))
			.mockResolvedValueOnce(jsonResponse([selected]));

		await source.generate({
			id: selected.id,
			metadata: metadataFor(selected),
			url: '/api/refresh-token',
			fetchImpl,
			now: () => 0,
			sleep: vi.fn(),
		});

		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/time', '/api/secrets']);
	});
});

describe('public API error responses', () => {
	it('serializes unknown errors to a stable non-sensitive response', () => {
		expect(serializeBridgeError(new Error('secret=GEZDGNBV'))).toEqual({
			code: BRIDGE_ERROR_CODES.INTERNAL_ERROR,
			message: '验证码生成失败，请重试',
			messageKey: 'error_INTERNAL_ERROR',
		});
	});
});

it('shares exactly one time request and one vault request for a four-account batch', async () => {
	const records = Array.from({ length: 4 }, (_, index) => makeSecret({ id: `batch-${index}` }));
	const fetchImpl = vi.fn(async (url) => jsonResponse(new URL(url).pathname === '/api/time' ? { serverTimeMs: 30000 } : records));
	const results = await generateTotpCodes({
		accounts: records.map(metadataFor),
		instanceOrigin: INSTANCE_ORIGIN,
		fetchImpl,
		now: () => 1000,
		includeNext: true,
	});
	expect(fetchImpl).toHaveBeenCalledTimes(2);
	expect(results.map((result) => result.id)).toEqual(records.map((record) => record.id));
	expect(results.every((result) => result.code === '94287082' && result.nextCode === '37359152')).toBe(true);
	expect(JSON.stringify(results)).not.toContain(records[0].secret);
});

it('isolates an account removed during batch selection from other requested accounts', async () => {
	const account = makeSecret();
	const fetchImpl = vi.fn(async (url) => jsonResponse(new URL(url).pathname === '/api/time' ? { serverTimeMs: 30000 } : [account]));
	const results = await generateTotpCodes({
		accounts: [metadataFor(account), metadataFor(makeSecret({ id: 'removed' }))],
		instanceOrigin: INSTANCE_ORIGIN,
		fetchImpl,
		now: () => 1000,
	});
	expect(results[0].code).toBe('94287082');
	expect(results[1].error.code).toBe('ACCOUNT_NOT_FOUND');
});

it('reports incompatible records without leaking seeds and excludes every duplicate ID', async () => {
	const records = [
		makeSecret({ id: 'healthy' }),
		makeSecret({ id: 'legacy', period: 45 }),
		makeSecret({ id: 'dupe' }),
		makeSecret({ id: 'dupe', secret: 'JBSWY3DPEHPK3PXP' }),
		null,
	];
	const fetchImpl = vi.fn(async (url) => jsonResponse(new URL(url).pathname === '/api/time' ? { serverTimeMs: 30000 } : records));
	const result = await source.list({ fetchImpl, withDiagnostics: true });
	expect(result.accounts.map((account) => account.id)).toEqual(['healthy']);
	expect(result.unavailableAccounts).toHaveLength(4);
	expect(result.unavailableAccounts.filter((account) => account.reason === 'duplicate')).toHaveLength(2);
	expect(JSON.stringify(result)).not.toContain(records[0].secret);
	await expect(source.generate({ id: 'healthy', metadata: metadataFor(records[0]), fetchImpl, now: () => 1000 })).resolves.toMatchObject({
		code: '94287082',
	});
	await expect(source.generate({ id: 'dupe', metadata: metadataFor(records[2]), fetchImpl, now: () => 1000 })).rejects.toMatchObject({
		code: 'ACCOUNT_NOT_FOUND',
	});
});

it('allows a preview pair with four seconds left while keeping fill safety unchanged', async () => {
	const selected = makeSecret();
	const fetchImpl = vi.fn(async (url) => jsonResponse(url.pathname === '/api/time' ? { serverTimeMs: 56000 } : [selected]));
	const sleep = vi.fn();
	const result = await source.generate({
		id: selected.id,
		metadata: metadataFor(selected),
		includeNext: true,
		fetchImpl,
		now: () => 0,
		sleep,
	});
	expect(result.remainingMs).toBe(4000);
	expect(sleep).not.toHaveBeenCalled();
});
