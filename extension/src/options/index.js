import {
	t,
	tPlural,
	LANGUAGE_OPTIONS,
	initI18n,
	onLanguageChange,
	applyTranslations,
	getLanguagePreference,
	setLanguagePreference,
	localizeError,
} from '../shared/i18n.js';
import { MESSAGE } from '../shared/protocol.js';
import { originToPermissionPattern } from '../shared/origin.js';
import { normalizeConnectionAddress } from './connection-address.js';
import { getInstanceOrigins, getConnectionStatus } from '../shared/storage.js';
import { createSiteSettings } from './site-settings.js';
import { createConnectionChecks } from './connection-check.js';

const elements = {
	language: document.getElementById('extension-language'),
	languageStatus: document.getElementById('language-status'),
	version: document.getElementById('extension-version'),
	form: document.getElementById('instance-form'),
	editor: document.getElementById('connection-editor'),
	summary: document.getElementById('connection-summary'),
	currentInstance: document.getElementById('current-instance'),
	connect: document.getElementById('connect-instance'),
	offlineApplyHint: document.getElementById('offline-apply-hint'),
	cancel: document.getElementById('cancel-connection'),
	footerInstance: document.getElementById('footer-instance'),
	privacyToggle: document.getElementById('privacy-toggle'),
	privacyContent: document.getElementById('privacy-content'),
	importOffline: document.getElementById('import-offline'),
	offlineEnabled: document.getElementById('offline-enabled'),
	saved: document.getElementById('saved-instances'),
	savedWrapper: document.getElementById('saved-instances-wrapper'),
	setupGuide: document.getElementById('setup-guide'),
	input: document.getElementById('instance-origin'),
	status: document.getElementById('status'),
	loginNextStep: document.getElementById('login-next-step'),
	check: document.getElementById('check-instance'),
	open: document.getElementById('open-instance'),
};

// Build the choices from the same registry used by preference validation and
// browser manifests. Translation updates only labels, never the selected node.
for (const option of LANGUAGE_OPTIONS) {
	const element = document.createElement('option');
	element.value = option.value;
	element.lang = option.value;
	element.textContent = option.label;
	elements.language.append(element);
}

const extensionVersion = chrome.runtime.getManifest().version;
elements.version.textContent = `v${extensionVersion}`;
elements.version.setAttribute('aria-label', t('optionsVersion', { version: extensionVersion }));

let statusMessage = null;
let languageError = null;
let disposeI18n = () => {};
let currentOrigin = null;
let optionsBusy = false;
let connectionLoading = false;
let connectionLoadFailed = false;
let optionsClosed = false;
let currentConnectionMode = null;
let displayedConnectionOrigin = null;
let offlineStatusVersion = 0;
let offlineUpdatePending = false;
let offlineUpdateRunning = false;
let formRevision = 0;
let settingsLoaded = false;
let editingConnection = false;
let connectionSubmitting = false;
let offlineCacheStatus = null;
let settingsRefreshPending = false;
let settingsRefreshRunning = false;
let settingsRevision = 0;
// Explicit choices belong to this edit session and their normalized instance.
const connectionDraftModes = new Map();
// Partially typed hostnames can already be valid origins.
// Keep the pre-address choice until saving or explicitly selecting an instance.
let addressInputDraftMode = null;
const sites = createSiteSettings({ document, send, setBusy });
const checks = createConnectionChecks({
	document,
	window,
	isReady: hasSavedConnection,
	isBlocked: () => optionsBusy || connectionLoading,
	async run() {
		const result = await sites.loadAccountNames();
		await refreshOfflineStatus();
		return result;
	},
	onStart() {
		setStatus('optionsConnecting');
		elements.check.hidden = true;
		elements.open.hidden = false;
	},
	onSuccess(result) {
		if (result.offlineStatus?.usingCache && offlineCacheStatus?.available === false) {
			showOfflineCacheUnavailable();
			return;
		}
		if (
			!showAccountStatus(result.accountCount, result.unavailableCount, result.offlineStatus?.usingCache, result.offlineStatus?.clockStatus)
		) {
			return;
		}
		elements.check.hidden = true;
		elements.open.hidden = true;
		elements.open.textContent = t('optionsOpen');
	},
	onError: showConnectionError,
});

