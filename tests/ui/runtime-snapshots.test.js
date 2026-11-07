import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeSnapshotIndex } from '../../src/ui/runtimeSnapshotIndex.js';
import { createRuntimeSnapshotManager } from '../../src/ui/runtimeSnapshots.js';
import { snapshotHarness, inventory, origin, buildId, packageId, CacheResponse, CacheRequest } from '../helpers/runtime-snapshot.js';
const harnesses = [];
beforeEach(() => {
	vi.stubGlobal('Response', CacheResponse);
	vi.stubGlobal('Request', CacheRequest);
});
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.cleanup()));
	vi.unstubAllGlobals();
});
async function fixture(options) {
	const h = await snapshotHarness(options);
	harnesses.push(h);
	return h;
}
const chunk = origin + '/theme-packages/' + packageId + '/chunks/history.js';
const shell = origin + '/';

describe('complete app runtimes on Cache API and IndexedDB transactions', () => {
	it.each(['/vendor/qrcode-generator-1.4.4.js', '/manifest.json?safeMode=1&appearance=0&lang=en', '/icon-192.png?safeMode=1'])(
		'skips an independent safe snapshot missing %s and uses an intact recovery subset even when its theme chunk is evicted',
		async (missing) => {
			const h = await fixture();
			await h.prepare();
			const normal = (await h.index.read()).active;
			h.setCurrent(await inventory({ mode: 'safe' }));
			await h.prepare();
			const safe = (await h.index.read()).recoveryActive;
			await (await h.caches.open(safe)).delete(origin + missing);
			await (await h.caches.open(normal)).delete(chunk);
			h.setFailure(503);
			const response = await h.manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'safe-subset');
			expect(response.status).toBe(200);
			expect((await h.index.read()).pins['safe-subset'].cacheName).toBe(normal);
			const vendor = await h.manager.fetchResource(new Request(origin + '/vendor/qrcode-generator-1.4.4.js'), 'safe-subset');
			expect(await vendor.text()).toBe('qr-generator');
			const manifest = await h.manager.fetchResource(new Request(origin + '/manifest.json?appearance=0&lang=en&safeMode=1'), 'safe-subset');
			expect(await manifest.text()).toBe('SAFE MANIFEST');
		},
	);
	it('does not present a complete recovery when no retained snapshot has all recovery dependencies', async () => {
		const h = await fixture();
		await h.prepare();
		const normal = (await h.index.read()).active;
		await (await h.caches.open(normal)).delete(origin + '/vendor/jsqr-1.4.0.js');
		h.setFailure(503);
		expect(await h.manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'unrecoverable')).toBeNull();
		expect((await h.index.read()).pins.unrecoverable).toBeUndefined();
	});
	it('stores every unrequested lazy chunk and all host modules before granting a permit', async () => {
		const h = await fixture();
		expect((await h.prepare()).status).toBe('ready');
		expect(h.requests).toContain(chunk);
		const permit = await h.attach();
		expect(permit).toMatchObject({ status: 'ready', resourcesReady: true, recoveryReady: true });
		const state = await h.index.read();
		expect(state.pins.tab.cacheName).toBe(state.active);
		h.setFailure(503);
		const cached = await h.manager.fetchResource(new Request(chunk), 'tab');
		expect(await cached.text()).toBe('export const entries=[]');
		const shell = await h.manager.matchNavigation(new Request(origin + '/'), 'navigation');
		expect(await shell.text()).toBe('NORMAL 1');
		expect((await h.index.read()).pins.navigation).toMatchObject({ fromFallback: true, cacheName: state.active });
	});
	it.each([200, 401, 403, 503])('serves a pinned theme file from the snapshot without asking the network (%i)', async (status) => {
		const h = await fixture();
		await h.prepare();
		await h.attach();
		if (status !== 200) {
			h.setFailure(status);
		}
		const before = h.requests.length;
		const response = await h.manager.fetchResource(new Request(chunk), 'tab');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('export const entries=[]');
		expect(h.requests.length).toBe(before);
	});
	it.each([401, 403, 503, 500])('preserves explicit %i semantics for a pinned host module that needs a login', async (status) => {
		const h = await fixture();
		await h.prepare();
		await h.attach();
		const state = await h.index.read();
		const module = state.snapshots[state.active].descriptor.resources.find((resource) => resource.role === 'module');
		h.setFailure(status);
		const response = await h.manager.fetchResource(new Request(new URL(module.url, origin).href), 'tab');
		expect(response.status).toBe(status >= 500 ? 200 : status);
	});
	it('retains the prior complete snapshot when one body or hash is wrong', async () => {
		const h = await fixture();
		await h.prepare();
		const first = (await h.index.read()).active;
		h.setCurrent(await inventory({ revision: 2 }));
		// The theme chunk is unchanged and reused; the shell changes with the revision.
		h.intercept(async (address) => (address === shell ? new Response('corrupt', { headers: { 'Content-Type': 'text/html' } }) : null));
		expect((await h.prepare()).status).toBe('blocked');
		expect((await h.index.read()).active).toBe(first);
		expect(await h.caches.keys()).toEqual([first]);
	});
	it('cannot reuse an old page configuration for the same tuple after custom code changed', async () => {
		const h = await fixture();
		await h.prepare();
		await h.attach();
		const original = h.current;
		h.setCurrent(await inventory({ config: 'changed' }));
		const result = await h.manager.prepare(h.current.tuple, 'new', { shellConfigId: 'f'.repeat(64) });
		expect(result.reason).toBe('reload-required');
		expect((await h.prepare()).status).toBe('ready');
		expect((await h.manager.status(original.tuple, { shellConfigId: original.shellConfigId })).status).toBe('ready');
		expect((await h.index.read()).pins.tab.shellConfigId).toBe(original.shellConfigId);
	});
	it('rejects a descriptor missing an authenticated host module even if its digest was recomputed', async () => {
		const h = await fixture();
		const value = h.current.descriptor;
		value.resources = value.resources.filter((item) => !item.url.includes('/modules/backup.js'));
		const { inventoryHash: _hash, ...body } = value;
		value.inventoryHash = await h.current.protocol.digest(h.current.protocol.canonical(body));
		expect((await h.prepare()).status).toBe('blocked');
		expect((await h.index.read()).active).toBeNull();
	});
	it('does not promote a late candidate after a newer revision completed', async () => {
		const h = await fixture();
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		h.intercept(async (address) => {
			if (address === chunk) {
				await gate;
			}
			return null;
		});
		const old = h.prepare();
		await vi.waitFor(() => expect(h.requests).toContain(chunk));
		h.intercept(null);
		h.setCurrent(await inventory({ revision: 2 }));
		expect((await h.prepare()).status).toBe('ready');
		const latest = (await h.index.read()).active;
		release();
		expect((await old).status).toBe('blocked');
		expect((await h.index.read()).active).toBe(latest);
	});
	it('falls back to independently verified recovery after a package chunk was evicted', async () => {
		const h = await fixture();
		await h.prepare();
		const state = await h.index.read();
		const cache = await h.caches.open(state.active);
		await cache.delete(chunk);
		expect((await h.attach()).reason).toBe('evicted');
		expect(await h.manager.matchNavigation(new Request(origin + '/'))).toBeNull();
		const safe = await h.manager.matchNavigation(new Request(origin + '/?disableCustomCode=1'), 'safe-tab');
		expect(await safe.text()).toBe('SAFE ' + buildId);
		h.setFailure(503);
		const manifest = await h.manager.fetchResource(new Request(origin + '/manifest.json?lang=en&appearance=0'), 'safe-tab');
		expect(await manifest.text()).toBe('SAFE MANIFEST');
		const icon = await h.manager.fetchResource(new Request(origin + '/icon-192.png'), 'safe-tab');
		expect(await icon.text()).toBe('SAFE ICON');
	});
	it('keeps old pinned snapshots across several promotions and refuses a legacy activation', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		await h.attach('old');
		h.live.push({ id: 'old' });
		const first = (await h.index.read()).pins.old.cacheName;
		for (const revision of [2, 3, 4]) {
			h.setCurrent(await inventory({ revision, build: 'b'.repeat(64) }));
			await h.prepare();
		}
		await h.manager.clean();
		expect(await h.caches.keys()).toContain(first);
		const skipWaiting = vi.fn();
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).reason).toBe('legacy-worker');
		expect(skipWaiting).not.toHaveBeenCalled();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).status).toBe('ready');
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});
	it('blocks protocol activation when an unknown client or missing old resource exists', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		await h.attach('old');
		const first = (await h.index.read()).active;
		h.setCurrent(await inventory({ build: 'b'.repeat(64), revision: 2 }));
		await h.prepare();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		const skipWaiting = vi.fn();
		h.live.push({ id: 'unknown' });
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).reason).toBe('unclassified-client');
		h.live.splice(0, 1, { id: 'old' });
		await (await h.caches.open(first)).delete(chunk);
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).reason).toBe('retained-runtime-incomplete');
		expect(skipWaiting).not.toHaveBeenCalled();
	});
	it('records deletion before I/O, preventing a new pin from reviving the doomed cache', async () => {
		const h = await fixture();
		await h.prepare();
		const first = h.current;
		const old = (await h.index.read()).active;
		h.setCurrent(await inventory({ revision: 2 }));
		await h.prepare();
		h.setCurrent(await inventory({ revision: 3 }));
		await h.prepare();
		const remove = h.caches.delete;
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		h.caches.delete = async (name) => {
			if (name === old) {
				await gate;
			}
			return remove(name);
		};
		const cleaning = h.manager.clean();
		await vi.waitFor(async () => expect((await h.index.read()).deleting[old]).toBe(true));
		expect((await h.manager.attach(first.tuple, 'late', { shellConfigId: first.shellConfigId })).status).toBe('blocked');
		release();
		await cleaning;
		expect(await h.caches.keys()).not.toContain(old);
	});
	it('survives index reopening and rolls back a transaction that throws after mutating state', async () => {
		const h = await fixture();
		await h.prepare();
		const before = await h.index.read();
		await expect(
			h.index.update((state) => {
				state.active = 'broken';
				throw new Error('abort');
			}),
		).rejects.toThrow('abort');
		const reopened = createRuntimeSnapshotIndex(h.database);
		expect((await reopened.read()).active).toBe(before.active);
		const manager = createRuntimeSnapshotManager({
			buildId,
			origin,
			caches: h.caches,
			fetch: h.fetch,
			index: reopened,
			protocol: h.current.protocol,
			clients: h.clients,
		});
		expect((await manager.attach(h.current.tuple, 'reopened', { shellConfigId: h.current.shellConfigId })).status).toBe('ready');
	});
	it('keeps safe preparation independent from a pending normal runtime', async () => {
		const h = await fixture();
		const normal = h.current;
		const safe = await inventory({ mode: 'safe' });
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let waiting = false;
		h.intercept(async (address) => {
			const url = new URL(address);
			if (url.pathname === '/api/runtime-manifest') {
				return Response.json(url.searchParams.get('mode') === 'safe' ? safe.descriptor : normal.descriptor);
			}
			if (address === chunk) {
				waiting = true;
				await gate;
			}
			return safe.responses.get(address)?.clone() || normal.responses.get(address)?.clone();
		});
		const pending = h.prepare();
		await vi.waitFor(() => expect(waiting).toBe(true));
		expect((await h.manager.prepare(safe.tuple, 'safe', { shellConfigId: safe.shellConfigId })).status).toBe('ready');
		const recovery = (await h.index.read()).recoveryActive;
		expect(recovery).toBeTruthy();
		release();
		expect((await pending).status).toBe('ready');
		const state = await h.index.read();
		expect(state.active).not.toBe(recovery);
		expect(state.recoveryActive).toBe(recovery);
		expect(state.snapshots[state.active].tuple.mode).toBe('app');
	});
	it.each([401, 403])('preserves %i on cached normal and safe mutable branding', async (denial) => {
		const h = await fixture();
		await h.prepare();
		await h.manager.matchNavigation(new Request(origin + '/'), 'normal');
		await h.manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'safe');
		h.setFailure(denial);
		for (const id of ['normal', 'safe']) {
			expect(
				(await h.manager.fetchResource(new Request(origin + '/manifest.json?lang=en&appearance=' + (id === 'safe' ? 0 : 1)), id)).status,
			).toBe(denial);
			expect((await h.manager.fetchResource(new Request(origin + '/icon-192.png'), id)).status).toBe(denial);
		}
		h.setFailure(503);
		expect(await (await h.manager.fetchResource(new Request(origin + '/manifest.json?lang=en&appearance=1'), 'normal')).text()).toBe(
			'NORMAL MANIFEST',
		);
		expect(await (await h.manager.fetchResource(new Request(origin + '/manifest.json?lang=en&appearance=0'), 'safe')).text()).toBe(
			'SAFE MANIFEST',
		);
	});
	it('cancels a hanging body, removes its candidate and keeps the previous runtime', async () => {
		const h = await fixture();
		await h.prepare();
		const previous = (await h.index.read()).active;
		h.setCurrent(await inventory({ revision: 2 }));
		const cancelled = vi.fn();
		let opened = false;
		h.intercept(async (address) =>
			address === shell
				? ((opened = true), new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'text/html' } }))
				: null,
		);
		const timers = [];
		const manager = createRuntimeSnapshotManager({
			buildId,
			origin,
			caches: h.caches,
			fetch: h.fetch,
			index: h.index,
			protocol: h.current.protocol,
			clients: h.clients,
			timers: {
				setTimeout: (callback, delay) => {
					const token = { callback, delay };
					timers.push(token);
					return token;
				},
				clearTimeout: (token) => {
					const i = timers.indexOf(token);
					if (i >= 0) {
						timers.splice(i, 1);
					}
				},
			},
		});
		const pending = manager.prepare(h.current.tuple, 'tab', { shellConfigId: h.current.shellConfigId });
		await vi.waitFor(() => expect(opened).toBe(true));
		timers.find((timer) => timer.delay === 120000).callback();
		expect((await pending).status).toBe('blocked');
		expect(cancelled).toHaveBeenCalled();
		const state = await h.index.read();
		expect(state.active).toBe(previous);
		expect(Object.keys(state.candidates)).toEqual([]);
		expect(await h.caches.keys()).toEqual([previous]);
	});
	it('clears a failed activation epoch and allows retry after the missing cache is restored', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		await h.attach('old');
		h.live.push({ id: 'old' });
		const old = h.current;
		const first = (await h.index.read()).active;
		h.setCurrent(await inventory({ build: 'b'.repeat(64), revision: 2 }));
		await h.prepare();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		await (await h.caches.open(first)).delete(chunk);
		const skipWaiting = vi.fn();
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).reason).toBe('retained-runtime-incomplete');
		expect((await h.index.read()).activation.phase).toBe('blocked');
		expect(await h.manager.canCleanLegacy()).toBe(true);
		await (await h.caches.open(first)).put(chunk, old.responses.get(chunk).clone());
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).status).toBe('ready');
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});
	it('atomically adds a concurrent client pin to the activation retention set', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		const oldest = h.current;
		await h.attach('old');
		h.live.push({ id: 'old' });
		h.setCurrent(await inventory({ revision: 2 }));
		await h.prepare();
		const middle = h.current;
		h.setCurrent(await inventory({ revision: 3 }));
		await h.prepare();
		h.setCurrent(await inventory({ build: 'b'.repeat(64), revision: 4 }));
		await h.prepare();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		const matchAll = h.clients.matchAll;
		let calls = 0;
		h.clients.matchAll = async () => {
			if (++calls === 2) {
				expect((await h.manager.attach(middle.tuple, 'late', { shellConfigId: middle.shellConfigId })).status).toBe('ready');
				h.live.push({ id: 'late' });
			}
			return matchAll();
		};
		const skipWaiting = vi.fn();
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).status).toBe('ready');
		const state = await h.index.read();
		expect(state.activation.requiredCacheNames).toContain(state.pins.late.cacheName);
		expect(state.pins.old.tuple).toEqual(oldest.tuple);
		expect(calls).toBeGreaterThanOrEqual(3);
	});
	it('cannot activate using only a new-build public recovery candidate', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		h.setCurrent(await inventory({ build: 'b'.repeat(64), mode: 'safe' }));
		await h.prepare();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		const skipWaiting = vi.fn();
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).reason).toBe('candidate-not-prepared');
		expect(skipWaiting).not.toHaveBeenCalled();
	});
	it('does not let an aborted network navigation overwrite the shell actually served offline', async () => {
		const h = await fixture();
		await h.prepare();
		await h.attach('navigation');
		const before = (await h.index.read()).pins.navigation;
		let current = true;
		const update = h.index.update;
		h.index.update = (change) =>
			update((state) => {
				current = false;
				return change(state);
			});
		await h.manager.pinNavigation(new Request(origin + '/'), 'navigation', h.current.responses.get(origin + '/').clone(), {
			isCurrent: () => current,
		});
		expect((await h.index.read()).pins.navigation).toEqual(before);
	});
	it('retains a newly attached old snapshot before the browser lists the new client', async () => {
		const h = await fixture();
		await h.prepare();
		const first = h.current;
		const retained = (await h.index.read()).active;
		for (const revision of [2, 3]) {
			h.setCurrent(await inventory({ revision }));
			await h.prepare();
		}
		expect((await h.manager.attach(first.tuple, 'just-opened', { shellConfigId: first.shellConfigId })).status).toBe('ready');
		expect(h.live).toEqual([]);
		await h.manager.clean();
		expect(await h.caches.keys()).toContain(retained);
	});
	it('can retry an activation whose worker was terminated during its preparation lease', async () => {
		const h = await fixture({ workerBuild: 'b'.repeat(64) });
		await h.prepare();
		h.setCurrent(await inventory({ build: 'b'.repeat(64), revision: 2 }));
		await h.prepare();
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
			state.activation = {
				phase: 'preparing',
				epoch: 'terminated',
				expiresAt: Date.now() - 1,
				requiredCacheNames: [],
				allowedApiVersions: [1],
			};
		});
		expect(await h.manager.canCleanLegacy()).toBe(true);
		const skipWaiting = vi.fn();
		expect((await h.manager.activation({ activeWorkerBuild: buildId, skipWaiting })).status).toBe('ready');
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});
	it('rejects a late older attach before it can overwrite the newer client pin', async () => {
		const h = await fixture();
		await h.prepare();
		const old = h.current;
		const oldCache = (await h.index.read()).active;
		h.setCurrent(await inventory({ revision: 2 }));
		await h.prepare();
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let waiting = false;
		const open = h.caches.open;
		h.caches.open = async (name) => {
			if (name === oldCache && !waiting) {
				waiting = true;
				await gate;
			}
			return open(name);
		};
		const pending = h.manager.attach(old.tuple, 'same-tab', { shellConfigId: old.shellConfigId });
		await vi.waitFor(() => expect(waiting).toBe(true));
		const next = await h.attach('same-tab');
		expect(next.status).toBe('ready');
		release();
		expect((await pending).status).toBe('blocked');
		expect((await h.index.read()).pins['same-tab']).toMatchObject({ tuple: h.current.tuple, permitId: next.permitId });
	});
	it('copies unchanged resources from the previous snapshot and downloads only what changed', async () => {
		const h = await fixture();
		await h.prepare();
		const first = (await h.index.read()).active;
		h.setCurrent(await inventory({ revision: 2 }));
		h.requests.length = 0;
		expect((await h.prepare()).status).toBe('ready');
		const fetched = h.requests.map((address) => new URL(address, origin).pathname + new URL(address, origin).search);
		// Only the shell differs between the two revisions of this fixture.
		expect(fetched.filter((path) => !path.startsWith('/api/runtime-manifest?'))).toEqual(['/']);
		const second = (await h.index.read()).active;
		expect(second).not.toBe(first);
		const cache = await h.caches.open(second);
		for (const resource of h.current.descriptor.resources) {
			expect(await cache.match(new URL(resource.url, origin).href)).toBeTruthy();
		}
		expect(await (await cache.match(chunk)).text()).toBe('export const entries=[]');
	});
	it('downloads a resource again when the copy in an earlier snapshot no longer matches its hash', async () => {
		const h = await fixture();
		await h.prepare();
		const first = (await h.index.read()).active;
		const vendor = origin + '/vendor/jsqr-1.4.0.js';
		const old = await h.caches.open(first);
		const headers = (await old.match(vendor)).headers;
		await old.put(vendor, new Response('jsqx', { headers }));
		h.setCurrent(await inventory({ revision: 2 }));
		h.requests.length = 0;
		expect((await h.prepare()).status).toBe('ready');
		expect(h.requests.map((address) => new URL(address, origin).href)).toContain(vendor);
		const cache = await h.caches.open((await h.index.read()).active);
		expect(await (await cache.match(vendor)).text()).toBe('jsqr');
	});
	it('reuses the shell a navigation just downloaded instead of fetching it again', async () => {
		const h = await fixture();
		await h.prepare();
		h.setCurrent(await inventory({ revision: 2 }));
		await h.manager.pinNavigation(new Request(shell), 'tab', h.current.responses.get(shell).clone());
		h.requests.length = 0;
		expect((await h.prepare()).status).toBe('ready');
		expect(h.requests.map((address) => new URL(address, origin).pathname)).not.toContain('/');
		const cache = await h.caches.open((await h.index.read()).active);
		expect(await (await cache.match(shell)).text()).toBe('NORMAL 2');
	});
	it('downloads the shell when the page a navigation received is not the published one', async () => {
		const h = await fixture();
		await h.prepare();
		h.setCurrent(await inventory({ revision: 2 }));
		const published = h.current.responses.get(shell);
		await h.manager.pinNavigation(new Request(shell), 'tab', new Response('NORMAL 1', { headers: published.headers }));
		h.requests.length = 0;
		expect((await h.prepare()).status).toBe('ready');
		expect(h.requests.map((address) => new URL(address, origin).href)).toContain(shell);
		const cache = await h.caches.open((await h.index.read()).active);
		expect(await (await cache.match(shell)).text()).toBe('NORMAL 2');
	});
});
