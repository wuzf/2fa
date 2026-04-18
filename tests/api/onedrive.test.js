import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	handleGetOneDriveConfigs,
	handleOneDriveOAuthCallback,
	handleSaveOneDriveConfig,
	handleStartOneDriveOAuth,
	handleToggleOneDrive,
} from '../../src/api/onedrive.js';
import { createOAuthState } from '../../src/utils/oauth.js';
import { saveOneDriveSingleConfig } from '../../src/utils/onedrive.js';

class MockKV {
	constructor() {
		this.store = new Map();
	}

	async get(key, type = 'text') {
		const value = this.store.get(key);
		if (value === undefined || value === null) {
			return null;
		}
		if (type === 'json') {
			return typeof value === 'object' ? value : JSON.parse(value);
		}
		return typeof value === 'object' ? JSON.stringify(value) : value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}

	async delete(key) {
		this.store.delete(key);
	}
}

function createMockEnv() {
	return {
		SECRETS_KV: new MockKV(),
		ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
		ONEDRIVE_CLIENT_ID: 'onedrive-client-id',
		ONEDRIVE_CLIENT_SECRET: 'onedrive-client-secret',
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/onedrive/config') {
	return {
		method,
		url,
		headers: new Headers({
			'Content-Type': 'application/json',
			'CF-Connecting-IP': '203.0.113.1',
			Origin: 'https://example.com',
			Host: 'example.com',
		}),
		json: async () => body,
	};
}

describe('OneDrive API', () => {
	let env;
	let originalFetch;

	beforeEach(() => {
		env = createMockEnv();
		originalFetch = globalThis.fetch;
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('should return empty OneDrive destinations by default', async () => {
		const response = await handleGetOneDriveConfigs(createMockRequest({}, 'GET'), env);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.destinations).toEqual([]);
		expect(data.oauthConfigured).toBe(true);
	});

	it('should save a OneDrive destination', async () => {
		const response = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.id).toBeTruthy();
	});

	it('should block enabling unauthorized OneDrive destinations', async () => {
		const createResponse = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		const toggleResponse = await handleToggleOneDrive(
			createMockRequest({ id: createData.id, enabled: true }, 'POST', 'https://example.com/api/onedrive/toggle'),
			env,
		);

		expect(toggleResponse.status).toBe(400);
	});

	it('should start OneDrive OAuth after config is saved', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		const response = await handleStartOneDriveOAuth(
			createMockRequest({ id: createData.id }, 'POST', 'https://app.example.com/api/onedrive/oauth/start'),
			env,
		);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.authorizeUrl).toContain('login.microsoftonline.com');
		expect(data.callbackOrigin).toBe('https://auth.example.com');
	});

	it('should complete OneDrive OAuth callback and persist authorization', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'onedrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl.includes('/oauth2/v2.0/token')) {
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access-token',
						refresh_token: 'fresh-refresh-token',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.includes('/me?$select=')) {
				return new Response(
					JSON.stringify({
						displayName: 'Work User',
						mail: 'user@example.com',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.endsWith('/me/drive/special/approot')) {
				return new Response(JSON.stringify({ id: 'app-root-id' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/app-root-id/children?$select=')) {
				return new Response(JSON.stringify({ value: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.endsWith('/me/drive/items/app-root-id/children')) {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 201,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/folder-id-1:/.2fa-onedrive-test.json:/content')) {
				return new Response('', { status: 201 });
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleOneDriveOAuthCallback(
			createMockRequest(
				{},
				'GET',
				`https://auth.example.com/api/onedrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
			),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(200);
		expect(html).toContain('授权成功');
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');

		const listResponse = await handleGetOneDriveConfigs(createMockRequest({}, 'GET'), env);
		const listData = await listResponse.json();
		expect(listData.destinations[0].authorized).toBe(true);
		// 首次授权 + 连接测试通过后，目标默认启用，用户无需再手动打开开关。
		expect(listData.destinations[0].enabled).toBe(true);
		expect(listData.destinations[0].account.email).toBe('user@example.com');
		expect(listData.destinations[0].status.lastSuccess).toBeNull();
	});

	it('should preserve enabled state when reauthorizing an already enabled OneDrive destination', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		await saveOneDriveSingleConfig(env, {
			id: createData.id,
			authorized: true,
			enabled: true,
			refreshToken: 'old-refresh-token',
			accessToken: 'old-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
		});

		const state = await createOAuthState(env, {
			provider: 'onedrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl.includes('/oauth2/v2.0/token')) {
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access-token',
						refresh_token: 'fresh-refresh-token',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.includes('/me?$select=')) {
				return new Response(
					JSON.stringify({
						displayName: 'Work User',
						mail: 'user@example.com',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.endsWith('/me/drive/special/approot')) {
				return new Response(JSON.stringify({ id: 'app-root-id' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/app-root-id/children?$select=')) {
				return new Response(JSON.stringify({ value: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.endsWith('/me/drive/items/app-root-id/children')) {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 201,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/folder-id-1:/.2fa-onedrive-test.json:/content')) {
				return new Response('', { status: 201 });
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleOneDriveOAuthCallback(
			createMockRequest(
				{},
				'GET',
				`https://auth.example.com/api/onedrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
			),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(200);
		expect(html).toContain('当前目标保持启用');

		const listResponse = await handleGetOneDriveConfigs(createMockRequest({}, 'GET'), env);
		const listData = await listResponse.json();
		expect(listData.destinations[0].authorized).toBe(true);
		expect(listData.destinations[0].enabled).toBe(true);
	});

	it('should route expired OneDrive state failures back to the original app origin', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveOneDriveConfig(
			createMockRequest({
				name: 'Work OneDrive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'onedrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});
		await env.SECRETS_KV.delete(`oauth_state_${state}`);

		const callbackResponse = await handleOneDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://auth.example.com/api/onedrive/oauth/callback?state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(400);
		expect(html).toContain('OAuth state 无效或已过期');
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');
	});
});
