import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import {
	harness,
	flush,
	tickPreview,
	json,
	control,
	act,
	themeCard,
	chooseTheme,
	editSetting,
	status,
	methods,
	putBodies,
} from '../helpers/appearance-editor.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { appearanceErrorKey, localizeAppearanceError } from '../../src/ui/scripts/appearanceMessages.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { validateAppearance } from '../../src/themes/schema.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const zh = LOCALES['zh-CN'];
const appearanceInput = (draft) => Object.fromEntries(['packageId', 'themeId', 'settings'].map((key) => [key, draft[key]]));
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
};
const published = (h, revision = 2, accent = '#123456') => ({
	revision,
	active: { ...h.initial, revision, settings: { ...h.initial.settings, accent } },
});
const editAccent = (h, value = '#ff0000') => editSetting(h, 'accent', value);

describe('appearance editor draft migration', () => {
	it('restores the selected theme profile and keeps no brand, layout overrides or custom CSS', () => {
		const theme = getBuiltinTheme('document');
		theme.profile = { ...createAppearanceDraft(theme).draft, settings: { accent: '#123456', radius: '24px' } };
		const result = createAppearanceDraft(theme, { themeId: 'compact', settings: { accent: '#abcdef' } });
		expect(result.draft.settings.accent).toBe('#123456');
		expect(result.draft.layout).toEqual(theme.manifest.layout);
		for (const field of ['branding', 'customCss', 'assets']) {
			expect(result.draft).not.toHaveProperty(field);
		}
		expect(
			createAppearanceDraft(theme, { themeId: 'document', manifest: theme.manifest, settings: { accent: '#00ff00' } }).draft.settings
				.accent,
		).toBe('#00ff00');
	});

	it('checks narrowed numeric ranges and color types, and explicitly resets saved profiles', () => {
		const size = { key: 'size', type: 'number', label: 'Size', default: 14, min: 12, max: 30 };
		const older = getBuiltinTheme('fluent');
		older.manifest.settings.push(size);
		const theme = getBuiltinTheme('fluent');
		theme.manifest.settings.push({ ...size, max: 20 });
		const previous = createAppearanceDraft(older).draft;
		previous.settings.size = 28;
		previous.settings.accent = 'not-a-color';
		const migrated = createAppearanceDraft(theme, previous);
		expect(migrated.draft.settings.accent).toBe('#0078d4');
		expect(migrated.draft.settings.size).toBe(14);
		expect(migrated.changes.map((item) => item.key)).toEqual(expect.arrayContaining(['size', 'accent']));
		expect(() => validateAppearance(appearanceInput(migrated.draft), theme.manifest)).not.toThrow();
		theme.profile = { ...previous, settings: { accent: '#abcdef' } };
		expect(createAppearanceDraft(theme, {}).draft.settings.accent).toBe('#abcdef');
		expect(createAppearanceDraft(theme, {}, { reset: true }).draft.settings.accent).toBe('#0078d4');
		expect(createAppearanceDraft(theme, {}, { reset: true }).changes).toEqual([]);
	});

	it('creates app drafts without v1 css, layout or content fields', () => {
		const theme = { ...getBuiltinTheme('document'), kind: 'app', packageId: 'f'.repeat(64) };
		theme.manifest = { ...theme.manifest, kind: 'app' };
		const { draft } = createAppearanceDraft(theme, { themeId: 'document', settings: { accent: '#111111' } });
		expect(draft.kind).toBe('app');
		for (const field of ['css', 'layout', 'content']) {
			expect(draft).not.toHaveProperty(field);
		}
		// A v1 draft with the same id is another profile, so its values are not carried over.
		expect(draft.settings.accent).not.toBe('#111111');
	});
});

