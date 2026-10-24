// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

let document;
let localStorage;
let activeHarness;
const reply = (data, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => data });

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function createHarness({ language, settings = { language: 'en' }, fetchImpl } = {}) {
	const fetch = vi.fn(async (url, options) => {
		if (fetchImpl) {
			return fetchImpl(url, options);
		}
		if (url === '/api/login') {
			return reply({ success: true });
		}
		if (url === '/api/logout') {
			return reply({ success: true });
		}
		if (url === '/api/secrets') {
			return reply([]);
		}
		if (url === '/api/settings') {
			if (options?.method === 'POST') {
				Object.assign(settings, JSON.parse(options.body));
				return reply({ success: true, settings });
			}
			return reply(settings);
		}
		throw new Error('Unexpected request: ' + url);
	});
	const fixture = await createRuntimeFixture({
		fetch,
		setupWindow(pageWindow) {
			document = pageWindow.document;
			localStorage = pageWindow.localStorage;
			localStorage.clear();
			if (language) {
				localStorage.setItem('language', language);
			}
			Object.defineProperty(pageWindow.navigator, 'language', { configurable: true, value: 'zh-CN' });
			Object.defineProperty(pageWindow, 'isSecureContext', { configurable: true, value: true });
			pageWindow.setTimeout = setTimeout;
			pageWindow.clearTimeout = clearTimeout;
			pageWindow.setInterval = vi.fn();
			pageWindow.clearInterval = vi.fn();
			pageWindow.console = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
		},
		// Clock network synchronization is unrelated to language reads. The actual
		// host bootstrap, runtime, auth, account load and settings code still run.
		extraSource: `initializeTrustedClock = function() {}; ensureServerTimeSynchronized = async function() {};`,
	});
	activeHarness = fixture;
	const api = fixture.window;
	return {
		api,
		window: fixture.window,
		fetch,
		settings,
		startPage: async () => {
			fixture.initializeThemeApplication();
			await vi.advanceTimersByTimeAsync(0);
		},
		login: async () => {
			document.getElementById('loginToken').value = 'valid password';
			await api.handleLoginSubmit();
			await vi.advanceTimersByTimeAsync(0);
		},
		languageReads: () => fetch.mock.calls.filter(([url, options]) => url === '/api/settings' && options?.method !== 'POST'),
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	await activeHarness?.dispose();
	activeHarness = null;
	vi.useRealTimers();
});

describe('saved language after authentication', () => {
	it('restores the server language on a fresh browser reload without opening preferences', async () => {
		const h = await createHarness();
		document.getElementById('settingsModal').remove();
		expect(h.api.getLanguage()).toBe('zh-CN');
		await h.startPage();
		expect(h.api.getLanguage()).toBe('en');
		expect(document.documentElement.lang).toBe('en');
		expect(localStorage.getItem('language')).toBe('en');
		expect(h.languageReads()).toHaveLength(1);
		await h.api.loadSecrets();
		expect(h.languageReads()).toHaveLength(1);
	});

	it('restores the language after a successful login even when loading accounts fails', async () => {
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/login') {
					return reply({ success: true });
				}
				if (url === '/api/settings') {
					return reply({ language: 'en' });
				}
				throw new Error('Accounts unavailable');
			},
		});
		await h.login();
		expect(h.api.getLanguage()).toBe('en');
		expect(h.languageReads()).toHaveLength(1);
	});

	it('shares a pending startup read with the account load after login', async () => {
		const reading = deferred();
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/login') {
					return reply({ success: true });
				}
				if (url === '/api/secrets') {
					return reply([]);
				}
				return reading.promise;
			},
		});
		await h.login();
		expect(h.languageReads()).toHaveLength(1);
		reading.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('en');
	});

	it('preserves a locally selected setup language when the server has no saved language', async () => {
		const h = await createHarness({ language: 'en', settings: { maxBackups: 100 } });
		await h.startPage();
		expect(h.api.getLanguagePreference()).toBe('en');
		expect(localStorage.getItem('language')).toBe('en');
	});

	it('applies an explicitly saved automatic language preference', async () => {
		const h = await createHarness({ language: 'en', settings: { language: 'auto' } });
		await h.startPage();
		expect(h.api.getLanguagePreference()).toBe('auto');
		expect(h.api.getLanguage()).toBe('zh-CN');
	});

	it('does not fetch preferences for an unauthenticated page or a rejected login', async () => {
		const h = await createHarness({ language: 'en', fetchImpl: () => reply({ success: false }, 401) });
		await h.startPage();
		await h.login();
		expect(h.languageReads()).toHaveLength(0);
		expect(h.api.getLanguage()).toBe('en');
	});

	it('keeps the local language on a network failure and retries after a later account load', async () => {
		let available = false;
		const h = await createHarness({
			language: 'en',
			fetchImpl: (url) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				if (available) {
					return reply({ language: 'zh-TW' });
				}
				throw new Error('Network unavailable');
			},
		});
		await h.startPage();
		expect(h.api.getLanguage()).toBe('en');
		available = true;
		await h.api.loadSecrets();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-TW');
	});
});

