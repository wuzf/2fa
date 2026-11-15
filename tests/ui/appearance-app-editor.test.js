/* global structuredClone */
import { describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import {
	harness,
	flush,
	tickPreview,
	json,
	control,
	act,
	chooseTheme,
	editSetting,
	status,
	putBodies,
} from '../helpers/appearance-editor.js';
import { appThemeFixture, appPng } from '../helpers/app-theme.js';
import { normalizeAppThemeImport } from '../../src/themes/index.js';
import { createAppearanceDraft } from '../../src/ui/scripts/appearanceEditor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { THEME_OPERATION_HEADER, THEME_PREVIEW_OWNER_HEADER } from '../../src/api/themes.js';

const zh = LOCALES['zh-CN'];
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
const editColor = (h, value) => editSetting(h, 'accent', value);
function network(h, themes, { extra } = {}) {
	let active = h.initial;
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
		if (url === '/api/themes/catalog') {
			return json({ themes: [] });
		}
		if (url === '/api/appearance' && options.method === 'PUT') {
			const payload = JSON.parse(options.body);
			const theme = themes.find((t) => t.packageId === payload.packageId);
			active = { ...createAppearanceDraft(theme).draft, settings: payload.settings, revision: active.revision + 1 };
		}
		return json({ active, revision: active.revision, capabilities: { write: true } });
	});
	return { active: () => active };
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
const previewStatus = (h) => h.document.getElementById('appearanceAppPreviewStatus');

describe('theme cards', () => {
	const card = (h, packageId) => h.document.querySelector('.appearance-theme-card[data-package="' + packageId + '"]');

	it('shows the screenshot a theme ships and marks only the chosen card', async () => {
		const app = await appTheme({ preview: 'brand.png' });
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		const image = card(h, app.packageId).querySelector('.appearance-theme-shot img');
		expect(image.getAttribute('src')).toBe('/api/themes/' + app.packageId + '/files/brand.png');
		expect(image.getAttribute('alt')).toBe('');
		expect(card(h, app.packageId).getAttribute('aria-pressed')).toBe('false');
		await chooseTheme(h, app.packageId);
		const pressed = [...h.document.querySelectorAll('.appearance-theme-card[aria-pressed="true"]')].map((node) => node.dataset.package);
		expect(pressed).toEqual([app.packageId]);
	});

	it('falls back to the theme colours when the screenshot cannot load', async () => {
		const app = await appTheme({ preview: 'brand.png' });
		app.profile = { publicAppearance: { light: { subtle: '#102030', accent: '#405060', surface: '#708090', text: '#a0b0c0' } } };
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		card(h, app.packageId).querySelector('.appearance-theme-shot img').dispatchEvent(new h.window.Event('error'));
		expect(card(h, app.packageId).querySelector('.appearance-theme-shot')).toBeNull();
		const palette = card(h, app.packageId).querySelector('.appearance-theme-swatch');
		expect(palette.style.backgroundColor).toBe('#102030');
		expect([...palette.querySelectorAll('i')].map((dot) => dot.style.backgroundColor)).toEqual(['#405060', '#708090', '#a0b0c0']);
	});

	it('keeps the colour swatch for a theme without a screenshot', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		expect(card(h, app.packageId).querySelector('img')).toBeNull();
		expect(card(h, app.packageId).querySelector('.appearance-theme-swatch')).not.toBeNull();
	});
});

