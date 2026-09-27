// Resume events and connection checks share one request and one delayed retry.
// The form supplies actions and readiness, never the controller's mutable state.
export function createConnectionChecks({ document, window, isReady, isBlocked, run, onStart, onSuccess, onError }) {
	let currentOrigin = null;
	let formRevision = 0;
	let optionsClosed = false;
	let connectionCheck = null;
	let checkPending = false;
	let lastResumeCheckAt = -Infinity;
	let resumeCheckTimer = null;
	let resumeCheckOnline = false;
	let awaitingLogin = false;

	function onResume(event) {
		const reconnecting = event?.type === 'online';
		if (optionsClosed || (!reconnecting && document.visibilityState === 'hidden') || !isReady()) {
			return;
		}
		const now = Date.now();
		if (!awaitingLogin && now - lastResumeCheckAt < 1500) {
			resumeCheckOnline ||= reconnecting;
			if (resumeCheckTimer === null) {
				const origin = currentOrigin;
				const revision = formRevision;
				resumeCheckTimer = setTimeout(
					() => {
						resumeCheckTimer = null;
						const online = resumeCheckOnline;
						resumeCheckOnline = false;
						if (currentOrigin === origin && formRevision === revision) {
							onResume(online ? { type: 'online' } : undefined);
						}
					},
					1500 - (now - lastResumeCheckAt),
				);
			}
			return;
		}
		clearTimeout(resumeCheckTimer);
		resumeCheckTimer = null;
		resumeCheckOnline = false;
		lastResumeCheckAt = now;
		awaitingLogin = false;
		if (connectionCheck?.origin === currentOrigin && connectionCheck.revision === formRevision) {
			connectionCheck.retryAfterResume = true;
			connectionCheck.resumeOnline ||= reconnecting;
			return;
		}
		checkPending = true;
		void flushConnectionCheck();
	}

	async function flushConnectionCheck() {
		if (!checkPending || optionsClosed || isBlocked()) {
			return;
		}
		checkPending = false;
		if (isReady()) {
			await checkConnection();
		}
	}

	async function checkConnection() {
		checkPending = false;
		const origin = currentOrigin;
		const revision = formRevision;
		if (!origin || optionsClosed) {
			return;
		}
		if (connectionCheck?.origin === origin && connectionCheck.revision === revision) {
			return connectionCheck.promise;
		}
		const active = { origin, revision };
		connectionCheck = active;
		onStart();
		active.promise = (async () => {
			try {
				const result = await run();
				if (optionsClosed || connectionCheck !== active || formRevision !== revision || !isReady()) {
					return;
				}
				onSuccess(result);
			} catch (error) {
				if (!optionsClosed && connectionCheck === active && formRevision === revision && origin === currentOrigin) {
					onError(error);
				}
			} finally {
				if (connectionCheck === active) {
					connectionCheck = null;
					if (
						active.retryAfterResume &&
						!optionsClosed &&
						(active.resumeOnline || document.visibilityState !== 'hidden') &&
						formRevision === revision &&
						isReady()
					) {
						checkPending = true;
						void flushConnectionCheck();
					}
				}
			}
		})();
		return active.promise;
	}

	function invalidate() {
		formRevision += 1;
		clearTimeout(resumeCheckTimer);
		resumeCheckTimer = null;
		resumeCheckOnline = false;
		checkPending = false;
	}

	window.addEventListener('online', onResume);
	window.addEventListener('focus', onResume);
	document.addEventListener('visibilitychange', onResume);

	return {
		setOrigin(origin) {
			if (origin !== currentOrigin) {
				invalidate();
				currentOrigin = origin;
			}
		},
		invalidate,
		isChecking: () => Boolean(connectionCheck),
		request() {
			checkPending = true;
			void flushConnectionCheck();
		},
		flush: flushConnectionCheck,
		check: checkConnection,
		awaitLogin() {
			awaitingLogin = true;
		},
		dispose() {
			if (optionsClosed) {
				return;
			}
			optionsClosed = true;
			invalidate();
			window.removeEventListener('online', onResume);
			window.removeEventListener('focus', onResume);
			document.removeEventListener('visibilitychange', onResume);
		},
	};
}
