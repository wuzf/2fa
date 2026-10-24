import { ThemeError, invariant, hashBytes, stableStringify } from './schema.js';
import { assetHashFromUrl, assetUrl, decodeText, normalizeAsset } from './resources.js';
import { appRecord, assertAppData, validateAppManifest, validateAppSettings } from './appSchema.js';
import { assertAppPortableBudget, unpackAppTheme, packAppFiles } from './appArchive.js';
import { normalizeAppFile, validateAppReferences } from './appResources.js';
import {
	PUBLIC_APPEARANCE_PATH,
	PUBLIC_APPEARANCE_LIMITS,
	normalizePublicAppearanceDescriptor,
	resolvePublicAppearance,
} from './publicAppearance.js';

const encoder = new TextEncoder();
const BRAND_TEXT_FIELDS = ['name', 'description', 'loginText', 'footer'];
const BRAND_ASSET_FIELDS = ['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background'];
function readJson(bytes) {
	try {
		return JSON.parse(decodeText(bytes));
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_JSON');
	}
}
function isAsset(file) {
	return file && (file.mime.startsWith('image/') || file.mime === 'font/woff2');
}
function portableFiles(pkg, appearance, assets = []) {
	const files = new Map([['2fa-theme.json', encoder.encode(stableStringify(pkg.manifest))]]);
	for (const file of pkg.files) {
		files.set(file.path, file.bytes);
	}
	if (appearance) {
		const personal = new Map(assets.map((asset) => [asset.hash, asset]));
		const localize = (value) => {
			const hash = assetHashFromUrl(value);
			if (!hash) {
				return value;
			}
			invariant(personal.has(hash), 'THEME_MISSING_ASSET', { hash });
			return 'appearance-assets/' + personal.get(hash).name;
		};
		const settings = { ...appearance.settings },
			branding = { ...appearance.branding };
		for (const field of pkg.manifest.settings) {
			if (field.type === 'asset') {
				settings[field.key] = localize(settings[field.key]);
			}
		}
		for (const key of BRAND_ASSET_FIELDS) {
			if (Object.hasOwn(branding, key)) {
				branding[key] = localize(branding[key]);
			}
		}
		files.set(
			'appearance.json',
			encoder.encode(stableStringify({ packageId: pkg.packageId, themeId: pkg.manifest.id, settings, branding })),
		);
		for (const asset of personal.values()) {
			files.set('appearance-assets/' + asset.name, asset.bytes);
		}
	}
	return files;
}

/** Pure package registration: no publication, network fetch, DOM work or executable evaluation. */
export async function normalizeAppPackage(input, inputFiles) {
	const manifest = validateAppManifest(input);
	invariant(inputFiles instanceof Map && inputFiles.size === manifest.files.length, 'THEME_APP_INVENTORY');
	const files = [];
	for (const expected of manifest.files) {
		if (expected.path === PUBLIC_APPEARANCE_PATH) {
			invariant(expected.size <= PUBLIC_APPEARANCE_LIMITS.bytes, 'THEME_PUBLIC_APPEARANCE_LIMIT');
		}
		invariant(inputFiles.has(expected.path), 'THEME_MISSING_FILE', { path: expected.path });
		files.push(await normalizeAppFile(expected.path, inputFiles.get(expected.path), expected));
	}
	validateAppReferences(files);
	for (const field of manifest.settings) {
		if (field.type === 'asset' && field.default) {
			invariant(isAsset(files.find((file) => file.path === field.default)), 'THEME_MISSING_ASSET', { path: field.default });
		}
	}
	const packageId = await hashBytes(encoder.encode(stableStringify(manifest)));
	const pkg = { kind: 'app', manifest, packageId, files, assets: [] };
	const publicFile = files.find((file) => file.path === PUBLIC_APPEARANCE_PATH);
	if (publicFile) {
		invariant(publicFile.size <= PUBLIC_APPEARANCE_LIMITS.bytes, 'THEME_PUBLIC_APPEARANCE_LIMIT');
		pkg.publicAppearanceDescriptor = normalizePublicAppearanceDescriptor(readJson(publicFile.bytes), { manifest, files });
	}
	Object.assign(pkg, assertAppPortableBudget(portableFiles(pkg)));
	return pkg;
}
async function verifyPackage(pkg) {
	invariant(pkg && Array.isArray(pkg.files), 'THEME_APP_INVENTORY');
	const current = await normalizeAppPackage(pkg.manifest, new Map(pkg.files.map((file) => [file.path, file.bytes])));
	invariant(pkg.files.length === current.files.length && pkg.packageId === current.packageId, 'THEME_APP_HASH');
	return current;
}
async function appearanceForPackage(pkg, input, suppliedAssets) {
	assertAppData(input);
	appRecord(input, ['packageId', 'themeId', 'settings', 'branding']);
	invariant(input.packageId === undefined || input.packageId === pkg.packageId, 'THEME_APP_HASH');
	invariant(input.themeId === undefined || input.themeId === pkg.manifest.id, 'THEME_INVALID_ID');
	const assets = new Map();
	for (const supplied of suppliedAssets) {
		const asset = await normalizeAsset(supplied.bytes, supplied.name);
		invariant(supplied.hash === asset.hash, 'THEME_ASSET_HASH_MISMATCH');
		assets.set(asset.hash, asset);
	}
	const used = new Set();
	const resolveAsset = (value) => {
		if (!value) {
			return '';
		}
		const hash = assetHashFromUrl(value) ?? /^appearance-assets\/([a-f0-9]{64})\.(?:png|jpg|gif|webp|woff2)$/.exec(value)?.[1];
		if (hash) {
			const asset = assets.get(hash);
			invariant(asset, 'THEME_MISSING_ASSET', { hash });
			if (value.startsWith('appearance-assets/')) {
				invariant(value === 'appearance-assets/' + asset.name, 'THEME_ASSET_TYPE');
			}
			used.add(hash);
			return assetUrl(asset);
		}
		invariant(isAsset(pkg.files.find((file) => file.path === value)), 'THEME_MISSING_ASSET', { path: value });
		return value;
	};
	const settings = validateAppSettings(pkg.manifest, input.settings);
	for (const field of pkg.manifest.settings) {
		if (field.type === 'asset') {
			settings[field.key] = resolveAsset(settings[field.key]);
		}
	}
	const brand = input.branding ?? {};
	appRecord(brand, [...BRAND_TEXT_FIELDS, ...BRAND_ASSET_FIELDS]);
	const branding = {};
	for (const [key, value] of Object.entries(brand)) {
		// Preserve the existing v1 brand text contract: null becomes empty, all
		// fields allow 2048 characters and NUL is rejected. Text is never an asset.
		const text = value ?? '';
		invariant(typeof text === 'string' && text.length <= 2048 && !text.includes('\0'), 'THEME_INVALID_FIELD', { field: 'brand.' + key });
		branding[key] = BRAND_TEXT_FIELDS.includes(key) ? text : resolveAsset(text);
	}
	const appearance = { packageId: pkg.packageId, themeId: pkg.manifest.id, settings, branding };
	const publicAppearance = resolvePublicAppearance(pkg, settings);
	if (publicAppearance) {
		appearance.publicAppearance = publicAppearance;
	}
	const retained = Array.from(used, (hash) => assets.get(hash));
	const portable = portableFiles(pkg, appearance, retained);
	return { appearance, assets: retained, resourceHashes: retained.map((asset) => asset.hash), ...assertAppPortableBudget(portable) };
}

