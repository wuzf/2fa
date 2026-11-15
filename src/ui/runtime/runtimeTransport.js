/** Browser/SW capability channel. The actual controller object owns every permit. */
export function createRuntimeTransport({
	window,
	navigator,
	MessageChannel: Channel = globalThis.MessageChannel,
	random = () => globalThis.crypto.randomUUID(),
	isReloadBlocked = () => false,
	timers = {},
}) {
	const protocol = '2fa-runtime-v1';
	const listeners = new Set();
	const pending = new Set();
	const permits = new WeakMap();
	const preparations = new Map();
	const protocolWorkers = new WeakSet();
	const setTimer = timers.setTimeout || ((callback, delay) => globalThis.setTimeout(callback, delay));
	const clearTimer = timers.clearTimeout || ((id) => globalThis.clearTimeout(id));
	let generation = 0;
	let permitEpoch = 0;
	let attachmentVersion = 0;
	let disposed = false;
	let state = Object.freeze({ status: 'idle' });
	const controller = () => navigator.serviceWorker?.controller || null;
	const blocked = (reason) => Object.freeze({ status: 'blocked', reason, compatible: false, resourcesReady: false, recoveryReady: false });
	const tupleCopy = (value) =>
		Object.freeze({
			hostBuild: value.hostBuild,
			sdkApiVersion: value.sdkApiVersion,
			packageId: value.packageId,
			appearanceRevision: value.appearanceRevision,
			mode: value.mode,
		});
	const equal = (a, b) =>
		a && b && ['hostBuild', 'sdkApiVersion', 'packageId', 'appearanceRevision', 'mode'].every((key) => a[key] === b[key]);
	function emit(type, reason) {
		const event = Object.freeze({ type, reason, state });
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				/* Observers cannot grant a permit. */
			}
		}
	}
	function invalidate(reason) {
		generation += 1;
		preparations.clear();
		state = blocked(reason);
		for (const finish of [...pending]) {
			finish(
				reason === 'controller-changed' && finish.updateWorker === controller()
					? Object.freeze({ status: 'ready', reason: 'activated' })
					: blocked(reason),
			);
		}
		emit('invalidated', reason);
	}
	function request(
		type,
		tuple,
		{ worker = controller(), timeout = 4000, requireController = true, expectedShellConfigId = window.__2FA_SHELL_CONFIG_ID__ } = {},
		tryCachedAttach = false,
	) {
		if (disposed) {
			return Promise.resolve(blocked('disposed'));
		}
		if (!worker || !controller() || typeof Channel !== 'function') {
			return Promise.resolve(blocked('no-controller'));
		}
		const expectedController = controller();
		const expectedGeneration = generation;
		let expectedTuple;
		try {
			expectedTuple = tuple ? tupleCopy(tuple) : null;
		} catch {
			return Promise.resolve(blocked('invalid-tuple'));
		}
		const preparationKey = JSON.stringify(expectedTuple) + '@' + expectedShellConfigId;
		const prepared = preparations.get(preparationKey);
		if (type !== 'RUNTIME_ACTIVATE' && !/^[a-f0-9]{64}$/.test(expectedShellConfigId || '')) {
			return Promise.resolve(blocked('reload-required'));
		}
		if (['RUNTIME_ATTACH', 'RUNTIME_STARTED'].includes(type) && !prepared && !tryCachedAttach) {
			return Promise.resolve(blocked('not-prepared'));
		}
		const expectedAttachment = type === 'RUNTIME_ATTACH' ? ++attachmentVersion : null;
		return new Promise((resolve) => {
			const channel = new Channel();
			const nonce = random();
			let settled = false;
			const timer = { id: null };
			const finish = (result) => {
				if (settled) {
					return;
				}
				settled = true;
				const superseded = expectedAttachment !== null && expectedAttachment !== attachmentVersion;
				if (superseded) {
					result = blocked('superseded-attach');
				}
				clearTimer(timer.id);
				pending.delete(finish);
				channel.port1.onmessage = null;
				channel.port1.close();
				channel.port2.close();
				if (result.status === 'blocked' && !superseded) {
					state = result;
					if (type === 'RUNTIME_ATTACH') {
						// A lost reply cannot prove whether the worker committed a pin.
						// The previous SDK must stop until a new attach establishes it.
						permitEpoch += 1;
						emit('invalidated', result.reason);
					} else {
						emit('status', result.reason);
					}
				}
				resolve(result);
			};
			pending.add(finish);
			if (type === 'RUNTIME_ACTIVATE') {
				finish.updateWorker = worker;
			}
			timer.id = setTimer(() => finish(blocked('worker-timeout')), timeout);
			channel.port1.onmessage = (event) => {
				const data = event.data;
				if (expectedAttachment !== null && expectedAttachment !== attachmentVersion) {
					return finish(blocked('superseded-attach'));
				}
				if (
					!data ||
					data.protocol !== protocol ||
					data.nonce !== nonce ||
					data.generation !== expectedGeneration ||
					(expectedTuple && !equal(data.tuple, expectedTuple))
				) {
					return;
				}
				if (
					disposed ||
					generation !== expectedGeneration ||
					controller() !== expectedController ||
					(requireController && worker !== controller())
				) {
					return finish(blocked('controller-changed'));
				}
				if (data.status !== 'ready') {
					// Only a correlated reply from the current controller proves that
					// ATTACH did not commit a pin. A timeout or local error is ambiguous.
					if (tryCachedAttach && data.status === 'blocked' && ['not-prepared', 'evicted'].includes(data.reason)) {
						return finish(Object.freeze({ ...blocked(data.reason), status: 'miss' }));
					}
					return finish(blocked(data.reason || 'worker-rejected'));
				}
				// skipWaiting resolves before activation. Reload only after the
				// browser confirms that this exact waiting worker controls the page.
				if (type === 'RUNTIME_ACTIVATE') {
					return;
				}
				if (
					type !== 'RUNTIME_ACTIVATE' &&
					(data.shellConfigId !== expectedShellConfigId || !/^[a-f0-9]{64}$/.test(data.inventoryHash || ''))
				) {
					return finish(blocked('shell-configuration-changed'));
				}
				if (prepared && ['RUNTIME_ATTACH', 'RUNTIME_STARTED'].includes(type) && data.inventoryHash !== prepared) {
					return finish(blocked('inventory-changed'));
				}
				if (type !== 'RUNTIME_ACTIVATE' && (data.compatible !== true || data.resourcesReady !== true || data.recoveryReady !== true)) {
					return finish(blocked('runtime-incomplete'));
				}
				if (type === 'RUNTIME_ATTACH') {
					if (typeof data.permitId !== 'string' || !data.permitId || !/^[a-f0-9]{64}$/.test(data.workerBuild || '')) {
						return finish(blocked('invalid-permit'));
					}
					const permit = Object.freeze({
						tuple: expectedTuple,
						permitId: data.permitId,
						workerBuild: data.workerBuild,
						generation: expectedGeneration,
						shellConfigId: expectedShellConfigId,
						inventoryHash: data.inventoryHash,
					});
					if (tryCachedAttach) {
						// ATTACH itself fully verified this snapshot. Establish its proof
						// before observers can request STARTED with the returned permit.
						preparations.set(preparationKey, data.inventoryHash);
					}
					permits.set(permit, { controller: expectedController, generation: expectedGeneration, epoch: ++permitEpoch });
					state = Object.freeze({ status: 'ready', tuple: expectedTuple, compatible: true, resourcesReady: true, recoveryReady: true });
					emit('ready');
					finish(Object.freeze({ status: 'ready', permit }));
				} else {
					if (type === 'RUNTIME_PREPARE') {
						preparations.set(preparationKey, data.inventoryHash);
					}
					const result = Object.freeze({ ...data, tuple: expectedTuple });
					state = result;
					emit('status');
					finish(result);
				}
			};
			try {
				worker.postMessage(
					{
						protocol,
						type,
						nonce,
						generation: expectedGeneration,
						...(expectedTuple
							? { tuple: expectedTuple, shellConfigId: expectedShellConfigId, ...(prepared ? { inventoryHash: prepared } : {}) }
							: {}),
					},
					[channel.port2],
				);
			} catch {
				finish(blocked('message-failed'));
			}
		});
	}
	const onController = () => invalidate('controller-changed');
	const onHide = () => invalidate('page-hidden');
	const onShow = (event) => {
		if (event.persisted) {
			emit('status', 'page-restored');
		}
	};
	navigator.serviceWorker?.addEventListener('controllerchange', onController);
	window.addEventListener('pagehide', onHide);
	window.addEventListener('pageshow', onShow);
	return Object.freeze({
		prepare: (tuple, options = {}) => request('RUNTIME_PREPARE', tuple, { ...options, timeout: 150000 }),
		attach: (tuple, options = {}) => request('RUNTIME_ATTACH', tuple, options),
		tryAttachCached: (tuple, options = {}) =>
			request('RUNTIME_ATTACH', tuple, { ...options, worker: controller(), requireController: true }, true),
		status: (tuple, options = {}) => request('RUNTIME_STATUS', tuple, options),
		startup: (tuple, options = {}) => request('RUNTIME_STARTED', tuple, options),
		isPermitCurrent(permit) {
			const record = permits.get(permit);
			return (
				!disposed && !!record && record.generation === generation && record.epoch === permitEpoch && record.controller === controller()
			);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getState: () => state,
		// A worker from before this protocol ignores its messages instead of refusing them, so a
		// request to it would only end at its timeout. Only an answer is remembered: a slow start is not proof.
		controllerAnswers({ timeout = 4000 } = {}) {
			const worker = controller();
			if (disposed || !worker || typeof Channel !== 'function') {
				return Promise.resolve(false);
			}
			if (protocolWorkers.has(worker)) {
				return Promise.resolve(true);
			}
			return new Promise((resolve) => {
				const channel = new Channel();
				const nonce = random();
				let timer = null;
				const finish = (answered) => {
					clearTimer(timer);
					channel.port1.onmessage = null;
					channel.port1.close();
					channel.port2.close();
					if (answered) {
						protocolWorkers.add(worker);
					}
					resolve(answered);
				};
				timer = setTimer(() => finish(false), timeout);
				channel.port1.onmessage = (event) => {
					if (event.data?.protocol === protocol && event.data.nonce === nonce) {
						finish(true);
					}
				};
				try {
					worker.postMessage({ type: 'RUNTIME_PROTOCOL_INFO', nonce }, [channel.port2]);
				} catch {
					finish(false);
				}
			});
		},
		async requestUpdate() {
			if (isReloadBlocked()) {
				return blocked('unsaved-or-pending');
			}
			const registration = await navigator.serviceWorker?.getRegistration();
			if (isReloadBlocked()) {
				return blocked('unsaved-or-pending');
			}
			if (!registration?.waiting) {
				return blocked('no-waiting-worker');
			}
			return request('RUNTIME_ACTIVATE', null, { worker: registration.waiting, requireController: false, timeout: 150000 });
		},
		invalidate,
		dispose() {
			if (disposed) {
				return;
			}
			invalidate('disposed');
			disposed = true;
			listeners.clear();
			navigator.serviceWorker?.removeEventListener('controllerchange', onController);
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener('pageshow', onShow);
		},
	});
}
