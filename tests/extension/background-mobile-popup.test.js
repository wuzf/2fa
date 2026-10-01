import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTotpCode, listTotpAccounts } from '../../extension/src/bridge/api.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';
import { fillAccount, startFlow } from '../../extension/src/background/workflow.js';
import { invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';

vi.mock('../../extension/src/bridge/api.js', async (importOriginal) => ({
	...(await importOriginal()),
	generateTotpCode: vi.fn(),
	listTotpAccounts: vi.fn(),
}));

const INSTANCE = 'https://twofa.example';
const TARGET = 'https://login.example';
const ACCOUNT = { id: 'account-id', name: 'Example', account: 'user@example.com', type: 'TOTP', digits: 6 };

function storageArea(initial = {}) {
	const values = structuredClone(initial);
	const writes = [];
	return {
		values,
		writes,
		get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })),
		set: vi.fn(async (entries) => {
			writes.push(structuredClone(entries));
			Object.assign(values, structuredClone(entries));
		}),
		remove: vi.fn(async (key) => delete values[key]),
	};
}

function installBrowser() {
	const local = storageArea({
		settings: { instanceOrigin: INSTANCE },
		autofillSites: [{ instanceOrigin: INSTANCE, targetOrigin: TARGET, targetPath: '/challenge' }],
		bindings: [{ instanceOrigin: INSTANCE, targetOrigin: TARGET, accountId: ACCOUNT.id }],
	});
	const session = storageArea();
	const tab = { id: 10, url: `${TARGET}/challenge`, active: true, incognito: false };
	const popup = {
		location: { href: 'moz-extension://extension-id/popup.html' },
		document: { visibilityState: 'visible', hasFocus: vi.fn(() => true), documentElement: { dataset: {} } },
	};
	const page = { hidden: true, prepared: null };
	globalThis.chrome = {
		runtime: {
			getPlatformInfo: vi.fn(async () => ({ os: 'android' })),
			getURL: (path) => `moz-extension://extension-id/${path}`,
		},
		extension: { getViews: vi.fn(() => [popup]) },
		storage: { local, session },
		permissions: { contains: vi.fn(async () => true) },
		tabs: {
			query: vi.fn(async () => [{ ...tab }]),
			get: vi.fn(async () => ({ ...tab })),
			sendMessage: vi.fn(async (_tabId, message) => {
				if (message.type === MESSAGE.TARGET_PING) {
					return { ok: true, origin: TARGET, targetPath: '/challenge' };
				}
				if (message.type === MESSAGE.PREPARE_TARGET) {
					if (page.hidden && message.allowHiddenTarget !== true) {
						return { ok: false, error: { code: 'TARGET_UNAVAILABLE' } };
					}
					page.prepared = message;
					return { ok: true, status: 'ready' };
				}
				if (message.type === MESSAGE.FILL_CODE) {
					if (page.hidden && (message.allowHiddenTarget !== true || page.prepared?.allowHiddenTarget !== true)) {
						return { ok: false, error: { code: 'TARGET_UNAVAILABLE' } };
					}
					return { ok: true, status: 'filled' };
				}
				throw new Error(`Unexpected message: ${message.type}`);
			}),
		},
		scripting: { executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'target-document' }]) },
	};
	listTotpAccounts.mockReset().mockResolvedValue([ACCOUNT]);
	generateTotpCode.mockReset().mockImplementation(async () => ({
		generatedAt: Date.now(),
		code: '012345',
		digits: 6,
		period: 30,
		remainingMs: 30000,
	}));
	return { local, session, tab, popup, page };
}

function messages(type) {
	return chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === type);
}

async function manualFlow(browser) {
	const flow = await startFlow();
	browser.popup.document.documentElement.dataset.manualFillNonce = flow.nonce;
	return flow;
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	delete globalThis.chrome;
});

