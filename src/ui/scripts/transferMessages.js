import { serverMessages, getServerTranslations } from '../../utils/server-messages.js';
import { LOCALES } from '../locales/index.js';

let sharedCode;

/** One shared diagnostic catalog for the core; lazy modules keep only their public wrappers. */
export function getSharedTransferMessageLocalizerCode() {
	if (sharedCode) {
		return sharedCode;
	}
	const translations = serverMessages
		.filter(([source]) =>
			/备份|密钥|导入|导出|还原|恢复|Base32|文件|服务|计数器|算法|位数|周期|解密|加密|解析|字段|失败|错误|无效/.test(source),
		)
		.map(getServerTranslations);
	const uiKeys = Object.keys(LOCALES.en).filter(
		(key) => key.startsWith('transfer') || key.startsWith('restore') || key.startsWith('qrLibrary') || key === 'qrGenerationFailed',
	);
	sharedCode = `
    let transferDiagnosticIndex = null;
    function getTransferDiagnosticIndex() {
      if (transferDiagnosticIndex) return transferDiagnosticIndex;
      // UI messages already exist in the main language catalog. Keep references,
      // not another serialized copy in each dynamically loaded feature.
      const translations = ${JSON.stringify(translations).replace(/</g, '\\u003c')};
      for (const key of ${JSON.stringify(uiKeys)}) {
        translations.push(Object.fromEntries(Object.entries(I18N_LOCALES).map(([language, dictionary]) => [language, dictionary[key]])));
      }
      const exact = new Map();
      const templates = [];
      const escapePattern = value => Array.from(value).map(character => '\\\\^$.*+?()[]{}|'.includes(character) ? '\\\\' + character : character).join('');
      for (const messages of translations) {
        for (const message of new Set(Object.values(messages))) {
          const parameters = [...message.matchAll(/\\{(\\w+)\\}/g)];
          if (!parameters.length) {
            if (!exact.has(message)) exact.set(message, messages);
            continue;
          }
          let position = 0;
          let pattern = '^';
          for (const parameter of parameters) {
            pattern += escapePattern(message.slice(position, parameter.index)) + '([\\\\s\\\\S]*?)';
            position = parameter.index + parameter[0].length;
          }
          templates.push({
            regex: new RegExp(pattern + escapePattern(message.slice(position)) + '$'),
            parameters: parameters.map(parameter => parameter[1]),
            messages,
          });
        }
      }
      transferDiagnosticIndex = { exact, templates };
      return transferDiagnosticIndex;
    }

    function localizeTransferDiagnostic(message, depth = 0) {
      if (typeof message !== 'string' || depth > 4) return message;
      const { exact, templates } = getTransferDiagnosticIndex();
      const language = getLanguage();
      const translated = messages => messages[language] || messages.en;
      if (exact.has(message)) return translated(exact.get(message));
      // Only split a list if each complete fragment is a known diagnostic.
      // Punctuation in account/service names stays inside its template value.
      const listParts = message.split(/(; |；)/);
      if (listParts.length > 1 && listParts.every((part, index) => index % 2 || exact.has(part) || templates.some(entry => entry.regex.test(part)))) {
        return listParts.map((part, index) => index % 2 ? part : localizeTransferDiagnostic(part, depth + 1)).join('');
      }
      for (const entry of templates) {
        const match = entry.regex.exec(message);
        if (!match) continue;
        return translated(entry.messages).replace(/\\{(\\w+)\\}/g, (_, key) => {
          const value = match[entry.parameters.indexOf(key) + 1] || '';
          return key === 'message' || key === 'error' ? localizeTransferDiagnostic(value, depth + 1) : value;
        });
      }
      return message;
    }
  `;
	return sharedCode;
}

/** Preserve the existing feature API while requiring the core's shared dependency. */
export function getTransferMessageLocalizerCode(functionName) {
	return `
    function ${functionName}(message, depth = 0) {
      return localizeTransferDiagnostic(message, depth);
    }
  `;
}
