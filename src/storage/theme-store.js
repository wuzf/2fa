/**
 * Authoritative appearance storage. This coordinator runs on appearance:v1, never
 * on the secrets object's queue. Content is immutable and chunked; publication is
 * a transaction over small references, so a partial upload cannot replace a page.
 */
import {
	LIMITS,
	getBuiltinThemes,
	getBuiltinTheme,
	normalizeThemeImport,
	normalizeAppearance,
	importAsset,
	exportTheme,
} from '../themes/index.js';
import { createDefaultAppearance, THEME_OPERATION_HEADER } from '../api/themes.js';
import { createJsonResponse } from '../utils/response.js';

export const THEME_OWNER_KEY = 'theme:owner';
const STATE_KEY = 'theme:state';
const QUOTA_KEY = 'theme:quota';
const META = 'theme:blob:';
const PACKAGE = 'theme:package:';
const RECEIPT = 'theme:receipt:';
const MIRROR = 'theme-assets:v1:';
const CHUNK_SIZE = 128 * 1024;
const MAX_CAPACITY = 50 * 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
const JSON_LIMIT = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function problem(message, status = 400, code = 'THEME_INVALID', details = {}) {
	return Object.assign(new Error(message), { status, code, details });
}

function stable(value) {
	if (Array.isArray(value)) {
		return value.map(stable);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stable(value[key])]),
		);
	}
	return value;
}

async function digest(bytes) {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function initialState() {
	return { revision: 0, active: null, previous: null, profiles: {} };
}

function assetInfo(asset, published = false) {
	return {
		hash: asset.hash,
		name: asset.name,
		mime: asset.mime,
		size: asset.size ?? asset.bytes?.byteLength,
		url: published ? `/theme-assets/${asset.hash}/${encodeURIComponent(asset.name)}` : `/api/appearance/assets/${asset.hash}`,
	};
}

function appearanceInput(value) {
	return Object.fromEntries(
		['packageId', 'themeId', 'settings', 'layout', 'content', 'branding', 'customCss']
			.filter((key) => value[key] !== undefined)
			.map((key) => [key, value[key]]),
	);
}

async function readLimited(request, limit) {
	if (!request.body) {
		return new Uint8Array();
	}
	const reader = request.body.getReader();
	const chunks = [];
	let length = 0;
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(problem('上传超时，请重试', 408, 'THEME_TIMEOUT')), LIMITS.totalMs);
	});
	try {
		while (true) {
			const { done, value } = await Promise.race([reader.read(), timeout]);
			if (done) {
				break;
			}
			length += value.byteLength;
			if (length > limit) {
				throw problem('上传内容超过允许大小', 413, 'THEME_TOO_LARGE');
			}
			chunks.push(value);
		}
	} catch (error) {
		// A broken producer's cancel promise must not keep the write queue occupied.
		void reader.cancel().catch(() => {});
		throw error;
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function readJSON(request) {
	try {
		return JSON.parse(decoder.decode(await readLimited(request, JSON_LIMIT)));
	} catch (error) {
		if (error.status) {
			throw error;
		}
		throw problem('请求必须是有效 JSON');
	}
}

async function readImport(request, restore = false) {
	const limit = restore ? LIMITS.restoreUpload : LIMITS.upload;
	const type = request.headers.get('content-type') || '';
	if (type.includes('application/json')) {
		const body = await readJSON(request);
		if (body.url || body.sourceUrl) {
			return { url: body.url || body.sourceUrl };
		}
		return { bytes: encoder.encode(JSON.stringify(body)), name: 'theme.json' };
	}
	const bytes = await readLimited(request, limit + (type.includes('multipart/form-data') ? 65536 : 0));
	if (type.includes('multipart/form-data')) {
		const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': type }, body: bytes }).formData();
		const file = form.get('file');
		if (!file || typeof file.arrayBuffer !== 'function') {
			throw problem('请选择主题文件');
		}
		if (file.size > limit) {
			throw problem('上传文件超过允许大小', 413, 'THEME_TOO_LARGE');
		}
		return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || 'theme.zip' };
	}
	return { bytes, name: request.headers.get('X-File-Name') || 'theme.zip' };
}

