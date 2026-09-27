import { LOCALES } from '../locales/index.js';
import { PLURAL_OVERRIDES } from '../locales/plural-overrides.js';
import {
	SUPPORTED_LANGUAGES,
	LANGUAGE_PREFERENCES,
	LANGUAGE_OPTIONS,
	normalizeLanguage,
	FALLBACK_LANGUAGE,
} from '../../../src/shared/languages.js';

export { SUPPORTED_LANGUAGES, LANGUAGE_PREFERENCES, LANGUAGE_OPTIONS, normalizeLanguage };
let preference = 'auto';
// Pure module consumers use the historical default until a browser context initializes.
let language = 'zh-CN';
let revision = 0;
let saveSequence = 0;
const listeners = new Set();
const roots = new Map();
const runtimes = new Map();
const invalidatedRuntimes = new WeakMap();

export function getBrowserLanguage() {
	try {
		return globalThis.chrome?.i18n?.getUILanguage?.() || FALLBACK_LANGUAGE;
	} catch {
		return FALLBACK_LANGUAGE;
	}
}

export function resolveLanguage(value, browserLanguage = getBrowserLanguage()) {
	return (value !== 'auto' && normalizeLanguage(value)) || normalizeLanguage(browserLanguage) || FALLBACK_LANGUAGE;
}

export function getLanguage() {
	return language;
}
export function getLanguagePreference() {
	return preference;
}

function hasKey(key) {
	return typeof key === 'string' && Object.hasOwn(LOCALES[FALLBACK_LANGUAGE], key);
}

export function t(key, params = {}, selectedLanguage = language) {
	const dictionary = LOCALES[normalizeLanguage(selectedLanguage) || FALLBACK_LANGUAGE];
	const value = Object.hasOwn(dictionary, key)
		? dictionary[key]
		: Object.hasOwn(LOCALES[FALLBACK_LANGUAGE], key)
			? LOCALES[FALLBACK_LANGUAGE][key]
			: key;
	return String(value).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params || {}, name) ? String(params[name]) : match));
}

const pluralRules = new Map();
export function pluralCategory(count, selectedLanguage = language) {
	const locale = normalizeLanguage(selectedLanguage) || FALLBACK_LANGUAGE;
	if (!pluralRules.has(locale)) {
		pluralRules.set(locale, new Intl.PluralRules(locale));
	}
	return pluralRules.get(locale).select(Number(count));
}

export function tPlural(key, count, params = {}, oneKey = `${key}One`) {
	const category = pluralCategory(count);
	const override = PLURAL_OVERRIDES[language]?.[key]?.[category];
	const values = { count, ...params };
	if (override) {
		return override.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(values, name) ? String(values[name]) : match));
	}
	return t(category === 'one' && hasKey(oneKey) ? oneKey : key, values);
}

export function formatDate(value, options = {}) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	return date.toLocaleString(language === 'en' ? 'en-US' : language, options);
}

export function localizeError(error, fallbackKey = 'errorUnknown') {
	const key = error?.i18nKey || error?.messageKey;
	if (hasKey(key)) {
		return t(key, error?.params || error?.i18nParams || {});
	}
	const message = typeof error === 'string' ? error : error?.message;
	if (typeof message === 'string') {
		// Only whole known diagnostics are translated. User names, URLs and arbitrary
		// external details are never passed through a substring replacement engine.
		for (const dictionary of Object.values(LOCALES)) {
			const found = Object.keys(dictionary).find((candidate) => dictionary[candidate] === message);
			if (found) {
				return t(found);
			}
		}
	}
	const codeKey = 'error_' + error?.code;
	if (hasKey(codeKey)) {
		return t(codeKey, error?.params || {});
	}
	return typeof message === 'string' && message ? message : t(fallbackKey);
}

function elements(root, selector) {
	const found = Array.from(root?.querySelectorAll?.(selector) || []);
	if (root?.matches?.(selector)) {
		found.unshift(root);
	}
	return found;
}

export function applyTranslations(root = globalThis.document) {
	if (!root) {
		return;
	}
	for (const element of elements(root, '[data-i18n]')) {
		let params = {};
		try {
			params = JSON.parse(element.getAttribute('data-i18n-params') || '{}');
		} catch {
			/* Invalid metadata must not prevent other translations. */
		}
		element.textContent = t(element.getAttribute('data-i18n'), params);
	}
	for (const attribute of ['title', 'placeholder', 'aria-label', 'alt']) {
		for (const element of elements(root, '[data-i18n-' + attribute + ']')) {
			element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + attribute)));
		}
	}
	for (const template of elements(root, 'template')) {
		applyTranslations(template.content);
	}
	// Content scripts initialize with root:null or their own ShadowRoot. Never
	// change the language or the contents of the website hosting the extension.
	if (root.nodeType === 9 && root.documentElement) {
		root.documentElement.lang = language;
	}
}

