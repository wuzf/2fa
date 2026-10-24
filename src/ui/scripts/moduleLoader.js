/**
 * 模块懒加载器
 * 实现按需加载大型功能模块，优化首次加载性能
 *
 * 可延迟加载的模块：
 * - import 模块（src/ui/scripts/import/index.js 入口）- 导入功能
 * - export.js - 导出功能
 * - backup.js - 备份管理
 * - qrcode.js - 二维码生成
 * - tools.js + 工具模块 - 工具集
 */

/**
 * 获取模块加载器代码
 * @returns {string} JavaScript 代码
 */
export function getModuleLoaderCode() {
	return `
    // ========== 模块懒加载系统 ==========

    function showModuleBuildUpdate() {
      if (document.getElementById('moduleBuildUpdate')) return;
      const banner = document.createElement('div');
      banner.id = 'moduleBuildUpdate';
      banner.className = 'offline-banner show';
      banner.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.textContent = t('moduleBuildChanged');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.textContent = t('restoreRefresh');
      button.onclick = async () => {
        if (typeof requestThemeRuntimeReload === 'function') return requestThemeRuntimeReload('update');
        if (typeof window.__2FA_REFRESH_BLOCKED__ === 'function' && window.__2FA_REFRESH_BLOCKED__()) {
          showCenterToast('⚠️', t('moduleRefreshBlocked'));
          return;
        }
        window.location.reload();
      };
      banner.append(text, button);
      document.body.prepend(banner);
      window.dispatchEvent(new CustomEvent('module-build-mismatch'));
    }

    // 模块加载状态
    let loadingModuleName = null;
    const moduleLoadState = {
      appearance: { loaded: false, loading: false, code: null },
      import: { loaded: false, loading: false, code: null },
      export: { loaded: false, loading: false, code: null },
      backup: { loaded: false, loading: false, code: null },
      qrcode: { loaded: false, loading: false, code: null },
      tools: { loaded: false, loading: false, code: null },
      googleMigration: { loaded: false, loading: false, code: null }
    };

    // One deadline covers both response headers and the entire body. The
    // losing read is side-effect free even when an underlying fetch ignores
    // abort, so it can never inject code or reset a later retry's state.
    async function readHostModuleCode(moduleName, buildId, isCurrent) {
      const controller = new AbortController();
      let expired = false;
      let timer;
      const assertCurrent = () => {
        if (expired) throw new Error(t('moduleLoadTimeout', {module:getModuleDisplayName(moduleName)}));
        if (!isCurrent()) throw new Error('Host module request expired');
      };
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(t('moduleLoadTimeout', {module:getModuleDisplayName(moduleName)})));
          controller.abort();
        }, 15000);
      });
      try {
        const reading = (async () => {
          assertCurrent();
          const response = await authenticatedFetch(\`/modules/\${moduleName}.js?build=\${encodeURIComponent(buildId)}\`, {signal:controller.signal});
          assertCurrent();
          if (response.status === 409 || (response.ok && buildId && response.headers.get('X-2FA-Build') !== buildId)) {
            showModuleBuildUpdate();
            throw new Error(t('moduleBuildChanged'));
          }
          if (!response.ok) throw new Error(t('moduleHttpError', {status:response.status}));
          const code = await response.text();
          assertCurrent();
          return code;
        })();
        return await Promise.race([reading, deadline]);
      } finally {
        expired = true;
        clearTimeout(timer);
        controller.abort();
      }
    }

    /**
     * 加载模块
     * @param {string} moduleName - 模块名称
     * @returns {Promise<void>}
     */
    function loadModule(moduleName) {
      const state = moduleLoadState[moduleName];
      if (!state) return Promise.reject(new Error('Unknown host module'));
      if (state.loaded) return Promise.resolve();
      if (state.promise) return state.promise;
      const session = typeof accountStore !== 'undefined' ? accountStore.getSessionGeneration() : null;
      const mountGuard = typeof window.__2FA_APP_MODULE_GUARD__ === 'function' ? window.__2FA_APP_MODULE_GUARD__() : () => true;
      const isCurrent = () => mountGuard() && (session === null || accountStore.isSessionCurrent(session));
      const task = (async () => {
      // 开始加载
      moduleLoadState[moduleName].loading = true;
      console.log(\`📦 开始加载模块: \${moduleName}\`);

      try {
        // 显示加载提示
        loadingModuleName = moduleName;
        showLoadingToast(t('moduleLoading', { module: getModuleDisplayName(moduleName) }));

        if (!isCurrent()) throw new Error('Host module request expired');
        // 从服务器获取模块代码
        const buildId = window.__2FA_BUILD_ID__ || '';
        const code = await readHostModuleCode(moduleName, buildId, isCurrent);
        if (!isCurrent()) throw new Error('Host module request expired');

        // 执行模块代码（注入到全局作用域）
        const script = document.createElement('script');
        script.textContent = code;
        document.head.appendChild(script);

        // 标记为已加载
        moduleLoadState[moduleName].loaded = true;
        moduleLoadState[moduleName].code = code;

        console.log(\`✅ 模块 \${moduleName} 加载成功\`);
        hideLoadingToast();

      } catch (error) {
        console.error(\`❌ 加载模块 \${moduleName} 失败:\`, error);
        moduleLoadState[moduleName].loading = false;
        hideLoadingToast();
        showCenterToast('❌', t('moduleLoadFailed', { error: error.message }));
        throw error;
      } finally {
        moduleLoadState[moduleName].loading = false;
      }
      })();
      state.promise = task.finally(() => { state.promise = null; });
      return state.promise;
    }

    /**
     * 获取模块显示名称
     * @param {string} moduleName - 模块名称
     * @returns {string} 显示名称
     */
    function getModuleDisplayName(moduleName) {
      const displayNames = {
        appearance: 'appearanceTitle',
        import: 'moduleImport',
        export: 'moduleExport',
        backup: 'moduleBackup',
        qrcode: 'moduleQRCode',
        tools: 'moduleTools',
        googleMigration: 'moduleGoogleMigration'
      };
      return displayNames[moduleName] ? t(displayNames[moduleName]) : moduleName;
    }

    /**
     * 显示加载Toast
     * @param {string} message - 提示消息
     */
    function showLoadingToast(message) {
      let toast = document.getElementById('loadingToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'loadingToast';
        toast.className = 'dialog-toast';
        toast.setAttribute('role', 'status');
        const spinner = document.createElement('div');
        spinner.className = 'dialog-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        toast.appendChild(spinner);

        const text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(text);

        document.body.appendChild(toast);
      } else {
        toast.querySelector('span').textContent = message;
        toast.style.display = 'flex';
      }
    }

    /**
     * 隐藏加载Toast
     */
    function refreshModuleLoaderLanguage() {
      if (loadingModuleName) showLoadingToast(t('moduleLoading', { module: getModuleDisplayName(loadingModuleName) }));
    }

    function hideLoadingToast() {
      loadingModuleName = null;
      const toast = document.getElementById('loadingToast');
      if (toast) {
        toast.style.display = 'none';
      }
    }

    // ========== 懒加载包装函数 ==========

    /**
     * 创建懒加载包装函数
     * @param {string} moduleName - 模块名称
     * @param {string} functionName - 函数名称
     * @param {boolean} returnsValue - 是否返回值
     * @returns {Function} 包装后的函数
     */
    function createLazyWrapper(moduleName, functionName, returnsValue = false) {
      // 创建包装函数
      const wrapper = async function(...args) {
        try {
          // 首次调用时加载模块
          await loadModule(moduleName);

          // 检查函数是否已加载
          if (typeof window[functionName] === 'function' && window[functionName] !== wrapper) {
            // 调用实际的函数
            const result = window[functionName](...args);
            if (returnsValue) {
              return result;
            }
          } else {
            throw new Error(t('moduleFunctionMissing', { module: getModuleDisplayName(moduleName) }));
          }
        } catch (error) {
          console.error(\`调用 \${functionName} 失败:\`, error);
          showCenterToast('❌', t('moduleLoadFailed', { error: error.message }));
        }
      };

      return wrapper;
    }

    // 导入功能懒加载
    window.showImportModal = createLazyWrapper('import', 'showImportModal');
    window.hideImportModal = createLazyWrapper('import', 'hideImportModal');
    window.handleImportFile = createLazyWrapper('import', 'handleImportFile');
    window.autoPreviewImport = createLazyWrapper('import', 'autoPreviewImport');
    window.previewImport = createLazyWrapper('import', 'previewImport');
    window.executeImport = createLazyWrapper('import', 'executeImport');

    // 导出功能懒加载
    window.exportAllSecrets = createLazyWrapper('export', 'exportAllSecrets');
    window.selectExportFormat = createLazyWrapper('export', 'selectExportFormat');
    window.showExportFormatModal = createLazyWrapper('export', 'showExportFormatModal');
    window.hideExportFormatModal = createLazyWrapper('export', 'hideExportFormatModal');

    // 备份管理懒加载
    window.createBackupNow = createLazyWrapper('backup', 'createBackupNow');
    window.loadBackupList = createLazyWrapper('backup', 'loadBackupList');
    window.loadMoreBackupList = createLazyWrapper('backup', 'loadMoreBackupList');
    window.showRestoreModal = createLazyWrapper('backup', 'showRestoreModal');
    window.hideRestoreModal = createLazyWrapper('backup', 'hideRestoreModal');
    window.selectBackupFromDropdown = createLazyWrapper('backup', 'selectBackupFromDropdown');
    window.exportSelectedBackup = createLazyWrapper('backup', 'exportSelectedBackup');
    window.selectBackupExportFormat = createLazyWrapper('backup', 'selectBackupExportFormat');
    window.showBackupExportFormatModal = createLazyWrapper('backup', 'showBackupExportFormatModal');
    window.hideBackupExportFormatModal = createLazyWrapper('backup', 'hideBackupExportFormatModal');

    // 工具集懒加载
    // 注意：showToolsModal 和 hideToolsModal 在 ui.js 核心模块中，不需要懒加载
    // 只有具体的工具函数需要懒加载
    window.showQRScanAndDecode = createLazyWrapper('tools', 'showQRScanAndDecode');
    window.showQRGenerateTool = createLazyWrapper('tools', 'showQRGenerateTool');
    window.showBase32Tool = createLazyWrapper('tools', 'showBase32Tool');
    window.showTimestampTool = createLazyWrapper('tools', 'showTimestampTool');
    window.showKeyCheckTool = createLazyWrapper('tools', 'showKeyCheckTool');
    window.showKeyGeneratorTool = createLazyWrapper('tools', 'showKeyGeneratorTool');
    window.showWebdavTool = createLazyWrapper('tools', 'showWebdavTool');
    window.showS3Tool = createLazyWrapper('tools', 'showS3Tool');
    window.showOneDriveTool = createLazyWrapper('tools', 'showOneDriveTool');
    window.showGoogleDriveTool = createLazyWrapper('tools', 'showGoogleDriveTool');
    window.showWebdavModal = createLazyWrapper('tools', 'showWebdavModal');
    window.showS3Modal = createLazyWrapper('tools', 'showS3Modal');
    window.showOneDriveModal = createLazyWrapper('tools', 'showOneDriveModal');
    window.showGoogleDriveModal = createLazyWrapper('tools', 'showGoogleDriveModal');

    // 二维码功能懒加载
    window.showSecretQRCode = createLazyWrapper('qrcode', 'showSecretQRCode');
    window.showQRScanner = createLazyWrapper('qrcode', 'showQRScanner');
    window.hideQRScanner = createLazyWrapper('qrcode', 'hideQRScanner');
    window.stopQRScanner = createLazyWrapper('qrcode', 'stopQRScanner');
    window.showQRCode = createLazyWrapper('qrcode', 'showQRCode');

    // Google 迁移功能懒加载
    window.processGoogleMigration = createLazyWrapper('googleMigration', 'processGoogleMigration');
    window.showExportToGoogleModal = createLazyWrapper('googleMigration', 'showExportToGoogleModal');
    window.closeExportToGoogleModal = createLazyWrapper('googleMigration', 'closeExportToGoogleModal');
    window.selectAllExportSecrets = createLazyWrapper('googleMigration', 'selectAllExportSecrets');
    window.generateExportQRCodes = createLazyWrapper('googleMigration', 'generateExportQRCodes');
    window.showExportQRCodePage = createLazyWrapper('googleMigration', 'showExportQRCodePage');
    window.closeExportQRCodeModal = createLazyWrapper('googleMigration', 'closeExportQRCodeModal');
    window.showGoogleMigrationPreview = createLazyWrapper('googleMigration', 'showGoogleMigrationPreview');
    window.closeMigrationPreview = createLazyWrapper('googleMigration', 'closeMigrationPreview');
    window.confirmGoogleMigration = createLazyWrapper('googleMigration', 'confirmGoogleMigration');
    window.showImportResultModal = createLazyWrapper('googleMigration', 'showImportResultModal');
    window.closeImportResultModal = createLazyWrapper('googleMigration', 'closeImportResultModal');

    console.log('📦 模块懒加载系统已初始化');
  `;
}
