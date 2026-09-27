import { loadOfflineClock, loadOfflineSnapshot, listOfflineAccounts, generateOfflineCodes } from '../bridge/api.js';
import { normalizeInstanceOrigin } from '../shared/origin.js';
import { LIMITS, createNonce, isPlainObject } from '../shared/protocol.js';
import { adoptVerifiedClock, clockVerificationRecord, offlineClockState } from '../shared/offline-clock.js';
import { collectServiceDomains, fetchServiceIcons, sanitizeServiceIcons } from '../shared/service-icons.js';

const CACHE_KEY = 'offlineCache';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 30 * 1000;
const INTERACTIVE_THROTTLE_MS = 1000;
const SYNC_TIMEOUT_MS = 20 * 1000;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const ICON_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const ICON_BUDGET_MS = 18000;
// The last successful time check survives worker restarts until the browser
// session ends. It is metadata only: offsets and timestamps, never accounts.
const CLOCK_VERIFICATION_KEY = 'offlineClockVerification';
const CLOCK_CHECK_TIMEOUT_MS = 10 * 1000;
// A time check that agrees with the kept offset within this margin confirms it.
const CLOCK_CONFIRM_TOLERANCE_MS = 2000;
// Each read renews the record's last seen time, so a restarted worker detects a
// backward system time change. Writes are spaced by this interval.
const CLOCK_SEEN_INTERVAL_MS = 5 * 1000;
// Automatic filling waits this long for a running time check before using the
// kept correction, so a correction the server disagrees with is not filled.
const AUTOMATIC_CLOCK_WAIT_MS = 3 * 1000;

let activeState = null;
let storageQueue = Promise.resolve();
const revisions = new Map();
const snapshotRevisions = new WeakMap();
const clockRevisions = new Map();
const snapshotClockRevisions = new WeakMap();
const dirtyVersions = new Map();
const changeTokens = new Map();
const changeListeners = new Set();
const iconListeners = new Set();

function failure(code) {
	const error = new Error(code);
	error.code = code;
	return error;
}

function serializeStorage(operation) {
	const pending = storageQueue.then(operation);
	storageQueue = pending.catch(() => {});
	return pending;
}

function requireOrigin(value) {
	try {
		if (normalizeInstanceOrigin(value) !== value) {
			throw new Error('Non-canonical origin');
		}
		return value;
	} catch {
		throw failure('INVALID_REQUEST');
	}
}

function assertCurrent(state, signal, snapshot, strictSnapshot = false) {
	if (signal?.aborted || activeState !== state) {
		throw failure('REQUEST_EXPIRED');
	}
	if (snapshot !== undefined && state.snapshot !== snapshot && (strictSnapshot || snapshotRevisions.get(snapshot) !== state.revision)) {
		throw failure('ACCOUNT_CHANGED');
	}
}

async function checkConfiguration(options) {
	if (options.checkConfiguration !== undefined) {
		if (typeof options.checkConfiguration !== 'function') {
			throw failure('INVALID_REQUEST');
		}
		await options.checkConfiguration();
	}
	if (options.signal?.aborted) {
		throw failure('REQUEST_EXPIRED');
	}
}

async function checkCurrent(state, options, snapshot, strictSnapshot = false) {
	assertCurrent(state, options.signal, snapshot, strictSnapshot);
	await checkConfiguration(options);
	assertCurrent(state, options.signal, snapshot, strictSnapshot);
}

function stableData(value) {
	if (Array.isArray(value)) {
		return value.map(stableData);
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stableData(value[key])]),
		);
	}
	return value;
}

function notifyChange(instanceOrigin, revision, clockRevision) {
	for (const listener of changeListeners) {
		try {
			Promise.resolve(listener({ instanceOrigin, revision, clockRevision })).catch(() => {});
		} catch {
			// UI observers must never make a successful cache mutation fail.
		}
	}
}

function assignRevision(state, snapshot, { notify = true, alwaysNotify = false } = {}) {
	const identity = JSON.stringify(stableData({ data: snapshot.data, diagnostics: snapshot.diagnostics ?? null }));
	const changed = state.dataIdentity !== identity;
	const clockIdentity = JSON.stringify(offlineClockState(snapshot.clock));
	const clockChanged = state.clockIdentity !== clockIdentity;
	if (changed) {
		state.dataIdentity = identity;
		state.revision = createNonce();
		revisions.set(state.instanceOrigin, state.revision);
	}
	if (clockChanged) {
		state.clockIdentity = clockIdentity;
		state.clockRevision = createNonce();
		clockRevisions.set(state.instanceOrigin, state.clockRevision);
	}
	snapshotRevisions.set(snapshot, state.revision);
	snapshotClockRevisions.set(snapshot, state.clockRevision);
	if (notify && (changed || clockChanged || alwaysNotify)) {
		notifyChange(state.instanceOrigin, state.revision, state.clockRevision);
	}
}

