import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	handleGetGoogleDriveConfigs,
	handleGoogleDriveOAuthCallback,
	handleSaveGoogleDriveConfig,
	handleStartGoogleDriveOAuth,
	handleToggleGoogleDrive,
} from '../../src/api/gdrive.js';
import { createOAuthState } from '../../src/utils/oauth.js';
import { saveGoogleDriveSingleConfig } from '../../src/utils/gdrive.js';

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
		GOOGLE_DRIVE_CLIENT_ID: 'gdrive-client-id',
		GOOGLE_DRIVE_CLIENT_SECRET: 'gdrive-client-secret',
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/gdrive/config') {
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

describe('Google Drive API', () => {
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

	it('should return empty Google Drive destinations by default', async () => {
		const response = await handleGetGoogleDriveConfigs(createMockRequest({}, 'GET'), env);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.destinations).toEqual([]);
		expect(data.oauthConfigured).toBe(true);
	});

	it('should save a Google Drive destination', async () => {
		const response = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.id).toBeTruthy();
	});

	it('should block enabling unauthorized Google Drive destinations', async () => {
		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		const toggleResponse = await handleToggleGoogleDrive(
			createMockRequest({ id: createData.id, enabled: true }, 'POST', 'https://example.com/api/gdrive/toggle'),
			env,
		);

		expect(toggleResponse.status).toBe(400);
	});

	it('should start Google Drive OAuth after config is saved', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		const response = await handleStartGoogleDriveOAuth(
			createMockRequest({ id: createData.id }, 'POST', 'https://app.example.com/api/gdrive/oauth/start'),
			env,
		);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.authorizeUrl).toContain('accounts.google.com');
		expect(data.callbackOrigin).toBe('https://auth.example.com');
	});

	it('should complete Google Drive OAuth callback and persist authorization', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl === 'https://oauth2.googleapis.com/token') {
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access-token',
						refresh_token: 'fresh-refresh-token',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl === 'https://www.googleapis.com/oauth2/v2/userinfo') {
				return new Response(
					JSON.stringify({
						name: 'Drive User',
						email: 'drive@example.com',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';

				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes('.2fa-google-drive-test.json')) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname')) {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
				return new Response(JSON.stringify({ id: 'file-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleGoogleDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://auth.example.com/api/gdrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(200);
		expect(html).toContain('授权成功');
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');

		const listResponse = await handleGetGoogleDriveConfigs(createMockRequest({}, 'GET'), env);
		const listData = await listResponse.json();
		expect(listData.destinations[0].authorized).toBe(true);
		// 首次授权 + 连接测试通过后，目标默认启用，用户无需再手动打开开关。
		expect(listData.destinations[0].enabled).toBe(true);
		expect(listData.destinations[0].account.email).toBe('drive@example.com');
		expect(listData.destinations[0].status.lastSuccess).toBeNull();
	});

	it('should preserve enabled state when reauthorizing an already enabled Google Drive destination', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();

		await saveGoogleDriveSingleConfig(env, {
			id: createData.id,
			authorized: true,
			enabled: true,
			refreshToken: 'old-refresh-token',
			accessToken: 'old-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
		});

		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl === 'https://oauth2.googleapis.com/token') {
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access-token',
						refresh_token: 'fresh-refresh-token',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl === 'https://www.googleapis.com/oauth2/v2/userinfo') {
				return new Response(
					JSON.stringify({
						name: 'Drive User',
						email: 'drive@example.com',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';

				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes('.2fa-google-drive-test.json')) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname')) {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
				return new Response(JSON.stringify({ id: 'file-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleGoogleDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://auth.example.com/api/gdrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(200);
		expect(html).toContain('当前目标保持启用');

		const listResponse = await handleGetGoogleDriveConfigs(createMockRequest({}, 'GET'), env);
		const listData = await listResponse.json();
		expect(listData.destinations[0].authorized).toBe(true);
		expect(listData.destinations[0].enabled).toBe(true);
	});

	it('should return warning popup when Google Drive auth succeeds but auto test upload fails', async () => {
		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: createData.id,
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl === 'https://oauth2.googleapis.com/token') {
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access-token',
						refresh_token: 'fresh-refresh-token',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl === 'https://www.googleapis.com/oauth2/v2/userinfo') {
				return new Response(
					JSON.stringify({
						name: 'Drive User',
						email: 'drive@example.com',
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';

				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes('.2fa-google-drive-test.json')) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname')) {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
				return new Response(
					JSON.stringify({
						error: {
							code: 403,
							message: 'Request had insufficient authentication scopes.',
							status: 'PERMISSION_DENIED',
							details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
						},
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } },
				);
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleGoogleDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://example.com/api/gdrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(200);
		expect(html).toContain('连接测试失败');

		const listResponse = await handleGetGoogleDriveConfigs(createMockRequest({}, 'GET'), env);
		const listData = await listResponse.json();
		expect(listData.destinations[0].authorized).toBe(true);
		expect(listData.destinations[0].enabled).toBe(false);
	});

	it('should keep posting OAuth failure results back to the app origin after state is consumed', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});

		globalThis.fetch = vi.fn(async (url) => {
			const stringUrl = String(url);

			if (stringUrl === 'https://oauth2.googleapis.com/token') {
				return new Response(
					JSON.stringify({
						error: 'invalid_grant',
						error_description: 'authorization code expired',
					}),
					{ status: 400, headers: { 'Content-Type': 'application/json' } },
				);
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const callbackResponse = await handleGoogleDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://auth.example.com/api/gdrive/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(400);
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');
	});

	it('should route expired Google Drive state failures back to the original app origin', async () => {
		env.OAUTH_REDIRECT_BASE_URL = 'https://auth.example.com';

		const createResponse = await handleSaveGoogleDriveConfig(
			createMockRequest({
				name: 'Primary Google Drive',
				folderPath: '/2FA-Backups',
			}),
			env,
		);
		const createData = await createResponse.json();
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: createData.id,
			appOrigin: 'https://app.example.com',
		});
		await env.SECRETS_KV.delete(`oauth_state_${state}`);

		const callbackResponse = await handleGoogleDriveOAuthCallback(
			createMockRequest({}, 'GET', `https://auth.example.com/api/gdrive/oauth/callback?state=${encodeURIComponent(state)}`),
			env,
		);
		const html = await callbackResponse.text();

		expect(callbackResponse.status).toBe(400);
		expect(html).toContain('OAuth state 无效或已过期');
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');
	});
});