function renderConnectionLayout() {
	elements.editor.hidden = false;
	elements.summary.hidden = !currentOrigin || !editingConnection;
	elements.cancel.hidden = !currentOrigin || !editingConnection;
	elements.connect.textContent = connectionSubmitting
		? t('optionsConnectingButton')
		: !currentOrigin
			? t('optionsConnect')
			: editingConnection
				? t('optionsSaveConnect')
				: t('optionsCheckConnection');
	elements.form.setAttribute('aria-busy', String(connectionSubmitting));
	elements.offlineApplyHint.textContent = currentOrigin && !editingConnection ? t('optionsApplyImmediately') : t('optionsApplyWithAddress');
	elements.setupGuide.hidden = Boolean(currentOrigin);
	elements.footerInstance.hidden = !currentOrigin;
	if (currentOrigin) {
		elements.currentInstance.textContent = currentOrigin;
		elements.currentInstance.href = currentOrigin;
		elements.footerInstance.href = currentOrigin;
	}
}

function renderOfflineRecovery() {
	elements.importOffline.hidden = !(
		hasSavedConnection() &&
		currentConnectionMode === 'offline' &&
		offlineCacheStatus?.available === false &&
		['SOURCE_UNAVAILABLE', 'SOURCE_OFFLINE', 'OFFLINE_CACHE_MISSING'].includes(elements.status.dataset.code)
	);
}

function showAccountStatus(count, unavailableCount = 0, offline = false, clockStatus) {
	if (clockStatus === 'changed') {
		showConnectionError({ code: 'CLOCK_CHANGED' });
		return false;
	}
	if (clockStatus === 'unavailable') {
		showConnectionError({ code: 'CLOCK_UNAVAILABLE' });
		return false;
	}
	setStatus(
		() =>
			tPlural('optionsAccountStatus', count, {
				connection: t(offline ? 'optionsOfflineReady' : 'optionsConnected'),
				count,
				unavailable: unavailableCount ? tPlural('optionsUnavailableAccounts', unavailableCount, {}, 'optionsUnavailableAccountOne') : '',
			}),
		'success',
	);
	return true;
}

function selectedConnectionMode() {
	return elements.offlineEnabled.checked ? 'offline' : 'session';
}

function rememberConnectionDraft() {
	let origin = null;
	try {
		origin = normalizeConnectionAddress(elements.input.value);
	} catch {
		// Associate this choice with the next valid address the user supplies.
	}
	const mode = selectedConnectionMode();
	if (!origin || addressInputDraftMode !== null) {
		addressInputDraftMode = mode;
	} else {
		connectionDraftModes.set(origin, mode);
	}
}

function clearConnectionDraft() {
	connectionDraftModes.clear();
	addressInputDraftMode = null;
}

function hasSavedConnection() {
	try {
		return (
			currentOrigin &&
			!editingConnection &&
			normalizeConnectionAddress(elements.input.value) === currentOrigin &&
			selectedConnectionMode() === currentConnectionMode &&
			!connectionLoading &&
			!connectionLoadFailed
		);
	} catch {
		return false;
	}
}

function translationError(key) {
	return Object.assign(new Error(t(key)), { i18nKey: key });
}

function renderStatusText() {
	elements.status.textContent = typeof statusMessage === 'function' ? statusMessage() : statusMessage ? t(statusMessage) : '';
}

function setStatus(message, tone = 'info') {
	statusMessage = message;
	renderStatusText();
	elements.status.dataset.tone = tone;
	delete elements.status.dataset.code;
	elements.loginNextStep.hidden = true;
	elements.open.classList.remove('primary-button');
	elements.open.classList.add('secondary-button');
	renderOfflineRecovery();
}

function showConnectionError(error) {
	setStatus(() => localizeError(error), 'error');
	if (error.code) {
		elements.status.dataset.code = error.code;
	}
	renderOfflineRecovery();
	elements.check.hidden = false;
	elements.open.hidden = !currentOrigin || editingConnection;
	elements.open.textContent = error.code === 'AUTH_REQUIRED' ? t('optionsSignIn') : t('optionsOpen');
	elements.open.classList.toggle('primary-button', error.code === 'AUTH_REQUIRED');
	elements.open.classList.toggle('secondary-button', error.code !== 'AUTH_REQUIRED');
	elements.loginNextStep.hidden = error.code !== 'AUTH_REQUIRED' || editingConnection || !currentOrigin;
}

