import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	loadOfflineSnapshot: vi.fn(),
	listOfflineAccounts: vi.fn(),
	generateOfflineCodes: vi.fn(),
}));

vi.mock('../../extension/src/bridge/api.js', () => api);

const ORIGIN = 'https://twofa.example';
const OTHER_ORIGIN = 'https://another.example';
const NOW = 1_800_000_000_000;
const ACCOUNT = { id: 'test-account', name: 'GitHub', account: 'alice@example.com', type: 'TOTP', digits: 6 };
const SYNTHETIC_SECRET = 'JBSWY3DPEHPK3PXP';
const SERVICE_ICON = 'data:image/png;base64,iVBORw0KGgo=';

let source;
let stored;
let storage;

function snapshot(timestamp = NOW, data = [{ ...ACCOUNT, secret: SYNTHETIC_SECRET, period: 30, algorithm: 'SHA1' }]) {
	return { data, timestamp, clock: { version: 2, serverTimeOffset: 0, synchronizedAt: timestamp } };
}

function validClock(offsetMs = 0, synchronizedAt = NOW) {
	return {
		version: 2,
		offsetMs,
		syncedAtServerMs: synchronizedAt + offsetMs,
		localWallAtSyncMs: synchronizedAt,
		monotonicEpochAtSyncMs: performance.timeOrigin + performance.now(),
	};
}

