import { describe, expect, it, vi } from 'vitest';
import { getPWACode } from '../../src/ui/scripts/pwa.js';

function fixture(mode = 'official') {
	const source = getPWACode();
	const emitted = source.slice(source.indexOf('    function getCurrentRuntimeTuple'), source.indexOf('    let offlineQueueOperations'));
	const window = Object.assign(new EventTarget(), {
		location: { search: mode === 'safe' ? '?safeMode=1' : '', reload: vi.fn() },
		__2FA_BUILD_ID__: 'a'.repeat(64),
		__2FA_SHELL_CONFIG_ID__: 'b'.repeat(64),
		__2FA_RECOVERY_CONFIG_ID__: 'c'.repeat(64),
		__2FA_APPEARANCE__: { kind: mode === 'app' ? 'app' : 'declarative', revision: 1, packageId: 'd'.repeat(64) },
		twofaRuntimeTransport: {
			prepare: vi.fn(async () => ({ status: 'ready' })),
			attach: vi.fn(async () => ({ status: 'ready' })),
			startup: vi.fn(async () => ({ status: 'ready' })),
		},
	});
	const navigator = { serviceWorker: { controller: { postMessage: vi.fn() } }, onLine: true };
	const values = new Map();
	const sessionStorage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
	const tasks = [];
	const operations = { busy: false };
	const accountStore = { getOperationState: () => operations };
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'window',
		'navigator',
		'sessionStorage',
		'setTimeout',
		'accountStore',
		'CustomEvent',
		emitted + ';return {prepareCurrentRuntime,preparePublicRecovery,maybeControlFirstRuntime,publishAppearanceSnapshot};',
	)(window, navigator, sessionStorage, (callback) => tasks.push(callback), accountStore, CustomEvent);
	return { window, navigator, api, tasks, operations, transport: window.twofaRuntimeTransport };
}

function fullAppFixture() {
	const source = getPWACode();
	const listeners = new Map();
	const workerListeners = new Map();
	const on = (target) => (type, listener) => {
		target.set(type, [...(target.get(type) || []), listener]);
	};
	const transport = { prepare: vi.fn(async () => ({ status: 'ready', tuple: { mode: 'safe' } })), attach: vi.fn(), startup: vi.fn() };
	const registration = { active: {}, addEventListener: vi.fn(), update: vi.fn(async () => {}) };
	const serviceWorker = {
		controller: { postMessage: vi.fn() },
		ready: Promise.resolve(registration),
		register: vi.fn(async () => registration),
		getRegistration: vi.fn(async () => registration),
		addEventListener: on(workerListeners),
	};
	const navigator = { serviceWorker, onLine: true };
	const window = {
		location: { search: '', reload: vi.fn() },
		navigator,
		__2FA_BUILD_ID__: 'a'.repeat(64),
		__2FA_SHELL_CONFIG_ID__: 'b'.repeat(64),
		__2FA_RECOVERY_CONFIG_ID__: 'c'.repeat(64),
		__2FA_APPEARANCE__: { kind: 'app', revision: 1, packageId: 'd'.repeat(64) },
		twofaRuntimeTransport: transport,
		addEventListener: on(listeners),
		dispatchEvent: vi.fn(),
		matchMedia: () => ({ matches: false }),
	};
	const document = { body: { classList: { remove: vi.fn() } }, getElementById: () => null, addEventListener: vi.fn() };
	// Execute the actual emitted load/online/controller/apply handlers. Queue
	// and toast effects are unrelated ports and never issue network requests.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'window',
		'navigator',
		'document',
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'CustomEvent',
		'console',
		'getLanguage',
		'showCenterToast',
		't',
		source.slice(source.indexOf('    function getCurrentRuntimeTuple')) +
			';requestPendingOperationSync=()=>{};refreshOfflineQueue=async()=>{};drainOfflineQueueResume=async()=>{};revalidateSecretsFromServer=()=>{};return {preparePublicRecovery};',
	)(
		window,
		navigator,
		document,
		() => 1,
		() => {},
		() => 1,
		CustomEvent,
		{ log() {}, warn() {} },
		() => 'en',
		() => {},
		(key) => key,
	);
	return {
		window,
		navigator,
		transport,
		api,
		message: async (data, source = serviceWorker.controller) => {
			await Promise.all((workerListeners.get('message') || []).map((listener) => listener({ data, source })));
			for (let i = 0; i < 6; i++) {
				await Promise.resolve();
			}
		},
		emit: async (type) => {
			const target = type === 'controllerchange' ? workerListeners : listeners;
			await Promise.all((target.get(type) || []).map((listener) => listener(new CustomEvent(type, { detail: window.__2FA_APPEARANCE__ }))));
		},
	};
}

