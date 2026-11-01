import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { Window } from 'happy-dom';
import { createRuntimeTransport } from '../../src/ui/runtime/runtimeTransport.js';
import { createAppThemeHost } from '../../src/ui/scripts/appThemeHost.js';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { snapshotHarness, inventory, origin, CacheRequest, CacheResponse } from '../helpers/runtime-snapshot.js';

const fixtures = [];
beforeEach(() => {
	vi.stubGlobal('Response', CacheResponse);
	vi.stubGlobal('Request', CacheRequest);
});
afterEach(async () => {
	for (const h of fixtures.splice(0)) {
		h.host?.dispose();
		h.transport.dispose();
		await h.window.happyDOM.close();
		await h.cleanup();
	}
	vi.unstubAllGlobals();
});

async function fixture() {
	const workerBuild = 'f'.repeat(64);
	const h = await snapshotHarness({ workerBuild });
	vi.stubGlobal('__2FA_BUILD_ID__', workerBuild);
	const handlers = new Map();
	const self = { location: { origin }, clients: h.clients, addEventListener: (type, listener) => handlers.set(type, listener) };
	const source = (await createServiceWorker().text())
		.replace(/const snapshotManager = [\s\S]*?\nconst runtimeProtocol =/, 'const snapshotManager = null;\nconst runtimeProtocol =')
		.replace(/const runtimeSnapshots = [\s\S]*?\nconst QR_VENDORS/, 'const runtimeSnapshots = testManager;\nconst QR_VENDORS');
	// Exercise the existing SW message shape and its real cache/index manager.
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', 'testManager', source)(
		self,
		self.location,
		h.fetch,
		h.caches,
		{ log() {}, warn() {}, error() {} },
		h.manager,
	);
	const requests = [],
		replies = [],
		tasks = [];
	const serviceWorker = Object.assign(new EventTarget(), {
		controller: {
			postMessage(request, [port]) {
				requests.push(request);
				handlers.get('message')({
					data: request,
					source: { id: 'actual-tab', type: 'window', url: origin + '/' },
					ports: [
						{
							postMessage: (reply) => {
								replies.push(reply);
								port.postMessage(reply);
							},
						},
					],
					waitUntil: (task) => tasks.push(task),
				});
			},
		},
	});
	const window = new Window({ url: origin + '/' });
	window.__2FA_BUILD_ID__ = h.current.tuple.hostBuild;
	window.__2FA_SHELL_CONFIG_ID__ = h.current.shellConfigId;
	const transport = createRuntimeTransport({ window, navigator: { serviceWorker }, MessageChannel });
	const result = { ...h, window, transport, networkRequests: h.requests, requests, replies, tasks, workerBuild };
	fixtures.push(result);
	return result;
}

function createHost(h, mount) {
	const root = h.window.document.createElement('main');
	h.window.document.body.append(root);
	const appearance = {
		kind: 'app',
		packageId: h.current.tuple.packageId,
		revision: h.current.tuple.appearanceRevision,
		settings: {},
		branding: {},
		manifest: {
			themeApiVersion: 2,
			sdkApiVersion: 1,
			kind: 'app',
			id: 'fixture',
			name: 'Fixture',
			version: '1.0.0',
			entry: 'entry.js',
			styles: [],
			files: h.current.descriptor.resources
				.filter((file) => file.role === 'package')
				.map((file) => ({
					path: file.url.split('/').slice(3).join('/'),
					mime: file.mime,
					size: file.size,
					sha256: file.sha256,
				})),
		},
	};
	const ports = {
		window: h.window,
		root,
		appearance,
		transport: h.transport,
		getSessionState: () => ({ sessionGeneration: 1, blocked: false, accessVerified: true }),
		createSdkScope: ({ isCurrent }) => ({ sdk: { canAct: isCurrent }, dispose() {} }),
		importModule: vi.fn(async () => ({ mount })),
		onRunning: vi.fn(),
		onRecoveryRequired: vi.fn(),
		onFallback: vi.fn(),
	};
	h.host = createAppThemeHost(ports);
	return ports;
}

