// Independent review: exercise emitted tools against the actual page and i18n runtime.
import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getToolsCode } from '../../src/ui/scripts/tools.js';
import { localizeResponseData } from '../../src/utils/i18n.js';

const html = await (await createMainPage()).text();
const providers = [
	['Webdav', 'webdav', 'WebDAV', 'webdav'],
	['S3', 's3', 'S3', 's3'],
	['OneDrive', 'oneDrive', 'OneDrive', 'onedrive'],
	['GoogleDrive', 'googleDrive', 'Google Drive', 'gdrive'],
];

function harness() {
	const window = new Window({ url: 'https://2fa.example/', settings: { disableJavaScriptEvaluation: true } });
	const document = window.document;
	document.write(html);
	window.localStorage.setItem('language', 'en');
	const api = createContext({
		window,
		document,
		localStorage: window.localStorage,
		navigator: { language: 'en' },
		HTMLElement: window.HTMLElement,
		URL,
		setTimeout,
		clearTimeout,
		clearInterval,
		requestAnimationFrame: vi.fn(),
		cancelAnimationFrame: vi.fn(),
		showCenterToast: vi.fn(),
		console: { log() {}, warn() {}, error() {} },
	});
	const state = {
		count: 1,
		maxAllowed: 5,
		oauthConfigured: true,
		destinations: [
			{
				id: 'one',
				name: 'My "backup" <script>user data</script>',
				enabled: true,
				authorized: true,
				config: {
					url: 'https://dav.example',
					endpoint: 'https://s3.example',
					bucket: 'example',
					username: 'user',
					hasPassword: true,
					hasSecretAccessKey: true,
					folderPath: '/backups',
				},
				status: { lastError: { error: '认证失败，请检查用户名和密码' } },
			},
		],
	};
	api.authenticatedFetch = vi.fn(async () => ({ ok: true, json: async () => localizeResponseData(state, api.getLanguage()) }));
	runInContext(getI18nCode() + getUtilsCode() + getToolsCode(), api);
	api.applyTranslations();
	return { api, state, document, element: (id) => document.getElementById(id) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('independent tools language review', () => {
	it.each(providers)('keeps %s credentials and edits while translating historical errors through a fresh request', async (name, prefix) => {
		const h = harness();
		await h.api[`load${name}Destinations`]();
		h.element(prefix + 'Modal').classList.add('show');
		h.api[`show${name}Form`]('one');
		h.element(prefix + 'Name').value = 'Unsaved name';
		const credential = h.element(prefix + 'Password') || h.element(prefix + 'SecretAccessKey');
		if (credential) {
			credential.value = 'private draft';
		}
		h.api.setLanguage('zh-TW');
		await vi.advanceTimersByTimeAsync(0);
		expect(h.element(prefix + 'DestinationList').textContent).toContain('驗證失敗，請檢查使用者名稱與密碼');
		expect(h.element(prefix + 'Name').value).toBe('Unsaved name');
		expect(h.element(prefix + 'FormArea').style.display).toBe('block');
		if (credential) {
			expect(credential.value).toBe('private draft');
		}
		expect(h.element(prefix + 'DestinationList').querySelector('script')).toBeNull();
		expect(h.element(prefix + 'DestinationList').textContent).not.toContain('private draft');
	});

	it.each(providers)('preserves the %s saving state when the language changes during a request', async (name, prefix) => {
		const h = harness();
		for (const suffix of ['Name', 'Url', 'Username', 'Endpoint', 'Bucket', 'AccessKeyId']) {
			const input = h.element(prefix + suffix);
			if (input) {
				input.value = suffix === 'Url' || suffix === 'Endpoint' ? 'https://example.com' : 'example';
			}
		}
		let finish;
		h.api.authenticatedFetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const saving = h.api[`save${name}Config`]();
		const button = h.element(prefix + 'SaveBtn');
		expect(button.textContent).toBe(h.api.t('saving'));
		h.api.setLanguage('zh-TW');
		expect(button.disabled).toBe(true);
		expect(button.textContent).toBe(h.api.t('saving'));
		finish({ ok: false, json: async () => ({ success: false }) });
		await saving;
		expect(button.textContent).toBe(h.api.t('save'));
	});

	it.each(providers)('shows a translated %s load failure for an HTTP error instead of an empty destination list', async (name, prefix) => {
		const h = harness();
		h.api.authenticatedFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'Temporarily unavailable' }) });
		await h.api[`load${name}Destinations`]();
		expect(h.element(prefix + 'DestinationList').textContent).toBe(h.api.t('toolSyncLoadRetry'));
	});

	it.each([
		['testWebdavConnection', 'webdav', 'TestBtn', 'toolSyncTesting'],
		['testS3Connection', 's3', 'TestBtn', 'toolSyncTesting'],
		['authorizeOneDriveDest', 'oneDrive', 'AuthorizeBtn', 'toolSyncAuthorizing'],
		['authorizeGoogleDriveDest', 'googleDrive', 'AuthorizeBtn', 'toolSyncAuthorizing'],
	])('keeps %s progress translated until the pending request settles', async (action, prefix, suffix, key) => {
		const h = harness();
		for (const field of ['Name', 'Url', 'Username', 'Endpoint', 'Bucket', 'AccessKeyId']) {
			const input = h.element(prefix + field);
			if (input) {
				input.value = field === 'Url' || field === 'Endpoint' ? 'https://example.com' : 'example';
			}
		}
		h.api.window.open = vi.fn(() => ({ location: { href: '' }, close() {}, closed: false }));
		let finish;
		h.api.authenticatedFetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const pending = h.api[action]('one');
		const button = h.element(prefix + suffix);
		expect(button.textContent).toBe(h.api.t(key));
		h.api.setLanguage('zh-TW');
		expect(button.disabled).toBe(true);
		expect(button.textContent).toBe(h.api.t(key));
		finish({ ok: false, json: async () => ({ success: false }) });
		await pending;
		expect(button.disabled).toBe(false);
	});
});
