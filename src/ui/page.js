/**
 * UI页面生成模块 - 完整版本
 * 包含所有原版功能：搜索、导入导出、二维码、编辑删除等
 * 支持代码分割和懒加载优化
 */

import { getStyles } from './styles/index.js';
import { getScripts, getCoreScripts } from './scripts/index.js';
import { dialogIcon } from './dialogIcons.js';
import { APP_VERSION } from '../utils/version.js';
import { LANGUAGE_OPTIONS, normalizeLanguage } from '../shared/languages.js';

/**
 * 创建主页面（密钥管理界面）
 * @param {Object} options - 配置选项
 * @param {boolean} options.lazyLoad - 是否启用懒加载（默认true）
 * @returns {Response} HTML响应
 */
export async function createMainPage(options = {}) {
	const { lazyLoad = true } = options;

	// 构建完整的HTML内容
	const html = buildCompleteHTML(lazyLoad);

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
		},
	});
}

/**
 * 构建完整的HTML内容
 * @param {boolean} lazyLoad - 是否启用懒加载
 */
function buildCompleteHTML(lazyLoad = true) {
	return getHTMLStart() + getStyles() + getHTMLBody() + getHTMLScripts(lazyLoad) + getHTMLEnd();
}

/**
 * HTML文档开始部分
 */
