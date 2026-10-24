import { afterEach, describe, expect, it, vi } from 'vitest';
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

// These tests exercise the real page, emitted integration, account store, SDK and
// host dialogs. Only the independently tested app-host factory is an explicit port.
describe('official shell and full-theme integration', () => {
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
			expect(labeledButton(h, 'appearanceSafeMode')).toBeDefined();
			expect(labeledButton(h, 'coreHotpReconcile')).toBeDefined();
			expect(h.document.querySelector('#officialThemeRoot')).toBeNull();
			const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
			h.window.confirm = vi.fn(() => true);
			labeledButton(h, 'appearanceSafeMode').click();
			await Promise.resolve();
			expect(assign).not.toHaveBeenCalled();
			labeledButton(h, 'coreHotpReconcile').click();
			await vi.waitFor(() => expect(h.runtime.sdk.getSnapshot().host.operations[0]?.reconciliation).toBe('succeeded'));
			labeledButton(h, 'appearanceSafeMode').click();
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
		await Promise.resolve();
		expect(reload).not.toHaveBeenCalled();
		h.endWrite(write);
		button(h, 0).click();
		await Promise.resolve();
		expect(reload).toHaveBeenCalledOnce();
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
	it('preserves BFCache state, restarts on persisted pageshow, and disposes listeners on a real navigation', async () => {
		const h = await fixture();
		h.start();
		expect(h.host.start).toHaveBeenCalledOnce();
		transition(h.window, 'pagehide', true);
		expect(h.host.dispose).not.toHaveBeenCalled();
		transition(h.window, 'pageshow', true);
		expect(h.host.start).toHaveBeenCalledTimes(2);
		transition(h.window, 'pagehide', false);
		expect(h.host.dispose).toHaveBeenCalledOnce();
		h.worker.dispatchEvent(new h.window.Event('controllerchange'));
		expect(h.host.start).toHaveBeenCalledTimes(2);
	});
});
