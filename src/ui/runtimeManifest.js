import { createMainPage } from './page.js';
import { createManifest, createDefaultIcon } from './manifest.js';
import { getModuleCode } from './scripts/index.js';
import { getQrVendorInventory } from './qrVendors.js';
import { getRuntimeTuple } from './runtimeIdentity.js';
import { hashBytes, stableStringify } from '../themes/schema.js';
import { SUPPORTED_LANGUAGES } from '../shared/languages.js';

const MODULES = ['appearance', 'import', 'export', 'backup', 'qrcode', 'tools', 'googleMigration'];
const encoder = new TextEncoder();

function failure(code, status = 409) {
	return Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Describes the exact response bytes served by this build. The router authenticates non-safe manifests. */
export async function createRuntimeManifest(request, { appearance, buildId, customCodes = [] }) {
	const url = new URL(request.url);
	const mode = url.searchParams.get('mode');
	const safeMode = mode === 'safe';
	const tuple = getRuntimeTuple(appearance, buildId, safeMode);
	if (!buildId || url.searchParams.get('build') !== buildId) {
		return failure('RUNTIME_BUILD_MISMATCH');
	}
	if (mode !== tuple.mode || url.searchParams.get('appearance') !== String(tuple.appearanceRevision)) {
		return failure('RUNTIME_APPEARANCE_MISMATCH');
	}
	const resources = new Map();
	const add = (item) => {
		const resolved = new URL(item.url, url.origin);
		if (resolved.origin !== url.origin || resolved.hash || !item.url.startsWith('/')) {
			throw new Error('Runtime resource must be a same-origin path');
		}
		if (!/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 0) {
			throw new Error('Runtime resource lacks immutable bytes');
		}
		const previous = resources.get(item.url);
		if (previous && (previous.sha256 !== item.sha256 || previous.size !== item.size || previous.mime !== item.mime)) {
			throw new Error('Conflicting runtime resource');
		}
		if (!previous) {
			resources.set(item.url, item);
		}
	};
	const fromResponse = async (path, response, role, access = 'public') => {
		const bytes = new Uint8Array(await response.arrayBuffer());
		add({
			url: path,
			mime: response.headers.get('Content-Type').split(';')[0],
			size: bytes.length,
			sha256: await hashBytes(bytes),
			role,
			access,
			...(['shell', 'recovery'].includes(role) ? { shellConfigId: response.headers.get('X-2FA-Shell-Config') } : {}),
		});
	};
	const safe = await createMainPage({ buildId, safeMode: true, lazyLoad: true });
	let shellConfigId = safe.headers.get('X-2FA-Shell-Config');
	await fromResponse('/?safeMode=1', safe, 'recovery');
	getQrVendorInventory().forEach(add);
	if (!safeMode) {
		const normal = await createMainPage({ appearance, buildId, customCodes, lazyLoad: true });
		shellConfigId = normal.headers.get('X-2FA-Shell-Config');
		await fromResponse('/', normal, 'shell');
		for (const name of MODULES) {
			await fromResponse(
				'/modules/' + name + '.js?build=' + encodeURIComponent(buildId),
				new Response(getModuleCode(name), { headers: { 'Content-Type': 'application/javascript' } }),
				'module',
				'authenticated',
			);
		}
		for (const file of appearance?.files || []) {
			add({ url: file.url, mime: file.mime, size: file.size, sha256: file.hash, role: 'package', access: 'public' });
		}
		for (const resource of appearance?.resources || []) {
			add({ url: resource.url, mime: resource.mime, size: resource.size, sha256: resource.hash, role: 'asset', access: 'public' });
		}
		for (const language of SUPPORTED_LANGUAGES) {
			const manifestPath = '/manifest.json?appearance=' + tuple.appearanceRevision + '&lang=' + language;
			await fromResponse(manifestPath, createManifest(new Request(new URL(manifestPath, url.origin)), appearance), 'manifest');
		}
		for (const size of [192, 512]) {
			await fromResponse('/icon-' + size + '.png', createDefaultIcon(size), 'icon');
		}
	}
	for (const language of SUPPORTED_LANGUAGES) {
		const safeManifest = '/manifest.json?safeMode=1&appearance=0&lang=' + language;
		await fromResponse(safeManifest, createManifest(new Request(new URL(safeManifest, url.origin))), 'manifest');
	}
	for (const size of [192, 512]) {
		await fromResponse('/icon-' + size + '.png?safeMode=1', createDefaultIcon(size), 'icon');
	}
	const description = {
		formatVersion: 2,
		transportApiVersion: 1,
		tuple,
		shellConfigId,
		resources: [...resources.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
	};
	const inventoryHash = await hashBytes(encoder.encode(stableStringify(description)));
	return Response.json({ ...description, inventoryHash }, { headers: { 'Cache-Control': 'no-store', 'X-2FA-Build': buildId } });
}