export class ThemeStore {
	constructor(state, env) {
		this.storage = state.storage;
		this.env = env;
		this.tail = Promise.resolve();
		this.initialization = null;
		this.readGate = Promise.resolve();
		this.readers = new Set();
	}

	enqueue(task) {
		const pending = this.tail.then(task, task);
		this.tail = pending.catch(() => undefined);
		return pending;
	}

	async initialize() {
		if (!this.initialization) {
			this.initialization = (async () => {
				if (!(await this.storage.get(THEME_OWNER_KEY))) {
					await this.storage.put(THEME_OWNER_KEY, true);
				}
			})().catch((error) => {
				this.initialization = null;
				throw error;
			});
		}
		return this.initialization;
	}

	async read(task) {
		// Register synchronously, before yielding, so deletion sees every reader
		// which was admitted before its gate closed. Responses materialize bytes.
		const gate = this.readGate;
		let finish;
		const pending = new Promise((resolve) => {
			finish = resolve;
		});
		this.readers.add(pending);
		try {
			await gate;
			return await task();
		} finally {
			this.readers.delete(pending);
			finish();
		}
	}

	async withoutReaders(task) {
		const admitted = [...this.readers];
		let release;
		this.readGate = new Promise((resolve) => {
			release = resolve;
		});
		try {
			await Promise.all(admitted);
			return await task();
		} finally {
			release();
		}
	}

	fetch(request) {
		const execute = async () => {
			try {
				await this.initialize();
				return await this.route(request);
			} catch (error) {
				const status = error.status || error.statusCode || 500;
				if (status >= 500) {
					console.error('Theme operation failed:', error.message);
				}
				return createJsonResponse(
					{
						error: error.code || 'THEME_ERROR',
						message: status >= 500 ? '主题存储暂时不可用，请保留草稿后重试' : error.message,
						details: error.details || {},
					},
					status,
					request,
					{ 'Cache-Control': 'no-store' },
				);
			}
		};
		// Publication is an atomic reference swap; immutable reads need not wait
		// for request bodies, remote downloads, or unpublished writes to finish.
		return ['GET', 'HEAD'].includes(request.method) ? this.read(execute) : this.enqueue(execute);
	}

	async route(request) {
		const path = new URL(request.url).pathname;
		const operation = request.headers.get(THEME_OPERATION_HEADER);
		if (operation === 'public') {
			const match = /^\/theme-assets\/([a-f0-9]{64})\/[^/]+$/.exec(path);
			return match ? this.readAsset(match[1], request, true) : new Response('Not found', { status: 404 });
		}
		if (operation === 'appearance') {
			return Response.json((await this.readAppearance()).active);
		}
		if (operation !== 'api') {
			return new Response('Not found', { status: 404 });
		}
		if (!['GET', 'HEAD'].includes(request.method)) {
			await this.checkRate(path);
		}
		const json = (body, status = 200) => createJsonResponse(body, status, request, { 'Cache-Control': 'no-store' });
		if (path === '/api/themes' && request.method === 'GET') {
			return json(await this.listThemes());
		}
		if (path === '/api/appearance' && request.method === 'GET') {
			return json(await this.readAppearance());
		}
		if (path === '/api/appearance' && request.method === 'PUT') {
			return json(await this.apply(await readJSON(request)));
		}
		if (path === '/api/appearance/rollback' && request.method === 'POST') {
			return json(await this.apply(await readJSON(request), true));
		}
		if (path === '/api/themes/import' && request.method === 'POST') {
			return json(await this.install(await readImport(request)), 201);
		}
		if (path === '/api/appearance/restore-inspect' && request.method === 'POST') {
			return json(await this.install(await readImport(request, true), true), 201);
		}
		if (path === '/api/appearance/assets' && request.method === 'POST') {
			return json(await this.uploadAsset(await readImport(request, true)), 201);
		}
		const privateAsset = /^\/api\/appearance\/assets\/([a-f0-9]{64})$/.exec(path);
		if (privateAsset && ['GET', 'HEAD'].includes(request.method)) {
			return this.readAsset(privateAsset[1], request, false);
		}
		const theme = /^\/api\/themes\/([^/]+)(\/export)?$/.exec(path);
		if (theme) {
			const id = decodeURIComponent(theme[1]);
			if (theme[2] && request.method === 'GET') {
				return this.export(id, false);
			}
			if (!theme[2] && request.method === 'DELETE') {
				return json(await this.deletePackage(id));
			}
		}
		if (path === '/api/appearance/export' && request.method === 'GET') {
			return this.export(null, true);
		}
		return new Response('Not found', { status: 404 });
	}

