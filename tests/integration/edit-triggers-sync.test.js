/**
 * Verify that editing a secret triggers remote-sync fan-out (WebDAV/S3/OneDrive/Google Drive).
 * This test exists to guard the behavior requested in the bug report:
 *   "编辑密钥中的账户名称时，WebDAV/S3/OneDrive/GoogleDrive 也要同步触发"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/encryption.js', () => ({
	encryptData: vi.fn(async (data) => JSON.stringify({ encrypted: true, data })),
	encryptSecrets: vi.fn(async (secrets) => JSON.stringify(secrets)),
	decryptSecrets: vi.fn(async (data) => (typeof data === 'string' ? JSON.parse(data) : data)),
	isEncrypted: vi.fn(() => false),
}));

vi.mock('../../src/utils/logger.js', () => ({
	getLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock('../../src/utils/monitoring.js', () => ({
	getMonitoring: vi.fn(() => ({
		getPerformanceMonitor: () => ({ recordMetric: vi.fn() }),
		getErrorMonitor: () => ({ captureError: vi.fn() }),
	})),
}));

const webdavMock = { pushToAllWebDAV: vi.fn(async () => ({ success: true })) };
const s3Mock = { pushToAllS3: vi.fn(async () => ({ success: true })) };
const onedriveMock = { pushToAllOneDrive: vi.fn(async () => ({ success: true })) };
const gdriveMock = { pushToAllGoogleDrive: vi.fn(async () => ({ success: true })) };

vi.mock('../../src/utils/webdav.js', () => webdavMock);
vi.mock('../../src/utils/s3.js', () => s3Mock);
vi.mock('../../src/utils/onedrive.js', () => onedriveMock);
vi.mock('../../src/utils/gdrive.js', () => gdriveMock);

const { BackupManager, triggerBackup } = await import('../../src/utils/backup.js');
const { saveSecretsToKV } = await import('../../src/api/secrets/shared.js');

function createEnv() {
	const kv = new Map();
	return {
		SECRETS_KV: {
			get: vi.fn(async (k) => kv.get(k) || null),
			put: vi.fn(async (k, v) => {
				kv.set(k, v);
			}),
			delete: vi.fn(async (k) => {
				kv.delete(k);
			}),
			list: vi.fn(async () => ({ keys: [] })),
		},
	};
}

describe('Edit triggers remote-sync fan-out', () => {
	beforeEach(() => {
		webdavMock.pushToAllWebDAV.mockClear();
		s3Mock.pushToAllS3.mockClear();
		onedriveMock.pushToAllOneDrive.mockClear();
		gdriveMock.pushToAllGoogleDrive.mockClear();
	});

	it('triggerBackup(reason="secret-updated") calls all 4 providers via BackupManager', async () => {
		const env = createEnv();
		const mgr = new BackupManager(env);

		const tasks = [];
		const ctx = { waitUntil: (p) => tasks.push(p) };

		const secrets = [
			{
				id: '1',
				name: 'svc',
				account: 'new-account-name',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 6,
				period: 30,
				algorithm: 'SHA1',
			},
		];

		await mgr.triggerBackup(secrets, { reason: 'secret-updated', ctx });
		await Promise.allSettled(tasks);

		expect(webdavMock.pushToAllWebDAV).toHaveBeenCalledTimes(1);
		expect(s3Mock.pushToAllS3).toHaveBeenCalledTimes(1);
		expect(onedriveMock.pushToAllOneDrive).toHaveBeenCalledTimes(1);
		expect(gdriveMock.pushToAllGoogleDrive).toHaveBeenCalledTimes(1);
	});

	it('saveSecretsToKV (full edit path) also fires all 4 providers', async () => {
		const env = createEnv();

		const tasks = [];
		const ctx = { waitUntil: (p) => tasks.push(p) };

		const secrets = [
			{
				id: '1',
				name: 'svc',
				account: 'renamed-account',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 6,
				period: 30,
				algorithm: 'SHA1',
			},
		];

		await saveSecretsToKV(env, secrets, 'secret-updated', {}, ctx);
		await Promise.allSettled(tasks);

		expect(webdavMock.pushToAllWebDAV).toHaveBeenCalledTimes(1);
		expect(s3Mock.pushToAllS3).toHaveBeenCalledTimes(1);
		expect(onedriveMock.pushToAllOneDrive).toHaveBeenCalledTimes(1);
		expect(gdriveMock.pushToAllGoogleDrive).toHaveBeenCalledTimes(1);
	});
});

describe('Auto-enable on first OAuth authorization', () => {
	it('OneDrive: first authorization auto-enables the destination', async () => {
		// Unload the onedrive mock so we exercise the real completeOneDriveAuthorization flow.
		vi.doUnmock('../../src/utils/onedrive.js');
		vi.resetModules();
		const { completeOneDriveAuthorization, saveOneDriveSingleConfig, getOneDriveConfigs } = await import('../../src/utils/onedrive.js');

		const env = createEnv();
		const created = await saveOneDriveSingleConfig(env, { name: 'primary', folderPath: '/2FA-Backups' });
		expect(created.success).toBe(true);

		await completeOneDriveAuthorization(env, {
			id: created.id,
			tokenData: {
				accessToken: 'at',
				refreshToken: 'rt',
				accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
			},
			profile: { displayName: 'u', email: 'u@example.com' },
		});

		const configs = await getOneDriveConfigs(env);
		expect(configs[0].authorized).toBe(true);
		expect(configs[0].enabled).toBe(true);
	});

	it('Google Drive: first authorization auto-enables the destination', async () => {
		vi.doUnmock('../../src/utils/gdrive.js');
		vi.resetModules();
		const { completeGoogleDriveAuthorization, saveGoogleDriveSingleConfig, getGoogleDriveConfigs } = await import('../../src/utils/gdrive.js');

		const env = createEnv();
		const created = await saveGoogleDriveSingleConfig(env, { name: 'primary', folderPath: '/2FA-Backups' });
		expect(created.success).toBe(true);

		await completeGoogleDriveAuthorization(env, {
			id: created.id,
			tokenData: {
				accessToken: 'at',
				refreshToken: 'rt',
				accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
			},
			profile: { displayName: 'u', email: 'u@example.com' },
		});

		const configs = await getGoogleDriveConfigs(env);
		expect(configs[0].authorized).toBe(true);
		expect(configs[0].enabled).toBe(true);
	});
});

