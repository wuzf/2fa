/**
 * Google Drive sync tool UI module.
 */

export function getGoogleDriveToolCode() {
	return `
    // ==================== Google Drive 同步工具 ====================

    let _googleDriveOnClose = null;
    let _googleDriveOAuthListenerReady = false;
    let _googleDriveExpectedCallbackOrigin = null;

    function showGoogleDriveModal(onClose) {
      _googleDriveOnClose = typeof onClose === 'function' ? onClose : null;
      _ensureGoogleDriveOAuthListener();
      showModal('googleDriveModal', () => {
        loadGoogleDriveDestinations();
      });
    }

    function hideGoogleDriveModal() {
      const onClose = _googleDriveOnClose;
      _googleDriveOnClose = null;
      hideModal('googleDriveModal', onClose);
    }

    function _ensureGoogleDriveOAuthListener() {
      if (_googleDriveOAuthListenerReady) return;
      _googleDriveOAuthListenerReady = true;

      window.addEventListener('message', function(event) {
        const allowedOrigins = [window.location.origin];
        if (_googleDriveExpectedCallbackOrigin) {
          allowedOrigins.push(_googleDriveExpectedCallbackOrigin);
        }
        if (!allowedOrigins.includes(event.origin)) return;
        const data = event.data || {};
        if (data.type !== 'cloudBackupAuthComplete' || data.provider !== 'gdrive') return;

        _googleDriveExpectedCallbackOrigin = null;
        loadGoogleDriveDestinations();
        const icon = data.severity === 'warning' ? '⚠️' : (data.success ? '✅' : '❌');
        showCenterToast(icon, data.message || (data.success ? t('toolSyncAuthSucceeded', { provider: 'Google Drive' }) : t('toolSyncAuthFailed', { provider: 'Google Drive' })));
      });
    }

    function _escapeGoogleDriveHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let _googleDriveDestinationState = null;
    let _googleDriveLoadVersion = 0;
    // 表单每次打开、换成另一个目标或关闭时加一，迟到的保存结果据此判断表单是否还是原来那个
    let _googleDriveFormVersion = 0;

    async function loadGoogleDriveDestinations(preserveForm = false) {
      const loadVersion = ++_googleDriveLoadVersion;
      const addBtn = document.getElementById('googleDriveAddBtn');
      const warningEl = document.getElementById('googleDriveOauthWarning');

      try {
        const response = await authenticatedFetch('/api/gdrive/config');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || t('toolSyncLoadRetry'));
        if (loadVersion !== _googleDriveLoadVersion) return;

        if (warningEl) {
          if (data.oauthConfigured) {
            warningEl.style.display = 'none';
          } else {
            warningEl.style.display = 'block';
            warningEl.textContent = t('toolSyncOAuthMissing', { provider: 'Google Drive' });
          }
        }

        _googleDriveDestinationState = data;
        _refreshGoogleDriveTranslations();

        const canAdd = data.count < data.maxAllowed;
        addBtn.dataset.canAdd = canAdd ? 'true' : 'false';
        if (!preserveForm) addBtn.style.display = canAdd ? 'block' : 'none';
        if (!preserveForm) hideGoogleDriveForm();
      } catch (error) {
        if (loadVersion !== _googleDriveLoadVersion) return;
        console.error('加载 Google Drive 配置失败:', error);
        _googleDriveDestinationState = { loadFailed: true };
        _refreshGoogleDriveTranslations();
      }
    }

    function _refreshGoogleDriveTranslations() {
      const listEl = document.getElementById('googleDriveDestinationList');
      if (!listEl || !_googleDriveDestinationState) return;
      if (_googleDriveDestinationState.loadFailed) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: var(--dialog-caption-size);">' + t('toolSyncLoadRetry') + '</div>';
        return;
      }
        if (_googleDriveDestinationState.destinations && _googleDriveDestinationState.destinations.length > 0) {
          listEl.innerHTML = _googleDriveDestinationState.destinations.map(dest => _renderGoogleDriveCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: var(--dialog-caption-size);">' + t('toolSyncEmpty', { provider: 'Google Drive' }) + '</div>';
        }

      const warning = document.getElementById('googleDriveOauthWarning');
      if (warning && !_googleDriveDestinationState.oauthConfigured) {
        warning.textContent = t('toolSyncOAuthMissing', { provider: 'Google Drive' });
      }

    }

    function _renderGoogleDriveCard(dest) {
      let statusDot = 'dest-status-dot-gray';
      let statusText = t('toolSyncUnauthorized');

      if (dest.status.lastError) {
        statusDot = 'dest-status-dot-red';
        statusText = t('toolSyncError', { message: dest.status.lastError.error });
      } else if (dest.status.lastSuccess) {
        statusDot = 'dest-status-dot-green';
        statusText = formatI18nDate(dest.status.lastSuccess.timestamp);
      } else if (dest.authorized) {
        statusText = t('toolSyncAuthorizedWaiting');
      }

      const enabledClass = dest.enabled ? '' : 'dest-card-disabled';
      const accountText = dest.account && (dest.account.email || dest.account.displayName)
        ? ((dest.account.displayName || t('toolSyncAccount', { provider: 'Google' })) + (dest.account.email ? ' · ' + dest.account.email : ''))
        : t('toolSyncUnauthorized');

      return '<div class="dest-card ' + enabledClass + '" data-id="' + _escapeGoogleDriveHtml(dest.id) + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeGoogleDriveHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeGoogleDriveHtml(accountText) + '</span>'
        + '<span class="dest-card-url">' + t('toolSyncBackupFolder') + ' ' + _escapeGoogleDriveHtml(dest.config.folderPath || '/2FA-Backups') + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" aria-label="' + t('toolSyncEnabledLabel') + '" ' + (dest.enabled ? 'checked' : '') + ' ' + (!dest.authorized ? 'disabled ' : '') + 'onchange="toggleGoogleDriveDest(this.closest(\\'.dest-card\\').dataset.id, this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeGoogleDriveHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); authorizeGoogleDriveDest(this.closest(\\'.dest-card\\').dataset.id)" >' + (dest.authorized ? t('toolSyncReauthorize') : t('toolSyncAuthorize')) + '</button>'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editGoogleDriveDest(this.closest(\\'.dest-card\\').dataset.id)" >' + t('edit') + '</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteGoogleDriveDest(this.closest(\\'.dest-card\\').dataset.id, this.closest(\\'.dest-card\\').querySelector(\\'.dest-card-name\\').textContent)" >' + t('delete') + '</button>'
        + '</div>'
        + '</div>';
    }

    function showGoogleDriveForm(id) {
      _googleDriveFormVersion++;
      const formArea = document.getElementById('googleDriveFormArea');
      const addBtn = document.getElementById('googleDriveAddBtn');
      formArea.style.display = 'block';
      addBtn.style.display = 'none';

      if (!id) {
        document.getElementById('googleDriveEditId').value = '';
        document.getElementById('googleDriveName').value = '';
        document.getElementById('googleDriveFolderPath').value = '/2FA-Backups';
      }
    }

    function hideGoogleDriveForm() {
      _googleDriveFormVersion++;
      document.getElementById('googleDriveFormArea').style.display = 'none';
      const addBtn = document.getElementById('googleDriveAddBtn');
      if (addBtn && addBtn.dataset.canAdd !== 'false') {
        addBtn.style.display = 'block';
      }
    }

    async function editGoogleDriveDest(id) {
      try {
        const response = await authenticatedFetch('/api/gdrive/config');
        const data = await response.json();
        const dest = data.destinations.find(d => d.id === id);
        if (!dest) return;

        document.getElementById('googleDriveEditId').value = dest.id;
        document.getElementById('googleDriveName').value = dest.name;
        document.getElementById('googleDriveFolderPath').value = dest.config.folderPath || '/2FA-Backups';
        showGoogleDriveForm(id);
      } catch (error) {
        showCenterToast('❌', t('toolSyncLoadError', { message: error.message }));
      }
    }

    async function _upsertGoogleDriveConfig() {
      const id = document.getElementById('googleDriveEditId').value;
      const name = document.getElementById('googleDriveName').value.trim();
      const folderPath = document.getElementById('googleDriveFolderPath').value.trim() || '/2FA-Backups';

      if (!name) {
        showCenterToast('⚠️', t('toolSyncNameRequired'));
        return null;
      }

      const body = { name, folderPath };
      if (id) body.id = id;

      const response = await authenticatedFetch('/api/gdrive/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || t('toolSyncSaveFailed'));
      }

      if (data.warning) {
        showCenterToast('⚠️', data.warning);
      }

      return data;
    }

    async function saveGoogleDriveConfig() {
      const saveBtn = document.getElementById('googleDriveSaveBtn');
      const originalText = saveBtn.textContent;
      const originalI18nKey = saveBtn.dataset.i18n;
      saveBtn.dataset.i18n = 'saving';
      saveBtn.textContent = t('saving');
      saveBtn.disabled = true;

      try {
        const data = await _upsertGoogleDriveConfig();
        if (!data) return;

        showCenterToast('✅', t('toolSyncSaved', { provider: 'Google Drive' }));
        loadGoogleDriveDestinations();
      } catch (error) {
        showCenterToast('❌', t('toolSyncSaveError', { message: error.message }));
      } finally {
        if (originalI18nKey) saveBtn.dataset.i18n = originalI18nKey;
        else delete saveBtn.dataset.i18n;
        saveBtn.textContent = originalI18nKey ? t(originalI18nKey) : originalText;
        saveBtn.disabled = false;
      }
    }

    async function authorizeGoogleDriveDest(id, options = {}) {
      let targetId = id;
      const authBtn = document.getElementById('googleDriveAuthorizeBtn');
      const hadFormButton = !!authBtn;
      const originalText = hadFormButton ? authBtn.textContent : '';
      const originalI18nKey = hadFormButton ? authBtn.dataset.i18n : null;

      if (hadFormButton) {
        authBtn.dataset.i18n = 'toolSyncAuthorizing';
        authBtn.textContent = t('toolSyncAuthorizing');
        authBtn.disabled = true;
      }

      try {
        if (options.saveForm) {
          const formVersion = _googleDriveFormVersion;
          const saved = await _upsertGoogleDriveConfig().catch((error) => {
            showCenterToast('❌', t('toolSyncSaveError', { message: error.message }));
            return null;
          });
          if (!saved) return;
          targetId = saved.id;
          // 记住新建目标的 id，授权启动失败后再点会更新同一目标，而不是再新建一个；
          // 保存期间表单已关闭或换成别的目标时不回写，以免下次保存改到这个目标
          if (formVersion === _googleDriveFormVersion) {
            document.getElementById('googleDriveEditId').value = targetId;
          }
        }

        const popup = window.open('about:blank', 'gdrive-oauth', 'width=560,height=720');

        const response = await authenticatedFetch('/api/gdrive/oauth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId })
        });
        const data = await response.json();

        if (!response.ok || !data.success || !data.authorizeUrl) {
          if (popup && !popup.closed) popup.close();
          throw new Error(data.message || t('toolSyncAuthStartFailed'));
        }

        _googleDriveExpectedCallbackOrigin = _resolveGoogleDriveCallbackOrigin(data.callbackOrigin);

        if (popup) {
          popup.location.href = data.authorizeUrl;
        } else {
          window.location.href = data.authorizeUrl;
        }

        showCenterToast('ℹ️', t('toolSyncAuthPopup', { provider: 'Google Drive' }));
        loadGoogleDriveDestinations();
      } catch (error) {
        _googleDriveExpectedCallbackOrigin = null;
        showCenterToast('❌', t('toolSyncAuthError', { message: error.message }));
      } finally {
        if (hadFormButton) {
          if (originalI18nKey) authBtn.dataset.i18n = originalI18nKey;
          else delete authBtn.dataset.i18n;
          authBtn.textContent = originalI18nKey ? t(originalI18nKey) : originalText;
          authBtn.disabled = false;
        }
      }
    }

    function _resolveGoogleDriveCallbackOrigin(callbackOrigin) {
      if (!callbackOrigin) return window.location.origin;
      try {
        return new URL(callbackOrigin).origin;
      } catch {
        return window.location.origin;
      }
    }

    async function deleteGoogleDriveDest(id, name) {
      const confirmed = await showConfirmDialog({
        i18n: { title: 'toolSyncDeleteTitle', message: 'toolSyncDeleteConfirm', confirmText: 'delete', cancelText: 'cancel', params: { provider: 'Google Drive', name } },
        title: t('toolSyncDeleteTitle', { provider: 'Google Drive' }),
        message: t('toolSyncDeleteConfirm', { provider: 'Google Drive', name }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/gdrive/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', t('toolSyncDeleted', { provider: 'Google Drive' }));
          loadGoogleDriveDestinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncDeleteFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncDeleteError', { message: error.message }));
      }
    }

    async function toggleGoogleDriveDest(id, enabled) {
      try {
        const response = await authenticatedFetch('/api/gdrive/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, enabled })
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', data.message);
        } else {
          showCenterToast('❌', data.message || t('toolSyncOperationFailed'));
        }
        loadGoogleDriveDestinations();
      } catch (error) {
        showCenterToast('❌', t('toolSyncOperationError', { message: error.message }));
        loadGoogleDriveDestinations();
      }
    }
`;
}
