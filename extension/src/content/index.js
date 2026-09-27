import { readLoginContext } from './login-context.js';
import { sanitizeLoginContext, loginContextsMatch } from '../shared/login-context.js';
import { accessibleRoots, activeInput } from './dom.js';
import { LIMITS, MESSAGE, isPlainObject, isValidNonce, makePublicError } from '../shared/protocol.js';
import { fillOtpTarget, waitForOtpTarget } from './form.js';
import { autofillPathFromUrl } from '../shared/origin.js';
import { isExtensionContextInvalidated } from '../shared/runtime.js';
import { initI18n, t } from '../shared/i18n.js';

const MAX_PENDING_TARGETS = 32;
const MAX_SEEN_NONCES = 128;
const LISTENER_MARKER = '__twoFaTargetContentListener__';

const ERROR_MESSAGES = Object.freeze({
	INVALID_MESSAGE: 'contentErrorInvalidMessage',
	NONCE_REUSED: 'contentErrorNonceReused',
	NONCE_INVALID: 'contentErrorNonceInvalid',
	NONCE_EXPIRED: 'contentErrorNonceExpired',
	PENDING_LIMIT: 'contentErrorPendingLimit',
	INVALID_CODE: 'contentErrorInvalidCode',
	CODE_EXPIRED: 'contentErrorCodeExpired',
	DIGIT_MISMATCH: 'contentErrorDigitMismatch',
	TARGET_UNAVAILABLE: 'contentErrorTargetUnavailable',
	LOGIN_CHANGED: 'contentErrorLoginChanged',
	FILL_FAILED: 'contentErrorFillFailed',
});

function error(code) {
	return makePublicError(code, t(ERROR_MESSAGES[code] || ERROR_MESSAGES.FILL_FAILED));
}

function publicPrepareResult(result) {
	const response = { ok: true, status: result.status };
	if (result.kind) {
		response.kind = result.kind;
	}
	if (result.digits) {
		response.digits = result.digits;
	}
	return response;
}

function isValidPrepareMessage(message) {
	return (
		isPlainObject(message) &&
		message.type === MESSAGE.PREPARE_TARGET &&
		isValidNonce(message.nonce) &&
		(message.expectedDigits === undefined || [6, 8].includes(message.expectedDigits)) &&
		(message.confirmFocused === undefined || typeof message.confirmFocused === 'boolean')
	);
}

function isValidFillEnvelope(message) {
	return isPlainObject(message) && message.type === MESSAGE.FILL_CODE && isValidNonce(message.nonce);
}

function mapFillFailure(reason) {
	if (reason === 'code_expired') {
		return error('CODE_EXPIRED');
	}
	if (reason === 'invalid_code') {
		return error('INVALID_CODE');
	}
	if (reason === 'digit_mismatch') {
		return error('DIGIT_MISMATCH');
	}
	if (['target_unavailable', 'target_changed', 'invalid_target'].includes(reason)) {
		return error('TARGET_UNAVAILABLE');
	}
	return error('FILL_FAILED');
}

function createExplicitFocusTracker(doc) {
	let explicitInput = null;
	let keyboardFocusDeadline = 0;
	let disposed = false;
	const rememberPointer = (event) => {
		if (!event.isTrusted) {
			return;
		}
		const target = event.composedPath?.()[0] || event.target;
		explicitInput = target?.tagName === 'INPUT' ? target : null;
	};
	const rememberKeyboardIntent = (event) => {
		if (event.isTrusted && event.key === 'Tab') {
			keyboardFocusDeadline = Date.now() + 1000;
		}
	};
	const rememberKeyboardFocus = (event) => {
		if (event.isTrusted && Date.now() <= keyboardFocusDeadline) {
			const target = event.composedPath?.()[0] || event.target;
			explicitInput = target?.tagName === 'INPUT' ? target : null;
		}
		keyboardFocusDeadline = 0;
	};
	const observed = new Set();
	const unobserve = (root) => {
		root.removeEventListener('pointerdown', rememberPointer, true);
		root.removeEventListener('keydown', rememberKeyboardIntent, true);
		root.removeEventListener('focusin', rememberKeyboardFocus, true);
	};
	const observe = () => {
		const current = new Set(accessibleRoots(doc).filter((root) => root.nodeType === 9));
		for (const root of observed) {
			if (!current.has(root)) {
				unobserve(root);
				observed.delete(root);
			}
		}
		for (const root of current) {
			if (observed.has(root)) {
				continue;
			}
			observed.add(root);
			root.addEventListener('pointerdown', rememberPointer, true);
			root.addEventListener('keydown', rememberKeyboardIntent, true);
			root.addEventListener('focusin', rememberKeyboardFocus, true);
		}
	};
	observe();
	return {
		getFocusedInput() {
			if (disposed) {
				return null;
			}
			observe();
			return explicitInput?.isConnected && activeInput(doc) === explicitInput ? explicitInput : null;
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			for (const root of observed) {
				unobserve(root);
			}
			observed.clear();
			explicitInput = null;
			keyboardFocusDeadline = 0;
		},
	};
}

