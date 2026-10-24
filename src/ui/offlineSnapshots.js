/** Independent from account operations: an index transaction promotes a complete cache. */
export function createSnapshotIndex(database = indexedDB) {
	const open = () =>
		new Promise((resolve, reject) => {
			const request = database.open('2fa-appearance-snapshots', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('state');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	async function transact(change) {
		const db = await open();
		return new Promise((resolve, reject) => {
			const tx = db.transaction('state', change ? 'readwrite' : 'readonly');
			const store = tx.objectStore('state');
			let result;
			const request = store.get('index');
			request.onsuccess = () => {
				try {
					const state = request.result || { generation: 0, active: null, previous: null, target: null, pins: {} };
					result = change ? change(state) : state;
					if (change) {
						store.put(state, 'index');
					}
				} catch (error) {
					reject(error);
					tx.abort();
				}
			};
			tx.oncomplete = () => {
				db.close();
				resolve(result);
			};
			tx.onabort = tx.onerror = () => {
				db.close();
				reject(tx.error || new Error('Snapshot transaction failed'));
			};
		});
	}
	return { read: () => transact(), update: (change) => transact(change) };
}

/** Dependencies are injected so failure ordering and competing tabs can be tested. */
export function createSnapshotManager({ buildId, origin, caches, fetch, index, clients, canClean = async () => true }) {
	const absolute = (path) => new URL(path, origin).href;
	const shellKey = absolute('/');
	const safeKey = absolute('/?safeMode=1');
	const prefix = '2fa-snapshot-';
	const isBuild = (value) => /^[a-f0-9]{64}$/.test(value || '');
	function safeRequest(request) {
		const query = new URL(request.url).searchParams;
		return query.get('safeMode') === '1' || query.get('disableCustomCode') === '1';
	}
	async function fetchComplete(url, method = 'GET') {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch(absolute(url), { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
			if (!response.ok || response.redirected) {
				throw new Error('Snapshot resource unavailable');
			}
			const body = await response.arrayBuffer();
			if (controller.signal.aborted) {
				throw new Error('Snapshot resource timed out');
			}
			return new Response(body, { status: response.status, headers: response.headers });
		} finally {
			clearTimeout(timer);
		}
	}
	async function pin(clientId, requestedBuild, revision) {
		if (!clientId) {
			return;
		}
		await index.update((state) => {
			const normalizedBuild = isBuild(requestedBuild) ? requestedBuild : 'legacy';
			const previous = state.pins[clientId];
			// The loaded offline shell owns its cache selection. Its boot message
			// must not replace that selection with the newer global active cache.
			if (previous?.buildId === normalizedBuild && (revision === undefined || previous.revision === revision)) {
				delete previous.pendingUntil;
				return;
			}
			const snapshot = [state.active, state.previous].find((entry) => entry?.buildId === normalizedBuild && entry.revision === revision);
			state.pins[clientId] = { buildId: normalizedBuild, revision, ...(snapshot ? { cacheName: snapshot.cacheName } : {}) };
		});
	}
	async function clean() {
		if (!(await canClean())) {
			return;
		}
		const state = await index.read();
		if (!state.active) {
			return;
		}
		const live = await clients.matchAll({ type: 'window', includeUncontrolled: true });
		// A newly controlled or legacy page must identify its build before collection.
		if (live.some((client) => !state.pins[client.id])) {
			return;
		}
		for (const name of await caches.keys()) {
			if (!(await canClean())) {
				return;
			}
			// A candidate can promote while earlier cache deletions are awaiting I/O.
			// Re-read protections for every immutable cache name. Once a name is
			// neither active/previous nor the target, CAS can never promote it later.
			const current = await index.read();
			const builds = new Set(live.map((client) => current.pins[client.id]?.buildId));
			builds.add(buildId);
			if (current.target) {
				builds.add(current.target.buildId);
			}
			const retained = new Set([current.active?.cacheName, current.previous?.cacheName]);
			for (const client of live) {
				retained.add(current.pins[client.id]?.cacheName);
			}
			// A navigation's resultingClientId is assigned before its response is
			// delivered and can briefly be absent from clients.matchAll().
			for (const pin of Object.values(current.pins)) {
				if (pin.pendingUntil > Date.now()) {
					builds.add(pin.buildId);
					retained.add(pin.cacheName);
				}
			}
			for (const snapshot of [current.active, current.previous]) {
				if (snapshot) {
					builds.add(snapshot.buildId);
				}
			}
			if (retained.has(name)) {
				continue;
			}
			if (name.startsWith(prefix)) {
				const neededByClient = live.some((client) => {
					const pin = current.pins[client.id] || state.pins[client.id];
					return name.startsWith(prefix + pin.buildId + '-' + (Number.isSafeInteger(pin.revision) ? pin.revision + '-' : ''));
				});
				const targetName =
					current.target && prefix + current.target.buildId + '-' + current.target.revision + '-' + current.target.generation;
				if (!neededByClient && name !== targetName) {
					await caches.delete(name);
				}
			} else if (name.startsWith('2fa-modules-') && !builds.has(name.slice('2fa-modules-'.length))) {
				await caches.delete(name);
			} else if (!builds.has('legacy') && /^(2fa-cache-|2fa-runtime-)/.test(name)) {
				// An older live page and the previous complete shell can still need
				// their CDN or miscellaneous resources after the new worker claims them.
				if (!builds.has(name.replace(/^2fa-(?:cache|runtime)-/, ''))) {
					await caches.delete(name);
				}
			}
		}
		await index.update((current) => {
			const ids = new Set(live.map((client) => client.id));
			for (const id of Object.keys(state.pins)) {
				if (!ids.has(id) && !(current.pins[id]?.pendingUntil > Date.now())) {
					delete current.pins[id];
				}
			}
		});
	}
	async function stage(appearance, requestedBuild = buildId) {
		if (!isBuild(buildId) || requestedBuild !== buildId || !Number.isSafeInteger(appearance?.revision) || appearance.revision < 0) {
			return { ready: false, reason: 'outdated' };
		}
		// The server confirms both targets; a delayed old page cannot set the target.
		const main = await fetchComplete('/');
		if (main.headers.get('X-2FA-Build') !== buildId || main.headers.get('X-2FA-Appearance-Revision') !== String(appearance.revision)) {
			return { ready: false, reason: 'outdated' };
		}
		const candidate = await index.update((state) => {
			if (state.target?.buildId === buildId && state.target.revision > appearance.revision) {
				return null;
			}
			state.generation += 1;
			state.target = { buildId, revision: appearance.revision, generation: state.generation };
			return { ...state.target, cacheName: prefix + buildId + '-' + appearance.revision + '-' + state.generation };
		});
		if (!candidate) {
			return { ready: false, reason: 'unchanged' };
		}
		const cache = await caches.open(candidate.cacheName);
		try {
			await cache.put(shellKey, main);
			const safe = await fetchComplete('/?safeMode=1');
			if (safe.headers.get('X-2FA-Build') !== buildId) {
				throw new Error('Recovery build mismatch');
			}
			await cache.put(safeKey, safe);
			const manifestUrl = '/manifest.json?appearance=' + appearance.revision;
			const manifest = await fetchComplete(manifestUrl);
			const manifestData = await manifest.clone().json();
			await cache.put(absolute(manifestUrl), manifest);
			const resources = new Set(['/icon-192.png', '/icon-512.png']);
			for (const icon of manifestData.icons || []) {
				resources.add(icon.src);
			}
			for (const resource of appearance.resources || []) {
				resources.add(resource.url || '/theme-assets/' + resource.hash + '/' + encodeURIComponent(resource.name));
			}
			if (resources.size > 72) {
				throw new Error('Too many snapshot resources');
			}
			for (const resource of resources) {
				const url = new URL(resource, origin);
				if (url.origin !== origin || !/^\/(theme-assets\/|icon-|apple-touch-icon)/.test(url.pathname)) {
					throw new Error('Invalid snapshot resource');
				}
				const response = await fetchComplete(url.href);
				const expectedHash = /^\/theme-assets\/([a-f0-9]{64})\//.exec(url.pathname)?.[1];
				if (expectedHash) {
					const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
					const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
					if (actualHash !== expectedHash) {
						throw new Error('Snapshot asset hash mismatch');
					}
				}
				await cache.put(url.href, response);
			}
			candidate.requiredUrls = [shellKey, safeKey, absolute(manifestUrl), ...[...resources].map(absolute)];
			await cache.put(
				absolute('/__appearance_snapshot__'),
				new Response(JSON.stringify(appearance), { headers: { 'Content-Type': 'application/json' } }),
			);
			// The manifest and default icon URLs are mutable. A server-side change
			// during the downloads must not combine them with an earlier shell.
			const confirmation = await fetchComplete('/', 'HEAD');
			if (
				!confirmation.ok ||
				confirmation.headers.get('X-2FA-Build') !== buildId ||
				confirmation.headers.get('X-2FA-Appearance-Revision') !== String(appearance.revision)
			) {
				await caches.delete(candidate.cacheName);
				return { ready: false, reason: 'outdated' };
			}
			const promoted = await index.update((state) => {
				if (
					state.target?.generation !== candidate.generation ||
					state.target?.buildId !== candidate.buildId ||
					state.target?.revision !== candidate.revision
				) {
					return false;
				}
				state.previous = state.active;
				state.active = candidate;
				// Applying a theme pins the new revision before its cache exists.
				// Complete those pins atomically so later promotions cannot strand
				// a still-open page outside active/previous lookup.
				for (const pin of Object.values(state.pins)) {
					if (pin.buildId === candidate.buildId && pin.revision === candidate.revision && !pin.cacheName) {
						pin.cacheName = candidate.cacheName;
					}
				}
				return true;
			});
			if (!promoted) {
				await caches.delete(candidate.cacheName);
				return { ready: false, reason: 'outdated' };
			}
			await clean().catch(() => {});
			return { ready: true, revision: candidate.revision };
		} catch (error) {
			await caches.delete(candidate.cacheName).catch(() => {});
			throw error;
		}
	}
	async function match(request, clientId = '') {
		const state = await index.read();
		const url = new URL(request.url);
		const navigation = url.pathname === '/';
		const mutable = url.pathname === '/manifest.json' || /^\/(?:icon-|apple-touch-icon)/.test(url.pathname);
		const bound = clientId && state.pins[clientId];
		const explicitRevision =
			url.pathname === '/manifest.json' && url.searchParams.has('appearance') ? Number(url.searchParams.get('appearance')) : null;
		let candidates = [state.active, state.previous];
		if (!navigation && mutable) {
			if (bound && isBuild(bound.buildId)) {
				if (explicitRevision !== null && !bound.safeMode && bound.revision !== explicitRevision) {
					return null;
				}
				candidates = bound.cacheName
					? [bound]
					: candidates.filter((entry) => entry?.buildId === bound.buildId && entry.revision === bound.revision);
			} else if (explicitRevision !== null) {
				candidates = candidates.filter((entry) => entry?.revision === explicitRevision);
			}
		}
		for (const snapshot of candidates) {
			if (!snapshot) {
				continue;
			}
			const cache = await caches.open(snapshot.cacheName);
			if ((navigation && !safeRequest(request)) || (mutable && !bound && explicitRevision === null)) {
				let complete = true;
				for (const required of snapshot.requiredUrls || []) {
					if (!(await cache.match(required))) {
						complete = false;
						break;
					}
				}
				if (!complete) {
					continue;
				}
			}
			const key =
				url.pathname === '/'
					? safeRequest(request)
						? safeKey
						: shellKey
					: url.pathname === '/manifest.json'
						? absolute('/manifest.json?appearance=' + snapshot.revision)
						: request;
			const response = await cache.match(key);
			if (response) {
				if (navigation && clientId) {
					await index.update((current) => {
						current.pins[clientId] = {
							buildId: snapshot.buildId,
							revision: snapshot.revision,
							cacheName: snapshot.cacheName,
							safeMode: safeRequest(request),
							fromFallback: true,
							pendingUntil: Date.now() + 30000,
						};
					});
				}
				return response;
			}
		}
		if (url.pathname.startsWith('/theme-assets/')) {
			// Immutable public resources may belong to a still-open older tab.
			for (const name of await caches.keys()) {
				if (!name.startsWith(prefix)) {
					continue;
				}
				const response = await (await caches.open(name)).match(request);
				if (response) {
					return response;
				}
			}
		}
		// Exact legacy recovery URL only: never substitute the ordinary app shell.
		if (!state.active && url.pathname === '/') {
			return caches.match(request);
		}
		return null;
	}
	async function boundResource(request, clientId) {
		const path = new URL(request.url).pathname;
		if (!clientId || !(path === '/manifest.json' || /^\/(?:icon-|apple-touch-icon)/.test(path))) {
			return null;
		}
		const state = await index.read();
		if (!state.pins[clientId]?.cacheName || !state.pins[clientId]?.fromFallback) {
			return null;
		}
		// A fallback may be caused by a slow HTML response while the network can
		// still serve newer mutable assets. Keep those assets with the chosen shell.
		return (await match(request, clientId)) || new Response('', { status: 503 });
	}
	return { stage, match, boundResource, pin, clean, safeRequest };
}
