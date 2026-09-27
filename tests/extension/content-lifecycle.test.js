// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGE } from '../../extension/src/shared/protocol.js';
import { waitForOtpTarget } from '../../extension/src/content/form.js';
import { createContentController, createRuntimeMessageListener } from '../../extension/src/content/index.js';

const NONCE = '0123456789abcdef0123456789abcdef0123';
const NEXT_NONCE = '1123456789abcdef0123456789abcdef0123';
const controllers = [];
let observers;

function appendOtpInput() {
	const input = document.createElement('input');
	input.autocomplete = 'one-time-code';
	input.maxLength = 6;
	Object.defineProperty(input, 'getClientRects', {
		value: () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }],
	});
	document.body.append(input);
	return input;
}

function createController(options = {}) {
	const controller = createContentController({
		doc: document,
		now: () => Date.now(),
		monotonicNow: () => Date.now(),
		detectionTimeoutMs: 2000,
		...options,
	});
	controllers.push(controller);
	return controller;
}

function prepare(controller, nonce = NONCE) {
	return controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce, expectedDigits: 6 });
}

function fill(controller, nonce = NONCE) {
	return controller.handle({ type: MESSAGE.FILL_CODE, nonce, code: '012345', expiresAt: Date.now() + 10000 });
}

function trackListeners(target) {
	return {
		add: vi.spyOn(target, 'addEventListener'),
		remove: vi.spyOn(target, 'removeEventListener'),
	};
}

function expectListenersRemoved(tracker, types) {
	const capture = (options) => (typeof options === 'boolean' ? options : Boolean(options?.capture));
	for (const type of types) {
		const added = tracker.add.mock.calls.filter(([event]) => event === type);
		expect(added.length, `registered ${type}`).toBeGreaterThan(0);
		for (const [, callback, options] of added) {
			expect(
				tracker.remove.mock.calls.some(
					([event, removed, removedOptions]) => event === type && removed === callback && capture(removedOptions) === capture(options),
				),
				`removed the registered ${type} listener with the same capture mode`,
			).toBe(true);
		}
	}
}

function appendFrameDocument() {
	// A same-origin document with no iframe navigation or network activity.
	const frame = document.createElement('iframe');
	const frameDoc = document.implementation.createHTMLDocument('verification frame');
	Object.defineProperty(frame, 'contentDocument', { value: frameDoc });
	Object.defineProperty(frame, 'contentWindow', { value: { location: { href: window.location.href } } });
	document.body.append(frame);
	return { frame, frameDoc };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
	document.body.replaceChildren();
	observers = [];
	vi.stubGlobal(
		'MutationObserver',
		class {
			constructor(callback) {
				this.callback = callback;
				this.observe = vi.fn();
				this.disconnect = vi.fn();
				observers.push(this);
			}
		},
	);
});

