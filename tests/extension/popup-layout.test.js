import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const POPUP_CSS = readFileSync(resolve(process.cwd(), 'extension/src/popup/popup.css'), 'utf8');

/** Declarations of the rule whose selector list is exactly `selector`, later rules overriding earlier ones. */
function declarations(selector) {
	const result = {};
	const css = POPUP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (selectors.trim() !== selector) {
			continue;
		}
		for (const declaration of body.split(';')) {
			const [property, ...value] = declaration.split(':');
			if (property.trim()) {
				result[property.trim()] = value.join(':').trim();
			}
		}
	}
	return result;
}

// jsdom has no layout, so these lock the rules that keep a long remember label
// (a long account name, or a long language such as German) on the switch row.
describe('Popup fill preferences layout', () => {
	it('lets the remember label shrink to nothing so it always fits beside the autofill switch', () => {
		expect(declarations('.fill-preference:has(#remember-binding)')).toMatchObject({ flex: '1 1 0', 'min-width': '0' });
		expect(declarations('.fill-preference:has(#autofill-site)')).toMatchObject({ 'flex-shrink': '0' });
	});

	it('cuts the remember text with an ellipsis on a single line', () => {
		expect(declarations('#remember-title')).toMatchObject({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis' });
		expect(declarations('.fill-preference')).toMatchObject({ 'white-space': 'nowrap' });
	});

	it('never lets a language override put the switches back on separate lines', () => {
		for (const [, selector, body] of POPUP_CSS.matchAll(/([^{}]*fill-preference[^{}]*)\{([^{}]*)\}/g)) {
			expect(`${selector.trim()} { ${body.trim()} }`).not.toMatch(/white-space:\s*normal|flex-basis:\s*100%.*#(remember|autofill)/);
		}
	});
});
