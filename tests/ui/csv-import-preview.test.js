import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

describe('CSV import through the preview entry point', () => {
	it.each([
		[
			'Bitwarden',
			'folder,favorite,type,name,login_uri,login_totp\n,,1,GitHub,,otpauth://totp/GitHub:audit?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
		],
		['2FA', '服务名称,账户信息,密钥\nGitHub,audit,JBSWY3DPEHPK3PXP'],
	])('detects %s CSV and enables importing its valid accounts', (_format, text) => {
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
				if (!elements.has(id)) {elements.set(id, createElement());}
				return elements.get(id);
			},
		};
		const context = createContext({
			document,
			window: {},
			URL,
			URLSearchParams,
			console,
			showCenterToast: vi.fn(),
		});
		runInContext(getUtilsCode() + getImportCode(), context);
		document.getElementById('importText').value = text;
		context.previewImport();
		expect(runInContext('importPreviewData', context)).toEqual([
			expect.objectContaining({ serviceName: 'GitHub', account: 'audit', secret: 'JBSWY3DPEHPK3PXP', valid: true }),
		]);
		expect(document.getElementById('executeImportBtn').disabled).toBe(false);
		expect(context.showCenterToast).not.toHaveBeenCalled();
	});
});
