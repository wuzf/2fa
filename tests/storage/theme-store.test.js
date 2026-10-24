/* global structuredClone */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { ThemeStore } from '../../src/storage/theme-store.js';
import { SecretsStore, runSecretsOperation } from '../../src/storage/secrets-store.js';
import { handleThemeRequest, handleThemeAssetRequest, THEME_OPERATION_HEADER } from '../../src/api/themes.js';
import { LIMITS, getBuiltinTheme, normalizeAsset } from '../../src/themes/index.js';

const png = new Uint8Array(
	Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
);

function pngWithMetadata(size) {
	const bytes = new Uint8Array(size);
	const offset = png.length - 12;
	bytes.set(png.subarray(0, offset));
	const dataLength = size - png.length - 12;
	const view = new DataView(bytes.buffer);
	view.setUint32(offset, dataLength);
	bytes.set(new TextEncoder().encode('tEXtcomment\0'), offset + 4);
	bytes.fill(97, offset + 16, size - 16);
	let crc = 0xffffffff;
	for (const byte of bytes.subarray(offset + 4, size - 16)) {
		crc ^= byte;
		for (let index = 0; index < 8; index++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	view.setUint32(size - 16, (crc ^ 0xffffffff) >>> 0);
	bytes.set(png.subarray(-12), size - 12);
	return bytes;
}

class Storage {
	constructor() {
		this.data = new Map();
		this.nextAlarm = null;
		this.failChunk = false;
	}
	async get(key) {
		return structuredClone(this.data.get(key));
	}
	async put(key, value) {
		if (this.failChunk && key.startsWith('theme:chunk:')) {
			throw new Error('write failed');
		}
		if (value instanceof Uint8Array && value.byteLength > 128 * 1024) {
			throw new Error('value limit');
		}
		this.data.set(key, structuredClone(value));
	}
	async delete(key) {
		this.data.delete(key);
	}
	async list({ prefix = '' } = {}) {
		return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]));
	}
	async getAlarm() {
		return this.nextAlarm;
	}
	async setAlarm(time) {
		this.nextAlarm = time;
	}
	async transaction(fn) {
		const before = structuredClone(this.data);
		const alarm = this.nextAlarm;
		try {
			return await fn(this);
		} catch (error) {
			this.data = before;
			this.nextAlarm = alarm;
			throw error;
		}
	}
}

