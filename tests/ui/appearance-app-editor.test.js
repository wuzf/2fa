/* global structuredClone */
import { describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { harness, flush } from '../helpers/appearance-editor.js';
import { appThemeFixture, appPng } from '../helpers/app-theme.js';
import { normalizeAppThemeImport, normalizeAppAppearance, normalizeAsset } from '../../src/themes/index.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { THEME_OPERATION_HEADER } from '../../src/api/themes.js';
import { THEME_PREVIEW_OWNER_HEADER } from '../../src/api/themes.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function appTheme(options = {}) {
	const fixture = await appThemeFixture(
		{ 'entry.js': 'export const mount=()=>({unmount(){}});', 'brand.png': appPng },
		{
			id: 'document',
			settings: [{ key: 'accent', label: 'Accent', type: 'color', default: '#aa2233' }],
			...options,
		},
	);
	return { ...(await normalizeAppThemeImport({ bytes: fixture.archive })), fixture };
}
const action = (h, name) => h.document.querySelector('[data-appearance-action="' + name + '"]').click();
const panel = (h, name) => h.document.querySelector('[data-panel="' + name + '"]').click();
async function select(h, id) {
	panel(h, 'library');
	[...h.document.querySelectorAll('.appearance-theme-card')].find((e) => e.dataset.package === id).click();
	await flush();
}
function editColor(h, value) {
	panel(h, 'design');
	const control = h.document.querySelector('input[type=color]');
	control.value = value;
	control.dispatchEvent(new h.window.Event('input'));
}
const tickPreview = () => new Promise((resolve) => setTimeout(resolve, 160));
function network(h, themes, { allowApply = false, extra } = {}) {
	let active = h.initial;
	const put = [];
	h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
		const special = await extra?.(url, options);
		if (special) {
			return special;
		}
		if (url === '/api/themes') {
			return json({ themes: themes.filter((t) => t.kind !== 'app') });
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: themes.filter((t) => t.kind === 'app') });
		}
		if (url === '/api/appearance' && options.method === 'PUT') {
			const payload = JSON.parse(options.body);
			put.push(payload);
			if (!allowApply) {
				return json({ code: 'THEME_RESOURCE_BUSY' }, 409);
			}
			const theme = themes.find((t) => t.packageId === payload.packageId);
			active = { ...createAppearanceDraft(theme).draft, ...payload, revision: active.revision + 1 };
		}
		return json({ active, revision: active.revision, capabilities: { write: true } });
	});
	return {
		put,
		active: () => active,
		setActive: (value) => {
			active = value;
		},
	};
}
function previewPort(h) {
	let status;
	let invalidated;
	let frame;
	const port = {
		open: vi.fn(async (payload) => {
			frame = h.document.createElement('iframe');
			h.document.getElementById('appearanceAppPreview').replaceChildren(frame);
			status({ status: 'ready' });
			return payload;
		}),
		update: vi.fn(async () => {}),
		close: vi.fn(() => frame?.remove()),
	};
	h.window.createAppThemePreview = vi.fn((options) => {
		status = options.onStatus;
		invalidated = options.onSessionInvalidated;
		return port;
	});
	return { ...port, status: (next) => status(next), invalidateSession: () => invalidated() };
}

