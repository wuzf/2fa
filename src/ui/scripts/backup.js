import { LIMITS } from '../../utils/constants.js';
import { getTransferMessageLocalizerCode } from './transferMessages.js';

/**
 * 备份模块
 * 包含所有备份/恢复功能，用于管理密钥备份
 */

/**
 * 获取备份相关代码
 * @returns {string} 备份 JavaScript 代码
 */
export function getBackupCode() {
	return `${getTransferMessageLocalizerCode('localizeBackupMessage')}    // ========== 备份恢复功能模块 ==========

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

      defaultBtn.textContent = t('transferDefaultExport', { format: getBackupExportFormatLabel(format) });
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
    let currentBackupPreview = null;
    let restoreUploadStatusRenderer = null;
    let backupListErrorRenderer = null;
    let backupPreviewErrorRenderer = null;
    let backupList = [];
    let backupListCursor = null;
    let backupListHasMore = false;
    let backupListLoading = false;
    let backupListRequestToken = 0;
    let backupPreviewRequestToken = 0;
    const BACKUP_LIST_PAGE_SIZE = 50;
    const BACKUP_UPLOAD_MAX_BYTES = ${LIMITS.MAX_EXPORT_SIZE};
    const BACKUP_UPLOAD_FILE_REGEX = /^backup_\\d{4}-\\d{2}-\\d{2}(?:_[\\w-]+)?\\.(?:json|txt|csv|html)$/i;
    let backupExportFormat = 'txt'; // 备份导出格式

    function isActiveBackupPreviewRequest(backup, requestToken) {
      return requestToken === backupPreviewRequestToken && selectedBackup && selectedBackup.key === backup.key;
    }

    function formatBackupUploadSize(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
      }
      if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }
      if (bytes >= 1024) {
        return Math.ceil(bytes / 1024) + ' KB';
      }
      return bytes + ' B';
    }

    function getBackupFormatFromFileName(fileName) {
      const match = String(fileName || '').match(/\\.(json|txt|csv|html)$/i);
      return match ? match[1].toLowerCase() : 'json';
    }

    function setRestoreUploadStatus(message, isError) {
      const status = document.getElementById('restoreUploadStatus');
      if (!status) {
        return;
      }
      status.style.display = message ? 'block' : 'none';
      restoreUploadStatusRenderer = typeof message === 'function' ? message : () => message || '';
      status.textContent = restoreUploadStatusRenderer();
      status.style.color = isError ? 'var(--dialog-danger)' : 'var(--text-secondary)';
    }

    function resetRestoreUploadInput() {
      const fileInput = document.getElementById('restoreBackupFileInput');
      if (fileInput) {
        fileInput.value = '';
      }
      setRestoreUploadStatus('', false);
    }

    function readRestoreBackupFile(file) {
      if (file && typeof file.text === 'function') {
        return file.text();
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error(t('restoreReadFailed')));
        reader.readAsText(file);
      });
    }

    // Server warnings for an incomplete backup: each one names a skipped entry
    // and why (the server caps and localizes them). A preview's data.warnings
    // starts with a summary line that the preview shows separately; the
    // warnings of a refused restore or export carry only the entries, with the
    // summary in their message. Rendered as text only.
    function backupWarningEntries(warnings, startsWithSummary) {
      if (!Array.isArray(warnings)) return [];
      return warnings.slice(startsWithSummary ? 1 : 0)
        .filter(item => typeof item === 'string' && item.trim())
        .slice(0, 20)
        .map(item => localizeBackupMessage(item));
    }

    function backupWarningListHTML(entries) {
      if (!entries.length) return '';
      return '<ul class="dialog-warning-list" style="margin: 8px 0 0; padding-left: 20px; text-align: left;">' +
        entries.map(entry => '<li>' + escapeHTML(entry) + '</li>').join('') +
        '</ul>';
    }

    // The server's explanation of a failed backup request with the skipped
    // entries it lists; its title alone only repeats that the request failed.
    async function readBackupErrorResponse(response) {
      let errorData = null;
      try { errorData = await response.json(); } catch { /* Not a JSON error body. */ }
      const text = value => typeof value === 'string' ? value.trim() : '';
      const message = text(errorData && errorData.message) || text(errorData && errorData.error) ||
        t('serverResponseStatus', { status: response.status });
      return Object.assign(new Error(message), { warnings: Array.isArray(errorData && errorData.warnings) ? errorData.warnings : [] });
    }

    // Keeps the reasons of a failed export or restore visible in the preview
    // (also after a language change) and blocks the same action again.
    function showBackupActionIssues(backup, label, error) {
      if (!currentBackupPreview || currentBackupPreview.backup !== backup) return;
      currentBackupPreview.issues = { label, message: error.message, warnings: error.warnings || [] };
      renderBackupPreview(currentBackupPreview.backup, currentBackupPreview.data);
    }

    function showRestorePreviewMessage(message, className) {
      const previewElement = document.getElementById('restorePreview');
      const previewContent = document.getElementById('backupPreviewContent');
      if (!previewElement || !previewContent) {
        return;
      }
      previewElement.style.display = 'block';
      backupPreviewErrorRenderer = () => {
        const text = typeof message === 'function' ? message() : localizeBackupMessage(message);
        previewContent.innerHTML = '<div class="' + (className || 'loading-backup') + '">' + escapeHTML(text) + '</div>';
      };
      backupPreviewErrorRenderer();
    }

    function resetBackupSelection() {
      backupPreviewRequestToken += 1;
      selectedBackup = null;
      currentBackupPreview = null;
      backupPreviewErrorRenderer = null;
      resetRestoreUploadInput();

      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = true;
        confirmRestoreBtn.removeAttribute('data-i18n-title');
        confirmRestoreBtn.title = '';
      }

      const exportBackupBtn = document.getElementById('exportBackupBtn');
      if (exportBackupBtn) {
        exportBackupBtn.disabled = true;
        exportBackupBtn.removeAttribute('data-i18n-title');
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
          statusElement.textContent = t('restoreLoadedMore', { count: backupList.length });
        } else {
          statusElement.textContent = t('restoreLoadedAll', { count: backupList.length });
        }
      }

      if (loadMoreBtn) {
        const shouldShow = backupList.length > 0 && (backupListHasMore || backupListLoading);
        loadMoreBtn.style.display = shouldShow ? '' : 'none';
        loadMoreBtn.disabled = backupListLoading || !backupListHasMore;
        const labelKey = backupListLoading ? 'loading' : 'restoreLoadMore';
        loadMoreBtn.setAttribute('data-i18n', labelKey);
        loadMoreBtn.textContent = t(labelKey);
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

    // 立即为当前数据创建一份备份（也会推送到已启用的远程存储），完成后刷新列表
    async function createBackupNow() {
      const button = document.getElementById('createBackupBtn');
      if (button) button.disabled = true;
      try {
        const response = await authenticatedFetch('/api/backup', { method: 'POST' });
        if (!response.ok) {
          throw await readBackupErrorResponse(response);
        }
        showCenterToast('✅', t('backupCreatedSuccess'));
        await loadBackupList();
      } catch (error) {
        console.error('创建备份失败:', error);
        showCenterToast('❌', localizeBackupMessage(error.message));
      } finally {
        if (button) button.disabled = false;
      }
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

      // A full reload replaces a load in progress (for example the first list load while a new
      // backup is created), and the older response is ignored; "load more" waits its turn.
      if (!backupSelectElement || (append && backupListLoading)) {
        return;
      }
      const requestToken = ++backupListRequestToken;

      if (!append) {
        backupListErrorRenderer = null;
        backupList = [];
        backupListCursor = null;
        backupListHasMore = false;
        backupSelectElement.innerHTML = '<option value="" data-i18n="restoreLoadingList">' + escapeHTML(t('restoreLoadingList')) + '</option>';
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
          throw new Error(t('restoreListFailed'));
        }

        const data = await response.json();
        if (requestToken !== backupListRequestToken) {
          return;
        }
        const nextBackups = data.backups || [];
        backupList = append ? backupList.concat(nextBackups) : nextBackups;
        backupListCursor = data.pagination && data.pagination.hasMore ? data.pagination.cursor : null;
        backupListHasMore = Boolean(data.pagination && data.pagination.hasMore && data.pagination.cursor);

        if (backupList.length === 0) {
          backupSelectElement.innerHTML = '<option value="" data-i18n="restoreNoBackups">' + escapeHTML(t('restoreNoBackups')) + '</option>';
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
        if (requestToken !== backupListRequestToken) {
          return;
        }
        console.error('加载备份列表失败:', error);

        if (!append) {
          backupListErrorRenderer = () => { backupSelectElement.innerHTML = '<option value="">' + escapeHTML(t('restoreListFailed') + ': ' + localizeBackupMessage(error.message)) + '</option>'; };
          backupListErrorRenderer();
          backupSelectElement.disabled = true;
          resetBackupSelection();
        } else {
          showCenterToast('❌', t('restoreMoreFailed') + ': ' + localizeBackupMessage(error.message));
        }
      } finally {
        if (requestToken === backupListRequestToken) {
          backupListLoading = false;
          updateBackupListPagination();
        }
      }
    }

    function renderBackupSelect(backups, selectedBackupKey = '') {
      const backupSelectElement = document.getElementById('backupSelect');
      backupSelectElement.innerHTML = '<option value="" data-i18n="restoreSelectPlaceholder">' + escapeHTML(t('restoreSelectPlaceholder')) + '</option>';

      backups.forEach((backup, index) => {
        // 格式化日期为简洁格式，适配移动设备
        const date = new Date(backup.created);
        
        // 移动端优化：格式 "年-月-日 时:分 | 数量个"
        // 例如：2025-11-24 19:50 | 117个
        const backupTime = formatI18nDate(date, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const formatLabel = getBackupExportFormatLabel(getBackupStoredFormat(backup));
        const optionText = backupTime + ' | ' + formatLabel + ' | ' + t('restoreEntryCount', { count: backup.count || 0 });

        const option = document.createElement('option');
        option.value = index;
        option.textContent = optionText;
        option.dataset.backupKey = backup.key;
        // 保存完整时间信息在 title 属性中，用于悬停提示
        option.title = formatI18nDate(backup.created) + ' | ' + formatLabel;
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
        resetRestoreUploadInput();
        selectBackup(backup, parseInt(selectedIndex));
      }
    }

    async function handleRestoreBackupFile(event) {
      const file = event && event.target && event.target.files ? event.target.files[0] : null;
      if (!file) {
        return;
      }

      const fileName = file.name || '';
      const requestToken = ++backupPreviewRequestToken;
      const backupSelectElement = document.getElementById('backupSelect');
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');

      selectedBackup = null;
      currentBackupPreview = null;
      if (backupSelectElement) {
        backupSelectElement.value = '';
      }
      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = true;
        confirmRestoreBtn.setAttribute('data-i18n-title', 'restoreReadingFile');
          confirmRestoreBtn.title = t('restoreReadingFile');
      }
      if (exportBackupBtn) {
        exportBackupBtn.disabled = true;
        exportBackupBtn.setAttribute('data-i18n-title', 'restoreNoUploadExport');
          exportBackupBtn.title = t('restoreNoUploadExport');
      }

      if (!BACKUP_UPLOAD_FILE_REGEX.test(fileName)) {
        setRestoreUploadStatus(() => t('restoreInvalidFileName'), true);
        showRestorePreviewMessage(() => t('restoreInvalidFileName'), 'no-backups');
        return;
      }

      if (file.size > BACKUP_UPLOAD_MAX_BYTES) {
        const maxLabel = formatBackupUploadSize(BACKUP_UPLOAD_MAX_BYTES);
        setRestoreUploadStatus(() => t('restoreFileTooLarge', { size: maxLabel }), true);
        showRestorePreviewMessage(() => t('restoreFileTooLarge', { size: maxLabel }), 'no-backups');
        return;
      }

      setRestoreUploadStatus(() => t('restoreReadingUpload', { name: fileName, size: formatBackupUploadSize(file.size) }), false);
      showRestorePreviewMessage(() => t('restoreReadingFile'), 'loading-backup');

      try {
        const content = await readRestoreBackupFile(file);
        if (requestToken !== backupPreviewRequestToken) {
          return;
        }
        if (!content) {
          throw new Error(t('restoreEmptyFile'));
        }

        const uploadedBackup = {
          key: fileName,
          created: new Date().toISOString(),
          count: 0,
          format: getBackupFormatFromFileName(fileName),
          uploaded: true,
          content
        };
        selectedBackup = uploadedBackup;
        setRestoreUploadStatus(() => t('restoreSelectedUpload', { name: fileName, size: formatBackupUploadSize(file.size) }), false);
        await showBackupPreview(uploadedBackup, requestToken);
      } catch (error) {
        if (requestToken !== backupPreviewRequestToken) {
          return;
        }
        console.error('读取上传备份文件失败:', error);
        selectedBackup = null;
        currentBackupPreview = null;
        if (confirmRestoreBtn) {
          confirmRestoreBtn.disabled = true;
          confirmRestoreBtn.setAttribute('data-i18n-title', 'restoreReadBlocked');
          confirmRestoreBtn.title = t('restoreReadBlocked');
        }
        setRestoreUploadStatus(() => t('restoreReadFailed') + ': ' + localizeBackupMessage(error.message), true);
        showRestorePreviewMessage(() => t('restoreReadFailed') + ': ' + localizeBackupMessage(error.message), 'no-backups');
      }
    }

    async function selectBackup(backup, index) {
      selectedBackup = backup;
      currentBackupPreview = null;
      backupPreviewErrorRenderer = null;
      const requestToken = ++backupPreviewRequestToken;
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');

      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = true;
        confirmRestoreBtn.setAttribute('data-i18n-title', 'restoreLoadingPreview');
          confirmRestoreBtn.title = t('restoreLoadingPreview');
      }
      if (exportBackupBtn) {
        exportBackupBtn.disabled = true;
        exportBackupBtn.setAttribute('data-i18n-title', 'restoreLoadingPreview');
          exportBackupBtn.title = t('restoreLoadingPreview');
      }

      // 显示备份预览
      await showBackupPreview(backup, requestToken);
    }

    async function showBackupPreview(backup, requestToken) {
      backupPreviewErrorRenderer = null;
      const previewElement = document.getElementById('restorePreview');
      const previewContent = document.getElementById('backupPreviewContent');
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');

      previewElement.style.display = 'block';
      previewContent.innerHTML = '<div class="loading-backup" data-i18n="restoreLoadingPreview">' + escapeHTML(t('restoreLoadingPreview')) + '</div>';

      try {
        const isUploadedBackup = backup && backup.uploaded === true;
        const requestBody = isUploadedBackup
          ? { backupFileName: backup.key, backupContent: backup.content, preview: true }
          : { backupKey: backup.key, preview: true };
        const response = await authenticatedFetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }

        if (!response.ok) {
          const failure = await readBackupErrorResponse(response);
          if (!isActiveBackupPreviewRequest(backup, requestToken)) {
            return;
          }
          throw failure;
        }

        const responseData = await response.json();
        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }
        const data = responseData.data || responseData; // 兼容不同的响应格式

        currentBackupPreview = { backup, data };
        renderBackupPreview(backup, data);
      } catch (error) {
        if (!isActiveBackupPreviewRequest(backup, requestToken)) {
          return;
        }
        console.error('加载备份预览失败:', error);
        if (confirmRestoreBtn) {
          confirmRestoreBtn.disabled = true;
          confirmRestoreBtn.setAttribute('data-i18n-title', 'restorePreviewBlocked');
          confirmRestoreBtn.title = t('restorePreviewBlocked');
        }
        if (exportBackupBtn) {
          exportBackupBtn.disabled = true;
          exportBackupBtn.setAttribute('data-i18n-title', 'restorePreviewBlocked');
          exportBackupBtn.title = t('restorePreviewBlocked');
        }
        backupPreviewErrorRenderer = () => {
          previewContent.innerHTML = '<div class="no-backups">' + escapeHTML(t('restorePreviewFailed') + ': ' + localizeBackupMessage(error.message)) +
            backupWarningListHTML(backupWarningEntries(error.warnings, false)) + '</div>';
          if (confirmRestoreBtn) {
            confirmRestoreBtn.setAttribute('data-i18n-title', 'restorePreviewBlocked');
            confirmRestoreBtn.title = t('restorePreviewBlocked');
          }
          if (exportBackupBtn) {
            exportBackupBtn.setAttribute('data-i18n-title', 'restorePreviewBlocked');
            exportBackupBtn.title = t('restorePreviewBlocked');
          }
        };
        backupPreviewErrorRenderer();
      }
    }

    // The label the account card shows, also for older blank names. Display
    // only: the data itself keeps the stored name.
    function backupSecretDisplayName(secret) {
      if (typeof getSecretDisplayName === 'function') return getSecretDisplayName(secret);
      const name = secret && typeof secret.name === 'string' ? secret.name : '';
      return name.trim() ? name : t('transferUnnamed');
    }

    // Accounts the server keeps although their OTP parameters are unsupported.
    function backupUnsupportedCount(data) {
      const count = data && data.unsupportedCount;
      return Number.isSafeInteger(count) && count > 0 ? count : 0;
    }

    function renderBackupPreview(backup, data) {
      const isUploadedBackup = backup && backup.uploaded === true;
      const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
      const exportBackupBtn = document.getElementById('exportBackupBtn');
      const previewContent = document.getElementById('backupPreviewContent');
      if (!previewContent) return;
        const formatLabel = getBackupExportFormatLabel(getBackupStoredFormat({ format: data.format || backup.format }));
        const sourceLabel = t(isUploadedBackup ? 'restoreSourceUpload' : 'restoreSourceKV');
        const encryptedLabel = t(data.encrypted ? 'restoreEncrypted' : 'restorePlaintext');
        const skippedInvalidCount = Number(data.skippedInvalidCount || 0);
        const isPartialBackup = data.partial === true || skippedInvalidCount > 0;
        const hasSecrets = Array.isArray(data.secrets) && data.secrets.length > 0;
        const isEmptyBackup = !isPartialBackup && !hasSecrets && Number(data.count || 0) === 0;
        const warningMessage = isPartialBackup ? t('restorePartialWarning', { count: skippedInvalidCount }) : '';
        const warningDetails = Array.isArray(data.warnings) && data.warnings.length > 0 ? localizeBackupMessage(data.warnings[0]) : '';
        const warningEntries = backupWarningEntries(data.warnings, true);
        const issues = currentBackupPreview && currentBackupPreview.backup === backup ? currentBackupPreview.issues : null;
        const actionIssues = issues
          ? '<div class="dialog-warning" role="alert">' +
              dialogIcon('warning') + ' ' + escapeHTML(issues.label() + localizeBackupMessage(issues.message)) +
              backupWarningListHTML(backupWarningEntries(issues.warnings, false)) +
            '</div>'
          : '';
        const emptyBackupMessage = isEmptyBackup ? t('restoreEmptyWarning') : '';
        // Kept entries the web app cannot show. They do not block the restore:
        // the server keeps them unchanged, so nothing is lost.
        const unsupportedCount = backupUnsupportedCount(data);
        const previewUnsupported = unsupportedCount > 0
          ? '<div class="dialog-warning backup-unsupported-notice" role="status">' +
              dialogIcon('info') + ' ' + escapeHTML(t('restoreUnsupportedNotice', { count: unsupportedCount })) +
              backupWarningListHTML(backupWarningEntries(data.unsupportedWarnings, false)) +
            '</div>'
          : '';
        const previewSummary =
          '<dl class="dialog-backup-summary">' +
            '<div>' +
              '<dt data-i18n="restoreFormatLabel">' + escapeHTML(t('restoreFormatLabel')) + '</dt>' +
              '<dd>' + escapeHTML(formatLabel) + '</dd>' +
            '</div>' +
            '<div>' +
              '<dt data-i18n="restoreCountLabel">' + escapeHTML(t('restoreCountLabel')) + '</dt>' +
              '<dd>' + escapeHTML(t('restoreEntryCount', { count: data.count || 0 })) + '</dd>' +
            '</div>' +
            '<div>' +
              '<dt data-i18n="restoreStorageLabel">' + escapeHTML(t('restoreStorageLabel')) + '</dt>' +
              '<dd>' + encryptedLabel + '</dd>' +
            '</div>' +
            '<div>' +
              '<dt data-i18n="restoreSourceLabel">' + escapeHTML(t('restoreSourceLabel')) + '</dt>' +
              '<dd>' + escapeHTML(sourceLabel) + '</dd>' +
            '</div>' +
          '</dl>';
        const previewWarning = isPartialBackup
          ? '<div class="dialog-warning" role="status">' +
              dialogIcon('warning') + ' ' + escapeHTML(warningMessage) +
              (warningDetails ? '<p>' + escapeHTML(warningDetails) + '</p>' : '') +
              backupWarningListHTML(warningEntries) +
            '</div>'
          : '';
        const previewEmptyWarning = isEmptyBackup
          ? '<div class="dialog-warning" role="status">' +
              dialogIcon('warning') + ' ' + escapeHTML(emptyBackupMessage) +
            '</div>'
          : '';

        if (confirmRestoreBtn && confirmRestoreBtn.getAttribute('data-i18n') !== 'restoreInProgress') {
          confirmRestoreBtn.removeAttribute('data-i18n-title');
          confirmRestoreBtn.disabled = isPartialBackup || isEmptyBackup || Boolean(issues && issues.warnings.length);
          confirmRestoreBtn.title = isPartialBackup ? warningMessage : (isEmptyBackup ? emptyBackupMessage : '');
        }
        if (exportBackupBtn) {
          exportBackupBtn.removeAttribute('data-i18n-title');
          exportBackupBtn.disabled = isUploadedBackup || isPartialBackup || Boolean(issues && issues.warnings.length);
          exportBackupBtn.title = isUploadedBackup ? t('restoreNoUploadExport') : (isPartialBackup ? warningMessage : '');
        }

        if (hasSecrets) {
          previewContent.innerHTML =
            previewSummary +
            actionIssues +
            previewWarning +
            previewUnsupported +
            previewEmptyWarning +
            '<div class="backup-table-container">' +
              '<table class="backup-table">' +
                '<thead>' +
                  '<tr>' +
                    '<th data-i18n="restoreServiceLabel">' + escapeHTML(t('restoreServiceLabel')) + '</th>' +
                    '<th data-i18n="restoreAccountLabel">' + escapeHTML(t('restoreAccountLabel')) + '</th>' +
                    '<th data-i18n="restoreTypeLabel">' + escapeHTML(t('restoreTypeLabel')) + '</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' +
                  data.secrets.map(secret =>
                    '<tr class="backup-table-row">' +
                      '<td class="service-name">' + escapeHTML(backupSecretDisplayName(secret)) + '</td>' +
                      '<td class="account-info">' + escapeHTML(secret.account || secret.service || t('restoreNoAccount')) + '</td>' +
                      '<td class="secret-type">' + escapeHTML(secret.type || 'TOTP') + '</td>' +
                    '</tr>'
                  ).join('') +
                '</tbody>' +
              '</table>' +
            '</div>';
        } else {
          previewContent.innerHTML = previewSummary + actionIssues + previewWarning + previewUnsupported + previewEmptyWarning + '<div class="no-backups" data-i18n="restoreNoKeys">' + escapeHTML(t('restoreNoKeys')) + '</div>';
        }
    }

    function refreshBackupTranslations() {
      if (typeof getCachedDefaultExportFormat === 'function') updateBackupDefaultExportButton();
      updateBackupListPagination();
      if (backupListErrorRenderer) backupListErrorRenderer();
      if (backupPreviewErrorRenderer) backupPreviewErrorRenderer();
      const uploadStatus = document.getElementById('restoreUploadStatus');
      if (uploadStatus && restoreUploadStatusRenderer) uploadStatus.textContent = restoreUploadStatusRenderer();
      if (backupList.length && document.getElementById('backupSelect')) {
        renderBackupSelect(backupList, selectedBackup?.key || '');
      }
      if (currentBackupPreview && selectedBackup?.key === currentBackupPreview.backup.key) {
        renderBackupPreview(currentBackupPreview.backup, currentBackupPreview.data);
      }
    }

    async function confirmRestore() {
      if (!selectedBackup) {
        showCenterToast('❌', t('restoreChooseFirst'));
        return;
      }

      const backupLabel = selectedBackup.key.replace('backup_', '').replace(/\\.(json|txt|csv|html)$/i, '');
      const confirmed = await showConfirmDialog({
        i18n: { title: 'restoreConfirmTitle', message: 'restoreConfirmMessage', confirmText: 'restoreAction', cancelText: 'cancel', params: { name: backupLabel } },
        title: t('restoreConfirmTitle'),
        message: t('restoreConfirmMessage', { name: backupLabel }),
        confirmText: t('restoreAction'),
        cancelText: t('cancel'),
        danger: true
      });

      if (!confirmed) {
        return;
      }

      const confirmBtn = document.getElementById('confirmRestoreBtn');
      const restoredBackup = selectedBackup;
      let restoreIssues = null;
      confirmBtn.setAttribute('data-i18n', 'restoreInProgress');
      confirmBtn.textContent = t('restoreInProgress');
      confirmBtn.disabled = true;

      try {
        const requestBody = selectedBackup.uploaded === true
          ? { backupFileName: selectedBackup.key, backupContent: selectedBackup.content }
          : { backupKey: selectedBackup.key };
        const response = await authenticatedFetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw await readBackupErrorResponse(response);
        }

        const result = await response.json();
        const unsupported = backupUnsupportedCount(result);
        showCenterToast('✅', unsupported > 0
          ? t('restoreCompletedWithUnsupported', { count: result.count, unsupported })
          : t('restoreCompleted', { count: result.count }));

        // 关闭模态框并刷新页面；the longer note about kept entries needs time to be read.
        hideRestoreModal();
        setTimeout(() => {
          location.reload();
        }, unsupported > 0 ? 4000 : 1000);

      } catch (error) {
        console.error('还原失败:', error);
        showCenterToast('❌', t('restoreFailed') + ': ' + localizeBackupMessage(error.message));
        restoreIssues = error;
      } finally {
        confirmBtn.setAttribute('data-i18n', 'restoreConfirm');
        confirmBtn.textContent = t('restoreConfirm');
        confirmBtn.disabled = false;
        if (restoreIssues && Array.isArray(restoreIssues.warnings) && restoreIssues.warnings.length) {
          showBackupActionIssues(restoredBackup, () => t('restoreFailed') + ': ', restoreIssues);
        }
      }
    }

    // 显示备份导出格式选择模态框
    function exportSelectedBackup() {
      if (!selectedBackup) {
        showCenterToast('❌', t('restoreChooseFirst'));
        return;
      }
      if (selectedBackup.uploaded === true) {
        showCenterToast('ℹ️', t('restoreNoUploadExport'));
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
        showCenterToast('❌', t('restoreChooseFirst'));
        return;
      }
      const exportedBackup = selectedBackup;

      try {
        showCenterToast('ℹ️', t('transferExportingBackup'));

        const exportUrl = '/api/backup/export/' + selectedBackup.key + '?format=' + format + '&language=' + encodeURIComponent(getLanguage());
        const response = await authenticatedFetch(exportUrl);

        if (!response.ok) {
          throw await readBackupErrorResponse(response);
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
          'txt': t('transferOTPAuthText'),
          'json': t('transferJSONData'),
          'csv': t('transferCSVTable'),
          'html': 'HTML'
        };
        const formatName = formatNames[format] || format.toUpperCase();
        showCenterToast('✅', t('transferBackupExported', { format: formatName }));
      } catch (error) {
        console.error('导出备份失败:', error);
        showCenterToast('❌', t('transferExportFailedPrefixASCII') + localizeBackupMessage(error.message));
        if (Array.isArray(error.warnings) && error.warnings.length) {
          showBackupActionIssues(exportedBackup, () => t('transferExportFailedPrefixASCII'), error);
        }
      }
    }
`;
}