function showOfflineCacheUnavailable() {
	// Cache status alone cannot distinguish a removed cache from an empty vault.
	// A connection check establishes whether logging in or syncing is needed.
	showConnectionError({ code: 'OFFLINE_CACHE_UNAVAILABLE' });
}

function setBusy(busy) {
	optionsBusy = busy;
	renderConnectionLayout();
	sites.setBusy(busy);
	for (const button of document.querySelectorAll('button, input, select')) {
		if (button !== elements.language) {
			button.disabled = busy;
		}
	}
	for (const button of elements.form.querySelectorAll('button[type="submit"]')) {
		button.disabled = busy || connectionLoading || connectionLoadFailed;
	}
	elements.offlineEnabled.disabled = busy || connectionLoading || connectionLoadFailed;
	if (!busy) {
		void flushSettingsRefresh();
		void flushOfflineUpdate();
		void checks.flush();
	}
}

async function send(message) {
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		const error = Object.assign(new Error(response?.error?.message || ''), response?.error);
		throw error;
	}
	return response.data;
}

async function refreshOfflineStatus() {
	const origin = currentOrigin;
	const version = ++offlineStatusVersion;
	const revision = formRevision;
	if (!origin || currentConnectionMode !== 'offline' || displayedConnectionOrigin !== origin || selectedConnectionMode() !== 'offline') {
		return;
	}
	const cached = await send({ type: MESSAGE.OFFLINE_STATUS });
	if (
		optionsClosed ||
		version !== offlineStatusVersion ||
		revision !== formRevision ||
		origin !== currentOrigin ||
		displayedConnectionOrigin !== origin ||
		selectedConnectionMode() !== 'offline'
	) {
		return;
	}
	if (cached.instanceOrigin !== origin) {
		throw translationError('optionsInstanceChanged');
	}
	offlineCacheStatus = cached;
	if (
		hasSavedConnection() &&
		!checks.isChecking() &&
		(elements.status.dataset.tone === 'success' ||
			['CLOCK_CHANGED', 'CLOCK_UNAVAILABLE', 'OFFLINE_CACHE_UNAVAILABLE'].includes(elements.status.dataset.code))
	) {
		if (!cached.available) {
			// A removal notification does not tell us whether authentication failed.
			// Offer a fresh connection check, without restoring an old webpage cache.
			showOfflineCacheUnavailable();
		} else {
			const ready = showAccountStatus(cached.accountCount, cached.unavailableCount, true, cached.clockStatus);
			if (ready) {
				elements.check.hidden = true;
				elements.open.hidden = true;
			}
		}
	}
	renderOfflineRecovery();
}

async function flushOfflineUpdate() {
	if (optionsClosed || optionsBusy || connectionLoading || offlineUpdateRunning || !offlineUpdatePending) {
		return;
	}
	offlineUpdatePending = false;
	if (!currentOrigin || currentConnectionMode !== 'offline') {
		return;
	}
	const origin = currentOrigin;
	const revision = formRevision;
	offlineUpdateRunning = true;
	try {
		await refreshOfflineStatus();
	} catch (error) {
		if (!optionsClosed && currentOrigin === origin && revision === formRevision) {
			showConnectionError(error);
		}
	} finally {
		offlineUpdateRunning = false;
		void flushOfflineUpdate();
	}
}

function queueOfflineUpdate() {
	if (optionsClosed) {
		return;
	}
	offlineUpdatePending = true;
	void flushOfflineUpdate();
}

function onAccountsChanged(message, sender) {
	if (
		message?.type === MESSAGE.ACCOUNTS_CHANGED &&
		message.instanceOrigin === currentOrigin &&
		!sender?.tab &&
		(!sender?.id || sender.id === chrome.runtime.id)
	) {
		queueOfflineUpdate();
	}
}

