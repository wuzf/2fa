/**
 * 备份模块
 * 包含所有备份/恢复功能，用于管理密钥备份
 */

/**
 * 获取备份相关代码
 * @returns {string} 备份 JavaScript 代码
 */
export function getBackupCode() {
	return `    // ========== 备份恢复功能模块 ==========

    function getSavedDefaultBackupExportFormat() {
      return getCachedDefaultExportFormat();
    }

    function getBackupExportFormatLabel(format) {
      const labels = {
        txt: 'TXT',
        json: 'JSON',
        csv: 'CSV',
        html: 'HTML'
      };
      return labels[format] || format.toUpperCase();
    }

    function getBackupStoredFormat(backup) {
      const format = backup && backup.format ? String(backup.format).trim().toLowerCase() : 'json';
      return ['txt', 'json', 'csv', 'html'].includes(format) ? format : 'json';
    }

    function updateBackupDefaultExportButton(format = getSavedDefaultBackupExportFormat()) {
      const defaultBtn = document.getElementById('backupUseDefaultBtn');
      if (!defaultBtn) {
        return;
      }

      defaultBtn.textContent = '按默认格式导出 (' + getBackupExportFormatLabel(format) + ')';
      defaultBtn.disabled = false;
    }

    // 还原配置相关函数
    async function syncBackupDefaultExportButton() {
      updateBackupDefaultExportButton();
      const format = await getServerDefaultExportFormat({ forceRefresh: true });
      updateBackupDefaultExportButton(format);
      return format;
    }

    let selectedBackup = null;
    let backupList = [];
    let backupListCursor = null;
    let backupListHasMore = false;
    let backupListLoading = false;
    let backupPreviewRequestToken = 0;
    const BACKUP_LIST_PAGE_SIZE = 50;
    let backupExportFormat = 'txt'; // 备份导出格式

    function isActiveBackupPreviewRequest(backup, requestToken) {
      return requestToken === backupPreviewRequestToken && selectedBackup && selectedBackup.key === backup.key;
    }

    function resetBackupSelection() {
      backupPreviewRequestToken += 1;
      selectedBackup = null;

      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = true;
        confirmRestoreBtn.title = '';
      }

      const exportBackupBtn = document.getElementById('exportBackupBtn');
      if (exportBackupBtn) {
        exportBackupBtn.disabled = true;
        exportBackupBtn.title = '';
      }

      const previewElement = document.getElementById('restorePreview');
      if (previewElement) {
        previewElement.style.display = 'none';
      }
    }

    function updateBackupListPagination() {
      const statusElement = document.getElementById('backupListStatus');
      const loadMoreBtn = document.getElementById('backupLoadMoreBtn');

      if (statusElement) {
        if (backupList.length === 0) {
          statusElement.textContent = '';
        } else if (backupListHasMore) {
          statusElement.textContent = '已加载 ' + backupList.length + ' 条备份，可继续加载更早记录';
        } else {
          statusElement.textContent = '已加载全部 ' + backupList.length + ' 条备份';
        }
      }

      if (loadMoreBtn) {
        const shouldShow = backupList.length > 0 && (backupListHasMore || backupListLoading);
        loadMoreBtn.style.display = shouldShow ? '' : 'none';
        loadMoreBtn.disabled = backupListLoading || !backupListHasMore;
        loadMoreBtn.textContent = backupListLoading ? '加载中...' : '加载更多';
      }
    }

    function showRestoreModal() {
      showModal('restoreModal', () => {
        loadBackupList();
      });
    }

    function hideRestoreModal() {
      hideModal('restoreModal', () => {
        backupListCursor = null;
        backupListHasMore = false;
        backupListLoading = false;
        resetBackupSelection();
        updateBackupListPagination();
      });
    }

    async function loadBackupList() {
      return loadBackupListPage();
    }

    async function loadMoreBackupList() {
      if (!backupListHasMore || !backupListCursor || backupListLoading) {
        return;
      }

      return loadBackupListPage({ append: true });
    }

    async function loadBackupListPage(options = {}) {
      const append = options.append === true;
      const backupSelectElement = document.getElementById('backupSelect');
      const selectedBackupKey = selectedBackup ? selectedBackup.key : '';

      if (!backupSelectElement || backupListLoading) {
        return;
      }

      if (!append) {
        backupList = [];
        backupListCursor = null;
        backupListHasMore = false;
        backupSelectElement.innerHTML = '<option value="">正在加载备份列表...</option>';
        backupSelectElement.disabled = true;
      }

      backupListLoading = true;
      updateBackupListPagination();

      try {
        const params = new URLSearchParams({ limit: String(BACKUP_LIST_PAGE_SIZE) });
        if (append && backupListCursor) {
          params.set('cursor', backupListCursor);
        }

        const response = await authenticatedFetch('/api/backup?' + params.toString());
        if (!response.ok) {
          throw new Error('获取备份列表失败');
        }

        const data = await response.json();
        const nextBackups = data.backups || [];
        backupList = append ? backupList.concat(nextBackups) : nextBackups;
        backupListCursor = data.pagination && data.pagination.hasMore ? data.pagination.cursor : null;
        backupListHasMore = Boolean(data.pagination && data.pagination.hasMore && data.pagination.cursor);

        if (backupList.length === 0) {
          backupSelectElement.innerHTML = '<option value="">暂无备份文件</option>';
          backupSelectElement.disabled = true;
          resetBackupSelection();
          updateBackupListPagination();
          return;
        }

        renderBackupSelect(backupList, selectedBackupKey);
        backupSelectElement.disabled = false;

        if (selectedBackupKey) {
          const refreshedSelectedBackup = backupList.find(item => item.key === selectedBackupKey);
          if (refreshedSelectedBackup) {
            selectedBackup = refreshedSelectedBackup;
          } else if (!append) {
            resetBackupSelection();
          }
        }

        updateBackupListPagination();
      } catch (error) {
        console.error('加载备份列表失败:', error);

        if (!append) {
          backupSelectElement.innerHTML = '<option value="">加载备份列表失败: ' + error.message + '</option>';
          backupSelectElement.disabled = true;
          resetBackupSelection();
        } else {
          showCenterToast('❌', '加载更多备份失败: ' + error.message);
        }
      } finally {
        backupListLoading = false;
        updateBackupListPagination();
      }
    }

    function renderBackupSelect(backups, selectedBackupKey = '') {
      const backupSelectElement = document.getElementById('backupSelect');
      backupSelectElement.innerHTML = '<option value="">请选择备份文件...</option>';

      backups.forEach((backup, index) => {
        // 格式化日期为简洁格式，适配移动设备
        const date = new Date(backup.created);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        // 移动端优化：格式 "年-月-日 时:分 | 数量个"
        // 例如：2025-11-24 19:50 | 117个
        const backupTime = year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
        const formatLabel = getBackupExportFormatLabel(getBackupStoredFormat(backup));
        const optionText = backupTime + ' | ' + formatLabel + ' | ' + (backup.count || 0) + '个';

        const option = document.createElement('option');
        option.value = index;
        option.textContent = optionText;
        option.dataset.backupKey = backup.key;
        // 保存完整时间信息在 title 属性中，用于悬停提示
        option.title = new Date(backup.created).toLocaleString('zh-CN') + ' | ' + formatLabel;
        option.selected = selectedBackupKey === backup.key;

        backupSelectElement.appendChild(option);
      });
    }

    function selectBackupFromDropdown() {
      const backupSelectElement = document.getElementById('backupSelect');
      const selectedIndex = backupSelectElement.value;

      if (selectedIndex === '' || selectedIndex === null) {
        resetBackupSelection();
        return;
      }

      const backup = backupList[parseInt(selectedIndex)];
      if (backup) {
        selectBackup(backup, parseInt(selectedIndex));
      }
    }

    async function selectBackup(backup, index) {
      selectedBackup = backup;
      const requestToken = ++backupPreviewRequestToken;
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');

      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = true;
        confirmRestoreBtn.title = '正在加载备份预览';
      }
      if (exportBackupBtn) {
        exportBackupBtn.disabled = true;
        exportBackupBtn.title = '正在加载备份预览';
      }

      // 显示备份预览
      await showBackupPreview(backup, requestToken);
    }

    async function showBackupPreview(backup, requestToken) {
      const previewElement = document.getElementById('restorePreview');
      const previewContent = document.getElementById('backupPreviewContent');
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');

      previewElement.style.display = 'block';
      previewContent.innerHTML = '<div class="loading-backup">正在加载备份内容...</div>';

      try {
        const response = await authenticatedFetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ backupKey: backup.key, preview: true })
        });

        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }

        if (!response.ok) {
          const errorData = await response.json();
          if (!isActiveBackupPreviewRequest(backup, requestToken)) {
            return;
          }
          throw new Error(errorData.message || errorData.error || '获取备份内容失败');
        }

        const responseData = await response.json();
        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }
        const data = responseData.data || responseData; // 兼容不同的响应格式

        const formatLabel = getBackupExportFormatLabel(getBackupStoredFormat({ format: data.format || backup.format }));
        const encryptedLabel = data.encrypted ? '已加密' : '明文';
        const skippedInvalidCount = Number(data.skippedInvalidCount || 0);
        const isPartialBackup = data.partial === true || skippedInvalidCount > 0;
        const hasSecrets = Array.isArray(data.secrets) && data.secrets.length > 0;
        const isEmptyBackup = !isPartialBackup && !hasSecrets && Number(data.count || 0) === 0;
        const warningMessage =
          Array.isArray(data.warnings) && data.warnings.length > 0
            ? data.warnings[0]
            : (isPartialBackup ? '该备份不完整，无法保证数据完整性。' : '');
        const emptyBackupMessage = isEmptyBackup ? '该备份不包含可恢复的密钥，已禁止恢复当前数据。' : '';
        const previewSummary =
          '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px;">' +
            '<div style="padding: 10px 12px; border-radius: 8px; background: var(--bg-secondary);">' +
              '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">备份格式</div>' +
              '<div style="font-weight: 600; color: var(--text-primary);">' + escapeHTML(formatLabel) + '</div>' +
            '</div>' +
            '<div style="padding: 10px 12px; border-radius: 8px; background: var(--bg-secondary);">' +
              '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">备份条目</div>' +
              '<div style="font-weight: 600; color: var(--text-primary);">' + (data.count || 0) + ' 个</div>' +
            '</div>' +
            '<div style="padding: 10px 12px; border-radius: 8px; background: var(--bg-secondary);">' +
              '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">存储状态</div>' +
              '<div style="font-weight: 600; color: var(--text-primary);">' + encryptedLabel + '</div>' +
            '</div>' +
          '</div>';
        const previewWarning = isPartialBackup
          ? '<div style="margin-bottom: 14px; padding: 12px 14px; border-radius: 8px; border: 1px solid #f59e0b; background: #fff7ed; color: #9a3412;">' +
              '⚠️ ' + escapeHTML(warningMessage) +
            '</div>'
          : '';
        const previewEmptyWarning = isEmptyBackup
          ? '<div style="margin-bottom: 14px; padding: 12px 14px; border-radius: 8px; border: 1px solid #f97316; background: #fff7ed; color: #9a3412;">' +
              '⚠️ ' + escapeHTML(emptyBackupMessage) +
            '</div>'
          : '';

        if (confirmRestoreBtn) {
          confirmRestoreBtn.disabled = isPartialBackup || isEmptyBackup;
          confirmRestoreBtn.title = isPartialBackup ? warningMessage : (isEmptyBackup ? emptyBackupMessage : '');
        }
        if (exportBackupBtn) {
          exportBackupBtn.disabled = isPartialBackup;
          exportBackupBtn.title = isPartialBackup ? warningMessage : '';
        }

        if (hasSecrets) {
          previewContent.innerHTML =
            previewSummary +
            previewWarning +
            previewEmptyWarning +
            '<div class="backup-table-container">' +
              '<table class="backup-table">' +
                '<thead>' +
                  '<tr>' +
                    '<th>🔐 服务名称</th>' +
                    '<th>👤 账户信息</th>' +
                    '<th>🔢 类型</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' +
                  data.secrets.map(secret =>
                    '<tr class="backup-table-row">' +
                      '<td class="service-name">' + escapeHTML(secret.name || '') + '</td>' +
                      '<td class="account-info">' + escapeHTML(secret.account || secret.service || '无账户信息') + '</td>' +
                      '<td class="secret-type">' + escapeHTML(secret.type || 'TOTP') + '</td>' +
                    '</tr>'
                  ).join('') +
                '</tbody>' +
              '</table>' +
            '</div>';
        } else {
          previewContent.innerHTML = previewSummary + previewWarning + previewEmptyWarning + '<div class="no-backups">此备份中没有密钥</div>';
        }
      } catch (error) {
        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }
        console.error('加载备份预览失败:', error);
        if (confirmRestoreBtn) {
          confirmRestoreBtn.disabled = true;
          confirmRestoreBtn.title = '当前备份预览加载失败，无法恢复';
        }
        if (exportBackupBtn) {
          exportBackupBtn.disabled = true;
          exportBackupBtn.title = '当前备份预览加载失败，无法导出';
        }
        previewContent.innerHTML = '<div class="no-backups">加载备份预览失败: ' + error.message + '</div>';
      }
    }

    async function confirmRestore() {
      if (!selectedBackup) {
        showCenterToast('❌', '请先选择一个备份文件');
        return;
      }

      const confirmed = confirm('确定要还原备份 "' + selectedBackup.key.replace('backup_', '').replace(/\\.(json|txt|csv|html)$/i, '') + '" 吗？\\n\\n⚠️ 此操作将覆盖当前所有密钥，且无法撤销！');

      if (!confirmed) {
        return;
      }

      const confirmBtn = document.getElementById('confirmRestoreBtn');
      const originalText = confirmBtn.textContent;
      confirmBtn.textContent = '还原中...';
      confirmBtn.disabled = true;

      try {
        const response = await authenticatedFetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ backupKey: selectedBackup.key })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '还原失败');
        }

        const result = await response.json();
        showCenterToast('✅', '还原成功！恢复了 ' + result.count + ' 个密钥');

        // 关闭模态框并刷新页面
        hideRestoreModal();
        setTimeout(() => {
          location.reload();
        }, 1000);

      } catch (error) {
        console.error('还原失败:', error);
        showCenterToast('❌', '还原失败: ' + error.message);
      } finally {
        confirmBtn.textContent = originalText;
        confirmBtn.disabled = false;
      }
    }

    // 显示备份导出格式选择模态框
    function exportSelectedBackup() {
      if (!selectedBackup) {
        showCenterToast('❌', '请先选择一个备份文件');
        return;
      }

      // 显示格式选择模态框
      showBackupExportFormatModal();
    }

    function showBackupExportFormatModal() {
      showModal('backupExportFormatModal', () => {
        syncBackupDefaultExportButton();
      });
    }

    function hideBackupExportFormatModal() {
      hideModal('backupExportFormatModal');
    }

    async function exportSelectedBackupUsingDefaultFormat() {
      const format = await getServerDefaultExportFormat({ forceRefresh: true });
      await selectBackupExportFormat(format);
    }

    // 选择备份导出格式并执行导出
    async function selectBackupExportFormat(format) {
      backupExportFormat = format;
      hideBackupExportFormatModal();

      await executeBackupExport(format);
    }

    async function executeBackupExport(format) {
      if (!selectedBackup) {
        showCenterToast('❌', '请先选择一个备份文件');
        return;
      }

      try {
        showCenterToast('ℹ️', '正在导出备份文件...');

        const exportUrl = '/api/backup/export/' + selectedBackup.key + '?format=' + format;
        const response = await authenticatedFetch(exportUrl);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '导出失败');
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = selectedBackup.key;
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        const formatNames = {
          'txt': 'OTPAuth 文本',
          'json': 'JSON 数据',
          'csv': 'CSV 表格',
          'html': 'HTML'
        };
        const formatName = formatNames[format] || format.toUpperCase();
        showCenterToast('✅', '备份文件已导出为 ' + formatName + ' 格式！');
      } catch (error) {
        console.error('导出备份失败:', error);
        showCenterToast('❌', '导出失败: ' + error.message);
      }
    }
`;
}
