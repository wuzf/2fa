import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';
import { createOfflinePage } from '../../src/ui/offlinePage.js';
import { createManifest } from '../../src/ui/manifest.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { createOAuthPopupResponse, createOAuthState, extractOAuthStatePreview } from '../../src/utils/oauth.js';

function runPage(html, { savedLanguage, browserLanguages = ['en-US'], url = 'https://example.com/otp', storageBlocked = false } = {}) {
	const window = new Window({ url, settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	Object.defineProperty(window.document, 'hidden', { value: false });
	const storage = new Map(savedLanguage ? [['language', savedLanguage]] : []);
	const writeText = vi.fn().mockResolvedValue(undefined);
	const fetch = vi.fn().mockRejectedValue(new Error('offline'));
	const interval = vi.fn();
	let now = 0;
	const context = createContext({
		window,
		document: window.document,
		location: window.location,
		CustomEvent: window.CustomEvent,
		navigator: { language: browserLanguages[0], languages: browserLanguages, clipboard: { writeText } },
		localStorage: {
			getItem(key) {
				if (storageBlocked) {
					throw new Error('denied');
				}
				return storage.get(key);
			},
			setItem(key, value) {
				if (storageBlocked) {
					throw new Error('denied');
				}
				storage.set(key, value);
			},
		},
		performance: { now: () => now },
		Date: { now: () => now },
		URL,
		AbortController,
		fetch,
		setInterval: interval,
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
	});
	for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
		runInContext(script, context);
	}
	return {
		window,
		document: window.document,
		context,
		storage,
		writeText,
		fetch,
		interval,
		advance(ms) {
			now = ms;
		},
	};
}

describe('standalone page localization', () => {
	it.each([
		['zh-CN', '生成验证码', '粘贴或输入验证器密钥'],
		['zh-TW', '產生驗證碼', '貼上或輸入驗證器金鑰'],
		['en', 'Generate a code', 'Paste or enter your authenticator secret'],
	])('renders the OTP form, labels and document language in %s', async (language, heading, placeholder) => {
		const request = new Request(`https://example.com/otp?lang=${language}`);
		const response = createOtpEntryPage(request);
		const html = await response.text();
		expect(response.headers.get('Content-Language')).toBe(language);
		const page = runPage(html, { savedLanguage: language });
		expect(page.document.documentElement.lang).toBe(language);
		expect(page.document.getElementById('otpEntryTitle').textContent).toBe(heading);
		expect(page.document.getElementById('s').placeholder).toBe(placeholder);
		expect(page.document.querySelector('button').textContent).toBe(heading);
	});

	it('persists language changes and updates the URL so reloading does not restore an older preference', async () => {
		const page = runPage(await createOtpEntryPage().text(), { url: 'https://example.com/otp?lang=zh-CN' });
		const select = page.document.getElementById('standaloneLanguage');
		select.value = 'en';
		select.dispatchEvent(new page.window.Event('change'));
		expect(page.storage.get('language')).toBe('en');
		expect(new URL(page.window.location.href).searchParams.get('lang')).toBe('en');
		expect(page.document.title).toBe('OTP Generator - 2FA');
		page.document.getElementById('s').value = 'JBSW Y3DP EHPK3PXP';
		page.document.getElementById('otpEntryForm').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
		expect(page.window.location.href).toBe('https://example.com/otp/JBSWY3DPEHPK3PXP?lang=en');
	});

	it('localizes live TOTP countdowns, copying, accessibility labels and network failure recovery', async () => {
		const page = runPage(
			await createQuickOtpPage('012345', {
				period: 30,
				remainingTime: 2,
				nextToken: '654321',
				followingToken: '345678',
				validUntil: 30000,
			}).text(),
		);
		expect(page.document.getElementById('countdown').textContent).toBe('Updates in 2s');
		expect(page.document.getElementById('token').getAttribute('aria-label')).toBe('Copy current code');
		await page.context.copyCode();
		expect(page.writeText).toHaveBeenCalledWith('012345');
		expect(page.document.getElementById('copied').textContent).toBe('Code copied');
		page.context.changeStandaloneLanguage('zh-TW');
		expect(page.document.getElementById('copied').textContent).toBe('驗證碼已複製');
		expect(page.document.getElementById('countdown').textContent).toBe('2 秒後更新');
		page.advance(2001);
		page.interval.mock.calls[0][0]();
		expect(page.fetch).toHaveBeenCalled();
		for (let i = 0; i < 10; i++) {
			await Promise.resolve();
		}
		expect(page.document.getElementById('refreshMessage').textContent).toBe('暫時無法更新，請檢查網路後重試');
		expect(page.document.getElementById('retry').textContent).toBe('重試更新');
		page.context.changeStandaloneLanguage('en');
		expect(page.document.getElementById('refreshMessage').textContent).toBe('Unable to update. Check your connection and try again.');
	});

	it('keeps HOTP fixed while translating the counter notice and clipboard failure', async () => {
		const page = runPage(await createQuickOtpPage('012345', { type: 'HOTP', counter: 7 }).text(), { savedLanguage: 'zh-TW' });
		expect(page.document.querySelector('.page-notice').textContent).toContain('計數器：7');
		page.writeText.mockRejectedValue(new Error('denied'));
		await page.context.copyCode();
		expect(page.document.getElementById('copied').textContent).toBe('複製失敗，請檢查剪貼簿權限');
		expect(page.document.getElementById('tokenValue').textContent).toBe('012345');
		expect(page.interval).not.toHaveBeenCalled();
	});

	it('renders the offline fallback in a supported browser language even when storage is blocked', () => {
		const page = runPage(createOfflinePage(), { browserLanguages: ['unsupported', 'zh-Hant-HK'], storageBlocked: true });
		expect(page.document.documentElement.lang).toBe('zh-TW');
		expect(page.document.title).toBe('離線模式 - 2FA');
		expect(page.document.getElementById('offline-title').textContent).toBe('暫時無法連線');
		expect(page.document.querySelector('.page-button').textContent).toBe('重新載入');
		expect(page.fetch).not.toHaveBeenCalled();
	});

	it('updates setup validation feedback when changing languages and sends the selected language to the API', async () => {
		const page = runPage(await (await createSetupPage()).text(), { storageBlocked: true });
		expect(page.document.title).toBe('Initial Setup - 2FA Authenticator');
		page.document.getElementById('password').value = 'short';
		page.document.getElementById('confirmPassword').value = 'different';
		await page.context.handleSetup({ preventDefault() {} });
		expect(page.document.getElementById('errorMessage').textContent).not.toMatch(/[\u3400-\u9fff]/);
		page.context.changeSetupLanguage('zh-TW');
		expect(page.document.getElementById('errorMessage').textContent).toContain('密碼');
		page.document.getElementById('password').value = 'StrongPass1!';
		page.document.getElementById('confirmPassword').value = 'StrongPass1!';
		page.fetch.mockResolvedValue({ ok: true, json: async () => ({ message: '服务端成功消息' }) });
		await page.context.handleSetup({ preventDefault() {} });
		expect(page.fetch.mock.calls[0][1].headers['X-Language']).toBe('zh-TW');
		expect(page.document.getElementById('successMessage').textContent).not.toContain('服务端');
	});

	it.each(['zh-CN', 'zh-TW', 'en'])('localizes installed app metadata and shortcuts in %s', async (language) => {
		const response = createManifest(new Request(`https://example.com/manifest.json?lang=${language}`));
		const manifest = await response.json();
		expect(manifest.lang).toBe(language);
		expect(response.headers.get('Vary')).toContain('Accept-Language');
		if (language === 'en') {
			expect([manifest.name, manifest.description, ...manifest.shortcuts.map((item) => item.description)].join(' ')).not.toMatch(
				/[\u3400-\u9fff]/,
			);
		}
		if (language === 'zh-TW') {
			expect(manifest.shortcuts[0].name).toBe('新增金鑰');
		}
	});

	it('carries language through signed OAuth state and preserves it on a callback domain with different preferences', async () => {
		const env = { GOOGLE_DRIVE_CLIENT_SECRET: 'test-secret', SECRETS_KV: { put: vi.fn() } };
		const state = await createOAuthState(env, { provider: 'gdrive', appOrigin: 'https://app.example.com', language: 'en' });
		const preview = await extractOAuthStatePreview(env, state, 'gdrive');
		expect(preview.language).toBe('en');
		const request = new Request('https://callback.example.com/api/gdrive/oauth/callback');
		const response = createOAuthPopupResponse(request, { success: false, language: preview.language, appOrigin: preview.appOrigin });
		const page = runPage(await response.text(), { savedLanguage: 'zh-TW', browserLanguages: ['zh-CN'] });
		expect(page.document.documentElement.lang).toBe('en');
		expect(page.document.title).toBe('Authorization failed');
		expect(page.document.querySelector('.page-description').textContent).toBe('Cloud drive authorization was not completed.');
		expect(page.document.querySelector('.page-button').textContent).toBe('Return to app');
	});
});
