import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { MessageChannel } from 'node:worker_threads';
import { createAppThemeHost } from '../../src/ui/scripts/appThemeHost.js';
import { createRuntimeTransport } from '../../src/ui/runtime/runtimeTransport.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';
import { createHostAppearanceManager, normalizeHostAppearance } from '../../src/ui/runtime/hostAppearance.js';

const build = 'a'.repeat(64),
	packageId = 'b'.repeat(64),
	shell = 'c'.repeat(64);
const appearance = (revision = 1) => ({
	kind: 'app',
	packageId,
	revision,
	settings: { title: 'Revision ' + revision },
	branding: { name: 'Demo' },
	manifest: {
		themeApiVersion: 2,
		sdkApiVersion: 1,
		kind: 'app',
		id: 'demo',
		name: 'Demo',
		version: '1.0.0',
		entry: 'entry.js',
		styles: [],
		files: [{ path: 'entry.js', mime: 'text/javascript', size: 1, sha256: 'd'.repeat(64) }],
	},
});
const fixtures = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		fixture.host?.dispose();
		fixture.transport?.dispose?.();
		await fixture.window?.happyDOM.abort();
		await fixture.dispose?.();
	}
});
function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function setup(options = {}) {
	const window = new Window({ url: 'https://vault.test/' }),
		root = window.document.createElement('main');
	window.document.body.append(root);
	window.__2FA_BUILD_ID__ = build;
	window.__2FA_SHELL_CONFIG_ID__ = shell;
	const permits = new Set(),
		listeners = new Set(),
		scopes = [],
		mounts = [];
	let session = { sessionGeneration: 0, accessVerified: true, blocked: false },
		sessionChanged;
	const transport = options.transportFactory?.(window) || {
		prepare: vi.fn(async (tuple) => ({ status: 'ready', tuple, compatible: true, resourcesReady: true, recoveryReady: true })),
		attach: vi.fn(async (tuple) => {
			const permit = { tuple };
			permits.clear();
			permits.add(permit);
			return { status: 'ready', permit };
		}),
		startup: vi.fn(async () => ({ status: 'ready' })),
		isPermitCurrent: (permit) => permits.has(permit),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const mount = vi.fn((args) => {
		mounts.push(args);
		args.root.textContent = args.appearance.settings.title;
		return { unmount: vi.fn() };
	});
	const ports = {
		window,
		root,
		transport,
		appearance: appearance(),
		getSessionState: () => session,
		subscribeSession: (listener) => {
			sessionChanged = listener;
			return () => {};
		},
		createSdkScope: vi.fn(({ identity, isCurrent }) => {
			const scope = { sdk: { identity, canAct: isCurrent }, dispose: vi.fn() };
			scopes.push(scope);
			return scope;
		}),
		importModule: vi.fn(async () => ({ mount })),
		onFallback: vi.fn(),
		onRunning: vi.fn(),
		onRecoveryRequired: vi.fn(),
		...options,
	};
	const host = createAppThemeHost(ports),
		fixture = {
			host,
			window,
			root,
			transport,
			ports,
			mount,
			scopes,
			mounts,
			invalidate() {
				permits.clear();
				listeners.forEach((listener) => listener({ type: 'invalidated', reason: 'controller-changed' }));
			},
			logout() {
				session = { sessionGeneration: 1, accessVerified: false, blocked: true };
				sessionChanged();
			},
		};
	fixtures.push(fixture);
	return fixture;
}

function enableCachedAttach(h) {
	h.transport.tryAttachCached = vi.fn(h.transport.attach.getMockImplementation());
	return h;
}

describe('fresh app cached attachment', () => {
	it('skips preparation on a verified hit while keeping CSS, import and startup reveal ordered', async () => {
		const styles = deferred(),
			started = deferred();
		const h = enableCachedAttach(setup({ loadStyles: vi.fn(() => styles.promise) }));
		h.transport.startup.mockReturnValueOnce(started.promise);
		const starting = h.host.start();
		await vi.waitFor(() => expect(h.ports.loadStyles).toHaveBeenCalledOnce());
		expect(h.transport.tryAttachCached).toHaveBeenCalledOnce();
		expect(h.transport.prepare).not.toHaveBeenCalled();
		expect(h.transport.attach).not.toHaveBeenCalled();
		expect(h.ports.importModule).not.toHaveBeenCalled();
		styles.resolve();
		await vi.waitFor(() => expect(h.transport.startup).toHaveBeenCalledOnce());
		expect(h.root.firstElementChild.inert).toBe(true);
		expect(h.root.firstElementChild.style.visibility).toBe('hidden');
		expect(h.ports.onRunning).not.toHaveBeenCalled();
		started.resolve({ status: 'ready' });
		expect((await starting).status).toBe('running');
		expect(h.root.firstElementChild.inert).toBe(false);
		expect(h.root.firstElementChild.style.visibility).toBe('');
	});
	it.each(['not-prepared', 'evicted'])('repairs an explicit cached %s miss using the original prepare and attach flow', async (reason) => {
		const h = enableCachedAttach(setup());
		h.transport.tryAttachCached.mockResolvedValueOnce({ status: 'miss', reason });
		expect((await h.host.start()).status).toBe('running');
		expect(h.transport.prepare).toHaveBeenCalledOnce();
		expect(h.transport.attach).toHaveBeenCalledOnce();
		expect(h.transport.tryAttachCached.mock.invocationCallOrder[0]).toBeLessThan(h.transport.prepare.mock.invocationCallOrder[0]);
		expect(h.transport.prepare.mock.invocationCallOrder[0]).toBeLessThan(h.transport.attach.mock.invocationCallOrder[0]);
		expect(h.transport.attach.mock.invocationCallOrder[0]).toBeLessThan(h.ports.importModule.mock.invocationCallOrder[0]);
	});
	it.each(['not-prepared', 'evicted', 'worker-timeout', 'activation-blocked'])(
		'does not infer a cache miss from an arbitrary blocked reason %s',
		async (reason) => {
			const h = enableCachedAttach(setup());
			h.transport.tryAttachCached.mockResolvedValueOnce({ status: 'blocked', reason });
			expect(await h.host.start()).toMatchObject({ status: 'official-fallback', reason });
			expect(h.transport.prepare).not.toHaveBeenCalled();
			expect(h.transport.attach).not.toHaveBeenCalled();
			expect(h.ports.importModule).not.toHaveBeenCalled();
		},
	);
	it('keeps running appearance updates on the original two-phase handoff', async () => {
		const h = enableCachedAttach(setup());
		await h.host.start();
		const previous = h.scopes[0];
		expect((await h.host.updateAppearance(appearance(2))).status).toBe('running');
		expect(h.transport.tryAttachCached).toHaveBeenCalledOnce();
		expect(h.transport.prepare).toHaveBeenCalledOnce();
		expect(h.transport.attach).toHaveBeenCalledOnce();
		expect(previous.sdk.canAct()).toBe(false);
	});
	it('does not use cached attach after any entry code has started, even when its mount failed', async () => {
		const h = enableCachedAttach(setup());
		h.mount.mockRejectedValueOnce(new Error('mount failed'));
		expect((await h.host.start()).status).toBe('blocked-after-load-start');
		expect((await h.host.retry()).status).toBe('running');
		expect(h.transport.tryAttachCached).toHaveBeenCalledOnce();
		expect(h.transport.prepare).toHaveBeenCalledOnce();
	});
	it.each(['logout', 'invalidate', 'pagehide', 'dispose'])('never resumes preparation from a late miss after %s', async (action) => {
		const h = enableCachedAttach(setup()),
			pending = deferred();
		h.transport.tryAttachCached.mockReturnValueOnce(pending.promise);
		const starting = h.host.start();
		await vi.waitFor(() => expect(h.transport.tryAttachCached).toHaveBeenCalledOnce());
		if (action === 'pagehide') {
			h.window.dispatchEvent(new h.window.Event('pagehide'));
		} else if (action === 'dispose') {
			h.host.dispose();
		} else {
			h[action]();
		}
		pending.resolve({ status: 'miss', reason: 'not-prepared' });
		await starting;
		expect(h.transport.prepare).not.toHaveBeenCalled();
		expect(h.transport.attach).not.toHaveBeenCalled();
		expect(h.ports.importModule).not.toHaveBeenCalled();
	});
	it('retains the real cached handoff tail after the host timeout until the old MessageChannel settles', async () => {
		const requests = [];
		let replyOld;
		const serviceWorker = Object.assign(new EventTarget(), {
			controller: {
				postMessage(request, [port]) {
					requests.push(request);
					const reply = (changes = {}) =>
						port.postMessage({
							...request,
							status: 'ready',
							compatible: true,
							resourcesReady: true,
							recoveryReady: true,
							workerBuild: build,
							permitId: 'permit-' + requests.length,
							inventoryHash: 'd'.repeat(64),
							...changes,
						});
					if (requests.length === 1) {
						replyOld = () => reply({ status: 'blocked', reason: 'not-prepared' });
					} else {
						reply();
					}
				},
			},
		});
		const h = setup({
			attachTimeoutMs: 25,
			transportFactory: (window) => createRuntimeTransport({ window, navigator: { serviceWorker }, MessageChannel }),
		});
		expect(await h.host.start()).toMatchObject({ status: 'official-fallback', reason: 'runtime-attach-timeout' });
		h.ports.attachTimeoutMs = 1000;
		const retry = h.host.retry();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(requests.map((request) => request.type)).toEqual(['RUNTIME_ATTACH']);
		replyOld();
		expect((await retry).status).toBe('running');
		expect(requests.map((request) => request.type)).toEqual(['RUNTIME_ATTACH', 'RUNTIME_ATTACH', 'RUNTIME_STARTED']);
		expect(h.scopes[0].sdk.canAct()).toBe(true);
	});
});

describe('production app host', () => {
	it('only activates staged host visuals after startup and removes them when a replacement fails after ATTACH', async () => {
		const scopes = [];
		const h = setup({
			createSdkScope: ({ isCurrent }) => {
				const visual = manager.createScope({ isCurrent });
				const scope = {
					sdk: { host: { setAppearance: (value) => visual.setAppearance(value) } },
					activateHostAppearance: () => visual.activate(),
					dispose: () => visual.dispose(),
				};
				scopes.push(scope);
				return scope;
			},
		});
		const manager = createHostAppearanceManager({ document: h.window.document, normalize: normalizeHostAppearance });
		h.mount.mockImplementation(({ sdk }) => {
			expect(sdk.host.setAppearance({ surface: '#123456' })).toEqual({ status: 'completed' });
			return {};
		});
		const startup = deferred();
		h.transport.startup.mockReturnValueOnce(startup.promise);
		const starting = h.host.start();
		await vi.waitFor(() => expect(h.transport.startup).toHaveBeenCalledOnce());
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBeNull();
		startup.resolve({ status: 'ready' });
		await starting;
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).not.toBeNull();
		const originalStyle = h.window.document.querySelector('style[data-app-host-appearance]');
		h.transport.prepare.mockResolvedValueOnce({ status: 'blocked', reason: 'not-ready' });
		expect((await h.host.updateAppearance(appearance(2))).status).toBe('running');
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBe(originalStyle);
		const failedStartup = deferred();
		h.transport.startup.mockReturnValueOnce(failedStartup.promise);
		const changing = h.host.updateAppearance(appearance(2));
		await vi.waitFor(() => expect(h.transport.startup).toHaveBeenCalledTimes(2));
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBeNull();
		expect(scopes[0].sdk.host.setAppearance({ surface: '#999' })).toMatchObject({ reason: 'mount-invalidated' });
		failedStartup.resolve({ status: 'blocked', reason: 'test-startup-failed' });
		await changing;
		expect(h.host.getState().status).toBe('blocked-after-load-start');
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBeNull();
		expect(scopes[1].sdk.host.setAppearance({})).toMatchObject({ reason: 'mount-invalidated' });
	});
	it.each(['logout', 'invalidate', 'pagehide'])(
		'synchronously clears running host visuals on %s before asynchronous theme cleanup',
		async (action) => {
			let old;
			const h = setup({
				createSdkScope: ({ isCurrent }) => {
					old = manager.createScope({ isCurrent });
					return {
						sdk: { host: { setAppearance: (value) => old.setAppearance(value) } },
						activateHostAppearance: () => old.activate(),
						dispose: () => old.dispose(),
					};
				},
			});
			const manager = createHostAppearanceManager({ document: h.window.document, normalize: normalizeHostAppearance });
			const cleanup = deferred();
			h.mount.mockImplementation(({ sdk }) => {
				sdk.host.setAppearance({ surface: '#abcdef' });
				return { unmount: () => cleanup.promise };
			});
			await h.host.start();
			expect(h.window.document.querySelector('style[data-app-host-appearance]')).not.toBeNull();
			if (action === 'pagehide') {
				h.window.dispatchEvent(new h.window.Event('pagehide'));
			} else {
				h[action]();
			}
			expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBeNull();
			expect(old.setAppearance(null)).toMatchObject({ reason: 'mount-invalidated' });
			cleanup.resolve();
		},
	);
	it.each(['no-controller', 'runtime-incomplete', 'shell-configuration-changed'])(
		'retains official fallback without import when preparation blocks: %s',
		async (reason) => {
			const h = setup();
			h.transport.prepare.mockResolvedValue({ status: 'blocked', reason });
			expect(await h.host.start()).toMatchObject({ status: 'official-fallback', reason, entryStarted: false });
			expect(h.ports.importModule).not.toHaveBeenCalled();
			expect(h.ports.onFallback).toHaveBeenCalledOnce();
		},
	);
	it('checks all readiness flags and safe mode before evaluating app code', async () => {
		const h = setup();
		h.transport.prepare.mockResolvedValue({ status: 'ready', compatible: true, resourcesReady: true, recoveryReady: false });
		expect((await h.host.start()).status).toBe('official-fallback');
		expect(h.ports.importModule).not.toHaveBeenCalled();
		h.window.location.href = 'https://vault.test/?safeMode=1';
		h.transport.prepare.mockClear();
		expect((await h.host.retry()).reason).toBe('safe-mode');
		expect(h.transport.prepare).not.toHaveBeenCalled();
	});
	it('binds the complete tuple and shell before mount and exposes immutable configuration', async () => {
		const h = setup();
		expect((await h.host.start()).status).toBe('running');
		expect(h.transport.prepare).toHaveBeenCalledWith(
			{ hostBuild: build, sdkApiVersion: 1, packageId, appearanceRevision: 1, mode: 'app' },
			{ expectedShellConfigId: shell },
		);
		expect(h.transport.attach).toHaveBeenCalledWith(expect.objectContaining({ appearanceRevision: 1 }), { expectedShellConfigId: shell });
		expect(h.mounts[0].appearance.package.name).toBe('Demo');
		expect(Object.isFrozen(h.mounts[0].appearance.settings)).toBe(true);
		expect(h.host.navigate('/accounts/example')).toEqual({ status: 'completed' });
		expect(h.window.location.hash).toBe('#/theme/accounts/example');
		expect(h.host.navigate('/../otp').status).toBe('rejected');
		expect(h.host.navigate('//external.test').status).toBe('rejected');
	});
	it('never mounts a late import after controller invalidation and never revives its old SDK', async () => {
		const waiting = deferred(),
			h = setup();
		h.ports.importModule.mockReturnValueOnce(waiting.promise);
		const starting = h.host.start();
		await vi.waitFor(() => expect(h.ports.importModule).toHaveBeenCalledOnce());
		const old = h.scopes[0];
		h.invalidate();
		waiting.resolve({ mount: h.mount });
		await starting;
		expect(h.mount).not.toHaveBeenCalled();
		expect(h.host.getState().entryStarted).toBe(true);
		expect(old.sdk.canAct()).toBe(false);
		expect((await h.host.retry()).status).toBe('running');
		expect(h.scopes).toHaveLength(2);
		expect(old.sdk.canAct()).toBe(false);
		expect(h.scopes[1].sdk.canAct()).toBe(true);
	});
	it('revokes commands and removes mounted DOM on logout or BFCache pagehide', async () => {
		const h = setup();
		await h.host.start();
		const old = h.scopes[0];
		h.logout();
		expect(old.sdk.canAct()).toBe(false);
		expect(h.root.children).toHaveLength(0);
		const second = setup();
		await second.host.start();
		second.window.dispatchEvent(new second.window.PageTransitionEvent('pagehide', { persisted: true }));
		expect(second.scopes[0].sdk.canAct()).toBe(false);
		expect(second.host.getState()).toMatchObject({ status: 'commands-suspended', reason: 'page-hidden' });
	});
	it('keeps the old usable view through prepare and permanently releases it at new tuple attach', async () => {
		const h = setup({ getShellConfigId: vi.fn(async (value) => String(value.revision).repeat(64)) });
		await h.host.start();
		const oldRoot = h.root.firstElementChild,
			old = h.scopes[0],
			prepared = deferred(),
			mounting = deferred();
		h.transport.prepare.mockReturnValueOnce(prepared.promise);
		h.mount.mockImplementationOnce((args) => {
			args.root.textContent = args.appearance.settings.title;
			return mounting.promise;
		});
		const replacing = h.host.updateAppearance(appearance(2));
		await Promise.resolve();
		expect(old.sdk.canAct()).toBe(true);
		expect(oldRoot.isConnected).toBe(true);
		prepared.resolve({ status: 'ready', compatible: true, resourcesReady: true, recoveryReady: true });
		await vi.waitFor(() => expect(h.mount).toHaveBeenCalledTimes(2));
		expect(old.sdk.canAct()).toBe(false);
		expect(oldRoot.isConnected).toBe(false);
		expect(old.dispose).toHaveBeenCalledOnce();
		expect(h.root.firstElementChild.inert).toBe(true);
		expect(h.root.firstElementChild.style.visibility).toBe('hidden');
		mounting.resolve({ unmount: vi.fn() });
		await replacing;
		expect(h.root.textContent).toBe('Revision 2');
		expect(h.root.firstElementChild.inert).toBe(false);
		expect(h.root.firstElementChild.style.visibility).toBe('');
		expect(h.transport.attach).toHaveBeenLastCalledWith(expect.objectContaining({ appearanceRevision: 2 }), {
			expectedShellConfigId: '2'.repeat(64),
		});
		expect(h.ports.onRunning).toHaveBeenCalledTimes(2);
	});
	it('requires recovery after a new attached revision fails to mount and cannot revive the old SDK', async () => {
		const h = setup();
		await h.host.start();
		const old = h.scopes[0];
		h.mount.mockRejectedValueOnce(new Error('new-theme-mount-failed'));
		expect(await h.host.updateAppearance(appearance(2))).toMatchObject({
			status: 'blocked-after-load-start',
			reason: 'new-theme-mount-failed',
		});
		expect(h.root.children).toHaveLength(0);
		expect(old.sdk.canAct()).toBe(false);
		expect(old.dispose).toHaveBeenCalledOnce();
		expect(h.ports.onRecoveryRequired).toHaveBeenCalledOnce();
		expect((await h.host.retry()).status).toBe('running');
		expect(old.sdk.canAct()).toBe(false);
		expect(h.scopes).toHaveLength(3);
	});
	it('keeps the executed-code recovery boundary when replacement styles fail before the second import', async () => {
		const loadStyles = vi.fn(async () => {});
		const h = setup({ loadStyles });
		await h.host.start();
		loadStyles.mockRejectedValueOnce(new Error('theme-style-failed'));
		expect(await h.host.updateAppearance(appearance(2))).toMatchObject({
			status: 'blocked-after-load-start',
			reason: 'theme-style-failed',
			entryStarted: true,
		});
		expect(h.ports.importModule).toHaveBeenCalledTimes(1);
		expect(h.ports.onFallback).not.toHaveBeenCalled();
		expect(h.ports.onRecoveryRequired).toHaveBeenCalledOnce();
	});
	it('preserves the old view and scope when a same-package update fails, and requires navigation for another package', async () => {
		const h = setup();
		await h.host.start();
		const old = h.scopes[0];
		h.transport.prepare.mockResolvedValueOnce({ status: 'blocked', reason: 'quota' });
		expect(await h.host.updateAppearance(appearance(2))).toMatchObject({
			status: 'running',
			reason: 'appearance-update-failed:quota',
			tuple: { appearanceRevision: 1 },
		});
		expect(h.root.textContent).toBe('Revision 1');
		expect(old.sdk.canAct()).toBe(true);
		await h.host.updateAppearance({ ...appearance(3), packageId: 'e'.repeat(64) });
		expect(h.host.getState()).toMatchObject({ reason: 'runtime-navigation-required' });
		expect(h.ports.importModule).toHaveBeenCalledTimes(1);
	});
	it('serializes real worker handoffs so a superseded delayed ATTACH cannot revoke a newer running revision', async () => {
		const requests = [];
		let delayed;
		const serviceWorker = Object.assign(new EventTarget(), {
			controller: {
				postMessage(request, [port]) {
					requests.push(request);
					const reply = () =>
						port.postMessage({
							...request,
							status: 'ready',
							compatible: true,
							resourcesReady: true,
							recoveryReady: true,
							workerBuild: build,
							permitId: 'permit-' + requests.length,
							inventoryHash: 'd'.repeat(64),
						});
					if (request.type === 'RUNTIME_ATTACH' && request.tuple.appearanceRevision === 2) {
						delayed = reply;
					} else {
						reply();
					}
				},
			},
		});
		const h = setup({ transportFactory: (window) => createRuntimeTransport({ window, navigator: { serviceWorker }, MessageChannel }) });
		await h.host.start();
		const old = h.scopes[0];
		const second = h.host.updateAppearance(appearance(2));
		await vi.waitFor(() => expect(delayed).toBeTypeOf('function'));
		const third = h.host.updateAppearance(appearance(3));
		await vi.waitFor(() => expect(h.host.getState()).toMatchObject({ status: 'attaching', tuple: { appearanceRevision: 3 } }));
		expect(requests.filter((request) => request.type === 'RUNTIME_ATTACH').map((request) => request.tuple.appearanceRevision)).toEqual([
			1, 2,
		]);
		delayed();
		await Promise.all([second, third]);
		expect(h.host.getState()).toMatchObject({ status: 'running', tuple: { appearanceRevision: 3 } });
		expect(h.transport.getState().tuple.appearanceRevision).toBe(3);
		expect(h.root.textContent).toBe('Revision 3');
		expect(h.scopes.at(-1).sdk.canAct()).toBe(true);
		expect(old.sdk.canAct()).toBe(false);
		expect(h.mount).toHaveBeenCalledTimes(2);
		// Any unexpected successful external handoff must explicitly recover the
		// currently displayed view, instead of silently rejecting all its commands.
		const next = { ...h.transport.getState().tuple, appearanceRevision: 4 };
		await h.transport.prepare(next);
		await h.transport.attach(next);
		expect(h.host.getState()).toMatchObject({ status: 'commands-suspended', reason: 'runtime-permission-replaced' });
		expect(h.ports.onRecoveryRequired).toHaveBeenCalledOnce();
		expect(h.root.children).toHaveLength(0);
	});
	it('rejects stale startup completion and cleans a late asynchronous mount', async () => {
		const waiting = deferred(),
			cleanup = vi.fn(),
			h = setup();
		h.mount.mockReturnValueOnce(waiting.promise);
		const starting = h.host.start();
		await vi.waitFor(() => expect(h.mount).toHaveBeenCalledOnce());
		h.invalidate();
		waiting.resolve({ unmount: cleanup });
		await starting;
		await Promise.resolve();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(h.transport.startup).not.toHaveBeenCalled();
		expect(h.ports.onRunning).not.toHaveBeenCalled();
	});
	it('creates fresh real SDK scopes over the same core and cannot revive old async clipboard work', async () => {
		const clipboard = deferred();
		const h = await createRuntimeFixture({
			accountDOM: false,
			clipboard: { writeText: () => clipboard.promise },
			extraSource: 'window.__runtimeFixture.createScope = createAppThemeSdkScope;',
		});
		fixtures.push(h);
		h.setClock(59000);
		const core = h.getThemeRuntime();
		h.replaceSecretRecords([{ id: 'a', name: 'Demo', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }], {
			source: 'server',
			accessVerified: true,
		});
		await core.otp.refresh();
		let live = true;
		const old = h.createScope({ identity: { hostBuild: build, packageId, appearanceRevision: 1 }, isCurrent: () => live });
		const copying = old.sdk.otp.copy(old.sdk.otp.readCopyTarget('a').target);
		live = false;
		old.dispose();
		const fresh = h.createScope({ identity: { hostBuild: build, packageId, appearanceRevision: 2 }, isCurrent: () => true });
		expect(fresh.accounts).toBe(core.accounts);
		expect(fresh.otp).toBe(core.otp);
		expect(fresh.view).toBe(core.view);
		expect(fresh.commands).toBe(core.commands);
		clipboard.resolve();
		expect(await copying).toMatchObject({ reason: 'mount-invalidated' });
		expect(old.sdk.clock.now()).toBeNull();
		expect(fresh.sdk.clock.now()).toBe(59000);
		fresh.dispose();
	});
	it('routes runtime update reloads through worker preparation and rechecks pending writes after awaiting it', async () => {
		const h = await createRuntimeFixture({
			accountDOM: false,
			extraSource: 'requestRuntimeUpdate = () => window.__updateReply;',
		});
		fixtures.push(h);
		const sdk = h.getThemeRuntime().sdk;
		const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
		h.window.__updateReply = { status: 'blocked', reason: 'candidate-not-prepared' };
		expect(await sdk.lifecycle.requestReload('update')).toMatchObject({ status: 'rejected', reason: 'candidate-not-prepared' });
		expect(reload).not.toHaveBeenCalled();
		const waiting = deferred();
		h.window.__updateReply = waiting.promise;
		const updating = sdk.lifecycle.requestReload('update');
		const write = h.beginWrite({ type: 'edit' });
		waiting.resolve({ status: 'blocked', reason: 'no-waiting-worker' });
		expect(await updating).toMatchObject({ status: 'rejected', reason: 'unsaved-or-pending' });
		expect(reload).not.toHaveBeenCalled();
		h.endWrite(write);
		h.window.__updateReply = { status: 'blocked', reason: 'no-waiting-worker' };
		expect(await sdk.lifecycle.requestReload('update')).toMatchObject({ status: 'completed', reason: 'reload-requested' });
		expect(reload).toHaveBeenCalledOnce();
		h.window.__updateReply = { status: 'ready' };
		expect(await sdk.lifecycle.requestReload('update')).toMatchObject({ status: 'completed', reason: 'update-requested' });
		expect(reload).toHaveBeenCalledTimes(2);
	});
});
