import { localizedError } from './localized-error.js';
import { LANGUAGE_PREFERENCES } from '../../../src/shared/languages.js';

import { normalizeInstanceOrigin, normalizeTargetOrigin } from './origin.js';

export const STORAGE_KEYS = Object.freeze({
	SETTINGS: 'settings',
	LANGUAGE: 'language',
	INSTANCES: 'instances',
	FAVORITES: 'favorites',
	OFFLINE_INSTANCES: 'offlineInstances',
	BINDINGS: 'bindings',
	PENDING: 'pendingFlow',
});

// All persistent writes are made by the background worker through this queue.
let localWriteQueue = Promise.resolve();
function serializeLocalWrite(operation) {
	const next = localWriteQueue.then(operation);
	localWriteQueue = next.catch(() => {});
	return next;
}

function storageArea(areaName) {
	const area = chrome.storage?.[areaName];
	if (!area) {
		throw localizedError('error_STORAGE_UNAVAILABLE', 'UNKNOWN_ERROR', { area: areaName });
	}
	return area;
}

export async function lockStorageToTrustedContexts() {
	const tasks = [];
	for (const areaName of ['local', 'session']) {
		const area = chrome.storage?.[areaName];
		if (area?.setAccessLevel) {
			tasks.push(area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }));
		}
	}
	await Promise.all(tasks);
	await removeLegacyDeviceAuthorization();
}

// Upgrade before any background operation can read accounts. Removing a scoped
// credential must never silently grant the same browser full session access.
async function removeLegacyDeviceAuthorization() {
	await serializeLocalWrite(async () => {
		const area = storageArea('local');
		const legacyKey = 'deviceAuth';
		const legacy = (await area.get(legacyKey))[legacyKey];
		if (legacy === undefined) {
			return;
		}
		const origins = new Set();
		let unknownScope = !Array.isArray(legacy);
		for (const entry of Array.isArray(legacy) ? legacy : []) {
			try {
				origins.add(normalizeInstanceOrigin(entry?.instanceOrigin));
			} catch {
				unknownScope = true;
			}
		}
		const belongsToLegacyConnection = (origin) => {
			if (unknownScope) {
				return true;
			}
			try {
				return origins.has(normalizeInstanceOrigin(origin));
			} catch {
				return false;
			}
		};
		const keys = [STORAGE_KEYS.SETTINGS, STORAGE_KEYS.OFFLINE_INSTANCES, 'autofillSites', 'offlineCache'];
		const values = await area.get(keys);
		const changes = {};
		if (belongsToLegacyConnection(values[STORAGE_KEYS.SETTINGS]?.instanceOrigin)) {
			const history = await getInstanceOrigins();
			let currentOrigin = null;
			try {
				currentOrigin = normalizeInstanceOrigin(values[STORAGE_KEYS.SETTINGS]?.instanceOrigin);
			} catch {
				// Preserve valid history when the current setting is corrupt.
			}
			changes[STORAGE_KEYS.INSTANCES] = currentOrigin
				? [...history.filter((origin) => origin !== currentOrigin), currentOrigin].slice(-32)
				: history;
			changes[STORAGE_KEYS.SETTINGS] = { instanceOrigin: null };
		}
		for (const key of [STORAGE_KEYS.OFFLINE_INSTANCES, 'autofillSites']) {
			if (Array.isArray(values[key])) {
				changes[key] = values[key].filter((entry) => !belongsToLegacyConnection(key === 'autofillSites' ? entry?.instanceOrigin : entry));
			}
		}
		// Keep the legacy marker until all cleanup succeeds, so interrupted upgrades
		// retry safely on the next worker startup.
		if (Object.keys(changes).length) {
			await area.set(changes);
		}
		await clearPendingFlow();
		if (belongsToLegacyConnection(values.offlineCache?.instanceOrigin)) {
			await area.remove('offlineCache');
		}
		await area.remove(legacyKey);
	});
}

export async function getSettings() {
	const result = await storageArea('local').get(STORAGE_KEYS.SETTINGS);
	const value = result[STORAGE_KEYS.SETTINGS];
	if (!value || typeof value.instanceOrigin !== 'string') {
		return { instanceOrigin: null };
	}

	try {
		return { instanceOrigin: normalizeInstanceOrigin(value.instanceOrigin) };
	} catch {
		return { instanceOrigin: null };
	}
}

