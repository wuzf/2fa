import { describe, expect, it, vi } from 'vitest';
import { harness, flush, json, act, themeCard } from '../helpers/appearance-editor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const zh = LOCALES['zh-CN'];
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
async function theme(id = 'community', version = '1.0.0') {
	const fixture = await appThemeFixture({ 'entry.js': 'export const mount=()=>{};//' + version }, { id, name: id, version });
	return normalizeAppThemeImport({ bytes: fixture.archive });
}
const entry = (pkg) => ({
	id: pkg.manifest.id,
	kind: 'app',
	name: pkg.manifest.name,
	version: pkg.manifest.version,
	description: 'A community theme',
	author: 'Example author',
	packageId: pkg.packageId,
});
const cards = (h) => [...h.document.querySelectorAll('#appearanceCatalog [data-appearance-action="catalog-install"]')];
const card = (h) => cards(h)[0];
const catalogText = (h) => h.document.getElementById('appearanceCatalog').textContent;
function setup(h, { catalog, installed = [], install } = {}) {
	h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
		if (url === '/api/themes/catalog') {
			return typeof catalog === 'function' ? catalog() : json({ themes: catalog || [] });
		}
		if (url === '/api/themes/catalog/install') {
			const result = await install?.(JSON.parse(options.body));
			if (result instanceof Response) {
				return result;
			}
			installed = [result];
			return json({ theme: result });
		}
		if (url === '/api/themes') {
			return json({ themes: [getBuiltinTheme('fluent')] });
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: installed });
		}
		return json({ revision: 1, active: h.initial, capabilities: { write: true } });
	});
}

describe('community theme catalog', () => {
	it('loads independently of local themes and renders entries when the catalog arrives', async () => {
		const pending = deferred();
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: () => pending.promise });
		await h.window.showAppearanceEditor();
		expect(themeCard(h, 'builtin:fluent').disabled).toBe(false);
		expect(catalogText(h)).toContain(zh.appearanceCatalogLoading);
		const accent = h.document.querySelector('[data-theme-setting=accent]');
		accent.focus();
		pending.resolve(json({ themes: [entry(pkg)] }));
		await flush();
		expect(catalogText(h)).not.toContain(zh.appearanceCatalogLoading);
		expect(card(h).textContent).toContain(pkg.manifest.name);
		expect(card(h).textContent).toContain('1.0.0 · Example author');
		expect(card(h).title).toBe('A community theme');
		expect(card(h).getAttribute('aria-pressed')).toBe('false');
		expect(h.document.activeElement).toBe(accent);
	});

	it('keeps local themes usable after a catalog error and offers retry', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		let tries = 0;
		setup(h, { catalog: () => (++tries === 1 ? json({}, 503) : json({ themes: [entry(pkg)] })) });
		await h.window.showAppearanceEditor();
		await flush();
		expect(catalogText(h)).toContain(zh.appearanceCatalogUnavailable);
		expect(themeCard(h, 'builtin:fluent').disabled).toBe(false);
		await act(h, 'catalog-retry');
		expect(card(h)).not.toBeUndefined();
		expect(h.window.authenticatedFetch.mock.calls.filter(([url]) => url === '/api/themes/catalog')).toHaveLength(2);
	});

	it('does not request the catalog while offline and still shows local theme controls', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent'), online: false });
		await h.window.showAppearanceEditor();
		expect(h.window.authenticatedFetch).not.toHaveBeenCalled();
		expect(themeCard(h, 'builtin:fluent').disabled).toBe(false);
		expect(h.document.querySelector('[data-appearance-action=catalog-retry]')).not.toBeNull();
	});

	it('hides catalog entries that are already installed and shows the empty state', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], installed: [pkg] });
		await h.window.showAppearanceEditor();
		await flush();
		expect(cards(h)).toHaveLength(0);
		expect(catalogText(h)).toContain(zh.appearanceCatalogEmpty);
		expect(themeCard(h, pkg.packageId)).not.toBeNull();
	});

	it('installs the selected package identity, selects it without applying and keeps the trust confirmation', async () => {
		const old = await theme('community', '1.0.0');
		const next = await theme('community', '2.0.0');
		const h = harness({ theme: old });
		const install = vi.fn(async () => next);
		setup(h, { catalog: [entry(next)], installed: [old], install });
		await h.window.showAppearanceEditor();
		await flush();
		expect(card(h).textContent).toContain(zh.appearanceCatalogUpdate);
		card(h).click();
		await flush();
		expect(install).toHaveBeenCalledWith({ id: 'community', packageId: next.packageId });
		expect(cards(h)).toHaveLength(0);
		expect(themeCard(h, next.packageId).getAttribute('aria-pressed')).toBe('true');
		expect(themeCard(h, old.packageId)).toBeNull();
		expect(h.document.getElementById('appearanceStatus').textContent).toBe(zh.appearanceInstalled);
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		h.window.showConfirmDialog.mockResolvedValue(false);
		await act(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});

	it('keeps the draft unchanged if a catalog install fails', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], install: async () => json({ code: 'THEME_PACKAGE_INVALID' }, 400) });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).click();
		await flush();
		expect(themeCard(h, 'builtin:fluent').getAttribute('aria-pressed')).toBe('true');
		expect(themeCard(h, pkg.packageId)).toBeNull();
		expect(h.document.querySelector('[data-appearance-action=apply]').disabled).toBe(true);
		expect(h.document.getElementById('appearanceStatus').dataset.error).toBe('true');
	});

	it('refreshes a changed catalog so a failed installation can be retried against the new package', async () => {
		const old = await theme('community', '1.0.0');
		const latest = await theme('community', '2.0.0');
		const h = harness({ theme: getBuiltinTheme('fluent') });
		let changed = false;
		const install = vi.fn(async () => {
			if (!changed) {
				changed = true;
				return json({ code: 'THEME_CATALOG_CHANGED' }, 409);
			}
			return latest;
		});
		setup(h, { catalog: () => json({ themes: [entry(changed ? latest : old)] }), install });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).click();
		await flush();
		expect(card(h).dataset.package).toBe(latest.packageId);
		expect(h.document.getElementById('appearanceStatus').dataset.error).toBe('true');
		card(h).click();
		await flush();
		expect(install.mock.calls.map(([body]) => body.packageId)).toEqual([old.packageId, latest.packageId]);
		expect(themeCard(h, latest.packageId).getAttribute('aria-pressed')).toBe('true');
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
	});

	it('ignores an old catalog response after the editor closes and reopens', async () => {
		const old = deferred();
		const stale = await theme('stale');
		const current = await theme('current');
		const h = harness({ theme: getBuiltinTheme('fluent') });
		let requests = 0;
		setup(h, { catalog: () => (++requests === 1 ? old.promise : json({ themes: [entry(current)] })) });
		await h.window.showAppearanceEditor();
		await h.window.requestAppearanceClose();
		await h.window.showAppearanceEditor();
		await flush();
		expect(card(h).dataset.catalogId).toBe('current');
		old.resolve(json({ themes: [entry(stale)] }));
		await flush();
		expect(cards(h).map((item) => item.dataset.catalogId)).toEqual(['current']);
	});

	it('keeps the editor open while an installation is pending and never applies the late result', async () => {
		const pending = deferred();
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], install: () => pending.promise });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).click();
		await flush();
		expect(h.document.getElementById('appearanceStatus').textContent).toBe(zh.appearanceInstalling);
		expect(h.document.querySelector('[data-appearance-action=apply]').disabled).toBe(true);
		await h.window.requestAppearanceClose();
		expect(h.document.getElementById('appearanceModal').style.display).toBe('block');
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		pending.resolve(pkg);
		await flush();
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(themeCard(h, pkg.packageId).getAttribute('aria-pressed')).toBe('true');
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});
});

