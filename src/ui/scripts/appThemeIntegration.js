import { getPublicAppearanceClientCode } from '../publicAppearance.js';

/** Integrates the independently testable app host with the existing official shell. */
export function getAppThemeIntegrationCode() {
	return `${getPublicAppearanceClientCode()}
    let activeAppThemeHost = null;
    let renderAppThemeStatus = null;
    function isAppThemeSnapshot(value) { return value?.kind === 'app' || value?.manifest?.themeApiVersion === 2; }
    async function requestAppThemeRecovery(event) {
      event?.preventDefault();
      const result = await getThemeRuntime().sdk.lifecycle.requestReload('recovery');
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
    function initializeAppThemeIntegration() {
      if (activeAppThemeHost) return;
      const presentation = document.documentElement;
      const restoreOfficialPresentation = () => {
        const focused=focusedAppThemeStartupControl();
        presentation.removeAttribute('data-app-theme-startup');
        transferAppThemeStartupFocus(focused,document.getElementById('searchInput') || document.getElementById('mainActionBtn'));
      };
      if (window.__2FA_SAFE_MODE__ || !isAppThemeSnapshot(window.__2FA_APPEARANCE__)) {
        restoreOfficialPresentation();return;
      }
      const root = document.getElementById('appThemeRoot');
      const status = document.getElementById('appThemeRuntimeStatus');
      if (!root || !status || typeof window.createAppThemeHost !== 'function') {
        restoreOfficialPresentation();return;
      }
      let runtime;
      try {runtime=getThemeRuntime();} catch(error) {
        restoreOfficialPresentation();console.error('Theme runtime unavailable',error);return;
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
        // Keeping the official model/DOM for pre-entry recovery does not require
        // painting it while a privately permitted theme is being prepared.
        if(!removedOfficial && (entryStarted || !['official-fallback','access-unavailable'].includes(currentPhase))) {
          presentation.setAttribute('data-app-theme-startup','managed');
        } else presentation.removeAttribute('data-app-theme-startup');
        const displayReason = currentPhase==='access-unavailable' ? session.library.errorKey || 'access-unavailable' : reason;
        const failed = ['access-unavailable','official-fallback','recovery-required'].includes(currentPhase) || (currentPhase === 'running' && Boolean(reason));
        const loading = ['checking-access','preparing','attaching','importing','mounting'].includes(currentPhase);
        const messageKey = navigation ? 'appearancePublishedReload' : {
          'checking-access':'appearanceRuntimeCheckingAccess','login-required':'appearanceRuntimeLoginRequired',
          'access-unavailable':'coreConnectionFailed',
          preparing:'appearanceRuntimePreparing',attaching:'appearanceRuntimeAttaching',
          importing:'appearanceRuntimeLoading',mounting:'appearanceRuntimeMounting',
          'official-fallback':'appearanceRuntimeUnavailable','recovery-required':'appearanceRuntimeRecovery',
          running:'appearanceRuntimeUnavailable'
        }[currentPhase] || 'appearanceRuntimePreparing';
        // The first running notification precedes onRunning revealing the root.
        // Keep the status focusable until that confirmed handoff is complete.
        status.hidden = removedOfficial && !navigation && currentPhase === 'running' && !reason;
        status.dataset.phase = navigation ? 'reload-required' : currentPhase;
        status.dataset.reason = displayReason || '';
        status.setAttribute('aria-busy',String(!navigation && loading));
        if (status.hidden) {
          if(statusFocused){
            if(!root.hasAttribute('tabindex'))root.tabIndex=-1;
            transferAppThemeStartupFocus(statusFocused,root);
          }
          return;
        }
        const pending = runtime.sdk.getSnapshot().host.operations.filter(operation =>
          operation.type === 'hotp' && operation.status === 'running' && operation.clipboard === 'pending');
        const signature = JSON.stringify([navigation,currentPhase,displayReason,retryBusy,document.documentElement.lang,t(messageKey),
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
          const result=await runtime.sdk.lifecycle.requestReload('theme-change');if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));
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
            if(activeAppThemeHost.getState?.().reason==='no-controller' && (await navigator.serviceWorker?.getRegistration?.())?.active){
              const result=await runtime.sdk.lifecycle.requestReload('theme-change');
              if(result.status!=='completed'&&ownsRetry()){showStatus(previous.phase,previous.reason);if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));}
            } else await activeAppThemeHost.retry();
          } catch(error){if(ownsRetry())showStatus('official-fallback',error?.message || 'theme-retry-failed');}
          finally{retryBusy=false;renderStatus();}
        });retry.disabled=retryBusy;}
        action('recovery','appearanceUseDefault',()=>void requestAppThemeRecovery());
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
      const showStatus = (nextPhase,nextReason=null) => {phase=nextPhase;reason=nextReason;renderStatus();};
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
        onFallback: state => {if(!acceptState(state))return;if(!removedOfficial){root.hidden=true;root.style.cssText='';}showStatus('official-fallback',state?.reason);},
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
      window.addEventListener('pageshow',event=>{if(event.persisted){attempt='';maybeStart();}});
      window.addEventListener('pagehide',event=>{
        if(event.persisted)return;
        integrationActive=false;
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
      reload.onclick=async()=>{const result=await getThemeRuntime().sdk.lifecycle.requestReload('theme-change');if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));};
      status.append(message,reload);
    });
  `;
}
