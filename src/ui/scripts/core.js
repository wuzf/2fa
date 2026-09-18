import { dialogIcon } from '../dialogIcons.js'; /**
 * Core 核心业务逻辑模块
 * 包含密钥管理、OTP生成、二维码、备份等所有核心功能
 */

import { SERVICE_LOGOS } from '../config/serviceLogos.js';

/**
 * 获取 Core 相关代码
 * @returns {string} Core JavaScript 代码
 */
export function getCoreCode() {
	const serviceLogosJSON = JSON.stringify(SERVICE_LOGOS, null, 2);

	return `    // ========== Service Logos 配置 ==========
    // 服务名称到域名的映射数据（从 serviceLogos.js 导入）
    const SERVICE_LOGOS = ${serviceLogosJSON};

    // ========== Service Logo 处理逻辑（唯一实现） ==========
    // 注意：逻辑只在客户端实现，服务器端的 serviceLogos.js 只是纯数据配置
    const hotpCopyLocks = new Map();
    const SECRETS_CACHE_KEY = '2fa-secrets-cache';

    function cacheSecretsLocally() {
      try {
        localStorage.setItem(SECRETS_CACHE_KEY, JSON.stringify({
          data: secrets,
          timestamp: Date.now()
        }));
        return true;
      } catch (error) {
        console.warn('缓存数据失败:', error);
        return false;
      }
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

    // 加载密钥列表
    async function loadSecrets() {
      const loadGeneration = ++secretLoadGeneration;
      try {
        await ensureServerTimeSynchronized();
        const response = await authenticatedFetch('/api/secrets');

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error('加载失败: ' + response.statusText);
        }

        const loadedSecrets = await response.json();
        if (loadGeneration !== secretLoadGeneration) return;
        secrets = loadedSecrets;

        // 成功获取数据后，保存到 localStorage 作为缓存
        cacheSecretsLocally();

        await renderSecrets();
      } catch (error) {
        if (loadGeneration !== secretLoadGeneration) return;
        console.error('加载密钥失败:', error);

        // 尝试从缓存中读取数据
        try {
          const cached = localStorage.getItem(SECRETS_CACHE_KEY);
          if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            secrets = data;

            // 显示缓存数据
            await renderSecrets();

            // 提示用户正在使用缓存数据
            const cacheTime = new Date(timestamp).toLocaleString('zh-CN');
            showCenterToast('💾', '网络异常，显示缓存数据（' + cacheTime + '）');

            console.log('使用缓存数据，缓存时间:', cacheTime);
            return;
          }
        } catch (e) {
          console.warn('读取缓存失败:', e);
        }

        // 既没有网络数据也没有缓存数据，显示空状态
        document.getElementById('loading').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
      }
    }

    // 渲染密钥列表
    async function renderSecrets() {
      filteredSecrets = [...secrets];
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value.trim()) {
        filterSecrets(searchInput.value);
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

    // 创建密钥卡片
    function createSecretCard(secret) {
      const logoUrl = getServiceLogo(secret.name);
      const isHOTP = secret.type && secret.type.toUpperCase() === 'HOTP';
      // These values are used in both text content and quoted tooltip attributes.
      const nameHTML = escapeHTML(secret.name).replace(/"/g, '&quot;');
      const accountHTML = escapeHTML(secret.account || '').replace(/"/g, '&quot;');

      return '<div class="secret-card" onclick="copyOTPFromCard(event, &quot;' + secret.id + '&quot;)" title="点击卡片复制验证码">' +
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
                '<span style="display: none;">' + escapeHTML(secret.name.charAt(0).toUpperCase()) + '</span>' :
                '<span>' + escapeHTML(secret.name.charAt(0).toUpperCase()) + '</span>'
              ) +
            '</div>' +
            '<div class="secret-text">' +
            '<h3><span class="secret-name" title="' + nameHTML + '">' + nameHTML + '</span>' + (isHOTP ? '<span class="secret-type">[HOTP]</span>' : '') + '</h3>' +
            (secret.account ? '<p title="' + accountHTML + '">' + accountHTML + '</p>' : '') +
            (isHOTP ? '<p id="counter-' + secret.id + '" style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">计数器: ' + (secret.counter ?? 0) + '</p>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card-menu" title="">' +
            '<button type="button" class="card-menu-trigger" title="账户操作" aria-label="账户操作" aria-expanded="false" aria-controls="menu-' + secret.id + '" onclick="event.stopPropagation(); toggleCardMenu(&quot;' + secret.id + '&quot;)"><span class="menu-dots" aria-hidden="true">⋮</span></button>' +
            '<div class="card-menu-dropdown" id="menu-' + secret.id + '">' +
              '<button type="button" class="menu-item" title="显示验证器二维码" onclick="event.stopPropagation(); showQRCode(&quot;' + secret.id + '&quot;); closeAllCardMenus();">二维码</button>' +
              '<button type="button" class="menu-item" title="用于导入验证器的 otpauth:// 配置" onclick="event.stopPropagation(); copyOTPAuthURL(&quot;' + secret.id + '&quot;); closeAllCardMenus();">复制 URI</button>' +
              '<button type="button" class="menu-item" title="在浏览器中打开并查看验证码" onclick="event.stopPropagation(); copyOTPPageURL(&quot;' + secret.id + '&quot;); closeAllCardMenus();">复制链接</button>' +
              '<button type="button" class="menu-item" title="编辑密钥" onclick="event.stopPropagation(); editSecret(&quot;' + secret.id + '&quot;); closeAllCardMenus();">编辑</button>' +
              '<button type="button" class="menu-item menu-item-danger" title="删除密钥" onclick="event.stopPropagation(); deleteSecret(&quot;' + secret.id + '&quot;); closeAllCardMenus();">删除</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="otp-preview">' +
          '<div class="otp-main">' +
            '<div class="otp-code-container">' +
              '<button type="button" class="otp-code" id="otp-' + secret.id + '" onclick="event.stopPropagation(); copyOTP(&quot;' + secret.id + '&quot;)" title="点击复制验证码" aria-label="复制当前验证码">------</button>' +
            '</div>' +
            // HOTP 不显示"下一个"验证码（因为不是时间基准）
            (isHOTP ? '' :
              '<button type="button" class="otp-next-container" onclick="event.stopPropagation(); copyNextOTP(&quot;' + secret.id + '&quot;)" title="点击复制下一个验证码">' +
                '<span class="otp-next-label">下一个</span>' +
                '<span class="otp-next-code" id="next-otp-' + secret.id + '">------</span>' +
              '</button>'
            ) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function createServiceGroupSection(group, index) {
      const headingId = 'service-group-heading-' + index;
      const hasFilteredCount = Boolean(currentSearchQuery) && group.matchedCount !== group.totalCount;
      const countText = hasFilteredCount
        ? group.matchedCount + ' / ' + group.totalCount
        : group.totalCount + ' 个';
      const countLabel = hasFilteredCount
        ? '匹配 ' + group.matchedCount + ' 个，共 ' + group.totalCount + ' 个'
        : '共 ' + group.totalCount + ' 个';

      return '<section class="service-group" aria-labelledby="' + headingId + '">' +
        '<div class="service-group-header">' +
          '<h2 class="service-group-title" id="' + headingId + '">' + escapeHTML(group.name) + '</h2>' +
          '<span class="service-group-count" aria-label="' + escapeHTML(countLabel) + '">' + countText + '</span>' +
        '</div>' +
        '<div class="service-group-grid">' + group.items.map(secret => createSecretCard(secret)).join('') + '</div>' +
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
          '<h3>未找到匹配的密钥</h3>' +
          '<p>尝试使用不同的关键字搜索</p>' +
          '<button type="button" class="workspace-action" onclick="clearSearch()">清除搜索</button>';
        emptyState.style.display = 'block';
        return;
      }

      if (secrets.length === 0) {
        clearOTPIntervalsExcept([]);
        secretsList.innerHTML = '';
        secretsList.style.display = 'none';
        emptyState.innerHTML =
          '<div class="icon" aria-hidden="true">${dialogIcon('key')}</div>' +
          '<h3>还没有密钥</h3>' +
          '<p>添加账户的两步验证密钥，在这里获取验证码</p>' +
          '<button type="button" class="workspace-action" onclick="showAddModal()">添加密钥</button>';
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
        secretsList.innerHTML = serviceGroups.map((group, index) => createServiceGroupSection(group, index)).join('');
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

      if (renderGeneration !== secretRenderGeneration) return;

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
        showOTPCopyFeedback(secretId);
      } catch (err) {
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
      const lockKey = String(secretId);
      const existing = hotpCopyLocks.get(lockKey);
      if (existing) return existing;

      // 等待更早的编辑/删除完成后再读取并复制，保证验证码与随后推进的 counter 属于同一快照。
      const operation = saveQueue
        .then(() => performHOTPCopyAndAdvance(secretId))
        .catch(async error => {
          console.error('HOTP 计数器更新失败:', error);
          try {
            await loadSecrets();
          } catch (reconcileError) {
            console.warn('重新加载 HOTP 计数器失败:', reconcileError);
          }
          const message = error.hotpCopied
            ? '验证码已复制，但本地计数器同步失败：'
            : '验证码未复制，计数器状态已重新对账：';
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

    async function performHOTPCopyAndAdvance(secretId) {
      const secret = secrets.find(item => String(item.id) === String(secretId));
      const snapshot = getHOTPGenerationSnapshot(secret);
      if (!snapshot) {
        showCenterToast('⚠️', 'HOTP 计数器无效或已达到上限');
        return false;
      }

      const otpElement = document.getElementById('otp-' + secretId);
      if (!otpElement) return false;

      // 被批次替换的更新也会 resolve；必须同步确认节点实际提交了当前 counter 的验证码。
      const otpText = getCommittedHOTPToken(secretId, secret);
      if (!otpText) {
        // 恢复计算失败或被取消的 HOTP；本次不等待计算后自动复制，避免丢失用户激活。
        updateOTP(secretId, null, secret).catch(error => console.warn('刷新 HOTP 失败:', error));
        showCenterToast('⏳', '验证码正在更新，请稍后重试');
        return false;
      }
      if (navigator.onLine === false) {
        showCenterToast('⚠️', '离线状态下无法安全复制 HOTP 验证码');
        return false;
      }

      // 本地校验通过并即将预留；更早开始的 GET 不得在复制后回写旧状态。
      secretLoadGeneration += 1;
      // 剪贴板调用必须在用户激活仍有效时启动；与服务端预留并发，避免网络 await 后权限失效。
      const clipboardOperation = copyHOTPText(otpText);
      const reservationOperation = reserveHOTPCounter(snapshot);
      const [clipboardResult, reservationResult] = await Promise.allSettled([
        clipboardOperation,
        reservationOperation
      ]);
      const copied = clipboardResult.status === 'fulfilled' && clipboardResult.value === true;
      if (reservationResult.status === 'rejected') {
        const reservationError = reservationResult.reason instanceof Error
          ? reservationResult.reason
          : new Error(String(reservationResult.reason));
        reservationError.hotpCopied = copied;
        throw reservationError;
      }

      try {
        await commitReservedHOTPCounter(snapshot);
      } catch (error) {
        error.hotpCopied = copied;
        throw error;
      }

      if (!copied) {
        showCenterToast('⚠️', '复制失败，HOTP 计数器已安全推进，请使用新验证码重试');
        return false;
      }

      showOTPCopyFeedback(secretId);
      return true;
    }

    async function copyHOTPText(otpText) {
      try {
        await navigator.clipboard.writeText(otpText);
        return true;
      } catch (clipboardError) {
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

    async function reserveHOTPCounter(snapshot) {
      const queuedSecret = secrets.find(item => String(item.id) === snapshot.id);
      const queuedCounter = queuedSecret && queuedSecret.counter !== undefined
        ? queuedSecret.counter
        : 0;
      if (
        !matchesHOTPGenerationSnapshot(queuedSecret, snapshot) ||
        queuedCounter !== snapshot.counter
      ) {
        throw new Error('密钥已发生变化，已取消旧验证码的计数器更新');
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
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || '服务器拒绝更新计数器');
      }

      const queuedOffline = result.queued === true && result.offline === true;
      if (queuedOffline) {
        throw new Error('离线状态下无法安全推进 HOTP 计数器');
      }
      const responseSecret = result.data && result.data.secret;
      if (
        (!matchesHOTPGenerationSnapshot(responseSecret, snapshot) ||
          responseSecret.counter !== snapshot.nextCounter)
      ) {
        throw new Error('服务器返回了无效的计数器状态');
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
        throw new Error('密钥状态已更新，请刷新后重试');
      }
    }

    async function commitReservedHOTPCounter(snapshot) {
      const currentSecret = secrets.find(item => String(item.id) === snapshot.id);
      const currentCounter = currentSecret && currentSecret.counter !== undefined
        ? currentSecret.counter
        : 0;
      if (
        !matchesHOTPGenerationSnapshot(currentSecret, snapshot) ||
        (currentCounter !== snapshot.counter &&
          currentCounter !== snapshot.nextCounter)
      ) {
        throw new Error('密钥状态已更新，请刷新后重试');
      }
      // 使 POST 期间启动的 GET 失效，再提交本地新 counter。
      secretLoadGeneration += 1;
      currentSecret.counter = snapshot.nextCounter;
      cacheSecretsLocally();
      const counterElement = document.getElementById('counter-' + snapshot.id);
      if (counterElement) counterElement.textContent = '计数器: ' + snapshot.nextCounter;
      await updateOTP(snapshot.id, null, currentSecret);
    }

    function showOTPCopyFeedback(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      const serviceName = secret ? secret.name : '验证码';
      
      showCenterToast('✅', serviceName + ' 验证码已复制到剪贴板');
    }

    async function copyNextOTP(secretId) {
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
        showNextOTPCopyFeedback(secretId);
      } catch (err) {
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
      const serviceName = secret ? secret.name : '验证码';

      showCenterToast('⏭️', serviceName + ' 下一个验证码已复制到剪贴板');
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
        showCenterToast('❌', '未找到密钥');
        return;
      }

      try {
        // 构建标签
        const serviceName = secret.name.trim();
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
        showCenterToast('🔗', secret.name + ' 验证器 URI 已复制到剪贴板');
      } catch (err) {
        console.error('复制验证器 URI 失败:', err);
        showCenterToast('❌', '复制验证器 URI 失败: ' + err.message);
      }
    }

    // 复制当前站点的验证码页面链接，保留影响 OTP 生成的非默认参数。
    async function copyOTPPageURL(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) {
        showCenterToast('❌', '未找到密钥');
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
        showCenterToast('🔗', secret.name + ' 验证码链接已复制到剪贴板');
      } catch (err) {
        console.error('复制验证码链接失败:', err);
        showCenterToast('❌', '复制验证码链接失败: ' + err.message);
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
      
      editingId = id;
      document.getElementById('modalTitle').textContent = '编辑密钥';
      document.getElementById('submitBtn').textContent = '更新';
      document.getElementById('secretId').value = id;
      document.getElementById('secretName').value = secret.name;
      document.getElementById('secretService').value = secret.account || '';
      document.getElementById('secretKey').value = secret.secret;
      
      // 填充高级参数
      document.getElementById('secretType').value = secret.type || 'TOTP';
      document.getElementById('secretDigits').value = secret.digits || 6;
      document.getElementById('secretPeriod').value = secret.period || 30;
      document.getElementById('secretAlgorithm').value = secret.algorithm || 'SHA1';
      document.getElementById('secretCounter').value = secret.counter || 0;
      
      // 如果有非默认的高级参数，显示高级选项
      const hasAdvancedOptions = (secret.type && secret.type !== 'TOTP') ||
                                (secret.digits && secret.digits !== 6) || 
                                (secret.period && secret.period !== 30) || 
                                (secret.algorithm && secret.algorithm !== 'SHA1') ||
                                (secret.counter && secret.counter !== 0);
      
      const checkbox = document.getElementById('showAdvanced');
      if (hasAdvancedOptions) {
        checkbox.checked = true;
        toggleAdvancedOptions();
      } else {
        checkbox.checked = false;
        toggleAdvancedOptions();
      }
      
      const modal = document.getElementById('secretModal');
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);
      disableBodyScroll();
    }
    
    async function deleteSecret(id) {
      const secret = secrets.find(s => s.id === id);
      if (!secret) return;

      const confirmed = await showConfirmDialog({
        title: '删除密钥',
        message: '确定要删除 "' + secret.name + '" 吗？\\n该操作无法撤销。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      });
      if (!confirmed) {
        return;
      }

      // 🔒 删除操作也使用队列，避免与编辑操作产生竞态条件
      saveQueue = saveQueue.then(async () => {
        try {
          console.log('🗑️ [保存队列] 提交删除请求:', secret.name);

          const response = await authenticatedFetch('/api/secrets/' + id, {
            method: 'DELETE'
          });

          if (response.ok) {
            const result = await response.json();

            // 检查是否为离线排队响应
            if (result.queued && result.offline) {
              console.log('📥 [离线模式] 删除操作已排队，等待同步:', result.operationId);
              showCenterToast('📥', result.message || '操作已保存，网络恢复后自动同步');

              // 离线模式下，暂时不更新本地状态，等待同步完成后由 PWA 模块刷新
              return;
            }

            // 正常在线响应，立即删除本地数据
            secrets = secrets.filter(s => s.id !== id);
            await renderSecrets();

            if (otpIntervals[id]) {
              clearInterval(otpIntervals[id]);
              delete otpIntervals[id];
            }

            console.log('✅ [保存队列] 删除成功:', secret.name);
          } else {
            showCenterToast('❌', '删除失败，请重试');
          }
        } catch (error) {
          console.error('❌ [保存队列] 删除失败:', error);
          showCenterToast('❌', '删除失败：' + error.message);
        }
      }).catch(err => {
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
    
    async function handleSubmit(event) {
      event.preventDefault();

      const name = document.getElementById('secretName').value.trim();
      const account = document.getElementById('secretService').value.trim();
      const secret = document.getElementById('secretKey').value.trim().toUpperCase();

      // 获取高级参数
      const type = document.getElementById('secretType').value || 'TOTP';
      const digits = parseInt(document.getElementById('secretDigits').value) || 6;
      const period = parseInt(document.getElementById('secretPeriod').value) || 30;
      const algorithm = document.getElementById('secretAlgorithm').value || 'SHA1';
      const counterValue = document.getElementById('secretCounter').value;
      const counter = counterValue === '' ? 0 : Number(counterValue);

      if (!name || !secret) {
        showCenterToast('❌', '请填写服务名称和密钥');
        return;
      }
      if (
        type.toUpperCase() === 'HOTP' &&
        (!Number.isSafeInteger(counter) || counter < 0)
      ) {
        showCenterToast('❌', 'HOTP 计数器必须是 0 到 9007199254740991 之间的整数');
        return;
      }

      const submitBtn = document.getElementById('submitBtn');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = '保存中...';
      submitBtn.disabled = true;

      // 🔒 关键修复：使用队列确保保存操作串行执行，避免并发覆盖
      // 当快速连续编辑多个密钥时，后端的读-修改-写操作会产生race condition
      // 通过Promise链式调用，确保前一个保存完成后再执行下一个
      saveQueue = saveQueue.then(async () => {
        try {
          let response;
          const data = {
            name,
            account: account,
            secret,
            type,
            digits,
            period,
            algorithm,
            counter
          };

          const action = editingId ? '更新' : '新增';
          console.log('🔄 [保存队列] 提交保存请求:', action, name, { period, digits, algorithm });

          if (editingId) {
            response = await authenticatedFetch('/api/secrets/' + editingId, {
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

          if (response.ok) {
            const result = await response.json();

            // 检查是否为离线排队响应
            if (result.queued && result.offline) {
              console.log('📥 [离线模式] 操作已排队，等待同步:', result.operationId);
              showCenterToast('📥', result.message || '操作已保存，网络恢复后自动同步');

              // 离线模式下，暂时不更新本地状态，等待同步完成后由 PWA 模块刷新
              hideSecretModal();
              return;
            }

            // 正常在线响应，更新本地状态
            console.log('✅ [保存队列] 保存成功:', result.data ? result.data.secret.name : result.name, '- period:', result.data ? result.data.secret.period : result.period);

            if (editingId) {
              const index = secrets.findIndex(s => s.id === editingId);
              if (index !== -1) {
                secrets[index] = result.data ? result.data.secret : result;
                console.log('✅ [本地更新] 密钥已更新:', secrets[index].name, '- period:', secrets[index].period);
              }
            } else {
              secrets.push(result.data ? result.data.secret : result);
            }

            await renderSecrets();
            hideSecretModal();
          } else {
            const error = await response.json();
            const errorMessage = error.message || error.error || '保存失败，请重试';
            showCenterToast('❌', errorMessage);
          }
        } catch (error) {
          console.error('❌ [保存队列] 保存失败:', error);
          showCenterToast('❌', '保存失败：' + error.message);
        } finally {
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }
      }).catch(err => {
        // 队列执行失败的最终兜底
        console.error('❌ [保存队列] 队列执行错误:', err);
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      });
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
        
        showCenterToast('ℹ️', '调试模式: ' + (debugMode ? '开启' : '关闭'));

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
        
        showCenterToast('ℹ️', '已手动刷新所有验证码');

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
