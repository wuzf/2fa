import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getUICode } from '../../src/ui/scripts/ui.js';

const html = await (await createMainPage()).text();

function harness(language = 'zh-CN') {
	const window = new Window({ url: 'https://example.com', settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	window.localStorage.setItem('language', language);
	const context = createContext({
		window,
		document: window.document,
		navigator: { language: 'zh-CN', onLine: true },
		localStorage: window.localStorage,
		setInterval: vi.fn(),
		setTimeout: vi.fn((callback) => callback()),
		HTMLElement: window.HTMLElement,
		clearTimeout: vi.fn(),
		clearInterval: vi.fn(),
	});
	runInContext(getI18nCode() + getUtilsCode() + getStateCode() + getCoreCode(), context);
	context.renderSecrets = vi.fn(async () => {});
	context.applyTranslations();
	return { context, window, document: window.document };
}

describe('independent workspace language review', () => {
	it('preserves same-language feedback and prevents old toast animations from reviving after a language change', () => {
		const window = new Window({ url: 'https://example.com', settings: { disableJavaScriptEvaluation: true } });
		window.document.write(html);
		const timers = new Map();
		let timerId = 0;
		let now = 1000;
		const context = createContext({
			window,
			document: window.document,
			navigator: { language: 'zh-CN' },
			localStorage: window.localStorage,
			Date: { now: () => now },
			setTimeout: (callback, delay) => {
				timers.set(++timerId, { callback, delay });
				return timerId;
			},
			clearTimeout: (id) => timers.delete(id),
		});
		runInContext(getI18nCode() + getUtilsCode() + getStateCode() + getUICode(), context);
		const toast = window.document.getElementById('centerToast');
		const message = toast.querySelector('.toast-message');
		context.showCenterToast('✅', '语言偏好已保存');
		context.setLanguage('zh-CN');
		context.applyTranslations();
		expect(message.textContent).toBe('语言偏好已保存');
		expect(toast.classList.contains('show')).toBe(true);
		now += 200;
		context.showCenterToast('✅', '第二条反馈');
		const oldAnimation = [...timers.values()].find((timer) => timer.delay === 125).callback;
		context.setLanguage('en');
		expect(message.textContent).toBe('');
		expect(toast.classList.contains('show')).toBe(false);
		oldAnimation();
		expect(toast.classList.contains('show')).toBe(false);
		now += 200;
		context.showCenterToast('✅', 'Language preference saved');
		oldAnimation();
		context.setLanguage('en');
		expect(message.textContent).toBe('Language preference saved');
		expect(toast.classList.contains('show')).toBe(true);
	});

	it.each(['zh-CN', 'zh-TW', 'en'])('resolves every main-page translation binding in %s without changing form values', (language) => {
		const { document, context } = harness();
		const literal = '<img src=x onerror=alert(1)> & 工作';
		document.getElementById('secretName').value = literal;
		document.getElementById('importText').value = literal;
		document.getElementById('scanCountNum').textContent = '4';
		document.getElementById('exportCount').textContent = '2';
		context.setLanguage(language);
		expect(document.documentElement.lang).toBe(language);
		expect(document.title).toBe(LOCALES[language].appTitle);
		expect(document.querySelector('link[rel="manifest"]').getAttribute('href')).toBe(`/manifest.json?lang=${language}`);
		expect(document.getElementById('secretName').value).toBe(literal);
		expect(document.getElementById('importText').value).toBe(literal);
		expect(document.getElementById('scanCountNum').textContent).toBe('4');
		expect(document.getElementById('exportCount').textContent).toBe('2');
		for (const element of document.querySelectorAll('*')) {
			for (const attribute of element.attributes) {
				if (!/^data-i18n(?:-(?:html|title|aria-label|placeholder|content|alt))?$/.test(attribute.name)) {
					continue;
				}
				expect(LOCALES[language][attribute.value], `${element.tagName}#${element.id} ${attribute.name}=${attribute.value}`).toBeTypeOf(
					'string',
				);
			}
		}
	});

	it('has no Chinese UI copy left in the English main-page text, placeholders, tooltips or accessibility labels', () => {
		const { document } = harness('en');
		const untranslated = [];
		for (const element of document.querySelectorAll('body *')) {
			if (['SCRIPT', 'STYLE'].includes(element.tagName) || element.closest('#settingsLanguage')) {
				continue;
			}
			const text = [...element.childNodes]
				.filter((node) => node.nodeType === 3)
				.map((node) => node.textContent)
				.join('')
				.trim();
			if (/[\u3400-\u9fff]/.test(text)) {
				untranslated.push(`${element.tagName}#${element.id}: ${text}`);
			}
			for (const attribute of ['title', 'placeholder', 'aria-label', 'alt']) {
				if (/[\u3400-\u9fff]/.test(element.getAttribute(attribute) || '')) {
					untranslated.push(`${element.id}[${attribute}]`);
				}
			}
		}
		expect(untranslated).toEqual([]);
	});

	it('updates an already displayed read failure when switching languages', () => {
		const { context, document } = harness();
		context.showSecretsReadFailure('coreOfflineRead');
		context.setLanguage('en');
		const emptyState = document.getElementById('emptyState');
		expect(emptyState.querySelector('h3').textContent).toBe(LOCALES.en.coreReadTitle);
		expect(emptyState.querySelector('p').textContent).toBe(LOCALES.en.coreOfflineRead);
		expect(emptyState.querySelector('button').textContent).toBe(LOCALES.en.retry);
		expect(emptyState.style.display).toBe('block');
	});

	it('keeps a delete confirmation open, updates its language and renders the account name as plain text', async () => {
		const { context, document, window } = harness();
		runInContext('secrets = [{ id: "account", name: "<img src=x onerror=alert(1)>" }];', context);
		const deleting = context.deleteSecret('account');
		context.setLanguage('en');
		expect(document.getElementById('confirmDialogTitle').textContent).toBe(LOCALES.en.deleteSecretTitle);
		expect(document.getElementById('confirmDialogMessage').textContent).toContain('<img src=x onerror=alert(1)>');
		expect(document.getElementById('confirmDialogMessage').querySelector('img')).toBeNull();
		expect(document.getElementById('confirmDialogConfirm').textContent).toBe(LOCALES.en.delete);
		document.getElementById('confirmDialogCancel').dispatchEvent(new window.Event('click'));
		await deleting;
	});

	it('uses the selected language for dates and preserves all dictionary placeholders', () => {
		const { context } = harness();
		const date = new Date('2026-01-05T13:04:05Z');
		const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
		for (const language of ['zh-CN', 'zh-TW', 'en']) {
			context.setLanguage(language);
			expect(context.formatI18nDate(date.toISOString())).toBe(date.toLocaleString(language === 'en' ? 'en-US' : language));
			expect(Object.keys(LOCALES[language]).sort()).toEqual(Object.keys(LOCALES['zh-CN']).sort());
			for (const key of Object.keys(LOCALES['zh-CN'])) {
				expect(placeholders(LOCALES[language][key]), `${language}.${key}`).toEqual(placeholders(LOCALES['zh-CN'][key]));
			}
		}
	});
});