function error(code) {
	return Object.assign(new Error(code), { code });
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
	stored = {};
	storage = {
		get: vi.fn(async (key) => ({ [key]: structuredClone(stored[key]) })),
		set: vi.fn(async (values) => Object.assign(stored, structuredClone(values))),
		remove: vi.fn(async (key) => delete stored[key]),
	};
	vi.stubGlobal('chrome', { storage: { local: storage } });
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('', { status: 404 })),
	);
	api.loadOfflineSnapshot.mockImplementation(async () => snapshot());
	api.listOfflineAccounts.mockImplementation((value, { withDiagnostics }) => {
		const accounts = value.data.map(({ secret, period, algorithm, ...account }) => account);
		return withDiagnostics ? { accounts, unavailableAccounts: [] } : accounts;
	});
	api.generateOfflineCodes.mockImplementation(async (value, options) => {
		await options.checkCurrent();
		return options.accounts.map((account) => ({
			id: account.id,
			code: '123456',
			digits: 6,
			period: 30,
			generatedAt: Date.now(),
			remainingMs: 20000,
			...(options.includeNext ? { nextCode: '654321' } : {}),
		}));
	});
	source = await import('../../extension/src/background/offline-source.js');
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('extension offline snapshots', () => {
	it.each(['import', 'refresh'])('keeps the vault usable if adding icons exceeds storage quota during %s', async (operation) => {
		storage.set.mockImplementation(async (values) => {
			if (values.offlineCache?.serviceIcons) {
				throw new Error('QUOTA_BYTES quota exceeded');
			}
			Object.assign(stored, structuredClone(values));
		});
		globalThis.fetch.mockResolvedValue(
			new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }),
		);
		if (operation === 'import') {
			await source.importOfflineSource(ORIGIN, snapshot(), { serviceIcons: { 'github.com': SERVICE_ICON } });
		} else {
			await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		}
		await vi.waitFor(() => expect(storage.set.mock.calls.some(([values]) => values.offlineCache?.serviceIcons)).toBe(true));
		expect((await source.readOfflineStatus(ORIGIN)).available).toBe(true);
		expect(stored.offlineCache.snapshot).toEqual(snapshot());
		expect(stored.offlineCache.serviceIcons).toBeUndefined();
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
	});
	it('restores imported service icons after restart and prunes them with removed accounts', async () => {
		await source.importOfflineSource(ORIGIN, snapshot(), { serviceIcons: { 'github.com': SERVICE_ICON } });
		expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON });
		vi.resetModules();
		source = await import('../../extension/src/background/offline-source.js');
		vi.stubGlobal('navigator', { onLine: false });
		const result = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, withDiagnostics: true });
		expect(result.serviceIcons).toEqual({ 'github.com': SERVICE_ICON });
		expect(globalThis.fetch).not.toHaveBeenCalled();
		api.loadOfflineSnapshot.mockResolvedValue(snapshot(NOW + 1, []));
		vi.stubGlobal('navigator', { onLine: true });
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(stored.offlineCache.serviceIcons).toBeUndefined();
	});
	it('automatically caches images without sending login credentials and clears them with the vault', async () => {
		globalThis.fetch.mockResolvedValue(
			new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
				headers: { 'Content-Type': 'image/png' },
			}),
		);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON }));
		expect(globalThis.fetch).toHaveBeenCalledWith(ORIGIN + '/api/favicon/github.com', expect.objectContaining({ credentials: 'omit' }));
		await source.clearOfflineSource(ORIGIN);
		expect(stored.offlineCache).toBeUndefined();
	});
	it('uses an aged cache immediately when the browser explicitly reports offline', async () => {
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: snapshot(NOW - 3600000) };
		vi.stubGlobal('navigator', { onLine: false });
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toHaveLength(1);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});
	it('reports a missing offline cache without trying the network while disconnected', async () => {
		vi.stubGlobal('navigator', { onLine: false });
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'OFFLINE_CACHE_MISSING' });
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});
	it('persists the shared snapshot and only exposes account count, cache time and clock status', async () => {
		const value = snapshot();
		value.untrustedExtra = 'ignored';
		expect(await source.importOfflineSource(ORIGIN, value)).toEqual({
			available: true,
			cachedAt: NOW,
			accountCount: 1,
			clockStatus: 'local',
		});
		expect(stored.offlineCache).toEqual({ instanceOrigin: ORIGIN, snapshot: snapshot() });
		expect(await source.readOfflineStatus(ORIGIN)).toEqual({ available: true, cachedAt: NOW, accountCount: 1, clockStatus: 'local' });
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		value.data[0].secret = 'changed by caller';
		expect(stored.offlineCache.snapshot.data[0].secret).toBe(SYNTHETIC_SECRET);
	});

	it('lists and continuously generates locally even after the sync interval', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		Date.now.mockReturnValue(NOW + 60 * 60 * 1000);
		for (let index = 0; index < 3; index++) {
			expect(
				await source.runOfflineOperation('generate', { instanceOrigin: ORIGIN, id: ACCOUNT.id, metadata: ACCOUNT, includeNext: true }),
			).toMatchObject({ code: '123456', nextCode: '654321' });
		}
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		expect(api.generateOfflineCodes).toHaveBeenCalledTimes(3);
	});

	it('retains the diagnostic list contract and marks the snapshot used', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, withDiagnostics: true })).toEqual({
			accounts: [ACCOUNT],
			unavailableAccounts: [],
			sourceRevision: source.getOfflineSourceRevision(ORIGIN),
			sourceChangeToken: source.getOfflineSourceChangeToken(ORIGIN),
			sourceClockRevision: source.getOfflineClockRevision(ORIGIN),
			offlineStatus: { cachedAt: NOW, usingCache: true, clockStatus: 'local' },
		});
	});

	it('loads a missing snapshot once and shares concurrent initial requests', async () => {
		const load = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(load.promise);
		const first = source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		const second = source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		load.resolve(snapshot());
		expect(await first).toEqual([ACCOUNT]);
		expect(await second).toMatchObject([{ id: ACCOUNT.id, code: '123456' }]);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
	});

	it('restores a persisted snapshot after the service worker restarts without a network request', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		vi.resetModules();
		const restarted = await import('../../extension/src/background/offline-source.js');
		expect(await restarted.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] })).toMatchObject([
			{ id: ACCOUNT.id, code: '123456' },
		]);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it('refreshes on a stale list and replaces a cache with the new snapshot', async () => {
		await source.importOfflineSource(ORIGIN, snapshot(NOW - 300000));
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW);
	});

	it.each(['SOURCE_OFFLINE', 'TIMEOUT', 'REQUEST_TIMEOUT'])('uses stale data after %s and backs off for 30 seconds', async (code) => {
		await source.importOfflineSource(ORIGIN, snapshot(NOW - 300000));
		api.loadOfflineSnapshot.mockRejectedValue(error(code));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		Date.now.mockReturnValue(NOW + 29999);
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		Date.now.mockReturnValue(NOW + 30000);
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
	});

	it('backs off refresh requests without an initial cache and retries after 30 seconds', async () => {
		api.loadOfflineSnapshot.mockRejectedValue(error('SOURCE_OFFLINE'));
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		Date.now.mockReturnValue(NOW + 29999);
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).rejects.toMatchObject({
			code: 'SOURCE_OFFLINE',
		});
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		Date.now.mockReturnValue(NOW + 30000);
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).rejects.toMatchObject({
			code: 'SOURCE_OFFLINE',
		});
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
	});

	it('falls back to the existing snapshot after a failed refresh and keeps local codes usable', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		api.loadOfflineSnapshot.mockRejectedValue(error('SOURCE_OFFLINE'));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).toEqual([ACCOUNT]);
		expect(await source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] })).toHaveLength(1);
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW);
	});

	it.each(['AUTH_REQUIRED', 'INVALID_RESPONSE'])('clears old secrets instead of falling back after %s', async (code) => {
		await source.importOfflineSource(ORIGIN, snapshot(NOW - 300000));
		api.loadOfflineSnapshot.mockRejectedValue(error(code));
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code });
		expect(stored.offlineCache).toBeUndefined();
		expect(await source.readOfflineStatus(ORIGIN)).toEqual({ available: false, cachedAt: null, accountCount: 0 });
	});

	it.each([
		['AUTH_REQUIRED', 401],
		['INVALID_RESPONSE', undefined],
	])('announces only the first actual cache removal during repeated %s failures', async (code, status) => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		api.loadOfflineSnapshot.mockRejectedValue(Object.assign(error(code), { status }));
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).rejects.toMatchObject({ code });
		const revision = source.getOfflineSourceRevision(ORIGIN);
		const clockRevision = source.getOfflineClockRevision(ORIGIN);
		expect(listener).toHaveBeenCalledOnce();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).rejects.toMatchObject({ code });
		}
		await source.clearOfflineSource(ORIGIN);
		expect(listener).toHaveBeenCalledOnce();
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(revision);
		expect(source.getOfflineClockRevision(ORIGIN)).toBe(clockRevision);
		expect(storage.remove).toHaveBeenCalledOnce();
	});

	it.each(['AUTH_REQUIRED', 'INVALID_RESPONSE'])('does not announce an empty cache on a fresh installation after %s', async (code) => {
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		api.loadOfflineSnapshot.mockRejectedValue(error(code));
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).rejects.toMatchObject({ code });
		}
		expect(listener).not.toHaveBeenCalled();
		expect(source.getOfflineSourceRevision(ORIGIN)).toBeNull();
		expect(source.getOfflineClockRevision(ORIGIN)).toBeNull();
		expect(storage.remove).not.toHaveBeenCalled();
	});

	it('announces a cold persisted cache removal once without requiring hydration', async () => {
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: snapshot() };
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		await source.clearOfflineSource(ORIGIN);
		expect(listener).toHaveBeenCalledOnce();
		const revision = source.getOfflineSourceRevision(ORIGIN);
		await source.clearOfflineSource();
		expect(listener).toHaveBeenCalledOnce();
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(revision);
	});

	it('rejects unrelated computation failures instead of treating them as offline access', async () => {
		await source.importOfflineSource(ORIGIN, snapshot(NOW - 300000));
		api.loadOfflineSnapshot.mockRejectedValue(error('INTERNAL_ERROR'));
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
	});

	it('overwrites secrets when the server returns an empty account list', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		api.loadOfflineSnapshot.mockResolvedValue(snapshot(NOW + 1, []));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).toEqual([]);
		expect(await source.readOfflineStatus(ORIGIN)).toEqual({ available: false, cachedAt: NOW + 1, accountCount: 0, clockStatus: 'local' });
		expect(stored.offlineCache.snapshot.data).toEqual([]);
	});

	it('does not expose or use the previous instance cache', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		expect(await source.readOfflineStatus(OTHER_ORIGIN)).toEqual({ available: false, cachedAt: null, accountCount: 0 });
		api.loadOfflineSnapshot.mockRejectedValue(error('SOURCE_OFFLINE'));
		await expect(source.runOfflineOperation('list', { instanceOrigin: OTHER_ORIGIN })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(stored.offlineCache).toBeUndefined();
		expect(api.generateOfflineCodes).not.toHaveBeenCalled();
	});

	it('prevents a late fetch from restoring a cleared cache', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const load = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(load.promise);
		const sync = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		const rejected = expect(sync).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		await source.clearOfflineSource();
		load.resolve(snapshot(NOW + 1));
		await rejected;
		expect(stored.offlineCache).toBeUndefined();
	});

	it('prevents the previous instance fetch from overwriting a newly imported instance', async () => {
		const load = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(load.promise);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		const rejected = expect(listing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		await source.importOfflineSource(OTHER_ORIGIN, snapshot(NOW + 5));
		load.resolve(snapshot(NOW + 1));
		await rejected;
		expect(stored.offlineCache.instanceOrigin).toBe(OTHER_ORIGIN);
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW + 5);
	});

	it('invalidates a pending generation immediately when clear has not finished storage removal', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const revision = source.getOfflineSourceRevision(ORIGIN);
		const clockRevision = source.getOfflineClockRevision(ORIGIN);
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		const waiting = deferred();
		const removing = deferred();
		api.generateOfflineCodes.mockImplementationOnce(async (value, options) => {
			await waiting.promise;
			await options.checkCurrent();
			return [];
		});
		const generation = source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		const rejected = expect(generation).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.generateOfflineCodes).toHaveBeenCalledOnce());
		storage.remove.mockImplementationOnce(async (key) => {
			await removing.promise;
			delete stored[key];
		});
		const clearing = source.clearOfflineSource();
		expect(source.getOfflineSourceRevision(ORIGIN)).not.toBe(revision);
		expect(source.getOfflineClockRevision(ORIGIN)).not.toBe(clockRevision);
		expect(listener).not.toHaveBeenCalled();
		const clearingAgain = source.clearOfflineSource(ORIGIN);
		waiting.resolve();
		await rejected;
		removing.resolve();
		await Promise.all([clearing, clearingAgain]);
		expect(stored.offlineCache).toBeUndefined();
		expect(listener).toHaveBeenCalledOnce();
	});

	it('rejects code generation if synchronization changed account data during computation', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		api.loadOfflineSnapshot.mockResolvedValue(snapshot(NOW + 1, [{ ...snapshot().data[0], secret: 'KRSXG5DSNFXGOIDB' }]));
		const waiting = deferred();
		api.generateOfflineCodes.mockImplementationOnce(async (value, options) => {
			await waiting.promise;
			await options.checkCurrent();
			return [];
		});
		const generation = source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		const rejected = expect(generation).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
		await vi.waitFor(() => expect(api.generateOfflineCodes).toHaveBeenCalledOnce());
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		waiting.resolve();
		await rejected;
	});

	it('does not persist a fetch result received after its caller aborted', async () => {
		const load = deferred();
		const controller = new AbortController();
		api.loadOfflineSnapshot.mockReturnValueOnce(load.promise);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, signal: controller.signal });
		const rejected = expect(listing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		controller.abort();
		load.resolve(snapshot());
		await rejected;
		expect(stored.offlineCache).toBeUndefined();
	});

	it('rolls back a storage write completed after abort without erasing the previous valid snapshot', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const writing = deferred();
		const controller = new AbortController();
		storage.set.mockImplementationOnce(async (values) => {
			await writing.promise;
			Object.assign(stored, structuredClone(values));
		});
		api.loadOfflineSnapshot.mockResolvedValueOnce(snapshot(NOW + 1));
		const sync = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, signal: controller.signal });
		const rejected = expect(sync).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(2));
		controller.abort();
		writing.resolve();
		await rejected;
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW);
	});

	it('can retry an operation after an aborted first cache hydration', async () => {
		const reading = deferred();
		const controller = new AbortController();
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: snapshot() };
		storage.get.mockReturnValueOnce(reading.promise);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, signal: controller.signal });
		const rejected = expect(listing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce());
		controller.abort();
		reading.resolve(structuredClone(stored));
		await rejected;
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it.each([
		{ data: {}, timestamp: NOW },
		{ data: [null], timestamp: NOW },
		{ data: [], timestamp: NaN },
		{ data: [], timestamp: -1 },
		{ data: [], timestamp: NOW, clock: 'invalid' },
		{ data: Array.from({ length: 5001 }, () => ({})), timestamp: NOW },
		{ data: [{ padding: 'x'.repeat(4 * 1024 * 1024) }], timestamp: NOW },
	])('clears a previous cache when an imported snapshot has invalid structure or exceeds limits (#%#)', async (invalid) => {
		await source.importOfflineSource(ORIGIN, snapshot());
		await expect(source.importOfflineSource(ORIGIN, invalid)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
		expect(stored.offlineCache).toBeUndefined();
	});

	it('removes corrupt persisted data instead of retaining or silently trusting it', async () => {
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: { data: 'bad', timestamp: NOW } };
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
		expect(stored.offlineCache).toBeUndefined();
	});

	it('does not clear another instance when removing an obsolete instance cache', async () => {
		await source.importOfflineSource(OTHER_ORIGIN, snapshot());
		await source.clearOfflineSource(ORIGIN);
		expect(await source.runOfflineOperation('list', { instanceOrigin: OTHER_ORIGIN })).toEqual([ACCOUNT]);
		expect(stored.offlineCache.instanceOrigin).toBe(OTHER_ORIGIN);
	});

	it('rejects a stale configuration before an imported webpage snapshot can replace the cache', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const checkConfiguration = vi.fn(async () => {
			throw error('REQUEST_EXPIRED');
		});
		await expect(source.importOfflineSource(OTHER_ORIGIN, snapshot(NOW + 1), { checkConfiguration })).rejects.toMatchObject({
			code: 'REQUEST_EXPIRED',
		});
		expect(stored.offlineCache.instanceOrigin).toBe(ORIGIN);
	});

	it('rechecks configuration after a fetch before persisting any received seeds', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const load = deferred();
		let current = true;
		const checkConfiguration = async () => {
			if (!current) {
				throw error('REQUEST_EXPIRED');
			}
		};
		api.loadOfflineSnapshot.mockReturnValueOnce(load.promise);
		const sync = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, checkConfiguration });
		const rejected = expect(sync).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		current = false;
		load.resolve(snapshot(NOW + 1));
		await rejected;
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW);
	});

	it('rechecks configuration inside offline computation and discards a stale result', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		let current = true;
		const checkConfiguration = async () => {
			if (!current) {
				throw error('REQUEST_EXPIRED');
			}
		};
		api.generateOfflineCodes.mockImplementationOnce(async (value, options) => {
			current = false;
			await options.checkCurrent();
			return [];
		});
		await expect(
			source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT], checkConfiguration }),
		).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it('rolls back a cache write if configuration changes while the browser is persisting it', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		let current = true;
		const checkConfiguration = async () => {
			if (!current) {
				throw error('REQUEST_EXPIRED');
			}
		};
		storage.set.mockImplementationOnce(async (values) => {
			Object.assign(stored, structuredClone(values));
			current = false;
		});
		api.loadOfflineSnapshot.mockResolvedValueOnce(snapshot(NOW + 1));
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, checkConfiguration })).rejects.toMatchObject({
			code: 'REQUEST_EXPIRED',
		});
		expect(stored.offlineCache.snapshot.timestamp).toBe(NOW);
	});

	it('clears a persisted snapshot rejected by the shared account parser', async () => {
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: snapshot() };
		api.listOfflineAccounts.mockImplementationOnce(() => {
			throw error('INVALID_RESPONSE');
		});
		await expect(source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
		expect(stored.offlineCache).toBeUndefined();
	});

	it('rejects invalid origins, operation kinds and inconsistent single-account requests', async () => {
		await expect(source.runOfflineOperation('list', { instanceOrigin: `${ORIGIN}/path` })).rejects.toMatchObject({
			code: 'INVALID_REQUEST',
		});
		await expect(source.runOfflineOperation('unknown', { instanceOrigin: ORIGIN })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		await expect(source.runOfflineOperation('generate', { instanceOrigin: ORIGIN, id: 'wrong', metadata: ACCOUNT })).rejects.toMatchObject({
			code: 'INVALID_REQUEST',
		});
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});
});

