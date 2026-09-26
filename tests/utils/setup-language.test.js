import { describe, expect, it, vi } from 'vitest';
import { LANGUAGE_PREFERENCES } from '../../src/shared/languages.js';
import { checkIfSetupRequired, handleFirstTimeSetup } from '../../src/utils/auth.js';

const SETUP_KEYS = ['user_password', 'jwt_secret', 'setup_completed', 'settings'];

function createEnvironment(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		LOG_LEVEL: 'FATAL',
		SECRETS_KV: {
			get: vi.fn(async (key, type) => {
				const value = values.get(key) ?? null;
				return type === 'json' && value !== null ? JSON.parse(value) : value;
			}),
			put: vi.fn(async (key, value) => values.set(key, value)),
		},
	};
}

function createSetupRequest(overrides = {}) {
	return new Request('https://example.com/api/setup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			password: 'SecurePassword123!',
			confirmPassword: 'SecurePassword123!',
			...overrides,
		}),
	});
}

function expectNoSetupWrites(env) {
	const writtenKeys = env.SECRETS_KV.put.mock.calls.map(([key]) => key);
	for (const key of SETUP_KEYS) {
		expect(writtenKeys).not.toContain(key);
	}
}

describe('首次设置语言持久化', () => {
	it.each([...LANGUAGE_PREFERENCES, ' en '])('保存语言 %j，并保留已有其他设置', async (language) => {
		const existing = {
			jwtExpiryDays: 45,
			maxBackups: 20,
			defaultExportFormat: 'csv',
			customPreference: { enabled: true },
			language: 'zh-CN',
		};
		const env = createEnvironment({ settings: JSON.stringify(existing) });

		const response = await handleFirstTimeSetup(createSetupRequest({ language }), env);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ success: true, expiresIn: '45天' });
		expect(response.headers.get('Set-Cookie')).toContain('auth_token=');
		expect(JSON.parse(await env.SECRETS_KV.get('settings'))).toEqual({ ...existing, language: language.trim() });
		expect(await checkIfSetupRequired(env)).toBe(false);
	});

	it.each(['unsupported', 'EN', 'zh', '', '   ', null, false, 123, {}, [], ['en']])(
		'拒绝非法语言 %j，且不写入密码和配置',
		async (language) => {
			const settings = JSON.stringify({ maxBackups: 25, language: 'zh-TW' });
			const env = createEnvironment({ settings });

			const response = await handleFirstTimeSetup(createSetupRequest({ language }), env);

			expect(response.status).toBe(400);
			expectNoSetupWrites(env);
			expect(await env.SECRETS_KV.get('settings')).toBe(settings);
			expect(await checkIfSetupRequired(env)).toBe(true);
		},
	);

	it.each([
		{ password: '', confirmPassword: '' },
		{ password: 'SecurePassword123!', confirmPassword: 'DifferentPassword123!' },
		{ password: 'weak', confirmPassword: 'weak' },
	])('密码校验失败时不保存有效语言：%j', async (passwords) => {
		const env = createEnvironment();

		const response = await handleFirstTimeSetup(createSetupRequest({ ...passwords, language: 'en' }), env);

		expect(response.status).toBe(400);
		expectNoSetupWrites(env);
	});

	it.each([null, { maxBackups: 25 }, { language: 'zh-TW', maxBackups: 25 }])(
		'兼容未提交语言的旧客户端，保持原设置 %j',
		async (settings) => {
			const initial = settings === null ? {} : { settings: JSON.stringify(settings) };
			const env = createEnvironment(initial);

			const response = await handleFirstTimeSetup(createSetupRequest(), env);

			expect(response.status).toBe(200);
			expect(await env.SECRETS_KV.get('settings')).toBe(initial.settings ?? null);
			expect(env.SECRETS_KV.put.mock.calls.some(([key]) => key === 'settings')).toBe(false);
			expect(await checkIfSetupRequired(env)).toBe(false);
		},
	);

	it('已完成初始化时不能通过 setup 改写语言', async () => {
		const settings = JSON.stringify({ language: 'zh-TW' });
		const env = createEnvironment({ user_password: 'existing-password-hash', settings });

		const response = await handleFirstTimeSetup(createSetupRequest({ language: 'en' }), env);

		expect(response.status).toBe(409);
		expectNoSetupWrites(env);
		expect(await env.SECRETS_KV.get('settings')).toBe(settings);
	});

	it('保存语言失败后不创建密码，恢复存储后可重试初始化', async () => {
		const env = createEnvironment();
		const originalPut = env.SECRETS_KV.put.getMockImplementation();
		let failSettingsWrite = true;
		env.SECRETS_KV.put.mockImplementation(async (key, value) => {
			if (key === 'settings' && failSettingsWrite) {
				throw new Error('Settings storage unavailable');
			}
			return originalPut(key, value);
		});

		const failed = await handleFirstTimeSetup(createSetupRequest({ language: 'en' }), env);

		expect(failed.status).toBe(500);
		expect(await checkIfSetupRequired(env)).toBe(true);
		for (const key of ['user_password', 'jwt_secret', 'setup_completed']) {
			expect(env.SECRETS_KV.put.mock.calls.some(([writtenKey]) => writtenKey === key)).toBe(false);
		}

		failSettingsWrite = false;
		const retried = await handleFirstTimeSetup(createSetupRequest({ language: 'en' }), env);

		expect(retried.status).toBe(200);
		expect(JSON.parse(await env.SECRETS_KV.get('settings')).language).toBe('en');
		expect(await checkIfSetupRequired(env)).toBe(false);
	});
});
