/* global structuredClone */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { THEME_OPERATION_HEADER, runThemeAutoUpdate } from '../../src/api/themes.js';
import { normalizeDetectedThemeImport } from '../../src/themes/import.js';
import { hashBytes } from '../../src/themes/schema.js';
import { appThemeFixture } from '../helpers/app-theme.js';

class Storage {
	data = new Map();
	alarm = null;
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
	async getAlarm() {
		return this.alarm;
	}
	async setAlarm(time) {
		this.alarm = time;
	}
	async transaction(callback) {
		const saved = structuredClone(this.data);
		try {
			return await callback(this);
		} catch (error) {
			this.data = saved;
			throw error;
		}
	}
}

const revision = 'c'.repeat(40);
const root = 'https://raw.githubusercontent.com/wuzf/2fa-theme-mytheme/';
const refUrl = 'https://api.github.com/repos/wuzf/2fa-theme-mytheme/git/ref/heads/main';
const officialSource = (id) => `${root}${revision}/themes/${id}/2fa-theme.zip`;
const settingsV1 = [
	{
		key: 'accent',
		type: 'select',
		label: 'Accent',
		default: 'green',
		options: [
			{ value: 'green', label: 'Green' },
			{ value: 'rose', label: 'Rose' },
		],
	},
];

async function version(number, options = {}) {
	const fixture = await appThemeFixture(
		{ 'entry.js': `export const mount = () => {}; // ${number}` },
		{ id: 'pixel-for-2fa', name: 'Pixel', version: number, settings: settingsV1, ...options },
	);
	const pkg = await normalizeDetectedThemeImport({ bytes: fixture.archive });
	return { archive: fixture.archive, pkg };
}

/** Serves the official catalog listing one build of the theme. */
async function serveCatalog(build) {
	const entry = {
		id: build.pkg.manifest.id,
		kind: 'app',
		name: build.pkg.manifest.name,
		version: build.pkg.manifest.version,
		description: '',
		author: 'Theme author',
		packageId: build.pkg.packageId,
		path: `themes/${build.pkg.manifest.id}/2fa-theme.zip`,
		sha256: await hashBytes(build.archive),
		size: build.archive.length,
	};
	const fetcher = vi.fn(async (url) => {
		if (url === refUrl) {
			return Response.json({ object: { type: 'commit', sha: revision } });
		}
		if (url === `${root}${revision}/catalog.json`) {
			return Response.json({ schemaVersion: 1, themes: [entry] });
		}
		if (url === `${root}${revision}/${entry.path}`) {
			return new Response(build.archive);
		}
		return new Response('Not found', { status: 404 });
	});
	vi.stubGlobal('fetch', fetcher);
	return fetcher;
}