describe('fresh interactive offline-cache reads', () => {
	it('invalidates old change tokens immediately while fresh offline lists use the latest token', async () => {
		stored.offlineCache = { instanceOrigin: ORIGIN, snapshot: snapshot() };
		const before = source.getOfflineSourceChangeToken(ORIGIN);
		const otherBefore = source.getOfflineSourceChangeToken(OTHER_ORIGIN);
		source.markOfflineSourceDirty(ORIGIN);
		const changed = source.getOfflineSourceChangeToken(ORIGIN);
		expect(changed).toMatch(/^[a-f0-9]{36}$/);
		expect(changed).not.toBe(before);
		expect(source.getOfflineSourceChangeToken(OTHER_ORIGIN)).toBe(otherBefore);
		vi.stubGlobal('navigator', { onLine: false });
		const listed = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, withDiagnostics: true });
		expect(listed.accounts).toEqual([ACCOUNT]);
		expect(listed.sourceChangeToken).toBe(changed);
		vi.stubGlobal('navigator', { onLine: true });
		api.loadOfflineSnapshot.mockRejectedValueOnce(error('SOURCE_OFFLINE'));
		expect(
			(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, withDiagnostics: true })).sourceChangeToken,
		).toBe(changed);
		Date.now.mockReturnValue(NOW + 30000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(source.getOfflineSourceChangeToken(ORIGIN)).toBe(changed);
	});

	it('refreshes a recent two-account snapshot to one account while default list remains local', async () => {
		const second = { ...snapshot().data[0], id: 'second', account: 'bob@example.com' };
		await source.importOfflineSource(ORIGIN, snapshot(NOW, [...snapshot().data, second]));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toHaveLength(2);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).toEqual([ACCOUNT]);
		expect(stored.offlineCache.snapshot.data).toHaveLength(1);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
	});

	it.each(['forced', 'aged', 'dirty'])('serves cached popup accounts without starting the %s network refresh', async (reason) => {
		await source.importOfflineSource(ORIGIN, snapshot(reason === 'aged' ? NOW - 5 * 60 * 1000 : NOW));
		if (reason === 'dirty') {
			source.markOfflineSourceDirty(ORIGIN);
		}
		api.loadOfflineSnapshot.mockImplementation(() => new Promise(() => {}));
		const result = await source.runOfflineOperation('list', {
			instanceOrigin: ORIGIN,
			preferCache: true,
			refresh: reason === 'forced',
			withDiagnostics: true,
		});
		expect(result).toMatchObject({ accounts: [ACCOUNT], sourceRefreshPending: true });
		expect(result.sourceRevision).toBe(source.getOfflineSourceRevision(ORIGIN));
		expect(result.sourceChangeToken).toBe(source.getOfflineSourceChangeToken(ORIGIN));
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it('keeps cached display, preview renewal and code generation independent of a held refresh', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const loading = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		const syncing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		for (const refresh of [true, false]) {
			const listed = await source.runOfflineOperation('list', {
				instanceOrigin: ORIGIN,
				preferCache: true,
				refresh,
				withDiagnostics: true,
			});
			expect(listed).toMatchObject({ accounts: [ACCOUNT], sourceRefreshPending: true });
			const codes = await source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
			expect(codes[0].code).toBe('123456');
		}
		loading.resolve(snapshot());
		await syncing;
		for (const refresh of [true, false]) {
			const latest = await source.runOfflineOperation('list', {
				instanceOrigin: ORIGIN,
				preferCache: true,
				refresh,
				withDiagnostics: true,
			});
			expect(latest.sourceRefreshPending).toBeUndefined();
		}
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
	});

	it('retains the need for a fresh list when preview renewal precedes the separate refresh request', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const first = await source.runOfflineOperation('list', {
			instanceOrigin: ORIGIN,
			preferCache: true,
			refresh: true,
			withDiagnostics: true,
		});
		expect(first.sourceRefreshPending).toBe(true);
		const renewed = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, preferCache: true, withDiagnostics: true });
		expect(renewed.sourceRefreshPending).toBe(true);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		const latest = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, preferCache: true, withDiagnostics: true });
		expect(latest.sourceRefreshPending).toBeUndefined();
	});

	it.each(['offline', 'backoff'])('makes the cached popup usable without a refresh obligation during %s', async (mode) => {
		await source.importOfflineSource(ORIGIN, snapshot(NOW - 5 * 60 * 1000));
		source.markOfflineSourceDirty(ORIGIN);
		if (mode === 'offline') {
			vi.stubGlobal('navigator', { onLine: false });
		} else {
			api.loadOfflineSnapshot.mockRejectedValueOnce(error('SOURCE_OFFLINE'));
			await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		}
		api.loadOfflineSnapshot.mockClear();
		const result = await source.runOfflineOperation('list', {
			instanceOrigin: ORIGIN,
			preferCache: true,
			refresh: true,
			withDiagnostics: true,
		});
		expect(result.accounts).toEqual([ACCOUNT]);
		expect(result.sourceRefreshPending).toBeUndefined();
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it('still initializes the first snapshot before returning a cache-preferred list', async () => {
		const loading = deferred();
		const finished = vi.fn();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		const listing = source
			.runOfflineOperation('list', { instanceOrigin: ORIGIN, preferCache: true, refresh: true, withDiagnostics: true })
			.then(finished);
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		expect(finished).not.toHaveBeenCalled();
		loading.resolve(snapshot());
		await listing;
		expect(finished.mock.calls[0][0]).toMatchObject({ accounts: [ACCOUNT] });
		expect(finished.mock.calls[0][0].sourceRefreshPending).toBeUndefined();
	});

	it('discards a cache-preferred list when the snapshot is cleared while it is being read', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const entered = deferred();
		const reading = deferred();
		api.listOfflineAccounts.mockImplementationOnce(async () => {
			entered.resolve();
			await reading.promise;
			return { accounts: [ACCOUNT], unavailableAccounts: [] };
		});
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, preferCache: true, refresh: true, withDiagnostics: true });
		const rejected = expect(listing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await entered.promise;
		await source.clearOfflineSource(ORIGIN);
		reading.resolve();
		await rejected;
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it('throttles successful interactive refreshes for one second but dirty hints bypass it', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		Date.now.mockReturnValue(NOW + 999);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		source.markOfflineSourceDirty(ORIGIN);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
		Date.now.mockReturnValue(NOW + 1999);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(3);
	});

	it('serves a cached interactive list immediately while offline even when marked dirty', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		vi.stubGlobal('navigator', { onLine: false });
		source.markOfflineSourceDirty(ORIGIN);
		api.loadOfflineSnapshot.mockImplementation(() => new Promise(() => {}));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).toEqual([ACCOUNT]);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
	});

	it('retains a dirty hint until online refresh can run and respects network-failure backoff', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		source.markOfflineSourceDirty(ORIGIN);
		api.loadOfflineSnapshot.mockRejectedValueOnce(error('SOURCE_OFFLINE'));
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true })).toEqual([ACCOUNT]);
		source.markOfflineSourceDirty(ORIGIN);
		Date.now.mockReturnValue(NOW + 29999);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		Date.now.mockReturnValue(NOW + 30000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
	});

	it.each([true, false])('joins a pending refresh once failure backoff expires with an existing cache: %s', async (hasCache) => {
		if (hasCache) {
			await source.importOfflineSource(ORIGIN, snapshot());
		}
		api.loadOfflineSnapshot.mockRejectedValueOnce(error('SOURCE_OFFLINE'));
		const failed = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		if (hasCache) {
			expect(await failed).toEqual([ACCOUNT]);
		} else {
			await expect(failed).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		}
		const loading = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		Date.now.mockReturnValue(NOW + 30000);
		const syncing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2));
		const completed = vi.fn();
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true }).then(completed);
		for (let turn = 0; turn < 20; turn += 1) {
			await Promise.resolve();
		}
		expect(completed).not.toHaveBeenCalled();
		const second = { ...snapshot().data[0], id: 'second', account: 'bob@example.com' };
		loading.resolve(snapshot(NOW, [...snapshot().data, second]));
		await syncing;
		await listing;
		expect(completed.mock.calls[0][0]).toHaveLength(2);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent refreshes and follows a hint arriving during the shared request', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const loading = deferred();
		const trailing = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise).mockReturnValueOnce(trailing.promise);
		const first = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		const second = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		const firstRejected = expect(first).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
		const secondRejected = expect(second).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		source.markOfflineSourceDirty(ORIGIN);
		loading.resolve(snapshot());
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2));
		Date.now.mockReturnValue(NOW + 1);
		trailing.resolve(snapshot(NOW + 1, []));
		await Promise.all([firstRejected, secondRejected]);
		expect(stored.offlineCache.snapshot.data).toEqual([]);
		const retried = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, withDiagnostics: true });
		expect(retried.accounts).toEqual([]);
		expect(retried.sourceChangeToken).toBe(source.getOfflineSourceChangeToken(ORIGIN));
		expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2);
	});

	it('times out and aborts a cached refresh after 20 seconds without persisting a late response', async () => {
		vi.useFakeTimers();
		await source.importOfflineSource(ORIGIN, snapshot());
		const loading = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.advanceTimersByTimeAsync(0);
		const fetchSignal = api.loadOfflineSnapshot.mock.calls[0][0].signal;
		await vi.advanceTimersByTimeAsync(20000);
		expect(await listing).toEqual([ACCOUNT]);
		expect(fetchSignal.aborted).toBe(true);
		loading.resolve(snapshot(NOW + 10, []));
		await vi.advanceTimersByTimeAsync(0);
		expect(storage.set).toHaveBeenCalledOnce();
		expect(stored.offlineCache.snapshot.data).toHaveLength(1);
		expect(await source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] })).toHaveLength(1);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('maps an internal timeout to cached fallback even if the fetch abort rejects as REQUEST_EXPIRED', async () => {
		vi.useFakeTimers();
		await source.importOfflineSource(ORIGIN, snapshot());
		api.loadOfflineSnapshot.mockImplementation(
			({ signal }) =>
				new Promise((resolve, reject) => {
					signal.addEventListener('abort', () => reject(error('REQUEST_EXPIRED')), { once: true });
				}),
		);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.advanceTimersByTimeAsync(20000);
		expect(await listing).toEqual([ACCOUNT]);
	});

	it('does not turn an external caller abort into a successful cached read', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const controller = new AbortController();
		api.loadOfflineSnapshot.mockImplementation(() => new Promise(() => {}));
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true, signal: controller.signal });
		const rejected = expect(listing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce());
		controller.abort();
		await rejected;
	});

	it('allows a healthy two-second source to refresh an existing cache', async () => {
		vi.useFakeTimers();
		await source.importOfflineSource(ORIGIN, snapshot());
		const loading = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		const finished = vi.fn();
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true }).then(finished);
		await vi.advanceTimersByTimeAsync(2000);
		expect(finished).not.toHaveBeenCalled();
		expect(api.loadOfflineSnapshot.mock.calls[0][0].signal.aborted).toBe(false);
		loading.resolve(snapshot(NOW, []));
		await listing;
		expect(finished).toHaveBeenCalledWith([]);
		expect(stored.offlineCache.snapshot.data).toEqual([]);
	});

	it('does not let a joining reader shorten an account refresh deadline', async () => {
		vi.useFakeTimers();
		await source.importOfflineSource(ORIGIN, snapshot());
		const loading = deferred();
		api.loadOfflineSnapshot.mockReturnValueOnce(loading.promise);
		const syncing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.advanceTimersByTimeAsync(1000);
		const listing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.advanceTimersByTimeAsync(3000);
		expect(api.loadOfflineSnapshot).toHaveBeenCalledOnce();
		expect(api.loadOfflineSnapshot.mock.calls[0][0].signal.aborted).toBe(false);
		loading.resolve(snapshot(NOW, []));
		expect(await syncing).toEqual([]);
		expect(await listing).toEqual([]);
	});

	it('bounds a missing-cache account refresh at twenty seconds', async () => {
		vi.useFakeTimers();
		api.loadOfflineSnapshot.mockImplementation(() => new Promise(() => {}));
		const operation = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		const rejected = expect(operation).rejects.toMatchObject({ code: 'TIMEOUT' });
		await vi.advanceTimersByTimeAsync(20000);
		await rejected;
		expect(api.loadOfflineSnapshot.mock.calls[0][0].signal.aborted).toBe(true);
		expect(stored.offlineCache).toBeUndefined();
	});
});

