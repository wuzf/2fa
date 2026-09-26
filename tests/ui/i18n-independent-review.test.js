import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { createOtpEntryPage } from '../../src/ui/quickOtp.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { createOAuthPopupResponse } from '../../src/utils/oauth.js';
import { translateServerMessage } from '../../src/utils/i18n.js';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';

function runtime(html, { url = 'https://example.test/setup', browserLanguage = 'zh-CN', saved = 'zh-CN', fetch } = {}) {
	const window = new Window({ url, settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	const storage = new Map([['language', saved]]);
	const postMessage = vi.fn();
	Object.defineProperty(window, 'opener', { value: { closed: false, postMessage } });
	window.close = vi.fn();
	const context = createContext({
		window,
		document: window.document,
		location: window.location,
		URL,
		CustomEvent: window.CustomEvent,
		navigator: { language: browserLanguage, languages: [browserLanguage] },
		localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
		fetch,
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
		console,
	});
	for (const script of window.document.scripts) {
		if (!script.src && script.type !== 'application/json') {
			runInContext(script.textContent, context);
		}
	}
	return { api: context, document: window.document, postMessage };
}

describe('independent localization review: main tool forms', () => {
	it.each(SUPPORTED_LANGUAGES)('binds every translation and preserves all form controls in %s', async (language) => {
		const html = await (await createMainPage()).text();
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		window.document.write(html);
		const document = window.document;
		const toolIds = [
			'qrDecodeModal',
			'qrGenerateModal',
			'base32Modal',
			'timestampModal',
			'keyCheckModal',
			'keyGeneratorModal',
			'webdavModal',
			's3Modal',
			'oneDriveModal',
			'googleDriveModal',
		];
		const controls = toolIds.flatMap((id) => [...document.getElementById(id).querySelectorAll('input,button,textarea,select')]);
		const identities = controls.map((control) => [control, control.getAttribute('onclick'), control.getAttribute('onchange')]);
		const context = createContext({ document, navigator: { language }, localStorage: { getItem: () => language, setItem() {} }, window });
		runInContext(getI18nCode(), context);
		context.setLanguage(language);
		for (const element of document.querySelectorAll('*')) {
			for (const attribute of [
				'data-i18n',
				'data-i18n-html',
				'data-i18n-placeholder',
				'data-i18n-title',
				'data-i18n-aria-label',
				'data-i18n-alt',
				'data-i18n-content',
			]) {
				const key = element.getAttribute(attribute);
				if (key) {
					expect(LOCALES[language][key], `${element.id || element.tagName}/${attribute}/${key}`).toBeTypeOf('string');
				}
			}
		}
		for (const [control, click, change] of identities) {
			expect(control.isConnected, control.id).toBe(true);
			expect(control.getAttribute('onclick')).toBe(click);
			expect(control.getAttribute('onchange')).toBe(change);
		}
		if (language === 'en') {
			for (const id of toolIds) {
				const modal = document.getElementById(id);
				expect(modal.textContent, id).not.toMatch(/[\u3400-\u9fff]/);
				for (const element of modal.querySelectorAll('*')) {
					for (const attribute of ['placeholder', 'aria-label', 'title', 'alt']) {
						expect(element.getAttribute(attribute) || '', `${id}/${element.id}/${attribute}`).not.toMatch(/[\u3400-\u9fff]/);
					}
				}
			}
		}
	});
});

describe('independent localization review: setup failures', () => {
	const original = '密码已设置，无法重复设置。如需修改密码，请联系管理员。';
	const fill = (document) => {
		document.getElementById('password').value = 'CorrectPass123!';
		document.getElementById('confirmPassword').value = 'CorrectPass123!';
	};
	it('retranslates a displayed server failure without losing the reason', async () => {
		const fetch = vi.fn(async () => ({ ok: false, json: async () => ({ message: original }) }));
		const page = runtime(await (await createSetupPage()).text(), { fetch });
		fill(page.document);
		await page.api.handleSetup({ preventDefault() {} });
		page.api.changeSetupLanguage('en');
		expect(page.document.getElementById('errorMessage').textContent).toBe(translateServerMessage(original, 'en'));
	});

	it('keeps an in-flight server failure in the newly selected language', async () => {
		let resolve;
		const fetch = vi.fn(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const page = runtime(await (await createSetupPage()).text(), { fetch });
		fill(page.document);
		const pending = page.api.handleSetup({ preventDefault() {} });
		page.api.changeSetupLanguage('zh-TW');
		resolve({ ok: false, json: async () => ({ message: original }) });
		await pending;
		expect(page.document.getElementById('errorMessage').textContent).toBe(translateServerMessage(original, 'zh-TW'));
	});
});

describe('independent localization review: explicit URL language', () => {
	it.each([
		['/otp?language=en', 'en', createOtpEntryPage],
		['/setup?language=zh-TW', 'zh-TW', createSetupPage],
		['/setup?lang=en-US', 'en', createSetupPage],
		['/setup?lang=zh-Hant', 'zh-TW', createSetupPage],
	])('preserves the explicit preference in %s after client initialization', async (path, expected, createPage) => {
		const url = 'https://example.test' + path;
		const response = await createPage(new Request(url));
		expect(response.headers.get('Content-Language')).toBe(expected);
		const page = runtime(await response.text(), { url });
		expect(page.document.documentElement.lang).toBe(expected);
	});
});

describe('independent localization review: OAuth combined messages', () => {
	it.each([
		['Google Drive', true],
		['Google Drive', false],
		['OneDrive', true],
		['OneDrive', false],
	])('translates %s connection-success=%s result and storage warning independently', async (provider, connected) => {
		const result = connected
			? `${provider} 授权成功，已完成自动连接测试。当前目标仍为关闭状态，你可以按需手动启用同步。`
			: `${provider} 授权已保存，但自动连接测试失败：${provider} refresh token 不存在，请重新授权`;
		const warning = `ENCRYPTION_KEY 未配置，${provider} 凭据将以明文存储。建议立即配置加密密钥。`;
		const response = createOAuthPopupResponse(new Request('https://example.test/callback'), {
			success: true,
			language: 'en',
			message: `${result} ${warning}`,
			messageParts: [result, warning],
		});
		const page = runtime(await response.text(), { url: 'https://example.test/callback' });
		expect(page.document.querySelector('.page-description').textContent).toBe(
			`${translateServerMessage(result, 'en')} ${translateServerMessage(warning, 'en')}`,
		);
		expect(page.postMessage).toHaveBeenCalled();
		expect(page.postMessage.mock.calls[0][0].message).not.toMatch(/[\u3400-\u9fff]/);
		expect(page.postMessage.mock.calls[0][0]).not.toHaveProperty('messageParts');
		page.api.changeStandaloneLanguage('zh-TW');
		expect(page.document.querySelector('.page-description').textContent).toBe(
			`${translateServerMessage(result, 'zh-TW')} ${translateServerMessage(warning, 'zh-TW')}`,
		);
	});
});

describe('independent localization review: public OTP error responses', () => {
	it.each(['en', 'zh-TW'])('localizes invalid secrets and OTP parameter failures in %s', async (language) => {
		for (const [secret, query] of [
			['invalid!', ''],
			['JBSWY3DPEHPK3PXP', '&digits=7'],
			['JBSWY3DPEHPK3PXP', '&type=BAD'],
			['JBSWY3DPEHPK3PXP', '&period=35'],
		]) {
			const response = await handleGenerateOTP(secret, new Request(`https://example.test/otp/${secret}?lang=${language}${query}`));
			expect(response.status).toBe(400);
			expect(response.headers.get('Content-Language')).toBe(language);
			const { error, message } = await response.json();
			if (language === 'en') {
				expect(`${error} ${message}`).not.toMatch(/[\u3400-\u9fff]/);
			} else {
				expect(`${error} ${message}`).not.toMatch(/密钥|验证码|类型|刷新|设置|周期|请选择/);
			}
		}
	});
});
