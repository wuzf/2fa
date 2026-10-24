import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { harness, flush } from '../helpers/appearance-editor.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { appearanceErrorKey, localizeAppearanceError } from '../../src/ui/scripts/appearanceMessages.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { validateAppearance } from '../../src/themes/schema.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { normalizeAsset } from '../../src/themes/resources.js';

const appearanceInput = (draft) =>
	Object.fromEntries(['packageId', 'themeId', 'settings', 'layout', 'content', 'branding', 'customCss'].map((key) => [key, draft[key]]));

describe('appearance editor draft migration', () => {
	it('restores the selected theme profile while retaining the current instance brand', () => {
		const theme = getBuiltinTheme('document');
		theme.profile = {
			...createAppearanceDraft(theme).draft,
			settings: { accent: '#123456', radius: '24px' },
			customCss: 'body{color:red}',
			branding: { name: 'Older brand' },
		};
		theme.profile.layout.trailing = [];
		theme.profile.content = {};
		const result = createAppearanceDraft(theme, { themeId: 'compact', branding: { name: 'Current brand' } });
		expect(result.draft.settings.accent).toBe('#123456');
		expect(result.draft.layout.trailing).toEqual([]);
		expect(result.draft.content).toEqual({});
		expect(result.draft.customCss).toBe('body{color:red}');
		expect(result.draft.branding.name).toBe('Current brand');
	});

	it('checks narrowed numeric ranges and color types, and explicitly resets saved profiles', () => {
		const theme = getBuiltinTheme('fluent');
		const previous = createAppearanceDraft(theme).draft;
		previous.settings.fontSize = 999;
		previous.settings.accent = 'not-a-color';
		const migrated = createAppearanceDraft(theme, previous);
		expect(migrated.draft.settings.accent).toBe('#0078d4');
		expect(migrated.changes.map((item) => item.key)).toEqual(expect.arrayContaining(['fontSize', 'accent']));
		expect(() => validateAppearance(appearanceInput(migrated.draft), theme.manifest)).not.toThrow();
		theme.profile = { ...previous, settings: { accent: '#abcdef' }, customCss: 'body{display:none}' };
		expect(createAppearanceDraft(theme, { branding: { name: 'Keep me' } }, { reset: true }).draft).toMatchObject({
			customCss: '',
			branding: { name: 'Keep me' },
			settings: { accent: '#0078d4' },
		});
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
		const { window, document } = harness({ code: module.getAppearanceEditorCode(), error: { error: 'THEME_IN_USE' } });
		await window.showAppearanceEditor();
		document.querySelector('[data-appearance-action="select"]').click();
		document.querySelector('[data-appearance-action="delete"]').click();
		await flush();
		expect(document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearanceErrorInUse);
	});
	it('localizes built-in fields and renders resource upload plus authored descriptions', async () => {
		const builtIn = harness();
		await builtIn.window.showAppearanceEditor();
		builtIn.document.querySelector('[data-panel="design"]').click();
		expect(builtIn.document.getElementById('appearancePanel').textContent).toContain('验证码字体');
		expect(builtIn.document.getElementById('appearancePanel').textContent).not.toContain('Accent color');
		expect(builtIn.document.querySelector('input[type="file"]').accept).toContain('.woff2');
		const theme = getBuiltinTheme('fluent');
		theme.packageId = 'external';
		theme.manifest.settings[0].translations = { 'zh-CN': { label: '作者配色', description: '作者说明' } };
		const custom = harness({ theme });
		await custom.window.showAppearanceEditor();
		custom.document.querySelector('[data-panel="design"]').click();
		expect(custom.document.getElementById('appearancePanel').textContent).toContain('作者配色');
		expect(custom.document.getElementById('appearancePanel').textContent).toContain('作者说明');
	});

	it('keeps server writes disabled without a binding while local resource uploads remain available', async () => {
		const { window, document } = harness({ write: false });
		await window.showAppearanceEditor();
		expect(document.querySelector('[data-appearance-action="apply"]').disabled).toBe(true);
		expect(document.querySelector('[data-appearance-action="install"]').disabled).toBe(true);
		document.querySelector('[data-panel="design"]').click();
		expect(document.querySelector('input[type="file"]').disabled).toBe(false);
	});

	it('deletes repeated component content and persists the actions mode without breaking schema', async () => {
		const { window, document, saved } = harness();
		await window.showAppearanceEditor();
		document.querySelector('[data-panel="design"]').click();
		document.querySelector('.appearance-advanced-settings').open = true;
		document.querySelector('.appearance-layout-settings').open = true;
		const actions = [...document.querySelectorAll('.appearance-layout-item')].find(
			(row) => row.querySelector('strong').textContent === '操作',
		);
		const mode = actions.querySelector('select[aria-label="操作"]');
		mode.value = 'floating';
		mode.dispatchEvent(new window.Event('change'));
		const text = [...document.querySelectorAll('.appearance-layout-item')].find(
			(row) => row.querySelector('strong').textContent === '文字',
		);
		[...text.querySelectorAll('button')].find((button) => button.textContent === LOCALES['zh-CN'].delete).click();
		document.querySelector('[data-appearance-action="keep"]').click();
		await flush();
		expect(saved().draft.content.welcome).toBeUndefined();
		expect(saved().draft.layout.header.find((item) => item.type === 'actions').mode).toBe('floating');
		expect(() => validateAppearance(appearanceInput(saved().draft), saved().draft.manifest)).not.toThrow();
	});

	it('shows the correct translated reason for a protected version instead of a revision conflict', async () => {
		const { window, document } = harness({ error: { error: 'THEME_IN_USE', message: '原始服务器文本' } });
		await window.showAppearanceEditor();
		document.querySelector('[data-appearance-action="delete"]').click();
		await flush();
		expect(document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearanceErrorInUse);
		expect(document.getElementById('appearanceStatus').textContent).not.toContain('原始服务器文本');
	});

	it('keeps restored personal resources as local blobs so a saved draft survives server cleanup', async () => {
		const { window, document, initial, saved } = harness();
		await window.showAppearanceEditor();
		const hash = 'b'.repeat(64);
		const resource = { hash, name: 'logo.png', mime: 'image/png', url: '/theme-assets/' + hash + '/logo.png' };
		const theme = getBuiltinTheme('document');
		const appearance = { ...initial, branding: { logo: resource.url }, resources: [resource] };
		window.authenticatedFetch.mockImplementation(async (url) => {
			if (url === '/api/appearance/restore-inspect') {
				return new Response(JSON.stringify({ theme, appearance }));
			}
			if (url === '/api/themes') {
				return new Response(JSON.stringify({ themes: [theme] }));
			}
			if (url.startsWith('/api/appearance/assets/')) {
				return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
			}
			return new Response(JSON.stringify({ active: initial, revision: 1, capabilities: { write: true } }));
		});
		const file = document.querySelectorAll('input[type="file"]')[1];
		Object.defineProperty(file, 'files', { value: [new window.File(['example'], 'appearance.zip')] });
		file.dispatchEvent(new window.Event('change'));
		await flush();
		expect(document.getElementById('appearanceStatus').textContent).toBe(LOCALES['zh-CN'].appearanceInstalled);
		document.querySelector('[data-appearance-action="keep"]').click();
		await flush();
		expect(saved().draft.branding.logo).toMatch(/^local:/);
		expect(saved().blobs).toHaveLength(1);
		expect([...new Uint8Array(await saved().blobs[0][1].blob.arrayBuffer())]).toEqual([1, 2, 3]);
	});

	it('previews an offline scene from immutable cached resources and sends translated labels', async () => {
		const { window, document, initial } = harness({ online: false });
		const hash = 'c'.repeat(64);
		initial.resources = [{ hash, name: 'font.woff2', mime: 'font/woff2', url: '/theme-assets/' + hash + '/font.woff2' }];
		const match = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
		Object.defineProperty(window, 'caches', { value: { match } });
		await window.showAppearanceEditor();
		const frame = document.getElementById('appearancePreview');
		frame.contentWindow.postMessage = vi.fn();
		frame.onload();
		const scenes = document.getElementById('appearanceScene');
		scenes.value = 'offline';
		scenes.dispatchEvent(new window.Event('change'));
		await new Promise((resolve) => setTimeout(resolve, 180));
		const message = frame.contentWindow.postMessage.mock.calls.at(-1)[0];
		expect(message.scene).toBe('offline');
		expect(message.labels.cardMenuEdit).toBe(LOCALES['zh-CN'].cardMenuEdit);
		expect(message.labels.appearanceWelcomeTitle).toBe(LOCALES['zh-CN'].appearanceWelcomeTitle);
		expect(message.resources[0].hash).toBe(hash);
		expect(match).toHaveBeenCalledWith('https://example.com/theme-assets/' + hash + '/font.woff2');
		expect(window.authenticatedFetch).not.toHaveBeenCalled();
	});
});

