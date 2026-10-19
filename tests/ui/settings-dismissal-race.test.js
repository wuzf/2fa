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

const html = (await (await createMainPage()).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const windows = [];

function harness() {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	const document = window.document;
	document.body.innerHTML = html;
	const requests = [];
	const authenticatedFetch = vi.fn(
		(url, options) =>
			new Promise((resolve) =>
				requests.push({
					body: JSON.parse(options.body),
					finish: (success = true) => resolve({ ok: success, json: async () => ({ success }) }),
				}),
			),
	);
	const api = createContext({
		window,
		document,
		HTMLElement: window.HTMLElement,
		localStorage: window.localStorage,
		AbortController,
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (fn) => setTimeout(fn, 16),
		cancelAnimationFrame: clearTimeout,
		console: { log() {}, warn() {}, error() {} },
		t: (key) => LOCALES.en[key] || key,
		authenticatedFetch,
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
	const element = (id) => document.getElementById(id);
	const close = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
	const selectFormat = (value) => {
		element('settingsDefaultExportFormat').value = value;
		return api.saveDefaultExportFormat();
	};
	api.showSettingsModal();
	return { api, element, requests, authenticatedFetch, close, flush, selectFormat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	vi.clearAllTimers();
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
	vi.useRealTimers();
});

describe('settings edits during dismissal', () => {
	it('waits for a later format selection before deciding whether to discard changes', async () => {
		const h = harness();
		h.selectFormat('txt');
		await h.flush();
		h.close();
		await h.flush();
		h.selectFormat('csv');
		h.requests[0].finish();
		await h.flush(50);
		expect(h.requests.map((request) => request.body)).toEqual([{ defaultExportFormat: 'txt' }, { defaultExportFormat: 'csv' }]);
		expect(h.element('confirmDialogModal')).toBeNull();
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
		h.requests[1].finish();
		await h.flush(350);
		expect(h.element('settingsDefaultExportFormat').value).toBe('csv');
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('only offers discard after the latest format save has failed', async () => {
		const h = harness();
		h.selectFormat('txt');
		await h.flush();
		h.close();
		await h.flush();
		h.selectFormat('csv');
		h.requests[0].finish();
		await h.flush(50);
		expect(h.element('confirmDialogModal')).toBeNull();
		h.requests[1].finish(false);
		await h.flush(50);
		expect(h.element('confirmDialogModal').classList.contains('show')).toBe(true);
		h.element('confirmDialogConfirm').click();
		await h.flush(600);
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.authenticatedFetch).toHaveBeenCalledTimes(2);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('flushes a different numeric field edited while the original save was pending', async () => {
		const h = harness();
		h.element('settingsJwtExpiryDays').value = '45';
		h.api.scheduleNumericPreferenceSave('jwtExpiryDays');
		h.close();
		await h.flush();
		h.element('settingsMaxBackups').value = '25';
		h.api.scheduleNumericPreferenceSave('maxBackups');
		h.requests[0].finish();
		await h.flush(50);
		expect(h.requests.map((request) => request.body)).toEqual([{ jwtExpiryDays: 45 }, { maxBackups: 25 }]);
		expect(h.element('confirmDialogModal')).toBeNull();
		h.requests[1].finish();
		await h.flush(350);
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('does not flush newer edits after the closing attempt stops waiting', async () => {
		const h = harness();
		const controller = new AbortController();
		h.selectFormat('txt');
		const closing = h.api.flushSettingsBeforeClose(controller.signal);
		await h.flush();
		controller.abort();
		h.element('settingsMaxBackups').value = '25';
		h.api.scheduleNumericPreferenceSave('maxBackups');
		h.requests[0].finish();
		await closing;
		await h.flush(50);
		expect(h.authenticatedFetch).toHaveBeenCalledTimes(1);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(true);
	});

	it.each(['timeout', 'settled'])('waits for an earlier numeric save after the input becomes invalid (%s)', async (outcome) => {
		const h = harness();
		h.element('settingsJwtExpiryDays').value = '45';
		h.api.scheduleNumericPreferenceSave('jwtExpiryDays');
		h.api.saveNumericPreference('jwtExpiryDays');
		await h.flush();
		h.element('settingsJwtExpiryDays').value = '';
		h.api.scheduleNumericPreferenceSave('jwtExpiryDays');
		h.close();
		await h.flush(50);
		expect(h.element('confirmDialogModal')).toBeNull();
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
		if (outcome === 'timeout') {
			await h.flush(5000);
			expect(h.element('confirmDialogTitle').textContent).toBe(LOCALES.en.dialogSavePendingTitle);
			expect(h.element('confirmDialogMessage').textContent).toBe(LOCALES.en.dialogSavePendingMessage);
		} else {
			h.requests[0].finish();
			await h.flush(50);
			expect(h.element('confirmDialogTitle').textContent).toBe(LOCALES.en.dialogDiscardTitle);
			expect(h.element('confirmDialogMessage').textContent).toBe(LOCALES.en.dialogDiscardMessage);
		}
		expect(h.requests.map((request) => request.body)).toEqual([{ jwtExpiryDays: 45 }]);
		h.element('confirmDialogCancel').click();
		await h.flush(350);
		expect(h.element('settingsJwtExpiryDays').value).toBe('');
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
	});
});
