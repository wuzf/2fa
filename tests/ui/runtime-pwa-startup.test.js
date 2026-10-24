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
		await h.api.prepareCurrentRuntime();
		expect(h.transport.prepare.mock.calls.map((call) => call[0].mode)).toEqual(['safe', 'app']);
		expect(h.transport.attach).not.toHaveBeenCalled();
		expect(h.transport.startup).not.toHaveBeenCalled();
	});
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
