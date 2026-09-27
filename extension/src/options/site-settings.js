import { t, tPlural, localizeError } from '../shared/i18n.js';
import { MESSAGE } from '../shared/protocol.js';
import { getBindings } from '../shared/storage.js';

// Website policies, remembered accounts and their asynchronous views share one lifecycle.
export function createSiteSettings({ document, send, setBusy }) {
	const elements = {
		search: document.getElementById('binding-search'),
		siteSettings: document.getElementById('site-settings'),
		siteList: document.getElementById('site-list'),
		siteCount: document.getElementById('site-count'),
		siteEmpty: document.getElementById('site-empty'),
		siteStatus: document.getElementById('site-status'),
		siteSearch: document.getElementById('site-search-wrapper'),
		clearSearch: document.getElementById('clear-site-search'),
		retrySites: document.getElementById('retry-site-settings'),
	};
	let currentOrigin = null;
	let optionsBusy = false;
	let optionsClosed = false;
	let accountNames = new Map();
	let accountLoadVersion = 0;
	let renderVersion = 0;
	let autofillVersion = 0;
	let siteBindings = [];
	let siteAutofill = [];
	let bindingsLoaded = false;
	let autofillLoaded = false;
	let siteNotice = '';
	let siteMutationVersion = 0;
	const siteErrors = new Map();
	let siteBindingsPending = false;
	let siteAutofillPending = false;
	let siteRefreshRunning = false;

	async function flushSiteUpdates() {
		if (optionsClosed || optionsBusy || siteRefreshRunning || !currentOrigin || (!siteBindingsPending && !siteAutofillPending)) {
			return;
		}
		const bindings = siteBindingsPending;
		const autofill = siteAutofillPending;
		siteBindingsPending = false;
		siteAutofillPending = false;
		siteRefreshRunning = true;
		try {
			await Promise.all([bindings ? renderBindings() : undefined, autofill ? refreshAutofillSites() : undefined]);
		} finally {
			siteRefreshRunning = false;
			void flushSiteUpdates();
		}
	}

	function setOrigin(origin) {
		if (origin === currentOrigin) {
			return;
		}
		currentOrigin = origin;
		invalidateAccountNames(true);
		siteBindings = [];
		siteAutofill = [];
		bindingsLoaded = false;
		autofillLoaded = false;
		siteNotice = '';
		siteErrors.clear();
		siteBindingsPending = false;
		siteAutofillPending = false;
		siteMutationVersion += 1;
		renderVersion += 1;
		autofillVersion += 1;
		renderSiteSettings();
	}

	function renderSiteFeedback() {
		const errors = [...siteErrors.values()];
		elements.siteStatus.textContent = errors.length
			? errors.map((error) => localizeError(error)).join(t('optionsErrorSeparator'))
			: siteNotice
				? siteNotice()
				: '';
		elements.siteStatus.dataset.tone = errors.length ? 'error' : 'success';
		elements.retrySites.hidden = errors.length === 0;
	}

	function describeAccount(binding) {
		const account = accountNames.get(binding.accountId);
		return account ? `${account.name}${account.account ? ` · ${account.account}` : ''}` : t('optionsAccountUnavailable');
	}

	async function disableSite(site) {
		if (optionsBusy || optionsClosed || site.instanceOrigin !== currentOrigin) {
			return;
		}
		const version = ++siteMutationVersion;
		autofillVersion += 1;
		setBusy(true);
		try {
			const updated = await send({
				type: MESSAGE.SET_AUTOFILL_SITE,
				instanceOrigin: site.instanceOrigin,
				targetOrigin: site.targetOrigin,
				targetPath: site.targetPath,
				enabled: false,
			});
			if (optionsClosed || version !== siteMutationVersion || currentOrigin !== site.instanceOrigin) {
				return;
			}
			if (updated?.instanceOrigin !== currentOrigin || !Array.isArray(updated.sites)) {
				throw Object.assign(new Error(t('optionsSitesInstanceChanged')), { i18nKey: 'optionsSitesInstanceChanged' });
			}
			siteAutofill = updated.sites.filter((entry) => entry.instanceOrigin === currentOrigin);
			autofillVersion += 1;
			autofillLoaded = true;
			siteErrors.delete('autofill');
			siteNotice = () => t('optionsAutofillDisabled', { site: `${site.targetOrigin}${site.targetPath}` });
			renderSiteSettings();
		} catch (error) {
			if (!optionsClosed && version === siteMutationVersion && currentOrigin === site.instanceOrigin) {
				siteErrors.set('autofill', error);
				renderSiteFeedback();
			}
		} finally {
			if (!optionsClosed && version === siteMutationVersion) {
				setBusy(false);
			}
		}
	}

	async function forgetAccount(binding) {
		if (optionsBusy || optionsClosed || binding.instanceOrigin !== currentOrigin) {
			return;
		}
		const version = ++siteMutationVersion;
		renderVersion += 1;
		setBusy(true);
		try {
			await send({
				type: MESSAGE.REMOVE_BINDING,
				instanceOrigin: binding.instanceOrigin,
				targetOrigin: binding.targetOrigin,
				accountId: binding.accountId,
			});
			if (optionsClosed || version !== siteMutationVersion || binding.instanceOrigin !== currentOrigin) {
				return;
			}
			siteBindings = siteBindings.filter((entry) => entry.targetOrigin !== binding.targetOrigin || entry.accountId !== binding.accountId);
			renderVersion += 1;
			siteErrors.delete('bindings');
			siteNotice = () => t('optionsAccountForgotten', { site: binding.targetOrigin });
			renderSiteSettings();
		} catch (error) {
			if (!optionsClosed && version === siteMutationVersion && currentOrigin === binding.instanceOrigin) {
				siteErrors.set('bindings', error);
				renderSiteFeedback();
			}
		} finally {
			if (!optionsClosed && version === siteMutationVersion) {
				setBusy(false);
			}
		}
	}

	function renderSiteSettings() {
		elements.siteSettings.hidden = !currentOrigin;
		const sites = new Map();
		for (const site of siteAutofill) {
			if (!sites.has(site.targetOrigin)) {
				sites.set(site.targetOrigin, { targetOrigin: site.targetOrigin, authorizations: [], bindings: [] });
			}
			sites.get(site.targetOrigin).authorizations.push(site);
		}
		for (const binding of siteBindings) {
			if (!sites.has(binding.targetOrigin)) {
				sites.set(binding.targetOrigin, { targetOrigin: binding.targetOrigin, authorizations: [], bindings: [] });
			}
			sites.get(binding.targetOrigin).bindings.push(binding);
		}
		const query = elements.search.value.trim().toLocaleLowerCase();
		const visible = [...sites.values()].filter((site) => {
			const terms = [site.targetOrigin, ...site.authorizations.map((authorization) => authorization.targetPath)];
			for (const binding of site.bindings) {
				const account = accountNames.get(binding.accountId);
				terms.push(binding.accountId, account?.name, account?.account);
			}
			return terms.join(' ').toLocaleLowerCase().includes(query);
		});
		visible.sort((a, b) => a.targetOrigin.localeCompare(b.targetOrigin));
		elements.siteList.replaceChildren();
		elements.siteCount.textContent = sites.size
			? tPlural(query ? 'optionsSiteCountFiltered' : 'optionsSiteCount', query ? sites.size : visible.length, {
					count: visible.length,
					total: sites.size,
				})
			: '';
		elements.siteSearch.hidden = sites.size < 5 && !query && !siteErrors.size;
		elements.clearSearch.hidden = !query;
		elements.siteEmpty.hidden = visible.length > 0;
		elements.siteEmpty.textContent = query
			? t('optionsSitesNoMatch')
			: bindingsLoaded && autofillLoaded
				? t('optionsSitesEmpty')
				: siteErrors.size
					? t('optionsSitesFailed')
					: t('optionsSitesLoading');
		for (const site of visible) {
			const card = document.createElement('article');
			card.className = 'site-card';
			card.dataset.origin = site.targetOrigin;
			const header = document.createElement('div');
			header.className = 'site-card-header';
			const labels = document.createElement('div');
			const origin = document.createElement('span');
			origin.className = 'site-origin';
			origin.textContent = site.targetOrigin;
			const status = document.createElement('span');
			status.className = 'site-autofill-state';
			status.textContent = site.authorizations.length
				? t('optionsAutofillOn')
				: autofillLoaded
					? t('optionsAutofillOff')
					: t('optionsAutofillUnavailable');
			labels.append(origin, status);
			header.append(labels);
			card.append(header);
			for (const authorization of site.authorizations.sort((a, b) => a.targetPath.localeCompare(b.targetPath))) {
				const pathRow = document.createElement('div');
				pathRow.className = 'site-autofill-path';
				pathRow.dataset.path = authorization.targetPath;
				const path = document.createElement('span');
				path.className = 'site-path';
				path.textContent = authorization.targetPath;
				const disable = document.createElement('button');
				disable.type = 'button';
				disable.className = 'secondary-button autofill-disable';
				disable.textContent = t('optionsDisable');
				disable.setAttribute('aria-label', t('optionsDisableLabel', { site: `${site.targetOrigin}${authorization.targetPath}` }));
				disable.disabled = optionsBusy;
				disable.addEventListener('click', () => void disableSite(authorization));
				pathRow.append(path, disable);
				card.append(pathRow);
			}
			if (site.bindings.length) {
				const caption = document.createElement('p');
				caption.className = 'site-accounts-caption';
				caption.textContent = t('optionsRememberedAccounts');
				const accounts = document.createElement('ul');
				accounts.className = 'site-accounts';
				for (const binding of site.bindings) {
					const item = document.createElement('li');
					item.className = 'binding-item';
					item.dataset.accountId = binding.accountId;
					const account = document.createElement('span');
					account.className = 'binding-account';
					account.textContent = describeAccount(binding);
					if (!accountNames.has(binding.accountId)) {
						account.title = t('optionsAccountId', { id: binding.accountId });
					}
					const forget = document.createElement('button');
					forget.type = 'button';
					forget.className = 'secondary-button binding-forget';
					forget.textContent = t('optionsForget');
					forget.setAttribute('aria-label', t('optionsForgetLabel', { site: site.targetOrigin, account: account.textContent }));
					forget.disabled = optionsBusy;
					forget.addEventListener('click', () => void forgetAccount(binding));
					item.append(account, forget);
					accounts.append(item);
				}
				card.append(caption, accounts);
			}
			elements.siteList.append(card);
		}
		renderSiteFeedback();
	}

	function translate() {
		const active = document.activeElement;
		const focusedOrigin = elements.siteList.contains(active) ? active.closest('.site-card')?.dataset.origin : null;
		const focusedPath = active?.closest('.site-autofill-path')?.dataset.path;
		const focusedAccount = active?.closest('.binding-item')?.dataset.accountId;
		renderSiteSettings();
		if (!focusedOrigin) {
			return;
		}
		const card = [...elements.siteList.querySelectorAll('.site-card')].find((node) => node.dataset.origin === focusedOrigin);
		const row =
			focusedPath !== undefined
				? [...(card?.querySelectorAll('.site-autofill-path') || [])].find((node) => node.dataset.path === focusedPath)
				: [...(card?.querySelectorAll('.binding-item') || [])].find((node) => node.dataset.accountId === focusedAccount);
		const button = row?.querySelector('button');
		if (button && !button.disabled) {
			button.focus({ preventScroll: true });
		}
	}

	async function refreshAutofillSites() {
		const origin = currentOrigin;
		const version = ++autofillVersion;
		if (!origin) {
			return;
		}
		try {
			const result = await send({ type: MESSAGE.GET_AUTOFILL_SITES });
			if (optionsClosed || version !== autofillVersion || currentOrigin !== origin) {
				return;
			}
			if (result?.instanceOrigin !== origin || !Array.isArray(result.sites)) {
				throw Object.assign(new Error(t('optionsSitesInstanceChanged')), { i18nKey: 'optionsSitesInstanceChanged' });
			}
			siteAutofill = result.sites.filter((site) => site.instanceOrigin === origin);
			autofillLoaded = true;
			siteErrors.delete('autofill');
		} catch (error) {
			if (!optionsClosed && version === autofillVersion && currentOrigin === origin) {
				siteErrors.set('autofill', error);
			}
		}
		if (!optionsClosed && version === autofillVersion && currentOrigin === origin) {
			renderSiteSettings();
		}
	}

	async function renderBindings() {
		const origin = currentOrigin;
		const version = ++renderVersion;
		if (!origin) {
			return;
		}
		try {
			const allBindings = await getBindings();
			if (optionsClosed || version !== renderVersion || currentOrigin !== origin) {
				return;
			}
			siteBindings = allBindings.filter((binding) => binding.instanceOrigin === origin);
			bindingsLoaded = true;
			siteErrors.delete('bindings');
		} catch (error) {
			if (!optionsClosed && version === renderVersion && currentOrigin === origin) {
				siteErrors.set('bindings', error);
			}
		}
		if (!optionsClosed && version === renderVersion && currentOrigin === origin) {
			renderSiteSettings();
		}
	}

	async function loadAccountNames() {
		const version = ++accountLoadVersion;
		const origin = currentOrigin;
		const result = await send({ type: MESSAGE.CHECK_INSTANCE });
		if (version !== accountLoadVersion || origin !== currentOrigin || result.instanceOrigin !== origin) {
			throw Object.assign(new Error(t('optionsRecheckChanged')), { i18nKey: 'optionsRecheckChanged' });
		}
		accountNames = new Map((result.accounts || []).map((account) => [account.id, account]));
		await renderBindings();
		return result;
	}

	function clearSearch() {
		elements.search.value = '';
		renderSiteSettings();
		elements.search.focus();
	}
	async function retry() {
		if (optionsBusy || optionsClosed) {
			return;
		}
		setBusy(true);
		try {
			await Promise.all([renderBindings(), refreshAutofillSites()]);
		} finally {
			if (!optionsClosed) {
				setBusy(false);
			}
		}
	}
	function invalidateAccountNames(clear = false) {
		accountLoadVersion += 1;
		if (clear) {
			accountNames = new Map();
		}
	}

	function onStorageChanged(changes, areaName) {
		if (optionsClosed || areaName !== 'local') {
			return;
		}
		siteBindingsPending ||= Boolean(changes.bindings);
		siteAutofillPending ||= Boolean(changes.autofillSites);
		void flushSiteUpdates();
	}

	elements.search.addEventListener('input', renderSiteSettings);
	elements.clearSearch.addEventListener('click', clearSearch);
	elements.retrySites.addEventListener('click', retry);
	chrome.storage?.onChanged?.addListener(onStorageChanged);

	return {
		setOrigin,
		translate,
		setBusy(busy) {
			optionsBusy = busy;
			if (!busy) {
				void flushSiteUpdates();
			}
		},
		loadAccountNames,
		invalidateAccountNames,
		refreshBindings: renderBindings,
		refreshAutofill: refreshAutofillSites,
		dispose() {
			if (optionsClosed) {
				return;
			}
			optionsClosed = true;
			renderVersion += 1;
			autofillVersion += 1;
			siteMutationVersion += 1;
			accountLoadVersion += 1;
			accountNames.clear();
			siteBindingsPending = false;
			siteAutofillPending = false;
			elements.search.removeEventListener('input', renderSiteSettings);
			elements.clearSearch.removeEventListener('click', clearSearch);
			elements.retrySites.removeEventListener('click', retry);
			chrome.storage?.onChanged?.removeListener(onStorageChanged);
		},
	};
}
