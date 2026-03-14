/**
 * 首次设置页面模块
 * 用于用户首次访问时设置管理员密码
 */

import { getVariables } from './styles/variables.js';

/**
 * 创建首次设置页面
 * @returns {Response} HTML响应
 */
export async function createSetupPage() {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>首次设置 - 2FA 密钥管理器</title>

  <script>
    (function() {
      try {
        const theme = localStorage.getItem('theme') || 'auto';
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const dataTheme = (theme === 'dark' || (theme === 'auto' && prefersDark)) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', dataTheme);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>

  <style>
    ${getVariables()}

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-secondary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: var(--text-primary);
    }

    .setup-container {
      background: var(--bg-primary);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      max-width: 480px;
      width: 100%;
      padding: 40px;
    }

    .setup-header {
      text-align: center;
      margin-bottom: 30px;
    }

    .setup-icon {
      font-size: 64px;
      margin-bottom: 15px;
    }

    .setup-title {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 10px;
    }

    .setup-description {
      font-size: 15px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .security-notice {
      background: var(--warning-light);
      border-left: 4px solid var(--warning-dark);
      border-radius: var(--radius-sm);
      padding: 15px;
      margin-bottom: 25px;
      font-size: 13px;
      color: var(--warning-dark);
      line-height: 1.5;
    }

    .security-notice strong {
      display: block;
      margin-bottom: 5px;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .password-input-wrapper {
      position: relative;
    }

    .form-input {
      width: 100%;
      padding: 14px 40px 14px 16px;
      border: 2px solid var(--input-border);
      border-radius: var(--radius-md);
      font-size: 15px;
      transition: all 0.3s ease;
      font-family: inherit;
      background: var(--input-bg);
      color: var(--text-primary);
    }

    .form-input:focus {
      outline: none;
      border-color: var(--input-border-focus);
      background: var(--input-bg-focus);
      box-shadow: 0 0 0 4px rgba(33, 150, 243, 0.12);
    }

    .toggle-password {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      padding: 5px;
      color: var(--text-tertiary);
      transition: color 0.2s;
    }

    .toggle-password:hover {
      color: var(--primary-600);
    }

    .password-requirements {
      background: var(--bg-secondary);
      border-radius: var(--radius-sm);
      padding: 12px 15px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .password-requirements ul {
      list-style: none;
      margin: 5px 0 0 0;
    }

    .password-requirements li {
      padding: 3px 0;
      padding-left: 20px;
      position: relative;
    }

    .password-requirements li:before {
      content: '✓';
      position: absolute;
      left: 0;
      color: #4caf50;
      font-weight: bold;
    }

    .password-strength {
      margin-top: 10px;
      height: 4px;
      background: var(--border-primary);
      border-radius: 2px;
      overflow: hidden;
    }

    .password-strength-bar {
      height: 100%;
      width: 0%;
      transition: all 0.3s ease;
      border-radius: 2px;
    }

    .strength-weak { background: #f44336; width: 33%; }
    .strength-medium { background: #ff9800; width: 66%; }
    .strength-strong { background: #4caf50; width: 100%; }

    .submit-button {
      width: 100%;
      padding: 16px;
      background: var(--primary-600);
      color: white;
      border: none;
      border-radius: var(--radius-md);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s ease;
      margin-top: 10px;
    }

    .submit-button:hover {
      background: var(--primary-700);
    }

    .submit-button:active {
      opacity: 0.9;
    }

    .submit-button:disabled {
      background: var(--text-tertiary);
      cursor: not-allowed;
      opacity: 0.8;
    }

    .error-message {
      background: var(--danger-light);
      border: 1px solid var(--danger-dark);
      border-radius: var(--radius-sm);
      padding: 12px;
      margin-bottom: 20px;
      color: var(--danger-darker);
      font-size: 14px;
      display: none;
    }

    .success-message {
      background: var(--success-light);
      border: 1px solid var(--success-dark);
      border-radius: var(--radius-sm);
      padding: 12px;
      margin-bottom: 20px;
      color: var(--success-dark);
      font-size: 14px;
      display: none;
    }

    .loading-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* 响应式设计 */
    @media (max-width: 600px) {
      .setup-container {
        padding: 30px 25px;
      }

      .setup-icon {
        font-size: 48px;
      }

      .setup-title {
        font-size: 24px;
      }

      .setup-description {
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <div class="setup-container">
    <div class="setup-header">
      <div class="setup-icon">🔐</div>
      <h1 class="setup-title">欢迎使用 2FA</h1>
      <p class="setup-description">
        首次使用需要设置管理密码<br>
        密码将被加密存储，用于身份验证
      </p>
    </div>

    <div class="security-notice">
      <strong>🛡️ 安全提示</strong>
      请设置一个强密码，并妥善保管。这是您登录管理密钥的唯一凭证。
    </div>

    <div id="errorMessage" class="error-message"></div>
    <div id="successMessage" class="success-message"></div>

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
            required
            oninput="checkPasswordStrength()"
          >
          <button type="button" class="toggle-password" onclick="togglePasswordVisibility('password')" title="显示/隐藏密码">
            👁️
          </button>
        </div>
        <div class="password-strength" id="passwordStrength">
          <div class="password-strength-bar" id="passwordStrengthBar"></div>
        </div>
        <div class="password-requirements">
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
          <button type="button" class="toggle-password" onclick="togglePasswordVisibility('confirmPassword')" title="显示/隐藏密码">
            👁️
          </button>
        </div>
      </div>

      <button type="submit" class="submit-button" id="submitButton">
        完成设置
      </button>
    </form>
  </div>

  <script>
    // 切换密码可见性
    function togglePasswordVisibility(inputId) {
      const input = document.getElementById(inputId);
      const button = input.nextElementSibling;

      if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🙈';
      } else {
        input.type = 'password';
        button.textContent = '👁️';
      }
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
