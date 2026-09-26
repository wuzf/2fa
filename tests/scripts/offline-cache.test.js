import { describe, expect, it } from 'vitest';

import { getOfflineClockCode, getOfflineSecretsCode } from '../../src/ui/scripts/offlineCache.js';

// The web page and extension build evaluate these emitted declarations in their
// own script. Exercise the public functions without depending on either host.
// eslint-disable-next-line no-new-func
const { parseOfflineSecretsCache, parseOfflineClockCache } = new Function(
	`${getOfflineSecretsCode()}${getOfflineClockCode()}; return { parseOfflineSecretsCache, parseOfflineClockCache };`,
)();

const BASE_MS = Date.UTC(2026, 0, 1);

function cachedClock(overrides = {}) {
	return {
		version: 2,
		offsetMs: 1500,
		syncedAtServerMs: BASE_MS + 1500,
		rttMs: 20,
		localWallAtSyncMs: BASE_MS,
		monotonicEpochAtSyncMs: BASE_MS,
		...overrides,
	};
}

describe('shared offline secrets cache reader', () => {
	it('reads the existing web cache format without changing account fields', () => {
		const account = { id: 'test', name: 'Example', account: 'alice', secret: 'JBSWY3DPEHPK3PXP', type: 'HOTP', counter: 7 };
		const raw = JSON.stringify({ data: [account], timestamp: BASE_MS, ignored: 'extra' });
		expect(parseOfflineSecretsCache(raw)).toEqual({ data: [account], timestamp: BASE_MS });
	});

	it('accepts empty caches and the epoch timestamp', () => {
		expect(parseOfflineSecretsCache('{"data":[],"timestamp":0}')).toEqual({ data: [], timestamp: 0 });
	});

	it('returns independent snapshots for separate reads', () => {
		const raw = JSON.stringify({ data: [{ id: 'test' }], timestamp: BASE_MS });
		const first = parseOfflineSecretsCache(raw);
		first.data[0].id = 'changed';
		expect(parseOfflineSecretsCache(raw).data[0].id).toBe('test');
	});

	it.each([
		null,
		undefined,
		{},
		'',
		'{',
		'null',
		'[]',
		'{"data":{},"timestamp":0}',
		'{"data":[]}',
		'{"data":[],"timestamp":-1}',
		'{"data":[],"timestamp":"123"}',
		'{"data":[],"timestamp":1e309}',
	])('rejects invalid persisted data: %j', (raw) => {
		expect(parseOfflineSecretsCache(raw)).toBeNull();
	});

	it('accepts the extension account limit and rejects a larger cache', () => {
		const data = Array.from({ length: 5000 }, (_, id) => ({ id: String(id) }));
		expect(parseOfflineSecretsCache(JSON.stringify({ data, timestamp: BASE_MS })).data).toHaveLength(5000);
		data.push({ id: 'overflow' });
		expect(parseOfflineSecretsCache(JSON.stringify({ data, timestamp: BASE_MS }))).toBeNull();
	});
});

describe('shared offline clock cache reader', () => {
	it('restores a version 2 clock after equal wall and monotonic elapsed time', () => {
		const snapshot = cachedClock();
		expect(parseOfflineClockCache(JSON.stringify(snapshot), BASE_MS + 3600000, BASE_MS + 3600000)).toEqual(snapshot);
	});

	it('retains old but consistent snapshots for offline use', () => {
		const snapshot = cachedClock();
		const later = BASE_MS + 30 * 24 * 60 * 60 * 1000;
		expect(parseOfflineClockCache(JSON.stringify(snapshot), later, later)).toEqual(snapshot);
	});

	it('preserves the 60-second observed drift tolerance and rejects larger clock jumps', () => {
		const raw = JSON.stringify(cachedClock());
		expect(parseOfflineClockCache(raw, BASE_MS + 60000, BASE_MS)).not.toBeNull();
		expect(parseOfflineClockCache(raw, BASE_MS + 60001, BASE_MS)).toBeNull();
		expect(parseOfflineClockCache(raw, BASE_MS, BASE_MS + 60001)).toBeNull();
	});

	it('rejects snapshots placing the current time more than five minutes before the last sync', () => {
		const raw = JSON.stringify(cachedClock());
		expect(parseOfflineClockCache(raw, BASE_MS - 300000, BASE_MS - 300000)).not.toBeNull();
		expect(parseOfflineClockCache(raw, BASE_MS - 300001, BASE_MS - 300001)).toBeNull();
	});

	it('drops unsupported properties and normalizes unavailable latency', () => {
		const snapshot = cachedClock({ rttMs: 'unknown', ignored: 'extra' });
		expect(parseOfflineClockCache(JSON.stringify(snapshot), BASE_MS, BASE_MS)).toEqual(cachedClock({ rttMs: null }));
	});

	it.each([
		{ version: 1 },
		{ version: '2' },
		{ offsetMs: null },
		{ offsetMs: '1500' },
		{ syncedAtServerMs: null },
		{ localWallAtSyncMs: Date.UTC(1999, 11, 31) },
		{ monotonicEpochAtSyncMs: Date.UTC(2100, 0, 1) },
		{ offsetMs: Date.UTC(2100, 0, 1) - BASE_MS },
	])('rejects unsupported schemas and invalid clock fields: %j', (overrides) => {
		expect(parseOfflineClockCache(JSON.stringify(cachedClock(overrides)), BASE_MS, BASE_MS)).toBeNull();
	});

	it.each([null, undefined, {}, '', '{', 'null', '[]', '{}'])('rejects invalid serialized clocks: %j', (raw) => {
		expect(parseOfflineClockCache(raw, BASE_MS, BASE_MS)).toBeNull();
	});

	it.each([
		[NaN, BASE_MS],
		[Infinity, BASE_MS],
		[BASE_MS, NaN],
		[BASE_MS, Infinity],
		[BASE_MS, null],
		[BASE_MS, undefined],
	])('rejects unavailable current clocks (%s, %s)', (wallNow, monotonicEpochNow) => {
		expect(parseOfflineClockCache(JSON.stringify(cachedClock()), wallNow, monotonicEpochNow)).toBeNull();
	});
});
