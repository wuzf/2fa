import { isExtensionContextInvalidated } from '../shared/runtime.js';

const MARKER = '__twofa_source_watcher_v1__';
const CACHE_KEY = '2fa-secrets-cache';
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const POLL_MS = 1000;
const DEBOUNCE_MS = 750;
const RETRY_MS = 1500;
const UNSEEN = Symbol('unseen cache');

function withinReadLimit(raw) {
	if (raw.length > MAX_CACHE_BYTES) {
		return false;
	}
	if (raw.length * 3 <= MAX_CACHE_BYTES) {
		return true;
	}
	// Count UTF-8 bytes without allocating another copy of the account data.
	let bytes = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const point = raw.charCodeAt(index);
		if (point <= 0x7f) {
			bytes += 1;
		} else if (point <= 0x7ff) {
			bytes += 2;
		} else if (point >= 0xd800 && point <= 0xdbff && raw.charCodeAt(index + 1) >= 0xdc00 && raw.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else {
			bytes += 3;
		}
		if (bytes > MAX_CACHE_BYTES) {
			return false;
		}
	}
	return true;
}

function cacheTimestamp(raw) {
	if (typeof raw !== 'string' || !withinReadLimit(raw)) {
		return null;
	}
	// The main webpage writes { data: [...], timestamp: Date.now() }. Inspect
	// only its timestamp suffix: account data is never parsed or retained here.
	const match = /\]\s*,\s*"timestamp"\s*:\s*((?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\}\s*$/.exec(raw.slice(-256));
	if (!/^\s*\{\s*"data"\s*:\s*\[/.test(raw.slice(0, 128)) || !match) {
		return null;
	}
	const timestamp = Number(match[1]);
	return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

export function createSourceWatcher({ doc = globalThis.document, runtime = globalThis.chrome?.runtime } = {}) {
	const view = doc?.defaultView;
	if (!view || view.top !== view || !runtime?.id || !runtime.onMessage?.addListener || typeof runtime.sendMessage !== 'function') {
		return { refresh: async () => false, stop() {}, dispose() {}, isDisposed: () => true };
	}

	let disposed = false;
	let stopped = false;
	let enabled = false;
	let pageActive = true;
	let generation = 0;
	let pollTimer = null;
	let notifyTimer = null;
	let retryTimer = null;
	let sending = false;
	let forceDirty = false;
	let observed = UNSEEN;
	let notified = UNSEEN;

	const visible = () => pageActive && doc.visibilityState !== 'hidden';
	const active = () => !disposed && !stopped && enabled && visible();

	function clearTimers() {
		clearInterval(pollTimer);
		clearTimeout(notifyTimer);
		clearTimeout(retryTimer);
		pollTimer = null;
		notifyTimer = null;
		retryTimer = null;
		forceDirty = false;
	}

	function pause() {
		generation += 1;
		enabled = false;
		clearTimers();
	}

	function stop() {
		stopped = true;
		pause();
	}

	async function request(type) {
		try {
			if (isExtensionContextInvalidated(runtime)) {
				dispose();
				return {};
			}
			return { result: await runtime.sendMessage({ type }) };
		} catch (error) {
			if (isExtensionContextInvalidated(runtime, error)) {
				// A permanent invalidation requires a newly injected controller.
				dispose();
				return {};
			}
			// Worker restarts can briefly close a message port. Retain the hint and
			// retry authorization, rather than disabling synchronization forever.
			return { retry: true };
		}
	}

	function scheduleRetry(force = false) {
		if (disposed || stopped || !visible()) {
			return;
		}
		pause();
		retryTimer = setTimeout(() => {
			retryTimer = null;
			if (!disposed && !stopped && visible()) {
				void checkStatus(force);
			}
		}, RETRY_MS);
	}

	function scheduleDirty(force = false) {
		if (!active()) {
			return;
		}
		forceDirty ||= force;
		if (!forceDirty && observed === notified) {
			return;
		}
		clearTimeout(notifyTimer);
		notifyTimer = setTimeout(notify, DEBOUNCE_MS);
	}

	async function notify() {
		notifyTimer = null;
		if (!active() || sending || (!forceDirty && observed === notified)) {
			return;
		}
		const current = generation;
		const revision = observed;
		const forced = forceDirty;
		forceDirty = false;
		sending = true;
		let retry = false;
		try {
			const response = await request('SOURCE_DIRTY');
			if (!disposed && current === generation) {
				if (typeof response.result?.ok === 'boolean') {
					// A structured failure still acknowledges the hint. Authentication
					// and network errors wait for a new cache change or online event;
					// only a lost transport response needs the short retry loop.
					notified = revision;
				} else {
					retry = true;
				}
			}
		} finally {
			sending = false;
			if (retry && current === generation) {
				scheduleRetry(forced);
			} else if (active() && (forceDirty || observed !== notified)) {
				scheduleDirty();
			}
		}
	}

	function inspect() {
		if (!active()) {
			return;
		}
		let revision;
		try {
			const raw = view.localStorage.getItem(CACHE_KEY);
			revision = raw === null ? 'absent' : `present:${cacheTimestamp(raw)}`;
		} catch {
			return;
		}
		if (revision !== observed) {
			observed = revision;
			scheduleDirty();
		} else if (observed !== notified && notifyTimer === null) {
			scheduleDirty();
		}
	}

	async function checkStatus(force = false) {
		pause();
		if (disposed || stopped || !visible()) {
			return false;
		}
		const current = generation;
		const { result, retry } = await request('SOURCE_STATUS');
		if (disposed || stopped || !visible() || current !== generation) {
			return false;
		}
		if (retry) {
			scheduleRetry(force);
			return false;
		}
		enabled = result?.ok === true && result.data?.enabled === true;
		if (!enabled) {
			return false;
		}
		inspect();
		if (force) {
			scheduleDirty(true);
		}
		pollTimer = setInterval(inspect, POLL_MS);
		return true;
	}

	function refresh() {
		if (disposed) {
			return Promise.resolve(false);
		}
		stopped = false;
		return checkStatus();
	}

	const onStorage = (event) => {
		if (!active() || (event.key !== CACHE_KEY && event.key !== null)) {
			return;
		}
		try {
			if (event.storageArea && event.storageArea !== view.localStorage) {
				return;
			}
		} catch {
			return;
		}
		inspect();
	};
	const onVisibility = () => {
		if (!visible()) {
			pause();
		} else if (!stopped && !disposed) {
			void checkStatus();
		}
	};
	const onPageHide = () => {
		pageActive = false;
		pause();
	};
	const onPageShow = () => {
		pageActive = true;
		if (!stopped && !disposed) {
			void checkStatus();
		}
	};
	const onOnline = (event) => {
		if (event.isTrusted && !stopped && !disposed && visible()) {
			// Retry a failed synchronization after connectivity returns even when
			// the webpage still holds the same cache timestamp.
			void checkStatus(true);
		}
	};
	const listener = (message, sender, respond) => {
		if (disposed || !runtime.id || sender?.id !== runtime.id || Object.hasOwn(sender, 'tab')) {
			return false;
		}
		if (message?.type === 'SOURCE_PING') {
			respond({ ok: true, origin: doc.location.origin });
			return false;
		}
		if (message?.type === 'SOURCE_STOP') {
			stop();
			respond({ ok: true });
			return false;
		}
		if (message?.type === 'SOURCE_REFRESH') {
			void refresh().then(() => respond({ ok: true }));
			return true;
		}
		return false;
	};

	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		stop();
		if (globalThis[MARKER] === controller) {
			delete globalThis[MARKER];
		}
		try {
			runtime.onMessage.removeListener?.(listener);
		} catch {
			// Removing listeners can also reject after an extension reload.
		}
		doc.removeEventListener('visibilitychange', onVisibility);
		view.removeEventListener('storage', onStorage);
		view.removeEventListener('pagehide', onPageHide);
		view.removeEventListener('pageshow', onPageShow);
		view.removeEventListener('online', onOnline);
	}

	const controller = { refresh, stop, dispose, isDisposed: () => disposed };
	runtime.onMessage.addListener(listener);
	doc.addEventListener('visibilitychange', onVisibility);
	view.addEventListener('storage', onStorage);
	view.addEventListener('pagehide', onPageHide);
	view.addEventListener('pageshow', onPageShow);
	view.addEventListener('online', onOnline);
	return controller;
}

const runtime = globalThis.chrome?.runtime;
const view = globalThis.window;
if (runtime?.id && view && view.top === view) {
	if (!globalThis[MARKER] || globalThis[MARKER].isDisposed?.()) {
		globalThis[MARKER] = createSourceWatcher();
	}
	void globalThis[MARKER].refresh();
}
