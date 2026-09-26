import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { STANDALONE_LOCALES } from '../../src/ui/locales/standalone.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { createOtpEntryPage } from '../../src/ui/quickOtp.js';
import { createOfflinePage } from '../../src/ui/offlinePage.js';
import { createManifest } from '../../src/ui/manifest.js';
import { createOAuthPopupResponse } from '../../src/utils/oauth.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getSharedTransferMessageLocalizerCode, getTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getRequestLanguage, localizeResponseData, translateServerMessage } from '../../src/utils/i18n.js';

function render(html, { language = 'en', query = '', savedLanguage = null, storageBlocked = false } = {}) {
	const window = new Window({ url: `https://app.example/${query}`, settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	const context = createContext({
		window,
		document: window.document,
		location: window.location,
		URL,
		CustomEvent: window.CustomEvent,
		navigator: { language, languages: [language] },
		localStorage: {
			getItem: () => {
				if (storageBlocked) {
					throw new Error('Unavailable storage');
				}
				return savedLanguage;
			},
			setItem: vi.fn(),
		},
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
		fetch: vi.fn(),
	});
	for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
		runInContext(script, context);
	}
	return { window, document: window.document, context };
}

describe.each(SUPPORTED_LANGUAGES)('public and diagnostic language %s', (language) => {
	it('negotiates API preferences and preserves values inside localized diagnostics', () => {
		expect(getRequestLanguage(new Request('https://app.example/api', { headers: { 'X-Language': language } }))).toBe(language);
		expect(getRequestLanguage(new Request(`https://app.example/api?lang=${language}`))).toBe(language);
		const translated = translateServerMessage('密码错误', language);
		expect(translated).toBeTruthy();
		if (!['en', 'zh-CN'].includes(language)) {
			expect(translated).not.toBe('Incorrect password');
		}
		const name = 'Original 中文; <user> & аккаунт';
		const data = { name, message: `服务"${name}" 已存在`, secret: { name, message: '密码错误' } };
		const result = localizeResponseData(data, language);
		expect(result.message).toContain(name);
		expect(result.name).toBe(name);
		expect(result.secret).toEqual(data.secret);
	});
	it('renders the OTP form, offline fallback, setup and install metadata in the selected language', async () => {
		const request = new Request(`https://app.example/otp?lang=${language}`);
		const entry = render(await createOtpEntryPage(request).text(), { language, query: `?lang=${language}` });
		expect(entry.document.getElementById('otpEntryTitle').textContent).toBe(STANDALONE_LOCALES[language].otpEntryTitle);
		expect([...entry.document.getElementById('standaloneLanguage').options].map((option) => option.value)).toEqual(SUPPORTED_LANGUAGES);
		entry.document.getElementById('s').value = 'MY_UNCHANGED_SECRET';
		entry.context.changeStandaloneLanguage('en');
		entry.context.changeStandaloneLanguage(language);
		expect(entry.document.getElementById('s').value).toBe('MY_UNCHANGED_SECRET');
		expect(entry.document.documentElement.lang).toBe(language);
		const offline = render(createOfflinePage(), { language, storageBlocked: true });
		expect(offline.document.title).toBe(STANDALONE_LOCALES[language].offlinePageTitle);
		const setup = render(await (await createSetupPage(request)).text(), { language, query: `?lang=${language}` });
		expect(setup.document.title).toBe(LOCALES[language].setupPageTitle);
		expect(setup.document.getElementById('setupLangSelect').options.length).toBe(15);
		setup.document.getElementById('password').value = 'Untouched1!';
		setup.context.changeSetupLanguage('en');
		setup.context.changeSetupLanguage(language);
		expect(setup.document.getElementById('password').value).toBe('Untouched1!');
		const manifest = await createManifest(request).json();
		expect(manifest.lang).toBe(language);
		expect(manifest.shortcuts[0].name).toBe(STANDALONE_LOCALES[language].manifestAdd);
		if (!['en', 'zh-CN'].includes(language)) {
			expect(STANDALONE_LOCALES[language].otpEntryTitle).not.toBe(STANDALONE_LOCALES.en.otpEntryTitle);
			expect(LOCALES[language].setupPageTitle).not.toBe(LOCALES.en.setupPageTitle);
		}
	});
	it('relocalizes authentication, setup and transfer diagnostics received in this language to another language', async () => {
		let targetLanguage = 'en';
		const context = createContext({ getLanguage: () => targetLanguage, I18N_LOCALES: LOCALES });
		runInContext(getAuthCode() + getSharedTransferMessageLocalizerCode() + getTransferMessageLocalizerCode('localizeTransfer'), context);
		const passwordMessage = translateServerMessage('密码长度至少为 11 位', language);
		expect(context.localizeAuthMessage(passwordMessage)).toBe('Password must be at least 11 characters long');
		targetLanguage = 'zh-TW';
		expect(context.localizeAuthMessage(passwordMessage)).toBe('密碼長度至少為 11 位');
		const original = '服务"原文; USER_اسم" 已存在';
		const diagnostic = translateServerMessage(original, language);
		expect(context.localizeTransfer(diagnostic)).toBe('服務「原文; USER_اسم」已存在');
		const setup = render(await (await createSetupPage()).text(), { language: 'en' });
		expect(setup.context.localizeSetupMessage(passwordMessage)).toBe('Password must be at least 11 characters long');
	});
	it('keeps callback language across origins and translates the OAuth outcome', async () => {
		const request = new Request('https://callback.example/oauth', { headers: { 'Accept-Language': 'en' } });
		const response = createOAuthPopupResponse(request, {
			success: false,
			language,
			message: '密码错误',
			appOrigin: 'https://app.example',
		});
		expect(response.headers.get('Content-Language')).toBe(language);
		const page = render(await response.text(), { language: 'en', savedLanguage: 'en' });
		expect(page.document.documentElement.lang).toBe(language);
		expect(page.document.body.textContent).toContain(translateServerMessage('密码错误', language));
	});
});

it('falls back to English for unknown explicit or browser preferences while preserving the legacy unspecified API language', async () => {
	for (const request of [
		new Request('https://app.example/api', { headers: { 'X-Language': 'unsupported', 'Accept-Language': 'zh-CN' } }),
		new Request('https://app.example/api?lang=unsupported', { headers: { 'Accept-Language': 'zh-CN' } }),
		new Request('https://app.example/api', { headers: { 'Accept-Language': 'unsupported' } }),
	]) {
		expect(getRequestLanguage(request)).toBe('en');
	}
	const offline = render(createOfflinePage(), { language: 'unsupported', storageBlocked: true });
	expect(offline.document.documentElement.lang).toBe('en');
	const setup = render(await (await createSetupPage()).text(), { language: 'unsupported' });
	expect(setup.document.documentElement.lang).toBe('en');
	const query = render(await createOtpEntryPage().text(), { language: 'zh-CN', query: '?lang=unsupported' });
	expect(query.document.documentElement.lang).toBe('en');
	expect(getRequestLanguage(new Request('https://app.example/api'))).toBe('zh-CN');
});

it.each(['?lang=', '?lang=&language=ja', '?language='])(
	'keeps the server and standalone/setup client in English for an explicit empty language in %s',
	async (query) => {
		for (const factory of [createSetupPage, createOtpEntryPage]) {
			const request = new Request(`https://app.example/${query}`);
			const response = await factory(request);
			expect(response.headers.get('Content-Language')).toBe('en');
			const page = render(await response.text(), { language: 'zh-CN', savedLanguage: 'ja', query });
			expect(page.document.documentElement.lang).toBe('en');
		}
	},
);

it('keeps serialized language detection self-contained after bundling and minifying the Worker renderers', async () => {
	const result = await build({
		stdin: {
			contents: "export { createSetupPage } from './src/ui/setupPage.js'; export { createOtpEntryPage } from './src/ui/quickOtp.js';",
			resolveDir: process.cwd(),
		},
		bundle: true,
		minify: true,
		format: 'iife',
		globalName: 'renderers',
		write: false,
		platform: 'browser',
		target: 'es2022',
	});
	const scope = createContext({ Request, Response, URL });
	runInContext(result.outputFiles[0].text, scope);
	for (const factory of [scope.renderers.createSetupPage, scope.renderers.createOtpEntryPage]) {
		const response = await factory(new Request('https://app.example/?lang=de'));
		const page = render(await response.text(), { language: 'de-DE' });
		expect(page.document.documentElement.lang).toBe('de');
		expect(page.document.title).not.toContain('undefined');
	}
});
