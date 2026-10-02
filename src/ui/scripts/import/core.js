/**
 * 导入核心逻辑模块
 * 包含 previewImport 和 executeImport 核心函数
 */

import { LIMITS } from '../../../utils/constants.js';

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
        showCenterToast('❌', t('transferImportRequired'));
        return;
      }

      let lines = text.split('\\n').filter(line => line.trim());
      const previewList = document.getElementById('importPreviewList');
      const previewDiv = document.getElementById('importPreview');
      const executeBtn = document.getElementById('executeImportBtn');

      previewList.innerHTML = '';
      importPreviewRenderers = [];
      importPreviewData = [];
      resetImportRetryState();
      // 新一轮预览必须把上一轮残留的进度条/累计成功失败计数也一起清掉，
      // 否则"部分导入后不关模态框直接改文本重新预览"的场景里，旧数据会继续显示在新预览旁边误导用户
      resetImportProgress();

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
          const displayInfo = () => formatImportPreviewName(issuer, meta.type, meta.digits);

          setImportPreviewRenderer(item, () =>
            '<div class="service-name">' + dialogIcon('lock') + ' ' + escapeHTML(displayInfo()) + '</div>' +
            '<div class="account-name">' + escapeHTML(account || t('transferNeedsPassword')) + '</div>');

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
        statsDiv.className = 'dialog-encrypted-import';
        statsDiv.innerHTML =
          '<strong data-i18n="transferFreeOTPEncrypted">' + escapeHTML(t('transferFreeOTPEncrypted')) + '</strong>' +
          '<p>' + escapeHTML(t('transferDetectedPrefix')) + tokenCount + escapeHTML(t('transferEncryptedKeysSuffix')) + '</p>' +
          '<div class="dialog-decrypt-controls">' +
          '<input type="password" id="freeotpPassword" data-i18n-placeholder="transferBackupPasswordPlaceholder" placeholder="' + escapeHTML(t('transferBackupPasswordPlaceholder')) + '" data-i18n-aria-label="transferBackupPassword" aria-label="' + escapeHTML(t('transferBackupPassword')) + '">' +
          '<button type="button" onclick="decryptAndPreviewFreeOTP()" class="btn btn-primary" data-i18n="transferDecrypt">' + escapeHTML(t('transferDecrypt')) + '</button>' +
          '</div>';

        setTranslatedText(statsDiv.querySelector('p'), 'transferEncryptedCount', { count: tokenCount });
        previewList.insertBefore(statsDiv, previewList.firstChild);
        updateImportStats(validCount, 0, 0);
        previewDiv.style.display = 'block';
        executeBtn.disabled = true;
        setTranslatedText(executeBtn, 'transferDecryptFirst');
        return;
      }

      // 检测 TOTP Authenticator 加密备份格式
      if (isTOTPAuthenticatorBackup(text)) {
        totpAuthBackupData = text;

        const statsDiv = document.createElement('div');
        statsDiv.className = 'dialog-encrypted-import';
        statsDiv.innerHTML =
          '<strong data-i18n="transferTOTPEncrypted">' + escapeHTML(t('transferTOTPEncrypted')) + '</strong>' +
          '<p data-i18n="transferTOTPDetected">' + escapeHTML(t('transferTOTPDetected')) + '</p>' +
          '<div class="dialog-decrypt-controls">' +
          '<input type="password" id="totpAuthPassword" data-i18n-placeholder="transferBackupPasswordPlaceholder" placeholder="' + escapeHTML(t('transferBackupPasswordPlaceholder')) + '" data-i18n-aria-label="transferBackupPassword" aria-label="' + escapeHTML(t('transferBackupPassword')) + '">' +
          '<button type="button" onclick="decryptAndPreviewTOTPAuth()" class="btn btn-primary" data-i18n="transferDecrypt">' + escapeHTML(t('transferDecrypt')) + '</button>' +
          '</div>';

        previewList.appendChild(statsDiv);
        previewDiv.style.display = 'block';
        executeBtn.disabled = true;
        setTranslatedText(executeBtn, 'transferDecryptFirst');
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
          showCenterToast('❌', t('transferHTMLNoKeys'));
          return;
        }
        lines = htmlLines;
      }
      // 检测并解析JSON格式
      else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        let jsonData;

        try {
          jsonData = JSON.parse(text);
        } catch (jsonError) {
          console.log('JSON解析失败，按OTPAuth URL格式解析:', jsonError.message);
        }

        if (jsonData) {
          try {
          lines = parseJsonImport(jsonData);
          if (lines.length === 0) {
            showCenterToast('❌', t('transferNoValidData'));
            return;
          }
          } catch (parseError) {
            console.error('JSON导入解析失败:', parseError);
            showCenterToast('❌', parseError.message || t('transferJSONUnknown'));
            return;
          }
        }
      }
      // 检测并解析CSV格式
      else if (isKnownCSVHeader(text.split('\\n')[0]) ||
               (text.toLowerCase().includes('service') && text.toLowerCase().includes('secret') && text.includes(','))) {
        const csvLines = parseCSVImport(text);
        if (csvLines.length === 0) {
          showCenterToast('❌', t('transferCSVNoKeys'));
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
              setImportPreviewRenderer(item, () =>
                '<div class="service-name">' + dialogIcon('info') + ' ' + escapeHTML(issuer || t('transferUnknownService')) + '</div>' +
                '<div class="account-name" data-i18n="transferDeletedSkip">' + escapeHTML(t('transferDeletedSkip')) + '</div>');
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

            // Match the server's required-name validation before enabling import.
            serviceName = serviceName.trim();

            // 清理密钥中的空格和分隔符
            const cleanedSecret = secret ? secret.replace(/[\\s\\-+]/g, '') : secret;

            if (cleanedSecret && serviceName) {
              if (validateBase32(cleanedSecret)) {
                item.className += ' valid';

                const displayInfo = () => formatImportPreviewName(serviceName, type, digits, period, algorithm);

                setImportPreviewRenderer(item, () =>
                  '<div class="service-name">' + dialogIcon('check') + ' ' + escapeHTML(displayInfo()) + '</div>' +
                  '<div class="account-name">' + escapeHTML(account || t('transferNoAccount')) + '</div>');

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
                throw Object.assign(new Error(t('transferInvalidBase32')), { i18nKey: 'transferInvalidBase32' });
              }
            } else {
              throw Object.assign(new Error(t('transferMissingFields')), { i18nKey: 'transferMissingFields' });
            }
          } else {
            throw Object.assign(new Error(t('transferInvalidOTPAuth')), { i18nKey: 'transferInvalidOTPAuth' });
          }
        } catch (error) {
          item.className += ' invalid';
          setImportPreviewRenderer(item, () =>
            '<div class="service-name">' + dialogIcon('error') + t('transferLinePrefix') + (index + 1) + escapeHTML(t('transferLineSuffix')) + '</div>' +
            '<div class="error-msg">' + escapeHTML(error.i18nKey ? t(error.i18nKey) : error.message) + '</div>');

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
      setTranslatedText(executeBtn, 'transferImport');
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
    // 由构建期从 LIMITS.BULK_IMPORT_CHUNK_SIZE 注入，与后端 batch.js/validation.js 保持一致
    const BULK_IMPORT_CHUNK_SIZE = ${LIMITS.BULK_IMPORT_CHUNK_SIZE};

    function buildBatchImportPayload(item) {
      return {
        name: item.serviceName,
        account: item.account || '',
        secret: item.secret,
        type: item.type || 'totp',
        digits: item.digits || 6,
        period: item.period || 30,
        algorithm: item.algorithm || 'SHA1',
        counter: item.counter || 0
      };
    }

    function splitBatchImportItems(items, chunkSize) {
      const chunks = [];
      for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
      }
      return chunks;
    }

    async function readBatchImportErrorMessage(response) {
      try {
        const error = await response.clone().json();
        return error.message || error.error || ('HTTP ' + response.status);
      } catch (jsonError) {
        try {
          const text = await response.text();
          return text || ('HTTP ' + response.status);
        } catch (textError) {
          return 'HTTP ' + response.status;
        }
      }
    }

    function reportImportProgress(onProgress, state) {
      if (typeof onProgress === 'function') {
        onProgress(state);
      }
    }

    function createChunkImportError(message, meta) {
      const error = new Error(message);
      Object.assign(error, meta);
      return error;
    }

    async function executeImport() {
      const isRetryingPendingItems = Array.isArray(pendingImportRetryItems) && pendingImportRetryItems.length > 0;
      const validItems = isRetryingPendingItems
        ? pendingImportRetryItems
        : importPreviewData.filter(item => item.valid);

      if (validItems.length === 0) {
        showCenterToast('❌', t('transferNoValidImport'));
        return;
      }

      const executeBtn = document.getElementById('executeImportBtn');
      executeBtn.disabled = true;
      setTranslatedText(executeBtn, 'transferImportingButton');

      // 跨轮累计的进度坐标系：
      //   - 首轮把当前 validItems.length 记为整批原始总数
      //   - 续传时沿用首轮总数，priorProcessed 代表之前各轮累计已处理的条数
      // 面板上 totalItems/processedItems/successCount/failCount 都在这个累计坐标系下显示
      const originalTotalItems = isRetryingPendingItems && pendingImportOriginalTotalItems > 0
        ? pendingImportOriginalTotalItems
        : validItems.length;
      const priorProcessedItems = isRetryingPendingItems ? pendingImportPriorProcessedItems : 0;
      if (!isRetryingPendingItems) {
        pendingImportOriginalTotalItems = originalTotalItems;
        pendingImportPriorProcessedItems = 0;
      }

      const totalChunks = Math.max(1, Math.ceil(validItems.length / BULK_IMPORT_CHUNK_SIZE));
      showImportProgress({
        titleKey: 'transferBulkImporting',
        messageKey: totalChunks > 1 ? 'transferPreparingBatch' : 'transferPreparingImport',
        messageParams: { count: totalChunks },
        totalItems: originalTotalItems,
        processedItems: priorProcessedItems,
        successCount: pendingImportPriorSuccessCount,
        failCount: pendingImportPriorFailCount,
        chunkIndex: 0,
        chunkCount: totalChunks
      });

      // 把分片返回的结果数组转成失败明细（{line, name, error}），其中 line 取自原始文本；
      // validItemsForResults 是该轮调用时传给分片函数的 items，索引需要相对该数组解析
      function collectFailureDetails(results, validItemsForResults) {
        const failures = [];
        if (!Array.isArray(results)) return failures;
        results.forEach(function(itemResult) {
          if (itemResult && itemResult.success === false) {
            const resultIndex = typeof itemResult.index === 'number' ? itemResult.index : 0;
            const srcItem = validItemsForResults[resultIndex];
            const line = srcItem && typeof srcItem.line === 'number' ? srcItem.line : resultIndex + 1;
            const name = srcItem ? (srcItem.serviceName || t('transferUnknownService')) : t('transferUnknownService');
            failures.push({ line: line, name: name, error: itemResult.error || t('transferUnknownError') });
          }
        });
        return failures;
      }

      // 本轮进入时从 prior 状态继承（续传时非零）；完成/部分失败时再写回
      const priorSuccessCountAtStart = pendingImportPriorSuccessCount;
      const priorFailCountAtStart = pendingImportPriorFailCount;
      const priorFailuresAtStart = pendingImportPriorFailures.slice();
      const priorQueuedCountAtStart = pendingImportPriorQueuedCount;

      let successCount = 0;
      let failCount = 0;
      let queuedCount = 0;
      let thisRunFailures = [];

      try {
        console.log('开始批量导入', validItems.length, '个密钥');

        // importSecretsInChunks 的 progressState 以"本轮"为坐标，这里把它重映射到"整批累计"坐标系，
        // 让进度面板的 totalItems/processedItems 与 successCount/failCount 保持同一口径
        const importResult = await importSecretsInChunks(validItems, function(progressState) {
          updateImportProgress(Object.assign({}, progressState, {
            totalItems: originalTotalItems,
            processedItems: priorProcessedItems + (Number(progressState && progressState.processedItems) || 0),
            successCount: priorSuccessCountAtStart + (Number(progressState && progressState.successCount) || 0),
            failCount: priorFailCountAtStart + (Number(progressState && progressState.failCount) || 0),
          }));
        });
        successCount = importResult.successCount;
        failCount = importResult.failCount;
        queuedCount = importResult.queuedCount;

        importResult.results.forEach(function(itemResult) {
          const resultIndex = typeof itemResult.index === 'number' ? itemResult.index : 0;
          const fallbackItem = validItems[resultIndex];
          // 优先用原始文本里的行号（预览阶段写入 item.line），续传时仍指向正确的来源行；
          // 若缺失（如来自 Google 迁移 protobuf 的无行号项），退回到 validItems 下标 + 1
          const lineNumber = fallbackItem && typeof fallbackItem.line === 'number'
            ? fallbackItem.line
            : resultIndex + 1;

          if (itemResult.success) {
            const secretName = itemResult.secret && itemResult.secret.name ? itemResult.secret.name : (fallbackItem ? fallbackItem.serviceName : t('transferUnknownService'));
            console.log('✅ 第' + lineNumber + ' 行导入成功', secretName);
          } else {
            const name = fallbackItem ? (fallbackItem.serviceName || t('transferUnknownService')) : t('transferUnknownService');
            thisRunFailures.push({ line: lineNumber, name: name, error: itemResult.error || t('transferUnknownError') });
            console.error('❌ 第' + lineNumber + ' 行导入失败', itemResult.error);
          }
        });
      } catch (error) {
        console.error('导入过程出错:', error);
        await loadSecrets();
        const partialSuccessCount = typeof error?.partialSuccessCount === 'number' ? error.partialSuccessCount : 0;
        const partialFailCount = typeof error?.partialFailCount === 'number' ? error.partialFailCount : 0;
        const processedValidItems = Math.min(
          typeof error?.processedItems === 'number' ? error.processedItems : partialSuccessCount + partialFailCount,
          validItems.length
        );
        if (processedValidItems > 0) {
          const remainingRetryItems = validItems.slice(processedValidItems);
          pendingImportRetryItems = remainingRetryItems.length > 0 ? remainingRetryItems : null;
          // 把本轮已完成分片中的失败项并入累积状态，续传成功后再一次性汇总给用户
          const newFailures = collectFailureDetails(error.results, validItems);
          pendingImportPriorSuccessCount = priorSuccessCountAtStart + partialSuccessCount;
          pendingImportPriorFailCount = priorFailCountAtStart + partialFailCount;
          pendingImportPriorFailures = priorFailuresAtStart.concat(newFailures);
          pendingImportPriorQueuedCount = priorQueuedCountAtStart + (typeof error?.partialQueuedCount === 'number' ? error.partialQueuedCount : 0);
          // 跨轮累计的"已处理"计数：下一轮读它重建进度面板
          pendingImportPriorProcessedItems = priorProcessedItems + processedValidItems;

          const aggregateSuccess = pendingImportPriorSuccessCount;
          const aggregateFail = pendingImportPriorFailCount;
          const aggregateProcessed = pendingImportPriorProcessedItems;
          showCenterToast('⚠️', t('transferImportPaused', { processed: processedValidItems, success: aggregateSuccess, failed: aggregateFail, remaining: remainingRetryItems.length, error: error.message }));
          executeBtn.disabled = false;
          setTranslatedText(executeBtn, remainingRetryItems.length > 0 ? 'transferContinueImport' : 'transferImport');
          updateImportProgress({
            titleKey: 'transferPartialImport',
            messageKey: 'transferImportRemaining',
            messageParams: { processed: aggregateProcessed, total: originalTotalItems, remaining: remainingRetryItems.length },
            totalItems: originalTotalItems,
            processedItems: aggregateProcessed,
            successCount: aggregateSuccess,
            failCount: aggregateFail,
            chunkIndex: typeof error?.chunkIndex === 'number' ? error.chunkIndex : 0,
            chunkCount: typeof error?.chunkCount === 'number' ? error.chunkCount : totalChunks
          });
          return;
        }

        // 完全失败时：若本次本来就是续传（validItems 来自 pendingImportRetryItems），
        // 保留剩余列表和累计明细，便于用户再次点击"继续导入剩余项"重试；否则全清
        if (!isRetryingPendingItems) {
          resetImportRetryState();
        }
        showCenterToast('❌', t('transferImportFailedColon') + error.message);
        executeBtn.disabled = false;
        setTranslatedText(executeBtn, isRetryingPendingItems ? 'transferContinueImport' : 'transferImport');
        return;
      }

      // 本轮成功：与之前续传累计状态合并，得到整批汇总
      const aggregateSuccess = priorSuccessCountAtStart + successCount;
      const aggregateFailures = priorFailuresAtStart.concat(thisRunFailures);
      const aggregateFail = priorFailCountAtStart + failCount;
      const aggregateProcessed = priorProcessedItems + validItems.length;

      updateImportProgress({
        titleKey: 'transferBulkComplete',
        messageKey: aggregateFail === 0 ? 'transferImportComplete' : 'transferImportWithFailures',
        totalItems: originalTotalItems,
        processedItems: aggregateProcessed,
        successCount: aggregateSuccess,
        failCount: aggregateFail,
        chunkIndex: totalChunks,
        chunkCount: totalChunks
      });

      if (priorQueuedCountAtStart + queuedCount > 0) {
        // 未联网的部分（含之前各轮）只在本机排队，不能报成已导入；同步进度见「未同步更改」
        showCenterToast('📥', t('coreQueued'));
      } else if (aggregateFail === 0) {
        showCenterToast('✅', t('transferImported', { count: aggregateSuccess }));
      } else {
        showCenterToast('⚠️', t('transferImportSummary', { success: aggregateSuccess, failed: aggregateFail }));
      }
      aggregateFailures.forEach(function(f) {
        console.error('❌ 第' + f.line + ' 行导入失败（累计）', f.name, f.error);
      });

      await loadSecrets();
      hideImportModal();

      // 逐条列出失败原因（重复、参数不受支持等），不必打开控制台查看
      if (aggregateFailures.length > 0) {
        showImportResultModal(aggregateSuccess, aggregateFail, aggregateFailures.map(function(f) {
          return { name: f.name, error: f.error };
        }));
      }
    }

    async function importSecretsInChunks(items, onProgress) {
      let successCount = 0;
      let failCount = 0;
      let queuedCount = 0;
      const results = [];
      let processedItems = 0;
      const chunks = splitBatchImportItems(items, BULK_IMPORT_CHUNK_SIZE);
      const chunkCount = chunks.length;

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const startIndex = chunkIndex * BULK_IMPORT_CHUNK_SIZE;
        const currentChunkNumber = chunkIndex + 1;

        reportImportProgress(onProgress, {
          titleKey: 'transferBulkImporting',
          messageKey: 'transferProcessingBatch',
            messageParams: { index: currentChunkNumber, count: chunkCount },
          totalItems: items.length,
          processedItems: processedItems,
          successCount: successCount,
          failCount: failCount,
          chunkIndex: currentChunkNumber,
          chunkCount: chunkCount
        });

        try {
          console.log('批量导入分片', (chunkIndex + 1) + '/' + chunks.length, '本片', chunk.length, '个密钥');

          const response = await authenticatedFetch('/api/secrets/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              secrets: chunk.map(buildBatchImportPayload),
              immediateBackup: currentChunkNumber === chunkCount,
              chunkIndex: currentChunkNumber,
              chunkCount: chunkCount
            })
          });

          if (response.ok) {
            const result = await response.json();

            // 离线时 Service Worker 只把这一片放进本机队列（202），联网后才真正导入
            if (result && result.queued && result.offline) {
              queuedCount += chunk.length;
              processedItems += chunk.length;
              continue;
            }

            const chunkSuccessCount = typeof result.successCount === 'number' ? result.successCount : chunk.length;
            const chunkFailCount = typeof result.failCount === 'number' ? result.failCount : 0;

            successCount += chunkSuccessCount;
            failCount += chunkFailCount;

            if (Array.isArray(result.results)) {
              result.results.forEach(function(itemResult, index) {
                results.push(Object.assign({}, itemResult, {
                  index: typeof itemResult.index === 'number' ? itemResult.index + startIndex : startIndex + index
                }));
              });
            }

            processedItems += chunk.length;
            reportImportProgress(onProgress, {
              titleKey: 'transferBulkImporting',
              messageKey: 'transferCompletedBatch',
            messageParams: { index: currentChunkNumber, count: chunkCount },
              totalItems: items.length,
              processedItems: processedItems,
              successCount: successCount,
              failCount: failCount,
              chunkIndex: currentChunkNumber,
              chunkCount: chunkCount
            });

            continue;
          }

          // 所有非 2xx 响应和网络异常走同一处错误出口，
          // 由 catch 统一附加 partial 进度元数据，避免在多处重复组装同样的 meta
          let errorMessage;
          if (response.status === 429) {
            errorMessage = t('transferRateLimited');
          } else if (response.status >= 500) {
            errorMessage = t('transferBatchResponseError', { index: currentChunkNumber, count: chunkCount });
          } else {
            errorMessage = t('transferBatchFailed', { index: currentChunkNumber, count: chunkCount, error: await readBatchImportErrorMessage(response) });
          }
          throw new Error(errorMessage);

        } catch (error) {
          throw createChunkImportError(
            (error && error.message) || (t('transferBatchRequestError', { index: currentChunkNumber, count: chunkCount })),
            {
              partialSuccessCount: successCount,
              partialFailCount: failCount,
              partialQueuedCount: queuedCount,
              processedItems: processedItems,
              results: results.slice(),
              chunkIndex: currentChunkNumber,
              chunkCount: chunkCount,
              cause: error
            }
          );
        }
      }

      return { successCount, failCount, queuedCount, results };
    }
`;
}
