import {
	LIMITS,
	ThemeError,
	hashBytes,
	invariant,
	isRecord,
	stableStringify,
	utf8Size,
	validateAppearance,
	validateManifest,
	validateSettingValue,
} from './schema.js';
import {
	ImportBudget,
	assetHashFromUrl,
	assetUrl,
	assertPublicUrl,
	cleanPath,
	decodeText,
	normalizeAsset,
	resolvePackagePath,
} from './resources.js';
import { normalizeCss, rewriteCssResources } from './css.js';
import { assertArchiveFileLimit, packStoredFiles, unpackTheme } from './archive.js';

const encoder = new TextEncoder();

function readJson(bytes) {
	try {
		return JSON.parse(decodeText(bytes));
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_JSON');
	}
}

async function resolveSourceUrl(url, budget) {
	const parsed = assertPublicUrl(url);
	if (parsed.hostname !== 'github.com') {
		return parsed.href;
	}
	const parts = parsed.pathname
		.replace(/\.git$/, '')
		.split('/')
		.filter(Boolean);
	if (parts.length === 2 || (parts.length >= 5 && parts[2] === 'releases' && parts[3] === 'tag')) {
		const [owner, repo] = parts;
		invariant(/^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo), 'THEME_INVALID_URL');
		const endpoint =
			'https://api.github.com/repos/' +
			owner +
			'/' +
			repo +
			'/releases/' +
			(parts.length === 2 ? 'latest' : 'tags/' + encodeURIComponent(parts.slice(4).join('/')));
		const result = await budget.download(endpoint, { maxBytes: 1024 * 1024, resource: false });
		const release = readJson(result.bytes);
		invariant(isRecord(release) && !release.draft && !release.prerelease && Array.isArray(release.assets), 'THEME_RELEASE_NOT_FOUND');
		const assets = release.assets.filter((asset) => isRecord(asset) && asset.name === '2fa-theme.zip');
		invariant(assets.length === 1 && typeof assets[0].browser_download_url === 'string', 'THEME_RELEASE_ASSET_NOT_FOUND');
		return assertPublicUrl(assets[0].browser_download_url).href;
	}
	return parsed.href;
}

class ResourceResolver {
	constructor(files, budget, options = {}) {
		this.files = files;
		this.budget = budget;
		this.options = options;
		this.assets = new Map();
		this.references = new Set();
	}

	async addAsset(bytes, name) {
		const asset = await normalizeAsset(bytes, name);
		const existing = this.assets.get(asset.hash);
		if (existing) {
			return existing;
		}
		this.assets.set(asset.hash, asset);
		return asset;
	}