describe('app theme configuration', () => {
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
		await chooseTheme(h, app.packageId);
		await tickPreview();
		expect(h.document.getElementById('appearancePreview').style.display).toBe('none');
		expect(h.document.getElementById('appearanceAppPreview').hidden).toBe(false);
		editColor(h, '#112233');
		await act(h, 'apply');
		expect(putBodies(h)[0]).toMatchObject({ packageId: app.packageId, settings: { accent: '#112233' } });
		expect(Object.keys(putBodies(h)[0]).sort()).toEqual(['expectedRevision', 'operationId', 'packageId', 'settings']);
	});

	it('separates identical v1/app IDs and keeps A to B to A local values', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		editColor(h, '#010203');
		await chooseTheme(h, app.packageId);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#aa2233');
		expect(h.document.querySelectorAll('[data-theme-setting]')).toHaveLength(1);
		editColor(h, '#040506');
		await chooseTheme(h, 'builtin:document');
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#010203');
		await chooseTheme(h, app.packageId);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#040506');
	});

	it('shows the migration note when a newer app version changes saved settings', async () => {
		const old = await appTheme({ version: '1.0.0', settings: [{ key: 'size', label: 'Size', type: 'number', default: 14, max: 30 }] });
		const next = await appTheme({ version: '2.0.0', settings: [{ key: 'size', label: 'Size', type: 'number', default: 14, max: 20 }] });
		const h = harness({ theme: old });
		h.initial.settings.size = 28;
		network(h, [next]);
		await h.window.showAppearanceEditor();
		expect(h.document.getElementById('appearancePanel').textContent).not.toContain(zh.appearanceMigration);
		await chooseTheme(h, next.packageId);
		expect(h.document.getElementById('appearancePanel').textContent).toContain(zh.appearanceMigration);
		expect(h.document.querySelector('[data-theme-setting=size]').value).toBe('14');
	});

	it('cancels trust without a PUT and asks only once per package after acceptance', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		h.window.showConfirmDialog.mockResolvedValueOnce(false);
		await act(h, 'apply');
		expect(putBodies(h)).toHaveLength(0);
		expect(control(h, 'apply').disabled).toBe(false);
		await act(h, 'apply');
		expect(putBodies(h)).toHaveLength(1);
		editColor(h, '#123123');
		await act(h, 'apply');
		expect(putBodies(h)).toHaveLength(2);
		expect(h.window.showConfirmDialog.mock.calls.map(([options]) => options.i18n.message)).toEqual([
			'appearanceAppTrust',
			'appearanceAppTrust',
		]);
	});

	it('publishes another app package without mounting it and refreshes the page right away', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.window.applyAppearance = vi.fn();
		const applied = vi.fn();
		h.window.addEventListener('appearance-applied', applied);
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'blocked' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(h.window.applyAppearance).not.toHaveBeenCalled();
		expect(applied).toHaveBeenCalledOnce();
		expect(h.window.__2FA_APPEARANCE__.packageId).toBe(app.packageId);
		// The refresh starts without another click; a blocked one keeps the manual way out.
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledOnce();
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledWith('theme-change');
		expect(h.document.getElementById('appearanceModal').style.display).toBe('block');
		expect(status(h).textContent).toContain(zh.moduleRefreshBlocked);
		expect(control(h, 'refresh-runtime')).not.toBeNull();
		await act(h, 'refresh-runtime');
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledTimes(2);
	});

	it('waits for a save that is still finishing and then refreshes without a click', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi
			.fn()
			.mockResolvedValueOnce({ status: 'rejected', reason: 'unsaved-or-pending' })
			.mockResolvedValueOnce({ status: 'completed', reason: 'reload-requested' });
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		await vi.waitFor(() => expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledTimes(2));
		expect(h.window.requestAppearanceRuntimeReload.mock.calls.map(([reason]) => reason)).toEqual(['theme-change', 'theme-change']);
		expect(h.document.getElementById('appearanceModal').style.display).not.toBe('block');
	});

	it('stops waiting after a few seconds and keeps the manual refresh', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'rejected', reason: 'unsaved-or-pending' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		try {
			await act(h, 'apply');
			await vi.waitFor(() => expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalled());
			for (let i = 0; i < 40; i++) {
				await vi.advanceTimersByTimeAsync(250);
			}
		} finally {
			vi.useRealTimers();
		}
		await vi.waitFor(() => expect(status(h).textContent).toContain(zh.moduleRefreshBlocked));
		// One attempt, then one every 250 ms for 8 seconds.
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledTimes(33);
		expect(h.document.getElementById('appearanceModal').style.display).toBe('block');
		expect(control(h, 'refresh-runtime')).not.toBeNull();
		expect(h.document.getElementById('appearanceApplying').hidden).toBe(true);
	});

	it('takes a waiting app update in the refresh after applying', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.network.serviceWorker = { getRegistration: async () => ({ waiting: {} }) };
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'completed' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(h.window.requestAppearanceRuntimeReload.mock.calls.map(([reason]) => reason)).toEqual(['update']);
	});

	it('closes the settings dialog it was opened from so the refresh is not blocked', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		const settings = h.document.createElement('div');
		settings.id = 'settingsModal';
		h.document.body.append(settings);
		h.window.showModal('settingsModal');
		h.window.applyAppearance = vi.fn();
		// Like the host guard: any open dialog blocks the reload.
		h.window.requestAppearanceRuntimeReload = vi.fn(async () =>
			settings.style.display === 'block'
				? { status: 'rejected', reason: 'unsaved-or-pending' }
				: { status: 'completed', reason: 'reload-requested' },
		);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledOnce();
		expect(settings.style.display).toBe('none');
	});

	it('keeps a settings dialog with unsaved changes open', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		const settings = h.document.createElement('div');
		settings.id = 'settingsModal';
		h.document.body.append(settings);
		h.window.showModal('settingsModal');
		h.window.hasUnsavedSettingsChanges = () => true;
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'completed' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(settings.style.display).toBe('block');
	});

	it('falls back to a plain refresh when the waiting update cannot be taken', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.network.serviceWorker = { getRegistration: async () => ({ waiting: {} }) };
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async (reason) =>
			reason === 'update' ? { status: 'rejected', reason: 'runtime-update-blocked' } : { status: 'completed' },
		);
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(h.window.requestAppearanceRuntimeReload.mock.calls.map(([reason]) => reason)).toEqual(['update', 'theme-change']);
		expect(h.document.getElementById('appearanceModal').style.display).not.toBe('block');
	});

	it('closes the editor when the refresh after applying another package goes ahead', async () => {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app]);
		h.window.applyAppearance = vi.fn();
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'completed' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledWith('theme-change');
		expect(h.document.getElementById('appearanceModal').style.display).not.toBe('block');
		// The page is about to be replaced; the cover stays until it is.
		expect(h.document.getElementById('appearanceApplying').hidden).toBe(false);
		expect(h.document.getElementById('appearanceApplying').textContent).toBe(zh.appearanceApplying);
	});

	it('covers the page from the click and removes the cover when saving fails', async () => {
		const app = await appTheme();
		const h = harness();
		let release;
		network(h, [getBuiltinTheme('document'), app], {
			extra: (url, options) =>
				url === '/api/appearance' && options.method === 'PUT'
					? new Promise((resolve) => {
							release = () => resolve(json({ error: 'failed' }, 500));
						})
					: null,
		});
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'completed' }));
		h.window.localizeAppearanceError = () => 'failed';
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		await act(h, 'apply');
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		expect(h.document.getElementById('appearanceApplying').hidden).toBe(false);
		release();
		await vi.waitFor(() => expect(h.document.getElementById('appearanceApplying').hidden).toBe(true));
		expect(h.window.requestAppearanceRuntimeReload).not.toHaveBeenCalled();
	});

	it('updates the running app configuration in place when the package does not change', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		previewPort(h);
		h.window.applyAppearance = vi.fn();
		await h.window.showAppearanceEditor();
		editColor(h, '#123456');
		await act(h, 'apply');
		expect(h.window.applyAppearance).toHaveBeenCalledWith(expect.objectContaining({ settings: { accent: '#123456' } }));
		expect(status(h).textContent).toBe(zh.appearanceApplied);
		expect(control(h, 'refresh-runtime')).toBeNull();
	});
});