	/** Rate limits are authoritative and independent of the secrets operation quota. */
	async checkRate(path) {
		const expensive = path.includes('import') || path.includes('restore') || path.endsWith('/assets');
		const key = `theme:rate:${expensive ? 'import' : 'write'}`;
		const now = Date.now();
		const entries = ((await this.storage.get(key)) || []).filter((time) => time > now - 60000);
		if (entries.length >= (expensive ? 30 : 120)) {
			throw problem('主题操作过于频繁，请稍后重试', 429, 'THEME_RATE_LIMIT');
		}
		entries.push(now);
		await this.storage.put(key, entries);
	}

	async state() {
		return (await this.storage.get(STATE_KEY)) || initialState();
	}

	async readAppearance() {
		const state = await this.state();
		const active = state.active ? await this.readDocument(state.active) : createDefaultAppearance();
		return {
			revision: state.revision,
			active: { ...active, revision: state.revision },
			previous: !!state.previous,
			capabilities: { write: true },
		};
	}

	async getPackage(id) {
		const builtin = getBuiltinTheme(id);
		if (builtin) {
			return builtin;
		}
		const record = await this.storage.get(PACKAGE + id);
		if (!record || record.status !== 'ready') {
			throw problem('主题版本不存在或尚未安装完成', 404, 'THEME_NOT_FOUND');
		}
		return this.readDocument(record.document);
	}

	async listThemes() {
		const state = await this.state();
		const themes = getBuiltinThemes().map((pkg) => ({ ...pkg, builtIn: true }));
		for (const record of (await this.storage.list({ prefix: PACKAGE })).values()) {
			if (record.status === 'ready') {
				const pkg = await this.readDocument(record.document);
				themes.push({ ...pkg, builtIn: false, installedAt: record.installedAt, source: record.source });
			}
		}
		for (const theme of themes) {
			theme.assets = (theme.assets || []).map((asset) => assetInfo(asset));
			const profile = state.profiles[theme.manifest.id];
			if (profile) {
				theme.profile = await this.readDocument(profile);
			}
		}
		return { themes };
	}

	async schedule(storage = this.storage, when = Date.now() + 60000) {
		const alarm = await storage.getAlarm();
		if (!alarm || alarm > when) {
			await storage.setAlarm(when);
		}
	}

