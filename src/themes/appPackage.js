import { ThemeError, invariant, hashBytes, stableStringify } from './schema.js';
import { decodeText } from './resources.js';
import { appRecord, assertAppData, validateAppManifest, validateAppSettings } from './appSchema.js';
import { assertAppPortableBudget, unpackAppTheme } from './appArchive.js';
import { normalizeAppFile, validateAppReferences } from './appResources.js';
import {
	PUBLIC_APPEARANCE_PATH,
	PUBLIC_APPEARANCE_LIMITS,
	normalizePublicAppearanceDescriptor,
	resolvePublicAppearance,
} from './publicAppearance.js';

const encoder = new TextEncoder();
function readJson(bytes) {
	try {
		return JSON.parse(decodeText(bytes));
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_JSON');
	}
}
function portableFiles(pkg) {
	const files = new Map([['2fa-theme.json', encoder.encode(stableStringify(pkg.manifest))]]);
	for (const file of pkg.files) {
		files.set(file.path, file.bytes);
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
function appearanceForPackage(pkg, input) {
	assertAppData(input);
	appRecord(input, ['packageId', 'themeId', 'settings']);
	invariant(input.packageId === undefined || input.packageId === pkg.packageId, 'THEME_APP_HASH');
	invariant(input.themeId === undefined || input.themeId === pkg.manifest.id, 'THEME_INVALID_ID');
	const settings = validateAppSettings(pkg.manifest, input.settings);
	const appearance = { packageId: pkg.packageId, themeId: pkg.manifest.id, settings };
	const publicAppearance = resolvePublicAppearance(pkg, settings);
	if (publicAppearance) {
		appearance.publicAppearance = publicAppearance;
	}
	return { appearance };
}
/** Settings are checked against the exact installed package bytes. */
export async function normalizeAppAppearance(pkg, input = {}) {
	return appearanceForPackage(await verifyPackage(pkg), input);
}
/** Same as normalizeAppAppearance, and also returns the verified package. */
export async function normalizeAppPackageWithAppearance(pkg, input = {}) {
	const current = await verifyPackage(pkg);
	return { pkg: current, ...appearanceForPackage(current, input) };
}
export async function normalizeAppThemeImport(input) {
	invariant(input?.bytes instanceof Uint8Array || input?.bytes instanceof ArrayBuffer, 'THEME_INVALID_ZIP');
	const archive = unpackAppTheme(input.bytes);
	invariant(archive.has('2fa-theme.json'), 'THEME_MISSING_MANIFEST');
	const manifest = validateAppManifest(readJson(archive.get('2fa-theme.json')));
	const fileMap = new Map(manifest.files.map((file) => [file.path, archive.get(file.path)]));
	for (const path of archive.keys()) {
		invariant(path === '2fa-theme.json' || fileMap.has(path), 'THEME_APP_INVENTORY', { path });
	}
	return normalizeAppPackage(manifest, fileMap);
}
