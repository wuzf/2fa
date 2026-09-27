import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE } from '../../extension/src/shared/protocol.js';
vi.mock('../../extension/src/background/autofill-registration.js', () => ({
	reconcileAutofillScripts: vi.fn(async () => {}),
	observeAutofillRenderer: vi.fn(),
}));
vi.mock('../../extension/src/background/source-registration.js', () => ({
	reconcileSourceWatcher: vi.fn(async () => {}),
	observeSourceRenderer: vi.fn(),
}));
vi.mock('../../extension/src/background/source-updates.js', () => ({
	SOURCE_MESSAGES: ['SOURCE_STATUS', 'SOURCE_DIRTY'],
	routeSourceMessage: vi.fn(),
	startSourceUpdates: vi.fn(),
}));
vi.mock('../../extension/src/background/automatic-workflow.js', () => ({
	AUTO_MESSAGES: ['AUTO_STATUS', 'AUTO_DISCOVER', 'AUTO_SELECT'],
	routeAutomaticMessage: vi.fn(),
	invalidateAutomaticFlows: vi.fn(),
}));
const authorization = vi.hoisted(() => ({
	beginAutofillAuthorization: vi.fn(async () => ({ status: 'pending' })),
	completeAutofillAuthorization: vi.fn(async () => ({ status: 'cancelled' })),
	cancelAutofillAuthorization: vi.fn(async () => ({ status: 'cancelled' })),
	clearAutofillAuthorization: vi.fn(async () => {}),
}));
vi.mock('../../extension/src/background/autofill-authorization.js', () => authorization);
import {
	clearPendingFlow,
	getConnectionStatus,
	getSettings,
	saveSettings,
	lockStorageToTrustedContexts,
} from '../../extension/src/shared/storage.js';
import { startSourceUpdates, routeSourceMessage } from '../../extension/src/background/source-updates.js';
import { routeAutomaticMessage } from '../../extension/src/background/automatic-workflow.js';
import { clearOfflineSource, cancelOfflineRequests } from '../../extension/src/background/offline-source.js';
import { invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';
import { reconcileAutofillScripts } from '../../extension/src/background/autofill-registration.js';
import { reconcileSourceWatcher } from '../../extension/src/background/source-registration.js';

const sites = vi.hoisted(() => ({
	readAutofillSites: vi.fn(),
	setAutofillSite: vi.fn(),
	isPermissionPatternInUse: vi.fn(),
	pruneRevokedAutofillSites: vi.fn(),
}));

vi.mock('../../extension/src/shared/autofill-sites.js', () => sites);
vi.mock('../../extension/src/background/generation.js', () => ({
	invalidateConfigurationGeneration: vi.fn(),
	getConfigurationGeneration: vi.fn(() => 'current-generation'),
}));

const workflow = vi.hoisted(() => ({
	startFlow: vi.fn(),
	getAutofillContext: vi.fn(),
	fillAccount: vi.fn(),
	copyAccountCode: vi.fn(),
	checkInstance: vi.fn(),
	openInstance: vi.fn(),
	fillBoundAccountFromCommand: vi.fn(),
	disableOfflineCache: vi.fn(),
	importWebOfflineCache: vi.fn(),
	sendDocumentMessage: vi.fn(),
	getOfflineCacheIcons: vi.fn(),
	refreshOfflineAccounts: vi.fn(),
}));

vi.mock('../../extension/src/background/workflow.js', () => ({
	...workflow,
	ExtensionError: class extends Error {
		constructor(code) {
			super(code);
			this.code = code;
		}
	},
}));
vi.mock('../../extension/src/shared/storage.js', () => ({
	lockStorageToTrustedContexts: vi.fn(async () => undefined),
	clearPendingFlow: vi.fn(async () => undefined),
	getSettings: vi.fn(async () => ({ instanceOrigin: 'https://configured.example' })),
	getConnectionStatus: vi.fn(async () => ({ mode: 'session' })),
	removeBinding: vi.fn(async () => undefined),
	removeBindingsForInstance: vi.fn(async () => undefined),
	saveSettings: vi.fn(async () => undefined),
}));
vi.mock('../../extension/src/background/offline-source.js', () => ({
	clearOfflineSource: vi.fn(async () => {}),
	cancelOfflineRequests: vi.fn(),
}));

let onMessage;
let onCommand;
let onPermissionsRemoved;
let onPermissionsAdded;

const INSTANCE = 'https://configured.example';
const TARGET = 'https://login.example';
const PATH = '/login';
const SITE = { instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath: PATH };

function send(message, page = 'options.html') {
	return new Promise((resolve) => onMessage(message, { id: chrome.runtime.id, url: chrome.runtime.getURL(page) }, resolve));
}

function defer() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	Object.values(authorization).forEach((mock) => mock.mockClear());
	getSettings.mockReset().mockResolvedValue({ instanceOrigin: INSTANCE });
	getConnectionStatus.mockReset().mockResolvedValue({ mode: 'session' });
	saveSettings.mockReset().mockResolvedValue(undefined);
	sites.readAutofillSites.mockReset().mockResolvedValue([]);
	sites.setAutofillSite.mockReset().mockResolvedValue([]);
	sites.isPermissionPatternInUse.mockReset().mockResolvedValue(false);
	sites.pruneRevokedAutofillSites.mockReset().mockResolvedValue([]);
	reconcileAutofillScripts.mockReset().mockResolvedValue(undefined);
	workflow.sendDocumentMessage.mockReset().mockResolvedValue({ ok: true, origin: TARGET, targetPath: PATH });
	globalThis.chrome = {
		runtime: {
			id: 'extension-id',
			getURL: (path) => `chrome-extension://extension-id/${path}`,
			onMessage: { addListener: (listener) => (onMessage = listener) },
			onInstalled: { addListener: vi.fn() },
			openOptionsPage: vi.fn(async () => undefined),
		},
		commands: { onCommand: { addListener: (listener) => (onCommand = listener) } },
		permissions: {
			onRemoved: { addListener: (listener) => (onPermissionsRemoved = listener) },
			onAdded: { addListener: (listener) => (onPermissionsAdded = listener) },
			contains: vi.fn(async () => true),
			remove: vi.fn(async () => true),
		},
		action: { openPopup: vi.fn(async () => undefined) },
		tabs: { get: vi.fn(async () => ({ id: 10, url: `${TARGET}/login` })) },
	};
	await import('../../extension/src/background/index.js');
});

