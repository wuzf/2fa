import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autofillPathFromUrl } from '../../extension/src/shared/origin.js';
import { MESSAGE, createNonce } from '../../extension/src/shared/protocol.js';
import { listTotpAccounts, generateTotpCode } from '../../extension/src/bridge/api.js';
import { invalidateConfigurationGeneration } from '../../extension/src/background/generation.js';
import { routeAutomaticMessage, invalidateAutomaticFlows } from '../../extension/src/background/automatic-workflow.js';

vi.mock('../../extension/src/bridge/api.js', async (original) => ({
	...(await original()),
	listTotpAccounts: vi.fn(),
	generateTotpCode: vi.fn(),
}));
const SOURCE = 'https://twofa.example';
const TARGET = 'https://github.com';
const ACCOUNT = { id: 'first', name: 'GitHub', account: 'one@example.com', type: 'TOTP', digits: 6 };
const SECOND = { ...ACCOUNT, id: 'second', account: 'two@example.com' };
let values;
let sender;
let probeReply;

function send(type, data = {}, from = sender) {
	return routeAutomaticMessage({ type, targetPath: autofillPathFromUrl(from?.url), ...data }, from);
}
async function discover(from = sender) {
	const episodeNonce = createNonce();
	return { ...(await send(MESSAGE.AUTO_DISCOVER, { episodeNonce }, from)), episodeNonce };
}
function select(flow, accountId = ACCOUNT.id, from = sender, automatic = true) {
	return send(MESSAGE.AUTO_SELECT, { nonce: flow.nonce, episodeNonce: flow.episodeNonce, accountId, automatic }, from);
}
function fills() {
	return chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === MESSAGE.AUTO_FILL);
}
beforeEach(() => {
	invalidateAutomaticFlows();
	invalidateConfigurationGeneration();
	values = {
		settings: { instanceOrigin: SOURCE },
		autofillSites: [{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: '/login' }],
	};
	const area = {
		get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })),
		set: vi.fn(async (entries) => Object.assign(values, structuredClone(entries))),
		remove: vi.fn(async (key) => delete values[key]),
	};
	sender = { id: 'ext', tab: { id: 10 }, frameId: 0, documentId: 'doc-10', url: `${TARGET}/login` };
	probeReply = { ok: true, status: 'ready', origin: TARGET, targetPath: '/login' };
	globalThis.chrome = {
		runtime: { id: 'ext' },
		storage: { local: area, session: area },
		permissions: { contains: vi.fn(async () => true) },
		tabs: {
			get: vi.fn(async (id) => ({ id, url: `${TARGET}/login` })),
			sendMessage: vi.fn(async (_id, message) =>
				message.type === MESSAGE.AUTO_PROBE
					? { ...probeReply }
					: { ok: true, status: message.type === MESSAGE.AUTO_PREPARE ? 'ready' : 'filled' },
			),
		},
	};
	listTotpAccounts.mockReset().mockResolvedValue([ACCOUNT]);
	generateTotpCode.mockReset().mockImplementation(async () => ({
		code: '123456',
		digits: 6,
		period: 30,
		generatedAt: Date.now(),
		remainingMs: 30000,
	}));
});
afterEach(() => {
	delete globalThis.chrome;
});

