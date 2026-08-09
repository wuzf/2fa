import { describe, expect, it, vi } from 'vitest';

import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';

const SERVER_BASE_MS = Date.UTC(2026, 0, 1);

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

async function flushMicrotasks() {
	for (let index = 0; index < 6; index += 1) {
		await Promise.resolve();
	}
}

function createHarness({ nowMs = SERVER_BASE_MS } = {}) {
	const state = {
		localEpochMs: nowMs,
		monotonicMs: 0,
	};
	const secret = {
		id: 'race',
		name: 'Race test',
		secret: 'JBSWY3DPEHPK3PXP',
		period: 30,
		type: 'TOTP',
	};
	const elements = {
		'next-otp-race': { textContent: 'next-initial' },
		'otp-race': { textContent: 'current-initial' },
	};

	function FakeDate(...args) {
		return new Date(...(args.length > 0 ? args : [FakeDate.now()]));
	}
	FakeDate.now = () => state.localEpochMs + state.monotonicMs;
	FakeDate.UTC = Date.UTC;
	FakeDate.parse = Date.parse;

	const performance = {
		now: () => state.monotonicMs,
	};
	const document = {
		hidden: false,
		addEventListener: vi.fn(),
		getElementById: vi.fn((id) => elements[id] ?? null),
	};
	const localStorage = {
		getItem: vi.fn(() => null),
		removeItem: vi.fn(),
		setItem: vi.fn(),
	};
	const silentConsole = {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	};
	const window = {
		addEventListener: vi.fn(),
		crypto: globalThis.crypto,
		setInterval: vi.fn(),
	};

	const api = new Function(
		'Date',
		'performance',
		'fetch',
		'localStorage',
		'navigator',
		'document',
		'window',
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'clearInterval',
		'AbortController',
		'console',
		'secrets',
		'otpIntervals',
		`${getTimeCode()}${getOTPCode()}; return {
			trustedClock,
			otpCalculator,
			updateOTP
		};`,
	)(
		FakeDate,
		performance,
		vi.fn(),
		localStorage,
		{ onLine: true },
		document,
		window,
		vi.fn(() => 1),
		vi.fn(),
		vi.fn(),
		vi.fn(),
		AbortController,
		silentConsole,
		[secret],
		{},
	);

	const generationCalls = [];
	api.otpCalculator.generateTOTP = vi.fn((_secret, counter) => {
		const deferred = createDeferred();
		generationCalls.push({ counter, ...deferred });
		return deferred.promise;
	});

	return { api, elements, generationCalls, state };
}

describe('OTP asynchronous result races', () => {
	it('does not let a pre-sync WebCrypto result overwrite the synchronized DOM', async () => {
		const harness = createHarness();
		const initialWindow = harness.api.otpCalculator.getCurrentTimeWindow(30);
		const initialGeneration = harness.api.trustedClock.generation;

		const staleUpdate = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1]);

		harness.api.trustedClock.establishAnchor(SERVER_BASE_MS + 30_000, harness.state.monotonicMs);
		harness.api.trustedClock.generation += 1;
		expect(harness.api.trustedClock.generation).toBe(initialGeneration + 1);

		const synchronizedUpdate = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([
			initialWindow,
			initialWindow + 1,
			initialWindow + 1,
			initialWindow + 2,
		]);

		harness.generationCalls[2].resolve('fresh-current');
		harness.generationCalls[3].resolve('fresh-next');
		await synchronizedUpdate;
		expect(harness.elements['otp-race'].textContent).toBe('fresh-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('fresh-next');

		harness.generationCalls[0].resolve('stale-current');
		// The old "next" calculation targets the new current window and is deterministic.
		harness.generationCalls[1].resolve('fresh-current');
		await staleUpdate;

		expect(harness.elements['otp-race'].textContent).toBe('fresh-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('fresh-next');
	});

	it('recalculates instead of committing results when the time window changes during await', async () => {
		const windowStartMs = Math.floor(SERVER_BASE_MS / 30_000) * 30_000;
		const harness = createHarness({ nowMs: windowStartMs + 29_900 });
		const initialWindow = harness.api.otpCalculator.getCurrentTimeWindow(30);

		const update = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1]);

		harness.state.monotonicMs += 200;
		harness.generationCalls[0].resolve('expired-current');
		harness.generationCalls[1].resolve('new-current');
		await flushMicrotasks();

		expect(harness.elements['otp-race'].textContent).toBe('current-initial');
		expect(harness.elements['next-otp-race'].textContent).toBe('next-initial');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1, initialWindow + 2]);

		harness.generationCalls[2].resolve('new-next');
		await update;
		await flushMicrotasks();

		expect(harness.elements['otp-race'].textContent).toBe('new-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('new-next');
	});
});
