/** Versioned data-only theme protocol. Keep this module usable in Workers and browsers. */
export const LIMITS = Object.freeze({
	upload: 12 * 1024 * 1024,
	totalBytes: 10 * 1024 * 1024,
	files: 64,
	cssBytes: 256 * 1024,
	manifestBytes: 64 * 1024,
	requests: 32,
	concurrency: 4,
	redirects: 3,
	cssDepth: 4,
	requestMs: 10000,
	totalMs: 45000,
	versions: 20,
	libraryBytes: 50 * 1024 * 1024,
});

export class ThemeError extends Error {
	constructor(code, details = {}, status = 400) {
		super(code);
		this.name = 'ThemeError';
		this.code = code;
		this.details = details;
		this.status = status;
	}
}

export function invariant(condition, code, details) {
	if (!condition) {
		throw new ThemeError(code, details);
	}
}

export const REGIONS = Object.freeze(['header', 'leading', 'main', 'trailing', 'footer']);
export const COMPONENTS = Object.freeze([
	'brand',
	'service-nav',
	'search',
	'view-controls',
	'system-status',
	'accounts',
	'actions',
	'footer',
	'text',
	'image',
	'links',
]);
const REQUIRED = ['search', 'view-controls', 'system-status', 'accounts', 'actions'];
const REPEATED = ['text', 'image', 'links'];
const TYPES = ['boolean', 'color', 'number', 'select', 'text', 'textarea'];
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const encoder = new TextEncoder();

function validId(value) {
	return typeof value === 'string' && ID.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
}

export function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stableStringify(value) {
	if (Array.isArray(value)) {
		return '[' + value.map(stableStringify).join(',') + ']';
	}
	if (isRecord(value)) {
		return (
			'{' +
			Object.keys(value)
				.sort()
				.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
				.join(',') +
			'}'
		);
	}
	return JSON.stringify(value);
}

export function utf8Size(value) {
	return encoder.encode(typeof value === 'string' ? value : stableStringify(value)).length;
}

export async function hashBytes(bytes) {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function record(value, field) {
	invariant(isRecord(value), 'THEME_INVALID_FIELD', { field });
	for (const key of Object.keys(value)) {
		invariant(!['__proto__', 'constructor', 'prototype'].includes(key), 'THEME_INVALID_FIELD', { field: key });
	}
	return value;
}

function text(value, field, max = 2048, fallback = '') {
	const result = value ?? fallback;
	invariant(typeof result === 'string' && result.length <= max && !result.includes(String.fromCharCode(0)), 'THEME_INVALID_FIELD', {
		field,
	});
	return result;
}

function onlyKeys(value, allowed, field) {
	for (const key of Object.keys(value)) {
		invariant(allowed.includes(key), 'THEME_UNKNOWN_FIELD', { field: field + '.' + key });
	}
}

export function validateLayout(input) {
	record(input, 'layout');
	onlyKeys(input, REGIONS, 'layout');
	const output = {};
	const ids = new Set();
	const counts = new Map();
	for (const region of REGIONS) {
		const items = input[region] ?? [];
		invariant(Array.isArray(items) && items.length <= 32, 'THEME_INVALID_LAYOUT', { region });
		output[region] = items.map((entry) => {
			const component = typeof entry === 'string' ? { id: entry, type: entry } : record(entry, 'component');
			onlyKeys(component, ['id', 'type', 'hidden', 'mode'], 'component');
			invariant(COMPONENTS.includes(component.type) && validId(component.id), 'THEME_INVALID_COMPONENT');
			invariant(!ids.has(component.id), 'THEME_DUPLICATE_COMPONENT', { id: component.id });
			invariant(component.hidden === undefined || typeof component.hidden === 'boolean', 'THEME_INVALID_COMPONENT');
			invariant(!REQUIRED.includes(component.type) || !component.hidden, 'THEME_REQUIRED_COMPONENT', { type: component.type });
			invariant(component.type !== 'accounts' || region === 'main', 'THEME_INVALID_LAYOUT', { type: 'accounts' });
			invariant(
				component.mode === undefined || (component.type === 'actions' && ['floating', 'toolbar'].includes(component.mode)),
				'THEME_INVALID_COMPONENT',
			);
			ids.add(component.id);
			counts.set(component.type, (counts.get(component.type) || 0) + 1);
			return {
				id: component.id,
				type: component.type,
				...(component.hidden ? { hidden: true } : {}),
				...(component.mode ? { mode: component.mode } : {}),
			};
		});
	}
	for (const type of COMPONENTS) {
		const count = counts.get(type) || 0;
		invariant(!REQUIRED.includes(type) || count === 1, 'THEME_REQUIRED_COMPONENT', { type });
		invariant(REPEATED.includes(type) || count <= 1, 'THEME_DUPLICATE_COMPONENT', { type });
	}
	return output;
}

export const DEFAULT_LAYOUT = Object.freeze({
	header: ['brand'],
	leading: [],
	main: ['search', 'view-controls', 'system-status', 'accounts', 'actions'],
	trailing: [],
	footer: ['footer'],
});

function validateBinding(binding, type, content) {
	record(binding, 'binding');
	onlyKeys(binding, ['type', 'name', 'component', 'field', 'unit'], 'binding');
	if (binding.unit !== undefined) {
		invariant(
			binding.type === 'variable' && type === 'number' && ['px', 'rem', 'em', '%', 'ms', 's', 'vw', 'vh'].includes(binding.unit),
			'THEME_INVALID_BINDING',
		);
	}
	if (binding.type === 'variable') {
		invariant(/^--(?:theme|2fa)-[a-z][a-z0-9-]{0,64}$/.test(binding.name), 'THEME_INVALID_BINDING');
	} else if (binding.type === 'attribute') {
		invariant(
			/^data-theme-option-[a-z][a-z0-9-]{0,48}$/.test(binding.name) && ['boolean', 'select'].includes(type),
			'THEME_INVALID_BINDING',
		);
	} else if (binding.type === 'content') {
		invariant(
			Object.hasOwn(content, binding.component) && ['text', 'title', 'src', 'alt'].includes(binding.field),
			'THEME_INVALID_BINDING',
		);
	} else {
		throw new ThemeError('THEME_INVALID_BINDING');
	}
	return { ...binding };
}

export function validateSettingValue(field, value) {
	if (field.type === 'boolean') {
		return typeof value === 'boolean';
	}
	if (field.type === 'number') {
		return (
			typeof value === 'number' &&
			Number.isFinite(value) &&
			(field.min === undefined || value >= field.min) &&
			(field.max === undefined || value <= field.max)
		);
	}
	if (field.type === 'select') {
		return field.options.some((option) => option.value === value);
	}
	if (field.type === 'color') {
		return typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{1}|[0-9a-f]{3}|[0-9a-f]{5})?$/i.test(value);
	}
	return typeof value === 'string' && value.length <= (field.type === 'textarea' ? 16384 : 2048) && !value.includes('\0');
}

