/**
 * Read-your-writes view of Workers KV for the keys the secrets store owns.
 *
 * Workers KV is eventually consistent: for up to a minute a read can return a
 * value older than the latest write, even in the location that made the write.
 * The secrets store therefore keeps the latest value of every owned key in its
 * Durable Object storage and mirrors each write to KV, tagging the KV value with
 * the store id and a per-key revision in the KV metadata. A read compares both:
 *
 * - KV carries a revision of this store: an older revision is a stale read and
 *   the stored copy wins; a newer one means the storage update that follows a
 *   KV write was lost, so KV wins.
 * - KV carries no revision of this store: the value was written elsewhere,
 *   typically by an earlier release after a rollback, and is adopted. A value
 *   whose fingerprint was already seen is a stale copy of an adopted value and
 *   is ignored, as is a missing key while the store holds a value.
 *
 * KV keeps the complete data, so earlier releases and the fallback path without
 * the Durable Object keep reading it unchanged.
 */

const STATE_PREFIX = 'kv-state:';
const CHUNK_PREFIX = 'kv-chunk:';
// Characters per storage value. Stays below the 2 MB value limit even for text
// that is serialized with two bytes per character.
export const CONSISTENT_KV_CHUNK_LENGTH = 256 * 1024;
const STORAGE_BATCH_SIZE = 128;
// Keys per bulk KV read, the platform maximum.
const KV_BULK_READ_SIZE = 100;
const MAX_FOREIGN_FINGERPRINTS = 8;
const ABSENT_FINGERPRINT_INPUT = '\u0000absent';

function readType(typeOrOptions) {
	const type = typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type;
	return type || 'text';
}

function decodeValue(value, type) {
	if (value === null) {
		return null;
	}
	if (type === 'text') {
		return value;
	}
	if (type === 'json') {
		return JSON.parse(value);
	}
	throw new TypeError(`受保护的存储键不支持以 ${type} 格式读取`);
}