	resolveLocation(value, source) {
		invariant(
			typeof value === 'string' &&
				value.length <= 4096 &&
				!value.includes('\\') &&
				!Array.from(value).some((char) => char.charCodeAt(0) < 32),
			'THEME_INVALID_URL',
		);
		if (/^https:\/\//i.test(value)) {
			return assertPublicUrl(value).href;
		}
		invariant(!/^[/#]|^[a-z][a-z0-9+.-]*:/i.test(value), 'THEME_INVALID_URL');
		if (/^https:\/\//.test(source)) {
			return assertPublicUrl(new URL(value, source).href).href;
		}
		return resolvePackagePath(value, source);
	}

	async asset(value, source = 'theme.css') {
		if (value === '') {
			return '';
		}
		const heldHash = assetHashFromUrl(value);
		if (heldHash) {
			let asset = this.assets.get(heldHash);
			if (!asset && this.options.resolveAsset) {
				const held = await this.options.resolveAsset(heldHash);
				invariant(held?.bytes, 'THEME_MISSING_ASSET', { hash: heldHash });
				asset = await this.addAsset(held.bytes, held.name);
				invariant(asset.hash === heldHash, 'THEME_ASSET_HASH_MISMATCH');
			}
			invariant(asset, 'THEME_MISSING_ASSET', { hash: heldHash });
			this.references.add(asset.hash);
			return assetUrl(asset);
		}
		const location = this.resolveLocation(value, source);
		let asset;
		if (location.startsWith('https://')) {
			const result = await this.budget.download(location);
			asset = await this.addAsset(result.bytes, new URL(result.url).pathname.split('/').pop() || 'asset');
		} else {
			const bytes = this.files.get(location);
			invariant(bytes, 'THEME_MISSING_FILE', { path: location });
			asset = await this.addAsset(bytes, location);
		}
		this.references.add(asset.hash);
		return assetUrl(asset);
	}

	async css(value, source) {
		const location = this.resolveLocation(value, source);
		if (location.startsWith('https://')) {
			const result = await this.budget.download(location, { maxBytes: LIMITS.cssBytes });
			return { css: decodeText(result.bytes, 'css'), source: result.url };
		}
		const bytes = this.files.get(location);
		invariant(bytes, 'THEME_MISSING_FILE', { path: location });
		return { css: decodeText(bytes, 'css'), source: location };
	}
}

async function normalizeBoundValue(field, value, resolver, source) {
	if (field.type === 'asset' || (field.binding.type === 'content' && field.binding.field === 'src')) {
		return value ? resolver.asset(value, source) : '';
	}
	if (field.binding.type === 'variable' && typeof value === 'string' && value !== '') {
		return normalizeCss(value, resolver, { source, context: 'value' });
	}
	return value;
}

async function normalizeManifestAssets(manifest, resolver, source) {
	for (const mode of ['light', 'dark']) {
		for (const [name, value] of Object.entries(manifest.tokens[mode])) {
			manifest.tokens[mode][name] = await normalizeCss(value, resolver, { source, context: 'value' });
		}
	}
	for (const field of manifest.settings) {
		field.default = await normalizeBoundValue(field, field.default, resolver, source);
		if (field.options) {
			for (const option of field.options) {
				option.value = await normalizeBoundValue(field, option.value, resolver, source);
			}
		}
		invariant(validateSettingValue(field, field.default), 'THEME_INVALID_DEFAULT', { key: field.key });
	}
	for (const content of Object.values(manifest.content)) {
		if (content.src) {
			content.src = await resolver.asset(content.src, source);
		}
	}
	if (manifest.preview) {
		manifest.preview = await resolver.asset(manifest.preview, source);
	}
}

function appearanceProjection(input) {
	const keys = ['packageId', 'themeId', 'settings', 'layout', 'content', 'branding', 'customCss'];
	return Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

async function normalizeAppearanceWithResolver(pkg, input, resolver, source = 'appearance.json') {
	const appearance = validateAppearance(appearanceProjection(input), pkg.manifest);
	appearance.packageId = pkg.packageId;
	appearance.themeId = pkg.manifest.id;
	for (const field of pkg.manifest.settings) {
		appearance.settings[field.key] = await normalizeBoundValue(field, appearance.settings[field.key], resolver, source);
	}
	for (const field of ['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background']) {
		if (appearance.branding[field]) {
			appearance.branding[field] = await resolver.asset(appearance.branding[field], source);
		}
	}
	for (const content of Object.values(appearance.content)) {
		if (content.src) {
			content.src = await resolver.asset(content.src, source);
		}
	}
	appearance.customCss = await normalizeCss(appearance.customCss, resolver, { source });
	// Persisted values are sent back unchanged on the next edit. Their normalized form must
	// therefore satisfy the input schema too, even when the shorter portable form would fit.
	return validateAppearance(appearance, pkg.manifest);
}

/** Shared guarded download for v1 and app packages, with one budget per import. */
export async function downloadThemeSource(input, options = {}, budget = new ImportBudget(options)) {
	let bytes = input.bytes instanceof Uint8Array ? input.bytes : input.bytes ? new Uint8Array(input.bytes) : null;
	let name = input.name || 'theme.zip';
	let sourceUrl = input.sourceUrl;
	if (input.url) {
		const source = await resolveSourceUrl(input.url, budget);
		const result = await budget.download(source, { maxBytes: options.restore ? LIMITS.restoreUpload : LIMITS.upload, resource: false });
		bytes = result.bytes;
		sourceUrl = result.url;
		name = new URL(result.url).pathname.split('/').pop() || 'theme.zip';
	}
	invariant(bytes && bytes.length > 0, 'THEME_EMPTY_FILE');
	invariant(bytes.length <= (options.restore ? LIMITS.restoreUpload : LIMITS.upload), 'THEME_UPLOAD_LIMIT');
	return { bytes, name, sourceUrl };
}

/** All inputs become one immutable, data-only normalized package. No network or executable templates remain. */
export async function normalizeThemeImport(input, options = {}, budget = new ImportBudget(options)) {
	const { bytes, name, sourceUrl } = await downloadThemeSource(input, options, budget);
	const files = new Map();
	let manifestInput;
	let css;
	let cssSource = 'theme.css';
	let appearanceInput;
	if (/\.css$/i.test(name)) {
		css = decodeText(bytes, 'css');
		budget.countFile('theme.css', bytes.length);
		manifestInput = {
			themeApiVersion: 1,
			id: 'custom-' + (await hashBytes(bytes)).slice(0, 12),
			name: name.replace(/\.css$/i, '').slice(0, 128) || 'Custom theme',
			version: '1.0.0',
			styles: 'theme.css',
		};
		cssSource = sourceUrl || 'theme.css';
	} else if (/\.json$/i.test(name)) {
		const document = readJson(bytes);
		invariant(isRecord(document), 'THEME_INVALID_JSON');
		manifestInput = document.manifest ?? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'css'));
		invariant(typeof document.css === 'string', 'THEME_MISSING_CSS');
		css = document.css;
		budget.countFile('theme.json', bytes.length);
		cssSource = sourceUrl || 'theme.css';
	} else {
		const unpacked = unpackTheme(bytes, budget, options);
		for (const [path, content] of unpacked) {
			files.set(path, content);
		}
		invariant(files.has('2fa-theme.json'), 'THEME_MISSING_MANIFEST');
		manifestInput = readJson(files.get('2fa-theme.json'));
		invariant(isRecord(manifestInput), 'THEME_INVALID_JSON');
		cssSource = cleanPath(manifestInput.styles || 'theme.css');
		invariant(files.has(cssSource), 'THEME_MISSING_CSS');
		css = decodeText(files.get(cssSource), 'css');
		if (files.has('appearance.json')) {
			invariant(options.restore, 'THEME_RESTORE_REQUIRED');
			appearanceInput = readJson(files.get('appearance.json'));
		}
	}
	const manifest = validateManifest(manifestInput, { builtin: options.restore === true });
	const resolver = new ResourceResolver(files, budget, options);
	for (const [path, content] of files) {
		if (!/\.(?:css|json)$/i.test(path)) {
			await resolver.addAsset(content, path);
		}
	}
	const manifestSource = sourceUrl && !files.size ? sourceUrl : '2fa-theme.json';
	await normalizeManifestAssets(manifest, resolver, manifestSource);
	const normalizedCss = await normalizeCss(css, resolver, { source: cssSource });
	manifest.styles = 'theme.css';
	const assets = Array.from(resolver.assets.values()).filter((asset) => resolver.references.has(asset.hash));
	const identity = stableStringify({
		manifest,
		css: normalizedCss,
		assets: assets.map(({ hash, name: assetName, mime }) => ({ hash, name: assetName, mime })).sort((a, b) => a.hash.localeCompare(b.hash)),
	});
	const pkg = { packageId: await hashBytes(encoder.encode(identity)), manifest, css: normalizedCss, assets };
	if (appearanceInput) {
		pkg.appearance = await normalizeAppearanceWithResolver(pkg, appearanceInput, resolver);
		pkg.appearanceAssets = Array.from(resolver.assets.values()).filter((asset) => resolver.references.has(asset.hash));
	}
	const portable = portableFiles(pkg, pkg.appearance, pkg.appearanceAssets ?? pkg.assets);
	assertPortableBudget(portable);
	return pkg;
}

export const normalizeTheme = normalizeThemeImport;

/** User CSS, saved bindings, branding and backup restoration share the package import resource rules. */
export async function normalizeAppearance(pkg, input, options = {}) {
	if (typeof options === 'function') {
		options = { resolveAsset: options };
	}
	const resolver = new ResourceResolver(new Map(), new ImportBudget(options), options);
	for (const asset of pkg.assets ?? []) {
		const normalized = await resolver.addAsset(asset.bytes, asset.name);
		invariant(asset.hash === normalized.hash, 'THEME_ASSET_HASH_MISMATCH');
	}
	const appearance = await normalizeAppearanceWithResolver(pkg, input, resolver);
	const assets = Array.from(resolver.assets.values());
	const files = portableFiles(pkg, appearance, assets);
	const totalBytes = assertPortableBudget(files);
	return { appearance, assets, resourceHashes: assets.map((asset) => asset.hash), totalBytes, fileCount: files.size };
}

function portableFiles(pkg, appearance, allAssets = pkg.assets ?? []) {
	// Also protects exports of older stored snapshots/defaults that predate normalized-value checks.
	validateAppearance(appearance ? appearanceProjection(appearance) : {}, pkg.manifest);
	const assets = new Map(allAssets.map((asset) => [asset.hash, asset]));
	const paths = new Map(Array.from(assets.values(), (asset) => [asset.hash, 'assets/' + asset.hash + '.' + asset.name.split('.').pop()]));
	const replace = (value) => {
		if (!value) {
			return value;
		}
		const hash = assetHashFromUrl(value);
		invariant(hash && paths.has(hash), 'THEME_MISSING_ASSET', { hash });
		return paths.get(hash);
	};
	const manifest = JSON.parse(JSON.stringify(pkg.manifest));
	manifest.styles = 'theme.css';
	if (manifest.preview) {
		manifest.preview = replace(manifest.preview);
	}
	for (const mode of ['light', 'dark']) {
		for (const [name, value] of Object.entries(manifest.tokens[mode])) {
			manifest.tokens[mode][name] = rewriteCssResources(value, replace, { context: 'value' });
		}
	}
	const mapField = (field, value) => {
		if (field.type === 'asset' || (field.binding.type === 'content' && field.binding.field === 'src')) {
			return value ? replace(value) : '';
		}
		return field.binding.type === 'variable' && typeof value === 'string' && value !== ''
			? rewriteCssResources(value, replace, { context: 'value' })
			: value;
	};
	for (const field of manifest.settings) {
		field.default = mapField(field, field.default);
		if (field.options) {
			for (const option of field.options) {
				option.value = mapField(field, option.value);
			}
		}
	}
	for (const content of Object.values(manifest.content)) {
		if (content.src) {
			content.src = replace(content.src);
		}
	}
	const files = new Map([
		['2fa-theme.json', encoder.encode(stableStringify(manifest))],
		['theme.css', encoder.encode(rewriteCssResources(pkg.css, replace))],
	]);
	if (appearance) {
		const portable = JSON.parse(JSON.stringify(appearanceProjection(appearance)));
		delete portable.packageId;
		portable.themeId = manifest.id;
		portable.customCss = rewriteCssResources(portable.customCss || '', replace);
		portable.branding ??= {};
		for (const name of ['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background']) {
			if (portable.branding[name]) {
				portable.branding[name] = replace(portable.branding[name]);
			}
		}
		for (const content of Object.values(portable.content ?? {})) {
			if (content.src) {
				content.src = replace(content.src);
			}
		}
		portable.settings ??= {};
		for (const field of pkg.manifest.settings) {
			if (Object.hasOwn(portable.settings, field.key)) {
				portable.settings[field.key] = mapField(field, portable.settings[field.key]);
			}
		}
		files.set('appearance.json', encoder.encode(stableStringify(portable)));
	}
	for (const asset of assets.values()) {
		invariant(asset.bytes instanceof Uint8Array, 'THEME_MISSING_ASSET', { hash: asset.hash });
		files.set(paths.get(asset.hash), asset.bytes);
	}
	// Localizing a short URL can expand a token, setting or manifest beyond its schema limit.
	// Check the exact portable representation now, before import/application is accepted, so every
	// accepted snapshot can later pass the same schema and per-file guards during restoration.
	const portableManifest = validateManifest(readJson(files.get('2fa-theme.json')), { builtin: true });
	if (files.has('appearance.json')) {
		validateAppearance(readJson(files.get('appearance.json')), portableManifest);
	}
	for (const [name, bytes] of files) {
		assertArchiveFileLimit(name, bytes.length);
	}
	return files;
}

function assertPortableBudget(files) {
	const totalBytes = Array.from(files.values()).reduce((sum, bytes) => sum + bytes.length, 0);
	invariant(totalBytes <= LIMITS.totalBytes && files.size <= LIMITS.files, 'THEME_APPEARANCE_LIMIT', { totalBytes, fileCount: files.size });
	return totalBytes;
}

export async function exportTheme(pkg, { appearance, assets = pkg.assets ?? [] } = {}) {
	return packStoredFiles(portableFiles(pkg, appearance, assets));
}

export function getThemeSize(pkg) {
	return utf8Size(pkg.manifest) + utf8Size(pkg.css) + (pkg.assets ?? []).reduce((sum, asset) => sum + asset.bytes.length, 0);
}