afterEach(() => {
	delete globalThis.chrome;
});

describe('explicit source recovery message boundary', () => {
	it('limits account-independent authorization inspection to trusted extension pages', async () => {
		workflow.getAutofillContext.mockResolvedValue({ instanceOrigin: INSTANCE, sites: [SITE] });
		expect(await send({ type: MESSAGE.GET_AUTOFILL_CONTEXT }, 'popup.html')).toEqual({
			ok: true,
			data: { instanceOrigin: INSTANCE, sites: [SITE] },
		});
		expect(workflow.startFlow).not.toHaveBeenCalled();
		const respond = vi.fn();
		expect(onMessage({ type: MESSAGE.GET_AUTOFILL_CONTEXT }, { id: chrome.runtime.id, url: TARGET }, respond)).toBe(false);
		expect(respond).not.toHaveBeenCalled();
		expect(workflow.getAutofillContext).toHaveBeenCalledOnce();
	});
	it('returns settings only to trusted extension pages without starting a source request', async () => {
		expect(await send({ type: MESSAGE.GET_SETTINGS })).toEqual({ ok: true, data: { instanceOrigin: INSTANCE } });
		expect(workflow.checkInstance).not.toHaveBeenCalled();
		expect(workflow.startFlow).not.toHaveBeenCalled();
		const respond = vi.fn();
		expect(onMessage({ type: MESSAGE.GET_SETTINGS }, { id: chrome.runtime.id, url: TARGET }, respond)).toBe(false);
		expect(respond).not.toHaveBeenCalled();
	});

	it('waits for upgrade cleanup before reading settings or starting source listeners', async () => {
		vi.resetModules();
		const migration = defer();
		lockStorageToTrustedContexts.mockReturnValueOnce(migration.promise);
		startSourceUpdates.mockClear();
		getSettings.mockClear();
		await import('../../extension/src/background/index.js');
		const reading = send({ type: MESSAGE.GET_SETTINGS });
		await Promise.resolve();
		expect(getSettings).not.toHaveBeenCalled();
		expect(startSourceUpdates).not.toHaveBeenCalled();
		getSettings.mockResolvedValue({ instanceOrigin: null });
		migration.resolve();
		expect(await reading).toEqual({ ok: true, data: { instanceOrigin: null } });
		expect(startSourceUpdates).toHaveBeenCalledOnce();
	});

	it('does not read, reconnect, or start sources when upgrade cleanup fails', async () => {
		vi.resetModules();
		lockStorageToTrustedContexts.mockRejectedValueOnce(new Error('upgrade storage unavailable'));
		startSourceUpdates.mockClear();
		getSettings.mockClear();
		await import('../../extension/src/background/index.js');
		for (const type of [MESSAGE.GET_SETTINGS, MESSAGE.START_FLOW, MESSAGE.CHECK_INSTANCE, MESSAGE.SAVE_INSTANCE]) {
			expect(await send({ type, instanceOrigin: INSTANCE, connection: { mode: 'session' } })).toMatchObject({ ok: false });
		}
		expect(await send({ type: MESSAGE.SOURCE_STATUS })).toMatchObject({ ok: false });
		for (const type of [MESSAGE.AUTO_STATUS, MESSAGE.AUTO_DISCOVER]) {
			const response = await new Promise((resolve) =>
				onMessage(
					{ type },
					{
						id: chrome.runtime.id,
						url: TARGET,
						tab: { id: 10, url: TARGET },
						frameId: 0,
						documentId: 'target-document',
					},
					resolve,
				),
			);
			expect(response).toMatchObject({ ok: false });
		}
		await onCommand('fill-otp');
		expect(getSettings).not.toHaveBeenCalled();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(workflow.startFlow).not.toHaveBeenCalled();
		expect(workflow.checkInstance).not.toHaveBeenCalled();
		expect(startSourceUpdates).not.toHaveBeenCalled();
		expect(routeSourceMessage).not.toHaveBeenCalled();
		expect(routeAutomaticMessage).not.toHaveBeenCalled();
		expect(workflow.fillBoundAccountFromCommand).not.toHaveBeenCalled();
		expect(chrome.action.openPopup).toHaveBeenCalledOnce();
	});

	it.each([null, [], {}, { mode: 'device', token: 'retired-token' }])(
		'rejects an unsupported connection before persisting it: %j',
		async (connection) => {
			expect(await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: INSTANCE, connection })).toMatchObject({
				ok: false,
				error: { code: 'INVALID_REQUEST' },
			});
			expect(saveSettings).not.toHaveBeenCalled();
			expect(clearOfflineSource).not.toHaveBeenCalled();
		},
	);

	it('passes the explicit cached-start preference without changing default startup requests', async () => {
		await send({ type: MESSAGE.START_FLOW, preferCache: true, refreshSource: true }, 'popup.html');
		expect(workflow.startFlow).toHaveBeenLastCalledWith({ preferCache: true, refreshSource: true });
		await send({ type: MESSAGE.START_FLOW }, 'popup.html');
		expect(workflow.startFlow).toHaveBeenLastCalledWith({ preferCache: false, refreshSource: false });
	});

	it('refreshes only the requested source without invalidating an existing popup flow', async () => {
		workflow.refreshOfflineAccounts.mockResolvedValue({ instanceOrigin: INSTANCE, accountCount: 2, available: true, cachedAt: 123 });
		expect(await send({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin: INSTANCE }, 'popup.html')).toEqual({
			ok: true,
			data: { instanceOrigin: INSTANCE, accountCount: 2, available: true, cachedAt: 123 },
		});
		expect(workflow.refreshOfflineAccounts).toHaveBeenCalledExactlyOnceWith(INSTANCE, { clockOnly: false });
		expect(clearPendingFlow).not.toHaveBeenCalled();
		expect(invalidateConfigurationGeneration).not.toHaveBeenCalled();
	});

	it('passes a time-only verification request only when the popup asks for it explicitly', async () => {
		workflow.refreshOfflineAccounts.mockResolvedValue({ instanceOrigin: INSTANCE, accountCount: 2, available: true, cachedAt: 123 });
		await send({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin: INSTANCE, clockOnly: true }, 'popup.html');
		await send({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin: INSTANCE, clockOnly: 'yes' }, 'popup.html');
		expect(workflow.refreshOfflineAccounts.mock.calls).toEqual([
			[INSTANCE, { clockOnly: true }],
			[INSTANCE, { clockOnly: false }],
		]);
		expect(clearPendingFlow).not.toHaveBeenCalled();
	});

	it('serves popup nonce renewal while a separate account refresh is still waiting', async () => {
		const refreshing = defer();
		workflow.refreshOfflineAccounts.mockReturnValueOnce(refreshing.promise);
		const refresh = send({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin: INSTANCE }, 'popup.html');
		await vi.waitFor(() => expect(workflow.refreshOfflineAccounts).toHaveBeenCalledOnce());
		workflow.startFlow.mockResolvedValueOnce({ nonce: 'renewed', accounts: [] });
		expect(await send({ type: MESSAGE.START_FLOW, preferCache: true }, 'popup.html')).toEqual({
			ok: true,
			data: { nonce: 'renewed', accounts: [] },
		});
		refreshing.resolve({ instanceOrigin: INSTANCE, accountCount: 1 });
		await refresh;
	});

	it.each([undefined, null, '', 42])('does not refresh a silently selected source for invalid origin %s', async (instanceOrigin) => {
		expect(await send({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin })).toMatchObject({
			ok: false,
			error: { code: 'INVALID_REQUEST' },
		});
		expect(workflow.refreshOfflineAccounts).not.toHaveBeenCalled();
	});

	it('does not allow source or target pages to invoke a management refresh', () => {
		const respond = vi.fn();
		for (const url of [INSTANCE, TARGET]) {
			expect(onMessage({ type: MESSAGE.REFRESH_OFFLINE_ACCOUNTS, instanceOrigin: INSTANCE }, { id: chrome.runtime.id, url }, respond)).toBe(
				false,
			);
		}
		expect(respond).not.toHaveBeenCalled();
		expect(workflow.refreshOfflineAccounts).not.toHaveBeenCalled();
	});

	it.each([MESSAGE.START_FLOW, MESSAGE.CHECK_INSTANCE])('waits for offline cache disabling before a new %s request', async (type) => {
		let release;
		workflow.disableOfflineCache.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') };
		const clearing = new Promise((resolve) => onMessage({ type: MESSAGE.CLEAR_OFFLINE }, sender, resolve));
		await vi.waitFor(() => expect(workflow.disableOfflineCache).toHaveBeenCalledOnce());
		const reading = new Promise((resolve) => onMessage({ type }, sender, resolve));
		await Promise.resolve();
		await Promise.resolve();
		expect(workflow.startFlow).not.toHaveBeenCalled();
		expect(workflow.checkInstance).not.toHaveBeenCalled();
		release({ disabled: true });
		await Promise.all([clearing, reading]);
		expect(type === MESSAGE.START_FLOW ? workflow.startFlow : workflow.checkInstance).toHaveBeenCalledOnce();
	});
	it.each([
		[MESSAGE.CLEAR_OFFLINE, 'disableOfflineCache'],
		[MESSAGE.IMPORT_OFFLINE, 'importWebOfflineCache'],
	])('forwards the optional expected instance for %s while supporting older requests', async (type, method) => {
		await send({ type, instanceOrigin: INSTANCE });
		expect(workflow[method]).toHaveBeenLastCalledWith(INSTANCE);
		await send({ type });
		expect(workflow[method]).toHaveBeenLastCalledWith(undefined);
		if (type === MESSAGE.CLEAR_OFFLINE) {
			expect(invalidateConfigurationGeneration).toHaveBeenCalledTimes(2);
			expect(reconcileAutofillScripts).toHaveBeenCalledTimes(2);
		}
	});
	it.each([MESSAGE.CLEAR_OFFLINE, MESSAGE.IMPORT_OFFLINE])('rejects malformed expected origins for %s', async (type) => {
		for (const instanceOrigin of [null, '', 42]) {
			expect(await send({ type, instanceOrigin })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
		}
		expect(workflow.disableOfflineCache).not.toHaveBeenCalled();
		expect(workflow.importWebOfflineCache).not.toHaveBeenCalled();
	});
	it.each(['popup.html', 'options.html'])('accepts the explicit action from %s without passing a supplied URL', async (page) => {
		workflow.openInstance.mockResolvedValue({ status: 'opened', instanceOrigin: 'https://configured.example' });
		const response = await new Promise((resolve) => {
			expect(
				onMessage(
					{ type: MESSAGE.OPEN_INSTANCE, instanceOrigin: 'https://untrusted.example', url: 'https://untrusted.example/path' },
					{ id: chrome.runtime.id, url: chrome.runtime.getURL(page) },
					resolve,
				),
			).toBe(true);
		});
		expect(response).toEqual({ ok: true, data: { status: 'opened', instanceOrigin: 'https://configured.example' } });
		expect(workflow.openInstance).toHaveBeenCalledExactlyOnceWith();
	});

	it.each([
		{ id: 'extension-id', url: 'https://configured.example/' },
		{ id: 'another-extension', url: 'chrome-extension://extension-id/popup.html' },
		{ id: 'extension-id', url: 'chrome-extension://extension-id.evil/popup.html' },
	])('does not let an untrusted sender open the instance (%j)', (sender) => {
		const respond = vi.fn();
		expect(onMessage({ type: MESSAGE.OPEN_INSTANCE }, sender, respond)).toBe(false);
		expect(respond).not.toHaveBeenCalled();
		expect(workflow.openInstance).not.toHaveBeenCalled();
	});

	it('opens the popup on a expired-login shortcut without invoking explicit source recovery', async () => {
		workflow.fillBoundAccountFromCommand.mockRejectedValue(new Error('AUTH_REQUIRED'));
		await onCommand('fill-otp');
		expect(chrome.action.openPopup).toHaveBeenCalledExactlyOnceWith();
		expect(workflow.openInstance).not.toHaveBeenCalled();
		expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
	});

	it('waits for an already requested settings change before reading the source configuration', async () => {
		let finishSave;
		saveSettings.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)));
		const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') };
		const saved = new Promise((resolve) =>
			onMessage({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://new.example' }, sender, resolve),
		);
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
		const opened = new Promise((resolve) => onMessage({ type: MESSAGE.OPEN_INSTANCE }, sender, resolve));
		await Promise.resolve();
		await Promise.resolve();
		expect(workflow.openInstance).not.toHaveBeenCalled();
		finishSave();
		await Promise.all([saved, opened]);
		expect(workflow.openInstance).toHaveBeenCalledExactlyOnceWith();
	});
});