describe('editor opaque preview integration', () => {
	it('opens once, updates settings/mode/width without capability churn and closes synchronously', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		expect(port.open).toHaveBeenLastCalledWith(
			expect.objectContaining({ packageId: app.packageId, language: 'zh-CN', scene: 'workspace' }),
		);
		editColor(h, '#123456');
		await act(h, 'mode', 'dark');
		await act(h, 'width', 390);
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		expect(port.update).toHaveBeenLastCalledWith(
			expect.objectContaining({ appearance: { settings: { accent: '#123456' } }, mode: 'dark' }),
		);
		expect(h.document.querySelector('#appearanceAppPreview iframe').style.width).toBe('390px');
		await act(h, 'close');
		expect(h.window.showConfirmDialog).toHaveBeenCalledOnce();
		expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
		expect(port.close).toHaveBeenCalled();
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(port.open).toHaveBeenCalledTimes(2);
	});

	it('shows preview expiry with a refresh action while preserving the editable draft', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		editColor(h, '#abcdef');
		port.status({ status: 'blocked', reason: 'preview-expired' });
		expect(previewStatus(h).hidden).toBe(false);
		expect(previewStatus(h).textContent).toContain(zh.appearancePreviewExpired);
		await act(h, 'refresh-preview');
		expect(port.open).toHaveBeenCalledTimes(2);
		expect(previewStatus(h).hidden).toBe(true);
		expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#abcdef');
	});

	it('reports a failed preview without blocking edits', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		port.open.mockRejectedValueOnce(new Error('preview unavailable'));
		await h.window.showAppearanceEditor();
		await tickPreview();
		expect(previewStatus(h).textContent).toContain('preview unavailable');
		editColor(h, '#abcdef');
		expect(control(h, 'apply').disabled).toBe(false);
	});

	it('stops the preview and blocks writes when the session is invalidated', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		editColor(h, '#abcdef');
		port.invalidateSession();
		expect(port.close).toHaveBeenCalled();
		expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
		expect(control(h, 'apply').disabled).toBe(true);
		expect(status(h).textContent).toBe(zh.loginModalDesc);
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		expect(previewStatus(h).textContent).toContain(zh.appearancePreviewBlocked);
	});

	it('stops the preview while offline and reopens it after reconnecting', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		await h.window.showAppearanceEditor();
		await tickPreview();
		h.network.onLine = false;
		h.window.dispatchEvent(new h.window.Event('offline'));
		expect(port.close).toHaveBeenCalled();
		expect(previewStatus(h).textContent).toContain(zh.appearancePreviewOffline);
		editColor(h, '#abcdef');
		await tickPreview();
		expect(port.open).toHaveBeenCalledOnce();
		h.network.onLine = true;
		h.window.dispatchEvent(new h.window.Event('online'));
		await flush();
		editColor(h, '#abcdee');
		await tickPreview();
		expect(port.open).toHaveBeenCalledTimes(2);
		expect(control(h, 'apply').disabled).toBe(false);
	});

	it('ignores a late preview rejection after the editor closes', async () => {
		const app = await appTheme();
		const h = harness({ theme: app });
		network(h, [app]);
		const port = previewPort(h);
		let fail;
		port.open.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					fail = reject;
				}),
		);
		await h.window.showAppearanceEditor();
		await tickPreview();
		await act(h, 'close');
		fail(new Error('old preview rejected'));
		await flush();
		expect(previewStatus(h).textContent).not.toContain('old preview rejected');
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
/** Installs the fixture the way a catalog download does and exposes the store's HTTP API. */
async function themeStore(app, headers = {}) {
	const store = new ThemeStore(
		{ storage: new MemoryStorage() },
		{ SECRETS_KV: { get: async () => null, put: async () => {}, delete: async () => {} } },
	);
	await store.install({ bytes: app.fixture.archive, name: '2fa-theme.zip', expectedPackageId: app.packageId });
	return (url, options = {}) =>
		store.fetch(
			new Request('https://example.com' + url, {
				...options,
				headers: { [THEME_OPERATION_HEADER]: 'api', ...headers, ...options.headers },
			}),
		);
}

