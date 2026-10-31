import { describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import {
	LIMITS,
	assertPublicUrl,
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
const imageSetting = { key: 'image', type: 'text', label: 'Image', default: 'none', binding: { type: 'variable', name: '--theme-image' } };

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

	it('imports local assets and escaped CSS URLs with a stable package identity', async () => {
		const pkg = await load(
			archive('a{background:u\\72l("images/p.png");mask-image:image-set("images/p.png" 1x,url(images/p.png) 2x)}', { 'images/p.png': png }),
		);
		expect(pkg.assets).toHaveLength(1);
		expect(pkg.css).toContain('/theme-assets/' + pkg.assets[0].hash);
		expect(pkg.css).not.toContain('images/p.png');
		expect(pkg.assets[0].bytes).toEqual(png);
		const again = await load(zipSync(unzipSync(archive('a{background:url(images/p.png)}', { 'images/p.png': png })), { level: 0 }));
		expect(again.assets[0].hash).toBe(pkg.assets[0].hash);
	});

	it('rejects token expansion that would produce an unrestorable portable manifest', async () => {
		const value = Array(30).fill('url(a.png)').join(',');
		expect(value.length).toBeLessThan(2048);
		await expect(load(archive('', { 'a.png': png }, { tokens: { light: { '--theme-bg': value } } }))).rejects.toMatchObject({
			code: 'THEME_INVALID_FIELD',
			details: { field: '--theme-bg' },
		});
	});

	it('accepts repeated asset tokens that remain within portable field limits', async () => {
		const value = Array(20).fill('url(a.png)').join(',');
		const pkg = await load(archive('', { 'a.png': png }, { tokens: { light: { '--theme-bg': value } } }));
		expect(pkg.assets).toHaveLength(1);
		expect(pkg.manifest.tokens.light['--theme-bg']).toContain('/theme-assets/' + pkg.assets[0].hash);
		expect((await load(archive('', { 'a.png': png }, { tokens: { light: { '--theme-bg': value } } }))).packageId).toBe(pkg.packageId);
	});

	it('rejects total manifest expansion even when every rewritten token fits its field limit', async () => {
		const tokens = Object.fromEntries(
			Array.from({ length: 50 }, (_, index) => ['--theme-bg-' + index, Array(20).fill('url(a.png)').join(',')]),
		);
		await expect(load(archive('', { 'a.png': png }, { tokens: { light: tokens } }))).rejects.toMatchObject({
			code: 'THEME_MANIFEST_LIMIT',
		});
	});

	it('imports the same 6 MiB theme from compressed and STORE archives', async () => {
		const image = paddedPng(6 * 1024 * 1024, false);
		const compressed = archive('body{background:url(a.png)}', { 'a.png': image });
		expect(compressed.length).toBeLessThan(5 * 1024 * 1024);
		const pkg = await load(compressed);
		const stored = zipSync(unzipSync(compressed), { level: 0 });
		expect(stored.length).toBeGreaterThan(5 * 1024 * 1024);
		expect(stored.length).toBeLessThanOrEqual(LIMITS.upload);
		const restored = await load(stored);
		expect(restored.packageId).toBe(pkg.packageId);
		expect(Buffer.compare(restored.assets[0].bytes, image)).toBe(0);
	});

	it('accepts only ZIP packages, not CSS or JSON shortcut files', async () => {
		await expect(normalizeThemeImport({ bytes: encoder.encode('a{color:blue}'), name: 'mine.css' })).rejects.toMatchObject({
			code: 'THEME_INVALID_ZIP',
		});
		await expect(
			normalizeThemeImport({ bytes: encoder.encode(JSON.stringify({ manifest: manifest(), css: '.x{color:red}' })), name: 'mine.json' }),
		).rejects.toMatchObject({ code: 'THEME_INVALID_ZIP' });
		await expect(load(archive('', { 'appearance.json': encoder.encode('{}') }))).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD' });
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

	it('rejects normalized user text that exceeds the next-save limit', async () => {
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
	});

	it('repeatedly saves legal normalized text defaults and personal values', async () => {
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

	it('rejects applying a previously stored package with unrestorable expanded tokens', async () => {
		const pkg = getBuiltinTheme();
		const asset = await normalizeAsset(png, 'a.png');
		pkg.assets.push(asset);
		pkg.manifest.tokens.light['--theme-bg'] = Array(30)
			.fill('url(/theme-assets/' + asset.hash + '/' + asset.name + ')')
			.join(',');
		await expect(normalizeAppearance(pkg, {})).rejects.toMatchObject({ code: 'THEME_INVALID_FIELD', details: { field: '--theme-bg' } });
	});
	it('can save every built-in default repeatedly', async () => {
		for (const pkg of getBuiltinThemes()) {
			const first = await normalizeAppearance(pkg, {});
			const second = await normalizeAppearance(pkg, first.appearance);
			expect(second.appearance).toEqual(first.appearance);
		}
	});
	it('normalizes private asset references in variable setting values', async () => {
		const pkg = await load(archive('', {}, { settings: [imageSetting] }));
		const held = await normalizeAsset(png, 'logo.png');
		const result = await normalizeAppearance(
			pkg,
			{ settings: { image: 'url(/api/appearance/assets/' + held.hash + ')' } },
			{ resolveAsset: async () => held },
		);
		expect(result.assets).toHaveLength(1);
		expect(result.resourceHashes).toEqual([held.hash]);
		expect(result.appearance.settings.image).toContain('/theme-assets/' + held.hash);
		// Removed personal fields are dropped rather than stored.
		const removed = await normalizeAppearance(getBuiltinTheme(), { customCss: 'body{}', branding: { name: 'Mine' } });
		expect(removed.appearance).not.toHaveProperty('customCss');
		expect(removed.appearance).not.toHaveProperty('branding');
	});

	it('applies shared resource rejection to variable setting values', async () => {
		const pkg = await load(
			archive(
				'',
				{},
				{
					settings: [{ key: 'extra', type: 'text', label: 'Extra', default: 'none', binding: { type: 'variable', name: '--theme-extra' } }],
				},
			),
		);
		await expect(normalizeAppearance(pkg, { settings: { extra: 'url(https://localhost/a.png)' } })).rejects.toMatchObject({
			code: 'THEME_PRIVATE_URL',
		});
		await expect(normalizeAppearance(pkg, { settings: { extra: 'url(data:image/png,evil)' } })).rejects.toHaveProperty('code');
	});

	it('counts referenced personal imagery against the 10 MiB appearance budget', async () => {
		const pkg = await load(archive('', {}, { settings: [imageSetting] }));
		const input = (asset) => [{ settings: { image: 'url(/theme-assets/' + asset.hash + ')' } }, { resolveAsset: async () => asset }];
		const small = await normalizeAsset(paddedPng(1024), 'background.png');
		const trial = await normalizeAppearance(pkg, ...input(small));
		const maximum = await normalizeAsset(paddedPng(1024 + LIMITS.totalBytes - trial.totalBytes), 'background.png');
		const ready = await normalizeAppearance(pkg, ...input(maximum));
		expect(ready.totalBytes).toBe(LIMITS.totalBytes);
		expect(ready.resourceHashes).toEqual([maximum.hash]);
		const tooBig = await normalizeAsset(paddedPng(maximum.bytes.length + 1), 'background.png');
		await expect(normalizeAppearance(pkg, ...input(tooBig))).rejects.toMatchObject({ code: 'THEME_APPEARANCE_LIMIT' });
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
	it('localizes a remote dependency referenced by package CSS', async () => {
		const fetcher = vi.fn(async () => new Response(png));
		const result = await load(archive('a{background:url(https://cdn.example.org/image.png)}'), { fetcher });
		expect(result.assets).toHaveLength(1);
		expect(result.css).not.toContain('https://');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('uses the final stylesheet URL for relative remote assets', async () => {
		const fetcher = vi.fn(async (url) => {
			if (url.endsWith('start.css')) {
				return new Response(null, { status: 302, headers: { location: '/nested/main.css' } });
			}
			return url.endsWith('.css') ? new Response('a{background:url(image.png)}') : new Response(png);
		});
		await load(archive('@import "https://cdn.example.org/start.css";'), { fetcher });
		expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://cdn.example.org/nested/image.png');
	});

	it('revalidates redirects and blocks private and credentialed URL forms', async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }));
		await expect(load(archive('a{background:url(https://cdn.example.org/a.png)}'), { fetcher })).rejects.toMatchObject({
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
			const pending = load(archive('a{background:url(https://cdn.example.org/a.png)}'), { fetcher: () => new Promise(() => {}) });
			const assertion = expect(pending).rejects.toMatchObject({ code: 'THEME_TIMEOUT' });
			await vi.advanceTimersByTimeAsync(LIMITS.requestMs);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});
