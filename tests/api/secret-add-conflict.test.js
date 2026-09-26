import { describe, expect, it } from 'vitest';

import { handleAddSecret } from '../../src/api/secrets/crud.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';

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

const STORED_TOTP = {
	id: 'github',
	name: 'GitHub',
	account: 'user@example.com',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const STORED_HOTP = {
	id: 'counter',
	name: 'Counter',
	account: '',
	secret: 'MFRGGZDFMZTWQ2LK',
	type: 'HOTP',
	digits: 8,
	period: 30,
	algorithm: 'SHA256',
	counter: 12,
};

function addBody(secret, changes = {}) {
	const { id: _id, ...fields } = secret;
	return { ...fields, ...changes };
}

async function addSecret(env, body, url = 'https://example.com/api/secrets') {
	const response = await handleAddSecret(
		new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
		env,
	);
	return { status: response.status, body: await response.json() };
}

async function conflictWith(stored, body) {
	const env = createMockEnv();
	await saveSecretsToKV(env, [stored], 'test');
	const result = await addSecret(env, body);

	expect(result.status).toBe(409);
	expect(await getAllSecrets(env)).toHaveLength(1);
	return result.body.details;
}

describe('adding a secret that already exists', () => {
	it('reports identical: true when the existing record generates the same codes', async () => {
		const details = await conflictWith(STORED_TOTP, addBody(STORED_TOTP));

		expect(details).toEqual({ operation: 'addSecret', name: 'GitHub', account: 'user@example.com', identical: true });
	});

	it('compares the normalized request, so letter case, secret spacing and omitted defaults still match', async () => {
		const details = await conflictWith(STORED_TOTP, {
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'jbsw y3dp ehpk 3pxp',
			type: 'totp',
			algorithm: 'sha1',
		});

		expect(details.identical).toBe(true);
	});

	it.each([
		['digits', { digits: 8 }],
		['algorithm', { algorithm: 'SHA256' }],
		['TOTP period', { period: 60 }],
		['type', { type: 'HOTP' }],
	])('reports identical: false when the %s differs', async (_label, changes) => {
		const details = await conflictWith(STORED_TOTP, addBody(STORED_TOTP, changes));

		expect(details.identical).toBe(false);
	});

	it('ignores the HOTP counter and period but compares the other HOTP parameters', async () => {
		expect((await conflictWith(STORED_HOTP, addBody(STORED_HOTP, { counter: 0, period: 60 }))).identical).toBe(true);
		expect((await conflictWith(STORED_HOTP, addBody(STORED_HOTP, { digits: 6 }))).identical).toBe(false);
		expect((await conflictWith(STORED_HOTP, addBody(STORED_HOTP, { algorithm: 'SHA1' }))).identical).toBe(false);
	});

	it('reads stored legacy values like the web UI does', async () => {
		const legacy = { id: 'legacy', name: 'Legacy', account: '', secret: 'JBSWY3DPEHPK3PXP' };
		const request = { name: 'Legacy', secret: 'JBSWY3DPEHPK3PXP' };

		// Missing type, digits, period and algorithm mean TOTP, 6, 30 and SHA1.
		expect((await conflictWith(legacy, request)).identical).toBe(true);
		expect((await conflictWith({ ...legacy, digits: 0, period: 0 }, request)).identical).toBe(true);
		expect((await conflictWith({ ...legacy, type: 'totp', algorithm: 'sha-256' }, { ...request, algorithm: 'SHA256' })).identical).toBe(
			true,
		);
		// A value the web UI cannot use never matches.
		expect((await conflictWith({ ...legacy, digits: 'abc' }, request)).identical).toBe(false);
		expect((await conflictWith({ ...legacy, period: 45 }, request)).identical).toBe(false);
	});

	it('keeps the boolean in a localized response', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [STORED_TOTP], 'test');
		const result = await addSecret(env, addBody(STORED_TOTP), 'https://example.com/api/secrets?lang=en');

		expect(result.status).toBe(409);
		expect(result.body.details.identical).toBe(true);
	});

	it('adds the secret when the name, account or secret differs', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [STORED_TOTP], 'test');

		expect((await addSecret(env, addBody(STORED_TOTP, { account: 'other@example.com' }))).status).toBe(201);
		expect(await getAllSecrets(env)).toHaveLength(2);
	});
});
