import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { getQrVendorInventory, createQrVendorResponse } from '../../src/ui/qrVendors.js';
import { snapshotHarness, inventory, origin, buildId, CacheRequest, CacheResponse, packageId } from '../helpers/runtime-snapshot.js';
const harnesses = [];
beforeEach(() => {
	vi.stubGlobal('Response', CacheResponse);
	vi.stubGlobal('Request', CacheRequest);
	vi.stubGlobal('__2FA_BUILD_ID__', buildId);
});
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.cleanup()));
	vi.unstubAllGlobals();
});
async function fixture(options = {}) {
	const h = await snapshotHarness(options);
	harnesses.push(h);
	vi.stubGlobal('__2FA_BUILD_ID__', options.workerBuild || buildId);
	const listeners = new Map();
	const self = {
		location: { origin },
		clients: { ...h.clients, claim: vi.fn() },
		registration: { active: null },
		skipWaiting: vi.fn(),
		addEventListener: (type, listener) => listeners.set(type, listener),
	};
	const fetch = vi.fn(h.fetch);
	const source = (await createServiceWorker().text())
		.replace(
			/const snapshotManager = [\s\S]*?\nconst runtimeProtocol =/,
			'const snapshotManager = {clean:async()=>{}};\nconst runtimeProtocol =',
		)
		.replace(/const runtimeSnapshots = [\s\S]*?\nconst QR_VENDORS/, 'const runtimeSnapshots = testManager;\nconst QR_VENDORS');
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', 'testManager', source)(
		self,
		self.location,
		fetch,
		h.caches,
		{ log() {}, error() {}, warn() {} },
		h.manager,
	);
	async function message(data, from = { type: 'window', id: 'real-tab', url: origin + '/' }) {
		let reply;
		const tasks = [];
		listeners.get('message')({
			data,
			source: from,
			ports: [
				{
					postMessage: (value) => {
						reply = value;
					},
				},
			],
			waitUntil: (task) => tasks.push(task),
		});
		await Promise.all(tasks);
		return reply;
	}
	async function request(path, clientId = 'real-tab') {
		let response;
		const tasks = [];
		listeners.get('fetch')({
			request: new Request(origin + path),
			clientId,
			respondWith: (value) => {
				response = value;
			},
			waitUntil: (task) => tasks.push(task),
		});
		const result = await response;
		await Promise.all(tasks);
		return result;
	}
	return { ...h, self, fetch, listeners, message, request };
}
describe('emitted SW runtime admission and fetch paths', () => {
	it('never force activates on install or claims clients on activation, and rejects the legacy bypass message', async () => {
		const h = await fixture();
		const tasks = [];
		h.listeners.get('install')({ waitUntil: (task) => tasks.push(task) });
		h.listeners.get('activate')({ waitUntil: (task) => tasks.push(task) });
		await Promise.all(tasks);
		expect(h.self.skipWaiting).not.toHaveBeenCalled();
		expect(h.self.clients.claim).not.toHaveBeenCalled();
		expect((await h.message({ type: 'SKIP_WAITING' })).status).toBe('blocked');
		expect(h.self.skipWaiting).not.toHaveBeenCalled();
	});
	it('prepares a real complete snapshot and pins only the verified source client, then serves a deep chunk on 503', async () => {
		const h = await fixture();
		const body = {
			protocol: '2fa-runtime-v1',
			nonce: 'abcdefgh123456',
			generation: 1,
			tuple: h.current.tuple,
			shellConfigId: h.current.shellConfigId,
			clientId: 'forged',
		};
		const prepared = await h.message({ ...body, type: 'RUNTIME_PREPARE' });
		expect(prepared).toMatchObject({ status: 'ready', resourcesReady: true });
		const attached = await h.message({ ...body, type: 'RUNTIME_ATTACH', inventoryHash: prepared.inventoryHash });
		expect(attached.permitId).toBeTruthy();
		expect((await h.index.read()).pins['real-tab']).toBeDefined();
		expect((await h.index.read()).pins.forged).toBeUndefined();
		h.setFailure(503);
		expect(await (await h.request('/theme-packages/' + packageId + '/chunks/history.js')).text()).toBe('export const entries=[]');
		h.setFailure(403);
		expect((await h.request('/theme-packages/' + packageId + '/chunks/history.js')).status).toBe(403);
	});
	it('rejects unknown clients before preparing or issuing a permit', async () => {
		const h = await fixture();
		const body = {
			type: 'RUNTIME_PREPARE',
			protocol: '2fa-runtime-v1',
			nonce: 'abcdefgh123456',
			generation: 1,
			tuple: h.current.tuple,
			shellConfigId: h.current.shellConfigId,
		};
		const answer = await h.message(body, { type: 'window', id: 'foreign', url: 'https://other.test/' });
		expect(answer.status).toBe('blocked');
		expect(h.requests).toEqual([]);
	});
	it('preserves v1 offline QR vendors even without any complete app snapshot', async () => {
		const h = await fixture();
		const vendor = getQrVendorInventory()[0];
		h.fetch.mockImplementation(async (request) => createQrVendorResponse(request));
		const online = await h.request(vendor.url);
		expect(online.status).toBe(200);
		const bytes = await online.text();
		h.fetch.mockImplementation(async () => new Response('temporarily unavailable', { status: 503 }));
		expect(await (await h.request(vendor.url)).text()).toBe(bytes);
		h.fetch.mockImplementation(async () => new Response('denied', { status: 401 }));
		expect((await h.request(vendor.url)).status).toBe(401);
		h.fetch.mockRejectedValue(new Error('offline'));
		expect(await (await h.request(vendor.url)).text()).toBe(bytes);
	});
	it('ordinary cache cleanup preserves the active runtime and unrelated origin caches', async () => {
		const h = await fixture();
		await h.prepare();
		const active = (await h.index.read()).active;
		const unrelated = await h.caches.open('other-application');
		await unrelated.put(origin + '/other', new Response('keep'));
		expect((await h.message({ type: 'CLEAR_CACHE' })).success).toBe(true);
		expect(await h.caches.keys()).toContain(active);
		expect(await h.caches.keys()).toContain('other-application');
	});
	it('prepares the current server build from the waiting worker before admitting a real activation RPC', async () => {
		const nextBuild = 'b'.repeat(64);
		const h = await fixture({ workerBuild: nextBuild });
		await h.prepare();
		await h.attach('real-tab');
		h.live.push({ id: 'real-tab' });
		const old = (await h.index.read()).active;
		await h.index.update((state) => {
			state.workerProtocol[buildId] = { protocol: '2fa-runtime-v1' };
		});
		h.self.registration.active = {
			postMessage: (request, ports) => ports[0].postMessage({ protocol: '2fa-runtime-v1', nonce: request.nonce, workerBuild: buildId }),
		};
		h.setCurrent(await inventory({ build: nextBuild, revision: 2 }));
		const result = await h.message({ type: 'RUNTIME_ACTIVATE', protocol: '2fa-runtime-v1', nonce: 'activate-12345678', generation: 1 });
		expect(result).toMatchObject({ status: 'ready', reason: 'activation-requested' });
		expect(h.self.skipWaiting).toHaveBeenCalledTimes(1);
		const state = await h.index.read();
		expect(state.snapshots[state.active].tuple.hostBuild).toBe(nextBuild);
		expect(state.activation.requiredCacheNames).toContain(old);
		expect(h.requests).toContain(origin + '/');
		expect(h.requests).toContain(origin + '/theme-packages/' + packageId + '/chunks/history.js');
	});
});