describe('full frontend editor configuration', () => {
	it('migrates package asset URLs to the new version and reports removed assets without losing personal resources', async () => {
		const old = await appTheme({ settings: [{ key: 'picture', type: 'asset', default: 'brand.png' }] });
		const next = await appTheme({ version: '2.0.0', settings: [{ key: 'picture', type: 'asset', default: 'brand.png' }] });
		const previous = createAppearanceDraft(old).draft;
		previous.settings.picture = '/theme-packages/' + old.packageId + '/brand.png';
		const migrated = createAppearanceDraft(next, previous);
		expect(migrated.draft.settings.picture).toBe('brand.png');
		await expect(
			normalizeAppAppearance(next, { packageId: next.packageId, settings: migrated.draft.settings, branding: {} }),
		).resolves.toMatchObject({ appearance: { settings: { picture: 'brand.png' } } });
		const fixture = await appThemeFixture(
			{ 'entry.js': 'export const mount=()=>{};' },
			{ id: old.manifest.id, version: '3.0.0', settings: [{ key: 'picture', type: 'asset', default: '' }] },
		);
		const removed = await normalizeAppThemeImport({ bytes: fixture.archive });
		const reset = createAppearanceDraft(removed, previous);
		expect(reset.draft.settings.picture).toBe('');
		expect(reset.changes).toContainEqual({ key: 'picture', reason: 'asset-missing', value: '' });
		const personal = await normalizeAsset(appPng, 'brand.png');
		previous.settings.picture = '/theme-assets/' + personal.hash + '/' + personal.name;
		const carried = createAppearanceDraft(removed, previous);
		expect(carried.draft.settings.picture).toBe(previous.settings.picture);
		await expect(
			normalizeAppAppearance(
				removed,
				{ packageId: removed.packageId, settings: carried.draft.settings, branding: {} },
				{ assets: [personal] },
			),
		).resolves.toMatchObject({ appearance: { settings: { picture: previous.settings.picture } } });
		previous.settings.picture = 'local:kept-blob';
		expect(createAppearanceDraft(removed, previous).draft.settings.picture).toBe('local:kept-blob');
	});
	it('keeps the app draft branch executable in the minified emitted editor', async () => {
		const output = await build({
			entryPoints: ['src/ui/scripts/appearanceEditor.js'],
			bundle: true,
			minify: true,
			keepNames: true,
			write: false,
			format: 'esm',
			platform: 'node',
		});
		const module = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
		const app = await appTheme();
		const h = harness({ code: module.getAppearanceEditorCode() });
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		await select(h, app.packageId);
		editColor(h, '#112233');
		action(h, 'keep');
		await flush();
		expect(h.saved().draft).toMatchObject({ kind: 'app', settings: { accent: '#112233' } });
		expect(h.saved().draft).not.toHaveProperty('layout');
	});
	it('separates identical v1/app IDs, excludes v1 controls and keeps A to B to A local values across reopen', async () => {
		const app = await appTheme();
		const v1 = getBuiltinTheme('document');
		const h = harness();
		network(h, [v1, app]);
		await h.window.showAppearanceEditor();
		editColor(h, '#112233');
		await select(h, app.packageId);
		editColor(h, '#445566');
		expect(h.document.querySelector('[data-panel=layout]').hidden).toBe(true);
		expect(h.document.querySelector('[data-panel=advanced]').hidden).toBe(true);
		await select(h, v1.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=color]').value).toBe('#112233');
		expect(h.document.querySelector('[data-panel=layout]').hidden).toBe(false);
		await select(h, app.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=color]').value).toBe('#445566');
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.kind).toBe('app');
		for (const key of ['layout', 'content', 'customCss', 'css']) {
			expect(h.saved().draft).not.toHaveProperty(key);
		}
		await h.window.showAppearanceEditor();
		await select(h, v1.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=color]').value).toBe('#112233');
	});
	it('uses app version profiles and exposes changed or removed settings before apply', async () => {
		const app = await appTheme({
			settings: [
				{ key: 'size', type: 'number', default: 12, min: 10, max: 20 },
				{ key: 'new', type: 'boolean', default: true },
			],
		});
		app.profile = {
			kind: 'app',
			themeId: 'document',
			packageId: 'old',
			manifest: {
				kind: 'app',
				settings: [
					{ key: 'size', type: 'number' },
					{ key: 'removed', type: 'text' },
				],
			},
			settings: { size: 99, removed: 'old' },
		};
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		await select(h, app.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=number]').value).toBe('12');
		expect(h.document.querySelector('.appearance-migration').textContent).toContain('removed');
		expect(h.document.querySelector('.appearance-migration').textContent).toContain('size');
	});
	it('cancels trust without a PUT, then sends only app fields and keeps a resource-busy rejected draft', async () => {
		const app = await appTheme();
		const h = harness();
		const net = network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		await select(h, app.packageId);
		editColor(h, '#334455');
		h.window.showConfirmDialog.mockResolvedValueOnce(false);
		action(h, 'apply');
		await flush();
		expect(net.put).toHaveLength(0);
		action(h, 'apply');
		await flush();
		expect(net.put).toHaveLength(1);
		expect(Object.keys(net.put[0]).sort()).toEqual(['branding', 'expectedRevision', 'operationId', 'packageId', 'settings'].sort());
		expect(h.window.showConfirmDialog.mock.calls.at(-1)[0].i18n.message).toBe('appearanceAppTrust');
		expect(h.saved().draft.settings.accent).toBe('#334455');
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearanceErrorBusy);
		action(h, 'apply');
		await flush();
		expect(net.put[1].operationId).toBe(net.put[0].operationId);
	});
	it('publishes app metadata without mounting a new package and requests a guarded reload after closing', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app], { allowApply: true });
		h.window.applyAppearance = vi.fn();
		h.window.updateAppearanceMetadata = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => {
			expect(h.window.hasAppearancePendingChanges()).toBe(false);
			expect(h.document.getElementById('appearanceModal').style.display).toBe('none');
			return { status: 'completed' };
		});
		await h.window.showAppearanceEditor();
		await select(h, app.packageId);
		action(h, 'apply');
		await flush();
		expect(h.window.__2FA_APPEARANCE__.packageId).toBe(app.packageId);
		expect(h.window.applyAppearance).not.toHaveBeenCalled();
		expect(h.window.updateAppearanceMetadata).toHaveBeenCalledOnce();
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearancePublishedReload);
		action(h, 'refresh-runtime');
		await flush();
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledWith('theme-change');
	});
	it('updates the current app configuration in place and keeps saved profiles on selection and remote reload', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		const net = network(h, [getBuiltinTheme('document'), app], { allowApply: true });
		h.window.applyAppearance = vi.fn();
		await h.window.showAppearanceEditor();
		editColor(h, '#123456');
		action(h, 'apply');
		await flush();
		expect(h.window.applyAppearance).toHaveBeenCalledWith(expect.objectContaining({ settings: { accent: '#123456' } }));
		await select(h, 'builtin:document');
		await select(h, app.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=color]').value).toBe('#123456');
		net.setActive({ ...net.active(), revision: 3, settings: { accent: '#654321' } });
		h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 3 } }));
		action(h, 'reload');
		await flush();
		await select(h, 'builtin:document');
		await select(h, app.packageId);
		panel(h, 'design');
		expect(h.document.querySelector('input[type=color]').value).toBe('#654321');
	});
	it('preserves all brand fields across app to v1 and keeps package images as local bytes', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		Object.assign(h.initial.branding, {
			name: 'Pixel',
			description: 'desc',
			loginText: 'welcome',
			footer: 'foot',
			logo: 'brand.png',
			background: 'brand.png',
			icon192: 'brand.png',
			icon512: 'brand.png',
			appleTouchIcon: 'brand.png',
		});
		network(h, [getBuiltinTheme('document'), app], {
			extra: async (url) => (url.includes('/files/') ? new Response(appPng, { headers: { 'Content-Type': 'image/png' } }) : null),
		});
		await h.window.showAppearanceEditor();
		await select(h, 'builtin:document');
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.branding).toMatchObject({ name: 'Pixel', description: 'desc', loginText: 'welcome', footer: 'foot' });
		for (const key of ['logo', 'background', 'icon192', 'icon512', 'appleTouchIcon']) {
			const ref = h.saved().draft.branding[key];
			expect(ref).toMatch(/^local:/);
			expect(new Uint8Array(await new Map(h.saved().blobs).get(ref).blob.arrayBuffer())).toEqual(appPng);
		}
		await h.window.showAppearanceEditor();
		await select(h, app.packageId);
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.branding.name).toBe('Pixel');
		expect(h.saved().draft.branding.logo).toMatch(/^local:/);
	});
	it('keeps the entire offline draft when a private package brand cannot be carried to another theme', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		h.initial.branding.logo = 'brand.png';
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		h.network.onLine = false;
		h.window.dispatchEvent(new h.window.Event('offline'));
		await select(h, 'builtin:document');
		expect(h.document.getElementById('appearanceStatus').textContent).toContain(LOCALES['zh-CN'].appearanceOfflineBrand);
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.packageId).toBe(app.packageId);
		expect(h.saved().draft.branding.logo).toBe('brand.png');
	});
	it('routes app installation and restore inspection separately and never applies either automatically', async () => {
		const app = await appTheme();
		const h = harness();
		const net = network(h, [getBuiltinTheme('document'), app], {
			extra: async (url) =>
				url.includes('restore-inspect') || url.startsWith('/api/themes/import')
					? json({
							theme: app,
							appearance: {
								packageId: app.packageId,
								themeId: app.manifest.id,
								settings: { accent: '#abcdef' },
								branding: { name: 'restored' },
							},
						})
					: null,
		});
		await h.window.showAppearanceEditor();
		const format = h.document.getElementById('appearanceImportFormat');
		format.value = 'app';
		format.dispatchEvent(new h.window.Event('change'));
		h.document.getElementById('appearanceSource').value = 'https://github.com/example/pixel';
		action(h, 'install');
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledWith('/api/themes/import?format=app', expect.any(Object));
		const file = h.document.querySelectorAll('input[type=file]')[1];
		Object.defineProperty(file, 'files', { value: [new h.window.File(['zip'], 'appearance.zip')] });
		file.dispatchEvent(new h.window.Event('change'));
		await flush();
		expect(h.window.authenticatedFetch).toHaveBeenCalledWith('/api/appearance/restore-inspect?format=app', expect.any(Object));
		expect(net.put).toHaveLength(0);
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.settings.accent).toBe('#abcdef');
		expect(h.saved().draft.branding.name).toBe('restored');
	});
});

