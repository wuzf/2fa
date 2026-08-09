import { describe, expect, it, vi } from 'vitest';

import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';

const SERVER_BASE_MS = Date.UTC(2026, 0, 1);
const STORAGE_KEY = '2fa-clock-sync-v1';

function createStorage(initialValues = {}) {
	const values = new Map(Object.entries(initialValues));
	return {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, String(value))),
		removeItem: vi.fn((key) => values.delete(key)),
		values,
	};
}

function createCachedClock({
	offsetMs,
	localWallAtSyncMs = SERVER_BASE_MS,
	monotonicEpochAtSyncMs = localWallAtSyncMs,
	syncedAtServerMs = localWallAtSyncMs + offsetMs,
	rttMs = 10,
}) {
	return JSON.stringify({
		version: 2,
		offsetMs,
		syncedAtServerMs,
		rttMs,
		localWallAtSyncMs,
		monotonicEpochAtSyncMs,
	});
}

function createWarningElements() {
	const warning = {
		hidden: true,
		classList: { toggle: vi.fn() },
	};
	const text = { textContent: '' };
	const retryButton = { disabled: false };
	return {
		clockWarning: warning,
		clockWarningText: text,
		clockSyncRetryButton: retryButton,
	};
}

function createDocument(elements = {}) {
	return {
		hidden: false,
		addEventListener: vi.fn(),
		getElementById: vi.fn((id) => elements[id] ?? null),
	};
}

