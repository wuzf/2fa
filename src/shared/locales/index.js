import ja from './ja.json' with { type: 'json' };
import ko from './ko.json' with { type: 'json' };
import de from './de.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import ptBR from './pt-BR.json' with { type: 'json' };
import it from './it.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };
import tr from './tr.json' with { type: 'json' };
import id from './id.json' with { type: 'json' };
import vi from './vi.json' with { type: 'json' };
import th from './th.json' with { type: 'json' };

/** Shared translations keyed by the exact English source message (gettext style). */
export const EXTRA_TRANSLATIONS = Object.freeze({ ja, ko, de, fr, es, 'pt-BR': ptBR, it, ru, tr, id, vi, th });

export function translateEnglish(language, text) {
	if (typeof text !== 'string') {
		return text;
	}
	const dictionary = EXTRA_TRANSLATIONS[language];
	return dictionary && Object.hasOwn(dictionary, text) ? dictionary[text] : text;
}

/** Derive domain-specific keys without duplicating translations between products. */
export function localizeDictionary(language, dictionary) {
	if (Array.isArray(dictionary)) {
		return dictionary.map((value) => localizeDictionary(language, value));
	}
	if (dictionary && typeof dictionary === 'object') {
		return Object.fromEntries(Object.entries(dictionary).map(([key, value]) => [key, localizeDictionary(language, value)]));
	}
	return translateEnglish(language, dictionary);
}
