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
        showCenterToast(icon, data.message || (data.success ? 'Google Drive 授权成功' : 'Google Drive 授权失败'));
      });
    }

    function _escapeGoogleDriveHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    async function loadGoogleDriveDestinations() {
      const listEl = document.getElementById('googleDriveDestinationList');
      const addBtn = document.getElementById('googleDriveAddBtn');
      const warningEl = document.getElementById('googleDriveOauthWarning');

      try {
        const response = await authenticatedFetch('/api/gdrive/config');
        const data = await response.json();

        if (warningEl) {
          if (data.oauthConfigured) {
            warningEl.style.display = 'none';
          } else {
            warningEl.style.display = 'block';
            warningEl.textContent = '服务端未配置 Google Drive OAuth 凭据。当前仍可新增、查看和编辑目标，但暂时无法完成授权或启用同步。';
          }
        }

        if (data.destinations && data.destinations.length > 0) {
          listEl.innerHTML = data.destinations.map(dest => _renderGoogleDriveCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px;">暂无 Google Drive 目标，点击下方按钮添加</div>';
        }

        const canAdd = data.count < data.maxAllowed;
        addBtn.dataset.canAdd = canAdd ? 'true' : 'false';
        addBtn.style.display = canAdd ? 'block' : 'none';
        hideGoogleDriveForm();
      } catch (error) {
        console.error('加载 Google Drive 配置失败:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: 13px;">加载失败，请稍后重试</div>';
      }
    }

    function _renderGoogleDriveCard(dest) {
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
        ? ((dest.account.displayName || 'Google 账户') + (dest.account.email ? ' · ' + dest.account.email : ''))
        : '未授权';

      return '<div class="dest-card ' + enabledClass + '" data-id="' + dest.id + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeGoogleDriveHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeGoogleDriveHtml(accountText) + '</span>'
        + '<span class="dest-card-url">备份目录: ' + _escapeGoogleDriveHtml(dest.config.folderPath || '/2FA-Backups') + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" ' + (dest.enabled ? 'checked' : '') + ' ' + (!dest.authorized ? 'disabled ' : '') + 'onchange="toggleGoogleDriveDest(\\'' + dest.id + '\\', this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeGoogleDriveHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); authorizeGoogleDriveDest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">' + (dest.authorized ? '重新授权' : '授权') + '</button>'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editGoogleDriveDest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">编辑</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteGoogleDriveDest(\\'' + dest.id + '\\', \\'' + _escapeGoogleDriveHtml(dest.name).replace(/'/g, "\\\\'") + '\\')" style="font-size: 12px; padding: 4px 12px;">删除</button>'
        + '</div>'
        + '</div>';
    }

    function showGoogleDriveForm(id) {
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
        showCenterToast('❌', '加载 Google Drive 配置失败: ' + error.message);
      }
    }

    async function _upsertGoogleDriveConfig() {
      const id = document.getElementById('googleDriveEditId').value;
      const name = document.getElementById('googleDriveName').value.trim();
      const folderPath = document.getElementById('googleDriveFolderPath').value.trim() || '/2FA-Backups';

      if (!name) {
        showCenterToast('⚠️', '请填写目标名称');
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
        throw new Error(data.message || '保存失败');
      }

      if (data.warning) {
        showCenterToast('⚠️', data.warning);
      }

      return data;
    }

    async function saveGoogleDriveConfig() {
      const saveBtn = document.getElementById('googleDriveSaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
      saveBtn.disabled = true;

      try {
        const data = await _upsertGoogleDriveConfig();
        if (!data) return;

        showCenterToast('✅', 'Google Drive 配置已保存');
        loadGoogleDriveDestinations();
      } catch (error) {
        showCenterToast('❌', '保存失败: ' + error.message);
      } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }
    }

    async function authorizeGoogleDriveDest(id) {
      let targetId = id;
      const authBtn = document.getElementById('googleDriveAuthorizeBtn');
      const hadFormButton = !!authBtn;
      const originalText = hadFormButton ? authBtn.textContent : '';

      if (hadFormButton) {
        authBtn.textContent = '准备授权...';
        authBtn.disabled = true;
      }

      try {
        if (!targetId) {
          const saved = await _upsertGoogleDriveConfig();
          if (!saved) return;
          targetId = saved.id;
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
          throw new Error(data.message || '启动授权失败');
        }

        _googleDriveExpectedCallbackOrigin = _resolveGoogleDriveCallbackOrigin(data.callbackOrigin);

        if (popup) {
          popup.location.href = data.authorizeUrl;
        } else {
          window.location.href = data.authorizeUrl;
        }

        showCenterToast('ℹ️', '请在弹出窗口中完成 Google Drive 授权');
        loadGoogleDriveDestinations();
      } catch (error) {
        _googleDriveExpectedCallbackOrigin = null;
        showCenterToast('❌', '授权失败: ' + error.message);
      } finally {
        if (hadFormButton) {
          authBtn.textContent = originalText;
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
      if (!confirm('确定要删除 Google Drive 目标“' + name + '”吗？删除后该目标将不再接收备份推送。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/gdrive/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'Google Drive 目标已删除');
          loadGoogleDriveDestinations();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
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
          showCenterToast('❌', data.message || '操作失败');
        }
        loadGoogleDriveDestinations();
      } catch (error) {
        showCenterToast('❌', '操作失败: ' + error.message);
        loadGoogleDriveDestinations();
      }
    }
`;
}
