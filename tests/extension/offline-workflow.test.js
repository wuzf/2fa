import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkInstance,
	startFlow,
	copyAccountCode,
	copyAccountCodes,
	fillAccount,
	fillBoundAccountFromCommand,
	disableOfflineCache,
	importWebOfflineCache,
	getOfflineCacheIcons,
	refreshOfflineAccounts,
	requestSource,
} from '../../extension/src/background/workflow.js';
import {
	cancelOfflineRequests,
	clearOfflineSource,
	importOfflineSource,
	markOfflineSourceDirty,
} from '../../extension/src/background/offline-source.js';
import { getConfigurationGeneration, invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';
import { generateTotpCodes } from '../../extension/src/bridge/api.js';
import { generateTotp } from '../../extension/src/shared/totp.js';
import { SESSION_CLOCK_TRUST_MS } from '../../extension/src/shared/offline-clock.js';
import { createNonce, MESSAGE } from '../../extension/src/shared/protocol.js';
import { rememberBinding } from '../../extension/src/shared/storage.js';
import { invalidateAutomaticFlows, routeAutomaticMessage } from '../../extension/src/background/automatic-workflow.js';

const ORIGIN = 'https://vault.example';
const TARGET = 'https://login.example';
const SEED = 'JBSWY3DPEHPK3PXP';
const ACCOUNT = { id: 'a', name: 'Example', account: 'alice@example.com', type: 'TOTP', digits: 6, secret: SEED };
let local;
let session;
let fetch;
function area(values) {
	return {
		get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })),
		set: vi.fn(async (data) => Object.assign(values, structuredClone(data))),
		remove: vi.fn(async (key) => {
			delete values[key];
		}),
	};
}
beforeEach(async () => {
	invalidateConfigurationGeneration();
	local = {
		settings: { instanceOrigin: ORIGIN },
		offlineInstances: [ORIGIN],
		autofillSites: [{ instanceOrigin: ORIGIN, targetOrigin: TARGET, targetPath: '/' }],
	};
	session = {};
	const tabs = { 1: { id: 1, url: TARGET, active: true }, 2: { id: 2, url: ORIGIN } };
	globalThis.chrome = {
		storage: { local: area(local), session: area(session) },
		permissions: { contains: vi.fn(async () => true) },
		tabs: {
			query: vi.fn(async (query) => (query.active ? [tabs[1]] : [tabs[2]])),
			get: vi.fn(async (id) => tabs[id]),
			sendMessage: vi.fn(async (_id, message) =>
				message.type === 'TARGET_PING'
					? { ok: true, origin: TARGET, targetPath: '/' }
					: { ok: true, status: message.type === 'PREPARE_TARGET' ? 'ready' : 'filled' },
			),
		},
		scripting: { executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'target-doc' }]) },
	};
	await clearOfflineSource();
	fetch = vi.fn(
		async (url) =>
			new Response(
				JSON.stringify(
					new URL(url).pathname === '/api/secrets' ? [ACCOUNT] : { serverTimeMs: Math.floor(Date.now() / 30000) * 30000 + 10000 },
				),
				{ headers: { 'Content-Type': 'application/json' } },
			),
	);
	vi.stubGlobal('fetch', fetch);
});
afterEach(async () => {
	await clearOfflineSource();
	vi.unstubAllGlobals();
	delete globalThis.chrome;
});

it('keeps real background list, copy and fill operations usable with a cached vault and no network', async () => {
	const initial = await checkInstance();
	expect(initial.accountCount).toBe(1);
	expect(JSON.stringify(initial)).not.toContain(SEED);
	expect(JSON.stringify(local.offlineCache)).toContain(SEED);
	fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
	const flow = await startFlow();
	expect(flow).toMatchObject({ authMode: 'offline', offlineStatus: { usingCache: true } });
	expect(JSON.stringify([flow, session])).not.toContain(SEED);
	const codes = await copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts, includeNext: true });
	expect(codes[0].code).toMatch(/^\d{6}$/);
	const next = await startFlow();
	await expect(fillAccount({ nonce: next.nonce, account: next.accounts[0] })).resolves.toMatchObject({ status: 'filled' });
	expect(fetch).not.toHaveBeenCalled();
});

describe.each(['fill', 'single copy', 'batch copy'])('offline %s final snapshot validation', (operation) => {
	function deliver(flow) {
		const request = { nonce: flow.nonce, account: flow.accounts[0] };
		if (operation === 'fill') {
			return fillAccount(request);
		}
		return operation === 'single copy' ? copyAccountCode(request) : copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts });
	}

	it.each([
		['rotation', 'nonce cleanup'],
		['deletion', 'nonce cleanup'],
		['rotation', 'final target check'],
		['deletion', 'final target check'],
	])('rejects account %s during %s after code generation', async (change, stage) => {
		const now = 1800000010000;
		const wallClock = vi.spyOn(Date, 'now').mockReturnValue(now);
		try {
			await importOfflineSource(ORIGIN, { data: [ACCOUNT], timestamp: now, clock: null });
			const flow = await startFlow();
			const replacement = change === 'deletion' ? [] : [{ ...ACCOUNT, secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }];
			const replaceSnapshot = () => importOfflineSource(ORIGIN, { data: replacement, timestamp: now, clock: null });
			if (stage === 'nonce cleanup') {
				const remove = chrome.storage.session.remove.getMockImplementation();
				chrome.storage.session.remove.mockImplementationOnce(async (...args) => {
					await remove(...args);
					await replaceSnapshot();
				});
			} else {
				const send = chrome.tabs.sendMessage.getMockImplementation();
				let targetChecks = 0;
				chrome.tabs.sendMessage.mockImplementation(async (...args) => {
					// Claiming checks the target once before generation. The second
					// ping checks the target after the code has already been produced.
					if (args[1].type === MESSAGE.TARGET_PING && ++targetChecks === 2) {
						await replaceSnapshot();
					}
					return send(...args);
				});
			}
			await expect(deliver(flow)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
			expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
			expect(local.offlineCache.snapshot.data).toEqual(replacement);
			expect(session.pendingFlow).toBeUndefined();
		} finally {
			wallClock.mockRestore();
		}
	});

	it('uses the new secret when rotation completes before generation begins', async () => {
		const now = 1800000010000;
		const wallClock = vi.spyOn(Date, 'now').mockReturnValue(now);
		try {
			await importOfflineSource(ORIGIN, { data: [ACCOUNT], timestamp: now, clock: null });
			const flow = await startFlow();
			const rotated = { ...ACCOUNT, secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
			await importOfflineSource(ORIGIN, { data: [rotated], timestamp: now, clock: null });
			const result = await deliver(flow);
			const actual =
				operation === 'fill'
					? chrome.tabs.sendMessage.mock.calls.find(([, message]) => message.type === MESSAGE.FILL_CODE)[1].code
					: operation === 'single copy'
						? result.code
						: result[0].code;
			expect(actual).toBe(await generateTotp(rotated.secret, now));
			expect(actual).not.toBe(await generateTotp(ACCOUNT.secret, now));
		} finally {
			wallClock.mockRestore();
		}
	});
});

