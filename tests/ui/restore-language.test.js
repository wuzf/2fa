// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getBackupCode } from '../../src/ui/scripts/backup.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const html = await (await createMainPage()).text();
const restoreMarkup = html.slice(html.indexOf('<div id="restoreModal"'), html.indexOf('<!-- 实用工具模态框 -->'));
const backup = { key: 'backup_2026-09-24.json', created: '2026-09-24T00:00:00Z', count: 1, format: 'json' };
const preview = {
	count: 1,
	format: 'json',
	encrypted: true,
	secrets: [{ name: '<img src=x onerror=alert(1)>', account: '<script>account</script>', type: 'HOTP' }],
};

function response(data, ok = true) {
	return { ok, json: async () => data };
}

function createHarness(language = 'en', previewData = preview) {
	document.body.innerHTML = restoreMarkup;
	localStorage.setItem('language', language);
	const authenticatedFetch = vi.fn(async (url, options) => {
		if (url.startsWith('/api/backup?')) {
			return response({ backups: [backup], pagination: { hasMore: false } });
		}
		return response(JSON.parse(options.body).preview ? { data: previewData } : { count: previewData.count });
	});
	const showCenterToast = vi.fn();
	const context = createContext({
		document,
		window,
		HTMLElement: window.HTMLElement,
		localStorage,
		navigator: { language: 'zh-CN' },
		URLSearchParams,
		setTimeout,
		clearTimeout,
		console: { error: vi.fn() },
		location: { reload: vi.fn() },
		authenticatedFetch,
		showCenterToast,
	});
	runInContext(getI18nCode() + getUtilsCode() + getBackupCode(), context);
	context.applyTranslations();
	return { context, authenticatedFetch, showCenterToast };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
	document.body.removeAttribute('style');
	localStorage.clear();
});

