import { POPUP_LOCALES } from './popup.js';
import { OPTIONS_LOCALES } from './options.js';
import { CONTENT_LOCALES } from './content.js';
import { ERROR_LOCALES } from './errors.js';
import { SUPPORTED_LANGUAGES } from '../../../src/shared/languages.js';
import { localizeDictionary } from '../../../src/shared/locales/index.js';

const COMMON_LOCALES = {
	'zh-CN': { errorUnknown: '操作失败，请重试', languageInvalid: '请选择支持的语言', languageSaveFailed: '语言偏好保存失败，请重试' },
	'zh-TW': { errorUnknown: '操作失敗，請重試', languageInvalid: '請選擇支援的語言', languageSaveFailed: '語言偏好儲存失敗，請重試' },
	en: {
		errorUnknown: 'Operation failed. Please retry.',
		languageInvalid: 'Choose a supported language',
		languageSaveFailed: 'Could not save the language preference. Please retry.',
	},
};
const BASE_LOCALES = Object.freeze(
	Object.fromEntries(
		Object.keys(COMMON_LOCALES).map((language) => [
			language,
			Object.freeze({
				...COMMON_LOCALES[language],
				...POPUP_LOCALES[language],
				...OPTIONS_LOCALES[language],
				...CONTENT_LOCALES[language],
				...ERROR_LOCALES[language],
			}),
		]),
	),
);

export const LOCALES = Object.freeze(
	Object.fromEntries(
		SUPPORTED_LANGUAGES.map((language) => [
			language,
			BASE_LOCALES[language] || Object.freeze(localizeDictionary(language, BASE_LOCALES.en)),
		]),
	),
);
