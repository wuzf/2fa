// @vitest-environment happy-dom

import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';

import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleExportBackup, handleRestoreBackup } from '../../src/api/secrets/restore.js';
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

// Responses produced by the server handlers, so the UI is tested against the
// structures the server really sends.
function createServerEnv() {
	const store = new Map();
	return {
		LOG_LEVEL: 'ERROR',
		SECRETS_KV: {
			get: async (key, type) => (store.has(key) ? (type === 'json' ? JSON.parse(store.get(key)) : store.get(key)) : null),
			put: async (key, value) => store.set(key, value),
			delete: async (key) => store.delete(key),
			list: async ({ prefix = '' } = {}) => ({
				keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name, metadata: null })),
				list_complete: true,
			}),
		},
	};
}

const serverRequest = (url, body) => ({
	method: body ? 'POST' : 'GET',
	url,
	headers: new Headers({ 'Content-Type': 'application/json', 'X-Language': 'en', 'CF-Connecting-IP': '203.0.113.1' }),
	json: async () => body,
});

async function readServerResponse(pending) {
	const result = await pending;
	return { ok: result.ok, status: result.status, body: await result.json() };
}

async function createIncompleteBackupResponses() {
	const env = createServerEnv();
	const backupContent = JSON.stringify({
		timestamp: '2026-09-24T00:00:00.000Z',
		secrets: [
			{ id: 'github', name: 'GitHub', account: 'user@example.com', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP', digits: 6, period: 30 },
			// Too short for the web app to generate codes: rejected whatever the source.
			{ id: 'example', name: '<b>Example</b>', secret: 'A=======' },
			{ id: 'other', name: 'Other', secret: 'B=======' },
		],
	});
	await env.SECRETS_KV.put(backup.key, backupContent);
	const request = serverRequest;
	const restoreUrl = 'https://example.com/api/backup/restore';
	const read = readServerResponse;
	return {
		preview: await read(handleRestoreBackup(request(restoreUrl, { backupFileName: backup.key, backupContent, preview: true }), env)),
		restore: await read(handleRestoreBackup(request(restoreUrl, { backupFileName: backup.key, backupContent }), env)),
		export: await read(handleExportBackup(request('https://example.com/api/backup/export/' + backup.key + '?format=txt'), env, backup.key)),
	};
}

const serverResponses = await createIncompleteBackupResponses();

// A stored backup whose entries all restore, 12 of them with OTP parameters the
// web app does not support: the server keeps them and lists at most 10 lines.
async function createUnsupportedBackupResponses() {
	const env = createServerEnv();
	const unsupported = Array.from({ length: 12 }, (_, index) => ({
		id: 'five-' + index,
		name: index === 0 ? '<b>Five digits</b>' : 'Five digits ' + index,
		secret: 'MFRGGZDFMZTWQ2LK',
		type: 'TOTP',
		digits: 5,
		period: 30,
	}));
	await env.SECRETS_KV.put(
		backup.key,
		JSON.stringify({
			timestamp: '2026-09-24T00:00:00.000Z',
			secrets: [{ id: 'github', name: 'GitHub', account: 'user@example.com', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }, ...unsupported],
		}),
	);
	const restoreUrl = 'https://example.com/api/backup/restore';
	return {
		preview: await readServerResponse(handleRestoreBackup(serverRequest(restoreUrl, { backupKey: backup.key, preview: true }), env)),
		restore: await readServerResponse(handleRestoreBackup(serverRequest(restoreUrl, { backupKey: backup.key }), env)),
	};
}

const unsupportedResponses = await createUnsupportedBackupResponses();
const refused = ({ ok, status, body }) => ({ ok, status, json: async () => body });

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
	runInContext(getI18nCode() + getSharedTransferMessageLocalizerCode() + getUtilsCode() + getBackupCode(), context);
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

	it.each([
		[
			'the explanation of an incomplete backup',
			{
				ok: false,
				status: 400,
				json: async () => ({ error: 'Incomplete backup', message: '2 of 5 entries are invalid; nothing was exported' }),
			},
			'2 of 5 entries are invalid; nothing was exported',
		],
		[
			'the title when there is no explanation',
			{ ok: false, status: 404, json: async () => ({ error: 'Backup not found' }) },
			'Backup not found',
		],
		[
			'the status for a body that is not JSON',
			{
				ok: false,
				status: 502,
				json: async () => {
					throw new SyntaxError('Unexpected token <');
				},
			},
			'Server returned 502',
		],
	])('shows %s when a backup export fails', async (_label, failure, detail) => {
		const { context, authenticatedFetch, showCenterToast } = createHarness('en');
		await context.loadBackupList();
		await context.selectBackup(backup, 0);
		authenticatedFetch.mockResolvedValueOnce(failure);
		await context.executeBackupExport('txt');
		expect(showCenterToast).toHaveBeenLastCalledWith('❌', context.t('transferExportFailedPrefixASCII') + detail);
	});

	it('labels backup entries whose name is only spaces like account cards, in the current language', async () => {
		const { context } = createHarness('en', {
			...preview,
			count: 2,
			secrets: [
				{ name: '   ', account: 'alice', type: 'TOTP' },
				{ name: 'GitHub', account: 'bob', type: 'TOTP' },
			],
		});
		await context.selectBackup(backup, 0);
		const names = () => [...document.querySelectorAll('#backupPreviewContent .service-name')].map((cell) => cell.textContent);
		expect(names()).toEqual(['Untitled', 'GitHub']);
		context.setLanguage('zh-TW');
		expect(names()).toEqual(['未命名', 'GitHub']);
	});

	describe('kept entries with unsupported OTP parameters', () => {
		const notice = () => document.querySelector('#backupPreviewContent .backup-unsupported-notice');
		const noticeEntries = () => [...notice().querySelectorAll('li')].map((item) => item.textContent);

		it('receives the count and at most 10 per-entry lines from the server', () => {
			const { data } = unsupportedResponses.preview.body;
			expect(unsupportedResponses.preview.status).toBe(200);
			expect(data).toMatchObject({ partial: false, skippedInvalidCount: 0, unsupportedCount: 12, warnings: [] });
			expect(data.unsupportedWarnings).toHaveLength(10);
			// Nine entries, then one line for the remaining three.
			expect(data.unsupportedWarnings.at(-1)).toContain('3');
			expect(data.unsupportedWarnings[0]).toMatch(/^Entry 2 \(<b>Five digits<\/b>\): /);
			expect(unsupportedResponses.restore).toMatchObject({ ok: true, status: 200, body: { count: 13, unsupportedCount: 12 } });
		});

		it('explains them without blocking the restore and lists every line the server sent', async () => {
			const { data } = unsupportedResponses.preview.body;
			const { context } = createHarness('en', data);
			await context.selectBackup(backup, 0);

			expect(notice().getAttribute('role')).toBe('status');
			expect(notice().textContent).toContain(context.t('restoreUnsupportedNotice', { count: 12 }));
			expect(noticeEntries()).toEqual(data.unsupportedWarnings);
			expect(notice().querySelector('b')).toBeNull();
			expect(document.getElementById('confirmRestoreBtn').disabled).toBe(false);
			expect(document.getElementById('exportBackupBtn').disabled).toBe(false);
			expect(document.querySelectorAll('#backupPreviewContent .service-name')).toHaveLength(13);

			context.setLanguage('zh-TW');
			expect(notice().textContent).toContain('有 12 個帳戶的 OTP 參數不受支援');
			expect(noticeEntries()).toHaveLength(10);
		});

		it('shows no notice for a backup the web app can show completely', async () => {
			const { context } = createHarness('en');
			await context.selectBackup(backup, 0);
			expect(notice()).toBeNull();
		});

		it('mentions them in the result of a successful restore and leaves time to read it', async () => {
			const { context, authenticatedFetch, showCenterToast } = createHarness('en', unsupportedResponses.preview.body.data);
			await context.selectBackup(backup, 0);
			const { body } = unsupportedResponses.restore;
			authenticatedFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
			const pending = context.confirmRestore();
			document.getElementById('confirmDialogConfirm').click();
			await vi.advanceTimersByTimeAsync(200);
			await pending;

			expect(showCenterToast).toHaveBeenLastCalledWith(
				'✅',
				context.t('restoreCompletedWithUnsupported', { count: body.count, unsupported: body.unsupportedCount }),
			);
			await vi.advanceTimersByTimeAsync(1000);
			expect(context.location.reload).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(3000);
			expect(context.location.reload).toHaveBeenCalledOnce();
		});

		it('keeps the plain result for a restore without such entries', async () => {
			const { context, authenticatedFetch, showCenterToast } = createHarness('en');
			await context.selectBackup(backup, 0);
			authenticatedFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ count: 1, unsupportedCount: 0 }) });
			const pending = context.confirmRestore();
			document.getElementById('confirmDialogConfirm').click();
			await vi.advanceTimersByTimeAsync(200);
			await pending;

			expect(showCenterToast).toHaveBeenLastCalledWith('✅', context.t('restoreCompleted', { count: 1 }));
			await vi.advanceTimersByTimeAsync(1000);
			expect(context.location.reload).toHaveBeenCalledOnce();
		});
	});

	describe('skipped entries of an incomplete backup', () => {
		const listed = () => [...document.querySelectorAll('#backupPreviewContent .dialog-warning-list li')].map((item) => item.textContent);

		it('receives only the skipped entries in a refusal and a summary before them in a preview', () => {
			const entries = serverResponses.restore.body.warnings;
			expect(serverResponses.restore).toMatchObject({ ok: false, status: 400 });
			expect(serverResponses.export).toMatchObject({ ok: false, status: 400 });
			expect(entries).toHaveLength(2);
			expect(entries[0]).toMatch(/^Entry 2 \(<b>Example<\/b>\): /);
			expect(entries[1]).toMatch(/^Entry 3 \(Other\): /);
			expect(serverResponses.export.body.warnings).toEqual(entries);
			expect(serverResponses.preview.body.data.partial).toBe(true);
			expect(serverResponses.preview.body.data.warnings.slice(1)).toEqual(entries);
		});

		it('lists every skipped entry in the preview of a partial backup', async () => {
			const data = serverResponses.preview.body.data;
			const { context } = createHarness('en', data);
			await context.selectBackup(backup, 0);
			expect(document.querySelector('#backupPreviewContent .dialog-warning p').textContent).toBe(data.warnings[0]);
			expect(listed()).toEqual(data.warnings.slice(1));
			expect(document.querySelector('#backupPreviewContent b')).toBeNull();
		});

		it('lists the skipped entries when the preview request is refused', async () => {
			const { body } = serverResponses.restore;
			const { context, authenticatedFetch } = createHarness('en');
			authenticatedFetch.mockResolvedValueOnce(refused(serverResponses.restore));
			await context.selectBackup(backup, 0);
			expect(document.querySelector('#backupPreviewContent .no-backups').textContent).toContain(
				'Failed to load backup preview: ' + body.message,
			);
			expect(listed()).toEqual(body.warnings);
		});

		it('shows the explanation and every skipped entry when the export is refused', async () => {
			const { body } = serverResponses.export;
			const { context, authenticatedFetch, showCenterToast } = createHarness('en');
			await context.loadBackupList();
			await context.selectBackup(backup, 0);
			authenticatedFetch.mockResolvedValueOnce(refused(serverResponses.export));
			await context.executeBackupExport('txt');

			expect(showCenterToast).toHaveBeenLastCalledWith('❌', 'Export failed: ' + body.message);
			const notice = document.querySelector('#backupPreviewContent [role="alert"]');
			expect(notice.textContent).toContain('Export failed: ' + body.message);
			expect(listed()).toEqual(body.warnings);
			expect(document.getElementById('exportBackupBtn').disabled).toBe(true);

			// The reasons stay visible after a language change re-renders the preview.
			context.setLanguage('zh-TW');
			expect(listed()).toHaveLength(body.warnings.length);
		});

		it('shows every skipped entry and blocks another attempt when the restore is refused', async () => {
			const { body } = serverResponses.restore;
			const { context, authenticatedFetch, showCenterToast } = createHarness('en');
			await context.selectBackup(backup, 0);
			authenticatedFetch.mockResolvedValueOnce(refused(serverResponses.restore));
			const pending = context.confirmRestore();
			document.getElementById('confirmDialogConfirm').click();
			await vi.advanceTimersByTimeAsync(200);
			await pending;

			expect(showCenterToast).toHaveBeenCalledWith('❌', 'Restore failed: ' + body.message);
			expect(document.querySelector('#backupPreviewContent [role="alert"]').textContent).toContain('Restore failed: ' + body.message);
			expect(listed()).toEqual(body.warnings);
			expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);
		});
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
