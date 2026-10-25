import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers';
import { createRuntimeSnapshotManager } from '../../src/ui/runtimeSnapshots.js';
import { snapshotHarness, origin, buildId, CacheResponse, CacheRequest } from '../helpers/runtime-snapshot.js';

const harnesses = [];
const absolute = (url) => new URL(url, origin).href;
const marker = absolute('/__runtime_snapshot_v2__');
const tick = () => new Promise(setImmediate);

beforeEach(() => {
	vi.stubGlobal('Response', CacheResponse);
	vi.stubGlobal('Request', CacheRequest);
});
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.cleanup()));
	vi.unstubAllGlobals();
});

async function fixture() {
	const h = await snapshotHarness();
	harnesses.push(h);
	expect((await h.prepare()).status).toBe('ready');
	const state = await h.index.read();
	const snapshot = state.snapshots[state.active];
	return { h, snapshot, cache: await h.caches.open(snapshot.cacheName) };
}

function gatedChecks(h, stage, failure = null) {
	const checks = [];
	const buffers = new WeakMap();
	let active = 0;
	let maximum = 0;
	let automatic = false;
	const originalError = new Error('controlled cache verification failure');
	const lookup = new Map(h.current.descriptor.resources.map((resource) => [absolute(resource.url), resource]));
	const pause = async (check, currentStage) => {
		check.stage = currentStage;
		if (stage === currentStage && !automatic) {
			await new Promise((resolve) => {
				check.release = resolve;
			});
		}
	};
	const manager = createRuntimeSnapshotManager({
		buildId,
		origin,
		index: h.index,
		clients: h.clients,
		fetch: h.fetch,
		caches: {
			...h.caches,
			async open(name) {
				const cache = await h.caches.open(name);
				return {
					async match(url) {
						if (!lookup.has(url)) {
							return cache.match(url);
						}
						const check = { url, index: checks.length };
						checks.push(check);
						active += 1;
						maximum = Math.max(maximum, active);
						await pause(check, 'match');
						const response = await cache.match(url);
						const clone = response.clone.bind(response);
						response.clone = () => {
							const copy = clone();
							const read = copy.arrayBuffer.bind(copy);
							copy.arrayBuffer = async () => {
								await pause(check, 'body');
								const bytes = await read();
								buffers.set(bytes, check);
								return bytes;
							};
							return copy;
						};
						return response;
					},
				};
			},
		},
		protocol: {
			...h.current.protocol,
			async digest(bytes) {
				const check = buffers.get(bytes);
				if (!check) {
					return h.current.protocol.digest(bytes);
				}
				await pause(check, 'digest');
				try {
					if (check.index === 0 && failure === 'reject') {
						throw originalError;
					}
					if (check.index === 0 && failure === 'invalid') {
						return '0'.repeat(64);
					}
					return await h.current.protocol.digest(bytes);
				} finally {
					check.stage = 'finished';
					active -= 1;
				}
			},
		},
	});
	return {
		manager,
		checks,
		originalError,
		get active() {
			return active;
		},
		get maximum() {
			return maximum;
		},
		releaseAll() {
			automatic = true;
			for (const check of checks) {
				check.release?.();
			}
		},
	};
}

