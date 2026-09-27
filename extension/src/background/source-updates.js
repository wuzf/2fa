import { MESSAGE } from '../shared/protocol.js';
import { getSettings, getConnectionStatus } from '../shared/storage.js';
import { autofillPathFromUrl, originFromTabUrl, targetOriginToPermissionPattern } from '../shared/origin.js';
import { readAutofillSites } from '../shared/autofill-sites.js';
import { getConfigurationGeneration } from './generation.js';
import { invalidateAutomaticFlows } from './automatic-workflow.js';
import {
	getOfflineSourceRevision,
	getOfflineClockRevision,
	markOfflineSourceDirty,
	onOfflineSourceChange,
	onOfflineIconsChange,
} from './offline-source.js';
import { ExtensionError, refreshOfflineAccounts, sendDocumentMessage, validateFlowConfiguration } from './workflow.js';

export const SOURCE_MESSAGES = [MESSAGE.SOURCE_STATUS, MESSAGE.SOURCE_DIRTY];
let updating = null;

async function sourceConfiguration(sender) {
	if (
		sender?.id !== chrome.runtime.id ||
		!Number.isInteger(sender?.tab?.id) ||
		sender.tab.incognito ||
		sender.frameId !== 0 ||
		typeof sender.documentId !== 'string' ||
		!sender.documentId ||
		(sender.documentLifecycle && sender.documentLifecycle !== 'active')
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await getSettings();
	if (
		!instanceOrigin ||
		originFromTabUrl(sender.url) !== instanceOrigin ||
		(await getConnectionStatus(instanceOrigin)).mode !== 'offline'
	) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const configuration = { instanceOrigin, configurationGeneration };
	await validateFlowConfiguration(configuration);
	const tab = await chrome.tabs.get(sender.tab.id);
	if (tab.incognito || tab.discarded || tab.frozen || originFromTabUrl(tab.url) !== instanceOrigin || tab.pendingUrl) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	const identity = await sendDocumentMessage(sender.tab.id, sender.documentId, { type: MESSAGE.SOURCE_PING }, 'TARGET_CHANGED');
	if (!identity?.ok || identity.origin !== instanceOrigin) {
		throw new ExtensionError('TARGET_CHANGED');
	}
	await validateFlowConfiguration(configuration);
	if ((await getConnectionStatus(instanceOrigin)).mode !== 'offline') {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	return configuration;
}

function refreshFromHint(configuration) {
	const { instanceOrigin, configurationGeneration } = configuration;
	invalidateAutomaticFlows();
	markOfflineSourceDirty(instanceOrigin);
	if (updating?.instanceOrigin === instanceOrigin && updating.configurationGeneration === configurationGeneration) {
		updating.sequence += 1;
		return updating.operation;
	}
	const job = { ...configuration, sequence: 1, operation: null };
	updating = job;
	job.operation = (async () => {
		let observed;
		do {
			observed = job.sequence;
			await validateFlowConfiguration(configuration);
			await refreshOfflineAccounts(instanceOrigin);
		} while (updating === job && observed !== job.sequence);
	})().finally(() => {
		if (updating === job) {
			updating = null;
		}
	});
	return job.operation;
}

export async function routeSourceMessage(message, sender) {
	let configuration;
	try {
		configuration = await sourceConfiguration(sender);
	} catch (error) {
		if (message.type === MESSAGE.SOURCE_STATUS) {
			return { enabled: false };
		}
		throw error;
	}
	if (message.type === MESSAGE.SOURCE_STATUS) {
		return { enabled: true };
	}
	if (message.type !== MESSAGE.SOURCE_DIRTY) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	await refreshFromHint(configuration);
	return { updated: true };
}

async function broadcastUpdate({ instanceOrigin, revision, clockRevision }) {
	const current = () => getOfflineSourceRevision(instanceOrigin) === revision && getOfflineClockRevision(instanceOrigin) === clockRevision;
	if (!current() || (await getSettings()).instanceOrigin !== instanceOrigin) {
		return;
	}
	// Revision and origin are the entire notification. Never forward cache data.
	const message = { type: MESSAGE.ACCOUNTS_CHANGED, instanceOrigin, revision, clockRevision };
	void chrome.runtime.sendMessage(message).catch(() => {});
	const sites = await readAutofillSites(instanceOrigin);
	if (!sites.length || !current()) {
		return;
	}
	const patterns = [...new Set(sites.map((site) => targetOriginToPermissionPattern(site.targetOrigin)))];
	const granted = await Promise.all(
		patterns.map(async (pattern) => ((await chrome.permissions.contains({ origins: [pattern] })) ? pattern : null)),
	);
	const matches = granted.filter(Boolean);
	if (!matches.length || !current()) {
		return;
	}
	const tabs = await chrome.tabs.query({ url: matches });
	if (!current() || (await getSettings()).instanceOrigin !== instanceOrigin) {
		return;
	}
	const allowed = new Set(sites.map((site) => JSON.stringify([site.targetOrigin, site.targetPath])));
	for (const tab of tabs) {
		if (
			Number.isInteger(tab.id) &&
			!tab.incognito &&
			!tab.discarded &&
			!tab.frozen &&
			!tab.pendingUrl &&
			allowed.has(JSON.stringify([originFromTabUrl(tab.url), autofillPathFromUrl(tab.url)]))
		) {
			// Receivers acknowledge synchronously and perform their own work later.
			void chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {});
		}
	}
}

export function startSourceUpdates() {
	const unsubscribeAccounts = onOfflineSourceChange((update) => {
		void broadcastUpdate(update).catch(() => {});
	});
	const unsubscribeIcons = onOfflineIconsChange(({ instanceOrigin }) => {
		void (async () => {
			const configuration = { instanceOrigin, configurationGeneration: getConfigurationGeneration() };
			await validateFlowConfiguration(configuration);
			if ((await getConnectionStatus(instanceOrigin)).mode !== 'offline') {
				return;
			}
			await validateFlowConfiguration(configuration);
			// Runtime delivery reaches extension UI only. Target websites need no images.
			await chrome.runtime.sendMessage({ type: MESSAGE.ICONS_CHANGED, instanceOrigin });
		})().catch(() => {});
	});
	return () => {
		unsubscribeAccounts();
		unsubscribeIcons();
	};
}
