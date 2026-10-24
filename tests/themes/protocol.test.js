import { describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import {
	LIMITS,
	assertPublicUrl,
	exportTheme,
	getBuiltinTheme,
	getBuiltinThemes,
	migrateSettings,
	normalizeAppearance,
	normalizeAsset,
	normalizeThemeImport,
	readBodyLimited,
	validateManifest,
} from '../../src/themes/index.js';

const encoder = new TextEncoder();
const png = Uint8Array.from(
	Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
);
const manifest = (overrides = {}) => ({
	themeApiVersion: 1,
	id: 'test',
	name: 'Test',
	version: '1.0.0',
	styles: 'theme.css',
	...overrides,
});
const archive = (css = 'body{color:red}', extra = {}, meta = {}) =>
	zipSync({ '2fa-theme.json': encoder.encode(JSON.stringify(manifest(meta))), 'theme.css': encoder.encode(css), ...extra });
const load = (bytes, options = {}) => normalizeThemeImport({ bytes, name: 'theme.zip' }, options);

// A valid PNG with an unknown ancillary chunk. Random bytes make ZIP compression ineffective.
function paddedPng(length, random = true) {
	const data = new Uint8Array(length - png.length - 12);
	if (random) {
		for (let offset = 0; offset < data.length; offset += 65536) {
			crypto.getRandomValues(data.subarray(offset, Math.min(offset + 65536, data.length)));
		}
	}
	const chunk = new Uint8Array(data.length + 12);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length);
	chunk.set(encoder.encode('raNd'), 4);
	chunk.set(data, 8);
	let crc = 0xffffffff;
	for (const value of chunk.subarray(4, chunk.length - 4)) {
		crc ^= value;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
	const output = new Uint8Array(length);
	output.set(png.subarray(0, png.length - 12));
	output.set(chunk, png.length - 12);
	output.set(png.subarray(png.length - 12), output.length - 12);
	return output;
}

describe('data-only theme protocol', () => {
	it('supplies three distinct themes through the same validated protocol', () => {
		const themes = getBuiltinThemes();
		expect(themes.map((theme) => theme.manifest.id)).toEqual(['fluent', 'document', 'compact']);
		for (const theme of themes) {
			expect(validateManifest(theme.manifest)).toEqual(theme.manifest);
		}
		themes[0].manifest.name = 'mutated';
		expect(getBuiltinTheme().manifest.name).toBe('Fluent');
	});

	it('imports local assets and escaped CSS URLs, and exports a stable portable theme', async () => {
		const pkg = await load(
			archive('a{background:u\\72l("images/p.png");mask-image:image-set("images/p.png" 1x,url(images/p.png) 2x)}', { 'images/p.png': png }),
		);
		expect(pkg.assets).toHaveLength(1);
		expect(pkg.css).toContain('/theme-assets/' + pkg.assets[0].hash);
		expect(pkg.css).not.toContain('images/p.png');
		const exported = await exportTheme(pkg);
		expect(new TextDecoder().decode(unzipSync(exported)['theme.css'])).not.toContain('/theme-assets/');
		const roundtrip = await load(exported);
		expect(roundtrip.packageId).toBe(pkg.packageId);
		expect(roundtrip.assets[0].bytes).toEqual(png);
	});

	it('rejects token expansion that would produce an unrestorable portable manifest', async () => {
		const value = Array(30).fill('url(a.png)').join(',');
		expect(value.length).toBeLessThan(2048);
		await expect(load(archive('', { 'a.png': png }, { tokens: { light: { '--theme-bg': value } } }))).rejects.toMatchObject({
			code: 'THEME_INVALID_FIELD',
			details: { field: '--theme-bg' },
		});
	});

	it('round trips repeated asset tokens that remain within portable field limits', async () => {
		const value = Array(20).fill('url(a.png)').join(',');
		const pkg = await load(archive('', { 'a.png': png }, { tokens: { light: { '--theme-bg': value } } }));
		const exported = await exportTheme(pkg);
		const portable = JSON.parse(new TextDecoder().decode(unzipSync(exported)['2fa-theme.json']));
		expect(portable.tokens.light['--theme-bg'].length).toBeLessThanOrEqual(2048);
		expect((await load(exported)).packageId).toBe(pkg.packageId);
	});

	it('rejects total manifest expansion even when every rewritten token fits its field limit', async () => {
		const tokens = Object.fromEntries(
			Array.from({ length: 50 }, (_, index) => ['--theme-bg-' + index, Array(20).fill('url(a.png)').join(',')]),
		);
		await expect(load(archive('', { 'a.png': png }, { tokens: { light: tokens } }))).rejects.toMatchObject({
			code: 'THEME_MANIFEST_LIMIT',
		});
	});

	it('round trips a compressed 6 MiB theme through an ordinary STORE export and import', async () => {
		const image = paddedPng(6 * 1024 * 1024, false);
		const compressed = archive('body{background:url(a.png)}', { 'a.png': image });
		expect(compressed.length).toBeLessThan(5 * 1024 * 1024);
		const pkg = await load(compressed);
		const exported = await exportTheme(pkg);
		expect(exported.length).toBeGreaterThan(5 * 1024 * 1024);
		expect(exported.length).toBeLessThanOrEqual(LIMITS.upload);
		const restored = await load(exported);
		expect(restored.packageId).toBe(pkg.packageId);
		expect(Buffer.compare(restored.assets[0].bytes, image)).toBe(0);
	});

	it('imports CSS and JSON shortcut formats', async () => {
		const css = await normalizeThemeImport({ bytes: encoder.encode('a{color:blue}'), name: 'mine.css' });
		expect(css.manifest.name).toBe('mine');
		const json = await normalizeThemeImport({
			bytes: encoder.encode(JSON.stringify({ manifest: manifest(), css: '.x{color:red}' })),
			name: 'mine.json',
		});
		expect(json.css).toBe('.x{color:red}');
	});

	it('exports built-in themes as ordinary editable packages without allowing built-in replacement', async () => {
		const imported = await load(await exportTheme(getBuiltinTheme()));
		expect(imported.manifest.id).toBe('fluent');
		expect(imported.packageId).toMatch(/^[a-f0-9]{64}$/);
		expect(imported.builtin).toBeUndefined();
	});

	it('flattens CSS imports and preserves layer, supports and media conditions', async () => {
		const pkg = await load(
			archive('@import "sub/a.css" layer(cards) supports(display:grid) screen;', {
				'sub/a.css': encoder.encode('a{background:url(../images/p.png)}'),
				'images/p.png': png,
			}),
		);
		expect(pkg.css).toContain('@layer cards');
		expect(pkg.css).toContain('@supports (display:grid)');
		expect(pkg.css).toContain('@media screen');
		expect(pkg.css).not.toContain('@import');
	});

	it('rejects cycles and excessive CSS import depth', async () => {
		await expect(load(archive('@import "b.css";', { 'b.css': encoder.encode('@import "theme.css";') }))).rejects.toMatchObject({
			code: 'THEME_DEPENDENCY_CYCLE',
		});
		const extra = Object.fromEntries(
			Array.from({ length: 6 }, (_, n) => [n + '.css', encoder.encode(n === 5 ? 'a{color:red}' : '@import "' + (n + 1) + '.css";')]),
		);
		await expect(load(archive('@import "0.css";', extra))).rejects.toMatchObject({ code: 'THEME_CSS_DEPTH' });
	});

	it.each([
		'a{background:image-set(var(--source) 1x)}',
		'a{background:var(--source);--source:url(javascript:alert)}',
		'a{--source:url(data:image/svg+xml,test)}',
		'a{background:src(attr(data-source))}',
		'a{x:expression(alert(1))}',
		'@\\69mport "https://127.0.0.1/a.css";',
	])('rejects unresolved or executable CSS: %s', async (css) => {
		await expect(load(archive(css))).rejects.toHaveProperty('code');
	});

	it.each(['script.js', 'index.html', 'image.svg', '../escape.png', '/escape.png', 'a\\b.png'])(
		'rejects prohibited archive entries: %s',
		async (path) => {
			await expect(load(archive('a{color:red}', { [path]: png }))).rejects.toHaveProperty('code');
		},
	);

	it('rejects duplicate canonical paths, including unicode normalization', async () => {
		await expect(load(archive('', { '\u00e9.png': png, 'e\u0301.png': png }))).rejects.toMatchObject({ code: 'THEME_DUPLICATE_PATH' });
	});

	it('rejects symlink and encrypted entries before decompression', async () => {
		const link = archive('', { 'evil.png': [png, { os: 3, attrs: 0xa1ff0000 }] });
		await expect(load(link)).rejects.toMatchObject({ code: 'THEME_UNSUPPORTED_ZIP' });
		const encrypted = archive();
		const view = new DataView(encrypted.buffer);
		for (let offset = 0; offset < encrypted.length - 10; offset++) {
			if (view.getUint32(offset, true) === 0x02014b50) {
				view.setUint16(offset + 8, 1, true);
			}
		}
		await expect(load(encrypted)).rejects.toMatchObject({ code: 'THEME_UNSUPPORTED_ZIP' });
	});

	it('rejects a highly compressed file whose declared expanded output exceeds the budget', async () => {
		const compressed = archive('', { 'oversized.png': new Uint8Array(LIMITS.totalBytes + 1) });
		expect(compressed.length).toBeLessThan(20000);
		await expect(load(compressed)).rejects.toMatchObject({ code: 'THEME_PACKAGE_LIMIT' });
	});

	it('rejects HTML masquerading as an image and mismatched image extensions', async () => {
		await expect(normalizeAsset(encoder.encode('<svg onload="alert(1)"></svg>'), 'logo.png')).rejects.toMatchObject({
			code: 'THEME_ASSET_TYPE',
		});
		await expect(normalizeAsset(png, 'logo.gif')).rejects.toMatchObject({ code: 'THEME_ASSET_TYPE' });
	});

	it('limits metadata and rejects malformed or executable manifest fields', () => {
		expect(() => validateManifest(manifest({ javascript: 'alert(1)' }))).toThrow('THEME_UNKNOWN_FIELD');
		expect(() => validateManifest(manifest({ themeApiVersion: 2 }))).toThrow('THEME_UNSUPPORTED_VERSION');
		expect(() => validateManifest(manifest({ layout: { main: ['accounts'] } }))).toThrow('THEME_REQUIRED_COMPONENT');
		expect(() =>
			validateManifest(
				manifest({ settings: [{ key: '__proto__', type: 'text', default: 'bad', binding: { type: 'variable', name: '--theme-x' } }] }),
			),
		).toThrow('THEME_INVALID_SETTINGS');
	});

	it('returns typed errors for malformed metadata rather than crashing the coordinator', async () => {
		for (const json of ['null', '[]', 'true']) {
			await expect(normalizeThemeImport({ bytes: encoder.encode(json), name: 'theme.json' })).rejects.toHaveProperty(
				'code',
				'THEME_INVALID_JSON',
			);
			await expect(load(zipSync({ '2fa-theme.json': encoder.encode(json), 'theme.css': encoder.encode('') }))).rejects.toHaveProperty(
				'code',
				'THEME_INVALID_JSON',
			);
		}
		expect(() =>
			validateManifest(
				manifest({
					settings: [
						{
							key: 'choice',
							type: 'select',
							label: 'Choice',
							default: 'a',
							options: [null],
							binding: { type: 'variable', name: '--theme-choice' },
						},
					],
				}),
			),
		).toThrow('THEME_INVALID_FIELD');
	});
});

describe('all appearance inputs share resource normalization', () => {
	it('rejects a normalized text default that cannot be applied again even though its portable form fits', async () => {
		await expect(
			load(
				archive(
					'',
					{ 'a.png': png },
					{
						settings: [
							{
								key: 'backgrounds',
								type: 'text',
								label: 'Backgrounds',
								default: Array(20).fill('url(a.png)').join(','),
								binding: { type: 'variable', name: '--theme-backgrounds' },
							},
						],
					},
				),
			),
		).rejects.toMatchObject({ code: 'THEME_INVALID_DEFAULT', details: { key: 'backgrounds' } });
	});

	it('rejects normalized user text that exceeds the next-save limit even when the backup value would fit', async () => {
		const pkg = await load(
			archive(
				'',
				{},
				{
					settings: [
						{
							key: 'backgrounds',
							type: 'text',
							label: 'Backgrounds',
							default: 'none',
							binding: { type: 'variable', name: '--theme-backgrounds' },
						},
					],
				},
			),
		);
		const value = Array(20).fill('url(https://assets.example.org/a.png)').join(',');
		await expect(
			normalizeAppearance(pkg, { settings: { backgrounds: value } }, { fetcher: async () => new Response(png) }),
		).rejects.toMatchObject({
			code: 'THEME_INVALID_SETTING',
			details: { key: 'backgrounds' },
		});
		const asset = await normalizeAsset(png, 'a.png');
		const oldValue = Array(20)
			.fill('url(/theme-assets/' + asset.hash + '/' + asset.name + ')')
			.join(',');
		await expect(exportTheme(pkg, { appearance: { settings: { backgrounds: oldValue } }, assets: [asset] })).rejects.toMatchObject({
			code: 'THEME_INVALID_SETTING',
			details: { key: 'backgrounds' },
		});
	});

	it('repeatedly saves and restores legal normalized text defaults and personal values', async () => {
		const pkg = await load(
			archive(
				'',
				{ 'a.png': png },
				{
					settings: [
						{
							key: 'backgrounds',
							type: 'text',
							label: 'Backgrounds',
							default: Array(13).fill('url(a.png)').join(','),
							binding: { type: 'variable', name: '--theme-backgrounds' },
						},
					],
				},
			),
		);
		const first = await normalizeAppearance(pkg, {});
		expect(first.appearance.settings.backgrounds.length).toBeLessThanOrEqual(2048);
		const second = await normalizeAppearance(pkg, first.appearance);
		expect(second.appearance).toEqual(first.appearance);
		const restored = await load(await exportTheme(pkg, { appearance: second.appearance, assets: second.assets }), { restore: true });
		const reapplied = await normalizeAppearance(restored, restored.appearance);
		expect(reapplied.appearance).toEqual(second.appearance);
	});

	it('rejects an expanded user setting before accepting an appearance that cannot be restored', async () => {
		const pkg = await load(
			archive(
				'',
				{},
				{
					settings: [
						{
							key: 'backgrounds',
							type: 'text',
							label: 'Backgrounds',
							default: 'none',
							binding: { type: 'variable', name: '--theme-backgrounds' },
						},
					],
				},
			),
		);
		const value = Array(30).fill('url(https://assets.example.org/a.png)').join(',');
		expect(value.length).toBeLessThan(2048);
		await expect(
			normalizeAppearance(pkg, { settings: { backgrounds: value } }, { fetcher: async () => new Response(png) }),
		).rejects.toMatchObject({
			code: 'THEME_INVALID_SETTING',
			details: { key: 'backgrounds' },
		});
	});

	it('rejects applying or exporting a previously stored package with unrestorable expanded tokens', async () => {
		const pkg = getBuiltinTheme();
		const asset = await normalizeAsset(png, 'a.png');
		pkg.assets.push(asset);
		pkg.manifest.tokens.light['--theme-bg'] = Array(30)
			.fill('url(/theme-assets/' + asset.hash + '/' + asset.name + ')')
			.join(',');
		await expect(normalizeAppearance(pkg, {})).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD', details: { field: '--theme-bg' } });
		await expect(exportTheme(pkg)).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD', details: { field: '--theme-bg' } });
	});
	it('can save every built-in default repeatedly and retains numeric CSS units', async () => {
		for (const pkg of getBuiltinThemes()) {
			const first = await normalizeAppearance(pkg, {});
			const second = await normalizeAppearance(pkg, first.appearance);
			expect(second.appearance).toEqual(first.appearance);
			expect(pkg.manifest.settings.find((field) => field.key === 'fontSize').binding.unit).toBe('px');
		}
	});
	it('normalizes personal CSS, configuration bindings, branding and custom content', async () => {
		const builtin = getBuiltinTheme();
		const held = await normalizeAsset(png, 'logo.png');
		const privateUrl = '/api/appearance/assets/' + held.hash;
		const layout = JSON.parse(JSON.stringify(builtin.manifest.layout));
		layout.trailing.push({ type: 'image', id: 'photo' });
		const result = await normalizeAppearance(
			builtin,
			{
				settings: { background: privateUrl },
				branding: { name: 'Mine', logo: privateUrl, background: privateUrl },
				customCss: 'body{background:url(' + privateUrl + ')}',
				layout,
				content: { photo: { src: privateUrl, alt: 'Image' } },
			},
			{ resolveAsset: async () => held },
		);
		expect(result.assets).toHaveLength(1);
		expect(result.appearance.customCss).toContain('/theme-assets/');
		expect(result.appearance.branding.logo).toBe(result.appearance.settings.background);
		expect(result.appearance.content.photo.src).toBe(result.appearance.branding.logo);
	});

	it('applies shared resource rejection to advanced CSS and variable setting values', async () => {
		await expect(normalizeAppearance(getBuiltinTheme(), { customCss: 'a{background:url(https://localhost/a.png)}' })).rejects.toMatchObject(
			{ code: 'THEME_PRIVATE_URL' },
		);
		const pkg = await load(
			archive(
				'',
				{},
				{
					settings: [{ key: 'extra', type: 'text', label: 'Extra', default: 'none', binding: { type: 'variable', name: '--theme-extra' } }],
				},
			),
		);
		await expect(normalizeAppearance(pkg, { settings: { extra: 'url(data:image/png,evil)' } })).rejects.toHaveProperty('code');
	});

	it('restores a complete builtin appearance in a fresh instance without the original host', async () => {
		const pkg = getBuiltinTheme();
		const logo = await normalizeAsset(png, 'logo.png');
		const normalized = await normalizeAppearance(
			pkg,
			{ branding: { name: 'Personal', logo: '/theme-assets/' + logo.hash + '/logo.png' }, customCss: 'body{color:#aaa}' },
			{ resolveAsset: async () => logo },
		);
		const backup = await exportTheme(pkg, {
			appearance: { ...normalized.appearance, revision: 99, manifest: pkg.manifest },
			assets: normalized.assets,
		});
		const restored = await load(backup, { restore: true });
		expect(restored.packageId).not.toMatch(/^builtin:/);
		expect(restored.appearance.branding.name).toBe('Personal');
		expect(restored.appearanceAssets).toHaveLength(1);
		expect(restored.assets).toHaveLength(0);
		await expect(load(backup)).rejects.toMatchObject({ code: 'THEME_RESTORE_REQUIRED' });
	});

	it('keeps author theme identity independent of personal backup content', async () => {
		const pkg = await load(archive());
		const logo = await normalizeAsset(png, 'logo.png');
		const normalized = await normalizeAppearance(
			pkg,
			{ branding: { logo: '/theme-assets/' + logo.hash } },
			{ resolveAsset: async () => logo },
		);
		const restored = await load(await exportTheme(pkg, { appearance: normalized.appearance, assets: normalized.assets }), {
			restore: true,
		});
		expect(restored.packageId).toBe(pkg.packageId);
		expect(restored.assets).toEqual([]);
		expect(restored.appearanceAssets).toHaveLength(1);
	});

	it('exports and restores a maximum legal 10 MiB appearance with incompressible personal imagery', async () => {
		const pkg = getBuiltinTheme();
		const small = await normalizeAsset(paddedPng(1024), 'background.png');
		const trial = await normalizeAppearance(
			pkg,
			{ branding: { background: '/theme-assets/' + small.hash } },
			{ resolveAsset: async () => small },
		);
		const maximum = await normalizeAsset(paddedPng(1024 + LIMITS.totalBytes - trial.totalBytes), 'background.png');
		const ready = await normalizeAppearance(
			pkg,
			{ branding: { background: '/theme-assets/' + maximum.hash } },
			{ resolveAsset: async () => maximum },
		);
		expect(ready.totalBytes).toBe(LIMITS.totalBytes);
		const backup = await exportTheme(pkg, { appearance: ready.appearance, assets: ready.assets });
		expect(backup.length).toBeGreaterThan(5 * 1024 * 1024);
		expect(backup.length).toBeLessThan(LIMITS.restoreUpload);
		const restored = await load(backup, { restore: true });
		expect(restored.appearanceAssets[0].hash).toBe(maximum.hash);
		expect(Buffer.compare(restored.appearanceAssets[0].bytes, maximum.bytes)).toBe(0);
		const tooBig = await normalizeAsset(paddedPng(maximum.bytes.length + 1), 'background.png');
		await expect(
			normalizeAppearance(pkg, { branding: { background: '/theme-assets/' + tooBig.hash } }, { resolveAsset: async () => tooBig }),
		).rejects.toMatchObject({ code: 'THEME_APPEARANCE_LIMIT' });
	}, 10000);

	it('preserves compatible user values and reports update migration changes', () => {
		const field = (key, type, value, extras = {}) => ({ key, type, default: value, ...extras });
		const result = migrateSettings(
			{ settings: [field('keep', 'number', 1), field('change', 'text', ''), field('remove', 'text', '')] },
			{ settings: [field('keep', 'number', 2, { min: 0, max: 10 }), field('change', 'boolean', true), field('new', 'text', 'hello')] },
			{ keep: 4, change: 'old', remove: 'bye' },
		);
		expect(result.settings).toEqual({ keep: 4, change: true, new: 'hello' });
		expect(result.changes.map((change) => change.reason)).toEqual(['type-changed', 'added', 'removed']);
	});
});

describe('bounded remote imports', () => {
	it('imports a GitHub release attachment and localizes its remote dependency', async () => {
		const fetcher = vi.fn(async (url) => {
			if (url.includes('api.github.com')) {
				return Response.json({
					assets: [{ name: '2fa-theme.zip', browser_download_url: 'https://github.com/a/b/releases/download/v1/2fa-theme.zip' }],
				});
			}
			if (url.endsWith('2fa-theme.zip')) {
				return new Response(archive('a{background:url(https://cdn.example.org/image.png)}'));
			}
			return new Response(png);
		});
		const result = await normalizeThemeImport({ url: 'https://github.com/a/b' }, { fetcher });
		expect(result.assets).toHaveLength(1);
		expect(result.css).not.toContain('https://');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('uses the final stylesheet URL for relative remote assets', async () => {
		const fetcher = vi.fn(async (url) => {
			if (url.endsWith('start.css')) {
				return new Response(null, { status: 302, headers: { location: '/nested/main.css' } });
			}
			return url.endsWith('.css') ? new Response('a{background:url(image.png)}') : new Response(png);
		});
		await normalizeThemeImport({ url: 'https://cdn.example.org/start.css' }, { fetcher });
		expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://cdn.example.org/nested/image.png');
	});

	it('revalidates redirects and blocks private and credentialed URL forms', async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }));
		await expect(normalizeThemeImport({ url: 'https://cdn.example.org/theme.zip' }, { fetcher })).rejects.toMatchObject({
			code: 'THEME_PRIVATE_URL',
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		for (const url of [
			'https://2130706433/x',
			'https://[::1]/x',
			'https://x.local/x',
			'http://public.org/x',
			'https://user:pass@public.org/x',
		]) {
			expect(() => assertPublicUrl(url)).toThrow();
		}
	});

	it('limits aggregate remote requests across all imports', async () => {
		const imports = Array.from({ length: 33 }, (_, index) => '@import "https://cdn.example.org/' + index + '.css";').join('');
		const fetcher = vi.fn(async () => new Response('a{color:red}'));
		await expect(load(archive(imports), { fetcher })).rejects.toMatchObject({ code: 'THEME_REQUEST_LIMIT' });
		expect(fetcher).toHaveBeenCalledTimes(32);
	});

	it('aborts an oversized body with no Content-Length header', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				pull(controller) {
					controller.enqueue(new Uint8Array(100));
				},
				cancel() {
					cancelled = true;
				},
			}),
		);
		await expect(readBodyLimited(response, 150)).rejects.toMatchObject({ code: 'THEME_SIZE_LIMIT' });
		expect(cancelled).toBe(true);
	});

	it('ends even an uncooperative remote fetch at the request deadline', async () => {
		vi.useFakeTimers();
		try {
			const pending = normalizeThemeImport({ url: 'https://cdn.example.org/theme.css' }, { fetcher: () => new Promise(() => {}) });
			const assertion = expect(pending).rejects.toMatchObject({ code: 'THEME_TIMEOUT' });
			await vi.advanceTimersByTimeAsync(LIMITS.requestMs);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});
