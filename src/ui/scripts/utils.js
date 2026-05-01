/**
 * Utils 工具函数模块
 * 包含各种通用实用函数
 */

/**
 * 获取 Utils 相关代码
 * @returns {string} Utils JavaScript 代码
 */
export function getUtilsCode() {
	return `    // ========== 工具函数模块 ==========

    // ==================== 模态框通用函数 ====================

    /**
     * 通用显示模态框函数
     * @param {string} modalId - 模态框的DOM ID
     * @param {Function} onShow - 显示后的回调函数（可选）
     */
    function showModal(modalId, onShow) {
      const modal = document.getElementById(modalId);
      if (!modal) {
        console.error('模态框不存在:', modalId);
        return;
      }
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);
      disableBodyScroll();
      if (typeof onShow === 'function') {
        onShow();
      }
    }

    /**
     * 通用隐藏模态框函数
     * @param {string} modalId - 模态框的DOM ID
     * @param {Function} onHide - 隐藏后的回调函数（可选）
     */
    function hideModal(modalId, onHide) {
      const modal = document.getElementById(modalId);
      if (!modal) {
        console.error('模态框不存在:', modalId);
        return;
      }
      // 幂等守卫：未显示的 modal 不做任何事，避免 body 锁计数被错误减少
      if (!modal.classList.contains('show')) {
        return;
      }
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
        if (typeof onHide === 'function') {
          onHide();
        }
      }, 300);
      enableBodyScroll();
    }

    // ==================== 自定义确认对话框 ====================

    /**
     * 自定义确认对话框（替换原生 confirm）。
     * @param {Object} options
     * @param {string} options.title - 标题
     * @param {string} options.message - 描述，支持 \\n 换行
     * @param {string} [options.confirmText='确认'] - 确认按钮文字
     * @param {string} [options.cancelText='取消'] - 取消按钮文字
     * @param {boolean} [options.danger=false] - 危险操作时确认按钮显示为红色
     * @returns {Promise<boolean>} 用户点击确认返回 true，取消/关闭返回 false
     */
    /**
     * 并发保护：确认框共用同一个 DOM 节点，必须禁止同时被多个调用打开，
     * 否则会重复绑定监听、一次点击触发多个 resolve，调用侧(删除/还原)可能重复提交请求。
     */
    let __confirmDialogBusy = false;

    function showConfirmDialog(options) {
      const opts = options || {};
      const title = opts.title || '确认操作';
      const message = opts.message || '';
      const confirmText = opts.confirmText || '确认';
      const cancelText = opts.cancelText || '取消';
      const danger = opts.danger === true;

      // 若已有确认框在等待用户操作，直接以 "取消" 语义返回，避免监听器叠加
      if (__confirmDialogBusy) {
        return Promise.resolve(false);
      }
      __confirmDialogBusy = true;

      return new Promise((resolve) => {
        // 懒创建 DOM，后续复用同一节点
        let modal = document.getElementById('confirmDialogModal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'confirmDialogModal';
          modal.className = 'modal fab-modal-sm confirm-dialog-modal';
          modal.setAttribute('role', 'dialog');
          modal.setAttribute('aria-modal', 'true');
          modal.setAttribute('aria-labelledby', 'confirmDialogTitle');
          modal.setAttribute('aria-describedby', 'confirmDialogMessage');
          modal.setAttribute('tabindex', '-1');
          modal.innerHTML =
            '<div class="modal-content confirm-dialog-content">' +
            '  <div class="confirm-dialog-header">' +
            '    <div class="confirm-dialog-icon" id="confirmDialogIcon" aria-hidden="true"></div>' +
            '    <h3 class="confirm-dialog-title" id="confirmDialogTitle"></h3>' +
            '  </div>' +
            '  <div class="confirm-dialog-message" id="confirmDialogMessage"></div>' +
            '  <div class="confirm-dialog-actions">' +
            '    <button type="button" class="btn btn-secondary confirm-dialog-cancel" id="confirmDialogCancel"></button>' +
            '    <button type="button" class="btn btn-primary confirm-dialog-confirm" id="confirmDialogConfirm"></button>' +
            '  </div>' +
            '</div>';
          document.body.appendChild(modal);
        }

        const titleEl = modal.querySelector('#confirmDialogTitle');
        const messageEl = modal.querySelector('#confirmDialogMessage');
        const iconEl = modal.querySelector('#confirmDialogIcon');
        const cancelBtn = modal.querySelector('#confirmDialogCancel');
        const confirmBtn = modal.querySelector('#confirmDialogConfirm');

        titleEl.textContent = title;
        // 支持多行：将 \\n 渲染为换行
        messageEl.innerHTML = '';
        String(message).split('\\n').forEach((line, idx) => {
          if (idx > 0) messageEl.appendChild(document.createElement('br'));
          messageEl.appendChild(document.createTextNode(line));
        });
        iconEl.textContent = danger ? '⚠️' : '❓';
        cancelBtn.textContent = cancelText;
        confirmBtn.textContent = confirmText;
        confirmBtn.classList.toggle('btn-danger', danger);
        modal.setAttribute('aria-labelledby', 'confirmDialogTitle');
        modal.setAttribute('aria-describedby', 'confirmDialogMessage');

        // 焦点策略：危险操作停在取消避免误触；非危险默认确认
        const focusTarget = danger ? cancelBtn : confirmBtn;
        // 保存打开前的焦点，关闭后恢复
        const previouslyFocused =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;

        let settled = false;
        function cleanup(result) {
          if (settled) return;
          settled = true;
          modal.classList.remove('show');
          document.removeEventListener('keydown', onKey);
          cancelBtn.removeEventListener('click', onCancel);
          confirmBtn.removeEventListener('click', onConfirm);
          modal.removeEventListener('click', onOverlay);
          setTimeout(() => {
            modal.style.display = 'none';
            enableBodyScroll();
            // 恢复打开前的焦点（若目标仍在 DOM 内）
            if (previouslyFocused && document.contains(previouslyFocused)) {
              try { previouslyFocused.focus(); } catch (_) { /* noop */ }
            }
            __confirmDialogBusy = false;
            resolve(result);
          }, 200);
        }
        function onCancel() { cleanup(false); }
        function onConfirm() { cleanup(true); }
        function onOverlay(e) { if (e.target === modal) cleanup(false); }
        function onKey(e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            cleanup(false);
            return;
          }
          if (e.key === 'Enter' && !danger) {
            const tag = (e.target && e.target.tagName) || '';
            // Enter 在文本域/按钮内的默认行为优先
            if (tag !== 'BUTTON') {
              e.preventDefault();
              cleanup(true);
              return;
            }
          }
          // 焦点陷阱：Tab 在确认/取消两个按钮之间循环
          if (e.key === 'Tab') {
            const focusable = [cancelBtn, confirmBtn];
            const idx = focusable.indexOf(document.activeElement);
            if (idx === -1) {
              e.preventDefault();
              focusTarget.focus();
              return;
            }
            const next = e.shiftKey
              ? (idx === 0 ? focusable.length - 1 : idx - 1)
              : (idx === focusable.length - 1 ? 0 : idx + 1);
            e.preventDefault();
            focusable[next].focus();
          }
        }

        cancelBtn.addEventListener('click', onCancel);
        confirmBtn.addEventListener('click', onConfirm);
        modal.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);

        disableBodyScroll();
        modal.style.display = 'flex';
        setTimeout(() => {
          modal.classList.add('show');
          try { focusTarget.focus(); } catch (_) { /* noop */ }
        }, 10);
      });
    }

    // ==================== 滚动控制函数 ====================

    /**
     * 模态框栈计数：支持多层弹窗叠加时只在最外层关闭时解锁 body 滚动。
     * 避免嵌套场景（如在 restoreModal 上打开 confirmDialog）提前解锁父级背景。
     */
    let __modalLockCount = 0;

    /**
     * 禁用页面滚动（显示模态框时使用）
     * 内部使用引用计数，可重入调用。
     */
    function disableBodyScroll() {
      if (__modalLockCount === 0) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
      }
      __modalLockCount++;
    }

    /**
     * 启用页面滚动（隐藏模态框时使用）
     * 内部使用引用计数，仅当所有叠加的模态都关闭后才真正解锁。
     */
    function enableBodyScroll() {
      if (__modalLockCount <= 0) {
        __modalLockCount = 0;
        return;
      }
      __modalLockCount--;
      if (__modalLockCount === 0) {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
      }
    }

    // ==================== 数据处理函数 ====================

    /**
     * 转义HTML内容，防止XSS攻击
     * @param {string} str - 要转义的字符串
     * @returns {string} 转义后的字符串
     */
    function escapeHTML(str) {
      if (typeof str !== 'string') return str;
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    /**
     * 转义CSV内容
     * @param {string} str - 要转义的字符串
     * @returns {string} 转义后的字符串
     */
    function escapeCSV(str) {
      if (typeof str !== 'string') return str;
      // 如果包含逗号、引号或换行符，则需要转义
      if (str.includes(',') || str.includes('"') || str.includes('\\n') || str.includes('\\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    /**
     * 获取日期字符串 (YYYY-MM-DD)
     * @returns {string} 日期字符串
     */
    function getDateString() {
      return new Date().toISOString().split('T')[0];
    }

    const DEFAULT_EXPORT_FORMAT_OPTIONS = ['txt', 'json', 'csv', 'html'];
    let defaultExportFormatRequest = null;

    function normalizeDefaultExportFormat(format) {
      const normalized = String(format || '').trim().toLowerCase();
      return DEFAULT_EXPORT_FORMAT_OPTIONS.includes(normalized) ? normalized : 'json';
    }

    function getCachedDefaultExportFormat() {
      try {
        return normalizeDefaultExportFormat(localStorage.getItem('defaultExportFormat') || 'json');
      } catch {
        return 'json';
      }
    }

    function cacheDefaultExportFormat(format) {
      const normalized = normalizeDefaultExportFormat(format);
      try {
        localStorage.setItem('defaultExportFormat', normalized);
      } catch {
        // ignore localStorage failures
      }
      return normalized;
    }

    async function getServerDefaultExportFormat(options = {}) {
      const forceRefresh = options.forceRefresh === true;
      if (!forceRefresh && defaultExportFormatRequest) {
        return defaultExportFormatRequest;
      }

      const requestPromise = (async () => {
        const fallbackFormat = getCachedDefaultExportFormat();
        if (typeof authenticatedFetch !== 'function') {
          return fallbackFormat;
        }

        try {
          const response = await authenticatedFetch('/api/settings');
          if (!response.ok) {
            return fallbackFormat;
          }

          const data = await response.json();
          return cacheDefaultExportFormat(data.defaultExportFormat);
        } catch {
          return fallbackFormat;
        }
      })();

      defaultExportFormatRequest = requestPromise;

      try {
        return await requestPromise;
      } finally {
        if (defaultExportFormatRequest === requestPromise) {
          defaultExportFormatRequest = null;
        }
      }
    }

    /**
     * 下载文件到本地
     * @param {string} content - 文件内容
     * @param {string} filename - 文件名
     * @param {string} mimeType - MIME类型
     * @returns {Promise<boolean>} 是否成功保存（使用现代API时）
     */
    async function downloadFile(content, filename, mimeType) {
      // 尝试使用 File System Access API（现代浏览器支持）
      if (window.showSaveFilePicker) {
        try {
          // 根据文件扩展名确定文件类型
          const ext = filename.split('.').pop().toLowerCase();
          const types = [];

          if (ext === 'json' || ext === '2fas') {
            types.push({
              description: 'JSON 文件',
              accept: { 'application/json': ['.json', '.2fas'] }
            });
          } else if (ext === 'csv') {
            types.push({
              description: 'CSV 文件',
              accept: { 'text/csv': ['.csv'] }
            });
          } else if (ext === 'html' || ext === 'htm') {
            types.push({
              description: 'HTML 文件',
              accept: { 'text/html': ['.html', '.htm'] }
            });
          } else if (ext === 'txt') {
            types.push({
              description: '文本文件',
              accept: { 'text/plain': ['.txt'] }
            });
          } else if (ext === 'xml') {
            types.push({
              description: 'XML 文件',
              accept: { 'application/xml': ['.xml'] }
            });
          }

          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: types.length > 0 ? types : undefined
          });

          const writable = await handle.createWritable();

          // 根据内容类型写入
          if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
            await writable.write(content);
          } else {
            await writable.write(new Blob([content], { type: mimeType }));
          }

          await writable.close();
          return true; // 成功保存
        } catch (err) {
          // 用户取消选择或其他错误
          if (err.name === 'AbortError') {
            return false; // 用户取消
          }
          console.warn('File System Access API 失败，使用传统方式:', err);
          // 降级到传统方式
        }
      }

      // 传统方式（无法确认是否真正保存）
      const blob = content instanceof Blob
        ? content
        : new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true; // 传统方式假定成功
    }

    // ==================== Base32验证 ====================

    /**
     * 验证Base32格式
     * @param {string} str - 要验证的字符串
     * @returns {boolean} 是否为有效的Base32
     */
    function validateBase32(str) {
      if (!str || typeof str !== 'string') return false;

      // 移除空格和转换为大写
      const cleaned = str.replace(/\s/g, '').toUpperCase();

      // Base32字符集：A-Z, 2-7
      const base32Regex = /^[A-Z2-7]+=*$/;

      // 检查格式
      if (!base32Regex.test(cleaned)) return false;

      // 检查长度（应该是8的倍数，或者加上适当的填充）
      const withoutPadding = cleaned.replace(/=+$/, '');
      return withoutPadding.length > 0;
    }

    // ==================== QR码生成核心函数 ====================

    /**
     * 客户端生成二维码（隐私安全，不经过服务器）
     * @param {string} text - 要编码的文本
     * @param {Object} options - 生成选项
     * @returns {Promise<string>} 返回Data URL格式的QR码图片
     */
    async function generateQRCodeDataURL(text, options = {}) {
      const { width = 200, height = 200 } = options;

      try {
        // 检查qrcode库是否已加载
        if (typeof qrcode === 'undefined') {
          throw new Error('QR码生成库未加载');
        }

        // 使用qrcode-generator库在客户端生成QR码
        // 参数：typeNumber(0=自动), errorCorrectionLevel('L','M','Q','H')
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();

        // 获取QR码矩阵尺寸
        const moduleCount = qr.getModuleCount();
        const margin = 2; // 边距（模块数）
        const cellSize = Math.floor(width / (moduleCount + margin * 2));
        const actualSize = (moduleCount + margin * 2) * cellSize;

        // 创建Canvas并绘制QR码
        const canvas = document.createElement('canvas');
        canvas.width = actualSize;
        canvas.height = actualSize;
        const ctx = canvas.getContext('2d');

        // 绘制白色背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, actualSize, actualSize);

        // 绘制QR码
        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
          for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
              const x = (col + margin) * cellSize;
              const y = (row + margin) * cellSize;
              ctx.fillRect(x, y, cellSize, cellSize);
            }
          }
        }

        // 转换为Data URL
        const dataURL = canvas.toDataURL('image/png');
        console.log('✅ 客户端QR码生成成功（隐私安全）');
        return dataURL;

      } catch (error) {
        console.error('❌ 客户端QR码生成失败:', error);
        throw new Error('QR码生成失败: ' + error.message);
      }
    }

    /**
     * 等待QR码库加载完成
     * @param {number} maxWaitTime - 最大等待时间（毫秒）
     * @returns {Promise<boolean>} 库加载成功返回true
     */
    function waitForQRCodeLibrary(maxWaitTime = 5000) {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
          if (typeof qrcode !== 'undefined') {
            clearInterval(checkInterval);
            console.log('✅ QR码生成库已加载');
            resolve(true);
          } else if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkInterval);
            reject(new Error('QR码库加载超时'));
          }
        }, 100);
      });
    }

    // ==================== 滚动和回到顶部 ====================

    /**
     * 回到顶部函数
     */
    function scrollToTop() {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }

    /**
     * 监听滚动事件，显示/隐藏回到顶部按钮，并调整主题切换按钮位置
     */
    let scrollThrottle = null;
    window.addEventListener('scroll', function() {
      if (scrollThrottle) return;

      scrollThrottle = setTimeout(() => {
        const backToTopBtn = document.getElementById('backToTop');
        const themeToggleBtn = document.querySelector('.theme-toggle-float');
        if (!backToTopBtn || !themeToggleBtn) return;

        // 滚动超过300px时显示按钮
        if (window.pageYOffset > 300) {
          backToTopBtn.classList.add('show');
          backToTopBtn.style.display = 'flex';
          // 回到顶部按钮显示时，主题切换按钮在上方
          // 使用媒体查询检测移动端
          const isMobile = window.innerWidth <= 480;
          themeToggleBtn.style.bottom = isMobile ? '68px' : '88px';
        } else {
          backToTopBtn.classList.remove('show');
          // 等待动画完成后再隐藏
          setTimeout(() => {
            if (!backToTopBtn.classList.contains('show')) {
              backToTopBtn.style.display = 'none';
              // 回到顶部按钮隐藏时，主题切换按钮移到下方
              const isMobile = window.innerWidth <= 480;
              themeToggleBtn.style.bottom = isMobile ? '16px' : '24px';
            }
          }, 300);
        }

        scrollThrottle = null;
      }, 100);
    });

    `;
}
