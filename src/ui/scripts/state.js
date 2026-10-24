/**
 * 全局状态模块
 * 全局变量定义
 */
import { createAccountStore } from '../runtime/accountStore.js';
import { serializeBrowserFunction } from './browserSource.js';

/**
 * 获取 State 相关代码
 * @returns {string} State JavaScript 代码
 */
export function getStateCode() {
	return `    const accountStore = (${serializeBrowserFunction(createAccountStore)})();
    // Host-private read mirror. Every production write goes through accountStore.
    let secrets = accountStore.getRecords();
    let scanStream = null;
    let scannerCanvas = null;
    let scannerContext = null;
    let isScanning = false;
    let scanInterval = null;
    let editingId = null;
    let secretDialogGeneration = 0;
    let secretDialogOpen = false;
    let secretDialogSubmission = null;
    let secretDialogCommandGuard = null; // Host mount/reference guard, captured by an accepted submission.
    let secretDialogQueuedOperationId = null; // stopped offline change being corrected in the dialog
    let secretDialogStoredParams = null; // saved type and period of the edited account; the period is kept even if no longer offered
    let secretDialogShowTimer = null;
    let secretDialogHideTimer = null;
    let otpIntervals = {};
    let currentOTPAuthURL = '';
    let debugMode = false;
    let currentSearchQuery = '';
    let filteredSecrets = [];
    let secretLoadGeneration = 0;
    let secretRenderGeneration = 0;
    let secretSessionGeneration = 0;
    let secretReadsBlocked = false;
    // Session whose account list this page got from the server, from a login,
    // or from the local copy that logout and an expired login delete. A new
    // page starts unconfirmed, so a logged-out page cannot show queued keys.
    let secretAccessVerifiedSession = null;
    accountStore.subscribe(() => {
      const state = accountStore.getState();
      secrets = accountStore.getRecords();
      secretSessionGeneration = state.sessionGeneration;
      secretLoadGeneration = state.readGeneration;
      secretReadsBlocked = state.blocked;
      secretAccessVerifiedSession = state.accessVerified ? state.sessionGeneration : null;
    }, { phase: 'internal' });
    function isSecretSessionCurrent(generation) {
      return accountStore.isSessionCurrent(generation);
    }
    function markSecretAccessVerified(generation = secretSessionGeneration) {
      accountStore.markAccessVerified(generation);
    }
    function isSecretAccessVerified() {
      return isSecretSessionCurrent(secretAccessVerifiedSession);
    }
    function invalidateSecretSession({ blocked = true } = {}) {
      const invalidatedGeneration = accountStore.invalidateSession({ blocked });
      secretRenderGeneration += 1;
      if (typeof getAccountViewState === 'function') {
        getAccountViewState().setQuery('');
        getAccountViewState().setServiceFilter(null);
      }
      // The hidden-accounts notice belongs to the session that read them.
      if (typeof renderHiddenSecretsNotice === 'function') renderHiddenSecretsNotice();
      return invalidatedGeneration;
    }
    function replaceSecretRecords(records, options = {}) {
      return accountStore.replaceRecords(records, options);
    }
    function invalidateSecretReads() {
      secretLoadGeneration = accountStore.invalidateReads();
      return secretLoadGeneration;
    }
    function beginSecretRead() {
      const generation = accountStore.beginRead();
      secretLoadGeneration = accountStore.getReadGeneration();
      return generation;
    }
    function beginSecretWrite(type, accountId, sessionGeneration = secretSessionGeneration) {
      return accountStore.beginWrite({ type, accountId, sessionGeneration });
    }
    let saveQueue = Promise.resolve(); // 保存操作队列，确保串行执行避免并发覆盖
    function queueSecretWrite(type, accountId, sessionGeneration, operation) {
      const handle = beginSecretWrite(type, accountId, sessionGeneration);
      if (!handle) return Promise.resolve({ status: 'session-invalidated' });
      return saveQueue.then(() => {
        if (!isSecretSessionCurrent(sessionGeneration)) return { status: 'session-invalidated' };
        accountStore.updateOperation(handle.operationId, { status: 'running' });
        return operation();
      }).finally(() => accountStore.endWrite(handle));
    }
    // authToken 已移除 - 现在使用 HttpOnly Cookie

`;
}
