import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getModalDismissalCode } from '../../src/ui/scripts/modalDismissal.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUICode } from '../../src/ui/scripts/ui.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';

const html = (await (await createMainPage()).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const windows = [];

function harness() {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	window.document.body.innerHTML = html;
	const document = window.document;
	const api = createContext({
		window,
		document,
		HTMLElement: window.HTMLElement,
		localStorage: window.localStorage,
		setTimeout,
		clearTimeout,
		AbortController,
		requestAnimationFrame: (fn) => setTimeout(fn, 16),
		cancelAnimationFrame: clearTimeout,
		console: { log() {}, warn() {}, error() {} },
		t: (key) => LOCALES.en[key] || key,
		authenticatedFetch: vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })),
	});
	runInContext(getUtilsCode() + getModalDismissalCode() + getStateCode() + getUICode() + getSettingsCode(), api);
	api.showCenterToast = vi.fn();
	api.initModalDismissal();
	for (const button of document.querySelectorAll('[onclick]')) {
		button.onclick = (event) => {
			api.event = event;
			return runInContext(button.getAttribute('onclick'), api);
		};
	}
	const modal = (id) => document.getElementById(id);
	const escape = (repeat = false) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat }));
	const clickBackdrop = (id) => {
		modal(id).dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
		modal(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
	};
	const flush = () => vi.advanceTimersByTimeAsync(600);
	return { api, document, window, modal, escape, clickBackdrop, flush };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	vi.clearAllTimers();
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
	vi.useRealTimers();
});