describe('offline account-data revisions', () => {
	it('keeps a listed revision tied to its account snapshot after later data changes', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const result = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, withDiagnostics: true });
		expect(result.sourceRevision).toBe(source.getOfflineSourceRevision(ORIGIN));
		expect(result.sourceClockRevision).toBe(source.getOfflineClockRevision(ORIGIN));
		api.loadOfflineSnapshot.mockResolvedValueOnce(snapshot(NOW, []));
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(result.accounts).toEqual([ACCOUNT]);
		expect(result.sourceRevision).not.toBe(source.getOfflineSourceRevision(ORIGIN));
	});

	it('does not roll back newer clock metadata when an earlier refresh finishes loading icons', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const image = deferred();
		globalThis.fetch.mockReturnValueOnce(image.promise);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		Date.now.mockReturnValue(NOW + 2000);
		const newer = snapshot(NOW + 2000);
		newer.clock = { error: 'CLOCK_CHANGED' };
		api.loadOfflineSnapshot.mockResolvedValueOnce(newer);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		image.resolve(new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }));
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons?.['github.com']).toBeDefined());
		expect(stored.offlineCache.snapshot).toEqual(newer);
	});

	it('does not cancel local generation for same-offset clock renewal, timestamps, icons or object-key-order changes', async () => {
		await source.importOfflineSource(ORIGIN, { ...snapshot(), clock: validClock() });
		const before = source.getOfflineSourceRevision(ORIGIN);
		const clockBefore = source.getOfflineClockRevision(ORIGIN);
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		const waiting = deferred();
		const original = api.generateOfflineCodes.getMockImplementation();
		api.generateOfflineCodes.mockImplementationOnce(async (value, options) => {
			await waiting.promise;
			return original(value, options);
		});
		const generating = source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		await vi.waitFor(() => expect(api.generateOfflineCodes).toHaveBeenCalledOnce());
		const updated = snapshot(
			NOW + 10,
			snapshot().data.map((entry) => Object.fromEntries(Object.entries(entry).reverse())),
		);
		updated.clock = validClock(0, NOW + 10);
		api.loadOfflineSnapshot.mockResolvedValueOnce(updated);
		globalThis.fetch.mockResolvedValue(
			new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }),
		);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON }));
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(before);
		expect(source.getOfflineClockRevision(ORIGIN)).toBe(clockBefore);
		expect(listener).not.toHaveBeenCalled();
		waiting.resolve();
		expect(await generating).toMatchObject([{ id: ACCOUNT.id, code: '123456' }]);
	});

	it.each([
		['clock error', () => ({ error: 'CLOCK_CHANGED' }), 'CLOCK_CHANGED'],
		['unavailable calibration', () => ({ error: 'CLOCK_UNAVAILABLE' }), 'CLOCK_UNAVAILABLE'],
		['different effective offset', () => validClock(30000), 'ACCOUNT_CHANGED'],
		['missing calibration', () => null, 'ACCOUNT_CHANGED'],
		['invalid calibration', () => ({ version: 2, offsetMs: 'bad' }), 'ACCOUNT_CHANGED'],
	])('rejects in-flight codes after %s without changing the account revision', async (_name, changedClock, code) => {
		await source.importOfflineSource(ORIGIN, { ...snapshot(), clock: validClock() });
		const before = source.getOfflineSourceRevision(ORIGIN);
		const clockBefore = source.getOfflineClockRevision(ORIGIN);
		const listener = vi.fn();
		source.onOfflineSourceChange(listener);
		const waiting = deferred();
		const original = api.generateOfflineCodes.getMockImplementation();
		api.generateOfflineCodes.mockImplementationOnce(async (value, options) => {
			await waiting.promise;
			return original(value, options);
		});
		const generating = source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		const rejected = expect(generating).rejects.toMatchObject({ code });
		await vi.waitFor(() => expect(api.generateOfflineCodes).toHaveBeenCalledOnce());
		api.loadOfflineSnapshot.mockResolvedValueOnce({ ...snapshot(), clock: changedClock() });
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(before);
		expect(source.getOfflineClockRevision(ORIGIN)).not.toBe(clockBefore);
		expect(listener).toHaveBeenCalledExactlyOnceWith({
			instanceOrigin: ORIGIN,
			revision: before,
			clockRevision: source.getOfflineClockRevision(ORIGIN),
		});
		waiting.resolve();
		await rejected;
	});

	it.each(['CLOCK_CHANGED', 'CLOCK_UNAVAILABLE'])('rejects %s at the final boundary of a single-code operation', async (code) => {
		await source.importOfflineSource(ORIGIN, { ...snapshot(), clock: validClock() });
		const waiting = deferred();
		api.generateOfflineCodes.mockImplementationOnce(async () => {
			await waiting.promise;
			return [{ id: ACCOUNT.id, code: '123456' }];
		});
		const generating = source.runOfflineOperation('generate', { instanceOrigin: ORIGIN, id: ACCOUNT.id, metadata: ACCOUNT });
		const rejected = expect(generating).rejects.toMatchObject({ code });
		await vi.waitFor(() => expect(api.generateOfflineCodes).toHaveBeenCalledOnce());
		api.loadOfflineSnapshot.mockResolvedValueOnce({ ...snapshot(), clock: { error: code } });
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		waiting.resolve();
		await rejected;
	});
	it('restores the calibration block after a worker restart without discarding account metadata', async () => {
		await source.importOfflineSource(ORIGIN, { ...snapshot(), clock: { error: 'CLOCK_UNAVAILABLE' } });
		vi.resetModules();
		source = await import('../../extension/src/background/offline-source.js');
		vi.stubGlobal('navigator', { onLine: false });
		expect(await source.readOfflineStatus(ORIGIN)).toEqual({
			available: true,
			cachedAt: NOW,
			accountCount: 1,
			clockStatus: 'unavailable',
		});
		expect(await source.runOfflineOperation('list', { instanceOrigin: ORIGIN })).toEqual([ACCOUNT]);
		for (const kind of ['generate', 'generateMany']) {
			await expect(
				source.runOfflineOperation(kind, { instanceOrigin: ORIGIN, id: ACCOUNT.id, metadata: ACCOUNT, accounts: [ACCOUNT] }),
			).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
		}
		expect(api.generateOfflineCodes).not.toHaveBeenCalled();
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		expect(stored.offlineCache.snapshot.data).toEqual(snapshot().data);
	});

	it.each(['metadata', 'secret', 'diagnostics'])('changes its opaque revision only when %s changes', async (kind) => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const before = source.getOfflineSourceRevision(ORIGIN);
		expect(before).toMatch(/^[a-f0-9]{36}$/);
		const updated = snapshot(NOW + 1);
		if (kind === 'metadata') {
			updated.data[0].name = 'Renamed';
		}
		if (kind === 'secret') {
			updated.data[0].secret = 'KRSXG5DSNFXGOIDB';
		}
		if (kind === 'diagnostics') {
			updated.diagnostics = [{ id: 'bad', reason: 'unsupported' }];
		}
		api.loadOfflineSnapshot.mockResolvedValueOnce(updated);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(source.getOfflineSourceRevision(ORIGIN)).not.toBe(before);
	});

	it('emits metadata-only changes for import, changed data and clear, isolating failing observers', async () => {
		const listener = vi.fn();
		const unsubscribe = source.onOfflineSourceChange(listener);
		source.onOfflineSourceChange(() => {
			throw new Error('listener failed');
		});
		source.onOfflineSourceChange(async () => {
			throw new Error('async listener failed');
		});
		await source.importOfflineSource(ORIGIN, snapshot());
		const before = source.getOfflineSourceRevision(ORIGIN);
		expect(listener).toHaveBeenCalledExactlyOnceWith({
			instanceOrigin: ORIGIN,
			revision: before,
			clockRevision: source.getOfflineClockRevision(ORIGIN),
		});
		await source.importOfflineSource(ORIGIN, snapshot(NOW + 1));
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(before);
		expect(listener).toHaveBeenCalledTimes(2);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(listener).toHaveBeenCalledTimes(2);
		await source.clearOfflineSource(ORIGIN);
		expect(source.getOfflineSourceRevision(ORIGIN)).not.toBe(before);
		expect(listener).toHaveBeenCalledTimes(3);
		expect(Object.keys(listener.mock.calls[2][0]).sort()).toEqual(['clockRevision', 'instanceOrigin', 'revision']);
		unsubscribe();
		await source.importOfflineSource(ORIGIN, snapshot());
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it('hydrates without announcing a change and assigns a new opaque token after worker restart', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		const before = source.getOfflineSourceRevision(ORIGIN);
		vi.resetModules();
		const restarted = await import('../../extension/src/background/offline-source.js');
		const listener = vi.fn();
		restarted.onOfflineSourceChange(listener);
		expect(restarted.getOfflineSourceRevision(ORIGIN)).toBeNull();
		await restarted.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		expect(restarted.getOfflineSourceRevision(ORIGIN)).toMatch(/^[a-f0-9]{36}$/);
		expect(restarted.getOfflineSourceRevision(ORIGIN)).not.toBe(before);
		expect(listener).not.toHaveBeenCalled();
	});
});

