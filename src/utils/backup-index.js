/**
 * Backup index helpers.
 */

import { getBackupFormatFromKey, isValidBackupKey, parseBackupTimeFromKey } from './backup-format.js';

export const BACKUP_INDEX_PREFIX = 'backupidx_';
export const BACKUP_INDEX_STATE_KEY = 'backup_index_state_v1';

const BACKUP_INDEX_VERSION = 2;
const BACKUP_INDEX_MAX_TIMESTAMP = 9999999999999;
const BACKUP_INDEX_PAD_WIDTH = String(BACKUP_INDEX_MAX_TIMESTAMP).length;
const ensureBackupIndexesState = new WeakMap();
const backupIndexStateMutationState = new WeakMap();

function resolveBackupCreatedAt(backupKey, metadata = {}) {
	return metadata.created || parseBackupTimeFromKey(backupKey);
}

function sanitizeSkippedInvalidCount(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseIndexState(rawState) {
	if (!rawState) {
		return null;
	}

	try {
		return JSON.parse(rawState);
	} catch {
		return null;
	}
}

export async function getBackupIndexState(env) {
	return parseIndexState(await env.SECRETS_KV.get(BACKUP_INDEX_STATE_KEY, 'text').catch(() => null));
}

async function writeBackupIndexState(env, state) {
	await env.SECRETS_KV.put(BACKUP_INDEX_STATE_KEY, JSON.stringify(state));
}

async function runBackupIndexStateMutation(env, operation) {
	const kv = env?.SECRETS_KV;
	if (!kv) {
		return operation();
	}

	let state = backupIndexStateMutationState.get(kv);
	if (!state) {
		state = {
			tail: Promise.resolve(),
			pendingCount: 0,
		};
		backupIndexStateMutationState.set(kv, state);
	}

	state.pendingCount += 1;
	const run = state.tail.catch(() => {}).then(operation);
	state.tail = run.catch(() => {});

	try {
		return await run;
	} finally {
		state.pendingCount -= 1;
		if (state.pendingCount === 0) {
			backupIndexStateMutationState.delete(kv);
		}
	}
}

async function adjustBackupIndexStateCount(env, delta) {
	return runBackupIndexStateMutation(env, async () => {
		const state = await getBackupIndexState(env);
		if (state?.version !== BACKUP_INDEX_VERSION || !Number.isInteger(state.count)) {
			return;
		}

		await writeBackupIndexState(env, {
			...state,
			count: Math.max(0, state.count + delta),
			indexedAt: new Date().toISOString(),
		});
	});
}

async function invalidateBackupIndexState(env) {
	return runBackupIndexStateMutation(env, async () => {
		await env.SECRETS_KV.delete(BACKUP_INDEX_STATE_KEY).catch(() => {});
	});
}

export function createBackupIndexKey(backupKey, metadata = {}) {
	const createdAt = resolveBackupCreatedAt(backupKey, metadata);
	const timestamp = Date.parse(createdAt);
	const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
	const reversedTimestamp = String(BACKUP_INDEX_MAX_TIMESTAMP - safeTimestamp).padStart(BACKUP_INDEX_PAD_WIDTH, '0');

	return `${BACKUP_INDEX_PREFIX}${reversedTimestamp}_${backupKey}`;
}

export function getBackupKeyFromIndexKey(indexKey) {
	const separatorIndex = String(indexKey || '').indexOf('_', BACKUP_INDEX_PREFIX.length);
	return separatorIndex === -1 ? '' : indexKey.slice(separatorIndex + 1);
}

export function buildBackupIndexMetadata(backupKey, metadata = {}, options = {}) {
	const indexMetadata = {
		backupKey,
		created: resolveBackupCreatedAt(backupKey, metadata),
		format: typeof metadata.format === 'string' ? metadata.format : getBackupFormatFromKey(backupKey),
	};

	if (Number.isInteger(metadata.count)) {
		indexMetadata.count = metadata.count;
	}
	if (typeof metadata.encrypted === 'boolean') {
		indexMetadata.encrypted = metadata.encrypted;
	}
	if (Object.prototype.hasOwnProperty.call(metadata, 'skippedInvalidCount')) {
		indexMetadata.skippedInvalidCount = sanitizeSkippedInvalidCount(metadata.skippedInvalidCount);
	}
	if (typeof metadata.size === 'number') {
		indexMetadata.size = metadata.size;
	} else if (typeof options.size === 'number') {
		indexMetadata.size = options.size;
	}
	if (typeof metadata.version === 'number') {
		indexMetadata.version = metadata.version;
	}

	return indexMetadata;
}

export async function putBackupRecord(env, backupKey, backupContent, metadata = {}) {
	await env.SECRETS_KV.put(backupKey, backupContent, { metadata });
	const indexKey = createBackupIndexKey(backupKey, metadata);
	const indexMetadata = buildBackupIndexMetadata(backupKey, metadata);

	try {
		await env.SECRETS_KV.put(indexKey, '', {
			metadata: indexMetadata,
		});
	} catch {
		await invalidateBackupIndexState(env);
		return {
			success: true,
			indexed: false,
			stateSynchronized: false,
		};
	}

	try {
		await adjustBackupIndexStateCount(env, 1);
		return {
			success: true,
			indexed: true,
			stateSynchronized: true,
		};
	} catch {
		await invalidateBackupIndexState(env);
		return {
			success: true,
			indexed: true,
			stateSynchronized: false,
		};
	}
}

export async function deleteBackupRecord(env, backupKey, metadata = {}) {
	const indexKey = createBackupIndexKey(backupKey, metadata);
	const deleteResults = await Promise.allSettled([env.SECRETS_KV.delete(backupKey), env.SECRETS_KV.delete(indexKey)]);
	const deletedBackup = deleteResults[0]?.status === 'fulfilled';
	const deletedIndex = deleteResults[1]?.status === 'fulfilled';

	if (!deletedBackup || !deletedIndex) {
		if (deletedBackup || deletedIndex) {
			await invalidateBackupIndexState(env);
		}

		return {
			success: false,
			deletedBackup,
			deletedIndex,
			error: deleteResults.find((result) => result.status === 'rejected')?.reason || null,
		};
	}

	try {
		await adjustBackupIndexStateCount(env, -1);
		return {
			success: true,
			deletedBackup: true,
			deletedIndex: true,
			stateSynchronized: true,
		};
	} catch {
		await invalidateBackupIndexState(env);
		return {
			success: true,
			deletedBackup: true,
			deletedIndex: true,
			stateSynchronized: false,
		};
	}
}

export async function listBackupIndexPage(env, options = {}) {
	return env.SECRETS_KV.list({
		prefix: BACKUP_INDEX_PREFIX,
		limit: options.limit || 50,
		...(options.cursor ? { cursor: options.cursor } : {}),
	});
}

function hasKvListMore(pageResult) {
	return pageResult?.list_complete === false && typeof pageResult?.cursor === 'string' && pageResult.cursor.length > 0;
}

export async function listAllBackupKeys(env) {
	const backupKeys = [];
	let cursor;
	let hasMore = true;

	while (hasMore) {
		const pageResult = await env.SECRETS_KV.list({
			prefix: 'backup_',
			limit: 1000,
			...(cursor ? { cursor } : {}),
		});

		backupKeys.push(...pageResult.keys);
		hasMore = hasKvListMore(pageResult);
		cursor = hasMore ? pageResult.cursor : undefined;
	}

	return backupKeys.filter((key) => isValidBackupKey(key.name)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAllBackupIndexEntries(env) {
	const indexEntries = [];
	let cursor;
	let hasMore = true;

	while (hasMore) {
		const pageResult = await listBackupIndexPage(env, {
			limit: 1000,
			...(cursor ? { cursor } : {}),
		});

		indexEntries.push(...pageResult.keys);
		hasMore = hasKvListMore(pageResult);
		cursor = hasMore ? pageResult.cursor : undefined;
	}

	return indexEntries;
}

export async function getBackupIndexCoverage(env) {
	const [backupKeys, indexEntries] = await Promise.all([listAllBackupKeys(env), listAllBackupIndexEntries(env)]);
	const backupKeySet = new Set(backupKeys.map((entry) => entry.name));
	const indexedBackupKeys = new Set();
	const orphanedIndexEntries = [];

	for (const entry of indexEntries) {
		const backupKey = entry.metadata?.backupKey || getBackupKeyFromIndexKey(entry.name);
		if (!isValidBackupKey(backupKey) || !backupKeySet.has(backupKey)) {
			orphanedIndexEntries.push(entry);
			continue;
		}

		indexedBackupKeys.add(backupKey);
	}

	const missingBackupKeys = backupKeys.filter((entry) => !indexedBackupKeys.has(entry.name));

	return {
		complete: missingBackupKeys.length === 0 && orphanedIndexEntries.length === 0,
		backupKeys,
		indexEntries,
		missingBackupKeys,
		orphanedIndexEntries,
	};
}

async function ensureBackupIndexesInternal(env, options = {}) {
	const state = await getBackupIndexState(env);
	if (state?.version === BACKUP_INDEX_VERSION && options.force !== true) {
		return;
	}

	const existingIndexEntries = await listAllBackupIndexEntries(env);
	await Promise.all(existingIndexEntries.map((entry) => env.SECRETS_KV.delete(entry.name)));

	const backupKeys = await listAllBackupKeys(env);
	for (const backupKeyEntry of backupKeys) {
		await env.SECRETS_KV.put(createBackupIndexKey(backupKeyEntry.name, backupKeyEntry.metadata), '', {
			metadata: buildBackupIndexMetadata(backupKeyEntry.name, backupKeyEntry.metadata, {
				size: typeof backupKeyEntry.size === 'number' ? backupKeyEntry.size : undefined,
			}),
		});
	}

	await writeBackupIndexState(env, {
		version: BACKUP_INDEX_VERSION,
		indexedAt: new Date().toISOString(),
		count: backupKeys.length,
	});
}

export async function ensureBackupIndexes(env, options = {}) {
	const kv = env?.SECRETS_KV;
	if (!kv) {
		return;
	}

	const runningState = ensureBackupIndexesState.get(kv);
	if (runningState?.promise) {
		if (options.force === true && runningState.runningForce !== true) {
			runningState.forceRequested = true;
		}
		return runningState.promise;
	}

	const state = {
		forceRequested: options.force === true,
		runningForce: false,
		promise: null,
	};
	const run = async () => {
		try {
			do {
				const force = state.forceRequested;
				state.forceRequested = false;
				state.runningForce = force;
				await ensureBackupIndexesInternal(env, { force });
				state.runningForce = false;
			} while (state.forceRequested);
		} finally {
			ensureBackupIndexesState.delete(kv);
		}
	};

	state.promise = run();
	ensureBackupIndexesState.set(kv, state);
	return state.promise;
}
