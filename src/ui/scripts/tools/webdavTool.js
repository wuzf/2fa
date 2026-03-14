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

    async function loadWebdavDestinations() {
      const listEl = document.getElementById('webdavDestinationList');
      const addBtn = document.getElementById('webdavAddBtn');

      try {
        const response = await authenticatedFetch('/api/webdav/config');
        const data = await response.json();

        // 渲染目标列表
        if (data.destinations && data.destinations.length > 0) {
          listEl.innerHTML = data.destinations.map(dest => _renderWebdavCard(dest)).join('');
        } else {
          listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px;">暂无 WebDAV 目标，点击下方按钮添加</div>';
        }

        // 达到上限时隐藏添加按钮
        addBtn.style.display = data.count >= data.maxAllowed ? 'none' : 'block';

        // 隐藏表单
        hideWebdavForm();
      } catch (error) {
        console.error('加载 WebDAV 配置失败:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger-color); font-size: 13px;">加载失败，请稍后重试</div>';
      }
    }

    function _renderWebdavCard(dest) {
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
        + '<span class="dest-card-name">' + _escapeHtml(dest.name) + '</span>'
        + '<span class="dest-card-url">' + _escapeHtml(dest.config.url) + '</span>'
        + '</div>'
        + '<label class="dest-toggle" onclick="event.stopPropagation()">'
        + '<input type="checkbox" ' + (dest.enabled ? 'checked' : '') + ' onchange="toggleWebdavDest(\\'' + dest.id + '\\', this.checked)" />'
        + '<span class="dest-toggle-slider"></span>'
        + '</label>'
        + '</div>'
        + '<div class="dest-card-status">'
        + '<span class="dest-status-dot ' + statusDot + '"></span>'
        + '<span class="dest-status-text">' + _escapeHtml(statusText) + '</span>'
        + '</div>'
        + '<div class="dest-card-actions">'
        + '<button class="btn btn-sm" onclick="event.stopPropagation(); editWebdavDest(\\'' + dest.id + '\\')" style="font-size: 12px; padding: 4px 12px;">编辑</button>'
        + '<button class="btn btn-sm btn-danger-outline" onclick="event.stopPropagation(); deleteWebdavDest(\\'' + dest.id + '\\', \\'' + _escapeHtml(dest.name).replace(/'/g, "\\\\'") + '\\')" style="font-size: 12px; padding: 4px 12px;">删除</button>'
        + '</div>'
        + '</div>';
    }

    function _escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
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
        document.getElementById('webdavPassword').placeholder = '请输入密码';
        document.getElementById('webdavPath').value = '/';
      }
    }

    function hideWebdavForm() {
      document.getElementById('webdavFormArea').style.display = 'none';
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
        document.getElementById('webdavPassword').placeholder = dest.config.hasPassword ? '已保存（留空保持不变）' : '请输入密码';
        document.getElementById('webdavPath').value = dest.config.path || '/';

        showWebdavForm(id);
      } catch (error) {
        showCenterToast('❌', '加载配置失败: ' + error.message);
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
        showCenterToast('⚠️', '请填写目标名称、服务器地址和用户名');
        return;
      }

      const saveBtn = document.getElementById('webdavSaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
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
            showCenterToast('✅', 'WebDAV 配置已保存');
          }
          loadWebdavDestinations();
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

    async function testWebdavConnection() {
      const id = document.getElementById('webdavEditId').value;
      const name = document.getElementById('webdavName').value.trim();
      const url = document.getElementById('webdavUrl').value.trim();
      const username = document.getElementById('webdavUsername').value.trim();
      const password = document.getElementById('webdavPassword').value;
      const path = document.getElementById('webdavPath').value.trim() || '/';

      if (!name || !url || !username) {
        showCenterToast('⚠️', '请填写目标名称、服务器地址和用户名');
        return;
      }

      const testBtn = document.getElementById('webdavTestBtn');
      const originalText = testBtn.textContent;
      testBtn.textContent = '测试中...';
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

    async function deleteWebdavDest(id, name) {
      if (!confirm('确定要删除 WebDAV 目标「' + name + '」吗？删除后该目标将不再接收备份推送。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/webdav/config?id=' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'WebDAV 目标已删除');
          loadWebdavDestinations();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
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
          showCenterToast('❌', data.message || '操作失败');
          loadWebdavDestinations();
        }
      } catch (error) {
        showCenterToast('❌', '操作失败: ' + error.message);
        loadWebdavDestinations();
      }
    }

`;
}
