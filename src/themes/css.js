import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import { LIMITS, ThemeError, invariant, utf8Size } from './schema.js';

function decodeIdentifier(value) {
	return value.replace(/\\([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/g, (_, hex, char) => {
		if (!hex) {
			return char;
		}
		const point = Number.parseInt(hex, 16);
		return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
	});
}

function parseCss(css, context) {
	invariant(utf8Size(css) <= LIMITS.cssBytes, 'THEME_CSS_LIMIT');
	try {
		return parse(css, {
			context,
			positions: true,
			parseCustomProperty: true,
			onParseError(error) {
				throw error;
			},
		});
	} catch (error) {
		throw new ThemeError('THEME_INVALID_CSS', { line: error.line, column: error.column });
	}
}

/** Every CSS entry uses the same AST transformation, including tokens and user overrides. */
export async function normalizeCss(css, resolver, { source = 'theme.css', depth = 0, stack = [], context = 'stylesheet' } = {}) {
	invariant(depth <= LIMITS.cssDepth, 'THEME_CSS_DEPTH');
	invariant(!stack.includes(source), 'THEME_DEPENDENCY_CYCLE', { source });
	const ast = parseCss(css, context);
	const imports = [];
	const refs = [];
	const functionStack = [];
	walk(ast, {
		enter(node, item, list) {
			const location = node.loc ? { line: node.loc.start.line, column: node.loc.start.column } : {};
			invariant(node.type !== 'Raw', 'THEME_UNRESOLVED_CSS', location);
			if (node.type === 'Declaration') {
				node.property = decodeIdentifier(node.property);
				invariant(!/^(?:behavior|-moz-binding)$/i.test(node.property), 'THEME_UNRESOLVED_CSS', location);
			}
			if (node.type === 'Atrule') {
				node.name = decodeIdentifier(node.name).toLowerCase();
				invariant(node.name !== 'namespace' && node.name !== 'document' && node.name !== '-moz-document', 'THEME_UNRESOLVED_CSS', location);
				if (node.name === 'charset') {
					list.remove(item);
					return this.skip;
				}
				if (node.name === 'import') {
					invariant(context === 'stylesheet' && node.prelude && !node.block, 'THEME_INVALID_CSS', location);
					const children = node.prelude.children.toArray();
					const target = children.shift();
					invariant(target && ['String', 'Url'].includes(target.type), 'THEME_UNRESOLVED_CSS', location);
					imports.push({ node, item, list, url: target.value, conditions: children, location });
					return this.skip;
				}
			}
			if (node.type === 'Function') {
				node.name = decodeIdentifier(node.name).toLowerCase();
				invariant(!['expression', 'paint', 'src'].includes(node.name), 'THEME_UNRESOLVED_CSS', location);
				if (node.name === 'url') {
					const children = node.children.toArray();
					invariant(children.length === 1 && children[0].type === 'String', 'THEME_UNRESOLVED_CSS', location);
					node.type = 'Url';
					node.value = children[0].value;
					delete node.children;
					delete node.name;
					refs.push(node);
					return this.skip;
				}
				if (
					['var', 'env', 'attr'].includes(node.name) &&
					functionStack.some((name) => ['image-set', '-webkit-image-set', 'image'].includes(name))
				) {
					throw new ThemeError('THEME_UNRESOLVED_CSS', location);
				}
				// Typed attr() can synthesize a URL at runtime; plain text attr() remains useful for content.
				if (node.name === 'attr') {
					invariant(!/url/i.test(generate(node)), 'THEME_UNRESOLVED_CSS', location);
				}
				functionStack.push(node.name);
			}
			if (node.type === 'Url') {
				refs.push(node);
			}
			if (node.type === 'String' && ['image-set', '-webkit-image-set', 'image'].includes(functionStack.at(-1))) {
				refs.push(node);
			}
		},
		leave(node) {
			if (node.type === 'Function') {
				functionStack.pop();
			}
		},
	});
	for (const reference of refs) {
		invariant(reference.value && !reference.value.startsWith('#'), 'THEME_UNRESOLVED_CSS');
		reference.value = await resolver.asset(reference.value, source);
	}
	for (const entry of imports) {
		const imported = await resolver.css(entry.url, source);
		let normalized = await normalizeCss(imported.css, resolver, { source: imported.source, depth: depth + 1, stack: [...stack, source] });
		const conditions = [...entry.conditions];
		let layer;
		let supports;
		if (conditions[0]?.type === 'Identifier' && decodeIdentifier(conditions[0].name).toLowerCase() === 'layer') {
			layer = '';
			conditions.shift();
		} else if (conditions[0]?.type === 'Function' && decodeIdentifier(conditions[0].name).toLowerCase() === 'layer') {
			layer = conditions.shift().children.toArray().map(generate).join('');
		}
		if (conditions[0]?.type === 'Function' && decodeIdentifier(conditions[0].name).toLowerCase() === 'supports') {
			supports = conditions.shift().children.toArray().map(generate).join('');
		}
		if (conditions.length) {
			normalized = '@media ' + conditions.map(generate).join(' ') + '{' + normalized + '}';
		}
		if (supports !== undefined) {
			normalized = '@supports (' + supports + '){' + normalized + '}';
		}
		if (layer !== undefined) {
			normalized = '@layer ' + layer + '{' + normalized + '}';
		}
		const replacement = parseCss(normalized, 'stylesheet');
		entry.list.insertList(replacement.children, entry.item);
		entry.list.remove(entry.item);
	}
	const result = generate(ast);
	invariant(utf8Size(result) <= LIMITS.cssBytes, 'THEME_CSS_LIMIT');
	return result;
}

/** Map known, already-normalized resource references for a portable archive or preview. */
export function rewriteCssResources(css, replace, { context = 'stylesheet' } = {}) {
	const ast = parseCss(css, context);
	const functions = [];
	walk(ast, {
		enter(node) {
			if (node.type === 'Function') {
				functions.push(node.name.toLowerCase());
			}
			if (node.type === 'Url' || (node.type === 'String' && ['image-set', '-webkit-image-set', 'image'].includes(functions.at(-1)))) {
				node.value = replace(node.value);
			}
		},
		leave(node) {
			if (node.type === 'Function') {
				functions.pop();
			}
		},
	});
	return generate(ast);
}
