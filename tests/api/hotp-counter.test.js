import { beforeEach, describe, expect, it, vi } from 'vitest';

const backupMocks = vi.hoisted(() => ({ triggerBackup: vi.fn(async () => null) }));

vi.mock('../../src/utils/backup.js', () => ({ triggerBackup: backupMocks.triggerBackup }));

import {
	handleAdvanceHOTPCounter,
	handleCompactHOTPCounters,
	handleDeleteSecret,
	handleGetSecrets,
	handleRestoreBackup,
	handleUpdateSecret,
} from '../../src/api/secrets/index.js';
import { decryptData, decryptSecrets, encryptSecrets } from '../../src/utils/encryption.js';
import { createBackupEntry, decodeBackupEntry } from '../../src/utils/backup-format.js';
import { getAllSecrets } from '../../src/api/secrets/shared.js';
import {
	getHOTPCounterStateKey,
	HOTP_COUNTER_EPOCH_KEY,
	rotateHOTPCounterEpoch,
	saveHOTPCounterState,
} from '../../src/api/secrets/counter-state.js';

class MockKV {
	constructor() {
		this.store = new Map();
		this.metadata = new Map();
		this.putCalls = [];
		this.getCalls = [];
		this.deleteCalls = [];
		this.listCalls = [];
	}

	async get(key, type = 'text') {
		this.getCalls.push({ key, type });
		if (Array.isArray(key)) {
			return new Map(
				key.map((item) => {
					const value = this.store.has(item) ? this.store.get(item) : null;
					return [item, value];
				}),
			);
		}
		const value = this.store.has(key) ? this.store.get(key) : null;
		if (value !== null && type === 'json') {
			return typeof value === 'string' ? JSON.parse(value) : value;
		}
		return value;
	}

	async put(key, value, options = {}) {
		this.putCalls.push({ key, value, options });
		this.store.set(key, value);
		if (options.metadata !== undefined) {
			this.metadata.set(key, options.metadata);
		}
	}

	async delete(key) {
		this.deleteCalls.push(key);
		this.store.delete(key);
		this.metadata.delete(key);
	}

	async list(options = {}) {
		this.listCalls.push(options);
		const prefix = options.prefix || '';
		return {
			keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name, metadata: this.metadata.get(name) })),
			list_complete: true,
		};
	}
}

function createDeferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createEnv() {
	return {
		SECRETS_KV: new MockKV(),
		ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
		LOG_LEVEL: 'ERROR',
	};
}

function createSecret(overrides = {}) {
	return {
		id: 'hotp-secret-1',
		name: 'Security Key',
		account: 'alice@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'HOTP',
		digits: 8,
		period: 30,
		algorithm: 'SHA256',
		counter: 7,
		metadata: { color: 'blue' },
		...overrides,
	};
}

function createCounterRequest(secret, overrides = {}) {
	return new Request(`https://example.com/api/secrets/${secret.id}/counter`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			expectedNamespace: secret.hotpCounterNamespace || null,
			expectedCounter: secret.counter,
			expectedSecret: secret.secret,
			expectedDigits: secret.digits,
			expectedAlgorithm: secret.algorithm,
			...overrides,
		}),
	});
}

