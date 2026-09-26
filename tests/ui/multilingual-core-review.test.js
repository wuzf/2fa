import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../../src/shared/languages.js';
import { localizeDictionary, translateEnglish } from '../../src/shared/locales/index.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { getStandardFormatsCode } from '../../src/ui/scripts/export/formats.js';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { decodeBackupContent } from '../../src/utils/backup-format.js';

function uiContext({
	language = 'en',
	saved = 'auto',
	html = '<html><head><title>2FA</title></head><body></body></html>',
	blocked = false,
} = {}) {
	const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
	window.document.write(html);
	const values = new Map([['language', saved]]);
	const listeners = new Map();
	const context = createContext({
		window: { addEventListener: (event, listener) => listeners.set(event, listener) },
		document: window.document,
		navigator: { language, languages: [language] },
		localStorage: {
			getItem: (key) => {
				if (blocked) {
					throw new Error('Blocked');
				}
				return values.get(key);
			},
			setItem: (key, value) => values.set(key, value),
		},
		performance: { now: () => 0, timeOrigin: 0 },
		console: { log() {}, warn() {}, error() {} },
		URL,
		URLSearchParams,
		Intl,
	});
	runInContext(getI18nCode(), context);
	return { context, document: window.document, values, listeners };
}

describe('independent multilingual core review', () => {
	it('normalizes regional tags with a self-contained registry and translates nested dictionaries without mutating inputs', () => {
		const normalize = runInContext(`(${normalizeLanguage.toString()})`, createContext({}));
		for (const [input, expected] of [
			['ja-JP', 'ja'],
			['ko-KR', 'ko'],
			['pt_PT', 'pt-BR'],
			['in-ID', 'id'],
			['zh-Hant-HK', 'zh-TW'],
			['unsupported', null],
		]) {
			expect(normalize(input)).toBe(expected);
		}
		const original = { nested: ['Incorrect password', { text: 'Generate a code', version: 2 }], enabled: true };
		for (const language of SUPPORTED_LANGUAGES.filter((lang) => !['en', 'zh-CN', 'zh-TW'].includes(lang))) {
			const result = localizeDictionary(language, original);
			expect(result.nested[0]).toBe(translateEnglish(language, 'Incorrect password'));
			expect(result.nested[0]).not.toBe(original.nested[0]);
			expect(result.nested[1]).toEqual({ text: translateEnglish(language, 'Generate a code'), version: 2 });
			expect(result.enabled).toBe(true);
		}
		expect(original.nested[0]).toBe('Incorrect password');
	});

	it('preserves inputs, focus, parameter values and language selection across all 15 main-page languages', async () => {
		const ui = uiContext({ html: await (await createMainPage()).text() });
		const input = ui.document.querySelector('input[type="text"]');
		input.value = 'User 中文 & <script> / untouched';
		input.focus();
		input.setSelectionRange(2, 7);
		const node = ui.document.createElement('span');
		ui.document.body.append(node);
		for (const language of SUPPORTED_LANGUAGES) {
			ui.context.setLanguage(language);
			ui.context.setTranslatedText(node, 'clockMinutesAgo', { count: 'VALUE_<&>_10' });
			expect(node.textContent).toBe(LOCALES[language].clockMinutesAgo.replace('{count}', 'VALUE_<&>_10'));
			expect(ui.document.getElementById('settingsLanguage').value).toBe(language);
			expect(ui.values.get('language')).toBe(language);
			expect(ui.document.activeElement).toBe(input);
			expect(input.selectionStart).toBe(2);
			expect(input.value).toBe('User 中文 & <script> / untouched');
		}
	});

	it('falls back to English with blocked storage and keeps cross-tab and browser language changes consistent', () => {
		expect(uiContext({ language: 'unsupported', blocked: true }).context.getLanguage()).toBe('en');
		const ui = uiContext({ language: 'unsupported' });
		expect(ui.context.getLanguage()).toBe('en');
		ui.values.set('language', 'vi');
		ui.listeners.get('storage')({ key: 'language' });
		expect(ui.context.getLanguage()).toBe('vi');
		ui.values.set('language', 'auto');
		ui.context.navigator.language = 'pt-PT';
		ui.context.navigator.languages = ['pt-PT'];
		ui.listeners.get('storage')({ key: 'language' });
		expect(ui.context.getLanguage()).toBe('pt-BR');
		ui.context.navigator.language = 'unsupported';
		ui.context.navigator.languages = ['unsupported'];
		ui.listeners.get('languagechange')();
		expect(ui.context.getLanguage()).toBe('en');
	});

	it('escapes embedded translation markup without losing literal parameter values', () => {
		const key = 'independentReviewMarkup';
		LOCALES.en[key] = '</script><script>danger()</script> {value}';
		try {
			const code = getI18nCode();
			expect(code).not.toContain('</script>');
			const ui = uiContext();
			expect(ui.context.t(key, { value: 'literal_$&_<value>' })).toBe('</script><script>danger()</script> literal_$&_<value>');
		} finally {
			delete LOCALES.en[key];
		}
	});

	it('formats relative times and sorts service groups with the current locale while retaining group data', () => {
		const ui = uiContext();
		ui.context.SERVICE_LOGOS = SERVICE_LOGOS;
		runInContext(getTimeCode() + getServiceAggregationCode(), ui.context);
		const records = ['Ångström', 'Zulu', 'École', '中文', 'Äther'].flatMap((name, index) => [
			{ id: index + '-1', name },
			{ id: index + '-2', name },
		]);
		ui.context.records = records;
		for (const language of SUPPORTED_LANGUAGES) {
			ui.context.setLanguage(language);
			for (const count of [1, 2, 5]) {
				ui.context.age = count * 60 * 1000;
				expect(runInContext('trustedClock.formatAge(age)', ui.context)).toBe(
					new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(-count, 'minute'),
				);
			}
			const groups = runInContext('groupSecretsByServiceFamily(records, records)', ui.context);
			expect(groups.map((group) => group.name)).toEqual(
				[...new Set(records.map((record) => record.name))].sort((a, b) =>
					a.localeCompare(b, language, { numeric: true, sensitivity: 'base' }),
				),
			);
			expect(
				groups
					.flatMap((group) => group.items)
					.map((item) => item.id)
					.sort(),
			).toEqual(records.map((item) => item.id).sort());
		}
	});

	it.each(['legacy', 'split'])('round-trips every %s CSV exporter language through the independent backup codec', async (mode) => {
		const ui = uiContext();
		const download = vi.fn(async () => true);
		runInContext(getUtilsCode() + (mode === 'legacy' ? getExportCode() : getStandardFormatsCode()), ui.context);
		ui.context.downloadFile = download;
		ui.context.showExportSuccess = vi.fn();
		ui.context.getDateString = () => '2026-09-24';
		const records = [
			{
				name: '原文,"quoted"',
				account: 'name+tag@example.com',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 8,
				period: 60,
				algorithm: 'SHA256',
			},
		];
		for (const language of SUPPORTED_LANGUAGES) {
			ui.context.setLanguage(language);
			await ui.context.exportAsCSV(records);
			const csv = download.mock.calls.at(-1)[0];
			expect(decodeBackupContent(csv, 'csv', { strict: true }).secrets).toEqual([expect.objectContaining(records[0])]);
		}
	});
});
