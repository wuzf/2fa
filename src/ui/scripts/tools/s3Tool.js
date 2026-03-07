/**
 * S3 同步工具模块
 * 提供 S3 兼容存储配置管理 UI
 */

/**
 * 获取 S3 工具代码
 * @returns {string} S3 工具 JavaScript 代码
 */
export function getS3ToolCode() {
	return `
    // ==================== S3 同步工具 ====================

    function showS3Modal() {
      showModal('s3Modal', () => {
        loadS3Config();
      });
    }

    function hideS3Modal() {
      hideModal('s3Modal');
    }

    async function loadS3Config() {
      const statusEl = document.getElementById('s3Status');
      const deleteBtn = document.getElementById('s3DeleteBtn');

      try {
        const response = await authenticatedFetch('/api/s3/config');
        const data = await response.json();

        if (data.configured && data.config) {
          document.getElementById('s3Endpoint').value = data.config.endpoint || '';
          document.getElementById('s3Bucket').value = data.config.bucket || '';
          document.getElementById('s3Region').value = data.config.region || 'auto';
          document.getElementById('s3AccessKeyId').value = data.config.accessKeyId || '';
          document.getElementById('s3SecretAccessKey').value = '';
          document.getElementById('s3SecretAccessKey').placeholder = data.config.hasSecretKey ? '已保存（留空保持不变）' : '请输入 Secret Access Key';
          document.getElementById('s3Prefix').value = data.config.prefix || '';
          deleteBtn.style.display = 'block';
        } else {
          document.getElementById('s3Endpoint').value = '';
          document.getElementById('s3Bucket').value = '';
          document.getElementById('s3Region').value = 'auto';
          document.getElementById('s3AccessKeyId').value = '';
          document.getElementById('s3SecretAccessKey').value = '';
          document.getElementById('s3SecretAccessKey').placeholder = '请输入 Secret Access Key';
          document.getElementById('s3Prefix').value = '';
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
        console.error('加载 S3 配置失败:', error);
      }
    }

    async function saveS3Config() {
      const endpoint = document.getElementById('s3Endpoint').value.trim();
      const bucket = document.getElementById('s3Bucket').value.trim();
      const region = document.getElementById('s3Region').value.trim() || 'auto';
      const accessKeyId = document.getElementById('s3AccessKeyId').value.trim();
      const secretAccessKey = document.getElementById('s3SecretAccessKey').value;
      const prefix = document.getElementById('s3Prefix').value.trim();

      if (!endpoint || !bucket || !accessKeyId) {
        showCenterToast('⚠️', '请填写 Endpoint、Bucket 和 Access Key ID');
        return;
      }

      const saveBtn = document.getElementById('s3SaveBtn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '保存中...';
      saveBtn.disabled = true;

      try {
        const response = await authenticatedFetch('/api/s3/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, bucket, region, accessKeyId, secretAccessKey, prefix })
        });
        const data = await response.json();

        if (data.success) {
          if (data.warning) {
            showCenterToast('⚠️', data.warning);
          } else {
            showCenterToast('✅', 'S3 配置已保存');
          }
          hideS3Modal();
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
      const endpoint = document.getElementById('s3Endpoint').value.trim();
      const bucket = document.getElementById('s3Bucket').value.trim();
      const region = document.getElementById('s3Region').value.trim() || 'auto';
      const accessKeyId = document.getElementById('s3AccessKeyId').value.trim();
      const secretAccessKey = document.getElementById('s3SecretAccessKey').value;
      const prefix = document.getElementById('s3Prefix').value.trim();

      if (!endpoint || !bucket || !accessKeyId) {
        showCenterToast('⚠️', '请填写 Endpoint、Bucket 和 Access Key ID');
        return;
      }

      const testBtn = document.getElementById('s3TestBtn');
      const originalText = testBtn.textContent;
      testBtn.textContent = '测试中...';
      testBtn.disabled = true;

      try {
        const response = await authenticatedFetch('/api/s3/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, bucket, region, accessKeyId, secretAccessKey, prefix })
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

    async function deleteS3Config() {
      if (!confirm('确定要删除 S3 配置吗？删除后备份将不再自动推送到 S3。')) {
        return;
      }

      try {
        const response = await authenticatedFetch('/api/s3/config', {
          method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
          showCenterToast('✅', 'S3 配置已删除');
          loadS3Config();
        } else {
          showCenterToast('❌', data.message || '删除失败');
        }
      } catch (error) {
        showCenterToast('❌', '删除失败: ' + error.message);
      }
    }

`;
}
