import { describe, expect, it } from 'vitest';

import { getBackupCode } from '../../src/ui/scripts/backup.js';

describe('backup module code generation', () => {
	it('routes backup exports for every format through the backend export API', () => {
		const code = getBackupCode();

		expect(code).toContain("const exportUrl = '/api/backup/export/' + selectedBackup.key + '?format=' + format;");
		expect(code).not.toContain("if (format === 'html')");
		expect(code).not.toContain('function exportBackupAsHTML()');
	});

	it('keeps the default backup export action aligned with the server-backed format', () => {
		const code = getBackupCode();

		expect(code).toContain('function syncBackupDefaultExportButton()');
		expect(code).toContain('async function exportSelectedBackupUsingDefaultFormat()');
		expect(code).toContain("'html': 'HTML'");
	});

  it('shows the stored backup format in the restore UI', () => {
    const code = getBackupCode();

    expect(code).toContain('function getBackupStoredFormat(backup)');
    expect(code).toContain('const formatLabel = getBackupExportFormatLabel(getBackupStoredFormat(backup));');
		expect(code).toContain("option.title = new Date(backup.created).toLocaleString('zh-CN') + ' | ' + formatLabel;");
		expect(code).toContain('const previewSummary =');
	});

	it('loads restore backup lists page by page instead of requesting all history at once', () => {
		const code = getBackupCode();

		expect(code).toContain('const BACKUP_LIST_PAGE_SIZE = 50;');
		expect(code).toContain("const params = new URLSearchParams({ limit: String(BACKUP_LIST_PAGE_SIZE) });");
		expect(code).toContain('async function loadMoreBackupList()');
		expect(code).not.toContain('/api/backup?limit=all');
	});

	it('disables restore when previewed backup is empty', () => {
		const code = getBackupCode();

		expect(code).toContain('const isEmptyBackup = !isPartialBackup && !hasSecrets && Number(data.count || 0) === 0;');
		expect(code).toContain('const emptyBackupMessage = isEmptyBackup ?');
    expect(code).toContain('confirmRestoreBtn.disabled = isPartialBackup || isEmptyBackup;');
  });

  it('escapes previewed secret fields before injecting restore rows into the DOM', () => {
    const code = getBackupCode();

    expect(code).toContain("'<td class=\"service-name\">' + escapeHTML(secret.name || '') + '</td>'");
    expect(code).toContain("'<td class=\"account-info\">' + escapeHTML(secret.account || secret.service || '无账户信息') + '</td>'");
  });

  it('ignores stale preview responses when the user switches backups quickly', () => {
    const code = getBackupCode();

    expect(code).toContain('let backupPreviewRequestToken = 0;');
		expect(code).toContain('function isActiveBackupPreviewRequest(backup, requestToken)');
		expect(code).toContain('if (!isActiveBackupPreviewRequest(backup, requestToken)) {');
	});
});
