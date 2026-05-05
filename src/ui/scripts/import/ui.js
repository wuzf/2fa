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
    let pendingImportRetryItems = null;
    // 续传累计状态：上一次分片导入中已完成部分的成功/失败计数及失败明细，
    // 让用户在多轮续传后仍能看到整批导入的真实汇总（含早先分片里服务端返回的失败项）
    let pendingImportPriorSuccessCount = 0;
    let pendingImportPriorFailCount = 0;
    let pendingImportPriorFailures = [];
    // 进度面板用：首轮进入时记录整批原始总数 + 每轮结束时累加的"已处理"计数，
    // 这样续传时 totalItems/processedItems 与 successCount/failCount 同处一个坐标系，
    // 不再出现 "20 / 20 成功 120 失败 3" 这种本轮分母 + 累计计数的混显
    let pendingImportOriginalTotalItems = 0;
    let pendingImportPriorProcessedItems = 0;

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
          resetImportRetryState();
          resetImportProgress();
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
      resetImportRetryState();
      resetImportProgress();
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

    // 清空续传累计状态（pendingImportRetryItems 要同步清空时一起调用，保证不残留旧的失败明细）
    function resetImportRetryState() {
      pendingImportRetryItems = null;
      pendingImportPriorSuccessCount = 0;
      pendingImportPriorFailCount = 0;
      pendingImportPriorFailures = [];
      pendingImportOriginalTotalItems = 0;
      pendingImportPriorProcessedItems = 0;
    }

    // 显示导入模态框
    function setImportProgressVisible(visible) {
      const progressPanel = document.getElementById('importProgress');
      if (progressPanel) {
        progressPanel.style.display = visible ? 'block' : 'none';
      }
    }

    function resetImportProgress() {
      setImportProgressVisible(false);

      const defaults = {
        importProgressTitle: '导入进度',
        importProgressPercent: '0%',
        importProgressStatus: '准备开始...',
        importProgressDetail: '0 / 0',
        importProgressChunk: '分片 0 / 0',
        importProgressSuccess: '成功 0',
        importProgressFail: '失败 0'
      };

      Object.keys(defaults).forEach(function(id) {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = defaults[id];
        }
      });

      const progressFill = document.getElementById('importProgressFill');
      if (progressFill) {
        progressFill.style.width = '0%';
      }
    }

    function showImportProgress(state) {
      setImportProgressVisible(true);
      updateImportProgress(state);
    }

    function updateImportProgress(state) {
      const totalItems = Math.max(Number(state && state.totalItems) || 0, 0);
      const processedItems = Math.min(Math.max(Number(state && state.processedItems) || 0, 0), totalItems || 0);
      const successCount = Math.max(Number(state && state.successCount) || 0, 0);
      const failCount = Math.max(Number(state && state.failCount) || 0, 0);
      const chunkCount = Math.max(Number(state && state.chunkCount) || 0, 0);
      const chunkIndex = Math.min(Math.max(Number(state && state.chunkIndex) || 0, 0), chunkCount || 0);
      const percent = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0;

      setImportProgressVisible(true);

      const title = document.getElementById('importProgressTitle');
      const percentEl = document.getElementById('importProgressPercent');
      const status = document.getElementById('importProgressStatus');
      const detail = document.getElementById('importProgressDetail');
      const chunk = document.getElementById('importProgressChunk');
      const success = document.getElementById('importProgressSuccess');
      const fail = document.getElementById('importProgressFail');
      const progressFill = document.getElementById('importProgressFill');

      if (title) title.textContent = (state && state.title) || '导入进度';
      if (percentEl) percentEl.textContent = percent + '%';
      if (status) status.textContent = (state && state.message) || '正在导入...';
      if (detail) detail.textContent = processedItems + ' / ' + totalItems;
      if (chunk) chunk.textContent = '分片 ' + chunkIndex + ' / ' + chunkCount;
      if (success) success.textContent = '成功 ' + successCount;
      if (fail) fail.textContent = '失败 ' + failCount;
      if (progressFill) progressFill.style.width = percent + '%';
    }

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
        resetImportProgress();
        // 清空预览数据
        importPreviewData = [];
        resetImportRetryState();
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
        resetImportRetryState();
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
        resetImportProgress();
      });
    }

    // 处理导入文件（选择文件）
    function handleImportFile(event) {
      const file = event.target.files[0];
      processImportFile(file);
    }
`;
}
