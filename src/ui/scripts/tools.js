/**
 * Tools Module - Index
 * 工具模块集成索引
 *
 * 将所有独立工具模块集成到一起
 */

import { getQRDecodeToolCode } from './tools/qrDecode.js';
import { getQRGenerateToolCode } from './tools/qrGenerate.js';
import { getBase32ToolCode } from './tools/base32Tool.js';
import { getTimestampToolCode } from './tools/timestampTool.js';
import { getKeyCheckerToolCode } from './tools/keyChecker.js';
import { getKeyGeneratorToolCode } from './tools/keyGenerator.js';
import { getWebdavToolCode } from './tools/webdavTool.js';
import { getS3ToolCode } from './tools/s3Tool.js';
import { getOneDriveToolCode } from './tools/onedriveTool.js';
import { getGoogleDriveToolCode } from './tools/gdriveTool.js';

/**
 * Get complete Tools code by integrating all tool modules
 * @returns {string} Complete Tools JavaScript code
 */
export function getToolsCode() {
	return `    // ========== 实用工具模块集合 ==========
    // 包含6个独立工具：二维码解析、二维码生成、Base32编解码、时间戳、密钥检查器、密钥生成器

    // 入口函数
    function showQRScanAndDecode() {
      // 预加载 jsQR（解析二维码图片需要）
      if (typeof ensureJsQR === 'function') ensureJsQR().catch(() => {});
      hideToolsModal();
      showQRDecodeModal();
    }

    function showQRGenerateTool() {
      // 预加载 qrcode-generator（生成二维码需要）
      if (typeof ensureQRCodeGen === 'function') ensureQRCodeGen().catch(() => {});
      hideToolsModal();
      showQRGenerateModal();
    }

    function showBase32Tool() {
      hideToolsModal();
      showBase32Modal();
    }

    function showTimestampTool() {
      hideToolsModal();
      showTimestampModal();
    }

    function showKeyCheckTool() {
      hideToolsModal();
      showKeyCheckModal();
    }

    function showKeyGeneratorTool() {
      hideToolsModal();
      showKeyGeneratorModal();
    }

    function showWebdavTool() {
      hideToolsModal();
      showWebdavModal();
    }

    function showS3Tool() {
      hideToolsModal();
      showS3Modal();
    }

    function showOneDriveTool() {
      hideToolsModal();
      showOneDriveModal();
    }

    function showGoogleDriveTool() {
      hideToolsModal();
      showGoogleDriveModal();
    }

    // Re-render translated output without resetting input or dismissing an open form.
    function refreshToolsTranslations() {
      if (timestampActive) updateTimestamp(true);
      if (_lastCheckedSecret !== null) displayCheckResult(validateSecretFormat(_lastCheckedSecret));
      _refreshDecodeCameraTranslations();
      _refreshWebdavTranslations();
      _refreshS3Translations();
      _refreshOneDriveTranslations();
      _refreshGoogleDriveTranslations();
      // Refresh persisted server errors in the new language while keeping form edits.
      const destinations = [
        ['webdavModal', loadWebdavDestinations], ['s3Modal', loadS3Destinations],
        ['oneDriveModal', loadOneDriveDestinations], ['googleDriveModal', loadGoogleDriveDestinations]
      ];
      destinations.forEach(([id, reload]) => {
        const modal = document.getElementById(id);
        if (modal && modal.classList.contains('show')) reload(true);
      });
    }

${getQRDecodeToolCode()}

${getQRGenerateToolCode()}

${getBase32ToolCode()}

${getTimestampToolCode()}

${getKeyCheckerToolCode()}

${getKeyGeneratorToolCode()}

${getWebdavToolCode()}

${getS3ToolCode()}

${getOneDriveToolCode()}

${getGoogleDriveToolCode()}
`;
}
