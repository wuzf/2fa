import { t, tPlural, initI18n, onLanguageChange, localizeError } from '../shared/i18n.js';
import { MESSAGE } from '../shared/protocol.js';
import { createFlowSession, sameFlowTarget } from './flow-session.js';
import { createAccountsController } from './accounts-controller.js';
import { createSourceController } from './source-controller.js';
import { createAutofillController, canAuthorizeAutofill } from './autofill-controller.js';

const elements = Object.fromEntries(
	Object.entries({
		status: 'status',
		warning: 'account-warning',
		offline: 'offline-state',
		offlineSummary: 'offline-summary',
		offlineDetail: 'offline-detail',
		keyboardHelp: 'keyboard-help',
		instanceLink: 'instance-link',
		targetOrigin: 'target-origin',
		accountSection: 'account-section',
		accounts: 'accounts',
		template: 'account-card-template',
		remember: 'remember-binding',
		rememberTitle: 'remember-title',
		autofill: 'autofill-site',
		autofillDescription: 'autofill-description',
		autofillNote: 'autofill-note',
		actions: 'actions',
		retry: 'retry',
		fillFocused: 'fill-focused',
		openSource: 'open-source',
		options: 'open-options',
		setup: 'setup-guide',
		setupOptions: 'setup-options',
		search: 'account-search',
		searchIcon: 'search-icon',
		searchClear: 'account-search-clear',
		scopeSite: 'scope-site',
		scopeAll: 'scope-all',
		summary: 'account-summary',
		empty: 'account-empty',
		toast: 'copy-toast',
		toastIcon: 'copy-toast-icon',
		toastMessage: 'copy-toast-message',
	}).map(([key, id]) => [key, document.getElementById(id)]),
);
let failedAccount = null;
let busy = false;
let closed = false;
let sourceRecoveryError = null;
let initialAutomaticEligible = true;
// The first automatic fill can lose its nonce to a time check that replaced the
// correction meanwhile. It gets one more attempt with the renewed flow.
let automaticExpiredRetried = false;
let closeTimer = null;
let clockVerificationPending = false;
const SOURCE_RECOVERY_CODES = new Set([
	'SOURCE_TAB_MISSING',
	'SOURCE_TAB_INACTIVE',
	'AUTH_REQUIRED',
	'SOURCE_UNAVAILABLE',
	'SOURCE_OFFLINE',
	'OFFLINE_CACHE_MISSING',
	'CLOCK_UNAVAILABLE',
]);

let statusMessage = '';
function renderStatus() {
	elements.status.textContent =
		typeof statusMessage === 'function'
			? statusMessage()
			: typeof statusMessage === 'object'
				? localizeError(statusMessage)
				: statusMessage;
}
function setStatus(message, tone = 'info') {
	statusMessage = message;
	renderStatus();
	elements.status.dataset.tone = tone;
	elements.status.hidden = tone === 'info';
	elements.status.setAttribute('aria-busy', String(tone === 'loading'));
	elements.status.dataset.loading = String(tone === 'loading');
}

function showSourceRecovery(error) {
	if (!SOURCE_RECOVERY_CODES.has(error?.code)) {
		return false;
	}
	sourceRecoveryError = error.code;
	elements.openSource.hidden = false;
	elements.actions.hidden = false;
	setStatus(error, 'error');
	return true;
}
async function send(message) {
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		const error = Object.assign(new Error(localizeError(response?.error, 'popupOperationFailed')), response?.error || {});
		error.code = response?.error?.code || 'UNKNOWN_ERROR';
		throw error;
	}
	return response.data;
}
function renderOfflineState(retranslate = false) {
	const cached = session.flow?.offlineStatus;
	// A restored correction is verified by the source refresh or time check this view started.
	// Show its warning only if that check did not complete, avoiding a flash.
	const clockStatus = cached?.clockStatus === 'unverified' && clockVerificationPending ? null : cached?.clockStatus;
	const clockHint = {
		local: t('popupClockCheck'),
		stale: t('popupClockCheck'),
		unverified: t('popupClockCheck'),
		changed: t('popupClockChangedHint'),
		unavailable: t('popupClockUnavailable'),
	}[clockStatus];
	const clockDetail = {
		local: t('popupClockLocalDetail'),
		stale: t('popupClockStaleDetail'),
		unverified: t('popupClockStaleDetail'),
		changed: t('popupClockChangedDetail'),
		unavailable: t('popupClockUnavailableDetail'),
	}[clockStatus];
	if (!retranslate) {
		elements.offline.hidden = !clockHint;
	}
	elements.offlineSummary.textContent = clockHint || '';
	elements.offline.dataset.warning = String(Boolean(clockHint));
	elements.offlineDetail.textContent = clockDetail || '';
	if (!retranslate && cached?.clockStatus === 'unavailable') {
		elements.actions.hidden = false;
	}
}

