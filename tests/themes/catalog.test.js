import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThemeCatalog, downloadCatalogTheme, validateThemeCatalog, normalizeCatalogRepository } from '../../src/themes/catalog.js';
import { hashBytes } from '../../src/themes/schema.js';
import { normalizeDetectedThemeImport } from '../../src/themes/import.js';
import { appThemeFixture } from '../helpers/app-theme.js';

const revision = 'a'.repeat(40);
const refUrl = 'https://api.github.com/repos/wuzf/2fa-theme-mytheme/git/ref/heads/main';
const raw = `https://raw.githubusercontent.com/wuzf/2fa-theme-mytheme/${revision}/`;

async function fixture() {
	const { archive } = await appThemeFixture({ 'entry.js': 'export function mount() { throw new Error("must not execute on import"); }' });
	const pkg = await normalizeDetectedThemeImport({ bytes: archive });
	const entry = {
		id: pkg.manifest.id,
		kind: 'app',
		name: pkg.manifest.name,
		version: pkg.manifest.version,
		description: '',
		author: 'Theme author',
		packageId: pkg.packageId,
		path: `themes/${pkg.manifest.id}/2fa-theme.zip`,
		sha256: await hashBytes(archive),
		size: archive.length,
		source: 'https://github.com/deleted-author/deleted-repository',
	};
	const catalog = { schemaVersion: 1, themes: [entry] };
	const fetcher = vi.fn(async (url) => {
		if (url === refUrl) {
			return Response.json({ object: { type: 'commit', sha: revision } });
		}
		if (url === raw + 'catalog.json') {
			return Response.json(catalog);
		}
		if (url === raw + entry.path) {
			return new Response(archive);
		}
		return new Response('Not found', { status: 404 });
	});
	return { archive, entry, catalog, fetcher, selection: { id: entry.id, packageId: entry.packageId } };
}

afterEach(() => vi.restoreAllMocks());

describe('self-contained community theme catalog', () => {
	it('installs the centrally stored bytes without contacting the deleted author repository or running theme code', async () => {
		const h = await fixture();
		const source = await downloadCatalogTheme(h.selection, { fetcher: h.fetcher });
		expect(source.bytes).toEqual(h.archive);
		expect(source.sourceUrl).toBe(raw + h.entry.path);
		expect(source.url).toBeUndefined();
		expect((await normalizeDetectedThemeImport(source)).packageId).toBe(h.entry.packageId);
		expect(h.fetcher.mock.calls.map(([url]) => url)).toEqual([refUrl, raw + 'catalog.json', raw + h.entry.path]);
		for (const [, init] of h.fetcher.mock.calls) {
			expect(init.credentials).toBe('omit');
		}
	});

	it('reads the index and ZIP at the same commit even when main changes in between', async () => {
		const h = await fixture();
		await readThemeCatalog({ fetcher: h.fetcher });
		h.fetcher.mockImplementationOnce(() => new Response(h.archive));
		await downloadCatalogTheme(h.selection, { fetcher: h.fetcher });
		expect(h.fetcher.mock.calls.at(-1)[0]).toBe(raw + h.entry.path);
		expect(h.fetcher).toHaveBeenCalledTimes(3);
	});

	it('rejects a stale selection instead of installing a different package silently', async () => {
		const h = await fixture();
		await expect(downloadCatalogTheme({ ...h.selection, packageId: 'b'.repeat(64) }, { fetcher: h.fetcher })).rejects.toMatchObject({
			code: 'THEME_CATALOG_CHANGED',
			status: 409,
		});
		expect(h.fetcher).toHaveBeenCalledTimes(2);
	});

	it('rejects a tampered ZIP before package parsing or installation', async () => {
		const h = await fixture();
		h.catalog.themes[0].sha256 = 'b'.repeat(64);
		await expect(downloadCatalogTheme(h.selection, { fetcher: h.fetcher })).rejects.toHaveProperty('code', 'THEME_HASH_MISMATCH');
	});

	it('bounds the ZIP response even when Content-Length is missing', async () => {
		const h = await fixture();
		h.catalog.themes[0].size = 1;
		await expect(downloadCatalogTheme(h.selection, { fetcher: h.fetcher })).rejects.toHaveProperty('code', 'THEME_SIZE_LIMIT');
	});

	it('does not follow a redirect to an author-controlled server', async () => {
		const h = await fixture();
		h.fetcher.mockImplementationOnce(
			() => new Response(null, { status: 302, headers: { Location: 'https://author.example.org/catalog.json' } }),
		);
		await expect(readThemeCatalog({ fetcher: h.fetcher })).rejects.toHaveProperty('code', 'THEME_CATALOG_INVALID');
		expect(h.fetcher).toHaveBeenCalledTimes(1);
	});

	it('does not cache failures, allowing the next load to recover', async () => {
		const h = await fixture();
		h.fetcher.mockImplementationOnce(() => new Response('Unavailable', { status: 503 }));
		await expect(readThemeCatalog({ fetcher: h.fetcher })).rejects.toHaveProperty('code', 'THEME_DOWNLOAD_FAILED');
		expect((await readThemeCatalog({ fetcher: h.fetcher })).themes).toHaveLength(1);
	});

	it.each([
		['path', 'https://github.com/author/theme/release.zip'],
		['path', 'themes/../author/2fa-theme.zip'],
		['id', '__proto__'],
		['id', 'builtin-fake'],
		['size', 13 * 1024 * 1024],
		['packageId', 'not-a-hash'],
		['source', 'javascript:alert(1)'],
	])('rejects invalid catalog field %s=%s', async (key, value) => {
		const h = await fixture();
		h.entry[key] = value;
		expect(() => validateThemeCatalog(h.catalog)).toThrow('THEME_CATALOG_INVALID');
	});

	it('allows one latest entry per theme and rejects duplicate or case-colliding IDs', async () => {
		const h = await fixture();
		h.catalog.themes.push({ ...h.entry });
		expect(() => validateThemeCatalog(h.catalog)).toThrow('THEME_CATALOG_INVALID');
		h.catalog.themes[1].id = h.entry.id.toUpperCase();
		h.catalog.themes[1].path = `themes/${h.catalog.themes[1].id}/2fa-theme.zip`;
		expect(() => validateThemeCatalog(h.catalog)).toThrow('THEME_CATALOG_INVALID');
	});

	it('rejects arbitrary URL and forged metadata in install requests before fetching', async () => {
		const h = await fixture();
		await expect(
			downloadCatalogTheme({ ...h.selection, url: 'https://attacker.example.org/package.zip' }, { fetcher: h.fetcher }),
		).rejects.toHaveProperty('code', 'THEME_INVALID');
		expect(h.fetcher).not.toHaveBeenCalled();
	});
});

