import { parse as parseJavaScript } from 'acorn';
import parseCss from 'css-tree/parser';
import walkCss from 'css-tree/walker';
import { ThemeError, invariant, hashBytes } from './schema.js';
import { decodeText, normalizeAsset } from './resources.js';
import { appPath, appMime, assertAppFileLimit } from './appSchema.js';

export function resolveAppReference(value, source, { module = false } = {}) {
	invariant(
		typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\?#%:\s]/.test(value) && !value.startsWith('/'),
		'THEME_APP_REFERENCE',
		{ source, value },
	);
	if (module) {
		invariant(value.startsWith('./') || value.startsWith('../'), 'THEME_APP_REFERENCE', { source, value });
	}
	const parts = appPath(source).split('/').slice(0, -1);
	for (const part of value.split('/')) {
		if (part === '..') {
			invariant(parts.length > 0, 'THEME_APP_REFERENCE', { source, value });
			parts.pop();
		} else if (part !== '.') {
			invariant(part !== '', 'THEME_APP_REFERENCE');
			parts.push(part);
		}
	}
	return appPath(parts.join('/'));
}
function literal(node) {
	if (node?.type === 'Literal' && typeof node.value === 'string') {
		return node.value;
	}
	if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
		return node.quasis[0].value.cooked;
	}
	return null;
}
function importMetaUrl(node) {
	return (
		node?.type === 'MemberExpression' &&
		!node.computed &&
		node.property.name === 'url' &&
		node.object?.type === 'MetaProperty' &&
		node.object.meta.name === 'import' &&
		node.object.property.name === 'meta'
	);
}
function jsReferences(text, path) {
	let ast;
	try {
		ast = parseJavaScript(text, { ecmaVersion: 'latest', sourceType: 'module' });
	} catch {
		throw new ThemeError('THEME_APP_JAVASCRIPT', { path });
	}
	const references = [],
		stack = [ast];
	while (stack.length) {
		const node = stack.pop();
		if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
			references.push({ value: node.source.value, module: true });
		} else if (node.type === 'ImportExpression') {
			const value = literal(node.source);
			invariant(value !== null, 'THEME_APP_DYNAMIC_IMPORT', { path });
			references.push({ value, module: true });
		} else if (
			node.type === 'NewExpression' &&
			node.callee.type === 'Identifier' &&
			node.callee.name === 'URL' &&
			node.arguments.length === 2 &&
			importMetaUrl(node.arguments[1])
		) {
			const value = literal(node.arguments[0]);
			if (value !== null) {
				references.push({ value, module: false });
			}
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child?.type) {
						stack.push(child);
					}
				}
			} else if (value?.type) {
				stack.push(value);
			}
		}
	}
	return references;
}
function decodeCss(value) {
	return value.replace(/\\([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/g, (_, hex, char) =>
		hex ? String.fromCodePoint(parseInt(hex, 16) > 0 && parseInt(hex, 16) <= 0x10ffff ? parseInt(hex, 16) : 0xfffd) : char,
	);
}
function cssReferences(text, path) {
	let ast;
	try {
		ast = parseCss(text, {
			parseCustomProperty: true,
			onParseError(error) {
				throw error;
			},
		});
	} catch {
		throw new ThemeError('THEME_INVALID_CSS', { path });
	}
	const references = [],
		functions = [];
	walkCss(ast, {
		enter(node) {
			invariant(node.type !== 'Raw', 'THEME_UNRESOLVED_CSS', { path });
			if (node.type === 'Atrule' && decodeCss(node.name).toLowerCase() === 'import') {
				const target = node.prelude?.children.first;
				invariant(target && ['String', 'Url'].includes(target.type), 'THEME_UNRESOLVED_CSS', { path });
				references.push({ value: decodeCss(target.value), module: false, css: true });
			}
			if (node.type === 'Function') {
				functions.push(decodeCss(node.name).toLowerCase());
			}
			if (node.type === 'Url') {
				references.push({ value: decodeCss(node.value), module: false });
			}
			if (node.type === 'String' && functions.at(-1)?.endsWith('image-set')) {
				references.push({ value: decodeCss(node.value), module: false });
			}
		},
		leave(node) {
			if (node.type === 'Function') {
				functions.pop();
			}
		},
	});
	return references;
}

/** Build compatibility checks, not a sandbox or a scan of arbitrary executable JS behavior. */
export function validateAppReferences(files) {
	const inventory = new Map(files.map((file) => [file.path, file]));
	for (const file of files) {
		const refs =
			file.mime === 'text/javascript'
				? jsReferences(decodeText(file.bytes), file.path)
				: file.mime === 'text/css'
					? cssReferences(decodeText(file.bytes), file.path)
					: [];
		for (const ref of refs) {
			if (!ref.module && ref.value.startsWith('#') && file.mime === 'text/css') {
				continue;
			}
			const path = resolveAppReference(ref.value, file.path, ref);
			invariant(inventory.has(path), 'THEME_MISSING_FILE', { path, source: file.path });
			if (ref.module) {
				invariant(['text/javascript', 'application/json'].includes(inventory.get(path).mime), 'THEME_APP_REFERENCE', { path });
			}
			if (ref.css) {
				invariant(inventory.get(path).mime === 'text/css', 'THEME_APP_REFERENCE', { path });
			}
		}
	}
}
export async function normalizeAppFile(path, input, expected) {
	appPath(path);
	invariant(input instanceof Uint8Array, 'THEME_MISSING_FILE', { path });
	const bytes = input.slice(),
		mime = appMime(path);
	assertAppFileLimit(path, bytes.length);
	if (mime.startsWith('image/') || mime === 'font/woff2') {
		await normalizeAsset(bytes, path);
	} else {
		const text = decodeText(bytes);
		invariant(!text.includes('\0'), 'THEME_INVALID_ENCODING', { path });
		if (mime === 'application/json') {
			try {
				JSON.parse(text);
			} catch {
				throw new ThemeError('THEME_INVALID_JSON', { path });
			}
		}
	}
	const hash = await hashBytes(bytes);
	if (expected) {
		invariant(
			expected.path === path && expected.mime === mime && expected.size === bytes.length && expected.sha256 === hash,
			'THEME_APP_HASH',
			{ path },
		);
	}
	return { path, mime, size: bytes.length, hash, bytes };
}
export function appResourceUrl(packageId, path) {
	invariant(typeof packageId === 'string' && /^[a-f0-9]{64}$/.test(packageId), 'THEME_APP_HASH');
	return '/theme-packages/' + packageId + '/' + appPath(path);
}
/** Header policy only: the route must separately authorize publication or a live private capability. */
export function appResourceHeaders(file, { public: published = false } = {}) {
	invariant(file.mime === appMime(file.path) && /^[a-f0-9]{64}$/.test(file.hash), 'THEME_APP_HASH');
	assertAppFileLimit(file.path, file.size);
	return {
		'Content-Type': file.mime,
		'Content-Length': String(file.size),
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': published ? 'public, max-age=31536000, immutable' : 'no-store',
		'X-Content-SHA256': file.hash,
		'Referrer-Policy': 'no-referrer',
	};
}
