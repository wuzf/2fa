/**
 * 导出模块入口
 * 组合所有导出子模块，提供完整的导出功能
 */

import { getExportUICode } from './ui.js';
import { getExportConfigCode } from './config.js';
import { getStandardFormatsCode } from './formats.js';

/**
 * 获取所有导出相关代码（向后兼容）
 * 注意：由于原始 export.js 包含大量第三方格式导出代码（约1700行），
 * 完整拆分需要创建更多子模块。当前仅拆分了核心部分作为示例。
 * @returns {string} 完整的导出 JavaScript 代码
 */
export function getExportCode() {
	// 组合所有子模块的代码
	return ['// ========== 导出功能模块 ==========', getExportConfigCode(), getExportUICode(), getStandardFormatsCode()].join('\n');
}

// 导出子模块函数，支持按需加载
export { getExportUICode, getExportConfigCode, getStandardFormatsCode };
