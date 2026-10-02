/**
 * OneDrive sync tool UI module.
 */

export function getOneDriveToolCode() {
	return `
    // ==================== OneDrive 同步工具 ====================

    let _oneDriveOnClose = null;
    let _oneDriveOAuthListenerReady = false;
    let _oneDriveExpectedCallbackOrigin = null;

    function showOneDriveModal(onClose) {
      _oneDriveOnClose = typeof onClose === 'function' ? onClose : null;
      _ensureOneDriveOAuthListener();
      showModal('oneDriveModal', () => {
        loadOneDriveDestinations();
      });
    }

    function hideOneDriveModal() {
      const onClose = _oneDriveOnClose;
      _oneDriveOnClose = null;
      hideModal('oneDriveModal', onClose);
    }

    function _ensureOneDriveOAuthListener() {
      if (_oneDriveOAuthListenerReady) return;
      _oneDriveOAuthListenerReady = true;

      window.addEventListener('message', function(event) {
        const allowedOrigins = [window.location.origin];
        if (_oneDriveExpectedCallbackOrigin) {
          allowedOrigins.push(_oneDriveExpectedCallbackOrigin);
        }
        if (!allowedOrigins.includes(event.origin)) return;
        const data = event.data || {};
        if (data.type !== 'cloudBackupAuthComplete' || data.provider !== 'onedrive') return;

        _oneDriveExpectedCallbackOrigin = null;
        loadOneDriveDestinations();
        const icon = data.severity === 'warning' ? '⚠️' : (data.success ? '✅' : '❌');
        showCenterToast(icon, data.message || (data.success ? t('toolSyncAuthSucceeded', { provider: 'OneDrive' }) : t('toolSyncAuthFailed', { provider: 'OneDrive' })));
      });
    }

    function _escapeOneDriveHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let _oneDriveDestinationState = null;
    let _oneDriveLoadVersion = 0;
    // 表单每次打开、换成另一个目标或关闭时加一，迟到的保存结果据此判断表单是否还是原来那个
    let _oneDriveFormVersion = 0;

    async function loadOneDriveDestinations(preserveForm = false) {
      const loadVersion = ++_oneDriveLoadVersion;
      const addBtn = document.getElementById('oneDriveAddBtn');
      const warningEl = document.getElementById('oneDriveOauthWarning');

      try {
        const response = await authenticatedFetch('/api/onedrive/config');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || t('toolSyncLoadRetry'));
        if (loadVersion !== _oneDriveLoadVersion) return;

        if (warningEl) {
          if (data.oauthConfigured) {
            warningEl.style.display = 'none';
          } else {
            warningEl.style.display = 'block';
            warningEl.textContent = t('toolSyncOAuthMissing', { provider: 'OneDrive' });
          }
        }

        _oneDriveDestinationState = data;
        _refreshOneDriveTranslations();

        const canAdd = data.count < data.maxAllowed;
        addBtn.dataset.canAdd = canAdd ? 'true' : 'false';
        if (!preserveForm) addBtn.style.display = canAdd ? 'block' : 'none';
        if (!preserveForm) hideOneDriveForm();
      } catch (error) {
        if (loadVersion !== _oneDriveLoadVersion) return;
        console.error('加载 OneDrive 配置失败:', error);
        _oneDriveDestinationState = { loadFailed: true };
        _refreshOneDriveTranslations();
      }
    }

    function _refreshOneDriveTranslations() {
      const listEl = document.getElementById('oneDriveDestinationList');
      if (!listEl || !_oneDriveDestinationState) return;
      if (_oneDriveDestinationState.loadFailed) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: var(--dialog-caption-size);">' + t('toolSyncLoadRetry') + '</div>';
        return;
      }
        if (_oneDriveDestinationState.destinations && _oneDriveDestinationState.destinations.length > 0) {
          listEl.innerHTML = _oneDriveDestinationState.destinations.map(dest => _renderOneDriveCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: var(--dialog-caption-size);">' + t('toolSyncEmpty', { provider: 'OneDrive' }) + '</div>';
        }

      const warning = document.getElementById('oneDriveOauthWarning');
      if (warning && !_oneDriveDestinationState.oauthConfigured) {
        warning.textContent = t('toolSyncOAuthMissing', { provider: 'OneDrive' });
      }

    }

    function _renderOneDriveCard(dest) {
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
        ? ((dest.account.displayName || t('toolSyncAccount', { provider: 'OneDrive' })) + (dest.account.email ? ' · ' + dest.account.email : ''))
        : t('toolSyncUnauthorized');

      return '<div class="dest-card ' + enabledClass + '" data-id="' + _escapeOneDriveHtml(dest.id) + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeOneDriveHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeOneDriveHtml(accountText) + '</span>'
        + '<span class="dest-card-url">' + t('toolSyncAppFolder') + ' ' + _escapeOneDriveHtml(dest.config.folderPath || '/2FA-Backups') + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" aria-label="' + t('toolSyncEnabledLabel') + '" ' + (dest.enabled ? 'checked' : '') + ' ' + (!dest.authorized ? 'disabled ' : '') + 'onchange="toggleOneDriveDest(this.closest(\\'.dest-card\\').dataset.id, this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeOneDriveHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); authorizeOneDriveDest(this.closest(\\'.dest-card\\').dataset.id)" >' + (dest.authorized ? t('toolSyncReauthorize') : t('toolSyncAuthorize')) + '</button>'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editOneDriveDest(this.closest(\\'.dest-card\\').dataset.id)" >' + t('edit') + '</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteOneDriveDest(this.closest(\\'.dest-card\\').dataset.id, this.closest(\\'.dest-card\\').querySelector(\\'.dest-card-name\\').textContent)" >' + t('delete') + '</button>'
        + '</div>'
        + '</div>';
    }

    function showOneDriveForm(id) {
      _oneDriveFormVersion++;
      const formArea = document.getElementById('oneDriveFormArea');
      const addBtn = document.getElementById('oneDriveAddBtn');
      formArea.style.display = 'block';
      addBtn.style.display = 'none';

      if (!id) {
        document.getElementById('oneDriveEditId').value = '';
        document.getElementById('oneDriveName').value = '';
        document.getElementById('oneDriveFolderPath').value = '/2FA-Backups';
      }
    }

    function hideOneDriveForm() {
      _oneDriveFormVersion++;
      document.getElementById('oneDriveFormArea').style.display = 'none';
      const addBtn = document.getElementById('oneDriveAddBtn');
      if (addBtn && addBtn.dataset.canAdd !== 'false') {
        addBtn.style.display = 'block';
      }
    }

    async function editOneDriveDest(id) {
      try {
        const response = await authenticatedFetch('/api/onedrive/config');
        const data = await response.json();
        const dest = data.destinations.find(d => d.id === id);
        if (!dest) return;

        document.getElementById('oneDriveEditId').value = dest.id;
        document.getElementById('oneDriveName').value = dest.name;
        document.getElementById('oneDriveFolderPath').value = dest.config.folderPath || '/2FA-Backups';
        showOneDriveForm(id);
      } catch (error) {
        showCenterToast('❌', t('toolSyncLoadError', { message: error.message }));
      }
    }

    async function _upsertOneDriveConfig() {
      const id = document.getElementById('oneDriveEditId').value;
      const name = document.getElementById('oneDriveName').value.trim();
      const folderPath = document.getElementById('oneDriveFolderPath').value.trim() || '/2FA-Backups';

      if (!name) {
        showCenterToast('⚠️', t('toolSyncNameRequired'));
        return null;
      }

      const body = { name, folderPath };
      if (id) body.id = id;

      const response = await authenticatedFetch('/api/onedrive/config', {
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

    async function saveOneDriveConfig() {
      const saveBtn = document.getElementById('oneDriveSaveBtn');
      const originalText = saveBtn.textContent;
      const originalI18nKey = saveBtn.dataset.i18n;
      saveBtn.dataset.i18n = 'saving';
      saveBtn.textContent = t('saving');
      saveBtn.disabled = true;

      try {
        const data = await _upsertOneDriveConfig();
        if (!data) return;

        showCenterToast('✅', t('toolSyncSaved', { provider: 'OneDrive' }));
        loadOneDriveDestinations();
      } catch (error) {
        showCenterToast('❌', t('toolSyncSaveError', { message: error.message }));
      } finally {
        if (originalI18nKey) saveBtn.dataset.i18n = originalI18nKey;
        else delete saveBtn.dataset.i18n;
        saveBtn.textContent = originalI18nKey ? t(originalI18nKey) : originalText;
        saveBtn.disabled = false;
      }
    }

    async function authorizeOneDriveDest(id, options = {}) {
      let targetId = id;
      const authBtn = document.getElementById('oneDriveAuthorizeBtn');
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
          const formVersion = _oneDriveFormVersion;
          const saved = await _upsertOneDriveConfig().catch((error) => {
            showCenterToast('❌', t('toolSyncSaveError', { message: error.message }));
            return null;
          });
          if (!saved) return;
          targetId = saved.id;
          // 记住新建目标的 id，授权启动失败后再点会更新同一目标，而不是再新建一个；
          // 保存期间表单已关闭或换成别的目标时不回写，以免下次保存改到这个目标
          if (formVersion === _oneDriveFormVersion) {
            document.getElementById('oneDriveEditId').value = targetId;
          }
        }

        const popup = window.open('about:blank', 'onedrive-oauth', 'width=560,height=720');

        const response = await authenticatedFetch('/api/onedrive/oauth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetId })
        });
        const data = await response.json();

        if (!response.ok || !data.success || !data.authorizeUrl) {
          if (popup && !popup.closed) popup.close();
          throw new Error(data.message || t('toolSyncAuthStartFailed'));
        }

        _oneDriveExpectedCallbackOrigin = _resolveOneDriveCallbackOrigin(data.callbackOrigin);

        if (popup) {
          popup.location.href = data.authorizeUrl;
        } else {
          window.location.href = data.authorizeUrl;
        }

        showCenterToast('ℹ️', t('toolSyncAuthPopup', { provider: 'OneDrive' }));
        loadOneDriveDestinations();
      } catch (error) {
        _oneDriveExpectedCallbackOrigin = null;
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

    function _resolveOneDriveCallbackOrigin(callbackOrigin) {
      if (!callbackOrigin) return window.location.origin;
      try {
        return new URL(callbackOrigin).origin;
      } catch {
        return window.location.origin;
      }
    }

    async function deleteOneDriveDest(id, name) {
      const confirmed = await showConfirmDialog({
        i18n: { title: 'toolSyncDeleteTitle', message: 'toolSyncDeleteConfirm', confirmText: 'delete', cancelText: 'cancel', params: { provider: 'OneDrive', name } },
        title: t('toolSyncDeleteTitle', { provider: 'OneDrive' }),
        message: t('toolSyncDeleteConfirm', { provider: 'OneDrive', name }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/onedrive/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', t('toolSyncDeleted', { provider: 'OneDrive' }));
          loadOneDriveDestinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncDeleteFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncDeleteError', { message: error.message }));
      }
    }

    async function toggleOneDriveDest(id, enabled) {
      try {
        const response = await authenticatedFetch('/api/onedrive/toggle', {
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
        loadOneDriveDestinations();
      } catch (error) {
        showCenterToast('❌', t('toolSyncOperationError', { message: error.message }));
        loadOneDriveDestinations();
      }
    }
`;
}
