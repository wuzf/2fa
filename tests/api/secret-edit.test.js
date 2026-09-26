import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { handleAdvanceHOTPCounter } from '../../src/api/secrets/counter.js';
import { handleDeleteSecret, handleUpdateSecret } from '../../src/api/secrets/crud.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';
import { handleRequest } from '../../src/router/handler.js';

const PASSWORD_HASH = 'test-password-hash';

class MockKV {
	constructor() {
		this.store = new Map();
	}

	async get(key, type = 'text') {
		if (Array.isArray(key)) {
			return new Map(await Promise.all(key.map(async (item) => [item, await this.get(item, type)])));
		}

		const value = this.store.get(key);
		if (value === undefined) {
			return null;
		}

		return type === 'json' ? JSON.parse(value) : value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}

	async delete(key) {
		this.store.delete(key);
	}

	async list(options = {}) {
		const prefix = options.prefix || '';
		return {
			keys: Array.from(this.store.keys())
				.filter((key) => key.startsWith(prefix))
				.map((name) => ({ name })),
			list_complete: true,
		};
	}
}

function createMockEnv() {
	return {
		SECRETS_KV: new MockKV(),
		ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
		LOG_LEVEL: 'ERROR',
	};
}

const TOTP_SECRET = {
	id: 'totp-45',
	name: 'Legacy period',
	account: 'user@example.com',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 45,
	algorithm: 'SHA1',
};

function editBody(secret, changes = {}) {
	const { id: _id, ...fields } = secret;
	return { ...fields, ...changes };
}

