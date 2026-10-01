import { t, tPlural, applyTranslations, localizeError } from '../shared/i18n.js';
import { MESSAGE, accountMetadataMatches } from '../shared/protocol.js';
import { extensionIcon } from '../shared/icons.js';
import { sanitizeServiceIcons } from '../shared/service-icons.js';
import { resolveServiceDomain } from '../../../src/shared/service-aggregation.js';
import { getAccountChoices } from './accounts.js';
import { createCodePreview } from './code-preview.js';

// Owns the account view and the lifetime of every code shown in it. Source
// maintenance and permissions report results through callbacks, never through
// this controller's preview queue.
export function createAccountsController({
	elements,
	session,
	send,
	isBusy,
	isClockPending,
	onInteraction,
	onFill,
	onPreviewState,
	onError,
	autofillScope = () => null,
}) {
	let closed = false;
	let viewValid = false;
	let viewGeneration = 0;
	let accountScope = 'site';
	let previewsPaused = true;
	let previewQueue = [];
	let previewFlushTimer = null;
	let searchTimer = null;
	let toastTimer = null;
	let toastNext = false;
	let summaryState = null;
	const accountCards = new Map();
	const SEARCH_FILTER_DEBOUNCE_MS = 130;
	const listeners = [];
	function isCurrentView(generation = viewGeneration) {
		return !closed && viewValid && generation === viewGeneration;
	}
	function listen(target, type, handler, options) {
		target.addEventListener(type, handler, options);
		listeners.push(() => target.removeEventListener(type, handler, options));
	}
	elements.toastIcon.innerHTML = extensionIcon('check');
	elements.searchIcon.innerHTML = extensionIcon('search');
	elements.searchClear.innerHTML = extensionIcon('dismiss');
	function captureAccountView() {
		if (!isCurrentView()) {
			return null;
		}
		const focus = document.activeElement;
		const card = focus?.closest('.account-card');
		return {
			query: elements.search.value,
			scope: accountScope,
			scrollTop: elements.accounts.scrollTop,
			focusId: focus?.id,
			accountId: card?.dataset.accountId,
			control: focus?.closest('button')?.classList[0],
			selectionStart: elements.search.selectionStart,
			selectionEnd: elements.search.selectionEnd,
		};
	}

	function restoreAccountView(view) {
		if (!isCurrentView()) {
			return;
		}
		elements.accounts.scrollTop = view.scrollTop;
		const card = accountCards.get(view.accountId)?.node;
		const focus = card ? (view.control ? card.querySelector(`.${view.control}`) : card) : document.getElementById(view.focusId);
		if (focus && !focus.disabled && !focus.hidden) {
			focus.focus({ preventScroll: true });
			if (focus === elements.search && view.selectionStart !== null) {
				elements.search.setSelectionRange(view.selectionStart, view.selectionEnd);
			}
		}
	}

	function hideCopyToast() {
		clearTimeout(toastTimer);
		toastTimer = null;
		elements.toast.hidden = true;
	}

	function showCopyToast(next = false) {
		hideCopyToast();
		toastNext = next;
		elements.toastMessage.textContent = t(next ? 'popupNextCopied' : 'popupCopied');
		elements.toast.hidden = false;
		toastTimer = setTimeout(hideCopyToast, 2000);
	}

	function trackPointerInput() {
		onInteraction();
		document.documentElement.setAttribute('data-card-input', 'pointer');
	}

	function trackKeyboardInput(event) {
		if (event.target === elements.search || event.target.closest?.('.account-card')) {
			onInteraction();
		}
		if (!event.ctrlKey && !event.metaKey && !event.altKey) {
			document.documentElement.removeAttribute('data-card-input');
		}
	}

	listen(document, 'pointerdown', trackPointerInput, true);
	listen(document, 'keydown', trackKeyboardInput, true);
	const visibilityObserver = new globalThis.IntersectionObserver(
		(entries) => {
			if (closed) {
				return;
			}
			for (const entry of entries) {
				const card = accountCards.get(entry.target.dataset.accountId);
				if (!card || card.node !== entry.target) {
					continue;
				}
				card.visible = entry.isIntersecting && entry.intersectionRatio > 0;
				if (card.visible && !previewsPaused) {
					activateCard(card);
				} else {
					deactivateCard(card);
				}
			}
		},
		{ root: elements.accounts, threshold: 0.01 },
	);

	function boundAccountIds() {
		return session.flow?.boundAccountIds || (session.flow?.boundAccountId ? [session.flow.boundAccountId] : []);
	}

	// The checkbox names the account about to be filled: the card the user last
	// selected, otherwise the first card (the Enter target). Only deliberate
	// actions select a card: clicking it, arrow keys, Enter, filling it, or a
	// pointer over its fill button. Passing a star, a card's empty space or, with
	// Tab, the buttons of later cards on the way to the checkbox selects nothing.
	// Where this page can be authorized, it reads "Autofill {name} on this
	// website": filling with it checked remembers the account and, without a
	// grant yet, asks for one in the same click. Otherwise it reads "Remember
	// {name}". Until the user changes it, it is checked for the account
	// remembered here, and on a website that can be authorized and remembers no
	// account yet. A change made by the user is an explicit choice for the next
	// fill, whichever card that fills.
	let rememberTargetId = null;
	let rememberDefaultId = null;
	let rememberVisible = new Map();
	let rememberChoice = null;
	let rememberChoices = null;
	function automaticRemember() {
		const scope = autofillScope();
		return scope === 'none' || scope === 'site';
	}
	function rememberTarget() {
		return rememberTargetId !== null && rememberVisible.has(rememberTargetId) ? rememberTargetId : rememberDefaultId;
	}
	function rememberFor(accountId) {
		if (rememberChoice) {
			return rememberChoice.checked;
		}
		const bound = boundAccountIds();
		return accountId !== null && (bound.includes(accountId) || (bound.length === 0 && automaticRemember()));
	}
	function rememberLabel(account, automatic) {
		if (!account) {
			return t(automatic ? 'popupAutoAccountTitle' : 'popupRememberTitle');
		}
		if (automatic) {
			return account.account
				? t('popupAutoAccountDetail', { name: account.name, account: account.account })
				: t('popupAutoAccount', { name: account.name });
		}
		return account.account
			? t('popupRememberAccountDetail', { name: account.name, account: account.account })
			: t('popupRememberAccount', { name: account.name });
	}
	function renderRememberState() {
		const targetId = rememberTarget();
		const automatic = automaticRemember();
		elements.remember.checked = rememberFor(targetId);
		// Read the visible choices, so the label is right before their cards exist.
		const label = rememberLabel(targetId === null ? null : rememberVisible.get(targetId), automatic);
		elements.rememberTitle.textContent = label;
		// The label may be cut with an ellipsis; the title keeps the full text.
		elements.rememberTitle.title = label;
		const hint = automatic ? 'popupAutoAccountHint' : 'popupRememberHint';
		const description = automatic ? 'popupAutoAccountDescription' : 'popupRememberDescription';
		const control = elements.remember.closest('label');
		control.setAttribute('data-i18n-title', hint);
		control.title = t(hint);
		elements.rememberDescription.setAttribute('data-i18n', description);
		elements.rememberDescription.textContent = t(description);
	}
	function selectRememberTarget(accountId) {
		if (accountId !== rememberTargetId) {
			rememberTargetId = accountId;
			renderRememberState();
		}
	}
	function resetRemember() {
		rememberTargetId = null;
		rememberChoice = null;
	}

	function renderRememberChoice(visibleChoices) {
		rememberChoices = visibleChoices;
		rememberVisible = new Map(visibleChoices.map((choice) => [choice.account.id, choice.account]));
		rememberDefaultId = visibleChoices[0]?.account.id ?? null;
		renderRememberState();
		const bound = boundAccountIds();
		// Search spans the full vault, so a single result is not proof that the
		// website has a unique match. Trust the background's complete-vault choice.
		const siteChoices = getAccountChoices(session.flow, { scope: 'site' }).choices;
		const uniqueSiteMatch =
			session.flow.autoFillAccountId &&
			siteChoices.length === 1 &&
			siteChoices[0].account.id === session.flow.autoFillAccountId &&
			visibleChoices.every((choice) => choice.account.id === session.flow.autoFillAccountId);
		// Automatic fills already choose a unique match, so remembering it is
		// hidden. A page without a grant keeps the checkbox: it also asks for one.
		elements.remember.closest('label').hidden =
			session.flow.canFill === false ||
			(autofillScope() !== 'none' &&
				bound.length === 0 &&
				rememberChoice?.checked !== true &&
				accountScope === 'site' &&
				Boolean(uniqueSiteMatch));
	}

	function updateCard(card, state) {
		card.lastState = state;
		const ui = card.ui;
		const hasCode = Boolean(state.code);
		const canCopy = hasCode && state.expiresAt > Date.now() + 1000;
		card.node.dataset.copyable = String(!isBusy() && !card.copying && canCopy);
		ui.code.textContent = state.code || '------';
		ui.code.disabled = isBusy() || !canCopy;
		ui.code.setAttribute('aria-disabled', String(isBusy() || card.copying || !canCopy));
		ui.fill.disabled = isBusy() || isClockPending() || session.flow?.canFill === false;
		ui.progress.hidden = !hasCode;
		ui.progress.setAttribute('aria-valuemax', String(state.period || 30));
		ui.progress.setAttribute('aria-valuenow', String(state.remainingSeconds || 0));
		ui.progress.setAttribute(
			'aria-valuetext',
			tPlural('popupRemainingSeconds', state.remainingSeconds || 0, { seconds: state.remainingSeconds || 0 }),
		);
		ui.progress.title = hasCode ? tPlural('popupUpdatesIn', state.remainingSeconds, { seconds: state.remainingSeconds }) : '';
		ui.progressFill.style.width = `${hasCode ? Math.max(0, Math.min(100, (state.remainingSeconds / state.period) * 100)) : 0}%`;
		ui.preview.setAttribute('aria-busy', String(state.status === 'loading'));
		// Keep loading and ready cards the same height so visibility cannot oscillate
		// when a request completes near the edge of the scroller.
		ui.status.textContent =
			state.status === 'error'
				? localizeError(state.errorDetails || { code: state.errorCode, message: state.error }, 'popupFetchFailed')
				: '';
		ui.status.hidden = !ui.status.textContent;
		ui.retry.hidden = state.status !== 'error';
		ui.retry.disabled = isBusy() || !card.controller;
		ui.nextCode.textContent = state.nextCode || '------';
		const canCopyNext = Boolean(state.nextCode && state.nextStartsAt > Date.now());
		ui.nextCode.disabled = isBusy() || !canCopyNext;
		ui.nextCode.setAttribute('aria-disabled', String(isBusy() || card.copying || !canCopyNext));
		ui.nextTime.textContent = state.nextCode
			? tPlural('popupNextIn', state.nextInSeconds, { seconds: state.nextInSeconds })
			: state.status === 'loading'
				? t('popupFetching')
				: t('popupNotFetched');
		ui.code.title = state.status === 'loading' && !hasCode ? t('popupFetchingCode') : t('popupCopyCodeTitle');
	}
	function queuePreview(account, { includeNext, isCurrent }) {
		return new Promise((resolve, reject) => {
			previewQueue.push({ account, includeNext, isCurrent, resolve, reject });
			if (previewFlushTimer === null) {
				previewFlushTimer = setTimeout(flushPreviewQueue, 16);
			}
		});
	}
	async function flushPreviewQueue() {
		previewFlushTimer = null;
		const queued = previewQueue;
		previewQueue = [];
		// Reserve queue positions before yielding so a fill can pause subsequent work.
		const operations = [];
		for (let offset = 0; offset < queued.length; offset += 32) {
			const chunk = queued.slice(offset, offset + 32);
			operations.push(
				session.serialize(async () => {
					let active = chunk.filter((entry) => !closed && !previewsPaused && entry.isCurrent());
					try {
						if (!active.length) {
							return;
						}
						await session.ensureFresh(active[0].account, { allowMissing: true });
						active = active.filter((entry) => !closed && !previewsPaused && entry.isCurrent());
						if (!active.length) {
							return;
						}
						active = active.filter((entry) => {
							if (session.flow.accounts.some((account) => accountMetadataMatches(account, entry.account))) {
								return true;
							}
							entry.reject(Object.assign(new Error(t('popupAccountChanged')), { i18nKey: 'popupAccountChanged' }));
							return false;
						});
						if (!active.length) {
							return;
						}
						session.consume();
						const single = active.length === 1;
						const response = await send(
							single
								? { type: MESSAGE.COPY_ACCOUNT_CODE, nonce: session.flow.nonce, account: active[0].account, includeNext: true }
								: {
										type: MESSAGE.COPY_ACCOUNT_CODES,
										nonce: session.flow.nonce,
										accounts: active.map((entry) => entry.account),
										includeNext: true,
									},
						);
						const results = single ? [{ id: active[0].account.id, ...response }] : response;
						if (
							!Array.isArray(results) ||
							results.length !== active.length ||
							results.some((result, index) => result.id !== active[index].account.id)
						) {
							throw Object.assign(new Error(t('popupInvalidCode')), { i18nKey: 'popupInvalidCode' });
						}
						active.forEach((entry, index) => {
							const result = results[index];
							if (result.error) {
								entry.reject(Object.assign(new Error(result.error.message), result.error));
							} else {
								entry.resolve(result);
							}
						});
					} catch (error) {
						active.forEach((entry) => entry.reject(error));
					} finally {
						chunk.forEach((entry) => entry.resolve(null));
					}
				}),
			);
		}
		await Promise.all(operations);
	}
	function loadCardIcon(card) {
		if (closed || !card.visible || !card.node.isConnected) {
			return;
		}
		if (card.iconUrl && !card.iconRequested) {
			card.iconRequested = true;
			card.ui.icon.src = card.iconUrl;
		}
	}
	function activateCard(card) {
		if (!isCurrentView() || previewsPaused || !card.visible) {
			return;
		}
		loadCardIcon(card);
		if (card.controller) {
			return;
		}
		const controller = createCodePreview({
			requestCode: queuePreview,
			onChange: (state) => {
				if (card.controller === controller) {
					updateCard(card, state);
					onPreviewState(state);
				}
			},
		});
		card.controller = controller;
		controller.open(card.account);
	}
	function deactivateCard(card) {
		if (!card.controller) {
			return;
		}
		const controller = card.controller;
		controller.close();
		controller.destroy();
		card.controller = null;
		updateCard(card, controller.getState());
	}
	function pausePreviews() {
		previewsPaused = true;
		clearTimeout(previewFlushTimer);
		previewFlushTimer = null;
		previewQueue.splice(0).forEach((entry) => entry.resolve(null));
		for (const card of accountCards.values()) {
			deactivateCard(card);
		}
	}
	function resumePreviews() {
		if (!isCurrentView() || isClockPending()) {
			return;
		}
		previewsPaused = false;
		for (const card of accountCards.values()) {
			activateCard(card);
		}
	}
	function clearCards() {
		visibilityObserver.disconnect();
		for (const card of accountCards.values()) {
			deactivateCard(card);
		}
		accountCards.clear();
		elements.accounts.replaceChildren();
	}
	function invalidateView() {
		// Hiding the section is insufficient: pending searches and favorite writes
		// may still render. Only an accepted flow can activate a new view generation.
		viewValid = false;
		viewGeneration += 1;
		cancelSearchFilter();
		pausePreviews();
		hideCopyToast();
		elements.accountSection.hidden = true;
		elements.remember.closest('label').hidden = true;
		elements.keyboardHelp.hidden = true;
	}
	function createCard({ account, bound, suggested, loginMatched }) {
		const node = elements.template.content.firstElementChild.cloneNode(true);
		applyTranslations(node);
		node.dataset.accountId = account.id;
		node.tabIndex = -1;
		node.setAttribute('aria-label', `${account.name} ${account.account || ''}`);
		const find = (selector) => node.querySelector(selector);
		const card = {
			account,
			choice: { account, bound, suggested, loginMatched },
			node,
			visible: false,
			copying: false,
			controller: null,
			iconUrl: null,
			iconRequested: false,
			iconFailed: false,
			ui: {
				icon: find('.service-icon img'),
				iconFallback: find('.service-icon-fallback'),
				code: find('.preview-code'),
				fill: find('.account-fill'),
				favorite: find('.account-favorite'),
				preview: find('.code-preview'),
				progress: find('.progress-top'),
				progressFill: find('.progress-top-fill'),
				status: find('.preview-status'),
				retry: find('.preview-retry'),
				nextCode: find('.preview-next-code'),
				nextTime: find('.preview-next-time'),
			},
		};
		const serviceDomain = resolveServiceDomain(account.name);
		card.ui.code.textContent = '------';
		card.ui.nextCode.textContent = '------';
		if (serviceDomain) {
			card.iconUrl =
				session.flow.authMode === 'offline'
					? sanitizeServiceIcons(session.flow.serviceIcons, [serviceDomain])[serviceDomain] || null
					: new URL(`/api/favicon/${encodeURIComponent(serviceDomain)}`, session.flow.instanceOrigin).href;
		}
		card.ui.iconFallback.textContent = account.name.charAt(0).toUpperCase();
		card.ui.icon.addEventListener('load', () => {
			if (closed || !node.isConnected || !card.iconRequested) {
				return;
			}
			card.iconFailed = false;
			card.ui.icon.hidden = false;
			card.ui.iconFallback.hidden = true;
		});
		card.ui.icon.addEventListener('error', () => {
			if (closed || !node.isConnected || !card.iconRequested) {
				return;
			}
			card.iconFailed = true;
			card.ui.icon.hidden = true;
			card.ui.iconFallback.hidden = false;
		});
		find('.account-name').textContent = account.name;
		find('.account-name').title = account.name;
		renderCardText(card);
		card.ui.code.addEventListener('click', () => copyCard(card));
		node.addEventListener('click', (event) => {
			if (!event.target.closest('button')) {
				void copyCard(card);
			}
		});
		card.ui.nextCode.addEventListener('click', () => copyCard(card, true));
		card.ui.fill.addEventListener('click', () => {
			if (isCurrentView() && accountCards.get(account.id) === card) {
				onFill(account);
			}
		});
		card.ui.favorite.addEventListener('click', () => void toggleFavorite(card));
		card.ui.retry.addEventListener('click', () => {
			if (!isBusy()) {
				card.controller?.retry();
			}
		});
		card.ui.fill.disabled = isBusy() || isClockPending() || session.flow?.canFill === false;
		return card;
	}
	function renderCardText(card) {
		const { account } = card;
		const { bound, suggested, loginMatched, favorite } = card.choice;
		const detail = card.node.querySelector('.account-detail');
		detail.textContent = account.account || t('popupNoAccountDetails', { digits: account.digits });
		detail.title = account.account || t('popupNoAccount');
		card.ui.fill.title = t('popupFillTitle', { name: account.name, account: account.account || '' });
		const badge = card.node.querySelector('.account-badge');
		badge.hidden = !bound && !suggested && !loginMatched;
		badge.textContent = t(loginMatched ? 'popupLoginAccount' : bound ? 'popupBound' : 'popupNameMatch');
		badge.classList.toggle('suggested-badge', suggested);
		card.ui.favorite.setAttribute(
			'aria-label',
			t(favorite ? 'popupUnpin' : 'popupPin', { name: account.name, account: account.account || '' }),
		);
	}
	function renderSummary() {
		if (!summaryState || !session.flow) {
			return;
		}
		const { siteCount, totalCount, searching, count } = summaryState;
		elements.scopeSite.textContent = t(session.flow.loginContext ? 'popupLoginCount' : 'popupSiteCount', { count: siteCount });
		elements.scopeAll.textContent = t('popupAllCount', { count: totalCount });
		for (const button of [elements.scopeSite, elements.scopeAll]) {
			if (!session.flow.loginContext && siteCount === 0 && !searching && session.flow.canFill !== false) {
				button.title = t('popupNoSiteMatch');
			} else {
				button.removeAttribute('title');
			}
		}
		elements.summary.textContent = searching
			? tPlural('popupSearchCount', count)
			: session.flow.loginContext && accountScope === 'site'
				? tPlural('popupLoginSummary', siteCount, {
						email: session.flow.loginContext.email,
						count: siteCount,
						hint: siteCount === 0 ? t('popupLoginSearchHint') : '',
					})
				: '';
		elements.summary.hidden = !elements.summary.textContent;
	}
	function retranslate() {
		if (closed) {
			return;
		}
		elements.toastMessage.textContent = t(toastNext ? 'popupNextCopied' : 'popupCopied');
		renderSummary();
		renderRememberState();
		// Preserve nodes, focus, pending searches and code controller lifetimes.
		for (const card of accountCards.values()) {
			renderCardText(card);
			if (card.lastState) {
				updateCard(card, card.lastState);
			}
		}
	}
	function renderAccounts() {
		if (!isCurrentView()) {
			return;
		}
		const { choices, siteCount, totalCount, searching } = getAccountChoices(session.flow, {
			query: elements.search.value,
			scope: accountScope,
		});
		// Reflect the list actually shown while retaining the user's scope choice
		// for source updates. A Google login identity must never fall back to all.
		const noSiteMatch = !session.flow.loginContext && siteCount === 0;
		const displayedScope = noSiteMatch ? 'all' : accountScope;
		renderRememberChoice(choices);
		elements.searchClear.hidden = !searching;
		summaryState = { siteCount, totalCount, searching, count: choices.length };
		renderSummary();
		elements.scopeSite.setAttribute('aria-pressed', String(!searching && displayedScope === 'site'));
		elements.scopeAll.setAttribute('aria-pressed', String(!searching && displayedScope === 'all'));
		elements.empty.hidden = choices.length > 0;
		const retained = new Set(choices.map((choice) => choice.account.id));
		for (const [id, card] of accountCards) {
			if (!retained.has(id)) {
				visibilityObserver.unobserve(card.node);
				deactivateCard(card);
				card.node.remove();
				accountCards.delete(id);
			}
		}
		for (const choice of choices) {
			let card = accountCards.get(choice.account.id);
			if (card && !accountMetadataMatches(card.account, choice.account)) {
				visibilityObserver.unobserve(card.node);
				deactivateCard(card);
				card.node.remove();
				card = null;
			}
			card ||= createCard(choice);
			card.choice = choice;
			renderCardText(card);
			card.ui.favorite.innerHTML = extensionIcon(choice.favorite ? 'starFilled' : 'star');
			card.ui.favorite.setAttribute('aria-pressed', String(choice.favorite));

			accountCards.set(choice.account.id, card);
			elements.accounts.append(card.node);
			visibilityObserver.observe(card.node);
		}
		elements.accountSection.hidden = false;
	}
	async function toggleFavorite(card) {
		onInteraction();
		if (isBusy() || !isCurrentView() || card.pinning || accountCards.get(card.account.id) !== card) {
			return;
		}
		card.pinning = true;
		card.ui.favorite.setAttribute('aria-disabled', 'true');
		const origin = session.flow.instanceOrigin;
		const generation = viewGeneration;
		try {
			const response = await send({
				type: MESSAGE.SET_FAVORITE,
				instanceOrigin: origin,
				accountId: card.account.id,
				favorite: !(session.flow.favoriteAccountIds || []).includes(card.account.id),
			});
			if (isCurrentView(generation) && session.flow.instanceOrigin === origin) {
				const restoreFocus = document.activeElement === card.ui.favorite && !isBusy() && card.node.isConnected;
				session.updateFavorites(response.favoriteAccountIds);
				renderAccounts();
				if (restoreFocus && card.node.isConnected && !card.ui.favorite.disabled) {
					card.ui.favorite.focus();
				}
				// The button stays focusable while the write is pending; never steal search focus.
			}
		} catch (error) {
			if (isCurrentView(generation) && session.flow.instanceOrigin === origin) {
				onError(error);
			}
		} finally {
			card.pinning = false;
			card.ui.favorite.removeAttribute('aria-disabled');
			card.ui.favorite.disabled = isBusy();
		}
	}

	function handleAccountKeys(event) {
		if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || isBusy() || !isCurrentView()) {
			return;
		}
		const isSearch = event.target === elements.search;
		const isCard = event.target.classList?.contains('account-card');
		if (!['ArrowDown', 'ArrowUp'].includes(event.key) && !((isSearch || isCard) && event.key === 'Enter')) {
			return;
		}
		event.preventDefault();
		onInteraction();
		if (searchTimer !== null) {
			cancelSearchFilter();
			renderAccounts();
		}
		const cards = Array.from(elements.accounts.children)
			.map((node) => accountCards.get(node.dataset.accountId))
			.filter(Boolean);
		if (!cards.length) {
			return;
		}
		const currentNode = event.target.closest?.('.account-card');
		let index = cards.findIndex((card) => card.node === currentNode);
		if (event.key === 'ArrowUp') {
			index = index < 0 ? cards.length - 1 : Math.max(0, index - 1);
		} else if (event.key === 'ArrowDown') {
			index = Math.min(cards.length - 1, index + 1);
		} else {
			index = Math.max(0, index);
		}
		const card = cards[index];
		const action = session.flow.canFill === false ? card.ui.code : card.ui.fill;
		card.node.scrollIntoView?.({ block: 'nearest' });
		card.node.focus({ preventScroll: true });
		if (event.key === 'Enter') {
			action.click();
		}
	}
	function cancelSearchFilter() {
		clearTimeout(searchTimer);
		searchTimer = null;
	}
	function scheduleSearchFilter() {
		onInteraction();
		cancelSearchFilter();
		if (!isCurrentView() || isBusy()) {
			return;
		}
		if (!elements.search.value.trim()) {
			renderAccounts();
			return;
		}
		searchTimer = setTimeout(() => {
			searchTimer = null;
			if (isCurrentView() && !isBusy()) {
				renderAccounts();
			}
		}, SEARCH_FILTER_DEBOUNCE_MS);
	}

	async function writeClipboard(value) {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			const focus = document.activeElement;
			const textarea = document.createElement('textarea');
			textarea.value = value;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.append(textarea);
			textarea.select();
			const copied = document.execCommand('copy');
			textarea.remove();
			focus?.focus();
			if (!copied) {
				throw Object.assign(new Error(t('popupClipboardDenied')), { i18nKey: 'popupClipboardDenied' });
			}
		}
	}
	async function copyCard(card, next = false) {
		onInteraction();
		if (isBusy() || !isCurrentView() || card.copying || !card.controller) {
			return;
		}
		const controller = card.controller;
		const code = next ? controller.getCopyableNextCode() : controller.getCopyableCode();
		if (!code) {
			return;
		}
		card.copying = true;
		hideCopyToast();
		updateCard(card, controller.getState());
		try {
			// Begin writing within this click, preserving clipboard user activation.
			await writeClipboard(code);
			if (!closed && card.controller === controller) {
				showCopyToast(next);
			}
		} catch (error) {
			if (!closed && card.controller === controller) {
				onError(error);
			}
		} finally {
			card.copying = false;
			if (!closed && card.controller) {
				updateCard(card, card.controller.getState());
			}
		}
	}

	listen(elements.search, 'input', scheduleSearchFilter);
	listen(elements.search, 'keydown', handleAccountKeys);
	listen(elements.accounts, 'keydown', handleAccountKeys);
	// Leaving the list keeps the last selected card named: the pointer or the
	// keyboard focus may be on its way to the checkbox.
	function selectCardOf(element) {
		const accountId = element?.closest?.('.account-card')?.dataset.accountId;
		if (accountId && isCurrentView()) {
			selectRememberTarget(accountId);
		}
	}
	// A pointer reaches a fill button before pressing it, so it names that account in advance.
	listen(elements.accounts, 'pointerover', (event) => {
		if (event.target.closest?.('.account-fill')) {
			selectCardOf(event.target);
		}
	});
	// Arrow keys and Enter focus the card itself; Tab only reaches its buttons.
	listen(elements.accounts, 'focusin', (event) => {
		if (event.target.classList?.contains('account-card')) {
			selectCardOf(event.target);
		}
	});
	listen(elements.accounts, 'click', (event) => {
		if (!event.target.closest?.('.account-favorite')) {
			selectCardOf(event.target);
		}
	});
	// Enter in the search field fills the first card again.
	listen(elements.search, 'focus', () => selectRememberTarget(null));
	listen(elements.search, 'input', () => selectRememberTarget(null));
	listen(elements.remember, 'change', () => {
		rememberChoice = { checked: elements.remember.checked };
	});
	listen(elements.searchClear, 'click', () => {
		onInteraction();
		if (isCurrentView() && !isBusy()) {
			cancelSearchFilter();
			elements.search.value = '';
			renderAccounts();
			elements.search.focus();
		}
	});
	for (const [element, scope] of [
		[elements.scopeSite, 'site'],
		[elements.scopeAll, 'all'],
	]) {
		listen(element, 'click', () => {
			onInteraction();
			if (isCurrentView() && !isBusy()) {
				cancelSearchFilter();
				accountScope = scope;
				elements.search.value = '';
				renderAccounts();
			}
		});
	}

	return {
		render: renderAccounts,
		retranslate,
		pause: pausePreviews,
		resume: resumePreviews,
		clear: clearCards,
		invalidate: invalidateView,
		capture: captureAccountView,
		restore: restoreAccountView,
		hideToast: hideCopyToast,
		/** The remember decision for filling this account, as the checkbox shows it. */
		rememberFor(accountId) {
			selectRememberTarget(accountId);
			return rememberFor(accountId);
		},
		/** Whether filling this account also asks for this website's grant. */
		authorizesAutofill(accountId) {
			selectRememberTarget(accountId);
			return autofillScope() === 'none' && !elements.remember.closest('label').hidden && rememberFor(accountId);
		},
		/** Re-render the checkbox after this page's grants change. */
		renderRemember() {
			if (isCurrentView() && rememberChoices) {
				renderRememberChoice(rememberChoices);
			}
		},
		configure(view) {
			viewValid = true;
			if (!view) {
				resetRemember();
			}
			rememberChoices = null;
			accountScope = view?.scope || (session.flow.canFill === false ? 'all' : 'site');
			elements.search.value = view?.query || '';
			elements.searchClear.hidden = true;
		},
		updateControls() {
			if (isBusy()) {
				cancelSearchFilter();
			}
			for (const card of accountCards.values()) {
				if (card.controller) {
					updateCard(card, card.controller.getState());
				} else {
					card.ui.fill.disabled = isBusy() || isClockPending() || session.flow?.canFill === false;
					card.ui.code.disabled = true;
					card.ui.nextCode.disabled = true;
					card.ui.retry.disabled = true;
				}
			}
		},
		applyIcons(icons) {
			for (const card of accountCards.values()) {
				const iconUrl = icons[resolveServiceDomain(card.account.name)] || null;
				if (iconUrl === card.iconUrl && !card.iconFailed) {
					continue;
				}
				card.iconUrl = iconUrl;
				card.iconRequested = false;
				card.iconFailed = false;
				card.ui.icon.hidden = true;
				card.ui.iconFallback.hidden = false;
				card.ui.icon.removeAttribute('src');
				loadCardIcon(card);
			}
		},
		dispose() {
			closed = true;
			cancelSearchFilter();
			hideCopyToast();
			listeners.splice(0).forEach((remove) => remove());
			visibilityObserver.disconnect();
			pausePreviews();
		},
	};
}
