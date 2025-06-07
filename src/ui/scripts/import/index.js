/**
 * 导入模块入口
 * 组合所有导入子模块，提供完整的导入功能
 */

import { getImportUtilsCode } from './utils.js';
import { getImportUICode } from './ui.js';
import { getCSVParserCode, getJSONParserCode } from './parsers.js';
import { getHTMLParserCode } from './htmlParser.js';
import { getTOTPAuthDecryptCode, getFreeOTPDecryptCode } from './crypto.js';
import { getPreviewImportCode, getExecuteImportCode } from './core.js';

/**
 * 获取所有导入相关代码（向后兼容）
 * @returns {string} 完整的导入 JavaScript 代码
 */
export function getImportCode() {
	// 组合所有子模块的代码
	// 注意顺序：工具函数 -> 解析器 -> 加密解密 -> UI -> 核心逻辑
	return [
		'// ========== 导入功能模块 ==========',
		getImportUtilsCode(),
		getCSVParserCode(),
		getJSONParserCode(),
		getHTMLParserCode(),
		getTOTPAuthDecryptCode(),
		getFreeOTPDecryptCode(),
		getImportUICode(),
		getPreviewImportCode(),
		getExecuteImportCode(),
	].join('\n');
}

// 导出子模块函数，支持按需加载
export {
	getImportUtilsCode,
	getImportUICode,
	getCSVParserCode,
	getJSONParserCode,
	getHTMLParserCode,
	getTOTPAuthDecryptCode,
	getFreeOTPDecryptCode,
	getPreviewImportCode,
	getExecuteImportCode,
};
