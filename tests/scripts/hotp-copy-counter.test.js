import { describe, expect, it, vi } from 'vitest';

import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

const CACHE_KEY = '2fa-secrets-cache';

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function flushMicrotasks() {
	for (let index = 0; index < 30; index += 1) {
		await Promise.resolve();
	}
}

function createStorage(initialValues = {}) {
	const values = new Map(Object.entries(initialValues));
	return {
		getItem: vi.fn((key) => values.get(key) ?? null),
		removeItem: vi.fn((key) => values.delete(key)),
		setItem: vi.fn((key, value) => values.set(key, String(value))),
	};
}

function hotpSecret(overrides = {}) {
	return {
		id: 'hotp-1',
		name: 'Hardware token',
		account: 'owner@example.com',
		secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
		type: 'HOTP',
		digits: 6,
		period: 30,
		algorithm: 'SHA1',
		counter: 42,
		...overrides,
	};
}

function jsonResponse(body, { ok = true, status = ok ? 200 : 409 } = {}) {
	return {
		ok,
		status,
		statusText: ok ? 'OK' : 'Conflict',
		json: vi.fn(async () => body),
	};
}

async function createHarness(authenticatedFetch, options = {}) {
	const initialSecrets = options.initialSecrets || [hotpSecret()];
	const localStorage = options.localStorage || createStorage();
	const elements = {
		'otp-hotp-1': { textContent: '123456' },
		'counter-hotp-1': { textContent: '计数器: 42' },
		loading: { style: {} },
		emptyState: { style: {} },
	};
	const document = {
		hidden: false,
		addEventListener: vi.fn(),
		body: { appendChild: vi.fn(), removeChild: vi.fn() },
		createElement: vi.fn(),
		execCommand: vi.fn(() => true),
		getElementById: vi.fn((id) => elements[id] ?? null),
		querySelectorAll: vi.fn(() => []),
	};
	const window = { addEventListener: vi.fn(), matchMedia: vi.fn(() => ({ matches: false })) };
	const navigator = {
		onLine: options.onLine ?? true,
		clipboard: { writeText: vi.fn(async () => {}) },
	};
	const showCenterToast = vi.fn();
	const quietConsole = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

	// eslint-disable-next-line no-new-func
	const api = new Function(
		'authenticatedFetch',
		'document',
		'localStorage',
		'navigator',
		'showCenterToast',
		'window',
		'console',
		'setInterval',
		'clearInterval',
		'initialSecrets',
		`
      function getCorrectedNowMs() { return 0; }
      function getTrustedClockGeneration() { return 0; }
      function getTrustedMonotonicNowMs() { return 0; }
      async function ensureServerTimeSynchronized() { return true; }
      ${getStateCode()}
      secrets = initialSecrets;
      ${getOTPCode()}
      ${getCoreCode()}
      renderFilteredSecrets = async () => updateOTPSecretsInBatch(filteredSecrets, { includeHOTP: true });
      return {
        copyOTP,
        loadSecrets,
        updateOTP,
        updateOTPSecretsInBatch,
        getCommittedHOTPToken,
        otpCalculator,
        getSecrets() { return secrets; },
        getSaveQueue() { return saveQueue; },
        setSaveQueue(value) { saveQueue = value; },
        setSecrets(value) { secrets = value; filteredSecrets = [...value]; }
      };
    `,
	)(
		authenticatedFetch,
		document,
		localStorage,
		navigator,
		showCenterToast,
		window,
		quietConsole,
		vi.fn(() => 1),
		vi.fn(),
		initialSecrets,
	);
	const calculateCurrentOTP = vi.fn(async (secret) => String(secret.counter === 42 ? '123456' : '234567').padStart(secret.digits, '0'));
	const calculateNextOTP = vi.fn(async (secret) => '345678'.padStart(secret.digits, '0'));
	api.otpCalculator.calculateCurrentOTP = calculateCurrentOTP;
	api.otpCalculator.calculateNextOTP = calculateNextOTP;
	await api.updateOTPSecretsInBatch(initialSecrets, { includeHOTP: true });
	calculateCurrentOTP.mockClear();
	calculateNextOTP.mockClear();

	return {
		api,
		document,
		elements,
		localStorage,
		navigator,
		showCenterToast,
		calculateCurrentOTP,
		calculateNextOTP,
	};
}

function expectedSnapshot(overrides = {}) {
	return {
		expectedCounter: 42,
		expectedSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
		expectedDigits: 6,
		expectedAlgorithm: 'SHA1',
		expectedNamespace: null,
		...overrides,
	};
}