afterEach(() => {
	for (const controller of controllers.splice(0)) {
		controller.dispose?.();
		controller.clearPending();
	}
	window.dispatchEvent(new Event('pagehide'));
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('content controller disposal', () => {
	it('removes a prepared nonce and its expiry timer, and remains disposed after repeated disposal', async () => {
		const input = appendOtpInput();
		const controller = createController();
		expect(controller.isDisposed()).toBe(false);
		expect(await prepare(controller)).toMatchObject({ ok: true, status: 'ready' });
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		controller.dispose();
		controller.dispose();
		controller.clearPending();

		expect(controller.isDisposed()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(input.value).toBe('');
	});

	it.each([MESSAGE.TARGET_PING, MESSAGE.PREPARE_TARGET, MESSAGE.FILL_CODE])('refuses %s after disposal without starting work', async (type) => {
		const controller = createController();
		controller.dispose();
		expect(await controller.handle({ type, nonce: NONCE })).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(observers).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('immediately cancels every ongoing detection and removes its observers, timers, and page listeners', async () => {
		const windowListeners = trackListeners(window);
		const documentListeners = trackListeners(document);
		const controller = createController();
		const waiting = [prepare(controller), prepare(controller, NEXT_NONCE)];
		expect(observers).toHaveLength(2);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		controller.dispose();

		for (const result of await Promise.all(waiting)) {
			expect(result).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		}
		for (const observer of observers) {
			expect(observer.disconnect).toHaveBeenCalledTimes(1);
		}
		expect(vi.getTimerCount()).toBe(0);
		expectListenersRemoved(windowListeners, ['pagehide']);
		expectListenersRemoved(documentListeners, ['visibilitychange', 'pointerdown', 'keydown', 'focusin']);
		const input = appendOtpInput();
		await vi.advanceTimersByTimeAsync(5000);
		expect(input.value).toBe('');
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
	});

	it('cannot create a pending target when disposal wins against an already detected target continuation', async () => {
		const input = appendOtpInput();
		const controller = createController();
		const readyButUncommitted = prepare(controller);
		controller.dispose();

		expect(await readyButUncommitted).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(vi.getTimerCount()).toBe(0);
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(input.value).toBe('');
	});

	it('releases owned explicit-focus listeners on main, existing iframe, and later detached iframe documents', async () => {
		const mainListeners = trackListeners(document);
		const { frame: existingFrame, frameDoc: existingDoc } = appendFrameDocument();
		const existingListeners = trackListeners(existingDoc);
		const controller = createController({ detectionTimeoutMs: 0 });
		const { frame: laterFrame, frameDoc: laterDoc } = appendFrameDocument();
		const laterListeners = trackListeners(laterDoc);
		expect(await prepare(controller)).toMatchObject({ ok: true, status: 'not_found' });
		existingFrame.remove();
		laterFrame.remove();

		controller.dispose();

		for (const tracker of [mainListeners, existingListeners, laterListeners]) {
			expectListenersRemoved(tracker, ['pointerdown', 'keydown', 'focusin']);
		}
		const removedCounts = [mainListeners, existingListeners, laterListeners].map(({ remove }) => remove.mock.calls.length);
		controller.dispose();
		expect([mainListeners, existingListeners, laterListeners].map(({ remove }) => remove.mock.calls.length)).toEqual(removedCounts);
	});

	it('does not dispose a caller-owned explicit-focus provider or install its own focus listeners', async () => {
		const listeners = trackListeners(document);
		const getExplicitFocusedInput = Object.assign(vi.fn(() => null), { dispose: vi.fn() });
		const controller = createController({ getExplicitFocusedInput, detectionTimeoutMs: 0 });
		expect(await prepare(controller)).toMatchObject({ ok: true, status: 'not_found' });
		expect(getExplicitFocusedInput).toHaveBeenCalled();
		controller.dispose();
		expect(getExplicitFocusedInput.dispose).not.toHaveBeenCalled();
		expect(listeners.add.mock.calls.filter(([type]) => ['pointerdown', 'keydown', 'focusin'].includes(type))).toHaveLength(0);
	});
});

describe('temporary page unavailability', () => {
	const cancellations = [
		['clearPending', (controller) => controller.clearPending(), () => {}],
		['pagehide', () => window.dispatchEvent(new Event('pagehide')), () => window.dispatchEvent(new Event('pageshow'))],
		[
			'hidden document',
			() => {
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
				document.dispatchEvent(new Event('visibilitychange'));
			},
			() => {
				vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
				document.dispatchEvent(new Event('visibilitychange'));
			},
		],
	];

	it.each(cancellations)('%s cancels detection but permits a fresh nonce after the page returns', async (_name, cancel, restore) => {
		const controller = createController();
		const waiting = prepare(controller);
		cancel(controller);
		expect(await waiting).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(controller.isDisposed()).toBe(false);
		expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);

		restore();
		const input = appendOtpInput();
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'NONCE_INVALID' } });
		expect(await prepare(controller)).toMatchObject({ ok: false, error: { code: 'NONCE_REUSED' } });
		expect(await prepare(controller, NEXT_NONCE)).toMatchObject({ ok: true, status: 'ready' });
		expect(await fill(controller, NEXT_NONCE)).toMatchObject({ ok: true, status: 'filled' });
		expect(input.value).toBe('012345');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not revive a ready continuation cancelled by clearPending, while a new attempt succeeds', async () => {
		const input = appendOtpInput();
		const controller = createController();
		const stale = prepare(controller);
		controller.clearPending();
		const current = prepare(controller, NEXT_NONCE);

		expect(await stale).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(await current).toMatchObject({ ok: true, status: 'ready' });
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'NONCE_INVALID' } });
		expect(input.value).toBe('');
		expect(await fill(controller, NEXT_NONCE)).toMatchObject({ ok: true, status: 'filled' });
		expect(input.value).toBe('012345');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('invalidates an already prepared target at pagehide and allows a new target after BFCache restoration', async () => {
		const input = appendOtpInput();
		const controller = createController();
		expect(await prepare(controller)).toMatchObject({ ok: true, status: 'ready' });
		window.dispatchEvent(new Event('pagehide'));
		expect(vi.getTimerCount()).toBe(0);
		window.dispatchEvent(new Event('pageshow'));
		expect(await fill(controller)).toMatchObject({ ok: false, error: { code: 'NONCE_INVALID' } });
		expect(input.value).toBe('');
		expect(controller.isDisposed()).toBe(false);
		expect(await prepare(controller, NEXT_NONCE)).toMatchObject({ ok: true, status: 'ready' });
		expect(await fill(controller, NEXT_NONCE)).toMatchObject({ ok: true, status: 'filled' });
		expect(input.value).toBe('012345');
	});
});