export async function saveSettings(instanceOrigin, connection) {
	const normalized = normalizeInstanceOrigin(instanceOrigin);
	await serializeLocalWrite(async () => {
		const instances = await getInstanceOrigins();
		let offlineInstances;
		if (connection !== undefined) {
			if (!connection || !['session', 'offline'].includes(connection.mode)) {
				throw localizedError('error_CONNECTION_INVALID');
			}
			const offline = await storageArea('local').get(STORAGE_KEYS.OFFLINE_INSTANCES);
			offlineInstances = (Array.isArray(offline[STORAGE_KEYS.OFFLINE_INSTANCES]) ? offline[STORAGE_KEYS.OFFLINE_INSTANCES] : []).filter(
				(origin) => origin !== normalized,
			);
			if (connection.mode === 'offline') {
				offlineInstances.push(normalized);
			}
		}
		await storageArea('local').set({
			[STORAGE_KEYS.SETTINGS]: { instanceOrigin: normalized },
			...(offlineInstances ? { [STORAGE_KEYS.OFFLINE_INSTANCES]: offlineInstances } : {}),
			[STORAGE_KEYS.INSTANCES]: [...instances.filter((origin) => origin !== normalized), normalized].slice(-32),
		});
	});
	return normalized;
}

export async function getInstanceOrigins() {
	const values = await storageArea('local').get(STORAGE_KEYS.INSTANCES);
	const current = await getSettings();
	const origins = new Set();
	for (const value of [...(Array.isArray(values[STORAGE_KEYS.INSTANCES]) ? values[STORAGE_KEYS.INSTANCES] : []), current.instanceOrigin]) {
		try {
			origins.add(normalizeInstanceOrigin(value));
		} catch {
			/* Ignore invalid historical addresses. */
		}
	}
	return [...origins].slice(-32);
}

export async function getBindings() {
	const result = await storageArea('local').get(STORAGE_KEYS.BINDINGS);
	const raw = result[STORAGE_KEYS.BINDINGS];
	if (!Array.isArray(raw)) {
		return [];
	}

	const bindings = [];
	const seen = new Set();
	for (const item of raw) {
		try {
			if (!item || typeof item.accountId !== 'string' || item.accountId === '') {
				continue;
			}
			const binding = normalizeBinding(item);
			const key = JSON.stringify([binding.instanceOrigin, binding.targetOrigin, binding.accountId]);
			if (!seen.has(key)) {
				seen.add(key);
				bindings.push(binding);
			}
		} catch {
			// Ignore invalid values left by an older or partially written version.
		}
	}
	return bindings;
}

export async function findBindings(instanceOrigin, targetOrigin) {
	const source = normalizeInstanceOrigin(instanceOrigin);
	const target = normalizeTargetOrigin(targetOrigin);
	return (await getBindings()).filter((item) => item.instanceOrigin === source && item.targetOrigin === target);
}

export async function findBinding(instanceOrigin, targetOrigin) {
	const bindings = await findBindings(instanceOrigin, targetOrigin);
	return bindings.length === 1 ? bindings[0] : null;
}

// Bindings keep only these three fields. A page login email saved by an
// earlier version is ignored here and dropped by the next binding write.
function normalizeBinding(item) {
	return {
		instanceOrigin: normalizeInstanceOrigin(item.instanceOrigin),
		targetOrigin: normalizeTargetOrigin(item.targetOrigin),
		accountId: String(item.accountId || ''),
	};
}

/**
 * "Remember account" keeps one remembered account per website, so automatic
 * choice stays unique. Remembering an already bound account also removes the
 * website's other bindings, so duplicates left by older versions converge.
 * Websites that tell accounts apart by login email pass scopeOf, returning the
 * email the account itself records in the instance (null without one). Only
 * bindings in the chosen account's scope are replaced there, so other logins
 * keep theirs. scopeOf returns undefined for an account the caller cannot see,
 * and such a binding is kept.
 */
export async function rememberBinding(binding, { scopeOf } = {}) {
	const normalized = normalizeBinding(binding);
	if (!normalized.accountId) {
		throw localizedError('error_ACCOUNT_ID_REQUIRED');
	}

	return serializeLocalWrite(async () => {
		if ((await getSettings()).instanceOrigin !== normalized.instanceOrigin) {
			return null;
		}
		const stored = (await storageArea('local').get(STORAGE_KEYS.BINDINGS))[STORAGE_KEYS.BINDINGS];
		const bindings = await getBindings();
		const sameSite = (item) => item.instanceOrigin === normalized.instanceOrigin && item.targetOrigin === normalized.targetOrigin;
		const scope = scopeOf?.(normalized.accountId);
		const replaced = (item) => {
			if (!sameSite(item) || item.accountId === normalized.accountId) {
				return false;
			}
			if (!scopeOf) {
				return true;
			}
			const itemScope = scopeOf(item.accountId);
			return itemScope !== undefined && itemScope === scope;
		};
		const next = bindings.filter((item) => !replaced(item));
		if (!next.some((item) => sameSite(item) && item.accountId === normalized.accountId)) {
			next.push(normalized);
		}
		// Compare with the stored value, so the write also drops obsolete fields.
		if (JSON.stringify(next) !== JSON.stringify(stored)) {
			await storageArea('local').set({ [STORAGE_KEYS.BINDINGS]: next });
		}
		return normalized;
	});
}