describe('restore translations and confirmation safety', () => {
	it.each([
		['en', 'Restore Backup', 'overwrite all current keys', 'cannot be undone', 'Cancel', 'Restore', 'Backup Format'],
		['zh-TW', '還原設定', '覆蓋目前所有金鑰', '無法復原', '取消', '還原', '備份格式'],
	])(
		'translates the %s restore flow and sends no restore request after cancelling',
		async (language, title, overwrite, irreversible, cancel, action, format) => {
			const { context, authenticatedFetch } = createHarness(language);
			expect(document.getElementById('restoreModalTitle').textContent).toBe(title);
			expect(document.querySelector('.restore-instructions').textContent).toContain(overwrite);
			expect(document.querySelector('.restore-instructions').textContent).toContain(irreversible);
			expect(document.querySelector('#restoreModal .modal-actions .btn-outline').textContent).toBe(cancel);
			expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);

			await context.loadBackupList();
			expect(document.getElementById('backupSelect').options[0].textContent).toBe(context.t('restoreSelectPlaceholder'));
			expect(document.getElementById('backupListStatus').textContent).toBe(context.t('restoreLoadedAll', { count: 1 }));
			await context.selectBackup(backup, 0);
			expect(document.querySelector('#backupPreviewContent dt').textContent).toBe(format);
			expect(document.querySelector('.service-name').textContent).toBe(preview.secrets[0].name);
			expect(document.querySelector('.account-info').textContent).toBe(preview.secrets[0].account);
			expect(document.querySelector('#backupPreviewContent img, #backupPreviewContent script')).toBeNull();
			expect(document.getElementById('confirmRestoreBtn').disabled).toBe(false);
			authenticatedFetch.mockClear();

			const pending = context.confirmRestore();
			const message = document.getElementById('confirmDialogMessage');
			expect(message.textContent).toContain(overwrite);
			expect(message.textContent).toContain(irreversible);
			expect(message.textContent).toContain('2026-09-24');
			expect(document.getElementById('confirmDialogCancel').textContent).toBe(cancel);
			expect(document.getElementById('confirmDialogConfirm').textContent).toBe(action);
			const warningBeforeRefresh = message.textContent;
			context.setLanguage(language);
			expect(message.textContent).toBe(warningBeforeRefresh);
			document.getElementById('confirmDialogCancel').click();
			await vi.advanceTimersByTimeAsync(200);
			await pending;
			expect(authenticatedFetch).not.toHaveBeenCalled();
		},
	);

	it.each([false, true])('keeps the confirmed restore request unchanged (uploaded: %s) and preserves the busy label', async (uploaded) => {
		const { context, authenticatedFetch, showCenterToast } = createHarness();
		if (uploaded) {
			await context.handleRestoreBackupFile({ target: { files: [{ name: backup.key, size: 2, text: async () => '[]' }] } });
			expect(document.getElementById('restoreUploadStatus').textContent).toContain('Selected uploaded file: ' + backup.key);
			expect(document.getElementById('backupPreviewContent').textContent).toContain('Uploaded File');
		} else {
			await context.selectBackup(backup, 0);
		}
		authenticatedFetch.mockClear();
		let completeRestore;
		authenticatedFetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					completeRestore = resolve;
				}),
		);
		const pending = context.confirmRestore();
		document.getElementById('confirmDialogConfirm').click();
		await vi.advanceTimersByTimeAsync(200);
		expect(authenticatedFetch).toHaveBeenCalledTimes(1);
		const [url, options] = authenticatedFetch.mock.calls[0];
		expect(url).toBe('/api/backup/restore');
		expect(options.method).toBe('POST');
		expect(JSON.parse(options.body)).toEqual(uploaded ? { backupFileName: backup.key, backupContent: '[]' } : { backupKey: backup.key });
		expect(document.getElementById('confirmRestoreBtn').textContent).toBe('Restoring...');
		context.setLanguage('zh-TW');
		expect(document.getElementById('confirmRestoreBtn').textContent).toBe('還原中...');
		expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);
		completeRestore(response({ count: 1 }));
		await pending;
		expect(showCenterToast).toHaveBeenCalledWith('✅', '還原成功！已還原 1 個金鑰');
		expect(document.getElementById('confirmRestoreBtn').textContent).toBe('確認還原');
	});

	it.each([
		[
			{ ...preview, partial: true, skippedInvalidCount: 2, warnings: ['后端详情 <img src=x>'] },
			'This backup is incomplete',
			'2 invalid key(s) were skipped',
		],
		[{ count: 0, secrets: [] }, 'no recoverable keys', 'Restoring over current data is disabled'],
	])('explains disabled restore in English for partial and empty backups', async (data, warning, reason) => {
		const { context } = createHarness('en', data);
		await context.selectBackup(backup, 0);
		const content = document.getElementById('backupPreviewContent');
		expect(content.textContent).toContain(warning);
		expect(content.textContent).toContain(reason);
		expect(content.querySelector('img')).toBeNull();
		expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);
		expect(document.getElementById('confirmRestoreBtn').title).toContain(warning);
	});

	it('translates upload validation and preview errors while preserving escaped server details', async () => {
		const { context, authenticatedFetch } = createHarness();
		await context.handleRestoreBackupFile({ target: { files: [{ name: 'invalid.json', size: 2 }] } });
		expect(document.getElementById('restoreUploadStatus').textContent).toContain('Invalid backup filename');
		expect(authenticatedFetch).not.toHaveBeenCalled();
		authenticatedFetch.mockResolvedValueOnce(response({ message: '<img src=x> detail' }, false));
		await context.selectBackup(backup, 0);
		expect(document.getElementById('backupPreviewContent').textContent).toBe('Failed to load backup preview: <img src=x> detail');
		expect(document.querySelector('#backupPreviewContent img')).toBeNull();
		expect(document.getElementById('confirmRestoreBtn').title).toContain('Cannot restore or export');
	});

	it('reports restore failure in the selected language without claiming success', async () => {
		const { context, authenticatedFetch, showCenterToast } = createHarness();
		await context.selectBackup(backup, 0);
		authenticatedFetch.mockResolvedValueOnce(response({ message: 'Server detail' }, false));
		const pending = context.confirmRestore();
		document.getElementById('confirmDialogConfirm').click();
		await vi.advanceTimersByTimeAsync(200);
		await pending;
		expect(showCenterToast).toHaveBeenCalledExactlyOnceWith('❌', 'Restore failed: Server detail');
		expect(document.getElementById('confirmRestoreBtn').textContent).toBe('Confirm Restore');
	});
});
