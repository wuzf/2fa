/** Fluent 2 surfaces and controls for the main account workspace. */
export function getWorkspaceStyles() {
	return `
    .fluent-app {
      --workspace-bg: #fafafa;
      --workspace-surface: #ffffff;
      --workspace-hover: #f0f0f0;
      --workspace-selected: #eff6fc;
      --workspace-brand: #0f6cbd;
      --workspace-warning: #8a3707;
      --workspace-text: #242424;
      --workspace-muted: #616161;
      --workspace-line: #e0e0e0;
      --workspace-stroke: #d1d1d1;
      --workspace-shadow: 0 2px 4px #0000000a, 0 0 2px #0000000a;
      --workspace-menu-shadow: 0 8px 24px #0000001f, 0 1px 4px #00000014;
      --bg-primary: var(--workspace-bg);
      --bg-secondary: var(--workspace-bg);
      --bg-tertiary: var(--workspace-hover);
      --bg-hover: var(--workspace-hover);
      --text-primary: var(--workspace-text);
      --text-secondary: var(--workspace-muted);
      --text-tertiary: var(--workspace-muted);
      --text-link: var(--workspace-brand);
      --text-link-hover: var(--workspace-brand);
      --segmented-option-text: var(--workspace-muted);
      --border-primary: var(--workspace-line);
      --border-secondary: var(--workspace-stroke);
      --border-focus: var(--workspace-brand);
      --radius-sm: 4px;
      --radius-md: 4px;
      --radius-lg: 8px;
      --card-bg: var(--workspace-surface);
      --card-border: var(--workspace-line);
      --card-hover-border: var(--workspace-stroke);
      --card-shadow: var(--workspace-shadow);
      --card-hover-shadow: 0 4px 10px #0000000d, 0 1px 3px #0000000a;
      --otp-text: var(--workspace-text);
      --otp-next-text: var(--workspace-muted);
      --otp-next-bg: transparent;
      --otp-next-bg-hover: var(--workspace-hover);
      --input-text: var(--workspace-text);
      --input-placeholder: var(--workspace-muted);
      --search-bg: var(--workspace-surface);
      --search-border: var(--workspace-stroke);
      --search-border-focus: var(--workspace-brand);
      --search-icon: var(--workspace-muted);
      --menu-bg: var(--workspace-surface);
      --menu-border: var(--workspace-line);
      --menu-item-hover: var(--workspace-hover);
      --menu-shadow: var(--workspace-menu-shadow);
      --footer-bg: transparent;
      --footer-text: var(--workspace-muted);
      --footer-border: var(--workspace-line);
      --primary: var(--workspace-brand);
      --accent-color: var(--workspace-brand);
      --danger: #b10e1c;
      --danger-light: #fdf3f4;
      font-family: 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', sans-serif;
      font-size: 14px;
      background: #ffffff;
      color: var(--workspace-text);
      color-scheme: light;
      padding: 0;
    }
    [data-theme="dark"] .fluent-app {
      --workspace-bg: #1f1f1f;
      --workspace-surface: #292929;
      --workspace-hover: #383838;
      --workspace-selected: #20384c;
      --workspace-brand: #62abf5;
      --workspace-warning: #f5b894;
      --workspace-text: #ffffff;
      --workspace-muted: #bdbdbd;
      --workspace-line: #424242;
      --workspace-stroke: #666666;
      --workspace-shadow: 0 2px 4px #00000020;
      --workspace-menu-shadow: 0 8px 24px #00000055, 0 1px 4px #00000033;
      --danger: #ff9a9f;
      --danger-light: #3b2529;
      background: var(--workspace-bg);
      color-scheme: dark;
    }
    .fluent-app > .container { max-width: 1400px; }
    .fluent-app .content { padding: 24px 24px 40px; text-align: left; }
    .fluent-app .search-section { margin-bottom: 24px; }
    .fluent-app .clock-warning { background: var(--workspace-surface); border: 1px solid var(--workspace-line); border-left: 3px solid var(--workspace-warning); border-radius: 4px; }
    .fluent-app .clock-warning-icon { color: var(--workspace-warning); display: flex; }
    .fluent-app .search-action-row { gap: 12px; }
    .fluent-app .search-input-wrapper { border: 1px solid var(--search-border); border-bottom-color: #8a8a8a; border-radius: 4px; }
    .fluent-app .search-input-wrapper:focus-within { border-color: var(--workspace-brand); box-shadow: inset 0 -1px var(--workspace-brand); }
    .fluent-app .search-input, .fluent-app .search-icon, .fluent-app .search-clear { height: 40px; }
    .fluent-app .search-input { font: inherit; padding: 8px 40px 8px 0; min-width: 0; }
    .fluent-app .search-icon { padding: 10px 12px; }
    .fluent-app .search-clear { padding: 8px 10px; }
    .fluent-app .search-clear:hover { color: var(--workspace-text); }
    .fluent-app .search-icon svg, .fluent-app .search-clear svg, .fluent-app .submenu-item svg { width: 20px; height: 20px; }
    .fluent-app .sort-trigger { height: 42px; font: inherit; border: 1px solid var(--workspace-stroke); border-radius: 4px; background: var(--workspace-surface); }
    .fluent-app .sort-trigger:hover { background: var(--workspace-hover); }
    .fluent-app .sort-dropdown[open] > .sort-trigger { border-color: var(--workspace-brand); box-shadow: none; }
    .fluent-app :is(.sort-menu, .card-menu-dropdown, .action-submenu) { border: 1px solid var(--workspace-line); border-radius: 6px; background: var(--workspace-surface); box-shadow: var(--workspace-menu-shadow); backdrop-filter: none; }
    .fluent-app .sort-menu-label { font-size: 12px; font-weight: 400; line-height: 18px; padding: 8px; }
    .fluent-app .view-mode-segmented { border-radius: 4px; background: var(--workspace-bg); }
    .fluent-app :is(.view-mode-option, .group-sort-option) { font-size: 14px; }
    .fluent-app :is(.view-mode-option.active, .group-sort-option.active, .sort-option.active) { color: var(--workspace-brand); background: var(--workspace-selected); box-shadow: none; }
    .fluent-app .sort-option.active::before { color: var(--workspace-brand); }
    .fluent-app :is(.sort-option, .menu-item) { font: inherit; border-radius: 4px; }
    .fluent-app .service-group-title { font-size: 14px; font-weight: 600; color: var(--workspace-text); }
    .fluent-app .service-group-count { font-size: 12px; }
    .fluent-app .service-group-header { margin-bottom: 12px; gap: 8px; }
    .fluent-app .service-group + .service-group { margin-top: 28px; }
    .fluent-app .secrets-list, .fluent-app .service-group-grid { grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; }
    .fluent-app .secret-card { --card-shadow: 0 1px 2px #00000005; --card-hover-shadow: 0 2px 4px #00000008; display: flex; flex-direction: column; padding: 20px; min-width: 0; border: 1px solid var(--card-border); border-radius: 16px; background: var(--card-bg); box-shadow: var(--card-shadow); -webkit-tap-highlight-color: transparent; transition: border-color .12s ease, box-shadow .12s ease; }
    [data-theme="dark"] .fluent-app .secret-card { --card-shadow: 0 1px 2px #00000010; }
    /* Isolate offscreen cards and group headings from the body's animated text. */
    .fluent-app .secret-card, .fluent-app .service-group-header { color: var(--workspace-text); }
    .fluent-app .secret-card:hover { border-color: var(--card-hover-border); box-shadow: var(--card-hover-shadow); }
    .fluent-app .secret-card:active { background: var(--workspace-selected); }
    .fluent-app .secret-card button { -webkit-tap-highlight-color: transparent; }
    /* Keep keyboard/press feedback outside the countdown; pointer focus must not leave a persistent ring. */
    .fluent-app .secret-card:active { outline: 2px solid var(--workspace-brand); outline-offset: 3px; }
    :root:not([data-card-input="pointer"]) .fluent-app .secret-card:has(:focus-visible) { outline: 2px solid var(--workspace-brand); outline-offset: 3px; }
    :root[data-card-input="pointer"] .fluent-app .secret-card :focus-visible { outline: none; }
    /* Reserve three text lines, including the optional HOTP counter, across every grid row and group. */
    .fluent-app .card-header { height: 60px; flex-shrink: 0; margin-bottom: 0; gap: 12px; }
    .fluent-app .secret-info { align-items: center; gap: 12px; }
    .fluent-app .service-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--workspace-bg); border: 1px solid var(--workspace-line); font-size: 14px; font-weight: 600; }
    .fluent-app .secret-text h3 { display: flex; align-items: baseline; gap: 4px; font-size: 14px; line-height: 20px; margin-bottom: 2px; }
    .fluent-app .secret-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluent-app .secret-type { flex-shrink: 0; font-size: 11px; color: var(--workspace-muted); font-weight: 500; }
    .fluent-app .secret-text p { font-size: 12px; line-height: 18px; color: var(--workspace-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fluent-app .card-menu { padding: 0; margin: -4px -4px 0 0; min-width: 32px; min-height: 32px; display: block; }
    .fluent-app .card-menu:hover { background: transparent; }
    .fluent-app .card-menu-trigger { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--workspace-muted); cursor: pointer; }
    .fluent-app .card-menu-trigger:hover { background: var(--workspace-hover); color: var(--workspace-text); }
    .fluent-app .menu-dots { color: inherit; font: 24px/1 'Segoe UI',sans-serif; }
    .fluent-app .card-menu-dropdown { top: 0; right: 0; min-width: 128px; padding: 4px; }
    .fluent-app .card-menu-dropdown .menu-item { display: block; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; background: transparent; text-align: left; }
    .fluent-app .card-menu-dropdown .menu-item:hover { background: var(--workspace-hover); }
    .fluent-app .otp-preview { margin-top: auto; padding: 4px 0 16px; }
    .fluent-app .otp-main { gap: 12px; }
    .fluent-app .otp-code { font-family: 'Segoe UI Variable Display','Segoe UI','Microsoft YaHei',sans-serif; font-size: 32px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 40px; letter-spacing: 1.5px; margin: 0; padding: 0; border-radius: 4px; white-space: nowrap; }
    .fluent-app .otp-code:hover { color: var(--workspace-brand); }
    .fluent-app .otp-next-container { min-width: 64px; padding: 4px 6px; border: 0; border-radius: 4px; font-family: inherit; background: var(--otp-next-bg); color: var(--workspace-muted); }
    .fluent-app .otp-next-container:hover { background: var(--otp-next-bg-hover); }
    .fluent-app .otp-next-label { display: none; }
    .fluent-app .otp-next-code { font-family: 'Segoe UI Variable Text','Segoe UI',sans-serif; font-size: 14px; font-variant-numeric: tabular-nums; font-weight: 500; line-height: 20px; letter-spacing: .5px; }
    .fluent-app .progress-top { left: 16px; right: 16px; top: -1px; border-radius: 0; }
    .fluent-app .progress-top-fill { background: var(--progress-fill); }
    .fluent-app .main-action-button { --action-btn-shadow: 0 2px 8px #00000026; background: #8e44ad; border: 1px solid #8e44ad; border-radius: 50%; color: #fff; box-shadow: var(--action-btn-shadow); transition: background .12s ease, transform .16s ease; }
    .fluent-app .main-action-button:hover { background: #7d3c98; border-color: #7d3c98; box-shadow: 0 2px 8px #00000026; transform: none; }
    .fluent-app .main-action-button.active { transform: none; background: #7d3c98; border-color: #7d3c98; }
    .fluent-app .main-action-button .dialog-icon { width: 24px; height: 24px; transition: transform .16s ease; }
    .fluent-app .main-action-button.active .dialog-icon { transform: rotate(45deg); }
    .fluent-app .action-submenu { padding: 4px; }
    .fluent-app .submenu-item { width: 100%; padding: 10px 12px; min-height: 40px; gap: 12px; border: 0; border-radius: 4px; font: inherit; text-align: left; background: transparent; }
    .fluent-app .submenu-item:hover { background: var(--workspace-hover); }
    .fluent-app .submenu-item .item-icon { display: flex; align-items: center; justify-content: center; color: var(--workspace-muted); margin: 0; width: 20px; }
    .fluent-app .submenu-item .item-text { color: var(--workspace-text); }
    .fluent-app .empty-state { color: var(--workspace-muted); padding: 72px 24px; }
    .fluent-app .empty-state .icon { margin-bottom: 16px; color: var(--workspace-brand); line-height: 1; }
    .fluent-app .empty-state .icon svg { width: 36px; height: 36px; }
    .fluent-app .empty-state h3 { font-size: 20px; font-weight: 600; color: var(--workspace-text); margin-bottom: 8px; }
    .fluent-app .empty-state p { font-size: 14px; line-height: 22px; }
    .fluent-app .workspace-action { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 6px 16px; margin-top: 20px; border: 1px solid #0f6cbd; border-radius: 4px; background: #0f6cbd; color: #fff; font: 600 14px/20px 'Segoe UI','Microsoft YaHei',sans-serif; cursor: pointer; }
    .fluent-app .workspace-action:hover { background: #115ea3; }
    .fluent-app .page-footer { background: transparent; font-size: 12px; padding-bottom: 28px; border-top: 1px solid var(--workspace-line); }
    .fluent-app .footer-link, .fluent-app .footer-info { color: var(--workspace-muted); }
    .fluent-app .footer-link:hover { color: var(--workspace-brand); }
    .fluent-app :is(.search-clear,.sort-trigger,.card-menu-trigger,.menu-item,.submenu-item,.main-action-button,.otp-code,.otp-next-container,.workspace-action):focus-visible { outline: 2px solid var(--workspace-brand); outline-offset: 3px; }
    @media (max-width: 768px) {
      .fluent-app .content { padding: 16px 16px 32px; }
      .fluent-app .search-section { margin-bottom: 20px; }
      .fluent-app .search-input { font-size: 16px; }
      .fluent-app .search-input, .fluent-app .search-icon, .fluent-app .search-clear { height: 42px; }
      .fluent-app .sort-trigger { height: 44px; width: 44px; }
      .fluent-app .secrets-list, .fluent-app .service-group-grid { grid-template-columns: repeat(auto-fill,minmax(260px,1fr)); gap: 12px; }
      .fluent-app .secret-card { padding: 16px; }
      .fluent-app .card-menu, .fluent-app .card-menu-trigger { min-width: 44px; min-height: 44px; width: 44px; height: 44px; }
      .fluent-app .otp-code { font-size: 30px; letter-spacing: 1px; line-height: 40px; }
      .fluent-app .otp-next-container { padding: 4px 6px; min-width: 64px; }
      .fluent-app .otp-preview { padding: 2px 0 14px; }
      .fluent-app .menu-item, .fluent-app .submenu-item, .fluent-app .workspace-action { min-height: 44px; }
    }
    @media (max-width: 360px) {
      .fluent-app .content { padding: 12px 12px 24px; }
      .fluent-app .secrets-list, .fluent-app .service-group-grid { grid-template-columns: minmax(0,1fr); }
      .fluent-app .secret-card { padding: 14px; }
      .fluent-app .otp-code { font-size: 28px; letter-spacing: .5px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .fluent-app .secret-card, .fluent-app .main-action-button, .fluent-app .main-action-button .dialog-icon { transition: none; }
    }
  `;
}