function renderAccountWarning(retranslate = false) {
	const unavailable = session.flow?.unavailableAccounts || [];
	if (!retranslate) {
		elements.warning.hidden = unavailable.length === 0;
	}
	elements.warning.textContent = unavailable.length
		? tPlural('popupUnavailableAccounts', unavailable.length, {
				count: unavailable.length,
				names: unavailable
					.slice(0, 3)
					.map((account) => account.name || t(account.nameKey))
					.join(t('popupListSeparator')),
				more: unavailable.length > 3 ? t('popupListMore') : '',
			})
		: '';
}

function cancelInitialAutomatic() {
	initialAutomaticEligible = false;
}
function boundAccountIds() {
	return session.flow?.boundAccountIds || (session.flow?.boundAccountId ? [session.flow.boundAccountId] : []);
}
function onPreviewState(state) {
	if (state.status === 'error') {
		elements.actions.hidden = false;
		showSourceRecovery(state.errorDetails || { code: state.errorCode, message: state.error });
	} else if (state.status === 'ready' && sourceRecoveryError) {
		sourceRecoveryError = null;
		elements.openSource.hidden = true;
		setStatus(() => t('popupReconnected'));
	}
}
const session = createFlowSession({
	send,
	onRenewed() {
		renderOfflineState();
		renderAccountWarning();
	},
});
const accounts = createAccountsController({
	elements,
	session,
	send,
	isBusy: () => busy,
	isClockPending: () => source.clockRefreshPending,
	onInteraction: cancelInitialAutomatic,
	onFill: fill,
	onPreviewState,
	onError: (error) => setStatus(error, 'error'),
});
const source = createSourceController({
	instanceLink: elements.instanceLink,
	session,
	send,
	isBusy: () => busy,
	isAutomaticEligible: () => initialAutomaticEligible,
	onInteraction: cancelInitialAutomatic,
	onSettingsInvalidated() {
		autofill.reset();
		autofill.render();
		accounts.invalidate();
		elements.actions.hidden = false;
		setStatus(() => t('popupSettingsChanged'), 'notice');
	},
	onClockChanged: accounts.pause,
	onSourceError(error) {
		accounts.invalidate();
		accounts.clear();
		elements.actions.hidden = false;
		setStatus(error, 'error');
		showSourceRecovery(error);
	},
	onRefreshFailed() {
		if (clockVerificationPending) {
			clockVerificationPending = false;
			renderOfflineState();
		}
	},
	onRefresh: start,
	onIcons: accounts.applyIcons,
});
const autofill = createAutofillController({
	elements,
	session,
	accounts,
	send,
	isBusy: () => busy,
	setBusy,
	setStatus,
	onInteraction: cancelInitialAutomatic,
	onRestart: start,
});
function setBusy(value) {
	busy = value;
	for (const button of document.querySelectorAll('button')) {
		button.disabled = busy;
	}
	elements.search.disabled = busy;
	elements.remember.disabled = busy || session.flow?.canFill === false;
	autofill.render();
	accounts.updateControls();
	if (!busy) {
		source.schedule();
	}
}
function renderPageHint(viewOnly = false, retranslate = false) {
	if (!retranslate) {
		elements.targetOrigin.hidden = !viewOnly;
	}
	elements.targetOrigin.textContent = viewOnly ? t('popupViewOnly') : '';
	if (viewOnly) {
		elements.targetOrigin.title = t('popupViewOnlyTitle');
	} else {
		elements.targetOrigin.removeAttribute('title');
	}
}

