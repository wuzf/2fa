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
    #appThemeStartup .app-theme-status-message, #appThemeRuntimeStatus .app-theme-status-message {
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
