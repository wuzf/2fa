import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/router/handler.js';
import { SECRETS_STORE_OPERATION_HEADER } from '../../src/storage/secrets-store.js';
import { createStoreEnv } from '../helpers/store-fakes.js';

vi.mock('../../src/utils/auth.js', () => ({
	verifyAuthWithDetails: vi.fn(async () => ({ valid: true, needsRefresh: false })),
	requiresAuth: vi.fn((pathname) => pathname.startsWith('/api/')),
	createUnauthorizedResponse: vi.fn(() => new Response('{}', { status: 401 })),
	handleLogin: vi.fn(),
	handleLogout: vi.fn(),
	handleRefreshToken: vi.fn(),
	checkIfSetupRequired: vi.fn(async () => false),
	handleFirstTimeSetup: vi.fn(),
}));

async function operationFor(method, path, body) {
	const env = createStoreEnv();
	const request = new Request(`https://2fa.example.com${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	await handleRequest(request, env, { waitUntil() {} });
	return env.SECRETS_STORE.requests.map((forwarded) => forwarded.headers.get(SECRETS_STORE_OPERATION_HEADER));
}

describe('router and secrets store', () => {
	it.each([
		['GET', '/api/secrets', undefined, 'secrets.list'],
		['POST', '/api/secrets', { name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }, 'secrets.add'],
		['POST', '/api/secrets/batch', { secrets: [] }, 'secrets.batch'],
		['PUT', '/api/secrets/abc', { name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }, 'secrets.update'],
		['DELETE', '/api/secrets/abc', undefined, 'secrets.delete'],
		['POST', '/api/secrets/abc/counter', {}, 'secrets.counter'],
		['POST', '/api/secrets/counters/compact', {}, 'secrets.compact'],
		['POST', '/api/backup', {}, 'backup.create'],
		['POST', '/api/backup/restore', {}, 'backup.restore'],
	])('sends %s %s to the store', async (method, path, body, operation) => {
		expect(await operationFor(method, path, body)).toEqual([operation]);
	});

	it.each([
		['GET', '/api/backup'],
		['GET', '/api/settings'],
		['POST', '/api/secrets/export', { format: 'json', secrets: [] }],
	])('handles %s %s without the store', async (method, path, body) => {
		expect(await operationFor(method, path, body)).toEqual([]);
	});
});
