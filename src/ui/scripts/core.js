import { dialogIcon } from '../dialogIcons.js'; /**
 * Core 核心业务逻辑模块
 * 包含密钥管理、OTP生成、二维码、备份等所有核心功能
 */

import { SERVICE_LOGOS } from '../config/serviceLogos.js';
import { getOfflineSecretsCode } from './offlineCache.js';

/**
 * 获取 Core 相关代码
 * @returns {string} Core JavaScript 代码
 */
export function getCoreCode() {
	const serviceLogosJSON = JSON.stringify(SERVICE_LOGOS, null, 2);

	return `${getOfflineSecretsCode()}
    // ========== Service Logos 配置 ==========
    // 服务名称到域名的映射数据（从 serviceLogos.js 导入）
    const SERVICE_LOGOS = ${serviceLogosJSON};

    // ========== Service Logo 处理逻辑（唯一实现） ==========
    // 注意：逻辑只在客户端实现，服务器端的 serviceLogos.js 只是纯数据配置
    const hotpCopyLocks = new Map();
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
      secretLoadGeneration += 1;
      secrets = nextSecrets;
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
        String(secret.id) === snapshot.id &&
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

    // 页面加载时获取密钥列表
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof initLanguage === 'function') {
          initLanguage();
        }
        if (typeof applyTranslations === 'function') {
          applyTranslations();
        }
        initializeTrustedClock();
        // 先检查认证状态
        if (checkAuth()) {
          loadSecrets();
          // Cookie 过期由浏览器自动管理，无需定时检查
        }
        initTheme();

        // 恢复用户的排序选择
        restoreSortPreference();
        restoreGroupSortPreference();
        restoreViewModePreference();

        // 排序 popover 外部点击 / Escape 关闭
        if (typeof initSortDropdownOutsideClose === 'function') {
          initSortDropdownOutsideClose();
        }

        // 初始化 FAB 拖拽并还原上次保存的位置
        if (typeof initFABDrag === 'function') {
          initFABDrag();
        }

        // 页面加载后立即刷新所有OTP，确保时间同步
        setTimeout(() => {
          if (secrets && secrets.length > 0) {
            console.log('页面加载完成，立即刷新所有OTP');
            if (typeof updateOTPSecretsInBatch === 'function') {
              updateOTPSecretsInBatch(secrets, { includeHOTP: true });
            } else {
              secrets.forEach(secret => {
                updateOTP(secret.id, null, secret);
              });
            }
          }
        }, 500);
      });

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
      secretLoadGeneration += 1;
      // A read that finished meanwhile may already have left it out.
      if (!getHiddenSecretRecords().some(record => record.id === id)) return;
      const records = getHiddenSecretRecords().filter(record => record.id !== id);
      hiddenSecretRecords = { session: sessionGeneration, records };
      hiddenSecretsCount = { session: sessionGeneration, count: Math.max(0, getHiddenSecretsCount() - 1) };
      hiddenSecretsNotice = sessionGeneration + ':' + hiddenSecretsCount.count;
      cacheSecretsLocally();
      if (typeof renderHiddenSecretsNotice === 'function') renderHiddenSecretsNotice();
    }

    function announceHiddenSecrets(hiddenCount, sessionGeneration, records) {
      hiddenSecretsCount = { session: sessionGeneration, count: hiddenCount || 0 };
      if (Array.isArray(records) || !hiddenCount) {
        hiddenSecretRecords = { session: sessionGeneration, records: Array.isArray(records) ? records : [] };
      }
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
      secretsDisplaySession = null;
      secretsDisplayFingerprint = null;
      secretsDisplayPending = null;
      const loading = document.getElementById('loading');
      const emptyState = document.getElementById('emptyState');
      if (loading) loading.style.display = 'none';
      if (!emptyState) return;
      emptyState.innerHTML = '<h3 data-i18n="coreReadTitle"></h3><p></p>' +
        '<button type="button" class="workspace-action" data-i18n="retry" onclick="loadSecrets()"></button>';
      setTranslatedText(emptyState.querySelector('p'), messageKey);
      applyTranslations(emptyState);
      emptyState.style.display = 'block';
    }

    function discardInvalidSecretsSnapshot() {
      secretsReadInvalid = true;
      secretsSnapshotSession = null;
      secretsDisplaySession = null;
      secretsDisplayFingerprint = null;
      secretsDisplayPending = null;
      secretRenderGeneration += 1;
      secrets = [];
      filteredSecrets = [];
      clearOTPIntervalsExcept([]);
      if (typeof clearAllOTPAnimations === 'function') clearAllOTPAnimations();
      if (typeof clearOTPWindowScheduler === 'function') clearOTPWindowScheduler();
      const list = document.getElementById('secretsList');
      if (list) { list.innerHTML = ''; list.style.display = 'none'; }
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
      try { rendering = Promise.resolve(renderSecrets()); }
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
      const loadGeneration = ++secretLoadGeneration;
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
              secrets = cached.data;
              secretsSnapshotSession = sessionGeneration;
              localAvailable = true;
              cachedHiddenCount = readCachedHiddenCount(raw);
            }
          } catch { /* Continue with the server when browser storage is unavailable. */ }
        }
      }
      if (localAvailable) markSecretAccessVerified(sessionGeneration);
      if (cachedHiddenCount !== null) announceHiddenSecrets(cachedHiddenCount, sessionGeneration);
      const displaying = localAvailable ? renderLoadedSecretsIfChanged().catch(error => {
        if (isCurrentLoad()) console.warn('显示本地账户失败:', error);
      }) : Promise.resolve();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await displaying;
        if (isCurrentLoad() && !localAvailable) showSecretsReadFailure('coreOfflineRead');
        return;
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
        secrets = loaded.secrets;
        secretsReadInvalid = false;
        if (typeof syncLanguagePreferenceAfterAuth === 'function') void syncLanguagePreferenceAfterAuth();
        announceHiddenSecrets(loaded.hiddenCount, sessionGeneration, loaded.hidden);
        cacheSecretsLocally();
        await renderLoadedSecretsIfChanged();
      } catch (error) {
        if (!isCurrentLoad()) return;
        console.warn('读取账户未完成:', error);
        if (error.invalidData) {
          discardInvalidSecretsSnapshot();
          showSecretsReadFailure('coreInvalidData');
        } else if (!localAvailable) {
          showSecretsReadFailure('coreConnectionFailed');
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // 渲染密钥列表
    async function renderSecrets() {
      if (secretReadsBlocked) return;
      filteredSecrets = [...secrets];
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value.trim()) {
        await filterSecrets(searchInput.value);
      } else {
        await renderFilteredSecrets();
      }
    }

    // 获取服务商颜色
    function getServiceColor(serviceName) {
      const colors = [
        '#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
        '#6f42c1', '#e83e8c', '#fd7e14', '#20c997', '#6c757d',
        '#343a40', '#007bff', '#28a745', '#dc3545', '#ffc107'
      ];
      
      let hash = 0;
      for (let i = 0; i < serviceName.length; i++) {
        hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
      }
      
      return colors[Math.abs(hash) % colors.length];
    }

    // Older imports could save blank names. Everything that names an account
    // uses the label its card shows, without changing the saved data.
    function getSecretDisplayName(secret) {
      const name = secret && typeof secret.name === 'string' ? secret.name : '';
      return name.trim() ? name : t('transferUnnamed');
    }

    // 创建密钥卡片
    function createSecretCard(secret) {
      const logoUrl = getServiceLogo(secret.name);
      const isHOTP = secret.type && secret.type.toUpperCase() === 'HOTP';
      const displayName = getSecretDisplayName(secret);
      // These values are used in both text content and quoted tooltip attributes.
      const nameHTML = escapeHTML(displayName).replace(/"/g, '&quot;');
      const accountHTML = escapeHTML(secret.account || '').replace(/"/g, '&quot;');

      const cardCopyTooltip = (typeof t === 'function' ? t('cardCopyTooltip') : null) || '点击卡片复制验证码';
      const cardMenuTriggerTitle = (typeof t === 'function' ? t('cardMenuTriggerTitle') : null) || '账户操作';
      const cardMenuQRCode = (typeof t === 'function' ? t('cardMenuQRCode') : null) || '二维码';
      const cardMenuQRCodeTitle = (typeof t === 'function' ? t('cardMenuQRCodeTitle') : null) || '显示验证器二维码';
      const cardMenuCopyURI = (typeof t === 'function' ? t('cardMenuCopyURI') : null) || '复制 URI';
      const cardMenuCopyURITitle = (typeof t === 'function' ? t('cardMenuCopyURITitle') : null) || '用于导入验证器的 otpauth:// 配置';
      const cardMenuCopyLink = (typeof t === 'function' ? t('cardMenuCopyLink') : null) || '复制链接';
      const cardMenuCopyLinkTitle = (typeof t === 'function' ? t('cardMenuCopyLinkTitle') : null) || '在浏览器中打开并查看验证码';
      const cardMenuEdit = (typeof t === 'function' ? t('cardMenuEdit') : null) || '编辑';
      const cardMenuEditTitle = (typeof t === 'function' ? t('cardMenuEditTitle') : null) || '编辑密钥';
      const cardMenuDelete = (typeof t === 'function' ? t('cardMenuDelete') : null) || '删除';
      const cardMenuDeleteTitle = (typeof t === 'function' ? t('cardMenuDeleteTitle') : null) || '删除密钥';
      const copyOtpBtnTitle = (typeof t === 'function' ? t('copyOtpBtnTitle') : null) || '点击复制验证码';
      const copyOtpBtnAriaLabel = (typeof t === 'function' ? t('copyOtpBtnAriaLabel') : null) || '复制当前验证码';
      const otpNextLabel = (typeof t === 'function' ? t('otpNextLabel') : null) || '下一个';
      const copyNextOtpBtnTitle = (typeof t === 'function' ? t('copyNextOtpBtnTitle') : null) || '点击复制下一个验证码';
      const counterLabel = (typeof t === 'function' ? t('counterLabel') : null) || '计数器: ';

      return '<div class="secret-card" onclick="copyOTPFromCard(event, &quot;' + secret.id + '&quot;)" title="' + cardCopyTooltip + '">' +
        // TOTP 显示进度条，HOTP 不显示
        (isHOTP ? '' :
          '<div class="progress-top">' +
            '<div class="progress-top-fill" id="progress-' + secret.id + '"></div>' +
          '</div>'
        ) +
        '<div class="card-header">' +
          '<div class="secret-info">' +
            '<div class="service-icon">' +
              (logoUrl ?
                '<img src="' + logoUrl + '" alt="' + nameHTML + '" style="width: 30px; height: 30px; object-fit: contain; border-radius: 6px;" onerror="this.style.display=&quot;none&quot;; this.nextElementSibling.style.display=&quot;block&quot;;">' +
                '<span style="display: none;">' + escapeHTML(displayName.charAt(0).toUpperCase()) + '</span>' :
                '<span>' + escapeHTML(displayName.charAt(0).toUpperCase()) + '</span>'
              ) +
            '</div>' +
            '<div class="secret-text">' +
            '<h3><span class="secret-name" title="' + nameHTML + '">' + nameHTML + '</span>' + (isHOTP ? '<span class="secret-type">[HOTP]</span>' : '') + '</h3>' +
            (secret.account ? '<p title="' + accountHTML + '">' + accountHTML + '</p>' : '') +
            (isHOTP ? '<p id="counter-' + secret.id + '" style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">' + counterLabel + (secret.counter ?? 0) + '</p>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card-menu" title="">' +
            '<button type="button" class="card-menu-trigger" title="' + cardMenuTriggerTitle + '" aria-label="' + cardMenuTriggerTitle + '" aria-expanded="false" aria-controls="menu-' + secret.id + '" onclick="event.stopPropagation(); toggleCardMenu(&quot;' + secret.id + '&quot;)"><span class="menu-dots" aria-hidden="true">⋮</span></button>' +
            '<div class="card-menu-dropdown" id="menu-' + secret.id + '">' +
              '<button type="button" class="menu-item" title="' + cardMenuQRCodeTitle + '" onclick="event.stopPropagation(); showQRCode(&quot;' + secret.id + '&quot;); closeAllCardMenus();">' + cardMenuQRCode + '</button>' +
              '<button type="button" class="menu-item" title="' + cardMenuCopyURITitle + '" onclick="event.stopPropagation(); copyOTPAuthURL(&quot;' + secret.id + '&quot;); closeAllCardMenus();">' + cardMenuCopyURI + '</button>' +
              '<button type="button" class="menu-item" title="' + cardMenuCopyLinkTitle + '" onclick="event.stopPropagation(); copyOTPPageURL(&quot;' + secret.id + '&quot;); closeAllCardMenus();">' + cardMenuCopyLink + '</button>' +
              '<button type="button" class="menu-item" title="' + cardMenuEditTitle + '" onclick="event.stopPropagation(); editSecret(&quot;' + secret.id + '&quot;); closeAllCardMenus();">' + cardMenuEdit + '</button>' +
              '<button type="button" class="menu-item menu-item-danger" title="' + cardMenuDeleteTitle + '" onclick="event.stopPropagation(); deleteSecret(&quot;' + secret.id + '&quot;); closeAllCardMenus();">' + cardMenuDelete + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="otp-preview">' +
          '<div class="otp-main">' +
            '<div class="otp-code-container">' +
              '<button type="button" class="otp-code" id="otp-' + secret.id + '" onclick="event.stopPropagation(); copyOTP(&quot;' + secret.id + '&quot;)" title="' + copyOtpBtnTitle + '" aria-label="' + copyOtpBtnAriaLabel + '">------</button>' +
            '</div>' +
            // HOTP 不显示"下一个"验证码（因为不是时间基准）
            (isHOTP ? '' :
              '<button type="button" class="otp-next-container" onclick="event.stopPropagation(); copyNextOTP(&quot;' + secret.id + '&quot;)" title="' + copyNextOtpBtnTitle + '">' +
                '<span class="otp-next-label">' + otpNextLabel + '</span>' +
                '<span class="otp-next-code" id="next-otp-' + secret.id + '">------</span>' +
              '</button>'
            ) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function createServiceGroupSection(group, index, showHeader = true) {
      const cardsHTML = group.items.map(secret => createSecretCard(secret)).join('');
      if (!showHeader) {
        return '<div class="service-group"><div class="service-group-grid">' + cardsHTML + '</div></div>';
      }
      const headingId = 'service-group-heading-' + index;
      const hasFilteredCount = Boolean(currentSearchQuery) && group.matchedCount !== group.totalCount;
      const countText = hasFilteredCount
        ? group.matchedCount + ' / ' + group.totalCount
        : (typeof t === 'function' ? t('groupCountText', { count: group.totalCount }) : group.totalCount + ' 个');
      const countLabel = hasFilteredCount
        ? (typeof t === 'function' ? t('groupMatchedCountLabel', { matched: group.matchedCount, total: group.totalCount }) : '匹配 ' + group.matchedCount + ' 个，共 ' + group.totalCount + ' 个')
        : (typeof t === 'function' ? t('groupCountLabel', { count: group.totalCount }) : '共 ' + group.totalCount + ' 个');

      return '<section class="service-group" aria-labelledby="' + headingId + '">' +
        '<div class="service-group-header">' +
          '<h2 class="service-group-title" id="' + headingId + '">' + escapeHTML(group.name) + '</h2>' +
          '<span class="service-group-count" aria-label="' + escapeHTML(countLabel) + '">' + countText + '</span>' +
        '</div>' +
        '<div class="service-group-grid">' + cardsHTML + '</div>' +
      '</section>';
    }

    function clearOTPIntervalsExcept(visibleSecrets) {
      const visibleIds = new Set((visibleSecrets || []).map(secret => String(secret.id)));
      Object.keys(otpIntervals).forEach(secretId => {
        if (visibleIds.has(secretId)) return;
        clearInterval(otpIntervals[secretId]);
        delete otpIntervals[secretId];
      });
    }

    // 渲染过滤后的密钥列表
    async function renderFilteredSecrets() {
      if (secretReadsBlocked) return;
      const sessionGeneration = secretSessionGeneration;
      const renderGeneration = ++secretRenderGeneration;
      const loading = document.getElementById('loading');
      const secretsList = document.getElementById('secretsList');
      const emptyState = document.getElementById('emptyState');

      // 重绘会替换 OTP 节点；先取消旧节点上的排队/播放动效，避免 flyer 残留或异步回调命中脱离节点。
      if (typeof clearAllOTPAnimations === 'function') {
        clearAllOTPAnimations();
      }
      if (typeof clearOTPWindowScheduler === 'function') {
        clearOTPWindowScheduler();
      }
      // 旧 interval 会命中新替换的占位节点并启动非 batch 请求；重绘完成后统一重建。
      clearOTPIntervalsExcept([]);

      loading.style.display = 'none';

      if (currentSearchQuery && filteredSecrets.length === 0) {
        clearOTPIntervalsExcept([]);
        secretsList.innerHTML = '';
        secretsList.style.display = 'none';
        emptyState.innerHTML =
          '<div class="icon" aria-hidden="true">${dialogIcon('search')}</div>' +
          '<h3 data-i18n="searchNoMatch">未找到匹配的密钥</h3>' +
          '<p data-i18n="searchNoMatchDesc">尝试使用不同的关键字搜索</p>' +
          '<button type="button" class="workspace-action" data-i18n="searchClearAriaLabel" onclick="clearSearch()">清除搜索</button>';
        if (typeof applyTranslations === 'function') {
          applyTranslations(emptyState);
        }
        emptyState.style.display = 'block';
        return;
      }

      if (secrets.length === 0) {
        clearOTPIntervalsExcept([]);
        secretsList.innerHTML = '';
        secretsList.style.display = 'none';
        emptyState.innerHTML =
          '<div class="icon" aria-hidden="true">${dialogIcon('key')}</div>' +
          '<h3 data-i18n="emptyTitle">还没有密钥</h3>' +
          '<p data-i18n="emptyDesc">添加账户的两步验证密钥，在这里获取验证码</p>' +
          '<button type="button" class="workspace-action" data-i18n="emptyAddBtn" onclick="showAddModal()">添加密钥</button>';
        if (typeof applyTranslations === 'function') {
          applyTranslations(emptyState);
        }
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';

      // 应用排序
      const sortedSecrets = sortSecrets(filteredSecrets, currentSortType);
      const isGroupedView = currentViewMode === 'grouped';
      secretsList.classList.toggle('is-grouped', isGroupedView);
      secretsList.style.display = isGroupedView ? 'block' : 'grid';

      if (isGroupedView) {
        const serviceGroups = groupSecretsByServiceFamily(sortedSecrets, secrets, currentGroupSortType);
        // When no service has two or more accounts, every account is in "Other services";
        // a single heading above the whole list would only repeat the total.
        const onlyUngrouped = serviceGroups.length === 1 && serviceGroups[0].isOther && serviceGroups[0].totalCount === secrets.length;
        secretsList.innerHTML = serviceGroups.map((group, index) => createServiceGroupSection(group, index, !onlyUngrouped)).join('');
      } else {
        secretsList.innerHTML = sortedSecrets.map(secret => createSecretCard(secret)).join('');
      }

      // 🚀 性能优化：并发计算所有OTP
      const perfStart = performance.now();

      // 并发计算所有密钥的OTP（等待全部完成）
      if (typeof updateOTPSecretsInBatch === 'function') {
        await updateOTPSecretsInBatch(sortedSecrets, { includeHOTP: true });
      } else {
        await Promise.all(
          sortedSecrets.map(secret => updateOTP(secret.id, null, secret))
        );
      }

      if (!isSecretSessionCurrent(sessionGeneration) || renderGeneration !== secretRenderGeneration) return;

      // 性能监控日志
      const perfEnd = performance.now();
      const duration = (perfEnd - perfStart).toFixed(2);
      console.log('[性能优化] ' + sortedSecrets.length + '个密钥的OTP并发计算完成，耗时: ' + duration + 'ms');

      // OTP计算完成后再启动定时器
      sortedSecrets.forEach(secret => {
        startOTPInterval(secret.id, secret);
      });

      clearOTPIntervalsExcept(filteredSecrets);
    }

    // 从卡片点击复制OTP验证码
    async function copyOTPFromCard(event, secretId) {
      // 检查点击的目标元素，避免在点击交互元素时触发
      const target = event.target;
      const isInteractiveElement = target.closest('.card-menu') || 
                                   target.closest('.otp-code') || 
                                   target.closest('.otp-next-container') ||
                                   target.closest('.secret-actions') ||
                                   target.closest('.action-btn');
      
      // 如果点击的是交互元素，不执行复制
      if (isInteractiveElement) {
        return;
      }
      
      // 执行复制操作
      await copyOTP(secretId);
    }

    // 复制OTP验证码
    async function copyOTP(secretId) {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      // 关闭所有打开的卡片菜单
      closeAllCardMenus();

      const secret = secrets.find(s => String(s.id) === String(secretId));
      if (secret && String(secret.type || '').toUpperCase() === 'HOTP') {
        return copyHOTPAndAdvanceCounter(secretId);
      }

      const otpElement = document.getElementById('otp-' + secretId);
      if (!otpElement) return;

      const otpText = otpElement.textContent;
      if (!isCopyableOTPValue(secretId, otpText)) return;

      try {
        await navigator.clipboard.writeText(otpText);
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        showOTPCopyFeedback(secretId);
      } catch (err) {
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        const textArea = document.createElement('textarea');
        textArea.value = otpText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showOTPCopyFeedback(secretId);
      }
    }

    function copyHOTPAndAdvanceCounter(secretId) {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return Promise.resolve(false);
      const lockKey = sessionGeneration + ':' + String(secretId);
      const existing = hotpCopyLocks.get(lockKey);
      if (existing) return existing;

      // 等待更早的编辑/删除完成后再读取并复制，保证验证码与随后推进的 counter 属于同一快照。
      const operation = saveQueue
        .then(() => isSecretSessionCurrent(sessionGeneration) ? performHOTPCopyAndAdvance(secretId, sessionGeneration) : false)
        .catch(async error => {
          if (!isSecretSessionCurrent(sessionGeneration)) return false;
          console.error('HOTP 计数器更新失败:', error);
          try {
            await loadSecrets();
            if (!isSecretSessionCurrent(sessionGeneration)) return false;
          } catch (reconcileError) {
            if (!isSecretSessionCurrent(sessionGeneration)) return false;
            console.warn('重新加载 HOTP 计数器失败:', reconcileError);
          }
          const message = error.hotpCopied
            ? t('coreHotpCopiedSyncFailed')
            : t('coreHotpNotCopiedReconciled');
          showCenterToast('⚠️', message + error.message);
          return false;
        });
      hotpCopyLocks.set(lockKey, operation);
      saveQueue = operation.then(() => undefined);
      const clearLock = () => {
        if (hotpCopyLocks.get(lockKey) === operation) {
          hotpCopyLocks.delete(lockKey);
        }
      };
      operation.then(clearLock, clearLock);
      return operation;
    }

    async function performHOTPCopyAndAdvance(secretId, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return false;
      const secret = secrets.find(item => String(item.id) === String(secretId));
      const snapshot = getHOTPGenerationSnapshot(secret);
      if (!snapshot) {
        showCenterToast('⚠️', t('coreHotpLimit'));
        return false;
      }

      const otpElement = document.getElementById('otp-' + secretId);
      if (!otpElement) return false;

      // 被批次替换的更新也会 resolve；必须同步确认节点实际提交了当前 counter 的验证码。
      const otpText = getCommittedHOTPToken(secretId, secret);
      if (!otpText) {
        // 恢复计算失败或被取消的 HOTP；本次不等待计算后自动复制，避免丢失用户激活。
        updateOTP(secretId, null, secret).catch(error => console.warn('刷新 HOTP 失败:', error));
        showCenterToast('⏳', t('coreCodeUpdating'));
        return false;
      }
      if (navigator.onLine === false) {
        showCenterToast('⚠️', t('coreHotpCopyOffline'));
        return false;
      }

      // 本地校验通过并即将预留；更早开始的 GET 不得在复制后回写旧状态。
      secretLoadGeneration += 1;
      // 剪贴板调用必须在用户激活仍有效时启动；与服务端预留并发，避免网络 await 后权限失效。
      const clipboardOperation = copyHOTPText(otpText, sessionGeneration);
      const reservationOperation = reserveHOTPCounter(snapshot, sessionGeneration);
      const [clipboardResult, reservationResult] = await Promise.allSettled([
        clipboardOperation,
        reservationOperation
      ]);
      if (!isSecretSessionCurrent(sessionGeneration)) return false;
      const copied = clipboardResult.status === 'fulfilled' && clipboardResult.value === true;
      if (reservationResult.status === 'rejected') {
        const reservationError = reservationResult.reason instanceof Error
          ? reservationResult.reason
          : new Error(String(reservationResult.reason));
        reservationError.hotpCopied = copied;
        throw reservationError;
      }

      try {
        await commitReservedHOTPCounter(snapshot, sessionGeneration);
        if (!isSecretSessionCurrent(sessionGeneration)) return false;
      } catch (error) {
        if (!isSecretSessionCurrent(sessionGeneration)) return false;
        error.hotpCopied = copied;
        throw error;
      }

      if (!copied) {
        showCenterToast('⚠️', t('coreHotpCopyFailedAdvanced'));
        return false;
      }

      showOTPCopyFeedback(secretId);
      return true;
    }

    async function copyHOTPText(otpText, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return false;
      try {
        await navigator.clipboard.writeText(otpText);
        return isSecretSessionCurrent(sessionGeneration);
      } catch (clipboardError) {
        if (!isSecretSessionCurrent(sessionGeneration)) return false;
        const textArea = document.createElement('textarea');
        try {
          textArea.value = otpText;
          document.body.appendChild(textArea);
          textArea.select();
          if (document.execCommand('copy') === false) throw clipboardError;
          return true;
        } catch (fallbackError) {
          console.warn('HOTP 复制失败:', fallbackError);
          return false;
        } finally {
          if (textArea.parentNode) textArea.parentNode.removeChild(textArea);
        }
      }
    }

    async function reserveHOTPCounter(snapshot, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      const queuedSecret = secrets.find(item => String(item.id) === snapshot.id);
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
      if (response.status === 401) {
        handleUnauthorized(sessionGeneration);
        return;
      }
      const result = await response.json();
      if (!isSecretSessionCurrent(sessionGeneration)) return;

      if (!response.ok) {
        throw new Error(result.message || result.error || t('coreHotpRejected'));
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

      const currentSecret = secrets.find(item => String(item.id) === snapshot.id);
      const currentCounter = currentSecret && currentSecret.counter !== undefined
        ? currentSecret.counter
        : 0;
      if (
        !matchesHOTPGenerationSnapshot(currentSecret, snapshot) ||
        (currentCounter !== snapshot.counter &&
          currentCounter !== snapshot.nextCounter)
      ) {
        throw new Error(t('coreKeyChanged'));
      }
    }

    async function commitReservedHOTPCounter(snapshot, sessionGeneration = secretSessionGeneration) {
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      const currentSecret = secrets.find(item => String(item.id) === snapshot.id);
      const currentCounter = currentSecret && currentSecret.counter !== undefined
        ? currentSecret.counter
        : 0;
      if (
        !matchesHOTPGenerationSnapshot(currentSecret, snapshot) ||
        (currentCounter !== snapshot.counter &&
          currentCounter !== snapshot.nextCounter)
      ) {
        throw new Error(t('coreKeyChanged'));
      }
      // 使 POST 期间启动的 GET 失效，再提交本地新 counter。
      secretLoadGeneration += 1;
      currentSecret.counter = snapshot.nextCounter;
      cacheSecretsLocally();
      const counterElement = document.getElementById('counter-' + snapshot.id);
      if (counterElement) counterElement.textContent = t('counterLabel') + snapshot.nextCounter;
      await updateOTP(snapshot.id, null, currentSecret);
    }

    function showOTPCopyFeedback(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      const serviceName = secret ? getSecretDisplayName(secret) : t('coreCode');
      
      showCenterToast('✅', t('coreCopiedService', { name: serviceName }));
    }

    async function copyNextOTP(secretId) {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      // 关闭所有打开的卡片菜单
      closeAllCardMenus();

      const nextOtpElement = document.getElementById('next-otp-' + secretId);
      if (!nextOtpElement) return;

      // 交接动画期间 flyer 仍在展示旧值，而节点已保存新的未来验证码。
      // 单次点击先结束过渡、露出节点中的未来值，再复制与画面一致的数字。
      if (
        typeof isNextOTPTransitionActive === 'function' &&
        isNextOTPTransitionActive(secretId)
      ) {
        if (typeof clearOTPAnimationTimer !== 'function') return;
        clearOTPAnimationTimer(nextOtpElement);
      }

      const nextOtpText = nextOtpElement.textContent;
      if (!isCopyableOTPValue(secretId, nextOtpText)) return;

      try {
        await navigator.clipboard.writeText(nextOtpText);
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        showNextOTPCopyFeedback(secretId);
      } catch (err) {
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        const textArea = document.createElement('textarea');
        textArea.value = nextOtpText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNextOTPCopyFeedback(secretId);
      }
    }

    function showNextOTPCopyFeedback(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      const serviceName = secret ? getSecretDisplayName(secret) : t('coreCode');

      showCenterToast('⏭️', t('coreCopiedNextService', { name: serviceName }));
    }

    function isCopyableOTPValue(secretId, value) {
      const secret = secrets.find(s => String(s.id) === String(secretId));
      const expectedLength = Number(secret && secret.digits) || 6;
      return typeof value === 'string' &&
        value.length === expectedLength &&
        /^[0-9]+$/.test(value);
    }

    // 复制验证器配置 URI（otpauth:// 格式，用于导入验证器）
    async function copyOTPAuthURL(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) {
        showCenterToast('❌', t('coreKeyMissing'));
        return;
      }

      try {
        // 构建标签
        const serviceName = getSecretDisplayName(secret).trim();
        const accountName = secret.account ? secret.account.trim() : '';
        let label;
        if (accountName) {
          label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
        } else {
          label = encodeURIComponent(serviceName);
        }

        // 根据类型构建不同的参数
        const type = secret.type || 'TOTP';
        let params;

        switch (type.toUpperCase()) {
          case 'HOTP':
            params = new URLSearchParams({
              secret: secret.secret.toUpperCase(),
              issuer: serviceName,
              algorithm: secret.algorithm || 'SHA1',
              digits: (secret.digits || 6).toString(),
              counter: (secret.counter || 0).toString()
            });
            break;
          case 'TOTP':
          default:
            params = new URLSearchParams({
              secret: secret.secret.toUpperCase(),
              issuer: serviceName,
              algorithm: secret.algorithm || 'SHA1',
              digits: (secret.digits || 6).toString(),
              period: (secret.period || 30).toString()
            });
            break;
        }

        // 根据类型选择正确的scheme
        const scheme = type.toUpperCase() === 'HOTP' ? 'hotp' : 'totp';
        const otpauthURL = 'otpauth://' + scheme + '/' + label + '?' + params.toString();

        // 复制到剪贴板
        await navigator.clipboard.writeText(otpauthURL);
        showCenterToast('🔗', t('coreCopiedUriService', { name: getSecretDisplayName(secret) }));
      } catch (err) {
        console.error('复制验证器 URI 失败:', err);
        showCenterToast('❌', t('coreCopyUriFailed') + err.message);
      }
    }

    // 复制当前站点的验证码页面链接，保留影响 OTP 生成的非默认参数。
    async function copyOTPPageURL(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) {
        showCenterToast('❌', t('coreKeyMissing'));
        return;
      }

      try {
        const url = new URL('/otp/' + encodeURIComponent(secret.secret.toUpperCase()), window.location.origin);
        const type = (secret.type || 'TOTP').toUpperCase();
        const digits = Number(secret.digits) || 6;
        const algorithm = (secret.algorithm || 'SHA1').toUpperCase();

        if (type === 'HOTP') {
          url.searchParams.set('type', 'HOTP');
          url.searchParams.set('counter', String(secret.counter ?? 0));
        } else {
          const period = Number(secret.period) || 30;
          if (period !== 30) url.searchParams.set('period', String(period));
        }
        if (digits !== 6) url.searchParams.set('digits', String(digits));
        if (algorithm !== 'SHA1') url.searchParams.set('algorithm', algorithm);

        await navigator.clipboard.writeText(url.toString());
        showCenterToast('🔗', t('coreCopiedLinkService', { name: getSecretDisplayName(secret) }));
      } catch (err) {
        console.error('复制验证码链接失败:', err);
        showCenterToast('❌', t('coreCopyLinkFailed') + err.message);
      }
    }

    // 切换卡片菜单
    function toggleCardMenu(secretId) {
      const dropdown = document.getElementById('menu-' + secretId);
      if (!dropdown) return;
      
      document.querySelectorAll('.card-menu-dropdown').forEach(menu => {
        if (menu.id !== 'menu-' + secretId) {
          menu.classList.remove('show');
          updateCardMenuTrigger(menu);
        }
      });
      
      dropdown.classList.toggle('show');
      updateCardMenuTrigger(dropdown);
      if (dropdown.classList.contains('show')) {
        const firstAction = getEnabledCardMenuActions(dropdown)[0];
        if (firstAction) firstAction.focus();
      }
    }

    function updateCardMenuTrigger(menu) {
      const trigger = document.querySelector('[aria-controls="' + menu.id + '"]');
      if (trigger) trigger.setAttribute('aria-expanded', String(menu.classList.contains('show')));
    }
    
    function closeAllCardMenus() {
      document.querySelectorAll('.card-menu-dropdown').forEach(menu => {
        menu.classList.remove('show');
        updateCardMenuTrigger(menu);
      });
    }

    function isVisibleCardElement(element) {
      if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.visibility !== 'collapse';
    }

    function getEnabledCardMenuActions(menu) {
      return Array.from(menu.querySelectorAll('.menu-item')).filter(action =>
        !action.disabled && action.getAttribute('aria-disabled') !== 'true' && isVisibleCardElement(action)
      );
    }

    // Use rendered positions so navigation follows responsive grids and service groups.
    function getAdjacentSecretCard(card, key) {
      const origin = card.getBoundingClientRect();
      const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
      let nearest = null;
      let nearestDistance = Infinity;
      let nearestOffset = Infinity;

      document.querySelectorAll('.secret-card').forEach(candidate => {
        if (candidate === card || !isVisibleCardElement(candidate)) return;
        const rect = candidate.getBoundingClientRect();
        // Left/right stay in the current row; up/down can cross group boundaries.
        if (horizontal && Math.min(origin.bottom, rect.bottom) <= Math.max(origin.top, rect.top)) return;
        const distance = key === 'ArrowLeft' ? origin.left - rect.right :
          key === 'ArrowRight' ? rect.left - origin.right :
          key === 'ArrowUp' ? origin.top - rect.bottom : rect.top - origin.bottom;
        if (distance < -1) return;
        const offset = horizontal
          ? Math.abs((rect.top + rect.bottom) - (origin.top + origin.bottom))
          : Math.abs((rect.left + rect.right) - (origin.left + origin.right));
        if (distance < nearestDistance - 1 || (Math.abs(distance - nearestDistance) <= 1 && offset < nearestOffset)) {
          nearest = candidate;
          nearestDistance = distance;
          nearestOffset = offset;
        }
      });
      return nearest;
    }

    function handleCardArrowKey(event) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
      const target = event.target;
      if (!target || typeof target.closest !== 'function' ||
          target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return false;

      const card = target.closest('.secret-card');
      if (!isVisibleCardElement(card)) return false;
      const menuItem = target.closest('.menu-item');
      const menu = menuItem && menuItem.closest('.card-menu-dropdown.show');
      const control = target.closest('.otp-code, .otp-next-container, .card-menu-trigger');
      if (!menu && !control) return false;

      // Consume the boundary arrows too, keeping keyboard navigation from scrolling the page.
      event.preventDefault();
      if (menu && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const actions = getEnabledCardMenuActions(menu);
        const index = actions.indexOf(menuItem);
        const nextIndex = event.key === 'ArrowDown' ? (index + 1) % actions.length :
          (index < 0 ? actions.length - 1 : (index + actions.length - 1) % actions.length);
        if (actions[nextIndex]) actions[nextIndex].focus();
        return true;
      }

      const nextCard = getAdjacentSecretCard(card, event.key);
      const selector = menu || control.classList.contains('card-menu-trigger') ? '.card-menu-trigger' :
        control.classList.contains('otp-next-container') ? '.otp-next-container' : '.otp-code';
      closeAllCardMenus();
      if (nextCard || menu) {
        const destination = nextCard || card;
        let nextControl = destination.querySelector(selector);
        if (!nextControl || nextControl.disabled || !isVisibleCardElement(nextControl)) {
          nextControl = destination.querySelector('.otp-code');
        }
        if (nextControl && !nextControl.disabled && isVisibleCardElement(nextControl)) nextControl.focus();
      }
      return true;
    }

    document.addEventListener('click', function(event) {
      if (!event.target.closest('.card-menu')) {
        closeAllCardMenus();
      }
    });


    // 编辑密钥
    function editSecret(id) {
      const secret = secrets.find(s => s.id === id);
      if (!secret) return;
      showSecretModal(() => fillSecretForm(id, secret));
    }

    // Reopen an offline add/edit the server rejected. Saving it replaces the
    // stopped queue entry, so its content is never lost to a cancellation.
    function showQueuedSecretEditor(detail) {
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
    
    async function deleteSecret(id) {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return;
      const secret = secrets.find(s => s.id === id);
      if (!secret) return;

      const displayName = getSecretDisplayName(secret);
      const confirmed = await showConfirmDialog({
        i18n: { title: 'deleteSecretTitle', message: 'deleteSecretConfirm', confirmText: 'delete', cancelText: 'cancel', params: { name: displayName } },
        title: t('deleteSecretTitle'),
        message: t('deleteSecretConfirm', { name: displayName }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed || !isSecretSessionCurrent(sessionGeneration)) {
        return;
      }

      // 🔒 删除操作也使用队列，避免与编辑操作产生竞态条件
      saveQueue = saveQueue.then(async () => {
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        try {
          console.log('🗑️ [保存队列] 提交删除请求:', secret.name);

          // Ids may contain / % ? #; the server decodes the last path segment.
          const response = await authenticatedFetch('/api/secrets/' + encodeURIComponent(id), {
            method: 'DELETE'
          });
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          if (response.status === 401) {
            handleUnauthorized(sessionGeneration);
            return;
          }

          if (response.ok) {
            const result = await response.json();
            if (!isSecretSessionCurrent(sessionGeneration)) return;

            // 检查是否为离线排队响应
            if (result.queued && result.offline) {
              console.log('📥 [离线模式] 删除操作已排队，等待同步:', result.operationId);
              showCenterToast('📥', t('coreQueued'));

              // 离线模式下，暂时不更新本地状态，等待同步完成后由 PWA 模块刷新
              return;
            }

            // 正常在线响应，立即删除本地数据
            const cached = commitSecretListChange(secrets.filter(s => s.id !== id), sessionGeneration);
            await renderSecrets();
            if (!isSecretSessionCurrent(sessionGeneration)) return;
            if (!cached) showCenterToast('⚠️', t('coreDeletedNoCache'));

            if (otpIntervals[id]) {
              clearInterval(otpIntervals[id]);
              delete otpIntervals[id];
            }

            console.log('✅ [保存队列] 删除成功:', secret.name);
          } else {
            showCenterToast('❌', t('coreDeleteRetry'));
          }
        } catch (error) {
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          console.error('❌ [保存队列] 删除失败:', error);
          showCenterToast('❌', t('coreDeleteFailed') + error.message);
        }
      }).catch(err => {
        if (!isSecretSessionCurrent(sessionGeneration)) return;
        console.error('❌ [保存队列] 队列执行错误:', err);
      });
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
      saveQueue = saveQueue.then(async () => {
        if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
        try {
          if (!(await claimStoppedQueuedChange(submission, ownsDialog))) return;
          if (!isSecretSessionCurrent(submission.sessionGeneration)) return;
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

            await renderSecrets();
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


    // 键盘快捷键
    document.addEventListener('keydown', function(e) {
      if (handleCardArrowKey(e)) return;
      if (e.key === 'Escape') {
        const openCardMenu = document.querySelector('.card-menu-dropdown.show');
        if (openCardMenu) {
          const trigger = document.querySelector('[aria-controls="' + openCardMenu.id + '"]');
          closeAllCardMenus();
          if (trigger) trigger.focus();
          return;
        }
        hideSecretModal();
        hideQRModal();
        hideQRScanner();
        hideImportModal();
      }
      
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        debugMode = !debugMode;
        console.log('Debug mode ' + (debugMode ? 'enabled' : 'disabled'));
        
        showCenterToast('ℹ️', t('coreDebug') + (debugMode ? t('coreEnabled') : t('coreDisabled')));

      }
      
      if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        console.log('Manually refreshing all OTP codes');
        if (typeof updateOTPSecretsInBatch === 'function') {
          updateOTPSecretsInBatch(secrets, { includeHOTP: true });
        } else {
          secrets.forEach(secret => {
            updateOTP(secret.id, null, secret);
          });
        }
        
        showCenterToast('ℹ️', t('coreCodesRefreshed'));

      }
    });

    // 页面卸载时清理定时器
    window.addEventListener('beforeunload', function() {
      Object.values(otpIntervals).forEach(interval => {
        clearInterval(interval);
      });
    });

    // 🛡️ 安全机制：定期检查所有验证码是否需要更新
    // 防止定时器失效导致验证码过期
    // 每5秒检查一次（不会影响性能）
    setInterval(() => {
      if (document.hidden) {
        // 如果页面在后台，跳过检查（节省资源）
        return;
      }

      const currentTime = Math.floor(getCorrectedNowMs() / 1000);
      
      secrets.forEach(secret => {
        // 只检查TOTP类型
        if (secret.type && secret.type.toUpperCase() === 'HOTP') {
          return;
        }

        const otpElement = document.getElementById('otp-' + secret.id);
        if (!otpElement) return;

        // 检查验证码是否为默认值（未初始化或更新失败）
        if (otpElement.textContent === '------') {
          console.warn('⚠️  [安全检查] 发现未初始化的验证码:', secret.name);
          updateOTP(secret.id, null, secret);
          return;
        }

        // 检查当前时间窗口，判断验证码是否应该更新
        const timeStep = secret.period || 30;
        const currentWindow = Math.floor(currentTime / timeStep);
        
        // 在时间窗口刚切换时（前3秒），强制刷新验证码
        const secondsInWindow = currentTime % timeStep;
        if (secondsInWindow <= 2) {
          // 避免重复刷新：检查上次刷新时间
          const lastRefreshKey = 'lastRefresh-' + secret.id;
          const lastRefreshWindow = window[lastRefreshKey];
          
          if (lastRefreshWindow !== currentWindow) {
            console.log('🔄 [安全检查] 时间窗口已切换，刷新验证码:', secret.name, '窗口:', currentWindow);
            window[lastRefreshKey] = currentWindow;
            // 共享窗口调度器负责可见卡片的统一刷新；仅在其不可用时走单卡兜底。
            if (typeof isOTPWindowScheduled !== 'function' || !isOTPWindowScheduled(secret.id)) {
              updateOTP(secret.id, null, secret);
            }
          }
        }
      });
    }, 5000); // 每5秒检查一次
`;
}
