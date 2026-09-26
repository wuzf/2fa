// @vitest-environment happy-dom
import { createContext, runInContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getScripts } from '../../src/ui/scripts/index.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const html = await (await createMainPage({ lazyLoad: false })).text();
const script = getScripts();
function harness(language = 'en') {
	localStorage.setItem('language', language);
	const context = createContext({ document, window, localStorage, navigator: { language: 'zh-CN' }, console });
	runInContext(getI18nCode(), context);
	context.applyTranslations();
	return context;
}
beforeEach(() => {
	localStorage.clear();
	document.documentElement.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
});

describe('all workspace panels and translation contracts', () => {
	it('defines every literal runtime and markup key in each language with matching parameters', () => {
		const keys = new Set([...script.matchAll(/\bt\(['"]([\w-]+)['"]/g)].map((m) => m[1]));
		for (const el of document.querySelectorAll('*')) {
			for (const attr of el.attributes) {
				if (/^data-i18n(?:-html|-placeholder|-title|-aria-label|-alt|-content)?$/.test(attr.name)) {
					keys.add(attr.value);
				}
			}
		}
		const placeholders = (value) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
		for (const key of keys) {
			for (const language of Object.keys(LOCALES)) {
				expect(LOCALES[language][key], `${language}:${key}`).toBeTypeOf('string');
				expect(placeholders(LOCALES[language][key]), `${language}:${key}`).toEqual(placeholders(LOCALES['zh-CN'][key]));
			}
		}
		for (const language of Object.keys(LOCALES)) {
			expect(Object.keys(LOCALES[language]).sort()).toEqual(Object.keys(LOCALES['zh-CN']).sort());
		}
	});
	it('renders every static dialog and accessibility attribute in English without leftover Chinese', () => {
		harness('en');
		expect(document.querySelectorAll('[role="dialog"]').length).toBe(24);
		const failures = [];
		const walker = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			if (node.parentElement.closest('script,style,#settingsLanguage')) {
				continue;
			}
			if (/[\u3400-\u9fff]/.test(node.textContent)) {
				failures.push({ id: node.parentElement.id, text: node.textContent.trim() });
			}
		}
		for (const element of document.querySelectorAll('[title],[placeholder],[aria-label],[alt]')) {
			for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
				if (/[\u3400-\u9fff]/.test(element.getAttribute(attr) || '')) {
					failures.push({ id: element.id, attr });
				}
			}
		}
		expect(failures).toEqual([]);
		expect(document.title).toBe(LOCALES.en.appTitle);
		expect(document.querySelector('meta[name="description"]').content).toBe(LOCALES.en.pageDescription);
		expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.json?lang=en');
	});
	it('preserves form drafts and all live count values across three languages', () => {
		const app = harness('zh-CN');
		for (const id of ['scanCountNum', 'exportCount', 'freeotpExportCount', 'totpAuthExportCount']) {
			document.getElementById(id).textContent = '7';
		}
		const input = document.getElementById('secretName');
		input.value = 'User-provided 中文 <text>';
		const status = document.getElementById('statValid');
		app.setTranslatedText(status, 'transferValidCount', { count: 13 });
		for (const language of ['en', 'zh-TW', 'zh-CN']) {
			app.setLanguage(language);
			expect(document.documentElement.lang).toBe(language);
			expect(input.value).toBe('User-provided 中文 <text>');
			for (const id of ['scanCountNum', 'exportCount', 'freeotpExportCount', 'totpAuthExportCount']) {
				expect(document.getElementById(id).textContent).toBe('7');
			}
			expect(status.textContent).toBe(app.t('transferValidCount', { count: 13 }));
			expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.json?lang=' + language);
		}
	});
	it('translates a supplied root element and rejects invalid stored locale names', () => {
		const app = harness('constructor');
		expect(app.getLanguagePreference()).toBe('auto');
		app.setLanguage('en');
		const button = document.createElement('button');
		button.setAttribute('data-i18n', 'save');
		app.applyTranslations(button);
		expect(button.textContent).toBe('Save');
	});
});