describe('consistent modal dismissal', () => {
	it('declares an explicit policy and an exit for every static dialog', () => {
		const { document } = harness();
		for (const modal of document.querySelectorAll('.modal')) {
			expect(['form', 'passive'], modal.id).toContain(modal.dataset.dialogKind);
			expect(modal.querySelector('.close-btn, [data-dialog-dismiss]'), modal.id).not.toBeNull();
		}
	});

	it('closes every unchanged dialog through its existing exit when the backdrop is clicked', async () => {
		const { api, document, clickBackdrop, flush } = harness();
		for (const dialog of document.querySelectorAll('.modal')) {
			const close = vi.fn(() => api.hideModal(dialog.id));
			dialog.querySelector('.close-btn, [data-dialog-dismiss]').onclick = close;
			api.showModal(dialog.id);
			await flush();
			clickBackdrop(dialog.id);
			await flush();
			expect(close, dialog.id).toHaveBeenCalledTimes(1);
			expect(dialog.style.display, dialog.id).toBe('none');
			expect(document.getElementById('confirmDialogModal')).toBeNull();
		}
	});

	it('closes a passive dialog by backdrop, Escape and its close button', async () => {
		const { api, modal, escape, clickBackdrop, flush } = harness();
		for (const close of [() => clickBackdrop('toolsModal'), escape, () => modal('toolsModal').querySelector('.close-btn').click()]) {
			api.showToolsModal();
			await flush();
			close();
			await flush();
			expect(modal('toolsModal').style.display).toBe('none');
		}
	});

	it('does not close on a click inside or a drag ending on the backdrop', async () => {
		const { api, modal, window, flush } = harness();
		api.showToolsModal();
		await flush();
		const content = modal('toolsModal').querySelector('.modal-content');
		content.click();
		content.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
		modal('toolsModal').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(modal('toolsModal').classList.contains('show')).toBe(true);
	});

	it.each(['escape', 'close', 'cancel', 'backdrop'])('protects a new account draft through %s', async (way) => {
		const { api, document, modal, escape, clickBackdrop, flush } = harness();
		api.showAddModal();
		await flush();
		modal('secretName').value = 'Unsaved account';
		const close = () => {
			if (way === 'escape') {
				escape();
			} else if (way === 'backdrop') {
				clickBackdrop('secretModal');
			} else {
				modal('secretModal')
					.querySelector(way === 'close' ? '.close-btn' : '.btn-secondary[data-dialog-dismiss]')
					.click();
			}
		};
		close();
		await flush();
		expect(modal('secretModal').classList.contains('show')).toBe(true);
		expect(modal('confirmDialogMessage').textContent).toBe(LOCALES.en.dialogDiscardMessage);
		document.getElementById('confirmDialogCancel').click();
		await flush();
		expect(modal('secretName').value).toBe('Unsaved account');
		expect(modal('secretModal').classList.contains('show')).toBe(true);
		close();
		await flush();
		document.getElementById('confirmDialogConfirm').click();
		await flush();
		expect(modal('secretModal').style.display).toBe('none');
	});

	it('does not warn for an unchanged existing record or an edit reverted to its original value', async () => {
		const { api, document, modal, escape, flush } = harness();
		api.showSecretModal(() => {
			runInContext("editingId = 'existing'", api);
			modal('secretName').value = 'Saved account';
			modal('secretKey').value = 'JBSWY3DPEHPK3PXP';
		});
		await flush();
		modal('secretName').value = 'Changed';
		modal('secretName').value = 'Saved account';
		escape();
		await flush();
		expect(document.getElementById('confirmDialogModal')).toBeNull();
		expect(modal('secretModal').style.display).toBe('none');
	});

	it('Escape dismisses only the confirmation and leaves the edited form intact', async () => {
		const { api, modal, escape, flush } = harness();
		api.showAddModal();
		await flush();
		modal('secretKey').value = 'JBSWY3DPEHPK3PXP';
		escape();
		await flush();
		escape(true);
		expect(modal('confirmDialogModal').classList.contains('show')).toBe(true);
		escape();
		await flush();
		expect(modal('confirmDialogModal').style.display).toBe('none');
		expect(modal('secretModal').classList.contains('show')).toBe(true);
		expect(modal('secretKey').value).toBe('JBSWY3DPEHPK3PXP');
	});

	it('keeps the parent open and scroll locked when a nested dialog closes', async () => {
		const { api, document, modal, escape, flush } = harness();
		api.showToolsModal();
		api.showModal('timestampModal');
		const cleanup = vi.fn(() => api.hideModal('timestampModal'));
		modal('timestampModal').querySelector('.close-btn').onclick = cleanup;
		await flush();
		escape();
		await flush();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(modal('toolsModal').classList.contains('show')).toBe(true);
		expect(document.body.style.position).toBe('fixed');
		escape();
		await flush();
		expect(document.body.style.position).toBe('');
	});

	it('a delayed discard confirmation cannot close a replacement form', async () => {
		const { api, modal, escape, flush } = harness();
		api.showAddModal();
		await flush();
		modal('secretName').value = 'Old draft';
		escape();
		await flush();
		api.hideSecretModal();
		api.showAddModal();
		modal('secretName').value = 'New draft';
		modal('confirmDialogConfirm').click();
		await flush();
		expect(modal('secretModal').classList.contains('show')).toBe(true);
		expect(modal('secretName').value).toBe('New draft');
	});

	it('closes immediately after opening without a delayed timer reopening the dialog', async () => {
		const { api, modal, escape, flush } = harness();
		api.showToolsModal();
		escape();
		await flush();
		expect(modal('toolsModal').style.display).toBe('none');
		expect(modal('toolsModal').classList.contains('show')).toBe(false);
	});

	it.each(['importModal', 'restoreModal'])('protects the selected file in %s when clicking its backdrop', async (id) => {
		const { api, modal, clickBackdrop, window, flush } = harness();
		api.showModal(id);
		const input = modal(id === 'importModal' ? 'importFileInput' : 'restoreBackupFileInput');
		const transfer = new window.DataTransfer();
		transfer.items.add(new window.File(['account data'], 'accounts.json'));
		input.files = transfer.files;
		clickBackdrop(id);
		await flush();
		expect(modal('confirmDialogModal').classList.contains('show')).toBe(true);
		clickBackdrop('confirmDialogModal');
		await flush();
		expect(modal(id).classList.contains('show')).toBe(true);
		expect(input.files[0].name).toBe('accounts.json');
	});

	it('confirms before leaving an import draft through the scanner link', async () => {
		const { api, document, modal, flush } = harness();
		api.hideImportModal = vi.fn(() => api.hideModal('importModal'));
		api.showQRScanner = vi.fn();
		api.showModal('importModal');
		modal('importText').value = 'Unsaved imported accounts';
		const link = document.querySelector('[data-i18n="pageScanMigration"]');
		link.click();
		await flush();
		expect(api.showQRScanner).not.toHaveBeenCalled();
		modal('confirmDialogCancel').click();
		await flush();
		expect(modal('importText').value).toBe('Unsaved imported accounts');
		link.click();
		await flush();
		modal('confirmDialogConfirm').click();
		await flush();
		expect(api.hideImportModal).toHaveBeenCalledTimes(1);
		expect(api.showQRScanner).toHaveBeenCalledTimes(1);
	});

	it('marks a successfully saved form clean without ignoring subsequent edits', async () => {
		const { api, document, modal, escape, flush } = harness();
		api.showModal('webdavModal');
		modal('webdavName').value = 'Saved destination';
		api.markModalSaved('webdavModal');
		modal('webdavModal').querySelector('.close-btn').onclick = () => api.hideModal('webdavModal');
		escape();
		await flush();
		expect(document.getElementById('confirmDialogModal')).toBeNull();
		api.showModal('webdavModal');
		modal('webdavName').value = 'Unsaved destination';
		escape();
		await flush();
		expect(modal('confirmDialogModal').classList.contains('show')).toBe(true);
	});

	it('protects a dynamically created migration preview and uses its real cancellation cleanup', async () => {
		const { api, modal, escape, window, flush } = harness();
		runInContext(getGoogleMigrationCode(), api);
		api.showGoogleMigrationPreview([{ name: 'Example', secret: 'JBSWY3DPEHPK3PXP' }]);
		modal('migrationPreviewModal').querySelector('.close-btn').onclick = () => api.closeMigrationPreview();
		escape();
		await flush();
		expect(window.pendingMigrationSecrets).toHaveLength(1);
		modal('confirmDialogCancel').click();
		await flush();
		expect(window.pendingMigrationSecrets).toHaveLength(1);
		escape();
		await flush();
		modal('confirmDialogConfirm').click();
		await flush();
		expect(window.pendingMigrationSecrets).toBeNull();
		expect(modal('migrationPreviewModal')).toBeNull();
	});

	it('waits for an automatic save in flight and handles repeated close attempts only once', async () => {
		const { api, document, modal, escape, flush } = harness();
		let finishSave;
		api.authenticatedFetch.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishSave = resolve;
				}),
		);
		api.showSettingsModal();
		modal('settingsJwtExpiryDays').value = '45';
		api.scheduleNumericPreferenceSave('jwtExpiryDays');
		escape();
		await flush();
		escape();
		expect(modal('settingsModal').classList.contains('show')).toBe(true);
		expect(document.getElementById('confirmDialogModal')).toBeNull();
		finishSave({ ok: true, json: async () => ({ success: true }) });
		await flush();
		expect(api.authenticatedFetch).toHaveBeenCalledTimes(1);
		expect(modal('settingsModal').style.display).toBe('none');
	});

	it.each(['request', 'response body'])('keeps an exit available when the save %s never finishes', async (phase) => {
		const { api, modal, escape, flush } = harness();
		api.authenticatedFetch.mockImplementation(() =>
			phase === 'request' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }),
		);
		api.showSettingsModal();
		modal('settingsJwtExpiryDays').value = '45';
		api.scheduleNumericPreferenceSave('jwtExpiryDays');
		escape();
		await vi.advanceTimersByTimeAsync(5500);
		expect(modal('confirmDialogModal')?.classList.contains('show')).toBe(true);
		expect(modal('confirmDialogMessage').textContent).toBe(LOCALES.en.dialogSavePendingMessage);
		modal('confirmDialogConfirm').click();
		await flush();
		expect(modal('settingsModal').style.display).toBe('none');
	});

	it('preserves input and allows another close attempt after canceling a stalled save warning', async () => {
		const { api, modal, escape, clickBackdrop, flush } = harness();
		api.authenticatedFetch.mockImplementation(() => new Promise(() => {}));
		api.showSettingsModal();
		modal('settingsMaxBackups').value = '25';
		modal('settingsNewPassword').value = 'Unsubmitted-password';
		api.scheduleNumericPreferenceSave('maxBackups');
		clickBackdrop('settingsModal');
		await vi.advanceTimersByTimeAsync(5500);
		expect(modal('confirmDialogModal')?.classList.contains('show')).toBe(true);
		escape();
		await flush();
		expect(modal('settingsNewPassword').value).toBe('Unsubmitted-password');
		expect(modal('settingsMaxBackups').value).toBe('25');
		modal('settingsModal').querySelector('.close-btn').click();
		await vi.advanceTimersByTimeAsync(5500);
		expect(modal('confirmDialogModal').classList.contains('show')).toBe(true);
		modal('confirmDialogConfirm').click();
		await flush();
		expect(modal('settingsModal').style.display).toBe('none');
		expect(api.authenticatedFetch).toHaveBeenCalledTimes(1);
	});

	it('a save completing after timeout does not close a reopened settings dialog', async () => {
		const { api, modal, escape, flush } = harness();
		let finishSave;
		api.authenticatedFetch.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishSave = resolve;
				}),
		);
		api.showSettingsModal();
		modal('settingsJwtExpiryDays').value = '45';
		api.scheduleNumericPreferenceSave('jwtExpiryDays');
		escape();
		await vi.advanceTimersByTimeAsync(5500);
		modal('confirmDialogConfirm').click();
		await flush();
		api.showSettingsModal();
		modal('settingsNewPassword').value = 'New draft';
		finishSave({ ok: true, json: async () => ({ success: true }) });
		await flush();
		expect(modal('settingsModal').classList.contains('show')).toBe(true);
		expect(modal('settingsNewPassword').value).toBe('New draft');
		expect(modal('confirmDialogModal').style.display).toBe('none');
	});

	it('flushes pending automatic settings saves without a discard warning', async () => {
		const { api, document, modal, escape, flush } = harness();
		api.showSettingsModal();
		modal('settingsJwtExpiryDays').value = '45';
		api.scheduleNumericPreferenceSave('jwtExpiryDays');
		escape();
		await flush();
		expect(api.authenticatedFetch).toHaveBeenCalledTimes(1);
		expect(document.getElementById('confirmDialogModal')).toBeNull();
		expect(modal('settingsModal').style.display).toBe('none');
	});

	it('protects failed automatic saves and clears abandoned password drafts after confirmation', async () => {
		const { api, modal, escape, flush } = harness();
		api.authenticatedFetch.mockRejectedValue(new Error('Offline'));
		api.showSettingsModal();
		modal('settingsNewPassword').value = 'Unsubmitted-password';
		modal('settingsMaxBackups').value = '25';
		api.scheduleNumericPreferenceSave('maxBackups');
		escape();
		await flush();
		expect(modal('settingsModal').classList.contains('show')).toBe(true);
		modal('confirmDialogConfirm').click();
		await flush();
		expect(modal('settingsNewPassword').value).toBe('');
		expect(api.hasUnsavedSettingsChanges()).toBe(false);
		expect(modal('settingsModal').style.display).toBe('none');
	});
});
