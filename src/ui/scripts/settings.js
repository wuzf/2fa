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
    let pendingLanguageSaves = 0;
    let languageLoadRequestId = 0;
    let languagePreferenceSynced = false;
    let languageSyncPromise = null;
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
    const settingsTextState = new Map();

    // Keep translation keys alongside dynamic text, so changing language never
    // reloads settings or overwrites an in-progress edit.
    function setSettingsText(id, key, params = {}, serverMessage = '') {
      settingsTextState.set(id, { key, params, serverMessage });
      const element = document.getElementById(id);
      if (element) element.textContent = serverMessage
        ? (typeof localizeAuthMessage === 'function' ? localizeAuthMessage(serverMessage) : serverMessage)
        : t(key, params);
    }

    function refreshSettingsLanguage() {
      settingsTextState.forEach(({ key, params, serverMessage }, id) => setSettingsText(id, key, params, serverMessage));
      const button = document.getElementById('changePasswordBtn');
      if (button) button.textContent = t(button.disabled ? 'changePasswordSubmitting' : 'changePasswordBtn');
    }

    async function loadSyncStatus() {
      const providers = [
        ['webdav', 'settingsWebdavStatus'],
        ['s3', 'settingsS3Status'],
        ['onedrive', 'settingsOneDriveStatus'],
        ['gdrive', 'settingsGoogleDriveStatus']
      ];
      await Promise.all(providers.map(async ([provider, elementId]) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        setSettingsText(elementId, 'loading');
        try {
          const response = await authenticatedFetch('/api/' + provider + '/config');
          if (!response.ok) throw new Error('Sync status request failed');
          const data = await response.json();
          const configured = data.count > 0;
          setSettingsText(elementId, configured ? 'syncStatusConfigured' : 'syncStatusNotConfigured', { count: data.count });
          element.className = 'sync-status ' + (configured ? 'configured' : 'not-configured');
        } catch {
          setSettingsText(elementId, 'syncStatusError');
          element.className = 'sync-status not-configured';
        }
      }));
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
        setSettingsText('changePasswordResult', 'passwordFieldsRequired');
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      if (newPassword !== confirmPassword) {
        setSettingsText('changePasswordResult', 'passwordMismatch');
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      if (newPassword.length < 8) {
        setSettingsText('changePasswordResult', 'passwordTooShort');
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
        return;
      }

      const btn = document.getElementById('changePasswordBtn');
      btn.textContent = t('changePasswordSubmitting');
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
          setSettingsText('changePasswordResult', 'changePasswordSuccess');
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
          setSettingsText('changePasswordResult', 'changePasswordFailed', {}, data.message);
          resultEl.className = 'change-password-result error';
          resultEl.style.display = 'block';
        }
      } catch (error) {
        setSettingsText('changePasswordResult', 'networkError');
        resultEl.className = 'change-password-result error';
        resultEl.style.display = 'block';
      } finally {
        btn.textContent = t('changePasswordBtn');
        btn.disabled = false;
      }
    }

    function beginLanguagePreferenceLoad() {
      return {
        requestId: ++languageLoadRequestId,
        version: pendingLanguageSaves > 0 ? null : languageChangeVersion
      };
    }

    // Both startup and the preferences panel use this guard: a late response
    // must not replace a newer load, a user's choice, or an in-flight save.
    function applyServerLanguagePreference(data, load) {
      if (load.requestId !== languageLoadRequestId) return;
      languagePreferenceSynced = true;
      if (load.version !== languageChangeVersion || pendingLanguageSaves > 0) return;
      if (data.language && typeof setLanguage === 'function') {
        setLanguage(data.language);
      }
    }

    function resetLanguagePreferenceSync() {
      languageLoadRequestId += 1;
      languagePreferenceSynced = false;
      languageSyncPromise = null;
    }

    // Called only after the server confirms authentication. Keep it separate
    // from the settings panel so a fresh browser restores its saved language.
    function syncLanguagePreferenceAfterAuth() {
      if (languagePreferenceSynced) return Promise.resolve();
      if (languageSyncPromise) return languageSyncPromise;
      const load = beginLanguagePreferenceLoad();
      const syncing = (async () => {
        try {
          const response = await authenticatedFetch('/api/settings');
          if (response.ok) {
            applyServerLanguagePreference(await response.json(), load);
          }
        } catch {
          // Keep the local language usable offline; a later load can retry.
        }
      })();
      languageSyncPromise = syncing;
      void syncing.then(() => {
        if (languageSyncPromise === syncing) languageSyncPromise = null;
      });
      return syncing;
    }

    /**
     * 加载偏好设置
     */
    async function loadPreferences() {
      // 主题模式
      const requestId = ++preferencesLoadRequestId;
      const formatVersionAtStart = defaultExportFormatChangeVersion;
      const languageLoad = beginLanguagePreferenceLoad();
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
          applyServerLanguagePreference(data, languageLoad);
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
          showCenterToast('✅', t('defaultExportFormatSaved'));
        } else {
          showCenterToast('❌', data.message || t('defaultExportFormatFailed'));
        }
      } catch {
        if (requestId !== defaultExportFormatSaveRequestId) {
          return;
        }
        showCenterToast('❌', t('networkError'));
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
      pendingLanguageSaves += 1;
      try {
        const resp = await enqueuePreferenceSave(() => authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: selectedLang }),
        }));
        const data = await resp.json();
        if (resp.ok && data.success) {
          const msg = t('languageSaved');
          if (typeof showCenterToast === 'function') {
            showCenterToast('✅', msg);
          }
        }
      } catch (e) {
        // 静默网络异常或保持当前界面语言
      } finally {
        pendingLanguageSaves -= 1;
      }
    }

    function showNumericPreferenceResult(key, messageKey, status = '', params = {}, serverMessage = '') {
      const resultId = numericPreferences[key].resultId;
      const result = document.getElementById(resultId);
      setSettingsText(resultId, messageKey, params, serverMessage);
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
        showNumericPreferenceResult(key, 'numericPreferenceRange', 'error', { min: state.min, max: state.max });
        return null;
      }
      return value;
    }

    function numericPreferenceSavedMessage(key, value) {
      if (key === 'jwtExpiryDays') return 'jwtExpirySaved';
      return value === 0 ? 'maxBackupsUnlimitedSaved' : 'maxBackupsSaved';
    }

    // Input events debounce typing and spinner changes. Blur and Enter flush
    // immediately; loading a value programmatically never schedules a save.
    function scheduleNumericPreferenceSave(key) {
      const state = numericPreferences[key];
      state.version += 1;
      state.dirty = true;
      if (state.timer !== null) clearTimeout(state.timer);
      showNumericPreferenceResult(key, 'preferenceWaiting');
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
            showNumericPreferenceResult(key, numericPreferenceSavedMessage(key, value), 'success', { count: value });
            break;
          }

          showNumericPreferenceResult(key, 'preferenceSaving');
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
                showNumericPreferenceResult(key, numericPreferenceSavedMessage(key, value), 'success', { count: value });
              }
            } else {
              state.savedValue = null;
              if (state.version === version) {
                showNumericPreferenceResult(key, 'preferenceSaveFailed', 'error', {}, data.message);
                break;
              }
            }
          } catch {
            // A lost response does not prove the server left the old value intact.
            state.savedValue = null;
            if (state.version === version) {
              showNumericPreferenceResult(key, 'preferenceNetworkError', 'error');
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
