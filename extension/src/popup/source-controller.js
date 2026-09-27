import { t } from '../shared/i18n.js';
import { MESSAGE } from '../shared/protocol.js';
import { getSettings, STORAGE_KEYS } from '../shared/storage.js';
import { collectServiceDomains, sanitizeServiceIcons } from '../shared/service-icons.js';
import { sameFlowTarget } from './flow-session.js';

// Source maintenance has no nonce and never joins the preview/fill queue.
// This controller owns notification coalescing and all late-response guards.
export function createSourceController({
	instanceLink,
	session,
	send,
	isBusy,
	isAutomaticEligible,
	onInteraction,
	onSettingsInvalidated,
	onClockChanged,
	onSourceError,
	onRefreshFailed = () => {},
	onRefresh,
	onIcons,
}) {
	let closed = false;
	let instanceLinkVersion = 0;
	let renderedSourceRevision = null;
	let renderedClockRevision = null;
	let clockRefreshPending = false;
	let pendingSourceRefresh = null;
	let sourceRefreshTimer = null;
	let pendingIconRefresh = false;
	let iconRefreshTimer = null;
	let iconRefreshRunning = false;
	let iconConfigurationVersion = 0;
	let sourceConfigurationVersion = 0;
	let backgroundSourceRefresh = null;
	async function refreshInstanceLink() {
		const version = ++instanceLinkVersion;
		let instanceOrigin = null;
		try {
			({ instanceOrigin } = await getSettings());
		} catch {
			// Navigation remains available independently of source connection errors.
		}
		if (closed || version !== instanceLinkVersion) {
			return;
		}
		instanceLink.hidden = !instanceOrigin;
		if (instanceOrigin) {
			instanceLink.href = instanceOrigin;
			instanceLink.title = instanceOrigin;
			instanceLink.setAttribute('aria-label', t('popupInstanceLink', { origin: instanceOrigin }));
		} else {
			for (const attribute of ['href', 'title', 'aria-label']) {
				instanceLink.removeAttribute(attribute);
			}
		}
	}

	function onSettingsChanged(changes, areaName) {
		if (areaName === 'local' && [STORAGE_KEYS.SETTINGS, STORAGE_KEYS.OFFLINE_INSTANCES].some((key) => changes[key])) {
			invalidateIconReads();
			sourceConfigurationVersion += 1;
			onInteraction();
			clearTimeout(sourceRefreshTimer);
			sourceRefreshTimer = null;
			pendingSourceRefresh = null;
			onSettingsInvalidated();
		}
		if (areaName === 'local' && changes.settings) {
			void refreshInstanceLink();
		}
	}

	function scheduleSourceRefresh() {
		if (closed || isBusy() || !pendingSourceRefresh || sourceRefreshTimer !== null) {
			return;
		}
		sourceRefreshTimer = setTimeout(() => {
			sourceRefreshTimer = null;
			if (closed || isBusy() || !pendingSourceRefresh) {
				return;
			}
			const request = pendingSourceRefresh;
			pendingSourceRefresh = null;
			if (request.instanceOrigin && request.instanceOrigin !== session.flow?.instanceOrigin) {
				return;
			}
			if (
				!request.force &&
				!request.refreshSource &&
				request.revision &&
				request.revision === renderedSourceRevision &&
				request.clockRevision === renderedClockRevision
			) {
				return;
			}
			if (request.refreshSource && session.flow?.authMode === 'offline') {
				void refreshSourceInBackground();
				return;
			}
			void onRefresh({
				refreshSource: request.refreshSource,
				skipAutomatic: !request.allowAutomatic,
				preserveView: true,
				expectedFlow: request.expectedFlow || session.flow,
			});
		}, 80);
	}

	function queueSourceRefresh({
		instanceOrigin = session.flow?.instanceOrigin,
		revision = null,
		clockRevision = renderedClockRevision,
		refreshSource = false,
		force = false,
		allowAutomatic = false,
		expectedFlow = null,
	} = {}) {
		if (
			closed ||
			(!force && !refreshSource && revision && revision === renderedSourceRevision && clockRevision === renderedClockRevision)
		) {
			return;
		}
		if (clockRevision !== renderedClockRevision) {
			// A new time correction can invalidate an otherwise unexpired OTP.
			// Clear it synchronously, even while another operation delays the refresh.
			clockRefreshPending = true;
			onClockChanged();
		}
		pendingSourceRefresh = {
			instanceOrigin,
			revision,
			clockRevision,
			refreshSource: refreshSource || Boolean(pendingSourceRefresh?.refreshSource),
			force: force || Boolean(pendingSourceRefresh?.force),
			allowAutomatic: allowAutomatic || Boolean(pendingSourceRefresh?.allowAutomatic),
			expectedFlow: expectedFlow || pendingSourceRefresh?.expectedFlow,
		};
		scheduleSourceRefresh();
	}

	async function refreshSourceInBackground({ allowAutomatic = false, clockOnly = false } = {}) {
		if (closed || backgroundSourceRefresh || session.flow?.authMode !== 'offline') {
			return;
		}
		const request = { expectedFlow: session.flow, configurationVersion: sourceConfigurationVersion };
		backgroundSourceRefresh = request;
		try {
			// Account maintenance must never reserve a nonce or block local previews,
			// clipboard actions, search, or scrolling behind a network request.
			// A clock-only request waits for the background time check of a restored
			// correction; it never reads the vault.
			await send({
				type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS,
				instanceOrigin: request.expectedFlow.instanceOrigin,
				...(clockOnly ? { clockOnly: true } : {}),
			});
			if (closed || request.configurationVersion !== sourceConfigurationVersion || !sameFlowTarget(request.expectedFlow, session.flow)) {
				return;
			}
			// A successful check can leave account and clock revisions unchanged.
			// Read its verification state even when no change notice was broadcast.
			queueSourceRefresh({
				force: true,
				allowAutomatic: allowAutomatic && isAutomaticEligible(),
				expectedFlow: request.expectedFlow,
			});
		} catch (error) {
			if (closed || request.configurationVersion !== sourceConfigurationVersion || !sameFlowTarget(request.expectedFlow, session.flow)) {
				return;
			}
			onInteraction();
			if (!clockOnly && !['SOURCE_OFFLINE', 'SOURCE_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(error.code)) {
				onSourceError(error);
			} else {
				// The cached view stays usable, but its pending verification has ended.
				onRefreshFailed();
			}
		} finally {
			if (backgroundSourceRefresh === request) {
				backgroundSourceRefresh = null;
			}
		}
	}

	function onAccountsChanged(message, sender) {
		if (
			message?.type !== MESSAGE.ACCOUNTS_CHANGED ||
			sender?.tab ||
			(sender?.id && sender.id !== chrome.runtime.id) ||
			!session.flow ||
			message.instanceOrigin !== session.flow.instanceOrigin
		) {
			return;
		}
		queueSourceRefresh({
			instanceOrigin: message.instanceOrigin,
			revision: message.revision,
			clockRevision: message.clockRevision ?? null,
		});
	}

	function scheduleIconRefresh() {
		if (
			closed ||
			isBusy() ||
			!pendingIconRefresh ||
			iconRefreshRunning ||
			iconRefreshTimer !== null ||
			session.flow?.authMode !== 'offline'
		) {
			return;
		}
		iconRefreshTimer = setTimeout(() => {
			iconRefreshTimer = null;
			if (closed || isBusy() || !pendingIconRefresh || session.flow?.authMode !== 'offline') {
				return;
			}
			void refreshCachedIcons();
		}, 50);
	}

	async function refreshCachedIcons() {
		const expectedFlow = session.flow;
		const version = session.version;
		const configurationVersion = iconConfigurationVersion;
		iconRefreshRunning = true;
		pendingIconRefresh = false;
		try {
			// This endpoint reads sanitized image data only; it never syncs accounts
			// or requests codes, so a late favicon cannot replay automatic filling.
			const response = await send({ type: MESSAGE.OFFLINE_ICONS });
			if (
				closed ||
				pendingIconRefresh ||
				version !== session.version ||
				configurationVersion !== iconConfigurationVersion ||
				session.flow?.authMode !== 'offline' ||
				!sameFlowTarget(expectedFlow, session.flow) ||
				response?.instanceOrigin !== expectedFlow.instanceOrigin
			) {
				return;
			}
			const icons = sanitizeServiceIcons(response.serviceIcons, collectServiceDomains(session.flow.accounts));
			session.updateServiceIcons(icons);
			onIcons(icons);
		} catch {
			// Icons are optional. Keep letters and working codes if the cache is
			// cleared, permission is revoked, or the background is restarting.
		} finally {
			iconRefreshRunning = false;
			scheduleIconRefresh();
		}
	}

	function queueIconRefresh() {
		if (!closed && session.flow?.authMode === 'offline') {
			pendingIconRefresh = true;
			scheduleIconRefresh();
		}
	}

	function invalidateIconReads() {
		iconConfigurationVersion += 1;
		pendingIconRefresh = false;
		clearTimeout(iconRefreshTimer);
		iconRefreshTimer = null;
	}

	function onIconsChanged(message, sender) {
		if (
			message?.type !== MESSAGE.ICONS_CHANGED ||
			sender?.tab ||
			(sender?.id && sender.id !== chrome.runtime.id) ||
			!session.flow ||
			message.instanceOrigin !== session.flow.instanceOrigin
		) {
			return;
		}
		queueIconRefresh();
	}

	function onOnline() {
		queueSourceRefresh({ refreshSource: true });
	}

	chrome.storage?.onChanged?.addListener(onSettingsChanged);
	chrome.runtime.onMessage?.addListener(onAccountsChanged);
	chrome.runtime.onMessage?.addListener(onIconsChanged);
	chrome.permissions.onRemoved?.addListener(invalidateIconReads);
	window.addEventListener('online', onOnline);
	void refreshInstanceLink();
	return {
		retranslate() {
			if (!instanceLink.hidden && instanceLink.href) {
				instanceLink.setAttribute('aria-label', t('popupInstanceLink', { origin: instanceLink.title }));
			}
		},
		get configurationVersion() {
			return sourceConfigurationVersion;
		},
		get clockRefreshPending() {
			return clockRefreshPending;
		},
		matchesRendered(nextFlow) {
			return (nextFlow.sourceRevision ?? null) === renderedSourceRevision && nextFlow.sourceClockRevision === renderedClockRevision;
		},
		acceptFlow(nextFlow) {
			renderedSourceRevision = nextFlow.sourceRevision ?? null;
			renderedClockRevision = nextFlow.sourceClockRevision ?? null;
			clockRefreshPending = Boolean(
				pendingSourceRefresh &&
				pendingSourceRefresh.instanceOrigin === nextFlow.instanceOrigin &&
				pendingSourceRefresh.clockRevision !== renderedClockRevision,
			);
		},
		queueRefresh: queueSourceRefresh,
		refreshInBackground: refreshSourceInBackground,
		queueIcons: queueIconRefresh,
		schedule() {
			scheduleSourceRefresh();
			scheduleIconRefresh();
		},
		retry() {
			// Detach the old continuation without cancelling a source request shared
			// with another popup. An explicit retry gets its own automatic opportunity.
			sourceConfigurationVersion += 1;
			backgroundSourceRefresh = null;
			clearTimeout(sourceRefreshTimer);
			sourceRefreshTimer = null;
			pendingSourceRefresh = null;
		},
		dispose() {
			closed = true;
			sourceConfigurationVersion += 1;
			clearTimeout(sourceRefreshTimer);
			invalidateIconReads();
			pendingSourceRefresh = null;
			chrome.runtime.onMessage?.removeListener(onAccountsChanged);
			chrome.runtime.onMessage?.removeListener(onIconsChanged);
			chrome.permissions.onRemoved?.removeListener(invalidateIconReads);
			window.removeEventListener('online', onOnline);
			chrome.storage?.onChanged?.removeListener(onSettingsChanged);
		},
	};
}
