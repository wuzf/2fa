/* global structuredClone */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { THEME_OPERATION_HEADER, THEME_PREVIEW_OWNER_HEADER } from '../../src/api/themes.js';
import { normalizeAsset } from '../../src/themes/index.js';
import { appThemeFixture, appPng, encodeAppText } from '../helpers/app-theme.js';
import { APP_VERSION } from '../../src/utils/version.js';
import { publicThemeFixture } from '../helpers/public-appearance.js';

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
function harness() {
	const storage = new Storage();
	const mirrors = new Map();
	const env = {
		SECRETS_KV: {
			get: vi.fn(async (key) => mirrors.get(key)),
			put: vi.fn(async (key, value) => mirrors.set(key, value)),
			delete: vi.fn(async (key) => mirrors.delete(key)),
		},
	};
	const store = new ThemeStore({ storage }, env);
	const request = (path, options = {}) => {
		const { body, method = body === undefined ? 'GET' : 'POST', operation = 'api', headers = {} } = options;
		return store.fetch(
			new Request('https://vault.example.com' + path, {
				method,
				headers: { [THEME_OPERATION_HEADER]: operation, ...headers },
				body,
				...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
			}),
		);
	};
	const json = (path, body, method) =>
		request(path, { body: JSON.stringify(body), method, headers: { 'Content-Type': 'application/json' } });
	const install = async (fixture) => {
		const result = await store.enqueue(() => store.install({ bytes: fixture.archive, name: 'theme.zip' }));
		return JSON.parse(JSON.stringify(result.theme));
	};
	return { storage, store, env, request, json, install };
}
const v1Zip = (css, id = 'legacy') => ({
	name: 'theme.zip',
	bytes: zipSync({
		'2fa-theme.json': encodeAppText(JSON.stringify({ themeApiVersion: 1, id, name: 'Legacy', version: '1.0.0', styles: 'theme.css' })),
		'theme.css': encodeAppText(css),
	}),
});
const apply = (packageId, expectedRevision = 0) => ({ packageId, expectedRevision, operationId: crypto.randomUUID() });
const privateFile = (pkg, path = 'entry.js') => `/api/themes/${pkg.packageId}/files/${path}`;
const publicFile = (pkg, path = 'entry.js') => `/theme-packages/${pkg.packageId}/${path}`;
async function expireBlobs(storage) {
	for (const [key, value] of await storage.list({ prefix: 'theme:blob:' })) {
		await storage.put(key, { ...value, expiresAt: 0, nextAttemptAt: 0 });
	}
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const ownerA = 'a'.repeat(64),
	ownerB = 'b'.repeat(64);
const preview = (h, body, owner = ownerA) =>
	h.request('/api/themes/preview-capabilities', {
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json', [THEME_PREVIEW_OWNER_HEADER]: owner },
	});
const revoke = (h, id, owner = ownerA) =>
	h.request('/api/themes/preview-capabilities/' + id, {
		method: 'DELETE',
		headers: { [THEME_PREVIEW_OWNER_HEADER]: owner },
	});
const previewFile = (h, cap, path = 'entry.js', options = {}) =>
	h.request(cap.baseUrl + path, {
		operation: 'preview',
		headers: { Origin: 'null' },
		...options,
	});

describe('theme installation contract', () => {
	it('installs app packages without publishing or executing them', async () => {
		const h = harness();
		const theme = await h.install(
			await appThemeFixture({ 'entry.js': 'throw new Error("do not execute on import"); export const mount=()=>{};' }),
		);
		expect(theme).toMatchObject({ kind: 'app', manifest: { themeApiVersion: 2 } });
		expect((await h.request(privateFile(theme))).status).toBe(200);
		expect((await h.request(publicFile(theme), { operation: 'public' })).status).toBe(404);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		expect((await (await h.request('/api/themes')).json()).themes.some((pkg) => pkg.packageId === theme.packageId)).toBe(false);
		expect((await (await h.request('/api/themes?format=app')).json()).themes.map((pkg) => pkg.packageId)).toEqual([theme.packageId]);
	});

	it('continues installing v1 zip packages', async () => {
		const h = harness();
		const manifest = { themeApiVersion: 1, id: 'legacy-http', name: 'Legacy', version: '1.0.0', styles: 'theme.css' };
		const theme = await h.install({
			archive: zipSync({ '2fa-theme.json': encodeAppText(JSON.stringify(manifest)), 'theme.css': encodeAppText('body{color:red}') }),
		});
		expect(theme.manifest.themeApiVersion).toBe(1);
		expect((await (await h.request('/api/themes')).json()).themes.some((pkg) => pkg.packageId === theme.packageId)).toBe(true);
		expect((await (await h.request('/api/themes?format=app')).json()).themes).toEqual([]);
	});

	it('rejects damaged app bytes before writing package, blob, or quota records', async () => {
		const h = harness();
		const source = await appThemeFixture();
		const archive = zipSync({
			'2fa-theme.json': encodeAppText(JSON.stringify(source.manifest)),
			'entry.js': encodeAppText('export const changed=true;'),
		});
		await expect(h.install({ archive })).rejects.toMatchObject({ code: 'THEME_APP_HASH' });
		expect((await h.storage.list({ prefix: 'theme:package:' })).size).toBe(0);
		expect((await h.storage.list({ prefix: 'theme:blob:' })).size).toBe(0);
		expect(await h.storage.get('theme:quota')).toBeUndefined();
	});
});

describe('app appearance publication', () => {
	it('enforces declared host compatibility for preview, HTTP and internal publish before publication', async () => {
		const h = harness();
		const future = await h.install(await appThemeFixture(undefined, { minHostVersion: '999.0.0' }));
		await expect(h.store.applyInstalledAppearance(apply(future.packageId))).rejects.toMatchObject({
			code: 'THEME_HOST_VERSION_UNSUPPORTED',
		});
		const refused = await h.json('/api/appearance', apply(future.packageId), 'PUT');
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({ error: 'THEME_HOST_VERSION_UNSUPPORTED' });
		expect(await (await preview(h, { packageId: future.packageId })).json()).toMatchObject({ error: 'THEME_HOST_VERSION_UNSUPPORTED' });
		expect(await h.store.previews.pins()).toEqual([]);
		expect((await h.request(publicFile(future), { operation: 'public' })).status).toBe(404);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		const compatible = await h.install(await appThemeFixture(undefined, { minHostVersion: APP_VERSION + '-preview.10+theme-build' }));
		const accepted = await h.json('/api/appearance', apply(compatible.packageId), 'PUT');
		expect(accepted.status).toBe(200);
		expect((await accepted.json()).revision).toBe(1);
	});

	it('atomically publishes all registered files and settings through HTTP with idempotent receipts', async () => {
		const h = harness();
		const pkg = await h.install(
			await appThemeFixture(
				{
					'entry.js': "export const detail=()=>import('./chunks/detail.js');",
					'chunks/detail.js': 'export const ok=true;',
					'assets/logo.png': appPng,
				},
				{ settings: [{ key: 'title', type: 'text', default: 'Default' }] },
			),
		);
		const body = { ...apply(pkg.packageId), settings: { title: 'Pixel' } };
		const committed = await h.json('/api/appearance', body, 'PUT');
		expect(committed.status).toBe(200);
		const saved = await committed.json();
		expect(saved).toMatchObject({ revision: 1, active: { kind: 'app', package: { id: pkg.manifest.id } } });
		expect(saved.active.settings.title).toBe('Pixel');
		expect(saved.active.files.map((file) => file.path)).toEqual(pkg.files.map((file) => file.path));
		for (const file of saved.active.files) {
			expect((await h.request(file.url, { operation: 'public' })).status).toBe(200);
		}
		const replayed = await h.json('/api/appearance', body, 'PUT');
		expect(replayed.status).toBe(200);
		expect(await replayed.json()).toMatchObject({ revision: 1, replayed: true, active: saved.active });
		const reused = await h.json('/api/appearance', { ...body, settings: { title: 'different' } }, 'PUT');
		expect(reused.status).toBe(409);
		expect(await reused.json()).toMatchObject({ error: 'THEME_OPERATION_REUSED' });
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
	});

	it('rolls publication marks back on transaction failure and admits only one competing expected revision', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const mark = h.store.markAppPackagePublic.bind(h.store);
		const injected = vi.spyOn(h.store, 'markAppPackagePublic').mockImplementation(async (tx, id, publication) => {
			await mark(tx, id, publication);
			throw new Error('publication interrupted');
		});
		await expect(h.store.applyInstalledAppearance(apply(pkg.packageId))).rejects.toThrow('publication interrupted');
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
		injected.mockRestore();
		const results = await Promise.all([
			h.json('/api/appearance', apply(pkg.packageId), 'PUT'),
			h.json('/api/appearance', apply(pkg.packageId), 'PUT'),
		]);
		expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
		expect(await results.find((result) => result.status === 409).json()).toMatchObject({ error: 'THEME_REVISION_CONFLICT' });
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
	});

	it.each([
		['missing-chunk', 'THEME_ASSET_INCOMPLETE'],
		['changed-chunk', 'THEME_HASH_MISMATCH'],
		['short-chunk', 'THEME_ASSET_INCOMPLETE'],
		['missing-role', 'THEME_ASSET_INCOMPLETE'],
		['not-ready', 'THEME_ASSET_INCOMPLETE'],
		['wrong-size', 'THEME_ASSET_INCOMPLETE'],
		['changed-document', 'THEME_HASH_MISMATCH'],
		['changed-inventory', 'THEME_HASH_MISMATCH'],
		['changed-document-pointer', 'THEME_HASH_MISMATCH'],
	])('rejects %s introduced after preparation without publishing any references', async (damage, code) => {
		const h = harness();
		// Damage the second chunk so checking only the entry file's first chunk
		// cannot accidentally satisfy the publication integrity contract.
		const source = await appThemeFixture({ 'entry.js': 'export const ready=true;/*' + 'x'.repeat(128 * 1024) + '*/' });
		const pkg = await h.install(source);
		const file = pkg.files[0];
		const record = await h.storage.get('theme:package:' + pkg.packageId);
		const before = await (await h.request('/api/appearance')).json();
		const body = apply(pkg.packageId);
		const prepare = h.store.prepareAppAppearance.bind(h.store);
		vi.spyOn(h.store, 'prepareAppAppearance').mockImplementation(async (input, options) => {
			const result = await prepare(input, options);
			const key = 'theme:chunk:' + file.hash + ':1';
			const bytes = await h.storage.get(key);
			if (damage === 'missing-chunk') {
				await h.storage.delete(key);
			} else if (damage === 'changed-chunk') {
				bytes[0] ^= 1;
				await h.storage.put(key, bytes);
			} else if (damage === 'short-chunk') {
				await h.storage.put(key, bytes.slice(1));
			} else if (['missing-role', 'not-ready', 'wrong-size'].includes(damage)) {
				const metaKey = 'theme:blob:' + file.hash;
				const meta = await h.storage.get(metaKey);
				if (damage === 'missing-role') {
					meta.kind = 'document';
					meta.kinds = ['document'];
				} else if (damage === 'not-ready') {
					meta.status = 'writing';
				} else {
					meta.size += 1;
				}
				await h.storage.put(metaKey, meta);
			} else if (damage === 'changed-document-pointer') {
				const replacement = await h.store.saveDocument({ ...pkg, manifest: { ...pkg.manifest, name: 'Replacement' } });
				await h.storage.put('theme:package:' + pkg.packageId, { ...record, document: replacement.hash });
			} else {
				const documentKey = 'theme:chunk:' + record.document + ':0';
				const original = new TextDecoder().decode(await h.storage.get(documentKey));
				// Preserve length and valid JSON: parsing alone would miss this edit.
				const modified =
					damage === 'changed-inventory'
						? original.replaceAll('entry.js', 'other.js')
						: original.replace('App storage test', 'Bad storage test');
				expect(modified.length).toBe(original.length);
				expect(modified).not.toBe(original);
				await h.storage.put(documentKey, encodeAppText(modified));
			}
			return result;
		});
		const response = await h.json('/api/appearance', body, 'PUT');
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: code });
		expect(await (await h.request('/api/appearance')).json()).toEqual(before);
		expect((await h.storage.get('theme:package:' + pkg.packageId)).public).toBe(false);
		expect(await h.storage.get('theme:receipt:' + body.operationId)).toBeUndefined();
		expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
	});

	it.each([false, true])('cannot reuse a preparation context after a completed or failed publication (failure=%s)', async (failure) => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		let publication;
		const prepare = h.store.prepareAppAppearance.bind(h.store);
		vi.spyOn(h.store, 'prepareAppAppearance').mockImplementation(async (input, options) => {
			publication = options.publication;
			const result = await prepare(input, options);
			if (failure) {
				throw new Error('preparation interrupted');
			}
			return result;
		});
		const body = apply(pkg.packageId);
		const response = await h.json('/api/appearance', body, 'PUT');
		expect(response.status).toBe(failure ? 500 : 200);
		await expect(h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId, publication))).rejects.toMatchObject({
			code: 'THEME_HASH_MISMATCH',
		});
		const current = await (await h.request('/api/appearance')).json();
		expect(current.revision).toBe(failure ? 0 : 1);
		if (!failure) {
			expect(current.active.packageId).toBe(pkg.packageId);
			expect(await (await h.json('/api/appearance', body, 'PUT')).json()).toMatchObject({
				revision: 1,
				replayed: true,
				active: current.active,
			});
		}
	});

	it('serializes deletion and garbage collection behind preparation and preserves newly published bytes', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		let release, prepared;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const started = new Promise((resolve) => {
			prepared = resolve;
		});
		const prepare = h.store.prepareAppAppearance.bind(h.store);
		vi.spyOn(h.store, 'prepareAppAppearance').mockImplementation(async (input, options) => {
			const result = await prepare(input, options);
			await expireBlobs(h.storage);
			prepared();
			await held;
			return result;
		});
		const publication = h.json('/api/appearance', apply(pkg.packageId), 'PUT');
		await started;
		let deleted = false,
			collected = false;
		const deletion = h.request('/api/themes/' + pkg.packageId, { method: 'DELETE' }).then((response) => {
			deleted = true;
			return response;
		});
		const collection = h.store.alarm().then(() => {
			collected = true;
		});
		try {
			expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
			expect(deleted).toBe(false);
			expect(collected).toBe(false);
			expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
		} finally {
			release();
		}
		expect((await publication).status).toBe(200);
		expect((await deletion).status).toBe(409);
		await collection;
		expect((await (await h.request('/api/appearance')).json()).active).toMatchObject({ revision: 1, packageId: pkg.packageId });
		expect((await h.storage.get('theme:blob:' + pkg.files[0].hash)).status).toBe('ready');
		expect(await (await h.request(publicFile(pkg), { operation: 'public' })).text()).toBe('export const mount = () => {};');
	});

	it('preserves separate same-ID profiles for v1 and app themes', async () => {
		const h = harness();
		await h.store.applyInstalledAppearance(apply('builtin:fluent'));
		const pkg = await h.install(
			await appThemeFixture({ 'entry.js': 'export{}' }, { id: 'fluent', settings: [{ key: 'title', type: 'text', default: 'Default' }] }),
		);
		await h.store.applyInstalledAppearance({ ...apply(pkg.packageId, 1), settings: { title: 'App' } });
		const legacyState = await h.storage.get('theme:state');
		expect(Object.keys(legacyState.profiles).sort()).toEqual(['app:fluent', 'v1:fluent']);
		const official = (await (await h.request('/api/themes')).json()).themes.find((theme) => theme.manifest.id === 'fluent');
		expect(official.profile.packageId).toBe('builtin:fluent');
		const app = (await (await h.request('/api/themes?format=app')).json()).themes.find((theme) => theme.manifest.id === 'fluent');
		expect(app.profile).toMatchObject({ packageId: pkg.packageId, settings: { title: 'App' } });
	});

	it('retains app file blobs referenced by receipts after package deletion until those receipts expire', async () => {
		const h = harness();
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const first=true;' }));
		await h.store.applyInstalledAppearance(apply(first.packageId));
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const second=true;' }, { version: '2.0.0' }));
		await h.store.applyInstalledAppearance(apply(second.packageId, 1));
		await h.store.applyInstalledAppearance(apply('builtin:fluent', 2));
		await h.store.applyInstalledAppearance(apply('builtin:document', 3));
		expect((await h.request(`/api/themes/${first.packageId}`, { method: 'DELETE' })).status).toBe(200);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + first.files[0].hash)).toBeDefined();
		for (const [key, receipt] of await h.storage.list({ prefix: 'theme:receipt:' })) {
			await h.storage.put(key, { ...receipt, expiresAt: 0 });
		}
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + first.files[0].hash)).toBeUndefined();
		expect((await h.request(privateFile(second))).status).toBe(200);
	});
});

