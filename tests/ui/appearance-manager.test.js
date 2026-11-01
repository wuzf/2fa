import { describe, expect, it } from 'vitest';
import { harness, flush, json, control, act, themeCard, chooseTheme, editSetting } from '../helpers/appearance-editor.js';
import { getBuiltinThemes, getBuiltinTheme } from '../../src/themes/builtins.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const zh = LOCALES['zh-CN'];
const libraryCards = (h) => [...h.document.querySelectorAll('#appearancePanel [data-appearance-action="select"]')];
const packages = (h) => libraryCards(h).map((card) => card.dataset.package);
async function versions(id, count = 4) {
	return Promise.all(
		Array.from({ length: count }, async (_, index) => {
			const fixture = await appThemeFixture(
				{ 'entry.js': 'export const mount=()=>{};//' + index },
				{
					id,
					name: id,
					version: '1.0.0',
					settings: [{ key: 'accent', label: 'Accent', type: 'color', default: '#123456' }],
				},
			);
			return { ...(await normalizeAppThemeImport({ bytes: fixture.archive })), installedAt: Date.UTC(2026, 9, 20 + index) };
		}),
	);
}
function library(h, themes, { onDelete } = {}) {
	h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
		if (options.method === 'DELETE') {
			const id = decodeURIComponent(url.slice('/api/themes/'.length));
			themes = themes.filter((theme) => theme.packageId !== id);
			return onDelete?.(id) || json({ deleted: true });
		}
		if (url === '/api/themes') {
			return json({ themes: themes.filter((theme) => theme.kind !== 'app') });
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: themes.filter((theme) => theme.kind === 'app') });
		}
		if (url === '/api/themes/catalog') {
			return json({ themes: [] });
		}
		return json({ active: h.initial, revision: h.initial.revision, capabilities: { write: true } });
	});
}
async function app(settings = []) {
	const fixture = await appThemeFixture({ 'entry.js': 'export const mount=()=>{};' }, { id: 'independent', settings });
	return normalizeAppThemeImport({ bytes: fixture.archive });
}

describe('simplified theme manager', () => {
	it('shows one official default and installed themes without unused built-in presets', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const installed = await app();
		library(h, [...getBuiltinThemes(), installed]);
		await h.window.showAppearanceEditor();
		expect(packages(h)).toEqual(['builtin:fluent', installed.packageId]);
		expect(themeCard(h, 'builtin:fluent').textContent).toContain(zh.appearanceOfficialDefault);
		expect(themeCard(h, 'builtin:fluent').textContent).toContain(zh.appearanceCurrent);
		expect(themeCard(h, 'builtin:fluent').getAttribute('aria-pressed')).toBe('true');
		expect(themeCard(h, installed.packageId).getAttribute('aria-pressed')).toBe('false');
		expect(themeCard(h, installed.packageId).textContent).not.toContain(zh.appearanceCurrent);
	});

	it('shows a delete button only on installed theme cards', async () => {
		const h = harness({ theme: getBuiltinTheme('document') });
		const installed = await app();
		library(h, [...getBuiltinThemes(), installed]);
		await h.window.showAppearanceEditor();
		expect(packages(h)).toEqual(['builtin:fluent', 'builtin:document', installed.packageId]);
		const deletes = [...h.document.querySelectorAll('.appearance-theme-delete')];
		expect(deletes.map((button) => button.dataset.package)).toEqual([installed.packageId]);
		expect(deletes[0].dataset.appearanceAction).toBe('delete');
		expect(deletes[0].getAttribute('aria-label')).toContain(zh.appearanceDelete);
		expect(deletes[0].closest('.appearance-theme-item').contains(themeCard(h, installed.packageId))).toBe(true);
	});

	it('retains the active legacy preset with its saved settings', async () => {
		const h = harness({ theme: getBuiltinTheme('compact') });
		h.initial.settings.accent = '#ab1234';
		library(h, getBuiltinThemes());
		await h.window.showAppearanceEditor();
		expect(packages(h)).toEqual(['builtin:fluent', 'builtin:compact']);
		expect(themeCard(h, 'builtin:compact').getAttribute('aria-pressed')).toBe('true');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		await chooseTheme(h, 'builtin:fluent');
		expect(packages(h)).toEqual(['builtin:fluent', 'builtin:compact']);
	});

	it('edits only declared app settings, explains empty settings and preserves the trust confirmation', async () => {
		const installed = await app([
			{
				key: 'density',
				type: 'select',
				label: 'Density',
				default: 'comfortable',
				options: [
					{ value: 'comfortable', label: 'Comfortable' },
					{ value: 'compact', label: 'Compact' },
				],
			},
		]);
		const h = harness({ theme: installed });
		library(h, [getBuiltinTheme('fluent'), installed]);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelectorAll('[data-theme-setting]')).toHaveLength(1);
		expect(h.document.getElementById('appearancePanel').textContent).toContain(zh.appearanceAppTrust);
		editSetting(h, 'density', 'compact');
		h.window.showConfirmDialog.mockResolvedValue(false);
		await act(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		expect(h.document.querySelector('[data-theme-setting=density]').value).toBe('compact');
		const empty = await app();
		const emptyHost = harness({ theme: empty });
		library(emptyHost, [empty]);
		await emptyHost.window.showAppearanceEditor();
		expect(emptyHost.document.getElementById('appearancePanel').textContent).toContain(zh.appearanceNoThemeSettings);
		expect(emptyHost.document.querySelector('[data-appearance-action=reset]')).toBeNull();
		expect(
			emptyHost.document.querySelector(
				'#appearancePanel input:not(#appearanceImportFile, #appearanceCatalogRepository), #appearancePanel textarea, #appearancePanel select',
			),
		).toBeNull();
	});
});

