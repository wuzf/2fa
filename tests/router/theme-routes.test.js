/* global structuredClone */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { handleRequest } from '../../src/router/handler.js';
import { verifyAuthWithDetails, checkIfSetupRequired, requiresAuth } from '../../src/utils/auth.js';
import { readSettingsSnapshot } from '../../src/storage/secrets-store.js';
import { createMainPage } from '../../src/ui/page.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { appThemeFixture } from '../helpers/app-theme.js';
import { createRuntimeManifest } from '../../src/ui/runtimeManifest.js';
import { createDefaultAppearance } from '../../src/api/themes.js';
import { normalizeDetectedThemeImport } from '../../src/themes/import.js';
import { hashBytes } from '../../src/themes/schema.js';

vi.mock('../../src/utils/auth.js', async (original) => ({
	...(await original()),
	verifyAuthWithDetails: vi.fn(async () => ({ valid: true, token: 'authenticated' })),
	checkIfSetupRequired: vi.fn(async () => false),
}));
vi.mock('../../src/storage/secrets-store.js', () => ({
	readSettingsSnapshot: vi.fn(async () => ({ customCodes: [{ id: 'custom', code: '<style>body{color:red}</style>', enabled: true }] })),
	runSecretsOperation: vi.fn(),
}));
vi.mock('../../src/ui/page.js', () => ({ createMainPage: vi.fn(async (options) => Response.json(options)) }));
vi.mock('../../src/ui/scripts/index.js', () => ({ getModuleCode: vi.fn(() => '/* isolated module */') }));
vi.mock('../../src/ui/runtimeManifest.js', () => ({ createRuntimeManifest: vi.fn(async (_request, options) => Response.json(options)) }));

class Storage {
	constructor() {
		this.values = new Map();
		this.alarm = null;
	}
	async get(key) {
		return structuredClone(this.values.get(key));
	}
	async put(key, value) {
		this.values.set(key, structuredClone(value));
	}
	async delete(key) {
		this.values.delete(key);
	}
	async list({ prefix = '' } = {}) {
		return new Map([...this.values].filter(([key]) => key.startsWith(prefix)));
	}
	async getAlarm() {
		return this.alarm;
	}
	async setAlarm(value) {
		this.alarm = value;
	}
	async transaction(callback) {
		const previous = structuredClone(this.values);
		try {
			return await callback(this);
		} catch (error) {
			this.values = previous;
			throw error;
		}
	}
}

function environment(withStore = true) {
	const values = new Map();
	const env = {
		LOG_LEVEL: 'ERROR',
		SECRETS_KV: {
			get: vi.fn(async (key) => (key === 'user_password' ? 'password-hash' : values.get(key) || null)),
			put: vi.fn(async (key, value) => values.set(key, value)),
			delete: vi.fn(async (key) => values.delete(key)),
		},
	};
	const storage = new Storage();
	const store = new ThemeStore({ storage }, env);
	const requests = [];
	if (withStore) {
		env.SECRETS_STORE = {
			idFromName: (name) => name,
			get: (name) => ({
				fetch: (request) => {
					requests.push({ name, request });
					return store.fetch(request);
				},
			}),
		};
	}
	return { env, store, storage, requests };
}

