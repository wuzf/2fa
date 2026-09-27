import { parseOfflineSecretsCache } from '../../../src/shared/offline-cache.js';
import { collectServiceDomains, readWebServiceIcons } from '../shared/service-icons.js';
import { clearPendingFlow, getConnectionStatus, saveSettings } from '../shared/storage.js';
import { importOfflineSource, clearOfflineSource, readOfflineStatus, readOfflineIcons, verifyOfflineClock } from './offline-source.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError } from './errors.js';
import {
	requireSettings,
	validateFlowConfiguration,
	assertCurrentGeneration,
	requireOfflineConfiguration,
	validateOfflineConfiguration,
} from './configuration.js';
import { querySourceTabs, getSourceTab } from './browser-access.js';
import { requestSource } from './source-service.js';

// Explicit cache management is independent of preview/fill request claims.
// Account refresh returns before optional icon maintenance.

export async function refreshOfflineAccounts(expectedOrigin, { clockOnly = false } = {}) {
	const configuration = await requireOfflineConfiguration();
	if (expectedOrigin !== undefined && configuration.instanceOrigin !== expectedOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	if (clockOnly) {
		// Verifying a restored correction needs only the time endpoint, not the vault.
		try {
			await verifyOfflineClock(configuration.instanceOrigin, { checkConfiguration: () => validateOfflineConfiguration(configuration) });
		} catch (error) {
			await validateOfflineConfiguration(configuration);
			if (error instanceof ExtensionError) {
				throw error;
			}
			// A failed time check leaves the cached vault and its correction unchanged.
			throw new ExtensionError(['REQUEST_EXPIRED', 'ACCOUNT_CHANGED'].includes(error?.code) ? error.code : 'SOURCE_OFFLINE');
		}
	} else {
		await requestSource(configuration, 'list', { withDiagnostics: true, refresh: true });
	}
	const status = await readOfflineStatus(configuration.instanceOrigin);
	await validateOfflineConfiguration(configuration);
	return { instanceOrigin: configuration.instanceOrigin, ...status };
}

export async function importWebOfflineCache(expectedOrigin) {
	const configuration = await requireOfflineConfiguration();
	if (expectedOrigin !== undefined && configuration.instanceOrigin !== expectedOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	const tabs = await querySourceTabs(configuration.instanceOrigin);
	const tab = tabs.find((item) => !item.discarded && !item.frozen);
	if (!tab) {
		throw new ExtensionError('SOURCE_TAB_MISSING');
	}
	const [read] = await chrome.scripting.executeScript({
		target: { tabId: tab.id, frameIds: [0] },
		func: (origin) => {
			if (globalThis.location.origin !== origin) {
				return null;
			}
			const cache = localStorage.getItem('2fa-secrets-cache');
			const clock = localStorage.getItem('2fa-clock-sync-v1');
			return cache && cache.length <= 8 * 1024 * 1024 && (!clock || clock.length <= 16384) ? { cache, clock } : null;
		},
		args: [configuration.instanceOrigin],
	});
	const snapshot = parseOfflineSecretsCache(read?.result?.cache);
	if (!snapshot || !read.documentId) {
		throw new ExtensionError('OFFLINE_CACHE_MISSING');
	}
	try {
		snapshot.clock = JSON.parse(read.result.clock || 'null');
	} catch {
		snapshot.clock = null;
	}
	if (snapshot.clock && typeof snapshot.clock === 'object') {
		// A webpage anchor comes from another execution context. Never let it claim
		// this worker's monotonic origin; it stays unverified until an online sync.
		delete snapshot.clock.monotonicOriginMs;
	}
	let serviceIcons = {};
	const iconDomains = collectServiceDomains(snapshot.data);
	if (iconDomains.length) {
		const [icons] = await chrome.scripting.executeScript({
			target: { tabId: tab.id, documentIds: [read.documentId] },
			func: readWebServiceIcons,
			args: [configuration.instanceOrigin, iconDomains],
		});
		if (icons?.documentId !== read.documentId) {
			throw new ExtensionError('ACCOUNT_CHANGED');
		}
		serviceIcons = icons.result;
	}
	const [current] = await chrome.scripting.executeScript({
		target: { tabId: tab.id, documentIds: [read.documentId] },
		func: (origin, cache) => globalThis.location.origin === origin && localStorage.getItem('2fa-secrets-cache') === cache,
		args: [configuration.instanceOrigin, read.result.cache],
	});
	if (current?.documentId !== read.documentId || current.result !== true || !(await getSourceTab(tab.id, configuration.instanceOrigin))) {
		throw new ExtensionError('ACCOUNT_CHANGED');
	}
	await validateFlowConfiguration(configuration);
	await importOfflineSource(configuration.instanceOrigin, snapshot, {
		checkConfiguration: () => validateOfflineConfiguration(configuration),
		serviceIcons,
	});
	await validateFlowConfiguration(configuration);
	return { instanceOrigin: configuration.instanceOrigin, ...(await readOfflineStatus(configuration.instanceOrigin)) };
}

export async function disableOfflineCache(expectedOrigin) {
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await requireSettings();
	const configuration = { instanceOrigin, configurationGeneration };
	if (expectedOrigin !== undefined && instanceOrigin !== expectedOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	// Disabling local storage must remain possible after the host grant is lost.
	// Configuration messages serialize these checks and the following writes.
	if ((await getConnectionStatus(instanceOrigin)).mode !== 'offline') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if ((await requireSettings()).instanceOrigin !== instanceOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	assertCurrentGeneration(configuration);
	await saveSettings(configuration.instanceOrigin, { mode: 'session' });
	try {
		await clearOfflineSource(instanceOrigin);
	} catch (error) {
		// Keep the switch available for retry if storage could not delete the vault.
		// The configuration queue keeps source requests outside this rollback.
		await saveSettings(instanceOrigin, { mode: 'offline' }).catch(() => {});
		throw error;
	}
	await clearPendingFlow();
	return { instanceOrigin: configuration.instanceOrigin, disabled: true };
}

export async function getOfflineCacheStatus() {
	const configuration = await requireOfflineConfiguration();
	const result = await readOfflineStatus(configuration.instanceOrigin);
	await validateFlowConfiguration(configuration);
	return { instanceOrigin: configuration.instanceOrigin, ...result };
}

export async function getOfflineCacheIcons() {
	const configuration = await requireOfflineConfiguration();
	const serviceIcons = await readOfflineIcons(configuration.instanceOrigin, {
		checkConfiguration: () => validateOfflineConfiguration(configuration),
	});
	await validateOfflineConfiguration(configuration);
	return { instanceOrigin: configuration.instanceOrigin, serviceIcons };
}
