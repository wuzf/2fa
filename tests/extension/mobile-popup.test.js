import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canFillHiddenTarget, validateMobilePopupTarget } from '../../extension/src/background/mobile-popup.js';
import { getConfigurationGeneration, invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';

const POPUP_URL = 'moz-extension://test-extension/popup.html';
const TARGET_ORIGIN = 'https://login.example';

function installBrowser() {
	const flow = {
		nonce: 'manual-fill-nonce',
		configurationGeneration: getConfigurationGeneration(),
		targetTabId: 10,
		targetOrigin: TARGET_ORIGIN,
		targetPath: '/challenge',
	};
	const tab = { id: 10, active: true, incognito: false, url: `${TARGET_ORIGIN}/challenge` };
	const popup = {
		location: { href: POPUP_URL },
		document: {
			visibilityState: 'visible',
			hasFocus: vi.fn(() => true),
			documentElement: { dataset: { manualFillNonce: flow.nonce } },
		},
	};
	const browser = {
		runtime: {
			getPlatformInfo: vi.fn(async () => ({ os: 'android' })),
			getURL: vi.fn(() => POPUP_URL),
		},
		extension: { getViews: vi.fn(() => [popup]) },
		tabs: { get: vi.fn(async () => ({ ...tab })) },
	};
	vi.stubGlobal('chrome', browser);
	return { flow, tab, popup, browser };
}

beforeEach(() => {
	invalidateConfigurationGeneration();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Firefox Android manual popup authorization', () => {
	it('permits the focused manual popup over its active target tab', async () => {
		const { flow, browser } = installBrowser();
		await expect(canFillHiddenTarget(flow)).resolves.toBe(true);
		expect(browser.extension.getViews).toHaveBeenCalledWith({ type: 'popup' });
		expect(browser.tabs.get).toHaveBeenCalledWith(flow.targetTabId);
		await expect(validateMobilePopupTarget(flow)).resolves.toBeUndefined();
	});

	it.each(['win', 'mac', 'linux', 'cros', undefined])('does not exempt the %s platform', async (os) => {
		const { flow, browser } = installBrowser();
		browser.runtime.getPlatformInfo.mockResolvedValue({ os });
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
		expect(browser.tabs.get).not.toHaveBeenCalled();
	});

	it('does not exempt Chromium Android popups', async () => {
		const { flow, popup, browser } = installBrowser();
		const chromiumUrl = 'chrome-extension://test-extension/popup.html';
		browser.runtime.getURL.mockReturnValue(chromiumUrl);
		popup.location.href = chromiumUrl;
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each(['getPlatformInfo', 'getViews', 'extension'])('fails closed without %s', async (missing) => {
		const { flow, browser } = installBrowser();
		if (missing === 'getPlatformInfo') {
			delete browser.runtime.getPlatformInfo;
		} else if (missing === 'getViews') {
			delete browser.extension.getViews;
		} else {
			delete browser.extension;
		}
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
		expect(browser.tabs.get).not.toHaveBeenCalled();
	});

	it.each(['platform', 'tab', 'views'])('fails closed when the %s query fails', async (query) => {
		const { flow, browser } = installBrowser();
		if (query === 'platform') {
			browser.runtime.getPlatformInfo.mockRejectedValue(new Error('Platform unavailable'));
		} else if (query === 'tab') {
			browser.tabs.get.mockRejectedValue(new Error('Tab removed'));
		} else {
			browser.extension.getViews.mockImplementation(() => {
				throw new Error('Popup unavailable');
			});
		}
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each([
		'moz-extension://test-extension/options.html',
		'moz-extension://test-extension/popup.html?manual=true',
		'moz-extension://test-extension/popup.html#manual',
		'moz-extension://other-extension/popup.html',
		'https://login.example/popup.html',
	])('rejects a view whose URL is %s', async (url) => {
		const { flow, popup } = installBrowser();
		popup.location.href = url;
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each(['hidden', 'prerender', undefined])('rejects a popup with visibility %s', async (visibility) => {
		const { flow, popup } = installBrowser();
		popup.document.visibilityState = visibility;
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it('rejects an unfocused popup', async () => {
		const { flow, popup } = installBrowser();
		popup.document.hasFocus.mockReturnValue(false);
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each(['', 'another-manual-action', undefined])('rejects the missing or unrelated nonce %s', async (nonce) => {
		const { flow, popup } = installBrowser();
		popup.document.documentElement.dataset.manualFillNonce = nonce;
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it('rejects an already closed popup', async () => {
		const { flow, browser } = installBrowser();
		browser.extension.getViews.mockReturnValue([]);
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it('rejects a view that becomes inaccessible', async () => {
		const { flow, popup } = installBrowser();
		Object.defineProperty(popup, 'document', {
			get() {
				throw new Error('Window destroyed');
			},
		});
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each([
		['different tab', { id: 11 }],
		['inactive tab', { active: false }],
		['unknown activity', { active: undefined }],
		['private tab', { incognito: true }],
		['unknown privacy state', { incognito: undefined }],
		['discarded tab', { discarded: true }],
		['frozen tab', { frozen: true }],
		['pending navigation', { pendingUrl: `${TARGET_ORIGIN}/challenge` }],
		['different origin', { url: 'https://other.example/challenge' }],
		['different path', { url: `${TARGET_ORIGIN}/other` }],
		['missing URL', { url: undefined }],
	])('rejects a %s', async (_description, changes) => {
		const { flow, tab } = installBrowser();
		Object.assign(tab, changes);
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each(['platform', 'tab'])('rechecks manual intent after the asynchronous %s query', async (query) => {
		const { flow, popup, tab, browser } = installBrowser();
		const revokeManualIntent = async () => {
			delete popup.document.documentElement.dataset.manualFillNonce;
			return query === 'platform' ? { os: 'android' } : { ...tab };
		};
		if (query === 'platform') {
			browser.runtime.getPlatformInfo.mockImplementation(revokeManualIntent);
		} else {
			browser.tabs.get.mockImplementation(revokeManualIntent);
		}
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it('rechecks popup focus after the asynchronous target query', async () => {
		const { flow, popup, tab, browser } = installBrowser();
		browser.tabs.get.mockImplementation(async () => {
			popup.document.hasFocus.mockReturnValue(false);
			return { ...tab };
		});
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it.each(['platform', 'tab'])('rejects a popup that closes during the %s query', async (query) => {
		const { flow, tab, browser } = installBrowser();
		const closePopup = async () => {
			browser.extension.getViews.mockReturnValue([]);
			return query === 'platform' ? { os: 'android' } : { ...tab };
		};
		if (query === 'platform') {
			browser.runtime.getPlatformInfo.mockImplementation(closePopup);
		} else {
			browser.tabs.get.mockImplementation(closePopup);
		}
		await expect(canFillHiddenTarget(flow)).resolves.toBe(false);
	});

	it('rejects a previously authorized popup that closes before final validation', async () => {
		const { flow, browser } = installBrowser();
		await expect(canFillHiddenTarget(flow)).resolves.toBe(true);
		browser.extension.getViews.mockReturnValue([]);
		await expect(validateMobilePopupTarget(flow)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
	});

	it('rejects a previously authorized target that becomes inactive', async () => {
		const { flow, tab } = installBrowser();
		await expect(canFillHiddenTarget(flow)).resolves.toBe(true);
		tab.active = false;
		await expect(validateMobilePopupTarget(flow)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
	});

	it('rejects an obsolete configuration before querying browser state', async () => {
		const { flow, browser } = installBrowser();
		invalidateConfigurationGeneration();
		await expect(canFillHiddenTarget(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(browser.runtime.getPlatformInfo).not.toHaveBeenCalled();
		expect(browser.tabs.get).not.toHaveBeenCalled();
	});

	it.each(['platform', 'tab'])('rejects configuration changes during the %s query', async (query) => {
		const { flow, tab, browser } = installBrowser();
		const invalidate = async () => {
			invalidateConfigurationGeneration();
			return query === 'platform' ? { os: 'android' } : { ...tab };
		};
		if (query === 'platform') {
			browser.runtime.getPlatformInfo.mockImplementation(invalidate);
		} else {
			browser.tabs.get.mockImplementation(invalidate);
		}
		await expect(canFillHiddenTarget(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it('rechecks generation before completing final popup validation', async () => {
		const { flow, popup, browser } = installBrowser();
		browser.extension.getViews.mockImplementation(() => {
			invalidateConfigurationGeneration();
			return [popup];
		});
		await expect(validateMobilePopupTarget(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});
});
