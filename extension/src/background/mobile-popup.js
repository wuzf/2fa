import { originFromTabUrl, autofillPathFromUrl } from '../shared/origin.js';
import { assertCurrentGeneration } from './configuration.js';
import { ExtensionError } from './errors.js';

// A Firefox Android popup can cover its active tab, making that document hidden.
// Only a live manual action in the focused extension popup may allow that state.
function hasManualPopup(flow) {
	try {
		const popupUrl = chrome.runtime.getURL('popup.html');
		if (!popupUrl.startsWith('moz-extension://')) {
			return false;
		}
		return chrome.extension.getViews({ type: 'popup' }).some((view) => {
			const document = view.document;
			return (
				view.location.href === popupUrl &&
				document.visibilityState === 'visible' &&
				document.hasFocus() &&
				document.documentElement?.dataset.manualFillNonce === flow.nonce
			);
		});
	} catch {
		return false;
	}
}

export async function canFillHiddenTarget(flow) {
	assertCurrentGeneration(flow);
	if (typeof chrome.runtime?.getPlatformInfo !== 'function' || typeof chrome.extension?.getViews !== 'function') {
		return false;
	}
	let platform;
	try {
		platform = await chrome.runtime.getPlatformInfo();
	} catch {
		return false;
	}
	assertCurrentGeneration(flow);
	if (platform?.os !== 'android') {
		return false;
	}
	let tab;
	try {
		tab = await chrome.tabs.get(flow.targetTabId);
	} catch {
		return false;
	}
	assertCurrentGeneration(flow);
	return (
		tab?.id === flow.targetTabId &&
		tab.active === true &&
		tab.incognito === false &&
		!tab.discarded &&
		!tab.frozen &&
		!tab.pendingUrl &&
		originFromTabUrl(tab.url) === flow.targetOrigin &&
		autofillPathFromUrl(tab.url) === flow.targetPath &&
		hasManualPopup(flow)
	);
}

export async function validateMobilePopupTarget(flow) {
	if (!(await canFillHiddenTarget(flow))) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	assertCurrentGeneration(flow);
}
