import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	getConnectionStatus: vi.fn(),
	readAutofillSites: vi.fn(),
	getConfigurationGeneration: vi.fn(),
	sendDocumentMessage: vi.fn(),
}));
vi.mock('../../extension/src/shared/storage.js', () => mocks);
vi.mock('../../extension/src/shared/autofill-sites.js', () => mocks);
vi.mock('../../extension/src/background/generation.js', () => mocks);
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
const TARGET = 'http://172.16.0.10:8080';
const PATH = '/login';
const KEY = 'autofillAuthorization';
let api;
let values;
let granted;
let generation;
let message;
let enable;
let sites;

beforeEach(async () => {
	vi.resetModules();
	Object.values(mocks).forEach((mock) => mock.mockReset());
	values = {};
	granted = false;
	generation = 'a'.repeat(36);
	sites = [];
	mocks.getSettings.mockResolvedValue({ instanceOrigin: SOURCE });
	mocks.getConnectionStatus.mockResolvedValue({ mode: 'offline' });
	mocks.getConfigurationGeneration.mockImplementation(() => generation);
	mocks.sendDocumentMessage.mockResolvedValue({ ok: true, origin: TARGET, targetPath: PATH });
	mocks.readAutofillSites.mockImplementation(async () => structuredClone(sites));
	globalThis.chrome = {
		storage: {
			session: {
				get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })),
				set: vi.fn(async (data) => Object.assign(values, structuredClone(data))),
				remove: vi.fn(async (key) => {
					delete values[key];
				}),
			},
		},
		permissions: { contains: vi.fn(async ({ origins }) => origins[0] === `${SOURCE}/*` || granted) },
		tabs: { get: vi.fn(async () => ({ id: 7, url: `${TARGET}/login` })) },
	};
	message = {
		requestId: 'b'.repeat(36),
		configurationGeneration: generation,
		instanceOrigin: SOURCE,
		mode: 'offline',
		targetOrigin: TARGET,
		targetPath: PATH,
		expectedTarget: { tabId: 7, documentId: 'document-7', origin: TARGET, targetPath: PATH },
	};
	enable = vi.fn(async (intent, guard) => {
		await guard();
		sites = [{ instanceOrigin: intent.instanceOrigin, targetOrigin: intent.targetOrigin, targetPath: intent.targetPath }];
		return { instanceOrigin: intent.instanceOrigin, sites };
	});
	api = await import('../../extension/src/background/autofill-authorization.js');
});
afterEach(() => {
	vi.useRealTimers();
	delete globalThis.chrome;
});

