import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const buildId = 'a'.repeat(64);
const packageId = 'b'.repeat(64);
const record = {
	id: 'totp',
	name: 'Google',
	account: 'test@example.test',
	secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
	type: 'TOTP',
	period: 30,
	digits: 6,
	algorithm: 'SHA1',
};
const appearance = (revision = 1, changes = {}) => ({
	kind: 'app',
	packageId,
	revision,
	settings: { title: 'Revision ' + revision },
	branding: { name: 'App ' + revision },
	manifest: {
		themeApiVersion: 2,
		sdkApiVersion: 1,
		kind: 'app',
		id: 'integration',
		name: 'Integration',
		version: '1.0.0',
		entry: 'entry.js',
		settings: [],
		styles: [],
		files: [{ path: 'entry.js', mime: 'text/javascript', size: 1, sha256: 'd'.repeat(64) }],
	},
	...changes,
});
const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((h) => h.dispose()));
	vi.restoreAllMocks();
});
function transition(window, type, persisted) {
	const event = new window.Event(type);
	Object.defineProperty(event, 'persisted', { value: persisted });
	window.dispatchEvent(event);
}
function deferred() {
	let resolve;
	const promise = new Promise((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
async function fixture({ authenticated = true, full = false, snapshot = appearance(), safe = false, ...options } = {}) {
	let worker;
	const h = await createRuntimeFixture({
		full,
		appearance: snapshot,
		buildId,
		...options,
		setupWindow: (window) => {
			worker = new window.EventTarget();
			Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: worker });
			if (safe) {
				window.__2FA_SAFE_MODE__ = true;
			}
			options.setupWindow?.(window);
		},
	});
	fixtures.push(h);
	h.setClock(59000);
	const runtime = h.getThemeRuntime();
	if (authenticated) {
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
	}
	await runtime.otp.refresh();
	let ports;
	const host = {
		start: vi.fn(async () => ({ status: 'preparing' })),
		updateAppearance: vi.fn(async () => ({ status: 'preparing' })),
		retry: vi.fn(async () => ({ status: 'preparing' })),
		dispose: vi.fn(),
	};
	const factory = vi.fn((options) => {
		ports = options;
		return host;
	});
	h.window.createAppThemeHost = factory;
	return {
		...h,
		runtime,
		host,
		factory,
		worker,
		ports: () => ports,
		start: () => h.initializeAppThemeIntegration(),
		running: (revision = 1) =>
			ports.onRunning({
				status: 'running',
				tuple: { hostBuild: buildId, sdkApiVersion: 1, packageId, appearanceRevision: revision, mode: 'app' },
			}),
	};
}
const status = (h) => h.document.getElementById('appThemeRuntimeStatus');
const button = (h, index) => status(h).querySelectorAll('button')[index];
const labeledButton = (h, key) =>
	[...status(h).querySelectorAll('button')].find((item) => item.textContent === h.window.eval('t(' + JSON.stringify(key) + ')'));
const statusAction = (h, action) => status(h).querySelector('[data-runtime-action="' + action + '"]');

// These tests exercise the real page, emitted integration, account store, SDK and
// host dialogs. Only the independently tested app-host factory is an explicit port.
describe('official shell and full-theme integration', () => {
	it('keeps the public baseline through preparation and logout, updating it only for the confirmed desired tuple', async () => {
		const snapshot = (revision, color) =>
			appearance(revision, {
				publicAppearance: {
					formatVersion: 1,
					packageId,
					light: { surface: color, radius: 0 },
					dark: { surface: color, radius: 0 },
					fonts: [],
				},
			});
		const h = await fixture({ snapshot: snapshot(1, '#abc123') });
		const baseline = () => h.document.getElementById('public-appearance-baseline')?.textContent;
		expect(baseline()).toContain('#abc123');
		h.start();
		h.running(1);
		await h.window.updateAppThemeAppearance(snapshot(2, '#def456'));
		expect(baseline()).toContain('#abc123');
		h.ports().onFallback({ status: 'official-fallback', reason: 'test-not-ready' });
		expect(baseline()).toContain('#abc123');
		h.running(2);
		expect(baseline()).toContain('#def456');
		h.running(1);
		expect(baseline()).toContain('#def456');
		h.invalidateSecretSession();
		expect(baseline()).toContain('#def456');
		await h.window.updateAppThemeAppearance(appearance(3, { packageId: 'c'.repeat(64) }));
		expect(baseline()).toContain('#def456');
	});
	it('shows access checking separately from a confirmed login requirement, then starts after verification', async () => {
		const h = await fixture({ authenticated: false });
		h.start();
		expect(status(h).dataset.phase).toBe('checking-access');
		expect(h.document.documentElement.getAttribute('data-app-theme-startup')).toBe('managed');
		expect(status(h).textContent).toContain(h.window.eval('t("loading")'));
		expect(statusAction(h, 'login')).toBeNull();
		expect(statusAction(h, 'retry')).toBeNull();
		expect(h.host.start).not.toHaveBeenCalled();
		h.invalidateSecretSession();
		expect(status(h).dataset.phase).toBe('login-required');
		expect(status(h).textContent).toContain(h.window.eval('t("appearanceRuntimeLoginRequired")'));
		statusAction(h, 'login').click();
		expect(h.document.getElementById('loginModal').style.display).toBe('flex');
		expect(h.document.documentElement.getAttribute('data-app-theme-startup')).toBe('managed');
		h.window.eval('hideLoginModal()');
		expect(h.document.documentElement.getAttribute('data-app-theme-startup')).toBe('managed');
		h.invalidateSecretSession({ blocked: false });
		expect(status(h).dataset.phase).toBe('checking-access');
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
		expect(h.host.start).toHaveBeenCalledOnce();
		expect(status(h).dataset.phase).toBe('preparing');
	});
	it('keeps loading stages as metadata and uses one plain message with guarded recovery', async () => {
		const h = await fixture();
		h.start();
		expect(status(h).className).toBe('app-theme-status');
		expect(status(h).getAttribute('role')).toBe('status');
		expect(status(h).getAttribute('aria-live')).toBe('polite');
		for (const phase of ['preparing', 'attaching', 'importing', 'mounting']) {
			h.ports().onState({ status: phase });
			expect(status(h).dataset.phase).toBe(phase);
			expect(status(h).textContent).toContain(h.window.eval('t("loading")'));
			expect(status(h).getAttribute('aria-busy')).toBe('true');
			expect(statusAction(h, 'retry')).toBeNull();
			expect(labeledButton(h, 'appearanceUseDefault')).toBeDefined();
			expect(labeledButton(h, 'appearanceSafeMode')).toBeUndefined();
		}
		const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
		const write = h.beginWrite({ type: 'edit', accountId: record.id });
		statusAction(h, 'recovery').click();
		await Promise.resolve();
		expect(assign).not.toHaveBeenCalled();
		h.endWrite(write);
		statusAction(h, 'recovery').click();
		await Promise.resolve();
		expect(assign).toHaveBeenCalledWith('https://vault.test/?safeMode=1');
	});
	it('keeps failed access verification distinct from login and retries the real account refresh only on explicit clicks', async () => {
		let next;
		const fetch = vi.fn(async (url) => {
			if (url === '/api/secrets') {
				return next ? next.promise : new Response('{}', { status: 503 });
			}
			if (url === '/api/settings') {
				return Response.json({ language: 'en' });
			}
			return new Response('{}', { status: 503 });
		});
		const h = await fixture({ authenticated: false, fetch });
		h.start();
		await h.loadSecrets();
		expect(h.runtime.accounts.getState()).toMatchObject({ accessVerified: false, blocked: false, library: { refreshState: 'error' } });
		expect(status(h).dataset.phase).toBe('access-unavailable');
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		expect(statusAction(h, 'login')).toBeNull();
		expect(h.host.start).not.toHaveBeenCalled();
		const requests = () => fetch.mock.calls.filter(([url]) => url === '/api/secrets').length;
		const before = requests();
		await h.runtime.otp.refresh();
		expect(requests()).toBe(before);
		next = deferred();
		const retry = statusAction(h, 'retry');
		retry.click();
		expect(retry.disabled).toBe(true);
		expect(status(h).dataset.phase).toBe('checking-access');
		expect(h.document.documentElement.getAttribute('data-app-theme-startup')).toBe('managed');
		retry.dispatchEvent(new h.window.MouseEvent('click'));
		await vi.waitFor(() => expect(requests()).toBe(before + 1));
		next.resolve(new Response('{}', { status: 503 }));
		await vi.waitFor(() => expect(status(h).dataset.phase).toBe('access-unavailable'));
		expect(h.host.start).not.toHaveBeenCalled();
		expect(statusAction(h, 'login')).toBeNull();
		next = deferred();
		statusAction(h, 'retry').click();
		await vi.waitFor(() => expect(requests()).toBe(before + 2));
		next.resolve(Response.json([record]));
		await vi.waitFor(() => expect(h.host.start).toHaveBeenCalledOnce());
		expect(h.runtime.accounts.getState().accessVerified).toBe(true);
		expect(status(h).dataset.phase).toBe('preparing');
		expect(h.host.retry).not.toHaveBeenCalled();
	});
	it('retains buttons and keyboard focus across OTP snapshots and restores the same action after a phase or language change', async () => {
		const h = await fixture();
		h.start();
		const recovery = statusAction(h, 'recovery');
		recovery.focus();
		for (const now of [60000, 61000, 62000]) {
			h.setClock(now);
			await h.runtime.otp.refresh();
			expect(statusAction(h, 'recovery')).toBe(recovery);
			expect(h.document.activeElement).toBe(recovery);
		}
		h.ports().onState({ status: 'attaching' });
		expect(h.document.activeElement).toBe(statusAction(h, 'recovery'));
		h.window.eval('setLanguage("zh-CN", {persist:false})');
		expect(status(h).textContent).toContain('加载中');
		expect(h.document.activeElement).toBe(statusAction(h, 'recovery'));
		const unrelated = h.document.getElementById('searchInput');
		unrelated.focus();
		h.ports().onState({ status: 'importing' });
		expect(h.document.activeElement).toBe(unrelated);
	});
	it('enters retry busy state synchronously so repeated clicks cannot start competing candidates', async () => {
		const h = await fixture();
		h.start();
		h.ports().onFallback({ reason: 'resources-unavailable' });
		const pending = deferred();
		h.host.retry.mockReturnValue(pending.promise);
		const retry = statusAction(h, 'retry');
		retry.focus();
		retry.click();
		expect(retry.disabled).toBe(true);
		expect(status(h).dataset.phase).toBe('preparing');
		expect(statusAction(h, 'retry')).toBeNull();
		expect(h.document.activeElement).toBe(statusAction(h, 'recovery'));
		retry.dispatchEvent(new h.window.MouseEvent('click'));
		expect(h.host.retry).toHaveBeenCalledOnce();
		h.ports().onFallback({ reason: 'resources-unavailable' });
		expect(statusAction(h, 'retry').disabled).toBe(true);
		statusAction(h, 'retry').dispatchEvent(new h.window.MouseEvent('click'));
		expect(h.host.retry).toHaveBeenCalledOnce();
		pending.resolve({ status: 'preparing' });
		await vi.waitFor(() => expect(statusAction(h, 'retry').disabled).toBe(false));
		h.ports().onState({ status: 'preparing' });
		retry.dispatchEvent(new h.window.MouseEvent('click'));
		expect(h.host.retry).toHaveBeenCalledOnce();
	});
	it('keeps running-with-reason visible and updates its facts without treating it as successful startup', async () => {
		const h = await fixture();
		h.start();
		h.running();
		expect(status(h).hidden).toBe(true);
		h.ports().onState({ status: 'running', reason: 'appearance-update-failed:offline' });
		expect(status(h).hidden).toBe(false);
		expect(status(h).getAttribute('aria-busy')).toBe('false');
		expect(statusAction(h, 'retry')).not.toBeNull();
		h.ports().onRunning({ status: 'running', reason: 'appearance-update-failed:offline', tuple: { appearanceRevision: 1 } });
		expect(status(h).hidden).toBe(false);
		const retry = statusAction(h, 'retry');
		retry.focus();
		h.ports().onState({ status: 'running', reason: 'appearance-update-failed:incomplete-cache' });
		expect(status(h).dataset.reason).toBe('appearance-update-failed:incomplete-cache');
		expect(h.document.activeElement).toBe(statusAction(h, 'retry'));
		h.ports().onState({ status: 'running', reason: null });
		h.running();
		expect(status(h).hidden).toBe(true);
	});
	it.each([false, true])('wires one host and canonical shell identity to the shared live core (full=%s)', async (full) => {
		const h = await fixture({ full });
		const original = h.window.__2FA_SHELL_CONFIG_ID__;
		h.start();
		h.start();
		expect(h.factory).toHaveBeenCalledOnce();
		expect(h.host.start).toHaveBeenCalledOnce();
		expect(h.ports().root).toBe(h.document.getElementById('appThemeRoot'));
		expect(h.ports().getSessionState()).toEqual(h.runtime.accounts.getState());
		expect(await h.ports().getShellConfigId(h.window.__2FA_APPEARANCE__)).toBe(original);
		const scope = h
			.ports()
			.createSdkScope({ identity: { hostBuild: buildId, sdkApiVersion: 1, packageId, appearanceRevision: 1 }, isCurrent: () => true });
		expect(scope.accounts).toBe(h.runtime.accounts);
		expect(scope.otp).toBe(h.runtime.otp);
		expect(scope.sdk.getSnapshot().library.accounts[0].accountLabel).toBe(record.account);
		expect(JSON.stringify(scope.sdk.getSnapshot())).not.toContain(record.secret);
		scope.dispose();
		expect(h.runtime.sdk.getSnapshot().library.accounts).toHaveLength(1);
	});
	it.each([{ safe: true }, { snapshot: null }])('does not create an app host in safe/official mode (%j)', async (options) => {
		const h = await fixture(options);
		h.start();
		expect(h.factory).not.toHaveBeenCalled();
		expect(h.document.getElementById('officialThemeRoot')).not.toBeNull();
		expect(h.document.getElementById('secretsList')).not.toBeNull();
	});
	it('keeps official accounts while preparing, then removes only official view nodes after confirmed running', async () => {
		const h = await fixture();
		const official = h.getOfficialAccountView();
		const card = h.document.querySelector('.secret-card');
		const queue = h.document.getElementById('offlineQueue');
		const hidden = h.document.getElementById('hiddenSecrets');
		const modal = h.document.getElementById('secretModal');
		expect(card).not.toBeNull();
		h.start();
		h.ports().onState({ status: 'preparing' });
		expect(h.document.querySelector('.secret-card')).toBe(card);
		expect(h.document.getElementById('officialThemeActions')).not.toBeNull();
		h.ports().onState({ status: 'mounting' });
		const root = h.document.getElementById('appThemeRoot');
		expect(root.hidden).toBe(false);
		expect(root.style.visibility).toBe('hidden');
		expect(root.style.pointerEvents).toBe('none');
		h.running();
		expect(await official.copy(record.id)).toEqual({ status: 'rejected', reason: 'mount-invalidated' });
		expect(h.document.querySelector('#officialThemeRoot,#officialThemeActions,#officialThemeFooter')).toBeNull();
		expect(h.document.getElementById('offlineQueue')).toBe(queue);
		expect(h.document.getElementById('hiddenSecrets')).toBe(hidden);
		expect(queue.parentElement.id).toBe('hostThemePanels');
		expect(hidden.parentElement.id).toBe('hostThemePanels');
		expect(h.document.getElementById('secretModal')).toBe(modal);
		expect(root.hidden).toBe(false);
		expect(root.style.cssText).toBe('');
		expect(status(h).hidden).toBe(true);
		expect(h.document.body.classList.contains('app-theme-running')).toBe(true);
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		h.running();
		expect(await official.copy(record.id)).toEqual({ status: 'rejected', reason: 'mount-invalidated' });
	});
	it('retains working official copy and retry controls when startup falls back before loading the app', async () => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		const h = await fixture({ clipboard });
		const official = h.getOfficialAccountView();
		const card = h.document.querySelector('.secret-card');
		h.start();
		h.ports().onState({ status: 'mounting' });
		h.ports().onFallback({ reason: 'resources-unavailable' });
		expect(h.document.querySelector('.secret-card')).toBe(card);
		expect(h.document.getElementById('appThemeRoot').hidden).toBe(true);
		expect(h.document.getElementById('appThemeRoot').style.cssText).toBe('');
		expect(status(h).hidden).toBe(false);
		await official.copy(record.id);
		expect(clipboard.writeText).toHaveBeenCalledWith('287082');
		button(h, 0).click();
		expect(h.host.retry).toHaveBeenCalledOnce();
	});
	it('reloads once by itself when a hard reload left the page outside the active worker', async () => {
		const h = await fixture();
		h.worker.getRegistration = async () => ({ active: { state: 'activated' } });
		const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
		h.start();
		h.ports().onFallback({ generation: 1, reason: 'no-controller' });
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		expect(status(h).dataset.phase).not.toBe('official-fallback');
		expect(h.host.retry).not.toHaveBeenCalled();
		// The worker still did not take over after that reload: show the usual fallback.
		h.ports().onFallback({ generation: 2, reason: 'no-controller' });
		await vi.waitFor(() => expect(status(h).dataset.phase).toBe('official-fallback'));
		expect(reload).toHaveBeenCalledOnce();
		expect(statusAction(h, 'retry')).not.toBeNull();
	});
	it('shows the fallback for an uncontrolled page while no worker is active yet', async () => {
		const h = await fixture();
		h.worker.getRegistration = async () => ({ installing: {} });
		const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
		h.start();
		h.ports().onFallback({ generation: 1, reason: 'no-controller' });
		await vi.waitFor(() => expect(status(h).dataset.phase).toBe('official-fallback'));
		expect(reload).not.toHaveBeenCalled();
	});
	describe('a page still controlled by a worker from before 2.0', () => {
		// The old worker ignores runtime messages; the waiting update answers like the real one.
		async function legacy({ othersOpen = false } = {}) {
			const h = await fixture({
				setupWindow: (window) => {
					window.MessageChannel = MessageChannel;
				},
			});
			const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
			const state = { othersOpen, activations: 0 };
			h.worker.controller = { postMessage() {} };
			const waiting = {
				postMessage(request, [port]) {
					if (request.type !== 'RUNTIME_ACTIVATE') {
						port.postMessage({ ok: true });
						return;
					}
					state.activations++;
					if (state.othersOpen) {
						port.postMessage({
							protocol: '2fa-runtime-v1',
							nonce: request.nonce,
							generation: request.generation,
							status: 'blocked',
							reason: 'other-pages-open',
						});
						return;
					}
					h.worker.controller = waiting;
					h.worker.dispatchEvent(new h.window.Event('controllerchange'));
				},
			};
			h.worker.getRegistration = async () => ({ active: {}, waiting });
			return { h, reload, state };
		}
		it('takes the waiting update by itself and reloads once', async () => {
			const { h, reload, state } = await legacy();
			h.start();
			h.ports().onFallback({ generation: 1, reason: 'worker-timeout' });
			await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
			expect(status(h).dataset.phase).not.toBe('official-fallback');
			expect(h.host.retry).not.toHaveBeenCalled();
			// The theme still did not start after that reload: show the usual fallback.
			h.ports().onFallback({ generation: 2, reason: 'worker-timeout' });
			await vi.waitFor(() => expect(status(h).dataset.phase).toBe('official-fallback'));
			expect(status(h).dataset.reason).toBe('worker-timeout');
			expect(state.activations).toBe(1);
			expect(reload).toHaveBeenCalledOnce();
		});
		it('asks to close the other pages, then takes the update on Retry', async () => {
			const { h, reload, state } = await legacy({ othersOpen: true });
			h.start();
			h.ports().onFallback({ generation: 1, reason: 'worker-timeout' });
			await vi.waitFor(() => expect(status(h).dataset.reason).toBe('other-pages-open'));
			expect(status(h).dataset.phase).toBe('official-fallback');
			expect(status(h).querySelector('.app-theme-status-message').textContent).toBe(h.window.eval("t('appearanceRuntimeOtherPages')"));
			expect(reload).not.toHaveBeenCalled();
			// Retry asks again while a page is still open.
			statusAction(h, 'retry').click();
			await vi.waitFor(() => expect(state.activations).toBe(2));
			await vi.waitFor(() => expect(status(h).dataset.reason).toBe('other-pages-open'));
			state.othersOpen = false;
			statusAction(h, 'retry').click();
			await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
			expect(h.host.retry).not.toHaveBeenCalled();
		});
		it('keeps the usual fallback and Retry when no update waits', async () => {
			const { h, state } = await legacy();
			h.worker.getRegistration = async () => ({ active: {} });
			h.start();
			h.ports().onFallback({ generation: 1, reason: 'worker-timeout' });
			await vi.waitFor(() => expect(status(h).dataset.phase).toBe('official-fallback'));
			expect(status(h).dataset.reason).toBe('worker-timeout');
			expect(status(h).querySelector('.app-theme-status-message').textContent).toBe(h.window.eval("t('appearanceRuntimeUnavailable')"));
			statusAction(h, 'retry').click();
			await vi.waitFor(() => expect(h.host.retry).toHaveBeenCalledOnce());
			expect(state.activations).toBe(0);
		});
	});
	it('uses a guarded user-requested navigation when the first worker is active but the page is uncontrolled', async () => {
		const h = await fixture();
		h.host.getState = () => ({ status: 'official-fallback', reason: 'no-controller' });
		h.worker.getRegistration = async () => ({ active: { state: 'activated' } });
		h.start();
		h.ports().onFallback();
		const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
		const write = h.beginWrite({ type: 'edit' });
		button(h, 0).click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(reload).not.toHaveBeenCalled();
		h.endWrite(write);
		button(h, 0).click();
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		expect(h.host.retry).not.toHaveBeenCalled();
	});
	it('keeps retained hidden-account panels reachable through actual host dialogs after official DOM removal', async () => {
		const h = await fixture();
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true, hidden: { count: 1, records: [] } });
		const hidden = h.document.getElementById('hiddenSecrets');
		h.start();
		h.running();
		const flow = h.runtime.sdk.host.open({ kind: 'hidden-accounts' });
		await vi.waitFor(() => expect(h.document.getElementById('themeHostStatusModal').classList.contains('show')).toBe(true));
		expect(hidden.parentElement.id).toBe('themeHostStatusBody');
		h.document.querySelector('#themeHostStatusModal > .modal-content > button').click();
		await flow.closed;
		await vi.waitFor(() => expect(hidden.parentElement.id).toBe('hostThemePanels'));
		expect(h.document.querySelector('.secret-card')).toBeNull();
	});
	it.each(['hidden-accounts', 'offline-queue'].flatMap((kind) => ['escape', 'backdrop', 'button'].map((action) => [kind, action])))(
		'dismisses the actual %s host panel with %s without changing queue or HOTP state',
		async (kind, action) => {
			const h = await fixture({
				extraSource: `
        initModalDismissal();
        window.__panelMessages=[];
        window.__panelQueue={authRequired:false,operations:[{id:'pending-test',type:'update',name:'Synthetic queued update',timestamp:1,status:'failed',editable:true}]};
        requestOfflineQueueMessage=async type=>{window.__panelMessages.push(type);return window.__panelQueue;};
        applyOfflineQueueSummary(window.__panelQueue);
        window.__readPanelQueue=()=>getOfflineQueueSnapshot();
      `,
			});
			h.replaceSecretRecords([record, { ...record, id: 'hotp-panel', type: 'HOTP', counter: 11 }], {
				source: 'server',
				accessVerified: true,
				hidden: { count: 1, records: [] },
			});
			h.start();
			h.running();
			const trigger = h.document.createElement('button');
			trigger.textContent = 'Open panel';
			h.document.getElementById('appThemeRoot').append(trigger);
			trigger.focus();
			const focus = vi.spyOn(trigger, 'focus');
			const panel = h.document.getElementById(kind === 'hidden-accounts' ? 'hiddenSecrets' : 'offlineQueue');
			const oldParent = panel.parentNode,
				oldNext = panel.nextSibling;
			const queueBefore = h.window.__readPanelQueue();
			const flow = h.runtime.sdk.host.open({ kind }, { returnFocus: trigger });
			await vi.waitFor(() => expect(h.document.getElementById('themeHostStatusModal').classList.contains('show')).toBe(true));
			const modal = h.document.getElementById('themeHostStatusModal');
			expect(modal.dataset.dialogKind).toBe('passive');
			expect(panel.parentElement.id).toBe('themeHostStatusBody');
			if (action === 'escape') {
				h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			} else if (action === 'backdrop') {
				modal.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
				modal.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
			} else {
				modal.querySelector('[data-dialog-dismiss]').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			}
			expect(await flow.closed).toEqual({ status: 'closed' });
			expect(modal.style.display).toBe('none');
			expect(panel.parentNode).toBe(oldParent);
			expect(panel.nextSibling).toBe(oldNext);
			expect(h.document.activeElement).toBe(trigger);
			expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
			expect(h.window.__readPanelQueue()).toEqual(queueBefore);
			expect(h.runtime.accounts.getRecord('hotp-panel').counter).toBe(11);
			expect(h.window.__panelMessages.every((type) => type === 'OFFLINE_QUEUE_STATUS')).toBe(true);
			expect(h.document.body.style.position).toBe('');
		},
	);
	it('does not move a visible host panel out of its dialog when the app becomes ready', async () => {
		const h = await fixture();
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true, hidden: { count: 1, records: [] } });
		h.start();
		const flow = h.runtime.sdk.host.open({ kind: 'hidden-accounts' });
		await vi.waitFor(() => expect(h.document.getElementById('themeHostStatusModal').classList.contains('show')).toBe(true));
		const hidden = h.document.getElementById('hiddenSecrets');
		expect(hidden.parentElement.id).toBe('themeHostStatusBody');
		h.running();
		expect(hidden.parentElement.id).toBe('themeHostStatusBody');
		h.document.querySelector('#themeHostStatusModal > .modal-content > button').click();
		await flow.closed;
		await vi.waitFor(() => expect(hidden.parentElement.id).toBe('hostThemePanels'));
	});
	it('keeps recovery buttons after startup and routes safe navigation through the existing write guard', async () => {
		const h = await fixture();
		h.start();
		h.running();
		h.ports().onRecoveryRequired({ reason: 'app-failed' });
		expect(status(h).hidden).toBe(false);
		expect(h.document.getElementById('officialThemeRoot')).toBeNull();
		const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
		const write = h.beginWrite({ type: 'edit', accountId: record.id });
		button(h, 1).click();
		await Promise.resolve();
		expect(assign).not.toHaveBeenCalled();
		h.endWrite(write);
		button(h, 1).click();
		await Promise.resolve();
		expect(assign).toHaveBeenCalledWith('https://vault.test/?safeMode=1');
	});
	it.each([false, true])(
		'keeps host HOTP reconciliation reachable after removal without repeating effects (navigation pending=%s)',
		async (navigationPending) => {
			const pending = deferred();
			const clipboard = { writeText: vi.fn(() => pending.promise) };
			let saved = { ...record, type: 'HOTP', counter: 0 };
			const fetch = vi.fn(async (url, options = {}) => {
				if (url === '/api/secrets/totp/counter' && options.method === 'POST') {
					saved = { ...saved, counter: saved.counter + 1 };
					return Response.json({ data: { secret: saved } });
				}
				if (url === '/api/secrets') {
					return Response.json([saved]);
				}
				if (url === '/api/settings') {
					return Response.json({ language: 'en' });
				}
				return new Response('{}', { status: 503 });
			});
			const h = await fixture({ clipboard, fetch });
			h.replaceSecretRecords([saved], { source: 'server', accessVerified: true });
			await h.runtime.otp.refresh();
			h.start();
			h.running();
			const copying = h.runtime.sdk.otp.copy(h.runtime.sdk.otp.readCopyTarget(record.id).target);
			await vi.waitFor(() => expect(h.runtime.sdk.getSnapshot().host.operations[0]?.reservation).toBe('confirmed'));
			if (navigationPending) {
				h.window.applyAppearance(appearance(2, { packageId: 'c'.repeat(64) }));
			}
			h.ports().onRecoveryRequired({ reason: 'theme-stopped' });
			expect(labeledButton(h, 'appearanceUseDefault')).toBeDefined();
			expect(labeledButton(h, 'coreHotpReconcile')).toBeDefined();
			expect(h.document.querySelector('#officialThemeRoot')).toBeNull();
			const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
			h.window.confirm = vi.fn(() => true);
			const check = labeledButton(h, 'coreHotpReconcile');
			check.focus();
			h.setClock(61000);
			await h.runtime.otp.refresh();
			expect(labeledButton(h, 'coreHotpReconcile')).toBe(check);
			expect(h.document.activeElement).toBe(check);
			labeledButton(h, 'appearanceUseDefault').click();
			await Promise.resolve();
			expect(assign).not.toHaveBeenCalled();
			labeledButton(h, 'coreHotpReconcile').click();
			await vi.waitFor(() => expect(h.runtime.sdk.getSnapshot().host.operations[0]?.reconciliation).toBe('succeeded'));
			const reconciled = labeledButton(h, 'coreHotpReconcile');
			expect(reconciled).not.toBe(check);
			expect(h.document.activeElement).toBe(reconciled);
			labeledButton(h, 'appearanceUseDefault').click();
			await Promise.resolve();
			expect(assign).toHaveBeenCalledWith('https://vault.test/?safeMode=1');
			expect(clipboard.writeText).toHaveBeenCalledOnce();
			expect(fetch.mock.calls.filter(([url]) => url.endsWith('/counter'))).toHaveLength(1);
			pending.resolve();
			await copying;
		},
	);
	it('updates same-package configuration only on running confirmation and offers guarded reload for other packages', async () => {
		const h = await fixture();
		h.start();
		h.running();
		const next = appearance(2);
		await h.window.updateAppThemeAppearance(next);
		expect(h.host.updateAppearance).toHaveBeenCalledWith(next);
		expect(h.window.__2FA_APPEARANCE__.revision).toBe(1);
		h.running(2);
		expect(h.window.__2FA_APPEARANCE__).toBe(next);
		const different = appearance(3, { packageId: 'c'.repeat(64) });
		const result = h.window.applyAppearance(different);
		expect(result.status).toBe('reload-required');
		expect(h.host.updateAppearance).toHaveBeenCalledTimes(1);
		expect(h.window.__2FA_PENDING_APPEARANCE__).toBe(different);
		expect(h.window.__2FA_APPEARANCE__).toBe(next);
		const reload = vi.spyOn(h.window.location, 'reload').mockImplementation(() => {});
		const write = h.beginWrite({ type: 'edit' });
		button(h, 0).click();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(reload).not.toHaveBeenCalled();
		h.endWrite(write);
		button(h, 0).click();
		// The refresh first checks for a waiting app update to take along.
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
	});
	it('keeps the newest shell identity if an older hash completes late', async () => {
		const h = await fixture();
		h.start();
		const old = deferred();
		const next = deferred();
		h.window.computeAppShellConfigId = vi.fn((snapshot) => (snapshot.revision === 1 ? old.promise : next.promise));
		h.running();
		await h.window.updateAppThemeAppearance(appearance(2));
		h.running(2);
		next.resolve('2'.repeat(64));
		await Promise.resolve();
		expect(h.window.__2FA_SHELL_CONFIG_ID__).toBe('2'.repeat(64));
		old.resolve('1'.repeat(64));
		await Promise.resolve();
		expect(h.window.__2FA_SHELL_CONFIG_ID__).toBe('2'.repeat(64));
	});
	it('does not start a second candidate when the SDK changes while a configuration update is pending', async () => {
		const h = await fixture();
		h.start();
		h.running();
		const pending = deferred();
		h.host.updateAppearance.mockImplementation(() => pending.promise);
		const next = appearance(2);
		const updating = h.window.updateAppThemeAppearance(next);
		expect(h.host.updateAppearance).toHaveBeenCalledExactlyOnceWith(next);
		h.runtime.sdk.view.setQuery('Google');
		expect(h.host.start).toHaveBeenCalledOnce();
		pending.resolve({ status: 'running' });
		await updating;
	});
	it('gates automatic startup on authentication, forwards session state and retries when the controller changes', async () => {
		const h = await fixture({ authenticated: false });
		h.start();
		expect(h.host.start).not.toHaveBeenCalled();
		const listener = vi.fn();
		const unsubscribe = h.ports().subscribeSession(listener);
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
		expect(h.host.start).toHaveBeenCalledOnce();
		h.runtime.sdk.view.setQuery('google');
		expect(h.host.start).toHaveBeenCalledOnce();
		h.invalidateSecretSession();
		expect(h.ports().getSessionState().accessVerified).toBe(false);
		expect(listener).toHaveBeenCalled();
		const before = h.host.start.mock.calls.length;
		h.worker.dispatchEvent(new h.window.Event('controllerchange'));
		expect(h.host.start).toHaveBeenCalledTimes(before);
		button(h, 0).click();
		expect(h.host.retry).not.toHaveBeenCalled();
		expect(h.document.getElementById('loginModal').style.display).toBe('flex');
		h.invalidateSecretSession({ blocked: false });
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
		expect(h.host.start).toHaveBeenCalledTimes(before + 1);
		h.worker.dispatchEvent(new h.window.Event('controllerchange'));
		expect(h.host.start).toHaveBeenCalledTimes(before + 2);
		unsubscribe();
	});
	it('ignores stale generation fallback and recovery events after a newer theme confirms running', async () => {
		const h = await fixture();
		h.start();
		h.ports().onState({ status: 'importing', generation: 1, entryStarted: true });
		await h.window.updateAppThemeAppearance(appearance(2));
		h.ports().onState({ status: 'preparing', generation: 2, entryStarted: false });
		h.ports().onRunning({
			status: 'running',
			generation: 2,
			entryStarted: true,
			tuple: { hostBuild: buildId, sdkApiVersion: 1, packageId, appearanceRevision: 2, mode: 'app' },
		});
		for (const callback of [h.ports().onFallback, h.ports().onRecoveryRequired]) {
			callback({ generation: 1, reason: 'obsolete timeout', entryStarted: true });
		}
		expect(status(h).hidden).toBe(true);
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		expect(h.document.getElementById('appThemeRoot').hidden).toBe(false);
		expect(h.document.getElementById('officialThemeRoot')).toBeNull();
	});
	it('cannot replace a newer running presentation with a late retry rejection', async () => {
		const h = await fixture();
		h.start();
		h.ports().onFallback({ generation: 1, reason: 'resources-unavailable' });
		let reject;
		h.host.retry.mockReturnValue(
			new Promise((_, no) => {
				reject = no;
			}),
		);
		statusAction(h, 'retry').click();
		h.ports().onState({ status: 'preparing', generation: 2 });
		h.ports().onRunning({
			status: 'running',
			generation: 2,
			entryStarted: true,
			tuple: { hostBuild: buildId, sdkApiVersion: 1, packageId, appearanceRevision: 1, mode: 'app' },
		});
		reject(new Error('obsolete retry failure'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(status(h).hidden).toBe(true);
		expect(status(h).dataset.reason).toBe('');
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
	});
	it('keeps a running theme visible while a same-package update prepares and fails', async () => {
		const h = await fixture();
		h.start();
		h.running();
		const root = h.document.getElementById('appThemeRoot');
		const retained = h.document.createElement('button');
		retained.textContent = 'Retained running view';
		root.append(retained);
		await h.window.updateAppThemeAppearance(appearance(2));
		h.ports().onState({ status: 'preparing', generation: 2 });
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		expect(root.hidden).toBe(false);
		h.ports().onState({ status: 'running', reason: 'appearance-update-failed:offline', generation: 2, entryStarted: true });
		expect(root.firstElementChild).toBe(retained);
		expect(root.hidden).toBe(false);
		expect(h.document.getElementById('officialThemeRoot')).toBeNull();
	});
	it('does not replace theme-owned focus when a running status disappears', async () => {
		const h = await fixture();
		h.start();
		h.running();
		const root = h.document.getElementById('appThemeRoot');
		const entry = h.document.createElement('button');
		entry.textContent = 'Theme entry';
		root.append(entry);
		h.ports().onState({ status: 'running', reason: 'appearance-update-failed:offline' });
		entry.focus();
		const focus = vi.spyOn(root, 'focus');
		h.ports().onState({ status: 'running', reason: null });
		expect(status(h).hidden).toBe(true);
		expect(h.document.activeElement).toBe(entry);
		expect(focus).not.toHaveBeenCalled();
	});
	it('preserves BFCache presentation, restarts on persisted pageshow, and disposes listeners on a real navigation', async () => {
		const h = await fixture();
		h.start();
		expect(h.host.start).toHaveBeenCalledOnce();
		h.running();
		transition(h.window, 'pagehide', true);
		expect(h.host.dispose).not.toHaveBeenCalled();
		transition(h.window, 'pageshow', true);
		expect(h.host.start).toHaveBeenCalledTimes(2);
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		expect(h.document.getElementById('officialThemeRoot')).toBeNull();
		expect(h.document.getElementById('appThemeRoot').hidden).toBe(false);
		transition(h.window, 'pagehide', false);
		expect(h.host.dispose).toHaveBeenCalledOnce();
		h.worker.dispatchEvent(new h.window.Event('controllerchange'));
		expect(h.host.start).toHaveBeenCalledTimes(2);
		h.ports().onFallback({ reason: 'late disposed callback' });
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
	});
});

