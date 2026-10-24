/* global structuredClone */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/router/handler.js';
import { verifyAuthWithDetails, checkIfSetupRequired, requiresAuth } from '../../src/utils/auth.js';
import { readSettingsSnapshot } from '../../src/storage/secrets-store.js';
import { createMainPage } from '../../src/ui/page.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { ThemeStore } from '../../src/storage/theme-store.js';

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
	if (withStore)
		{env.SECRETS_STORE = {
			idFromName: (name) => name,
			get: (name) => ({
				fetch: (request) => {
					requests.push({ name, request });
					return store.fetch(request);
				},
			}),
		};}
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

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('__2FA_BUILD_ID__', 'fixture-build-2026');
	verifyAuthWithDetails.mockResolvedValue({ valid: true, token: 'authenticated' });
	checkIfSetupRequired.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('theme routes authentication and capabilities', () => {
	it.each(['/api/themes', '/api/appearance', '/api/appearance/assets/' + 'a'.repeat(64), '/api/appearance/export'])(
		'requires authentication before reading %s',
		async (path) => {
			const h = environment();
			verifyAuthWithDetails.mockResolvedValue({ valid: false });
			expect(requiresAuth(path)).toBe(true);
			expect((await handleRequest(request(path), h.env)).status).toBe(401);
			expect(h.requests).toHaveLength(0);
		},
	);

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

describe('theme routes recovery and resource boundary', () => {
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
		expect(createMainPage).toHaveBeenCalledWith(expect.objectContaining({ appearance: null, lazyLoad: false, buildId: '' }));
		expect(h.requests).toHaveLength(0);
	});

	it('returns public resources before auth/setup only when the authoritative publication record permits them', async () => {
		const h = environment();
		const png = new Uint8Array(
			Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
		);
		const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		const path = '/theme-assets/' + asset.hash + '/' + asset.name;
		verifyAuthWithDetails.mockResolvedValue({ valid: false });
		expect((await handleRequest(request(path), h.env)).status).toBe(404);
		expect(checkIfSetupRequired).not.toHaveBeenCalled();
		expect(verifyAuthWithDetails).not.toHaveBeenCalled();
		verifyAuthWithDetails.mockResolvedValue({ valid: true });
		expect((await handleRequest(request('/api/appearance', { ...apply(), branding: { logo: asset.url } }, 'PUT'), h.env)).status).toBe(200);
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