function harness() {
	const storage = new Storage();
	const values = new Map();
	const env = {
		SECRETS_KV: {
			get: vi.fn(async (key) => values.get(key) || null),
			put: vi.fn(async (key, value) => values.set(key, value)),
			delete: vi.fn(async (key) => values.delete(key)),
		},
		LOG_LEVEL: 'ERROR',
	};
	let store = new ThemeStore({ storage }, env);
	const request = async (path, body, method = body === undefined ? 'GET' : 'POST', operation = 'api') => {
		const headers = { [THEME_OPERATION_HEADER]: operation, 'Content-Type': 'application/json' };
		return store.fetch(
			new Request('https://test.example.com' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
		);
	};
	return {
		storage,
		env,
		values,
		request,
		get store() {
			return store;
		},
		evict() {
			store = new ThemeStore({ storage }, env);
		},
	};
}

const applyBody = (revision, extra = {}) => ({
	operationId: `operation_${revision}_${crypto.randomUUID()}`,
	expectedRevision: revision,
	packageId: 'builtin:fluent',
	settings: {},
	branding: {},
	customCss: '',
	...extra,
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function promptly(promise) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('read blocked by upload or download')), 1000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

describe('authoritative appearance state', () => {
	it('serves only published appearance and assets during an unfinished upload while writes remain serial', async () => {
		const h = harness();
		const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		const url = '/theme-assets/' + asset.hash + '/' + asset.name;
		await h.request('/api/appearance', applyBody(0, { branding: { logo: url, name: 'Published' } }), 'PUT');
		const incoming = await normalizeAsset(pngWithMetadata(1024), 'next.png');
		let controller;
		let started = false;
		const body = new ReadableStream({
			start(value) {
				controller = value;
			},
			pull() {
				started = true;
			},
		});
		const upload = h.store.fetch(
			new Request('https://test.example.com/api/appearance/assets', {
				method: 'POST',
				headers: { [THEME_OPERATION_HEADER]: 'api', 'X-File-Name': 'next.png' },
				body,
				duplex: 'half',
			}),
		);
		await vi.waitFor(() => expect(started).toBe(true));
		let writeFinished = false;
		const write = h.request('/api/appearance', applyBody(1, { branding: { name: 'Next' } }), 'PUT').then((response) => {
			writeFinished = true;
			return response;
		});
		try {
			const [appearance, image, hidden] = await promptly(
				Promise.all([
					h.request('/api/appearance', undefined, 'GET', 'appearance'),
					h.request(url, undefined, 'GET', 'public'),
					h.request('/theme-assets/' + incoming.hash + '/' + incoming.name, undefined, 'GET', 'public'),
				]),
			);
			expect(await appearance.json()).toMatchObject({ revision: 1, branding: { name: 'Published' } });
			expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
			expect(hidden.status).toBe(404);
			expect(writeFinished).toBe(false);
		} finally {
			controller.enqueue(incoming.bytes);
			controller.close();
		}
		expect((await upload).status).toBe(201);
		expect((await write).status).toBe(200);
		expect((await h.request('/theme-assets/' + incoming.hash + '/' + incoming.name, undefined, 'GET', 'public')).status).toBe(404);
	});

	it('does not hold published reads behind remote theme downloads', async () => {
		const h = harness();
		await h.request('/api/appearance', applyBody(0, { branding: { name: 'Published' } }), 'PUT');
		let release;
		const download = new Promise((resolve) => {
			release = resolve;
		});
		const fetcher = vi.fn(() => download);
		vi.stubGlobal('fetch', fetcher);
		const installing = h.request('/api/themes/import', { url: 'https://cdn.example.com/theme.css' });
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		try {
			const appearance = await promptly(h.request('/api/appearance', undefined, 'GET', 'appearance'));
			expect(await appearance.json()).toMatchObject({ revision: 1, branding: { name: 'Published' } });
		} finally {
			release(new Response('body{color:red}', { headers: { 'Content-Type': 'text/css' } }));
		}
		expect((await installing).status).toBe(201);
	});

	it('times out an unfinished request body and releases the write queue', async () => {
		const h = harness();
		vi.useFakeTimers();
		const cancel = vi.fn();
		const upload = h.store.fetch(
			new Request('https://test.example.com/api/themes/import', {
				method: 'POST',
				headers: { [THEME_OPERATION_HEADER]: 'api', 'X-File-Name': 'theme.css' },
				body: new ReadableStream({ cancel }),
				duplex: 'half',
			}),
		);
		await vi.advanceTimersByTimeAsync(LIMITS.totalMs + 1);
		expect((await upload).status).toBe(408);
		expect(cancel).toHaveBeenCalledOnce();
		expect((await h.request('/api/appearance', applyBody(0), 'PUT')).status).toBe(200);
	});

	it.each(['chunk', 'mirror'])(
		'lets an in-flight published %s read finish before GC removes its old snapshot resources',
		async (source) => {
			const h = harness();
			const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
			const url = '/theme-assets/' + asset.hash + '/' + asset.name;
			await h.request('/api/appearance', applyBody(0, { branding: { logo: url } }), 'PUT');
			let reached;
			const entered = new Promise((resolve) => {
				reached = resolve;
			});
			let release;
			const held = new Promise((resolve) => {
				release = resolve;
			});
			const read = h.storage.get.bind(h.storage);
			let hold = true;
			h.storage.get = async (key) => {
				if (source === 'chunk' && hold && key === 'theme:chunk:' + asset.hash + ':0') {
					hold = false;
					reached();
					await held;
				}
				return read(key);
			};
			if (source === 'mirror') {
				h.env.SECRETS_KV.get.mockImplementation(async () => {
					reached();
					await held;
					return null;
				});
			}
			const reading = h.request(url, undefined, 'GET', 'public');
			await entered;
			await h.request('/api/appearance', applyBody(1), 'PUT');
			await h.request('/api/appearance', applyBody(2), 'PUT');
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
			let cleaned = false;
			const previousGate = h.store.readGate;
			const cleanup = h.store.alarm().then(() => {
				cleaned = true;
			});
			try {
				await vi.waitFor(() => expect(h.store.readGate).not.toBe(previousGate));
				expect(cleaned).toBe(false);
				expect(h.storage.data.has('theme:chunk:' + asset.hash + ':0')).toBe(true);
			} finally {
				release();
			}
			expect(new Uint8Array(await (await reading).arrayBuffer())).toEqual(png);
			await cleanup;
			expect(h.storage.data.has('theme:chunk:' + asset.hash + ':0')).toBe(false);
			expect((await h.request(url, undefined, 'GET', 'public')).status).toBe(404);
			expect((await (await h.request('/api/appearance')).json()).revision).toBe(3);
		},
	);
	it('separates the theme object from secrets and uses the existing class alarm entrypoint', async () => {
		const h = harness();
		const instance = new SecretsStore({ id: { toString: () => 'appearance' }, storage: h.storage }, h.env);
		const response = await instance.fetch(
			new Request('https://test.example.com/api/appearance', { headers: { [THEME_OPERATION_HEADER]: 'api' } }),
		);
		expect(response.status).toBe(200);
		expect((await response.json()).active.packageId).toBe('builtin:fluent');
		await instance.alarm();
		expect(h.storage.nextAlarm).toBeGreaterThan(Date.now());
		expect(h.storage.data.has('theme:owner')).toBe(true);
	});

	it('checks idempotency before revision and rejects a reused operation ID with different content', async () => {
		const h = harness();
		const body = applyBody(0, { branding: { name: 'My vault' } });
		const first = await h.request('/api/appearance', body, 'PUT');
		expect(first.status).toBe(200);
		expect((await first.json()).revision).toBe(1);
		h.evict();
		const replay = await h.request('/api/appearance', body, 'PUT');
		expect(replay.status).toBe(200);
		expect(await replay.json()).toMatchObject({ revision: 1, replayed: true, active: { branding: { name: 'My vault' } } });
		const changed = await h.request('/api/appearance', { ...body, branding: { name: 'Different' } }, 'PUT');
		expect(changed.status).toBe(409);
		expect((await changed.json()).error).toBe('THEME_OPERATION_REUSED');
	});

	it('allows only one of two devices applying from the same revision and never replays stale state', async () => {
		const h = harness();
		const firstBody = applyBody(0);
		const results = await Promise.all([h.request('/api/appearance', firstBody, 'PUT'), h.request('/api/appearance', applyBody(0), 'PUT')]);
		expect(results.map((item) => item.status)).toEqual([200, 409]);
		expect((await h.request('/api/appearance', applyBody(1, { packageId: 'builtin:compact' }), 'PUT')).status).toBe(200);
		expect((await (await h.request('/api/appearance', firstBody, 'PUT')).json()).revision).toBe(1);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(2);
	});

	it('rolls back the complete snapshot with a new revision and preserves per-theme settings', async () => {
		const h = harness();
		expect(
			(
				await h.request(
					'/api/appearance',
					applyBody(0, { branding: { name: 'Old' }, customCss: '.card{color:red}', settings: { radius: '8px' } }),
					'PUT',
				)
			).status,
		).toBe(200);
		expect(
			(await h.request('/api/appearance', applyBody(1, { packageId: 'builtin:compact', branding: { name: 'New' } }), 'PUT')).status,
		).toBe(200);
		const response = await h.request('/api/appearance/rollback', applyBody(2));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			revision: 3,
			active: { packageId: 'builtin:fluent', branding: { name: 'Old' }, settings: { radius: '8px' }, customCss: '.card{color:red}' },
		});
		const list = await (await h.request('/api/themes')).json();
		expect(list.themes.find((theme) => theme.packageId === 'builtin:compact').profile.branding.name).toBe('New');
	});

	it('does not publish or lose current state when normalized settings are invalid', async () => {
		const h = harness();
		await h.request('/api/appearance', applyBody(0), 'PUT');
		const bad = await h.request('/api/appearance', applyBody(1, { settings: { unknown: 'value' } }), 'PUT');
		expect(bad.status).toBe(400);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
	});

	it('preserves user text components through application and rollback', async () => {
		const h = harness();
		const layout = getBuiltinTheme('builtin:fluent').manifest.layout;
		layout.trailing.push({ id: 'personal-note', type: 'text' });
		const content = { 'personal-note': { title: 'My 2FA', text: 'Personal workspace' } };
		const applied = await h.request('/api/appearance', applyBody(0, { layout, content }), 'PUT');
		expect(applied.status).toBe(200);
		expect((await applied.json()).active.content).toEqual(content);
		await h.request('/api/appearance', applyBody(1), 'PUT');
		const rolledBack = await h.request('/api/appearance/rollback', applyBody(2));
		expect((await rolledBack.json()).active.content).toEqual(content);
	});

	it('preserves old appearance on resource storage failure and releases its quota reservation', async () => {
		const h = harness();
		h.storage.failChunk = true;
		const response = await h.request('/api/appearance', applyBody(0), 'PUT');
		expect(response.status).toBe(500);
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(0);
		expect(h.storage.data.get('theme:quota').bytes).toBe(0);
	});
});

