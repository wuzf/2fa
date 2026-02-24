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
    let otpIntervals = {};
    let currentOTPAuthURL = '';
    let debugMode = false;
    let currentSearchQuery = '';
    let filteredSecrets = [];
    let saveQueue = Promise.resolve(); // 保存操作队列，确保串行执行避免并发覆盖
    // authToken 已移除 - 现在使用 HttpOnly Cookie

`;
}
