import { serializeBrowserFunction } from './browserSource.js';
/**
 * Core 核心业务逻辑模块
 * 包含密钥管理、OTP生成、二维码、备份等所有核心功能
 */

import { SERVICE_LOGOS } from '../config/serviceLogos.js';
import { getOfflineSecretsCode } from './offlineCache.js';
import { createAccountCommands } from '../runtime/accountCommands.js';
import { createBrowserClipboardPort } from './browserClipboard.js';

/**
 * 获取 Core 相关代码
 * @returns {string} Core JavaScript 代码
 */
export function getCoreCode() {
	const serviceLogosJSON = JSON.stringify(SERVICE_LOGOS, null, 2);

	return `${getOfflineSecretsCode()}
    let accountCommandsInstance = null;
    let browserClipboardInstance = null;
    function getBrowserClipboard() {
      if (!browserClipboardInstance) browserClipboardInstance = (${serializeBrowserFunction(createBrowserClipboardPort)})({ navigator, document });
      return browserClipboardInstance;
    }
    function getAccountCommands() {
      if (!accountCommandsInstance) accountCommandsInstance = (${serializeBrowserFunction(createAccountCommands)})({
        accounts: accountStore,
        otp: { readCopyTarget: (id, slot) => getOtpEngine().readCopyTarget(id, slot),
          validateCopyTarget: target => getOtpEngine().validateCopyTarget(target) },
        clipboard: getBrowserClipboard(),
        online: () => navigator.onLine !== false,
        origin: () => window.location.origin,
        unnamedLabel: () => t('transferUnnamed'),
        reserveCounter: snapshot => reserveHOTPCounter(snapshot, snapshot.sessionGeneration),
        reconcile: () => loadSecrets(), refresh: () => loadSecrets(),
        onOperationStart: promise => { saveQueue = promise.then(() => undefined); },
        feedback: (result, error) => {
          if (result.status === 'not-started') {
            const key = result.reason === 'write-busy-reclick' ? 'coreHotpWriteBusy' :
              result.reason === 'operation-pending-account-changed' ? 'coreHotpAccountChangedPending' :
              result.reason === 'offline' ? 'coreHotpCopyOffline' :
              result.reason === 'counter-limit' ? 'coreHotpLimit' : 'coreCodeUpdating';
            showCenterToast(['offline', 'counter-limit'].includes(result.reason) ? '⚠️' : '⏳', t(key));
          } else if (result.reservation === 'confirmed' && result.clipboard === 'failed') {
            showCenterToast('⚠️', t('coreHotpCopyFailedAdvanced'));
          } else if (result.reservation !== 'not-attempted' && (result.reservation !== 'confirmed' || result.localCommit !== 'committed')) {
            showCenterToast('⚠️', t(result.clipboard === 'copied' ? 'coreHotpCopiedSyncFailed' : 'coreHotpNotCopiedReconciled') + (error?.message || ''));
          }
        },
        afterCounterCommit: async snapshot => {
          if (!isSecretSessionCurrent(snapshot.sessionGeneration)) return;
          cacheSecretsLocally();
          await getOtpEngine().refreshOne(snapshot.id);
        }
      });
      return accountCommandsInstance;
    }
    // ========== Service Logos 配置 ==========
    // 服务名称到域名的映射数据（从 serviceLogos.js 导入）
    const SERVICE_LOGOS = ${serviceLogosJSON};

    // ========== Service Logo 处理逻辑（唯一实现） ==========
    // 注意：逻辑只在客户端实现，服务器端的 serviceLogos.js 只是纯数据配置
    const SECRETS_CACHE_KEY = '2fa-secrets-cache';
    let secretsCacheWriteFailed = false;
    let lastSecretsCacheTimestamp = 0;
    let secretsSnapshotSession = null;
    let secretsDisplaySession = null;
    let secretsDisplayFingerprint = null;
    let secretsDisplayPending = null;
    let secretsReadInvalid = false;
    const SECRETS_READ_TIMEOUT_MS = 8000;

    function cacheSecretsLocally() {
      secretsSnapshotSession = secretSessionGeneration;
      try {
        const timestamp = Math.max(Date.now(), lastSecretsCacheTimestamp + 1);
        // The hidden count travels with the snapshot, so a page opened
        // offline from it still reports the accounts it cannot show.
        localStorage.setItem(SECRETS_CACHE_KEY, JSON.stringify({
          data: secrets,
          timestamp,
          hiddenCount: getHiddenSecretsCount()
        }));
        lastSecretsCacheTimestamp = timestamp;
        secretsCacheWriteFailed = false;
        return true;
      } catch (error) {
        secretsCacheWriteFailed = true;
        console.warn('缓存数据失败:', error);
        // A quota failure commonly leaves the previous snapshot untouched.
        // Remove it so the next offline visit cannot resurrect deleted keys.
        try {
          localStorage.removeItem(SECRETS_CACHE_KEY);
        } catch (removeError) {
          console.warn('清除过期缓存失败:', removeError);
        }
        return false;
      }
    }

    function commitSecretListChange(nextSecrets, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return false;
      // In-flight list reads started before this confirmed write must not
      // replace the new local state or persist their older snapshot afterward.
      invalidateSecretReads();
      if (!replaceSecretRecords(nextSecrets, { expectedSession: sessionGeneration, reason: 'mutation', accessVerified: true })) return false;
      secretsReadInvalid = false;
      // Only confirmed server writes reach this point.
      markSecretAccessVerified(sessionGeneration);
      return cacheSecretsLocally();
    }

    function getHOTPGenerationSnapshot(secret) {
      const counter = secret && secret.counter !== undefined ? secret.counter : 0;
      const nextCounter = counter + 1;
      if (
        !secret ||
        String(secret.type || '').toUpperCase() !== 'HOTP' ||
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        !Number.isSafeInteger(nextCounter)
      ) {
        return null;
      }

      return {
        id: String(secret.id),
        counter,
        nextCounter,
        secret: secret.secret,
        digits: Number(secret.digits) || 6,
        algorithm: String(secret.algorithm || 'SHA1').toUpperCase(),
        hotpCounterNamespace: secret.hotpCounterNamespace || null
      };
    }

    function matchesHOTPGenerationSnapshot(secret, snapshot) {
      return !!(
        secret &&
        snapshot &&
        String(secret.id) === String(snapshot.id) &&
        String(secret.type || '').toUpperCase() === 'HOTP' &&
        secret.secret === snapshot.secret &&
        (Number(secret.digits) || 6) === snapshot.digits &&
        String(secret.algorithm || 'SHA1').toUpperCase() === snapshot.algorithm &&
        (secret.hotpCounterNamespace || null) === snapshot.hotpCounterNamespace
      );
    }

    /**
     * 将服务名拆分为单词数组（处理空格、连字符、点号等分隔符）
     * @param {string} text - 文本
     * @returns {string[]} 单词数组
     */
    function splitWords(text) {
      // 将连字符放在字符类最后，避免被解析为范围运算符
      return text.toLowerCase().trim().split(/[\\s._-]+/).filter(Boolean);
    }

    /**
     * 检查 keyWords 是否是 serviceWords 的连续子序列
     * 例如：['google', 'drive'] 匹配 ['google', 'drive', 'backup']
     * @param {string[]} serviceWords - 服务名单词数组
     * @param {string[]} keyWords - 键名单词数组
     * @returns {boolean} 是否匹配
     */
    function isWordSequenceMatch(serviceWords, keyWords) {
      if (keyWords.length > serviceWords.length) return false;

      for (let i = 0; i <= serviceWords.length - keyWords.length; i++) {
        let match = true;
        for (let j = 0; j < keyWords.length; j++) {
          if (serviceWords[i + j] !== keyWords[j]) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
      return false;
    }

    /**
     * 根据服务名称获取对应的 logo URL
     * @param {string} serviceName - 服务名称
     * @returns {string|null} Logo URL 或 null
     */
    function getServiceLogo(serviceName) {
      if (!serviceName) return null;

      // Keep card icons aligned with smart aggregation. The aggregation module
      // is emitted into the same browser script and owns the canonical resolver.
      if (typeof resolveServiceDomain === 'function') {
        const resolvedDomain = resolveServiceDomain(serviceName);
        return resolvedDomain ? \`/api/favicon/\${resolvedDomain}\` : null;
      }

      const normalizedName = serviceName.toLowerCase().trim();

      // 1. 精确匹配（最快）
      if (Object.prototype.hasOwnProperty.call(SERVICE_LOGOS, normalizedName)) {
        return \`/api/favicon/\${SERVICE_LOGOS[normalizedName]}\`;
      }

      // 2. 单词序列匹配（处理 "Google Drive Backup" 匹配 "google drive" 等场景）
      const serviceWords = splitWords(serviceName);

      for (const [key, domain] of Object.entries(SERVICE_LOGOS)) {
        const keyWords = splitWords(key);

        // 检查 key 的单词是否作为连续子序列出现在服务名中
        if (isWordSequenceMatch(serviceWords, keyWords)) {
          return \`/api/favicon/\${domain}\`;
        }
      }

      // 3. 未找到匹配，返回 null（将显示首字母图标）
      return null;
    }

    // ========== 原有函数 ==========

    // 客户端验证Base32密钥格式
    function validateBase32(secret) {
      const base32Regex = /^[A-Z2-7]+=*$/;
      return base32Regex.test(secret.toUpperCase()) && secret.length >= 8;
    }

    // Validate records before using either a server response or a persisted
    // snapshot. Keep legacy numeric IDs and omitted default OTP parameters.
    // A record is rejected when its ID repeats one already accepted in ids.
    function isUsableSecretRecord(item, ids) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const id = item.id;
      if (!(typeof id === 'string' && id.length > 0) && !(Number.isSafeInteger(id) && id >= 0)) return false;
      const key = String(id);
      if (/[\\s"'<>&\\\\]/.test(key) || ids.has(key)) return false;
      // Older imports could save blank names. Keep these accounts editable;
      // the card supplies a display label without changing persisted data.
      if (typeof item.name !== 'string' ||
          (item.account != null && typeof item.account !== 'string') ||
          typeof item.secret !== 'string' || !/^[A-Z2-7]+=*$/i.test(item.secret.replace(/\\s/g, '')) ||
          item.secret.replace(/\\s/g, '').replace(/=+$/, '').length < 2) return false;
      if (item.type != null && typeof item.type !== 'string') return false;
      const type = String(item.type || 'TOTP').toUpperCase();
      const period = Number(item.period || 30);
      const algorithm = String(item.algorithm || 'SHA1').toUpperCase().replace('-', '');
      const usable = ['TOTP', 'HOTP'].includes(type) && [6, 8].includes(Number(item.digits || 6)) &&
        ['SHA1', 'SHA256', 'SHA512'].includes(algorithm) &&
        (type === 'HOTP' ? Number.isSafeInteger(item.counter ?? 0) && (item.counter ?? 0) >= 0 :
          Number.isSafeInteger(period) && period > 0);
      if (usable) ids.add(key);
      return usable;
    }

    // Local snapshots stay all-or-nothing: a damaged cache is never partially reused.
    function isUsableSecretsSnapshot(value) {
      if (!Array.isArray(value)) return false;
      const ids = new Set();
      return value.every(item => isUsableSecretRecord(item, ids));
    }

    // The server list is authoritative, so one malformed legacy record must not
    // hide every other account. Unusable records are only left out of this
    // page: every account write is a single-record or additive request that the
    // server applies to its own stored list, so hidden records stay there.
    function filterUsableServerSecrets(value) {
      if (!Array.isArray(value)) return null;
      const ids = new Set();
      const hidden = [];
      const usable = value.filter(item => {
        if (isUsableSecretRecord(item, ids)) return true;
        hidden.push(item);
        return false;
      });
      const idCounts = new Map();
      value.forEach(item => {
        if (item && typeof item === 'object' && typeof item.id === 'string') idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
      });
      return { secrets: usable, hiddenCount: hidden.length, hidden: hidden.map(item => describeHiddenSecretRecord(item, idCounts)) };
    }

    // What the hidden-accounts notice shows for a record the page left out. The
    // server deletes the first record with the id, so only a text id that no other
    // record uses can be deleted from the notice.
    function describeHiddenSecretRecord(item, idCounts) {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      const secret = typeof record.secret === 'string' ? record.secret.replace(/\\s/g, '') : '';
      const id = record.id;
      const uniqueTextId = typeof id === 'string' && id.length > 0 && idCounts.get(id) === 1;
      // Everything isUsableSecretRecord() checks except the OTP parameters.
      const wellFormed = (uniqueTextId || (Number.isSafeInteger(id) && id >= 0)) &&
        !/[\\s"'<>&\\\\]/.test(String(id)) && typeof record.name === 'string' &&
        (record.account == null || typeof record.account === 'string') &&
        /^[A-Z2-7]+=*$/i.test(secret) && secret.replace(/=+$/, '').length >= 2 &&
        (record.type == null || typeof record.type === 'string');
      return {
        id: uniqueTextId ? id : null,
        name: typeof record.name === 'string' ? record.name : '',
        account: typeof record.account === 'string' ? record.account : '',
        reason: wellFormed ? 'unsupported' : 'invalid',
      };
    }

    let hiddenSecretsNotice = null;
    // Accounts the last server read left out of this session's list. Exports
    // use the same list, so they report this count too.
    let hiddenSecretsCount = { session: null, count: 0 };
    function getHiddenSecretsCount() {
      return isSecretSessionCurrent(hiddenSecretsCount.session) ? hiddenSecretsCount.count : 0;
    }

    // The hidden count saved with a local snapshot; parseOfflineSecretsCache
    // (shared with the extension) reads only the accounts and their time.
    function readCachedHiddenCount(raw) {
      try {
        const count = JSON.parse(raw).hiddenCount;
        return Number.isSafeInteger(count) && count > 0 ? count : 0;
      } catch {
        return 0;
      }
    }

    // Details of the hidden accounts, known only after a server read.
    let hiddenSecretRecords = { session: null, records: [] };
    function getHiddenSecretRecords() {
      return isSecretSessionCurrent(hiddenSecretRecords.session) ? hiddenSecretRecords.records : [];
    }

    function forgetHiddenSecret(id, sessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      // Like commitSecretListChange: reads started before this confirmed delete
      // must not bring the account back.
      invalidateSecretReads();
      // A read that finished meanwhile may already have left it out.
      if (!getHiddenSecretRecords().some(record => record.id === id)) return;
      const records = getHiddenSecretRecords().filter(record => record.id !== id);
      hiddenSecretRecords = { session: sessionGeneration, records };
      hiddenSecretsCount = { session: sessionGeneration, count: Math.max(0, getHiddenSecretsCount() - 1) };
      hiddenSecretsNotice = sessionGeneration + ':' + hiddenSecretsCount.count;
      cacheSecretsLocally();
      accountStore.setHidden({ count: getHiddenSecretsCount(), records }, sessionGeneration);
      if (typeof renderHiddenSecretsNotice === 'function') renderHiddenSecretsNotice();
    }

    function announceHiddenSecrets(hiddenCount, sessionGeneration, records) {
      hiddenSecretsCount = { session: sessionGeneration, count: hiddenCount || 0 };
      if (Array.isArray(records) || !hiddenCount) {
        hiddenSecretRecords = { session: sessionGeneration, records: Array.isArray(records) ? records : [] };
      }
      accountStore.setHidden({ count: hiddenCount || 0, records: getHiddenSecretRecords() }, sessionGeneration);
      if (typeof renderHiddenSecretsNotice === 'function') renderHiddenSecretsNotice();
      if (!hiddenCount) {
        hiddenSecretsNotice = null;
        return;
      }
      // Repeated reads of the same list must not repeat the notice.
      const notice = sessionGeneration + ':' + hiddenCount;
      if (hiddenSecretsNotice === notice) return;
      hiddenSecretsNotice = notice;
      showCenterToast('⚠️', t('coreInvalidRecordsHidden', { count: hiddenCount }));
    }

    function showSecretsReadFailure(messageKey) {
      accountStore.setReadStatus({ state: 'error', refreshState: 'error', errorKey: messageKey });
      secretsDisplaySession = null;
      secretsDisplayFingerprint = null;
      secretsDisplayPending = null;

    }

    function discardInvalidSecretsSnapshot() {
      secretsReadInvalid = true;
      secretsSnapshotSession = null;
      secretsDisplaySession = null;
      secretsDisplayFingerprint = null;
      secretsDisplayPending = null;
      secretRenderGeneration += 1;
      replaceSecretRecords([], { reason: 'invalid-data' });
      filteredSecrets = [];
      try { localStorage.removeItem(SECRETS_CACHE_KEY); } catch { /* Never reuse it in this page. */ }
    }

    function renderLoadedSecretsIfChanged() {
      const fingerprint = JSON.stringify(secrets);
      if (secretsDisplaySession === secretSessionGeneration && secretsDisplayFingerprint === fingerprint) return Promise.resolve();
      if (secretsDisplayPending && secretsDisplayPending.session === secretSessionGeneration &&
          secretsDisplayPending.fingerprint === fingerprint) return secretsDisplayPending.promise;
      const pending = { session: secretSessionGeneration, fingerprint, promise: null };
      secretsDisplayPending = pending;
      let rendering;
      try { rendering = Promise.resolve(getOtpEngine().refresh()); }
      catch (error) { rendering = Promise.reject(error); }
      pending.promise = rendering.then(() => {
        if (secretsDisplayPending === pending) {
          if (isSecretSessionCurrent(pending.session) && JSON.stringify(secrets) === fingerprint) {
            secretsDisplaySession = pending.session;
            secretsDisplayFingerprint = fingerprint;
          }
          secretsDisplayPending = null;
        }
      }, error => {
        if (secretsDisplayPending === pending) {
          secretsDisplaySession = null;
          secretsDisplayFingerprint = null;
          secretsDisplayPending = null;
        }
        throw error;
      });
      return pending.promise;
    }

    // Show usable local accounts first. The timeout applies only to this read,
    // including clock readiness, response headers, and the complete JSON body.
    async function loadSecrets() {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      const loadGeneration = beginSecretRead();
      const isCurrentLoad = () => isSecretSessionCurrent(sessionGeneration) && loadGeneration === secretLoadGeneration;
      let localAvailable = false;
      let cachedHiddenCount = null;
      if (!secretsReadInvalid) {
        if ((secretsSnapshotSession === sessionGeneration || secrets.length > 0) && isUsableSecretsSnapshot(secrets)) {
          localAvailable = true;
          secretsSnapshotSession = sessionGeneration;
        } else if (!secretsCacheWriteFailed) {
          try {
            // Web caches must retain every account accepted by the online read.
            const raw = localStorage.getItem(SECRETS_CACHE_KEY);
            const cached = parseOfflineSecretsCache(raw, Infinity);
            if (cached && isUsableSecretsSnapshot(cached.data)) {
              replaceSecretRecords(cached.data, { expectedSession: sessionGeneration, source: 'local', accessVerified: true,
                hidden: { count: readCachedHiddenCount(raw), records: [] } });
              secretsSnapshotSession = sessionGeneration;
              localAvailable = true;
              cachedHiddenCount = readCachedHiddenCount(raw);
            }
          } catch { /* Continue with the server when browser storage is unavailable. */ }
        }
      }
      if (localAvailable) {
        markSecretAccessVerified(sessionGeneration);
        accountStore.setReadStatus({ state: 'ready' });
      }
      if (cachedHiddenCount !== null) announceHiddenSecrets(cachedHiddenCount, sessionGeneration);
      const displaying = localAvailable ? renderLoadedSecretsIfChanged().catch(error => {
        if (isCurrentLoad()) console.warn('显示本地账户失败:', error);
      }) : Promise.resolve();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await displaying;
        if (isCurrentLoad() && !localAvailable) showSecretsReadFailure('coreOfflineRead');
        if (isCurrentLoad() && localAvailable) accountStore.setReadStatus({ state: 'ready', refreshState: 'idle' });
        return false;
      }
      const controller = new AbortController();
      let timedOut = false;
      let timeoutId;
      const deadline = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(t('coreReadTimeout')));
        }, SECRETS_READ_TIMEOUT_MS);
      });
      try {
        const reading = (async () => {
          await ensureServerTimeSynchronized();
          if (!isCurrentLoad() || controller.signal.aborted) return null;
          const response = await authenticatedFetch('/api/secrets', { signal: controller.signal });
          if (!isCurrentLoad() || controller.signal.aborted) return null;
          if (response.status === 401 || response.status === 403) {
            handleUnauthorized(sessionGeneration);
            return null;
          }
          if (!response.ok) throw new Error(t('coreReadUnavailable'));
          markSecretAccessVerified(sessionGeneration);
          let loadedSecrets;
          try { loadedSecrets = await response.json(); }
          catch (error) {
            if (error && error.name === 'SyntaxError' && !controller.signal.aborted) {
              throw Object.assign(new Error(t('coreInvalidData')), { invalidData: true });
            }
            throw error;
          }
          if (!isCurrentLoad() || controller.signal.aborted) return null;
          const usable = filterUsableServerSecrets(loadedSecrets);
          if (!usable) {
            throw Object.assign(new Error(t('coreInvalidData')), { invalidData: true });
          }
          return usable;
        })();
        const loaded = await Promise.race([reading, deadline]);
        clearTimeout(timeoutId);
        if (!isCurrentLoad() || timedOut || loaded === null) return;
        if (!replaceSecretRecords(loaded.secrets, { expectedSession: sessionGeneration, expectedRead: loadGeneration,
          source: 'server', accessVerified: true, hidden: { count: loaded.hiddenCount, records: loaded.hidden }, reason: 'server-read' })) return false;
        secretsReadInvalid = false;
        if (typeof syncLanguagePreferenceAfterAuth === 'function') void syncLanguagePreferenceAfterAuth();
        announceHiddenSecrets(loaded.hiddenCount, sessionGeneration, loaded.hidden);
        cacheSecretsLocally();
        await renderLoadedSecretsIfChanged();
        return true;
      } catch (error) {
        if (!isCurrentLoad()) return;
        console.warn('读取账户未完成:', error);
        if (error.invalidData) {
          discardInvalidSecretsSnapshot();
          showSecretsReadFailure('coreInvalidData');
        } else if (!localAvailable) {
          showSecretsReadFailure('coreConnectionFailed');
        } else {
          accountStore.setReadStatus({ state: 'ready', refreshState: 'error', errorKey: 'coreConnectionFailed' });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Older imports could save blank names. Everything that names an account
    // uses the label its card shows, without changing the saved data.
    function getSecretDisplayName(secret) {
      const name = secret && typeof secret.name === 'string' ? secret.name : '';
      return name.trim() ? name : t('transferUnnamed');
    }

    function copyHOTPAndAdvanceCounter(secretId) {
      const sessionGeneration = secretSessionGeneration;
      const operation = getAccountCommands().copyCurrent(secretId);
      return operation.then(result => {
        if (!isSecretSessionCurrent(sessionGeneration)) return false;
        if (result.status === 'not-started' || result.reservation !== 'confirmed' ||
            result.localCommit !== 'committed' || result.clipboard !== 'copied') return false;
        showOTPCopyFeedback(secretId);
        return true;
      });
    }

    function performHOTPCopyAndAdvance(secretId) {
      return copyHOTPAndAdvanceCounter(secretId);
    }

    async function reserveHOTPCounter(snapshot, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      const queuedSecret = secrets.find(item => String(item.id) === String(snapshot.id));
      const queuedCounter = queuedSecret && queuedSecret.counter !== undefined
        ? queuedSecret.counter
        : 0;
      if (
        !matchesHOTPGenerationSnapshot(queuedSecret, snapshot) ||
        queuedCounter !== snapshot.counter
      ) {
        throw new Error(t('coreHotpChanged'));
      }

      const response = await authenticatedFetch(
        '/api/secrets/' + encodeURIComponent(snapshot.id) + '/counter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedCounter: snapshot.counter,
            expectedSecret: snapshot.secret,
            expectedDigits: snapshot.digits,
            expectedAlgorithm: snapshot.algorithm,
            expectedNamespace: snapshot.hotpCounterNamespace
          })
        }
      );
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized(sessionGeneration);
        return;
      }
      const result = await response.json();
      if (!isSecretSessionCurrent(sessionGeneration)) return;

      if (!response.ok) {
        // Validation, missing resources, unsupported methods, conflicts and rate
        // limits reject before a reservation. A timeout or 5xx can follow a write:
        // only reconciliation may establish the current counter, never who wrote it.
        const reservationRejected = [400, 404, 405, 409, 422, 429].includes(response.status);
        throw Object.assign(new Error(result.message || result.error || t('coreHotpRejected')), { reservationRejected });
      }

      const queuedOffline = result.queued === true && result.offline === true;
      if (queuedOffline) {
        throw new Error(t('coreHotpAdvanceOffline'));
      }
      const responseSecret = result.data && result.data.secret;
      if (
        (!matchesHOTPGenerationSnapshot(responseSecret, snapshot) ||
          responseSecret.counter !== snapshot.nextCounter)
      ) {
        throw new Error(t('coreHotpInvalidState'));
      }

      return responseSecret;
    }

    // 复制验证器配置 URI（otpauth:// 格式，用于导入验证器）
    async function copyOTPAuthURL(secretId) {
      const session = secretSessionGeneration;
      const secret = accountStore.getRecord(secretId);
      if (!secret) {
        showCenterToast('❌', t('coreKeyMissing'));
        return { status: 'not-started', reason: 'account-missing' };
      }
      const result = await getAccountCommands().copyURI({ id: secretId, generation: accountStore.getAccountGeneration(secretId) });
      if (isSecretSessionCurrent(session)) {
        showCenterToast(result.clipboard === 'copied' ? '🔗' : '❌', result.clipboard === 'copied'
          ? t('coreCopiedUriService', { name: getSecretDisplayName(secret) }) : t('coreCopyUriFailed'));
      }
      return result;
    }

    async function copyOTPPageURL(secretId) {
      const session = secretSessionGeneration;
      const secret = accountStore.getRecord(secretId);
      if (!secret) {
        showCenterToast('❌', t('coreKeyMissing'));
        return { status: 'not-started', reason: 'account-missing' };
      }
      const result = await getAccountCommands().copyShareLink({ id: secretId, generation: accountStore.getAccountGeneration(secretId) });
      if (isSecretSessionCurrent(session)) {
        showCenterToast(result.clipboard === 'copied' ? '🔗' : '❌', result.clipboard === 'copied'
          ? t('coreCopiedLinkService', { name: getSecretDisplayName(secret) }) : t('coreCopyLinkFailed'));
      }
      return result;
    }

    function isAccountCommandCurrent(guard) {
      try { return !guard || typeof guard.isCurrent !== 'function' || guard.isCurrent() === true; }
      catch { return false; }
    }

    function editSecret(id, guard = null) {
      if (!isAccountCommandCurrent(guard)) return { status: 'rejected', reason: 'operation-invalidated' };
      const secret = accountStore.getRecord(id);
      if (!secret) return;
      showSecretModal(() => { secretDialogCommandGuard = guard; fillSecretForm(id, secret); });
    }

    // Reopen an offline add/edit the server rejected. Saving it replaces the
    // stopped queue entry, so its content is never lost to a cancellation.
    function showQueuedSecretEditor(detail, guard = null) {
      if (!isAccountCommandCurrent(guard)) return false;
      if (!detail || typeof detail.id !== 'string' || !detail.data || typeof detail.data !== 'object') return false;
      const targetId = detail.type === 'UPDATE' && typeof detail.targetId === 'string' && detail.targetId ? detail.targetId : null;
      if (detail.type === 'UPDATE' ? !targetId : detail.type !== 'ADD') return false;
      const data = detail.data;
      const text = value => typeof value === 'string' ? value : '';
      const secret = {
        name: text(data.name),
        account: text(data.account),
        secret: text(data.secret),
        type: text(data.type).toUpperCase() || 'TOTP',
        digits: data.digits,
        period: data.period,
        algorithm: text(data.algorithm).toUpperCase() || 'SHA1',
        counter: data.counter
      };
      // The server reported that the edited account was deleted meanwhile, so
      // saving adds it as a new account instead of editing a missing one.
      const targetMissing = detail.type === 'UPDATE' && detail.targetMissing === true;
      showSecretModal(() => {
        secretDialogCommandGuard = guard;
        fillSecretForm(targetMissing ? null : targetId, secret);
        secretDialogQueuedOperationId = detail.id;
      });
      if (targetMissing) showCenterToast('⚠️', t('coreQueuedTargetMissing'));
      else if (detail.type === 'ADD' && detail.duplicateDiffers === true) showCenterToast('⚠️', t('offlineQueueDuplicateDiffers'));
      else if (typeof detail.reason === 'string' && detail.reason) showCenterToast('⚠️', detail.reason);
      return true;
    }

    // Show a stored value that a select does not offer (for example a 45-second
    // period) instead of silently reading it back as the default. The option
    // exists only while this dialog shows that record.
    function selectSecretFormValue(field, value) {
      const text = String(value);
      if (field && field.options && ![...field.options].some(option => option.value === text)) {
        const option = document.createElement('option');
        option.value = text;
        option.textContent = text;
        option.setAttribute('data-temporary-value', 'true');
        field.appendChild(option);
      }
      if (field) field.value = text;
    }

    function fillSecretForm(id, secret) {
      editingId = id;
      // The server keeps a period it no longer offers for new accounts when an
      // edit submits it unchanged with the same type, like this form does.
      const stored = id ? secrets.find(s => s.id === id) : null;
      const storedPeriod = stored ? Number(stored.period || 30) : NaN;
      secretDialogStoredParams = stored && Number.isSafeInteger(storedPeriod) && storedPeriod > 0
        ? { type: String(stored.type || 'TOTP').toUpperCase(), period: storedPeriod }
        : null;
      document.getElementById('secretId').value = id || '';
      document.getElementById('secretName').value = secret.name;
      document.getElementById('secretService').value = secret.account || '';
      document.getElementById('secretKey').value = secret.secret;

      // 填充高级参数
      // Unlisted stored values stay visible; validation then decides whether
      // they can be saved instead of the form quietly replacing them.
      selectSecretFormValue(document.getElementById('secretType'), String(secret.type || 'TOTP').toUpperCase());
      selectSecretFormValue(document.getElementById('secretDigits'), secret.digits || 6);
      // HOTP ignores the period, and only HOTP accounts can carry an unusable one.
      const period = Number(secret.period || 30);
      selectSecretFormValue(document.getElementById('secretPeriod'), Number.isSafeInteger(period) && period > 0 ? period : 30);
      selectSecretFormValue(document.getElementById('secretAlgorithm'),
        String(secret.algorithm || 'SHA1').toUpperCase().replace('-', ''));
      document.getElementById('secretCounter').value = secret.counter || 0;

      // 如果有非默认的高级参数，显示高级选项
      const hasAdvancedOptions = (secret.type && secret.type !== 'TOTP') ||
                                (secret.digits && secret.digits !== 6) ||
                                (secret.period && secret.period !== 30) ||
                                (secret.algorithm && secret.algorithm !== 'SHA1') ||
                                (secret.counter && secret.counter !== 0);

      document.getElementById('showAdvanced').checked = Boolean(hasAdvancedOptions);
      toggleAdvancedOptions();
    }
    
    async function deleteSecret(id, guard = null) {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
      const secret = accountStore.getRecord(id);
      if (!secret) return { status: 'rejected', reason: 'account-missing' };
      const accountGeneration = accountStore.getAccountGeneration(id);
      const invalidBeforeSend = () => !isSecretSessionCurrent(sessionGeneration)
        ? { status: 'session-invalidated' }
        : !isAccountCommandCurrent(guard) ? { status: 'rejected', reason: 'operation-invalidated' }
        : accountStore.getAccountGeneration(id) !== accountGeneration ? { status: 'rejected', reason: 'account-changed' } : null;
      const initiallyInvalid = invalidBeforeSend();
      if (initiallyInvalid) return initiallyInvalid;

      const displayName = getSecretDisplayName(secret);
      const confirmed = await showConfirmDialog({
        i18n: { title: 'deleteSecretTitle', message: 'deleteSecretConfirm', confirmText: 'delete', cancelText: 'cancel', params: { name: displayName } },
        title: t('deleteSecretTitle'),
        message: t('deleteSecretConfirm', { name: displayName }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      const invalidAfterConfirmation = invalidBeforeSend();
      if (invalidAfterConfirmation) return invalidAfterConfirmation;
      if (!confirmed) return { status: 'cancelled' };

      // 🔒 删除操作也使用队列，避免与编辑操作产生竞态条件
      saveQueue = queueSecretWrite('delete', id, sessionGeneration, async () => {
        const invalid = invalidBeforeSend();
        if (invalid) return invalid;
        try {
          console.log('🗑️ [保存队列] 提交删除请求:', secret.name);

          // Ids may contain / % ? #; the server decodes the last path segment.
          const response = await authenticatedFetch('/api/secrets/' + encodeURIComponent(id), {
            method: 'DELETE'
          });
          if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
          if (response.status === 401) {
            handleUnauthorized(sessionGeneration);
            return { status: 'session-invalidated' };
          }

          if (response.ok) {
            const result = await response.json();
            if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };

            // 检查是否为离线排队响应
            if (result.queued && result.offline) {
              console.log('📥 [离线模式] 删除操作已排队，等待同步:', result.operationId);
              showCenterToast('📥', t('coreQueued'));

              // 离线模式下，暂时不更新本地状态，等待同步完成后由 PWA 模块刷新
              return { status: 'queued-offline' };
            }

            // 正常在线响应，立即删除本地数据
            const cached = commitSecretListChange(secrets.filter(s => String(s.id) !== String(id)), sessionGeneration);
            await renderLoadedSecretsIfChanged();
            if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
            if (!cached) showCenterToast('⚠️', t('coreDeletedNoCache'));


            console.log('✅ [保存队列] 删除成功:', secret.name);
            return { status: 'committed' };
          } else {
            showCenterToast('❌', t('coreDeleteRetry'));
            return { status: 'rejected', reason: 'server-rejected' };
          }
        } catch (error) {
          if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
          console.error('❌ [保存队列] 删除失败:', error);
          showCenterToast('❌', t('coreDeleteFailed') + error.message);
          return { status: 'rejected', reason: 'transport-unknown' };
        }
      }).catch(err => {
        if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
        console.error('❌ [保存队列] 队列执行错误:', err);
        return { status: 'rejected', reason: 'queue-failed' };
      });
      return saveQueue;
    }
    
    // 二维码解析工具
    function showQRScanAndDecode() {
      hideToolsModal();
      showQRDecodeModal();
    }
    
    // 二维码生成工具
    function showQRGenerateTool() {
      hideToolsModal();
      showQRGenerateModal();
    }
    
    // Base32编解码工具
    function showBase32Tool() {
      hideToolsModal();
      showBase32Modal();
    }
    
    // 时间戳工具
    function showTimestampTool() {
      hideToolsModal();
      showTimestampModal();
    }
    
    // 密钥检查器
    function showKeyCheckTool() {
      hideToolsModal();
      showKeyCheckModal();
    }
    
    // 密钥生成器
    function showKeyGeneratorTool() {
      hideToolsModal();
      showKeyGeneratorModal();
    }
    
    // Mirror the server's addSecretSchema/validateBase32 rules. An offline save
    // is only queued when the server will accept it after reconnecting.
    function keepsStoredPeriod({ type, period }, stored) {
      return Boolean(stored) && period === stored.period && String(type).toUpperCase() === stored.type;
    }

    function getSecretFormError({ name, secret, type, digits, period, algorithm, counter }, stored = null) {
      if (!name || !secret) return { message: t('coreRequiredFields'), field: name ? 'secretKey' : 'secretName' };
      if (name.length > 50) return { message: t('coreNameTooLong', { 0: name.length }), field: 'secretName' };
      const compactSecret = secret.replace(/\\s/g, '');
      if (!/^[A-Z2-7]+=*$/.test(compactSecret)) return { message: t('coreSecretInvalid'), field: 'secretKey' };
      if (compactSecret.length < 8) return { message: t('coreSecretTooShort', { 0: compactSecret.length }), field: 'secretKey' };
      if (!['TOTP', 'HOTP'].includes(String(type).toUpperCase())) return { message: t('coreTypeInvalid'), field: 'secretType' };
      if (![6, 8].includes(digits)) return { message: t('coreDigitsInvalid'), field: 'secretDigits' };
      if (![30, 60, 120].includes(period) && !keepsStoredPeriod({ type, period }, stored)) {
        return { message: t('corePeriodInvalid'), field: 'secretPeriod' };
      }
      if (!['SHA1', 'SHA256', 'SHA512'].includes(String(algorithm).toUpperCase())) {
        return { message: t('coreAlgorithmInvalid'), field: 'secretAlgorithm' };
      }
      if (!Number.isSafeInteger(counter) || counter < 0) return { message: t('coreCounterRange'), field: 'secretCounter' };
      return null;
    }

    // A corrected queued change was saved or queued again; drop the stopped copy.
    function replaceStoppedQueuedChange(submission) {
      if (!submission.replacesOperationId || typeof discardReplacedOfflineQueueOperation !== 'function') return;
      submission.replaced = true;
      void discardReplacedOfflineQueueOperation(submission.replacesOperationId);
    }

    // Claim the stopped change this save replaces. Returns false when another
    // tab is handling it; the dialog then stays open and nothing is saved, so
    // the change is never applied twice.
    async function claimStoppedQueuedChange(submission, ownsDialog) {
      if (!submission.replacesOperationId || typeof claimOfflineQueueOperation !== 'function') return true;
      const claim = await claimOfflineQueueOperation(submission.replacesOperationId);
      submission.claimed = claim === 'claimed';
      if (claim !== 'busy' && claim !== 'gone') return true;
      const message = claim === 'busy' ? 'coreQueuedChangeBusy' : 'coreQueuedChangeGone';
      // The stopped copy no longer exists; saving again submits an ordinary change.
      const queuedOperationId = claim === 'gone' ? null : submission.replacesOperationId;
      if (ownsDialog()) {
        showCenterToast('⚠️', t(message));
        if (secretDialogQueuedOperationId === submission.replacesOperationId) {
          secretDialogQueuedOperationId = queuedOperationId;
        }
      } else if (isSecretSessionCurrent(submission.sessionGeneration)) {
        if (!secretDialogOpen) {
          // The dialog was closed while saving: reopen the correction instead
          // of dropping it silently.
          showSecretModal(() => {
            fillSecretForm(submission.editingId, submission.data);
            secretDialogQueuedOperationId = queuedOperationId;
          });
          showCenterToast('⚠️', t(message));
        } else {
          // Another dialog is open now and is left alone. A busy change can
          // still be edited again from the queue; a handled one cannot.
          showCenterToast('⚠️', t(claim === 'busy' ? 'coreQueuedChangeBusy' : 'coreQueuedCorrectionDiscarded'));
        }
      }
      return false;
    }

    async function handleSubmit(event) {
      event.preventDefault();
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      if (!secretDialogOpen) return;
      if (secretDialogSubmission) return secretDialogSubmission.promise;
      const commandGuard = secretDialogCommandGuard;
      if (!isAccountCommandCurrent(commandGuard)) return { status: 'rejected', reason: 'operation-invalidated' };

      const name = document.getElementById('secretName').value.trim();
      const account = document.getElementById('secretService').value.trim();
      const secret = document.getElementById('secretKey').value.trim().toUpperCase();

      // 获取高级参数
      const type = document.getElementById('secretType').value || 'TOTP';
      // Read the selected value as is; an unexpected value is reported by
      // validation instead of being replaced with a default.
      const numberField = (fieldId, fallback) => {
        const value = document.getElementById(fieldId).value;
        return value === '' ? fallback : Number(value);
      };
      const digits = numberField('secretDigits', 6);
      let period = numberField('secretPeriod', 30);
      const stored = editingId ? secretDialogStoredParams : null;
      const algorithm = document.getElementById('secretAlgorithm').value || 'SHA1';
      const counterValue = document.getElementById('secretCounter').value;
      const enteredCounter = counterValue === '' ? 0 : Number(counterValue);
      // TOTP ignores the hidden counter field; never let it reject the save.
      const counter = type.toUpperCase() === 'HOTP' || (Number.isSafeInteger(enteredCounter) && enteredCounter >= 0)
        ? enteredCounter : 0;

      // HOTP does not use the period. An unlisted value left in the hidden field
      // after switching an account to HOTP falls back to the default.
      if (type.toUpperCase() === 'HOTP' && ![30, 60, 120].includes(period) && !keepsStoredPeriod({ type, period }, stored)) {
        period = 30;
      }

      const invalid = getSecretFormError({ name, secret, type, digits, period, algorithm, counter }, stored);
      if (invalid) {
        // Keep the dialog open with the entered values, online or offline.
        showCenterToast('❌', invalid.message);
        const field = document.getElementById(invalid.field);
        if (field && typeof field.focus === 'function') field.focus();
        return;
      }

      const submitBtn = document.getElementById('submitBtn');
      // Capture the submitted record and form before joining the write queue.
      // The user can close this dialog and edit another account while it waits.
      const submission = {
        sessionGeneration,
        generation: secretDialogGeneration,
        editingId,
        replacesOperationId: secretDialogQueuedOperationId,
        guard: commandGuard,
        data: { name, account, secret, type, digits, period, algorithm, counter }
      };
      secretDialogSubmission = submission;
      const ownsDialog = () => isSecretSessionCurrent(submission.sessionGeneration) && secretDialogOpen &&
        secretDialogGeneration === submission.generation && secretDialogSubmission === submission;
      syncSecretDialogTranslations();
      submitBtn.disabled = true;

      // 🔒 关键修复：使用队列确保保存操作串行执行，避免并发覆盖
      // 当快速连续编辑多个密钥时，后端的读-修改-写操作会产生race condition
      // 通过Promise链式调用，确保前一个保存完成后再执行下一个
      saveQueue = queueSecretWrite(submission.editingId ? 'edit' : 'add', submission.editingId, submission.sessionGeneration, async () => {
        if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
        try {
          if (!isAccountCommandCurrent(submission.guard)) return { status: 'rejected', reason: 'operation-invalidated' };
          if (!(await claimStoppedQueuedChange(submission, ownsDialog))) return;
          if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
          if (!isAccountCommandCurrent(submission.guard)) return { status: 'rejected', reason: 'operation-invalidated' };
          let response;
          const data = submission.data;

          const action = submission.editingId ? '更新' : '新增';
          console.log('🔄 [保存队列] 提交保存请求:', action, name, { period, digits, algorithm });

          if (submission.editingId) {
            response = await authenticatedFetch('/api/secrets/' + encodeURIComponent(submission.editingId), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
          } else {
            response = await authenticatedFetch('/api/secrets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
          }

          if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
          if (response.status === 401) {
            handleUnauthorized(submission.sessionGeneration);
            return;
          }
          if (response.ok) {
            const result = await response.json();
            if (!isSecretSessionCurrent(submission.sessionGeneration)) return;

            // 检查是否为离线排队响应
            if (result.queued && result.offline) {
              console.log('📥 [离线模式] 操作已排队，等待同步:', result.operationId);
              replaceStoppedQueuedChange(submission);
              if (ownsDialog()) showCenterToast('📥', t('coreQueued'));

              // 离线模式下，暂时不更新本地状态，等待同步完成后由 PWA 模块刷新
              if (ownsDialog()) hideSecretModal();
              return;
            }

            // 正常在线响应，更新本地状态
            console.log('✅ [保存队列] 保存成功:', result.data ? result.data.secret.name : result.name, '- period:', result.data ? result.data.secret.period : result.period);

            const savedSecret = result.data ? result.data.secret : result;
            if (!savedSecret || typeof savedSecret.id !== 'string' || !savedSecret.id ||
                (submission.editingId && savedSecret.id !== submission.editingId)) {
              throw new Error(t('coreSaveMismatch'));
            }
            // A concurrent list response may already include a newly created
            // account before the POST response reaches this page.
            const cached = commitSecretListChange(secrets.some(item => item.id === savedSecret.id)
              ? secrets.map(item => item.id === savedSecret.id ? savedSecret : item)
              : [...secrets, savedSecret], submission.sessionGeneration);
            replaceStoppedQueuedChange(submission);

            await renderLoadedSecretsIfChanged();
            if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
            if (ownsDialog()) {
              if (!cached) showCenterToast('⚠️', t('coreSavedNoCache'));
              hideSecretModal();
            }
          } else {
            const error = await response.json();
            if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
            const errorMessage = error.message || error.error || t('coreSaveRetry');
            if (ownsDialog()) showCenterToast('❌', errorMessage);
          }
        } catch (error) {
          if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
          console.error('❌ [保存队列] 保存失败:', error);
          if (ownsDialog()) showCenterToast('❌', t('coreSaveFailed') + error.message);
        } finally {
          // Not saved: the stopped change stays available to this and other tabs.
          if (submission.claimed && !submission.replaced && typeof releaseOfflineQueueOperation === 'function') {
            void releaseOfflineQueueOperation(submission.replacesOperationId);
          }
          if (ownsDialog()) {
            secretDialogSubmission = null;
            syncSecretDialogTranslations();
            submitBtn.disabled = false;
          }
        }
      }).catch(err => {
        if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
        // 队列执行失败的最终兜底
        console.error('❌ [保存队列] 队列执行错误:', err);
        if (ownsDialog()) {
          secretDialogSubmission = null;
          syncSecretDialogTranslations();
          submitBtn.disabled = false;
        }
      });
      submission.promise = saveQueue;
      return saveQueue;
    }


`;
}
