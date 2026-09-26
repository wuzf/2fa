import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRequest } from '../../src/router/handler.js';
import { decryptSecrets } from '../../src/utils/encryption.js';

const ORIGIN = 'https://vault.example';
const PASSWORD = 'test-password-hash';
const ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012').toString('base64');

// Same JWT signing and KV shapes as the existing real-auth router and HOTP
// API fixtures. Only storage is substituted; every handler remains real.
function managementToken() {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ exp: now + 30 * 86400, iat: now });
	return body + '.' + createHmac('sha256', PASSWORD).update(body).digest('base64url');
}

class MemoryKV {
	store = new Map();
	metadata = new Map();
	async get(key, type = 'text') {
		if (Array.isArray(key)) {
			return new Map(key.map((item) => [item, this.store.get(item) ?? null]));
		}
		const value = this.store.get(key) ?? null;
		return value !== null && type === 'json' ? JSON.parse(value) : value;
	}
	async put(key, value, options = {}) {
		this.store.set(key, value);
		this.metadata.set(key, options.metadata);
	}
	async delete(key) {
		this.store.delete(key);
		this.metadata.delete(key);
	}
	async list({ prefix = '', limit = 1000, cursor } = {}) {
		const keys = [...this.store.keys()].filter((name) => name.startsWith(prefix)).sort();
		const start = Number(cursor || 0);
		const next = start + limit;
		return {
			keys: keys.slice(start, next).map((name) => ({ name, metadata: this.metadata.get(name) })),
			list_complete: next >= keys.length,
			...(next < keys.length ? { cursor: String(next) } : {}),
		};
	}
}

function account(name, overrides = {}) {
	return {
		name,
		account: name + '@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'TOTP',
		digits: 6,
		period: 30,
		algorithm: 'SHA1',
		...overrides,
	};
}

describe('authenticated routes with the original KV-only deployment', () => {
	let env;
	let token;
	let background;
	beforeEach(() => {
		env = { SECRETS_KV: new MemoryKV(), ENCRYPTION_KEY, LOG_LEVEL: 'ERROR' };
		env.SECRETS_KV.store.set('user_password', PASSWORD);
		env.SECRETS_KV.store.set('settings', JSON.stringify({ maxBackups: 0, defaultExportFormat: 'json' }));
		token = managementToken();
		background = [];
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	async function call(path, { method = 'GET', body, authenticated = true, headers = {} } = {}) {
		const response = await handleRequest(
			new Request(ORIGIN + path, {
				method,
				headers: {
					...(authenticated ? { Cookie: 'auth_token=' + token } : {}),
					Origin: ORIGIN,
					'Content-Type': 'application/json',
					'CF-Connecting-IP': '203.0.113.1',
					...headers,
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
			env,
			{ waitUntil: (task) => background.push(task) },
		);
		while (background.length) {
			await Promise.all(background.splice(0));
		}
		return response;
	}

	async function add(data) {
		const response = await call('/api/secrets', { method: 'POST', body: data });
		expect(response.status).toBe(201);
		return (await response.json()).data.secret;
	}

	it('still requires management authentication before reading or changing the KV vault', async () => {
		for (const [path, method, body] of [
			['/api/secrets', 'GET'],
			['/api/secrets', 'POST', account('Blocked')],
			['/api/secrets/batch', 'POST', { secrets: [account('Blocked')] }],
			['/api/backup/restore', 'POST', {}],
		]) {
			expect((await call(path, { method, body, authenticated: false })).status).toBe(401);
		}
		expect(env.SECRETS_KV.store.has('secrets')).toBe(false);
	});

	it('adds, reads, edits and deletes an encrypted account without additional storage bindings', async () => {
		const created = await add(account('GitHub'));
		const raw = await env.SECRETS_KV.get('secrets');
		expect(raw).toMatch(/^v1:/);
		expect(raw).not.toContain(created.secret);
		const listed = await call('/api/secrets');
		expect(listed.status).toBe(200);
		expect(listed.headers.get('Cache-Control')).toBe('no-store');
		expect(await listed.json()).toEqual([created]);

		const updated = await call('/api/secrets/' + created.id, {
			method: 'PUT',
			body: account('Renamed GitHub', { account: 'new@example.com' }),
		});
		expect(updated.status).toBe(200);
		expect((await updated.json()).data.secret).toMatchObject({ id: created.id, name: 'Renamed GitHub', account: 'new@example.com' });
		expect(await (await call('/api/secrets')).json()).toEqual([
			expect.objectContaining({ id: created.id, name: 'Renamed GitHub', account: 'new@example.com' }),
		]);

		expect((await call('/api/secrets/' + created.id, { method: 'DELETE' })).status).toBe(200);
		expect(await (await call('/api/secrets')).json()).toEqual([]);
		expect(await decryptSecrets(await env.SECRETS_KV.get('secrets'), env)).toEqual([]);
	});

	it('advances an HOTP counter through KV sidecars and compacts the effective value', async () => {
		const created = await add(account('Security Key', { type: 'HOTP', counter: 7, digits: 8, algorithm: 'SHA256' }));
		const rawBefore = await env.SECRETS_KV.get('secrets');
		const expected = {
			expectedNamespace: created.hotpCounterNamespace || null,
			expectedCounter: 7,
			expectedSecret: created.secret,
			expectedDigits: created.digits,
			expectedAlgorithm: created.algorithm,
		};
		const advanced = await call('/api/secrets/' + created.id + '/counter', { method: 'POST', body: expected });
		expect(advanced.status).toBe(200);
		expect((await advanced.json()).data.counter).toBe(8);
		expect(await env.SECRETS_KV.get('secrets')).toBe(rawBefore);
		expect(await (await call('/api/secrets')).json()).toEqual([expect.objectContaining({ id: created.id, counter: 8 })]);
		expect((await call('/api/secrets/' + created.id + '/counter', { method: 'POST', body: expected })).status).toBe(409);

		const compacted = await call('/api/secrets/counters/compact', {
			method: 'POST',
			headers: { 'X-Confirm-Maintenance': 'compact-hotp-counters' },
		});
		expect(compacted.status).toBe(200);
		expect((await decryptSecrets(await env.SECRETS_KV.get('secrets'), env))[0].counter).toBe(8);
		expect(await (await call('/api/secrets')).json()).toEqual([expect.objectContaining({ id: created.id, counter: 8 })]);
	});

	it('imports accounts, creates a KV backup, and restores that backup through authenticated routes', async () => {
		const imported = await call('/api/secrets/batch', {
			method: 'POST',
			body: { secrets: [account('GitHub'), account('Google')] },
		});
		expect(imported.status).toBe(200);
		expect(await imported.json()).toMatchObject({ success: true, successCount: 2, failCount: 0 });
		const original = await (await call('/api/secrets')).json();
		expect(original).toHaveLength(2);
		const backedUp = await call('/api/backup', { method: 'POST' });
		expect(backedUp.status).toBe(200);
		const { backupKey } = await backedUp.json();
		expect(await env.SECRETS_KV.get(backupKey)).toMatch(/^v1:/);

		await add(account('Later Account'));
		expect(await (await call('/api/secrets')).json()).toHaveLength(3);
		const restored = await call('/api/backup/restore', { method: 'POST', body: { backupKey } });
		expect(restored.status).toBe(200);
		expect(await restored.json()).toMatchObject({ success: true, count: 2, backupKey });
		// Portable backups normalize the otherwise-unused TOTP counter to zero.
		expect(await (await call('/api/secrets')).json()).toEqual(original.map((secret) => ({ ...secret, counter: 0 })));
	});
});