function harness() {
	const storage = new Storage();
	const store = new ThemeStore({ storage }, {});
	const request = (path, { method = 'GET', body, operation = 'api' } = {}) =>
		store.fetch(
			new Request('https://vault.example.com' + path, {
				method,
				headers: { [THEME_OPERATION_HEADER]: operation, 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
	const install = (build, source = officialSource(build.pkg.manifest.id)) =>
		store.enqueue(() => store.install({ bytes: build.archive, name: '2fa-theme.zip', sourceUrl: source }));
	const activate = (build, settings) =>
		store.enqueue(async () =>
			store.commitAppearance({
				packageId: build.pkg.packageId,
				expectedRevision: (await store.state()).revision,
				operationId: crypto.randomUUID(),
				...(settings ? { settings } : {}),
			}),
		);
	const enable = () => request('/api/themes/auto-update', { method: 'PUT', body: { enabled: true } });
	const disable = () => request('/api/themes/auto-update', { method: 'PUT', body: { enabled: false } });
const run = async () => (await request('/api/themes/auto-update', { method: 'POST', operation: 'auto-update' })).json();
	const installed = async () => (await store.listThemes('app')).themes.map((theme) => theme.packageId);
	const active = async () => (await store.readAppearance()).active;
	return { storage, store, request, install, activate, enable, disable, run, installed, active };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('theme auto-update setting', () => {
	it('is on by default, stays off once turned off, and stores only a boolean switch', async () => {
		const h = harness();
		expect(await (await h.request('/api/themes/auto-update')).json()).toEqual({ enabled: true, history: [] });
		expect((await h.request('/api/themes/auto-update', { method: 'PUT', body: { enabled: 'yes' } })).status).toBe(400);
		expect((await h.request('/api/themes/auto-update', { method: 'PUT', body: { enabled: true, history: [] } })).status).toBe(400);
		expect(await (await h.disable()).json()).toEqual({ enabled: false, history: [] });
		expect(await (await h.request('/api/themes/auto-update')).json()).toEqual({ enabled: false, history: [] });
		expect(await (await h.enable()).json()).toEqual({ enabled: true, history: [] });
		expect(await (await h.request('/api/themes/auto-update')).json()).toEqual({ enabled: true, history: [] });
	});

	it('runs on an instance that never touched the switch', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		const fetcher = await serveCatalog(await version('1.1.0'));
		expect((await h.run()).enabled).toBe(true);
		expect(fetcher).toHaveBeenCalled();
	});

	it('cannot be started through the authenticated API', async () => {
		const h = harness();
		expect((await h.request('/api/themes/auto-update', { method: 'POST' })).status).toBe(404);
		expect((await h.request('/api/themes/auto-update', { operation: 'auto-update' })).status).toBe(404);
	});

	it('does nothing while it is off', async () => {
		const h = harness();
		await h.disable();
		const old = await version('1.0.0');
		await h.install(old);
		const fetcher = await serveCatalog(await version('1.1.0'));
		expect(await h.run()).toEqual({ enabled: false, results: [] });
		expect(fetcher).not.toHaveBeenCalled();
		expect(await h.installed()).toEqual([old.pkg.packageId]);
	});
});

describe('theme auto-update run', () => {
	it('switches the theme in use to the new version and keeps its settings', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		await h.activate(old, { accent: 'rose' });
		const next = await version('1.1.0');
		await serveCatalog(next);
		await h.enable();
		const revision = (await h.active()).revision;
		const result = await h.run();
		expect(result.results).toMatchObject([{ id: 'pixel-for-2fa', from: '1.0.0', to: '1.1.0', status: 'applied' }]);
		expect(await h.installed()).toEqual([next.pkg.packageId]);
		expect(await h.active()).toMatchObject({ packageId: next.pkg.packageId, settings: { accent: 'rose' }, revision: revision + 1 });
	});

	it('gives a setting added in the new version its default', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		await h.activate(old, { accent: 'rose' });
		const added = { key: 'compact', type: 'boolean', label: 'Compact', default: true };
		const next = await version('1.1.0', { settings: [...settingsV1, added] });
		await serveCatalog(next);
		await h.enable();
		expect((await h.run()).results[0].status).toBe('applied');
		expect((await h.active()).settings).toEqual({ accent: 'rose', compact: true });
	});

	it('only installs a theme that is not in use', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		const next = await version('1.1.0');
		await serveCatalog(next);
		await h.enable();
		expect((await h.run()).results[0].status).toBe('installed');
		expect(await h.installed()).toEqual([next.pkg.packageId]);
		expect((await h.active()).packageId).toBe('builtin:fluent');
	});

	it('leaves uploads and themes from the owner’s catalogs alone', async () => {
		for (const source of [null, 'https://raw.githubusercontent.com/someone/themes/' + revision + '/themes/pixel-for-2fa/2fa-theme.zip']) {
			const h = harness();
			const old = await version('1.0.0');
			await h.install(old, source);
			await serveCatalog(await version('1.1.0'));
			await h.enable();
			expect((await h.run()).results).toEqual([]);
			expect(await h.installed()).toEqual([old.pkg.packageId]);
		}
	});

	it('does nothing when the installed build is the listed one', async () => {
		const h = harness();
		const current = await version('1.0.0');
		await h.install(current);
		await serveCatalog(current);
		await h.enable();
		expect((await h.run()).results).toEqual([]);
		expect((await h.request('/api/themes/auto-update')).status).toBe(200);
		expect((await (await h.request('/api/themes/auto-update')).json()).history).toEqual([]);
	});

	it.each([
		['host-version', { minHostVersion: '999.0.0' }, false],
		['capabilities', { capabilities: ['accounts'] }, false],
		['settings', { settings: [{ ...settingsV1[0], options: [{ value: 'green', label: 'Green' }] }] }, true],
	])('leaves an update that needs the owner (%s) to be done by hand', async (reason, options, inUse) => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		if (inUse) {
			await h.activate(old, { accent: 'rose' });
		}
		await serveCatalog(await version('1.1.0', options));
		await h.enable();
		expect((await h.run()).results).toMatchObject([{ to: '1.1.0', status: 'skipped', reason }]);
		expect(await h.installed()).toEqual([old.pkg.packageId]);
		if (inUse) {
			expect((await h.active()).packageId).toBe(old.pkg.packageId);
		}
	});

	it('records a repeated skip once, newest first, and keeps the switch', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		await serveCatalog(await version('1.1.0', { minHostVersion: '999.0.0' }));
		await h.enable();
		await h.run();
		await h.run();
		const stored = await (await h.request('/api/themes/auto-update')).json();
		expect(stored.enabled).toBe(true);
		expect(stored.history).toHaveLength(1);
		expect(stored.history[0]).toMatchObject({ id: 'pixel-for-2fa', name: 'Pixel', from: '1.0.0', to: '1.1.0', reason: 'host-version' });
	});

	it('drops a skip once the owner updated the theme by hand, and keeps past updates', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		await h.storage.put('theme:auto-update', {
			enabled: true,
			history: [{ id: 'pixel-for-2fa', name: 'Pixel', from: '0.9.0', to: '1.0.0', status: 'installed', at: 1 }],
		});
		const next = await version('1.1.0', { minHostVersion: '999.0.0' });
		await serveCatalog(next);
		await h.run();
		expect((await (await h.request('/api/themes/auto-update')).json()).history.map((item) => item.status)).toEqual([
			'skipped',
			'installed',
		]);
		const manual = await version('1.1.0', { minHostVersion: '0.0.1' });
		await h.install(manual);
		await serveCatalog(manual);
		expect((await h.run()).results).toEqual([]);
		expect((await (await h.request('/api/themes/auto-update')).json()).history).toMatchObject([{ to: '1.0.0', status: 'installed' }]);
	});

	it('reports a failed download and leaves the installed version', async () => {
		const h = harness();
		const old = await version('1.0.0');
		await h.install(old);
		const fetcher = await serveCatalog(await version('1.1.0'));
		const serve = fetcher.getMockImplementation();
		fetcher.mockImplementation(async (url) => (url.endsWith('2fa-theme.zip') ? new Response('gone', { status: 404 }) : serve(url)));
		await h.enable();
		expect((await h.run()).results).toMatchObject([{ status: 'failed' }]);
		expect(await h.installed()).toEqual([old.pkg.packageId]);
	});
});

describe('scheduled entry', () => {
	it('is skipped without the theme store', async () => {
		expect(await runThemeAutoUpdate({})).toBeNull();
	});

	it('runs on the appearance object through its internal operation', async () => {
		const fetch = vi.fn(async () => Response.json({ enabled: false, results: [] }));
		const env = { SECRETS_STORE: { idFromName: vi.fn(() => 'id'), get: vi.fn(() => ({ fetch })) } };
		expect(await runThemeAutoUpdate(env)).toEqual({ enabled: false, results: [] });
		expect(env.SECRETS_STORE.idFromName).toHaveBeenCalledWith('appearance:v1');
		const [request] = fetch.mock.calls[0];
		expect(request.method).toBe('POST');
		expect(request.headers.get(THEME_OPERATION_HEADER)).toBe('auto-update');
	});
});
