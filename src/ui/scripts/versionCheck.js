/**
 * 版本显示与新版本检测模块
 * 页面底部显示当前版本号，并定期检查 GitHub 仓库是否发布了新版本（tag）
 */

import { APP_VERSION } from '../../utils/version.js';

const GITHUB_REPO = 'wuzf/2fa';
// 检查结果缓存 24 小时，避免频繁请求 GitHub API（匿名限额 60 次/小时/IP）
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 获取版本检测代码
 * @returns {string} 版本检测 JavaScript 代码
 */
export function getVersionCheckCode() {
	return `// ==================== 版本显示与新版本检测 ====================

    window.APP_VERSION = '${APP_VERSION}';

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

      if (compareVersions(latest, window.APP_VERSION) > 0) {
        const badge = document.getElementById('footerUpdateBadge');
        if (badge) {
          badge.textContent = '🆕 有新版本 ' + (latest.startsWith('v') ? latest : 'v' + latest);
          badge.style.display = '';
        }
      }
    }

    // 延迟执行，避免与首屏加载竞争
    window.addEventListener('load', () => {
      setTimeout(checkForNewVersion, 3000);
    });
`;
}
