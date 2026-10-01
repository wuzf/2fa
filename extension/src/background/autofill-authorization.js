import { MESSAGE, isPlainObject, isValidNonce, sanitizeAccountMetadata } from '../shared/protocol.js';
import { readAccountEmail } from '../shared/account-match.js';
import { usesLoginEmailScope } from '../shared/login-context.js';
import {
	normalizeInstanceOrigin,
	normalizeAutofillTargetOrigin,
	originFromTabUrl,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	autofillPathFromUrl,
	normalizeAutofillPath,
	normalizeAutofillScope,
	AUTOFILL_SITE_SCOPE,
} from '../shared/origin.js';
import { getConnectionStatus, getSettings } from '../shared/storage.js';
import { readAutofillSites } from '../shared/autofill-sites.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError, sendDocumentMessage } from './workflow.js';

const KEY = 'autofillAuthorization';
const TTL_MS = 2 * 60 * 1000;
let invalidated = false;
const cancelledRequests = new Set();

function validId(requestId) {
	if (!isValidNonce(requestId)) {
		throw new ExtensionError('INVALID_REQUEST');
	}
}

function assertFresh(intent, generation) {
	if (
		invalidated ||
		cancelledRequests.has(intent.requestId) ||
		getConfigurationGeneration() !== generation ||
		!Number.isSafeInteger(intent.createdAt) ||
		Date.now() < intent.createdAt ||
		Date.now() - intent.createdAt > TTL_MS
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
}

// The page the grant is made on: the page itself, or for a site-wide grant
// the page recorded with it.
function intentPage(intent) {
	return intent.targetPath === AUTOFILL_SITE_SCOPE ? intent.pagePath : intent.targetPath;
}

async function validateIntent(intent, generation) {
	assertFresh(intent, generation);
	const pagePath = intentPage(intent);
	try {
		if (
			normalizeAutofillScope(intent.targetPath) !== intent.targetPath ||
			normalizeAutofillPath(pagePath) !== pagePath ||
			intent.expectedTarget?.targetPath !== pagePath
		) {
			throw new Error('Invalid path');
		}
	} catch {
		// Intents from before page grants carry no path and cannot become grants.
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (
		(await getSettings()).instanceOrigin !== intent.instanceOrigin ||
		(await getConnectionStatus(intent.instanceOrigin)).mode !== intent.mode
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (!(await chrome.permissions.contains({ origins: [originToPermissionPattern(intent.instanceOrigin)] }))) {
		throw new ExtensionError('PERMISSION_REQUIRED');
	}
	const target = intent.expectedTarget;
	const tab = await chrome.tabs.get(target.tabId);
	if (
		tab.incognito ||
		tab.discarded ||
		tab.frozen ||
		tab.pendingUrl ||
		originFromTabUrl(tab.url) !== intent.targetOrigin ||
		autofillPathFromUrl(tab.url) !== pagePath
	) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	const ping = await sendDocumentMessage(target.tabId, target.documentId, { type: MESSAGE.TARGET_PING }, 'TARGET_CHANGED');
	if (!ping?.ok || ping.origin !== intent.targetOrigin || ping.targetPath !== pagePath) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	assertFresh(intent, generation);
}

async function readIntent() {
	return (await chrome.storage.session.get(KEY))[KEY] || null;
}

function publicState(intent, result = {}) {
	return {
		requestId: intent.requestId,
		status: intent.status,
		...(intent.instanceOrigin ? { instanceOrigin: intent.instanceOrigin } : {}),
		...result,
	};
}

// All mutations are invoked inside the background configuration queue. The
// permission prompt itself is never awaited here, so onAdded can finish it.
// targetPath is the page path, or AUTOFILL_SITE_SCOPE with the page as pagePath.
// A popup fill may add rememberAccount, the account it fills, which the grant
// then remembers for this website.
export async function beginAutofillAuthorization(message, generation, enable) {
	validId(message.requestId);
	if (invalidated) {
		await clearAutofillAuthorization();
	}
	if (cancelledRequests.has(message.requestId)) {
		return { requestId: message.requestId, status: 'cancelled' };
	}
	const previous = await readIntent();
	if (previous?.requestId === message.requestId) {
		return completeAutofillAuthorization(message.requestId, enable, generation);
	}
	const target = message.expectedTarget;
	if (
		!isValidNonce(message.configurationGeneration) ||
		!isPlainObject(target) ||
		!Number.isInteger(target.tabId) ||
		target.tabId < 0 ||
		typeof target.documentId !== 'string' ||
		!target.documentId ||
		target.documentId.length > 200 ||
		target.origin !== message.targetOrigin ||
		target.targetPath !== (message.targetPath === AUTOFILL_SITE_SCOPE ? message.pagePath : message.targetPath) ||
		!['session', 'offline'].includes(message.mode)
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const instanceOrigin = normalizeInstanceOrigin(message.instanceOrigin);
	const targetOrigin = normalizeAutofillTargetOrigin(message.targetOrigin);
	let targetPath;
	let pagePath;
	try {
		targetPath = normalizeAutofillScope(message.targetPath);
		pagePath = normalizeAutofillPath(target.targetPath);
	} catch {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const rememberAccount = message.rememberAccount === undefined ? null : sanitizeAccountMetadata(message.rememberAccount);
	if (
		instanceOrigin !== message.instanceOrigin ||
		targetOrigin !== message.targetOrigin ||
		instanceOrigin === targetOrigin ||
		targetPath !== message.targetPath ||
		pagePath !== target.targetPath ||
		(message.rememberAccount !== undefined && !rememberAccount)
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (message.configurationGeneration !== generation) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	const intent = {
		requestId: message.requestId,
		instanceOrigin,
		mode: message.mode,
		targetOrigin,
		targetPath,
		...(targetPath === AUTOFILL_SITE_SCOPE ? { pagePath } : {}),
		// Keep only the account id, and the login email where it tells accounts apart.
		...(rememberAccount
			? {
					rememberAccountId: rememberAccount.id,
					...(usesLoginEmailScope(targetOrigin) ? { rememberAccountEmail: readAccountEmail(rememberAccount.account) } : {}),
				}
			: {}),
		expectedTarget: { tabId: target.tabId, documentId: target.documentId, origin: targetOrigin, targetPath: pagePath },
		createdAt: Date.now(),
		status: 'pending',
	};
	await validateIntent(intent, generation);
	await chrome.storage.session.set({ [KEY]: intent });
	try {
		assertFresh(intent, generation);
		// The permission event may already have fired before the intent was saved.
		return await completeAutofillAuthorization(intent.requestId, enable, generation);
	} catch (error) {
		await clearAutofillAuthorization();
		throw error;
	}
}

export async function completeAutofillAuthorization(requestId, enable, generation = getConfigurationGeneration()) {
	if (requestId !== undefined) {
		validId(requestId);
	}
	if (invalidated) {
		await clearAutofillAuthorization();
		return { requestId, status: 'cancelled' };
	}
	const intent = await readIntent();
	if (!intent || (requestId !== undefined && requestId !== intent.requestId)) {
		return { requestId, status: 'cancelled' };
	}
	if (intent.status === 'cancelled' || cancelledRequests.has(intent.requestId)) {
		return { ...publicState(intent), status: 'cancelled' };
	}
	try {
		await validateIntent(intent, generation);
		if (!(await chrome.permissions.contains({ origins: [targetOriginToPermissionPattern(intent.targetOrigin)] }))) {
			if (intent.status === 'enabled') {
				throw new ExtensionError('PERMISSION_REQUIRED');
			}
			return publicState(intent);
		}
		if (intent.status === 'enabled') {
			const sites = await readAutofillSites(intent.instanceOrigin);
			if (!sites.some((site) => site.targetOrigin === intent.targetOrigin && site.targetPath === intent.targetPath)) {
				throw new ExtensionError('REQUEST_EXPIRED');
			}
			assertFresh(intent, generation);
			return publicState(intent, { sites });
		}
		await validateIntent(intent, generation);
		const result = await enable({ ...intent, enabled: true }, () => validateIntent(intent, generation));
		intent.status = 'enabled';
		await chrome.storage.session.set({ [KEY]: intent });
		return publicState(intent, result);
	} catch (error) {
		await clearAutofillAuthorization();
		throw error;
	}
}

export async function cancelAutofillAuthorization(requestId) {
	validId(requestId);
	cancelledRequests.add(requestId);
	const intent = await readIntent();
	if (intent && intent.requestId !== requestId) {
		return { requestId, status: 'cancelled' };
	}
	if (intent?.status === 'enabled') {
		return publicState(intent);
	}
	const cancelled = { requestId, status: 'cancelled', createdAt: Date.now() };
	try {
		await chrome.storage.session.set({ [KEY]: cancelled });
	} catch (error) {
		// A failed write must not leave a reusable pending authorization behind.
		await chrome.storage.session.remove(KEY);
		throw error;
	}
	return publicState(cancelled);
}

export async function clearAutofillAuthorization() {
	invalidated = true;
	try {
		// Persist the cancellation before removal. If removal fails, a restarted
		// worker sees the tombstone instead of restoring a revoked request.
		await chrome.storage.session.set({ [KEY]: { status: 'cancelled' } });
	} catch {
		await chrome.storage.session.remove(KEY);
		invalidated = false;
		return;
	}
	await chrome.storage.session.remove(KEY);
	invalidated = false;
}
