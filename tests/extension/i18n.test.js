import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '../../extension/src/locales/index.js';
import { LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { EXTRA_TRANSLATIONS } from '../../src/shared/locales/index.js';

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function runtime(response = { preference: 'auto', language: 'en' }) {
	const handlers = new Set();
	const result = {
		id: 'test-extension',
		sendMessage: vi.fn(async () => ({ ok: true, data: response })),
		onMessage: {
			addListener: vi.fn((fn) => handlers.add(fn)),
			removeListener: vi.fn((fn) => handlers.delete(fn)),
		},
	};
	result.emit = (message, sender = { id: result.id }) => {
		for (const handler of [...handlers]) {
			handler(message, sender);
		}
	};
	return result;
}
function page() {
	const window = new Window({ url: 'https://fixture.example', settings: { disableJavaScriptEvaluation: true } });
	window.document.documentElement.lang = 'ja';
	window.document.body.innerHTML =
		'<button data-i18n="optionsConnect"></button><input value="用户 <text>" data-i18n-placeholder="popupSearch"><template><button data-i18n="popupFill" data-i18n-title="popupCopyCodeTitle"></button></template>';
	return window;
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('extension language runtime', () => {
	it.each([
		['zh-Hant-HK', 'zh-TW'],
		['zh_HK', 'zh-TW'],
		['zh-SG', 'zh-CN'],
		['en-GB', 'en'],
		['fr-FR', 'fr'],
		['de-DE', 'de'],
		['ja-JP', 'ja'],
		['ko-KR', 'ko'],
		['es-MX', 'es'],
		['pt_BR', 'pt-BR'],
		['pt-PT', 'pt-BR'],
		['it-IT', 'it'],
		['ru-RU', 'ru'],
		['tr-TR', 'tr'],
		['in-ID', 'id'],
		['vi-VN', 'vi'],
		['th-TH', 'th'],
		['ar-SA', 'en'],
		['', 'en'],
	])('resolves browser locale %s', async (tag, expected) => {
		const api = await import('../../extension/src/shared/i18n.js');
		expect(api.resolveLanguage('auto', tag)).toBe(expected);
		expect(api.resolveLanguage('en', tag)).toBe('en');
	});
	it.each(LANGUAGE_OPTIONS)('persists and formats registered language $value', async ({ value }) => {
		const channel = runtime({ preference: value, language: value });
		vi.stubGlobal('chrome', { runtime: channel, i18n: { getUILanguage: () => 'unknown-ZZ' } });
		const api = await import('../../extension/src/shared/i18n.js');
		await api.setLanguagePreference(value);
		expect(api.getLanguage()).toBe(value);
		expect(api.getLanguagePreference()).toBe(value);
		expect(channel.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SAVE_LANGUAGE', preference: value });
		expect(api.t('optionsLanguage')).toBe(LOCALES[value].optionsLanguage);
		const date = '2026-10-02T03:04:05Z';
		const options = { dateStyle: 'medium', timeZone: 'UTC' };
		expect(api.formatDate(date, options)).toBe(new Date(date).toLocaleString(value === 'en' ? 'en-US' : value, options));
	});
	it('falls back to English for unsupported or unavailable browser languages', async () => {
		const api = await import('../../extension/src/shared/i18n.js');
		expect(api.getBrowserLanguage()).toBe('en');
		expect(api.resolveLanguage('auto', 'ar-SA')).toBe('en');
		expect(api.t('popupFill', {}, 'ar-SA')).toBe(LOCALES.en.popupFill);
		vi.stubGlobal('chrome', {
			i18n: {
				getUILanguage: () => {
					throw new Error('unavailable');
				},
			},
		});
		expect(api.getBrowserLanguage()).toBe('en');
	});
	it('selects locale plural categories including French zero and Russian compound counts', async () => {
		const api = await import('../../extension/src/shared/i18n.js');
		api.setLanguage('fr');
		expect(api.pluralCategory(0)).toBe('one');
		expect(api.tPlural('optionsSiteCount', 0)).toBe(LOCALES.fr.optionsSiteCountOne.replace('{count}', '0'));
		api.setLanguage('ru');
		expect(api.pluralCategory(21)).toBe('one');
		expect(api.tPlural('optionsSiteCount', 21)).toBe(LOCALES.ru.optionsSiteCountOne.replace('{count}', '21'));
		expect(api.tPlural('optionsSiteCount', 22)).toBe('22 сайта');
		expect(api.tPlural('optionsSiteCount', 25)).toBe('25 сайтов');
		expect(api.tPlural('popupRemainingSeconds', 2, { seconds: 2 })).toBe('Осталось 2 секунды');
		expect(api.tPlural('popupRemainingSeconds', 5, { seconds: 5 })).toBe('Осталось 5 секунд');
		api.setLanguage('ja');
		expect(api.pluralCategory(1)).toBe('other');
		expect(api.tPlural('optionsSiteCount', 1)).toBe(LOCALES.ja.optionsSiteCount.replace('{count}', '1'));
	});
	it('localizes all roots and template controls without modifying form values', async () => {
		const app = page();
		const channel = runtime();
		vi.stubGlobal('chrome', { runtime: channel, i18n: { getUILanguage: () => 'en-GB' } });
		const api = await import('../../extension/src/shared/i18n.js');
		const dispose = await api.initI18n({ root: app.document });
		expect(app.document.documentElement.lang).toBe('en');
		expect(app.document.querySelector('button').textContent).toBe(LOCALES.en.optionsConnect);
		expect(app.document.querySelector('template').content.querySelector('button').textContent).toBe(LOCALES.en.popupFill);
		expect(app.document.querySelector('input').value).toBe('用户 <text>');
		dispose();
		dispose();
		expect(channel.onMessage.removeListener).toHaveBeenCalledTimes(1);
	});
	it('does not let another content script or another extension change the language', async () => {
		const app = page();
		const channel = runtime({ preference: 'zh-CN', language: 'zh-CN' });
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const dispose = await api.initI18n({ root: null });
		channel.emit({ type: 'LANGUAGE_CHANGED', preference: 'en', language: 'en' }, { id: channel.id, tab: { id: 9 } });
		channel.emit({ type: 'LANGUAGE_CHANGED', preference: 'en', language: 'en' }, { id: 'other-extension' });
		expect(api.getLanguage()).toBe('zh-CN');
		expect(app.document.documentElement.lang).toBe('ja');
		channel.emit({ type: 'LANGUAGE_CHANGED', preference: 'en', language: 'en' });
		expect(api.getLanguage()).toBe('en');
		expect(app.document.documentElement.lang).toBe('ja');
		dispose();
	});
	it('ignores an initial saved preference response delivered after a newer background event', async () => {
		const channel = runtime();
		const pending = deferred();
		channel.sendMessage.mockReturnValue(pending.promise);
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const initializing = api.initI18n({ root: null });
		channel.emit({ type: 'LANGUAGE_CHANGED', preference: 'en', language: 'en' });
		pending.resolve({ ok: true, data: { preference: 'zh-TW', language: 'zh-TW' } });
		const dispose = await initializing;
		expect(api.getLanguage()).toBe('en');
		dispose();
	});
	it('shares initialization across content owners and rejects both after permanent context loss', async () => {
		const channel = runtime();
		const pending = deferred();
		channel.sendMessage.mockReturnValue(pending.promise);
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const results = Promise.allSettled([api.initI18n({ root: null }), api.initI18n({ root: null })]);
		pending.reject(new Error('Extension context invalidated.'));
		expect((await results).map((r) => r.status)).toEqual(['rejected', 'rejected']);
		expect(channel.sendMessage).toHaveBeenCalledTimes(1);
		expect(channel.onMessage.removeListener).toHaveBeenCalledTimes(1);
		await expect(api.initI18n({ root: null })).rejects.toThrow('context invalidated');
	});
	it('allows initialization retry after a temporary worker restart and tolerates cleanup failure', async () => {
		const channel = runtime({ preference: 'zh-TW', language: 'zh-TW' });
		channel.sendMessage.mockRejectedValueOnce(new Error('Message port closed'));
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const first = await api.initI18n({ root: null });
		const second = await api.initI18n({ root: null });
		expect(api.getLanguage()).toBe('zh-TW');
		first();
		channel.onMessage.removeListener.mockImplementation(() => {
			throw new Error('Extension context invalidated');
		});
		expect(() => second()).not.toThrow();
	});
	it('does not reset already-rendered dynamic text when the resolved language is unchanged', async () => {
		const app = page();
		const channel = runtime({ preference: 'en', language: 'en' });
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const dispose = await api.initI18n({ root: app.document });
		const listener = vi.fn();
		const unsubscribe = api.onLanguageChange(listener);
		app.document.querySelector('button').textContent = 'Connecting…';
		api.setLanguage('en');
		expect(app.document.querySelector('button').textContent).toBe('Connecting…');
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
		dispose();
	});
	it('writes only through SAVE_LANGUAGE and keeps the newest preference when replies arrive out of order', async () => {
		const first = deferred(),
			second = deferred(),
			channel = runtime();
		channel.sendMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		vi.stubGlobal('chrome', { runtime: channel });
		const api = await import('../../extension/src/shared/i18n.js');
		const a = api.setLanguagePreference('zh-TW');
		const b = api.setLanguagePreference('en');
		second.resolve({ ok: true, data: { preference: 'en', language: 'en' } });
		await b;
		first.resolve({ ok: true, data: { preference: 'zh-TW', language: 'zh-TW' } });
		await a;
		expect(api.getLanguage()).toBe('en');
		expect(channel.sendMessage.mock.calls.map(([m]) => m.type)).toEqual(['SAVE_LANGUAGE', 'SAVE_LANGUAGE']);
		await expect(api.setLanguagePreference('constructor')).rejects.toThrow();
		expect(channel.sendMessage).toHaveBeenCalledTimes(2);
	});
	it('uses diagnostic metadata and keeps interpolated user content verbatim', async () => {
		const api = await import('../../extension/src/shared/i18n.js');
		api.setLanguage('en');
		expect(api.localizeError({ code: 'AUTH_REQUIRED', message: '服务器文本' })).toBe(LOCALES.en.error_AUTH_REQUIRED);
		const key = Object.keys(LOCALES.en).find((k) => LOCALES.en[k].includes('{version}'));
		const raw = '<img onerror=alert(1)>中文';
		expect(api.localizeError({ messageKey: key, params: { version: raw } })).toContain(raw);
		expect(api.localizeError({ message: 'External diagnostic: 用户原文' })).toBe('External diagnostic: 用户原文');
		expect(api.formatDate('not a date')).toBe('');
	});
});

describe('extension locale coverage', () => {
	it('contains complete translated runtime dictionaries for every registered language', () => {
		expect(Object.keys(LOCALES)).toEqual(SUPPORTED_LANGUAGES);
		expect(SUPPORTED_LANGUAGES).toHaveLength(15);
		for (const { value } of LANGUAGE_OPTIONS) {
			if (!EXTRA_TRANSLATIONS[value]) {
				continue;
			}
			for (const [key, english] of Object.entries(LOCALES.en)) {
				expect(Object.hasOwn(EXTRA_TRANSLATIONS[value], english), `${value}/${key}: ${english}`).toBe(true);
				expect(EXTRA_TRANSLATIONS[value][english].trim().length, `${value}/${key}`).toBeGreaterThan(0);
			}
			expect(LOCALES[value].optionsLanguage).not.toBe(LOCALES.en.optionsLanguage);
			expect(LOCALES[value].popupFill).not.toBe(LOCALES.en.popupFill);
		}
	});
	it('keeps locale keys and parameters aligned and defines all literal JS/HTML bindings', () => {
		const files = [];
		const walk = (path) => {
			for (const item of readdirSync(path, { withFileTypes: true })) {
				const file = join(path, item.name);
				if (item.isDirectory()) {
					walk(file);
				} else if (/\.(?:js|html)$/.test(file)) {
					files.push(file);
				}
			}
		};
		walk('extension/src');
		const referenced = new Set();
		for (const file of files) {
			if (file.includes('locales')) {
				continue;
			}
			const text = readFileSync(file, 'utf8');
			for (const match of text.matchAll(/\bt\(['"]([\w-]+)['"]|data-i18n(?:-title|-placeholder|-aria-label|-alt)?=['"]([\w-]+)['"]/g)) {
				referenced.add(match[1] || match[2]);
			}
		}
		const params = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const [locale, dictionary] of Object.entries(LOCALES)) {
			expect(Object.keys(dictionary).sort()).toEqual(Object.keys(LOCALES['zh-CN']).sort());
			for (const key of referenced) {
				expect(dictionary[key], locale + ':' + key).toBeTypeOf('string');
			}
			for (const [key, value] of Object.entries(dictionary)) {
				expect(params(value), locale + ':' + key).toEqual(params(LOCALES['zh-CN'][key]));
			}
		}
	});
});
