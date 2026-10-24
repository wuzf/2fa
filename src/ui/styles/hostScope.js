import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';

const EXCLUSION = ':where(:not(#appThemeRoot,#appThemeRoot *))';
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/** Keep host chrome outside the independent application surface without increasing specificity. */
export function scopeHostStyles(source) {
	const ast = parse(source);
	const exclusion = parse(EXCLUSION, { context: 'selector' }).children.first;
	let keyframes = 0;
	walk(ast, {
		enter(node) {
			if (node.type === 'Atrule' && /^(?:-\w+-)?keyframes$/i.test(node.name)) {
				keyframes += 1;
			}
			if (node.type !== 'Rule' || keyframes) {
				return;
			}
			if (node.prelude?.type !== 'SelectorList') {
				throw new Error('Cannot isolate an invalid host CSS selector');
			}
			node.prelude.children.forEach((selector) => {
				// Apply the exclusion to the selector's subject, before a pseudo-element.
				// Ancestor selectors (:root/body/.fluent-app) must retain their old meaning.
				let pseudoElement = null;
				selector.children.forEach((part, item) => {
					if (part.type === 'Combinator') {
						pseudoElement = null;
					} else if (
						!pseudoElement &&
						(part.type === 'PseudoElementSelector' ||
							(part.type === 'PseudoClassSelector' && LEGACY_PSEUDO_ELEMENTS.has(part.name.toLowerCase())))
					) {
						pseudoElement = item;
					}
				});
				selector.children.insertData(exclusion, pseudoElement);
			});
		},
		leave(node) {
			if (node.type === 'Atrule' && /^(?:-\w+-)?keyframes$/i.test(node.name)) {
				keyframes -= 1;
			}
		},
	});
	// Inherited host font, color, alignment, etc. stop at the mount boundary.
	// Zero specificity lets a theme style its supplied root as well as its children.
	// CSS custom properties intentionally remain available as optional public tokens.
	return generate(ast) + '\n:where(#appThemeRoot){all:initial;display:block}' + '\n#appThemeRoot[hidden]{display:none!important}';
}
