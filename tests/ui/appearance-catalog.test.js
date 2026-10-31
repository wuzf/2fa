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
