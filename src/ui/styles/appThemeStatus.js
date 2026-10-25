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
      text-align: left;
    }
    #appThemeStartup { display:none; }
    :root[data-app-theme-startup="pending"] #appThemeStartup { display:flex; }
    #appThemeRuntimeStatus[hidden] { display: none !important; }
    #appThemeRuntimeStatus [hidden] { display: none !important; }
    #appThemeStartup, #appThemeRuntimeStatus[data-quiet="true"] {
      flex-direction: column;
      justify-content: center;
      min-height: min(50vh, 360px);
      margin: 0 auto;
      padding: 24px 16px;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      text-align: center;
    }
    #appThemeStartup::before, #appThemeRuntimeStatus[data-quiet="true"]::before {
      content: '';
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: app-theme-loading-spin 900ms linear infinite;
    }
    @keyframes app-theme-loading-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #appThemeStartup::before, #appThemeRuntimeStatus[data-quiet="true"]::before { animation: none; }
    }
    #appThemeStartup .app-theme-status-message,
    #appThemeRuntimeStatus[data-quiet="true"] .app-theme-status-message { flex: 0 0 auto; margin: 0; min-width: 0; overflow-wrap: anywhere; }
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
    #appThemeRuntimeStatus .app-theme-status-message {
      flex: 1 1 240px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    #appThemeRuntimeStatus .app-theme-status-actions,
    #appThemeRuntimeStatus .app-theme-status-recovery {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #appThemeRuntimeStatus .app-theme-status-recovery { flex-basis: 100%; margin: 0; }
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
