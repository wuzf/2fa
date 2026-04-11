import { describe, expect, it } from 'vitest';

import { getExportCode } from '../../src/ui/scripts/export.js';

describe('export module code generation', () => {
	it('embeds recoverable JSON data in HTML exports', () => {
		const code = getExportCode();

		expect(code).toContain('const embeddedPayload = escapeHTML(JSON.stringify({');
		expect(code).toContain('const MAX_EMBEDDED_QR_SECRETS = 250;');
		expect(code).toContain("const shouldEmbedQRCodes = sortedSecrets.length <= MAX_EMBEDDED_QR_SECRETS;");
		expect(code).toContain("format: 'html'");
		expect(code).toContain("skippedInvalidCount: 0,");
		expect(code).toContain('createdAt: secret.createdAt || exportTimestamp');
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
});
