/**
 * 前端国际化与多语言模块 (i18n Module)
 * Supported languages are shared with the API, exports and browser extensions.
 */

import { LOCALES } from '../locales/index.js';
import { normalizeLanguage } from '../../shared/languages.js';

/**
 * 获取 i18n 客户端代码
 * @returns {string} i18n JavaScript 代码
 */
export function getI18nCode() {
	const localesJSON = JSON.stringify(LOCALES).replace(/</g, '\\u003c');

	return `    // ========== 国际化与多语言模块 (i18n) ==========
    const I18N_LOCALES = ${localesJSON};
    const normalizeUILanguage = ${normalizeLanguage.toString()};
    let currentLanguagePreference = 'auto';
    let currentResolvedLanguage = 'en';
    let languageChangeVersion = 0;

    function resolveLanguage(pref) {
      if (pref && pref !== 'auto' && Object.prototype.hasOwnProperty.call(I18N_LOCALES, pref)) {
        return pref;
      }
      try {
        const candidates = typeof navigator === 'undefined' ? [] :
          [navigator.language || navigator.userLanguage, ...(navigator.languages || [])];
        for (const candidate of candidates) {
          const language = normalizeUILanguage(candidate);
          if (language && I18N_LOCALES[language]) return language;
        }
      } catch (e) {}
      return 'en';
    }

    function initLanguage() {
      try {
        const saved = localStorage.getItem('language') || 'auto';
        currentLanguagePreference = saved === 'auto' || Object.prototype.hasOwnProperty.call(I18N_LOCALES, saved) ? saved : 'auto';
      } catch (e) {
        currentLanguagePreference = 'auto';
      }
      currentResolvedLanguage = resolveLanguage(currentLanguagePreference);
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('lang', currentResolvedLanguage);
      }
    }

    function getLanguage() {
      return currentResolvedLanguage;
    }

    function getLanguagePreference() {
      return currentLanguagePreference;
    }

    function t(key, params) {
      const activeDict = I18N_LOCALES[currentResolvedLanguage] || I18N_LOCALES.en || {};
      const fallbackDict = I18N_LOCALES.en || {};
      let val = activeDict[key] !== undefined ? activeDict[key] : fallbackDict[key];
      if (val === undefined) {
        return key;
      }
      if (params && typeof params === 'object') {
        return val.replace(/\\{(\\w+)\\}/g, (match, paramKey) => {
          return params[paramKey] !== undefined ? params[paramKey] : match;
        });
      }
      return val;
    }

    function setTranslatedText(el, key, params = {}) {
      if (!el) return;
      el.setAttribute('data-i18n', key);
      el.setAttribute('data-i18n-params', JSON.stringify(params));
      el.textContent = t(key, params);
    }

    function applyTranslations(root) {
      const container = root || document;
      if (!container || typeof container.querySelectorAll !== 'function') return;
      const select = selector => {
        const descendants = Array.from(container.querySelectorAll(selector));
        if (typeof container.matches === 'function' && container.matches(selector)) descendants.unshift(container);
        return descendants;
      };
      const paramsFor = el => {
        let params = {};
        try { params = JSON.parse(el.getAttribute('data-i18n-params') || '{}'); } catch {}
        const countId = el.getAttribute('data-i18n-count-id');
        if (countId) {
          const count = document.getElementById(countId);
          params.count = count ? Number(count.textContent) || 0 : 0;
        }
        return params;
      };

      // 1. Text elements
      select('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          el.textContent = t(key, paramsFor(el));
        }
      });

      // 2. HTML elements
      select('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (key) {
          el.innerHTML = t(key, paramsFor(el));
        }
      });

      // 3. Placeholders
      select('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.placeholder = t(key);
        }
      });

      // 4. Tooltips (title)
      select('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.title = t(key);
        }
      });

      // 5. Accessibility labels
      select('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        if (key) {
          el.setAttribute('aria-label', t(key));
        }
      });

      ['content', 'alt'].forEach(attr => {
        select('[data-i18n-' + attr + ']').forEach(el => el.setAttribute(attr, t(el.getAttribute('data-i18n-' + attr))));
      });

      // Update Document Title if page title exists
      if (document.title && t('appTitle')) {
        document.title = t('appTitle');
      }
      if (typeof document.querySelector === 'function') {
        const manifest = document.querySelector('link[rel="manifest"]');
        if (manifest) manifest.setAttribute('href', '/manifest.json?lang=' + encodeURIComponent(currentResolvedLanguage));
      }
    }

    function setLanguage(lang, options = {}) {
      // Invalidate older settings reads for every language change, including
      // storage events from other tabs that must not write back to storage.
      languageChangeVersion += 1;
      const previousLanguage = currentResolvedLanguage;
      currentLanguagePreference = lang === 'auto' || Object.prototype.hasOwnProperty.call(I18N_LOCALES, lang) ? lang : 'auto';
      try {
        if (options.persist !== false) localStorage.setItem('language', currentLanguagePreference);
      } catch (e) {}
      currentResolvedLanguage = resolveLanguage(currentLanguagePreference);
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('lang', currentResolvedLanguage);
      }
      applyTranslations();
      if (previousLanguage !== currentResolvedLanguage && typeof refreshToastLanguage === 'function') refreshToastLanguage();

      const langSelect = document.getElementById('settingsLanguage');
      if (langSelect && langSelect.value !== currentLanguagePreference) {
        langSelect.value = currentLanguagePreference;
      }

      // 重新渲染当前可能处于活动状态的动态列表
      if (typeof renderSecrets === 'function' && typeof secrets !== 'undefined' && Array.isArray(secrets) && secrets.length > 0) {
        renderSecrets();
      } else if (typeof updateSearchStats === 'function') {
        updateSearchStats();
      }
      if (typeof syncSecretDialogTranslations === 'function' && document.getElementById('modalTitle')) syncSecretDialogTranslations();
      if (typeof refreshSettingsLanguage === 'function') refreshSettingsLanguage();
      if (typeof refreshPwaLanguage === 'function') refreshPwaLanguage();
      if (typeof renderHiddenSecretsNotice === 'function') renderHiddenSecretsNotice();
      if (typeof refreshVersionLanguage === 'function') refreshVersionLanguage();
      if (typeof refreshBrowserExtensionLanguage === 'function') refreshBrowserExtensionLanguage();
      if (typeof refreshToolsTranslations === 'function') refreshToolsTranslations();
      if (typeof refreshImportTranslations === 'function') refreshImportTranslations();
      if (typeof refreshExportTranslations === 'function') refreshExportTranslations();
      if (typeof refreshBackupTranslations === 'function') refreshBackupTranslations();
      if (typeof refreshGoogleMigrationTranslations === 'function') refreshGoogleMigrationTranslations();
      if (typeof refreshQRCodeTranslations === 'function') refreshQRCodeTranslations();
      if (typeof refreshClockLanguage === 'function') refreshClockLanguage();
      if (typeof refreshAuthLanguage === 'function') refreshAuthLanguage();
      if (typeof refreshConfirmDialogLanguage === 'function') refreshConfirmDialogLanguage();
      if (typeof refreshModuleLoaderLanguage === 'function') refreshModuleLoaderLanguage();
    }

    function formatI18nDate(date, options) {
      const locale = currentResolvedLanguage === 'en' ? 'en-US' : currentResolvedLanguage;
      return new Date(date).toLocaleString(locale, options);
    }

    function compareI18nStrings(a, b, options) {
      const locale = currentResolvedLanguage === 'en' ? 'en-US' : currentResolvedLanguage;
      return String(a || '').localeCompare(String(b || ''), locale, options);
    }

    // 初始化语言
    initLanguage();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('languagechange', () => {
        if (currentLanguagePreference === 'auto') setLanguage('auto');
      });
      window.addEventListener('storage', event => {
        if (event.key === 'language' || event.key === null) {
          let preference = 'auto';
          try { preference = localStorage.getItem('language') || 'auto'; } catch {}
          setLanguage(preference, { persist: false });
        }
      });
    }
`;
}