describe('automatic site configuration message boundary', () => {
	it.each(['popup.html', 'options.html'])('reads the current instance sites for %s and ignores a supplied instance', async (page) => {
		sites.readAutofillSites.mockResolvedValue([SITE]);
		expect(await send({ type: MESSAGE.GET_AUTOFILL_SITES, instanceOrigin: 'https://untrusted.example' }, page)).toEqual({
			ok: true,
			data: { instanceOrigin: INSTANCE, sites: [SITE] },
		});
		expect(sites.readAutofillSites).toHaveBeenCalledExactlyOnceWith(INSTANCE);
	});

	it('returns no site configurations when no instance is configured', async () => {
		getSettings.mockResolvedValue({ instanceOrigin: null });
		expect(await send({ type: MESSAGE.GET_AUTOFILL_SITES })).toEqual({ ok: true, data: { instanceOrigin: null, sites: [] } });
		expect(sites.readAutofillSites).not.toHaveBeenCalled();
	});

	it.each(['popup.html', 'options.html'])('enables a site through the policy boundary for %s', async (page) => {
		sites.setAutofillSite.mockResolvedValue([SITE]);
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true }, page)).toEqual({
			ok: true,
			data: { instanceOrigin: INSTANCE, sites: [SITE] },
		});
		expect(sites.setAutofillSite).toHaveBeenCalledExactlyOnceWith(INSTANCE, TARGET, PATH, true);
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
	});

	it.each(['PERMISSION_REQUIRED', 'INVALID_REQUEST', 'REQUEST_EXPIRED'])(
		'returns policy error %s without releasing permissions',
		async (code) => {
			sites.setAutofillSite.mockRejectedValue(Object.assign(new Error(code), { code }));
			expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true })).toMatchObject({ ok: false, error: { code } });
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		},
	);

	it.each([MESSAGE.GET_AUTOFILL_SITES, MESSAGE.SET_AUTOFILL_SITE])('does not expose %s to page scripts or another extension', (type) => {
		for (const sender of [
			{ id: chrome.runtime.id, url: `${TARGET}/login`, tab: { id: 1 } },
			{ id: 'other-extension', url: chrome.runtime.getURL('popup.html') },
			{ id: chrome.runtime.id, url: 'chrome-extension://extension-id.evil/popup.html' },
		]) {
			const response = vi.fn();
			expect(onMessage({ type, ...SITE, enabled: true }, sender, response)).toBe(false);
			expect(response).not.toHaveBeenCalled();
		}
		expect(sites.readAutofillSites).not.toHaveBeenCalled();
		expect(sites.setAutofillSite).not.toHaveBeenCalled();
		expect(invalidateConfigurationGeneration).not.toHaveBeenCalled();
	});

	it('invalidates in-flight work immediately when a trusted site configuration changes', async () => {
		const pending = defer();
		sites.setAutofillSite.mockReturnValueOnce(pending.promise);
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		expect(invalidateConfigurationGeneration).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(sites.setAutofillSite).toHaveBeenCalledOnce());
		pending.resolve([SITE]);
		await changed;
		expect(clearPendingFlow).toHaveBeenCalled();
	});

	it('waits for a pending instance save before applying a site preference', async () => {
		const pending = defer();
		saveSettings.mockReturnValueOnce(pending.promise);
		const saved = send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://new.example' });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
		const changed = send({
			type: MESSAGE.SET_AUTOFILL_SITE,
			instanceOrigin: 'https://new.example',
			targetOrigin: TARGET,
			targetPath: PATH,
			enabled: true,
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(sites.setAutofillSite).not.toHaveBeenCalled();
		pending.resolve();
		await Promise.all([saved, changed]);
		expect(sites.setAutofillSite).toHaveBeenCalledExactlyOnceWith('https://new.example', TARGET, PATH, true);
	});

	it.each([MESSAGE.SAVE_INSTANCE, MESSAGE.CLEAR_OFFLINE])('waits for a pending site change before %s', async (type) => {
		const pending = defer();
		sites.setAutofillSite.mockReturnValueOnce(pending.promise);
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		await vi.waitFor(() => expect(sites.setAutofillSite).toHaveBeenCalledOnce());
		const following = send({ type, instanceOrigin: 'https://new.example' });
		await Promise.resolve();
		await Promise.resolve();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(workflow.disableOfflineCache).not.toHaveBeenCalled();
		pending.resolve([SITE]);
		await Promise.all([changed, following]);
		expect(type === MESSAGE.SAVE_INSTANCE ? saveSettings : workflow.disableOfflineCache).toHaveBeenCalledOnce();
	});

	it('waits for pending site changes before returning the sites list', async () => {
		const pending = defer();
		sites.setAutofillSite.mockReturnValueOnce(pending.promise);
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		await vi.waitFor(() => expect(sites.setAutofillSite).toHaveBeenCalledOnce());
		const reading = send({ type: MESSAGE.GET_AUTOFILL_SITES });
		await Promise.resolve();
		await Promise.resolve();
		expect(sites.readAutofillSites).toHaveBeenCalledTimes(1); // Only the writer's rollback snapshot.
		pending.resolve([SITE]);
		await Promise.all([changed, reading]);
		expect(sites.readAutofillSites).toHaveBeenCalledTimes(2);
		expect(sites.readAutofillSites).toHaveBeenLastCalledWith(INSTANCE);
	});

	it('allows subsequent configuration actions after a rejected site change', async () => {
		sites.setAutofillSite.mockRejectedValueOnce(Object.assign(new Error('REQUEST_EXPIRED'), { code: 'REQUEST_EXPIRED' }));
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		const saved = send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://new.example' });
		expect(await changed).toMatchObject({ ok: false, error: { code: 'REQUEST_EXPIRED' } });
		expect(await saved).toMatchObject({ ok: true });
		expect(saveSettings).toHaveBeenCalledOnce();
	});
});

