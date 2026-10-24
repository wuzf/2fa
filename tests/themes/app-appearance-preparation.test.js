import { describe, expect, it } from 'vitest';
import { normalizeAppAppearance, normalizeAppPackageWithAppearance, normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { normalizeAsset } from '../../src/themes/resources.js';
import { appPng, appThemeFixture, encodeAppText } from '../helpers/app-theme.js';

describe('combined app package and appearance preparation', () => {
	it('returns the verified package and the same normalized settings, branding and personal assets', async () => {
		const fixture = await appThemeFixture(
			{ 'entry.js': 'export const mount=()=>{};', 'assets/default.png': appPng },
			{ settings: [{ key: 'picture', type: 'asset', label: 'Picture', default: 'assets/default.png' }] },
		);
		const pkg = await normalizeAppThemeImport({ bytes: fixture.archive });
		const asset = await normalizeAsset(appPng, 'personal.png');
		const input = {
			packageId: pkg.packageId,
			settings: { picture: 'assets/default.png' },
			branding: { name: 'Custom vault', logo: '/theme-assets/' + asset.hash + '/' + asset.name },
		};
		const expected = await normalizeAppAppearance(pkg, input, { assets: [asset] });
		const prepared = await normalizeAppPackageWithAppearance(pkg, input, { assets: [asset] });
		expect(prepared.pkg.packageId).toBe(pkg.packageId);
		expect(prepared.pkg.files).toEqual(pkg.files);
		const { pkg: verified, ...appearance } = prepared;
		expect(appearance).toEqual(expected);
		// Validation creates its own file bytes; mutating caller data afterwards
		// cannot modify the prepared package's source files.
		pkg.files[0].bytes.fill(0);
		expect(verified.files[0].bytes).toEqual(fixture.files.get(verified.files[0].path));
	});

	it('rejects changed source bytes and forged package identity instead of trusting a caller-supplied package', async () => {
		const fixture = await appThemeFixture();
		const pkg = await normalizeAppThemeImport({ bytes: fixture.archive });
		await expect(normalizeAppPackageWithAppearance({ ...pkg, packageId: '0'.repeat(64) })).rejects.toMatchObject({
			code: 'THEME_APP_HASH',
		});
		const changed = { ...pkg, files: pkg.files.map((file) => ({ ...file, bytes: encodeAppText('export const changed=true;') })) };
		await expect(normalizeAppPackageWithAppearance(changed)).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
		await expect(normalizeAppAppearance(changed)).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
	});

	it('still validates referenced module paths and unknown appearance fields', async () => {
		const broken = await appThemeFixture({ 'entry.js': "export const detail=()=>import('./missing.js');" });
		const pkg = {
			manifest: broken.manifest,
			packageId: '0'.repeat(64),
			files: [...broken.files].map(([path, bytes]) => ({ path, bytes })),
		};
		await expect(normalizeAppPackageWithAppearance(pkg)).rejects.toMatchObject({ code: 'THEME_MISSING_FILE' });
		const valid = await normalizeAppThemeImport({ bytes: (await appThemeFixture()).archive });
		await expect(normalizeAppPackageWithAppearance(valid, { skipValidation: true })).rejects.toMatchObject({ code: 'THEME_UNKNOWN_FIELD' });
	});
});
