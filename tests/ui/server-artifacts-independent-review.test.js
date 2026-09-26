import { build } from 'esbuild';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { STANDALONE_LOCALES } from '../../src/ui/locales/standalone.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { BACKUP_DOCUMENT_LOCALES } from '../../src/utils/backup-locales.js';
import { translateServerMessage } from '../../src/utils/i18n.js';

const secret = {
	id: 'original-id',
	name: '</script><script id="injected">window.attack = true</script>用户',
	account: 'original@example.com; 用户',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'HOTP',
	digits: 8,
	period: 60,
	algorithm: 'SHA256',
	counter: 42,
};

async function bundledArtifacts(keepNames) {
	const result = await build({
		stdin: {
			contents: `
				export {createSetupPage} from './src/ui/setupPage.js';
				export {createOtpEntryPage, createQuickOtpPage} from './src/ui/quickOtp.js';
				export {createOfflinePage} from './src/ui/offlinePage.js';
				export {createOAuthPopupResponse} from './src/utils/oauth.js';
				export {encodeBackupContent, decodeBackupContent} from './src/utils/backup-format.js';
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		globalName: 'artifacts',
		platform: 'neutral',
		mainFields: ['browser', 'module', 'main'],
		target: 'es2022',
		minify: true,
		keepNames,
		write: false,
		logLevel: 'silent',
	});
	return runInNewContext(`${result.outputFiles[0].text}; artifacts`, {
		Request,
		Response,
		Headers,
		URL,
		crypto,
		TextEncoder,
		TextDecoder,
		btoa,
		atob,
		console,
	});
}

function execute(html, url) {
	const window = new Window({ url, settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	window.localStorage.setItem('language', 'zh-CN');
	const context = createContext({
		window,
		document: window.document,
		location: window.location,
		URL,
		CustomEvent: window.CustomEvent,
		navigator: { language: 'zh-CN', languages: ['zh-CN'], clipboard: { writeText: vi.fn() } },
		localStorage: window.localStorage,
		fetch: vi.fn(),
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
		setInterval: vi.fn(),
		clearInterval: vi.fn(),
		console,
	});
	for (const script of window.document.scripts) {
		if (script.type !== 'application/json') {
			runInContext(script.textContent, context);
		}
	}
	return { window, context, document: window.document };
}

describe.each([false, true])('independent minified server artifact review (keepNames=%s)', (keepNames) => {
	it('executes setup, OTP, OAuth, offline and portable backup scripts in all 15 languages', async () => {
		const api = await bundledArtifacts(keepNames);
		const request = new Request('https://example.com/otp?lang=ja');
		const backup = await api.encodeBackupContent([secret], {
			format: 'html',
			language: 'ja',
			includeQRCodes: false,
			timestamp: '2026-10-02T01:02:03Z',
		});
		expect(api.decodeBackupContent(backup.content, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		const fixtures = [
			{ kind: 'setup', html: await (await api.createSetupPage(request)).text() },
			{ kind: 'entry', html: await api.createOtpEntryPage(request).text() },
			{ kind: 'hotp', html: await api.createQuickOtpPage('01234567', { request, type: 'HOTP', counter: 42 }).text() },
			{ kind: 'offline', html: api.createOfflinePage() },
			{
				kind: 'oauth',
				html: await api.createOAuthPopupResponse(request, { language: 'ja', success: false, message: secret.name }).text(),
			},
			{ kind: 'backup', html: backup.content },
		];
		for (const fixture of fixtures) {
			const page = execute(fixture.html, request.url);
			try {
				expect(page.document.documentElement.lang, fixture.kind).toBe('ja');
				expect(page.document.getElementById('injected')).toBeNull();
				expect(page.window.attack).toBeUndefined();
				const select = page.document.querySelector('select');
				expect([...select.options].map((option) => option.value)).toEqual(SUPPORTED_LANGUAGES);
				const input = page.document.querySelector('input');
				if (input) {
					input.value = 'keep-draft-value';
				}
				for (const language of SUPPORTED_LANGUAGES) {
					if (fixture.kind === 'setup') {
						page.context.changeSetupLanguage(language);
						expect(page.document.title).toBe(LOCALES[language].setupPageTitle);
						const previousMessage = translateServerMessage('密码长度至少为 16 位', 'ja');
						expect(page.context.localizeSetupMessage(previousMessage)).toBe(translateServerMessage('密码长度至少为 16 位', language));
					} else {
						page.context.changeStandaloneLanguage(language);
					}
					expect(page.document.documentElement.lang).toBe(language);
					expect(select.value).toBe(language);
					if (input) {
						expect(input.value).toBe('keep-draft-value');
					}
					if (fixture.kind === 'entry') {
						expect(page.document.title).toBe(STANDALONE_LOCALES[language].otpEntryPageTitle);
					} else if (fixture.kind === 'hotp') {
						expect(page.document.getElementById('tokenValue').textContent).toBe('01234567');
						expect(page.context.setInterval).not.toHaveBeenCalled();
					} else if (fixture.kind === 'oauth') {
						expect(page.document.querySelector('.page-description').textContent).toBe(secret.name);
					} else if (fixture.kind === 'backup') {
						expect(page.document.title).toBe(BACKUP_DOCUMENT_LOCALES[language].title);
						expect(page.document.querySelector('tbody td').textContent).toBe(secret.name);
						const fields = [...page.document.querySelectorAll('tbody td')].map((cell) => cell.textContent);
						expect(fields.slice(1, 8)).toEqual([secret.account, secret.secret, 'HOTP', '8', '60', 'SHA256', '42']);
					} else if (fixture.kind === 'offline') {
						expect(page.document.title).toBe(STANDALONE_LOCALES[language].offlinePageTitle);
					}
				}
				expect(page.context.fetch).not.toHaveBeenCalled();
			} finally {
				await page.window.happyDOM.close();
			}
		}
	});
});
