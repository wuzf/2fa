import { getBuiltinThemes } from '../themes/builtins.js';

const json = (value) =>
	JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');

/** Only validated, published snapshots enter the public shell. No raw HTML interpolation. */
export function getAppearanceHead(
	snapshot,
	{ buildId = '', safeMode = false, shellConfigId = '', adminCodeId = '', recoveryConfigId = '' } = {},
) {
	return `<meta name="2fa-build" content="${buildId}">
  <script>
    window.__2FA_BUILD_ID__ = ${json(buildId)};
    window.__2FA_SAFE_MODE__ = ${json(safeMode)};
    window.__2FA_SHELL_CONFIG_ID__ = ${json(shellConfigId)};
    window.__2FA_ADMIN_CODE_ID__ = ${json(adminCodeId)};
    window.__2FA_RECOVERY_CONFIG_ID__ = ${json(recoveryConfigId)};
    window.__2FA_APPEARANCE__ = ${json(snapshot)};
    window.__2FA_BUILTIN_THEMES__ = ${json(getBuiltinThemes())};
    (function() {
      const snapshot = window.__2FA_APPEARANCE__;
      if (!snapshot || window.__2FA_SAFE_MODE__) return;
      if (snapshot.kind === 'app' || snapshot.manifest?.themeApiVersion === 2) {
        // Host-only first-paint state. No package script/style executes here.
        // With JavaScript disabled the marker is absent and the official DOM stays visible.
        document.documentElement.setAttribute('data-app-theme-startup', 'pending');
        return;
      }
      const mode = document.documentElement.getAttribute('data-theme') || 'light';
      const tokens = snapshot.manifest?.tokens?.[mode] || {};
      const css = document.createElement('style');
      css.id = 'appearance-first-paint';
      css.textContent = ':root{' + Object.entries(tokens).filter(([key]) => /^--(?:2fa|theme)-[a-z0-9-]+$/i.test(key)).map(([key,value]) => key + ':' + value).join(';') + '}\\n' + (snapshot.css || '');
      document.head.appendChild(css);
    })();
  </script>`;
}

export function getAppearanceClientCode() {
	return `
    function updateAppearanceBranding(snapshot = window.__2FA_APPEARANCE__) {
      const brand = window.__2FA_SAFE_MODE__ ? {} : snapshot?.branding || {};
      const language = typeof getLanguage === 'function' ? getLanguage() : document.documentElement.lang;
      const fallbackTitle = typeof t === 'function' ? t('appTitle') : '2FA';
      document.title = brand.name || fallbackTitle;
      const setMeta = (name,value) => { const meta = document.querySelector('meta[name="' + name + '"]'); if(meta && value !== undefined) meta.content = value; };
      setMeta('application-name', brand.name || '2FA');
      setMeta('apple-mobile-web-app-title', brand.name || '2FA');
      setMeta('description', brand.description || (typeof t === 'function' ? t('pageDescription') : '2FA'));
      const revision = snapshot?.revision || 0;
      const manifest = document.querySelector('link[rel="manifest"]');
      if(manifest) manifest.href = '/manifest.json?appearance=' + revision + '&lang=' + encodeURIComponent(language || 'en') + (window.__2FA_SAFE_MODE__ ? '&safeMode=1' : '');
      const iconUrl = value => typeof value === 'string' && /^\\/(?:theme-assets|theme-packages)\\/[a-f0-9]{64}\\//.test(value) ? value : '';
      const icon = iconUrl(brand.icon192 || brand.icon512);
      const defaultIcon = '/icon-192.png' + (window.__2FA_SAFE_MODE__ ? '?safeMode=1' : '');
      document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"]').forEach(link => {
        link.href = icon || defaultIcon; link.type = icon ? 'image/png' : 'image/svg+xml';
      });
      document.querySelectorAll('link[rel="apple-touch-icon"]').forEach(link => { link.href = iconUrl(brand.appleTouchIcon) || icon || defaultIcon; });
      const login = document.getElementById('loginModal');
      if(login) { let note = document.getElementById('appearanceLoginMessage'); if(!note){note=document.createElement('p');note.id='appearanceLoginMessage';note.className='settings-desc';login.querySelector('.modal-content')?.append(note);} note.textContent=brand.loginText || '';note.hidden=!brand.loginText; }
      let safe = document.getElementById('appearanceSafeBanner');
      if(window.__2FA_SAFE_MODE__ && !safe) {
        safe=document.createElement('div');safe.id='appearanceSafeBanner';safe.className='appearance-safe-banner';
        const text=document.createElement('span');text.setAttribute('data-i18n','appearanceSafeMode');text.textContent=typeof t==='function'?t('appearanceSafeMode'):'Safe mode';
        const exit=document.createElement('button');exit.type='button';exit.setAttribute('data-i18n','appearanceExitSafe');exit.textContent=typeof t==='function'?t('appearanceExitSafe'):'Exit safe mode';
        exit.addEventListener('click',()=>{if(window.__2FA_REFRESH_BLOCKED__?.())return;const url=new URL(location.href);url.searchParams.delete('safeMode');url.searchParams.delete('disableCustomCode');location.assign(url.href);});
        safe.append(text,exit);document.body.prepend(safe);
      }
    }
    window.updateAppearanceMetadata = () => updateAppearanceBranding(window.__2FA_APPEARANCE__);
    window.__2FA_REFRESH_BLOCKED__ = () => (typeof hasUnsavedSettingsChanges === 'function' && hasUnsavedSettingsChanges())
      || (typeof window.hasAppearancePendingChanges === 'function' && window.hasAppearancePendingChanges())
      || (typeof getTopModal === 'function' && Boolean(getTopModal()));
    window.showAppearanceEditor = async () => { await loadModule('appearance'); return window.showAppearanceEditor(); };
    // Sync is part of the core shell: opening the lazy editor is never required.
    let appearanceSyncGeneration = 0;
    window.addEventListener('appearance-applied', () => { appearanceSyncGeneration++; });
    async function checkAppearanceRevision() {
      if (window.__2FA_SAFE_MODE__ || !window.__2FA_BUILD_ID__ || navigator.onLine === false) return;
      const generation = ++appearanceSyncGeneration;
      const read = window.authenticatedFetch || (typeof authenticatedFetch === 'function' ? authenticatedFetch : null);
      if (!read) return;
      try {
        const response = await read('/api/appearance', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (generation !== appearanceSyncGeneration || window.__2FA_SAFE_MODE__ ||
            !Number.isSafeInteger(data.revision) || data.active?.revision !== data.revision ||
            data.revision <= (window.__2FA_APPEARANCE__?.revision || 0)) return;
        if (window.__2FA_REFRESH_BLOCKED__()) {
          window.dispatchEvent(new CustomEvent('appearance-updated-elsewhere', { detail: { revision: data.revision } }));
          return;
        }
        window.applyAppearance?.(data.active);
      } catch {
        // An offline or expired session keeps its last complete appearance.
      }
    }
    window.addEventListener('focus', checkAppearanceRevision);
    window.addEventListener('online', checkAppearanceRevision);
    document.addEventListener('DOMContentLoaded', () => updateAppearanceBranding());
  `;
}
