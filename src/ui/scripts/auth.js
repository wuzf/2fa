import { serverMessages, getServerTranslations } from '../../utils/server-messages.js';

/**
 * 认证模块
 * 包含认证相关函数
 */

/**
 * 获取认证相关代码
 * @returns {string} 认证 JavaScript 代码
 */
export function getAuthCode() {
	// Only authentication/settings diagnostics need to remain live while these
	// forms are open. Do not ship unrelated server messages to the browser.
	const messages = serverMessages.filter(([source]) =>
		/密码|登录|^备份保留数量|^默认导出格式|^语言偏好|^保存设置|^读取设置|^获取设置|^请求过于频繁|^您的请求次数过多|^身份验证失败|^认证失败|^服务器内部错误|^请先完成首次设置|^服务器未配置 KV|^未提供认证凭证|^JWT|^\{0\}天$/.test(
			source,
		),
	);
	const translatedMessages = messages.map(getServerTranslations);
	const messagePatterns = translatedMessages.flatMap((translations, messageIndex) =>
		Object.values(translations).map((template) => {
			const parameters = [...template.matchAll(/\{(\w+)\}/g)];
			let position = 0;
			let pattern = '^';
			const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			for (const parameter of parameters) {
				pattern +=
					escapePattern(template.slice(position, parameter.index)) + (translations['zh-CN'] === '{0}天' ? '(\\d+)' : '([\\s\\S]*?)');
				position = parameter.index + parameter[0].length;
			}
			pattern += escapePattern(template.slice(position)) + '$';
			return { pattern, parameters: parameters.map((parameter) => parameter[1]), messageIndex };
		}),
	);
	return `    // ========== 认证相关函数 ==========
    // 注意：现在使用 HttpOnly Cookie 存储 token，不再使用 localStorage
    let loginModalHideTimer = null;
    let loginAttemptGeneration = 0;
    let authRequestQueue = Promise.resolve();
    let authRefreshRequest = null;
    const AUTH_REQUEST_TIMEOUT_MS = 15000;
    let loginErrorState = null;
    const authMessages = ${JSON.stringify(translatedMessages).replace(/</g, '\\u003c')};
    const authMessagePatterns = ${JSON.stringify(messagePatterns)}.map(item => ({ ...item, regex: new RegExp(item.pattern) }));

    function localizeAuthMessage(message) {
      if (typeof message !== 'string') return message;
      const language = getLanguage();
      for (const entry of authMessagePatterns) {
        const match = entry.regex.exec(message);
        if (!match) continue;
        return (authMessages[entry.messageIndex][language] || authMessages[entry.messageIndex].en).replace(/\\{(\\w+)\\}/g, (_, key) => match[entry.parameters.indexOf(key) + 1] || '');
      }
      if (message.includes('; ')) return message.split('; ').map(localizeAuthMessage).join('; ');
      return message;
    }

    function languageRequestHeaders(headers = {}) {
      const result = {};
      if (Array.isArray(headers)) {
        headers.forEach(([name, value]) => { result[name] = value; });
      } else if (headers && typeof headers.forEach === 'function') {
        headers.forEach((value, name) => { result[name] = value; });
      } else {
        Object.assign(result, headers);
      }
      Object.keys(result).forEach(name => {
        if (name.toLowerCase() === 'x-language') delete result[name];
      });
      result['X-Language'] = getLanguage();
      return result;
    }

    function showLoginError(key, params = {}, serverMessage = '') {
      loginErrorState = { key, params, serverMessage };
      const error = document.getElementById('loginError');
      if (!error) return;
      error.textContent = serverMessage ? localizeAuthMessage(serverMessage) : t(key, params);
      error.style.display = 'block';
    }

    function refreshAuthLanguage() {
      const input = document.getElementById('loginToken');
      if (input) setLoginPasswordVisibility(input.type === 'text');
      if (loginErrorState) {
        const { key, params, serverMessage } = loginErrorState;
        showLoginError(key, params, serverMessage);
      }
    }

    function enqueueAuthenticationRequest(operation) {
      // Cookie-setting login/logout responses must settle in order, otherwise
      // an older logout can clear the Cookie just set by a newer login.
      const request = authRequestQueue.catch(() => {}).then(async () => {
        const controller = new AbortController();
        let timeoutId;
        const deadline = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            // Cancel the actual fetch before advancing the queue, so its late
            // response cannot apply a stale Cookie after a newer login/logout.
            controller.abort();
            reject(new Error(t('networkError')));
          }, AUTH_REQUEST_TIMEOUT_MS);
        });
        try {
          return await Promise.race([operation(controller.signal), deadline]);
        } finally {
          clearTimeout(timeoutId);
        }
      });
      authRequestQueue = request.catch(() => {});
      return request;
    }

    // 获取存储的令牌（已弃用 - Cookie 自动管理）
    function getAuthToken() {
      // Cookie 由浏览器自动管理，前端无需访问
      return null;
    }

    // 保存令牌（已弃用 - Cookie 自动设置）
    function saveAuthToken(token, expiresAt = null) {
      // HttpOnly Cookie 在服务端设置，前端无需操作
      // 保留此函数仅为向后兼容
    }

    // 清除令牌（已弃用 - Cookie 自动管理）
    function clearAuthToken() {
      // Cookie 由服务端管理（通过设置过期的 Cookie）
      // 前端无需手动清除
    }

    // 检查 token 是否即将过期（已弃用）
    function isTokenExpiringSoon() {
      // Cookie 过期由浏览器自动管理
      return false;
    }

    // 检查 token 是否已过期（已弃用）
    function isTokenExpired() {
      // Cookie 过期由浏览器自动管理
      return false;
    }

    // 刷新 Token
    async function refreshAuthToken() {
      const sessionGeneration = secretSessionGeneration;
      if (!isSecretSessionCurrent(sessionGeneration)) return false;
      // Several API responses can request renewal at once. One slow renewal
      // must not create a backlog in front of an explicit login or logout.
      if (authRefreshRequest) return authRefreshRequest;
      const pending = requestAuthTokenRefresh(sessionGeneration);
      authRefreshRequest = pending;
      try {
        return await pending;
      } finally {
        if (authRefreshRequest === pending) authRefreshRequest = null;
      }
    }

    async function requestAuthTokenRefresh(sessionGeneration) {
      // Token 由 Cookie 管理，刷新请求会自动携带 Cookie
      try {
        console.log('🔄 正在刷新 Token...');
        const result = await enqueueAuthenticationRequest(async signal => {
          if (!isSecretSessionCurrent(sessionGeneration)) return null;
          const response = await fetch('/api/refresh-token', {
            method: 'POST',
            credentials: 'include', // 🍪 自动携带 Cookie
            headers: languageRequestHeaders(),
            signal
          });
          return { response, data: response.ok ? await response.json() : null };
        });
        if (!isSecretSessionCurrent(sessionGeneration) || !result) return false;
        const { response, data } = result;

        if (response.ok) {
          if (data.success) {
            console.log('✅ Token 刷新成功');
            return true;
          }
        }

        console.warn('⚠️ Token 刷新失败');
        return false;
      } catch (error) {
        if (!isSecretSessionCurrent(sessionGeneration)) return false;
        console.error('Token 刷新错误:', error);
        return false;
      }
    }

    function setLoginPasswordVisibility(visible) {
      const tokenInput = document.getElementById('loginToken');
      const toggleButton = document.getElementById('loginPasswordToggle');

      if (!tokenInput || !toggleButton) {
        return;
      }

      tokenInput.type = visible ? 'text' : 'password';
      toggleButton.classList.toggle('is-visible', visible);
      toggleButton.setAttribute('aria-label', t(visible ? 'setupHidePassword' : 'setupShowPassword'));
      toggleButton.title = t(visible ? 'setupHidePassword' : 'setupShowPassword');
    }

    function toggleLoginPasswordVisibility() {
      const tokenInput = document.getElementById('loginToken');

      if (!tokenInput) {
        return;
      }

      setLoginPasswordVisibility(tokenInput.type === 'password');
    }

    // 检测是否处于无法保存 Secure Cookie 的不安全上下文（HTTP 且非本机地址）
    // 登录 Cookie 带有 Secure 属性，HTTP 访问时浏览器会拒绝保存，导致反复要求登录
    function isInsecureCookieContext() {
      if (typeof window.isSecureContext === 'boolean') {
        return !window.isSecureContext;
      }
      const localHosts = ['localhost', '127.0.0.1', '[::1]'];
      return location.protocol === 'http:' && !localHosts.includes(location.hostname);
    }

    // 显示登录模态框
    function showLoginModal() {
      const modal = document.getElementById('loginModal');
      const tokenInput = document.getElementById('loginToken');
      const errorDiv = document.getElementById('loginError');
      const insecureWarning = document.getElementById('loginInsecureWarning');

      if (!modal) {
        return;
      }

      if (insecureWarning) {
        insecureWarning.style.display = isInsecureCookieContext() ? 'block' : 'none';
      }

      if (loginModalHideTimer) {
        clearTimeout(loginModalHideTimer);
        loginModalHideTimer = null;
      }

      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('show'));

      loginErrorState = null;
      errorDiv.style.display = 'none';
      tokenInput.value = '';
      setLoginPasswordVisibility(false);

      setTimeout(() => tokenInput.focus(), 100);

      // 回车键提交由 <form> 原生 submit 事件处理（loginForm 的 onsubmit）
    }

    // 隐藏登录模态框
    function hideLoginModal() {
      const modal = document.getElementById('loginModal');
      if (!modal) {
        return;
      }

      if (loginModalHideTimer) {
        clearTimeout(loginModalHideTimer);
      }

      modal.classList.remove('show');
      loginModalHideTimer = setTimeout(() => {
        modal.style.display = 'none';
        loginModalHideTimer = null;
      }, 300);
    }

    // 处理登录提交
    async function handleLoginSubmit() {
      const tokenInput = document.getElementById('loginToken');
      const credential = tokenInput.value.trim();

      if (!credential) {
        showLoginError('loginPasswordRequired');
        return;
      }

      const attempt = ++loginAttemptGeneration;
      secretLoadGeneration += 1;
      // A current login is allowed to recover from an older operation's 401.
      // Logout and newer login attempts explicitly cancel this login intent.
      const isCurrentAttempt = () => attempt === loginAttemptGeneration;
      try {
        const result = await enqueueAuthenticationRequest(async signal => {
          if (!isCurrentAttempt()) return null;
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: languageRequestHeaders({
              'Content-Type': 'application/json'
            }),
            credentials: 'include', // 🍪 携带 Cookie
            body: JSON.stringify({ credential }),
            signal
          });
          return { response, data: await response.json() };
        });
        if (!isCurrentAttempt() || !result) return;
        const { response, data } = result;

        if (response.ok && data.success) {
          invalidateSecretSession({ blocked: false });
          markSecretAccessVerified();
          if (typeof resetLanguagePreferenceSync === 'function') resetLanguagePreferenceSync();
          if (typeof syncLanguagePreferenceAfterAuth === 'function') void syncLanguagePreferenceAfterAuth();
          // 登录成功 - token 已通过 HttpOnly Cookie 自动设置
          loginErrorState = null;
          hideLoginModal();

          // 显示登录成功信息（包含过期时间）
          if (data.expiresIn) {
            showCenterToast('✅', t('loginSuccessWithExpiry', { expiry: localizeAuthMessage(data.expiresIn) }));
          } else {
            showCenterToast('✅', t('loginSuccessToast'));
          }

          // 重新加载密钥列表
          loadSecrets();
          // Queue recovery is independent of login and must not delay access
          // while a service worker is starting or unavailable.
          if (typeof resumeOfflineQueueAfterLogin === 'function') {
            void resumeOfflineQueueAfterLogin();
          }
        } else {
          // 登录失败
          showLoginError('loginFailedRetry', {}, data.message);
          tokenInput.value = '';
          tokenInput.focus();
        }
      } catch (error) {
        if (!isCurrentAttempt()) return;
        console.error('登录失败:', error);
        showLoginError('networkError');
      }
    }

    // 检查认证状态
    function checkAuth() {
      // 🍪 Cookie 认证由服务器验证
      // 前端无法直接检查 HttpOnly Cookie
      // 如果 Cookie 无效，API 请求会返回 401，触发登录
      // 为了更好的用户体验，总是先尝试加载，让服务器决定
      return true;
    }
    
    // 定时检查 token 过期（每小时检查一次）
    // 启动 Token 过期检查（已弃用 - Cookie 自动管理）
    function startTokenExpiryCheck() {
      // HttpOnly Cookie 过期由浏览器自动管理
      // 保留此函数仅为向后兼容
    }

    // 处理未授权响应
    function handleUnauthorized(expectedSession = secretSessionGeneration) {
      if (!isSecretSessionCurrent(expectedSession)) return;
      const sessionGeneration = invalidateSecretSession();
      if (typeof resetLanguagePreferenceSync === 'function') resetLanguagePreferenceSync();
      clearAuthToken();
      if (typeof hideSecretModal === 'function') hideSecretModal();

      // 清除缓存的密钥数据（安全考虑）
      try {
        localStorage.removeItem('2fa-secrets-cache');
      } catch (e) {
        console.warn('清除缓存失败:', e);
      }

      try {
        Object.keys(otpIntervals || {}).forEach(secretId => {
          clearInterval(otpIntervals[secretId]);
          delete otpIntervals[secretId];
        });
      } catch (e) {
        console.warn('清除验证码定时器失败:', e);
      }

      if (typeof clearAllOTPAnimations === 'function') {
        clearAllOTPAnimations();
      }
      if (typeof clearOTPWindowScheduler === 'function') {
        clearOTPWindowScheduler();
      }

      secrets = [];
      filteredSecrets = [];
      currentSearchQuery = '';
      const secretsList = document.getElementById('secretsList');
      if (secretsList) {
        secretsList.innerHTML = '';
        secretsList.style.display = 'none';
      }

      showCenterToast('⚠️', t('loginExpired'));
      setTimeout(() => {
        if (secretReadsBlocked && sessionGeneration === secretSessionGeneration) showLoginModal();
      }, 1500);
    }

    // 退出登录
    async function logout() {
      const sessionGeneration = invalidateSecretSession();
      if (typeof resetLanguagePreferenceSync === 'function') resetLanguagePreferenceSync();
      loginAttemptGeneration += 1;
      if (typeof hideSecretModal === 'function') hideSecretModal();
      let serverSuccess = false;
      let serverErrorMessage = '';

      // Clear the view immediately; a pending network request must not keep
      // codes visible or let older reads restore the local cache.
      try {
        localStorage.removeItem('2fa-secrets-cache');
      } catch (e) {
        console.warn('清除缓存失败:', e);
      }

      try {
        Object.keys(otpIntervals || {}).forEach(secretId => {
          clearInterval(otpIntervals[secretId]);
          delete otpIntervals[secretId];
        });
      } catch (e) {
        console.warn('清除验证码定时器失败:', e);
      }

      if (typeof clearAllOTPAnimations === 'function') {
        clearAllOTPAnimations();
      }
      if (typeof clearOTPWindowScheduler === 'function') {
        clearOTPWindowScheduler();
      }

      secrets = [];
      filteredSecrets = [];
      currentSearchQuery = '';

      const secretsList = document.getElementById('secretsList');
      if (secretsList) {
        secretsList.innerHTML = '';
        secretsList.style.display = 'none';
      }

      if (typeof hideSettingsModal === 'function') {
        hideSettingsModal();
      }

      try {
        const { response, data } = await enqueueAuthenticationRequest(async signal => {
          const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include',
            headers: languageRequestHeaders({ 'X-Requested-With': 'XMLHttpRequest' }),
            signal
          });
          return { response, data: response.ok ? null : await response.json().catch(() => ({})) };
        });
        if (sessionGeneration !== secretSessionGeneration) return false;

        if (response.ok) {
          serverSuccess = true;
        } else {
          serverErrorMessage = data.message || t('serverResponseStatus', { status: response.status });
          console.warn('退出登录服务端响应异常:', response.status, serverErrorMessage);
        }
      } catch (error) {
        if (sessionGeneration !== secretSessionGeneration) return false;
        console.error('退出登录网络错误:', error);
        serverErrorMessage = t('networkError');
      }

      if (sessionGeneration !== secretSessionGeneration) return false;
      if (serverSuccess) {
        showCenterToast('👋', t('loggedOut'));
      } else {
        showCenterToast('⚠️', t('loggedOutLocally', { error: serverErrorMessage }));
      }

      setTimeout(() => {
        if (secretReadsBlocked && sessionGeneration === secretSessionGeneration) showLoginModal();
      }, 500);

      return serverSuccess;
    }

    if (typeof window !== 'undefined') {
      window.logout = logout;
    }

    // 为 fetch 请求添加认证（使用 Cookie）并支持自动续期
    async function authenticatedFetch(url, options = {}) {
      const sessionGeneration = secretSessionGeneration;
      // 🍪 使用 HttpOnly Cookie 进行认证，浏览器自动携带
      options = { ...options, credentials: 'include', headers: languageRequestHeaders(options.headers) };
      
      const response = await fetch(url, options);
      
      // 🔄 自动续期：检查响应头中是否有刷新标记
      if (isSecretSessionCurrent(sessionGeneration) && response.headers.get('X-Token-Refresh-Needed') === 'true') {
        const remainingDays = response.headers.get('X-Token-Remaining-Days');
        console.log('⏰ Token 即将过期（剩余 ' + remainingDays + ' 天），正在自动刷新...');
        
        // 异步刷新 Token（不阻塞当前请求）
        refreshAuthToken().then(success => {
          if (success) {
            console.log('✅ Token 自动续期成功，已延长30天');
          } else {
            console.warn('⚠️  Token 自动续期失败，请稍后重试');
          }
        }).catch(error => {
          console.error('❌ Token 自动续期错误:', error);
        });
      }
      
      return response;
    }

`;
}
