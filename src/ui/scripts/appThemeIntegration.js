/** Integrates the independently testable app host with the existing official shell. */
export function getAppThemeIntegrationCode() {
	return `
    let activeAppThemeHost = null;
    let renderAppThemeStatus = null;
    function isAppThemeSnapshot(value) { return value?.kind === 'app' || value?.manifest?.themeApiVersion === 2; }
    window.computeAppShellConfigId = async appearance => {
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
      const bytes = new TextEncoder().encode(JSON.stringify(canonical({appearance,adminCodeId:window.__2FA_ADMIN_CODE_ID__,safeMode:false})));
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    };
    function initializeAppThemeIntegration() {
      if (activeAppThemeHost || window.__2FA_SAFE_MODE__ || !isAppThemeSnapshot(window.__2FA_APPEARANCE__)) return;
      const runtime = getThemeRuntime();
      const root = document.getElementById('appThemeRoot');
      const status = document.getElementById('appThemeRuntimeStatus');
      if (!root || !status || typeof window.createAppThemeHost !== 'function') return;
      let removedOfficial = false;
      let runningGeneration = 0;
      let attempt = '';
      let controllerGeneration = 0;
      let messageKey = 'appearanceRuntimePreparing';
      let desired = window.__2FA_APPEARANCE__;
      const configurations = new Map([[desired.revision,desired]]);
      const safeReload = async () => {
        const result = await runtime.sdk.lifecycle.requestReload('recovery');
        if (result.status === 'rejected') showCenterToast('⚠️',t('moduleRefreshBlocked'));
      };
      const renderStatus = () => {
        if (status.hidden) return;
        const navigation = status.dataset.mode === 'reload-required';
        status.replaceChildren();
        const message = document.createElement('span'); message.textContent = t(navigation ? 'appearancePublishedReload' : messageKey); status.append(message);
        const retry = document.createElement('button'); retry.type='button'; retry.className='btn btn-secondary'; retry.textContent=t(navigation ? 'restoreRefresh' : 'retry');
        retry.onclick=async()=>{
          if(navigation){const result=await runtime.sdk.lifecycle.requestReload('theme-change');if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));return;}
          if (!runtime.accounts.getState().accessVerified || runtime.accounts.getState().blocked) runtime.sdk.host.open({kind:'login'});
          else if(activeAppThemeHost.getState?.().reason==='no-controller' && (await navigator.serviceWorker?.getRegistration?.())?.active){
            const result=await runtime.sdk.lifecycle.requestReload('theme-change');if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));
          } else void activeAppThemeHost.retry();
        };
        const recovery = document.createElement('button'); recovery.type='button'; recovery.className='btn btn-secondary'; recovery.textContent=t('appearanceSafeMode'); recovery.onclick=()=>void safeReload();
        status.append(retry,recovery);
        // Recovery controls remain host-owned if a theme stops while clipboard is pending.
        for (const operation of runtime.sdk.getSnapshot().host.operations) {
          if (operation.type !== 'hotp' || operation.status !== 'running' || operation.clipboard !== 'pending') continue;
          const line=document.createElement('p');line.textContent=t('coreHotpPendingRecovery');
          const check=document.createElement('button');check.type='button';check.className='btn btn-secondary';check.textContent=t('coreHotpReconcile');
          check.onclick=async()=>{const result=await runtime.sdk.otp.reconcile(operation.operationId);if(result.status!=='committed')showCenterToast('⚠️',t('coreHotpReconcileFailed'));};
          line.append(check);status.append(line);
        }
      };
      renderAppThemeStatus = renderStatus;
      const showStatus = key => {messageKey=key;status.hidden=false;renderStatus();};
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
      activeAppThemeHost = window.createAppThemeHost({
        root, appearance:desired, transport:window.twofaRuntimeTransport,
        getShellConfigId: window.computeAppShellConfigId,
        createSdkScope: options => createAppThemeSdkScope(options),
        getSessionState: () => runtime.accounts.getState(),
        subscribeSession: listener => runtime.accounts.subscribe(listener),
        onState: state => {
          if (state.status === 'mounting' && !removedOfficial) {
            root.hidden=false;root.style.cssText='position:fixed;inset:0;visibility:hidden;pointer-events:none';
          }
          if (['preparing','attaching','importing','mounting'].includes(state.status)) showStatus('appearanceRuntimePreparing');
          if (state.status === 'running' && state.reason) showStatus('appearanceRuntimeUnavailable');
        },
        onRunning: state => {
          const running = ++runningGeneration;
          removeOfficial();root.hidden=false;root.style.cssText='';status.hidden=status.dataset.mode !== 'reload-required';
          const current=configurations.get(state.tuple.appearanceRevision);
          if(current){window.__2FA_APPEARANCE__=current;updateAppearanceBranding(current);}
          void window.computeAppShellConfigId(current || desired).then(id=>{if(running===runningGeneration)window.__2FA_SHELL_CONFIG_ID__=id;});
          notifyThemeRuntimeEnvironment('app-running');
        },
        onFallback: () => {if(!removedOfficial){root.hidden=true;root.style.cssText='';}showStatus('appearanceRuntimeUnavailable');},
        onRecoveryRequired: () => showStatus('appearanceRuntimeRecovery'),
        onError: error => console.error('App theme failed',error)
      });
      window.updateAppThemeAppearance = async next => {
        if (!isAppThemeSnapshot(next) || next.packageId !== desired.packageId) {
          window.dispatchEvent(new CustomEvent('appearance-navigation-required'));return {status:'reload-required'};
        }
        desired=next;configurations.set(next.revision,next);
        attempt=runtime.accounts.getState().sessionGeneration+':'+desired.revision+':'+controllerGeneration;
        return activeAppThemeHost.updateAppearance(next);
      };
      const maybeStart = () => {
        const state=runtime.accounts.getState();
        const key=state.sessionGeneration+':'+desired.revision+':'+controllerGeneration;
        if(state.blocked || !state.accessVerified || attempt===key)return;
        attempt=key;void activeAppThemeHost.start(desired);
      };
      const unsubscribe=runtime.sdk.subscribe(()=>{maybeStart();renderStatus();});
      const changed=()=>{controllerGeneration++;maybeStart();};
      navigator.serviceWorker?.addEventListener('controllerchange',changed);
      window.addEventListener('pageshow',event=>{if(event.persisted){attempt='';maybeStart();}});
      window.addEventListener('pagehide',event=>{
        if(event.persisted)return;
        unsubscribe();navigator.serviceWorker?.removeEventListener('controllerchange',changed);activeAppThemeHost.dispose();
      });
      showStatus('appearanceRuntimePreparing');maybeStart();
    }
    window.addEventListener('appearance-navigation-required',()=>{
      const status=document.getElementById('appThemeRuntimeStatus');if(!status)return;
      status.dataset.mode='reload-required';status.hidden=false;status.replaceChildren();
      if(renderAppThemeStatus){renderAppThemeStatus();return;}
      const message=document.createElement('span');message.textContent=t('appearancePublishedReload');
      const reload=document.createElement('button');reload.type='button';reload.className='btn btn-secondary';reload.textContent=t('restoreRefresh');
      reload.onclick=async()=>{const result=await getThemeRuntime().sdk.lifecycle.requestReload('theme-change');if(result.status==='rejected')showCenterToast('⚠️',t('moduleRefreshBlocked'));};
      status.append(message,reload);
    });
  `;
}