function createHarness({
	localNowMs = SERVER_BASE_MS,
	performanceTimeOriginMs = localNowMs,
	storageValues = {},
	elements = {},
	secrets = [],
} = {}) {
	const state = {
		localEpochMs: localNowMs,
		monotonicMs: 0,
		wallClockAdjustmentMs: 0,
		queuedSamples: [],
		pendingRequests: [],
	};
	const localStorage = createStorage(storageValues);
	const document = createDocument(elements);
	const fakeDate = {
		now: () => state.localEpochMs + state.monotonicMs + state.wallClockAdjustmentMs,
		UTC: Date.UTC,
	};
	const performance = {
		timeOrigin: performanceTimeOriginMs,
		now: () => state.monotonicMs,
	};
	const navigator = { onLine: true };
	const fetch = vi.fn((url, options) => {
		const sample = state.queuedSamples.shift();
		if (!sample) return Promise.reject(new Error('No queued time sample'));

		return new Promise((resolve, reject) => {
			const request = {
				options,
				reject,
				resolve,
				sample,
				settled: false,
				startedAtLocalMs: fakeDate.now(),
				startedAtMonotonicMs: performance.now(),
				url,
			};
			const rejectOnce = (error) => {
				if (request.settled) return;
				request.settled = true;
				reject(error);
			};
			if (options.signal.aborted) {
				rejectOnce(new Error('request aborted'));
			} else {
				options.signal.addEventListener('abort', () => rejectOnce(new Error('request aborted')), { once: true });
			}
			state.pendingRequests.push(request);
		});
	});
	const silentConsole = {
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	const window = {
		addEventListener: vi.fn(),
		setInterval: vi.fn(),
		crypto: globalThis.crypto,
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
			TrustedClock,
			trustedClock,
			getCorrectedNowMs,
			ensureServerTimeSynchronized,
			syncServerTime,
			otpCalculator,
			updateCountdown
		};`,
	)(
		fakeDate,
		performance,
		fetch,
		localStorage,
		navigator,
		document,
		window,
		vi.fn(() => 1),
		vi.fn(),
		vi.fn(),
		vi.fn(),
		AbortController,
		silentConsole,
		secrets,
		{},
	);

	function queueSamples(samples) {
		state.queuedSamples.push(...samples);
	}

	async function completeRequests(requests) {
		requests.sort((a, b) => a.sample.rttMs - b.sample.rttMs);

		for (const request of requests) {
			state.monotonicMs = request.startedAtMonotonicMs + request.sample.rttMs;
			request.settled = true;
			if (request.sample.reject) {
				request.reject(new Error('network unavailable'));
			} else {
				const serverTimeMs =
					request.sample.serverTimeMs ?? request.startedAtLocalMs + request.sample.rttMs / 2 + (request.sample.offsetMs ?? 0);
				request.resolve({
					ok: request.sample.ok ?? true,
					status: request.sample.status ?? 200,
					json: async () => ({ serverTimeMs }),
				});
			}
			await Promise.resolve();
			await Promise.resolve();
		}
	}

	async function completePendingRequests() {
		const requests = state.pendingRequests.splice(0).filter((request) => !request.settled);
		await completeRequests(requests);
	}

	async function completeNextPendingRequest() {
		const index = state.pendingRequests.findIndex((request) => !request.settled);
		if (index === -1) throw new Error('No pending time request');
		const [request] = state.pendingRequests.splice(index, 1);
		await completeRequests([request]);
		return request;
	}

	return {
		api,
		completeNextPendingRequest,
		completePendingRequests,
		document,
		fetch,
		localStorage,
		navigator,
		queueSamples,
		state,
		window,
	};
}

async function runSync(harness, samples) {
	harness.queueSamples(samples);
	const result = harness.api.syncServerTime();
	await harness.completePendingRequests();
	return result;
}

describe('trusted browser clock', () => {
	it.each([
		['fast', 5 * 60 * 1000, -5 * 60 * 1000],
		['slow', -4 * 60 * 1000, 4 * 60 * 1000],
	])('corrects a %s local clock', async (_direction, localSkewMs, expectedOffsetMs) => {
		const harness = createHarness({ localNowMs: SERVER_BASE_MS + localSkewMs });
		const samples = [20, 60, 100].map((rttMs) => ({ rttMs, offsetMs: expectedOffsetMs }));

		await expect(runSync(harness, samples)).resolves.toBe(true);

		expect(harness.api.trustedClock.offsetMs).toBe(expectedOffsetMs);
		expect(harness.api.getCorrectedNowMs()).toBe(SERVER_BASE_MS + 100);
		expect(harness.api.trustedClock.status).toBe('synced');
	});

	it('uses the request midpoint for a 200 ms round trip', async () => {
		const localSkewMs = 10_000;
		const harness = createHarness({ localNowMs: SERVER_BASE_MS + localSkewMs });
		harness.queueSamples([{ rttMs: 200, serverTimeMs: SERVER_BASE_MS + 100 }]);

		const samplePromise = harness.api.trustedClock.takeSample();
		await harness.completePendingRequests();
		const sample = await samplePromise;

		expect(sample).toEqual({
			rttMs: 200,
			offsetMs: -localSkewMs,
			serverAtReceiveMs: SERVER_BASE_MS + 200,
			localWallAtReceiveMs: SERVER_BASE_MS + localSkewMs + 200,
			monotonicAtReceiveMs: 200,
		});
	});

	it('rejects an entire sync when wall time jumps while samples are in flight', async () => {
		const harness = createHarness();
		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 45_000 })));
		const sync = harness.api.syncServerTime();
		expect(harness.state.pendingRequests).toHaveLength(3);

		harness.state.wallClockAdjustmentMs += 2 * 60 * 60 * 1000;
		await harness.completePendingRequests();

		await expect(sync).resolves.toBe(false);
		expect(harness.api.trustedClock.status).toBe('local');
		expect(harness.api.trustedClock.offsetMs).toBeNull();
	});

	it('selects the successful sample with the lowest RTT', async () => {
		const harness = createHarness();

		await expect(
			runSync(harness, [
				{ rttMs: 120, offsetMs: 1_000 },
				{ rttMs: 20, offsetMs: 2_000 },
				{ rttMs: 80, offsetMs: 3_000 },
			]),
		).resolves.toBe(true);

		expect(harness.api.trustedClock.rttMs).toBe(20);
		expect(harness.api.trustedClock.offsetMs).toBe(2_000);
	});

	it('replaces the previous offset on resync instead of accumulating it', async () => {
		const harness = createHarness();

		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 120_000 })),
		);
		expect(harness.api.trustedClock.offsetMs).toBe(120_000);

		await runSync(
			harness,
			[30, 50, 70].map((rttMs) => ({ rttMs, offsetMs: -45_000 })),
		);
		expect(harness.api.trustedClock.offsetMs).toBe(-45_000);
	});

	it('keeps a previous correction after failure and falls back to local time on the first failure', async () => {
		const withPreviousSync = createHarness();
		await runSync(
			withPreviousSync,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 90_000 })),
		);
		const correctedBeforeFailure = withPreviousSync.api.getCorrectedNowMs();

		await expect(
			runSync(
				withPreviousSync,
				[20, 40, 60].map((rttMs) => ({ reject: true, rttMs })),
			),
		).resolves.toBe(false);
		expect(withPreviousSync.api.trustedClock.offsetMs).toBe(90_000);
		expect(withPreviousSync.api.trustedClock.status).toBe('cached');
		expect(withPreviousSync.api.getCorrectedNowMs()).toBe(correctedBeforeFailure + 60);

		const firstSyncFailure = createHarness();
		await expect(
			runSync(
				firstSyncFailure,
				[20, 40, 60].map((rttMs) => ({ reject: true, rttMs })),
			),
		).resolves.toBe(false);
		expect(firstSyncFailure.api.trustedClock.status).toBe('local');
		expect(firstSyncFailure.api.trustedClock.offsetMs).toBeNull();
		expect(firstSyncFailure.api.getCorrectedNowMs()).toBe(SERVER_BASE_MS + 60);
	});

	it('reanchors from the wall clock after sleep when resume synchronization fails', async () => {
		const offsetMs = 90_000;
		const harness = createHarness();
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs })),
		);
		const correctedBeforeSleep = harness.api.getCorrectedNowMs();

		harness.state.wallClockAdjustmentMs += 2 * 60 * 60 * 1000;
		expect(harness.api.getCorrectedNowMs()).toBe(correctedBeforeSleep);

		harness.queueSamples([20, 40, 60].map((rttMs) => ({ reject: true, rttMs })));
		const resume = harness.api.trustedClock.handleResume();
		await harness.completePendingRequests();

		await expect(resume).resolves.toBe(false);
		expect(harness.api.trustedClock.status).toBe('cached');
		const localWallNowMs = harness.state.localEpochMs + harness.state.monotonicMs + harness.state.wallClockAdjustmentMs;
		expect(harness.api.getCorrectedNowMs()).toBe(localWallNowMs + offsetMs);
	});

	it('aborts an in-flight sync after a resume discontinuity and starts three fresh samples', async () => {
		const harness = createHarness();
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 30_000 })),
		);
		harness.fetch.mockClear();

		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 120_000 })));
		const oldSync = harness.api.syncServerTime();
		const oldRequests = harness.state.pendingRequests.slice();
		harness.state.wallClockAdjustmentMs += 2 * 60 * 60 * 1000;
		harness.queueSamples([30, 50, 70].map((rttMs) => ({ rttMs, offsetMs: -45_000 })));

		const resume = harness.api.trustedClock.handleResume();
		await Promise.resolve();
		await Promise.resolve();
		expect(oldRequests.every((request) => request.options.signal.aborted)).toBe(true);
		await expect(oldSync).resolves.toBe(false);
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

		expect(harness.fetch).toHaveBeenCalledTimes(6);
		expect(harness.state.pendingRequests.filter((request) => !request.settled)).toHaveLength(3);
		await harness.completePendingRequests();

		await expect(resume).resolves.toBe(true);
		expect(harness.api.trustedClock.status).toBe('synced');
		expect(harness.api.trustedClock.offsetMs).toBe(-45_000);
	});

	it('discards a partially fulfilled sync attempt before committing fresh resume samples', async () => {
		const initialOffsetMs = 30_000;
		const freshOffsetMs = -45_000;
		const harness = createHarness();
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: initialOffsetMs })),
		);
		const generationBeforeOldSync = harness.api.trustedClock.generation;
		harness.fetch.mockClear();

		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 120_000 })));
		const oldSync = harness.api.syncServerTime();
		const oldRequests = harness.state.pendingRequests.slice();
		await harness.completeNextPendingRequest();
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

		expect(oldRequests[0].settled).toBe(true);
		expect(oldRequests.slice(1).every((request) => !request.settled)).toBe(true);
		expect(harness.api.trustedClock.activeSampleControllers.size).toBe(2);
		expect(harness.api.trustedClock.generation).toBe(generationBeforeOldSync);
		expect(harness.api.trustedClock.offsetMs).toBe(initialOffsetMs);

		harness.state.wallClockAdjustmentMs += 2 * 60 * 60 * 1000;
		harness.queueSamples([30, 50, 70].map((rttMs) => ({ rttMs, offsetMs: freshOffsetMs })));
		const resume = harness.api.trustedClock.handleResume();
		const recoveredState = {
			anchorLocalWallMs: harness.api.trustedClock.anchorLocalWallMs,
			anchorMonotonicMs: harness.api.trustedClock.anchorMonotonicMs,
			anchorServerMs: harness.api.trustedClock.anchorServerMs,
			generation: harness.api.trustedClock.generation,
		};

		expect(recoveredState.generation).toBe(generationBeforeOldSync + 1);
		expect(oldRequests[0].options.signal.aborted).toBe(false);
		expect(oldRequests.slice(1).every((request) => request.options.signal.aborted)).toBe(true);
		await expect(oldSync).resolves.toBe(false);
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

		expect(harness.api.trustedClock.generation).toBe(recoveredState.generation);
		expect(harness.api.trustedClock.anchorLocalWallMs).toBe(recoveredState.anchorLocalWallMs);
		expect(harness.api.trustedClock.anchorMonotonicMs).toBe(recoveredState.anchorMonotonicMs);
		expect(harness.api.trustedClock.anchorServerMs).toBe(recoveredState.anchorServerMs);
		expect(harness.api.trustedClock.offsetMs).toBe(initialOffsetMs);
		expect(harness.fetch).toHaveBeenCalledTimes(6);
		expect(harness.state.pendingRequests.filter((request) => !request.settled)).toHaveLength(3);

		await harness.completePendingRequests();
		await expect(resume).resolves.toBe(true);
		expect(harness.api.trustedClock.status).toBe('synced');
		expect(harness.api.trustedClock.offsetMs).toBe(freshOffsetMs);
		expect(harness.api.trustedClock.generation).toBe(recoveredState.generation + 1);
	});

	it('downgrades an ordinary failed resync to cached and displays a warning', async () => {
		const elements = createWarningElements();
		const harness = createHarness({ elements });
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 30_000 })),
		);
		expect(elements.clockWarning.hidden).toBe(true);

		await expect(
			runSync(
				harness,
				[20, 40, 60].map((rttMs) => ({ reject: true, rttMs })),
			),
		).resolves.toBe(false);

		expect(harness.api.trustedClock.status).toBe('cached');
		expect(elements.clockWarning.hidden).toBe(false);
		expect(elements.clockWarning.classList.toggle).toHaveBeenLastCalledWith('show', true);
		expect(elements.clockWarningText.textContent).not.toBe('');
	});

	it.each([
		['non-finite', Number.NaN],
		['out-of-range', Date.UTC(2200, 0, 1)],
	])('rejects %s server time and preserves the previous correction', async (_kind, serverTimeMs) => {
		const harness = createHarness();
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 75_000 })),
		);

		await expect(
			runSync(
				harness,
				[20, 40, 60].map((rttMs) => ({ rttMs, serverTimeMs })),
			),
		).resolves.toBe(false);

		expect(harness.api.trustedClock.status).toBe('cached');
		expect(harness.api.trustedClock.offsetMs).toBe(75_000);
	});

	it('removes a corrupted cached offset and falls back to local time', () => {
		const harness = createHarness({ storageValues: { [STORAGE_KEY]: '{not-json' } });

		expect(harness.api.trustedClock.status).toBe('local');
		expect(harness.api.trustedClock.offsetMs).toBeNull();
		expect(harness.api.getCorrectedNowMs()).toBe(SERVER_BASE_MS);
		expect(harness.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
		expect(harness.localStorage.values.has(STORAGE_KEY)).toBe(false);
	});

	it('rejects a cached offset when observable wall and monotonic elapsed time diverge', () => {
		const offsetMs = 60_000;
		const harness = createHarness({
			localNowMs: SERVER_BASE_MS + 2 * 60 * 60 * 1000,
			performanceTimeOriginMs: SERVER_BASE_MS + 5 * 60 * 1000,
			storageValues: {
				[STORAGE_KEY]: createCachedClock({ offsetMs }),
			},
		});

		expect(harness.api.trustedClock.status).toBe('local');
		expect(harness.api.trustedClock.offsetMs).toBeNull();
		expect(harness.localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
		expect(harness.api.getCorrectedNowMs()).toBe(SERVER_BASE_MS + 2 * 60 * 60 * 1000);
	});

	it('loads a valid cached offset and anchors corrected time immediately', () => {
		const offsetMs = 17_000;
		const correctedNowMs = SERVER_BASE_MS + offsetMs;
		const cached = createCachedClock({
			offsetMs,
			localWallAtSyncMs: SERVER_BASE_MS - 60 * 60 * 1000,
			rttMs: 42,
		});
		const harness = createHarness({ storageValues: { [STORAGE_KEY]: cached } });

		expect(harness.api.trustedClock.status).toBe('cached');
		expect(harness.api.trustedClock.offsetMs).toBe(offsetMs);
		expect(harness.api.trustedClock.rttMs).toBe(42);
		expect(harness.api.getCorrectedNowMs()).toBe(correctedNowMs);
		expect(harness.localStorage.removeItem).not.toHaveBeenCalled();
	});

	it('returns immediately from cached readiness while sharing one background sync', async () => {
		const offsetMs = 12_000;
		const correctedNowMs = SERVER_BASE_MS + offsetMs;
		const harness = createHarness({
			storageValues: {
				[STORAGE_KEY]: createCachedClock({
					offsetMs,
					localWallAtSyncMs: SERVER_BASE_MS - 1000,
				}),
			},
		});
		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 15_000 })));

		const firstReady = harness.api.ensureServerTimeSynchronized();
		const backgroundSync = harness.api.trustedClock.syncPromise;
		const secondReady = harness.api.ensureServerTimeSynchronized();

		await expect(Promise.all([firstReady, secondReady])).resolves.toEqual([true, true]);
		expect(harness.state.pendingRequests).toHaveLength(3);
		expect(harness.fetch).toHaveBeenCalledTimes(3);
		expect(harness.api.trustedClock.syncPromise).toBe(backgroundSync);

		await harness.completePendingRequests();
		await expect(backgroundSync).resolves.toBe(true);
	});

	it('keeps the warning hidden on load while the first sync is still in flight', async () => {
		const elements = createWarningElements();
		const harness = createHarness({
			elements,
			storageValues: {
				[STORAGE_KEY]: createCachedClock({
					offsetMs: 12_000,
					localWallAtSyncMs: SERVER_BASE_MS - 60 * 60 * 1000,
				}),
			},
		});
		expect(harness.api.trustedClock.status).toBe('cached');

		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 15_000 })));
		harness.api.trustedClock.start();
		const initialSync = harness.api.trustedClock.syncPromise;

		expect(elements.clockWarning.hidden).toBe(true);
		expect(elements.clockWarningText.textContent).toBe('');
		expect(elements.clockWarning.classList.toggle).not.toHaveBeenCalledWith('show', true);

		await harness.completePendingRequests();
		await expect(initialSync).resolves.toBe(true);

		expect(harness.api.trustedClock.status).toBe('synced');
		expect(elements.clockWarning.hidden).toBe(true);
		expect(elements.clockWarning.classList.toggle).not.toHaveBeenCalledWith('show', true);
	});

	it('shows the cached warning once the first sync fails instead of before it settles', async () => {
		const elements = createWarningElements();
		const harness = createHarness({
			elements,
			storageValues: {
				[STORAGE_KEY]: createCachedClock({
					offsetMs: 12_000,
					localWallAtSyncMs: SERVER_BASE_MS - 60 * 60 * 1000,
				}),
			},
		});

		harness.queueSamples([20, 40, 60].map((rttMs) => ({ reject: true, rttMs })));
		harness.api.trustedClock.start();
		const initialSync = harness.api.trustedClock.syncPromise;
		expect(elements.clockWarning.hidden).toBe(true);

		await harness.completePendingRequests();
		await expect(initialSync).resolves.toBe(false);

		expect(harness.api.trustedClock.status).toBe('cached');
		expect(elements.clockWarning.hidden).toBe(false);
		expect(elements.clockWarning.classList.toggle).toHaveBeenLastCalledWith('show', true);
		expect(elements.clockWarningText.textContent).not.toBe('');
	});

	it('shows a stale warning after 24 hours during periodic and offline status refreshes', async () => {
		const elements = createWarningElements();
		const harness = createHarness({ elements });
		await runSync(
			harness,
			[20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 30_000 })),
		);
		expect(elements.clockWarning.hidden).toBe(true);

		harness.state.monotonicMs += 25 * 60 * 60 * 1000;
		harness.api.trustedClock.renderStatus();
		expect(harness.api.trustedClock.getCacheAgeMs()).toBeGreaterThan(24 * 60 * 60 * 1000);
		expect(elements.clockWarning.hidden).toBe(false);
		expect(elements.clockWarningText.textContent).not.toBe('');

		elements.clockWarning.hidden = true;
		elements.clockWarningText.textContent = '';
		harness.navigator.onLine = false;
		await expect(harness.api.trustedClock.handleResume()).resolves.toBe(false);
		expect(harness.api.trustedClock.status).toBe('cached');
		expect(elements.clockWarning.hidden).toBe(false);
		expect(elements.clockWarning.classList.toggle).toHaveBeenLastCalledWith('show', true);
		expect(elements.clockWarningText.textContent).not.toBe('');
	});

	it('uses corrected time for 30/60 second TOTP windows and countdown progress', () => {
		const correctedSeconds = 1_800_000_075;
		const correctedNowMs = correctedSeconds * 1000;
		const offsetMs = 17_000;
		const elements = {
			'otp-thirty': { textContent: '123456' },
			'otp-sixty': { textContent: '654321' },
			'progress-thirty': { style: {} },
			'progress-sixty': { style: {} },
		};
		const secrets = [
			{ id: 'thirty', period: 30, type: 'TOTP' },
			{ id: 'sixty', period: 60, type: 'TOTP' },
		];
		const harness = createHarness({
			localNowMs: correctedNowMs - offsetMs,
			storageValues: {
				[STORAGE_KEY]: createCachedClock({
					offsetMs,
					localWallAtSyncMs: correctedNowMs - offsetMs - 1000,
				}),
			},
			elements,
			secrets,
		});

		expect(harness.api.otpCalculator.getCurrentTimeWindow(30)).toBe(Math.floor(correctedSeconds / 30));
		expect(harness.api.otpCalculator.getNextTimeWindow(30)).toBe(Math.floor(correctedSeconds / 30) + 1);
		expect(harness.api.otpCalculator.getRemainingTime(30)).toBe(15);
		expect(harness.api.otpCalculator.getCurrentTimeWindow(60)).toBe(Math.floor(correctedSeconds / 60));
		expect(harness.api.otpCalculator.getNextTimeWindow(60)).toBe(Math.floor(correctedSeconds / 60) + 1);
		expect(harness.api.otpCalculator.getRemainingTime(60)).toBe(45);

		harness.api.updateCountdown('thirty');
		harness.api.updateCountdown('sixty');
		expect(elements['progress-thirty'].style.width).toBe('50%');
		expect(elements['progress-sixty'].style.width).toBe('75%');
	});

	it('deduplicates concurrent synchronization calls', async () => {
		const harness = createHarness();
		harness.queueSamples([20, 40, 60].map((rttMs) => ({ rttMs, offsetMs: 5_000 })));

		const first = harness.api.syncServerTime();
		const second = harness.api.syncServerTime();

		expect(second).toBe(first);
		expect(harness.fetch).toHaveBeenCalledTimes(3);
		await harness.completePendingRequests();
		await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
		expect(harness.fetch).toHaveBeenCalledTimes(3);
	});
});