function onOfflineStorageChanged(changes, areaName) {
	if (optionsClosed || areaName !== 'local') {
		return;
	}
	if (changes.settings || changes.offlineInstances) {
		settingsRevision += 1;
		settingsRefreshPending = true;
		void flushSettingsRefresh();
	}
	if (changes.offlineCache) {
		queueOfflineUpdate();
	}
}

async function refreshSavedSettings({ discardDraft = false } = {}) {
	const revision = settingsRevision;
	const settings = await send({ type: MESSAGE.GET_SETTINGS });
	const connection = settings.instanceOrigin ? await getConnectionStatus(settings.instanceOrigin) : null;
	if (optionsClosed || revision !== settingsRevision) {
		return false;
	}
	const changed = !settingsLoaded || settings.instanceOrigin !== currentOrigin || (connection?.mode ?? null) !== currentConnectionMode;
	if (!changed && !discardDraft && !connectionLoadFailed) {
		return true;
	}
	const keepDraft = editingConnection && !discardDraft;
	if (keepDraft && !connectionLoading) {
		rememberConnectionDraft();
	}
	formRevision += 1;
	checks.invalidate();
	sites.invalidateAccountNames(true);
	offlineStatusVersion += 1;
	offlineCacheStatus = null;
	cancelConnectionLoad();
	currentOrigin = settings.instanceOrigin;
	currentConnectionMode = connection?.mode ?? null;
	settingsLoaded = true;
	checks.setOrigin(currentOrigin);
	sites.setOrigin(currentOrigin);
	if (!keepDraft) {
		clearConnectionDraft();
		editingConnection = false;
		displayedConnectionOrigin = currentOrigin;
		elements.input.value = currentOrigin || '';
		elements.offlineEnabled.checked = currentConnectionMode === 'offline';
	}
	renderConnectionLayout();
	elements.open.hidden = !currentOrigin || keepDraft;
	elements.check.hidden = true;
	await sites.refreshBindings();
	await renderInstances(keepDraft);
	if (optionsClosed || revision !== settingsRevision) {
		return false;
	}
	void sites.refreshAutofill();
	if (keepDraft) {
		setStatus('optionsChangedWithDraft', 'notice');
	} else if (currentOrigin) {
		await refreshOfflineStatus().catch((error) => {
			if (!optionsClosed && revision === settingsRevision) {
				showConnectionError(error);
			}
		});
		if (!optionsClosed && revision === settingsRevision) {
			checks.request();
		}
	} else {
		setStatus('optionsConnectPrompt');
	}
	return true;
}

async function flushSettingsRefresh() {
	if (optionsClosed || optionsBusy || settingsRefreshRunning || !settingsRefreshPending) {
		return;
	}
	settingsRefreshPending = false;
	settingsRefreshRunning = true;
	setBusy(true);
	try {
		await refreshSavedSettings();
	} catch (error) {
		if (!optionsClosed) {
			showConnectionError(error);
		}
	} finally {
		settingsRefreshRunning = false;
		if (!optionsClosed) {
			setBusy(false);
		}
	}
}

async function renderInstances(preserveDraft = false) {
	const origins = await getInstanceOrigins();
	if (optionsClosed) {
		return;
	}
	elements.savedWrapper.hidden = origins.length < 2;
	elements.saved.replaceChildren();
	const placeholder = document.createElement('option');
	placeholder.value = '';
	placeholder.textContent = t('optionsRecentPlaceholder');
	elements.saved.append(placeholder);
	for (const origin of origins) {
		const option = document.createElement('option');
		option.value = origin;
		option.textContent = origin;
		elements.saved.append(option);
	}
	elements.saved.value = '';
	if (!preserveDraft && !currentOrigin && !elements.input.value && origins.length) {
		const previousOrigin = origins.at(-1);
		elements.input.value = previousOrigin;
		await loadConnection(previousOrigin);
		setStatus('optionsReconnectPrompt');
	}
}

