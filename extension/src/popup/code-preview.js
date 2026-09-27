import { t, localizeError } from '../shared/i18n.js';
const TICK_MS = 250;
const CLOCK_DRIFT_MS = 2000;

function emptyState() {
	return {
		account: null,
		status: 'idle',
		code: null,
		expiresAt: null,
		remainingSeconds: 0,
		period: null,
		nextCode: null,
		nextStartsAt: null,
		nextExpiresAt: null,
		nextInSeconds: 0,
		error: null,
		errorCode: null,
		errorDetails: null,
	};
}

// Codes live only in this popup's memory. Each request is tied to the current selection.
export function createCodePreview({
	requestCode,
	onChange,
	now = () => Date.now(),
	monotonicNow = () => performance.now(),
	prefetchMs = 5000,
}) {
	let state = emptyState();
	let generation = 0;
	let timer = null;
	let pending = null;
	let clockAnchor = null;
	let destroyed = false;
	let refreshedExpiry = null;
	let validatedNext = false;

	function getState() {
		return { ...state, account: state.account ? { ...state.account } : null };
	}

	function publish() {
		if (!destroyed) {
			onChange(getState());
		}
	}

	function stopTimer() {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	function clearNext() {
		state.nextCode = null;
		state.nextStartsAt = null;
		state.nextExpiresAt = null;
		state.nextInSeconds = 0;
	}

	function clearCodes() {
		validatedNext = false;
		refreshedExpiry = null;
		state.code = null;
		state.expiresAt = null;
		state.remainingSeconds = 0;
		clearNext();
		clockAnchor = null;
	}

	function clockChanged(wallTime) {
		return Boolean(
			clockAnchor && Math.abs(wallTime - clockAnchor.wallTime - (monotonicNow() - clockAnchor.monotonicTime)) > CLOCK_DRIFT_MS,
		);
	}

	function updateCountdown(wallTime) {
		state.remainingSeconds = state.code ? Math.max(0, Math.ceil((state.expiresAt - wallTime) / 1000)) : 0;
		state.nextInSeconds = state.nextCode ? Math.max(0, Math.ceil((state.nextStartsAt - wallTime) / 1000)) : 0;
	}

	function tick() {
		if (destroyed || !state.account) {
			return;
		}
		const wallTime = now();
		const changedClock = clockChanged(wallTime);
		if (state.code && (changedClock || state.expiresAt <= wallTime)) {
			if (
				!changedClock &&
				validatedNext &&
				state.status !== 'error' &&
				state.nextCode &&
				state.nextStartsAt <= wallTime &&
				state.nextExpiresAt > wallTime + 1000
			) {
				state.code = state.nextCode;
				state.expiresAt = state.nextExpiresAt;
				clearNext();
				validatedNext = false;
				refreshedExpiry = null;
				updateCountdown(wallTime);
				publish();
			} else {
				clearCodes();
				stopTimer();
			}
			if (state.status !== 'error' && (!pending || changedClock)) {
				// A clock jump invalidates an in-flight response as well as the displayed code.
				void loadCode();
			} else {
				publish();
			}
			return;
		}
		const remainingSeconds = state.remainingSeconds;
		const nextInSeconds = state.nextInSeconds;
		updateCountdown(wallTime);
		if (remainingSeconds !== state.remainingSeconds || nextInSeconds !== state.nextInSeconds) {
			publish();
		}
		if (
			prefetchMs > 0 &&
			state.code &&
			state.expiresAt - wallTime <= prefetchMs &&
			refreshedExpiry !== state.expiresAt &&
			!pending &&
			state.status === 'ready'
		) {
			refreshedExpiry = state.expiresAt;
			void loadCode();
		}
	}

	function validateResponse(result, wallTime) {
		if (
			!result ||
			typeof result.code !== 'string' ||
			!/^\d{6}(?:\d{2})?$/.test(result.code) ||
			result.code.length !== result.digits ||
			result.digits !== state.account.digits ||
			!Number.isFinite(result.expiresAt) ||
			!Number.isInteger(result.period) ||
			result.period <= 0
		) {
			throw Object.assign(new Error(t('popupInvalidCode')), { i18nKey: 'popupInvalidCode' });
		}
		if (result.expiresAt <= wallTime) {
			throw Object.assign(new Error(t('popupExpiredCode')), { i18nKey: 'popupExpiredCode' });
		}
		if (
			typeof result.nextCode !== 'string' ||
			!/^\d{6}(?:\d{2})?$/.test(result.nextCode) ||
			result.nextCode.length !== result.digits ||
			result.nextStartsAt !== result.expiresAt ||
			!Number.isFinite(result.nextExpiresAt) ||
			result.nextExpiresAt !== result.expiresAt + result.period * 1000 ||
			result.nextExpiresAt <= result.nextStartsAt
		) {
			throw Object.assign(new Error(t('popupInvalidNextCode')), { i18nKey: 'popupInvalidNextCode' });
		}
	}

	async function loadCode() {
		if (destroyed || !state.account) {
			return;
		}
		const currentGeneration = ++generation;
		const account = state.account;
		const requestClock = { wallTime: now(), monotonicTime: monotonicNow() };
		const isCurrent = () => !destroyed && generation === currentGeneration && state.account === account;
		pending = currentGeneration;
		state.status = 'loading';
		state.error = null;
		state.errorCode = null;
		state.errorDetails = null;
		publish();
		try {
			if (!isCurrent()) {
				return;
			}
			const result = await requestCode({ ...account }, { includeNext: true, isCurrent });
			if (!isCurrent()) {
				return;
			}
			const wallTime = now();
			if (Math.abs(wallTime - requestClock.wallTime - (monotonicNow() - requestClock.monotonicTime)) > CLOCK_DRIFT_MS) {
				throw Object.assign(new Error(t('popupSystemTimeChanged')), { i18nKey: 'popupSystemTimeChanged' });
			}
			validateResponse(result, wallTime);
			state.code = result.code;
			state.expiresAt = result.expiresAt;
			state.period = result.period;
			state.status = 'ready';
			state.nextCode = result.nextCode;
			state.nextStartsAt = result.nextStartsAt;
			state.nextExpiresAt = result.nextExpiresAt;
			// Promote only a pair freshly revalidated near its boundary. A failed
			// request or clock change revokes this one-period permission.
			validatedNext = prefetchMs > 0 && result.expiresAt - wallTime <= prefetchMs;
			refreshedExpiry = validatedNext ? result.expiresAt : null;
			clockAnchor = { wallTime, monotonicTime: monotonicNow() };
			updateCountdown(wallTime);
			if (timer === null) {
				timer = setInterval(tick, TICK_MS);
			}
			publish();
		} catch (error) {
			if (!isCurrent()) {
				return;
			}
			validatedNext = false;
			if (
				prefetchMs > 0 ||
				state.expiresAt <= now() ||
				clockChanged(now()) ||
				['AUTH_REQUIRED', 'PERMISSION_REQUIRED', 'REQUEST_EXPIRED', 'TARGET_CHANGED', 'ACCOUNT_CHANGED', 'ACCOUNT_NOT_FOUND'].includes(
					error?.code,
				)
			) {
				clearCodes();
				stopTimer();
			}
			state.status = 'error';
			state.errorDetails = error;
			state.error = localizeError(error, 'popupFetchFailed');
			state.errorCode = typeof error?.code === 'string' ? error.code : null;
			publish();
		} finally {
			if (pending === currentGeneration) {
				pending = null;
			}
		}
	}

	function close() {
		validatedNext = false;
		refreshedExpiry = null;
		generation += 1;
		pending = null;
		stopTimer();
		clockAnchor = null;
		state = emptyState();
		publish();
	}

	function open(account) {
		if (destroyed) {
			return;
		}
		generation += 1;
		validatedNext = false;
		refreshedExpiry = null;
		pending = null;
		stopTimer();
		clockAnchor = null;
		state = { ...emptyState(), account: { ...account } };
		return loadCode();
	}

	function retry() {
		if (!pending) {
			return loadCode();
		}
	}

	function getCopyableCode() {
		tick();
		return state.code && state.expiresAt - now() > 1000 ? state.code : null;
	}

	function getCopyableNextCode() {
		tick();
		return state.nextCode && state.nextStartsAt > now() ? state.nextCode : null;
	}

	function destroy() {
		destroyed = true;
		close();
	}

	return { open, close, retry, getCopyableCode, getCopyableNextCode, getState, destroy };
}