describe('theme resources and maintenance', () => {
	it('reimports large ordinary STORE exports through raw and multipart fetch requests', async () => {
		const source = harness();
		const large = pngWithMetadata(6 * 1024 * 1024);
		const encode = (text) => new TextEncoder().encode(text);
		const compressed = zipSync({
			'2fa-theme.json': encode(
				JSON.stringify({ themeApiVersion: 1, id: 'large-theme', name: 'Large theme', version: '1.0.0', styles: 'theme.css' }),
			),
			'theme.css': encode('body{background:url(a.png)}'),
			'a.png': large,
		});
		expect(compressed.length).toBeLessThan(5 * 1024 * 1024);
		const imported = await source.store.fetch(
			new Request('https://test.example.com/api/themes/import', {
				method: 'POST',
				headers: { [THEME_OPERATION_HEADER]: 'api', 'Content-Type': 'application/zip', 'X-File-Name': 'theme.zip' },
				body: compressed,
			}),
		);
		expect(imported.status).toBe(201);
		const { theme } = await imported.json();
		const exported = await source.request('/api/themes/' + theme.packageId + '/export');
		expect(exported.status).toBe(200);
		const bytes = new Uint8Array(await exported.arrayBuffer());
		expect(bytes.length).toBeGreaterThan(5 * 1024 * 1024);
		expect(bytes.length).toBeLessThanOrEqual(LIMITS.upload);
		for (const multipart of [false, true]) {
			const target = harness();
			const headers = { [THEME_OPERATION_HEADER]: 'api' };
			let body = bytes;
			if (multipart) {
				body = new FormData();
				body.append('file', new Blob([bytes], { type: 'application/zip' }), 'exported-theme.zip');
			} else {
				headers['Content-Type'] = 'application/zip';
				headers['X-File-Name'] = 'exported-theme.zip';
			}
			const restored = await target.store.fetch(
				new Request('https://test.example.com/api/themes/import', { method: 'POST', headers, body }),
			);
			expect(restored.status).toBe(201);
			expect((await restored.json()).theme.packageId).toBe(theme.packageId);
			expect((await (await target.request('/api/appearance')).json()).revision).toBe(0);
		}
	}, 10000);

	it('exports and restores a complete near-limit appearance including personal branding and CSS', async () => {
		const source = harness();
		const large = pngWithMetadata(10 * 1024 * 1024 - 48 * 1024);
		const { asset } = await source.store.uploadAsset({ bytes: large, name: 'large-background.png' });
		const applied = await source.request(
			'/api/appearance',
			applyBody(0, {
				branding: { name: 'Personal 2FA', background: asset.url, logo: asset.url },
				settings: { radius: '8px' },
				customCss: `body{background-image:url("${asset.url}")}`,
			}),
			'PUT',
		);
		expect(applied.status).toBe(200);
		const archive = await source.request('/api/appearance/export');
		expect(archive.status).toBe(200);
		const bytes = new Uint8Array(await archive.arrayBuffer());
		expect(bytes.length).toBeGreaterThan(9 * 1024 * 1024);
		expect(bytes.length).toBeLessThan(12 * 1024 * 1024);
		const target = harness();
		const restored = await target.store.install({ bytes, name: 'appearance.zip' }, true);
		expect(restored.appearance.resources.map((resource) => resource.hash)).toEqual([asset.hash]);
		expect((await (await target.request('/api/appearance')).json()).revision).toBe(0);
		const result = await target.request(
			'/api/appearance',
			applyBody(0, { ...restored.appearance, packageId: restored.theme.packageId }),
			'PUT',
		);
		expect(result.status).toBe(200);
		const snapshot = (await result.json()).active;
		expect(snapshot.branding.name).toBe('Personal 2FA');
		expect(snapshot.settings.radius).toBe('8px');
		expect(snapshot.customCss).toContain(asset.hash);
		expect(snapshot.resources).toHaveLength(1);
		const fetched = await target.request(snapshot.resources[0].url, undefined, 'GET', 'public');
		expect(Buffer.from(await fetched.arrayBuffer()).equals(Buffer.from(large))).toBe(true);
	}, 20000);

	it('does not delete installed versions while active or previous snapshots reference them', async () => {
		const h = harness();
		const installed = await h.store.install({ bytes: new TextEncoder().encode('body{color:blue}'), name: 'my-theme.css' });
		const id = installed.theme.packageId;
		expect((await h.request('/api/appearance', applyBody(0, { packageId: id }), 'PUT')).status).toBe(200);
		expect((await h.request('/api/themes/' + id, undefined, 'DELETE')).status).toBe(409);
		await h.request('/api/appearance', applyBody(1), 'PUT');
		expect((await h.request('/api/themes/' + id, undefined, 'DELETE')).status).toBe(409);
		await h.request('/api/appearance', applyBody(2, { packageId: 'builtin:compact' }), 'PUT');
		expect((await h.request('/api/themes/' + id, undefined, 'DELETE')).status).toBe(200);
		expect((await (await h.request('/api/themes')).json()).themes).toHaveLength(3);
	});

	it('does not install a new version over the limit or replace the active appearance', async () => {
		const h = harness();
		await h.request('/api/appearance', applyBody(0), 'PUT');
		for (let i = 0; i < 20; i++) {
			await h.storage.put('theme:package:reserved-' + i, { status: 'installing', expiresAt: Date.now() + 100000 });
		}
		await expect(h.store.install({ bytes: new TextEncoder().encode('body{color:green}'), name: 'theme.css' })).rejects.toMatchObject({
			code: 'THEME_VERSION_CAPACITY',
		});
		expect((await (await h.request('/api/appearance')).json()).revision).toBe(1);
	});

	it('requires publication before public reads, even when KV already contains the bytes', async () => {
		const h = harness();
		const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		h.values.set('theme-assets:v1:' + asset.hash, png);
		let response = await h.request(`/theme-assets/${asset.hash}/logo.png`, undefined, 'GET', 'public');
		expect(response.status).toBe(404);
		expect(h.env.SECRETS_KV.get).not.toHaveBeenCalled();
		response = await h.request(`/api/appearance/assets/${asset.hash}`);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
		response = await h.request('/api/appearance', applyBody(0, { branding: { logo: asset.url } }), 'PUT');
		expect(response.status).toBe(200);
		response = await h.request(`/theme-assets/${asset.hash}/logo.png`, undefined, 'GET', 'public');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
	});

	it('falls back to authoritative chunks when the mirror is missing, stale or unavailable', async () => {
		const h = harness();
		const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		await h.request('/api/appearance', applyBody(0, { branding: { logo: asset.url } }), 'PUT');
		for (const value of [null, new Uint8Array(png.length)]) {
			h.env.SECRETS_KV.get.mockResolvedValueOnce(value);
			const result = await h.request(`/theme-assets/${asset.hash}/logo.png`, undefined, 'GET', 'public');
			expect(new Uint8Array(await result.arrayBuffer())).toEqual(png);
		}
		h.env.SECRETS_KV.get.mockRejectedValueOnce(new Error('KV unavailable'));
		expect((await h.request(`/theme-assets/${asset.hash}/logo.png`, undefined, 'GET', 'public')).status).toBe(200);
	});

	it('chunks large assets, survives eviction, and renews an expired local draft by re-upload', async () => {
		vi.useFakeTimers();
		const h = harness();
		const large = pngWithMetadata(300000);
		const { asset } = await h.store.uploadAsset({ bytes: large, name: 'large.png' });
		expect((await h.storage.list({ prefix: `theme:chunk:${asset.hash}:` })).size).toBe(3);
		h.evict();
		vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
		await h.store.alarm();
		expect((await h.request(`/api/appearance/assets/${asset.hash}`)).status).toBe(404);
		const renewed = await h.store.uploadAsset({ bytes: large, name: 'large.png' });
		expect(renewed.asset.hash).toBe(asset.hash);
		expect((await h.request('/api/appearance', applyBody(0, { branding: { logo: renewed.asset.url } }), 'PUT')).status).toBe(200);
	});

	it('retries mirror tasks after eviction without another user request and retains referenced assets through GC', async () => {
		vi.useFakeTimers();
		const h = harness();
		const { asset } = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		await h.request('/api/appearance', applyBody(0, { branding: { logo: asset.url } }), 'PUT');
		h.env.SECRETS_KV.put.mockRejectedValueOnce(new Error('temporary KV failure'));
		vi.setSystemTime(Date.now() + 60000);
		await h.store.alarm();
		let record = await h.storage.get('theme:blob:' + asset.hash);
		expect(record.attempts).toBe(1);
		expect(h.storage.nextAlarm).toBe(record.nextAttemptAt);
		h.evict();
		vi.setSystemTime(record.nextAttemptAt);
		await h.store.alarm();
		record = await h.storage.get('theme:blob:' + asset.hash);
		expect(record.mirrored).toBe(true);
		vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000);
		await h.store.alarm();
		expect((await h.request(`/api/appearance/assets/${asset.hash}`)).status).toBe(200);
	});

	it('reserves shared capacity before parallel uploads can exceed it', async () => {
		const h = harness();
		await h.storage.put('theme:quota', { bytes: 50 * 1024 * 1024 - png.length });
		const first = await h.store.uploadAsset({ bytes: png, name: 'logo.png' });
		expect(first.asset.hash).toBeTruthy();
		const other = pngWithMetadata(png.length + 32);
		await expect(h.store.uploadAsset({ bytes: other, name: 'other.png' })).rejects.toMatchObject({ code: 'THEME_CAPACITY' });
		expect(h.storage.data.get('theme:quota').bytes).toBe(50 * 1024 * 1024);
	});
});

