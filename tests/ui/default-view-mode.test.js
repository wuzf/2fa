import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';

const html = await (await createMainPage()).text();
const windows = [];

afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function harness(values = new Map(), { storageBlocked = false } = {}) {
	const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	const document = window.document;
	document.write(html);
	const storage = {
		getItem(key) {
			if (storageBlocked) {
				throw new Error('Storage blocked');
			}
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			if (storageBlocked) {
				throw new Error('Storage blocked');
			}
			values.set(key, String(value));
		},
	};
	const render = vi.fn(async () => {});
	const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ maxBackups: 100 }) }));
	const context = createContext({
		document,
		navigator: { language: 'zh-CN' },
		localStorage: storage,
		renderFilteredSecrets: render,
		authenticatedFetch: fetch,
		getOTPAnimationMode: () => 'none',
		console: { log() {}, warn() {} },
	});
	runInContext(getI18nCode() + getSearchCode() + getSettingsCode(), context);
	runInContext('restoreSortPreference(); restoreGroupSortPreference(); restoreViewModePreference();', context);
	const select = document.getElementById('settingsDefaultViewMode');
	return {
		api: context,
		document,
		select,
		values,
		fetch,
		render,
		view: () => runInContext('currentViewMode', context),
		sort: () => runInContext('currentSortType', context),
		change(value) {
			select.value = value;
			return runInContext(
				`(function() { ${select.getAttribute('onchange')} }).call(document.getElementById('settingsDefaultViewMode'))`,
				context,
			);
		},
	};
}

describe('default view mode preference', () => {
	it.each([undefined, 'invalid', 'remember'])('preserves the last selection for an unset or unpinned default (%s)', async (value) => {
		const values = new Map([['2fa-view-mode', 'flat']]);
		if (value !== undefined) {
			values.set('2fa-default-view-mode', value);
		}
		const h = harness(values);
		await h.api.loadPreferences();
		expect(h.view()).toBe('flat');
		expect(h.select.value).toBe('remember');
		expect(h.document.querySelector('.settings-panel[data-panel="preferences"]').contains(h.select)).toBe(true);
		expect(h.document.getElementById(h.select.getAttribute('aria-labelledby')).textContent).toBe('默认显示方式');
	});

	it.each(['flat', 'grouped'])('applies a fixed %s view immediately and restores it after a temporary switch and reload', async (mode) => {
		const h = harness();
		await h.change(mode);
		expect(h.view()).toBe(mode);
		expect(h.render).toHaveBeenCalledOnce();
		expect(h.document.querySelector(`[data-view-mode="${mode}"]`).getAttribute('aria-pressed')).toBe('true');
		expect(h.values.get('2fa-default-view-mode')).toBe(mode);
		const temporaryMode = mode === 'flat' ? 'grouped' : 'flat';
		await h.api.selectViewMode(temporaryMode);
		await h.api.loadPreferences();
		expect(h.view()).toBe(temporaryMode);
		expect(h.select.value).toBe(mode);

		const reopened = harness(h.values);
		await reopened.api.loadPreferences();
		expect(reopened.view()).toBe(mode);
		expect(reopened.select.value).toBe(mode);
		expect(reopened.document.querySelector(`[data-view-mode="${mode}"]`).getAttribute('aria-pressed')).toBe('true');
	});

	it('remembers the current view when unpinning, including a fixed view restored on page load', async () => {
		const h = harness(
			new Map([
				['2fa-default-view-mode', 'flat'],
				['2fa-view-mode', 'grouped'],
			]),
		);
		await h.change('remember');
		expect(h.view()).toBe('flat');
		expect(h.values.get('2fa-view-mode')).toBe('flat');
		const reopened = harness(h.values);
		expect(reopened.view()).toBe('flat');
		await reopened.api.selectViewMode('grouped');
		expect(harness(h.values).view()).toBe('grouped');
	});

	it('keeps grouped and flat sorting independent when changing the default', async () => {
		const h = harness(
			new Map([
				['2fa-flat-sort-preference', 'name-desc'],
				['2fa-group-item-sort-preference', 'account-asc'],
				['2fa-group-sort-preference', 'name-desc'],
			]),
		);
		await h.change('flat');
		expect(h.sort()).toBe('name-desc');
		expect(h.document.querySelector('.group-sort-only').hidden).toBe(true);
		await h.change('grouped');
		expect(h.sort()).toBe('account-asc');
		expect(h.document.querySelector('.group-sort-only').hidden).toBe(false);
		expect(h.values.get('2fa-group-sort-preference')).toBe('name-desc');
		expect(h.values.get('2fa-flat-sort-preference')).toBe('name-desc');
	});

	it('keeps a selection made while server preferences are loading', async () => {
		const h = harness();
		let resolve;
		h.fetch.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const loading = h.api.loadPreferences();
		await h.change('flat');
		resolve({ ok: true, json: async () => ({ maxBackups: 100 }) });
		await loading;
		expect(h.select.value).toBe('flat');
		expect(h.view()).toBe('flat');
		expect(h.values.get('2fa-default-view-mode')).toBe('flat');
	});

	it('falls back safely when storage is blocked and still supports switching for the current session', async () => {
		const h = harness(new Map(), { storageBlocked: true });
		expect(h.view()).toBe('grouped');
		await h.change('flat');
		expect(h.view()).toBe('flat');
		expect(h.api.getDefaultViewModePreference()).toBe('flat');
	});
});