export async function normalizeAppAppearance(pkg, input = {}, { assets = pkg.appearanceAssets ?? [] } = {}) {
	return appearanceForPackage(await verifyPackage(pkg), input, assets);
}
/** Internal composition: validate the package once, then use only that result for its appearance. */
export async function normalizeAppPackageWithAppearance(pkg, input = {}, { assets = pkg.appearanceAssets ?? [] } = {}) {
	const current = await verifyPackage(pkg);
	return { pkg: current, ...(await appearanceForPackage(current, input, assets)) };
}
export async function normalizeAppThemeImport(input) {
	invariant(input?.bytes instanceof Uint8Array || input?.bytes instanceof ArrayBuffer, 'THEME_INVALID_ZIP');
	const archive = unpackAppTheme(input.bytes);
	invariant(archive.has('2fa-theme.json'), 'THEME_MISSING_MANIFEST');
	const manifest = validateAppManifest(readJson(archive.get('2fa-theme.json')));
	const fileMap = new Map(manifest.files.map((file) => [file.path, archive.get(file.path)]));
	const pkg = await normalizeAppPackage(manifest, fileMap);
	const personal = [];
	for (const [path, bytes] of archive) {
		if (path === '2fa-theme.json' || path === 'appearance.json' || fileMap.has(path)) {
			continue;
		}
		invariant(
			/^appearance-assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|woff2)$/.test(path) && archive.has('appearance.json'),
			'THEME_APP_INVENTORY',
			{ path },
		);
		const asset = await normalizeAsset(bytes, path);
		invariant(path === 'appearance-assets/' + asset.name, 'THEME_ASSET_HASH_MISMATCH');
		personal.push(asset);
	}
	if (archive.has('appearance.json')) {
		const result = await appearanceForPackage(pkg, readJson(archive.get('appearance.json')), personal);
		invariant(result.assets.length === personal.length, 'THEME_APP_INVENTORY');
		Object.assign(pkg, {
			appearance: result.appearance,
			appearanceAssets: result.assets,
			totalBytes: result.totalBytes,
			fileCount: result.fileCount,
		});
	}
	return pkg;
}
export async function exportAppTheme(pkg, { appearance = pkg.appearance, assets = pkg.appearanceAssets ?? [] } = {}) {
	const current = await verifyPackage(pkg);
	// The projection is internal derived state, never portable input. Recompute
	// it from verified package bytes/settings when re-exporting a restored pkg.
	if (appearance) {
		assertAppData(appearance);
		appRecord(appearance, ['packageId', 'themeId', 'settings', 'branding', 'publicAppearance']);
	}
	const portableAppearance = appearance ? { ...appearance } : undefined;
	if (portableAppearance) {
		delete portableAppearance.publicAppearance;
	}
	const normalized = portableAppearance ? await appearanceForPackage(current, portableAppearance, assets) : undefined;
	return packAppFiles(portableFiles(current, normalized?.appearance, normalized?.assets));
}
export function getAppThemeSize(pkg) {
	return assertAppPortableBudget(portableFiles(pkg, pkg.appearance, pkg.appearanceAssets ?? [])).totalBytes;
}