export function setLanguage(value, { resolvedLanguage } = {}) {
	const nextPreference = LANGUAGE_PREFERENCES.includes(value) ? value : 'auto';
	const nextLanguage =
		nextPreference === 'auto' && SUPPORTED_LANGUAGES.includes(resolvedLanguage) ? resolvedLanguage : resolveLanguage(nextPreference);
	const changed = nextPreference !== preference || nextLanguage !== language;
	preference = nextPreference;
	language = nextLanguage;
	revision += 1;
	if (changed) {
		for (const root of roots.keys()) {
			applyTranslations(root);
		}
		for (const listener of [...listeners]) {
			listener(language, preference);
		}
	}
	return language;
}

export function onLanguageChange(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function isInvalidated(runtime, error) {
	try {
		return (
			/extension context invalidated|extension (?:was |has been |is )?(?:unloaded|removed|disabled)/i.test(error?.message || '') ||
			(runtime && 'id' in runtime && !runtime.id)
		);
	} catch {
		return true;
	}
}

function acquireRuntime(runtime) {
	if (!runtime) {
		return { binding: null, release: () => {} };
	}
	if (invalidatedRuntimes.has(runtime)) {
		throw invalidatedRuntimes.get(runtime);
	}
	let binding = runtimes.get(runtime);
	if (!binding) {
		const listener = (message, sender) => {
			if (message?.type !== 'LANGUAGE_CHANGED' || !LANGUAGE_PREFERENCES.includes(message.preference)) {
				return;
			}
			if (sender?.tab || (runtime.id && sender?.id !== runtime.id)) {
				return;
			}
			setLanguage(message.preference, { resolvedLanguage: message.language });
			// No storage writes and no replies: this message is a background notification.
		};
		binding = { listener, count: 0, initialization: null };
		runtimes.set(runtime, binding);
		try {
			runtime.onMessage?.addListener?.(listener);
		} catch (error) {
			runtimes.delete(runtime);
			if (isInvalidated(runtime, error)) {
				invalidatedRuntimes.set(runtime, error);
			}
			throw error;
		}
	}
	binding.count += 1;
	return {
		binding,
		release: () => {
			binding.count -= 1;
			if (binding.count === 0) {
				try {
					runtime.onMessage?.removeListener?.(binding.listener);
				} catch {
					/* Unloaded contexts still need to release all local state. */
				} finally {
					runtimes.delete(runtime);
				}
			}
		},
	};
}

/** Initialize one extension UI surface. The returned callback releases its listeners. */
export async function initI18n({ root = globalThis.document, runtime = globalThis.chrome?.runtime } = {}) {
	const { binding, release: releaseRuntime } = acquireRuntime(runtime);
	if (root) {
		roots.set(root, (roots.get(root) || 0) + 1);
	}
	let released = false;
	const dispose = () => {
		if (released) {
			return;
		}
		released = true;
		releaseRuntime();
		if (root) {
			const count = roots.get(root) || 0;
			if (count <= 1) {
				roots.delete(root);
			} else {
				roots.set(root, count - 1);
			}
		}
	};
	if (resolveLanguage(preference) !== language) {
		setLanguage(preference);
	}
	if (root) {
		applyTranslations(root);
	}
	try {
		if (binding && !binding.initialization) {
			const startedAt = revision;
			binding.initialization = (async () => {
				try {
					const response = await Promise.resolve().then(() => runtime.sendMessage?.({ type: 'GET_LANGUAGE' }));
					if (revision === startedAt && response?.ok && LANGUAGE_PREFERENCES.includes(response.data?.preference)) {
						setLanguage(response.data.preference, { resolvedLanguage: response.data.language });
					}
				} catch (error) {
					if (isInvalidated(runtime, error)) {
						invalidatedRuntimes.set(runtime, error);
						throw error;
					}
					// A restarted background worker can be retried by a later UI surface.
					binding.initialization = null;
				}
			})();
		}
		await binding?.initialization;
		if (runtime && invalidatedRuntimes.has(runtime)) {
			throw invalidatedRuntimes.get(runtime);
		}
	} catch (error) {
		dispose();
		throw error;
	}
	return dispose;
}

export async function setLanguagePreference(value, { runtime = globalThis.chrome?.runtime } = {}) {
	if (!LANGUAGE_PREFERENCES.includes(value)) {
		throw Object.assign(new Error(t('languageInvalid')), { i18nKey: 'languageInvalid' });
	}
	const sequence = ++saveSequence;
	const response = await runtime?.sendMessage?.({ type: 'SAVE_LANGUAGE', preference: value });
	if (!response?.ok || !LANGUAGE_PREFERENCES.includes(response.data?.preference)) {
		throw Object.assign(
			new Error(response?.error?.message || t('languageSaveFailed')),
			response?.error || { i18nKey: 'languageSaveFailed' },
		);
	}
	if (sequence === saveSequence) {
		setLanguage(response.data.preference, { resolvedLanguage: response.data.language });
	}
	return response.data;
}
