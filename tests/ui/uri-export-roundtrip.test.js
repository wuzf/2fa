import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getCSVParserCode } from '../../src/ui/scripts/import/parsers.js';
import { getImportUtilsCode } from '../../src/ui/scripts/import/utils.js';
import { getFreeOTPDecryptCode } from '../../src/ui/scripts/import/crypto.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

function createHarness() {
	const api = createContext({
		window: {},
		URLSearchParams,
		TextEncoder,
		TextDecoder,
		Uint8Array,
		crypto: globalThis.crypto,
		atob,
		btoa,
		showCenterToast: vi.fn(),
		console,
	});
	runInContext(getUtilsCode() + getImportUtilsCode() + getCSVParserCode() + getFreeOTPDecryptCode() + getExportCode(), api);
	api.downloadFile = vi.fn(async () => true);
	return api;
}

const secret = {
	name: '服务 🔐, "A&B" #100%',
	account: 'account&A#50%@example.test',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'HOTP',
	counter: 42,
	digits: 8,
	algorithm: 'SHA256',
};

describe('URI-based authenticator exports', () => {
	it.each(['exportAsBitwardenAuthenticatorCSV', 'exportAsBitwardenAuthenticatorJSON', 'exportAsProtonAuthenticator'])(
		'%s preserves a nonzero HOTP counter',
		async (method) => {
			const api = createHarness();
			await api[method]([secret]);
			const content = api.downloadFile.mock.calls[0][0];
			const uri = method.endsWith('CSV')
				? api.parseCSVImport(content)[0]
				: method.includes('Bitwarden')
					? JSON.parse(content).items[0].login.totp
					: JSON.parse(content).entries[0].content.uri;
			const url = new URL(uri);
			expect(url.hostname).toBe('hotp');
			expect(url.searchParams.get('counter')).toBe('42');
			expect(url.searchParams.has('period')).toBe(false);
			expect(url.searchParams.get('issuer')).toBe(secret.name);
			expect(url.searchParams.get('digits')).toBe('8');
			expect(url.searchParams.get('algorithm')).toBe('SHA256');
			expect(decodeURIComponent(url.pathname)).toContain(secret.account);
		},
	);

	it('writes six correctly escaped CSV fields and keeps TOTP timing on import', async () => {
		const api = createHarness();
		await api.exportAsBitwardenAuthenticatorCSV([{ ...secret, type: 'TOTP', period: 60 }]);
		const csv = api.downloadFile.mock.calls[0][0];
		const fields = api.parseCSVLine(csv.split('\n')[1]);
		expect(fields).toHaveLength(6);
		expect(fields[3]).toBe(secret.name);
		const url = new URL(api.parseCSVImport(csv)[0]);
		expect(url.searchParams.get('issuer')).toBe(secret.name);
		expect(url.searchParams.get('period')).toBe('60');
		expect(url.searchParams.has('counter')).toBe(false);
		expect(decodeURIComponent(url.pathname)).toContain(secret.account);
	});

	it('retains HOTP counter and algorithm through encrypted FreeOTP export and decryption', async () => {
		const api = createHarness();
		await api.exportAsFreeOTPEncrypted([secret], 'AuditExport#2026');
		const binary = api.downloadFile.mock.calls[0][0];
		const content = api.decodeImportFileContent('backup.xml', binary.buffer);
		const data = api.parseFreeOTPBackup(content);
		const urls = await api.decryptFreeOTPBackup(data, 'AuditExport#2026');
		expect(urls).toHaveLength(1);
		const url = new URL(urls[0]);
		expect(url.hostname).toBe('hotp');
		expect(url.searchParams.get('counter')).toBe('42');
		expect(url.searchParams.get('algorithm')).toBe('SHA256');
		expect(url.searchParams.get('secret')).toBe(secret.secret);
		expect(url.searchParams.get('issuer')).toBe(secret.name);
	});

	it.each([
		['exportAsLastPass', secret],
		['exportAsTOTPAuthenticatorEncrypted', secret],
		['exportAsTOTPAuthenticatorEncrypted', { ...secret, type: 'TOTP' }],
	])('%s rejects unrepresentable OTP parameters before writing a file', async (method, account) => {
		const api = createHarness();
		const result = await api[method]([account], 'AuditExport#2026');
		expect(result).toBe(false);
		expect(api.downloadFile).not.toHaveBeenCalled();
		expect(api.showCenterToast).toHaveBeenCalledWith('❌', expect.stringContaining('改用 JSON'));
	});
});
