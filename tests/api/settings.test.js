/**
 * Settings API unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_PREFERENCES } from '../../src/shared/languages.js';
import { handleGetSettings, handleSaveSettings } from '../../src/api/settings.js';
import { getLogger } from '../../src/utils/logger.js';
import {
	getEnabledCustomCode,
	getSettings,
	MAX_CUSTOM_CODE_ITEMS,
	MAX_CUSTOM_CODE_LENGTH,
	MAX_CUSTOM_CODE_NAME_LENGTH,
	sanitizeCustomCodes,
} from '../../src/utils/settings.js';

class MockKV {
	constructor() {
		this.store = new Map();
		this.getError = null;
	}

	async get(key, type) {
		if (this.getError) {
			throw this.getError;
		}
		const value = this.store.get(key);
		return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
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
			expect(data.customCode).toBe('');
			expect(data).not.toHaveProperty('language');
		});

		it('merges saved settings with defaults', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 50, defaultExportFormat: 'txt' }));

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(data.maxBackups).toBe(50);
			expect(data.jwtExpiryDays).toBe(30);
			expect(data.defaultExportFormat).toBe('txt');
			expect(data.customCode).toBe('');
			expect(data).not.toHaveProperty('language');
		});

		it.each(['auto', 'en', 'zh-TW'])('preserves explicitly saved language %s', async (language) => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ language }));
			const resp = await handleGetSettings(createGetRequest(), env);
			expect((await resp.json()).language).toBe(language);
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

		it.each(['read', 'save'])('does not log malformed stored JSON during %s', async (operation) => {
			const privateSource = '<secret>';
			await env.SECRETS_KV.put('settings', privateSource);
			const logger = getLogger(env);
			const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
			const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
			try {
				const response =
					operation === 'read'
						? await handleGetSettings(createGetRequest(), env)
						: await handleSaveSettings(createMockRequest({ maxBackups: 25 }), env);
				expect(response.status).toBe(200);
				expect(warn).toHaveBeenCalled();
				expect(JSON.stringify(warn.mock.calls)).not.toContain(privateSource);
				expect(error).not.toHaveBeenCalled();
				expect(JSON.stringify(await response.json())).not.toContain(privateSource);
			} finally {
				warn.mockRestore();
				error.mockRestore();
			}
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

	describe('customCode settings', () => {
		const customCode = [
			'  <style>body::after { content: "自定义 & < >"; }</style>',
			'<div id="custom-content">Hello &amp; welcome</div>',
			'<script>window.customValue = "</textarea>";</script>',
			'<script src="https://example.com/custom.js?first=1&second=2" defer></script>',
			'',
		].join('\r\n');

		it('persists mixed HTML, styles and scripts unchanged and returns them on read', async () => {
			const response = await handleSaveSettings(createMockRequest({ customCode }), env);
			const saved = await response.json();
			expect(response.status).toBe(200);
			expect(saved.settings.customCode).toBe(customCode);
			expect(JSON.parse(await env.SECRETS_KV.get('settings')).customCode).toBe(customCode);

			const read = await handleGetSettings(createGetRequest(), env);
			expect((await read.json()).customCode).toBe(customCode);
		});

		it('preserves existing preferences and custom code through partial updates', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 25, defaultExportFormat: 'csv', language: 'en' }));
			await handleSaveSettings(createMockRequest({ customCode }), env);
			const response = await handleSaveSettings(createMockRequest({ jwtExpiryDays: 45 }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings).toEqual({
				jwtExpiryDays: 45,
				maxBackups: 25,
				defaultExportFormat: 'csv',
				language: 'en',
				customCode,
				customCodes: [{ id: 'legacy-custom-code', name: '', enabled: true, code: customCode }],
			});
		});

		it('clears saved code when an empty string is saved', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ customCode, maxBackups: 25 }));
			const response = await handleSaveSettings(createMockRequest({ customCode: '' }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCode).toBe('');
			expect(JSON.parse(await env.SECRETS_KV.get('settings'))).toMatchObject({ customCode: '', maxBackups: 25 });
			const read = await handleGetSettings(createGetRequest(), env);
			expect((await read.json()).customCode).toBe('');
		});

		it('preserves whitespace without trimming', async () => {
			const whitespace = ' \t\r\n ';
			const response = await handleSaveSettings(createMockRequest({ customCode: whitespace }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCode).toBe(whitespace);
			const read = await handleGetSettings(createGetRequest(), env);
			expect((await read.json()).customCode).toBe(whitespace);
		});

		it('accepts and reads the maximum allowed length', async () => {
			const value = 'a'.repeat(MAX_CUSTOM_CODE_LENGTH);
			const response = await handleSaveSettings(createMockRequest({ customCode: value }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCode).toBe(value);
			const read = await handleGetSettings(createGetRequest(), env);
			expect((await read.json()).customCode).toBe(value);
		});

		it.each([null, false, 123, [], {}].map((value) => [value]))(
			'rejects non-string code %j without changing stored settings',
			async (value) => {
				const original = JSON.stringify({ customCode, maxBackups: 25 });
				await env.SECRETS_KV.put('settings', original);
				const response = await handleSaveSettings(createMockRequest({ maxBackups: 30, customCode: value }), env);
				expect(response.status).toBe(400);
				expect((await response.json()).message).toBe('自定义代码必须是字符串');
				expect(await env.SECRETS_KV.get('settings')).toBe(original);
			},
		);

		it('rejects code above the maximum length without changing stored settings', async () => {
			const original = JSON.stringify({ customCode, maxBackups: 25 });
			await env.SECRETS_KV.put('settings', original);
			const response = await handleSaveSettings(
				createMockRequest({ maxBackups: 30, customCode: 'a'.repeat(MAX_CUSTOM_CODE_LENGTH + 1) }),
				env,
			);
			expect(response.status).toBe(400);
			expect((await response.json()).message).toBe(`自定义代码不能超过 ${MAX_CUSTOM_CODE_LENGTH} 个字符`);
			expect(await env.SECRETS_KV.get('settings')).toBe(original);
		});

		it.each([
			['null', null],
			['boolean', false],
			['number', 123],
			['array', []],
			['object', {}],
			['overlong string', 'a'.repeat(MAX_CUSTOM_CODE_LENGTH + 1)],
		])('falls back to empty code for a stored %s and keeps other preferences', async (_description, value) => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ customCode: value, maxBackups: 25, language: 'en' }));
			const response = await handleGetSettings(createGetRequest(), env);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ customCode: '', maxBackups: 25, language: 'en' });
		});

		it('adds empty code to legacy settings when saving another preference', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 25 }));
			const response = await handleSaveSettings(createMockRequest({ jwtExpiryDays: 45 }), env);
			expect(response.status).toBe(200);
			expect(JSON.parse(await env.SECRETS_KV.get('settings'))).toEqual({
				jwtExpiryDays: 45,
				maxBackups: 25,
				defaultExportFormat: 'json',
				customCode: '',
				customCodes: [],
			});
		});
	});

	describe('multiple custom code settings', () => {
		const first = { id: 'background', name: '背景', enabled: true, code: '  <style>body { color: red; }</style>\r\n' };
		const second = { id: 'effect', name: '', enabled: false, code: '<script>window.effect = "</textarea>";</script>' };
		const third = { id: 'footer', name: '页脚', enabled: true, code: '<div>  Footer &amp; links  </div>\n' };
		const codes = [first, second, third];

		it('migrates legacy code once on read while preserving every character', async () => {
			const code = '  <style>body { color: red; }</style>\r\n<script>window.test=1;</script>\t';
			const raw = JSON.stringify({ customCode: code, maxBackups: 21 });
			await env.SECRETS_KV.put('settings', raw);
			const response = await handleGetSettings(createGetRequest(), env);
			expect(await response.json()).toMatchObject({
				customCodes: [{ id: 'legacy-custom-code', name: '', enabled: true, code }],
				customCode: code,
				maxBackups: 21,
			});
			expect(await env.SECRETS_KV.get('settings')).toBe(raw);
		});

		it('migrates empty legacy code to an empty list', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ customCode: '' }));
			expect(await getSettings(env)).toMatchObject({ customCodes: [], customCode: '' });
		});

		it('persists independent names, toggles, order, and unmodified code', async () => {
			const response = await handleSaveSettings(createMockRequest({ customCodes: codes }), env);
			expect(response.status).toBe(200);
			const expected = { customCodes: codes, customCode: first.code + '\n' + third.code };
			expect((await response.json()).settings).toMatchObject(expected);
			expect(JSON.parse(await env.SECRETS_KV.get('settings'))).toMatchObject(expected);
			expect(await getSettings(env)).toMatchObject(expected);
		});

		it('changes execution order and enabled state without losing disabled code', async () => {
			await handleSaveSettings(createMockRequest({ customCodes: codes }), env);
			const changed = [{ ...third, enabled: false }, { ...second, enabled: true }, first];
			const response = await handleSaveSettings(createMockRequest({ customCodes: changed }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings).toMatchObject({
				customCodes: changed,
				customCode: second.code + '\n' + first.code,
			});
		});

		it('preserves all entries while another preference is saved', async () => {
			await handleSaveSettings(createMockRequest({ customCodes: codes, maxBackups: 25, language: 'en' }), env);
			const response = await handleSaveSettings(createMockRequest({ jwtExpiryDays: 45 }), env);
			expect((await response.json()).settings).toMatchObject({
				customCodes: codes,
				customCode: first.code + '\n' + third.code,
				maxBackups: 25,
				language: 'en',
				jwtExpiryDays: 45,
			});
		});

		it.each([[], null, {}, false, [null], [{ ...first, enabled: 'false' }]].map((value) => [value]))(
			'never revives legacy code when the new list is empty or invalid: %j',
			async (customCodes) => {
				await env.SECRETS_KV.put('settings', JSON.stringify({ customCodes, customCode: '<script>legacy()</script>', maxBackups: 25 }));
				expect(await getSettings(env)).toMatchObject({ customCodes: [], customCode: '', maxBackups: 25 });
				expect(getEnabledCustomCode({ customCodes, customCode: '<script>legacy()</script>' })).toBe('');
			},
		);

		it('an explicitly saved empty list stays empty after future reads and partial saves', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ customCode: '<script>legacy()</script>' }));
			await handleSaveSettings(createMockRequest({ customCodes: [] }), env);
			await handleSaveSettings(createMockRequest({ maxBackups: 25 }), env);
			expect(await getSettings(env)).toMatchObject({ customCodes: [], customCode: '' });
		});

		it('accepts all list and name boundaries with raw whitespace preserved', async () => {
			const customCodes = Array.from({ length: MAX_CUSTOM_CODE_ITEMS }, (_, index) => ({
				id: `code_${index}`,
				name: '名'.repeat(MAX_CUSTOM_CODE_NAME_LENGTH),
				enabled: true,
				code: ' \t\r\n ',
			}));
			customCodes[0].id = 'a'.repeat(64);
			const response = await handleSaveSettings(createMockRequest({ customCodes }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCodes).toEqual(customCodes);
		});

		it('accepts maximum total code length even when derived separators exceed the legacy maximum', async () => {
			const customCodes = [
				{ ...first, code: 'a'.repeat(MAX_CUSTOM_CODE_LENGTH / 2) },
				{ ...second, enabled: true, code: 'b'.repeat(MAX_CUSTOM_CODE_LENGTH / 2) },
			];
			const response = await handleSaveSettings(createMockRequest({ customCodes }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCode).toHaveLength(MAX_CUSTOM_CODE_LENGTH + 1);
			const saved = await getSettings(env);
			expect(saved.customCodes).toEqual(customCodes);
			expect(saved.customCode).toBe(customCodes[0].code + '\n' + customCodes[1].code);
		});

		it.each([
			['null', null],
			['non-array', {}],
			['null entry', [null]],
			['array entry', [[]]],
			['string entry', ['code']],
			['missing id', [{ name: '', enabled: true, code: '' }]],
			['empty id', [{ ...first, id: '' }]],
			['invalid id', [{ ...first, id: 'space id' }]],
			['long id', [{ ...first, id: 'a'.repeat(65) }]],
			['duplicate id', [first, first]],
			['missing name', [{ id: 'code', enabled: true, code: '' }]],
			['non-string name', [{ ...first, name: 1 }]],
			['long name', [{ ...first, name: 'a'.repeat(MAX_CUSTOM_CODE_NAME_LENGTH + 1) }]],
			['missing toggle', [{ id: 'code', name: '', code: '' }]],
			['string toggle', [{ ...first, enabled: 'true' }]],
			['number toggle', [{ ...first, enabled: 1 }]],
			['missing code', [{ id: 'code', name: '', enabled: true }]],
			['non-string code', [{ ...first, code: {} }]],
			['overlong entry', [{ ...first, code: 'a'.repeat(MAX_CUSTOM_CODE_LENGTH + 1) }]],
			['overlong total including disabled entries', [{ ...first, code: 'a'.repeat(MAX_CUSTOM_CODE_LENGTH) }, second]],
			['too many entries', Array.from({ length: MAX_CUSTOM_CODE_ITEMS + 1 }, (_, index) => ({ ...first, id: `code-${index}` }))],
		])('rejects %s atomically without leaking submitted code', async (_label, customCodes) => {
			const original = JSON.stringify({ customCodes: codes, maxBackups: 25 });
			await env.SECRETS_KV.put('settings', original);
			const response = await handleSaveSettings(createMockRequest({ maxBackups: 30, customCodes }), env);
			expect(response.status).toBe(400);
			expect((await response.json()).details).toEqual({ field: 'customCodes' });
			expect(await env.SECRETS_KV.get('settings')).toBe(original);
			expect(sanitizeCustomCodes(customCodes)).toEqual([]);
		});

		it('rejects a combined legacy and new request without changing any preference', async () => {
			const original = JSON.stringify({ maxBackups: 25 });
			await env.SECRETS_KV.put('settings', original);
			const response = await handleSaveSettings(createMockRequest({ maxBackups: 30, customCodes: [], customCode: '' }), env);
			expect(response.status).toBe(400);
			expect(await env.SECRETS_KV.get('settings')).toBe(original);
		});

		it('logs validation metadata without logging custom source code', async () => {
			const secretCode = '<script>window.privateToken = "do-not-log-this-token";</script>';
			const warn = vi.spyOn(getLogger(env), 'warn').mockImplementation(() => {});
			try {
				const response = await handleSaveSettings(
					createMockRequest({ customCodes: [{ ...first, code: secretCode, enabled: 'true' }] }),
					env,
				);
				expect(response.status).toBe(400);
				expect(warn).toHaveBeenCalled();
				expect(JSON.stringify(warn.mock.calls)).not.toContain(secretCode);
				expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log-this-token');
			} finally {
				warn.mockRestore();
			}
		});

		it('rejects malformed request JSON without logging source or changing settings', async () => {
			const original = JSON.stringify({ customCodes: codes, maxBackups: 25 });
			await env.SECRETS_KV.put('settings', original);
			const privateSource = '<secret>';
			const request = new Request('https://example.com/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: privateSource,
			});
			const logger = getLogger(env);
			const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
			const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
			try {
				const response = await handleSaveSettings(request, env);
				expect(response.status).toBe(400);
				expect((await response.json()).message).toBe('设置数据必须是有效的 JSON');
				expect(await env.SECRETS_KV.get('settings')).toBe(original);
				expect(warn).toHaveBeenCalled();
				expect(JSON.stringify(warn.mock.calls)).not.toContain(privateSource);
				expect(error).not.toHaveBeenCalled();
			} finally {
				warn.mockRestore();
				error.mockRestore();
			}
		});

		it('persists only the supported properties of custom code entries', async () => {
			const response = await handleSaveSettings(createMockRequest({ customCodes: [{ ...first, extra: 'ignored' }] }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCodes).toEqual([first]);
		});

		it.each([[[first]], [codes]])('blocks old clients from overwriting an existing new list', async (customCodes) => {
			const original = JSON.stringify({ customCodes, maxBackups: 25 });
			await env.SECRETS_KV.put('settings', original);
			const response = await handleSaveSettings(createMockRequest({ maxBackups: 30, customCode: '' }), env);
			expect(response.status).toBe(409);
			expect((await response.json()).message).toBe('请刷新页面后再修改自定义代码');
			expect(await env.SECRETS_KV.get('settings')).toBe(original);
		});

		it.each(['', second.code])('blocks legacy writes %j after migrated metadata changes', async (customCode) => {
			for (const metadata of [
				{ name: 'Renamed', enabled: true },
				{ name: '', enabled: false },
			]) {
				const item = { id: 'legacy-custom-code', code: first.code, ...metadata };
				const original = JSON.stringify({ customCodes: [item], maxBackups: 25 });
				await env.SECRETS_KV.put('settings', original);
				const response = await handleSaveSettings(createMockRequest({ maxBackups: 30, customCode }), env);
				expect(response.status).toBe(409);
				expect((await response.json()).message).toBe('请刷新页面后再修改自定义代码');
				expect(await env.SECRETS_KV.get('settings')).toBe(original);
			}
		});

		it('continues accepting legacy writes until the list is replaced with new entries', async () => {
			await handleSaveSettings(createMockRequest({ customCode: first.code }), env);
			const response = await handleSaveSettings(createMockRequest({ customCode: second.code }), env);
			expect(response.status).toBe(200);
			expect((await response.json()).settings.customCodes).toEqual([
				{ id: 'legacy-custom-code', name: '', enabled: true, code: second.code },
			]);
		});

		it('allows normal automatic saving beyond the sensitive-operation quota', async () => {
			for (let index = 0; index < 20; index++) {
				const response = await handleSaveSettings(createMockRequest({ customCodes: [{ ...first, code: `edit ${index}` }] }), env);
				expect(response.status).toBe(200);
			}
			expect((await getSettings(env)).customCodes[0].code).toBe('edit 19');
		});

		it('still applies a dedicated settings rate limit', async () => {
			const now = Date.now();
			vi.spyOn(Date, 'now').mockReturnValue(now);
			try {
				await env.SECRETS_KV.put('ratelimit:v2:settings:unknown', JSON.stringify({ timestamps: Array(180).fill(now) }));
				const response = await handleSaveSettings(createMockRequest({ customCodes: codes }), env);
				expect(response.status).toBe(429);
				expect(response.headers.get('X-RateLimit-Limit')).toBe('180');
				expect(env.SECRETS_KV.store.has('settings')).toBe(false);
			} finally {
				vi.restoreAllMocks();
			}
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

	describe('handleSaveSettings - language validation', () => {
		it('does not turn an unset language into an explicit auto preference when saving another setting', async () => {
			const saved = await handleSaveSettings(createMockRequest({ maxBackups: 20 }), env);
			expect((await saved.json()).settings).not.toHaveProperty('language');
			expect(JSON.parse(await env.SECRETS_KV.get('settings'))).not.toHaveProperty('language');
			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();
			expect(data.maxBackups).toBe(20);
			expect(data).not.toHaveProperty('language');
		});

		it.each(LANGUAGE_PREFERENCES)('accepts %s', async (lang) => {
			const resp = await handleSaveSettings(createMockRequest({ language: lang }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.settings.language).toBe(lang);

			const stored = JSON.parse(await env.SECRETS_KV.get('settings'));
			expect(stored.language).toBe(lang);
		});

		it('rejects unsupported languages', async () => {
			const resp = await handleSaveSettings(createMockRequest({ language: 'unsupported' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(400);
			expect(data.message).toBe(`语言偏好仅支持：${LANGUAGE_PREFERENCES.join(', ')}`);
		});

		it('rejects non-string values', async () => {
			const resp = await handleSaveSettings(createMockRequest({ language: 123 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(400);
			expect(data.message).toBe('语言偏好必须是字符串');
		});
	});
});
