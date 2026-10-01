import { MESSAGE, getErrorResponse, isPlainObject } from '../shared/protocol.js';
import { resolveLanguage } from '../shared/i18n.js';
import { getLanguageState, saveLanguageState, isLanguageContentSender } from './language.js';
import { getConfigurationGeneration, invalidateConfigurationGeneration } from './generation.js';
import {
	beginAutofillAuthorization,
	completeAutofillAuthorization,
	cancelAutofillAuthorization,
	clearAutofillAuthorization,
} from './autofill-authorization.js';
import {
	normalizeInstanceOrigin,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	autofillPathFromUrl,
	normalizeAutofillPath,
	normalizeAutofillScope,
	AUTOFILL_SITE_SCOPE,
} from '../shared/origin.js';
import { clearOfflineSource, cancelOfflineRequests } from './offline-source.js';
import { AUTO_MESSAGES, routeAutomaticMessage, invalidateAutomaticFlows } from './automatic-workflow.js';
import { reconcileAutofillScripts, observeAutofillRenderer } from './autofill-registration.js';
import { reconcileSourceWatcher, observeSourceRenderer } from './source-registration.js';
import { SOURCE_MESSAGES, routeSourceMessage, startSourceUpdates } from './source-updates.js';
import {
	readAutofillSites,
	setAutofillSite,
	restoreAutofillSites,
	isPermissionPatternInUse,
	pruneRevokedAutofillSites,
} from '../shared/autofill-sites.js';
import {
	clearPendingFlow,
	getConnectionStatus,
	getSettings,
	lockStorageToTrustedContexts,
	removeBinding,
	saveSettings,
	setFavorite,
} from '../shared/storage.js';
import {
	ExtensionError,
	checkInstance,
	copyAccountCode,
	copyAccountCodes,
	fillAccount,
	fillBoundAccountFromCommand,
	rememberAccountBinding,
	openInstance,
	startFlow,
	getAutofillContext,
	refreshOfflineAccounts,
	importWebOfflineCache,
	disableOfflineCache,
	getOfflineCacheStatus,
	getOfflineCacheIcons,
	sendDocumentMessage,
} from './workflow.js';
import { originFromTabUrl, permissionPatternCoversOrigin } from '../shared/origin.js';

const storageReady = lockStorageToTrustedContexts();
let configurationQueue = Promise.resolve();
const CONFIGURATION_MESSAGES = [MESSAGE.SAVE_INSTANCE, MESSAGE.CLEAR_OFFLINE, MESSAGE.SET_AUTOFILL_SITE];
// Source listeners must not start while an upgrade is still disconnecting a
// legacy connection. Keep the rejection on storageReady for every request.
void storageReady.then(startSourceUpdates).catch(() => {});

async function reconcileScripts(options) {
	const outcomes = await Promise.allSettled([reconcileAutofillScripts(options), reconcileSourceWatcher(options)]);
	const failure = outcomes.find((outcome) => outcome.status === 'rejected');
	if (failure) {
		throw failure.reason;
	}
}

function isTrustedExtensionPage(sender) {
	if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') {
		return false;
	}
	return sender.url.startsWith(chrome.runtime.getURL(''));
}