function putSecret(path, body) {
	return new Request(`https://example.com${path}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('editing a TOTP record with a non-standard period', () => {
	it('keeps a stored 45 second period when only the name changes', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [TOTP_SECRET], 'test');

		const response = await handleUpdateSecret(putSecret('/api/secrets/totp-45', editBody(TOTP_SECRET, { name: 'Renamed' })), env);
		const [stored] = await getAllSecrets(env);

		expect(response.status).toBe(200);
		expect(stored).toMatchObject({ id: 'totp-45', name: 'Renamed', period: 45 });
	});

	it.each([
		['changing a standard period to 45 seconds', { ...TOTP_SECRET, period: 30 }, 45],
		['changing a stored 45 second period to another non-standard value', TOTP_SECRET, 50],
	])('rejects %s', async (_label, storedSecret, requestedPeriod) => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [storedSecret], 'test');

		const response = await handleUpdateSecret(
			putSecret('/api/secrets/totp-45', editBody(storedSecret, { name: 'Renamed', period: requestedPeriod })),
			env,
		);
		const data = await response.json();
		const [stored] = await getAllSecrets(env);

		expect(response.status).toBe(400);
		expect(data.message).toContain('TOTP周期仅支持30、60或120秒');
		expect(stored).toMatchObject({ name: storedSecret.name, period: storedSecret.period });
	});

	it('still validates the other fields of a record that keeps its stored period', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [TOTP_SECRET], 'test');

		const response = await handleUpdateSecret(putSecret('/api/secrets/totp-45', editBody(TOTP_SECRET, { digits: 7 })), env);

		expect(response.status).toBe(400);
		expect((await response.json()).message).toContain('验证码位数仅支持6位或8位');
	});
});

describe('editing a HOTP record with a non-standard period', () => {
	const HOTP_SECRET = { ...TOTP_SECRET, id: 'hotp-45', name: 'Legacy HOTP', type: 'HOTP', counter: 3 };

	it.each([45, 0])('keeps a stored period of %i when only the name changes', async (period) => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [{ ...HOTP_SECRET, period }], 'test');

		const response = await handleUpdateSecret(
			putSecret('/api/secrets/hotp-45', editBody({ ...HOTP_SECRET, period }, { name: 'Renamed' })),
			env,
		);
		const [stored] = await getAllSecrets(env);

		expect(response.status).toBe(200);
		expect(stored).toMatchObject({ id: 'hotp-45', name: 'Renamed', type: 'HOTP', period, counter: 3 });
	});

	it.each([
		['changing a standard HOTP period to 45 seconds', { ...HOTP_SECRET, period: 30 }, { period: 45 }],
		['switching a 45 second HOTP record to TOTP', HOTP_SECRET, { type: 'TOTP' }],
		['switching a 45 second TOTP record to HOTP', { ...TOTP_SECRET, id: 'hotp-45' }, { type: 'HOTP', counter: 0 }],
	])('rejects %s', async (_label, storedSecret, changes) => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [storedSecret], 'test');

		const response = await handleUpdateSecret(putSecret('/api/secrets/hotp-45', editBody(storedSecret, changes)), env);
		const [stored] = await getAllSecrets(env);

		expect(response.status).toBe(400);
		expect((await response.json()).message).toContain('TOTP周期仅支持30、60或120秒');
		expect(stored).toMatchObject({ type: storedSecret.type, period: storedSecret.period });
	});
});

describe('partial updates keep the omitted fields', () => {
	const HOTP_SECRET = {
		id: 'hotp-8',
		name: 'Counter',
		account: 'ops@example.com',
		secret: 'MFRGGZDFMZTWQ2LK',
		type: 'HOTP',
		digits: 8,
		period: 30,
		algorithm: 'SHA256',
		counter: 12,
	};

	async function editStored(storedSecret, body) {
		const env = createMockEnv();
		await saveSecretsToKV(env, [storedSecret], 'test');
		const response = await handleUpdateSecret(putSecret(`/api/secrets/${storedSecret.id}`, body), env);
		const [stored] = await getAllSecrets(env);
		return { status: response.status, data: await response.json(), stored };
	}

	it('keeps the account, type, digits, algorithm and a stored 45 second TOTP period', async () => {
		const stored = { ...TOTP_SECRET, digits: 8, algorithm: 'SHA512' };
		const result = await editStored(stored, { name: 'Renamed', secret: TOTP_SECRET.secret });

		expect(result.status).toBe(200);
		expect(result.stored).toEqual({ ...stored, name: 'Renamed' });
	});

	it('keeps a HOTP record and its current counter when only the name and secret are sent', async () => {
		const result = await editStored(HOTP_SECRET, { name: 'Renamed', secret: HOTP_SECRET.secret });

		expect(result.status).toBe(200);
		expect(result.stored).toMatchObject({ ...HOTP_SECRET, name: 'Renamed' });
	});

	it('restarts an omitted HOTP counter at 0 when the secret, digits or algorithm change', async () => {
		for (const change of [{ secret: 'JBSWY3DPEHPK3PXQ' }, { digits: 6 }, { algorithm: 'SHA1' }]) {
			const result = await editStored(HOTP_SECRET, { name: 'Renamed', secret: HOTP_SECRET.secret, ...change });
			expect(result.status, JSON.stringify(change)).toBe(200);
			expect(result.stored, JSON.stringify(change)).toMatchObject({ ...change, counter: 0 });
		}
	});

	it('keeps an omitted HOTP counter when the secret only differs in case and spacing', async () => {
		const secret = HOTP_SECRET.secret
			.toLowerCase()
			.replace(/(.{4})/g, '$1 ')
			.trim();
		const result = await editStored(HOTP_SECRET, { name: 'Renamed', secret });

		expect(result.status).toBe(200);
		expect(result.stored.counter).toBe(HOTP_SECRET.counter);
	});

	it('uses an explicit HOTP counter when the secret changes', async () => {
		const result = await editStored(HOTP_SECRET, { name: 'Renamed', secret: 'JBSWY3DPEHPK3PXQ', counter: 9 });

		expect(result.status).toBe(200);
		expect(result.stored.counter).toBe(9);
	});

	it('treats null like an omitted field and an empty account as clearing it', async () => {
		const kept = await editStored(TOTP_SECRET, { name: 'Renamed', secret: TOTP_SECRET.secret, account: null, period: null });
		expect(kept.stored).toMatchObject({ account: TOTP_SECRET.account, period: 45 });

		const cleared = await editStored(TOTP_SECRET, { name: 'Renamed', secret: TOTP_SECRET.secret, account: '' });
		expect(cleared.stored).toMatchObject({ account: '', period: 45 });
	});

	it('uses the add defaults for period and counter when the type changes', async () => {
		const toHotp = await editStored(TOTP_SECRET, { name: 'Now HOTP', secret: TOTP_SECRET.secret, type: 'HOTP' });
		expect(toHotp.status).toBe(200);
		expect(toHotp.stored).toMatchObject({ type: 'HOTP', period: 30, counter: 0, digits: 6, account: TOTP_SECRET.account });

		const toTotp = await editStored({ ...HOTP_SECRET, period: 45 }, { name: 'Now TOTP', secret: HOTP_SECRET.secret, type: 'TOTP' });
		expect(toTotp.status).toBe(200);
		expect(toTotp.stored).toMatchObject({ type: 'TOTP', period: 30, digits: 8, algorithm: 'SHA256' });
		expect(toTotp.stored.counter).toBeUndefined();
	});

	it('validates an omitted field like its stored value was sent', async () => {
		// E.g. a record restored with 5 digits: the edit has to choose 6 or 8 either way.
		const stored = { ...TOTP_SECRET, period: 30, digits: 5 };
		const omitted = await editStored(stored, { name: 'Renamed', secret: TOTP_SECRET.secret });
		const sent = await editStored(stored, editBody(stored, { name: 'Renamed' }));

		expect(omitted.status).toBe(400);
		expect(omitted.data.message).toContain('验证码位数仅支持6位或8位');
		expect(sent.status).toBe(400);
		expect(sent.data.message).toBe(omitted.data.message);
		expect(omitted.stored).toEqual(stored);
	});

	it('reads stored legacy values like the web UI does', async () => {
		const legacy = { id: 'legacy', name: 'Legacy', secret: 'JBSWY3DPEHPK3PXP' };
		const bare = await editStored(legacy, { name: 'Renamed', secret: legacy.secret });
		expect(bare.status).toBe(200);
		expect(bare.stored).toMatchObject({ account: '', type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1' });

		const loose = await editStored(
			{ ...legacy, type: 'totp', digits: '8', period: 0, algorithm: 'sha-256' },
			{ name: 'Renamed', secret: legacy.secret },
		);
		expect(loose.status).toBe(200);
		expect(loose.stored).toMatchObject({ type: 'TOTP', digits: 8, period: 30, algorithm: 'SHA256' });

		// HOTP does not use the period: an unusable stored value falls back to 30 instead of failing.
		const hotp = await editStored({ ...HOTP_SECRET, period: 'n/a' }, { name: 'Renamed', secret: HOTP_SECRET.secret });
		expect(hotp.status).toBe(200);
		expect(hotp.stored).toMatchObject({ period: 30, counter: 12 });
	});
});

describe('secret ids in request paths', () => {
	const RESERVED_IDS = ['folder/child', '50%off', 'query?x', 'hash#y', 'mixed/%?#'];

	function sessionCookie() {
		const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
		const now = Math.floor(Date.now() / 1000);
		const body = encoded({ alg: 'HS256', typ: 'JWT' }) + '.' + encoded({ exp: now + 86400, iat: now });
		return `auth_token=${body}.${createHmac('sha256', PASSWORD_HASH).update(body).digest('base64url')}`;
	}

	async function seed(secrets) {
		const env = createMockEnv();
		await env.SECRETS_KV.put('user_password', PASSWORD_HASH);
		await saveSecretsToKV(env, secrets, 'test');
		return env;
	}

	it.each(RESERVED_IDS)('edits and deletes the record with id %j when the client encodes it', async (id) => {
		const env = await seed([{ ...TOTP_SECRET, id, period: 30 }]);
		const path = `/api/secrets/${encodeURIComponent(id)}`;

		const updateResponse = await handleUpdateSecret(putSecret(path, editBody({ ...TOTP_SECRET, period: 30 }, { name: 'Renamed' })), env);
		expect(updateResponse.status).toBe(200);
		expect(await getAllSecrets(env)).toMatchObject([{ id, name: 'Renamed' }]);

		const deleteResponse = await handleDeleteSecret(new Request(`https://example.com${path}`, { method: 'DELETE' }), env);
		expect(deleteResponse.status).toBe(200);
		expect((await deleteResponse.json()).data).toEqual({ id });
		expect(await getAllSecrets(env)).toEqual([]);
	});

	it('routes an encoded slash to the single-secret handlers instead of treating it as a sub-path', async () => {
		const id = 'folder/child';
		const env = await seed([{ ...TOTP_SECRET, id, period: 30 }]);
		const headers = { 'Content-Type': 'application/json', Cookie: sessionCookie() };
		const path = `https://example.com/api/secrets/${encodeURIComponent(id)}`;

		const updateResponse = await handleRequest(
			new Request(path, { method: 'PUT', headers, body: JSON.stringify(editBody({ ...TOTP_SECRET, period: 30 }, { name: 'Routed' })) }),
			env,
		);
		expect(updateResponse.status).toBe(200);
		expect(await getAllSecrets(env)).toMatchObject([{ id, name: 'Routed' }]);

		// An unencoded slash is still a different, unknown endpoint.
		const unencoded = await handleRequest(new Request(`https://example.com/api/secrets/${id}`, { method: 'DELETE', headers }), env);
		expect(unencoded.status).toBe(404);
		expect(await getAllSecrets(env)).toHaveLength(1);
	});

	it('advances the HOTP counter of a record whose id needs encoding', async () => {
		const secret = { ...TOTP_SECRET, id: 'key/1?#', type: 'HOTP', counter: 4 };
		const env = await seed([secret]);

		const response = await handleAdvanceHOTPCounter(
			new Request(`https://example.com/api/secrets/${encodeURIComponent(secret.id)}/counter`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					expectedNamespace: null,
					expectedCounter: 4,
					expectedSecret: secret.secret,
					expectedDigits: secret.digits,
					expectedAlgorithm: secret.algorithm,
				}),
			}),
			env,
		);

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ id: secret.id, counter: 5 });
	});

	it.each([
		['edit', (path) => handleUpdateSecret(putSecret(path, editBody(TOTP_SECRET)), createMockEnv())],
		['delete', (path) => handleDeleteSecret(new Request(`https://example.com${path}`, { method: 'DELETE' }), createMockEnv())],
		[
			'counter',
			(path) =>
				handleAdvanceHOTPCounter(
					new Request(`https://example.com${path}/counter`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ expectedCounter: 0, expectedSecret: 'JBSWY3DPEHPK3PXP', expectedDigits: 6, expectedAlgorithm: 'SHA1' }),
					}),
					createMockEnv(),
				),
		],
	])('rejects a malformed percent-encoded id on %s with 400', async (_label, call) => {
		const response = await call('/api/secrets/bad%E0%A4%A');
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data).toMatchObject({ error: '无效路径', message: '路径中的密钥ID编码无效' });
	});
});