describe('owner catalogs and theme files', () => {
	const official = 'wuzf/2fa-theme-mytheme';
	function owner(h, { sources = [{ repository: official, official: true, status: 'ready' }], themes = [], installed = [], upload } = {}) {
		const state = { sources, themes, installed, saved: [] };
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes/catalog') {
				return json({ themes: state.themes, sources: state.sources });
			}
			if (url === '/api/themes/catalogs' && options.method === 'PUT') {
				const { repositories } = JSON.parse(options.body);
				state.saved.push(repositories);
				if (repositories.some((value) => !/^[\w-]+\/[\w.-]+$/.test(value))) {
					return json({ error: 'THEME_CATALOG_SOURCE_INVALID' }, 400);
				}
				state.sources = [state.sources[0], ...repositories.map((repository) => ({ repository, official: false, status: 'ready' }))];
				return json({ official, custom: repositories });
			}
			if (url === '/api/themes/catalog/install') {
				const pkg = state.themes.find((item) => item.packageId === JSON.parse(options.body).packageId).pkg;
				state.installed = [pkg];
				return json({ theme: pkg });
			}
			if (url === '/api/themes/import') {
				const result = await upload(options);
				if (result instanceof Response) {
					return result;
				}
				state.installed = [result];
				return json({ theme: result }, 201);
			}
			if (url === '/api/themes') {
				return json({ themes: [getBuiltinTheme('fluent')] });
			}
			if (url === '/api/themes?format=app') {
				return json({ themes: state.installed });
			}
			return json({ revision: 1, active: h.initial, capabilities: { write: true } });
		});
		return state;
	}
	const sourceNames = (h) => [...h.document.querySelectorAll('.appearance-catalog-source-name')].map((item) => item.textContent);
	const addCatalog = async (h, value) => {
		const input = h.document.getElementById('appearanceCatalogRepository');
		input.value = value;
		input.dispatchEvent(new h.window.Event('input'));
		await act(h, 'catalog-add');
	};

	it('adds and removes an owner catalog and marks its themes with the repository', async () => {
		const pkg = await theme('owned');
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const state = owner(h);
		await h.window.showAppearanceEditor();
		await flush();
		expect(catalogText(h)).toContain(zh.appearanceCatalogSources);
		expect(sourceNames(h)).toEqual([]);
		state.themes = [{ ...entry(pkg), repository: 'octo-cat/themes', pkg }];
		await addCatalog(h, 'octo-cat/themes');
		expect(state.saved).toEqual([['octo-cat/themes']]);
		expect(sourceNames(h)).toEqual(['octo-cat/themes']);
		expect(h.document.getElementById('appearanceCatalogRepository').value).toBe('');
		expect(card(h).dataset.repository).toBe('octo-cat/themes');
		expect(card(h).textContent).toContain('来自 octo-cat/themes');
		card(h).click();
		await flush();
		const install = h.window.authenticatedFetch.mock.calls.find(([url]) => url === '/api/themes/catalog/install');
		expect(JSON.parse(install[1].body)).toEqual({ id: 'owned', packageId: pkg.packageId, repository: 'octo-cat/themes' });
		expect(themeCard(h, pkg.packageId).getAttribute('aria-pressed')).toBe('true');
		state.themes = [];
		await act(h, 'catalog-remove');
		expect(state.saved.at(-1)).toEqual([]);
		expect(sourceNames(h)).toEqual([]);
		expect(themeCard(h, pkg.packageId)).not.toBeNull();
	});

	it('keeps official themes and the input after an invalid repository, and reports one failing catalog by name', async () => {
		const pkg = await theme('official');
		const h = harness({ theme: getBuiltinTheme('fluent') });
		owner(h, {
			sources: [
				{ repository: official, official: true, status: 'ready' },
				{ repository: 'gone/away', official: false, status: 'error', error: 'THEME_DOWNLOAD_FAILED' },
			],
			themes: [{ ...entry(pkg), repository: official, pkg }],
		});
		await h.window.showAppearanceEditor();
		await flush();
		expect(catalogText(h)).toContain('gone/away 暂时无法加载，请稍后重试。');
		expect(card(h).dataset.repository).toBe('');
		expect(card(h).textContent).not.toContain('来自');
		await addCatalog(h, 'not a repository');
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(zh.appearanceErrorCatalogSource);
		expect(h.document.getElementById('appearanceCatalogRepository').value).toBe('not a repository');
		expect(card(h).dataset.catalogId).toBe('official');
	});

	it('uploads a chosen ZIP, selects it without applying and keeps the trust confirmation', async () => {
		const pkg = await theme('uploaded');
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const upload = vi.fn(async () => pkg);
		owner(h, { upload });
		await h.window.showAppearanceEditor();
		await flush();
		const input = h.document.getElementById('appearanceImportFile');
		expect(input.accept).toBe('.zip,application/zip');
		const opened = vi.fn();
		input.addEventListener('click', opened);
		await act(h, 'import-file');
		expect(opened).toHaveBeenCalledTimes(1);
		const file = new h.window.File([new Uint8Array([80, 75, 3, 4])], '我的主题.zip', { type: 'application/zip' });
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		input.dispatchEvent(new h.window.Event('change'));
		await flush();
		const [options] = upload.mock.calls[0];
		expect(options.method).toBe('POST');
		expect(options.headers).toEqual({ 'Content-Type': 'application/zip', 'X-File-Name': '____.zip' });
		expect(options.body).toBe(file);
		expect(themeCard(h, pkg.packageId).getAttribute('aria-pressed')).toBe('true');
		expect(h.document.getElementById('appearanceStatus').textContent).toBe(zh.appearanceInstalled);
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		h.window.showConfirmDialog.mockResolvedValue(false);
		await act(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
	});

	it('reports a damaged or oversized file without changing the draft', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const upload = vi.fn(async () => json({ error: 'THEME_INVALID_ZIP' }, 400));
		owner(h, { upload });
		await h.window.showAppearanceEditor();
		await flush();
		const input = h.document.getElementById('appearanceImportFile');
		const choose = async (file) => {
			Object.defineProperty(input, 'files', { value: [file], configurable: true });
			input.dispatchEvent(new h.window.Event('change'));
			await flush();
		};
		await choose(new h.window.File([new Uint8Array(4)], 'broken.zip'));
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(zh.appearanceErrorFormat);
		const large = new h.window.File([new Uint8Array(1)], 'large.zip');
		Object.defineProperty(large, 'size', { value: 12 * 1024 * 1024 + 1 });
		await choose(large);
		expect(upload).toHaveBeenCalledTimes(1);
		expect(h.document.getElementById('appearanceStatus').textContent).toBe(zh.appearanceErrorLimit);
		expect(themeCard(h, 'builtin:fluent').getAttribute('aria-pressed')).toBe('true');
	});

	it('offers neither catalog management nor file import without write access', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent'), write: false });
		await h.window.showAppearanceEditor();
		await flush();
		expect(h.document.getElementById('appearanceImportFile')).toBeNull();
		expect(h.document.getElementById('appearanceCatalogRepository')).toBeNull();
	});
});