describe('Firefox Android manual popup filling', () => {
	it('prepares and fills the captured hidden document only while its manual popup action is live', async () => {
		const browser = installBrowser();
		const flow = await manualFlow(browser);
		await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT })).resolves.toEqual({ status: 'filled', targetOrigin: TARGET });
		for (const type of [MESSAGE.PREPARE_TARGET, MESSAGE.FILL_CODE]) {
			expect(messages(type)).toHaveLength(1);
			expect(messages(type)[0]).toEqual([
				10,
				expect.objectContaining({ type, nonce: flow.nonce, allowHiddenTarget: true }),
				{ frameId: 0, documentId: 'target-document' },
			]);
		}
		expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(browser.session.writes)).not.toContain('allowHiddenTarget');
		expect(browser.session.values.pendingFlow).toBeUndefined();
	});

	it.each(['missing nonce', 'desktop', 'no popup API', 'Chromium'])('does not allow hidden filling with %s', async (state) => {
		const browser = installBrowser();
		const flow = await manualFlow(browser);
		if (state === 'missing nonce') {
			delete browser.popup.document.documentElement.dataset.manualFillNonce;
		} else if (state === 'desktop') {
			chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'linux' });
		} else if (state === 'no popup API') {
			delete chrome.extension;
		} else {
			chrome.runtime.getURL = (path) => `chrome-extension://extension-id/${path}`;
			browser.popup.location.href = chrome.runtime.getURL('popup.html');
		}
		await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT, allowHiddenTarget: true })).rejects.toMatchObject({
			code: 'TARGET_UNAVAILABLE',
		});
		expect(messages(MESSAGE.PREPARE_TARGET)[0][1]).not.toHaveProperty('allowHiddenTarget');
		expect(generateTotpCode).not.toHaveBeenCalled();
		expect(messages(MESSAGE.FILL_CODE)).toHaveLength(0);
	});

	it.each([false, true])('does not grant popup hidden access to automatic fills when the target hidden state is %s', async (hidden) => {
		const browser = installBrowser();
		browser.page.hidden = hidden;
		const flow = await manualFlow(browser);
		expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
		const operation = fillAccount({ nonce: flow.nonce, account: ACCOUNT, automatic: true, allowHiddenTarget: true });
		if (hidden) {
			await expect(operation).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
		} else {
			await expect(operation).resolves.toMatchObject({ status: 'filled' });
		}
		expect(chrome.runtime.getPlatformInfo).not.toHaveBeenCalled();
		expect(chrome.extension.getViews).not.toHaveBeenCalled();
		for (const [, message] of [...messages(MESSAGE.PREPARE_TARGET), ...messages(MESSAGE.FILL_CODE)]) {
			expect(message).not.toHaveProperty('allowHiddenTarget');
		}
	});

	it('keeps ordinary visible manual filling available without mobile popup APIs', async () => {
		const browser = installBrowser();
		browser.page.hidden = false;
		delete chrome.runtime.getPlatformInfo;
		delete chrome.extension;
		const flow = await startFlow();
		await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT })).resolves.toMatchObject({ status: 'filled' });
		for (const [, message] of [...messages(MESSAGE.PREPARE_TARGET), ...messages(MESSAGE.FILL_CODE)]) {
			expect(message).not.toHaveProperty('allowHiddenTarget');
		}
	});

	it('cancels preparation when the popup closes after the initial hidden-target check', async () => {
		const browser = installBrowser();
		const flow = await manualFlow(browser);
		chrome.runtime.getPlatformInfo.mockResolvedValueOnce({ os: 'android' }).mockImplementation(async () => {
			chrome.extension.getViews.mockReturnValue([]);
			return { os: 'android' };
		});
		await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(messages(MESSAGE.PREPARE_TARGET)).toHaveLength(0);
		expect(generateTotpCode).not.toHaveBeenCalled();
	});

	it.each(['closed', 'hidden', 'unfocused', 'nonce changed', 'inactive target'])(
		'cancels an already prepared hidden fill when its popup is %s during code generation',
		async (state) => {
			const browser = installBrowser();
			const flow = await manualFlow(browser);
			const generate = generateTotpCode.getMockImplementation();
			generateTotpCode.mockImplementation(async (...args) => {
				const result = await generate(...args);
				if (state === 'closed') {
					chrome.extension.getViews.mockReturnValue([]);
				} else if (state === 'hidden') {
					browser.popup.document.visibilityState = 'hidden';
				} else if (state === 'unfocused') {
					browser.popup.document.hasFocus.mockReturnValue(false);
				} else if (state === 'nonce changed') {
					browser.popup.document.documentElement.dataset.manualFillNonce = 'another-action';
				} else {
					browser.tab.active = false;
				}
				// Becoming visible must not let an already flagged flow silently downgrade.
				browser.page.hidden = false;
				return result;
			});
			await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
			expect(messages(MESSAGE.PREPARE_TARGET)[0][1].allowHiddenTarget).toBe(true);
			expect(generateTotpCode).toHaveBeenCalledOnce();
			expect(messages(MESSAGE.FILL_CODE)).toHaveLength(0);
		},
	);

	it.each(['popup closed', 'target inactive', 'configuration changed'])(
		'rechecks mobile access after consuming the claim when %s',
		async (state) => {
			const browser = installBrowser();
			const flow = await manualFlow(browser);
			const remove = browser.session.remove.getMockImplementation();
			browser.session.remove.mockImplementationOnce(async (key) => {
				await remove(key);
				if (state === 'popup closed') {
					chrome.extension.getViews.mockReturnValue([]);
				} else if (state === 'target inactive') {
					browser.tab.active = false;
				} else {
					invalidateConfigurationGeneration();
				}
			});
			await expect(fillAccount({ nonce: flow.nonce, account: ACCOUNT })).rejects.toMatchObject({
				code: state === 'configuration changed' ? 'REQUEST_EXPIRED' : 'TARGET_CHANGED',
			});
			expect(messages(MESSAGE.FILL_CODE)).toHaveLength(0);
		},
	);
});
