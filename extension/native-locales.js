import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_OPTIONS } from '../src/shared/languages.js';
import { localizeDictionary } from '../src/shared/locales/index.js';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const englishMessages = JSON.parse(readFileSync(join(extensionDir, '_locales', 'en', 'messages.json'), 'utf8'));

export function createNativeLocale(language) {
	const option = LANGUAGE_OPTIONS.find((entry) => entry.value === language);
	if (!option) {
		throw new Error(`Unsupported extension language: ${language}`);
	}
	const source = join(extensionDir, '_locales', option.nativeLocale, 'messages.json');
	return existsSync(source) ? JSON.parse(readFileSync(source, 'utf8')) : localizeDictionary(language, englishMessages);
}

export function writeNativeLocales(outdir) {
	for (const { value, nativeLocale } of LANGUAGE_OPTIONS) {
		const directory = join(outdir, '_locales', nativeLocale);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, 'messages.json'), `${JSON.stringify(createNativeLocale(value), null, '\t')}\n`);
	}
}
