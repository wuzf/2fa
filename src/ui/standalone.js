import { STANDALONE_LOCALES } from './locales/standalone.js';
import { normalizeLanguage, LANGUAGE_OPTIONS } from '../shared/languages.js';
import { getPublicAppearanceHead } from './publicAppearance.js';

export function getStandaloneText(language, key, params = {}) {
	const value = STANDALONE_LOCALES[normalizeLanguage(language)]?.[key] || STANDALONE_LOCALES.en[key] || key;
	return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

/** Self-contained so the service worker's offline document needs no network. */
export function getStandaloneI18nScript({ language = 'en', titleKey = '', preferServerLanguage = false, translations = {} } = {}) {
	language = normalizeLanguage(language) || 'en';
	const locales = Object.fromEntries(
		Object.entries(STANDALONE_LOCALES).map(([lang, messages]) => [lang, { ...messages, ...translations[lang] }]),
	);
	return `
    const standaloneLocales = ${JSON.stringify(locales).replace(/</g, '\\u003c')};
    const standaloneInitialLanguage = ${JSON.stringify(language)};
    let standaloneLanguage = standaloneInitialLanguage;
    const standaloneNormalizeLanguage = ${normalizeLanguage.toString()};
    function standaloneT(key, params = {}) {
      const value = standaloneLocales[standaloneLanguage]?.[key] || standaloneLocales.en[key] || key;
      return value.replace(/\\{(\\w+)\\}/g, (match, name) => params[name] === undefined ? match : String(params[name]));
    }
    function applyStandaloneLanguage(language) {
      if (!Object.prototype.hasOwnProperty.call(standaloneLocales, language)) return;
      standaloneLanguage = language;
      document.documentElement.lang = language;
      const titleKey = ${JSON.stringify(titleKey)};
      if (titleKey) {
        const brand = document.querySelector?.('meta[data-standalone-brand-name]')?.getAttribute('content') || '';
        const translatedTitle = standaloneT(titleKey);
        document.title = brand ? (translatedTitle.includes('2FA') ? translatedTitle.replace(/2FA/g, () => brand) : translatedTitle + ' · ' + brand) : translatedTitle;
      }
      document.querySelectorAll?.('[data-standalone-i18n]').forEach(function (element) {
        let params = {};
        try { params = JSON.parse(element.getAttribute('data-standalone-params') || '{}'); } catch { /* Use the plain translation. */ }
        element.textContent = standaloneT(element.getAttribute('data-standalone-i18n'), params);
      });
      for (const attribute of ['aria-label', 'placeholder', 'title']) {
        document.querySelectorAll?.('[data-standalone-' + attribute + ']').forEach(function (element) {
          element.setAttribute(attribute, standaloneT(element.getAttribute('data-standalone-' + attribute)));
        });
      }
      const selector = document.getElementById('standaloneLanguage');
      if (selector) selector.value = language;
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('standalone-language-change', { detail: language }));
      }
    }
    function changeStandaloneLanguage(language) {
      applyStandaloneLanguage(language);
      try { localStorage.setItem('language', standaloneLanguage); } catch { /* Language still works without storage. */ }
      try {
        const url = new URL(location.href);
        url.searchParams.set('lang', standaloneLanguage);
        window.history.replaceState(null, '', url);
      } catch { /* Embedded or exported pages may not allow URL updates. */ }
    }
    (function () {
      let saved = null;
      let query = null;
      try { saved = localStorage.getItem('language'); } catch { /* Detect the browser language. */ }
      try {
        const params = new URL(location.href).searchParams;
        query = params.has('lang') ? params.get('lang') : params.get('language');
      } catch { /* Exported documents have no URL. */ }
      const browser = (navigator.languages || [navigator.language]).map(standaloneNormalizeLanguage).find(Boolean);
      const language = ${preferServerLanguage ? 'standaloneInitialLanguage || ' : ''}(query !== null ? standaloneNormalizeLanguage(query) || 'en' : null) ||
        (Object.prototype.hasOwnProperty.call(standaloneLocales, saved) ? saved : null) || browser || 'en';
      applyStandaloneLanguage(language);
      document.getElementById('standaloneLanguage')?.addEventListener('change', event => changeStandaloneLanguage(event.target.value));
      window.addEventListener('storage', function (event) {
        if (event.key === 'language' || event.key === null) {
          let savedLanguage;
          try { savedLanguage = localStorage.getItem('language'); } catch { /* Fall back to browser. */ }
          applyStandaloneLanguage(standaloneNormalizeLanguage(savedLanguage) || browser || 'en');
        }
      });
    })();
  `;
}

export function getStandaloneLanguageSelect(language = 'en') {
	const selected = normalizeLanguage(language) || 'en';
	return `<select id="standaloneLanguage" class="standalone-language" aria-label="${getStandaloneText(selected, 'standaloneLanguage')}" data-standalone-aria-label="standaloneLanguage">
    ${LANGUAGE_OPTIONS.map(({ value, label }) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('\n    ')}
  </select>`;
}

/** Shared Fluent presentation for pages rendered outside the account workspace. */
export function getStandaloneThemeScript() {
	return `
    (function () {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      function applyPageTheme() {
        let theme = 'auto';
        try { theme = localStorage.getItem('theme') || 'auto'; } catch { /* Storage may be unavailable in exported files. */ }
        const dark = theme === 'dark' || (theme !== 'light' && media.matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      }
      applyPageTheme();
      if (media.addEventListener) media.addEventListener('change', applyPageTheme);
      else if (media.addListener) media.addListener(applyPageTheme);
      window.addEventListener('storage', function (event) {
        if (event.key === 'theme' || event.key === null) applyPageTheme();
      });
    })();
  `;
}

export function getStandaloneStyles() {
	const darkTokens = `
      --page-bg: #1f1f1f;
      --page-surface: #292929;
      --page-hover: #383838;
      --page-text: #ffffff;
      --page-muted: #bdbdbd;
      --page-line: #424242;
      --page-stroke: #666666;
      --page-brand: #62abf5;
      --page-danger: #ff9a9f;
      --page-warning: #f5b894;
      --page-success: #9ad29a;
      --page-shadow: 0 2px 4px #00000020;
      color-scheme: dark;
  `;
	return `
    :root {
      --page-bg: #fafafa;
      --page-surface: #ffffff;
      --page-hover: #f0f0f0;
      --page-text: #242424;
      --page-muted: #616161;
      --page-line: #e0e0e0;
      --page-stroke: #d1d1d1;
      --page-brand: #0f6cbd;
      --page-danger: #b10e1c;
      --page-warning: #8a3707;
      --page-success: #107c10;
      --page-shadow: 0 2px 4px #0000000a, 0 0 2px #0000000a;
      color-scheme: light;
    }
    :root[data-theme="dark"] { ${darkTokens} }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { ${darkTokens} }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      padding: 24px;
      background: var(--page-bg);
      color: var(--page-text);
      font: 14px/20px 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }
    .standalone-card {
      width: 100%;
      max-width: 440px;
      min-width: 0;
      margin: auto;
      padding: 24px;
      background: var(--page-surface);
      border: 1px solid var(--page-line);
      border-radius: 8px;
      box-shadow: var(--page-shadow);
      overflow-wrap: anywhere;
    }
    .page-icon { display: flex; color: var(--page-brand); margin-bottom: 12px; }
    .page-icon .dialog-icon { width: 24px; height: 24px; }
    .page-title { margin: 0 0 8px; font-size: 20px; line-height: 28px; font-weight: 600; }
    .page-description { margin: 0 0 24px; color: var(--page-muted); }
    .page-label { display: block; margin-bottom: 6px; font-weight: 600; }
    .page-input {
      width: 100%;
      min-width: 0;
      min-height: 40px;
      padding: 8px 12px;
      border: 1px solid var(--page-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      background: var(--page-surface);
      color: var(--page-text);
      font: inherit;
    }
    .page-input::placeholder { color: var(--page-muted); opacity: 1; }
    .page-input:focus { border-color: var(--page-brand); box-shadow: inset 0 -1px var(--page-brand); }
    .page-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 6px 16px;
      border: 1px solid #0f6cbd;
      border-radius: 4px;
      background: #0f6cbd;
      color: #ffffff;
      font: inherit;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .page-button:hover { background: #115ea3; border-color: #115ea3; }
    .page-link { color: var(--page-brand); text-underline-offset: 3px; }
    .page-link:hover { text-decoration-thickness: 2px; }
    .page-notice { padding: 12px; margin: 20px 0; border: 1px solid var(--page-line); border-radius: 4px; background: var(--page-bg); color: var(--page-muted); font-size: 12px; line-height: 18px; }
    .page-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 24px; }
    .standalone-language { max-width: 100%; min-height: 36px; padding: 6px 8px; border: 1px solid var(--page-stroke); border-radius: 4px; background: var(--page-surface); color: var(--page-text); font: inherit; }
    .standalone-language-row { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    :is(button, input, a, [tabindex]):focus-visible { outline: 2px solid var(--page-brand); outline-offset: 3px; }
    @media (max-width: 600px) {
      body { padding: 16px; }
      .standalone-card { padding: 20px; }
      .page-input { min-height: 44px; font-size: 16px; }
      .page-button { min-height: 44px; }
    }
  `;
}

function escapeStandaloneText(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
	);
}

