/* global structuredClone */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { THEME_OPERATION_HEADER, THEME_PREVIEW_OWNER_HEADER } from '../../src/api/themes.js';
import { normalizeAppThemeImport, exportAppTheme, normalizeAsset } from '../../src/themes/index.js';
import { appThemeFixture, appPng, encodeAppText } from '../helpers/app-theme.js';
import { APP_VERSION } from '../../src/utils/version.js';

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
		const response = await request('/api/themes/import?format=app', { body: fixture.archive });
		expect(response.status).toBe(201);
		return (await response.json()).theme;
	};
	return { storage, store, env, request, json, install };
}
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

describe('app appearance publication', () => {
	it('enforces declared host compatibility for preview, HTTP and internal publish, and rollback before publication', async () => {
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
		const prior = await h.store.saveDocument({ ...future, resources: [], themeId: future.manifest.id, settings: {}, branding: {} });
		await h.storage.put('theme:state', { revision: 0, active: null, previous: prior.hash, profiles: {} });
		await expect(h.store.applyInstalledAppearance({ expectedRevision: 0, operationId: crypto.randomUUID() }, true)).rejects.toMatchObject({
			code: 'THEME_HOST_VERSION_UNSUPPORTED',
		});
		const rollback = await h.json('/api/appearance/rollback', { expectedRevision: 0, operationId: crypto.randomUUID() });
		expect(rollback.status).toBe(409);
		expect(await rollback.json()).toMatchObject({ error: 'THEME_HOST_VERSION_UNSUPPORTED' });
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		const compatible = await h.install(await appThemeFixture(undefined, { minHostVersion: APP_VERSION + '-preview.10+theme-build' }));
		const accepted = await h.json('/api/appearance', apply(compatible.packageId), 'PUT');
		expect(accepted.status).toBe(200);
		expect((await accepted.json()).revision).toBe(1);
	});

	it('atomically publishes all registered files and portable branding through HTTP with idempotent receipts', async () => {
		const h = harness();
		const pkg = await h.install(
			await appThemeFixture(
				{
					'entry.js': "export const detail=()=>import('./chunks/detail.js');",
					'chunks/detail.js': 'export const ok=true;',
					'assets/logo.png': appPng,
				},
				{ settings: [{ key: 'picture', type: 'asset', default: 'assets/logo.png' }] },
			),
		);
		const body = {
			...apply(pkg.packageId),
			branding: { name: 'Pixel', description: 'Description', loginText: 'Welcome', footer: 'Footer', logo: 'assets/logo.png' },
		};
		const committed = await h.json('/api/appearance', body, 'PUT');
		expect(committed.status).toBe(200);
		const saved = await committed.json();
		expect(saved).toMatchObject({ revision: 1, previous: true, active: { kind: 'app', package: { id: pkg.manifest.id } } });
		expect(saved.active.branding).toMatchObject({ name: 'Pixel', description: 'Description', loginText: 'Welcome', footer: 'Footer' });
		expect(saved.active.branding.logo).toMatch(/^\/theme-assets\/[a-f0-9]{64}\//);
		expect(saved.active.settings.picture).toBe(publicFile(pkg, 'assets/logo.png'));
		expect(saved.active.files.map((file) => file.path)).toEqual(pkg.files.map((file) => file.path));
		for (const file of saved.active.files) {
			expect((await h.request(file.url, { operation: 'public' })).status).toBe(200);
		}
		expect((await h.request(saved.active.branding.logo, { operation: 'public' })).status).toBe(200);
		const replayed = await h.json('/api/appearance', body, 'PUT');
		expect(replayed.status).toBe(200);
		expect(await replayed.json()).toMatchObject({ revision: 1, replayed: true, active: saved.active });
		const reused = await h.json('/api/appearance', { ...body, branding: { name: 'different' } }, 'PUT');
		expect(reused.status).toBe(409);
		expect(await reused.json()).toMatchObject({ error: 'THEME_OPERATION_REUSED' });
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
	});

	it('rolls publication marks back on transaction failure and admits only one competing expected revision', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const mark = h.store.markAppPackagePublic.bind(h.store);
		const injected = vi.spyOn(h.store, 'markAppPackagePublic').mockImplementation(async (tx, id) => {
			await mark(tx, id);
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

	it('preserves separate same-ID profiles and restores the complete previous app configuration under a new revision', async () => {
		const h = harness();
		await h.store.applyInstalledAppearance({ ...apply('builtin:fluent'), branding: { name: 'Official' } });
		const pkg = await h.install(await appThemeFixture({ 'entry.js': 'export{}', 'assets/logo.png': appPng }, { id: 'fluent' }));
		const saved = await h.store.applyInstalledAppearance({
			...apply(pkg.packageId, 1),
			branding: { name: 'App', description: 'details', loginText: 'hello', footer: 'bye', logo: 'assets/logo.png' },
		});
		const legacyState = await h.storage.get('theme:state');
		expect(Object.keys(legacyState.profiles).sort()).toEqual(['app:fluent', 'v1:fluent']);
		for (const [query, name] of [
			['', 'Official'],
			['?format=app', 'App'],
		]) {
			const theme = (await (await h.request('/api/themes' + query)).json()).themes.find((theme) => theme.manifest.id === 'fluent');
			expect(theme.profile.branding.name).toBe(name);
		}
		await h.store.applyInstalledAppearance({ ...apply('builtin:fluent', 2), branding: saved.active.branding });
		expect((await (await h.request('/api/appearance')).json()).active.branding).toEqual(saved.active.branding);
		const rollbackBody = { operationId: crypto.randomUUID(), expectedRevision: 3 };
		const response = await h.json('/api/appearance/rollback', rollbackBody);
		expect(response.status).toBe(200);
		const rolled = await response.json();
		expect(rolled.revision).toBe(4);
		expect(rolled.active.branding).toEqual(saved.active.branding);
		expect(rolled.active.files).toEqual(saved.active.files);
		expect(await (await h.json('/api/appearance/rollback', rollbackBody)).json()).toMatchObject({ revision: 4, replayed: true });
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

	it('does not roll back to an app whose personal asset bytes are incomplete', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const asset = await normalizeAsset(appPng, 'personal.png');
		await h.store.saveBlob(asset);
		await h.store.applyInstalledAppearance({ ...apply(pkg.packageId), branding: { logo: `/theme-assets/${asset.hash}/${asset.name}` } });
		await h.store.applyInstalledAppearance(apply('builtin:fluent', 1));
		await h.storage.delete(`theme:chunk:${asset.hash}:0`);
		await expect(h.store.applyInstalledAppearance({ expectedRevision: 2, operationId: crypto.randomUUID() }, true)).rejects.toMatchObject({
			code: 'THEME_ASSET_INCOMPLETE',
		});
		const rollback = await h.json('/api/appearance/rollback', { expectedRevision: 2, operationId: crypto.randomUUID() });
		expect(rollback.status).toBe(503);
		expect(await rollback.json()).toMatchObject({ error: 'THEME_ASSET_INCOMPLETE' });
		expect((await (await h.request('/api/appearance')).json()).active).toMatchObject({ revision: 2, packageId: 'builtin:fluent' });
	});
});

describe('opaque preview capability resources', () => {
	it('returns a fixed package/resource scope and grants anonymous null-origin bytes without publishing it', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture({ 'entry.js': 'export{}', 'assets/logo.png': appPng }));
		const response = await preview(h, { packageId: pkg.packageId, branding: { logo: 'assets/logo.png' } });
		expect(response.status).toBe(201);
		const cap = await response.json();
		expect(cap.capabilityId).toMatch(/^[a-f0-9]{64}$/);
		expect(cap.appearance).toMatchObject({ kind: 'app', revision: null, package: { id: pkg.manifest.id }, baseUrl: cap.baseUrl });
		expect(cap.appearance.branding.logo.startsWith(cap.baseUrl)).toBe(true);
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

	it('pins personal resources and blocks package deletion until preview revoke/logout or expiry', async () => {
		const h = harness(),
			pkg = await h.install(await appThemeFixture());
		const asset = await normalizeAsset(appPng, 'logo.png');
		await h.store.saveBlob(asset);
		const cap = await (
			await preview(h, { packageId: pkg.packageId, branding: { logo: `/theme-assets/${asset.hash}/${asset.name}` } })
		).json();
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + asset.hash)).toBeDefined();
		expect(
			new Uint8Array(
				await (await h.request(cap.appearance.branding.logo, { operation: 'preview', headers: { Origin: 'null' } })).arrayBuffer(),
			),
		).toEqual(appPng);
		expect((await h.request(`/api/themes/${pkg.packageId}`, { method: 'DELETE' })).status).toBe(409);
		const other = await (await preview(h, { packageId: pkg.packageId }, ownerB)).json();
		await h.request('/api/logout', { method: 'POST', operation: 'preview-logout', headers: { [THEME_PREVIEW_OWNER_HEADER]: ownerA } });
		expect((await previewFile(h, cap)).status).toBe(410);
		expect((await previewFile(h, other)).status).toBe(200);
		await revoke(h, other.capabilityId, ownerB);
		expect((await h.request(`/api/themes/${pkg.packageId}`, { method: 'DELETE' })).status).toBe(200);
		await expireBlobs(h.storage);
		await h.store.alarm();
		expect(await h.storage.get('theme:blob:' + asset.hash)).toBeUndefined();
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
	it('separates explicit app installation/listing from v1 while permitting HTTP app publish and rollback', async () => {
		const h = harness(),
			source = await appThemeFixture();
		expect((await h.request('/api/themes/import', { body: source.archive })).status).toBe(400);
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
		const rollback = await h.json('/api/appearance/rollback', { expectedRevision: 2, operationId: crypto.randomUUID() });
		expect(rollback.status).toBe(200);
		expect(await rollback.json()).toMatchObject({
			revision: 3,
			active: { kind: 'app', packageId: pkg.packageId },
		});
	});

	it('does not attach a saved v1 profile to an app package with the same manifest id', async () => {
		const h = harness();
		await h.json('/api/appearance', { ...apply('builtin:fluent'), branding: { name: 'Official profile' } }, 'PUT');
		await h.install(await appThemeFixture(undefined, { id: 'fluent' }));
		const official = (await (await h.request('/api/themes')).json()).themes.find((theme) => theme.manifest.id === 'fluent');
		expect(official.profile.branding.name).toBe('Official profile');
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

	it('hydrates bytes for export/reinstall and restores personal assets without publishing or activating', async () => {
		const h = harness();
		const source = await appThemeFixture({ 'entry.js': 'export{}', 'assets/photo.png': appPng, 'licenses/MIT.txt': 'MIT fixture' });
		const pkg = await h.install(source);
		const exported = await h.request(`/api/themes/${pkg.packageId}/export`);
		const bytes = new Uint8Array(await exported.arrayBuffer());
		const parsed = await normalizeAppThemeImport({ bytes });
		expect(parsed.packageId).toBe(pkg.packageId);
		for (const file of parsed.files) {
			expect(file.bytes).toEqual(source.files.get(file.path));
		}
		const asset = await normalizeAsset(appPng, 'logo.png');
		const backup = await exportAppTheme(parsed, {
			appearance: { branding: { name: 'My pixel vault', logo: `/theme-assets/${asset.hash}/${asset.name}` } },
			assets: [asset],
		});
		expect((await h.request('/api/themes/import?format=app', { body: backup })).status).toBe(400);
		const target = harness();
		const restored = await target.request('/api/appearance/restore-inspect?format=app', { body: backup });
		expect(restored.status).toBe(201);
		const result = await restored.json();
		expect(result.appearance.branding.name).toBe('My pixel vault');
		expect(result.appearance.resources).toHaveLength(1);
		expect((await target.request(`/api/appearance/assets/${asset.hash}`)).status).toBe(200);
		expect((await target.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
		expect((await (await target.request('/api/appearance')).json()).revision).toBe(0);
		// Simulate the future host's saved snapshot without adding an activation API.
		const snapshot = await target.store.saveDocument({ ...result.appearance, kind: 'app', manifest: result.theme.manifest });
		await target.storage.put('theme:state', { revision: 1, active: snapshot.hash, previous: null, profiles: {} });
		const complete = await target.request('/api/appearance/export');
		expect(complete.status).toBe(200);
		const completeRestored = await normalizeAppThemeImport({ bytes: new Uint8Array(await complete.arrayBuffer()) });
		expect(completeRestored.packageId).toBe(pkg.packageId);
		expect(completeRestored.appearance.branding).toEqual({ name: 'My pixel vault', logo: 'assets/photo.png' });
		expect(completeRestored.appearanceAssets).toEqual([]);
		expect(completeRestored.files.find((file) => file.path === 'assets/photo.png').bytes).toEqual(appPng);
		expect((await target.store.prepareAppAppearance(completeRestored.appearance)).snapshot.branding).toEqual(result.appearance.branding);
		const v1 = await h.store.install({ bytes: encodeAppText('body { color: red }'), name: 'simple.css' });
		const v1Export = await h.store.export(v1.theme.packageId, false);
		const v1Restored = await target.store.install({ bytes: new Uint8Array(await v1Export.arrayBuffer()), name: 'theme.zip' });
		expect(v1Restored.theme.packageId).toBe(v1.theme.packageId);
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
			expect(
				(
					await h.json(
						'/api/appearance',
						{ ...apply('builtin:fluent'), branding: { logo: `/theme-assets/${imageAsset.hash}/${imageAsset.name}` } },
						'PUT',
					)
				).status,
			).toBe(200);
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

	it('shares the 20-version and 50MiB quota with v1 and preserves deduplicated blobs after deletion/GC', async () => {
		const h = harness();
		const a = await h.install(await appThemeFixture()),
			b = await h.install(await appThemeFixture(undefined, { version: '1.0.1' }));
		const shared = a.files[0].hash;
		for (let index = 0; index < 18; index++) {
			await h.store.install({ name: 'v1.css', bytes: encodeAppText(`body { color: #${index.toString(16).padStart(6, '0')} }`) });
		}
		const tooMany = await h.request('/api/themes/import?format=app', {
			body: (await appThemeFixture(undefined, { version: '1.0.2' })).archive,
		});
		expect(await tooMany.json()).toMatchObject({ error: 'THEME_VERSION_CAPACITY' });
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
		const capacity = await h.request('/api/themes/import?format=app', {
			body: (await appThemeFixture({ 'entry.js': 'export const newCode=true;' })).archive,
		});
		expect(await capacity.json()).toMatchObject({ error: 'THEME_CAPACITY' });
		expect((await h.storage.list({ prefix: 'theme:package:' })).size).toBe(18);
	});

	it('allows committed app resources and appearance reads during a suspended upload', async () => {
		const h = harness(),
			source = await appThemeFixture(),
			pkg = await h.install(source);
		await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, pkg.packageId));
		let producer;
		const body = new ReadableStream({
			start(controller) {
				producer = controller;
				controller.enqueue(source.archive.subarray(0, 10));
			},
		});
		const pending = h.request('/api/themes/import?format=app', { body });
		try {
			await vi.waitFor(async () => expect((await h.storage.get('theme:rate:import')).length).toBe(2));
			const reads = await Promise.race([
				Promise.all([h.request('/api/appearance'), h.request(privateFile(pkg)), h.request(publicFile(pkg), { operation: 'public' })]),
				new Promise((_, reject) => setTimeout(() => reject(new Error('read blocked by upload')), 1000)),
			]);
			expect(reads.map((response) => response.status)).toEqual([200, 200, 200]);
		} finally {
			producer.enqueue(source.archive.subarray(10));
			producer.close();
		}
		expect((await pending).status).toBe(201);
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

	it('reuses URL/Release download guards and does not publish a downloaded package', async () => {
		const h = harness(),
			source = await appThemeFixture();
		const fetcher = vi.fn(async (url) =>
			url.includes('api.github.com')
				? Response.json({
						draft: false,
						prerelease: false,
						assets: [{ name: '2fa-theme.zip', browser_download_url: 'https://cdn.example.com/theme.zip' }],
					})
				: new Response(source.archive),
		);
		vi.stubGlobal('fetch', fetcher);
		const response = await h.json('/api/themes/import?format=app', { url: 'https://github.com/owner/theme' });
		expect(response.status).toBe(201);
		const pkg = (await response.json()).theme;
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			'https://api.github.com/repos/owner/theme/releases/latest',
			'https://cdn.example.com/theme.zip',
		]);
		expect((await h.request(publicFile(pkg), { operation: 'public' })).status).toBe(404);
		fetcher.mockClear();
		expect((await h.json('/api/themes/import?format=app', { url: 'https://127.0.0.1/theme.zip' })).status).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
		fetcher.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/theme.zip' } }));
		expect((await h.json('/api/themes/import?format=app', { url: 'https://cdn.example.com/theme.zip' })).status).toBe(400);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