describe('guarded connection changes', () => {
	it('enables offline mode when the settings page still describes the saved connection', async () => {
		expect(
			await send({
				type: MESSAGE.SAVE_INSTANCE,
				instanceOrigin: INSTANCE,
				connection: { mode: 'offline' },
				expectedConnection: { instanceOrigin: INSTANCE, mode: 'session' },
			}),
		).toMatchObject({ ok: true });
		expect(getConnectionStatus).toHaveBeenCalledExactlyOnceWith(INSTANCE);
		expect(saveSettings).toHaveBeenCalledExactlyOnceWith(INSTANCE, { mode: 'offline' });
	});

	it.each([
		null,
		[],
		{},
		{ instanceOrigin: '', mode: 'session' },
		{ instanceOrigin: 42, mode: 'session' },
		{ instanceOrigin: INSTANCE, mode: 'unknown' },
		{ instanceOrigin: INSTANCE, mode: 'device' },
	])('rejects a malformed expected connection: %j', async (expectedConnection) => {
		expect(
			await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: INSTANCE, connection: { mode: 'offline' }, expectedConnection }),
		).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
		expect(saveSettings).not.toHaveBeenCalled();
		expect(clearOfflineSource).not.toHaveBeenCalled();
	});

	it('rejects a guarded save that combines different current and next instances', async () => {
		expect(
			await send({
				type: MESSAGE.SAVE_INSTANCE,
				instanceOrigin: 'https://next.example',
				connection: { mode: 'offline' },
				expectedConnection: { instanceOrigin: INSTANCE, mode: 'session' },
			}),
		).toMatchObject({ ok: false, error: { code: 'REQUEST_EXPIRED' } });
		expect(saveSettings).not.toHaveBeenCalled();
		expect(clearOfflineSource).not.toHaveBeenCalled();
	});

	it.each(['instance', 'mode'])('rejects a stale toggle after a queued save changes the %s', async (change) => {
		const pending = defer();
		const nextOrigin = change === 'instance' ? 'https://next.example' : INSTANCE;
		saveSettings.mockImplementationOnce(async () => {
			await pending.promise;
			getSettings.mockResolvedValue({ instanceOrigin: nextOrigin });
			getConnectionStatus.mockResolvedValue({ mode: 'offline' });
		});
		const first = send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: nextOrigin, connection: { mode: 'offline' } });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
		const toggle = send({
			type: MESSAGE.SAVE_INSTANCE,
			instanceOrigin: INSTANCE,
			connection: { mode: 'offline' },
			expectedConnection: { instanceOrigin: INSTANCE, mode: 'session' },
		});
		pending.resolve();
		expect(await first).toMatchObject({ ok: true });
		expect(await toggle).toMatchObject({ ok: false, error: { code: 'REQUEST_EXPIRED' } });
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(clearOfflineSource).toHaveBeenCalledTimes(change === 'instance' ? 1 : 0);
	});

	it('preserves explicit editor saves without an expected connection', async () => {
		getConnectionStatus.mockResolvedValue({ mode: 'offline' });
		expect(
			await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://next.example', connection: { mode: 'offline' } }),
		).toMatchObject({ ok: true });
		expect(getConnectionStatus).not.toHaveBeenCalled();
		expect(saveSettings).toHaveBeenCalledExactlyOnceWith('https://next.example', { mode: 'offline' });
	});

	it.each([
		['switching instances', 'https://next.example', { mode: 'offline' }],
		['disabling offline mode', INSTANCE, { mode: 'session' }],
	])('does not save a connection when clearing old secrets fails while %s', async (_, instanceOrigin, connection) => {
		clearOfflineSource.mockRejectedValueOnce(new Error('Storage unavailable'));
		expect(await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin, connection })).toMatchObject({ ok: false });
		expect(saveSettings).not.toHaveBeenCalled();
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
	});

	it('removes old secrets before persisting a replacement connection', async () => {
		const pending = defer();
		clearOfflineSource.mockReturnValueOnce(pending.promise);
		const saving = send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://next.example', connection: { mode: 'offline' } });
		await vi.waitFor(() => expect(clearOfflineSource).toHaveBeenCalledOnce());
		expect(saveSettings).not.toHaveBeenCalled();
		pending.resolve();
		expect(await saving).toMatchObject({ ok: true });
		expect(saveSettings).toHaveBeenCalledOnce();
	});

	it('refreshes the current authorized renderers after explicitly reconnecting the same instance', async () => {
		expect(await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: INSTANCE, connection: { mode: 'session' } })).toMatchObject({
			ok: true,
		});
		expect(reconcileAutofillScripts).toHaveBeenCalledExactlyOnceWith({ refreshCurrent: true });
		expect(reconcileSourceWatcher).toHaveBeenLastCalledWith({ refreshCurrent: true });
	});
});

