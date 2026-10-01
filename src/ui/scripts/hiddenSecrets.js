/**
 * Accounts the server keeps but the page cannot show: invalid records, or OTP
 * parameters the page cannot generate codes for (for example kept by a restore).
 * The notice lists them and lets the user delete them one by one.
 */
export function getHiddenSecretsCode() {
	return `
    let hiddenSecretsExpanded = false;
    let hiddenSecretDeleting = false;

    function renderHiddenSecretsNotice() {
      const bar = document.getElementById('hiddenSecrets');
      if (!bar) return;
      const count = typeof getHiddenSecretsCount === 'function' ? getHiddenSecretsCount() : 0;
      const records = typeof getHiddenSecretRecords === 'function' ? getHiddenSecretRecords() : [];
      bar.hidden = count === 0;
      if (count === 0) {
        hiddenSecretsExpanded = false;
        return;
      }
      document.getElementById('hiddenSecretsSummary').textContent = t('coreInvalidRecordsHidden', { count });
      const toggle = document.getElementById('hiddenSecretsToggle');
      // Details come only from a server read; a local snapshot only knows the count.
      toggle.hidden = records.length === 0;
      if (records.length === 0) hiddenSecretsExpanded = false;
      toggle.textContent = t(hiddenSecretsExpanded ? 'offlineQueueCollapse' : 'offlineQueueView');
      toggle.setAttribute('aria-expanded', String(hiddenSecretsExpanded));
      const list = document.getElementById('hiddenSecretsList');
      list.hidden = !hiddenSecretsExpanded;
      list.replaceChildren();
      if (!hiddenSecretsExpanded) return;
      for (const record of records) {
        const item = document.createElement('li');
        const label = document.createElement('div');
        label.className = 'offline-queue-label';
        const name = record.name.trim() ? record.name : t('transferUnnamed');
        label.textContent = name.slice(0, 120) + (record.account ? ' · ' + record.account.slice(0, 120) : '');
        const reason = document.createElement('span');
        reason.className = 'offline-queue-reason';
        reason.style.cssText = 'display: block; color: var(--text-secondary); font-size: 12px; margin-top: 4px;';
        reason.textContent = t(record.reason === 'unsupported' ? 'hiddenSecretUnsupported' : 'hiddenSecretInvalid') +
          (record.id === null ? ' · ' + t('hiddenSecretNotDeletable') : '');
        label.append(reason);
        item.append(label);
        if (record.id !== null) {
          const controls = document.createElement('div');
          controls.className = 'offline-queue-actions';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-secondary btn-sm';
          button.textContent = t('delete');
          button.disabled = hiddenSecretDeleting;
          button.addEventListener('click', () => void deleteHiddenSecret(record.id));
          controls.append(button);
          item.append(controls);
        }
        list.append(item);
      }
    }

    function toggleHiddenSecretsDetails() {
      hiddenSecretsExpanded = !hiddenSecretsExpanded;
      renderHiddenSecretsNotice();
    }

    async function deleteHiddenSecret(id) {
      const sessionGeneration = secretSessionGeneration;
      if (hiddenSecretDeleting || !isSecretSessionCurrent(sessionGeneration)) return;
      const record = getHiddenSecretRecords().find(entry => entry.id === id);
      if (!record) return;
      const name = record.name.trim() ? record.name : t('transferUnnamed');
      const confirmed = await showConfirmDialog({
        i18n: { title: 'deleteSecretTitle', message: 'hiddenSecretDeleteConfirm', confirmText: 'delete', cancelText: 'cancel', params: { name } },
        title: t('deleteSecretTitle'),
        message: t('hiddenSecretDeleteConfirm', { name }),
        confirmText: t('delete'),
        cancelText: t('cancel'),
        danger: true
      });
      if (!confirmed || !isSecretSessionCurrent(sessionGeneration)) return;

      hiddenSecretDeleting = true;
      renderHiddenSecretsNotice();
      // Same queue as the other account changes, so a delete never overtakes an edit.
      saveQueue = saveQueue.then(async () => {
        try {
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          const response = await authenticatedFetch('/api/secrets/' + encodeURIComponent(id), { method: 'DELETE' });
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          if (response.status === 401) {
            handleUnauthorized(sessionGeneration);
            return;
          }
          // 404: the account was already deleted elsewhere.
          if (!response.ok && response.status !== 404) {
            showCenterToast('❌', t('coreDeleteRetry'));
            return;
          }
          const result = response.ok ? await response.json().catch(() => ({})) : {};
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          if (result && result.queued && result.offline) {
            showCenterToast('📥', t('coreQueued'));
            return;
          }
          forgetHiddenSecret(id, sessionGeneration);
          showCenterToast('✅', t('hiddenSecretDeleted'));
        } catch (error) {
          if (!isSecretSessionCurrent(sessionGeneration)) return;
          showCenterToast('❌', t('coreDeleteFailed') + error.message);
        } finally {
          hiddenSecretDeleting = false;
          renderHiddenSecretsNotice();
        }
      }).catch(error => console.error('删除未显示的账户失败:', error));
    }
`;
}