describe('editor opaque preview integration', () => {
	it('invalidates pending asset staging on a session change before it can open another capability', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		const asset = await normalizeAsset(appPng, 'brand.png');
		let release;
		network(h, [app], {
			extra: async (url) =>
				url === '/api/appearance/assets'
					? new Promise((resolve) => {
							release = () => resolve(json({ asset }));
						})
					: null,
		});
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		panel(h, 'brand');
		const file = h.document.querySelector('input[type=file]');
		Object.defineProperty(file, 'files', { value: [new Blob([appPng], { type: 'image/png' })] });
		file.dispatchEvent(new h.window.Event('change'));
		await flush();
		action(h, 'refresh-preview');
		await flush();
		expect(release).toBeTypeOf('function');
		port.invalidateSession();
		expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
		expect(h.document.querySelector('[data-appearance-action=apply]').disabled).toBe(true);
		release();
		await flush();
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.branding.logo).toMatch(/^local:/);
		expect(h.saved().blobs).toHaveLength(1);
	});
	it('treats local: in text as text and still opens the actual app preview', async () => {
		const app = await appTheme({ settings: [{ key: 'label', type: 'text', default: 'local: 2fa' }] });
		const h = harness({ theme: app });
		h.initial.branding = { name: 'local: authenticator', footer: 'Use local: accounts' };
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledWith(
			expect.objectContaining({ appearance: { settings: { label: 'local: 2fa' }, branding: h.initial.branding } }),
		);
	});
	it('carries published brand resource bytes into the v1 offline preview and persisted draft', async () => {
		const app = await appTheme();
		const asset = await normalizeAsset(appPng, 'brand.png');
		const url = '/theme-assets/' + asset.hash + '/' + asset.name;
		const h = harness({ theme: app });
		h.initial.branding = { logo: url, background: url };
		h.initial.resources = [{ hash: asset.hash, name: asset.name, mime: asset.mime, url }];
		network(h, [getBuiltinTheme('document'), app]);
		Object.defineProperty(h.window, 'caches', { value: { match: vi.fn(async () => new Response(appPng)) } });
		await h.window.showAppearanceEditor();
		await select(h, 'builtin:document');
		h.network.onLine = false;
		h.window.dispatchEvent(new h.window.Event('offline'));
		const frame = h.document.getElementById('appearancePreview');
		frame.contentWindow.postMessage = vi.fn();
		frame.onload();
		await tickPreview();
		const payload = frame.contentWindow.postMessage.mock.calls.at(-1)[0];
		expect(payload.snapshot.branding).toEqual({ logo: url, background: url });
		expect(payload.resources).toHaveLength(1);
		expect(new Uint8Array(payload.resources[0].bytes)).toEqual(appPng);
		expect(h.window.caches.match).toHaveBeenCalledWith('https://example.com' + url);
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.resources).toEqual(h.initial.resources);
	});
	it('opens once, updates config/mode/width without capability churn and closes synchronously', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		editColor(h, '#123456');
		h.document.querySelector('[data-mode=dark]').click();
		h.document.querySelector('[data-width="390"]').click();
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		expect(port.update).toHaveBeenLastCalledWith(
			expect.objectContaining({ appearance: { settings: { accent: '#123456' }, branding: {} }, mode: 'dark' }),
		);
		expect(h.document.querySelector('#appearanceAppPreview iframe').style.width).toBe('390px');
		action(h, 'keep');
		await flush();
		expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
		expect(port.close).toHaveBeenCalled();
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledTimes(2);
	});
	it('stages new personal assets only on manual refresh and keeps local blobs for offline drafts', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		const asset = await normalizeAsset(appPng, 'brand.png');
		let uploads = 0;
		network(h, [app], {
			extra: async (url, options) => {
				if (url === '/api/appearance/assets') {
					uploads++;
					const file = options.body.get('file');
					expect(await file.arrayBuffer()).toEqual(appPng.buffer.slice(appPng.byteOffset, appPng.byteOffset + appPng.byteLength));
					return json({ asset });
				}
			},
		});
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		panel(h, 'brand');
		const file = h.document.querySelector('input[type=file]');
		Object.defineProperty(file, 'files', { value: [new Blob([appPng], { type: 'image/png' })] });
		file.dispatchEvent(new h.window.Event('change'));
		await flush();
		await tickPreview();
		expect(uploads).toBe(0);
		expect(port.open).toHaveBeenCalledOnce();
		expect(h.document.getElementById('appearanceAppPreviewStatus').textContent).toBe(LOCALES['zh-CN'].appearancePreviewChanged);
		action(h, 'refresh-preview');
		await flush();
		expect(uploads).toBe(1);
		expect(port.open).toHaveBeenCalledTimes(2);
		expect(port.open.mock.calls[1][0].appearance.branding.logo).toMatch(/^\/theme-assets\//);
		h.network.onLine = false;
		h.window.dispatchEvent(new h.window.Event('offline'));
		expect(port.close).toHaveBeenCalled();
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.branding.logo).toMatch(/^local:/);
		expect(h.saved().blobs).toHaveLength(1);
	});
	it('ignores late asset staging after close and does not reopen an offline preview', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		const asset = await normalizeAsset(appPng, 'brand.png');
		let release;
		network(h, [app], {
			extra: async (url) =>
				url === '/api/appearance/assets'
					? new Promise((resolve) => {
							release = () => resolve(json({ asset }));
						})
					: null,
		});
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		panel(h, 'brand');
		const file = h.document.querySelector('input[type=file]');
		Object.defineProperty(file, 'files', { value: [new Blob([appPng], { type: 'image/png' })] });
		file.dispatchEvent(new h.window.Event('change'));
		await flush();
		action(h, 'refresh-preview');
		await flush();
		expect(release).toBeTypeOf('function');
		action(h, 'keep');
		await flush();
		release();
		await flush();
		expect(port.open).toHaveBeenCalledOnce();
		expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
		h.network.onLine = false;
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		expect(h.saved().blobs).toHaveLength(1);
	});
	it('shows preview expiry and resource-change recovery while preserving the editable draft', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		editColor(h, '#abcdef');
		port.status({ status: 'blocked', reason: 'preview-expired' });
		expect(h.document.getElementById('appearanceAppPreviewStatus').textContent).toBe(LOCALES['zh-CN'].appearancePreviewExpired);
		action(h, 'refresh-preview');
		await flush();
		expect(port.open).toHaveBeenCalledTimes(2);
		action(h, 'keep');
		await flush();
		expect(h.saved().draft.settings.accent).toBe('#abcdef');
	});
});

