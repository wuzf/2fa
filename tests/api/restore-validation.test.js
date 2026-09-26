import { describe, expect, it } from 'vitest';

import { handleExportBackup, handleRestoreBackup } from '../../src/api/secrets/restore.js';
import { handleGetBackups } from '../../src/api/secrets/backup.js';
import { handleDeleteSecret, handleUpdateSecret } from '../../src/api/secrets/crud.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';
import { createBackupEntry } from '../../src/utils/backup-format.js';
import { generateDataHash } from '../../src/utils/data-hash.js';
import { decryptData } from '../../src/utils/encryption.js';

class MockKV {
	constructor() {
		this.store = new Map();
		this.metadata = new Map();
	}

	async get(key, type = 'text') {
		if (Array.isArray(key)) {
			return new Map(await Promise.all(key.map(async (item) => [item, await this.get(item, type)])));
		}

		const value = this.store.get(key);
		if (!value) {
			return null;
		}

		return type === 'json' ? JSON.parse(value) : value;
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
		const prefix = options.prefix || '';
		const limit = options.limit || 1000;
		const keys = Array.from(this.store.keys())
			.sort()
			.filter((key) => key.startsWith(prefix));
		const startIndex = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
		const pageKeys = keys.slice(startIndex, startIndex + limit);

		return {
			keys: pageKeys.map((name) => ({ name, metadata: this.metadata.get(name) || { created: new Date().toISOString() } })),
			list_complete: startIndex + limit >= keys.length,
			cursor: startIndex + limit < keys.length ? String(startIndex + limit) : undefined,
		};
	}
}

