/** Host parts retain official fallbacks; compact structure requires a live app scope. */
export function getHostPartStyles() {
	return `
    .modal[data-theme-host-suspended], .modal[data-theme-host-suspended] * {transition:none !important;}
    .modal .result-text {margin-top:10px;padding:10px;background:var(--bg-secondary);border-radius:var(--host-control-radius,6px);font-family:monospace;font-size:var(--dialog-caption-size);min-height:0;word-break:break-all;color:var(--text-primary);}
    .modal :is(.time-info,.check-result,.key-result,.decode-result) {padding:15px;border-radius:var(--host-control-radius,4px);margin-bottom:15px;}
    .modal :is(.time-info,.key-result,.decode-result) {background:var(--bg-secondary);}
    .modal .oauth-warning {margin-bottom:12px;padding:12px;border-radius:var(--host-control-radius,6px);font-size:var(--dialog-caption-size);color:var(--warning-color,#b45309);background:var(--bg-secondary);line-height:1.6;}
    .modal .dialog-export-help {margin-bottom:20px;padding:15px;background:var(--bg-secondary);border-radius:var(--host-control-radius,4px);font-size:var(--dialog-body-size);}
    .modal .dialog-transfer-list {max-height:300px;overflow-y:auto;border:var(--host-border-width,1px) solid var(--border-primary);border-radius:var(--host-control-radius,8px);margin-bottom:15px;}
    .modal .dialog-token-chip {font-size:var(--dialog-caption-size);padding:2px 6px;background:var(--bg-tertiary);border-radius:var(--host-control-radius,4px);color:var(--text-tertiary);}
    .modal .dialog-transfer-summary {background:var(--bg-secondary);border-radius:var(--host-control-radius,8px);padding:15px;margin-bottom:15px;}
    .modal .dialog-key-warning {margin-top:15px;padding:10px;background:var(--dialog-warning-bg);border-radius:var(--host-control-radius,6px);}
    .modal .dialog-qr-paper {display:flex;justify-content:center;align-items:center;min-height:250px;background:white;border-radius:var(--host-control-radius,12px);padding:20px;margin-bottom:15px;}
    .modal .dialog-qr-loading {color:var(--host-muted,#666);}
    .modal .dialog-qr-failed {color:var(--host-danger,#e74c3c);}
    .modal .host-qr-image {border-radius:var(--host-control-radius,4px);box-shadow:var(--host-control-shadow,0 2px 8px rgba(0,0,0,0.1));}
    .modal .dialog-migration-qr {width:250px;height:250px;border-radius:var(--host-control-radius,8px);}
    .modal .decode-scanner-error {text-align:center;margin:10px 0;padding:10px;background:var(--danger-light);border:1px solid var(--border-error);border-radius:var(--host-control-radius,6px);color:var(--danger-dark);}
    :root[data-app-host-appearance] .modal .modal-content {padding:20px;}
    /* Full-bleed action rows reach the edges with negative margins; they must match the 20px padding or the dialog scrolls. */
    :root[data-app-host-appearance] .modal :is(.form-actions,.modal-actions,.login-modal-actions,.confirm-dialog-actions) {margin:20px -20px -20px;padding-left:20px;padding-right:20px;}
    :root[data-app-host-appearance] .modal .modal-header {margin-bottom:16px;gap:12px;}
    :root[data-app-host-appearance] .modal .close-btn {min-width:44px;width:44px;min-height:44px;}
    :root[data-app-host-appearance] .modal :is(.form-group,.tool-form-group) {margin-bottom:16px;}
    :root[data-app-host-appearance] .modal :is(.settings-section,.tool-section) {margin-bottom:20px;}
    :root[data-app-host-appearance] .modal .settings-modal-content {padding:0;}
    :root[data-app-host-appearance] .modal .settings-modal-content .modal-header {margin:0;padding:16px 20px;}
    :root[data-app-host-appearance] .modal .settings-layout {flex-direction:column;min-height:0;}
    :root[data-app-host-appearance] .modal .settings-tabs {display:flex;width:auto;flex-shrink:0;gap:4px;padding:0 16px 10px;border-right:0;border-bottom:1px solid var(--dialog-line);overflow-x:auto;background:var(--dialog-surface);}
    :root[data-app-host-appearance] .modal .settings-tab {display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:auto;min-height:44px;margin:0;padding:8px 12px;border:0;box-shadow:none;}
    :root[data-app-host-appearance] .modal .settings-tab-text {display:inline;white-space:nowrap;}
    :root[data-app-host-appearance] .modal .settings-tab-icon {display:none;}
    :root[data-app-host-appearance] .modal .settings-tab.active::before {left:12px;right:12px;top:auto;bottom:0;width:auto;height:2px;}
    :root[data-app-host-appearance] .modal .settings-content {padding:16px 20px;}
    :root[data-app-host-appearance] .modal .settings-modal-actions {padding:12px 20px;}
    :root[data-app-host-appearance] .modal :is(.sync-card,.tool-item) {padding:12px 0;min-height:44px;box-shadow:none;}
    :root[data-app-host-appearance] .modal .theme-options {display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;}
    :root[data-app-host-appearance] .modal .theme-option {flex:1 1 130px;min-height:44px;}
    :root[data-app-host-appearance] .modal .format-card {min-height:64px;padding:10px;}
    :root[data-app-host-appearance] .modal .settings-desc {margin-bottom:12px;line-height:1.5;}
    :root[data-app-host-appearance] .modal .dialog-qr-paper:not(:has(img)) {background:var(--dialog-surface);}
    :root[data-app-host-appearance] #appearanceModal .appearance-modal-content {padding:0;}
    :root[data-app-host-appearance] #appearanceModal .modal-header {padding:16px 20px;margin:0;}
    :root[data-app-host-appearance] #appearanceModal .appearance-tabs {padding:8px 12px;}
    :root[data-app-host-appearance] #appearanceModal .appearance-panel {padding:16px;}
    :root[data-app-host-appearance] #appearanceModal .appearance-theme-list {gap:8px;margin-bottom:16px;}
    :root[data-app-host-appearance] #appearanceModal .appearance-theme-card {grid-template-columns:48px minmax(0,1fr);padding:10px;}
    :root[data-app-host-appearance] #appearanceModal .appearance-preview-section {padding:12px;gap:10px;}
    :root[data-app-host-appearance] #appearanceModal .appearance-footer-actions {padding:10px 16px 14px;}
    @media(max-width:768px){
      :root[data-app-host-appearance] .modal .settings-tabs {padding-inline:12px;}
      :root[data-app-host-appearance] .modal .settings-content {padding:14px 16px;}
      :root[data-app-host-appearance] .modal .settings-modal-actions {padding:12px 16px max(12px,env(safe-area-inset-bottom));}
      :root[data-app-host-appearance] .modal .modal-content > .modal-header {top:-20px;}
      :root[data-app-host-appearance] .modal .settings-modal-content > .modal-header {top:0;}
    }
  `;
}
