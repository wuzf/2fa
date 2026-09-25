/**
 * Request-scoped localization for API diagnostics. Stored/user data is never translated.
 * Existing callers without a language preference retain the original Chinese contract.
 */
import { serverMessages, getServerTranslations } from './server-messages.js';
import { normalizeLanguage, FALLBACK_LANGUAGE } from '../shared/languages.js';
export { normalizeLanguage } from '../shared/languages.js';

/** X-Language > lang/language URL parameter > weighted Accept-Language > fallback. */
export function getRequestLanguage(request, fallback = 'zh-CN') {
	const explicit = request?.headers?.get?.('X-Language');
	if (typeof explicit === 'string') {
		return normalizeLanguage(explicit) || FALLBACK_LANGUAGE;
	}
	if (request?.url) {
		try {
			const params = new URL(request.url).searchParams;
			const query = params.has('lang') ? params.get('lang') : params.get('language');
			if (query !== null) {
				return normalizeLanguage(query) || FALLBACK_LANGUAGE;
			}
		} catch {
			/* A partial request object is supported by utility callers. */
		}
	}
	const browserPreference = request?.headers?.get?.('Accept-Language') || '';
	const languages = browserPreference
		.split(',')
		.map((entry, index) => {
			const [tag, ...parameters] = entry.trim().split(';');
			const quality = parameters.find((parameter) => /^\s*q\s*=/i.test(parameter));
			const q = quality ? Number(quality.split('=')[1]) : 1;
			return { language: normalizeLanguage(tag), q, index };
		})
		.filter(({ language, q }) => language && Number.isFinite(q) && q > 0 && q <= 1)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	return languages[0]?.language || (browserPreference ? FALLBACK_LANGUAGE : normalizeLanguage(fallback) || FALLBACK_LANGUAGE);
}

const exactMessages = new Map();
const templates = [];
for (const row of serverMessages) {
	const source = row[0];
	const translations = getServerTranslations(row);
	const placeholders = [...source.matchAll(/\{(\w+)\}/g)];
	if (!placeholders.length) {
		exactMessages.set(source, translations);
		continue;
	}
	let offset = 0;
	let pattern = '^';
	for (const match of placeholders) {
		pattern += source.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]*?)';
		offset = match.index + match[0].length;
	}
	pattern += source.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
	templates.push({ pattern: new RegExp(pattern), placeholders: placeholders.map((match) => match[1]), translations });
}

/** Translate known full messages/templates only; dynamic user values remain verbatim. */
export function translateServerMessage(message, language = 'zh-CN') {
	const locale = normalizeLanguage(language) || FALLBACK_LANGUAGE;
	if (typeof message !== 'string' || locale === 'zh-CN') {
		return message;
	}
	const exact = exactMessages.get(message);
	if (exact) {
		return exact[locale];
	}
	// Only split a list if every fragment is a diagnostic, so punctuation in user values is preserved.
	for (const separator of ['; ', '；']) {
		if (!message.includes(separator)) {
			continue;
		}
		const originals = message.split(separator);
		const parts = originals.map((part) => translateServerMessage(part, locale));
		if (parts.every((part, index) => part !== originals[index])) {
			// Some translations end each reason with a full stop; drop it so the joined list does not read ".;".
			return parts.map((part) => part.replace(/[.。]+$/u, '')).join(locale.startsWith('zh') ? '；' : '; ');
		}
	}
	for (const { pattern, placeholders, translations } of templates) {
		const match = pattern.exec(message);
		if (!match) {
			continue;
		}
		return translations[locale].replace(/\{(\w+)\}/g, (_, key) => {
			const value = match[placeholders.indexOf(key) + 1] ?? '';
			return key === 'message' ? translateServerMessage(value, locale) : value;
		});
	}
	return message;
}

const messageFields = new Set(['message', 'error', 'warning', 'hint', 'originalError', 'expiresIn']);
const messageListFields = new Set(['warnings', 'errors', 'unsupportedWarnings']);
const containerFields = new Set(['data', 'details', 'results', 'syncResult', 'testResult', 'destinations', 'status', 'lastError']);

export function localizeResponseData(data, requestOrLanguage = null) {
	const language =
		typeof requestOrLanguage === 'string'
			? normalizeLanguage(requestOrLanguage) || FALLBACK_LANGUAGE
			: getRequestLanguage(requestOrLanguage);
	if (!language || language === 'zh-CN' || !data || typeof data !== 'object' || Array.isArray(data)) {
		return data;
	}
	const result = { ...data };
	for (const [key, value] of Object.entries(data)) {
		if (messageFields.has(key) && typeof value === 'string') {
			result[key] = translateServerMessage(value, language);
		} else if (messageListFields.has(key) && Array.isArray(value)) {
			result[key] = value.map((item) =>
				typeof item === 'string' ? translateServerMessage(item, language) : localizeResponseData(item, language),
			);
		} else if (containerFields.has(key) && value && typeof value === 'object') {
			result[key] = Array.isArray(value)
				? value.map((item) => localizeResponseData(item, language))
				: localizeResponseData(value, language);
		}
	}
	return result;
}

export function getLanguageHeaders(request) {
	return { 'Content-Language': getRequestLanguage(request), Vary: 'Origin, X-Language, Accept-Language' };
}