function createMockEnv() {
	return {
		SECRETS_KV: new MockKV(),
		ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/backup/restore') {
	return {
		method,
		url,
		headers: new Headers({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' }),
		json: async () => body,
	};
}

const CURRENT_SECRET = {
	id: 'current',
	name: 'Current',
	secret: 'MFRGGZDFMZTWQ2LK',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const VALID_SECRET = {
	id: 'github',
	name: 'GitHub',
	account: 'user@example.com',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
	counter: 0,
};

// Mirrors the per-record checks the web UI applies before it accepts a secrets list.
function isAcceptedByWebUI(secret) {
	const type = String(secret.type || 'TOTP').toUpperCase();
	return (
		((typeof secret.id === 'string' && secret.id.length > 0) || (Number.isSafeInteger(secret.id) && secret.id >= 0)) &&
		!/[\s"'<>&\\]/.test(String(secret.id)) &&
		typeof secret.name === 'string' &&
		secret.name.trim().length > 0 &&
		['TOTP', 'HOTP'].includes(type) &&
		[6, 8].includes(Number(secret.digits || 6)) &&
		['SHA1', 'SHA256', 'SHA512'].includes(String(secret.algorithm || 'SHA1').toUpperCase()) &&
		(type === 'HOTP'
			? Number.isSafeInteger(secret.counter ?? 0) && (secret.counter ?? 0) >= 0
			: Number.isSafeInteger(Number(secret.period || 30)) && Number(secret.period || 30) > 0)
	);
}

describe('restore validation of account parameters', () => {
	it('restores uploaded entries with unsupported parameters unchanged and lists them in the preview', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const backupFileName = 'backup_2026-04-17_00-00-00-000-upload.json';
		const backupContent = JSON.stringify({
			timestamp: '2026-04-17T00:00:00.000Z',
			secrets: [
				VALID_SECRET,
				{ ...VALID_SECRET, id: 'five', name: 'Five digits', digits: 5 },
				{ ...VALID_SECRET, id: 'md5', algorithm: 'MD5' },
			],
		});

		const previewResponse = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent, preview: true }), env);
		const preview = await previewResponse.json();

		expect(previewResponse.status).toBe(200);
		expect(preview.data).toMatchObject({ partial: false, skippedInvalidCount: 0, count: 3, warnings: [], unsupportedCount: 2 });
		expect(preview.data.unsupportedWarnings).toEqual([
			'第 2 条（Five digits）：验证码位数仅支持6位或8位',
			'第 3 条（GitHub）：哈希算法仅支持SHA1、SHA256或SHA512',
		]);

		const englishPreviewResponse = await handleRestoreBackup(
			createMockRequest({ backupFileName, backupContent, preview: true }, 'POST', 'https://example.com/api/backup/restore?lang=en'),
			env,
		);
		expect((await englishPreviewResponse.json()).data.unsupportedWarnings).toEqual([
			'Entry 2 (Five digits): OTP codes must have 6 or 8 digits',
			'Entry 3 (GitHub): Hash algorithm must be SHA1, SHA256, or SHA512',
		]);

		const restoreResponse = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
		const restore = await restoreResponse.json();

		expect(restoreResponse.status).toBe(200);
		expect(restore).toMatchObject({ success: true, count: 3, unsupportedCount: 2 });
		expect((await getAllSecrets(env)).map(({ id, digits, algorithm }) => ({ id, digits, algorithm }))).toEqual([
			{ id: 'github', digits: 6, algorithm: 'SHA1' },
			{ id: 'five', digits: 5, algorithm: 'SHA1' },
			{ id: 'md5', digits: 6, algorithm: 'MD5' },
		]);
	});

	it('shows an entry without a name as untitled in the request language', async () => {
		const env = createMockEnv();
		const backupFileName = 'backup_2026-04-17_00-00-00-000-blank.txt';
		// A blank label with a blank issuer leaves the entry without a service name.
		const backupContent = [
			'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
			'otpauth://totp/%20?secret=MFRGGZDFMZTWQ2LK&issuer=%20',
		].join('\n');
		const restoreIn = async (lang) =>
			(
				await handleRestoreBackup(
					createMockRequest({ backupFileName, backupContent }, 'POST', `https://example.com/api/backup/restore?lang=${lang}`),
					env,
				)
			).json();

		expect((await restoreIn('zh-CN')).warnings).toEqual(['第 2 条（未命名）：服务名称不能为空']);
		expect((await restoreIn('zh-TW')).warnings).toEqual(['第 2 筆（未命名）：服務名稱不能為空']);
		expect((await restoreIn('en')).warnings).toEqual(['Entry 2 (Untitled): Service name is required']);
		expect((await restoreIn('ja')).warnings).toEqual(['エントリ 2 (名称未設定): サービス名は必須です']);
	});

	it('blocks a backup with skipped entries and reports unsupported entries only in the preview', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const backupFileName = 'backup_2026-04-17_00-00-00-000-mixed.json';
		const backupContent = JSON.stringify({
			secrets: [
				VALID_SECRET,
				{ ...VALID_SECRET, id: 'five', name: 'Five digits', digits: 5 },
				// Passes the Base32 check but has a single non-padding character.
				{ ...VALID_SECRET, id: 'short', name: 'Short', secret: 'A=======' },
			],
		});

		const preview = await (await handleRestoreBackup(createMockRequest({ backupFileName, backupContent, preview: true }), env)).json();

		expect(preview.data).toMatchObject({ partial: true, skippedInvalidCount: 1, count: 2, unsupportedCount: 1 });
		expect(preview.data.warnings).toEqual([
			'该备份在创建或解析时已跳过 1 条无效密钥，无法保证数据完整，已阻止恢复或导出',
			'第 3 条（Short）：缺少有效密钥',
		]);
		expect(preview.data.unsupportedWarnings).toEqual(['第 2 条（Five digits）：验证码位数仅支持6位或8位']);

		const restoreResponse = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
		const restore = await restoreResponse.json();

		expect(restoreResponse.status).toBe(400);
		expect(restore.error).toBe('备份不完整');
		expect(restore.message).toBe('该备份在创建或解析时已跳过 1 条无效密钥，无法保证数据完整，已阻止恢复');
		// Only the skipped entries: the summary is in `message`.
		expect(restore.warnings).toEqual(['第 3 条（Short）：缺少有效密钥']);
		expect((await getAllSecrets(env)).map((secret) => secret.name)).toEqual(['Current']);

		const englishResponse = await handleRestoreBackup(
			createMockRequest({ backupFileName, backupContent }, 'POST', 'https://example.com/api/backup/restore?lang=en'),
			env,
		);
		expect((await englishResponse.json()).warnings).toEqual(['Entry 3 (Short): A valid secret is missing']);
	});

	it('keeps the summary in message and only per-entry reasons in the warnings of restore and export 400 responses', async () => {
		const env = createMockEnv();
		const short = { ...VALID_SECRET, id: 'short', name: 'Short', secret: 'A=======' };
		const blank = { ...VALID_SECRET, id: 'blank', name: 'Blank', secret: '   ' };
		// One backup with an entry rejected while decoding, one with an entry skipped while it was created.
		const rejected = await createBackupEntry([VALID_SECRET, short], env, { format: 'json', reason: 'scheduled' });
		const skipped = await createBackupEntry([VALID_SECRET, blank], env, { format: 'csv', reason: 'scheduled', strict: false });
		for (const entry of [rejected, skipped]) {
			await env.SECRETS_KV.put(entry.backupKey, entry.backupContent, { metadata: entry.metadata });
		}
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const exportBackup = async (backupKey) =>
			(
				await handleExportBackup(
					createMockRequest({}, 'GET', `https://example.com/api/backup/export/${backupKey}?format=json`),
					env,
					backupKey,
				)
			).json();
		const restoreBackup = async (body) => (await handleRestoreBackup(createMockRequest(body), env)).json();
		const summary = (action) => `该备份在创建或解析时已跳过 1 条无效密钥，无法保证数据完整，已阻止${action}`;

		expect(await exportBackup(rejected.backupKey)).toMatchObject({
			error: '备份不完整',
			message: summary('导出'),
			warnings: ['第 2 条（Short）：缺少有效密钥'],
		});
		expect(await restoreBackup({ backupKey: rejected.backupKey })).toMatchObject({
			error: '备份不完整',
			message: summary('恢复'),
			warnings: ['第 2 条（Short）：缺少有效密钥'],
		});
		expect((await restoreBackup({ backupKey: rejected.backupKey, preview: true })).data.warnings).toEqual([
			summary('恢复或导出'),
			'第 2 条（Short）：缺少有效密钥',
		]);

		// No entry was rejected while decoding: the 400 responses carry no warnings field.
		const skippedExport = await exportBackup(skipped.backupKey);
		const skippedRestore = await restoreBackup({ backupKey: skipped.backupKey });
		expect(skippedExport).toMatchObject({ error: '备份不完整', message: summary('导出') });
		expect(skippedRestore).toMatchObject({ error: '备份不完整', message: summary('恢复') });
		expect(skippedExport).not.toHaveProperty('warnings');
		expect(skippedRestore).not.toHaveProperty('warnings');
		expect((await restoreBackup({ backupKey: skipped.backupKey, preview: true })).data.warnings).toEqual([summary('恢复或导出')]);
		expect((await getAllSecrets(env)).map((secret) => secret.name)).toEqual(['Current']);
	});

	it('lists at most 10 lines per warning list, the last one counting the entries not shown', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
		const backupFileName = 'backup_2026-04-17_00-00-00-000-many.json';
		const backupContent = JSON.stringify({
			secrets: [
				...numbers.map((number) => ({ ...VALID_SECRET, id: `five-${number}`, name: `Five ${number}`, digits: 5 })),
				...numbers.map((number) => ({ ...VALID_SECRET, id: `short-${number}`, name: `Short ${number}`, secret: 'A=======' })),
			],
		});
		const unsupportedLines = numbers.slice(0, 9).map((number) => `第 ${number} 条（Five ${number}）：验证码位数仅支持6位或8位`);
		const skippedLines = numbers.slice(0, 9).map((number) => `第 ${number + 12} 条（Short ${number}）：缺少有效密钥`);

		const preview = await (await handleRestoreBackup(createMockRequest({ backupFileName, backupContent, preview: true }), env)).json();

		expect(preview.data.unsupportedCount).toBe(12);
		expect(preview.data.unsupportedWarnings).toEqual([...unsupportedLines, '另有 3 条']);
		expect(preview.data.warnings).toHaveLength(11);
		expect(preview.data.warnings.slice(1)).toEqual([...skippedLines, '另有 3 条']);

		const restore = await (await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env)).json();
		expect(restore.warnings).toEqual([...skippedLines, '另有 3 条']);

		const english = await (
			await handleRestoreBackup(
				createMockRequest({ backupFileName, backupContent, preview: true }, 'POST', 'https://example.com/api/backup/restore?lang=en'),
				env,
			)
		).json();
		expect(english.data.unsupportedWarnings.at(-1)).toBe('3 more entries');
		expect(english.data.warnings.at(-1)).toBe('3 more entries');

		const japanese = await (
			await handleRestoreBackup(
				createMockRequest({ backupFileName, backupContent, preview: true }, 'POST', 'https://example.com/api/backup/restore?lang=ja'),
				env,
			)
		).json();
		expect(japanese.data.unsupportedWarnings.at(-1)).toBe('ほか 3 件');
	});

	it('previews, restores and exports an instance backup with unsupported entries unchanged', async () => {
		const env = createMockEnv();
		const fiveDigits = { ...VALID_SECRET, id: 'five', name: 'Five digits', secret: 'MFRGGZDFMZTWQ2LK', digits: 5 };
		// The instance backs up whatever is in KV; creating the backup does not check OTP parameters.
		const entry = await createBackupEntry([VALID_SECRET, fiveDigits], env, { format: 'json', reason: 'scheduled' });
		await env.SECRETS_KV.put(entry.backupKey, entry.backupContent, { metadata: entry.metadata });
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const previewResponse = await handleRestoreBackup(createMockRequest({ backupKey: entry.backupKey, preview: true }), env);
		const preview = await previewResponse.json();

		expect(previewResponse.status).toBe(200);
		expect(preview.data.partial).toBe(false);
		expect(preview.data.skippedInvalidCount).toBe(0);
		expect(preview.data.warnings).toEqual([]);
		expect(preview.data.unsupportedCount).toBe(1);
		expect(preview.data.unsupportedWarnings).toEqual(['第 2 条（Five digits）：验证码位数仅支持6位或8位']);
		expect(preview.data.secrets.find((secret) => secret.id === 'five')).toMatchObject({ digits: 5 });

		const listResponse = await handleGetBackups(createMockRequest({}, 'GET', 'https://example.com/api/backup'), env);
		expect((await listResponse.json()).backups.find((backup) => backup.key === entry.backupKey)).toMatchObject({
			count: 2,
			partial: false,
			skippedInvalidCount: 0,
		});

		const exportResponse = await handleExportBackup(
			createMockRequest({}, 'GET', `https://example.com/api/backup/export/${entry.backupKey}?format=json`),
			env,
			entry.backupKey,
		);
		expect(exportResponse.status).toBe(200);
		expect(JSON.parse(await exportResponse.text()).secrets.find((secret) => secret.id === 'five')).toMatchObject({ digits: 5 });

		const restoreResponse = await handleRestoreBackup(createMockRequest({ backupKey: entry.backupKey }), env);
		const restoredSecrets = await getAllSecrets(env);

		expect(restoreResponse.status).toBe(200);
		expect((await restoreResponse.json()).unsupportedCount).toBe(1);
		expect(restoredSecrets.map(({ id, digits }) => ({ id, digits }))).toEqual([
			{ id: 'github', digits: 6 },
			{ id: 'five', digits: 5 },
		]);

		// The same content uploaded as plaintext gets the same entry checks.
		const decrypted = await decryptData(entry.backupContent, env);
		const uploadResponse = await handleRestoreBackup(
			createMockRequest({ backupFileName: entry.backupKey, backupContent: decrypted.content, preview: true }),
			env,
		);
		const upload = await uploadResponse.json();
		expect(upload.data).toMatchObject({
			partial: false,
			warnings: [],
			unsupportedCount: preview.data.unsupportedCount,
			unsupportedWarnings: preview.data.unsupportedWarnings,
		});
	});

	it('restores an encrypted upload and its decrypted copy alike and refuses a foreign encrypted file', async () => {
		const env = createMockEnv();
		const fiveDigits = { ...VALID_SECRET, id: 'five', name: 'Five digits', secret: 'MFRGGZDFMZTWQ2LK', digits: 5 };
		// E.g. a copy downloaded from WebDAV: only this instance's ENCRYPTION_KEY can decrypt it.
		const entry = await createBackupEntry([VALID_SECRET, fiveDigits], env, { format: 'csv', reason: 'scheduled' });
		expect(entry.backupContent.startsWith('v1:')).toBe(true);
		const plaintextContent = (await decryptData(entry.backupContent, env)).content;

		for (const backupContent of [entry.backupContent, plaintextContent]) {
			await saveSecretsToKV(env, [CURRENT_SECRET], 'test');
			const response = await handleRestoreBackup(createMockRequest({ backupFileName: entry.backupKey, backupContent }), env);

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ source: 'upload', count: 2, unsupportedCount: 1 });
			expect((await getAllSecrets(env)).map(({ name, digits }) => ({ name, digits }))).toEqual([
				{ name: 'GitHub', digits: 6 },
				{ name: 'Five digits', digits: 5 },
			]);
		}
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		// An encrypted file this instance cannot decrypt is refused before any entry is read.
		const otherInstance = { ...createMockEnv(), ENCRYPTION_KEY: Buffer.from('abcdefghijklmnopqrstuvwxyz123456').toString('base64') };
		const foreign = await createBackupEntry([VALID_SECRET, fiveDigits], otherInstance, { format: 'csv', reason: 'scheduled' });
		const foreignResponse = await handleRestoreBackup(
			createMockRequest({ backupFileName: foreign.backupKey, backupContent: foreign.backupContent }),
			env,
		);
		expect(foreignResponse.status).toBe(500);
		expect((await foreignResponse.json()).error).toBe('解密失败');
		expect((await getAllSecrets(env)).map((secret) => secret.name)).toEqual(['Current']);
	});

	it('exports a stored backup with unsupported parameters in every format and restores each file again', async () => {
		const env = createMockEnv();
		const unsupported = [
			{ ...VALID_SECRET, id: 'five', name: 'Five digits', digits: 5 },
			{ ...VALID_SECRET, id: 'md5', name: 'MD5', algorithm: 'MD5' },
			{ ...VALID_SECRET, id: 'steam', name: 'Steam', type: 'STEAM' },
			{ ...VALID_SECRET, id: 'period', name: 'Text period', period: 'abc' },
			{ ...VALID_SECRET, id: 'counter', name: 'Negative counter', type: 'HOTP', counter: -1 },
		];
		const entry = await createBackupEntry([VALID_SECRET, ...unsupported], env, { format: 'json', reason: 'scheduled' });
		await env.SECRETS_KV.put(entry.backupKey, entry.backupContent, { metadata: entry.metadata });

		for (const format of ['txt', 'json', 'csv', 'html']) {
			const exportResponse = await handleExportBackup(
				createMockRequest({}, 'GET', `https://example.com/api/backup/export/${entry.backupKey}?format=${format}`),
				env,
				entry.backupKey,
			);
			expect(exportResponse.status, format).toBe(200);

			const backupFileName = `backup_2026-04-17_00-00-00-000-export.${format}`;
			const backupContent = await exportResponse.text();
			const preview = await (await handleRestoreBackup(createMockRequest({ backupFileName, backupContent, preview: true }), env)).json();
			const steam = preview.data.secrets.find((secret) => secret.name === 'Steam');

			// otpauth URIs only have totp and hotp hosts, so a TXT export writes other types as totp.
			expect(steam.type, format).toBe(format === 'txt' ? 'TOTP' : 'STEAM');
			expect(preview.data, format).toMatchObject({ partial: false, count: 6, unsupportedCount: format === 'txt' ? 4 : 5 });
		}
	});

	it('restores a zero period and digit count as the defaults from both JSON and TXT uploads', async () => {
		const restore = async (backupFileName, backupContent) => {
			const env = createMockEnv();
			const response = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
			expect(response.status).toBe(200);
			return (await getAllSecrets(env)).map(({ name, digits, period }) => ({ name, digits, period }));
		};

		const fromJson = await restore(
			'backup_2026-04-17_00-00-00-000-zero.json',
			JSON.stringify({ secrets: [{ ...VALID_SECRET, name: 'Zero', digits: 0, period: 0 }] }),
		);
		const fromTxt = await restore(
			'backup_2026-04-17_00-00-00-000-zero.txt',
			'otpauth://totp/Zero?secret=JBSWY3DPEHPK3PXP&issuer=Zero&digits=0&period=0',
		);

		expect(fromJson).toEqual([{ name: 'Zero', digits: 6, period: 30 }]);
		expect(fromTxt).toEqual(fromJson);
	});

	it('restores long names, non-standard periods and legacy numeric ids unchanged', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const longName = '</script><script id="injected">window.attack = true</script>用户';
		const backupFileName = 'backup_2026-04-17_00-00-00-000-legacy.json';
		const backupContent = JSON.stringify({
			timestamp: '2026-04-17T00:00:00.000Z',
			secrets: [
				{ ...VALID_SECRET, id: 7, name: longName, period: 45 },
				{ ...VALID_SECRET, id: 'hotp-legacy', name: 'Legacy HOTP', type: 'HOTP', period: 0, counter: 5 },
			],
		});

		const response = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
		const restoredSecrets = await getAllSecrets(env);

		expect(response.status).toBe(200);
		expect(restoredSecrets.every(isAcceptedByWebUI)).toBe(true);
		expect(restoredSecrets.map(({ id, name, period }) => ({ id, name, period }))).toEqual([
			{ id: '7', name: longName, period: 45 },
			{ id: 'hotp-legacy', name: 'Legacy HOTP', period: 30 },
		]);
	});

	it('restores legacy numeric ids as strings that hashing, editing and deleting can use', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const backupFileName = 'backup_2026-04-17_00-00-00-000-numeric.json';
		const backupContent = JSON.stringify({
			timestamp: '2026-04-17T00:00:00.000Z',
			secrets: [
				{ ...VALID_SECRET, id: 7, name: 'Seven' },
				{ ...VALID_SECRET, id: 12, name: 'Twelve', secret: 'MFRGGZDFMZTWQ2LK' },
			],
		});

		const restoreResponse = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
		const restoredSecrets = await getAllSecrets(env);

		expect(restoreResponse.status).toBe(200);
		expect(restoredSecrets.map((secret) => secret.id)).toEqual(['7', '12']);
		await expect(generateDataHash(restoredSecrets)).resolves.toMatch(/^[0-9a-f]{64}$/);

		const updateResponse = await handleUpdateSecret(
			new Request('https://example.com/api/secrets/7', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...VALID_SECRET, id: undefined, name: 'Seven renamed' }),
			}),
			env,
		);
		expect(updateResponse.status).toBe(200);

		const deleteResponse = await handleDeleteSecret(new Request('https://example.com/api/secrets/12', { method: 'DELETE' }), env);
		expect(deleteResponse.status).toBe(200);

		const remaining = await getAllSecrets(env);
		expect(remaining.map(({ id, name }) => ({ id, name }))).toEqual([{ id: '7', name: 'Seven renamed' }]);
	});

	it('restores a complete backup into records the web UI accepts', async () => {
		const env = createMockEnv();
		await saveSecretsToKV(env, [CURRENT_SECRET], 'test');

		const backupFileName = 'backup_2026-04-17_00-00-00-000-valid.csv';
		const backupContent = [
			'服务名称,账户信息,密钥,类型,位数,周期(秒),算法,计数器',
			'"GitHub","user@example.com","JBSWY3DPEHPK3PXP","TOTP",8,60,"sha256",0',
			'"Counter","","MFRGGZDFMZTWQ2LK","hotp",,,"",12',
		].join('\n');

		const response = await handleRestoreBackup(createMockRequest({ backupFileName, backupContent }), env);
		const restoredSecrets = await getAllSecrets(env);

		expect(response.status).toBe(200);
		expect(restoredSecrets).toHaveLength(2);
		expect(restoredSecrets.every(isAcceptedByWebUI)).toBe(true);
		expect(restoredSecrets.find((secret) => secret.name === 'GitHub')).toMatchObject({ digits: 8, period: 60, algorithm: 'SHA256' });
		expect(restoredSecrets.find((secret) => secret.name === 'Counter')).toMatchObject({
			type: 'HOTP',
			digits: 6,
			algorithm: 'SHA1',
			counter: 12,
		});
	});
});
