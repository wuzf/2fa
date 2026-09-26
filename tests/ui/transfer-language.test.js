// @vitest-environment happy-dom

import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getStandardFormatsCode } from '../../src/ui/scripts/export/formats.js';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { validateBase32 } from '../../src/utils/validation.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';

const secret = {
	id: 'test-key',
	name: 'Service & <test>',
	account: 'a,b&100%@example.test',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'HOTP',
	digits: 8,
	algorithm: 'SHA256',
	counter: 42,
	period: 60,
};

function createHarness(language, exportGetter = getExportCode) {
	localStorage.setItem('language', language);
	document.body.innerHTML = `
		<div id="importModal"><textarea id="importText"></textarea><div id="importPreview"><div id="importPreviewList"></div></div>
		<button id="executeImportBtn"></button><div id="importStats"></div><div id="statValid"></div><div id="statInvalid"></div><div id="statTotal"></div>
		<div id="importProgress">${['Title', 'Percent', 'Status', 'Detail', 'Chunk', 'Success', 'Fail', 'Fill'].map((id) => `<div id="importProgress${id}"></div>`).join('')}</div></div>
		<div id="subFormatModal"><h2 id="subFormatTitle"></h2><div id="subFormatList"></div></div>
		<div id="qrModal"><h2 id="qrTitle"></h2><p id="qrSubtitle"></p><div class="qr-code-container"></div></div>
		<div id="scannerStatus"></div><div id="scannerError"><span id="errorMessage"></span></div>`;
	const api = createContext({
		document,
		window,
		localStorage,
		navigator: { language },
		URL,
		URLSearchParams,
		DOMParser: window.DOMParser,
		TextEncoder,
		Uint8Array,
		atob,
		setTimeout: (callback) => {
			callback();
			return 1;
		},
		clearTimeout: () => {},
		console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		secrets: [secret, { ...secret, id: 'second', name: 'Second' }],
		showCenterToast: vi.fn(),
		showExportSuccess: vi.fn(),
		getCachedDefaultExportFormat: () => 'html',
	});
	runInContext(
		getI18nCode() +
			getSharedTransferMessageLocalizerCode() +
			getUtilsCode() +
			getImportCode() +
			exportGetter() +
			getGoogleMigrationCode() +
			getQRCodeCode(),
		api,
	);
	api.downloadFile = vi.fn(async () => true);
	api.waitForQRCodeLibrary = async () => {};
	api.generateQRCodeDataURL = vi.fn(async () => 'data:image/png;base64,fixture');
	api.validateBase32 = (value) => validateBase32(value).valid;
	api.disableBodyScroll = vi.fn();
	api.enableBodyScroll = vi.fn();
	return api;
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

function expectPreservedURI(uri) {
	const url = new URL(uri);
	expect(url.hostname).toBe('hotp');
	expect(url.searchParams.get('issuer')).toBe(secret.name);
	expect(decodeURIComponent(url.pathname)).toContain(secret.account);
	expect(url.searchParams.get('secret')).toBe(secret.secret);
	expect(url.searchParams.get('counter')).toBe('42');
	expect(url.searchParams.get('digits')).toBe('8');
	expect(url.searchParams.get('algorithm')).toBe('SHA256');
	expect(url.searchParams.has('period')).toBe(false);
}

describe.each(SUPPORTED_LANGUAGES)('transfer workflows in %s', (language) => {
	it('exports translated CSV headers and imports them under every other UI language without losing OTP parameters', async () => {
		const api = createHarness(language);
		await api.exportAsCSV([secret]);
		const csv = api.downloadFile.mock.calls[0][0];
		expect(csv.split('\n')[0]).toContain(LOCALES[language].transferService);
		expect(csv.split('\n')[0]).toContain(LOCALES[language].transferCounter);
		for (const targetLanguage of SUPPORTED_LANGUAGES) {
			api.setLanguage(targetLanguage);
			expectPreservedURI(api.parseCSVImport(csv)[0]);
			document.getElementById('importText').value = csv;
			api.previewImport();
			expect(runInContext('importPreviewData', api)[0]).toMatchObject({
				valid: true,
				type: 'hotp',
				counter: 42,
				algorithm: 'SHA256',
				digits: 8,
			});
		}
	});

	it.each([
		['current', getExportCode],
		['legacy', getStandardFormatsCode],
	])('creates a standalone localized %s HTML backup that remains importable', async (_name, getter) => {
		const api = createHarness(language, getter);
		await api.exportAsHTML([secret]);
		expect(api.downloadFile).toHaveBeenCalledOnce();
		const html = api.downloadFile.mock.calls[0][0];
		const doc = new window.DOMParser().parseFromString(html, 'text/html');
		expect(doc.documentElement.lang).toBe(language);
		expect(doc.title).toBe(LOCALES[language].transferBackupTitle);
		expect(doc.querySelector('h1').textContent).toBe(doc.title);
		expect(doc.querySelectorAll('th')).toHaveLength(9);
		expect(doc.querySelector('[role="region"]').getAttribute('aria-label')).toBe(LOCALES[language].transferBackupTable);
		expect(doc.querySelectorAll('td')[0].textContent).toBe(secret.name);
		api.setLanguage(language === 'en' ? 'zh-CN' : 'en');
		expectPreservedURI(api.parseHTMLImport(html)[0]);
		const tableOnly = html.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');
		expectPreservedURI(api.parseHTMLImport(tableOnly)[0]);
	});

	it('renders migration previews, QR labels and import validation in the selected language', () => {
		const api = createHarness(language);
		api.showGoogleMigrationPreview([{ issuer: secret.name, name: secret.account, type: 'HOTP' }]);
		expect(document.querySelector('#migrationPreviewModal h2').textContent).toBe(LOCALES[language].transferGoogleImport);
		expect(document.getElementById('migrationPreviewModal').textContent).toContain(api.t('transferMigrationConfirm', { count: 1 }));
		api.showQRCode(secret.id);
		expect(document.getElementById('qrTitle').textContent).toBe(api.t('transferQRTitle', { name: secret.name }));
		expect(document.getElementById('qrSubtitle').textContent).toBe(api.t('transferQRAccount', { account: secret.account }));
		api.previewImport();
		expect(api.showCenterToast).toHaveBeenCalledWith('❌', api.t('transferImportRequired'));
	});
});

describe('language changes with open transfer dialogs', () => {
	it('keeps an entered decryption password and relabels scanner errors without restarting the camera', () => {
		const api = createHarness('zh-CN');
		document.getElementById('importText').value = btoa('x'.repeat(96));
		api.previewImport();
		const input = document.getElementById('totpAuthPassword');
		input.value = 'existing typed password';
		api.showScannerError(() => api.t('transferCameraDenied'));
		api.setLanguage('en');
		expect(document.getElementById('totpAuthPassword')).toBe(input);
		expect(input.value).toBe('existing typed password');
		expect(input.placeholder).toBe('Enter backup password');
		expect(input.getAttribute('aria-label')).toBe('Backup password');
		expect(document.querySelector('.dialog-encrypted-import strong').textContent).toBe('Encrypted TOTP Authenticator backup');
		expect(document.getElementById('executeImportBtn').textContent).toBe('Decrypt first');
		expect(document.getElementById('executeImportBtn').disabled).toBe(true);
		expect(document.getElementById('errorMessage').textContent).toBe('Camera access denied. Allow access in browser settings.');
	});

	it('keeps checked keys, scroll position and pending migration data while translating the open dialog', () => {
		const api = createHarness('zh-CN');
		api.showExportToGoogleModal();
		document.getElementById('export-0').checked = false;
		document.querySelector('.export-secret-list').scrollTop = 120;
		api.setLanguage('en');
		expect(document.querySelectorAll('#exportToGoogleModal')).toHaveLength(1);
		expect(document.getElementById('export-0').checked).toBe(false);
		expect(document.getElementById('export-1').checked).toBe(true);
		expect(document.querySelector('.export-secret-list').scrollTop).toBe(120);
		expect(document.querySelector('#exportToGoogleModal h2').textContent).toBe('Export to Google Authenticator');
		expect(api.disableBodyScroll).toHaveBeenCalledOnce();
		const pending = [
			{ issuer: 'First', name: 'a' },
			{ issuer: 'Second', name: 'b' },
		];
		api.showGoogleMigrationPreview(pending);
		document.getElementById('migrate-1').checked = false;
		api.setLanguage('zh-TW');
		expect(document.getElementById('migrate-1').checked).toBe(false);
		expect(window.pendingMigrationSecrets).toBe(pending);
		expect(document.querySelector('#migrationPreviewModal h2').textContent).toBe('Google Authenticator 匯入');
	});

	it('preserves accumulated import progress and relabels cached format options', () => {
		const api = createHarness('zh-CN');
		api.updateImportStats(101, 2, 3);
		api.updateImportProgress({
			titleKey: 'transferBulkImporting',
			messageKey: 'transferProcessingBatch',
			messageParams: { index: 2, count: 3 },
			totalItems: 250,
			processedItems: 100,
			successCount: 99,
			failCount: 1,
			chunkIndex: 2,
			chunkCount: 3,
		});
		api.showSubFormatModal('aegis-multi');
		document.getElementById('subFormatModal').classList.add('show');
		api.setLanguage('en');
		expect(document.getElementById('statValid').textContent).toBe('101 valid');
		expect(document.getElementById('statTotal').textContent).toBe('106 total');
		expect(document.getElementById('importProgressStatus').textContent).toBe('Processing batch 2 / 3...');
		expect(document.getElementById('importProgressSuccess').textContent).toBe('Succeeded: 99');
		expect(document.getElementById('importProgressPercent').textContent).toBe('40%');
		expect(document.getElementById('subFormatTitle').textContent).toBe('Choose an Aegis export format');
		expect(document.getElementById('subFormatList').textContent).toContain('Standard format');
	});
});