const request = (path, body, method = body === undefined ? 'GET' : 'POST') =>
	new Request('https://vault.example.com' + path, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
const apply = (revision = 0) => ({
	packageId: 'builtin:fluent',
	expectedRevision: revision,
	operationId: crypto.randomUUID(),
	branding: { name: 'Private Vault' },
});

async function communityFixture(packageIdOverride, repositories = ['wuzf/2fa-theme-mytheme']) {
	const { archive } = await appThemeFixture();
	const pkg = await normalizeDetectedThemeImport({ bytes: archive });
	const revision = 'c'.repeat(40);
	const entry = {
		id: pkg.manifest.id,
		kind: 'app',
		name: pkg.manifest.name,
		version: pkg.manifest.version,
		description: '',
		author: '',
		packageId: packageIdOverride || pkg.packageId,
		path: `themes/${pkg.manifest.id}/2fa-theme.zip`,
		sha256: await hashBytes(archive),
		size: archive.length,
	};
	const fetcher = vi.fn(async (url) => {
		for (const repository of repositories) {
			if (url === `https://api.github.com/repos/${repository}/git/ref/heads/main`) {
				return Response.json({ object: { type: 'commit', sha: revision } });
			}
			const base = `https://raw.githubusercontent.com/${repository}/${revision}/`;
			if (url === base + 'catalog.json') {
				return Response.json({ schemaVersion: 1, themes: [entry] });
			}
			if (url === base + entry.path) {
				return new Response(archive);
			}
		}
		return new Response('Not found', { status: 404 });
	});
	vi.stubGlobal('fetch', fetcher);
	return { entry, pkg, fetcher };
}

describe('community catalog integration', () => {
	it('browses the catalog and installs its verified package without publishing it', async () => {
		const h = environment();
		const { entry, pkg } = await communityFixture();
		const catalog = await handleRequest(request('/api/themes/catalog'), h.env);
		expect(catalog.status).toBe(200);
		expect(await catalog.json()).toEqual({
			themes: [{ ...entry, repository: 'wuzf/2fa-theme-mytheme' }],
			sources: [{ repository: 'wuzf/2fa-theme-mytheme', official: true, status: 'ready' }],
		});
		const response = await handleRequest(request('/api/themes/catalog/install', { id: entry.id, packageId: entry.packageId }), h.env);
		expect(response.status).toBe(201);
		expect((await response.json()).theme.packageId).toBe(pkg.packageId);
		expect((await h.store.listThemes('app')).themes).toHaveLength(1);
		expect((await h.store.readAppearance()).revision).toBe(0);
	});

	it('rejects catalog/package identity disagreement before installing anything', async () => {
		const h = environment();
		const { entry } = await communityFixture('e'.repeat(64));
		const response = await handleRequest(request('/api/themes/catalog/install', { id: entry.id, packageId: entry.packageId }), h.env);
		expect(response.status).toBe(409);
		expect((await response.json()).error).toBe('THEME_CATALOG_CHANGED');
		expect((await h.store.listThemes('app')).themes).toHaveLength(0);
		expect((await h.store.readAppearance()).revision).toBe(0);
	});

	it('reports catalog unavailability without changing the local appearance or installed themes', async () => {
		const h = environment();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Unavailable', { status: 503 })),
		);
		const catalog = await handleRequest(request('/api/themes/catalog'), h.env);
		expect(catalog.status).toBe(200);
		expect(await catalog.json()).toEqual({
			themes: [],
			sources: [{ repository: 'wuzf/2fa-theme-mytheme', official: true, status: 'error', error: 'THEME_DOWNLOAD_FAILED' }],
		});
		expect((await handleRequest(request('/api/appearance'), h.env)).status).toBe(200);
		expect((await handleRequest(request('/api/themes'), h.env)).status).toBe(200);
	});

	it('lists only the official catalog without a theme store', async () => {
		const h = environment(false);
		const { entry } = await communityFixture();
		const catalog = await handleRequest(request('/api/themes/catalog'), h.env);
		expect(catalog.status).toBe(200);
		expect((await catalog.json()).themes).toEqual([entry]);
	});
});

