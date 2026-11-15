import { serializeBrowserFunction } from './browserSource.js';
import { normalizeHostAppearance } from '../runtime/hostAppearance.js';

/** Synthetic presentation only. It never receives seeds, credentials or host business ports. */
export function createAppPreviewMockSdk({ config, call, report, now = Date.now, normalizeAppearance = normalizeHostAppearance }) {
	let active = true,
		revision = 0,
		hostAppearance = null;
	const listeners = new Set(),
		targets = new WeakSet();
	let query = '',
		serviceFilter = null,
		mode = 'grouped';
	let preferences = {
		language: config.language || 'en',
		resolvedLanguage: config.language || 'en',
		theme: config.mode || 'light',
		resolvedTheme: config.mode || 'light',
		otpAnimation: 'none',
		reducedMotion: true,
	};
	const records = [
		{ id: 'preview-mail', name: 'Example Mail', account: 'demo@example.invalid', type: 'TOTP', code: '123456', next: '654321' },
		{ id: 'preview-code', name: 'Example Code', account: 'synthetic-account', type: 'TOTP', code: '789012', next: '210987' },
		{ id: 'preview-hotp', name: 'Example Counter', account: 'demo only', type: 'HOTP', code: '456789', counter: 4 },
	];
	function freeze(value) {
		if (value && typeof value === 'object') {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
		return value;
	}
	function snapshot() {
		const time = now(),
			windowId = Math.floor(time / 30000);
		const selected = config.scene === 'empty' || config.scene === 'login' ? [] : records;
		const accounts = selected.map((record) => ({
			ref: { id: record.id, generation: 'preview' },
			service: { label: record.name, groupId: record.id },
			accountLabel: record.account,
			type: record.type,
			digits: 6,
			algorithm: 'SHA1',
			period: 30,
			...(record.type === 'HOTP' ? { counter: record.counter } : {}),
			otp: {
				state: 'ready',
				displayRevision: revision,
				current: {
					value: record.code,
					snapshotId: String(revision),
					validFrom: windowId * 30000,
					validUntil: (windowId + 1) * 30000,
					copyAvailability: 'ready',
				},
				next: record.next
					? {
							value: record.next,
							snapshotId: String(revision),
							validFrom: (windowId + 1) * 30000,
							validUntil: (windowId + 2) * 30000,
							copyAvailability: 'ready',
						}
					: null,
				operation: null,
			},
			availableActions: ['copy', 'qr', 'uri', 'link', 'edit', 'delete'],
		}));
		const visible = accounts.filter(
			(item) =>
				(!serviceFilter || item.ref.id === serviceFilter) && (item.service.label + ' ' + item.accountLabel).toLowerCase().includes(query),
		);
		const services = accounts.map((item) => ({ groupId: item.ref.id, label: item.service.label, count: 1, ids: [item.ref.id] }));
		return freeze({
			snapshotId: String(revision),
			revision,
			epochs: { session: 0, data: revision, clock: 0 },
			session: { state: config.scene === 'login' ? 'logged-out' : 'authenticated', accessVerified: config.scene !== 'login' },
			library: {
				state: 'ready',
				source: config.scene === 'offline' ? 'local' : 'server',
				refreshState: 'idle',
				errorKey: null,
				accounts,
				hidden: { count: 0, records: [], detailsAvailable: false },
				view: {
					query,
					serviceFilter,
					mode,
					revision,
					groupSort: 'name-asc',
					flatSort: 'oldest-first',
					groupedItemSort: 'oldest-first',
					resultIds: visible.map((item) => item.ref.id),
					found: visible.length,
					queryFound: visible.length,
					total: accounts.length,
					services,
					groups: services
						.filter((group) => visible.some((item) => item.ref.id === group.groupId))
						.map((group) => ({ ...group, matchedCount: 1, totalCount: 1 })),
				},
			},
			connectivity: { onlineHint: config.scene !== 'offline', serverState: 'preview' },
			clock: { status: 'ready', correctedNow: time, generation: 0 },
			queue: {
				operations:
					config.scene === 'offline'
						? [
								{
									id: 'preview-queued',
									operationId: 'preview-queued',
									type: 'UPDATE',
									name: 'Example Mail',
									status: 'pending',
									timestamp: time,
								},
							]
						: [],
				busy: false,
				authRequired: false,
			},
			preferences,
			host: {
				dialogOpen: false,
				dirty: false,
				saving: false,
				busy: false,
				pendingWrites: 0,
				operations: [],
				// Sample data: the preview shows where the theme puts the version and links.
				about: {
					version: '1.0.0',
					latestVersion: null,
					upToDate: true,
					author: 'wuzf',
					license: 'MIT',
					links: {
						documentation: 'https://github.com/wuzf/2fa/blob/main/README.md',
						feedback: 'https://github.com/wuzf/2fa/issues',
						source: 'https://github.com/wuzf/2fa',
						releases: 'https://github.com/wuzf/2fa/releases/latest',
						author: 'https://github.com/wuzf',
					},
				},
			},
		});
	}
	let current = snapshot();
	function publish() {
		if (!active) {
			return;
		}
		revision++;
		current = snapshot();
		listeners.forEach((listener) => listener(current));
	}
	const reject = () => ({ status: 'rejected', reason: 'preview-expired' });
	function command(name, args) {
		return active ? call(name, args) : Promise.resolve(reject());
	}
	// Same order as the host's actions: signing in or out comes last.
	const kinds = [
		'account-add',
		'account-edit',
		'account-delete',
		'account-qr',
		'scan-import',
		'import',
		'export',
		'backup',
		'tools',
		'settings',
		'appearance',
		'recovery',
		'hidden-accounts',
		'offline-queue',
		'extension',
		'pwa-install',
		'quick-otp',
		'login',
		'logout',
	];
	return {
		sdk: freeze({
			identity: {
				hostBuild: 'preview',
				sdkApiVersion: 1,
				packageId: config.appearance.packageId,
				appearanceRevision: null,
				mode: 'preview',
			},
			getSnapshot: () => current,
			subscribe(listener) {
				if (!active) {
					return () => {};
				}
				listeners.add(listener);
				listener(current);
				return () => listeners.delete(listener);
			},
			clock: { now: () => (active ? current.clock.correctedNow : null) },
			view: {
				setQuery(value) {
					if (!active || typeof value !== 'string') {
						return reject();
					}
					query = value.trim().toLowerCase();
					publish();
					return { status: 'committed' };
				},
				setServiceFilter(value) {
					if (!active) {
						return reject();
					}
					serviceFilter = value;
					publish();
					return { status: 'committed' };
				},
				setMode(value) {
					if (!active || !['flat', 'grouped'].includes(value)) {
						return reject();
					}
					mode = value;
					publish();
					return { status: 'committed' };
				},
				setSort() {
					return active ? { status: 'committed' } : reject();
				},
			},
			otp: {
				readCopyTarget(id, slot = 'current') {
					const item = records.find((record) => record.id === id);
					if (!active || !item || (slot === 'next' && !item.next)) {
						return { status: 'not-ready', reason: 'preview-target' };
					}
					const target = freeze({ accountId: id, slot, value: slot === 'next' ? item.next : item.code });
					targets.add(target);
					return { status: 'ready', target };
				},
				async copy(target) {
					if (!targets.has(target)) {
						return { status: 'rejected', reason: 'invalid-target' };
					}
					const result = await command('otp.copy', { id: target.accountId, slot: target.slot });
					if (active && result.status === 'completed') {
						const item = records.find((record) => record.id === target.accountId);
						if (item.type === 'HOTP') {
							item.counter++;
						}
						publish();
						return {
							status: 'settled',
							clipboard: 'copied',
							reservation: item.type === 'HOTP' ? 'confirmed' : 'not-attempted',
							localCommit: 'committed',
							preview: true,
						};
					}
					return result;
				},
				reconcile: (id) => command('otp.reconcile', { id }),
			},
			accounts: {
				refresh: () => command('accounts.refresh'),
				copyURI: (ref) => command('accounts.uri', { id: ref.id }),
				copyShareLink: (ref) => command('accounts.link', { id: ref.id }),
			},
			host: {
				setAppearance(input) {
					if (!active) {
						return { status: 'rejected', reason: 'mount-invalidated' };
					}
					try {
						hostAppearance = freeze(normalizeAppearance(input));
					} catch {
						return { status: 'rejected', reason: 'invalid-appearance' };
					}
					return { status: 'completed' };
				},
				listActions: () =>
					kinds.map((kind) => ({
						actionId: kind,
						labelKey: kind,
						request: { kind },
						requires: kind.startsWith('account-') && kind !== 'account-add' ? 'account' : null,
						enabled: active,
						reason: null,
					})),
				open(request) {
					const closed = command('host.open', { kind: request?.kind, id: request?.account?.id });
					return { status: active ? 'opening' : 'rejected', closed };
				},
			},
			preferences: {
				async set(patch) {
					const result = await command('preferences.set');
					if (active) {
						preferences = { ...preferences, ...patch };
						publish();
					}
					return result;
				},
			},
			i18n: {
				t: (key) =>
					({
						cardMenuEdit: 'Edit',
						cardMenuDelete: 'Delete',
						cardMenuQRCode: 'QR code',
						fabAddSecret: 'Add account',
						fabSettings: 'Settings',
						fabImport: 'Import',
						fabExport: 'Export',
					})[key] || String(key),
			},
			lifecycle: { requestReload: (reason) => command('lifecycle.reload', { reason }) },
		}),
		getHostAppearance: () => hostAppearance,
		update(next) {
			if (!active) {
				return;
			}
			config = next;
			preferences = {
				...preferences,
				language: next.language || 'en',
				resolvedLanguage: next.language || 'en',
				theme: next.mode || 'light',
				resolvedTheme: next.mode || 'light',
			};
			publish();
		},
		dispose() {
			active = false;
			hostAppearance = null;
			listeners.clear();
			report?.({ type: 'disposed' });
		},
	};
}

/** Runs only inside an opaque sandbox and receives the pure mock factory. */
export function appThemePreviewFrame(config, createMock) {
	let connected = false,
		port,
		current = config,
		module,
		mountScope,
		expiryTimer,
		sequence = 0,
		active = true,
		updates = Promise.resolve();
	const pending = new Map();
	const same = (data) => active && data?.nonce === config.nonce && data?.session === config.session;
	const send = (value) => port?.postMessage({ ...value, nonce: config.nonce, session: config.session });
	const report = (value) => send({ type: 'report', value });
	function call(command, args) {
		return new Promise((resolve) => {
			if (!active) {
				resolve({ status: 'rejected', reason: 'preview-expired' });
				return;
			}
			const seq = ++sequence;
			const timer = setTimeout(() => {
				pending.delete(seq);
				resolve({ status: 'rejected', reason: 'preview-command-timeout' });
			}, 5000);
			pending.set(seq, (value) => {
				clearTimeout(timer);
				resolve(value);
			});
			send({ type: 'command', seq, command, args });
		});
	}
	function stop() {
		if (!active) {
			return;
		}
		active = false;
		clearTimeout(expiryTimer);
		releaseMount();
		pending.forEach((resolve) => resolve({ status: 'rejected', reason: 'preview-expired' }));
		pending.clear();
		port?.close();
	}
	function cleanup(instance) {
		try {
			Promise.resolve(instance?.unmount?.()).catch(() => {});
		} catch {
			/* preview is ending */
		}
	}
	function releaseMount() {
		const scope = mountScope;
		mountScope = null;
		if (!scope) {
			return;
		}
		scope.controller.abort();
		scope.mock.dispose();
		cleanup(scope.instance);
		scope.root.remove();
	}
	async function mountCurrent() {
		releaseMount();
		const scope = {
			controller: new AbortController(),
			mock: createMock({ config: current, call, report }),
			root: document.createElement('div'),
			instance: null,
		};
		mountScope = scope;
		document.getElementById('app').append(scope.root);
		const mounted = await module.mount({
			root: scope.root,
			sdk: scope.mock.sdk,
			appearance: freeze(current.appearance),
			signal: scope.controller.signal,
		});
		const instance = typeof mounted === 'function' ? { unmount: mounted } : mounted || {};
		if (!active || mountScope !== scope) {
			cleanup(instance);
			return false;
		}
		scope.instance = instance;
		return true;
	}
	async function imageFailures() {
		await document.fonts?.ready;
		// Optional logo/background placeholders have no request to complete.
		// Hidden images with a configured source still participate in readiness.
		const hasSource = (image) => Boolean(image.currentSrc || image.getAttribute('src')?.trim() || image.getAttribute('srcset')?.trim());
		const images = Array.from(document.images).filter(hasSource);
		await Promise.all(
			images.map((image) =>
				image.complete
					? Promise.resolve()
					: new Promise((resolve) => {
							image.addEventListener('load', resolve, { once: true });
							image.addEventListener('error', resolve, { once: true });
						}),
			),
		);
		return images.filter((image) => image.isConnected && hasSource(image) && !image.naturalWidth).length;
	}
	function preferences() {
		document.documentElement.dataset.theme = current.mode || 'light';
		document.documentElement.lang = current.language || 'en';
	}
	function freeze(value) {
		if (value && typeof value === 'object') {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
		return value;
	}
	async function receive({ data }) {
		if (!same(data)) {
			return;
		}
		if (data.type === 'response') {
			const resolve = pending.get(data.seq);
			pending.delete(data.seq);
			resolve?.(data.result);
		}
		if (data.type === 'dispose') {
			stop();
		}
		if (data.type === 'update' && module) {
			updates = updates.then(async () => {
				if (!active) {
					return;
				}
				try {
					current = { ...current, ...data.value };
					freeze(current.appearance);
					preferences();
					if (typeof mountScope?.instance?.update === 'function') {
						mountScope.mock.update(current);
						await mountScope.instance.update(current.appearance);
					} else if (!(await mountCurrent())) {
						return;
					}
					const failures = await imageFailures();
					if (active) {
						report({ type: 'updated', version: data.version, imageFailures: failures });
					}
				} catch (error) {
					report({ type: 'error', reason: String(error.message || error) });
				}
			});
		}
	}
	window.addEventListener('message', async (event) => {
		if (
			connected ||
			event.source !== window.parent ||
			event.origin !== config.parentOrigin ||
			!same(event.data) ||
			event.data.type !== 'preview-connect' ||
			event.ports.length !== 1
		) {
			return;
		}
		connected = true;
		port = event.ports[0];
		port.onmessage = receive;
		port.start();
		expiryTimer = setTimeout(stop, Math.max(0, config.expiresAt - Date.now()));
		try {
			preferences();
			await Promise.all(
				config.styles.map(
					(url) =>
						new Promise((resolve, reject) => {
							const link = document.createElement('link');
							link.rel = 'stylesheet';
							link.crossOrigin = 'anonymous';
							link.href = url;
							link.onload = resolve;
							link.onerror = () => reject(new Error('preview-style-failed'));
							document.head.append(link);
						}),
				),
			);
			if (!active) {
				return;
			}
			module = await import(config.entryUrl);
			if (!active) {
				return;
			}
			if (typeof module.mount !== 'function') {
				throw new Error('preview-mount-unavailable');
			}
			if (!(await mountCurrent())) {
				return;
			}
			const failures = await imageFailures();
			if (active) {
				report({
					type: 'ready',
					imageFailures: failures,
					origin: window.origin,
				});
			}
		} catch (error) {
			if (active) {
				report({ type: 'error', reason: String(error.message || error) });
			}
		}
	});
	window.parent.postMessage({ type: 'preview-hello', nonce: config.nonce, session: config.session }, config.parentOrigin);
}

export function createAppThemePreviewDocument(config, bootstrap, mock, normalizer = normalizeHostAppearance.toString()) {
	const value = JSON.stringify(config).replace(/</g, '\\u003c');
	const policy = `default-src 'none'; script-src 'nonce-${config.scriptNonce}' ${config.baseUrl}; style-src 'unsafe-inline' ${config.baseUrl}; img-src ${config.baseUrl}; font-src ${config.baseUrl}; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'`;
	const source = `(${bootstrap})(${value}, options => (${mock})({...options, normalizeAppearance: (${normalizer})}));`.replace(
		/<\/script/gi,
		'<\\/script',
	);
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><main id="app"></main><script nonce="${config.scriptNonce}">${source}</script></body></html>`;
}

/** Authenticated capability acquisition stays in the parent; only synthetic data enters the iframe. */
export function createAppThemePreview(ports) {
	const win = ports.window,
		document = ports.document || win.document;
	const request =
		ports.request || ((path, options) => (win.authenticatedFetch || win.fetch.bind(win))(path, { ...options, credentials: 'include' }));
	let current = null,
		generation = 0,
		disposed = false;
	let state = Object.freeze({ status: 'closed' });
	function publish(status, reason, token = current) {
		state = Object.freeze({ status, ...(reason ? { reason } : {}), ...(token?.cap ? { expiresAt: token.cap.expiresAt } : {}) });
		try {
			ports.onStatus?.(state);
		} catch {
			/* editor feedback cannot undo cleanup */
		}
		return state;
	}
	function pure(value, depth = 0) {
		if (depth > 16) {
			throw new Error('preview-invalid-config');
		}
		if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) {
			return value;
		}
		if (!value || typeof value !== 'object') {
			throw new Error('preview-invalid-config');
		}
		if (Array.isArray(value)) {
			return value.map((item) => pure(item, depth + 1));
		}
		const output = {};
		for (const key of Object.keys(value)) {
			const entry = Object.getOwnPropertyDescriptor(value, key);
			if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(entry, 'value')) {
				throw new Error('preview-invalid-config');
			}
			output[key] = pure(entry.value, depth + 1);
		}
		return output;
	}
	function revoke(cap) {
		if (!/^[a-f0-9]{64}$/.test(cap?.capabilityId || '')) {
			return;
		}
		try {
			Promise.resolve(request('/api/themes/preview-capabilities/' + cap.capabilityId, { method: 'DELETE' })).catch(() => {});
		} catch {
			/* fixed server TTL bounds failed revocation */
		}
	}
	function destroy(token) {
		if (!token || !token.active) {
			return;
		}
		token.active = false;
		token.controller.abort();
		win.removeEventListener('message', token.onHello);
		win.clearTimeout(token.expiryTimer);
		win.clearTimeout(token.readyTimer);
		try {
			token.port?.postMessage({ type: 'dispose', nonce: token.nonce, session: token.session });
		} catch {
			/* local invalidation precedes revoke */
		}
		token.port?.close();
		token.frame?.remove();
		revoke(token.cap);
	}
	function close() {
		generation++;
		destroy(current);
		current = null;
		return publish('closed');
	}
	function validateCapability(cap, input) {
		if (
			!cap ||
			!/^[a-f0-9]{64}$/.test(cap.capabilityId || '') ||
			!Number.isFinite(cap.expiresAt) ||
			cap.expiresAt <= Date.now() ||
			cap.expiresAt > Date.now() + 301000 ||
			cap.appearance?.packageId !== input.packageId
		) {
			throw new Error('preview-invalid-capability');
		}
		const base = new URL(cap.baseUrl, win.location.origin);
		if (
			base.origin !== win.location.origin ||
			base.username ||
			base.password ||
			base.pathname !== '/theme-preview/' + cap.capabilityId + '/' ||
			base.search ||
			base.hash
		) {
			throw new Error('preview-invalid-capability');
		}
		const url = (value) => {
			const parsed = new URL(value, win.location.origin);
			if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname) || parsed.search || parsed.hash) {
				throw new Error('preview-invalid-resource');
			}
			return parsed.href;
		};
		const files = cap.files || cap.appearance.files;
		if (!Array.isArray(files) || files.length > 256) {
			throw new Error('preview-invalid-capability');
		}
		if (
			cap.appearance.manifest?.themeApiVersion !== 2 ||
			cap.appearance.manifest?.kind !== 'app' ||
			cap.appearance.manifest?.sdkApiVersion !== 1
		) {
			throw new Error('preview-invalid-capability');
		}
		cap.files = files.map((file) => {
			if (
				typeof file.path !== 'string' ||
				!/^[A-Za-z0-9._/-]+$/.test(file.path) ||
				file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
				url(file.url) !== base.href + file.path ||
				!/^[a-f0-9]{64}$/.test(file.hash || '')
			) {
				throw new Error('preview-invalid-resource');
			}
			return { path: file.path, url: url(file.url), mime: file.mime, size: file.size, hash: file.hash };
		});
		cap.baseUrl = base.href;
		cap.entryUrl = url(cap.entryUrl);
		cap.styles = cap.styles.map(url);
		const urls = new Set(cap.files.map((file) => file.url));
		if (!urls.has(cap.entryUrl) || cap.styles.some((style) => !urls.has(style))) {
			throw new Error('preview-invalid-resource');
		}
		return cap;
	}
	function configuration(input, cap) {
		const manifest = cap.appearance.manifest;
		const values = pure(input.appearance || { settings: input.settings || {} });
		const settings = {};
		for (const key of Object.keys(values.settings || {})) {
			if (!manifest.settings.some((field) => field.key === key)) {
				throw new Error('preview-invalid-config');
			}
		}
		for (const field of manifest.settings) {
			const value = Object.hasOwn(values.settings || {}, field.key) ? values.settings[field.key] : field.default;
			const valid =
				field.type === 'boolean'
					? typeof value === 'boolean'
					: field.type === 'number'
						? typeof value === 'number' &&
							Number.isFinite(value) &&
							(field.min === undefined || value >= field.min) &&
							(field.max === undefined || value <= field.max)
						: typeof value === 'string' && value.length <= (field.type === 'textarea' ? 16384 : 2048) && !value.includes('\0');
			if (
				!valid ||
				(field.type === 'select' && !field.options.some((option) => option.value === value)) ||
				(field.type === 'color' && !/^#[0-9a-f]{3}(?:[0-9a-f]|[0-9a-f]{3}|[0-9a-f]{5})?$/i.test(value))
			) {
				throw new Error('preview-invalid-config');
			}
			settings[field.key] = value;
		}
		return {
			mode: input.mode === 'dark' ? 'dark' : 'light',
			language: input.language || 'en',
			scene: ['empty', 'login', 'offline'].includes(input.scene) ? input.scene : 'workspace',
			appearance: {
				kind: 'app',
				packageId: input.packageId,
				package: cap.appearance.package || { id: manifest.id, name: manifest.name, version: manifest.version },
				revision: null,
				settings,
				baseUrl: cap.baseUrl,
				files: cap.files,
			},
		};
	}
	function valid(token, data) {
		return (
			!disposed &&
			current === token &&
			token.active &&
			Date.now() < token.cap.expiresAt &&
			data?.nonce === token.nonce &&
			data?.session === token.session
		);
	}
	function command(token, data) {
		if (!valid(token, data) || data.type !== 'command' || !Number.isSafeInteger(data.seq) || data.seq !== token.sequence + 1) {
			return;
		}
		token.sequence = data.seq;
		const allowed = [
			'otp.copy',
			'otp.reconcile',
			'accounts.refresh',
			'accounts.uri',
			'accounts.link',
			'host.open',
			'preferences.set',
			'lifecycle.reload',
		];
		const id = data.args?.id;
		const accepted = allowed.includes(data.command) && (id === undefined || ['preview-mail', 'preview-code', 'preview-hotp'].includes(id));
		token.port.postMessage({
			type: 'response',
			nonce: token.nonce,
			session: token.session,
			seq: data.seq,
			result: accepted
				? { status: 'completed', preview: true, reason: 'synthetic-preview-only' }
				: { status: 'rejected', reason: 'preview-command-unavailable' },
		});
		if (accepted) {
			try {
				ports.onMockAction?.({ command: data.command, args: pure(data.args || {}) });
			} catch {
				/* An optional presentation observer cannot interrupt the mock channel. */
			}
		}
	}
	async function open(input) {
		close();
		if (disposed) {
			return state;
		}
		if (win.navigator.onLine === false) {
			return publish('blocked', 'offline-preview-unavailable');
		}
		const token = {
			active: true,
			generation: ++generation,
			controller: new AbortController(),
			sequence: 0,
			input,
			nonce: win.crypto.randomUUID(),
			session: win.crypto.randomUUID(),
		};
		current = token;
		publish('preparing');
		try {
			const data = pure(input.appearance || { settings: input.settings || {} });
			const response = await request('/api/themes/preview-capabilities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packageId: input.packageId, settings: data.settings || {} }),
				signal: token.controller.signal,
			});
			if (!response.ok) {
				throw new Error('preview-capability-' + response.status);
			}
			const received = await response.json();
			if (!token.active || current !== token || disposed) {
				revoke(received);
				return state;
			}
			token.cap = received;
			validateCapability(token.cap, input);
			token.config = configuration(token.pendingInput || input, token.cap);
			token.frame = document.createElement('iframe');
			token.frame.title = ports.translate?.('appearancePreview') || 'Theme preview';
			token.frame.setAttribute('sandbox', 'allow-scripts');
			token.frame.setAttribute('referrerpolicy', 'no-referrer');
			token.frame.setAttribute('credentialless', '');
			token.frame.style.width = '100%';
			token.frame.style.height = '100%';
			token.frame.style.border = '0';
			ports.container.append(token.frame);
			token.onHello = (event) => {
				if (event.source !== token.frame.contentWindow || !valid(token, event.data) || event.data.type !== 'preview-hello' || token.port) {
					return;
				}
				const channel = new win.MessageChannel();
				token.port = channel.port1;
				token.port.onmessage = ({ data }) => {
					if (!valid(token, data)) {
						return;
					}
					if (data.type === 'report') {
						if (data.value?.type === 'ready') {
							win.clearTimeout(token.readyTimer);
							token.ready = true;
							publish(data.value.imageFailures ? 'blocked' : 'ready', data.value.imageFailures ? 'preview-image-failed' : null, token);
							if (token.ready && token.pendingUpdate) {
								flushUpdate(token);
							}
						}
						if (data.value?.type === 'updated' && data.value.version === token.updateVersion) {
							win.clearTimeout(token.readyTimer);
							publish(data.value.imageFailures ? 'blocked' : 'ready', data.value.imageFailures ? 'preview-image-failed' : null, token);
						}
						if (data.value?.type === 'error') {
							destroy(token);
							publish('blocked', 'preview-runtime-failed', token);
						}
						return;
					}
					command(token, data);
				};
				token.port.start();
				token.frame.contentWindow.postMessage({ type: 'preview-connect', nonce: token.nonce, session: token.session }, '*', [
					channel.port2,
				]);
			};
			win.addEventListener('message', token.onHello);
			token.frame.srcdoc = ports.createDocument({
				...token.config,
				baseUrl: token.cap.baseUrl,
				entryUrl: token.cap.entryUrl,
				styles: token.cap.styles,
				parentOrigin: win.location.origin,
				nonce: token.nonce,
				session: token.session,
				scriptNonce: win.crypto.randomUUID(),
				expiresAt: token.cap.expiresAt,
			});
			token.expiryTimer = win.setTimeout(
				() => {
					destroy(token);
					if (current === token) {
						publish('blocked', 'preview-expired', token);
					}
				},
				Math.max(0, token.cap.expiresAt - Date.now()),
			);
			token.readyTimer = win.setTimeout(() => {
				destroy(token);
				if (current === token) {
					publish('blocked', 'preview-ready-timeout', token);
				}
			}, ports.readyTimeoutMs || 20000);
			return publish('loading');
		} catch (error) {
			if (current !== token || !token.active || disposed) {
				return state;
			}
			destroy(token);
			return publish('blocked', error?.message || 'preview-failed', token);
		}
	}
	function flushUpdate(token) {
		if (!token.active || !token.port || !token.ready || !token.pendingUpdate) {
			return state;
		}
		token.config = token.pendingUpdate;
		token.pendingUpdate = null;
		token.updateVersion = (token.updateVersion || 0) + 1;
		token.port.postMessage({
			type: 'update',
			nonce: token.nonce,
			session: token.session,
			version: token.updateVersion,
			value: token.config,
		});
		win.clearTimeout(token.readyTimer);
		token.readyTimer = win.setTimeout(() => {
			destroy(token);
			if (current === token) {
				publish('blocked', 'preview-update-timeout', token);
			}
		}, 10000);
		return publish('loading');
	}
	async function update(input) {
		const token = current;
		if (token?.active && !token.cap) {
			if (input.packageId !== token.input.packageId) {
				return publish('blocked', 'preview-resources-changed');
			}
			token.pendingInput = input;
			return state;
		}
		if (!token?.active || !token.cap || Date.now() >= token.cap.expiresAt) {
			destroy(token);
			return publish('blocked', 'preview-expired');
		}
		if (input.packageId !== token.config.appearance.packageId) {
			return publish('blocked', 'preview-resources-changed');
		}
		try {
			token.pendingUpdate = configuration(input, token.cap);
			return flushUpdate(token);
		} catch (error) {
			return publish('blocked', error.message || 'preview-invalid-config');
		}
	}
	const pagehide = () => close();
	win.addEventListener('pagehide', pagehide);
	const unsubscribe = ports.subscribeSession?.(() => {
		close();
		ports.onSessionInvalidated?.();
	});
	return Object.freeze({
		open,
		update,
		close,
		getState: () => state,
		dispose() {
			if (disposed) {
				return;
			}
			close();
			disposed = true;
			win.removeEventListener('pagehide', pagehide);
			unsubscribe?.();
		},
	});
}

export function getAppThemePreviewCode() {
	return `window.createAppThemePreview = function(options) { return (${serializeBrowserFunction(createAppThemePreview)})({ ...options, window, document,
    subscribeSession: options.subscribeSession || (listener => { if (typeof getThemeRuntime !== 'function') return () => {}; const accounts = getThemeRuntime().accounts; let generation = accounts.getSessionGeneration(); return accounts.subscribe(() => { const next = accounts.getState(); if (next.sessionGeneration !== generation || next.blocked) { generation = next.sessionGeneration; listener(); } }); }),
    createDocument: config => (${serializeBrowserFunction(createAppThemePreviewDocument)})(config, ${JSON.stringify(serializeBrowserFunction(appThemePreviewFrame))}, ${JSON.stringify(serializeBrowserFunction(createAppPreviewMockSdk))}, ${JSON.stringify(serializeBrowserFunction(normalizeHostAppearance))}) }); };`;
}