	async saveBlob(asset, kind = 'asset') {
		const bytes = asset.bytes instanceof Uint8Array ? asset.bytes : new Uint8Array(asset.bytes);
		const hash = await digest(bytes);
		if (asset.hash && asset.hash !== hash) {
			throw problem('资源校验失败', 400, 'THEME_HASH_MISMATCH');
		}
		const key = META + hash;
		const reserved = await this.storage.transaction(async (tx) => {
			const existing = await tx.get(key);
			if (existing?.status === 'ready') {
				// Re-uploading a local draft renews staging without touching public state.
				existing.expiresAt = Date.now() + TTL;
				await tx.put(key, existing);
				await this.schedule(tx, existing.expiresAt);
				return { existing };
			}
			if (existing) {
				throw problem('资源正在处理，请稍后重试', 409, 'THEME_RESOURCE_BUSY');
			}
			const quota = (await tx.get(QUOTA_KEY)) || { bytes: 0 };
			if (quota.bytes + bytes.byteLength > MAX_CAPACITY) {
				throw problem('主题素材总容量已达到 50MiB，请删除未使用的主题后重试', 413, 'THEME_CAPACITY', {
					bytes: quota.bytes,
					limit: MAX_CAPACITY,
				});
			}
			const record = {
				hash,
				name: asset.name || hash,
				mime: asset.mime || 'application/octet-stream',
				size: bytes.byteLength,
				chunks: Math.ceil(bytes.byteLength / CHUNK_SIZE),
				kind,
				status: 'writing',
				createdAt: Date.now(),
				expiresAt: Date.now() + TTL,
				public: false,
				attempts: 0,
				nextAttemptAt: Date.now() + 60000,
				mirrored: false,
			};
			await tx.put(key, record);
			await tx.put(QUOTA_KEY, { bytes: quota.bytes + bytes.byteLength });
			await this.schedule(tx);
			return { record };
		});
		if (reserved.existing) {
			return reserved.existing;
		}
		try {
			for (let offset = 0, index = 0; offset < bytes.byteLength; offset += CHUNK_SIZE, index++) {
				await this.storage.put(`theme:chunk:${hash}:${index}`, bytes.slice(offset, offset + CHUNK_SIZE));
			}
			const record = { ...reserved.record, status: 'ready' };
			await this.storage.put(key, record);
			return record;
		} catch (error) {
			await this.removeBlob(reserved.record);
			throw error;
		}
	}

	async saveDocument(value) {
		return this.saveBlob({ bytes: encoder.encode(JSON.stringify(value)), mime: 'application/json', name: 'document.json' }, 'document');
	}

	async readBytes(record, useMirror = false) {
		if (!record || record.status !== 'ready') {
			throw problem('主题资源已过期，请从本机草稿重新上传', 404, 'THEME_ASSET_MISSING');
		}
		if (useMirror && this.env.SECRETS_KV) {
			try {
				const value = await this.env.SECRETS_KV.get(MIRROR + record.hash, 'arrayBuffer');
				if (value && value.byteLength === record.size && (await digest(value)) === record.hash) {
					return new Uint8Array(value);
				}
			} catch {
				/* The authoritative copy below is always sufficient. */
			}
		}
		const bytes = new Uint8Array(record.size);
		for (let index = 0; index < record.chunks; index++) {
			const chunk = await this.storage.get(`theme:chunk:${record.hash}:${index}`);
			if (!chunk) {
				throw problem('主题资源不完整，请重新安装', 503, 'THEME_ASSET_INCOMPLETE');
			}
			bytes.set(new Uint8Array(chunk), index * CHUNK_SIZE);
		}
		return bytes;
	}

	async readDocument(hash) {
		return JSON.parse(decoder.decode(await this.readBytes(await this.storage.get(META + hash))));
	}

	async resolveAsset(hash) {
		const meta = await this.storage.get(META + hash);
		if (!meta || meta.kind !== 'asset') {
			throw problem('素材不存在，请从本机草稿重新上传', 404, 'THEME_ASSET_MISSING', { hash });
		}
		return { ...assetInfo(meta), bytes: await this.readBytes(meta) };
	}

	async readAsset(hash, request, published) {
		const meta = await this.storage.get(META + hash);
		if (!meta || meta.status !== 'ready' || meta.kind !== 'asset' || (published && !meta.public)) {
			return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
		}
		const headers = {
			'Content-Type': meta.mime,
			'Content-Length': String(meta.size),
			'Cache-Control': published ? 'public, max-age=31536000, immutable' : 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			ETag: `"${hash}"`,
		};
		if (published && request.headers.get('If-None-Match') === headers.ETag) {
			return new Response(null, { status: 304, headers });
		}
		return new Response(request.method === 'HEAD' ? null : await this.readBytes(meta, published), { headers });
	}