function getHTMLStart() {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>2FA - 密钥管理器</title>

  <!-- PWA Manifest -->
  <link rel="manifest" href="/manifest.json">

  <!-- PWA Meta Tags -->
  <meta name="application-name" content="2FA">
  <meta name="description" data-i18n-content="pageDescription" content="安全的两步验证密钥管理器，支持 TOTP、HOTP 验证码生成">
  <meta name="theme-color" content="#2196F3">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="2FA">
  
  <!-- iOS Icons -->
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/icon-192.png">
  <link rel="apple-touch-icon" sizes="152x152" href="/icon-192.png">
  <link rel="apple-touch-icon" sizes="120x120" href="/icon-192.png">
  
  <!-- Favicon -->
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
  <link rel="shortcut icon" href="/icon-192.png">
  
  <!-- Microsoft Tiles -->
  <meta name="msapplication-TileColor" content="#2196F3">
  <meta name="msapplication-TileImage" content="/icon-192.png">
  <meta name="msapplication-config" content="none">
  
  <!-- PWA Display -->
  <meta name="display" content="standalone">
  
  <!-- Security -->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">

  <!-- Theme & Language Initialization - Must run before CSS to prevent FOUC -->
  <script>
    (function() {
      try {
        const theme = localStorage.getItem('theme') || 'auto';
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // 设置主题：dark 强制深色，light 强制浅色，auto 跟随系统
        const dataTheme = (theme === 'dark' || (theme === 'auto' && prefersDark)) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', dataTheme);

        const normalizePageLanguage = ${normalizeLanguage.toString()};
        const savedLanguage = localStorage.getItem('language');
        const lang = normalizePageLanguage(savedLanguage) ||
          [navigator.language || navigator.userLanguage, ...(navigator.languages || [])].map(normalizePageLanguage).find(Boolean) || 'en';
        document.documentElement.setAttribute('lang', lang);
      } catch (e) {
        // Fallback to light theme if localStorage access fails
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>

  <!-- FAB 位置预注入 - Must run before paint to prevent FAB position flash -->
  <script>
    (function() {
      try {
        const raw = localStorage.getItem('2fa-fab-position');
        if (!raw) return;
        const pos = JSON.parse(raw);
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        // 与 CSS 媒体查询保持一致：≤480px 时 FAB 为 40x40，其余 48x48
        const size = vw <= 480 ? 40 : 48;
        const margin = 8;
        const maxX = Math.max(margin, vw - size - margin);
        const maxY = Math.max(margin, vh - size - margin);
        const x = Math.min(Math.max(pos.x, margin), maxX);
        const y = Math.min(Math.max(pos.y, margin), maxY);
        const style = document.createElement('style');
        style.id = 'fab-init-position';
        style.textContent = '.action-menu-float{left:' + x + 'px !important;top:' + y + 'px !important;right:auto !important;bottom:auto !important;}';
        document.head.appendChild(style);
      } catch (e) {}
    })();
  </script>`;
}

/**
 * HTML样式部分 - 包含所有原版样式
 */
function getHTMLBody() {
	return `
<body class="fluent-app">
  <div class="container">
    <div class="content">
      <div
        id="clockWarning"
        class="clock-warning"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden
      >
        <div class="clock-warning-message">
          <span class="clock-warning-icon" aria-hidden="true">${dialogIcon('warning')}</span>
          <span id="clockWarningText" class="clock-warning-text" data-i18n="clockWarningText">本地时间可能不准确，验证码可能无效。</span>
        </div>
        <button
          type="button"
          id="clockSyncRetryButton"
          class="clock-sync-retry-button"
          data-i18n="clockSyncRetryButton"
          onclick="retryClockSync()"
        >重新校时</button>
      </div>

      <div class="search-section">
        <div class="search-container">
          <!-- 防止浏览器自动填充的隐藏输入框 -->
          <input type="text" name="prevent_autofill_username" style="display:none" tabindex="-1" autocomplete="new-password">
          <input type="password" name="prevent_autofill_password" style="display:none" tabindex="-1" autocomplete="new-password">

          <!-- 搜索框和操作按钮的水平布局 -->
          <div class="search-action-row">
          <div class="search-input-wrapper">
            <span class="search-icon" aria-hidden="true">${dialogIcon('search')}</span>
            <input type="search"
                   id="searchInput"
                   name="search-query"
                   class="search-input"
                   placeholder="搜索服务或账户名称"
                   data-i18n-placeholder="searchInputPlaceholder"
                   oninput="scheduleSecretFilter(this.value)"
                   autocomplete="off"
                   autocorrect="off"
                   autocapitalize="off"
                   spellcheck="false"
                   role="searchbox"
                   aria-label="搜索2FA密钥"
                   data-i18n-aria-label="searchInputAriaLabel"
                   data-form-type="other"
                   data-lpignore="true"
                   data-1p-ignore="true"
                   data-bwignore="true"
                   readonly
                   onfocus="this.removeAttribute('readonly')">
            <button class="search-clear" aria-label="清除搜索" data-i18n-aria-label="searchClearAriaLabel" id="searchClear" onclick="clearSearch()" style="display: none;">${dialogIcon('close')}</button>
      </div>
          <div class="sort-controls">
            <details class="sort-dropdown" id="sortDropdown">
              <summary class="sort-trigger" aria-label="显示与排序" title="显示与排序" data-i18n-aria-label="sortTriggerLabel" data-i18n-title="sortTriggerLabel">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18"></path>
                  <path d="M6 12h12"></path>
                  <path d="M10 18h4"></path>
                </svg>
                <span class="sort-trigger-label" data-i18n="sortTriggerLabel">显示与排序</span>
              </summary>
              <div class="sort-menu" aria-label="显示与排序选项" data-i18n-aria-label="pageSortOptions">
                <div class="sort-menu-section">
                  <div class="sort-menu-label" id="viewModeLabel" data-i18n="viewModeLabel">显示方式</div>
                  <div class="view-mode-segmented" role="group" aria-labelledby="viewModeLabel">
                    <button type="button" class="view-mode-option active" data-view-mode="grouped" aria-pressed="true" data-i18n="viewModeGrouped" onclick="selectViewMode('grouped')">智能聚合</button>
                    <button type="button" class="view-mode-option" data-view-mode="flat" aria-pressed="false" data-i18n="viewModeFlat" onclick="selectViewMode('flat')">全部平铺</button>
                  </div>
                </div>
                <div class="sort-menu-divider"></div>
                <div class="sort-menu-section group-sort-only" id="groupSortSection">
                  <div class="sort-menu-label" id="groupSortLabel" data-i18n="groupSortLabel">聚合分组</div>
                  <div class="view-mode-segmented" role="group" aria-labelledby="groupSortLabel">
                    <button type="button" class="group-sort-option active" data-group-sort="name-asc" aria-pressed="true" data-i18n="groupSortNameAsc" onclick="selectGroupSort('name-asc')">名称 A-Z</button>
                    <button type="button" class="group-sort-option" data-group-sort="name-desc" aria-pressed="false" data-i18n="groupSortNameDesc" onclick="selectGroupSort('name-desc')">名称 Z-A</button>
                  </div>
                </div>
                <div class="sort-menu-divider group-sort-only"></div>
                <div class="sort-menu-section">
                  <div class="sort-menu-label" data-i18n="sortModeLabel" id="sortModeLabel">组内排序</div>
                  <div class="sort-options" role="group" aria-labelledby="sortModeLabel">
                    <button type="button" aria-pressed="true" class="sort-option active" data-sort="oldest-first" data-i18n="sortOldestFirst" onclick="selectSort('oldest-first')">最早添加</button>
                    <button type="button" aria-pressed="false" class="sort-option" data-sort="newest-first" data-i18n="sortNewestFirst" onclick="selectSort('newest-first')">最晚添加</button>
                    <button type="button" aria-pressed="false" class="sort-option flat-sort-only" data-sort="name-asc" data-i18n="sortServiceNameAsc" onclick="selectSort('name-asc')">服务名称 A-Z</button>
                    <button type="button" aria-pressed="false" class="sort-option flat-sort-only" data-sort="name-desc" data-i18n="sortServiceNameDesc" onclick="selectSort('name-desc')">服务名称 Z-A</button>
                    <button type="button" aria-pressed="false" class="sort-option" data-sort="account-asc" data-i18n="sortAccountNameAsc" onclick="selectSort('account-asc')">账户名称 A-Z</button>
                    <button type="button" aria-pressed="false" class="sort-option" data-sort="account-desc" data-i18n="sortAccountNameDesc" onclick="selectSort('account-desc')">账户名称 Z-A</button>
                  </div>
                </div>
              </div>
            </details>
            <select id="sortSelect" class="sort-select-hidden" onchange="applySorting()" aria-hidden="true" tabindex="-1">
              <option value="oldest-first" data-i18n="sortOldestFirst">最早添加</option>
              <option value="newest-first" data-i18n="sortNewestFirst">最晚添加</option>
              <option value="name-asc" data-i18n="sortServiceNameAsc">服务名称 A-Z</option>
              <option value="name-desc" data-i18n="sortServiceNameDesc">服务名称 Z-A</option>
              <option value="account-asc" data-i18n="sortAccountNameAsc">账户名称 A-Z</option>
              <option value="account-desc" data-i18n="sortAccountNameDesc">账户名称 Z-A</option>
            </select>
      </div>
          </div>
          <div class="search-stats" id="searchStats" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>
      </div>

      <!-- 背景遮罩 -->
      <div class="menu-overlay" id="menuOverlay" onclick="closeActionMenu()"></div>

      <section id="offlineQueue" class="offline-queue" aria-label="未同步更改" hidden data-i18n-aria-label="pagePendingChanges">
        <div class="offline-queue-header">
          <span id="offlineQueueSummary" role="status" aria-live="polite"></span>
          <div class="offline-queue-actions">
            <button id="offlineQueueLogin" type="button" class="btn btn-secondary btn-sm" onclick="showLoginModal()" hidden data-i18n="pageLoginContinue">登录后继续</button>
            <button id="offlineQueueReload" type="button" class="btn btn-secondary btn-sm" onclick="retryOfflineQueueStatus()" hidden data-i18n="retry">重试</button>
            <button id="offlineQueueToggle" type="button" class="btn btn-secondary btn-sm" aria-expanded="false" aria-controls="offlineQueueList" onclick="toggleOfflineQueueDetails()" data-i18n="pageView">查看</button>
          </div>
        </div>
        <p id="offlineQueueFeedback" role="status" hidden></p>
        <ul id="offlineQueueList" class="offline-queue-list" hidden></ul>
      </section>

      <section id="hiddenSecrets" class="offline-queue" aria-label="未显示的账户" hidden data-i18n-aria-label="pageHiddenAccounts">
        <div class="offline-queue-header">
          <span id="hiddenSecretsSummary"></span>
          <div class="offline-queue-actions">
            <button id="hiddenSecretsToggle" type="button" class="btn btn-secondary btn-sm" aria-expanded="false" aria-controls="hiddenSecretsList" onclick="toggleHiddenSecretsDetails()" hidden data-i18n="offlineQueueView">查看</button>
          </div>
        </div>
        <ul id="hiddenSecretsList" class="offline-queue-list" hidden></ul>
      </section>
      
      <div id="loading" class="loading">
        <div data-i18n="loadingSecrets">正在加载密钥...</div>
      </div>
      
      <div id="secretsList" class="secrets-list" style="display: none;">
        <!-- 密钥列表将在这里动态生成 -->
      </div>
      
      <div id="emptyState" class="empty-state" style="display: none;">
        <div class="icon" aria-hidden="true">${dialogIcon('key')}</div>
        <h3 data-i18n="emptyTitle">还没有密钥</h3>
        <p data-i18n="emptyDesc">添加账户的两步验证密钥，在这里获取验证码</p>
<button type="button" class="workspace-action" data-i18n="emptyAddBtn" onclick="showAddModal()">添加密钥</button>
      </div>
    </div>
  </div>
  
  
  <!-- 二维码扫描器模态框 -->
  <div id="qrScanModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="qrScanModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="qrScanModalTitle" data-i18n="qrScanModalTitle">扫描二维码添加密钥</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideQRScanner()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="scanner-section">
        <div class="scanner-container">
          <div class="video-wrapper">
            <video id="scannerVideo" autoplay playsinline muted></video>
            <div id="scannerOverlay" class="scanner-overlay">
              <div class="scanner-frame"></div>
            </div>
          </div>
        </div>

        <!-- 连续扫描计数器 -->
        <div id="scanCounter" class="scan-counter" style="display: none;" data-i18n-html="scanCounterText" data-i18n-count-id="scanCountNum">
          已添加 <span id="scanCountNum">0</span> 个密钥
        </div>

        <div id="scannerStatus" class="scanner-status" data-i18n="scannerStarting">
          正在启动摄像头...
        </div>

        <div id="scannerError" class="scanner-error" style="display: none;">
          <div id="errorMessage"></div>
          <button class="btn btn-primary" onclick="retryCamera()" style="margin-top: 10px;" data-i18n="retryCamera">重试摄像头</button>
        </div>

        <!-- 底部操作区：连续扫描 + 选择图片 + 粘贴截图 -->
        <div class="scanner-bottom-actions">
          <label class="continuous-scan-inline">
            <input type="checkbox" id="continuousScanToggle" onchange="toggleContinuousScan()">
            <span data-i18n="continuousScan">连续扫描</span>
          </label>
          <input type="file" id="qrImageInput" accept="image/*" style="display: none;" onchange="handleImageUpload(event)">
          <button class="btn btn-info btn-compact" onclick="document.getElementById('qrImageInput').click()" data-i18n="chooseImage">选择图片</button>
          <button class="btn btn-info btn-compact" onclick="pasteImageForScan()" data-i18n="pasteScreenshot">粘贴截图</button>
        </div>
        <div class="scanner-hint" data-i18n="scannerHint">支持拖拽图片到此处、Ctrl+V 粘贴截图、Google迁移码批量导入</div>
      </div>
    </div>
  </div>
  
  <!-- 添加/编辑密钥模态框 -->
  <div id="secretModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle" data-i18n="addSecretTitle">添加新密钥</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideSecretModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <form id="secretForm" onsubmit="handleSubmit(event)" autocomplete="off">
        <input type="hidden" id="secretId" value="">

        <div class="form-group">
          <label for="secretName" data-i18n="secretNameLabel">服务名称 *</label>
          <input type="text" id="secretName" required placeholder="例如：GitHub, Google, Microsoft" data-i18n-placeholder="secretNamePlaceholder" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="secretService" data-i18n="secretServiceLabel">账户名称</label>
          <input type="text" id="secretService" placeholder="例如：your@email.com 或 用户名" data-i18n-placeholder="secretServicePlaceholder" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="secretKey" data-i18n="secretKeyLabel">密钥 (Base32) *</label>
          <input type="text" id="secretKey" required placeholder="输入16位或更长的Base32密钥" data-i18n-placeholder="secretKeyPlaceholder" autocomplete="off">
        </div>
        
        <!-- 高级参数区域 -->
        <div class="form-section">
          <div class="section-header">
            <label>
              <input type="checkbox" id="showAdvanced" onchange="toggleAdvancedOptions()"> 
              <span data-i18n="advancedOptionsLabel">高级设置 (可选)</span>
            </label>
          </div>
          
          <div id="advancedOptions" class="advanced-options" style="display: none;">
            <div class="form-row">
              <div class="form-group-small">
                <label for="secretType" data-i18n="secretTypeLabel">类型</label>
                <select id="secretType" onchange="updateAdvancedOptionsForType()">
                  <option value="TOTP" selected data-i18n="secretTypeTotp">TOTP (时间基准)</option>
                  <option value="HOTP" data-i18n="secretTypeHotp">HOTP (计数器基准)</option>
                </select>
              </div>
              
              <div class="form-group-small" id="digitsGroup">
                <label for="secretDigits" data-i18n="secretDigitsLabel">位数</label>
                <select id="secretDigits">
                  <option value="6" selected data-i18n="digitsSix">6位</option>
                  <option value="8" data-i18n="digitsEight">8位</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group-small" id="periodGroup">
                <label for="secretPeriod" data-i18n="secretPeriodLabel">周期(秒)</label>
                <select id="secretPeriod">
                  <option value="30" selected data-i18n="pagePeriod30">30秒</option>
                  <option value="60" data-i18n="periodSixty">60秒</option>
                  <option value="120" data-i18n="pagePeriod120">120秒</option>
                </select>
              </div>
              
              <div class="form-group-small" id="algorithmGroup">
                <label for="secretAlgorithm" data-i18n="secretAlgorithmLabel">算法</label>
                <select id="secretAlgorithm">
                  <option value="SHA1" selected>SHA1</option>
                  <option value="SHA256">SHA256</option>
                  <option value="SHA512">SHA512</option>
                </select>
              </div>
            </div>
            
            <div class="form-row" id="counterRow" style="display: none;">
              <div class="form-group-small" id="counterGroup">
                <label for="secretCounter" data-i18n="secretCounterLabel">计数器</label>
                <input type="number" id="secretCounter" value="0" min="0" max="9007199254740991" step="1" placeholder="初始计数器值" data-i18n-placeholder="secretCounterPlaceholder" autocomplete="off">
              </div>
            </div>
            
            <div class="advanced-info" id="advancedInfo" data-i18n="secretAdvancedHelp">
              大多数2FA应用使用默认设置：TOTP、6位、30秒、SHA1算法
            </div>
          </div>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideSecretModal()" data-i18n="cancel">取消</button>
          <button type="submit" class="btn btn-primary" id="submitBtn" data-i18n="save">保存</button>
        </div>
      </form>
    </div>
  </div>

  <!-- 批量导入模态框 -->
  <div id="importModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
    <div class="modal-content import-modal-compact">
      <div class="modal-header">
        <h2 id="importModalTitle" data-i18n="pageImportTitle">批量导入密钥</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideImportModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <!-- 隐藏的文件输入 -->
      <input type="file" id="importFileInput" accept=".txt,.csv,.json,.html,.htm,.2fas,.xml,.authpro,.encrypt" style="display: none;" onchange="handleImportFile(event)">

      <!-- 智能输入区：文本框支持粘贴和拖拽 -->
      <div class="smart-import-zone" id="smartImportZone">
        <textarea aria-label="导入内容" id="importText" class="import-textarea-smart" rows="6"
                  placeholder="在此粘贴内容，或拖拽文件到这里...&#10;&#10;支持 OTPAuth、JSON、CSV、HTML 等格式"
                  autocomplete="off"
                  oninput="autoPreviewImport()"
                  ondragover="handleDragOver(event)"
                  ondragleave="handleDragLeave(event)"
                  ondrop="handleFileDrop(event)" data-i18n-placeholder="pageImportPlaceholder" data-i18n-aria-label="pageImportContent"></textarea>
      </div>

      <!-- 选择文件按钮 -->
      <div class="import-file-btn-wrapper">
        <button type="button" class="btn btn-info import-file-btn" onclick="document.getElementById('importFileInput').click()" data-i18n="pageChooseFile">
          选择文件
        </button>
        <span class="import-file-hint" data-i18n="pageImportFormats">支持 TXT, JSON, CSV, HTML, 2FAS, XML, AuthPro, Encrypt</span>
      </div>

      <!-- 已选文件信息徽章 -->
      <div class="file-info-badge" id="fileInfoBadge" style="display: none;">
        <span class="file-icon">${dialogIcon('file')}</span>
        <span class="file-name" id="selectedFileName"></span>
        <span class="file-size" id="selectedFileSize"></span>
        <button type="button" class="file-clear-btn" aria-label="清除已选文件" onclick="clearSelectedFile(event)" data-i18n-aria-label="pageClearFile">${dialogIcon('close')}</button>
      </div>

      <!-- 小提示 -->
      <div class="import-tips">
        <span class="import-tip"><span data-i18n="pageImportGoogle">从 Google Authenticator 导入？</span><a href="javascript:void(0)" onclick="hideImportModal(); showQRScanner();" data-i18n="pageScanMigration">扫描迁移二维码</a></span>
      </div>

      <!-- 格式说明（可折叠） -->
      <details class="import-format-details">
        <summary data-i18n="pageSupportedFormats">查看支持的格式</summary>
        <div class="import-format-help">
          <p><strong>TXT</strong> Aegis、Ente Auth、WinAuth</p>
          <p><strong>2FAS</strong> 2FAS</p>
          <p><strong>JSON</strong> Aegis、Bitwarden Auth、andOTP、FreeOTP+、LastPass、Proton</p>
          <p><strong>CSV</strong> Bitwarden Authenticator</p>
          <p><strong>HTML</strong> Aegis/Ente Auth（.html.txt）、Authenticator Pro</p>
          <p><strong>XML</strong> <span data-i18n="pageFreeOtpEncrypted">FreeOTP（加密备份）</span></p>
          <p><strong>AuthPro</strong> Authenticator Pro (Stratum)</p>
          <p><strong>Encrypt</strong> <span data-i18n="pageTotpAuthEncrypted">TOTP Authenticator（加密备份）</span></p>
        </div>
      </details>

      <!-- 预览区域 -->
      <div id="importPreview" class="import-preview-compact" style="display: none;">
        <div class="import-preview-header">
          <span class="preview-title" data-i18n="pagePreview">预览</span>
          <div class="import-stats-inline">
            <span class="stat-valid" id="statValid" data-i18n="transferValidCount" data-i18n-params='{"count":0}'>0 有效</span>
            <span class="stat-invalid" id="statInvalid" data-i18n="transferInvalidCount" data-i18n-params='{"count":0}'>0 无效</span>
            <span class="stat-total" id="statTotal" data-i18n="transferTotalCount" data-i18n-params='{"count":0}'>共 0 条</span>
          </div>
        </div>
        <div id="importPreviewList" class="import-preview-list"></div>
      </div>

      <div id="importProgress" class="import-progress-panel" style="display: none;">
        <div class="import-progress-header">
          <span class="import-progress-title" id="importProgressTitle" data-i18n="transferImportProgress">导入进度</span>
          <span class="import-progress-percent" id="importProgressPercent">0%</span>
        </div>
        <div class="import-progress-bar">
          <div id="importProgressFill" class="import-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="import-progress-meta">
          <span id="importProgressStatus" data-i18n="transferPreparing">准备开始...</span>
          <span id="importProgressDetail">0 / 0</span>
        </div>
        <div class="import-progress-stats">
          <span id="importProgressChunk" data-i18n="transferChunk" data-i18n-params='{"index":0,"count":0}'>分片 0 / 0</span>
          <span id="importProgressSuccess" data-i18n="transferSuccessCount" data-i18n-params='{"count":0}'>成功 0</span>
          <span id="importProgressFail" data-i18n="transferFailCount" data-i18n-params='{"count":0}'>失败 0</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions import-form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideImportModal()" data-i18n="cancel">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeImport()" id="executeImportBtn" disabled data-i18n="pageImport">导入</button>
      </div>
    </div>
  </div>

  <!-- 还原配置模态框 -->
  <div id="restoreModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="restoreModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="restoreModalTitle" data-i18n="restoreModalTitle">还原配置</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" data-i18n-aria-label="close" onclick="hideRestoreModal()">${dialogIcon('close')}</button>
      </div>
      
      <div class="restore-instructions">
        <p data-i18n="restoreInstructions">从备份中选择一个配置进行还原：</p>
        <p data-i18n="restoreOverwriteWarning">
          警告：还原操作将覆盖当前所有密钥，且无法撤销。
        </p>
      </div>
      
      <div class="restore-content">
        <div class="backup-list-container">
          <label class="backup-list-header" for="backupSelect" data-i18n="restoreSelectLabel">选择备份文件</label>
          <div class="backup-select-wrapper">
            <select id="backupSelect" class="backup-select" onchange="selectBackupFromDropdown()">
              <option value="" data-i18n="restoreSelectPlaceholder">请选择备份文件...</option>
            </select>
          </div>
          <div class="backup-actions">
            <button type="button" class="btn btn-outline" onclick="loadBackupList()" data-i18n="restoreRefresh">刷新</button>
            <button type="button" class="btn btn-outline" onclick="exportSelectedBackup()" id="exportBackupBtn" data-i18n="restoreExport" disabled>导出备份</button>
            <input type="file" id="restoreBackupFileInput" accept=".txt,.csv,.json,.html" style="display: none;" onchange="handleRestoreBackupFile(event)">
            <button type="button" class="btn btn-outline" onclick="document.getElementById('restoreBackupFileInput').click()" data-i18n="restoreUpload">上传备份文件</button>
          </div>
          <div id="restoreUploadStatus" style="display: none; margin-top: 8px; font-size: var(--dialog-caption-size); color: var(--text-secondary);"></div>
          <div class="backup-pagination" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px;">
            <span id="backupListStatus" style="font-size: var(--dialog-caption-size); color: var(--text-secondary);"></span>
            <button type="button" class="btn btn-outline" id="backupLoadMoreBtn" onclick="loadMoreBackupList()" style="display: none;" data-i18n="restoreLoadMore">加载更多</button>
          </div>
        </div>
        
        <div class="restore-preview" id="restorePreview" style="display: none;">
          <div class="preview-header">
            <span data-i18n="restorePreviewTitle">备份预览</span>
          </div>
          <div id="backupPreviewContent" class="backup-preview-content">
            <!-- 备份内容预览将在这里显示 -->
          </div>
        </div>
      </div>
      
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="hideRestoreModal()" data-i18n="cancel">取消</button>
        <button type="button" class="btn btn-danger" onclick="confirmRestore()" id="confirmRestoreBtn" data-i18n="restoreConfirm" disabled>确认还原</button>
      </div>
    </div>
  </div>
  
  <!-- 实用工具模态框 -->
  <div id="toolsModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="toolsModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="toolsModalTitle" data-i18n="pageTools">实用工具</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideToolsModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tools-list">
        <button type="button" class="tool-item" onclick="showQRScanAndDecode()">
          <div class="tool-icon">${dialogIcon('qr')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="toolQrDecodeTitle">二维码解析</div>
            <div class="tool-desc" data-i18n="pageQrDecodeDesc">扫描并显示二维码内容</div>
          </div>
        </button>
        
        <button type="button" class="tool-item" onclick="showQRGenerateTool()">
          <div class="tool-icon">${dialogIcon('qr')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="toolQrGenTitle">二维码生成</div>
            <div class="tool-desc" data-i18n="pageQrGenerateDesc">将文本转换为二维码</div>
          </div>
        </button>

        <button type="button" class="tool-item" onclick="showBase32Tool()">
          <div class="tool-icon">${dialogIcon('code')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="toolBase32Title">Base32 编解码</div>
            <div class="tool-desc" data-i18n="pageBase32Desc">TOTP密钥格式转换工具</div>
          </div>
        </button>

        <button type="button" class="tool-item" onclick="showTimestampTool()">
          <div class="tool-icon">${dialogIcon('clock')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="pageTimestampTitle">时间戳工具</div>
            <div class="tool-desc" data-i18n="pageTimestampDesc">查看TOTP当前时间周期</div>
          </div>
        </button>

        <button type="button" class="tool-item" onclick="showKeyCheckTool()">
          <div class="tool-icon">${dialogIcon('check')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="toolKeyCheckerTitle">密钥检查器</div>
            <div class="tool-desc" data-i18n="pageKeyCheckDesc">验证密钥是否符合规范</div>
          </div>
        </button>

        <button type="button" class="tool-item" onclick="showKeyGeneratorTool()">
          <div class="tool-icon">${dialogIcon('key')}</div>
          <div class="tool-content">
            <div class="tool-title" data-i18n="toolKeyGenTitle">密钥生成器</div>
            <div class="tool-desc" data-i18n="pageKeyGenerateDesc">生成随机TOTP密钥</div>
          </div>
        </button>
      </div>
    </div>
  </div>

  <!-- 二维码生成工具模态框 -->
  <div id="qrGenerateModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="qrGenerateModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="qrGenerateModalTitle" data-i18n="toolQrGenTitle">二维码生成</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideQRGenerateModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pageInputContent">输入内容</div>
        <div class="input-area">
          <textarea
            id="qrContentInput"
            class="content-input"
            placeholder="请输入要生成二维码的内容"
            rows="6" style="width: 100%; font-family: monospace; resize: vertical;"
            autocomplete="off"
           data-i18n-placeholder="pageQrContentPlaceholder"></textarea>
        </div>
      </div>
      
      <div class="tool-section" id="qrResultSection" style="display: none;">
        <div class="section-title" data-i18n="pageGeneratedQr">生成的二维码</div>
        <div class="qr-display">
          <img id="generatedQRCode" class="qr-image" style="max-width: 300px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
          <div class="qr-tip" style="margin-top: 10px; font-size: var(--dialog-caption-size); color: var(--text-tertiary);" data-i18n="pageSaveImageHint">长按保存图片</div>
        </div>
      </div>
      
      <div class="form-actions">
        <button type="button" class="btn btn-primary" onclick="generateQRCode()" data-i18n="pageGenerateQr">生成二维码</button>
      </div>
    </div>
  </div>
  
  <!-- Base32编解码工具模态框 -->
  <div id="base32Modal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="base32ModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="base32ModalTitle" data-i18n="toolBase32Title">Base32 编解码</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideBase32Modal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pageBase32Encode">Base32 编码</div>
        <div class="input-area">
          <textarea
            id="plainTextInput"
            placeholder="输入普通文本"
            rows="4" style="width: 100%; font-family: monospace; resize: vertical;"
            autocomplete="off"
           data-i18n-placeholder="pageTextPlaceholder"></textarea>
          <div class="button-area" style="margin-top: 10px; display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="encodeBase32()" data-i18n="pageEncode">编码</button>
            <button class="btn btn-info" onclick="copyEncodedText()" data-i18n="copy">复制</button>
          </div>
          <div id="encodedResult" class="result-text" style="margin-top: 10px; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-family: monospace; font-size: var(--dialog-caption-size); min-height: 0; word-break: break-all; display: none; color: var(--text-primary);"></div>
        </div>
      </div>
      
      <div class="divider" style="height: 1px; background: var(--border-primary); margin: 20px 0;"></div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pageBase32Decode">Base32 解码</div>
        <div class="input-area">
          <textarea
            id="base32TextInput"
            placeholder="输入Base32文本"
            rows="4" style="width: 100%; font-family: monospace; resize: vertical;"
            autocomplete="off"
           data-i18n-placeholder="pageBase32Placeholder"></textarea>
          <div class="button-area" style="margin-top: 10px; display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="decodeBase32()" data-i18n="pageDecode">解码</button>
            <button class="btn btn-info" onclick="copyDecodedText()" data-i18n="copy">复制</button>
          </div>
          <div id="decodedResult" class="result-text" style="margin-top: 10px; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-family: monospace; font-size: var(--dialog-caption-size); min-height: 0; word-break: break-all; display: none; color: var(--text-primary);"></div>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 时间戳工具模态框 -->
  <div id="timestampModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="timestampModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="timestampModalTitle" data-i18n="pageTimestampTitle">时间戳工具</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideTimestampModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pageTotpTime">TOTP 时间信息</div>
        <div class="time-info" style="background: var(--bg-secondary); padding: 15px; border-radius: 4px; margin-bottom: 15px;">
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);" data-i18n="pageCurrentTimestamp">当前时间戳:</span>
            <span class="value" id="currentTimestamp" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);" data-i18n="pageTotpPeriod">TOTP时间周期:</span>
            <span class="value" id="totpPeriod" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);" data-i18n="pagePeriodCounter">当前周期计数:</span>
            <span class="value" id="totpCounter" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);" data-i18n="pageRemainingTime">剩余时间:</span>
            <span class="value" id="remainingTime" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
        </div>
        <div class="progress-bar timestamp-progress-track">
          <div id="progressBar" class="progress" role="progressbar" aria-label="当前周期剩余时间" aria-valuemin="0" aria-valuemax="100" data-i18n-aria-label="pagePeriodRemaining"></div>
        </div>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pagePeriodSettings">时间周期设置</div>
        <div class="period-selector" style="display: flex; justify-content: space-between; gap: 10px;">
          <button class="btn btn-outline" id="period30Btn" onclick="setPeriod(30)" data-i18n="pagePeriod30">30秒</button>
          <button class="btn btn-outline" id="period60Btn" onclick="setPeriod(60)" data-i18n="periodSixty">60秒</button>
          <button class="btn btn-outline" id="period120Btn" onclick="setPeriod(120)" data-i18n="pagePeriod120">120秒</button>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 密钥检查器模态框 -->
  <div id="keyCheckModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="keyCheckModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="keyCheckModalTitle" data-i18n="toolKeyCheckerTitle">密钥检查器</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideKeyCheckModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="pageKeyCheck">密钥检查</div>
        <div class="input-area">
          <textarea
            id="keyCheckInput"
            placeholder="请输入要检查的密钥"
            rows="4" style="width: 100%; font-family: monospace; resize: vertical;"
            autocomplete="off"
           data-i18n-placeholder="pageKeyCheckPlaceholder"></textarea>
          <button class="btn btn-primary" onclick="checkSecret()" style="margin-top: 10px;" data-i18n="pageCheckKey">检查密钥</button>
        </div>
      </div>
      
      <div class="tool-section" id="keyCheckResult" style="display: none;">
        <div class="section-title" data-i18n="pageKeyCheckResult">检查结果</div>
        <div id="checkResultContent" class="check-result" style="padding: 15px; border-radius: 4px; margin-bottom: 15px;">
          <!-- 结果内容将在这里动态生成 -->
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 二维码解析工具模态框 -->
  <div id="qrDecodeModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="qrDecodeModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="qrDecodeModalTitle" data-i18n="toolQrDecodeTitle">二维码解析</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideQRDecodeModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title" data-i18n="fabScanQR">扫描二维码</div>
        <div class="scan-options" style="display: flex; gap: 10px; margin-bottom: 10px;">
          <button class="btn btn-primary" onclick="startQRDecodeScanner()" style="flex: 1;" data-i18n="pageCameraScan">摄像头扫描</button>
          <button class="btn btn-info" onclick="uploadImageForDecode()" style="flex: 1;" data-i18n="chooseImage">选择图片</button>
          <button class="btn btn-info" onclick="pasteImageForDecode()" style="flex: 1;" data-i18n="pasteScreenshot">粘贴截图</button>
        </div>
        <div class="scanner-hint" style="margin-bottom: 15px;" data-i18n="pageQrDropHint">支持拖拽图片到此处或 Ctrl+V 粘贴截图</div>
        
        <div id="decodeScannerContainer" style="display: none;">
          <div class="scanner-container" style="position: relative; margin: 15px 0;">
            <div class="video-wrapper">
              <video id="decodeScannerVideo" autoplay playsinline muted></video>
              <div class="scanner-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;">
                <div class="scanner-frame" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60%; height: 60%; border: 2px solid #fff; border-radius: 4px;"></div>
              </div>
            </div>
          </div>
          <div id="decodeScannerStatus" class="scanner-status" style="text-align: center; margin: 10px 0; font-size: var(--dialog-body-size); color: var(--text-secondary);" data-i18n="scannerStarting">正在启动摄像头...</div>
          <div id="decodeScannerError" class="scanner-error" style="display: none; text-align: center; margin: 10px 0; padding: 10px; background: var(--danger-light); border: 1px solid var(--border-error); border-radius: 6px; color: var(--danger-dark);">
            <div id="decodeErrorMessage"></div>
            <button class="btn btn-primary" onclick="retryDecodeCamera()" style="margin-top: 10px;" data-i18n="retry">重试</button>
          </div>
        </div>
      </div>
      
      <div class="tool-section" id="decodeResultSection" style="display: none;">
        <div class="section-title" data-i18n="pageDecodedResult">解析结果</div>
        <div class="decode-result" style="background: var(--bg-secondary); padding: 15px; border-radius: 4px; margin-bottom: 15px;">
          <div class="result-content" id="decodeResultContent" style="font-family: monospace; font-size: var(--dialog-body-size); word-break: break-all; line-height: 1.5; max-height: 200px; overflow-y: auto; color: var(--text-primary);"></div>
          <div class="result-actions" style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn btn-info" onclick="copyDecodeResult()" style="flex: 1;" data-i18n="pageCopyContent">复制内容</button>
            <button class="btn btn-primary" onclick="generateDecodeQRCode()" style="flex: 1;" data-i18n="pageGenerateQr">生成二维码</button>
          </div>
        </div>
        <div class="qr-section" id="decodeQRSection" style="display: none; text-align: center;">
          <div class="qr-title" style="font-weight: 600; margin-bottom: 10px; color: var(--text-primary);" data-i18n="pageRegeneratedQr">重新生成的二维码</div>
          <img id="decodeQRCode" class="qr-code" style="max-width: 200px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
          <div class="qr-tip" style="margin-top: 8px; font-size: var(--dialog-caption-size); color: var(--text-tertiary);" data-i18n="pageQrPreviewHint">点击二维码可以预览</div>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 密钥生成器模态框 -->
  <div id="keyGeneratorModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="keyGeneratorModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="keyGeneratorModalTitle" data-i18n="toolKeyGenTitle">密钥生成器</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideKeyGeneratorModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      
      <div class="tool-section">
        <div class="options" style="margin-bottom: 15px;">
          <div class="option-item" style="margin-bottom: 10px;">
            <div class="option-label" style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);" data-i18n="pageKeyLength">密钥长度:</div>
            <div class="radio-group" style="display: flex; justify-content: space-between; gap: 10px;">
              <button class="btn btn-outline" id="length16Btn" onclick="setKeyLength(16)" data-i18n="pageLength16">16位</button>
              <button class="btn btn-outline" id="length26Btn" onclick="setKeyLength(26)" data-i18n="pageLength26">26位</button>
              <button class="btn btn-outline" id="length32Btn" onclick="setKeyLength(32)" data-i18n="pageLength32">32位</button>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="generateKey()" style="width: 100%;" data-i18n="pageGenerateKey">生成密钥</button>
      </div>
      
      <div class="tool-section" id="keyResultSection" style="display: none;">
        <div class="section-title" data-i18n="pageGeneratedResult">生成结果</div>
        <div class="key-result" style="padding: 15px; border-radius: 4px; margin-bottom: 15px; background: var(--bg-secondary);">
          <div class="key-text" id="generatedKeyText" style="font-family: monospace; font-size: var(--dialog-body-size); font-weight: 600; text-align: center; margin-bottom: 15px; word-break: break-all; color: var(--text-primary);"></div>
          <div class="key-actions" style="display: flex; justify-content: center;">
            <button class="btn btn-info" onclick="copyGeneratedKey()" data-i18n="pageCopyKey">复制密钥</button>
          </div>
        </div>
      </div>
      

    </div>
  </div>

  <!-- WebDAV 同步配置模态框 -->
  <div id="webdavModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="webdavModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="webdavModalTitle" data-i18n="syncWebdavTitle">WebDAV 同步</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideWebdavModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="tool-section">
        <!-- 目标列表 -->
        <div id="webdavDestinationList" style="margin-bottom: 15px;"></div>

        <!-- 添加按钮 -->
        <button class="btn btn-primary" id="webdavAddBtn" onclick="showWebdavForm()" style="width: 100%; margin-bottom: 15px;" data-i18n="pageAddWebdav">+ 添加 WebDAV 目标</button>

        <!-- 配置表单（默认隐藏） -->
        <div id="webdavFormArea" style="display: none;">
          <div class="dialog-sync-form">
            <input type="hidden" id="webdavEditId" value="" />

            <div style="margin-bottom: 12px;">
              <label for="webdavName" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageDestinationName">目标名称</label>
              <input type="text" id="webdavName" class="secret-input" placeholder="例如：家庭NAS、云盘" maxlength="30" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageWebdavNamePlaceholder"/>
            </div>

            <div style="margin-bottom: 12px;">
              <label for="webdavUrl" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageServerAddress">服务器地址</label>
              <input type="url" id="webdavUrl" class="secret-input" placeholder="https://your-server.com/dav/" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="margin-bottom: 12px;">
              <label for="webdavUsername" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageUsername">用户名</label>
              <input type="text" id="webdavUsername" class="secret-input" placeholder="请输入用户名" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageUsernamePlaceholder"/>
            </div>

            <div style="margin-bottom: 12px;">
              <label for="webdavPassword" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="loginPasswordLabel">密码</label>
              <input type="password" id="webdavPassword" class="secret-input" placeholder="请输入密码" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="loginEmptyPassword"/>
            </div>

            <div style="margin-bottom: 15px;">
              <label for="webdavPath" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageRemotePath">远程路径</label>
              <input type="text" id="webdavPath" class="secret-input" value="/" placeholder="/" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 8px;">
              <button class="btn btn-info" id="webdavTestBtn" onclick="testWebdavConnection()" style="flex: 1;" data-i18n="pageTestConnection">测试连接</button>
              <button class="btn btn-primary" id="webdavSaveBtn" onclick="saveWebdavConfig()" style="flex: 1;" data-i18n="save">保存</button>
            </div>
            <button class="btn" onclick="hideWebdavForm()" style="width: 100%;" data-i18n="cancel">取消</button>
          </div>
        </div>

        <div class="advanced-info" data-i18n="pageWebdavHelp">
          配置 WebDAV 后，每次备份（事件驱动、定时、手动）都会自动推送到所有已启用的 WebDAV 目标。支持 NextCloud、Alist 等。
        </div>
      </div>

    </div>
  </div>

  <!-- S3 同步配置模态框 -->
  <div id="s3Modal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="s3ModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="s3ModalTitle" data-i18n="syncS3Title">S3 同步</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideS3Modal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="tool-section">
        <!-- 目标列表 -->
        <div id="s3DestinationList" style="margin-bottom: 15px;"></div>

        <!-- 添加按钮 -->
        <button class="btn btn-primary" id="s3AddBtn" onclick="showS3Form()" style="width: 100%; margin-bottom: 15px;" data-i18n="pageAddS3">+ 添加 S3 目标</button>

        <!-- 配置表单（默认隐藏） -->
        <div id="s3FormArea" style="display: none;">
          <div class="dialog-sync-form">
            <input type="hidden" id="s3EditId" value="" />

            <div style="margin-bottom: 12px;">
              <label for="s3Name" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageDestinationName">目标名称</label>
              <input type="text" id="s3Name" class="secret-input" placeholder="例如：R2备份、MinIO" maxlength="30" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageS3NamePlaceholder"/>
            </div>

            <div style="margin-bottom: 12px;">
              <label for="s3Endpoint" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);">Endpoint</label>
              <input type="url" id="s3Endpoint" class="secret-input" placeholder="https://s3.amazonaws.com" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="margin-bottom: 12px;">
              <label for="s3Bucket" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);">Bucket</label>
              <input type="text" id="s3Bucket" class="secret-input" placeholder="my-backup-bucket" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="margin-bottom: 12px;">
              <label for="s3Region" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);">Region</label>
              <input type="text" id="s3Region" class="secret-input" value="auto" placeholder="auto" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="margin-bottom: 12px;">
              <label for="s3AccessKeyId" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);">Access Key ID</label>
              <input type="text" id="s3AccessKeyId" class="secret-input" placeholder="请输入 Access Key ID" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageAccessKeyPlaceholder"/>
            </div>

            <div style="margin-bottom: 12px;">
              <label for="s3SecretAccessKey" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);">Secret Access Key</label>
              <input type="password" id="s3SecretAccessKey" class="secret-input" placeholder="请输入 Secret Access Key" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageSecretAccessKeyPlaceholder"/>
            </div>

            <div style="margin-bottom: 15px;">
              <label for="s3Prefix" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageStoragePrefix">存储路径前缀</label>
              <input type="text" id="s3Prefix" class="secret-input" value="" placeholder="2fa-backup/（可选）" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageStoragePrefixPlaceholder"/>
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 8px;">
              <button class="btn btn-info" id="s3TestBtn" onclick="testS3Connection()" style="flex: 1;" data-i18n="pageTestConnection">测试连接</button>
              <button class="btn btn-primary" id="s3SaveBtn" onclick="saveS3Config()" style="flex: 1;" data-i18n="save">保存</button>
            </div>
            <button class="btn" onclick="hideS3Form()" style="width: 100%;" data-i18n="cancel">取消</button>
          </div>
        </div>

        <div class="advanced-info" data-i18n="pageS3Help">
          配置 S3 后，每次备份（事件驱动、定时、手动）都会自动推送到所有已启用的 S3 兼容存储。支持 AWS S3、Cloudflare R2、MinIO、阿里云 OSS 等。
        </div>
      </div>

    </div>
  </div>

  <!-- OneDrive 同步配置模态框 -->
  <div id="oneDriveModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="oneDriveModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="oneDriveModalTitle" data-i18n="syncOneDriveTitle">OneDrive 同步</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideOneDriveModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="tool-section">
        <div id="oneDriveOauthWarning" class="advanced-info" style="display:none; margin-bottom: 12px; padding: 12px; border-radius: 6px; font-size: var(--dialog-caption-size); color: var(--warning-color, #b45309); background: var(--bg-secondary); line-height: 1.6;"></div>

        <div id="oneDriveDestinationList" style="margin-bottom: 15px;"></div>

        <button class="btn btn-primary" id="oneDriveAddBtn" onclick="showOneDriveForm()" style="width: 100%; margin-bottom: 15px;" data-i18n="pageAddOneDrive">+ 添加 OneDrive 目标</button>

        <div id="oneDriveFormArea" style="display: none;">
          <div class="dialog-sync-form">
            <input type="hidden" id="oneDriveEditId" value="" />

            <div style="margin-bottom: 12px;">
              <label for="oneDriveName" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageDestinationName">目标名称</label>
              <input type="text" id="oneDriveName" class="secret-input" placeholder="例如：工作账户、个人账户" maxlength="30" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageOneDriveNamePlaceholder"/>
            </div>

            <div style="margin-bottom: 15px;">
              <label for="oneDriveFolderPath" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageAppSubpath">应用目录子路径</label>
              <input type="text" id="oneDriveFolderPath" class="secret-input" value="/2FA-Backups" placeholder="/2FA-Backups" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 8px;">
              <button class="btn btn-info" id="oneDriveAuthorizeBtn" onclick="authorizeOneDriveDest(document.getElementById('oneDriveEditId').value)" style="flex: 1;" data-i18n="pageSaveAuthorize">保存并授权</button>
              <button class="btn btn-primary" id="oneDriveSaveBtn" onclick="saveOneDriveConfig()" style="flex: 1;" data-i18n="save">保存</button>
            </div>
            <button class="btn" onclick="hideOneDriveForm()" style="width: 100%;" data-i18n="cancel">取消</button>
          </div>
        </div>

        <div class="advanced-info" data-i18n="pageOneDriveHelp">
          OneDrive 使用 Microsoft Graph 应用专用目录保存备份。授权成功后，每次备份都会自动推送到该目录下的指定子路径。
        </div>
      </div>

    </div>
  </div>

  <!-- Google Drive 同步配置模态框 -->
  <div id="googleDriveModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="googleDriveModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="googleDriveModalTitle" data-i18n="syncGoogleDriveTitle">Google Drive 同步</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideGoogleDriveModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="tool-section">
        <div id="googleDriveOauthWarning" class="advanced-info" style="display:none; margin-bottom: 12px; padding: 12px; border-radius: 6px; font-size: var(--dialog-caption-size); color: var(--warning-color, #b45309); background: var(--bg-secondary); line-height: 1.6;"></div>

        <div id="googleDriveDestinationList" style="margin-bottom: 15px;"></div>

        <button class="btn btn-primary" id="googleDriveAddBtn" onclick="showGoogleDriveForm()" style="width: 100%; margin-bottom: 15px;" data-i18n="pageAddGoogleDrive">+ 添加 Google Drive 目标</button>

        <div id="googleDriveFormArea" style="display: none;">
          <div class="dialog-sync-form">
            <input type="hidden" id="googleDriveEditId" value="" />

            <div style="margin-bottom: 12px;">
              <label for="googleDriveName" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageDestinationName">目标名称</label>
              <input type="text" id="googleDriveName" class="secret-input" placeholder="例如：主备份盘、个人盘" maxlength="30" style="width: 100%; box-sizing: border-box;"  data-i18n-placeholder="pageGoogleDriveNamePlaceholder"/>
            </div>

            <div style="margin-bottom: 15px;">
              <label for="googleDriveFolderPath" style="display: block; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); font-size: var(--dialog-body-size);" data-i18n="pageBackupFolder">备份目录</label>
              <input type="text" id="googleDriveFolderPath" class="secret-input" value="/2FA-Backups" placeholder="/2FA-Backups" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 8px;">
              <button class="btn btn-info" id="googleDriveAuthorizeBtn" onclick="authorizeGoogleDriveDest(document.getElementById('googleDriveEditId').value)" style="flex: 1;" data-i18n="pageSaveAuthorize">保存并授权</button>
              <button class="btn btn-primary" id="googleDriveSaveBtn" onclick="saveGoogleDriveConfig()" style="flex: 1;" data-i18n="save">保存</button>
            </div>
            <button class="btn" onclick="hideGoogleDriveForm()" style="width: 100%;" data-i18n="cancel">取消</button>
          </div>
        </div>

        <div class="advanced-info" data-i18n="pageGoogleDriveHelp">
          Google Drive 授权成功后，会自动在你的个人网盘目录下创建并更新备份文件。推送失败不会影响本地备份。
        </div>
      </div>

    </div>
  </div>

  <!-- 设置模态框 -->
  <div id="settingsModal" class="modal fab-modal-lg" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
    <div class="modal-content settings-modal-content">
      <div class="modal-header">
        <h2 id="settingsModalTitle" data-i18n="settingsTitle">设置</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideSettingsModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      <div class="settings-layout">
        <div class="settings-tabs">
          <button type="button" class="settings-tab active" data-tab="security" onclick="switchSettingsTab('security')">
            <span class="settings-tab-icon">${dialogIcon('lock')}</span>
            <span class="settings-tab-text" data-i18n="settingsTabSecurity">账户安全</span>
          </button>
          <button type="button" class="settings-tab" data-tab="sync" onclick="switchSettingsTab('sync')">
            <span class="settings-tab-icon">${dialogIcon('cloud')}</span>
            <span class="settings-tab-text" data-i18n="settingsTabSync">同步设置</span>
          </button>
          <button type="button" class="settings-tab" data-tab="preferences" onclick="switchSettingsTab('preferences')">
            <span class="settings-tab-icon">${dialogIcon('sliders')}</span>
            <span class="settings-tab-text" data-i18n="settingsTabPreferences">偏好设置</span>
          </button>
        </div>
        <div class="settings-content">
          <!-- 账户安全面板 -->
          <div class="settings-panel active" data-panel="security">
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="changePasswordTitle">修改密码</h3>
              <div class="settings-form">
                <div class="settings-field">
                  <label for="settingsCurrentPassword" data-i18n="currentPasswordLabel">当前密码</label>
                  <input type="password" id="settingsCurrentPassword" placeholder="请输入当前密码" data-i18n-placeholder="currentPasswordPlaceholder" autocomplete="current-password" />
                </div>
                <div class="settings-field">
                  <label for="settingsNewPassword" data-i18n="newPasswordLabel">新密码</label>
                  <input type="password" id="settingsNewPassword" placeholder="请输入新密码" data-i18n-placeholder="newPasswordPlaceholder" autocomplete="new-password" />
                </div>
                <div class="settings-field">
                  <label for="settingsConfirmPassword" data-i18n="confirmPasswordLabel">确认新密码</label>
                  <input type="password" id="settingsConfirmPassword" placeholder="请再次输入新密码" data-i18n-placeholder="confirmPasswordPlaceholder" autocomplete="new-password" />
                </div>
                <div id="changePasswordResult" class="change-password-result" style="display: none;"></div>
                <button class="btn btn-primary" id="changePasswordBtn" onclick="changePassword()" style="width: 100%;" data-i18n="changePasswordBtn">修改密码</button>
              </div>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="logoutTitle">退出登录</h3>
              <p class="settings-desc" data-i18n="logoutDesc">退出当前账户，需要重新输入密码登录。</p>
              <button class="btn btn-danger" onclick="logout()" style="width: 100%;" data-i18n="logoutBtn">退出登录</button>
            </div>
          </div>

          <!-- 同步设置面板 -->
          <div class="settings-panel" data-panel="sync">
            <div class="settings-section">
              <button type="button" class="sync-card" onclick="openWebdavFromSettings()">
                <div class="sync-card-header">
                  <div class="sync-card-info">
                    <span class="sync-card-icon">${dialogIcon('cloud')}</span>
                    <div>
                      <div class="sync-card-title" data-i18n="syncWebdavTitle">WebDAV 同步</div>
                      <div class="sync-card-desc" data-i18n="syncWebdavDesc">自动推送备份到 WebDAV 服务器</div>
                    </div>
                  </div>
                  <span id="settingsWebdavStatus" class="sync-status not-configured" data-i18n="syncStatusNotConfigured">未配置</span>
                </div>
              </button>
            </div>
            <div class="settings-section">
              <button type="button" class="sync-card" onclick="openS3FromSettings()">
                <div class="sync-card-header">
                  <div class="sync-card-info">
                    <span class="sync-card-icon">${dialogIcon('box')}</span>
                    <div>
                      <div class="sync-card-title" data-i18n="syncS3Title">S3 同步</div>
                      <div class="sync-card-desc" data-i18n="syncS3Desc">自动推送备份到 S3 兼容存储</div>
                    </div>
                  </div>
                  <span id="settingsS3Status" class="sync-status not-configured" data-i18n="syncStatusNotConfigured">未配置</span>
                </div>
              </button>
            </div>
            <div class="settings-section">
              <button type="button" class="sync-card" onclick="openOneDriveFromSettings()">
                <div class="sync-card-header">
                  <div class="sync-card-info">
                    <span class="sync-card-icon">${dialogIcon('cloud')}</span>
                    <div>
                      <div class="sync-card-title" data-i18n="syncOneDriveTitle">OneDrive 同步</div>
                      <div class="sync-card-desc" data-i18n="syncOneDriveDesc">自动推送备份到 Microsoft OneDrive</div>
                    </div>
                  </div>
                  <span id="settingsOneDriveStatus" class="sync-status not-configured" data-i18n="syncStatusNotConfigured">未配置</span>
                </div>
              </button>
            </div>
            <div class="settings-section">
              <button type="button" class="sync-card" onclick="openGoogleDriveFromSettings()">
                <div class="sync-card-header">
                  <div class="sync-card-info">
                    <span class="sync-card-icon">${dialogIcon('folder')}</span>
                    <div>
                      <div class="sync-card-title" data-i18n="syncGoogleDriveTitle">Google Drive 同步</div>
                      <div class="sync-card-desc" data-i18n="syncGoogleDriveDesc">自动推送备份到 Google Drive</div>
                    </div>
                  </div>
                  <span id="settingsGoogleDriveStatus" class="sync-status not-configured" data-i18n="syncStatusNotConfigured">未配置</span>
                </div>
              </button>
            </div>
            <div class="settings-info-box" data-i18n="syncInfoBox">
              配置同步后，每次备份（事件驱动、定时、手动）都会自动推送到远程存储。推送失败不影响本地备份。
            </div>
          </div>

          <!-- 偏好设置面板 -->
          <div class="settings-panel" data-panel="preferences">
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="themeTitle">主题模式</h3>
              <div class="theme-options">
                <label class="theme-option">
                  <input type="radio" name="settingsTheme" value="light" onchange="applyThemeFromSettings('light')" />
                  <span class="theme-option-label">${dialogIcon('sun')} <span data-i18n="themeLight">浅色模式</span></span>
                </label>
                <label class="theme-option">
                  <input type="radio" name="settingsTheme" value="dark" onchange="applyThemeFromSettings('dark')" />
                  <span class="theme-option-label">${dialogIcon('moon')} <span data-i18n="themeDark">深色模式</span></span>
                </label>
                <label class="theme-option">
                  <input type="radio" name="settingsTheme" value="auto" onchange="applyThemeFromSettings('auto')" />
                  <span class="theme-option-label">${dialogIcon('screen')} <span data-i18n="themeAuto">跟随系统</span></span>
                </label>
              </div>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" id="settingsLanguageTitle" data-i18n="languageTitle">界面语言</h3>
              <select id="settingsLanguage" class="settings-select" aria-labelledby="settingsLanguageTitle" onchange="saveLanguagePreference(this.value)">
                <option value="auto" data-i18n="langAuto">跟随系统 (Auto)</option>
                ${LANGUAGE_OPTIONS.map(({ value, label }) => `<option value="${value}" lang="${value}">${label}</option>`).join('\n                ')}
              </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" id="settingsOTPAnimationTitle" data-i18n="otpAnimationTitle">验证码交接动效</h3>
              <select id="settingsOTPAnimationMode" class="settings-select" aria-labelledby="settingsOTPAnimationTitle" onchange="applyOTPAnimationFromSettings(this.value)">
                <option value="none" data-i18n="animNone">关闭动效</option>
                <option value="flow" data-i18n="animFlow">流转交接</option>
                <option value="flip" data-i18n="animFlip">翻牌交接</option>
                <option value="spotlight" data-i18n="animSpotlight">聚光显现</option>
              </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="defaultExportFormatTitle">批量导出和备份导出偏好格式</h3>
              <p class="settings-desc" data-i18n="defaultExportFormatDesc">设置批量导出和“导出备份”共用的默认格式。它会影响这两个导出弹窗的默认操作，也会用于新创建的手动备份、自动备份和远程自动备份文件。</p>
              <select aria-label="默认导出格式" id="settingsDefaultExportFormat" class="settings-select" onchange="saveDefaultExportFormat()" data-i18n-aria-label="pageDefaultExportFormat">
                <option value="json">JSON</option>
                <option value="txt" data-i18n="formatTxt">TXT 文本</option>
                <option value="csv" data-i18n="formatCsv">CSV 表格</option>
                <option value="html" data-i18n="formatHtml">HTML 网页</option>
              </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="jwtExpiryTitle">登录有效期</h3>
              <p class="settings-desc" data-i18n="jwtExpiryDesc">设置登录状态保留的天数，修改后自动保存，下次登录生效。</p>
              <div class="settings-inline-group">
                <input type="number" aria-label="登录有效期（天）" aria-describedby="settingsJwtExpiryResult" id="settingsJwtExpiryDays" class="settings-input" min="1" max="365" step="1" value="30" oninput="scheduleNumericPreferenceSave('jwtExpiryDays')" onblur="saveJwtExpiryDays()" onkeydown="if (event.key === 'Enter') { event.preventDefault(); saveJwtExpiryDays(); }"  data-i18n-aria-label="pageLoginDays"/>
                <span class="settings-unit" data-i18n="jwtExpiryUnit">天</span>
              </div>
              <p id="settingsJwtExpiryResult" class="settings-result" role="status" aria-live="polite" style="display:none;"></p>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section">
              <h3 class="settings-section-title" data-i18n="maxBackupsTitle">备份保留数量</h3>
              <p class="settings-desc" data-i18n="maxBackupsDesc">设置自动清理时最多保留的备份数量，修改后自动保存。设为 0 表示不限制。</p>
              <div class="settings-inline-group">
                <input type="number" aria-label="备份保留数量" aria-describedby="settingsMaxBackupsResult" id="settingsMaxBackups" class="settings-input" min="0" max="1000" step="1" value="100" oninput="scheduleNumericPreferenceSave('maxBackups')" onblur="saveMaxBackups()" onkeydown="if (event.key === 'Enter') { event.preventDefault(); saveMaxBackups(); }"  data-i18n-aria-label="maxBackupsTitle"/>
                <span class="settings-unit" data-i18n="maxBackupsUnit">条</span>
              </div>
              <p id="settingsMaxBackupsResult" class="settings-result" role="status" aria-live="polite" style="display:none;"></p>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-section" id="settingsPwaSection">
              <h3 class="settings-section-title" data-i18n="pwaInstallBtn">安装到桌面</h3>
              <p class="settings-desc" data-i18n="pwaSectionDesc">以应用形式将 2FA Manager 添加到主屏幕或桌面，支持离线访问。</p>
              <button class="btn btn-primary btn-sm" id="settingsPwaInstallBtn" onclick="triggerPwaInstallFromSettings()" title="暂不可用（浏览器未触发安装提示）" disabled data-i18n-title="pwaUnavailable" data-i18n="pwaInstallBtn">安装到桌面</button>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-modal-actions"><button type="button" class="btn btn-primary" data-i18n="completed" onclick="hideSettingsModal()">完成</button></div>
    </div>
  </div>

  <!-- 二维码模态框 -->
  <div id="qrModal" class="modal" role="dialog" aria-modal="true" style="display: none;" aria-labelledby="qrTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="qrTitle" data-i18n="cardMenuQRCode">二维码</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideQRModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="qr-subtitle-section">
        <p id="qrSubtitle" data-i18n="pageQrSubtitle">扫描此二维码导入到其他2FA应用</p>
      </div>

      <div class="qr-code-container">
        <!-- 二维码将在这里动态生成 -->
      </div>

      <div class="qr-info">
        <span data-i18n="pageQrHelp">使用任意2FA应用扫描二维码即可添加此账户</span><br>
        <span data-i18n="pageQrApps">支持：Google Authenticator、Microsoft Authenticator、Authy等</span>
      </div>
    </div>
  </div>

      <!-- 中间提示组件 -->
  <div id="centerToast" class="center-toast">
    <div class="toast-content">
      <div class="toast-icon"></div>
      <div class="toast-message"></div>
    </div>
  </div>

  <!-- 导出格式选择模态框 -->
  <div id="exportFormatModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="exportFormatModalTitle">
    <div class="modal-content export-modal-compact">
      <div class="modal-header">
        <h2 id="exportFormatModalTitle" data-i18n="exportFormatModalTitle">选择导出格式</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideExportFormatModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="export-summary">
        <span class="export-count" data-i18n-html="exportCountSummary" data-i18n-count-id="exportCount">共 <strong id="exportCount">0</strong> 个密钥</span>
        <div class="export-sort-wrapper">
          <label class="export-sort-label" for="exportSortOrder" data-i18n="exportSortOrderLabel">导出顺序</label>
          <select id="exportSortOrder" class="export-sort-select">
            <option value="index-asc" data-i18n="sortOldestFirst">最早添加</option>
            <option value="index-desc" data-i18n="sortNewestFirst">最晚添加</option>
            <option value="name-asc" data-i18n="sortServiceNameAsc">服务名称 A-Z</option>
            <option value="name-desc" data-i18n="sortServiceNameDesc">服务名称 Z-A</option>
            <option value="account-asc" data-i18n="sortAccountNameAsc">账户名称 A-Z</option>
            <option value="account-desc" data-i18n="sortAccountNameDesc">账户名称 Z-A</option>
          </select>
        </div>
        <button id="exportUseDefaultBtn" class="btn btn-sm" onclick="exportUsingDefaultFormat()" data-i18n="exportUseDefaultBtn">按默认格式导出</button>
      </div>

      <!-- 通用格式 -->
      <div class="format-section">
        <div class="format-section-title" data-i18n="formatSectionGeneral">通用格式</div>
        <div class="format-grid">
          <button type="button" class="format-card" onclick="selectExportFormat('txt')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">OTPAuth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat" data-i18n="pageFormatUniversal">通用</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('json')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">JSON</span>
            <span class="format-ext">.json</span>
            <span class="format-compat" data-i18n="pageFormatUniversal">通用</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('csv')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">CSV</span>
            <span class="format-ext">.csv</span>
            <span class="format-compat">Excel</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('html')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">HTML</span>
            <span class="format-ext">.html</span>
            <span class="format-compat" data-i18n="pageFormatPrint">打印/扫码</span>
          </button>
        </div>
      </div>

      <!-- 验证器应用 -->
      <div class="format-section">
        <div class="format-section-title" data-i18n="formatSectionApps">验证器应用</div>
        <div class="format-grid">
          <button type="button" class="format-card" onclick="selectExportFormat('google')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">Google</span>
            <span class="format-ext" data-i18n="pageMigration">迁移</span>
            <span class="format-compat">iOS/Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('2fas')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">2FAS</span>
            <span class="format-ext">.2fas</span>
            <span class="format-compat">iOS/Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('aegis-multi')">
            <span class="format-icon">${dialogIcon('lock')}</span>
            <span class="format-name">Aegis</span>
            <span class="format-ext" data-i18n="pageMultipleFormats">多种格式</span>
            <span class="format-compat">Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('andotp')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">andOTP</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('authpro-multi')">
            <span class="format-icon">${dialogIcon('lock')}</span>
            <span class="format-name">Auth Pro</span>
            <span class="format-ext" data-i18n="pageMultipleFormats">多种格式</span>
            <span class="format-compat" data-i18n="pageAllPlatforms">全平台</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('bitwarden-auth-multi')">
            <span class="format-icon">${dialogIcon('lock')}</span>
            <span class="format-name">Bitwarden Auth</span>
            <span class="format-ext" data-i18n="pageMultipleFormats">多种格式</span>
            <span class="format-compat" data-i18n="pageAllPlatforms">全平台</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('ente-auth')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">Ente Auth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat">iOS/Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('freeotp')">
            <span class="format-icon">${dialogIcon('code')}</span>
            <span class="format-name">FreeOTP</span>
            <span class="format-ext">.xml</span>
            <span class="format-compat">Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('freeotp-plus-multi')">
            <span class="format-icon">${dialogIcon('lock')}</span>
            <span class="format-name">FreeOTP+</span>
            <span class="format-ext" data-i18n="pageMultipleFormats">多种格式</span>
            <span class="format-compat">Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('lastpass')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">LastPass</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">iOS/Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('proton')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">Proton</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">iOS/Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('totp-auth')">
            <span class="format-icon">${dialogIcon('code')}</span>
            <span class="format-name">TOTP Auth</span>
            <span class="format-ext">.encrypt</span>
            <span class="format-compat">Android</span>
          </button>
          <button type="button" class="format-card" onclick="selectExportFormat('winauth')">
            <span class="format-icon">${dialogIcon('file')}</span>
            <span class="format-name">WinAuth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat">Windows</span>
          </button>
        </div>
      </div>

      <!-- 格式说明（可折叠） -->
      <details class="format-details">
        <summary data-i18n="formatDetailsSummary">查看格式说明与兼容性</summary>
        <div class="format-help-content">
          <p><strong>OTPAuth</strong> <span data-i18n="pageFormatUriHelp">标准 URI 格式 → Google/Microsoft/Authy/Aegis/2FAS/andOTP/FreeOTP/Ente Auth/WinAuth 等</span></p>
          <p><strong>JSON</strong> <span data-i18n="pageFormatJsonHelp">结构化数据 → 本应用、程序处理</span></p>
          <p><strong>CSV</strong> <span data-i18n="pageFormatCsvHelp">表格格式 → Excel/Numbers/Google Sheets、本应用</span></p>
          <p><strong>HTML</strong> <span data-i18n="pageFormatHtmlHelp">优先内嵌二维码 → 浏览器查看、打印存档、扫码导入；大批量时会保留表格与可恢复数据但不嵌入二维码</span></p>
          <p><strong>Google</strong> <span data-i18n="pageFormatGoogleHelp">迁移二维码 → Google Authenticator、支持扫码的验证器</span></p>
          <p><strong>Aegis</strong> → Aegis Authenticator (Android)</p>
          <p><strong>2FAS</strong> → 2FAS (iOS/Android)</p>
          <p><strong>andOTP</strong> → andOTP (Android)、Aegis</p>
          <p><strong>FreeOTP</strong> <span data-i18n="pageFormatFreeotpHelp">加密备份 → FreeOTP (Android)</span></p>
          <p><strong>FreeOTP+</strong> → FreeOTP+ (Android)</p>
          <p><strong>TOTP Auth</strong> <span data-i18n="pageFormatTotpAuthHelp">加密备份 → TOTP Authenticator (Android)</span></p>
          <p><strong>LastPass</strong> → LastPass Authenticator</p>
          <p><strong>Proton</strong> → Proton Authenticator</p>
          <p><strong>Auth Pro</strong> → Authenticator Pro (Stratum)</p>
          <p><strong>Bitwarden Auth</strong> → Bitwarden Authenticator</p>
          <p><strong>Ente Auth</strong> <span data-i18n="pageFormatEnteHelp">标准 OTPAuth 格式 → Ente Auth (iOS/Android)</span></p>
          <p><strong>WinAuth</strong> <span data-i18n="pageFormatWinAuthHelp">标准 OTPAuth 格式 → WinAuth (Windows)</span></p>
          <p><strong>Aegis TXT</strong> <span data-i18n="pageFormatAegisHelp">标准 OTPAuth 格式 → Aegis Authenticator (Android)</span></p>
          <p><strong>Auth Pro TXT</strong> <span data-i18n="pageFormatAuthProHelp">标准 OTPAuth 格式 → Authenticator Pro (全平台)</span></p>
          <p><strong>FreeOTP TXT</strong> <span data-i18n="pageFormatFreeotpTxtHelp">标准 OTPAuth 格式 → FreeOTP/FreeOTP+ (Android)</span></p>
        </div>
      </details>
    </div>
  </div>

  <!-- 二级格式选择模态框 -->
  <div id="subFormatModal" class="modal fab-modal-sm" role="dialog" aria-modal="true" aria-labelledby="subFormatTitle">
    <div class="modal-content sub-format-modal">
      <div class="modal-header">
        <h2 id="subFormatTitle" data-i18n="exportFormatModalTitle">选择导出格式</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideSubFormatModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>
      <div class="sub-format-list" id="subFormatList">
        <!-- 动态生成格式选项 -->
      </div>
    </div>
  </div>

  <!-- FreeOTP 原版导出密码模态框 -->
  <div id="freeotpExportModal" class="modal fab-modal-sm" role="dialog" aria-modal="true" aria-labelledby="freeotpExportModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="freeotpExportModalTitle" data-i18n="pageFreeotpExportTitle">FreeOTP 加密导出</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideFreeOTPExportModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 4px; font-size: var(--dialog-body-size);">
        <p style="margin: 0 0 10px 0; color: var(--text-primary);">
          <strong data-i18n-html="pageFreeotpCount" data-i18n-count-id="freeotpExportCount">导出 <span id="freeotpExportCount">0</span> 个密钥到 FreeOTP</strong>
        </p>
        <p style="margin: 0; font-size: var(--dialog-caption-size); color: var(--text-secondary);">
          <span data-i18n="pageEncryptionHelp">设置加密密码保护您的备份文件。</span><br>
          <span data-i18n="pageFreeotpPasswordHelp">导入到 FreeOTP 时需要输入相同的密码。</span>
        </p>
      </div>

      <div class="form-group">
        <label for="freeotpExportPassword" data-i18n="pageEncryptionPassword">加密密码</label>
        <input type="password" id="freeotpExportPassword" class="form-control" placeholder="输入加密密码" autocomplete="new-password" data-i18n-placeholder="pageEncryptionPlaceholder">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideFreeOTPExportModal()" data-i18n="cancel">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeFreeOTPExport()" data-i18n="pageEncryptedExport">加密导出</button>
      </div>
    </div>
  </div>

  <!-- TOTP Authenticator 导出密码模态框 -->
  <div id="totpAuthExportModal" class="modal fab-modal-sm" role="dialog" aria-modal="true" aria-labelledby="totpAuthExportModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="totpAuthExportModalTitle" data-i18n="pageTotpAuthExportTitle">TOTP Authenticator 加密导出</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideTOTPAuthExportModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 4px; font-size: var(--dialog-body-size);">
        <p style="margin: 0 0 10px 0; color: var(--text-primary);">
          <strong data-i18n-html="pageTotpAuthCount" data-i18n-count-id="totpAuthExportCount">导出 <span id="totpAuthExportCount">0</span> 个密钥到 TOTP Authenticator</strong>
        </p>
        <p style="margin: 0; font-size: var(--dialog-caption-size); color: var(--text-secondary);">
          <span data-i18n="pageEncryptionHelp">设置加密密码保护您的备份文件。</span><br>
          <span data-i18n="pageTotpAuthPasswordHelp">导入到 TOTP Authenticator 时需要输入相同的密码。</span>
        </p>
      </div>

      <div class="form-group">
        <label for="totpAuthExportPassword" data-i18n="pageEncryptionPassword">加密密码</label>
        <input type="password" id="totpAuthExportPassword" class="form-control" placeholder="输入加密密码" autocomplete="new-password" data-i18n-placeholder="pageEncryptionPlaceholder">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideTOTPAuthExportModal()" data-i18n="cancel">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeTOTPAuthExport()" data-i18n="pageEncryptedExport">加密导出</button>
      </div>
    </div>
  </div>

  <!-- 备份导出格式选择模态框 -->
  <div id="backupExportFormatModal" class="modal fab-modal" role="dialog" aria-modal="true" aria-labelledby="backupExportFormatModalTitle">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="backupExportFormatModalTitle" data-i18n="pageBackupFormatTitle">选择备份导出格式</h2>
        <button class="close-btn" type="button" aria-label="关闭弹窗" onclick="hideBackupExportFormatModal()" data-i18n-aria-label="pageCloseDialog">${dialogIcon('close')}</button>
      </div>

      <div class="export-instructions">
        <p style="margin: 0; color: var(--text-primary);">
          <strong data-i18n="pageExportSelectedBackup">导出选中的备份文件</strong><br>
          <small style="color: var(--text-secondary);" data-i18n="pageBackupFormatHelp">请选择您需要的导出格式，不同格式适用于不同的场景。设置页中的默认导出格式也会用于新创建的备份文件和远程自动备份。</small>
        </p>
        <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
          <button id="backupUseDefaultBtn" class="btn btn-sm" onclick="exportSelectedBackupUsingDefaultFormat()" data-i18n="exportUseDefaultBtn">按默认格式导出</button>
        </div>
      </div>

      <div class="dialog-backup-formats">
        <button type="button" class="dialog-backup-format" onclick="selectBackupExportFormat('txt')">
          ${dialogIcon('file')}
          <span><strong data-i18n="pageFormatOtpTitle">OTPAuth 文本格式</strong><small data-i18n="pageFormatOtpDesc">标准 otpauth:// 链接，兼容多数验证器</small></span>
        </button>
        <button type="button" class="dialog-backup-format" onclick="selectBackupExportFormat('json')">
          ${dialogIcon('code')}
          <span><strong data-i18n="pageFormatJsonTitle">JSON 数据格式</strong><small data-i18n="pageFormatJsonDesc">完整的结构化数据，适合备份和恢复</small></span>
        </button>
        <button type="button" class="dialog-backup-format" onclick="selectBackupExportFormat('csv')">
          ${dialogIcon('grid')}
          <span><strong data-i18n="pageFormatCsvTitle">CSV 表格格式</strong><small data-i18n="pageFormatCsvDesc">使用 Excel、Numbers 等电子表格查看</small></span>
        </button>
        <button type="button" class="dialog-backup-format" onclick="selectBackupExportFormat('html')">
          ${dialogIcon('qr')}
          <span><strong data-i18n="pageFormatHtmlTitle">HTML 网页格式</strong><small data-i18n="pageFormatHtmlDesc">可打印的二维码网页；数据较多时保留表格和恢复数据</small></span>
        </button>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideBackupExportFormatModal()" data-i18n="cancel">取消</button>
      </div>
    </div>
  </div>

  <!-- 登录模态框 -->
  <div id="loginModal" class="modal login-modal" role="dialog" aria-modal="true" aria-labelledby="loginModalTitle">
    <div class="modal-content login-modal-content">
      <h2 class="login-modal-title" id="loginModalTitle" data-i18n="loginModalTitle">身份验证</h2>
      <p class="login-modal-description">
        <span data-i18n="loginModalDesc">请输入密码以管理密钥</span><br>
        <small class="login-modal-hint" data-i18n="loginModalCancelHint">或点击"取消"使用 OTP 生成功能</small>
      </p>
      <div id="loginInsecureWarning" class="login-insecure-warning" style="display: none;">
        <strong data-i18n="loginInsecureTitle">当前正通过 HTTP 访问</strong>
        <span data-i18n="loginInsecureDesc">浏览器无法在 HTTP 下保存登录状态，登录后仍会反复要求输入密码。请将地址栏中的 http:// 改为 https:// 后重新访问。</span>
      </div>
      <form id="loginForm" onsubmit="event.preventDefault(); handleLoginSubmit(); return false;" autocomplete="on">
      <div class="form-group">
        <label for="loginToken" data-i18n="loginPasswordLabel">密码</label>
        <div class="login-password-wrapper">
          <input type="password" id="loginToken" placeholder="请输入您的密码" data-i18n-placeholder="loginPasswordPlaceholder" autocomplete="current-password" name="password">
          <button
            type="button"
            id="loginPasswordToggle"
            class="login-password-toggle"
            onclick="toggleLoginPasswordVisibility()"
            aria-label="显示密码"
            title="显示密码"
           data-i18n-title="setupShowPassword" data-i18n-aria-label="setupShowPassword">
            <svg
              class="login-password-icon login-password-icon-show"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7Zm0 11.5A4.5 4.5 0 1 1 12 7a4.5 4.5 0 0 1 0 9.5Z"
                fill="currentColor"
              />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
            <svg
              class="login-password-icon login-password-icon-hide"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3.3 4.7 2 6l3.1 3.1A13.7 13.7 0 0 0 1 12c1.7 3.9 6 7 11 7 2 0 3.9-.5 5.5-1.3L20.7 21l1.3-1.3L3.3 4.7Zm8.7 12.3c-2.8 0-5-2.2-5-5 0-.8.2-1.6.5-2.3l6.8 6.8c-.7.3-1.5.5-2.3.5Zm0-10c5 0 9.3 3.1 11 7a12 12 0 0 1-3.9 4.7l-2-2a5 5 0 0 0-6.8-6.8l-2-2C9.5 7.3 10.7 7 12 7Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <div class="login-modal-hint" data-i18n="loginHint">
          提示：输入您设置的密码
        </div>
      </div>
      <div id="loginError" class="login-modal-error" role="alert" aria-live="polite"></div>
      <div class="button-group login-modal-actions">
        <button type="button" onclick="window.location.href='/otp'" class="btn btn-secondary login-modal-cancel-btn" data-i18n="cancel">
          取消
        </button>
        <button type="submit" class="btn btn-primary login-modal-submit-btn" data-i18n="loginSubmitBtn">
          登录
        </button>
      </div>
      </form>
    </div>
  </div>

  <!-- 浏览器扩展安装指南 -->
  <div id="browserExtensionModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="browserExtensionTitle" aria-describedby="browserExtensionDescription">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="browserExtensionTitle" data-i18n="pageExtensionTitle">2FA 验证助手</h2>
        <button id="browserExtensionClose" class="close-btn" type="button" aria-label="关闭扩展介绍" onclick="hideBrowserExtensionModal()" data-i18n-aria-label="pageExtensionClose">${dialogIcon('close')}</button>
      </div>
      <p id="browserExtensionDescription" class="extension-description" data-i18n="pageExtensionDesc">在网站验证页面直接查看和填充验证码，减少来回切换。</p>
      <p id="extensionBrowserHint" class="extension-caption" data-i18n="pageExtensionBrowserHint">支持桌面 Chrome、Edge 和 Firefox（153+），请使用对应浏览器打开商店。</p>
      <div class="extension-store-links">
        <a id="extensionChromeStore" class="btn btn-secondary extension-store-link" href="https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl" target="_blank" rel="noopener noreferrer">
          <span data-i18n="pageChromeStore">Chrome 商店</span>
        </a>
        <a id="extensionEdgeStore" class="btn btn-secondary extension-store-link" href="https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm" target="_blank" rel="noopener noreferrer">
          <span data-i18n="pageEdgeStore">Edge 商店</span>
        </a>
        <a id="extensionFirefoxStore" class="btn btn-secondary extension-store-link" href="https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/" target="_blank" rel="noopener noreferrer">
          <span data-i18n="pageFirefoxStore">Firefox 商店</span>
        </a>
      </div>
      <div class="extension-connection">
        <label class="extension-instance-label" for="extensionInstanceUrl" data-i18n="pageInstanceAddress">当前实例地址</label>
        <div class="extension-instance-controls">
          <input id="extensionInstanceUrl" type="text" readonly spellcheck="false" autocomplete="off" aria-describedby="extensionConnectionHint">
          <button id="extensionCopyInstance" type="button" class="btn btn-secondary" onclick="copyExtensionInstanceUrl()" data-i18n="pageCopyAddress">复制地址</button>
        </div>
        <p id="extensionCopyStatus" class="extension-caption extension-copy-status" role="status" aria-live="polite" aria-atomic="true"></p>
        <p id="extensionConnectionHint" class="extension-caption" data-i18n="pageExtensionConnectHint">安装并固定到工具栏后，在扩展设置中填入此地址，点击“连接 2FA”，按提示登录并授权。自动填充需在目标验证页面单独开启。</p>
      </div>
      <div class="extension-help-links">
        <a href="https://github.com/wuzf/2fa/blob/main/docs/BROWSER_EXTENSION.md" target="_blank" rel="noopener noreferrer" data-i18n="pageUserGuide">使用指南</a>
      </div>
    </div>
  </div>

  <!-- 页面底部链接 -->
  <footer class="page-footer">
    <div class="footer-content">
      <div class="footer-links">
        <a href="https://github.com/wuzf/2fa/blob/main/README.md" target="_blank" rel="noopener noreferrer" class="footer-link" data-i18n="pageDocumentation">
          使用文档
        </a>
        <span class="footer-separator">•</span>
        <button id="browserExtensionTrigger" type="button" class="footer-link footer-button" aria-controls="browserExtensionModal" onclick="openBrowserExtensionStore()" data-i18n="pageBrowserExtension">浏览器扩展</button>
        <span class="footer-separator">•</span>
        <a href="https://github.com/wuzf/2fa/issues" target="_blank" rel="noopener noreferrer" class="footer-link" data-i18n="pageFeedback">
          反馈问题
        </a>
        <span class="footer-separator">•</span>
        <a href="https://github.com/wuzf/2fa" target="_blank" rel="noopener noreferrer" class="footer-link">
          <svg class="github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
          GitHub
        </a>
      </div>
      <div class="footer-info">
        Made with ❤️ by <a href="https://github.com/wuzf" target="_blank" rel="noopener noreferrer" class="footer-link">wuzf</a>
        <span class="footer-separator">•</span>
        <span class="footer-version">v${APP_VERSION}</span>
        <a id="footerUpdateBadge" class="footer-update-badge" href="https://github.com/wuzf/2fa" target="_blank" rel="noopener noreferrer" style="display: none;"></a>
      </div>
    </div>
  </footer>

  <!-- 固定悬浮按钮组 -->
  <!-- 操作菜单按钮 -->
  <div class="action-menu-float">
    <button class="main-action-button" id="mainActionBtn" aria-label="打开操作菜单" aria-expanded="false" aria-controls="actionSubmenu" onclick="toggleActionMenu()" title="操作菜单" data-i18n-title="pageActions" data-i18n-aria-label="pageOpenActions">
      ${dialogIcon('plus')}
    </button>

    <div class="action-submenu" id="actionSubmenu">
      <button type="button" class="submenu-item" onclick="showQRScanner(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('qr')}</span>
        <span class="item-text" data-i18n="fabScanQR">扫二维码</span>
      </button>
      <button type="button" class="submenu-item" onclick="showAddModal(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('plus')}</span>
        <span class="item-text" data-i18n="fabAddSecret">手动添加</span>
      </button>
      <button type="button" class="submenu-item" onclick="showImportModal(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('import')}</span>
        <span class="item-text" data-i18n="fabImport">批量导入</span>
      </button>
      <button type="button" class="submenu-item" onclick="exportAllSecrets(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('export')}</span>
        <span class="item-text" data-i18n="fabExport">批量导出</span>
      </button>
      <button type="button" class="submenu-item" onclick="showRestoreModal(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('restore')}</span>
        <span class="item-text" data-i18n="fabBackup">还原配置</span>
      </button>
      <button type="button" class="submenu-item" onclick="showToolsModal(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('toolbox')}</span>
        <span class="item-text" data-i18n="fabTools">实用工具</span>
      </button>
      <button type="button" class="submenu-item" onclick="showSettingsModal(); closeActionMenu();">
        <span class="item-icon">${dialogIcon('settings')}</span>
        <span class="item-text" data-i18n="fabSettings">系统设置</span>
      </button>
    </div>
  </div>

`;
}

/**
 * JavaScript脚本部分 - 引用外部脚本文件
 * @param {boolean} lazyLoad - 是否启用懒加载模式
 */
function getHTMLScripts(lazyLoad = true) {
	const scriptContent = getInlineScripts(lazyLoad);
	// jsQR / qrcode-generator 改为按需加载（见 utils.js 中的 ensureJsQR / ensureQRCodeGen），
	// 避免 ~150KB CDN 库阻塞首屏渲染。Service Worker 会在首次请求时按需缓存这两个 URL。
	return '<script>\n' + scriptContent + '\n</script>';
}

/**
 * HTML结束部分
 */
function getHTMLEnd() {
	return `</body>
</html>`;
}

/**
 * 获取内联JavaScript代码
 * @param {boolean} lazyLoad - 是否启用懒加载（true=核心模块，false=完整模块）
 */
function getInlineScripts(lazyLoad = true) {
	if (lazyLoad) {
		console.log('📦 代码分割模式：仅加载核心模块');
		return getCoreScripts();
	} else {
		console.log('📦 传统模式：加载完整模块');
		return getScripts();
	}
}