describe('single installed theme selection', () => {
	it('shows only the newest installed package per format and id without historical versions', async () => {
		const families = await Promise.all(['pixel', 'sketch', 'journal'].map((name) => versions(name)));
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), ...families.flat().reverse()]);
		await h.window.showAppearanceEditor();
		expect(packages(h)).toHaveLength(4);
		for (const family of families) {
			expect(packages(h)).toContain(family[3].packageId);
		}
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method)).toBe(false);
	});

	it('keeps the running older package draft until the user explicitly selects its replacement', async () => {
		const family = await versions('pixel');
		const h = harness({ theme: family[0] });
		h.initial.settings.accent = '#ab1234';
		library(h, [family[3]]);
		await h.window.showAppearanceEditor();
		expect(packages(h)).toEqual([family[3].packageId]);
		expect(themeCard(h, family[3].packageId).getAttribute('aria-pressed')).toBe('false');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		expect(control(h, 'apply').disabled).toBe(true);
		await chooseTheme(h, family[3].packageId);
		expect(themeCard(h, family[3].packageId).getAttribute('aria-pressed')).toBe('true');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		expect(control(h, 'apply').disabled).toBe(false);
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
	});

	it('restores saved settings into the latest package from its stored profile', async () => {
		const family = await versions('journal');
		const saved = createAppearanceDraft(family[0]).draft;
		saved.settings.accent = '#ab1234';
		family.forEach((theme) => {
			theme.profile = saved;
		});
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), ...family]);
		await h.window.showAppearanceEditor();
		expect(packages(h)).toEqual(['builtin:fluent', family[3].packageId]);
		await chooseTheme(h, family[3].packageId);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
	});

	it('preserves A to B to A settings and asks for trust before applying a replacement package', async () => {
		const a = await versions('pixel', 2);
		const b = await versions('journal', 1);
		const h = harness({ theme: a[0] });
		library(h, [a[1], b[0]]);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, a[1].packageId);
		editSetting(h, 'accent', '#ff0000');
		await chooseTheme(h, b[0].packageId);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#123456');
		await chooseTheme(h, a[1].packageId);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ff0000');
		h.window.showConfirmDialog.mockResolvedValue(false);
		await act(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});

	it('keeps format and theme identities separate and ignores internal superseded records', async () => {
		const [one, two] = await versions('document', 2);
		one.installedAt = Number.NaN;
		two.installedAt = undefined;
		const old = { ...(await versions('hidden', 1))[0], superseded: true };
		const legacy = { ...getBuiltinTheme('document'), packageId: 'f'.repeat(64), builtIn: false };
		const other = (await versions('different', 1))[0];
		other.manifest.name = one.manifest.name;
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [other, two, legacy, one, old]);
		await h.window.showAppearanceEditor();
		const installed = packages(h).filter((id) => !id.startsWith('builtin:'));
		expect(installed).toHaveLength(3);
		expect(installed).toEqual(expect.arrayContaining([other.packageId, legacy.packageId, [one.packageId, two.packageId].sort().at(-1)]));
		expect(installed).not.toContain(old.packageId);
	});

	it('moves focus to the newly selected card', async () => {
		const a = await versions('pixel', 1);
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), a[0]]);
		await h.window.showAppearanceEditor();
		const target = themeCard(h, a[0].packageId);
		target.focus();
		target.click();
		await flush();
		expect(themeCard(h, a[0].packageId)).not.toBe(target);
		expect(h.document.activeElement).toBe(themeCard(h, a[0].packageId));
		expect(h.document.activeElement.disabled).toBe(false);
	});
});

describe('installed theme deletion', () => {
	it('confirms, deletes the encoded package id and removes its card while keeping other edits', async () => {
		const [pixel] = await versions('pixel', 1);
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), pixel]);
		await h.window.showAppearanceEditor();
		editSetting(h, 'accent', '#ff0000');
		h.window.showConfirmDialog.mockResolvedValueOnce(false);
		await act(h, 'delete');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceDeleteConfirm' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
		await act(h, 'delete');
		const deletes = h.window.authenticatedFetch.mock.calls.filter(([, options]) => options?.method === 'DELETE');
		expect(deletes.map(([url]) => url)).toEqual(['/api/themes/' + encodeURIComponent(pixel.packageId)]);
		expect(packages(h)).toEqual(['builtin:fluent']);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ff0000');
		expect(control(h, 'apply').disabled).toBe(false);
	});

	it('replaces the draft with the server appearance when the selected theme is deleted', async () => {
		const [pixel] = await versions('pixel', 1);
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), pixel]);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, pixel.packageId);
		await act(h, 'delete');
		expect(themeCard(h, 'builtin:fluent').getAttribute('aria-pressed')).toBe('true');
		expect(control(h, 'apply').disabled).toBe(true);
		expect(h.window.showConfirmDialog).toHaveBeenCalledTimes(1);
	});

	it('shows the localized reason when the server refuses to delete the theme in use', async () => {
		const [pixel] = await versions('pixel', 1);
		const h = harness({ theme: pixel });
		library(h, [getBuiltinTheme('fluent'), pixel], { onDelete: () => json({ error: 'THEME_IN_USE' }, 409) });
		await h.window.showAppearanceEditor();
		await act(h, 'delete');
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(zh.appearanceErrorInUse);
		expect(themeCard(h, pixel.packageId)).not.toBeNull();
	});
});