describe('appearance errors', () => {
	it('covers protocol and storage codes and distinguishes conflict from protected versions', () => {
		const sources = [
			...fs
				.readdirSync('src/themes')
				.filter((name) => name.endsWith('.js'))
				.map((name) => path.join('src/themes', name)),
			'src/storage/theme-store.js',
		];
		for (const source of sources) {
			for (const [, code] of fs.readFileSync(source, 'utf8').matchAll(/['"](THEME_[A-Z_]+)['"]/g)) {
				if (code !== 'THEME_ERROR') {
					expect(appearanceErrorKey({ error: code }), code).not.toBe('appearanceErrorUnavailable');
				}
			}
		}
		expect(appearanceErrorKey({ error: 'THEME_IN_USE' }, 409)).toBe('appearanceErrorInUse');
		expect(appearanceErrorKey({ error: 'THEME_REVISION_CONFLICT' }, 409)).toBe('appearanceConflict');
		expect(appearanceErrorKey({ error: '需要配置主题存储' }, 503)).toBe('appearanceNoBinding');
	});

	it('does not display raw server messages or executable markup in diagnostics', () => {
		const result = localizeAppearanceError(
			{
				error: 'THEME_INVALID_CSS',
				message: '<script>server message</script>',
				details: { line: 4, column: 2, field: '<b>radius</b>', path: 'https://secret.example/private' },
			},
			(key) => LOCALES.en[key],
		);
		expect(result).toContain('4:2');
		expect(result).not.toMatch(/<|https:|server message/);
	});
});

describe('appearance editor controls', () => {
	it('keeps serialized migration and error helpers working in minified bundles', async () => {
		const built = await build({
			entryPoints: ['src/ui/scripts/appearanceEditor.js'],
			bundle: true,
			minify: true,
			write: false,
			format: 'esm',
			platform: 'node',
		});
		const module = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
		const theme = { ...getBuiltinTheme('document'), packageId: 'f'.repeat(64) };
		const h = harness({ theme, code: module.getAppearanceEditorCode(), error: { error: 'THEME_IN_USE' } });
		await h.window.showAppearanceEditor();
		editAccent(h);
		expect(control(h, 'apply').disabled).toBe(false);
		await act(h, 'delete');
		expect(status(h).textContent).toContain(zh.appearanceErrorInUse);
		expect(status(h).dataset.error).toBe('true');
	});

	it('renders one panel with library, catalog and localized settings and none of the removed tools', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		const panel = h.document.getElementById('appearancePanel');
		expect(panel.textContent).toContain(zh.appearanceLibrary);
		expect(panel.textContent).toContain(zh.appearanceCommunityThemes);
		expect(panel.textContent).toContain(zh.appearanceThemeSettings);
		expect(panel.textContent).toContain(zh.appearanceFont);
		expect(panel.textContent).toContain(zh.appearanceDensity);
		expect(panel.textContent).not.toContain('Accent color');
		expect(h.document.querySelector('[data-theme-setting=accent]').type).toBe('color');
		expect(h.document.querySelector('[data-theme-setting=radius]').tagName).toBe('SELECT');
		for (const removed of [
			'[data-panel]',
			'.appearance-tab',
			'#appearanceSource',
			'input[type=file]:not(#appearanceImportFile)',
			'[data-appearance-action=install]',
			'[data-appearance-action=export]',
			'[data-appearance-action=import]',
			'[data-appearance-action=keep]',
			'[data-appearance-action=discard]',
			'[data-appearance-action=rollback]',
			'#appearanceModal textarea',
		]) {
			expect(h.document.querySelector(removed), removed).toBeNull();
		}
		expect([...h.document.querySelectorAll('.appearance-footer-actions button')].map((button) => button.dataset.appearanceAction)).toEqual([
			'close',
			'apply',
		]);
		const theme = getBuiltinTheme('fluent');
		theme.packageId = 'external';
		theme.manifest.settings[0].translations = { 'zh-CN': { label: '作者配色', description: '作者说明' } };
		const custom = harness({ theme });
		await custom.window.showAppearanceEditor();
		expect(custom.document.getElementById('appearancePanel').textContent).toContain('作者配色');
		expect(custom.document.getElementById('appearancePanel').textContent).toContain('作者说明');
	});

	it('links the theme guide from the library heading, also without write access', async () => {
		for (const write of [true, false]) {
			const h = harness({ write });
			await h.window.showAppearanceEditor();
			const guide = h.document.querySelector('#appearancePanel .appearance-section-head a.appearance-guide');
			expect(guide?.textContent).toBe(zh.appearanceMakeTheme);
			expect(guide.href).toBe('https://github.com/wuzf/2fa/blob/main/docs/THEMES.md');
			expect(guide.target).toBe('_blank');
			expect(guide.rel).toBe('noopener noreferrer');
			expect(guide.closest('.appearance-section').textContent).toContain(zh.appearanceLibrary);
		}
	});

	it('renders boolean, text, textarea and number settings and stores typed values', async () => {
		const theme = getBuiltinTheme('document');
		theme.packageId = 'f'.repeat(64);
		theme.manifest.settings = [
			{ key: 'flag', label: 'Flag', type: 'boolean', default: false },
			{ key: 'title', label: 'Title', type: 'text', default: 'Hello' },
			{ key: 'notes', label: 'Notes', type: 'textarea', default: '' },
			{ key: 'size', label: 'Size', type: 'number', default: 14, min: 10, max: 20, step: 1 },
		];
		const h = harness({ theme });
		await h.window.showAppearanceEditor();
		const size = h.document.querySelector('[data-theme-setting=size]');
		expect([size.min, size.max, size.step]).toEqual(['10', '20', '1']);
		expect(h.document.querySelector('[data-theme-setting=notes]').tagName).toBe('TEXTAREA');
		expect(h.document.querySelector('[data-theme-setting=title]').value).toBe('Hello');
		editSetting(h, 'flag', 'true');
		editSetting(h, 'title', 'Changed');
		editSetting(h, 'notes', 'Line');
		editSetting(h, 'size', '18');
		await act(h, 'apply');
		expect(putBodies(h)[0].settings).toEqual({ flag: true, title: 'Changed', notes: 'Line', size: 18 });
	});

	it('keeps apply disabled until the draft changes and while there is no binding', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		expect(status(h).hidden).toBe(true);
		expect(control(h, 'apply').disabled).toBe(true);
		editAccent(h);
		expect(control(h, 'apply').disabled).toBe(false);
		const unbound = harness({ write: false });
		await unbound.window.showAppearanceEditor();
		expect(status(unbound).textContent).toBe(zh.appearanceNoBinding);
		editAccent(unbound);
		expect(control(unbound, 'apply').disabled).toBe(true);
		expect(themeCard(unbound, 'builtin:document').disabled).toBe(false);
	});

	it('resets settings to the theme defaults', async () => {
		const h = harness();
		h.initial.settings.accent = '#123456';
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#123456');
		await act(h, 'reset');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe(getBuiltinTheme('document').manifest.settings[0].default);
		expect(control(h, 'apply').disabled).toBe(false);
	});

	it('toggles the segmented width and mode controls with aria-pressed', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		const pressed = (name) =>
			[...h.document.querySelectorAll('[data-appearance-action="' + name + '"]')]
				.filter((button) => button.getAttribute('aria-pressed') === 'true')
				.map((button) => button.dataset.value);
		expect(pressed('width')).toEqual(['1440']);
		expect(pressed('mode')).toEqual(['light']);
		expect(control(h, 'width', 1440).closest('[role=group]')).not.toBeNull();
		await act(h, 'width', 390);
		await act(h, 'mode', 'dark');
		expect(pressed('width')).toEqual(['390']);
		expect(pressed('mode')).toEqual(['dark']);
		expect(control(h, 'apply').disabled).toBe(true);
	});

	it('previews an offline scene from immutable cached resources and sends translated labels', async () => {
		const h = harness({ online: false });
		const hash = 'c'.repeat(64);
		h.initial.resources = [{ hash, name: 'font.woff2', mime: 'font/woff2', url: '/theme-assets/' + hash + '/font.woff2' }];
		const match = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
		Object.defineProperty(h.window, 'caches', { value: { match } });
		await h.window.showAppearanceEditor();
		expect(status(h).textContent).toBe(zh.appearanceOffline);
		const frame = h.document.getElementById('appearancePreview');
		frame.contentWindow.postMessage = vi.fn();
		frame.onload();
		await act(h, 'mode', 'dark');
		const scenes = h.document.getElementById('appearanceScene');
		scenes.value = 'offline';
		scenes.dispatchEvent(new h.window.Event('change'));
		await tickPreview();
		const message = frame.contentWindow.postMessage.mock.calls.at(-1)[0];
		expect(message).toMatchObject({ type: 'appearance-preview', scene: 'offline', mode: 'dark', language: 'zh-CN' });
		expect(message.labels.cardMenuEdit).toBe(zh.cardMenuEdit);
		expect(message.resources[0].hash).toBe(hash);
		expect(match).toHaveBeenCalledWith('https://example.com/theme-assets/' + hash + '/font.woff2');
		expect(h.window.authenticatedFetch).not.toHaveBeenCalled();
		expect(frame.style.width).toBe('1440px');
		await act(h, 'width', 390);
		await tickPreview();
		expect(frame.style.width).toBe('390px');
	});
});

