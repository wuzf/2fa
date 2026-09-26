/**
 * 导出模块 - 格式配置
 * 包含二级格式选择配置和排序函数
 */

/**
 * 获取导出配置代码
 * @returns {string} JavaScript 代码
 */
export function getExportConfigCode() {
	return `
    // ========== 导出配置模块 ==========

    // 需要二级选择的格式配置
    function getSubFormatConfigs() { return {
      'freeotp-plus-multi': {
        title: t('transferFreeOTPFormat'),
        options: [
          {
            id: 'freeotp-plus',
            icon: '🔓',
            name: t('transferFreeOTPNative'),
            ext: '.json',
            desc: t('transferFreeOTPDesc'),
            compat: 'FreeOTP+ (Android)'
          },
          {
            id: 'freeotp-txt',
            icon: '🔓',
            name: t('transferStandardFormat'),
            ext: '.txt',
            desc: t('transferOTPAuthDesc'),
            compat: t('transferUniversal')
          }
        ]
      },
      'aegis-multi': {
        title: t('transferAegisFormat'),
        options: [
          {
            id: 'aegis',
            icon: '🔓',
            name: t('transferAegisNative'),
            ext: '.json',
            desc: t('transferAegisDesc'),
            compat: 'Aegis (Android)'
          },
          {
            id: 'aegis-txt',
            icon: '🔓',
            name: t('transferStandardFormat'),
            ext: '.txt',
            desc: t('transferOTPAuthDesc'),
            compat: t('transferUniversal')
          }
        ]
      },
      'authpro-multi': {
        title: t('transferAuthProFormat'),
        options: [
          {
            id: 'authpro',
            icon: '🔓',
            name: t('transferAuthProNative'),
            ext: '.authpro',
            desc: t('transferStratumDesc'),
            compat: 'Authenticator Pro'
          },
          {
            id: 'authenticator-txt',
            icon: '🔓',
            name: t('transferStandardFormat'),
            ext: '.txt',
            desc: t('transferOTPAuthDesc'),
            compat: t('transferUniversal')
          }
        ]
      }
    }; }

    /**
     * 根据排序选项对密钥进行排序
     * @param {Array} secretsArray - 密钥数组
     * @param {string} sortValue - 排序选项值 (如 'index-asc', 'name-desc')
     * @returns {Array} 排序后的密钥数组
     */
    function sortSecretsForExport(secretsArray, sortValue) {
      const [field, direction] = sortValue.split('-');
      const isAsc = direction === 'asc';

      // 添加顺序：保持原数组顺序或倒序
      if (field === 'index') {
        return isAsc ? secretsArray : [...secretsArray].reverse();
      }

      return secretsArray.sort((a, b) => {
        let valueA, valueB;

        switch (field) {
          case 'name':
            valueA = (a.name || '').toLowerCase();
            valueB = (b.name || '').toLowerCase();
            break;
          case 'account':
            valueA = (a.account || '').toLowerCase();
            valueB = (b.account || '').toLowerCase();
            break;
          default:
            return 0;
        }

        if (valueA < valueB) return isAsc ? -1 : 1;
        if (valueA > valueB) return isAsc ? 1 : -1;
        return 0;
      });
    }

    // 选择导出格式
    function selectExportFormat(format) {
      // 隐藏格式选择模态框
      hideExportFormatModal();

      try {
        // 获取排序选项
        const sortSelect = document.getElementById('exportSortOrder');
        const sortValue = sortSelect ? sortSelect.value : 'index-asc';

        // 复制并排序密钥
        const secretsToExport = sortSecretsForExport([...secrets], sortValue);

        // 调用通用导出函数
        exportSecretsAsFormat(secretsToExport, format);
      } catch (error) {
        console.error('导出失败:', error);
        showCenterToast('❌', t('transferExportFailedPrefix') + error.message);
      }
    }
`;
}
