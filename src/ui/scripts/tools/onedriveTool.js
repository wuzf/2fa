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
        showCenterToast(icon, data.message || (data.success ? 'OneDrive 授权成功' : 'OneDrive 授权失败'));
      });
    }

    function _escapeOneDriveHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    async function loadOneDriveDestinations() {
      const listEl = document.getElementById('oneDriveDestinationList');
      const addBtn = document.getElementById('oneDriveAddBtn');
      const warningEl = document.getElementById('oneDriveOauthWarning');

      try {
        const response = await authenticatedFetch('/api/onedrive/config');
        const data = await response.json();

        if (warningEl) {
          if (data.oauthConfigured) {
            warningEl.style.display = 'none';
          } else {
            warningEl.style.display = 'block';
            warningEl.textContent = '服务端未配置 OneDrive OAuth 凭据。当前仍可新增、查看和编辑目标，但暂时无法完成授权或启用同步。';
          }
        }

        if (data.destinations && data.destinations.length > 0) {
          listEl.innerHTML = data.destinations.map(dest => _renderOneDriveCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px;">暂无 OneDrive 目标，点击下方按钮添加</div>';
        }

        const canAdd = data.count < data.maxAllowed;
        addBtn.dataset.canAdd = canAdd ? 'true' : 'false';
        addBtn.style.display = canAdd ? 'block' : 'none';
        hideOneDriveForm();
      } catch (error) {
        console.error('加载 OneDrive 配置失败:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: 13px;">加载失败，请稍后重试</div>';
      }
    }

    function _renderOneDriveCard(dest) {
      let statusDot = 'dest-status-dot-gray';
      let statusText = '未授权';

      if (dest.status.lastError) {
        statusDot = 'dest-status-dot-red';
        statusText = '失败: ' + dest.status.lastError.error;
      } else if (dest.status.lastSuccess) {
        statusDot = 'dest-status-dot-green';
        statusText = new Date(dest.status.lastSuccess.timestamp).toLocaleString();
      } else if (dest.authorized) {
        statusText = '已授权，等待首次推送';
      }

      const enabledClass = dest.enabled ? '' : 'dest-card-disabled';
      const accountText = dest.account && (dest.account.email || dest.account.displayName)
        ? ((dest.account.displayName || 'OneDrive 账户') + (dest.account.email ? ' · ' + dest.account.email : ''))
        : '未授权';

      return '<div class="dest-card ' + enabledClass + '" data-id="' + dest.id + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeOneDriveHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeOneDriveHtml(accountText) + '</span>'
        + '<span class="dest-card-url">应用目录: ' + _escapeOneDriveHtml(dest.config.folderPath || '/2FA-Backups') + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" ' + (dest.enabled ? 'checked' : '') + ' ' + (!dest.authorized ? 'disabled ' : '') + 'onchange="toggleOneDriveDest(\\'' + dest.id + '\\', this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeOneDriveHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); authorizeOneDriveDest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">' + (dest.authorized ? '重新授权' : '授权') + '</button>'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editOneDriveDest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">编辑</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteOneDriveDest(\\'' + dest.id + '\\', \\'' + _escapeOneDriveHtml(dest.name).replace(/'/g, "\\\\'") + '\\')" style="font-size: 12px; padding: 4px 12px;">删除</button>'
        + '</div>'
        + '</div>';
    }

    function showOneDriveForm(id) {
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
        showCenterToast('❌', '加载 OneDrive 配置失败: ' + error.message);
      }
    }

    async function _upsertOneDriveConfig() {
      const id = document.getElementById('oneDriveEditId').value;
      const name = document.getElementById('oneDriveName').value.trim();
      const folderPath = document.getElementById('oneDriveFolderPath').value.trim() || '/2FA-Backups';

      if (!name) {
        showCenterToast('⚠️', '请填写目标名称');
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
        throw new Error(data.message || '保存失败');
      }

      if (data.warning) {
        showCenterToast('⚠️', data.warning);
      }

      return data;
    }

    async function saveOneDriveConfig() {
      const saveBtn = document.getElementById('oneDriveSaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
      saveBtn.disabled = true;

      try {
        const data = await _upsertOneDriveConfig();
        if (!data) return;

        showCenterToast('✅', 'OneDrive 配置已保存');
        loadOneDriveDestinations();
      } catch (error) {
        showCenterToast('❌', '保存失败: ' + error.message);
      } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }
    }

    async function authorizeOneDriveDest(id) {
      let targetId = id;
      const authBtn = document.getElementById('oneDriveAuthorizeBtn');
      const hadFormButton = !!authBtn;
      const originalText = hadFormButton ? authBtn.textContent : '';

      if (hadFormButton) {
        authBtn.textContent = '准备授权...';
        authBtn.disabled = true;
      }

      try {
        if (!targetId) {
          const saved = await _upsertOneDriveConfig();
          if (!saved) return;
          targetId = saved.id;
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
          throw new Error(data.message || '启动授权失败');
        }

        _oneDriveExpectedCallbackOrigin = _resolveOneDriveCallbackOrigin(data.callbackOrigin);

        if (popup) {
          popup.location.href = data.authorizeUrl;
        } else {
          window.location.href = data.authorizeUrl;
        }

        showCenterToast('ℹ️', '请在弹出窗口中完成 OneDrive 授权');
        loadOneDriveDestinations();
      } catch (error) {
        _oneDriveExpectedCallbackOrigin = null;
        showCenterToast('❌', '授权失败: ' + error.message);
      } finally {
        if (hadFormButton) {
          authBtn.textContent = originalText;
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
      if (!confirm('确定要删除 OneDrive 目标“' + name + '”吗？删除后该目标将不再接收备份推送。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/onedrive/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'OneDrive 目标已删除');
          loadOneDriveDestinations();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
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
          showCenterToast('❌', data.message || '操作失败');
        }
        loadOneDriveDestinations();
      } catch (error) {
        showCenterToast('❌', '操作失败: ' + error.message);
        loadOneDriveDestinations();
      }
    }
`;
}