async function start({ skipAutomatic = false, expectedFlow = null, refreshSource = true, preserveView = false } = {}) {
	let automaticAccount = null;
	let refreshInBackground = false;
	let verifyClockInBackground = false;
	if (closed) {
		return;
	}
	const version = session.begin();
	const configurationVersion = source.configurationVersion;
	let view = preserveView && session.flow ? accounts.capture() : null;
	const keepingView = Boolean(view);
	if (!keepingView) {
		renderPageHint();
		autofill.reset();
		accounts.invalidate();
		setBusy(true);
		elements.setup.hidden = true;
		elements.warning.hidden = true;
		elements.offline.hidden = true;
		elements.autofill.closest('label').hidden = true;
		elements.actions.hidden = true;
		elements.fillFocused.hidden = true;
		failedAccount = null;
		elements.openSource.hidden = true;
		sourceRecoveryError = null;
		setStatus(() => t('popupLoadingAccounts'), 'loading');
	}
	try {
		const nextFlow = await session.serialize(() => {
			if (closed) {
				return null;
			}
			// START_FLOW replaces the shared nonce. If a user starts filling while
			// this local read is pending, that queued fill must obtain its own flow.
			session.consume();
			return send({ type: MESSAGE.START_FLOW, preferCache: true, refreshSource });
		});
		if (closed || version !== session.version || configurationVersion !== source.configurationVersion) {
			return;
		}
		if (keepingView && busy) {
			source.queueRefresh({ force: true, expectedFlow: expectedFlow || session.flow });
			return;
		}
		if (expectedFlow && !sameFlowTarget(expectedFlow, nextFlow)) {
			throw Object.assign(new Error(t('popupTargetChanged')), { i18nKey: 'popupTargetChanged' });
		}
		if (keepingView) {
			// Read the view after awaiting the local response, so typing or copying
			// during maintenance is never overwritten by an earlier snapshot.
			view = accounts.capture();
		}
		if (!keepingView || !source.matchesRendered(nextFlow)) {
			accounts.pause();
			accounts.clear();
		}
		session.accept(nextFlow);
		refreshInBackground = refreshSource && Boolean(nextFlow.sourceRefreshPending);
		// The background checks a restored correction with the time endpoint alone.
		verifyClockInBackground = !refreshInBackground && nextFlow.offlineStatus?.clockVerificationPending === true;
		clockVerificationPending = refreshInBackground || verifyClockInBackground;
		source.acceptFlow(nextFlow);
		renderOfflineState();
		renderAccountWarning();

		elements.setup.hidden = true;
		elements.openSource.hidden = true;
		sourceRecoveryError = null;
		accounts.configure(view);
		const boundCount = session.flow.boundAccountIds?.length || (session.flow.boundAccountId ? 1 : 0);
		renderPageHint(session.flow.canFill === false);
		renderKeyboardHelp();
		elements.remember.closest('label').hidden = session.flow.canFill === false || session.flow.accounts.length === 0;
		elements.scopeSite.hidden = session.flow.canFill === false;
		if (session.flow.accounts.length === 0) {
			accounts.clear();
			setStatus(() => t('popupNoAccounts'), 'notice');
		} else {
			setStatus(() => (boundCount > 1 ? tPlural('popupBoundAccounts', boundCount) : t('popupChooseAction')));
			accounts.render();
			// Catch notifications from an icon download that finished during startup.
			source.queueIcons();
		}
		if (canAuthorizeAutofill(session.flow)) {
			try {
				await autofill.refresh(nextFlow, version);
			} catch (error) {
				if (!closed && version === session.version) {
					setStatus(error, 'error');
					elements.actions.hidden = false;
				}
			}
		}
		if (closed || version !== session.version) {
			return;
		}
		if (session.flow.accounts.length === 0) {
			return;
		}
		if (session.flow.offlineStatus?.clockStatus === 'unavailable') {
			showSourceRecovery({ code: 'CLOCK_UNAVAILABLE', i18nKey: 'popupClockRetry' });
		}
		if (
			!skipAutomatic &&
			initialAutomaticEligible &&
			elements.autofill.checked &&
			!session.flow.sourceRefreshPending &&
			session.flow.offlineStatus?.clockStatus !== 'unavailable' &&
			session.flow.canFill !== false &&
			session.flow.autoFillAccountId
		) {
			automaticAccount = session.flow.accounts.find((account) => account.id === session.flow.autoFillAccountId) || null;
		}
		if (!skipAutomatic && !session.flow.sourceRefreshPending) {
			cancelInitialAutomatic();
		}
		return true;
	} catch (error) {
		if (closed || version !== session.version || configurationVersion !== source.configurationVersion) {
			return;
		}
		cancelInitialAutomatic();
		accounts.invalidate();
		accounts.clear();
		if (error.code === 'NOT_CONFIGURED') {
			elements.setup.hidden = false;
			setStatus(() => t('popupConnectFirst'), 'notice');
			return;
		}
		setStatus(error, 'error');
		elements.actions.hidden = false;
		showSourceRecovery(error);
		if (SOURCE_RECOVERY_CODES.has(error.code) || ['PERMISSION_REQUIRED', 'INVALID_RESPONSE'].includes(error.code)) {
			await autofill.recover(version, () => configurationVersion === source.configurationVersion).catch(() => {});
		}
	} finally {
		if (!closed && version === session.version) {
			if (!keepingView) {
				setBusy(false);
			}
			if (automaticAccount) {
				void fill(automaticAccount, false, { automatic: true });
			} else if (!busy && !elements.accountSection.hidden) {
				accounts.resume();
				if (view) {
					accounts.restore(view);
				} else {
					elements.search.focus();
				}
			}
			if (refreshInBackground) {
				void source.refreshInBackground({ allowAutomatic: !skipAutomatic && initialAutomaticEligible });
			} else if (verifyClockInBackground) {
				void source.refreshInBackground({ clockOnly: true });
			}
		}
	}
}
async function fill(account, confirmFocused = false, { automatic = false } = {}) {
	if (!automatic) {
		cancelInitialAutomatic();
	}
	if (busy || closed || source.clockRefreshPending || session.flow?.canFill === false) {
		return;
	}
	accounts.pause();
	accounts.hideToast();
	setBusy(true);
	elements.fillFocused.hidden = true;
	failedAccount = null;
	setStatus(() => t('popupFilling'), 'loading');
	let filled = false;
	let keepOpenForAuthorization = false;
	let retryAutomatic = false;
	try {
		await session.serialize(async () => {
			if (closed) {
				return;
			}
			await session.ensureFresh(account);
			if (closed) {
				return;
			}
			// A preview may renew the flow after another popup creates a binding.
			// The checkbox now describes this account. Hidden controls preserve its
			// saved choice without creating a new one; if filling fails, the visible
			// control reflects that choice.
			const rememberChoice = accounts.rememberFor(account.id);
			const remember = elements.remember.closest('label').hidden ? boundAccountIds().includes(account.id) : rememberChoice;
			session.consume();
			await send({
				type: MESSAGE.FILL_ACCOUNT,
				nonce: session.flow.nonce,
				account,
				remember,
				...(confirmFocused ? { confirmFocused: true } : {}),
				...(automatic ? { automatic: true } : {}),
			});
		});
		if (closed) {
			return;
		}
		filled = true;
		keepOpenForAuthorization = automatic && canAuthorizeAutofill(session.flow) && !elements.autofill.checked;
		setStatus(() => t('popupFilled'), 'success');
		if (!keepOpenForAuthorization) {
			closeTimer = setTimeout(() => window.close(), 450);
		}
	} catch (error) {
		if (closed) {
			return;
		}
		if (automatic && error.code === 'REQUEST_EXPIRED' && !automaticExpiredRetried) {
			automaticExpiredRetried = true;
			retryAutomatic = true;
			return;
		}
		if (['NO_INPUT', 'AMBIGUOUS_INPUT'].includes(error.code) && !confirmFocused) {
			failedAccount = account;
			elements.fillFocused.hidden = false;
			renderFocusedLabel();
		}
		if (!showSourceRecovery(error)) {
			setStatus(() => t('popupCopyAlternative', { error: localizeError(error) }), 'error');
		}
		elements.actions.hidden = false;
	} finally {
		if (!closed && (!filled || keepOpenForAuthorization)) {
			setBusy(false);
			if (session.flow && !elements.accountSection.hidden) {
				accounts.render();
				accounts.resume();
			}
			if (retryAutomatic) {
				// Reload the flow after the pending clock change; any interaction meanwhile cancels it.
				initialAutomaticEligible = true;
				source.queueRefresh({ force: true, allowAutomatic: true });
			}
		}
	}
}
async function openSource() {
	cancelInitialAutomatic();
	if (busy || closed) {
		return;
	}
	accounts.pause();
	accounts.hideToast();
	setBusy(true);
	setStatus(() => t('popupOpeningSource'), 'loading');
	try {
		await session.serialize(() => (closed ? null : send({ type: MESSAGE.OPEN_INSTANCE })));
		if (!closed) {
			setStatus(() => t('popupSourceOpened'), 'notice');
		}
	} catch (error) {
		if (!closed) {
			setStatus(error, 'error');
			elements.actions.hidden = false;
		}
	} finally {
		if (!closed) {
			setBusy(false);
		}
	}
}

