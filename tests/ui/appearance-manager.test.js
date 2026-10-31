import { describe, expect, it, vi } from 'vitest';
import { harness, flush } from '../helpers/appearance-editor.js';
import { getBuiltinThemes, getBuiltinTheme } from '../../src/themes/builtins.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const json = (data) => new Response(JSON.stringify(data));
const choosePanel = (h, name) => h.document.querySelector('[data-panel="' + name + '"]').click();
const group = (h, key) => [...h.document.querySelectorAll('.appearance-theme-group')].find((item) => item.dataset.themeGroup === key);
const representative = (h, key) => group(h, key).querySelector('.appearance-theme-card').dataset.package;
const runAction = async (h, name) => {
	h.document.querySelector('[data-appearance-action="' + name + '"]').click();
	await flush();
};
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
async function chooseTheme(h, key) {
	group(h, key).querySelector('.appearance-theme-card').click();
	await flush();
}
function library(h, themes) {
	h.window.authenticatedFetch.mockImplementation(async (url) => {
		if (url === '/api/themes') {
			return json({ themes: themes.filter((theme) => theme.kind !== 'app') });
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: themes.filter((theme) => theme.kind === 'app') });
		}
		return json({ active: h.initial, revision: h.initial.revision, capabilities: { write: true } });
	});
}
async function app(settings = []) {
	const fixture = await appThemeFixture({ 'entry.js': 'export const mount=()=>{};' }, { id: 'independent', settings });
	return normalizeAppThemeImport({ bytes: fixture.archive });
}

describe('simplified theme manager', () => {
	it('shows one official default and installed themes without exposing unused built-in presets or an import format selector', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const installed = await app();
		library(h, [...getBuiltinThemes(), installed]);
		await h.window.showAppearanceEditor();
		expect([...h.document.querySelectorAll('.appearance-tab')].map((tab) => tab.textContent)).toEqual([
			LOCALES['zh-CN'].appearanceLibrary,
			LOCALES['zh-CN'].appearanceBrand,
			LOCALES['zh-CN'].appearanceThemeSettings,
		]);
		expect([...h.document.querySelectorAll('.appearance-theme-card')].map((card) => card.dataset.package)).toEqual([
			'builtin:fluent',
			installed.packageId,
		]);
		expect(h.document.querySelector('[data-package="builtin:fluent"] strong').textContent).toBe('官方默认主题');
		expect(h.document.querySelector('.appearance-legacy-themes')).toBeNull();
		expect(h.document.getElementById('appearanceImportFormat')).toBeNull();
		expect(h.document.querySelector('input[type=file]').accept).toBe('.zip,.json,.css');
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});

	it('retains active and previously saved legacy presets with selected state and full saved settings', async () => {
		const h = harness();
		h.initial.settings.accent = '#123456';
		h.initial.customCss = '[data-part="account"]{border-width:3px}';
		const themes = getBuiltinThemes();
		const compact = themes.find((theme) => theme.manifest.id === 'compact');
		compact.profile = createAppearanceDraft(compact).draft;
		compact.profile.settings.accent = '#abcdef';
		library(h, themes);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('.appearance-legacy-themes').open).toBe(true);
		expect(h.document.querySelector('[data-package="builtin:document"]').getAttribute('aria-pressed')).toBe('true');
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#123456');
		expect(h.document.querySelector('.appearance-advanced-settings').open).toBe(false);
		expect(h.document.querySelector('.appearance-advanced-settings > .appearance-field textarea').value).toBe(h.initial.customCss);
		choosePanel(h, 'library');
		h.document.querySelector('[data-package="builtin:compact"]').click();
		await flush();
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#abcdef');
		choosePanel(h, 'library');
		h.document.querySelector('[data-package="builtin:document"]').click();
		await flush();
		h.document.querySelector('[data-appearance-action=keep]').click();
		await flush();
		expect(h.saved().draft).toMatchObject({
			packageId: 'builtin:document',
			settings: { accent: '#123456' },
			customCss: h.initial.customCss,
		});
		expect(h.saved().draft.layout).toEqual(h.initial.layout);
	});

	it('keeps previously used compatibility choices collapsed while an independent theme is selected', async () => {
		const installed = await app();
		const h = harness({ theme: installed });
		const old = getBuiltinTheme('compact');
		old.profile = createAppearanceDraft(old).draft;
		library(h, [getBuiltinTheme('fluent'), old, installed]);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('.appearance-legacy-themes').open).toBe(false);
		expect(h.document.querySelector('.appearance-legacy-themes [data-package="builtin:compact"]')).not.toBeNull();
		expect(h.document.querySelector('[data-package="' + installed.packageId + '"]').getAttribute('aria-pressed')).toBe('true');
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
		choosePanel(h, 'design');
		expect(h.document.querySelector('.appearance-advanced-settings')).toBeNull();
		expect(h.document.querySelector('.appearance-layout-settings')).toBeNull();
		const density = h.document.querySelector('[data-theme-setting=density]');
		density.value = 'compact';
		density.dispatchEvent(new h.window.Event('change'));
		h.window.showConfirmDialog = vi.fn(async () => false);
		h.document.querySelector('[data-appearance-action=apply]').click();
		await flush();
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		h.document.querySelector('[data-appearance-action=keep]').click();
		await flush();
		expect(h.saved().draft.settings.density).toBe('compact');
		for (const field of ['layout', 'customCss', 'content']) {
			expect(h.saved().draft).not.toHaveProperty(field);
		}
		const empty = await app();
		const emptyHost = harness({ theme: empty });
		library(emptyHost, [empty]);
		await emptyHost.window.showAppearanceEditor();
		choosePanel(emptyHost, 'design');
		expect(emptyHost.document.getElementById('appearancePanel').textContent).toContain(LOCALES['zh-CN'].appearanceNoThemeSettings);
		expect(emptyHost.document.querySelector('#appearancePanel input, #appearancePanel textarea')).toBeNull();
	});
});

