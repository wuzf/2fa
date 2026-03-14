/**
 * Settings Module - 设置模块
 * 提供设置弹窗的标签切换、修改密码、偏好设置等功能
 */

/**
 * 获取设置模块代码
 * @returns {string} Settings JavaScript 代码
 */
export function getSettingsCode() {
	return `
    // ========== 设置模块 ==========

    // 当前激活的设置标签
    let activeSettingsTab = 'security';

    /**
     * 切换设置标签
     * @param {string} tabName - 标签名称
     */
    function switchSettingsTab(tabName) {
      activeSettingsTab = tabName;

      // 更新标签按钮状态
      document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });

      // 更新内容面板
      document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === tabName);
      });

      // 同步设置标签页打开时加载配置
      if (tabName === 'sync') {
        loadSyncStatus();
      }

      // 偏好设置标签页打开时加载当前值
      if (tabName === 'preferences') {
        loadPreferences();
      }
    }

    /**
     * 加载同步配置状态（WebDAV 和 S3）
     */
    async function loadSyncStatus() {
      // 加载 WebDAV 状态
      try {
        const webdavResp = await authenticatedFetch('/api/webdav/config');
        const webdavData = await webdavResp.json();
        const webdavStatusEl = document.getElementById('settingsWebdavStatus');
        if (webdavStatusEl) {
          if (webdavData.count > 0) {
            webdavStatusEl.textContent = '已配置 ' + webdavData.count + ' 个目标';
            webdavStatusEl.className = 'sync-status configured';
          } else {
            webdavStatusEl.textContent = '未配置';
            webdavStatusEl.className = 'sync-status not-configured';
          }
        }
      } catch {
        const webdavStatusEl = document.getElementById('settingsWebdavStatus');
        if (webdavStatusEl) {
          webdavStatusEl.textContent = '加载失败';
          webdavStatusEl.className = 'sync-status not-configured';
        }
      }

      // 加载 S3 状态
      try {
        const s3Resp = await authenticatedFetch('/api/s3/config');
        const s3Data = await s3Resp.json();
        const s3StatusEl = document.getElementById('settingsS3Status');
        if (s3StatusEl) {
          if (s3Data.count > 0) {
            s3StatusEl.textContent = '已配置 ' + s3Data.count + ' 个目标';
            s3StatusEl.className = 'sync-status configured';
          } else {
            s3StatusEl.textContent = '未配置';
            s3StatusEl.className = 'sync-status not-configured';
          }
        }
      } catch {
        const s3StatusEl = document.getElementById('settingsS3Status');
        if (s3StatusEl) {
          s3StatusEl.textContent = '加载失败';
          s3StatusEl.className = 'sync-status not-configured';
        }
      }
    }

    /**
     * 从设置弹窗打开 WebDAV 配置
     */
    function openWebdavFromSettings() {
      hideSettingsModal();
      // 延迟打开以避免两个模态框重叠
      setTimeout(() => {
        showWebdavModal(() => showSettingsModal());
      }, 350);
    }

    /**
     * 从设置弹窗打开 S3 配置
     */
    function openS3FromSettings() {
      hideSettingsModal();
      setTimeout(() => {
        showS3Modal(() => showSettingsModal());
      }, 350);
    }

    /**
     * 修改密码
     */
    async function changePassword() {
      const currentPassword = document.getElementById('settingsCurrentPassword').value;
      const newPassword = document.getElementById('settingsNewPassword').value;
      const confirmPassword = document.getElementById('settingsConfirmPassword').value;
      const resultEl = document.getElementById('changePasswordResult');

      // 前端验证
      if (!currentPassword || !newPassword || !confirmPassword) {
        resultEl.textContent = '请填写所有密码字段';
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      if (newPassword !== confirmPassword) {
        resultEl.textContent = '两次输入的新密码不一致';
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      if (newPassword.length < 8) {
        resultEl.textContent = '新密码长度至少为 8 位';
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      const btn = document.getElementById('changePasswordBtn');
      const originalText = btn.textContent;
      btn.textContent = '修改中...';
      btn.disabled = true;
      resultEl.style.display = 'none';

      try {
        const response = await authenticatedFetch('/api/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          resultEl.textContent = data.message || '密码修改成功，请重新登录';
          resultEl.className = 'change-password-result success';
          resultEl.style.display = 'block';

          // 清空表单
          document.getElementById('settingsCurrentPassword').value = '';
          document.getElementById('settingsNewPassword').value = '';
          document.getElementById('settingsConfirmPassword').value = '';

          // 延迟后退出登录
          setTimeout(() => {
            logout();
          }, 2000);
        } else {
          resultEl.textContent = data.message || '修改密码失败';
          resultEl.className = 'change-password-result error';
          resultEl.style.display = 'block';
        }
      } catch (error) {
        resultEl.textContent = '网络错误，请稍后重试';
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    /**
     * 加载偏好设置
     */
    async function loadPreferences() {
      // 主题模式
      const currentTheme = localStorage.getItem('theme') || 'auto';
      const themeRadios = document.querySelectorAll('input[name="settingsTheme"]');
      themeRadios.forEach(radio => {
        radio.checked = radio.value === currentTheme;
      });

      // 默认导出格式
      const defaultFormat = localStorage.getItem('defaultExportFormat') || 'json';
      const formatSelect = document.getElementById('settingsDefaultExportFormat');
      if (formatSelect) {
        formatSelect.value = defaultFormat;
      }

      // 登录有效期和备份保留数量（从服务器读取）
      try {
        const resp = await authenticatedFetch('/api/settings');
        if (resp.ok) {
          const data = await resp.json();
          const jwtInput = document.getElementById('settingsJwtExpiryDays');
          if (jwtInput && data.jwtExpiryDays) {
            jwtInput.value = data.jwtExpiryDays;
          }
          const backupsInput = document.getElementById('settingsMaxBackups');
          if (backupsInput && typeof data.maxBackups === 'number') {
            backupsInput.value = data.maxBackups;
          }
        }
      } catch {
        // 加载失败静默处理
      }
    }

    /**
     * 应用主题设置
     * @param {string} theme - 主题名称
     */
    function applyThemeFromSettings(theme) {
      localStorage.setItem('theme', theme);
      applyTheme(theme, true);
    }

    /**
     * 保存默认导出格式
     */
    function saveDefaultExportFormat() {
      const formatSelect = document.getElementById('settingsDefaultExportFormat');
      if (formatSelect) {
        localStorage.setItem('defaultExportFormat', formatSelect.value);
        showCenterToast('✅', '导出格式已保存');
      }
    }

    /**
     * 保存登录有效期设置
     */
    async function saveJwtExpiryDays() {
      const input = document.getElementById('settingsJwtExpiryDays');
      const resultEl = document.getElementById('settingsJwtExpiryResult');
      if (!input) return;

      const days = parseInt(input.value, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        resultEl.textContent = '请输入 1~365 之间的整数';
        resultEl.className = 'settings-result error';
        resultEl.style.display = 'block';
        return;
      }

      try {
        const resp = await authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jwtExpiryDays: days }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          resultEl.textContent = '已保存，下次登录生效';
          resultEl.className = 'settings-result success';
        } else {
          resultEl.textContent = data.message || '保存失败';
          resultEl.className = 'settings-result error';
        }
      } catch {
        resultEl.textContent = '网络错误，请稍后重试';
        resultEl.className = 'settings-result error';
      }
      resultEl.style.display = 'block';
    }

    /**
     * 保存备份保留数量设置
     */
    async function saveMaxBackups() {
      const input = document.getElementById('settingsMaxBackups');
      const resultEl = document.getElementById('settingsMaxBackupsResult');
      if (!input) return;

      const num = parseInt(input.value, 10);
      if (isNaN(num) || num < 0 || num > 1000) {
        resultEl.textContent = '请输入 0~1000 之间的整数';
        resultEl.className = 'settings-result error';
        resultEl.style.display = 'block';
        return;
      }

      try {
        const resp = await authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxBackups: num }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          resultEl.textContent = num === 0 ? '已保存，备份不限数量' : '已保存，保留最新 ' + num + ' 条备份';
          resultEl.className = 'settings-result success';
        } else {
          resultEl.textContent = data.message || '保存失败';
          resultEl.className = 'settings-result error';
        }
      } catch {
        resultEl.textContent = '网络错误，请稍后重试';
        resultEl.className = 'settings-result error';
      }
      resultEl.style.display = 'block';
    }
  `;
}