describe.each(['session', 'offline'])('explicit source operations in %s mode', (mode) => {
	it.each([
		['omitted', undefined],
		['null', null],
		['unknown name', 'unknown'],
		['prototype method', 'toString'],
		['constructor', 'constructor'],
		['prototype key', '__proto__'],
		['legacy function reference', generateTotpCodes],
		['object', {}],
	])('rejects %s without any source I/O', async (_label, kind) => {
		local.offlineInstances = mode === 'offline' ? [ORIGIN] : [];
		const configuration = { instanceOrigin: ORIGIN, configurationGeneration: getConfigurationGeneration() };
		await expect(requestSource(configuration, kind, { accounts: [ACCOUNT] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(fetch).not.toHaveBeenCalled();
		expect(local.offlineCache).toBeUndefined();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
	});

	it('lists public accounts and generates both one code and a batch through the selected source', async () => {
		const now = 1800000010000;
		const records = [ACCOUNT, { ...ACCOUNT, id: 'b', name: 'Second', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }];
		local.offlineInstances = mode === 'offline' ? [ORIGIN] : [];
		if (mode === 'offline') {
			await importOfflineSource(ORIGIN, { data: records, timestamp: Date.now() });
			fetch.mockRejectedValue(new Error('Offline operations must stay local'));
		} else {
			fetch.mockImplementation(
				async (url) =>
					new Response(JSON.stringify(new URL(url).pathname === '/api/time' ? { serverTimeMs: now } : records), {
						headers: { 'Content-Type': 'application/json' },
					}),
			);
		}
		const configuration = { instanceOrigin: ORIGIN, configurationGeneration: getConfigurationGeneration() };
		const listed = await requestSource(configuration, 'list', { withDiagnostics: true });
		expect(listed.accounts.map(({ id }) => id)).toEqual(['a', 'b']);
		expect(JSON.stringify(listed)).not.toContain(SEED);
		const clock = { now: () => now, monotonicNow: () => 0, includeNext: true };
		const single = await requestSource(configuration, 'generate', { id: 'a', metadata: listed.accounts[0], ...clock });
		expect(single.code).toBe(await generateTotp(SEED, now));
		expect(single.nextCode).toBe(await generateTotp(SEED, now + 30000));
		const batch = await requestSource(configuration, 'generateMany', { accounts: listed.accounts, ...clock });
		for (const [index, record] of records.entries()) {
			expect(batch[index]).toMatchObject({
				id: record.id,
				code: await generateTotp(record.secret, now),
				nextCode: await generateTotp(record.secret, now + 30000),
			});
		}
		if (mode === 'offline') {
			expect(fetch).not.toHaveBeenCalled();
		} else {
			expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
				'/api/secrets',
				'/api/time',
				'/api/secrets',
				'/api/time',
				'/api/secrets',
			]);
		}
		expect(JSON.stringify([single, batch])).not.toContain(SEED);
	});
});

function deferred() {
	let resolve;
	const promise = new Promise((release) => (resolve = release));
	return { promise, resolve };
}

async function offlineBatch(size = 4) {
	const records = Array.from({ length: size }, (_, index) => ({ ...ACCOUNT, id: `batch-${index}` }));
	await importOfflineSource(ORIGIN, { data: records, timestamp: Date.now() });
	const configuration = { instanceOrigin: ORIGIN, configurationGeneration: getConfigurationGeneration() };
	const accounts = records.map(({ id, name, account, type, digits }) => ({ id, name, account, type, digits }));
	return (options = {}) =>
		requestSource(configuration, 'generateMany', {
			accounts,
			includeNext: true,
			now: () => 1800000010000,
			monotonicNow: () => 0,
			generateImpl: async () => '123456',
			...options,
		});
}

it('shares concurrent configuration checks across a batch without multiplying browser reads per account', async () => {
	const counts = [];
	for (const size of [1, 4, 32]) {
		const generate = await offlineBatch(size);
		chrome.storage.local.get.mockClear();
		chrome.permissions.contains.mockClear();
		const codes = await generate();
		expect(codes).toHaveLength(size);
		expect(codes.every((code) => code.code === '123456' && code.nextCode === '123456')).toBe(true);
		counts.push({ storage: chrome.storage.local.get.mock.calls.length, permission: chrome.permissions.contains.mock.calls.length });
	}
	// These deterministic generators complete together, so each validation phase
	// has the same pending browser read regardless of the number of visible cards.
	expect(counts[1]).toEqual(counts[0]);
	expect(counts[2]).toEqual(counts[0]);
	expect(counts[0].permission).toBeGreaterThan(1);
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	['generation', 'REQUEST_EXPIRED'],
	['instance', 'REQUEST_EXPIRED'],
	['mode', 'REQUEST_EXPIRED'],
	['permission', 'PERMISSION_REQUIRED'],
])('rejects the entire batch when %s changes during its shared post-generation check', async (change, code) => {
	const generate = await offlineBatch();
	const entered = deferred();
	const release = deferred();
	let generated = 0;
	let held = false;
	let permitted = true;
	chrome.permissions.contains.mockImplementation(async () => {
		const allowed = permitted;
		if (generated === 8 && !held) {
			held = true;
			entered.resolve();
			await release.promise;
		}
		return allowed;
	});
	const operation = generate({
		generateImpl: async () => {
			generated += 1;
			return '123456';
		},
	});
	const result = expect(operation).rejects.toMatchObject({ code });
	await entered.promise;
	if (change === 'generation') {
		invalidateConfigurationGeneration();
	}
	if (change === 'instance') {
		local.settings.instanceOrigin = 'https://different.example';
	}
	if (change === 'mode') {
		local.offlineInstances = [];
	}
	if (change === 'permission') {
		permitted = false;
	}
	release.resolve();
	await result;
	expect(generated).toBe(8);
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'FILL_CODE')).toBe(false);
});

it('checks permissions again after a failed batch instead of reusing its rejected validation', async () => {
	const generate = await offlineBatch();
	let generated = 0;
	let failed = false;
	chrome.permissions.contains.mockImplementation(async () => {
		if (generated === 8 && !failed) {
			failed = true;
			throw new Error('Temporary permission query failure');
		}
		return true;
	});
	await expect(
		generate({
			generateImpl: async () => {
				generated += 1;
				return '123456';
			},
		}),
	).rejects.toBeInstanceOf(Error);
	const checked = chrome.permissions.contains.mock.calls.length;
	await expect(generate()).resolves.toHaveLength(4);
	expect(chrome.permissions.contains.mock.calls.length).toBeGreaterThan(checked);
	expect(failed).toBe(true);
});

it('does not share pending validation between separate generation requests using the same configuration', async () => {
	const generate = await offlineBatch();
	const entered = deferred();
	const release = deferred();
	let generated = 0;
	let held = false;
	chrome.permissions.contains.mockImplementation(async () => {
		if (generated === 8 && !held) {
			held = true;
			entered.resolve();
			await release.promise;
		}
		return true;
	});
	const first = generate({
		generateImpl: async () => {
			generated += 1;
			return '123456';
		},
	});
	await entered.promise;
	try {
		// A shared validator outside requestSource would make this second request
		// wait for the first permission response, even though it can be checked now.
		await expect(generate()).resolves.toHaveLength(4);
	} finally {
		release.resolve();
	}
	await expect(first).resolves.toHaveLength(4);
});

async function singleSiteFlow() {
	const target = 'https://github.com';
	local.autofillSites = [{ instanceOrigin: ORIGIN, targetOrigin: target, targetPath: '/' }];
	chrome.tabs.query.mockResolvedValue([{ id: 1, url: target }]);
	chrome.tabs.get.mockResolvedValue({ id: 1, url: target });
	chrome.tabs.sendMessage.mockImplementation(async (_id, message) =>
		message.type === 'TARGET_PING'
			? { ok: true, origin: target, targetPath: '/' }
			: { ok: true, status: message.type === 'PREPARE_TARGET' ? 'ready' : 'filled' },
	);
	const github = { ...ACCOUNT, name: 'GitHub' };
	fetch.mockImplementation(
		async (url) =>
			new Response(
				JSON.stringify(
					new URL(url).pathname === '/api/secrets' ? [github] : { serverTimeMs: Math.floor(Date.now() / 30000) * 30000 + 10000 },
				),
				{ headers: { 'Content-Type': 'application/json' } },
			),
	);
	const flow = await startFlow({ refreshSource: true });
	expect(flow.autoFillAccountId).toBe(github.id);
	return flow;
}

it('keeps shortcut freshness checks on an unapproved path without requiring persistent automatic authorization', async () => {
	await singleSiteFlow();
	local.autofillSites = [];
	let prepared = false;
	let changed = false;
	const original = chrome.tabs.sendMessage.getMockImplementation();
	chrome.tabs.sendMessage.mockImplementation(async (id, message) => {
		if (message.type === 'PREPARE_TARGET') {
			prepared = true;
		}
		if (message.type === 'TARGET_PING' && prepared && !changed) {
			changed = true;
			markOfflineSourceDirty(ORIGIN);
		}
		return original(id, message);
	});
	await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	expect(changed).toBe(true);
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'FILL_CODE')).toBe(false);
});