describe('one installed build per theme', () => {
	it('replaces the listed build while preserving active and receipt resources', async () => {
		const h = harness();
		const settings = [{ key: 'title', type: 'text', default: 'Default' }];
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=1;' }, { settings }));
		const original = await h.store.applyInstalledAppearance({ ...apply(first.packageId), settings: { title: 'Keep me' } });
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=2;' }, { version: '2.0.0', settings }));
		const list = await h.store.listThemes('app');
		expect(list.themes.map((theme) => theme.packageId)).toEqual([second.packageId]);
		expect(list.themes[0].profile.settings.title).toBe('Keep me');
		expect((await h.store.readAppearance()).active).toEqual(original.active);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect((await h.request(publicFile(first), { operation: 'public' })).status).toBe(200);
		await h.store.applyInstalledAppearance(apply(second.packageId, 1));
		expect((await h.store.listThemes('app')).themes.map((theme) => theme.packageId)).toEqual([second.packageId]);
	});

	it('allows replacement at the theme limit but rejects a new identity', async () => {
		const h = harness();
		for (let index = 0; index < 20; index++) {
			await h.install(await appThemeFixture(undefined, { id: 'theme-' + index }));
		}
		const replacement = await h.install(await appThemeFixture({ 'entry.js': 'export const updated=true;' }, { id: 'theme-0' }));
		expect((await h.store.listThemes('app')).themes).toHaveLength(20);
		expect((await h.store.listThemes('app')).themes.find((theme) => theme.manifest.id === 'theme-0').packageId).toBe(replacement.packageId);
		const extra = await appThemeFixture(undefined, { id: 'theme-20' });
		await expect(h.install(extra)).rejects.toMatchObject({ status: 413, code: 'THEME_VERSION_CAPACITY' });
	});

	it('does not bypass the theme limit when reinstalling a hidden package retained by the running appearance', async () => {
		const h = harness();
		const original = await appThemeFixture({ 'entry.js': 'export const old=true;' }, { id: 'retained-theme' });
		const first = await h.install(original);
		await h.store.applyInstalledAppearance(apply(first.packageId));
		const latest = await h.install(await appThemeFixture({ 'entry.js': 'export const updated=true;' }, { id: 'retained-theme' }));
		await h.store.deletePackage(latest.packageId);
		for (let index = 0; index < 20; index++) {
			await h.install(await appThemeFixture(undefined, { id: 'other-' + index }));
		}
		expect(await h.storage.get('theme:package:' + first.packageId)).toMatchObject({ superseded: true });
		await expect(h.install(original)).rejects.toMatchObject({ status: 413, code: 'THEME_VERSION_CAPACITY' });
		expect((await h.store.listThemes('app')).themes).toHaveLength(20);
		expect((await h.store.readAppearance()).active.packageId).toBe(first.packageId);
		expect((await h.request(publicFile(first), { operation: 'public' })).status).toBe(200);
	});

	it('keeps the old selectable build when replacement validation or the final transaction fails', async () => {
		const h = harness();
		const first = await h.install(await appThemeFixture());
		const replacement = await appThemeFixture({ 'entry.js': 'export const changed=true;' });
		await expect(
			h.store.install({ bytes: replacement.archive, name: 'theme.zip', expectedPackageId: '0'.repeat(64) }),
		).rejects.toMatchObject({ code: 'THEME_CATALOG_CHANGED' });
		const originalPut = h.storage.put.bind(h.storage);
		vi.spyOn(h.storage, 'put').mockImplementation(async (key, value) => {
			if (key.startsWith('theme:package:') && value.status === 'ready') {
				throw new Error('transaction failed');
			}
			return originalPut(key, value);
		});
		await expect(h.store.install({ bytes: replacement.archive, name: 'theme.zip' })).rejects.toThrow('transaction failed');
		expect((await h.store.listThemes('app')).themes.map((theme) => theme.packageId)).toEqual([first.packageId]);
		expect(await h.storage.get('theme:package:' + first.packageId)).not.toHaveProperty('superseded', true);
	});

	it('migrates legacy duplicate builds and reclaims their unreferenced bytes without deleting shared files', async () => {
		const h = harness();
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=1;', 'shared.json': '{}' }));
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=2;', 'shared.json': '{}' }));
		for (const [index, pkg] of [first, second].entries()) {
			const key = 'theme:package:' + pkg.packageId;
			const record = await h.storage.get(key);
			delete record.identity;
			delete record.superseded;
			delete record.retireAfter;
			await h.storage.put(key, { ...record, installedAt: index + 1 });
		}
		expect((await h.store.listThemes('app')).themes.map((theme) => theme.packageId)).toEqual([second.packageId]);
		await h.store.alarm();
		expect(await h.storage.get('theme:package:' + first.packageId)).toBeUndefined();
		expect(await h.storage.get('theme:blob:' + first.files.find((file) => file.path === 'entry.js').hash)).toBeUndefined();
		expect((await h.request(privateFile(second, 'shared.json'))).status).toBe(200);
	});

	it.each([false, true])('does not resurrect legacy history after deleting the latest build (older build active: %s)', async (active) => {
		const h = harness();
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=1;' }));
		if (active) {
			await h.store.applyInstalledAppearance(apply(first.packageId));
		}
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=2;' }));
		for (const [index, pkg] of [first, second].entries()) {
			const key = 'theme:package:' + pkg.packageId;
			const record = await h.storage.get(key);
			delete record.identity;
			delete record.superseded;
			delete record.retireAfter;
			await h.storage.put(key, { ...record, installedAt: index + 1 });
		}
		expect((await h.store.listThemes('app')).themes.map((theme) => theme.packageId)).toEqual([second.packageId]);
		const response = await h.request('/api/themes/' + second.packageId, { method: 'DELETE' });
		expect(response.status).toBe(200);
		expect((await h.store.listThemes('app')).themes).toEqual([]);
		await h.store.alarm();
		expect((await h.store.listThemes('app')).themes).toEqual([]);
		if (active) {
			expect((await h.store.readAppearance()).active.packageId).toBe(first.packageId);
			expect((await h.request(publicFile(first), { operation: 'public' })).status).toBe(200);
		} else {
			expect(await h.storage.get('theme:package:' + first.packageId)).toBeUndefined();
		}
	});

	it('pins an older preview until it is closed and prevents repeated replacement from retaining every package', async () => {
		const h = harness();
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const generation=0;' }));
		const cap = await (await preview(h, { packageId: first.packageId })).json();
		for (let index = 1; index < 5; index++) {
			await h.install(await appThemeFixture({ 'entry.js': `export const generation=${index};` }));
		}
		await h.store.alarm();
		expect((await h.storage.list({ prefix: 'theme:package:' })).size).toBe(2);
		expect(await (await previewFile(h, cap)).text()).toBe('export const generation=0;');
		await revoke(h, cap.capabilityId);
		await h.store.alarm();
		expect((await h.storage.list({ prefix: 'theme:package:' })).size).toBe(1);
		expect(await h.storage.get('theme:blob:' + first.files[0].hash)).toBeUndefined();
	});

	it('keeps v1 and app identities separate when both formats use the same id', async () => {
		const h = harness();
		const app = await h.install(await appThemeFixture(undefined, { id: 'cross-format' }));
		const manifest = { themeApiVersion: 1, id: 'cross-format', name: 'Cross format', version: '1.0.0', styles: 'theme.css' };
		const v1 = (css) => ({
			name: 'theme.zip',
			bytes: zipSync({ '2fa-theme.json': encodeAppText(JSON.stringify(manifest)), 'theme.css': encodeAppText(css) }),
		});
		await h.store.install(v1('body{color:red}'));
		const replaced = await h.store.install(v1('body{color:blue}'));
		expect((await h.store.listThemes('app')).themes.map((theme) => theme.packageId)).toEqual([app.packageId]);
		expect((await h.store.listThemes()).themes.filter((theme) => !theme.builtIn).map((theme) => theme.packageId)).toEqual([
			replaced.theme.packageId,
		]);
	});

	it('releases an obsolete saved profile when the latest theme is deleted', async () => {
		const h = harness();
		const first = await h.install(await appThemeFixture());
		await h.store.applyInstalledAppearance(apply(first.packageId));
		await h.store.applyInstalledAppearance(apply('builtin:fluent', 1));
		await h.store.applyInstalledAppearance(apply('builtin:document', 2));
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const updated=true;' }));
		expect((await h.storage.get('theme:state')).profiles).toHaveProperty('app:storage-test');
		await h.store.deletePackage(second.packageId);
		expect((await h.storage.get('theme:state')).profiles).not.toHaveProperty('app:storage-test');
	});

	it('reclaims retired published bytes after the grace period and receipt expiry', async () => {
		let now = Date.now();
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const h = harness();
		const first = await h.install(await appThemeFixture({ 'entry.js': 'export const old=true;' }));
		await h.store.applyInstalledAppearance(apply(first.packageId));
		const second = await h.install(await appThemeFixture({ 'entry.js': 'export const current=true;' }));
		await h.store.applyInstalledAppearance(apply(second.packageId, 1));
		await h.store.applyInstalledAppearance(apply('builtin:fluent', 2));
		await h.store.applyInstalledAppearance(apply('builtin:document', 3));
		await h.store.alarm();
		expect((await h.request(publicFile(first), { operation: 'public' })).status).toBe(200);
		now += 24 * 60 * 60 * 1000 + 1;
		await h.store.alarm();
		expect(await h.storage.get('theme:package:' + first.packageId)).toBeUndefined();
		expect(await h.storage.get('theme:blob:' + first.files[0].hash)).toBeUndefined();
		expect((await h.request(publicFile(second), { operation: 'public' })).status).toBe(200);
	});
});