describe('site-wide grants asked for in the popup', () => {
	const ACCOUNT = { id: 'github', name: 'GitHub', account: 'alice@example.com', type: 'TOTP', digits: 6 };
	function siteMessage(extra = {}) {
		return { ...message, targetPath: '*', pagePath: PATH, ...extra };
	}
	beforeEach(() => {
		enable.mockImplementation(async (intent, guard) => {
			await guard();
			sites = [{ instanceOrigin: intent.instanceOrigin, targetOrigin: intent.targetOrigin, targetPath: '*', pagePath: intent.pagePath }];
			return { instanceOrigin: intent.instanceOrigin, sites };
		});
	});

	it('keeps the page the grant is made on and checks that page, not the marker', async () => {
		expect(await api.beginAutofillAuthorization(siteMessage(), generation, enable)).toMatchObject({ status: 'pending' });
		expect(values[KEY]).toEqual({
			requestId: message.requestId,
			instanceOrigin: SOURCE,
			mode: 'offline',
			targetOrigin: TARGET,
			targetPath: '*',
			pagePath: PATH,
			expectedTarget: message.expectedTarget,
			createdAt: expect.any(Number),
			status: 'pending',
		});
		granted = true;
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'enabled', sites });
		expect(enable).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ targetPath: '*', pagePath: PATH, enabled: true, expectedTarget: message.expectedTarget }),
			expect.any(Function),
		);
		expect(mocks.sendDocumentMessage).toHaveBeenLastCalledWith(7, 'document-7', expect.any(Object), 'TARGET_CHANGED');
	});

	it.each([
		['without a page', { pagePath: undefined }],
		['with the marker as its page', { pagePath: '*' }],
		['with a page other than the expected target', { pagePath: '/settings' }],
		['with a noncanonical page', { pagePath: '/login?token=secret' }],
	])('rejects a site-wide request %s before saving an intent', async (_label, change) => {
		await expect(api.beginAutofillAuthorization(siteMessage(change), generation, enable)).rejects.toMatchObject({
			code: 'INVALID_REQUEST',
		});
		expect(values[KEY]).toBeUndefined();
	});

	it('rejects a site-wide request after the tab left the page it was asked on', async () => {
		chrome.tabs.get.mockResolvedValue({ id: 7, url: `${TARGET}/settings` });
		await expect(api.beginAutofillAuthorization(siteMessage(), generation, enable)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(values[KEY]).toBeUndefined();
	});

	it('does not count a page grant of the origin as the enabled site-wide grant', async () => {
		granted = true;
		await api.beginAutofillAuthorization(siteMessage(), generation, enable);
		sites = [{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: PATH }];
		await expect(api.completeAutofillAuthorization(message.requestId, enable)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});

	it('keeps only the id of the account a popup fill asks to remember', async () => {
		await api.beginAutofillAuthorization(siteMessage({ rememberAccount: ACCOUNT }), generation, enable);
		expect(values[KEY]).toMatchObject({ rememberAccountId: 'github' });
		expect(JSON.stringify(values[KEY])).not.toContain('alice@example.com');
		expect(JSON.stringify(values[KEY])).not.toContain('GitHub');
		granted = true;
		await api.completeAutofillAuthorization(undefined, enable);
		expect(enable).toHaveBeenCalledWith(expect.objectContaining({ rememberAccountId: 'github' }), expect.any(Function));
	});

	it('also keeps the login email where the website tells accounts apart by it', async () => {
		const google = 'https://accounts.google.com';
		chrome.tabs.get.mockResolvedValue({ id: 7, url: `${google}/login` });
		mocks.sendDocumentMessage.mockResolvedValue({ ok: true, origin: google, targetPath: PATH });
		const request = siteMessage({
			targetOrigin: google,
			expectedTarget: { ...message.expectedTarget, origin: google },
			rememberAccount: { ...ACCOUNT, name: 'Google' },
		});
		await api.beginAutofillAuthorization(request, generation, enable);
		expect(values[KEY]).toMatchObject({ rememberAccountId: 'github', rememberAccountEmail: 'alice@example.com' });
	});

	it.each([null, 'github', { id: 'github' }, { ...ACCOUNT, type: 'HOTP' }])(
		'rejects an invalid account to remember: %j',
		async (account) => {
			await expect(api.beginAutofillAuthorization(siteMessage({ rememberAccount: account }), generation, enable)).rejects.toMatchObject({
				code: 'INVALID_REQUEST',
			});
			expect(values[KEY]).toBeUndefined();
		},
	);
});