describe('owner theme catalogs', () => {
	const custom = 'octo-cat/my-2fa-themes';
	const putCatalogs = (repositories) => request('/api/themes/catalogs', { repositories }, 'PUT');

	it('saves normalized public repositories, drops the official one and duplicates', async () => {
		const h = environment();
		const response = await handleRequest(
			putCatalogs([`https://github.com/${custom}.git`, custom.toUpperCase(), 'wuzf/2fa-theme-mytheme', 'someone/other']),
			h.env,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ official: 'wuzf/2fa-theme-mytheme', custom: [custom, 'someone/other'] });
		expect(await (await handleRequest(request('/api/themes/catalogs'), h.env)).json()).toEqual({
			official: 'wuzf/2fa-theme-mytheme',
			custom: [custom, 'someone/other'],
		});
	});

	it.each([['not a repository'], ['owner/..'], ['-owner/name'], ['https://example.com/owner/name'], ['owner/name/extra']])(
		'rejects the repository %s',
		async (value) => {
			const h = environment();
			const response = await handleRequest(putCatalogs([value]), h.env);
			expect(response.status).toBe(400);
			expect((await response.json()).error).toBe('THEME_CATALOG_SOURCE_INVALID');
			expect(await h.storage.get('theme:catalogs')).toBeUndefined();
		},
	);

	it('limits the owner to five catalogs', async () => {
		const h = environment();
		const response = await handleRequest(putCatalogs(['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6']), h.env);
		expect(response.status).toBe(413);
		expect((await response.json()).error).toBe('THEME_CATALOG_SOURCE_LIMIT');
	});

	it('lists every catalog with its source, and one unreachable catalog hides nothing else', async () => {
		const h = environment();
		await handleRequest(putCatalogs([custom, 'gone/away']), h.env);
		const { entry } = await communityFixture(undefined, ['wuzf/2fa-theme-mytheme', custom]);
		const data = await (await handleRequest(request('/api/themes/catalog'), h.env)).json();
		expect(data.themes).toEqual([
			{ ...entry, repository: 'wuzf/2fa-theme-mytheme' },
			{ ...entry, repository: custom },
		]);
		expect(data.sources).toEqual([
			{ repository: 'wuzf/2fa-theme-mytheme', official: true, status: 'ready' },
			{ repository: custom, official: false, status: 'ready' },
			{ repository: 'gone/away', official: false, status: 'error', error: 'THEME_DOWNLOAD_FAILED' },
		]);
	});

	it('installs from an added catalog and keeps the theme after the catalog is removed', async () => {
		const h = environment();
		await handleRequest(putCatalogs([custom]), h.env);
		const { entry, pkg, fetcher } = await communityFixture(undefined, [custom]);
		const response = await handleRequest(
			request('/api/themes/catalog/install', { id: entry.id, packageId: entry.packageId, repository: custom }),
			h.env,
		);
		expect(response.status).toBe(201);
		expect(fetcher.mock.calls.map(([url]) => url).every((url) => url.includes(custom))).toBe(true);
		const [installed] = (await h.store.listThemes('app')).themes;
		expect(installed.packageId).toBe(pkg.packageId);
		expect(installed.source).toBe(`https://raw.githubusercontent.com/${custom}/${'c'.repeat(40)}/${entry.path}`);
		await handleRequest(putCatalogs([]), h.env);
		expect((await h.store.listThemes('app')).themes).toHaveLength(1);
	});

	it('never downloads from a repository the owner has not added', async () => {
		const h = environment();
		const { entry, fetcher } = await communityFixture(undefined, ['attacker/themes']);
		const response = await handleRequest(
			request('/api/themes/catalog/install', { id: entry.id, packageId: entry.packageId, repository: 'attacker/themes' }),
			h.env,
		);
		expect(response.status).toBe(404);
		expect((await response.json()).error).toBe('THEME_CATALOG_SOURCE_UNKNOWN');
		expect(fetcher).not.toHaveBeenCalled();
		expect((await h.store.listThemes('app')).themes).toHaveLength(0);
	});
});