describe('cached attachment with existing SW and real snapshots', () => {
	it('grants a fresh permit with one complete cache pass and rechecks STARTED with the same inventory', async () => {
		const h = await fixture();
		await h.prepare();
		const fetched = h.networkRequests.length;
		const checked = [];
		const open = h.caches.open;
		h.caches.open = async (name) => {
			const cache = await open(name);
			return {
				match: async (url) => {
					checked.push(url);
					return cache.match(url);
				},
			};
		};
		const attached = await h.transport.tryAttachCached(h.current.tuple);
		expect(attached).toMatchObject({
			status: 'ready',
			permit: { workerBuild: h.workerBuild, inventoryHash: h.current.descriptor.inventoryHash },
		});
		expect(h.requests.map((request) => request.type)).toEqual(['RUNTIME_ATTACH']);
		expect(checked).toHaveLength(h.current.descriptor.resources.length + 1);
		for (const resource of h.current.descriptor.resources) {
			expect(checked).toContain(new URL(resource.url, origin).href);
		}
		expect((await h.index.read()).pins['actual-tab']).toMatchObject({ permitId: attached.permit.permitId, provisional: false });
		expect((await h.transport.startup(h.current.tuple)).status).toBe('ready');
		expect(checked).toHaveLength(2 * (h.current.descriptor.resources.length + 1));
		expect(h.requests[1]).toMatchObject({ type: 'RUNTIME_STARTED', inventoryHash: h.current.descriptor.inventoryHash });
		expect((await h.index.read()).startupValidated).toBe((await h.index.read()).active);
		expect(h.networkRequests).toHaveLength(fetched);
	});
	it('treats a real old-shaped cache miss as repairable without changing its pin', async () => {
		const h = await fixture();
		const miss = await h.transport.tryAttachCached(h.current.tuple);
		expect(miss).toMatchObject({ status: 'miss', reason: 'not-prepared' });
		expect(h.replies[0].shellConfigId).toBeUndefined();
		expect(h.replies[0].inventoryHash).toBeUndefined();
		const state = await h.index.read();
		expect(state.pins['actual-tab']).toBeUndefined();
		expect(state.admissions['actual-tab']).toBe(1);
		expect((await h.transport.prepare(h.current.tuple)).status).toBe('ready');
		expect((await h.transport.attach(h.current.tuple)).status).toBe('ready');
		expect((await h.transport.startup(h.current.tuple)).status).toBe('ready');
		expect(h.requests.map((request) => request.type)).toEqual(['RUNTIME_ATTACH', 'RUNTIME_PREPARE', 'RUNTIME_ATTACH', 'RUNTIME_STARTED']);
	});
	it.each(['missing', 'corrupt'])('never grants execution for a %s package in the cached snapshot', async (failure) => {
		const h = await fixture();
		await h.prepare();
		const cache = await h.caches.open((await h.index.read()).active);
		const file = h.current.descriptor.resources.find((resource) => resource.url.endsWith('/history.js'));
		if (failure === 'missing') {
			await cache.delete(new URL(file.url, origin).href);
		} else {
			await cache.put(new URL(file.url, origin).href, new Response('changed', { headers: { 'Content-Type': file.mime } }));
		}
		expect(await h.transport.tryAttachCached(h.current.tuple)).toMatchObject({ status: 'miss', reason: 'evicted' });
		expect((await h.index.read()).pins['actual-tab']).toBeUndefined();
		expect((await h.transport.startup(h.current.tuple)).status).toBe('blocked');
		expect(h.requests).toHaveLength(1);
	});
	it.each(['missing', 'corrupt'])('keeps the mounted theme hidden when its %s resource fails the full startup recheck', async (failure) => {
		const h = await fixture();
		await h.prepare();
		const cache = await h.caches.open((await h.index.read()).active);
		const file = h.current.descriptor.resources.find((resource) => resource.url.endsWith('/history.js'));
		const ports = createHost(h, async ({ root }) => {
			root.textContent = 'candidate';
			if (failure === 'missing') {
				await cache.delete(new URL(file.url, origin).href);
			} else {
				await cache.put(new URL(file.url, origin).href, new Response('changed', { headers: { 'Content-Type': file.mime } }));
			}
			return { unmount() {} };
		});
		expect(await h.host.start()).toMatchObject({ status: 'blocked-after-load-start', reason: 'evicted' });
		expect(ports.onRunning).not.toHaveBeenCalled();
		expect(ports.root.children).toHaveLength(0);
		expect(ports.onRecoveryRequired).toHaveBeenCalledOnce();
		expect((await h.index.read()).startupValidated).toBeNull();
		expect(h.requests.map((request) => request.type)).toEqual(['RUNTIME_ATTACH', 'RUNTIME_STARTED']);
	});
	it('drops snapshots of earlier themes once a newer one has started', async () => {
		const h = await fixture();
		const names = [];
		for (const revision of [1, 2, 3]) {
			const current = await inventory({ revision });
			h.setCurrent(current);
			h.window.__2FA_SHELL_CONFIG_ID__ = current.shellConfigId;
			expect((await h.transport.prepare(current.tuple)).status).toBe('ready');
			expect((await h.transport.attach(current.tuple)).status).toBe('ready');
			expect((await h.transport.startup(current.tuple)).status).toBe('ready');
			await Promise.all(h.tasks);
			names.push((await h.index.read()).active);
		}
		const state = await h.index.read();
		expect(state.previous).toBe(names[1]);
		expect((await h.caches.keys()).sort()).toEqual([names[1], names[2]].sort());
	});
});
