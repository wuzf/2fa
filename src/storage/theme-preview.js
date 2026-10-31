/** Five-minute, anonymous resource capabilities for opaque synthetic previews. */
export const PREVIEW_PREFIX = 'theme:preview:';
export const PREVIEW_TTL = 5 * 60 * 1000;
const RATE_PREFIX = 'theme:preview-rate:';
const MAX_ACTIVE = 2;
const MAX_CREATIONS = 6;

const problem = (message, status, code) => Object.assign(new Error(message), { status, code });
const live = (record, now = Date.now()) => record && record.expiresAt > now;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export class ThemePreviewCapabilities {
	constructor(store) {
		this.store = store;
		this.storage = store.storage;
	}

	async create(input, owner) {
		if (!/^[a-f0-9]{64}$/.test(owner || '') || !/^[a-f0-9]{64}$/.test(input?.packageId || '')) {
			throw problem('预览请求无效', 400, 'THEME_INVALID');
		}
		const id = token(),
			now = Date.now(),
			expiresAt = now + PREVIEW_TTL;
		const key = PREVIEW_PREFIX + id;
		await this.storage.transaction(async (tx) => {
			const active = [...(await tx.list({ prefix: PREVIEW_PREFIX })).values()].filter(
				(record) => record.owner === owner && live(record, now),
			);
			if (active.length >= MAX_ACTIVE) {
				throw problem('请先关闭已有预览，再打开新的预览', 429, 'THEME_PREVIEW_CAPACITY');
			}
			const rate = ((await tx.get(RATE_PREFIX + owner)) || []).filter((time) => time > now - 60000);
			if (rate.length >= MAX_CREATIONS) {
				throw problem('预览创建过于频繁，请稍后重试', 429, 'THEME_RATE_LIMIT');
			}
			const pkg = await tx.get('theme:package:' + input.packageId);
			if (pkg?.status !== 'ready' || pkg.kind !== 'app') {
				throw problem('完整前端主题不存在', 404, 'THEME_NOT_FOUND');
			}
			await tx.put(RATE_PREFIX + owner, [...rate, now]);
			await tx.put(key, { owner, packageId: input.packageId, expiresAt, status: 'preparing' });
			await this.store.schedule(tx, expiresAt);
		});
		try {
			const baseUrl = `/theme-preview/${id}/`;
			const { snapshot } = await this.store.prepareAppAppearance(input, { baseUrl });
			const files = snapshot.files;
			const appearance = { ...snapshot, revision: null };
			const document = await this.store.saveDocument(appearance);
			await this.storage.transaction(async (tx) => {
				const current = await tx.get(key);
				const pkg = await tx.get('theme:package:' + input.packageId);
				if (!live(current) || current.owner !== owner || pkg?.status !== 'ready') {
					throw problem('预览会话已过期，请重新打开', 410, 'THEME_PREVIEW_EXPIRED');
				}
				await tx.put(key, {
					...current,
					status: 'ready',
					document: document.hash,
					resources: [...new Set([document.hash, pkg.document, ...files.map((file) => file.hash)])],
				});
			});
			return {
				capabilityId: id,
				expiresAt,
				baseUrl,
				entryUrl: baseUrl + snapshot.manifest.entry,
				styles: snapshot.manifest.styles.map((path) => baseUrl + path),
				appearance,
			};
		} catch (error) {
			await this.storage.delete(key);
			throw error;
		}
	}

	async read(id, path, request) {
		const origin = request.headers.get('Origin');
		const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
		if (request.headers.has('Cookie') || request.headers.has('Authorization') || (origin !== null && origin !== 'null')) {
			return new Response('Forbidden', { status: 403, headers });
		}
		if (origin === 'null') {
			headers['Access-Control-Allow-Origin'] = 'null';
		}
		const key = PREVIEW_PREFIX + id;
		const record = await this.storage.get(key);
		if (!live(record) || record.status !== 'ready') {
			return new Response('Preview expired', { status: 410, headers });
		}
		const appearance = await this.store.readDocument(record.document);
		const file = appearance.files.find((entry) => entry.path === path);
		if (!file) {
			return new Response('Not found', { status: 404, headers });
		}
		const bytes = await this.store.appFileBytes(file, this.storage, file.role === 'asset' ? 'asset' : 'app-file');
		const current = await this.storage.get(key);
		// A read that finishes after revoke/expiry must not release newly read bytes.
		if (!live(current) || current.document !== record.document) {
			return new Response('Preview expired', { status: 410, headers });
		}
		return new Response(request.method === 'HEAD' ? null : bytes, {
			headers: { ...headers, 'Content-Type': file.mime, 'Content-Length': String(bytes.length) },
		});
	}

	async revoke(id, owner) {
		return this.storage.transaction(async (tx) => {
			const key = PREVIEW_PREFIX + id,
				record = await tx.get(key);
			if (record && record.owner !== owner) {
				throw problem('预览不存在', 404, 'THEME_NOT_FOUND');
			}
			await tx.delete(key);
			return { revoked: id };
		});
	}

	async revokeOwner(owner) {
		return this.storage.transaction(async (tx) => {
			let revoked = 0;
			for (const [key, record] of await tx.list({ prefix: PREVIEW_PREFIX })) {
				if (record.owner === owner) {
					await tx.delete(key);
					revoked++;
				}
			}
			return { revoked };
		});
	}

	async pins(storage = this.storage) {
		return [...(await storage.list({ prefix: PREVIEW_PREFIX })).values()].filter((record) => live(record));
	}

	async collect(now) {
		let next = Infinity;
		for (const [key, record] of await this.storage.list({ prefix: PREVIEW_PREFIX })) {
			if (!live(record, now)) {
				await this.storage.delete(key);
			} else {
				next = Math.min(next, record.expiresAt);
			}
		}
		for (const [key, times] of await this.storage.list({ prefix: RATE_PREFIX })) {
			if (!times.some((time) => time > now - 60000)) {
				await this.storage.delete(key);
			}
		}
		return next;
	}
}