describe('opaque preview capability resources', () => {
	it('returns a fixed package/resource scope and grants anonymous null-origin bytes without publishing it', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture({ 'entry.js': 'export{}', 'assets/logo.png': appPng }));
		const response = await preview(h, { packageId: pkg.packageId });
		expect(response.status).toBe(201);
		const cap = await response.json();
		expect(cap.capabilityId).toMatch(/^[a-f0-9]{64}$/);
		expect(cap.appearance).toMatchObject({ kind: 'app', revision: null, package: { id: pkg.manifest.id }, baseUrl: cap.baseUrl });
		expect(cap.appearance.files.every((file) => file.url.startsWith(cap.baseUrl))).toBe(true);
		const resource = await previewFile(h, cap);
		expect(await resource.text()).toBe('export{}');
		expect(resource.headers.get('Access-Control-Allow-Origin')).toBe('null');
		expect(resource.headers.has('Access-Control-Allow-Credentials')).toBe(false);
		expect(resource.headers.get('Cache-Control')).toBe('no-store');
		expect(resource.headers.get('Content-Type')).toBe('text/javascript');
		expect(resource.headers.get('Referrer-Policy')).toBe('no-referrer');
		expect((await previewFile(h, cap, 'missing.js')).status).toBe(404);
		expect((await previewFile(h, cap, '%65ntry.js')).status).toBe(404);
		for (const headers of [{ Cookie: 'auth=x' }, { Authorization: 'Bearer token' }, { Origin: 'https://elsewhere.example' }]) {
			expect((await previewFile(h, cap, 'entry.js', { headers })).status).toBe(403);
		}
		expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
	});

	it('enforces per-owner two-capability and six-creation limits without renewal and frees slots after revoke or fixed expiry', async () => {
		let now = Date.now();
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const first = await (await preview(h, { packageId: pkg.packageId })).json();
		const second = await (await preview(h, { packageId: pkg.packageId })).json();
		expect(await (await preview(h, { packageId: pkg.packageId })).json()).toMatchObject({ error: 'THEME_PREVIEW_CAPACITY' });
		const other = await (await preview(h, { packageId: pkg.packageId }, ownerB)).json();
		expect(other.capabilityId).toBeDefined();
		expect((await revoke(h, first.capabilityId, ownerB)).status).toBe(404);
		expect((await revoke(h, first.capabilityId)).status).toBe(200);
		expect((await previewFile(h, first)).status).toBe(410);
		await revoke(h, second.capabilityId);
		for (let index = 0; index < 4; index++) {
			const cap = await (await preview(h, { packageId: pkg.packageId })).json();
			await revoke(h, cap.capabilityId);
		}
		expect(await (await preview(h, { packageId: pkg.packageId })).json()).toMatchObject({ error: 'THEME_RATE_LIMIT' });
		now += 60001;
		const fixed = await (await preview(h, { packageId: pkg.packageId })).json();
		now = fixed.expiresAt - 1;
		expect((await previewFile(h, fixed, 'entry.js', { method: 'HEAD' })).status).toBe(200);
		expect((await h.storage.get('theme:preview:' + fixed.capabilityId)).expiresAt).toBe(fixed.expiresAt);
		now++;
		expect((await previewFile(h, fixed)).status).toBe(410);
		expect((await preview(h, { packageId: pkg.packageId })).status).toBe(201);
	});

	it('pins package resources and blocks package deletion until preview revoke/logout or expiry', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const cap = await (await preview(h, { packageId: pkg.packageId })).json();
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + pkg.files[0].hash)).toBeDefined();
		expect((await h.request(`/api/themes/${pkg.packageId}`, { method: 'DELETE' })).status).toBe(409);
		const other = await (await preview(h, { packageId: pkg.packageId }, ownerB)).json();
		await h.request('/api/logout', { method: 'POST', operation: 'preview-logout', headers: { [THEME_PREVIEW_OWNER_HEADER]: ownerA } });
		expect((await previewFile(h, cap)).status).toBe(410);
		expect((await previewFile(h, other)).status).toBe(200);
		await revoke(h, other.capabilityId, ownerB);
		expect((await h.request(`/api/themes/${pkg.packageId}`, { method: 'DELETE' })).status).toBe(200);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + pkg.files[0].hash)).toBeUndefined();
	});

	it('rejects a capability read that finishes after revocation and releases failed preparations without pin/quota leaks', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const cap = await (await preview(h, { packageId: pkg.packageId })).json();
		let entered, release;
		const started = new Promise((resolve) => {
				entered = resolve;
			}),
			gate = new Promise((resolve) => {
				release = resolve;
			});
		const originalRead = h.store.appFileBytes.bind(h.store);
		const paused = vi.spyOn(h.store, 'appFileBytes').mockImplementation(async (...args) => {
			entered();
			await gate;
			return originalRead(...args);
		});
		const reading = previewFile(h, cap);
		await started;
		await revoke(h, cap.capabilityId);
		release();
		expect((await reading).status).toBe(410);
		paused.mockRestore();
		await h.storage.put('theme:quota', { bytes: 50 * 1024 * 1024 });
		expect(await (await preview(h, { packageId: pkg.packageId })).json()).toMatchObject({ error: 'THEME_CAPACITY' });
		expect(await h.store.previews.pins()).toEqual([]);
		expect((await h.storage.get('theme:quota')).bytes).toBe(50 * 1024 * 1024);
	});
});

