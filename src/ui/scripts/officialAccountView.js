import { serializeBrowserFunction } from './browserSource.js';
import { createAccountRenderer } from '../themes/renderer.js';
import { dialogIcon } from '../dialogIcons.js';

/** Official DOM adapter. Business data comes exclusively from the shared SDK. */
export function createOfficialAccountView(ports) {
	const { document, window, sdk, renderer } = ports;
	const t = ports.translate || ((key) => key);
	const escapeHTML = (value) =>
		String(value ?? '').replace(
			/[&<>"']/g,
			(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
		);
	let lastShape = '';
	let lastContainer = null;
	let unbind = null;
	let disposed = false;
	let operationPanel = null;
	let operationShape = '';
	function renderOperations(snapshot, container) {
		const operations = (snapshot.host?.operations || []).filter(
			(operation) =>
				operation.type === 'hotp' &&
				(operation.clipboard === 'pending' || ['reload-required', 'retry-reconcile'].includes(operation.recovery)),
		);
		if (!operations.length) {
			operationPanel?.remove();
			operationPanel = null;
			operationShape = '';
			return;
		}
		if (!operationPanel) {
			operationPanel = document.createElement('section');
			operationPanel.id = 'officialHotpOperations';
			operationPanel.setAttribute('role', 'status');
			operationPanel.setAttribute('aria-live', 'polite');
			operationPanel.dataset.part = 'operation-status';
			operationPanel.className = 'offline-queue';
			container.before(operationPanel);
		}
		const shape = JSON.stringify([operations, ports.getLanguage?.()]);
		if (shape === operationShape) {
			return;
		}
		operationShape = shape;
		const focused = operationPanel.contains(document.activeElement)
			? { id: document.activeElement.dataset.operationId, action: document.activeElement.dataset.operationAction }
			: null;
		operationPanel.replaceChildren();
		const heading = document.createElement('h3');
		heading.textContent = t('coreHotpOperationTitle');
		operationPanel.append(heading);
		const states = {
			pending: 'coreHotpStatePending',
			confirmed: 'coreHotpStateConfirmed',
			rejected: 'coreHotpStateRejected',
			unknown: 'coreHotpStateUnknown',
			copied: 'coreHotpStateCopied',
			failed: 'coreHotpStateFailed',
			'not-attempted': 'coreHotpStateUnknown',
		};
		for (const operation of operations) {
			const row = document.createElement('div');
			row.className = 'offline-queue-item';
			const name =
				snapshot.library.accounts.find((account) => account.ref.id === String(operation.accountId))?.service.label || t('coreCode');
			const title = document.createElement('strong');
			title.textContent = name;
			row.append(title);
			for (const [field, key] of [
				['clipboard', 'coreHotpClipboardState'],
				['reservation', 'coreHotpReservationState'],
			]) {
				const line = document.createElement('p');
				line.dataset.operationFact = field;
				line.textContent = t(key, { state: t(states[operation[field]] || 'coreHotpStateUnknown') });
				row.append(line);
			}
			const explanation = document.createElement('p');
			explanation.textContent = t('coreHotpPendingRecovery');
			row.append(explanation);
			const reconcile = document.createElement('button');
			reconcile.type = 'button';
			reconcile.className = 'btn btn-secondary';
			reconcile.dataset.operationId = operation.operationId;
			reconcile.dataset.operationAction = 'reconcile';
			reconcile.textContent = t('coreHotpReconcile');
			reconcile.disabled = operation.reconciliation === 'running';
			reconcile.onclick = () => {
				void sdk.otp.reconcile(operation.operationId).then((result) => {
					if (!disposed && result.status === 'rejected' && !['session-invalidated', 'mount-invalidated'].includes(result.reason)) {
						ports.recoveryFeedback?.('coreHotpReconcileFailed');
					}
				});
			};
			row.append(reconcile);
			if (operation.recovery === 'reload-required' && operation.reconciliation === 'succeeded') {
				const recovery = document.createElement('button');
				recovery.type = 'button';
				recovery.className = 'btn btn-secondary';
				recovery.dataset.operationId = operation.operationId;
				recovery.dataset.operationAction = 'recovery';
				recovery.textContent = t('coreHotpRecoveryReload');
				recovery.onclick = () => {
					void sdk.lifecycle.requestReload('recovery').then((result) => {
						if (!disposed && result.status === 'rejected' && !['session-invalidated', 'mount-invalidated'].includes(result.reason)) {
							ports.recoveryFeedback?.('moduleRefreshBlocked');
						}
					});
				};
				row.append(recovery);
			}
			operationPanel.append(row);
		}
		if (focused) {
			const target = [...operationPanel.querySelectorAll('button')].find(
				(button) => button.dataset.operationId === focused.id && button.dataset.operationAction === focused.action,
			);
			target?.focus({ preventScroll: true });
		}
	}
	function labels() {
		return Object.fromEntries(
			[
				'cardCopyTooltip',
				'cardMenuTriggerTitle',
				'cardMenuQRCode',
				'cardMenuQRCodeTitle',
				'cardMenuCopyURI',
				'cardMenuCopyURITitle',
				'cardMenuCopyLink',
				'cardMenuCopyLinkTitle',
				'cardMenuEdit',
				'cardMenuEditTitle',
				'cardMenuDelete',
				'cardMenuDeleteTitle',
				'copyOtpBtnTitle',
				'copyOtpBtnAriaLabel',
				'otpNextLabel',
				'copyNextOtpBtnTitle',
				'counterLabel',
			].map((key) => [key, t(key)]),
		);
	}
	function createSecretCard(account) {
		return renderer.card(
			{
				id: account.ref.id,
				name: account.service.label,
				account: account.accountLabel,
				logoUrl: account.service.iconURL,
				isHOTP: account.type === 'HOTP',
				counter: account.counter,
				code: account.otp.current?.value,
				nextCode: account.otp.next?.value,
			},
			labels(),
		);
	}
	function createServiceGroupSection(group, index, byId, showHeader = true, query = '') {
		const cards = group.ids
			.map((id) => byId.get(id))
			.filter(Boolean)
			.map(createSecretCard)
			.join('');
		if (!showHeader) {
			return '<div class="service-group"><div class="service-group-grid">' + cards + '</div></div>';
		}
		const headingId = 'service-group-heading-' + index;
		const filtered = Boolean(query) && group.matchedCount !== group.totalCount;
		const countText = filtered ? group.matchedCount + ' / ' + group.totalCount : t('groupCountText', { count: group.totalCount });
		const countLabel = filtered
			? t('groupMatchedCountLabel', { matched: group.matchedCount, total: group.totalCount })
			: t('groupCountLabel', { count: group.totalCount });
		return (
			'<section class="service-group" data-part="service-group" aria-labelledby="' +
			headingId +
			'"><div class="service-group-header" data-part="group-header"><h2 class="service-group-title" id="' +
			headingId +
			'">' +
			escapeHTML(group.label) +
			'</h2><span class="service-group-count" aria-label="' +
			escapeHTML(countLabel) +
			'">' +
			escapeHTML(countText) +
			'</span></div><div class="service-group-grid">' +
			cards +
			'</div></section>'
		);
	}
	function feedback(id, slot) {
		ports.feedback?.(id, slot);
	}
	function copy(id, slot = 'current') {
		if (disposed) {
			return Promise.resolve({ status: 'rejected', reason: 'mount-invalidated' });
		}
		closeAllCardMenus();
		const result = sdk.otp.readCopyTarget(String(id), slot);
		if (result.status !== 'ready') {
			ports.copyUnavailable?.(result);
			return Promise.resolve(result);
		}
		if (ports.prepareCopy && !ports.prepareCopy(result.target)) {
			return Promise.resolve({ status: 'rejected', reason: 'stale-target' });
		}
		// No await before the unified command: retain the current click's activation.
		const operation = sdk.otp.copy(result.target);
		return Promise.resolve(operation).then((outcome) => {
			if (
				!disposed &&
				(outcome.status === 'copied' ||
					(outcome.clipboard === 'copied' &&
						(outcome.reservation === 'not-attempted' || (outcome.reservation === 'confirmed' && outcome.localCommit === 'committed'))))
			) {
				feedback(id, slot);
			}
			if (!disposed && outcome.clipboard === 'failed' && outcome.reservation === 'not-attempted') {
				ports.copyFailed?.(outcome);
			}
			return outcome;
		});
	}
	function copyAuxiliary(action, account) {
		const result = action === 'uri' ? sdk.accounts.copyURI(account.ref) : sdk.accounts.copyShareLink(account.ref);
		return Promise.resolve(result).then((outcome) => {
			if (!disposed && !['session-invalidated', 'mount-invalidated'].includes(outcome.reason) && outcome.status !== 'session-invalidated') {
				ports.auxiliaryFeedback?.(action, account.service.label, outcome);
			}
			return outcome;
		});
	}
	function dispatch(action, id, event) {
		if (action === 'menu') {
			toggleCardMenu(id);
			return;
		}
		if (action === 'copy' || action === 'next') {
			void copy(id, action === 'next' ? 'next' : 'current');
			return;
		}
		const account = sdk.getSnapshot().library.accounts.find((item) => item.ref.id === id);
		if (!account) {
			return;
		}
		if (action === 'uri') {
			void copyAuxiliary('uri', account);
		} else if (action === 'link') {
			void copyAuxiliary('link', account);
		} else if (['qr', 'edit', 'delete'].includes(action)) {
			sdk.host.open({ kind: 'account-' + action, account: account.ref }, { returnFocus: event?.target });
		}
		closeAllCardMenus();
	}
	function render(snapshot = sdk.getSnapshot()) {
		if (disposed || ports.shouldRender?.() === false) {
			return;
		}
		const container = document.getElementById('secretsList');
		if (!container) {
			return;
		}
		container.dataset.part = 'account-grid';
		if (container !== lastContainer) {
			unbind?.();
			lastContainer = container;
			lastShape = '';
			unbind = renderer.bind(container, dispatch);
		}
		const { library } = snapshot;
		renderOperations(snapshot, container);
		const selection = library.view;
		const loading = document.getElementById('loading');
		const empty = document.getElementById('emptyState');
		if (loading) {
			loading.style.display = library.state === 'loading' ? '' : 'none';
		}
		ports.updateControls?.(selection, snapshot);
		const byId = new Map(library.accounts.map((account) => [account.ref.id, account]));
		const visible = selection.resultIds.map((id) => byId.get(id)).filter(Boolean);
		const shape = JSON.stringify([
			snapshot.session.state,
			library.state,
			library.errorKey,
			selection,
			visible.map((account) => [account.ref, account.service, account.accountLabel, account.type, account.counter]),
			labels(),
			ports.getLanguage?.(),
		]);
		if (shape !== lastShape) {
			lastShape = shape;
			ports.resetPresentation?.();
			const grouped = selection.mode === 'grouped';
			container.classList.toggle('is-grouped', grouped);
			container.setAttribute('data-view', grouped ? 'grouped' : 'flat');
			container.hidden = false;
			if (!visible.length || library.state === 'loading' || library.state === 'error') {
				container.replaceChildren();
				container.style.display = 'none';
				if (empty) {
					const noMatch = Boolean(selection.query || selection.serviceFilter);
					const error = library.state === 'error';
					empty.innerHTML =
						'<div class="icon" aria-hidden="true">' +
						(noMatch ? ports.searchIcon || '' : ports.keyIcon || '') +
						'</div><h3>' +
						escapeHTML(t(error ? 'coreReadTitle' : noMatch ? 'searchNoMatch' : 'emptyTitle')) +
						'</h3><p>' +
						escapeHTML(t(error ? library.errorKey || 'coreConnectionFailed' : noMatch ? 'searchNoMatchDesc' : 'emptyDesc')) +
						'</p><button type="button" class="workspace-action">' +
						escapeHTML(t(error ? 'retry' : noMatch ? 'searchClearAriaLabel' : 'emptyAddBtn')) +
						'</button>';
					empty.querySelector('button').onclick = () => {
						if (error) {
							void sdk.accounts.refresh();
						} else if (noMatch) {
							sdk.view.setQuery('');
							sdk.view.setServiceFilter(null);
						} else {
							sdk.host.open({ kind: 'account-add' });
						}
					};
					empty.style.display = library.state === 'loading' ? 'none' : 'block';
				}
			} else {
				if (empty) {
					empty.style.display = 'none';
				}
				container.style.removeProperty('display');
				const onlyOther =
					selection.groups.length === 1 && selection.groups[0].isOther && selection.groups[0].totalCount === selection.total;
				container.innerHTML = grouped
					? selection.groups.map((group, index) => createServiceGroupSection(group, index, byId, !onlyOther, selection.query)).join('')
					: visible.map(createSecretCard).join('');
				visible.forEach((account) => ports.renderCommitted?.(account.ref.id));
			}
		}
		ports.renderProgress?.(visible);
	}

	function toggleCardMenu(secretId) {
		const dropdown = document.getElementById('menu-' + secretId);
		if (!dropdown) {
			return;
		}

		document.querySelectorAll('.card-menu-dropdown').forEach((menu) => {
			if (menu.id !== 'menu-' + secretId) {
				menu.classList.remove('show');
				updateCardMenuTrigger(menu);
			}
		});

		dropdown.classList.toggle('show');
		updateCardMenuTrigger(dropdown);
		if (dropdown.classList.contains('show')) {
			const firstAction = getEnabledCardMenuActions(dropdown)[0];
			if (firstAction) {
				firstAction.focus();
			}
		}
	}

	function updateCardMenuTrigger(menu) {
		const trigger = document.querySelector('[aria-controls="' + menu.id + '"]');
		if (trigger) {
			trigger.setAttribute('aria-expanded', String(menu.classList.contains('show')));
		}
	}

	function closeAllCardMenus() {
		document.querySelectorAll('.card-menu-dropdown').forEach((menu) => {
			menu.classList.remove('show');
			updateCardMenuTrigger(menu);
		});
	}

	function isVisibleCardElement(element) {
		if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) {
			return false;
		}
		const rect = element.getBoundingClientRect();
		const style = window.getComputedStyle(element);
		return (
			rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
		);
	}

	function getEnabledCardMenuActions(menu) {
		return Array.from(menu.querySelectorAll('.menu-item')).filter(
			(action) => !action.disabled && action.getAttribute('aria-disabled') !== 'true' && isVisibleCardElement(action),
		);
	}

	// Use rendered positions so navigation follows responsive grids and service groups.
	function getAdjacentSecretCard(card, key) {
		const origin = card.getBoundingClientRect();
		const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
		let nearest = null;
		let nearestDistance = Infinity;
		let nearestOffset = Infinity;

		document.querySelectorAll('.secret-card').forEach((candidate) => {
			if (candidate === card || !isVisibleCardElement(candidate)) {
				return;
			}
			const rect = candidate.getBoundingClientRect();
			// Left/right stay in the current row; up/down can cross group boundaries.
			if (horizontal && Math.min(origin.bottom, rect.bottom) <= Math.max(origin.top, rect.top)) {
				return;
			}
			const distance =
				key === 'ArrowLeft'
					? origin.left - rect.right
					: key === 'ArrowRight'
						? rect.left - origin.right
						: key === 'ArrowUp'
							? origin.top - rect.bottom
							: rect.top - origin.bottom;
			if (distance < -1) {
				return;
			}
			const offset = horizontal
				? Math.abs(rect.top + rect.bottom - (origin.top + origin.bottom))
				: Math.abs(rect.left + rect.right - (origin.left + origin.right));
			if (distance < nearestDistance - 1 || (Math.abs(distance - nearestDistance) <= 1 && offset < nearestOffset)) {
				nearest = candidate;
				nearestDistance = distance;
				nearestOffset = offset;
			}
		});
		return nearest;
	}

	function handleCardArrowKey(event) {
		if (
			event.defaultPrevented ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey ||
			event.isComposing ||
			!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
		) {
			return false;
		}
		const target = event.target;
		if (
			!target ||
			typeof target.closest !== 'function' ||
			target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
		) {
			return false;
		}

		const card = target.closest('.secret-card');
		if (!isVisibleCardElement(card)) {
			return false;
		}
		const menuItem = target.closest('.menu-item');
		const menu = menuItem && menuItem.closest('.card-menu-dropdown.show');
		const control = target.closest('.otp-code, .otp-next-container, .card-menu-trigger');
		if (!menu && !control) {
			return false;
		}

		// Consume the boundary arrows too, keeping keyboard navigation from scrolling the page.
		event.preventDefault();
		if (menu && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			const actions = getEnabledCardMenuActions(menu);
			const index = actions.indexOf(menuItem);
			const nextIndex =
				event.key === 'ArrowDown'
					? (index + 1) % actions.length
					: index < 0
						? actions.length - 1
						: (index + actions.length - 1) % actions.length;
			if (actions[nextIndex]) {
				actions[nextIndex].focus();
			}
			return true;
		}

		const nextCard = getAdjacentSecretCard(card, event.key);
		const selector =
			menu || control.classList.contains('card-menu-trigger')
				? '.card-menu-trigger'
				: control.classList.contains('otp-next-container')
					? '.otp-next-container'
					: '.otp-code';
		closeAllCardMenus();
		if (nextCard || menu) {
			const destination = nextCard || card;
			let nextControl = destination.querySelector(selector);
			if (!nextControl || nextControl.disabled || !isVisibleCardElement(nextControl)) {
				nextControl = destination.querySelector('.otp-code');
			}
			if (nextControl && !nextControl.disabled && isVisibleCardElement(nextControl)) {
				nextControl.focus();
			}
		}
		return true;
	}

	function onClick(event) {
		if (!event.target.closest?.('.card-menu')) {
			closeAllCardMenus();
		}
	}
	function onKeydown(event) {
		if (event.target?.closest?.('.modal, [role="dialog"]')) {
			return;
		}
		if (handleCardArrowKey(event)) {
			return;
		}
		if (event.key === 'Escape') {
			const open = document.querySelector('.card-menu-dropdown.show');
			if (open) {
				const trigger = document.querySelector('[aria-controls="' + open.id + '"]');
				closeAllCardMenus();
				trigger?.focus();
				return;
			}
		}
		if (event.ctrlKey && event.key === 'd') {
			event.preventDefault();
			ports.toggleDebug?.();
		}
		if (event.ctrlKey && event.key === 'r') {
			event.preventDefault();
			ports.refreshCodes?.();
		}
	}
	document.addEventListener('click', onClick);
	document.addEventListener('keydown', onKeydown);
	const unsubscribe = sdk.subscribe(render);
	const progressTimer = window.setInterval?.(() => {
		if (!disposed && !document.hidden && ports.shouldRender?.() !== false) {
			ports.renderProgress?.(sdk.getSnapshot().library.accounts);
		}
	}, 1000);
	return Object.freeze({
		render,
		copy,
		createSecretCard,
		createServiceGroupSection,
		toggleCardMenu,
		closeAllCardMenus,
		handleCardArrowKey,
		dispose() {
			disposed = true;
			operationPanel?.remove();
			unsubscribe();
			unbind?.();
			if (progressTimer !== undefined && progressTimer !== null) {
				window.clearInterval(progressTimer);
			}
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKeydown);
			ports.resetPresentation?.();
		},
	});
}

