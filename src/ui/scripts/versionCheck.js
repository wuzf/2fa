/**
 * 版本显示与新版本检测模块
 * 页面底部显示当前版本号，并定期检查 GitHub 仓库是否发布了新版本（tag）
 */

import { APP_VERSION } from '../../utils/version.js';

const GITHUB_REPO = 'wuzf/2fa';
// 检查结果缓存 24 小时，避免频繁请求 GitHub API（匿名限额 60 次/小时/IP）
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 官方底部、设置「关于」页和主题共用的链接 */
export const APP_LINKS = Object.freeze({
	documentation: `https://github.com/${GITHUB_REPO}/blob/main/README.md`,
	feedback: `https://github.com/${GITHUB_REPO}/issues`,
	source: `https://github.com/${GITHUB_REPO}`,
	releases: `https://github.com/${GITHUB_REPO}/releases/latest`,
	author: 'https://github.com/wuzf',
	themes: `https://github.com/${GITHUB_REPO}/blob/main/docs/THEMES.md`,
});

/**
 * 获取版本检测代码
 * @returns {string} 版本检测 JavaScript 代码
 */
export function getVersionCheckCode() {
	return `// ==================== 版本显示与新版本检测 ====================

    window.APP_VERSION = '${APP_VERSION}';
    let availableVersion = null;
    let latestVersionKnown = false;
    const APP_LINKS = ${JSON.stringify(APP_LINKS)};
    const RELEASE_NOTICE_KEY = '2fa-release-notice-dismissed';

    // 主题通过 SDK 的 host.about 读取；版本号不带 v 前缀
    function getAppAboutState() {
      return {
        version: window.APP_VERSION,
        latestVersion: availableVersion ? availableVersion.replace(/^v/i, '') : null,
        upToDate: latestVersionKnown && !availableVersion,
        author: 'wuzf',
        license: 'MIT',
        links: { ...APP_LINKS }
      };
    }

    function refreshVersionLanguage() {
      const badge = document.getElementById('footerUpdateBadge');
      if (badge && availableVersion) {
        badge.textContent = t('versionUpdateAvailable', { version: availableVersion });
        badge.style.display = '';
      }
      renderAboutPanel();
      renderReleaseNotice();
    }

    // 版本号和许可文字随 data-i18n 翻译；这里只处理检测结果
    function renderAboutPanel() {
      const status = document.getElementById('settingsAboutStatus');
      if (status) {
        status.textContent = availableVersion ? t('versionUpdateAvailable', { version: availableVersion }) : latestVersionKnown ? t('aboutUpToDate') : '';
        status.hidden = !status.textContent;
      }
      const update = document.getElementById('settingsAboutUpdate');
      if (update) update.hidden = !availableVersion;
    }

    // 应用主题会移除官方底部；这时由主程序自己提示新版本，每个版本关闭一次后不再出现
    function renderReleaseNotice() {
      const notice = document.getElementById('appReleaseNotice');
      if (!notice) return;
      let dismissed = null;
      try { dismissed = localStorage.getItem(RELEASE_NOTICE_KEY); } catch (e) { /* 读不到就照常提示 */ }
      if (!availableVersion || document.getElementById('footerUpdateBadge') || dismissed === availableVersion) {
        notice.hidden = true;
        notice.replaceChildren();
        return;
      }
      const message = document.createElement('span');
      message.className = 'app-release-notice-message';
      message.textContent = t('versionUpdateAvailable', { version: availableVersion });
      const view = document.createElement('a');
      view.className = 'app-release-notice-link';
      view.href = APP_LINKS.releases;
      view.target = '_blank';
      view.rel = 'noopener noreferrer';
      view.textContent = t('aboutViewUpdate');
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-release-notice-close';
      close.setAttribute('aria-label', t('close'));
      close.textContent = '×';
      close.onclick = () => {
        try { localStorage.setItem(RELEASE_NOTICE_KEY, availableVersion); } catch (e) { /* 只在本次隐藏 */ }
        notice.hidden = true;
        notice.replaceChildren();
      };
      notice.replaceChildren(message, view, close);
      notice.hidden = false;
    }

    function publishAppAbout() {
      refreshVersionLanguage();
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('host');
    }

    // 与 src/utils/version.js 的 compareVersions 逻辑一致。
    // 不能用 compareVersions.toString() 内联：esbuild 打包会往函数体注入 __name() 辅助调用，浏览器端没有该函数
    function compareVersions(a, b) {
      const parse = (v) =>
        String(v)
          .trim()
          .replace(/^v/i, '')
          .split('.')
          .map((n) => parseInt(n, 10) || 0);
      const pa = parse(a);
      const pb = parse(b);
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) {
          return 1;
        }
        if (x < y) {
          return -1;
        }
      }
      return 0;
    }

    /**
     * 检查 GitHub 仓库是否有新版本 tag，有则在 footer 显示提示
     */
    async function checkForNewVersion() {
      const CACHE_KEY = '2fa-version-check';
      const now = Date.now();

      let latest = null;
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && typeof cached.latest === 'string' && now - cached.checkedAt < ${CHECK_INTERVAL_MS}) {
          latest = cached.latest;
        }
      } catch (e) {
        // 缓存损坏，忽略
      }

      if (!latest) {
        try {
          const response = await fetch('https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=10', {
            headers: { Accept: 'application/vnd.github+json' },
          });
          if (!response.ok) return;
          const tags = await response.json();
          if (!Array.isArray(tags) || tags.length === 0) return;
          // 取语义化版本最大的 tag（API 返回顺序不保证按版本排列）
          latest = tags
            .map((t) => t.name)
            .filter((name) => /^v?\\d+(\\.\\d+)*$/.test(name))
            .sort(compareVersions)
            .pop();
          if (!latest) return;
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ latest, checkedAt: now }));
          } catch (e) {
            // 存储失败不影响本次提示
          }
        } catch (e) {
          // 网络失败（离线、被墙、限额）静默降级
          return;
        }
      }

      latestVersionKnown = true;
      if (compareVersions(latest, window.APP_VERSION) > 0) {
        availableVersion = latest.startsWith('v') ? latest : 'v' + latest;
      }
      publishAppAbout();
    }

    // 延迟执行，避免与首屏加载竞争
    window.addEventListener('load', () => {
      setTimeout(checkForNewVersion, 3000);
    });
`;
}
