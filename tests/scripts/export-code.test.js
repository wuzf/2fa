import { describe, expect, it, vi } from 'vitest';

import { getExportCode } from '../../src/ui/scripts/export.js';
import { getStandardFormatsCode } from '../../src/ui/scripts/export/formats.js';
import { decodeBackupContent } from '../../src/utils/backup-format.js';
import { validateBase32 } from '../../src/utils/validation.js';

function createHtmlExport(getCode) {
	const downloadFile = vi.fn(async () => true);
	const generateQRCodeDataURL = vi.fn(async () => 'data:image/png;base64,fixture');
	const dependencies = {
		downloadFile,
		generateQRCodeDataURL,
		getDateString: () => '2026-09-15',
		showCenterToast: vi.fn(),
		showExportSuccess: vi.fn(),
		waitForQRCodeLibrary: async () => {},
		validateBase32: (value) => validateBase32(value).valid,
		escapeHTML: (value) =>
			String(value).replace(
				/[&<>"']/g,
				(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
			),
	};
	// eslint-disable-next-line no-new-func
	const exportAsHTML = new Function(...Object.keys(dependencies), `${getCode()}; return exportAsHTML;`)(...Object.values(dependencies));
	return { exportAsHTML, downloadFile, generateQRCodeDataURL };
}

describe('export module code generation', () => {
	it('routes standard txt/json/csv/html exports through the backend export API', () => {
		const code = getExportCode();

		expect(code).toContain("await exportStandardFormatViaApi(secretsData, format, opts);");
		expect(code).toContain("authenticatedFetch('/api/secrets/export'");
		expect(code).not.toContain("profile: 'bulk-export-legacy'");
		expect(code).toContain('response.status === 202');
		expect(code).toContain('async function exportStandardFormatLocally(');
		expect(code).toContain('response.status === 413');
		expect(code).toContain('errorData && errorData.offline === true');
		expect(code).toContain('await exportStandardFormatLocally(sortedSecrets, format, options);');
		expect(code).toContain("server did not return a downloadable file");
		expect(code).toContain('const blob = await response.blob();');
	});

	it('embeds recoverable JSON data in HTML exports', () => {
		const code = getExportCode();

		expect(code).toContain('const embeddedPayload = escapeHTML(JSON.stringify({');
		expect(code).toContain('const MAX_EMBEDDED_QR_SECRETS = 250;');
		expect(code).toContain("const shouldEmbedQRCodes = sortedSecrets.length <= MAX_EMBEDDED_QR_SECRETS;");
		expect(code).toContain("format: 'html'");
		expect(code).toContain("skippedInvalidCount: 0,");
		expect(code).toContain('const invalidSecrets = [];');
		expect(code).toContain('if (!normalizedSecret || !validateBase32(normalizedSecret)) {');
		expect(code).toContain('当前存在无效密钥，已阻止导出 HTML 备份：');
		expect(code).toContain('密钥数量较多，HTML 将保留表格与可恢复数据，不嵌入二维码');
		expect(code).toContain('data-skipped-invalid-count="0"');
		expect(code).toContain('<script id="__2fa_backup_data__" type="application/json">');
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
