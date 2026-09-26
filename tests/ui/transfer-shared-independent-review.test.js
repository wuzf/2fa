import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getCoreScripts, getScripts, getModuleCode } from '../../src/ui/scripts/index.js';
import { getTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { translateServerMessage } from '../../src/utils/i18n.js';

async function harness(code) {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	window.document.write(await (await createMainPage()).text());
	window.localStorage.setItem('language', 'en');
	// Skip network and page lifecycle work while evaluating the actual emitted
	// production core and the feature scripts in the same browser-like realm.
	window.addEventListener = vi.fn();
	window.document.addEventListener = vi.fn();
	const context = createContext({
		window,
		document: window.document,
		navigator: { language: 'en', onLine: true },
		localStorage: window.localStorage,
		location: window.location,
		URL,
		URLSearchParams,
		Headers,
		TextEncoder,
		TextDecoder,
		Uint8Array,
		atob,
		btoa,
		crypto,
		AbortController,
		performance,
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
		setInterval: vi.fn(),
		clearInterval: vi.fn(),
		console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
	});
	runInContext(code, context);
	return { context, window };
}

describe('independent shared transfer diagnostic review', () => {
	it.each(['split', 'full'])('shares one lazy index across all transfer features in %s mode', async (mode) => {
		const { context, window } = await harness(mode === 'split' ? getCoreScripts() : getScripts());
		try {
			expect(runInContext('transferDiagnosticIndex', context)).toBeNull();
			if (mode === 'split') {
				for (const module of ['backup', 'qrcode', 'googleMigration']) {
					runInContext(getModuleCode(module), context);
				}
			}
			expect(runInContext('transferDiagnosticIndex', context)).toBeNull();
			const first = '服务"User; 用户 <name>" 已存在';
			expect(context.localizeBackupMessage(first)).toBe(translateServerMessage(first, 'en'));
			const index = runInContext('transferDiagnosticIndex', context);
			expect(index).not.toBeNull();
			for (const [position, source] of SUPPORTED_LANGUAGES.entries()) {
				const target = SUPPORTED_LANGUAGES[(position + 7) % SUPPORTED_LANGUAGES.length];
				context.setLanguage(target);
				const diagnostic = translateServerMessage(first, source);
				const nested = 'WebDAV 推送失败: 密码错误';
				for (const method of ['localizeBackupMessage', 'localizeQRCodeMessage', 'localizeMigrationMessage']) {
					expect(context[method](diagnostic), `${method}/${source}/${target}`).toBe(translateServerMessage(first, target));
					expect(context[method](translateServerMessage(nested, source))).toBe(translateServerMessage(nested, target));
					expect(context[method](LOCALES[source].transferQRParseFailed)).toBe(LOCALES[target].transferQRParseFailed);
					const unknown = 'External detail </script>; 用户 <Name>';
					expect(context[method](unknown)).toBe(unknown);
					expect(runInContext('transferDiagnosticIndex', context)).toBe(index);
				}
			}
		} finally {
			await window.happyDOM.close();
		}
	});

	it('fails explicitly if a feature wrapper is invoked without its core dependency', () => {
		const context = createContext({});
		runInContext(getTransferMessageLocalizerCode('missingCore'), context);
		expect(() => context.missingCore('密码错误')).toThrow('localizeTransferDiagnostic is not defined');
	});
});
