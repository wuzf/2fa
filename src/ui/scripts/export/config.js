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
    const subFormatConfigs = {
      'freeotp-plus-multi': {
        title: '选择 FreeOTP+ 导出格式',
        options: [
          {
            id: 'freeotp-plus',
            icon: '🔓',
            name: 'FreeOTP+ 原生',
            ext: '.json',
            desc: '社区版原生格式，明文JSON文件',
            compat: 'FreeOTP+ (Android)'
          },
          {
            id: 'freeotp-txt',
            icon: '🔓',
            name: '标准格式',
            ext: '.txt',
            desc: 'OTPAuth URL格式，兼容所有验证器',
            compat: '通用'
          }
        ]
      },
      'aegis-multi': {
        title: '选择 Aegis 导出格式',
        options: [
          {
            id: 'aegis',
            icon: '🔓',
            name: 'Aegis 原生',
            ext: '.json',
            desc: 'Aegis Authenticator 完整格式',
            compat: 'Aegis (Android)'
          },
          {
            id: 'aegis-txt',
            icon: '🔓',
            name: '标准格式',
            ext: '.txt',
            desc: 'OTPAuth URL格式，兼容所有验证器',
            compat: '通用'
          }
        ]
      },
      'authpro-multi': {
        title: '选择 Authenticator Pro 导出格式',
        options: [
          {
            id: 'authpro',
            icon: '🔓',
            name: 'Auth Pro 原生',
            ext: '.authpro',
            desc: 'Stratum 原生格式',
            compat: 'Authenticator Pro'
          },
          {
            id: 'authenticator-txt',
            icon: '🔓',
            name: '标准格式',
            ext: '.txt',
            desc: 'OTPAuth URL格式，兼容所有验证器',
            compat: '通用'
          }
        ]
      }
    };

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
        showCenterToast('❌', '导出失败：' + error.message);
      }
    }
`;
}
