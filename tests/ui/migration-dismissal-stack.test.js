import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getModalDismissalCode } from '../../src/ui/scripts/modalDismissal.js';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';

const windows = [];
const pendingSecrets = [
	{ issuer: 'Example', name: 'user@example.test', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' },
	{ issuer: '', name: '', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' },
];

function harness() {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	const document = window.document;
	const api = createContext({
		window,
		document,
		navigator: window.navigator,
		HTMLElement: window.HTMLElement,
		localStorage: window.localStorage,
		setTimeout,
		clearTimeout,
		console: { log() {}, warn() {}, error() {} },
	});
	runInContext(
		getI18nCode() + getUtilsCode() + getModalDismissalCode() + getSharedTransferMessageLocalizerCode() + getGoogleMigrationCode(),
		api,
	);
	api.setLanguage('en');
	api.initModalDismissal();
	api.showGoogleMigrationPreview(pendingSecrets);
	for (const button of document.querySelectorAll('[onclick]')) {
		button.onclick = () => runInContext(button.getAttribute('onclick'), api);
	}
	const modal = (id) => document.getElementById(id);
	const escape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	const changeLanguage = (language) => {
		const oldValue = window.localStorage.getItem('language');
		window.localStorage.setItem('language', language);
		window.dispatchEvent(new window.StorageEvent('storage', { key: 'language', newValue: language, oldValue }));
	};
	return { api, document, window, modal, escape, changeLanguage, flush: () => vi.advanceTimersByTimeAsync(600) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	vi.clearAllTimers();
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
	vi.useRealTimers();
});

describe('migration preview dismissal across language changes', () => {
	it.each(['confirm', 'escape', 'cancel', 'backdrop'])(
		'keeps the discard prompt above its preview and honors %s after a storage event',
		async (action) => {
			const { api, document, window, modal, escape, changeLanguage, flush } = harness();
			await flush();
			const preview = modal('migrationPreviewModal');
			const close = preview.querySelector('.close-btn');
			const checkbox = modal('migrate-1');
			const list = preview.querySelector('.migration-preview-list');
			checkbox.checked = false;
			list.scrollTop = 100;
			close.focus();
			close.click();
			await flush();
			const confirmation = modal('confirmDialogModal');
			const originalZ = preview.style.zIndex;

			for (const language of ['ja', 'zh-CN']) {
				changeLanguage(language);
				await flush();
				expect(api.getTopModal()).toBe(confirmation);
				expect(modal('migrationPreviewModal')).toBe(preview);
				expect(preview.style.zIndex).toBe(originalZ);
				expect(Number(confirmation.style.zIndex)).toBeGreaterThan(Number(preview.style.zIndex));
				expect(modal('migrate-1')).toBe(checkbox);
				expect(checkbox.checked).toBe(false);
				expect(list.scrollTop).toBe(100);
				expect(window.pendingMigrationSecrets).toBe(pendingSecrets);
				expect(preview.querySelector('h2').textContent).toBe(api.t('transferGoogleImport'));
				expect(preview.querySelector('.modal-body > p').textContent).toBe(api.t('transferMigrationConfirm', { count: 2 }));
				expect(preview.querySelectorAll('.migration-preview-item')[1].textContent).toContain(api.t('transferImportedKey'));
				expect(close.getAttribute('aria-label')).toBe(api.t('transferCloseDialog'));
				expect(modal('confirmDialogMessage').textContent).toBe(api.t('dialogDiscardMessage'));
			}

			if (action === 'confirm') {
				modal('confirmDialogConfirm').click();
			} else if (action === 'escape') {
				escape();
			} else if (action === 'cancel') {
				modal('confirmDialogCancel').click();
			} else {
				confirmation.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
				confirmation.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
			}
			await flush();

			if (action !== 'confirm') {
				expect(api.getTopModal()).toBe(preview);
				expect(checkbox.checked).toBe(false);
				expect(document.activeElement).toBe(close);
				expect(document.body.style.position).toBe('fixed');
				escape();
				await flush();
				expect(api.getTopModal()).toBe(confirmation);
				modal('confirmDialogConfirm').click();
				await flush();
			}
			expect(modal('migrationPreviewModal')).toBeNull();
			expect(window.pendingMigrationSecrets).toBeNull();
			expect(api.getTopModal()).toBeNull();
			expect(document.body.style.position).toBe('');
		},
	);
});
