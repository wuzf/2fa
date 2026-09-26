/**
 * Shared cache readers. These functions intentionally depend only on their
 * arguments and standard globals so web adapters can serialize them safely.
 */
export function parseOfflineSecretsCache(raw, maxAccounts = 5000) {
	if (typeof raw !== 'string') {
		return null;
	}
	try {
		const cached = JSON.parse(raw);
		if (
			!cached ||
			!Array.isArray(cached.data) ||
			cached.data.length > maxAccounts ||
			!Number.isFinite(cached.timestamp) ||
			cached.timestamp < 0
		) {
			return null;
		}
		return { data: cached.data, timestamp: cached.timestamp };
	} catch {
		return null;
	}
}

export function parseOfflineClockCache(raw, wallNow, monotonicEpochNow) {
	if (typeof raw !== 'string') {
		return null;
	}
	try {
		const cached = JSON.parse(raw);
		const minTimeMs = Date.UTC(2000, 0, 1);
		const maxTimeMs = Date.UTC(2100, 0, 1);
		// Method syntax keeps name-preservation helpers outside this serialized
		// parser, including Wrangler's default keepNames build mode.
		const { isValidTime } = {
			isValidTime(value) {
				return Number.isFinite(value) && value >= minTimeMs && value < maxTimeMs;
			},
		};
		if (
			!cached ||
			cached.version !== 2 ||
			!Number.isFinite(cached.offsetMs) ||
			!isValidTime(cached.syncedAtServerMs) ||
			!isValidTime(cached.localWallAtSyncMs) ||
			!isValidTime(cached.monotonicEpochAtSyncMs) ||
			!Number.isFinite(wallNow) ||
			!Number.isFinite(monotonicEpochNow)
		) {
			return null;
		}

		const wallElapsedMs = wallNow - cached.localWallAtSyncMs;
		const monotonicElapsedMs = monotonicEpochNow - cached.monotonicEpochAtSyncMs;
		if (!Number.isFinite(monotonicElapsedMs) || Math.abs(wallElapsedMs - monotonicElapsedMs) > 60 * 1000) {
			return null;
		}

		const estimatedServerNow = wallNow + cached.offsetMs;
		if (!isValidTime(estimatedServerNow) || estimatedServerNow - cached.syncedAtServerMs < -5 * 60 * 1000) {
			return null;
		}

		return {
			version: 2,
			offsetMs: cached.offsetMs,
			syncedAtServerMs: cached.syncedAtServerMs,
			rttMs: Number.isFinite(cached.rttMs) ? cached.rttMs : null,
			localWallAtSyncMs: cached.localWallAtSyncMs,
			monotonicEpochAtSyncMs: cached.monotonicEpochAtSyncMs,
		};
	} catch {
		return null;
	}
}
