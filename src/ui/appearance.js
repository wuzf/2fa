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
        // The recovery link must become available even if the later core fails
        // to run. Store presentation timing only; this cannot grant a permit.
        const startedAt = Date.now();
        let generation = 0;
        let timer = null;
        const presentation = {
          startedAt,
          active: false,
          slow: false,
          resume() {
            if (this.active) return;
            this.active = true;
            const current = ++generation;
            timer = setTimeout(() => {
              if (!presentation.active || current !== generation || !document.documentElement.hasAttribute('data-app-theme-startup')) return;
              presentation.slow = true;
              document.documentElement.setAttribute('data-app-theme-startup-slow', '');
              window.dispatchEvent(new Event('app-theme-startup-slow'));
            }, Math.max(0, 2000 - (Date.now() - startedAt)));
          },
          stop() {
            this.active = false;
            this.slow = false;
            generation++;
            clearTimeout(timer);
            timer = null;
            document.documentElement.removeAttribute('data-app-theme-startup-slow');
          }
        };
        window.__2FA_APP_STARTUP_PRESENTATION__ = presentation;
        window.addEventListener('pagehide', () => presentation.stop());
        window.addEventListener('pageshow', event => {
          if (event.persisted && document.documentElement.getAttribute('data-app-theme-startup') === 'pending') presentation.resume();
        });
        presentation.resume();
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
      const language = typeof getLanguage === 'function' ? getLanguage() : document.documentElement.lang;
      document.title = typeof t === 'function' ? t('appTitle') : '2FA';
      const description = document.querySelector('meta[name="description"]');
      if(description) description.content = typeof t === 'function' ? t('pageDescription') : '2FA';
      const revision = snapshot?.revision || 0;
      const manifest = document.querySelector('link[rel="manifest"]');
      if(manifest) manifest.href = '/manifest.json?appearance=' + revision + '&lang=' + encodeURIComponent(language || 'en') + (window.__2FA_SAFE_MODE__ ? '&safeMode=1' : '');
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
    async function checkAppearanceRevision(event) {
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
        const result = window.applyAppearance?.(data.active);
        // A page opened right after a theme change can still be the stored one with the previous
        // theme (a slow network); it reloads once for each saved revision instead of asking.
        if (event?.type === 'load' && result?.status === 'reload-required' && typeof window.reloadForSavedAppearance === 'function') {
          const key = '2fa-appearance-catch-up:' + data.revision;
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, '1');
          await window.reloadForSavedAppearance();
        }
      } catch {
        // An offline or expired session keeps its last complete appearance.
      }
    }
    window.addEventListener('load', checkAppearanceRevision);
    window.addEventListener('focus', checkAppearanceRevision);
    window.addEventListener('online', checkAppearanceRevision);
    document.addEventListener('DOMContentLoaded', () => updateAppearanceBranding());
  `;
}
