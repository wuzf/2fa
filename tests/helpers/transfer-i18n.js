import { LOCALES } from '../../src/ui/locales/index.js';

export function transferI18n(language = 'zh-CN') {
	const t = (key, params = {}) => {
		const value = LOCALES[language]?.[key] ?? LOCALES['zh-CN'][key] ?? key;
		return value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
	};
	return {
		t,
		getLanguage: () => language,
		formatI18nDate: (date, options) => new Date(date).toLocaleString(language === 'en' ? 'en-US' : language, options),
		setTranslatedText: (element, key, params) => {
			if (element) {
				element.textContent = t(key, params);
			}
		},
	};
}