it('shows cached accounts and previews while online refresh waits, then rejects the stale single-account automatic choice', async () => {
	await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	let release;
	let entered;
	const started = new Promise((resolve) => (entered = resolve));
	const loading = new Promise((resolve) => (release = resolve));
	const originalFetch = fetch.getMockImplementation();
	fetch.mockImplementation(async (...args) => {
		if (new URL(args[0]).pathname !== '/api/secrets') {
			return originalFetch(...args);
		}
		entered();
		await loading;
		const current = local.offlineCache.snapshot.data[0];
		return new Response(JSON.stringify([current, { ...current, id: 'second', account: 'bob@example.com' }]), {
			headers: { 'Content-Type': 'application/json' },
		});
	});
	const refresh = refreshOfflineAccounts(ORIGIN);
	await started;
	const flow = await startFlow({ preferCache: true, refreshSource: true });
	expect(flow).toMatchObject({ sourceRefreshPending: true, autoFillAccountId: null });
	expect(flow.accounts).toHaveLength(1);
	expect(session.pendingFlow).toMatchObject({ nonce: flow.nonce, sourceRefreshPending: true });
	const codes = await copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts, includeNext: true });
	expect(codes[0].code).toMatch(/^\d{6}$/);
	const renewed = await startFlow({ preferCache: true, refreshSource: false });
	expect(renewed).toMatchObject({ sourceRefreshPending: true, autoFillAccountId: null });
	await expect(
		fillAccount({ nonce: renewed.nonce, account: renewed.accounts[0], automatic: true, sourceRefreshPending: false }),
	).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'FILL_CODE')).toBe(false);
	const independent = await startFlow({ preferCache: true });
	release();
	expect(await refresh).toEqual({
		instanceOrigin: ORIGIN,
		available: true,
		cachedAt: expect.any(Number),
		accountCount: 2,
		clockStatus: 'cached',
	});
	// Background refresh must not overwrite an in-progress popup nonce.
	expect(session.pendingFlow.nonce).toBe(independent.nonce);
	const latest = await startFlow({ preferCache: true, refreshSource: false });
	expect(latest.accounts).toHaveLength(2);
	expect(latest.sourceRefreshPending).toBeUndefined();
	expect(latest.autoFillAccountId).toBeNull();
});

it('requires a new flow after an unchanged background refresh before using automatic fill', async () => {
	await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	const cached = await startFlow({ preferCache: true, refreshSource: true });
	expect(cached.sourceRefreshPending).toBe(true);
	const refresh = await refreshOfflineAccounts(ORIGIN);
	expect(refresh).toEqual({
		instanceOrigin: ORIGIN,
		available: true,
		cachedAt: expect.any(Number),
		accountCount: 1,
		clockStatus: 'cached',
	});
	expect(JSON.stringify(refresh)).not.toContain(SEED);
	expect(session.pendingFlow.nonce).toBe(cached.nonce);
	const flow = await startFlow({ preferCache: true, refreshSource: false });
	expect(flow.sourceRefreshPending).toBeUndefined();
	expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).resolves.toMatchObject({ status: 'filled' });
});

it('does not authorize cached automatic fill when a preview renews before background refresh has started', async () => {
	await singleSiteFlow();
	// A restored recent snapshot needs a fresh interactive check, even though its
	// regular five-minute interval has not expired and no change hint was received.
	await importOfflineSource(ORIGIN, local.offlineCache.snapshot);
	fetch.mockClear();
	const cached = await startFlow({ preferCache: true, refreshSource: true });
	expect(cached.sourceRefreshPending).toBe(true);
	await copyAccountCodes({ nonce: cached.nonce, accounts: cached.accounts });
	const renewed = await startFlow({ preferCache: true, refreshSource: false });
	expect(renewed).toMatchObject({ sourceRefreshPending: true, autoFillAccountId: null });
	await expect(fillAccount({ nonce: renewed.nonce, account: renewed.accounts[0], automatic: true })).rejects.toMatchObject({
		code: 'AMBIGUOUS_ACCOUNT',
	});
	expect(fetch).not.toHaveBeenCalled();
});

it('keeps automatic checks enforced by the stored refresh obligation even if auto selection is tampered with', async () => {
	await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	const flow = await startFlow({ preferCache: true, refreshSource: true });
	session.pendingFlow.autoFillAccountId = flow.accounts[0].id;
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).rejects.toMatchObject({
		code: 'REQUEST_EXPIRED',
	});
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'PREPARE_TARGET')).toBe(false);
});

it('rejects an offline account refresh for a different source before making a network request', async () => {
	await expect(refreshOfflineAccounts('https://different.example')).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	expect(fetch).not.toHaveBeenCalled();
});

it('rechecks source configuration after collecting the final background refresh status', async () => {
	await singleSiteFlow();
	const get = chrome.storage.local.get.getMockImplementation();
	chrome.storage.local.get.mockImplementation(async (key) => {
		const value = await get(key);
		if (key === 'offlineCache') {
			local.settings.instanceOrigin = 'https://different.example';
			invalidateConfigurationGeneration();
		}
		return value;
	});
	await expect(refreshOfflineAccounts(ORIGIN)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
});

it('falls back to cached popup operation after a background network failure but clears credentials on authorization failure', async () => {
	await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	fetch.mockRejectedValueOnce(new TypeError('offline'));
	expect(await refreshOfflineAccounts(ORIGIN)).toMatchObject({ available: true, accountCount: 1 });
	const cached = await startFlow({ preferCache: true, refreshSource: true });
	expect(cached.sourceRefreshPending).toBeUndefined();
	expect(cached.autoFillAccountId).toBe(ACCOUNT.id);
	await importOfflineSource(ORIGIN, local.offlineCache.snapshot);
	markOfflineSourceDirty(ORIGIN);
	fetch.mockImplementation(async () => new Response('', { status: 401 }));
	await expect(refreshOfflineAccounts(ORIGIN)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
	expect(local.offlineCache).toBeUndefined();
	await expect(copyAccountCodes({ nonce: cached.nonce, accounts: cached.accounts })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
});

it('rejects an old popup automatic choice after a second matching account is synchronized', async () => {
	const flow = await singleSiteFlow();
	const snapshot = structuredClone(local.offlineCache.snapshot);
	snapshot.data.push({ ...snapshot.data[0], id: 'second', account: 'bob@example.com' });
	await importOfflineSource(ORIGIN, snapshot);
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).rejects.toMatchObject({
		code: 'REQUEST_EXPIRED',
	});
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'FILL_CODE')).toBe(false);
});

it('invalidates the old popup choice as soon as a source change is reported', async () => {
	const flow = await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).rejects.toMatchObject({
		code: 'REQUEST_EXPIRED',
	});
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'PREPARE_TARGET')).toBe(false);
});

it('lets a newly established offline flow use cached data after a change hint', async () => {
	await singleSiteFlow();
	markOfflineSourceDirty(ORIGIN);
	vi.stubGlobal('navigator', { onLine: false });
	fetch.mockClear().mockRejectedValue(new Error('offline'));
	const flow = await startFlow({ refreshSource: true });
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).resolves.toMatchObject({ status: 'filled' });
	expect(fetch).not.toHaveBeenCalled();
});

it.each(['accounts', 'clock'])('rechecks popup source %s after code generation and before dispatch', async (change) => {
	const flow = await singleSiteFlow();
	let prepared = false;
	let changed = false;
	chrome.tabs.sendMessage.mockImplementation(async (_id, message) => {
		if (message.type === 'PREPARE_TARGET') {
			prepared = true;
		}
		if (message.type === 'TARGET_PING' && prepared && !changed) {
			changed = true;
			const snapshot = structuredClone(local.offlineCache.snapshot);
			if (change === 'accounts') {
				snapshot.data.push({ ...snapshot.data[0], id: 'second' });
			} else {
				snapshot.clock = { error: 'CLOCK_CHANGED' };
			}
			await importOfflineSource(ORIGIN, snapshot);
		}
		return message.type === 'TARGET_PING'
			? { ok: true, origin: 'https://github.com', targetPath: '/' }
			: { ok: true, status: message.type === 'PREPARE_TARGET' ? 'ready' : 'filled' };
	});
	await expect(fillAccount({ nonce: flow.nonce, account: flow.accounts[0], automatic: true })).rejects.toMatchObject({
		code: 'REQUEST_EXPIRED',
	});
	expect(changed).toBe(true);
	expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === 'FILL_CODE')).toBe(false);
});