export async function removeBinding(instanceOrigin, targetOrigin, accountId) {
	const source = normalizeInstanceOrigin(instanceOrigin);
	const target = normalizeTargetOrigin(targetOrigin);
	if (accountId !== undefined && (typeof accountId !== 'string' || !accountId)) {
		throw localizedError('error_ACCOUNT_ID_INVALID');
	}
	await serializeLocalWrite(async () => {
		const bindings = (await getBindings()).filter(
			(item) =>
				!(item.instanceOrigin === source && item.targetOrigin === target && (accountId === undefined || item.accountId === accountId)),
		);
		await storageArea('local').set({ [STORAGE_KEYS.BINDINGS]: bindings });
	});
}

export async function removeBindingsForInstance(instanceOrigin) {
	const source = normalizeInstanceOrigin(instanceOrigin);
	await serializeLocalWrite(async () => {
		const bindings = (await getBindings()).filter((item) => item.instanceOrigin !== source);
		await storageArea('local').set({ [STORAGE_KEYS.BINDINGS]: bindings });
	});
}

let pendingQueue = Promise.resolve();

export function updatePendingFlow(update) {
	const operation = pendingQueue.then(async () => {
		const area = storageArea('session');
		const result = await area.get(STORAGE_KEYS.PENDING);
		const next = update(result[STORAGE_KEYS.PENDING] || null);
		if (next === null) {
			await area.remove(STORAGE_KEYS.PENDING);
		} else {
			await area.set({ [STORAGE_KEYS.PENDING]: next });
		}
		return next;
	});
	pendingQueue = operation.catch(() => {});
	return operation;
}

export function savePendingFlow(flow) {
	return updatePendingFlow(() => flow);
}

export async function getPendingFlow() {
	const result = await storageArea('session').get(STORAGE_KEYS.PENDING);
	return result[STORAGE_KEYS.PENDING] || null;
}

export function clearPendingFlow(nonce) {
	return updatePendingFlow((current) => (nonce === undefined || current?.nonce === nonce ? null : current));
}

export async function getFavoriteIds(instanceOrigin) {
	const origin = normalizeInstanceOrigin(instanceOrigin);
	const result = await storageArea('local').get(STORAGE_KEYS.FAVORITES);
	const values = result[STORAGE_KEYS.FAVORITES];
	return Array.isArray(values)
		? [
				...new Set(
					values
						.filter(
							(item) =>
								item?.instanceOrigin === origin &&
								typeof item.accountId === 'string' &&
								item.accountId.length > 0 &&
								item.accountId.length <= 200,
						)
						.map((item) => item.accountId),
				),
			]
		: [];
}

export async function setFavorite(instanceOrigin, accountId, favorite) {
	const origin = normalizeInstanceOrigin(instanceOrigin);
	if (typeof accountId !== 'string' || !accountId || accountId.length > 200 || typeof favorite !== 'boolean') {
		throw localizedError('error_FAVORITE_INVALID');
	}
	return serializeLocalWrite(async () => {
		if ((await getSettings()).instanceOrigin !== origin) {
			throw localizedError('error_INSTANCE_CHANGED', 'REQUEST_EXPIRED');
		}
		const result = await storageArea('local').get(STORAGE_KEYS.FAVORITES);
		const values = Array.isArray(result[STORAGE_KEYS.FAVORITES]) ? result[STORAGE_KEYS.FAVORITES] : [];
		const next = values.filter((item) => item && !(item.instanceOrigin === origin && item.accountId === accountId));
		if (favorite) {
			next.push({ instanceOrigin: origin, accountId });
		}
		await storageArea('local').set({ [STORAGE_KEYS.FAVORITES]: next });
		return getFavoriteIds(origin);
	});
}

export async function getConnectionStatus(instanceOrigin) {
	const origin = normalizeInstanceOrigin(instanceOrigin);
	const offline = await storageArea('local').get(STORAGE_KEYS.OFFLINE_INSTANCES);
	const enabled = Array.isArray(offline[STORAGE_KEYS.OFFLINE_INSTANCES]) && offline[STORAGE_KEYS.OFFLINE_INSTANCES].includes(origin);
	return { mode: enabled ? 'offline' : 'session' };
}

// Language is independent of instance/connection settings and uses the same
// persistent write queue, so concurrent preference and account updates cannot overwrite each other.
const languagePreferences = new Set(LANGUAGE_PREFERENCES);

export async function getLanguagePreference() {
	await localWriteQueue;
	const result = await storageArea('local').get(STORAGE_KEYS.LANGUAGE);
	return languagePreferences.has(result[STORAGE_KEYS.LANGUAGE]) ? result[STORAGE_KEYS.LANGUAGE] : 'auto';
}

export async function saveLanguagePreference(preference) {
	if (!languagePreferences.has(preference)) {
		throw localizedError('error_LANGUAGE_INVALID');
	}
	await serializeLocalWrite(() => storageArea('local').set({ [STORAGE_KEYS.LANGUAGE]: preference }));
	return preference;
}
