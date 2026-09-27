import { MESSAGE } from '../shared/protocol.js';
import { resolveLanguage } from '../shared/i18n.js';
import { getLanguagePreference, saveLanguagePreference } from '../shared/storage.js';
import { originFromTabUrl } from '../shared/origin.js';

let languageQueue = Promise.resolve();

export function isLanguageContentSender(sender) {
	return Boolean(
		sender?.id === chrome.runtime.id &&
		Number.isInteger(sender.tab?.id) &&
		sender.tab.id >= 0 &&
		!sender.tab.incognito &&
		!sender.tab.pendingUrl &&
		sender.frameId === 0 &&
		originFromTabUrl(sender.url) &&
		originFromTabUrl(sender.url) === originFromTabUrl(sender.tab.url),
	);
}

export async function getLanguageState() {
	await languageQueue;
	const preference = await getLanguagePreference();
	return { preference, language: resolveLanguage(preference) };
}

async function broadcastLanguage(state) {
	const message = { type: MESSAGE.LANGUAGE_CHANGED, ...state };
	// Delivery is best effort: closed popups and pages without an injected
	// renderer must not turn a successfully saved preference into an error.
	await Promise.resolve()
		.then(() => chrome.runtime.sendMessage(message))
		.catch(() => {});
	const tabs = await Promise.resolve()
		.then(() => chrome.tabs.query({}))
		.catch(() => []);
	await Promise.allSettled(
		tabs.map(async (tab) => {
			const origin = originFromTabUrl(tab.url);
			if (!origin || !Number.isInteger(tab.id) || tab.id < 0 || tab.incognito || tab.pendingUrl) {
				return;
			}
			const url = new URL(origin);
			// Inspect existing grants only. Language changes never request hosts,
			// inject scripts, reconnect a vault, or access content-side storage.
			if ((await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) === true) {
				await chrome.tabs.sendMessage(tab.id, message);
			}
		}),
	);
}

export function saveLanguageState(preference) {
	const operation = languageQueue.then(async () => {
		await saveLanguagePreference(preference);
		const state = { preference, language: resolveLanguage(preference) };
		await broadcastLanguage(state);
		return state;
	});
	languageQueue = operation.catch(() => {});
	return operation;
}
