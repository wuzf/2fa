import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	getConnectionStatus: vi.fn(),
	readAutofillSites: vi.fn(),
	getOfflineSourceRevision: vi.fn(),
	getOfflineClockRevision: vi.fn(),
	markOfflineSourceDirty: vi.fn(),
	onOfflineSourceChange: vi.fn(),
	onOfflineIconsChange: vi.fn(),
	invalidateAutomaticFlows: vi.fn(),
	validateFlowConfiguration: vi.fn(),
	refreshOfflineAccounts: vi.fn(),
	sendDocumentMessage: vi.fn(),
}));
vi.mock('../../extension/src/shared/storage.js', () => mocks);
vi.mock('../../extension/src/shared/autofill-sites.js', () => mocks);
vi.mock('../../extension/src/background/offline-source.js', () => mocks);
vi.mock('../../extension/src/background/automatic-workflow.js', () => mocks);
vi.mock('../../extension/src/background/workflow.js', () => ({
	...mocks,
	ExtensionError: class extends Error {
		constructor(code) {
			super(code);
			this.code = code;
		}
	},
}));

const SOURCE = 'https://vault.example';
const TARGET = 'https://github.com';
let api;
let listener;
let iconListener;
let sender;
beforeEach(async () => {
	vi.resetModules();
	Object.values(mocks).forEach((mock) => mock.mockReset());
	mocks.getSettings.mockResolvedValue({ instanceOrigin: SOURCE });
	mocks.getConnectionStatus.mockResolvedValue({ mode: 'offline' });
	mocks.readAutofillSites.mockResolvedValue([{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: '/' }]);
	mocks.getOfflineSourceRevision.mockReturnValue('data-1');
	mocks.getOfflineClockRevision.mockReturnValue('clock-1');
	mocks.onOfflineSourceChange.mockImplementation((callback) => {
		listener = callback;
		return vi.fn();
	});
	mocks.onOfflineIconsChange.mockImplementation((callback) => {
		iconListener = callback;
		return vi.fn();
	});
	mocks.refreshOfflineAccounts.mockResolvedValue({ available: true });
	mocks.sendDocumentMessage.mockResolvedValue({ ok: true, origin: SOURCE });
	sender = { id: 'ext', url: SOURCE, tab: { id: 1 }, frameId: 0, documentId: 'source-doc' };
	globalThis.chrome = {
		runtime: { id: 'ext', sendMessage: vi.fn(async () => {}) },
		permissions: { contains: vi.fn(async () => true) },
		tabs: {
			get: vi.fn(async () => ({ id: 1, url: SOURCE })),
			query: vi.fn(async () => [{ id: 2, url: TARGET }]),
			sendMessage: vi.fn(async () => {}),
		},
	};
	api = await import('../../extension/src/background/source-updates.js');
});
afterEach(() => {
	delete globalThis.chrome;
});

