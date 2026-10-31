import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { APP_LIMITS, LIMITS, normalizeDetectedThemeImport, normalizeThemeImport } from '../../src/themes/index.js';
import { appThemeFixture, appPng, encodeAppText as encode } from '../helpers/app-theme.js';

const manifest = { themeApiVersion: 1, id: 'legacy', name: 'Legacy theme', version: '1.0.0', styles: 'theme.css' };
const legacyArchive = (css = 'body{color:red}', extra = {}) =>
	zipSync({ '2fa-theme.json': encode(JSON.stringify(manifest)), 'theme.css': encode(css), ...extra });
const load = (bytes, options = {}) => normalizeDetectedThemeImport({ bytes, name: 'theme.zip' }, options);

afterEach(() => vi.restoreAllMocks());

describe('automatic theme protocol selection', () => {
	it('preserves v1 ZIP imports and accepts only ZIP archives', async () => {
		const input = { bytes: legacyArchive(), name: 'theme.zip' };
		expect(await normalizeDetectedThemeImport(input)).toEqual(await normalizeThemeImport(input));
		for (const input of [
			{ bytes: encode('body{color:red}'), name: 'theme.css' },
			{ bytes: encode(JSON.stringify({ ...manifest, css: 'body{color:red}' })), name: 'theme.json' },
		]) {
			await expect(normalizeDetectedThemeImport(input)).rejects.toMatchObject({ code: 'THEME_INVALID_ZIP' });
		}
	});

	it('uses the v2 file count and CSS bounds without imposing v1 limits', async () => {
		const contents = { 'entry.js': 'export const mount=()=>{};', 'theme.css': '/*' + 'x'.repeat(LIMITS.cssBytes) + '*/' };
		for (let index = 0; index < 70; index++) {
			contents[`chunks/module-${index}.js`] = 'export const value=1;';
		}
		const fixture = await appThemeFixture(contents, { styles: ['theme.css'] });
		const pkg = await load(fixture.archive);
		expect(pkg.kind).toBe('app');
		expect(pkg.files).toHaveLength(72);
		expect(pkg.files.find((file) => file.path === 'theme.css').size).toBeGreaterThan(LIMITS.cssBytes);
		await expect(load(legacyArchive(contents['theme.css']))).rejects.toHaveProperty('code');
	});

	it('keeps Unicode v1 asset paths compatible while still validating app paths separately', async () => {
		const pkg = await load(legacyArchive('body{background:url("images/图标.png")}', { 'images/图标.png': appPng }));
		expect(pkg.manifest.themeApiVersion).toBe(1);
		expect(pkg.assets).toHaveLength(1);
		expect(pkg.assets[0].bytes).toEqual(appPng);
	});

	it('honors explicit app and v1 validators and never retries damaged app hashes as v1', async () => {
		const fixture = await appThemeFixture();
		expect((await load(fixture.archive, { format: 'app' })).kind).toBe('app');
		expect((await load(legacyArchive(), { format: 'v1' })).manifest.themeApiVersion).toBe(1);
		await expect(load(fixture.archive, { format: 'v1' })).rejects.toMatchObject({ code: 'THEME_FILE_TYPE' });
		await expect(load(legacyArchive(), { format: 'app' })).rejects.toMatchObject({ code: 'THEME_UNSUPPORTED_VERSION' });
		const damaged = zipSync({ '2fa-theme.json': encode(JSON.stringify(fixture.manifest)), 'entry.js': encode('export const bad=true;') });
		await expect(load(damaged)).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
	});

	it.each([
		['kind-only', { themeApiVersion: 1, kind: 'app' }, 'THEME_UNSUPPORTED_VERSION'],
		['bad-sdk', { sdkApiVersion: 99 }, 'THEME_UNSUPPORTED_SDK'],
	])('does not downgrade a declared app with %s', async (_label, overrides, code) => {
		const fixture = await appThemeFixture(undefined, overrides);
		await expect(load(fixture.archive)).rejects.toMatchObject({ code });
	});

	it('does not evaluate app JavaScript while detecting and registering a package', async () => {
		const fixture = await appThemeFixture({
			'entry.js': 'throw new Error("MUST NEVER EXECUTE DURING IMPORT"); export const mount=()=>{};',
		});
		expect((await load(fixture.archive)).kind).toBe('app');
	});

	it.each([
		['missing manifest', () => zipSync({ 'theme.css': encode('body{}') }), 'THEME_MISSING_MANIFEST'],
		['malformed manifest', () => legacyArchive('', { '2fa-theme.json': encode('{') }), 'THEME_INVALID_JSON'],
		[
			'oversized manifest',
			() => legacyArchive('', { '2fa-theme.json': new Uint8Array(APP_LIMITS.manifestBytes + 1) }),
			'THEME_MANIFEST_LIMIT',
		],
		['ZIP traversal', () => legacyArchive('', { '../escape.js': encode('export{}') }), 'THEME_INVALID_PATH'],
		['expanded ZIP bomb', () => legacyArchive('', { 'large.png': new Uint8Array(LIMITS.totalBytes + 1) }), 'THEME_PACKAGE_LIMIT'],
		['oversized upload', () => new Uint8Array(LIMITS.upload + 1), 'THEME_UPLOAD_LIMIT'],
	])('rejects %s before installation', async (_label, bytes, code) => {
		await expect(load(bytes())).rejects.toMatchObject({ code });
	});
});
