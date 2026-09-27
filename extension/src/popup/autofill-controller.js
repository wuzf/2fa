import { t } from '../shared/i18n.js';
import { MESSAGE, createNonce } from '../shared/protocol.js';
import {
	isManualOnlyTargetOrigin,
	normalizeAutofillTargetOrigin,
	normalizeAutofillPath,
	targetOriginToPermissionPattern,
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

// A fillable plain-HTTP network page (for example 192.168.1.1) supports manual
// filling only. Show the switch as unavailable instead of silently hiding it.
export function isManualOnlyAutofillTarget(flow) {
	return Boolean(
		flow &&
		flow.canFill !== false &&
		Number.isInteger(flow.targetTabId) &&
		flow.targetDocumentId &&
		flow.targetOrigin !== flow.instanceOrigin &&
		isManualOnlyTargetOrigin(flow.targetOrigin),
	);
}

// Owns the permission UI intent. request() is called in the original click
// stack, and dispose never cancels an intent already handed to the worker.
export function createAutofillController({ elements, session, accounts, send, isBusy, setBusy, setStatus, onInteraction, onRestart }) {
	let closed = false;
	let autofillState = null;
	let pendingAutofill = null;
	let recoveryContext = null;
	let stateVersion = 0;
	const currentTarget = () => recoveryContext || session.flow;
	function renderAutofillReason(manualOnly) {
		// Keep the keys in i18n attributes so a language change keeps the reason.
		// The unavailable switch explains itself on screen, not only on hover.
		const label = elements.autofill.closest('label');
		const hintKey = manualOnly ? 'popupAutofillHttpManual' : 'popupAutofillHint';
		const descriptionKey = manualOnly ? 'popupAutofillHttpManual' : 'popupAutofillDescription';
		label.setAttribute('data-i18n-title', hintKey);
		label.title = t(hintKey);
		if (elements.autofillDescription) {
			elements.autofillDescription.setAttribute('data-i18n', descriptionKey);
			elements.autofillDescription.textContent = t(descriptionKey);
		}
		if (elements.autofillNote) {
			elements.autofillNote.hidden = !manualOnly;
		}
	}
	function renderAutofillState() {
		const target = currentTarget();
		const available = canAuthorizeAutofill(target);
		const manualOnly = !available && isManualOnlyAutofillTarget(target);
		const loaded = Boolean(autofillState && target && autofillState.instanceOrigin === target.instanceOrigin);
		elements.autofill.closest('label').hidden = !available && !manualOnly;
		elements.autofill.disabled = manualOnly || isBusy() || !available || !loaded;
		elements.autofill.setAttribute('aria-busy', String(Boolean(pendingAutofill)));
		renderAutofillReason(manualOnly);
		elements.autofill.checked =
			!manualOnly &&
			(pendingAutofill && sameFlowTarget(pendingAutofill.expectedFlow, target)
				? pendingAutofill.enabled
				: Boolean(
						loaded &&
						autofillState.sites.some(
							(site) =>
								site.instanceOrigin === target.instanceOrigin &&
								site.targetOrigin === target.targetOrigin &&
								site.targetPath === target.targetPath,
						),
					));
	}
	async function refreshAutofillState(expectedFlow, version) {
		const currentStateVersion = stateVersion;
		const result = await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		if (closed || currentStateVersion !== stateVersion || version !== session.version || !sameFlowTarget(expectedFlow, session.flow)) {
			return;
		}
		if (result?.instanceOrigin !== expectedFlow.instanceOrigin || !Array.isArray(result.sites)) {
			throw Object.assign(new Error(t('popupAutofillInstanceChanged')), { i18nKey: 'popupAutofillInstanceChanged' });
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
	async function toggleAutofillSite() {
		onInteraction();
		const expectedFlow = currentTarget();
		const version = session.version;
		const currentStateVersion = stateVersion;
		const enabled = elements.autofill.checked;
		if (isBusy() || closed || !canAuthorizeAutofill(expectedFlow) || autofillState?.instanceOrigin !== expectedFlow.instanceOrigin) {
			renderAutofillState();
			return;
		}
		const pending = { expectedFlow, enabled };
		pendingAutofill = pending;
		accounts.pause();
		setBusy(true);
		setStatus(() => (enabled ? t('popupEnablingAutofill') : t('popupDisablingAutofill')), 'loading');
		let changed = false;
		let requestId = null;
		try {
			let result;
			if (enabled) {
				requestId = createNonce();
				// Hand the explicit intent to the worker before opening the permission
				// prompt. The browser can close this popup while that prompt is active.
				const prepared = send({
					type: MESSAGE.BEGIN_AUTOFILL_AUTHORIZATION,
					requestId,
					instanceOrigin: expectedFlow.instanceOrigin,
					mode: expectedFlow.authMode,
					configurationGeneration: expectedFlow.configurationGeneration,
					targetOrigin: expectedFlow.targetOrigin,
					targetPath: expectedFlow.targetPath,
					expectedTarget: {
						tabId: expectedFlow.targetTabId,
						documentId: expectedFlow.targetDocumentId,
						origin: expectedFlow.targetOrigin,
						targetPath: expectedFlow.targetPath,
					},
				}).then(
					(data) => ({ data }),
					(error) => ({ error }),
				);
				// No await before request: retain the original click's user activation.
				const granted = await chrome.permissions.request({ origins: [targetOriginToPermissionPattern(expectedFlow.targetOrigin)] });
				if (!granted) {
					await send({ type: MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION, requestId });
					requestId = null;
					throw Object.assign(new Error(t('popupAutofillDenied')), { i18nKey: 'popupAutofillDenied' });
				}
				const preparation = await prepared;
				if (preparation.error) {
					throw preparation.error;
				}
				if (closed) {
					return;
				}
				result = await send({ type: MESSAGE.COMPLETE_AUTOFILL_AUTHORIZATION, requestId });
				if (result?.status !== 'enabled') {
					throw Object.assign(new Error(t('popupAuthorizationIncomplete')), { i18nKey: 'popupAuthorizationIncomplete' });
				}
			} else {
				result = await session.serialize(async () => {
					if (
						closed ||
						currentStateVersion !== stateVersion ||
						version !== session.version ||
						!sameFlowTarget(expectedFlow, currentTarget())
					) {
						throw Object.assign(new Error(t('popupAuthorizationTargetChanged')), { i18nKey: 'popupAuthorizationTargetChanged' });
					}
					// Revocation only removes the captured policy and must work without
					// reading accounts. The worker clears the pending nonce after saving.
					session.consume();
					return send({
						type: MESSAGE.SET_AUTOFILL_SITE,
						instanceOrigin: expectedFlow.instanceOrigin,
						targetOrigin: expectedFlow.targetOrigin,
						targetPath: expectedFlow.targetPath,
						enabled: false,
					});
				});
			}
			if (result?.instanceOrigin !== expectedFlow.instanceOrigin || !Array.isArray(result.sites)) {
				throw Object.assign(new Error(t('popupInstanceChanged')), { i18nKey: 'popupInstanceChanged' });
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
					setStatus(() => t('popupAutofillDisabled'), 'success');
					// Revocation advances the configuration generation. Renew authorization
					// directly: a filtered or unavailable preview cannot renew it for us.
					await recoverAutofillState(version, () => sameFlowTarget(expectedFlow, currentTarget()), expectedFlow).catch(() => {});
				}
			}
		} catch (error) {
			if (requestId && !changed) {
				await send({ type: MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION, requestId }).catch(() => {});
			}
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