	async install(input, restore = false) {
		const pkg = await normalizeThemeImport(input, { restore });
		if (getBuiltinTheme(pkg.packageId)) {
			throw problem('导入主题不能覆盖内置主题');
		}
		const packageKey = PACKAGE + pkg.packageId;
		await this.storage.transaction(async (tx) => {
			if (await tx.get(packageKey)) {
				return;
			}
			const versions = await tx.list({ prefix: PACKAGE });
			if (versions.size >= 20) {
				throw problem('最多安装 20 个主题版本，请删除不再使用的版本', 413, 'THEME_VERSION_CAPACITY');
			}
			await tx.put(packageKey, { status: 'installing', installedAt: Date.now(), expiresAt: Date.now() + TTL });
			await this.schedule(tx);
		});
		try {
			for (const asset of pkg.appearanceAssets || pkg.assets) {
				await this.saveBlob(asset);
			}
			const normalized = {
				packageId: pkg.packageId,
				manifest: pkg.manifest,
				css: pkg.css,
				assets: pkg.assets.map((asset) => assetInfo(asset)),
			};
			const document = await this.saveDocument(normalized);
			await this.storage.put(packageKey, {
				status: 'ready',
				document: document.hash,
				resources: pkg.assets.map((asset) => asset.hash),
				source: input.url || null,
				installedAt: Date.now(),
			});
			let appearance;
			if (pkg.appearance) {
				const result = await normalizeAppearance(pkg, pkg.appearance, { resolveAsset: (hash) => this.resolveAsset(hash) });
				for (const asset of result.assets) {
					await this.saveBlob(asset);
				}
				// A restore draft needs its personal assets for isolated preview and
				// durable local Blob copies; they are not part of the author's package.
				appearance = { ...result.appearance, resources: result.assets.map((asset) => assetInfo(asset, true)) };
			}
			return { theme: normalized, ...(appearance ? { appearance } : {}) };
		} catch (error) {
			const record = await this.storage.get(packageKey);
			if (record?.status === 'installing') {
				await this.storage.delete(packageKey);
			}
			throw error;
		}
	}

	async uploadAsset(input) {
		const asset = await importAsset(input);
		return { asset: assetInfo(await this.saveBlob(asset)) };
	}

	async checkOperation(body, rollback) {
		if (
			!body ||
			typeof body !== 'object' ||
			!/^[A-Za-z0-9_-]{8,128}$/.test(body.operationId || '') ||
			!Number.isSafeInteger(body.expectedRevision) ||
			body.expectedRevision < 0
		) {
			throw problem('请提供 operationId 和有效的 expectedRevision');
		}
		const hash = await digest(encoder.encode(JSON.stringify(stable({ ...body, rollback }))));
		const receipt = await this.storage.get(RECEIPT + body.operationId);
		if (receipt && receipt.expiresAt > Date.now()) {
			if (receipt.digest !== hash) {
				throw problem('相同操作标识不能用于不同内容', 409, 'THEME_OPERATION_REUSED');
			}
			return { digest: hash, receipt };
		}
		const state = await this.state();
		if (state.revision !== body.expectedRevision) {
			throw problem('另一设备已更新外观，请保留草稿并重新加载当前配置', 409, 'THEME_REVISION_CONFLICT', { revision: state.revision });
		}
		return { digest: hash, state };
	}

	async receiptResponse(receipt) {
		return {
			revision: receipt.revision,
			active: { ...(await this.readDocument(receipt.snapshot)), revision: receipt.revision },
			previous: receipt.previous,
			replayed: true,
		};
	}

