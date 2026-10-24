import { appThemeFixture } from './app-theme.js';
import { normalizeAppThemeImport, normalizeAppAppearance } from '../../src/themes/appPackage.js';

export function publicTestFont() {
	const bytes = new Uint8Array(48);
	bytes.set([119, 79, 70, 50]);
	new DataView(bytes.buffer).setUint32(8, bytes.length);
	return bytes;
}

export function publicTestDescription() {
	return {
		formatVersion: 1,
		light: {
			surface: '#fffdf7',
			subtle: '#f4f0e6',
			text: '#222222',
			accent: '#247942',
			accentText: '#ffffff',
			fontFamily: ['Test Font', 'sans-serif'],
			radius: 2,
		},
		dark: {
			surface: '#222222',
			subtle: '#111111',
			text: '#eeeeee',
			accent: '#99cc88',
			accentText: '#111111',
			fontFamily: ['Test Font', 'sans-serif'],
			radius: 2,
		},
		fonts: [{ family: 'Test Font', path: 'fonts/test.woff2', unicodeRange: 'u+00??, U+100-17f', weight: [400, 700] }],
		variants: [
			{ setting: 'accent', values: { blue: { light: { accent: '#123456' }, dark: { accent: '#abcdef' } } } },
			{ setting: 'handwriting', values: { false: { light: { fontFamily: ['sans-serif'] }, dark: { fontFamily: ['sans-serif'] } } } },
		],
	};
}

export async function publicThemeFixture({ description = publicTestDescription(), extraFiles = {}, manifest = {} } = {}) {
	return appThemeFixture(
		{
			'entry.js': 'export function mount() { throw new Error("import must not execute theme"); }',
			'fonts/test.woff2': publicTestFont(),
			...(description === undefined ? {} : { 'public-appearance.json': JSON.stringify(description) }),
			...extraFiles,
		},
		{
			settings: [
				{
					key: 'accent',
					type: 'select',
					label: 'Accent',
					default: 'green',
					options: [
						{ value: 'green', label: 'Green' },
						{ value: 'blue', label: 'Blue' },
					],
				},
				{ key: 'handwriting', type: 'boolean', label: 'Handwriting', default: true },
			],
			...manifest,
		},
	);
}

export async function publicThemeSnapshot(settings = {}) {
	const fixture = await publicThemeFixture();
	const pkg = await normalizeAppThemeImport({ bytes: fixture.archive });
	const { appearance } = await normalizeAppAppearance(pkg, { settings });
	return {
		...appearance,
		kind: 'app',
		manifest: pkg.manifest,
		files: pkg.files.map(({ path, mime, size, hash }) => ({ path, mime, size, hash })),
		revision: 1,
	};
}