function validateContent(input, layout) {
	record(input, 'content');
	invariant(Object.keys(input).length <= 64, 'THEME_INVALID_CONTENT');
	const entries = Object.values(layout).flat();
	const output = {};
	for (const [key, value] of Object.entries(input)) {
		const component = entries.find((entry) => entry.id === key && REPEATED.includes(entry.type));
		invariant(component, 'THEME_INVALID_CONTENT', { component: key });
		record(value, 'content.' + key);
		if (component.type === 'links') {
			onlyKeys(value, ['title', 'items'], 'content');
			invariant(Array.isArray(value.items) && value.items.length <= 32, 'THEME_INVALID_CONTENT');
			output[key] = {
				title: text(value.title, 'title'),
				items: value.items.map((item) => {
					record(item, 'link');
					onlyKeys(item, ['label', 'href'], 'link');
					const href = text(item.href, 'href');
					invariant(/^(https:\/\/|mailto:)/i.test(href), 'THEME_INVALID_LINK');
					return { label: text(item.label, 'label'), href };
				}),
			};
		} else {
			onlyKeys(value, component.type === 'image' ? ['src', 'alt', 'title'] : ['text', 'title'], 'content');
			output[key] = Object.fromEntries(
				Object.entries(value).map(([field, entry]) => [field, text(entry, field, field === 'text' ? 16384 : 2048)]),
			);
		}
	}
	return output;
}

