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
    let preferencesLoadRequestId = 0;
    let defaultExportFormatChangeVersion = 0;
    let defaultExportFormatSaveRequestId = 0;
    let preferenceSaveQueue = Promise.resolve();
    const NUMERIC_PREFERENCE_SAVE_DELAY = 500;
    const numericPreferences = {
      jwtExpiryDays: {
        inputId: 'settingsJwtExpiryDays', resultId: 'settingsJwtExpiryResult', min: 1, max: 365,
        version: 0, dirty: false, savedValue: null, timer: null, saving: null
      },
      maxBackups: {
        inputId: 'settingsMaxBackups', resultId: 'settingsMaxBackupsResult', min: 0, max: 1000,
        version: 0, dirty: false, savedValue: null, timer: null, saving: null
      }
    };

    // Settings are stored together on the server. Serialize writes from all
    // preference controls so one field cannot overwrite another field's update.
    function enqueuePreferenceSave(save) {
      const request = preferenceSaveQueue.then(save);
      preferenceSaveQueue = request.catch(() => {});
      return request;
    }

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

      // 每次进入标签页都从顶部开始，避免沿用上一个面板的滚动位置。
      const settingsContent = document.querySelector('#settingsModal .settings-content');
      if (settingsContent) {
        settingsContent.scrollTop = 0;
      }

      // 同步设置标签页打开时加载配置
      if (tabName === 'sync') {
        loadSyncStatus();
      }

      // 偏好设置标签页打开时加载当前值
      if (tabName === 'preferences') {
        loadPreferences();
        if (typeof updateSettingsPwaInstallButton === 'function') {
          updateSettingsPwaInstallButton();
        }
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

      // 加载 OneDrive 状态
      try {
        const oneDriveResp = await authenticatedFetch('/api/onedrive/config');
        const oneDriveData = await oneDriveResp.json();
        const oneDriveStatusEl = document.getElementById('settingsOneDriveStatus');
        if (oneDriveStatusEl) {
          if (oneDriveData.count > 0) {
            oneDriveStatusEl.textContent = '已配置' + oneDriveData.count + ' 个目标';
            oneDriveStatusEl.className = 'sync-status configured';
          } else {
            oneDriveStatusEl.textContent = '未配置';
            oneDriveStatusEl.className = 'sync-status not-configured';
          }
        }
      } catch {
        const oneDriveStatusEl = document.getElementById('settingsOneDriveStatus');
        if (oneDriveStatusEl) {
          oneDriveStatusEl.textContent = '加载失败';
          oneDriveStatusEl.className = 'sync-status not-configured';
        }
      }

      // 加载 Google Drive 状态
      try {
        const googleDriveResp = await authenticatedFetch('/api/gdrive/config');
        const googleDriveData = await googleDriveResp.json();
        const googleDriveStatusEl = document.getElementById('settingsGoogleDriveStatus');
        if (googleDriveStatusEl) {
          if (googleDriveData.count > 0) {
            googleDriveStatusEl.textContent = '已配置' + googleDriveData.count + ' 个目标';
            googleDriveStatusEl.className = 'sync-status configured';
          } else {
            googleDriveStatusEl.textContent = '未配置';
            googleDriveStatusEl.className = 'sync-status not-configured';
          }
        }
      } catch {
        const googleDriveStatusEl = document.getElementById('settingsGoogleDriveStatus');
        if (googleDriveStatusEl) {
          googleDriveStatusEl.textContent = '加载失败';
          googleDriveStatusEl.className = 'sync-status not-configured';
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
     * 从设置弹窗打开 OneDrive 配置
     */
    function openOneDriveFromSettings() {
      hideSettingsModal();
      setTimeout(() => {
        showOneDriveModal(() => showSettingsModal());
      }, 350);
    }

    /**
     * 从设置弹窗打开 Google Drive 配置
     */
    function openGoogleDriveFromSettings() {
      hideSettingsModal();
      setTimeout(() => {
        showGoogleDriveModal(() => showSettingsModal());
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
      const requestId = ++preferencesLoadRequestId;
      const formatVersionAtStart = defaultExportFormatChangeVersion;
      const numericVersionsAtStart = {};
      Object.keys(numericPreferences).forEach(key => {
        const state = numericPreferences[key];
        numericVersionsAtStart[key] = state.dirty ? null : state.version;
      });

      const currentTheme = localStorage.getItem('theme') || 'auto';
      const themeRadios = document.querySelectorAll('input[name="settingsTheme"]');
      themeRadios.forEach(radio => {
        radio.checked = radio.value === currentTheme;
      });

      const animationSelect = document.getElementById('settingsOTPAnimationMode');
      if (animationSelect) {
        animationSelect.value = getOTPAnimationMode();
      }

      const formatSelect = document.getElementById('settingsDefaultExportFormat');
      const localDefaultFormat = localStorage.getItem('defaultExportFormat') || 'json';
      if (formatSelect) {
        formatSelect.value = localDefaultFormat;
      }

      const langSelect = document.getElementById('settingsLanguage');
      const localLanguage = (typeof getLanguagePreference === 'function' ? getLanguagePreference() : (typeof localStorage !== 'undefined' ? localStorage.getItem('language') : null)) || 'auto';
      if (langSelect) {
        langSelect.value = localLanguage;
      }

      // 导出偏好格式、语言偏好、登录有效期和备份保留数量（从服务器读取）
      try {
        const resp = await authenticatedFetch('/api/settings');
        if (resp.ok) {
          const data = await resp.json();
          if (requestId !== preferencesLoadRequestId) {
            return;
          }

          if (formatSelect && data.defaultExportFormat && defaultExportFormatChangeVersion === formatVersionAtStart) {
            formatSelect.value = data.defaultExportFormat;
            localStorage.setItem('defaultExportFormat', data.defaultExportFormat);
          }
          if (langSelect && data.language) {
            langSelect.value = data.language;
            if (typeof setLanguage === 'function') {
              setLanguage(data.language);
            }
          }
          Object.keys(numericPreferences).forEach(key => {
            const state = numericPreferences[key];
            const input = document.getElementById(state.inputId);
            if (input && !state.dirty && numericVersionsAtStart[key] === state.version && Number.isInteger(data[key])) {
              input.value = String(data[key]);
              state.savedValue = data[key];
            }
          });
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
     * 应用验证码切换动效
     * @param {string} mode - 动效模式
     */
    function applyOTPAnimationFromSettings(mode) {
      const appliedMode = setOTPAnimationMode(mode);
      const animationSelect = document.getElementById('settingsOTPAnimationMode');
      if (animationSelect) {
        animationSelect.value = appliedMode;
      }
    }

    /**
     * 保存导出偏好格式
     */
    async function saveDefaultExportFormat() {
      const formatSelect = document.getElementById('settingsDefaultExportFormat');
      if (!formatSelect) return;
      const selectedFormat = formatSelect.value;
      const requestId = ++defaultExportFormatSaveRequestId;
      defaultExportFormatChangeVersion += 1;

      try {
        const resp = await enqueuePreferenceSave(() => authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultExportFormat: selectedFormat }),
        }));
        const data = await resp.json();
        if (requestId !== defaultExportFormatSaveRequestId) {
          return;
        }

        if (resp.ok && data.success) {
          const savedFormat = (data.settings && data.settings.defaultExportFormat) || selectedFormat;
          formatSelect.value = savedFormat;
          localStorage.setItem('defaultExportFormat', savedFormat);
          showCenterToast('✅', '偏好格式已保存，批量导出和备份导出会优先使用该格式');
        } else {
          showCenterToast('❌', data.message || '保存偏好格式失败');
        }
      } catch {
        if (requestId !== defaultExportFormatSaveRequestId) {
          return;
        }
        showCenterToast('❌', '网络错误，请稍后重试');
      }
    }

    /**
     * 保存界面语言偏好
     * @param {string} selectedLang - 选中的语言代码
     */
    async function saveLanguagePreference(selectedLang) {
      if (typeof setLanguage === 'function') {
        setLanguage(selectedLang);
      }
      try {
        const resp = await enqueuePreferenceSave(() => authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: selectedLang }),
        }));
        const data = await resp.json();
        if (resp.ok && data.success) {
          const msg = (typeof t === 'function' ? t('languageSaved') : null) || '语言偏好已保存';
          if (typeof showCenterToast === 'function') {
            showCenterToast('✅', msg);
          }
        }
      } catch (e) {
        // 静默网络异常或保持当前界面语言
      }
    }

    function showNumericPreferenceResult(key, message, status = '') {
      const result = document.getElementById(numericPreferences[key].resultId);
      result.textContent = message;
      result.className = 'settings-result' + (status ? ' ' + status : '');
      result.style.display = 'block';
    }

    function readNumericPreference(key) {
      const state = numericPreferences[key];
      const input = document.getElementById(state.inputId);
      const raw = input.value.trim();
      const value = Number(raw);
      const valid = raw !== '' && Number.isInteger(value) && value >= state.min && value <= state.max;
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid) {
        showNumericPreferenceResult(key, '请输入 ' + state.min + '~' + state.max + ' 之间的整数', 'error');
        return null;
      }
      return value;
    }

    function numericPreferenceSavedMessage(key, value) {
      if (key === 'jwtExpiryDays') return '已保存，下次登录生效';
      return value === 0 ? '已保存，备份不限数量' : '已保存，保留最新 ' + value + ' 条备份';
    }

    // Input events debounce typing and spinner changes. Blur and Enter flush
    // immediately; loading a value programmatically never schedules a save.
    function scheduleNumericPreferenceSave(key) {
      const state = numericPreferences[key];
      state.version += 1;
      state.dirty = true;
      if (state.timer !== null) clearTimeout(state.timer);
      showNumericPreferenceResult(key, '等待保存…');
      state.timer = setTimeout(() => {
        state.timer = null;
        saveNumericPreference(key);
      }, NUMERIC_PREFERENCE_SAVE_DELAY);
    }

    async function saveNumericPreference(key) {
      const state = numericPreferences[key];
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      if (!state.dirty || readNumericPreference(key) === null) return;
      if (state.saving) return state.saving;

      state.saving = (async () => {
        while (state.dirty) {
          const version = state.version;
          const value = readNumericPreference(key);
          if (value === null) break;
          if (value === state.savedValue) {
            state.dirty = false;
            showNumericPreferenceResult(key, numericPreferenceSavedMessage(key, value), 'success');
            break;
          }

          showNumericPreferenceResult(key, '保存中…');
          try {
            const resp = await enqueuePreferenceSave(() => authenticatedFetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [key]: value }),
            }));
            const data = await resp.json();
            if (resp.ok && data.success) {
              state.savedValue = value;
              if (state.version === version) {
                state.dirty = false;
                document.getElementById(state.inputId).value = String(value);
                showNumericPreferenceResult(key, numericPreferenceSavedMessage(key, value), 'success');
              }
            } else {
              state.savedValue = null;
              if (state.version === version) {
                showNumericPreferenceResult(key, data.message || '保存失败，请稍后重试', 'error');
                break;
              }
            }
          } catch {
            // A lost response does not prove the server left the old value intact.
            state.savedValue = null;
            if (state.version === version) {
              showNumericPreferenceResult(key, '网络错误，未保存，请稍后重试', 'error');
              break;
            }
          }
          // If editing continues, let the pending debounce finish. If its timer
          // already fired during this request, save the latest value next.
          if (state.timer !== null) break;
        }
      })();

      try {
        await state.saving;
      } finally {
        state.saving = null;
      }
    }

    function saveJwtExpiryDays() {
      return saveNumericPreference('jwtExpiryDays');
    }

    function saveMaxBackups() {
      return saveNumericPreference('maxBackups');
    }
  `;
}