describe('bounded complete runtime verification on real Cache API responses', () => {
	it.each(['match', 'body', 'digest'])('keeps all %s work within four full-chain slots', async (stage) => {
		const { h, snapshot } = await fixture();
		const gated = gatedChecks(h, stage);
		let settled = false;
		const verifying = gated.manager.complete(snapshot).then((value) => {
			settled = true;
			return value;
		});
		try {
			await vi.waitFor(() => {
				expect(gated.checks).toHaveLength(4);
				expect(gated.checks.every((check) => check.stage === stage)).toBe(true);
			});
			await tick();
			expect(settled).toBe(false);
			expect(gated.maximum).toBe(4);
			gated.checks[0].release();
			await vi.waitFor(() => expect(gated.checks).toHaveLength(5));
			expect(gated.active).toBe(4);
			expect(gated.maximum).toBe(4);
		} finally {
			gated.releaseAll();
		}
		expect(await verifying).toBe(true);
		expect(gated.active).toBe(0);
		expect(gated.maximum).toBe(4);
		expect(gated.checks.map((check) => check.url).sort()).toEqual(snapshot.descriptor.resources.map((item) => absolute(item.url)).sort());
	});

	it.each(['invalid', 'reject'])('stops claiming work after %s and drains all started digests', async (failure) => {
		const { h, snapshot } = await fixture();
		const gated = gatedChecks(h, 'digest', failure);
		let settled = false;
		const verifying = gated.manager.complete(snapshot).then(
			(value) => {
				settled = true;
				return { value };
			},
			(error) => {
				settled = true;
				return { error };
			},
		);
		try {
			await vi.waitFor(() => expect(gated.checks.filter((check) => check.stage === 'digest')).toHaveLength(4));
			gated.checks[0].release();
			await vi.waitFor(() => expect(gated.checks[0].stage).toBe('finished'));
			await tick();
			expect(settled).toBe(false);
			expect(gated.checks).toHaveLength(4);
			gated.checks[1].release();
			gated.checks[2].release();
			await vi.waitFor(() => expect(gated.active).toBe(1));
			await tick();
			expect(settled).toBe(false);
			expect(gated.checks).toHaveLength(4);
		} finally {
			gated.releaseAll();
		}
		const result = await verifying;
		if (failure === 'reject') {
			expect(result.error).toBe(gated.originalError);
		} else {
			expect(result).toEqual({ value: false });
		}
		expect(gated.active).toBe(0);
		expect(gated.checks).toHaveLength(4);
	});

	it.each(
		['first', 'middle', 'last'].flatMap((position) => ['missing', 'status', 'mime', 'length', 'hash'].map((fault) => [position, fault])),
	)('rejects the %s resource with invalid %s', async (position, fault) => {
		const { h, snapshot, cache } = await fixture();
		const resources = snapshot.descriptor.resources;
		const resource = resources[position === 'first' ? 0 : position === 'last' ? resources.length - 1 : Math.floor(resources.length / 2)];
		if (fault === 'missing') {
			await cache.delete(absolute(resource.url));
		} else {
			const original = await cache.match(absolute(resource.url));
			const headers = new Headers(original.headers);
			let bytes = new Uint8Array(await original.arrayBuffer());
			if (fault === 'hash') {
				bytes[0] ^= 1;
			}
			if (fault === 'length') {
				bytes = bytes.slice(1);
			}
			if (fault === 'mime') {
				headers.set('Content-Type', 'application/octet-stream');
			}
			await cache.put(absolute(resource.url), new Response(bytes, { status: fault === 'status' ? 503 : 200, headers }));
		}
		expect(await h.manager.complete(snapshot)).toBe(false);
	});

	it.each([
		['shell', 'X-2FA-Build'],
		['shell', 'X-2FA-Shell-Config'],
		['recovery', 'X-2FA-Build'],
		['recovery', 'X-2FA-Shell-Config'],
		['module', 'X-2FA-Build'],
	])('retains %s %s identity verification', async (role, header) => {
		const { h, snapshot, cache } = await fixture();
		const resource = snapshot.descriptor.resources.find((item) => item.role === role);
		const response = await cache.match(absolute(resource.url));
		const headers = new Headers(response.headers);
		headers.set(header, 'f'.repeat(64));
		await cache.put(absolute(resource.url), new Response(await response.arrayBuffer(), { headers }));
		expect(await h.manager.complete(snapshot)).toBe(false);
	});

	it.each([
		['prepare', 'evict'],
		['prepare', 'tamper'],
		['attach', 'evict'],
		['attach', 'tamper'],
		['startup', 'evict'],
		['startup', 'tamper'],
	])('rechecks %s after earlier success and later %s', async (boundary, change) => {
		const { h, snapshot, cache } = await fixture();
		const options = { shellConfigId: h.current.shellConfigId, inventoryHash: h.current.descriptor.inventoryHash };
		expect((await h.attach()).status).toBe('ready');
		expect((await h.manager.markStartup(h.current.tuple, 'tab', options)).status).toBe('ready');
		const resource = snapshot.descriptor.resources.find((item) => item.role === 'package');
		if (change === 'evict') {
			await cache.delete(absolute(resource.url));
		} else {
			const response = await cache.match(absolute(resource.url));
			const bytes = new Uint8Array(await response.arrayBuffer());
			bytes[0] ^= 1;
			await cache.put(absolute(resource.url), new Response(bytes, { headers: response.headers }));
		}
		h.setFailure(503);
		const result = await (boundary === 'prepare'
			? h.prepare()
			: boundary === 'attach'
				? h.attach('next-tab')
				: h.manager.markStartup(h.current.tuple, 'tab', options));
		expect(result.status).toBe('blocked');
		expect(result.resourcesReady).toBe(false);
		if (boundary === 'attach') {
			expect((await h.index.read()).pins['next-tab']).toBeUndefined();
		}
	});

	it('checks only the safe dependency subset without authorizing an incomplete app', async () => {
		const { h, snapshot, cache } = await fixture();
		expect((await h.attach()).status).toBe('ready');
		const packageFile = snapshot.descriptor.resources.find((resource) => resource.role === 'package');
		await cache.delete(absolute(packageFile.url));
		expect(await h.manager.complete(snapshot, { recoveryOnly: true })).toBe(true);
		expect(await h.manager.complete(snapshot)).toBe(false);
		expect((await h.attach('app-tab')).status).toBe('blocked');
		expect((await h.manager.markStartup(h.current.tuple, 'tab', { shellConfigId: h.current.shellConfigId })).status).toBe('blocked');
		expect((await h.manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'safe-tab')).status).toBe(200);
		expect((await h.index.read()).pins['safe-tab'].safe).toBe(true);
		await cache.delete(absolute('/vendor/jsqr-1.4.0.js'));
		expect(await h.manager.complete(snapshot, { recoveryOnly: true })).toBe(false);
		expect(await h.manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'broken-safe')).toBeNull();
	});

	it.each(['missing-seal', 'wrong-inventory', 'deleting'])('retains the %s prerequisite before resource checks', async (change) => {
		const { h, snapshot, cache } = await fixture();
		if (change === 'missing-seal') {
			await cache.delete(marker);
		}
		if (change === 'wrong-inventory') {
			await cache.put(marker, Response.json({ inventoryHash: '0'.repeat(64) }));
		}
		if (change === 'deleting') {
			await h.index.update((state) => {
				state.deleting[snapshot.cacheName] = true;
			});
		}
		const gated = gatedChecks(h, 'match');
		expect(await gated.manager.complete(snapshot)).toBe(false);
		expect(gated.checks).toHaveLength(0);
	});
});
