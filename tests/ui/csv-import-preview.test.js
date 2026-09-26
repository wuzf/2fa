import { transferI18n } from '../helpers/transfer-i18n.js';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { encodeBackupContent } from '../../src/utils/backup-format.js';

describe('CSV import through the preview entry point', () => {
	it.each(SUPPORTED_LANGUAGES)('previews a %s backup export without losing names, OTP settings or counters', async (language) => {
		const secrets = [
			{
				name: '서비스 "quoted", 原文 & name',
				account: 'a:b+tag@example.com',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 8,
				period: 60,
				algorithm: 'SHA256',
			},
			{
				name: 'Autre service',
				account: '别名&account',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'HOTP',
				digits: 6,
				counter: 4294967297,
				algorithm: 'SHA512',
			},
		];
		const { content } = await encodeBackupContent(secrets, { format: 'csv', language });
		const elements = new Map();
		const createElement = () => ({
			style: {},
			value: '',
			innerHTML: '',
			appendChild() {},
			set textContent(value) {
				this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
			},
		});
		const document = {
			createElement,
			getElementById(id) {
				if (!elements.has(id)) {
					elements.set(id, createElement());
				}
				return elements.get(id);
			},
		};
		const context = createContext({
			...transferI18n('en'),
			document,
			window: {},
			URL,
			URLSearchParams,
			console: { log() {}, warn() {}, error() {} },
			showCenterToast: vi.fn(),
		});
		runInContext(getUtilsCode() + getImportCode(), context);
		document.getElementById('importText').value = content;
		context.previewImport();
		const records = runInContext('importPreviewData', context);
		expect(records).toHaveLength(2);
		for (let index = 0; index < secrets.length; index++) {
			const { name, ...expected } = secrets[index];
			expect(records[index]).toMatchObject({ ...expected, type: expected.type.toLowerCase(), serviceName: name, valid: true });
		}
		expect(document.getElementById('executeImportBtn').disabled).toBe(false);
		expect(context.showCenterToast).not.toHaveBeenCalled();
	});
	it.each([
		[
			'Bitwarden',
			'folder,favorite,type,name,login_uri,login_totp\n,,1,GitHub,,otpauth://totp/GitHub:audit?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
			30,
		],
		['2FA', '服务名称,账户信息,密钥\nGitHub,audit,JBSWY3DPEHPK3PXP', 30],
		...['Period (s)', '周期（秒）', 'Period [seconds]', '验证码周期/秒'].flatMap((header) =>
			[60, 120].map((period) => [
				`${header} (${period} seconds)`,
				`Service,Account,Secret,${header}\nGitHub,audit,JBSWY3DPEHPK3PXP,${period}`,
				period,
			]),
		),
		[
			'exact period header before a legacy unit-header match',
			'Service,Account,Secret,Period (s),Period\nGitHub,audit,JBSWY3DPEHPK3PXP,120,60',
			60,
		],
	])('detects %s CSV and preserves the OTP period in its valid accounts', (_format, text, period) => {
		const elements = new Map();
		const createElement = () => ({
			style: {},
			className: '',
			value: '',
			innerHTML: '',
			appendChild() {},
			set textContent(value) {
				this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			},
		});
		const document = {
			createElement,
			getElementById(id) {
				if (!elements.has(id)) {
					elements.set(id, createElement());
				}
				return elements.get(id);
			},
		};
		const context = createContext({ ...transferI18n(), document, window: {}, URL, URLSearchParams, console, showCenterToast: vi.fn() });
		runInContext(getUtilsCode() + getImportCode(), context);
		document.getElementById('importText').value = text;
		context.previewImport();
		expect(runInContext('importPreviewData', context)).toEqual([
			expect.objectContaining({ serviceName: 'GitHub', account: 'audit', secret: 'JBSWY3DPEHPK3PXP', period, valid: true }),
		]);
		expect(document.getElementById('executeImportBtn').disabled).toBe(false);
		expect(context.showCenterToast).not.toHaveBeenCalled();
	});
});
