import { dialogIcon } from './dialogIcons.js';
import { getStandaloneHead } from './standalone.js';

/** Complete, self-contained fallback when neither the network nor the page cache is available. */
export function createOfflinePage() {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  ${getStandaloneHead(
		'离线模式 - 2FA',
		`
    .offline-page { text-align: center; }
    .offline-page .page-icon { justify-content: center; color: var(--page-warning); }
    .offline-page .page-actions { justify-content: center; }
  `,
	)}
</head>
<body>
  <main class="standalone-card offline-page" aria-labelledby="offline-title">
    <div class="page-icon">${dialogIcon('cloud')}</div>
    <h1 class="page-title" id="offline-title">暂时无法连接</h1>
    <p class="page-description">当前处于离线模式，页面暂时无法打开。</p>
    <p class="page-notice">请检查网络连接，恢复后重新加载页面。</p>
    <div class="page-actions"><a class="page-button" href="/">重新加载</a></div>
  </main>
</body>
</html>`;
}