describe('automatic optional service icons', () => {
	function imageResponse() {
		return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } });
	}
	it('returns accounts and usable codes while icons are slow; icon-only completion preserves flow revisions', async () => {
		const image = deferred();
		globalThis.fetch.mockImplementation(() => image.promise);
		const changes = vi.fn();
		const icons = vi.fn();
		source.onOfflineSourceChange(changes);
		source.onOfflineIconsChange(icons);
		const flow = await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, withDiagnostics: true });
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		expect(await source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] })).toHaveLength(1);
		const changesBefore = changes.mock.calls.length;
		image.resolve(imageResponse());
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON }));
		expect(icons).toHaveBeenCalledExactlyOnceWith({ instanceOrigin: ORIGIN });
		expect(changes).toHaveBeenCalledTimes(changesBefore);
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(flow.sourceRevision);
		expect(source.getOfflineClockRevision(ORIGIN)).toBe(flow.sourceClockRevision);
		expect(source.getOfflineSourceChangeToken(ORIGIN)).toBe(flow.sourceChangeToken);
		expect(await source.readOfflineIcons(ORIGIN)).toEqual({ 'github.com': SERVICE_ICON });
	});
	it('coalesces icon maintenance across account refreshes, preserves newer vault data, and fills new domains', async () => {
		const image = deferred();
		globalThis.fetch.mockImplementation((url) => (url.endsWith('/github.com') ? image.promise : Promise.resolve(imageResponse())));
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		const newAccount = { ...ACCOUNT, id: 'new', name: 'Google' };
		const newer = snapshot(NOW + 2000, [
			{ ...ACCOUNT, secret: SYNTHETIC_SECRET },
			{ ...newAccount, secret: SYNTHETIC_SECRET },
		]);
		api.loadOfflineSnapshot.mockResolvedValue(newer);
		Date.now.mockReturnValue(NOW + 2000);
		const refreshing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(stored.offlineCache.snapshot).toEqual(newer));
		image.resolve(imageResponse());
		await refreshing;
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON, 'google.com': SERVICE_ICON }));
		expect(stored.offlineCache.snapshot).toEqual(newer);
		expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
			ORIGIN + '/api/favicon/github.com',
			ORIGIN + '/api/favicon/google.com',
		]);
		Date.now.mockReturnValue(NOW + 4000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});
	it('backs off failed domains, tries new domains immediately, and retries failures after five minutes', async () => {
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
		Date.now.mockReturnValue(NOW + 2000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		api.loadOfflineSnapshot.mockResolvedValue(
			snapshot(NOW + 1, [
				{ ...ACCOUNT, secret: SYNTHETIC_SECRET },
				{ ...ACCOUNT, id: 'g', name: 'Google', secret: SYNTHETIC_SECRET },
			]),
		);
		globalThis.fetch.mockImplementation(async (url) => (url.endsWith('/google.com') ? imageResponse() : new Response('', { status: 404 })));
		Date.now.mockReturnValue(NOW + 4000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'google.com': SERVICE_ICON }));
		expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
			ORIGIN + '/api/favicon/github.com',
			ORIGIN + '/api/favicon/google.com',
		]);
		Date.now.mockReturnValue(NOW + 5 * 60 * 1000);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
		expect(globalThis.fetch.mock.calls[2][0]).toBe(ORIGIN + '/api/favicon/github.com');
	});
	it('never starts icon downloads on imported cache, offline reads, or failed online cache fallback', async () => {
		await source.importOfflineSource(ORIGIN, snapshot());
		await source.readOfflineIcons(ORIGIN);
		vi.stubGlobal('navigator', { onLine: false });
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		vi.stubGlobal('navigator', { onLine: true });
		api.loadOfflineSnapshot.mockRejectedValue(error('SOURCE_OFFLINE'));
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await source.runOfflineOperation('generateMany', { instanceOrigin: ORIGIN, accounts: [ACCOUNT] });
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
	it.each(['clear', 'switch', 'import', 'revoke'])(
		'cancels the in-flight request immediately on %s and rejects its late response',
		async (action) => {
			const image = deferred();
			globalThis.fetch.mockImplementation(() => image.promise);
			await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
			await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
			const signal = globalThis.fetch.mock.calls[0][1].signal;
			if (action === 'clear') {
				await source.clearOfflineSource();
			}
			if (action === 'switch') {
				await source.readOfflineIcons(OTHER_ORIGIN);
			}
			if (action === 'import') {
				await source.importOfflineSource(ORIGIN, snapshot(NOW + 2));
			}
			if (action === 'revoke') {
				source.cancelOfflineIconSync();
			}
			expect(signal.aborted).toBe(true);
			image.resolve(imageResponse());
			for (let i = 0; i < 20; i++) {
				await Promise.resolve();
			}
			expect(stored.offlineCache?.serviceIcons).toBeUndefined();
			if (action === 'clear' || action === 'switch') {
				expect(stored.offlineCache).toBeUndefined();
			}
			if (action === 'import') {
				expect(stored.offlineCache.snapshot.timestamp).toBe(NOW + 2);
			}
		},
	);
	it('does not erase existing vault images or revisions when optional persistence exceeds quota', async () => {
		const newAccount = { ...ACCOUNT, id: 'g', name: 'Google', secret: SYNTHETIC_SECRET };
		await source.importOfflineSource(ORIGIN, snapshot(NOW, [{ ...ACCOUNT, secret: SYNTHETIC_SECRET }, newAccount]), {
			serviceIcons: { 'github.com': SERVICE_ICON },
		});
		api.loadOfflineSnapshot.mockResolvedValue(snapshot(NOW, [{ ...ACCOUNT, secret: SYNTHETIC_SECRET }, newAccount]));
		const originalSet = storage.set.getMockImplementation();
		storage.set.mockImplementation((values) =>
			values.offlineCache.serviceIcons?.['google.com'] ? Promise.reject(new Error('quota')) : originalSet(values),
		);
		globalThis.fetch.mockImplementation(async () => imageResponse());
		const revision = source.getOfflineSourceRevision(ORIGIN);
		await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
		await vi.waitFor(() => expect(storage.set.mock.calls.some(([values]) => values.offlineCache.serviceIcons?.['google.com'])).toBe(true));
		await source.readOfflineStatus(ORIGIN);
		expect(stored.offlineCache.snapshot.data).toHaveLength(2);
		expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON });
		expect(source.getOfflineSourceRevision(ORIGIN)).toBe(revision);
	});
	it('serves only allowed data images from local cache without starting network work', async () => {
		stored.offlineCache = {
			instanceOrigin: ORIGIN,
			snapshot: snapshot(),
			serviceIcons: { 'github.com': SERVICE_ICON, 'google.com': SERVICE_ICON, 'evil.example': 'https://evil.example/a.png' },
		};
		const icons = await source.readOfflineIcons(ORIGIN);
		expect(icons).toEqual({ 'github.com': SERVICE_ICON });
		expect(JSON.stringify(icons)).not.toContain(SYNTHETIC_SECRET);
		expect(api.loadOfflineSnapshot).not.toHaveBeenCalled();
		expect(globalThis.fetch).not.toHaveBeenCalled();
		await expect(
			source.readOfflineIcons(ORIGIN, {
				checkConfiguration: () => {
					throw error('REQUEST_EXPIRED');
				},
			}),
		).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});
});

