/** Shared Fluent presentation for pages rendered outside the account workspace. */
export function getStandaloneThemeScript() {
	return `
    (function () {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      function applyPageTheme() {
        let theme = 'auto';
        try { theme = localStorage.getItem('theme') || 'auto'; } catch { /* Storage may be unavailable in exported files. */ }
        const dark = theme === 'dark' || (theme !== 'light' && media.matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      }
      applyPageTheme();
      if (media.addEventListener) media.addEventListener('change', applyPageTheme);
      else if (media.addListener) media.addListener(applyPageTheme);
      window.addEventListener('storage', function (event) {
        if (event.key === 'theme' || event.key === null) applyPageTheme();
      });
    })();
  `;
}

export function getStandaloneStyles() {
	const darkTokens = `
      --page-bg: #1f1f1f;
      --page-surface: #292929;
      --page-hover: #383838;
      --page-text: #ffffff;
      --page-muted: #bdbdbd;
      --page-line: #424242;
      --page-stroke: #666666;
      --page-brand: #62abf5;
      --page-danger: #ff9a9f;
      --page-warning: #f5b894;
      --page-success: #9ad29a;
      --page-shadow: 0 2px 4px #00000020;
      color-scheme: dark;
  `;
	return `
    :root {
      --page-bg: #fafafa;
      --page-surface: #ffffff;
      --page-hover: #f0f0f0;
      --page-text: #242424;
      --page-muted: #616161;
      --page-line: #e0e0e0;
      --page-stroke: #d1d1d1;
      --page-brand: #0f6cbd;
      --page-danger: #b10e1c;
      --page-warning: #8a3707;
      --page-success: #107c10;
      --page-shadow: 0 2px 4px #0000000a, 0 0 2px #0000000a;
      color-scheme: light;
    }
    :root[data-theme="dark"] { ${darkTokens} }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { ${darkTokens} }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      padding: 24px;
      background: var(--page-bg);
      color: var(--page-text);
      font: 14px/20px 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }
    .standalone-card {
      width: 100%;
      max-width: 440px;
      min-width: 0;
      margin: auto;
      padding: 24px;
      background: var(--page-surface);
      border: 1px solid var(--page-line);
      border-radius: 8px;
      box-shadow: var(--page-shadow);
      overflow-wrap: anywhere;
    }
    .page-icon { display: flex; color: var(--page-brand); margin-bottom: 12px; }
    .page-icon .dialog-icon { width: 24px; height: 24px; }
    .page-title { margin: 0 0 8px; font-size: 20px; line-height: 28px; font-weight: 600; }
    .page-description { margin: 0 0 24px; color: var(--page-muted); }
    .page-label { display: block; margin-bottom: 6px; font-weight: 600; }
    .page-input {
      width: 100%;
      min-width: 0;
      min-height: 40px;
      padding: 8px 12px;
      border: 1px solid var(--page-stroke);
      border-bottom-color: #8a8a8a;
      border-radius: 4px;
      background: var(--page-surface);
      color: var(--page-text);
      font: inherit;
    }
    .page-input::placeholder { color: var(--page-muted); opacity: 1; }
    .page-input:focus { border-color: var(--page-brand); box-shadow: inset 0 -1px var(--page-brand); }
    .page-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 6px 16px;
      border: 1px solid #0f6cbd;
      border-radius: 4px;
      background: #0f6cbd;
      color: #ffffff;
      font: inherit;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .page-button:hover { background: #115ea3; border-color: #115ea3; }
    .page-link { color: var(--page-brand); text-underline-offset: 3px; }
    .page-link:hover { text-decoration-thickness: 2px; }
    .page-notice { padding: 12px; margin: 20px 0; border: 1px solid var(--page-line); border-radius: 4px; background: var(--page-bg); color: var(--page-muted); font-size: 12px; line-height: 18px; }
    .page-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 24px; }
    :is(button, input, a, [tabindex]):focus-visible { outline: 2px solid var(--page-brand); outline-offset: 3px; }
    @media (max-width: 600px) {
      body { padding: 16px; }
      .standalone-card { padding: 20px; }
      .page-input { min-height: 44px; font-size: 16px; }
      .page-button { min-height: 44px; }
    }
  `;
}

export function getStandaloneHead(title, extraStyles = '') {
	const safeTitle = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${safeTitle}</title>
    <script>${getStandaloneThemeScript()}</script>
    <style>${getStandaloneStyles()}${extraStyles}</style>
  `;
}
