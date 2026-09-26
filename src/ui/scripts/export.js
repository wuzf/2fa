/**
 * 导出模块
 * 包含所有导出功能，支持多种格式导出密钥
 */

import { getStandaloneHead } from '../standalone.js';
import { getBackupDocumentStyles } from '../styles/backupDocument.js';

/**
 * 获取导出相关代码
 * @returns {string} 导出 JavaScript 代码
 */
export function getExportCode() {
	return `    // ========== 导出模块 ==========

    function getSavedDefaultExportFormat() {
      return getCachedDefaultExportFormat();
    }

    function getDefaultExportFormatLabel(format) {
      const labels = {
        txt: 'TXT',
        json: 'JSON',
        csv: 'CSV',
        html: 'HTML'
      };
      return labels[format] || format.toUpperCase();
    }

    function updateDefaultExportButton(format = getSavedDefaultExportFormat()) {
      const defaultBtn = document.getElementById('exportUseDefaultBtn');
      if (!defaultBtn) {
        return;
      }

      defaultBtn.textContent = t('transferDefaultExport', { format: getDefaultExportFormatLabel(format) });
      defaultBtn.disabled = false;
    }

    // 导出所有密钥 - 显示格式选择
    async function syncDefaultExportButton() {
      updateDefaultExportButton();
      const format = await getServerDefaultExportFormat({ forceRefresh: true });
      updateDefaultExportButton(format);
      return format;
    }

    function exportAllSecrets() {
      if (secrets.length === 0) {
        showCenterToast('❌', t('transferNoExport'));
        return;
      }

      // 显示导出格式选择模态框
      showExportFormatModal();
    }

    // 显示导出格式选择模态框
    function showExportFormatModal() {
      showModal('exportFormatModal', () => {
        const exportCount = document.getElementById('exportCount');
        exportCount.textContent = secrets.length;
        syncExportHiddenNote();
        syncDefaultExportButton();
      });
    }

    // Accounts left out of the list because their data is invalid are not
    // exported either; the dialog says how many.
    function syncExportHiddenNote() {
      const summary = document.querySelector('#exportFormatModal .export-summary');
      if (!summary) return;
      const count = typeof getHiddenSecretsCount === 'function' ? getHiddenSecretsCount() : 0;
      let note = document.getElementById('exportHiddenNote');
      if (!note) {
        note = document.createElement('p');
        note.id = 'exportHiddenNote';
        note.className = 'export-hidden-note';
        note.setAttribute('role', 'note');
        note.style.cssText = 'margin: 8px 0 0; font-size: 13px; color: var(--text-secondary);';
        summary.insertAdjacentElement('afterend', note);
      }
      note.hidden = !count;
      if (count) setTranslatedText(note, 'transferExportHiddenNote', { count });
    }

    // 隐藏导出格式选择模态框
    function hideExportFormatModal() {
      hideModal('exportFormatModal');
    }

    async function exportUsingDefaultFormat() {
      const format = await getServerDefaultExportFormat({ forceRefresh: true });
      selectExportFormat(format);
    }

    // ==================== 二级格式选择配置 ====================

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
      },
      'bitwarden-auth-multi': {
        title: t('transferBitwardenFormat'),
        options: [
          {
            id: 'bitwarden-auth-csv',
            icon: '🔓',
            name: t('transferCSVFormat'),
            ext: '.csv',
            desc: t('transferCSVDesc'),
            compat: 'Bitwarden Authenticator'
          },
          {
            id: 'bitwarden-auth-json',
            icon: '🔓',
            name: t('transferJSONFormat'),
            ext: '.json',
            desc: t('transferJSONDesc'),
            compat: 'Bitwarden Authenticator'
          }
        ]
      }
    }; }

    // 显示二级格式选择模态框
    let currentSubFormatId = null;
    function showSubFormatModal(multiFormatId, refreshOnly = false) {
      currentSubFormatId = multiFormatId;
      const config = getSubFormatConfigs()[multiFormatId];
      if (!config) {
        console.error('未找到格式配置:', multiFormatId);
        return;
      }

      // 设置标题
      document.getElementById('subFormatTitle').textContent = config.title;

      // 生成选项列表
      const listContainer = document.getElementById('subFormatList');
      listContainer.innerHTML = '';

      config.options.forEach(option => {
        const optionEl = document.createElement('button');
        optionEl.type = 'button';
        optionEl.className = 'sub-format-option';
        optionEl.onclick = () => selectSubFormat(option.id);

        optionEl.innerHTML = \`
          <div class="sub-format-icon">\${dialogIcon('file')}</div>
          <div class="sub-format-info">
            <div class="sub-format-name">\${option.name}</div>
            <div class="sub-format-ext">\${option.ext}</div>
            <div class="sub-format-desc">\${option.desc}</div>
            <div class="sub-format-compat">\${option.compat}</div>
          </div>
        \`;

        listContainer.appendChild(optionEl);
      });

      // 显示模态框
      if (!refreshOnly) showModal('subFormatModal');
    }

    // 隐藏二级格式选择模态框
    function refreshExportTranslations() {
      updateDefaultExportButton();
      if (currentSubFormatId && document.getElementById('subFormatModal')?.classList.contains('show')) {
        showSubFormatModal(currentSubFormatId, true);
      }
    }

    function hideSubFormatModal() {
      hideModal('subFormatModal');
      // 返回主导出格式选择界面
      showModal('exportFormatModal');
    }

    // 选择子格式并执行导出
    function selectSubFormat(formatId) {
      // 直接关闭二级模态框，不返回主界面
      hideModal('subFormatModal');

      // 获取排序选项
      const sortSelect = document.getElementById('exportSortOrder');
      const sortValue = sortSelect ? sortSelect.value : 'index-asc';

      // 复制并排序密钥
      const secretsToExport = sortSecretsForExport([...secrets], sortValue);

      // 执行导出
      exportSecretsAsFormat(secretsToExport, formatId);
    }

    // 选择导出格式并执行导出
    function selectExportFormat(format) {
      // 检查是否为多格式选项
      if (getSubFormatConfigs()[format]) {
        // 显示二级选择模态框
        hideExportFormatModal();
        showSubFormatModal(format);
        return;
      }

      // 单一格式，直接导出
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
            // 按服务名称排序（不区分大小写）
            valueA = (a.name || '').toLowerCase();
            valueB = (b.name || '').toLowerCase();
            break;
          case 'account':
            // 按账户名称排序（不区分大小写）
            valueA = (a.account || '').toLowerCase();
            valueB = (b.account || '').toLowerCase();
            break;
          default:
            return 0;
        }

        // 比较
        if (valueA < valueB) return isAsc ? -1 : 1;
        if (valueA > valueB) return isAsc ? 1 : -1;
        return 0;
      });
    }

    // ==================== 通用导出函数 ====================
    /**
     * 通用导出函数 - 可被其他模块复用
     * @param {Array} secretsData - 要导出的密钥数组
     * @param {string} format - 导出格式 ('txt', 'json', 'csv', 'html')
     * @param {Object} options - 可选参数
     * @param {string} options.filenamePrefix - 文件名前缀，默认 '2FA-secrets'
     * @param {string} options.source - 数据来源，如 'backup'
     * @param {string} options.metadata - 附加元数据
     */
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
          // Google Authenticator 导出使用专门的模态框
          showExportToGoogleModal();
          break;
        case 'aegis':
          exportAsAegis(secretsData, opts);
          break;
        case '2fas':
          exportAs2FAS(secretsData, opts);
          break;
        case 'andotp':
          exportAsAndOTP(secretsData, opts);
          break;
        case 'freeotp-plus':
          exportAsFreeOTPPlusJSON(secretsData, opts);
          break;
        case 'freeotp':
          // FreeOTP 原版需要密码，显示模态框
          showFreeOTPExportModal();
          break;
        case 'totp-auth':
          // TOTP Authenticator 需要密码，显示模态框
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
          // Ente Auth 使用标准 OTPAuth TXT 格式
          await exportAsOTPAuth(secretsData, { formatName: 'ente-auth' });
          break;
        case 'winauth':
          // WinAuth 使用标准 OTPAuth TXT 格式
          await exportAsOTPAuth(secretsData, { formatName: 'winauth' });
          break;
        case 'aegis-txt':
          // Aegis TXT 使用标准 OTPAuth TXT 格式
          await exportAsOTPAuth(secretsData, { formatName: 'aegis-txt' });
          break;
        case 'authenticator-txt':
          // Authenticator Pro TXT 使用标准 OTPAuth TXT 格式
          await exportAsOTPAuth(secretsData, { formatName: 'authpro-txt' });
          break;
        case 'freeotp-txt':
          // FreeOTP TXT 使用标准 OTPAuth TXT 格式
          await exportAsOTPAuth(secretsData, { formatName: 'freeotp-txt' });
          break;
        default:
          showCenterToast('❌', t('transferUnsupportedExport'));
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
          throw new Error(t('transferUnsupportedExport'));
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
        showCenterToast('INFO', t('transferPreparingExport'));

        const response = await authenticatedFetch('/api/secrets/export', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            format: format,
            language: getLanguage(),
            filenamePrefix: options.filenamePrefix || '2FA-secrets',
            metadata: options.metadata || {},
            secrets: sortedSecrets
          })
        });

        if (response.status === 202) {
          let errorMessage = t('transferOnlineRequired');
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
          let errorMessage = t('transferExportFailed');
          let errorData = null;

          try {
            errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch {
            // ignore non-JSON error responses
          }

          if (shouldFallbackToLocalStandardExport(response.status, errorData)) {
            const fallbackMessage = response.status === 413
              ? t('transferLargeLocalExport')
              : t('transferOfflineLocalExport');
            await fallbackToLocalExport(fallbackMessage);
            return;
          }

          throw new Error(errorMessage);
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        if (!contentDisposition) {
          throw new Error(t('transferMissingDownload'));
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
        const errorMessage = error && error.message ? error.message : t('transferExportFailed');
        const isNetworkFailure = error && (error.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(errorMessage));

        if (isNetworkFailure) {
          await fallbackToLocalExport(t('transferNetworkLocalExport'));
          return;
        }

        console.error('Export failed:', error);
        showCenterToast('ERR', t('transferExportFailedPrefixASCII') + errorMessage);
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
      const formatName = options.formatName || 'otpauth';  // 格式标识，默认 'otpauth'
      const otpauthUrls = sortedSecrets.map(secret => buildLocalOTPAuthUrl(secret));

      const content = otpauthUrls.join('\\n');
      const saved = await downloadFile(content, filenamePrefix + '-' + formatName + '-' + getDateString() + '.txt', 'text/plain;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, t('transferOTPAuthText'));
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
            secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
            type: type,
            digits: secret.digits || 6,
            period: secret.period || 30,
            algorithm: secret.algorithm || 'SHA1'
          };
          // HOTP 类型才需要 counter
          if (type.toUpperCase() === 'HOTP') {
            entry.counter = secret.counter || 0;
          }
          return entry;
        })
      };

      // 添加元数据（如果有）
      if (options.metadata) {
        exportData.metadata = options.metadata;
      }

      const content = JSON.stringify(exportData, null, 2);
      const saved = await downloadFile(content, filenamePrefix + '-data-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, t('transferJSONData'));
      }
    }

    // 导出为 CSV 格式
    async function exportAsCSV(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      // CSV header
      const headers = [t('transferService'), t('transferAccountInfo'), t('transferSecret'), t('transferType'), t('transferDigits'), t('transferPeriodSeconds'), t('transferAlgorithm'), t('transferCounter')];
      const csvRows = [headers.map(escapeCSV).join(',')];

      // CSV rows
      sortedSecrets.forEach(secret => {
        const type = (secret.type || 'TOTP').toUpperCase();
        const row = [
          escapeCSV(secret.name),
          escapeCSV(secret.account || ''),
          escapeCSV(secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase()),
          escapeCSV(secret.type || 'TOTP'),
          secret.digits || 6,
          secret.period || 30,
          escapeCSV(secret.algorithm || 'SHA1'),
          type === 'HOTP' ? (secret.counter || 0) : ''
        ];
        csvRows.push(row.join(','));
      });

      const content = csvRows.join('\\n');
      // 添加 BOM 以确保 Excel 正确识别 UTF-8
      const bom = '\\uFEFF';
      const saved = await downloadFile(bom + content, filenamePrefix + '-table-' + getDateString() + '.csv', 'text/csv;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, t('transferCSVTable'));
      }
    }

    // ==================== 第三方验证器格式导出 ====================

    /**
     * 导出为 Aegis Authenticator 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsHTML(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const exportDate = new Date();
      const exportTimestamp = exportDate.toISOString();
      const MAX_EMBEDDED_QR_SECRETS = 250;
      const shouldEmbedQRCodes = sortedSecrets.length <= MAX_EMBEDDED_QR_SECRETS;

      try {
        showCenterToast('📋', t('transferPreparingData'));

        const invalidSecrets = [];
        const secretsData = sortedSecrets.map((secret, index) => {
          const normalizedSecret = String(secret.secret || '').replace(/[\\s\\-+]/g, '').toUpperCase();
          if (!normalizedSecret || !validateBase32(normalizedSecret)) {
            invalidSecrets.push({
              index: index + 1,
              name: String(secret.name || '').trim()
            });
            return null;
          }

          const serviceName = String(secret.name || 'Unknown').trim() || 'Unknown';
          const accountName = secret.account ? String(secret.account).trim() : '';
          const type = String(secret.type || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP';
          const normalizedEntry = {
            ...secret,
            secret: normalizedSecret,
            type,
            digits: secret.digits || 6,
            period: secret.period || 30,
            algorithm: String(secret.algorithm || 'SHA1').toUpperCase(),
            counter: secret.counter || 0
          };
          const label = accountName
            ? encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName)
            : encodeURIComponent(serviceName);

          const params = new URLSearchParams({
            secret: normalizedSecret,
            digits: String(normalizedEntry.digits),
            algorithm: normalizedEntry.algorithm,
            issuer: serviceName
          });

          let otpauthUrl;
          if (type === 'HOTP') {
            params.set('counter', String(secret.counter || 0));
            otpauthUrl = 'otpauth://hotp/' + label + '?' + params.toString();
          } else {
            params.set('period', String(secret.period || 30));
            otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
          }

          return {
            serviceName,
            accountName,
            secret: normalizedEntry,
            type,
            otpauthUrl
          };
        }).filter(Boolean);
        const skippedInvalidCount = invalidSecrets.length;

        if (skippedInvalidCount > 0) {
          const preview = invalidSecrets
            .slice(0, 3)
            .map(item => t('transferInvalidExportItem', { index: item.index, name: item.name ? " (" + item.name + ")" : "" }))
            .join('；');
          const remainingCount = skippedInvalidCount - Math.min(skippedInvalidCount, 3);
          throw new Error(
            t('transferInvalidExport') +
              preview +
              (remainingCount > 0 ? t('transferMoreInvalid', { count: remainingCount }) : '')
          );
        }

        const embeddedPayload = escapeHTML(JSON.stringify({
          version: '1.0',
          format: 'html',
          timestamp: exportTimestamp,
          reason: options.source || 'export',
          count: secretsData.length,
          skippedInvalidCount: 0,
          secrets: secretsData.map(data => ({
            name: data.secret.name || 'Unknown',
            account: data.secret.account || '',
            secret: data.secret.secret,
            type: data.secret.type,
            digits: data.secret.digits,
            period: data.secret.period,
            algorithm: data.secret.algorithm,
            counter: data.secret.counter || 0
          }))
        }, null, 2));

        const qrDataUrls = [];

        if (shouldEmbedQRCodes) {
          await waitForQRCodeLibrary();

          const BATCH_SIZE = 10;
          const totalCount = secretsData.length;

          for (let i = 0; i < secretsData.length; i += BATCH_SIZE) {
            const batch = secretsData.slice(i, i + BATCH_SIZE);
            showCenterToast('⏳', t('transferQRProgress', { count: i + batch.length, total: totalCount }));

            const batchQrUrls = await Promise.all(
              batch.map(data => generateQRCodeDataURL(data.otpauthUrl))
            );

            qrDataUrls.push(...batchQrUrls);
          }
        } else {
          showCenterToast('ℹ️', t('transferQRLimit'));
        }

        showCenterToast('🔨', t('transferGeneratingHTML'));

        const qrDescription = shouldEmbedQRCodes
          ? t('transferQRHelp')
          : t('transferQROmittedDetails', { count: sortedSecrets.length, limit: MAX_EMBEDDED_QR_SECRETS });
        const formatLabel = shouldEmbedQRCodes ? t('transferHTMLWithQR') : t('transferHTMLWithoutQR');
        const qrPlaceholder = t('transferQROmitted');

        const rowsHtml = secretsData.map((data, index) => {
          const qrCellHtml = shouldEmbedQRCodes
            ? '<img src="' + qrDataUrls[index] + '" alt="' + escapeHTML(t('transferQRTitle', { name: data.serviceName })) + '">'
            : '<span class="qr-placeholder">' + qrPlaceholder + '</span>';

          return '        <tr>\\n' +
            '          <td class="service">' + escapeHTML(data.serviceName) + '</td>\\n' +
            '          <td class="account">' + escapeHTML(data.accountName || '') + '</td>\\n' +
            '          <td><code>' + escapeHTML((data.secret.secret || '').replace(/[\\s\\-+]/g, '').toUpperCase()) + '</code></td>\\n' +
            '          <td class="param">' + escapeHTML(data.type) + '</td>\\n' +
            '          <td class="param">' + (data.secret.digits || 6) + '</td>\\n' +
            '          <td class="param">' + (data.secret.period || 30) + '</td>\\n' +
            '          <td class="param">' + escapeHTML((data.secret.algorithm || 'SHA1').toUpperCase()) + '</td>\\n' +
            '          <td class="param">' + (data.secret.counter || 0) + '</td>\\n' +
            '          <td class="qr-cell">' + qrCellHtml + '</td>\\n' +
            '        </tr>\\n';
        }).join('');

        const htmlContent = '<!DOCTYPE html>\\n' +
          '<html lang="' + escapeHTML(getLanguage()) + '">\\n' +
          '<head>\\n' +
          ${JSON.stringify(getStandaloneHead('__BACKUP_DOCUMENT_TITLE__', getBackupDocumentStyles())).replace(/</g, '\\u003c')}.replace('__BACKUP_DOCUMENT_TITLE__', escapeHTML(t('transferBackupTitle'))) +
          '  <meta name="2fa-backup-meta" content="skippedInvalidCount=0">\\n' +
          '  <meta name="robots" content="noindex, nofollow">\\n' +
          '  <meta name="googlebot" content="noindex, nofollow">\\n' +
          '</head>\\n' +
          '<body data-skipped-invalid-count="0">\\n' +
          '  <main class="backup-document">\\n' +
          '    <header class="document-header"><h1>' + escapeHTML(t('transferBackupTitle')) + '</h1>\\n' +
          '    <div class="meta">\\n' +
          '      <p>' + escapeHTML(t('transferExportTime')) + formatI18nDate(exportDate, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}) + '</p>\\n' +
          '      <p>' + escapeHTML(t('transferKeyCount')) + sortedSecrets.length + escapeHTML(t('transferCountUnit')) + '</p>\\n' +
          '      <p>' + escapeHTML(t('transferFormatLabel')) + escapeHTML(formatLabel) + '</p>\\n' +
          '      <p>' + escapeHTML(qrDescription) + '</p>\\n' +
          '    </div>\\n' +
          '    </header>\\n' +
          '    <div class="table-scroll" role="region" aria-label="' + escapeHTML(t('transferBackupTable')) + '" tabindex="0">\\n' +
          '    <table data-skipped-invalid-count="0">\\n' +
          '      <thead>\\n' +
          '        <tr>\\n' +
          '          <th>' + escapeHTML(t('transferService')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferAccount')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferSecret')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferType')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferDigits')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferPeriod')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferAlgorithm')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferCounter')) + '</th>\\n' +
          '          <th>' + escapeHTML(t('transferQRCode')) + '</th>\\n' +
          '        </tr>\\n' +
          '      </thead>\\n' +
          '      <tbody>\\n' +
                 rowsHtml +
          '      </tbody>\\n' +
          '    </table>\\n' +
          '    </div>\\n' +
          '    <div class="footer">\\n' +
          '      ' + escapeHTML(t('transferGeneratedBy')) + '<a href="https://github.com/wuzf" target="_blank" rel="noopener noreferrer">wuzf</a> | ' +
          '      <a href="https://github.com/wuzf/2fa" target="_blank" rel="noopener noreferrer">2FA</a> | ' +
                 exportTimestamp + '\\n' +
          '    </div>\\n' +
          '    <script id="__2fa_backup_data__" type="application/json">' + embeddedPayload + '<' + '/script>\\n' +
          '  </main>\\n' +
          '</body>\\n' +
          '</html>';

        const saved = await downloadFile(htmlContent, filenamePrefix + '-backup-' + getDateString() + '.html', 'text/html;charset=utf-8');
        if (saved) {
          showExportSuccess(sortedSecrets.length, t('transferHTMLPage'));
        }
      } catch (error) {
        console.error('HTML导出失败:', error);
        showCenterToast('❌', t('transferHTMLFailed') + error.message);
      }
    }

    async function exportAsAegis(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';

      // 生成 UUID v4
      function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }

      const entries = sortedSecrets.map(secret => {
        const type = (secret.type || 'TOTP').toLowerCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();

        const entry = {
          type: type,
          uuid: generateUUID(),
          name: secret.account || secret.name || '',
          issuer: secret.name || '',
          note: '',
          favorite: false,
          icon: null,
          info: {
            secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
            algo: algo,
            digits: secret.digits || 6,
            period: secret.period || 30
          }
        };

        // HOTP 类型需要 counter
        if (type === 'hotp') {
          entry.info.counter = secret.counter || 0;
        }

        return entry;
      });

      const exportData = {
        version: 1,
        header: {
          slots: null,
          params: null
        },
        db: {
          version: 2,
          entries: entries
        }
      };

      const content = JSON.stringify(exportData, null, 2);
      const saved = await downloadFile(content, filenamePrefix + '-aegis-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'Aegis');
      }
    }

    /**
     * 导出为 2FAS Authenticator 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAs2FAS(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      const now = Date.now();

      // 生成图标首字母（取服务名前两个字符的大写）
      function getIconText(name) {
        if (!name) return 'XX';
        const cleaned = name.replace(/[^a-zA-Z0-9]/g, '');
        return cleaned.substring(0, 2).toUpperCase() || 'XX';
      }

      // 背景颜色列表
      const bgColors = ['Default', 'Yellow', 'Orange', 'Red', 'Pink', 'Purple', 'Blue', 'Turquoise', 'Green', 'Brown'];

      const services = sortedSecrets.map((secret, index) => {
        const tokenType = (secret.type || 'TOTP').toUpperCase();
        const algorithm = (secret.algorithm || 'SHA1').toUpperCase();

        return {
          name: secret.name || '',
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          updatedAt: now,
          otp: {
            label: secret.account || '',
            account: secret.account || '',
            issuer: secret.name || '',
            digits: secret.digits || 6,
            period: secret.period || 30,
            algorithm: algorithm,
            tokenType: tokenType,
            source: 'Link',
            counter: tokenType === 'HOTP' ? (secret.counter || 0) : undefined
          },
          order: {
            position: index
          },
          icon: {
            selected: 'Label',
            label: {
              text: getIconText(secret.name),
              backgroundColor: bgColors[index % bgColors.length]
            }
          }
        };
      });

      const exportData = {
        services: services,
        groups: [],
        updatedAt: now,
        schemaVersion: 4,
        appVersionCode: 5000000,
        appVersionName: '5.0.0',
        appOrigin: 'web'
      };

      const content = JSON.stringify(exportData, null, 2);
      // 2FAS 使用 .2fas 扩展名
      const saved = await downloadFile(content, filenamePrefix + '-2fas-' + getDateString() + '.2fas', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, '2FAS');
      }
    }

    /**
     * 导出为 andOTP 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsAndOTP(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';

      const entries = sortedSecrets.map(secret => {
        const type = (secret.type || 'TOTP').toUpperCase();
        const algorithm = (secret.algorithm || 'SHA1').toUpperCase();

        const entry = {
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          issuer: secret.name || '',
          label: secret.account || '',
          digits: secret.digits || 6,
          type: type,
          algorithm: algorithm,
          thumbnail: 'Default',
          last_used: 0,
          used_frequency: 0,
          period: secret.period || 30
        };

        // HOTP 类型需要 counter
        if (type === 'HOTP') {
          entry.counter = secret.counter || 0;
        }

        return entry;
      });

      const content = JSON.stringify(entries, null, 2);
      const saved = await downloadFile(content, filenamePrefix + '-andotp-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'andOTP');
      }
    }

    /**
     * 导出为 FreeOTP+ 格式 (JSON，无加密)
     * FreeOTP+ 是 FreeOTP 的增强版，支持直接导入 JSON 文件
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsFreeOTPPlusJSON(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';

      // Base32 解码函数 - 返回有符号字节数组（Java 格式）
      function base32ToSignedBytes(base32) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanedInput = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');

        let bits = 0;
        let value = 0;
        const output = [];

        for (let i = 0; i < cleanedInput.length; i++) {
          const idx = alphabet.indexOf(cleanedInput[i]);
          if (idx === -1) continue;

          value = (value << 5) | idx;
          bits += 5;

          if (bits >= 8) {
            bits -= 8;
            const byte = (value >> bits) & 0xff;
            // 转换为有符号字节（-128 到 127）
            output.push(byte > 127 ? byte - 256 : byte);
          }
        }

        return output;
      }

      // 生成 tokenOrder 数组
      const tokenOrder = sortedSecrets.map(secret => {
        const issuer = secret.name || '';
        const label = secret.account || '';
        return issuer + ':' + label;
      });

      const tokens = sortedSecrets.map(secret => {
        const type = (secret.type || 'TOTP').toUpperCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();

        const token = {
          algo: algo,
          counter: type === 'HOTP' ? (secret.counter || 0) : 0,
          digits: secret.digits || 6,
          issuerExt: secret.name || '',
          label: secret.account || '',
          period: secret.period || 30,
          secret: base32ToSignedBytes(secret.secret),
          type: type
        };

        return token;
      });

      const exportData = {
        tokenOrder: tokenOrder,
        tokens: tokens
      };

      // FreeOTP+ 使用紧凑 JSON 格式（无缩进）
      const content = JSON.stringify(exportData);
      const saved = await downloadFile(content, filenamePrefix + '-freeotp-plus-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'FreeOTP+');
      }
    }

    /**
     * 导出为 LastPass Authenticator 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsLastPass(sortedSecrets, options = {}) {
      if (sortedSecrets.some(secret => String(secret.type || 'TOTP').toUpperCase() === 'HOTP')) {
        showCenterToast('❌', t('transferLastPassHOTP'));
        return false;
      }
      const filenamePrefix = options.filenamePrefix || 'LastPass Authenticator';

      // 生成 UUID v4
      function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }

      const accounts = sortedSecrets.map((secret, index) => {
        const algo = (secret.algorithm || 'SHA1').toUpperCase();

        return {
          accountID: '',
          lmiUserId: '',
          issuerName: secret.name || '',
          originalIssuerName: secret.name || '',
          userName: secret.account || '',
          originalUserName: secret.account || '',
          pushNotification: false,
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          timeStep: secret.period || 30,
          digits: secret.digits || 6,
          creationTimestamp: Date.now(),
          isFavorite: false,
          algorithm: algo,
          folderData: {
            folderId: 0,
            position: index
          }
        };
      });

      const exportData = {
        deviceId: '',
        deviceSecret: '',
        localDeviceId: generateUUID(),
        deviceName: 'Web Export',
        version: 3,
        accounts: accounts,
        folders: [
          { id: 1, name: 'Favorites', isOpened: true },
          { id: 0, name: 'Other accounts', isOpened: true }
        ],
        backupInfo: {
          creationDate: new Date().toISOString().replace('Z', ''),
          deviceOS: 'web',
          appVersion: '2.25.0'
        }
      };

      const content = JSON.stringify(exportData);
      const saved = await downloadFile(content, filenamePrefix + '-lastpass-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'LastPass Authenticator');
      }
    }

    /**
     * 导出为 Proton Authenticator 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsProtonAuthenticator(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';

      // 生成 UUID v4
      function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }

      const entries = sortedSecrets.map(secret => {
        const serviceName = secret.name ? secret.name.trim() : '';
        const accountName = secret.account ? secret.account.trim() : '';
        const type = (secret.type || 'TOTP').toLowerCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();

        // 构建 otpauth:// URI
        let label = encodeURIComponent(accountName || serviceName);

        const params = new URLSearchParams({
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          issuer: serviceName,
          algorithm: algo,
          digits: (secret.digits || 6).toString(),
          period: (secret.period || 30).toString()
        });

        if (type === 'hotp') {
          params.delete('period');
          params.set('counter', String(secret.counter || 0));
        }
        const uri = 'otpauth://' + type + '/' + label + '?' + params.toString();

        return {
          id: generateUUID(),
          content: {
            uri: uri,
            entry_type: type.charAt(0).toUpperCase() + type.slice(1),
            name: accountName || serviceName
          },
          note: null
        };
      });

      const exportData = {
        version: 1,
        entries: entries
      };

      const content = JSON.stringify(exportData);
      const saved = await downloadFile(content, filenamePrefix + '-proton-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'Proton Authenticator');
      }
    }

    /**
     * 导出为 Authenticator Pro (Stratum) 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsAuthenticatorPro(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || 'backup';

      // Algorithm 映射: SHA1=0, SHA256=1, SHA512=2
      const algoMap = { 'SHA1': 0, 'SHA256': 1, 'SHA512': 2 };
      // Type 映射: hotp=1, totp=2
      const typeMap = { 'hotp': 1, 'totp': 2 };

      const authenticators = sortedSecrets.map((secret, index) => {
        const serviceName = secret.name ? secret.name.trim() : '';
        const accountName = secret.account ? secret.account.trim() : '';
        const type = (secret.type || 'TOTP').toLowerCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();
        const digits = secret.digits || 6;
        const period = secret.period || 30;

        return {
          Type: typeMap[type] || 2,
          Icon: null,
          Issuer: serviceName,
          Username: accountName,
          Secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          Pin: null,
          Algorithm: algoMap[algo] !== undefined ? algoMap[algo] : 0,
          Digits: digits,
          Period: period,
          Counter: type === 'hotp' ? (secret.counter || 0) : 0,
          CopyCount: 0,
          Ranking: index
        };
      });

      const exportData = {
        Authenticators: authenticators,
        Categories: [],
        AuthenticatorCategories: [],
        CustomIcons: []
      };

      const content = JSON.stringify(exportData);
      const saved = await downloadFile(content, filenamePrefix + '-authpro-' + getDateString() + '.authpro', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'Authenticator Pro');
      }
    }

    /**
     * 导出为 Bitwarden Authenticator CSV 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsBitwardenAuthenticatorCSV(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';
      // CSV header
      const headers = ['folder', 'favorite', 'type', 'name', 'login_uri', 'login_totp'];
      const csvRows = [headers.join(',')];

      sortedSecrets.forEach(secret => {
        const serviceName = secret.name ? secret.name.trim() : '';
        const accountName = secret.account ? secret.account.trim() : '';
        const type = (secret.type || 'TOTP').toLowerCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();
        const digits = secret.digits || 6;
        const period = secret.period || 30;

        // 构建 otpauth:// URI
        let label;
        if (serviceName && accountName) {
          label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
        } else if (serviceName) {
          label = encodeURIComponent(serviceName);
        } else if (accountName) {
          label = encodeURIComponent(accountName);
        } else {
          label = 'Unknown';
        }

        const params = new URLSearchParams({
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          algorithm: algo,
          digits: digits.toString(),
          period: period.toString(),
          issuer: serviceName
        });

        if (type === 'hotp') {
          params.delete('period');
          params.set('counter', String(secret.counter || 0));
        }
        const otpauthUrl = 'otpauth://' + type + '/' + label + '?' + params.toString();

        // Keep each row aligned with the six-column header; OTP parameters live in the URI.
        const row = [
          '',                    // folder
          '',                    // favorite
          '1',                   // type (1 = login)
          serviceName,           // name
          '',                    // login_uri
          otpauthUrl              // login_totp
        ];

        csvRows.push(row.map(escapeCSV).join(','));
      });

      const content = csvRows.join('\\n');
      const saved = await downloadFile(content, filenamePrefix + '-bitwarden-auth-' + getDateString() + '.csv', 'text/csv;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'Bitwarden Authenticator CSV');
      }
    }

    /**
     * 导出为 Bitwarden Authenticator JSON 格式
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {Object} options - 导出选项
     */
    async function exportAsBitwardenAuthenticatorJSON(sortedSecrets, options = {}) {
      const filenamePrefix = options.filenamePrefix || '2FA-secrets';

      // 生成 UUID v4
      function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }

      const items = sortedSecrets.map(secret => {
        const serviceName = secret.name ? secret.name.trim() : '';
        const accountName = secret.account ? secret.account.trim() : '';
        const type = (secret.type || 'TOTP').toLowerCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();
        const digits = secret.digits || 6;
        const period = secret.period || 30;

        // 构建 otpauth:// URI
        let label;
        if (serviceName && accountName) {
          label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
        } else if (serviceName) {
          label = encodeURIComponent(serviceName);
        } else if (accountName) {
          label = encodeURIComponent(accountName);
        } else {
          label = 'Unknown';
        }

        const params = new URLSearchParams({
          secret: secret.secret.replace(/[\\s\\-+]/g, '').toUpperCase(),
          algorithm: algo,
          digits: digits.toString(),
          period: period.toString(),
          issuer: serviceName
        });

        if (type === 'hotp') {
          params.delete('period');
          params.set('counter', String(secret.counter || 0));
        }
        const otpauthUrl = 'otpauth://' + type + '/' + label + '?' + params.toString();

        return {
          id: generateUUID(),
          name: serviceName,
          folderId: null,
          organizationId: null,
          collectionIds: null,
          notes: null,
          type: 1,
          login: {
            totp: otpauthUrl
          },
          favorite: false
        };
      });

      const exportData = {
        encrypted: false,
        items: items
      };

      const content = JSON.stringify(exportData);
      const saved = await downloadFile(content, filenamePrefix + '-bitwarden-auth-' + getDateString() + '.json', 'application/json;charset=utf-8');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'Bitwarden Authenticator JSON');
      }
    }

    /**
     * 显示 FreeOTP 原版导出密码输入模态框
     */
    function showFreeOTPExportModal() {
      showModal('freeotpExportModal', () => {
        const countEl = document.getElementById('freeotpExportCount');
        if (countEl) countEl.textContent = secrets.length;
        const passwordInput = document.getElementById('freeotpExportPassword');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }

    /**
     * 隐藏 FreeOTP 原版导出模态框
     */
    function hideFreeOTPExportModal() {
      hideModal('freeotpExportModal');
    }

    /**
     * 执行 FreeOTP 原版加密导出
     */
    async function executeFreeOTPExport() {
      const password = document.getElementById('freeotpExportPassword').value;
      if (!password) {
        showCenterToast('❌', t('transferEncryptionPassword'));
        return;
      }

      try {
        showCenterToast('⏳', t('transferEncryptingBackup'));

        // 获取排序后的密钥
        const sortSelect = document.getElementById('exportSortOrder');
        const sortValue = sortSelect ? sortSelect.value : 'index-asc';
        const secretsToExport = sortSecretsForExport([...secrets], sortValue);

        await exportAsFreeOTPEncrypted(secretsToExport, password);
        hideFreeOTPExportModal();
      } catch (error) {
        showCenterToast('❌', t('transferExportFailedPrefix') + error.message);
      }
    }

    /**
     * 导出为 FreeOTP 原版格式 (加密的 Java 序列化 HashMap)
     * FreeOTP 原版使用 AES-GCM 加密，需要用户提供密码
     * 生成的文件可直接被 FreeOTP 应用导入
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {string} password - 加密密码
     */
    async function exportAsFreeOTPEncrypted(sortedSecrets, password) {
      const filenamePrefix = '2FA-secrets';

      // 生成 UUID v4
      function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }

      // 将 Uint8Array 转换为有符号字节数组（Java 格式）
      function toSignedBytes(uint8Array) {
        return Array.from(uint8Array).map(b => b > 127 ? b - 256 : b);
      }

      // Base32 解码
      function base32Decode(base32) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanedInput = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');

        let bits = 0;
        let value = 0;
        const output = [];

        for (let i = 0; i < cleanedInput.length; i++) {
          const idx = alphabet.indexOf(cleanedInput[i]);
          if (idx === -1) continue;

          value = (value << 5) | idx;
          bits += 5;

          if (bits >= 8) {
            bits -= 8;
            output.push((value >> bits) & 0xff);
          }
        }

        return new Uint8Array(output);
      }

      // 生成 ASN.1 格式的 GCM 参数 (30 11 04 0c [12字节IV] 02 01 10)
      function generateGCMParams(iv) {
        const params = new Uint8Array(19);
        params[0] = 0x30; // SEQUENCE
        params[1] = 0x11; // Length 17
        params[2] = 0x04; // OCTET STRING
        params[3] = 0x0c; // Length 12 (IV)
        params.set(iv, 4); // 12 bytes IV
        params[16] = 0x02; // INTEGER
        params[17] = 0x01; // Length 1
        params[18] = 0x10; // Value 16 (tag length in bytes)
        return params;
      }

      // 1. 生成随机 salt 和 masterKey
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const rawMasterKey = crypto.getRandomValues(new Uint8Array(32));
      const iterations = 100000;

      // 2. 使用 PBKDF2 从密码派生密钥
      const passwordBytes = new TextEncoder().encode(password);
      const passwordKey = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );

      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: iterations,
          hash: 'SHA-512'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );

      // 3. 加密 masterKey
      const masterKeyIv = crypto.getRandomValues(new Uint8Array(12));
      const masterKeyAad = new TextEncoder().encode('AES');

      const encryptedMasterKeyBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: masterKeyIv,
          additionalData: masterKeyAad
        },
        derivedKey,
        rawMasterKey
      );

      // 4. 导入 masterKey 用于加密 tokens
      const masterKey = await crypto.subtle.importKey(
        'raw',
        rawMasterKey,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      // 5. 准备 tokens 数据
      const tokensData = [];

      for (const secret of sortedSecrets) {
        const uuid = generateUUID();
        const type = (secret.type || 'TOTP').toUpperCase();
        const algo = (secret.algorithm || 'SHA1').toUpperCase();

        // Token 元数据 (明文)
        const tokenMeta = {
          algo: algo,
          digits: secret.digits || 6,
          issuerExt: secret.name || '',
          label: secret.account || '',
          period: secret.period || 30,
          type: type,
          ...(type === 'HOTP' ? { counter: secret.counter || 0 } : {})
        };

        // 解码 secret 为字节
        const secretBytes = base32Decode(secret.secret);

        // 加密 secret
        const tokenIv = crypto.getRandomValues(new Uint8Array(12));
        const tokenAad = new TextEncoder().encode('HmacSHA1');

        const encryptedSecretBuffer = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: tokenIv,
            additionalData: tokenAad
          },
          masterKey,
          secretBytes
        );

        // 构建加密密钥数据
        const encryptedKey = {
          mCipher: 'AES/GCM/NoPadding',
          mCipherText: toSignedBytes(new Uint8Array(encryptedSecretBuffer)),
          mParameters: toSignedBytes(generateGCMParams(tokenIv)),
          mToken: 'HmacSHA1'
        };

        tokensData.push({
          uuid: uuid,
          meta: tokenMeta,
          encryptedKey: encryptedKey
        });
      }

      // 6. 构建 masterKey 结构
      const masterKeyData = {
        mAlgorithm: 'PBKDF2withHmacSHA512',
        mEncryptedKey: {
          mCipher: 'AES/GCM/NoPadding',
          mCipherText: toSignedBytes(new Uint8Array(encryptedMasterKeyBuffer)),
          mParameters: toSignedBytes(generateGCMParams(masterKeyIv)),
          mToken: 'AES'
        },
        mIterations: iterations,
        mSalt: toSignedBytes(salt)
      };

      // 7. 生成 Java 序列化格式的内容
      const output = generateJavaSerializedHashMap(tokensData, masterKeyData);

      // 8. 下载文件
      const saved = await downloadFile(output, filenamePrefix + '-freeotp-' + getDateString() + '.xml', 'application/octet-stream');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'FreeOTP');
      }
    }

    /**
     * 生成 Java 序列化格式的 HashMap
     * 精确模拟 FreeOTP 备份格式
     */
    function generateJavaSerializedHashMap(tokensData, masterKeyData) {
      const parts = [];

      // Java 序列化头部 (与原始文件完全匹配)
      // AC ED 00 05 73 72 00 11
      const header = new Uint8Array([
        0xac, 0xed, // STREAM_MAGIC
        0x00, 0x05, // STREAM_VERSION
        0x73,       // TC_OBJECT
        0x72,       // TC_CLASSDESC
        0x00, 0x11, // class name length: 17
      ]);
      parts.push(header);

      // 类名 "java.util.HashMap"
      const className = new TextEncoder().encode('java.util.HashMap');
      parts.push(className);

      // serialVersionUID (必须与 Java HashMap 完全匹配)
      // 05 07 DA C1 C3 16 60 D1
      const serialVersionUID = new Uint8Array([
        0x05, 0x07, 0xda, 0xc1, 0xc3, 0x16, 0x60, 0xd1
      ]);
      parts.push(serialVersionUID);

      // classDescFlags + fieldCount
      parts.push(new Uint8Array([
        0x03,       // SC_WRITE_METHOD | SC_SERIALIZABLE
        0x00, 0x02  // fieldCount: 2
      ]));

      // 字段 1: float loadFactor
      parts.push(new Uint8Array([0x46])); // 'F'
      parts.push(new Uint8Array([0x00, 0x0a])); // length: 10
      parts.push(new TextEncoder().encode('loadFactor'));

      // 字段 2: int threshold
      parts.push(new Uint8Array([0x49])); // 'I'
      parts.push(new Uint8Array([0x00, 0x09])); // length: 9
      parts.push(new TextEncoder().encode('threshold'));

      // TC_ENDBLOCKDATA + TC_NULL (no superclass)
      parts.push(new Uint8Array([0x78, 0x70]));

      // loadFactor 值 (0.75f = 0x3f400000)
      parts.push(new Uint8Array([0x3f, 0x40, 0x00, 0x00]));

      // threshold 值 (12)
      parts.push(new Uint8Array([0x00, 0x00, 0x00, 0x0c]));

      // TC_BLOCKDATA + size 8
      parts.push(new Uint8Array([0x77, 0x08]));

      // capacity = 16
      parts.push(new Uint8Array([0x00, 0x00, 0x00, 0x10]));

      // size = 实际条目数 (每个token有2个条目 + masterKey)
      const entryCount = tokensData.length * 2 + 1;
      parts.push(new Uint8Array([
        (entryCount >> 24) & 0xff,
        (entryCount >> 16) & 0xff,
        (entryCount >> 8) & 0xff,
        entryCount & 0xff
      ]));

      // 写入每个 token 的数据
      for (const token of tokensData) {
        // 1. 写入 uuid -> encryptedKey (JSON字符串)
        // Java JSON 会转义斜杠 / 为 \/，需要手动构建避免双重转义
        parts.push(writeJavaString(token.uuid));

        // 内层 JSON：加密密钥数据，斜杠转义为 \/
        let innerJson = JSON.stringify(token.encryptedKey).replace(/[/]/g, '\\\\/');
        // 为外层 JSON 转义引号（但不转义反斜杠，保持 \\/ 格式）
        const escapedInner = innerJson.replace(/"/g, '\\\\"');
        // 外层 JSON
        const keyJson = '{"key":"' + escapedInner + '"}';
        parts.push(writeJavaString(keyJson));

        // 2. 写入 uuid-token -> meta (JSON字符串)
        parts.push(writeJavaString(token.uuid + '-token'));
        // ASCII JSON escapes preserve Unicode through Java's modified UTF-8
        // strings and the binary-string import path, including surrogate pairs.
        const metaJson = JSON.stringify(token.meta).replace(/[^\\x00-\\x7f]/g,
          char => '\\\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
        parts.push(writeJavaString(metaJson));
      }

      // 写入 masterKey (也需要转义斜杠)
      parts.push(writeJavaString('masterKey'));
      const masterKeyJson = JSON.stringify(masterKeyData).replace(/\\//g, '\\\\/');
      parts.push(writeJavaString(masterKeyJson));

      // TC_ENDBLOCKDATA
      parts.push(new Uint8Array([0x78]));

      // 合并所有部分
      const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
      }

      return result;
    }

    /**
     * 写入 Java 序列化字符串 (TC_STRING格式)
     */
    function writeJavaString(str) {
      const bytes = new TextEncoder().encode(str);
      const result = new Uint8Array(3 + bytes.length);
      result[0] = 0x74; // TC_STRING
      result[1] = (bytes.length >> 8) & 0xff;
      result[2] = bytes.length & 0xff;
      result.set(bytes, 3);
      return result;
    }

    // ==================== TOTP Authenticator 加密导出 ====================

    /**
     * 显示 TOTP Authenticator 导出密码输入模态框
     */
    function showTOTPAuthExportModal() {
      showModal('totpAuthExportModal', () => {
        const countEl = document.getElementById('totpAuthExportCount');
        if (countEl) countEl.textContent = secrets.length;
        const passwordInput = document.getElementById('totpAuthExportPassword');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }

    /**
     * 隐藏 TOTP Authenticator 导出模态框
     */
    function hideTOTPAuthExportModal() {
      hideModal('totpAuthExportModal');
    }

    /**
     * 执行 TOTP Authenticator 加密导出
     */
    async function executeTOTPAuthExport() {
      const password = document.getElementById('totpAuthExportPassword').value;
      if (!password) {
        showCenterToast('❌', t('transferEncryptionPassword'));
        return;
      }

      try {
        // 获取排序后的密钥
        const sortSelect = document.getElementById('exportSortOrder');
        const sortValue = sortSelect ? sortSelect.value : 'index-asc';
        const secretsToExport = sortSecretsForExport([...secrets], sortValue);

        if (await exportAsTOTPAuthenticatorEncrypted(secretsToExport, password) === false) return;
        hideTOTPAuthExportModal();
      } catch (error) {
        showCenterToast('❌', t('transferExportFailedPrefix') + error.message);
      }
    }

    /**
     * Base32 转十六进制
     * @param {string} base32 - Base32 编码字符串
     * @returns {string} 十六进制字符串
     */
    function base32ToHex(base32) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';

      // Base32 解码为二进制字符串
      for (const char of base32.toUpperCase()) {
        const val = alphabet.indexOf(char);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
      }

      // 二进制转十六进制
      let hex = '';
      for (let i = 0; i + 4 <= bits.length; i += 4) {
        hex += parseInt(bits.substr(i, 4), 2).toString(16).toUpperCase();
      }

      return hex;
    }

    /**
     * 导出为 TOTP Authenticator 加密格式
     * 加密方式: AES-256-CBC, 密钥 = SHA256(password), IV = 16 字节 0x00
     * @param {Array} sortedSecrets - 排序后的密钥数组
     * @param {string} password - 加密密码
     */
    async function exportAsTOTPAuthenticatorEncrypted(sortedSecrets, password) {
      if (sortedSecrets.some(secret => String(secret.type || 'TOTP').toUpperCase() === 'HOTP' ||
          String(secret.algorithm || 'SHA1').toUpperCase() !== 'SHA1')) {
        showCenterToast('❌', t('transferTOTPUnsupported'));
        return false;
      }
      const filenamePrefix = '2FA-secrets';

      // 构建 TOTP Authenticator 格式的数据
      const entries = sortedSecrets.map((secret, index) => {
        const issuer = secret.name ? secret.name.trim() : '';
        const name = secret.account ? secret.account.trim() : '';

        // 将 Base32 密钥转换为十六进制
        const hexKey = base32ToHex(secret.secret);

        return {
          accountHeaderLabel: 'other',
          allowNotifications: false,
          base: 16,
          dateModified: new Date().toISOString().replace('T', ' ').substring(0, 19),
          digits: (secret.digits || 6).toString(),
          fileName: '',
          iconLabel: '',
          iconPath: '',
          isFavorite: false,
          isSelected: false,
          isWidgetActive: false,
          issuer: issuer,
          key: hexKey,
          name: name,
          period: (secret.period || 30).toString(),
          setIconFromDrawable: true,
          source: 0,
          timeRemaining: 0,
          totpCode: '',
          widgetId: 0
        };
      });

      // TOTP Authenticator 的特殊 JSON 格式：key 是 JSON 数组字符串，value 是时间戳
      const timestamp = Date.now().toString();
      const entriesJson = JSON.stringify(entries);
      const exportData = {};
      exportData[entriesJson] = timestamp;

      const jsonContent = JSON.stringify(exportData);

      // 生成密钥: SHA256(password)
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password);
      const keyHash = await crypto.subtle.digest('SHA-256', passwordData);

      // 导入 AES 密钥
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-CBC' },
        false,
        ['encrypt']
      );

      // IV = 16 字节 0x00
      const iv = new Uint8Array(16);

      // 加密数据
      const dataBytes = encoder.encode(jsonContent);
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: iv },
        cryptoKey,
        dataBytes
      );

      // Base64 编码
      const encryptedArray = new Uint8Array(encryptedBuffer);
      let binary = '';
      for (let i = 0; i < encryptedArray.length; i++) {
        binary += String.fromCharCode(encryptedArray[i]);
      }
      const base64Content = btoa(binary);

      // 下载文件
      const saved = await downloadFile(base64Content, filenamePrefix + '-totpauth-' + getDateString() + '.encrypt', 'application/octet-stream');
      if (saved) {
        showExportSuccess(sortedSecrets.length, 'TOTP Authenticator');
      }
    }

    function showExportSuccess(count, format) {
      const formatName = format || t('transferSecret');
      showCenterToast('✅', t('transferExported', { count, format: formatName }));
    }
`;
}
