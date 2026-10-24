/** Account commands own side-effect ordering; injected ports keep them independent of account DOM. */
export function createAccountCommands(ports) {
	const accounts = ports.accounts;
	const operations = new Map();
	const locks = new Map();
	accounts.subscribe(
		() => {
			for (const operation of operations.values()) {
				if (!accounts.isSessionCurrent(operation.session)) {
					operation.finish?.();
					operations.delete(operation.handle.operationId);
				}
			}
		},
		{ phase: 'internal' },
	);
	function outcome(value) {
		return Object.freeze({ ...value });
	}
	function notStarted(reason) {
		return outcome({
			status: 'not-started',
			reason,
			clipboard: 'not-attempted',
			reservation: 'not-attempted',
			localCommit: 'not-attempted',
			reconciliation: 'not-needed',
			counterAdvanced: false,
		});
	}
	function captureGuard(options = {}) {
		const current = options?.isCurrent;
		return Object.freeze({
			isCurrent: () => {
				try {
					return typeof current !== 'function' || current() !== false;
				} catch {
					return false;
				}
			},
		});
	}
	function report(result, session, error = null, guard = null) {
		if (accounts.isSessionCurrent(session) && (!guard || guard.isCurrent())) {
			try {
				ports.feedback?.(result, error);
			} catch {
				/* Presentation never changes the transaction. */
			}
		}
		return result;
	}
	function startClipboard(value, session, guard = null) {
		try {
			return Promise.resolve(
				ports.clipboard.writeText(value, { isCurrent: () => accounts.isSessionCurrent(session) && (!guard || guard.isCurrent()) }),
			).then((result) => result !== false);
		} catch (error) {
			return Promise.reject(error);
		}
	}
	function generationSnapshot(record, sessionGeneration) {
		const counter = record?.counter ?? 0;
		if (!record || !Number.isSafeInteger(counter) || counter < 0 || !Number.isSafeInteger(counter + 1)) {
			return null;
		}
		return {
			id: record.id,
			secret: record.secret,
			digits: Number(record.digits) || 6,
			algorithm: String(record.algorithm || 'SHA1').toUpperCase(),
			hotpCounterNamespace: record.hotpCounterNamespace || null,
			counter,
			nextCounter: counter + 1,
			sessionGeneration,
		};
	}
	function matchingReservation(record, snapshot) {
		return Boolean(
			record &&
			String(record.id) === String(snapshot.id) &&
			String(record.type || '').toUpperCase() === 'HOTP' &&
			record.secret === snapshot.secret &&
			(Number(record.digits) || 6) === snapshot.digits &&
			String(record.algorithm || 'SHA1').toUpperCase() === snapshot.algorithm &&
			(record.hotpCounterNamespace || null) === snapshot.hotpCounterNamespace &&
			record.counter === snapshot.nextCounter,
		);
	}
	function publish(operation, patch) {
		Object.assign(operation.facts, patch);
		if (operation.settled && operation.facts.reservation === 'confirmed' && operation.facts.localCommit === 'committed') {
			operation.facts.recovery = operation.facts.clipboard === 'copied' ? 'none' : 'counter-advanced-copy-failed';
		}
		accounts.updateOperation(operation.handle.operationId, operation.facts);
	}
	async function reconcileOperation(operation) {
		if (!accounts.isSessionCurrent(operation.session)) {
			return false;
		}
		if (operation.reconciling) {
			return operation.reconciling;
		}
		publish(operation, { reconciliation: 'running' });
		operation.reconciling = Promise.resolve()
			.then(() =>
				ports.reconcile?.({
					operationId: operation.handle.operationId,
					accountId: operation.accountId,
					sessionGeneration: operation.session,
				}),
			)
			.then(
				(result) => {
					if (!accounts.isSessionCurrent(operation.session)) {
						return false;
					}
					const succeeded = result === true;
					publish(operation, {
						reconciliation: succeeded ? 'succeeded' : 'failed',
						recovery: operation.facts.clipboard === 'pending' ? 'reload-required' : succeeded ? 'reconciled' : 'retry-reconcile',
					});
					return succeeded;
				},
				() => {
					if (accounts.isSessionCurrent(operation.session)) {
						publish(operation, { reconciliation: 'failed', recovery: 'retry-reconcile' });
					}
					return false;
				},
			)
			.finally(() => {
				operation.reconciling = null;
			});
		return operation.reconciling;
	}
	function copy(target, options = {}) {
		const guard = captureGuard(options);
		if (!guard.isCurrent()) {
			return Promise.resolve(notStarted('mount-invalidated'));
		}
		const id = target?.accountId ?? target?.id;
		const session = accounts.getSessionGeneration();
		const key = session + ':' + String(id);
		const existing = locks.get(key);
		// An already-running transaction wins over a later queued write or a now-stale OTP target.
		if (existing) {
			if (!existing.generations.has(accounts.getAccountGeneration(id))) {
				return Promise.resolve(report(notStarted('operation-pending-account-changed'), session, null, guard));
			}
			if (target !== existing.target && ports.otp.validateCopyTarget(target)?.status !== 'ready') {
				return Promise.resolve(notStarted('stale-target'));
			}
			return existing.promise;
		}
		if (!accounts.isSessionCurrent(session)) {
			return Promise.resolve(notStarted('session-invalidated'));
		}
		const validation = ports.otp.validateCopyTarget(target);
		if (validation?.status !== 'ready') {
			return Promise.resolve(report(notStarted(validation?.reason || 'stale-target'), session, null, guard));
		}
		const trusted = validation.target;
		const accountId = trusted.accountId ?? trusted.id;
		const record = accounts.getRecord(accountId);
		if (!record) {
			return Promise.resolve(notStarted('account-missing'));
		}
		if (String(record.type || '').toUpperCase() !== 'HOTP') {
			return startClipboard(trusted.value, session, guard).then(
				(copied) =>
					report(
						outcome({
							status: accounts.isSessionCurrent(session) ? 'settled' : 'session-invalidated',
							clipboard: copied ? 'copied' : 'failed',
							reservation: 'not-attempted',
							localCommit: 'not-attempted',
							reconciliation: 'not-needed',
							counterAdvanced: false,
							reason: copied ? undefined : 'clipboard-failed',
						}),
						session,
						null,
						guard,
					),
				() =>
					report(
						outcome({
							status: accounts.isSessionCurrent(session) ? 'settled' : 'session-invalidated',
							clipboard: 'failed',
							reservation: 'not-attempted',
							localCommit: 'not-attempted',
							reconciliation: 'not-needed',
							counterAdvanced: false,
							reason: 'clipboard-failed',
						}),
						session,
						null,
						guard,
					),
			);
		}
		if (trusted.slot !== 'current') {
			return Promise.resolve(report(notStarted('unsupported-slot'), session, null, guard));
		}
		if (accounts.getOperationState().busy) {
			return Promise.resolve(report(notStarted('write-busy-reclick'), session, null, guard));
		}
		const snapshot = generationSnapshot(record, session);
		if (!snapshot) {
			return Promise.resolve(report(notStarted('counter-limit'), session, null, guard));
		}
		if (ports.online?.() === false) {
			return Promise.resolve(report(notStarted('offline'), session, null, guard));
		}
		const handle = accounts.beginWrite({ type: 'hotp', accountId, sessionGeneration: session, status: 'running' });
		if (!handle) {
			return Promise.resolve(notStarted('session-invalidated'));
		}
		if (!accounts.isSessionCurrent(session) || !guard.isCurrent()) {
			accounts.endWrite(handle);
			return Promise.resolve(notStarted(accounts.isSessionCurrent(session) ? 'mount-invalidated' : 'session-invalidated'));
		}
		let resolveOperation;
		const operation = {
			handle,
			accountId,
			target: trusted,
			guard,
			session,
			reconciling: null,
			generations: new Set([accounts.getAccountGeneration(accountId)]),
			facts: {
				status: 'running',
				clipboard: 'pending',
				reservation: 'pending',
				localCommit: 'not-attempted',
				reconciliation: 'not-needed',
				counterAdvanced: 'unknown',
				recovery: 'wait',
			},
			promise: new Promise((resolve) => {
				resolveOperation = resolve;
			}),
		};
		operation.finish = () => {
			if (operation.settled) {
				return;
			}
			operation.settled = true;
			const current = accounts.isSessionCurrent(session);
			operation.facts.status = current ? (operation.notStartedReason ? 'not-started' : 'settled') : 'session-invalidated';
			if (current && operation.facts.reservation === 'confirmed' && operation.facts.localCommit === 'committed') {
				operation.facts.recovery = operation.facts.clipboard === 'copied' ? 'none' : 'counter-advanced-copy-failed';
			}
			const result = outcome({
				operationId: handle.operationId,
				...operation.facts,
				status: operation.facts.status,
				recovery: current ? operation.facts.recovery : 'session-ended',
			});
			accounts.endWrite(handle, result);
			if (locks.get(key) === operation) {
				locks.delete(key);
			}
			while (operations.size > 50) {
				const old = [...operations.values()].find((item) => item.settled);
				if (!old) {
					break;
				}
				operations.delete(old.handle.operationId);
			}
			resolveOperation(report(result, session, operation.error, operation.guard));
		};
		locks.set(key, operation);
		operations.set(handle.operationId, operation);
		ports.onOperationStart?.(operation.promise, handle);
		publish(operation, {});
		accounts.invalidateReads();
		if (!accounts.isSessionCurrent(session) || !guard.isCurrent()) {
			operation.notStartedReason = accounts.isSessionCurrent(session) ? 'mount-invalidated' : 'session-invalidated';
			publish(operation, {
				clipboard: 'not-attempted',
				reservation: 'not-attempted',
				counterAdvanced: false,
				reason: operation.notStartedReason,
			});
			operation.finish();
			return operation.promise;
		}
		// Both native side effects are initiated before the first await and after synchronous admission/locking.
		const clipboard = startClipboard(trusted.value, session, operation.guard).then(
			(copied) => {
				publish(operation, { clipboard: copied ? 'copied' : 'failed' });
			},
			() => {
				publish(operation, { clipboard: 'failed' });
			},
		);
		let reservationRequest;
		try {
			reservationRequest = ports.reserveCounter(snapshot);
		} catch (error) {
			reservationRequest = Promise.reject(error);
		}
		const reservation = Promise.resolve(reservationRequest).then(
			async (reserved) => {
				if (!accounts.isSessionCurrent(session)) {
					publish(operation, {
						reservation: matchingReservation(reserved, snapshot) ? 'confirmed' : 'unknown',
						counterAdvanced: matchingReservation(reserved, snapshot) ? true : 'unknown',
						localCommit: 'suppressed',
					});
					return;
				}
				if (!matchingReservation(reserved, snapshot)) {
					publish(operation, { reservation: 'unknown', reason: 'invalid-response', recovery: 'reconcile' });
					await reconcileOperation(operation);
					return;
				}
				// The server fact and local counter are published even while clipboard remains pending.
				publish(operation, { reservation: 'confirmed', counterAdvanced: true, recovery: 'wait-clipboard-or-reconcile' });
				if (accounts.commitCounter(snapshot, snapshot.nextCounter)) {
					operation.generations.add(accounts.getAccountGeneration(accountId));
					publish(operation, { localCommit: 'committed' });
					try {
						await ports.afterCounterCommit?.(snapshot);
					} catch {
						publish(operation, { reason: 'local-refresh-failed', recovery: 'reconcile' });
					}
				} else {
					publish(operation, { localCommit: 'failed', reason: 'account-changed', recovery: 'reconcile' });
					await reconcileOperation(operation);
				}
			},
			async (error) => {
				if (!accounts.isSessionCurrent(session)) {
					return;
				}
				operation.error = error;
				publish(operation, {
					reservation: error?.reservationRejected === true ? 'rejected' : 'unknown',
					reason: error?.reservationRejected === true ? 'reservation-rejected' : 'transport-unknown',
					recovery: 'reconcile',
				});
				await reconcileOperation(operation);
			},
		);
		Promise.all([clipboard, reservation]).then(operation.finish);
		return operation.promise;
	}
	function copySlot(id, slot) {
		const existing = locks.get(accounts.getSessionGeneration() + ':' + String(id));
		if (existing) {
			return existing.generations.has(accounts.getAccountGeneration(id))
				? existing.promise
				: Promise.resolve(report(notStarted('operation-pending-account-changed'), accounts.getSessionGeneration()));
		}
		const result = ports.otp.readCopyTarget(id, slot);
		return result?.status === 'ready'
			? copy(result.target)
			: Promise.resolve(report(notStarted(result?.reason || 'not-ready'), accounts.getSessionGeneration()));
	}
	function copyExported(accountRef, kind, options = {}) {
		const guard = captureGuard(options);
		if (!guard.isCurrent()) {
			return Promise.resolve(notStarted('mount-invalidated'));
		}
		const session = accounts.getSessionGeneration();
		const id = accountRef?.id ?? accountRef?.accountId ?? accountRef;
		if (!accounts.isSessionCurrent(session)) {
			return Promise.resolve(notStarted('session-invalidated'));
		}
		const record = accounts.getRecord(id);
		if (!record || (accountRef?.generation !== undefined && accountRef.generation !== accounts.getAccountGeneration(id))) {
			return Promise.resolve(notStarted('account-changed'));
		}
		const type = String(record.type || 'TOTP').toUpperCase();
		const service = String(record.name || '').trim() || ports.unnamedLabel?.() || 'Unnamed';
		const account = String(record.account || '').trim();
		let url;
		if (kind === 'uri') {
			const label = encodeURIComponent(service) + (account ? ':' + encodeURIComponent(account) : '');
			const params = new URLSearchParams({
				secret: record.secret.toUpperCase(),
				issuer: service,
				algorithm: record.algorithm || 'SHA1',
				digits: String(record.digits || 6),
			});
			params.set(type === 'HOTP' ? 'counter' : 'period', String(type === 'HOTP' ? (record.counter ?? 0) : record.period || 30));
			url = 'otpauth://' + (type === 'HOTP' ? 'hotp' : 'totp') + '/' + label + '?' + params;
		} else {
			url = new URL('/otp/' + encodeURIComponent(record.secret.toUpperCase()), ports.origin());
			if (type === 'HOTP') {
				url.searchParams.set('type', 'HOTP');
				url.searchParams.set('counter', String(record.counter ?? 0));
			} else if ((Number(record.period) || 30) !== 30) {
				url.searchParams.set('period', String(record.period));
			}
			if ((Number(record.digits) || 6) !== 6) {
				url.searchParams.set('digits', String(record.digits));
			}
			if (String(record.algorithm || 'SHA1').toUpperCase() !== 'SHA1') {
				url.searchParams.set('algorithm', String(record.algorithm).toUpperCase());
			}
			url = url.toString();
		}
		return startClipboard(url, session, guard).then(
			(copied) =>
				outcome({
					status: accounts.isSessionCurrent(session) ? 'settled' : 'session-invalidated',
					clipboard: copied ? 'copied' : 'failed',
					reason: copied ? undefined : 'clipboard-failed',
				}),
			() =>
				outcome({
					status: accounts.isSessionCurrent(session) ? 'settled' : 'session-invalidated',
					clipboard: 'failed',
					reason: 'clipboard-failed',
				}),
		);
	}
	return Object.freeze({
		copy,
		copyCurrent: (id) => copySlot(id, 'current'),
		copyNext: (id) => copySlot(id, 'next'),
		copyURI: (ref, guard) => copyExported(ref, 'uri', guard),
		copyShareLink: (ref, guard) => copyExported(ref, 'link', guard),
		async refresh() {
			const session = accounts.getSessionGeneration();
			if (!accounts.isSessionCurrent(session)) {
				return outcome({ status: 'session-invalidated' });
			}
			try {
				const loaded = await ports.refresh?.();
				return outcome({
					status: !accounts.isSessionCurrent(session) ? 'session-invalidated' : loaded === true ? 'loaded' : 'rejected',
					reason: loaded === true ? undefined : 'read-unavailable',
				});
			} catch {
				return outcome({ status: accounts.isSessionCurrent(session) ? 'rejected' : 'session-invalidated', reason: 'read-failed' });
			}
		},
		getOperationState: accounts.getOperationState,
		subscribe: accounts.subscribe,
		canReloadAfterReconcile() {
			if (!accounts.isSessionCurrent(accounts.getSessionGeneration())) {
				return false;
			}
			const state = accounts.getOperationState();
			const eligible = state.operations.filter(
				(operation) =>
					operation.type === 'hotp' &&
					operation.status === 'running' &&
					operation.clipboard === 'pending' &&
					['confirmed', 'rejected', 'unknown'].includes(operation.reservation) &&
					operation.reconciliation === 'succeeded' &&
					operation.recovery === 'reload-required',
			);
			return eligible.length > 0 && state.pendingWrites === eligible.length;
		},
		recoverOperation(operationId) {
			const operation = operations.get(operationId);
			return operation ? reconcileOperation(operation) : Promise.resolve(false);
		},
	});
}
