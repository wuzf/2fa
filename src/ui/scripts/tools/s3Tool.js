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
      return div.innerHTML;
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

    async function loadS3Destinations() {
      const listEl = document.getElementById('s3DestinationList');
      const addBtn = document.getElementById('s3AddBtn');

      try {
        const response = await authenticatedFetch('/api/s3/config');
        const data = await response.json();

        // 渲染目标列表
        if (data.destinations && data.destinations.length > 0) {
          listEl.innerHTML = data.destinations.map(dest => _renderS3Card(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px;">暂无 S3 目标，点击下方按钮添加</div>';
        }

        // 达到上限时隐藏添加按钮
        addBtn.style.display = data.count >= data.maxAllowed ? 'none' : 'block';

        // 隐藏表单
        hideS3Form();
      } catch (error) {
        console.error('加载 S3 配置失败:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: 13px;">加载失败，请稍后重试</div>';
      }
    }

    function _renderS3Card(dest) {
      let statusDot = 'dest-status-dot-gray';
      let statusText = '未推送';

      if (dest.status.lastError) {
        statusDot = 'dest-status-dot-red';
        statusText = '失败: ' + dest.status.lastError.error;
      } else if (dest.status.lastSuccess) {
        statusDot = 'dest-status-dot-green';
        statusText = new Date(dest.status.lastSuccess.timestamp).toLocaleString();
      }

      const enabledClass = dest.enabled ? '' : 'dest-card-disabled';

      return '<div class="dest-card ' + enabledClass + '" data-id="' + dest.id + '">'
        + '<div class="dest-card-header">'
        + '<div class="dest-card-info">'
        + '<span class="dest-card-name">' + _escapeS3Html(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeS3Html(dest.config.endpoint + '/' + dest.config.bucket) + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" ' + (dest.enabled ? 'checked' : '') + ' onchange="toggleS3Dest(\\'' + dest.id + '\\', this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeS3Html(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editS3Dest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">编辑</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteS3Dest(\\'' + dest.id + '\\', \\'' + _escapeS3Html(dest.name).replace(/'/g, "\\\\'") + '\\')" style="font-size: 12px; padding: 4px 12px;">删除</button>'
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
        document.getElementById('s3SecretAccessKey').placeholder = '请输入 Secret Access Key';
        document.getElementById('s3Prefix').value = '';
      }
    }

    function hideS3Form() {
      document.getElementById('s3FormArea').style.display = 'none';
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
        document.getElementById('s3SecretAccessKey').placeholder = dest.config.hasSecretKey ? '已保存（留空保持不变）' : '请输入 Secret Access Key';
        document.getElementById('s3Prefix').value = dest.config.prefix || '';

        showS3Form(id);
      } catch (error) {
        showCenterToast('❌', '加载配置失败: ' + error.message);
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
        showCenterToast('⚠️', '请填写目标名称、Endpoint、Bucket 和 Access Key ID');
        return;
      }

      const saveBtn = document.getElementById('s3SaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
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
            showCenterToast('✅', 'S3 配置已保存');
          }
          loadS3Destinations();
        } else {
          showCenterToast('❌', data.message || '保存失败');
        }
      } catch (error) {
        showCenterToast('❌', '保存失败: ' + error.message);
      } finally {
        saveBtn.textContent = originalText;
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
        showCenterToast('⚠️', '请填写目标名称、Endpoint、Bucket 和 Access Key ID');
        return;
      }

      const testBtn = document.getElementById('s3TestBtn');
      const originalText = testBtn.textContent;
      testBtn.textContent = '测试中...';
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
          showCenterToast('✅', data.message || '连接成功');
        } else {
          showCenterToast('❌', data.message || '连接失败');
        }
      } catch (error) {
        showCenterToast('❌', '测试失败: ' + error.message);
      } finally {
        testBtn.textContent = originalText;
        testBtn.disabled = false;
      }
    }

    async function deleteS3Dest(id, name) {
      if (!confirm('确定要删除 S3 目标「' + name + '」吗？删除后该目标将不再接收备份推送。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/s3/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'S3 目标已删除');
          loadS3Destinations();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
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
          showCenterToast('❌', data.message || '操作失败');
          loadS3Destinations();
        }
      } catch (error) {
        showCenterToast('❌', '操作失败: ' + error.message);
        loadS3Destinations();
      }
    }

`;
}