export function getOfficialAccountViewCode() {
	return `
    const accountAppearanceRenderer = (${serializeBrowserFunction(createAccountRenderer)})();
    const createOfficialAccountView = ${serializeBrowserFunction(createOfficialAccountView)};
    let officialAccountView = null;
    function getOfficialAccountView() {
      if (!officialAccountView) {
        const runtime = getThemeRuntime();
        officialAccountView = createOfficialAccountView({
          document, window, sdk: runtime.sdk, renderer: accountAppearanceRenderer,
          shouldRender: () => !document.documentElement.hasAttribute('data-app-theme-startup'),
          translate: (...args) => t(...args), getLanguage: () => typeof getLanguage === 'function' ? getLanguage() : 'en',
          prepareCopy: target => runtime.prepareCopy(target),
          resetPresentation: () => { if (typeof otpPresentation !== 'undefined') otpPresentation.reset('render'); },
          renderCommitted: id => otpPresentation.renderCommitted(id, getOtpEngine().readCommitted(id)),
          renderProgress: accounts => {
            const now = getCorrectedNowMs() / 1000;
            accounts.forEach(account => { const element = document.getElementById('progress-' + account.ref.id); if (element && account.type !== 'HOTP') element.style.width = ((account.period - now % account.period) / account.period * 100) + '%'; });
          },
          updateControls: selection => { if (typeof updateOfficialViewControls === 'function') updateOfficialViewControls(selection); if (typeof syncAppearanceView === 'function') syncAppearanceView(selection); },
          feedback: (id, slot) => slot === 'next' ? showNextOTPCopyFeedback(id) : showOTPCopyFeedback(id),
          copyUnavailable: () => showCenterToast('⏳', t('coreCodeUpdating')),
          copyFailed: () => showCenterToast('❌', t('otpCopyFailed')),
          recoveryFeedback: key => showCenterToast('⚠️', t(key)),
          auxiliaryFeedback: (action, name, outcome) => showCenterToast(outcome.clipboard === 'copied' ? '🔗' : '❌', outcome.clipboard === 'copied' ? t(action === 'uri' ? 'coreCopiedUriService' : 'coreCopiedLinkService', { name }) : t(action === 'uri' ? 'coreCopyUriFailed' : 'coreCopyLinkFailed')),
          refreshCodes: () => { void getOtpEngine().refresh(undefined, { includeHOTP: true }); showCenterToast('ℹ️', t('coreCodesRefreshed')); },
          toggleDebug: () => { debugMode = !debugMode; showCenterToast('ℹ️', t('coreDebug') + t(debugMode ? 'coreEnabled' : 'coreDisabled')); },
          searchIcon: ${JSON.stringify(dialogIcon('search'))}, keyIcon: ${JSON.stringify(dialogIcon('key'))}
        });
      }
      return officialAccountView;
    }
    function renderSecrets() { return renderFilteredSecrets(); }
    function renderFilteredSecrets() { if (!document.getElementById('secretsList')) { getThemeRuntime().publish(); return; } return getOfficialAccountView().render(); }
    function createSecretCard(account) { return getOfficialAccountView().createSecretCard(account); }
    function toggleCardMenu(id) { return getOfficialAccountView().toggleCardMenu(id); }
    function closeAllCardMenus() { if (officialAccountView) officialAccountView.closeAllCardMenus(); }
    function handleCardArrowKey(event) { return getOfficialAccountView().handleCardArrowKey(event); }
    function copyOTP(id) { return getOfficialAccountView().copy(id, 'current'); }
    function copyNextOTP(id) { return getOfficialAccountView().copy(id, 'next'); }
    function copyOTPFromCard(event, id) {
      if (event.target.closest('a,button,input,select,textarea,.card-menu,.secret-actions')) return;
      return copyOTP(id);
    }
    function showOTPCopyFeedback(id) { const account = getThemeRuntime().sdk.getSnapshot().library.accounts.find(item => item.ref.id === String(id)); showCenterToast('✅', t('coreCopiedService', { name: account?.service.label || t('coreCode') })); }
    function showNextOTPCopyFeedback(id) { const account = getThemeRuntime().sdk.getSnapshot().library.accounts.find(item => item.ref.id === String(id)); showCenterToast('⏭️', t('coreCopiedNextService', { name: account?.service.label || t('coreCode') })); }
  `;
}
