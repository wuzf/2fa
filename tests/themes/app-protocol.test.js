import { describe, expect, it } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import { build } from 'esbuild';
import { posix } from 'node:path';
import { APP_LIMITS, appMime, validateAppManifest } from '../../src/themes/appSchema.js';
import { packAppFiles, unpackAppTheme } from '../../src/themes/appArchive.js';
import { appResourceHeaders, appResourceUrl } from '../../src/themes/appResources.js';
import { exportAppTheme, normalizeAppAppearance, normalizeAppPackage, normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { hashBytes, LIMITS, stableStringify, validateManifest } from '../../src/themes/schema.js';
import { assetUrl, normalizeAsset } from '../../src/themes/resources.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { normalizeAppearance } from '../../src/themes/package.js';

const encode = (text) => new TextEncoder().encode(text);
const png = Uint8Array.from(
	Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
);
const base = {
	themeApiVersion: 2,
	kind: 'app',
	sdkApiVersion: 1,
	id: 'pixel-test',
	name: 'Pixel test',
	version: '1.0.0',
	entry: 'entry.js',
};
async function fixture(contents = { 'entry.js': 'export const mount = () => {};' }, extra = {}) {
	const files = new Map(Object.entries(contents).map(([path, value]) => [path, typeof value === 'string' ? encode(value) : value]));
	const inventory = await Promise.all(
		Array.from(files, async ([path, bytes]) => ({ path, mime: appMime(path), size: bytes.length, sha256: await hashBytes(bytes) })),
	);
	const manifest = { ...base, ...extra, files: inventory };
	return { manifest, files, archive: zipSync({ '2fa-theme.json': encode(JSON.stringify(manifest)), ...Object.fromEntries(files) }) };
}
const load = (bytes) => normalizeAppThemeImport({ bytes, name: 'theme.zip' });
function pngWithPadding(length) {
	const body = new Uint8Array(length - png.length - 12);
	for (let offset = 0; offset < body.length; offset += 65536) {
		crypto.getRandomValues(body.subarray(offset, Math.min(body.length, offset + 65536)));
	}
	const chunk = new Uint8Array(body.length + 12),
		view = new DataView(chunk.buffer);
	view.setUint32(0, body.length);
	chunk.set(encode('raNd'), 4);
	chunk.set(body, 8);
	let crc = 0xffffffff;
	for (const value of chunk.subarray(4, -4)) {
		crc ^= value;
		for (let i = 0; i < 8; i++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
	const out = new Uint8Array(length);
	out.set(png.subarray(0, -12));
	out.set(chunk, png.length - 12);
	out.set(png.subarray(-12), length - 12);
	return out;
}

describe('app theme package protocol v2', () => {
	it('validates formal versions and settings without requiring the v1 layout/binding protocol', async () => {
		const source = await fixture(
			{ 'entry.js': 'export function mount(){}' },
			{
				settings: [{ key: 'accent', type: 'color', label: 'Accent', default: '#ffdd66' }],
				minHostVersion: '1.13.1',
				capabilities: ['otp.copy'],
			},
		);
		const pkg = await load(source.archive);
		expect(pkg).toMatchObject({ kind: 'app', assets: [], manifest: { themeApiVersion: 2, sdkApiVersion: 1 } });
		expect(pkg.manifest).not.toHaveProperty('layout');
		expect(pkg.manifest.settings[0]).not.toHaveProperty('binding');
		expect(() => validateManifest(pkg.manifest)).toThrow();
		expect(() => validateAppManifest({ ...source.manifest, sdkApiVersion: 'p0-mock-1' })).toThrowError('THEME_UNSUPPORTED_SDK');
		expect(() => validateAppManifest({ ...source.manifest, themeApiVersion: 1 })).toThrowError('THEME_UNSUPPORTED_VERSION');
		expect(() => validateAppManifest({ ...source.manifest, schemaVersion: 2 })).toThrowError('THEME_UNKNOWN_FIELD');
		expect(LIMITS.files).toBe(64);
		expect(LIMITS.cssBytes).toBe(256 * 1024);
	});
	it('uses the entire canonical normalized manifest and inventory as identity, not insertion order', async () => {
		const source = await fixture(
			{ 'entry.js': 'export{}', 'assets/p.png': png },
			{ settings: [{ key: 'picture', type: 'asset', default: 'assets/p.png' }] },
		);
		const a = await normalizeAppPackage(source.manifest, source.files);
		const b = await normalizeAppPackage(
			{ ...source.manifest, files: [...source.manifest.files].reverse(), author: '', styles: [], capabilities: [] },
			source.files,
		);
		expect(a.packageId).toBe(b.packageId);
		expect(a.packageId).toBe(await hashBytes(encode(stableStringify(a.manifest))));
		const changed = await normalizeAppPackage({ ...source.manifest, description: 'changed metadata' }, source.files);
		expect(changed.packageId).not.toBe(a.packageId);
		const restored = await load(await exportAppTheme(a));
		expect(restored.packageId).toBe(a.packageId);
		expect(restored.files).toEqual(a.files);
		const exported = unzipSync(await exportAppTheme(a));
		expect(exported['assets/p.png']).toEqual(png);
		expect(exported['entry.js']).toEqual(source.files.get('entry.js'));
	});
	it('preserves and validates a real minified esbuild graph including export-from, lazy chunks, CSS and import.meta.url', async () => {
		const virtual = {
			'entry.js': `import {value} from './shared.js'; import './theme.css'; export {value} from './shared.js'; export const picture = new URL('./picture.png', import.meta.url); export const details = () => import('./detail.js').then(m => m.detail(value)); export const noise = ["import('https://invalid.example/a.js')", /import\("external"\)/];`,
			'shared.js': 'export const value = 42;',
			'detail.js': `import {value} from './shared.js'; export const detail = async () => [value, await import('./nested.js')];`,
			'nested.js': 'export const ready = true;',
			'theme.css': '.pixel { background: #ffc; }',
		};
		const built = await build({
			entryPoints: ['entry.js'],
			outdir: '/out',
			write: false,
			bundle: true,
			format: 'esm',
			splitting: true,
			minify: true,
			plugins: [
				{
					name: 'fixture',
					setup(build) {
						build.onResolve({ filter: /.*/ }, (args) => ({
							path: args.importer ? posix.join(posix.dirname(args.importer), args.path) : args.path,
							namespace: 'fixture',
						}));
						build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
							contents: virtual[args.path],
							loader: args.path.endsWith('.css') ? 'css' : 'js',
						}));
					},
				},
			],
		});
		const contents = Object.fromEntries(
			built.outputFiles.map((file) => [file.path.replaceAll('\\', '/').split('/out/').at(-1), file.contents]),
		);
		contents['picture.png'] = png;
		const source = await fixture(contents, { styles: ['entry.css'] });
		const pkg = await load(source.archive);
		expect(pkg.files.filter((file) => file.mime === 'text/javascript').length).toBeGreaterThan(2);
		expect((await load(await exportAppTheme(pkg))).packageId).toBe(pkg.packageId);
	});
	it('understands syntax instead of matching strings, comments, regular expressions or property methods', async () => {
		const source = await fixture({
			'entry.js': `// import('https://example.org/bad.js')\nconst text = "export * from 'bad'"; const re = /import\("bad"\)/; const nested = { import(x) { return x; } }; export const result = [text,re,nested.import('ok'),\`import('bad')\`]; export { value } from './other.mjs';`,
			'other.mjs': 'export const value=1;',
		});
		expect((await load(source.archive)).files).toHaveLength(2);
	});
	it.each([
		`import 'https://cdn.example.org/x.js';`,
		`export * from '//cdn.example.org/x.js';`,
		`import 'bare-package';`,
		`import('/root.js');`,
		`const path='./chunk.js'; import(path);`,
		`import('./chunk.js' + '?v=1');`,
		`import('\\x68ttps://cdn.example.org/x.js');`,
		`new URL('https://cdn.example.org/a.png',import.meta.url);`,
		`export * from './missing.js';`,
	])('rejects unsupported or missing dependency references: %s', async (js) => {
		const source = await fixture({ 'entry.js': js });
		await expect(load(source.archive)).rejects.toBeInstanceOf(Error);
	});
	it('validates CSS imports, escaped URLs, image-set, nested relative paths and declared asset defaults', async () => {
		const source = await fixture(
			{
				'entry.js': 'export{}',
				'css/main.css':
					'@import "./nested/colors.css"; .x{background:u\\72l("../images/p.png");image:image-set("../images/p.png" 1x);filter:url(#filter)}',
				'css/nested/colors.css': 'body{color:red}',
				'images/p.png': png,
			},
			{ styles: ['css/main.css'], settings: [{ key: 'image', type: 'asset', default: 'images/p.png' }] },
		);
		expect((await load(source.archive)).files).toHaveLength(4);
		const bad = await fixture({ 'entry.js': 'export{}', 'main.css': '@import "https://example.org/x.css";' }, { styles: ['main.css'] });
		await expect(load(bad.archive)).rejects.toMatchObject({ code: 'THEME_APP_REFERENCE' });
		const missing = await fixture(
			{ 'entry.js': 'export{}' },
			{ settings: [{ key: 'image', type: 'asset', default: 'images/missing.png' }] },
		);
		await expect(load(missing.archive)).rejects.toMatchObject({ code: 'THEME_MISSING_ASSET' });
	});
	it('checks actual file magic, MIME, bytes, hash, syntax and full inventory before registration', async () => {
		const source = await fixture({ 'entry.js': 'export{}', 'images/p.png': png });
		await expect(
			normalizeAppPackage(
				{ ...source.manifest, files: source.manifest.files.map((file) => ({ ...file, sha256: '0'.repeat(64) })) },
				source.files,
			),
		).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
		await expect(normalizeAppPackage(source.manifest, new Map([...source.files, ['extra.js', encode('export{}')]]))).rejects.toMatchObject({
			code: 'THEME_APP_INVENTORY',
		});
		const badImage = await fixture({ 'entry.js': 'export{}', 'fake.png': encode('<html>not image</html>') });
		await expect(load(badImage.archive)).rejects.toMatchObject({ code: 'THEME_ASSET_TYPE' });
		const badJS = await fixture({ 'entry.js': 'export {' });
		await expect(load(badJS.archive)).rejects.toMatchObject({ code: 'THEME_APP_JAVASCRIPT' });
		const extra = unzipSync(source.archive);
		extra['extra.js'] = encode('export{}');
		await expect(load(zipSync(extra))).rejects.toMatchObject({ code: 'THEME_APP_INVENTORY' });
	});
	it.each(['index.html', 'vector.svg', 'evil.js.map', 'notice.txt', '../escape.js', '/root.js', 'a%2fb.js', 'a\\b.js', 'bad/../x.js'])(
		'rejects disallowed package path/type %s',
		async (path) => {
			const source = await fixture();
			const zip = unzipSync(source.archive);
			zip[path] = encode('x');
			await expect(load(zipSync(zip))).rejects.toBeInstanceOf(Error);
		},
	);
	it('rejects aliases, symlinks, encryption, corrupted CRC, inconsistent metadata and malformed ZIP', async () => {
		const source = await fixture();
		await expect(load(zipSync({ ...unzipSync(source.archive), 'ENTRY.js': encode('export{}') }))).rejects.toMatchObject({
			code: 'THEME_DUPLICATE_PATH',
		});
		for (const mutate of [
			(view, center) => view.setUint32(center + 38, 0xa0000000, true),
			(view, center) => view.setUint16(center + 8, 1, true),
			(view, center) => {
				const local = view.getUint32(center + 42, true);
				view.setUint32(center + 16, 123, true);
				view.setUint32(local + 14, 123, true);
			},
			(view, center) => view.setUint32(center + 24, 1, true),
		]) {
			const bytes = packAppFiles(new Map(Object.entries(unzipSync(source.archive)))),
				view = new DataView(bytes.buffer);
			const end = bytes.length - 22,
				center = view.getUint32(end + 16, true);
			mutate(view, center);
			await expect(load(bytes)).rejects.toBeInstanceOf(Error);
		}
		await expect(load(source.archive.subarray(0, -2))).rejects.toMatchObject({ code: 'THEME_INVALID_ZIP' });
	});
	it('requires pure settings data and rejects unregistered personal or remote asset references', async () => {
		const source = await fixture(
			{ 'entry.js': 'export{}' },
			{
				settings: [
					{ key: 'image', type: 'asset', default: '' },
					{ key: 'scale', type: 'number', default: 2, min: 1, max: 4 },
				],
			},
		);
		const pkg = await load(source.archive);
		await expect(normalizeAppAppearance(pkg, { settings: { image: 'https://example.org/bg.png' } })).rejects.toMatchObject({
			code: 'THEME_MISSING_ASSET',
		});
		await expect(normalizeAppAppearance(pkg, { settings: { scale: 8 } })).rejects.toMatchObject({ code: 'THEME_INVALID_SETTING' });
		await expect(normalizeAppAppearance(pkg, { settings: { scale: () => 2 } })).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
		const getter = {};
		Object.defineProperty(getter, 'scale', {
			enumerable: true,
			get() {
				throw new Error('must not execute');
			},
		});
		await expect(normalizeAppAppearance(pkg, { settings: getter })).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
		const cyclic = {};
		cyclic.settings = cyclic;
		await expect(normalizeAppAppearance(pkg, cyclic)).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
	});
	it('preserves the complete existing v1 branding through app normalization, portable export and restoration', async () => {
		const image = await normalizeAsset(png, 'brand.png');
		const branding = {
			name: '我的像素 2FA',
			description: '保留自定义说明\n以及第二行',
			loginText: '欢迎回来，请解锁你的账户',
			footer: 'Personal vault · 2026',
			logo: assetUrl(image),
			icon192: assetUrl(image),
			icon512: assetUrl(image),
			appleTouchIcon: assetUrl(image),
			background: assetUrl(image),
		};
		const v1 = await normalizeAppearance(
			getBuiltinTheme(),
			{ branding },
			{ resolveAsset: async (hash) => (hash === image.hash ? image : null) },
		);
		expect(v1.appearance.branding).toEqual(branding);
		const pkg = await load((await fixture()).archive);
		const saved = await normalizeAppAppearance(pkg, { branding: v1.appearance.branding }, { assets: v1.assets });
		expect(saved.appearance.branding).toEqual(branding);
		const zip = await exportAppTheme(pkg, { appearance: saved.appearance, assets: saved.assets });
		const portable = JSON.parse(new TextDecoder().decode(unzipSync(zip)['appearance.json']));
		expect(portable.branding).toEqual({
			...branding,
			...Object.fromEntries(
				['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background'].map((key) => [key, 'appearance-assets/' + image.name]),
			),
		});
		const restored = await load(zip);
		expect(restored.packageId).toBe(pkg.packageId);
		expect(restored.appearance.branding).toEqual(branding);
		expect(restored.appearanceAssets).toHaveLength(1);
		expect(restored.appearanceAssets[0].bytes).toEqual(png);
		expect((await normalizeAppAppearance(restored, restored.appearance)).appearance.branding).toEqual(branding);
	});
	it('never resolves or rewrites brand text that happens to look like an asset reference', async () => {
		const reference = '/theme-assets/' + 'a'.repeat(64) + '/label.png';
		const branding = { name: reference, description: reference, loginText: reference, footer: reference };
		const pkg = await load((await fixture()).archive);
		const saved = await normalizeAppAppearance(pkg, { branding });
		expect(saved.assets).toEqual([]);
		const zip = await exportAppTheme(pkg, { appearance: saved.appearance });
		expect(JSON.parse(new TextDecoder().decode(unzipSync(zip)['appearance.json'])).branding).toEqual(branding);
		expect((await load(zip)).appearance.branding).toEqual(branding);
	});
	it.each(['name', 'description', 'loginText', 'footer'])(
		'preserves v1 %s text limits and rejects malformed values at save and restore',
		async (field) => {
			const pkg = await load((await fixture()).archive);
			const branding = { [field]: '像'.repeat(2048) };
			const v1 = await normalizeAppearance(getBuiltinTheme(), { branding });
			const saved = await normalizeAppAppearance(pkg, { branding: v1.appearance.branding });
			const zip = await exportAppTheme(pkg, { appearance: saved.appearance });
			expect((await load(zip)).appearance.branding[field]).toBe(branding[field]);
			for (const value of ['x'.repeat(2049), 'invalid\0text', 123, false, {}, []]) {
				await expect(normalizeAppAppearance(pkg, { branding: { [field]: value } })).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
				const files = unzipSync(zip);
				const appearance = JSON.parse(new TextDecoder().decode(files['appearance.json']));
				appearance.branding[field] = value;
				files['appearance.json'] = encode(JSON.stringify(appearance));
				await expect(load(zipSync(files))).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
			}
		},
	);
	it('keeps v1 null-to-empty brand semantics and rejects unknown brand fields', async () => {
		const pkg = await load((await fixture()).archive);
		const branding = {
			name: null,
			description: null,
			loginText: null,
			footer: null,
			logo: null,
			icon192: null,
			icon512: null,
			appleTouchIcon: null,
			background: null,
		};
		const v1 = await normalizeAppearance(getBuiltinTheme(), { branding });
		const saved = await normalizeAppAppearance(pkg, { branding });
		expect(saved.appearance.branding).toEqual(v1.appearance.branding);
		expect((await load(await exportAppTheme(pkg, { appearance: saved.appearance }))).appearance.branding).toEqual(v1.appearance.branding);
		await expect(normalizeAppAppearance(pkg, { branding: { unsupported: 'value' } })).rejects.toMatchObject({
			code: 'THEME_UNKNOWN_FIELD',
		});
	});
	it('round trips a legal near-limit full appearance including manifest, license, personal assets and STORE ZIP overhead', async () => {
		const source = await fixture(
			{
				'entry.js': 'export{}',
				'licenses/MIT.txt': 'MIT\n' + 'License notice '.repeat(2048),
				'images/base.png': pngWithPadding(2 * 1024 * 1024),
			},
			{ settings: [{ key: 'image', type: 'asset', default: 'images/base.png' }] },
		);
		const pkg = await load(source.archive),
			small = await normalizeAsset(png, 'personal.png');
		const settings = (asset) => ({ settings: { image: assetUrl(asset) }, branding: { name: 'Personal pixel', logo: assetUrl(asset) } });
		const baseline = await normalizeAppAppearance(pkg, settings(small), { assets: [small] });
		const exactSize = png.length + APP_LIMITS.totalBytes - baseline.totalBytes;
		const asset = await normalizeAsset(pngWithPadding(exactSize), 'personal.png');
		const saved = await normalizeAppAppearance(pkg, settings(asset), { assets: [asset] });
		expect(saved.totalBytes).toBe(APP_LIMITS.totalBytes);
		const zip = await exportAppTheme(pkg, { appearance: saved.appearance, assets: saved.assets });
		expect(zip.length).toBeGreaterThan(APP_LIMITS.totalBytes);
		expect(zip.length).toBeLessThanOrEqual(APP_LIMITS.upload);
		const restored = await load(zip);
		expect(restored.appearance).toEqual(saved.appearance);
		expect(restored.packageId).toBe(pkg.packageId);
		expect(Buffer.compare(restored.appearanceAssets[0].bytes, asset.bytes)).toBe(0);
		expect(restored.totalBytes).toBe(APP_LIMITS.totalBytes);
		expect((await exportAppTheme(restored)).length).toBe(zip.length);
		const tooLarge = await normalizeAsset(pngWithPadding(exactSize + 1), 'personal.png');
		await expect(normalizeAppAppearance(pkg, settings(tooLarge), { assets: [tooLarge] })).rejects.toMatchObject({
			code: 'THEME_APPEARANCE_LIMIT',
		});
	}, 30000);
	it('counts manifest and appearance files against the 256-file portable budget', async () => {
		const contents = { 'entry.js': 'export{}' };
		for (let i = 0; i < 254; i++) {
			contents[`data/${i}.json`] = '{}';
		}
		const source = await fixture(contents),
			pkg = await load(source.archive);
		expect(pkg.fileCount).toBe(256);
		await expect(normalizeAppAppearance(pkg, {})).rejects.toMatchObject({ code: 'THEME_APPEARANCE_LIMIT' });
	});
	it('returns stable public paths and restrictive headers without implicitly granting CORS or publication', async () => {
		const pkg = await load((await fixture()).archive),
			file = pkg.files[0];
		expect(appResourceUrl(pkg.packageId, file.path)).toBe(`/theme-packages/${pkg.packageId}/entry.js`);
		expect(appResourceHeaders(file)).toMatchObject({
			'Content-Type': 'text/javascript',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-store',
		});
		expect(appResourceHeaders(file, { public: true })['Cache-Control']).toContain('immutable');
		expect(appResourceHeaders(file)).not.toHaveProperty('Access-Control-Allow-Origin');
		expect(unpackAppTheme(await exportAppTheme(pkg)).get('entry.js')).toEqual(file.bytes);
	});
	it('rejects declared oversize files, manifest expansion and an oversized input before extraction', async () => {
		const source = await fixture();
		expect(() =>
			validateAppManifest({ ...source.manifest, files: [{ ...source.manifest.files[0], size: APP_LIMITS.jsBytes + 1 }] }),
		).toThrowError('THEME_APP_JS_LIMIT');
		const css = await fixture({ 'entry.js': 'export{}', 'main.css': '' }, { styles: ['main.css'] });
		expect(() =>
			validateAppManifest({
				...css.manifest,
				files: css.manifest.files.map((file) => (file.path === 'main.css' ? { ...file, size: APP_LIMITS.cssBytes + 1 } : file)),
			}),
		).toThrowError('THEME_CSS_LIMIT');
		expect(() =>
			validateAppManifest({
				...source.manifest,
				settings: Array.from({ length: 9 }, (_, i) => ({ key: 'text' + i, type: 'textarea', default: 'a'.repeat(16384) })),
			}),
		).toThrowError('THEME_MANIFEST_LIMIT');
		expect(() => unpackAppTheme(new Uint8Array(APP_LIMITS.upload + 1))).toThrowError('THEME_UPLOAD_LIMIT');
	});
	it('uses actual inflated bytes even when a compressed stream lies about its declared output size', () => {
		const bytes = zipSync({ 'licenses/large.txt': encode('x'.repeat(2 * 1024 * 1024)) }, { level: 9 });
		const view = new DataView(bytes.buffer),
			center = view.getUint32(bytes.length - 22 + 16, true);
		view.setUint32(center + 24, 1, true);
		view.setUint32(view.getUint32(center + 42, true) + 22, 1, true);
		expect(() => unpackAppTheme(bytes)).toThrowError('THEME_INVALID_ZIP');
	});
	it('rejects sparse schema arrays, non-string setting names and file/directory aliases', async () => {
		const source = await fixture();
		const settings = [];
		settings.length = 2;
		settings[1] = { key: 'a', type: 'boolean', default: true };
		expect(() => validateAppManifest({ ...source.manifest, settings })).toThrowError('THEME_INVALID_FIELD');
		expect(() => validateAppManifest({ ...source.manifest, settings: [{ key: null, type: 'boolean', default: true }] })).toThrowError(
			'THEME_INVALID_SETTINGS',
		);
		expect(() => appMime('bad.constructor')).toThrowError('THEME_FILE_TYPE');
		const alias = await fixture({ 'entry.js': 'export{}', 'entry.js/data.json': '{}' });
		await expect(load(alias.archive)).rejects.toMatchObject({ code: 'THEME_DUPLICATE_PATH' });
	});
});
