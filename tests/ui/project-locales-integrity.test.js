import { describe, expect, it } from 'vitest';
import { LOCALES as WEB_LOCALES } from '../../src/ui/locales/index.js';
import { LOCALES as EXTENSION_LOCALES } from '../../extension/src/locales/index.js';
import { BACKUP_DOCUMENT_LOCALES } from '../../src/utils/backup-locales.js';
import { OFFLINE_MESSAGES } from '../../src/ui/locales/offline.js';
import { serverMessages } from '../../src/utils/server-messages.js';
import { EXTRA_TRANSLATIONS } from '../../src/shared/locales/index.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { createNativeLocale } from '../../extension/native-locales.js';

function strings(value) {
	return typeof value === 'string' ? [value] : Object.values(value).flatMap(strings);
}

// Collect from the authoritative English domains, not from derived dictionaries:
// a runtime fallback must never make a missing translation pass this check.
const sources = [
	...new Set(
		strings([
			WEB_LOCALES.en,
			EXTENSION_LOCALES.en,
			BACKUP_DOCUMENT_LOCALES.en,
			OFFLINE_MESSAGES.en,
			serverMessages.map((row) => row[2]),
			createNativeLocale('en'),
		]),
	),
];
const matches = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[0]).sort();
const unchangedWords = new Set([
	'OK',
	'Error',
	'Type',
	'System',
	'Migration',
	'Code',
	'Documentation',
	'Actions',
	'Service',
	'Account',
	'Universal',
	'繁體中文',
	'简体中文',
	'JSON',
	'2FA JSON',
	'Name Z-A',
	'2fa-backup/ (optional)',
	'Chrome Web Store',
	'Edge Add-ons',
	'Firefox Add-ons',
	'Format:',
	'Format: ',
	'Padding:',
	'Total: ',
	'{count} total',
	'{count} s',
	'{connection} · {count} account{unavailable}',
]);

describe('project-wide source translation integrity', () => {
	it('has one complete catalogue for every added language', () => {
		expect(Object.keys(EXTRA_TRANSLATIONS).sort()).toEqual(
			SUPPORTED_LANGUAGES.filter((language) => !['zh-CN', 'zh-TW', 'en'].includes(language)).sort(),
		);
		expect(sources.length).toBeGreaterThan(1600);
	});

	describe.each(Object.entries(EXTRA_TRANSLATIONS))('%s', (language, dictionary) => {
		it('covers every English source without empty translations or untranslated sentences', () => {
			for (const source of sources) {
				expect(Object.hasOwn(dictionary, source), `${language}: ${source}`).toBe(true);
				const value = dictionary[source];
				expect(typeof value, source).toBe('string');
				if (source.trim()) {
					expect(value.trim(), source).not.toBe('');
				}
				if (/[A-Za-z]/.test(source.replace(/\{\w+\}/g, '')) && !unchangedWords.has(source)) {
					expect(value, source).not.toBe(source);
				}
			}
		});

		it('preserves placeholders, markup, whitespace and technical identifiers', () => {
			for (const source of sources) {
				const value = dictionary[source];
				expect(typeof value, source).toBe('string');
				expect(matches(value, /\{\w+\}/g), source).toEqual(matches(source, /\{\w+\}/g));
				expect(value.match(/<\/?[a-zA-Z][^>]*>/g) || [], source).toEqual(source.match(/<\/?[a-zA-Z][^>]*>/g) || []);
				// The list suffix starts with a comma in English; a language without it still needs the separating space.
				if (!(source === ', and others' && /^ \S/.test(value))) {
					expect(value.match(/^\s*/)[0], source).toBe(source.match(/^\s*/)[0]);
				}
				expect(value.match(/\s*$/)[0], source).toBe(source.match(/\s*$/)[0]);
				expect(matches(value, /\n/g).length, source).toBe(matches(source, /\n/g).length);
				expect(value, source).not.toMatch(/\uFFFD/);
				for (const token of [
					'2fa-backup/',
					'backup_',
					'storage.{area}',
					'expectedSecret',
					'wrangler',
					'JWT_SECRET',
					'ENCRYPTION_KEY',
					'JBSWY3DPEHPK3PXP',
					'Microsoft Graph',
					'MinIO',
				]) {
					if (source.includes(token)) {
						expect(value, `${source}: ${token}`).toContain(token);
					}
				}
			}
		});
	});
});
