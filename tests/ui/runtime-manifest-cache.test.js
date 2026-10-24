import { afterEach, describe, expect, it, vi } from 'vitest';
import { caches, Response as CacheResponse, Request as CacheRequest } from 'undici';
import { IDBFactory } from 'fake-indexeddb';
import { createRuntimeManifest } from '../../src/ui/runtimeManifest.js';
import { createMainPage } from '../../src/ui/page.js';
import { createManifest, createDefaultIcon } from '../../src/ui/manifest.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { createQrVendorResponse } from '../../src/ui/qrVendors.js';
import { createDefaultAppearance } from '../../src/api/themes.js';
import { createRuntimeProtocol } from '../../src/ui/runtimeProtocol.js';
import { createRuntimeSnapshotIndex } from '../../src/ui/runtimeSnapshotIndex.js';
import { createRuntimeSnapshotManager } from '../../src/ui/runtimeSnapshots.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';

afterEach(async () => {
	for (const name of await caches.keys()) {
		await caches.delete(name);
	}
	vi.unstubAllGlobals();
});
describe('server descriptor to actual runtime cache', () => {
	it.each(['official', 'safe'])(
		'verifies real generated %s HTML, modules, QR libraries and every manifest language before readiness',
		async (mode) => {
			vi.stubGlobal('Response', CacheResponse);
			vi.stubGlobal('Request', CacheRequest);
			const origin = 'https://runtime.test',
				buildId = 'a'.repeat(64),
				appearance = createDefaultAppearance();
			const descriptorResponse = await createRuntimeManifest(
				new Request(origin + '/api/runtime-manifest?build=' + buildId + '&appearance=0&mode=' + mode),
				{ appearance, buildId },
			);
			expect(descriptorResponse.status).toBe(200);
			const descriptor = await descriptorResponse.json();
			expect(descriptor.resources.filter((item) => item.role === 'vendor')).toHaveLength(2);
			if (mode === 'safe') {
				expect(descriptor.resources.some((item) => item.access === 'authenticated')).toBe(false);
				expect(descriptor.resources.some((item) => ['package', 'asset'].includes(item.role))).toBe(false);
			}
			const protocol = createRuntimeProtocol({ origin, languages: SUPPORTED_LANGUAGES });
			await expect(protocol.descriptor(descriptor)).resolves.toMatchObject({ inventoryHash: descriptor.inventoryHash });
			const fetch = async (address) => {
				const request = new Request(address);
				const url = new URL(address);
				const safe = url.searchParams.get('safeMode') === '1';
				if (url.pathname === '/api/runtime-manifest') {
					return createRuntimeManifest(request, { appearance, buildId });
				}
				if (url.pathname === '/') {
					return createMainPage({ appearance: safe ? null : appearance, buildId, safeMode: safe, lazyLoad: true });
				}
				if (url.pathname.startsWith('/modules/')) {
					return new Response(getModuleCode(url.pathname.slice(9, -3)), {
						headers: { 'Content-Type': 'application/javascript', 'X-2FA-Build': buildId },
					});
				}
				if (url.pathname.startsWith('/vendor/')) {
					return createQrVendorResponse(request);
				}
				if (url.pathname === '/manifest.json') {
					return createManifest(request, safe ? undefined : appearance);
				}
				if (url.pathname.startsWith('/icon-')) {
					return createDefaultIcon(Number(url.pathname.match(/\d+/)[0]));
				}
				return new Response('missing', { status: 404 });
			};
			const manager = createRuntimeSnapshotManager({
				buildId,
				origin,
				caches,
				fetch,
				protocol,
				index: createRuntimeSnapshotIndex(new IDBFactory()),
				clients: { matchAll: async () => [] },
			});
			expect(await manager.prepare(descriptor.tuple, 'page', { shellConfigId: descriptor.shellConfigId })).toMatchObject({
				status: 'ready',
				resourcesReady: true,
				recoveryReady: true,
			});
			expect(
				(
					await manager.attach(descriptor.tuple, 'page', {
						shellConfigId: descriptor.shellConfigId,
						inventoryHash: descriptor.inventoryHash,
					})
				).status,
			).toBe('ready');
			const safe = await manager.matchNavigation(new Request(origin + '/?safeMode=1'), 'safe');
			expect(safe.headers.get('X-2FA-Runtime-Mode')).toBe('safe');
			const localized = await manager.fetchResource(new Request(origin + '/manifest.json?lang=ja&appearance=0&safeMode=1'), 'safe');
			expect((await localized.json()).name).toBeTruthy();
		},
		20000,
	);
});
