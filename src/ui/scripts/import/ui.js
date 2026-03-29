/**
 * 导入UI交互模块
 * 包含模态框、拖拽、文件处理等UI相关功能
 */

/**
 * 获取导入UI交互代码
 * @returns {string} JavaScript 代码
 */
export function getImportUICode() {
	return `
    // ========== 导入UI交互 ==========

    // 导入预览数据
    let importPreviewData = [];

    // 自动预览防抖计时器
    let autoPreviewTimer = null;

    // 自动预览导入（带防抖）
    function autoPreviewImport() {
      // 清除之前的计时器
      if (autoPreviewTimer) {
        clearTimeout(autoPreviewTimer);
      }

      // 设置新的计时器，500ms 后触发预览
      autoPreviewTimer = setTimeout(() => {
        const text = document.getElementById('importText').value.trim();
        if (text) {
          previewImport();
        } else {
          // 如果文本为空，隐藏预览区域并重置按钮
          document.getElementById('importPreview').style.display = 'none';
          document.getElementById('executeImportBtn').disabled = true;
          importPreviewData = [];
        }
      }, 500);
    }

    // ========== 智能输入区拖拽功能 ==========

    // 处理拖拽悬停
    function handleDragOver(event) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.add('drag-over');
      }
    }

    // 处理拖拽离开
    function handleDragLeave(event) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.remove('drag-over');
      }
    }

    // 处理文件拖放
    function handleFileDrop(event) {
      event.preventDefault();
      event.stopPropagation();

      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.remove('drag-over');
      }

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        processImportFile(files[0]);
      }
    }

    // 清除已选文件
    function clearSelectedFile(event) {
      event.stopPropagation();

      // 重置文件输入
      const fileInput = document.getElementById('importFileInput');
      if (fileInput) fileInput.value = '';

      // 隐藏文件信息徽章
      const badge = document.getElementById('fileInfoBadge');
      if (badge) badge.style.display = 'none';

      // 重置文本区域状态
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.value = '';
        textarea.classList.remove('has-content');
      }

      // 隐藏预览并禁用导入按钮
      document.getElementById('importPreview').style.display = 'none';
      document.getElementById('executeImportBtn').disabled = true;
      importPreviewData = [];
    }

    // 更新文件信息徽章显示
    function updateFileInfo(file) {
      const badge = document.getElementById('fileInfoBadge');
      const nameEl = document.getElementById('selectedFileName');
      const sizeEl = document.getElementById('selectedFileSize');
      const textarea = document.getElementById('importText');

      if (nameEl) nameEl.textContent = file.name;
      if (sizeEl) sizeEl.textContent = '(' + (file.size / 1024).toFixed(1) + 'KB)';
      if (badge) badge.style.display = 'flex';
      if (textarea) textarea.classList.add('has-content');
    }

    // 处理导入文件（统一处理拖拽和选择）
    function processImportFile(file) {
      if (!file) return;

      // 检查文件类型
      // 支持 .html.txt (Ente Auth 导出格式)
      const validExtensions = ['.txt', '.csv', '.json', '.html', '.htm', '.2fas', '.xml', '.html.txt', '.authpro', '.encrypt'];
      const fileName = file.name.toLowerCase();
      const isValidType = validExtensions.some(ext => fileName.endsWith(ext));

      if (!isValidType) {
        showCenterToast('❌', '不支持的文件格式');
        return;
      }

      // 更新文件信息徽章
      updateFileInfo(file);

      const reader = new FileReader();
      reader.onload = function(e) {
        const content = decodeImportFileContent(file.name, e.target.result);
        document.getElementById('importText').value = content;

        // 自动预览
        setTimeout(() => {
          previewImport();
        }, 100);
      };
      reader.onerror = function() {
        showCenterToast('❌', '读取文件失败');
      };
      reader.readAsArrayBuffer(file);
    }

    // 更新导入统计信息（新的内联统计）
    function updateImportStats(validCount, invalidCount, skippedCount) {
      const statValid = document.getElementById('statValid');
      const statInvalid = document.getElementById('statInvalid');
      const statTotal = document.getElementById('statTotal');

      if (statValid) statValid.textContent = validCount + ' 有效';
      if (statInvalid) statInvalid.textContent = invalidCount + ' 无效';
      if (statTotal) {
        const total = validCount + invalidCount + (skippedCount || 0);
        statTotal.textContent = '共 ' + total + ' 条';
      }
    }

    // 显示导入模态框
    function showImportModal() {
      showModal('importModal', () => {
        // 清空文本输入框
        const textarea = document.getElementById('importText');
        if (textarea) {
          textarea.value = '';
          textarea.classList.remove('has-content', 'drag-over');
        }
        // 隐藏预览区域
        document.getElementById('importPreview').style.display = 'none';
        // 重置导入按钮
        const executeBtn = document.getElementById('executeImportBtn');
        executeBtn.disabled = true;
        executeBtn.textContent = '📥 导入';
        // 隐藏文件信息徽章
        const badge = document.getElementById('fileInfoBadge');
        if (badge) badge.style.display = 'none';
        // 重置文件输入框
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) fileInput.value = '';
        // 重置统计信息
        updateImportStats(0, 0, 0);
        // 清空预览数据
        importPreviewData = [];
      });
    }

    // 隐藏导入模态框
    function hideImportModal() {
      // 清除自动预览计时器
      if (autoPreviewTimer) {
        clearTimeout(autoPreviewTimer);
        autoPreviewTimer = null;
      }

      hideModal('importModal', () => {
        // 清空文本输入框并重置状态
        const textarea = document.getElementById('importText');
        if (textarea) {
          textarea.value = '';
          textarea.classList.remove('has-content', 'drag-over');
        }
        // 隐藏预览区域
        document.getElementById('importPreview').style.display = 'none';
        // 清空预览列表内容
        const previewList = document.getElementById('importPreviewList');
        if (previewList) {
          previewList.innerHTML = '';
        }
        // 重置导入按钮
        const executeBtn = document.getElementById('executeImportBtn');
        executeBtn.disabled = true;
        executeBtn.textContent = '📥 导入';
        // 清空预览数据数组
        importPreviewData = [];
        // 重置文件输入框，确保下次可以选择同一个文件
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) {
          fileInput.value = '';
        }
        // 隐藏文件信息徽章
        const badge = document.getElementById('fileInfoBadge');
        if (badge) {
          badge.style.display = 'none';
        }
      });
    }

    // 处理导入文件（选择文件）
    function handleImportFile(event) {
      const file = event.target.files[0];
      processImportFile(file);
    }
`;
}
