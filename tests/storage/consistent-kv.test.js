import { describe, expect, it } from 'vitest';
import { CONSISTENT_KV_CHUNK_LENGTH, createConsistentKV } from '../../src/storage/consistent-kv.js';
import { FakeKV, FakeStorage } from '../helpers/store-fakes.js';

const STORE_ID = 'store-secrets';

function setup() {
	const kv = new FakeKV();
	const storage = new FakeStorage();
	const view = createConsistentKV({
		kv,
		storage,
		storeId: STORE_ID,
		isOwnedKey: (key) => key === 'secrets' || key.startsWith('hotp-counter:'),
	});
	return { kv, storage, view };
}

describe('createConsistentKV', () => {
	it('adopts the value already in KV on first read', async () => {
		const { kv, view } = setup();
		await kv.put('secrets', 'v0');
		expect(await view.get('secrets', 'text')).toBe('v0');
		expect(await view.get('secrets')).toBe('v0');
	});

	it('tags each write with the store id and a new revision', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		await view.put('secrets', 'v2');
		expect(kv.store.get('secrets')).toEqual({ value: 'v2', metadata: { storeId: STORE_ID, storeRevision: 2 } });
	});

	it('returns its own latest write when KV serves an older revision', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		await view.put('secrets', 'v2');
		kv.serveStale('secrets', 'v1', { storeId: STORE_ID, storeRevision: 1 });
		expect(await view.get('secrets', 'text')).toBe('v2');
	});

	it('ignores a stale copy of the value it adopted before its first write', async () => {
		const { kv, view } = setup();
		await kv.put('secrets', 'v0');
		expect(await view.get('secrets')).toBe('v0');
		await view.put('secrets', 'v1');
		kv.serveStale('secrets', 'v0');
		expect(await view.get('secrets')).toBe('v1');
	});

	it('records what KV holds before a first write that was not preceded by a read', async () => {
		const { kv, view } = setup();
		await kv.put('hotp-counter:e:a', 'old');
		await view.put('hotp-counter:e:a', 'new');
		kv.serveStale('hotp-counter:e:a', 'old');
		expect(await view.get('hotp-counter:e:a')).toBe('new');

		// A key that did not exist: a cached "missing" answer must not undo the write.
		await view.put('hotp-counter:e:b', 'created');
		kv.serveStale('hotp-counter:e:b', null);
		expect(await view.get('hotp-counter:e:b')).toBe('created');
	});

	it('adopts a value written outside the store, such as by an earlier release after a rollback', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		await kv.put('secrets', 'written-by-old-release');
		expect(await view.get('secrets')).toBe('written-by-old-release');

		// The adopted value is kept even when KV then serves an older revision of the store.
		kv.serveStale('secrets', 'v1', { storeId: STORE_ID, storeRevision: 1 });
		expect(await view.get('secrets')).toBe('written-by-old-release');

		await view.put('secrets', 'v2');
		expect(kv.store.get('secrets').metadata).toEqual({ storeId: STORE_ID, storeRevision: 2 });
	});

	it('treats a revision from another store as a write from outside', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		await kv.put('secrets', 'other-store', { metadata: { storeId: 'another', storeRevision: 9 } });
		expect(await view.get('secrets')).toBe('other-store');
	});

	it('uses KV when the storage update after a KV write was lost', async () => {
		const { kv, storage, view } = setup();
		await view.put('secrets', 'v1');
		storage.failNextPut = true;
		await expect(view.put('secrets', 'v2')).rejects.toThrow('storage unavailable');
		expect(kv.store.get('secrets').value).toBe('v2');
		expect(await view.get('secrets')).toBe('v2');
		await view.put('secrets', 'v3');
		expect(kv.store.get('secrets').metadata.storeRevision).toBe(3);
	});

	it('leaves its copy unchanged when the KV write fails', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		kv.beforeOperation = async (kind) => {
			if (kind === 'put') {
				throw new Error('kv down');
			}
		};
		await expect(view.put('secrets', 'v2')).rejects.toThrow('kv down');
		kv.beforeOperation = null;
		expect(await view.get('secrets')).toBe('v1');
	});

	it('keeps a deletion even when KV still serves the deleted value', async () => {
		const { kv, view } = setup();
		await view.put('hotp-counter:e:a', '{"counter":1}');
		await view.delete('hotp-counter:e:a');
		expect(kv.store.has('hotp-counter:e:a')).toBe(false);
		kv.serveStale('hotp-counter:e:a', '{"counter":1}', { storeId: STORE_ID, storeRevision: 1 });
		expect(await view.get('hotp-counter:e:a')).toBeNull();
		expect(await view.get('hotp-counter:e:a')).toBeNull();
	});

	it('keeps its value when KV answers that the key is missing', async () => {
		const { kv, view } = setup();
		await view.put('secrets', 'v1');
		kv.serveStale('secrets', null);
		expect(await view.get('secrets')).toBe('v1');
	});

	it('stores long values in several chunks and removes chunks that are no longer used', async () => {
		const { kv, storage, view } = setup();
		const long = 'a'.repeat(CONSISTENT_KV_CHUNK_LENGTH * 2) + 'tail';
		await view.put('secrets', long);
		expect([...storage.data.keys()].filter((key) => key.startsWith('kv-chunk:secrets:'))).toHaveLength(3);
		kv.serveStale('secrets', null);
		expect(await view.get('secrets')).toBe(long);

		await view.put('secrets', 'short');
		expect([...storage.data.keys()].filter((key) => key.startsWith('kv-chunk:secrets:'))).toEqual(['kv-chunk:secrets:0']);
		expect(await view.get('secrets')).toBe('short');
	});

	it('stores an empty string as a value, not as a missing key', async () => {
		const { view } = setup();
		await view.put('secrets', '');
		expect(await view.get('secrets')).toBe('');
	});

	it('parses owned values read as JSON', async () => {
		const { view } = setup();
		await view.put('secrets', '[{"id":"a"}]');
		expect(await view.get('secrets', 'json')).toEqual([{ id: 'a' }]);
		expect(await view.get('secrets', { type: 'json' })).toEqual([{ id: 'a' }]);
	});

	it('answers bulk reads that mix owned and other keys', async () => {
		const { kv, view } = setup();
		await view.put('hotp-counter:e:a', 'stale');
		await view.put('hotp-counter:e:a', 'A');
		await kv.put('plain', 'P');
		kv.serveStale('hotp-counter:e:a', 'stale', { storeId: STORE_ID, storeRevision: 1 });
		const values = await view.get(['hotp-counter:e:a', 'plain', 'hotp-counter:e:missing'], 'text');
		expect(values).toBeInstanceOf(Map);
		expect([...values]).toEqual([
			['hotp-counter:e:a', 'A'],
			['plain', 'P'],
			['hotp-counter:e:missing', null],
		]);
	});

	it('reads owned keys with one KV request per 100 keys', async () => {
		const { kv, view } = setup();
		const keys = Array.from({ length: 250 }, (_, index) => `hotp-counter:e:${index}`);
		await view.put(keys[0], 'stale');
		await view.put(keys[0], 'A');
		kv.serveStale(keys[0], 'stale', { storeId: STORE_ID, storeRevision: 1 });
		await kv.put(keys[1], 'written elsewhere');
		const requests = [];
		const getWithMetadata = kv.getWithMetadata.bind(kv);
		kv.getWithMetadata = (keyOrKeys, type) => {
			requests.push(Array.isArray(keyOrKeys) ? keyOrKeys.length : 1);
			return getWithMetadata(keyOrKeys, type);
		};
		const values = await view.get(keys, 'text');
		expect(requests).toEqual([100, 100, 50]);
		expect(values.size).toBe(250);
		expect(values.get(keys[0])).toBe('A');
		expect(values.get(keys[1])).toBe('written elsewhere');
		expect(values.get(keys[2])).toBeNull();
	});

	it('passes other keys straight to KV', async () => {
		const { kv, storage, view } = setup();
		await view.put('ratelimit:x', '1', { expirationTtl: 60 });
		expect(kv.puts.at(-1)).toEqual({ key: 'ratelimit:x', value: '1', options: { expirationTtl: 60 } });
		expect(await view.get('ratelimit:x')).toBe('1');
		await view.delete('ratelimit:x');
		expect(kv.store.has('ratelimit:x')).toBe(false);
		expect(storage.data.size).toBe(0);
		expect((await view.list({ prefix: '' })).keys).toEqual([]);
	});

	it('rejects values that are not text for owned keys', async () => {
		const { view } = setup();
		await expect(view.put('secrets', new ArrayBuffer(1))).rejects.toThrow(TypeError);
	});
});