export function createContentController({
	doc = globalThis.document,
	now = () => Date.now(),
	monotonicNow = () => performance.now(),
	nonceTtlMs = LIMITS.PENDING_TTL_MS,
	detectionTimeoutMs = 2000,
	getExplicitFocusedInput,
	targetGuard = () => true,
	// Called synchronously once a fill has handed the complete code to the page,
	// whether or not the page's later changes let it be reported as filled.
	onCodeDelivered = () => {},
} = {}) {
	const pendingTargets = new Map();
	const seenNonces = new Map();
	const detections = new Set();
	let disposed = false;
	let preparingCount = 0;
	const boundedNonceTtl = Math.min(Math.max(Number(nonceTtlMs) || 1, 1), LIMITS.PENDING_TTL_MS);
	const focusTracker = getExplicitFocusedInput ? null : createExplicitFocusTracker(doc);
	const getFocusedInput = getExplicitFocusedInput || focusTracker.getFocusedInput;

	function removePending(nonce) {
		const pending = pendingTargets.get(nonce);
		if (pending) {
			clearTimeout(pending.expiryTimer);
			pendingTargets.delete(nonce);
		}
		return pending;
	}

	function cleanupExpired() {
		const timestamp = now();
		for (const [nonce, pending] of pendingTargets) {
			if (pending.expiresAt <= timestamp) {
				removePending(nonce);
			}
		}
		for (const [nonce, expiresAt] of seenNonces) {
			if (expiresAt <= timestamp) {
				seenNonces.delete(nonce);
			}
		}
	}

	function clearPending() {
		for (const controller of detections) {
			controller.abort();
		}
		for (const nonce of pendingTargets.keys()) {
			removePending(nonce);
		}
	}

	async function prepare(message) {
		const targetPath = autofillPathFromUrl(doc.location.href);
		if (!isValidPrepareMessage(message)) {
			return error('INVALID_MESSAGE');
		}
		if (!targetGuard({ phase: 'prepare', message })) {
			return error('TARGET_UNAVAILABLE');
		}
		const loginContext = sanitizeLoginContext(message.expectedLoginContext, doc.location.origin);
		if (message.expectedLoginContext && (!loginContext || !loginContextsMatch(loginContext, readLoginContext(doc)))) {
			return error('LOGIN_CHANGED');
		}
		cleanupExpired();
		if (seenNonces.has(message.nonce)) {
			return error('NONCE_REUSED');
		}
		if (pendingTargets.size + preparingCount >= MAX_PENDING_TARGETS || seenNonces.size >= MAX_SEEN_NONCES) {
			return error('PENDING_LIMIT');
		}

		const preparedAt = now();
		const monotonicAt = monotonicNow();
		const expiresAt = preparedAt + boundedNonceTtl;
		seenNonces.set(message.nonce, expiresAt);
		preparingCount += 1;
		const detection = new AbortController();
		detections.add(detection);
		let result;
		try {
			result = await waitForOtpTarget({
				root: doc,
				expectedDigits: message.expectedDigits,
				timeoutMs: detectionTimeoutMs,
				// The popup explicitly confirms using the already focused field.
				getFocusedInput: message.confirmFocused ? () => activeInput(doc) : getFocusedInput,
				confirmedFocus: message.confirmFocused === true,
				signal: detection.signal,
			});
		} finally {
			detections.delete(detection);
			preparingCount -= 1;
		}
		if (disposed || detection.signal.aborted) {
			return error('TARGET_UNAVAILABLE');
		}
		if (loginContext && !loginContextsMatch(loginContext, readLoginContext(doc))) {
			return error('LOGIN_CHANGED');
		}
		if (targetPath !== autofillPathFromUrl(doc.location.href) || !targetGuard({ phase: 'prepared', message, target: result.target })) {
			return error('TARGET_UNAVAILABLE');
		}
		if (
			loginContext &&
			result.status === 'ready' &&
			(result.target.inputs.length !== 1 || result.target.inputs[0] !== doc.querySelector('input#totpPin[name=totpPin]'))
		) {
			return { ok: true, status: 'not_found' };
		}
		if (message.confirmFocused && result.status === 'ready' && !result.target.inputs.includes(activeInput(doc))) {
			return { ok: true, status: 'not_found' };
		}
		if (result.status === 'ready') {
			const remainingMs = expiresAt - now();
			if (remainingMs <= 0) {
				return error('NONCE_EXPIRED');
			}
			const expiryTimer = setTimeout(() => removePending(message.nonce), remainingMs);
			pendingTargets.set(message.nonce, {
				preparedAt,
				monotonicAt,
				expectedDigits: message.expectedDigits,
				loginContext,
				targetPath,
				expiresAt,
				expiryTimer,
				target: result.target,
			});
		}
		return publicPrepareResult(result);
	}

	function fill(message) {
		if (!isValidFillEnvelope(message)) {
			return error('INVALID_MESSAGE');
		}
		const seenExpiry = seenNonces.get(message.nonce);
		cleanupExpired();

		// Consume before validating or touching the code so every fill attempt is one-shot.
		const pending = removePending(message.nonce);
		if (!pending) {
			return seenExpiry !== undefined && seenExpiry <= now() ? error('NONCE_EXPIRED') : error('NONCE_INVALID');
		}
		if (pending.expiresAt <= now()) {
			return error('NONCE_EXPIRED');
		}
		if (typeof message.code !== 'string' || !/^(?:\d{6}|\d{8})$/.test(message.code)) {
			return error('INVALID_CODE');
		}
		if (pending.expectedDigits && pending.expectedDigits !== message.code.length) {
			return error('DIGIT_MISMATCH');
		}
		if (!Number.isFinite(message.expiresAt) || message.expiresAt <= 0 || message.expiresAt > Number.MAX_SAFE_INTEGER) {
			return error('INVALID_MESSAGE');
		}
		const isCodeCurrent = () => {
			const timestamp = now();
			const elapsed = monotonicNow() - pending.monotonicAt;
			return (
				Number.isFinite(timestamp) &&
				Number.isFinite(elapsed) &&
				elapsed >= 0 &&
				Math.abs(timestamp - pending.preparedAt - elapsed) <= 2000 &&
				message.expiresAt - Math.max(timestamp, pending.preparedAt + elapsed) >= 1000
			);
		};

		const isTargetCurrent = ({ allowCompletedLock = false } = {}) =>
			!disposed &&
			pending.targetPath === autofillPathFromUrl(doc.location.href) &&
			(!pending.loginContext || loginContextsMatch(pending.loginContext, readLoginContext(doc))) &&
			targetGuard({ phase: 'fill', message, target: pending.target, allowCompletedLock });
		if (pending.loginContext && !loginContextsMatch(pending.loginContext, readLoginContext(doc))) {
			return error('LOGIN_CHANGED');
		}
		if (!isTargetCurrent()) {
			return error('TARGET_UNAVAILABLE');
		}
		const result = fillOtpTarget(pending.target, message.code, { isCodeCurrent, isTargetCurrent });
		if (result.status === 'filled' || result.codeDelivered) {
			onCodeDelivered({ message, target: pending.target });
		}
		if (result.status !== 'filled') {
			return mapFillFailure(result.reason);
		}
		return { ok: true, status: 'filled', kind: result.kind, digits: result.digits };
	}

	async function handle(message) {
		if (disposed) {
			return error('TARGET_UNAVAILABLE');
		}
		if (message?.type === MESSAGE.TARGET_PING) {
			const loginContext = readLoginContext(doc);
			return {
				ok: true,
				origin: doc.location.origin,
				targetPath: autofillPathFromUrl(doc.location.href),
				...(loginContext ? { loginContext } : {}),
			};
		}
		if (
			(message.expectedOrigin && message.expectedOrigin !== doc.location.origin) ||
			(message.expectedTargetPath !== undefined && message.expectedTargetPath !== autofillPathFromUrl(doc.location.href)) ||
			doc.visibilityState === 'hidden'
		) {
			return error('TARGET_UNAVAILABLE');
		}
		if (message?.type === MESSAGE.PREPARE_TARGET) {
			return prepare(message);
		}
		if (message?.type === MESSAGE.FILL_CODE) {
			return fill(message);
		}
		return error('INVALID_MESSAGE');
	}

	const view = doc?.defaultView;
	const onPageUnavailable = () => clearPending();
	view?.addEventListener('pagehide', onPageUnavailable);
	const onVisibilityChange = () => {
		if (doc.visibilityState === 'hidden') {
			clearPending();
		}
	};
	doc?.addEventListener('visibilitychange', onVisibilityChange);

	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		clearPending();
		seenNonces.clear();
		focusTracker?.dispose();
		view?.removeEventListener('pagehide', onPageUnavailable);
		doc?.removeEventListener('visibilitychange', onVisibilityChange);
	}
	return { handle, clearPending, dispose, isDisposed: () => disposed };
}

