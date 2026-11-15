import { createRuntimeTransport } from '../runtime/runtimeTransport.js';
import { serializeBrowserFunction } from './browserSource.js';
/**
 * PWA (Progressive Web App) 功能模块
 * Service Worker 注册、PWA 检测、安装提示
 */

/**
 * 获取 PWA 相关代码
 * @returns {string} PWA JavaScript 代码
 */
export function getPWACode() {
	return `// ==================== PWA Service Worker 注册 ====================
    window.twofaRuntimeTransport = (${serializeBrowserFunction(createRuntimeTransport)})({
      window,navigator,
      isReloadBlocked: () => Boolean((typeof accountStore !== 'undefined' && accountStore.getOperationState().busy) ||
        (typeof secretDialogSubmission !== 'undefined' && secretDialogSubmission) || window.__2FA_REFRESH_BLOCKED__?.() ||
        (typeof customCodeReloadBlocked === 'function' && customCodeReloadBlocked()))
    });
    function getCurrentRuntimeTuple(mode = null, appearance = window.__2FA_APPEARANCE__) {
      const safe = new URLSearchParams(window.location.search).get('safeMode') === '1' || new URLSearchParams(window.location.search).get('disableCustomCode') === '1';
      const selectedMode = mode || (safe ? 'safe' : appearance?.kind === 'app' || appearance?.manifest?.themeApiVersion === 2 ? 'app' : 'official');
      return {hostBuild:window.__2FA_BUILD_ID__ || '',sdkApiVersion:1,packageId:selectedMode==='app'?appearance.packageId:null,
        appearanceRevision:selectedMode==='safe'?0:appearance?.revision || 0,mode:selectedMode};
    }
    // Downloads and checks everything a just-saved appearance needs before the page reloads into it.
    // A complete preparation becomes the stored page, so even a reload on a slow network opens it.
    // Null without a worker: nothing can be prepared, and the switch goes ahead as before.
    window.prepareAppearanceRuntime = async appearance => {
      if (!navigator.serviceWorker?.controller || typeof window.computeAppShellConfigId !== 'function' ||
          !/^[a-f0-9]{64}$/.test(window.__2FA_BUILD_ID__ || '')) return null;
      // A worker from before 2.0 never answers. The waiting update replaces it on the reload and prepares the theme itself.
      const registration = await navigator.serviceWorker.getRegistration?.().catch(() => null);
      if (registration?.waiting && !(await window.twofaRuntimeTransport.controllerAnswers())) return {status:'blocked',reason:'legacy-worker'};
      const expectedShellConfigId = await window.computeAppShellConfigId(appearance);
      return window.twofaRuntimeTransport.prepare(getCurrentRuntimeTuple(null, appearance), {expectedShellConfigId});
    };
    async function requestRuntimeUpdate() {
      return window.twofaRuntimeTransport.requestUpdate();
    }
    let recoveryPreparation = null;
    async function preparePublicRecovery() {
      if (!navigator.serviceWorker?.controller || !/^[a-f0-9]{64}$/.test(window.__2FA_BUILD_ID__ || '') || !/^[a-f0-9]{64}$/.test(window.__2FA_RECOVERY_CONFIG_ID__ || '')) return;
      if (!recoveryPreparation) recoveryPreparation = (async () => {
        const tuple = getCurrentRuntimeTuple('safe');
        const options = {expectedShellConfigId:window.__2FA_RECOVERY_CONFIG_ID__};
        const result = await window.twofaRuntimeTransport.prepare(tuple,options);
        // Prefetching recovery in a normal page must never replace its app pin.
        if (result?.status === 'ready' && getCurrentRuntimeTuple().mode === 'safe') {
          const attached = await window.twofaRuntimeTransport.attach(tuple,options);
          if (attached.status !== 'ready') return attached;
          return window.twofaRuntimeTransport.startup(tuple,options);
        }
        return result;
      })().finally(() => {recoveryPreparation=null;});
      return recoveryPreparation;
    }
    async function prepareCurrentRuntime() {
      if (!navigator.serviceWorker?.controller || !/^[a-f0-9]{64}$/.test(window.__2FA_BUILD_ID__ || '')) return;
      const tuple = getCurrentRuntimeTuple();
      if (tuple.mode === 'safe') return preparePublicRecovery();
      await preparePublicRecovery();
      // The app host owns its complete preparation and admission. A public
      // recovery result must not be published as this app's offline state.
      if (tuple.mode === 'app') return;
      let result = await window.twofaRuntimeTransport.prepare(tuple);
      // Only the app host can commit an app permit. Official pages still need
      // a complete pin so a later worker update can classify this live tab.
      if (result?.status === 'ready' && tuple.mode === 'official' && JSON.stringify(getCurrentRuntimeTuple()) === JSON.stringify(tuple)) {
        const attached = await window.twofaRuntimeTransport.attach(tuple);
        result = attached.status === 'ready' ? await window.twofaRuntimeTransport.startup(tuple) : attached;
      }
      window.dispatchEvent(new CustomEvent('runtime-offline-state',{detail:result}));
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('offline-readiness');
      return result;
    }
    function maybeControlFirstRuntime(registration) {
      const appearance = window.__2FA_APPEARANCE__;
      if (!registration.active || navigator.serviceWorker.controller || !(appearance?.kind==='app' || appearance?.manifest?.themeApiVersion===2)) return;
      const key = '2fa-runtime-control-reload:' + (window.__2FA_BUILD_ID__ || '');
      setTimeout(() => {
        if (navigator.serviceWorker.controller || !registration.active || window.__2FA_REFRESH_BLOCKED__?.() ||
          (typeof accountStore !== 'undefined' && accountStore.getOperationState().busy) ||
          (typeof secretDialogOpen !== 'undefined' && secretDialogOpen) ||
          (typeof customCodeReloadBlocked === 'function' && customCodeReloadBlocked())) return;
        try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key,'1'); } catch { return; }
        window.location.reload();
      },3000);
    }


    function publishAppearanceSnapshot(appearance = window.__2FA_APPEARANCE__) {
      const worker = navigator.serviceWorker && (navigator.serviceWorker.controller || offlineQueueWorker);
      if (!worker) return;
      const buildId = window.__2FA_BUILD_ID__ || '';
      if (!buildId) return;
      worker.postMessage({ type: 'APP_BUILD_PIN', buildId, revision: appearance?.revision });
      void preparePublicRecovery();
      if (navigator.onLine === false || !appearance ||
          new URLSearchParams(window.location.search).get('safeMode') === '1' ||
          new URLSearchParams(window.location.search).get('disableCustomCode') === '1') return;
      if (appearance?.kind === 'app' || appearance?.manifest?.themeApiVersion === 2) return;
      worker.postMessage({ type: 'APPEARANCE_SNAPSHOT', buildId, appearance });
      void prepareCurrentRuntime();
    }
    window.addEventListener('appearance-applied', event => publishAppearanceSnapshot(event.detail));

    // A launch opened the stored page while the server already has a newer one (another device
    // changed the appearance, or a new version was deployed). Registered before the page finishes
    // parsing, so the worker's message is never dispatched without a listener.
    async function reloadStaleShell() {
      if (typeof reloadForSavedAppearance !== 'function') {
        window.location.reload();
        return;
      }
      const result = await reloadForSavedAppearance();
      if (result?.status === 'rejected') window.dispatchEvent(new CustomEvent('appearance-navigation-required'));
    }
    if (typeof navigator.serviceWorker?.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'SHELL_STALE' && event.source === navigator.serviceWorker.controller) void reloadStaleShell();
      });
    }

    let offlineQueueWorker = null;
    let offlineQueueOperations = [];
    let offlineQueueAuthRequired = false;
    let offlineQueueResumePending = false;
    let offlineQueueResumeVersion = 0;
    let offlineQueueBusy = false;
    let offlineQueueReading = false;
    let offlineQueueReadAgain = false;
    let offlineQueueVersion = 0;
    let offlineQueueExpanded = false;
    let offlineQueueRetryTimer = null;
    // Set while a reconnected page still owes one server read of the account
    // list; replayed changes finish first when they are pending.
    let offlineReconnectReadPending = typeof navigator !== 'undefined' && navigator.onLine === false;
    let offlineReconnectReadTimer = null;
    const OFFLINE_RECONNECT_READ_FALLBACK_MS = 10000;

    function requestOfflineQueueMessage(type, operationId) {
      const worker = navigator.serviceWorker && (navigator.serviceWorker.controller || offlineQueueWorker);
      if (!worker || typeof MessageChannel !== 'function') return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        let finished = false;
        const finish = (error, data) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          channel.port1.onmessage = null;
          channel.port1.close();
          channel.port2.close();
          if (error) reject(error); else resolve(data);
        };
        const timer = setTimeout(() => finish(new Error(t('offlineQueueUnavailable'))), 3000);
        channel.port1.onmessage = event => {
          if (!event.data || event.data.ok !== true || !Array.isArray(event.data.operations)) {
            const code = event.data && typeof event.data.code === 'string' ? event.data.code : '';
            finish(Object.assign(new Error(t('offlineQueueUnavailable')), code ? { code } : {}));
          } else {
            finish(null, event.data);
          }
        };
        try {
          worker.postMessage({ type, language: getLanguage(), ...(operationId ? { operationId } : {}) }, [channel.port2]);
        } catch {
          finish(new Error(t('offlineQueueUnavailable')));
        }
      });
    }

    // Shows why a queue action did not happen. Only known reasons get their own
    // text; anything else is reported as an unavailable queue.
    let offlineQueueFeedbackKey = '';
    function getOfflineQueueSnapshot() {
      return {
        state: offlineQueueFeedbackKey ? 'unavailable' : offlineQueueReading ? 'loading' : 'ready',
        authRequired: offlineQueueAuthRequired, busy: offlineQueueBusy, unavailable: Boolean(offlineQueueFeedbackKey), reason: offlineQueueFeedbackKey,
        operations: offlineQueueOperations.map(item => {
          const safe = {};
          ['id', 'type', 'name', 'timestamp', 'status', 'failureReason', 'reason', 'claimed', 'canRetry', 'canEdit', 'canCancel'].forEach(key => {
            if (['string', 'number', 'boolean'].includes(typeof item[key])) safe[key] = item[key];
          });
          safe.operationId = item.id;
          safe.canRetry = item.status === 'failed' && !offlineQueueBusy;
          safe.canEdit = item.status === 'failed' && item.editable === true && !offlineQueueBusy;
          safe.canCancel = ['failed', 'awaiting_auth'].includes(item.status) && !offlineQueueBusy;
          return safe;
        })
      };
    }
    function publishPwaState() { if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('pwa'); }
    function getPwaHostState() { return { installAvailable: Boolean(deferredPrompt) && !pwaInstallPending }; }
    function offlineQueueFeedback(error = null) {
      offlineQueueFeedbackKey = !error ? '' : error.code === 'changeBusy' ? 'offlineQueueChangeBusy' : 'offlineQueueUnavailable';
      publishPwaState();
      const feedback = document.getElementById('offlineQueueFeedback');
      if (!feedback) return;
      feedback.textContent = offlineQueueFeedbackKey ? t(offlineQueueFeedbackKey) : '';
      feedback.hidden = !error;
      document.getElementById('offlineQueueReload').hidden = !error;
    }

    function applyOfflineQueueSummary(summary) {
      if (!summary) return;
      offlineQueueOperations = summary.operations.filter(item => item && typeof item.id === 'string' &&
        ['pending', 'awaiting_auth', 'failed'].includes(item.status));
      offlineQueueAuthRequired = summary.authRequired === true;
      if (offlineQueueAuthRequired) {
        clearTimeout(offlineQueueRetryTimer);
        offlineQueueRetryTimer = null;
      }
      offlineQueueFeedback();
      renderOfflineQueue();
    }

    function renderOfflineQueue() {
      publishPwaState();
      const bar = document.getElementById('offlineQueue');
      if (!bar) return;
      bar.hidden = offlineQueueOperations.length === 0;
      document.getElementById('offlineQueueSummary').textContent = offlineQueueAuthRequired
        ? t('offlineQueueAwaitingLogin') : t('offlineQueueCount', { count: offlineQueueOperations.length });
      document.getElementById('offlineQueueLogin').hidden = !offlineQueueAuthRequired;
      const toggle = document.getElementById('offlineQueueToggle');
      toggle.textContent = t(offlineQueueExpanded ? 'offlineQueueCollapse' : 'offlineQueueView');
      toggle.setAttribute('aria-expanded', String(offlineQueueExpanded));
      const list = document.getElementById('offlineQueueList');
      list.hidden = !offlineQueueExpanded;
      list.replaceChildren();
      const actions = { ADD: 'offlineQueueAdd', BATCH_ADD: 'offlineQueueImport', UPDATE: 'offlineQueueUpdate', DELETE: 'offlineQueueDelete' };
      const states = { pending: 'offlineQueuePending', awaiting_auth: 'offlineQueueContinueAfterLogin', failed: 'offlineQueueNeedsRetry' };
      for (const operation of offlineQueueOperations) {
        const item = document.createElement('li');
        const label = document.createElement('div');
        label.className = 'offline-queue-label';
        label.textContent = t(actions[operation.type] || 'offlineQueueAccountChange') +
          (typeof operation.name === 'string' && operation.name ? ' · ' + operation.name.slice(0, 120) : '') +
          ' · ' + t(offlineQueueAuthRequired && operation.status === 'pending' ? 'offlineQueueContinueAfterLogin' : states[operation.status]);
        if (Number.isFinite(operation.timestamp) && operation.timestamp >= 0) {
          const time = document.createElement('time');
          const date = new Date(operation.timestamp);
          if (Number.isFinite(date.getTime())) {
            time.dateTime = date.toISOString();
            time.textContent = formatI18nDate(date);
            label.append(time);
          }
        }
        // Server explanation for a stopped change; rendered as text only. A
        // queued add whose account exists with other parameters gets the
        // page's own explanation: the server only says it already exists.
        const failureReason = operation.duplicateDiffers === true
          ? t('offlineQueueDuplicateDiffers')
          : typeof operation.reason === 'string' ? operation.reason.slice(0, 300) : '';
        if (operation.status === 'failed' && failureReason) {
          const reason = document.createElement('span');
          reason.className = 'offline-queue-reason';
          reason.style.cssText = 'display: block; color: var(--text-secondary); font-size: 12px; margin-top: 4px;';
          reason.textContent = t('offlineQueueFailureReason', { reason: failureReason });
          label.append(reason);
        }
        item.append(label);
        const controls = document.createElement('div');
        controls.className = 'offline-queue-actions';
        const addAction = (text, action) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-secondary btn-sm';
          button.textContent = text;
          button.disabled = offlineQueueBusy;
          button.addEventListener('click', () => void action());
          controls.append(button);
        };
        if (operation.status === 'failed' && operation.editable === true) {
          addAction(t('offlineQueueEditRetry'), () => openOfflineQueueEditor(operation.id));
        }
        if (operation.status === 'failed') addAction(t('retry'), () => changeOfflineQueueOperation('OFFLINE_QUEUE_RETRY', operation.id));
        if (operation.status === 'failed' || operation.status === 'awaiting_auth') {
          addAction(t('offlineQueueCancelChange'), () => changeOfflineQueueOperation('OFFLINE_QUEUE_CANCEL', operation.id));
        }
        item.append(controls);
        list.append(item);
      }
    }

    // Only a page the worker controls queues offline changes. A first visit or a hard reload is
    // controlled from its next load on, so until then it does not promise to keep them.
    function offlineTextKey(queued, unqueued) {
      return navigator.serviceWorker?.controller ? queued : unqueued;
    }

    function refreshPwaLanguage() {
      renderOfflineQueue();
      updateSettingsPwaInstallButton();
      const feedback = document.getElementById('offlineQueueFeedback');
      if (feedback && !feedback.hidden) feedback.textContent = t(offlineQueueFeedbackKey || 'offlineQueueUnavailable');
      const bannerText = document.querySelector('#offline-banner .offline-banner-text');
      if (bannerText) bannerText.textContent = t(offlineTextKey('pwaOfflineBanner', 'pwaOfflineUnqueuedBanner'));
    }

    function toggleOfflineQueueDetails() {
      offlineQueueExpanded = !offlineQueueExpanded;
      renderOfflineQueue();
    }

    async function refreshOfflineQueue() {
      if (offlineQueueReading || offlineQueueBusy) { offlineQueueReadAgain = true; return { status: 'rejected', reason: 'queue-busy' }; }
      offlineQueueReading = true;
      publishPwaState();
      const version = ++offlineQueueVersion;
      try {
        const summary = await requestOfflineQueueMessage('OFFLINE_QUEUE_STATUS');
        if (version === offlineQueueVersion && !offlineQueueReadAgain) applyOfflineQueueSummary(summary);
        return { status: 'completed' };
      } catch (error) {
        if (version === offlineQueueVersion) offlineQueueFeedback(error);
        return { status: 'rejected', reason: 'queue-unavailable' };
      } finally {
        offlineQueueReading = false;
        publishPwaState();
        if (offlineQueueReadAgain) { offlineQueueReadAgain = false; void refreshOfflineQueue(); }
      }
    }

    async function changeOfflineQueueOperation(type, operationId, options = {}) {
      const isCurrent = options.isCurrent || (() => true);
      if (!isCurrent()) return { status: 'rejected', reason: 'mount-invalidated' };
      if (offlineQueueBusy) return { status: 'rejected', reason: 'queue-busy' };
      if (type === 'OFFLINE_QUEUE_CANCEL' && !(await showConfirmDialog({
        title: t('offlineQueueCancelTitle'), message: t('offlineQueueCancelMessage'),
        i18n: { title: 'offlineQueueCancelTitle', message: 'offlineQueueCancelMessage', confirmText: 'offlineQueueCancelChange', cancelText: 'offlineQueueKeep' },
        confirmText: t('offlineQueueCancelChange'), cancelText: t('offlineQueueKeep'), danger: true
      }))) return { status: 'cancelled' };
      if (!isCurrent()) return { status: 'rejected', reason: 'mount-invalidated' };
      if (offlineQueueBusy) return { status: 'rejected', reason: 'queue-busy' };
      offlineQueueBusy = true;
      const version = ++offlineQueueVersion;
      renderOfflineQueue();
      try {
        const summary = await requestOfflineQueueMessage(type, operationId);
        if (!summary) throw new Error(t('offlineQueueUnavailable'));
        if (version === offlineQueueVersion) applyOfflineQueueSummary(summary);
        return { status: 'committed' };
      } catch (error) {
        if (version === offlineQueueVersion) offlineQueueFeedback(error);
        return { status: 'rejected', reason: 'queue-unavailable' };
      } finally {
        offlineQueueBusy = false;
        renderOfflineQueue();
        if (offlineQueueResumePending) void drainOfflineQueueResume();
        if (offlineQueueReadAgain) { offlineQueueReadAgain = false; void refreshOfflineQueue(); }
      }
    }

    // Reopen a stopped add/edit in the account dialog so it can be corrected
    // instead of cancelled with its content.
    async function openOfflineQueueEditor(operationId, options = {}) {
      const isCurrent = options.isCurrent || (() => true);
      if (!isCurrent()) return { status: 'rejected', reason: 'mount-invalidated' };
      if (offlineQueueBusy) return { status: 'rejected', reason: 'queue-busy' };
      // Queued changes contain raw keys. Show them only to a page that has
      // confirmed this login, never to a new page after logout. The login
      // dialog cannot be dismissed while offline (leaving it opens /otp,
      // which cannot load), so offline pages only say what is needed.
      if (!isSecretAccessVerified()) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          showCenterToast('📡', t('offlineQueueEditNeedsLogin'));
        } else if (typeof showLoginModal === 'function') {
          showLoginModal();
        }
        return { status: 'rejected', reason: 'auth-required' };
      }
      const sessionGeneration = secretSessionGeneration;
      offlineQueueBusy = true;
      const version = ++offlineQueueVersion;
      renderOfflineQueue();
      try {
        const reply = await requestOfflineQueueMessage('OFFLINE_QUEUE_DETAIL', operationId);
        if (!isCurrent()) return { status: 'rejected', reason: 'mount-invalidated' };
        if (!reply || !reply.detail) throw new Error(t('offlineQueueUnavailable'));
        if (version === offlineQueueVersion) applyOfflineQueueSummary(reply);
        if (isSecretSessionCurrent(sessionGeneration) && typeof showQueuedSecretEditor === 'function') {
          if (showQueuedSecretEditor(reply.detail, options) === false) return { status: 'rejected', reason: 'queue-edit-unavailable' };
          return { status: 'opened' };
        }
        return { status: 'session-invalidated' };
      } catch (error) {
        if (version === offlineQueueVersion) offlineQueueFeedback(error);
        return { status: 'rejected', reason: 'queue-unavailable' };
      } finally {
        offlineQueueBusy = false;
        renderOfflineQueue();
        if (offlineQueueResumePending) void drainOfflineQueueResume();
        if (offlineQueueReadAgain) { offlineQueueReadAgain = false; void refreshOfflineQueue(); }
      }
    }

    // Claim a stopped change before saving its corrected copy, so another tab
    // cannot retry or replace the same change meanwhile. Returns 'claimed',
    // 'busy' (another tab is syncing or saving it), 'gone' (already handled
    // elsewhere) or 'unavailable' (no answer; the save goes ahead as before).
    async function claimOfflineQueueOperation(operationId) {
      try {
        const reply = await requestOfflineQueueMessage('OFFLINE_QUEUE_CLAIM', operationId);
        return reply ? 'claimed' : 'unavailable';
      } catch (error) {
        const outcome = { changeBusy: 'busy', changeGone: 'gone' }[error && error.code] || 'unavailable';
        if (outcome !== 'unavailable') void refreshOfflineQueue();
        return outcome;
      }
    }

    // The corrected copy was not saved; the stopped change stays available.
    async function releaseOfflineQueueOperation(operationId) {
      try {
        await requestOfflineQueueMessage('OFFLINE_QUEUE_RELEASE', operationId);
      } catch { /* An unreleased claim expires on its own. */ }
    }

    // The corrected change was saved or queued again; drop the stopped copy.
    async function discardReplacedOfflineQueueOperation(operationId) {
      try {
        const reply = await requestOfflineQueueMessage('OFFLINE_QUEUE_CANCEL', operationId);
        if (!reply) throw new Error(t('offlineQueueUnavailable'));
      } catch (error) {
        // Keep the notice visible; the stopped copy can still be cancelled manually.
        offlineQueueFeedback(error);
        return false;
      }
      await refreshOfflineQueue();
      return true;
    }

    function resumeOfflineQueueAfterLogin() {
      offlineQueueResumePending = true;
      offlineQueueResumeVersion += 1;
      return drainOfflineQueueResume();
    }

    async function drainOfflineQueueResume() {
      const worker = navigator.serviceWorker && (navigator.serviceWorker.controller || offlineQueueWorker);
      if (!worker || offlineQueueBusy) return;
      offlineQueueBusy = true;
      const loginVersion = offlineQueueResumeVersion;
      const version = ++offlineQueueVersion;
      try {
        const summary = await requestOfflineQueueMessage('OFFLINE_QUEUE_RESUME');
        if (version === offlineQueueVersion && summary) {
          if (loginVersion === offlineQueueResumeVersion) offlineQueueResumePending = false;
          applyOfflineQueueSummary(summary);
        }
      } catch (error) {
        if (version === offlineQueueVersion) offlineQueueFeedback(error);
      } finally {
        offlineQueueBusy = false;
        renderOfflineQueue();
        // A second login while this request was pending is a new recovery
        // intent. Retry it once; a timeout alone must not create a retry loop.
        if (offlineQueueResumePending && loginVersion !== offlineQueueResumeVersion) void drainOfflineQueueResume();
        if (offlineQueueReadAgain) { offlineQueueReadAgain = false; void refreshOfflineQueue(); }
      }
    }

    function retryOfflineQueueStatus() {
      if (offlineQueueResumePending) void drainOfflineQueueResume();
      else void refreshOfflineQueue();
    }

    /**
     * 注册 Service Worker 以支持 PWA 和离线功能
     */
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
          });
          offlineQueueWorker = registration.active || null;

          console.log('✅ Service Worker 注册成功:', registration.scope);
          maybeControlFirstRuntime(registration);
          navigator.serviceWorker.ready.then(maybeControlFirstRuntime).catch(() => {});

          // 监听更新（仅记录日志，不显示通知）
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('🔄 发现 Service Worker 更新');

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('✨ 新的 Service Worker 已安装，下次访问时自动使用新版本');
              }
            });
          });

          // 监听控制器变化
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('🔄 Service Worker 控制器已更新');
            publishAppearanceSnapshot();
            requestPendingOperationSync();
            if (offlineQueueResumePending) void drainOfflineQueueResume();
            else void refreshOfflineQueue();
          });

          // 📨 监听 Service Worker 消息（离线同步通知）
          navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'RUNTIME_STATUS_CHANGED' && event.source !== navigator.serviceWorker.controller) return;
            console.log('[PWA] 收到 Service Worker 消息:', event.data);
            handleServiceWorkerMessage(event.data);
          });

          publishAppearanceSnapshot();
          requestPendingOperationSync(registration);
          if (offlineQueueResumePending) void drainOfflineQueueResume();
          else void refreshOfflineQueue();

          // 定期检查更新（每小时）
          setInterval(() => {
            registration.update().catch(err => {
              console.warn('检查 Service Worker 更新失败:', err);
            });
          }, 60 * 60 * 1000);

        } catch (error) {
          console.warn('⚠️  Service Worker 注册失败:', error);
          // PWA 功能不可用，但不影响应用正常运行
        }
      });
    } else {
      console.log('ℹ️  当前浏览器不支持 Service Worker');
    }

    /**
     * 触发离线操作同步；不支持 Background Sync 时直接通知 Service Worker。
     * @param {ServiceWorkerRegistration|null} registration - 当前注册对象
     */
    function requestPendingOperationSync(registration = null) {
      if (navigator.onLine === false || offlineQueueAuthRequired) return;

      const postSyncMessage = () => {
        // 注册后台同步失败时，页面可能已经离线。
        if (navigator.onLine !== false && !offlineQueueAuthRequired && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SYNC_OPERATIONS', language: getLanguage() });
        }
      };

      if (registration && registration.sync) {
        registration.sync.register('sync-operations').catch(error => {
          console.warn('注册后台同步失败，改用页面触发:', error);
          postSyncMessage();
        });
        return;
      }
      postSyncMessage();
    }

    /**
     * 从服务端重新读取账户列表。当前会话已失效时，loadSecrets 走与在线 401
     * 相同的 handleUnauthorized 路径：清除显示的验证码和本地缓存并提示登录；
     * 离线队列保留在 Service Worker 中，登录成功后由 resumeOfflineQueueAfterLogin 续传。
     */
    function revalidateSecretsFromServer() {
      offlineReconnectReadPending = false;
      clearTimeout(offlineReconnectReadTimer);
      offlineReconnectReadTimer = null;
      if (typeof loadSecrets === 'function' && !secretReadsBlocked) void loadSecrets();
    }

    /**
     * 处理 Service Worker 消息
     * @param {Object} message - 消息对象
     */
    function handleServiceWorkerMessage(message) {
      const { type } = message;

      switch (type) {
        case 'RUNTIME_STATUS_CHANGED':
          window.dispatchEvent(new CustomEvent('runtime-offline-state',{detail:{status:message.state,tuple:message.tuple}}));
          if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('offline-readiness');
          break;
        case 'OFFLINE_QUEUE_CHANGED':
          void refreshOfflineQueue();
          break;
        case 'SYNC_SUCCESS':
          // Per-operation notices update queue status. Refresh the account
          // snapshot once after the whole batch completes.
          console.log('✅ 离线操作已同步:', message.operationType, message.operationId);
          break;

        case 'SYNC_FAILED':
          // 单个操作同步失败
          console.error('❌ 离线操作同步失败:', message.operationType, message.error);
          showCenterToast('⚠️', t('offlineQueueSyncWarning'));
          void refreshOfflineQueue();
          break;

        case 'SYNC_COMPLETE':
          if (message.authRequired) {
            offlineQueueAuthRequired = true;
            clearTimeout(offlineQueueRetryTimer);
            offlineQueueRetryTimer = null;
          }
          void refreshOfflineQueue();
          // 所有操作同步完成
          console.log(\`🎉 同步完成: 成功 \${message.successCount} 个, 失败 \${message.failCount} 个\`);

          if (message.successCount > 0) {
            showCenterToast('✅', t('offlineQueueSynced', { count: message.successCount }));
          }

          // Read the list after replayed changes and after a reconnect that
          // waited for this batch, even when nothing was applied. A login pause
          // is verified the same way: an expired session gets the online 401
          // handling (cached codes cleared), a still-valid one keeps working.
          if (message.successCount > 0 || message.authRequired || offlineReconnectReadPending) {
            revalidateSecretsFromServer();
          }

          if (message.failCount > 0) {
            showCenterToast('⚠️', t('offlineQueueSyncFailed', { count: message.failCount }));
          }

          // 网络传输失败只延后同步；在线信号可能滞后，保留页面重试机会。
          if (!offlineQueueAuthRequired && (message.failCount > 0 || message.deferredCount > 0) && navigator.onLine !== false) {
            offlineQueueRetryTimer = setTimeout(() => {
              offlineQueueRetryTimer = null;
              navigator.serviceWorker.ready
                .then(requestPendingOperationSync)
                .catch(error => console.warn('重试离线同步失败:', error));
            }, 30000);
          }
          break;

        default:
          console.log('[PWA] 未知消息类型:', type);
      }
    }

    /**
     * 监听PWA安装提示事件
     * 仅保存事件，实际触发通过系统设置 › 偏好中的按钮
     */
    let deferredPrompt = null;
    let pwaInstallPending = false;
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('💡 PWA 安装提示事件触发');
      e.preventDefault();
      deferredPrompt = e;
      updateSettingsPwaInstallButton();
    });

    /**
     * 同步 系统设置 › 偏好 的 PWA 安装按钮状态
     * - PWA 模式下：隐藏整节
     * - 已捕获 beforeinstallprompt：启用按钮
     * - 未捕获：禁用并用 title 提示
     */
    function updateSettingsPwaInstallButton() {
      publishPwaState();
      const section = document.getElementById('settingsPwaSection');
      const btn = document.getElementById('settingsPwaInstallBtn');
      if (!section || !btn) return;

      if (isPWAMode()) {
        section.style.display = 'none';
        return;
      }

      section.style.display = '';
      btn.textContent = t(pwaInstallPending ? 'pwaInstalling' : 'pwaInstallBtn');
      if (pwaInstallPending) {
        btn.disabled = true;
        btn.title = '';
        return;
      }

      if (deferredPrompt) {
        btn.disabled = false;
        btn.title = t('pwaInstallHint');
      } else {
        btn.disabled = true;
        btn.title = t('pwaUnavailable');
      }
    }

    /**
     * 从 系统设置 触发 PWA 安装
     */
    async function triggerPwaInstallFromSettings() {
      const btn = document.getElementById('settingsPwaInstallBtn');
      if (!deferredPrompt || pwaInstallPending) return { status: 'rejected', reason: 'install-unavailable' };
      pwaInstallPending = true;
      publishPwaState();

      if (btn) {
        btn.disabled = true;
        btn.textContent = t('pwaInstalling');
      }

      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(\`用户选择: \${outcome}\`);

        if (outcome === 'accepted') {
          showCenterToast('✅', t('pwaInstallStarted'));
          return { status: 'completed', reason: 'install-accepted' };
        } else {
          showCenterToast('❌', t('pwaInstallCancelled'));
          return { status: 'cancelled' };
        }
      } catch {
        showCenterToast('❌', t('pwaInstallFailed'));
        return { status: 'rejected', reason: 'install-failed' };
      } finally {
        pwaInstallPending = false;
        deferredPrompt = null;
        updateSettingsPwaInstallButton();
        publishPwaState();
      }
    }

    /**
     * 监听PWA安装成功事件
     */
    window.addEventListener('appinstalled', () => {
      console.log('✅ PWA 应用已成功安装');
      deferredPrompt = null;
      updateSettingsPwaInstallButton();
      showCenterToast('✅', t('pwaInstallCompleted'));
    });

    /**
     * 检测是否在PWA模式下运行
     */
    function isPWAMode() {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    }

    if (isPWAMode()) {
      console.log('🚀 应用正在 PWA 模式下运行');
      // 可以根据PWA模式调整UI
    }

    /**
     * 监听在线/离线状态变化
     */
    window.addEventListener('online', () => {
      publishPwaState();
      publishAppearanceSnapshot();
      console.log('🌐 网络已连接');

      // 移除离线横幅
      document.body.classList.remove('offline-mode');
      const offlineBanner = document.getElementById('offline-banner');
      if (offlineBanner) {
        offlineBanner.classList.remove('show');
        setTimeout(() => offlineBanner.remove(), 300);
      }

      showCenterToast('🌐', t('pwaOnlineSyncing'));

      // Revalidate the displayed offline snapshot once connectivity returns.
      // Only changes that will actually replay now postpone the read until
      // SYNC_COMPLETE; failed or login-paused changes never replay on their own.
      const replayPending = !offlineQueueAuthRequired &&
        Boolean(navigator.serviceWorker && navigator.serviceWorker.controller) &&
        offlineQueueOperations.some(operation => operation.status === 'pending');
      if (replayPending) {
        offlineReconnectReadPending = true;
        clearTimeout(offlineReconnectReadTimer);
        // A replay stuck on a slow request must not leave the snapshot stale.
        offlineReconnectReadTimer = setTimeout(() => {
          offlineReconnectReadTimer = null;
          if (offlineReconnectReadPending && navigator.onLine !== false) revalidateSecretsFromServer();
        }, OFFLINE_RECONNECT_READ_FALLBACK_MS);
      } else {
        revalidateSecretsFromServer();
      }

      // 手动触发同步（作为备用，如果 Background Sync 不可用）
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(requestPendingOperationSync).catch(err => {
          console.warn('手动触发同步失败:', err);
        });
      }
    });

    window.addEventListener('offline', () => {
      publishPwaState();
      console.log('📡 网络已断开');
      offlineReconnectReadPending = true;

      // 添加离线横幅
      document.body.classList.add('offline-mode');
      showOfflineBanner();

      showCenterToast('📡', t(offlineTextKey('pwaOfflineQueued', 'pwaOfflineUnqueued')));
    });

    /**
     * 显示离线横幅
     */
    function showOfflineBanner() {
      // 检查是否已经显示过
      if (document.getElementById('offline-banner')) {
        return;
      }

      // 创建离线横幅
      const banner = document.createElement('div');
      banner.id = 'offline-banner';
      banner.className = 'offline-banner';
      const textKey = offlineTextKey('pwaOfflineBanner', 'pwaOfflineUnqueuedBanner');
      banner.innerHTML = \`
        <span class="offline-banner-icon">📡</span>
        <span class="offline-banner-text" data-i18n="\${textKey}">\${t(textKey)}</span>
      \`;
      document.body.prepend(banner); // 添加到页面顶部

      // 添加显示动画
      setTimeout(() => banner.classList.add('show'), 100);
    }

    // 初始化时检查网络状态
    if (!navigator.onLine) {
      console.log('📡 应用启动时处于离线状态');
      document.body.classList.add('offline-mode');
      showOfflineBanner();
    }

    // ==================== 页面可见性处理 ====================
    // 解决手机切后台/锁屏后验证码不准确的问题
    
    /**
     * 当页面从后台切回前台时，刷新所有验证码
     * 原因：移动浏览器会暂停后台页面的定时器，导致验证码和倒计时不同步
     */
    document.addEventListener('visibilitychange', () => {
      if (typeof getOtpEngine === 'function') {
        const engine = getOtpEngine();
        if (document.hidden) engine.suspend();
        else void engine.resume('visibility');
      }
      publishPwaState();
    });

    window.addEventListener('focus', () => {
      if (!document.hidden && typeof getOtpEngine === 'function') void getOtpEngine().resume('focus');
      publishPwaState();
    });

    /**
     * 监听页面失去焦点事件
     */
    window.addEventListener('blur', () => {
      console.log('📱 窗口失去焦点');
    });

    /**
     * 使用 Page Visibility API 监控页面活跃状态
     * 提供更详细的日志用于调试
     */
    if (typeof document.hidden !== 'undefined') {
      console.log('✅ Page Visibility API 已启用');
      console.log('📊 当前页面状态:', document.hidden ? '隐藏' : '可见');
    } else {
      console.warn('⚠️  浏览器不支持 Page Visibility API');
    }

`;
}
