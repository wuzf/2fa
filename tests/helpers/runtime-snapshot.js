import { caches as realCaches, Response as CacheResponse, Request as CacheRequest } from 'undici';
import { IDBFactory } from 'fake-indexeddb';
import { createRuntimeProtocol } from '../../src/ui/runtimeProtocol.js';
import { createRuntimeSnapshotIndex } from '../../src/ui/runtimeSnapshotIndex.js';
import { createRuntimeSnapshotManager } from '../../src/ui/runtimeSnapshots.js';

let sequence = 0;
export const origin = 'https://runtime.test';
export const buildId = 'a'.repeat(64);
export const packageId = 'c'.repeat(64);
export { CacheResponse, CacheRequest };
export async function inventory({ build = buildId, revision = 1, config = '', mode = 'app' } = {}) {
	const protocol = createRuntimeProtocol({ origin });
	const tuple = {
		hostBuild: build,
		sdkApiVersion: 1,
		packageId: mode === 'app' ? packageId : null,
		appearanceRevision: mode === 'safe' ? 0 : revision,
		mode,
	};
	const shellConfigId = await protocol.digest(mode === 'safe' ? 'safe' : 'normal-' + revision + config);
	const safeConfigId = await protocol.digest('safe');
	const responses = new Map();
	const resources = [];
	async function add(url, body, role, mime = 'application/javascript', access = 'public') {
		const identity = role === 'recovery' ? { ...tuple, mode: 'safe', packageId: null, appearanceRevision: 0 } : tuple;
		const headers = {
			'Content-Type': mime,
			'X-2FA-Build': build,
			'X-2FA-SDK-Api-Version': '1',
			'X-2FA-Package-Id': identity.packageId || '',
			'X-2FA-Appearance-Revision': String(identity.appearanceRevision),
			'X-2FA-Runtime-Mode': identity.mode,
			'X-2FA-Shell-Config': role === 'recovery' ? safeConfigId : shellConfigId,
		};
		const bytes = new TextEncoder().encode(body);
		resources.push({
			url,
			mime,
			size: bytes.byteLength,
			sha256: await protocol.digest(bytes),
			role,
			access,
			...(['shell', 'recovery'].includes(role) ? { shellConfigId: headers['X-2FA-Shell-Config'] } : {}),
		});
		responses.set(new URL(url, origin).href, new CacheResponse(body, { headers }));
	}
	await add('/?safeMode=1', 'SAFE ' + build, 'recovery', 'text/html');
	await add('/vendor/jsqr-1.4.0.js', 'jsqr', 'vendor');
	await add('/vendor/qrcode-generator-1.4.4.js', 'qr-generator', 'vendor');
	if (mode !== 'safe') {
		await add('/', 'NORMAL ' + revision + config, 'shell', 'text/html');
		for (const name of protocol.modules) {
			await add(
				'/modules/' + name + '.js?build=' + build,
				'module ' + name + ' ' + build,
				'module',
				'application/javascript',
				'authenticated',
			);
		}
		if (mode === 'app') {
			await add(
				'/theme-packages/' + packageId + '/entry.js',
				"export const details=()=>import('./chunks/detail.js')",
				'package',
				'text/javascript',
			);
			await add(
				'/theme-packages/' + packageId + '/chunks/detail.js',
				"export const history=()=>import('./history.js')",
				'package',
				'text/javascript',
			);
			await add('/theme-packages/' + packageId + '/chunks/history.js', 'export const entries=[]', 'package', 'text/javascript');
		}
		await add('/manifest.json?appearance=' + revision + '&lang=en', 'NORMAL MANIFEST', 'manifest', 'application/manifest+json');
		for (const size of [192, 512]) {
			await add('/icon-' + size + '.png', 'NORMAL ICON', 'icon', 'image/png');
		}
	}
	await add('/manifest.json?safeMode=1&appearance=0&lang=en', 'SAFE MANIFEST', 'manifest', 'application/manifest+json');
	for (const size of [192, 512]) {
		await add('/icon-' + size + '.png?safeMode=1', 'SAFE ICON', 'icon', 'image/png');
	}
	resources.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
	const descriptor = { formatVersion: 2, transportApiVersion: 1, tuple, shellConfigId, resources };
	descriptor.inventoryHash = await protocol.digest(protocol.canonical(descriptor));
	return { descriptor, tuple, shellConfigId, responses, protocol };
}
export async function snapshotHarness(options = {}) {
	let current = await inventory(options);
	const prefix = 'test-runtime-' + ++sequence + '-';
	const caches = {
		open: (name) => realCaches.open(prefix + name),
		has: (name) => realCaches.has(prefix + name),
		keys: async () => (await realCaches.keys()).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)),
		delete: (name) => realCaches.delete(prefix + name),
	};
	const database = new IDBFactory();
	const index = createRuntimeSnapshotIndex(database);
	const live = [];
	let failure = null;
	let interceptor = null;
	const requests = [];
	const fetch = async (address, requestOptions) => {
		requests.push(address);
		if (interceptor) {
			const response = await interceptor(address, requestOptions);
			if (response) {
				return response;
			}
		}
		if (failure) {
			return new CacheResponse('failed', { status: failure });
		}
		if (new URL(address).pathname === '/api/runtime-manifest') {
			return CacheResponse.json(current.descriptor);
		}
		return current.responses.get(address)?.clone() || new CacheResponse('missing', { status: 404 });
	};
	const clients = { matchAll: async () => live };
	const manager = createRuntimeSnapshotManager({
		buildId: options.workerBuild || buildId,
		origin,
		caches,
		fetch,
		index,
		protocol: current.protocol,
		clients,
	});
	return {
		caches,
		database,
		index,
		manager,
		clients,
		live,
		requests,
		fetch,
		get current() {
			return current;
		},
		setCurrent: (value) => {
			current = value;
		},
		setFailure: (value) => {
			failure = value;
		},
		intercept: (value) => {
			interceptor = value;
		},
		prepare: () => manager.prepare(current.tuple, 'tab', { shellConfigId: current.shellConfigId }),
		attach: (id = 'tab') =>
			manager.attach(current.tuple, id, { shellConfigId: current.shellConfigId, inventoryHash: current.descriptor.inventoryHash }),
		async cleanup() {
			for (const name of await caches.keys()) {
				await caches.delete(name);
			}
		},
	};
}