it('only enables a current authorized offline source document without fetching accounts', async () => {
	expect(await api.routeSourceMessage({ type: MESSAGE.SOURCE_STATUS }, sender)).toEqual({ enabled: true });
	expect(mocks.sendDocumentMessage).toHaveBeenCalledWith(1, 'source-doc', { type: MESSAGE.SOURCE_PING }, 'TARGET_CHANGED');
	expect(mocks.refreshOfflineAccounts).not.toHaveBeenCalled();
});
it.each([
	{ id: 'other' },
	{ url: TARGET },
	{ url: SOURCE + ':8443' },
	{ frameId: 1 },
	{ documentId: '' },
	{ tab: { id: 1, incognito: true } },
	{ documentLifecycle: 'prerender' },
])('ignores unsupported source context %j', async (change) => {
	const from = { ...sender, ...change };
	expect(await api.routeSourceMessage({ type: MESSAGE.SOURCE_STATUS }, from)).toEqual({ enabled: false });
	await expect(api.routeSourceMessage({ type: MESSAGE.SOURCE_DIRTY }, from)).rejects.toBeInstanceOf(Error);
	expect(mocks.markOfflineSourceDirty).not.toHaveBeenCalled();
});
it('does not activate source watching for session mode', async () => {
	mocks.getConnectionStatus.mockResolvedValue({ mode: 'session' });
	expect(await api.routeSourceMessage({ type: MESSAGE.SOURCE_STATUS }, sender)).toEqual({ enabled: false });
});
it('rejects a source that navigates before the hint is validated', async () => {
	chrome.tabs.get.mockResolvedValue({ id: 1, url: SOURCE, pendingUrl: 'https://other.example' });
	await expect(api.routeSourceMessage({ type: MESSAGE.SOURCE_DIRTY }, sender)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
	expect(mocks.refreshOfflineAccounts).not.toHaveBeenCalled();
});
it('treats source messages only as hints and fetches the bound source itself', async () => {
	await api.routeSourceMessage({ type: MESSAGE.SOURCE_DIRTY, instanceOrigin: TARGET, data: [{ secret: 'untrusted' }] }, sender);
	expect(mocks.invalidateAutomaticFlows).toHaveBeenCalledOnce();
	expect(mocks.markOfflineSourceDirty).toHaveBeenCalledExactlyOnceWith(SOURCE);
	expect(mocks.refreshOfflineAccounts).toHaveBeenCalledExactlyOnceWith(SOURCE);
});
it('coalesces simultaneous hints and follows a hint received during the first refresh', async () => {
	let finish;
	mocks.refreshOfflineAccounts.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const first = api.routeSourceMessage({ type: MESSAGE.SOURCE_DIRTY }, sender);
	await vi.waitFor(() => expect(mocks.refreshOfflineAccounts).toHaveBeenCalledOnce());
	const second = api.routeSourceMessage({ type: MESSAGE.SOURCE_DIRTY }, sender);
	await vi.waitFor(() => expect(mocks.markOfflineSourceDirty).toHaveBeenCalledTimes(2));
	expect(mocks.refreshOfflineAccounts).toHaveBeenCalledOnce();
	finish();
	await Promise.all([first, second]);
	expect(mocks.refreshOfflineAccounts).toHaveBeenCalledTimes(2);
});
it('notifies only trusted UI and exact enabled destinations with metadata', async () => {
	chrome.tabs.query.mockResolvedValue([
		{ id: 2, url: TARGET },
		{ id: 3, url: TARGET + ':8443' },
		{ id: 4, url: 'https://unrelated.example' },
		{ id: 5, url: TARGET, incognito: true },
		{ id: 6, url: TARGET, pendingUrl: TARGET + '/next' },
		{ id: 7, url: TARGET + '/unauthorized' },
		{ id: 8, url: TARGET + '/#/unauthorized' },
	]);
	api.startSourceUpdates();
	listener({ instanceOrigin: SOURCE, revision: 'data-1', clockRevision: 'clock-1', data: 'must not escape' });
	await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledOnce());
	const message = { type: MESSAGE.ACCOUNTS_CHANGED, instanceOrigin: SOURCE, revision: 'data-1', clockRevision: 'clock-1' };
	expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith(message);
	expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(2, message, { frameId: 0 });
});
it('notifies an HTTPS private target using its host grant while retaining exact port and source scope', async () => {
	const target = 'https://172.16.0.10:8080';
	mocks.readAutofillSites.mockResolvedValue([{ instanceOrigin: SOURCE, targetOrigin: target, targetPath: '/login' }]);
	chrome.tabs.query.mockResolvedValue([
		{ id: 2, url: `${target}/login` },
		{ id: 3, url: 'https://172.16.0.10:8081' },
		{ id: 4, url: 'http://172.16.0.10:8080' },
		{ id: 5, url: 'https://172.16.0.11:8080' },
	]);
	api.startSourceUpdates();
	listener({ instanceOrigin: SOURCE, revision: 'data-1', clockRevision: 'clock-1' });
	await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledOnce());
	expect(chrome.permissions.contains).toHaveBeenCalledExactlyOnceWith({ origins: ['https://172.16.0.10/*'] });
	expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(
		2,
		{
			type: MESSAGE.ACCOUNTS_CHANGED,
			instanceOrigin: SOURCE,
			revision: 'data-1',
			clockRevision: 'clock-1',
		},
		{ frameId: 0 },
	);
	expect(mocks.readAutofillSites).toHaveBeenCalledWith(SOURCE);
	expect(await api.routeSourceMessage({ type: MESSAGE.SOURCE_STATUS }, { ...sender, url: target })).toEqual({ enabled: false });
	expect(mocks.refreshOfflineAccounts).not.toHaveBeenCalled();
});
it.each(['instance', 'revision', 'clock'])('discards an obsolete %s notification', async (kind) => {
	if (kind === 'instance') {
		mocks.getSettings.mockResolvedValue({ instanceOrigin: 'https://other.example' });
	}
	if (kind === 'revision') {
		mocks.getOfflineSourceRevision.mockReturnValue('data-2');
	}
	if (kind === 'clock') {
		mocks.getOfflineClockRevision.mockReturnValue('clock-2');
	}
	api.startSourceUpdates();
	listener({ instanceOrigin: SOURCE, revision: 'data-1', clockRevision: 'clock-1' });
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
	expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

it('sends icon-only metadata to extension UI without notifying target tabs or exposing supplied data', async () => {
	api.startSourceUpdates();
	iconListener({ instanceOrigin: SOURCE, serviceIcons: 'private', data: 'must not escape' });
	await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce());
	expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: MESSAGE.ICONS_CHANGED, instanceOrigin: SOURCE });
	expect(chrome.tabs.query).not.toHaveBeenCalled();
	expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});
it.each(['mode', 'configuration'])('suppresses obsolete icon notifications after %s changes', async (change) => {
	api.startSourceUpdates();
	if (change === 'mode') {
		mocks.getConnectionStatus.mockResolvedValue({ mode: 'session' });
	}
	if (change === 'configuration') {
		mocks.validateFlowConfiguration.mockRejectedValue(new Error('REQUEST_EXPIRED'));
	}
	iconListener({ instanceOrigin: SOURCE });
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
	expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
