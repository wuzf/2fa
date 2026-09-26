import { transferI18n } from '../helpers/transfer-i18n.js';
import { describe, expect, it, vi } from 'vitest';

import { getExportCode } from '../../src/ui/scripts/export.js';
import { getStandardFormatsCode } from '../../src/ui/scripts/export/formats.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { decodeBackupContent } from '../../src/utils/backup-format.js';
import { validateBase32 } from '../../src/utils/validation.js';

// The page's real escapeHTML, evaluated from the emitted utilities script.
function emittedEscapeHTML() {
	const target = { addEventListener() {}, removeEventListener() {} };
	const document = { ...target, getElementById: () => null, querySelector: () => null };
	// eslint-disable-next-line no-new-func
	return new Function('window', 'document', 'localStorage', `${getUtilsCode()}; return escapeHTML;`)(target, document, {
		getItem: () => null,
	});
}

function createHtmlExport(getCode, escapeHTML = null) {
	const downloadFile = vi.fn(async () => true);
	const generateQRCodeDataURL = vi.fn(async () => 'data:image/png;base64,fixture');
	const dependencies = {
		...transferI18n(),
		downloadFile,
		generateQRCodeDataURL,
		getDateString: () => '2026-09-15',
		showCenterToast: vi.fn(),
		showExportSuccess: vi.fn(),
		waitForQRCodeLibrary: async () => {},
		validateBase32: (value) => validateBase32(value).valid,
		escapeHTML:
			escapeHTML ||
			((value) =>
				String(value).replace(
					/[&<>"']/g,
					(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
				)),
	};
	// eslint-disable-next-line no-new-func
	const exportAsHTML = new Function(...Object.keys(dependencies), `${getCode()}; return exportAsHTML;`)(...Object.values(dependencies));
	return { exportAsHTML, downloadFile, generateQRCodeDataURL };
}

describe('export module code generation', () => {
	it('routes standard txt/json/csv/html exports through the backend export API', () => {
		const code = getExportCode();

		expect(code).toContain('await exportStandardFormatViaApi(secretsData, format, opts);');
		expect(code).toContain("authenticatedFetch('/api/secrets/export'");
		expect(code).not.toContain("profile: 'bulk-export-legacy'");
		expect(code).toContain('response.status === 202');
		expect(code).toContain('async function exportStandardFormatLocally(');
		expect(code).toContain('response.status === 413');
		expect(code).toContain('errorData && errorData.offline === true');
		expect(code).toContain('await exportStandardFormatLocally(sortedSecrets, format, options);');
		expect(code).toContain("t('transferMissingDownload')");
		expect(code).toContain('const blob = await response.blob();');
	});

	it('embeds recoverable JSON data in HTML exports', () => {
		const code = getExportCode();

		expect(code).toContain('const embeddedPayload = escapeHTML(JSON.stringify({');
		expect(code).toContain('const MAX_EMBEDDED_QR_SECRETS = 250;');
		expect(code).toContain('const shouldEmbedQRCodes = sortedSecrets.length <= MAX_EMBEDDED_QR_SECRETS;');
		expect(code).toContain("format: 'html'");
		expect(code).toContain('skippedInvalidCount: 0,');
		expect(code).toContain('const invalidSecrets = [];');
		expect(code).toContain('if (!normalizedSecret || !validateBase32(normalizedSecret)) {');
		expect(code).toContain("t('transferInvalidExport')");
		expect(code).toContain("t('transferQRLimit')");
		expect(code).toContain('data-skipped-invalid-count="0"');
		expect(code).toContain('<script id="__2fa_backup_data__" type="application/json">');
	});

	it('escapes quotes in the page escapeHTML so its result is safe inside quoted attributes', () => {
		const escapeHTML = emittedEscapeHTML();
		expect(escapeHTML(`a"b'c<d>&e`)).toBe('a&quot;b&#39;c&lt;d&gt;&amp;e');
		// Non-breaking spaces stay literal so embedded backup JSON decodes exactly.
		const nbsp = String.fromCharCode(0xa0);
		expect(escapeHTML('a' + nbsp + 'b')).toBe('a' + nbsp + 'b');
		expect(escapeHTML(42)).toBe(42);
	});

	it.each([
		['current offline export', getExportCode],
		['legacy standard export', getStandardFormatsCode],
	])('%s keeps quoted service names inside their attributes with the real escapeHTML', async (_name, getCode) => {
		const secret = {
			name: 'Svc" onerror="alert(1)\' x',
			account: 'a"b',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
		};
		const { exportAsHTML, downloadFile } = createHtmlExport(getCode, emittedEscapeHTML());
		await exportAsHTML([secret]);
		const [html] = downloadFile.mock.calls[0];
		expect(html).not.toContain('onerror="');
		if (getCode === getExportCode) {
			const alt = html.match(/<img src="data:image\/png;base64,fixture" alt="([^"]*)">/);
			expect(alt).not.toBeNull();
			expect(alt[1]).toBe('Svc&quot; onerror=&quot;alert(1)&#39; x 二维码');
		}
		expect(decodeBackupContent(html, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		const tableOnly = html.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');
		expect(decodeBackupContent(tableOnly, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
	});

	it('keeps only one HTML export implementation in the generated module', () => {
		const code = getExportCode();
		const matches = code.match(/async function exportAsHTML\(/g) || [];

		expect(matches).toHaveLength(1);
	});

	it.each([
		['current offline export', getExportCode],
		['legacy standard export', getStandardFormatsCode],
	])('%s remains restorable from both JSON and table data', async (_name, getCode) => {
		const secret = {
			name: '账户 <script> & "test"',
			account: 'a&<b>"@example.test',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'HOTP',
			digits: 8,
			period: 60,
			algorithm: 'SHA256',
			counter: 42,
		};
		const { exportAsHTML, downloadFile, generateQRCodeDataURL } = createHtmlExport(getCode);
		await exportAsHTML([secret]);

		expect(downloadFile).toHaveBeenCalledOnce();
		const [html, filename, contentType] = downloadFile.mock.calls[0];
		expect(filename).toBe('2FA-secrets-backup-2026-09-15.html');
		expect(contentType).toBe('text/html;charset=utf-8');
		expect(html.match(/<th>/g)).toHaveLength(9);
		expect(html.match(/<script(?:\s|>)/g)).toHaveLength(2);
		expect(getCode()).not.toMatch(/<\/script/i);
		expect(decodeBackupContent(html, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		const tableOnly = html.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');
		expect(decodeBackupContent(tableOnly, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		if (getCode === getExportCode) {
			expect(generateQRCodeDataURL).toHaveBeenCalledOnce();
			const otpUrl = new URL(generateQRCodeDataURL.mock.calls[0][0]);
			expect(otpUrl.hostname).toBe('hotp');
			expect(otpUrl.searchParams.get('counter')).toBe('42');
			expect(otpUrl.searchParams.get('algorithm')).toBe('SHA256');
		}
	});
});