	async apply(body, rollback = false) {
		const checked = await this.checkOperation(body, rollback);
		if (checked.receipt) {
			return this.receiptResponse(checked.receipt);
		}
		const state = checked.state;
		let snapshot;
		if (rollback) {
			if (!state.previous) {
				throw problem('没有可回退的外观', 409, 'THEME_NO_PREVIOUS');
			}
			snapshot = await this.readDocument(state.previous);
		} else {
			const pkg = await this.getPackage(body.packageId);
			// Package assets loaded from storage carry metadata; normalization needs bytes.
			const fullPkg = { ...pkg, assets: await Promise.all(pkg.assets.map((asset) => this.resolveAsset(asset.hash))) };
			const normalized = await normalizeAppearance(fullPkg, appearanceInput(body), { resolveAsset: (hash) => this.resolveAsset(hash) });
			for (const asset of normalized.assets) {
				await this.saveBlob(asset);
			}
			snapshot = {
				...normalized.appearance,
				packageId: pkg.packageId,
				themeId: pkg.manifest.id,
				manifest: pkg.manifest,
				css: pkg.css,
				resources: normalized.assets.map((asset) => assetInfo(asset, true)),
			};
		}
		const document = await this.saveDocument(snapshot);
		const prior = state.active || (await this.saveDocument(createDefaultAppearance())).hash;
		const response = await this.storage.transaction(async (tx) => {
			const existing = await tx.get(RECEIPT + body.operationId);
			if (existing && existing.expiresAt > Date.now()) {
				if (existing.digest !== checked.digest) {
					throw problem('相同操作标识不能用于不同内容', 409, 'THEME_OPERATION_REUSED');
				}
				return existing;
			}
			const current = (await tx.get(STATE_KEY)) || initialState();
			if (current.revision !== body.expectedRevision) {
				throw problem('另一设备已更新外观', 409, 'THEME_REVISION_CONFLICT', { revision: current.revision });
			}
			if (!getBuiltinTheme(snapshot.packageId)) {
				const version = await tx.get(PACKAGE + snapshot.packageId);
				if (version?.status !== 'ready') {
					throw problem('主题版本已被删除，请重新安装', 409, 'THEME_NOT_FOUND');
				}
			}
			for (const resource of snapshot.resources) {
				const meta = await tx.get(META + resource.hash);
				if (!meta || meta.status !== 'ready') {
					throw problem('素材已过期，请重新上传', 409, 'THEME_ASSET_MISSING', { hash: resource.hash });
				}
				await tx.put(META + resource.hash, { ...meta, public: true });
			}
			const revision = current.revision + 1;
			await tx.put(STATE_KEY, {
				...current,
				revision,
				active: document.hash,
				previous: prior,
				profiles: { ...current.profiles, [snapshot.themeId]: document.hash },
			});
			const receipt = { digest: checked.digest, revision, snapshot: document.hash, previous: true, expiresAt: Date.now() + TTL };
			await tx.put(RECEIPT + body.operationId, receipt);
			await this.schedule(tx);
			return receipt;
		});
		return { revision: response.revision, active: { ...snapshot, revision: response.revision }, previous: true };
	}

	async deletePackage(id) {
		if (getBuiltinTheme(id)) {
			throw problem('内置主题不能删除', 409, 'THEME_BUILTIN');
		}
		const state = await this.state();
		for (const hash of [state.active, state.previous].filter(Boolean)) {
			if ((await this.readDocument(hash)).packageId === id) {
				throw problem('当前或上一外观使用此版本，暂时不能删除', 409, 'THEME_IN_USE');
			}
		}
		const record = await this.storage.get(PACKAGE + id);
		if (!record) {
			throw problem('主题不存在', 404, 'THEME_NOT_FOUND');
		}
		const pkg = await this.readDocument(record.document);
		const profileHash = state.profiles[pkg.manifest.id];
		if (profileHash && (await this.readDocument(profileHash)).packageId === id) {
			delete state.profiles[pkg.manifest.id];
		}
		await this.storage.transaction(async (tx) => {
			await tx.delete(PACKAGE + id);
			await tx.put(STATE_KEY, state);
			await this.schedule(tx);
		});
		return { deleted: id };
	}

