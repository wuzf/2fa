/** Theme picker with a live preview; follows the Fluent dialog tokens. */
export function getAppearanceEditorStyles() {
	return `
    /* Covers the page from the moment a theme switch is confirmed until the reload replaces it. */
    #appearanceApplying {position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px 16px;background:var(--bg-primary,#fff);color:var(--text-tertiary,var(--text-secondary,#666));font-size:13px;letter-spacing:.02em;text-align:center;}
    #appearanceApplying[hidden] {display:none;}
    #appearanceApplying::before {content:'';box-sizing:border-box;width:32px;height:32px;border:3px solid var(--border-primary,#ddd);border-top-color:var(--primary,currentColor);border-radius:50%;animation:appearance-applying-spin 800ms linear infinite;}
    @keyframes appearance-applying-spin {to {transform:rotate(360deg);}}
    @media (prefers-reduced-motion: reduce) {#appearanceApplying::before {animation:none;}}
    #appearanceModal .appearance-modal-content {width:min(1240px,96vw);max-width:1240px;height:min(820px,94dvh);max-height:94dvh;padding:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dialog-surface,var(--bg-primary));}
    #appearanceModal .modal-header {padding:18px 24px;margin:0;flex-shrink:0;border-bottom:1px solid var(--dialog-line,var(--border-primary));}
    #appearanceModal .appearance-workspace {display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr);min-height:0;flex:1;}
    #appearanceModal .appearance-panel {overflow:auto;overscroll-behavior:contain;min-height:0;padding:20px 20px 24px;border-right:1px solid var(--dialog-line,var(--border-primary));display:flex;flex-direction:column;gap:24px;}
    #appearanceModal .appearance-section {display:flex;flex-direction:column;gap:12px;min-width:0;}
    #appearanceModal .appearance-section-head {display:flex;align-items:center;justify-content:space-between;gap:8px;}
    #appearanceModal .appearance-section-title {margin:0;font-size:13px;font-weight:600;color:var(--dialog-text,var(--text-primary));}
    #appearanceModal .appearance-note {margin:0;font-size:12px;line-height:1.5;color:var(--dialog-muted,var(--text-secondary));}
    #appearanceModal .appearance-note-row {display:flex;align-items:center;justify-content:space-between;gap:12px;}
    #appearanceModal .appearance-auto-update {display:flex;flex-direction:column;gap:6px;margin-top:4px;padding-top:12px;border-top:1px solid var(--dialog-line,var(--border-primary));}
    #appearanceModal .appearance-auto-update-toggle {display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dialog-text,var(--text-primary));cursor:pointer;}
    #appearanceModal .appearance-auto-update-toggle input {width:16px;height:16px;margin:0;accent-color:var(--dialog-brand);}
    #appearanceModal .appearance-catalog-sources {display:flex;flex-direction:column;gap:8px;margin-top:4px;padding-top:12px;border-top:1px solid var(--dialog-line,var(--border-primary));}
    #appearanceModal .appearance-section-subtitle {margin:0;font-size:12px;font-weight:600;color:var(--dialog-text,var(--text-primary));}
    #appearanceModal .appearance-catalog-source-list {display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;}
    #appearanceModal .appearance-catalog-source {display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;padding:4px 4px 4px 10px;border:1px solid var(--dialog-stroke,var(--border-secondary));border-radius:6px;font-size:12px;color:var(--dialog-text,var(--text-primary));}
    #appearanceModal .appearance-catalog-source-name {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #appearanceModal .appearance-catalog-source-remove {flex:0 0 auto;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dialog-muted,var(--text-secondary));font-size:15px;line-height:1;cursor:pointer;}
    #appearanceModal .appearance-catalog-source-remove:hover {color:var(--dialog-danger,var(--danger));}
    #appearanceModal .appearance-catalog-source-remove:focus-visible {outline:2px solid var(--dialog-brand,var(--primary));outline-offset:2px;}
    #appearanceModal .appearance-catalog-source-add {display:flex;align-items:flex-end;gap:8px;}
    #appearanceModal .appearance-catalog-source-add .appearance-field {flex:1;}
    #appearanceModal .appearance-catalog-source-add .btn {flex:0 0 auto;min-height:34px;}
    #appearanceModal .appearance-link {border:0;background:none;padding:2px 0;font:inherit;font-size:12px;color:var(--dialog-brand,var(--primary));cursor:pointer;}
    #appearanceModal .appearance-link:hover {text-decoration:underline;}
    #appearanceModal a.appearance-link {text-decoration:none;}
    #appearanceModal .appearance-guide {margin-left:auto;white-space:nowrap;}
    #appearanceModal .appearance-theme-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
    #appearanceModal .appearance-theme-item {position:relative;min-width:0;}
    #appearanceModal .appearance-theme-card {width:100%;height:100%;display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:8px;text-align:left;border:1px solid var(--dialog-line,var(--border-primary));border-radius:8px;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-text,var(--text-primary));font:inherit;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
    #appearanceModal .appearance-theme-card:hover {border-color:var(--dialog-stroke,var(--border-secondary));box-shadow:0 2px 6px #0000000f;}
    #appearanceModal .appearance-theme-card {position:relative;}
    #appearanceModal .appearance-theme-card[aria-pressed=true] {border-color:var(--dialog-brand,var(--primary));background:var(--dialog-selected,var(--bg-hover));outline:3px solid var(--dialog-brand,var(--primary));outline-offset:1px;}
    #appearanceModal .appearance-theme-card[aria-pressed=true]::after {content:'✓';position:absolute;top:2px;left:2px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dialog-brand,var(--primary));color:var(--dialog-surface,#fff);font-size:13px;font-weight:700;line-height:1;box-shadow:0 0 0 2px var(--dialog-surface,#fff);}
    #appearanceModal .appearance-theme-card:disabled {cursor:default;opacity:.6;}
    #appearanceModal .appearance-theme-swatch {display:flex;align-items:center;justify-content:center;gap:5px;aspect-ratio:16/10;border-radius:5px;border:1px solid #8882;overflow:hidden;}
    #appearanceModal .appearance-theme-shot img {display:block;width:100%;height:100%;object-fit:cover;object-position:top left;}
    #appearanceModal .appearance-theme-swatch i {width:12px;height:20px;border-radius:3px;border:1px solid #8883;}
    #appearanceModal .appearance-theme-text {display:flex;flex-direction:column;gap:2px;min-width:0;}
    #appearanceModal .appearance-theme-text strong {font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #appearanceModal .appearance-theme-text small {font-size:11px;color:var(--dialog-muted,var(--text-secondary));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #appearanceModal .appearance-theme-delete {position:absolute;top:4px;right:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-muted,var(--text-secondary));font-size:15px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;box-shadow:0 1px 3px #0003;}
    #appearanceModal .appearance-theme-item:hover .appearance-theme-delete,#appearanceModal .appearance-theme-delete:focus-visible {opacity:1;}
    #appearanceModal .appearance-theme-delete:hover {color:var(--dialog-danger,var(--danger));}
    #appearanceModal .appearance-settings-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
    #appearanceModal .appearance-field {display:flex;flex-direction:column;gap:6px;margin:0;color:var(--dialog-text,var(--text-primary));min-width:0;}
    #appearanceModal .appearance-field:has(textarea) {grid-column:1/-1;}
    #appearanceModal .appearance-field-label {font-size:12px;font-weight:600;}
    #appearanceModal .appearance-field-help {font-size:11px;color:var(--dialog-muted,var(--text-secondary));}
    #appearanceModal .appearance-field :is(input,select,textarea) {box-sizing:border-box;width:100%;min-height:34px;padding:6px 8px;border:1px solid var(--dialog-stroke,var(--border-secondary));border-radius:6px;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-text,var(--text-primary));font:inherit;font-size:13px;}
    #appearanceModal .appearance-field textarea {min-height:96px;resize:vertical;}
    #appearanceModal .appearance-field input[type=color] {padding:3px;cursor:pointer;}
    #appearanceModal :is(.appearance-field :is(input,select,textarea),.appearance-theme-card,.appearance-segment,.appearance-scene,.appearance-link,.appearance-theme-delete):focus-visible {outline:2px solid var(--dialog-brand,var(--primary));outline-offset:2px;}
    #appearanceModal .appearance-preview-section {display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--dialog-subtle,var(--bg-secondary));min-width:0;min-height:0;}
    #appearanceModal .appearance-preview-toolbar {display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    #appearanceModal .appearance-segmented {display:inline-flex;padding:2px;gap:2px;border-radius:7px;background:var(--dialog-surface,var(--bg-primary));border:1px solid var(--dialog-line,var(--border-primary));}
    #appearanceModal .appearance-segment {border:0;background:transparent;padding:5px 12px;border-radius:5px;font:inherit;font-size:12px;color:var(--dialog-muted,var(--text-secondary));cursor:pointer;}
    #appearanceModal .appearance-segment[aria-pressed=true] {background:var(--dialog-selected,var(--bg-hover));color:var(--dialog-text,var(--text-primary));font-weight:600;}
    #appearanceModal .appearance-scene {margin-left:auto;min-height:30px;padding:4px 8px;border:1px solid var(--dialog-line,var(--border-primary));border-radius:6px;background:var(--dialog-surface,var(--bg-primary));color:var(--dialog-text,var(--text-primary));font:inherit;font-size:12px;}
    #appearanceModal .appearance-preview-viewport {position:relative;flex:1;min-height:180px;overflow:hidden;background:var(--dialog-surface,var(--bg-primary));border:1px solid var(--dialog-line,var(--border-primary));border-radius:8px;}
    /* Out of flow: the scaled frame keeps its unscaled layout height, which would stretch the viewport it is sized from. */
    #appearancePreview {position:absolute;top:0;left:0;display:block;border:0;transform-origin:top left;background:white;max-width:none;}
    #appearanceAppPreview {position:absolute;inset:0;overflow:hidden;}
    #appearanceAppPreview,#appearanceAppPreview iframe {border:0;max-width:none;}
    #appearanceModal .appearance-preview-status {display:flex;align-items:center;gap:8px;margin:0;font-size:12px;color:var(--dialog-muted,var(--text-secondary));}
    #appearanceModal .appearance-footer {display:flex;align-items:center;gap:12px;padding:12px 24px;border-top:1px solid var(--dialog-line,var(--border-primary));flex-shrink:0;}
    #appearanceModal .appearance-status {flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dialog-muted,var(--text-secondary));overflow-wrap:anywhere;}
    #appearanceModal .appearance-status[data-error=true] {color:var(--dialog-danger,var(--danger));}
    #appearanceModal .appearance-footer-actions {display:flex;gap:8px;margin-left:auto;}
    .appearance-safe-banner {position:relative;padding:12px 20px;text-align:center;background:#fff4ce;color:#5c4100;font:14px/1.5 system-ui;z-index:100;}
    .appearance-safe-banner button {margin-left:12px;padding:5px 12px;cursor:pointer;}
    @media(max-width:760px){#appearanceModal .appearance-modal-content{width:100vw;height:100dvh;max-height:100dvh;border-radius:0;}#appearanceModal .modal-header{padding:14px 16px;}#appearanceModal .appearance-workspace{display:flex;flex-direction:column;overflow:auto;}#appearanceModal .appearance-panel{border-right:0;overflow:visible;padding:16px;flex-shrink:0;}#appearanceModal .appearance-preview-section{min-height:420px;flex-shrink:0;}#appearanceModal .appearance-preview-viewport{flex:none;height:min(70dvh,640px);}#appearanceModal .appearance-footer{padding:10px 12px;flex-wrap:wrap;}#appearanceModal .appearance-footer-actions{width:100%;}#appearanceModal .appearance-footer-actions .btn{flex:1;min-height:40px;}#appearanceModal .appearance-field :is(input,select){font-size:16px;}#appearanceModal .appearance-theme-delete{opacity:1;}}
  `;
}