class MemoryStorage {
	data = new Map();
	async get(key) {
		return structuredClone(this.data.get(key));
	}
	async put(key, value) {
		this.data.set(key, structuredClone(value));
	}
	async delete(key) {
		this.data.delete(key);
	}
	async list({ prefix = '' } = {}) {
		return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]));
	}
	async setAlarm() {}
	async getAlarm() {
		return null;
	}
	async transaction(fn) {
		const before = structuredClone(this.data);
		try {
			return await fn(this);
		} catch (error) {
			this.data = before;
			throw error;
		}
	}
}
it('publishes the actual editor app payload through storage HTTP and preserves saved settings on reload', async () => {
	const app = await appTheme();
	const store = new ThemeStore(
		{ storage: new MemoryStorage() },
		{ SECRETS_KV: { get: async () => null, put: async () => {}, delete: async () => {} } },
	);
	const req = (url, options = {}) =>
		store.fetch(new Request('https://example.com' + url, { ...options, headers: { [THEME_OPERATION_HEADER]: 'api', ...options.headers } }));
	expect((await req('/api/themes/import?format=app', { method: 'POST', body: app.fixture.archive })).status).toBe(201);
	const h = harness();
	h.initial.revision = 0;
	let publication;
	h.window.authenticatedFetch.mockImplementation((url, options) => {
		const pending = req(url, options);
		if (url === '/api/appearance' && options?.method === 'PUT') {
			publication = pending;
		}
		return pending;
	});
	await h.window.showAppearanceEditor();
	await select(h, app.packageId);
	editColor(h, '#102030');
	action(h, 'apply');
	await vi.waitFor(() => expect(publication).toBeDefined());
	expect((await publication).status).toBe(200);
	await flush();
	const published = await (await req('/api/appearance')).json();
	expect(published.revision).toBe(1);
	expect(h.window.__2FA_APPEARANCE__.settings.accent).toBe('#102030');
	expect(h.saved()).toBeUndefined();
	const payload = JSON.parse(h.window.authenticatedFetch.mock.calls.find(([, options]) => options?.method === 'PUT')[1].body);
	expect(payload).toMatchObject({ expectedRevision: 0, packageId: app.packageId, settings: { accent: '#102030' } });
	expect(published.active.settings.accent).toBe('#102030');
	expect(await (await req('/api/appearance', { method: 'PUT', body: JSON.stringify(payload) })).json()).toMatchObject({
		revision: 1,
		replayed: true,
	});
	h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 1 } }));
	action(h, 'reload');
	await flush();
	panel(h, 'design');
	expect(h.document.querySelector('input[type=color]').value).toBe('#102030');
	expect(h.document.querySelector('[data-panel=layout]').hidden).toBe(true);
});

