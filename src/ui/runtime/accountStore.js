/** The single host-private account state. This factory has no browser or module closure dependencies. */
export function createAccountStore(options = {}) {
	let records = Object.freeze([]);
	let byId = new Map();
	let generations = new Map();
	let generationSequence = 0;
	let sessionGeneration = 0;
	let readGeneration = 0;
	let revision = 0;
	let blocked = false;
	let accessVerified = false;
	let source = null;
	let library = Object.freeze({ state: 'loading', refreshState: 'idle', errorKey: null });
	let hidden = Object.freeze({ count: 0, records: Object.freeze([]) });
	let operationSequence = 0;
	const writes = new Map();
	const operations = new Map();
	const internalListeners = new Set();
	const listeners = new Set();
	const notifications = [];
	let notifying = false;
	function immutable(value) {
		if (Array.isArray(value)) {
			return Object.freeze(value.map(immutable));
		}
		if (value && typeof value === 'object') {
			return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutable(item)])));
		}
		return value;
	}
	function report(error) {
		try {
			options.onError?.(error);
		} catch {
			/* A diagnostic cannot undo a committed write. */
		}
	}
	function emit(reason, changedIds = [], removedIds = []) {
		const change = immutable({ reason, revision: ++revision, sessionGeneration, changedIds, removedIds });
		for (const listener of [...internalListeners]) {
			try {
				listener(change);
			} catch (error) {
				report(error);
			}
		}
		notifications.push(change);
		if (notifying) {
			return;
		}
		notifying = true;
		try {
			while (notifications.length) {
				const next = notifications.shift();
				for (const listener of [...listeners]) {
					if (!listeners.has(listener)) {
						continue;
					}
					try {
						listener(next);
					} catch (error) {
						report(error);
					}
				}
			}
		} finally {
			notifying = false;
		}
	}
	function isSessionCurrent(generation) {
		return !blocked && generation === sessionGeneration;
	}
	function getRecord(id) {
		return byId.get(String(id)) || null;
	}
	function replaceRecords(next, settings = {}) {
		const expected = settings.expectedSession ?? sessionGeneration;
		if (!isSessionCurrent(expected) || (settings.expectedRead !== undefined && settings.expectedRead !== readGeneration)) {
			return false;
		}
		if (!Array.isArray(next)) {
			throw new TypeError('Account records must be an array');
		}
		const nextMap = new Map();
		const nextGenerations = new Map();
		const changedIds = [];
		for (const record of next) {
			if (!record || record.id === undefined || nextMap.has(String(record.id))) {
				throw new TypeError('Account IDs must be unique');
			}
			const key = String(record.id);
			const previous = byId.get(key);
			const same = previous && JSON.stringify(previous) === JSON.stringify(record);
			nextMap.set(key, same ? previous : immutable(record));
			nextGenerations.set(key, same ? generations.get(key) : String(++generationSequence));
			if (!same) {
				changedIds.push(record.id);
			}
		}
		const removedIds = records.filter((record) => !nextMap.has(String(record.id))).map((record) => record.id);
		if (settings.invalidateReads) {
			readGeneration += 1;
		}
		byId = nextMap;
		generations = nextGenerations;
		records = Object.freeze([...byId.values()]);
		if (settings.source !== undefined) {
			source = settings.source;
		}
		if (settings.accessVerified !== undefined) {
			accessVerified = Boolean(settings.accessVerified);
		}
		if (settings.hidden !== undefined) {
			hidden = immutable(settings.hidden);
		}
		library = immutable({
			state: settings.reason === 'invalid-data' ? 'error' : 'ready',
			refreshState: settings.source === 'server' ? 'idle' : library.refreshState,
			errorKey: null,
		});
		emit(settings.reason || 'records', changedIds, removedIds);
		return true;
	}
	function matchesCounter(record, snapshot) {
		return Boolean(
			record &&
			String(record.id) === String(snapshot.id) &&
			String(record.type || '').toUpperCase() === 'HOTP' &&
			record.secret === snapshot.secret &&
			(Number(record.digits) || 6) === snapshot.digits &&
			String(record.algorithm || 'SHA1').toUpperCase() === snapshot.algorithm &&
			(record.hotpCounterNamespace || null) === snapshot.hotpCounterNamespace,
		);
	}
	function commitCounter(snapshot, nextCounter) {
		if (!isSessionCurrent(snapshot.sessionGeneration ?? sessionGeneration)) {
			return false;
		}
		const record = getRecord(snapshot.id);
		if (
			!Number.isSafeInteger(nextCounter) ||
			nextCounter < 0 ||
			nextCounter !== snapshot.counter + 1 ||
			!matchesCounter(record, snapshot) ||
			![snapshot.counter, nextCounter].includes(record.counter ?? 0)
		) {
			return false;
		}
		return replaceRecords(
			records.map((entry) => (String(entry.id) === String(snapshot.id) ? { ...entry, counter: nextCounter } : entry)),
			{
				expectedSession: snapshot.sessionGeneration ?? sessionGeneration,
				invalidateReads: true,
				reason: 'counter',
			},
		);
	}
	function getOperationState() {
		const active = [...writes.values()].filter((write) => write.sessionGeneration === sessionGeneration);
		return immutable({
			busy: active.length > 0,
			pendingWrites: active.length,
			operations: [...operations.values()].filter((operation) => operation.sessionGeneration === sessionGeneration),
		});
	}
	function updateOperation(operationId, patch) {
		const previous = operations.get(operationId);
		if (!previous || previous.sessionGeneration !== sessionGeneration) {
			return false;
		}
		const allowed = ['status', 'clipboard', 'reservation', 'localCommit', 'reconciliation', 'counterAdvanced', 'reason', 'recovery'];
		const clean = Object.fromEntries(
			allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]]),
		);
		operations.set(operationId, immutable({ ...previous, ...clean }));
		emit('operation');
		return true;
	}
	function beginWrite(details = {}) {
		const expectedSession = details.sessionGeneration ?? sessionGeneration;
		if (!isSessionCurrent(expectedSession)) {
			return null;
		}
		const operationId = String(sessionGeneration) + ':' + String(++operationSequence);
		const operation = immutable({
			operationId,
			type: details.type || 'write',
			accountId: details.accountId ?? null,
			sessionGeneration,
			status: details.status || 'queued',
		});
		writes.set(operationId, operation);
		operations.set(operationId, operation);
		while (operations.size > 50) {
			const removable = [...operations.keys()].find((id) => !writes.has(id));
			if (!removable) {
				break;
			}
			operations.delete(removable);
		}
		emit('operation');
		return operation;
	}
	function endWrite(handle, patch = {}) {
		if (!handle || !writes.has(handle.operationId)) {
			return;
		}
		writes.delete(handle.operationId);
		updateOperation(handle.operationId, { status: 'settled', ...patch });
	}
	function invalidateSession(settings = {}) {
		const removedIds = records.map((record) => record.id);
		sessionGeneration += 1;
		const invalidatedGeneration = sessionGeneration;
		readGeneration += 1;
		blocked = settings.blocked !== false;
		accessVerified = false;
		source = null;
		library = immutable({ state: 'ready', refreshState: 'idle', errorKey: null });
		records = Object.freeze([]);
		byId = new Map();
		generations = new Map();
		hidden = immutable({ count: 0, records: [] });
		operations.clear();
		emit(settings.reason || 'session', [], removedIds);
		return invalidatedGeneration;
	}
	const api = {
		getRecords: () => records,
		getRecord,
		getSessionGeneration: () => sessionGeneration,
		isSessionCurrent,
		getAccountGeneration: (id) => generations.get(String(id)) ?? null,
		getState: () => immutable({ revision, sessionGeneration, blocked, accessVerified, source, readGeneration, hidden, library }),
		replaceRecords,
		commitCounter,
		invalidateSession,
		getOperationState,
		beginWrite,
		endWrite,
		updateOperation,
		beginRead() {
			readGeneration += 1;
			const generation = readGeneration;
			library = immutable({ ...library, state: source ? 'ready' : 'loading', refreshState: 'refreshing', errorKey: null });
			emit('read-start');
			return generation;
		},
		setReadStatus(patch, settings = {}) {
			if (
				!isSessionCurrent(settings.expectedSession ?? sessionGeneration) ||
				(settings.expectedRead !== undefined && settings.expectedRead !== readGeneration)
			) {
				return false;
			}
			library = immutable({ ...library, ...patch });
			emit('read-status');
			return true;
		},
		getReadGeneration: () => readGeneration,
		isReadCurrent: (generation, session = sessionGeneration) => isSessionCurrent(session) && generation === readGeneration,
		invalidateReads() {
			readGeneration += 1;
			return readGeneration;
		},
		markAccessVerified(expected = sessionGeneration) {
			if (!isSessionCurrent(expected)) {
				return false;
			}
			accessVerified = true;
			emit('access');
			return true;
		},
		setHidden(value, expected = sessionGeneration) {
			if (!isSessionCurrent(expected)) {
				return false;
			}
			hidden = immutable(value);
			emit('hidden');
			return true;
		},
		subscribe(listener, settings = {}) {
			const collection = settings.phase === 'internal' ? internalListeners : listeners;
			collection.add(listener);
			return () => collection.delete(listener);
		},
	};
	if (options.records) {
		replaceRecords(options.records, { reason: 'initial' });
	}
	return Object.freeze(api);
}
