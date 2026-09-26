import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { getExportCode as getSplitExportCode } from '../../src/ui/scripts/export/index.js';

async function harness(module, language = 'zh-CN') {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	window.document.write(await (await createMainPage()).text());
	const document = window.document;
	const api = createContext({
		window,
		document,
		localStorage: window.localStorage,
		navigator: { language },
		URL,
		URLSearchParams,
		TextEncoder,
		TextDecoder,
		Uint8Array,
		atob,
		btoa,
		DOMParser: window.DOMParser,
		setTimeout: (fn) => {
			fn();
			return 1;
		},
		clearTimeout() {},
		console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
		secrets: [
			{
				id: 'one',
				name: 'Example',
				account: 'user@example.test',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 6,
				period: 30,
				algorithm: 'SHA1',
			},
		],
		getCachedDefaultExportFormat: () => 'json',
		loadSecrets: vi.fn(async () => {}),
	});
	runInContext(getI18nCode() + getSharedTransferMessageLocalizerCode() + getUtilsCode(), api);
	api.showCenterToast = vi.fn();
	runInContext(typeof module === 'function' ? module() : getModuleCode(module), api);
	api.setLanguage(language);
	return { api, document, window };
}

describe('independent review of transfer modules', () => {
	it('keeps the compatible split export module localized without reopening its dialog', async () => {
		const { api, document } = await harness(getSplitExportCode);
		api.showModal = vi.fn((id) => document.getElementById(id).classList.add('show'));
		api.showSubFormatModal('aegis-multi');
		api.setLanguage('en');
		expect(document.getElementById('subFormatTitle').textContent).toBe('Choose an Aegis export format');
		expect(document.getElementById('subFormatList').textContent).not.toMatch(/[\u3400-\u9fff]/);
		expect(api.showModal).toHaveBeenCalledOnce();
		expect(document.querySelectorAll('#subFormatList button')).toHaveLength(2);
	});
	it.each(['import', 'export', 'backup', 'googleMigration', 'qrcode'])(
		'loads %s independently and preserves main form controls across language changes',
		async (module) => {
			const { api, document } = await harness(module);
			const control = document.getElementById('importText');
			control.value = 'keep this file content';
			const fileInput = document.getElementById('importFileInput');
			const files = [{ name: 'private-backup.json', size: 42 }];
			Object.defineProperty(fileInput, 'files', { value: files });
			for (const language of ['en', 'zh-TW', 'zh-CN']) {
				api.setLanguage(language);
				expect(document.getElementById('importText')).toBe(control);
				expect(control.value).toBe('keep this file content');
				expect(document.getElementById('importFileInput').files).toBe(files);
			}
		},
	);

	it('relabels a failed backup list request when the language changes', async () => {
		const { api, document } = await harness('backup');
		api.authenticatedFetch = vi.fn(async () => ({ ok: false }));
		await api.loadBackupList();
		expect(document.getElementById('backupSelect').textContent).toMatch(/[\u3400-\u9fff]/);
		api.setLanguage('en');
		expect(document.getElementById('backupSelect').textContent).not.toMatch(/[\u3400-\u9fff]/);
		expect(document.getElementById('backupSelect').disabled).toBe(true);
		expect(api.authenticatedFetch).toHaveBeenCalledOnce();
	});

	it.each([
		'备份文件格式不正确或已损坏',
		'数据解密失败',
		'解析失败：备份 JSON 数据格式不正确',
		'备份包含无效密钥，已阻止生成：第 1 条缺少有效密钥；第 2 条缺少有效密钥',
	])('relabels failed backup previews and retains blocked restore actions: %s', async (message) => {
		const { api, document } = await harness('backup');
		api.authenticatedFetch = vi.fn(async () => ({ ok: false, json: async () => ({ message }) }));
		runInContext('selectedBackup = { key: "backup_2026-09-24.json" }; backupPreviewRequestToken = 1;', api);
		await api.showBackupPreview({ key: 'backup_2026-09-24.json' }, 1);
		api.setLanguage('en');
		expect(document.getElementById('backupPreviewContent').textContent).not.toMatch(/[\u3400-\u9fff]/);
		expect(document.getElementById('confirmRestoreBtn').title).not.toMatch(/[\u3400-\u9fff]/);
		expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);
		expect(api.authenticatedFetch).toHaveBeenCalledOnce();
	});

	it('relabels partial-backup warning details without replacing uploaded data', async () => {
		const { api, document } = await harness('backup');
		const warning = '该备份在创建或解析时已跳过 2 条无效密钥，无法保证数据完整，已阻止恢复或导出';
		api.authenticatedFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ data: { count: 0, secrets: [], partial: true, skippedInvalidCount: 2, warnings: [warning] } }),
		}));
		runInContext(
			'selectedBackup = { key: "backup_2026-09-24.json", uploaded: true, content: "private-content" }; backupPreviewRequestToken = 1;',
			api,
		);
		await api.showBackupPreview(runInContext('selectedBackup', api), 1);
		api.setLanguage('en');
		expect(document.getElementById('backupPreviewContent').textContent).not.toMatch(/[\u3400-\u9fff]/);
		expect(runInContext('selectedBackup.content', api)).toBe('private-content');
		expect(document.getElementById('confirmRestoreBtn').disabled).toBe(true);
		expect(document.getElementById('exportBackupBtn').disabled).toBe(true);
	});

	it.each(['密钥不能为空', '字段 "digits" 类型错误，期望 number', '服务名称不能为空; 密钥不能为空'])(
		'relabels imported-key failure details after a completed migration request: %s',
		async (error) => {
			const { api, document } = await harness('googleMigration');
			api.showGoogleMigrationPreview([{ issuer: 'Example', name: 'a@example.test', type: 'TOTP', secret: 'JBSWY3DPEHPK3PXP' }]);
			api.importGoogleMigrationSecretsInChunks = async () => ({
				successCount: 0,
				failCount: 1,
				results: [{ index: 0, success: false, error }],
			});
			await api.confirmGoogleMigration();
			expect(document.getElementById('importResultModal').textContent).toContain(error);
			api.setLanguage('en');
			expect(document.getElementById('importResultModal').textContent).not.toMatch(/[\u3400-\u9fff]/);
			expect(document.getElementById('importResultModal').textContent).toContain('Example');
		},
	);

	it.each([
		{ name: 'not-a-backup.txt', size: 10 },
		{ name: 'backup_2026-09-24.json', size: 100_000_000 },
	])('relabels invalid uploaded backup feedback and disabled-action titles: %j', async (file) => {
		const { api, document } = await harness('backup');
		await api.handleRestoreBackupFile({ target: { files: [file] } });
		api.setLanguage('en');
		for (const id of ['backupPreviewContent', 'restoreUploadStatus']) {
			expect(document.getElementById(id).textContent, id).not.toMatch(/[\u3400-\u9fff]/);
		}
		for (const id of ['confirmRestoreBtn', 'exportBackupBtn']) {
			expect(document.getElementById(id).title, id).not.toMatch(/[\u3400-\u9fff]/);
			expect(document.getElementById(id).disabled).toBe(true);
		}
	});

	it('relabels the QR error description together with its heading', async () => {
		const { api, document } = await harness('qrcode');
		api.generateQRCodeDataURL = async () => {
			throw new Error(api.t('transferQRLibraryRetry'));
		};
		await api.generateQRCodeForModal('otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP');
		api.setLanguage('en');
		expect(document.querySelector('.qr-code-container').textContent).not.toMatch(/[\u3400-\u9fff]/);
	});

	it('translates an English API error back to Traditional Chinese while keeping the service name unchanged', async () => {
		const { api, document } = await harness('googleMigration', 'en');
		api.showGoogleMigrationPreview([{ issuer: '密钥不能为空', name: 'a@example.test', type: 'TOTP', secret: 'JBSWY3DPEHPK3PXP' }]);
		api.importGoogleMigrationSecretsInChunks = async () => ({
			successCount: 0,
			failCount: 1,
			results: [{ index: 0, success: false, error: 'Secret is required' }],
		});
		await api.confirmGoogleMigration();
		api.setLanguage('zh-TW');
		const content = document.getElementById('importResultModal').textContent;
		expect(content).toContain('密钥不能为空: 金鑰不能為空');
		expect(content).not.toContain('Secret is required');
	});

	it('does not mix languages when the language changes during QR generation for an HTML export', async () => {
		const { api, window } = await harness('export');
		api.validateBase32 = () => true;
		api.waitForQRCodeLibrary = async () => {};
		api.generateQRCodeDataURL = async () => {
			api.setLanguage('en');
			return 'data:image/png;base64,fixture';
		};
		api.downloadFile = vi.fn(async () => true);
		await api.exportAsHTML(api.secrets);
		expect(api.downloadFile).toHaveBeenCalledOnce();
		const html = api.downloadFile.mock.calls[0][0];
		const doc = new window.DOMParser().parseFromString(html, 'text/html');
		expect(doc.documentElement.lang).toBe('en');
		expect(doc.querySelector('main').textContent).not.toMatch(/[\u3400-\u9fff]/);
	});

	it('localizes migration QR image alternatives and renders QR failure details as text', async () => {
		const { api, document } = await harness('googleMigration', 'zh-TW');
		api.generateQRCodeDataURL = async () => 'data:image/png;base64,fixture';
		await api.showExportQRCodeModal([api.secrets], 0, 12);
		expect(document.querySelector('#exportQRCodeModal img').alt).not.toBe('Migration QR Code');
		const unsafe = '<img id="injected-by-error" src=x onerror="alert(1)">';
		api.generateQRCodeDataURL = async () => {
			throw new Error(unsafe);
		};
		await api.showExportQRCodeModal([api.secrets], 0, 12);
		expect(document.getElementById('injected-by-error')).toBeNull();
		expect(document.querySelector('#exportQRCodeModal .qr-code-container').textContent).toContain(unsafe);
	});
});
