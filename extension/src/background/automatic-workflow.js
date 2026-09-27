import { MESSAGE, LIMITS, createNonce, isValidNonce, sanitizeAccountList } from '../shared/protocol.js';
import { originFromTabUrl, autofillPathFromUrl } from '../shared/origin.js';
import { getSettings, findBindings } from '../shared/storage.js';
import { hasAutofillSite } from '../shared/autofill-sites.js';
import { sanitizeLoginContext, loginContextsMatch } from '../shared/login-context.js';
import { chooseAutoFillAccountId, matchingLoginAccounts } from '../shared/account-match.js';
import { matchingSiteAccounts } from '../shared/site-match.js';
import { getConfigurationGeneration } from './generation.js';
import { getOfflineSourceRevision, getOfflineSourceChangeToken, getOfflineClockRevision } from './offline-source.js';
import {
	ExtensionError,
	requestSource,
	generateForAccount,
	validateFlowConfiguration,
	assertCurrentGeneration,
	sendDocumentMessage,
} from './workflow.js';

const flows = new Map();
const MAX_DOCUMENTS = 64;
export const AUTO_MESSAGES = [MESSAGE.AUTO_STATUS, MESSAGE.AUTO_DISCOVER, MESSAGE.AUTO_SELECT];

export function invalidateAutomaticFlows() {
	flows.clear();
}

async function senderTarget(sender) {
	const targetOrigin = originFromTabUrl(sender?.url);
	if (
		sender?.id !== chrome.runtime.id ||
		!Number.isInteger(sender?.tab?.id) ||
		sender.tab.incognito ||
		sender.frameId !== 0 ||
		typeof sender.documentId !== 'string' ||
		!sender.documentId ||
		!targetOrigin ||
		(sender.documentLifecycle && sender.documentLifecycle !== 'active')
	) {
		throw new ExtensionError('TARGET_UNAVAILABLE');
	}
	// Chrome can retain the document's original sender.url across pushState.
	// Keep its origin/document identity, but get the live route from the browser;
	// the addressed content probe must independently confirm that same route.
	const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
	const targetPath = autofillPathFromUrl(tab?.url);
	if (!tab || tab.incognito || tab.discarded || tab.frozen || originFromTabUrl(tab.url) !== targetOrigin || !targetPath) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	return { targetOrigin, targetPath, targetTabId: sender.tab.id, targetDocumentId: sender.documentId };
}

function keyFor(target) {
	return `${target.targetTabId}:${target.targetDocumentId}`;
}

async function requireSite(target, instanceOrigin) {
	if (!instanceOrigin || !(await hasAutofillSite(instanceOrigin, target.targetOrigin, target.targetPath))) {
		throw new ExtensionError('PERMISSION_REQUIRED');
	}
	const tab = await chrome.tabs.get(target.targetTabId).catch(() => null);
	if (
		!tab ||
		tab.incognito ||
		tab.discarded ||
		tab.frozen ||
		originFromTabUrl(tab.url) !== target.targetOrigin ||
		autofillPathFromUrl(tab.url) !== target.targetPath ||
		(tab.pendingUrl &&
			(originFromTabUrl(tab.pendingUrl) !== target.targetOrigin || autofillPathFromUrl(tab.pendingUrl) !== target.targetPath))
	) {
		throw new ExtensionError('TARGET_CHANGED');
	}
}

