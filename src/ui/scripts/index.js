/**
 * JavaScript脚本模块集成
 * 支持核心模块和懒加载模块分离
 */

import { getStateCode } from './state.js';
import { getAuthCode } from './auth.js';
import { getOTPCode } from './otp.js';
import { getUICode } from './ui.js';
import { getSearchCode } from './search.js';
import { getExportCode } from './export.js';
import { getQRCodeCode } from './qrcode.js';
import { getImportCode } from './import/index.js';
import { getBackupCode } from './backup.js';
import { getToolsCode } from './tools.js';
import { getGoogleMigrationCode } from './googleMigration.js';
import { getCoreCode } from './core.js';
import { getUtilsCode } from './utils.js';
import { getPWACode } from './pwa.js';
import { getModuleLoaderCode } from './moduleLoader.js';

/**
 * 获取核心JavaScript代码（首次加载必需）
 * 包含：状态管理、认证、OTP、UI、搜索、核心逻辑、PWA、模块加载器
 * @returns {string} 核心JavaScript代码
 */
export function getCoreScripts() {
	return `${getUtilsCode()}${getStateCode()}${getAuthCode()}${getOTPCode()}${getUICode()}${getSearchCode()}${getCoreCode()}${getPWACode()}${getModuleLoaderCode()}`;
}

/**
 * 获取完整的JavaScript代码（传统模式，不分割）
 * Utils必须在最前面，因为其他模块需要使用它的通用函数
 * @returns {string} 完整的JavaScript代码
 */
export function getScripts() {
	// QRCode must come before GoogleMigration, GoogleMigration must come before Export
	// because Export calls showExportToGoogleModal from GoogleMigration
	return `${getUtilsCode()}${getStateCode()}${getAuthCode()}${getOTPCode()}${getUICode()}${getSearchCode()}${getQRCodeCode()}${getGoogleMigrationCode()}${getExportCode()}${getImportCode()}${getBackupCode()}${getToolsCode()}${getCoreCode()}${getPWACode()}`;
}

/**
 * 获取单个模块的代码（用于懒加载）
 * @param {string} moduleName - 模块名称
 * @returns {string} 模块JavaScript代码
 */
export function getModuleCode(moduleName) {
	const modules = {
		import: getImportCode,
		export: getExportCode,
		backup: getBackupCode,
		qrcode: getQRCodeCode,
		tools: getToolsCode,
		googleMigration: getGoogleMigrationCode,
	};

	const moduleGetter = modules[moduleName];
	if (!moduleGetter) {
		throw new Error(`未知的模块: ${moduleName}`);
	}

	return moduleGetter();
}
