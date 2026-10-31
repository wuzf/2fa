import { describe, expect, it } from 'vitest';
import { normalizeAppThemeImport, normalizeAppAppearance } from '../../src/themes/appPackage.js';
import { normalizePublicUnicodeRange, resolvePublicAppearance } from '../../src/themes/publicAppearance.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { publicThemeFixture, publicTestDescription, publicTestFont } from '../helpers/public-appearance.js';

const load = async (options) => normalizeAppThemeImport({ bytes: (await publicThemeFixture(options)).archive });

describe('verified public appearance package description', () => {
	it('resolves selected boolean/select tokens and only selected faces with private family names', async () => {
		const pkg = await load();
		const current = (await normalizeAppAppearance(pkg, { settings: { accent: 'blue', handwriting: true } })).appearance.publicAppearance;
		expect(current.light.accent).toBe('#123456');
		expect(current.dark.accent).toBe('#abcdef');
		expect(current.light.fontFamily).toEqual(['2fa-public-' + pkg.packageId + '-0', 'sans-serif']);
		expect(current.fonts).toEqual([
			expect.objectContaining({
				family: current.light.fontFamily[0],
				weight: [400, 700],
				style: 'normal',
				unicodeRange: 'U+0-17F',
				url: '/theme-packages/' + pkg.packageId + '/fonts/test.woff2',
			}),
		]);
		expect(Object.keys(current).sort()).toEqual(['dark', 'fonts', 'formatVersion', 'light', 'packageId']);
		const noFont = (await normalizeAppAppearance(pkg, { settings: { handwriting: false } })).appearance.publicAppearance;
		expect(noFont.fonts).toEqual([]);
		expect(noFont.light.fontFamily).toEqual(['sans-serif']);
		expect(noFont.light.accent).toBe('#247942');
		const preview = resolvePublicAppearance(pkg, {}, { baseUrl: '/theme-preview/' + 'a'.repeat(64) + '/' });
		expect(preview.fonts[0].url).toBe('/theme-preview/' + 'a'.repeat(64) + '/fonts/test.woff2');
		expect(() => resolvePublicAppearance(pkg, {}, { baseUrl: 'https://evil.test/' })).toThrow();
	});

	it('keeps missing-description old packages compatible and derives settings from the verified package bytes', async () => {
		const old = await normalizeAppThemeImport({ bytes: (await appThemeFixture()).archive });
		expect(old).not.toHaveProperty('publicAppearanceDescriptor');
		expect((await normalizeAppAppearance(old)).appearance).not.toHaveProperty('publicAppearance');
		const pkg = await load();
		const first = (await normalizeAppAppearance(pkg, { settings: { accent: 'blue', handwriting: false } })).appearance;
		expect(first.packageId).toBe(pkg.packageId);
		expect(first.publicAppearance.light.accent).toBe('#123456');
		expect(first.publicAppearance.fonts).toEqual([]);
		const again = (await normalizeAppAppearance(pkg, { settings: first.settings })).appearance;
		expect(again.publicAppearance).toEqual(first.publicAppearance);
		await expect(normalizeAppAppearance(pkg, { publicAppearance: { light: { accent: '#ff0000' } } })).rejects.toMatchObject({
			code: 'THEME_UNKNOWN_FIELD',
		});
		await expect(normalizeAppAppearance(pkg, [])).rejects.toThrow();
		let reads = 0;
		await expect(
			normalizeAppAppearance(pkg, {
				get publicAppearance() {
					reads++;
					return {};
				},
			}),
		).rejects.toThrow();
		expect(reads).toBe(0);
	});

	it.each([
		[
			'unknown field',
			(d) => {
				d.css = 'body{}';
			},
		],
		[
			'invalid format',
			(d) => {
				d.formatVersion = 2;
			},
		],
		[
			'script value',
			(d) => {
				d.light.fontFamily = ['</style><script>alert(1)</script>'];
			},
		],
		[
			'CSS expression',
			(d) => {
				d.light.accent = 'var(--evil)';
			},
		],
		[
			'unknown token',
			(d) => {
				d.dark.position = 'fixed';
			},
		],
		[
			'missing mode',
			(d) => {
				delete d.dark;
			},
		],
		[
			'null fonts',
			(d) => {
				d.fonts = null;
			},
		],
		[
			'null variants',
			(d) => {
				d.variants = null;
			},
		],
		[
			'invalid boolean value',
			(d) => {
				d.variants[1].values = { yes: { light: { radius: 0 } } };
			},
		],
		[
			'undeclared select value',
			(d) => {
				d.variants[0].values = { red: { light: { radius: 0 } } };
			},
		],
		[
			'undeclared setting',
			(d) => {
				d.variants[0].setting = 'missing';
			},
		],
		[
			'duplicate setting',
			(d) => {
				d.variants.push(d.variants[0]);
			},
		],
		[
			'invalid patch',
			(d) => {
				d.variants[0].values.blue.light.radius = 25;
			},
		],
		[
			'empty patch',
			(d) => {
				d.variants[0].values.blue = {};
			},
		],
		[
			'external font',
			(d) => {
				d.fonts[0].path = 'https://evil.test/a.woff2';
			},
		],
		[
			'missing font',
			(d) => {
				d.fonts[0].path = 'fonts/missing.woff2';
			},
		],
		[
			'JS font',
			(d) => {
				d.fonts[0].path = 'entry.js';
			},
		],
		[
			'generic family',
			(d) => {
				d.fonts[0].family = 'serif';
			},
		],
		[
			'invalid weight',
			(d) => {
				d.fonts[0].weight = [900, 100];
			},
		],
		[
			'invalid style',
			(d) => {
				d.fonts[0].style = 'normal;src:url(x)';
			},
		],
		[
			'CSS range injection',
			(d) => {
				d.fonts[0].unicodeRange = 'U+0-FF;src:url(x)';
			},
		],
		[
			'65 faces',
			(d) => {
				d.fonts = Array.from({ length: 65 }, (_, i) => ({ ...d.fonts[0], unicodeRange: 'U+' + i.toString(16) }));
			},
		],
		[
			'5 families',
			(d) => {
				d.fonts = Array.from({ length: 5 }, (_, i) => ({ ...d.fonts[0], family: 'Face ' + i }));
			},
		],
	])('rejects %s rather than ignoring an invalid present description', async (_name, mutate) => {
		const description = publicTestDescription();
		mutate(description);
		await expect(load({ description })).rejects.toThrow();
	});

	it('enforces JSON byte limit before interpreting and full font inventory/magic/hash validation', async () => {
		const oversize = JSON.stringify(publicTestDescription()) + ' '.repeat(128 * 1024);
		await expect(load({ extraFiles: { 'public-appearance.json': oversize } })).rejects.toMatchObject({
			code: 'THEME_PUBLIC_APPEARANCE_LIMIT',
		});
		const broken = publicTestFont();
		broken[0] = 0;
		await expect(load({ extraFiles: { 'fonts/test.woff2': broken } })).rejects.toMatchObject({ code: 'THEME_ASSET_TYPE' });
		const fixture = await publicThemeFixture();
		const pkg = await normalizeAppThemeImport({ bytes: fixture.archive });
		pkg.files.find((file) => file.path === 'fonts/test.woff2').bytes[47] ^= 1;
		await expect(normalizeAppAppearance(pkg)).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
	});

	it('limits variant settings and value counts and rejects non-enumerated setting types', async () => {
		const description = publicTestDescription();
		const field = {
			key: 'accent',
			type: 'select',
			label: 'Accent',
			default: 'v0',
			options: Array.from({ length: 17 }, (_, i) => ({ value: 'v' + i, label: 'V' + i })),
		};
		description.variants = [
			{ setting: 'accent', values: Object.fromEntries(field.options.map((option) => [option.value, { light: { radius: 1 } }])) },
		];
		await expect(load({ description, manifest: { settings: [field] } })).rejects.toMatchObject({ code: 'THEME_PUBLIC_VARIANT' });
		description.variants = Array.from({ length: 5 }, (_, i) => ({ setting: 's' + i, values: { true: { light: { radius: 1 } } } }));
		await expect(
			load({
				description,
				manifest: { settings: Array.from({ length: 5 }, (_, i) => ({ key: 's' + i, type: 'boolean', default: true })) },
			}),
		).rejects.toMatchObject({ code: 'THEME_PUBLIC_VARIANT' });
		description.variants = [{ setting: 'text', values: { value: { light: { radius: 1 } } } }];
		await expect(load({ description, manifest: { settings: [{ key: 'text', type: 'text', default: 'value' }] } })).rejects.toMatchObject({
			code: 'THEME_PUBLIC_VARIANT',
		});
	});

	it('supports 48 valid split faces and variable weights without returning unselected fonts', async () => {
		const description = publicTestDescription();
		description.fonts = Array.from({ length: 48 }, (_, index) => ({
			...description.fonts[0],
			unicodeRange: 'U+' + (0x400 + index * 16).toString(16) + '-' + (0x40f + index * 16).toString(16),
		}));
		const pkg = await load({ description });
		expect(resolvePublicAppearance(pkg, {}).fonts).toHaveLength(48);
		expect(resolvePublicAppearance(pkg, { handwriting: false }).fonts).toHaveLength(0);
	});

	it('parses, sorts and merges unicode ranges while rejecting overflow, limits and CSS fragments', () => {
		expect(normalizePublicUnicodeRange('u+4??, U+0-FF, U+100-3ff')).toBe('U+0-4FF');
		expect(normalizePublicUnicodeRange('U+10FFFF')).toBe('U+10FFFF');
		for (const value of [
			'U+110000',
			'U+??????',
			'U+FF-0',
			'U+1/**/',
			'U+1);color:red',
			'U+1-',
			'',
			Array(4097).fill('U+1').join(','),
			' '.repeat(32768) + 'U+1',
		]) {
			expect(() => normalizePublicUnicodeRange(value), value).toThrow();
		}
	});
});