describe('theme file upload', () => {
	const upload = (bytes, name = '2fa-theme.zip') =>
		new Request('https://vault.example.com/api/themes/import', {
			method: 'POST',
			headers: { 'Content-Type': 'application/zip', 'X-File-Name': name },
			body: bytes,
		});

	it('installs an uploaded ZIP without publishing it or recording a source', async () => {
		const h = environment();
		const { archive } = await appThemeFixture();
		const pkg = await normalizeDetectedThemeImport({ bytes: archive });
		const response = await handleRequest(upload(archive), h.env);
		expect(response.status).toBe(201);
		expect((await response.json()).theme.packageId).toBe(pkg.packageId);
		const [installed] = (await h.store.listThemes('app')).themes;
		expect(installed.packageId).toBe(pkg.packageId);
		expect(installed.source).toBeNull();
		expect((await h.store.readAppearance()).revision).toBe(0);
	});

	it('rejects an empty body and a damaged file without installing anything', async () => {
		const h = environment();
		const empty = await handleRequest(upload(new Uint8Array()), h.env);
		expect(empty.status).toBe(400);
		expect((await empty.json()).error).toBe('THEME_EMPTY_FILE');
		const damaged = await handleRequest(upload(new TextEncoder().encode('not a zip')), h.env);
		expect(damaged.status).toBe(400);
		expect((await h.store.listThemes('app')).themes).toHaveLength(0);
	});

	it('rejects a file over the upload limit', async () => {
		const h = environment();
		const response = await handleRequest(upload(new Uint8Array(12 * 1024 * 1024 + 1)), h.env);
		expect(response.status).toBe(413);
		expect((await h.store.listThemes('app')).themes).toHaveLength(0);
	});
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('__2FA_BUILD_ID__', 'fixture-build-2026');
	verifyAuthWithDetails.mockResolvedValue({ valid: true, token: 'authenticated' });
	checkIfSetupRequired.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('theme routes authentication and capabilities', () => {
	it.each([
		'/api/themes',
		'/api/themes/catalog',
		'/api/themes/catalog/install',
		'/api/appearance',
		'/api/appearance/assets/' + 'a'.repeat(64),
		'/api/appearance/export',
		'/api/themes/' + 'a'.repeat(64) + '/files/entry.js',
		'/api/themes/preview-capabilities',
		'/api/runtime-manifest',
	])('requires authentication before reading %s', async (path) => {
		const h = environment();
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect(requiresAuth(path)).toBe(true);
		expect((await handleRequest(request(path), h.env)).status).toBe(401);
		expect(h.requests).toHaveLength(0);
		expect(readSettingsSnapshot).not.toHaveBeenCalled();
	});

	it('requires authentication for writes even in an unbuilt source runtime', async () => {
		const h = environment();
		vi.stubGlobal('__2FA_BUILD_ID__', '');
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect((await handleRequest(request('/api/appearance', apply(), 'PUT'), h.env)).status).toBe(401);
		expect(h.requests).toHaveLength(0);
	});

	it('permits builtin reads without a binding but rejects all publishing attempts', async () => {
		const h = environment(false);
		const list = await handleRequest(request('/api/themes'), h.env);
		expect((await list.json()).themes).toHaveLength(3);
		expect((await (await handleRequest(request('/api/themes?format=app'), h.env)).json()).themes).toEqual([]);
		const appearance = await handleRequest(request('/api/appearance'), h.env);
		expect((await appearance.json()).capabilities.write).toBe(false);
		expect((await handleRequest(request('/api/appearance', apply(), 'PUT'), h.env)).status).toBe(503);
	});

	it('rejects writes without a build identity before dispatching to the DO', async () => {
		const h = environment();
		vi.stubGlobal('__2FA_BUILD_ID__', '');
		for (const [path, method] of [
			['/api/appearance', 'PUT'],
			['/api/themes/import', 'POST'],
			['/api/appearance/restore-inspect', 'POST'],
			['/api/themes/unused', 'DELETE'],
		]) {
			const response = await handleRequest(request(path, apply(), method), h.env);
			expect(response.status).toBe(503);
		}
		expect(h.requests).toHaveLength(0);
		expect((await handleRequest(request('/api/themes'), h.env)).status).toBe(200);
	});

	it('uses the authenticated appearance object for writes and revision conflicts', async () => {
		const h = environment();
		const body = apply();
		expect((await handleRequest(request('/api/appearance', body, 'PUT'), h.env)).status).toBe(200);
		expect(h.requests[0].name).toBe('appearance:v1');
		expect((await handleRequest(request('/api/appearance', apply(), 'PUT'), h.env)).status).toBe(409);
		const replay = await handleRequest(request('/api/appearance', body, 'PUT'), h.env);
		expect(await replay.json()).toMatchObject({ revision: 1, replayed: true });
	});
});

describe('homepage configuration reads', () => {
	const customCodes = [{ id: 'parallel', code: '<style>body{color:green}</style>', enabled: true }];
	const gate = () => {
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		return { promise, resolve };
	};

	it.each(['settings', 'appearance'])('starts both reads before either settles and waits for both: %s first', async (first) => {
		const h = environment();
		await h.store.apply(apply());
		const saved = await h.store.readAppearance();
		const settings = gate();
		const appearance = gate();
		readSettingsSnapshot.mockImplementationOnce(async () => {
			await settings.promise;
			return { customCodes };
		});
		const readAppearance = vi.spyOn(h.store, 'readAppearance').mockImplementationOnce(async () => {
			await appearance.promise;
			return saved;
		});
		const rendering = handleRequest(request('/'), h.env);
		try {
			await vi.waitFor(() => {
				expect(readSettingsSnapshot).toHaveBeenCalledOnce();
				expect(readAppearance).toHaveBeenCalledOnce();
			});
			expect(createMainPage).not.toHaveBeenCalled();
			if (first === 'settings') {
				settings.resolve();
				await readSettingsSnapshot.mock.results[0].value;
			} else {
				appearance.resolve();
				await readAppearance.mock.results[0].value;
			}
			expect(createMainPage).not.toHaveBeenCalled();
		} finally {
			settings.resolve();
			appearance.resolve();
			await rendering;
		}
		const expected = { customCodes, appearance: saved.active, buildId: 'fixture-build-2026', safeMode: false, lazyLoad: true };
		expect(createMainPage).toHaveBeenCalledExactlyOnceWith(expected);
		expect(await (await rendering).json()).toEqual(expected);
		expect(h.requests).toHaveLength(1);
		expect(h.requests[0].request.headers.get('X-2FA-Theme-Operation')).toBe('appearance');
	});

	it.each([
		{ settingsFail: true, appearanceFail: false },
		{ settingsFail: false, appearanceFail: true },
		{ settingsFail: true, appearanceFail: true },
	])('retains independent fallbacks: $settingsFail/$appearanceFail', async ({ settingsFail, appearanceFail }) => {
		const h = environment();
		await h.store.apply(apply());
		const saved = await h.store.readAppearance();
		if (settingsFail) {
			readSettingsSnapshot.mockRejectedValueOnce(new Error('settings unavailable'));
		} else {
			readSettingsSnapshot.mockResolvedValueOnce({ customCodes });
		}
		if (appearanceFail) {
			vi.spyOn(h.store, 'fetch').mockRejectedValueOnce(new Error('appearance unavailable'));
		}
		h.env.SECRETS_KV.get.mockClear();
		const response = await handleRequest(request('/'), h.env);
		const expected = {
			customCodes: settingsFail ? [] : customCodes,
			appearance: appearanceFail ? createDefaultAppearance() : saved.active,
			buildId: 'fixture-build-2026',
			safeMode: false,
			lazyLoad: true,
		};
		expect(response.status).toBe(200);
		expect(createMainPage).toHaveBeenCalledExactlyOnceWith(expected);
		expect(await response.json()).toEqual(expected);
		expect(h.env.SECRETS_KV.get).not.toHaveBeenCalled();
	});

	it('does not begin either read while setup is pending or when setup redirects', async () => {
		const h = environment();
		const setup = gate();
		checkIfSetupRequired.mockImplementationOnce(() => setup.promise);
		const response = handleRequest(request('/'), h.env);
		expect(checkIfSetupRequired).toHaveBeenCalledOnce();
		expect(readSettingsSnapshot).not.toHaveBeenCalled();
		expect(h.requests).toHaveLength(0);
		setup.resolve(true);
		expect((await response).status).toBe(302);
		expect((await response).headers.get('Location')).toBe('https://vault.example.com/setup');
		expect(readSettingsSnapshot).not.toHaveBeenCalled();
		expect(h.requests).toHaveLength(0);
		expect(createMainPage).not.toHaveBeenCalled();
	});
});

describe('theme routes recovery and resource boundary', () => {
	it('derives preview ownership after authentication, ignores spoofed owner headers and revokes that owner after logout', async () => {
		const h = environment();
		const source = await appThemeFixture();
		const { theme } = await h.store.install({ bytes: source.archive }, false, 'app');
		const make = () =>
			new Request('https://vault.example.com/api/themes/preview-capabilities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-2FA-Preview-Owner': 'a'.repeat(64) },
				body: JSON.stringify({ packageId: theme.packageId }),
			});
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect((await handleRequest(make(), h.env)).status).toBe(401);
		expect(h.requests).toHaveLength(0);
		verifyAuthWithDetails.mockResolvedValue({ valid: true, token: 'initial-jwt' });
		const created = await handleRequest(make(), h.env);
		expect(created.status).toBe(201);
		const cap = await created.json();
		expect(h.requests[0].request.headers.get('X-2FA-Preview-Owner')).toMatch(/^[a-f0-9]{64}$/);
		expect(h.requests[0].request.headers.get('X-2FA-Preview-Owner')).not.toBe('a'.repeat(64));
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		vi.clearAllMocks();
		const bytes = await handleRequest(new Request('https://vault.example.com' + cap.entryUrl, { headers: { Origin: 'null' } }), h.env);
		expect(bytes.status).toBe(200);
		expect(bytes.headers.get('Access-Control-Allow-Origin')).toBe('null');
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
		verifyAuthWithDetails.mockResolvedValue({ valid: true, token: 'refreshed-jwt' });
		expect((await handleRequest(request('/api/logout', {}), h.env)).status).toBe(403);
		expect((await handleRequest(new Request('https://vault.example.com' + cap.entryUrl), h.env)).status).toBe(200);
		const logout = new Request('https://vault.example.com/api/logout', {
			method: 'POST',
			headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://vault.example.com', Host: 'vault.example.com' },
		});
		expect((await handleRequest(logout, h.env)).status).toBe(200);
		expect(
			(await handleRequest(new Request('https://vault.example.com' + cap.entryUrl, { headers: { Origin: 'null' } }), h.env)).status,
		).toBe(410);
	});

	it('serves only the safe descriptor publicly and authenticates exact current build/revision descriptors', async () => {
		const h = environment();
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		const safe = await handleRequest(request('/api/runtime-manifest?mode=safe&build=fixture-build-2026&appearance=0'), h.env);
		expect(safe.status).toBe(200);
		expect(createRuntimeManifest).toHaveBeenCalledWith(expect.any(Request), {
			appearance: null,
			buildId: 'fixture-build-2026',
			customCodes: [],
		});
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		expect(readSettingsSnapshot).not.toHaveBeenCalled();
		expect(h.requests).toHaveLength(0);
		expect((await handleRequest(request('/api/runtime-manifest?mode=official&build=fixture-build-2026&appearance=0'), h.env)).status).toBe(
			401,
		);
		verifyAuthWithDetails.mockResolvedValue({ valid: true });
		createRuntimeManifest.mockClear();
		for (const query of [
			'mode=official&build=old&appearance=0',
			'mode=official&build=fixture-build-2026&appearance=1',
			'mode=app&build=fixture-build-2026&appearance=0',
			'mode=safe&build=fixture-build-2026&appearance=1',
		]) {
			expect((await handleRequest(request('/api/runtime-manifest?' + query), h.env)).status).toBe(409);
		}
		expect(createRuntimeManifest).not.toHaveBeenCalled();
		const current = await handleRequest(request('/api/runtime-manifest?mode=official&build=fixture-build-2026&appearance=0'), h.env);
		expect(current.status).toBe(200);
		expect(createRuntimeManifest).toHaveBeenCalledWith(
			expect.any(Request),
			expect.objectContaining({
				appearance: expect.objectContaining({ revision: 0, packageId: 'builtin:fluent' }),
				buildId: 'fixture-build-2026',
				customCodes: [{ id: 'custom', code: '<style>body{color:red}</style>', enabled: true }],
			}),
		);
	});

	it.each(['safeMode=1', 'disableCustomCode=1'])('serves safe manifest/icons independently of saved appearance: %s', async (query) => {
		const h = environment();
		await h.store.apply({ ...apply(), branding: { name: 'Saved app brand' } });
		const manifest = await handleRequest(request('/manifest.json?' + query), h.env);
		expect((await manifest.json()).name).not.toBe('Saved app brand');
		for (const size of [192, 512]) {
			const icon = await handleRequest(request('/icon-' + size + '.png?' + query), h.env);
			expect(icon.status).toBe(200);
			expect(icon.headers.get('Content-Type')).toContain('image/svg+xml');
		}
		expect(h.requests).toHaveLength(0);
	});

	it('serves only the two pinned QR vendor files publicly', async () => {
		const h = environment();
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		for (const path of ['/vendor/jsqr-1.4.0.js', '/vendor/qrcode-generator-1.4.4.js']) {
			const response = await handleRequest(request(path), h.env);
			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toContain('javascript');
		}
		expect((await handleRequest(request('/vendor/arbitrary.js'), h.env)).status).toBe(404);
		expect((await handleRequest(request('/vendor/jsqr-1.4.0.js', {}, 'POST'), h.env)).status).toBe(404);
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
	});

	it('keeps installed app JS private and authenticates private file reads without broadening CORS', async () => {
		const h = environment();
		const fixture = await appThemeFixture();
		const { theme } = await h.store.install({ bytes: fixture.archive }, false, 'app');
		const publicPath = '/theme-packages/' + theme.packageId + '/entry.js';
		const privatePath = '/api/themes/' + theme.packageId + '/files/entry.js';
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect((await handleRequest(request(publicPath), h.env)).status).toBe(404);
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
		expect((await handleRequest(request(privatePath), h.env)).status).toBe(401);
		await h.storage.transaction((tx) => h.store.markAppPackagePublic(tx, theme.packageId));
		vi.clearAllMocks();
		const published = await handleRequest(request(publicPath), h.env);
		expect(published.status).toBe(200);
		expect(published.headers.get('Content-Type')).toBe('text/javascript');
		expect(published.headers.has('Access-Control-Allow-Origin')).toBe(false);
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
		verifyAuthWithDetails.mockResolvedValue({ valid: true });
		const authenticated = await handleRequest(request(privatePath), h.env);
		expect(authenticated.status).toBe(200);
		expect(authenticated.headers.get('Cache-Control')).toBe('private, no-store');
		expect(authenticated.headers.has('Access-Control-Allow-Origin')).toBe(false);
	});

	it.each(['safeMode=1', 'disableCustomCode=1'])('renders a recovery shell without reading saved code or appearance: %s', async (query) => {
		const h = environment();
		const response = await handleRequest(request('/?' + query), h.env);
		expect(response.status).toBe(200);
		expect(createMainPage).toHaveBeenCalledWith(
			expect.objectContaining({ safeMode: true, appearance: null, customCodes: [], buildId: 'fixture-build-2026' }),
		);
		expect(readSettingsSnapshot).not.toHaveBeenCalled();
		expect(h.requests).toHaveLength(0);
	});

	it('does not apply persisted themes to the unbuilt source page', async () => {
		const h = environment();
		vi.stubGlobal('__2FA_BUILD_ID__', '');
		await handleRequest(request('/'), h.env);
		expect(createMainPage).toHaveBeenCalledWith(
			expect.objectContaining({
				appearance: null,
				customCodes: [{ id: 'custom', code: '<style>body{color:red}</style>', enabled: true }],
				lazyLoad: false,
				buildId: '',
			}),
		);
		expect(readSettingsSnapshot).toHaveBeenCalledExactlyOnceWith(h.env);
		expect(h.requests).toHaveLength(0);
	});

	it('returns public resources before auth/setup only when the authoritative publication record permits them', async () => {
		const h = environment();
		const png = new Uint8Array(
			Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
		);
		const encode = (text) => new TextEncoder().encode(text);
		const archive = zipSync({
			'2fa-theme.json': encode(
				JSON.stringify({ themeApiVersion: 1, id: 'route-theme', name: 'Route', version: '1.0.0', styles: 'theme.css' }),
			),
			'theme.css': encode('body{background:url(logo.png)}'),
			'logo.png': png,
		});
		const { theme } = await h.store.enqueue(() => h.store.install({ bytes: archive, name: 'theme.zip' }));
		const asset = theme.assets[0];
		const path = '/theme-assets/' + asset.hash + '/' + asset.name;
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect((await handleRequest(request(path), h.env)).status).toBe(404);
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		verifyAuthWithDetails.mockResolvedValue({ valid: true });
		expect((await handleRequest(request('/api/appearance', { ...apply(), packageId: theme.packageId }, 'PUT'), h.env)).status).toBe(200);
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		const published = await handleRequest(request(path), h.env);
		expect(published.status).toBe(200);
		expect(published.headers.get('Cache-Control')).toContain('immutable');
		expect((await handleRequest(request('/api/appearance/assets/' + asset.hash), h.env)).status).toBe(401);
	});

	it('never responds to an old module URL with current build code', async () => {
		const h = environment();
		for (const path of ['/modules/appearance.js', '/modules/appearance.js?build=older-build']) {
			const response = await handleRequest(request(path), h.env);
			expect(response.status).toBe(409);
			expect(response.headers.get('X-2FA-Build')).toBe('fixture-build-2026');
		}
		expect(getModuleCode).not.toHaveBeenCalled();
		const current = await handleRequest(request('/modules/appearance.js?build=fixture-build-2026'), h.env);
		expect(current.status).toBe(200);
		expect(current.headers.get('X-2FA-Build')).toBe('fixture-build-2026');
		expect(await current.text()).toBe('/* isolated module */');
	});
});