it('clears persisted seeds and disables offline mode so subsequent requests cannot silently refill the cache', async () => {
	await checkInstance();
	await disableOfflineCache();
	expect(local.offlineCache).toBeUndefined();
	expect(local.offlineInstances).not.toContain(ORIGIN);
	fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
	await expect(startFlow()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
	expect(local.offlineCache).toBeUndefined();
});

it('disables and clears local offline data even when instance permission and the network are unavailable', async () => {
	await importOfflineSource(ORIGIN, { data: [ACCOUNT], timestamp: Date.now() });
	session.pendingFlow = { nonce: 'pending' };
	chrome.permissions.contains.mockReset().mockResolvedValue(false);
	fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
	await expect(disableOfflineCache(ORIGIN)).resolves.toEqual({ instanceOrigin: ORIGIN, disabled: true });
	expect(local.offlineCache).toBeUndefined();
	expect(local.offlineInstances).not.toContain(ORIGIN);
	expect(session.pendingFlow).toBeUndefined();
	expect(chrome.permissions.contains).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
});

it('rejects clearing from a settings page for a different instance without changing stored data', async () => {
	await checkInstance();
	const previous = structuredClone(local);
	await expect(disableOfflineCache('https://previous.example')).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	expect(local).toEqual(previous);
});

it('restores offline mode after a failed cache deletion so disabling can be retried', async () => {
	await importOfflineSource(ORIGIN, { data: [ACCOUNT], timestamp: Date.now() });
	const failure = new Error('Local storage unavailable');
	chrome.storage.local.remove.mockRejectedValueOnce(failure);
	await expect(disableOfflineCache(ORIGIN)).rejects.toBe(failure);
	expect(local.offlineInstances).toContain(ORIGIN);
	expect(local.offlineCache.instanceOrigin).toBe(ORIGIN);
	await expect(disableOfflineCache(ORIGIN)).resolves.toEqual({ instanceOrigin: ORIGIN, disabled: true });
	expect(local.offlineCache).toBeUndefined();
	expect(local.offlineInstances).not.toContain(ORIGIN);
	expect(fetch).not.toHaveBeenCalled();
});

it.each(['generation', 'instance'])('rejects local cache disabling when %s changes during its configuration reads', async (change) => {
	await checkInstance();
	const read = chrome.storage.local.get.getMockImplementation();
	chrome.storage.local.get.mockImplementation(async (key) => {
		const result = await read(key);
		if (key === 'offlineInstances') {
			if (change === 'generation') {
				invalidateConfigurationGeneration();
			} else {
				local.settings.instanceOrigin = 'https://next.example';
			}
		}
		return result;
	});
	chrome.storage.local.set.mockClear();
	chrome.storage.local.remove.mockClear();
	await expect(disableOfflineCache(ORIGIN)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	expect(local.offlineInstances).toContain(ORIGIN);
	expect(local.offlineCache.instanceOrigin).toBe(ORIGIN);
	expect(chrome.storage.local.set).not.toHaveBeenCalled();
	expect(chrome.storage.local.remove).not.toHaveBeenCalled();
});

it('cannot repopulate seeds from a new request started while persisted cache deletion is pending', async () => {
	await checkInstance();
	let releaseRemove;
	let enteredRemove;
	const removing = new Promise((resolve) => {
		enteredRemove = resolve;
	});
	const removal = new Promise((resolve) => {
		releaseRemove = resolve;
	});
	chrome.storage.local.remove.mockImplementationOnce(async (key) => {
		enteredRemove();
		await removal;
		delete local[key];
	});
	let releaseNetwork;
	const network = new Promise((resolve) => {
		releaseNetwork = resolve;
	});
	const originalFetch = fetch.getMockImplementation();
	fetch.mockImplementation(async (...args) => {
		await network;
		return originalFetch(...args);
	});
	const clearing = disableOfflineCache();
	await removing;
	const reading = checkInstance();
	releaseRemove();
	await clearing;
	releaseNetwork();
	const [result] = await Promise.allSettled([reading]);
	if (result.status === 'rejected') {
		expect(result.reason.code).toBe('REQUEST_EXPIRED');
	}
	expect(local.offlineInstances).not.toContain(ORIGIN);
	expect(local.offlineCache).toBeUndefined();
});

it('imports only a stable same-document web cache and returns no secret in the response', async () => {
	const cache = JSON.stringify({ data: [ACCOUNT], timestamp: Date.now() });
	chrome.scripting.executeScript
		.mockResolvedValueOnce([{ frameId: 0, documentId: 'source-doc', result: { cache, clock: null } }])
		.mockResolvedValueOnce([{ frameId: 0, documentId: 'source-doc', result: true }]);
	const result = await importWebOfflineCache();
	expect(result).toMatchObject({ accountCount: 1, available: true });
	expect(JSON.stringify(result)).not.toContain(SEED);
	expect(JSON.stringify(local.offlineCache)).toContain(SEED);
	expect(fetch).not.toHaveBeenCalled();
});

it('rejects webpage cache recovery from a settings page for a previous instance before reading tabs', async () => {
	await expect(importWebOfflineCache('https://previous.example')).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	expect(chrome.tabs.query).not.toHaveBeenCalled();
	expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	expect(local.offlineCache).toBeUndefined();
});

it('still requires the instance permission for webpage cache recovery', async () => {
	chrome.permissions.contains.mockResolvedValue(false);
	await expect(importWebOfflineCache(ORIGIN)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
	expect(chrome.tabs.query).not.toHaveBeenCalled();
	expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});

it('imports webpage service icons separately from account metadata without fetching', async () => {
	const icon = 'data:image/png;base64,iVBORw0KGgo=';
	const cache = JSON.stringify({ data: [{ ...ACCOUNT, name: 'GitHub' }], timestamp: Date.now() });
	chrome.scripting.executeScript
		.mockResolvedValueOnce([{ documentId: 'source-doc', result: { cache, clock: null } }])
		.mockResolvedValueOnce([{ documentId: 'source-doc', result: { 'github.com': icon } }])
		.mockResolvedValueOnce([{ documentId: 'source-doc', result: true }]);
	await importWebOfflineCache();
	const flow = await startFlow();
	expect(flow.serviceIcons).toEqual({ 'github.com': icon });
	expect(flow.accounts[0]).not.toHaveProperty('serviceIcons');
	expect(JSON.stringify(flow)).not.toContain(SEED);
	expect(fetch).not.toHaveBeenCalled();
});

it.each([false, 'different-document'])('rejects importing a cache that changes during reading: %s', async (change) => {
	chrome.scripting.executeScript
		.mockResolvedValueOnce([{ documentId: 'source-doc', result: { cache: JSON.stringify({ data: [ACCOUNT], timestamp: Date.now() }) } }])
		.mockResolvedValueOnce([{ documentId: change || 'source-doc', result: change !== false }]);
	await expect(importWebOfflineCache()).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
	expect(local.offlineCache).toBeUndefined();
});

it('never falls back to a saved offline vault after offline mode is disabled', async () => {
	await checkInstance();
	local.offlineInstances = [];
	fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
	await expect(startFlow()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
	expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/secrets']);
	await expect(importWebOfflineCache()).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('reads only sanitized offline icons without network, account metadata, or secrets', async () => {
	await importOfflineSource(
		ORIGIN,
		{ data: [{ ...ACCOUNT, name: 'GitHub' }], timestamp: Date.now() },
		{ serviceIcons: { 'github.com': 'data:image/png;base64,aA==', 'evil.example': 'https://evil.example/icon' } },
	);
	const icons = await getOfflineCacheIcons();
	expect(icons).toEqual({ instanceOrigin: ORIGIN, serviceIcons: { 'github.com': 'data:image/png;base64,aA==' } });
	expect(fetch).not.toHaveBeenCalled();
	expect(JSON.stringify(icons)).not.toContain(SEED);
});
it.each(['session', 'permission', 'instance'])('refuses offline icon reads after %s changes', async (change) => {
	await importOfflineSource(ORIGIN, { data: [ACCOUNT], timestamp: Date.now() });
	if (change === 'session') {
		local.offlineInstances = [];
	}
	if (change === 'permission') {
		chrome.permissions.contains.mockResolvedValue(false);
	}
	if (change === 'instance') {
		local.settings.instanceOrigin = 'https://other.example';
	}
	await expect(getOfflineCacheIcons()).rejects.toBeInstanceOf(Error);
	expect(fetch).not.toHaveBeenCalled();
});

describe('account refresh with an existing server clock correction', () => {
	const TIME = 1_800_000_010_000;
	const OFFSET = 90_000;
	const REMOVED_ACCOUNT = { ...ACCOUNT, id: 'removed', account: 'removed@example.com' };
	let records;
	let secretsResult;
	let timeResult;
	let wallJump;
	const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
	const html = (status, headers = {}) =>
		new Response('<!DOCTYPE html><title>Blocked</title>', { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...headers } });
	// The instance's own login failure body versus 403 pages from rules in front of it.
	const FORBIDDEN_RESPONSES = {
		'service-403': () => json({ error: '身份验证失败', message: '请重新登录', timestamp: new Date(TIME).toISOString() }, 403),
		'challenge-403': () => html(403, { 'cf-mitigated': 'challenge' }),
		'waf-403': () => html(403),
		'access-403': () => new Response('', { status: 403 }),
	};
	function interruptedBody(result) {
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('['));
				},
				pull(controller) {
					controller.error(result === 'body-abort' ? new globalThis.DOMException('Aborted', 'AbortError') : new TypeError('terminated'));
				},
			}),
			{ headers: { 'Content-Type': 'application/json' } },
		);
	}

	beforeEach(() => {
		vi.useFakeTimers({ now: TIME, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		wallJump = 0;
		vi.stubGlobal('performance', { timeOrigin: TIME, now: () => Date.now() - TIME - wallJump });
		records = [ACCOUNT, REMOVED_ACCOUNT];
		secretsResult = 200;
		timeResult = 'healthy';
		fetch.mockImplementation(async (url) => {
			const path = new URL(url).pathname;
			const result = path === '/api/secrets' ? secretsResult : timeResult;
			if (result === 'body-network' || result === 'body-abort') {
				return interruptedBody(result);
			}
			if (Object.hasOwn(FORBIDDEN_RESPONSES, result)) {
				return FORBIDDEN_RESPONSES[result]();
			}
			if (path === '/api/secrets') {
				return secretsResult === 'invalid-json'
					? new Response('{invalid', { headers: { 'Content-Type': 'application/json' } })
					: json(records, secretsResult);
			}
			if (path !== '/api/time') {
				return json({}, 404);
			}
			if (typeof timeResult === 'number') {
				return json({}, timeResult);
			}
			if (typeof timeResult === 'object') {
				return json(timeResult);
			}
			if (timeResult === 'network') {
				throw new TypeError('Offline');
			}
			if (timeResult === 'timeout') {
				return new Promise(() => {});
			}
			if (timeResult === 'invalid') {
				return json({ serverTimeMs: 'invalid' });
			}
			if (timeResult === 'slow') {
				await new Promise((resolve) => setTimeout(resolve, 2500));
			}
			if (timeResult === 'jump') {
				wallJump += 120_000;
				vi.setSystemTime(Date.now() + 120_000);
			}
			return json({ serverTimeMs: Date.now() + OFFSET });
		});
	});

	afterEach(() => vi.useRealTimers());

	async function initialClock() {
		await checkInstance();
		const clock = structuredClone(local.offlineCache.snapshot.clock);
		expect(clock.offsetMs).toBe(OFFSET);
		await vi.advanceTimersByTimeAsync(1001);
		return clock;
	}

	async function expectCode(offset) {
		const flow = await startFlow();
		const codes = await copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts, includeNext: true });
		expect(codes[0].code).toBe(await generateTotp(SEED, Date.now() + offset));
		return flow;
	}

	it.each(['body-network', 'body-abort'])(
		'preserves cached accounts and corrected codes after a secrets body interruption: %s',
		async (result) => {
			await initialClock();
			const cached = structuredClone(local.offlineCache);
			secretsResult = result;
			await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ available: true, accountCount: 2, clockStatus: 'cached' });
			expect(local.offlineCache).toEqual(cached);
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			await expectCode(OFFSET);
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it.each([408, 429, 503, 'network', 'body-network', 'body-abort', 'timeout', 'slow'])(
		'keeps the corrected code and applies account changes when time temporarily fails: %s',
		async (result) => {
			const clock = await initialClock();
			records = [{ ...ACCOUNT, account: 'updated@example.com' }];
			timeResult = result;
			const refresh = refreshOfflineAccounts(ORIGIN);
			if (result === 'timeout' || result === 'slow') {
				await vi.advanceTimersByTimeAsync(result === 'timeout' ? 8000 : 2500);
			}
			await expect(refresh).resolves.toMatchObject({ accountCount: 1 });
			expect(local.offlineCache.snapshot.clock).toEqual(clock);
			expect(local.offlineCache.snapshot.data).toEqual(records);
			const flow = await expectCode(OFFSET);
			expect(flow.offlineStatus.clockStatus).toBe('cached');
			expect(flow.accounts.map(({ id, account }) => ({ id, account }))).toEqual([{ id: 'a', account: 'updated@example.com' }]);
			await expect(generateTotp(SEED, Date.now())).resolves.not.toBe(await generateTotp(SEED, Date.now() + OFFSET));
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			await expectCode(OFFSET);
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it('retains the local-time fallback when there has never been a server correction', async () => {
		timeResult = 503;
		await checkInstance();
		expect(local.offlineCache.snapshot.clock).toBeNull();
		expect((await expectCode(0)).offlineStatus.clockStatus).toBe('local');
	});

	it.each(['malformed', 'stale'])('blocks local generation when the old correction cannot be used: %s', async (state) => {
		const clock = await initialClock();
		const age = 2 * 24 * 60 * 60 * 1000;
		const previousClock =
			state === 'malformed'
				? { version: 2, offsetMs: OFFSET }
				: {
						...clock,
						syncedAtServerMs: clock.syncedAtServerMs - age,
						localWallAtSyncMs: clock.localWallAtSyncMs - age,
						monotonicEpochAtSyncMs: clock.monotonicEpochAtSyncMs - age,
					};
		await importOfflineSource(ORIGIN, { data: records, timestamp: Date.now(), clock: previousClock });
		timeResult = 503;
		await refreshOfflineAccounts(ORIGIN);
		expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_UNAVAILABLE' });
		await expect(expectCode(0)).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
	});

	it.each([
		['detected', 503],
		['persisted', 503],
		['detected', 'invalid'],
		['persisted', 'invalid'],
	])('preserves a clock-jump block through a failed time refresh: %s, %s', async (state, result) => {
		const clock = await initialClock();
		await importOfflineSource(ORIGIN, {
			data: records,
			timestamp: Date.now(),
			clock:
				state === 'persisted' ? { error: 'CLOCK_CHANGED' } : { ...clock, monotonicEpochAtSyncMs: clock.monotonicEpochAtSyncMs - 120_000 },
		});
		records = [ACCOUNT];
		timeResult = result;
		await refreshOfflineAccounts(ORIGIN);
		expect(local.offlineCache.snapshot.data).toEqual(records);
		expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_CHANGED' });
		await expect(expectCode(OFFSET)).rejects.toMatchObject({ code: 'CLOCK_CHANGED' });
	});

	it('does not renew the original correction after consecutive failed time refreshes', async () => {
		const clock = await initialClock();
		timeResult = 503;
		for (const elapsed of [60_000, 60_000]) {
			await vi.advanceTimersByTimeAsync(elapsed);
			await refreshOfflineAccounts(ORIGIN);
			expect(local.offlineCache.snapshot.clock).toEqual(clock);
		}
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
		await refreshOfflineAccounts(ORIGIN);
		expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_UNAVAILABLE' });
		await expect(expectCode(0)).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
	});

	it('does not reuse a correction after a new clock jump during synchronization', async () => {
		await initialClock();
		timeResult = 'jump';
		await refreshOfflineAccounts(ORIGIN);
		expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_CHANGED' });
		await expect(expectCode(OFFSET)).rejects.toMatchObject({ code: 'CLOCK_CHANGED' });
	});

	it.each(['invalid', 0, Math.floor(TIME / 1000), Date.UTC(2000, 0, 1) - 1, Date.UTC(2100, 0, 1)])(
		'keeps updated accounts, blocks invalid server time %s and recovers after valid synchronization',
		async (serverTimeMs) => {
			await initialClock();
			records = [{ ...ACCOUNT, account: 'updated@example.com' }];
			timeResult = { serverTimeMs };
			expect(await refreshOfflineAccounts(ORIGIN)).toMatchObject({ accountCount: 1, available: true, clockStatus: 'unavailable' });
			expect(local.offlineCache.snapshot.data).toEqual(records);
			expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_UNAVAILABLE' });
			const flow = await startFlow();
			expect(flow.offlineStatus.clockStatus).toBe('unavailable');
			expect(flow.accounts).toEqual([expect.objectContaining({ id: ACCOUNT.id, account: 'updated@example.com' })]);
			await expect(copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts })).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
			timeResult = 'healthy';
			await vi.advanceTimersByTimeAsync(1001);
			expect(await refreshOfflineAccounts(ORIGIN)).toMatchObject({ clockStatus: 'cached' });
			expect(local.offlineCache.snapshot.clock.offsetMs).toBe(OFFSET);
			await expectCode(OFFSET);
		},
	);

	it('preserves the calibration block through later failures and recovers after a successful time response', async () => {
		await initialClock();
		for (const result of ['invalid', 503, 'network', 'invalid']) {
			timeResult = result;
			await vi.advanceTimersByTimeAsync(1001);
			await refreshOfflineAccounts(ORIGIN);
			expect(local.offlineCache.snapshot.clock).toEqual({ error: 'CLOCK_UNAVAILABLE' });
			await expect(expectCode(0)).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
		}
		timeResult = 'healthy';
		await vi.advanceTimersByTimeAsync(1001);
		expect(await refreshOfflineAccounts(ORIGIN)).toMatchObject({ clockStatus: 'cached' });
		expect(local.offlineCache.snapshot.clock.offsetMs).toBe(OFFSET);
		await expectCode(OFFSET);
	});

	it('never sends an automatic fill while calibration is unavailable and resumes after recovery', async () => {
		await initialClock();
		records = [ACCOUNT];
		timeResult = 'invalid';
		await refreshOfflineAccounts(ORIGIN);
		await rememberBinding({ instanceOrigin: ORIGIN, targetOrigin: TARGET, accountId: ACCOUNT.id });
		invalidateAutomaticFlows();
		chrome.runtime = { id: 'clock-test-extension' };
		const sender = { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'target-doc', url: TARGET };
		chrome.tabs.sendMessage.mockImplementation(async (_id, message) => ({
			ok: true,
			status: message.type === MESSAGE.AUTO_FILL ? 'filled' : 'ready',
			origin: TARGET,
			targetPath: '/',
		}));
		const automaticAttempt = async () => {
			const episodeNonce = createNonce();
			const flow = await routeAutomaticMessage(
				{ type: MESSAGE.AUTO_DISCOVER, targetPath: '/', episodeNonce, refreshSource: false },
				sender,
			);
			expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
			return routeAutomaticMessage(
				{ type: MESSAGE.AUTO_SELECT, targetPath: '/', episodeNonce, nonce: flow.nonce, accountId: ACCOUNT.id, automatic: true },
				sender,
			);
		};
		await expect(automaticAttempt()).rejects.toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.AUTO_FILL)).toBe(false);
		timeResult = 'healthy';
		await vi.advanceTimersByTimeAsync(1001);
		await refreshOfflineAccounts(ORIGIN);
		await expect(automaticAttempt()).resolves.toEqual({ status: 'filled' });
		const fills = chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === MESSAGE.AUTO_FILL);
		expect(fills).toHaveLength(1);
		expect(fills[0][1].code).toBe(await generateTotp(SEED, Date.now() + OFFSET));
	});

	describe('after the worker restarts or imports a webpage correction', () => {
		// A stopped MV3 worker loses its monotonic clock. Its successor samples a new
		// time origin from the (possibly corrected) wall clock and new module state.
		async function restartWorker(wallStepMs = 0) {
			vi.setSystemTime(Date.now() + wallStepMs);
			const origin = Date.now();
			vi.stubGlobal('performance', { timeOrigin: origin, now: () => Date.now() - origin });
			vi.resetModules();
			return { origin, worker: await import('../../extension/src/background/workflow.js') };
		}
		async function codeFrom(worker, offset) {
			const flow = await worker.startFlow();
			const codes = await worker.copyAccountCodes({ nonce: flow.nonce, accounts: flow.accounts });
			expect(codes[0].code).toBe(await generateTotp(SEED, Date.now() + offset));
			return flow;
		}
		function serveCorrectedDeviceTime() {
			fetch.mockImplementation(async (url) =>
				new URL(url).pathname === '/api/secrets' ? json(records) : json({ serverTimeMs: Date.now() }),
			);
		}
		// Restarting the browser clears storage.session; restarting only the worker keeps it.
		function restartBrowserSession() {
			for (const key of Object.keys(session)) {
				delete session[key];
			}
		}
		const requestedPaths = () => fetch.mock.calls.map(([url]) => new URL(url).pathname);

		it('keeps a correction verified in this browser session after the worker restarts, even offline', async () => {
			const clock = await initialClock();
			expect(session.offlineClockVerification).toMatchObject({
				instanceOrigin: ORIGIN,
				offsetMs: OFFSET,
				syncedAtServerMs: clock.syncedAtServerMs,
			});
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			const stored = structuredClone(local.offlineCache);
			const { worker } = await restartWorker();
			chrome.storage.local.set.mockClear();
			const flow = await codeFrom(worker, OFFSET);
			expect(flow.offlineStatus).toEqual({ cachedAt: expect.any(Number), usingCache: true, clockStatus: 'cached' });
			// The kept correction is anchored to the new worker only; the vault is not rewritten for it.
			expect(chrome.storage.local.set.mock.calls.filter(([value]) => Object.hasOwn(value, 'offlineCache'))).toEqual([]);
			expect(local.offlineCache).toEqual(stored);
			const source = await import('../../extension/src/background/offline-source.js');
			await expect(source.readOfflineStatus(ORIGIN)).resolves.toMatchObject({ clockStatus: 'cached' });
		});

		it('confirms a kept correction with only the time endpoint, without replacing it', async () => {
			await initialClock();
			const verifiedAt = session.offlineClockVerification.verifiedAtWallMs;
			const { worker } = await restartWorker();
			fetch.mockClear();
			const opened = await worker.startFlow({ preferCache: true });
			expect(opened.sourceRefreshPending).toBeUndefined();
			expect(opened.offlineStatus.clockStatus).toBe('cached');
			const kept = structuredClone(local.offlineCache.snapshot.clock);
			await vi.waitFor(() => expect(session.offlineClockVerification.verifiedAtWallMs).toBeGreaterThan(verifiedAt));
			expect(requestedPaths()).toEqual(['/api/time']);
			expect(local.offlineCache.snapshot.clock).toEqual(kept);
			await codeFrom(worker, OFFSET);
			expect(requestedPaths()).toEqual(['/api/time']);
		});

		it('replaces a kept correction in the background after a system time correction while the worker was stopped', async () => {
			await initialClock();
			// NTP corrects the device clock by the old offset while no worker runs. The
			// forward step is invisible to the new worker, so the time endpoint decides.
			serveCorrectedDeviceTime();
			const { origin, worker } = await restartWorker(OFFSET);
			fetch.mockClear();
			await worker.startFlow();
			await vi.waitFor(() => expect(session.offlineClockVerification).toMatchObject({ offsetMs: 0 }));
			expect(local.offlineCache.snapshot.clock).toMatchObject({ offsetMs: 0, monotonicOriginMs: origin });
			expect(requestedPaths()).toEqual(['/api/time']);
			expect((await codeFrom(worker, 0)).offlineStatus.clockStatus).toBe('cached');
		});

		it.each([
			['the system time moved backwards', -OFFSET],
			['the last check is older than the trust window', SESSION_CLOCK_TRUST_MS],
		])('does not keep a session verification after %s', async (_case, wallStepMs) => {
			await initialClock();
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			const { worker } = await restartWorker(wallStepMs);
			expect((await codeFrom(worker, OFFSET)).offlineStatus.clockStatus).toBe('unverified');
		});

		it('verifies a correction from an earlier browser session with only the time endpoint, without a warning flash', async () => {
			await initialClock();
			restartBrowserSession();
			const { origin, worker } = await restartWorker();
			fetch.mockClear();
			const opened = await worker.startFlow({ preferCache: true });
			expect(opened.sourceRefreshPending).toBeUndefined();
			expect(opened.offlineStatus).toMatchObject({ clockStatus: 'unverified', clockVerificationPending: true });
			await expect(worker.refreshOfflineAccounts(ORIGIN, { clockOnly: true })).resolves.toMatchObject({ clockStatus: 'cached' });
			expect(requestedPaths()).toEqual(['/api/time']);
			expect(local.offlineCache.snapshot.clock).toMatchObject({ offsetMs: OFFSET, monotonicOriginMs: origin });
			expect(session.offlineClockVerification).toMatchObject({ instanceOrigin: ORIGIN, offsetMs: OFFSET });
			const reopened = await codeFrom(worker, OFFSET);
			expect(reopened.offlineStatus).toEqual({ cachedAt: expect.any(Number), usingCache: true, clockStatus: 'cached' });
			expect(requestedPaths()).toEqual(['/api/time']);
		});

		it('keeps a restored correction unverified after one failed time check, without a refresh loop', async () => {
			const clock = await initialClock();
			restartBrowserSession();
			const { origin, worker } = await restartWorker();
			timeResult = 503;
			fetch.mockClear();
			const opened = await worker.startFlow({ preferCache: true });
			expect(opened.offlineStatus).toMatchObject({ clockStatus: 'unverified', clockVerificationPending: true });
			await expect(worker.refreshOfflineAccounts(ORIGIN, { clockOnly: true })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
			expect(local.offlineCache.snapshot.clock).toEqual(clock);
			const reopened = await worker.startFlow({ preferCache: true });
			expect(reopened.sourceRefreshPending).toBeUndefined();
			expect(reopened.offlineStatus).toEqual({ cachedAt: expect.any(Number), usingCache: true, clockStatus: 'unverified' });
			// Asking again reports the finished check instead of repeating it.
			await expect(worker.refreshOfflineAccounts(ORIGIN, { clockOnly: true })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
			expect(requestedPaths()).toEqual(['/api/time']);
			await codeFrom(worker, OFFSET);

			// The regular refresh still verifies the correction.
			timeResult = 'healthy';
			await vi.advanceTimersByTimeAsync(1001);
			await expect(worker.refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ clockStatus: 'cached' });
			expect(local.offlineCache.snapshot.clock).toMatchObject({ offsetMs: OFFSET, monotonicOriginMs: origin });
			await codeFrom(worker, OFFSET);
		});

		it('cancels a running time-only check when the offline cache is cleared', async () => {
			await initialClock();
			restartBrowserSession();
			const { worker } = await restartWorker();
			let timeSignal;
			fetch.mockImplementation(async (url, init) => {
				if (new URL(url).pathname === '/api/secrets') {
					return json(records);
				}
				timeSignal = init.signal;
				return new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () => reject(new globalThis.DOMException('Aborted', 'AbortError')));
				});
			});
			fetch.mockClear();
			const opened = await worker.startFlow({ preferCache: true });
			expect(opened.offlineStatus.clockVerificationPending).toBe(true);
			await vi.waitFor(() => expect(timeSignal).toBeDefined());
			// Switching to session mode or turning offline use off clears the cache.
			const source = await import('../../extension/src/background/offline-source.js');
			await source.clearOfflineSource(ORIGIN);
			expect(timeSignal.aborted).toBe(true);
			await vi.advanceTimersByTimeAsync(15_000);
			expect(requestedPaths()).toEqual(['/api/time']);
		});

		it('sends no time request for a synchronization stopped by a configuration change', async () => {
			await initialClock();
			let releaseSecrets;
			fetch.mockImplementation(async (url) => {
				if (new URL(url).pathname === '/api/secrets') {
					await new Promise((resolve) => {
						releaseSecrets = resolve;
					});
					return json(records);
				}
				return json({ serverTimeMs: Date.now() + OFFSET });
			});
			fetch.mockClear();
			const refreshing = refreshOfflineAccounts(ORIGIN);
			refreshing.catch(() => {});
			await vi.waitFor(() => expect(releaseSecrets).toBeDefined());
			// The background calls this as soon as a configuration message arrives.
			cancelOfflineRequests();
			await expect(refreshing).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
			releaseSecrets();
			await vi.advanceTimersByTimeAsync(10_000);
			expect(requestedPaths()).toEqual(['/api/secrets']);
			expect(local.offlineCache.snapshot.clock.offsetMs).toBe(OFFSET);
		});

		it('never starts a time check while the browser reports that it is offline', async () => {
			await initialClock();
			restartBrowserSession();
			const { worker } = await restartWorker();
			vi.stubGlobal('navigator', { onLine: false });
			fetch.mockClear();
			const opened = await worker.startFlow({ preferCache: true });
			expect(opened.offlineStatus).toEqual({ cachedAt: expect.any(Number), usingCache: true, clockStatus: 'unverified' });
			await expect(worker.refreshOfflineAccounts(ORIGIN, { clockOnly: true })).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
			await codeFrom(worker, OFFSET);
			expect(fetch).not.toHaveBeenCalled();
		});

		it('detects a backward system time change smaller than the time since the worker started', async () => {
			await initialClock();
			await vi.advanceTimersByTimeAsync(60_000);
			// Each read renews the last seen time of the session record.
			await expectCode(OFFSET);
			expect(session.offlineClockVerification.lastSeenWallMs).toBe(Date.now());
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			const { worker } = await restartWorker(-30_000);
			expect((await codeFrom(worker, OFFSET)).offlineStatus.clockStatus).toBe('unverified');
		});

		it('spaces the last seen updates of the session record', async () => {
			await initialClock();
			const writes = () =>
				chrome.storage.session.set.mock.calls.filter(([value]) => Object.hasOwn(value, 'offlineClockVerification')).length;
			const before = writes();
			await expectCode(OFFSET);
			expect(writes()).toBe(before);
			await vi.advanceTimersByTimeAsync(5_000);
			await expectCode(OFFSET);
			await expectCode(OFFSET);
			expect(writes()).toBe(before + 1);
		});

		it('forgets the session verification once this worker detects a system time change', async () => {
			await initialClock();
			// The wall clock moves while this worker's monotonic clock does not.
			wallJump += 120_000;
			vi.setSystemTime(Date.now() + 120_000);
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			expect((await startFlow()).offlineStatus.clockStatus).toBe('changed');
			expect(session.offlineClockVerification).toBeUndefined();
			const { worker } = await restartWorker();
			expect((await worker.startFlow()).offlineStatus.clockStatus).toBe('unverified');
		});

		describe('when filling automatically with a correction kept from this browser session', () => {
			let releaseTime;
			let serverOffset;
			const filledCodes = () =>
				chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === MESSAGE.FILL_CODE).map(([, message]) => message.code);
			async function fillAutomatically(worker) {
				const flow = await worker.startFlow();
				expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
				const filling = worker.fillAccount({
					nonce: flow.nonce,
					account: flow.accounts.find(({ id }) => id === ACCOUNT.id),
					automatic: true,
				});
				filling.catch(() => {});
				// Wrapped, so awaiting the flow does not also await the fill.
				return { filling };
			}

			beforeEach(async () => {
				await initialClock();
				await rememberBinding({ instanceOrigin: ORIGIN, targetOrigin: TARGET, accountId: ACCOUNT.id });
				serverOffset = OFFSET;
				releaseTime = null;
				fetch.mockImplementation(async (url) => {
					if (new URL(url).pathname === '/api/secrets') {
						return json(records);
					}
					await new Promise((resolve) => {
						releaseTime = resolve;
					});
					return json({ serverTimeMs: Date.now() + serverOffset });
				});
			});

			it('waits for the time check and fills the confirmed correction', async () => {
				const { worker } = await restartWorker();
				const { filling } = await fillAutomatically(worker);
				await vi.advanceTimersByTimeAsync(500);
				expect(filledCodes()).toEqual([]);
				releaseTime();
				await expect(filling).resolves.toMatchObject({ status: 'filled' });
				expect(filledCodes()).toEqual([await generateTotp(SEED, Date.now() + OFFSET)]);
			});

			it('never fills a correction that the time check replaces', async () => {
				// The device clock was corrected by the old offset while no worker ran.
				serverOffset = 0;
				const { worker } = await restartWorker(OFFSET);
				const { filling } = await fillAutomatically(worker);
				await vi.advanceTimersByTimeAsync(500);
				releaseTime();
				await expect(filling).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
				expect(filledCodes()).toEqual([]);
				// The replacement is close to zero; the request midpoint anchors it.
				const { offsetMs } = local.offlineCache.snapshot.clock;
				expect(Math.abs(offsetMs)).toBeLessThan(1_000);
				await expect((await fillAutomatically(worker)).filling).resolves.toMatchObject({ status: 'filled' });
				expect(filledCodes()).toEqual([await generateTotp(SEED, Date.now() + offsetMs)]);
			});

			it('fills the kept correction after a short wait when the time check does not answer', async () => {
				const { worker } = await restartWorker();
				const { filling } = await fillAutomatically(worker);
				await vi.advanceTimersByTimeAsync(2_900);
				expect(filledCodes()).toEqual([]);
				await vi.advanceTimersByTimeAsync(200);
				await expect(filling).resolves.toMatchObject({ status: 'filled' });
				expect(filledCodes()).toEqual([await generateTotp(SEED, Date.now() + OFFSET)]);
			});

			it('fills at once while the browser is offline, without a time warning', async () => {
				const { worker } = await restartWorker();
				vi.stubGlobal('navigator', { onLine: false });
				const flow = await worker.startFlow();
				expect(flow.offlineStatus.clockStatus).toBe('cached');
				await expect(
					worker.fillAccount({ nonce: flow.nonce, account: flow.accounts.find(({ id }) => id === ACCOUNT.id), automatic: true }),
				).resolves.toMatchObject({ status: 'filled' });
				expect(filledCodes()).toEqual([await generateTotp(SEED, Date.now() + OFFSET)]);
				expect(releaseTime).toBeNull();
			});

			it('lets automatic filling started by the page wait for the time check as well', async () => {
				await restartWorker();
				const automatic = await import('../../extension/src/background/automatic-workflow.js');
				chrome.runtime = { id: 'clock-test-extension' };
				const sender = { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'target-doc', url: TARGET };
				chrome.tabs.sendMessage.mockImplementation(async (_id, message) => ({
					ok: true,
					status: message.type === MESSAGE.AUTO_FILL ? 'filled' : 'ready',
					origin: TARGET,
					targetPath: '/',
				}));
				const autoFills = () =>
					chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === MESSAGE.AUTO_FILL).map(([, message]) => message.code);
				const episodeNonce = createNonce();
				const flow = await automatic.routeAutomaticMessage(
					{ type: MESSAGE.AUTO_DISCOVER, targetPath: '/', episodeNonce, refreshSource: false },
					sender,
				);
				expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
				const filling = automatic.routeAutomaticMessage(
					{ type: MESSAGE.AUTO_SELECT, targetPath: '/', episodeNonce, nonce: flow.nonce, accountId: ACCOUNT.id, automatic: true },
					sender,
				);
				filling.catch(() => {});
				await vi.advanceTimersByTimeAsync(500);
				expect(autoFills()).toEqual([]);
				releaseTime();
				await expect(filling).resolves.toEqual({ status: 'filled' });
				expect(autoFills()).toEqual([await generateTotp(SEED, Date.now() + OFFSET)]);
			});

			it('does not wait when the user chooses the account', async () => {
				const { worker } = await restartWorker();
				const flow = await worker.startFlow();
				await expect(
					worker.fillAccount({ nonce: flow.nonce, account: flow.accounts.find(({ id }) => id === ACCOUNT.id) }),
				).resolves.toMatchObject({ status: 'filled' });
				expect(filledCodes()).toEqual([await generateTotp(SEED, Date.now() + OFFSET)]);
			});
		});

		it('uses a webpage correction whose tab clock drifted by seconds, as the webpage does', async () => {
			const webClock = {
				version: 2,
				offsetMs: OFFSET,
				syncedAtServerMs: Date.now() - 60_000 + OFFSET,
				rttMs: 20,
				localWallAtSyncMs: Date.now() - 60_000,
				// The long-lived tab's monotonic epoch drifted 5 s from Date.now.
				monotonicEpochAtSyncMs: Date.now() - 65_000,
				// A webpage value can never claim this worker's monotonic origin.
				monotonicOriginMs: performance.timeOrigin,
			};
			chrome.scripting.executeScript
				.mockResolvedValueOnce([
					{
						documentId: 'source-doc',
						result: { cache: JSON.stringify({ data: [ACCOUNT], timestamp: Date.now() }), clock: JSON.stringify(webClock) },
					},
				])
				.mockResolvedValueOnce([{ documentId: 'source-doc', result: true }]);
			await expect(importWebOfflineCache()).resolves.toMatchObject({ available: true, clockStatus: 'unverified' });
			expect(local.offlineCache.snapshot.clock).not.toHaveProperty('monotonicOriginMs');
			fetch.mockClear().mockRejectedValue(new TypeError('Offline'));
			expect((await expectCode(OFFSET)).offlineStatus.clockStatus).toBe('unverified');
		});

		it('verifies an imported webpage correction with only the time endpoint once online', async () => {
			const webClock = {
				version: 2,
				offsetMs: OFFSET,
				syncedAtServerMs: Date.now() - 60_000 + OFFSET,
				rttMs: 20,
				localWallAtSyncMs: Date.now() - 60_000,
				monotonicEpochAtSyncMs: Date.now() - 60_000,
			};
			chrome.scripting.executeScript
				.mockResolvedValueOnce([
					{
						documentId: 'source-doc',
						result: { cache: JSON.stringify({ data: [ACCOUNT], timestamp: Date.now() }), clock: JSON.stringify(webClock) },
					},
				])
				.mockResolvedValueOnce([{ documentId: 'source-doc', result: true }]);
			await expect(importWebOfflineCache()).resolves.toMatchObject({ available: true, clockStatus: 'unverified' });
			fetch.mockClear();
			const opened = await startFlow({ preferCache: true });
			expect(opened.sourceRefreshPending).toBeUndefined();
			expect(opened.offlineStatus).toMatchObject({ clockStatus: 'unverified', clockVerificationPending: true });
			await expect(refreshOfflineAccounts(ORIGIN, { clockOnly: true })).resolves.toMatchObject({ clockStatus: 'cached' });
			expect(requestedPaths()).toEqual(['/api/time']);
			expect(local.offlineCache.snapshot.data).toEqual([ACCOUNT]);
			expect((await expectCode(OFFSET)).offlineStatus.clockStatus).toBe('cached');
		});
	});

	it('recovers from a previous clock-jump block after successful server synchronization', async () => {
		await importOfflineSource(ORIGIN, { data: records, timestamp: Date.now(), clock: { error: 'CLOCK_CHANGED' } });
		await refreshOfflineAccounts(ORIGIN);
		expect(local.offlineCache.snapshot.clock.offsetMs).toBe(OFFSET);
		expect((await expectCode(OFFSET)).offlineStatus.clockStatus).toBe('cached');
	});

	it.each([401, 'service-403'])('still clears cached accounts and correction when time rejects authentication: %s', async (status) => {
		await initialClock();
		timeResult = status;
		await expect(refreshOfflineAccounts(ORIGIN)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
		expect(local.offlineCache).toBeUndefined();
	});

	it.each(['challenge-403', 'waf-403', 'access-403'])(
		'keeps the offline copy when a rule in front of the instance answers secrets with %s',
		async (result) => {
			await initialClock();
			const cached = structuredClone(local.offlineCache);
			secretsResult = result;
			await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ available: true, accountCount: 2, clockStatus: 'cached' });
			expect(local.offlineCache).toEqual(cached);
			await expectCode(OFFSET);
			await expect(checkInstance()).resolves.toMatchObject({ accountCount: 2, offlineStatus: { usingCache: true } });
		},
	);

	it.each(['challenge-403', 'waf-403', 'access-403'])(
		'applies account changes and keeps the correction when only time is answered with %s',
		async (result) => {
			const clock = await initialClock();
			records = [ACCOUNT];
			timeResult = result;
			await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ accountCount: 1, clockStatus: 'cached' });
			expect(local.offlineCache.snapshot.data).toEqual(records);
			expect(local.offlineCache.snapshot.clock).toEqual(clock);
			await expectCode(OFFSET);
		},
	);

	it.each([408, 429])('keeps cached accounts usable through a temporary secrets %s and retries recovery after backoff', async (status) => {
		await initialClock();
		const cached = structuredClone(local.offlineCache);
		secretsResult = status;
		fetch.mockClear();
		await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ accountCount: 2 });
		expect(local.offlineCache).toEqual(cached);
		expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/secrets']);

		fetch.mockClear();
		await expectCode(OFFSET);
		await vi.advanceTimersByTimeAsync(29_000);
		await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ accountCount: 2 });
		expect(fetch).not.toHaveBeenCalled();

		vi.stubGlobal('navigator', { onLine: false });
		await vi.advanceTimersByTimeAsync(1001);
		await expectCode(OFFSET);
		await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ accountCount: 2 });
		expect(fetch).not.toHaveBeenCalled();
		expect(local.offlineCache).toEqual(cached);

		vi.stubGlobal('navigator', { onLine: true });
		secretsResult = 200;
		records = [{ ...ACCOUNT, account: 'recovered@example.com' }];
		await expect(refreshOfflineAccounts(ORIGIN)).resolves.toMatchObject({ accountCount: 1 });
		expect(local.offlineCache.snapshot.data).toEqual(records);
		expect((await expectCode(OFFSET)).accounts[0].account).toBe('recovered@example.com');
	});

	it.each([408, 429])('reports a temporary secrets %s without cache and retries after the existing backoff', async (status) => {
		secretsResult = status;
		await expect(checkInstance()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(local.offlineCache).toBeUndefined();
		fetch.mockClear();
		await expect(checkInstance()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(30_000);
		secretsResult = 200;
		await expect(checkInstance()).resolves.toMatchObject({ accountCount: 2 });
		await expectCode(OFFSET);
	});

	it.each([
		[401, 'AUTH_REQUIRED'],
		['service-403', 'AUTH_REQUIRED'],
		[404, 'INVALID_RESPONSE'],
		['invalid-json', 'INVALID_RESPONSE'],
	])('does not reuse cached accounts for a non-retryable secrets response: %s', async (status, code) => {
		await initialClock();
		secretsResult = status;
		await expect(refreshOfflineAccounts(ORIGIN)).rejects.toMatchObject({ code });
		expect(local.offlineCache).toBeUndefined();
	});
});
