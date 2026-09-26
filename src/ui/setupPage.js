import { SUPPORTED_LANGUAGES, LANGUAGE_OPTIONS } from '../shared/languages.js';
/**
 * 首次设置页面模块
 * 用于用户首次访问时设置管理员密码
 */

import { getSetupStyles } from './styles/setup.js';
import { dialogIcon } from './dialogIcons.js';
import { LOCALES } from './locales/index.js';
import { getRequestLanguage, normalizeLanguage } from '../utils/i18n.js';
import { serverMessages, getServerTranslations } from '../utils/server-messages.js';

/**
 * 创建首次设置页面
 * @returns {Response} HTML响应
 */
export async function createSetupPage(request) {
	const initialLanguage = getRequestLanguage(request, 'en');
	const setupMessages = serverMessages.filter(([source]) =>
		/密码|设置|^KV 存储未绑定|^请求|^您的请求次数过多|^服务器内部错误/.test(source),
	);
	const translatedSetupMessages = setupMessages.map(getServerTranslations);
	const setupMessagePatterns = translatedSetupMessages.flatMap((translations, messageIndex) =>
		Object.values(translations).map((template) => {
			const parameters = [...template.matchAll(/\{(\w+)\}/g)];
			let position = 0;
			let pattern = '^';
			const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			for (const parameter of parameters) {
				pattern += escapePattern(template.slice(position, parameter.index)) + '([\\s\\S]*?)';
				position = parameter.index + parameter[0].length;
			}
			pattern += escapePattern(template.slice(position)) + '$';
			return { pattern, parameters: parameters.map((parameter) => parameter[1]), messageIndex };
		}),
	);
	const setupLocales = {};
	for (const lang of SUPPORTED_LANGUAGES) {
		setupLocales[lang] = {};
		for (const [k, v] of Object.entries(LOCALES[lang] || {})) {
			if (k.startsWith('setup')) {
				setupLocales[lang][k] = v;
			}
		}
	}

	const html = `<!DOCTYPE html>
<html lang="${initialLanguage}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${LOCALES[initialLanguage].setupPageTitle}</title>

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
      <div class="setup-header-top">
        <div class="setup-icon" aria-hidden="true">${dialogIcon('lock')}</div>
        <div class="setup-lang-selector">
          <select id="setupLangSelect" class="setup-lang-select" aria-label="Language / 語言" onchange="changeSetupLanguage(this.value)">
            ${LANGUAGE_OPTIONS.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('\n            ')}
          </select>
        </div>
      </div>
      <h1 class="setup-title" id="setupTitle">设置管理密码</h1>
      <p class="setup-description" id="setupDescription">
        首次使用 2FA，请先设置登录密码。
      </p>
    </div>

    <div class="security-notice">
      <strong id="secNoticeTitle">请妥善保管密码</strong>
      <span id="secNoticeDesc">请设置一个强密码，并妥善保管。这是您登录管理密钥的唯一凭证。</span>
    </div>

    <div id="insecureWarning" class="insecure-warning" style="display: none;">
      <strong id="insecureTitle">当前正通过 HTTP 访问</strong>
      <span id="insecureDesc">浏览器无法在 HTTP 下保存登录状态，设置完成后会反复要求输入密码。请将地址栏中的 http:// 改为 https:// 后重新访问。</span>
    </div>

    <div id="errorMessage" class="error-message" role="alert"></div>
    <div id="successMessage" class="success-message" role="status"></div>

    <form id="setupForm" onsubmit="handleSetup(event)">
      <div class="form-group">
        <label class="form-label" for="password" id="passwordLabel">设置密码</label>
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
          <button type="button" class="toggle-password" id="togglePasswordBtn" onclick="togglePasswordVisibility('password')" title="显示密码" aria-label="显示密码" aria-controls="password" aria-pressed="false">
            ${dialogIcon('eye')}
          </button>
        </div>
        <div class="password-strength" id="passwordStrength" aria-hidden="true">
          <div class="password-strength-bar" id="passwordStrengthBar"></div>
        </div>
        <div class="password-requirements" id="passwordRequirements">
          <strong id="reqTitle">密码要求：</strong>
          <ul>
            <li id="reqMinLength">至少 8 个字符</li>
            <li id="reqUppercase">包含大写字母（A-Z）</li>
            <li id="reqLowercase">包含小写字母（a-z）</li>
            <li id="reqNumber">包含数字（0-9）</li>
            <li id="reqSpecial">包含特殊字符（如 !@#$%^&*）</li>
          </ul>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="confirmPassword" id="confirmPasswordLabel">确认密码</label>
        <div class="password-input-wrapper">
          <input
            type="password"
            id="confirmPassword"
            class="form-input"
            placeholder="请再次输入密码"
            autocomplete="new-password"
            required
          >
          <button type="button" class="toggle-password" id="toggleConfirmPasswordBtn" onclick="togglePasswordVisibility('confirmPassword')" title="显示密码" aria-label="显示密码" aria-controls="confirmPassword" aria-pressed="false">
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
    const I18N = ${JSON.stringify(setupLocales)};
    let currentLang = ${JSON.stringify(initialLanguage)};
    let setupLanguagePreference = 'auto';
    let setupErrorMessage = '';
    const setupMessages = ${JSON.stringify(translatedSetupMessages).replace(/</g, '\\u003c')};
    const setupMessagePatterns = ${JSON.stringify(setupMessagePatterns).replace(/</g, '\\u003c')}.map(entry => ({ ...entry, regex: new RegExp(entry.pattern) }));
    const normalizeSetupLanguage = ${normalizeLanguage.toString()};

    function t(key) {
      return (I18N[currentLang] && I18N[currentLang][key]) || (I18N.en && I18N.en[key]) || key;
    }

    function localizeSetupMessage(message) {
      if (typeof message !== 'string') return message;
      const key = Object.values(I18N).flatMap(dict => Object.entries(dict)).find(([, value]) => value === message)?.[0];
      if (key) return t(key);
      for (const entry of setupMessagePatterns) {
        const match = entry.regex.exec(message);
        if (!match) continue;
        return (setupMessages[entry.messageIndex][currentLang] || setupMessages[entry.messageIndex].en).replace(/\\{(\\w+)\\}/g, (_, parameter) => {
          const value = match[entry.parameters.indexOf(parameter) + 1] || '';
          return parameter === 'message' ? localizeSetupMessage(value) : value;
        });
      }
      for (const separator of ['; ', '；']) {
        if (message.includes(separator)) return message.split(separator).map(localizeSetupMessage).join(currentLang.startsWith('zh') ? '；' : '; ');
      }
      return message;
    }

    function applySetupLanguage(lang) {
      currentLang = lang;
      document.documentElement.lang = lang;
      const select = document.getElementById('setupLangSelect');
      if (select) {
        select.value = lang;
        if (select.setAttribute) select.setAttribute('aria-label', t('setupLanguage'));
      }

      document.title = t('setupPageTitle');
      const title = document.getElementById('setupTitle');
      if (title) title.textContent = t('setupHeaderTitle');
      const desc = document.getElementById('setupDescription');
      if (desc) desc.textContent = t('setupHeaderDesc');

      const secTitle = document.getElementById('secNoticeTitle');
      if (secTitle) secTitle.textContent = t('setupSecurityNoticeTitle');
      const secDesc = document.getElementById('secNoticeDesc');
      if (secDesc) secDesc.textContent = t('setupSecurityNoticeDesc');

      const insecTitle = document.getElementById('insecureTitle');
      if (insecTitle) insecTitle.textContent = t('setupInsecureTitle');
      const insecDesc = document.getElementById('insecureDesc');
      if (insecDesc) insecDesc.textContent = t('setupInsecureDesc');

      const passLabel = document.getElementById('passwordLabel');
      if (passLabel) passLabel.textContent = t('setupPasswordLabel');
      const passInput = document.getElementById('password');
      if (passInput) passInput.placeholder = t('setupPasswordPlaceholder');

      const reqTitle = document.getElementById('reqTitle');
      if (reqTitle) reqTitle.textContent = t('setupRequirementsTitle');
      const reqMin = document.getElementById('reqMinLength');
      if (reqMin) reqMin.textContent = t('setupReqMinLength');
      const reqUpper = document.getElementById('reqUppercase');
      if (reqUpper) reqUpper.textContent = t('setupReqUppercase');
      const reqLower = document.getElementById('reqLowercase');
      if (reqLower) reqLower.textContent = t('setupReqLowercase');
      const reqNum = document.getElementById('reqNumber');
      if (reqNum) reqNum.textContent = t('setupReqNumber');
      const reqSpec = document.getElementById('reqSpecial');
      if (reqSpec) reqSpec.textContent = t('setupReqSpecial');

      const confLabel = document.getElementById('confirmPasswordLabel');
      if (confLabel) confLabel.textContent = t('setupConfirmPasswordLabel');
      const confInput = document.getElementById('confirmPassword');
      if (confInput) confInput.placeholder = t('setupConfirmPasswordPlaceholder');

      const submitBtn = document.getElementById('submitButton');
      if (submitBtn) {
        if (!submitBtn.disabled) submitBtn.textContent = t('setupSubmitBtn');
        else submitBtn.innerHTML = '<span class="loading-spinner"></span>' + t('setupSubmitting');
      }
      for (const id of ['errorMessage', 'successMessage']) {
        const element = document.getElementById(id);
        if (!element || !element.textContent) continue;
        const key = Object.values(I18N).flatMap(dict => Object.entries(dict)).find(([, value]) => value === element.textContent)?.[0];
        if (key) element.textContent = t(key);
      }
      const errorMessage = document.getElementById('errorMessage');
      if (errorMessage && setupErrorMessage) errorMessage.textContent = localizeSetupMessage(setupErrorMessage);

      updatePasswordButtonLabels('password', document.getElementById('togglePasswordBtn'));
      updatePasswordButtonLabels('confirmPassword', document.getElementById('toggleConfirmPasswordBtn'));
    }

    function updatePasswordButtonLabels(inputId, btn) {
      if (!btn) return;
      const input = document.getElementById(inputId);
      const isVisible = input && input.type === 'text';
      const label = isVisible ? t('setupHidePassword') : t('setupShowPassword');
      buttonAria(btn, isVisible, label);
    }

    function buttonAria(btn, isVisible, label) {
      btn.setAttribute('aria-pressed', String(isVisible));
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }

    function changeSetupLanguage(lang) {
      if (!Object.prototype.hasOwnProperty.call(I18N, lang)) return;
      setupLanguagePreference = lang;
      try {
        localStorage.setItem('language', lang);
      } catch (e) {}
      applySetupLanguage(lang);
      try {
        const url = new URL(location.href);
        url.searchParams.set('lang', lang);
        window.history.replaceState(null, '', url);
      } catch { /* Embedded pages may not allow URL updates. */ }
    }

    function detectSetupLanguage() {
      const browserLanguages = navigator.languages || [navigator.language];
      for (const browserLanguage of browserLanguages) {
        const normalized = normalizeSetupLanguage(browserLanguage);
        if (normalized) return normalized;
      }
      return 'en';
    }

    (function initLang() {
      let saved;
      let query;
      try { saved = localStorage.getItem('language'); } catch { /* Browser detection still works. */ }
      try {
        const params = new URL(location.href).searchParams;
        const requested = params.has('lang') ? params.get('lang') : params.get('language');
        query = requested !== null ? normalizeSetupLanguage(requested) || 'en' : null;
      } catch { /* No URL in exported documents. */ }
      const preferred = [query, saved].find(value => Object.prototype.hasOwnProperty.call(I18N, value));
      if (preferred) setupLanguagePreference = preferred;
      applySetupLanguage(preferred || detectSetupLanguage());
      window.addEventListener('storage', function(event) {
        if (event.key !== 'language' && event.key !== null) return;
        let language;
        try { language = localStorage.getItem('language'); } catch { /* Detect browser language. */ }
        const valid = Object.prototype.hasOwnProperty.call(I18N, language);
        setupLanguagePreference = valid ? language : 'auto';
        applySetupLanguage(valid ? language : detectSetupLanguage());
      });
    })();

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
      const label = visible ? t('setupHidePassword') : t('setupShowPassword');
      buttonAria(button, visible, label);
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
      setupErrorMessage = message;
      errorDiv.textContent = localizeSetupMessage(message);
      errorDiv.style.display = 'block';

      // 5秒后自动隐藏
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
        showError(t('setupErrMismatch'));
        return;
      }

      // 验证密码强度
      if (password.length < 8) {
        showError(t('setupErrLength'));
        return;
      }

      if (!/[A-Z]/.test(password)) {
        showError(t('setupErrUppercase'));
        return;
      }

      if (!/[a-z]/.test(password)) {
        showError(t('setupErrLowercase'));
        return;
      }

      if (!/[0-9]/.test(password)) {
        showError(t('setupErrNumber'));
        return;
      }

      if (!/[^A-Za-z0-9]/.test(password)) {
        showError(t('setupErrSpecial'));
        return;
      }

      // 禁用按钮，显示加载状态
      submitButton.disabled = true;
      submitButton.innerHTML = '<span class="loading-spinner"></span>' + t('setupSubmitting');

      try {
        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Language': currentLang
          },
          body: JSON.stringify({
            password: password,
            confirmPassword: confirmPassword,
            language: setupLanguagePreference
          })
        });

        const data = await response.json();

        if (response.ok) {
          showSuccess(t('setupSuccess'));

          // 2秒后跳转到主页
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } else {
          showError(data.message || t('setupErrFailed'));
          submitButton.disabled = false;
          submitButton.textContent = t('setupSubmitBtn');
        }
      } catch (error) {
        console.error('设置失败:', error);
        showError(t('setupErrNetwork'));
        submitButton.disabled = false;
        submitButton.textContent = t('setupSubmitBtn');
      }
    }
  </script>
</body>
</html>`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Language': initialLanguage,
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
		},
	});
}
