// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSourceWatcher } from '../../extension/src/content/source-watch.js';

const CACHE_KEY = '2fa-secrets-cache';
const MARKER = '__twofa_source_watcher_v1__';
const SYNTHETIC_SECRET = 'SYNTHETIC-SEED-NEVER-SENT';
let controllers = [];

function cache(timestamp, data = [{ id: 'synthetic', secret: SYNTHETIC_SECRET }]) {
	window.localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp }));
}

function visibility(value) {
	Object.defineProperty(document, 'visibilityState', { configurable: true, value });
	document.dispatchEvent(new window.Event('visibilitychange'));
}

function storage(key = CACHE_KEY, storageArea = window.localStorage) {
	window.dispatchEvent(new window.StorageEvent('storage', { key, storageArea }));
}

function online(trusted = true) {
	const event = new window.Event('online');
	Object.defineProperty(event, 'isTrusted', { value: trusted });
	window.dispatchEvent(event);
}

function fixture({ enabled = true, status, dirty, doc = document } = {}) {
	let listener;
	const runtime = {
		id: 'source-watcher-test',
		onMessage: {
			addListener: vi.fn((callback) => {
				listener = callback;
			}),
			removeListener: vi.fn(),
		},
		sendMessage: vi.fn(async (message) => {
			if (message.type === 'SOURCE_STATUS') {
				return status ? status() : { ok: true, data: { enabled } };
			}
			return dirty ? dirty() : { ok: true };
		}),
	};
	const controller = createSourceWatcher({ doc, runtime });
	controllers.push(controller);
	return {
		controller,
		runtime,
		listen: (message, sender = { id: runtime.id }, respond = vi.fn()) => listener(message, sender, respond),
		messages: (type) => runtime.sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type),
		async start() {
			await controller.refresh();
			await vi.advanceTimersByTimeAsync(750);
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	document.body.replaceChildren();
	const values = new Map();
	// Happy DOM's Storage proxy binds methods on first access and cannot restore
	// instance spies reliably. A getter-scoped store keeps each case isolated.
	vi.spyOn(window, 'localStorage', 'get').mockReturnValue({
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: (key) => values.delete(key),
		clear: () => values.clear(),
	});
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
	for (const controller of controllers) {
		controller.dispose();
	}
	controllers = [];
	globalThis[MARKER]?.dispose();
	delete globalThis[MARKER];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('authorized source cache watcher', () => {
	it('initially hints once and sends only message types, never timestamps or account data', async () => {
		cache(1000);
		const reads = window.localStorage.getItem;
		const app = fixture();
		await app.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.runtime.sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'SOURCE_STATUS' }, { type: 'SOURCE_DIRTY' }]);
		expect(reads).toHaveBeenCalled();
		expect(reads.mock.calls.every((args) => args.length === 1 && args[0] === CACHE_KEY)).toBe(true);
		expect(JSON.stringify(app.runtime.sendMessage.mock.calls)).not.toContain(SYNTHETIC_SECRET);
	});

	it('detects same-document setItem without relying on a storage event', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		cache(2000);
		await vi.advanceTimersByTimeAsync(2000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('ignores repeated reads, account payload differences with the same timestamp, and DOM animation', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		cache(1000, [{ secret: 'DIFFERENT-SYNTHETIC-DATA' }]);
		for (let index = 0; index < 20; index += 1) {
			document.body.textContent = `Countdown ${index}`;
			storage();
		}
		await vi.advanceTimersByTimeAsync(8000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
	});

	it('debounces cross-document changes and reads the cache instead of StorageEvent payloads', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		cache(2000);
		storage();
		await vi.advanceTimersByTimeAsync(400);
		cache(3000);
		storage();
		await vi.advanceTimersByTimeAsync(749);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		window.dispatchEvent(
			new window.StorageEvent('storage', { key: CACHE_KEY, newValue: SYNTHETIC_SECRET, storageArea: window.localStorage }),
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('ignores other storage keys and sessionStorage events', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		const reads = window.localStorage.getItem;
		reads.mockClear();
		storage('other-key');
		storage(CACHE_KEY, window.sessionStorage);
		expect(reads).not.toHaveBeenCalled();
	});

	it('notifies cache removal and restoration, leaving logout verification to the background', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		window.localStorage.removeItem(CACHE_KEY);
		storage();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		window.localStorage.clear();
		storage(null);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		cache(1000);
		storage();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(3);
	});

	it('initially hints even when the main webpage has not yet written its cache', async () => {
		const app = fixture();
		await app.start();
		expect(app.messages('SOURCE_DIRTY')).toEqual([{ type: 'SOURCE_DIRTY' }]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
	});

	it.each([{ ok: true, data: { enabled: false } }, { ok: true, data: { enabled: 'true' } }, { ok: false, data: { enabled: true } }, null])(
		'never reads local cache or arms timers when the background denies authorization: %j',
		async (response) => {
			cache(1000);
			const reads = window.localStorage.getItem;
			const app = fixture({ status: () => response });
			await app.start();
			storage();
			await vi.advanceTimersByTimeAsync(10000);
			expect(reads).not.toHaveBeenCalled();
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(0);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it('does not read or poll initially hidden documents', async () => {
		visibility('hidden');
		cache(1000);
		const reads = window.localStorage.getItem;
		const app = fixture();
		await app.start();
		expect(app.runtime.sendMessage).not.toHaveBeenCalled();
		expect(reads).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		visibility('visible');
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
	});

	it('cancels polling and a queued hint while hidden, then notices the unreported change on return', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		cache(2000);
		storage();
		visibility('hidden');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(10000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		visibility('visible');
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		visibility('hidden');
		visibility('visible');
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('pauses for pagehide and resumes from BFCache without duplicating listeners or unchanged hints', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		window.dispatchEvent(new window.Event('pagehide'));
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(10000);
		window.dispatchEvent(new window.Event('pageshow'));
		window.dispatchEvent(new window.Event('pageshow'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
	});

	it('keeps SOURCE_STOP stopped across lifecycle events until an explicit SOURCE_REFRESH', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		const response = vi.fn();
		expect(app.listen({ type: 'SOURCE_STOP' }, { id: app.runtime.id }, response)).toBe(false);
		expect(response).toHaveBeenCalledWith({ ok: true });
		expect(vi.getTimerCount()).toBe(0);
		cache(2000);
		storage();
		online();
		visibility('hidden');
		visibility('visible');
		window.dispatchEvent(new window.Event('pageshow'));
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_STATUS')).toHaveLength(1);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		const refreshed = vi.fn();
		expect(app.listen({ type: 'SOURCE_REFRESH' }, { id: app.runtime.id }, refreshed)).toBe(true);
		await vi.advanceTimersByTimeAsync(750);
		expect(refreshed).toHaveBeenCalledWith({ ok: true });
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it.each([
		undefined,
		{ id: 'different-extension' },
		{ id: 'source-watcher-test', tab: {} },
		{ id: 'source-watcher-test', tab: null },
		{ id: 'source-watcher-test', tab: undefined },
	])('ignores control messages from a wrong or tab sender: %j', async (sender) => {
		const app = fixture();
		await app.start();
		const response = vi.fn();
		const listener = app.runtime.onMessage.addListener.mock.calls[0][0];
		for (const type of ['SOURCE_PING', 'SOURCE_STOP', 'SOURCE_REFRESH']) {
			expect(listener({ type }, sender, response)).toBe(false);
		}
		expect(response).not.toHaveBeenCalled();
		expect(app.messages('SOURCE_STATUS')).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(1);
	});

	it('answers SOURCE_PING synchronously with only the document origin', () => {
		const app = fixture();
		const response = vi.fn();
		expect(app.listen({ type: 'SOURCE_PING' }, { id: app.runtime.id }, response)).toBe(false);
		expect(response).toHaveBeenCalledExactlyOnceWith({ ok: true, origin: document.location.origin });
		expect(app.runtime.sendMessage).not.toHaveBeenCalled();
	});

	it('rejects an authorization response that arrives after SOURCE_STOP', async () => {
		let finish;
		const reads = window.localStorage.getItem;
		const app = fixture({
			status: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		const pending = app.controller.refresh();
		app.controller.stop();
		finish({ ok: true, data: { enabled: true } });
		await pending;
		await vi.advanceTimersByTimeAsync(5000);
		expect(reads).not.toHaveBeenCalled();
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('lets a newer denied status supersede an older enabled response', async () => {
		const pendingResponses = [];
		const reads = window.localStorage.getItem;
		const app = fixture({ status: () => new Promise((resolve) => pendingResponses.push(resolve)) });
		const first = app.controller.refresh();
		const second = app.controller.refresh();
		pendingResponses[1]({ ok: true, data: { enabled: false } });
		await second;
		pendingResponses[0]({ ok: true, data: { enabled: true } });
		await first;
		expect(reads).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['status', 'dirty'])('stops permanently when an invalidated extension rejects a %s message', async (phase) => {
		cache(1000);
		const reject = () => Promise.reject(new Error('Extension context invalidated.'));
		const app = fixture({ [phase]: reject });
		await app.start();
		expect(app.controller.isDisposed()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(app.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
		const calls = app.runtime.sendMessage.mock.calls.length;
		cache(2000);
		storage();
		online();
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(10000);
		expect(app.runtime.sendMessage).toHaveBeenCalledTimes(calls);
	});

	it('retries a temporary status failure without reading the cache before authorization succeeds', async () => {
		cache(1000);
		const status = vi
			.fn()
			.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
			.mockResolvedValue({ ok: true, data: { enabled: true } });
		const app = fixture({ status });
		await app.start();
		expect(window.localStorage.getItem).not.toHaveBeenCalled();
		expect(app.controller.isDisposed()).toBe(false);
		await vi.advanceTimersByTimeAsync(3000);
		expect(app.messages('SOURCE_STATUS')).toHaveLength(2);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
	});

	it.each(['message-port', 'missing-response'])(
		'retries an unacknowledged hint with the same timestamp after %s failure',
		async (failure) => {
			cache(1000);
			const dirty = vi.fn().mockResolvedValue({ ok: true });
			if (failure === 'message-port') {
				dirty.mockRejectedValueOnce(new Error('The message port closed before a response was received.'));
			} else {
				dirty.mockResolvedValueOnce(undefined);
			}
			const app = fixture({ dirty });
			await app.start();
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
			expect(app.controller.isDisposed()).toBe(false);
			await vi.advanceTimersByTimeAsync(3000);
			expect(app.messages('SOURCE_STATUS')).toHaveLength(2);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(10000);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		},
	);

	it.each(['AUTH_REQUIRED', 'SOURCE_OFFLINE'])(
		'does not loop after an acknowledged %s failure, but online and cache changes can retry',
		async (code) => {
			cache(1000);
			const dirty = vi.fn().mockResolvedValue({ ok: true }).mockResolvedValueOnce({ ok: false, error: { code } });
			const app = fixture({ dirty });
			await app.start();
			await vi.advanceTimersByTimeAsync(10000);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
			expect(app.messages('SOURCE_STATUS')).toHaveLength(1);
			online();
			await vi.advanceTimersByTimeAsync(750);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
			cache(2000);
			storage();
			await vi.advanceTimersByTimeAsync(750);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(3);
			await vi.advanceTimersByTimeAsync(10000);
			expect(app.messages('SOURCE_DIRTY')).toHaveLength(3);
		},
	);

	it('cancels a temporary failure retry while hidden and resumes the unacknowledged hint when visible', async () => {
		cache(1000);
		const dirty = vi.fn().mockRejectedValueOnce(new Error('The message port closed.')).mockResolvedValue({ ok: true });
		const app = fixture({ dirty });
		await app.start();
		visibility('hidden');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_STATUS')).toHaveLength(1);
		visibility('visible');
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('never restarts after SOURCE_STOP while a transient failure retry is pending', async () => {
		cache(1000);
		const dirty = vi.fn().mockRejectedValueOnce(new Error('The message port closed.')).mockResolvedValue({ ok: true });
		const app = fixture({ dirty });
		await app.start();
		app.listen({ type: 'SOURCE_STOP' });
		expect(vi.getTimerCount()).toBe(0);
		online();
		visibility('hidden');
		visibility('visible');
		await vi.advanceTimersByTimeAsync(10000);
		expect(app.messages('SOURCE_STATUS')).toHaveLength(1);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		app.listen({ type: 'SOURCE_REFRESH' });
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('does not reactivate when a retry authorization response arrives after SOURCE_STOP', async () => {
		cache(1000);
		let completeRetry;
		const status = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, data: { enabled: true } })
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						completeRetry = resolve;
					}),
			);
		const app = fixture({ status, dirty: () => Promise.reject(new Error('The message port closed.')) });
		await app.start();
		await vi.advanceTimersByTimeAsync(1500);
		expect(status).toHaveBeenCalledTimes(2);
		app.listen({ type: 'SOURCE_STOP' });
		completeRetry({ ok: true, data: { enabled: true } });
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('forces the same timestamp once for a trusted online event but ignores synthetic online events', async () => {
		cache(1000);
		const app = fixture();
		await app.start();
		online(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		online();
		online();
		online();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('limits concurrent dirty messages and follows a pending message with the latest changed timestamp', async () => {
		let finish;
		const app = fixture({
			dirty: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		cache(1000);
		await app.start();
		cache(2000);
		storage();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		finish({ ok: true });
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		finish({ ok: true });
		await vi.advanceTimersByTimeAsync(0);
	});

	it('treats malformed timestamps as unavailable and never parses the cached account payload', async () => {
		window.localStorage.setItem(CACHE_KEY, 'not JSON');
		const parse = vi.spyOn(JSON, 'parse');
		const app = fixture();
		await app.start();
		window.localStorage.setItem(CACHE_KEY, '{"data":[],"timestamp":-1}');
		storage();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		window.localStorage.setItem(CACHE_KEY, '{"data":[NOT_PARSED],"timestamp":123}');
		storage();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
		expect(parse).not.toHaveBeenCalled();
	});

	it('rejects a cache exceeding four MiB, including multibyte text, without leaking its data', async () => {
		const reads = window.localStorage.getItem;
		reads.mockReturnValue(`{"data":["${'x'.repeat(4 * 1024 * 1024)}"],"timestamp":1000}`);
		const app = fixture();
		await app.start();
		reads.mockReturnValue(`{"data":["${'界'.repeat(1500000)}"],"timestamp":2000}`);
		storage();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		reads.mockReturnValue('{"data":[],"timestamp":3000}');
		storage();
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(2);
	});

	it('handles inaccessible localStorage without throwing or issuing hints', async () => {
		window.localStorage.getItem.mockImplementation(() => {
			throw new Error('Storage blocked');
		});
		const app = fixture();
		await app.start();
		storage();
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(0);
	});

	it('does not install a watcher in an iframe', async () => {
		const frame = document.createElement('iframe');
		document.body.append(frame);
		const app = fixture({ doc: frame.contentDocument });
		await app.start();
		expect(app.runtime.onMessage.addListener).not.toHaveBeenCalled();
		expect(app.runtime.sendMessage).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reuses its global controller when injected repeatedly', async () => {
		cache(1000);
		expect(window.localStorage.getItem(CACHE_KEY)).toContain('1000');
		const app = fixture();
		app.controller.dispose();
		app.runtime.onMessage.addListener.mockClear();
		vi.stubGlobal('chrome', { runtime: app.runtime });
		vi.resetModules();
		await import('../../extension/src/content/source-watch.js');
		const first = globalThis[MARKER];
		vi.resetModules();
		await import('../../extension/src/content/source-watch.js');
		expect(globalThis[MARKER]).toBe(first);
		expect(await first.refresh()).toBe(true);
		await vi.advanceTimersByTimeAsync(750);
		expect(app.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(1);
	});

	it('recreates the global controller on reinjection after a permanent context invalidation', async () => {
		cache(1000);
		const app = fixture();
		app.controller.dispose();
		app.runtime.onMessage.addListener.mockClear();
		app.runtime.sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated.'));
		vi.stubGlobal('chrome', { runtime: app.runtime });
		vi.resetModules();
		await import('../../extension/src/content/source-watch.js');
		await vi.advanceTimersByTimeAsync(0);
		expect(globalThis[MARKER]).toBeUndefined();
		vi.resetModules();
		await import('../../extension/src/content/source-watch.js');
		expect(await globalThis[MARKER].refresh()).toBe(true);
		await vi.advanceTimersByTimeAsync(750);
		expect(app.runtime.onMessage.addListener).toHaveBeenCalledTimes(2);
		expect(app.messages('SOURCE_DIRTY')).toHaveLength(1);
		expect(globalThis[MARKER].isDisposed()).toBe(false);
	});
});
