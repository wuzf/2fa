/**
 * Settings API unit tests.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleGetSettings, handleSaveSettings } from '../../src/api/settings.js';

class MockKV {
	constructor() {
		this.store = new Map();
		this.getError = null;
	}

	async get(key) {
		if (this.getError) {
			throw this.getError;
		}
		const value = this.store.get(key);
		return value === undefined ? null : value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}
}

function createMockEnv() {
	return {
		SECRETS_KV: new MockKV(),
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body) {
	return {
		method: 'POST',
		url: 'https://example.com/api/settings',
		headers: new Headers({ 'Content-Type': 'application/json' }),
		json: async () => body,
	};
}

function createGetRequest() {
	return {
		method: 'GET',
		url: 'https://example.com/api/settings',
		headers: new Headers(),
	};
}

describe('Settings API', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
	});

	describe('handleGetSettings', () => {
		it('returns defaults when KV is empty', async () => {
			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.jwtExpiryDays).toBe(30);
			expect(data.maxBackups).toBe(100);
			expect(data.defaultExportFormat).toBe('json');
		});

		it('merges saved settings with defaults', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 50, defaultExportFormat: 'txt' }));

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(data.maxBackups).toBe(50);
			expect(data.jwtExpiryDays).toBe(30);
			expect(data.defaultExportFormat).toBe('txt');
		});

		it('sanitizes invalid stored defaultExportFormat values on read', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 50, defaultExportFormat: 'xml' }));

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(data.maxBackups).toBe(50);
			expect(data.defaultExportFormat).toBe('json');
		});

		it('falls back to defaults when stored settings JSON is corrupted', async () => {
			await env.SECRETS_KV.put('settings', '{bad json');

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 100,
				defaultExportFormat: 'json',
			});
		});

		it('falls back to defaults when stored settings root is not an object', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify(['legacy']));

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 100,
				defaultExportFormat: 'json',
			});
		});

		it('returns 500 when reading settings from KV fails', async () => {
			env.SECRETS_KV.getError = new Error('kv unavailable');

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(resp.status).toBe(500);
			expect(data.error).toBe('获取设置失败');
		});
	});

	describe('handleSaveSettings - maxBackups validation', () => {
		it('accepts 50', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 50 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.settings.maxBackups).toBe(50);
		});

		it('accepts 0 as unlimited', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 0 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(0);
		});

		it('accepts 1000 as upper bound', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 1000 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(1000);
		});

		it('rejects invalid values', async () => {
			const invalidValues = [null, false, true, '', '   ', -1, 1001, 3.5, [], [5], {}];
			for (const value of invalidValues) {
				const resp = await handleSaveSettings(createMockRequest({ maxBackups: value }), env);
				expect(resp.status).toBe(400);
			}
		});

		it('accepts numeric string values', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: '50' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(50);
		});

		it('does not overwrite KV when validation fails', async () => {
			await handleSaveSettings(createMockRequest({ maxBackups: 50 }), env);
			await handleSaveSettings(createMockRequest({ maxBackups: '   ' }), env);

			const raw = await env.SECRETS_KV.get('settings');
			const settings = JSON.parse(raw);
			expect(settings.maxBackups).toBe(50);
		});
	});

	describe('handleSaveSettings - defaultExportFormat validation', () => {
		it('accepts txt', async () => {
			const resp = await handleSaveSettings(createMockRequest({ defaultExportFormat: 'txt' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.defaultExportFormat).toBe('txt');
		});

		it('normalizes uppercase format names', async () => {
			const resp = await handleSaveSettings(createMockRequest({ defaultExportFormat: 'HTML' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.defaultExportFormat).toBe('html');
		});

		it('rejects unsupported formats', async () => {
			const resp = await handleSaveSettings(createMockRequest({ defaultExportFormat: 'xml' }), env);
			expect(resp.status).toBe(400);
		});

		it('persists alongside other settings', async () => {
			await handleSaveSettings(createMockRequest({ maxBackups: 20 }), env);
			await handleSaveSettings(createMockRequest({ defaultExportFormat: 'csv' }), env);

			const raw = await env.SECRETS_KV.get('settings');
			const settings = JSON.parse(raw);
			expect(settings.maxBackups).toBe(20);
			expect(settings.defaultExportFormat).toBe('csv');
		});

		it('rewrites invalid stored defaultExportFormat values when saving other settings', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 10, defaultExportFormat: 'xml' }));
			await handleSaveSettings(createMockRequest({ jwtExpiryDays: 45 }), env);

			const raw = await env.SECRETS_KV.get('settings');
			const settings = JSON.parse(raw);
			expect(settings.jwtExpiryDays).toBe(45);
			expect(settings.defaultExportFormat).toBe('json');
		});

		it('uses defaults to recover malformed settings when saving', async () => {
			await env.SECRETS_KV.put('settings', '{bad json');

			const resp = await handleSaveSettings(createMockRequest({ defaultExportFormat: 'csv' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 100,
				defaultExportFormat: 'csv',
			});

			const stored = JSON.parse(await env.SECRETS_KV.get('settings'));
			expect(stored).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 100,
				defaultExportFormat: 'csv',
			});
		});

		it('uses defaults to recover non-object settings when saving', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify('legacy'));

			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 20 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 20,
				defaultExportFormat: 'json',
			});

			const stored = JSON.parse(await env.SECRETS_KV.get('settings'));
			expect(stored).toMatchObject({
				jwtExpiryDays: 30,
				maxBackups: 20,
				defaultExportFormat: 'json',
			});
		});

		it('returns 500 when loading current settings fails before save', async () => {
			env.SECRETS_KV.getError = new Error('kv unavailable');

			const resp = await handleSaveSettings(createMockRequest({ defaultExportFormat: 'csv' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(500);
			expect(data.error).toBe('保存设置失败');
			expect(env.SECRETS_KV.store.has('settings')).toBe(false);
		});
	});
});
