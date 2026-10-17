// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { handleBatchAddSecrets, handleGetSecrets } from '../../src/api/secrets/index.js';
import { handleExportSecrets } from '../../src/api/secrets/export.js';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { transferI18n } from '../helpers/transfer-i18n.js';
import { FakeKV, TEST_ENCRYPTION_KEY } from '../helpers/store-fakes.js';

const SECRET = 'JBSWY3DPEHPK3PXP';
const ACCOUNTS = [
	{ name: 'GitHub', account: '', secret: SECRET, type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1', counter: -1 },
	{ name: 'ACME:Work', account: 'alice', secret: SECRET, type: 'TOTP', digits: 8, period: 60, algorithm: 'SHA256' },
	{
		name: '团队:%2F / 100% & <服务>',
		account: '用户:%3A:a+b@例子.test',
		secret: SECRET,
		type: 'TOTP',
		digits: 8,
		period: 120,
		algorithm: 'SHA512',
	},
	{ name: 'HOTP:空账户', account: '', secret: SECRET, type: 'HOTP', digits: 8, period: 45, algorithm: 'SHA256', counter: 4294967297 },
	{ name: 'HOTP:%3A', account: '成员:工作%25', secret: SECRET, type: 'HOTP', digits: 6, period: 30, algorithm: 'SHA512', counter: 0 },
];

// Legacy/restored records may carry arbitrary values in the parameter their type
// does not use. Import still sends the API defaults for those unrelated fields.
const IMPORTED_ACCOUNTS = ACCOUNTS.map((account) => ({
	...account,
	period: account.type === 'TOTP' ? account.period : 30,
	counter: account.type === 'HOTP' ? account.counter : 0,
}));
const STORED_ACCOUNTS = IMPORTED_ACCOUNTS.map(({ counter, ...account }) => (account.type === 'HOTP' ? { ...account, counter } : account));

function harness() {
	document.body.innerHTML =
		'<div id="importModal"><textarea id="importText"></textarea>' +
		'<div id="importPreview"><div id="importPreviewList"></div></div><button id="executeImportBtn"></button></div>';
	const env = {
		LOG_LEVEL: 'ERROR',
		ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
		SECRETS_KV: new FakeKV(),
	};
	const authenticatedFetch = vi.fn((path, options) => {
		expect(path).toBe('/api/secrets/batch');
		return handleBatchAddSecrets(new Request('https://fixture.invalid' + path, options), env);
	});
	const api = createContext({
		...transferI18n('en'),
		document,
		window: {},
		URL,
		URLSearchParams,
		console: { log() {}, warn() {}, error() {} },
		showCenterToast: vi.fn(),
		authenticatedFetch,
		loadSecrets: vi.fn(),
	});
	runInContext(getUtilsCode() + getImportCode() + getExportCode(), api);
	api.downloadFile = vi.fn(async () => true);
	api.showExportSuccess = vi.fn();
	return {
		api,
		env,
		authenticatedFetch,
		preview(content) {
			document.getElementById('importText').value = content;
			api.previewImport();
			return runInContext('importPreviewData', api);
		},
		readSecrets: async () => (await handleGetSecrets(env, new Request('https://fixture.invalid/api/secrets'))).json(),
	};
}

describe('app JSON export and batch import round trip', () => {
	it.each(['server', 'local'])('preserves labels and OTP parameters from the %s JSON export through API storage', async (source) => {
		const h = harness();
		let content;
		if (source === 'server') {
			const response = await handleExportSecrets(
				new Request('https://fixture.invalid/api/secrets/export', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ format: 'json', secrets: ACCOUNTS }),
				}),
				h.env,
			);
			expect(response.status).toBe(200);
			content = await response.text();
			expect(JSON.parse(content).secrets[0].counter).toBe(-1);
			expect(JSON.parse(content).secrets[3].period).toBe(45);
		} else {
			await h.api.exportAsJSON(ACCOUNTS);
			content = h.api.downloadFile.mock.calls[0][0];
		}
		const preview = h.preview(content);
		expect(preview).toHaveLength(ACCOUNTS.length);
		IMPORTED_ACCOUNTS.forEach(({ name, ...fields }, index) => {
			expect(preview[index]).toMatchObject({ ...fields, serviceName: name, type: fields.type.toLowerCase(), valid: true });
		});
		await h.api.executeImport();
		expect(h.authenticatedFetch).toHaveBeenCalledOnce();
		expect(JSON.parse(h.authenticatedFetch.mock.calls[0][1].body).secrets).toEqual(
			IMPORTED_ACCOUNTS.map((account) => ({ ...account, type: account.type.toLowerCase() })),
		);
		expect(await h.readSecrets()).toEqual(STORED_ACCOUNTS.map((account) => expect.objectContaining(account)));
	});

	it('keeps an explicit empty account instead of falling back to a legacy label', async () => {
		const h = harness();
		const preview = h.preview(JSON.stringify({ secrets: [{ ...ACCOUNTS[0], label: 'old label' }] }));
		expect(preview[0]).toMatchObject({ serviceName: 'GitHub', account: '', valid: true });
		await h.api.executeImport();
		expect(await h.readSecrets()).toEqual([expect.objectContaining(STORED_ACCOUNTS[0])]);
	});

	it('keeps native OTPAuth label interpretation and third-party JSON parsing', () => {
		const h = harness();
		const preview = h.preview(
			[
				'otpauth://totp/alice%40example.test?issuer=GitHub&secret=' + SECRET,
				'otpauth://hotp/ACME%3Aalice%3Awork?secret=' + SECRET + '&counter=42',
			].join('\n'),
		);
		expect(preview).toEqual([
			expect.objectContaining({ serviceName: 'GitHub', account: 'alice@example.test', type: 'totp', valid: true }),
			expect.objectContaining({ serviceName: 'ACME', account: 'alice:work', type: 'hotp', counter: 42, valid: true }),
		]);
		const aegis = {
			db: { entries: [{ issuer: 'Aegis service', name: 'alice:work', type: 'hotp', info: { secret: SECRET, counter: 42 } }] },
		};
		expect(typeof h.api.parseJsonImport(aegis)[0]).toBe('string');
		expect(h.preview(JSON.stringify(aegis))).toEqual([
			expect.objectContaining({ serviceName: 'Aegis service', account: 'alice:work', type: 'hotp', counter: 42, valid: true }),
		]);
	});
});