describe('app theme storage and publication boundary', () => {
	it('separates app installation/listing from v1 while permitting HTTP app publish', async () => {
		const h = harness(),
			source = await appThemeFixture();
		const pkg = await h.install(source);
		expect(pkg).toMatchObject({ kind: 'app', assets: [] });
		expect(pkg.files[0]).not.toHaveProperty('bytes');
		expect((await (await h.request('/api/themes')).json()).themes).toHaveLength(3);
		expect((await (await h.request('/api/themes?format=app')).json()).themes.map((theme) => theme.packageId)).toEqual([pkg.packageId]);
		const applied = await h.json('/api/appearance', apply(pkg.packageId), 'PUT');
		expect(applied.status).toBe(200);
		expect(await applied.json()).toMatchObject({ revision: 1, active: { kind: 'app', packageId: pkg.packageId } });
		// An ordinary v1 apply still works after an app package was published.
		expect((await h.json('/api/appearance', apply('builtin:document', 1), 'PUT')).status).toBe(200);
	});

	it('does not attach a saved v1 profile to an app package with the same manifest id', async () => {
		const h = harness();
		await h.json('/api/appearance', apply('builtin:fluent'), 'PUT');
		await h.install(await appThemeFixture(undefined, { id: 'fluent' }));
		const official = (await (await h.request('/api/themes')).json()).themes.find((theme) => theme.manifest.id === 'fluent');
		expect(official.profile.packageId).toBe('builtin:fluent');
		const app = (await (await h.request('/api/themes?format=app')).json()).themes[0];
		expect(app).not.toHaveProperty('profile');
	});

	it('serves only exact installed private files and publishes only within a successful internal transaction', async () => {
		const h = harness();
		const source = await appThemeFixture({
			'entry.js': "export const lazy=()=>import('./chunks/detail.js');",
			'chunks/detail.js': 'export const value=42;',
		});
		const pkg = await h.install(source),
			path = publicFile(pkg);
		const privateResponse = await h.request(privateFile(pkg));
		expect(await privateResponse.text()).toBe(new TextDecoder().decode(source.files.get('entry.js')));
		expect(privateResponse.headers.get('Content-Type')).toBe('text/javascript');
		expect(privateResponse.headers.get('Cache-Control')).toBe('private, no-store');
		expect(privateResponse.headers.has('Access-Control-Allow-Origin')).toBe(false);
		expect((await h.request(path, { operation: 'public' })).status).toBe(404);
		await expect(
			h.storage.transaction(async (tx) => {
				await h.store.markAppPackagePublic(tx, pkg.packageId);
				await tx.put('theme:publication-test', 'uncommitted');
				throw new Error('snapshot CAS lost');
			}),
		).rejects.toThrow('snapshot CAS lost');
		expect(await h.storage.get('theme:publication-test')).toBeUndefined();
		expect((await h.request(path, { operation: 'public' })).status).toBe(404);
		await h.storage.transaction(async (tx) => {
			await h.store.markAppPackagePublic(tx, pkg.packageId);
			await tx.put('theme:publication-test', 'committed');
		});
		const response = await h.request(path, { operation: 'public' });
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain('immutable');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
		const etag = response.headers.get('ETag');
		expect(await (await h.request(publicFile(pkg, 'chunks/detail.js'), { operation: 'public' })).text()).toBe('export const value=42;');
		expect((await h.request(path, { operation: 'public', headers: { 'If-None-Match': etag } })).status).toBe(304);
		const head = await h.request(path, { operation: 'public', method: 'HEAD' });
		expect(await head.text()).toBe('');
		expect(head.headers.get('Content-Length')).toBe(String(source.files.get('entry.js').length));
		for (const suffix of ['missing.js', '2fa-theme.json', '%65ntry.js', 'chunks//detail.js']) {
			expect((await h.request(publicFile(pkg, suffix), { operation: 'public' })).status).toBe(404);
		}
		expect((await h.request(path, { operation: 'public', method: 'POST' })).status).toBe(404);
		await h.install(source);
		expect((await h.request(path, { operation: 'public' })).status).toBe(200);
	});

	it('validates app bytes against the inventory even on HEAD and conditional reads', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
		const file = pkg.files[0];
		await h.storage.put(`theme:chunk:${file.hash}:0`, new Uint8Array(file.size).fill(32));
		for (const method of ['GET', 'HEAD']) {
			const response = await h.request(publicFile(pkg), { method, operation: 'public', headers: { 'If-None-Match': `"${file.hash}"` } });
			expect(response.status).toBe(503);
		}
		await expect(h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId))).rejects.toMatchObject({
			code: 'THEME_HASH_MISMATCH',
		});
		await h.storage.put(`theme:chunk:${file.hash}:0`, new Uint8Array(file.size - 1));
		expect((await h.request(privateFile(pkg))).status).toBe(503);
	});

	it.each(['asset-first', 'app-first'])(
		'deduplicates shared font/image bytes while retaining independent asset metadata (%s)',
		async (order) => {
			const h = harness();
			const font = new Uint8Array(48);
			font.set(encodeAppText('wOF2'));
			new DataView(font.buffer).setUint32(8, font.length);
			const source = await appThemeFixture({ 'entry.js': 'export{}', 'fonts/pixel.woff2': font, 'assets/logo.png': appPng });
			const imageAsset = await normalizeAsset(appPng, 'logo.png'),
				fontAsset = await normalizeAsset(font, 'font.woff2');
			const saveAssets = async () => {
				await h.store.saveBlob(imageAsset);
				await h.store.saveBlob(fontAsset);
			};
			if (order === 'asset-first') {
				await saveAssets();
			}
			const pkg = await h.install(source);
			if (order === 'app-first') {
				await saveAssets();
			}
			for (const asset of [imageAsset, fontAsset]) {
				const resolved = await h.store.resolveAsset(asset.hash);
				expect(resolved.name).toBe(asset.name);
				expect(resolved.mime).toBe(asset.mime);
				expect(resolved.bytes).toEqual(asset.bytes);
				expect((await h.request(`/api/appearance/assets/${asset.hash}`)).headers.get('Content-Type')).toBe(asset.mime);
			}
			const before = (await h.storage.get('theme:quota')).bytes;
			await saveAssets();
			await h.install(source);
			expect((await h.storage.get('theme:quota')).bytes).toBe(before);
			expect((await h.json('/api/appearance', apply('builtin:fluent'), 'PUT')).status).toBe(200);
			await expireBlobs(h.storage);
			await h.store.alarm();
			expect(h.env.SECRETS_KV.put).toHaveBeenCalledWith('theme-assets:v1:' + fontAsset.hash, font);
			const response = await h.request(publicFile(pkg, 'fonts/pixel.woff2'), { operation: 'public' });
			expect(response.status).toBe(404);
			await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
			expect((await h.request(publicFile(pkg, 'fonts/pixel.woff2'), { operation: 'public' })).headers.get('Content-Type')).toBe(
				'font/woff2',
			);
		},
	);

	it.each(['document-first', 'app-first'])(
		'retains document/app roles without exposing either through the v1 asset endpoints (%s)',
		async (order) => {
			const h = harness(),
				data = { value: 'shared JSON' };
			if (order === 'document-first') {
				await h.store.saveDocument(data);
			}
			const pkg = await h.install(await appThemeFixture({ 'entry.js': 'export{}', 'data.json': JSON.stringify(data) }));
			const document = await h.store.saveDocument(data);
			expect(await h.store.readDocument(document.hash)).toEqual(data);
			expect(await (await h.request(privateFile(pkg, 'data.json'))).json()).toEqual(data);
			await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
			for (const file of pkg.files) {
				expect((await h.request(`/api/appearance/assets/${file.hash}`)).status).toBe(404);
				expect((await h.request(`/theme-assets/${file.hash}/file.json`, { operation: 'public' })).status).toBe(404);
			}
		},
	);

	it('shares quota and retains deduplicated blobs across app installs', async () => {
		const h = harness();
		const a = await h.install(await appThemeFixture()),
			b = await h.install(await appThemeFixture(undefined, { id: 'second-shared', version: '1.0.1' }));
		const shared = a.files[0].hash;
		for (let index = 0; index < 18; index++) {
			await h.store.install(v1Zip(`body { color: #${index.toString(16).padStart(6, '0')} }`, 'v1-' + index));
		}
		await expect(h.install(await appThemeFixture(undefined, { id: 'third-shared', version: '1.0.2' }))).rejects.toMatchObject({
			code: 'THEME_VERSION_CAPACITY',
		});
		expect((await h.request(`/api/themes/${a.packageId}`, { method: 'DELETE' })).status).toBe(200);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + shared)).toBeDefined();
		expect((await h.request(privateFile(b))).status).toBe(200);
		await h.request(`/api/themes/${b.packageId}`, { method: 'DELETE' });
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + shared)).toBeUndefined();
		await h.storage.put('theme:quota', { bytes: 50 * 1024 * 1024 });
		await expect(h.install(await appThemeFixture({ 'entry.js': 'export const newCode=true;' }))).rejects.toMatchObject({
			code: 'THEME_CAPACITY',
		});
		expect((await h.storage.list({ prefix: 'theme:package:' })).size).toBe(18);
	});

	it('allows published reads and serializes writes during a suspended catalog install request', async () => {
		const h = harness(),
			source = await appThemeFixture(),
			pkg = await h.install(source);
		await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('unavailable', { status: 503 })),
		);
		const selection = encodeAppText(JSON.stringify({ id: 'catalog-theme', packageId: pkg.packageId }));
		let producer;
		const body = new ReadableStream({
			start(controller) {
				producer = controller;
				controller.enqueue(selection.subarray(0, 10));
			},
		});
		const pending = h.request('/api/themes/catalog/install', { body, headers: { 'Content-Type': 'application/json' } });
		let applied = false;
		const writing = h.json('/api/appearance', apply('builtin:fluent'), 'PUT').then((response) => {
			applied = true;
			return response;
		});
		try {
			await vi.waitFor(async () => expect((await h.storage.get('theme:rate:import')).length).toBe(1));
			const reads = await Promise.race([
				Promise.all([h.request('/api/appearance'), h.request(privateFile(pkg)), h.request(publicFile(pkg), { operation: 'public' })]),
				new Promise((_, reject) => setTimeout(() => reject(new Error('read blocked by upload')), 1000)),
			]);
			expect(reads.map((response) => response.status)).toEqual([200, 200, 200]);
			expect(applied).toBe(false);
		} finally {
			producer.enqueue(selection.subarray(10));
			producer.close();
		}
		expect((await pending).status).toBeGreaterThanOrEqual(400);
		expect((await writing).status).toBe(200);
	});

	it('protects a materializing app read from deletion and blob GC until its response owns the bytes', async () => {
		const h = harness(),
			fixture = await appThemeFixture(),
			pkg = await h.install(fixture);
		await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
		let enter, release;
		const entered = new Promise((resolve) => {
			enter = resolve;
		});
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		const originalGet = h.storage.get.bind(h.storage);
		let paused = false;
		h.storage.get = async (key) => {
			if (!paused && key === `theme:chunk:${pkg.files[0].hash}:0`) {
				paused = true;
				enter();
				await gate;
			}
			return originalGet(key);
		};
		const pendingRead = h.request(publicFile(pkg), { operation: 'public' });
		await entered;
		const removal = vi.spyOn(h.store, 'removeBlob');
		let gc;
		try {
			expect((await h.request(`/api/themes/${pkg.packageId}`, { method: 'DELETE' })).status).toBe(200);
			await expireBlobs(h.storage);
			gc = h.store.alarm();
			await vi.waitFor(() => expect(removal).toHaveBeenCalled());
			expect(await originalGet('theme:blob:' + pkg.files[0].hash)).toBeDefined();
		} finally {
			release();
		}
		expect(await (await pendingRead).text()).toBe(new TextDecoder().decode(fixture.files.get('entry.js')));
		await gc;
		expect(await originalGet('theme:blob:' + pkg.files[0].hash)).toBeUndefined();
		expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
	});
});

