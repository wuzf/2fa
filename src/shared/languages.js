/** Language registry shared by the web app, API, exports and browser extensions. */
export const LANGUAGE_OPTIONS = Object.freeze(
	[
		{ value: 'zh-CN', label: '简体中文', nativeLocale: 'zh_CN' },
		{ value: 'zh-TW', label: '繁體中文', nativeLocale: 'zh_TW' },
		{ value: 'en', label: 'English', nativeLocale: 'en' },
		{ value: 'ja', label: '日本語', nativeLocale: 'ja' },
		{ value: 'ko', label: '한국어', nativeLocale: 'ko' },
		{ value: 'de', label: 'Deutsch', nativeLocale: 'de' },
		{ value: 'fr', label: 'Français', nativeLocale: 'fr' },
		{ value: 'es', label: 'Español', nativeLocale: 'es' },
		{ value: 'pt-BR', label: 'Português (Brasil)', nativeLocale: 'pt_BR' },
		{ value: 'it', label: 'Italiano', nativeLocale: 'it' },
		{ value: 'ru', label: 'Русский', nativeLocale: 'ru' },
		{ value: 'tr', label: 'Türkçe', nativeLocale: 'tr' },
		{ value: 'id', label: 'Bahasa Indonesia', nativeLocale: 'id' },
		{ value: 'vi', label: 'Tiếng Việt', nativeLocale: 'vi' },
		{ value: 'th', label: 'ไทย', nativeLocale: 'th' },
	].map((option) => Object.freeze(option)),
);

export const SUPPORTED_LANGUAGES = Object.freeze(LANGUAGE_OPTIONS.map((option) => option.value));
export const LANGUAGE_PREFERENCES = Object.freeze(['auto', ...SUPPORTED_LANGUAGES]);
export const FALLBACK_LANGUAGE = 'en';

// This function is also serialized into standalone documents. Keep it free of
// module dependencies so bundled/minified Workers can safely embed its source.
export function normalizeLanguage(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const tag = value.trim().toLowerCase().replace(/_/g, '-');
	if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(tag)) {
		return 'zh-TW';
	}
	if (/^zh(?:-|$)/.test(tag)) {
		return 'zh-CN';
	}
	const base = tag.split('-')[0];
	const codes = {
		en: 'en',
		ja: 'ja',
		ko: 'ko',
		de: 'de',
		fr: 'fr',
		es: 'es',
		pt: 'pt-BR',
		it: 'it',
		ru: 'ru',
		tr: 'tr',
		id: 'id',
		in: 'id',
		vi: 'vi',
		th: 'th',
	};
	return Object.prototype.hasOwnProperty.call(codes, base) ? codes[base] : null;
}
