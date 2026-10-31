import { serializeBrowserFunction } from './browserSource.js';

/** Trusted app execution coordinator. A permit is not a sandbox for same-origin JavaScript. */
export function createAppThemeHost(ports) {
	const win = ports.window,
		document = ports.document || win.document;
	const transport = ports.transport;
	const listeners = new Set();
	let appearance = ports.appearance,
		current = null,
		candidate = null,
		generation = 0,
		codeStarted = false,
		disposed = false;
	let attachmentTail = Promise.resolve();
	let state = Object.freeze({ status: 'idle', reason: null, entryStarted: false, generation });
	const clone = (value) => JSON.parse(JSON.stringify(value));
	function freeze(value) {
		if (value && typeof value === 'object') {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
		return value;
	}
	function publish(status, reason = null, token = current) {
		state = freeze({
			status,
			reason,
			entryStarted: Boolean(token?.entryStarted || codeStarted),
			generation: token?.generation ?? generation,
			tuple: token?.tuple || null,
		});
		for (const callback of [ports.onState, ...listeners]) {
			try {
				callback?.(state);
			} catch (error) {
				ports.onError?.(error);
			}
		}
	}
	function configuration(input) {
		const manifest = input?.manifest;
		if (
			!manifest ||
			manifest.themeApiVersion !== 2 ||
			manifest.kind !== 'app' ||
			manifest.sdkApiVersion !== 1 ||
			!/^[a-f0-9]{64}$/.test(input.packageId || '')
		) {
			throw new Error('invalid-app-appearance');
		}
		if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
			throw new Error('invalid-appearance-revision');
		}
		const baseUrl = '/theme-packages/' + input.packageId + '/';
		const path = (value) => {
			if (
				typeof value !== 'string' ||
				!/^[A-Za-z0-9._/-]+$/.test(value) ||
				value.split('/').some((part) => !part || part === '.' || part === '..')
			) {
				throw new Error('invalid-package-path');
			}
			return baseUrl + value;
		};
		const files = manifest.files.map((file) => ({
			path: file.path,
			url: path(file.path),
			mime: file.mime,
			size: file.size,
			hash: file.sha256,
		}));
		if (
			!files.some((file) => file.path === manifest.entry && file.mime === 'text/javascript') ||
			!manifest.styles.every((style) => files.some((file) => file.path === style && file.mime === 'text/css'))
		) {
			throw new Error('incomplete-package-inventory');
		}
		return {
			entryUrl: path(manifest.entry),
			styles: manifest.styles.map(path),
			value: freeze({
				kind: 'app',
				packageId: input.packageId,
				package: { id: manifest.id, name: manifest.name, version: manifest.version },
				revision: input.revision,
				settings: clone(input.settings || {}),
				baseUrl,
				files,
			}),
		};
	}
	function session() {
		return ports.getSessionState?.() || { sessionGeneration: 0, blocked: false, accessVerified: true };
	}
	function isCurrent(token) {
		const now = session();
		return (
			!disposed &&
			(current === token || candidate === token) &&
			token.active &&
			!token.controller.signal.aborted &&
			now.sessionGeneration === token.session &&
			!now.blocked &&
			now.accessVerified === true &&
			transport.isPermitCurrent(token.permit) === true
		);
	}
	function release(token) {
		if (!token || !token.active) {
			return;
		}
		token.active = false;
		token.scope?.dispose();
		token.controller.abort();
		try {
			Promise.resolve(token.instance?.unmount?.()).catch((error) => ports.onError?.(error));
		} catch (error) {
			ports.onError?.(error);
		}
		token.mountRoot?.remove();
		token.styles.forEach((link) => link.remove());
	}
	function invalidate(reason, { fallback = false } = {}) {
		const token = current || candidate;
		release(candidate);
		candidate = null;
		release(token);
		if (disposed) {
			return;
		}
		if (codeStarted) {
			publish('commands-suspended', reason, token);
			ports.onRecoveryRequired?.({ ...state, safeUrl: '/?safeMode=1' });
		} else {
			publish('official-fallback', reason, token);
			if (fallback || token) {
				ports.onFallback?.(state);
			}
		}
	}
	function bounded(operation, token, timeoutMs, reason) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (error, value) => {
				if (settled) {
					return;
				}
				settled = true;
				win.clearTimeout(timer);
				token.controller.signal.removeEventListener('abort', abort);
				error ? reject(error) : resolve(value);
			};
			const abort = () => finish(new Error('mount-invalidated'));
			const timer = win.setTimeout(() => finish(new Error(reason)), timeoutMs);
			token.controller.signal.addEventListener('abort', abort, { once: true });
			Promise.resolve(operation).then(
				(value) => finish(null, value),
				(error) => finish(error),
			);
			if (token.controller.signal.aborted) {
				abort();
			}
		});
	}
	async function stylesFor(token, urls) {
		if (ports.loadStyles) {
			await ports.loadStyles(urls, token.controller.signal);
			return;
		}
		await Promise.all(
			urls.map((url) =>
				bounded(
					new Promise((resolve, reject) => {
						const link = document.createElement('link');
						link.rel = 'stylesheet';
						link.href = url;
						link.dataset.appTheme = token.tuple.packageId;
						link.onload = resolve;
						link.onerror = () => reject(new Error('theme-style-failed'));
						token.styles.push(link);
						document.head.append(link);
					}),
					token,
					ports.resourceTimeoutMs || 15000,
					'theme-style-timeout',
				),
			),
		);
	}
	function validTuple(tuple) {
		return /^[a-f0-9]{64}$/.test(tuple.hostBuild) && tuple.mode === 'app' && tuple.sdkApiVersion === 1;
	}
	async function start(nextAppearance = appearance) {
		if (disposed) {
			return state;
		}
		const previous = current;
		if (previous?.entryStarted && nextAppearance?.packageId !== previous.tuple.packageId) {
			invalidate('runtime-navigation-required');
			return state;
		}
		if (
			previous?.active &&
			nextAppearance?.packageId === previous.tuple.packageId &&
			nextAppearance?.revision === previous.tuple.appearanceRevision &&
			isCurrent(previous)
		) {
			return state;
		}
		release(candidate);
		appearance = nextAppearance;
		const token = {
			generation: ++generation,
			active: true,
			controller: new AbortController(),
			styles: [],
			entryStarted: false,
			scope: null,
			instance: null,
			session: session().sessionGeneration,
		};
		candidate = token;
		const stillPending = () => {
			const activeSession = session();
			return (
				!disposed &&
				candidate === token &&
				token.active &&
				activeSession.sessionGeneration === token.session &&
				!activeSession.blocked &&
				activeSession.accessVerified === true
			);
		};
		try {
			const params = new URLSearchParams(win.location.search);
			if (params.get('safeMode') === '1' || params.get('disableCustomCode') === '1') {
				throw new Error('safe-mode');
			}
			if (session().blocked || session().accessVerified !== true) {
				throw new Error('authentication-required');
			}
			if (
				!ports.root ||
				!transport ||
				!['prepare', 'attach', 'startup', 'isPermitCurrent'].every((name) => typeof transport[name] === 'function')
			) {
				throw new Error('runtime-transport-unavailable');
			}
			const config = configuration(appearance);
			token.tuple = freeze({
				hostBuild: String(ports.hostBuild || win.__2FA_BUILD_ID__ || ''),
				sdkApiVersion: 1,
				packageId: appearance.packageId,
				appearanceRevision: appearance.revision,
				mode: 'app',
			});
			if (!validTuple(token.tuple)) {
				throw new Error('runtime-identity-unavailable');
			}
			publish('preparing', null, token);
			token.shellConfigId = ports.getShellConfigId
				? await bounded(ports.getShellConfigId(appearance), token, 15000, 'shell-identity-timeout')
				: ports.shellConfigId || win.__2FA_SHELL_CONFIG_ID__;
			if (!stillPending()) {
				return state;
			}
			if (!/^[a-f0-9]{64}$/.test(token.shellConfigId || '')) {
				throw new Error('shell-identity-unavailable');
			}
			// Aborting a mount does not cancel a worker's already dispatched ATTACH.
			// Await that handoff's actual settlement before starting another one, so
			// a superseded response cannot revoke the newer running permit.
			const attach = (cached = false) => {
				publish('attaching', null, token);
				const attaching = attachmentTail.then(() => {
					if (!stillPending()) {
						throw new Error('mount-invalidated');
					}
					return transport[cached ? 'tryAttachCached' : 'attach'](token.tuple, { expectedShellConfigId: token.shellConfigId });
				});
				attachmentTail = attaching.then(
					() => {},
					() => {},
				);
				return bounded(attaching, token, ports.attachTimeoutMs || 15000, 'runtime-attach-timeout');
			};
			let attached;
			if (!codeStarted && !previous?.active && typeof transport.tryAttachCached === 'function') {
				attached = await attach(true);
				if (!stillPending()) {
					return state;
				}
				if (attached?.status !== 'ready' && attached?.status !== 'miss') {
					throw new Error(attached?.reason || 'runtime-permission-denied');
				}
			}
			if (!attached || attached.status === 'miss') {
				publish('preparing', null, token);
				const prepared = await bounded(
					transport.prepare(token.tuple, { expectedShellConfigId: token.shellConfigId }),
					token,
					ports.prepareTimeoutMs || 125000,
					'runtime-prepare-timeout',
				);
				if (!stillPending()) {
					return state;
				}
				if (
					prepared?.status !== 'ready' ||
					prepared.compatible !== true ||
					prepared.resourcesReady !== true ||
					prepared.recoveryReady !== true
				) {
					throw new Error(prepared?.reason || 'runtime-incomplete');
				}
				attached = await attach();
			}
			if (!stillPending()) {
				return state;
			}
			if (attached?.status !== 'ready') {
				throw new Error(attached?.reason || 'runtime-permission-denied');
			}
			token.permit = attached.permit;
			if (!isCurrent(token)) {
				throw new Error('runtime-permission-invalidated');
			}
			// ATTACH atomically transfers the worker pin and revokes the previous
			// permit. Never keep an old scope alive or revive it after that boundary.
			release(previous);
			await stylesFor(token, config.styles);
			if (!isCurrent(token)) {
				throw new Error('runtime-permission-invalidated');
			}
			token.scope = ports.createSdkScope({ identity: token.tuple, isCurrent: () => isCurrent(token) });
			if (!token.scope?.sdk || typeof token.scope.dispose !== 'function') {
				throw new Error('runtime-sdk-unavailable');
			}
			token.mountRoot = document.createElement('div');
			token.mountRoot.dataset.appMount = String(token.generation);
			// Allow layout measurements during mount without exposing a partially
			// initialized view or interactive commands before startup is confirmed.
			token.mountRoot.style.visibility = 'hidden';
			token.mountRoot.inert = true;
			ports.root.append(token.mountRoot);
			token.entryStarted = true;
			codeStarted = true;
			publish('importing', null, token);
			const module = await bounded(
				(ports.importModule || ((url) => import(url)))(config.entryUrl),
				token,
				ports.mountTimeoutMs || 15000,
				'theme-import-timeout',
			);
			if (!isCurrent(token)) {
				throw new Error('runtime-permission-invalidated');
			}
			if (typeof module?.mount !== 'function') {
				throw new Error('theme-mount-unavailable');
			}
			publish('mounting', null, token);
			const mounting = Promise.resolve(
				module.mount({ root: token.mountRoot, sdk: token.scope.sdk, appearance: config.value, signal: token.controller.signal }),
			);
			mounting.then(
				(instance) => {
					if (!token.active) {
						try {
							Promise.resolve(typeof instance === 'function' ? instance() : instance?.unmount?.()).catch(() => {});
						} catch {
							/* obsolete cleanup cannot restore a mount */
						}
					}
				},
				() => {},
			);
			const instance = await bounded(mounting, token, ports.mountTimeoutMs || 15000, 'theme-mount-timeout');
			token.instance = typeof instance === 'function' ? { unmount: instance } : instance || {};
			if (!isCurrent(token)) {
				throw new Error('runtime-permission-invalidated');
			}
			const startup = await bounded(
				transport.startup(token.tuple, { expectedShellConfigId: token.shellConfigId }),
				token,
				ports.attachTimeoutMs || 15000,
				'runtime-startup-timeout',
			);
			if (!isCurrent(token)) {
				throw new Error('runtime-permission-invalidated');
			}
			if (startup?.status !== 'ready') {
				throw new Error(startup?.reason || 'runtime-startup-unconfirmed');
			}
			const presentation = token.scope.activateHostAppearance?.();
			if (presentation?.status === 'rejected') {
				throw new Error('host-appearance-invalidated');
			}
			current = token;
			candidate = null;
			token.mountRoot.style.removeProperty('visibility');
			token.mountRoot.inert = false;
			publish('running', null, token);
			ports.onRunning?.(state);
		} catch (error) {
			if (candidate !== token || disposed || !token.active) {
				return state;
			}
			release(token);
			candidate = null;
			if (previous?.active && isCurrent(previous)) {
				publish('running', 'appearance-update-failed:' + (error?.message || 'theme-start-failed'), previous);
				return state;
			}
			current = token;
			publish(codeStarted ? 'blocked-after-load-start' : 'official-fallback', error?.message || 'theme-start-failed', token);
			if (codeStarted) {
				ports.onRecoveryRequired?.({ ...state, safeUrl: '/?safeMode=1' });
			} else {
				ports.onFallback?.(state);
			}
		}
		return state;
	}
	const onPageHide = () => invalidate('page-hidden');
	const onTransport = (event) => {
		if (event?.type === 'invalidated') {
			invalidate(event.reason || 'controller-changed');
		} else if (event?.type === 'ready' && current?.active && !isCurrent(current)) {
			// A superseded in-flight handoff can settle while its replacement is
			// preparing. Clean up the now-revoked view even though its await ended.
			const previous = current;
			release(previous);
			if (!candidate?.active) {
				publish('commands-suspended', 'runtime-permission-replaced', previous);
				ports.onRecoveryRequired?.({ ...state, safeUrl: '/?safeMode=1' });
			}
		}
	};
	const unsubscribeTransport = transport?.subscribe?.(onTransport);
	const unsubscribeSession = ports.subscribeSession?.(() => {
		if (
			(current?.active || candidate?.active) &&
			(session().sessionGeneration !== (candidate || current).session || session().blocked || !session().accessVerified)
		) {
			invalidate('session-invalidated');
		}
	});
	win.addEventListener('pagehide', onPageHide);
	const previousGuard = win.__2FA_APP_MODULE_GUARD__;
	const moduleGuard = () => {
		const token = current?.active ? current : candidate;
		return token?.active && token.entryStarted ? () => isCurrent(token) : () => true;
	};
	win.__2FA_APP_MODULE_GUARD__ = moduleGuard;
	return Object.freeze({
		start,
		retry: () => start(appearance),
		updateAppearance: (next) => start(next),
		getState: () => state,
		getRoute: () => (win.location.hash.startsWith('#/theme/') ? win.location.hash.slice('#/theme'.length) : null),
		navigate(path) {
			if (!current || !isCurrent(current)) {
				return { status: 'rejected', reason: 'mount-invalidated' };
			}
			if (
				typeof path !== 'string' ||
				!path.startsWith('/') ||
				path.startsWith('//') ||
				/[\\#]/.test(path) ||
				path.split('/').some((part) => part === '..' || part === '.')
			) {
				return { status: 'rejected', reason: 'invalid-route' };
			}
			win.location.hash = '#/theme' + path;
			return { status: 'completed' };
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(state);
			return () => listeners.delete(listener);
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			release(candidate);
			release(current);
			unsubscribeTransport?.();
			unsubscribeSession?.();
			win.removeEventListener('pagehide', onPageHide);
			if (win.__2FA_APP_MODULE_GUARD__ === moduleGuard) {
				win.__2FA_APP_MODULE_GUARD__ = previousGuard;
			}
			listeners.clear();
			state = Object.freeze({ ...state, status: 'closed' });
		},
	});
}

export function getAppThemeHostCode() {
	return `window.createAppThemeHost = function(options) { return (${serializeBrowserFunction(createAppThemeHost)})({ ...options, window, document }); };`;
}