describe('theme API binding and boundary', () => {
	it('supports builtin previews without a binding and rejects writes instead of falling back to KV', async () => {
		const env = { SECRETS_KV: { put: vi.fn() } };
		const response = await handleThemeRequest(new Request('https://test.example.com/api/appearance'), env);
		expect((await response.json()).capabilities.write).toBe(false);
		const write = await handleThemeRequest(new Request('https://test.example.com/api/appearance', { method: 'PUT', body: '{}' }), env);
		expect(write.status).toBe(503);
		expect(env.SECRETS_KV.put).not.toHaveBeenCalled();
	});

	it('chooses the appearance object and overwrites incoming internal dispatch headers', async () => {
		const captured = [];
		const env = {
			SECRETS_STORE: {
				idFromName: (name) => name,
				get: (id) => ({
					fetch: async (request) => {
						captured.push({ id, request });
						return Response.json({ ok: true });
					},
				}),
			},
		};
		await handleThemeRequest(
			new Request('https://test.example.com/api/themes', {
				headers: { [THEME_OPERATION_HEADER]: 'public', 'X-2FA-Store-Operation': 'secrets.list' },
			}),
			env,
		);
		expect(captured[0].id).toBe('appearance:v1');
		expect(captured[0].request.headers.get(THEME_OPERATION_HEADER)).toBe('api');
		expect(captured[0].request.headers.has('X-2FA-Store-Operation')).toBe(false);
		await handleThemeAssetRequest(new Request('https://test.example.com/theme-assets/' + '0'.repeat(64) + '/logo.png'), env);
		expect(captured[1].request.headers.get(THEME_OPERATION_HEADER)).toBe('public');
		await runSecretsOperation(
			'secrets.list',
			new Request('https://test.example.com/api/secrets', { headers: { [THEME_OPERATION_HEADER]: 'api' } }),
			env,
		);
		expect(captured[2].id).toBe('secrets');
		expect(captured[2].request.headers.has(THEME_OPERATION_HEADER)).toBe(false);
	});

	it('offers three builtin manifests without modifying their definitions', async () => {
		const h = harness();
		const list = await (await h.request('/api/themes')).json();
		expect(list.themes.map((theme) => theme.packageId)).toEqual(['builtin:fluent', 'builtin:document', 'builtin:compact']);
		expect(getBuiltinTheme('builtin:fluent').assets).toEqual([]);
	});
});
