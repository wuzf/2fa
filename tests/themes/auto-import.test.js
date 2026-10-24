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
	it('preserves v1 ZIP, standalone CSS, and both JSON manifest forms', async () => {
		const inputs = [
			{ bytes: legacyArchive(), name: 'theme.zip' },
			{ bytes: encode('body{color:red}'), name: 'theme.css' },
			{ bytes: encode(JSON.stringify({ ...manifest, css: 'body{color:red}' })), name: 'theme.json' },
			{ bytes: encode(JSON.stringify({ manifest, css: 'body{color:red}' })), name: 'theme.json' },
		];
		for (const input of inputs) {
			expect(await normalizeDetectedThemeImport(input)).toEqual(await normalizeThemeImport(input));
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

	it('downloads a v1 source and its dependencies once with relative URLs intact', async () => {
		const fetcher = vi.fn(async (url) =>
			url.endsWith('theme.css') ? new Response('body{background:url(image.png)}') : new Response(appPng),
		);
		const pkg = await normalizeDetectedThemeImport({ url: 'https://cdn.example.org/styles/theme.css' }, { fetcher });
		expect(pkg.assets).toHaveLength(1);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'https://cdn.example.org/styles/theme.css',
			'https://cdn.example.org/styles/image.png',
		]);
	});

	it.each(['https://github.com/owner/theme', 'https://github.com/owner/theme/releases/tag/v1.0.0'])(
		'resolves %s and downloads the app release exactly once',
		async (url) => {
			const fixture = await appThemeFixture();
			const fetcher = vi.fn(async (location) =>
				location.startsWith('https://api.github.com/')
					? Response.json({ assets: [{ name: '2fa-theme.zip', browser_download_url: 'https://cdn.example.org/2fa-theme.zip' }] })
					: new Response(fixture.archive),
			);
			const pkg = await normalizeDetectedThemeImport({ url }, { fetcher });
			expect(pkg.kind).toBe('app');
			expect(fetcher.mock.calls.map(([location]) => location)).toEqual([
				'https://api.github.com/repos/owner/theme/releases/' + (url.endsWith('v1.0.0') ? 'tags/v1.0.0' : 'latest'),
				'https://cdn.example.org/2fa-theme.zip',
			]);
		},
	);

	it('preserves the shared request budget across discovery, source download, and v1 dependencies', async () => {
		const css = Array.from({ length: LIMITS.requests }, (_, index) => `@import "https://cdn.example.org/dep-${index}.css";`).join('');
		const fetcher = vi.fn(async (url) => {
			if (url.startsWith('https://api.github.com/')) {
				return Response.json({ assets: [{ name: '2fa-theme.zip', browser_download_url: 'https://cdn.example.org/2fa-theme.zip' }] });
			}
			return new Response(url.endsWith('.zip') ? legacyArchive(css) : 'body{color:red}');
		});
		await expect(normalizeDetectedThemeImport({ url: 'https://github.com/owner/theme' }, { fetcher })).rejects.toMatchObject({
			code: 'THEME_REQUEST_LIMIT',
		});
		expect(fetcher).toHaveBeenCalledTimes(LIMITS.requests);
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