let connectionVersion = 0;
function cancelConnectionLoad() {
	connectionVersion += 1;
	connectionLoading = false;
	connectionLoadFailed = false;
	for (const button of elements.form.querySelectorAll('button[type="submit"]')) {
		button.disabled = optionsBusy;
	}
	elements.offlineEnabled.disabled = optionsBusy;
}
async function loadConnection(origin) {
	const version = ++connectionVersion;
	displayedConnectionOrigin = origin;
	connectionLoading = true;
	connectionLoadFailed = false;
	for (const button of elements.form.querySelectorAll('button[type="submit"]')) {
		button.disabled = true;
	}
	try {
		const connection = await getConnectionStatus(origin);
		if (version !== connectionVersion) {
			return;
		}
		elements.offlineEnabled.checked = (addressInputDraftMode ?? connectionDraftModes.get(origin) ?? connection.mode) === 'offline';
		if (origin === currentOrigin) {
			currentConnectionMode = connection.mode;
		}
		renderOfflineRecovery();
		if (connection.mode === 'offline' && origin === currentOrigin) {
			// Cache diagnostics must not prevent turning off a saved local cache.
			await refreshOfflineStatus().catch((error) => {
				if (version === connectionVersion) {
					offlineCacheStatus = null;
					showConnectionError(error);
				}
			});
		}
	} catch (error) {
		if (version !== connectionVersion) {
			return;
		}
		connectionLoadFailed = true;
		throw error;
	} finally {
		if (version === connectionVersion) {
			connectionLoading = false;
			for (const button of elements.form.querySelectorAll('button[type="submit"]')) {
				button.disabled = optionsBusy || connectionLoadFailed;
			}
			elements.offlineEnabled.disabled = optionsBusy || connectionLoadFailed;
			void flushOfflineUpdate();
			void checks.flush();
		}
	}
}

async function load() {
	// Background initialization removes retired credentials before configuration is read.
	const revision = settingsRevision;
	const settings = await send({ type: MESSAGE.GET_SETTINGS });
	if (optionsClosed || revision !== settingsRevision) {
		return;
	}
	settingsLoaded = true;
	currentOrigin = settings.instanceOrigin;
	checks.setOrigin(currentOrigin);
	renderConnectionLayout();
	sites.setOrigin(currentOrigin);
	elements.open.hidden = !currentOrigin;
	if (currentOrigin) {
		elements.input.value = currentOrigin;
		try {
			await loadConnection(currentOrigin);
		} catch (error) {
			showConnectionError(error);
		}
	} else {
		elements.offlineEnabled.checked = false;
		renderOfflineRecovery();
	}
	await sites.refreshBindings();
	await renderInstances();
	if (optionsClosed || revision !== settingsRevision) {
		return;
	}
	if (currentOrigin && !connectionLoadFailed) {
		checks.request();
	}
	void sites.refreshAutofill();
}

elements.form.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (connectionLoading || connectionLoadFailed || optionsBusy) {
		setStatus('optionsLoadingConnection');
		return;
	}
	connectionVersion += 1;
	formRevision += 1;
	checks.invalidate();
	connectionSubmitting = true;
	setBusy(true);
	try {
		const instanceOrigin = normalizeConnectionAddress(elements.input.value);
		const connection = { mode: selectedConnectionMode() };
		const checkingCurrent = !editingConnection && instanceOrigin === currentOrigin && connection.mode === currentConnectionMode;
		const pattern = originToPermissionPattern(instanceOrigin);
		setStatus('optionsConnecting');
		const granted = await chrome.permissions.request({ origins: [pattern] });
		if (!granted) {
			throw translationError('optionsPermissionDenied');
		}
		if (checkingCurrent) {
			if (!(await refreshSavedSettings())) {
				return;
			}
			if (currentOrigin !== instanceOrigin || currentConnectionMode !== connection.mode || editingConnection) {
				setStatus('optionsConnectionChanged', 'notice');
				return;
			}
			await checks.check();
			return;
		}
		const result = await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin, connection });
		currentOrigin = result.instanceOrigin;
		checks.setOrigin(currentOrigin);
		clearConnectionDraft();
		editingConnection = false;
		offlineCacheStatus = null;
		renderConnectionLayout();
		sites.setOrigin(currentOrigin);
		elements.open.hidden = false;
		await loadConnection(result.instanceOrigin);
		sites.invalidateAccountNames(true);
		elements.input.value = currentOrigin;
		await sites.refreshBindings();
		await renderInstances();
		void sites.refreshAutofill();
		await checks.check();
	} catch (error) {
		showConnectionError(error);
	} finally {
		connectionSubmitting = false;
		setBusy(false);
	}
});