function assertFlow(flow) {
	assertCurrentGeneration(flow);
	if (flows.get(keyFor(flow)) !== flow || Date.now() - flow.createdAt > LIMITS.PENDING_TTL_MS) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (
		flow.sourceRevision &&
		(flow.sourceRevision !== getOfflineSourceRevision(flow.instanceOrigin) ||
			flow.sourceChangeToken !== getOfflineSourceChangeToken(flow.instanceOrigin) ||
			flow.sourceClockRevision !== getOfflineClockRevision(flow.instanceOrigin))
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
}

async function probe(flow, compareLogin = true) {
	await requireSite(flow, flow.instanceOrigin);
	await validateFlowConfiguration(flow);
	assertFlow(flow);
	const response = await sendDocumentMessage(
		flow.targetTabId,
		flow.targetDocumentId,
		{
			type: MESSAGE.AUTO_PROBE,
			episodeNonce: flow.episodeNonce,
			expectedOrigin: flow.targetOrigin,
			expectedTargetPath: flow.targetPath,
		},
		'TARGET_CHANGED',
	);
	assertFlow(flow);
	if (!response?.ok || response.status !== 'ready' || response.origin !== flow.targetOrigin || response.targetPath !== flow.targetPath) {
		throw new ExtensionError('NO_INPUT');
	}
	await requireSite(flow, flow.instanceOrigin);
	assertFlow(flow);
	const login = sanitizeLoginContext(response.loginContext, flow.targetOrigin);
	if (compareLogin && !loginContextsMatch(flow.loginContext, login)) {
		throw new ExtensionError('LOGIN_CHANGED');
	}
	return login;
}

function relevantAccounts(flow) {
	if (flow.loginContext) {
		return matchingLoginAccounts(flow);
	}
	if (flow.retainedBindingIds.length) {
		return flow.accounts.filter((a) => flow.boundAccountIds.includes(a.id));
	}
	return matchingSiteAccounts(flow);
}

async function discover(message, target) {
	if (!isValidNonce(message.episodeNonce)) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const generation = getConfigurationGeneration();
	const { instanceOrigin } = await getSettings();
	await requireSite(target, instanceOrigin);
	for (const [key, flow] of flows) {
		if (Date.now() - flow.createdAt > LIMITS.PENDING_TTL_MS) {
			flows.delete(key);
		}
	}
	const key = keyFor(target);
	if (flows.has(key) && flows.get(key).episodeNonce === message.episodeNonce) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (!flows.has(key) && flows.size >= MAX_DOCUMENTS) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	const flow = {
		...target,
		instanceOrigin,
		configurationGeneration: generation,
		nonce: createNonce(),
		episodeNonce: message.episodeNonce,
		createdAt: Date.now(),
		claimed: false,
	};
	flows.set(key, flow);
	flow.assertAutomaticTarget = async () => {
		assertFlow(flow);
		await requireSite(flow, flow.instanceOrigin);
		assertFlow(flow);
	};
	try {
		flow.loginContext = await probe(flow, false);
		const raw = await requestSource(flow, 'list', { withDiagnostics: true, refresh: message.refreshSource !== false });
		flow.sourceRevision = raw?.sourceRevision ?? null;
		flow.sourceChangeToken = raw?.sourceChangeToken ?? null;
		flow.sourceClockRevision = raw?.sourceClockRevision ?? null;
		flow.accounts = sanitizeAccountList(raw?.accounts || raw);
		if (!flow.accounts) {
			throw new ExtensionError('INVALID_RESPONSE');
		}
		flow.unavailableAccounts = raw?.unavailableAccounts || [];
		const bindings = await findBindings(instanceOrigin, target.targetOrigin);
		flow.retainedBindingIds = bindings.map((binding) => binding.accountId);
		flow.boundAccountIds = flow.retainedBindingIds.filter((id) => flow.accounts.some((account) => account.id === id));
		flow.autoFillAccountId = chooseAutoFillAccountId(flow);
		flow.candidates = relevantAccounts(flow);
		await probe(flow);
		assertFlow(flow);
		return {
			nonce: flow.nonce,
			instanceOrigin,
			revision: flow.sourceRevision,
			clockRevision: flow.sourceClockRevision,
			accounts: flow.candidates,
			autoFillAccountId: flow.autoFillAccountId,
		};
	} catch (error) {
		if (flows.get(key) === flow) {
			flows.delete(key);
		}
		throw error;
	}
}

async function select(message, target) {
	const flow = flows.get(keyFor(target));
	if (
		!flow ||
		flow.claimed ||
		!isValidNonce(message.nonce) ||
		flow.nonce !== message.nonce ||
		flow.episodeNonce !== message.episodeNonce ||
		flow.targetOrigin !== target.targetOrigin ||
		flow.targetPath !== target.targetPath ||
		typeof message.automatic !== 'boolean'
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	const account = flow.candidates?.find((candidate) => candidate.id === message.accountId);
	if (!account || (message.automatic && flow.autoFillAccountId !== account.id)) {
		throw new ExtensionError('AMBIGUOUS_ACCOUNT');
	}
	flow.claimed = true;
	try {
		await probe(flow);
		const prepared = await sendDocumentMessage(
			flow.targetTabId,
			flow.targetDocumentId,
			{
				type: MESSAGE.AUTO_PREPARE,
				nonce: flow.nonce,
				episodeNonce: flow.episodeNonce,
				expectedOrigin: flow.targetOrigin,
				expectedTargetPath: flow.targetPath,
				expectedDigits: account.digits,
				...(flow.loginContext ? { expectedLoginContext: flow.loginContext } : {}),
			},
			'TARGET_CHANGED',
		);
		if (!prepared?.ok || prepared.status !== 'ready') {
			throw new ExtensionError('NO_INPUT');
		}
		assertFlow(flow);
		await probe(flow);
		const generated = await generateForAccount(flow, account, false, undefined, { automatic: message.automatic });
		await probe(flow);
		if (generated.expiresAt - Date.now() < 1000) {
			throw new ExtensionError('CODE_EXPIRED');
		}
		assertFlow(flow);
		const response = await sendDocumentMessage(
			flow.targetTabId,
			flow.targetDocumentId,
			{
				type: MESSAGE.AUTO_FILL,
				nonce: flow.nonce,
				episodeNonce: flow.episodeNonce,
				expectedOrigin: flow.targetOrigin,
				expectedTargetPath: flow.targetPath,
				code: generated.code,
				expiresAt: generated.expiresAt,
			},
			'TARGET_CHANGED',
		);
		if (!response?.ok || response.status !== 'filled') {
			throw new ExtensionError('FILL_FAILED');
		}
		return { status: 'filled' };
	} finally {
		if (flows.get(keyFor(flow)) === flow) {
			flows.delete(keyFor(flow));
		}
	}
}

// Content pages have this deliberately narrow API; settings, secrets and the full vault stay private.
export async function routeAutomaticMessage(message, sender) {
	const target = await senderTarget(sender);
	if (message.targetPath !== target.targetPath) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	if (message.type === MESSAGE.AUTO_STATUS) {
		const { instanceOrigin } = await getSettings();
		try {
			await requireSite(target, instanceOrigin);
			await validateFlowConfiguration({ instanceOrigin, configurationGeneration: getConfigurationGeneration() });
			return { enabled: true };
		} catch {
			return { enabled: false };
		}
	}
	if (message.type === MESSAGE.AUTO_DISCOVER) {
		return discover(message, target);
	}
	if (message.type === MESSAGE.AUTO_SELECT) {
		return select(message, target);
	}
	throw new ExtensionError('INVALID_REQUEST');
}
