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
          await exportStandardFormatViaApi(secretsData, format, opts);
          break;
        case 'json':
          await exportStandardFormatViaApi(secretsData, format, opts);
          break;
        case 'csv':
          await exportStandardFormatViaApi(secretsData, format, opts);
          break;
        case 'html':
          await exportStandardFormatViaApi(secretsData, format, opts);
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
    async function exportStandardFormatLocally(sortedSecrets, format, options = {}) {
      switch (format) {
        case 'txt':
          await exportAsOTPAuth(sortedSecrets, {
            ...options,
            formatName: 'otpauth'
          });
          return;
        case 'json':
          await exportAsJSON(sortedSecrets, options);
          return;
        case 'csv':
          await exportAsCSV(sortedSecrets, options);
          return;
        case 'html':
          await exportAsHTML(sortedSecrets, options);
          return;
        default:
          throw new Error('Unsupported export format');
      }
    }

    function shouldFallbackToLocalStandardExport(responseStatus, errorData) {
      return responseStatus === 413 || Boolean(errorData && errorData.offline === true);
    }

    async function exportStandardFormatViaApi(sortedSecrets, format, options = {}) {
      const fallbackToLocalExport = async (reasonMessage) => {
        console.warn('Export API unavailable, falling back to local export:', reasonMessage);
        showCenterToast('⚠️', reasonMessage);
        await exportStandardFormatLocally(sortedSecrets, format, options);
      };

      try {
        showCenterToast('INFO', 'Preparing export file...');

        const response = await authenticatedFetch('/api/secrets/export', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            format: format,
            filenamePrefix: options.filenamePrefix || '2FA-secrets',
            metadata: options.metadata || {},
            secrets: sortedSecrets
          })
        });

        if (response.status === 202) {
          let errorMessage = 'Export requires an online connection';
          try {
            const queuedData = await response.clone().json();
            if (queuedData && queuedData.offline) {
              errorMessage = queuedData.message || queuedData.detail || errorMessage;
            }
          } catch {
            // ignore non-JSON queued responses
          }
          throw new Error(errorMessage);
        }

        if (response.status !== 200) {
          let errorMessage = 'Export failed';
          let errorData = null;
          try {
            errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch {
            // ignore non-JSON error responses
          }

          if (shouldFallbackToLocalStandardExport(response.status, errorData)) {
            const fallbackMessage = response.status === 413
              ? '导出内容较大，已切换为本地兼容导出'
              : '当前离线，已切换为本地兼容导出';
            await fallbackToLocalExport(fallbackMessage);
            return;
          }

          throw new Error(errorMessage);
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        if (!contentDisposition) {
          throw new Error('Export failed: server did not return a downloadable file');
        }

        let filename = (options.filenamePrefix || '2FA-secrets') + '-' + format + '-' + getDateString();
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        const blob = await response.blob();
        const saved = await downloadFile(blob, filename, blob.type || response.headers.get('Content-Type') || 'application/octet-stream');
        if (saved) {
          const formatNames = {
            txt: 'OTPAuth TXT',
            json: 'JSON',
            csv: 'CSV',
            html: 'HTML'
          };
          showExportSuccess(sortedSecrets.length, formatNames[format] || format.toUpperCase());
        }
      } catch (error) {
        const errorMessage = error && error.message ? error.message : 'Export failed';
        const isNetworkFailure = error && (error.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(errorMessage));

        if (isNetworkFailure) {
          await fallbackToLocalExport('当前无法连接在线导出服务，已切换为本地兼容导出');
          return;
        }

        console.error('Export failed:', error);
        showCenterToast('ERR', 'Export failed: ' + errorMessage);
      }
    }

    function buildLocalOTPAuthUrl(secret) {
      const serviceName = String(secret.name || 'Unknown').trim() || 'Unknown';
      const accountName = secret.account ? String(secret.account).trim() : '';
      const type = String(secret.type || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP';
      const label = accountName
        ? encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName)
        : encodeURIComponent(serviceName);
      const params = new URLSearchParams({
        secret: String(secret.secret || '').replace(/[\\s\\-+]/g, '').toUpperCase(),
        digits: String(secret.digits || 6),
        algorithm: String(secret.algorithm || 'SHA1').toUpperCase()
      });

      if (serviceName) {
        params.set('issuer', serviceName);
      }

      if (type === 'HOTP') {
        params.set('counter', String(secret.counter || 0));
        return 'otpauth://hotp/' + label + '?' + params.toString();
      }

      params.set('period', String(secret.period || 30));
      return 'otpauth://totp/' + label + '?' + params.toString();
    }

    async function exportAsOTPAuth(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const formatName = options.formatName || 'otpauth';
      const otpauthUrls = sortedSecrets.map(secret => buildLocalOTPAuthUrl(secret));

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

    async function exportAsHTML(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const exportTimestamp = new Date().toISOString();
      const normalizedSecrets = sortedSecrets.map(secret => ({
        name: String(secret.name || 'Unknown').trim() || 'Unknown',
        account: String(secret.account || '').trim(),
        secret: String(secret.secret || '').replace(/[\\s\\-+]/g, '').toUpperCase(),
        type: String(secret.type || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP',
        digits: secret.digits || 6,
        period: secret.period || 30,
        algorithm: String(secret.algorithm || 'SHA1').toUpperCase(),
        counter: secret.counter || 0
      }));

      const embeddedPayload = escapeHTML(JSON.stringify({
        version: '1.0',
        format: 'html',
        timestamp: exportTimestamp,
        reason: options.source || 'export',
        count: normalizedSecrets.length,
        skippedInvalidCount: 0,
        secrets: normalizedSecrets,
        metadata: options.metadata || {}
      }, null, 2));

      const rowsHtml = normalizedSecrets.map(secret =>
        '        <tr>\\n' +
        '          <td>' + escapeHTML(secret.name) + '</td>\\n' +
        '          <td>' + escapeHTML(secret.account || '') + '</td>\\n' +
        '          <td><code>' + escapeHTML(secret.secret) + '</code></td>\\n' +
        '          <td>' + escapeHTML(secret.type) + '</td>\\n' +
        '          <td>' + secret.digits + '</td>\\n' +
        '          <td>' + secret.period + '</td>\\n' +
        '          <td>' + escapeHTML(secret.algorithm) + '</td>\\n' +
        '          <td>' + secret.counter + '</td>\\n' +
        '        </tr>\\n'
      ).join('');

      const htmlContent = '<!DOCTYPE html>\\n' +
        '<html lang="zh-CN">\\n' +
        '<head>\\n' +
        '  <meta charset="UTF-8">\\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\\n' +
        '  <meta name="2fa-backup-meta" content="skippedInvalidCount=0">\\n' +
        '  <title>2FA Backup</title>\\n' +
        '  <style>\\n' +
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2937; background: #f8fafc; }\\n' +
        '    table { width: 100%; border-collapse: collapse; margin-top: 24px; background: #fff; }\\n' +
        '    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; }\\n' +
        '    th { background: #e2e8f0; }\\n' +
        '    code { word-break: break-all; }\\n' +
        '  </style>\\n' +
        '</head>\\n' +
        '<body data-skipped-invalid-count="0">\\n' +
        '  <h1>2FA 备份</h1>\\n' +
        '  <p>创建时间: ' + escapeHTML(exportTimestamp) + '</p>\\n' +
        '  <p>备份数量: ' + normalizedSecrets.length + '</p>\\n' +
        '  <table data-skipped-invalid-count="0">\\n' +
        '    <thead>\\n' +
        '      <tr>\\n' +
        '        <th>服务名称</th>\\n' +
        '        <th>账户信息</th>\\n' +
        '        <th>密钥</th>\\n' +
        '        <th>类型</th>\\n' +
        '        <th>位数</th>\\n' +
        '        <th>周期(秒)</th>\\n' +
        '        <th>算法</th>\\n' +
        '        <th>计数器</th>\\n' +
        '      </tr>\\n' +
        '    </thead>\\n' +
        '    <tbody>\\n' +
               rowsHtml +
        '    </tbody>\\n' +
        '  </table>\\n' +
        '  <script id="__2fa_backup_data__" type="application/json">' + embeddedPayload + '</script>\\n' +
        '</body>\\n' +
        '</html>';

      const saved = await downloadFile(htmlContent, filenamePrefix + '-backup-' + getDateString() + '.html', 'text/html;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'HTML');
      }
    }
`;
}
