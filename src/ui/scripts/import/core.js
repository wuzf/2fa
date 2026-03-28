/**
 * 导入核心逻辑模块
 * 包含 previewImport 和 executeImport 核心函数
 */

/**
 * 获取预览导入代码
 * @returns {string} JavaScript 代码
 */
export function getPreviewImportCode() {
	return `
    // ========== 预览导入 ==========

    // 预览导入
    function previewImport() {
      const text = document.getElementById('importText').value.trim();
      if (!text) {
        showCenterToast('❌', '请先输入或选择要导入的内容');
        return;
      }

      let lines = text.split('\\n').filter(line => line.trim());
      const previewList = document.getElementById('importPreviewList');
      const previewDiv = document.getElementById('importPreview');
      const executeBtn = document.getElementById('executeImportBtn');

      previewList.innerHTML = '';
      importPreviewData = [];

      let validCount = 0;
      let invalidCount = 0;
      let skippedCount = 0;

      // 检测 FreeOTP 加密备份格式
      const freeotpData = parseFreeOTPBackup(text);
      if (freeotpData) {
        freeotpBackupData = freeotpData;
        const tokenCount = Object.keys(freeotpData.tokenMeta).length;

        Object.entries(freeotpData.tokenMeta).forEach(([uuid, meta]) => {
          const item = document.createElement('div');
          item.className = 'import-preview-item valid';

          const issuer = meta.issuerExt || meta.issuerInt || '';
          const account = meta.label || '';
          let displayInfo = issuer || '未知服务';
          if (meta.type && meta.type !== 'TOTP') displayInfo += ' [' + meta.type + ']';
          if (meta.digits && meta.digits !== 6) displayInfo += ' [' + meta.digits + '位]';

          item.innerHTML =
            '<div class="service-name">🔒 ' + displayInfo + '</div>' +
            '<div class="account-name">' + (account || '(需要密码解密)') + '</div>';

          previewList.appendChild(item);

          importPreviewData.push({
            serviceName: issuer,
            account: account,
            uuid: uuid,
            encrypted: true,
            valid: true
          });
          validCount++;
        });

        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = 'margin: 15px 0; padding: 15px; background: var(--bg-secondary); border-radius: 6px; font-size: 14px; color: var(--text-primary);';
        statsDiv.innerHTML =
          '<strong>🔐 FreeOTP 加密备份</strong><br>' +
          '<span style="color: var(--text-secondary);">检测到 ' + tokenCount + ' 个加密密钥</span><br><br>' +
          '<div style="display: flex; gap: 10px; align-items: center;">' +
          '<input type="password" id="freeotpPassword" placeholder="输入备份密码" ' +
          'style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary);">' +
          '<button onclick="decryptAndPreviewFreeOTP()" class="btn btn-primary" style="padding: 8px 16px;">解密</button>' +
          '</div>';

        previewList.insertBefore(statsDiv, previewList.firstChild);
        updateImportStats(validCount, 0, 0);
        previewDiv.style.display = 'block';
        executeBtn.disabled = true;
        executeBtn.textContent = '🔒 需要先解密';
        return;
      }

      // 检测 TOTP Authenticator 加密备份格式
      if (isTOTPAuthenticatorBackup(text)) {
        totpAuthBackupData = text;

        const statsDiv = document.createElement('div');
        statsDiv.className = 'import-stats-header';
        statsDiv.innerHTML =
          '<strong>🔐 TOTP Authenticator 加密备份</strong><br>' +
          '<span style="color: var(--text-secondary);">检测到加密的 TOTP Authenticator 备份</span><br><br>' +
          '<div style="display: flex; gap: 10px; align-items: center;">' +
          '<input type="password" id="totpAuthPassword" placeholder="输入备份密码" ' +
          'style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary);">' +
          '<button onclick="decryptAndPreviewTOTPAuth()" class="btn btn-primary" style="padding: 8px 16px;">解密</button>' +
          '</div>';

        previewList.appendChild(statsDiv);
        previewDiv.style.display = 'block';
        executeBtn.disabled = true;
        executeBtn.textContent = '🔒 需要先解密';
        return;
      }

      // 检测并解析HTML格式
      const trimmedText = text.trim().toLowerCase();
      const isHtmlFormat = trimmedText.startsWith('<!doctype html') ||
                          trimmedText.startsWith('<html') ||
                          text.includes('class="otp-entry"') ||
                          text.includes('Ente Auth');
      if (isHtmlFormat) {
        const htmlLines = parseHTMLImport(text);
        if (htmlLines.length === 0) {
          showCenterToast('❌', '未从HTML文件中提取到有效密钥');
          return;
        }
        lines = htmlLines;
      }
      // 检测并解析JSON格式
      else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          const jsonData = JSON.parse(text);
          lines = parseJsonImport(jsonData);
          if (lines.length === 0) {
            showCenterToast('❌', '未找到有效的密钥数据');
            return;
          }
        } catch (jsonError) {
          console.log('JSON解析失败,按OTPAuth URL格式解析:', jsonError.message);
        }
      }
      // 检测并解析CSV格式
      else if (text.includes('服务名称,账户信息,密钥') ||
               (text.toLowerCase().includes('service') && text.toLowerCase().includes('secret') && text.includes(','))) {
        const csvLines = parseCSVImport(text);
        if (csvLines.length === 0) {
          showCenterToast('❌', '未从CSV文件中提取到有效密钥');
          return;
        }
        lines = csvLines;
      }

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        const item = document.createElement('div');
        item.className = 'import-preview-item';

        try {
          if (trimmedLine.startsWith('otpauth://totp/') || trimmedLine.startsWith('otpauth://hotp/')) {
            const fixedLine = trimmedLine.replace(/&amp%3B/g, '&');
            const url = new URL(fixedLine);
            const type = url.protocol === 'otpauth:' ? url.hostname : 'totp';
            const secret = url.searchParams.get('secret');
            const issuer = url.searchParams.get('issuer') || '';
            const digits = parseInt(url.searchParams.get('digits')) || 6;
            const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
            const period = parseInt(url.searchParams.get('period')) || 30;
            const counter = parseInt(url.searchParams.get('counter')) || 0;

            // 检查 Ente Auth 格式的已删除标记
            const codeDisplayParam = url.searchParams.get('codeDisplay');
            let isDeleted = false;
            if (codeDisplayParam) {
              try {
                const codeDisplay = JSON.parse(decodeURIComponent(codeDisplayParam));
                isDeleted = codeDisplay.trashed === true;
              } catch (e) {
                console.warn('解析 codeDisplay 失败:', e.message);
              }
            }

            if (isDeleted) {
              item.className += ' skipped';
              item.innerHTML =
                '<div class="service-name">⏭️ ' + (issuer || '未知服务') + '</div>' +
                '<div class="account-name">已删除条目，跳过导入</div>';
              previewList.appendChild(item);
              skippedCount++;
              return;
            }

            const pathParts = decodeURIComponent(url.pathname.substring(1)).split(':');
            let serviceName = issuer;
            let account = '';

            if (pathParts.length >= 2) {
              serviceName = pathParts[0] || issuer;
              account = pathParts.slice(1).join(':');
            } else if (pathParts.length === 1) {
              if (issuer) {
                serviceName = issuer;
                account = pathParts[0];
              } else {
                serviceName = pathParts[0];
              }
            }

            // 清理密钥中的空格和分隔符
            const cleanedSecret = secret ? secret.replace(/[\\s\\-+]/g, '') : secret;

            if (cleanedSecret && serviceName) {
              if (validateBase32(cleanedSecret)) {
                item.className += ' valid';

                let displayInfo = serviceName;
                if (type === 'hotp') displayInfo += ' [HOTP]';
                if (digits !== 6) displayInfo += ' [' + digits + '位]';
                if (period !== 30 && type === 'totp') displayInfo += ' [' + period + 's]';
                if (algorithm !== 'SHA1') displayInfo += ' [' + algorithm + ']';

                item.innerHTML =
                  '<div class="service-name">✅ ' + displayInfo + '</div>' +
                  '<div class="account-name">' + (account || '(无账户)') + '</div>';

                importPreviewData.push({
                  serviceName: serviceName,
                  account: account,
                  secret: cleanedSecret.toUpperCase(),
                  type: type,
                  digits: digits,
                  period: period,
                  algorithm: algorithm,
                  counter: counter,
                  valid: true,
                  line: index + 1
                });

                validCount++;
              } else {
                throw new Error('无效的Base32密钥格式');
              }
            } else {
              throw new Error('缺少必要信息（密钥或服务名）');
            }
          } else {
            throw new Error('不是有效的otpauth://格式');
          }
        } catch (error) {
          item.className += ' invalid';
          item.innerHTML =
            '<div class="service-name">❌ 第' + (index + 1) + '行</div>' +
            '<div class="error-msg">' + error.message + '</div>';

          importPreviewData.push({
            line: index + 1,
            error: error.message,
            valid: false
          });

          invalidCount++;
        }

        previewList.appendChild(item);
      });

      updateImportStats(validCount, invalidCount, skippedCount);
      previewDiv.style.display = 'block';
      executeBtn.disabled = validCount === 0;
    }
`;
}

