/**
 * 全局状态模块
 * 全局变量定义
 */

/**
 * 获取 State 相关代码
 * @returns {string} State JavaScript 代码
 */
export function getStateCode() {
	return `    let secrets = [];
    let scanStream = null;
    let scannerCanvas = null;
    let scannerContext = null;
    let isScanning = false;
    let scanInterval = null;
    let editingId = null;
    let secretDialogGeneration = 0;
    let secretDialogOpen = false;
    let secretDialogSubmission = null;
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
    function isSecretSessionCurrent(generation) {
      return !secretReadsBlocked && generation === secretSessionGeneration;
    }
    function markSecretAccessVerified(generation = secretSessionGeneration) {
      if (isSecretSessionCurrent(generation)) secretAccessVerifiedSession = generation;
    }
    function isSecretAccessVerified() {
      return isSecretSessionCurrent(secretAccessVerifiedSession);
    }
    function invalidateSecretSession({ blocked = true } = {}) {
      secretSessionGeneration += 1;
      secretLoadGeneration += 1;
      secretRenderGeneration += 1;
      secretReadsBlocked = blocked;
      return secretSessionGeneration;
    }
    let saveQueue = Promise.resolve(); // 保存操作队列，确保串行执行避免并发覆盖
    // authToken 已移除 - 现在使用 HttpOnly Cookie

`;
}
