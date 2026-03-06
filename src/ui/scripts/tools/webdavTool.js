/**
 * WebDAV 同步工具模块
 * 提供 WebDAV 配置管理 UI
 */

/**
 * 获取 WebDAV 工具代码
 * @returns {string} WebDAV 工具 JavaScript 代码
 */
export function getWebdavToolCode() {
	return `
    // ==================== WebDAV 同步工具 ====================

    function showWebdavModal() {
      showModal('webdavModal', () => {
        loadWebdavConfig();
      });
    }

    function hideWebdavModal() {
      hideModal('webdavModal');
    }

    async function loadWebdavConfig() {
      const statusEl = document.getElementById('webdavStatus');
      const deleteBtn = document.getElementById('webdavDeleteBtn');

      try {
        const response = await authenticatedFetch('/api/webdav/config');
        const data = await response.json();

        if (data.configured && data.config) {
          document.getElementById('webdavUrl').value = data.config.url || '';
          document.getElementById('webdavUsername').value = data.config.username || '';
          document.getElementById('webdavPassword').value = '';
          document.getElementById('webdavPassword').placeholder = data.config.hasPassword ? '已保存（留空保持不变）' : '请输入密码';
          document.getElementById('webdavPath').value = data.config.path || '/';
          deleteBtn.style.display = 'block';
        } else {
          document.getElementById('webdavUrl').value = '';
          document.getElementById('webdavUsername').value = '';
          document.getElementById('webdavPassword').value = '';
          document.getElementById('webdavPassword').placeholder = '请输入密码';
          document.getElementById('webdavPath').value = '/';
          deleteBtn.style.display = 'none';
        }

        // 显示推送状态（使用 textContent 防止 XSS）
        if (data.lastError) {
          statusEl.textContent = '';
          const span = document.createElement('span');
          span.style.color = 'var(--danger-color)';
          span.textContent = '上次推送失败: ' + data.lastError.error + ' (' + new Date(data.lastError.timestamp).toLocaleString() + ')';
          statusEl.appendChild(span);
          statusEl.style.display = 'block';
        } else if (data.lastSuccessAt) {
          statusEl.textContent = '';
          const span = document.createElement('span');
          span.style.color = 'var(--success-color)';
          span.textContent = '上次推送成功: ' + new Date(data.lastSuccessAt).toLocaleString();
          statusEl.appendChild(span);
          statusEl.style.display = 'block';
        } else {
          statusEl.style.display = 'none';
        }
      } catch (error) {
        console.error('加载 WebDAV 配置失败:', error);
      }
    }

    async function saveWebdavConfig() {
      const url = document.getElementById('webdavUrl').value.trim();
      const username = document.getElementById('webdavUsername').value.trim();
      const password = document.getElementById('webdavPassword').value;
      const path = document.getElementById('webdavPath').value.trim() || '/';

      if (!url || !username) {
        showCenterToast('⚠️', '请填写服务器地址和用户名');
        return;
      }

      const saveBtn = document.getElementById('webdavSaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
      saveBtn.disabled = true;

      try {
        const response = await authenticatedFetch('/api/webdav/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, username, password, path })
        });
        const data = await response.json();

        if (data.success) {
          if (data.warning) {
            showCenterToast('⚠️', data.warning);
          } else {
            showCenterToast('✅', 'WebDAV 配置已保存');
          }
          hideWebdavModal();
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
      const url = document.getElementById('webdavUrl').value.trim();
      const username = document.getElementById('webdavUsername').value.trim();
      const password = document.getElementById('webdavPassword').value;
      const path = document.getElementById('webdavPath').value.trim() || '/';

      if (!url || !username) {
        showCenterToast('⚠️', '请填写服务器地址和用户名');
        return;
      }

      const testBtn = document.getElementById('webdavTestBtn');
      const originalText = testBtn.textContent;
      testBtn.textContent = '测试中...';
      testBtn.disabled = true;

      try {
        const response = await authenticatedFetch('/api/webdav/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, username, password, path })
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

    async function deleteWebdavConfig() {
      if (!confirm('确定要删除 WebDAV 配置吗？删除后备份将不再自动推送。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/webdav/config', {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'WebDAV 配置已删除');
          loadWebdavConfig();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
      }
    }

`;
}
