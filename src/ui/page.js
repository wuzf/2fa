/**
 * UI页面生成模块 - 完整版本
 * 包含所有原版功能：搜索、导入导出、二维码、编辑删除等
 * 支持代码分割和懒加载优化
 */

import { getStyles } from './styles/index.js';
import { getScripts, getCoreScripts } from './scripts/index.js';

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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>2FA - 密钥管理器</title>

  <!-- PWA Manifest -->
  <link rel="manifest" href="/manifest.json">

  <!-- PWA Meta Tags -->
  <meta name="application-name" content="2FA">
  <meta name="description" content="安全的两步验证密钥管理器，支持 TOTP、HOTP 验证码生成">
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

  <!-- Theme Initialization - Must run before CSS to prevent FOUC -->
  <script>
    (function() {
      try {
        const theme = localStorage.getItem('theme') || 'auto';
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // 设置主题：dark 强制深色，light 强制浅色，auto 跟随系统
        const dataTheme = (theme === 'dark' || (theme === 'auto' && prefersDark)) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', dataTheme);
      } catch (e) {
        // Fallback to light theme if localStorage access fails
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>`;
}

/**
 * HTML样式部分 - 包含所有原版样式
 */
function getHTMLBody() {
	return `
<body>
  <div class="container">
    <div class="content">
      <div class="search-section">
        <div class="search-container">
          <!-- 防止浏览器自动填充的隐藏输入框 -->
          <input type="text" name="prevent_autofill_username" style="display:none" tabindex="-1" autocomplete="new-password">
          <input type="password" name="prevent_autofill_password" style="display:none" tabindex="-1" autocomplete="new-password">

          <!-- 搜索框和操作按钮的水平布局 -->
          <div class="search-action-row">
          <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input type="search"
                   id="searchInput"
                   name="search-query"
                   class="search-input"
                   placeholder="搜索服务或账户名称"
                   oninput="filterSecrets(this.value)"
                   autocomplete="off"
                   autocorrect="off"
                   autocapitalize="off"
                   spellcheck="false"
                   role="searchbox"
                   aria-label="搜索2FA密钥"
                   data-form-type="other"
                   data-lpignore="true"
                   data-1p-ignore="true"
                   data-bwignore="true"
                   readonly
                   onfocus="this.removeAttribute('readonly')">
            <button class="search-clear" id="searchClear" onclick="clearSearch()" style="display: none;">✕</button>
      </div>
          <div class="sort-controls">
            <select id="sortSelect" class="sort-select" onchange="applySorting()">
              <option value="oldest-first">最早添加</option>
              <option value="newest-first">最晚添加</option>
              <option value="name-asc">服务名称 A-Z</option>
              <option value="name-desc">服务名称 Z-A</option>
              <option value="account-asc">账户名称 A-Z</option>
              <option value="account-desc">账户名称 Z-A</option>
            </select>
      </div>
          </div>
          <div class="search-stats" id="searchStats" style="display: none;"></div>
        </div>
      </div>

      <!-- 背景遮罩 -->
      <div class="menu-overlay" id="menuOverlay" onclick="closeActionMenu()"></div>
      
      <div id="loading" class="loading">
        <div>⏳ 加载中...</div>
      </div>
      
      <div id="secretsList" class="secrets-list" style="display: none;">
        <!-- 密钥列表将在这里动态生成 -->
      </div>
      
      <div id="emptyState" class="empty-state" style="display: none;">
        <div class="icon">🔑</div>
        <h3>还没有密钥</h3>
        <p>点击上方按钮添加您的第一个2FA密钥</p>
        <div style="margin-top: 20px; font-size: 12px; color: var(--text-tertiary);">
          快捷键：Ctrl+D 调试模式 | Ctrl+R 刷新验证码<br>
          数据存储：Cloudflare Workers KV
        </div>
      </div>
    </div>
  </div>
  
  
  <!-- 二维码扫描器模态框 -->
  <div id="qrScanModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>📷 扫描二维码添加密钥</h2>
        <button class="close-btn" onclick="hideQRScanner()">&times;</button>
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
        <div id="scanCounter" class="scan-counter" style="display: none;">
          已添加 <span id="scanCountNum">0</span> 个密钥
        </div>

        <div id="scannerStatus" class="scanner-status">
          正在启动摄像头...
        </div>

        <div id="scannerError" class="scanner-error" style="display: none;">
          <div id="errorMessage"></div>
          <button class="btn btn-primary" onclick="retryCamera()" style="margin-top: 10px;">🔄 重试摄像头</button>
        </div>

        <!-- 底部操作区：连续扫描 + 选择图片 -->
        <div class="scanner-bottom-actions">
          <label class="continuous-scan-inline">
            <input type="checkbox" id="continuousScanToggle" onchange="toggleContinuousScan()">
            <span>连续扫描</span>
          </label>
          <input type="file" id="qrImageInput" accept="image/*" style="display: none;" onchange="handleImageUpload(event)">
          <button class="btn btn-info btn-compact" onclick="document.getElementById('qrImageInput').click()">📁 选择图片</button>
        </div>
        <div class="scanner-hint">💡 支持标准2FA码及Google迁移码批量导入</div>
      </div>
    </div>
  </div>
  
  <!-- 添加/编辑密钥模态框 -->
  <div id="secretModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modalTitle">添加新密钥</h2>
        <button class="close-btn" onclick="hideSecretModal()">&times;</button>
      </div>
      
      <form id="secretForm" onsubmit="handleSubmit(event)" autocomplete="off">
        <input type="hidden" id="secretId" value="">

        <div class="form-group">
          <label for="secretName">服务名称 *</label>
          <input type="text" id="secretName" required placeholder="例如：GitHub, Google, Microsoft" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="secretService">账户名称</label>
          <input type="text" id="secretService" placeholder="例如：your@email.com 或 用户名" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="secretKey">密钥 (Base32) *</label>
          <input type="text" id="secretKey" required placeholder="输入16位或更长的Base32密钥" autocomplete="off">
        </div>
        
        <!-- 高级参数区域 -->
        <div class="form-section">
          <div class="section-header">
            <label>
              <input type="checkbox" id="showAdvanced" onchange="toggleAdvancedOptions()"> 
              高级设置 (可选)
            </label>
          </div>
          
          <div id="advancedOptions" class="advanced-options" style="display: none;">
            <div class="form-row">
              <div class="form-group-small">
                <label for="secretType">🔐 类型</label>
                <select id="secretType" onchange="updateAdvancedOptionsForType()">
                  <option value="TOTP" selected>TOTP (时间基准)</option>
                  <option value="HOTP">HOTP (计数器基准)</option>
                </select>
              </div>
              
              <div class="form-group-small" id="digitsGroup">
                <label for="secretDigits">🔢 位数</label>
                <select id="secretDigits">
                  <option value="6" selected>6位</option>
                  <option value="8">8位</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group-small" id="periodGroup">
                <label for="secretPeriod">⏱️ 周期(秒)</label>
                <select id="secretPeriod">
                  <option value="30" selected>30秒</option>
                  <option value="60">60秒</option>
                  <option value="120">120秒</option>
                </select>
              </div>
              
              <div class="form-group-small" id="algorithmGroup">
                <label for="secretAlgorithm">🔧 算法</label>
                <select id="secretAlgorithm">
                  <option value="SHA1" selected>SHA1</option>
                  <option value="SHA256">SHA256</option>
                  <option value="SHA512">SHA512</option>
                </select>
              </div>
            </div>
            
            <div class="form-row" id="counterRow" style="display: none;">
              <div class="form-group-small" id="counterGroup">
                <label for="secretCounter">📊 计数器</label>
                <input type="number" id="secretCounter" value="0" min="0" step="1" placeholder="初始计数器值" autocomplete="off">
              </div>
            </div>
            
            <div class="advanced-info" id="advancedInfo">
              大多数2FA应用使用默认设置：TOTP、6位、30秒、SHA1算法
            </div>
          </div>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="hideSecretModal()">取消</button>
          <button type="submit" class="btn btn-primary" id="submitBtn">保存</button>
        </div>
      </form>
    </div>
  </div>

  <!-- 批量导入模态框 -->
  <div id="importModal" class="modal">
    <div class="modal-content import-modal-compact">
      <div class="modal-header">
        <h2>📥 批量导入密钥</h2>
        <button class="close-btn" onclick="hideImportModal()">&times;</button>
      </div>

      <!-- 隐藏的文件输入 -->
      <input type="file" id="importFileInput" accept=".txt,.csv,.json,.html,.htm,.2fas,.xml,.authpro,.encrypt" style="display: none;" onchange="handleImportFile(event)">

      <!-- 智能输入区：文本框支持粘贴和拖拽 -->
      <div class="smart-import-zone" id="smartImportZone">
        <textarea id="importText" class="import-textarea-smart" rows="6"
                  placeholder="在此粘贴内容，或拖拽文件到这里...&#10;&#10;支持 OTPAuth、JSON、CSV、HTML 等格式"
                  autocomplete="off"
                  oninput="autoPreviewImport()"
                  ondragover="handleDragOver(event)"
                  ondragleave="handleDragLeave(event)"
                  ondrop="handleFileDrop(event)"></textarea>
      </div>

      <!-- 选择文件按钮 -->
      <div class="import-file-btn-wrapper">
        <button type="button" class="btn btn-info import-file-btn" onclick="document.getElementById('importFileInput').click()">
          📁 选择文件
        </button>
        <span class="import-file-hint">支持 TXT, JSON, CSV, HTML, 2FAS, XML, AuthPro, Encrypt</span>
      </div>

      <!-- 已选文件信息徽章 -->
      <div class="file-info-badge" id="fileInfoBadge" style="display: none;">
        <span class="file-icon">📄</span>
        <span class="file-name" id="selectedFileName"></span>
        <span class="file-size" id="selectedFileSize"></span>
        <button type="button" class="file-clear-btn" onclick="clearSelectedFile(event)">✕</button>
      </div>

      <!-- 小提示 -->
      <div class="import-tips">
        <span class="import-tip">💡 从 Google Authenticator 导入？<a href="javascript:void(0)" onclick="hideImportModal(); showQRScanner();">扫描迁移二维码</a></span>
      </div>

      <!-- 格式说明（可折叠） -->
      <details class="import-format-details">
        <summary>📋 查看支持的格式</summary>
        <div class="import-format-help">
          <p><strong>TXT</strong> Aegis、Ente Auth、WinAuth</p>
          <p><strong>2FAS</strong> 2FAS</p>
          <p><strong>JSON</strong> Aegis、Bitwarden Auth、andOTP、FreeOTP+、LastPass、Proton</p>
          <p><strong>CSV</strong> Bitwarden Authenticator</p>
          <p><strong>HTML</strong> Aegis/Ente Auth（.html.txt）、Authenticator Pro</p>
          <p><strong>XML</strong> FreeOTP（加密备份）</p>
          <p><strong>AuthPro</strong> Authenticator Pro (Stratum)</p>
          <p><strong>Encrypt</strong> TOTP Authenticator（加密备份）</p>
        </div>
      </details>

      <!-- 预览区域 -->
      <div id="importPreview" class="import-preview-compact" style="display: none;">
        <div class="import-preview-header">
          <span class="preview-title">预览</span>
          <div class="import-stats-inline">
            <span class="stat-valid" id="statValid">0 有效</span>
            <span class="stat-invalid" id="statInvalid">0 无效</span>
            <span class="stat-total" id="statTotal">共 0 条</span>
          </div>
        </div>
        <div id="importPreviewList" class="import-preview-list"></div>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions import-form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideImportModal()">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeImport()" id="executeImportBtn" disabled>📥 导入</button>
      </div>
    </div>
  </div>

  <!-- 还原配置模态框 -->
  <div id="restoreModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔄 还原配置</h2>
        <button class="close-btn" onclick="hideRestoreModal()">&times;</button>
      </div>
      
      <div class="restore-instructions">
        <p>🔄 从备份中选择一个配置进行还原：</p>
        <p>
          ⚠️ 警告：还原操作将覆盖当前所有密钥，请谨慎操作！
        </p>
      </div>
      
      <div class="restore-content">
        <div class="backup-list-container">
          <div class="backup-list-header">
            <span>📋 选择备份文件</span>
          </div>
          <div class="backup-select-wrapper">
            <select id="backupSelect" class="backup-select" onchange="selectBackupFromDropdown()">
              <option value="">请选择备份文件...</option>
            </select>
          </div>
          <div class="backup-actions">
            <button type="button" class="btn btn-outline" onclick="loadBackupList()" style="padding: 8px 16px; font-size: 12px;">🔄 刷新</button>
            <button type="button" class="btn btn-outline" onclick="exportSelectedBackup()" id="exportBackupBtn" disabled style="padding: 8px 16px; font-size: 12px;">📥 导出备份</button>
          </div>
        </div>
        
        <div class="restore-preview" id="restorePreview" style="display: none;">
          <div class="preview-header">
            <span>📋 备份预览</span>
          </div>
          <div id="backupPreviewContent" class="backup-preview-content">
            <!-- 备份内容预览将在这里显示 -->
          </div>
        </div>
      </div>
      
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="hideRestoreModal()" style="padding: 12px 20px; border-radius: 8px; font-size: 14px;">❌ 取消</button>
        <button type="button" class="btn btn-danger" onclick="confirmRestore()" id="confirmRestoreBtn" disabled style="padding: 12px 20px; border-radius: 8px; font-size: 14px;">🔄 确认还原</button>
      </div>
    </div>
  </div>
  
  <!-- 实用工具模态框 -->
  <div id="toolsModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔧 实用工具</h2>
        <button class="close-btn" onclick="hideToolsModal()">&times;</button>
      </div>
      
      <div class="tools-list">
        <div class="tool-item" onclick="showQRScanAndDecode()">
          <div class="tool-icon">🔍</div>
          <div class="tool-content">
            <div class="tool-title">二维码解析</div>
            <div class="tool-desc">扫描并显示二维码内容</div>
          </div>
        </div>
        
        <div class="tool-item" onclick="showQRGenerateTool()">
          <div class="tool-icon">🔄</div>
          <div class="tool-content">
            <div class="tool-title">二维码生成</div>
            <div class="tool-desc">将文本转换为二维码</div>
          </div>
        </div>

        <div class="tool-item" onclick="showBase32Tool()">
          <div class="tool-icon">🔐</div>
          <div class="tool-content">
            <div class="tool-title">Base32 编解码</div>
            <div class="tool-desc">TOTP密钥格式转换工具</div>
          </div>
        </div>

        <div class="tool-item" onclick="showTimestampTool()">
          <div class="tool-icon">⏱️</div>
          <div class="tool-content">
            <div class="tool-title">时间戳工具</div>
            <div class="tool-desc">查看TOTP当前时间周期</div>
          </div>
        </div>

        <div class="tool-item" onclick="showKeyCheckTool()">
          <div class="tool-icon">✅</div>
          <div class="tool-content">
            <div class="tool-title">密钥检查器</div>
            <div class="tool-desc">验证密钥是否符合规范</div>
          </div>
        </div>

        <div class="tool-item" onclick="showKeyGeneratorTool()">
          <div class="tool-icon">🎲</div>
          <div class="tool-content">
            <div class="tool-title">密钥生成器</div>
            <div class="tool-desc">生成随机TOTP密钥</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 二维码生成工具模态框 -->
  <div id="qrGenerateModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔄 二维码生成</h2>
        <button class="close-btn" onclick="hideQRGenerateModal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title">输入内容</div>
        <div class="input-area">
          <textarea
            id="qrContentInput"
            class="content-input"
            placeholder="请输入要生成二维码的内容"
            rows="6"
            style="width: 100%; padding: 12px; border: 2px solid var(--border-primary); border-radius: 8px; font-size: 14px; font-family: monospace; resize: vertical; background: var(--input-bg); color: var(--text-primary);"
            autocomplete="off"
          ></textarea>
        </div>
      </div>
      
      <div class="tool-section" id="qrResultSection" style="display: none;">
        <div class="section-title">生成的二维码</div>
        <div class="qr-display">
          <img id="generatedQRCode" class="qr-image" style="max-width: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
          <div class="qr-tip" style="margin-top: 10px; font-size: 12px; color: var(--text-tertiary);">长按保存图片</div>
        </div>
      </div>
      
      <div class="form-actions" style="margin-top: 25px; padding-top: 20px; border-top: 1px solid var(--border-primary); display: flex; justify-content: center;">
        <button type="button" class="btn btn-primary" onclick="generateQRCode()" style="padding: 12px 20px; border-radius: 8px; font-size: 14px;">🔄 生成二维码</button>
      </div>
    </div>
  </div>
  
  <!-- Base32编解码工具模态框 -->
  <div id="base32Modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔐 Base32 编解码</h2>
        <button class="close-btn" onclick="hideBase32Modal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title">Base32 编码</div>
        <div class="input-area">
          <textarea
            id="plainTextInput"
            placeholder="输入普通文本"
            rows="4"
            style="width: 100%; padding: 12px; border: 2px solid var(--border-primary); border-radius: 8px; font-size: 14px; font-family: monospace; resize: vertical; background: var(--input-bg); color: var(--text-primary);"
            autocomplete="off"
          ></textarea>
          <div class="button-area" style="margin-top: 10px; display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="encodeBase32()" style="padding: 8px 16px; font-size: 13px;">编码</button>
            <button class="btn btn-info" onclick="copyEncodedText()" style="padding: 8px 16px; font-size: 13px;">复制</button>
          </div>
          <div id="encodedResult" class="result-text" style="margin-top: 10px; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-family: monospace; font-size: 13px; min-height: 0; word-break: break-all; display: none; color: var(--text-primary);"></div>
        </div>
      </div>
      
      <div class="divider" style="height: 1px; background: var(--border-primary); margin: 20px 0;"></div>
      
      <div class="tool-section">
        <div class="section-title">Base32 解码</div>
        <div class="input-area">
          <textarea
            id="base32TextInput"
            placeholder="输入Base32文本"
            rows="4"
            style="width: 100%; padding: 12px; border: 2px solid var(--border-primary); border-radius: 8px; font-size: 14px; font-family: monospace; resize: vertical; background: var(--input-bg); color: var(--text-primary);"
            autocomplete="off"
          ></textarea>
          <div class="button-area" style="margin-top: 10px; display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="decodeBase32()" style="padding: 8px 16px; font-size: 13px;">解码</button>
            <button class="btn btn-info" onclick="copyDecodedText()" style="padding: 8px 16px; font-size: 13px;">复制</button>
          </div>
          <div id="decodedResult" class="result-text" style="margin-top: 10px; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-family: monospace; font-size: 13px; min-height: 0; word-break: break-all; display: none; color: var(--text-primary);"></div>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 时间戳工具模态框 -->
  <div id="timestampModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>⏱️ 时间戳工具</h2>
        <button class="close-btn" onclick="hideTimestampModal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title">TOTP 时间信息</div>
        <div class="time-info" style="background: var(--bg-secondary); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);">当前时间戳:</span>
            <span class="value" id="currentTimestamp" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);">TOTP时间周期:</span>
            <span class="value" id="totpPeriod" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);">当前周期计数:</span>
            <span class="value" id="totpCounter" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
          <div class="info-item" style="display: flex; justify-content: space-between;">
            <span class="label" style="font-weight: 600; color: var(--text-primary);">剩余时间:</span>
            <span class="value" id="remainingTime" style="font-family: monospace; color: var(--text-primary);"></span>
          </div>
        </div>
        <div class="progress-bar" style="width: 100%; height: 8px; background: var(--progress-bg); border-radius: 4px; overflow: hidden;">
          <div id="progressBar" class="progress" style="height: 100%; background: var(--progress-fill); transition: width 0.3s ease;"></div>
        </div>
      </div>
      
      <div class="tool-section">
        <div class="section-title">时间周期设置</div>
        <div class="period-selector" style="display: flex; justify-content: space-between; gap: 10px;">
          <button class="btn btn-outline" id="period30Btn" onclick="setPeriod(30)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">30秒</button>
          <button class="btn btn-outline" id="period60Btn" onclick="setPeriod(60)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">60秒</button>
          <button class="btn btn-outline" id="period120Btn" onclick="setPeriod(120)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">120秒</button>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 密钥检查器模态框 -->
  <div id="keyCheckModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>✅ 密钥检查器</h2>
        <button class="close-btn" onclick="hideKeyCheckModal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title">密钥检查</div>
        <div class="input-area">
          <textarea
            id="keyCheckInput"
            placeholder="请输入要检查的密钥"
            rows="4"
            style="width: 100%; padding: 12px; border: 2px solid var(--border-primary); border-radius: 8px; font-size: 14px; font-family: monospace; resize: vertical; background: var(--input-bg); color: var(--text-primary);"
            autocomplete="off"
          ></textarea>
          <button class="btn btn-primary" onclick="checkSecret()" style="margin-top: 10px; padding: 10px 20px; font-size: 14px;">检查密钥</button>
        </div>
      </div>
      
      <div class="tool-section" id="keyCheckResult" style="display: none;">
        <div class="section-title">检查结果</div>
        <div id="checkResultContent" class="check-result" style="padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <!-- 结果内容将在这里动态生成 -->
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 二维码解析工具模态框 -->
  <div id="qrDecodeModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🔍 二维码解析</h2>
        <button class="close-btn" onclick="hideQRDecodeModal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="section-title">扫描二维码</div>
        <div class="scan-options" style="display: flex; gap: 10px; margin-bottom: 15px;">
          <button class="btn btn-primary" onclick="startQRDecodeScanner()" style="flex: 1; padding: 12px; font-size: 14px;">📷 摄像头扫描</button>
          <button class="btn btn-info" onclick="uploadImageForDecode()" style="flex: 1; padding: 12px; font-size: 14px;">📁 选择图片</button>
        </div>
        
        <div id="decodeScannerContainer" style="display: none;">
          <div class="scanner-container" style="position: relative; margin: 15px 0;">
            <div class="video-wrapper">
              <video id="decodeScannerVideo" autoplay playsinline muted></video>
              <div class="scanner-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none;">
                <div class="scanner-frame" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60%; height: 60%; border: 2px solid #fff; border-radius: 8px;"></div>
              </div>
            </div>
          </div>
          <div id="decodeScannerStatus" class="scanner-status" style="text-align: center; margin: 10px 0; font-size: 14px; color: var(--text-secondary);">正在启动摄像头...</div>
          <div id="decodeScannerError" class="scanner-error" style="display: none; text-align: center; margin: 10px 0; padding: 10px; background: var(--danger-light); border: 1px solid var(--border-error); border-radius: 6px; color: var(--danger-dark);">
            <div id="decodeErrorMessage"></div>
            <button class="btn btn-primary" onclick="retryDecodeCamera()" style="margin-top: 10px; padding: 8px 16px; font-size: 13px;">重试</button>
          </div>
        </div>
      </div>
      
      <div class="tool-section" id="decodeResultSection" style="display: none;">
        <div class="section-title">解析结果</div>
        <div class="decode-result" style="background: var(--bg-secondary); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <div class="result-content" id="decodeResultContent" style="font-family: monospace; font-size: 14px; word-break: break-all; line-height: 1.5; max-height: 200px; overflow-y: auto; color: var(--text-primary);"></div>
          <div class="result-actions" style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn btn-info" onclick="copyDecodeResult()" style="flex: 1; padding: 8px 16px; font-size: 13px;">复制内容</button>
            <button class="btn btn-primary" onclick="generateDecodeQRCode()" style="flex: 1; padding: 8px 16px; font-size: 13px;">生成二维码</button>
          </div>
        </div>
        <div class="qr-section" id="decodeQRSection" style="display: none; text-align: center;">
          <div class="qr-title" style="font-weight: 600; margin-bottom: 10px; color: var(--text-primary);">重新生成的二维码</div>
          <img id="decodeQRCode" class="qr-code" style="max-width: 200px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
          <div class="qr-tip" style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">点击二维码可以预览</div>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 密钥生成器模态框 -->
  <div id="keyGeneratorModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>🎲 密钥生成器</h2>
        <button class="close-btn" onclick="hideKeyGeneratorModal()">&times;</button>
      </div>
      
      <div class="tool-section">
        <div class="options" style="margin-bottom: 15px;">
          <div class="option-item" style="margin-bottom: 10px;">
            <div class="option-label" style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">密钥长度:</div>
            <div class="radio-group" style="display: flex; justify-content: space-between; gap: 10px;">
              <button class="btn btn-outline" id="length16Btn" onclick="setKeyLength(16)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">16位</button>
              <button class="btn btn-outline" id="length26Btn" onclick="setKeyLength(26)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">26位</button>
              <button class="btn btn-outline" id="length32Btn" onclick="setKeyLength(32)" style="padding: 8px 16px; font-size: 13px; border: 2px solid var(--border-primary); background: transparent; border-radius: 6px; color: var(--text-primary);">32位</button>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="generateKey()" style="width: 100%; padding: 12px; font-size: 14px;">生成密钥</button>
      </div>
      
      <div class="tool-section" id="keyResultSection" style="display: none;">
        <div class="section-title">生成结果</div>
        <div class="key-result" style="padding: 15px; border-radius: 8px; margin-bottom: 15px; background: var(--bg-secondary);">
          <div class="key-text" id="generatedKeyText" style="font-family: monospace; font-size: 16px; font-weight: 600; text-align: center; margin-bottom: 15px; word-break: break-all; color: var(--text-primary);"></div>
          <div class="key-actions" style="display: flex; justify-content: center;">
            <button class="btn btn-info" onclick="copyGeneratedKey()" style="padding: 8px 24px; font-size: 13px;">复制密钥</button>
          </div>
        </div>
      </div>
      

    </div>
  </div>
  
  <!-- 二维码模态框 -->
  <div id="qrModal" class="modal" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="qrTitle">二维码</h2>
        <button class="close-btn" onclick="hideQRModal()">&times;</button>
      </div>
      
      <div class="qr-subtitle-section">
        <p id="qrSubtitle">扫描此二维码导入到其他2FA应用</p>
      </div>
      
      <div class="qr-code-container">
        <!-- 二维码将在这里动态生成 -->
      </div>
      
      <div class="qr-info">
        💡 使用任意2FA应用扫描二维码即可添加此账户<br>
        支持：Google Authenticator、Microsoft Authenticator、Authy等
      </div>
    </div>
  </div>

      <!-- 中间提示组件 -->
  <div id="centerToast" class="center-toast">
    <div class="toast-content">
      <div class="toast-icon">✅</div>
      <div class="toast-message">验证码已复制到剪贴板</div>
    </div>
  </div>

  <!-- 导出格式选择模态框 -->
  <div id="exportFormatModal" class="modal">
    <div class="modal-content export-modal-compact">
      <div class="modal-header">
        <h2>选择导出格式</h2>
        <button class="close-btn" onclick="hideExportFormatModal()">&times;</button>
      </div>

      <div class="export-summary">
        <span class="export-count">共 <strong id="exportCount">0</strong> 个密钥</span>
        <div class="export-sort-wrapper">
          <span class="export-sort-label">导出顺序</span>
          <select id="exportSortOrder" class="export-sort-select">
            <option value="index-asc">最早添加</option>
            <option value="index-desc">最晚添加</option>
            <option value="name-asc">服务名称 A-Z</option>
            <option value="name-desc">服务名称 Z-A</option>
            <option value="account-asc">账户名称 A-Z</option>
            <option value="account-desc">账户名称 Z-A</option>
          </select>
        </div>
      </div>

      <!-- 通用格式 -->
      <div class="format-section">
        <div class="format-section-title">通用格式</div>
        <div class="format-grid">
          <div class="format-card" onclick="selectExportFormat('txt')">
            <span class="format-icon">🔓</span>
            <span class="format-name">OTPAuth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat">通用</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('json')">
            <span class="format-icon">🔓</span>
            <span class="format-name">JSON</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">通用</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('csv')">
            <span class="format-icon">🔓</span>
            <span class="format-name">CSV</span>
            <span class="format-ext">.csv</span>
            <span class="format-compat">Excel</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('html')">
            <span class="format-icon">🔓</span>
            <span class="format-name">HTML</span>
            <span class="format-ext">.html</span>
            <span class="format-compat">打印/扫码</span>
          </div>
        </div>
      </div>

      <!-- 验证器应用 -->
      <div class="format-section">
        <div class="format-section-title">验证器应用</div>
        <div class="format-grid">
          <div class="format-card" onclick="selectExportFormat('google')">
            <span class="format-icon">🔓</span>
            <span class="format-name">Google</span>
            <span class="format-ext">迁移</span>
            <span class="format-compat">iOS/Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('2fas')">
            <span class="format-icon">🔓</span>
            <span class="format-name">2FAS</span>
            <span class="format-ext">.2fas</span>
            <span class="format-compat">iOS/Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('aegis-multi')">
            <span class="format-icon">🛡️</span>
            <span class="format-name">Aegis</span>
            <span class="format-ext">⚙️ 多种格式</span>
            <span class="format-compat">Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('andotp')">
            <span class="format-icon">🔓</span>
            <span class="format-name">andOTP</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('authpro-multi')">
            <span class="format-icon">🛡️</span>
            <span class="format-name">Auth Pro</span>
            <span class="format-ext">⚙️ 多种格式</span>
            <span class="format-compat">全平台</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('bitwarden-auth-multi')">
            <span class="format-icon">🛡️</span>
            <span class="format-name">Bitwarden Auth</span>
            <span class="format-ext">⚙️ 多种格式</span>
            <span class="format-compat">全平台</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('ente-auth')">
            <span class="format-icon">🔓</span>
            <span class="format-name">Ente Auth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat">iOS/Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('freeotp')">
            <span class="format-icon">🔐</span>
            <span class="format-name">FreeOTP</span>
            <span class="format-ext">.xml</span>
            <span class="format-compat">Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('freeotp-plus-multi')">
            <span class="format-icon">🛡️</span>
            <span class="format-name">FreeOTP+</span>
            <span class="format-ext">⚙️ 多种格式</span>
            <span class="format-compat">Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('lastpass')">
            <span class="format-icon">🔓</span>
            <span class="format-name">LastPass</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">iOS/Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('proton')">
            <span class="format-icon">🔓</span>
            <span class="format-name">Proton</span>
            <span class="format-ext">.json</span>
            <span class="format-compat">iOS/Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('totp-auth')">
            <span class="format-icon">🔐</span>
            <span class="format-name">TOTP Auth</span>
            <span class="format-ext">.encrypt</span>
            <span class="format-compat">Android</span>
          </div>
          <div class="format-card" onclick="selectExportFormat('winauth')">
            <span class="format-icon">🔓</span>
            <span class="format-name">WinAuth</span>
            <span class="format-ext">.txt</span>
            <span class="format-compat">Windows</span>
          </div>
        </div>
      </div>

      <!-- 格式说明（可折叠） -->
      <details class="format-details">
        <summary>💡 查看格式说明与兼容性</summary>
        <div class="format-help-content">
          <p><strong>OTPAuth</strong> 标准 URI 格式 → Google/Microsoft/Authy/Aegis/2FAS/andOTP/FreeOTP/Ente Auth/WinAuth 等</p>
          <p><strong>JSON</strong> 结构化数据 → 本应用、程序处理</p>
          <p><strong>CSV</strong> 表格格式 → Excel/Numbers/Google Sheets、本应用</p>
          <p><strong>HTML</strong> 含二维码 → 浏览器查看、打印存档、扫码导入任意应用</p>
          <p><strong>Google</strong> 迁移二维码 → Google Authenticator、支持扫码的验证器</p>
          <p><strong>Aegis</strong> → Aegis Authenticator (Android)</p>
          <p><strong>2FAS</strong> → 2FAS (iOS/Android)</p>
          <p><strong>andOTP</strong> → andOTP (Android)、Aegis</p>
          <p><strong>FreeOTP</strong> 加密备份 → FreeOTP (Android)</p>
          <p><strong>FreeOTP+</strong> → FreeOTP+ (Android)</p>
          <p><strong>TOTP Auth</strong> 加密备份 → TOTP Authenticator (Android)</p>
          <p><strong>LastPass</strong> → LastPass Authenticator</p>
          <p><strong>Proton</strong> → Proton Authenticator</p>
          <p><strong>Auth Pro</strong> → Authenticator Pro (Stratum)</p>
          <p><strong>Bitwarden Auth</strong> → Bitwarden Authenticator</p>
          <p><strong>Ente Auth</strong> 标准 OTPAuth 格式 → Ente Auth (iOS/Android)</p>
          <p><strong>WinAuth</strong> 标准 OTPAuth 格式 → WinAuth (Windows)</p>
          <p><strong>Aegis TXT</strong> 标准 OTPAuth 格式 → Aegis Authenticator (Android)</p>
          <p><strong>Auth Pro TXT</strong> 标准 OTPAuth 格式 → Authenticator Pro (全平台)</p>
          <p><strong>FreeOTP TXT</strong> 标准 OTPAuth 格式 → FreeOTP/FreeOTP+ (Android)</p>
        </div>
      </details>
    </div>
  </div>

  <!-- 二级格式选择模态框 -->
  <div id="subFormatModal" class="modal">
    <div class="modal-content sub-format-modal">
      <div class="modal-header">
        <h2 id="subFormatTitle">选择导出格式</h2>
        <button class="close-btn" onclick="hideSubFormatModal()">&times;</button>
      </div>
      <div class="sub-format-list" id="subFormatList">
        <!-- 动态生成格式选项 -->
      </div>
    </div>
  </div>

  <!-- FreeOTP 原版导出密码模态框 -->
  <div id="freeotpExportModal" class="modal">
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h2>🔒 FreeOTP 加密导出</h2>
        <button class="close-btn" onclick="hideFreeOTPExportModal()">&times;</button>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px;">
        <p style="margin: 0 0 10px 0; color: var(--text-primary);">
          📱 <strong>导出 <span id="freeotpExportCount">0</span> 个密钥到 FreeOTP</strong>
        </p>
        <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">
          设置加密密码保护您的备份文件。<br>
          导入到 FreeOTP 时需要输入相同的密码。
        </p>
      </div>

      <div class="form-group">
        <label for="freeotpExportPassword">加密密码</label>
        <input type="password" id="freeotpExportPassword" class="form-control" placeholder="输入加密密码" autocomplete="new-password">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideFreeOTPExportModal()">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeFreeOTPExport()">🔐 加密导出</button>
      </div>
    </div>
  </div>

  <!-- TOTP Authenticator 导出密码模态框 -->
  <div id="totpAuthExportModal" class="modal">
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h2>⏱️ TOTP Authenticator 加密导出</h2>
        <button class="close-btn" onclick="hideTOTPAuthExportModal()">&times;</button>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px;">
        <p style="margin: 0 0 10px 0; color: var(--text-primary);">
          📱 <strong>导出 <span id="totpAuthExportCount">0</span> 个密钥到 TOTP Authenticator</strong>
        </p>
        <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">
          设置加密密码保护您的备份文件。<br>
          导入到 TOTP Authenticator 时需要输入相同的密码。
        </p>
      </div>

      <div class="form-group">
        <label for="totpAuthExportPassword">加密密码</label>
        <input type="password" id="totpAuthExportPassword" class="form-control" placeholder="输入加密密码" autocomplete="new-password">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="hideTOTPAuthExportModal()">取消</button>
        <button type="button" class="btn btn-primary" onclick="executeTOTPAuthExport()">🔐 加密导出</button>
      </div>
    </div>
  </div>

  <!-- 备份导出格式选择模态框 -->
  <div id="backupExportFormatModal" class="modal">
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-header">
        <h2>📤 选择备份导出格式</h2>
        <button class="close-btn" onclick="hideBackupExportFormatModal()">&times;</button>
      </div>

      <div class="export-instructions" style="margin-bottom: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px;">
        <p style="margin: 0; color: var(--text-primary);">
          💡 <strong>导出选中的备份文件</strong><br>
          <small style="color: var(--text-secondary);">请选择您需要的导出格式，不同格式适用于不同的场景</small>
        </p>
      </div>

      <div class="export-formats">
        <div class="format-option" onclick="selectBackupExportFormat('txt')" style="cursor: pointer; padding: 15px; margin-bottom: 12px; border: 2px solid var(--border-primary); border-radius: 8px; transition: all 0.2s; background: var(--bg-primary);" onmouseover="this.style.borderColor='#4CAF50'; this.style.background='var(--bg-hover)'" onmouseout="this.style.borderColor='var(--border-primary)'; this.style.background='var(--bg-primary)'">
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 32px;">📝</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px; color: var(--text-primary);">OTPAuth 文本格式</div>
              <div style="font-size: 13px; color: var(--text-secondary);">标准 otpauth:// URLs，兼容大多数2FA应用</div>
              <div style="font-size: 12px; color: var(--success); margin-top: 4px;">✓ Google Authenticator · Authy · Microsoft Authenticator</div>
            </div>
          </div>
        </div>

        <div class="format-option" onclick="selectBackupExportFormat('json')" style="cursor: pointer; padding: 15px; margin-bottom: 12px; border: 2px solid var(--border-primary); border-radius: 8px; transition: all 0.2s; background: var(--bg-primary);" onmouseover="this.style.borderColor='#4CAF50'; this.style.background='var(--bg-hover)'" onmouseout="this.style.borderColor='var(--border-primary)'; this.style.background='var(--bg-primary)'">
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 32px;">📋</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px; color: var(--text-primary);">JSON 数据格式</div>
              <div style="font-size: 13px; color: var(--text-secondary);">包含完整信息的结构化数据，适合程序处理</div>
              <div style="font-size: 12px; color: var(--info); margin-top: 4px;">✓ 完整数据 · 易于解析 · 支持元数据</div>
            </div>
          </div>
        </div>

        <div class="format-option" onclick="selectBackupExportFormat('csv')" style="cursor: pointer; padding: 15px; margin-bottom: 12px; border: 2px solid var(--border-primary); border-radius: 8px; transition: all 0.2s; background: var(--bg-primary);" onmouseover="this.style.borderColor='#4CAF50'; this.style.background='var(--bg-hover)'" onmouseout="this.style.borderColor='var(--border-primary)'; this.style.background='var(--bg-primary)'">
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 32px;">📊</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px; color: var(--text-primary);">CSV 表格格式</div>
              <div style="font-size: 13px; color: var(--text-secondary);">可用 Excel、Numbers 打开，方便查看和编辑</div>
              <div style="font-size: 12px; color: var(--warning); margin-top: 4px;">✓ Excel · Numbers · Google Sheets</div>
            </div>
          </div>
        </div>

        <div class="format-option" onclick="selectBackupExportFormat('html')" style="cursor: pointer; padding: 15px; margin-bottom: 12px; border: 2px solid var(--border-primary); border-radius: 8px; transition: all 0.2s; background: var(--bg-primary);" onmouseover="this.style.borderColor='#4CAF50'; this.style.background='var(--bg-hover)'" onmouseout="this.style.borderColor='var(--border-primary)'; this.style.background='var(--bg-primary)'">
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 32px;">🌐</div>
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px; color: var(--text-primary);">HTML 网页格式</div>
              <div style="font-size: 13px; color: var(--text-secondary);">包含二维码图片的独立网页，可直接打开查看</div>
              <div style="font-size: 12px; color: var(--danger); margin-top: 4px;">✓ 内嵌二维码 · 美观排版 · 可打印</div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-primary);">
        <button type="button" class="btn btn-secondary" onclick="hideBackupExportFormatModal()" style="padding: 12px 24px; font-size: 14px;">取消</button>
      </div>
    </div>
  </div>

  <!-- 登录模态框 -->
  <div id="loginModal" class="modal" style="display: none;">
    <div class="modal-content" style="max-width: 400px;">
      <h2 style="text-align: center; margin-bottom: 10px; color: var(--text-primary);">🔐 身份验证</h2>
      <p style="text-align: center; color: var(--text-secondary); margin-bottom: 20px; font-size: 14px;">
        请输入密码以管理密钥<br>
        <small style="color: var(--text-tertiary);">或点击"取消"使用 OTP 生成功能</small>
      </p>
      <div class="form-group">
        <label for="loginToken">密码</label>
        <input type="password" id="loginToken" placeholder="请输入您的密码" autocomplete="current-password" name="password">
        <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 5px;">
          提示：输入您设置的密码
        </div>
      </div>
      <div class="button-group" style="margin-top: 20px; display: flex; gap: 10px;">
        <button onclick="window.location.href='/otp'" class="btn-secondary" style="flex: 1; padding: 14px 28px; font-size: 16px; font-weight: 600;">
          取消
        </button>
        <button onclick="handleLoginSubmit()" class="btn-primary" style="flex: 1; padding: 14px 28px; font-size: 16px; font-weight: 600;">
          登录
        </button>
      </div>
      <div id="loginError" style="display: none; margin-top: 15px; padding: 10px; background: var(--danger-light); border-radius: 8px; color: var(--danger-dark); font-size: 14px; text-align: center;"></div>
    </div>
  </div>

  <!-- 页面底部链接 -->
  <footer class="page-footer">
    <div class="footer-content">
      <div class="footer-links">
        <a href="https://github.com/wuzf/2fa" target="_blank" rel="noopener noreferrer" class="footer-link">
          <svg class="github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
          GitHub
        </a>
        <span class="footer-separator">•</span>
        <a href="https://github.com/wuzf/2fa/issues" target="_blank" rel="noopener noreferrer" class="footer-link">
          反馈问题
        </a>
        <span class="footer-separator">•</span>
        <a href="https://github.com/wuzf/2fa/blob/main/README.md" target="_blank" rel="noopener noreferrer" class="footer-link">
          使用文档
        </a>
      </div>
      <div class="footer-info">
        Made with ❤️ by <a href="https://github.com/wuzf" target="_blank" rel="noopener noreferrer" class="footer-link">wuzf</a>
      </div>
    </div>
  </footer>

  <!-- 固定悬浮按钮组 -->
  <!-- 操作菜单按钮 -->
  <div class="action-menu-float">
    <button class="main-action-button" id="mainActionBtn" onclick="toggleActionMenu()" title="操作菜单">
      ➕
    </button>

    <div class="action-submenu" id="actionSubmenu">
      <div class="submenu-item" onclick="showQRScanner(); closeActionMenu();">
        <span class="item-icon">📷</span>
        <span class="item-text">扫二维码</span>
      </div>
      <div class="submenu-item" onclick="showAddModal(); closeActionMenu();">
        <span class="item-icon">➕</span>
        <span class="item-text">手动添加</span>
      </div>
      <div class="submenu-item" onclick="showImportModal(); closeActionMenu();">
        <span class="item-icon">📥</span>
        <span class="item-text">批量导入</span>
      </div>
      <div class="submenu-item" onclick="exportAllSecrets(); closeActionMenu();">
        <span class="item-icon">📤</span>
        <span class="item-text">批量导出</span>
      </div>
      <div class="submenu-item" onclick="showRestoreModal(); closeActionMenu();">
        <span class="item-icon">🔄</span>
        <span class="item-text">还原配置</span>
      </div>
      <div class="submenu-item" onclick="showToolsModal(); closeActionMenu();">
        <span class="item-icon">🔧</span>
        <span class="item-text">实用工具</span>
      </div>
    </div>
  </div>

  <!-- 回到顶部按钮 -->
  <button class="back-to-top" id="backToTop" onclick="scrollToTop()" title="回到顶部" aria-label="回到顶部" type="button" style="display: none;">
    <span class="back-to-top-icon" aria-hidden="true">↑</span>
  </button>

  <!-- 主题切换按钮 -->
  <button class="theme-toggle-float" onclick="toggleTheme()" title="当前：跟随系统（点击切换）" aria-label="切换主题" type="button">
    <span class="theme-icon" id="theme-icon" aria-hidden="true">🌓</span>
  </button>

`;
}

/**
 * JavaScript脚本部分 - 引用外部脚本文件
 * @param {boolean} lazyLoad - 是否启用懒加载模式
 */
function getHTMLScripts(lazyLoad = true) {
	const scriptContent = getInlineScripts(lazyLoad);
	// 🔄 使用 CDN 作为主要来源（Service Worker 会自动缓存）
	// jsQR 用于二维码扫描，qrcode-generator 用于二维码生成
	return (
		'<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js" crossorigin="anonymous"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js" crossorigin="anonymous"></script>\n<script>\n' +
		scriptContent +
		'\n</script>'
	);
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
