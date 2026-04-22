import { describe, expect, it, vi } from 'vitest';

import worker from '../../src/worker.js';
import { handleBackupSecrets, handleGetBackups } from '../../src/api/secrets/backup.js';
import { handleExportBackup, handleRestoreBackup } from '../../src/api/secrets/restore.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';
import { encryptSecrets } from '../../src/utils/encryption.js';
import { MAX_HTML_QR_EXPORT_SECRETS } from '../../src/utils/backup-format.js';

class MockKV {
	constructor() {
		this.store = new Map();
		this.metadata = new Map();
	}

	async get(key, type = 'text') {
		const value = this.store.get(key);
		if (!value) {
			return null;
		}

		if (type === 'json') {
			return JSON.parse(value);
		}

		return value;
	}

	async put(key, value, options = {}) {
		this.store.set(key, value);
		this.metadata.set(key, options.metadata || null);
	}

	async delete(key) {
		this.store.delete(key);
		this.metadata.delete(key);
	}

	async list(options = {}) {
		const keys = Array.from(this.store.keys()).sort();
		const prefix = options.prefix || '';
		const limit = options.limit || 1000;
		const cursor = options.cursor;
		const filteredKeys = prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
		const startIndex = cursor ? Number.parseInt(cursor, 10) : 0;
		const pageKeys = filteredKeys.slice(startIndex, startIndex + limit);

		return {
			keys: pageKeys.map((name) => ({
				name,
				metadata: this.metadata.get(name) || { created: new Date().toISOString() },
			})),
			list_complete: startIndex + limit >= filteredKeys.length,
			cursor: startIndex + limit < filteredKeys.length ? String(startIndex + limit) : undefined,
		};
	}
}