it('runs the editor through the real capability client and server, revoking a late response after close', async () => {
	// Use untransformed browser source, not Vitest's SSR dynamic-import helper.
	const output = await build({
		entryPoints: ['src/ui/scripts/appThemePreview.js'],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'node',
	});
	const { createAppThemePreview, createAppThemePreviewDocument, appThemePreviewFrame, createAppPreviewMockSdk } = await import(
		'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
	);
	const app = await appTheme();
	const store = new ThemeStore(
		{ storage: new MemoryStorage() },
		{ SECRETS_KV: { get: async () => null, put: async () => {}, delete: async () => {} } },
	);
	const req = (url, options = {}) =>
		store.fetch(
			new Request('https://example.com' + url, {
				...options,
				headers: { [THEME_OPERATION_HEADER]: 'api', [THEME_PREVIEW_OWNER_HEADER]: 'a'.repeat(64), ...options.headers },
			}),
		);
	expect((await req('/api/themes/import?format=app', { method: 'POST', body: app.fixture.archive })).status).toBe(201);
	const h = harness();
	h.initial.revision = 0;
	let release;
	let cap;
	let delayed = false;
	let invalidateSession;
	h.window.authenticatedFetch.mockImplementation(async (url, options) => {
		const response = await req(url, options);
		if (url === '/api/themes/preview-capabilities') {
			cap = await response.clone().json();
			if (delayed) {
				return new Promise((resolve) => {
					release = () => resolve(response);
				});
			}
		}
		return response;
	});
	h.window.createAppThemePreview = (options) =>
		createAppThemePreview({
			...options,
			window: h.window,
			subscribeSession: (listener) => {
				invalidateSession = listener;
				return () => {};
			},
			createDocument: (config) =>
				createAppThemePreviewDocument(config, appThemePreviewFrame.toString(), createAppPreviewMockSdk.toString()),
		});
	await h.window.showAppearanceEditor();
	await select(h, app.packageId);
	await tickPreview();
	let frame = h.document.querySelector('#appearanceAppPreview iframe');
	expect(frame).not.toBeNull();
	expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
	expect(frame.hasAttribute('credentialless')).toBe(true);
	expect(frame.srcdoc).toContain(cap.entryUrl);
	expect(frame.srcdoc).toContain('import(config.entryUrl)');
	expect(frame.srcdoc).not.toContain('allow-same-origin');
	expect(frame.srcdoc).not.toContain('/api/secrets');
	expect(h.window.authenticatedFetch.mock.calls.filter(([url]) => url === '/api/themes/preview-capabilities')).toHaveLength(1);
	action(h, 'keep');
	await flush();
	expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
	expect(h.window.authenticatedFetch).toHaveBeenCalledWith(
		'/api/themes/preview-capabilities/' + cap.capabilityId,
		expect.objectContaining({ method: 'DELETE' }),
	);
	delayed = true;
	await h.window.showAppearanceEditor();
	await tickPreview();
	expect(release).toBeTypeOf('function');
	action(h, 'keep');
	await flush();
	release();
	await flush();
	frame = h.document.querySelector('#appearanceAppPreview iframe');
	expect(frame).toBeNull();
	expect(h.window.authenticatedFetch).toHaveBeenCalledWith(
		'/api/themes/preview-capabilities/' + cap.capabilityId,
		expect.objectContaining({ method: 'DELETE' }),
	);
	delayed = false;
	await h.window.showAppearanceEditor();
	await tickPreview();
	expect(h.document.querySelector('#appearanceAppPreview iframe')).not.toBeNull();
	invalidateSession();
	expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
	expect(h.document.querySelector('[data-appearance-action=apply]').disabled).toBe(true);
	action(h, 'keep');
	await flush();
	expect(h.saved().draft.packageId).toBe(app.packageId);
});
