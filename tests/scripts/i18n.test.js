import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';

function createI18nHarness({ navLang = 'zh-CN', savedLang = null } = {}) {
	const elements = [];
	const listeners = {};
	const storage = {};
	if (savedLang) {
		storage.language = savedLang;
	}

	const document = {
		documentElement: {
			setAttribute: (k, v) => {
				document.documentElement[k] = v;
			},
			lang: 'zh-CN',
		},
		title: '2FA - 密钥管理器',
		querySelectorAll: (selector) => {
			if (selector === '[data-i18n]') {
				return elements.filter((el) => el.hasAttribute('data-i18n'));
			}
			if (selector === '[data-i18n-placeholder]') {
				return elements.filter((el) => el.hasAttribute('data-i18n-placeholder'));
			}
			if (selector === '[data-i18n-title]') {
				return elements.filter((el) => el.hasAttribute('data-i18n-title'));
			}
			if (selector === '[data-i18n-aria-label]') {
				return elements.filter((el) => el.hasAttribute('data-i18n-aria-label'));
			}
			return [];
		},
		getElementById: () => null,
	};

	const context = createContext({
		document,
		window: {
			addEventListener: (event, handler) => {
				listeners[event] = handler;
			},
		},
		navigator: {
			language: navLang,
			languages: [navLang],
		},
		localStorage: {
			getItem: (key) => storage[key] || null,
			setItem: (key, val) => {
				storage[key] = String(val);
			},
		},
		console: { log: () => {}, warn: () => {}, error: () => {} },
		Intl,
	});

	runInContext(getI18nCode(), context);

	return {
		context,
		storage,
		document,
		addElement: (attrs = {}) => {
			const el = {
				attributes: { ...attrs },
				textContent: '',
				placeholder: '',
				title: '',
				hasAttribute: (name) => name in el.attributes,
				getAttribute: (name) => el.attributes[name] || null,
				setAttribute: (name, val) => {
					el.attributes[name] = val;
				},
			};
			elements.push(el);
			return el;
		},
	};
}

describe('i18n locale definitions', () => {
	it('exports zh-CN, zh-TW, and en locales with common keys', () => {
		expect(LOCALES).toHaveProperty('zh-CN');
		expect(LOCALES).toHaveProperty('zh-TW');
		expect(LOCALES).toHaveProperty('en');

		const commonKeys = ['appTitle', 'emptyTitle', 'save', 'cancel', 'settingsTitle', 'setupHeaderTitle'];
		for (const key of commonKeys) {
			expect(LOCALES['zh-CN'][key]).toBeDefined();
			expect(LOCALES['zh-TW'][key]).toBeDefined();
			expect(LOCALES.en[key]).toBeDefined();
		}
	});

	it('uses authentic Traditional Chinese terminology in zh-TW', () => {
		expect(LOCALES['zh-TW'].appTitle).toContain('金鑰');
		expect(LOCALES['zh-TW'].settingsTabPreferences).toBe('偏好設定');
		expect(LOCALES['zh-TW'].digitsSix).toBe('6位 (預設)');
	});

	it('uses correct English terms in en', () => {
		expect(LOCALES.en.appTitle).toBe('2FA - Authenticator');
		expect(LOCALES.en.settingsTabPreferences).toBe('Preferences');
		expect(LOCALES.en.digitsSix).toBe('6 digits (Default)');
	});
});

describe('client i18n runtime engine', () => {
	it('resolves language automatically based on navigator.language', () => {
		const hTW = createI18nHarness({ navLang: 'zh-TW' });
		expect(hTW.context.getLanguage()).toBe('zh-TW');

		const hHK = createI18nHarness({ navLang: 'zh-HK' });
		expect(hHK.context.getLanguage()).toBe('zh-TW');

		const hCN = createI18nHarness({ navLang: 'zh-CN' });
		expect(hCN.context.getLanguage()).toBe('zh-CN');

		const hEN = createI18nHarness({ navLang: 'en-US' });
		expect(hEN.context.getLanguage()).toBe('en');
	});

	it('respects saved language preference over browser language', () => {
		const h = createI18nHarness({ navLang: 'en-US', savedLang: 'zh-TW' });
		expect(h.context.getLanguage()).toBe('zh-TW');
		expect(h.context.getLanguagePreference()).toBe('zh-TW');
	});

	it('translates strings and replaces template parameters', () => {
		const h = createI18nHarness({ savedLang: 'zh-TW' });
		expect(h.context.t('emptyTitle')).toBe('尚無金鑰');
		expect(h.context.t('groupCountText', { count: 5 })).toBe('5 個');

		h.context.setLanguage('en');
		expect(h.context.t('emptyTitle')).toBe('No Keys Yet');
		expect(h.context.t('groupCountText', { count: 3 })).toBe('3');
		expect(h.context.t('searchShowAll', { count: 10 })).toBe('Showing all 10 keys');
	});

	it('applies translations to DOM nodes correctly', () => {
		const h = createI18nHarness({ savedLang: 'en' });
		const textEl = h.addElement({ 'data-i18n': 'settingsTitle' });
		const placeholderEl = h.addElement({ 'data-i18n-placeholder': 'searchInputPlaceholder' });
		const titleEl = h.addElement({ 'data-i18n-title': 'cardMenuCopyURITitle' });
		const ariaEl = h.addElement({ 'data-i18n-aria-label': 'searchClearAriaLabel' });

		h.context.applyTranslations();

		expect(textEl.textContent).toBe('Settings');
		expect(placeholderEl.placeholder).toBe('Search service or account');
		expect(titleEl.title).toBe('Copy otpauth:// URI configuration');
		expect(ariaEl.attributes['aria-label']).toBe('Clear search');

		// Switch to zh-TW
		h.context.setLanguage('zh-TW');
		expect(textEl.textContent).toBe('設定');
		expect(placeholderEl.placeholder).toBe('搜尋服務或帳號名稱');
		expect(titleEl.title).toBe('用於匯入驗證器的 otpauth:// 設定');
	});

	it('persists language change to localStorage', () => {
		const h = createI18nHarness({ savedLang: 'zh-CN' });
		h.context.setLanguage('zh-TW');
		expect(h.storage.language).toBe('zh-TW');
		expect(h.context.getLanguage()).toBe('zh-TW');
	});

	it('formats dates according to selected language', () => {
		const h = createI18nHarness({ savedLang: 'en' });
		const testDate = new Date(Date.UTC(2025, 0, 15, 12, 0, 0));
		const formattedEN = h.context.formatI18nDate(testDate);
		expect(formattedEN).toBeTruthy();

		h.context.setLanguage('zh-TW');
		const formattedTW = h.context.formatI18nDate(testDate);
		expect(formattedTW).toBeTruthy();
	});

	it('compares strings using Intl.Collator with correct locale', () => {
		const h = createI18nHarness({ savedLang: 'zh-TW' });
		const cmp = h.context.compareI18nStrings('Apple', 'Banana');
		expect(cmp).toBeLessThan(0);
	});
});
