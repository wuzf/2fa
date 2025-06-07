/**
 * 认证模块
 * 包含认证相关函数
 */

/**
 * 获取认证相关代码
 * @returns {string} 认证 JavaScript 代码
 */
export function getAuthCode() {
	return `    // ========== 认证相关函数 ==========
    // 注意：现在使用 HttpOnly Cookie 存储 token，不再使用 localStorage

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
      // Token 由 Cookie 管理，刷新请求会自动携带 Cookie
      try {
        console.log('🔄 正在刷新 Token...');
        const response = await fetch('/api/refresh-token', {
          method: 'POST',
          credentials: 'include' // 🍪 自动携带 Cookie
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            console.log('✅ Token 刷新成功');
            return true;
          }
        }

        console.warn('⚠️ Token 刷新失败');
        return false;
      } catch (error) {
        console.error('Token 刷新错误:', error);
        return false;
      }
    }

    // 显示登录模态框
    function showLoginModal() {
      const modal = document.getElementById('loginModal');
      const tokenInput = document.getElementById('loginToken');
      const errorDiv = document.getElementById('loginError');

      if (!modal) {
        return;
      }


      // 强制设置所有可能影响显示的样式
      modal.style.display = 'flex';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.zIndex = '999999';
      modal.style.background = 'rgba(0, 0, 0, 0.9)';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';

      // 强制设置 modal-content 可见
      const modalContent = modal.querySelector('.modal-content');
      if (modalContent) {
        modalContent.style.opacity = '1';
        modalContent.style.transform = 'scale(1)';
        modalContent.style.visibility = 'visible';
      }

      errorDiv.style.display = 'none';
      tokenInput.value = '';

      setTimeout(() => tokenInput.focus(), 100);

      // 回车键提交
      tokenInput.onkeypress = function(e) {
        if (e.key === 'Enter') {
          handleLoginSubmit();
        }
      };
    }

    // 隐藏登录模态框
    function hideLoginModal() {
      document.getElementById('loginModal').style.display = 'none';
    }

    // 处理登录提交
    async function handleLoginSubmit() {
      const tokenInput = document.getElementById('loginToken');
      const errorDiv = document.getElementById('loginError');
      const credential = tokenInput.value.trim();

      if (!credential) {
        errorDiv.textContent = '请输入密码';
        errorDiv.style.display = 'block';
        return;
      }

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include', // 🍪 携带 Cookie
          body: JSON.stringify({ credential })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // 登录成功 - token 已通过 HttpOnly Cookie 自动设置
          hideLoginModal();

          // 显示登录成功信息（包含过期时间）
          if (data.expiresIn) {
            showCenterToast('✅', '登录成功，有效期 ' + data.expiresIn);
          } else {
            showCenterToast('✅', '登录成功');
          }

          // 重新加载密钥列表
          loadSecrets();
        } else {
          // 登录失败
          errorDiv.textContent = data.message || '密码错误，请重试';
          errorDiv.style.display = 'block';
          tokenInput.value = '';
          tokenInput.focus();
        }
      } catch (error) {
        console.error('登录失败:', error);
        errorDiv.textContent = '登录失败：' + error.message;
        errorDiv.style.display = 'block';
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
    function handleUnauthorized() {
      clearAuthToken();

      // 清除缓存的密钥数据（安全考虑）
      try {
        localStorage.removeItem('2fa-secrets-cache');
      } catch (e) {
        console.warn('清除缓存失败:', e);
      }

      showCenterToast('⚠️', '登录已过期，请重新登录');
      setTimeout(() => {
        showLoginModal();
      }, 1500);
    }

    // 为 fetch 请求添加认证（使用 Cookie）并支持自动续期
    async function authenticatedFetch(url, options = {}) {
      // 🍪 使用 HttpOnly Cookie 进行认证，浏览器自动携带
      options.credentials = 'include'; // 自动携带 Cookie
      
      const response = await fetch(url, options);
      
      // 🔄 自动续期：检查响应头中是否有刷新标记
      if (response.headers.get('X-Token-Refresh-Needed') === 'true') {
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
