/** Host-owned startup and recovery status; independent of the offline warning. */
export function getAppThemeStatusStyles() {
	return `
    :root[data-app-theme-startup] body > :is(#officialThemeRoot,#officialThemeActions,#officialThemeFooter) { display:none !important; }
    #appThemeStartup, #appThemeRuntimeStatus {
      position: relative;
      inset: auto;
      transform: none;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 12px;
      box-sizing: border-box;
      max-width: 960px;
      width: calc(100% - 32px);
      margin: 16px auto;
      padding: 12px 16px;
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
    }
    #appThemeStartup { display:none; }
    :root[data-app-theme-startup="pending"] #appThemeStartup { display:flex; }
    #appThemeRuntimeStatus[hidden] { display: none !important; }
    #appThemeRuntimeStatus [hidden] { display: none !important; }
    #appThemeStartup, #appThemeRuntimeStatus[data-quiet="true"] {
      flex-direction: column;
      flex-wrap: nowrap;
      justify-content: center;
      gap: 16px;
      width: 100%;
      max-width: none;
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      padding: 24px 16px;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: var(--text-tertiary, var(--text-secondary));
      font-size: 13px;
      text-align: center;
    }
    /* An ordinary start shows only the theme background (public appearance) until the theme mounts;
       the indicator appears only when it takes longer. The runtime status continues it without a fade. */
    #appThemeStartup { animation: app-theme-loading-in 200ms ease-out 1s both; }
    #appThemeRuntimeStatus[data-quiet="true"] { animation: app-theme-loading-in 200ms ease-out var(--app-theme-loading-delay, 0s) both; }
    #appThemeStartup::before, #appThemeRuntimeStatus[data-quiet="true"]::before {
      content: '';
      flex: 0 0 auto;
      box-sizing: border-box;
      width: 32px;
      height: 32px;
      border: 3px solid var(--border-primary);
      border-top-color: var(--primary, currentColor);
      border-radius: 50%;
      animation: app-theme-loading-spin 800ms linear infinite;
    }
    @keyframes app-theme-loading-spin { to { transform: rotate(360deg); } }
    @keyframes app-theme-loading-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      #appThemeStartup, #appThemeStartup::before, #appThemeRuntimeStatus[data-quiet="true"], #appThemeRuntimeStatus[data-quiet="true"]::before { animation: none; }
    }
    #appThemeStartup .app-theme-status-message,
    #appThemeRuntimeStatus[data-quiet="true"] .app-theme-status-message { flex: 0 0 auto; margin: 0; min-width: 0; letter-spacing: .02em; overflow-wrap: anywhere; }
    #appThemeRuntimeStatus[data-quiet="true"] .app-theme-status-actions { justify-content: center; }
    /* Recovery during a quiet start is a secondary way out, not a call to action. */
    #appThemeStartupRecovery, #appThemeRuntimeStatus[data-quiet="true"] .btn {
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 16px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      box-shadow: none;
      color: var(--text-link, var(--primary));
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
    }
    #appThemeStartupRecovery:hover, #appThemeRuntimeStatus[data-quiet="true"] .btn:hover {
      background: var(--bg-hover);
      color: var(--text-link-hover, var(--text-link, var(--primary)));
      transform: none;
    }
    #appThemeStartupRecovery:focus-visible, #appThemeRuntimeStatus[data-quiet="true"] .btn:focus-visible {
      outline: 2px solid var(--border-focus, var(--primary));
      outline-offset: 2px;
    }
    :root:not([data-app-theme-startup-slow]) #appThemeStartup .app-theme-status-message,
    #appThemeRuntimeStatus[data-quiet="true"][data-slow="false"] .app-theme-status-message {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    #appThemeStartupRecovery { display: none; }
    :root[data-app-theme-startup-slow] #appThemeStartupRecovery { display: inline-flex; }
    /* The message takes its own line and everything is centred, on phones and wide screens alike. */
    #appThemeRuntimeStatus .app-theme-status-message {
      flex: 1 1 100%;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    #appThemeRuntimeStatus .app-theme-status-actions,
    #appThemeRuntimeStatus .app-theme-status-recovery {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-width: 0;
    }
    #appThemeRuntimeStatus .app-theme-status-recovery { flex-basis: 100%; margin: 0; }
    /* New-version notice while an app theme runs (it removes the official footer and its badge).
       It floats over the theme's own layout and stays below dialogs. */
    #appReleaseNotice {
      position: fixed;
      top: calc(8px + env(safe-area-inset-top, 0px));
      left: 50%;
      z-index: 9000;
      display: flex;
      align-items: center;
      gap: 4px 12px;
      box-sizing: border-box;
      width: max-content;
      max-width: calc(100% - 24px);
      padding: 4px 4px 4px 16px;
      border: 1px solid var(--border-primary);
      border-radius: 999px;
      background: var(--bg-secondary);
      box-shadow: 0 4px 16px rgb(0 0 0 / 14%);
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.4;
      transform: translateX(-50%);
    }
    #appReleaseNotice[hidden] { display: none !important; }
    #appReleaseNotice .app-release-notice-message { min-width: 0; overflow-wrap: anywhere; }
    #appReleaseNotice .app-release-notice-link { flex: 0 0 auto; color: var(--text-link, var(--primary)); font-weight: 500; text-decoration: none; }
    #appReleaseNotice .app-release-notice-close {
      flex: 0 0 auto;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }
    @media (hover: hover) {
      #appReleaseNotice .app-release-notice-link:hover { text-decoration: underline; }
      #appReleaseNotice .app-release-notice-close:hover { background: var(--bg-hover); }
    }
    #appReleaseNotice :focus-visible { outline: 2px solid var(--border-focus, var(--primary)); outline-offset: 2px; }
    #appThemeStartup .btn, #appThemeRuntimeStatus .btn {
      flex: 0 1 auto;
      width: auto;
      max-width: 100%;
      min-height: 44px;
      white-space: normal;
      overflow-wrap: anywhere;
    }
  `;
}