describe('public static appearance publication', () => {
	it('derives settings on the server, atomically publishes font inventory and restores it on reapplication', async () => {
		const h = harness(),
			pkg = await h.install(await publicThemeFixture());
		const fontUrl = publicFile(pkg, 'fonts/test.woff2');
		expect((await h.request(fontUrl, { operation: 'public' })).status).toBe(404);
		const body = { ...apply(pkg.packageId), settings: { accent: 'blue' } };
		const response = await h.json('/api/appearance', body, 'PUT');
		expect(response.status).toBe(200);
		const saved = await response.json();
		expect(saved.active.publicAppearance.light.accent).toBe('#123456');
		expect(saved.active.publicAppearance.fonts[0]).toMatchObject({
			url: fontUrl,
			hash: pkg.files.find((f) => f.path === 'fonts/test.woff2').hash,
		});
		expect((await h.request(fontUrl, { operation: 'public' })).status).toBe(200);
		const forged = await h.json(
			'/api/appearance',
			{ ...apply(pkg.packageId, 1), publicAppearance: { light: { accent: '#ff0000' } } },
			'PUT',
		);
		expect(forged.status).toBe(400);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
		const updated = await h.json('/api/appearance', { ...apply(pkg.packageId, 1), settings: { handwriting: false } }, 'PUT');
		expect((await updated.json()).active.publicAppearance.fonts).toHaveLength(0);
		const reapplied = await h.json('/api/appearance', { ...apply(pkg.packageId, 2), settings: { accent: 'blue' } }, 'PUT');
		expect((await reapplied.json()).active.publicAppearance).toEqual(saved.active.publicAppearance);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect((await h.request(fontUrl, { operation: 'public' })).status).toBe(200);
	});

	it('keeps preview fonts capability-bound and never marks unpublished package files public', async () => {
		const h = harness(),
			pkg = await h.install(await publicThemeFixture());
		const capability = await (await preview(h, { packageId: pkg.packageId, settings: {} })).json();
		expect(capability.appearance.publicAppearance.fonts[0].url).toBe(capability.baseUrl + 'fonts/test.woff2');
		expect((await previewFile(h, capability, 'fonts/test.woff2')).status).toBe(200);
		expect((await h.request(publicFile(pkg, 'fonts/test.woff2'), { operation: 'public' })).status).toBe(404);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		await revoke(h, capability.capabilityId);
		expect((await previewFile(h, capability, 'fonts/test.woff2')).status).toBe(410);
	});

	it.each(['public-appearance.json', 'fonts/test.woff2'])(
		'rejects changed %s bytes after preparation without partial public state',
		async (path) => {
			const h = harness(),
				pkg = await h.install(await publicThemeFixture());
			const before = await (await h.request('/api/appearance')).json();
			const file = pkg.files.find((f) => f.path === path),
				prepare = h.store.prepareAppAppearance.bind(h.store);
			vi.spyOn(h.store, 'prepareAppAppearance').mockImplementation(async (input, options) => {
				const result = await prepare(input, options);
				const key = 'theme:chunk:' + file.hash + ':0',
					bytes = await h.storage.get(key);
				bytes[bytes.length - 1] ^= 1;
				await h.storage.put(key, bytes);
				return result;
			});
			const body = apply(pkg.packageId),
				response = await h.json('/api/appearance', body, 'PUT');
			expect(response.status).toBe(503);
			expect(await (await h.request('/api/appearance')).json()).toEqual(before);
			expect(await h.storage.get('theme:receipt:' + body.operationId)).toBeUndefined();
			expect((await h.request(publicFile(pkg, 'fonts/test.woff2'), { operation: 'public' })).status).toBe(404);
		},
	);

	it('preserves publication atomicity, CAS and historical snapshots without implicit migration', async () => {
		const h = harness(),
			pkg = await h.install(await publicThemeFixture());
		const mark = h.store.markAppPackagePublic.bind(h.store);
		const interrupted = vi.spyOn(h.store, 'markAppPackagePublic').mockImplementation(async (...args) => {
			await mark(...args);
			throw new Error('interrupted');
		});
		await expect(h.store.applyInstalledAppearance(apply(pkg.packageId))).rejects.toThrow('interrupted');
		expect((await h.request(publicFile(pkg, 'fonts/test.woff2'), { operation: 'public' })).status).toBe(404);
		interrupted.mockRestore();
		const responses = await Promise.all([
			h.json('/api/appearance', apply(pkg.packageId), 'PUT'),
			h.json('/api/appearance', apply(pkg.packageId), 'PUT'),
		]);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
		const saved = await (await h.request('/api/appearance')).json();
		const legacy = { ...saved.active };
		delete legacy.publicAppearance;
		const document = await h.store.saveDocument(legacy),
			state = await h.storage.get('theme:state');
		await h.storage.put('theme:state', { ...state, active: document.hash });
		const read = await (await h.request('/api/appearance')).json();
		expect(read.revision).toBe(1);
		expect(read.active).not.toHaveProperty('publicAppearance');
		const reapplied = await (await h.json('/api/appearance', apply(pkg.packageId, 1), 'PUT')).json();
		expect(reapplied.revision).toBe(2);
		expect(reapplied.active.publicAppearance.fonts).toHaveLength(1);
	});
});
