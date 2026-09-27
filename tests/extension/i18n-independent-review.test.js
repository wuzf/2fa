// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '../../extension/src/locales/index.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';

let i18n;
let runtime;
let messageListeners;
let cleanups;

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

beforeEach(async () => {
	vi.resetModules();
	document.body.replaceChildren();
	messageListeners = new Set();
	cleanups = [];
	runtime = {
		id: 'review-extension',
		onMessage: {
			addListener: vi.fn((listener) => messageListeners.add(listener)),
			removeListener: vi.fn((listener) => messageListeners.delete(listener)),
		},
		sendMessage: vi.fn(async () => ({ ok: true, data: { preference: 'en', language: 'en' } })),
	};
	vi.stubGlobal('chrome', { runtime, i18n: { getUILanguage: () => 'zh-Hant-HK' } });
	i18n = await import('../../extension/src/shared/i18n.js');
});

afterEach(() => {
	cleanups.reverse().forEach((cleanup) => cleanup());
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function deliver(preference, sender = { id: runtime.id }, language = preference) {
	for (const listener of messageListeners) {
		listener({ type: 'LANGUAGE_CHANGED', preference, language }, sender);
	}
}

describe('independent shared extension i18n review', () => {
	it('keeps complete translations and placeholder contracts in all dictionaries', () => {
		const keys = Object.keys(LOCALES['zh-CN']).sort();
		for (const language of SUPPORTED_LANGUAGES) {
			expect(Object.keys(LOCALES[language]).sort()).toEqual(keys);
			for (const key of keys) {
				expect(LOCALES[language][key].trim().length, language + '/' + key).toBeGreaterThan(0);
				const parameters = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
				expect(parameters(LOCALES[language][key]), language + '/' + key).toEqual(parameters(LOCALES['zh-CN'][key]));
			}
		}
	});

	it.each([
		['zh_HK', 'zh-TW'],
		['zh-Hant-HK', 'zh-TW'],
		['zh-MO', 'zh-TW'],
		['zh-Hans', 'zh-CN'],
		['en-GB', 'en'],
	])('resolves browser locale %s', (input, expected) => {
		expect(i18n.normalizeLanguage(input)).toBe(expected);
	});

	it('renders translations and user parameters as text while preserving input values and nested templates', () => {
		document.body.innerHTML =
			'<p data-i18n="languageInvalid"></p><input data-i18n-placeholder="languageInvalid" value="keep"><template><p data-i18n="languageSaveFailed"></p></template>';
		i18n.setLanguage('en');
		i18n.applyTranslations(document);
		expect(document.documentElement.lang).toBe('en');
		expect(document.querySelector('input').value).toBe('keep');
		expect(document.querySelector('input').placeholder).toBe('Choose a supported language');
		expect(document.querySelector('template').content.querySelector('p').textContent).toBe(LOCALES.en.languageSaveFailed);
		const key = Object.keys(LOCALES.en).find((candidate) => /\{\w+\}/.test(LOCALES.en[candidate]));
		const params = Object.fromEntries([...LOCALES.en[key].matchAll(/\{(\w+)\}/g)].map((match) => [match[1], '<img id="injected">']));
		const paragraph = document.querySelector('p');
		paragraph.setAttribute('data-i18n', key);
		paragraph.setAttribute('data-i18n-params', JSON.stringify(params));
		i18n.applyTranslations(paragraph);
		expect(paragraph.textContent).toContain('<img id="injected">');
		expect(document.getElementById('injected')).toBeNull();
	});

	it('shares an initialization read and ignores a stale response after a trusted language broadcast', async () => {
		const read = deferred();
		runtime.sendMessage.mockReturnValue(read.promise);
		const first = i18n.initI18n({ root: null, runtime });
		const second = i18n.initI18n({ root: null, runtime });
		await Promise.resolve();
		expect(runtime.sendMessage).toHaveBeenCalledOnce();
		expect(messageListeners.size).toBe(1);
		deliver('en');
		read.resolve({ ok: true, data: { preference: 'zh-CN', language: 'zh-CN' } });
		const releases = await Promise.all([first, second]);
		expect(i18n.getLanguage()).toBe('en');
		releases[0]();
		expect(messageListeners.size).toBe(1);
		releases[1]();
		releases[1]();
		expect(messageListeners.size).toBe(0);
		expect(runtime.onMessage.removeListener).toHaveBeenCalledOnce();
	});

	it('rejects tab-originated and foreign-extension language notifications without altering the website', async () => {
		document.documentElement.lang = 'ja';
		document.title = 'User website';
		cleanups.push(await i18n.initI18n({ root: null, runtime }));
		deliver('zh-CN', { id: runtime.id, tab: { id: 9 } });
		deliver('zh-CN', { id: 'another-extension' });
		deliver('unsupported');
		expect(i18n.getLanguage()).toBe('en');
		expect(document.documentElement.lang).toBe('ja');
		expect(document.title).toBe('User website');
		expect(runtime.sendMessage).toHaveBeenCalledOnce();
	});

	it('rejects all concurrent initializers after context invalidation and cleans every listener', async () => {
		const read = deferred();
		runtime.sendMessage.mockReturnValue(read.promise);
		const attempts = [i18n.initI18n({ root: document, runtime }), i18n.initI18n({ root: null, runtime })];
		const all = Promise.allSettled(attempts);
		read.reject(new Error('Extension context invalidated.'));
		expect((await all).map((result) => result.status)).toEqual(['rejected', 'rejected']);
		expect(messageListeners.size).toBe(0);
		await expect(i18n.initI18n({ root: null, runtime })).rejects.toThrow('Extension context invalidated');
		expect(runtime.sendMessage).toHaveBeenCalledOnce();
	});

	it('keeps the latest successful preference when save responses arrive in reverse order', async () => {
		const first = deferred();
		const second = deferred();
		runtime.sendMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const savingFirst = i18n.setLanguagePreference('zh-TW', { runtime });
		const savingSecond = i18n.setLanguagePreference('en', { runtime });
		second.resolve({ ok: true, data: { preference: 'en', language: 'en' } });
		await savingSecond;
		first.resolve({ ok: true, data: { preference: 'zh-TW', language: 'zh-TW' } });
		await savingFirst;
		expect(i18n.getLanguagePreference()).toBe('en');
		expect(i18n.getLanguage()).toBe('en');
	});

	it('retries a later initialization after a synchronous transient messaging failure', async () => {
		runtime.sendMessage.mockImplementationOnce(() => {
			throw new Error('Receiving end does not exist');
		});
		cleanups.push(await i18n.initI18n({ root: null, runtime }));
		cleanups.push(await i18n.initI18n({ root: null, runtime }));
		expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
		expect(i18n.getLanguage()).toBe('en');
	});
});
