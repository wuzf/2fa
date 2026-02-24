/**
 * 模块懒加载器
 * 实现按需加载大型功能模块，优化首次加载性能
 *
 * 可延迟加载的模块：
 * - import.js (34KB/896行) - 导入功能
 * - export.js (16KB/375行) - 导出功能
 * - backup.js (355行) - 备份管理
 * - qrcode.js (29KB/786行) - 二维码生成
 * - tools.js + 工具模块 - 工具集
 */

/**
 * 获取模块加载器代码
 * @returns {string} JavaScript 代码
 */
export function getModuleLoaderCode() {
	return `
    // ========== 模块懒加载系统 ==========

    // 模块加载状态
    const moduleLoadState = {
      import: { loaded: false, loading: false, code: null },
      export: { loaded: false, loading: false, code: null },
      backup: { loaded: false, loading: false, code: null },
      qrcode: { loaded: false, loading: false, code: null },
      tools: { loaded: false, loading: false, code: null },
      googleMigration: { loaded: false, loading: false, code: null }
    };

    /**
     * 加载模块
     * @param {string} moduleName - 模块名称
     * @returns {Promise<void>}
     */
    async function loadModule(moduleName) {
      // 如果已加载，直接返回
      if (moduleLoadState[moduleName].loaded) {
        console.log(\`✅ 模块 \${moduleName} 已加载\`);
        return;
      }

      // 如果正在加载，等待加载完成
      if (moduleLoadState[moduleName].loading) {
        console.log(\`⏳ 模块 \${moduleName} 正在加载中...\`);
        // 轮询等待加载完成（最多5秒）
        const startTime = Date.now();
        while (moduleLoadState[moduleName].loading && Date.now() - startTime < 5000) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (moduleLoadState[moduleName].loaded) {
          return;
        } else {
          throw new Error(\`模块 \${moduleName} 加载超时\`);
        }
      }

      // 开始加载
      moduleLoadState[moduleName].loading = true;
      console.log(\`📦 开始加载模块: \${moduleName}\`);

      try {
        // 显示加载提示
        showLoadingToast(\`正在加载 \${getModuleDisplayName(moduleName)}...\`);

        // 从服务器获取模块代码
        const response = await authenticatedFetch(\`/modules/\${moduleName}.js\`);

        if (!response.ok) {
          throw new Error(\`加载模块失败: \${response.statusText}\`);
        }

        const code = await response.text();

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
        showCenterToast(\`加载功能失败: \${error.message}\`, 'error');
        throw error;
      } finally {
        moduleLoadState[moduleName].loading = false;
      }
    }

    /**
     * 获取模块显示名称
     * @param {string} moduleName - 模块名称
     * @returns {string} 显示名称
     */
    function getModuleDisplayName(moduleName) {
      const displayNames = {
        import: '导入功能',
        export: '导出功能',
        backup: '备份管理',
        qrcode: '二维码功能',
        tools: '工具集',
        googleMigration: 'Google迁移'
      };
      return displayNames[moduleName] || moduleName;
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
        toast.style.cssText = \`
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #2196F3;
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          z-index: 10001;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        \`;

        const spinner = document.createElement('div');
        spinner.style.cssText = \`
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        \`;
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
    function hideLoadingToast() {
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
            throw new Error(\`函数 \${functionName} 在模块 \${moduleName} 中未找到\`);
          }
        } catch (error) {
          console.error(\`调用 \${functionName} 失败:\`, error);
          showCenterToast(\`功能加载失败: \${error.message}\`, 'error');
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
    window.loadBackupList = createLazyWrapper('backup', 'loadBackupList');
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
