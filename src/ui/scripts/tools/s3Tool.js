/**
 * S3 同步工具模块
 * 提供多目标 S3 兼容存储配置管理 UI
 */

/**
 * 获取 S3 工具代码
 * @returns {string} S3 工具 JavaScript 代码
 */
export function getS3ToolCode() {
	return `
    // ==================== S3 同步工具（多目标） ====================

    function _escapeS3Html(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let _s3OnClose = null;

    function showS3Modal(onClose) {
      _s3OnClose = typeof onClose === 'function' ? onClose : null;
      showModal('s3Modal', () => {
        loadS3Destinations();
      });
    }

    function hideS3Modal() {
      const onClose = _s3OnClose;
      _s3OnClose = null;
      hideModal('s3Modal', onClose);
    }

    let _s3DestinationState = null;
    let _s3LoadVersion = 0;

    async function loadS3Destinations(preserveForm = false) {
      const loadVersion = ++_s3LoadVersion;
      const addBtn = document.getElementById('s3AddBtn');

      try {
        const response = await authenticatedFetch('/api/s3/config');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || t('toolSyncLoadRetry'));
        if (loadVersion !== _s3LoadVersion) return;

        // 渲染目标列表
        _s3DestinationState = data;
        _refreshS3Translations();

        // 达到上限时隐藏添加按钮
        addBtn.dataset.canAdd = data.count < data.maxAllowed ? 'true' : 'false';

        // 隐藏表单
        if (!preserveForm) hideS3Form();
      } catch (error) {
        if (loadVersion !== _s3LoadVersion) return;
        console.error('加载 S3 配置失败:', error);
        _s3DestinationState = { loadFailed: true };
        _refreshS3Translations();
      }
    }

    function _refreshS3Translations() {
      const listEl = document.getElementById('s3DestinationList');
      if (!listEl || !_s3DestinationState) return;
      if (_s3DestinationState.loadFailed) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: var(--dialog-caption-size);">' + t('toolSyncLoadRetry') + '</div>';
        return;
      }
        if (_s3DestinationState.destinations && _s3DestinationState.destinations.length > 0) {
          listEl.innerHTML = _s3DestinationState.destinations.map(dest => _renderS3Card(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: var(--dialog-caption-size);">' + t('toolSyncEmpty', { provider: 'S3' }) + '</div>';
        }

    }

    function _renderS3Card(dest) {
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

      return '<div class="dest-card ' + enabledClass + '" data-id="' + _escapeS3Html(dest.id) + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeS3Html(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeS3Html(dest.config.endpoint + '/' + dest.config.bucket) + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" aria-label="' + t('toolSyncEnabledLabel') + '" ' + (dest.enabled ? 'checked' : '') + ' onchange="toggleS3Dest(this.closest(\\'.dest-card\\').dataset.id, this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeS3Html(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editS3Dest(this.closest(\\'.dest-card\\').dataset.id)" >' + t('edit') + '</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteS3Dest(this.closest(\\'.dest-card\\').dataset.id, this.closest(\\'.dest-card\\').querySelector(\\'.dest-card-name\\').textContent)" >' + t('delete') + '</button>'
        + '</div>'
        + '</div>';
    }

    function showS3Form(id) {
      const formArea = document.getElementById('s3FormArea');
      const addBtn = document.getElementById('s3AddBtn');
      formArea.style.display = 'block';
      addBtn.style.display = 'none';

      if (!id) {
        // 新增模式：清空表单
        document.getElementById('s3EditId').value = '';
        document.getElementById('s3Name').value = '';
        document.getElementById('s3Endpoint').value = '';
        document.getElementById('s3Bucket').value = '';
        document.getElementById('s3Region').value = 'auto';
        document.getElementById('s3AccessKeyId').value = '';
        document.getElementById('s3SecretAccessKey').value = '';
        document.getElementById('s3SecretAccessKey').dataset.i18nPlaceholder = 'toolSyncSecretKey';
        document.getElementById('s3SecretAccessKey').placeholder = t('toolSyncSecretKey');
        document.getElementById('s3Prefix').value = '';
      }
    }

    function hideS3Form() {
      document.getElementById('s3FormArea').style.display = 'none';
      const addBtn = document.getElementById('s3AddBtn');
      addBtn.style.display = addBtn.dataset.canAdd === 'false' ? 'none' : 'block';
    }

    async function editS3Dest(id) {
      try {
        const response = await authenticatedFetch('/api/s3/config');
        const data = await response.json();
        const dest = data.destinations.find(d => d.id === id);
        if (!dest) return;

        document.getElementById('s3EditId').value = dest.id;
        document.getElementById('s3Name').value = dest.name;
        document.getElementById('s3Endpoint').value = dest.config.endpoint;
        document.getElementById('s3Bucket').value = dest.config.bucket;
        document.getElementById('s3Region').value = dest.config.region || 'auto';
        document.getElementById('s3AccessKeyId').value = dest.config.accessKeyId;
        document.getElementById('s3SecretAccessKey').value = '';
        document.getElementById('s3SecretAccessKey').dataset.i18nPlaceholder = dest.config.hasSecretKey ? 'toolSyncSavedSecret' : 'toolSyncSecretKey';
        document.getElementById('s3SecretAccessKey').placeholder = dest.config.hasSecretKey ? t('toolSyncSavedSecret') : t('toolSyncSecretKey');
        document.getElementById('s3Prefix').value = dest.config.prefix || '';

        showS3Form(id);
      } catch (error) {
        showCenterToast('❌', t('toolSyncLoadError', { message: error.message }));
      }
    }

    async function saveS3Config() {
      const id = document.getElementById('s3EditId').value;
      const name = document.getElementById('s3Name').value.trim();
      const endpoint = document.getElementById('s3Endpoint').value.trim();
      const bucket = document.getElementById('s3Bucket').value.trim();
      const region = document.getElementById('s3Region').value.trim() || 'auto';
      const accessKeyId = document.getElementById('s3AccessKeyId').value.trim();
      const secretAccessKey = document.getElementById('s3SecretAccessKey').value;
      const prefix = document.getElementById('s3Prefix').value.trim();

      if (!name || !endpoint || !bucket || !accessKeyId) {
        showCenterToast('⚠️', t('toolSyncS3Required'));
        return;
      }

      const saveBtn = document.getElementById('s3SaveBtn');
      const originalText = saveBtn.textContent;
      const originalI18nKey = saveBtn.dataset.i18n;
      saveBtn.dataset.i18n = 'saving';
      saveBtn.textContent = t('saving');
      saveBtn.disabled = true;

      try {
        const body = { name, endpoint, bucket, region, accessKeyId, secretAccessKey, prefix };
        if (id) body.id = id;

        const response = await authenticatedFetch('/api/s3/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await response.json();

        if (data.success) {
          if (data.warning) {
            showCenterToast('⚠️', data.warning);
          } else {
            showCenterToast('✅', t('toolSyncSaved', { provider: 'S3' }));
          }
          loadS3Destinations();
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

    async function testS3Connection() {
      const id = document.getElementById('s3EditId').value;
      const name = document.getElementById('s3Name').value.trim();
      const endpoint = document.getElementById('s3Endpoint').value.trim();
      const bucket = document.getElementById('s3Bucket').value.trim();
      const region = document.getElementById('s3Region').value.trim() || 'auto';
      const accessKeyId = document.getElementById('s3AccessKeyId').value.trim();
      const secretAccessKey = document.getElementById('s3SecretAccessKey').value;
      const prefix = document.getElementById('s3Prefix').value.trim();

      if (!name || !endpoint || !bucket || !accessKeyId) {
        showCenterToast('⚠️', t('toolSyncS3Required'));
        return;
      }

      const testBtn = document.getElementById('s3TestBtn');
      const originalText = testBtn.textContent;
      const originalI18nKey = testBtn.dataset.i18n;
      testBtn.dataset.i18n = 'toolSyncTesting';
      testBtn.textContent = t('toolSyncTesting');
      testBtn.disabled = true;

      try {
        const body = { name, endpoint, bucket, region, accessKeyId, secretAccessKey, prefix };
        if (id) body.id = id;

        const response = await authenticatedFetch('/api/s3/test', {
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

    async function deleteS3Dest(id, name) {
      const confirmed = await showConfirmDialog({
        i18n: { title: 'toolSyncDeleteTitle', message: 'toolSyncDeleteConfirm', confirmText: 'delete', cancelText: 'cancel', params: { provider: 'S3', name } },
        title: t('toolSyncDeleteTitle', { provider: 'S3' }),
        message: t('toolSyncDeleteConfirm', { provider: 'S3', name }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/s3/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', t('toolSyncDeleted', { provider: 'S3' }));
          loadS3Destinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncDeleteFailed'));
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncDeleteError', { message: error.message }));
      }
    }

    async function toggleS3Dest(id, enabled) {
      try {
        const response = await authenticatedFetch('/api/s3/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, enabled })
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', data.message);
          loadS3Destinations();
        } else {
          showCenterToast('❌', data.message || t('toolSyncOperationFailed'));
          loadS3Destinations();
        }
      } catch (error) {
        showCenterToast('❌', t('toolSyncOperationError', { message: error.message }));
        loadS3Destinations();
      }
    }

`;
}
