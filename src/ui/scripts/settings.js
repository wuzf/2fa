import { MAX_CUSTOM_CODE_ITEMS, MAX_CUSTOM_CODE_LENGTH, MAX_CUSTOM_CODE_NAME_LENGTH } from '../../utils/settings.js';

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
    let lastPreferenceSaveAt = null;
    let defaultExportFormatDirty = false;
    let defaultExportFormatPending = null;
    const customCodeState = {
      loaded: false, dirty: false, items: [], savedItems: [], version: 0, generation: 0,
      requestId: 0, loading: null, saving: null, timer: null, failed: false, uncertain: false,
      saveNotBefore: 0, saveWaitTimer: null, wakeSave: null,
      composing: new Set(), reloadComposing: new Set(), reloadRequired: false, expandedId: null, appliedCode: null,
      reloadTimer: null, reloadVersion: 0, reloading: false, autoReloadInitialized: false,
      lastInteractionAt: 0, interactionVersion: 0
    };
    const MAX_CUSTOM_CODE_LENGTH = ${MAX_CUSTOM_CODE_LENGTH};
    const MAX_CUSTOM_CODE_ITEMS = ${MAX_CUSTOM_CODE_ITEMS};
    const MAX_CUSTOM_CODE_NAME_LENGTH = ${MAX_CUSTOM_CODE_NAME_LENGTH};
    const CUSTOM_CODE_SAVE_DELAY = 1000;
    const PREFERENCE_MIN_SAVE_INTERVAL = 1100;
    const CUSTOM_CODE_RELOAD_DELAY = 2000;
    const CUSTOM_CODE_RESTORE_KEY = 'custom-code-editor-position';
    const CUSTOM_CODE_RESTORE_TTL = 60000;
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

    function hasUnsavedSettingsChanges() {
      // The current password is a credential, often autofilled by the browser.
      // Only a new password or its confirmation constitutes a password draft.
      return ['settingsNewPassword', 'settingsConfirmPassword']
        .some(id => document.getElementById(id)?.value)
        || defaultExportFormatDirty || customCodeState.dirty || Object.values(numericPreferences).some(state => state.dirty);
    }

    async function flushSettingsBeforeClose(signal) {
      // A user can keep editing while a save is pending. Wait for a stable
      // set of edits, so an earlier save cannot trigger a discard prompt
      // while a newer selection is still being saved in the background.
      const keys = Object.keys(numericPreferences);
      while (!signal?.aborted) {
        const versions = keys.map(key => numericPreferences[key].version);
        const formatSave = defaultExportFormatPending;
        const customCodeVersion = customCodeState.version;
        await Promise.all([...keys.map(key => saveNumericPreference(key)), formatSave, saveCustomCode()]);
        if (signal?.aborted) return;
        if (formatSave === defaultExportFormatPending
          && !customCodeState.saving
          && customCodeVersion === customCodeState.version
          && keys.every((key, index) => numericPreferences[key].version === versions[index])) return;
      }
    }

    function discardSettingsDrafts() {
      ['settingsCurrentPassword', 'settingsNewPassword', 'settingsConfirmPassword'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      for (const state of Object.values(numericPreferences)) {
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = null;
        state.dirty = false;
        state.version += 1;
      }
      defaultExportFormatDirty = false;
      defaultExportFormatChangeVersion += 1;
      customCodeState.version += 1;
      customCodeState.generation += 1;
      customCodeState.requestId += 1;
      customCodeState.loading = null;
      customCodeState.loaded = false;
      customCodeState.dirty = false;
      customCodeState.failed = false;
      customCodeState.uncertain = false;
      clearCustomCodeSaveTimer();
      customCodeState.wakeSave?.();
      clearCustomCodeReloadTimer();
      customCodeState.composing.clear();
      customCodeState.items = cloneCustomCodes(customCodeState.savedItems || []);
      renderCustomCodeItems();
      clearCustomCodeResult();
      updateCustomCodeControls();
    }

    // All preferences share one KV key. Serialize every settings write and
    // leave the full KV interval after the previous request finishes, including
    // failures whose response may have been lost after the server wrote.
    function enqueuePreferenceSave(save) {
      const request = preferenceSaveQueue.then(async () => {
        const delay = lastPreferenceSaveAt === null ? 0
          : lastPreferenceSaveAt + PREFERENCE_MIN_SAVE_INTERVAL - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        let result;
        try {
          result = await save();
          return result;
        } finally {
          // Callbacks recheck drafts after waiting. A skipped callback made no
          // request, so it must not extend the interval for the next writer.
          if (result !== false && result !== null) lastPreferenceSaveAt = Date.now();
        }
      });
      preferenceSaveQueue = request.catch(() => {});
      return request;
    }

    /**
     * 切换设置标签
     * @param {string} tabName - 标签名称
     */
    function switchSettingsTab(tabName) {
      activeSettingsTab = tabName;
      const addCustomCodeButton = document.getElementById('settingsCustomCodeAdd');
      if (addCustomCodeButton) addCustomCodeButton.hidden = tabName !== 'custom-code';

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
      if (tabName === 'custom-code') {
        loadCustomCode();
      }
      if (tabName === 'about' && typeof renderAboutPanel === 'function') {
        renderAboutPanel();
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
      updateCustomCodeControls();
    }

    function updateCustomCodeControls() {
      const add = document.getElementById('settingsCustomCodeAdd');
      const retry = document.getElementById('settingsCustomCodeRetry');
      const empty = document.getElementById('settingsCustomCodeEmpty');
      if (add) {
        add.disabled = !customCodeState.loaded || customCodeState.items.length >= MAX_CUSTOM_CODE_ITEMS;
        add.textContent = t('customCodeAdd');
        add.title = customCodeState.items.length >= MAX_CUSTOM_CODE_ITEMS
          ? t('customCodeLimitReached', { max: MAX_CUSTOM_CODE_ITEMS }) : '';
      }
      if (retry) {
        retry.hidden = !customCodeState.failed;
        retry.disabled = Boolean(customCodeState.saving);
        retry.textContent = t('customCodeRetry');
      }
      if (empty) {
        empty.hidden = !customCodeState.loaded || customCodeState.items.length > 0;
        empty.textContent = t('customCodeEmpty');
      }
      const rows = document.getElementById('settingsCustomCodeList')?.children || [];
      Array.from(rows).forEach((row, index) => {
        const item = customCodeState.items.find(entry => entry.id === row.dataset.codeId);
        if (!item) return;
        const name = row.querySelector('.settings-code-name');
        const toggle = row.querySelector('.settings-code-toggle input');
        const editor = row.querySelector('.settings-code-editor');
        const remove = row.querySelector('.settings-code-remove');
        const summary = row.querySelector('.settings-code-summary');
        const expanded = customCodeState.expandedId === item.id;
        row.querySelector('.settings-code-title').textContent = item.name || t('customCodeUntitled', { index: index + 1 });
        summary.setAttribute('aria-expanded', String(expanded));
        row.querySelector('.settings-code-body').hidden = !expanded;
        row.querySelector('.settings-code-name-label').textContent = t('customCodeNameLabel');
        row.querySelector('.settings-code-editor-label').textContent = t('customCodeEditorLabel');
        name.placeholder = t('customCodeNamePlaceholder');
        name.setAttribute('aria-label', t('customCodeNameLabel') + ' ' + (index + 1));
        toggle.setAttribute('aria-label', t('customCodeEnabled') + ' ' + (item.name || (index + 1)));
        row.querySelector('.settings-code-toggle span').textContent = t(item.enabled ? 'customCodeEnabled' : 'customCodeDisabled');
        editor.setAttribute('aria-label', t('customCodeEditorLabel') + ' ' + (item.name || (index + 1)));
        remove.textContent = t('customCodeDelete');
        remove.setAttribute('aria-label', t('customCodeDelete') + ' ' + (item.name || (index + 1)));
        [name, toggle, editor, remove, summary].forEach(control => { control.disabled = !customCodeState.loaded; });
      });
    }

    function showCustomCodeResult(key, status = '', params = {}) {
      setSettingsText('settingsCustomCodeResult', key, params);
      const result = document.getElementById('settingsCustomCodeResult');
      if (result) {
        result.className = 'settings-result' + (status ? ' ' + status : '');
        result.style.display = 'block';
      }
    }

    function clearCustomCodeResult() {
      settingsTextState.delete('settingsCustomCodeResult');
      const result = document.getElementById('settingsCustomCodeResult');
      if (result) {
        result.textContent = '';
        result.style.display = 'none';
      }
      document.querySelectorAll('#settingsCustomCodeList [aria-invalid]').forEach(input => input.setAttribute('aria-invalid', 'false'));
    }

    function cloneCustomCodes(items) {
      return items.map(({ id, name, enabled, code }) => ({ id, name, enabled, code }));
    }

    function customCodesMatch(left, right) {
      return right !== null && JSON.stringify(left) === JSON.stringify(right);
    }

    function effectiveCustomCode(items) {
      // Names, disabled entries and a new empty editor do not change the page.
      return items.filter(item => item.enabled && item.code.trim()).map(item => item.code).join('\\n');
    }

    function clearCustomCodeSaveTimer() {
      if (customCodeState.timer !== null) clearTimeout(customCodeState.timer);
      customCodeState.timer = null;
    }

    function setExpandedCustomCode(id) {
      // Keep the editors mounted so collapsing preserves their drafts, selection
      // and IME listeners. Flush a focused editor before its body becomes hidden.
      const active = document.activeElement;
      const row = active?.closest('.settings-code-item');
      if (row && row.dataset.codeId !== id && row.querySelector('.settings-code-body').contains(active)) {
        active.blur();
      }
      customCodeState.expandedId = id;
      updateCustomCodeControls();
    }

    function createCustomCodeRow(item) {
      const row = document.createElement('section');
      row.className = 'settings-code-item';
      row.dataset.codeId = item.id;
      const header = document.createElement('div');
      header.className = 'settings-code-item-header';
      const summary = document.createElement('button');
      summary.type = 'button';
      summary.className = 'settings-code-summary';
      const title = document.createElement('span');
      title.className = 'settings-code-title';
      summary.appendChild(title);
      const body = document.createElement('div');
      body.className = 'settings-code-body';
      body.id = 'settings-code-body-' + item.id;
      body.hidden = true;
      summary.setAttribute('aria-controls', body.id);
      summary.addEventListener('click', () => {
        setExpandedCustomCode(customCodeState.expandedId === item.id ? null : item.id);
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'settings-code-name';
      name.id = 'settings-code-name-' + item.id;
      name.maxLength = MAX_CUSTOM_CODE_NAME_LENGTH;
      name.value = item.name;
      name.autocomplete = 'off';
      const nameLabel = document.createElement('label');
      nameLabel.className = 'settings-code-label settings-code-name-label';
      nameLabel.htmlFor = name.id;
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'settings-code-toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.checked = item.enabled;
      const toggleText = document.createElement('span');
      toggleLabel.append(toggle, toggleText);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary settings-code-remove';
      remove.addEventListener('click', () => removeCustomCode(item.id));
      const editor = document.createElement('textarea');
      editor.className = 'settings-code-editor';
      editor.id = 'settings-code-editor-' + item.id;
      editor.rows = 8;
      editor.spellcheck = false;
      editor.autocomplete = 'off';
      editor.autocapitalize = 'off';
      editor.value = item.code;
      const editorLabel = document.createElement('label');
      editorLabel.className = 'settings-code-label settings-code-editor-label';
      editorLabel.htmlFor = editor.id;
      // Code and names stay in form values; neither becomes executable HTML.
      [[name, 'name'], [editor, 'code']].forEach(([input, field]) => {
        input.addEventListener('input', event => {
          item[field] = input.value;
          markCustomCodeDirty(false, event.isComposing);
        });
        input.addEventListener('compositionstart', () => {
          customCodeState.composing.add(input);
          clearCustomCodeSaveTimer();
          clearCustomCodeReloadTimer();
        });
        input.addEventListener('compositionend', () => {
          customCodeState.composing.delete(input);
          item[field] = input.value;
          markCustomCodeDirty();
        });
        input.addEventListener('blur', () => {
          customCodeState.composing.delete(input);
          item[field] = input.value;
          saveCustomCode();
        });
      });
      toggle.addEventListener('change', () => {
        item.enabled = toggle.checked;
        markCustomCodeDirty(true);
      });
      header.append(summary, toggleLabel, remove);
      body.append(nameLabel, name, editorLabel, editor);
      row.append(header, body);
      return row;
    }

    function renderCustomCodeItems() {
      const list = document.getElementById('settingsCustomCodeList');
      if (!list) return;
      if (!customCodeState.items.some(item => item.id === customCodeState.expandedId)) customCodeState.expandedId = null;
      list.replaceChildren(...customCodeState.items.map(createCustomCodeRow));
      updateCustomCodeControls();
    }

    function loadCustomCode() {
      const list = document.getElementById('settingsCustomCodeList');
      if (!list || customCodeState.dirty) return Promise.resolve();
      if (customCodeState.saving) return customCodeState.saving.then(() => loadCustomCode());
      if (customCodeState.loading) return customCodeState.loading;
      const requestId = ++customCodeState.requestId;
      const version = customCodeState.version;
      showCustomCodeResult('customCodeLoading');
      updateCustomCodeControls();
      const loading = Promise.resolve().then(async () => {
        try {
          const response = await authenticatedFetch('/api/settings');
          if (!response.ok) throw new Error('Custom code settings request failed');
          const data = await response.json();
          if (requestId !== customCodeState.requestId || version !== customCodeState.version) return;
          const items = Array.isArray(data.customCodes) ? cloneCustomCodes(data.customCodes)
            : typeof data.customCode === 'string' && data.customCode
              ? [{ id: 'legacy-custom-code', name: '', enabled: true, code: data.customCode }] : [];
          customCodeState.savedItems = cloneCustomCodes(items);
          if (customCodeState.appliedCode === null) customCodeState.appliedCode = effectiveCustomCode(items);
          customCodeState.items = items;
          customCodeState.loaded = true;
          customCodeState.dirty = false;
          customCodeState.failed = false;
          customCodeState.uncertain = false;
          renderCustomCodeItems();
          if (customCodeState.reloadRequired) showCustomCodeResult('customCodeSaved', 'success');
          else clearCustomCodeResult();
        } catch {
          if (requestId === customCodeState.requestId && version === customCodeState.version) {
            showCustomCodeResult('customCodeLoadFailed', 'error');
          }
        } finally {
          if (customCodeState.loading === loading) customCodeState.loading = null;
          updateCustomCodeControls();
        }
      });
      customCodeState.loading = loading;
      return loading;
    }

    function addCustomCode() {
      if (!customCodeState.loaded || customCodeState.items.length >= MAX_CUSTOM_CODE_ITEMS) return;
      const item = {
        id: window.crypto?.randomUUID?.() || 'custom-code-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        name: '', enabled: true, code: ''
      };
      customCodeState.items.push(item);
      const row = createCustomCodeRow(item);
      document.getElementById('settingsCustomCodeList').appendChild(row);
      setExpandedCustomCode(item.id);
      markCustomCodeDirty(true);
      row.querySelector('.settings-code-name').focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function removeCustomCode(id) {
      if (!customCodeState.loaded || !customCodeState.items.some(item => item.id === id)) return;
      const generation = customCodeState.generation;
      const confirmed = await showConfirmDialog({
        i18n: { title: 'customCodeDelete', message: 'customCodeDeleteConfirm', confirmText: 'customCodeDelete', cancelText: 'cancel' },
        danger: true
      });
      if (!confirmed || generation !== customCodeState.generation) return;
      customCodeState.items = customCodeState.items.filter(item => item.id !== id);
      if (customCodeState.expandedId === id) customCodeState.expandedId = null;
      const list = document.getElementById('settingsCustomCodeList');
      const row = Array.from(list.children).find(item => item.dataset.codeId === id);
      if (row) {
        row.querySelectorAll('input, textarea').forEach(input => customCodeState.composing.delete(input));
        row.remove();
      }
      markCustomCodeDirty(true);
      document.getElementById('settingsCustomCodeAdd')?.focus();
    }

    function validateCustomCodes() {
      const tooLong = customCodeState.items.reduce((total, item) => total + item.code.length, 0) > MAX_CUSTOM_CODE_LENGTH;
      const nameTooLong = customCodeState.items.some(item => item.name.length > MAX_CUSTOM_CODE_NAME_LENGTH);
      document.querySelectorAll('#settingsCustomCodeList .settings-code-editor').forEach(input => input.setAttribute('aria-invalid', String(tooLong)));
      document.querySelectorAll('#settingsCustomCodeList .settings-code-name').forEach(input => input.setAttribute('aria-invalid', String(input.value.length > MAX_CUSTOM_CODE_NAME_LENGTH)));
      if (tooLong) showCustomCodeResult('customCodeTooLong', 'error', { max: MAX_CUSTOM_CODE_LENGTH });
      else if (nameTooLong) showCustomCodeResult('customCodeNameTooLong', 'error', { max: MAX_CUSTOM_CODE_NAME_LENGTH });
      return !tooLong && !nameTooLong;
    }

    function markCustomCodeDirty(immediate = false, composing = false) {
      noteCustomCodeInteraction();
      customCodeState.saveNotBefore = immediate ? 0 : Date.now() + CUSTOM_CODE_SAVE_DELAY;
      customCodeState.version += 1;
      customCodeState.dirty = customCodeState.uncertain || !customCodesMatch(customCodeState.items, customCodeState.savedItems);
      customCodeState.failed = false;
      clearCustomCodeSaveTimer();
      if (validateCustomCodes()) {
        if (customCodeState.dirty) showCustomCodeResult('customCodeWaiting');
        else if (customCodeState.reloadRequired) showCustomCodeResult('customCodeSaved', 'success');
        else clearCustomCodeResult();
        if (customCodeState.dirty && !composing && customCodeState.composing.size === 0) {
          if (immediate) saveCustomCode();
          else customCodeState.timer = setTimeout(() => {
            customCodeState.timer = null;
            saveCustomCode(false);
          }, CUSTOM_CODE_SAVE_DELAY);
        }
      }
      updateCustomCodeControls();
    }

    function retryCustomCodeSave() {
      customCodeState.failed = false;
      return saveCustomCode();
    }

    function customCodeSaveDelay() {
      return customCodeState.saveNotBefore - Date.now();
    }

    function waitForCustomCodeSave(delay) {
      return new Promise(resolve => {
        customCodeState.wakeSave = () => {
          clearTimeout(customCodeState.saveWaitTimer);
          customCodeState.saveWaitTimer = null;
          customCodeState.wakeSave = null;
          resolve();
        };
        customCodeState.saveWaitTimer = setTimeout(customCodeState.wakeSave, delay);
      });
    }

    function saveCustomCode(immediate = true) {
      clearCustomCodeSaveTimer();
      if (immediate) {
        customCodeState.saveNotBefore = 0;
        customCodeState.wakeSave?.();
      }
      if (customCodeState.saving) return customCodeState.saving;
      if (!customCodeState.loaded || !customCodeState.dirty || customCodeState.failed || customCodeState.composing.size > 0 || !validateCustomCodes()) return Promise.resolve();
      const generation = customCodeState.generation;
      // A refresh started before this save must not restore the previous code.
      customCodeState.requestId += 1;
      const saving = Promise.resolve().then(async () => {
        try {
          while (customCodeState.dirty && generation === customCodeState.generation && customCodeState.composing.size === 0) {
            if (!validateCustomCodes()) break;
            clearCustomCodeSaveTimer();
            const delay = customCodeSaveDelay();
            if (delay > 0) {
              showCustomCodeResult('customCodeWaiting');
              await waitForCustomCodeSave(delay);
              // Input may move the debounce deadline while this wait is active.
              continue;
            }
            // Capture the latest draft only when the shared write queue reaches
            // us. Toggles and edits during the throttle become one write.
            const items = await enqueuePreferenceSave(async () => {
              if (generation !== customCodeState.generation || !customCodeState.dirty
                || customCodeState.composing.size > 0 || !validateCustomCodes()) return null;
              // A different preference may have held the queue while typing
              // continued. Leave the queue and wait for that newer input.
              if (customCodeSaveDelay() > 0) return false;
              clearCustomCodeSaveTimer();
              const currentItems = cloneCustomCodes(customCodeState.items);
              showCustomCodeResult('customCodeSaving');
              const response = await authenticatedFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customCodes: currentItems })
              });
              const data = await response.json();
              if (!response.ok || !data.success) throw new Error('Custom code settings save failed');
              return currentItems;
            });
            if (items === false) continue;
            if (!items) break;
            customCodeState.savedItems = items;
            customCodeState.uncertain = false;
            if (generation === customCodeState.generation) {
              customCodeState.reloadRequired = effectiveCustomCode(items) !== customCodeState.appliedCode;
              customCodeState.dirty = !customCodesMatch(customCodeState.items, items);
              showCustomCodeResult(customCodeState.dirty ? 'customCodeWaiting'
                : customCodeState.reloadRequired ? 'customCodeSaved' : 'customCodeSavedOnly', customCodeState.dirty ? '' : 'success');
            }
          }
        } catch {
          // A lost response may still have reached the server. Preserve the
          // draft and require another edit or an explicit retry after failure.
          customCodeState.uncertain = true;
          if (generation === customCodeState.generation) {
            clearCustomCodeSaveTimer();
            customCodeState.dirty = true;
            customCodeState.failed = true;
            showCustomCodeResult('customCodeSaveFailed', 'error');
          }
        } finally {
          if (customCodeState.saving === saving) customCodeState.saving = null;
          updateCustomCodeControls();
          if (generation === customCodeState.generation) scheduleCustomCodeReload();
        }
      });
      customCodeState.saving = saving;
      updateCustomCodeControls();
      return saving;
    }

    function clearCustomCodeReloadTimer() {
      customCodeState.reloadVersion += 1;
      if (customCodeState.reloadTimer !== null) clearTimeout(customCodeState.reloadTimer);
      customCodeState.reloadTimer = null;
    }

    function noteCustomCodeInteraction() {
      customCodeState.lastInteractionAt = Date.now();
      customCodeState.interactionVersion += 1;
      scheduleCustomCodeReload();
    }

    function isCustomCodeModalVisible(modal) {
      return !modal.hidden && !modal.inert && window.getComputedStyle(modal).display !== 'none';
    }

    function hasOtherCustomCodeModal() {
      return Array.from(document.querySelectorAll('.modal')).some(modal =>
        modal.id !== 'settingsModal' && isCustomCodeModalVisible(modal));
    }

    function customCodeReloadBlocked() {
      return hasUnsavedSettingsChanges() || pendingLanguageSaves > 0 || defaultExportFormatPending !== null
        || (typeof window.hasAppearancePendingChanges === 'function' && window.hasAppearancePendingChanges())
        || Object.values(numericPreferences).some(state => state.saving)
        || document.hidden || hasOtherCustomCodeModal();
    }

    function rememberCustomCodeEditorPosition() {
      try {
        const modal = document.getElementById('settingsModal');
        if (!modal || !isCustomCodeModalVisible(modal) || activeSettingsTab !== 'custom-code') {
          window.sessionStorage.removeItem(CUSTOM_CODE_RESTORE_KEY);
          return;
        }
        const focused = document.activeElement;
        const row = focused?.closest('.settings-code-item');
        const expandedRow = Array.from(document.getElementById('settingsCustomCodeList').children)
          .find(item => item.dataset.codeId === customCodeState.expandedId);
        const expandedEditor = expandedRow?.querySelector('.settings-code-editor');
        const field = focused?.classList.contains('settings-code-editor') ? 'code'
          : focused?.classList.contains('settings-code-name') ? 'name' : null;
        const position = {
          createdAt: Date.now(), expandedId: customCodeState.expandedId,
          scrollTop: modal.querySelector('.settings-content')?.scrollTop || 0,
          editorScroll: expandedEditor ? { top: expandedEditor.scrollTop, left: expandedEditor.scrollLeft } : null,
          focus: row && field ? { id: row.dataset.codeId, field,
            start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null
        };
        // Store only interface position. Code, passwords and other drafts never
        // leave their inputs through this reload helper.
        window.sessionStorage.setItem(CUSTOM_CODE_RESTORE_KEY, JSON.stringify(position));
      } catch {
        // Storage can be unavailable in a private or restricted browser.
      }
    }

    function scheduleCustomCodeReload(delay = CUSTOM_CODE_RELOAD_DELAY) {
      clearCustomCodeReloadTimer();
      if (!customCodeState.reloadRequired || customCodeState.reloading || customCodeState.failed) return;
      const version = customCodeState.reloadVersion;
      const generation = customCodeState.generation;
      customCodeState.reloadTimer = setTimeout(() => {
        customCodeState.reloadTimer = null;
        if (version !== customCodeState.reloadVersion || generation !== customCodeState.generation) return;
        applySavedCustomCode();
      }, delay);
    }

    function applySavedCustomCode() {
      if (window.__2FA_SAFE_MODE__) return;
      if (!customCodeState.reloadRequired || customCodeState.reloading || customCodeState.failed
        || customCodeState.dirty || customCodeState.saving
        || customCodeState.composing.size > 0 || customCodeState.reloadComposing.size > 0) return;
      const idleRemaining = customCodeState.lastInteractionAt + CUSTOM_CODE_RELOAD_DELAY - Date.now();
      if (idleRemaining > 0) {
        scheduleCustomCodeReload(idleRemaining);
        return;
      }
      if (customCodeState.loading || customCodeReloadBlocked()) {
        showCustomCodeResult('customCodeSavedPending', 'success');
        // Only recheck readiness. Never submit, flush or discard another form.
        scheduleCustomCodeReload(500);
        return;
      }
      customCodeState.reloading = true;
      clearCustomCodeReloadTimer();
      showCustomCodeResult('customCodeAutoApplying', 'success');
      rememberCustomCodeEditorPosition();
      const url = new URL(window.location.href);
      if (url.searchParams.has('disableCustomCode')) {
        url.searchParams.delete('disableCustomCode');
        window.location.assign(url.toString());
      } else {
        // Assigning an unchanged URL with a fragment can be only an in-page
        // navigation. A real reload is required to execute the saved code.
        window.location.reload();
      }
    }

    async function restoreCustomCodeEditorPosition() {
      let position;
      try {
        const stored = window.sessionStorage.getItem(CUSTOM_CODE_RESTORE_KEY);
        window.sessionStorage.removeItem(CUSTOM_CODE_RESTORE_KEY);
        position = stored && JSON.parse(stored);
      } catch { return; }
      if (!position || !Number.isFinite(position.createdAt)
        || Date.now() - position.createdAt < 0 || Date.now() - position.createdAt > CUSTOM_CODE_RESTORE_TTL
        || hasOtherCustomCodeModal()) return;
      const interactionVersion = customCodeState.interactionVersion;
      await loadCustomCode();
      if (!customCodeState.loaded || hasOtherCustomCodeModal()
        || interactionVersion !== customCodeState.interactionVersion) return;
      showSettingsModal();
      switchSettingsTab('custom-code');
      await loadCustomCode();
      const modal = document.getElementById('settingsModal');
      if (!modal || !isCustomCodeModalVisible(modal) || activeSettingsTab !== 'custom-code' || hasOtherCustomCodeModal()
        || interactionVersion !== customCodeState.interactionVersion) return;
      const expanded = customCodeState.items.find(item => item.id === position.expandedId);
      setExpandedCustomCode(expanded ? expanded.id : null);
      const focus = position.focus;
      if (expanded && focus?.id === expanded.id && ['name', 'code'].includes(focus.field)) {
        const row = Array.from(document.getElementById('settingsCustomCodeList').children)
          .find(item => item.dataset.codeId === focus.id);
        const field = row?.querySelector(focus.field === 'code' ? '.settings-code-editor' : '.settings-code-name');
        if (field) {
          field.focus({ preventScroll: true });
          if (Number.isInteger(focus.start) && Number.isInteger(focus.end)) {
            field.setSelectionRange(focus.start, focus.end, ['forward', 'backward', 'none'].includes(focus.direction) ? focus.direction : 'none');
          }
        }
      }
      const content = modal.querySelector('.settings-content');
      const expandedEditor = expanded && document.getElementById('settings-code-editor-' + expanded.id);
      if (expandedEditor && position.editorScroll) {
        if (Number.isFinite(position.editorScroll.top)) expandedEditor.scrollTop = Math.max(0, position.editorScroll.top);
        if (Number.isFinite(position.editorScroll.left)) expandedEditor.scrollLeft = Math.max(0, position.editorScroll.left);
      }
      if (content && Number.isFinite(position.scrollTop)) content.scrollTop = Math.max(0, position.scrollTop);
    }

    function initCustomCodeAutoReload() {
      if (customCodeState.autoReloadInitialized) return Promise.resolve();
      customCodeState.autoReloadInitialized = true;
      ['input', 'change', 'keydown', 'pointerdown'].forEach(type => {
        document.addEventListener(type, noteCustomCodeInteraction, true);
      });
      document.addEventListener('compositionstart', event => {
        customCodeState.reloadComposing.add(event.target);
        noteCustomCodeInteraction();
      }, true);
      document.addEventListener('compositionend', event => {
        customCodeState.reloadComposing.delete(event.target);
        noteCustomCodeInteraction();
      }, true);
      document.addEventListener('blur', event => {
        if (customCodeState.reloadComposing.delete(event.target)) noteCustomCodeInteraction();
      }, true);
      document.addEventListener('visibilitychange', noteCustomCodeInteraction);
      return restoreCustomCodeEditorPosition();
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
      return openThemeHostChild('settingsModal','webdavModal',()=>showWebdavModal(),()=>hideWebdavModal());
    }

    /**
     * 从设置弹窗打开 S3 配置
     */
    function openS3FromSettings() {
      return openThemeHostChild('settingsModal','s3Modal',()=>showS3Modal(),()=>hideS3Modal());
    }

    /**
     * 从设置弹窗打开 OneDrive 配置
     */
    function openOneDriveFromSettings() {
      return openThemeHostChild('settingsModal','oneDriveModal',()=>showOneDriveModal(),()=>hideOneDriveModal());
    }

    /**
     * 从设置弹窗打开 Google Drive 配置
     */
    function openGoogleDriveFromSettings() {
      return openThemeHostChild('settingsModal','googleDriveModal',()=>showGoogleDriveModal(),()=>hideGoogleDriveModal());
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

      const viewModeSelect = document.getElementById('settingsDefaultViewMode');
      if (viewModeSelect && typeof getDefaultViewModePreference === 'function') {
        viewModeSelect.value = getDefaultViewModePreference();
      }

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
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('preferences');
    }

    /**
     * 设置刷新或重新打开时的默认显示方式，并立即应用。
     * 右上角的临时切换只更新上次选择，不改变此偏好。
     */
    async function applyDefaultViewModeFromSettings(mode) {
      const appliedMode = setDefaultViewModePreference(mode);
      const viewModeSelect = document.getElementById('settingsDefaultViewMode');
      if (viewModeSelect) {
        viewModeSelect.value = appliedMode;
      }
      await selectViewMode(appliedMode === 'remember' ? currentViewMode : appliedMode);
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('preferences');
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
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('preferences');
    }

    /**
     * 保存导出偏好格式
     */
    function saveDefaultExportFormat() {
      const saving = saveDefaultExportFormatRequest();
      defaultExportFormatPending = saving;
      void saving.finally(() => {
        if (defaultExportFormatPending === saving) defaultExportFormatPending = null;
      });
      return saving;
    }

    async function saveDefaultExportFormatRequest() {
      const formatSelect = document.getElementById('settingsDefaultExportFormat');
      if (!formatSelect) return;
      const selectedFormat = formatSelect.value;
      defaultExportFormatDirty = true;
      const requestId = ++defaultExportFormatSaveRequestId;
      const version = ++defaultExportFormatChangeVersion;

      try {
        const resp = await enqueuePreferenceSave(() => {
          if (!defaultExportFormatDirty || version !== defaultExportFormatChangeVersion
            || requestId !== defaultExportFormatSaveRequestId) return null;
          return authenticatedFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultExportFormat: selectedFormat }),
          });
        });
        if (!resp) return;
        const data = await resp.json();
        if (requestId !== defaultExportFormatSaveRequestId || version !== defaultExportFormatChangeVersion) {
          return;
        }

        if (resp.ok && data.success) {
          defaultExportFormatDirty = false;
          const savedFormat = (data.settings && data.settings.defaultExportFormat) || selectedFormat;
          formatSelect.value = savedFormat;
          localStorage.setItem('defaultExportFormat', savedFormat);
          showCenterToast('✅', t('defaultExportFormatSaved'));
        } else {
          showCenterToast('❌', data.message || t('defaultExportFormatFailed'));
        }
      } catch {
        if (requestId !== defaultExportFormatSaveRequestId || version !== defaultExportFormatChangeVersion) {
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
      const sessionGeneration = typeof secretSessionGeneration === 'number' ? secretSessionGeneration : null;
      const sessionCurrent = () => sessionGeneration === null || typeof isSecretSessionCurrent !== 'function' || isSecretSessionCurrent(sessionGeneration);
      if (typeof setLanguage === 'function') {
        setLanguage(selectedLang);
      }
      pendingLanguageSaves += 1;
      try {
        const resp = await enqueuePreferenceSave(() => !sessionCurrent() ? null : authenticatedFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: selectedLang }),
        }));
        if (!resp || !sessionCurrent()) return { status: 'session-invalidated' };
        const data = await resp.json();
        if (!sessionCurrent()) return { status: 'session-invalidated' };
        if (resp.ok && data.success) {
          const msg = t('languageSaved');
          if (typeof showCenterToast === 'function') {
            showCenterToast('✅', msg);
          }
          return { status: 'committed' };
        }
        return { status: 'rejected', reason: 'language-save-failed' };
      } catch (e) {
        // 静默网络异常或保持当前界面语言
        if (!sessionCurrent()) return { status: 'session-invalidated' };
        return { status: 'unknown', reason: 'language-local-only' };
      } finally {
        pendingLanguageSaves -= 1;
        if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('preferences');
      }
    }

    function getThemePublicPreferences() {
      const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
      return {
        language: typeof getLanguagePreference === 'function' ? getLanguagePreference() : read('language', 'auto'),
        resolvedLanguage: typeof getLanguage === 'function' ? getLanguage() : 'en',
        theme: read('theme', 'auto'), resolvedTheme: document.documentElement.getAttribute('data-theme') || 'light',
        defaultViewMode: typeof getDefaultViewModePreference === 'function' ? getDefaultViewModePreference() : 'remember',
        otpAnimation: typeof getOTPAnimationMode === 'function' ? getOTPAnimationMode() : 'none',
        reducedMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
        defaultExportFormat: read('defaultExportFormat', 'json'), maxBackups: numericPreferences.maxBackups.savedValue
      };
    }

    async function setThemePublicPreferences(patch) {
      const sessionGeneration = typeof secretSessionGeneration === 'number' ? secretSessionGeneration : null;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { status: 'rejected', reason: 'invalid-preferences' };
      const allowed = {
        language: value => value === 'auto' || (typeof I18N_LOCALES !== 'undefined' && Object.prototype.hasOwnProperty.call(I18N_LOCALES, value)),
        theme: value => ['auto', 'light', 'dark'].includes(value),
        defaultViewMode: value => ['remember', 'grouped', 'flat'].includes(value),
        otpAnimation: value => ['none', 'flow', 'flip', 'spotlight'].includes(value)
      };
      if (Object.keys(patch).some(key => !allowed[key] || !allowed[key](patch[key]))) return { status: 'rejected', reason: 'invalid-preferences' };
      try {
        if (Object.prototype.hasOwnProperty.call(patch, 'theme')) applyThemeFromSettings(patch.theme);
        if (Object.prototype.hasOwnProperty.call(patch, 'otpAnimation')) applyOTPAnimationFromSettings(patch.otpAnimation);
        if (Object.prototype.hasOwnProperty.call(patch, 'defaultViewMode')) await applyDefaultViewModeFromSettings(patch.defaultViewMode);
        if (sessionGeneration !== null && typeof isSecretSessionCurrent === 'function' && !isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
        if (Object.prototype.hasOwnProperty.call(patch, 'language')) return await saveLanguagePreference(patch.language);
        return { status: 'committed' };
      } catch { return { status: 'rejected', reason: 'preference-save-failed' }; }
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
      // Even an invalid new draft must wait for a previously submitted save.
      if (state.saving) return state.saving;
      if (!state.dirty || readNumericPreference(key) === null) return;

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
            const resp = await enqueuePreferenceSave(() => {
              if (!state.dirty || version !== state.version) return null;
              return authenticatedFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: value }),
              });
            });
            if (!resp) {
              if (state.timer !== null) break;
              continue;
            }
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