export function createRuntimeMessageListener({ runtime = globalThis.chrome?.runtime, controller, initializeLanguage = false } = {}) {
	const contentController = controller || createContentController();
	let disposed = false;
	let disposeLanguage = () => {};
	const languageReady = initializeLanguage
		? initI18n({ root: null, runtime })
				.then((cleanup) => {
					disposeLanguage = cleanup;
					if (disposed) {
						disposeLanguage();
					}
				})
				.catch(() => listener.dispose())
		: Promise.resolve();
	const listener = (message, sender, sendResponse) => {
		if (disposed) {
			return false;
		}
		if (isExtensionContextInvalidated(runtime)) {
			listener.dispose();
			return false;
		}
		if (
			!runtime?.id ||
			sender?.id !== runtime.id ||
			![MESSAGE.TARGET_PING, MESSAGE.PREPARE_TARGET, MESSAGE.FILL_CODE].includes(message?.type)
		) {
			return false;
		}

		const respond = (response) => {
			try {
				sendResponse(response);
			} catch (failure) {
				if (isExtensionContextInvalidated(runtime, failure)) {
					listener.dispose();
				}
				// A closed request port needs no second response or permanent teardown.
			}
		};
		languageReady
			.then(() => (disposed ? error('TARGET_UNAVAILABLE') : contentController.handle(message)))
			.then(respond, (failure) => {
				if (isExtensionContextInvalidated(runtime, failure)) {
					listener.dispose();
					return;
				}
				respond(error('FILL_FAILED'));
			});
		return true;
	};
	listener.dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		disposeLanguage();
		try {
			runtime?.onMessage?.removeListener(listener);
		} catch {
			// Invalidated runtime APIs can throw even during unregistration.
		} finally {
			contentController.dispose?.();
			if (globalThis[LISTENER_MARKER] === listener) {
				delete globalThis[LISTENER_MARKER];
			}
		}
	};
	listener.isDisposed = () => disposed;
	return listener;
}

export function disposeRegisteredContentListener() {
	globalThis[LISTENER_MARKER]?.dispose?.();
}

function registerRuntimeListener() {
	const runtime = globalThis.chrome?.runtime;
	const view = globalThis.window;
	if (!runtime?.onMessage?.addListener || !view || view.top !== view || globalThis[LISTENER_MARKER]) {
		return;
	}
	const listener = createRuntimeMessageListener({ runtime, initializeLanguage: true });
	runtime.onMessage.addListener(listener);
	globalThis[LISTENER_MARKER] = listener;
}

registerRuntimeListener();