/**
 * 获取执行导入代码
 * @returns {string} JavaScript 代码
 */
export function getExecuteImportCode() {
	return `
    // ========== 执行导入 ==========

    // 执行导入
    async function executeImport() {
      const validItems = importPreviewData.filter(item => item.valid);

      if (validItems.length === 0) {
        showCenterToast('❌', '没有有效的密钥可以导入');
        return;
      }

      const executeBtn = document.getElementById('executeImportBtn');
      executeBtn.disabled = true;

      let successCount = 0;
      let failCount = 0;

      try {
        console.log('开始批量导入', validItems.length, '个密钥');

        const secretsToImport = validItems.map(item => ({
          name: item.serviceName,
          account: item.account || '',
          secret: item.secret,
          type: item.type || 'totp',
          digits: item.digits || 6,
          period: item.period || 30,
          algorithm: item.algorithm || 'SHA1',
          counter: item.counter || 0
        }));

        const response = await authenticatedFetch('/api/secrets/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ secrets: secretsToImport })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('批量导入成功:', result);
          successCount = result.successCount || validItems.length;
          failCount = result.failCount || 0;

          if (result.results) {
            result.results.forEach((itemResult, index) => {
              if (itemResult.success) {
                console.log('✅ 第 ' + (index + 1) + ' 行导入成功:', itemResult.secret.name);
              } else {
                console.error('❌ 第 ' + (index + 1) + ' 行导入失败:', itemResult.error);
              }
            });
          }
        } else {
          console.warn('批量导入失败，回退到逐个导入');
          const individualResult = await importSecretsIndividually(validItems);
          successCount = individualResult.successCount;
          failCount = individualResult.failCount;
        }
      } catch (error) {
        console.error('导入过程出错:', error);
        showCenterToast('❌', '导入失败：' + error.message);
        executeBtn.disabled = false;
        return;
      }

      // 显示结果
      if (failCount === 0) {
        showCenterToast('✅', '成功导入 ' + successCount + ' 个密钥');
      } else {
        showCenterToast('⚠️', '导入完成: ' + successCount + ' 成功, ' + failCount + ' 失败');
      }

      // 刷新列表并关闭模态框
      await loadSecrets();
      hideImportModal();
    }

    // 逐个导入密钥（批量导入失败时的回退方案）
    async function importSecretsIndividually(items) {
      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        try {
          const response = await authenticatedFetch('/api/secrets', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: item.serviceName,
              account: item.account || '',
              secret: item.secret,
              type: item.type || 'totp',
              digits: item.digits || 6,
              period: item.period || 30,
              algorithm: item.algorithm || 'SHA1',
              counter: item.counter || 0
            })
          });

          if (response.ok) {
            successCount++;
            console.log('✅ 导入成功:', item.serviceName);
          } else {
            failCount++;
            console.error('❌ 导入失败:', item.serviceName);
          }
        } catch (error) {
          failCount++;
          console.error('❌ 导入异常:', item.serviceName, error);
        }
      }

      return { successCount, failCount };
    }
`;
}
