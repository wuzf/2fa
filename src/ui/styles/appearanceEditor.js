/** Theme editor follows the existing Fluent dialog controls, with a responsive live canvas. */
export function getAppearanceEditorStyles() {
	return `
    #appearanceModal .appearance-modal-content {width:min(1320px,96vw);max-width:1320px;height:min(880px,94dvh);max-height:94dvh;padding:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dialog-surface,var(--bg-primary));}
    #appearanceModal .modal-header {padding:20px 24px;margin:0;flex-shrink:0;}
    .appearance-workspace {display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);min-height:0;flex:1;}
    .appearance-controls {display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dialog-line,var(--border-primary));}
    .appearance-tabs {display:flex;flex-wrap:wrap;gap:3px;padding:10px;border-bottom:1px solid var(--dialog-line,var(--border-primary));}
    .appearance-tab {border:0;background:transparent;color:var(--dialog-muted,var(--text-secondary));padding:9px 10px;border-radius:4px;font:inherit;cursor:pointer;}
    .appearance-tab.active {background:var(--dialog-selected,var(--bg-hover));color:var(--dialog-brand,var(--primary));font-weight:600;}
    .appearance-panel {overflow:auto;overscroll-behavior:contain;min-height:0;padding:20px;}
    .appearance-field {display:flex;flex-direction:column;gap:7px;margin:0 0 18px;color:var(--dialog-text,var(--text-primary));min-width:0;}
    .appearance-field-label {font-size:13px;font-weight:600;}
    .appearance-field input:not([type=file]),.appearance-field select,.appearance-field textarea,.appearance-layout-item select {box-sizing:border-box;width:100%;min-height:36px;padding:7px 9px;border:1px solid var(--dialog-stroke,var(--border-secondary));border-radius:4px;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-text,var(--text-primary));font:inherit;}
    .appearance-field textarea {min-height:140px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;}
    .appearance-field input[type=color] {height:40px;padding:3px;}
    .appearance-field :is(input,textarea,select):focus-visible,.appearance-tab:focus-visible,.appearance-theme-card:focus-visible {outline:2px solid var(--dialog-brand,var(--primary));outline-offset:2px;}
    .appearance-theme-list {display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:20px;}
    .appearance-theme-card {text-align:left;display:grid;grid-template-columns:64px minmax(0,1fr);gap:3px 12px;align-items:center;padding:12px;border:1px solid var(--dialog-line,var(--border-primary));border-radius:7px;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-text,var(--text-primary));cursor:pointer;font:inherit;}
    .appearance-theme-card[aria-pressed=true] {border-color:var(--dialog-brand,var(--primary));box-shadow:inset 0 0 0 1px var(--dialog-brand,var(--primary));}
    .appearance-theme-card strong {font-size:14px;overflow-wrap:anywhere;}
    .appearance-theme-card small {grid-column:2;color:var(--dialog-muted,var(--text-secondary));}
    .appearance-theme-swatch {grid-row:1/3;display:flex;align-items:center;justify-content:center;gap:4px;height:48px;border-radius:4px;border:1px solid #8883;}
    .appearance-theme-swatch i {width:12px;height:22px;border-radius:2px;border:1px solid #8883;}
    .appearance-import-actions {display:flex;flex-wrap:wrap;gap:8px;margin:14px 0;}
    .appearance-file-button {position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}
    .appearance-file-button input[type=file] {position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;}
    .appearance-asset-field {display:flex;flex-direction:column;gap:8px;}
    .appearance-asset-name {overflow-wrap:anywhere;color:var(--dialog-muted,var(--text-secondary));max-height:50px;overflow:hidden;}
    .appearance-layout-region {padding-bottom:14px;margin-bottom:12px;border-bottom:1px solid var(--dialog-line,var(--border-primary));}
    .appearance-layout-item {display:flex;flex-wrap:wrap;gap:6px;padding:8px 0;align-items:center;}
    .appearance-layout-item strong {flex-basis:100%;font-size:12px;}
    .appearance-layout-item select {flex:1;min-width:100px;width:auto;}
    .appearance-layout-item .appearance-field {flex-basis:100%;}
    .appearance-preview-section {display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--dialog-subtle,var(--bg-secondary));min-width:0;min-height:0;}
    .appearance-preview-toolbar {display:flex;gap:6px;flex-wrap:wrap;}
    .appearance-preview-viewport {flex:1;min-height:180px;overflow:hidden;background:var(--dialog-surface,var(--bg-primary));border:1px solid var(--dialog-line,var(--border-primary));border-radius:6px;}
    #appearancePreview {display:block;border:0;transform-origin:top left;background:white;max-width:none;}
    .appearance-status {min-height:20px;padding:8px 24px;font-size:12px;color:var(--dialog-muted,var(--text-secondary));overflow-wrap:anywhere;}
    .appearance-status[data-error=true] {color:var(--dialog-danger,var(--danger));}
    .appearance-footer-actions {display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:12px 24px 20px;border-top:1px solid var(--dialog-line,var(--border-primary));}
    .appearance-safe-banner {position:relative;padding:12px 20px;text-align:center;background:#fff4ce;color:#5c4100;font:14px/1.5 system-ui;z-index:100;}
    .appearance-safe-banner button {margin-left:12px;padding:5px 12px;cursor:pointer;}
    @media(max-width:760px){#appearanceModal .appearance-modal-content{width:100vw;height:100dvh;max-height:100dvh;border-radius:0;}.appearance-workspace{display:flex;flex-direction:column;overflow:auto;}.appearance-controls{min-height:350px;max-height:60dvh;flex-shrink:0;border-right:0;}.appearance-preview-section{min-height:380px;flex-shrink:0;}.appearance-panel{padding:16px;}.appearance-footer-actions{padding:10px;}.appearance-footer-actions .btn{min-height:40px;flex:1;}.appearance-status{padding:6px 12px;}.appearance-field input,.appearance-field select{font-size:16px!important;}}
  `;
}