describe('appearance publication', () => {
	it('shows saving synchronously and adopts a complete PUT response without a follow-up GET', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editAccent(h, '#123456');
		const pending = deferred();
		h.window.authenticatedFetch.mockReset().mockReturnValue(pending.promise);
		h.window.applyAppearance = vi.fn();
		control(h, 'apply').click();
		expect(status(h).textContent).toBe(zh.appearanceSaving);
		expect(status(h).getAttribute('aria-live')).toBe('polite');
		expect(control(h, 'apply').disabled).toBe(true);
		control(h, 'apply').click();
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledTimes(1);
		const body = putBodies(h)[0];
		expect(Object.keys(body).sort()).toEqual(['expectedRevision', 'operationId', 'packageId', 'settings']);
		expect(body).toMatchObject({ expectedRevision: 1, packageId: 'builtin:document', settings: { accent: '#123456' } });
		pending.resolve(json(published(h, 2, '#123456')));
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledTimes(1);
		expect(h.window.__2FA_APPEARANCE__).toEqual(published(h, 2, '#123456').active);
		expect(h.window.applyAppearance).toHaveBeenCalledWith(published(h, 2, '#123456').active);
		expect(status(h).textContent).toBe(zh.appearanceApplied);
		expect(control(h, 'apply').disabled).toBe(true);
		await h.window.requestAppearanceClose();
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
	});

	it('keeps edits after a publication out of the running appearance snapshot', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editAccent(h, '#111111');
		h.window.authenticatedFetch.mockReset().mockResolvedValue(json(published(h, 2, '#111111')));
		control(h, 'apply').click();
		await flush();
		editAccent(h, '#222222');
		expect(h.window.__2FA_APPEARANCE__.settings.accent).toBe('#111111');
		await h.window.requestAppearanceClose();
		await flush();
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('[data-theme-setting="accent"]').value).toBe('#111111');
	});

	it.each(['invalid-json', 'missing-active', 'mismatched-revision', 'replayed receipt'])(
		'reads current appearance when the PUT response is %s',
		async (reason) => {
			const h = harness();
			await h.window.showAppearanceEditor();
			editAccent(h);
			const data = published(h);
			if (reason === 'missing-active') {
				delete data.active;
			}
			if (reason === 'mismatched-revision') {
				data.active.revision = 1;
			}
			if (reason === 'replayed receipt') {
				data.replayed = true;
			}
			h.window.authenticatedFetch
				.mockReset()
				.mockImplementation(async (_url, options = {}) =>
					options.method === 'PUT' ? (reason === 'invalid-json' ? new Response('{') : json(data)) : json(published(h, 3)),
				);
			await act(h, 'apply');
			expect(methods(h)).toEqual(['PUT', 'GET']);
			expect(h.window.__2FA_APPEARANCE__.revision).toBe(3);
			expect(status(h).textContent).toBe(zh.appearanceApplied);
		},
	);

	it('keeps the draft after a lost response and retries against the same baseline', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editAccent(h, '#abcdef');
		let writes = 0;
		h.window.authenticatedFetch.mockReset().mockImplementation(async (_url, options = {}) => {
			if (options.method === 'PUT') {
				if (++writes === 1) {
					throw new Error('response lost after commit');
				}
				return json({ ...published(h, 2, '#abcdef'), replayed: true });
			}
			return json(published(h, 2, '#abcdef'));
		});
		await act(h, 'apply');
		expect(status(h).dataset.error).toBe('true');
		expect(status(h).textContent).toContain('response lost after commit');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#abcdef');
		expect(control(h, 'apply').disabled).toBe(false);
		await act(h, 'apply');
		expect(methods(h)).toEqual(['PUT', 'PUT', 'GET']);
		expect(putBodies(h).map((body) => body.expectedRevision)).toEqual([1, 1]);
		expect(h.window.__2FA_APPEARANCE__.settings.accent).toBe('#abcdef');
	});

	it('reports a revision conflict and reloads the server state only after confirming discard', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editAccent(h, '#abcdef');
		const remote = published(h, 4, '#00ff00');
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (options.method === 'PUT') {
				return json({ error: 'THEME_REVISION_CONFLICT' }, 409);
			}
			if (url === '/api/appearance') {
				return json({ ...remote, capabilities: { write: true } });
			}
			return json({ themes: url === '/api/themes' ? [getBuiltinTheme('document')] : [] });
		});
		await act(h, 'apply');
		expect(status(h).textContent).toContain(zh.appearanceConflict);
		expect(control(h, 'reload')).not.toBeNull();
		h.window.showConfirmDialog.mockResolvedValueOnce(false);
		await act(h, 'reload');
		expect(h.window.showConfirmDialog).toHaveBeenLastCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceDiscardChanges' }) }),
		);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#abcdef');
		await act(h, 'reload');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#00ff00');
		expect(control(h, 'apply').disabled).toBe(true);
		editAccent(h, '#111111');
		h.window.authenticatedFetch.mockClear();
		h.window.authenticatedFetch.mockImplementation(async () => json(published(h, 5, '#111111')));
		await act(h, 'apply');
		expect(putBodies(h)[0].expectedRevision).toBe(4);
	});

	it('rejects a response older than a remote revision that arrived while PUT was pending', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editAccent(h);
		const pending = deferred();
		h.window.authenticatedFetch.mockReset().mockReturnValue(pending.promise);
		h.window.applyAppearance = vi.fn();
		control(h, 'apply').click();
		await flush();
		h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 3 } }));
		pending.resolve(json(published(h, 2)));
		await flush();
		expect(h.window.__2FA_APPEARANCE__).toBe(h.initial);
		expect(h.window.applyAppearance).not.toHaveBeenCalled();
		expect(status(h).textContent).toContain(zh.appearanceConflict);
		expect(control(h, 'reload')).not.toBeNull();
	});

	it('takes the current server snapshot when a clean editor opens on an older page', async () => {
		const h = harness();
		const remote = published(h, 2, '#00ff00');
		h.window.authenticatedFetch.mockImplementation(async (url) =>
			json(url === '/api/themes' ? { themes: [getBuiltinTheme('document')] } : { ...remote, themes: [], capabilities: { write: true } }),
		);
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#00ff00');
		editAccent(h, '#111111');
		await act(h, 'apply');
		expect(putBodies(h)[0].expectedRevision).toBe(2);
	});
});

