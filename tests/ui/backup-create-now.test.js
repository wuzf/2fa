import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LIST_WITH_BACKUP = { backups: [{ key: 'backup_2026-10-01_12-00-00.json', count: 1 }], pagination: { hasMore: false } };

async function harness(createResponse, listResponse = () => jsonResponse(LIST_WITH_BACKUP)) {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	window.document.write(await (await createMainPage()).text());
	const document = window.document;
	const api = createContext({
		window,
		document,
		localStorage: window.localStorage,
		navigator: { language: 'en' },
		URL,
		URLSearchParams,
		setTimeout: (fn) => {
			fn();
			return 1;
		},
		clearTimeout() {},
		console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
	});
	runInContext(getI18nCode() + getSharedTransferMessageLocalizerCode() + getUtilsCode(), api);
	api.showCenterToast = vi.fn();
	api.authenticatedFetch = vi.fn(async (path, options = {}) => {
		if (options.method === 'POST') {
			return createResponse();
		}
		return listResponse();
	});
	runInContext(getModuleCode('backup'), api);
	api.setLanguage('en');
	return { api, document };
}

describe('creating a backup from the backup dialog', () => {
	it('offers the button in the backup dialog', async () => {
		const { document } = await harness(() => jsonResponse({ success: true }));
		const button = document.querySelector('#restoreModal #createBackupBtn');
		expect(button).not.toBeNull();
		expect(button.getAttribute('onclick')).toBe('createBackupNow()');
		expect(button.getAttribute('data-i18n')).toBe('createBackupBtn');
	});

	it('creates a backup and reloads the backup list', async () => {
		const { api, document } = await harness(() => jsonResponse({ success: true, backupKey: 'backup_2026-10-01_12-00-00.json', count: 1 }));
		await api.createBackupNow();

		const calls = api.authenticatedFetch.mock.calls;
		expect(calls[0]).toEqual(['/api/backup', { method: 'POST' }]);
		expect(calls[1][0]).toMatch(/^\/api\/backup\?/);
		expect(api.showCenterToast).toHaveBeenCalledWith('✅', api.t('backupCreatedSuccess'));
		// The placeholder plus the backup from the reloaded list
		expect(document.querySelectorAll('#backupSelect option')).toHaveLength(2);
		expect(document.getElementById('createBackupBtn').disabled).toBe(false);
	});

	it('shows the new backup when the list was still loading as the dialog opened', async () => {
		const pendingLists = [];
		const { api, document } = await harness(
			() => jsonResponse({ success: true }),
			() => new Promise((resolve) => pendingLists.push(resolve)),
		);
		// Opening the dialog starts the first list load; the backup is created before it returns.
		const firstLoad = api.loadBackupList();
		const created = api.createBackupNow();
		await vi.waitFor(() => expect(pendingLists).toHaveLength(2));

		pendingLists[1](jsonResponse(LIST_WITH_BACKUP));
		await created;
		// The older, empty list arrives last and must not replace the reloaded one.
		pendingLists[0](jsonResponse({ backups: [], pagination: { hasMore: false } }));
		await firstLoad;

		expect(document.querySelectorAll('#backupSelect option')).toHaveLength(2);
		expect(document.getElementById('backupSelect').disabled).toBe(false);
	});

	it("shows the server's reason when no backup is created", async () => {
		const { api, document } = await harness(() =>
			jsonResponse({ error: 'No secrets to back up', message: 'There are no secrets to back up' }, 400),
		);
		await api.createBackupNow();

		expect(api.showCenterToast).toHaveBeenCalledWith('❌', 'There are no secrets to back up');
		expect(api.authenticatedFetch).toHaveBeenCalledOnce();
		expect(document.getElementById('createBackupBtn').disabled).toBe(false);
	});
});
