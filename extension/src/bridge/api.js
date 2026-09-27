import { localizedError } from '../shared/localized-error.js';
import { LIMITS, accountMetadataMatches, isPlainObject, sanitizeAccountMetadata } from '../shared/protocol.js';
import { TotpError, decodeBase32, generateTotp, normalizeTotpOptions } from '../shared/totp.js';
import { getSearchFamilyNames } from '../../../src/shared/search-filter.js';
import { getOtherServiceAccounts } from '../shared/search-family.js';
import { normalizeInstanceOrigin } from '../shared/origin.js';
import { parseOfflineSecretsCache, parseOfflineClockCache } from '../../../src/shared/offline-cache.js';
import { currentMonotonicOrigin, isUsableOfflineClock, offlineClockState } from '../shared/offline-clock.js';

const API_PATHS = Object.freeze({
	SECRETS: '/api/secrets',
	TIME: '/api/time',
});
const offlineClockAnchors = new WeakMap();
const FETCH_OPTIONS = Object.freeze({
	cache: 'no-store',
	redirect: 'error',
});
// The instance reports a missing or expired login with its own JSON 401.
const AUTH_STATUSES = new Set([401]);
const SAFE_WINDOW_MS = 5000;
const MAX_SAFE_WINDOW_ATTEMPTS = 3;

export const BRIDGE_ERROR_CODES = Object.freeze({
	CLOCK_CHANGED: 'CLOCK_CHANGED',
	CLOCK_UNAVAILABLE: 'CLOCK_UNAVAILABLE',
	AUTH_REQUIRED: 'AUTH_REQUIRED',
	SOURCE_OFFLINE: 'SOURCE_OFFLINE',
	INVALID_RESPONSE: 'INVALID_RESPONSE',
	INVALID_REQUEST: 'INVALID_REQUEST',
	ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
	ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
	INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export class BridgeError extends Error {
	constructor(code) {
		const safeCode = Object.hasOwn(BRIDGE_ERROR_CODES, code) ? code : BRIDGE_ERROR_CODES.INTERNAL_ERROR;
		const localized = localizedError(`error_${safeCode}`, safeCode);
		super(localized.message);
		this.messageKey = localized.messageKey;
		this.name = 'BridgeError';
		this.code = safeCode;
	}
}

function invalidResponse() {
	return new BridgeError(BRIDGE_ERROR_CODES.INVALID_RESPONSE);
}

function isJsonContentType(contentType) {
	return typeof contentType === 'string' && /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType.trim());
}

/**
 * A 403 is a login failure only when the instance itself produced it: its JSON
 * error body ({ error, message }) without a Cloudflare challenge marker. Rules in
 * front of the instance (region blocks, managed challenges, WAF, Access) return
 * other 403 pages. They mean the instance is unreachable, so the offline copy and
 * the web login stay valid.
 */
async function classifyForbidden(response) {
	if (response.headers.get('cf-mitigated') !== null || !isJsonContentType(response.headers.get('content-type'))) {
		return BRIDGE_ERROR_CODES.SOURCE_OFFLINE;
	}
	let body;
	try {
		body = await response.json();
	} catch {
		return BRIDGE_ERROR_CODES.SOURCE_OFFLINE;
	}
	return isPlainObject(body) && typeof body.error === 'string' && typeof body.message === 'string'
		? BRIDGE_ERROR_CODES.AUTH_REQUIRED
		: BRIDGE_ERROR_CODES.SOURCE_OFFLINE;
}

function getRequestContext(instanceOrigin, signal) {
	// Online reads always target the configured instance, never an ambient page
	// or extension origin. Callers must supply its canonical HTTP(S) origin.
	try {
		if (normalizeInstanceOrigin(instanceOrigin) !== instanceOrigin) {
			throw new Error('Non-canonical origin');
		}
	} catch {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}
	return { origin: instanceOrigin, credentials: 'include', signal };
}

function assertRequestActive(context) {
	if (context.signal?.aborted) {
		throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
	}
}

async function fetchJsonResponse(path, fetchImpl, context, signal) {
	if (typeof fetchImpl !== 'function') {
		throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
	}

	const url = new URL(path, context.origin);
	let response;
	try {
		response = await fetchImpl(url, { ...FETCH_OPTIONS, credentials: context.credentials, signal });
	} catch {
		throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
	}

	if (!response || !Number.isInteger(response.status) || typeof response.json !== 'function' || !response.headers?.get) {
		throw invalidResponse();
	}
	if (
		response.redirected ||
		response.type === 'opaqueredirect' ||
		AUTH_STATUSES.has(response.status) ||
		(response.status >= 300 && response.status < 400)
	) {
		throw new BridgeError(BRIDGE_ERROR_CODES.AUTH_REQUIRED);
	}
	if (response.status === 403) {
		throw new BridgeError(await classifyForbidden(response));
	}
	if ([408, 429, 503].includes(response.status) || (context.offline && response.status >= 500 && response.status < 600)) {
		throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
	}
	if (response.status !== 200 || !isJsonContentType(response.headers.get('content-type'))) {
		throw invalidResponse();
	}

	try {
		return await response.json();
	} catch (error) {
		// Fetch resolves at the response headers; reading the body can still fail
		// in transit. Only invalid content should revoke an existing offline vault.
		if (error instanceof TypeError || error?.name === 'AbortError') {
			throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
		}
		throw invalidResponse();
	}
}

async function fetchJson(path, fetchImpl, context) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	assertRequestActive(context);
	context.signal?.addEventListener('abort', abort, { once: true });
	let timer;
	try {
		const value = await Promise.race([
			fetchJsonResponse(path, fetchImpl, context, controller.signal),
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE));
				}, 8000);
			}),
		]);
		assertRequestActive(context);
		return value;
	} finally {
		clearTimeout(timer);
		context.signal?.removeEventListener('abort', abort);
	}
}

