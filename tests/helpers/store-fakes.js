/* global structuredClone */
/**
 * In-memory stand-ins for Workers KV, Durable Object storage and a Durable Object
 * namespace, for tests of the secrets store.
 */

import { SecretsStore } from '../../src/storage/secrets-store.js';

export const TEST_ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012').toString('base64');

export class FakeKV {
	constructor() {
		this.store = new Map();
		// key -> list of { value, metadata } returned (once each) before the real value.
		this.staleReads = new Map();
		// Called before each read or write; tests use it to delay or interleave operations.
		this.beforeOperation = null;
		this.puts = [];
	}

	async #pause(kind, key) {
		if (this.beforeOperation) {
			await this.beforeOperation(kind, key);
		}
	}

	#read(key) {
		const queue = this.staleReads.get(key);
		if (queue?.length) {
			return queue.shift();
		}
		return this.store.get(key) ?? null;
	}

	serveStale(key, value, metadata = null) {
		const queue = this.staleReads.get(key) ?? [];
		queue.push(value === null ? null : { value, metadata });
		this.staleReads.set(key, queue);
	}

	// A bulk read (an array of keys, at most 100 like Workers KV) is one
	// operation for callers counting calls; beforeOperation still sees each key.
	async get(keyOrKeys, typeOrOptions) {
		const type = (typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type) || 'text';
		const read = async (key) => (await this.#readEntry(key, type))?.value ?? null;
		return Array.isArray(keyOrKeys) ? this.#readBulk(keyOrKeys, read) : read(keyOrKeys);
	}

	// As in workerd, a missing key reads as { value: null, metadata: null } on
	// its own and as null in a bulk read.
	async getWithMetadata(keyOrKeys, typeOrOptions) {
		const type = (typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type) || 'text';
		if (Array.isArray(keyOrKeys)) {
			return this.#readBulk(keyOrKeys, (key) => this.#readEntry(key, type));
		}
		return (await this.#readEntry(keyOrKeys, type)) ?? { value: null, metadata: null };
	}

	async #readEntry(key, type) {
		await this.#pause('get', key);
		const entry = this.#read(key);
		if (!entry) {
			return null;
		}
		return { value: type === 'json' ? JSON.parse(entry.value) : entry.value, metadata: entry.metadata ?? null };
	}

	async #readBulk(keys, read) {
		if (keys.length > 100) {
			throw new Error(`KV bulk read of ${keys.length} keys`);
		}
		const result = new Map();
		for (const key of keys) {
			result.set(key, await read(key));
		}
		return result;
	}

	async put(key, value, options = {}) {
		await this.#pause('put', key);
		this.store.set(key, { value, metadata: options.metadata ?? null });
		this.puts.push({ key, value, options });
	}

	async delete(key) {
		await this.#pause('delete', key);
		this.store.delete(key);
	}

	async list(options = {}) {
		const prefix = options.prefix || '';
		const keys = [...this.store.keys()]
			.filter((name) => name.startsWith(prefix))
			.sort()
			.map((name) => ({ name, metadata: this.store.get(name).metadata ?? undefined }));
		return { keys, list_complete: true, cursor: '' };
	}
}

export class FakeStorage {
	constructor() {
		this.data = new Map();
		this.failNextPut = false;
	}

	async get(keyOrKeys) {
		if (Array.isArray(keyOrKeys)) {
			if (keyOrKeys.length > 128) {
				throw new Error('too many keys');
			}
			const result = new Map();
			for (const key of keyOrKeys) {
				if (this.data.has(key)) {
					result.set(key, structuredClone(this.data.get(key)));
				}
			}
			return result;
		}
		return this.data.has(keyOrKeys) ? structuredClone(this.data.get(keyOrKeys)) : undefined;
	}

	async put(keyOrEntries, value) {
		if (this.failNextPut) {
			this.failNextPut = false;
			throw new Error('storage unavailable');
		}
		const entries = typeof keyOrEntries === 'string' ? { [keyOrEntries]: value } : keyOrEntries;
		if (Object.keys(entries).length > 128) {
			throw new Error('too many entries');
		}
		for (const [key, entry] of Object.entries(entries)) {
			this.data.set(key, structuredClone(entry));
		}
	}

	async delete(keyOrKeys) {
		for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
			this.data.delete(key);
		}
	}
}

export class FakeDurableObjectNamespace {
	constructor(getEnv) {
		this.getEnv = getEnv;
		this.instances = new Map();
		this.storages = new Map();
		this.requests = [];
		this.failFetch = null;
	}

	idFromName(name) {
		return { name, toString: () => `store-${name}` };
	}

	get(id) {
		return {
			fetch: async (request) => {
				this.requests.push(request);
				if (this.failFetch) {
					throw this.failFetch;
				}
				return this.instance(id).fetch(request);
			},
		};
	}

	instance(id) {
		const key = id.toString();
		if (!this.instances.has(key)) {
			if (!this.storages.has(key)) {
				this.storages.set(key, new FakeStorage());
			}
			this.instances.set(key, new SecretsStore({ id, storage: this.storages.get(key) }, this.getEnv()));
		}
		return this.instances.get(key);
	}

	// Simulates eviction: the next request builds a new object over the same storage.
	evict() {
		this.instances.clear();
	}
}

export function createStoreEnv({ withStore = true } = {}) {
	const env = {
		SECRETS_KV: new FakeKV(),
		ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
		LOG_LEVEL: 'ERROR',
	};
	if (withStore) {
		env.SECRETS_STORE = new FakeDurableObjectNamespace(() => env);
	}
	return env;
}

export function jsonRequest(path, body, method = 'POST') {
	return new Request(`https://2fa.example.com${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