export function getOfflineSourceRevision(instanceOrigin) {
	requireOrigin(instanceOrigin);
	return revisions.get(instanceOrigin) ?? null;
}

export function getOfflineClockRevision(instanceOrigin) {
	requireOrigin(instanceOrigin);
	return clockRevisions.get(instanceOrigin) ?? null;
}

export function onOfflineSourceChange(listener) {
	if (typeof listener !== 'function') {
		throw failure('INVALID_REQUEST');
	}
	changeListeners.add(listener);
	return () => changeListeners.delete(listener);
}

export function onOfflineIconsChange(listener) {
	if (typeof listener !== 'function') {
		throw failure('INVALID_REQUEST');
	}
	iconListeners.add(listener);
	return () => iconListeners.delete(listener);
}

function notifyIcons(instanceOrigin) {
	for (const listener of iconListeners) {
		try {
			Promise.resolve(listener({ instanceOrigin })).catch(() => {});
		} catch {
			// Optional UI observers cannot affect the cached vault.
		}
	}
}

/** Configuration and permission handlers cancel immediately, before their queue runs. */
export function cancelOfflineIconSync() {
	activeState?.pendingIcons?.controller.abort();
}

// A running time check or synchronization belongs to the configuration that
// started it. Abort it, so none of its requests is sent after that changes.
function stopNetworkWork(state) {
	state?.pendingClockCheck?.controller.abort();
	state?.pendingSync?.abort(failure('REQUEST_EXPIRED'));
}

/**
 * Stops all offline network work at once: image downloads, time checks and
 * vault synchronization. Configuration and permission changes call it before
 * their queued work runs, so switching modes sends no further offline request.
 */
export function cancelOfflineRequests() {
	cancelOfflineIconSync();
	stopNetworkWork(activeState);
}

export function markOfflineSourceDirty(instanceOrigin) {
	requireOrigin(instanceOrigin);
	dirtyVersions.set(instanceOrigin, (dirtyVersions.get(instanceOrigin) || 0) + 1);
	changeTokens.set(instanceOrigin, createNonce());
}

export function getOfflineSourceChangeToken(instanceOrigin) {
	requireOrigin(instanceOrigin);
	if (!changeTokens.has(instanceOrigin)) {
		changeTokens.set(instanceOrigin, createNonce());
	}
	return changeTokens.get(instanceOrigin);
}

function copySnapshot(value) {
	if (
		!isPlainObject(value) ||
		!Array.isArray(value.data) ||
		value.data.length > LIMITS.MAX_ACCOUNTS ||
		!value.data.every(isPlainObject) ||
		!Number.isFinite(value.timestamp) ||
		value.timestamp < 0 ||
		(value.clock !== undefined && value.clock !== null && !isPlainObject(value.clock))
	) {
		throw failure('INVALID_RESPONSE');
	}
	try {
		const serialized = JSON.stringify({
			data: value.data,
			timestamp: value.timestamp,
			...(value.clock !== undefined ? { clock: value.clock } : {}),
			...(value.diagnostics !== undefined ? { diagnostics: value.diagnostics } : {}),
		});
		if (new TextEncoder().encode(serialized).byteLength > MAX_CACHE_BYTES) {
			throw failure('INVALID_RESPONSE');
		}
		return JSON.parse(serialized);
	} catch {
		throw failure('INVALID_RESPONSE');
	}
}

function newState(instanceOrigin) {
	return {
		instanceOrigin,
		snapshot: null,
		serviceIcons: {},
		ready: null,
		pendingSync: null,
		deferredRefresh: false,
		lastFailedAt: null,
		lastFailureCode: null,
		lastSucceededAt: null,
		clockVerificationAttempted: false,
		// A correction adopted from this browser session's record is confirmed once
		// online, because a forward system time change while no worker ran is invisible.
		clockRecheck: false,
		pendingClockCheck: null,
		lastClockCheck: null,
		// This worker's copy of the session record describing its current correction.
		clockRecord: null,
		syncedDirtyVersion: 0,
		revision: null,
		dataIdentity: null,
		clockRevision: null,
		clockIdentity: null,
		pendingIcons: null,
		iconAccounts: [],
		iconAttemptedAt: new Map(),
	};
}