describe('shared automatic site permission lifecycle', () => {
	it.each([undefined, null, '', 'login', '/login?token=secret'])(
		'rejects a direct site change without a canonical path: %s',
		async (targetPath) => {
			expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, targetPath, enabled: true })).toMatchObject({
				ok: false,
				error: { code: 'INVALID_REQUEST' },
			});
			expect(sites.setAutofillSite).not.toHaveBeenCalled();
		},
	);

	it.each(['expected target', 'tab path', 'document path'])(
		'rejects a changed route before saving direct authorization: %s',
		async (change) => {
			const expectedTarget = { tabId: 10, documentId: 'doc-10', origin: TARGET, targetPath: PATH };
			if (change === 'expected target') {
				expectedTarget.targetPath = '/settings';
			}
			if (change === 'tab path') {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/settings` });
			}
			if (change === 'document path') {
				workflow.sendDocumentMessage.mockResolvedValue({ ok: true, origin: TARGET, targetPath: '/settings' });
			}
			expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true, expectedTarget })).toMatchObject({
				ok: false,
				error: { code: 'TARGET_CHANGED' },
			});
			expect(sites.setAutofillSite).not.toHaveBeenCalled();
		},
	);

	it('rolls back only a newly added path if script registration fails, preserving a sibling path', async () => {
		sites.readAutofillSites.mockResolvedValue([{ ...SITE, targetPath: '/settings' }]);
		reconcileAutofillScripts.mockRejectedValueOnce(new Error('Registration failed'));
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true })).toMatchObject({
			ok: false,
			error: { code: 'AUTO_UNAVAILABLE' },
		});
		expect(sites.setAutofillSite.mock.calls).toEqual([
			[INSTANCE, TARGET, PATH, true],
			[INSTANCE, TARGET, PATH, false],
		]);
	});

	it('keeps an existing exact-path authorization when a registration refresh fails', async () => {
		sites.readAutofillSites.mockResolvedValue([SITE]);
		reconcileAutofillScripts.mockRejectedValueOnce(new Error('Registration failed'));
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true })).toMatchObject({
			ok: false,
			error: { code: 'AUTO_UNAVAILABLE' },
		});
		expect(sites.setAutofillSite).toHaveBeenCalledExactlyOnceWith(INSTANCE, TARGET, PATH, true);
	});

	it('still prunes revoked policies and source secrets when permission-intent cleanup fails', async () => {
		authorization.clearAutofillAuthorization.mockRejectedValueOnce(new Error('session unavailable'));
		onPermissionsRemoved({ origins: [`${INSTANCE}/*`, `${TARGET}/*`] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledExactlyOnceWith([`${INSTANCE}/*`, `${TARGET}/*`]);
		expect(clearOfflineSource).toHaveBeenCalledOnce();
		expect(reconcileAutofillScripts).toHaveBeenCalledOnce();
	});
	it.each(['pending flow', 'site preferences'])('clears source secrets even when revocation cleanup of %s fails', async (stage) => {
		if (stage === 'pending flow') {
			clearPendingFlow.mockRejectedValueOnce(new Error('session unavailable'));
		} else {
			sites.pruneRevokedAutofillSites.mockRejectedValueOnce(new Error('local storage unavailable'));
		}
		onPermissionsRemoved({ origins: [`${INSTANCE}/*`] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(clearOfflineSource).toHaveBeenCalledOnce();
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledOnce();
		expect(reconcileAutofillScripts).toHaveBeenCalledOnce();
	});
	it.each(['settings', 'permissions'])('clears source secrets if revoked access cannot be checked via %s', async (stage) => {
		if (stage === 'settings') {
			getSettings.mockRejectedValueOnce(new Error('settings unavailable'));
		} else {
			chrome.permissions.contains.mockRejectedValueOnce(new Error('permissions unavailable'));
		}
		onPermissionsRemoved({ origins: [`${TARGET}/*`] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(clearOfflineSource).toHaveBeenCalledOnce();
		expect(reconcileAutofillScripts).toHaveBeenCalledOnce();
	});
	it('finishes a retained permission intent on an added-host event without requiring a popup message', async () => {
		authorization.completeAutofillAuthorization.mockClear();
		onPermissionsAdded({ origins: ['http://172.16.0.10/*'] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(authorization.completeAutofillAuthorization).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(Function));
		expect(reconcileAutofillScripts).toHaveBeenCalled();
	});

	it('routes explicit authorization intent management only from trusted pages', async () => {
		authorization.completeAutofillAuthorization.mockClear();
		for (const type of [
			MESSAGE.BEGIN_AUTOFILL_AUTHORIZATION,
			MESSAGE.COMPLETE_AUTOFILL_AUTHORIZATION,
			MESSAGE.CANCEL_AUTOFILL_AUTHORIZATION,
		]) {
			const respond = vi.fn();
			expect(onMessage({ type, requestId: 'a'.repeat(36) }, { id: chrome.runtime.id, url: TARGET }, respond)).toBe(false);
			expect(respond).not.toHaveBeenCalled();
			await send({ type, requestId: 'a'.repeat(36) });
		}
		expect(authorization.beginAutofillAuthorization).toHaveBeenCalledOnce();
		expect(authorization.completeAutofillAuthorization).toHaveBeenCalledOnce();
		expect(authorization.cancelAutofillAuthorization).toHaveBeenCalledOnce();
	});

	it.each([MESSAGE.SAVE_INSTANCE, MESSAGE.SET_AUTOFILL_SITE, MESSAGE.CLEAR_OFFLINE])(
		'does not mutate configuration when intent cancellation fails: %s',
		async (type) => {
			authorization.clearAutofillAuthorization.mockRejectedValueOnce(new Error('storage unavailable'));
			expect(await send({ type, instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath: PATH, enabled: false })).toMatchObject({
				ok: false,
			});
			expect(saveSettings).not.toHaveBeenCalled();
			expect(sites.setAutofillSite).not.toHaveBeenCalled();
			expect(workflow.disableOfflineCache).not.toHaveBeenCalled();
		},
	);
	it.each([true, false])('releases an HTTPS private target grant only when no exact-port policy still uses it (%s)', async (inUse) => {
		sites.isPermissionPatternInUse.mockResolvedValue(inUse);
		expect(
			await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, targetOrigin: 'https://172.16.0.10:8080', enabled: false }),
		).toMatchObject({ ok: true });
		expect(sites.isPermissionPatternInUse).toHaveBeenCalledWith('https://172.16.0.10/*', INSTANCE);
		if (inUse) {
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		} else {
			expect(chrome.permissions.remove).toHaveBeenCalledExactlyOnceWith({ origins: ['https://172.16.0.10/*'] });
		}
		expect(clearOfflineSource).not.toHaveBeenCalled();
	});
	it('keeps the revocation fact when a host is regranted while configuration work is queued', async () => {
		const pending = defer();
		sites.setAutofillSite.mockReturnValueOnce(pending.promise);
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		await vi.waitFor(() => expect(sites.setAutofillSite).toHaveBeenCalledOnce());
		const origins = [`${INSTANCE}/*`, `${TARGET}/*`];
		onPermissionsRemoved({ origins });
		// Current contains() already returns true after the user's rapid regrant.
		const reading = send({ type: MESSAGE.GET_AUTOFILL_SITES });
		pending.resolve([SITE]);
		await Promise.all([changed, reading]);
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledExactlyOnceWith(origins);
		expect(clearOfflineSource).toHaveBeenCalledOnce();
	});
	it('still stops automatic runners when the browser refuses removal of a managed host grant', async () => {
		chrome.permissions.remove.mockRejectedValue(new Error('Cannot remove required permission'));
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: false })).toMatchObject({ ok: true });
		expect(sites.setAutofillSite).toHaveBeenCalledWith(INSTANCE, TARGET, PATH, false);
		expect(reconcileAutofillScripts).toHaveBeenCalledOnce();
	});
	it('rolls back newly enabled policy when script registration fails', async () => {
		reconcileAutofillScripts.mockRejectedValueOnce(new Error('Registration failed'));
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true })).toMatchObject({
			ok: false,
			error: { code: 'AUTO_UNAVAILABLE' },
		});
		expect(sites.setAutofillSite).toHaveBeenLastCalledWith(INSTANCE, TARGET, PATH, false);
		expect(reconcileAutofillScripts).toHaveBeenCalledTimes(2);
	});
	it('checks the actual document before saving a popup authorization', async () => {
		const expectedTarget = { tabId: 10, documentId: 'doc-10', origin: TARGET, targetPath: PATH };
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true, expectedTarget })).toMatchObject({ ok: true });
		expect(workflow.sendDocumentMessage).toHaveBeenCalledWith(10, 'doc-10', { type: MESSAGE.TARGET_PING }, 'TARGET_CHANGED');
	});
	it('rejects a popup authorization after navigation before writing policy', async () => {
		chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/login`, pendingUrl: 'https://other.example' });
		const expectedTarget = { tabId: 10, documentId: 'doc-10', origin: TARGET, targetPath: PATH };
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true, expectedTarget })).toMatchObject({
			ok: false,
			error: { code: 'TARGET_CHANGED' },
		});
		expect(sites.setAutofillSite).not.toHaveBeenCalled();
	});
	it.each([true, false])('retains an old instance permission only when the new configuration uses it (%s)', async (inUse) => {
		sites.isPermissionPatternInUse.mockResolvedValue(inUse);
		expect(await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: 'https://new.example' })).toMatchObject({ ok: true });
		expect(sites.isPermissionPatternInUse).toHaveBeenCalledWith('https://configured.example/*', 'https://new.example');
		if (inUse) {
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		} else {
			expect(chrome.permissions.remove).toHaveBeenCalledExactlyOnceWith({ origins: ['https://configured.example/*'] });
		}
	});

	it('keeps the host permission when switching the instance to another port on the same host', async () => {
		expect(await send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: `${INSTANCE}:8443` })).toMatchObject({ ok: true });
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
	});

	it.each([true, false])('releases a disabled target permission only when no active source or target needs it (%s)', async (inUse) => {
		sites.isPermissionPatternInUse.mockResolvedValue(inUse);
		expect(await send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, targetOrigin: `${TARGET}:8443`, enabled: false })).toMatchObject({
			ok: true,
		});
		expect(sites.isPermissionPatternInUse).toHaveBeenCalledWith('https://login.example/*', INSTANCE);
		if (inUse) {
			expect(chrome.permissions.remove).not.toHaveBeenCalled();
		} else {
			expect(chrome.permissions.remove).toHaveBeenCalledExactlyOnceWith({ origins: ['https://login.example/*'] });
		}
		expect(clearOfflineSource).not.toHaveBeenCalled();
	});

	it('immediately invalidates work on target revocation but keeps offline source secrets when source access remains', async () => {
		onPermissionsRemoved({ origins: ['https://login.example/*'] });
		expect(invalidateConfigurationGeneration).toHaveBeenCalledOnce();
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(clearPendingFlow).toHaveBeenCalled();
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledExactlyOnceWith([`${TARGET}/*`]);
		expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://configured.example/*'] });
		expect(clearOfflineSource).not.toHaveBeenCalled();
	});

	it('clears offline source secrets when source permission is actually missing', async () => {
		chrome.permissions.contains.mockResolvedValue(false);
		onPermissionsRemoved({ origins: ['https://configured.example/*'] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(clearOfflineSource).toHaveBeenCalledOnce();
		expect(clearPendingFlow).toHaveBeenCalledOnce();
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledOnce();
	});

	it('clears any stale offline source when permission cleanup finds no configured instance', async () => {
		getSettings.mockResolvedValue({ instanceOrigin: null });
		onPermissionsRemoved({ origins: ['https://login.example/*'] });
		await send({ type: MESSAGE.GET_AUTOFILL_SITES });
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledOnce();
		expect(clearOfflineSource).toHaveBeenCalledOnce();
		expect(chrome.permissions.contains).not.toHaveBeenCalled();
	});

	it('queues revocation cleanup behind an unfinished site write and prevents later reads overtaking cleanup', async () => {
		const pending = defer();
		sites.setAutofillSite.mockReturnValueOnce(pending.promise);
		const changed = send({ type: MESSAGE.SET_AUTOFILL_SITE, ...SITE, enabled: true });
		await vi.waitFor(() => expect(sites.setAutofillSite).toHaveBeenCalledOnce());
		onPermissionsRemoved({ origins: ['https://login.example/*'] });
		expect(invalidateConfigurationGeneration).toHaveBeenCalledTimes(2);
		const reading = send({ type: MESSAGE.GET_AUTOFILL_SITES });
		await Promise.resolve();
		await Promise.resolve();
		expect(sites.pruneRevokedAutofillSites).not.toHaveBeenCalled();
		expect(sites.readAutofillSites).toHaveBeenCalledTimes(1); // Only the writer's rollback snapshot.
		pending.resolve([SITE]);
		await Promise.all([changed, reading]);
		expect(sites.pruneRevokedAutofillSites).toHaveBeenCalledOnce();
		expect(sites.pruneRevokedAutofillSites.mock.invocationCallOrder[0]).toBeLessThan(sites.readAutofillSites.mock.invocationCallOrder[1]);
	});
});

describe('cached image management boundary', () => {
	it.each(['popup.html', 'options.html'])('serves local icons to %s using current settings only', async (page) => {
		const data = { instanceOrigin: INSTANCE, serviceIcons: { 'github.com': 'data:image/png;base64,aA==' } };
		workflow.getOfflineCacheIcons.mockResolvedValue(data);
		expect(await send({ type: MESSAGE.OFFLINE_ICONS, instanceOrigin: 'https://evil.example' }, page)).toEqual({ ok: true, data });
		expect(workflow.getOfflineCacheIcons).toHaveBeenCalledExactlyOnceWith();
		expect(workflow.startFlow).not.toHaveBeenCalled();
	});
	it.each([INSTANCE + '/', TARGET + '/', 'chrome-extension://extension-id.evil/popup.html'])('rejects image reads from %s', (url) => {
		const respond = vi.fn();
		expect(onMessage({ type: MESSAGE.OFFLINE_ICONS }, { id: chrome.runtime.id, url }, respond)).toBe(false);
		expect(workflow.getOfflineCacheIcons).not.toHaveBeenCalled();
	});
	it('immediately cancels offline network work when configuration or permission changes before queued mutations', async () => {
		const result = send({ type: MESSAGE.SAVE_INSTANCE, instanceOrigin: INSTANCE, connection: { mode: 'session' } });
		expect(cancelOfflineRequests).toHaveBeenCalledOnce();
		await result;
		onPermissionsRemoved({ origins: [INSTANCE + '/*'] });
		expect(cancelOfflineRequests).toHaveBeenCalledTimes(2);
		await send({ type: MESSAGE.START_FLOW });
	});
});