describe('authorized automatic workflow', () => {
	it('reports enabled without fetching any account or modifying the manual flow', async () => {
		values.pendingFlow = { nonce: 'manual' };
		expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: true });
		expect(listTotpAccounts).not.toHaveBeenCalled();
		expect(values.pendingFlow).toEqual({ nonce: 'manual' });
	});
	it('uses the current browser path when Chrome retains the sender URL from before pushState', async () => {
		sender.url = `${TARGET}/bbb`;
		const targetPath = '/aaa';
		values.autofillSites[0].targetPath = targetPath;
		chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}${targetPath}` });
		probeReply.targetPath = targetPath;
		expect(await send(MESSAGE.AUTO_STATUS, { targetPath })).toEqual({ enabled: true });
		expect(listTotpAccounts).not.toHaveBeenCalled();
		const episodeNonce = createNonce();
		const flow = await send(MESSAGE.AUTO_DISCOVER, { episodeNonce, targetPath });
		expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
		expect(
			await send(MESSAGE.AUTO_SELECT, { targetPath, episodeNonce, nonce: flow.nonce, accountId: ACCOUNT.id, automatic: true }),
		).toEqual({ status: 'filled' });
		expect(fills()[0][1]).toMatchObject({ expectedTargetPath: targetPath });
		expect(fills()[0][2]).toEqual({ frameId: 0, documentId: 'doc-10' });
	});
	it('rejects a forged allowed path when the browser is still on an unapproved SPA route', async () => {
		sender.url = `${TARGET}/login`;
		chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/unapproved` });
		await expect(send(MESSAGE.AUTO_DISCOVER, { targetPath: '/login', episodeNonce: createNonce() })).rejects.toMatchObject({
			code: 'TARGET_CHANGED',
		});
		expect(listTotpAccounts).not.toHaveBeenCalled();
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('fills on any page of a website with a site-wide grant', async () => {
		values.autofillSites = [{ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: '*', pagePath: '/login' }];
		const targetPath = '/settings/verify';
		sender.url = `${TARGET}${targetPath}`;
		chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
		probeReply.targetPath = targetPath;
		expect(await send(MESSAGE.AUTO_STATUS, { targetPath })).toEqual({ enabled: true });
		const episodeNonce = createNonce();
		const flow = await send(MESSAGE.AUTO_DISCOVER, { episodeNonce, targetPath });
		expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
		expect(
			await send(MESSAGE.AUTO_SELECT, { targetPath, episodeNonce, nonce: flow.nonce, accountId: ACCOUNT.id, automatic: true }),
		).toEqual({ status: 'filled' });
		expect(fills()[0][1]).toMatchObject({ expectedTargetPath: targetPath });
	});
	it('does not let a site-wide grant cover another port or scheme of the host', async () => {
		values.autofillSites = [{ instanceOrigin: SOURCE, targetOrigin: `${TARGET}:8443`, targetPath: '*', pagePath: '/login' }];
		expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: false });
		await expect(discover()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('does not reuse a site-wide legacy grant or fetch accounts on another path', async () => {
		delete values.autofillSites[0].targetPath;
		expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: false });
		await expect(discover()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		values.autofillSites[0].targetPath = '/login';
		sender.url = `${TARGET}/settings`;
		chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
		expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: false });
		await expect(discover()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it.each(['http://192.168.1.1', 'http://172.16.0.10:8080', 'http://login.example'])(
		'fills an explicitly authorized HTTP page %s using its bound account',
		async (target) => {
			values.autofillSites = [{ instanceOrigin: SOURCE, targetOrigin: target, targetPath: '/login' }];
			values.bindings = [{ instanceOrigin: SOURCE, targetOrigin: target, accountId: ACCOUNT.id }];
			sender = { ...sender, url: `${target}/login` };
			chrome.tabs.get.mockResolvedValue({ id: 10, url: `${target}/login` });
			probeReply = { ok: true, status: 'ready', origin: target, targetPath: '/login' };
			expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: true });
			expect(listTotpAccounts).not.toHaveBeenCalled();
			const flow = await discover();
			expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
			expect(await select(flow)).toEqual({ status: 'filled' });
			expect(fills()).toHaveLength(1);
			expect(fills()[0][1]).toMatchObject({ expectedOrigin: target, expectedTargetPath: '/login' });
			expect(fills()[0][2]).toEqual({ frameId: 0, documentId: 'doc-10' });
		},
	);
	it.each(['no authorization', 'revoked permission', 'scheme', 'host', 'port', 'path'])(
		'rejects an HTTP page with %s before reading accounts',
		async (change) => {
			const target = 'http://172.16.0.10:8080';
			values.autofillSites = [{ instanceOrigin: SOURCE, targetOrigin: target, targetPath: '/login' }];
			const locations = {
				scheme: 'https://172.16.0.10:8080/login',
				host: 'http://172.16.0.11:8080/login',
				port: 'http://172.16.0.10:8081/login',
				path: `${target}/settings`,
			};
			sender.url = locations[change] || `${target}/login`;
			chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
			if (change === 'no authorization') {
				values.autofillSites = [];
			}
			if (change === 'revoked permission') {
				chrome.permissions.contains.mockImplementation(async ({ origins }) => origins[0] !== 'http://172.16.0.10/*');
			}
			expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: false });
			await expect(discover()).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
			expect(listTotpAccounts).not.toHaveBeenCalled();
			expect(generateTotpCode).not.toHaveBeenCalled();
			expect(fills()).toHaveLength(0);
		},
	);
	it.each([undefined, '/settings', '/login?account=one'])('rejects a missing or forged message path %s', async (targetPath) => {
		await expect(send(MESSAGE.AUTO_DISCOVER, { episodeNonce: createNonce(), targetPath })).rejects.toMatchObject({
			code: 'TARGET_CHANGED',
		});
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it.each(['/login', '/login#/totp', '/login#!/totp'])(
		'authorizes exactly %s while ignoring transient queries and ordinary anchors',
		async (targetPath) => {
			values.autofillSites[0].targetPath = targetPath;
			sender.url = targetPath.includes('#') ? `${TARGET}${targetPath}?session=one` : `${TARGET}${targetPath}?session=one#help`;
			chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
			probeReply.targetPath = targetPath;
			const flow = await discover();
			expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
			expect(await select(flow)).toEqual({ status: 'filled' });
			expect(fills()[0][1]).toMatchObject({ expectedTargetPath: targetPath });
		},
	);
	it.each(['sender', 'tab', 'pending', 'probe'])('rejects a same-origin path mismatch from %s before reading accounts', async (source) => {
		if (source === 'sender') {
			sender.url = `${TARGET}/different`;
		}
		if (source === 'tab') {
			chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/different` });
		}
		if (source === 'pending') {
			chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url, pendingUrl: `${TARGET}/different` });
		}
		if (source === 'probe') {
			probeReply.targetPath = '/different';
		}
		await expect(discover()).rejects.toBeInstanceOf(Error);
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('rechecks the tab path after a delayed content probe before reading accounts', async () => {
		chrome.tabs.sendMessage.mockImplementation(async () => {
			chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/different` });
			return probeReply;
		});
		await expect(discover()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('rechecks the path after source configuration waits and before starting the account request', async () => {
		let probed = false;
		chrome.tabs.sendMessage.mockImplementation(async () => {
			probed = true;
			return probeReply;
		});
		chrome.permissions.contains.mockImplementation(async ({ origins }) => {
			if (probed && origins[0].includes('twofa')) {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/unapproved` });
			}
			return true;
		});
		await expect(discover()).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it('does not reuse a candidate nonce from another path even if both paths are authorized', async () => {
		values.autofillSites.push({ instanceOrigin: SOURCE, targetOrigin: TARGET, targetPath: '/second' });
		const flow = await discover();
		sender.url = `${TARGET}/second`;
		chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
		probeReply.targetPath = '/second';
		await expect(select(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('does not generate a code after navigation during preparation', async () => {
		const flow = await discover();
		chrome.tabs.sendMessage.mockImplementation(async (_id, message) => {
			if (message.type === MESSAGE.AUTO_PROBE) {
				return probeReply;
			}
			chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/different` });
			return { ok: true, status: 'ready' };
		});
		await expect(select(flow)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
		expect(generateTotpCode).not.toHaveBeenCalled();
	});
	it('returns only relevant metadata then fills the sender document exactly once', async () => {
		values.pendingFlow = { nonce: 'manual' };
		listTotpAccounts.mockResolvedValue([ACCOUNT, { ...SECOND, name: 'Discord' }]);
		const flow = await discover();
		expect(flow.accounts).toEqual([ACCOUNT]);
		expect(flow.autoFillAccountId).toBe(ACCOUNT.id);
		expect(await select(flow)).toEqual({ status: 'filled' });
		expect(fills()).toHaveLength(1);
		expect(fills()[0][2]).toEqual({ frameId: 0, documentId: 'doc-10' });
		expect(values.pendingFlow).toEqual({ nonce: 'manual' });
		await expect(select(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
	});
	it('requires explicit choice for multiple accounts and refuses non-candidates', async () => {
		listTotpAccounts.mockResolvedValue([ACCOUNT, SECOND]);
		const flow = await discover();
		expect(flow.autoFillAccountId).toBeNull();
		await expect(select(flow)).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		await expect(select(flow, 'outside', sender, false)).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });
		expect(await select(flow, SECOND.id, sender, false)).toEqual({ status: 'filled' });
	});
	it('does not infer site relevance from a single vault account', async () => {
		listTotpAccounts.mockResolvedValue([{ ...ACCOUNT, name: 'Unknown' }]);
		const flow = await discover();
		expect(flow.accounts).toEqual([]);
		expect(flow.autoFillAccountId).toBeNull();
	});
	it('respects explicit binding and retains missing bindings as ambiguity blockers', async () => {
		values.bindings = ['first', 'missing'].map((accountId) => ({ instanceOrigin: SOURCE, targetOrigin: TARGET, accountId }));
		listTotpAccounts.mockResolvedValue([ACCOUNT, SECOND]);
		const flow = await discover();
		expect(flow.accounts).toEqual([ACCOUNT]);
		expect(flow.autoFillAccountId).toBeNull();
	});
	it('unavailable matching records prevent automatic selection', async () => {
		listTotpAccounts.mockResolvedValue({ accounts: [ACCOUNT], unavailableAccounts: [{ id: 'missing', name: 'GitHub' }] });
		expect((await discover()).autoFillAccountId).toBeNull();
	});
	it('uses exact Google page identity and rechecks it before code delivery', async () => {
		const origin = 'https://accounts.google.com';
		values.autofillSites[0].targetOrigin = origin;
		sender.url = `${origin}/v3/signin/challenge/totp`;
		values.autofillSites[0].targetPath = '/v3/signin/challenge/totp';
		chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
		probeReply = {
			ok: true,
			status: 'ready',
			origin,
			targetPath: '/v3/signin/challenge/totp',
			loginContext: { provider: 'google', email: 'one@example.com' },
		};
		listTotpAccounts.mockResolvedValue([
			{ ...ACCOUNT, name: 'Google' },
			{ ...SECOND, name: 'Google' },
		]);
		const flow = await discover();
		expect(flow.accounts).toHaveLength(1);
		probeReply.loginContext.email = 'two@example.com';
		await expect(select(flow)).rejects.toMatchObject({ code: 'LOGIN_CHANGED' });
		expect(fills()).toHaveLength(0);
	});
	it('keeps simultaneous tabs isolated from each other and the manual popup', async () => {
		const secondSender = { ...sender, tab: { id: 11 }, documentId: 'doc-11' };
		const [one, two] = await Promise.all([discover(), discover(secondSender)]);
		await expect(select(one, ACCOUNT.id, secondSender)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await Promise.all([select(one), select(two, ACCOUNT.id, secondSender)]);
		expect(
			fills()
				.map(([id]) => id)
				.sort(),
		).toEqual([10, 11]);
	});
	it.each([
		{ id: 'other' },
		{ frameId: 1 },
		{ documentId: '' },
		{ tab: { id: 10, incognito: true } },
		{ documentLifecycle: 'prerender' },
		{ url: 'chrome://settings' },
		{ tab: undefined },
	])('rejects an untrusted or unsupported sender %j', async (change) => {
		await expect(send(MESSAGE.AUTO_DISCOVER, { episodeNonce: createNonce() }, { ...sender, ...change })).rejects.toMatchObject({
			code: 'TARGET_UNAVAILABLE',
		});
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it.each(['policy', 'target-permission', 'source-permission', 'source-instance', 'target-port'])(
		'refuses unapproved state: %s',
		async (kind) => {
			if (kind === 'policy') {
				values.autofillSites = [];
			}
			if (kind === 'target-permission') {
				chrome.permissions.contains.mockImplementation(async ({ origins }) => !origins[0].includes('github'));
			}
			if (kind === 'source-permission') {
				chrome.permissions.contains.mockImplementation(async ({ origins }) => !origins[0].includes('twofa'));
			}
			if (kind === 'source-instance') {
				values.settings.instanceOrigin = 'https://other.example';
			}
			if (kind === 'target-port') {
				sender.url = 'https://github.com:8443/login';
				chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url });
			}
			expect(await send(MESSAGE.AUTO_STATUS)).toEqual({ enabled: false });
			await expect(discover()).rejects.toBeInstanceOf(Error);
			expect(listTotpAccounts).not.toHaveBeenCalled();
		},
	);
	it('requires a live clear target before any source request', async () => {
		probeReply.status = 'not_found';
		await expect(discover()).rejects.toMatchObject({ code: 'NO_INPUT' });
		expect(listTotpAccounts).not.toHaveBeenCalled();
	});
	it.each(['generation', 'policy', 'navigation', 'pending-navigation', 'same-origin-path', 'hash-route', 'episode'])(
		'cancels a delayed code after %s changes',
		async (change) => {
			const flow = await discover();
			let resolveCode;
			generateTotpCode.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveCode = resolve;
					}),
			);
			const pending = select(flow);
			await vi.waitFor(() => expect(generateTotpCode).toHaveBeenCalledOnce());
			if (change === 'generation') {
				invalidateConfigurationGeneration();
			}
			if (change === 'policy') {
				values.autofillSites = [];
			}
			if (change === 'navigation') {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: 'https://other.example' });
			}
			if (change === 'pending-navigation') {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: sender.url, pendingUrl: 'https://other.example' });
			}
			if (change === 'same-origin-path') {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/settings` });
			}
			if (change === 'hash-route') {
				chrome.tabs.get.mockResolvedValue({ id: 10, url: `${TARGET}/login#/different` });
			}
			if (change === 'episode') {
				probeReply.status = 'not_found';
			}
			resolveCode({ code: '123456', digits: 6, period: 30, generatedAt: Date.now(), remainingMs: 30000 });
			await expect(pending).rejects.toBeInstanceOf(Error);
			expect(fills()).toHaveLength(0);
		},
	);
	it('consumes the selection before asynchronous generation so duplicate clicks cannot fill twice', async () => {
		const flow = await discover();
		const pending = select(flow);
		await expect(select(flow)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
		await pending;
		expect(fills()).toHaveLength(1);
	});
});