describe('appearance publication feedback and response adoption', () => {
	const json = (value) => new Response(JSON.stringify(value));
	const applyButton = (h) => h.document.querySelector('[data-appearance-action="apply"]');
	const status = (h) => h.document.getElementById('appearanceStatus');
	function edit(h, value = 'local brand') {
		h.document.querySelector('[data-panel="brand"]').click();
		const input = h.document.querySelector('#appearancePanel input[type="text"]');
		input.value = value;
		input.dispatchEvent(new h.window.Event('input'));
	}
	const published = (h, revision = 2) => ({
		revision,
		previous: true,
		active: { ...h.initial, revision, branding: { name: 'published ' + revision } },
	});
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((done, fail) => {
			resolve = done;
			reject = fail;
		});
		return { promise, resolve, reject };
	};

	it('shows saving synchronously and adopts a complete PUT response without a follow-up GET', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		edit(h);
		const pending = deferred();
		h.window.authenticatedFetch.mockReset().mockReturnValue(pending.promise);
		h.window.applyAppearance = vi.fn();
		applyButton(h).click();
		expect(status(h).textContent).toBe(LOCALES['zh-CN'].appearanceSaving);
		expect(status(h).getAttribute('aria-live')).toBe('polite');
		expect(applyButton(h).textContent).toBe(LOCALES['zh-CN'].appearanceSaving);
		expect(applyButton(h).disabled).toBe(true);
		applyButton(h).click();
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledTimes(1);
		pending.resolve(json(published(h)));
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledTimes(1);
		expect(h.window.__2FA_APPEARANCE__).toEqual(published(h).active);
		expect(h.window.applyAppearance).toHaveBeenCalledWith(published(h).active);
		expect(h.saved()).toBeUndefined();
		expect(status(h).textContent).toBe(LOCALES['zh-CN'].appearanceApplied);
		expect(applyButton(h).textContent).toBe(LOCALES['zh-CN'].appearanceApply);
		expect(applyButton(h).disabled).toBe(false);
	});

	it.each(['invalid-json', 'missing-active', 'missing-previous', 'mismatched-revision'])(
		'reads current appearance when the PUT response is %s',
		async (reason) => {
			const h = harness();
			await h.window.showAppearanceEditor();
			edit(h);
			const data = published(h);
			if (reason === 'missing-active') {
				delete data.active;
			}
			if (reason === 'missing-previous') {
				delete data.previous;
			}
			if (reason === 'mismatched-revision') {
				data.active.revision = 1;
			}
			h.window.authenticatedFetch
				.mockReset()
				.mockImplementation(async (_url, options = {}) =>
					options.method === 'PUT' ? (reason === 'invalid-json' ? new Response('{') : json(data)) : json(published(h, 3)),
				);
			applyButton(h).click();
			await flush();
			expect(h.window.authenticatedFetch.mock.calls.map(([, options]) => options?.method || 'GET')).toEqual(['PUT', 'GET']);
			expect(h.window.__2FA_APPEARANCE__.revision).toBe(3);
		},
	);

	it('retries a lost response with the same operation and reads current state instead of adopting an old receipt', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		edit(h);
		let writes = 0;
		h.window.authenticatedFetch.mockReset().mockImplementation(async (_url, options = {}) => {
			if (options.method === 'PUT') {
				if (++writes === 1) {
					throw new Error('response lost after commit');
				}
				return json({ ...published(h), replayed: true });
			}
			return json(published(h, 3));
		});
		applyButton(h).click();
		await flush();
		const saved = h.saved();
		expect(saved.draft.branding.name).toBe('local brand');
		expect(status(h).dataset.error).toBe('true');
		applyButton(h).click();
		await flush();
		const calls = h.window.authenticatedFetch.mock.calls;
		expect(calls.map(([, options]) => options?.method || 'GET')).toEqual(['PUT', 'PUT', 'GET']);
		expect(JSON.parse(calls[1][1].body).operationId).toBe(saved.pendingApply.id);
		expect(h.window.__2FA_APPEARANCE__).toEqual(published(h, 3).active);
		expect(h.saved()).toBeUndefined();
	});

	it('keeps the baseline and pending request when a remote revision arrives while PUT is pending', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		edit(h);
		const pending = deferred();
		h.window.authenticatedFetch.mockReset().mockReturnValue(pending.promise);
		applyButton(h).click();
		await flush();
		const saved = h.saved();
		h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 3 } }));
		pending.resolve(json(published(h)));
		await flush();
		expect(h.saved()).toEqual(saved);
		expect(h.storage.log).not.toContain('delete');
		expect(h.window.__2FA_APPEARANCE__).toEqual(h.initial);
		expect(status(h).textContent).toContain(LOCALES['zh-CN'].appearanceConflict);
	});

	function richDraft() {
		const theme = getBuiltinTheme('document');
		const draft = createAppearanceDraft(theme).draft;
		draft.branding = { name: 'kept draft', logo: 'local:picture' };
		return {
			draft,
			revision: 1,
			dirty: true,
			blobs: [['local:picture', { blob: new Blob(['image bytes'], { type: 'image/png' }), name: 'image.png', mime: 'image/png' }]],
			profiles: [['v1:compact', createAppearanceDraft(getBuiltinTheme('compact')).draft]],
			migration: [{ key: 'accent', reason: 'changed', value: '#123456' }],
		};
	}
	it.each([false, true])(
		'restores the entire draft after a revision changes during IDB deletion (restore fails: %s)',
		async (failRestore) => {
			const h = harness({ savedDraft: richDraft() });
			await h.window.showAppearanceEditor();
			h.window.applyAppearance = vi.fn();
			h.window.authenticatedFetch
				.mockReset()
				.mockImplementation(async (url) =>
					json(url === '/api/appearance/assets' ? { asset: { hash: 'a'.repeat(64), name: 'image.png' } } : published(h)),
				);
			h.storage.holdNextDelete = true;
			applyButton(h).click();
			await flush();
			expect(h.storage.release).toBeTypeOf('function');
			const saved = h.saved();
			expect(saved.pendingApply.id).toBeTypeOf('string');
			expect(saved.blobs).toHaveLength(1);
			expect(saved.profiles).toHaveLength(1);
			expect(saved.migration).toHaveLength(1);
			h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 3 } }));
			h.storage.failNextPut = failRestore;
			h.storage.release();
			await flush();
			expect(h.window.applyAppearance).not.toHaveBeenCalled();
			expect(h.window.__2FA_APPEARANCE__).toEqual(h.initial);
			expect(status(h).textContent).toContain(LOCALES['zh-CN'][failRestore ? 'appearanceDraftFailed' : 'appearanceConflict']);
			if (failRestore) {
				expect(h.saved()).toBeUndefined();
				h.document.querySelector('[data-appearance-action="keep"]').click();
				await flush();
			}
			expect(h.saved()).toEqual(saved);
			expect(h.saved().revision).toBe(1);
			if (!failRestore) {
				// The remembered remote revision stays 3 even though the draft baseline is 1.
				const deletions = h.storage.log.filter((mode) => mode === 'delete').length;
				applyButton(h).click();
				await flush();
				expect(h.storage.log.filter((mode) => mode === 'delete')).toHaveLength(deletions);
				expect(h.saved().pendingApply.id).toBe(saved.pendingApply.id);
			}
		},
	);

	it('preserves the retry identity after IDB deletion aborts and can later complete', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		edit(h);
		h.window.authenticatedFetch.mockReset().mockImplementation(async () => json(published(h)));
		h.storage.failNextDelete = true;
		applyButton(h).click();
		await flush();
		const saved = h.saved();
		expect(saved.draft.branding.name).toBe('local brand');
		expect(h.window.__2FA_APPEARANCE__).toEqual(h.initial);
		expect(applyButton(h).disabled).toBe(false);
		applyButton(h).click();
		await flush();
		expect(JSON.parse(h.window.authenticatedFetch.mock.calls[1][1].body).operationId).toBe(saved.pendingApply.id);
		expect(h.saved()).toBeUndefined();
		expect(h.window.__2FA_APPEARANCE__.revision).toBe(2);
	});

	it('distinguishes uploading from saving and restores retry controls on failure', async () => {
		const h = harness({ savedDraft: richDraft() });
		await h.window.showAppearanceEditor();
		const upload = deferred(),
			save = deferred();
		h.window.authenticatedFetch.mockReset().mockImplementation((url) => (url === '/api/appearance/assets' ? upload.promise : save.promise));
		applyButton(h).click();
		expect(status(h).textContent).toBe(LOCALES['zh-CN'].appearanceUploading);
		expect(applyButton(h).textContent).toBe(LOCALES['zh-CN'].appearanceUploading);
		upload.resolve(json({ asset: { hash: 'a'.repeat(64), name: 'image.png' } }));
		await flush();
		expect(status(h).textContent).toBe(LOCALES['zh-CN'].appearanceSaving);
		save.reject(new Error('save unavailable'));
		await flush();
		expect(status(h).textContent).toContain('save unavailable');
		expect(applyButton(h).textContent).toBe(LOCALES['zh-CN'].appearanceApply);
		expect(applyButton(h).disabled).toBe(false);
		expect(h.saved().blobs).toHaveLength(1);
	});
});

