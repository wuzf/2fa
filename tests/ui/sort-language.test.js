// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';

const html = await (await createMainPage()).text();

function createHarness(viewMode = 'grouped') {
	document.body.innerHTML = html.match(/<details\b[^>]*id="sortDropdown"[\s\S]*?<\/details>/)[0];
	localStorage.setItem('language', 'en');
	localStorage.setItem('2fa-view-mode', viewMode);
	localStorage.setItem('2fa-flat-sort-preference', 'name-desc');
	localStorage.setItem('2fa-group-item-sort-preference', 'account-asc');
	const context = createContext({
		document,
		localStorage,
		navigator: { language: 'zh-CN' },
		renderFilteredSecrets: async () => {},
		console: { log() {}, warn() {} },
	});
	runInContext(getI18nCode() + getSearchCode(), context);
	context.restoreSortPreference();
	context.restoreViewModePreference();
	return { api: context, label: document.getElementById('sortModeLabel') };
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('sort titles in the selected language', () => {
	it('keeps the restored flat view title and item order when translations refresh', () => {
		const { api, label } = createHarness('flat');
		for (const [language, expectedTitle] of [
			['en', 'List Sort'],
			['zh-TW', '列表排序'],
			['zh-CN', '列表排序'],
		]) {
			api.setLanguage(language);
			expect(label.textContent).toBe(expectedTitle);
			expect(runInContext('currentViewMode', api)).toBe('flat');
			expect(runInContext('currentSortType', api)).toBe('name-desc');
		}
	});

	it('updates the translated title on every view-mode change and subsequent refresh', async () => {
		const { api, label } = createHarness();
		for (const [language, groupedTitle, flatTitle] of [
			['en', 'Sort Within Group', 'List Sort'],
			['zh-TW', '組內排序', '列表排序'],
			['zh-CN', '组内排序', '列表排序'],
		]) {
			api.setLanguage(language);
			await api.selectViewMode('flat');
			expect(label.textContent).toBe(flatTitle);
			api.applyTranslations();
			expect(label.textContent).toBe(flatTitle);
			await api.selectViewMode('grouped');
			expect(label.textContent).toBe(groupedTitle);
			api.applyTranslations();
			expect(label.textContent).toBe(groupedTitle);
			expect(runInContext('currentSortType', api)).toBe('account-asc');
		}
	});
});