async function getState(instanceOrigin, signal) {
	requireOrigin(instanceOrigin);
	if (signal?.aborted) {
		throw failure('REQUEST_EXPIRED');
	}
	let state = activeState;
	if (!state || state.instanceOrigin !== instanceOrigin) {
		cancelOfflineIconSync();
		state = newState(instanceOrigin);
		activeState = state;
		state.ready = serializeStorage(async () => {
			assertCurrent(state, signal);
			const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
			assertCurrent(state, signal);
			if (!stored) {
				return;
			}
			if (stored.instanceOrigin !== instanceOrigin) {
				await chrome.storage.local.remove(CACHE_KEY);
				return;
			}
			try {
				const loaded = copySnapshot(stored.snapshot);
				const { accounts } = await listOfflineAccounts(loaded, { withDiagnostics: true });
				assertCurrent(state, signal);
				const snapshot = await restoreVerifiedClock(state, loaded);
				assertCurrent(state, signal);
				state.serviceIcons = sanitizeServiceIcons(stored.serviceIcons, collectServiceDomains(accounts));
				// A correction adopted from the session record only moves this worker's
				// anchor. It is not written back: the vault can be several megabytes and
				// this happens on nearly every worker restart. Status readers take the
				// clock from this state instead, and the next save stores the anchor.
				state.snapshot = snapshot;
				state.clockRecheck = snapshot !== loaded;
				assignRevision(state, snapshot, { notify: false });
			} catch (error) {
				if (invalidatesCache(error)) {
					await chrome.storage.local.remove(CACHE_KEY);
				}
				throw error;
			}
		});
	}
	try {
		await state.ready;
	} catch (error) {
		if (activeState === state) {
			activeState = null;
		}
		throw error;
	}
	assertCurrent(state, signal);
	return state;
}

function canUseCachedSnapshot(error) {
	return ['SOURCE_OFFLINE', 'SOURCE_UNAVAILABLE', 'TIMEOUT', 'REQUEST_TIMEOUT'].includes(error?.code) || error?.name === 'TimeoutError';
}

function invalidatesCache(error) {
	// The bridge classifies each 403 and reports the instance's own login failure
	// as AUTH_REQUIRED. A bare 403 status is a rule in front of the instance; it
	// does not prove the login expired and must not delete the offline copy.
	return ['AUTH_REQUIRED', 'INVALID_RESPONSE'].includes(error?.code) || error?.status === 401;
}

async function readClockVerification() {
	try {
		return (await chrome.storage.session?.get(CLOCK_VERIFICATION_KEY))?.[CLOCK_VERIFICATION_KEY] ?? null;
	} catch {
		return null;
	}
}

async function writeClockVerification(state, record) {
	// The in-memory copy changes synchronously, so the latest call always wins.
	state.clockRecord = record;
	try {
		await chrome.storage.session?.set({ [CLOCK_VERIFICATION_KEY]: record });
	} catch {
		// Without the record a restarted worker verifies the correction again.
	}
}

async function forgetClockVerification(state) {
	state.clockRecord = null;
	try {
		await chrome.storage.session?.remove(CLOCK_VERIFICATION_KEY);
	} catch {
		// A record that cannot be removed still expires with the trust window.
	}
}

function describesClock(record, state, clock) {
	return (
		Boolean(record && clock) &&
		record.instanceOrigin === state.instanceOrigin &&
		record.offsetMs === clock.offsetMs &&
		record.syncedAtServerMs === clock.syncedAtServerMs
	);
}

/**
 * Keeps the session record in step with this worker's view of the clock. A
 * verified correction renews its last seen time; a system time change that
 * this worker detected removes the record, so no restarted worker adopts it.
 */
function observeClockVerification(state, status) {
	if (!describesClock(state.clockRecord, state, state.snapshot?.clock)) {
		return;
	}
	if (status === 'changed') {
		void forgetClockVerification(state);
		return;
	}
	const now = Date.now();
	// A clock that moved backwards keeps the higher value for the next worker.
	if (status === 'cached' && now - state.clockRecord.lastSeenWallMs >= CLOCK_SEEN_INTERVAL_MS) {
		void writeClockVerification(state, { ...state.clockRecord, lastSeenWallMs: now });
	}
}

/**
 * A worker restarted within the browser session keeps a correction that was
 * verified there recently, instead of reporting every restart as unverified.
 */
async function restoreVerifiedClock(state, snapshot) {
	if (offlineClockState(snapshot.clock).status !== 'unverified') {
		return snapshot;
	}
	const record = await readClockVerification();
	const wallNow = Date.now();
	const clock = adoptVerifiedClock(snapshot.clock, record, state.instanceOrigin, wallNow);
	if (!clock) {
		return snapshot;
	}
	await writeClockVerification(state, { ...record, lastSeenWallMs: Math.max(record.lastSeenWallMs, wallNow) });
	return { ...snapshot, clock };
}

