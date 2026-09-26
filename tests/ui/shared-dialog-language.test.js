// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getModuleLoaderCode } from '../../src/ui/scripts/moduleLoader.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

function harness() {
	localStorage.setItem('language', 'en');
	const fetch = vi.fn();
	const toast = vi.fn();
	const api = createContext({
		document,
		window: {},
		HTMLElement: window.HTMLElement,
		navigator: { language: 'zh-CN' },
		localStorage,
		setTimeout,
		clearTimeout,
		Blob,
		Uint8Array,
		ArrayBuffer,
		authenticatedFetch: fetch,
		showCenterToast: toast,
		console: { log() {}, warn() {}, error() {} },
	});
	runInContext(getI18nCode() + getUtilsCode() + getModuleLoaderCode(), api);
	return { api, fetch, toast };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
	document.body.removeAttribute('style');
	localStorage.clear();
});

describe('shared dialog localization', () => {
	it('refreshes an open confirmation in the new language and preserves user text as text', async () => {
		const { api } = harness();
		const name = '<script>personal backup</script>';
		const confirming = api.showConfirmDialog({
			i18n: { title: 'restoreConfirmTitle', message: 'restoreConfirmMessage', confirmText: 'restoreAction', params: { name } },
			danger: true,
		});
		expect(document.getElementById('confirmDialogTitle').textContent).toBe('Restore Backup');
		expect(document.getElementById('confirmDialogMessage').textContent).toContain(name);
		expect(document.querySelector('#confirmDialogMessage script')).toBeNull();
		api.setLanguage('zh-TW');
		expect(document.getElementById('confirmDialogTitle').textContent).toBe(api.t('restoreConfirmTitle'));
		expect(document.getElementById('confirmDialogMessage').textContent).toContain(name);
		expect(document.getElementById('confirmDialogConfirm').textContent).toBe('還原');
		document.getElementById('confirmDialogCancel').click();
		await vi.advanceTimersByTimeAsync(200);
		await expect(confirming).resolves.toBe(false);
	});

	it('switches a pending module load and its failure to the current language', async () => {
		const { api, fetch, toast } = harness();
		let finish;
		fetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const loading = api.loadModule('backup');
		expect(document.querySelector('#loadingToast span').textContent).toBe('Loading backup management...');
		api.setLanguage('zh-TW');
		expect(document.querySelector('#loadingToast span').textContent).toBe('正在載入備份管理...');
		finish({ ok: false, status: 503 });
		await expect(loading).rejects.toThrow('載入模組失敗：伺服器回傳 503');
		expect(toast).toHaveBeenLastCalledWith('❌', '功能載入失敗：載入模組失敗：伺服器回傳 503');
		expect(document.getElementById('loadingToast').style.display).toBe('none');
	});

	it('localizes native file-picker descriptions without changing the exported filename', async () => {
		const { api } = harness();
		const write = vi.fn();
		api.window.showSaveFilePicker = vi.fn(async () => ({ createWritable: async () => ({ write, close: vi.fn() }) }));
		await api.downloadFile('example', 'backup.txt', 'text/plain');
		expect(api.window.showSaveFilePicker).toHaveBeenLastCalledWith(
			expect.objectContaining({ suggestedName: 'backup.txt', types: [expect.objectContaining({ description: 'Text files' })] }),
		);
		api.setLanguage('zh-TW');
		await api.downloadFile('example', 'backup.txt', 'text/plain');
		expect(api.window.showSaveFilePicker).toHaveBeenLastCalledWith(
			expect.objectContaining({ suggestedName: 'backup.txt', types: [expect.objectContaining({ description: '文字檔案' })] }),
		);
		expect(write).toHaveBeenCalledTimes(2);
	});
});
