import { describe, expect, it, vi } from 'vitest';
import { harness, flush } from '../helpers/appearance-editor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
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
const card = (h) => h.document.querySelector('.appearance-catalog-card');
const action = async (h, name) => {
	h.document.querySelector('[data-appearance-action="' + name + '"]').click();
	await flush();
};
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
	it('loads independently and preserves typed personal theme URLs and focus when the catalog arrives', async () => {
		const pending = deferred();
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: () => pending.promise });
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('[data-package="builtin:fluent"]').disabled).toBe(false);
		const source = h.document.getElementById('appearanceSource');
		source.value = 'https://example.com/private.zip';
		source.focus();
		pending.resolve(json({ themes: [entry(pkg)] }));
		await flush();
		expect(card(h).textContent).toContain(pkg.manifest.name);
		expect(h.document.getElementById('appearanceSource')).toBe(source);
		expect(source.value).toBe('https://example.com/private.zip');
		expect(h.document.activeElement).toBe(source);
		expect(h.document.querySelector('input[type=file]')).not.toBeNull();
		expect(h.document.querySelector('.appearance-catalog-submit').href).toBe(
			'https://github.com/wuzf/2fa-theme-mytheme/blob/main/CONTRIBUTING.md',
		);
	});

	it('keeps local themes and personal imports usable after a catalog error and offers retry', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		let tries = 0;
		setup(h, { catalog: () => (++tries === 1 ? json({}, 503) : json({ themes: [entry(pkg)] })) });
		await h.window.showAppearanceEditor();
		await flush();
		expect(h.document.getElementById('appearanceCatalog').textContent).toContain(LOCALES['zh-CN'].appearanceCatalogUnavailable);
		expect(h.document.querySelector('[data-appearance-action=install]').disabled).toBe(false);
		expect(h.document.querySelector('[data-package="builtin:fluent"]').disabled).toBe(false);
		await action(h, 'catalog-retry');
		expect(card(h)).not.toBeNull();
		expect(h.window.authenticatedFetch.mock.calls.filter(([url]) => url === '/api/themes/catalog')).toHaveLength(2);
	});

	it('does not request the catalog while offline and still shows local theme controls', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent'), online: false });
		await h.window.showAppearanceEditor();
		expect(h.window.authenticatedFetch).not.toHaveBeenCalled();
		expect(h.document.querySelector('[data-package="builtin:fluent"]').disabled).toBe(false);
		expect(h.document.querySelector('[data-appearance-action=catalog-retry]')).not.toBeNull();
		expect(h.document.querySelector('input[type=file]')).not.toBeNull();
	});

	it('selects an already installed catalog theme without downloading it again or applying it', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], installed: [pkg] });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).focus();
		card(h).click();
		await flush();
		expect(card(h).getAttribute('aria-pressed')).toBe('true');
		expect(h.document.activeElement).toBe(card(h));
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method)).toBe(false);
		await action(h, 'keep');
		expect(h.saved().draft.packageId).toBe(pkg.packageId);
	});

	it('installs the selected package identity and retains trust confirmation for applying a replacement', async () => {
		const old = await theme('community', '1.0.0');
		const next = await theme('community', '2.0.0');
		const h = harness({ theme: old });
		const install = vi.fn(async () => next);
		setup(h, { catalog: [entry(next)], installed: [old], install });
		await h.window.showAppearanceEditor();
		await flush();
		expect(card(h).textContent).toContain(LOCALES['zh-CN'].appearanceCatalogUpdate);
		card(h).click();
		await flush();
		expect(install).toHaveBeenCalledWith({ id: 'community', packageId: next.packageId });
		expect(h.document.querySelectorAll('.appearance-installed-themes .appearance-theme-card')).toHaveLength(1);
		expect(card(h).getAttribute('aria-pressed')).toBe('true');
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		h.window.showConfirmDialog.mockResolvedValue(false);
		await action(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});

	it('keeps the draft and installed theme unchanged if a catalog install fails', async () => {
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], install: async () => json({ code: 'THEME_CATALOG_CHANGED' }, 409) });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).click();
		await flush();
		expect(h.document.querySelector('[data-package="builtin:fluent"]').getAttribute('aria-pressed')).toBe('true');
		expect(h.document.querySelector('.appearance-installed-themes')).toBeNull();
		expect(h.saved()).toBeUndefined();
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
		expect(h.saved()).toBeUndefined();
		card(h).click();
		await flush();
		expect(install.mock.calls.map(([body]) => body.packageId)).toEqual([old.packageId, latest.packageId]);
		expect(card(h).getAttribute('aria-pressed')).toBe('true');
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
		expect(card(h).dataset.catalogId).toBe('current');
	});

	it('does not adopt a late installation into the draft after another flow hides the editor', async () => {
		const pending = deferred();
		const pkg = await theme();
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { catalog: [entry(pkg)], install: () => pending.promise });
		await h.window.showAppearanceEditor();
		await flush();
		card(h).click();
		await flush();
		h.window.hideModal('appearanceModal');
		pending.resolve(pkg);
		await flush();
		expect(h.saved()).toBeUndefined();
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.document.querySelector('[data-package="builtin:fluent"]').getAttribute('aria-pressed')).toBe('true');
	});
});
