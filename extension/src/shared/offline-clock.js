import { parseOfflineClockCache } from '../../../src/shared/offline-cache.js';

const SAME_CONTEXT_TOLERANCE_MS = 2000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// How long a restarted worker keeps trusting the last time check of this
// browser session. A forward system time change made while no worker ran
// cannot be detected, so the trust is short; online checks renew it cheaply.
export const SESSION_CLOCK_TRUST_MS = 15 * 60 * 1000;
const BACKWARD_TOLERANCE_MS = 2000;

/** The time origin identifying this execution context's monotonic clock. */
export function currentMonotonicOrigin() {
	const origin = globalThis.performance?.timeOrigin;
	return Number.isFinite(origin) ? origin : null;
}

/**
 * performance.timeOrigin + performance.now() is only monotonic inside one
 * execution context. Each MV3 worker start and each webpage samples a new
 * origin from the wall clock, so a persisted anchor from another context
 * cannot reveal a time correction made in between. Such a correction keeps
 * the webpage rule (the shared parser, including its tolerance), but reports
 * 'unverified' so callers show the time warning and verify it again online.
 */
export function offlineClockState(
	value,
	wallNow = Date.now(),
	monotonicEpochNow = performance.timeOrigin + performance.now(),
	monotonicOrigin = currentMonotonicOrigin(),
) {
	if (value?.error === 'CLOCK_CHANGED') {
		return { status: 'changed', offsetMs: 0 };
	}
	if (value?.error === 'CLOCK_UNAVAILABLE') {
		return { status: 'unavailable', offsetMs: 0 };
	}
	const sameContext = value?.version === 2 && monotonicOrigin !== null && value.monotonicOriginMs === monotonicOrigin;
	if (
		sameContext &&
		Number.isFinite(value.localWallAtSyncMs) &&
		Number.isFinite(value.monotonicEpochAtSyncMs) &&
		Math.abs(wallNow - value.localWallAtSyncMs - (monotonicEpochNow - value.monotonicEpochAtSyncMs)) > SAME_CONTEXT_TOLERANCE_MS
	) {
		return { status: 'changed', offsetMs: 0 };
	}
	const clock = parseOfflineClockCache(JSON.stringify(value), wallNow, monotonicEpochNow);
	if (!clock) {
		return { status: 'local', offsetMs: 0 };
	}
	if (wallNow + clock.offsetMs - clock.syncedAtServerMs > STALE_AFTER_MS) {
		return { status: 'stale', offsetMs: clock.offsetMs };
	}
	return { status: sameContext ? 'cached' : 'unverified', offsetMs: clock.offsetMs };
}

/** Both states keep the correction; only an online synchronization renews it. */
export function isUsableOfflineClock(status) {
	return status === 'cached' || status === 'unverified';
}

/** The result of a successful time check, kept in storage.session for this browser session. */
export function clockVerificationRecord(instanceOrigin, clock, wallNow = Date.now()) {
	return {
		instanceOrigin,
		offsetMs: clock.offsetMs,
		syncedAtServerMs: clock.syncedAtServerMs,
		verifiedAtWallMs: wallNow,
		lastSeenWallMs: wallNow,
	};
}

/**
 * Lets a restarted worker keep a correction verified earlier in this browser
 * session. The record must describe the same correction, the wall clock must
 * not have moved backwards since a worker last saw it, and the check must be
 * recent. The correction is then anchored to this worker's monotonic clock, so
 * later changes are detected here again. Returns null when it stays unverified.
 */
export function adoptVerifiedClock(
	clock,
	record,
	instanceOrigin,
	wallNow = Date.now(),
	monotonicEpochNow = performance.timeOrigin + performance.now(),
	monotonicOrigin = currentMonotonicOrigin(),
) {
	if (
		monotonicOrigin === null ||
		clock?.version !== 2 ||
		!record ||
		record.instanceOrigin !== instanceOrigin ||
		record.offsetMs !== clock.offsetMs ||
		record.syncedAtServerMs !== clock.syncedAtServerMs ||
		!Number.isFinite(record.verifiedAtWallMs) ||
		!Number.isFinite(record.lastSeenWallMs) ||
		wallNow < Math.max(record.verifiedAtWallMs, record.lastSeenWallMs) - BACKWARD_TOLERANCE_MS ||
		wallNow - record.verifiedAtWallMs > SESSION_CLOCK_TRUST_MS
	) {
		return null;
	}
	const adopted = { ...clock, localWallAtSyncMs: wallNow, monotonicEpochAtSyncMs: monotonicEpochNow, monotonicOriginMs: monotonicOrigin };
	return offlineClockState(adopted, wallNow, monotonicEpochNow, monotonicOrigin).status === 'cached' ? adopted : null;
}
