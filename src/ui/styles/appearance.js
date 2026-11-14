/** Stable public theme surface. Third party styles are loaded after these rules. */
export function getAppearanceStyles() {
	return `
    :root {
      --2fa-background:#fafafa; --2fa-surface:#fff; --2fa-text:#242424;
      --2fa-muted:#616161; --2fa-accent:#0f6cbd; --2fa-border:#e0e0e0; --2fa-hover:#f0f0f0;
      --2fa-radius:8px; --2fa-shadow:0 2px 4px #0000000a; --2fa-font:'Segoe UI Variable Text','Segoe UI',sans-serif;
      --2fa-code-font:ui-monospace,SFMono-Regular,Consolas,monospace; --2fa-font-size:14px;
      --2fa-page-width:1400px; --2fa-sidebar-width:220px; --2fa-gap:24px; --2fa-card-padding:20px;
      --2fa-icon-size:30px; --2fa-background-image:none; --2fa-animation-duration:180ms;
    }
    :root[data-theme="dark"] {--2fa-background:#1f1f1f;--2fa-surface:#292929;--2fa-text:#fff;--2fa-muted:#bdbdbd;--2fa-accent:#62abf5;--2fa-border:#424242;--2fa-hover:#383838;}
    :root[data-appearance-ready] .fluent-app {
      --workspace-bg:var(--2fa-background);--workspace-surface:var(--2fa-surface);--workspace-text:var(--2fa-text);
      --workspace-muted:var(--2fa-muted);--workspace-brand:var(--2fa-accent);--workspace-line:var(--2fa-border);
      --workspace-stroke:var(--2fa-border);--workspace-hover:var(--2fa-hover);--workspace-shadow:var(--2fa-shadow);
      --dialog-bg:var(--2fa-surface);--dialog-text:var(--2fa-text);--dialog-muted:var(--2fa-muted);--dialog-border:var(--2fa-border);
      --radius-sm:var(--2fa-radius);--radius-md:var(--2fa-radius);--radius-lg:var(--2fa-radius);
      background:var(--2fa-background);background-image:var(--2fa-background-image);background-size:cover;background-attachment:fixed;
      color:var(--2fa-text);font-family:var(--2fa-font);font-size:var(--2fa-font-size);
    }
    :root[data-appearance-ready] .fluent-app > .container, :root[data-appearance-ready] .fluent-app > :where(#officialThemeRoot) > .container { max-width:var(--2fa-page-width); }
    :root[data-appearance-ready] .modal,:root[data-appearance-ready] .center-toast,:root[data-appearance-ready] .dialog-toast {
      --dialog-surface:var(--2fa-surface);--dialog-subtle:var(--2fa-background);--dialog-hover:var(--2fa-hover);
      --dialog-text:var(--2fa-text);--dialog-muted:var(--2fa-muted);--dialog-line:var(--2fa-border);--dialog-stroke:var(--2fa-border);
      --dialog-brand:var(--2fa-accent);--dialog-brand-hover:var(--2fa-accent);--dialog-body-size:var(--2fa-font-size);
      --btn-primary-bg:var(--2fa-accent);--btn-primary-hover:var(--2fa-accent);font-family:var(--2fa-font);
    }
    .appearance-layout {display:grid;grid-template-columns:minmax(0,1fr);gap:var(--2fa-gap);align-items:start;}
    :where(.appearance-layout) [data-region] {min-width:0;display:flex;flex-direction:column;gap:var(--2fa-gap);}
    .appearance-layout [data-region][hidden],.appearance-layout [data-component-id][hidden] {display:none!important;}
    .appearance-layout [data-region="header"],.appearance-layout [data-region="footer"] {grid-column:1/-1;}
    .appearance-layout [data-region="main"] {grid-column:1;grid-row:3;}
    .appearance-layout [data-region="leading"] {grid-column:1;grid-row:2;}
    .appearance-layout [data-region="trailing"] {grid-column:1;grid-row:4;}
    .appearance-layout [data-region="footer"] {grid-row:5;}
    .appearance-layout .search-section {margin:-12px 0;}
    .appearance-layout [data-part="view-controls"] {align-self:flex-end;}
    .appearance-layout [data-part="accounts"] {min-width:0;}
    .appearance-layout [data-part="system-status"]:empty {display:none;}
    .appearance-layout [data-part="accounts"] .secrets-list[data-view="grouped"] {display:block;}
    .appearance-layout [data-part="accounts"] .secrets-list[data-view="flat"] {display:grid;}
    .appearance-layout .page-footer {margin:0;padding:16px 0;width:100%;}
    /* Keep public component hooks while preserving the original Fluent boxes. */
    [data-native-component] {display:contents;}
    [data-part="brand"] {display:flex;align-items:center;gap:12px;}
    [data-part="brand"] img {width:44px;height:44px;object-fit:contain;border-radius:var(--2fa-radius);}
    [data-part="brand"] strong {font-size:1.3em;letter-spacing:-.025em;}
    [data-part="brand"] p {margin:5px 0 0;color:var(--2fa-muted);}
    [data-part="service-nav"] summary {cursor:pointer;color:var(--2fa-muted);font-size:.85em;font-weight:600;margin-bottom:12px;}
    [data-part="service-nav"] nav {display:flex;flex-direction:column;gap:4px;}
    .appearance-service {display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;width:100%;background:transparent;color:var(--2fa-text);border:0;border-radius:var(--2fa-radius);padding:10px 12px;font:inherit;cursor:pointer;}
    .appearance-service:hover {background:var(--2fa-hover);}
    .appearance-service[aria-current="true"] {background:color-mix(in srgb,var(--2fa-accent) 12%,transparent);color:var(--2fa-accent);font-weight:600;}
    .appearance-service span:first-child {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .appearance-service span:last-child {font-size:.85em;opacity:.75;}
    .appearance-service-clear {margin-top:10px;padding:5px 10px;border:1px solid var(--2fa-border);border-radius:var(--2fa-radius);background:var(--2fa-surface);color:var(--2fa-accent);font:inherit;cursor:pointer;}
    .appearance-service-clear[hidden] {display:none!important;}
    [data-part="image"] img {display:block;max-width:100%;height:auto;border-radius:var(--2fa-radius);}
    [data-part="text"] {white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;}
    [data-part="links"] {display:flex;flex-direction:column;gap:10px;}
    [data-part="links"] a {color:var(--2fa-accent);text-decoration:none;overflow-wrap:anywhere;}
    :where(:root[data-appearance-ready] .fluent-app) .secret-card {border-radius:var(--2fa-radius);padding:var(--2fa-card-padding);box-shadow:var(--2fa-shadow);}
    /* Even blur(0px) isolates a card's menu; lift its owner above cards and the toolbar (20), below app popups and dialogs. */
    [data-part="account"]:has(.card-menu-dropdown.show) {z-index:30;}
    [data-part="account-header"] {width:100%;min-width:0;}
    [data-part="service-icon"] img {width:var(--2fa-icon-size);height:var(--2fa-icon-size);object-fit:contain;border-radius:6px;}
    [data-part="service-icon"] img[hidden],[data-part="service-icon"] span[hidden] {display:none;}
    [data-part="counter"] {font-size:11px;color:var(--2fa-muted);margin-top:2px;}
    :where(:root[data-appearance-ready] .fluent-app) .otp-code {font-family:var(--2fa-code-font);}
    [data-actions-mode="toolbar"] .action-menu-float {position:relative;inset:auto;z-index:20;width:100%;height:auto;}
    [data-actions-mode="toolbar"] .action-menu-float #mainActionBtn {display:none;}
    [data-actions-mode="toolbar"] .action-menu-float .action-submenu {position:static;inset:auto;display:flex;flex-wrap:wrap;gap:4px;opacity:1;visibility:visible;transform:none;pointer-events:auto;width:auto;min-width:0;background:transparent;box-shadow:none;border:0;padding:0;}
    [data-actions-mode="toolbar"] .action-menu-float .submenu-item {width:auto;padding:8px 10px;}
    [data-actions-mode="toolbar"] .action-menu-float .submenu-item .item-text {white-space:nowrap;}
    .appearance-preview-notice {padding:8px 16px;border-bottom:1px solid var(--2fa-border);font-size:12px;color:var(--2fa-muted);}
    .appearance-preview-login {max-width:360px;margin:48px auto;padding:24px;border:1px solid var(--2fa-border);border-radius:var(--2fa-radius);background:var(--2fa-surface);}
    .appearance-preview-login input,.appearance-preview-login button {font:inherit;width:100%;padding:12px;margin-top:12px;border:1px solid var(--2fa-border);border-radius:var(--2fa-radius);}
    .appearance-preview-login button {background:var(--2fa-accent);color:white;cursor:pointer;}
    @media (min-width: 768px) {
      .appearance-layout[data-leading="true"] {grid-template-columns:var(--2fa-sidebar-width) minmax(0,1fr);}
      .appearance-layout[data-leading="true"] [data-region="leading"] {grid-column:1;grid-row:2;}
      .appearance-layout[data-leading="true"] [data-region="main"],.appearance-layout[data-leading="true"] [data-region="trailing"] {grid-column:2;}
      .appearance-layout [data-region="main"] {grid-row:2;}
      .appearance-layout [data-region="trailing"] {grid-row:3;}
      .appearance-layout [data-region="footer"] {grid-row:4;}
    }
    @media (min-width: 1200px) {
      .appearance-layout[data-leading="true"][data-trailing="true"] {grid-template-columns:var(--2fa-sidebar-width) minmax(0,1fr) var(--2fa-sidebar-width);}
      .appearance-layout[data-leading="false"][data-trailing="true"] {grid-template-columns:minmax(0,1fr) var(--2fa-sidebar-width);}
      .appearance-layout[data-trailing="true"] [data-region="trailing"] {grid-column:-2;grid-row:2;}
      .appearance-layout [data-region="footer"] {grid-row:3;}
    }
    @media (prefers-reduced-motion: reduce) { :root {--2fa-animation-duration:0ms;} }
  `;
}
