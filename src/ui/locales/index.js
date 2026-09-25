import { zhCN } from './zh-CN.js';
import { zhTW } from './zh-TW.js';
import { en } from './en.js';
import { WORKSPACE_LOCALES } from './workspace.js';
import { TOOLS_LOCALES } from './tools.js';
import { SETTINGS_LOCALES } from './settings.js';
import { STANDALONE_LOCALES } from './standalone.js';
import { TRANSFER_LOCALES } from './transfer.js';
import { CORE_LOCALES } from './core.js';
import { SUPPORTED_LANGUAGES } from '../../shared/languages.js';
import { localizeDictionary } from '../../shared/locales/index.js';

for (const [language, dictionary] of Object.entries({ 'zh-CN': zhCN, 'zh-TW': zhTW, en })) {
	Object.assign(
		dictionary,
		WORKSPACE_LOCALES[language],
		CORE_LOCALES[language],
		TOOLS_LOCALES[language],
		SETTINGS_LOCALES[language],
		STANDALONE_LOCALES[language],
		TRANSFER_LOCALES[language],
	);
}

export const LOCALES = {
	'zh-CN': zhCN,
	'zh-TW': zhTW,
	en: en,
};

for (const language of SUPPORTED_LANGUAGES) {
	if (!Object.hasOwn(LOCALES, language)) {
		LOCALES[language] = localizeDictionary(language, en);
	}
}

export { zhCN, zhTW, en };