describe('OTP detection cancellation signal', () => {
	it('returns not_found for an already aborted signal even when an OTP field exists', async () => {
		appendOtpInput();
		const abort = new AbortController();
		abort.abort();
		expect(await waitForOtpTarget({ root: document, signal: abort.signal })).toEqual({ status: 'not_found' });
		expect(observers).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('aborts immediately and cancels a queued mutation inspection without leaving listeners or timers', async () => {
		const abort = new AbortController();
		const signalListeners = trackListeners(abort.signal);
		const windowListeners = trackListeners(window);
		const documentListeners = trackListeners(document);
		const waiting = waitForOtpTarget({ root: document, timeoutMs: 2000, signal: abort.signal });
		const observer = observers[0];
		observer.callback([]);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		abort.abort();

		expect(await waiting).toEqual({ status: 'not_found' });
		expect(observer.disconnect).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		expectListenersRemoved(signalListeners, ['abort']);
		expectListenersRemoved(windowListeners, ['pagehide']);
		expectListenersRemoved(documentListeners, ['visibilitychange']);
	});

	it('releases the abort listener after a successful detection and ignores a subsequent abort', async () => {
		const abort = new AbortController();
		const signalListeners = trackListeners(abort.signal);
		const waiting = waitForOtpTarget({ root: document, expectedDigits: 6, signal: abort.signal });
		const input = appendOtpInput();
		observers[0].callback([]);
		await vi.advanceTimersByTimeAsync(40);
		const result = await waiting;
		expect(result).toMatchObject({ status: 'ready', target: { inputs: [input] } });
		expectListenersRemoved(signalListeners, ['abort']);
		abort.abort();
		expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('runtime response lifecycle', () => {
	function fixture() {
		const response = { ok: true, origin: window.location.origin };
		const controller = { handle: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
		const runtime = { id: 'test-extension', onMessage: { removeListener: vi.fn() } };
		const listener = createRuntimeMessageListener({ runtime, controller });
		const send = (respond) => listener({ type: MESSAGE.TARGET_PING }, { id: runtime.id }, respond);
		return { response, controller, runtime, listener, send };
	}

	it('responds once and disposes when sending a successful response discovers an invalidated extension context', async () => {
		const { response, controller, runtime, listener, send } = fixture();
		const respond = vi.fn(() => {
			throw new Error('Extension context invalidated.');
		});
		expect(send(respond)).toBe(true);
		await vi.advanceTimersByTimeAsync(0);

		expect(controller.handle).toHaveBeenCalledTimes(1);
		expect(respond).toHaveBeenCalledExactlyOnceWith(response);
		expect(listener.isDisposed()).toBe(true);
		expect(runtime.onMessage.removeListener).toHaveBeenCalledExactlyOnceWith(listener);
		expect(controller.dispose).toHaveBeenCalledTimes(1);
		const nextResponse = vi.fn();
		expect(send(nextResponse)).toBe(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.handle).toHaveBeenCalledTimes(1);
		expect(nextResponse).not.toHaveBeenCalled();
	});

	it('does not retry a response to a closed port and still handles the next message', async () => {
		const { response, controller, runtime, listener, send } = fixture();
		const closedPort = vi.fn(() => {
			throw new Error('The message port closed before a response was received.');
		});
		expect(send(closedPort)).toBe(true);
		await vi.advanceTimersByTimeAsync(0);

		expect(closedPort).toHaveBeenCalledExactlyOnceWith(response);
		expect(listener.isDisposed()).toBe(false);
		expect(controller.dispose).not.toHaveBeenCalled();
		expect(runtime.onMessage.removeListener).not.toHaveBeenCalled();
		const nextResponse = vi.fn();
		expect(send(nextResponse)).toBe(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.handle).toHaveBeenCalledTimes(2);
		expect(nextResponse).toHaveBeenCalledExactlyOnceWith(response);
		expect(listener.isDisposed()).toBe(false);
		listener.dispose();
	});

	it('disposes the controller exactly once even if unregistering the runtime listener throws', () => {
		const { controller, runtime, listener, send } = fixture();
		runtime.onMessage.removeListener.mockImplementation(() => {
			throw new Error('Extension context invalidated.');
		});

		expect(() => listener.dispose()).not.toThrow();
		expect(() => listener.dispose()).not.toThrow();
		expect(listener.isDisposed()).toBe(true);
		expect(runtime.onMessage.removeListener).toHaveBeenCalledExactlyOnceWith(listener);
		expect(controller.dispose).toHaveBeenCalledTimes(1);
		expect(send(vi.fn())).toBe(false);
		expect(controller.handle).not.toHaveBeenCalled();
	});
});