it('publishes the actual editor app payload through storage HTTP and preserves saved settings on reload', async () => {
	const app = await appTheme();
	const req = await themeStore(app);
	const h = harness();
	h.initial.revision = 0;
	h.window.authenticatedFetch.mockImplementation((url, options) => req(url, options));
	await h.window.showAppearanceEditor();
	await chooseTheme(h, app.packageId);
	editColor(h, '#102030');
	await act(h, 'apply');
	await vi.waitFor(() => expect(status(h).textContent).toContain(zh.appearancePublishedReload));
	const published = await (await req('/api/appearance')).json();
	expect(published.revision).toBe(1);
	expect(published.active.settings.accent).toBe('#102030');
	expect(h.window.__2FA_APPEARANCE__.settings.accent).toBe('#102030');
	const payload = putBodies(h)[0];
	expect(payload).toMatchObject({ expectedRevision: 0, packageId: app.packageId, settings: { accent: '#102030' } });
	expect(await (await req('/api/appearance', { method: 'PUT', body: JSON.stringify(payload) })).json()).toMatchObject({
		revision: 1,
		replayed: true,
	});
	h.window.dispatchEvent(new h.window.CustomEvent('appearance-updated-elsewhere', { detail: { revision: 1 } }));
	await act(h, 'reload');
	expect(h.document.querySelector('[data-theme-setting=accent]').value).toBe('#102030');
	expect(control(h, 'apply').disabled).toBe(true);
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
	const req = await themeStore(app, { [THEME_PREVIEW_OWNER_HEADER]: 'a'.repeat(64) });
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
	const capabilityRequests = () => h.window.authenticatedFetch.mock.calls.filter(([url]) => url === '/api/themes/preview-capabilities');
	const revoked = (id) =>
		expect(h.window.authenticatedFetch).toHaveBeenCalledWith(
			'/api/themes/preview-capabilities/' + id,
			expect.objectContaining({ method: 'DELETE' }),
		);
	await h.window.showAppearanceEditor();
	await chooseTheme(h, app.packageId);
	// The real store and capability client are slower than the debounce under a loaded test run.
	const mounted = () => vi.waitFor(() => expect(h.document.querySelector('#appearanceAppPreview iframe')).not.toBeNull());
	await mounted();
	const frame = h.document.querySelector('#appearanceAppPreview iframe');
	expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
	expect(frame.hasAttribute('credentialless')).toBe(true);
	expect(frame.srcdoc).toContain(cap.entryUrl);
	expect(frame.srcdoc).toContain('import(config.entryUrl)');
	expect(frame.srcdoc).not.toContain('allow-same-origin');
	expect(frame.srcdoc).not.toContain('/api/secrets');
	expect(capabilityRequests()).toHaveLength(1);
	editColor(h, '#334455');
	await tickPreview();
	expect(capabilityRequests()).toHaveLength(1);
	await act(h, 'apply');
	await vi.waitFor(() => expect(status(h).textContent).toContain(zh.appearancePublishedReload));
	expect(h.document.querySelector('#appearanceAppPreview iframe')).not.toBeNull();
	expect(capabilityRequests()).toHaveLength(1);
	await act(h, 'close');
	expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
	revoked(cap.capabilityId);
	delayed = true;
	await h.window.showAppearanceEditor();
	await vi.waitFor(() => expect(release).toBeTypeOf('function'));
	const late = cap.capabilityId;
	await act(h, 'close');
	release();
	await vi.waitFor(() => revoked(late));
	expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
	delayed = false;
	await h.window.showAppearanceEditor();
	await mounted();
	invalidateSession();
	expect(h.document.querySelector('#appearanceAppPreview iframe')).toBeNull();
	expect(control(h, 'apply').disabled).toBe(true);
});

