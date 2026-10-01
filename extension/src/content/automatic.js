import { createAutomaticObservation } from './automatic-observation.js';
import { createAutomaticPanel } from './automatic-panel.js';
import { createModalGuard } from './dom.js';
import { detectOtpTarget, isWritableInput } from './form.js';
import { createContentController, disposeRegisteredContentListener } from './index.js';
import { readLoginContext } from './login-context.js';
import { loginContextsMatch } from '../shared/login-context.js';
import { autofillPathFromUrl } from '../shared/origin.js';
import { MESSAGE, createNonce, isValidNonce, sanitizeAccountList, makePublicError } from '../shared/protocol.js';
import { isExtensionContextInvalidated } from '../shared/runtime.js';
import { initI18n, t } from '../shared/i18n.js';

const MARKER = '__twoFaAutomaticContentController__';
const unavailable = () => makePublicError('TARGET_UNAVAILABLE', t('contentErrorAutomaticUnavailable'));
const USER_ACTION_ERRORS = new Set(['AUTH_REQUIRED', 'PERMISSION_REQUIRED', 'NOT_CONFIGURED', 'INVALID_RESPONSE']);
function validRevision(value) {
	return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 200);
}

function sameTarget(left, right) {
	return Boolean(
		left &&
		right &&
		left.kind === right.kind &&
		left.fingerprint === right.fingerprint &&
		left.inputs.length === right.inputs.length &&
		left.inputs.every((input, index) => input === right.inputs[index]),
	);
}

