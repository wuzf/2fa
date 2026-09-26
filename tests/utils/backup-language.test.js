import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { encodeBackupContent, decodeBackupContent } from '../../src/utils/backup-format.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { BACKUP_DOCUMENT_LOCALES } from '../../src/utils/backup-locales.js';
import { handleExportSecrets } from '../../src/api/secrets/export.js';
import { handleExportBackup } from '../../src/api/secrets/restore.js';

const secret = {
	id: 'language-test',
	name: 'Original 中文 <script> & "name"',
	account: '原始账号@example.com',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'HOTP',
	counter: 42,
	digits: 8,
	period: 60,
	algorithm: 'SHA256',
};
const timestamp = '2026-09-24T05:00:00.000Z';

function envWithBackup() {
	const key = 'backup_2026-09-24_test.json';
	const values = new Map([[key, JSON.stringify({ timestamp, secrets: [secret] })]]);
	return {
		LOG_LEVEL: 'ERROR',
		SECRETS_KV: {
			get: async (name, type) => {
				const value = values.get(name);
				return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
			},
			put: async (name, value) => values.set(name, value),
			list: async () => ({ keys: [{ name: key }] }),
		},
	};
}

describe.each(SUPPORTED_LANGUAGES)('portable backup documents in %s', (language) => {
	it('round-trips localized CSV headers and every HOTP parameter', async () => {
		const { content } = await encodeBackupContent([secret], { format: 'csv', language, timestamp });
		expect(content).toContain(BACKUP_DOCUMENT_LOCALES[language].headers.join(','));
		const { id: _id, ...fields } = secret;
		expect(decodeBackupContent(content, 'csv', { strict: true }).secrets[0]).toMatchObject(fields);
	});

	it('localizes HTML metadata and QR labels without altering secret values', async () => {
		const { content } = await encodeBackupContent([secret], { format: 'html', language, timestamp });
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		window.document.write(content);
		const doc = window.document;
		expect(doc.documentElement.lang).toBe(language);
		expect(doc.title).toBe(BACKUP_DOCUMENT_LOCALES[language].title);
		expect([...doc.querySelectorAll('th')].map((element) => element.textContent)).toEqual([
			...BACKUP_DOCUMENT_LOCALES[language].headers,
			BACKUP_DOCUMENT_LOCALES[language].qr,
		]);
		expect(doc.querySelector('img').alt).toBe(BACKUP_DOCUMENT_LOCALES[language].qrAlt.replace('{name}', secret.name));
		expect(doc.querySelector('time').dateTime).toBe(timestamp);
		expect(doc.querySelector('tbody td').textContent).toBe(secret.name);
		expect(doc.querySelector('tbody script')).toBeNull();
		expect(decodeBackupContent(content, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		const withoutData = content.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');
		const { id: _id, ...fields } = secret;
		expect(decodeBackupContent(withoutData, 'html', { strict: true }).secrets[0]).toMatchObject(fields);
	});

	it('passes language from export body and backup query to generated downloads', async () => {
		const exportRequest = new Request('https://2fa.example/api/secrets/export', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ format: 'csv', language, secrets: [secret] }),
		});
		const exported = await handleExportSecrets(exportRequest, envWithBackup());
		expect(exported.status).toBe(200);
		expect(exported.headers.get('Content-Language')).toBe(language);
		expect(await exported.text()).toContain(BACKUP_DOCUMENT_LOCALES[language].headers.join(','));
		const backupRequest = new Request(`https://2fa.example/api/backup/export?format=html&language=${language}`);
		const backup = await handleExportBackup(backupRequest, envWithBackup(), 'backup_2026-09-24_test.json');
		expect(backup.status).toBe(200);
		expect(backup.headers.get('Content-Language')).toBe(language);
		expect(await backup.text()).toContain(`<html lang="${language}">`);
	});
});

it('lets downloaded HTML switch language offline, preserving data and respecting the initial export language', async () => {
	const { content } = await encodeBackupContent([secret], { format: 'html', language: 'zh-TW', timestamp });
	const window = new Window({ url: 'file:///backup.html', settings: { disableJavaScriptEvaluation: true } });
	window.document.write(content);
	const document = window.document;
	const script = [...document.scripts].at(-1).textContent;
	const context = createContext({
		window,
		document,
		URL,
		CustomEvent: window.CustomEvent,
		location: window.location,
		navigator: { language: 'en', languages: ['en'] },
		localStorage: {
			getItem: () => 'zh-CN',
			setItem: () => {
				throw new Error('Storage unavailable');
			},
		},
	});
	runInContext(script, context);
	const selector = document.getElementById('standaloneLanguage');
	expect(document.documentElement.lang).toBe('zh-TW');
	selector.value = 'en';
	selector.dispatchEvent(new window.Event('change'));
	expect(document.title).toBe('2FA Key Backup');
	expect(document.querySelector('th').textContent).toBe('Service');
	expect(document.querySelector('img').alt).toBe(`QR code for ${secret.name}`);
	expect(document.querySelector('[role=region]').getAttribute('aria-label')).toBe('Backed-up keys');
	expect(document.querySelector('tbody td').textContent).toBe(secret.name);
	expect(document.querySelector('time').textContent).toBe(
		new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }),
	);
});

it('uses X-Language for export requests without a body language', async () => {
	const request = new Request('https://2fa.example/api/secrets/export', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Language': 'en-US' },
		body: JSON.stringify({ format: 'csv', secrets: [secret] }),
	});
	const response = await handleExportSecrets(request, envWithBackup());
	expect(response.status).toBe(200);
	expect(response.headers.get('Content-Language')).toBe('en');
	expect(await response.text()).toContain('Service,Account,Secret,Type,Digits,Period (seconds),Algorithm,Counter');
});

it.each(['ar-SA', '', null])(
	'uses English for an explicit unsupported export body language %j ahead of request preferences',
	async (language) => {
		const request = new Request('https://2fa.example/api/secrets/export?lang=zh-CN', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Language': 'ja' },
			body: JSON.stringify({ format: 'csv', language, secrets: [secret] }),
		});
		const response = await handleExportSecrets(request, envWithBackup());
		expect(response.headers.get('Content-Language')).toBe('en');
		const content = await response.text();
		expect(content).toContain('Service,Account,Secret,Type,Digits,Period (seconds),Algorithm,Counter');
		expect(decodeBackupContent(content, 'csv', { strict: true }).secrets[0]).toMatchObject({
			name: secret.name,
			secret: secret.secret,
			counter: 42,
		});
	},
);