describe('appearance editor lifecycle', () => {
	it.each(['apply', 'rollback', 'reload'])('remembers the latest saved profile after %s through A to B to A', async (action) => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const themes = [getBuiltinTheme('fluent'), getBuiltinTheme('compact')];
		themes[1].profile = createAppearanceDraft(themes[1]).draft;
		let active = h.initial;
		const response = () =>
			new Response(JSON.stringify({ revision: active.revision, active, previous: true, capabilities: { write: true } }));
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes') {
				return new Response(JSON.stringify({ themes }));
			}
			if (options.method === 'PUT') {
				const payload = JSON.parse(options.body);
				active = { ...active, ...payload, revision: active.revision + 1 };
			}
			return response();
		});
		await h.window.showAppearanceEditor();
		if (action === 'apply') {
			h.document.querySelector('[data-panel="design"]').click();
			const accent = h.document.querySelector('input[type="color"]');
			accent.value = '#ff0000';
			accent.dispatchEvent(new h.window.Event('input'));
		} else {
			active = { ...active, revision: 2, settings: { ...active.settings, accent: '#ff0000' } };
			if (action === 'reload') {
				h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 2 } }));
			}
		}
		h.document.querySelector('[data-appearance-action="' + action + '"]').click();
		await flush();
		expect(active.settings.accent).toBe('#ff0000');
		for (const id of ['builtin:compact', 'builtin:fluent']) {
			h.document.querySelector('[data-panel="library"]').click();
			const card = [...h.document.querySelectorAll('.appearance-theme-card')].find((node) => node.dataset.package === id);
			card.click();
		}
		h.document.querySelector('[data-panel="design"]').click();
		expect(h.document.querySelector('input[type="color"]').value).toBe('#ff0000');
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		expect(active.settings.accent).toBe('#ff0000');
	});

	it.each([
		['image/jpeg', 'photo.jpg', [255, 216, 255, 224, 0, 6, 74, 70, 73, 70, 255, 217]],
		['image/webp', 'photo.webp', [82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0]],
		['image/gif', 'photo.gif', [...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 59]],
	])('applies URL-imported %s assets using server-validated filenames and bytes', async (mime, name, bytes) => {
		const h = harness();
		const asset = await normalizeAsset(new Uint8Array(bytes), name);
		const uploads = [];
		let active = h.initial;
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes') {
				return new Response(JSON.stringify({ themes: [getBuiltinTheme('document')] }));
			}
			if (url === '/api/appearance/assets') {
				if (options.body instanceof FormData) {
					const file = options.body.get('file');
					const normalized = await normalizeAsset(new Uint8Array(await file.arrayBuffer()), file.name);
					uploads.push(normalized);
					return new Response(JSON.stringify({ asset: normalized }));
				}
				return new Response(JSON.stringify({ asset }));
			}
			if (url.startsWith('/api/appearance/assets/')) {
				return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime } });
			}
			if (options.method === 'PUT') {
				active = { ...active, ...JSON.parse(options.body), revision: 2 };
			}
			return new Response(JSON.stringify({ active, revision: active.revision, capabilities: { write: true } }));
		});
		await h.window.showAppearanceEditor();
		h.document.querySelector('[data-panel="brand"]').click();
		const url = h.document.querySelector('input[type="url"]');
		url.value = 'https://cdn.example.com/' + name;
		url.nextElementSibling.click();
		await vi.waitFor(() => expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(false));
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await vi.waitFor(() => expect(h.document.getElementById('appearanceStatus').textContent).toBe(LOCALES['zh-CN'].appearanceApplied));
		expect(uploads).toHaveLength(1);
		expect(uploads[0]).toMatchObject({ hash: asset.hash, mime, name: asset.name });
		expect(active.branding.logo).toBe('/theme-assets/' + asset.hash + '/' + asset.name);
	});
	function editBrand(h, value) {
		h.document.querySelector('[data-panel="brand"]').click();
		const input = h.document.querySelector('#appearancePanel input[type="text"]');
		input.value = value;
		input.dispatchEvent(new h.window.Event('input'));
	}

	it.each(['discard', 'reload', 'rollback'])('serializes %s after pending writes and prevents stale draft resurrection', async (action) => {
		const h = harness();
		await h.window.showAppearanceEditor();
		h.storage.holdNextPut = true;
		editBrand(h, 'first pending');
		await new Promise((resolve) => setTimeout(resolve, 280));
		expect(h.storage.release).toBeTypeOf('function');
		editBrand(h, 'second pending');
		await new Promise((resolve) => setTimeout(resolve, 280));
		if (action === 'reload') {
			h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 1 } }));
		}
		h.document.querySelector('[data-appearance-action="' + action + '"]').click();
		await flush();
		h.storage.release();
		await flush();
		await new Promise((resolve) => setTimeout(resolve, 280));
		expect(h.saved()).toBeUndefined();
		expect(h.storage.log.filter((mode) => mode !== 'get')).toEqual(['put', 'delete']);
		if (action !== 'discard') {
			await h.window.requestAppearanceClose();
		}
		expect(h.window.hasAppearancePendingChanges()).toBe(false);
		await h.window.showAppearanceEditor();
		h.document.querySelector('[data-panel="brand"]').click();
		expect(h.document.querySelector('#appearancePanel input[type="text"]').value).not.toMatch(/pending/);
	});

	it('takes the current server snapshot when a clean editor opens on an older page', async () => {
		const h = harness();
		const remote = { ...h.initial, revision: 2, branding: { name: 'remote brand' } };
		h.window.authenticatedFetch.mockImplementation(
			async (url) =>
				new Response(
					JSON.stringify(
						url === '/api/themes'
							? { themes: [getBuiltinTheme('document')] }
							: { revision: 2, active: remote, capabilities: { write: true } },
					),
				),
		);
		await h.window.showAppearanceEditor();
		h.document.querySelector('[data-panel="brand"]').click();
		expect(h.document.querySelector('#appearancePanel input[type="text"]').value).toBe('remote brand');
		editBrand(h, 'next brand');
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		const put = h.window.authenticatedFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
		expect(JSON.parse(put[1].body).expectedRevision).toBe(2);
	});

	it('retains the dirty baseline across installation even when another device advances the revision', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editBrand(h, 'local edit');
		const theme = getBuiltinTheme('document');
		theme.packageId = 'updated-document';
		theme.manifest.version = '2.0.0';
		const remote = { ...h.initial, revision: 2, branding: { name: 'remote brand' } };
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes/import') {
				return new Response(JSON.stringify({ theme }));
			}
			if (url === '/api/themes') {
				return new Response(JSON.stringify({ themes: [theme] }));
			}
			if (options.method === 'PUT') {
				return new Response(JSON.stringify({ error: 'THEME_REVISION_CONFLICT' }), { status: 409 });
			}
			return new Response(JSON.stringify({ revision: 2, active: remote, capabilities: { write: true } }));
		});
		h.document.querySelector('[data-panel="library"]').click();
		h.document.getElementById('appearanceSource').value = 'https://themes.example/theme.zip';
		h.document.querySelector('[data-appearance-action="install"]').click();
		await flush();
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		const put = h.window.authenticatedFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
		expect(JSON.parse(put[1].body)).toMatchObject({ expectedRevision: 1, branding: { name: 'local edit' } });
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearanceConflict);
	});

	it('refreshes write capabilities after reconnecting without rebasing an offline draft', async () => {
		const h = harness({ online: false });
		await h.window.showAppearanceEditor();
		editBrand(h, 'offline edit');
		expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(true);
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (url === '/api/themes') {
				return new Response(JSON.stringify({ themes: [getBuiltinTheme('document')] }));
			}
			if (options.method === 'PUT') {
				return new Response(JSON.stringify({ error: 'THEME_REVISION_CONFLICT' }), { status: 409 });
			}
			return new Response(JSON.stringify({ revision: 2, active: { ...h.initial, revision: 2 }, capabilities: { write: true } }));
		});
		h.network.onLine = true;
		h.window.dispatchEvent(new h.window.Event('online'));
		await flush();
		expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(false);
		expect(h.document.querySelector('#appearancePanel input[type="text"]').value).toBe('offline edit');
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		const put = h.window.authenticatedFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
		expect(JSON.parse(put[1].body).expectedRevision).toBe(1);
	});

	it('keeps the operation identity after a successful apply whose follow-up read fails', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		editBrand(h, 'retry me');
		let attempts = 0;
		let failRead = false;
		h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
			if (options.method === 'PUT') {
				attempts += 1;
				failRead = attempts === 1;
				return new Response('{}');
			}
			if (failRead) {
				failRead = false;
				throw new Error('Lost follow-up response');
			}
			return new Response(JSON.stringify({ revision: 2, active: { ...h.initial, revision: 2 }, capabilities: { write: true } }));
		});
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		h.document.querySelector('[data-appearance-action="apply"]').click();
		await flush();
		const puts = h.window.authenticatedFetch.mock.calls
			.filter(([, options]) => options?.method === 'PUT')
			.map(([, options]) => JSON.parse(options.body));
		expect(puts).toHaveLength(2);
		expect(puts[1].operationId).toBe(puts[0].operationId);
		expect(h.saved()).toBeUndefined();
	});

	it('blocks apply and discard until all icon sizes are generated, then commits them together', async () => {
		const h = harness();
		await h.window.showAppearanceEditor();
		h.document.querySelector('[data-panel="brand"]').click();
		const images = [];
		h.window.Image = class {
			constructor() {
				this.width = 512;
				this.height = 512;
				images.push(this);
			}
		};
		const generated = [];
		const getContext = vi.spyOn(h.window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} });
		const toBlob = vi.spyOn(h.window.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
			generated.push({ callback, size: this.width });
		});
		try {
			const file = h.document.querySelectorAll('#appearancePanel input[type="file"]')[1];
			Object.defineProperty(file, 'files', { value: [new Blob(['image'], { type: 'image/png' })] });
			file.dispatchEvent(new h.window.Event('change'));
			expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(true);
			expect(h.document.querySelector('[data-appearance-action="discard"]').disabled).toBe(true);
			await h.window.requestAppearanceClose();
			expect(h.document.getElementById('appearanceModal').style.display).toBe('block');
			images[0].onload();
			await flush();
			for (let i = 0; i < 3; i++) {
				expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(true);
				expect(h.saved()?.draft.branding?.icon192).toBeUndefined();
				generated[i].callback(new Blob([String(generated[i].size)], { type: 'image/png' }));
				await flush();
			}
			expect(generated.map((item) => item.size)).toEqual([192, 512, 180]);
			expect(h.document.querySelector('[data-appearance-action="apply"]').disabled).toBe(false);
			h.document.querySelector('[data-appearance-action="keep"]').click();
			await flush();
			expect(h.saved().draft.branding).toMatchObject({
				icon192: expect.stringMatching(/^local:/),
				icon512: expect.stringMatching(/^local:/),
				appleTouchIcon: expect.stringMatching(/^local:/),
			});
			expect(h.saved().blobs).toHaveLength(3);
		} finally {
			getContext.mockRestore();
			toBlob.mockRestore();
		}
	});
});
