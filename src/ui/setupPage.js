/**
 * 首次设置页面模块
 * 用于用户首次访问时设置管理员密码
 */

import { getSetupStyles } from './styles/setup.js';
import { dialogIcon } from './dialogIcons.js';

/**
 * 创建首次设置页面
 * @returns {Response} HTML响应
 */
export async function createSetupPage() {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>首次设置 - 2FA 密钥管理器</title>

  <script>
    (function() {
      const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      function applySetupTheme() {
        let theme = 'auto';
        try { theme = localStorage.getItem('theme') || 'auto'; } catch (e) { /* Use the system preference. */ }
        const dataTheme = (theme === 'dark' || (theme === 'auto' && themeMedia.matches)) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', dataTheme);
      }
      applySetupTheme();
      if (themeMedia.addEventListener) themeMedia.addEventListener('change', applySetupTheme);
      else if (themeMedia.addListener) themeMedia.addListener(applySetupTheme);
      window.addEventListener('storage', function(event) {
        if (event.key === 'theme' || event.key === null) applySetupTheme();
      });
    })();
  </script>

  <style>
    ${getSetupStyles()}
  </style>
</head>
<body>
  <main class="setup-container">
    <div class="setup-header">
      <div class="setup-icon" aria-hidden="true">${dialogIcon('lock')}</div>
      <h1 class="setup-title">设置管理密码</h1>
      <p class="setup-description">
        首次使用 2FA，请先设置登录密码。
      </p>
    </div>

    <div class="security-notice">
      <strong>请妥善保管密码</strong>
      请设置一个强密码，并妥善保管。这是您登录管理密钥的唯一凭证。
    </div>

    <div id="insecureWarning" class="insecure-warning" style="display: none;">
      <strong>当前正通过 HTTP 访问</strong>
      浏览器无法在 HTTP 下保存登录状态，设置完成后会反复要求输入密码。请将地址栏中的 http:// 改为 https:// 后重新访问。
    </div>

    <div id="errorMessage" class="error-message" role="alert"></div>
    <div id="successMessage" class="success-message" role="status"></div>

    <form id="setupForm" onsubmit="handleSetup(event)">
      <div class="form-group">
        <label class="form-label" for="password">设置密码</label>
        <div class="password-input-wrapper">
          <input
            type="password"
            id="password"
            class="form-input"
            placeholder="请输入密码"
            autocomplete="new-password"
            aria-describedby="passwordRequirements"
            required
            oninput="checkPasswordStrength()"
          >
          <button type="button" class="toggle-password" onclick="togglePasswordVisibility('password')" title="显示密码" aria-label="显示密码" aria-controls="password" aria-pressed="false">
            ${dialogIcon('eye')}
          </button>
        </div>
        <div class="password-strength" id="passwordStrength" aria-hidden="true">
          <div class="password-strength-bar" id="passwordStrengthBar"></div>
        </div>
        <div class="password-requirements" id="passwordRequirements">
          <strong>密码要求：</strong>
          <ul>
            <li>至少 8 个字符</li>
            <li>包含大写字母（A-Z）</li>
            <li>包含小写字母（a-z）</li>
            <li>包含数字（0-9）</li>
            <li>包含特殊字符（如 !@#$%^&*）</li>
          </ul>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="confirmPassword">确认密码</label>
        <div class="password-input-wrapper">
          <input
            type="password"
            id="confirmPassword"
            class="form-input"
            placeholder="请再次输入密码"
            autocomplete="new-password"
            required
          >
          <button type="button" class="toggle-password" onclick="togglePasswordVisibility('confirmPassword')" title="显示密码" aria-label="显示密码" aria-controls="confirmPassword" aria-pressed="false">
            ${dialogIcon('eye')}
          </button>
        </div>
      </div>

      <button type="submit" class="submit-button" id="submitButton">
        完成设置
      </button>
    </form>
  </main>

  <script>
    // 检测不安全上下文：HTTP 下浏览器无法保存 Secure Cookie，登录状态无法保持
    (function() {
      let insecure;
      if (typeof window.isSecureContext === 'boolean') {
        insecure = !window.isSecureContext;
      } else {
        const localHosts = ['localhost', '127.0.0.1', '[::1]'];
        insecure = location.protocol === 'http:' && !localHosts.includes(location.hostname);
      }
      if (insecure) {
        document.getElementById('insecureWarning').style.display = 'block';
      }
    })();

    // 切换密码可见性
    function togglePasswordVisibility(inputId) {
      const input = document.getElementById(inputId);
      const button = input.nextElementSibling;

      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.innerHTML = visible ? '${dialogIcon('eye-off')}' : '${dialogIcon('eye')}';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
      button.title = visible ? '隐藏密码' : '显示密码';
    }

    // 检查密码强度
    function checkPasswordStrength() {
      const password = document.getElementById('password').value;
      const strengthBar = document.getElementById('passwordStrengthBar');

      let strength = 0;

      // 检查长度
      if (password.length >= 8) strength++;
      if (password.length >= 12) strength++;

      // 检查复杂性
      if (/[a-z]/.test(password)) strength++;
      if (/[A-Z]/.test(password)) strength++;
      if (/[0-9]/.test(password)) strength++;
      if (/[^A-Za-z0-9]/.test(password)) strength++;

      // 更新进度条
      strengthBar.className = 'password-strength-bar';
      if (strength <= 2) {
        strengthBar.classList.add('strength-weak');
      } else if (strength <= 4) {
        strengthBar.classList.add('strength-medium');
      } else {
        strengthBar.classList.add('strength-strong');
      }
    }

    // 显示错误消息
    function showError(message) {
      const errorDiv = document.getElementById('errorMessage');
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';

      // 3秒后自动隐藏
      setTimeout(() => {
        errorDiv.style.display = 'none';
      }, 5000);
    }

    // 显示成功消息
    function showSuccess(message) {
      const successDiv = document.getElementById('successMessage');
      successDiv.textContent = message;
      successDiv.style.display = 'block';
    }

    // 处理表单提交
    async function handleSetup(event) {
      event.preventDefault();

      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const submitButton = document.getElementById('submitButton');

      // 验证密码
      if (password !== confirmPassword) {
        showError('两次输入的密码不一致');
        return;
      }

      // 验证密码强度
      if (password.length < 8) {
        showError('密码长度至少为 8 位');
        return;
      }

      if (!/[A-Z]/.test(password)) {
        showError('密码必须包含至少一个大写字母');
        return;
      }

      if (!/[a-z]/.test(password)) {
        showError('密码必须包含至少一个小写字母');
        return;
      }

      if (!/[0-9]/.test(password)) {
        showError('密码必须包含至少一个数字');
        return;
      }

      if (!/[^A-Za-z0-9]/.test(password)) {
        showError('密码必须包含至少一个特殊字符');
        return;
      }

      // 禁用按钮，显示加载状态
      submitButton.disabled = true;
      submitButton.innerHTML = '<span class="loading-spinner"></span>正在设置...';

      try {
        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            password: password,
            confirmPassword: confirmPassword
          })
        });

        const data = await response.json();

        if (response.ok) {
          showSuccess(data.message || '密码设置成功！正在跳转...');

          // 2秒后跳转到主页
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } else {
          showError(data.message || '设置失败，请重试');
          submitButton.disabled = false;
          submitButton.textContent = '完成设置';
        }
      } catch (error) {
        console.error('设置失败:', error);
        showError('网络错误，请检查连接后重试');
        submitButton.disabled = false;
        submitButton.textContent = '完成设置';
      }
    }
  </script>
</body>
</html>`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
		},
	});
}