/** Lets automatic filling use the outcome of a running time check, within a short limit. */
async function waitForClockCheck(state, signal) {
	const check = state.pendingClockCheck?.promise;
	if (!check) {
		return;
	}
	let timer;
	let onAbort;
	try {
		await Promise.race([
			check.catch(() => {}),
			new Promise((resolve) => {
				timer = setTimeout(resolve, AUTOMATIC_CLOCK_WAIT_MS);
				onAbort = resolve;
				signal?.addEventListener('abort', onAbort, { once: true });
			}),
		]);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
	assertCurrent(state, signal);
}

function cacheRecord(instanceOrigin, snapshot, serviceIcons) {
	return { instanceOrigin, snapshot, ...(Object.keys(serviceIcons).length ? { serviceIcons } : {}) };
}

async function persistSnapshot(state, snapshot, options, serviceIcons = state.serviceIcons, alwaysNotify = false) {
	const previous = state.snapshot;
	await serializeStorage(async () => {
		await checkCurrent(state, options, previous, true);
		const previousIcons = state.serviceIcons;
		const accounts = await listOfflineAccounts(snapshot, { withDiagnostics: false });
		await checkCurrent(state, options, previous, true);
		serviceIcons = sanitizeServiceIcons({ ...state.serviceIcons, ...serviceIcons }, collectServiceDomains(accounts));
		try {
			await chrome.storage.local.set({ [CACHE_KEY]: cacheRecord(state.instanceOrigin, snapshot, serviceIcons) });
		} catch (error) {
			if (!Object.keys(serviceIcons).length) {
				throw error;
			}
			// Optional images must not prevent a usable vault from being saved.
			await checkCurrent(state, options, previous, true);
			serviceIcons = {};
			await chrome.storage.local.set({ [CACHE_KEY]: cacheRecord(state.instanceOrigin, snapshot, serviceIcons) });
		}
		try {
			await checkCurrent(state, options, previous, true);
		} catch (error) {
			// A storage write cannot be cancelled. Roll it back before the next queued mutation.
			if (activeState === state && previous) {
				await chrome.storage.local.set({ [CACHE_KEY]: cacheRecord(state.instanceOrigin, previous, previousIcons) });
			} else {
				await chrome.storage.local.remove(CACHE_KEY);
			}
			throw error;
		}
		state.snapshot = snapshot;
		state.serviceIcons = serviceIcons;
		assignRevision(state, snapshot, { alwaysNotify });
	});
}

async function persistIcons(state, loaded, options) {
	await serializeStorage(async () => {
		await checkCurrent(state, options);
		const snapshot = state.snapshot;
		const accounts = await listOfflineAccounts(snapshot, { withDiagnostics: false });
		await checkCurrent(state, options, snapshot, true);
		const icons = sanitizeServiceIcons({ ...loaded, ...state.serviceIcons }, collectServiceDomains(accounts));
		if (JSON.stringify(icons) === JSON.stringify(state.serviceIcons)) {
			return;
		}
		const previousIcons = state.serviceIcons;
		try {
			await chrome.storage.local.set({ [CACHE_KEY]: cacheRecord(state.instanceOrigin, snapshot, icons) });
		} catch {
			// An optional image write must never replace, clear or invalidate the vault.
			return;
		}
		try {
			await checkCurrent(state, options, snapshot, true);
		} catch (error) {
			if (activeState === state) {
				await chrome.storage.local.set({ [CACHE_KEY]: cacheRecord(state.instanceOrigin, snapshot, previousIcons) });
			} else {
				await chrome.storage.local.remove(CACHE_KEY);
			}
			throw error;
		}
		state.serviceIcons = icons;
		notifyIcons(state.instanceOrigin);
	});
}

/** Only a successful online vault refresh may schedule optional image requests. */
function refreshIcons(state, accounts, options) {
	state.iconAccounts = accounts;
	const domains = new Set(collectServiceDomains(accounts));
	for (const domain of state.iconAttemptedAt.keys()) {
		if (!domains.has(domain)) {
			state.iconAttemptedAt.delete(domain);
		}
	}
	if (state.pendingIcons && !state.pendingIcons.controller.signal.aborted) {
		state.pendingIcons.followUp = true;
		return state.pendingIcons.promise;
	}
	if (globalThis.navigator?.onLine === false) {
		return Promise.resolve();
	}
	const controller = new AbortController();
	// A finished popup request must not own a background maintenance task. The
	// captured configuration validator and lifecycle cancellation still apply.
	const iconOptions = { checkConfiguration: options.checkConfiguration, signal: controller.signal };
	const job = { controller, promise: null, followUp: true, succeeded: new Set() };
	const startedAt = performance.now();
	state.pendingIcons = job;
	job.promise = (async () => {
		try {
			while (job.followUp && performance.now() - startedAt < ICON_BUDGET_MS) {
				job.followUp = false;
				await checkCurrent(state, iconOptions);
				if (globalThis.navigator?.onLine === false || state.lastFailedAt !== null) {
					return;
				}
				const excludedDomains = [...state.iconAttemptedAt]
					.filter(([, { at }]) => Date.now() >= at && Date.now() - at < ICON_RETRY_INTERVAL_MS)
					.map(([domain]) => domain);
				const icons = await fetchServiceIcons(state.instanceOrigin, state.iconAccounts, {
					cached: state.serviceIcons,
					signal: controller.signal,
					timeoutMs: ICON_BUDGET_MS - (performance.now() - startedAt),
					excludedDomains,
					checkCurrent: () => checkCurrent(state, iconOptions),
					onResult: (domain, succeeded) => {
						state.iconAttemptedAt.set(domain, { at: Date.now(), job });
						if (succeeded) {
							job.succeeded.add(domain);
						}
					},
				});
				await checkCurrent(state, iconOptions);
				if (globalThis.navigator?.onLine === false || state.lastFailedAt !== null) {
					return;
				}
				await persistIcons(state, icons, iconOptions);
			}
		} catch {
			// Icons are a best-effort enhancement and never fail list or code requests.
		} finally {
			if (controller.signal.aborted) {
				// A cancelled attempt is not a failed server response. Resume missing
				// images on the next healthy sync after the user's settings change.
				for (const domain of job.succeeded) {
					if (!state.serviceIcons[domain] && state.iconAttemptedAt.get(domain)?.job === job) {
						state.iconAttemptedAt.delete(domain);
					}
				}
			}
			if (state.pendingIcons === job) {
				state.pendingIcons = null;
			}
		}
	})();
	return job.promise;
}

async function synchronize(state, options) {
	await checkCurrent(state, options);
	if (state.pendingSync) {
		const snapshot = await state.pendingSync.promise;
		await checkCurrent(state, options, snapshot);
		return snapshot;
	}
	const controller = new AbortController();
	let rejectAbort;
	let abortReason;
	const aborted = new Promise((resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = (reason) => {
		abortReason = reason;
		controller.abort();
		rejectAbort(reason);
	};
	const onAbort = () => abort(failure('REQUEST_EXPIRED'));
	options.signal?.addEventListener('abort', onAbort, { once: true });
	const pending = { promise: null, abort };
	const syncOptions = { ...options, signal: controller.signal };
	// One attempt per worker state verifies a restored correction. After that,
	// the regular schedule applies, so a failing time endpoint cannot loop.
	state.clockVerificationAttempted = true;
	// The synchronization reads the time endpoint as well. Stop a time-only check
	// so its older snapshot can never replace the refreshed vault.
	state.pendingClockCheck?.controller.abort();
	const work = async () => {
		let accounts;
		do {
			const dirtyVersion = dirtyVersions.get(state.instanceOrigin) || 0;
			const previousClock = state.snapshot?.clock;
			const loaded = await loadOfflineSnapshot({ ...syncOptions, previousClock });
			await checkCurrent(state, syncOptions);
			const snapshot = copySnapshot(loaded);
			// The shared API validates and isolates account records before persistence.
			({ accounts } = await listOfflineAccounts(snapshot, { withDiagnostics: true }));
			await checkCurrent(state, syncOptions);
			await persistSnapshot(state, snapshot, syncOptions, sanitizeServiceIcons(state.serviceIcons, collectServiceDomains(accounts)));
			// Only a new correction from the time endpoint renews the session record;
			// a kept earlier correction must not extend its own trust.
			if (loaded.clock && loaded.clock !== previousClock && offlineClockState(snapshot.clock).status === 'cached') {
				await writeClockVerification(state, clockVerificationRecord(state.instanceOrigin, snapshot.clock));
			}
			state.lastFailedAt = null;
			state.lastFailureCode = null;
			state.lastSucceededAt = Date.now();
			state.syncedDirtyVersion = dirtyVersion;
			// A mutation hint received during the request may describe a newer server
			// state than its response. Do not let single-flight swallow that hint.
		} while (state.syncedDirtyVersion !== (dirtyVersions.get(state.instanceOrigin) || 0));
		state.deferredRefresh = false;
		void refreshIcons(state, accounts, options);
		return state.snapshot;
	};
	state.pendingSync = pending;
	const timer = setTimeout(() => abort(failure('TIMEOUT')), SYNC_TIMEOUT_MS);
	pending.promise = (async () => {
		try {
			return await Promise.race([work(), aborted]);
		} catch (error) {
			assertCurrent(state, options.signal);
			const syncError = abortReason || error;
			if (invalidatesCache(syncError)) {
				await clearOfflineSource(state.instanceOrigin);
			} else if (canUseCachedSnapshot(syncError)) {
				state.pendingIcons?.controller.abort();
				state.lastFailedAt = Date.now();
				state.lastFailureCode = syncError?.code || 'SOURCE_OFFLINE';
			}
			throw syncError;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', onAbort);
		}
	})();
	try {
		return await pending.promise;
	} finally {
		if (state.pendingSync === pending) {
			state.pendingSync = null;
		}
	}
}

/**
 * Verifies a correction restored from another execution context with only the
 * time endpoint. It never reads the vault, blocks callers or clears the cache:
 * a failure only leaves the correction as it was. A check that agrees with an
 * adopted correction only renews its session record, so a routine worker
 * restart never replaces the clock or invalidates codes on display.
 */
function startClockVerification(state, options) {
	if (state.pendingClockCheck) {
		return state.pendingClockCheck.promise;
	}
	state.clockVerificationAttempted = true;
	const controller = new AbortController();
	const checkOptions = { checkConfiguration: options.checkConfiguration, signal: controller.signal };
	const timer = setTimeout(() => controller.abort(), CLOCK_CHECK_TIMEOUT_MS);
	const pending = { controller, promise: null };
	pending.promise = (async () => {
		try {
			const snapshot = state.snapshot;
			await checkCurrent(state, checkOptions, snapshot, true);
			const clock = await loadOfflineClock({ instanceOrigin: state.instanceOrigin, signal: controller.signal });
			await checkCurrent(state, checkOptions, snapshot, true);
			const kept = offlineClockState(snapshot.clock);
			if (kept.status === 'cached' && Math.abs(clock.offsetMs - kept.offsetMs) <= CLOCK_CONFIRM_TOLERANCE_MS) {
				await writeClockVerification(state, clockVerificationRecord(state.instanceOrigin, snapshot.clock));
				return;
			}
			await persistSnapshot(state, copySnapshot({ ...snapshot, clock }), checkOptions);
			await writeClockVerification(state, clockVerificationRecord(state.instanceOrigin, clock));
		} finally {
			clearTimeout(timer);
			if (state.pendingClockCheck === pending) {
				state.pendingClockCheck = null;
			}
		}
	})();
	state.pendingClockCheck = pending;
	state.lastClockCheck = pending.promise;
	return pending.promise;
}

/**
 * Reports the time-only check of an unverified correction. It waits for the
 * check a list started, or reports the one that already finished in this
 * worker, and starts one only when none ran, so callers cannot repeat it.
 */
export async function verifyOfflineClock(instanceOrigin, options = {}) {
	requireOrigin(instanceOrigin);
	await checkConfiguration(options);
	const state = await getState(instanceOrigin, options.signal);
	const unverified = () => Boolean(state.snapshot) && offlineClockState(state.snapshot.clock).status === 'unverified';
	let check = state.pendingClockCheck?.promise;
	if (!check && !state.pendingSync) {
		if (!unverified()) {
			return;
		}
		check = state.lastClockCheck;
		if (!check) {
			if (globalThis.navigator?.onLine === false) {
				throw failure('SOURCE_OFFLINE');
			}
			check = startClockVerification(state, options);
		}
	}
	try {
		await check;
	} catch (error) {
		// A full synchronization that superseded the check verifies the clock too.
		if (!state.pendingSync && unverified()) {
			throw error;
		}
	}
	if (state.pendingSync) {
		await state.pendingSync.promise;
	}
	assertCurrent(state, options.signal);
}

function publicStatus(snapshot, accountCount = snapshot?.data.length || 0) {
	return {
		available: Boolean(snapshot && accountCount > 0),
		cachedAt: snapshot?.timestamp ?? null,
		accountCount,
		...(snapshot ? { clockStatus: offlineClockState(snapshot.clock).status } : {}),
	};
}

/** Imports the same data/timestamp/clock snapshot used by the main webpage. */
export async function importOfflineSource(instanceOrigin, value, options = {}) {
	requireOrigin(instanceOrigin);
	await checkConfiguration(options);
	// Replacing the state immediately invalidates earlier reads, fetches and generation.
	cancelOfflineIconSync();
	const state = newState(instanceOrigin);
	if (activeState?.instanceOrigin === instanceOrigin) {
		state.revision = activeState.revision;
		state.dataIdentity = activeState.dataIdentity;
		state.clockRevision = activeState.clockRevision;
		state.clockIdentity = activeState.clockIdentity;
	}
	activeState = state;
	state.ready = (async () => {
		try {
			const snapshot = copySnapshot(value);
			const accounts = await listOfflineAccounts(snapshot, { withDiagnostics: false });
			await checkCurrent(state, options);
			await persistSnapshot(state, snapshot, options, sanitizeServiceIcons(options.serviceIcons, collectServiceDomains(accounts)), true);
			state.syncedDirtyVersion = dirtyVersions.get(instanceOrigin) || 0;
			return publicStatus(snapshot, accounts.length);
		} catch (error) {
			if (activeState === state) {
				await clearOfflineSource(instanceOrigin);
			}
			throw error;
		}
	})();
	return state.ready;
}

/** Invalidates in-flight work before waiting for a persisted cache to be removed. */
export async function clearOfflineSource(instanceOrigin) {
	if (instanceOrigin !== undefined) {
		requireOrigin(instanceOrigin);
	}
	const clearingState = !instanceOrigin || activeState?.instanceOrigin === instanceOrigin ? activeState : null;
	let clearedOrigin = null;
	let clearedRevision = null;
	let clearedClockRevision = null;
	const invalidateSnapshot = (origin) => {
		clearedOrigin = origin;
		clearedRevision = createNonce();
		revisions.set(clearedOrigin, clearedRevision);
		clearedClockRevision = createNonce();
		clockRevisions.set(clearedOrigin, clearedClockRevision);
	};
	if (clearingState?.snapshot) {
		// Revoke an existing in-memory snapshot before storage removal can yield.
		invalidateSnapshot(clearingState.instanceOrigin);
	}
	if (clearingState) {
		clearingState.pendingIcons?.controller.abort();
		stopNetworkWork(clearingState);
		activeState = null;
	}
	await serializeStorage(async () => {
		const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
		if (!stored || (instanceOrigin && stored.instanceOrigin !== instanceOrigin)) {
			return;
		}
		if (!clearedRevision && stored.instanceOrigin) {
			invalidateSnapshot(stored.instanceOrigin);
		}
		await chrome.storage.local.remove(CACHE_KEY);
	});
	if (clearedOrigin && revisions.get(clearedOrigin) === clearedRevision) {
		notifyChange(clearedOrigin, clearedRevision, clearedClockRevision);
	}
}

/**
 * The stored clock may lack the anchor this worker adopted from the session
 * record, which is not written back. Use this worker's anchor for the same
 * correction, so status readers agree with the codes it generates.
 */
function withActiveClock(snapshot, instanceOrigin) {
	const active = activeState?.instanceOrigin === instanceOrigin ? activeState.snapshot?.clock : null;
	const stored = snapshot.clock;
	if (!active || !stored || active.offsetMs !== stored.offsetMs || active.syncedAtServerMs !== stored.syncedAtServerMs) {
		return snapshot;
	}
	return { ...snapshot, clock: active };
}

/** Status messages contain metadata only, never account secrets or codes. */
export async function readOfflineStatus(instanceOrigin) {
	requireOrigin(instanceOrigin);
	await storageQueue;
	const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
	if (stored?.instanceOrigin !== instanceOrigin) {
		return publicStatus(null);
	}
	try {
		const snapshot = withActiveClock(copySnapshot(stored.snapshot), instanceOrigin);
		const accounts = await listOfflineAccounts(snapshot, { withDiagnostics: false });
		return publicStatus(snapshot, accounts.length);
	} catch {
		return publicStatus(null);
	}
}

/** Trusted management readers receive sanitized cached images, never account data. */
export async function readOfflineIcons(instanceOrigin, options = {}) {
	requireOrigin(instanceOrigin);
	await checkConfiguration(options);
	const state = await getState(instanceOrigin, options.signal);
	await checkCurrent(state, options);
	const snapshot = state.snapshot;
	const accounts = snapshot ? await listOfflineAccounts(snapshot, { withDiagnostics: false }) : [];
	await checkCurrent(state, options, snapshot, true);
	return sanitizeServiceIcons(state.serviceIcons, collectServiceDomains(accounts));
}

export async function runOfflineOperation(kind, options = {}) {
	if (!['list', 'generate', 'generateMany'].includes(kind)) {
		throw failure('INVALID_REQUEST');
	}
	if (kind === 'generate' && (!options.metadata || options.metadata.id !== options.id)) {
		throw failure('INVALID_REQUEST');
	}
	const sourceChangeToken = kind === 'list' ? getOfflineSourceChangeToken(options.instanceOrigin) : null;
	await checkConfiguration(options);
	const state = await getState(options.instanceOrigin, options.signal);
	const now = Date.now();
	const browserOffline = globalThis.navigator?.onLine === false;
	if (browserOffline && !state.snapshot) {
		throw failure('OFFLINE_CACHE_MISSING');
	}
	const due = !state.snapshot || now - state.snapshot.timestamp >= SYNC_INTERVAL_MS || now < state.snapshot.timestamp;
	const dirty = state.syncedDirtyVersion !== (dirtyVersions.get(state.instanceOrigin) || 0);
	const refresh =
		options.refresh === true &&
		(state.lastSucceededAt === null || now < state.lastSucceededAt || now - state.lastSucceededAt >= INTERACTIVE_THROTTLE_MS);
	const backingOff = state.lastFailedAt !== null && now >= state.lastFailedAt && now - state.lastFailedAt < RETRY_INTERVAL_MS;
	const joinPendingSync = kind === 'list' && !browserOffline && Boolean(state.pendingSync);
	// Popup startup may show an existing snapshot while a separate management
	// request refreshes it. Never let that display read join a slow network read.
	const preferCachedSnapshot = kind === 'list' && options.preferCache === true && Boolean(state.snapshot);
	const needsRefresh = due || dirty || refresh || state.deferredRefresh;
	const sourceRefreshPending = preferCachedSnapshot && !browserOffline && (joinPendingSync || (needsRefresh && !backingOff));
	if (sourceRefreshPending && !state.pendingSync) {
		// A preview can renew its nonce before the UI launches the separate refresh.
		// Keep the original fresh-read requirement until that refresh has completed.
		state.deferredRefresh = true;
	}
	if (!state.snapshot && backingOff && !joinPendingSync) {
		throw failure(state.lastFailureCode || 'SOURCE_OFFLINE');
	}
	const synchronizing =
		!preferCachedSnapshot && (!state.snapshot || joinPendingSync || (kind === 'list' && needsRefresh && !backingOff && !browserOffline));
	if (synchronizing) {
		try {
			await synchronize(state, options);
		} catch (error) {
			if (!state.snapshot || !canUseCachedSnapshot(error)) {
				throw error;
			}
			assertCurrent(state, options.signal);
		}
	}
	// A correction imported from the webpage, or restored without a recent check
	// in this browser session, is verified with the light time endpoint in the
	// background. The vault does not wait for it; automatic filling waits up to
	// AUTOMATIC_CLOCK_WAIT_MS (3 seconds) for it while online.
	const currentClockStatus = state.snapshot ? offlineClockState(state.snapshot.clock).status : null;
	let clockCheck = state.pendingClockCheck?.promise ?? null;
	if (
		kind === 'list' &&
		!synchronizing &&
		!sourceRefreshPending &&
		!browserOffline &&
		!backingOff &&
		!state.pendingSync &&
		state.snapshot &&
		!state.clockVerificationAttempted &&
		(currentClockStatus === 'unverified' || (currentClockStatus === 'cached' && state.clockRecheck))
	) {
		clockCheck = startClockVerification(state, options);
		clockCheck.catch(() => {});
	}
	if (kind !== 'list' && options.awaitClockCheck === true && !browserOffline) {
		await waitForClockCheck(state, options.signal);
	}
	const snapshot = state.snapshot;
	await checkCurrent(state, options, snapshot);
	observeClockVerification(state, offlineClockState(snapshot.clock).status);
	if (kind === 'list') {
		const result = await listOfflineAccounts(snapshot, { withDiagnostics: options.withDiagnostics === true });
		await checkCurrent(state, options, snapshot);
		if (sourceChangeToken !== getOfflineSourceChangeToken(state.instanceOrigin)) {
			throw failure('ACCOUNT_CHANGED');
		}
		const clockStatus = offlineClockState(snapshot.clock).status;
		return options.withDiagnostics
			? {
					...result,
					sourceRevision: snapshotRevisions.get(snapshot),
					sourceChangeToken,
					sourceClockRevision: snapshotClockRevisions.get(snapshot),
					...(sourceRefreshPending ? { sourceRefreshPending: true } : {}),
					offlineStatus: {
						cachedAt: snapshot.timestamp,
						usingCache: true,
						clockStatus,
						// The caller may ask for the check's outcome; it can finish before this reply.
						...(clockStatus === 'unverified' && (clockCheck || state.pendingClockCheck) ? { clockVerificationPending: true } : {}),
					},
					...(Object.keys(state.serviceIcons).length ? { serviceIcons: { ...state.serviceIcons } } : {}),
				}
			: result;
	}
	// Account revision deliberately excludes clock metadata. A generation must
	// still use the currently effective clock, even when account data is stable.
	const generationClock = offlineClockState(snapshot.clock);
	const checkGenerationCurrent = async () => {
		await checkCurrent(state, options, snapshot);
		const currentClock = offlineClockState(state.snapshot.clock);
		if (currentClock.status === 'changed') {
			throw failure('CLOCK_CHANGED');
		}
		if (currentClock.status === 'unavailable') {
			throw failure('CLOCK_UNAVAILABLE');
		}
		if (
			currentClock.status !== generationClock.status ||
			currentClock.offsetMs !== generationClock.offsetMs ||
			snapshotClockRevisions.get(snapshot) !== state.clockRevision
		) {
			throw failure('ACCOUNT_CHANGED');
		}
	};
	let codes;
	try {
		await checkGenerationCurrent();
		codes = await generateOfflineCodes(snapshot, {
			...options,
			accounts: kind === 'generate' ? [options.metadata] : options.accounts,
			checkCurrent: checkGenerationCurrent,
		});
	} catch (error) {
		if (invalidatesCache(error) && activeState === state && state.snapshot === snapshot) {
			await clearOfflineSource(state.instanceOrigin);
		}
		throw error;
	}
	await checkGenerationCurrent();
	// Final delivery can still await browser I/O after generation returns. Report
	// this snapshot, rather than the earlier account-list revision, so callers can
	// reject a code superseded during those waits without exposing its secret.
	options.onGenerationSource?.({
		revision: snapshotRevisions.get(snapshot),
		clockRevision: snapshotClockRevisions.get(snapshot),
	});
	if (kind === 'generateMany') {
		return codes;
	}
	const code = codes[0];
	if (!code || code.error) {
		throw failure(code?.error?.code || 'INVALID_RESPONSE');
	}
	const result = { ...code };
	delete result.id;
	return result;
}
