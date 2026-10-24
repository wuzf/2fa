import { zipSync } from 'fflate';
import { appMime } from '../../src/themes/appSchema.js';
import { hashBytes } from '../../src/themes/schema.js';

export const encodeAppText = (value) => new TextEncoder().encode(value);
export const appPng = Uint8Array.from(
	Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
);

export async function appThemeFixture(contents = { 'entry.js': 'export const mount = () => {};' }, options = {}) {
	const files = new Map(Object.entries(contents).map(([path, value]) => [path, typeof value === 'string' ? encodeAppText(value) : value]));
	const inventory = await Promise.all(
		Array.from(files, async ([path, bytes]) => ({ path, mime: appMime(path), size: bytes.length, sha256: await hashBytes(bytes) })),
	);
	const manifest = {
		themeApiVersion: 2,
		kind: 'app',
		sdkApiVersion: 1,
		id: 'storage-test',
		name: 'App storage test',
		version: '1.0.0',
		entry: 'entry.js',
		...options,
		files: inventory,
	};
	return { manifest, files, archive: zipSync({ '2fa-theme.json': encodeAppText(JSON.stringify(manifest)), ...Object.fromEntries(files) }) };
}
