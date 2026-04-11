import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	completeOneDriveAuthorization,
	deleteOneDriveSingleConfig,
	getOneDriveConfigs,
	getOneDriveStatus,
	pushToAllOneDrive,
	saveOneDriveSingleConfig,
} from '../../src/utils/onedrive.js';

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

describe('OneDrive Utils', () => {
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

	it('should save, read, update and delete OneDrive configs', async () => {
		const created = await saveOneDriveSingleConfig(env, {
			name: 'Primary OneDrive',
			folderPath: '/2FA-Backups',
		});

		expect(created.success).toBe(true);
		expect(created.id).toBeTruthy();

		const configsAfterCreate = await getOneDriveConfigs(env);
		expect(configsAfterCreate).toHaveLength(1);
		expect(configsAfterCreate[0].authorized).toBe(false);
		expect(configsAfterCreate[0].enabled).toBe(false);

		await saveOneDriveSingleConfig(env, {
			id: created.id,
			name: 'Updated OneDrive',
			folderPath: '/Backups/App',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
		});

		const configsAfterUpdate = await getOneDriveConfigs(env);
		expect(configsAfterUpdate[0].name).toBe('Updated OneDrive');
		expect(configsAfterUpdate[0].folderPath).toBe('/Backups/App');
		expect(configsAfterUpdate[0].authorized).toBe(true);

		const deleted = await deleteOneDriveSingleConfig(env, created.id);
		expect(deleted.success).toBe(true);
		expect(await getOneDriveConfigs(env)).toEqual([]);
	});

	it('should return null when no OneDrive targets are enabled', async () => {
		const result = await pushToAllOneDrive('backup_test.json', '{}', env);
		expect(result).toBeNull();
	});

	it('should push backup to OneDrive after refreshing token and creating folder', async () => {
		const created = await saveOneDriveSingleConfig(env, {
			name: 'Primary OneDrive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'old-refresh-token',
			accessToken: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
		});

		globalThis.fetch = vi.fn(async (url, options = {}) => {
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

			if (stringUrl.endsWith('/me/drive/special/approot')) {
				return new Response(JSON.stringify({ id: 'app-root-id' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/app-root-id/children?')) {
				return new Response(JSON.stringify({ value: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.endsWith('/me/drive/items/app-root-id/children') && options.method === 'POST') {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 201,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/folder-id-1:/backup_test.json:/content') && options.method === 'PUT') {
				return new Response('', { status: 201 });
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const result = await pushToAllOneDrive('backup_test.json', '{"ok":true}', env);

		expect(result.successCount).toBe(1);
		expect(result.failCount).toBe(0);

		const configs = await getOneDriveConfigs(env);
		expect(configs[0].accessToken).toBe('fresh-access-token');
		expect(configs[0].refreshToken).toBe('fresh-refresh-token');

		const status = await getOneDriveStatus(env, created.id);
		expect(status.lastSuccess.backupKey).toBe('backup_test.json');
		expect(status.lastError).toBeNull();
	});

	it('should set OneDrive upload MIME from backup format and encryption state', async () => {
		await saveOneDriveSingleConfig(env, {
			name: 'Primary OneDrive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
			accessToken: 'valid-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		const uploadHeaders = [];
		globalThis.fetch = vi.fn(async (url, options = {}) => {
			const stringUrl = String(url);

			if (stringUrl.endsWith('/me/drive/special/approot')) {
				return new Response(JSON.stringify({ id: 'app-root-id' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/app-root-id/children?')) {
				return new Response(JSON.stringify({ value: [{ id: 'folder-id-1', name: '2FA-Backups', folder: {} }] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.includes('/me/drive/items/folder-id-1:/') && options.method === 'PUT') {
				uploadHeaders.push(options.headers);
				return new Response('', { status: 201 });
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const resultTxt = await pushToAllOneDrive('backup_test.csv', 'service,secret', env);
		const resultEncrypted = await pushToAllOneDrive('backup_test.html', 'v1:encrypted-backup', env);

		expect(resultTxt.successCount).toBe(1);
		expect(resultEncrypted.successCount).toBe(1);
		expect(uploadHeaders[0]['Content-Type']).toBe('text/csv;charset=utf-8');
		expect(uploadHeaders[1]['Content-Type']).toBe('application/octet-stream');
	});

	it('should record OneDrive push errors when target is unauthorized', async () => {
		const created = await saveOneDriveSingleConfig(env, {
			name: 'Unauthorized Target',
			folderPath: '/2FA-Backups',
			authorized: false,
			enabled: true,
		});

		const result = await pushToAllOneDrive('backup_test.json', '{}', env);

		expect(result.successCount).toBe(0);
		expect(result.failCount).toBe(1);

		const status = await getOneDriveStatus(env, created.id);
		expect(status.lastError.error).toContain('未授权');
	});

	it('should preserve existing OneDrive refresh token during reauthorization when provider omits it', async () => {
		const created = await saveOneDriveSingleConfig(env, {
			name: 'Existing OneDrive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'existing-refresh-token',
			accessToken: 'old-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		await completeOneDriveAuthorization(env, {
			id: created.id,
			tokenData: {
				accessToken: 'new-access-token',
				refreshToken: '',
				accessTokenExpiresAt: new Date(Date.now() + 7200_000).toISOString(),
			},
			profile: {
				displayName: 'Updated User',
				email: 'user@example.com',
			},
		});

		const configs = await getOneDriveConfigs(env);
		expect(configs[0].refreshToken).toBe('existing-refresh-token');
		expect(configs[0].accessToken).toBe('new-access-token');
		expect(configs[0].enabled).toBe(true);
		expect(configs[0].authorized).toBe(true);
	});
});
