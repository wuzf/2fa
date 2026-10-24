import { describe, expect, it, vi } from 'vitest';
import { harness, flush } from '../helpers/appearance-editor.js';
import { getBuiltinThemes, getBuiltinTheme } from '../../src/themes/builtins.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { normalizeAppThemeImport } from '../../src/themes/appPackage.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const json = (data) => new Response(JSON.stringify(data));
const choosePanel = (h, name) => h.document.querySelector('[data-panel="' + name + '"]').click();
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
