import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { handleRequest } from '../../src/router/handler.js';

const ORIGIN = 'https://vault.example';
const PASSWORD = 'test-password-hash';

function jwt() {
	const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const body = encoded({ alg: 'HS256', typ: 'JWT' }) + '.' + encoded({ exp: now + 30 * 86400, iat: now });
	return body + '.' + createHmac('sha256', PASSWORD).update(body).digest('base64url');
}

describe('removed device authorization routes', () => {
	let env;
	beforeEach(() => {
		env = {
			SECRETS_KV: {
				get: vi.fn(async (key) => (key === 'user_password' ? PASSWORD : null)),
				put: vi.fn(),
				delete: vi.fn(),
				list: vi.fn(async () => ({ keys: [], list_complete: true })),
			},
			LOG_LEVEL: 'ERROR',
		};
	});

	function call(path, { method = 'GET', cookie = true, authorization } = {}) {
		return handleRequest(
			new Request(ORIGIN + path, {
				method,
				headers: {
					...(cookie ? { Cookie: 'auth_token=' + jwt() } : {}),
					...(authorization ? { Authorization: authorization } : {}),
				},
			}),
			env,
		);
	}

	it.each([
		['/devices', 'GET'],
		['/api/extension/devices', 'GET'],
		['/api/extension/devices', 'POST'],
		['/api/extension/devices/' + 'a'.repeat(32), 'DELETE'],
		['/api/extension/accounts', 'GET'],
		['/api/extension/codes', 'POST'],
	])('does not expose %s (%s) even to a logged-in administrator', async (path, method) => {
		const response = await call(path, { method });
		expect(response.status).toBe(404);
		expect(env.SECRETS_KV.put).not.toHaveBeenCalled();
		expect(env.SECRETS_KV.delete).not.toHaveBeenCalled();
		expect(env.SECRETS_KV.list).not.toHaveBeenCalled();
	});

	it.each(['cookie', 'bearer'])('preserves account access through existing management %s authentication', async (mode) => {
		const response = await call('/api/secrets', {
			cookie: mode === 'cookie',
			authorization: mode === 'bearer' ? 'Bearer ' + jwt() : undefined,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual([]);
	});

	it('preserves the public clock endpoint without reading credentials or KV', async () => {
		const response = await call('/api/time', { cookie: false });
		expect(response.status).toBe(200);
		expect(env.SECRETS_KV.get).not.toHaveBeenCalled();
	});
});
