import { describe, expect, it } from 'vitest';
import { getRequestLanguage, localizeResponseData, translateServerMessage } from '../../src/utils/i18n.js';
import { createJsonResponse } from '../../src/utils/response.js';
import { AuthenticationError, errorToResponse } from '../../src/utils/errors.js';
import { handleFirstTimeSetup, handleLogin, handleLogout } from '../../src/utils/auth.js';
import { handleChangePassword } from '../../src/api/password.js';
import { handleSaveSettings } from '../../src/api/settings.js';
import { handleBackupSecrets } from '../../src/api/secrets/backup.js';
import { handleRestoreBackup } from '../../src/api/secrets/restore.js';
import { handleDeleteSecret } from '../../src/api/secrets/crud.js';
import { handleSaveWebDAVConfig } from '../../src/api/webdav.js';
import { handleSaveS3Config } from '../../src/api/s3.js';
import { createRateLimitResponse } from '../../src/utils/rateLimit.js';
import { addSecretSchema, validateRequest } from '../../src/utils/validation.js';

function request(path = '/api/test', language, body, headers = {}) {
	return new Request(`https://example.com${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'Content-Type': 'application/json', ...(language ? { 'X-Language': language } : {}), ...headers },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

function environment(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		LOG_LEVEL: 'FATAL',
		SECRETS_KV: {
			async get(key, type) {
				if (Array.isArray(key)) {
					return new Map(await Promise.all(key.map(async (item) => [item, await this.get(item, type)])));
				}
				const value = values.get(key) ?? null;
				return value !== null && type === 'json' ? JSON.parse(value) : value;
			},
			async put(key, value) {
				values.set(key, value);
			},
			async delete(key) {
				values.delete(key);
			},
		},
	};
}

describe('server language negotiation and message boundaries', () => {
	it('uses the selected language ahead of a URL preference and the browser language', () => {
		expect(getRequestLanguage(request('/?lang=en', 'zh-TW', undefined, { 'Accept-Language': 'zh-CN' }))).toBe('zh-TW');
		expect(getRequestLanguage(request('/?lang=en', undefined, undefined, { 'Accept-Language': 'zh-CN' }))).toBe('en');
		expect(getRequestLanguage(request('/', undefined, undefined, { 'Accept-Language': 'fr, en;q=0.4, zh-HK;q=0.9' }))).toBe('fr');
		expect(getRequestLanguage(request('/', undefined, undefined, { 'Accept-Language': 'en;q=0, zh-Hant;q=0.2' }))).toBe('zh-TW');
		expect(getRequestLanguage(request('/', 'unsupported', undefined, { 'Accept-Language': 'en-GB' }))).toBe('en');
		expect(getRequestLanguage(request('/', undefined, undefined, { 'Accept-Language': 'en;q=oops, fr' }))).toBe('fr');
		expect(getRequestLanguage()).toBe('zh-CN');
	});

	it('translates diagnostics and historical sync errors without changing secrets, names, or stored configuration', () => {
		const data = {
			message: '密钥添加成功',
			name: '密码错误',
			secret: { name: '密码错误', message: '密码错误', secret: 'SECRET' },
			destinations: [{ name: '密码错误', config: { path: '密码错误' }, status: { lastError: { error: 'WebDAV 推送超时（15s）' } } }],
			results: [{ error: '服务"中文名称"的账户"保留中文"密钥已存在' }],
		};
		const translated = localizeResponseData(data, 'en');
		expect(translated.message).toBe('Secret added');
		expect(translated.name).toBe('密码错误');
		expect(translated.secret).toEqual(data.secret);
		expect(translated.destinations[0].name).toBe('密码错误');
		expect(translated.destinations[0].config.path).toBe('密码错误');
		expect(translated.destinations[0].status.lastError.error).toBe('WebDAV upload timed out after 15 seconds');
		expect(translated.results[0].error).toBe('A secret for service "中文名称" and account "保留中文" already exists');
		expect(data.message).toBe('密钥添加成功');
		expect(localizeResponseData([data.secret], 'en')).toEqual([data.secret]);
	});

	it('translates nested backup row diagnostics while preserving names and all row counts', () => {
		const result = translateServerMessage(
			'解析失败：备份包含无效密钥，已阻止生成：第 1 条（中文服务）缺少有效密钥；第 2 条缺少有效密钥；另有 3 条',
			'en',
		);
		expect(result).toBe(
			'Parsing failed: Backup contains invalid secrets and was not created: Entry 1 (中文服务) is missing a valid secret; Entry 2 is missing a valid secret; 3 more entries',
		);
		expect(translateServerMessage('服务"中文; 名称" 已存在', 'en')).toBe('Service "中文; 名称" already exists');
		expect(translateServerMessage('密钥不能为空; 字段 "digits" 类型错误，期望 number', 'en')).toBe(
			'Secret is required; Field "digits" must be of type number',
		);
	});

	it('keeps error codes and fallback Chinese responses stable', async () => {
		const error = new AuthenticationError('密码错误', { operation: 'login' });
		expect(await errorToResponse(error).json()).toMatchObject({ error: 'AuthenticationError', message: '密码错误', statusCode: 401 });
		const response = errorToResponse(error, request('/', 'en'));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			error: 'AuthenticationError',
			message: 'Incorrect password',
			details: { operation: 'login' },
		});
		expect(response.headers.get('Content-Language')).toBe('en');
		expect(await errorToResponse(new Error('do not expose'), request('/', 'zh-TW')).json()).toMatchObject({ message: '伺服器內部錯誤' });
	});

	it('preserves cache/security headers while varying by language', () => {
		const response = createJsonResponse(
			{ message: '登录成功' },
			200,
			request('/', 'en', undefined, { Host: 'example.com', Origin: 'https://example.com' }),
			{ Vary: 'Origin, Accept-Encoding', 'Cache-Control': 'no-store' },
		);
		expect(response.headers.get('Vary')).toBe('Origin, Accept-Encoding, X-Language, Accept-Language');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});
});

describe('localized API flows', () => {
	it('localizes setup, sign-in, password change, and sign-out while retaining the auth cookie', async () => {
		const env = environment();
		const password = 'SecurePassword123!';
		const setup = await handleFirstTimeSetup(request('/api/setup', 'en', { password, confirmPassword: password, language: 'en' }), env);
		expect(setup.status).toBe(200);
		expect(setup.headers.get('Set-Cookie')).toContain('auth_token=');
		expect(await setup.json()).toMatchObject({ message: 'Password set. You are now signed in.', expiresIn: '30 days' });
		const incorrect = await handleLogin(request('/api/login', 'zh-TW', { credential: 'incorrect' }), env);
		expect(incorrect.status).toBe(401);
		expect(await incorrect.json()).toMatchObject({ message: '密碼錯誤' });
		const login = await handleLogin(request('/api/login', 'en', { credential: password }), env);
		expect(await login.json()).toMatchObject({ message: 'Signed in successfully' });
		const change = await handleChangePassword(
			request('/api/password', 'en', { currentPassword: password, newPassword: 'NewPassword123!', confirmPassword: 'NewPassword123!' }),
			env,
		);
		expect(await change.json()).toMatchObject({ message: 'Password changed. Please sign in again.' });
		const logout = await handleLogout(
			request('/api/logout', 'en', {}, { Host: 'example.com', Origin: 'https://example.com', 'X-Requested-With': 'XMLHttpRequest' }),
			environment(),
		);
		expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
		expect(await logout.json()).toMatchObject({ message: 'Signed out' });
	});

	it.each([
		['en', 'Password must be at least 8 characters long'],
		['zh-TW', '密碼長度至少為 8 位'],
		['zh-CN', '密码长度至少为 8 位'],
	])('returns the selected %s setup validation message', async (language, message) => {
		const response = await handleFirstTimeSetup(
			request('/api/setup', language, { password: 'weak', confirmPassword: 'weak' }),
			environment(),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ message });
	});

	it('localizes schema and preference validation, including multiple joined messages', async () => {
		const schema = await validateRequest(addSecretSchema)(request('/api/secrets', 'en', {}));
		expect(await schema.json()).toMatchObject({
			error: 'Request validation failed',
			message: 'Service name is required; Secret is required',
		});
		const settings = await handleSaveSettings(request('/api/settings', 'zh-TW', { jwtExpiryDays: 0 }), environment());
		expect(await settings.json()).toMatchObject({ message: '登入有效期必須介於 1～365 天' });
	});

	it('localizes backup, restore preview, restore errors, and deleted-secret errors', async () => {
		const backup = await handleBackupSecrets(request('/api/backup', 'en', {}), environment());
		expect(await backup.json()).toMatchObject({ message: 'There are no secrets to back up' });
		const missing = await handleDeleteSecret(request('/api/secrets/missing', 'zh-TW', {}), environment());
		expect(await missing.json()).toMatchObject({ message: '金鑰不存在' });
		const restore = await handleRestoreBackup(request('/api/backup/restore', 'en', {}), environment());
		expect(await restore.json()).toMatchObject({ message: 'Provide a backup key or uploaded backup content to restore' });
		const preview = await handleRestoreBackup(
			request('/api/backup/restore', 'en', {
				preview: true,
				backupFileName: 'backup_2026-09-24.json',
				backupContent: JSON.stringify({ secrets: [{ name: '中文名称', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }] }),
			}),
			environment(),
		);
		expect(preview.status).toBe(200);
		expect(await preview.json()).toMatchObject({ data: { message: 'Backup preview loaded', secrets: [{ name: '中文名称' }] } });
	});

	it('localizes WebDAV/S3 validation and rate limiting', async () => {
		const webdav = await handleSaveWebDAVConfig(
			request('/api/webdav', 'en', { name: '同步', url: 'https://dav.example.com', username: 'user' }),
			environment(),
		);
		expect(await webdav.json()).toMatchObject({ message: 'Password is required for initial configuration' });
		const s3 = await handleSaveS3Config(
			request('/api/s3', 'zh-TW', { name: '同步', endpoint: 'https://s3.example.com', bucket: 'bucket', accessKeyId: 'key' }),
			environment(),
		);
		expect(await s3.json()).toMatchObject({ message: '首次設定時 Secret Access Key 不能為空' });
		const limited = createRateLimitResponse({ resetAt: Date.now() + 30_000, limit: 5, remaining: 0 }, request('/', 'en'));
		expect(limited.status).toBe(429);
		expect(await limited.json()).toMatchObject({
			error: 'Too many requests',
			message: 'Too many requests. Please try again in 30 seconds.',
		});
		expect(limited.headers.get('Retry-After')).toBe('30');
	});

	it.each(['Google Drive', 'OneDrive'])('localizes every %s authorization outcome and its nested failure', (provider) => {
		expect(translateServerMessage(`${provider} 授权成功，已完成自动连接测试，当前目标保持启用，后续备份会自动推送。`, 'en')).toContain(
			'future backups will sync automatically',
		);
		expect(
			translateServerMessage(`${provider} 授权成功，已完成自动连接测试。当前目标仍为关闭状态，你可以按需手动启用同步。`, 'zh-TW'),
		).toContain('您可以視需要手動啟用同步');
		expect(translateServerMessage(`${provider} 授权已保存，但自动连接测试失败：${provider} 上传失败 (403)`, 'en')).toBe(
			`${provider} authorization was saved, but the automatic connection test failed: ${provider} upload failed (403)`,
		);
	});
});