describe('HOTP copy counter persistence', () => {
	it('posts only the generation snapshot and advances after an online success', async () => {
		const authenticatedFetch = vi.fn(async (_url, options) => {
			expect(JSON.parse(options.body)).toEqual(expectedSnapshot());
			return jsonResponse({ data: { secret: hotpSecret({ counter: 43 }) } });
		});
		const harness = await createHarness(authenticatedFetch);

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(true);

		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledWith('123456');
		expect(authenticatedFetch).toHaveBeenCalledWith('/api/secrets/hotp-1/counter', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(expectedSnapshot()),
		});
		expect(harness.api.getSecrets()[0].counter).toBe(43);
		expect(harness.elements['counter-hotp-1'].textContent).toBe('计数器: 43');
		expect(harness.api.getCommittedHOTPToken('hotp-1', harness.api.getSecrets()[0])).toBe('234567');
	});

	it('warns when a concurrently started copy succeeds but reservation is rejected', async () => {
		const authenticatedFetch = vi.fn(async (url, options = {}) => {
			if (options.method === 'POST') {
				return jsonResponse({ error: 'write failed' }, { ok: false });
			}
			expect(url).toBe('/api/secrets');
			return jsonResponse([hotpSecret()]);
		});
		const harness = await createHarness(authenticatedFetch);

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);

		expect(harness.api.getSecrets()[0].counter).toBe(42);
		expect(harness.elements['counter-hotp-1'].textContent).toBe('计数器: 42');
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledWith('123456');
		expect(harness.api.getCommittedHOTPToken('hotp-1', harness.api.getSecrets()[0])).toBe('123456');
		expect(authenticatedFetch).toHaveBeenCalledTimes(2);
		expect(harness.showCenterToast).toHaveBeenCalledWith('⚠️', '验证码已复制，但本地计数器同步失败：write failed');
	});

	it('refuses to copy or reserve while explicitly offline', async () => {
		const authenticatedFetch = vi.fn();
		const harness = await createHarness(authenticatedFetch, { onLine: false });

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);

		expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
		expect(authenticatedFetch).not.toHaveBeenCalled();
		expect(harness.api.getSecrets()[0].counter).toBe(42);
		expect(harness.showCenterToast).toHaveBeenCalledWith('⚠️', '离线状态下无法安全复制 HOTP 验证码');
	});

	it('locks rapid repeated clicks until the first advance settles', async () => {
		const response = createDeferred();
		const authenticatedFetch = vi.fn(() => response.promise);
		const harness = await createHarness(authenticatedFetch);

		const firstCopy = harness.api.copyOTP('hotp-1');
		const repeatedCopy = harness.api.copyOTP('hotp-1');
		for (let index = 0; index < 6; index += 1) {
			await Promise.resolve();
		}

		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledOnce();
		expect(authenticatedFetch).toHaveBeenCalledOnce();

		response.resolve(jsonResponse({ data: { secret: hotpSecret({ counter: 43 }) } }));
		await expect(Promise.all([firstCopy, repeatedCopy])).resolves.toEqual([true, true]);
		expect(harness.api.getSecrets()[0].counter).toBe(43);
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledOnce();
		expect(authenticatedFetch).toHaveBeenCalledOnce();
	});

	it('rejects MAX_SAFE_INTEGER before copying or sending a request', async () => {
		const authenticatedFetch = vi.fn();
		const harness = await createHarness(authenticatedFetch, {
			initialSecrets: [hotpSecret({ counter: Number.MAX_SAFE_INTEGER })],
		});

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);

		expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
		expect(authenticatedFetch).not.toHaveBeenCalled();
		expect(harness.showCenterToast).toHaveBeenCalledWith('⚠️', 'HOTP 计数器无效或已达到上限');
	});

	it('reads a replacement secret after an earlier queued edit before copying', async () => {
		const gate = createDeferred();
		const replacement = hotpSecret({
			secret: 'JBSWY3DPEHPK3PXP',
			digits: 8,
			algorithm: 'SHA256',
			counter: 50,
		});
		const authenticatedFetch = vi.fn(async (_url, options) => {
			const snapshot = JSON.parse(options.body);
			return jsonResponse({ data: { secret: { ...replacement, counter: snapshot.expectedCounter + 1 } } });
		});
		const harness = await createHarness(authenticatedFetch);
		harness.api.setSaveQueue(
			gate.promise.then(async () => {
				harness.api.setSecrets([replacement]);
				harness.calculateCurrentOTP.mockResolvedValue('87654321');
				await harness.api.updateOTP('hotp-1', null, replacement);
			}),
		);

		const copy = harness.api.copyOTP('hotp-1');
		expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
		gate.resolve();
		await expect(copy).resolves.toBe(true);

		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledWith('87654321');
		expect(JSON.parse(authenticatedFetch.mock.calls[0][1].body)).toEqual(
			expectedSnapshot({
				expectedCounter: 50,
				expectedSecret: 'JBSWY3DPEHPK3PXP',
				expectedDigits: 8,
				expectedAlgorithm: 'SHA256',
			}),
		);
		expect(harness.api.getSecrets()[0].counter).toBe(51);
	});

	it('reconciles with GET when the successful POST response loses its JSON body', async () => {
		const authenticatedFetch = vi.fn(async (_url, options = {}) => {
			if (options.method === 'POST') {
				return {
					ok: true,
					status: 200,
					statusText: 'OK',
					json: vi.fn(async () => {
						throw new SyntaxError('missing response body');
					}),
				};
			}
			return jsonResponse([hotpSecret({ counter: 43 })]);
		});
		const harness = await createHarness(authenticatedFetch);

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);

		expect(authenticatedFetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/hotp-1/counter', '/api/secrets']);
		expect(harness.api.getSecrets()[0].counter).toBe(43);
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledWith('123456');
		expect(JSON.parse(harness.localStorage.getItem(CACHE_KEY)).data[0].counter).toBe(43);
	});

	it('does not let a GET started before reservation overwrite the committed counter', async () => {
		const oldGet = createDeferred();
		const authenticatedFetch = vi.fn(async (_url, options = {}) => {
			if (options.method === 'POST') {
				return jsonResponse({ data: { secret: hotpSecret({ counter: 43 }) } });
			}
			return oldGet.promise;
		});
		const harness = await createHarness(authenticatedFetch);

		const staleLoad = harness.api.loadSecrets();
		await Promise.resolve();
		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(true);
		expect(harness.api.getSecrets()[0].counter).toBe(43);

		oldGet.resolve(jsonResponse([hotpSecret()]));
		await staleLoad;
		expect(harness.api.getSecrets()[0].counter).toBe(43);
	});

	it('does not invalidate an in-flight GET when the displayed token is not copyable', async () => {
		const pendingGet = createDeferred();
		const authenticatedFetch = vi.fn(() => pendingGet.promise);
		const harness = await createHarness(authenticatedFetch);
		const load = harness.api.loadSecrets();
		await Promise.resolve();
		harness.elements['otp-hotp-1'].textContent = '------';

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);
		pendingGet.resolve(jsonResponse([hotpSecret({ counter: 50 })]));
		await load;

		expect(harness.api.getSecrets()[0].counter).toBe(50);
		expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
	});

	it('blocks the old HOTP after a batch replaces the post-reservation update, then recovers after commit', async () => {
		const authenticatedFetch = vi.fn(async (_url, options) => {
			const { expectedCounter } = JSON.parse(options.body);
			return jsonResponse({ data: { secret: hotpSecret({ counter: expectedCounter + 1 }) } });
		});
		const harness = await createHarness(authenticatedFetch, {
			initialSecrets: [hotpSecret(), hotpSecret({ id: 'slow-totp', type: 'TOTP' })],
		});
		const calculations = [];
		for (const calculate of [harness.calculateCurrentOTP, harness.calculateNextOTP]) {
			calculate.mockImplementation(() => {
				const deferred = createDeferred();
				calculations.push(deferred);
				return deferred.promise;
			});
		}

		const firstCopy = harness.api.copyOTP('hotp-1');
		await flushMicrotasks();
		expect(harness.api.getSecrets()[0].counter).toBe(43);
		expect(calculations).toHaveLength(2);

		// Ctrl+R / focus refresh starts a new atomic batch while the single-card update is pending.
		const batch = harness.api.updateOTPSecretsInBatch(harness.api.getSecrets(), { includeHOTP: true });
		expect(calculations).toHaveLength(6);
		calculations[0].resolve('234567');
		calculations[1].resolve('345678');
		await expect(firstCopy).resolves.toBe(true);
		expect(harness.elements['otp-hotp-1'].textContent).toBe('123456');

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);
		expect(authenticatedFetch).toHaveBeenCalledOnce();
		expect(harness.navigator.clipboard.writeText.mock.calls).toEqual([['123456']]);
		expect(calculations).toHaveLength(6);

		calculations.slice(2).forEach((calculation) => calculation.resolve('234567'));
		await batch;
		expect(harness.api.getCommittedHOTPToken('hotp-1', harness.api.getSecrets()[0])).toBe('234567');
		harness.calculateCurrentOTP.mockResolvedValue('345678');
		harness.calculateNextOTP.mockResolvedValue('456789');
		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(true);
		expect(harness.navigator.clipboard.writeText.mock.calls).toEqual([['123456'], ['234567']]);
		expect(authenticatedFetch.mock.calls.map(([, options]) => JSON.parse(options.body).expectedCounter)).toEqual([42, 43]);
		expect(harness.api.getSecrets()[0].counter).toBe(44);
	});

	it('requires a fresh commit on a replacement DOM node even when its numeric text is unchanged', async () => {
		const authenticatedFetch = vi.fn();
		const harness = await createHarness(authenticatedFetch);
		harness.elements['otp-hotp-1'] = { textContent: '123456' };

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);
		expect(authenticatedFetch).not.toHaveBeenCalled();
		expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
		await flushMicrotasks();
		expect(harness.api.getCommittedHOTPToken('hotp-1', harness.api.getSecrets()[0])).toBe('123456');
	});

	it.each([{ counter: 43 }, { hotpCounterNamespace: 'generation-b' }])(
		'does not bind an old calculation after an in-flight parameter change: %j',
		async (change) => {
			const harness = await createHarness(vi.fn(), {
				initialSecrets: [hotpSecret({ hotpCounterNamespace: 'generation-a' })],
			});
			const calculation = createDeferred();
			harness.calculateCurrentOTP.mockReturnValueOnce(calculation.promise);
			const secret = harness.api.getSecrets()[0];
			const update = harness.api.updateOTP(secret.id, null, secret);
			Object.assign(secret, change);
			calculation.resolve('123456');
			await update;

			expect(harness.api.getCommittedHOTPToken(secret.id, secret)).toBeNull();
			await expect(harness.api.copyOTP(secret.id)).resolves.toBe(false);
			expect(harness.navigator.clipboard.writeText).not.toHaveBeenCalled();
		},
	);

	it('does not commit a successful old reservation into a replacement namespace with identical seed and counter', async () => {
		const post = createDeferred();
		const replacement = hotpSecret({ hotpCounterNamespace: 'generation-b' });
		const authenticatedFetch = vi.fn(async (_url, options = {}) =>
			options.method === 'POST' ? post.promise : jsonResponse([replacement]),
		);
		const harness = await createHarness(authenticatedFetch, {
			initialSecrets: [hotpSecret({ hotpCounterNamespace: 'generation-a' })],
		});
		const copy = harness.api.copyOTP('hotp-1');
		await flushMicrotasks();
		harness.api.setSecrets([replacement]);
		post.resolve(jsonResponse({ data: { secret: hotpSecret({ counter: 43, hotpCounterNamespace: 'generation-a' }) } }));

		await expect(copy).resolves.toBe(false);
		expect(harness.api.getSecrets()[0].counter).toBe(42);
		expect(harness.api.getSecrets()[0].hotpCounterNamespace).toBe('generation-b');
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledOnce();
		expect(JSON.parse(authenticatedFetch.mock.calls[0][1].body).expectedNamespace).toBe('generation-a');
	});

	it('rejects a successful response for a different namespace even when all visible generation parameters match', async () => {
		const secret = hotpSecret({ hotpCounterNamespace: 'generation-a' });
		const authenticatedFetch = vi.fn(async (_url, options = {}) =>
			options.method === 'POST'
				? jsonResponse({ data: { secret: hotpSecret({ counter: 43, hotpCounterNamespace: 'generation-b' }) } })
				: jsonResponse([secret]),
		);
		const harness = await createHarness(authenticatedFetch, { initialSecrets: [secret] });

		await expect(harness.api.copyOTP('hotp-1')).resolves.toBe(false);
		expect(harness.api.getSecrets()[0].counter).toBe(42);
		expect(harness.api.getSecrets()[0].hotpCounterNamespace).toBe('generation-a');
		expect(authenticatedFetch).toHaveBeenCalledTimes(2);
		expect(harness.showCenterToast).toHaveBeenCalledWith('⚠️', '验证码已复制，但本地计数器同步失败：服务器返回了无效的计数器状态');
	});
});