function createUpdateRequest(secret, overrides = {}) {
	return new Request(`https://example.com/api/secrets/${secret.id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: secret.name,
			account: secret.account,
			secret: secret.secret,
			type: secret.type,
			digits: secret.digits,
			period: secret.period,
			algorithm: secret.algorithm,
			counter: secret.counter,
			...overrides,
		}),
	});
}

async function seedSecrets(env, secrets) {
	await env.SECRETS_KV.put('secrets', await encryptSecrets(secrets, env));
	env.SECRETS_KV.putCalls = [];
}

async function getBaseSecrets(env) {
	return decryptSecrets(await env.SECRETS_KV.get('secrets', 'text'), env);
}

describe('HOTP counter sidecar API', () => {
	beforeEach(() => {
		backupMocks.triggerBackup.mockReset();
		backupMocks.triggerBackup.mockResolvedValue(null);
	});

	it.each([undefined, null])(
		'accepts a legacy request namespace %s and writes only its sidecar without base writes or backups',
		async (expectedNamespace) => {
			const env = createEnv();
			const secret = createSecret();
			await seedSecrets(env, [secret]);
			const rawSecretsBefore = await env.SECRETS_KV.get('secrets', 'text');
			const listSpy = vi.spyOn(env.SECRETS_KV, 'list');

			const response = await handleAdvanceHOTPCounter(createCounterRequest(secret, { name: 'ignored', expectedNamespace }), env);
			const body = await response.json();
			const [effectiveSecret] = await getAllSecrets(env);

			expect(response.status).toBe(200);
			expect(body.data).toMatchObject({
				secret: { ...secret, counter: 8 },
				id: secret.id,
				counter: 8,
				idempotent: false,
			});
			expect(effectiveSecret).toEqual({ ...secret, counter: 8 });
			expect(await env.SECRETS_KV.get('secrets', 'text')).toBe(rawSecretsBefore);
			expect(env.SECRETS_KV.putCalls.filter(({ key }) => key === 'secrets')).toHaveLength(0);
			expect(env.SECRETS_KV.putCalls.filter(({ key }) => key === getHOTPCounterStateKey(secret.id))).toHaveLength(1);
			const storedSidecar = await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id), 'text');
			expect(storedSidecar).toMatch(/^v1:/);
			expect(storedSidecar).not.toContain(secret.secret);
			expect(env.SECRETS_KV.metadata.has(getHOTPCounterStateKey(secret.id))).toBe(false);
			expect(await decryptData(storedSidecar, env)).toMatchObject({ counter: 8, generationHash: expect.any(String) });
			expect(await env.SECRETS_KV.get('pending_backup_hash')).toBeNull();
			expect(backupMocks.triggerBackup).not.toHaveBeenCalled();
			expect(listSpy).not.toHaveBeenCalled();
		},
	);

	it('returns effective counters from the public secrets API', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 12);

		const response = await handleGetSecrets(env);
		const secrets = await response.json();

		expect(response.status).toBe(200);
		expect(secrets[0].counter).toBe(12);
	});

	it('rejects an exactly one-step stale request with 409', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		const staleRequest = createCounterRequest(secret);

		expect((await handleAdvanceHOTPCounter(createCounterRequest(secret), env)).status).toBe(200);
		const putsAfterAdvance = env.SECRETS_KV.putCalls.length;
		const response = await handleAdvanceHOTPCounter(staleRequest, env);

		expect(response.status).toBe(409);
		expect((await response.json()).details).toMatchObject({ expectedCounter: 7, currentCounter: 8 });
		expect(env.SECRETS_KV.putCalls).toHaveLength(putsAfterAdvance);
	});

	it('advances different HOTP IDs concurrently without lost counters', async () => {
		const env = createEnv();
		const first = createSecret({ id: 'hotp-a', counter: 3 });
		const second = createSecret({ id: 'hotp-b', secret: 'MFRGGZDFMZTWQ2LK', counter: 20 });
		await seedSecrets(env, [first, second]);
		const rawSecretsBefore = await env.SECRETS_KV.get('secrets', 'text');

		const responses = await Promise.all([
			handleAdvanceHOTPCounter(createCounterRequest(first), env),
			handleAdvanceHOTPCounter(createCounterRequest(second), env),
		]);
		const effectiveSecrets = await getAllSecrets(env);

		expect(responses.map(({ status }) => status)).toEqual([200, 200]);
		expect(effectiveSecrets.find(({ id }) => id === first.id).counter).toBe(4);
		expect(effectiveSecrets.find(({ id }) => id === second.id).counter).toBe(21);
		expect(await env.SECRETS_KV.get('secrets', 'text')).toBe(rawSecretsBefore);
		expect(await decryptData(await env.SECRETS_KV.get(getHOTPCounterStateKey(first.id), 'text'), env)).toMatchObject({ counter: 4 });
		expect(await decryptData(await env.SECRETS_KV.get(getHOTPCounterStateKey(second.id), 'text'), env)).toMatchObject({ counter: 21 });
	});

	it('advances one target among 1000 HOTP secrets without bulk-reading sidecars', async () => {
		const env = createEnv();
		const secrets = Array.from({ length: 1000 }, (_, index) => createSecret({ id: `hotp-${index}`, counter: index }));
		const target = secrets[731];
		await seedSecrets(env, secrets);
		env.SECRETS_KV.getCalls = [];

		const response = await handleAdvanceHOTPCounter(createCounterRequest(target), env);
		const sidecarReadKeys = env.SECRETS_KV.getCalls
			.filter(({ key }) => typeof key === 'string' && key.startsWith('hotp-counter:'))
			.map(({ key }) => key);

		expect(response.status).toBe(200);
		expect(env.SECRETS_KV.getCalls.some(({ key }) => Array.isArray(key))).toBe(false);
		expect(sidecarReadKeys).toEqual([getHOTPCounterStateKey(target.id)]);
		expect(env.SECRETS_KV.putCalls.filter(({ key }) => key.startsWith('hotp-counter:'))).toHaveLength(1);
		expect(await env.SECRETS_KV.get('pending_backup_hash')).toBeNull();
	});

	it('uses base only for explicitly missing sidecars while overlaying present records', async () => {
		const env = createEnv();
		const first = createSecret({ id: 'hotp-a', counter: 3 });
		const second = createSecret({ id: 'hotp-b', secret: 'MFRGGZDFMZTWQ2LK', counter: 20 });
		await seedSecrets(env, [first, second]);
		await saveHOTPCounterState(env, second, 25);

		const effectiveSecrets = await getAllSecrets(env);

		expect(effectiveSecrets.find(({ id }) => id === first.id).counter).toBe(3);
		expect(effectiveSecrets.find(({ id }) => id === second.id).counter).toBe(25);
	});

	it('uses plaintext sidecars only when the main secrets store is also in plaintext mode', async () => {
		const env = createEnv();
		delete env.ENCRYPTION_KEY;
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 9);

		const storedSidecar = await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id), 'text');

		expect(storedSidecar).toMatch(/^\{/);
		expect((await getAllSecrets(env))[0].counter).toBe(9);
	});

	it('overlays 1000 HOTP counters in 10 sequential bulk reads and invalidates them with one epoch write', async () => {
		const env = createEnv();
		delete env.ENCRYPTION_KEY;
		const secrets = Array.from({ length: 1000 }, (_, index) =>
			createSecret({ id: `hotp-${index}`, counter: index, ...(index % 2 && { hotpCounterNamespace: crypto.randomUUID() }) }),
		);
		await seedSecrets(env, secrets);
		await Promise.all(secrets.map((secret) => saveHOTPCounterState(env, secret, secret.counter + 1000)));
		env.SECRETS_KV.getCalls = [];

		const effectiveSecrets = await getAllSecrets(env);
		const bulkCalls = env.SECRETS_KV.getCalls.filter(({ key }) => Array.isArray(key));

		expect(bulkCalls).toHaveLength(10);
		expect(bulkCalls.every(({ key }) => key.length <= 100)).toBe(true);
		expect(effectiveSecrets.every((secret, index) => secret.counter === index + 1000)).toBe(true);

		env.SECRETS_KV.putCalls = [];
		env.SECRETS_KV.deleteCalls = [];
		env.SECRETS_KV.listCalls = [];
		await rotateHOTPCounterEpoch(env);

		expect(env.SECRETS_KV.putCalls).toHaveLength(1);
		expect(env.SECRETS_KV.putCalls[0].key).toBe(HOTP_COUNTER_EPOCH_KEY);
		expect(env.SECRETS_KV.deleteCalls).toHaveLength(0);
		expect(env.SECRETS_KV.listCalls).toHaveLength(0);
		expect((await getAllSecrets(env)).every((secret, index) => secret.counter === index)).toBe(true);
	});

	it.each(['throw', 'null'])('fails closed when a sidecar bulk read returns %s', async (failureMode) => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
		env.SECRETS_KV.get = vi.fn(async (key, type) => {
			if (Array.isArray(key)) {
				if (failureMode === 'throw') {
					throw new Error('bulk sidecar unavailable');
				}
				return null;
			}
			if (key === getHOTPCounterStateKey(secret.id)) {
				throw new Error('target sidecar unavailable');
			}
			return originalGet(key, type);
		});

		await expect(getAllSecrets(env)).rejects.toThrow();
		env.SECRETS_KV.putCalls = [];
		const response = await handleAdvanceHOTPCounter(createCounterRequest(secret), env);

		expect(response.status).toBe(500);
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
	});

	it('fails closed on corrupt encrypted sidecars and does not advance', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await env.SECRETS_KV.put(getHOTPCounterStateKey(secret.id), 'v1:corrupt:ciphertext');

		await expect(getAllSecrets(env)).rejects.toThrow();
		env.SECRETS_KV.putCalls = [];
		const response = await handleAdvanceHOTPCounter(createCounterRequest(secret), env);

		expect(response.status).toBe(500);
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
	});

	it('compacts effective counters into base and rotates the epoch without backups or deletes', async () => {
		const env = createEnv();
		const first = createSecret({ id: 'hotp-a', counter: 3 });
		const second = createSecret({ id: 'hotp-b', secret: 'MFRGGZDFMZTWQ2LK', counter: 20, hotpCounterNamespace: crypto.randomUUID() });
		await seedSecrets(env, [first, second]);
		await saveHOTPCounterState(env, first, 8);
		await saveHOTPCounterState(env, second, 25);
		const legacyFirstKey = getHOTPCounterStateKey(first.id);
		env.SECRETS_KV.putCalls = [];
		env.SECRETS_KV.deleteCalls = [];
		env.SECRETS_KV.listCalls = [];
		const request = new Request('https://example.com/api/secrets/counters/compact', {
			method: 'POST',
			headers: { 'X-Confirm-Maintenance': 'compact-hotp-counters' },
		});

		const response = await handleCompactHOTPCounters(request, env);
		const body = await response.json();
		const baseSecrets = await getBaseSecrets(env);

		expect(response.status).toBe(200);
		expect(body.data).toEqual({ compactedCount: 2, secretCount: 2 });
		expect(baseSecrets.find(({ id }) => id === first.id).counter).toBe(8);
		expect(baseSecrets.find(({ id }) => id === second.id).counter).toBe(25);
		expect(baseSecrets.find(({ id }) => id === second.id).hotpCounterNamespace).toBe(second.hotpCounterNamespace);
		expect(await env.SECRETS_KV.get(HOTP_COUNTER_EPOCH_KEY, 'text')).not.toBe('legacy');
		expect(await env.SECRETS_KV.get(legacyFirstKey, 'text')).not.toBeNull();
		expect(env.SECRETS_KV.deleteCalls).toHaveLength(0);
		expect(env.SECRETS_KV.listCalls).toHaveLength(0);
		expect(backupMocks.triggerBackup).not.toHaveBeenCalled();
		expect((await getAllSecrets(env)).map(({ counter }) => counter)).toEqual([8, 25]);
		expect((await handleAdvanceHOTPCounter(createCounterRequest({ ...second, counter: 25 }), env)).status).toBe(200);
		expect((await getAllSecrets(env)).find(({ id }) => id === second.id).counter).toBe(26);
	});

	it('requires explicit compact confirmation and can retry an epoch rotation failure', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 12);

		const missingHeaderResponse = await handleCompactHOTPCounters(
			new Request('https://example.com/api/secrets/counters/compact', { method: 'POST' }),
			env,
		);
		expect(missingHeaderResponse.status).toBe(400);

		const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
		let failEpochWrite = true;
		env.SECRETS_KV.put = vi.fn(async (key, value, options) => {
			if (key === HOTP_COUNTER_EPOCH_KEY && failEpochWrite) {
				throw new Error('epoch unavailable');
			}
			return originalPut(key, value, options);
		});
		const confirmedRequest = () =>
			new Request('https://example.com/api/secrets/counters/compact', {
				method: 'POST',
				headers: { 'X-Confirm-Maintenance': 'compact-hotp-counters' },
			});

		const failedResponse = await handleCompactHOTPCounters(confirmedRequest(), env);
		expect(failedResponse.status).toBe(500);
		expect((await getBaseSecrets(env))[0].counter).toBe(12);
		expect(await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id), 'text')).not.toBeNull();

		failEpochWrite = false;
		const retryResponse = await handleCompactHOTPCounters(confirmedRequest(), env);
		expect(retryResponse.status).toBe(200);
		expect((await getAllSecrets(env))[0].counter).toBe(12);
	});

	it('preserves metadata edits interleaved with delayed sidecar writes', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		const sidecarWriteStarted = createDeferred();
		const releaseSidecarWrite = createDeferred();
		const sidecarKey = getHOTPCounterStateKey(secret.id);
		const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
		env.SECRETS_KV.put = vi.fn(async (key, value, options = {}) => {
			if (key === sidecarKey) {
				sidecarWriteStarted.resolve();
				await releaseSidecarWrite.promise;
			}
			return originalPut(key, value, options);
		});

		const advancePromise = handleAdvanceHOTPCounter(createCounterRequest(secret), env);
		await sidecarWriteStarted.promise;
		const updateResponse = await handleUpdateSecret(createUpdateRequest(secret, { name: 'Renamed token' }), env);
		releaseSidecarWrite.resolve();
		const advanceResponse = await advancePromise;
		const [effectiveSecret] = await getAllSecrets(env);

		expect(updateResponse.status).toBe(200);
		expect(advanceResponse.status).toBe(200);
		expect(effectiveSecret.name).toBe('Renamed token');
		expect(effectiveSecret.account).toBe(secret.account);
		expect(effectiveSecret.counter).toBe(8);
	});

	it('rejects a same-generation CRUD counter decrease', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 12);
		env.SECRETS_KV.putCalls = [];

		const response = await handleUpdateSecret(createUpdateRequest(secret, { name: 'Renamed token', counter: 2 }), env);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.details).toMatchObject({ requestedCounter: 2, currentCounter: 12 });
		expect((await getAllSecrets(env))[0]).toMatchObject({ name: secret.name, counter: 12 });
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
	});

	it('keeps the effective max counter in a same-generation CRUD response', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 12);

		const response = await handleUpdateSecret(createUpdateRequest(secret, { name: 'Renamed token', counter: 12 }), env);
		const body = await response.json();
		const [baseSecret] = await getBaseSecrets(env);

		expect(response.status).toBe(200);
		expect(body.data.secret.counter).toBe(12);
		expect(baseSecret).toMatchObject({ name: 'Renamed token', counter: 12 });
	});

	it('ignores a sidecar whose generation hash does not match', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, { ...secret, secret: 'MFRGGZDFMZTWQ2LK' }, 99);

		expect((await getAllSecrets(env))[0].counter).toBe(7);
	});

	it('isolates every generation including a return to the original seed', async () => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 50);

		const changedResponse = await handleUpdateSecret(
			createUpdateRequest(secret, {
				secret: 'MFRGGZDFMZTWQ2LK',
				counter: 1,
			}),
			env,
		);
		const changedSecret = (await changedResponse.json()).data.secret;
		expect((await handleAdvanceHOTPCounter(createCounterRequest(changedSecret), env)).status).toBe(200);
		const revertedResponse = await handleUpdateSecret(
			createUpdateRequest(changedSecret, {
				secret: secret.secret,
				counter: 2,
			}),
			env,
		);

		expect(changedResponse.status).toBe(200);
		expect(await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id))).not.toBeNull();
		expect(revertedResponse.status).toBe(200);
		const [revertedSecret] = await getAllSecrets(env);
		expect(revertedSecret.counter).toBe(2);
		expect(changedSecret.hotpCounterNamespace).toEqual(expect.any(String));
		expect(revertedSecret.hotpCounterNamespace).toEqual(expect.any(String));
		expect(revertedSecret.hotpCounterNamespace).not.toBe(changedSecret.hotpCounterNamespace);
		expect(env.SECRETS_KV.deleteCalls).toHaveLength(0);
		expect((await handleAdvanceHOTPCounter(createCounterRequest(revertedSecret), env)).status).toBe(200);
		expect((await getAllSecrets(env))[0].counter).toBe(3);
	});

	it.each([false, true])('preserves the old counter while a generation write is blocked and then fails=%s', async (failWrite) => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 50);
		const writeStarted = createDeferred();
		const releaseWrite = createDeferred();
		const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
		env.SECRETS_KV.put = vi.fn(async (key, value, options) => {
			if (key === 'secrets') {
				writeStarted.resolve();
				await releaseWrite.promise;
				if (failWrite) {
					throw new Error('base write failed');
				}
			}
			return originalPut(key, value, options);
		});

		const updatePromise = handleUpdateSecret(
			createUpdateRequest(secret, {
				secret: 'MFRGGZDFMZTWQ2LK',
				counter: 1,
			}),
			env,
		);
		await writeStarted.promise;
		const whileBlocked = await handleGetSecrets(env).then((response) => response.json());
		releaseWrite.resolve();
		const response = await updatePromise;

		expect(whileBlocked[0]).toMatchObject({ secret: secret.secret, counter: 50 });
		expect(response.status).toBe(failWrite ? 500 : 200);
		expect((await getAllSecrets(env))[0]).toMatchObject(
			failWrite ? { secret: secret.secret, counter: 50 } : { secret: 'MFRGGZDFMZTWQ2LK', counter: 1 },
		);
		expect(env.SECRETS_KV.deleteCalls).toHaveLength(0);
		expect(await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id))).not.toBeNull();
	});

	it.each([undefined, '9b2bbf04-0296-47c3-a401-b4275c0cf926'])('ignores delayed writes from an old namespace %s', async (namespace) => {
		const env = createEnv();
		const secret = createSecret({ ...(namespace && { hotpCounterNamespace: namespace }) });
		await seedSecrets(env, [secret]);
		const oldKey = getHOTPCounterStateKey(secret.id, 'legacy', namespace);
		const oldWriteStarted = createDeferred();
		const releaseOldWrite = createDeferred();
		const originalPut = env.SECRETS_KV.put.bind(env.SECRETS_KV);
		env.SECRETS_KV.put = vi.fn(async (key, value, options) => {
			if (key === oldKey) {
				oldWriteStarted.resolve();
				await releaseOldWrite.promise;
			}
			return originalPut(key, value, options);
		});

		const oldAdvancePromise = handleAdvanceHOTPCounter(createCounterRequest(secret), env);
		await oldWriteStarted.promise;
		const changedResponse = await handleUpdateSecret(
			createUpdateRequest(secret, {
				secret: 'MFRGGZDFMZTWQ2LK',
				counter: 0,
			}),
			env,
		);
		const changedSecret = (await changedResponse.json()).data.secret;
		const newAdvanceResponse = await handleAdvanceHOTPCounter(createCounterRequest(changedSecret), env);
		const beforeOldWrite = (await getAllSecrets(env))[0].counter;
		releaseOldWrite.resolve();
		const oldAdvanceResponse = await oldAdvancePromise;

		expect([changedResponse.status, newAdvanceResponse.status, oldAdvanceResponse.status]).toEqual([200, 200, 200]);
		expect(beforeOldWrite).toBe(1);
		expect((await getAllSecrets(env))[0]).toMatchObject({ secret: changedSecret.secret, counter: 1 });
	});

	it.each([undefined, '9b2bbf04-0296-47c3-a401-b4275c0cf926'])(
		'preserves server namespace %s on metadata edits and ignores client namespaces',
		async (namespace) => {
			const env = createEnv();
			const secret = createSecret({ ...(namespace && { hotpCounterNamespace: namespace }) });
			await seedSecrets(env, [secret]);
			await saveHOTPCounterState(env, secret, 12);

			const response = await handleUpdateSecret(
				createUpdateRequest(secret, {
					name: 'Renamed token',
					counter: 12,
					hotpCounterNamespace: 'client-controlled-namespace',
				}),
				env,
			);
			const [updatedSecret] = await getAllSecrets(env);

			expect(response.status).toBe(200);
			expect(updatedSecret.hotpCounterNamespace).toBe(namespace);
			expect(updatedSecret.counter).toBe(12);
			expect((await handleAdvanceHOTPCounter(createCounterRequest(updatedSecret), env)).status).toBe(200);
			expect((await getAllSecrets(env))[0].counter).toBe(13);
		},
	);

	it.each([undefined, null, 'old-namespace'])(
		'rejects request namespace %s for a namespaced secret without writing',
		async (expectedNamespace) => {
			const env = createEnv();
			const secret = createSecret({ hotpCounterNamespace: crypto.randomUUID() });
			await seedSecrets(env, [secret]);

			const response = await handleAdvanceHOTPCounter(createCounterRequest(secret, { expectedNamespace }), env);

			expect(response.status).toBe(409);
			expect(env.SECRETS_KV.putCalls).toHaveLength(0);
			expect((await getAllSecrets(env))[0].counter).toBe(secret.counter);
		},
	);

	it.each(['', 7, {}])('rejects malformed request namespace %j', async (expectedNamespace) => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);

		const response = await handleAdvanceHOTPCounter(createCounterRequest(secret, { expectedNamespace }), env);

		expect(response.status).toBe(400);
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
	});

	it('rejects a delayed client snapshot after A-to-B-to-A even if its seed and counter match again', async () => {
		const env = createEnv();
		const secret = createSecret({ hotpCounterNamespace: crypto.randomUUID() });
		await seedSecrets(env, [secret]);
		const staleRequest = createCounterRequest(secret);
		const changedResponse = await handleUpdateSecret(
			createUpdateRequest(secret, {
				secret: 'MFRGGZDFMZTWQ2LK',
				counter: 0,
			}),
			env,
		);
		const changedSecret = (await changedResponse.json()).data.secret;
		const revertedResponse = await handleUpdateSecret(
			createUpdateRequest(changedSecret, {
				secret: secret.secret,
				counter: secret.counter,
			}),
			env,
		);
		const revertedSecret = (await revertedResponse.json()).data.secret;
		env.SECRETS_KV.putCalls = [];

		const staleResponse = await handleAdvanceHOTPCounter(staleRequest, env);

		expect([changedResponse.status, revertedResponse.status]).toEqual([200, 200]);
		expect(revertedSecret.hotpCounterNamespace).not.toBe(secret.hotpCounterNamespace);
		expect(staleResponse.status).toBe(409);
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
		expect((await handleAdvanceHOTPCounter(createCounterRequest(revertedSecret), env)).status).toBe(200);
		expect((await getAllSecrets(env))[0].counter).toBe(secret.counter + 1);
	});

	it.each([{ digits: 6 }, { algorithm: 'SHA1' }, { type: 'TOTP' }])(
		'does not reuse state after changing generation parameters %o and changing back',
		async (changedFields) => {
			const env = createEnv();
			const secret = createSecret({ hotpCounterNamespace: crypto.randomUUID() });
			await seedSecrets(env, [secret]);
			await saveHOTPCounterState(env, secret, 50);
			const changedResponse = await handleUpdateSecret(
				createUpdateRequest(secret, {
					...changedFields,
					counter: 1,
					hotpCounterNamespace: secret.hotpCounterNamespace,
				}),
				env,
			);
			const changedSecret = (await changedResponse.json()).data.secret;
			const revertedResponse = await handleUpdateSecret(
				createUpdateRequest(changedSecret, {
					type: secret.type,
					digits: secret.digits,
					algorithm: secret.algorithm,
					counter: 2,
					hotpCounterNamespace: secret.hotpCounterNamespace,
				}),
				env,
			);
			const [revertedSecret] = await getAllSecrets(env);

			expect([changedResponse.status, revertedResponse.status]).toEqual([200, 200]);
			expect(revertedSecret.counter).toBe(2);
			expect(revertedSecret.hotpCounterNamespace).not.toBe(secret.hotpCounterNamespace);
			expect(revertedSecret.hotpCounterNamespace).not.toBe(changedSecret.hotpCounterNamespace);
			expect(env.SECRETS_KV.deleteCalls).toHaveLength(0);
		},
	);

	it('preserves namespace and effective counters through JSON backup and restore while invalidating old epochs', async () => {
		const env = createEnv();
		const secret = createSecret({ hotpCounterNamespace: '9b2bbf04-0296-47c3-a401-b4275c0cf926' });
		await seedSecrets(env, [secret]);
		await saveHOTPCounterState(env, secret, 12);
		const entry = await createBackupEntry(await getAllSecrets(env), env, { format: 'json' });
		const decoded = await decodeBackupEntry(entry.backupContent, env, { backupKey: entry.backupKey, metadata: entry.metadata });
		expect(decoded.secrets[0]).toMatchObject({ counter: 12, hotpCounterNamespace: secret.hotpCounterNamespace });
		await env.SECRETS_KV.put(entry.backupKey, entry.backupContent, { metadata: entry.metadata });
		await saveHOTPCounterState(env, secret, 99);

		const response = await handleRestoreBackup(
			new Request('https://example.com/api/backup/restore', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ backupKey: entry.backupKey }),
			}),
			env,
		);
		const [restored] = await getAllSecrets(env);
		expect(response.status).toBe(200);
		expect(restored).toMatchObject({ counter: 12, hotpCounterNamespace: secret.hotpCounterNamespace });
		expect(await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id, 'legacy', secret.hotpCounterNamespace))).not.toBeNull();
		expect((await handleAdvanceHOTPCounter(createCounterRequest(restored), env)).status).toBe(200);
		expect((await getAllSecrets(env))[0].counter).toBe(13);
	});

	it.each([undefined, '9b2bbf04-0296-47c3-a401-b4275c0cf926'])(
		'cleans the current sidecar on delete and leaves an inactive orphan if cleanup fails (%s)',
		async (namespace) => {
			const successEnv = createEnv();
			const secret = createSecret({ ...(namespace && { hotpCounterNamespace: namespace }) });
			const sidecarKey = getHOTPCounterStateKey(secret.id, 'legacy', namespace);
			await seedSecrets(successEnv, [secret]);
			await saveHOTPCounterState(successEnv, secret, 12);
			const deleteRequest = () =>
				new Request(`https://example.com/api/secrets/${secret.id}`, {
					method: 'DELETE',
					headers: { 'CF-Connecting-IP': '203.0.113.1' },
				});

			expect((await handleDeleteSecret(deleteRequest(), successEnv)).status).toBe(200);
			expect(await successEnv.SECRETS_KV.get(sidecarKey)).toBeNull();

			const failureEnv = createEnv();
			await seedSecrets(failureEnv, [secret]);
			await saveHOTPCounterState(failureEnv, secret, 12);
			const originalDelete = failureEnv.SECRETS_KV.delete.bind(failureEnv.SECRETS_KV);
			let failCleanup = true;
			failureEnv.SECRETS_KV.delete = vi.fn(async (key) => {
				if (key === sidecarKey && failCleanup) {
					throw new Error('sidecar delete failed');
				}
				return originalDelete(key);
			});

			expect((await handleDeleteSecret(deleteRequest(), failureEnv)).status).toBe(500);
			expect(await failureEnv.SECRETS_KV.get('secrets', 'text')).not.toBeNull();
			expect(await failureEnv.SECRETS_KV.get(sidecarKey)).not.toBeNull();
			expect(await handleGetSecrets(failureEnv).then((response) => response.json())).toEqual([]);

			failCleanup = false;
			expect((await handleDeleteSecret(deleteRequest(), failureEnv)).status).toBe(404);
			// A missing record provides no namespace to target; its orphan is inactive.
			expect(await failureEnv.SECRETS_KV.get(sidecarKey)).not.toBeNull();
		},
	);

	it.each([
		['secret', { expectedSecret: 'MFRGGZDFMZTWQ2LK' }],
		['digits', { expectedDigits: 6 }],
		['algorithm', { expectedAlgorithm: 'SHA1' }],
		['counter', { expectedCounter: 3 }],
	])('rejects a changed %s snapshot without writes', async (_field, override) => {
		const env = createEnv();
		const secret = createSecret();
		await seedSecrets(env, [secret]);

		expect((await handleAdvanceHOTPCounter(createCounterRequest(secret, override), env)).status).toBe(409);
		expect(env.SECRETS_KV.putCalls).toHaveLength(0);
	});

	it('rejects TOTP, unknown, invalid, and overflowing requests', async () => {
		const env = createEnv();
		const totp = createSecret({ type: 'TOTP', counter: undefined });
		await seedSecrets(env, [totp]);

		expect((await handleAdvanceHOTPCounter(createCounterRequest({ ...totp, counter: 0 }), env)).status).toBe(409);
		expect((await handleAdvanceHOTPCounter(createCounterRequest({ ...createSecret(), id: 'missing' }), env)).status).toBe(404);

		const invalid = createCounterRequest(createSecret(), { expectedCounter: Number.MAX_SAFE_INTEGER + 1 });
		expect((await handleAdvanceHOTPCounter(invalid, env)).status).toBe(400);

		const maxEnv = createEnv();
		const maxSecret = createSecret({ counter: Number.MAX_SAFE_INTEGER });
		await seedSecrets(maxEnv, [maxSecret]);
		expect((await handleAdvanceHOTPCounter(createCounterRequest(maxSecret), maxEnv)).status).toBe(409);
	});
});
