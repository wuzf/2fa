import { invariant, stableStringify, utf8Size, validateSettingValue } from './schema.js';

/** Separate from v1 limits: count the complete portable appearance, including its manifest. */
export const APP_LIMITS = Object.freeze({
	upload: 12 * 1024 * 1024,
	totalBytes: 10 * 1024 * 1024,
	files: 256,
	manifestBytes: 128 * 1024,
	jsBytes: 4 * 1024 * 1024,
	cssBytes: 1024 * 1024,
});
export const APP_MIME = Object.freeze({
	js: 'text/javascript',
	mjs: 'text/javascript',
	css: 'text/css',
	json: 'application/json',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	woff2: 'font/woff2',
	txt: 'text/plain',
});
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TYPES = ['boolean', 'color', 'number', 'select', 'text', 'textarea'];

export function assertAppData(input) {
	let nodes = 0;
	const active = new Set();
	function visit(value, depth) {
		invariant(++nodes <= 20000 && depth <= 16, 'THEME_INVALID_FIELD');
		if (value === null || typeof value === 'string' || typeof value === 'boolean') {
			return;
		}
		if (typeof value === 'number') {
			invariant(Number.isFinite(value), 'THEME_INVALID_FIELD');
			return;
		}
		invariant(value && typeof value === 'object' && !active.has(value), 'THEME_INVALID_FIELD');
		invariant(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'THEME_INVALID_FIELD');
		active.add(value);
		if (Array.isArray(value)) {
			invariant(
				Object.keys(value).length === value.length && Object.keys(value).every((key, index) => key === String(index)),
				'THEME_INVALID_FIELD',
			);
		}
		for (const key of Reflect.ownKeys(value)) {
			if (Array.isArray(value) && key === 'length') {
				continue;
			}
			invariant(typeof key === 'string' && !BAD_KEYS.has(key), 'THEME_INVALID_FIELD');
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			invariant(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'THEME_INVALID_FIELD');
			visit(descriptor.value, depth + 1);
		}
		active.delete(value);
	}
	visit(input, 0);
}
export function appRecord(value, allowed) {
	invariant(value && typeof value === 'object' && !Array.isArray(value), 'THEME_INVALID_FIELD');
	for (const key of Object.keys(value)) {
		invariant(!BAD_KEYS.has(key) && allowed.includes(key), 'THEME_UNKNOWN_FIELD', { field: key });
	}
	return value;
}
function text(value, max, fallback = '') {
	const result = value ?? fallback;
	invariant(typeof result === 'string' && result.length <= max && !result.includes('\0'), 'THEME_INVALID_FIELD');
	return result;
}
/** ASCII package paths avoid normalization/case/percent aliases in portable resource URLs. */
export function appPath(value) {
	invariant(typeof value === 'string' && value.length > 0 && value.length <= 240 && /^[A-Za-z0-9._/-]+$/.test(value), 'THEME_INVALID_PATH');
	invariant(
		value.split('/').every((part) => part && part !== '.' && part !== '..' && !BAD_KEYS.has(part)),
		'THEME_INVALID_PATH',
	);
	return value;
}
export function appMime(path) {
	appPath(path);
	const ext = path.split('.').pop();
	const mime = path.includes('.') && Object.hasOwn(APP_MIME, ext) ? APP_MIME[ext] : undefined;
	invariant(mime && (ext !== 'txt' || /^licenses\/[A-Za-z0-9._/-]+\.txt$/.test(path)), 'THEME_FILE_TYPE', { path });
	return mime;
}
export function assertAppFileLimit(path, bytes) {
	invariant(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= APP_LIMITS.totalBytes, 'THEME_SIZE_LIMIT');
	const mime = appMime(path);
	if (mime === 'text/javascript') {
		invariant(bytes <= APP_LIMITS.jsBytes, 'THEME_APP_JS_LIMIT');
	}
	if (mime === 'text/css') {
		invariant(bytes <= APP_LIMITS.cssBytes, 'THEME_CSS_LIMIT');
	}
	if (path === '2fa-theme.json' || path === 'appearance.json') {
		invariant(bytes <= APP_LIMITS.manifestBytes, 'THEME_MANIFEST_LIMIT');
	}
}
function settingsSchema(fields) {
	invariant(Array.isArray(fields) && fields.length <= 64, 'THEME_INVALID_SETTINGS');
	const keys = new Set();
	return fields.map((field) => {
		appRecord(field, ['key', 'type', 'label', 'description', 'default', 'min', 'max', 'step', 'options']);
		invariant(
			typeof field.key === 'string' && ID.test(field.key) && !BAD_KEYS.has(field.key) && !keys.has(field.key) && TYPES.includes(field.type),
			'THEME_INVALID_SETTINGS',
		);
		keys.add(field.key);
		const out = {
			key: field.key,
			type: field.type,
			label: text(field.label, 256),
			description: text(field.description, 2048),
			default: field.default,
		};
		for (const name of ['min', 'max', 'step']) {
			if (field[name] !== undefined) {
				invariant(
					field.type === 'number' && Number.isFinite(field[name]) && (name !== 'step' || field[name] > 0),
					'THEME_INVALID_SETTINGS',
				);
				out[name] = field[name];
			}
		}
		invariant(out.min === undefined || out.max === undefined || out.min <= out.max, 'THEME_INVALID_SETTINGS');
		if (field.type === 'select') {
			invariant(Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 64, 'THEME_INVALID_SETTINGS');
			out.options = field.options.map((option) => {
				appRecord(option, ['value', 'label']);
				return { value: text(option.value, 128), label: text(option.label, 256) };
			});
			invariant(new Set(out.options.map((option) => option.value)).size === out.options.length, 'THEME_INVALID_SETTINGS');
		} else {
			invariant(field.options === undefined, 'THEME_INVALID_SETTINGS');
		}
		invariant(validateSettingValue(out, out.default), 'THEME_INVALID_DEFAULT', { key: out.key });
		return out;
	});
}
const PREVIEW_MIME = ['image/png', 'image/jpeg', 'image/webp'];
export function validateAppManifest(input) {
	assertAppData(input);
	appRecord(input, [
		'themeApiVersion',
		'kind',
		'sdkApiVersion',
		'id',
		'name',
		'version',
		'author',
		'description',
		'entry',
		'styles',
		'settings',
		'minHostVersion',
		'capabilities',
		'preview',
		'files',
	]);
	invariant(input.themeApiVersion === 2 && input.kind === 'app', 'THEME_UNSUPPORTED_VERSION');
	invariant(input.sdkApiVersion === 1, 'THEME_UNSUPPORTED_SDK');
	invariant(
		typeof input.id === 'string' && ID.test(input.id) && !BAD_KEYS.has(input.id) && !input.id.startsWith('builtin-'),
		'THEME_INVALID_ID',
	);
	invariant(typeof input.version === 'string' && SEMVER.test(input.version), 'THEME_INVALID_VERSION');
	const entry = appPath(input.entry);
	invariant(/\.m?js$/.test(entry), 'THEME_FILE_TYPE');
	const styles = input.styles ?? [];
	invariant(Array.isArray(styles) && styles.length <= 32 && new Set(styles).size === styles.length, 'THEME_INVALID_FIELD');
	styles.forEach((path) => {
		appPath(path);
		invariant(path.endsWith('.css'), 'THEME_FILE_TYPE');
	});
	const capabilities = input.capabilities ?? [];
	invariant(
		Array.isArray(capabilities) && capabilities.length <= 32 && new Set(capabilities).size === capabilities.length,
		'THEME_INVALID_FIELD',
	);
	capabilities.forEach((value) => {
		invariant(typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value), 'THEME_INVALID_FIELD');
	});
	invariant(Array.isArray(input.files) && input.files.length > 0 && input.files.length < APP_LIMITS.files, 'THEME_PACKAGE_LIMIT');
	const paths = new Set();
	let total = 0;
	const files = input.files
		.map((file) => {
			appRecord(file, ['path', 'mime', 'size', 'sha256']);
			const path = appPath(file.path);
			invariant(!['2fa-theme.json', 'appearance.json'].includes(path) && !path.startsWith('appearance-assets/'), 'THEME_RESERVED_PATH');
			invariant(!paths.has(path.toLowerCase()), 'THEME_DUPLICATE_PATH', { path });
			paths.add(path.toLowerCase());
			invariant(file.mime === appMime(path), 'THEME_ASSET_TYPE');
			assertAppFileLimit(path, file.size);
			invariant(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'THEME_APP_HASH');
			total += file.size;
			return { path, mime: file.mime, size: file.size, sha256: file.sha256 };
		})
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	for (const file of files) {
		const parts = file.path.toLowerCase().split('/');
		for (let index = 1; index < parts.length; index++) {
			invariant(!paths.has(parts.slice(0, index).join('/')), 'THEME_DUPLICATE_PATH', { path: file.path });
		}
	}
	invariant(
		files.some((file) => file.path === entry) && styles.every((path) => files.some((file) => file.path === path)),
		'THEME_MISSING_FILE',
	);
	const manifest = {
		themeApiVersion: 2,
		kind: 'app',
		sdkApiVersion: 1,
		id: input.id,
		name: text(input.name, 128),
		version: input.version,
		author: text(input.author, 256),
		description: text(input.description, 2048),
		entry,
		styles: [...styles],
		settings: settingsSchema(input.settings ?? []),
		capabilities: [...capabilities].sort(),
		files,
	};
	invariant(manifest.name.length > 0, 'THEME_INVALID_FIELD');
	if (input.preview !== undefined) {
		// A screenshot shown on the theme's card in the appearance editor.
		const preview = appPath(input.preview);
		invariant(PREVIEW_MIME.includes(appMime(preview)), 'THEME_FILE_TYPE');
		invariant(
			files.some((file) => file.path === preview),
			'THEME_MISSING_FILE',
		);
		manifest.preview = preview;
	}
	if (input.minHostVersion !== undefined) {
		invariant(SEMVER.test(input.minHostVersion), 'THEME_INVALID_VERSION');
		manifest.minHostVersion = input.minHostVersion;
	}
	invariant(utf8Size(manifest) <= APP_LIMITS.manifestBytes, 'THEME_MANIFEST_LIMIT');
	invariant(total + utf8Size(manifest) <= APP_LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
	return manifest;
}
export function appManifestIdentity(manifest) {
	return stableStringify(validateAppManifest(manifest));
}

export function validateAppSettings(manifest, input = {}) {
	assertAppData(input);
	appRecord(
		input,
		manifest.settings.map((field) => field.key),
	);
	const settings = {};
	for (const field of manifest.settings) {
		const value = Object.hasOwn(input, field.key) ? input[field.key] : field.default;
		invariant(validateSettingValue(field, value), 'THEME_INVALID_SETTING', { key: field.key });
		settings[field.key] = value;
	}
	return settings;
}
