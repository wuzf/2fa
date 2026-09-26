/**
 * WebDAV 同步工具模块
 * 提供多目标 WebDAV 配置管理 UI
 */

/**
 * 获取 WebDAV 工具代码
 * @returns {string} WebDAV 工具 JavaScript 代码
 */
export function getWebdavToolCode() {
	return `
    // ==================== WebDAV 同步工具（多目标） ====================

    let _webdavOnClose = null;

    function showWebdavModal(onClose) {
      _webdavOnClose = typeof onClose === 'function' ? onClose : null;
      showModal('webdavModal', () => {
        loadWebdavDestinations();
      });
    }

    function hideWebdavModal() {
      const onClose = _webdavOnClose;
      _webdavOnClose = null;
      hideModal('webdavModal', onClose);
    }

    let _webdavDestinationState = null;
    let _webdavLoadVersion = 0;

    async function loadWebdavDestinations(preserveForm = false) {
      const loadVersion = ++_webdavLoadVersion;
      const addBtn = document.getElementById('webdavAddBtn');

      try {
        const response = await authenticatedFetch('/api/webdav/config');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || t('toolSyncLoadRetry'));
        if (loadVersion !== _webdavLoadVersion) return;

        // 渲染目标列表
        _webdavDestinationState = data;
        _refreshWebdavTranslations();

        // 达到上限时隐藏添加按钮
        addBtn.dataset.canAdd = data.count < data.maxAllowed ? 'true' : 'false';

        // 隐藏表单
        if (!preserveForm) hideWebdavForm();
      } catch (error) {
        if (loadVersion !== _webdavLoadVersion) return;
        console.error('加载 WebDAV 配置失败:', error);
        _webdavDestinationState = { loadFailed: true };
        _refreshWebdavTranslations();
      }
    }

    function _refreshWebdavTranslations() {
      const listEl = document.getElementById('webdavDestinationList');
      if (!listEl || !_webdavDestinationState) return;
      if (_webdavDestinationState.loadFailed) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: var(--dialog-caption-size);">' + t('toolSyncLoadRetry') + '</div>';
        return;
      }
        if (_webdavDestinationState.destinations && _webdavDestinationState.destinations.length > 0) {
          listEl.innerHTML = _webdavDestinationState.destinations.map(dest => _renderWebdavCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: var(--dialog-caption-size);">' + t('toolSyncEmpty', { provider: 'WebDAV' }) + '</div>';
        }

    }

    function _renderWebdavCard(dest) {
      let statusDot = 'dest-status-dot-gray';
      let statusText = t('toolSyncNotPushed');

      if (dest.status.lastError) {
        statusDot = 'dest-status-dot-red';
        statusText = t('toolSyncError', { message: dest.status.lastError.error });
      } else if (dest.status.lastSuccess) {
        statusDot = 'dest-status-dot-green';
        statusText = formatI18nDate(dest.status.lastSuccess.timestamp);
      }

      const enabledClass = dest.enabled ? '' : 'dest-card-disabled';

      return '<div class="dest-card ' + enabledClass + '" data-id="' + _escapeHtml(dest.id) + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeHtml(dest.config.url) + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" aria-label="' + t('toolSyncEnabledLabel') + '" ' + (dest.enabled ? 'checked' : '') + ' onchange="toggleWebdavDest(this.closest(\\'.dest-card\\').dataset.id, this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editWebdavDest(this.closest(\\'.dest-card\\').dataset.id)" >' + t('edit') + '</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteWebdavDest(this.closest(\\'.dest-card\\').dataset.id, this.closest(\\'.dest-card\\').querySelector(\\'.dest-card-name\\').textContent)" >' + t('delete') + '</button>'
        + '</div>'
        + '</div>';
    }

    function _escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showWebdavForm(id) {
      const formArea = document.getElementById('webdavFormArea');
      const addBtn = document.getElementById('webdavAddBtn');
      formArea.style.display = 'block';
      addBtn.style.display = 'none';

      if (!id) {
        // 新增模式：清空表单
        document.getElementById('webdavEditId').value = '';
        document.getElementById('webdavName').value = '';
        document.getElementById('webdavUrl').value = '';
        document.getElementById('webdavUsername').value = '';
        document.getElementById('webdavPassword').value = '';
        document.getElementById('webdavPassword').dataset.i18nPlaceholder = 'toolSyncPassword';
        document.getElementById('webdavPassword').placeholder = t('toolSyncPassword');
        document.getElementById('webdavPath').value = '/';
      }
    }

    function hideWebdavForm() {
      document.getElementById('webdavFormArea').style.display = 'none';
      const addBtn = document.getElementById('webdavAddBtn');
      addBtn.style.display = addBtn.dataset.canAdd === 'false' ? 'none' : 'block';
    }

    async function editWebdavDest(id) {
      try {
        const response = await authenticatedFetch('/api/webdav/config');
        const data = await response.json();
        const dest = data.destinations.find(d => d.id === id);
        if (!dest) return;

        document.getElementById('webdavEditId').value = dest.id;
        document.getElementById('webdavName').value = dest.name;
        document.getElementById('webdavUrl').value = dest.config.url;
        document.getElementById('webdavUsername').value = dest.config.username;
        document.getElementById('webdavPassword').value = '';
        document.getElementById('webdavPassword').dataset.i18nPlaceholder = dest.config.hasPassword ? 'toolSyncSavedSecret' : 'toolSyncPassword';
        document.getElementById('webdavPassword').placeholder = dest.config.hasPassword ? t('toolSyncSavedSecret') : t('toolSyncPassword');
        document.getElementById('webdavPath').value = dest.config.path || '/';

        showWebdavForm(id);
      } catch (error) {
        showCenterToast('❌', t('toolSyncLoadError', { message: error.message }));
      }
    }

    async function saveWebdavConfig() {
      const id = document.getElementById('webdavEditId').value;
      const name = document.getElementById('webdavName').value.trim();
      const url = document.getElementById('webdavUrl').value.trim();
      const username = document.getElementById('webdavUsername').value.trim();
      const password = document.getElementById('webdavPassword').value;
      const path = document.getElementById('webdavPath').value.trim() || '/';

      if (!name || !url || !username) {
        showCenterToast('⚠️', t('toolSyncWebdavRequired'));
        return;
      }

      const saveBtn = document.getElementById('webdavSaveBtn');
      const originalText = saveBtn.textContent;
      const originalI18nKey = saveBtn.dataset.i18n;
      saveBtn.dataset.i18n = 'saving';
      saveBtn.textContent = t('saving');
      saveBtn.disabled = true;

      try {
        const body = { name, url, username, password, path };
        if (id) body.id = id;

        const response = await authenticatedFetch('/api/webdav/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await response.json();

        if (data.success) {
          if (data.warning) {
            showCenterToast('⚠️', data.warning);
          } else {
            showCenterToast('✅', t('toolSyncSaved', { provider: 'WebDAV' }));
          }
          loadWebdavDestinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncSaveFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncSaveError', { message: error.message }));
      } finally {
        if (originalI18nKey) saveBtn.dataset.i18n = originalI18nKey;
        else delete saveBtn.dataset.i18n;
        saveBtn.textContent = originalI18nKey ? t(originalI18nKey) : originalText;
        saveBtn.disabled = false;
      }
    }

    async function testWebdavConnection() {
      const id = document.getElementById('webdavEditId').value;
      const name = document.getElementById('webdavName').value.trim();
      const url = document.getElementById('webdavUrl').value.trim();
      const username = document.getElementById('webdavUsername').value.trim();
      const password = document.getElementById('webdavPassword').value;
      const path = document.getElementById('webdavPath').value.trim() || '/';

      if (!name || !url || !username) {
        showCenterToast('⚠️', t('toolSyncWebdavRequired'));
        return;
      }

      const testBtn = document.getElementById('webdavTestBtn');
      const originalText = testBtn.textContent;
      const originalI18nKey = testBtn.dataset.i18n;
      testBtn.dataset.i18n = 'toolSyncTesting';
      testBtn.textContent = t('toolSyncTesting');
      testBtn.disabled = true;

      try {
        const body = { name, url, username, password, path };
        if (id) body.id = id;

        const response = await authenticatedFetch('/api/webdav/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', data.message || t('toolSyncConnected'));
        } else {
          showCenterToast('❌', data.message || t('toolSyncConnectFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncTestError', { message: error.message }));
      } finally {
        if (originalI18nKey) testBtn.dataset.i18n = originalI18nKey;
        else delete testBtn.dataset.i18n;
        testBtn.textContent = originalI18nKey ? t(originalI18nKey) : originalText;
        testBtn.disabled = false;
      }
    }

    async function deleteWebdavDest(id, name) {
      const confirmed = await showConfirmDialog({
        i18n: { title: 'toolSyncDeleteTitle', message: 'toolSyncDeleteConfirm', confirmText: 'delete', cancelText: 'cancel', params: { provider: 'WebDAV', name } },
        title: t('toolSyncDeleteTitle', { provider: 'WebDAV' }),
        message: t('toolSyncDeleteConfirm', { provider: 'WebDAV', name }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/webdav/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', t('toolSyncDeleted', { provider: 'WebDAV' }));
          loadWebdavDestinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncDeleteFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncDeleteError', { message: error.message }));
      }
    }

    async function toggleWebdavDest(id, enabled) {
      try {
        const response = await authenticatedFetch('/api/webdav/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, enabled })
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', data.message);
          loadWebdavDestinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncOperationFailed'));
          loadWebdavDestinations();
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncOperationError', { message: error.message }));
        loadWebdavDestinations();
      }
    }

`;
}