describe('switching only to a theme that is ready', () => {
	async function switching(prepare, { failRestore = false } = {}) {
		const app = await appTheme();
		const h = harness();
		network(h, [getBuiltinTheme('document'), app], {
			extra: async (url, options) => {
				if (failRestore && url === '/api/appearance' && options.method === 'PUT' && JSON.parse(options.body).packageId !== app.packageId) {
					return json({ error: 'Unavailable' }, 503);
				}
				return null;
			},
		});
		h.window.applyAppearance = vi.fn();
		h.window.prepareAppearanceRuntime = vi.fn(prepare);
		h.window.requestAppearanceRuntimeReload = vi.fn(async () => ({ status: 'completed' }));
		await h.window.showAppearanceEditor();
		await chooseTheme(h, app.packageId);
		return { h, app };
	}
	const cover = (h) => h.document.getElementById('appearanceApplying');

	it('reloads once the saved theme is downloaded and checked', async () => {
		const { h, app } = await switching(async () => ({ status: 'ready' }));
		await act(h, 'apply');
		expect(h.window.prepareAppearanceRuntime).toHaveBeenCalledOnce();
		expect(h.window.prepareAppearanceRuntime.mock.calls[0][0].packageId).toBe(app.packageId);
		expect(putBodies(h)).toHaveLength(1);
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledWith('theme-change');
	});

	it('shows the download while the theme is prepared', async () => {
		let finish;
		const { h } = await switching(() => new Promise((resolve) => (finish = resolve)));
		const applying = act(h, 'apply');
		await vi.waitFor(() => expect(h.window.prepareAppearanceRuntime).toHaveBeenCalled());
		expect(cover(h).hidden).toBe(false);
		expect(cover(h).textContent).toBe(zh.appearanceDownloading);
		expect(h.window.requestAppearanceRuntimeReload).not.toHaveBeenCalled();
		finish({ status: 'ready' });
		await applying;
		await vi.waitFor(() => expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalled());
	});

	it('saves the running theme back and stays when the theme cannot be prepared', async () => {
		const { h, app } = await switching(async () => ({ status: 'blocked', reason: 'resource-integrity' }));
		const running = h.window.__2FA_APPEARANCE__;
		await act(h, 'apply');
		await vi.waitFor(() => expect(status(h).textContent).toContain(zh.appearanceNotReady));
		const [, restore] = putBodies(h);
		expect(restore.packageId).toBe(running.packageId);
		expect(restore.settings).toEqual(running.settings);
		expect(restore.expectedRevision).toBe(2);
		expect(h.window.__2FA_APPEARANCE__.packageId).toBe(running.packageId);
		expect(h.window.requestAppearanceRuntimeReload).not.toHaveBeenCalled();
		expect(cover(h).hidden).toBe(true);
		expect(control(h, 'refresh-runtime')).toBeNull();
		// The chosen theme stays selected for another try.
		const pressed = [...h.document.querySelectorAll('.appearance-theme-card[aria-pressed="true"]')].map((node) => node.dataset.package);
		expect(pressed).toEqual([app.packageId]);
	});

	it('gives up after a minute and saves the running theme back', async () => {
		const { h } = await switching(() => new Promise(() => {}));
		const running = h.window.__2FA_APPEARANCE__;
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		try {
			await act(h, 'apply');
			// vi.waitFor would advance the fake clock itself.
			await vi.advanceTimersByTimeAsync(0);
			expect(h.window.prepareAppearanceRuntime).toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(59999);
			expect(putBodies(h)).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1);
		} finally {
			vi.useRealTimers();
		}
		await vi.waitFor(() => expect(status(h).textContent).toContain(zh.appearanceNotReady));
		expect(putBodies(h)[1].packageId).toBe(running.packageId);
		expect(h.window.requestAppearanceRuntimeReload).not.toHaveBeenCalled();
	});

	it('keeps the manual refresh when the running theme cannot be saved back', async () => {
		const { h } = await switching(async () => ({ status: 'blocked' }), { failRestore: true });
		await act(h, 'apply');
		await vi.waitFor(() => expect(control(h, 'refresh-runtime')).not.toBeNull());
		expect(status(h).dataset.error).toBe('true');
		expect(h.window.requestAppearanceRuntimeReload).not.toHaveBeenCalled();
		expect(cover(h).hidden).toBe(true);
	});

	it('switches as before where nothing can be prepared', async () => {
		const { h } = await switching(async () => null);
		await act(h, 'apply');
		expect(putBodies(h)).toHaveLength(1);
		expect(h.window.requestAppearanceRuntimeReload).toHaveBeenCalledWith('theme-change');
	});

	it('keeps the saved theme and takes the waiting update where the worker predates 2.0', async () => {
		const { h, app } = await switching(async () => ({ status: 'blocked', reason: 'legacy-worker' }));
		h.network.serviceWorker = { getRegistration: async () => ({ waiting: {} }) };
		await act(h, 'apply');
		expect(putBodies(h)).toHaveLength(1);
		expect(putBodies(h)[0].packageId).toBe(app.packageId);
		expect(h.window.requestAppearanceRuntimeReload.mock.calls.map(([reason]) => reason)).toEqual(['update']);
		expect(status(h).textContent).not.toContain(zh.appearanceNotReady);
	});
});
