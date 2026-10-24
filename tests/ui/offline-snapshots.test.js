import { describe, expect, it, vi } from 'vitest';
import { createSnapshotManager } from '../../src/ui/offlineSnapshots.js';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

const build = 'a'.repeat(64);
const origin = 'https://2fa.example.com';
function harness() {
	const state = { generation: 0, active: null, previous: null, target: null, pins: {} };
	const stored = new Map();
	const key = (request) => (typeof request === 'string' ? request : request.url);
	const caches = {
		open: async (name) => {
			if (!stored.has(name)) {
				stored.set(name, new Map());
			}
			const entries = stored.get(name);
			return {
				put: async (request, response) => entries.set(key(request), response.clone()),
				match: async (request) => entries.get(key(request))?.clone(),
			};
		},
		match: async (request) => {
			for (const entries of stored.values()) {
				if (entries.has(key(request))) {
					return entries.get(key(request)).clone();
				}
			}
		},
		keys: async () => [...stored.keys()],
		delete: async (name) => stored.delete(name),
	};
	let revision = 1;
	let serverBuild = build;
	const clients = { matchAll: vi.fn(async () => []) };
	const fetch = vi.fn(async (address) => {
		const url = new URL(address);
		if (url.pathname === '/') {
			return new Response(url.search ? 'SAFE' : 'MAIN ' + revision, {
				headers: { 'X-2FA-Build': serverBuild, 'X-2FA-Appearance-Revision': String(revision) },
			});
		}
		return new Response(
			url.pathname === '/manifest.json'
				? JSON.stringify({ icons: [], name: 'Brand ' + revision })
				: url.pathname.startsWith('/icon-')
					? 'ICON ' + revision
					: 'resource',
		);
	});
	const manager = createSnapshotManager({
		buildId: build,
		origin,
		caches,
		fetch,
		clients,
		index: {
			read: async () => globalThis.structuredClone(state),
			update: async (change) => globalThis.structuredClone(change(state)),
		},
	});
	return {
		state,
		stored,
		caches,
		fetch,
		clients,
		manager,
		setRevision: (value) => {
			revision = value;
		},
		setBuild: (value) => {
			serverBuild = value;
		},
	};
}

