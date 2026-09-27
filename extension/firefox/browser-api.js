/** Keep Firefox's container sessions out of the default-session account cache. */
export function createFirefoxBrowser(nativeBrowser) {
	if (!nativeBrowser || !['object', 'function'].includes(typeof nativeBrowser)) {
		throw new TypeError('Firefox browser API 不可用');
	}
	// Content scripts have a restricted native namespace without tabs. They
	// cannot select a source tab; their messages are checked by the background.
	if (!('tabs' in nativeBrowser)) {
		return nativeBrowser;
	}
	const nativeTabs = nativeBrowser.tabs;
	if (!nativeTabs || typeof nativeTabs.query !== 'function' || typeof nativeTabs.get !== 'function') {
		throw new TypeError('Firefox tabs API 不可用');
	}

	const isDefaultContext = (tab) => tab?.cookieStoreId === 'firefox-default' && tab.incognito === false;
	const tabs = Object.create(nativeTabs);
	Object.defineProperties(tabs, {
		query: {
			enumerable: true,
			value: async (queryInfo) => (await nativeTabs.query(queryInfo)).filter(isDefaultContext),
		},
		get: {
			enumerable: true,
			value: async (tabId) => {
				const tab = await nativeTabs.get(tabId);
				if (!isDefaultContext(tab)) {
					const error = new Error('Firefox 版暂不支持容器标签页或隐私窗口，请在普通默认标签页中使用。');
					error.code = 'FIREFOX_CONTEXT_UNSUPPORTED';
					throw error;
				}
				return tab;
			},
		},
	});

	// Inherit the other native namespaces and tab events without intercepting
	// messages, document IDs, permissions, or storage access levels.
	const api = Object.create(nativeBrowser);
	Object.defineProperty(api, 'tabs', { value: tabs, enumerable: true });
	return api;
}

// The named export is injected only into Firefox bundles. Keeping initialization
// conditional also lets unit tests import the pure factory outside a browser.
export const firefox = globalThis.browser ? createFirefoxBrowser(globalThis.browser) : undefined;
