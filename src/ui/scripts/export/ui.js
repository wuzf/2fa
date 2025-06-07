/**
 * 导出模块 - UI 交互
 * 包含模态框显示/隐藏等 UI 相关功能
 */

/**
 * 获取导出 UI 代码
 * @returns {string} JavaScript 代码
 */
export function getExportUICode() {
	return `
    // ========== 导出 UI 模块 ==========

    // 导出所有密钥 - 显示格式选择
    function exportAllSecrets() {
      if (secrets.length === 0) {
        showCenterToast('❌', '没有密钥可以导出');
        return;
      }
      showExportFormatModal();
    }

    // 显示导出格式选择模态框
    function showExportFormatModal() {
      showModal('exportFormatModal', () => {
        const exportCount = document.getElementById('exportCount');
        exportCount.textContent = secrets.length;
      });
    }

    // 隐藏导出格式选择模态框
    function hideExportFormatModal() {
      hideModal('exportFormatModal');
    }

    // 显示二级格式选择模态框
    function showSubFormatModal(multiFormatId) {
      const config = subFormatConfigs[multiFormatId];
      if (!config) {
        console.error('未找到格式配置:', multiFormatId);
        return;
      }

      const modal = document.getElementById('subFormatModal');
      const title = document.getElementById('subFormatTitle');
      const optionsContainer = document.getElementById('subFormatOptions');

      title.textContent = config.title;
      optionsContainer.innerHTML = '';

      config.options.forEach(opt => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'format-option';
        optionDiv.onclick = () => selectSubFormat(opt.id);
        optionDiv.innerHTML =
          '<div class="format-icon">' + opt.icon + '</div>' +
          '<div class="format-info">' +
          '  <div class="format-name">' + opt.name + ' <span class="format-ext">' + opt.ext + '</span></div>' +
          '  <div class="format-desc">' + opt.desc + '</div>' +
          '  <div class="format-compat">兼容: ' + opt.compat + '</div>' +
          '</div>';
        optionsContainer.appendChild(optionDiv);
      });

      showModal('subFormatModal');
    }

    // 隐藏二级格式选择模态框
    function hideSubFormatModal() {
      hideModal('subFormatModal');
    }

    // 选择二级格式
    function selectSubFormat(formatId) {
      hideSubFormatModal();
      hideExportFormatModal();
      selectExportFormat(formatId);
    }

    // 显示 FreeOTP 导出模态框
    function showFreeOTPExportModal() {
      showModal('freeotpExportModal', () => {
        const passwordInput = document.getElementById('freeotpExportPassword');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }

    // 隐藏 FreeOTP 导出模态框
    function hideFreeOTPExportModal() {
      hideModal('freeotpExportModal');
    }

    // 显示 TOTP Authenticator 导出模态框
    function showTOTPAuthExportModal() {
      showModal('totpAuthExportModal', () => {
        const passwordInput = document.getElementById('totpAuthExportPassword');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }

    // 隐藏 TOTP Authenticator 导出模态框
    function hideTOTPAuthExportModal() {
      hideModal('totpAuthExportModal');
    }

    // 显示导出成功提示
    function showExportSuccess(count, format) {
      showCenterToast('✅', '成功导出 ' + count + ' 个密钥 (' + format + ')');
    }
`;
}