export function getStandaloneBrand({ className = 'otp-brand', fallbackIcon = '' } = {}) {
	return '<a class="' + escapeStandaloneText(className) + '" href="/">' + fallbackIcon + '<span>2FA</span></a>';
}

/** Standalone surfaces inherit public tokens, without mounting workspace components. */
function getStandaloneAppearanceStyles(appearance) {
	if (!appearance || appearance.kind === 'app' || appearance.manifest?.kind === 'app') {
		return '';
	}
	const manifest = appearance.manifest || {};
	let css =
		`:root {--2fa-background:#fafafa;--2fa-surface:#fff;--2fa-text:#242424;--2fa-muted:#616161;--2fa-accent:#0f6cbd;--2fa-border:#e0e0e0;--2fa-hover:#f0f0f0;--2fa-font:'Segoe UI',sans-serif;--2fa-code-font:ui-monospace,monospace;--2fa-radius:8px;--2fa-shadow:0 2px 4px #0000000a;--2fa-background-image:none;}
    :root[data-theme="dark"] {--2fa-background:#1f1f1f;--2fa-surface:#292929;--2fa-text:#fff;--2fa-muted:#bdbdbd;--2fa-accent:#62abf5;--2fa-border:#424242;--2fa-hover:#383838;}
  ` +
		['light', 'dark']
			.map(
				(mode) =>
					':root[data-theme="' +
					mode +
					'"]{' +
					Object.entries(manifest.tokens?.[mode] || {})
						.filter(([key]) => /^--(?:2fa|theme)-[a-z0-9-]+$/i.test(key))
						.map(([key, value]) => key + ':' + value + ';')
						.join('') +
					'}',
			)
			.join('\n');
	css += '\n' + (appearance.css || '') + '\n';
	let variables = '';
	for (const field of manifest.settings || []) {
		if (field.binding?.type !== 'variable' || !/^--(?:2fa|theme)-[a-z0-9-]+$/i.test(field.binding.name)) {
			continue;
		}
		const value = appearance.settings?.[field.key] ?? field.default;
		variables += field.binding.name + ':' + String(value ?? '') + (field.type === 'number' ? field.binding.unit || '' : '') + ';';
	}
	css +=
		':root[data-theme]{' +
		variables +
		`
      --page-bg:var(--2fa-background);--page-surface:var(--2fa-surface);--page-hover:var(--2fa-hover,var(--2fa-surface));
      --page-text:var(--2fa-text);--page-muted:var(--2fa-muted);--page-line:var(--2fa-border);--page-stroke:var(--2fa-border);
      --page-brand:var(--2fa-accent);--page-shadow:var(--2fa-shadow);
    }
    body {font-family:var(--2fa-font);font-size:var(--2fa-font-size,14px);background-image:var(--2fa-background-image);background-size:cover;}
    .standalone-card {border-radius:var(--2fa-radius);}
    .token-value,.next-token-value {font-family:var(--2fa-code-font);}
    .page-button,.page-button:hover {background:var(--page-brand);border-color:var(--page-brand);}
  `;
	return css;
}

export function getStandaloneHead(title, extraStyles = '', appearance = null, { brandOnly = false, safeMode = false } = {}) {
	if (safeMode) {
		appearance = null;
	}
	const safeTitle = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${safeTitle}</title>
    <script>${getStandaloneThemeScript()}</script>
    <style>${(getStandaloneStyles() + extraStyles + (brandOnly ? '' : getStandaloneAppearanceStyles(appearance))).replace(/<\/style/gi, '<\\/style')}</style>
    ${getPublicAppearanceHead(appearance, { surface: 'standalone', safeMode })}
  `;
}