function requiredString(value, maxLength, allowEmpty = false) {
	return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function normalizeSourceAccountId(value) {
	// Older vaults use numeric IDs. Keep the extension protocol canonical while
	// applying the same identity rule to records, duplicate checks and diagnostics.
	if (Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return requiredString(value, 200) ? value : null;
}

function normalizeSecretRecord(value) {
	if (!isPlainObject(value)) {
		throw invalidResponse();
	}

	const id = normalizeSourceAccountId(value.id);
	const account = value.account === undefined ? '' : value.account;
	const type = value.type === undefined ? 'TOTP' : value.type;
	const digits = value.digits === undefined ? 6 : value.digits;
	const period = value.period === undefined ? 30 : value.period;
	const algorithm = value.algorithm === undefined ? 'SHA1' : value.algorithm;

	if (
		id === null ||
		!requiredString(value.name, 200) ||
		!requiredString(account, 500, true) ||
		!requiredString(value.secret, 2048) ||
		typeof type !== 'string' ||
		!['TOTP', 'HOTP'].includes(type.toUpperCase())
	) {
		throw invalidResponse();
	}

	let options;
	const normalizedType = type.toUpperCase();
	try {
		if (normalizedType === 'HOTP') {
			// HOTP does not use period. Restored accounts may legitimately store 0
			// or another unused value, so validate only their relevant parameters.
			const commonOptions = normalizeTotpOptions({ digits, algorithm });
			const counter = value.counter === undefined ? 0 : value.counter;
			if (!Number.isSafeInteger(counter) || counter < 0) {
				throw invalidResponse();
			}
			options = { digits: commonOptions.digits, algorithm: commonOptions.algorithm };
		} else {
			options = normalizeTotpOptions({ digits, period, algorithm });
		}
		decodeBase32(value.secret);
	} catch {
		throw invalidResponse();
	}

	return {
		id,
		name: value.name,
		account,
		secret: value.secret,
		type: normalizedType,
		...options,
	};
}

function parseSecretList(value) {
	if (!Array.isArray(value) || value.length > LIMITS.MAX_ACCOUNTS) {
		throw invalidResponse();
	}

	const records = [];
	const unavailableAccounts = [];
	const counts = new Map();
	for (const item of value) {
		const id = normalizeSourceAccountId(item?.id);
		if (id !== null) {
			counts.set(id, (counts.get(id) || 0) + 1);
		}
	}
	for (const item of value) {
		const id = normalizeSourceAccountId(item?.id);
		const duplicate = id !== null && counts.get(id) > 1;
		try {
			if (duplicate) {
				throw invalidResponse();
			}
			records.push(normalizeSecretRecord(item));
		} catch {
			unavailableAccounts.push({
				id,
				name: requiredString(item?.name, 200) ? item.name : '',
				...(!requiredString(item?.name, 200) ? { nameKey: 'error_UNNAMED_ACCOUNT' } : {}),
				reason: duplicate ? 'duplicate' : 'invalid',
			});
		}
	}
	return { records, unavailableAccounts };
}

async function fetchSecrets(fetchImpl, context) {
	return parseSecretList(await fetchJson(API_PATHS.SECRETS, fetchImpl, context)).records;
}

async function fetchServerTime(fetchImpl, now, context) {
	const requestStartedAt = now();
	const value = await fetchJson(API_PATHS.TIME, fetchImpl, context);
	const requestFinishedAt = now();
	if (
		!isPlainObject(value) ||
		!Number.isSafeInteger(value.serverTimeMs) ||
		value.serverTimeMs < 0 ||
		!Number.isFinite(requestStartedAt) ||
		!Number.isFinite(requestFinishedAt)
	) {
		throw invalidResponse();
	}

	const roundTripMs = Math.max(0, requestFinishedAt - requestStartedAt);
	return {
		serverTimeMs: value.serverTimeMs + roundTripMs / 2,
		clientAnchorMs: requestFinishedAt,
	};
}

function toAccountMetadata(record, searchFamily, otherService = false) {
	const metadata = sanitizeAccountMetadata({
		id: record.id,
		name: record.name,
		account: record.account,
		type: record.type,
		digits: record.digits,
		...(searchFamily === undefined ? {} : { searchFamily }),
		...(otherService ? { searchFamilyKind: 'other' } : {}),
	});
	if (!metadata) {
		throw invalidResponse();
	}
	return metadata;
}

function validateGenerateRequest(id, metadata) {
	const account = sanitizeAccountMetadata(metadata);
	if (!requiredString(id, 200) || !account || account.id !== id) {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}
	return account;
}

function estimatedServerTime(synchronized, minimumElapsedMs, currentClientTime) {
	if (!Number.isFinite(currentClientTime)) {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}
	const observedElapsedMs = Math.max(0, currentClientTime - synchronized.clientAnchorMs);
	return synchronized.serverTimeMs + Math.max(minimumElapsedMs, observedElapsedMs);
}

function remainingInPeriod(serverTimeMs, period) {
	const periodMs = period * 1000;
	const elapsed = serverTimeMs % periodMs;
	return elapsed === 0 ? periodMs : periodMs - elapsed;
}

function findExpectedRecord(records, id, expectedAccount) {
	const record = records.find((item) => item.id === id);
	if (!record) {
		throw new BridgeError(BRIDGE_ERROR_CODES.ACCOUNT_NOT_FOUND);
	}
	if (record.type !== 'TOTP' || !accountMetadataMatches(toAccountMetadata(record), expectedAccount)) {
		throw new BridgeError(BRIDGE_ERROR_CODES.ACCOUNT_CHANGED);
	}
	return record;
}

export async function listTotpAccounts({ instanceOrigin, signal, fetchImpl = globalThis.fetch, withDiagnostics = false } = {}) {
	const { records, unavailableAccounts } = parseSecretList(
		await fetchJson(API_PATHS.SECRETS, fetchImpl, getRequestContext(instanceOrigin, signal)),
	);
	// Group against the complete vault, including HOTP accounts, just as the
	// main UI does. Only public metadata enters the aggregation caches.
	const publicRecords = records.map(({ id, name, account, type, digits }) => ({ id, name, account, type, digits }));
	const familyNames = getSearchFamilyNames(publicRecords);
	const otherServices = getOtherServiceAccounts(publicRecords);
	const accounts = publicRecords
		.filter((record) => record.type === 'TOTP')
		.map((record) => toAccountMetadata(record, familyNames.get(record), otherServices.has(record)));
	return withDiagnostics ? { accounts, unavailableAccounts } : accounts;
}

async function generateCodeWithSources(
	{
		id,
		metadata,
		includeNext = false,
		instanceOrigin,
		signal,
		fetchImpl = globalThis.fetch,
		now = () => Date.now(),
		sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
		generateImpl = generateTotp,
	} = {},
	sources = null,
) {
	const expectedAccount = validateGenerateRequest(id, metadata);
	const safeWindowMs = includeNext ? 1000 : SAFE_WINDOW_MS;
	if (typeof includeNext !== 'boolean' || typeof now !== 'function' || typeof sleep !== 'function' || typeof generateImpl !== 'function') {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}

	const context = sources?.context || getRequestContext(instanceOrigin, signal);
	const synchronized = sources?.synchronized || (await fetchServerTime(fetchImpl, now, context));
	let minimumElapsedMs = 0;
	for (let attempt = 0; attempt < MAX_SAFE_WINDOW_ATTEMPTS; attempt += 1) {
		let records = sources?.readRecords
			? await sources.readRecords()
			: sources && attempt === 0
				? sources.records
				: await fetchSecrets(fetchImpl, context);
		let record = findExpectedRecord(records, id, expectedAccount);
		const serverTimeMs = estimatedServerTime(synchronized, minimumElapsedMs, now());
		const remainingMs = remainingInPeriod(serverTimeMs, record.period);

		if (remainingMs < safeWindowMs) {
			minimumElapsedMs = Math.max(minimumElapsedMs, serverTimeMs - synchronized.serverTimeMs + remainingMs);
			records = null;
			record = null;
			if (attempt === MAX_SAFE_WINDOW_ATTEMPTS - 1) {
				throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
			}
			await sleep(remainingMs);
			continue;
		}

		const periodMs = record.period * 1000;
		const generatedWindow = Math.floor(serverTimeMs / periodMs);
		let code;
		let nextCode;
		try {
			code = await generateImpl(record.secret, serverTimeMs, record);
			if (includeNext) {
				nextCode = await generateImpl(record.secret, (generatedWindow + 1) * periodMs, record);
			}
		} catch (error) {
			if (error instanceof TotpError && error.code !== 'CRYPTO_FAILURE') {
				throw invalidResponse();
			}
			throw new BridgeError(BRIDGE_ERROR_CODES.INTERNAL_ERROR);
		}
		assertRequestActive(context);
		if (sources?.checkCurrent) {
			await sources.checkCurrent();
			assertRequestActive(context);
		}

		const completedClientTimeMs = now();
		const completedServerTimeMs = estimatedServerTime(synchronized, minimumElapsedMs, completedClientTimeMs);
		const completedWindow = Math.floor(completedServerTimeMs / periodMs);
		const completedRemainingMs = remainingInPeriod(completedServerTimeMs, record.period);
		if (generatedWindow !== completedWindow || completedRemainingMs < safeWindowMs) {
			minimumElapsedMs = Math.max(minimumElapsedMs, completedServerTimeMs - synchronized.serverTimeMs);
			code = null;
			nextCode = null;
			records = null;
			record = null;
			if (attempt === MAX_SAFE_WINDOW_ATTEMPTS - 1) {
				throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
			}
			if (completedRemainingMs < safeWindowMs) {
				minimumElapsedMs += completedRemainingMs;
				await sleep(completedRemainingMs);
			}
			continue;
		}
		if (
			typeof code !== 'string' ||
			code.length !== record.digits ||
			!/^\d+$/.test(code) ||
			(includeNext && (typeof nextCode !== 'string' || nextCode.length !== record.digits || !/^\d+$/.test(nextCode)))
		) {
			throw new BridgeError(BRIDGE_ERROR_CODES.INTERNAL_ERROR);
		}

		return {
			code,
			digits: record.digits,
			period: record.period,
			validUntil: (completedWindow + 1) * periodMs,
			// Anchor the remaining lifetime to this browser's clock. The background
			// must not subtract time already spent waiting or generating this code.
			generatedAt: completedClientTimeMs,
			remainingMs: completedRemainingMs,
			...(includeNext ? { nextCode } : {}),
		};
	}

	throw new BridgeError(BRIDGE_ERROR_CODES.INTERNAL_ERROR);
}

export function serializeBridgeError(error) {
	const safeError = error instanceof BridgeError ? error : new BridgeError(BRIDGE_ERROR_CODES.INTERNAL_ERROR);
	return { code: safeError.code, message: safeError.message, messageKey: safeError.messageKey };
}

export async function generateTotpCode(options = {}) {
	return generateCodeWithSources(options);
}

// A batch shares source data only for this operation; no seeds survive in a cache.
export async function generateTotpCodes({
	accounts,
	instanceOrigin,
	signal,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
	...options
} = {}) {
	if (
		!Array.isArray(accounts) ||
		accounts.length === 0 ||
		accounts.length > 32 ||
		new Set(accounts.map((account) => account?.id)).size !== accounts.length
	) {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}
	accounts.forEach((account) => validateGenerateRequest(account?.id, account));
	const context = getRequestContext(instanceOrigin, signal);
	const synchronized = await fetchServerTime(fetchImpl, now, context);
	const records = await fetchSecrets(fetchImpl, context);
	return Promise.all(
		accounts.map(async (account) => {
			try {
				const data = await generateCodeWithSources(
					{ ...options, id: account.id, metadata: account, instanceOrigin, signal, fetchImpl, now },
					{ context, synchronized, records },
				);
				return { id: account.id, ...data };
			} catch (error) {
				return { id: account.id, error: serializeBridgeError(error) };
			}
		}),
	);
}

async function synchronizeOfflineClock(fetchImpl, now, context) {
	const wallStart = now();
	const monoStart = performance.now();
	const synchronized = await fetchServerTime(fetchImpl, now, context);
	const timestamp = now();
	const elapsed = performance.now() - monoStart;
	if (Math.abs(timestamp - wallStart - elapsed) > 1000 || elapsed < 0) {
		throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_CHANGED);
	}
	if (elapsed > 2000) {
		throw new BridgeError(BRIDGE_ERROR_CODES.SOURCE_OFFLINE);
	}
	const monotonicOrigin = currentMonotonicOrigin();
	const candidateClock = {
		version: 2,
		offsetMs: synchronized.serverTimeMs - synchronized.clientAnchorMs,
		syncedAtServerMs: synchronized.serverTimeMs,
		localWallAtSyncMs: synchronized.clientAnchorMs,
		monotonicEpochAtSyncMs: performance.timeOrigin + performance.now() - (timestamp - synchronized.clientAnchorMs),
		rttMs: null,
		// The monotonic anchor is comparable only inside this worker instance.
		// A restarted worker sees another origin and must verify the offset again.
		...(monotonicOrigin !== null ? { monotonicOriginMs: monotonicOrigin } : {}),
	};
	// A successful correction must also be readable after worker restart.
	// Reject it before assignment so a first failed sync retains local mode.
	if (!parseOfflineClockCache(JSON.stringify(candidateClock), timestamp, performance.timeOrigin + performance.now())) {
		throw invalidResponse();
	}
	return candidateClock;
}

/**
 * Checks only the public time endpoint. A correction restored from another
 * execution context is verified this way without reading the account vault.
 */
export async function loadOfflineClock({ instanceOrigin, signal, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
	const context = { ...getRequestContext(instanceOrigin, signal), offline: true };
	const clock = await synchronizeOfflineClock(fetchImpl, now, context);
	assertRequestActive(context);
	return clock;
}

// The offline mode uses the same snapshot schema and clock-cache validation as
// the main page. These functions run only in the trusted extension background.
export async function loadOfflineSnapshot({
	instanceOrigin,
	signal,
	previousClock,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
} = {}) {
	const context = { ...getRequestContext(instanceOrigin, signal), offline: true };
	const data = await fetchJson(API_PATHS.SECRETS, fetchImpl, context);
	parseSecretList(data);
	let clock = null;
	try {
		clock = await synchronizeOfflineClock(fetchImpl, now, context);
	} catch (error) {
		// Data synchronization supersedes deleted accounts even when the clock
		// endpoint is unavailable. Authentication failures still invalidate it.
		if (error?.code === BRIDGE_ERROR_CODES.AUTH_REQUIRED) {
			throw error;
		}
		const previous = offlineClockState(previousClock, now(), performance.timeOrigin + performance.now());
		if (error?.code === BRIDGE_ERROR_CODES.CLOCK_CHANGED || previous.status === 'changed') {
			clock = { error: 'CLOCK_CHANGED' };
		} else if (error?.code === BRIDGE_ERROR_CODES.SOURCE_OFFLINE && isUsableOfflineClock(previous.status)) {
			// A transient time failure must not discard a still-valid correction.
			// Keep its original anchors so failed refreshes cannot renew its age.
			clock = previousClock;
		} else if (previousClock !== undefined && previousClock !== null) {
			// Losing a previous correction is not evidence that the local clock is
			// correct. Persist the block until a successful synchronization replaces
			// it, while still applying authoritative account additions and removals.
			clock = { error: 'CLOCK_UNAVAILABLE' };
		}
	}
	assertRequestActive(context);
	return { data, timestamp: now(), clock };
}

export function listOfflineAccounts(snapshot, { withDiagnostics = false } = {}) {
	const parsed = parseOfflineSecretsCache(JSON.stringify(snapshot));
	if (!parsed) {
		throw invalidResponse();
	}
	const { records, unavailableAccounts } = parseSecretList(parsed.data);
	const publicRecords = records.map(({ id, name, account, type, digits }) => ({ id, name, account, type, digits }));
	const families = getSearchFamilyNames(publicRecords);
	const otherServices = getOtherServiceAccounts(publicRecords);
	const accounts = publicRecords
		.filter((record) => record.type === 'TOTP')
		.map((record) => toAccountMetadata(record, families.get(record), otherServices.has(record)));
	return withDiagnostics ? { accounts, unavailableAccounts } : accounts;
}

export async function generateOfflineCodes(
	snapshot,
	{
		accounts,
		instanceOrigin,
		signal,
		includeNext = false,
		checkCurrent = async () => {},
		now = () => Date.now(),
		monotonicNow = () => performance.now(),
		...options
	} = {},
) {
	if (
		!Array.isArray(accounts) ||
		!accounts.length ||
		accounts.length > 32 ||
		new Set(accounts.map((account) => account?.id)).size !== accounts.length
	) {
		throw new BridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST);
	}
	accounts.forEach((account) => validateGenerateRequest(account?.id, account));
	const parsed = parseOfflineSecretsCache(JSON.stringify(snapshot));
	if (!parsed) {
		throw invalidResponse();
	}
	const records = parseSecretList(parsed.data).records;
	// Local generation has no endpoint or browser credential context. Its only
	// request lifecycle dependency is cancellation supplied by the caller.
	const context = { signal };
	if (snapshot.clock?.error === 'CLOCK_CHANGED') {
		throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_CHANGED);
	}
	const startedWall = now();
	const startedMonotonic = monotonicNow();
	const clock = offlineClockState(snapshot.clock, startedWall, performance.timeOrigin + startedMonotonic);
	if (clock.status === 'changed') {
		throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_CHANGED);
	}
	if (clock.status === 'unavailable') {
		throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_UNAVAILABLE);
	}
	let anchor = offlineClockAnchors.get(snapshot);
	if (!anchor) {
		anchor = { wallTime: startedWall, monotonicTime: startedMonotonic, serverTime: startedWall + clock.offsetMs };
		offlineClockAnchors.set(snapshot, anchor);
	}
	if (Math.abs(startedWall - anchor.wallTime - (startedMonotonic - anchor.monotonicTime)) > 2000) {
		throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_CHANGED);
	}
	const synchronized = { serverTimeMs: anchor.serverTime + startedMonotonic - anchor.monotonicTime, clientAnchorMs: startedWall };
	const validate = async () => {
		assertRequestActive(context);
		await checkCurrent();
		if (snapshot.clock?.error === 'CLOCK_UNAVAILABLE') {
			throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_UNAVAILABLE);
		}
		if (Math.abs(now() - startedWall - (monotonicNow() - startedMonotonic)) > 2000) {
			throw new BridgeError(BRIDGE_ERROR_CODES.CLOCK_CHANGED);
		}
		assertRequestActive(context);
	};
	return Promise.all(
		accounts.map(async (account) => {
			await validate();
			const result = await generateCodeWithSources(
				{ ...options, id: account.id, metadata: account, instanceOrigin, signal, includeNext, now },
				{
					context,
					synchronized,
					checkCurrent: validate,
					readRecords: async () => {
						await validate();
						return records;
					},
				},
			);
			await validate();
			return { id: account.id, ...result };
		}),
	);
}
