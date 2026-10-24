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
import { MAX_CUSTOM_CODE_ITEMS, MAX_CUSTOM_CODE_LENGTH } from '../../src/utils/settings.js';

const html = (await (await createMainPage()).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const windows = [];
const reply = (data, ok = true) => ({ ok, json: async () => data });
const entry = (code, values = {}) => ({ id: 'test-code', name: 'My effect', enabled: true, code, ...values });

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function harness({ customCode, customCodes = [], fetchImpl, restorePosition, openSettings = true,
	url = 'https://example.test/?disableCustomCode=1&view=grid#settings' } = {}) {
	const window = new Window({
		url,
		settings: { disableJavaScriptEvaluation: true },
	});
	windows.push(window);
	const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
	const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
	if (restorePosition !== undefined) {
		window.sessionStorage.setItem('custom-code-editor-position', restorePosition);
	}
	const document = window.document;
	document.body.innerHTML = html;
	const settings = customCode === undefined ? { customCodes } : { customCode };
	const authenticatedFetch = vi.fn(async (url, options) => {
		if (fetchImpl) {
			return fetchImpl(url, options, settings);
		}
		if (options?.method === 'POST') {
			Object.assign(settings, JSON.parse(options.body));
			return reply({ success: true, settings: { ...settings } });
		}
		return reply({ ...settings });
	});
	const api = createContext({
		window,
		document,
		URL,
		Date,
		HTMLElement: window.HTMLElement,
		localStorage: window.localStorage,
		AbortController,
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (fn) => setTimeout(fn, 16),
		cancelAnimationFrame: clearTimeout,
		console: { log() {}, warn() {}, error() {} },
		t: (key, params = {}) => (LOCALES.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`),
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
	const rows = () => Array.from(element('settingsCustomCodeList').children);
	const editor = (index = 0) => rows()[index].querySelector('.settings-code-editor');
	const name = (index = 0) => rows()[index].querySelector('.settings-code-name');
	const toggle = (index = 0) => rows()[index].querySelector('input[type="checkbox"]');
	const summary = (index = 0) => rows()[index].querySelector('.settings-code-summary');
	const body = (index = 0) => rows()[index].querySelector('.settings-code-body');
	const input = (value, index = 0, field = 'code', composing = false) => {
		const target = field === 'name' ? name(index) : editor(index);
		target.value = value;
		target.dispatchEvent(new window.InputEvent('input', { bubbles: true, isComposing: composing }));
	};
	const posts = () =>
		authenticatedFetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options.body));
	if (openSettings) {
		api.showSettingsModal();
	}
	const ready = api.initCustomCodeAutoReload();
	return {
		ready,
		navigate,
		reload,
		api,
		window,
		document,
		element,
		rows,
		editor,
		name,
		toggle,
		summary,
		body,
		input,
		posts,
		settings,
		authenticatedFetch,
		close: () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
		flush: (ms = 0) => vi.advanceTimersByTimeAsync(ms),
	};
}

function saveSetting(h, key) {
	if (key === 'customCodes') {
		h.input('saved effect');
		return h.api.saveCustomCode();
	}
	if (key === 'language') {return h.api.saveLanguagePreference('en');}
	if (key === 'defaultExportFormat') {
		h.element('settingsDefaultExportFormat').value = 'csv';
		return h.api.saveDefaultExportFormat();
	}
	h.element(key === 'jwtExpiryDays' ? 'settingsJwtExpiryDays' : 'settingsMaxBackups').value = '45';
	h.api.scheduleNumericPreferenceSave(key);
	return h.api.saveNumericPreference(key);
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	vi.clearAllTimers();
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
	vi.useRealTimers();
});

describe('multiple custom code settings', () => {
	it('keeps Add below the custom code list and above the recovery hint only on its tab and expands the newest of consecutive additions', async () => {
		const h = harness({ customCodes: [entry('existing')] });
		const add = h.element('settingsCustomCodeAdd');
		const panel = h.element('settingsModal').querySelector('[data-panel="custom-code"]');
		expect(add.parentElement).toBe(panel.querySelector('.settings-code-add-actions'));
		expect(add.parentElement.previousElementSibling).toBe(h.element('settingsCustomCodeList'));
		expect(add.parentElement.nextElementSibling).toBe(panel.querySelector('.settings-info-box'));
		expect(panel.classList.contains('active')).toBe(false);
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		expect(panel.classList.contains('active')).toBe(true);
		add.click();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, false]);
		add.click();
		expect(h.rows()).toHaveLength(3);
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true, false]);
		expect(h.document.activeElement).toBe(h.name(2));
		h.toggle(0).click();
		expect(h.toggle(0).checked).toBe(false);
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true, false]);
		h.api.switchSettingsTab('security');
		expect(panel.classList.contains('active')).toBe(false);
		await h.flush();
		expect(panel.classList.contains('active')).toBe(false);
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		expect(panel.classList.contains('active')).toBe(true);
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true, false]);
		expect(h.posts().at(-1).customCodes).toHaveLength(3);
	});

	it('starts collapsed and expands only the selected entry without changing saved code', async () => {
		const h = harness({ customCodes: [entry('first'), entry('second', { id: 'second-code', name: '' })] });
		await h.api.loadCustomCode();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true]);
		expect(h.rows().map((_, index) => h.summary(index).getAttribute('aria-expanded'))).toEqual(['false', 'false']);
		expect(h.summary().textContent).toBe('My effect');
		expect(h.summary(1).textContent).toBe(LOCALES.en.customCodeUntitled.replace('{index}', '2'));
		expect(h.summary().getAttribute('aria-controls')).toBe(h.body().id);
		expect(h.name().labels[0].textContent).toBe(LOCALES.en.customCodeNameLabel);
		expect(h.editor().labels[0].textContent).toBe(LOCALES.en.customCodeEditorLabel);
		h.summary().click();
		expect(h.body().hidden).toBe(false);
		expect(h.summary().getAttribute('aria-expanded')).toBe('true');
		h.summary(1).click();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, false]);
		h.summary(1).click();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true]);
		await h.flush(2000);
		expect(h.posts()).toEqual([]);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('keeps existing editors and selections when switching entries and flushes a focused draft', async () => {
		const h = harness({ customCodes: [entry('first'), entry('second', { id: 'second-code' })] });
		await h.api.loadCustomCode();
		h.summary().click();
		const firstEditor = h.editor();
		const secondEditor = h.editor(1);
		firstEditor.focus();
		h.input('first edited');
		firstEditor.setSelectionRange(2, 6);
		h.summary(1).click();
		expect(h.body().hidden).toBe(true);
		expect(h.body(1).hidden).toBe(false);
		expect(h.document.activeElement).not.toBe(firstEditor);
		expect(h.editor()).toBe(firstEditor);
		expect(h.editor(1)).toBe(secondEditor);
		await h.flush();
		expect(h.posts()).toEqual([{ customCodes: [entry('first edited'), entry('second', { id: 'second-code' })] }]);
		h.summary().click();
		expect(h.editor()).toBe(firstEditor);
		expect(firstEditor.value).toBe('first edited');
		expect(firstEditor.selectionStart).toBe(2);
		expect(firstEditor.selectionEnd).toBe(6);
	});

	it('commits composition when collapsing a focused editor and accepts its final input event', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.summary().click();
		const editor = h.editor();
		editor.focus();
		editor.dispatchEvent(new h.window.CompositionEvent('compositionstart'));
		h.input('中', 0, 'code', true);
		await h.flush(2000);
		expect(h.posts()).toEqual([]);
		h.summary().click();
		editor.value = '中文';
		editor.dispatchEvent(new h.window.CompositionEvent('compositionend'));
		await h.flush(1000);
		expect(h.posts()).toEqual([{ customCodes: [entry('中文')] }]);
		expect(h.body().hidden).toBe(true);
		expect(h.editor()).toBe(editor);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('preserves the expanded entry across tab reloads and clears it when that entry is removed remotely', async () => {
		const h = harness({ customCodes: [entry('first'), entry('second', { id: 'second-code' })] });
		await h.api.loadCustomCode();
		h.summary(1).click();
		h.api.switchSettingsTab('security');
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, false]);
		h.settings.customCodes = [entry('first')];
		await h.api.loadCustomCode();
		expect(h.rows()).toHaveLength(1);
		expect(h.body().hidden).toBe(true);
		h.settings.customCodes.push(entry('second returns', { id: 'second-code' }));
		await h.api.loadCustomCode();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, true]);
	});

	it('discards an unsaved new entry without reopening an older editor', async () => {
		const h = harness({
			fetchImpl: (_url, options) => (options ? reply({ success: false }, false) : reply({ customCodes: [entry('saved')] })),
		});
		await h.api.loadCustomCode();
		h.summary().click();
		h.api.addCustomCode();
		await h.flush();
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, false]);
		h.api.discardSettingsDrafts();
		expect(h.rows()).toHaveLength(1);
		expect(h.body().hidden).toBe(true);
		await h.api.loadCustomCode();
		expect(h.body().hidden).toBe(true);
	});

	it('leaves remaining entries collapsed after deleting the expanded entry and focuses Add', async () => {
		const h = harness({ customCodes: [entry('first'), entry('second', { id: 'second-code' })] });
		await h.api.loadCustomCode();
		h.summary().click();
		h.rows()[0].querySelector('.settings-code-remove').click();
		await h.flush(50);
		h.element('confirmDialogConfirm').click();
		await h.flush(250);
		expect(h.rows()).toHaveLength(1);
		expect(h.rows()[0].dataset.codeId).toBe('second-code');
		expect(h.body().hidden).toBe(true);
		expect(h.document.activeElement).toBe(h.element('settingsCustomCodeAdd'));
		expect(h.posts()).toEqual([{ customCodes: [entry('second', { id: 'second-code' })] }]);
	});

	it('locks Add until a successful load and retries when the tab is reopened', async () => {
		const first = deferred();
		let attempts = 0;
		const h = harness({ fetchImpl: () => (++attempts === 1 ? first.promise : reply({ customCodes: [entry('saved')] })) });
		h.api.switchSettingsTab('custom-code');
		expect(h.element('settingsCustomCodeAdd').disabled).toBe(true);
		h.api.addCustomCode();
		expect(h.rows()).toHaveLength(0);
		first.resolve(reply({}, false));
		await h.flush();
		expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeLoadFailed);
		expect(h.element('settingsCustomCodeAdd').disabled).toBe(true);
		h.api.switchSettingsTab('security');
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		expect(h.editor().value).toBe('saved');
		expect(h.element('settingsCustomCodeAdd').disabled).toBe(false);
		expect(h.posts()).toEqual([]);
	});

	it('migrates legacy code into one enabled entry without saving just by loading', async () => {
		const h = harness({ customCode: '<style>body{color:red}</style>' });
		await h.api.loadCustomCode();
		expect(h.rows()).toHaveLength(1);
		expect(h.rows()[0].dataset.codeId).toBe('legacy-custom-code');
		expect(h.name().value).toBe('');
		expect(h.toggle().checked).toBe(true);
		expect(h.posts()).toEqual([]);
		h.input('renamed', 0, 'name');
		await h.flush(1000);
		expect(h.posts()).toEqual([{ customCodes: [entry('<style>body{color:red}</style>', { id: 'legacy-custom-code', name: 'renamed' })] }]);
	});

	it('automatically saves exact HTML after typing settles without executing it', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		const code = '  <style>body{color:red}</style>\n<script>window.customExample=true;</script>\n<div id="custom-example">Hi</div>\n';
		h.input('first draft');
		await h.flush(700);
		h.input(code);
		await h.flush(999);
		expect(h.posts()).toEqual([]);
		await h.flush(1);
		expect(h.posts()).toEqual([{ customCodes: [entry(code)] }]);
		expect(h.element('custom-example')).toBeNull();
		expect(h.window.customExample).toBeUndefined();
		expect(h.element('settingsCustomCodeSave')).toBeNull();
		expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeSaved);
		expect(h.element('settingsCustomCodeReload')).toBeNull();
		expect(h.navigate).not.toHaveBeenCalled();
		await h.flush(1999);
		expect(h.navigate).not.toHaveBeenCalled();
		await h.flush(1);
		expect(h.navigate).toHaveBeenCalledExactlyOnceWith('https://example.test/?view=grid#settings');
		expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeAutoApplying);
		await h.flush(5000);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('adds an empty entry, saves names and independent switches, and confirms deletion', async () => {
		const h = harness({ customCodes: [entry('first')] });
		const scroll = vi.spyOn(h.window.HTMLElement.prototype, 'scrollIntoView');
		await h.api.loadCustomCode();
		h.summary().click();
		h.element('settingsCustomCodeAdd').click();
		expect(h.rows()).toHaveLength(2);
		expect(h.document.activeElement).toBe(h.name(1));
		expect(h.rows().map((_, index) => h.body(index).hidden)).toEqual([true, false]);
		expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
		expect(scroll.mock.instances.at(-1)).toBe(h.rows()[1]);
		await h.flush();
		expect(h.posts()[0].customCodes[1]).toMatchObject({ name: '', enabled: true, code: '' });
		const addedId = h.rows()[1].dataset.codeId;
		h.input('<b>effect name</b>', 1, 'name');
		h.input('second', 1);
		h.toggle(0).click();
		await h.flush(1100);
		expect(h.posts()[1].customCodes).toEqual([
			entry('first', { enabled: false }),
			entry('second', { id: addedId, name: '<b>effect name</b>' }),
		]);
		expect(h.rows()[1].querySelector('b')).toBeNull();
		expect(h.summary(1).textContent).toBe('<b>effect name</b>');
		expect(h.body().hidden).toBe(true);
		h.rows()[0].querySelector('.settings-code-remove').click();
		await h.flush(50);
		h.element('confirmDialogCancel').click();
		await h.flush(250);
		expect(h.rows()).toHaveLength(2);
		h.rows()[0].querySelector('.settings-code-remove').click();
		await h.flush(50);
		h.element('confirmDialogConfirm').click();
		await h.flush(1100);
		expect(h.rows()).toHaveLength(1);
		expect(h.posts().at(-1).customCodes).toEqual([entry('second', { id: addedId, name: '<b>effect name</b>' })]);
	});

	it('flushes on blur and waits until composition ends before saving', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.editor().dispatchEvent(new h.window.CompositionEvent('compositionstart'));
		h.input('中文', 0, 'code', true);
		await h.flush(2000);
		expect(h.posts()).toEqual([]);
		h.editor().dispatchEvent(new h.window.CompositionEvent('compositionend'));
		await h.flush(999);
		expect(h.posts()).toEqual([]);
		h.editor().dispatchEvent(new h.window.FocusEvent('blur'));
		await h.flush();
		expect(h.posts()).toEqual([{ customCodes: [entry('中文')] }]);
	});

	it('keeps focus, code and selection when language labels refresh', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.summary().click();
		h.input('edited');
		const input = h.editor();
		input.focus();
		input.setSelectionRange(1, 4);
		h.api.t = (key) => 'translated-' + key;
		h.api.refreshSettingsLanguage();
		expect(h.editor()).toBe(input);
		expect(h.document.activeElement).toBe(input);
		expect(input.value).toBe('edited');
		expect(input.selectionStart).toBe(1);
		expect(input.selectionEnd).toBe(4);
		expect(input.getAttribute('aria-label')).toBe('translated-customCodeEditorLabel My effect');
		expect(h.name().placeholder).toBe('translated-customCodeNamePlaceholder');
	});

	it('closes Done after flushing pending edits when only current password was autofilled', async () => {
		const h = harness({ customCodes: [entry('original')] });
		h.element('settingsCurrentPassword').value = 'Autofilled-current-password';
		await h.api.loadCustomCode();
		h.input('<style>body{color:red}</style>');
		h.element('settingsModal').querySelector('.settings-modal-actions [data-dialog-dismiss]').click();
		await h.flush(600);
		expect(h.element('confirmDialogModal')).toBeNull();
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.posts()).toEqual([{ customCodes: [entry('<style>body{color:red}</style>')] }]);
	});

	it.each(['settingsNewPassword', 'settingsConfirmPassword'])('protects an unfinished %s after autosaving code', async (field) => {
		const h = harness({ customCodes: [entry('original')] });
		h.element(field).value = 'Unsubmitted-new-password';
		await h.api.loadCustomCode();
		h.input('saved');
		h.close();
		await h.flush(50);
		expect(h.element('confirmDialogTitle').textContent).toBe(LOCALES.en.dialogDiscardTitle);
		h.element('confirmDialogCancel').click();
		await h.flush(350);
		expect(h.element(field).value).toBe('Unsubmitted-new-password');
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
		expect(h.posts()).toEqual([{ customCodes: [entry('saved')] }]);
	});

	it.each(['network', 'server'])(
		'retains failed drafts without automatic retry loops and supports retry after %s failure',
		async (failure) => {
			let fail = true;
			const h = harness({
				fetchImpl: (_url, options) => {
					if (!options) {
						return reply({ customCodes: [entry('original')] });
					}
					if (fail && failure === 'network') {
						throw new Error('Connection lost');
					}
					return reply({ success: !fail }, !fail);
				},
			});
			await h.api.loadCustomCode();
			h.input('draft');
			await h.flush(5000);
			expect(h.editor().value).toBe('draft');
			expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeSaveFailed);
			expect(h.element('settingsCustomCodeRetry').hidden).toBe(false);
			expect(h.api.hasUnsavedSettingsChanges()).toBe(true);
			expect(h.posts()).toHaveLength(1);
			fail = false;
			await h.api.retryCustomCodeSave();
			expect(h.posts()).toEqual([{ customCodes: [entry('draft')] }, { customCodes: [entry('draft')] }]);
			expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
			expect(h.element('settingsCustomCodeRetry').hidden).toBe(true);
		},
	);

	it('does not replace local edits with a stale refresh response', async () => {
		const refresh = deferred();
		let attempts = 0;
		const h = harness({ fetchImpl: () => (++attempts === 1 ? reply({ customCodes: [entry('original')] }) : refresh.promise) });
		await h.api.loadCustomCode();
		const loading = h.api.loadCustomCode();
		h.input('new draft');
		refresh.resolve(reply({ customCodes: [entry('remote change')] }));
		await loading;
		expect(h.editor().value).toBe('new draft');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(true);
		expect(h.posts()).toEqual([]);
	});

	it('saves the latest code and switch after an earlier request finishes', async () => {
		const first = deferred();
		let saves = 0;
		const h = harness({
			fetchImpl: (_url, options) =>
				!options ? reply({ customCodes: [entry('original')] }) : ++saves === 1 ? first.promise : reply({ success: true }),
		});
		await h.api.loadCustomCode();
		h.input('submitted');
		h.editor().dispatchEvent(new h.window.FocusEvent('blur'));
		await h.flush();
		h.input('new draft');
		h.toggle().click();
		first.resolve(reply({ success: true }));
		await h.flush(1099);
		expect(h.posts()).toEqual([{ customCodes: [entry('submitted')] }]);
		await h.flush(1);
		expect(h.posts()).toEqual([{ customCodes: [entry('submitted')] }, { customCodes: [entry('new draft', { enabled: false })] }]);
		expect(h.editor().value).toBe('new draft');
		expect(h.toggle().checked).toBe(false);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('coalesces rapid switches into one throttled write using the latest draft', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.toggle().click();
		await h.flush();
		h.toggle().click();
		await h.flush(400);
		h.toggle().click();
		h.input('latest');
		await h.flush(999);
		expect(h.posts()).toHaveLength(1);
		await h.flush(1);
		expect(h.posts()).toEqual([
			{ customCodes: [entry('original', { enabled: false })] },
			{ customCodes: [entry('latest', { enabled: false })] },
		]);
	});

	it('leaves a full write interval after a slow request finishes', async () => {
		const first = deferred();
		let saves = 0;
		const h = harness({
			fetchImpl: (_url, options) =>
				!options ? reply({ customCodes: [entry('original')] }) : ++saves === 1 ? first.promise : reply({ success: true }),
		});
		await h.api.loadCustomCode();
		h.toggle().click();
		await h.flush(2000);
		h.input('latest');
		first.resolve(reply({ success: true }));
		await h.flush(1099);
		expect(h.posts()).toHaveLength(1);
		await h.flush(1);
		expect(h.posts().at(-1)).toEqual({ customCodes: [entry('latest', { enabled: false })] });
	});

	it('validates aggregate code size including disabled entries', async () => {
		const h = harness({ customCodes: [entry('x'.repeat(MAX_CUSTOM_CODE_LENGTH), { enabled: false }), entry('', { id: 'other' })] });
		await h.api.loadCustomCode();
		h.input('x', 1);
		await h.flush(2000);
		expect(h.editor(1).getAttribute('aria-invalid')).toBe('true');
		expect(h.element('settingsCustomCodeResult').textContent).toContain(String(MAX_CUSTOM_CODE_LENGTH));
		expect(h.posts()).toEqual([]);
		expect(h.api.hasUnsavedSettingsChanges()).toBe(true);
	});

	it('limits the number of entries without losing existing entries', async () => {
		const h = harness({ customCodes: Array.from({ length: MAX_CUSTOM_CODE_ITEMS }, (_, i) => entry('', { id: 'code-' + i })) });
		await h.api.loadCustomCode();
		expect(h.element('settingsCustomCodeAdd').disabled).toBe(true);
		h.api.addCustomCode();
		expect(h.rows()).toHaveLength(MAX_CUSTOM_CODE_ITEMS);
		expect(h.posts()).toEqual([]);
	});

	it('serializes custom code writes with other preference saves', async () => {
		const first = deferred();
		let saves = 0;
		const h = harness({
			fetchImpl: (_url, options) =>
				!options ? reply({ customCodes: [entry('original')] }) : ++saves === 1 ? first.promise : reply({ success: true }),
		});
		await h.api.loadCustomCode();
		h.input('custom code');
		const codeSaving = h.api.saveCustomCode();
		await h.flush();
		h.element('settingsDefaultExportFormat').value = 'csv';
		const formatSaving = h.api.saveDefaultExportFormat();
		await h.flush();
		expect(h.posts()).toEqual([{ customCodes: [entry('custom code')] }]);
		first.resolve(reply({ success: true }));
		await h.flush(1100);
		await Promise.all([codeSaving, formatSaving]);
		expect(h.posts()).toEqual([{ customCodes: [entry('custom code')] }, { defaultExportFormat: 'csv' }]);
	});

	it('asks before discarding only when automatic saving failed', async () => {
		const h = harness({
			fetchImpl: (_url, options) => (options ? reply({ success: false }, false) : reply({ customCodes: [entry('original')] })),
		});
		await h.api.loadCustomCode();
		h.input('draft');
		h.close();
		await h.flush(50);
		expect(h.element('confirmDialogTitle').textContent).toBe(LOCALES.en.dialogDiscardTitle);
		h.element('confirmDialogCancel').click();
		await h.flush(350);
		expect(h.editor().value).toBe('draft');
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
		h.close();
		await h.flush(50);
		h.element('confirmDialogConfirm').click();
		await h.flush(600);
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.editor().value).toBe('original');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
		expect(h.posts()).toEqual([{ customCodes: [entry('draft')] }]);
	});

	it('waits for the latest pending draft when closing during an earlier save', async () => {
		const first = deferred();
		const second = deferred();
		let saves = 0;
		const h = harness({
			fetchImpl: (_url, options) =>
				!options ? reply({ customCodes: [entry('original')] }) : ++saves === 1 ? first.promise : second.promise,
		});
		await h.api.loadCustomCode();
		h.input('submitted');
		h.close();
		await h.flush(50);
		h.input('new draft');
		first.resolve(reply({ success: true }));
		await h.flush(1100);
		expect(h.element('confirmDialogModal')).toBeNull();
		expect(h.element('settingsModal').classList.contains('show')).toBe(true);
		expect(h.posts()).toEqual([{ customCodes: [entry('submitted')] }, { customCodes: [entry('new draft')] }]);
		second.resolve(reply({ success: true }));
		await h.flush(600);
		expect(h.element('settingsModal').style.display).toBe('none');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(false);
	});

	it('automatic reload waits for throttled drafts and preserves the recovery URL when saving fails', async () => {
		let fail = false;
		const h = harness({
			fetchImpl: (_url, options) => (!options ? reply({ customCodes: [entry('original')] }) : reply({ success: !fail }, !fail)),
		});
		await h.api.loadCustomCode();
		h.toggle().click();
		await h.flush();
		h.input('latest');
		fail = true;
		await h.flush(6000);
		expect(h.navigate).not.toHaveBeenCalled();
		expect(h.window.location.search).toContain('disableCustomCode=1');
		expect(h.api.hasUnsavedSettingsChanges()).toBe(true);
	});

	it('cancels a pending reload while typing and applies the final saved draft once', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.input('first');
		await h.flush(2800);
		h.input('final');
		await h.flush(1000);
		expect(h.posts().map((post) => post.customCodes[0].code)).toEqual(['first', 'final']);
		expect(h.navigate).not.toHaveBeenCalled();
		await h.flush(1999);
		expect(h.navigate).not.toHaveBeenCalled();
		await h.flush(1);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('does not reload for initial reads, tab visits, names, empty additions or disabled code edits', async () => {
		const h = harness({ customCodes: [entry('original'), entry('disabled', { id: 'off', enabled: false })] });
		h.api.switchSettingsTab('custom-code');
		await h.flush(4000);
		h.api.switchSettingsTab('security');
		h.api.switchSettingsTab('custom-code');
		await h.flush(4000);
		h.input('renamed', 0, 'name');
		await h.flush(4000);
		expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeSavedOnly);
		h.api.addCustomCode();
		await h.flush(4000);
		h.input('new disabled content', 1);
		await h.flush(4000);
		expect(h.posts()).toHaveLength(3);
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it('cancels application when the enabled code is restored to its original value', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.toggle().click();
		await h.flush(1200);
		h.toggle().click();
		await h.flush(5000);
		expect(h.posts()).toHaveLength(2);
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it('waits through composition started after a successful save', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.input('saved');
		await h.flush(1000);
		h.editor().dispatchEvent(new h.window.CompositionEvent('compositionstart'));
		h.input('中', 0, 'code', true);
		await h.flush(5000);
		expect(h.navigate).not.toHaveBeenCalled();
		expect(h.posts()).toHaveLength(1);
		h.editor().value = '中文';
		h.editor().dispatchEvent(new h.window.CompositionEvent('compositionend'));
		await h.flush(3000);
		expect(h.posts().at(-1).customCodes[0].code).toBe('中文');
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('defers automatic application for password drafts without flushing or discarding them', async () => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.element('settingsNewPassword').value = 'unfinished password';
		h.input('saved');
		await h.flush(5000);
		expect(h.navigate).not.toHaveBeenCalled();
		expect(h.element('settingsNewPassword').value).toBe('unfinished password');
		expect(h.element('settingsCustomCodeResult').textContent).toBe(LOCALES.en.customCodeSavedPending);
		expect(h.posts()).toHaveLength(1);
		h.element('settingsNewPassword').value = '';
		h.element('settingsNewPassword').dispatchEvent(new h.window.InputEvent('input', { bubbles: true }));
		await h.flush(1999);
		expect(h.navigate).not.toHaveBeenCalled();
		await h.flush(1);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it.each(['language', 'format', 'numeric'])('waits for an in-flight %s preference save', async (preference) => {
		const pending = deferred();
		const h = harness({
			fetchImpl: (_url, options) => {
				if (!options) {
					return reply({ customCodes: [entry('original')] });
				}
				return JSON.parse(options.body).customCodes ? reply({ success: true }) : pending.promise;
			},
		});
		await h.api.loadCustomCode();
		h.input('saved');
		await h.flush(1000);
		let saving;
		if (preference === 'language') {
			saving = h.api.saveLanguagePreference('en');
		}
		if (preference === 'format') {
			h.element('settingsDefaultExportFormat').value = 'csv';
			saving = h.api.saveDefaultExportFormat();
		}
		if (preference === 'numeric') {
			h.element('settingsMaxBackups').value = '24';
			h.api.scheduleNumericPreferenceSave('maxBackups');
			saving = h.api.saveMaxBackups();
		}
		await h.flush(5000);
		expect(h.navigate).not.toHaveBeenCalled();
		pending.resolve(reply({ success: true }));
		await saving;
		await h.flush(500);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it.each(['confirm', 'form'])('defers while another %s modal is open, without submitting it', async (kind) => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.input('saved');
		await h.flush(1000);
		if (kind === 'confirm') {
			h.api.showConfirmDialog({ title: 'Unsaved form', message: 'Continue editing?' });
		} else {
			h.api.showModal('secretModal');
		}
		await h.flush(4000);
		expect(h.navigate).not.toHaveBeenCalled();
		expect(h.posts()).toHaveLength(1);
		if (kind === 'confirm') {
			h.element('confirmDialogCancel').click();
		} else {
			h.api.hideModal('secretModal');
		}
		await h.flush(500);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('restores the open editor, selection and scroll once without storing content or reloading again', async () => {
		const h = harness({ customCodes: [entry('original')] });
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		h.summary().click();
		h.editor().focus();
		h.input('new saved code');
		h.editor().setSelectionRange(2, 8, 'backward');
		h.element('settingsModal').querySelector('.settings-content').scrollTop = 123;
		await h.flush(3000);
		const stored = h.window.sessionStorage.getItem('custom-code-editor-position');
		expect(stored).not.toContain('new saved code');
		expect(stored).not.toContain('original');
		expect(JSON.parse(stored)).toMatchObject({
			expandedId: 'test-code',
			scrollTop: 123,
			focus: { id: 'test-code', field: 'code', start: 2, end: 8, direction: 'backward' },
		});
		const restored = harness({ customCodes: h.settings.customCodes, restorePosition: stored, openSettings: false });
		await restored.ready;
		expect(restored.window.sessionStorage.getItem('custom-code-editor-position')).toBeNull();
		expect(restored.element('settingsModal').style.display).toBe('flex');
		expect(restored.body().hidden).toBe(false);
		expect(restored.document.activeElement).toBe(restored.editor());
		expect(restored.editor().selectionStart).toBe(2);
		expect(restored.editor().selectionEnd).toBe(8);
		expect(restored.editor().selectionDirection).toBe('backward');
		expect(restored.element('settingsModal').querySelector('.settings-content').scrollTop).toBe(123);
		restored.api.hideSettingsModal();
		await restored.api.initCustomCodeAutoReload();
		await restored.flush(4000);
		expect(restored.element('settingsModal').style.display).toBe('none');
		expect(restored.posts()).toEqual([]);
		expect(restored.navigate).not.toHaveBeenCalled();
	});

	it('does not reopen settings after applying with settings closed', async () => {
		const h = harness({ customCodes: [entry('original')] });
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		h.input('saved');
		h.element('settingsModal').querySelector('.settings-modal-actions [data-dialog-dismiss]').click();
		await h.flush(3000);
		expect(h.navigate).toHaveBeenCalledTimes(1);
		expect(h.window.sessionStorage.getItem('custom-code-editor-position')).toBeNull();
	});

	it.each(['expired', 'invalid', 'future'])('consumes a %s restore marker without opening settings', async (kind) => {
		const marker =
			kind === 'invalid'
				? '{bad json'
				: JSON.stringify({
						createdAt: Date.now() + (kind === 'expired' ? -60001 : 60000),
						expandedId: 'test-code',
					});
		const h = harness({ customCodes: [entry('original')], restorePosition: marker, openSettings: false });
		await h.ready;
		expect(h.window.sessionStorage.getItem('custom-code-editor-position')).toBeNull();
		expect(h.element('settingsModal').style.display).not.toBe('flex');
		expect(h.authenticatedFetch).not.toHaveBeenCalled();
	});

	it('applies saved code even when session storage is unavailable', async () => {
		const h = harness({ customCodes: [entry('original')] });
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		vi.spyOn(h.window.sessionStorage, 'setItem').mockImplementation(() => {
			throw new Error('Storage blocked');
		});
		h.input('saved');
		await h.flush(3000);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('does not let an old save rearm automatic reload after its drafts were discarded', async () => {
		const pending = deferred();
		const h = harness({
			fetchImpl: (_url, options) => (options ? pending.promise : reply({ customCodes: [entry('original')] })),
		});
		await h.api.loadCustomCode();
		h.input('discarded draft');
		await h.flush(1000);
		h.api.discardSettingsDrafts();
		pending.resolve(reply({ success: true }));
		await h.flush();
		h.document.dispatchEvent(new h.window.PointerEvent('pointerdown', { bubbles: true }));
		await h.flush(4000);
		expect(h.editor().value).toBe('original');
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it('keeps autosaving code while another field is composing and waits to reload until composition ends', async () => {
		const pending = deferred();
		let saves = 0;
		const h = harness({
			fetchImpl: (_url, options) =>
				!options ? reply({ customCodes: [entry('original')] }) : ++saves === 1 ? pending.promise : reply({ success: true }),
		});
		await h.api.loadCustomCode();
		h.summary().click();
		h.editor().focus();
		h.input('first');
		await h.flush(1000);
		h.input('latest');
		const otherInput = h.element('settingsCurrentPassword');
		otherInput.focus();
		otherInput.dispatchEvent(new h.window.CompositionEvent('compositionstart', { bubbles: true }));
		pending.resolve(reply({ success: true }));
		await h.flush(5000);
		expect(h.posts().map((post) => post.customCodes[0].code)).toEqual(['first', 'latest']);
		expect(h.navigate).not.toHaveBeenCalled();
		otherInput.dispatchEvent(new h.window.CompositionEvent('compositionend', { bubbles: true }));
		await h.flush(2000);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('waits until the page becomes visible before applying saved code', async () => {
		const h = harness({ customCodes: [entry('original')] });
		const hidden = vi.spyOn(h.document, 'hidden', 'get').mockReturnValue(true);
		await h.api.loadCustomCode();
		h.input('saved');
		await h.flush(5000);
		expect(h.navigate).not.toHaveBeenCalled();
		hidden.mockReturnValue(false);
		h.document.dispatchEvent(new h.window.Event('visibilitychange'));
		await h.flush(2000);
		expect(h.navigate).toHaveBeenCalledTimes(1);
	});

	it('does not restore an editor when the settings request fails', async () => {
		const h = harness({
			restorePosition: JSON.stringify({ createdAt: Date.now(), expandedId: 'test-code' }),
			openSettings: false,
			fetchImpl: () => reply({ message: 'Unauthorized' }, false),
		});
		await h.ready;
		expect(h.element('settingsModal').style.display).not.toBe('flex');
		expect(h.window.sessionStorage.getItem('custom-code-editor-position')).toBeNull();
		expect(h.posts()).toEqual([]);
	});

	it('does not steal focus when another modal opens while restoring the editor', async () => {
		const pending = deferred();
		const h = harness({
			restorePosition: JSON.stringify({ createdAt: Date.now(), expandedId: 'test-code' }),
			openSettings: false,
			fetchImpl: () => pending.promise,
		});
		h.api.showModal('secretModal');
		h.element('secretName').focus();
		pending.resolve(reply({ customCodes: [entry('original')] }));
		await h.ready;
		expect(h.element('settingsModal').style.display).not.toBe('flex');
		expect(h.document.activeElement).toBe(h.element('secretName'));
		expect(h.posts()).toEqual([]);
	});

	it.each(['https://example.test/?view=grid#settings', 'https://example.test/?view=grid'])(
		'uses a real page reload when the ordinary URL is %s', async (url) => {
			const h = harness({ customCodes: [entry('original')], url });
			await h.api.loadCustomCode();
			h.input('saved');
			await h.flush(5000);
			expect(h.reload).toHaveBeenCalledTimes(1);
			expect(h.navigate).not.toHaveBeenCalled();
			expect(h.window.location.href).toBe(url);
		},
	);

	it('waits a full second after the final input during a previous save and the write interval', async () => {
		const pending = deferred();
		let writes = 0;
		const h = harness({
			fetchImpl: (_url, options) => !options ? reply({ customCodes: [entry('original')] })
				: ++writes === 1 ? pending.promise : reply({ success: true }),
		});
		await h.api.loadCustomCode();
		h.input('first');
		await h.flush(1000);
		h.input('second');
		pending.resolve(reply({ success: true }));
		await h.flush(1000);
		h.input('still typing');
		await h.flush(100);
		expect(h.posts()).toHaveLength(1);
		await h.flush(899);
		expect(h.posts()).toHaveLength(1);
		await h.flush(1);
		expect(h.posts().at(-1).customCodes[0].code).toBe('still typing');
	});

	it('rechecks the input deadline after waiting behind another preference in the write queue', async () => {
		const pending = deferred();
		const h = harness({
			fetchImpl: (_url, options) => {
				if (!options) {return reply({ customCodes: [entry('original')] });}
				return JSON.parse(options.body).customCodes ? reply({ success: true }) : pending.promise;
			},
		});
		await h.api.loadCustomCode();
		h.element('settingsDefaultExportFormat').value = 'csv';
		const savingFormat = h.api.saveDefaultExportFormat();
		h.input('first');
		await h.flush(1900);
		h.input('latest');
		pending.resolve(reply({ success: true }));
		await savingFormat;
		await h.flush(900);
		h.input('still typing');
		await h.flush(999);
		expect(h.posts()).toEqual([{ defaultExportFormat: 'csv' }]);
		await h.flush(1);
		expect(h.posts().at(-1).customCodes[0].code).toBe('still typing');
	});

	it.each(['blur', 'toggle', 'done'])('lets %s flush an active debounce wait after the minimum write interval', async (action) => {
		const h = harness({ customCodes: [entry('original')] });
		await h.api.loadCustomCode();
		h.input('first');
		await h.flush(1000);
		h.input('second');
		await h.flush(1000);
		h.input('latest');
		await h.flush(200);
		expect(h.posts()).toHaveLength(1);
		if (action === 'blur') {h.editor().dispatchEvent(new h.window.FocusEvent('blur'));}
		if (action === 'toggle') {h.toggle().click();}
		if (action === 'done') {h.element('settingsModal').querySelector('.settings-modal-actions [data-dialog-dismiss]').click();}
		await h.flush();
		expect(h.posts()).toHaveLength(2);
		expect(h.posts().at(-1).customCodes[0].code).toBe('latest');
	});

	it.each(['code', 'name', 'none'])('restores textarea internal scroll when %s was focused', async (focus) => {
		const h = harness({ customCodes: [entry('original')] });
		h.api.switchSettingsTab('custom-code');
		await h.flush();
		h.summary().click();
		h.input('long line content\n'.repeat(100));
		if (focus === 'code') {h.editor().focus();}
		if (focus === 'name') {h.name().focus();}
		h.editor().scrollTop = 800;
		h.editor().scrollLeft = 40;
		await h.flush(3000);
		const stored = h.window.sessionStorage.getItem('custom-code-editor-position');
		expect(JSON.parse(stored).editorScroll).toEqual({ top: 800, left: 40 });
		const restored = harness({ customCodes: h.settings.customCodes, restorePosition: stored, openSettings: false });
		await restored.ready;
		expect(restored.editor().scrollTop).toBe(800);
		expect(restored.editor().scrollLeft).toBe(40);
	});

	it.each(['language', 'defaultExportFormat', 'jwtExpiryDays', 'maxBackups'].flatMap(key =>
		[[key, 'customCodes'], ['customCodes', key]]))('leaves a full shared write interval from %s to %s', async (firstKey, nextKey) => {
		const writes = [];
		const h = harness({
			fetchImpl: (_url, options) => {
				if (!options) {return reply({ customCodes: [entry('original')] });}
				writes.push({ at: Date.now(), key: Object.keys(JSON.parse(options.body))[0] });
				return reply({ success: true });
			},
		});
		await h.api.loadCustomCode();
		await saveSetting(h, firstKey);
		const nextSave = saveSetting(h, nextKey);
		await h.flush(1099);
		expect(writes.map(write => write.key)).toEqual([firstKey]);
		await h.flush(1);
		await nextSave;
		expect(writes.map(write => write.key)).toEqual([firstKey, nextKey]);
		expect(writes[1].at - writes[0].at).toBe(1100);
	});

	it.each([['customCodes', 'language'], ['language', 'customCodes']])(
		'starts the shared interval when a slow %s request completes before %s', async (firstKey, nextKey) => {
			const pending = deferred();
			const writes = [];
			const h = harness({
				fetchImpl: (_url, options) => {
					if (!options) {return reply({ customCodes: [entry('original')] });}
					writes.push({ at: Date.now(), key: Object.keys(JSON.parse(options.body))[0] });
					return writes.length === 1 ? pending.promise : reply({ success: true });
				},
			});
			await h.api.loadCustomCode();
			const firstSave = saveSetting(h, firstKey);
			await h.flush();
			expect(writes.map(write => write.key)).toEqual([firstKey]);
			const nextSave = saveSetting(h, nextKey);
			await h.flush(5000);
			expect(writes).toHaveLength(1);
			const completedAt = Date.now();
			pending.resolve(reply({ success: true }));
			await firstSave;
			await h.flush(1099);
			expect(writes).toHaveLength(1);
			await h.flush(1);
			await nextSave;
			expect(writes[1]).toEqual({ at: completedAt + 1100, key: nextKey });
		},
	);

	it.each(['network', 'server'].flatMap(failure =>
		[[failure, 'customCodes', 'language'], [failure, 'language', 'customCodes']]))(
		'leaves the shared interval after a %s failure of %s before saving %s', async (failure, firstKey, nextKey) => {
			const writes = [];
			const h = harness({
				fetchImpl: (_url, options) => {
					if (!options) {return reply({ customCodes: [entry('original')] });}
					writes.push({ at: Date.now(), key: Object.keys(JSON.parse(options.body))[0] });
					if (writes.length === 1) {
						if (failure === 'network') {throw new Error('Response lost');}
						return reply({ success: false }, false);
					}
					return reply({ success: true });
				},
			});
			await h.api.loadCustomCode();
			await saveSetting(h, firstKey);
			const nextSave = saveSetting(h, nextKey);
			await h.flush(1099);
			expect(writes).toHaveLength(1);
			await h.flush(1);
			await nextSave;
			expect(writes[1].key).toBe(nextKey);
			expect(writes[1].at - writes[0].at).toBe(1100);
		},
	);

	it.each(['typing', 'composing', 'discarded'])(
		'does not add a write interval when queued code is skipped because it is %s', async (reason) => {
			const writes = [];
			const h = harness({
				fetchImpl: (_url, options) => {
					if (!options) {return reply({ customCodes: [entry('original')] });}
					writes.push({ at: Date.now(), key: Object.keys(JSON.parse(options.body))[0] });
					return reply({ success: true });
				},
			});
			await h.api.loadCustomCode();
			await saveSetting(h, 'defaultExportFormat');
			void saveSetting(h, 'customCodes');
			await h.flush(900);
			if (reason === 'typing') {h.input('still typing');}
			if (reason === 'composing') {h.editor().dispatchEvent(new h.window.CompositionEvent('compositionstart'));}
			if (reason === 'discarded') {h.api.discardSettingsDrafts();}
			const languageSave = saveSetting(h, 'language');
			await h.flush(200);
			await languageSave;
			expect(writes.map(write => write.key)).toEqual(['defaultExportFormat', 'language']);
			expect(writes[1].at - writes[0].at).toBe(1100);
		},
	);
});
