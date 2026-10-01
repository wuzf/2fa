import { describe, expect, it, vi } from 'vitest';
import { handleAddSecret } from '../../src/api/secrets/crud.js';
import { decryptSecrets, encryptSecrets } from '../../src/utils/encryption.js';
import { readSecretsSnapshot, runSecretsOperation, SECRETS_STORE_OPERATION_HEADER } from '../../src/storage/secrets-store.js';
import { createStoreEnv, jsonRequest } from '../helpers/store-fakes.js';

const SEEDS = [
	['GitHub', 'JBSWY3DPEHPK3PXP'],
	['GitLab', 'MFRGGZDFMZTWQ2LK'],
	['Bitbucket', 'KRSXG5CTMVRXEZLU'],
	['Azure', 'GEZDGNBVGY3TQOJQ'],
	['AWS', 'MFZXG4DBOJSXG2LOM'],
];

function addRequest(name, secret) {
	return jsonRequest('/api/secrets', { name, secret });
}

async function storedNames(env) {
	const raw = env.SECRETS_KV.store.get('secrets')?.value ?? null;
	const secrets = await decryptSecrets(raw, env);
	return secrets.map((secret) => secret.name).sort();
}

async function listNames(env) {
	const response = await runSecretsOperation('secrets.list', new Request('https://2fa.example.com/api/secrets'), env);
	expect(response.status).toBe(200);
	return (await response.json()).map((secret) => secret.name).sort();
}

// Holds every read of the secrets document until `count` reads are waiting, so that
// concurrent changes all start from the same document.
function holdReadsUntil(kv, count) {
	let waiting = [];
	kv.beforeOperation = async (kind, key) => {
		if (kind !== 'get' || key !== 'secrets') {
			return;
		}
		await new Promise((resolve) => {
			waiting.push(resolve);
			if (waiting.length === count) {
				waiting.forEach((release) => release());
				waiting = [];
				kv.beforeOperation = null;
			}
		});
	};
}

function jitter(kv) {
	kv.beforeOperation = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 4));
}