describe('appearance editor lifecycle', () => {
	it('asks before closing with unapplied changes and closes a clean editor directly', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		expect(h.window.hasAppearancePendingChanges()).toBe(true);
		await act(h, 'close');
		expect(h.window.showConfirmDialog).not.toHaveBeenCalled();
		expect(h.document.getElementById('appearanceModal').style.display).toBe('none');
		expect(h.window.hasAppearancePendingChanges()).toBe(false);
		await h.window.showAppearanceEditor();
		editAccent(h, '#abcdef');
		h.window.showConfirmDialog.mockResolvedValueOnce(false);
		await act(h, 'close');
		expect(h.window.showConfirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ i18n: expect.objectContaining({ message: 'appearanceDiscardChanges' }) }),
		);
		expect(h.document.getElementById('appearanceModal').style.display).toBe('block');
		const event = new h.window.Event('beforeunload', { cancelable: true });
		h.window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		await h.window.requestAppearanceClose();
		expect(h.document.getElementById('appearanceModal').style.display).toBe('none');
		await h.window.showAppearanceEditor();
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe(h.initial.settings.accent);
		expect(h.window.authenticatedFetch.mock.calls.some(([, options]) => options?.method)).toBe(false);
	});

	it('refreshes write capabilities after reconnecting without rebasing an offline draft', async () => {
		const h = harness({ online: false });
		await h.window.showAppearanceEditor();
		editAccent(h, '#abcdef');
		expect(control(h, 'apply').disabled).toBe(true);
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes') {
				return json({ themes: [getBuiltinTheme('document')] });
			}
			if (options.method === 'PUT') {
				return json({ error: 'THEME_REVISION_CONFLICT' }, 409);
			}
			return json({ revision: 2, themes: [], active: { ...h.initial, revision: 2 }, capabilities: { write: true } });
		});
		h.network.onLine = true;
		h.window.dispatchEvent(new h.window.Event('online'));
		await flush();
		expect(control(h, 'apply').disabled).toBe(false);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#abcdef');
		expect(status(h).textContent).toContain(zh.appearanceConflict);
		await act(h, 'apply');
		expect(putBodies(h)[0].expectedRevision).toBe(1);
		h.network.onLine = false;
		h.window.dispatchEvent(new h.window.Event('offline'));
		expect(control(h, 'apply').disabled).toBe(true);
		expect(status(h).textContent).toContain(zh.appearanceOffline);
		expect(control(h, 'reload')).not.toBeNull();
	});

	it('remembers each theme profile through A to B to A within the session', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const themes = [getBuiltinTheme('fluent'), getBuiltinTheme('compact')];
		h.window.authenticatedFetch.mockImplementation(async (url) =>
			json(url === '/api/themes' ? { themes } : { themes: [], revision: 1, active: h.initial, capabilities: { write: true } }),
		);
		// The applied compact preset stays listed while another theme is selected.
		Object.assign(h.initial, createAppearanceDraft(themes[1]).draft);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, 'builtin:fluent');
		editAccent(h, '#ff0000');
		await chooseTheme(h, 'builtin:compact');
		expect(themeCard(h, 'builtin:compact').getAttribute('aria-pressed')).toBe('true');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).not.toBe('#ff0000');
		editAccent(h, '#00ff00');
		await chooseTheme(h, 'builtin:fluent');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#ff0000');
		await chooseTheme(h, 'builtin:compact');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#00ff00');
	});
});
