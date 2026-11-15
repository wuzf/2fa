/** Typed host entry points. Handlers are explicit ports, never arbitrary global calls. */
export function createHostFlows(ports = {}) {
	let disposed = false;
	const active = new Set();
	const tools = ['qr-decode', 'qr-generate', 'base32', 'timestamp', 'key-check', 'key-generate'];
	const providers = ['webdav', 's3', 'onedrive', 'gdrive'];
	// Themes list the actions in this order: the settings follow the settings dialog's tabs.
	const sections = ['security', 'sync', 'preferences', 'custom-code', 'about'];
	const definitions = [
		['account-add', 'fabAddSecret'],
		['account-edit', 'cardMenuEdit', 'account'],
		['account-delete', 'cardMenuDelete', 'account'],
		['account-qr', 'cardMenuQRCode', 'account'],
		['scan-import', 'fabScanQR'],
		['import', 'fabImport'],
		['export', 'fabExport'],
		['backup', 'fabBackup'],
		['tools', 'fabTools'],
		['tool', 'fabTools', 'tool'],
		['settings', 'fabSettings', 'section'],
		['sync-provider', 'settingsTabSync', 'provider'],
		['appearance', 'appearanceTitle'],
		['recovery', 'appearanceSafeMode'],
		['hidden-accounts', 'pageHiddenAccounts'],
		['offline-queue', 'offlineQueueView'],
		['offline-queue-edit', 'offlineQueueEditRetry', 'operationId'],
		['offline-queue-retry', 'retry', 'operationId'],
		['offline-queue-cancel', 'offlineQueueCancelChange', 'operationId'],
		['offline-queue-status-retry', 'restoreRefresh'],
		['extension', 'pageBrowserExtension'],
		['pwa-install', 'pwaInstallBtn'],
		['quick-otp', 'appTitle'],
		// Signing out closes the app actions, like deleting closes an account's menu.
		['login', 'loginSubmitBtn'],
		['logout', 'logoutBtn'],
	];
	const registry = new Map(definitions.map(([kind, labelKey, parameter]) => [kind, { kind, labelKey, parameter }]));
	// Every frozen business-matrix row is assigned an actual interface owner.
	const featureContracts = Object.freeze({
		A01: 'host:login',
		A02: 'accounts:refresh',
		A03: 'snapshot:otp',
		A04: 'otp:copy',
		A05: 'otp:copy',
		A06: 'otp:copy',
		A07: 'otp:copy',
		A08: 'host:account-qr/accounts:copyURI/accounts:copyShareLink/host:account-edit/host:account-delete',
		A09: 'host:account-add/host:account-edit',
		A10: 'host:account-delete',
		L01: 'view:setQuery',
		L02: 'view:setMode/view:setSort',
		L03: 'view:setServiceFilter',
		L04: 'official-view:keyboard',
		G01: 'host:scan-import',
		G02: 'host:account-add',
		G03: 'host:import',
		G04: 'host:export',
		G05: 'host:backup',
		G06: 'host:tools',
		G07: 'host:settings',
		T01: 'host:tool:qr-decode',
		T02: 'host:tool:qr-generate',
		T03: 'host:tool:base32',
		T04: 'host:tool:timestamp',
		T05: 'host:tool:key-check',
		T06: 'host:tool:key-generate',
		S01: 'host:settings:security/host:logout',
		S02: 'preferences:set',
		S03: 'host:settings:preferences',
		S04: 'host:settings:custom-code',
		S05: 'host:appearance/host:recovery',
		S06: 'host:settings:about',
		C01: 'host:sync-provider:webdav',
		C02: 'host:sync-provider:s3',
		C03: 'host:sync-provider:onedrive',
		C04: 'host:sync-provider:gdrive',
		H01: 'host:hidden-accounts',
		Q01: 'host:offline-queue',
		Q02: 'host:offline-queue-retry/host:offline-queue-cancel',
		Q03: 'host:offline-queue-edit',
		P01: 'host:pwa-install/lifecycle:requestReload',
		X01: 'host:extension',
		X02: 'host-route:extension-api',
		U01: 'host:quick-otp',
		I01: 'i18n:t/preferences:set',
		D01: 'host:modal-lifecycle',
	});
	function rejected(reason) {
		return Object.freeze({ status: 'rejected', reason });
	}
	function validate(request) {
		if (!request || typeof request !== 'object' || Array.isArray(request)) {
			return null;
		}
		const entry = registry.get(request.kind);
		if (!entry) {
			return null;
		}
		if (Object.keys(request).some((key) => key !== 'kind' && key !== entry.parameter)) {
			return null;
		}
		const result = { kind: entry.kind };
		if (entry.parameter === 'account') {
			const account = request.account;
			if (!account || typeof account.id !== 'string' || !['string', 'number'].includes(typeof account.generation)) {
				return null;
			}
			result.account = Object.freeze({ id: account.id, generation: account.generation });
		} else if (entry.parameter === 'operationId') {
			if (typeof request.operationId !== 'string' || !request.operationId || request.operationId.length > 256) {
				return null;
			}
			result.operationId = request.operationId;
		} else if (entry.parameter === 'tool') {
			if (!tools.includes(request.tool)) {
				return null;
			}
			result.tool = request.tool;
		} else if (entry.parameter === 'provider') {
			if (!providers.includes(request.provider)) {
				return null;
			}
			result.provider = request.provider;
		} else if (entry.parameter === 'section') {
			if (request.section !== undefined && !sections.includes(request.section)) {
				return null;
			}
			result.section = request.section || 'security';
		}
		return Object.freeze(result);
	}
	function availability(request) {
		if (disposed) {
			return 'mount-invalidated';
		}
		if (typeof ports.handlers?.[request.kind] !== 'function') {
			return 'unavailable';
		}
		if (request.account && ports.validateAccount && !ports.validateAccount(request.account)) {
			return 'account-changed';
		}
		return ports.getBlockedReason?.(request) || null;
	}
	function listActions() {
		const labels = {
			'qr-decode': 'toolQrDecodeTitle',
			'qr-generate': 'toolQrGenTitle',
			base32: 'toolBase32Title',
			timestamp: 'pageTimestampTitle',
			'key-check': 'toolKeyCheckerTitle',
			'key-generate': 'toolKeyGenTitle',
			webdav: 'syncWebdavTitle',
			s3: 'syncS3Title',
			onedrive: 'syncOneDriveTitle',
			gdrive: 'syncGoogleDriveTitle',
			security: 'settingsTabSecurity',
			preferences: 'settingsTabPreferences',
			sync: 'settingsTabSync',
			'custom-code': 'settingsTabCustomCode',
			about: 'settingsTabAbout',
		};
		const actions = definitions.flatMap(([kind, labelKey, parameter]) => {
			const values = parameter === 'tool' ? tools : parameter === 'provider' ? providers : parameter === 'section' ? sections : [null];
			return values.map((value) => {
				const request = { kind, ...(value ? { [parameter]: value } : {}) };
				const reason = availability(request);
				return Object.freeze({
					actionId: kind + (value ? ':' + value : ''),
					labelKey: labels[value] || labelKey,
					request: Object.freeze(request),
					requires: parameter === 'account' || parameter === 'operationId' ? parameter : null,
					enabled: !reason,
					reason,
				});
			});
		});
		// Themes list the settings in this order: About closes them, after the theme settings.
		const about = actions.findIndex((action) => action.actionId === 'settings:about');
		const appearance = actions.findIndex((action) => action.actionId === 'appearance');
		if (about >= 0 && appearance > about) {
			actions.splice(appearance, 0, actions.splice(about, 1)[0]);
		}
		return Object.freeze(actions);
	}
	function open(request, options = {}, guard = {}) {
		const validated = validate(request);
		const immediateError = !validated
			? 'invalid-request'
			: guard.isCurrent && !guard.isCurrent()
				? 'mount-invalidated'
				: availability(validated);
		if (immediateError) {
			return Object.freeze({ ...rejected(immediateError), closed: Promise.resolve(rejected(immediateError)) });
		}
		const generation = ports.getSessionGeneration?.();
		const controller = new AbortController();
		active.add(controller);
		const returnFocus = options.returnFocus || ports.getActiveElement?.();
		const sessionCurrent = () => !disposed && (!guard.isCurrent || guard.isCurrent()) && ports.getSessionGeneration?.() === generation;
		const isCurrent = () => sessionCurrent() && (!validated.account || !ports.validateAccount || ports.validateAccount(validated.account));
		const finish = (value) => {
			if (disposed) {
				return rejected('mount-invalidated');
			}
			if (!sessionCurrent()) {
				const state = ports.getSessionState?.();
				const expectedTransition =
					(!guard.isCurrent || guard.isCurrent()) && typeof generation === 'number' && ports.getSessionGeneration?.() === generation + 1;
				if (expectedTransition && validated.kind === 'login' && value?.status === 'closed' && state?.accessVerified && !state.blocked) {
					return Object.freeze({ status: 'completed', reason: 'authenticated' });
				}
				if (
					!(
						expectedTransition &&
						validated.kind === 'logout' &&
						state?.blocked &&
						['logout-server-confirmed', 'logout-local-only'].includes(value?.reason)
					)
				) {
					return rejected('session-invalidated');
				}
			}
			// A dialog closing proves only that it closed, never that a write succeeded.
			if (
				!value ||
				!['closed', 'cancelled', 'committed', 'queued-offline', 'completed', 'rejected', 'unknown', 'session-invalidated'].includes(
					value.status,
				)
			) {
				return rejected('invalid-flow-result');
			}
			return Object.freeze({ status: value.status, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) });
		};
		let opening;
		try {
			opening = ports.handlers[validated.kind](validated, { returnFocus, isCurrent, signal: controller.signal });
		} catch {
			active.delete(controller);
			return Object.freeze({ ...rejected('flow-failed'), closed: Promise.resolve(rejected('flow-failed')) });
		}
		const closed = Promise.resolve(opening)
			.then((result) => result?.closed || result)
			.then(finish, () => rejected('flow-failed'));
		closed.then(() => {
			active.delete(controller);
			if (sessionCurrent()) {
				ports.restoreFocus?.(returnFocus);
			}
		});
		return Object.freeze({ status: 'opening', closed });
	}
	return Object.freeze({
		listActions,
		open,
		featureContracts,
		dispose() {
			disposed = true;
			active.forEach((controller) => controller.abort());
			active.clear();
		},
	});
}
