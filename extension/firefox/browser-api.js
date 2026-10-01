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

	// Firefox Android omits cookieStoreId. Only relax that requirement after a
	// successful native platform check, and share the lazy result across calls.
	let androidPlatform;
	const isAndroid = () => {
		androidPlatform ??= Promise.resolve()
			.then(() => nativeBrowser.runtime?.getPlatformInfo?.())
			.then(
				(platform) => platform?.os === 'android',
				() => false,
			);
		return androidPlatform;
	};
	const isDefaultContext = (tab) => {
		if (tab?.incognito !== false) {
			return false;
		}
		if (tab.cookieStoreId === 'firefox-default') {
			return true;
		}
		return tab.cookieStoreId === undefined ? isAndroid() : false;
	};
	const tabs = Object.create(nativeTabs);
	Object.defineProperties(tabs, {
		query: {
			enumerable: true,
			value: async (queryInfo) => {
				const result = await nativeTabs.query(queryInfo);
				const allowed = await Promise.all(result.map(isDefaultContext));
				return result.filter((_tab, index) => allowed[index]);
			},
		},
		get: {
			enumerable: true,
			value: async (tabId) => {
				const tab = await nativeTabs.get(tabId);
				if (!(await isDefaultContext(tab))) {
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
