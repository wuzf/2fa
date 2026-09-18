import { PROGRESS_HEIGHT } from './progress.js';

/** Fluent 2 presentation for the standalone first-time setup form. */
export function getSetupStyles() {
	return `
    :root {
      --setup-bg: #fafafa;
      --setup-surface: #ffffff;
      --setup-hover: #f0f0f0;
      --setup-text: #242424;
      --setup-muted: #616161;
      --setup-line: #e0e0e0;
      --setup-stroke: #d1d1d1;
      --setup-brand: #0f6cbd;
      --setup-danger: #b10e1c;
      --setup-danger-bg: #fdf3f4;
      --setup-warning: #8a3707;
      --setup-success: #107c10;
      --setup-success-bg: #f1faf1;
      --setup-shadow: 0 2px 4px #0000000a, 0 0 2px #0000000a;
      color-scheme: light;
    }
    [data-theme="dark"] {
      --setup-bg: #1f1f1f;
      --setup-surface: #292929;
      --setup-hover: #383838;
      --setup-text: #ffffff;
      --setup-muted: #bdbdbd;
      --setup-line: #424242;
      --setup-stroke: #666666;
      --setup-brand: #62abf5;
      --setup-danger: #ff9a9f;
      --setup-danger-bg: #3b2529;
      --setup-warning: #f5b894;
      --setup-success: #9ad29a;
      --setup-success-bg: #233323;
      --setup-shadow: 0 2px 4px #00000020;
      color-scheme: dark;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      padding: 24px;
      background: var(--setup-bg);
      color: var(--setup-text);
      font: 14px/20px 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }
    .setup-container {
      width: 100%;
      max-width: 440px;
      margin: auto;
      padding: 24px;
      background: var(--setup-surface);
      border: 1px solid var(--setup-line);
      border-radius: 8px;
      box-shadow: var(--setup-shadow);
    }
    .setup-header { text-align: left; margin-bottom: 24px; }
    .setup-icon { display: flex; color: var(--setup-brand); margin-bottom: 12px; }
    .setup-icon .dialog-icon { width: 24px; height: 24px; }
    .setup-title { font-size: 20px; font-weight: 600; line-height: 28px; margin-bottom: 8px; }
    .setup-description { color: var(--setup-muted); }
    .security-notice, .insecure-warning, .error-message, .success-message {
      padding: 12px;
      margin-bottom: 20px;
      border: 1px solid var(--setup-line);
      border-radius: 4px;
      font-size: 12px;
      line-height: 18px;
      overflow-wrap: anywhere;
    }
    .security-notice { background: var(--setup-bg); color: var(--setup-muted); }
    .security-notice strong, .insecure-warning strong { display: block; font-size: 14px; font-weight: 600; line-height: 20px; margin-bottom: 4px; }
    .security-notice strong { color: var(--setup-text); }
    .insecure-warning, .error-message { background: var(--setup-danger-bg); color: var(--setup-danger); border-left: 3px solid var(--setup-danger); }
    .success-message { background: var(--setup-success-bg); color: var(--setup-success); border-left: 3px solid var(--setup-success); }
    .error-message, .success-message { display: none; font-size: 14px; line-height: 20px; }
    .form-group { margin-bottom: 20px; }
    .form-label { display: block; font-weight: 600; margin-bottom: 6px; }
    .password-input-wrapper { position: relative; }
    .form-input {
      width: 100%;
      min-width: 0;
      min-height: 40px;
      padding: 8px 48px 8px 12px;
      border: 1px solid var(--setup-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      background: var(--setup-surface);
      color: var(--setup-text);
      font: inherit;
    }
    .form-input::placeholder { color: var(--setup-muted); opacity: 1; }
    .form-input:focus { border-color: var(--setup-brand); box-shadow: inset 0 -1px var(--setup-brand); }
    .toggle-password {
      position: absolute;
      inset: 0 0 0 auto;
      display: grid;
      place-items: center;
      width: 40px;
      padding: 8px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--setup-muted);
      cursor: pointer;
    }
    .toggle-password:hover { background: var(--setup-hover); color: var(--setup-text); }
    .password-requirements { margin-top: 8px; font-size: 12px; line-height: 18px; color: var(--setup-muted); }
    .password-requirements strong { font-weight: 600; }
    .password-requirements ul { padding-left: 18px; margin-top: 4px; }
    .password-requirements li { padding: 2px 0; }
    .password-strength { margin-top: 8px; height: ${PROGRESS_HEIGHT}; background: var(--setup-line); border-radius: 0; overflow: hidden; }
    .password-strength-bar { height: 100%; width: 0; border-radius: inherit; transition: width .16s ease; }
    .strength-weak { background: var(--setup-danger); width: 33%; }
    .strength-medium { background: var(--setup-warning); width: 66%; }
    .strength-strong { background: var(--setup-success); width: 100%; }
    .submit-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 36px; padding: 6px 16px; border: 1px solid #0f6cbd; border-radius: 4px; background: #0f6cbd; color: #ffffff; font: inherit; font-weight: 600; cursor: pointer; }
    .submit-button:hover { background: #115ea3; border-color: #115ea3; }
    .submit-button:disabled { background: var(--setup-hover); border-color: var(--setup-line); color: var(--setup-muted); cursor: not-allowed; }
    :is(button, input):focus-visible { outline: 2px solid var(--setup-brand); outline-offset: 2px; }
    .loading-spinner { width: 16px; height: 16px; border: 2px solid var(--setup-stroke); border-top-color: currentColor; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 600px) {
      body { padding: 16px; }
      .setup-container { padding: 20px; }
      .form-input { min-height: 44px; font-size: 16px; }
      .toggle-password { width: 44px; }
      .submit-button { min-height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .password-strength-bar { transition: none; }
      .loading-spinner { animation: none; }
    }
  `;
}