describe('secrets store', () => {
	it('loses a change when two additions read the same document outside the store', async () => {
		// Documents the defect the store exists for: the handlers alone are not atomic.
		const env = createStoreEnv({ withStore: false });
		holdReadsUntil(env.SECRETS_KV, 2);
		const statuses = await Promise.all([
			handleAddSecret(addRequest('Concurrent A', SEEDS[0][1]), env).then((response) => response.status),
			handleAddSecret(addRequest('Concurrent B', SEEDS[1][1]), env).then((response) => response.status),
		]);
		expect(statuses).toEqual([201, 201]);
		expect(await storedNames(env)).toHaveLength(1);
	});

	it('keeps every change when additions arrive at the same time', async () => {
		const env = createStoreEnv();
		jitter(env.SECRETS_KV);
		const responses = await Promise.all(SEEDS.map(([name, secret]) => runSecretsOperation('secrets.add', addRequest(name, secret), env)));
		expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
		env.SECRETS_KV.beforeOperation = null;
		const expected = SEEDS.map(([name]) => name).sort();
		expect(await storedNames(env)).toEqual(expected);
		expect(await listNames(env)).toEqual(expected);
	});

	it('keeps every change when additions, edits and deletions interleave', async () => {
		const env = createStoreEnv();
		const created = [];
		for (const [name, secret] of SEEDS.slice(0, 3)) {
			const response = await runSecretsOperation('secrets.add', addRequest(name, secret), env);
			created.push((await response.json()).data.secret);
		}
		jitter(env.SECRETS_KV);
		const [github, gitlab] = created;
		const responses = await Promise.all([
			runSecretsOperation('secrets.update', jsonRequest(`/api/secrets/${github.id}`, { name: 'GitHub Work', secret: github.secret }, 'PUT'), env),
			runSecretsOperation('secrets.delete', jsonRequest(`/api/secrets/${gitlab.id}`, undefined, 'DELETE'), env),
			runSecretsOperation('secrets.add', addRequest(...SEEDS[3]), env),
			runSecretsOperation('secrets.add', addRequest(...SEEDS[4]), env),
		]);
		expect(responses.map((response) => response.status)).toEqual([200, 200, 201, 201]);
		env.SECRETS_KV.beforeOperation = null;
		expect(await listNames(env)).toEqual(['AWS', 'Azure', 'Bitbucket', 'GitHub Work']);
	});

	it('does not build on an outdated document that KV returns after a write', async () => {
		const env = createStoreEnv();
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		const afterFirst = env.SECRETS_KV.store.get('secrets');
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[1]), env);
		// KV now answers with the document from before the second addition.
		env.SECRETS_KV.serveStale('secrets', afterFirst.value, afterFirst.metadata);
		env.SECRETS_KV.serveStale('secrets', afterFirst.value, afterFirst.metadata);
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[2]), env);
		expect(await listNames(env)).toEqual(['Bitbucket', 'GitHub', 'GitLab']);
	});

	it('keeps its data after the object is evicted and rebuilt', async () => {
		const env = createStoreEnv();
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		const afterFirst = env.SECRETS_KV.store.get('secrets');
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[1]), env);
		env.SECRETS_STORE.evict();
		env.SECRETS_KV.serveStale('secrets', afterFirst.value, afterFirst.metadata);
		expect(await listNames(env)).toEqual(['GitHub', 'GitLab']);
	});

	it('takes over data that an earlier release wrote to KV directly', async () => {
		const env = createStoreEnv();
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		// An earlier release (after a rollback) adds a secret without the store.
		await handleAddSecret(addRequest(...SEEDS[1]), { ...env, SECRETS_STORE: undefined });
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[2]), env);
		expect(await listNames(env)).toEqual(['Bitbucket', 'GitHub', 'GitLab']);
	});

	it('forwards the request unchanged apart from the operation header', async () => {
		const env = createStoreEnv();
		const request = jsonRequest('/api/secrets?x=1', { name: 'GitHub', secret: SEEDS[0][1] });
		request.headers.set('X-Language', 'en');
		const response = await runSecretsOperation('secrets.add', request, env);
		expect(response.status).toBe(201);
		const [forwarded] = env.SECRETS_STORE.requests;
		expect(forwarded.url).toBe('https://2fa.example.com/api/secrets?x=1');
		expect(forwarded.method).toBe('POST');
		expect(forwarded.headers.get(SECRETS_STORE_OPERATION_HEADER)).toBe('secrets.add');
		expect(forwarded.headers.get('X-Language')).toBe('en');
		expect(forwarded.headers.get('CF-Connecting-IP')).toBe('203.0.113.1');
	});

	it('ignores an operation header sent by the client', async () => {
		const env = createStoreEnv();
		const request = new Request('https://2fa.example.com/api/secrets', { headers: { [SECRETS_STORE_OPERATION_HEADER]: 'secrets.snapshot' } });
		await runSecretsOperation('secrets.list', request, env);
		expect(env.SECRETS_STORE.requests[0].headers.get(SECRETS_STORE_OPERATION_HEADER)).toBe('secrets.list');
	});

	it('rejects unknown operations inside the store', async () => {
		const env = createStoreEnv();
		const stub = env.SECRETS_STORE.get(env.SECRETS_STORE.idFromName('secrets'));
		const response = await stub.fetch(new Request('https://2fa.example.com/', { headers: { [SECRETS_STORE_OPERATION_HEADER]: 'toString' } }));
		expect(response.status).toBe(404);
	});

	it('refuses a change it cannot deliver to the store', async () => {
		const env = createStoreEnv();
		env.SECRETS_STORE.failFetch = new Error('Durable Object reset');
		const response = await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		expect(response.status).toBe(503);
		expect((await response.json()).message).toBe('无法确认本次修改是否已保存，请刷新后重试');
		expect(env.SECRETS_KV.store.has('secrets')).toBe(false);
	});

	it('translates the unavailable-store message', async () => {
		const env = createStoreEnv();
		env.SECRETS_STORE.failFetch = new Error('Durable Object reset');
		const request = addRequest(...SEEDS[0]);
		request.headers.set('X-Language', 'en');
		const body = await (await runSecretsOperation('secrets.add', request, env)).json();
		expect(body).toMatchObject({
			error: 'Secret storage is temporarily unavailable',
			message: 'Could not confirm whether this change was saved. Refresh and try again.',
		});
	});

	it('reads KV directly when the store cannot be reached', async () => {
		const env = createStoreEnv();
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		env.SECRETS_STORE.failFetch = new Error('Durable Object reset');
		expect(await listNames(env)).toEqual(['GitHub']);
	});

	it('runs changes one at a time in the receiving isolate without the binding', async () => {
		const env = createStoreEnv({ withStore: false });
		jitter(env.SECRETS_KV);
		const responses = await Promise.all(SEEDS.map(([name, secret]) => runSecretsOperation('secrets.add', addRequest(name, secret), env)));
		expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
		env.SECRETS_KV.beforeOperation = null;
		expect(await storedNames(env)).toEqual(SEEDS.map(([name]) => name).sort());
	});

	it('keeps the queue of the isolate usable after a failed change', async () => {
		const env = createStoreEnv({ withStore: false });
		const failing = { ...env, SECRETS_KV: { ...env.SECRETS_KV, get: vi.fn(async () => Promise.reject(new Error('kv down'))) } };
		const failed = await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), failing);
		expect(failed.status).toBeGreaterThanOrEqual(500);
		const response = await runSecretsOperation('secrets.add', addRequest(...SEEDS[1]), env);
		expect(response.status).toBe(201);
	});

	it('gives the scheduled backup the current secrets', async () => {
		const env = createStoreEnv();
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), env);
		const afterFirst = env.SECRETS_KV.store.get('secrets');
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[1]), env);
		env.SECRETS_KV.serveStale('secrets', afterFirst.value, afterFirst.metadata);
		expect((await readSecretsSnapshot(env)).map((secret) => secret.name).sort()).toEqual(['GitHub', 'GitLab']);

		const withoutStore = createStoreEnv({ withStore: false });
		await runSecretsOperation('secrets.add', addRequest(...SEEDS[0]), withoutStore);
		expect((await readSecretsSnapshot(withoutStore)).map((secret) => secret.name)).toEqual(['GitHub']);
	});

	it('lists a thousand HOTP accounts with bulk KV reads', async () => {
		const env = createStoreEnv();
		const records = Array.from({ length: 1000 }, (_, index) => ({
			id: `id-${index}`,
			name: `Account ${index}`,
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'HOTP',
			digits: 6,
			algorithm: 'SHA1',
			counter: 0,
		}));
		await env.SECRETS_KV.put('secrets', await encryptSecrets(records, env));
		// A Worker invocation may make 1,000 KV operations; a bulk read counts as one.
		let operations = 0;
		for (const method of ['get', 'getWithMetadata']) {
			const read = env.SECRETS_KV[method].bind(env.SECRETS_KV);
			env.SECRETS_KV[method] = (...args) => {
				operations += 1;
				return read(...args);
			};
		}
		const response = await runSecretsOperation('secrets.list', new Request('https://2fa.example.com/api/secrets'), env);
		expect(response.status).toBe(200);
		expect(await response.json()).toHaveLength(1000);
		expect(operations).toBeLessThanOrEqual(20);
	});
});
