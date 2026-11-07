/** Complete runtime resources and update admission. No theme code executes in this factory. */
export function createRuntimeSnapshotManager({
	buildId,
	origin,
	caches,
	fetch,
	index,
	protocol,
	clients,
	now = () => Date.now(),
	random = () => crypto.randomUUID(),
	notify = () => {},
	timers = {},
}) {
	const absolute = (value) => new URL(value, origin).href;
	const setTimer = timers.setTimeout || ((callback, delay) => globalThis.setTimeout(callback, delay));
	const clearTimer = timers.clearTimeout || ((id) => globalThis.clearTimeout(id));
	const pending = new Map();
	// The shell a navigation just downloaded; preparing its snapshot reuses it instead of fetching it twice.
	const recentShells = new Map();
	const prefix = '2fa-app-snapshot-v2-';
	const marker = absolute('/__runtime_snapshot_v2__');
	const errorResult = (reason, extra = {}) => ({
		status: 'blocked',
		compatible: false,
		resourcesReady: false,
		recoveryReady: false,
		reason,
		...extra,
	});
	const ready = (tuple, extra = {}) => ({ status: 'ready', tuple, compatible: true, resourcesReady: true, recoveryReady: true, ...extra });
	function initialize(state) {
		for (const key of ['candidates', 'complete', 'snapshots', 'pins', 'admissions', 'deleting', 'workerProtocol']) {
			state[key] ||= {};
		}
		state.generation ||= 0;
		return state;
	}
	const manifestURL = (tuple) =>
		'/api/runtime-manifest?build=' + tuple.hostBuild + '&appearance=' + tuple.appearanceRevision + '&mode=' + tuple.mode;
	async function readResponse(url, { timeout = 15000, signal, maximum = 16 * 1024 * 1024 } = {}) {
		const controller = new AbortController();
		let bodyReader = null;
		let rejectAbort;
		const cancelled = new Promise((_, reject) => {
			rejectAbort = reject;
		});
		const abort = () => {
			controller.abort();
			if (bodyReader) {
				void bodyReader.cancel().catch(() => {});
			}
			rejectAbort(new Error('candidate-timeout'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		let timer;
		try {
			const deadline = new Promise((_, reject) => {
				timer = setTimer(() => {
					controller.abort();
					reject(new Error('resource-timeout'));
				}, timeout);
			});
			const reading = (async () => {
				if (signal?.aborted) {
					throw new Error('candidate-timeout');
				}
				const response = await fetch(absolute(url), {
					credentials: 'same-origin',
					cache: 'no-store',
					redirect: 'error',
					signal: controller.signal,
				});
				if (response.status === 401 || response.status === 403) {
					return response;
				}
				if (!response.ok || response.redirected) {
					throw Object.assign(new Error('resource-unavailable'), { status: response.status });
				}
				const reader = response.body?.getReader();
				bodyReader = reader;
				const chunks = [];
				let size = 0;
				if (reader) {
					try {
						while (true) {
							const item = await reader.read();
							if (item.done) {
								break;
							}
							size += item.value.byteLength;
							if (size > maximum || controller.signal.aborted) {
								throw new Error('resource-limit');
							}
							chunks.push(item.value);
						}
					} catch (error) {
						void reader.cancel().catch(() => {});
						throw error;
					} finally {
						reader.releaseLock();
					}
				}
				const bytes = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.length;
				}
				if (controller.signal.aborted) {
					throw new Error('resource-timeout');
				}
				return new Response(bytes, { status: response.status, headers: response.headers });
			})();
			return await Promise.race([reading, deadline, cancelled]);
		} finally {
			if (controller.signal.aborted && bodyReader) {
				void bodyReader.cancel().catch(() => {});
			}
			clearTimer(timer);
			signal?.removeEventListener('abort', abort);
		}
	}
	async function verifyResource(response, resource, tuple) {
		if (
			!response ||
			response.status !== 200 ||
			response.redirected ||
			(response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== resource.mime
		) {
			return false;
		}
		if (['shell', 'recovery'].includes(resource.role) && !protocol.headersMatch(response.headers, tuple, resource.role === 'recovery')) {
			return false;
		}
		if (['shell', 'recovery'].includes(resource.role) && response.headers.get('X-2FA-Shell-Config') !== resource.shellConfigId) {
			return false;
		}
		if (resource.role === 'module' && response.headers.get('X-2FA-Build') !== tuple.hostBuild) {
			return false;
		}
		const bytes = await response.clone().arrayBuffer();
		return bytes.byteLength === resource.size && (await protocol.digest(bytes)) === resource.sha256;
	}
	async function complete(snapshot, { recoveryOnly = false } = {}) {
		if (!snapshot || snapshot.status !== 'complete') {
			return false;
		}
		const state = initialize(await index.read());
		if (state.deleting[snapshot.cacheName]) {
			return false;
		}
		const cache = await caches.open(snapshot.cacheName);
		const seal = await cache.match(marker);
		if (!seal || (await seal.json()).inventoryHash !== snapshot.descriptor.inventoryHash) {
			return false;
		}
		const resources = snapshot.descriptor.resources.filter(
			(resource) =>
				!recoveryOnly ||
				resource.role === 'recovery' ||
				resource.role === 'vendor' ||
				(['manifest', 'icon'].includes(resource.role) && new URL(resource.url, origin).searchParams.get('safeMode') === '1'),
		);
		let position = 0;
		let valid = true;
		// Each slot includes cache lookup, body read and hashing. Drain every
		// started check on failure before callers can remove or replace a cache.
		const checks = await Promise.allSettled(
			Array.from({ length: Math.min(4, resources.length) }, async () => {
				while (valid && position < resources.length) {
					const resource = resources[position++];
					try {
						if (!(await verifyResource(await cache.match(absolute(resource.url)), resource, snapshot.tuple))) {
							valid = false;
						}
					} catch (error) {
						valid = false;
						throw error;
					}
				}
			}),
		);
		const failure = checks.find((item) => item.status === 'rejected');
		if (failure) {
			throw failure.reason;
		}
		return valid;
	}
	async function snapshotFor(tuple, shellConfigId) {
		const state = initialize(await index.read());
		return state.snapshots[state.complete[protocol.tupleKey(tuple) + '@' + shellConfigId]] || null;
	}
	async function status(tuple, { shellConfigId, inventoryHash } = {}) {
		try {
			tuple = protocol.tuple(tuple);
			const snapshot = await snapshotFor(tuple, shellConfigId);
			if (inventoryHash && snapshot?.descriptor.inventoryHash !== inventoryHash) {
				return errorResult('inventory-changed');
			}
			if (!(await complete(snapshot))) {
				return errorResult(snapshot ? 'evicted' : 'not-prepared', { tuple, compatible: true });
			}
			return ready(tuple, { shellConfigId, cacheName: snapshot.cacheName, inventoryHash: snapshot.descriptor.inventoryHash });
		} catch {
			return errorResult('storage-unavailable');
		}
	}
	async function prepare(tuple, clientId = '', { shellConfigId } = {}) {
		try {
			tuple = protocol.tuple(tuple);
		} catch {
			return errorResult('invalid-tuple');
		}
		if (!/^[a-f0-9]{64}$/.test(shellConfigId || '')) {
			return errorResult('reload-required');
		}
		const key = protocol.tupleKey(tuple) + '@' + shellConfigId;
		if (pending.has(key)) {
			return pending.get(key);
		}
		const task = prepareCandidate(tuple, clientId, shellConfigId).catch((error) =>
			errorResult(error.reason || error.message || 'prepare-failed', { tuple }),
		);
		pending.set(key, task);
		void task.finally(() => {
			if (pending.get(key) === task) {
				pending.delete(key);
			}
		});
		return task;
	}
	// Most of a snapshot (modules, vendor scripts, icons) is unchanged by a theme switch.
	// Copies from completed snapshots pass the same checks as a download.
	async function reusableResources() {
		const state = initialize(await index.read());
		const sources = new Map();
		for (const snapshot of Object.values(state.snapshots)) {
			if (state.deleting[snapshot.cacheName] || !(await caches.has(snapshot.cacheName))) {
				continue;
			}
			for (const resource of snapshot.descriptor?.resources || []) {
				if (!sources.has(resource.sha256)) {
					sources.set(resource.sha256, { cacheName: snapshot.cacheName, url: resource.url });
				}
			}
		}
		return sources;
	}
	async function reuseShell(cache, resource, tuple) {
		const recent = ['shell', 'recovery'].includes(resource.role) && recentShells.get(absolute(resource.url));
		if (!recent) {
			return false;
		}
		try {
			const response = recent.clone();
			if (!(await verifyResource(response, resource, tuple))) {
				return false;
			}
			await cache.put(absolute(resource.url), response);
			return true;
		} catch {
			return false;
		}
	}
	async function reuseResource(cache, resource, tuple, sources) {
		const source = sources.get(resource.sha256);
		if (!source) {
			return false;
		}
		try {
			const response = await (await caches.open(source.cacheName)).match(absolute(source.url));
			if (!(await verifyResource(response, resource, tuple))) {
				return false;
			}
			await cache.put(absolute(resource.url), response);
			return true;
		} catch {
			return false;
		}
	}
	async function prepareCandidate(tuple, clientId, shellConfigId) {
		const known = await status(tuple, { shellConfigId });
		if (known.status === 'ready') {
			return known;
		}
		const response = await readResponse(manifestURL(tuple), { maximum: 512 * 1024 });
		if ([401, 403].includes(response.status)) {
			return errorResult('authentication-required', { tuple });
		}
		const descriptor = await protocol.descriptor(await response.json(), tuple);
		if (descriptor.shellConfigId !== shellConfigId) {
			return errorResult('reload-required');
		}
		const tupleKey = protocol.tupleKey(tuple) + '@' + shellConfigId;
		const cacheHash = await protocol.digest(tupleKey);
		const candidate = await index.update((raw) => {
			const state = initialize(raw);
			const generation = ++state.generation;
			const cacheName = prefix + cacheHash + '-' + generation;
			const value = { tuple, tupleKey, generation, cacheName, descriptor, startedAt: now(), status: 'preparing', clientId };
			state.candidates[cacheName] = value;
			state[tuple.mode === 'safe' ? 'recoveryTarget' : 'target'] = { cacheName, generation };
			return value;
		});
		notify({ type: 'status', state: 'preparing', tuple });
		const controller = new AbortController();
		const overall = setTimer(() => controller.abort(), 120000);
		try {
			const cache = await caches.open(candidate.cacheName);
			const reusable = await reusableResources();
			let position = 0;
			const downloads = await Promise.allSettled(
				Array.from({ length: Math.min(8, descriptor.resources.length) }, async () => {
					while (position < descriptor.resources.length) {
						const resource = descriptor.resources[position++];
						if ((await reuseShell(cache, resource, tuple)) || (await reuseResource(cache, resource, tuple, reusable))) {
							continue;
						}
						const response = await readResponse(resource.url, { signal: controller.signal, maximum: resource.size });
						if ([401, 403].includes(response.status)) {
							throw new Error('authentication-required');
						}
						if (!(await verifyResource(response, resource, tuple))) {
							throw new Error('resource-integrity');
						}
						await cache.put(absolute(resource.url), response);
					}
				}),
			);
			const failure = downloads.find((item) => item.status === 'rejected');
			if (failure) {
				throw failure.reason;
			}
			if (controller.signal.aborted) {
				throw new Error('candidate-timeout');
			}
			await cache.put(marker, Response.json({ inventoryHash: descriptor.inventoryHash, tuple, generation: candidate.generation }));
			candidate.status = 'complete';
			if (!(await complete(candidate))) {
				throw new Error('incomplete-cache');
			}
			const confirmation = await readResponse(manifestURL(tuple), { maximum: 512 * 1024, signal: controller.signal });
			if ([401, 403].includes(confirmation.status)) {
				throw new Error('authentication-required');
			}
			const confirmed = await protocol.descriptor(await confirmation.json(), tuple);
			if (confirmed.inventoryHash !== descriptor.inventoryHash) {
				throw new Error('publication-changed');
			}
			const promoted = await index.update((raw) => {
				const state = initialize(raw);
				const target = state[tuple.mode === 'safe' ? 'recoveryTarget' : 'target'];
				if (
					target?.cacheName !== candidate.cacheName ||
					target.generation !== candidate.generation ||
					state.deleting[candidate.cacheName]
				) {
					return false;
				}
				state.snapshots[candidate.cacheName] = candidate;
				state.complete[tupleKey] = candidate.cacheName;
				if (tuple.mode === 'safe') {
					state.recoveryActive = candidate.cacheName;
				} else {
					state.previous = state.active;
					state.active = candidate.cacheName;
				}
				delete state.candidates[candidate.cacheName];
				return true;
			});
			if (!promoted) {
				throw new Error('superseded');
			}
			notify({ type: 'status', state: 'complete', tuple });
			return ready(tuple, { shellConfigId, inventoryHash: descriptor.inventoryHash, cacheName: candidate.cacheName });
		} catch (error) {
			controller.abort();
			await index.update((raw) => {
				const state = initialize(raw);
				delete state.candidates[candidate.cacheName];
				state.deleting[candidate.cacheName] = true;
			});
			await caches
				.delete(candidate.cacheName)
				.then(() =>
					index.update((raw) => {
						const state = initialize(raw);
						delete state.deleting[candidate.cacheName];
						const targetKey = tuple.mode === 'safe' ? 'recoveryTarget' : 'target';
						if (state[targetKey]?.cacheName === candidate.cacheName) {
							state[targetKey] = null;
						}
					}),
				)
				.catch(() => {});
			throw error;
		} finally {
			clearTimer(overall);
		}
	}
	async function attach(
		tuple,
		clientId,
		{ provisional = false, fromFallback = false, shellConfigId, inventoryHash, isCurrent = () => true } = {},
	) {
		if (!clientId) {
			return errorResult('invalid-client');
		}
		try {
			tuple = protocol.tuple(tuple);
			// Claim request order before any resource I/O. A slow earlier attach
			// cannot overwrite a newer committed pin after its client timed out.
			const admission = await index.update((raw) => {
				const state = initialize(raw);
				state.admissions[clientId] = (state.admissions[clientId] || 0) + 1;
				return state.admissions[clientId];
			});
			const snapshot = await snapshotFor(tuple, shellConfigId);
			if (!(await complete(snapshot))) {
				return errorResult(snapshot ? 'evicted' : 'not-prepared', { tuple, compatible: true });
			}
			if (inventoryHash && snapshot.descriptor.inventoryHash !== inventoryHash) {
				return errorResult('inventory-changed');
			}
			const permitId = random();
			const accepted = await index.update((raw) => {
				const state = initialize(raw);
				if (
					!isCurrent() ||
					state.admissions[clientId] !== admission ||
					state.deleting[snapshot.cacheName] ||
					state.complete[snapshot.tupleKey] !== snapshot.cacheName
				) {
					return false;
				}
				// Every new admission during update preparation joins the retained set
				// in the same transaction, before its response can expose a running app.
				if (state.activation && ['preparing', 'activating'].includes(state.activation.phase)) {
					if (!state.activation.allowedApiVersions.includes(tuple.sdkApiVersion)) {
						return false;
					}
					if (!state.activation.requiredCacheNames.includes(snapshot.cacheName)) {
						state.activation.requiredCacheNames.push(snapshot.cacheName);
					}
				}
				state.pins[clientId] = {
					tuple,
					shellConfigId,
					inventoryHash: snapshot.descriptor.inventoryHash,
					tupleKey: snapshot.tupleKey,
					cacheName: snapshot.cacheName,
					permitId,
					fromFallback,
					provisional,
					// A new formal attach may race an older clients.matchAll result,
					// just like a provisional navigation not yet listed by the browser.
					pendingUntil: now() + 30000,
					lastSeen: now(),
				};
				return true;
			});
			return accepted
				? ready(tuple, { shellConfigId, inventoryHash: snapshot.descriptor.inventoryHash, permitId, workerBuild: buildId })
				: errorResult('activation-blocked');
		} catch {
			return errorResult('storage-unavailable');
		}
	}
	async function pinNavigation(request, clientId, response, { isCurrent = () => true } = {}) {
		if (response.status === 200) {
			const url = new URL(request.url);
			url.hash = '';
			recentShells.delete(url.href);
			recentShells.set(url.href, response.clone());
			for (const key of [...recentShells.keys()].slice(0, -2)) {
				recentShells.delete(key);
			}
		}
		if (!clientId || response.status !== 200) {
			return;
		}
		try {
			const safe =
				new URL(request.url).searchParams.get('safeMode') === '1' || new URL(request.url).searchParams.get('disableCustomCode') === '1';
			const tuple = protocol.tuple({
				hostBuild: response.headers.get('X-2FA-Build'),
				sdkApiVersion: Number(response.headers.get('X-2FA-SDK-Api-Version')),
				packageId: response.headers.get('X-2FA-Package-Id') || null,
				appearanceRevision: Number(response.headers.get('X-2FA-Appearance-Revision')),
				mode: safe ? 'safe' : response.headers.get('X-2FA-Runtime-Mode'),
			});
			const result = await attach(tuple, clientId, {
				provisional: true,
				shellConfigId: response.headers.get('X-2FA-Shell-Config'),
				isCurrent,
			});
			if (result.status !== 'ready') {
				await index.update((raw) => {
					const state = initialize(raw);
					if (!isCurrent()) {
						return;
					}
					state.pins[clientId] = { tuple, incomplete: true, pendingUntil: now() + 30000 };
					if (state.activation?.phase === 'preparing') {
						state.activation.phase = 'blocked';
					}
				});
			}
		} catch {
			await index.update((raw) => {
				const state = initialize(raw);
				if (!isCurrent()) {
					return;
				}
				state.pins[clientId] = { legacy: true, pendingUntil: now() + 30000 };
				if (state.activation) {
					state.activation.phase = 'blocked';
				}
			});
		}
	}
	async function matchNavigation(request, clientId = '') {
		const url = new URL(request.url);
		const safe = url.searchParams.get('safeMode') === '1' || url.searchParams.get('disableCustomCode') === '1';
		const state = initialize(await index.read());
		const choices = [...new Set([...(safe ? [state.recoveryActive] : []), state.active, state.startupValidated, state.previous])]
			.map((name) => state.snapshots[name])
			.filter(Boolean);
		for (const snapshot of choices) {
			// A recovery shell needs its full independent dependency set, while
			// unrelated evicted theme files must not disqualify that recovery.
			if (!(await complete(snapshot, { recoveryOnly: safe }).catch(() => false))) {
				continue;
			}
			const resource = snapshot.descriptor.resources.find((item) => item.role === (safe ? 'recovery' : 'shell'));
			if (!resource) {
				continue;
			}
			const response = await (await caches.open(snapshot.cacheName)).match(absolute(resource.url));
			if (!(await verifyResource(response, resource, snapshot.tuple))) {
				continue;
			}
			if (clientId) {
				const accepted = await index.update((raw) => {
					const current = initialize(raw);
					if (current.deleting[snapshot.cacheName]) {
						return false;
					}
					current.pins[clientId] = {
						tuple: safe ? { ...snapshot.tuple, mode: 'safe', packageId: null, appearanceRevision: 0 } : snapshot.tuple,
						shellConfigId: resource.shellConfigId,
						inventoryHash: snapshot.descriptor.inventoryHash,
						tupleKey: snapshot.tupleKey,
						cacheName: snapshot.cacheName,
						fromFallback: true,
						pendingUntil: now() + 30000,
						lastSeen: now(),
						safe,
					};
					if (
						['preparing', 'activating'].includes(current.activation?.phase) &&
						!current.activation.requiredCacheNames.includes(snapshot.cacheName)
					) {
						current.activation.requiredCacheNames.push(snapshot.cacheName);
					}
					return true;
				});
				if (!accepted) {
					continue;
				}
			}
			return response;
		}
		return null;
	}
	async function cachedResource(request, clientId = '') {
		const url = new URL(request.url);
		const state = initialize(await index.read());
		const pin = state.pins[clientId];
		const snapshots = pin?.cacheName ? [state.snapshots[pin.cacheName]] : [];
		// An immutable request from a worker/subresource can lack clientId. Only
		// exact declared build/package URLs are eligible, never mutable icons.
		if (!clientId && /^\/(modules\/|theme-packages\/|theme-assets\/|vendor\/)/.test(url.pathname)) {
			snapshots.push(...Object.values(state.snapshots));
		}
		for (const snapshot of snapshots) {
			if (!snapshot || state.deleting[snapshot.cacheName]) {
				continue;
			}
			const normalized = (value) => {
				const parsed = new URL(value, origin);
				parsed.searchParams.sort();
				return parsed.href;
			};
			let resource = snapshot.descriptor.resources.find((item) => normalized(item.url) === normalized(url.href));
			if (url.pathname === '/manifest.json' || /^\/(icon-|apple-touch-icon)/.test(url.pathname)) {
				const safe = pin?.safe || url.searchParams.get('safeMode') === '1' || url.searchParams.get('disableCustomCode') === '1';
				const revision = safe ? 0 : snapshot.tuple.appearanceRevision;
				const language = url.searchParams.get('lang') || url.searchParams.get('language') || 'en';
				resource = snapshot.descriptor.resources.find((item) => {
					const candidate = new URL(item.url, origin);
					return (
						candidate.pathname === url.pathname &&
						(candidate.searchParams.get('safeMode') === '1') === Boolean(safe) &&
						(url.pathname !== '/manifest.json' ||
							(candidate.searchParams.get('appearance') === String(revision) &&
								candidate.searchParams.get('lang') === language &&
								(safe || !url.searchParams.has('appearance') || url.searchParams.get('appearance') === String(revision))))
					);
				});
			}
			if (!resource || ['shell', 'recovery'].includes(resource.role)) {
				continue;
			}
			const response = await (await caches.open(snapshot.cacheName)).match(absolute(resource.url));
			if (await verifyResource(response, resource, snapshot.tuple)) {
				return { response, snapshot, resource, pin };
			}
		}
		return null;
	}
	async function fetchResource(request, clientId = '') {
		const cached = await cachedResource(request, clientId);
		if (!cached) {
			return null;
		} // Legacy handling or a fresh network read remains with the SW.
		// Public files named by their content (theme packages, assets, vendor scripts) never change
		// and need no login, so the copy verified when the snapshot was prepared is served without
		// a network round trip; each import wave would otherwise wait for one.
		if (cached.resource.access === 'public' && ['package', 'asset', 'vendor'].includes(cached.resource.role)) {
			return cached.response;
		}
		const path = new URL(request.url).pathname;
		const boundMutable = cached.pin?.fromFallback && (path === '/manifest.json' || /^\/(icon-|apple-touch-icon)/.test(path));
		try {
			const response = await readResponse(request.url, { timeout: 1500, maximum: cached.resource.size });
			if ([401, 403].includes(response.status)) {
				return response;
			}
			if (!(await verifyResource(response, cached.resource, cached.snapshot.tuple))) {
				return cached.response;
			}
			return response;
		} catch (error) {
			if (
				error.status &&
				error.status < 500 &&
				error.status !== 409 &&
				!boundMutable &&
				!(error.status === 404 && cached.pin && cached.resource.role === 'package')
			) {
				return new Response('', { status: error.status });
			}
			return cached.response;
		}
	}
	async function recordWorker() {
		await index.update((raw) => {
			const state = initialize(raw);
			if (state.activation?.candidateWorkerBuild === buildId && state.activation.phase === 'activating') {
				state.activation = null;
			}
			state.workerProtocol[buildId] = { protocol: protocol.protocol, transportApiVersion: 1, sdkApiVersions: [1] };
		});
	}
	async function prepareServerRuntime(clientId) {
		const response = await readResponse('/');
		if ([401, 403].includes(response.status)) {
			return errorResult('authentication-required');
		}
		const tuple = protocol.tuple({
			hostBuild: response.headers.get('X-2FA-Build'),
			sdkApiVersion: Number(response.headers.get('X-2FA-SDK-Api-Version')),
			packageId: response.headers.get('X-2FA-Package-Id') || null,
			appearanceRevision: Number(response.headers.get('X-2FA-Appearance-Revision')),
			mode: response.headers.get('X-2FA-Runtime-Mode'),
		});
		if (tuple.hostBuild !== buildId) {
			return errorResult('waiting-worker-outdated');
		}
		return prepare(tuple, clientId, { shellConfigId: response.headers.get('X-2FA-Shell-Config') });
	}
	async function activation({ activeWorkerBuild, candidateWorkerBuild = buildId, skipWaiting }) {
		if (!activeWorkerBuild || activeWorkerBuild === candidateWorkerBuild) {
			return errorResult('natural-activation');
		}
		let state = initialize(await index.read());
		if (state.workerProtocol[activeWorkerBuild]?.protocol !== protocol.protocol) {
			return errorResult('legacy-worker');
		}
		const live = await clients.matchAll({ type: 'window', includeUncontrolled: true });
		if (live.some((client) => !state.pins[client.id]?.cacheName || state.pins[client.id]?.legacy || state.pins[client.id]?.incomplete)) {
			return errorResult('unclassified-client');
		}
		const required = [
			...new Set(
				[state.active, state.previous, state.startupValidated, ...live.map((client) => state.pins[client.id].cacheName)].filter(Boolean),
			),
		];
		if (
			!required.some(
				(name) => state.snapshots[name]?.tuple.hostBuild === candidateWorkerBuild && state.snapshots[name]?.tuple.mode !== 'safe',
			)
		) {
			return errorResult('candidate-not-prepared');
		}
		const epoch = random();
		const admitted = await index.update((raw) => {
			const current = initialize(raw);
			if (['preparing', 'activating'].includes(current.activation?.phase) && current.activation.expiresAt > now()) {
				return false;
			}
			current.activation = {
				candidateWorkerBuild,
				activeWorkerBuild,
				epoch,
				expiresAt: now() + 30000,
				phase: 'preparing',
				requiredCacheNames: required,
				allowedApiVersions: [1],
			};
			return true;
		});
		if (!admitted) {
			return errorResult('update-in-progress');
		}
		const failed = async (reason) => {
			await index.update((raw) => {
				const current = initialize(raw);
				if (current.activation?.epoch === epoch) {
					current.activation.phase = 'blocked';
				}
			});
			return errorResult(reason);
		};
		try {
			for (;;) {
				state = initialize(await index.read());
				const gate = state.activation;
				if (gate?.epoch !== epoch || gate.phase !== 'preparing') {
					return failed('activation-changed');
				}
				if (gate.expiresAt <= now()) {
					return failed('activation-timeout');
				}
				for (const name of gate.requiredCacheNames) {
					if (!(await complete(state.snapshots[name]))) {
						return failed('retained-runtime-incomplete');
					}
				}
				const currentLive = await clients.matchAll({ type: 'window', includeUncontrolled: true });
				const decision = await index.update((raw) => {
					const current = initialize(raw);
					const latest = current.activation;
					if (latest?.epoch !== epoch || latest.phase !== 'preparing') {
						return 'blocked';
					}
					if (latest.expiresAt <= now()) {
						return 'blocked';
					}
					if (
						currentLive.some(
							(client) => !current.pins[client.id]?.cacheName || current.pins[client.id]?.incomplete || current.pins[client.id]?.legacy,
						)
					) {
						latest.phase = 'blocked';
						return 'blocked';
					}
					const names = [
						current.active,
						current.previous,
						current.startupValidated,
						current.recoveryActive,
						...currentLive.map((client) => current.pins[client.id].cacheName),
					].filter(Boolean);
					if (names.some((name) => !latest.requiredCacheNames.includes(name))) {
						latest.requiredCacheNames.push(...names.filter((name) => !latest.requiredCacheNames.includes(name)));
						return 'retry';
					}
					if (
						latest.requiredCacheNames.length !== gate.requiredCacheNames.length ||
						latest.requiredCacheNames.some((name) => current.deleting[name])
					) {
						return 'retry';
					}
					latest.phase = 'activating';
					return 'ready';
				});
				if (decision === 'retry') {
					continue;
				}
				if (decision !== 'ready') {
					return failed('unclassified-client');
				}
				await skipWaiting();
				return { status: 'ready', reason: 'activation-requested', epoch };
			}
		} catch {
			return failed('activation-failed');
		}
	}
	async function markStartup(tuple, clientId, options = {}) {
		const prepared = await status(tuple, options);
		if (prepared.status !== 'ready') {
			return prepared;
		}
		const key = protocol.tupleKey(tuple) + '@' + options.shellConfigId;
		const changed = await index.update((raw) => {
			const state = initialize(raw);
			const pin = state.pins[clientId];
			if (pin?.tupleKey !== key || state.deleting[pin.cacheName]) {
				return false;
			}
			state.startupValidated = pin.cacheName;
			return true;
		});
		return changed ? prepared : errorResult('invalid-pin');
	}
	async function clean() {
		const live = await clients.matchAll({ type: 'window', includeUncontrolled: true });
		const state = initialize(await index.read());
		if (live.some((client) => !state.pins[client.id]?.cacheName || state.pins[client.id].legacy || state.pins[client.id].incomplete)) {
			return { status: 'blocked', reason: 'unclassified-client' };
		}
		const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
		for (const name of names) {
			const removed = await index.update((raw) => {
				const current = initialize(raw);
				const protectedNames = new Set([
					current.active,
					current.recoveryActive,
					current.previous,
					current.startupValidated,
					...Object.keys(current.candidates),
					...(['preparing', 'activating'].includes(current.activation?.phase) && current.activation.expiresAt > now()
						? current.activation.requiredCacheNames
						: []),
				]);
				for (const [id, pin] of Object.entries(current.pins)) {
					if (live.some((client) => client.id === id) || pin.pendingUntil > now()) {
						protectedNames.add(pin.cacheName);
					}
				}
				if (protectedNames.has(name)) {
					return false;
				}
				current.deleting[name] = true;
				for (const [key, value] of Object.entries(current.complete)) {
					if (value === name) {
						delete current.complete[key];
					}
				}
				return true;
			});
			if (!removed) {
				continue;
			}
			await caches.delete(name);
			await index.update((raw) => {
				const current = initialize(raw);
				delete current.snapshots[name];
				delete current.deleting[name];
			});
		}
		return { status: 'ready', reason: 'unreferenced-caches-cleared' };
	}
	return Object.freeze({
		prepare,
		status,
		attach,
		complete,
		pinNavigation,
		matchNavigation,
		fetchResource,
		recordWorker,
		prepareServerRuntime,
		activation,
		markStartup,
		clean,
		getState: () => index.read(),
		canCleanLegacy: async () => {
			const activation = (await index.read()).activation;
			return !['preparing', 'activating'].includes(activation?.phase) || activation.expiresAt <= now();
		},
	});
}