describe('stored page that the server has replaced', () => {
	it('reloads when its worker reports a newer server page', async () => {
		const h = fullAppFixture();
		await h.message({ type: 'SHELL_STALE' });
		expect(h.window.location.reload).toHaveBeenCalledOnce();
	});
	it('ignores the report from a worker that does not control the page', async () => {
		const h = fullAppFixture();
		await h.message({ type: 'SHELL_STALE' }, { postMessage() {} });
		expect(h.window.location.reload).not.toHaveBeenCalled();
	});
	it('reloads through the theme runtime and shows the refresh prompt when that is blocked', async () => {
		const reload = vi.fn(async () => ({ status: 'rejected', reason: 'unsaved-or-pending' }));
		vi.stubGlobal('reloadForSavedAppearance', reload);
		try {
			const h = fullAppFixture();
			await h.message({ type: 'SHELL_STALE' });
			expect(reload).toHaveBeenCalledOnce();
			expect(h.window.location.reload).not.toHaveBeenCalled();
			expect(h.window.dispatchEvent.mock.calls.map(([event]) => event.type)).toContain('appearance-navigation-required');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('preparing a saved appearance before the reload', () => {
	function preparing(answers) {
		const h = fixture('app');
		h.window.computeAppShellConfigId = async () => 'e'.repeat(64);
		h.transport.controllerAnswers = vi.fn(async () => answers);
		return h;
	}
	it('does not wait for a worker from before 2.0 while an update waits to replace it', async () => {
		const h = preparing(false);
		h.navigator.serviceWorker.getRegistration = async () => ({ active: {}, waiting: {} });
		expect(await h.window.prepareAppearanceRuntime(h.window.__2FA_APPEARANCE__)).toEqual({ status: 'blocked', reason: 'legacy-worker' });
		expect(h.transport.prepare).not.toHaveBeenCalled();
	});
	it('prepares through a worker that answers, and asks only while an update waits', async () => {
		const h = preparing(true);
		h.navigator.serviceWorker.getRegistration = async () => ({ active: {}, waiting: {} });
		expect((await h.window.prepareAppearanceRuntime(h.window.__2FA_APPEARANCE__)).status).toBe('ready');
		expect(h.transport.prepare).toHaveBeenCalledWith(expect.objectContaining({ mode: 'app' }), { expectedShellConfigId: 'e'.repeat(64) });
		h.navigator.serviceWorker.getRegistration = async () => ({ active: {} });
		h.transport.controllerAnswers.mockClear();
		expect((await h.window.prepareAppearanceRuntime(h.window.__2FA_APPEARANCE__)).status).toBe('ready');
		expect(h.transport.controllerAnswers).not.toHaveBeenCalled();
		expect(h.transport.prepare).toHaveBeenCalledTimes(2);
	});
});

describe('emitted PWA runtime startup', () => {
	it('publishes worker preparation progress without treating it as an execution permit', () => {
		const h = fixture();
		const source = getPWACode();
		const notify = vi.fn();
		const events = [];
		h.window.addEventListener('runtime-offline-state', (event) => events.push(event.detail));
		// eslint-disable-next-line no-new-func
		const handle = new Function(
			'window',
			'CustomEvent',
			'notifyThemeRuntimeEnvironment',
			source.slice(source.indexOf('    function handleServiceWorkerMessage'), source.indexOf('    let deferredPrompt')) +
				';return handleServiceWorkerMessage;',
		)(h.window, CustomEvent, notify);
		handle({ type: 'RUNTIME_STATUS_CHANGED', state: 'preparing', tuple: { mode: 'app' } });
		expect(events).toEqual([{ status: 'preparing', tuple: { mode: 'app' } }]);
		expect(notify).toHaveBeenCalledWith('offline-readiness');
		expect(h.transport.attach).not.toHaveBeenCalled();
	});
	it('prepares recovery then attaches and records the official page startup', async () => {
		const h = fixture();
		expect((await h.api.prepareCurrentRuntime()).status).toBe('ready');
		expect(h.transport.prepare.mock.calls.map((call) => call[0].mode)).toEqual(['safe', 'official']);
		expect(h.transport.attach).toHaveBeenCalledTimes(1);
		expect(h.transport.attach.mock.calls[0][0].mode).toBe('official');
		expect(h.transport.startup).toHaveBeenCalledTimes(1);
	});
	it('never lets background app preparation or recovery prefetch replace the app host pin', async () => {
		const h = fixture('app');
		expect(await h.api.prepareCurrentRuntime()).toBeUndefined();
		expect(h.transport.prepare.mock.calls.map((call) => call[0].mode)).toEqual(['safe']);
		expect(h.transport.attach).not.toHaveBeenCalled();
		expect(h.transport.startup).not.toHaveBeenCalled();
	});
	it.each(['ready', 'blocked'])('does not publish a late safe %s result as app readiness', async (status) => {
		const h = fixture('app');
		let release;
		h.transport.prepare.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const events = [];
		h.window.addEventListener('runtime-offline-state', (event) => events.push(event.detail));
		const pending = h.api.prepareCurrentRuntime();
		expect(h.transport.prepare).toHaveBeenCalledOnce();
		release({ status, tuple: { mode: 'safe' } });
		expect(await pending).toBeUndefined();
		expect(events).toEqual([]);
		expect(h.transport.prepare).toHaveBeenCalledOnce();
		expect(h.transport.attach).not.toHaveBeenCalled();
	});
	it('keeps compatibility pins and immediate public recovery on appearance-applied without preparing app twice', async () => {
		const h = fixture('app');
		h.window.dispatchEvent(new CustomEvent('appearance-applied', { detail: h.window.__2FA_APPEARANCE__ }));
		await h.api.preparePublicRecovery();
		expect(h.navigator.serviceWorker.controller.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'APP_BUILD_PIN' }));
		expect(h.transport.prepare.mock.calls.map((call) => call[0].mode)).toEqual(['safe']);
		expect(h.transport.attach).not.toHaveBeenCalled();
	});
	it.each(['load', 'online', 'controllerchange', 'appearance-applied'])(
		'prepares only safe recovery from the actual app %s handler',
		async (type) => {
			const h = fullAppFixture();
			if (type === 'controllerchange') {
				await h.emit('load');
				await h.api.preparePublicRecovery();
				h.transport.prepare.mockClear();
				h.navigator.serviceWorker.controller.postMessage.mockClear();
			}
			await h.emit(type);
			await h.api.preparePublicRecovery();
			expect(h.transport.prepare).toHaveBeenCalled();
			expect(h.transport.prepare.mock.calls.every(([tuple]) => tuple.mode === 'safe')).toBe(true);
			expect(h.transport.attach).not.toHaveBeenCalled();
			expect(h.transport.startup).not.toHaveBeenCalled();
			expect(h.navigator.serviceWorker.controller.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'APP_BUILD_PIN' }));
			expect(h.window.dispatchEvent.mock.calls.filter(([event]) => event.type === 'runtime-offline-state')).toEqual([]);
		},
	);
	it('attaches the public recovery identity only in a safe page', async () => {
		const h = fixture('safe');
		await h.api.prepareCurrentRuntime();
		expect(h.transport.attach).toHaveBeenCalledWith(expect.objectContaining({ mode: 'safe', packageId: null, appearanceRevision: 0 }), {
			expectedShellConfigId: 'c'.repeat(64),
		});
		expect(h.transport.startup).toHaveBeenCalledTimes(1);
	});
	it('cannot attach a stale official appearance that changed while preparing', async () => {
		const h = fixture();
		let release;
		h.transport.prepare.mockImplementation(async (tuple) =>
			tuple.mode === 'safe'
				? { status: 'ready' }
				: new Promise((resolve) => {
						release = resolve;
					}),
		);
		const pending = h.api.prepareCurrentRuntime();
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		h.window.__2FA_APPEARANCE__ = { kind: 'app', revision: 2, packageId: 'e'.repeat(64) };
		release({ status: 'ready' });
		await pending;
		expect(h.transport.attach).not.toHaveBeenCalled();
	});
	it('reloads an initially uncontrolled app at most once after an active worker exists', () => {
		const h = fixture('app');
		h.navigator.serviceWorker.controller = null;
		h.api.maybeControlFirstRuntime({ active: {} });
		h.api.maybeControlFirstRuntime({ active: {} });
		h.tasks.forEach((run) => run());
		expect(h.window.location.reload).toHaveBeenCalledTimes(1);
	});
	it.each(['pending', 'dirty', 'controller'])('does not reload when %s blocks the first-control transition', (reason) => {
		const h = fixture('app');
		h.navigator.serviceWorker.controller = null;
		h.api.maybeControlFirstRuntime({ active: {} });
		if (reason === 'pending') {
			h.operations.busy = true;
		}
		if (reason === 'dirty') {
			h.window.__2FA_REFRESH_BLOCKED__ = () => true;
		}
		if (reason === 'controller') {
			h.navigator.serviceWorker.controller = {};
		}
		h.tasks.forEach((run) => run());
		expect(h.window.location.reload).not.toHaveBeenCalled();
	});
});

describe('preparing a saved appearance before the reload', () => {
	it('prepares the saved appearance, not the running one, with its own shell identity', async () => {
		const h = fixture('app');
		h.window.computeAppShellConfigId = vi.fn(async () => 'e'.repeat(64));
		const saved = { kind: 'app', revision: 7, packageId: 'f'.repeat(64) };
		await h.window.prepareAppearanceRuntime(saved);
		expect(h.window.computeAppShellConfigId).toHaveBeenCalledWith(saved);
		expect(h.transport.prepare).toHaveBeenCalledWith(
			{ hostBuild: 'a'.repeat(64), sdkApiVersion: 1, packageId: 'f'.repeat(64), appearanceRevision: 7, mode: 'app' },
			{ expectedShellConfigId: 'e'.repeat(64) },
		);
	});
	it('prepares the official interface without a package', async () => {
		const h = fixture('app');
		h.window.computeAppShellConfigId = vi.fn(async () => 'e'.repeat(64));
		await h.window.prepareAppearanceRuntime({ kind: 'declarative', revision: 8, packageId: 'g' });
		expect(h.transport.prepare.mock.calls[0][0]).toMatchObject({ packageId: null, appearanceRevision: 8, mode: 'official' });
	});
	it('reports nothing to prepare without a controlling worker', async () => {
		const h = fixture('app');
		h.window.computeAppShellConfigId = vi.fn(async () => 'e'.repeat(64));
		h.navigator.serviceWorker.controller = null;
		expect(await h.window.prepareAppearanceRuntime({ kind: 'app', revision: 7, packageId: 'f'.repeat(64) })).toBeNull();
		expect(h.transport.prepare).not.toHaveBeenCalled();
	});
});
