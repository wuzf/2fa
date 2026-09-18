/**
 * Fluent 2 dialog presentation. Loaded after legacy responsive rules.
 * All tokens and selectors stay inside dialogs; the main page keeps its theme.
 */
export function getDialogStyles() {
	return `
    .modal, .center-toast, .dialog-toast {
      --dialog-title-size: 20px;
      --dialog-section-size: 16px;
      --dialog-body-size: 14px;
      --dialog-caption-size: 12px;
      --dialog-control-size: 14px;
      --dialog-surface: #ffffff;
      --dialog-subtle: #fafafa;
      --dialog-hover: #f0f0f0;
      --dialog-text: #242424;
      --dialog-muted: #616161;
      --dialog-line: #e0e0e0;
      --dialog-stroke: #d1d1d1;
      --dialog-brand: #0f6cbd;
      --dialog-brand-hover: #115ea3;
      --dialog-selected: #eff6fc;
      --dialog-danger: #b10e1c;
      --dialog-danger-bg: #fdf3f4;
      --dialog-warning: #8a3707;
      --dialog-warning-bg: #fff9f5;
      --dialog-success: #107c10;
      --dialog-success-bg: #f1faf1;
      --dialog-shadow: 0 24px 64px #00000024, 0 2px 8px #00000012;
      --modal-bg: var(--dialog-surface);
      --modal-border: var(--dialog-line);
      --modal-header-border: var(--dialog-line);
      --modal-overlay: rgba(0, 0, 0, .34);
      --fab-modal-max-width: 560px;
      --fab-modal-sm-max-width: 440px;
      --fab-modal-lg-max-width: 720px;
      --radius-sm: 4px;
      --radius-md: 4px;
      --radius-lg: 8px;
      --text-primary: var(--dialog-text);
      --text-secondary: var(--dialog-muted);
      --text-tertiary: var(--dialog-muted);
      --text-link: var(--dialog-brand);
      --text-link-hover: var(--dialog-brand-hover);
      --bg-primary: var(--dialog-surface);
      --bg-secondary: var(--dialog-subtle);
      --bg-tertiary: var(--dialog-hover);
      --bg-hover: var(--dialog-hover);
      --bg-active: var(--dialog-selected);
      --border-primary: var(--dialog-line);
      --border-secondary: var(--dialog-stroke);
      --border-focus: var(--dialog-brand);
      --accent-color: var(--dialog-brand);
      --primary: var(--dialog-brand);
      --primary-rgb: 15, 108, 189;
      --btn-primary-bg: #0f6cbd;
      --btn-primary-hover: #115ea3;
      --btn-primary-text: #ffffff;
      --btn-secondary-bg: var(--dialog-surface);
      --btn-secondary-hover: var(--dialog-hover);
      --btn-secondary-text: var(--dialog-text);
      --input-bg: var(--dialog-surface);
      --input-bg-focus: var(--dialog-surface);
      --input-border: var(--dialog-stroke);
      --input-border-focus: var(--dialog-brand);
      --input-text: var(--dialog-text);
      --input-placeholder: var(--dialog-muted);
      --card-bg: var(--dialog-surface);
      --success: var(--dialog-success);
      --success-light: var(--dialog-success-bg);
      --success-color: var(--dialog-success);
      --success-dark: var(--dialog-success);
      --danger: var(--dialog-danger);
      --danger-dark: var(--dialog-danger);
      --danger-color: var(--dialog-danger);
      --danger-darker: var(--dialog-danger);
      --danger-light: var(--dialog-danger-bg);
      --warning: var(--dialog-warning);
      --warning-color: var(--dialog-warning);
      --warning-light: var(--dialog-warning-bg);
      --info-light: var(--dialog-selected);
      --tool-bg: var(--dialog-surface);
      --tool-hover-bg: var(--dialog-subtle);
      --tool-border: var(--dialog-line);
      --table-bg: var(--dialog-surface);
      --table-header-bg: var(--dialog-subtle);
      --table-header-text: var(--dialog-text);
      --table-header-border: var(--dialog-line);
      --table-border: var(--dialog-line);
      --shadow-sm: none;
      --shadow-md: none;
      font-family: 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', sans-serif;
      color: var(--dialog-text);
      font-size: var(--dialog-body-size);
      line-height: 1.5;
    }
    [data-theme="dark"] .modal, [data-theme="dark"] .center-toast, [data-theme="dark"] .dialog-toast {
      --dialog-surface: #292929;
      --dialog-subtle: #242424;
      --dialog-hover: #383838;
      --dialog-text: #ffffff;
      --dialog-muted: #bdbdbd;
      --dialog-line: #424242;
      --dialog-stroke: #666666;
      --dialog-brand: #62abf5;
      --dialog-brand-hover: #96c6fa;
      --dialog-selected: #20384c;
      --dialog-danger: #ff9a9f;
      --dialog-danger-bg: #3b2529;
      --dialog-warning: #f5b894;
      --dialog-warning-bg: #3d2924;
      --dialog-success: #9ad29a;
      --dialog-success-bg: #233323;
      --dialog-shadow: 0 24px 64px #0006, 0 2px 8px #0003;
      --modal-overlay: rgba(0, 0, 0, .48);
    }
    .modal {
      padding: 24px;
      backdrop-filter: none;
      overscroll-behavior: contain;
    }
    .modal .modal-content {
      padding: 24px;
      max-width: 560px;
      max-height: calc(100dvh - 48px);
      border: 1px solid var(--dialog-line);
      border-radius: 8px;
      box-shadow: var(--dialog-shadow);
      transform: translateY(6px);
      transition: opacity .16s ease, transform .16s ease;
      overscroll-behavior: contain;
    }
    .modal.show .modal-content { transform: translateY(0); }
    .modal.fab-modal-sm .modal-content, .modal .modal-content.fab-modal-sm-content { max-width: 440px; }
    .modal .modal-content.login-modal-content { max-width: 440px; }
    .modal.fab-modal-lg .modal-content { max-width: 720px; }
    .modal .modal-header {
      margin: 0 0 20px;
      padding: 0;
      border: 0;
      gap: 16px;
      min-height: 32px;
    }
    .modal .modal-header h2, .modal .login-modal-title, .modal .confirm-dialog-title {
      font-size: var(--dialog-title-size);
      font-weight: 600;
      line-height: 28px;
      text-align: left;
    }
    .modal .close-btn {
      width: 32px;
      height: 32px;
      min-width: 32px;
      padding: 6px;
      border-radius: 4px;
      color: var(--dialog-muted);
      flex-shrink: 0;
      transition: background .12s ease;
    }
    .modal .close-btn:hover { background: var(--dialog-hover); color: var(--dialog-text); }
    .modal .dialog-icon, .center-toast .dialog-icon {
      display: inline-block;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      vertical-align: middle;
    }
    .modal :is(button, input, select, textarea, summary, a):focus-visible {
      outline: 2px solid var(--dialog-brand);
      outline-offset: 2px;
    }
    .modal .btn {
      width: auto;
      min-width: 80px;
      min-height: 36px;
      padding: 6px 16px;
      border: 1px solid var(--dialog-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      background: var(--dialog-surface);
      color: var(--dialog-text);
      font: 600 var(--dialog-control-size)/20px 'Segoe UI', 'Microsoft YaHei', sans-serif;
      box-shadow: none;
      gap: 8px;
      transition: background-color .12s ease;
    }
    .modal .btn:hover { background: var(--dialog-hover); box-shadow: none; transform: none; }
    .modal .btn-primary { background: var(--btn-primary-bg); border-color: var(--btn-primary-bg); color: #fff; }
    .modal .btn-primary:hover { background: var(--btn-primary-hover); }
    .modal .btn-danger { background: #b10e1c; border-color: #b10e1c; color: #fff; }
    .modal .btn-danger:hover { background: #960b18; }
    .modal .btn-outline { border: 1px solid var(--dialog-stroke) !important; }
    .modal .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
    .modal :is(.form-actions, .modal-actions, .login-modal-actions, .confirm-dialog-actions) {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      margin: 24px -24px -24px;
      padding: 16px 24px;
      background: var(--dialog-subtle);
      border-top: 1px solid var(--dialog-line);
    }
    .modal .login-modal-actions .btn { flex: 0 1 auto; width: auto; }
    .modal .form-actions .btn, .modal .modal-actions .btn { flex: 0 1 auto; }
    .modal :is(.form-group, .tool-form-group) { margin-bottom: 20px; }
    .modal :is(.form-group, .form-group-small, .tool-form-group) label {
      font-size: var(--dialog-body-size);
      font-weight: 600;
      margin-bottom: 8px;
    }
    .modal .settings-field label { font-size: var(--dialog-body-size); line-height: 20px; }
    .modal small { font-size: var(--dialog-caption-size); }
    .modal input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
    .modal select, .modal textarea {
      font: inherit;
      font-size: var(--dialog-body-size);
      line-height: 20px;
      min-height: 36px;
      padding: 7px 10px;
      border: 1px solid var(--dialog-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      background: var(--dialog-surface);
      color: var(--dialog-text);
      box-shadow: none;
      transition: border-color .12s ease;
      max-width: 100%;
    }
    .modal input[type="hidden"] { display: none; }
    .modal :is(input, textarea)::placeholder { color: var(--dialog-muted); opacity: 1; }
    .modal :is(input, textarea, select):focus { border-bottom-color: var(--dialog-brand); box-shadow: inset 0 -1px var(--dialog-brand); }
    .modal :is(input[type="checkbox"], input[type="radio"]) { accent-color: var(--dialog-brand); width: 16px; height: 16px; }
    .modal .login-password-wrapper input { padding-right: 52px !important; }
    .modal .form-row { gap: 16px; margin-bottom: 16px; }
    .modal .form-section { margin: 20px 0; border: 0; border-top: 1px solid var(--dialog-line); border-radius: 0; box-shadow: none; background: transparent; overflow: visible; }
    .modal .section-header { padding: 16px 0; background: transparent; border: 0; }
    .modal .section-header:hover { background: transparent; }
    .modal .advanced-options { padding: 0 0 4px; background: transparent; }
    .modal :is(.advanced-info, .settings-info-box, .qr-info) {
      padding: 0;
      margin-top: 16px;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: var(--dialog-muted);
      font-size: var(--dialog-caption-size);
      line-height: 1.6;
      text-align: left;
    }
    .modal .advanced-info::before, .modal .preview-title::before { content: none; }
    .modal :is(.restore-instructions, .dialog-warning, .login-insecure-warning) {
      padding: 12px;
      background: var(--dialog-warning-bg);
      color: var(--dialog-warning);
      border: 1px solid color-mix(in srgb, var(--dialog-warning) 24%, transparent);
      border-radius: 4px;
      box-shadow: none;
      margin-bottom: 20px;
      font-size: var(--dialog-caption-size);
    }
    .modal .restore-instructions p { color: inherit; font-size: var(--dialog-caption-size); }
    .modal .restore-instructions p:last-child { background: transparent; border: 0; padding: 0; margin: 8px 0 0; }
    .modal .login-modal-description { text-align: left; }
    .modal .login-modal-error { color: var(--dialog-danger); text-align: left; }
    .modal .confirm-dialog-icon { color: var(--dialog-warning); display: flex; }
    .modal .confirm-dialog-message { margin: 0; font-size: var(--dialog-body-size); line-height: 1.65; }
    .modal .confirm-dialog-actions { flex-direction: row; }
    .modal .tools-list { margin: 0; border-radius: 0; background: transparent; }
    .modal .tool-item { width: 100%; align-items: center; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--dialog-line); padding: 16px 0; font: inherit; }
    .modal .tool-item:hover { background: var(--dialog-subtle); }
    .modal .tool-icon { width: 24px; height: 24px; margin-right: 16px; border: 0; background: transparent; border-radius: 0; color: var(--dialog-muted); }
    .modal .tool-title { font-size: var(--dialog-body-size); }
    .modal .tool-desc { font-size: var(--dialog-caption-size); }
    .modal .tool-section { background: transparent; border: 0; box-shadow: none; padding: 0; margin-bottom: 20px; }
    .modal .tool-section:last-child { margin-bottom: 0; }
    .modal .tool-section .section-title { font-size: var(--dialog-body-size); border: 0; margin-bottom: 12px; padding-bottom: 0; }
    .modal :is(.tool-description, .qr-subtitle-section) { color: var(--dialog-muted); font-size: var(--dialog-caption-size); background: transparent; border: 0; padding: 0; text-align: left; }
    .modal :is(.result-content, .key-result, .check-result, .time-info, .qr-decode-result) { border-radius: 4px; box-shadow: none; background: var(--dialog-subtle); }
    .modal .modal-content.settings-modal-content { padding: 0; max-width: 720px; }
    .modal .settings-modal-content .modal-header { margin: 0; padding: 20px 24px; }
    .modal .settings-tabs { width: 164px; padding: 8px 12px; background: var(--dialog-subtle); }
    .modal .settings-tab { position: relative; width: 100%; border: 0; border-radius: 4px; background: transparent; color: var(--dialog-text); padding: 10px 12px; min-height: 40px; margin-bottom: 4px; text-align: left; font: inherit; }
    .modal .settings-tab.active { background: var(--dialog-hover); font-weight: 600; }
    .modal .settings-tab.active::before { content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 2px; background: var(--dialog-brand); }
    .modal .settings-content { padding: 8px 24px 24px; }
    .modal .settings-modal-actions { display: flex; flex-shrink: 0; justify-content: flex-end; padding: 16px 24px; background: var(--dialog-subtle); border-top: 1px solid var(--dialog-line); }
    .modal .settings-section-title { font-size: var(--dialog-body-size); }
    .modal .settings-desc { font-size: var(--dialog-caption-size); }
    .modal .settings-panel[data-panel="sync"] .settings-section { margin: 0; }
    .modal .sync-card { width: 100%; padding: 16px 0; border: 0; border-bottom: 1px solid var(--dialog-line); border-radius: 0; background: transparent; text-align: left; font: inherit; }
    .modal .sync-card:hover { background: var(--dialog-subtle); box-shadow: none; }
    .modal .sync-card-info { min-width: 0; }
    .modal .sync-card-desc { line-height: 18px; }
    .modal .sync-card-icon { color: var(--dialog-muted); display: flex; }
    .modal .sync-card-header { gap: 12px; }
    .modal .sync-status { border: 1px solid var(--dialog-line); background: transparent; border-radius: 4px; padding: 2px 6px; font-size: var(--dialog-caption-size); }
    .modal .sync-status.configured { background: var(--dialog-success-bg); color: var(--dialog-success); }
    .modal .sync-status.not-configured { background: transparent; color: var(--dialog-muted); }
    .modal .theme-option { background: transparent; border: 1px solid var(--dialog-line); padding: 10px 12px; }
    .modal .theme-option:has(input:checked) { border-color: var(--dialog-brand); background: var(--dialog-selected); }
    .modal .theme-option-label { display: flex; align-items: center; gap: 10px; }
    .modal .settings-inline-group .settings-input { width: 80px; }
    .modal .change-password-result.error { color: var(--dialog-danger); background: var(--dialog-danger-bg); border-color: var(--dialog-danger); }
    .modal .change-password-result.success { color: var(--dialog-success); background: var(--dialog-success-bg); border-color: var(--dialog-success); }
    .modal .settings-result.error { color: var(--dialog-danger); }
    .modal .settings-result { font-size: var(--dialog-caption-size); }
    .modal .dialog-sync-form { border: 0; background: transparent; padding: 0; margin-bottom: 16px; }
    .modal .dest-card { border: 1px solid var(--dialog-line); border-radius: 4px; padding: 12px; background: transparent; margin-bottom: 12px; }
    .modal .dest-card-actions { flex-wrap: wrap; }
    .modal .btn-danger-outline { border-color: var(--dialog-danger); color: var(--dialog-danger); }
    .modal .btn-danger-outline:hover { background: var(--dialog-danger-bg); }
    .modal .dest-toggle input { width: 0; height: 0; }
    .modal .dest-toggle:has(input:focus-visible) { outline: 2px solid var(--dialog-brand); outline-offset: 3px; border-radius: 20px; }
    .modal .dest-toggle-slider { background: var(--dialog-stroke); }
    .modal .format-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .modal .format-card { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 2px 12px; min-height: 72px; padding: 12px; border: 1px solid var(--dialog-line); border-radius: 4px; background: transparent; text-align: left; font: inherit; }
    .modal .format-card:hover { background: var(--dialog-selected); border-color: var(--dialog-brand); box-shadow: none; }
    .modal .format-card .format-icon { grid-row: 1 / span 3; margin: 0; color: var(--dialog-muted); align-self: center; }
    .modal .format-card :is(.format-name, .format-ext, .format-compat) { grid-column: 2; text-align: left; margin: 0; }
    .modal .format-name { font-size: var(--dialog-body-size); line-height: 20px; }
    .modal .format-ext, .modal .format-compat { color: var(--dialog-muted); font-size: var(--dialog-caption-size); background: transparent; padding: 0; white-space: normal; }
    .modal .format-section-title { color: var(--dialog-muted); font-size: var(--dialog-caption-size); letter-spacing: 0; text-transform: none; }
    .modal .export-summary { padding: 0; background: transparent; flex-wrap: wrap; gap: 12px; }
    .modal .export-count { white-space: nowrap; }
    .modal .export-sort-wrapper { margin-left: auto; }
    .modal #exportUseDefaultBtn { flex-basis: 100%; }
    .modal :is(.format-option, .sub-format-option, .dialog-backup-format) { display: flex; width: 100%; align-items: center; gap: 12px; padding: 12px; margin: 0 0 8px; border: 1px solid var(--dialog-line); border-radius: 4px; background: transparent; color: var(--dialog-text); text-align: left; font: inherit; cursor: pointer; }
    .modal :is(.format-option, .sub-format-option, .dialog-backup-format):hover { background: var(--dialog-selected); border-color: var(--dialog-brand); box-shadow: none; }
    .modal .format-option .format-icon { margin: 0; color: var(--dialog-muted); }
    .modal .sub-format-option { flex-direction: row; }
    .modal .sub-format-icon { display: flex; color: var(--dialog-muted); }
    .modal .sub-format-name { font-size: var(--dialog-body-size); line-height: 20px; margin-bottom: 4px; }
    .modal :is(.sub-format-ext, .sub-format-desc, .sub-format-compat) { font-size: var(--dialog-caption-size); line-height: 18px; color: var(--dialog-muted); font-weight: 400; }
    .modal :is(.format-details, .import-format-details) { border: 0; border-top: 1px solid var(--dialog-line); border-radius: 0; }
    .modal :is(.format-details, .import-format-details) summary { background: transparent; padding: 12px 0; color: var(--dialog-muted); font-size: var(--dialog-caption-size); }
    .modal :is(.format-details, .import-format-details) summary::before { content: '›'; font-size: 18px; }
    .modal :is(.format-details, .import-format-details)[open] summary::before { transform: rotate(90deg); }
    .modal :is(.format-help-content, .import-format-help) { padding: 12px 0; }
    .modal .import-textarea-smart { border-style: solid; min-height: 144px; padding: 12px; }
    .modal .import-tips { background: transparent; padding: 0; justify-content: flex-start; }
    .modal .import-tip-divider { color: var(--dialog-stroke); }
    .modal :is(.file-info-badge, .import-preview-compact, .import-progress-panel) { background: var(--dialog-subtle); border: 1px solid var(--dialog-line); border-radius: 4px; padding: 12px; }
    .modal .timestamp-progress-track { width: 100%; height: var(--progress-height); background: var(--progress-bg); border-radius: 0; overflow: hidden; }
    .modal .import-progress-fill { background: var(--progress-fill); }
    .modal #progressBar { width: 100%; height: 100%; background: var(--progress-fill); transform-origin: left center; transition: none !important; }
    .modal .import-progress-percent { color: var(--dialog-brand); font-size: var(--dialog-caption-size); }
    .modal .preview-title { font-size: var(--dialog-body-size); }
    .modal .import-preview-list { max-height: 240px; }
    .modal :is(.backup-list-container, .backup-preview-content, .restore-preview) { background: transparent; box-shadow: none; border-radius: 4px; }
    .modal :is(.backup-list-header, .preview-header) {
      display: block;
      margin-bottom: 8px;
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      color: var(--dialog-text);
      font-size: var(--dialog-body-size);
      font-weight: 600;
      text-align: left;
    }
    .modal .backup-preview-content {
      padding: 0;
      border: 0;
      scrollbar-color: var(--dialog-stroke) var(--dialog-subtle);
    }
    .modal .backup-preview-content::-webkit-scrollbar-thumb { background: var(--dialog-stroke); }
    .modal .backup-preview-content::-webkit-scrollbar-thumb:hover { background: var(--dialog-muted); }
    .modal .backup-select {
      appearance: auto;
      background: var(--dialog-surface);
      border: 1px solid var(--dialog-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      min-height: 36px;
      padding: 7px 10px;
      font-size: var(--dialog-control-size);
    }
    .modal .backup-select option { font: inherit; }
    .modal .dialog-backup-formats { display: flex; flex-direction: column; gap: 0; }
    .modal .dialog-backup-format .dialog-icon { color: var(--dialog-muted); }
    .modal .dialog-backup-format strong { display: block; font-weight: 600; }
    .modal .dialog-backup-format small { font-size: var(--dialog-caption-size); color: var(--dialog-muted); }
    .modal .export-instructions { margin-bottom: 20px; font-size: var(--dialog-caption-size); }
    .modal .dialog-result-icon { display: flex; justify-content: center; margin-bottom: 12px; color: var(--dialog-brand); }
    .modal .dialog-result-actions { display: flex; justify-content: flex-end; }
    .modal .dialog-qr-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 200px; padding: 16px; background: var(--dialog-subtle); border: 1px solid var(--dialog-line); border-radius: 4px; color: var(--dialog-muted); font-size: var(--dialog-body-size); text-align: center; overflow-wrap: anywhere; }
    .modal .dialog-qr-state p { font-size: var(--dialog-caption-size); }
    .modal .dialog-qr-error .dialog-icon, .modal .dialog-qr-error strong { color: var(--dialog-danger); }
    .modal .dialog-encrypted-import { padding: 12px 0; }
    .modal .dialog-encrypted-import > strong { display: block; margin-bottom: 8px; font-size: var(--dialog-body-size); }
    .modal .dialog-encrypted-import > p { margin-bottom: 12px; color: var(--dialog-muted); font-size: var(--dialog-caption-size); }
    .modal .dialog-decrypt-controls { display: flex; flex-wrap: wrap; gap: 8px; }
    .modal .dialog-decrypt-controls input { flex: 1 1 140px; min-width: 0; }
    .modal .dialog-decrypt-controls button { flex: 0 0 auto; }
    .modal .dialog-backup-summary { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px 16px; margin-bottom: 16px; }
    .modal .dialog-backup-summary dt { color: var(--dialog-muted); font-size: var(--dialog-caption-size); }
    .modal .dialog-backup-summary dd { margin: 4px 0 0; font-size: var(--dialog-body-size); overflow-wrap: anywhere; }
    .modal .backup-table { border: 1px solid var(--dialog-line); border-radius: 4px; box-shadow: none; }
    .modal .backup-table thead, .modal .backup-table th { background: var(--dialog-subtle); color: var(--dialog-text); }
    .modal .backup-table th { border-bottom: 1px solid var(--dialog-line); font-size: var(--dialog-caption-size); text-transform: none; letter-spacing: 0; }
    .modal .backup-table tbody tr:hover { box-shadow: none; }
    .modal#qrScanModal .modal-content { max-height: calc(100dvh - 48px); }
    .modal#qrScanModal .scanner-bottom-actions { background: var(--dialog-surface); }
    .modal .scanner-hint { font-size: var(--dialog-caption-size); color: var(--dialog-muted); }
    .modal .video-wrapper { max-width: 100%; height: auto !important; aspect-ratio: 1; border: 1px solid var(--dialog-line); border-radius: 4px; box-shadow: none; }
    .modal .scanner-frame { border: 2px solid #fff; border-radius: 4px; box-shadow: none; }
    .modal .scanner-frame::before, .modal .scanner-frame::after, .modal .scanner-status::before, .modal .scanner-error::before, .modal .no-backups::before { content: none; }
    .modal .scanner-status { background: transparent; border: 0; border-radius: 0; box-shadow: none; font-size: var(--dialog-caption-size); padding: 8px 0; min-height: 0; margin-bottom: 12px; }
    .modal .scanner-error #errorMessage, .modal .scanner-description, .modal .continuous-scan-inline { font-size: var(--dialog-caption-size); }
    .modal .scanner-error { text-align: left; }
    .modal .btn-compact { font-size: var(--dialog-control-size) !important; padding: 6px 12px !important; }
    .modal .qr-code-container { max-width: 100%; padding: 16px; border-radius: 4px; box-shadow: none; }
    .modal .qr-code-container img { max-width: 100%; height: auto !important; }
    .modal .qr-display { max-width: 100%; }
    .modal #generatedQRCode { max-width: 100% !important; height: auto; }
    .modal .loading-backup, .modal .no-backups { font-size: var(--dialog-caption-size); font-style: normal; }
    .modal .loading-backup::before { content: ''; width: 18px; height: 18px; border: 2px solid var(--dialog-line); border-top-color: var(--dialog-brand); border-radius: 50%; }
    .dialog-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 100020; display: flex; align-items: center; gap: 10px; padding: 12px 16px; max-width: calc(100vw - 32px); border: 1px solid var(--dialog-line); border-radius: 6px; background: var(--dialog-surface); box-shadow: var(--dialog-shadow); }
    .dialog-spinner { width: 16px; height: 16px; flex-shrink: 0; border: 2px solid var(--dialog-line); border-top-color: var(--dialog-brand); border-radius: 50%; animation: spin .8s linear infinite; }
    .center-toast .toast-content { background: var(--dialog-surface); border: 1px solid var(--dialog-line); border-radius: 6px; box-shadow: var(--dialog-shadow); padding: 16px 24px; gap: 12px; backdrop-filter: none; text-align: left; }
    .center-toast .toast-icon { display: flex; color: var(--dialog-brand); margin: 0; }
    .center-toast .toast-message { color: var(--dialog-text); font-size: var(--dialog-body-size); font-weight: 400; }
    @media (max-width: 768px) {
      .modal { --dialog-title-size: 18px; }
      .modal:not(.confirm-dialog-modal) { align-items: center; padding: 16px; }
      .modal { padding: 16px; }
      .modal:not(.confirm-dialog-modal) .modal-content, .modal .modal-content {
        padding: 20px;
        max-height: calc(100dvh - 32px);
        border-radius: 8px;
        transform: translateY(6px);
      }
      .modal.show .modal-content, .modal:not(.confirm-dialog-modal).show .modal-content { transform: translateY(0); }
      .modal .close-btn { min-width: 44px; width: 44px; height: 44px; }
      .modal .modal-header h2 { font-size: 18px; }
      .modal .btn { min-height: 40px; }
      .modal .backup-select { min-height: 40px; font-size: 16px; }
      .modal input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), .modal select, .modal textarea { font-size: 16px; min-height: 40px; }
      .modal :is(.form-actions, .modal-actions, .login-modal-actions, .confirm-dialog-actions) { margin: 20px -20px -20px; padding: 14px 20px max(14px, env(safe-area-inset-bottom)); }
      .modal:not(.confirm-dialog-modal):not(#qrScanModal) .modal-content > .modal-header { top: -20px; padding-top: 8px; padding-bottom: 8px; }
      .modal .modal-content.settings-modal-content { padding: 0; }
      .modal .settings-modal-content .modal-header { padding: 16px 20px; top: 0 !important; }
      .modal .settings-tabs { width: auto; padding: 0 12px 12px; background: var(--dialog-surface); gap: 4px; }
      .modal .settings-layout { flex-direction: column; }
      .modal .settings-tabs { display: flex; flex-shrink: 0; border-right: 0; }
      .modal .settings-tab { flex: 1; }
      .modal .settings-tab-text { display: inline; }
      .modal .settings-tab { padding: 8px 10px; justify-content: center; border: 0; margin: 0; font-size: var(--dialog-body-size); }
      .modal .settings-tab.active::before { left: 12px; right: 12px; top: auto; bottom: 0; height: 3px; width: auto; }
      .modal .settings-content { padding: 8px 20px 20px; }
      .modal .settings-modal-actions { padding: 14px 20px max(14px, env(safe-area-inset-bottom)); }
      .modal .settings-tab-icon { display: none; }
      .modal .sync-card-header { gap: 8px; }
      .modal .sync-card-info { gap: 10px; }
      .modal .sync-card-desc { font-size: var(--dialog-caption-size); }
      .modal .confirm-dialog-actions .btn { width: auto; flex: 1; }
      .modal#qrScanModal .modal-content { max-height: calc(100dvh - 32px); }
      .modal .format-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .modal .format-card { padding: 10px; gap: 3px 8px; }
      .modal .format-card .format-icon { display: none; }
      .modal .format-card { grid-template-columns: minmax(0,1fr); }
      .modal .format-card :is(.format-name,.format-ext,.format-compat) { grid-column: 1; }
      .modal .export-sort-wrapper { margin-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .modal, .modal *, .modal *::before, .modal *::after, .center-toast, .dialog-toast, .dialog-spinner { transition: none !important; animation: none !important; }
    }
  `;
}
