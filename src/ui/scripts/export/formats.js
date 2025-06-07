/**
 * 导出模块 - 标准格式
 * 包含 OTPAuth、JSON、CSV、HTML 等标准格式导出
 */

/**
 * 获取标准格式导出代码
 * @returns {string} JavaScript 代码
 */
export function getStandardFormatsCode() {
	return `
    // ========== 标准格式导出 ==========

    // 通用导出函数
    async function exportSecretsAsFormat(secretsData, format, options = {}) {
      const opts = {
        filenamePrefix: options.filenamePrefix || '2FA-secrets',
        source: options.source || 'export',
        metadata: options.metadata || {}
      };

      switch(format) {
        case 'txt':
          exportAsOTPAuth(secretsData, opts);
          break;
        case 'json':
          exportAsJSON(secretsData, opts);
          break;
        case 'csv':
          exportAsCSV(secretsData, opts);
          break;
        case 'html':
          await exportAsHTML(secretsData, opts);
          break;
        case 'google':
          showExportToGoogleModal();
          break;
        case 'aegis':
          exportAsAegis(secretsData, opts);
          break;
        case 'andotp':
          exportAsAndOTP(secretsData, opts);
          break;
        case 'freeotp-plus':
          exportAsFreeOTPPlusJSON(secretsData, opts);
          break;
        case 'freeotp':
          showFreeOTPExportModal();
          break;
        case 'totp-auth':
          showTOTPAuthExportModal();
          break;
        case 'lastpass':
          exportAsLastPass(secretsData, opts);
          break;
        case 'proton':
          exportAsProtonAuthenticator(secretsData, opts);
          break;
        case 'authpro':
          exportAsAuthenticatorPro(secretsData, opts);
          break;
        case 'bitwarden-auth-csv':
          exportAsBitwardenAuthenticatorCSV(secretsData, opts);
          break;
        case 'bitwarden-auth-json':
          exportAsBitwardenAuthenticatorJSON(secretsData, opts);
          break;
        case 'ente-auth':
        case 'winauth':
        case 'aegis-txt':
        case 'authenticator-txt':
        case 'freeotp-txt':
          await exportAsOTPAuth(secretsData, { formatName: format });
          break;
        default:
          showCenterToast('❌', '不支持的导出格式');
      }
    }

    // 导出为 OTPAuth 文本格式
    async function exportAsOTPAuth(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const formatName = options.formatName || 'otpauth';
      const otpauthUrls = sortedSecrets.map(secret => {
        const serviceName = secret.name.trim();
        const accountName = secret.account ? secret.account.trim() : '';

        let label;
        if (accountName) {
          label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
        } else {
          label = encodeURIComponent(serviceName);
        }

        const params = new URLSearchParams({
          secret: secret.secret.toUpperCase(),
          digits: (secret.digits || 6).toString(),
          period: (secret.period || 30).toString(),
          algorithm: secret.algorithm || 'SHA1',
          issuer: serviceName
        });

        return 'otpauth://totp/' + label + '?' + params.toString();
      });

      const content = otpauthUrls.join('\\n');
      const saved = await downloadFile(content, filenamePrefix + '-' + formatName + '-' + getDateString() + '.txt', 'text/plain;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'OTPAuth 文本');
      }
    }

    // 导出为 JSON 格式
    async function exportAsJSON(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        count: sortedSecrets.length,
        secrets: sortedSecrets.map(secret => {
          const type = secret.type || 'TOTP';
          const entry = {
            issuer: secret.name,
            account: secret.account || '',
            secret: secret.secret.toUpperCase(),
            type: type,
            digits: secret.digits || 6,
            period: secret.period || 30,
            algorithm: secret.algorithm || 'SHA1'
          };
          if (type.toUpperCase() === 'HOTP') {
            entry.counter = secret.counter || 0;
          }
          return entry;
        })
      };

      if (options.metadata) {
        exportData.metadata = options.metadata;
      }

      const content = JSON.stringify(exportData, null, 2);
      const saved = await downloadFile(content, filenamePrefix + '-data-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'JSON 数据');
      }
    }

    // 导出为 CSV 格式
    async function exportAsCSV(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const headers = ['服务名称', '账户信息', '密钥', '类型', '位数', '周期(秒)', '算法', '计数器'];
      const csvRows = [headers.join(',')];

      sortedSecrets.forEach(secret => {
        const type = (secret.type || 'TOTP').toUpperCase();
        const row = [
          escapeCSV(secret.name),
          escapeCSV(secret.account || ''),
          escapeCSV(secret.secret.toUpperCase()),
          escapeCSV(secret.type || 'TOTP'),
          secret.digits || 6,
          secret.period || 30,
          escapeCSV(secret.algorithm || 'SHA1'),
          type === 'HOTP' ? (secret.counter || 0) : ''
        ];
        csvRows.push(row.join(','));
      });

      const content = csvRows.join('\\n');
      const bom = '\\uFEFF';
      const saved = await downloadFile(bom + content, filenamePrefix + '-table-' + getDateString() + '.csv', 'text/csv;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'CSV 表格');
      }
    }
`;
}