function createMockEnv() {
	const encryptionKey = Buffer.from('12345678901234567890123456789012').toString('base64');

	return {
		SECRETS_KV: new MockKV(),
		ENCRYPTION_KEY: encryptionKey,
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/backup', params = {}) {
	let fullUrl = url;
	if (Object.keys(params).length > 0) {
		fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
	}

	return {
		method,
		url: fullUrl,
		headers: new Headers({
			'Content-Type': 'application/json',
			'CF-Connecting-IP': '203.0.113.1',
		}),
		json: async () => body,
	};
}

function createSecrets() {
	return [
		{
			id: '1',
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
			createdAt: '2026-04-16T00:00:00.000Z',
		},
		{
			id: '2',
			name: 'Google',
			account: 'ops@example.com',
			secret: 'MFRGGZDFMZTWQ2LK',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
			createdAt: '2026-04-16T00:01:00.000Z',
		},
	];
}

function normalizeSecretsForAssert(secrets) {
	return [...secrets]
		.map((secret) => ({
			name: secret.name,
			account: secret.account || '',
			secret: secret.secret,
			type: secret.type || 'TOTP',
			digits: secret.digits || 6,
			period: secret.period || 30,
			algorithm: secret.algorithm || 'SHA1',
			counter: secret.counter || 0,
		}))
		.sort((a, b) => `${a.name}\u0000${a.account}`.localeCompare(`${b.name}\u0000${b.account}`));
}

function getBackupKeys(env) {
	return Array.from(env.SECRETS_KV.store.keys())
		.filter((key) => key.startsWith('backup_'))
		.sort();
}

describe('Backup format propagation', () => {
	it('uses the default export format for manual backups', async () => {
		const env = createMockEnv();
		const originalSecrets = createSecrets();
		await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'csv' }));
		await env.SECRETS_KV.put('secrets', await encryptSecrets(originalSecrets, env));

		const backupResponse = await handleBackupSecrets(createMockRequest(), env);
		const backupData = await backupResponse.json();

		expect(backupResponse.status).toBe(200);
		expect(backupData.format).toBe('csv');
		expect(backupData.backupKey.endsWith('.csv')).toBe(true);

		const listResponse = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
		const listData = await listResponse.json();
		const listedBackup = listData.backups.find((item) => item.key === backupData.backupKey);

		expect(listedBackup).toBeDefined();
		expect(listedBackup.format).toBe('csv');

		const previewResponse = await handleRestoreBackup(
			createMockRequest({ backupKey: backupData.backupKey, preview: true }, 'POST', 'https://example.com/api/backup/restore'),
			env,
		);
		const previewData = await previewResponse.json();

		expect(previewResponse.status).toBe(200);
		expect(previewData.data.format).toBe('csv');
		expect(normalizeSecretsForAssert(previewData.data.secrets)).toEqual(normalizeSecretsForAssert(originalSecrets));

		await env.SECRETS_KV.put(
			'secrets',
			await encryptSecrets(
				[
					{
						id: '999',
						name: 'Temporary',
						account: 'stale@example.com',
						secret: 'KRSXG5CTMVRXEZLU',
						type: 'TOTP',
						digits: 6,
						period: 30,
						algorithm: 'SHA1',
						counter: 0,
					},
				],
				env,
			),
		);

		const restoreResponse = await handleRestoreBackup(
			createMockRequest({ backupKey: backupData.backupKey, preview: false }, 'POST', 'https://example.com/api/backup/restore'),
			env,
			{ waitUntil: vi.fn() },
		);
		const restoreData = await restoreResponse.json();
		const restoredSecrets = await getAllSecrets(env);

		expect(restoreResponse.status).toBe(200);
		expect(restoreData.format).toBe('csv');
		expect(normalizeSecretsForAssert(restoredSecrets)).toEqual(normalizeSecretsForAssert(originalSecrets));

		const exportResponse = await handleExportBackup(
			createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupData.backupKey}`, { format: 'html' }),
			env,
			backupData.backupKey,
		);
		const exportContent = await exportResponse.text();

		expect(exportResponse.status).toBe(200);
		expect(exportResponse.headers.get('Content-Type')).toContain('text/html');
		expect(exportContent).toContain('<img src="data:image/svg+xml;base64,');
		expect(exportContent).toContain('__2fa_backup_data__');
		expect(exportContent).toContain('GitHub');
	});

	it('uses the default export format for event-driven backups', async () => {
		const env = createMockEnv();
		await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'txt' }));

		await saveSecretsToKV(env, createSecrets(), 'secret-updated');

		const backupKeys = getBackupKeys(env);
		expect(backupKeys).toHaveLength(1);
		expect(backupKeys[0].endsWith('.txt')).toBe(true);

		const metadata = env.SECRETS_KV.metadata.get(backupKeys[0]);
		expect(metadata.format).toBe('txt');

		const previewResponse = await handleRestoreBackup(
			createMockRequest({ backupKey: backupKeys[0], preview: true }, 'POST', 'https://example.com/api/backup/restore'),
			env,
		);
		const previewData = await previewResponse.json();

		expect(previewResponse.status).toBe(200);
		expect(previewData.data.format).toBe('txt');
		expect(previewData.data.count).toBe(2);
		expect(normalizeSecretsForAssert(previewData.data.secrets)).toEqual(normalizeSecretsForAssert(createSecrets()));
	});

	it('uses the default export format for scheduled backups', async () => {
		const env = createMockEnv();
		await env.SECRETS_KV.put('settings', JSON.stringify({ defaultExportFormat: 'html' }));
		await env.SECRETS_KV.put('secrets', await encryptSecrets(createSecrets(), env));

		const ctx = { waitUntil: vi.fn() };
		await worker.scheduled({ cron: '0 0 * * *' }, env, ctx);

		const backupKeys = getBackupKeys(env);
		expect(backupKeys).toHaveLength(1);
		expect(backupKeys[0].endsWith('.html')).toBe(true);
		expect(ctx.waitUntil).toHaveBeenCalledTimes(4);

		const metadata = env.SECRETS_KV.metadata.get(backupKeys[0]);
		expect(metadata.format).toBe('html');

		const previewResponse = await handleRestoreBackup(
			createMockRequest({ backupKey: backupKeys[0], preview: true }, 'POST', 'https://example.com/api/backup/restore'),
			env,
		);
		const previewData = await previewResponse.json();

		expect(previewResponse.status).toBe(200);
		expect(previewData.data.format).toBe('html');
		expect(previewData.data.count).toBe(2);
		expect(normalizeSecretsForAssert(previewData.data.secrets)).toEqual(normalizeSecretsForAssert(createSecrets()));
	});
});

describe('Backup settings fallback', () => {
	it('falls back to JSON for manual backups when settings cannot be read', async () => {
		const env = createMockEnv();
		const originalSecrets = createSecrets();
		await env.SECRETS_KV.put('secrets', await encryptSecrets(originalSecrets, env));

		const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
		env.SECRETS_KV.get = async (key, type) => {
			if (key === 'settings') {
				throw new Error('settings unavailable');
			}
			return originalGet(key, type);
		};

		const backupResponse = await handleBackupSecrets(createMockRequest(), env);
		const backupData = await backupResponse.json();

		expect(backupResponse.status).toBe(200);
		expect(backupData.format).toBe('json');
		expect(backupData.backupKey.endsWith('.json')).toBe(true);
	});

	it('falls back to JSON for event-driven backups when settings cannot be read', async () => {
		const env = createMockEnv();

		const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
		env.SECRETS_KV.get = async (key, type) => {
			if (key === 'settings') {
				throw new Error('settings unavailable');
			}
			return originalGet(key, type);
		};

		await saveSecretsToKV(env, createSecrets(), 'secret-updated');

		const backupKeys = getBackupKeys(env);
		expect(backupKeys).toHaveLength(1);
		expect(backupKeys[0].endsWith('.json')).toBe(true);
	});

	it('falls back to JSON for scheduled backups when settings cannot be read', async () => {
		const env = createMockEnv();
		await env.SECRETS_KV.put('secrets', await encryptSecrets(createSecrets(), env));

		const originalGet = env.SECRETS_KV.get.bind(env.SECRETS_KV);
		env.SECRETS_KV.get = async (key, type) => {
			if (key === 'settings') {
				throw new Error('settings unavailable');
			}
			return originalGet(key, type);
		};

		const ctx = { waitUntil: vi.fn() };
		await worker.scheduled({ cron: '0 0 * * *' }, env, ctx);

		const backupKeys = getBackupKeys(env);
		expect(backupKeys).toHaveLength(1);
		expect(backupKeys[0].endsWith('.json')).toBe(true);
		expect(ctx.waitUntil).toHaveBeenCalledTimes(4);
	});
});

describe('Backup HTML export fallback', () => {
	it('keeps oversized HTML exports recoverable by falling back to table-only HTML', async () => {
		const env = createMockEnv();
		const secretCount = MAX_HTML_QR_EXPORT_SECRETS + 1;
		const secrets = Array.from({ length: secretCount }, (_, index) => ({
			id: String(index + 1),
			name: `Service-${index + 1}`,
			account: `user${index + 1}@example.com`,
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
			createdAt: '2026-04-16T00:00:00.000Z',
		}));
		const backupKey = 'backup_2026-04-16_00-00-00-000-large.json';

		await env.SECRETS_KV.put(
			backupKey,
			JSON.stringify({
				timestamp: '2026-04-16T00:00:00.000Z',
				version: '1.0',
				count: secrets.length,
				secrets,
			}),
			{
				metadata: {
					created: '2026-04-16T00:00:00.000Z',
					format: 'json',
					count: secrets.length,
					encrypted: false,
					version: 2,
				},
			},
		);

		const htmlResponse = await handleExportBackup(
			createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupKey}`, { format: 'html' }),
			env,
			backupKey,
		);
		const htmlContent = await htmlResponse.text();

		expect(htmlResponse.status).toBe(200);
		expect(htmlResponse.headers.get('Content-Type')).toContain('text/html');
		expect(htmlContent).toContain('<!DOCTYPE html>');
		expect(htmlContent).toContain('data-skipped-invalid-count="0"');
		expect(htmlContent).toContain(String(MAX_HTML_QR_EXPORT_SECRETS));
		expect(htmlContent).not.toContain('<img src="data:image/');
		expect(htmlContent).toContain('__2fa_backup_data__');

		const jsonResponse = await handleExportBackup(
			createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupKey}`, { format: 'json' }),
			env,
			backupKey,
		);

		expect(jsonResponse.status).toBe(200);
		expect(jsonResponse.headers.get('Content-Type')).toContain('application/json');
	});
});
