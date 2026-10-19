/** Shared user-initiated dismissal. Successful saves still use their own cleanup functions. */
export function getModalDismissalCode() {
	return `
    const modalSessions = new Map();
    const modalOriginalZ = new WeakMap();
    const approvedModalClicks = new WeakSet();
    const MODAL_SAVE_WAIT_MS = 5000;
    let modalDismissalInitialized = false;
    let modalPointerStart = null;

    function modalFieldValues(modal) {
      const values = new Map();
      modal.querySelectorAll('input, textarea, select').forEach(field => {
        if (field.type === 'hidden' || field.readOnly || field.id === 'showAdvanced') return;
        if (modal.id === 'qrScanModal' || modal.id === 'settingsModal') return;
        if (modal.id === 'restoreModal' && field.id !== 'restoreBackupFileInput') return;
        const value = field.type === 'file'
          ? Array.from(field.files || []).map(file => [file.name, file.size, file.lastModified])
          : (field.type === 'checkbox' || field.type === 'radio') ? field.checked
          : field.multiple ? Array.from(field.selectedOptions).map(option => option.value) : field.value;
        values.set(field, JSON.stringify(value));
      });
      return values;
    }

    function markModalSaved(id) {
      const modal = typeof id === 'string' ? document.getElementById(id) : id;
      const session = modal && modalSessions.get(modal);
      if (session) session.values = modalFieldValues(modal);
    }

    function trackModalOpen(modal, returnFocus = document.activeElement) {
      if (!modal || modalSessions.has(modal)) return;
      if (!modalOriginalZ.has(modal)) modalOriginalZ.set(modal, modal.style.zIndex);
      modal.style.zIndex = modalOriginalZ.get(modal);
      const base = Number(window.getComputedStyle(modal).zIndex) || 10000;
      const top = getTopModal();
      modal.style.zIndex = String(Math.max(base, top ? Number(top.style.zIndex) + 1 : base));
      modal.inert = false;
      modalSessions.set(modal, { values: modalFieldValues(modal), returnFocus, pending: false });
    }

    function trackModalClosed(modal) {
      const session = modalSessions.get(modal);
      if (!session) return;
      session.saveWaitController?.abort();
      modalSessions.delete(modal);
      modal.inert = true;
      const target = session.returnFocus;
      const parent = target && target.closest && target.closest('.modal');
      if (target && target.isConnected && (!parent || modalSessions.has(parent))) {
        target.focus({ preventScroll: true });
      }
    }

    function getTopModal() {
      let top = null;
      for (const modal of modalSessions.keys()) {
        if (!modal.isConnected || modal.style.display === 'none') {
          modalSessions.delete(modal);
          continue;
        }
        if (!top || Number(modal.style.zIndex) >= Number(top.style.zIndex)) top = modal;
      }
      return top;
    }

    function modalHasUnsavedChanges(modal, session) {
      if (modal.dataset.dialogKind !== 'form') return false;
      if (modal.id === 'settingsModal' && typeof hasUnsavedSettingsChanges === 'function') {
        return hasUnsavedSettingsChanges();
      }
      if (modal.id === 'migrationPreviewModal') return Boolean(window.pendingMigrationSecrets?.length);
      // A scanned account is a new draft even before the user edits its prefilled fields.
      if (modal.id === 'secretModal' && typeof editingId !== 'undefined' && !editingId
        && ['secretName', 'secretService', 'secretKey'].some(id => document.getElementById(id)?.value)) return true;
      for (const [field, value] of modalFieldValues(modal)) {
        if (session.values.has(field) && session.values.get(field) !== value) return true;
      }
      return false;
    }

    async function waitForModalSettingsSave(session) {
      const controller = new AbortController();
      session.saveWaitController = controller;
      let timer;
      let onAbort;
      try {
        return await Promise.race([
          Promise.resolve().then(() => flushSettingsBeforeClose(controller.signal)).then(() => true, () => false),
          new Promise(resolve => {
            onAbort = () => resolve(false);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(onAbort, MODAL_SAVE_WAIT_MS);
          })
        ]);
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        // Stop only this close attempt's waiting loop. An already submitted save may still finish.
        controller.abort();
        if (session.saveWaitController === controller) session.saveWaitController = null;
      }
    }

    async function requestModalDismiss(modal, button) {
      const session = modalSessions.get(modal);
      if (!session || session.pending || button.disabled || getTopModal() !== modal) return;
      session.pending = true;
      try {
        let savesSettled = true;
        if (modal.id === 'settingsModal' && typeof flushSettingsBeforeClose === 'function') {
          savesSettled = await waitForModalSettingsSave(session);
        }
        if (modalSessions.get(modal) !== session || getTopModal() !== modal) return;
        if (!savesSettled || modalHasUnsavedChanges(modal, session)) {
          const discard = await showConfirmDialog({
            i18n: { title: savesSettled ? 'dialogDiscardTitle' : 'dialogSavePendingTitle',
              message: savesSettled ? 'dialogDiscardMessage' : 'dialogSavePendingMessage',
              confirmText: savesSettled ? 'dialogDiscard' : 'close', cancelText: 'dialogKeepEditing' },
            danger: true
          });
          if (!discard || modalSessions.get(modal) !== session || getTopModal() !== modal) return;
          if (modal.id === 'settingsModal' && typeof discardSettingsDrafts === 'function') discardSettingsDrafts();
        }
        // Replay the existing close action, including camera/timer cleanup or returning to a parent.
        if (!button.isConnected) return;
        approvedModalClicks.add(button);
        try { button.click(); } finally { approvedModalClicks.delete(button); }
      } finally {
        session.pending = false;
      }
    }

    function modalDismissButton(modal) {
      return modal.id === 'confirmDialogModal' ? document.getElementById('confirmDialogCancel')
        : modal.querySelector('.close-btn, [data-dialog-dismiss]');
    }

    function initModalDismissal() {
      if (modalDismissalInitialized) return;
      modalDismissalInitialized = true;
      document.addEventListener('pointerdown', event => { modalPointerStart = event.target; }, true);
      document.addEventListener('click', event => {
        const target = event.target;
        const modal = target.closest && target.closest('.modal');
        if (!modal || getTopModal() !== modal) return;
        const button = target.closest('.close-btn, [data-dialog-dismiss]');
        if (button && approvedModalClicks.has(button)) return;
        if (button) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void requestModalDismiss(modal, button);
        } else if (target === modal) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.detail && modalPointerStart !== modal) return;
          const close = modalDismissButton(modal);
          if (close) void requestModalDismiss(modal, close);
        }
      }, true);
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        const modal = getTopModal();
        if (!modal) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Holding Escape must not dismiss a confirmation and then the underlying form.
        if (event.repeat) return;
        const button = modalDismissButton(modal);
        if (button) void requestModalDismiss(modal, button);
      }, true);
    }
  `;
}