describe('single installed theme selection', () => {
	it.each(['apply', 'rollback', 'replayed receipt'])(
		'keeps the accepted server revision after %s when the runtime still identifies an older package',
		async (operation) => {
			const family = await versions('pixel', 2);
			const h = harness({ theme: family[0] });
			let active = h.initial;
			const accepted = { ...createAppearanceDraft(family[1]).draft, revision: operation === 'replayed receipt' ? 3 : 2 };
			h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
				if (url === '/api/themes') {
					return json({ themes: [] });
				}
				if (url === '/api/themes?format=app') {
					return json({ themes: [family[1]] });
				}
				if (url === '/api/themes/catalog') {
					return json({ themes: [] });
				}
				if (options.method === 'PUT' || url === '/api/appearance/rollback') {
					active = accepted;
					if (operation === 'replayed receipt') {
						return json({ active: { ...accepted, revision: 2 }, revision: 2, replayed: true });
					}
				}
				return json({ active, revision: active.revision, previous: true, capabilities: { write: true } });
			});
			await h.window.showAppearanceEditor();
			await chooseTheme(h, 'app:pixel');
			await runAction(h, operation === 'rollback' ? 'rollback' : 'apply');
			expect(h.window.__2FA_APPEARANCE__).toEqual(accepted);
			expect(group(h, 'app:pixel').querySelector('.appearance-theme-state').textContent).toBe(LOCALES['zh-CN'].appearanceCurrent);
			h.window.__2FA_APPEARANCE__ = h.initial;
			choosePanel(h, 'design');
			choosePanel(h, 'library');
			expect(group(h, 'app:pixel').querySelector('.appearance-theme-state').textContent).toBe(LOCALES['zh-CN'].appearanceCurrent);
			expect(h.saved()).toBeUndefined();
		},
	);

	it('shows only the newest installed package per format and id without historical versions', async () => {
		const families = await Promise.all(['pixel', 'sketch', 'journal'].map((name) => versions(name)));
		const h = harness({ theme: families[0][0] });
		library(h, [getBuiltinTheme('fluent'), ...families.flat().reverse()]);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelectorAll('.appearance-installed-themes .appearance-theme-card')).toHaveLength(3);
		expect(h.document.querySelectorAll('.appearance-version-history,.appearance-theme-version')).toHaveLength(0);
		for (const family of families) {
			expect(representative(h, 'app:' + family[0].manifest.id)).toBe(family[3].packageId);
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
		expect(representative(h, 'app:pixel')).toBe(family[3].packageId);
		expect(group(h, 'app:pixel').querySelector('[aria-pressed=true]')).toBeNull();
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		choosePanel(h, 'library');
		await chooseTheme(h, 'app:pixel');
		await runAction(h, 'keep');
		expect(h.saved().draft).toMatchObject({ packageId: family[3].packageId, settings: { accent: '#ab1234' } });
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
	});

	it('restores saved settings into the latest package without making the saved historical package selectable', async () => {
		const family = await versions('journal');
		const saved = createAppearanceDraft(family[0]).draft;
		saved.settings.accent = '#ab1234';
		family.forEach((theme) => {
			theme.profile = saved;
		});
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), ...family]);
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:journal')).toBe(family[3].packageId);
		await chooseTheme(h, 'app:journal');
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		expect(h.document.querySelectorAll('.appearance-theme-version')).toHaveLength(0);
	});

	it('preserves an existing local draft even when the current package no longer appears in the installed list', async () => {
		const family = await versions('pixel');
		const draft = { ...createAppearanceDraft(family[1]).draft, revision: 1 };
		draft.settings.accent = '#fedcba';
		const h = harness({ theme: family[0], savedDraft: { draft, revision: 1, dirty: true, profiles: [] } });
		library(h, [family[3]]);
		await h.window.showAppearanceEditor();
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#fedcba');
		await runAction(h, 'keep');
		expect(h.saved().draft.packageId).toBe(family[1].packageId);
	});

	it('imports a replacement as a local draft and keeps the running appearance unchanged', async () => {
		const family = await versions('journal', 2);
		const h = harness({ theme: family[0] });
		let installed = [family[0]];
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes/import' && options.method === 'POST') {
				installed = [family[1]];
				return json({ theme: family[1] });
			}
			if (url === '/api/themes') {
				return json({ themes: [] });
			}
			if (url === '/api/themes?format=app') {
				return json({ themes: installed });
			}
			return json({ active: h.initial, revision: 1, capabilities: { write: true } });
		});
		await h.window.showAppearanceEditor();
		h.document.getElementById('appearanceSource').value = 'https://example.com/journal.zip';
		await runAction(h, 'install');
		expect(representative(h, 'app:journal')).toBe(family[1].packageId);
		expect(h.document.querySelectorAll('.appearance-theme-card')).toHaveLength(1);
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		await runAction(h, 'keep');
		expect(h.saved()).toMatchObject({ revision: 1, dirty: true, draft: { packageId: family[1].packageId } });
	});

	it.each(['export', 'delete'])('targets the selected latest package on %s', async (operation) => {
		const family = await versions('sketch', 2);
		const h = harness({ theme: getBuiltinTheme('fluent') });
		let installed = [family[1]];
		const target = family[1].packageId;
		const path = '/api/themes/' + target + (operation === 'export' ? '/export' : '');
		const download = vi.spyOn(h.window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === path) {
				if (operation === 'delete') {
					installed = [];
				}
				return operation === 'export' ? new Response('theme archive') : json({ deleted: true });
			}
			if (url === '/api/themes') {
				return json({ themes: [getBuiltinTheme('fluent')] });
			}
			if (url === '/api/themes?format=app') {
				return json({ themes: installed });
			}
			return json({ active: h.initial, revision: 1, capabilities: { write: true } });
		});
		await h.window.showAppearanceEditor();
		await chooseTheme(h, 'app:sketch');
		h.window.authenticatedFetch.mockClear();
		await runAction(h, operation);
		expect(h.window.authenticatedFetch.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
		expect(h.window.authenticatedFetch.mock.calls.some(([url]) => url.includes(family[0].packageId))).toBe(false);
		if (operation === 'export') {
			expect(download).toHaveBeenCalledOnce();
			URL.revokeObjectURL(download.mock.instances[0].href);
		} else {
			expect(group(h, 'app:sketch')).toBeUndefined();
			expect(h.saved()).toBeUndefined();
		}
	});

	it('preserves A to B to A settings and asks for trust before applying a replacement package', async () => {
		const a = await versions('pixel', 2);
		const b = await versions('journal', 1);
		const h = harness({ theme: a[0] });
		library(h, [a[1], b[0]]);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, 'app:pixel');
		choosePanel(h, 'design');
		const color = h.document.querySelector('[data-theme-setting=accent]');
		color.value = '#ff0000';
		color.dispatchEvent(new h.window.Event('input'));
		choosePanel(h, 'library');
		await chooseTheme(h, 'app:journal');
		await chooseTheme(h, 'app:pixel');
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ff0000');
		h.window.showConfirmDialog.mockResolvedValue(false);
		await runAction(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		await runAction(h, 'keep');
		expect(h.saved().draft.packageId).toBe(a[1].packageId);
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
		expect(h.document.querySelectorAll('.appearance-theme-group')).toHaveLength(3);
		expect(representative(h, 'app:document')).toBe([one.packageId, two.packageId].sort().at(-1));
		expect(representative(h, 'v1:document')).toBe(legacy.packageId);
	});

	it('restores selection focus only while the editor still owns focus', async () => {
		const a = await versions('pixel', 1);
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), a[0]]);
		await h.window.showAppearanceEditor();
		const target = group(h, 'app:pixel').querySelector('button');
		target.focus();
		target.click();
		await flush();
		expect(h.document.activeElement.dataset.package).toBe(a[0].packageId);
		expect(h.document.activeElement.disabled).toBe(false);
	});
});
