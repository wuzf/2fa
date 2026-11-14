/** Stable data/command interface for trusted same-origin themes; not a sandbox. */
export function createThemeSdk(ports) {
	const { accounts, otp, commands, view, environment = {}, hostFlows } = ports;
	const listeners = new Set();
	const delivered = new WeakMap();
	const notifications = [];
	let notifying = false;
	const targets = new WeakMap();
	let disposed = false;
	let revision = 0;
	const identity = freeze({
		hostBuild: String(ports.identity?.hostBuild || ''),
		sdkApiVersion: 1,
		packageId: ports.identity?.packageId === undefined || ports.identity.packageId === null ? null : String(ports.identity.packageId),
		appearanceRevision: ports.identity?.appearanceRevision ?? null,
		mode: ports.identity?.mode === 'preview' ? 'preview' : 'live',
	});
	function freeze(value) {
		if (value && typeof value === 'object') {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
		return value;
	}
	function pick(source, keys) {
		const result = {};
		for (const key of keys) {
			const value = source?.[key];
			if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
				result[key] = value;
			}
		}
		return result;
	}
	// Version, release and project links for the theme's footer; null on a host without them.
	function about(input) {
		if (!input || typeof input !== 'object' || typeof input.version !== 'string') {
			return null;
		}
		const links = {};
		for (const key of ['documentation', 'feedback', 'source', 'releases', 'author']) {
			const value = input.links?.[key];
			if (typeof value === 'string' && /^https:\/\//.test(value)) {
				links[key] = value;
			}
		}
		return {
			version: input.version,
			latestVersion: typeof input.latestVersion === 'string' ? input.latestVersion : null,
			upToDate: input.upToDate === true,
			author: typeof input.author === 'string' ? input.author : null,
			license: typeof input.license === 'string' ? input.license : null,
			links,
		};
	}
	function operation(input) {
		if (!input) {
			return null;
		}
		return pick(input, [
			'operationId',
			'type',
			'accountId',
			'status',
			'clipboard',
			'reservation',
			'localCommit',
			'reconciliation',
			'counterAdvanced',
			'reason',
			'recovery',
			'canRecover',
		]);
	}
	function projectQueue(input = {}) {
		return {
			...pick(input, ['state', 'authRequired', 'busy', 'unavailable', 'reason']),
			operations: (Array.isArray(input.operations) ? input.operations : []).map((item) => ({
				...pick(item, [
					'operationId',
					'id',
					'type',
					'name',
					'timestamp',
					'status',
					'reason',
					'failureReason',
					'claimed',
					'canRetry',
					'canEdit',
					'canCancel',
				]),
			})),
		};
	}
	function code(record, slot, operationState, online) {
		const value = record?.[slot];
		if (typeof value !== 'string') {
			return null;
		}
		return {
			snapshotId: String(record.revision),
			value,
			...pick(record, ['window', 'counter']),
			...(record.kind === 'TOTP'
				? {
						validFrom: (record.window + (slot === 'next' ? 1 : 0)) * record.period * 1000,
						validUntil: (record.window + (slot === 'next' ? 2 : 1)) * record.period * 1000,
					}
				: {}),
			copyAvailability: record.kind === 'HOTP' && !online ? 'offline' : operationState?.busy && record.kind === 'HOTP' ? 'busy' : 'ready',
		};
	}
	function build() {
		const state = accounts.getState?.() || {};
		const context = environment.getSnapshot?.() || {};
		const records = state.blocked ? [] : accounts.getRecords();
		const selection = view.derive(records);
		const operations = accounts.getOperationState?.() || commands.getOperationState?.() || {};
		const groupById = new Map();
		selection.services.forEach((group) => group.ids.forEach((id) => groupById.set(id, group.groupId)));
		const online = context.connectivity?.onlineHint !== false;
		return freeze({
			snapshotId: String(revision),
			revision,
			epochs: { session: accounts.getSessionGeneration(), data: state.revision || 0, clock: context.clock?.generation || 0 },
			session: {
				state: state.blocked ? context.session?.state || 'logged-out' : state.accessVerified ? 'authenticated' : 'unconfirmed',
				accessVerified: state.accessVerified === true,
			},
			library: {
				state: context.library?.state || state.library?.state || (state.blocked ? 'ready' : state.source ? 'ready' : 'loading'),
				source: state.source === 'server' || state.source === 'local' ? state.source : null,
				refreshState: context.library?.refreshState || state.library?.refreshState || 'idle',
				errorKey: context.library?.errorKey || state.library?.errorKey || null,
				accounts: records.map((item) => {
					const id = String(item.id);
					const accountOperations = (operations.operations || [])
						.filter((entry) => entry.type === 'hotp' && String(entry.accountId) === id)
						.reverse();
					const latestOperation =
						accountOperations.find((entry) => !['settled', 'session-invalidated'].includes(entry.status)) || accountOperations[0];
					const record = otp.readCommitted(id);
					const type = String(item.type || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP';
					return {
						ref: { id, generation: accounts.getAccountGeneration(id) },
						service: {
							label: String(item.name || '').trim() ? item.name : ports.translate?.('transferUnnamed') || 'Untitled',
							groupId: groupById.get(id) || null,
							...(ports.getServiceLogo ? { iconURL: ports.getServiceLogo(item.name) } : {}),
						},
						accountLabel: typeof item.account === 'string' ? item.account : '',
						type,
						digits: Number(item.digits) || 6,
						algorithm: String(item.algorithm || 'SHA1'),
						...(type === 'HOTP' ? { counter: Number(item.counter) || 0 } : { period: Number(item.period) || 30 }),
						...pick(item, ['createdAt']),
						otp: {
							state: record ? 'ready' : 'pending',
							displayRevision: record?.revision || 0,
							current: code(record, 'current', operations, online),
							next: type === 'HOTP' ? null : code(record, 'next', operations, online),
							operation: operation(latestOperation),
						},
						availableActions:
							type === 'HOTP' ? ['copy', 'qr', 'uri', 'link', 'edit', 'delete'] : ['copy', 'next', 'qr', 'uri', 'link', 'edit', 'delete'],
					};
				}),
				view: selection,
				hidden: state.blocked
					? { count: 0, detailsAvailable: false, records: [] }
					: {
							count: Number(state.hidden?.count) || 0,
							detailsAvailable: Array.isArray(state.hidden?.records) && state.hidden.records.length > 0,
							records: (state.hidden?.records || []).map((item) => pick(item, ['id', 'name', 'account', 'reason', 'deletable'])),
						},
			},
			connectivity: { onlineHint: online, serverState: String(context.connectivity?.serverState || 'unknown') },
			clock: pick(context.clock, ['status', 'generation', 'correctedNow']),
			queue: state.blocked ? { operations: [], authRequired: true, busy: false } : projectQueue(context.queue),
			preferences: pick(context.preferences, [
				'language',
				'resolvedLanguage',
				'theme',
				'resolvedTheme',
				'defaultViewMode',
				'otpAnimation',
				'reducedMotion',
				'defaultExportFormat',
				'maxBackups',
			]),
			host: {
				...pick(context.host, [
					'dialogOpen',
					'dirty',
					'saving',
					'installAvailable',
					'updateAvailable',
					'versionMismatch',
					'appearancePublished',
					'offlineReady',
				]),
				about: about(context.host?.about),
				busy: operations.busy === true,
				pendingWrites: operations.pendingWrites || 0,
				operations: (operations.operations || []).map(operation),
			},
		});
	}
	let snapshot = build();
	function publish() {
		if (disposed) {
			return;
		}
		revision += 1;
		snapshot = build();
		notifications.push(snapshot);
		if (notifying) {
			return;
		}
		notifying = true;
		try {
			while (notifications.length && !disposed) {
				const next = notifications.shift();
				for (const listener of [...listeners]) {
					if (!listeners.has(listener) || (delivered.get(listener) ?? -1) >= next.revision) {
						continue;
					}
					delivered.set(listener, next.revision);
					try {
						listener(next);
					} catch (error) {
						ports.onError?.(error);
					}
				}
			}
		} finally {
			notifying = false;
		}
	}
	const unsubscribers = [
		accounts.subscribe?.(publish),
		otp.subscribeCommits?.(publish),
		view.subscribe?.(publish),
		environment.subscribe?.(publish),
		commands.subscribe?.(publish),
	].filter((value) => typeof value === 'function');
	function alive() {
		return !disposed && (!ports.isMountCurrent || ports.isMountCurrent());
	}
	function rejection(reason) {
		return freeze({ status: 'rejected', reason });
	}
	function invoke(call) {
		if (!alive()) {
			return Promise.resolve(rejection('mount-invalidated'));
		}
		const generation = accounts.getSessionGeneration();
		let result;
		try {
			result = call();
		} catch {
			return Promise.resolve(rejection('command-failed'));
		}
		return Promise.resolve(result).then(
			(value) => {
				if (!alive()) {
					return rejection('mount-invalidated');
				}
				if (accounts.getSessionGeneration() !== generation) {
					return rejection('session-invalidated');
				}
				if (!value || typeof value !== 'object') {
					return rejection('invalid-command-result');
				}
				return freeze({
					...pick(value, [
						'status',
						'reason',
						'operationId',
						'clipboard',
						'reservation',
						'localCommit',
						'reconciliation',
						'counterAdvanced',
						'recovery',
					]),
					...(value.feedback
						? { feedback: { key: String(value.feedback.key || ''), params: pick(value.feedback.params, ['count', 'counter']) } }
						: {}),
				});
			},
			() => rejection('command-failed'),
		);
	}
	function validAccount(ref) {
		return ref && typeof ref.id === 'string' && accounts.getRecord(ref.id) && accounts.getAccountGeneration(ref.id) === ref.generation;
	}
	function viewCommand(name, value) {
		return alive() ? view[name](value) : rejection('mount-invalidated');
	}
	const sdk = Object.freeze({
		identity,
		getSnapshot: () => snapshot,
		subscribe(listener) {
			if (typeof listener !== 'function') {
				throw new TypeError('listener');
			}
			if (!alive()) {
				return () => {};
			}
			listeners.add(listener);
			delivered.set(listener, snapshot.revision);
			try {
				listener(snapshot);
			} catch (error) {
				ports.onError?.(error);
			}
			return () => listeners.delete(listener);
		},
		view: Object.freeze({
			setQuery: (value) => viewCommand('setQuery', value),
			setServiceFilter: (value) => viewCommand('setServiceFilter', value),
			setMode: (value) => viewCommand('setMode', value),
			setSort: (value) => viewCommand('setSort', value),
		}),
		clock: Object.freeze({
			now() {
				if (!alive()) {
					return null;
				}
				const now = environment.getClockNow?.();
				return Number.isFinite(now) ? now : null;
			},
		}),
		otp: Object.freeze({
			reconcile(operationId) {
				if (
					typeof operationId !== 'string' ||
					!accounts
						.getOperationState?.()
						.operations?.some((operation) => operation.operationId === operationId && operation.type === 'hotp')
				) {
					return Promise.resolve(rejection('operation-unavailable'));
				}
				return invoke(() =>
					Promise.resolve(commands.recoverOperation(operationId)).then((succeeded) =>
						succeeded ? { status: 'committed' } : rejection('reconciliation-failed'),
					),
				);
			},
			readCopyTarget(id, slot = 'current') {
				if (!alive()) {
					return { status: 'not-ready', reason: 'mount-invalidated' };
				}
				if (typeof id !== 'string' || !['current', 'next'].includes(slot)) {
					return { status: 'not-ready', reason: 'invalid-target' };
				}
				const result = otp.readCopyTarget(id, slot);
				if (result.status !== 'ready') {
					return freeze(pick(result, ['status', 'reason']));
				}
				const external = freeze(
					pick(result.target, [
						'accountId',
						'slot',
						'value',
						'revision',
						'sessionGeneration',
						'accountGeneration',
						'window',
						'clockGeneration',
						'counter',
					]),
				);
				targets.set(external, result.target);
				return freeze({ status: 'ready', target: external });
			},
			copy(target) {
				const internal = target && typeof target === 'object' ? targets.get(target) : null;
				if (!internal) {
					return Promise.resolve(rejection('invalid-target'));
				}
				return invoke(() => commands.copy(internal, { isCurrent: alive }));
			},
		}),
		accounts: Object.freeze({
			refresh: () => invoke(() => commands.refresh()),
			copyURI: (ref) =>
				validAccount(ref)
					? invoke(() => commands.copyURI({ id: ref.id, generation: ref.generation }, { isCurrent: alive }))
					: Promise.resolve(rejection('account-changed')),
			copyShareLink: (ref) =>
				validAccount(ref)
					? invoke(() => commands.copyShareLink({ id: ref.id, generation: ref.generation }, { isCurrent: alive }))
					: Promise.resolve(rejection('account-changed')),
		}),
		host: Object.freeze({
			setAppearance(tokens) {
				if (!alive()) {
					return rejection('mount-invalidated');
				}
				return ports.hostAppearance?.setAppearance(tokens) || rejection('unavailable');
			},
			listActions: () => hostFlows?.listActions() || Object.freeze([]),
			open(request, options) {
				return (
					hostFlows?.open(request, options, { isCurrent: alive }) ||
					Object.freeze({ status: 'rejected', reason: 'host-unavailable', closed: Promise.resolve(rejection('host-unavailable')) })
				);
			},
		}),
		preferences: Object.freeze({
			set: (patch) => invoke(() => environment.setPreferences?.(patch) || rejection('preferences-unavailable')),
		}),
		i18n: Object.freeze({ t: (key, params) => (typeof key === 'string' ? String(ports.translate?.(key, params) ?? key) : '') }),
		lifecycle: Object.freeze({
			requestReload: (reason) =>
				['theme-change', 'update', 'recovery'].includes(reason)
					? invoke(() => environment.requestReload?.(reason) || rejection('reload-unavailable'))
					: Promise.resolve(rejection('invalid-reason')),
		}),
	});
	return Object.freeze({
		sdk,
		publish,
		prepareCopy(target) {
			const internal = target && typeof target === 'object' ? targets.get(target) : null;
			if (!alive() || !internal) {
				return false;
			}
			return ports.finishTransitionForCopy ? ports.finishTransitionForCopy(internal.accountId, internal.slot, internal) === true : true;
		},
		dispose() {
			disposed = true;
			unsubscribers.forEach((unsubscribe) => unsubscribe());
			listeners.clear();
			notifications.length = 0;
			hostFlows?.dispose?.();
			ports.hostAppearance?.dispose();
		},
	});
}
