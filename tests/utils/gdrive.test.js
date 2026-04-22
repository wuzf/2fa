import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	completeGoogleDriveAuthorization,
	deleteGoogleDriveSingleConfig,
	getGoogleDriveConfigs,
	getGoogleDriveStatus,
	pushToAllGoogleDrive,
	saveGoogleDriveSingleConfig,
} from '../../src/utils/gdrive.js';

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

describe('Google Drive Utils', () => {
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

	it('should save, read, update and delete Google Drive configs', async () => {
		const created = await saveGoogleDriveSingleConfig(env, {
			name: 'Primary Google Drive',
			folderPath: '/2FA-Backups',
		});

		expect(created.success).toBe(true);
		expect(created.id).toBeTruthy();

		const configsAfterCreate = await getGoogleDriveConfigs(env);
		expect(configsAfterCreate).toHaveLength(1);
		expect(configsAfterCreate[0].authorized).toBe(false);
		expect(configsAfterCreate[0].enabled).toBe(false);

		await saveGoogleDriveSingleConfig(env, {
			id: created.id,
			name: 'Updated Google Drive',
			folderPath: '/Backups/App',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
		});

		const configsAfterUpdate = await getGoogleDriveConfigs(env);
		expect(configsAfterUpdate[0].name).toBe('Updated Google Drive');
		expect(configsAfterUpdate[0].folderPath).toBe('/Backups/App');
		expect(configsAfterUpdate[0].authorized).toBe(true);

		const deleted = await deleteGoogleDriveSingleConfig(env, created.id);
		expect(deleted.success).toBe(true);
		expect(await getGoogleDriveConfigs(env)).toEqual([]);
	});

	it('should return null when no Google Drive targets are enabled', async () => {
		const result = await pushToAllGoogleDrive('backup_test.json', '{}', env);
		expect(result).toBeNull();
	});

	it('should push backup to Google Drive after refreshing token and creating folder', async () => {
		const created = await saveGoogleDriveSingleConfig(env, {
			name: 'Primary Google Drive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'old-refresh-token',
			accessToken: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
		});

		globalThis.fetch = vi.fn(async (url, options = {}) => {
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

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';
				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes("name = 'backup_test.json'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname') && options.method === 'POST') {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?') && options.method === 'POST') {
				return new Response(JSON.stringify({ id: 'file-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const result = await pushToAllGoogleDrive('backup_test.json', '{"ok":true}', env);

		expect(result.successCount).toBe(1);
		expect(result.failCount).toBe(0);

		const configs = await getGoogleDriveConfigs(env);
		expect(configs[0].accessToken).toBe('fresh-access-token');
		expect(configs[0].refreshToken).toBe('fresh-refresh-token');

		const status = await getGoogleDriveStatus(env, created.id);
		expect(status.lastSuccess.backupKey).toBe('backup_test.json');
		expect(status.lastError).toBeNull();
	});

	it('should set Google Drive upload MIME from backup format and encryption state', async () => {
		await saveGoogleDriveSingleConfig(env, {
			name: 'Primary Google Drive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
			accessToken: 'valid-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		const uploadBodies = [];
		globalThis.fetch = vi.fn(async (url, options = {}) => {
			const stringUrl = String(url);

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';

				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [{ id: 'folder-id-1', name: '2FA-Backups' }] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes("name = 'backup_test.csv'") || q.includes("name = 'backup_test.html'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?') && options.method === 'POST') {
				uploadBodies.push(String(options.body));
				return new Response(JSON.stringify({ id: 'file-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const resultCsv = await pushToAllGoogleDrive('backup_test.csv', 'service,secret', env);
		const resultEncrypted = await pushToAllGoogleDrive('backup_test.html', 'v1:encrypted-backup', env);

		expect(resultCsv.successCount).toBe(1);
		expect(resultEncrypted.successCount).toBe(1);
		expect(uploadBodies[0]).toContain('"mimeType":"text/csv"');
		expect(uploadBodies[0]).toContain('Content-Type: text/csv;charset=utf-8');
		expect(uploadBodies[1]).toContain('"mimeType":"application/octet-stream"');
		expect(uploadBodies[1]).toContain('Content-Type: application/octet-stream');
	});

	it('should escape Google Drive parent ids when composing folder and file queries', async () => {
		await saveGoogleDriveSingleConfig(env, {
			name: 'Escaped Parent Target',
			folderPath: '/Top/Sub',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
			accessToken: 'valid-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		const seenQueries = [];
		let createdFolderCount = 0;

		globalThis.fetch = vi.fn(async (url, options = {}) => {
			const stringUrl = String(url);

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname') && options.method === 'POST') {
				createdFolderCount += 1;
				return new Response(
					JSON.stringify({
						id: createdFolderCount === 1 ? "parent'\\id" : "final'\\folder",
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				seenQueries.push(urlObj.searchParams.get('q') || '');
				return new Response(JSON.stringify({ files: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?') && options.method === 'POST') {
				return new Response(JSON.stringify({ id: 'file-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			throw new Error(`Unexpected fetch: ${stringUrl}`);
		});

		const result = await pushToAllGoogleDrive('backup_test.json', '{"ok":true}', env);

		expect(result.successCount).toBe(1);
		expect(result.failCount).toBe(0);
		expect(seenQueries).toContain(
			String.raw`name = 'Sub' and mimeType = 'application/vnd.google-apps.folder' and 'parent\'\\id' in parents and trashed = false`,
		);
		expect(seenQueries).toContain(String.raw`name = 'backup_test.json' and 'final\'\\folder' in parents and trashed = false`);
	});

	it('should record Google Drive push errors when target is unauthorized', async () => {
		const created = await saveGoogleDriveSingleConfig(env, {
			name: 'Unauthorized Target',
			folderPath: '/2FA-Backups',
			authorized: false,
			enabled: true,
		});

		const result = await pushToAllGoogleDrive('backup_test.json', '{}', env);

		expect(result.successCount).toBe(0);
		expect(result.failCount).toBe(1);

		const status = await getGoogleDriveStatus(env, created.id);
		expect(status.lastError.error).toContain('未授权');
	});

	it('should preserve existing Google Drive refresh token during reauthorization when provider omits it', async () => {
		const created = await saveGoogleDriveSingleConfig(env, {
			name: 'Existing Google Drive',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'existing-refresh-token',
			accessToken: 'old-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		await completeGoogleDriveAuthorization(env, {
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

		const configs = await getGoogleDriveConfigs(env);
		expect(configs[0].refreshToken).toBe('existing-refresh-token');
		expect(configs[0].accessToken).toBe('new-access-token');
		expect(configs[0].enabled).toBe(true);
		expect(configs[0].authorized).toBe(true);
	});

	it('should translate insufficient scope errors into friendly Chinese guidance', async () => {
		const created = await saveGoogleDriveSingleConfig(env, {
			name: 'Scope Error Target',
			folderPath: '/2FA-Backups',
			authorized: true,
			enabled: true,
			refreshToken: 'refresh-token',
			accessToken: 'valid-access-token',
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		});

		globalThis.fetch = vi.fn(async (url, options = {}) => {
			const stringUrl = String(url);

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?')) {
				const urlObj = new URL(stringUrl);
				const q = urlObj.searchParams.get('q') || '';

				if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				if (q.includes("name = 'backup_test.json'")) {
					return new Response(JSON.stringify({ files: [] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
			}

			if (stringUrl.startsWith('https://www.googleapis.com/drive/v3/files?fields=id%2Cname') && options.method === 'POST') {
				return new Response(JSON.stringify({ id: 'folder-id-1' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (stringUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files?') && options.method === 'POST') {
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

		const result = await pushToAllGoogleDrive('backup_test.json', '{"ok":true}', env);

		expect(result.successCount).toBe(0);
		expect(result.failCount).toBe(1);

		const status = await getGoogleDriveStatus(env, created.id);
		expect(status.lastError.error).toContain('Google Drive 已授权');
		expect(status.lastError.error).toContain('drive.file');
		expect(status.lastError.error).toContain('重新授权');
	});
});
