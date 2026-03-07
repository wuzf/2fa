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

/**
 * Get complete Tools code by integrating all tool modules
 * @returns {string} Complete Tools JavaScript code
 */
export function getToolsCode() {
	return `    // ========== 实用工具模块集合 ==========
    // 包含6个独立工具：二维码解析、二维码生成、Base32编解码、时间戳、密钥检查器、密钥生成器

    // 入口函数
    function showQRScanAndDecode() {
      hideToolsModal();
      showQRDecodeModal();
    }

    function showQRGenerateTool() {
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

${getQRDecodeToolCode()}

${getQRGenerateToolCode()}

${getBase32ToolCode()}

${getTimestampToolCode()}

${getKeyCheckerToolCode()}

${getKeyGeneratorToolCode()}

${getWebdavToolCode()}

${getS3ToolCode()}
`;
}