// This controller has its own nonces and target guard; manual filling keeps its
// deliberate replacement semantics in the ordinary content controller.
export function createAutomaticController({
	doc = globalThis.document,
	runtime = globalThis.chrome?.runtime,
	initializeLanguage = false,
} = {}) {
	let touched = new WeakSet();
	let completed = new WeakSet();
	let enabled = false;
	let generation = 0;
	let episode = null;
	let observedUrl = doc.location.href;
	let visitPath = autofillPathFromUrl(observedUrl);
	let authorizedPath = null;
	let writing = false;
	let codeDelivered = false;
	let disposed = false;
	let suppressedContext = null;
	// Sign-in identities that already received an automatic complete code, by
	// path. Unlike suppressedContext this outlives route changes: an SPA that
	// leaves the path after a rejected code and returns stays blocked until the
	// document reloads.
	const deliveredPaths = new Map();
	let awaitingIdentity = false;
	let actionRequired = null;
	let recoveryRevision = null;
	let disposeLanguage = () => {};
	const languageReady = initializeLanguage
		? initI18n({ root: null, runtime })
				.then((cleanup) => {
					disposeLanguage = cleanup;
					if (disposed) {
						disposeLanguage();
					}
				})
				.catch(() => {
					dispose();
					disposeRegisteredContentListener();
				})
		: null;

	const visible = () => observation.isVisible();
	const request = async (message) => {
		if (disposed) {
			return unavailable();
		}
		try {
			if (isExtensionContextInvalidated(runtime)) {
				dispose();
				disposeRegisteredContentListener();
				return unavailable();
			}
			return await runtime.sendMessage(message);
		} catch (error) {
			if (isExtensionContextInvalidated(runtime, error)) {
				dispose();
				disposeRegisteredContentListener();
				return unavailable();
			}
			return makePublicError('CONNECTION_FAILED', t('contentErrorConnectionFailed'));
		}
	};
	const isCurrent = (current, { allowOwnValues = false, allowCompletedLock = false } = {}) => {
		let modalGuard;
		if (
			!enabled ||
			!visible() ||
			episode !== current ||
			current.targetPath !== authorizedPath ||
			current.targetPath !== autofillPathFromUrl(doc.location.href) ||
			current.url !== doc.location.href ||
			!loginContextsMatch(current.loginContext, readLoginContext(doc)) ||
			current.target.inputs.some(
				(input) =>
					!isWritableInput(input, (modalGuard ||= createModalGuard(doc)), { allowLocked: allowCompletedLock }) ||
					touched.has(input) ||
					completed.has(input) ||
					(!allowOwnValues && input.value !== ''),
			)
		) {
			return false;
		}
		const result = detectOtpTarget(doc, { allowLockedInputs: allowCompletedLock ? current.target.inputs : [] });
		return result.status === 'ready' && result.target.selection === 'unique' && sameTarget(current.target, result.target);
	};
	const passive = createContentController({
		doc,
		detectionTimeoutMs: 0,
		getExplicitFocusedInput: () => null,
		targetGuard: ({ target, allowCompletedLock = false }) =>
			Boolean(
				episode &&
				isCurrent(episode, { allowOwnValues: writing, allowCompletedLock: writing && allowCompletedLock }) &&
				(!target || sameTarget(episode.target, target)),
			),
		onCodeDelivered: () => {
			codeDelivered ||= writing;
		},
	});

	const panel = createAutomaticPanel({ doc });
	const observation = createAutomaticObservation({
		doc,
		isEnabled: () => enabled,
		isPanelHost: panel.isHost,
		onInspect: inspect,
		onInput,
		onNavigation,
		onPause: pause,
		onResume: () => void refresh(),
		onPosition: panel.position,
	});

	function cancel(block = false, blocked = episode) {
		if (block && blocked) {
			suppressedContext = { targetPath: blocked.targetPath, loginContext: blocked.loginContext };
			for (const input of blocked.target.inputs) {
				completed.add(input);
			}
		}
		clearTimeout(episode?.refreshTimer);
		clearTimeout(episode?.rediscoveryTimer);
		episode = null;
		passive.clearPending();
		panel.remove();
		if (block && suppressedContext) {
			pauseSuppressed();
		}
	}

	function recordDelivery(current) {
		const identities = deliveredPaths.get(current.targetPath) || [];
		identities.push(current.loginContext);
		deliveredPaths.set(current.targetPath, identities);
	}

	function blockingIdentities() {
		return [
			...(suppressedContext?.targetPath === visitPath ? [suppressedContext.loginContext] : []),
			...(deliveredPaths.get(visitPath) || []),
		];
	}

	function isSuppressed() {
		const identities = blockingIdentities();
		if (!identities.length) {
			return false;
		}
		const currentLogin = readLoginContext(doc);
		// Missing/hidden identity during a rerender is not proof of a new user.
		return identities.some((loginContext) => !loginContext || !currentLogin || loginContextsMatch(loginContext, currentLogin));
	}

	function pauseSuppressed() {
		// Only an explicit identity can later end this pause on the same route.
		const identities = blockingIdentities();
		awaitingIdentity = identities.length > 0 && identities.every(Boolean);
		observation.pause();
	}

	function updateVisit() {
		const path = autofillPathFromUrl(doc.location.href);
		if (path === visitPath) {
			return false;
		}
		stop();
		visitPath = path;
		touched = new WeakSet();
		completed = new WeakSet();
		suppressedContext = null;
		awaitingIdentity = false;
		actionRequired = null;
		recoveryRevision = null;
		return true;
	}

	function requireUserAction(current, result) {
		if (!USER_ACTION_ERRORS.has(result?.error?.code)) {
			return false;
		}
		const recovery = current.pendingRevision;
		actionRequired = { code: result.error.code, instanceOrigin: current.instanceOrigin };
		current.dirtyQueued = false;
		current.refreshSourceQueued = false;
		current.pendingRevision = null;
		clearTimeout(current.refreshTimer);
		clearTimeout(current.rediscoveryTimer);
		current.rediscoveryTimer = null;
		if (recovery && (recovery.revision !== null || recovery.clockRevision !== null)) {
			// A successful source update can arrive before an older request returns
			// its authentication failure. Preserve one attempt for that new notice.
			onAccountsChanged(recovery);
			if (!actionRequired) {
				return true;
			}
		}
		showPanel(current, [], true);
		return true;
	}

	function scheduleAccountRefresh(current) {
		clearTimeout(current.refreshTimer);
		if (actionRequired || !isCurrent(current) || current.discovering || current.selecting || current.dirtyQueued) {
			return;
		}
		// Only an unresolved, empty OTP episode checks for changes on other devices.
		current.refreshTimer = setTimeout(() => queueRediscovery(current, true), 30000);
	}

	function queueRediscovery(current, refreshSource = false, notification = null, recover = false) {
		if (!current || !isCurrent(current)) {
			return;
		}
		if (notification) {
			if (current.instanceOrigin && current.instanceOrigin !== notification.instanceOrigin) {
				return;
			}
			if (
				!recover &&
				(notification.revision !== null || notification.clockRevision !== null) &&
				notification.revision === current.revision &&
				notification.clockRevision === current.clockRevision
			) {
				return;
			}
			current.pendingRevision = notification;
		}
		if (recover) {
			actionRequired = null;
		}
		if (actionRequired) {
			return;
		}
		current.dirtyQueued = true;
		current.refreshSourceQueued ||= refreshSource;
		clearTimeout(current.refreshTimer);
		if (current.discovering || current.selecting || current.rediscoveryTimer) {
			return;
		}
		current.rediscoveryTimer = setTimeout(() => {
			current.rediscoveryTimer = null;
			if (!isCurrent(current)) {
				return;
			}
			const fresh = Boolean(current.refreshSourceQueued);
			current.refreshSourceQueued = false;
			current.dirtyQueued = false;
			current.pendingRevision = null;
			void discover(current, fresh);
		}, 100);
	}

	function onAccountsChanged(message) {
		if (typeof message.instanceOrigin !== 'string' || !validRevision(message.revision) || !validRevision(message.clockRevision)) {
			return;
		}
		const revision = JSON.stringify([message.instanceOrigin, message.revision, message.clockRevision]);
		const recovering = Boolean(actionRequired);
		if (actionRequired) {
			if ((actionRequired.instanceOrigin && actionRequired.instanceOrigin !== message.instanceOrigin) || recoveryRevision === revision) {
				return;
			}
			recoveryRevision = revision;
			actionRequired = null;
		}
		queueRediscovery(
			episode,
			false,
			{
				instanceOrigin: message.instanceOrigin,
				revision: message.revision,
				clockRevision: message.clockRevision,
			},
			recovering,
		);
		if (!episode) {
			observation.schedule();
		}
	}

	function showPanel(current, accounts, failed = false) {
		if (!isCurrent(current)) {
			return;
		}
		panel.show({
			input: current.target.inputs[0],
			accounts,
			failed,
			onClose: () => cancel(true),
			onDetached: () => {
				if (episode === current) {
					// A dialog can reopen before the next DOM scan. Its removed picker
					// must also retire this episode and any in-flight selection.
					cancel();
					observation.schedule();
				}
			},
			onRetry: () => {
				if (isCurrent(current)) {
					queueRediscovery(current, true, null, true);
				}
			},
			onSelect: (accountId) => {
				if (isCurrent(current) && !current.selecting) {
					void select(current, accountId, false);
				}
			},
		});
	}

	async function select(current, accountId, automatic) {
		if (!isCurrent(current) || current.selecting || current.discovering || current.dirtyQueued) {
			return;
		}
		current.selecting = true;
		panel.setSelecting();
		const result = await request({
			type: MESSAGE.AUTO_SELECT,
			nonce: current.nonce,
			episodeNonce: current.episodeNonce,
			targetPath: current.targetPath,
			accountId,
			automatic,
		});
		current.selecting = false;
		if (episode !== current) {
			return;
		}
		if (result?.ok && result.data?.status === 'filled') {
			cancel(true);
		} else if (isCurrent(current)) {
			if (requireUserAction(current, result)) {
				return;
			}
			if (current.dirtyQueued) {
				queueRediscovery(current);
			} else if (result?.error?.code === 'REQUEST_EXPIRED' && current.retries++ < 1) {
				queueRediscovery(current, true);
			} else {
				showPanel(current, [], true);
			}
			scheduleAccountRefresh(current);
		}
	}

	async function discover(current, refreshSource = true) {
		if (actionRequired || !isCurrent(current) || current.discovering || current.selecting) {
			return;
		}
		current.discovering = true;
		clearTimeout(current.refreshTimer);
		current.episodeNonce = createNonce();
		current.nonce = null;
		passive.clearPending();
		panel.remove();
		const result = await request({
			type: MESSAGE.AUTO_DISCOVER,
			episodeNonce: current.episodeNonce,
			targetPath: current.targetPath,
			refreshSource,
		});
		current.discovering = false;
		if (!isCurrent(current)) {
			return;
		}
		if (requireUserAction(current, result)) {
			return;
		}
		if (result?.ok) {
			current.instanceOrigin = result.data?.instanceOrigin;
			current.revision = result.data?.revision ?? null;
			current.clockRevision = result.data?.clockRevision ?? null;
			const pending = current.pendingRevision;
			const covered =
				pending &&
				current.instanceOrigin &&
				(pending.instanceOrigin !== current.instanceOrigin ||
					((current.revision !== null || current.clockRevision !== null) &&
						current.revision === pending.revision &&
						current.clockRevision === pending.clockRevision));
			// A fresh read may broadcast its own new cache revision before replying.
			// Use that returned snapshot directly when it already covers the notice.
			if (covered && !current.refreshSourceQueued) {
				current.dirtyQueued = false;
				current.pendingRevision = null;
			}
		}
		if (current.dirtyQueued) {
			queueRediscovery(current);
			return;
		}
		const accounts = result?.ok && sanitizeAccountList(result.data?.accounts);
		if (!accounts || !isValidNonce(result.data?.nonce)) {
			if (result?.error?.code === 'REQUEST_EXPIRED' && current.retries++ < 1) {
				// A source hint can invalidate this discovery without changing the
				// cache revision, so no ACCOUNTS_CHANGED notice is guaranteed.
				queueRediscovery(current, false);
				return;
			}
			showPanel(current, [], true);
			scheduleAccountRefresh(current);
			return;
		}
		current.nonce = result.data.nonce;
		const automaticId = result.data.autoFillAccountId;
		if (typeof automaticId === 'string' && accounts.some((account) => account.id === automaticId)) {
			await select(current, automaticId, true);
		} else if (accounts.length) {
			showPanel(current, accounts);
		}
		scheduleAccountRefresh(current);
	}

	function inspect() {
		if (!enabled || !visible()) {
			return;
		}
		if (autofillPathFromUrl(doc.location.href) !== authorizedPath) {
			onNavigation();
			return;
		}
		if (isSuppressed()) {
			pauseSuppressed();
			return;
		}
		suppressedContext = null;
		awaitingIdentity = false;
		observation.refreshRootsIfDirty();
		if (episode) {
			if (isCurrent(episode)) {
				panel.position();
				return;
			}
			cancel();
		}
		const result = detectOtpTarget(doc);
		if (result.status === 'ready') {
			for (const input of result.target.inputs) {
				if (input.value !== '') {
					touched.add(input);
				}
			}
		}
		if (
			result.status !== 'ready' ||
			result.target.selection !== 'unique' ||
			result.target.inputs.some((input) => input.value !== '' || touched.has(input) || completed.has(input))
		) {
			return;
		}
		episode = {
			episodeNonce: createNonce(),
			target: result.target,
			loginContext: readLoginContext(doc),
			url: doc.location.href,
			targetPath: authorizedPath,
			instanceOrigin: actionRequired?.instanceOrigin,
			retries: 0,
		};
		if (actionRequired) {
			showPanel(episode, [], true);
		} else {
			void discover(episode);
		}
	}

	function onInput(event) {
		const input = event.composedPath?.()[0] || event.target;
		if (input?.tagName !== 'INPUT' || (writing && !event.isTrusted)) {
			return;
		}
		const alreadyTouched = touched.has(input);
		touched.add(input);
		if (episode?.target.inputs.includes(input)) {
			cancel(true);
		} else if (!episode && !alreadyTouched) {
			const target = detectOtpTarget(doc);
			if (target.status === 'ready' && target.target.inputs.includes(input)) {
				suppressedContext = { targetPath: visitPath, loginContext: readLoginContext(doc) };
				cancel(true);
			}
		}
	}

	function pause() {
		cancel();
		observation.pause();
	}

	function stop() {
		generation += 1;
		enabled = false;
		authorizedPath = null;
		pause();
	}

	async function refresh({ allowRecovery = false } = {}) {
		if (disposed) {
			return;
		}
		observation.watchNavigation();
		updateVisit();
		if (allowRecovery) {
			actionRequired = null;
		}
		observedUrl = doc.location.href;
		const targetPath = autofillPathFromUrl(observedUrl);
		if (!targetPath) {
			stop();
			return;
		}
		const token = ++generation;
		if (languageReady) {
			await languageReady;
			if (generation !== token || disposed || targetPath !== autofillPathFromUrl(doc.location.href)) {
				return;
			}
		}
		const result = await request({ type: MESSAGE.AUTO_STATUS, targetPath });
		if (generation !== token || disposed || targetPath !== autofillPathFromUrl(doc.location.href)) {
			return;
		}
		enabled = Boolean(result?.ok && result.data?.enabled);
		authorizedPath = enabled ? targetPath : null;
		if (!enabled || !visible()) {
			pause();
			return;
		}
		if (isSuppressed()) {
			pauseSuppressed();
			return;
		}
		observation.start();
		if (episode && isCurrent(episode)) {
			queueRediscovery(episode, true);
		}
		observation.schedule();
	}

	async function handle(message) {
		if (disposed) {
			return unavailable();
		}
		if (message.type === MESSAGE.AUTO_STOP) {
			stop();
			return { ok: true };
		}
		if (message.type === MESSAGE.AUTO_REFRESH) {
			await refresh({ allowRecovery: true });
			return { ok: true };
		}
		if (message.type === MESSAGE.ACCOUNTS_CHANGED) {
			onAccountsChanged(message);
			return { ok: true };
		}
		const current = episode;
		if (
			!current ||
			!isValidNonce(message.episodeNonce) ||
			message.episodeNonce !== current.episodeNonce ||
			message.expectedOrigin !== doc.location.origin ||
			message.expectedTargetPath !== current.targetPath ||
			message.expectedTargetPath !== autofillPathFromUrl(doc.location.href) ||
			(current.selecting && current.dirtyQueued) ||
			!isCurrent(current)
		) {
			return unavailable();
		}
		if (message.type === MESSAGE.AUTO_PROBE) {
			return {
				ok: true,
				status: 'ready',
				origin: doc.location.origin,
				targetPath: current.targetPath,
				...(current.loginContext ? { loginContext: current.loginContext } : {}),
			};
		}
		if (message.type === MESSAGE.AUTO_PREPARE) {
			return passive.handle({ ...message, type: MESSAGE.PREPARE_TARGET, confirmFocused: false, allowHiddenTarget: false });
		}
		if (message.type === MESSAGE.AUTO_FILL) {
			writing = true;
			codeDelivered = false;
			let result;
			try {
				result = await passive.handle({ ...message, type: MESSAGE.FILL_CODE, allowHiddenTarget: false });
			} finally {
				writing = false;
			}
			const delivered = codeDelivered || (result.ok && result.status === 'filled');
			codeDelivered = false;
			if (delivered) {
				// One automatic complete code per authorized path and sign-in identity
				// for the life of this document. A page that rejects it and mounts
				// fresh, empty fields must not receive another automatic code, even
				// after leaving the route and returning. The record is keyed by path,
				// so remounted elements cannot evade it.
				recordDelivery(current);
				cancel(true, current);
			}
			return result;
		}
		return unavailable();
	}

	function onNavigation() {
		if (disposed || !visible()) {
			return;
		}
		if (observedUrl === doc.location.href) {
			// Only Google's explicit account identity can end suppression without
			// changing routes. Reused inputs retain their edit/completion guards.
			if (awaitingIdentity && !isSuppressed()) {
				awaitingIdentity = false;
				suppressedContext = null;
				void refresh();
			}
			return;
		}
		observedUrl = doc.location.href;
		if (updateVisit()) {
			void refresh();
			return;
		}
		cancel();
		observation.schedule();
	}
	const listener = (message, sender, respond) => {
		if (disposed) {
			return false;
		}
		if (sender?.id !== runtime?.id || !runtime?.id || sender.tab) {
			return false;
		}
		if (message?.type === MESSAGE.PREPARE_TARGET) {
			const target = detectOtpTarget(doc);
			if (target.status === 'ready') {
				for (const input of target.target.inputs) {
					completed.add(input);
				}
				suppressedContext = { targetPath: autofillPathFromUrl(doc.location.href), loginContext: readLoginContext(doc) };
			}
			cancel(true);
			return false;
		}
		if (message?.type === MESSAGE.ACCOUNTS_CHANGED) {
			respond({ ok: true });
			onAccountsChanged(message);
			return false;
		}
		if (![MESSAGE.AUTO_STOP, MESSAGE.AUTO_REFRESH, MESSAGE.AUTO_PROBE, MESSAGE.AUTO_PREPARE, MESSAGE.AUTO_FILL].includes(message?.type)) {
			return false;
		}
		void Promise.resolve(handle(message))
			.then(respond)
			.catch(() => respond(unavailable()));
		return true;
	};
	runtime?.onMessage?.addListener(listener);

	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		disposeLanguage();
		observation.dispose();
		stop();
		passive.dispose();
		panel.dispose();
		try {
			runtime?.onMessage?.removeListener(listener);
		} catch {
			// The runtime may already be unavailable. DOM cleanup is still owned here.
		} finally {
			if (globalThis[MARKER] === controller) {
				delete globalThis[MARKER];
			}
		}
	}
	const controller = { refresh, stop, handle, dispose, isDisposed: () => disposed };
	return controller;
}

const runtime = globalThis.chrome?.runtime;
const view = globalThis.window;
if (runtime?.id && view && view.top === view) {
	if (!globalThis[MARKER] || globalThis[MARKER].isDisposed?.()) {
		globalThis[MARKER] = createAutomaticController({ initializeLanguage: true });
	}
	void globalThis[MARKER].refresh({ allowRecovery: true });
}
