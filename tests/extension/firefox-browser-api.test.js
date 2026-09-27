import { describe, expect, it, vi } from 'vitest';

import { createFirefoxBrowser } from '../../extension/firefox/browser-api.js';
import { getErrorResponse } from '../../extension/src/shared/protocol.js';
import { getLanguagePreference, localizeError, setLanguage } from '../../extension/src/shared/i18n.js';

const defaultTab = (id, extra = {}) => ({ id, cookieStoreId: 'firefox-default', incognito: false, ...extra });

function nativeBrowser(tabs = []) {
	return {
		tabs: {
			query: vi.fn(async () => tabs),
			get: vi.fn(async (id) => tabs.find((tab) => tab.id === id)),
			create: vi.fn(),
			sendMessage: vi.fn(),
			onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() },
		scripting: { executeScript: vi.fn(), registerContentScripts: vi.fn() },
		storage: { local: { get: vi.fn() }, session: { get: vi.fn() } },
		permissions: { request: vi.fn() },
		action: { openPopup: vi.fn() },
	};
}

describe('Firefox default-session boundary', () => {
	it.each([
		['zh-CN', 'Firefox 版暂不支持容器标签页或隐私窗口，请在普通默认标签页中使用。'],
		['zh-TW', 'Firefox 版暫不支援容器分頁或隱私視窗，請在一般預設分頁中使用。'],
		['en', 'The Firefox extension does not yet support container tabs or private windows. Use a regular tab in the default container.'],
	])('preserves the container/private restriction through protocol serialization and %s UI localization', async (language, expected) => {
		const previousLanguage = getLanguagePreference();
		try {
			setLanguage(language);
			for (const context of [{ cookieStoreId: 'firefox-container-1' }, { cookieStoreId: 'firefox-private', incognito: true }]) {
				const api = createFirefoxBrowser(nativeBrowser([defaultTab(1, context)]));
				let failure;
				try {
					await api.tabs.get(1);
				} catch (error) {
					failure = error;
				}
				expect(failure?.code).toBe('FIREFOX_CONTEXT_UNSUPPORTED');
				expect(getErrorResponse(failure, language).error.message).toBe(expected);
				// A response serialized before a UI language switch remains translatable.
				const response = getErrorResponse(failure, 'zh-CN');
				expect(response.error.messageKey).toBe('error_FIREFOX_CONTEXT_UNSUPPORTED');
				expect(localizeError(response.error)).toBe(expected);
				expect(localizeError(failure)).toBe(expected);
			}
		} finally {
			setLanguage(previousLanguage);
		}
	});
	it('keeps the restricted native content-script namespace usable without a tabs API', () => {
		const contentBrowser = {
			runtime: { id: 'synthetic-addon@example.com', onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() },
			storage: { local: { get: vi.fn() } },
			i18n: { getMessage: vi.fn() },
		};
		const api = createFirefoxBrowser(contentBrowser);
		expect(api).toBe(contentBrowser);
		expect(api.runtime).toBe(contentBrowser.runtime);
		expect(api).not.toHaveProperty('tabs');
		expect(api.storage.local.setAccessLevel).toBeUndefined();
	});

	it.each([undefined, null, {}, { query: vi.fn() }, { get: vi.fn() }])(
		'fails closed for a present but incomplete tabs namespace: %j',
		(tabs) => {
			expect(() => createFirefoxBrowser({ tabs })).toThrow('Firefox tabs API 不可用');
		},
	);

	it.each([undefined, null])('rejects a missing browser namespace: %j', (browser) => {
		expect(() => createFirefoxBrowser(browser)).toThrow('Firefox browser API 不可用');
	});

	it('excludes containers and private contexts from same-origin source discovery without altering the query', async () => {
		const origin = 'https://twofa.example.com/';
		const allowed = defaultTab(1, { url: origin });
		const native = nativeBrowser([
			allowed,
			defaultTab(2, { url: origin, cookieStoreId: 'firefox-container-1' }),
			defaultTab(3, { url: origin, cookieStoreId: 'firefox-private', incognito: true }),
			defaultTab(4, { url: origin, incognito: true }),
			{ id: 5, url: origin, incognito: false },
			{ id: 6, url: origin, cookieStoreId: 'firefox-default' },
		]);
		const query = { url: 'https://twofa.example.com/*', currentWindow: true };
		const api = createFirefoxBrowser(native);

		const result = await api.tabs.query(query);
		expect(native.tabs.query).toHaveBeenCalledWith(query);
		expect(result).toEqual([allowed]);
		expect(result[0]).toBe(allowed);
		expect(await native.tabs.query(query)).toHaveLength(6);
	});

	it('returns no active target when the active tab belongs to a container', async () => {
		const native = nativeBrowser([defaultTab(2, { active: true, cookieStoreId: 'firefox-container-2' })]);
		const api = createFirefoxBrowser(native);
		expect(await api.tabs.query({ active: true, currentWindow: true })).toEqual([]);
	});

	it('checks the current tab context again after discovery before it can be used', async () => {
		const tab = defaultTab(1);
		const native = nativeBrowser([tab]);
		const api = createFirefoxBrowser(native);
		expect(await api.tabs.query({})).toEqual([tab]);
		expect(await api.tabs.get(1)).toBe(tab);
		native.tabs.get.mockResolvedValueOnce(defaultTab(1, { cookieStoreId: 'firefox-container-1' }));
		await expect(api.tabs.get(1)).rejects.toMatchObject({ code: 'FIREFOX_CONTEXT_UNSUPPORTED' });
	});

	it.each([
		defaultTab(1, { cookieStoreId: 'firefox-container-1' }),
		defaultTab(1, { cookieStoreId: 'firefox-private', incognito: true }),
		defaultTab(1, { incognito: true }),
		{ id: 1, incognito: false },
		{ id: 1, cookieStoreId: 'firefox-default' },
		null,
	])('rejects get results outside an explicitly identified default ordinary context: %j', async (tab) => {
		const native = nativeBrowser();
		native.tabs.get.mockResolvedValue(tab);
		await expect(createFirefoxBrowser(native).tabs.get(1)).rejects.toMatchObject({
			code: 'FIREFOX_CONTEXT_UNSUPPORTED',
			message: expect.stringContaining('普通默认标签页'),
		});
	});

	it('preserves native query/get failures rather than treating them as empty or allowed contexts', async () => {
		const native = nativeBrowser();
		const failure = new Error('No tab with id');
		native.tabs.get.mockRejectedValue(failure);
		native.tabs.query.mockRejectedValue(failure);
		const api = createFirefoxBrowser(native);
		await expect(api.tabs.get(7)).rejects.toBe(failure);
		await expect(api.tabs.query({})).rejects.toBe(failure);
	});

	it('retains native message/document APIs, tab events and storage without claiming access-level support', async () => {
		const native = nativeBrowser();
		const api = createFirefoxBrowser(native);
		for (const name of ['runtime', 'scripting', 'storage', 'permissions', 'action']) {
			expect(api[name]).toBe(native[name]);
		}
		for (const name of ['create', 'sendMessage', 'onUpdated']) {
			expect(api.tabs[name]).toBe(native.tabs[name]);
		}
		expect(api.storage.local.setAccessLevel).toBeUndefined();
		expect(api.storage.session.setAccessLevel).toBeUndefined();
		const payload = { type: 'TARGET_PING' };
		const target = { frameId: 0, documentId: 'synthetic-document-id' };
		const response = { ok: true };
		native.tabs.sendMessage.mockResolvedValue(response);
		expect(await api.tabs.sendMessage(1, payload, target)).toBe(response);
		expect(native.tabs.sendMessage).toHaveBeenCalledWith(1, payload, target);
	});

	it('does not mutate or require writable native API objects', async () => {
		const native = nativeBrowser([defaultTab(1)]);
		const originalGet = native.tabs.get;
		const originalQuery = native.tabs.query;
		Object.freeze(native.tabs);
		Object.freeze(native);
		const api = createFirefoxBrowser(native);
		expect(await api.tabs.get(1)).toEqual(defaultTab(1));
		expect(await api.tabs.query({})).toEqual([defaultTab(1)]);
		expect(native.tabs.get).toBe(originalGet);
		expect(native.tabs.query).toBe(originalQuery);
	});
});
