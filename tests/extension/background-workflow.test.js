import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BridgeError, generateTotpCode, generateTotpCodes, listTotpAccounts } from '../../extension/src/bridge/api.js';

vi.mock('../../extension/src/bridge/api.js', async (importOriginal) => ({
	...(await importOriginal()),
	generateTotpCode: vi.fn(),
	generateTotpCodes: vi.fn(),
	listTotpAccounts: vi.fn(),
}));

import { autofillPathFromUrl } from '../../extension/src/shared/origin.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';
import {
	ExtensionError,
	checkInstance,
	copyAccountCode,
	copyAccountCodes,
	fillAccount,
	fillBoundAccountFromCommand,
	openInstance,
	startFlow,
	getAutofillContext,
} from '../../extension/src/background/workflow.js';
import { invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';

const INSTANCE_ORIGIN = 'https://twofa.example';
const TARGET_ORIGIN = 'https://login.example';
const ACCOUNT = Object.freeze({
	id: 'account-id',
	name: 'Example',
	account: 'user@example.com',
	type: 'TOTP',
	digits: 6,
});
const SECOND_ACCOUNT = Object.freeze({ ...ACCOUNT, id: 'second-account', account: 'second@example.com' });

function bindingFor(accountId, targetOrigin = TARGET_ORIGIN) {
	return { instanceOrigin: INSTANCE_ORIGIN, targetOrigin, accountId };
}

function createStorageArea(initial = {}) {
	const values = structuredClone(initial);
	return {
		values,
		get: vi.fn(async (key) => {
			if (key === null) {
				return structuredClone(values);
			}
			if (typeof key === 'string') {
				return { [key]: structuredClone(values[key]) };
			}
			return {};
		}),
		set: vi.fn(async (entries) => Object.assign(values, structuredClone(entries))),
		remove: vi.fn(async (key) => {
			delete values[key];
		}),
		setAccessLevel: vi.fn(async () => undefined),
	};
}

function installChromeMock({ targetOnSecondGet = null, accounts = [ACCOUNT], generatedData = null } = {}) {
	const local = createStorageArea({
		settings: { instanceOrigin: INSTANCE_ORIGIN },
		autofillSites: [{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: TARGET_ORIGIN, targetPath: '/challenge' }],
	});
	const session = createStorageArea();
	const targetTab = { id: 10, url: `${TARGET_ORIGIN}/challenge`, active: true, incognito: false, discarded: false };
	const sourceTab = { id: 20, windowId: 2, url: `${INSTANCE_ORIGIN}/`, incognito: false, discarded: false };
	let targetGetCount = 0;
	listTotpAccounts.mockReset().mockResolvedValue(accounts);
	generateTotpCode.mockReset().mockImplementation(async ({ includeNext }) => ({
		generatedAt: Date.now(),
		...(generatedData ?? {
			code: '012345',
			digits: 6,
			period: 30,
			remainingMs: 30000,
			...(includeNext ? { nextCode: '654321' } : {}),
		}),
	}));

	globalThis.chrome = {
		storage: { local, session },
		permissions: {
			contains: vi.fn(async () => true),
		},
		tabs: {
			query: vi.fn(async (query) => (query.active ? [targetTab] : [sourceTab])),
			create: vi.fn(),
			update: vi.fn(async (id, changes) => ({ ...sourceTab, id, ...changes })),
			get: vi.fn(async (id) => {
				if (id === sourceTab.id) {
					return { ...sourceTab };
				}
				targetGetCount += 1;
				return targetGetCount >= 3 && targetOnSecondGet ? targetOnSecondGet : targetTab;
			}),
			sendMessage: vi.fn(async (_tabId, message) => {
				switch (message.type) {
					case MESSAGE.TARGET_PING:
						return { ok: true, origin: TARGET_ORIGIN, targetPath: autofillPathFromUrl(targetTab.url) };
					case MESSAGE.PREPARE_TARGET:
						return { ok: true, status: 'ready', kind: 'single', digits: 6 };
					case MESSAGE.FILL_CODE:
						return { ok: true, status: 'filled', kind: 'single', digits: 6 };
					default:
						throw new Error(`Unexpected message: ${message.type}`);
				}
			}),
		},
		windows: {
			get: vi.fn(async (id) => ({ id, state: 'normal' })),
			update: vi.fn(async () => undefined),
		},
		scripting: {
			executeScript: vi.fn(async ({ target }) => [
				{
					frameId: 0,
					documentId: `target-document-${target.tabId}`,
				},
			]),
		},
	};

	return { local, session, targetTab, sourceTab };
}

beforeEach(() => {
	vi.restoreAllMocks();
	delete globalThis.chrome;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete globalThis.chrome;
});

function expectNoSourcePageChanges() {
	expect(chrome.tabs.create).not.toHaveBeenCalled();
	expect(chrome.tabs.update).not.toHaveBeenCalled();
	expect(chrome.windows.update).not.toHaveBeenCalled();
}

describe('passive source access', () => {
	it('reads target authorization without source permission, accounts, or replacing a pending fill', async () => {
		const { local, session } = installChromeMock();
		const pending = { nonce: 'existing-fill' };
		session.values.pendingFlow = pending;
		chrome.permissions.contains.mockResolvedValue(false);
		listTotpAccounts.mockRejectedValue(new BridgeError('AUTH_REQUIRED'));
		await expect(getAutofillContext()).resolves.toMatchObject({
			instanceOrigin: INSTANCE_ORIGIN,
			authMode: 'session',
			canFill: true,
			targetOrigin: TARGET_ORIGIN,
			targetPath: '/challenge',
			targetTabId: 10,
			targetDocumentId: 'target-document-10',
			sites: local.values.autofillSites,
		});
		expect(listTotpAccounts).not.toHaveBeenCalled();
		expect(generateTotpCode).not.toHaveBeenCalled();
		expect(session.values.pendingFlow).toEqual(pending);
		expectNoSourcePageChanges();
	});
	it('rejects authorization context when configuration changes during target inspection', async () => {
		installChromeMock();
		const original = chrome.tabs.sendMessage.getMockImplementation();
		chrome.tabs.sendMessage.mockImplementation(async (...args) => {
			invalidateConfigurationGeneration();
			return original(...args);
		});
		await expect(getAutofillContext()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('rejects authorization context when the target navigates during inspection', async () => {
		installChromeMock();
		chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET_ORIGIN}/other` });
		await expect(getAutofillContext()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('still awaits the direct online API in session mode even when the popup prefers cached display', async () => {
		const { local } = installChromeMock();
		let release;
		const response = new Promise((resolve) => (release = resolve));
		listTotpAccounts.mockReturnValueOnce(response);
		const finished = vi.fn();
		const reading = startFlow({ preferCache: true, refreshSource: true }).then(finished);
		await vi.waitFor(() => expect(listTotpAccounts).toHaveBeenCalledOnce());
		expect(finished).not.toHaveBeenCalled();
		release([ACCOUNT]);
		await reading;
		expect(finished.mock.calls[0][0]).toMatchObject({ authMode: 'session', accounts: [ACCOUNT] });
		expect(local.values.offlineCache).toBeUndefined();
	});

	it.each([
		['popup startup', startFlow],
		['connection check', checkInstance],
		['keyboard shortcut', fillBoundAccountFromCommand],
	])('%s works without any open source page', async (_description, operation) => {
		const { targetTab, local } = installChromeMock();
		local.values.bindings = [bindingFor(ACCOUNT.id)];
		chrome.tabs.query.mockImplementation(async (query) => (query.active ? [targetTab] : []));
		await expect(operation()).resolves.toBeDefined();
		expectNoSourcePageChanges();
		expect(chrome.tabs.query.mock.calls.every(([query]) => query.active === true)).toBe(true);
		expect(chrome.scripting.executeScript.mock.calls.every(([args]) => args.files[0] === 'content.js')).toBe(true);
	});

	it.each(['discarded', 'frozen'])('does not depend on or wake a %s source page', async (state) => {
		const { sourceTab } = installChromeMock();
		sourceTab[state] = true;
		await expect(startFlow()).resolves.toBeDefined();
		await expect(checkInstance()).resolves.toMatchObject({ accountCount: 1 });
		expectNoSourcePageChanges();
	});

	it('reports an expired login without opening or focusing a page', async () => {
		installChromeMock();
		listTotpAccounts.mockRejectedValue(new BridgeError('AUTH_REQUIRED'));
		await expect(checkInstance()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
		expectNoSourcePageChanges();
	});

	it('reports a connection failure without trying to open a replacement page', async () => {
		installChromeMock();
		listTotpAccounts.mockRejectedValue(new BridgeError('SOURCE_OFFLINE'));
		await expect(checkInstance()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expectNoSourcePageChanges();
	});

	it('connection checks do not query or inject any page', async () => {
		installChromeMock();
		chrome.tabs.query.mockRejectedValue(new Error('Source query must not be needed'));
		chrome.scripting.executeScript.mockRejectedValue(new Error('Source injection must not be needed'));
		await expect(checkInstance()).resolves.toMatchObject({ accountCount: 1 });
		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		expect(listTotpAccounts).toHaveBeenCalledExactlyOnceWith({
			instanceOrigin: INSTANCE_ORIGIN,
			signal: expect.any(AbortSignal),
			withDiagnostics: true,
			refresh: true,
		});
		expectNoSourcePageChanges();
	});

	it.each(['missing', 'discarded', 'frozen'])('preview refresh still works with a %s source page', async (state) => {
		const { sourceTab, targetTab } = installChromeMock();
		const flow = await startFlow();
		if (state === 'missing') {
			chrome.tabs.query.mockImplementation(async (query) => (query.active ? [targetTab] : []));
		} else {
			sourceTab[state] = true;
		}
		await expect(copyAccountCode({ nonce: flow.nonce, account: ACCOUNT, includeNext: true })).resolves.toMatchObject({
			code: '012345',
			nextCode: '654321',
		});
		expectNoSourcePageChanges();
	});
});

describe('direct source requests and configuration races', () => {
	async function useRealSourceApi({ status = 200 } = {}) {
		const actualApi = await vi.importActual('../../extension/src/bridge/api.js');
		listTotpAccounts.mockImplementation(actualApi.listTotpAccounts);
		generateTotpCode.mockImplementation(actualApi.generateTotpCode);
		const secret = { ...ACCOUNT, secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA1', period: 30 };
		const fetchMock = vi.fn(
			async (url) =>
				new Response(JSON.stringify(url.pathname === '/api/time' ? { serverTimeMs: Math.floor(Date.now() / 30000) * 30000 } : [secret]), {
					status,
					headers: { 'content-type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', fetchMock);
		return { fetchMock, secret };
	}

	it('lists and generates with a closed source page without storing seeds or sending them to the target', async () => {
		const { targetTab, local, session } = installChromeMock();
		chrome.tabs.query.mockImplementation(async (query) => (query.active ? [targetTab] : []));
		const { fetchMock, secret } = await useRealSourceApi();
		const flow = await startFlow();
		const preview = await copyAccountCode({ nonce: flow.nonce, account: flow.accounts[0], includeNext: true });
		expect(preview).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), nextCode: expect.stringMatching(/^\d{6}$/) });
		const nextFlow = await startFlow();
		await expect(fillAccount({ nonce: nextFlow.nonce, account: nextFlow.accounts[0] })).resolves.toMatchObject({ status: 'filled' });
		for (const [url, options] of fetchMock.mock.calls) {
			expect(url.origin).toBe(INSTANCE_ORIGIN);
			expect(['/api/time', '/api/secrets']).toContain(url.pathname);
			expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' });
			expect(options).not.toHaveProperty('headers');
		}
		expect(chrome).not.toHaveProperty('cookies');
		expect(chrome.permissions.contains.mock.calls.every(([request]) => Object.keys(request).join() === 'origins')).toBe(true);
		const persistedAndDelivered = JSON.stringify([
			local.values,
			session.values,
			local.set.mock.calls,
			session.set.mock.calls,
			chrome.tabs.sendMessage.mock.calls,
			flow,
			preview,
		]);
		expect(persistedAndDelivered).not.toContain(secret.secret);
		expect(chrome.tabs.sendMessage.mock.calls.every(([tabId]) => tabId === targetTab.id)).toBe(true);
		expect(chrome.tabs.query.mock.calls.every(([query]) => query.active)).toBe(true);
		expectNoSourcePageChanges();
	});

	it('maps an HTTP 401 to login-required without creating a source tab', async () => {
		installChromeMock();
		const { fetchMock } = await useRealSourceApi({ status: 401 });
		await expect(checkInstance()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(chrome.tabs.query).not.toHaveBeenCalled();
		expectNoSourcePageChanges();
	});

	it.each([
		['a managed challenge', { 'content-type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' }],
		['a region block', { 'content-type': 'text/html' }],
	])('reports %s 403 in front of the instance as unreachable instead of an expired login', async (_description, headers) => {
		installChromeMock();
		await useRealSourceApi();
		const fetchMock = vi.fn(async () => new Response('<!DOCTYPE html><title>Blocked</title>', { status: 403, headers }));
		vi.stubGlobal('fetch', fetchMock);
		await expect(checkInstance()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		await expect(startFlow()).rejects.toMatchObject({ code: 'SOURCE_OFFLINE' });
		expect(chrome.tabs.query.mock.calls.every(([query]) => query.active)).toBe(true);
		expectNoSourcePageChanges();
	});

	it.each([
		['start', startFlow],
		['check', checkInstance],
	])('rejects %s metadata after permission revocation', async (_description, operation) => {
		installChromeMock();
		listTotpAccounts.mockImplementation(async () => {
			chrome.permissions.contains.mockResolvedValue(false);
			return [ACCOUNT];
		});
		await expect(operation()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expectNoSourcePageChanges();
	});

	it.each([
		['start', startFlow],
		['check', checkInstance],
	])('rejects %s metadata after a configuration round trip to the same origin', async (_description, operation) => {
		installChromeMock();
		listTotpAccounts.mockImplementation(async () => {
			invalidateConfigurationGeneration();
			return [ACCOUNT];
		});
		await expect(operation()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it.each(['fill', 'copy'])('drops a %s code after the configuration generation changes without an origin change', async (operation) => {
		installChromeMock();
		const flow = await startFlow();
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			invalidateConfigurationGeneration();
			return originalGenerate(...args);
		});
		await expect((operation === 'fill' ? fillAccount : copyAccountCode)({ nonce: flow.nonce, account: ACCOUNT })).rejects.toMatchObject({
			code: 'REQUEST_EXPIRED',
		});
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it('does not start any source request when instance permission is already missing', async () => {
		installChromeMock();
		chrome.permissions.contains.mockResolvedValue(false);
		await expect(checkInstance()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
		expect(generateTotpCode).not.toHaveBeenCalled();
	});

	it('aborts a stalled source operation at the 25-second workflow limit', async () => {
		vi.useFakeTimers();
		installChromeMock();
		listTotpAccounts.mockImplementation(() => new Promise(() => {}));
		const pending = checkInstance();
		const rejection = expect(pending).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
		await vi.advanceTimersByTimeAsync(25000);
		await rejection;
		expect(listTotpAccounts.mock.calls[0][0].signal.aborted).toBe(true);
		expectNoSourcePageChanges();
	});
});

describe('explicit source recovery', () => {
	it.each(['ready', 'discarded', 'frozen'])('reuses a %s source in its own window', async (state) => {
		const { sourceTab } = installChromeMock();
		if (state !== 'ready') {
			sourceTab[state] = true;
		}
		await expect(openInstance()).resolves.toEqual({ status: 'activated', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(20, { active: true });
		expect(chrome.windows.update).toHaveBeenCalledExactlyOnceWith(2, { focused: true });
		expect(chrome.tabs.create).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('restores a minimized source window when explicitly opening it', async () => {
		installChromeMock();
		chrome.windows.get.mockResolvedValue({ id: 2, state: 'minimized' });
		await openInstance();
		expect(chrome.windows.update).toHaveBeenCalledExactlyOnceWith(2, { focused: true, state: 'normal' });
	});

	it.each(['namespace', 'get', 'update'])('activates an existing source when the windows %s API is absent', async (missing) => {
		installChromeMock();
		const windowApi = chrome.windows;
		const getWindow = windowApi.get;
		const updateWindow = windowApi.update;
		if (missing === 'namespace') {
			delete chrome.windows;
		} else {
			delete windowApi[missing];
		}
		await expect(openInstance()).resolves.toEqual({ status: 'activated', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(20, { active: true });
		expect(getWindow).not.toHaveBeenCalled();
		expect(updateWindow).not.toHaveBeenCalled();
		expect(chrome.tabs.create).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it.each(['removed', 'navigated', 'navigating'])('rechecks a mobile source that was %s during activation', async (state) => {
		const { sourceTab } = installChromeMock();
		delete chrome.windows;
		chrome.tabs.get.mockResolvedValueOnce({ ...sourceTab });
		if (state === 'removed') {
			chrome.tabs.get.mockRejectedValue(new Error('No such tab'));
		} else {
			chrome.tabs.get.mockResolvedValue({
				...sourceTab,
				...(state === 'navigated' ? { url: 'https://other.example/' } : { pendingUrl: 'https://other.example/' }),
			});
		}
		await expect(openInstance()).resolves.toEqual({ status: 'opened', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(20, { active: true });
		expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: INSTANCE_ORIGIN, active: true });
	});

	it.each([
		['generation', 'REQUEST_EXPIRED'],
		['settings', 'REQUEST_EXPIRED'],
		['permission', 'PERMISSION_REQUIRED'],
	])('rejects mobile activation after %s changes during the final source check', async (change, code) => {
		const { local, sourceTab } = installChromeMock();
		delete chrome.windows;
		chrome.tabs.get.mockResolvedValueOnce({ ...sourceTab }).mockImplementation(async () => {
			if (change === 'generation') {
				invalidateConfigurationGeneration();
			} else if (change === 'settings') {
				local.values.settings.instanceOrigin = 'https://replacement.example';
			} else {
				chrome.permissions.contains.mockResolvedValue(false);
			}
			return { ...sourceTab };
		});
		await expect(openInstance()).rejects.toMatchObject({ code });
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(20, { active: true });
		expect(chrome.tabs.create).not.toHaveBeenCalled();
	});

	it('prefers a usable source over a sleeping source', async () => {
		const { sourceTab } = installChromeMock();
		chrome.tabs.query.mockResolvedValue([{ ...sourceTab, id: 21, discarded: true }, sourceTab]);
		await openInstance();
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(sourceTab.id, { active: true });
	});

	it('creates just one active source when concurrent explicit requests find none', async () => {
		installChromeMock();
		chrome.tabs.query.mockResolvedValue([]);
		const outcomes = await Promise.all([openInstance(), openInstance(), openInstance()]);
		expect(outcomes).toEqual(Array(3).fill({ status: 'opened', instanceOrigin: INSTANCE_ORIGIN }));
		expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: INSTANCE_ORIGIN, active: true });
		expect(chrome.tabs.update).not.toHaveBeenCalled();
	});

	it.each([
		['a different port', { url: `${INSTANCE_ORIGIN}:8443/` }],
		['a subdomain', { url: 'https://sub.twofa.example/' }],
		['an unrelated origin', { url: 'https://twofa.example.evil.test/' }],
		['an incognito tab', { incognito: true }],
		['a tab navigating away', { pendingUrl: 'https://other.example/' }],
	])('does not reuse %s', async (_description, overrides) => {
		const { sourceTab } = installChromeMock();
		Object.assign(sourceTab, overrides);
		await expect(checkInstance()).resolves.toMatchObject({ accountCount: 1 });
		await expect(openInstance()).resolves.toEqual({ status: 'opened', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(chrome.windows.update).not.toHaveBeenCalled();
		expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: INSTANCE_ORIGIN, active: true });
	});

	// Chrome omits url on a tab whose first navigation is still pending.
	it.each([
		['an empty', { url: '' }],
		['a missing', {}],
	])('reuses a source tab with %s url whose first navigation has not committed yet', async (_label, url) => {
		const { sourceTab } = installChromeMock();
		delete sourceTab.url;
		Object.assign(sourceTab, url, { pendingUrl: `${INSTANCE_ORIGIN}/` });
		await expect(openInstance()).resolves.toEqual({ status: 'activated', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(20, { active: true });
		expect(chrome.windows.update).toHaveBeenCalledExactlyOnceWith(2, { focused: true });
		expect(chrome.tabs.create).not.toHaveBeenCalled();
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
	});

	it('does not reuse an uncommitted tab heading to another origin', async () => {
		const { sourceTab } = installChromeMock();
		Object.assign(sourceTab, { url: '', pendingUrl: 'https://other.example/' });
		await expect(openInstance()).resolves.toEqual({ status: 'opened', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: INSTANCE_ORIGIN, active: true });
	});

	it.each(['removed', 'navigated'])('rechecks a source that was %s after discovery before activating it', async (state) => {
		installChromeMock();
		if (state === 'removed') {
			chrome.tabs.get.mockRejectedValue(new Error('No such tab'));
		} else {
			chrome.tabs.get.mockResolvedValue({ id: 20, url: 'https://other.example/' });
		}
		await expect(openInstance()).resolves.toEqual({ status: 'opened', instanceOrigin: INSTANCE_ORIGIN });
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(chrome.windows.update).not.toHaveBeenCalled();
		expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
	});

	it.each(['existing', 'missing'])('does not open the old %s source when settings change during discovery', async (state) => {
		const { local, sourceTab } = installChromeMock();
		chrome.tabs.query.mockImplementation(async () => {
			local.values.settings.instanceOrigin = 'https://replacement.example';
			invalidateConfigurationGeneration();
			return state === 'existing' ? [sourceTab] : [];
		});
		await expect(openInstance()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expectNoSourcePageChanges();
	});

	it('cancels activation if configuration changes during the final tab lookup', async () => {
		const { sourceTab } = installChromeMock();
		chrome.tabs.get.mockImplementation(async () => {
			invalidateConfigurationGeneration();
			return sourceTab;
		});
		await expect(openInstance()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expectNoSourcePageChanges();
	});

	it('does not focus the source window after permission is revoked during its lookup', async () => {
		installChromeMock();
		chrome.windows.get.mockImplementation(async () => {
			invalidateConfigurationGeneration();
			chrome.permissions.contains.mockResolvedValue(false);
			return { id: 2, state: 'normal' };
		});
		await expect(openInstance()).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(chrome.windows.update).not.toHaveBeenCalled();
		expect(chrome.tabs.create).not.toHaveBeenCalled();
	});

	it('requires a configured and permitted instance before altering tabs', async () => {
		const { local } = installChromeMock();
		chrome.permissions.contains.mockResolvedValue(false);
		await expect(openInstance()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		delete local.values.settings;
		await expect(openInstance()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
		expectNoSourcePageChanges();
	});

	it('does not create a source if permission is revoked during discovery', async () => {
		installChromeMock();
		chrome.tabs.query.mockImplementation(async () => {
			chrome.permissions.contains.mockResolvedValue(false);
			invalidateConfigurationGeneration();
			return [];
		});
		await expect(openInstance()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expectNoSourcePageChanges();
	});
});

describe('background code previews', () => {
	it.each(['before generation', 'during generation', 'during nonce consumption', 'during claim cleanup'])(
		'rejects preview codes when the target navigates within the same origin %s',
		async (stage) => {
			const { targetTab, session } = installChromeMock();
			const state = await startFlow();
			let currentDocument = state.targetDocumentId;
			const originalSend = chrome.tabs.sendMessage.getMockImplementation();
			chrome.tabs.sendMessage.mockImplementation(async (tabId, message, options) => {
				if (options.documentId !== currentDocument) {
					throw new Error('No receiving end in the captured document');
				}
				return originalSend(tabId, message, options);
			});
			const navigate = () => {
				targetTab.url = `${TARGET_ORIGIN}/another-challenge`;
				currentDocument = 'replacement-document';
			};
			if (stage === 'before generation') {
				navigate();
			} else if (stage === 'during generation') {
				const originalGenerate = generateTotpCode.getMockImplementation();
				generateTotpCode.mockImplementation(async (...args) => {
					const code = await originalGenerate(...args);
					navigate();
					return code;
				});
			} else {
				const originalRemove = session.remove.getMockImplementation();
				let removals = 0;
				session.remove.mockImplementation(async (key) => {
					await originalRemove(key);
					removals += 1;
					if (removals === (stage === 'during claim cleanup' ? 2 : 1)) {
						navigate();
					}
				});
			}
			await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).rejects.toMatchObject({
				code: 'TARGET_CHANGED',
			});
			expect(generateTotpCode).toHaveBeenCalledTimes(stage === 'before generation' ? 0 : 1);
			expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
				targetTab.id,
				{ type: MESSAGE.TARGET_PING },
				{ frameId: 0, documentId: state.targetDocumentId },
			);
			expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
		},
	);

	it('returns a single current code by default and consumes the existing flow', async () => {
		const { local, session } = installChromeMock();
		const state = await startFlow();
		const result = await copyAccountCode({ nonce: state.nonce, account: ACCOUNT });

		expect(result).toEqual({ code: '012345', digits: 6, period: 30, expiresAt: expect.any(Number) });
		const generateMessage = generateTotpCode.mock.calls[0][0];
		expect(generateMessage).not.toHaveProperty('includeNext');
		expect(session.values.pendingFlow).toBeUndefined();
		expect(JSON.stringify([local.values, session.values])).not.toContain('012345');
	});

	it.each([30, 60, 120])('returns consecutive current and next validity intervals for a %i-second account', async (period) => {
		vi.useFakeTimers();
		vi.setSystemTime(100000);
		const { local, session } = installChromeMock({
			generatedData: { code: '012345', nextCode: '654321', digits: 6, period, remainingMs: 20000 },
		});
		const state = await startFlow();
		const performanceSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(250);
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			const response = await originalGenerate(...args);
			vi.setSystemTime(100250);
			return response;
		});
		const result = await copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true });
		performanceSpy.mockRestore();

		expect(result).toEqual({
			code: '012345',
			nextCode: '654321',
			digits: 6,
			period,
			expiresAt: 120000,
			nextStartsAt: 120000,
			nextExpiresAt: 120000 + period * 1000,
		});
		expect(result.expiresAt - Date.now()).toBe(19750);
		const generateMessage = generateTotpCode.mock.calls[0][0];
		expect(generateMessage.includeNext).toBe(true);
		expect(session.values.pendingFlow).toBeUndefined();
		expect(JSON.stringify([local.values, session.values])).not.toMatch(/012345|654321/);
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it('keeps a full new period after Bridge waits for rollover and subtracts only return delivery time', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100000);
		installChromeMock();
		const state = await startFlow();
		const performanceSpy = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(4250);
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			vi.setSystemTime(104000);
			const response = await originalGenerate(...args);
			vi.setSystemTime(104250);
			return response;
		});
		const result = await copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true });
		performanceSpy.mockRestore();

		expect(result.expiresAt).toBe(134000);
		expect(result.expiresAt - Date.now()).toBe(29750);
		expect(result.nextStartsAt).toBe(134000);
		expect(result.nextExpiresAt).toBe(164000);
	});

	it.each([
		['completion before the request', 99999, 100250, 250],
		['completion after receipt', 100251, 100250, 250],
		['wall clock jumps forward', 100000, 103250, 250],
		['wall clock jumps backward', 99750, 99750, 250],
		['negative monotonic elapsed time', 100000, 100250, -1],
		['non-finite monotonic elapsed time', 100000, 100250, Infinity],
	])('rejects preview timing when %s', async (_description, generatedAt, receivedAt, elapsedMs) => {
		vi.useFakeTimers();
		vi.setSystemTime(100000);
		const { session } = installChromeMock({
			generatedData: { code: '012345', nextCode: '654321', digits: 6, period: 30, remainingMs: 30000, generatedAt },
		});
		const state = await startFlow();
		vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(elapsedMs);
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			const response = await originalGenerate(...args);
			vi.setSystemTime(receivedAt);
			return response;
		});
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).rejects.toMatchObject({
			code: 'INVALID_RESPONSE',
		});
		expect(session.values.pendingFlow).toBeUndefined();
	});

	it('rejects a code whose remaining lifetime elapses during return delivery', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100000);
		installChromeMock({ generatedData: { code: '012345', digits: 6, period: 30, remainingMs: 5000 } });
		const state = await startFlow();
		vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(4500);
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			const response = await originalGenerate(...args);
			vi.setSystemTime(104500);
			return response;
		});
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
	});

	it.each([null, 1, 'true', {}])('rejects non-boolean includeNext (%j) without consuming the nonce', async (includeNext) => {
		const { session } = installChromeMock();
		const state = await startFlow();
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(session.values.pendingFlow.nonce).toBe(state.nonce);
		expect(session.values.pendingFlow.claimed).not.toBe(true);
		expect(generateTotpCode).not.toHaveBeenCalled();
	});

	it.each([
		['missing generation timestamp', { generatedAt: undefined }],
		['non-integer generation timestamp', { generatedAt: 100000.1 }],
		['negative generation timestamp', { generatedAt: -1 }],
		['non-finite generation timestamp', { generatedAt: Infinity }],
		['missing period', { period: undefined }],
		['unsupported period', { period: 45 }],
		['string period', { period: '30' }],
		['wrong digits', { digits: 8 }],
		['missing digits', { digits: undefined }],
		['short current code', { code: '12345' }],
		['negative remaining time', { remainingMs: -1 }],
		['remaining time beyond period', { remainingMs: 30001 }],
		['non-finite remaining time', { remainingMs: NaN }],
		['missing next code', { nextCode: undefined }],
		['short next code', { nextCode: '12345' }],
		['non-digit next code', { nextCode: '12345x' }],
		['numeric next code', { nextCode: 654321 }],
	])('rejects %s in a preview response', async (_description, overrides) => {
		const { session } = installChromeMock({
			generatedData: { code: '012345', nextCode: '654321', digits: 6, period: 30, remainingMs: 30000, ...overrides },
		});
		const state = await startFlow();
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).rejects.toMatchObject({
			code: 'INVALID_RESPONSE',
		});
		expect(session.values.pendingFlow).toBeUndefined();
	});

	it('rejects an unsolicited future code on the fill path', async () => {
		installChromeMock({ generatedData: { code: '012345', nextCode: '654321', digits: 6, period: 30, remainingMs: 30000 } });
		const state = await startFlow();
		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).rejects.toMatchObject({
			code: 'INVALID_RESPONSE',
		});
		const generateMessage = generateTotpCode.mock.calls[0][0];
		expect(generateMessage).not.toHaveProperty('includeNext');
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it('rejects a code that expires while the final storage operation completes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100000);
		const { session } = installChromeMock();
		const state = await startFlow();
		const originalRemove = session.remove.getMockImplementation();
		session.remove.mockImplementation(async (...args) => {
			vi.setSystemTime(131000);
			return originalRemove(...args);
		});
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).rejects.toMatchObject({
			code: 'CODE_EXPIRED',
		});
	});
});

describe('background workflow identity and replay protection', () => {
	it('binds the code delivery to the captured target document and consumes the nonce', async () => {
		const { local, session } = installChromeMock();
		const state = await startFlow();

		expect(state).toMatchObject({
			instanceOrigin: INSTANCE_ORIGIN,
			targetOrigin: TARGET_ORIGIN,
			targetTabId: 10,
			targetDocumentId: 'target-document-10',
			accounts: [ACCOUNT],
		});
		expect(session.values.pendingFlow).toMatchObject({
			nonce: state.nonce,
			targetTabId: 10,
			targetFrameId: 0,
			targetDocumentId: 'target-document-10',
		});

		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT, remember: true })).resolves.toEqual({
			status: 'filled',
			targetOrigin: TARGET_ORIGIN,
		});
		expect(session.values.pendingFlow).toBeUndefined();
		expect(local.values.bindings).toEqual([{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: TARGET_ORIGIN, accountId: ACCOUNT.id }]);

		const targetMessages = chrome.tabs.sendMessage.mock.calls.filter(
			([tabId, message]) => tabId === 10 && message.type !== MESSAGE.TARGET_PING,
		);
		expect(targetMessages.map(([, message]) => message.type)).toEqual([MESSAGE.PREPARE_TARGET, MESSAGE.FILL_CODE]);
		expect(targetMessages[1][1]).toMatchObject({ code: '012345', expiresAt: expect.any(Number) });
		expect(targetMessages[1][1].expiresAt).toBeGreaterThan(Date.now());
		for (const [, , options] of targetMessages) {
			expect(options).toEqual({ frameId: 0, documentId: 'target-document-10' });
		}
		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it.each(['document', 'tab'])('exposes a changed target %s to the popup even when the origin stays the same', async (change) => {
		const { targetTab, session } = installChromeMock();
		const original = await startFlow();
		if (change === 'tab') {
			targetTab.id = 11;
		} else {
			const executeScript = chrome.scripting.executeScript.getMockImplementation();
			chrome.scripting.executeScript.mockImplementation(async (options) =>
				options.files[0] === 'content.js' ? [{ frameId: 0, documentId: 'replacement-document-10' }] : executeScript(options),
			);
		}
		const refreshed = await startFlow();

		expect(refreshed.targetOrigin).toBe(original.targetOrigin);
		expect(refreshed.targetTabId).toBe(change === 'tab' ? 11 : original.targetTabId);
		expect(refreshed.targetDocumentId).toBe(change === 'tab' ? 'target-document-11' : 'replacement-document-10');
		expect(refreshed.targetDocumentId).not.toBe(original.targetDocumentId);
		expect(session.values.pendingFlow).toMatchObject({
			nonce: refreshed.nonce,
			targetTabId: refreshed.targetTabId,
			targetDocumentId: refreshed.targetDocumentId,
		});
		await expect(copyAccountCode({ nonce: original.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it('drops a generated code when the target navigates before delivery', async () => {
		installChromeMock({
			targetOnSecondGet: { id: 10, url: 'https://changed.example/', incognito: false, discarded: false },
		});
		const state = await startFlow();

		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		const fillMessages = chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === MESSAGE.FILL_CODE);
		expect(fillMessages).toHaveLength(0);
		expect(JSON.stringify(chrome.storage.session.values)).not.toContain('012345');
	});

	it('allows only one concurrent claim for a copy request', async () => {
		installChromeMock();
		const state = await startFlow();
		const results = await Promise.allSettled([
			copyAccountCode({ nonce: state.nonce, account: ACCOUNT }),
			copyAccountCode({ nonce: state.nonce, account: ACCOUNT }),
		]);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const rejection = results.find((result) => result.status === 'rejected');
		expect(rejection.reason).toBeInstanceOf(ExtensionError);
		expect(rejection.reason.code).toBe('REQUEST_EXPIRED');
		const generateMessages = generateTotpCode.mock.calls;
		expect(generateMessages).toHaveLength(1);
	});

	it.each(['fill', 'copy'])('cancels in-flight %s when the user switches instances', async (operation) => {
		const { local } = installChromeMock();
		const state = await startFlow();
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			local.values.settings.instanceOrigin = 'https://other.example';
			return originalGenerate(...args);
		});
		const action = operation === 'fill' ? fillAccount : copyAccountCode;
		await expect(action({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it('an older request cannot consume or delete a newer pending flow', async () => {
		const { session } = installChromeMock();
		const state = await startFlow();
		let newer;
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			newer = await startFlow();
			return originalGenerate(...args);
		});
		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(session.values.pendingFlow.nonce).toBe(newer.nonce);
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(session.values.pendingFlow.nonce).toBe(newer.nonce);
	});

	it('unchecking remember removes the previous binding after a successful fill', async () => {
		const { local } = installChromeMock();
		local.values.bindings = [{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: TARGET_ORIGIN, accountId: ACCOUNT.id }];
		const state = await startFlow();
		await fillAccount({ nonce: state.nonce, account: ACCOUNT, remember: false });
		expect(local.values.bindings).toEqual([]);
	});

	it('remembering another account replaces the earlier one so automatic choice stays available', async () => {
		const { local } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		const otherSite = bindingFor(ACCOUNT.id, 'https://other.example');
		local.values.bindings = [otherSite];
		const first = await startFlow();
		await fillAccount({ nonce: first.nonce, account: ACCOUNT, remember: true });
		const second = await startFlow();
		await fillAccount({ nonce: second.nonce, account: SECOND_ACCOUNT, remember: true });
		expect(local.values.bindings).toEqual([otherSite, bindingFor(SECOND_ACCOUNT.id)]);
		const state = await startFlow();
		expect(state.boundAccountIds).toEqual([SECOND_ACCOUNT.id]);
		expect(state.boundAccountId).toBe(SECOND_ACCOUNT.id);
	});

	it('remembering an already remembered account converges older multiple bindings for that site', async () => {
		const { local } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		const otherSite = bindingFor(ACCOUNT.id, 'https://other.example');
		local.values.bindings = [bindingFor(ACCOUNT.id), bindingFor(SECOND_ACCOUNT.id), otherSite];
		const state = await startFlow();
		expect(state.autoFillAccountId).toBeNull();
		await fillAccount({ nonce: state.nonce, account: SECOND_ACCOUNT, remember: true });
		expect(local.values.bindings).toEqual([bindingFor(SECOND_ACCOUNT.id), otherSite]);
		const next = await startFlow();
		expect(next.boundAccountIds).toEqual([SECOND_ACCOUNT.id]);
		expect(next.autoFillAccountId).toBe(SECOND_ACCOUNT.id);
	});

	it('filling without remembering leaves the bindings of other accounts alone', async () => {
		const { local } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		local.values.bindings = [bindingFor(ACCOUNT.id)];
		const state = await startFlow();
		await fillAccount({ nonce: state.nonce, account: SECOND_ACCOUNT, remember: false });
		expect(local.values.bindings).toEqual([bindingFor(ACCOUNT.id)]);
	});

	it('a shortcut refuses to guess between multiple bound accounts without generating a code', async () => {
		const { local } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		local.values.bindings = [bindingFor(ACCOUNT.id), bindingFor(SECOND_ACCOUNT.id)];
		await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(generateTotpCode).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it('retains shortcut fill for a single valid binding', async () => {
		const { local } = installChromeMock();
		local.values.bindings = [bindingFor(ACCOUNT.id)];
		await expect(fillBoundAccountFromCommand()).resolves.toMatchObject({ status: 'filled' });
		expect(generateTotpCode.mock.calls).toHaveLength(1);
	});

	it('unchecking remember only forgets the selected account for the current site', async () => {
		const { local } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		const otherSite = bindingFor(ACCOUNT.id, 'https://other.example');
		local.values.bindings = [bindingFor(ACCOUNT.id), bindingFor(SECOND_ACCOUNT.id), otherSite];
		const state = await startFlow();
		await fillAccount({ nonce: state.nonce, account: ACCOUNT, remember: false });
		expect(local.values.bindings).toEqual([bindingFor(SECOND_ACCOUNT.id), otherSite]);
	});

	it('cleans deleted account bindings while retaining valid bindings and other sites', async () => {
		const { local } = installChromeMock();
		const otherSite = bindingFor('deleted-id', 'https://other.example');
		local.values.bindings = [bindingFor('deleted-id'), bindingFor(ACCOUNT.id), otherSite];
		const state = await startFlow();
		expect(state.boundAccountIds).toEqual([ACCOUNT.id]);
		expect(state.boundAccountId).toBe(ACCOUNT.id);
		expect(local.values.bindings).toEqual([bindingFor(ACCOUNT.id), otherSite]);
	});

	it('does not restore an old binding if the instance switches during the fill acknowledgement', async () => {
		const { local } = installChromeMock();
		const state = await startFlow();
		const originalSend = chrome.tabs.sendMessage.getMockImplementation();
		chrome.tabs.sendMessage.mockImplementation(async (...args) => {
			if (args[1].type === MESSAGE.FILL_CODE) {
				local.values.settings.instanceOrigin = 'https://other.example';
				local.values.bindings = [];
			}
			return originalSend(...args);
		});
		await fillAccount({ nonce: state.nonce, account: ACCOUNT, remember: true });
		expect(local.values.bindings).toEqual([]);
	});

	it('does not deliver a code after source permission is revoked', async () => {
		installChromeMock();
		const state = await startFlow();
		const originalGenerate = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (...args) => {
			chrome.permissions.contains.mockResolvedValue(false);
			return originalGenerate(...args);
		});
		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});

	it.each(['fill', 'copy'])('cancels %s if configuration changes during the final session storage operation', async (operation) => {
		const { session, local } = installChromeMock();
		const state = await startFlow();
		const originalRemove = session.remove.getMockImplementation();
		session.remove.mockImplementation(async (...args) => {
			// The asynchronous settings/permission check has already completed.
			invalidateConfigurationGeneration();
			local.values.settings.instanceOrigin = 'https://other.example';
			return originalRemove(...args);
		});
		const action = operation === 'fill' ? fillAccount : copyAccountCode;
		await expect(action({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});
});

describe('view-only popup on pages without a fill target', () => {
	it.each(['chrome://newtab/', 'chrome://settings/', INSTANCE_ORIGIN])('allows copying on %s without injecting', async (url) => {
		const { targetTab } = installChromeMock();
		targetTab.url = url;
		const state = await startFlow();
		expect(state).toMatchObject({ canFill: false, targetOrigin: null, targetTabId: null, accounts: [ACCOUNT] });
		expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT, includeNext: true })).resolves.toMatchObject({ code: '012345' });
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
	});

	it('falls back to copying when browser restrictions reject injection, and refuses filling', async () => {
		installChromeMock();
		chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access this page'));
		const state = await startFlow();
		expect(state.canFill).toBe(false);
		await expect(fillAccount({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
		expect(generateTotpCode).not.toHaveBeenCalled();
		expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
	});

	it('still enforces instance permissions before returning a preview', async () => {
		const { targetTab } = installChromeMock();
		targetTab.url = 'chrome://newtab/';
		const state = await startFlow();
		chrome.permissions.contains.mockResolvedValue(false);
		await expect(copyAccountCode({ nonce: state.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});

	it('continues to reject incognito targets', async () => {
		const { targetTab } = installChromeMock();
		targetTab.incognito = true;
		await expect(startFlow()).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
	});
});

describe('batched previews keep the one-shot target and permission boundary', () => {
	it('consumes one nonce for multiple accounts and never fills or persists codes', async () => {
		const { local, session } = installChromeMock({ accounts: [ACCOUNT, SECOND_ACCOUNT] });
		const state = await startFlow();
		generateTotpCodes.mockImplementation(async () =>
			[ACCOUNT, SECOND_ACCOUNT].map((account) => ({
				id: account.id,
				code: '012345',
				nextCode: '654321',
				digits: 6,
				period: 30,
				generatedAt: Date.now(),
				remainingMs: 20000,
			})),
		);
		const result = await copyAccountCodes({ nonce: state.nonce, accounts: state.accounts, includeNext: true });
		expect(result.map((item) => item.id)).toEqual([ACCOUNT.id, SECOND_ACCOUNT.id]);
		await expect(copyAccountCodes({ nonce: state.nonce, accounts: state.accounts })).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(JSON.stringify([local.values, session.values])).not.toContain('012345');
		expect(chrome.tabs.sendMessage.mock.calls.every(([, message]) => message.type === MESSAGE.TARGET_PING)).toBe(true);
	});

	it.each(['navigation', 'permission'])('rejects the entire response on %s during generation', async (change) => {
		const { targetTab } = installChromeMock();
		const state = await startFlow();
		generateTotpCodes.mockImplementation(async () => {
			if (change === 'navigation') {
				targetTab.url = 'https://changed.example';
			} else {
				chrome.permissions.contains.mockResolvedValue(false);
			}
			return [{ id: ACCOUNT.id, code: '012345', digits: 6, period: 30, generatedAt: Date.now(), remainingMs: 20000 }];
		});
		await expect(copyAccountCodes({ nonce: state.nonce, accounts: [ACCOUNT] })).rejects.toMatchObject({
			code: change === 'navigation' ? 'TARGET_CHANGED' : 'PERMISSION_REQUIRED',
		});
	});
});

it('retains a binding for an unavailable account while allowing other accounts', async () => {
	const { local } = installChromeMock();
	local.values.bindings = [bindingFor('unsupported')];
	listTotpAccounts.mockResolvedValue({
		accounts: [ACCOUNT],
		unavailableAccounts: [{ id: 'unsupported', name: 'Legacy', reason: 'invalid' }],
	});
	const flow = await startFlow();
	expect(flow.accounts).toEqual([ACCOUNT]);
	expect(flow.unavailableAccounts).toEqual([{ id: 'unsupported', name: 'Legacy', reason: 'invalid' }]);
	expect(local.values.bindings).toEqual([bindingFor('unsupported')]);
});

describe('ordinary website automatic filling', () => {
	const github = { ...ACCOUNT, name: 'GitHub' };
	function githubMock(accounts = [github, SECOND_ACCOUNT]) {
		const installed = installChromeMock({ accounts });
		installed.targetTab.url = 'https://github.com/login/two-factor';
		installed.local.values.autofillSites = [
			{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: 'https://github.com', targetPath: '/login/two-factor' },
		];
		const original = chrome.tabs.sendMessage.getMockImplementation();
		chrome.tabs.sendMessage.mockImplementation((id, message) =>
			message.type === MESSAGE.TARGET_PING
				? Promise.resolve({ ok: true, origin: 'https://github.com', targetPath: '/login/two-factor' })
				: original(id, message),
		);
		return installed;
	}
	it('requires path authorization for passive filling while preserving manual and explicit shortcut access', async () => {
		const { local } = githubMock();
		local.values.autofillSites = [{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: 'https://github.com', targetPath: '/other' }];
		let state = await startFlow();
		expect(state.targetPath).toBe('/login/two-factor');
		await expect(fillAccount({ nonce: state.nonce, account: github, automatic: true, userCommand: true })).rejects.toMatchObject({
			code: 'PERMISSION_REQUIRED',
		});
		expect(generateTotpCode).not.toHaveBeenCalled();
		state = await startFlow();
		await expect(fillAccount({ nonce: state.nonce, account: github })).resolves.toMatchObject({ status: 'filled' });
		await expect(fillBoundAccountFromCommand()).resolves.toMatchObject({ status: 'filled' });
	});
	it('rejects a same-document path change before source generation and immediately before dispatch', async () => {
		const { targetTab } = githubMock();
		let state = await startFlow();
		targetTab.url = 'https://github.com/settings/security';
		await expect(fillAccount({ nonce: state.nonce, account: github })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(generateTotpCode).not.toHaveBeenCalled();
		targetTab.url = 'https://github.com/login/two-factor?token=private#description';
		state = await startFlow();
		expect(state.targetPath).toBe('/login/two-factor');
		const original = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (options) => {
			const code = await original(options);
			targetTab.url = 'https://github.com/login/two-factor#/another-challenge?token=private';
			return code;
		});
		await expect(fillAccount({ nonce: state.nonce, account: github })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});
	it.each(['site', 'binding'])('uses the same %s account for popup and shortcut without changing bindings', async (mode) => {
		const { local, session } = githubMock();
		const selected = mode === 'binding' ? SECOND_ACCOUNT : github;
		const bindings = mode === 'binding' ? [bindingFor(SECOND_ACCOUNT.id, 'https://github.com')] : [];
		local.values.bindings = bindings;
		const state = await startFlow();
		expect(state.autoFillAccountId).toBe(selected.id);
		expect(session.values.pendingFlow.autoFillAccountId).toBe(selected.id);
		await fillAccount({ nonce: state.nonce, account: selected, automatic: true, remember: true });
		expect(local.values.bindings).toEqual(bindings);
		await expect(fillBoundAccountFromCommand()).resolves.toMatchObject({ status: 'filled' });
		expect(generateTotpCode).toHaveBeenLastCalledWith(expect.objectContaining({ id: selected.id }));
		expect(local.values.bindings).toEqual(bindings);
	});
	it('rejects a forged automatic selection before requesting a code', async () => {
		githubMock();
		const state = await startFlow();
		await expect(fillAccount({ nonce: state.nonce, account: SECOND_ACCOUNT, automatic: true })).rejects.toMatchObject({
			code: 'AMBIGUOUS_ACCOUNT',
		});
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('does not reduce multiple saved bindings when one is unavailable', async () => {
		const { local } = installChromeMock();
		local.values.bindings = [bindingFor(ACCOUNT.id), bindingFor('missing')];
		listTotpAccounts.mockResolvedValue({
			accounts: [ACCOUNT],
			unavailableAccounts: [{ id: 'missing', name: 'Example', reason: 'invalid' }],
		});
		const state = await startFlow();
		expect(state.autoFillAccountId).toBeNull();
		await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(local.values.bindings).toHaveLength(2);
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('uses the remaining binding after cleaning an account confirmed deleted in session mode', async () => {
		const { local } = installChromeMock();
		local.values.bindings = [bindingFor(ACCOUNT.id), bindingFor('deleted')];
		expect((await startFlow()).autoFillAccountId).toBe(ACCOUNT.id);
		expect(local.values.bindings).toEqual([bindingFor(ACCOUNT.id)]);
	});
	it('keeps a unique service match manual when another record of the service is unavailable', async () => {
		githubMock();
		listTotpAccounts.mockResolvedValue({ accounts: [github], unavailableAccounts: [{ id: 'bad', name: 'GitHub', reason: 'invalid' }] });
		expect((await startFlow()).autoFillAccountId).toBeNull();
		await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
});

describe('Google selected-account matching', () => {
	const GOOGLE = 'https://accounts.google.com';
	const alice = { ...ACCOUNT, id: 'alice', name: 'Google', account: 'alice@example.com' };
	const bob = { ...ACCOUNT, id: 'bob', name: 'Google', account: 'bob@example.com' };
	function googleMock(accounts = [alice, bob]) {
		const installed = installChromeMock({ accounts });
		installed.targetTab.url = GOOGLE + '/v3/signin/challenge/totp';
		installed.local.values.autofillSites = [
			{ instanceOrigin: INSTANCE_ORIGIN, targetOrigin: GOOGLE, targetPath: '/v3/signin/challenge/totp' },
		];
		let email = 'alice@example.com';
		const original = chrome.tabs.sendMessage.getMockImplementation();
		chrome.tabs.sendMessage.mockImplementation((id, message) =>
			message.type === MESSAGE.TARGET_PING
				? Promise.resolve({
						ok: true,
						origin: GOOGLE,
						targetPath: '/v3/signin/challenge/totp',
						loginContext: { provider: 'google', email },
					})
				: original(id, message),
		);
		return {
			...installed,
			setEmail: (value) => {
				email = value;
			},
		};
	}
	it.each(['alice@example.com', 'Google:alice@example.com'])(
		'chooses %s over a previous binding without changing bindings',
		async (account) => {
			const imported = { ...alice, account };
			const { local } = googleMock([imported, bob, { ...imported, id: 'github', name: 'GitHub' }]);
			local.values.bindings = [bindingFor(bob.id, GOOGLE)];
			await expect(fillBoundAccountFromCommand()).resolves.toMatchObject({ status: 'filled' });
			expect(generateTotpCode).toHaveBeenCalledWith(
				expect.objectContaining({ id: alice.id, metadata: expect.objectContaining({ account }) }),
			);
			expect(local.values.bindings).toEqual([bindingFor(bob.id, GOOGLE)]);
		},
	);
	describe('remembering accounts whose names are not Google services', () => {
		const workAlice = { ...ACCOUNT, id: 'work-alice', name: '工作账号', account: 'alice@example.com' };
		const oldAlice = { ...ACCOUNT, id: 'old-alice', name: '旧工作账号', account: 'alice@example.com' };
		const workBob = { ...ACCOUNT, id: 'work-bob', name: '工作账号', account: 'bob@example.com' };
		const remembered = (account) => bindingFor(account.id, GOOGLE);
		// The page login email is used only for matching; it never reaches local storage.
		const expectNoStoredEmail = (local) => expect(JSON.stringify(local.values)).not.toMatch(/(alice|bob)@example\.com/);

		it('keeps one remembered account for each account email', async () => {
			const installed = googleMock([workAlice, workBob]);
			let state = await startFlow();
			// Only a binding can connect these names to a Google login.
			expect(state.autoFillAccountId).toBeNull();
			await fillAccount({ nonce: state.nonce, account: workAlice, remember: true });
			installed.setEmail('bob@example.com');
			state = await startFlow();
			expect(state.autoFillAccountId).toBeNull();
			await fillAccount({ nonce: state.nonce, account: workBob, remember: true });
			expect(installed.local.values.bindings).toEqual([remembered(workAlice), remembered(workBob)]);
			expectNoStoredEmail(installed.local);
			expect((await startFlow()).autoFillAccountId).toBe(workBob.id);
			installed.setEmail('alice@example.com');
			expect((await startFlow()).autoFillAccountId).toBe(workAlice.id);
			await expect(fillBoundAccountFromCommand()).resolves.toMatchObject({ status: 'filled' });
			expect(generateTotpCode).toHaveBeenLastCalledWith(expect.objectContaining({ id: workAlice.id }));
		});

		it('replaces the account remembered for the same account email', async () => {
			const { local } = googleMock([workAlice, oldAlice, workBob]);
			local.values.bindings = [remembered(oldAlice), remembered(workBob)];
			const state = await startFlow();
			expect(state.autoFillAccountId).toBe(oldAlice.id);
			await fillAccount({ nonce: state.nonce, account: workAlice, remember: true });
			expect(local.values.bindings).toEqual([remembered(workBob), remembered(workAlice)]);
			expect((await startFlow()).autoFillAccountId).toBe(workAlice.id);
		});

		it('scopes an account chosen from all accounts by its own email, not by the page email', async () => {
			const { local } = googleMock([workAlice, oldAlice, workBob]);
			local.values.bindings = [remembered(workAlice)];
			const state = await startFlow();
			// The page shows Alice, but the user fills Bob's account.
			await fillAccount({ nonce: state.nonce, account: workBob, remember: true });
			expect(local.values.bindings).toEqual([remembered(workAlice), remembered(workBob)]);
			expectNoStoredEmail(local);
		});

		it('keeps bindings of other emails when the Google page shows no login email', async () => {
			const installed = googleMock([workAlice, oldAlice, workBob]);
			installed.local.values.bindings = [remembered(oldAlice), remembered(workBob)];
			installed.setEmail(null);
			const state = await startFlow();
			expect(state.loginContext).toBeUndefined();
			await fillAccount({ nonce: state.nonce, account: workAlice, remember: true });
			expect(installed.local.values.bindings).toEqual([remembered(workBob), remembered(workAlice)]);
		});

		it('ignores a page email stored by an earlier version and removes it on the next write', async () => {
			const { local } = googleMock([workAlice, oldAlice, workBob]);
			// An earlier version stored the page email, which may differ from the account's own.
			local.values.bindings = [
				{ ...remembered(workAlice), loginEmail: 'bob@example.com' },
				{ ...remembered(workBob), loginEmail: 'bob@example.com' },
			];
			const state = await startFlow();
			await fillAccount({ nonce: state.nonce, account: oldAlice, remember: true });
			expect(local.values.bindings).toEqual([remembered(workBob), remembered(oldAlice)]);
			expectNoStoredEmail(local);
		});

		it('converges older bindings of the same email and keeps older bindings of other emails', async () => {
			const installed = googleMock([workAlice, oldAlice, workBob]);
			installed.local.values.bindings = [remembered(oldAlice), remembered(workBob), remembered(workAlice)];
			const state = await startFlow();
			// Two remembered records for one email cannot be told apart.
			expect(state.autoFillAccountId).toBeNull();
			await fillAccount({ nonce: state.nonce, account: workAlice, remember: true });
			expect(installed.local.values.bindings).toEqual([remembered(workBob), remembered(workAlice)]);
			expect((await startFlow()).autoFillAccountId).toBe(workAlice.id);
			installed.setEmail('bob@example.com');
			expect((await startFlow()).autoFillAccountId).toBe(workBob.id);
		});

		it('unchecking remember removes only the filled account on the shared website', async () => {
			const { local } = googleMock([workAlice, workBob]);
			local.values.bindings = [remembered(workAlice), remembered(workBob)];
			const state = await startFlow();
			await fillAccount({ nonce: state.nonce, account: workAlice, remember: false });
			expect(local.values.bindings).toEqual([remembered(workBob)]);
		});
	});

	it('does not guess when the same Google email has multiple OTP records', async () => {
		googleMock([alice, { ...alice, id: 'duplicate', name: 'Gmail', account: 'Google:alice@example.com' }]);
		expect((await startFlow()).autoFillAccountId).toBeNull();
		await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('rejects automatic filling if the supplied account is not the unique match', async () => {
		googleMock();
		const state = await startFlow();
		await expect(fillAccount({ nonce: state.nonce, account: bob, automatic: true })).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it.each(['Google', '私人主号'])('does not infer a unique Google email when the unavailable %s record could match', async (name) => {
		const { local } = googleMock([alice]);
		local.values.bindings = name === 'Google' ? [] : [bindingFor('unavailable', GOOGLE)];
		listTotpAccounts.mockResolvedValue({ accounts: [alice], unavailableAccounts: [{ id: 'unavailable', name, reason: 'invalid' }] });
		expect((await startFlow()).autoFillAccountId).toBeNull();
		await expect(fillBoundAccountFromCommand()).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('keeps automatic Google filling when only an unrelated unbound record is unavailable', async () => {
		googleMock([alice]);
		listTotpAccounts.mockResolvedValue({
			accounts: [alice],
			unavailableAccounts: [{ id: 'unavailable', name: 'GitHub', reason: 'invalid' }],
		});
		expect((await startFlow()).autoFillAccountId).toBe(alice.id);
	});
	it('cancels a delayed generated code when the visible Google account changes', async () => {
		const installed = googleMock();
		const state = await startFlow();
		const original = generateTotpCode.getMockImplementation();
		generateTotpCode.mockImplementation(async (options) => {
			installed.setEmail('bob@example.com');
			return original(options);
		});
		await expect(fillAccount({ nonce: state.nonce, account: alice, automatic: true })).rejects.toMatchObject({ code: 'LOGIN_CHANGED' });
		expect(chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.type === MESSAGE.FILL_CODE)).toBe(false);
	});
});