const removeListeners = [];
function listen(target, type, handler) {
	target.addEventListener(type, handler);
	removeListeners.push(() => target.removeEventListener(type, handler));
}
for (const button of [elements.options, elements.setupOptions]) {
	listen(button, 'click', () => {
		cancelInitialAutomatic();
		void chrome.runtime.openOptionsPage();
	});
}
listen(elements.retry, 'click', () => {
	if (busy || closed) {
		return;
	}
	source.retry();
	initialAutomaticEligible = true;
	automaticExpiredRetried = false;
	void start();
});
listen(elements.remember, 'change', cancelInitialAutomatic);
listen(elements.fillFocused, 'click', () => {
	if (failedAccount && !busy) {
		elements.fillFocused.hidden = true;
		void fill(failedAccount, true);
	}
});
listen(elements.openSource, 'click', openSource);
listen(window, 'pagehide', () => {
	closed = true;
	clearTimeout(closeTimer);
	source.dispose();
	autofill.dispose();
	accounts.dispose();
	session.dispose();
	removeListeners.splice(0).forEach((remove) => remove());
});
function renderKeyboardHelp() {
	elements.keyboardHelp.textContent = t(session.flow?.canFill === false ? 'popupKeyboardCopy' : 'popupKeyboardFill');
	elements.search.title = elements.keyboardHelp.textContent;
}
function renderFocusedLabel() {
	if (failedAccount) {
		elements.fillFocused.textContent = t('popupFillFocusedAccount', {
			name: failedAccount.name,
			account: failedAccount.account ? t('popupAccountSuffix', { account: failedAccount.account }) : '',
		});
	}
}
removeListeners.push(
	onLanguageChange(() => {
		if (closed) {
			return;
		}
		renderStatus();
		renderOfflineState(true);
		renderAccountWarning(true);
		renderPageHint(session.flow?.canFill === false, true);
		renderKeyboardHelp();
		renderFocusedLabel();
		accounts.retranslate();
		source.retranslate();
	}),
);
void initI18n().then((dispose) => {
	if (closed) {
		dispose();
		return;
	}
	removeListeners.push(dispose);
	return start();
});
