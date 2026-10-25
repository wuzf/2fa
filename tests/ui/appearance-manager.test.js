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
const appliedVersions = (h, key) =>
	[...group(h, key).querySelectorAll('.appearance-theme-version')]
		.filter((row) => row.querySelector('.appearance-version-state')?.textContent.includes(LOCALES['zh-CN'].appearanceCurrent))
		.map((row) => row.dataset.package);
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
async function expand(h, key) {
	const details = group(h, key).querySelector('details');
	details.open = true;
	details.dispatchEvent(new h.window.Event('toggle'));
	await flush();
	return details;
}
async function chooseVersion(h, key, id, { focus = false } = {}) {
	const details = await expand(h, key);
	const button = [...details.querySelectorAll('.appearance-theme-version')].find((entry) => entry.dataset.package === id);
	if (focus) {
		button.focus();
	}
	button.click();
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

describe('installed theme version groups', () => {
	it('requires new trust for another build of a trusted theme and rejects it without publishing', async () => {
		const family = await versions('pixel', 2);
		const h = harness({ theme: family[0] });
		let active = h.initial;
		const writes = [];
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes') {
				return json({ themes: [] });
			}
			if (url === '/api/themes?format=app') {
				return json({ themes: family });
			}
			if (options.method === 'PUT') {
				const payload = JSON.parse(options.body);
				writes.push(payload);
				active = {
					...createAppearanceDraft(family.find((theme) => theme.packageId === payload.packageId)).draft,
					revision: active.revision + 1,
				};
			}
			return json({ active, revision: active.revision, previous: true, capabilities: { write: true } });
		});
		await h.window.showAppearanceEditor();
		await runAction(h, 'apply');
		expect(writes.map((payload) => payload.packageId)).toEqual([family[0].packageId]);
		expect(h.window.showConfirmDialog).toHaveBeenCalledTimes(1);
		expect(h.window.showConfirmDialog.mock.calls[0][0].i18n.message).toBe('appearanceAppTrust');
		await chooseVersion(h, 'app:pixel', family[1].packageId);
		h.window.showConfirmDialog.mockResolvedValue(false);
		await runAction(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledTimes(2);
		expect(h.window.showConfirmDialog.mock.calls[1][0].i18n.message).toBe('appearanceAppTrust');
		expect(writes.map((payload) => payload.packageId)).toEqual([family[0].packageId]);
		expect(active.packageId).toBe(family[0].packageId);
		expect(representative(h, 'app:pixel')).toBe(family[1].packageId);
		expect(appliedVersions(h, 'app:pixel')).toEqual([family[0].packageId]);
		await chooseVersion(h, 'app:pixel', family[0].packageId);
		await runAction(h, 'apply');
		expect(h.window.showConfirmDialog).toHaveBeenCalledTimes(2);
		expect(writes.map((payload) => payload.packageId)).toEqual([family[0].packageId, family[0].packageId]);
	});

	it.each(['apply', 'rollback', 'replayed receipt'])(
		'updates history to the accepted revision after %s even if the running window still identifies an old build',
		async (operation) => {
			const family = await versions('pixel');
			const h = harness({ theme: family[0] });
			let active = h.initial;
			const receipt = { ...createAppearanceDraft(family[1]).draft, revision: 2 };
			const accepted = {
				...createAppearanceDraft(operation === 'apply' ? family[1] : family[2]).draft,
				revision: operation === 'replayed receipt' ? 3 : 2,
			};
			h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
				if (url === '/api/themes') {
					return json({ themes: [] });
				}
				if (url === '/api/themes?format=app') {
					return json({ themes: family });
				}
				if (options.method === 'PUT' || url === '/api/appearance/rollback') {
					active = accepted;
					if (operation === 'replayed receipt') {
						return json({ active: receipt, revision: receipt.revision, previous: true, replayed: true });
					}
				}
				return json({ active, revision: active.revision, previous: true, capabilities: { write: true } });
			});
			await h.window.showAppearanceEditor();
			await chooseVersion(h, 'app:pixel', family[1].packageId);
			expect(appliedVersions(h, 'app:pixel')).toEqual([family[0].packageId]);
			h.window.authenticatedFetch.mockClear();
			await runAction(h, operation === 'rollback' ? 'rollback' : 'apply');
			const calls = h.window.authenticatedFetch.mock.calls;
			expect(calls.map(([url, options]) => [url, options?.method || 'GET'])).toEqual(
				operation === 'rollback'
					? [['/api/appearance/rollback', 'POST']]
					: operation === 'replayed receipt'
						? [
								['/api/appearance', 'PUT'],
								['/api/appearance', 'GET'],
							]
						: [['/api/appearance', 'PUT']],
			);
			expect(JSON.parse(calls[0][1].body)).toMatchObject({ expectedRevision: 1 });
			if (operation !== 'rollback') {
				expect(JSON.parse(calls[0][1].body).packageId).toBe(family[1].packageId);
			}
			expect(h.window.__2FA_APPEARANCE__).toEqual(accepted);
			expect(appliedVersions(h, 'app:pixel')).toEqual([accepted.packageId]);
			expect(representative(h, 'app:pixel')).toBe(accepted.packageId);
			expect(h.saved()).toBeUndefined();
			// The editor must keep its accepted server snapshot when an old runtime is still on the page.
			h.window.__2FA_APPEARANCE__ = h.initial;
			choosePanel(h, 'design');
			choosePanel(h, 'library');
			expect(appliedVersions(h, 'app:pixel')).toEqual([accepted.packageId]);
			await chooseVersion(h, 'app:pixel', family[3].packageId);
			expect(representative(h, 'app:pixel')).toBe(family[3].packageId);
			expect(appliedVersions(h, 'app:pixel')).toEqual([accepted.packageId]);
			await runAction(h, 'keep');
			expect(h.saved()).toMatchObject({ revision: accepted.revision, draft: { packageId: family[3].packageId } });
		},
	);

	it('imports another build into the existing group as the selected draft without applying it', async () => {
		const family = await versions('journal', 3);
		const h = harness({ theme: family[0] });
		let installed = family.slice(0, 2);
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes/import' && options.method === 'POST') {
				installed = family;
				return json({ theme: family[2] });
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
		expect(representative(h, 'app:journal')).toBe(family[0].packageId);
		h.document.getElementById('appearanceSource').value = 'https://example.com/journal.zip';
		await runAction(h, 'install');
		const imports = h.window.authenticatedFetch.mock.calls.filter(([url]) => url === '/api/themes/import');
		expect(imports).toHaveLength(1);
		expect(JSON.parse(imports[0][1].body)).toMatchObject({ url: 'https://example.com/journal.zip' });
		expect(h.document.querySelectorAll('.appearance-theme-group')).toHaveLength(1);
		expect(group(h, 'app:journal').querySelectorAll('.appearance-theme-card')).toHaveLength(1);
		expect(group(h, 'app:journal').querySelectorAll('.appearance-theme-version')).toHaveLength(3);
		expect(representative(h, 'app:journal')).toBe(family[2].packageId);
		const selected = group(h, 'app:journal').querySelector('.appearance-theme-version[aria-pressed="true"]');
		expect(selected.dataset.package).toBe(family[2].packageId);
		expect(appliedVersions(h, 'app:journal')).toEqual([family[0].packageId]);
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		await runAction(h, 'keep');
		expect(h.saved()).toMatchObject({ revision: 1, dirty: true, draft: { packageId: family[2].packageId } });
	});

	it.each(['export', 'delete'])(
		'targets the exact selected historical build on %s, not the previously represented or newest build',
		async (operation) => {
			const family = await versions('sketch');
			const h = harness({ theme: family[3] });
			let installed = [...family];
			const target = family[1].packageId;
			const path = '/api/themes/' + target + (operation === 'export' ? '/export' : '');
			const download = vi.spyOn(h.window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
			h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
				if (url === path) {
					if (operation === 'delete' && options.method === 'DELETE') {
						installed = installed.filter((theme) => theme.packageId !== target);
					}
					return operation === 'export' ? new Response('exact historical theme archive') : json({ deleted: true });
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
			expect(representative(h, 'app:sketch')).toBe(family[3].packageId);
			await chooseVersion(h, 'app:sketch', target);
			h.window.authenticatedFetch.mockClear();
			await runAction(h, operation);
			const targetCalls = h.window.authenticatedFetch.mock.calls.filter(([url]) => url.startsWith('/api/themes/'));
			expect(targetCalls).toHaveLength(1);
			expect(targetCalls[0][0]).toBe(path);
			expect(targetCalls[0][1]?.method || 'GET').toBe(operation === 'delete' ? 'DELETE' : 'GET');
			expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
			expect(appliedVersions(h, 'app:sketch')).toEqual([family[3].packageId]);
			if (operation === 'delete') {
				expect(h.window.showConfirmDialog.mock.calls.at(-1)[0].i18n.message).toBe('appearanceDeleteConfirm');
				expect(installed.map((theme) => theme.packageId)).toEqual([family[0].packageId, family[2].packageId, family[3].packageId]);
				expect(group(h, 'app:sketch').querySelector('.appearance-theme-version[data-package="' + target + '"]')).toBeNull();
				expect(representative(h, 'app:sketch')).toBe(family[3].packageId);
				expect(h.saved()).toBeUndefined();
			} else {
				expect(download).toHaveBeenCalledOnce();
				expect(download.mock.instances[0].download).toBe('2fa-theme.zip');
				URL.revokeObjectURL(download.mock.instances[0].href);
				expect(representative(h, 'app:sketch')).toBe(target);
				expect(group(h, 'app:sketch').querySelectorAll('.appearance-theme-version')).toHaveLength(4);
			}
		},
	);

	it('tracks the accepted server appearance separately from an unapplied local draft', async () => {
		const family = await versions('pixel');
		const draft = { ...createAppearanceDraft(family[0]).draft, revision: 1 };
		const h = harness({ theme: family[0], savedDraft: { draft, revision: 1, dirty: true } });
		const active = { ...createAppearanceDraft(family[2]).draft, revision: 2 };
		h.window.authenticatedFetch.mockImplementation(async (url) =>
			json(
				url === '/api/themes?format=app'
					? { themes: family }
					: url === '/api/themes'
						? { themes: [] }
						: { active, revision: 2, capabilities: { write: true } },
			),
		);
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:pixel')).toBe(family[0].packageId);
		const rows = [...group(h, 'app:pixel').querySelectorAll('.appearance-theme-version')];
		expect(rows.find((r) => r.dataset.package === family[2].packageId).textContent).toContain(LOCALES['zh-CN'].appearanceCurrent);
		expect(rows.find((r) => r.dataset.package === family[0].packageId).textContent).not.toContain(LOCALES['zh-CN'].appearanceCurrent);
	});

	it.each(['focus-changed', 'editor-hidden'])(
		'does not restore selection focus after %s while awaiting the version switch',
		async (scenario) => {
			const family = await versions('pixel');
			const h = harness({ theme: family[3] });
			library(h, family);
			await h.window.showAppearanceEditor();
			const details = await expand(h, 'app:pixel');
			const target = [...details.querySelectorAll('button')].find((b) => b.dataset.package === family[0].packageId);
			target.focus();
			target.click();
			const other = h.document.createElement('button');
			other.textContent = 'Other dialog';
			h.document.body.append(other);
			if (scenario === 'focus-changed') {
				other.focus();
			} else {
				h.window.hideModal('appearanceModal');
			}
			await flush();
			if (scenario === 'focus-changed') {
				expect(h.document.activeElement).toBe(other);
			} else {
				expect(h.document.getElementById('appearanceModal').contains(h.document.activeElement)).toBe(false);
			}
		},
	);

	it('renders twelve installed builds as three ordinary cards while retaining four exact versions in each collapsed history', async () => {
		const families = await Promise.all(['Pixel', 'Sketch', 'Journal'].map((name) => versions(name.toLowerCase())));
		const h = harness({ theme: families[0][3] });
		library(h, [getBuiltinTheme('fluent'), ...families.flat().reverse()]);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelectorAll('.appearance-installed-themes .appearance-theme-card')).toHaveLength(3);
		expect(h.document.querySelectorAll('.appearance-theme-version')).toHaveLength(12);
		for (const family of families) {
			const section = group(h, 'app:' + family[0].manifest.id);
			expect(section.querySelector('details').open).toBe(false);
			expect(new Set([...section.querySelectorAll('.appearance-theme-version')].map((row) => row.dataset.package))).toEqual(
				new Set(family.map((t) => t.packageId)),
			);
		}
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method)).toBe(false);
		expect(h.saved()).toBeUndefined();
	});

	it('keeps an applied old build as representative and retains its selected/applied status in history', async () => {
		const family = await versions('pixel');
		const h = harness({ theme: family[0] });
		library(h, [...family].reverse());
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:pixel')).toBe(family[0].packageId);
		const row = [...group(h, 'app:pixel').querySelectorAll('.appearance-theme-version')].find(
			(r) => r.dataset.package === family[0].packageId,
		);
		expect(row.getAttribute('aria-pressed')).toBe('true');
		expect(row.textContent).toContain(LOCALES['zh-CN'].appearanceCurrent);
		expect(row.textContent).toContain(family[0].packageId.slice(0, 12));
	});

	it('uses the saved inactive profile package and restores its settings instead of silently moving to the newest build', async () => {
		const family = await versions('journal');
		const snapshot = createAppearanceDraft(family[0]).draft;
		snapshot.settings.accent = '#ab1234';
		family.forEach((theme) => {
			theme.profile = snapshot;
		});
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [getBuiltinTheme('fluent'), ...family]);
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:journal')).toBe(family[0].packageId);
		group(h, 'app:journal').querySelector('.appearance-theme-card').click();
		await flush();
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ab1234');
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT' || options?.method === 'DELETE')).toBe(
			false,
		);
	});

	it('keeps a restored local version draft ahead of active and saved versions', async () => {
		const family = await versions('pixel');
		const draft = { ...createAppearanceDraft(family[1]).draft, revision: 1 };
		draft.settings.accent = '#fedcba';
		const h = harness({ theme: family[0], savedDraft: { draft, revision: 1, dirty: true, profiles: [] } });
		library(h, family);
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:pixel')).toBe(family[1].packageId);
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#fedcba');
	});

	it('uses a remembered inactive draft before a server profile and falls back when a saved package is missing', async () => {
		const family = await versions('journal');
		const saved = createAppearanceDraft(family[0]).draft;
		family.forEach((theme) => {
			theme.profile = saved;
		});
		const local = createAppearanceDraft(family[1]).draft;
		const official = getBuiltinTheme('fluent');
		const h = harness({
			theme: official,
			savedDraft: {
				draft: { ...createAppearanceDraft(official).draft, revision: 1 },
				revision: 1,
				dirty: false,
				profiles: [['app:journal', local]],
			},
		});
		library(h, [official, ...family]);
		await h.window.showAppearanceEditor();
		expect(representative(h, 'app:journal')).toBe(family[1].packageId);
		const missing = harness({ theme: official });
		library(missing, [official, ...family.slice(1)]);
		await missing.window.showAppearanceEditor();
		expect(representative(missing, 'app:journal')).toBe(family[3].packageId);
	});

	it('does not merge names, formats or malformed installation times and has deterministic tie ordering', async () => {
		const [one, two] = await versions('document', 2);
		one.installedAt = Number.NaN;
		two.installedAt = undefined;
		const legacy = { ...getBuiltinTheme('document'), packageId: 'f'.repeat(64), builtIn: false };
		const other = (await versions('different', 1))[0];
		other.manifest.name = one.manifest.name;
		const h = harness({ theme: getBuiltinTheme('fluent') });
		library(h, [other, two, legacy, one]);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelectorAll('.appearance-theme-group')).toHaveLength(3);
		expect(representative(h, 'app:document')).toBe([one.packageId, two.packageId].sort()[0]);
		expect(group(h, 'app:document').textContent).toContain(LOCALES['zh-CN'].appearanceVersionInstalledUnknown);
		expect(representative(h, 'v1:document')).toBe(legacy.packageId);
	});

	it('history toggling is UI-only, survives rerenders, and a selected version retains keyboard focus after controls re-enable', async () => {
		const family = await versions('pixel');
		const h = harness({ theme: family[3] });
		library(h, family);
		await h.window.showAppearanceEditor();
		await expand(h, 'app:pixel');
		choosePanel(h, 'design');
		choosePanel(h, 'library');
		expect(group(h, 'app:pixel').querySelector('details').open).toBe(true);
		expect(h.saved()).toBeUndefined();
		group(h, 'app:pixel').querySelector('details').open = false;
		choosePanel(h, 'design');
		choosePanel(h, 'library');
		expect(group(h, 'app:pixel').querySelector('details').open).toBe(false);
		await chooseVersion(h, 'app:pixel', family[1].packageId, { focus: true });
		expect(h.document.activeElement.className).toBe('appearance-theme-version');
		expect(h.document.activeElement.dataset.package).toBe(family[1].packageId);
		expect(h.document.activeElement.disabled).toBe(false);
		expect(group(h, 'app:pixel').querySelector('details').open).toBe(true);
		expect(representative(h, 'app:pixel')).toBe(family[1].packageId);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
	});

	it('chooses exact historical package, preserves A to B to A settings, and still asks trust for an unapplied package', async () => {
		const a = await versions('pixel');
		const b = await versions('journal');
		const h = harness({ theme: a[3] });
		library(h, [...a, ...b]);
		await h.window.showAppearanceEditor();
		await chooseVersion(h, 'app:pixel', a[1].packageId);
		choosePanel(h, 'design');
		const color = h.document.querySelector('[data-theme-setting=accent]');
		color.value = '#ff0000';
		color.dispatchEvent(new h.window.Event('input'));
		choosePanel(h, 'library');
		group(h, 'app:journal').querySelector('.appearance-theme-card').click();
		await flush();
		await chooseVersion(h, 'app:pixel', a[1].packageId);
		choosePanel(h, 'design');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ff0000');
		h.window.showConfirmDialog = vi.fn(async () => false);
		h.document.querySelector('[data-appearance-action=apply]').click();
		await flush();
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceAppTrust' }) }),
		);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
		h.document.querySelector('[data-appearance-action=keep]').click();
		await flush();
		expect(h.saved().draft.packageId).toBe(a[1].packageId);
		expect(h.saved().draft.settings.accent).toBe('#ff0000');
	});
});