describe('owner catalog repositories', () => {
	it.each([
		['octo-cat/themes', 'octo-cat/themes'],
		['https://github.com/octo-cat/themes.git', 'octo-cat/themes'],
		[' octo-cat/my.themes_1/ ', 'octo-cat/my.themes_1'],
		['-octo/themes', null],
		['octo--cat/themes', null],
		['octo/..', null],
		['octo/themes/extra', null],
		['https://gitlab.com/octo/themes', null],
		[42, null],
	])('normalizes %s', (input, expected) => {
		expect(normalizeCatalogRepository(input)).toBe(expected);
	});

	it('reads and downloads only from the selected repository', async () => {
		const h = await fixture();
		const ref = 'https://api.github.com/repos/octo-cat/themes/git/ref/heads/main';
		const root = `https://raw.githubusercontent.com/octo-cat/themes/${revision}/`;
		const fetcher = vi.fn(async (url) => {
			const official = await h.fetcher(url.replace(ref, refUrl).replace(root, raw));
			return official;
		});
		const source = await downloadCatalogTheme({ ...h.selection, repository: 'octo-cat/themes' }, { fetcher, cache: false });
		expect(source.sourceUrl).toBe(root + h.entry.path);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([ref, root + 'catalog.json', root + h.entry.path]);
	});

	it('refuses a redirect into another repository', async () => {
		const h = await fixture();
		const fetcher = vi.fn(async (url) =>
			url.endsWith('/git/ref/heads/main')
				? new Response(null, { status: 302, headers: { Location: refUrl } })
				: new Response('Not found', { status: 404 }),
		);
		await expect(readThemeCatalog({ repository: 'octo-cat/themes', fetcher, cache: false })).rejects.toBeTruthy();
		expect(fetcher.mock.calls.map(([url]) => url)).not.toContain(refUrl);
		expect(h.fetcher).not.toHaveBeenCalled();
	});

	it('rejects an invalid repository before fetching', async () => {
		const h = await fixture();
		await expect(downloadCatalogTheme({ ...h.selection, repository: 'not valid' }, { fetcher: h.fetcher })).rejects.toHaveProperty(
			'code',
			'THEME_CATALOG_SOURCE_INVALID',
		);
		expect(h.fetcher).not.toHaveBeenCalled();
	});
});
