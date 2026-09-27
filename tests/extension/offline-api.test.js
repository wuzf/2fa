import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOfflineCodes, listOfflineAccounts, loadOfflineClock, loadOfflineSnapshot } from '../../extension/src/bridge/api.js';
import { generateTotp } from '../../extension/src/shared/totp.js';
import {
	SESSION_CLOCK_TRUST_MS,
	adoptVerifiedClock,
	clockVerificationRecord,
	offlineClockState,
} from '../../extension/src/shared/offline-clock.js';

const ORIGIN = 'https://twofa.example';
const TIME = 1800000010000;
const SEED = 'JBSWY3DPEHPK3PXP';
const RECORD = {
	id: 'a',
	name: 'Google',
	account: 'alice@example.com',
	secret: SEED,
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const ACCOUNT = { id: RECORD.id, name: RECORD.name, account: RECORD.account, type: 'TOTP', digits: 6 };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const snapshot = () => ({ data: [RECORD], timestamp: TIME, clock: null });
afterEach(() => vi.unstubAllGlobals());

describe('shared web snapshot and local OTP generation', () => {
	it.each([0, 42, Number.MAX_SAFE_INTEGER])(
		'uses legacy numeric account ID %s from a persisted web snapshot without network',
		async (id) => {
			const fetch = vi.fn();
			vi.stubGlobal('fetch', fetch);
			const cached = { ...snapshot(), data: [{ ...RECORD, id }] };
			const accounts = listOfflineAccounts(cached);
			expect(accounts).toEqual([expect.objectContaining({ ...ACCOUNT, id: String(id) })]);
			expect(JSON.stringify(accounts)).not.toContain(SEED);
			const [result] = await generateOfflineCodes(cached, { accounts, now: () => TIME, monotonicNow: () => 0, includeNext: true });
			expect(result).toMatchObject({
				id: String(id),
				code: await generateTotp(SEED, TIME),
				nextCode: await generateTotp(SEED, TIME + 30000),
			});
			expect(cached.data[0].id).toBe(id);
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it('does not select either record from an offline numeric/string ID collision', async () => {
		const cached = {
			...snapshot(),
			data: [
				{ ...RECORD, id: 0 },
				{ ...RECORD, id: '0' },
			],
		};
		expect(listOfflineAccounts(cached, { withDiagnostics: true })).toEqual({
			accounts: [],
			unavailableAccounts: [
				{ id: '0', name: RECORD.name, reason: 'duplicate' },
				{ id: '0', name: RECORD.name, reason: 'duplicate' },
			],
		});
		await expect(
			generateOfflineCodes(cached, { accounts: [{ ...ACCOUNT, id: '0' }], now: () => TIME, monotonicNow: () => 0 }),
		).rejects.toMatchObject({
			code: 'ACCOUNT_NOT_FOUND',
		});
	});

	it('lists and generates local snapshots without an instance or webpage origin while preserving cancellation', async () => {
		vi.stubGlobal('location', undefined);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const cached = snapshot();
		expect(listOfflineAccounts(cached)).toEqual([expect.objectContaining(ACCOUNT)]);
		const checkCurrent = vi.fn(async () => {});
		const [result] = await generateOfflineCodes(cached, { accounts: [ACCOUNT], now: () => TIME, monotonicNow: () => 0, checkCurrent });
		expect(result.code).toBe(await generateTotp(SEED, TIME));
		expect(checkCurrent).toHaveBeenCalled();
		await expect(
			generateOfflineCodes(cached, { accounts: [ACCOUNT], signal: AbortSignal.abort(), now: () => TIME, monotonicNow: () => 0 }),
		).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects a persisted clock jump on the first generation of a snapshot from the same worker', async () => {
		const cached = {
			...snapshot(),
			clock: {
				version: 2,
				offsetMs: 0,
				syncedAtServerMs: TIME,
				localWallAtSyncMs: TIME,
				monotonicEpochAtSyncMs: performance.timeOrigin,
				monotonicOriginMs: performance.timeOrigin,
			},
		};
		await expect(
			generateOfflineCodes(cached, { instanceOrigin: ORIGIN, accounts: [ACCOUNT], now: () => TIME + 30000, monotonicNow: () => 0 }),
		).rejects.toMatchObject({ code: 'CLOCK_CHANGED' });
	});
	it('checks only the public time endpoint for a time-only verification', async () => {
		vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
		const fetchImpl = vi.fn(async () => json({ serverTimeMs: TIME + 90_000 }));
		const clock = await loadOfflineClock({ instanceOrigin: ORIGIN, fetchImpl, now: () => TIME });
		expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/time']);
		expect(clock).toMatchObject({ version: 2, offsetMs: 90_000, syncedAtServerMs: TIME + 90_000, monotonicOriginMs: TIME });
		fetchImpl.mockResolvedValueOnce(json({}, 503));
		await expect(loadOfflineClock({ instanceOrigin: ORIGIN, fetchImpl, now: () => TIME })).rejects.toMatchObject({
			code: expect.any(String),
		});
	});
	describe('clock corrections restored from another execution context', () => {
		const OFFSET = 120_000;
		function workerClock(origin) {
			return {
				version: 2,
				offsetMs: OFFSET,
				syncedAtServerMs: TIME + OFFSET,
				localWallAtSyncMs: TIME,
				monotonicEpochAtSyncMs: TIME,
				monotonicOriginMs: origin,
				rttMs: null,
			};
		}

		it('detects a jump inside the worker, but reports a restarted worker as unverified instead of cached', () => {
			const origin = TIME - 5_000;
			const clock = workerClock(origin);
			// Same worker: the wall clock advanced 120 s while the monotonic clock did not.
			expect(offlineClockState(clock, TIME + 120_000, origin + 5_000, origin)).toEqual({ status: 'changed', offsetMs: 0 });
			// After a restart the new origin is sampled from the corrected wall clock,
			// so the old comparison sees nothing. The offset must not look verified.
			const restartedOrigin = TIME + 120_000;
			expect(offlineClockState(clock, TIME + 120_000, restartedOrigin, restartedOrigin)).toEqual({
				status: 'unverified',
				offsetMs: OFFSET,
			});
			expect(offlineClockState(clock, TIME + 1_000, origin + 6_000, origin)).toEqual({ status: 'cached', offsetMs: OFFSET });
		});

		describe('verification kept for the browser session', () => {
			const origin = TIME - 5_000;
			const record = clockVerificationRecord(ORIGIN, workerClock(origin), TIME);
			const restartedAt = TIME + 60_000;
			const adopt = (value = record, wallNow = restartedAt, clock = workerClock(origin), instanceOrigin = ORIGIN) =>
				adoptVerifiedClock(clock, value, instanceOrigin, wallNow, wallNow, wallNow);

			it('stores only the correction identity and timestamps', () => {
				expect(record).toEqual({
					instanceOrigin: ORIGIN,
					offsetMs: OFFSET,
					syncedAtServerMs: TIME + OFFSET,
					verifiedAtWallMs: TIME,
					lastSeenWallMs: TIME,
				});
			});

			it('anchors a recently verified correction to the restarted worker', () => {
				const adopted = adopt();
				expect(adopted).toEqual({
					...workerClock(origin),
					localWallAtSyncMs: restartedAt,
					monotonicEpochAtSyncMs: restartedAt,
					monotonicOriginMs: restartedAt,
				});
				expect(offlineClockState(adopted, restartedAt + 1_000, restartedAt + 1_000, restartedAt)).toEqual({
					status: 'cached',
					offsetMs: OFFSET,
				});
				// From now on this worker detects a later system time change again.
				expect(offlineClockState(adopted, restartedAt + 120_000, restartedAt + 1_000, restartedAt).status).toBe('changed');
			});

			it.each([
				['no record', null],
				['another instance', { ...record, instanceOrigin: 'https://other.example' }],
				['another offset', { ...record, offsetMs: OFFSET + 1 }],
				['another synchronization', { ...record, syncedAtServerMs: TIME + OFFSET + 1 }],
				['an invalid timestamp', { ...record, verifiedAtWallMs: 'yesterday' }],
			])('keeps the correction unverified for %s', (_label, value) => {
				expect(adopt(value)).toBeNull();
			});

			it('rejects a wall clock that moved backwards since a worker last saw it', () => {
				const seen = { ...record, lastSeenWallMs: TIME + 30_000 };
				expect(adopt(seen, TIME + 28_500)).not.toBeNull();
				expect(adopt(seen, TIME + 27_000)).toBeNull();
				expect(adopt(record, TIME - 3_000)).toBeNull();
			});

			it('trusts a verification for fifteen minutes only', () => {
				expect(SESSION_CLOCK_TRUST_MS).toBe(15 * 60 * 1000);
				expect(adopt(record, TIME + SESSION_CLOCK_TRUST_MS)).not.toBeNull();
				expect(adopt(record, TIME + SESSION_CLOCK_TRUST_MS + 1)).toBeNull();
			});

			it('never adopts blocked or unusable corrections', () => {
				expect(adopt(record, restartedAt, { error: 'CLOCK_CHANGED' })).toBeNull();
				expect(adopt(record, restartedAt, { error: 'CLOCK_UNAVAILABLE' })).toBeNull();
				expect(adopt(record, restartedAt, { ...workerClock(origin), version: 1 })).toBeNull();
				expect(adoptVerifiedClock(workerClock(origin), record, ORIGIN, restartedAt, restartedAt, null)).toBeNull();
			});
		});

		it('keeps the stale and invalid rules for restored corrections', () => {
			const age = 2 * 24 * 60 * 60 * 1000;
			const restartedOrigin = TIME + age;
			expect(offlineClockState(workerClock(TIME - 5_000), TIME + age, restartedOrigin, restartedOrigin).status).toBe('stale');
			expect(offlineClockState({ version: 2, offsetMs: OFFSET }, TIME, restartedOrigin, restartedOrigin)).toEqual({
				status: 'local',
				offsetMs: 0,
			});
		});

		it.each([
			['a few seconds', 5_000, 'unverified', OFFSET],
			['just under a minute', 59_000, 'unverified', OFFSET],
			['over a minute', 61_000, 'local', 0],
		])('applies the webpage tolerance to a webpage correction drifting %s', (_label, drift, status, offsetMs) => {
			const webClock = {
				version: 2,
				offsetMs: OFFSET,
				syncedAtServerMs: TIME + OFFSET,
				rttMs: 20,
				localWallAtSyncMs: TIME,
				// A long-lived tab's monotonic epoch lags Date.now by the drift.
				monotonicEpochAtSyncMs: TIME - drift,
			};
			const workerOrigin = TIME + 10_000;
			expect(offlineClockState(webClock, TIME + 10_000, workerOrigin, workerOrigin)).toEqual({ status, offsetMs });
		});

		it('generates imported webpage codes despite normal tab drift, while keeping the correction', async () => {
			vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
			const cached = {
				...snapshot(),
				clock: {
					version: 2,
					offsetMs: OFFSET,
					syncedAtServerMs: TIME + OFFSET,
					rttMs: 20,
					localWallAtSyncMs: TIME,
					monotonicEpochAtSyncMs: TIME - 5_000,
				},
			};
			const [result] = await generateOfflineCodes(cached, {
				instanceOrigin: ORIGIN,
				accounts: [ACCOUNT],
				now: () => TIME,
				monotonicNow: () => 0,
			});
			expect(result.code).toBe(await generateTotp(SEED, TIME + OFFSET));
		});

		it('records the worker origin with a new correction and verifies it again after a restart', async () => {
			vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
			const fetchImpl = async (url) => json(url.pathname === '/api/secrets' ? [RECORD] : { serverTimeMs: TIME + OFFSET });
			const cached = await loadOfflineSnapshot({ instanceOrigin: ORIGIN, now: () => TIME, fetchImpl });
			expect(cached.clock).toMatchObject({ offsetMs: OFFSET, monotonicOriginMs: TIME });
			expect(offlineClockState(cached.clock, TIME, TIME)).toEqual({ status: 'cached', offsetMs: OFFSET });
			vi.stubGlobal('performance', { timeOrigin: TIME + 60_000, now: () => 0 });
			expect(offlineClockState(cached.clock, TIME + 60_000)).toEqual({ status: 'unverified', offsetMs: OFFSET });
		});

		it('keeps an unverified correction through a temporary time failure without renewing it', async () => {
			vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
			const previousClock = workerClock(TIME - 60_000);
			const updated = { ...RECORD, account: 'updated@example.com' };
			const cached = await loadOfflineSnapshot({
				instanceOrigin: ORIGIN,
				previousClock,
				now: () => TIME,
				fetchImpl: async (url) => (url.pathname === '/api/secrets' ? json([updated]) : json({}, 503)),
			});
			expect(cached.data).toEqual([updated]);
			expect(cached.clock).toEqual(previousClock);
			expect(offlineClockState(cached.clock, TIME, TIME).status).toBe('unverified');
		});
	});
	it('syncs a web-compatible snapshot but exposes only account metadata in lists', async () => {
		const fetchImpl = vi.fn(async (url) => json(url.pathname === '/api/secrets' ? [RECORD] : { serverTimeMs: TIME }));
		const cached = await loadOfflineSnapshot({ instanceOrigin: ORIGIN, fetchImpl });
		expect(cached.data).toEqual([RECORD]);
		expect(cached.clock.version).toBe(2);
		expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/secrets', '/api/time']);
		expect(listOfflineAccounts(cached)).toEqual([expect.objectContaining(ACCOUNT)]);
		expect(JSON.stringify(listOfflineAccounts(cached))).not.toContain(SEED);
	});
	it.each([0, Math.floor(TIME / 1000), Date.UTC(2000, 0, 1) - 1, Date.UTC(2100, 0, 1)])(
		'updates accounts but blocks generation when server time %s cannot be restored from cache',
		async (serverTimeMs) => {
			vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
			const previousClock = {
				version: 2,
				offsetMs: 60000,
				syncedAtServerMs: TIME + 60000,
				localWallAtSyncMs: TIME,
				monotonicEpochAtSyncMs: TIME,
			};
			const updated = { ...RECORD, account: 'updated@example.com' };
			const cached = await loadOfflineSnapshot({
				instanceOrigin: ORIGIN,
				previousClock,
				now: () => TIME,
				fetchImpl: async (url) => json(url.pathname === '/api/secrets' ? [updated] : { serverTimeMs }),
			});
			expect(cached.data).toEqual([updated]);
			expect(cached.clock).toEqual({ error: 'CLOCK_UNAVAILABLE' });
			const generateImpl = vi.fn();
			await expect(generateOfflineCodes(cached, { accounts: listOfflineAccounts(cached), generateImpl })).rejects.toMatchObject({
				code: 'CLOCK_UNAVAILABLE',
			});
			expect(generateImpl).not.toHaveBeenCalled();
		},
	);
	it.each([Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1) - 1])('accepts restorable server-time boundary %s', async (serverTimeMs) => {
		vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
		const cached = await loadOfflineSnapshot({
			instanceOrigin: ORIGIN,
			now: () => TIME,
			fetchImpl: async (url) => json(url.pathname === '/api/secrets' ? [RECORD] : { serverTimeMs }),
		});
		expect(cached.clock).toMatchObject({ version: 2, offsetMs: serverTimeMs - TIME, syncedAtServerMs: serverTimeMs });
	});
	it('keeps the local-time fallback without persisting a rejected first correction', async () => {
		vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
		const cached = await loadOfflineSnapshot({
			instanceOrigin: ORIGIN,
			now: () => TIME,
			fetchImpl: async (url) => json(url.pathname === '/api/secrets' ? [RECORD] : { serverTimeMs: 0 }),
		});
		expect(cached.clock).toBeNull();
		const [result] = await generateOfflineCodes(cached, { accounts: [ACCOUNT], now: () => TIME });
		expect(result.code).toBe(await generateTotp(SEED, TIME));
	});
	it.each([1, 2])('rejects %s local codes while persisted calibration is unavailable', async (count) => {
		const records = Array.from({ length: count }, (_, index) => ({ ...RECORD, id: String(index) }));
		const cached = { data: records, timestamp: TIME, clock: { error: 'CLOCK_UNAVAILABLE' } };
		const generateImpl = vi.fn();
		const accounts = listOfflineAccounts(cached);
		expect(accounts).toHaveLength(count);
		await expect(generateOfflineCodes(cached, { accounts, generateImpl })).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
		expect(generateImpl).not.toHaveBeenCalled();
	});
	it('discards a calculated code when calibration becomes unavailable during generation', async () => {
		const cached = snapshot();
		await expect(
			generateOfflineCodes(cached, {
				accounts: [ACCOUNT],
				now: () => TIME,
				monotonicNow: () => 0,
				generateImpl: async () => {
					cached.clock = { error: 'CLOCK_UNAVAILABLE' };
					return '123456';
				},
			}),
		).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
	});
	it.each([500, 502, 503, 504])('classifies a secrets %s as a temporary failure, preserving the ability to use cache', async (status) => {
		await expect(loadOfflineSnapshot({ instanceOrigin: ORIGIN, fetchImpl: async () => json({}, status) })).rejects.toMatchObject({
			code: 'SOURCE_OFFLINE',
		});
	});
	it.each([500, 502, 503, 504])('applies an empty authoritative account list even when time returns %s', async (status) => {
		const fetchImpl = async (url) => (url.pathname === '/api/secrets' ? json([]) : json({}, status));
		const cached = await loadOfflineSnapshot({ instanceOrigin: ORIGIN, fetchImpl });
		expect(cached.data).toEqual([]);
		expect(cached.clock).toBeNull();
	});
	it.each([
		[401, {}],
		[403, { error: '身份验证失败', message: '请重新登录', timestamp: '2026-01-01T00:00:00.000Z' }],
	])('never treats a time %s as permission to keep a local snapshot', async (status, body) => {
		const fetchImpl = async (url) => (url.pathname === '/api/secrets' ? json([RECORD]) : json(body, status));
		await expect(loadOfflineSnapshot({ instanceOrigin: ORIGIN, fetchImpl })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
	});
	it('keeps the synchronized accounts and correction when a challenge in front of the time endpoint returns 403', async () => {
		vi.stubGlobal('performance', { timeOrigin: TIME, now: () => 0 });
		const previousClock = {
			version: 2,
			offsetMs: 60000,
			syncedAtServerMs: TIME + 60000,
			localWallAtSyncMs: TIME,
			monotonicEpochAtSyncMs: TIME,
			monotonicOriginMs: TIME,
		};
		const challenge = () =>
			new Response('<!DOCTYPE html><title>Just a moment...</title>', {
				status: 403,
				headers: { 'Content-Type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' },
			});
		const cached = await loadOfflineSnapshot({
			instanceOrigin: ORIGIN,
			previousClock,
			now: () => TIME,
			fetchImpl: async (url) => (url.pathname === '/api/secrets' ? json([RECORD]) : challenge()),
		});
		expect(cached.data).toEqual([RECORD]);
		expect(cached.clock).toEqual(previousClock);
	});
	it('does not persist a wrong offset when the wall clock jumps during synchronization', async () => {
		let wall = TIME;
		const fetchImpl = async (url) => {
			if (url.pathname === '/api/secrets') {
				return json([RECORD]);
			}
			wall += 120000;
			return json({ serverTimeMs: TIME });
		};
		const cached = await loadOfflineSnapshot({ instanceOrigin: ORIGIN, fetchImpl, now: () => wall });
		expect(cached.data).toEqual([RECORD]);
		expect(cached.clock).toEqual({ error: 'CLOCK_CHANGED' });
		await expect(generateOfflineCodes(cached, { instanceOrigin: ORIGIN, accounts: [ACCOUNT] })).rejects.toMatchObject({
			code: 'CLOCK_CHANGED',
		});
	});
	it('uses the same cached secrets to calculate successive TOTP windows without fetch', async () => {
		const fetch = vi.fn(() => {
			throw new Error('No network allowed');
		});
		vi.stubGlobal('fetch', fetch);
		const cached = snapshot();
		for (const elapsed of [0, 30000, 60000]) {
			const [result] = await generateOfflineCodes(cached, {
				instanceOrigin: ORIGIN,
				accounts: [ACCOUNT],
				includeNext: true,
				now: () => TIME + elapsed,
				monotonicNow: () => elapsed,
			});
			expect(result.code).toBe(await generateTotp(SEED, TIME + elapsed));
			expect(result.nextCode).toBe(await generateTotp(SEED, TIME + elapsed + 30000));
		}
		expect(fetch).not.toHaveBeenCalled();
	});
	it('waits across a near-expiry boundary using local data only', async () => {
		let wall = Math.floor(TIME / 30000) * 30000 + 29900;
		let mono = 0;
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const checkCurrent = vi.fn(async () => {});
		const [result] = await generateOfflineCodes(snapshot(), {
			instanceOrigin: ORIGIN,
			accounts: [ACCOUNT],
			now: () => wall,
			monotonicNow: () => mono,
			checkCurrent,
			sleep: async (delay) => {
				wall += delay;
				mono += delay;
			},
		});
		expect(result.code).toBe(await generateTotp(SEED, wall));
		expect(checkCurrent.mock.calls.length).toBeGreaterThan(2);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects a result if cache is cleared during asynchronous code generation', async () => {
		let current = true;
		await expect(
			generateOfflineCodes(snapshot(), {
				instanceOrigin: ORIGIN,
				accounts: [ACCOUNT],
				now: () => TIME,
				monotonicNow: () => 0,
				checkCurrent: async () => {
					if (!current) {
						throw Object.assign(new Error('Cache changed'), { code: 'ACCOUNT_CHANGED' });
					}
				},
				generateImpl: async () => {
					current = false;
					return '123456';
				},
			}),
		).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
	});
	it('detects a wall-clock jump between two local requests for the same snapshot', async () => {
		const cached = snapshot();
		await generateOfflineCodes(cached, { instanceOrigin: ORIGIN, accounts: [ACCOUNT], now: () => TIME, monotonicNow: () => 0 });
		await expect(
			generateOfflineCodes(cached, { instanceOrigin: ORIGIN, accounts: [ACCOUNT], now: () => TIME + 30000, monotonicNow: () => 0 }),
		).rejects.toMatchObject({ code: 'CLOCK_CHANGED' });
	});
	it('does not return an old account after its metadata was changed', async () => {
		await expect(
			generateOfflineCodes(
				{ ...snapshot(), data: [{ ...RECORD, account: 'new@example.com' }] },
				{
					instanceOrigin: ORIGIN,
					accounts: [ACCOUNT],
					now: () => TIME,
				},
			),
		).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
	});
});
