/**
 * 防回归：模板字符串生成的前端脚本必须语法合法。
 *
 * 历史问题：src/ui/scripts/googleMigration.js 某处 `.join('\n')` 写在普通模板字面量里，
 * `\n` 被提前解释成真换行，最终产物是非法 JS（字符串字面量里夹真换行）。
 * 该 bug 只在运行时载入脚本时才会暴露，import-code.test.js 只解析 getImportCode()，
 * 覆盖不到 Google Migration 和整包脚本。
 *
 * 这组测试对每个生成脚本的 module getter 和 index.js 的组合入口做 new Function() parse。
 */

import { describe, expect, it } from 'vitest';

import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getBackupCode } from '../../src/ui/scripts/backup.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getCoreScripts, getModuleCode, getScripts } from '../../src/ui/scripts/index.js';
import { getModuleLoaderCode } from '../../src/ui/scripts/moduleLoader.js';
import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getToolsCode } from '../../src/ui/scripts/tools.js';
import { getUICode } from '../../src/ui/scripts/ui.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

function assertParses(label, code) {
	expect(typeof code).toBe('string');
	expect(code.length).toBeGreaterThan(0);
	try {
		// eslint-disable-next-line no-new-func
		new Function(code);
	} catch (error) {
		throw new Error(`${label} emits invalid JS: ${error.message}`);
	}
}

describe('emitted script modules parse as valid JavaScript', () => {
	it.each([
		['state', getStateCode],
		['auth', getAuthCode],
		['otp', getOTPCode],
		['ui', getUICode],
		['search', getSearchCode],
		['export', getExportCode],
		['qrcode', getQRCodeCode],
		['import', getImportCode],
		['backup', getBackupCode],
		['tools', getToolsCode],
		['settings', getSettingsCode],
		['googleMigration', getGoogleMigrationCode],
		['core', getCoreCode],
		['utils', getUtilsCode],
		['pwa', getPWACode],
		['moduleLoader', getModuleLoaderCode],
	])('%s', (name, getter) => {
		assertParses(name, getter());
	});
});

describe('emitted script aggregators parse as valid JavaScript', () => {
	it('getScripts (full inline bundle)', () => {
		assertParses('getScripts', getScripts());
	});

	it('getCoreScripts (core-only bundle for lazy-loaded mode)', () => {
		assertParses('getCoreScripts', getCoreScripts());
	});

	it.each(['import', 'export', 'backup', 'qrcode', 'tools', 'googleMigration'])('lazy-loaded module %s via getModuleCode', (name) => {
		assertParses(`getModuleCode(${name})`, getModuleCode(name));
	});
});

describe('googleMigration specific regression guards', () => {
	it('does not emit a raw LF inside a single-quoted JS string literal', () => {
		// 典型症状：}).join('
		// ');  ← 模板字面量里的 \n 被提前展开成真换行
		const code = getGoogleMigrationCode();
		expect(/'\n'/.test(code)).toBe(false);
		// 期望是字面的 backslash+n（两个字符），JS 运行时才解析为换行
		expect(code).toContain("join('\\n')");
	});
});