it('keeps a completed icon write when an account refresh was queued behind it with older icons', async () => {
	const response = deferred();
	const writing = deferred();
	const releaseWrite = deferred();
	globalThis.fetch.mockImplementation(() => response.promise);
	await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
	const originalSet = storage.set.getMockImplementation();
	let delayed = false;
	storage.set.mockImplementation(async (values) => {
		if (values.offlineCache.serviceIcons && !delayed) {
			delayed = true;
			writing.resolve();
			await releaseWrite.promise;
		}
		await originalSet(values);
	});
	response.resolve(new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }));
	await writing.promise;
	const newer = snapshot(NOW + 2000, [{ ...ACCOUNT, account: 'renamed@example.com', secret: SYNTHETIC_SECRET }]);
	api.loadOfflineSnapshot.mockResolvedValue(newer);
	Date.now.mockReturnValue(NOW + 2000);
	const syncing = source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
	await vi.waitFor(() => expect(api.loadOfflineSnapshot).toHaveBeenCalledTimes(2));
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
	releaseWrite.resolve();
	await syncing;
	expect(stored.offlineCache.snapshot).toEqual(newer);
	expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON });
	expect(globalThis.fetch).toHaveBeenCalledOnce();
});
it('rolls back an optional in-progress storage write when permission is revoked', async () => {
	const writing = deferred();
	const releaseWrite = deferred();
	const originalSet = storage.set.getMockImplementation();
	storage.set.mockImplementation(async (values) => {
		if (values.offlineCache.serviceIcons) {
			writing.resolve();
			await releaseWrite.promise;
		}
		await originalSet(values);
	});
	globalThis.fetch.mockImplementation(
		async () => new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }),
	);
	await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
	await writing.promise;
	source.cancelOfflineIconSync();
	const clearing = source.clearOfflineSource();
	releaseWrite.resolve();
	await clearing;
	expect(stored.offlineCache).toBeUndefined();
});

it('retries cancelled missing icons after a same-instance settings change without the failure cooldown', async () => {
	const image = deferred();
	globalThis.fetch.mockImplementation(() => image.promise);
	await source.runOfflineOperation('list', { instanceOrigin: ORIGIN });
	await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
	source.cancelOfflineIconSync();
	globalThis.fetch.mockImplementation(
		async () => new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } }),
	);
	Date.now.mockReturnValue(NOW + 2000);
	await source.runOfflineOperation('list', { instanceOrigin: ORIGIN, refresh: true });
	await vi.waitFor(() => expect(stored.offlineCache.serviceIcons).toEqual({ 'github.com': SERVICE_ICON }));
	expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});