async function saveInstanceFromMessage(message) {
	const nextOrigin = normalizeInstanceOrigin(message.instanceOrigin);
	if (
		message.connection !== undefined &&
		(!isPlainObject(message.connection) || !['session', 'offline'].includes(message.connection.mode))
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const expected = message.expectedConnection;
	if (
		expected !== undefined &&
		(!isPlainObject(expected) ||
			typeof expected.instanceOrigin !== 'string' ||
			!expected.instanceOrigin ||
			!['session', 'offline'].includes(expected.mode))
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (expected !== undefined && expected.instanceOrigin !== nextOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	const nextPattern = originToPermissionPattern(nextOrigin);
	if (!(await chrome.permissions.contains({ origins: [nextPattern] }))) {
		throw new ExtensionError('PERMISSION_REQUIRED');
	}

	const previous = await getSettings();
	if (
		expected !== undefined &&
		(previous.instanceOrigin !== expected.instanceOrigin || (await getConnectionStatus(nextOrigin)).mode !== expected.mode)
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (previous.instanceOrigin !== nextOrigin || message.connection?.mode !== 'offline') {
		await clearOfflineSource();
	}
	await saveSettings(nextOrigin, message.connection);
	await clearPendingFlow();

	if (previous.instanceOrigin && previous.instanceOrigin !== nextOrigin) {
		const previousPattern = originToPermissionPattern(previous.instanceOrigin);
		if (previousPattern !== nextPattern && !(await isPermissionPatternInUse(previousPattern, nextOrigin))) {
			await chrome.permissions.remove({ origins: [previousPattern] }).catch(() => false);
		}
	}
	// Saving the connection is also an explicit recovery action for runners
	// paused after expired authentication, even when origin/mode are unchanged.
	await reconcileScripts({ refreshCurrent: true });
	return { instanceOrigin: nextOrigin };
}

// targetPath is one page path or AUTOFILL_SITE_SCOPE. A site-wide grant is
// made on one page, pagePath, which is also the page the popup checks.
// beforeActivate runs once the grant is saved, before automatic fills start.
async function setAutofillSiteFromMessage(message, checkCurrent, { authorization = false, beforeActivate } = {}) {
	let targetPath;
	let pagePath;
	try {
		targetPath = normalizeAutofillScope(message.targetPath);
		pagePath =
			targetPath !== AUTOFILL_SITE_SCOPE ? targetPath : message.enabled === true ? normalizeAutofillPath(message.pagePath) : undefined;
	} catch {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (
		targetPath !== message.targetPath ||
		(targetPath === AUTOFILL_SITE_SCOPE && pagePath !== undefined && pagePath !== message.pagePath)
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (message.enabled && message.expectedTarget) {
		const target = message.expectedTarget;
		if (
			target.origin !== message.targetOrigin ||
			target.targetPath !== pagePath ||
			!Number.isInteger(target.tabId) ||
			typeof target.documentId !== 'string'
		) {
			throw new ExtensionError('TARGET_CHANGED');
		}
		const tab = await chrome.tabs.get(target.tabId);
		if (tab.incognito || originFromTabUrl(tab.url) !== target.origin || autofillPathFromUrl(tab.url) !== pagePath || tab.pendingUrl) {
			throw new ExtensionError('TARGET_CHANGED');
		}
		const ping = await sendDocumentMessage(target.tabId, target.documentId, { type: MESSAGE.TARGET_PING }, 'TARGET_CHANGED');
		if (!ping?.ok || ping.origin !== target.origin || ping.targetPath !== pagePath) {
			throw new ExtensionError('TARGET_CHANGED');
		}
	}
	const previousSites = await readAutofillSites(message.instanceOrigin);
	await checkCurrent?.();
	const sites = await setAutofillSite(message.instanceOrigin, message.targetOrigin, targetPath, message.enabled, { pagePath });
	// A popup fill that asked for this grant in the same click still owns its
	// flow. Grants never widen what a flow can do: automatic fills check them again.
	if (!authorization) {
		await clearPendingFlow();
	}
	if (!message.enabled) {
		const pattern = targetOriginToPermissionPattern(message.targetOrigin);
		if (!(await isPermissionPatternInUse(pattern, message.instanceOrigin))) {
			// Browser-managed grants may not be removable. The saved site policy is
			// already off, and runners must still be stopped even in that case.
			await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
		}
	}
	await beforeActivate?.();
	try {
		await checkCurrent?.();
		await reconcileScripts();
	} catch {
		const grantsOf = (list) => JSON.stringify(list.filter((site) => site.targetOrigin === message.targetOrigin));
		if (message.enabled && grantsOf(previousSites) !== grantsOf(sites)) {
			// Put back the origin's previous grants, including page grants a
			// site-wide grant replaced.
			await restoreAutofillSites(message.instanceOrigin, message.targetOrigin, previousSites);
			await reconcileScripts().catch(() => {});
		}
		throw new ExtensionError('AUTO_UNAVAILABLE');
	}
	return { instanceOrigin: message.instanceOrigin, sites };
}

// The popup can ask for a grant while filling an account the user wants filled
// on this website from now on. The browser may close the popup during the
// permission prompt, so the grant also remembers that account, before the
// automatic fill of an open page looks for its account.
function enableAutofillFromAuthorization(message, checkCurrent) {
	const beforeActivate = message.rememberAccountId
		? () =>
				// Filling saves the same binding; a failure here must not undo the grant.
				rememberAccountBinding({
					instanceOrigin: message.instanceOrigin,
					targetOrigin: message.targetOrigin,
					accountId: message.rememberAccountId,
					accountEmail: message.rememberAccountEmail,
				}).catch(() => {})
		: undefined;
	return setAutofillSiteFromMessage(message, checkCurrent, { authorization: true, beforeActivate });
}

async function routeMessage(message, generation) {
	await storageReady;
	if (!isPlainObject(message) || typeof message.type !== 'string') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (message.type === MESSAGE.GET_LANGUAGE) {
		return getLanguageState();
	}
	if (message.type === MESSAGE.SAVE_LANGUAGE) {
		return saveLanguageState(message.preference);
	}
	if (!CONFIGURATION_MESSAGES.includes(message.type)) {
		await configurationQueue;
	}

	switch (message.type) {
		case MESSAGE.BEGIN_AUTOFILL_AUTHORIZATION:
		case MESSAGE.COMPLETE_AUTOFILL_AUTHORIZATION:
		case MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION: {
			const operation = configurationQueue.then(() => {
				if (message.type === MESSAGE.BEGIN_AUTOFILL_AUTHORIZATION) {
					return beginAutofillAuthorization(message, generation, enableAutofillFromAuthorization);
				}
				if (message.type === MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION) {
					return cancelAutofillAuthorization(message.requestId);
				}
				return completeAutofillAuthorization(message.requestId, enableAutofillFromAuthorization, generation);
			});
			configurationQueue = operation.catch(() => {});
			return operation;
		}
		case MESSAGE.GET_SETTINGS:
			return getSettings();
		case MESSAGE.GET_AUTOFILL_CONTEXT:
			return getAutofillContext();
		case MESSAGE.GET_AUTOFILL_SITES: {
			const { instanceOrigin } = await getSettings();
			return { instanceOrigin, sites: instanceOrigin ? await readAutofillSites(instanceOrigin) : [] };
		}
		case MESSAGE.SET_AUTOFILL_SITE: {
			const operation = configurationQueue.then(async () => {
				await clearAutofillAuthorization();
				return setAutofillSiteFromMessage(message);
			});
			configurationQueue = operation.catch(() => {});
			return operation;
		}
		case MESSAGE.SET_FAVORITE:
			return { favoriteAccountIds: await setFavorite(message.instanceOrigin, message.accountId, message.favorite) };
		case MESSAGE.START_FLOW:
			return startFlow({ refreshSource: message.refreshSource === true, preferCache: message.preferCache === true });
		case MESSAGE.FILL_ACCOUNT:
			return fillAccount(message);
		case MESSAGE.COPY_ACCOUNT_CODES:
			return copyAccountCodes(message);
		case MESSAGE.COPY_ACCOUNT_CODE:
			return copyAccountCode(message);
		case MESSAGE.CHECK_INSTANCE:
			return checkInstance();
		case MESSAGE.REFRESH_OFFLINE_ACCOUNTS:
			if (typeof message.instanceOrigin !== 'string' || !message.instanceOrigin) {
				throw new ExtensionError('INVALID_REQUEST');
			}
			return refreshOfflineAccounts(message.instanceOrigin, { clockOnly: message.clockOnly === true });
		case MESSAGE.OFFLINE_STATUS:
			return getOfflineCacheStatus();
		case MESSAGE.OFFLINE_ICONS:
			return getOfflineCacheIcons();
		case MESSAGE.IMPORT_OFFLINE:
			await configurationQueue;
			if (message.instanceOrigin !== undefined && (typeof message.instanceOrigin !== 'string' || !message.instanceOrigin)) {
				throw new ExtensionError('INVALID_REQUEST');
			}
			return importWebOfflineCache(message.instanceOrigin);
		case MESSAGE.CLEAR_OFFLINE: {
			if (message.instanceOrigin !== undefined && (typeof message.instanceOrigin !== 'string' || !message.instanceOrigin)) {
				throw new ExtensionError('INVALID_REQUEST');
			}
			const operation = configurationQueue.then(async () => {
				await clearAutofillAuthorization();
				const result = await disableOfflineCache(message.instanceOrigin);
				await reconcileScripts();
				return result;
			});
			configurationQueue = operation.catch(() => {});
			return operation;
		}
		case MESSAGE.OPEN_INSTANCE:
			await configurationQueue;
			return openInstance();
		case MESSAGE.SAVE_INSTANCE: {
			const operation = configurationQueue.then(async () => {
				await clearAutofillAuthorization();
				return saveInstanceFromMessage(message);
			});
			configurationQueue = operation.catch(() => {});
			return operation;
		}
		case MESSAGE.REMOVE_BINDING:
			await removeBinding(message.instanceOrigin, message.targetOrigin, message.accountId);
			return { removed: true };
		default:
			throw new ExtensionError('INVALID_REQUEST');
	}
}

async function errorResponse(error) {
	// Read the preference for this response, never mutate a shared worker locale.
	// Even a storage failure still returns a safe localized public error.
	let language = resolveLanguage('auto');
	try {
		({ language } = await getLanguageState());
	} catch {
		// Fall back to the browser's locale when preferences are unavailable.
	}
	return getErrorResponse(error, language);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === MESSAGE.LANGUAGE_CHANGED) {
		return false;
	}
	if (message?.type === MESSAGE.GET_LANGUAGE && isLanguageContentSender(sender)) {
		Promise.resolve(storageReady)
			.then(getLanguageState)
			.then((data) => sendResponse({ ok: true, data }))
			.catch(async (error) => sendResponse(await errorResponse(error)));
		return true;
	}
	if (SOURCE_MESSAGES.includes(message?.type)) {
		observeSourceRenderer(sender);
		Promise.resolve()
			.then(async () => {
				await storageReady;
				await configurationQueue;
				return routeSourceMessage(message, sender);
			})
			.then((data) => sendResponse({ ok: true, data }))
			.catch(async (error) => sendResponse(await errorResponse(error)));
		return true;
	}
	if (AUTO_MESSAGES.includes(message?.type)) {
		observeAutofillRenderer(sender);
		Promise.resolve()
			.then(async () => {
				await storageReady;
				await configurationQueue;
				return routeAutomaticMessage(message, sender);
			})
			.then((data) => sendResponse({ ok: true, data }))
			.catch(async (error) => sendResponse(await errorResponse(error)));
		return true;
	}
	if (!isTrustedExtensionPage(sender)) {
		return false;
	}
	if (CONFIGURATION_MESSAGES.includes(message?.type)) {
		cancelOfflineRequests();
		invalidateConfigurationGeneration();
		invalidateAutomaticFlows();
	}
	if (message?.type === MESSAGE.REMOVE_BINDING) {
		invalidateAutomaticFlows();
	}

	routeMessage(message, getConfigurationGeneration())
		.then((data) => sendResponse({ ok: true, data }))
		.catch(async (error) => sendResponse(await errorResponse(error)));
	return true;
});

chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason === 'install') {
		chrome.runtime.openOptionsPage();
	}
	queueAutofillReconciliation();
});

function queueAutofillReconciliation() {
	const operation = configurationQueue.then(async () => {
		await storageReady;
		await completeAutofillAuthorization(undefined, enableAutofillFromAuthorization).catch(() => {});
		await pruneRevokedAutofillSites();
		await reconcileScripts();
	});
	configurationQueue = operation.catch(() => {});
}
chrome.runtime.onStartup?.addListener(queueAutofillReconciliation);
chrome.permissions.onAdded?.addListener(queueAutofillReconciliation);

// A grant can outlive a popup and worker process. Recover only the short-lived
// stored intent; its source, document and permissions are checked again.
const recoveringAuthorization = configurationQueue.then(async () => {
	await storageReady;
	await completeAutofillAuthorization(undefined, enableAutofillFromAuthorization);
});
configurationQueue = recoveringAuthorization.catch(() => {});

// Keyboard commands are absent on Firefox for Android.
chrome.commands?.onCommand?.addListener?.(async (command) => {
	if (command !== 'fill-otp') {
		return;
	}

	try {
		await storageReady;
		await configurationQueue;
		await fillBoundAccountFromCommand();
		await chrome.action.setBadgeBackgroundColor({ color: '#147d64' });
		await chrome.action.setBadgeText({ text: 'OK' });
		setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
	} catch {
		try {
			await chrome.action.openPopup();
		} catch {
			await chrome.runtime.openOptionsPage();
		}
	}
});

chrome.permissions.onRemoved.addListener((removed) => {
	cancelOfflineRequests();
	invalidateConfigurationGeneration();
	invalidateAutomaticFlows();
	const removedPatterns = Array.isArray(removed?.origins) ? [...removed.origins] : [];
	const operation = configurationQueue.then(async () => {
		await storageReady;
		await clearAutofillAuthorization().catch(() => {});
		const outcomes = await Promise.allSettled([
			clearPendingFlow(),
			pruneRevokedAutofillSites(removedPatterns),
			(async () => {
				let shouldClear = true;
				try {
					const { instanceOrigin } = await getSettings();
					shouldClear =
						!instanceOrigin ||
						removedPatterns.some((pattern) => permissionPatternCoversOrigin(pattern, instanceOrigin)) ||
						!(await chrome.permissions.contains({ origins: [originToPermissionPattern(instanceOrigin)] }));
				} catch {
					shouldClear = true;
				}
				if (shouldClear) {
					await clearOfflineSource();
				}
			})(),
		]);
		const reconciliation = await Promise.allSettled([reconcileScripts({ cleanupPatterns: removedPatterns })]);
		const failure = [...outcomes, ...reconciliation].find((outcome) => outcome.status === 'rejected');
		if (failure) {
			throw failure.reason;
		}
	});
	configurationQueue = operation.catch(() => {});
});
