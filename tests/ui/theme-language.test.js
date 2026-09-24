// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';

const html = await (await createMainPage()).text();
const themeOptions = html.match(/<div class="theme-options">[\s\S]*?<\/div>/)[0];

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('theme option translations', () => {
	it('preserves the theme icons and selected radio when translating and changing language', () => {
		document.body.innerHTML = themeOptions;
		const labels = Array.from(document.querySelectorAll('.theme-option-label'));
		const icons = labels.map((label) => label.querySelector('svg'));
		expect(icons.every(Boolean)).toBe(true);
		const darkRadio = document.querySelector('input[value="dark"]');
		darkRadio.checked = true;
		const context = createContext({ document, localStorage, navigator: { language: 'zh-CN' } });
		runInContext(getI18nCode(), context);

		for (const [language, expectedLabels] of [
			['zh-CN', ['浅色模式', '深色模式', '跟随系统']],
			['en', ['Light Mode', 'Dark Mode', 'System']],
			['zh-TW', ['淺色模式', '深色模式', '跟隨系統']],
		]) {
			context.setLanguage(language);
			for (const [index, label] of labels.entries()) {
				expect(label.querySelector('svg')).toBe(icons[index]);
				expect(label.textContent.trim()).toBe(expectedLabels[index]);
			}
			expect(darkRadio.checked).toBe(true);
		}
	});
});
