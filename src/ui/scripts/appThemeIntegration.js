import { getPublicAppearanceClientCode } from '../publicAppearance.js';

/** Integrates the independently testable app host with the existing official shell. */
export function getAppThemeIntegrationCode() {
	return `${getPublicAppearanceClientCode()}
    let activeAppThemeHost = null;
    let renderAppThemeStatus = null;
    function isAppThemeSnapshot(value) { return value?.kind === 'app' || value?.manifest?.themeApiVersion === 2; }
    async function requestAppThemeRecovery(event) {
      let runtime = typeof themeRuntimeInstance !== 'undefined' ? themeRuntimeInstance : null;
      if (!runtime) {
        try { runtime = getThemeRuntime(); } catch {
          let blocked = true;
          try {
            blocked = Boolean((typeof themeRuntimeInstance !== 'undefined' && themeRuntimeInstance) ||
              (typeof accountStore !== 'undefined' && accountStore.getOperationState().busy) ||
              (typeof secretDialogSubmission !== 'undefined' && secretDialogSubmission) ||
              window.__2FA_REFRESH_BLOCKED__?.() ||
              (typeof customCodeReloadBlocked === 'function' && customCodeReloadBlocked()));
          } catch { /* An unreadable guard cannot authorize navigation. */ }
          if (blocked) {
            event?.preventDefault();
            if (typeof showCenterToast === 'function') showCenterToast('⚠️',t('moduleRefreshBlocked'));
            return;
          }
          // Before a shared SDK exists, retain the real safe link's native
          // navigation. Once one exists, all recovery stays on its lifecycle.
          if (event?.currentTarget?.tagName === 'A') return;
          event?.preventDefault();
          window.location.assign('/?safeMode=1');
          return;
        }
      }
      event?.preventDefault();
      const result = await runtime.sdk.lifecycle.requestReload('recovery');
      if (result.status === 'rejected') showCenterToast('⚠️',t('moduleRefreshBlocked'));
    }
    // Before core execution this is a real recovery link. Once core owns any
    // forms/operations, even this initial link must use the shared write guard.
    document.getElementById('appThemeStartupRecovery')?.addEventListener('click', requestAppThemeRecovery);
    function focusedAppThemeStartupControl() {
      const focused=document.activeElement;
      return document.getElementById('appThemeStartup')?.contains(focused) ? focused : null;
    }
    function transferAppThemeStartupFocus(previous,target) {
      const focused=document.activeElement;
      if(!previous || !target?.isConnected || target.disabled || target.closest('[hidden],[inert]') ||
        (focused!==previous && focused!==document.body && focused!==document.documentElement) ||
        (typeof getTopModal==='function' && getTopModal()))return;
      const style=getComputedStyle(target);
      if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse')return;
      target.focus({preventScroll:true});
    }
    window.computeAppShellConfigId = async appearance => {
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
      const bytes = new TextEncoder().encode(JSON.stringify(canonical({appearance,adminCodeId:window.__2FA_ADMIN_CODE_ID__,safeMode:false})));
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    };
    // Each app theme keeps its pages under its own #/theme/<name>/ route, which no other
    // theme reads. A theme change reloads the page with the previous theme's route still in
    // the address bar, so this tab remembers which theme the route belongs to and drops it
    // once another theme (or the default view) loads. Safe mode leaves both untouched.
    function forgetPreviousThemeRoute() {
      if (window.__2FA_SAFE_MODE__) return;
      const appearance = window.__2FA_APPEARANCE__;
      const owner = isAppThemeSnapshot(appearance) ? 'app:' + String(appearance.manifest?.id || '') : 'official';
      let previous = null;
      try {
        previous = sessionStorage.getItem('2fa-theme-route-owner');
        sessionStorage.setItem('2fa-theme-route-owner', owner);
      } catch { return; }
      if (previous && previous !== owner && location.hash.startsWith('#/theme/')) {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
    }
    function initializeAppThemeIntegration() {
      if (activeAppThemeHost) return;
      forgetPreviousThemeRoute();
      const presentation = document.documentElement;
      let runtime;
      const renderOfficialPresentation = () => {
        // The shared SDK is already alive when this adapter exists. Do not
        // recreate a failed runtime just to repaint a fallback shell.
        if (typeof officialAccountView !== 'undefined' && officialAccountView) officialAccountView.render();
        else if (runtime && typeof getOfficialAccountView === 'function') getOfficialAccountView().render(runtime.sdk.getSnapshot());
      };
      const restoreOfficialPresentation = (focusTarget = null) => {
        const focused=focusedAppThemeStartupControl();
        const wasHidden=presentation.hasAttribute('data-app-theme-startup');
        presentation.removeAttribute('data-app-theme-startup');
        window.__2FA_APP_STARTUP_PRESENTATION__?.stop();
        if (wasHidden) renderOfficialPresentation();
        transferAppThemeStartupFocus(focused,focusTarget || document.getElementById('searchInput') || document.getElementById('mainActionBtn'));
      };
      if (window.__2FA_SAFE_MODE__ || !isAppThemeSnapshot(window.__2FA_APPEARANCE__)) {
        restoreOfficialPresentation();return;
      }
      const root = document.getElementById('appThemeRoot');
      const status = document.getElementById('appThemeRuntimeStatus');
      if (!root || !status || typeof window.createAppThemeHost !== 'function') {
        restoreOfficialPresentation();return;
      }
      try {runtime=getThemeRuntime();} catch(error) {
        status.hidden=false;status.dataset.phase='official-fallback';status.dataset.reason='runtime-unavailable';
        status.dataset.quiet='false';status.setAttribute('aria-busy','false');status.replaceChildren();
        const message=document.createElement('span');message.className='app-theme-status-message';message.textContent=t('appearanceRuntimeUnavailable');
        const recovery=document.createElement('a');recovery.className='btn btn-secondary';recovery.href='/?safeMode=1';
        recovery.dataset.runtimeAction='recovery';recovery.textContent=t('appearanceUseDefault');
        recovery.addEventListener('click',requestAppThemeRecovery);status.append(message,recovery);
        restoreOfficialPresentation(recovery);console.error('Theme runtime unavailable',error);return;
      }
      let removedOfficial = false;
      let entryStarted = false;
      let integrationActive = true;
      let hostGeneration = -1;
      let runningGeneration = 0;
      let attempt = '';
      let controllerGeneration = 0;
      let phase = 'checking-access';
      let reason = null;
      let retryBusy = false;
      let renderedSignature = '';
      let desired = window.__2FA_APPEARANCE__;
      const configurations = new Map([[desired.revision,desired]]);
      const acceptState = state => {
        if(!integrationActive)return false;
        if(Number.isSafeInteger(state?.generation)){
          if(state.generation<hostGeneration)return false;
          hostGeneration=state.generation;
        }
        if(state?.entryStarted || ['importing','mounting','running','blocked-after-load-start','commands-suspended','recovery-required'].includes(state?.status))entryStarted=true;
        return true;
      };
      const displayedPhase = () => {
        const session=runtime.accounts.getState();
        if(session.blocked)return 'login-required';
        if(!session.accessVerified){
          if(entryStarted)return 'recovery-required';
          if(retryBusy && phase==='checking-access')return 'checking-access';
          return session.library.refreshState==='error' ? 'access-unavailable' : 'checking-access';
        }
        if(entryStarted && phase==='official-fallback')return 'recovery-required';
        return phase;
      };
      const renderStatus = () => {
        if(!integrationActive)return;
        const startupFocused=focusedAppThemeStartupControl();
        const statusFocused=!status.hidden && status.contains(document.activeElement) ? document.activeElement : null;
        const navigation = status.dataset.mode === 'reload-required';
        const session = runtime.accounts.getState();
        const currentPhase = displayedPhase();
        const pending = runtime.sdk.getSnapshot().host.operations.filter(operation =>
          operation.type === 'hotp' && operation.status === 'running' && operation.clipboard === 'pending');
        const loading = ['checking-access','preparing','attaching','importing','mounting'].includes(currentPhase);
        const quiet = !removedOfficial && loading && !navigation && !pending.length;
        const hadStartup = presentation.hasAttribute('data-app-theme-startup');
        // Keeping the official model/DOM for pre-entry recovery does not require
        // painting it while a privately permitted theme is being prepared.
        if(!removedOfficial && (entryStarted || !['official-fallback','access-unavailable'].includes(currentPhase))) {
          presentation.setAttribute('data-app-theme-startup','managed');
        } else presentation.removeAttribute('data-app-theme-startup');
        if (quiet) window.__2FA_APP_STARTUP_PRESENTATION__?.resume();
        else window.__2FA_APP_STARTUP_PRESENTATION__?.stop();
        if (hadStartup && !presentation.hasAttribute('data-app-theme-startup') && !removedOfficial) renderOfficialPresentation();
        const slow = !window.__2FA_APP_STARTUP_PRESENTATION__ || Boolean(window.__2FA_APP_STARTUP_PRESENTATION__.slow);
        const displayReason = currentPhase==='access-unavailable' ? session.library.errorKey || 'access-unavailable' : reason;
        const failed = ['access-unavailable','official-fallback','recovery-required'].includes(currentPhase) || (currentPhase === 'running' && Boolean(reason));
        const messageKey = navigation ? 'appearancePublishedReload' : pending.length ? 'coreHotpPendingRecovery' : loading ? 'loading' :
          currentPhase==='official-fallback' && reason==='other-pages-open' ? 'appearanceRuntimeOtherPages' : {
          'login-required':'appearanceRuntimeLoginRequired',
          'access-unavailable':'coreConnectionFailed',
          'official-fallback':'appearanceRuntimeUnavailable','recovery-required':'appearanceRuntimeRecovery',
          running:'appearanceRuntimeUnavailable'
        }[currentPhase] || 'loading';
        // The first running notification precedes onRunning revealing the root.
        // Keep the status focusable until that confirmed handoff is complete.
        status.hidden = removedOfficial && !navigation && currentPhase === 'running' && !reason && !pending.length;
        status.dataset.phase = navigation ? 'reload-required' : currentPhase;
        status.dataset.reason = displayReason || '';
        status.dataset.quiet = String(quiet);
        // Like the startup screen, a quiet start shows its indicator only a second after the page began.
        if (quiet && !status.style.getPropertyValue('--app-theme-loading-delay')) {
          const startedAt = window.__2FA_APP_STARTUP_PRESENTATION__?.startedAt ?? Date.now();
          status.style.setProperty('--app-theme-loading-delay', Math.max(0, 1000 - (Date.now() - startedAt)) + 'ms');
        }
        status.dataset.slow = String(slow);
        status.setAttribute('aria-busy',String(!navigation && loading));
        if (status.hidden) {
          if(statusFocused){
            if(!root.hasAttribute('tabindex'))root.tabIndex=-1;
            transferAppThemeStartupFocus(statusFocused,root);
          }
          return;
        }
        const showRecovery = !quiet || slow || Boolean(startupFocused || statusFocused);
        const signature = JSON.stringify([navigation,loading?'loading':currentPhase,quiet,slow,showRecovery,displayReason,retryBusy,document.documentElement.lang,t(messageKey),
          pending.map(operation => [operation.operationId,operation.reservation,operation.clipboard,operation.reconciliation,operation.status,
            operation.localCommit,operation.counterAdvanced,operation.reason,operation.recovery])]);
        if (signature === renderedSignature) {
          transferAppThemeStartupFocus(startupFocused,status.querySelector('[data-runtime-action="recovery"]'));return;
        }
        renderedSignature = signature;
        const focused = status.contains(document.activeElement) ? document.activeElement?.dataset.runtimeAction : null;
        status.replaceChildren();
        const message = document.createElement('span'); message.className='app-theme-status-message';message.textContent=t(messageKey);status.append(message);
        const actions=document.createElement('div');actions.className='app-theme-status-actions';status.append(actions);
        const action=(key,label,run)=>{
          const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.dataset.runtimeAction=key;button.textContent=t(label);button.onclick=run;
          actions.append(button);return button;
        };
        if(navigation) action('reload','restoreRefresh',async()=>{
          const result=await reloadForSavedAppearance();if(result?.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));
        });
        else if(currentPhase==='login-required') action('login','loginSubmitBtn',()=>runtime.sdk.host.open({kind:'login'}));
        else if(failed){const retry=action('retry','retry',async event=>{
          const startPhase=displayedPhase();
          if(retryBusy || !(['access-unavailable','official-fallback','recovery-required'].includes(startPhase) || (startPhase==='running' && reason)))return;
          const previous={phase,reason};retryBusy=true;event.currentTarget.disabled=true;showStatus(startPhase==='access-unavailable'?'checking-access':'preparing');
          const retryGeneration=hostGeneration,retrySession=runtime.accounts.getState().sessionGeneration,retryRunning=runningGeneration;
          const ownsRetry=()=>integrationActive&&hostGeneration===retryGeneration&&runningGeneration===retryRunning&&runtime.accounts.getState().sessionGeneration===retrySession;
          try {
            const session=runtime.accounts.getState();
            if(session.blocked){runtime.sdk.host.open({kind:'login'});return;}
            if(!session.accessVerified){if(startPhase==='access-unavailable')await runtime.sdk.accounts.refresh();return;}
            let update=null;
            if(activeAppThemeHost.getState?.().reason==='no-controller' && (await navigator.serviceWorker?.getRegistration?.())?.active){
              const result=await runtime.sdk.lifecycle.requestReload('theme-change');
              if(result.status!=='completed'&&ownsRetry()){showStatus(previous.phase,previous.reason);if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));}
            } else if(previous.phase==='official-fallback' && ['worker-timeout','other-pages-open'].includes(previous.reason) && (update=await replaceLegacyWorker(false))){
              if(update.status!=='completed'&&ownsRetry()){
                showStatus('official-fallback',update.reason==='other-pages-open'?update.reason:previous.reason);
                if(update.reason==='unsaved-or-pending')showCenterToast('⚠️',t('moduleRefreshBlocked'));
              }
            } else await activeAppThemeHost.retry();
          } catch(error){if(ownsRetry())showStatus('official-fallback',error?.message || 'theme-retry-failed');}
          finally{retryBusy=false;renderStatus();}
        });retry.disabled=retryBusy;}
        const recovery = action('recovery','appearanceUseDefault',()=>void requestAppThemeRecovery());
        recovery.hidden = !showRecovery;
        // Recovery controls remain host-owned if a theme stops while clipboard is pending.
        for (const operation of pending) {
          const line=document.createElement('p');line.className='app-theme-status-recovery';line.textContent=t('coreHotpPendingRecovery');
          const check=document.createElement('button');check.type='button';check.className='btn btn-secondary';check.dataset.runtimeAction='reconcile:'+operation.operationId;check.textContent=t('coreHotpReconcile');
          check.onclick=async()=>{const result=await runtime.sdk.otp.reconcile(operation.operationId);if(result.status!=='committed')showCenterToast('⚠️',t('coreHotpReconcileFailed'));};
          line.append(check);status.append(line);
        }
        if(focused){
          const replacement=[...status.querySelectorAll('[data-runtime-action]')].find(button=>button.dataset.runtimeAction===focused);
          (replacement || status.querySelector('[data-runtime-action="recovery"]') || status).focus({preventScroll:true});
        }
        transferAppThemeStartupFocus(startupFocused,status.querySelector('[data-runtime-action="recovery"]'));
      };
      renderAppThemeStatus = renderStatus;
      window.addEventListener('app-theme-startup-slow',renderStatus);
      const showStatus = (nextPhase,nextReason=null) => {phase=nextPhase;reason=nextReason;renderStatus();};
      // At most once per 30 seconds, so a worker that never takes control ends in the usual fallback.
      const reloadUncontrolledPage = async () => {
        const key='2fa-app-theme-uncontrolled-reload';
        try {
          if(navigator.serviceWorker?.controller || Date.now()-(Number(sessionStorage.getItem(key))||0)<30000)return false;
          if(!(await navigator.serviceWorker?.getRegistration?.())?.active || !integrationActive)return false;
          sessionStorage.setItem(key,String(Date.now()));
          return (await runtime.sdk.lifecycle.requestReload('theme-change')).status==='completed';
        } catch {return false;}
      };
      // A worker from before 2.0 never answers the theme runtime. The waiting update replaces it at
      // once while this is the only 2FA page; otherwise the other pages have to be closed first.
      // Done by itself at most once per 30 seconds after it reloaded the page; Retry always asks.
      const replaceLegacyWorker = async automatic => {
        const key='2fa-app-theme-worker-update';
        try {
          if(automatic && Date.now()-(Number(sessionStorage.getItem(key))||0)<30000)return null;
          if(!(await navigator.serviceWorker?.getRegistration?.())?.waiting || !integrationActive)return null;
          if(automatic)sessionStorage.setItem(key,String(Date.now()));
          const result=await runtime.sdk.lifecycle.requestReload('update');
          if(automatic && result?.status!=='completed')sessionStorage.removeItem(key);
          return result;
        } catch {return null;}
      };
      const removeOfficial = () => {
        if (removedOfficial) return;
        removedOfficial = true;
        if (typeof officialAccountView !== 'undefined') {officialAccountView?.dispose();officialAccountView=null;}
        if (typeof closeActionMenu === 'function') closeActionMenu();
        if (typeof disposeFABDrag === 'function') {disposeFABDrag();disposeFABDrag=null;}
        const panels=document.getElementById('hostThemePanels');
        for (const id of ['offlineQueue','hiddenSecrets']) {const panel=document.getElementById(id);if(panel?.closest('#officialThemeRoot'))panels.append(panel);}
        for (const id of ['officialThemeRoot','officialThemeActions','officialThemeFooter']) document.getElementById(id)?.remove();
        document.body.classList.add('app-theme-running');
        // The official footer carried the new-version badge; the host notice takes over.
        if (typeof renderReleaseNotice === 'function') renderReleaseNotice();
      };
      try { activeAppThemeHost = window.createAppThemeHost({
        root, appearance:desired, transport:window.twofaRuntimeTransport,
        getShellConfigId: window.computeAppShellConfigId,
        createSdkScope: options => createAppThemeSdkScope(options),
        getSessionState: () => runtime.accounts.getState(),
        subscribeSession: listener => runtime.accounts.subscribe(listener),
        onState: state => {
          if(!acceptState(state))return;
          if (state.status === 'mounting' && !removedOfficial) {
            root.hidden=false;root.style.cssText='position:fixed;inset:0;visibility:hidden;pointer-events:none';
          }
          if (['preparing','attaching','importing','mounting','running'].includes(state.status)) showStatus(state.status,state.reason);
        },
        onRunning: state => {
          if(state.tuple.packageId!==desired.packageId || state.tuple.appearanceRevision!==desired.revision)return;
          if(!acceptState({...state,status:'running'}))return;
          const running = ++runningGeneration;
          removeOfficial();root.hidden=false;root.style.cssText='';
          phase='running';if(Object.hasOwn(state,'reason'))reason=state.reason;renderStatus();
          const current=configurations.get(state.tuple.appearanceRevision);
          if(current && current.packageId===state.tuple.packageId){window.__2FA_APPEARANCE__=current;updateAppearanceBranding(current);window.updatePublicAppearanceBaseline(current);}
          void window.computeAppShellConfigId(current || desired).then(id=>{if(running===runningGeneration)window.__2FA_SHELL_CONFIG_ID__=id;});
          notifyThemeRuntimeEnvironment('app-running');
        },
        onFallback: state => {
          if(!acceptState(state))return;if(!removedOfficial){root.hidden=true;root.style.cssText='';}
          if(state?.reason==='worker-timeout'){
            // Keep the loading view while a waiting update may replace a worker from before 2.0.
            const generation=hostGeneration;
            void replaceLegacyWorker(true).then(result=>{
              if(result?.status!=='completed'&&integrationActive&&hostGeneration===generation)
                showStatus('official-fallback',result?.reason==='other-pages-open'?result.reason:state.reason);
            });
            return;
          }
          if(state?.reason!=='no-controller'){showStatus('official-fallback',state?.reason);return;}
          // A hard reload (Ctrl+F5) bypasses the active worker, and a theme runs only in a page it
          // controls. Reload normally once, keeping the loading view, instead of asking for Retry.
          const generation=hostGeneration;
          void reloadUncontrolledPage().then(reloading=>{
            if(!reloading&&integrationActive&&hostGeneration===generation)showStatus('official-fallback',state.reason);
          });
        },
        onRecoveryRequired: state => {if(acceptState({...state,status:'recovery-required'}))showStatus('recovery-required',state?.reason);},
        onError: error => console.error('App theme failed',error)
      }); } catch(error) {showStatus('official-fallback','runtime-unavailable');console.error('App theme unavailable',error);return;}
      window.updateAppThemeAppearance = async next => {
        if (!isAppThemeSnapshot(next) || next.packageId !== desired.packageId) {
          window.dispatchEvent(new CustomEvent('appearance-navigation-required'));return {status:'reload-required'};
        }
        desired=next;configurations.set(next.revision,next);
        attempt=runtime.accounts.getState().sessionGeneration+':'+desired.revision+':'+controllerGeneration;
        return activeAppThemeHost.updateAppearance(next);
      };
      const maybeStart = () => {
        if(!integrationActive)return;
        const state=runtime.accounts.getState();
        const key=state.sessionGeneration+':'+desired.revision+':'+controllerGeneration;
        if(state.blocked || !state.accessVerified || attempt===key)return;
        attempt=key;showStatus('preparing');void activeAppThemeHost.start(desired);
      };
      const unsubscribe=runtime.sdk.subscribe(()=>{maybeStart();renderStatus();});
      const changed=()=>{controllerGeneration++;maybeStart();};
      navigator.serviceWorker?.addEventListener('controllerchange',changed);
      window.addEventListener('pageshow',event=>{if(event.persisted){attempt='';maybeStart();renderStatus();}});
      window.addEventListener('pagehide',event=>{
        window.__2FA_APP_STARTUP_PRESENTATION__?.stop();
        if(event.persisted)return;
        integrationActive=false;
        window.removeEventListener('app-theme-startup-slow',renderStatus);
        unsubscribe();navigator.serviceWorker?.removeEventListener('controllerchange',changed);activeAppThemeHost.dispose();
      });
      renderStatus();maybeStart();
    }
    window.addEventListener('appearance-navigation-required',()=>{
      const status=document.getElementById('appThemeRuntimeStatus');if(!status)return;
      status.dataset.mode='reload-required';status.dataset.phase='reload-required';status.hidden=false;
      if(renderAppThemeStatus){renderAppThemeStatus();return;}
      status.replaceChildren();
      const message=document.createElement('span');message.textContent=t('appearancePublishedReload');
      const reload=document.createElement('button');reload.type='button';reload.className='btn btn-secondary';reload.textContent=t('restoreRefresh');
      reload.onclick=async()=>{const result=await reloadForSavedAppearance();if(result?.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));};
      status.append(message,reload);
    });
  `;
}