describe('theme route after a theme change', () => {
	const KEY = '2fa-theme-route-owner';
	async function load({ hash, owner, ...options }) {
		const h = await fixture({
			...options,
			setupWindow: (window) => {
				window.history.replaceState(null, '', '/?lang=en' + hash);
				if (owner) {
					window.sessionStorage.setItem(KEY, owner);
				}
			},
		});
		h.start();
		return h;
	}
	it('drops the previous theme route when another app theme loads', async () => {
		const h = await load({ hash: '#/theme/cyberpunk/more', owner: 'app:cyberpunk-for-2fa' });
		expect(h.window.location.hash).toBe('');
		expect(h.window.location.search).toBe('?lang=en');
		expect(h.window.sessionStorage.getItem(KEY)).toBe('app:integration');
	});
	it('keeps the route when the same theme reloads', async () => {
		const h = await load({ hash: '#/theme/integration/more', owner: 'app:integration' });
		expect(h.window.location.hash).toBe('#/theme/integration/more');
	});
	it('keeps the route of a tab that has not recorded an owner yet', async () => {
		const h = await load({ hash: '#/theme/integration/more' });
		expect(h.window.location.hash).toBe('#/theme/integration/more');
		expect(h.window.sessionStorage.getItem(KEY)).toBe('app:integration');
	});
	it('drops a theme route when the default view loads', async () => {
		const h = await load({ hash: '#/theme/journal/more', owner: 'app:journal-for-2fa', snapshot: null });
		expect(h.window.location.hash).toBe('');
		expect(h.window.sessionStorage.getItem(KEY)).toBe('official');
	});
	it('leaves other hashes and safe mode alone', async () => {
		const other = await load({ hash: '#section', owner: 'app:cyberpunk-for-2fa' });
		expect(other.window.location.hash).toBe('#section');
		const safe = await load({ hash: '#/theme/cyberpunk/more', owner: 'app:cyberpunk-for-2fa', safe: true });
		expect(safe.window.location.hash).toBe('#/theme/cyberpunk/more');
		expect(safe.window.sessionStorage.getItem(KEY)).toBe('app:cyberpunk-for-2fa');
	});
});