describe('background-owned automatic-fill permission intent', () => {
	it.each([undefined, null, '', 'login', '/login?token=secret'])(
		'rejects a missing or noncanonical path before saving an intent: %s',
		async (targetPath) => {
			message.targetPath = targetPath;
			message.expectedTarget.targetPath = targetPath;
			await expect(api.beginAutofillAuthorization(message, generation, enable)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
			expect(values[KEY]).toBeUndefined();
			expect(enable).not.toHaveBeenCalled();
		},
	);

	it.each(['http://172.16.0.10:8080', 'http://192.168.1.1', 'http://10.0.0.1:8443', 'http://login.example', 'https://login.example'])(
		'authorizes automatic filling on %s after its browser permission is granted',
		async (origin) => {
			message.targetOrigin = origin;
			message.expectedTarget.origin = origin;
			chrome.tabs.get.mockResolvedValue({ id: 7, url: `${origin}/login` });
			mocks.sendDocumentMessage.mockResolvedValue({ ok: true, origin, targetPath: PATH });
			expect(await api.beginAutofillAuthorization(message, generation, enable)).toMatchObject({
				status: 'pending',
			});
			expect(enable).not.toHaveBeenCalled();
			granted = true;
			expect(await api.completeAutofillAuthorization(message.requestId, enable)).toMatchObject({ status: 'enabled' });
			expect(sites).toEqual([{ instanceOrigin: SOURCE, targetOrigin: origin, targetPath: PATH }]);
			expect(enable).toHaveBeenCalledOnce();
		},
	);

	it('does not accept the authorized origin with a different page path', async () => {
		chrome.tabs.get.mockResolvedValue({ id: 7, url: `${TARGET}/settings` });
		await expect(api.beginAutofillAuthorization(message, generation, enable)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(values[KEY]).toBeUndefined();
	});

	it.each(['top-level', 'expected target', 'both'])(
		'retires a persisted legacy intent with no %s path after a worker restart',
		async (missing) => {
			await api.beginAutofillAuthorization(message, generation, enable);
			if (missing !== 'expected target') {
				delete values[KEY].targetPath;
			}
			if (missing !== 'top-level') {
				delete values[KEY].expectedTarget.targetPath;
			}
			granted = true;
			vi.resetModules();
			api = await import('../../extension/src/background/autofill-authorization.js');
			await expect(api.completeAutofillAuthorization(undefined, enable)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
			expect(enable).not.toHaveBeenCalled();
			expect(values[KEY]).toBeUndefined();
		},
	);

	it.each(['tab route', 'document route'])('rejects same-document route changes while permission is pending: %s', async (change) => {
		await api.beginAutofillAuthorization(message, generation, enable);
		granted = true;
		if (change === 'tab route') {
			chrome.tabs.get.mockResolvedValue({ id: 7, url: `${TARGET}/settings` });
		}
		if (change === 'document route') {
			mocks.sendDocumentMessage.mockResolvedValue({ ok: true, origin: TARGET, targetPath: '/settings' });
		}
		await expect(api.completeAutofillAuthorization(undefined, enable)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(enable).not.toHaveBeenCalled();
	});

	it('allows query and ordinary anchor changes on the same authorization path', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		granted = true;
		chrome.tabs.get.mockResolvedValue({ id: 7, url: `${TARGET}/login?challenge=changed#input` });
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'enabled' });
		expect(sites).toEqual([{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: PATH }]);
	});

	it('does not let a sibling path count as an already enabled authorization', async () => {
		granted = true;
		await api.beginAutofillAuthorization(message, generation, enable);
		sites = [{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: '/settings' }];
		await expect(api.completeAutofillAuthorization(message.requestId, enable)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(enable).toHaveBeenCalledOnce();
	});

	it('survives popup loss and enables on a later permission event without reading account storage', async () => {
		expect(await api.beginAutofillAuthorization(message, generation, enable)).toMatchObject({
			status: 'pending',
			requestId: message.requestId,
		});
		expect(enable).not.toHaveBeenCalled();
		expect(Object.keys(values)).toEqual([KEY]);
		expect(values[KEY]).toEqual({
			requestId: message.requestId,
			instanceOrigin: SOURCE,
			mode: 'offline',
			targetOrigin: TARGET,
			targetPath: PATH,
			expectedTarget: message.expectedTarget,
			createdAt: expect.any(Number),
			status: 'pending',
		});
		granted = true;
		expect(await api.completeAutofillAuthorization(undefined, enable)).toEqual({
			requestId: message.requestId,
			status: 'enabled',
			instanceOrigin: SOURCE,
			sites,
		});
		expect(enable).toHaveBeenCalledOnce();
		expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['http://172.16.0.10/*'] });
	});

	it('also completes when the grant event ran before BEGIN persisted the intent', async () => {
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'cancelled' });
		granted = true;
		expect(await api.beginAutofillAuthorization(message, generation, enable)).toMatchObject({ status: 'enabled' });
		expect(enable).toHaveBeenCalledOnce();
	});

	it('returns current sites for idempotent COMPLETE and BEGIN retries without enabling twice', async () => {
		granted = true;
		await api.beginAutofillAuthorization(message, generation, enable);
		for (const result of [
			await api.completeAutofillAuthorization(message.requestId, enable),
			await api.beginAutofillAuthorization(message, generation, enable),
		]) {
			expect(result).toEqual({ requestId: message.requestId, status: 'enabled', instanceOrigin: SOURCE, sites });
		}
		expect(enable).toHaveBeenCalledOnce();
	});

	it('recovers an already accepted intent after worker restart by validating its stored source and document', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		generation = 'c'.repeat(36);
		granted = true;
		vi.resetModules();
		api = await import('../../extension/src/background/autofill-authorization.js');
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'enabled' });
		expect(mocks.sendDocumentMessage).toHaveBeenLastCalledWith(7, 'document-7', { type: 'TARGET_PING' }, 'TARGET_CHANGED');
	});

	it('rejects an old popup BEGIN after the source has changed A/B/A without relying on preview nonces', async () => {
		generation = 'c'.repeat(36);
		await expect(api.beginAutofillAuthorization(message, generation, enable)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(values[KEY]).toBeUndefined();
		expect(enable).not.toHaveBeenCalled();
	});

	it('does not revive an accepted intent after configuration invalidation and a late grant', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		await api.clearAutofillAuthorization();
		generation = 'c'.repeat(36);
		granted = true;
		vi.resetModules();
		api = await import('../../extension/src/background/autofill-authorization.js');
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'cancelled' });
		expect(enable).not.toHaveBeenCalled();
	});

	it.each(['before', 'after'])('keeps denied permission cancelled when CANCEL arrives %s BEGIN', async (when) => {
		if (when === 'after') {
			await api.beginAutofillAuthorization(message, generation, enable);
		}
		await api.cancelAutofillAuthorization(message.requestId);
		granted = true;
		if (when === 'before') {
			await api.beginAutofillAuthorization(message, generation, enable);
		}
		expect(await api.completeAutofillAuthorization(message.requestId, enable)).toMatchObject({ status: 'cancelled' });
		expect(enable).not.toHaveBeenCalled();
	});

	it('does not let a delayed denial cancel a newer request', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		await api.cancelAutofillAuthorization('d'.repeat(36));
		granted = true;
		expect(await api.completeAutofillAuthorization(message.requestId, enable)).toMatchObject({ status: 'enabled' });
	});

	it('persists a cancellation tombstone before a failed removal so a cold worker cannot revive the grant', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		chrome.storage.session.remove.mockRejectedValueOnce(new Error('remove unavailable'));
		await expect(api.clearAutofillAuthorization()).rejects.toThrow('remove unavailable');
		expect(values[KEY]).toEqual({ status: 'cancelled' });
		granted = true;
		generation = 'c'.repeat(36);
		vi.resetModules();
		api = await import('../../extension/src/background/autofill-authorization.js');
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'cancelled' });
		expect(enable).not.toHaveBeenCalled();
	});

	it('falls back to removal when cancellation storage writes fail', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		chrome.storage.session.set.mockRejectedValueOnce(new Error('write unavailable'));
		await api.clearAutofillAuthorization();
		expect(values[KEY]).toBeUndefined();
		granted = true;
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'cancelled' });
		expect(enable).not.toHaveBeenCalled();
	});

	it('blocks a revoked intent in memory if storage is unavailable and retries cleanup before accepting a regrant', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		chrome.storage.session.set.mockRejectedValueOnce(new Error('write unavailable'));
		chrome.storage.session.remove.mockRejectedValueOnce(new Error('remove unavailable'));
		await expect(api.clearAutofillAuthorization()).rejects.toThrow('remove unavailable');
		granted = true;
		expect(await api.completeAutofillAuthorization(undefined, enable)).toMatchObject({ status: 'cancelled' });
		expect(values[KEY]).toBeUndefined();
		expect(enable).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		'keeps a denied request cancelled after a failed tombstone write (removal also fails: %s)',
		async (alsoFailRemoval) => {
			await api.beginAutofillAuthorization(message, generation, enable);
			chrome.storage.session.set.mockRejectedValueOnce(new Error('write unavailable'));
			if (alsoFailRemoval) {
				chrome.storage.session.remove.mockRejectedValueOnce(new Error('remove unavailable'));
			}
			await expect(api.cancelAutofillAuthorization(message.requestId)).rejects.toBeInstanceOf(Error);
			granted = true;
			expect(await api.completeAutofillAuthorization(message.requestId, enable)).toMatchObject({ status: 'cancelled' });
			expect(enable).not.toHaveBeenCalled();
		},
	);

	it.each([
		'mode',
		'source',
		'origin',
		'scheme',
		'port',
		'document',
		'pending navigation',
		'source permission',
		'expired',
		'clock backwards',
	])('rejects a later grant after %s changes and clears the intent', async (change) => {
		await api.beginAutofillAuthorization(message, generation, enable);
		granted = true;
		if (change === 'mode') {
			mocks.getConnectionStatus.mockResolvedValue({ mode: 'session' });
		}
		if (change === 'source') {
			mocks.getSettings.mockResolvedValue({ instanceOrigin: 'https://other.example' });
		}
		if (change === 'origin') {
			chrome.tabs.get.mockResolvedValue({ id: 7, url: 'http://172.16.0.11:8080/login' });
		}
		if (change === 'scheme') {
			chrome.tabs.get.mockResolvedValue({ id: 7, url: 'https://172.16.0.10:8080/login' });
		}
		if (change === 'port') {
			chrome.tabs.get.mockResolvedValue({ id: 7, url: 'http://172.16.0.10:8081/login' });
		}
		if (change === 'document') {
			mocks.sendDocumentMessage.mockRejectedValue(new Error('No receiver'));
		}
		if (change === 'pending navigation') {
			chrome.tabs.get.mockResolvedValue({ id: 7, url: TARGET, pendingUrl: `${TARGET}/next` });
		}
		if (change === 'source permission') {
			chrome.permissions.contains.mockResolvedValue(false);
		}
		if (change === 'expired') {
			values[KEY].createdAt -= 120001;
		}
		if (change === 'clock backwards') {
			values[KEY].createdAt += 60000;
		}
		await expect(api.completeAutofillAuthorization(undefined, enable)).rejects.toBeInstanceOf(Error);
		expect(enable).not.toHaveBeenCalled();
		expect(values[KEY]).toBeUndefined();
	});

	it('rechecks the original generation after a pending storage write', async () => {
		const original = chrome.storage.session.set.getMockImplementation();
		chrome.storage.session.set.mockImplementation(async (data) => {
			await original(data);
			generation = 'c'.repeat(36);
		});
		granted = true;
		await expect(api.beginAutofillAuthorization(message, message.configurationGeneration, enable)).rejects.toMatchObject({
			code: 'REQUEST_EXPIRED',
		});
		expect(values[KEY]).toBeUndefined();
		expect(enable).not.toHaveBeenCalled();
	});

	it('supplies a commit guard that refuses a configuration change during enabling', async () => {
		await api.beginAutofillAuthorization(message, generation, enable);
		granted = true;
		enable.mockImplementationOnce(async (_intent, guard) => {
			generation = 'c'.repeat(36);
			await guard();
		});
		await expect(api.completeAutofillAuthorization(undefined, enable)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(values[KEY]).toBeUndefined();
	});

	it.each(['site removed', 'permission removed'])('does not report stale enabled state after %s', async (change) => {
		granted = true;
		await api.beginAutofillAuthorization(message, generation, enable);
		if (change === 'site removed') {
			sites = [];
		}
		if (change === 'permission removed') {
			granted = false;
		}
		await expect(api.completeAutofillAuthorization(message.requestId, enable)).rejects.toBeInstanceOf(Error);
		expect(enable).toHaveBeenCalledOnce();
	});
});
