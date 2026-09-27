import { sanitizeLoginContext, loginContextsMatch } from '../shared/login-context.js';
import { MESSAGE, LIMITS, createNonce, isValidNonce } from '../shared/protocol.js';
import { originFromTabUrl, autofillPathFromUrl } from '../shared/origin.js';
import { readAutofillSites } from '../shared/autofill-sites.js';
import { clearPendingFlow, getSettings, getConnectionStatus, updatePendingFlow } from '../shared/storage.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError, throwFromResponse } from './errors.js';
import { requireSettings, validateFlowConfiguration, assertCurrentGeneration } from './configuration.js';
import { injectScript, sendDocumentMessage } from './browser-access.js';

// Own the captured document, login identity, and one-use request claims together.
// Reading authorization context must remain possible without source access.
const claimedNonces = new Set();

export async function captureTarget(instanceOrigin, configurationGeneration) {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];
	const targetOrigin = originFromTabUrl(tab?.url);
	const targetPath = autofillPathFromUrl(tab?.url);
	if (tab?.incognito) {
		throw new ExtensionError('TARGET_UNAVAILABLE');
	}

	let documentId = null;
	let loginContext = null;
	if (Number.isInteger(tab?.id) && targetOrigin && targetOrigin !== instanceOrigin) {
		try {
			documentId = await injectScript(tab.id, 'content.js');
			const identity = await sendDocumentMessage(tab.id, documentId, { type: MESSAGE.TARGET_PING }, 'TARGET_CHANGED');
			loginContext = sanitizeLoginContext(identity?.loginContext, targetOrigin);
			if (!identity?.ok || identity.origin !== targetOrigin || !targetPath || identity.targetPath !== targetPath) {
				documentId = null;
			}
		} catch {
			// Browser pages and restricted sites still allow viewing and copying.
			documentId = null;
		}
	}
	const flow = {
		nonce: createNonce(),
		createdAt: Date.now(),
		configurationGeneration,
		instanceOrigin,
		viewOnly: !documentId,
		...(documentId && loginContext ? { loginContext } : {}),
		targetOrigin: documentId ? targetOrigin : null,
		targetPath: documentId ? targetPath : null,
		targetTabId: documentId ? tab.id : null,
		targetFrameId: 0,
		targetDocumentId: documentId,
	};
	return flow;
}

export async function getAutofillContext() {
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await requireSettings();
	const target = await captureTarget(instanceOrigin, configurationGeneration);
	const { mode: authMode } = await getConnectionStatus(instanceOrigin);
	const sites = await readAutofillSites(instanceOrigin);
	await validateCapturedTarget(target);
	if ((await getSettings()).instanceOrigin !== instanceOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	assertCurrentGeneration(target);
	return {
		instanceOrigin,
		configurationGeneration,
		authMode,
		canFill: !target.viewOnly,
		targetOrigin: target.targetOrigin,
		targetPath: target.targetPath,
		targetTabId: target.targetTabId,
		targetDocumentId: target.targetDocumentId,
		...(target.loginContext ? { loginContext: target.loginContext } : {}),
		sites,
	};
}

export async function validateCapturedTarget(flow) {
	if (flow.viewOnly) {
		return flow;
	}
	let tab;
	try {
		tab = await chrome.tabs.get(flow.targetTabId);
	} catch {
		throw new ExtensionError('TARGET_CHANGED');
	}
	if (
		tab.discarded ||
		tab.frozen ||
		tab.incognito ||
		tab.pendingUrl ||
		originFromTabUrl(tab.url) !== flow.targetOrigin ||
		autofillPathFromUrl(tab.url) !== flow.targetPath
	) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	const identity = await sendDocumentMessage(flow.targetTabId, flow.targetDocumentId, { type: MESSAGE.TARGET_PING }, 'TARGET_CHANGED');
	if (!identity?.ok || identity.origin !== flow.targetOrigin || identity.targetPath !== flow.targetPath) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	if (!loginContextsMatch(flow.loginContext, sanitizeLoginContext(identity.loginContext, flow.targetOrigin))) {
		throw new ExtensionError('LOGIN_CHANGED');
	}
	return flow;
}

export async function claimPendingFlow(nonce) {
	if (!isValidNonce(nonce) || claimedNonces.has(nonce)) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	claimedNonces.add(nonce);

	let flow;
	try {
		flow = await updatePendingFlow((current) => {
			if (!current || current.claimed || current.nonce !== nonce || Date.now() - current.createdAt > LIMITS.PENDING_TTL_MS) {
				throw new ExtensionError('REQUEST_EXPIRED');
			}
			return { ...current, claimed: true };
		});
		await validateFlowConfiguration(flow);
		return await validateCapturedTarget(flow);
	} catch (error) {
		claimedNonces.delete(nonce);
		throw error;
	}
}

export async function consumeClaim(flow) {
	await validateFlowConfiguration(flow);
	await updatePendingFlow((current) => {
		if (!current || current.nonce !== flow.nonce || !current.claimed || Date.now() - current.createdAt > LIMITS.PENDING_TTL_MS) {
			throw new ExtensionError('REQUEST_EXPIRED');
		}
		return null;
	});
}

export async function discardClaim(nonce) {
	await clearPendingFlow(nonce);
	claimedNonces.delete(nonce);
}

export async function prepareTarget(flow, account, confirmFocused = false) {
	const response = await sendDocumentMessage(
		flow.targetTabId,
		flow.targetDocumentId,
		{
			type: MESSAGE.PREPARE_TARGET,
			nonce: flow.nonce,
			expectedDigits: account.digits,
			...(confirmFocused ? { confirmFocused: true } : {}),
			expectedOrigin: flow.targetOrigin,
			expectedTargetPath: flow.targetPath,
			...(flow.loginContext ? { expectedLoginContext: flow.loginContext } : {}),
		},
		'TARGET_CHANGED',
	);

	if (!response?.ok) {
		throwFromResponse(response, 'NO_INPUT');
	}
	if (response.status !== 'ready') {
		const statusToCode = {
			ambiguous: 'AMBIGUOUS_INPUT',
			not_found: 'NO_INPUT',
		};
		throw new ExtensionError(statusToCode[response.status] || 'NO_INPUT');
	}
}