describe('startup language read races', () => {
	it.each(['syncLanguagePreferenceAfterAuth', 'loadPreferences'])(
		'keeps a newer cross-tab language when %s returns an older language',
		async (load) => {
			const reading = deferred();
			const h = await createHarness({ language: 'en', fetchImpl: () => reading.promise });
			const loading = h.api[load]();
			localStorage.setItem('language', 'ja');
			h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: 'language', oldValue: 'en', newValue: 'ja' }));
			expect(h.api.getLanguage()).toBe('ja');

			reading.resolve(reply({ language: 'en', maxBackups: 50 }));
			await loading;
			expect(h.api.getLanguage()).toBe('ja');
			expect(document.documentElement.lang).toBe('ja');
			expect(document.getElementById('settingsLanguage').value).toBe('ja');
			expect(localStorage.getItem('language')).toBe('ja');
			if (load === 'loadPreferences') {
				expect(document.getElementById('settingsMaxBackups').value).toBe('50');
			}
		},
	);

	it.each(['language', null])('keeps an automatic preference after cross-tab storage removal with key %s', async (key) => {
		const reading = deferred();
		const h = await createHarness({ language: 'en', fetchImpl: () => reading.promise });
		const loading = h.api.syncLanguagePreferenceAfterAuth();
		localStorage.clear();
		h.window.dispatchEvent(new h.window.StorageEvent('storage', { key, oldValue: 'en', newValue: null }));
		expect(h.api.getLanguagePreference()).toBe('auto');

		reading.resolve(reply({ language: 'en' }));
		await loading;
		expect(h.api.getLanguagePreference()).toBe('auto');
		expect(h.api.getLanguage()).toBe('zh-CN');
		expect(localStorage.getItem('language')).toBeNull();
	});

	it('keeps a language applied directly while the startup request is pending', async () => {
		const reading = deferred();
		const h = await createHarness({ fetchImpl: () => reading.promise });
		const loading = h.api.syncLanguagePreferenceAfterAuth();
		h.api.setLanguage('zh-TW');
		reading.resolve(reply({ language: 'en' }));
		await loading;
		expect(h.api.getLanguage()).toBe('zh-TW');
		expect(localStorage.getItem('language')).toBe('zh-TW');
	});

	it('keeps a language selected and saved while the startup request is pending', async () => {
		const reading = deferred();
		const h = await createHarness({
			fetchImpl: (url, options) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				if (options?.method === 'POST') {
					return reply({ success: true });
				}
				return reading.promise;
			},
		});
		await h.startPage();
		await h.api.saveLanguagePreference('zh-TW');
		reading.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-TW');
		expect(localStorage.getItem('language')).toBe('zh-TW');
	});

	it('ignores a startup response whose read began during a pending language save', async () => {
		const reading = deferred();
		const saving = deferred();
		const h = await createHarness({
			fetchImpl: (url, options) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				return options?.method === 'POST' ? saving.promise : reading.promise;
			},
		});
		const save = h.api.saveLanguagePreference('zh-TW');
		await h.startPage();
		saving.resolve(reply({ success: true }));
		await save;
		reading.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-TW');
	});

	it('does not overwrite a newer preferences read with the delayed startup response', async () => {
		const reading = deferred();
		let reads = 0;
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				return ++reads === 1 ? reading.promise : reply({ language: 'zh-TW' });
			},
		});
		await h.startPage();
		await h.api.loadPreferences();
		reading.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-TW');
		expect(document.getElementById('settingsLanguage').value).toBe('zh-TW');
	});

	it('discards an earlier preferences response when startup receives a newer saved language', async () => {
		const reading = deferred();
		let reads = 0;
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				return ++reads === 1 ? reading.promise : reply({ language: 'zh-TW' });
			},
		});
		const preferences = h.api.loadPreferences();
		await h.startPage();
		reading.resolve(reply({ language: 'en' }));
		await preferences;
		expect(h.api.getLanguage()).toBe('zh-TW');
	});

	it('keeps the newly authenticated language when a response from the expired session arrives', async () => {
		const oldSession = deferred();
		let reads = 0;
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/login') {
					return reply({ success: true });
				}
				if (url === '/api/secrets') {
					return reply([]);
				}
				return ++reads === 1 ? oldSession.promise : reply({ language: 'zh-TW' });
			},
		});
		await h.startPage();
		h.api.handleUnauthorized();
		await h.login();
		expect(h.api.getLanguage()).toBe('zh-TW');
		oldSession.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-TW');
		expect(h.languageReads()).toHaveLength(2);
	});

	it.each(['logout', 'handleUnauthorized'])('discards a pending response after %s', async (action) => {
		const reading = deferred();
		const h = await createHarness({
			fetchImpl: (url) => {
				if (url === '/api/secrets') {
					return reply([]);
				}
				if (url === '/api/logout') {
					return reply({ success: true });
				}
				return reading.promise;
			},
		});
		await h.startPage();
		await h.api[action]();
		reading.resolve(reply({ language: 'en' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.getLanguage()).toBe('zh-CN');
		expect(localStorage.getItem('language')).toBeNull();
	});
});
