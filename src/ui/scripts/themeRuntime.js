import { createThemeSdk } from '../runtime/themeSdk.js';
import { createHostFlows } from '../runtime/hostFlows.js';
import { createHostAppearanceManager, normalizeHostAppearance } from '../runtime/hostAppearance.js';
import { serializeBrowserFunction } from './browserSource.js';

/** Host assembly. The official view and app themes share these exact instances. */
export function getThemeRuntimeCode() {
	return `
    let themeRuntimeInstance = null;
    const themeHostAppearanceManager = (${serializeBrowserFunction(createHostAppearanceManager)})({ document, normalize: ${serializeBrowserFunction(normalizeHostAppearance)} });
    const themeEnvironmentListeners = new Set();
    function notifyThemeRuntimeEnvironment(reason) {
      for (const listener of [...themeEnvironmentListeners]) listener(reason);
    }
    function getThemeHostState() {
      const dialogOpen = Boolean(typeof getTopModal === 'function' && getTopModal());
      return {
        ...(typeof getPwaHostState === 'function' ? getPwaHostState() : {}),
        dialogOpen,
        dirty: Boolean((typeof hasUnsavedSettingsChanges === 'function' && hasUnsavedSettingsChanges()) ||
          (typeof window.hasAppearancePendingChanges === 'function' && window.hasAppearancePendingChanges()) || secretDialogOpen),
        saving: Boolean(secretDialogSubmission),
        appearancePublished: Boolean(window.__2FA_APPEARANCE__),
        about: typeof getAppAboutState === 'function' ? getAppAboutState() : null
      };
    }
    function getThemeEnvironmentSnapshot() {
      return {
        connectivity: { onlineHint: navigator.onLine !== false, serverState: accountStore.getState().accessVerified ? 'verified' : 'unknown' },
        clock: { status: trustedClock.status, generation: getTrustedClockGeneration(), correctedNow: getCorrectedNowMs() },
        queue: getOfflineQueueSnapshot(),
        preferences: getThemePublicPreferences(),
        host: getThemeHostState()
      };
    }
    function requestThemeRuntimeReload(reason) {
      const pendingRecovery = reason === 'recovery' && getAccountCommands().canReloadAfterReconcile();
      if ((accountStore.getOperationState().busy && !pendingRecovery) || secretDialogSubmission ||
          window.__2FA_REFRESH_BLOCKED__?.() ||
          (typeof customCodeReloadBlocked === 'function' && customCodeReloadBlocked())) {
        return { status: 'rejected', reason: 'unsaved-or-pending' };
      }
      if (pendingRecovery && !window.confirm(t('coreHotpRecoveryConfirm'))) return { status: 'cancelled' };
      if (reason === 'update') {
        if (typeof requestRuntimeUpdate !== 'function') return { status: 'rejected', reason: 'runtime-update-unavailable' };
        return Promise.resolve(requestRuntimeUpdate()).then(result => {
          if (accountStore.getOperationState().busy || secretDialogSubmission || window.__2FA_REFRESH_BLOCKED__?.() ||
              (typeof customCodeReloadBlocked === 'function' && customCodeReloadBlocked())) {
            return { status: 'rejected', reason: 'unsaved-or-pending' };
          }
          if (result?.status === 'ready' || result?.reason === 'no-waiting-worker') {
            return expectFreshShell().then(() => {
              window.location.reload();
              return { status: 'completed', reason: result?.status === 'ready' ? 'update-requested' : 'reload-requested' };
            });
          }
          return { status: 'rejected', reason: result?.reason || 'runtime-update-blocked' };
        });
      }
      if (reason === 'theme-change') {
        return expectFreshShell().then(() => {
          window.location.reload();
          return { status: 'completed', reason: 'reload-requested' };
        });
      }
      if (reason === 'recovery') {
        const url = new URL(window.location.href);
        url.searchParams.set('safeMode', '1');
        window.location.assign(url.href);
      } else window.location.reload();
      return { status: 'completed', reason: 'reload-requested' };
    }
    // Reloads for an appearance saved elsewhere. A waiting app update is taken in the same reload:
    // only the updated worker waits for the server page instead of serving the stored one.
    async function reloadForSavedAppearance() {
      const waiting = Boolean((await navigator.serviceWorker?.getRegistration?.().catch(() => null))?.waiting);
      let result = await requestThemeRuntimeReload(waiting ? 'update' : 'theme-change');
      if (waiting && result?.status !== 'completed' && result?.reason !== 'unsaved-or-pending') {
        result = await requestThemeRuntimeReload('theme-change');
      }
      return result;
    }
    window.reloadForSavedAppearance = reloadForSavedAppearance;
    // The stored page still shows the previous appearance; on a slow network the worker would
    // otherwise serve it after its short deadline, so the reload looks like nothing changed.
    function expectFreshShell() {
      const worker = navigator.serviceWorker?.controller;
      if (!worker || typeof MessageChannel !== 'function') return Promise.resolve();
      return new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(resolve, 1000);
        channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
        try { worker.postMessage({ type: 'EXPECT_FRESH_SHELL' }, [channel.port2]); } catch { clearTimeout(timer); resolve(); }
      });
    }
    function createThemeSdkScope(options = {}) {
      const accounts = accountStore;
      const otp = getOtpEngine();
      const commands = getAccountCommands();
      const view = getAccountViewState();
      const hostFlows = (${serializeBrowserFunction(createHostFlows)})({
        handlers: getThemeHostHandlers(),
        validateAccount: ref => Boolean(accounts.getRecord(ref.id)) && accounts.getAccountGeneration(ref.id) === ref.generation,
        getSessionGeneration: () => accounts.getSessionGeneration(),
        getSessionState: () => accounts.getState(),
        getBlockedReason: request => {
          if (accounts.getState().blocked && !['login', 'recovery', 'quick-otp', 'pwa-install'].includes(request.kind)) return 'authentication-required';
          if (request.kind === 'pwa-install' && !getPwaHostState().installAvailable) return 'unavailable';
          return null;
        },
        getActiveElement: () => document.activeElement,
        restoreFocus: element => { if (typeof focusThemeHostControl === 'function') focusThemeHostControl(element); }
      });
      const runtime = (${serializeBrowserFunction(createThemeSdk)})({
        identity: options.identity || { hostBuild: window.__2FA_BUILD_ID__ || '', packageId: null, appearanceRevision: window.__2FA_APPEARANCE__?.revision ?? 0 },
        isMountCurrent: options.isCurrent,
        accounts, otp, commands, view, hostFlows, hostAppearance: options.hostAppearance,
        environment: {
          getSnapshot: getThemeEnvironmentSnapshot, getClockNow: getCorrectedNowMs,
          subscribe: listener => { themeEnvironmentListeners.add(listener); return () => themeEnvironmentListeners.delete(listener); },
          setPreferences: patch => setThemePublicPreferences(patch), requestReload: requestThemeRuntimeReload
        },
        translate: (...args) => t(...args), getServiceLogo,
        finishTransitionForCopy: (...args) => otpPresentation.finishTransitionForCopy(...args),
        onError: error => console.error('Theme runtime listener failed', error)
      });
      return Object.freeze({ ...runtime, accounts, otp, commands, view, hostFlows });
    }
    function createAppThemeSdkScope(options = {}) {
      getThemeRuntime();
      const hostAppearance = themeHostAppearanceManager.createScope({isCurrent:options.isCurrent});
      const scope = createThemeSdkScope({...options,hostAppearance});
      return Object.freeze({...scope,activateHostAppearance:()=>hostAppearance.activate()});
    }
    window.requestAppearanceRuntimeReload = reason => getThemeRuntime().sdk.lifecycle.requestReload(reason);
    function getThemeRuntime() {
      if (themeRuntimeInstance) return themeRuntimeInstance;
      const runtime = createThemeSdkScope();
      const { accounts, otp, commands, view, hostFlows } = runtime;
      // Demand comes from the account model, never from legacy account elements.
      let demandKey = null;
      const updateDemand = () => {
        const ids = accounts.getRecords().map(account => String(account.id));
        const key = JSON.stringify(ids);
        if (key === demandKey) return;
        demandKey = key;
        otp.setActiveIds(ids);
        if (document.hidden) otp.suspend();
        else otp.resume('accounts');
      };
      const unsubscribeDemand = accounts.subscribe(updateDemand);
      const environmentEvent = () => notifyThemeRuntimeEnvironment('host');
      const hostInputEvent = event => {
        // Theme controls commit through the SDK. Publishing their preceding
        // input event would redraw an old snapshot before native change runs.
        if (document.getElementById('appThemeRoot')?.contains(event.target)) return;
        environmentEvent();
      };
      ['online', 'offline', 'appearance-applied'].forEach(type => window.addEventListener(type, environmentEvent));
      document.addEventListener('input', hostInputEvent);
      let observer = null;
      if (typeof MutationObserver === 'function' && document.body) {
        // Watch host dialogs, not OTP animation attributes or theme DOM.
        observer = new MutationObserver(records => {
          if (records.some(record => record.target.classList?.contains('modal'))) environmentEvent();
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      themeRuntimeInstance = Object.freeze({ ...runtime, accounts, otp, view, hostFlows,
        dispose() {
          unsubscribeDemand(); observer?.disconnect();
          ['online', 'offline', 'appearance-applied'].forEach(type => window.removeEventListener(type, environmentEvent));
          document.removeEventListener('input', hostInputEvent);
          runtime.dispose();
        }
      });
      updateDemand();
      return themeRuntimeInstance;
    }
    let themeApplicationStarted = false;
    function initializeThemeApplication() {
      if (themeApplicationStarted) return;
      themeApplicationStarted = true;
      initModalDismissal();
      initLanguage();
      applyTranslations();
      restoreSortPreference();
      restoreGroupSortPreference();
      restoreViewModePreference();
      initializeTrustedClock();
      getThemeRuntime();
      if (document.getElementById('secretsList')) getOfficialAccountView();
      if (checkAuth()) void loadSecrets();
      initTheme();
      initCustomCodeAutoReload();
      initSortDropdownOutsideClose();
      if (document.getElementById('mainActionBtn')) initFABDrag();
      if (typeof initializeAppThemeIntegration === 'function') initializeAppThemeIntegration();
    }
    document.addEventListener('DOMContentLoaded', initializeThemeApplication);
    // beforeunload can be cancelled by an unsaved form. Only a committed
    // navigation destroys the runtime; BFCache keeps its subscriptions alive.
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      if (typeof officialAccountView !== 'undefined') officialAccountView?.dispose();
      themeRuntimeInstance?.dispose();
    });
  `;
}