elements.check.addEventListener('click', async () => {
	if (optionsBusy || connectionLoading) {
		return;
	}
	setBusy(true);
	try {
		if (!settingsLoaded) {
			await load();
		} else if (!(await refreshSavedSettings())) {
			return;
		}
		if (connectionLoadFailed && displayedConnectionOrigin) {
			await loadConnection(displayedConnectionOrigin);
		}
		if (!hasSavedConnection()) {
			setStatus('optionsApplyPrompt');
			return;
		}
		await checks.check();
	} catch (error) {
		showConnectionError(error);
	} finally {
		setBusy(false);
	}
});

elements.open.addEventListener('click', async () => {
	setBusy(true);
	try {
		await send({ type: MESSAGE.OPEN_INSTANCE });
		checks.awaitLogin();
		setStatus('optionsOpened');
	} catch (error) {
		setStatus(() => localizeError(error), 'error');
	} finally {
		setBusy(false);
	}
});

function markFormEdited() {
	formRevision += 1;
	checks.invalidate();
	setStatus(currentOrigin ? 'optionsEditPrompt' : 'optionsAddressPrompt');
	elements.check.hidden = true;
	elements.open.hidden = true;
	offlineStatusVersion += 1;
	offlineCacheStatus = null;
}

elements.cancel.addEventListener('click', async () => {
	if (optionsBusy || !currentOrigin) {
		return;
	}
	markFormEdited();
	sites.invalidateAccountNames();
	setBusy(true);
	try {
		await refreshSavedSettings({ discardDraft: true });
	} catch (error) {
		showConnectionError(error);
	} finally {
		setBusy(false);
		if (!editingConnection && !optionsClosed) {
			elements.input.focus();
		}
	}
});

elements.privacyToggle.addEventListener('click', () => {
	const open = elements.privacyContent.hidden;
	elements.privacyContent.hidden = !open;
	elements.privacyToggle.setAttribute('aria-expanded', String(open));
});

elements.saved.addEventListener('change', () => {
	if (elements.saved.value) {
		addressInputDraftMode = null;
		editingConnection = true;
		renderConnectionLayout();
		markFormEdited();
		elements.input.value = elements.saved.value;
		void loadConnection(elements.saved.value).catch(showConnectionError);
	}
});

elements.offlineEnabled.addEventListener('change', async () => {
	const enabled = elements.offlineEnabled.checked;
	const applyImmediately =
		currentOrigin &&
		!editingConnection &&
		displayedConnectionOrigin === currentOrigin &&
		!connectionLoading &&
		!connectionLoadFailed &&
		elements.input.value === currentOrigin;
	if (optionsBusy) {
		elements.offlineEnabled.checked = currentConnectionMode === 'offline';
		return;
	}
	markFormEdited();
	cancelConnectionLoad();
	renderOfflineRecovery();
	if (!applyImmediately) {
		rememberConnectionDraft();
		return;
	}
	const origin = currentOrigin;
	sites.invalidateAccountNames();
	setBusy(true);
	setStatus(enabled ? 'optionsEnablingOffline' : 'optionsClearingSecrets');
	try {
		if (enabled) {
			const granted = await chrome.permissions.request({ origins: [originToPermissionPattern(origin)] });
			if (!granted) {
				throw translationError('optionsOfflinePermissionDenied');
			}
			await send({
				type: MESSAGE.SAVE_INSTANCE,
				instanceOrigin: origin,
				connection: { mode: 'offline' },
				expectedConnection: { instanceOrigin: origin, mode: currentConnectionMode },
			});
		} else {
			await send({ type: MESSAGE.CLEAR_OFFLINE, instanceOrigin: origin });
		}
		if (optionsClosed) {
			return;
		}
		await loadConnection(origin);
		if (enabled) {
			await checks.check();
		} else {
			setStatus('optionsOfflineDisabled', 'success');
			elements.check.hidden = true;
			elements.open.hidden = true;
			elements.open.textContent = t('optionsOpen');
		}
	} catch (error) {
		if (!optionsClosed) {
			try {
				await loadConnection(origin);
			} catch {
				// Keep controls disabled if the saved setting cannot be read safely.
			}
			showConnectionError(error);
		}
	} finally {
		if (!optionsClosed) {
			setBusy(false);
		}
	}
});
elements.input.addEventListener('input', () => {
	editingConnection = true;
	renderConnectionLayout();
	markFormEdited();
	try {
		void loadConnection(normalizeConnectionAddress(elements.input.value)).catch(showConnectionError);
	} catch {
		cancelConnectionLoad();
		displayedConnectionOrigin = null;
	}
});

