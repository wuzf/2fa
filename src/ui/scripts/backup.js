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

    // 还原配置相关函数
    let selectedBackup = null;
    let backupList = [];
    let backupExportFormat = 'txt'; // 备份导出格式

    function showRestoreModal() {
      showModal('restoreModal', () => {
        loadBackupList();
      });
    }

    function hideRestoreModal() {
      hideModal('restoreModal', () => {
        selectedBackup = null;
        document.getElementById('confirmRestoreBtn').disabled = true;
        document.getElementById('exportBackupBtn').disabled = true;
        document.getElementById('restorePreview').style.display = 'none';
      });
    }

    async function loadBackupList() {
      const backupSelectElement = document.getElementById('backupSelect');
      backupSelectElement.innerHTML = '<option value="">正在加载备份列表...</option>';
      backupSelectElement.disabled = true;

      try {
        // 加载所有备份（不限数量）
        const response = await authenticatedFetch('/api/backup?limit=all');
        if (!response.ok) {
          throw new Error('获取备份列表失败');
        }

        const data = await response.json();
        backupList = data.backups || [];

        if (backupList.length === 0) {
          backupSelectElement.innerHTML = '<option value="">暂无备份文件</option>';
          backupSelectElement.disabled = true;
          return;
        }

        // 渲染备份下拉选择框
        renderBackupSelect(backupList);
        backupSelectElement.disabled = false;
      } catch (error) {
        console.error('加载备份列表失败:', error);
        backupSelectElement.innerHTML = '<option value="">加载备份列表失败: ' + error.message + '</option>';
        backupSelectElement.disabled = true;
      }
    }

    function renderBackupSelect(backups) {
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
        const optionText = backupTime + ' | ' + (backup.count || 0) + '个';

        const option = document.createElement('option');
        option.value = index;
        option.textContent = optionText;
        option.dataset.backupKey = backup.key;
        // 保存完整时间信息在 title 属性中，用于悬停提示
        option.title = new Date(backup.created).toLocaleString('zh-CN');

        backupSelectElement.appendChild(option);
      });
    }

    function selectBackupFromDropdown() {
      const backupSelectElement = document.getElementById('backupSelect');
      const selectedIndex = backupSelectElement.value;

      if (selectedIndex === '' || selectedIndex === null) {
        selectedBackup = null;
        document.getElementById('confirmRestoreBtn').disabled = true;
        document.getElementById('exportBackupBtn').disabled = true;
        document.getElementById('restorePreview').style.display = 'none';
        return;
      }

      const backup = backupList[parseInt(selectedIndex)];
      if (backup) {
        selectBackup(backup, parseInt(selectedIndex));
      }
    }

    async function selectBackup(backup, index) {
      selectedBackup = backup;
      document.getElementById('confirmRestoreBtn').disabled = false;
      document.getElementById('exportBackupBtn').disabled = false;

      // 显示备份预览
      await showBackupPreview(backup);
    }

    async function showBackupPreview(backup) {
      const previewElement = document.getElementById('restorePreview');
      const previewContent = document.getElementById('backupPreviewContent');

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

        if (!response.ok) {
          throw new Error('获取备份内容失败');
        }

        const responseData = await response.json();
        const data = responseData.data || responseData; // 兼容不同的响应格式

        if (data.secrets && data.secrets.length > 0) {
          previewContent.innerHTML =
            '<div class="backup-table-container">' +
              '<table class="backup-table">' +
                '<thead>' +
                  '<tr>' +
                    '<th>🔐 服务名称</th>' +
                    '<th>👤 账户信息</th>' +
                    '<th>🔢 类型</th>' +
                    '<th>⏱️ 创建时间</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' +
                  data.secrets.map(secret =>
                    '<tr class="backup-table-row">' +
                      '<td class="service-name">' + secret.name + '</td>' +
                      '<td class="account-info">' + (secret.account || secret.service || '无账户信息') + '</td>' +
                      '<td class="secret-type">' + (secret.type || 'TOTP') + '</td>' +
                      '<td class="created-time">' + (secret.createdAt ? new Date(secret.createdAt).toLocaleString('zh-CN') : '未知') + '</td>' +
                    '</tr>'
                  ).join('') +
                '</tbody>' +
              '</table>' +
            '</div>';
        } else {
          previewContent.innerHTML = '<div class="no-backups">此备份中没有密钥</div>';
        }
      } catch (error) {
        console.error('加载备份预览失败:', error);
        previewContent.innerHTML = '<div class="no-backups">加载备份预览失败: ' + error.message + '</div>';
      }
    }

    async function confirmRestore() {
      if (!selectedBackup) {
        showCenterToast('❌', '请先选择一个备份文件');
        return;
      }

      const confirmed = confirm('确定要还原备份 "' + selectedBackup.key.replace('backup_', '').replace('.json', '') + '" 吗？\\n\\n⚠️ 此操作将覆盖当前所有密钥，且无法撤销！');

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
      showModal('backupExportFormatModal');
    }

    function hideBackupExportFormatModal() {
      hideModal('backupExportFormatModal');
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
        // HTML 格式需要在前端生成（包含二维码）
        // 复用 export.js 中的通用导出函数
        if (format === 'html') {
          await exportBackupAsHTML();
          return;
        }

        // 其他格式通过后端API导出（更高效）
        showCenterToast('ℹ️', '正在导出备份文件...');

        // 添加format参数到URL
        const exportUrl = '/api/backup/export/' + selectedBackup.key + '?format=' + format;
        const response = await authenticatedFetch(exportUrl);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '导出失败');
        }

        // 获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = selectedBackup.key;
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        // 创建下载链接
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
          'csv': 'CSV 表格'
        };
        const formatName = formatNames[format] || format.toUpperCase();
        showCenterToast('✅', '备份文件已导出为 ' + formatName + ' 格式！');
      } catch (error) {
        console.error('导出备份失败:', error);
        showCenterToast('❌', '导出失败: ' + error.message);
      }
    }

    // 导出备份为 HTML 格式 - 复用 export.js 中的通用函数
    async function exportBackupAsHTML() {
      try {
        showCenterToast('📋', '正在获取备份数据...');

        // 获取备份数据
        const response = await authenticatedFetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ backupKey: selectedBackup.key, preview: true })
        });

        if (!response.ok) {
          throw new Error('获取备份内容失败');
        }

        const responseData = await response.json();
        const data = responseData.data || responseData;

        if (!data.secrets || data.secrets.length === 0) {
          throw new Error('备份中没有密钥数据');
        }

        // 按服务名称排序
        const sortedSecrets = [...data.secrets].sort((a, b) => {
          const nameA = a.name.toLowerCase();
          const nameB = b.name.toLowerCase();
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        });

        // 生成文件名前缀（从备份文件名中提取日期）
        const dateMatch = selectedBackup.key.match(/backup_(\\\\d{4}-\\\\d{2}-\\\\d{2})/);
        const dateStr = dateMatch ? dateMatch[1] : '';
        const filenamePrefix = dateStr ? '2FA-backup-' + dateStr : '2FA-backup';

        // 调用 export.js 中的通用导出函数
        await exportSecretsAsFormat(sortedSecrets, 'html', {
          filenamePrefix: filenamePrefix,
          source: 'backup',
          metadata: {
            backupKey: selectedBackup.key,
            backupDate: selectedBackup.created
          }
        });

      } catch (error) {
        console.error('HTML导出失败:', error);
        showCenterToast('❌', 'HTML导出失败: ' + error.message);
      }
    }
`;
}