	async export(id, full) {
		let appearance;
		if (full) {
			appearance = (await this.readAppearance()).active;
			id = appearance.packageId;
		}
		const pkg = await this.getPackage(id);
		const assets = await Promise.all((full ? appearance.resources : pkg.assets).map((asset) => this.resolveAsset(asset.hash)));
		const bytes = await exportTheme({ ...pkg, assets }, full ? { appearance: appearanceInput(appearance), assets } : {});
		return new Response(bytes, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${full ? '2fa-appearance' : '2fa-theme'}.zip"`,
				'Cache-Control': 'private, no-store',
				'X-Content-Type-Options': 'nosniff',
			},
		});
	}

	async referencedBlobs() {
		const protectedHashes = new Set();
		for (const record of (await this.storage.list({ prefix: PACKAGE })).values()) {
			if (record.status === 'ready') {
				protectedHashes.add(record.document);
				for (const hash of record.resources) {
					protectedHashes.add(hash);
				}
			}
		}
		const state = await this.state();
		const snapshots = [state.active, state.previous, ...Object.values(state.profiles)];
		for (const receipt of (await this.storage.list({ prefix: RECEIPT })).values()) {
			if (receipt.expiresAt > Date.now()) {
				snapshots.push(receipt.snapshot);
			}
		}
		for (const hash of new Set(snapshots.filter(Boolean))) {
			protectedHashes.add(hash);
			for (const resource of (await this.readDocument(hash)).resources || []) {
				protectedHashes.add(resource.hash);
			}
		}
		return protectedHashes;
	}

	async removeBlob(record) {
		return this.withoutReaders(() => this.deleteBlob(record));
	}

	async deleteBlob(record) {
		await this.storage.put(META + record.hash, { ...record, status: 'deleting' });
		for (let index = 0; index < record.chunks; index++) {
			await this.storage.delete(`theme:chunk:${record.hash}:${index}`);
		}
		// Tombstone remains until the mirror deletion also succeeds; a failed cleanup retries.
		if (this.env.SECRETS_KV) {
			await this.env.SECRETS_KV.delete(MIRROR + record.hash);
		}
		await this.storage.transaction(async (tx) => {
			const current = await tx.get(META + record.hash);
			if (current) {
				const quota = (await tx.get(QUOTA_KEY)) || { bytes: 0 };
				await tx.put(QUOTA_KEY, { bytes: Math.max(0, quota.bytes - current.size) });
				await tx.delete(META + record.hash);
			}
		});
	}

	alarm() {
		return this.enqueue(async () => {
			const now = Date.now();
			const references = await this.referencedBlobs();
			const records = await this.storage.list({ prefix: META });
			let processed = 0;
			let next = now + TTL;
			for (const record of records.values()) {
				const garbage = record.status === 'deleting' || (!references.has(record.hash) && record.expiresAt <= now);
				const mirror = record.kind === 'asset' && record.status === 'ready' && !record.mirrored && !!this.env.SECRETS_KV;
				if (processed >= 16 || record.nextAttemptAt > now) {
					if (garbage || mirror) {
						next = Math.min(next, Math.max(now + 1000, record.nextAttemptAt));
					}
					continue;
				}
				if (garbage || mirror) {
					processed++;
					try {
						if (garbage) {
							await this.removeBlob(record);
						} else {
							await this.env.SECRETS_KV.put(MIRROR + record.hash, await this.readBytes(record));
							await this.storage.put(META + record.hash, { ...record, mirrored: true, attempts: 0 });
						}
					} catch {
						const attempts = record.attempts + 1;
						const nextAttemptAt = now + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6));
						const current = await this.storage.get(META + record.hash);
						if (current) {
							await this.storage.put(META + record.hash, { ...current, attempts, nextAttemptAt });
						}
						next = Math.min(next, nextAttemptAt);
					}
				}
				if (!references.has(record.hash) && record.expiresAt > now) {
					next = Math.min(next, record.expiresAt);
				}
			}
			for (const [key, receipt] of await this.storage.list({ prefix: RECEIPT })) {
				if (receipt.expiresAt <= now) {
					await this.storage.delete(key);
				} else {
					next = Math.min(next, receipt.expiresAt);
				}
			}
			for (const [key, record] of await this.storage.list({ prefix: PACKAGE })) {
				if (record.status === 'installing' && record.expiresAt <= now) {
					await this.storage.delete(key);
				}
			}
			await this.storage.setAlarm(next);
		});
	}
}