async function fingerprint(value) {
	const bytes = new TextEncoder().encode(value === null ? ABSENT_FINGERPRINT_INPUT : value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function chunkKeys(key, from, to) {
	const keys = [];
	for (let index = from; index < to; index++) {
		keys.push(`${CHUNK_PREFIX}${key}:${index}`);
	}
	return keys;
}

async function getStorageValues(storage, keys) {
	const values = new Map();
	for (let index = 0; index < keys.length; index += STORAGE_BATCH_SIZE) {
		const batch = await storage.get(keys.slice(index, index + STORAGE_BATCH_SIZE));
		for (const [name, value] of batch) {
			values.set(name, value);
		}
	}
	return values;
}

/**
 * @param {Object} options
 * @param {Object} options.kv - the Workers KV binding
 * @param {Object} options.storage - Durable Object storage (key-value API)
 * @param {string} options.storeId - id of the Durable Object that owns the keys
 * @param {(key: string) => boolean} options.isOwnedKey - keys read and written consistently
 * @param {Object} [options.logger]
 */
export function createConsistentKV({ kv, storage, storeId, isOwnedKey, logger }) {
	async function loadState(key) {
		const state = await storage.get(STATE_PREFIX + key);
		if (!state) {
			return null;
		}
		let value = null;
		if (state.present) {
			const keys = chunkKeys(key, 0, state.chunks);
			const parts = await getStorageValues(storage, keys);
			const pieces = keys.map((name) => parts.get(name));
			if (pieces.some((piece) => typeof piece !== 'string')) {
				// Chunks and state are written in one atomic put, so this is not expected.
				logger?.warn('存储协调服务中的数据副本不完整，改为读取 KV', { key });
				return null;
			}
			value = pieces.join('');
		}
		return {
			revision: state.revision,
			value,
			foreign: Array.isArray(state.foreign) ? state.foreign : [],
			chunks: state.present ? state.chunks : 0,
		};
	}

	async function saveState(key, next, previous) {
		const chunks = next.value === null ? 0 : Math.ceil(next.value.length / CONSISTENT_KV_CHUNK_LENGTH);
		const entries = {};
		chunkKeys(key, 0, chunks).forEach((name, index) => {
			entries[name] = next.value.slice(index * CONSISTENT_KV_CHUNK_LENGTH, (index + 1) * CONSISTENT_KV_CHUNK_LENGTH);
		});
		entries[STATE_PREFIX + key] = {
			revision: next.revision,
			present: next.value !== null,
			chunks,
			foreign: next.foreign,
		};
		await storage.put(entries);
		const previousChunks = previous?.chunks ?? 0;
		if (previousChunks > chunks) {
			await storage.delete(chunkKeys(key, chunks, previousChunks));
		}
	}

	function storeRevision(metadata) {
		return metadata && metadata.storeId === storeId && Number.isSafeInteger(metadata.storeRevision) && metadata.storeRevision > 0
			? metadata.storeRevision
			: null;
	}

	async function readOwned(key) {
		const [current, state] = await Promise.all([kv.getWithMetadata(key, 'text'), loadState(key)]);
		return reconcile(key, current, state);
	}

	// One bulk KV read per KV_BULK_READ_SIZE keys: a Worker invocation may make
	// only 1,000 KV operations, and a bulk read counts as one.
	async function readOwnedMany(keys) {
		const values = new Map();
		for (let index = 0; index < keys.length; index += KV_BULK_READ_SIZE) {
			const batch = keys.slice(index, index + KV_BULK_READ_SIZE);
			const [current, states] = await Promise.all([kv.getWithMetadata(batch, 'text'), Promise.all(batch.map(loadState))]);
			if (!(current instanceof Map)) {
				throw new Error('KV 批量读取结果格式无效');
			}
			for (const [position, key] of batch.entries()) {
				values.set(key, await reconcile(key, current.get(key), states[position]));
			}
		}
		return values;
	}

	// The value of an owned key, from what KV returned (current) and the stored
	// copy (state).
	async function reconcile(key, current, state) {
		const value = current?.value ?? null;
		const revision = storeRevision(current?.metadata);

		if (state && revision !== null) {
			if (revision <= state.revision) {
				return state.value;
			}
			// The KV write succeeded but the storage update after it did not.
			await saveState(key, { revision, value, foreign: state.foreign }, state);
			return value;
		}
		if (state && (value === state.value || (value === null && state.value !== null))) {
			return state.value;
		}

		const print = revision === null ? await fingerprint(value) : null;
		if (state && state.foreign.includes(print)) {
			return state.value;
		}
		if (state) {
			logger?.warn('检测到未经存储协调服务写入的数据，已采用 KV 中的新值', { key });
		}
		await saveState(
			key,
			{
				revision: revision ?? state?.revision ?? 0,
				value,
				foreign: print === null ? (state?.foreign ?? []) : [print, ...(state?.foreign ?? [])].slice(0, MAX_FOREIGN_FINGERPRINTS),
			},
			state,
		);
		return value;
	}

	async function writeOwned(key, value, options) {
		if (value !== null && typeof value !== 'string') {
			throw new TypeError('受保护的存储键只能写入文本');
		}
		let state = await loadState(key);
		if (!state) {
			// Record what KV holds now, so a later stale read of it is recognised.
			await readOwned(key);
			state = await loadState(key);
		}
		const revision = (state?.revision ?? 0) + 1;
		if (value === null) {
			await kv.delete(key);
		} else {
			await kv.put(key, value, {
				...(options || {}),
				metadata: { ...(options?.metadata || {}), storeId, storeRevision: revision },
			});
		}
		await saveState(key, { revision, value, foreign: state?.foreign ?? [] }, state);
	}

	return {
		async get(keyOrKeys, typeOrOptions) {
			if (!Array.isArray(keyOrKeys)) {
				return isOwnedKey(keyOrKeys) ? decodeValue(await readOwned(keyOrKeys), readType(typeOrOptions)) : kv.get(keyOrKeys, typeOrOptions);
			}
			const owned = keyOrKeys.filter((key) => isOwnedKey(key));
			if (owned.length === 0) {
				return kv.get(keyOrKeys, typeOrOptions);
			}
			const type = readType(typeOrOptions);
			const others = keyOrKeys.filter((key) => !isOwnedKey(key));
			const [ownedValues, otherValues] = await Promise.all([
				readOwnedMany([...new Set(owned)]),
				others.length > 0 ? kv.get(others, typeOrOptions) : new Map(),
			]);
			const result = new Map();
			for (const key of keyOrKeys) {
				result.set(
					key,
					ownedValues.has(key)
						? decodeValue(ownedValues.get(key), type)
						: ((otherValues instanceof Map ? otherValues.get(key) : otherValues?.[key]) ?? null),
				);
			}
			return result;
		},

		async getWithMetadata(key, typeOrOptions) {
			if (Array.isArray(key) || !isOwnedKey(key)) {
				if (Array.isArray(key) && key.some((name) => isOwnedKey(name))) {
					throw new TypeError('受保护的存储键不支持批量读取元数据');
				}
				return kv.getWithMetadata(key, typeOrOptions);
			}
			return { value: decodeValue(await readOwned(key), readType(typeOrOptions)), metadata: null, cacheStatus: null };
		},

		put(key, value, options) {
			return isOwnedKey(key) ? writeOwned(key, value, options) : kv.put(key, value, options);
		},

		delete(key) {
			return isOwnedKey(key) ? writeOwned(key, null) : kv.delete(key);
		},

		list(options) {
			return kv.list(options);
		},
	};
}