describe('complete offline appearance snapshots', () => {
	it.each([503, 500, 401, 403, 404])('handles HTTP %i for cached public theme resources without masking denials', async (status) => {
		const h = harness();
		const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cached theme image'))), (byte) =>
			byte.toString(16).padStart(2, '0'),
		).join('');
		const assetUrl = origin + '/theme-assets/' + hash + '/background.png';
		const originalFetch = h.fetch.getMockImplementation();
		h.fetch.mockImplementation((url) =>
			String(url) === assetUrl ? Promise.resolve(new Response('cached theme image')) : originalFetch(url),
		);
		await h.manager.stage({ revision: 1, resources: [{ url: assetUrl }] });
		const cache = await h.caches.open(h.state.active.cacheName);
		await cache.put(assetUrl, new Response('cached theme image'));
		await h.manager.match(new Request(origin + '/'), 'fallback-tab');
		const listeners = new Map();
		const worker = { location: { origin }, addEventListener: (name, callback) => listeners.set(name, callback) };
		const network = vi.fn(async () => new Response('server response', { status }));
		const source = (await createServiceWorker().text()).replace(
			/const snapshotManager = [\s\S]*?\nconst DB_NAME/,
			'const snapshotManager = testSnapshots;\nconst runtimeSnapshots = null;\nconst DB_NAME',
		);
		const silent = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
		// eslint-disable-next-line no-new-func
		new Function('self', 'location', 'fetch', 'caches', 'console', 'testSnapshots', source)(
			worker,
			worker.location,
			network,
			h.caches,
			silent,
			h.manager,
		);
		const requestAsset = (url) => {
			let result;
			listeners.get('fetch')({
				clientId: 'fallback-tab',
				request: new Request(url),
				respondWith: (value) => {
					result = value;
				},
			});
			return result;
		};
		const cached = await requestAsset(assetUrl);
		expect(cached.status).toBe(status >= 500 ? 200 : status);
		expect(await cached.text()).toBe(status >= 500 ? 'cached theme image' : 'server response');
		const missing = await requestAsset(origin + '/theme-assets/' + 'e'.repeat(64) + '/missing.png');
		expect(missing.status).toBe(status);
		expect(await missing.text()).toBe('server response');
	});
	it('promotes only after both shells, manifest and required assets are stored', async () => {
		const h = harness();
		expect(await h.manager.stage({ revision: 1, resources: [{ url: '/theme-assets/hash/image.png' }] })).toEqual({
			ready: true,
			revision: 1,
		});
		expect(h.stored.get(h.state.active.cacheName).size).toBe(7);
		expect(await (await h.manager.match(new Request(origin + '/'))).text()).toBe('MAIN 1');
		expect(await (await h.manager.match(new Request(origin + '/?disableCustomCode=1'))).text()).toBe('SAFE');
	});
	it('keeps the old complete shell when one required asset fails', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		const old = h.state.active.cacheName;
		h.setRevision(2);
		const normal = h.fetch.getMockImplementation();
		h.fetch.mockImplementation((url) => (String(url).includes('broken') ? Promise.reject(new Error('offline')) : normal(url)));
		await expect(h.manager.stage({ revision: 2, resources: [{ url: '/theme-assets/broken/image.png' }] })).rejects.toThrow('offline');
		expect(h.state.active.cacheName).toBe(old);
		expect(h.stored.size).toBe(1);
	});
	it('never promotes a late older appearance candidate over a completed newer candidate', async () => {
		const h = harness();
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const normal = h.fetch.getMockImplementation();
		h.fetch.mockImplementation(async (url) => {
			if (String(url).includes('slow')) {
				await held;
			}
			return normal(url);
		});
		const older = h.manager.stage({ revision: 1, resources: [{ url: '/theme-assets/slow/image.png' }] });
		await vi.waitFor(() => expect(h.fetch.mock.calls.some(([url]) => url.includes('slow'))).toBe(true));
		h.setRevision(2);
		expect((await h.manager.stage({ revision: 2 })).ready).toBe(true);
		release();
		expect(await older).toEqual({ ready: false, reason: 'outdated' });
		expect(h.state.active.revision).toBe(2);
	});
	it('also prevents two same-revision candidates from reversing generation order', async () => {
		const h = harness();
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const normal = h.fetch.getMockImplementation();
		h.fetch.mockImplementation(async (url) => {
			if (String(url).includes('slow')) {
				await held;
			}
			return normal(url);
		});
		const older = h.manager.stage({ revision: 1, resources: [{ url: '/theme-assets/slow/image.png' }] });
		await vi.waitFor(() => expect(h.fetch.mock.calls.some(([url]) => url.includes('slow'))).toBe(true));
		await h.manager.stage({ revision: 1 });
		release();
		expect((await older).ready).toBe(false);
		expect(h.state.active.generation).toBe(2);
	});
	it('requires current server proof and rejects a delayed message from an old build', async () => {
		const h = harness();
		expect((await h.manager.stage({ revision: 1 }, 'b'.repeat(64))).ready).toBe(false);
		expect(h.fetch).not.toHaveBeenCalled();
		h.setBuild('b'.repeat(64));
		expect((await h.manager.stage({ revision: 1 })).ready).toBe(false);
		expect(h.state.active).toBeNull();
	});
	it('a server revision mismatch cannot set the target', async () => {
		const h = harness();
		h.setRevision(2);
		expect((await h.manager.stage({ revision: 1 })).ready).toBe(false);
		expect(h.state.target).toBeNull();
	});
	it('a rollback gets its new revision and preserves the last complete snapshot', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		h.setRevision(3);
		await h.manager.stage({ revision: 3 });
		expect(h.state.previous.revision).toBe(1);
		expect(h.state.active.revision).toBe(3);
	});
	it('preserves legacy caches until the first successful snapshot and all live clients identify themselves', async () => {
		const h = harness();
		await h.caches.open('2fa-cache-v1');
		h.clients.matchAll.mockResolvedValue([{ id: 'legacy' }]);
		await h.manager.clean();
		await h.manager.stage({ revision: 1 });
		expect(h.stored.has('2fa-cache-v1')).toBe(true);
		await h.manager.pin('legacy', '');
		await h.manager.clean();
		expect(h.stored.has('2fa-cache-v1')).toBe(true);
		h.clients.matchAll.mockResolvedValue([]);
		await h.manager.clean();
		expect(h.stored.has('2fa-cache-v1')).toBe(false);
	});
	it('retains old build module caches while a tab still uses them', async () => {
		const h = harness();
		const oldBuild = 'b'.repeat(64);
		await h.caches.open('2fa-modules-' + oldBuild);
		await h.caches.open('2fa-cache-' + oldBuild);
		await h.caches.open('2fa-runtime-' + oldBuild);
		h.clients.matchAll.mockResolvedValue([{ id: 'old-tab' }]);
		await h.manager.pin('old-tab', oldBuild);
		await h.manager.stage({ revision: 1 });
		expect(h.stored.has('2fa-modules-' + oldBuild)).toBe(true);
		expect(h.stored.has('2fa-cache-' + oldBuild)).toBe(true);
		expect(h.stored.has('2fa-runtime-' + oldBuild)).toBe(true);
		h.clients.matchAll.mockResolvedValue([]);
		await h.manager.clean();
		expect(h.stored.has('2fa-modules-' + oldBuild)).toBe(false);
		expect(h.stored.has('2fa-cache-' + oldBuild)).toBe(false);
		expect(h.stored.has('2fa-runtime-' + oldBuild)).toBe(false);
	});
	it('rejects external or private assets without changing the active snapshot', async () => {
		for (const url of ['https://external.invalid/a.png', '/api/appearance/assets/private']) {
			const h = harness();
			await expect(h.manager.stage({ revision: 1, resources: [{ url }] })).rejects.toThrow('Invalid snapshot resource');
			expect(h.state.active).toBeNull();
		}
	});
	it('falls back to the previous entire shell if a required cached asset was evicted', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		h.setRevision(2);
		await h.manager.stage({ revision: 2, resources: [{ url: '/theme-assets/required/image.png' }] });
		h.stored.get(h.state.active.cacheName).delete(origin + '/theme-assets/required/image.png');
		expect(await (await h.manager.match(new Request(origin + '/'))).text()).toBe('MAIN 1');
		expect(await (await h.manager.match(new Request(origin + '/?safeMode=1'))).text()).toBe('SAFE');
	});
	it('can repair an evicted active cache without a new server revision', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		h.stored.delete(h.state.active.cacheName);
		expect((await h.manager.stage({ revision: 1 })).ready).toBe(true);
		expect(await (await h.manager.match(new Request(origin + '/'))).text()).toBe('MAIN 1');
	});
	it('never promotes corrupt bytes returned for a content-addressed resource', async () => {
		const h = harness();
		await expect(h.manager.stage({ revision: 1, resources: [{ url: '/theme-assets/' + 'f'.repeat(64) + '/image.png' }] })).rejects.toThrow(
			'hash mismatch',
		);
		expect(h.state.active).toBeNull();
	});
	it('does not delete a newly promoted snapshot when an earlier cleanup resumes', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		const list = h.caches.keys;
		let intercept = true;
		h.caches.keys = async () => {
			if (intercept) {
				intercept = false;
				h.setRevision(2);
				await h.manager.stage({ revision: 2 });
			}
			return list();
		};
		await h.manager.clean();
		expect(h.state.active.revision).toBe(2);
		expect(h.stored.has(h.state.active.cacheName)).toBe(true);
		expect(await (await h.manager.match(new Request(origin + '/'))).text()).toBe('MAIN 2');
	});
	it('rejects mixed mutable manifest/icon data when the server changed without a new page message', async () => {
		const h = harness();
		const normal = h.fetch.getMockImplementation();
		h.fetch.mockImplementation((url) => {
			if (String(url).includes('/manifest.json')) {
				h.setRevision(2);
			}
			return normal(url);
		});
		expect(await h.manager.stage({ revision: 1 })).toEqual({ ready: false, reason: 'outdated' });
		expect(h.state.active).toBeNull();
		expect(h.stored.size).toBe(0);
	});
	it('binds a fallback document and every mutable resource to the same complete snapshot', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		h.setRevision(2);
		await h.manager.stage({ revision: 2, resources: [{ url: '/theme-assets/required/image.png' }] });
		h.stored.get(h.state.active.cacheName).delete(origin + '/theme-assets/required/image.png');
		expect(await (await h.manager.match(new Request(origin + '/'), 'fallback-tab')).text()).toBe('MAIN 1');
		const selected = h.state.pins['fallback-tab'].cacheName;
		expect((await (await h.manager.match(new Request(origin + '/manifest.json?appearance=1&lang=en'), 'fallback-tab')).json()).name).toBe(
			'Brand 1',
		);
		expect((await (await h.manager.match(new Request(origin + '/manifest.json?appearance=1'))).json()).name).toBe('Brand 1');
		expect(await (await h.manager.match(new Request(origin + '/icon-192.png'), 'fallback-tab')).text()).toBe('ICON 1');
		expect(await (await h.manager.boundResource(new Request(origin + '/icon-192.png'), 'fallback-tab')).text()).toBe('ICON 1');
		expect(await h.manager.boundResource(new Request(origin + '/icon-192.png'), 'new-online-tab')).toBeNull();
		expect(await (await h.manager.match(new Request(origin + '/icon-192.png'))).text()).toBe('ICON 1');
		// A boot PIN and two later complete promotions must not detach this tab.
		await h.manager.pin('fallback-tab', build, 1);
		expect(h.state.pins['fallback-tab'].cacheName).toBe(selected);
		h.clients.matchAll.mockResolvedValue([{ id: 'fallback-tab' }]);
		for (const revision of [3, 4]) {
			h.setRevision(revision);
			await h.manager.stage({ revision });
		}
		expect(h.stored.has(selected)).toBe(true);
		expect((await (await h.manager.match(new Request(origin + '/manifest.json?appearance=1'), 'fallback-tab')).json()).name).toBe(
			'Brand 1',
		);
		expect(await (await h.manager.match(new Request(origin + '/icon-512.png'), 'fallback-tab')).text()).toBe('ICON 1');
		// Never replace a missing old icon or explicitly mismatched manifest with a newer one.
		h.stored.get(selected).delete(origin + '/icon-192.png');
		expect(await h.manager.match(new Request(origin + '/icon-192.png'), 'fallback-tab')).toBeNull();
		expect((await h.manager.boundResource(new Request(origin + '/icon-192.png'), 'fallback-tab')).status).toBe(503);
		expect(await h.manager.match(new Request(origin + '/manifest.json?appearance=4'), 'fallback-tab')).toBeNull();
	});
	it('preserves the recovery-shell binding when safe mode boots without an appearance revision', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		expect(await (await h.manager.match(new Request(origin + '/?safeMode=1'), 'safe-tab')).text()).toBe('SAFE');
		const selected = h.state.pins['safe-tab'].cacheName;
		await h.manager.pin('safe-tab', build);
		expect(h.state.pins['safe-tab'].cacheName).toBe(selected);
		expect(h.state.pins['safe-tab'].safeMode).toBe(true);
		expect((await (await h.manager.match(new Request(origin + '/manifest.json?appearance=0'), 'safe-tab')).json()).name).toBe('Brand 1');
	});
	it('completes a pre-publication page pin when its candidate promotes', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		await h.manager.pin('editing-tab', build, 2);
		expect(h.state.pins['editing-tab'].cacheName).toBeUndefined();
		h.clients.matchAll.mockResolvedValue([{ id: 'editing-tab' }]);
		h.setRevision(2);
		await h.manager.stage({ revision: 2 });
		const selected = h.state.pins['editing-tab'].cacheName;
		expect(selected).toBe(h.state.active.cacheName);
		for (const revision of [3, 4]) {
			h.setRevision(revision);
			await h.manager.stage({ revision });
		}
		expect(h.stored.has(selected)).toBe(true);
		expect((await (await h.manager.match(new Request(origin + '/manifest.json?appearance=2'), 'editing-tab')).json()).name).toBe('Brand 2');
		expect(await (await h.manager.match(new Request(origin + '/icon-192.png'), 'editing-tab')).text()).toBe('ICON 2');
	});
	it('protects a navigation binding before the resulting client appears in clients.matchAll', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		await h.manager.match(new Request(origin + '/'), 'incoming-tab');
		const selected = h.state.pins['incoming-tab'].cacheName;
		// The response has not been delivered yet, so the new client is absent.
		for (const revision of [2, 3]) {
			h.setRevision(revision);
			await h.manager.stage({ revision });
		}
		expect(h.stored.has(selected)).toBe(true);
		expect(h.state.pins['incoming-tab'].cacheName).toBe(selected);
		expect(await (await h.manager.match(new Request(origin + '/icon-192.png'), 'incoming-tab')).text()).toBe('ICON 1');
		// An abandoned navigation eventually releases both its cache and pin.
		h.state.pins['incoming-tab'].pendingUntil = Date.now() - 1;
		await h.manager.clean();
		expect(h.stored.has(selected)).toBe(false);
		expect(h.state.pins['incoming-tab']).toBeUndefined();
	});
	it('serves an online language change from the network while a fallback tab keeps its selected manifest', async () => {
		const h = harness();
		await h.manager.stage({ revision: 1 });
		await h.manager.pin('online-tab', build, 1);
		expect(h.state.pins['online-tab'].cacheName).toBe(h.state.active.cacheName);
		expect(h.state.pins['online-tab'].fromFallback).toBeUndefined();
		const listeners = new Map();
		const worker = { location: { origin }, addEventListener: (name, callback) => listeners.set(name, callback) };
		const network = vi.fn(
			async (request) =>
				new Response(JSON.stringify({ name: new URL(request.url).searchParams.get('lang') === 'fr' ? 'Marque' : 'Brand' })),
		);
		// Inject the real manager with its deterministic storage adapter, then run
		// the emitted fetch handler. This checks the online/cache routing as well
		// as the binding rule without requiring a browser IndexedDB implementation.
		const source = (await createServiceWorker().text()).replace(
			/const snapshotManager = [\s\S]*?\nconst DB_NAME/,
			'const snapshotManager = testSnapshots;\nconst runtimeSnapshots = null;\nconst DB_NAME',
		);
		const silent = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
		// eslint-disable-next-line no-new-func
		new Function('self', 'location', 'fetch', 'caches', 'console', 'testSnapshots', source)(
			worker,
			worker.location,
			network,
			h.caches,
			silent,
			h.manager,
		);
		const requestManifest = (clientId) => {
			let result;
			listeners.get('fetch')({
				clientId,
				request: new Request(origin + '/manifest.json?appearance=1&lang=fr'),
				respondWith: (value) => {
					result = value;
				},
			});
			return result;
		};
		expect((await (await requestManifest('online-tab')).json()).name).toBe('Marque');
		expect(network).toHaveBeenCalledTimes(1);
		await h.manager.match(new Request(origin + '/'), 'fallback-tab');
		await h.manager.pin('fallback-tab', build, 1);
		expect(h.state.pins['fallback-tab'].fromFallback).toBe(true);
		expect((await (await requestManifest('fallback-tab')).json()).name).toBe('Brand 1');
		expect(network).toHaveBeenCalledTimes(1);
		// Applying a genuinely new revision exits fallback binding semantics.
		await h.manager.pin('fallback-tab', build, 2);
		expect(h.state.pins['fallback-tab'].fromFallback).toBeUndefined();
	});
});