export function validateManifest(input, { builtin = false } = {}) {
	record(input, 'manifest');
	onlyKeys(
		input,
		['themeApiVersion', 'id', 'name', 'version', 'author', 'description', 'styles', 'preview', 'layout', 'tokens', 'settings', 'content'],
		'manifest',
	);
	invariant(input.themeApiVersion === 1, 'THEME_UNSUPPORTED_VERSION');
	invariant(validId(input.id), 'THEME_INVALID_ID');
	invariant(builtin || !input.id.startsWith('builtin-'), 'THEME_RESERVED_ID');
	invariant(typeof input.version === 'string' && SEMVER.test(input.version), 'THEME_INVALID_VERSION');
	const layout = validateLayout(input.layout ?? DEFAULT_LAYOUT);
	const content = validateContent(input.content ?? {}, layout);
	const tokens = {};
	record(input.tokens ?? {}, 'tokens');
	onlyKeys(input.tokens ?? {}, ['light', 'dark'], 'tokens');
	for (const mode of ['light', 'dark']) {
		const values = record(input.tokens?.[mode] ?? {}, 'tokens.' + mode);
		invariant(Object.keys(values).length <= 128, 'THEME_INVALID_TOKENS');
		tokens[mode] = {};
		for (const [key, value] of Object.entries(values)) {
			invariant(/^--(?:2fa|theme)-[a-z][a-z0-9-]{0,64}$/.test(key), 'THEME_INVALID_TOKENS', { key });
			tokens[mode][key] = text(value, key);
		}
	}
	const fields = input.settings ?? [];
	invariant(Array.isArray(fields) && fields.length <= 64, 'THEME_INVALID_SETTINGS');
	const keys = new Set();
	const settings = fields.map((field) => {
		record(field, 'setting');
		onlyKeys(
			field,
			['key', 'type', 'label', 'description', 'default', 'binding', 'min', 'max', 'step', 'options', 'translations'],
			'setting',
		);
		invariant(validId(field.key) && !keys.has(field.key) && TYPES.includes(field.type), 'THEME_INVALID_SETTINGS');
		keys.add(field.key);
		const result = {
			key: field.key,
			type: field.type,
			label: text(field.label, 'label', 256),
			description: text(field.description, 'description'),
			default: field.default,
			binding: validateBinding(field.binding, field.type, content),
		};
		if (field.type === 'number') {
			for (const name of ['min', 'max', 'step']) {
				if (field[name] !== undefined) {
					invariant(Number.isFinite(field[name]) && (name !== 'step' || field[name] > 0), 'THEME_INVALID_SETTINGS');
					result[name] = field[name];
				}
			}
			invariant(result.min === undefined || result.max === undefined || result.min <= result.max, 'THEME_INVALID_SETTINGS');
		}
		if (field.type === 'select') {
			invariant(Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 64, 'THEME_INVALID_SETTINGS');
			result.options = field.options.map((option) => {
				record(option, 'option');
				onlyKeys(option, ['value', 'label'], 'option');
				return { value: text(option.value, 'option.value', 128), label: text(option.label, 'option.label', 256) };
			});
			invariant(new Set(result.options.map((option) => option.value)).size === result.options.length, 'THEME_INVALID_SETTINGS');
		}
		if (field.translations !== undefined) {
			record(field.translations, 'translations');
			result.translations = {};
			for (const [language, translation] of Object.entries(field.translations)) {
				invariant(/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(language), 'THEME_INVALID_SETTINGS');
				record(translation, 'translation');
				result.translations[language] = {
					label: text(translation.label, 'label', 256),
					description: text(translation.description, 'description'),
				};
			}
		}
		invariant(validateSettingValue(result, result.default), 'THEME_INVALID_DEFAULT', { key: result.key });
		return result;
	});
	const manifest = {
		themeApiVersion: 1,
		id: input.id,
		name: text(input.name, 'name', 128),
		version: input.version,
		author: text(input.author, 'author', 256),
		description: text(input.description, 'description'),
		styles: text(input.styles, 'styles', 240, 'theme.css'),
		layout,
		tokens,
		settings,
		content,
	};
	invariant(manifest.name.length > 0, 'THEME_INVALID_FIELD', { field: 'name' });
	if (input.preview) {
		manifest.preview = text(input.preview, 'preview', 240);
	}
	invariant(utf8Size(manifest) <= LIMITS.manifestBytes, 'THEME_MANIFEST_LIMIT');
	return manifest;
}

export function validateAppearance(input, manifest) {
	record(input, 'appearance');
	onlyKeys(input, ['packageId', 'themeId', 'settings'], 'appearance');
	const values = record(input.settings ?? {}, 'settings');
	const settings = {};
	for (const key of Object.keys(values)) {
		invariant(
			manifest.settings.some((field) => field.key === key),
			'THEME_UNKNOWN_SETTING',
			{ key },
		);
	}
	for (const field of manifest.settings) {
		const value = Object.hasOwn(values, field.key) ? values[field.key] : field.default;
		invariant(validateSettingValue(field, value), 'THEME_INVALID_SETTING', { key: field.key });
		settings[field.key] = value;
	}
	return {
		packageId: text(input.packageId, 'packageId', 128),
		themeId: manifest.id,
		settings,
		layout: manifest.layout,
		content: manifest.content,
	};
}

export function migrateSettings(previousManifest, nextManifest, values = {}, validateValue = validateSettingValue) {
	const settings = {};
	const changes = [];
	for (const field of nextManifest.settings) {
		const previous = previousManifest.settings.find((entry) => entry.key === field.key);
		if (previous?.type === field.type && Object.hasOwn(values, field.key) && validateValue(field, values[field.key])) {
			settings[field.key] = values[field.key];
		} else {
			settings[field.key] = field.default;
			changes.push({
				key: field.key,
				reason: !previous ? 'added' : previous.type !== field.type ? 'type-changed' : 'invalid-value',
				value: field.default,
			});
		}
	}
	for (const field of previousManifest.settings) {
		if (!nextManifest.settings.some((entry) => entry.key === field.key)) {
			changes.push({ key: field.key, reason: 'removed' });
		}
	}
	return { settings, changes };
}