function renderLanguage() {
	if (optionsClosed) {
		return;
	}
	applyTranslations(document);
	document.title = t('optionsTitle');
	elements.version.setAttribute('aria-label', t('optionsVersion', { version: extensionVersion }));
	elements.language.value = getLanguagePreference();
	elements.languageStatus.textContent = languageError ? localizeError(languageError, 'optionsLanguageFailed') : '';
	renderConnectionLayout();
	renderStatusText();
	elements.open.textContent = t(elements.status.dataset.code === 'AUTH_REQUIRED' ? 'optionsSignIn' : 'optionsOpen');
	const placeholder = elements.saved.querySelector('option[value=""]');
	if (placeholder) {
		placeholder.textContent = t('optionsRecentPlaceholder');
	}
	sites.translate();
}

const unsubscribeLanguage = onLanguageChange(renderLanguage);
elements.language.addEventListener('change', async () => {
	if (optionsClosed) {
		return;
	}
	elements.language.disabled = true;
	languageError = null;
	elements.languageStatus.textContent = '';
	try {
		await setLanguagePreference(elements.language.value);
		if (!optionsClosed) {
			renderLanguage();
		}
	} catch (error) {
		if (!optionsClosed) {
			languageError = error;
			elements.languageStatus.dataset.tone = 'error';
			elements.languageStatus.textContent = localizeError(error, 'optionsLanguageFailed');
			elements.language.value = getLanguagePreference();
		}
	} finally {
		if (!optionsClosed) {
			elements.language.disabled = false;
		}
	}
});

chrome.runtime.onMessage?.addListener(onAccountsChanged);
chrome.storage?.onChanged?.addListener(onOfflineStorageChanged);
setBusy(true);
initI18n()
	.then((dispose) => {
		disposeI18n = dispose;
		if (optionsClosed) {
			disposeI18n();
			return;
		}
		renderLanguage();
		return load();
	})
	.catch(() => showConnectionError(translationError('optionsSettingsFailed')))
	.finally(() => setBusy(false));

elements.importOffline.addEventListener('click', async () => {
	if (optionsBusy || connectionLoading || elements.importOffline.hidden) {
		return;
	}
	setBusy(true);
	try {
		if (
			!currentOrigin ||
			normalizeConnectionAddress(elements.input.value) !== currentOrigin ||
			(await getConnectionStatus(currentOrigin)).mode !== 'offline'
		) {
			throw translationError('optionsOfflineRequired');
		}
		setStatus('optionsRestoring');
		const result = await send({ type: MESSAGE.IMPORT_OFFLINE, instanceOrigin: currentOrigin });
		if (result.instanceOrigin !== currentOrigin) {
			throw translationError('optionsInstanceChanged');
		}
		await loadConnection(currentOrigin);
		elements.check.hidden = showAccountStatus(result.accountCount, result.unavailableCount, true, result.clockStatus);
	} catch (error) {
		showConnectionError(error);
	} finally {
		setBusy(false);
	}
});

window.addEventListener('pagehide', () => {
	optionsClosed = true;
	unsubscribeLanguage();
	disposeI18n();
	chrome.runtime.onMessage?.removeListener(onAccountsChanged);
	chrome.storage?.onChanged?.removeListener(onOfflineStorageChanged);
	checks.dispose();
	settingsRevision += 1;
	settingsRefreshPending = false;
	offlineStatusVersion += 1;
	offlineUpdatePending = false;
	sites.dispose();
	connectionVersion += 1;
});
