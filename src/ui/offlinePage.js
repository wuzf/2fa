import { dialogIcon } from './dialogIcons.js';
import { getStandaloneHead, getStandaloneI18nScript, getStandaloneLanguageSelect } from './standalone.js';

/** Complete, self-contained fallback when neither the network nor the page cache is available. */
export function createOfflinePage() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getStandaloneHead(
		'Offline - 2FA',
		`
    .offline-page { text-align: center; }
    .offline-page .page-icon { justify-content: center; color: var(--page-warning); }
    .offline-page .page-actions { justify-content: center; }
  `,
	)}
</head>
<body>
  <main class="standalone-card offline-page" aria-labelledby="offline-title">
    <div class="standalone-language-row">${getStandaloneLanguageSelect()}</div>
    <div class="page-icon">${dialogIcon('cloud')}</div>
    <h1 class="page-title" id="offline-title" data-standalone-i18n="offlineTitle">Unable to connect</h1>
    <p class="page-description" data-standalone-i18n="offlineDescription">You are offline. This page is currently unavailable.</p>
    <p class="page-notice" data-standalone-i18n="offlineNotice">Check your connection and reload the page when you are back online.</p>
    <div class="page-actions"><a class="page-button" href="/" data-standalone-i18n="offlineReload">Reload</a></div>
  </main>
  <script>${getStandaloneI18nScript({ titleKey: 'offlinePageTitle' })}</script>
</body>
</html>`;
}
