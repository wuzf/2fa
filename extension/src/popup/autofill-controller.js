import { t } from '../shared/i18n.js';
import { MESSAGE, createNonce } from '../shared/protocol.js';
import {
	normalizeAutofillTargetOrigin,
	normalizeAutofillPath,
	targetOriginToPermissionPattern,
	autofillCoverage,
	AUTOFILL_SITE_SCOPE,
} from '../shared/origin.js';
import { sameFlowTarget } from './flow-session.js';

export function canAuthorizeAutofill(flow) {
	try {
		return Boolean(
			flow &&
			flow.canFill !== false &&
			Number.isInteger(flow.targetTabId) &&
			flow.targetDocumentId &&
			normalizeAutofillTargetOrigin(flow.targetOrigin) === flow.targetOrigin &&
			normalizeAutofillPath(flow.targetPath) === flow.targetPath &&
			flow.targetOrigin !== flow.instanceOrigin,
		);
	} catch {
		return false;
	}
}

function localizedError(key) {
	return Object.assign(new Error(t(key)), { i18nKey: key });
}

// Owns the permission UI intent. request() is called in the original click
// stack, and dispose never cancels an intent already handed to the worker.
export function createAutofillController({
	elements,
	session,
	accounts,
	send,
	isBusy,
	setBusy,
	setStatus,
	onInteraction,
	onRestart,
	onStateChange,
}) {
	let closed = false;
	let autofillState = null;
	let pendingAutofill = null;
	let recoveryContext = null;
	let stateVersion = 0;
	const currentTarget = () => recoveryContext || session.flow;
	// null until this page's grants are known or when it cannot be authorized;
	// otherwise 'site', 'page' (a page grant from an earlier version) or 'none'.
	function coverage(target = currentTarget()) {
		if (!canAuthorizeAutofill(target) || !autofillState || autofillState.instanceOrigin !== target.instanceOrigin) {
			return null;
		}
		return autofillCoverage(autofillState.sites, target.instanceOrigin, target.targetOrigin, target.targetPath) || 'none';
	}
	function setKey(element, attribute, key) {
		element.setAttribute(attribute === 'text' ? 'data-i18n' : `data-i18n-${attribute}`, key);
		if (attribute === 'text') {
			element.textContent = t(key);
		} else {
			element.setAttribute(attribute, t(key));
		}
	}
	function renderAutofillState() {
		const target = currentTarget();
		const available = canAuthorizeAutofill(target);
		const scope = coverage(target);
		const label = elements.autofill.closest('label');
		label.hidden = !available;
		elements.autofill.disabled = isBusy() || !available || scope === null;
		elements.autofill.setAttribute('aria-busy', String(Boolean(pendingAutofill)));
		elements.autofill.checked =
			pendingAutofill && sameFlowTarget(pendingAutofill.expectedFlow, target)
				? pendingAutofill.enabled
				: scope === 'site' || scope === 'page';
		// A page grant keeps its page wording until it is turned off; turning
		// autofill on always covers the whole website.
		const page = scope === 'page';
		setKey(elements.autofillTitle, 'text', page ? 'popupAutofillTitle' : 'popupAutofillSiteTitle');
		setKey(elements.autofillDescription, 'text', page ? 'popupAutofillDescription' : 'popupAutofillSiteDescription');
		setKey(label, 'title', page ? 'popupAutofillHint' : 'popupAutofillSiteHint');
		onStateChange?.();
	}
	async function refreshAutofillState(expectedFlow, version) {
		const currentStateVersion = stateVersion;
		const result = await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		if (closed || currentStateVersion !== stateVersion || version !== session.version || !sameFlowTarget(expectedFlow, session.flow)) {
			return;
		}
		if (result?.instanceOrigin !== expectedFlow.instanceOrigin || !Array.isArray(result.sites)) {
			throw localizedError('popupAutofillInstanceChanged');
		}
		recoveryContext = null;
		autofillState = result;
		renderAutofillState();
	}
	async function recoverAutofillState(version, isCurrent, expectedTarget = null) {
		const currentStateVersion = stateVersion;
		const result = await send({ type: MESSAGE.GET_AUTOFILL_CONTEXT });
		if (closed || currentStateVersion !== stateVersion || version !== session.version || !isCurrent()) {
			return;
		}
		if (!canAuthorizeAutofill(result) || !Array.isArray(result.sites)) {
			return;
		}
		if (expectedTarget && !sameFlowTarget(expectedTarget, result)) {
			autofillState = null;
			renderAutofillState();
			return;
		}
		recoveryContext = result;
		autofillState = result;
		renderAutofillState();
	}
	// Must be called in the click's own stack: the worker receives the intent
	// before the permission prompt opens, because the browser can close this
	// popup while that prompt is active. Resolves to { status: 'enabled', data },
	// 'denied', 'closed' or 'failed' with the error; it never rejects.
	function requestSiteGrant(expectedFlow, extra = {}) {
		const requestId = createNonce();
		const prepared = send({
			type: MESSAGE.BEGIN_AUTOFILL_AUTHORIZATION,
			requestId,
			instanceOrigin: expectedFlow.instanceOrigin,
			mode: expectedFlow.authMode,
			configurationGeneration: expectedFlow.configurationGeneration,
			targetOrigin: expectedFlow.targetOrigin,
			targetPath: AUTOFILL_SITE_SCOPE,
			pagePath: expectedFlow.targetPath,
			expectedTarget: {
				tabId: expectedFlow.targetTabId,
				documentId: expectedFlow.targetDocumentId,
				origin: expectedFlow.targetOrigin,
				targetPath: expectedFlow.targetPath,
			},
			...extra,
		}).then(
			(data) => ({ data }),
			(error) => ({ error }),
		);
		let permission;
		try {
			// No await before request: retain the original click's user activation.
			permission = chrome.permissions.request({ origins: [targetOriginToPermissionPattern(expectedFlow.targetOrigin)] });
		} catch (error) {
			permission = Promise.reject(error);
		}
		const cancel = () => send({ type: MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION, requestId }).catch(() => {});
		return (async () => {
			try {
				if (!(await permission)) {
					await cancel();
					return { status: 'denied' };
				}
				const preparation = await prepared;
				if (preparation.error) {
					throw preparation.error;
				}
				if (closed) {
					return { status: 'closed' };
				}
				const result = await send({ type: MESSAGE.COMPLETE_AUTOFILL_AUTHORIZATION, requestId });
				if (result?.status !== 'enabled') {
					throw localizedError('popupAuthorizationIncomplete');
				}
				if (result.instanceOrigin !== expectedFlow.instanceOrigin || !Array.isArray(result.sites)) {
					throw localizedError('popupInstanceChanged');
				}
				return { status: 'enabled', data: result };
			} catch (error) {
				await cancel();
				return { status: 'failed', error };
			}
		})();
	}
	// A fill click on a page without a grant, with "Autofill this account on
	// this website" checked. The fill itself continues meanwhile; the worker
	// also remembers the account when the grant completes.
	function authorizeWithFill(account) {
		const expectedFlow = currentTarget();
		const version = session.version;
		const currentStateVersion = stateVersion;
		let pending = true;
		const done = requestSiteGrant(expectedFlow, { rememberAccount: account }).then((outcome) => {
			pending = false;
			if (
				outcome.status === 'enabled' &&
				!closed &&
				currentStateVersion === stateVersion &&
				version === session.version &&
				sameFlowTarget(expectedFlow, currentTarget())
			) {
				autofillState = outcome.data;
				renderAutofillState();
			}
			return outcome;
		});
		return {
			done,
			get pending() {
				return pending;
			},
		};
	}
	async function toggleAutofillSite() {
		onInteraction();
		const expectedFlow = currentTarget();
		const version = session.version;
		const currentStateVersion = stateVersion;
		const enabled = elements.autofill.checked;
		const scope = coverage(expectedFlow);
		if (isBusy() || closed || scope === null) {
			renderAutofillState();
			return;
		}
		// Turning a page grant off keeps the page wording in the messages.
		const site = enabled || scope !== 'page';
		const pending = { expectedFlow, enabled };
		pendingAutofill = pending;
		accounts.pause();
		setBusy(true);
		setStatus(() => t(enabled ? 'popupEnablingAutofill' : site ? 'popupDisablingSiteAutofill' : 'popupDisablingAutofill'), 'loading');
		let changed = false;
		try {
			let result;
			if (enabled) {
				const outcome = await requestSiteGrant(expectedFlow);
				if (outcome.status === 'closed') {
					return;
				}
				if (outcome.status === 'denied') {
					throw localizedError('popupAutofillDenied');
				}
				if (outcome.status === 'failed') {
					throw outcome.error;
				}
				result = outcome.data;
			} else {
				result = await session.serialize(async () => {
					if (
						closed ||
						currentStateVersion !== stateVersion ||
						version !== session.version ||
						!sameFlowTarget(expectedFlow, currentTarget())
					) {
						throw localizedError('popupAuthorizationTargetChanged');
					}
					// Revocation only removes the captured policy and must work without
					// reading accounts. The worker clears the pending nonce after saving.
					session.consume();
					return send({
						type: MESSAGE.SET_AUTOFILL_SITE,
						instanceOrigin: expectedFlow.instanceOrigin,
						targetOrigin: expectedFlow.targetOrigin,
						// Turning a site-wide grant off removes the origin's grants.
						targetPath: scope === 'site' ? AUTOFILL_SITE_SCOPE : expectedFlow.targetPath,
						enabled: false,
					});
				});
			}
			if (result?.instanceOrigin !== expectedFlow.instanceOrigin || !Array.isArray(result.sites)) {
				throw localizedError('popupInstanceChanged');
			}
			changed = true;
			if (!closed && currentStateVersion === stateVersion && version === session.version && sameFlowTarget(expectedFlow, currentTarget())) {
				autofillState = result;
				if (enabled) {
					// The worker owns the immediate attempt; do not fill twice from here.
					const refreshed = await onRestart({ skipAutomatic: true, expectedFlow });
					if (refreshed && !closed) {
						setStatus(() => t('popupAutofillEnabled'), 'success');
					}
				} else {
					// Keep the saved result even if subsequent code previews cannot connect.
					setStatus(() => t(site ? 'popupSiteAutofillDisabled' : 'popupAutofillDisabled'), 'success');
					// Revocation advances the configuration generation. Renew authorization
					// directly: a filtered or unavailable preview cannot renew it for us.
					await recoverAutofillState(version, () => sameFlowTarget(expectedFlow, currentTarget()), expectedFlow).catch(() => {});
				}
			}
		} catch (error) {
			if (!closed && currentStateVersion === stateVersion && version === session.version) {
				setStatus(error, 'error');
				elements.actions.hidden = false;
			}
		} finally {
			if (pendingAutofill === pending) {
				pendingAutofill = null;
			}
			if (!closed) {
				renderAutofillState();
			}
			if (!closed && version === session.version) {
				setBusy(false);
				if (currentStateVersion === stateVersion && (!changed || !enabled)) {
					accounts.resume();
				}
			}
		}
	}

	const onToggle = () => void toggleAutofillSite();
	elements.autofill.addEventListener('click', onToggle);
	return {
		render: renderAutofillState,
		refresh: refreshAutofillState,
		recover: recoverAutofillState,
		coverage: () => coverage(),
		authorizeWithFill,
		reset() {
			stateVersion += 1;
			autofillState = null;
			recoveryContext = null;
		},
		dispose() {
			closed = true;
			elements.autofill.removeEventListener('click', onToggle);
		},
	};
}
