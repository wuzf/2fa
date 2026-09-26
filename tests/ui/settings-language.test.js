// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getVersionCheckCode } from '../../src/ui/scripts/versionCheck.js';
import { getBrowserExtensionCode } from '../../src/ui/scripts/browserExtension.js';

const page = await (await createMainPage()).text();

function harness(language = 'en') {
	const template = document.createElement('template');
	template.innerHTML = page;
	document.body.replaceChildren(template.content);
	const storage = new Map([['language', language]]);
	const listeners = new Map();
	const navigator = { language: 'zh-CN', onLine: true, userAgent: 'Chrome/150.0', clipboard: { writeText: vi.fn(async () => {}) } };
	const window = {
		navigator,
		location: { origin: 'https://2fa.example' },
		addEventListener: (name, callback) => listeners.set(name, callback),
		matchMedia: () => ({ matches: false }),
		scrollX: 0,
		scrollY: 0,
		scrollTo: vi.fn(),
	};
	const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, count: 2 }) }));
	const toast = vi.fn();
	const confirm = vi.fn(async () => false);
	// Execute the actual generated modules together, including the language switch hooks.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'fetch',
		'showCenterToast',
		'showConfirmDialog',
		'console',
		'disableBodyScroll',
		'enableBodyScroll',
		`${getI18nCode()}${getStateCode()}${getAuthCode()}${getSettingsCode()}${getPWACode()}${getVersionCheckCode()}${getBrowserExtensionCode()}
		return { t, setLanguage, getLanguage, formatI18nDate, loadSyncStatus, changePassword,
			scheduleNumericPreferenceSave, saveNumericPreference, refreshSettingsLanguage,
			applyOfflineQueueSummary, toggleOfflineQueueDetails, changeOfflineQueueOperation, refreshPwaLanguage,
			updateSettingsPwaInstallButton, triggerPwaInstallFromSettings, showOfflineBanner,
			checkForNewVersion, refreshVersionLanguage, showBrowserExtensionModal, copyExtensionInstanceUrl,
			refreshBrowserExtensionLanguage, hideBrowserExtensionModal };
		`,
	)(
		document,
		window,
		navigator,
		{
			getItem: (key) => storage.get(key) || null,
			setItem: (key, value) => storage.set(key, String(value)),
		},
		async (...args) => {
			const response = await fetch(...args);
			response.headers ||= new Headers();
			return response;
		},
		toast,
		confirm,
		{ log() {}, warn() {}, error() {} },
		vi.fn(),
		vi.fn(),
	);
	return { api, fetch, toast, confirm, listeners, storage };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe('settings and installation language behavior', () => {
	it.each(['zh-CN', 'zh-TW', 'en'])('translates password validation and sync state in %s', async (language) => {
		const h = harness(language);
		await h.api.changePassword();
		expect(document.getElementById('changePasswordResult').textContent).toBe(LOCALES[language].passwordFieldsRequired);
		await h.api.loadSyncStatus();
		for (const provider of ['Webdav', 'S3', 'OneDrive', 'GoogleDrive']) {
			expect(document.getElementById('settings' + provider + 'Status').textContent).toBe(h.api.t('syncStatusConfigured', { count: 2 }));
		}
		h.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Forbidden' }) });
		await h.api.loadSyncStatus();
		expect(document.getElementById('settingsS3Status').textContent).toBe(LOCALES[language].syncStatusError);
	});

	it('refreshes existing numeric and password messages without replacing drafts or requesting settings', async () => {
		const h = harness('zh-CN');
		await h.api.changePassword();
		const input = document.getElementById('settingsMaxBackups');
		input.value = '8';
		h.api.scheduleNumericPreferenceSave('maxBackups');
		h.api.setLanguage('en');
		expect(input.value).toBe('8');
		expect(document.getElementById('changePasswordResult').textContent).toBe('Fill in all password fields');
		expect(document.getElementById('settingsMaxBackupsResult').textContent).toBe('Waiting to save…');
		expect(h.fetch).not.toHaveBeenCalled();
		await h.api.saveNumericPreference('maxBackups');
		expect(document.getElementById('settingsMaxBackupsResult').textContent).toBe('Saved. The latest 8 backups will be kept.');
		h.api.setLanguage('zh-TW');
		expect(document.getElementById('settingsMaxBackupsResult').textContent).toBe('已儲存，保留最新 8 份備份');
		expect(input.value).toBe('8');
	});

	it('retranslates existing password and preference API errors when language changes', async () => {
		const h = harness();
		for (const id of ['settingsCurrentPassword', 'settingsNewPassword', 'settingsConfirmPassword']) {
			document.getElementById(id).value = 'ExamplePass1!';
		}
		h.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Password must contain at least one special character' }) });
		await h.api.changePassword();
		expect(document.getElementById('changePasswordResult').textContent).toBe('Password must contain at least one special character');
		h.fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Too many requests. Please try again in 30 seconds.' }) });
		document.getElementById('settingsMaxBackups').value = '8';
		h.api.scheduleNumericPreferenceSave('maxBackups');
		await h.api.saveNumericPreference('maxBackups');
		h.api.setLanguage('zh-TW');
		expect(document.getElementById('changePasswordResult').textContent).toBe('密碼必須包含至少一個特殊字元');
		expect(document.getElementById('settingsMaxBackupsResult').textContent).toBe('您的請求次數過多，請在 30 秒後重試');
		expect(document.getElementById('settingsNewPassword').value).toBe('ExamplePass1!');
	});

	it('keeps password and PWA progress in the selected language until pending work finishes', async () => {
		const h = harness();
		for (const id of ['settingsCurrentPassword', 'settingsNewPassword', 'settingsConfirmPassword']) {
			document.getElementById(id).value = 'ExamplePass1!';
		}
		let finishPassword;
		h.fetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishPassword = resolve;
				}),
		);
		const changing = h.api.changePassword();
		h.api.setLanguage('zh-TW');
		expect(document.getElementById('changePasswordBtn').textContent).toBe(h.api.t('changePasswordSubmitting'));
		finishPassword({ ok: true, json: async () => ({ success: true }) });
		await changing;
		expect(document.getElementById('changePasswordBtn').textContent).toBe(h.api.t('changePasswordBtn'));
		expect(document.getElementById('changePasswordResult').textContent).toBe(h.api.t('changePasswordSuccess'));
		let finishInstall;
		h.listeners.get('beforeinstallprompt')({
			preventDefault() {},
			prompt() {},
			userChoice: new Promise((resolve) => {
				finishInstall = resolve;
			}),
		});
		const installing = h.api.triggerPwaInstallFromSettings();
		h.api.setLanguage('en');
		const button = document.getElementById('settingsPwaInstallBtn');
		expect(button.textContent).toBe('Installing…');
		expect(button.disabled).toBe(true);
		finishInstall({ outcome: 'accepted' });
		await installing;
		expect(button.textContent).toBe('Install to Desktop');
		expect(h.toast).toHaveBeenLastCalledWith('✅', 'Installation started');
	});

	it('translates offline queue details, dates, cancellation, and existing offline banner', async () => {
		const h = harness();
		const timestamp = Date.UTC(2026, 8, 24, 10, 30);
		h.api.applyOfflineQueueSummary({ operations: [{ id: 'one', name: 'Example', type: 'UPDATE', status: 'failed', timestamp }] });
		h.api.toggleOfflineQueueDetails();
		expect(document.getElementById('offlineQueueSummary').textContent).toBe('1 unsynced change(s)');
		expect(document.querySelector('.offline-queue-label').textContent).toContain('Update account · Example · Retry needed');
		expect(document.querySelector('#offlineQueue time').textContent).toBe(h.api.formatI18nDate(timestamp));
		await h.api.changeOfflineQueueOperation('OFFLINE_QUEUE_CANCEL', 'one');
		expect(h.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Cancel unsynced change', confirmText: 'Cancel change', cancelText: 'Keep change' }),
		);
		h.api.showOfflineBanner();
		h.api.setLanguage('zh-TW');
		expect(document.getElementById('offlineQueueSummary').textContent).toBe('有 1 項尚未同步的變更');
		expect(document.querySelector('.offline-queue-label').textContent).toContain('更新帳號');
		expect(document.querySelector('#offlineQueue time').textContent).toBe(h.api.formatI18nDate(timestamp));
		expect(document.querySelector('.offline-banner-text').textContent).toBe('離線模式 - 操作將在網路恢復後自動同步');
	});

	it('refreshes a cached version notice and extension copy result while preserving the instance URL', async () => {
		const h = harness();
		h.storage.set('2fa-version-check', JSON.stringify({ latest: 'v99.0.0', checkedAt: Date.now() }));
		await h.api.checkForNewVersion();
		expect(document.getElementById('footerUpdateBadge').textContent).toBe('🆕 New version available: v99.0.0');
		h.api.showBrowserExtensionModal();
		await h.api.copyExtensionInstanceUrl();
		expect(document.getElementById('extensionCopyStatus').textContent).toBe('Instance URL copied.');
		h.api.setLanguage('zh-TW');
		expect(document.getElementById('footerUpdateBadge').textContent).toBe('🆕 有新版本 v99.0.0');
		expect(document.getElementById('extensionCopyStatus').textContent).toBe('執行個體網址已複製。');
		expect(document.getElementById('extensionInstanceUrl').value).toBe('https://2fa.example');
		expect(h.fetch).not.toHaveBeenCalled();
		h.api.hideBrowserExtensionModal();
	});
});
