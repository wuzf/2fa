// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '../../extension/src/locales/index.js';
import { ERROR_LOCALES } from '../../extension/src/locales/errors.js';
import { PLURAL_OVERRIDES } from '../../extension/src/locales/plural-overrides.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';

const POPUP_HTML = readFileSync(resolve(process.cwd(), 'extension/src/popup/popup.html'), 'utf8');
const ACCOUNT = Object.freeze({
	id: 'account-id',
	name: 'Example',
	account: 'user@example.com',
	type: 'TOTP',
	digits: 6,
});

// Deliver entries asynchronously, like a real observer. Only two cards initially
// intersect the account scroller; tests can then scroll any observed card in/out.
class MockIntersectionObserver {
	static instances = [];

	constructor(callback, options = {}) {
		this.callback = callback;
		this.root = options.root;
		this.observed = new Set();
		MockIntersectionObserver.instances.push(this);
	}

	observe(target) {
		this.observed.add(target);
		void Promise.resolve().then(() => {
			if (this.observed.has(target) && target.isConnected) {
				const cards = Array.from(this.root.querySelectorAll('.account-card'));
				const index = cards.indexOf(target);
				this.deliver(target, index >= 0 && index < 2);
			}
		});
	}

	unobserve(target) {
		this.observed.delete(target);
	}

	disconnect() {
		this.observed.clear();
	}

	deliver(target, isIntersecting) {
		if (this.observed.has(target)) {
			this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }], this);
		}
	}
}

function emitVisibility(visibility) {
	for (const observer of MockIntersectionObserver.instances) {
		for (const target of observer.observed) {
			if (Object.hasOwn(visibility, target.dataset.accountId)) {
				observer.deliver(target, visibility[target.dataset.accountId]);
			}
		}
	}
}

function renderPopup() {
	const template = document.createElement('template');
	template.innerHTML = POPUP_HTML;
	document.head.replaceChildren();
	document.body.replaceChildren(
		...Array.from(template.content.querySelectorAll('.popup-viewport, #copy-toast'))
			.filter((element) => !element.parentElement?.closest('.popup-viewport'))
			.map((element) => document.importNode(element, true)),
	);
}

function flow(nonce) {
	return {
		nonce,
		authMode: 'session',
		configurationGeneration: '0123456789abcdef0123456789abcdef012345',
		instanceOrigin: 'https://twofa.example',
		targetOrigin: 'https://login.example',
		targetPath: '/',
		targetTabId: 7,
		targetDocumentId: 'target-document',
		accounts: [ACCOUNT],
		boundAccountId: null,
	};
}

function installChromeMock(flowOverrides = {}) {
	let startCount = 0;
	let autofillSites =
		flowOverrides.initialAutofillSites ||
		(flowOverrides.autoFillAccountId
			? [
					{
						instanceOrigin: flowOverrides.instanceOrigin || 'https://twofa.example',
						targetOrigin: flowOverrides.targetOrigin || 'https://login.example',
						targetPath: flowOverrides.targetPath || '/',
					},
				]
			: []);
	const authorizations = new Map();
	const sendMessage = vi.fn(async (message) => {
		switch (message.type) {
			case 'GET_LANGUAGE':
				return { ok: true, data: { preference: flowOverrides.languagePreference || 'zh-CN' } };
			case 'START_FLOW':
				startCount += 1;
				return { ok: true, data: { ...flow(`nonce-${startCount}`), ...flowOverrides } };
			case 'GET_AUTOFILL_SITES':
				return { ok: true, data: { instanceOrigin: flowOverrides.instanceOrigin || 'https://twofa.example', sites: autofillSites } };
			case 'GET_AUTOFILL_CONTEXT':
				return { ok: true, data: { ...flow(null), ...flowOverrides, sites: autofillSites } };
			case 'OFFLINE_ICONS':
				return {
					ok: true,
					data: { instanceOrigin: flowOverrides.instanceOrigin || 'https://twofa.example', serviceIcons: flowOverrides.serviceIcons || {} },
				};
			case 'BEGIN_AUTOFILL_AUTHORIZATION':
				authorizations.set(message.requestId, message);
				return { ok: true, data: { status: 'pending', requestId: message.requestId } };
			case 'COMPLETE_AUTOFILL_AUTHORIZATION': {
				const intent = authorizations.get(message.requestId);
				if (!intent) {
					return { ok: true, data: { status: 'cancelled' } };
				}
				autofillSites = autofillSites.filter(
					(site) => site.targetOrigin !== intent.targetOrigin || (intent.targetPath !== '*' && site.targetPath !== intent.targetPath),
				);
				autofillSites.push({
					instanceOrigin: intent.instanceOrigin,
					targetOrigin: intent.targetOrigin,
					targetPath: intent.targetPath,
					...(intent.targetPath === '*' ? { pagePath: intent.pagePath } : {}),
				});
				return { ok: true, data: { status: 'enabled', instanceOrigin: intent.instanceOrigin, sites: autofillSites } };
			}
			case 'CANCEL_AUTOFILL_AUTHORIZATION':
				authorizations.delete(message.requestId);
				return { ok: true, data: { status: 'cancelled' } };
			case 'SET_AUTOFILL_SITE':
				autofillSites = autofillSites.filter(
					(site) =>
						site.targetOrigin !== message.targetOrigin ||
						(message.targetPath !== '*' && site.targetPath !== message.targetPath && !(message.enabled && site.targetPath === '*')),
				);
				if (message.enabled) {
					autofillSites.push({
						instanceOrigin: message.instanceOrigin,
						targetOrigin: message.targetOrigin,
						targetPath: message.targetPath,
					});
				}
				return { ok: true, data: { instanceOrigin: message.instanceOrigin, sites: autofillSites } };
			case 'FILL_ACCOUNT':
				return { ok: false, error: { code: 'NO_INPUT', message: '未找到明确的验证码输入框，请先点选输入框后重试' } };
			case 'COPY_ACCOUNT_CODES':
				return {
					ok: true,
					data: message.accounts.map((account) => ({ id: account.id, ...codeResponse('012345', message.includeNext).data })),
				};
			case 'COPY_ACCOUNT_CODE':
				return codeResponse('012345', message.includeNext);
			case 'OPEN_INSTANCE':
				return { ok: true, data: { status: 'activated', instanceOrigin: 'https://twofa.example' } };
			default:
				throw new Error(`Unexpected message: ${message.type}`);
		}
	});
	globalThis.chrome = {
		runtime: { sendMessage, openOptionsPage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
		permissions: { request: vi.fn(async () => true), remove: vi.fn(async () => true) },
	};
	return sendMessage;
}

function installWebsiteAccounts() {
	return installChromeMock({
		targetOrigin: 'https://www.nodeseek.com',
		boundAccountIds: ['ns1', 'ns2'],
		accounts: [
			{ ...ACCOUNT, id: 'other', name: 'GitHub', account: 'dev@example.com' },
			{ ...ACCOUNT, id: 'ns1', name: 'NodeSeek', account: 'alice' },
			{ ...ACCOUNT, id: 'ns2', name: 'NodeSeek', account: 'bob' },
		],
	});
}

function installManyAccounts() {
	return installChromeMock({
		targetOrigin: 'https://www.nodeseek.com',
		accounts: ['alice', 'bob', 'carol', 'dave'].map((account, index) => ({
			...ACCOUNT,
			id: `ns${index + 1}`,
			name: 'NodeSeek',
			account,
		})),
	});
}

function codeResponse(code = '012345', includeNext = true) {
	const expiresAt = Date.now() + 5000;
	return {
		ok: true,
		data: {
			code,
			digits: 6,
			period: 30,
			expiresAt,
			...(includeNext ? { nextCode: '654321', nextStartsAt: expiresAt, nextExpiresAt: expiresAt + 30000 } : {}),
		},
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function installClipboard() {
	const writeText = vi.fn(async () => undefined);
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
	return writeText;
}

async function flushPromises(advanceBatch = true) {
	for (let index = 0; index < 80; index += 1) {
		await Promise.resolve();
	}
	if (advanceBatch) {
		vi.advanceTimersByTime(16);
	}
	for (let index = 0; index < 80; index += 1) {
		await Promise.resolve();
	}
}

async function loadPopup() {
	renderPopup();
	await import('../../extension/src/popup/index.js');
	await flushPromises();
}

function card(id = 'account-id') {
	return document.querySelector(`article.account-card[data-account-id="${id}"]`);
}

function field(className, id = 'account-id') {
	return card(id).querySelector(`.${className}`);
}

function renderedAccountIds() {
	return Array.from(document.querySelectorAll('article.account-card'), (element) => element.dataset.accountId);
}

function messages(sendMessage, type) {
	return (
		sendMessage.mock.calls
			.flatMap(([message]) =>
				type === 'COPY_ACCOUNT_CODE' && message.type === 'COPY_ACCOUNT_CODES'
					? message.accounts.map((account) => ({ ...message, type: 'COPY_ACCOUNT_CODE', account }))
					: [message],
			)
			// Existing assertions describe the OTP workflow; authorization reads and
			// requests are tested explicitly with their message type below.
			.filter((message) =>
				type
					? message.type === type
					: ![
							'GET_AUTOFILL_SITES',
							'GET_AUTOFILL_CONTEXT',
							'GET_LANGUAGE',
							'BEGIN_AUTOFILL_AUTHORIZATION',
							'COMPLETE_AUTOFILL_AUTHORIZATION',
							'CANCEL_AUTOFILL_AUTHORIZATION',
						].includes(message.type),
			)
	);
}

function inputSearch(query) {
	const search = document.getElementById('account-search');
	search.value = query;
	search.dispatchEvent(new Event('input', { bubbles: true }));
	return search;
}

function notifyAccountsChanged(revision, instanceOrigin = 'https://twofa.example', sender = {}, clockRevision = null) {
	for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
		listener({ type: 'ACCOUNTS_CHANGED', instanceOrigin, revision, clockRevision }, sender);
	}
}

function notifyIconsChanged(instanceOrigin = 'https://twofa.example', sender = {}) {
	for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
		listener({ type: 'ICONS_CHANGED', instanceOrigin }, sender);
	}
}

beforeEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-20T08:00:00.000Z'));
	MockIntersectionObserver.instances = [];
	vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
	window.dispatchEvent(new Event('pagehide'));
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete globalThis.chrome;
});

describe('Popup manual fill ownership', () => {
	it.each(['success', 'response error', 'transport error'])('holds only the current manual nonce until %s completes', async (outcome) => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => {
			if (message.type !== 'FILL_ACCOUNT') {
				return original(message);
			}
			expect(document.documentElement.dataset.manualFillNonce).toBe(message.nonce);
			return pending.promise.then(() => {
				if (outcome === 'transport error') {
					throw new Error('Transport disconnected');
				}
				return outcome === 'success' ? { ok: true, data: {} } : original(message);
			});
		});
		vi.spyOn(window, 'close').mockImplementation(() => {});
		await loadPopup();
		expect(document.documentElement.dataset.manualFillNonce).toBeUndefined();
		field('account-fill').click();
		await flushPromises();
		const [request] = messages(sendMessage, 'FILL_ACCOUNT');
		expect(request).toMatchObject({ nonce: 'nonce-2' });
		expect(request).not.toHaveProperty('automatic');
		expect(document.documentElement.dataset.manualFillNonce).toBe(request.nonce);
		pending.resolve();
		await flushPromises();
		expect(document.documentElement.dataset.manualFillNonce).toBeUndefined();
		if (outcome === 'success') {
			expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupFilledAutofillEnabled);
		} else {
			expect(document.getElementById('status').dataset.tone).toBe('error');
			expect(document.getElementById('status').textContent).toContain(outcome === 'response error' ? '未找到' : 'Transport disconnected');
		}
	});

	it('does not remove a replacement ownership marker when an earlier manual request settles', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'FILL_ACCOUNT' ? pending.promise : original(message)));
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		document.documentElement.dataset.manualFillNonce = 'newer-request';
		try {
			pending.resolve({ ok: false, error: { code: 'NO_INPUT', message: '未找到输入框' } });
			await flushPromises();
			expect(document.documentElement.dataset.manualFillNonce).toBe('newer-request');
		} finally {
			delete document.documentElement.dataset.manualFillNonce;
		}
	});

	it('never advertises a manual nonce while automatically filling', async () => {
		const sendMessage = installChromeMock({ boundAccountIds: [ACCOUNT.id], autoFillAccountId: ACCOUNT.id });
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => {
			if (message.type !== 'FILL_ACCOUNT') {
				return original(message);
			}
			expect(message.automatic).toBe(true);
			expect(document.documentElement.dataset.manualFillNonce).toBeUndefined();
			return pending.promise;
		});
		await loadPopup();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(document.documentElement.dataset.manualFillNonce).toBeUndefined();
		pending.resolve({ ok: false, error: { code: 'NO_INPUT', message: '未找到输入框' } });
		await flushPromises();
		expect(document.documentElement.dataset.manualFillNonce).toBeUndefined();
	});
});

describe('Popup automatic source refresh', () => {
	it('clears old codes immediately and reloads when only the clock revision changes', async () => {
		const state = { sourceRevision: 'same-accounts', sourceClockRevision: 'old-clock' };
		const sendMessage = installChromeMock(state);
		const clipboard = installClipboard();
		await loadPopup();
		expect(field('preview-code').textContent).toBe('012345');
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'COPY_ACCOUNT_CODE' ? Promise.resolve(codeResponse('987654')) : original(message),
		);
		state.sourceClockRevision = 'corrected-clock';
		notifyAccountsChanged('same-accounts', 'https://twofa.example', {}, 'corrected-clock');
		expect(field('preview-code').textContent).toBe('------');
		expect(field('preview-code').disabled).toBe(true);
		expect(field('preview-next-code').textContent).toBe('------');
		card().click();
		expect(clipboard).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(field('preview-code').textContent).toBe('987654');
		expect(field('preview-code').disabled).toBe(false);
		expect(messages(sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: false });
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		const count = messages(sendMessage, 'START_FLOW').length;
		notifyAccountsChanged('same-accounts', 'https://twofa.example', {}, 'corrected-clock');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(count);
	});
	it('keeps old codes cleared while a busy operation delays a clock refresh', async () => {
		const state = { sourceRevision: 'accounts', sourceClockRevision: 'before-clock' };
		const sendMessage = installChromeMock(state);
		await loadPopup();
		const pending = deferred();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) => (message.type === 'FILL_ACCOUNT' ? pending.promise : original(message)));
		field('account-fill').click();
		await flushPromises();
		const count = messages(sendMessage, 'START_FLOW').length;
		state.sourceClockRevision = 'after-clock';
		notifyAccountsChanged('accounts', 'https://twofa.example', {}, 'after-clock');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(count);
		expect(field('preview-code').textContent).toBe('------');
		pending.resolve({ ok: false, error: { code: 'REQUEST_EXPIRED', message: '校时已变化' } });
		await flushPromises();
		expect(field('preview-code').textContent).toBe('------');
		expect(field('preview-code').disabled).toBe(true);
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});
	it('refreshes the source on open and retry, while nonce renewals for rotating codes remain local', async () => {
		const sendMessage = installChromeMock();
		await loadPopup();
		expect(messages(sendMessage, 'START_FLOW')[0]).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: true });
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: false });
		document.getElementById('retry').click();
		await flushPromises();
		expect(messages(sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: true });
	});
	it('merges account notices and preserves search, scope, focus and scroll without replaying automatic fill', async () => {
		const state = { sourceRevision: 'old-revision', accounts: [ACCOUNT, { ...ACCOUNT, id: 'carol', account: 'carol' }] };
		const sendMessage = installChromeMock(state);
		await loadPopup();
		document.getElementById('scope-all').click();
		const search = inputSearch('carol');
		vi.advanceTimersByTime(130);
		await flushPromises();
		search.focus();
		search.setSelectionRange(2, 4);
		document.getElementById('accounts').scrollTop = 70;
		state.sourceRevision = 'new-revision';
		state.accounts = [...state.accounts, { ...ACCOUNT, id: 'new-carol', account: 'carol-new' }];
		state.autoFillAccountId = 'new-carol';
		const before = messages(sendMessage, 'START_FLOW').length;
		notifyAccountsChanged('new-revision');
		notifyAccountsChanged('new-revision');
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(before + 1);
		expect(messages(sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: false });
		expect(renderedAccountIds()).toEqual(['carol', 'new-carol']);
		expect(search.value).toBe('carol');
		expect(search.selectionStart).toBe(2);
		expect(document.activeElement).toBe(search);
		expect(document.getElementById('accounts').scrollTop).toBe(70);
		inputSearch('');
		expect(document.getElementById('scope-all').getAttribute('aria-pressed')).toBe('true');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});
	it('ignores the notice already covered by its own fresh source response', async () => {
		const state = { sourceRevision: 'old-revision', sourceClockRevision: 'old-clock' };
		const sendMessage = installChromeMock(state);
		await loadPopup();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) => {
			if (message.type === 'START_FLOW' && message.refreshSource) {
				state.sourceRevision = 'covered-revision';
				state.sourceClockRevision = 'covered-clock';
				notifyAccountsChanged('covered-revision', 'https://twofa.example', {}, 'covered-clock');
			}
			return original(message);
		});
		document.getElementById('retry').click();
		await flushPromises();
		const count = messages(sendMessage, 'START_FLOW').length;
		await vi.advanceTimersByTimeAsync(200);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(count);
	});
	it('defers a changed account list until an active fill has finished', async () => {
		const state = { sourceRevision: 'before-fill' };
		const sendMessage = installChromeMock(state);
		await loadPopup();
		const pending = deferred();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) => (message.type === 'FILL_ACCOUNT' ? pending.promise : original(message)));
		field('account-fill').click();
		await flushPromises();
		const count = messages(sendMessage, 'START_FLOW').length;
		state.sourceRevision = 'after-fill';
		notifyAccountsChanged('after-fill');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(count);
		pending.resolve({ ok: false, error: { code: 'NO_INPUT', message: '输入框已变化' } });
		await flushPromises();
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(sendMessage, 'START_FLOW').some((message) => message.refreshSource === false)).toBe(true);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});
	it('refreshes automatically when back online, ignores foreign notifications, and removes listeners on close', async () => {
		const sendMessage = installChromeMock({ sourceRevision: 'current' });
		await loadPopup();
		const count = messages(sendMessage, 'START_FLOW').length;
		notifyAccountsChanged('new', 'https://another.example');
		notifyAccountsChanged('new', 'https://twofa.example', { tab: { id: 7 } });
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(count);
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(sendMessage, 'START_FLOW').at(-1).refreshSource).toBe(true);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		window.dispatchEvent(new Event('pagehide'));
		const finalCount = messages(sendMessage, 'START_FLOW').length;
		window.dispatchEvent(new Event('online'));
		notifyAccountsChanged('late');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(finalCount);
		expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
	});
});

describe('Popup cache-first startup', () => {
	function pendingOffline(overrides = {}) {
		const state = {
			authMode: 'offline',
			sourceRevision: 'cached-accounts',
			sourceClockRevision: 'cached-clock',
			sourceRefreshPending: true,
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
			autoFillAccountId: null,
			...overrides,
		};
		const sendMessage = installChromeMock(state);
		const original = sendMessage.getMockImplementation();
		const refresh = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'REFRESH_OFFLINE_ACCOUNTS' ? refresh.promise : original(message)));
		return { state, sendMessage, refresh, original };
	}

	async function completeRefresh(pending, changes = {}) {
		Object.assign(pending.state, { sourceRefreshPending: false }, changes);
		pending.refresh.resolve({ ok: true, data: { instanceOrigin: 'https://twofa.example' } });
		await flushPromises();
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
	}

	it('makes cached codes, search, scrolling and copying usable while a network refresh is pending', async () => {
		const pending = pendingOffline();
		const clipboard = installClipboard();
		await loadPopup();
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toEqual([
			{ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin: 'https://twofa.example' },
		]);
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-code').disabled).toBe(false);
		expect(document.getElementById('account-search').disabled).toBe(false);
		expect(document.getElementById('status').hidden).toBe(true);
		const search = inputSearch('user');
		search.focus();
		search.setSelectionRange(1, 3);
		document.getElementById('accounts').scrollTop = 70;
		field('preview-code').click();
		await flushPromises();
		expect(clipboard).toHaveBeenCalledWith('012345');
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(pending.sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: false });
		expect(messages(pending.sendMessage, 'COPY_ACCOUNT_CODE').length).toBeGreaterThan(1);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
		await completeRefresh(pending, { autoFillAccountId: ACCOUNT.id });
		expect(search.value).toBe('user');
		expect(search.selectionStart).toBe(1);
		expect(document.activeElement).toBe(search);
		expect(document.getElementById('accounts').scrollTop).toBe(70);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
	});

	describe('restored clock correction', () => {
		const unverified = () => ({ offlineStatus: { cachedAt: Date.now(), usingCache: true, clockStatus: 'unverified' } });
		const hint = () => document.getElementById('offline-state');

		it('waits for its background verification instead of flashing the time warning', async () => {
			const pending = pendingOffline(unverified());
			await loadPopup();
			expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
			expect(hint().hidden).toBe(true);
			await completeRefresh(pending, { sourceClockRevision: 'verified-clock', offlineStatus: { usingCache: true, clockStatus: 'cached' } });
			expect(hint().hidden).toBe(true);
			expect(field('preview-code').textContent).toBe('012345');
		});

		it.each([
			['cannot reach the instance', 'failure'],
			['keeps the correction unverified', 'unverified'],
		])('shows the time warning when verification %s', async (_label, outcome) => {
			const pending = pendingOffline(unverified());
			await loadPopup();
			expect(hint().hidden).toBe(true);
			if (outcome === 'failure') {
				pending.refresh.resolve({ ok: false, error: { code: 'SOURCE_OFFLINE' } });
				await flushPromises();
			} else {
				await completeRefresh(pending);
			}
			expect(hint().hidden).toBe(false);
			expect(document.getElementById('offline-summary').textContent).toBe('请确认系统时间准确');
			expect(document.getElementById('offline-detail').textContent).toContain('恢复联网后会自动校准验证码时间');
			expect(field('preview-code').textContent).toBe('012345');
		});

		describe('checked with only the time endpoint', () => {
			const checking = () => ({
				sourceRefreshPending: false,
				offlineStatus: { cachedAt: Date.now(), usingCache: true, clockStatus: 'unverified', clockVerificationPending: true },
			});

			it('hides the time warning while the background time check runs, then shows the verified state', async () => {
				const pending = pendingOffline(checking());
				await loadPopup();
				expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toEqual([
					{ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin: 'https://twofa.example', clockOnly: true },
				]);
				expect(hint().hidden).toBe(true);
				expect(field('preview-code').textContent).toBe('012345');
				expect(field('preview-code').disabled).toBe(false);
				await completeRefresh(pending, {
					sourceClockRevision: 'verified-clock',
					offlineStatus: { usingCache: true, clockStatus: 'cached' },
				});
				expect(hint().hidden).toBe(true);
				expect(messages(pending.sendMessage, 'START_FLOW').at(-1)).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: false });
				expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
				expect(field('preview-code').textContent).toBe('012345');
			});

			it.each(['SOURCE_OFFLINE', 'INVALID_RESPONSE', 'REQUEST_EXPIRED'])(
				'shows the time warning after a failed time check (%s) and keeps the cached accounts',
				async (code) => {
					const pending = pendingOffline(checking());
					await loadPopup();
					expect(hint().hidden).toBe(true);
					pending.refresh.resolve({ ok: false, error: { code } });
					await flushPromises();
					expect(hint().hidden).toBe(false);
					expect(document.getElementById('offline-summary').textContent).toBe('请确认系统时间准确');
					expect(field('preview-code').textContent).toBe('012345');
					expect(document.getElementById('status').hidden).toBe(true);
					expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
				},
			);

			it('shows the time warning at once when no time check is running', async () => {
				const pending = pendingOffline({ ...unverified(), sourceRefreshPending: false });
				await loadPopup();
				expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(0);
				expect(hint().hidden).toBe(false);
				expect(document.getElementById('offline-summary').textContent).toBe('请确认系统时间准确');
			});
		});
	});

	it('rechecks unchanged account data after background verification and attempts automatic filling only once', async () => {
		const pending = pendingOffline();
		await loadPopup();
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		await completeRefresh(pending, { autoFillAccountId: ACCOUNT.id });
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ automatic: true, account: ACCOUNT })]);
		notifyAccountsChanged('new-notice', 'https://twofa.example', {}, 'cached-clock');
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
	});

	it('never automatically fills the previously unique cached account after a second match appears', async () => {
		const pending = pendingOffline();
		await loadPopup();
		await completeRefresh(pending, { sourceRevision: 'two-accounts', accounts: [ACCOUNT, { ...ACCOUNT, id: 'second' }] });
		expect(renderedAccountIds()).toEqual([ACCOUNT.id, 'second']);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it.each(['success', 'failure'])('ignores an old background %s after retry starts a new automatic attempt', async (outcome) => {
		const pending = pendingOffline();
		await loadPopup();
		inputSearch('user');
		const retryRefresh = deferred();
		pending.sendMessage.mockImplementation((message) =>
			message.type === 'REFRESH_OFFLINE_ACCOUNTS' ? retryRefresh.promise : pending.original(message),
		);
		document.getElementById('retry').click();
		await flushPromises();
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(2);
		expect(document.getElementById('account-search').value).toBe('');
		const reads = messages(pending.sendMessage, 'START_FLOW').length;
		Object.assign(pending.state, { sourceRefreshPending: false, autoFillAccountId: ACCOUNT.id });
		pending.refresh.resolve(
			outcome === 'success' ? { ok: true, data: {} } : { ok: false, error: { code: 'AUTH_REQUIRED', message: '旧连接已失效' } },
		);
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(pending.sendMessage, 'START_FLOW')).toHaveLength(reads);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		expect(field('preview-code').textContent).toBe('012345');
		retryRefresh.resolve({ ok: true, data: {} });
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ automatic: true, account: ACCOUNT })]);
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});

	it('restores unique-account automatic filling after a failed automatic attempt when explicitly retried', async () => {
		const sendMessage = installChromeMock({ autoFillAccountId: ACCOUNT.id });
		await loadPopup();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(document.getElementById('status').textContent).toContain('未找到');
		inputSearch('user');
		document.getElementById('retry').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(2);
		expect(messages(sendMessage, 'FILL_ACCOUNT').every((message) => message.automatic)).toBe(true);
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(2);
	});

	describe('automatic fill expired by a clock change', () => {
		const expiring = (times) => {
			const sendMessage = installChromeMock({ autoFillAccountId: ACCOUNT.id });
			const original = sendMessage.getMockImplementation();
			let left = times;
			sendMessage.mockImplementation((message) => {
				if (message.type === 'FILL_ACCOUNT' && left > 0) {
					left -= 1;
					return Promise.resolve({ ok: false, error: { code: 'REQUEST_EXPIRED', message: '校时已变化' } });
				}
				return original(message);
			});
			return sendMessage;
		};

		it('retries the first automatic fill once with a renewed flow', async () => {
			const sendMessage = expiring(1);
			await loadPopup();
			const starts = messages(sendMessage, 'START_FLOW').length;
			await vi.advanceTimersByTimeAsync(100);
			await flushPromises();
			expect(messages(sendMessage, 'START_FLOW').length).toBeGreaterThan(starts);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([
				expect.objectContaining({ automatic: true, account: ACCOUNT }),
				expect.objectContaining({ automatic: true, account: ACCOUNT }),
			]);
		});

		it('does not retry a second expiration', async () => {
			const sendMessage = expiring(2);
			await loadPopup();
			await vi.advanceTimersByTimeAsync(100);
			await flushPromises();
			await vi.advanceTimersByTimeAsync(5020);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(2);
			expect(document.getElementById('status').hidden).toBe(false);
		});

		it('does not retry after the user interacts with the popup', async () => {
			const sendMessage = expiring(1);
			await loadPopup();
			inputSearch('user');
			await vi.advanceTimersByTimeAsync(5020);
			await flushPromises();
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		});
	});

	it.each(['search', 'scope', 'keyboard', 'remember', 'copy'])(
		'cancels delayed automatic fill after %s interaction',
		async (interaction) => {
			const pending = pendingOffline();
			installClipboard();
			await loadPopup();
			if (interaction === 'search') {
				inputSearch('user');
			}
			if (interaction === 'scope') {
				document.getElementById('scope-all').click();
			}
			if (interaction === 'keyboard') {
				card().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			}
			if (interaction === 'remember') {
				document.getElementById('remember-binding').dispatchEvent(new Event('change'));
			}
			if (interaction === 'copy') {
				field('preview-code').click();
			}
			await completeRefresh(pending, { autoFillAccountId: ACCOUNT.id });
			expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		},
	);

	it('checks an empty cache in the background and may fill its first fresh account', async () => {
		const pending = pendingOffline({ accounts: [] });
		await loadPopup();
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
		await completeRefresh(pending, { sourceRevision: 'first-account', accounts: [ACCOUNT], autoFillAccountId: ACCOUNT.id });
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});

	it('keeps cached codes after a transient network error without retrying or replaying automatic fill', async () => {
		const pending = pendingOffline();
		await loadPopup();
		pending.refresh.resolve({ ok: false, error: { code: 'SOURCE_OFFLINE', message: '网络暂不可用' } });
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-code').disabled).toBe(false);
		await vi.advanceTimersByTimeAsync(5020);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it('clears cached cards and offers login after an authentication failure', async () => {
		const pending = pendingOffline();
		const favorite = deferred();
		const sourceMessage = pending.sendMessage.getMockImplementation();
		pending.sendMessage.mockImplementation((message) => (message.type === 'SET_FAVORITE' ? favorite.promise : sourceMessage(message)));
		await loadPopup();
		field('account-favorite').click();
		inputSearch('Example');
		pending.refresh.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请重新登录 2FA' } });
		await flushPromises();
		favorite.resolve({ ok: true, data: { favoriteAccountIds: [ACCOUNT.id] } });
		await vi.advanceTimersByTimeAsync(150);
		expect(renderedAccountIds()).toEqual([]);
		expect(document.getElementById('account-section').hidden).toBe(true);
		expect(document.getElementById('open-source').hidden).toBe(false);
		expect(document.getElementById('status').textContent).toBe(ERROR_LOCALES['zh-CN'].error_AUTH_REQUIRED);
		await vi.advanceTimersByTimeAsync(30000);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		pending.sendMessage.mockImplementation(pending.original);
		pending.state.sourceRefreshPending = false;
		document.getElementById('retry').click();
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
	});

	it.each(['close', 'configuration', 'target'])('discards a late verification result after %s changes', async (change) => {
		const pending = pendingOffline();
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		await loadPopup();
		if (change === 'close') {
			window.dispatchEvent(new Event('pagehide'));
		}
		if (change === 'configuration') {
			for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
				listener({ settings: { newValue: { instanceOrigin: 'https://another.example' } } }, 'local');
			}
		}
		await completeRefresh(pending, { autoFillAccountId: ACCOUNT.id, ...(change === 'target' ? { targetDocumentId: 'new-document' } : {}) });
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		if (change === 'close') {
			expect(vi.getTimerCount()).toBe(0);
		}
		if (change === 'configuration') {
			expect(document.getElementById('account-section').hidden).toBe(true);
		}
		if (change === 'target') {
			expect(document.getElementById('status').textContent).toContain('网站或实例已发生变化');
		}
	});

	it('combines an early account notice with completion without losing the initial automatic opportunity', async () => {
		const pending = pendingOffline();
		await loadPopup();
		pending.state.sourceRevision = 'updated-accounts';
		notifyAccountsChanged('updated-accounts', 'https://twofa.example', {}, 'cached-clock');
		await vi.advanceTimersByTimeAsync(100);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		await completeRefresh(pending, { autoFillAccountId: ACCOUNT.id });
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
	});

	it('clears old clock codes during the network refresh and resumes corrected previews locally', async () => {
		const pending = pendingOffline();
		await loadPopup();
		pending.state.sourceClockRevision = 'corrected-clock';
		notifyAccountsChanged('cached-accounts', 'https://twofa.example', {}, 'corrected-clock');
		expect(field('preview-code').textContent).toBe('------');
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(pending.sendMessage, 'REFRESH_OFFLINE_ACCOUNTS')).toHaveLength(1);
		await completeRefresh(pending);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it('lets an explicit fill renew its own nonce when a background completion read is already pending', async () => {
		const pending = pendingOffline();
		await loadPopup();
		const localRead = deferred();
		const manualFill = deferred();
		let holdNextRead = true;
		pending.sendMessage.mockImplementation((message) => {
			if (message.type === 'REFRESH_OFFLINE_ACCOUNTS') {
				return pending.refresh.promise;
			}
			if (message.type === 'START_FLOW' && holdNextRead) {
				holdNextRead = false;
				return localRead.promise;
			}
			if (message.type === 'FILL_ACCOUNT') {
				return manualFill.promise;
			}
			return pending.original(message);
		});
		Object.assign(pending.state, { sourceRefreshPending: false, autoFillAccountId: ACCOUNT.id });
		pending.refresh.resolve({ ok: true, data: {} });
		await vi.advanceTimersByTimeAsync(100);
		field('account-fill').click();
		await flushPromises();
		expect(document.getElementById('account-search').disabled).toBe(true);
		localRead.resolve({ ok: true, data: { ...flow('completion-nonce'), ...pending.state } });
		await flushPromises();
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ nonce: 'nonce-2', account: ACCOUNT })]);
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')[0].automatic).toBeUndefined();
		expect(document.getElementById('account-search').disabled).toBe(true);
		expect(field('preview-code').textContent).toBe('------');
		manualFill.resolve({ ok: false, error: { code: 'NO_INPUT', message: '未找到输入框' } });
		await flushPromises();
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(messages(pending.sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(document.getElementById('account-search').disabled).toBe(false);
		expect(field('preview-code').textContent).toBe('012345');
	});
});

describe('Popup cached icon updates', () => {
	const image = `data:image/png;base64,${btoa('cached-icon')}`;
	const newerImage = `data:image/png;base64,${btoa('updated-icon')}`;
	const github = { ...ACCOUNT, name: 'GitHub' };
	const offlineFlow = (overrides = {}) => ({ authMode: 'offline', accounts: [github], serviceIcons: {}, ...overrides });
	const icon = (id = ACCOUNT.id) => card(id).querySelector('.service-icon img');
	async function flushIcons() {
		await vi.advanceTimersByTimeAsync(60);
		await flushPromises();
	}

	it('merges notifications and updates images in place without refreshing accounts, codes or focus', async () => {
		const state = offlineFlow({ accounts: [github, { ...ACCOUNT, id: 'other', name: 'Google' }], autoFillAccountId: github.id });
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		document.getElementById('scope-all').click();
		const search = inputSearch('GitHub');
		vi.advanceTimersByTime(130);
		await flushPromises();
		search.focus();
		search.setSelectionRange(1, 4);
		document.getElementById('accounts').scrollTop = 35;
		const originalCard = card();
		const originalCode = field('preview-code');
		const requests = messages(sendMessage);
		state.serviceIcons = { 'github.com': image };
		notifyIconsChanged();
		notifyIconsChanged();
		await flushIcons();
		expect(messages(sendMessage).slice(requests.length)).toEqual([{ type: 'OFFLINE_ICONS' }]);
		expect(card()).toBe(originalCard);
		expect(field('preview-code')).toBe(originalCode);
		expect(originalCode.textContent).toBe('012345');
		expect(icon().src).toBe(image);
		expect(search.value).toBe('GitHub');
		expect(search.selectionStart).toBe(1);
		expect(search.selectionEnd).toBe(4);
		expect(document.activeElement).toBe(search);
		expect(document.getElementById('accounts').scrollTop).toBe(35);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});

	it('catches up locally when icons finish before the first account response', async () => {
		const state = offlineFlow({ serviceIcons: { 'github.com': image } });
		const sendMessage = installChromeMock(state);
		const original = sendMessage.getMockImplementation();
		const opening = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'START_FLOW' ? opening.promise : original(message)));
		await loadPopup();
		notifyIconsChanged();
		await flushIcons();
		expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(0);
		opening.resolve({ ok: true, data: { ...flow('first'), ...offlineFlow() } });
		await flushPromises();
		await flushIcons();
		expect(icon().src).toBe(image);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
		expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(1);
	});

	it('follows notifications received during a local read without applying its outdated images', async () => {
		const state = offlineFlow();
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		let delay = true;
		sendMessage.mockImplementation((message) => {
			if (message.type === 'OFFLINE_ICONS' && delay) {
				delay = false;
				return pending.promise;
			}
			return original(message);
		});
		const before = messages(sendMessage, 'OFFLINE_ICONS').length;
		notifyIconsChanged();
		await flushIcons();
		state.serviceIcons = { 'github.com': newerImage };
		notifyIconsChanged();
		notifyIconsChanged();
		pending.resolve({ ok: true, data: { instanceOrigin: 'https://twofa.example', serviceIcons: { 'github.com': image } } });
		await flushPromises();
		expect(icon().hasAttribute('src')).toBe(false);
		await flushIcons();
		expect(icon().src).toBe(newerImage);
		expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(before + 2);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
	});

	it('rejects foreign senders and instances and ignores offline-icon notices in session mode', async () => {
		const state = offlineFlow();
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		const before = messages(sendMessage, 'OFFLINE_ICONS').length;
		notifyIconsChanged('https://other.example');
		notifyIconsChanged('https://twofa.example', { tab: { id: 7 } });
		notifyIconsChanged('https://twofa.example', { id: 'another-extension' });
		await flushIcons();
		expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(before);
		state.authMode = 'session';
		document.getElementById('retry').click();
		await flushPromises();
		notifyIconsChanged();
		await flushIcons();
		expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(before);
		expect(icon().src).toBe('https://twofa.example/api/favicon/github.com');
	});

	it('discards an old instance response while the new instance catches up', async () => {
		const state = offlineFlow();
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		let delay = true;
		sendMessage.mockImplementation((message) => {
			if (message.type === 'OFFLINE_ICONS' && delay) {
				delay = false;
				return pending.promise;
			}
			return original(message);
		});
		notifyIconsChanged();
		await flushIcons();
		state.instanceOrigin = 'https://new-twofa.example';
		document.getElementById('retry').click();
		await flushPromises();
		state.serviceIcons = { 'github.com': newerImage };
		pending.resolve({ ok: true, data: { instanceOrigin: 'https://twofa.example', serviceIcons: { 'github.com': image } } });
		await flushPromises();
		expect(icon().hasAttribute('src')).toBe(false);
		await flushIcons();
		expect(icon().src).toBe(newerImage);
	});

	it.each(['permission', 'settings', 'close'])('discards a pending icon reply after %s changes', async (change) => {
		const state = offlineFlow();
		const sendMessage = installChromeMock(state);
		chrome.permissions.onRemoved = { addListener: vi.fn(), removeListener: vi.fn() };
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		await loadPopup();
		await flushIcons();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'OFFLINE_ICONS' ? pending.promise : original(message)));
		notifyIconsChanged();
		await flushIcons();
		if (change === 'permission') {
			for (const [listener] of chrome.permissions.onRemoved.addListener.mock.calls) {
				listener({ origins: ['https://twofa.example/*'] });
			}
		} else if (change === 'settings') {
			for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
				listener({ offlineInstances: { newValue: [] } }, 'local');
			}
		} else {
			window.dispatchEvent(new Event('pagehide'));
		}
		pending.resolve({ ok: true, data: { instanceOrigin: 'https://twofa.example', serviceIcons: { 'github.com': image } } });
		await flushIcons();
		expect(icon().hasAttribute('src')).toBe(false);
		if (change === 'close') {
			const before = messages(sendMessage, 'OFFLINE_ICONS').length;
			notifyIconsChanged();
			await flushIcons();
			expect(messages(sendMessage, 'OFFLINE_ICONS')).toHaveLength(before);
			for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
				expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
			}
			expect(chrome.permissions.onRemoved.removeListener).toHaveBeenCalled();
		}
	});

	it('retains lazy image loading for hidden cards after cache updates', async () => {
		const state = offlineFlow({ accounts: ['a', 'b', 'c'].map((account) => ({ ...github, id: account, account })) });
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		const before = messages(sendMessage, 'COPY_ACCOUNT_CODE').length;
		state.serviceIcons = { 'github.com': image };
		notifyIconsChanged();
		await flushIcons();
		expect(icon('a').src).toBe(image);
		expect(icon('c').hasAttribute('src')).toBe(false);
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(before);
		emitVisibility({ c: true });
		expect(icon('c').src).toBe(image);
	});

	it('keeps letters after a broken image and recovers from a later safe cached image', async () => {
		const state = offlineFlow({ serviceIcons: { 'github.com': image } });
		const sendMessage = installChromeMock(state);
		await loadPopup();
		await flushIcons();
		icon().dispatchEvent(new Event('error'));
		expect(icon().hidden).toBe(true);
		expect(field('service-icon-fallback').hidden).toBe(false);
		state.serviceIcons = { 'github.com': 'https://untrusted.example/icon.png' };
		notifyIconsChanged();
		await flushIcons();
		expect(icon().hasAttribute('src')).toBe(false);
		state.serviceIcons = { 'github.com': newerImage };
		notifyIconsChanged();
		await flushIcons();
		expect(icon().src).toBe(newerImage);
		icon().dispatchEvent(new Event('load'));
		expect(icon().hidden).toBe(false);
		expect(field('service-icon-fallback').hidden).toBe(true);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
	});
});

describe('Popup site-wide autofill asked for while filling', () => {
	const WHOLE_SITE = { instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '*', pagePath: '/' };
	function succeedFilling(sendMessage) {
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'FILL_ACCOUNT' ? Promise.resolve({ ok: true, data: {} }) : original(message),
		);
	}

	it('asks for the whole website in the fill click, fills, remembers the account and closes after saying so', async () => {
		const sendMessage = installChromeMock();
		succeedFilling(sendMessage);
		const close = vi.spyOn(window, 'close').mockImplementation(() => {});
		await loadPopup();
		expect(document.getElementById('remember-title').textContent).toBe('以后在此网站自动填入 Example（user@example.com）');
		expect(document.getElementById('remember-binding').checked).toBe(true);
		chrome.permissions.request.mockImplementationOnce(async () => {
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
			return true;
		});
		field('account-fill').click();
		// Both happen before the click returns: the prompt needs its user activation.
		expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://login.example/*'] });
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toEqual([
			expect.objectContaining({
				targetOrigin: 'https://login.example',
				targetPath: '*',
				pagePath: '/',
				rememberAccount: ACCOUNT,
				expectedTarget: { tabId: 7, documentId: 'target-document', origin: 'https://login.example', targetPath: '/' },
			}),
		]);
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ account: ACCOUNT, remember: true })]);
		expect(messages(sendMessage, 'FILL_ACCOUNT')[0]).not.toHaveProperty('automatic');
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupFilledAutofillEnabled);
		expect(document.getElementById('autofill-site').checked).toBe(true);
		vi.advanceTimersByTime(450);
		expect(close).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1050);
		expect(close).toHaveBeenCalledOnce();
	});

	it('says the code is filled while the permission prompt is still open', async () => {
		const sendMessage = installChromeMock();
		succeedFilling(sendMessage);
		const close = vi.spyOn(window, 'close').mockImplementation(() => {});
		const permission = deferred();
		chrome.permissions.request.mockReturnValueOnce(permission.promise);
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupFilledAwaitingAccess);
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		vi.advanceTimersByTime(5000);
		expect(close).not.toHaveBeenCalled();
		permission.resolve(true);
		await flushPromises();
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupFilledAutofillEnabled);
		vi.advanceTimersByTime(1500);
		expect(close).toHaveBeenCalledOnce();
	});

	it('keeps the popup open and says so when the website permission is denied', async () => {
		const sendMessage = installChromeMock();
		succeedFilling(sendMessage);
		const close = vi.spyOn(window, 'close').mockImplementation(() => {});
		chrome.permissions.request.mockResolvedValue(false);
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ remember: true })]);
		expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupFilledAutofillDenied);
		expect(document.getElementById('autofill-site').checked).toBe(false);
		vi.advanceTimersByTime(5000);
		expect(close).not.toHaveBeenCalled();
		expect(field('account-fill').disabled).toBe(false);
	});

	it('reports a grant the worker could not complete after a successful fill', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) => {
			if (message.type === 'FILL_ACCOUNT') {
				return Promise.resolve({ ok: true, data: {} });
			}
			if (message.type === 'COMPLETE_AUTOFILL_AUTHORIZATION') {
				return Promise.resolve({ ok: false, error: { code: 'TARGET_CHANGED', message: '网站已变化' } });
			}
			return original(message);
		});
		const close = vi.spyOn(window, 'close').mockImplementation(() => {});
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		expect(document.getElementById('status').textContent).toBe(
			LOCALES['zh-CN'].popupFilledAutofillFailed.replace('{error}', ERROR_LOCALES['zh-CN'].error_TARGET_CHANGED),
		);
		expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		vi.advanceTimersByTime(5000);
		expect(close).not.toHaveBeenCalled();
	});

	it('still turns autofill on when the fill itself fails, keeping the fill error shown', async () => {
		const sendMessage = installChromeMock();
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		expect(document.getElementById('status').textContent).toContain('未找到明确的验证码输入框');
		expect(document.getElementById('autofill-site').checked).toBe(true);
		// The retry on the focused field does not ask again.
		document.getElementById('fill-focused').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(2);
		expect(messages(sendMessage, 'FILL_ACCOUNT')[1]).toMatchObject({ confirmFocused: true });
		expect(chrome.permissions.request).toHaveBeenCalledOnce();
	});

	it('does not ask for a grant from the focused-field retry', async () => {
		const sendMessage = installChromeMock();
		chrome.permissions.request.mockResolvedValue(false);
		await loadPopup();
		field('account-fill').click();
		await flushPromises();
		expect(chrome.permissions.request).toHaveBeenCalledOnce();
		document.getElementById('fill-focused').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(2);
		expect(chrome.permissions.request).toHaveBeenCalledOnce();
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
	});

	it('does not ask for a grant when the account is unchecked, and forgets nothing it did not remember', async () => {
		const sendMessage = installChromeMock();
		succeedFilling(sendMessage);
		await loadPopup();
		document.getElementById('remember-binding').click();
		expect(document.getElementById('remember-binding').checked).toBe(false);
		field('account-fill').click();
		await flushPromises();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ remember: false })]);
	});

	it('leaves the account unchecked by default when the website remembers another account', async () => {
		const other = { ...ACCOUNT, id: 'other', account: 'other@example.com' };
		const sendMessage = installChromeMock({ accounts: [ACCOUNT, other], boundAccountIds: [other.id] });
		await loadPopup();
		document.getElementById('scope-all').click();
		field('account-fill').dispatchEvent(new window.Event('pointerover', { bubbles: true }));
		expect(document.getElementById('remember-binding').checked).toBe(false);
		field('account-fill').click();
		await flushPromises();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ account: ACCOUNT, remember: false })]);
	});

	it('shows the offer even for a unique name match, which automatic fills would choose anyway', async () => {
		installChromeMock({ targetOrigin: 'https://github.com', accounts: [{ ...ACCOUNT, name: 'GitHub' }], autoFillAccountId: null });
		await loadPopup();
		const label = document.getElementById('remember-binding').closest('label');
		expect(label.hidden).toBe(false);
		expect(document.getElementById('remember-title').textContent).toBe('以后在此网站自动填入 GitHub（user@example.com）');
	});

	it('does not ask again on a website that already has a site-wide grant', async () => {
		const sendMessage = installChromeMock({ initialAutofillSites: [WHOLE_SITE] });
		succeedFilling(sendMessage);
		await loadPopup();
		expect(document.getElementById('autofill-site').checked).toBe(true);
		expect(document.getElementById('autofill-title').textContent).toBe(LOCALES['zh-CN'].popupAutofillSiteTitle);
		expect(document.getElementById('remember-title').textContent).toBe('以后在此网站自动填入 Example（user@example.com）');
		field('account-fill').click();
		await flushPromises();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ remember: true })]);
		expect(document.getElementById('status').textContent).toBe('验证码已填入');
	});

	it('covers every page of the website once granted', async () => {
		installChromeMock({ targetPath: '/settings/security', initialAutofillSites: [WHOLE_SITE] });
		await loadPopup();
		expect(document.getElementById('autofill-site').checked).toBe(true);
	});

	it('turns off every grant of the website from the site-wide switch', async () => {
		const sendMessage = installChromeMock({ initialAutofillSites: [WHOLE_SITE] });
		await loadPopup();
		document.getElementById('autofill-site').click();
		await flushPromises();
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toEqual([
			expect.objectContaining({ targetOrigin: 'https://login.example', targetPath: '*', enabled: false }),
		]);
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupSiteAutofillDisabled);
		expect(document.getElementById('autofill-site').checked).toBe(false);
	});

	it('keeps the page wording for a page grant from an earlier version until it is turned off', async () => {
		const sendMessage = installChromeMock({
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		await loadPopup();
		const toggle = document.getElementById('autofill-site');
		expect(toggle.checked).toBe(true);
		expect(document.getElementById('autofill-title').textContent).toBe(LOCALES['zh-CN'].popupAutofillTitle);
		expect(toggle.closest('label').title).toBe(LOCALES['zh-CN'].popupAutofillHint);
		expect(document.getElementById('remember-title').textContent).toBe('记住 Example（user@example.com）');
		expect(document.getElementById('remember-binding').checked).toBe(false);
		toggle.click();
		await flushPromises();
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toEqual([expect.objectContaining({ targetPath: '/', enabled: false })]);
		expect(document.getElementById('status').textContent).toBe(LOCALES['zh-CN'].popupAutofillDisabled);
		expect(document.getElementById('autofill-title').textContent).toBe(LOCALES['zh-CN'].popupAutofillSiteTitle);
		expect(document.getElementById('remember-title').textContent).toBe('以后在此网站自动填入 Example（user@example.com）');
	});

	it('offers the whole website on another page of a website with an earlier page grant', async () => {
		installChromeMock({
			targetPath: '/verify',
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		await loadPopup();
		expect(document.getElementById('autofill-site').checked).toBe(false);
		expect(document.getElementById('remember-title').textContent).toBe('以后在此网站自动填入 Example（user@example.com）');
	});

	it('never asks for a grant from a page that cannot be authorized', async () => {
		const sendMessage = installChromeMock({ targetOrigin: 'https://twofa.example' });
		await loadPopup();
		expect(document.getElementById('remember-title').textContent).toBe('记住 Example（user@example.com）');
		field('account-fill').click();
		await flushPromises();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
	});
});

describe('Popup per-site automatic fill authorization', () => {
	it.each(['https://login.example', 'http://login.example', 'http://192.168.1.1'])(
		'leaves a unique account manual on an unapproved path at %s, including retry, and sends that exact path when enabling',
		async (targetOrigin) => {
			const sendMessage = installChromeMock({
				targetOrigin,
				targetPath: '/mfa',
				autoFillAccountId: ACCOUNT.id,
				initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin, targetPath: '/another-mfa' }],
			});
			await loadPopup();
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			expect(document.getElementById('autofill-site').checked).toBe(false);
			document.getElementById('retry').click();
			await flushPromises();
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			// Fill once without asking for the grant, then turn autofill on.
			document.getElementById('remember-binding').click();
			field('account-fill').click();
			await flushPromises();
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
			expect(messages(sendMessage, 'FILL_ACCOUNT')[0].automatic).toBeUndefined();
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
			document.getElementById('autofill-site').click();
			await flushPromises();
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')[0]).toMatchObject({
				targetPath: '*',
				pagePath: '/mfa',
				expectedTarget: { targetPath: '/mfa' },
			});
			expect(document.getElementById('autofill-site').checked).toBe(true);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		},
	);
	it('does not revive delayed popup autofill after the same document changes its route', async () => {
		const state = { targetPath: '/mfa', autoFillAccountId: ACCOUNT.id };
		const sendMessage = installChromeMock(state);
		await loadPopup();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
		state.targetPath = '/another-mfa';
		await vi.advanceTimersByTimeAsync(5020);
		await flushPromises();
		expect(field('preview-status').textContent).toContain('网站或账户已发生变化');
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});
	it('hands the authorization intent to the worker before requesting permission and keeps the pending checkbox selected', async () => {
		const sendMessage = installChromeMock();
		await loadPopup();
		const permission = deferred();
		chrome.permissions.request.mockImplementationOnce(() => {
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
			return permission.promise;
		});
		const toggle = document.getElementById('autofill-site');
		toggle.click();
		expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://login.example/*'] });
		expect(toggle.checked).toBe(true);
		expect(toggle.disabled).toBe(true);
		expect(toggle.getAttribute('aria-busy')).toBe('true');
		expect(document.getElementById('status').textContent).toContain('正在开启');
		const [intent] = messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION');
		expect(intent).toEqual({
			type: 'BEGIN_AUTOFILL_AUTHORIZATION',
			requestId: expect.stringMatching(/^[a-f0-9]{36}$/),
			instanceOrigin: 'https://twofa.example',
			mode: 'session',
			configurationGeneration: '0123456789abcdef0123456789abcdef012345',
			targetOrigin: 'https://login.example',
			targetPath: '*',
			pagePath: '/',
			expectedTarget: { tabId: 7, documentId: 'target-document', origin: 'https://login.example', targetPath: '/' },
		});
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		permission.resolve(true);
		await flushPromises();
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toEqual([
			{ type: 'COMPLETE_AUTOFILL_AUTHORIZATION', requestId: intent.requestId },
		]);
		expect(toggle.checked).toBe(true);
		expect(toggle.disabled).toBe(false);
		expect(toggle.getAttribute('aria-busy')).toBe('false');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		const previewNonce = messages(sendMessage, 'COPY_ACCOUNT_CODE').at(-1).nonce;
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1).nonce).not.toBe(previewNonce);
	});
	it.each(['https://login.example', 'http://192.168.1.1', 'http://login.example'])(
		'keeps manual access available when the user denies the optional permission for %s',
		async (targetOrigin) => {
			const sendMessage = installChromeMock({ targetOrigin });
			chrome.permissions.request.mockResolvedValue(false);
			await loadPopup();
			const toggle = document.getElementById('autofill-site');
			toggle.click();
			await flushPromises();
			expect(toggle.checked).toBe(false);
			expect(toggle.disabled).toBe(false);
			expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toHaveLength(0);
			expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
			expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			expect(document.getElementById('status').textContent).toContain('未授予此网站');
			expect(field('account-fill').disabled).toBe(false);
			field('account-fill').click();
			await flushPromises();
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ account: ACCOUNT })]);
			expect(messages(sendMessage, 'FILL_ACCOUNT')[0]).not.toHaveProperty('automatic');
		},
	);
	it.each(['TARGET_CHANGED', 'REQUEST_EXPIRED', 'PERMISSION_REQUIRED'])(
		'rolls back pending display when the worker rejects authorization with %s',
		async (code) => {
			const sendMessage = installChromeMock();
			const original = sendMessage.getMockImplementation();
			sendMessage.mockImplementation((message) =>
				message.type === 'COMPLETE_AUTOFILL_AUTHORIZATION'
					? Promise.resolve({ ok: false, error: { code, message: '授权条件已变化' } })
					: original(message),
			);
			await loadPopup();
			const toggle = document.getElementById('autofill-site');
			toggle.click();
			await flushPromises();
			expect(toggle.checked).toBe(false);
			expect(toggle.disabled).toBe(false);
			expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			expect(document.getElementById('status').textContent).toBe(ERROR_LOCALES['zh-CN'][`error_${code}`]);
		},
	);
	it('leaves the worker authorization intent alive when the permission prompt closes the popup', async () => {
		const sendMessage = installChromeMock();
		const permission = deferred();
		chrome.permissions.request.mockReturnValueOnce(permission.promise);
		await loadPopup();
		document.getElementById('autofill-site').click();
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		window.dispatchEvent(new Event('pagehide'));
		permission.resolve(true);
		await flushPromises();
		expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
	});
	it('disables an enabled site without requesting or removing shared host permissions', async () => {
		const sendMessage = installChromeMock();
		await sendMessage({
			type: 'SET_AUTOFILL_SITE',
			instanceOrigin: 'https://twofa.example',
			targetOrigin: 'https://login.example',
			targetPath: '/',
			enabled: true,
		});
		await loadPopup();
		expect(document.getElementById('autofill-site').checked).toBe(true);
		const accountCard = card();
		const starts = messages(sendMessage, 'START_FLOW').length;
		const authorizationReads = messages(sendMessage, 'GET_AUTOFILL_SITES').length;
		document.getElementById('autofill-site').click();
		await flushPromises(false);
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE').at(-1)).toEqual({
			type: 'SET_AUTOFILL_SITE',
			instanceOrigin: 'https://twofa.example',
			targetOrigin: 'https://login.example',
			targetPath: '/',
			enabled: false,
		});
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(chrome.permissions.remove).not.toHaveBeenCalled();
		expect(document.getElementById('autofill-site').checked).toBe(false);
		expect(document.getElementById('status').textContent).toBe('已停用此页面自动填充');
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(starts);
		expect(messages(sendMessage, 'GET_AUTOFILL_SITES')).toHaveLength(authorizationReads);
		expect(card()).toBe(accountCard);
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(starts + 1);
		expect(messages(sendMessage, 'START_FLOW').at(-1).refreshSource).toBe(false);
	});
	it.each(['AUTH_REQUIRED', 'SOURCE_UNAVAILABLE', 'SOURCE_OFFLINE'])(
		'keeps revocation successful when %s prevents subsequent previews from loading',
		async (code) => {
			const sendMessage = installChromeMock({
				initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
			});
			await loadPopup();
			const starts = messages(sendMessage, 'START_FLOW').length;
			const original = sendMessage.getMockImplementation();
			sendMessage.mockImplementation((message) =>
				message.type === 'START_FLOW' ? Promise.resolve({ ok: false, error: { code, message: '2FA 暂时无法连接' } }) : original(message),
			);
			const toggle = document.getElementById('autofill-site');
			toggle.click();
			await flushPromises(false);
			expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toEqual([
				{
					type: 'SET_AUTOFILL_SITE',
					instanceOrigin: 'https://twofa.example',
					targetOrigin: 'https://login.example',
					targetPath: '/',
					enabled: false,
				},
			]);
			expect(messages(sendMessage, 'START_FLOW')).toHaveLength(starts);
			expect(document.getElementById('status').textContent).toBe('已停用此页面自动填充');
			expect(toggle.checked).toBe(false);
			expect(toggle.disabled).toBe(false);
			await flushPromises();
			expect(field('preview-status').textContent).toBe(ERROR_LOCALES['zh-CN'][`error_${code}`]);
			expect(document.getElementById('open-source').hidden).toBe(false);
			expect(document.getElementById('account-section').hidden).toBe(false);
			expect(toggle.checked).toBe(false);
			expect(toggle.disabled).toBe(false);
			expect((await sendMessage({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([]);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			const calls = sendMessage.mock.calls.length;
			await vi.advanceTimersByTimeAsync(60000);
			expect(sendMessage).toHaveBeenCalledTimes(calls);
		},
	);
	it.each(['AUTH_REQUIRED', 'SOURCE_OFFLINE', 'PERMISSION_REQUIRED'])(
		'allows revocation on first open when %s prevents reading any accounts',
		async (code) => {
			const sendMessage = installChromeMock({
				initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
			});
			const original = sendMessage.getMockImplementation();
			sendMessage.mockImplementation((message) =>
				message.type === 'START_FLOW' ? Promise.resolve({ ok: false, error: { code, message: '账户暂时不可用' } }) : original(message),
			);
			await loadPopup();
			const toggle = document.getElementById('autofill-site');
			expect(toggle.closest('label').hidden).toBe(false);
			expect(toggle.disabled).toBe(false);
			expect(toggle.checked).toBe(true);
			expect(messages(sendMessage, 'GET_AUTOFILL_CONTEXT')).toHaveLength(1);
			toggle.click();
			await flushPromises();
			expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toEqual([
				{
					type: 'SET_AUTOFILL_SITE',
					instanceOrigin: 'https://twofa.example',
					targetOrigin: 'https://login.example',
					targetPath: '/',
					enabled: false,
				},
			]);
			expect(toggle.checked).toBe(false);
			expect(document.getElementById('status').textContent).toBe('已停用此页面自动填充');
			expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
			expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(0);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
			expect(chrome.permissions.request).not.toHaveBeenCalled();
		},
	);
	it('loads and revokes existing authorization when the account list is empty', async () => {
		const sendMessage = installChromeMock({
			accounts: [],
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		await loadPopup();
		expect(document.getElementById('remember-binding').closest('label').hidden).toBe(true);
		const toggle = document.getElementById('autofill-site');
		expect(toggle.checked).toBe(true);
		expect(toggle.disabled).toBe(false);
		toggle.click();
		await flushPromises();
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')[0].enabled).toBe(false);
		expect(toggle.checked).toBe(false);
		expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
	});
	it('ignores an authorization recovery response delivered after the popup closes', async () => {
		const sendMessage = installChromeMock();
		const pending = deferred();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) => {
			if (message.type === 'START_FLOW') {
				return Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请登录' } });
			}
			return message.type === 'GET_AUTOFILL_CONTEXT' ? pending.promise : original(message);
		});
		await loadPopup();
		window.dispatchEvent(new Event('pagehide'));
		pending.resolve(await original({ type: 'GET_AUTOFILL_CONTEXT' }));
		await flushPromises();
		expect(document.getElementById('autofill-site').closest('label').hidden).toBe(true);
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toHaveLength(0);
	});
	it.each(['unavailable', 'empty', 'search-empty', 'login-mismatch'])(
		'renews the grant context after revocation with %s accounts',
		async (scenario) => {
			const targetOrigin = scenario === 'login-mismatch' ? 'https://accounts.google.com' : 'https://login.example';
			const state = {
				accounts: ['search-empty', 'login-mismatch'].includes(scenario) ? [ACCOUNT] : [],
				targetOrigin,
				...(scenario === 'login-mismatch' ? { loginContext: { provider: 'google', email: 'another@example.com' } } : {}),
				configurationGeneration: 'a'.repeat(36),
				initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin, targetPath: '/' }],
			};
			const sendMessage = installChromeMock(state);
			const original = sendMessage.getMockImplementation();
			sendMessage.mockImplementation(async (message) => {
				if (message.type === 'START_FLOW' && scenario === 'unavailable') {
					return { ok: false, error: { code: 'AUTH_REQUIRED', message: '请登录' } };
				}
				if (message.type === 'BEGIN_AUTOFILL_AUTHORIZATION' && message.configurationGeneration !== state.configurationGeneration) {
					return { ok: false, error: { code: 'REQUEST_EXPIRED', message: '本次请求已过期' } };
				}
				const result = await original(message);
				if (message.type === 'SET_AUTOFILL_SITE') {
					state.configurationGeneration = 'b'.repeat(36);
				}
				return result;
			});
			await loadPopup();
			if (scenario === 'search-empty') {
				inputSearch('no matching account');
				await vi.advanceTimersByTimeAsync(130);
				await flushPromises();
			}
			expect(renderedAccountIds()).toEqual([]);
			const starts = messages(sendMessage, 'START_FLOW').length;
			const toggle = document.getElementById('autofill-site');
			toggle.click();
			await flushPromises();
			expect(toggle.checked).toBe(false);
			expect(messages(sendMessage, 'START_FLOW')).toHaveLength(starts);
			toggle.click();
			await flushPromises();
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')[0].configurationGeneration).toBe('b'.repeat(36));
			expect(toggle.checked).toBe(true);
		},
	);
	it('invalidates recovered authorization when settings change without an account flow', async () => {
		const sendMessage = installChromeMock({
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'START_FLOW'
				? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请登录' } })
				: original(message),
		);
		await loadPopup();
		const toggle = document.getElementById('autofill-site');
		expect(toggle.checked).toBe(true);
		for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
			listener({ settings: { newValue: { instanceOrigin: 'https://other.example' } } }, 'local');
		}
		await flushPromises();
		expect(toggle.disabled).toBe(true);
		expect(document.getElementById('status').textContent).toContain('设置已变化');
		toggle.click();
		await flushPromises();
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toHaveLength(0);
	});
	it('does not restore a reset empty-account authorization from a delayed post-revocation read', async () => {
		const sendMessage = installChromeMock({
			accounts: [],
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'GET_AUTOFILL_CONTEXT' ? pending.promise : original(message)));
		await loadPopup();
		document.getElementById('autofill-site').click();
		await flushPromises();
		for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
			listener({ settings: { newValue: { instanceOrigin: 'https://other.example' } } }, 'local');
		}
		pending.resolve(await original({ type: 'GET_AUTOFILL_CONTEXT' }));
		await flushPromises();
		expect(document.getElementById('autofill-site').disabled).toBe(true);
		expect(document.getElementById('status').textContent).toContain('设置已变化');
	});
	it('keeps configuration invalidation visible when an earlier revocation response arrives', async () => {
		const sendMessage = installChromeMock({
			accounts: [],
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'SET_AUTOFILL_SITE' ? pending.promise : original(message)));
		await loadPopup();
		document.getElementById('autofill-site').click();
		await flushPromises();
		for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
			listener({ settings: { newValue: { instanceOrigin: 'https://other.example' } } }, 'local');
		}
		pending.resolve({ ok: true, data: { instanceOrigin: 'https://twofa.example', sites: [] } });
		await flushPromises();
		expect(document.getElementById('autofill-site').disabled).toBe(true);
		expect(document.getElementById('status').textContent).toContain('设置已变化');
		expect(messages(sendMessage, 'GET_AUTOFILL_CONTEXT')).toHaveLength(0);
	});
	it('renews an unused nonce after revocation before loading the first preview', async () => {
		const sendMessage = installChromeMock({
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		renderPopup();
		await import('../../extension/src/popup/index.js');
		await flushPromises(false);
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(0);
		document.getElementById('autofill-site').click();
		await flushPromises(false);
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW', 'SET_AUTOFILL_SITE']);
		await flushPromises();
		expect(messages(sendMessage).map((message) => message.type)).toEqual([
			'START_FLOW',
			'SET_AUTOFILL_SITE',
			'START_FLOW',
			'COPY_ACCOUNT_CODE',
		]);
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')[0].nonce).toBe('nonce-2');
	});
	it('revokes the captured path after navigation without removing the new path authorization', async () => {
		const state = {
			targetPath: '/old',
			initialAutofillSites: ['/old', '/new'].map((targetPath) => ({
				instanceOrigin: 'https://twofa.example',
				targetOrigin: 'https://login.example',
				targetPath,
			})),
		};
		const sendMessage = installChromeMock(state);
		await loadPopup();
		state.targetPath = '/new';
		document.getElementById('autofill-site').click();
		await flushPromises();
		expect(messages(sendMessage, 'SET_AUTOFILL_SITE')).toEqual([
			{
				type: 'SET_AUTOFILL_SITE',
				instanceOrigin: 'https://twofa.example',
				targetOrigin: 'https://login.example',
				targetPath: '/old',
				enabled: false,
			},
		]);
		expect((await sendMessage({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
			{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/new' },
		]);
		expect(document.getElementById('autofill-site').checked).toBe(false);
		expect(field('preview-status').textContent).toContain('网站或账户已发生变化');
	});
	it('keeps authorization checked when the worker rejects revocation after an instance change', async () => {
		const sendMessage = installChromeMock({
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin: 'https://login.example', targetPath: '/' }],
		});
		await loadPopup();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'SET_AUTOFILL_SITE'
				? Promise.resolve({ ok: false, error: { code: 'REQUEST_EXPIRED', message: '实例已变化，请重新打开扩展' } })
				: original(message),
		);
		document.getElementById('autofill-site').click();
		await flushPromises();
		expect(document.getElementById('autofill-site').checked).toBe(true);
		expect(document.getElementById('autofill-site').disabled).toBe(false);
		expect(document.getElementById('status').textContent).toBe('实例已变化，请重新打开扩展');
		expect(field('preview-code').textContent).toBe('012345');
	});
	it.each([
		{ canFill: false },
		{ targetOrigin: 'https://twofa.example' },
		{ targetOrigin: null, targetTabId: null, targetDocumentId: null },
	])('hides authorization for unsupported targets: %j', async (overrides) => {
		installChromeMock(overrides);
		await loadPopup();
		expect(document.getElementById('autofill-site').closest('label').hidden).toBe(true);
	});
	it.each([
		'http://localhost:8123',
		'http://127.0.0.1:8123',
		'http://192.168.1.1',
		'http://10.0.0.1:8123',
		'http://172.16.0.10:8080',
		'http://169.254.1.1',
		'http://172.16.0.10.evil.example',
		'http://login.example',
		'https://10.0.0.1:8123',
		'https://172.16.0.10:8123',
		'https://192.168.1.20:8123',
	])('authorizes %s by host pattern while preserving the exact port in stored scope', async (origin) => {
		const sendMessage = installChromeMock({ targetOrigin: origin, targetPath: '/mfa' });
		await loadPopup();
		const toggle = document.getElementById('autofill-site');
		expect(toggle.closest('label').hidden).toBe(false);
		expect(toggle.disabled).toBe(false);
		expect(toggle.checked).toBe(false);
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		toggle.click();
		await flushPromises();
		const url = new URL(origin);
		expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [`${url.protocol}//${url.hostname}/*`] });
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')[0]).toMatchObject({
			targetOrigin: origin,
			targetPath: '*',
			pagePath: '/mfa',
			expectedTarget: { tabId: 7, documentId: 'target-document', origin, targetPath: '/mfa' },
		});
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		expect(toggle.checked).toBe(true);
		expect(toggle.disabled).toBe(false);
		expect((await sendMessage({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
			{ instanceOrigin: 'https://twofa.example', targetOrigin: origin, targetPath: '*', pagePath: '/mfa' },
		]);
	});
	it.each([
		'http://192.168.1.1',
		'http://10.0.0.1:8123',
		'http://172.16.0.10:8080',
		'http://169.254.1.1',
		'http://172.16.0.10.evil.example',
		'http://insecure.example',
	])('automatically fills an already authorized HTTP page at %s', async (targetOrigin) => {
		const sendMessage = installChromeMock({
			targetOrigin,
			autoFillAccountId: ACCOUNT.id,
			initialAutofillSites: [{ instanceOrigin: 'https://twofa.example', targetOrigin, targetPath: '/' }],
		});
		await loadPopup();
		const checkbox = document.getElementById('autofill-site');
		const label = checkbox.closest('label');
		expect(label.hidden).toBe(false);
		expect(checkbox.disabled).toBe(false);
		expect(checkbox.checked).toBe(true);
		expect(label.title).toBe(LOCALES['zh-CN'].popupAutofillHint);
		expect(document.getElementById('autofill-description').textContent).toBe(LOCALES['zh-CN'].popupAutofillDescription);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ automatic: true, account: ACCOUNT })]);
		expect(messages(sendMessage, 'GET_AUTOFILL_SITES')).toHaveLength(1);
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
	});
	it('translates the normal HTTP authorization hint when another surface changes the language', async () => {
		installChromeMock({ targetOrigin: 'http://192.168.1.1' });
		await loadPopup();
		for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
			listener({ type: 'LANGUAGE_CHANGED', preference: 'en' }, {});
		}
		expect(document.getElementById('autofill-site').closest('label').title).toBe(LOCALES.en.popupAutofillSiteHint);
		expect(document.getElementById('autofill-description').textContent).toBe(LOCALES.en.popupAutofillSiteDescription);
		expect(document.getElementById('autofill-title').textContent).toBe(LOCALES.en.popupAutofillSiteTitle);
	});
	it('does not infer authorization from another instance or accept a stale settings read', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'GET_AUTOFILL_SITES'
				? Promise.resolve({ ok: true, data: { instanceOrigin: 'https://other-instance.example', sites: [] } })
				: original(message),
		);
		await loadPopup();
		expect(document.getElementById('autofill-site').disabled).toBe(true);
		expect(document.getElementById('status').textContent).toContain('实例已变化');
	});
});

describe('Popup visible account cards', () => {
	it('guides an unconfigured installation to deployment and opens settings only on request', async () => {
		const sendMessage = installChromeMock();
		sendMessage.mockResolvedValue({ ok: false, error: { code: 'NOT_CONFIGURED', message: '未配置实例' } });
		await loadPopup();
		expect(document.getElementById('setup-guide').hidden).toBe(false);
		expect(document.getElementById('account-section').hidden).toBe(true);
		expect(document.getElementById('actions').hidden).toBe(true);
		expect(document.getElementById('status').dataset.tone).toBe('notice');
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW']);
		expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
		document.getElementById('setup-options').click();
		expect(chrome.runtime.openOptionsPage).toHaveBeenCalledOnce();
	});
	it('does not mistake an expired existing login for an undeployed instance', async () => {
		const sendMessage = installChromeMock();
		sendMessage.mockResolvedValue({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请重新登录' } });
		await loadPopup();
		expect(document.getElementById('setup-guide').hidden).toBe(true);
		expect(document.getElementById('open-source').hidden).toBe(false);
	});
	it('copies the future code on its own button and names it in the toast without filling', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const next = field('preview-next-code');
		expect(next.tagName).toBe('BUTTON');
		next.click();
		expect(writeText).toHaveBeenCalledWith('654321');
		await flushPromises();
		expect(document.getElementById('copy-toast').textContent).toContain('下一组验证码已复制');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		field('preview-code').click();
		expect(writeText).toHaveBeenLastCalledWith('012345');
		await flushPromises();
		expect(document.getElementById('copy-toast-message').textContent).toBe('验证码已复制');
		emitVisibility({ 'account-id': false });
		expect(next.disabled).toBe(true);
		next.click();
		expect(writeText).toHaveBeenCalledTimes(2);
	});

	it('uses the main service resolver and instance favicon endpoint, with a letter fallback on error', async () => {
		installChromeMock({ accounts: [{ ...ACCOUNT, name: 'GitHub' }] });
		await loadPopup();
		const icon = card().querySelector('.service-icon img');
		const fallback = field('service-icon-fallback');
		expect(icon.src).toBe('https://twofa.example/api/favicon/github.com');
		expect(icon.referrerPolicy).toBe('no-referrer');
		expect(fallback.textContent).toBe('G');
		icon.dispatchEvent(new Event('load'));
		expect(icon.hidden).toBe(false);
		expect(fallback.hidden).toBe(true);
		icon.dispatchEvent(new Event('error'));
		expect(icon.hidden).toBe(true);
		expect(fallback.hidden).toBe(false);
	});

	it('uses initials for unrecognized services without requesting an invented icon URL', async () => {
		installChromeMock();
		await loadPopup();
		expect(card().querySelector('.service-icon img').hasAttribute('src')).toBe(false);
		expect(field('service-icon-fallback').textContent).toBe('E');
	});
	it('shows a cached service icon in offline mode without a remote image URL', async () => {
		const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
		installChromeMock({ authMode: 'offline', accounts: [{ ...ACCOUNT, name: 'GitHub' }], serviceIcons: { 'github.com': dataUrl } });
		await loadPopup();
		const icon = card().querySelector('.service-icon img');
		expect(icon.src).toBe(dataUrl);
		icon.dispatchEvent(new Event('load'));
		expect(icon.hidden).toBe(false);
		expect(field('service-icon-fallback').hidden).toBe(true);
	});
	it.each([undefined, { 'github.com': 'https://untrusted.example/icon.png' }])(
		'keeps an offline letter fallback when no usable cached icon exists',
		async (serviceIcons) => {
			installChromeMock({ authMode: 'offline', accounts: [{ ...ACCOUNT, name: 'GitHub' }], serviceIcons });
			await loadPopup();
			expect(card().querySelector('.service-icon img').hasAttribute('src')).toBe(false);
			expect(field('service-icon-fallback').textContent).toBe('G');
		},
	);
	it('shows both codes directly with the main page progress bar without filling or copying', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		expect(card()).not.toBeNull();
		expect(document.getElementById('status').hidden).toBe(true);
		expect(document.querySelector('.search-label')).toBeNull();
		expect(document.getElementById('account-search').getAttribute('aria-label')).toBe('搜索服务或账户名称');
		expect(field('account-name').textContent).toBe('Example');
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-code').tagName).toBe('BUTTON');
		expect(field('account-fill').textContent).toContain('填充');
		expect(document.querySelector('[data-view-account-id], .account-view, #copy-code, progress')).toBeNull();
		const progress = field('progress-top');
		expect(progress.getAttribute('role')).toBe('progressbar');
		expect(progress.getAttribute('aria-valuemax')).toBe('30');
		expect(progress.getAttribute('aria-valuenow')).toBe('5');
		expect(progress.getAttribute('aria-valuetext')).toBe('剩余 5 秒');
		expect(progress.querySelector('.progress-top-fill')).not.toBeNull();
		expect(field('preview-next').hidden).toBe(false);
		expect(field('preview-next-code').textContent).toBe('654321');
		expect(field('preview-next-time').textContent).toBe('5 秒后生效');
		expect(document.querySelector('.preview-next-toggle')).toBeNull();
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW', 'COPY_ACCOUNT_CODE']);
		expect(sendMessage).toHaveBeenLastCalledWith({ type: 'COPY_ACCOUNT_CODE', nonce: 'nonce-1', account: ACCOUNT, includeNext: true });
		expect(writeText).not.toHaveBeenCalled();
		expect(document.getElementById('account-search').disabled).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(progress.getAttribute('aria-valuenow')).toBe('4');
		expect(progress.getAttribute('aria-valuetext')).toBe('剩余 4 秒');
		expect(field('preview-next-time').textContent).toBe('4 秒后生效');
	});

	it('only fetches cards intersecting the account scroller and gives every request a fresh nonce', async () => {
		const sendMessage = installManyAccounts();
		await loadPopup();
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2', 'ns3', 'ns4']);
		expect(MockIntersectionObserver.instances.at(-1).root).toBe(document.getElementById('accounts'));
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').map((message) => [message.account.id, message.nonce])).toEqual([
			['ns1', 'nonce-1'],
			['ns2', 'nonce-1'],
		]);
		expect(field('preview-code', 'ns1').textContent).toBe('012345');
		expect(field('preview-code', 'ns2').textContent).toBe('012345');
		expect(field('preview-code', 'ns3').textContent).toBe('------');
		expect(field('preview-code', 'ns4').textContent).toBe('------');
		expect(field('preview-next-code', 'ns1').textContent).toBe('654321');
		expect(field('preview-next-code', 'ns2').textContent).toBe('654321');
		expect(field('preview-next-code', 'ns3').textContent).toBe('------');
		expect(field('preview-next-code', 'ns4').textContent).toBe('------');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').every((message) => message.includeNext)).toBe(true);
		emitVisibility({ ns1: true, ns2: true });
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(2);
	});

	it('clears offscreen codes, stops their refresh and reloads them when scrolled back in', async () => {
		const sendMessage = installManyAccounts();
		await loadPopup();
		emitVisibility({ ns1: false, ns3: true });
		expect(field('preview-code', 'ns1').textContent).toBe('------');
		expect(field('preview-next-code', 'ns1').textContent).toBe('------');
		expect(field('preview-code', 'ns1').disabled).toBe(true);
		await flushPromises();
		expect(field('preview-code', 'ns3').textContent).toBe('012345');
		expect(field('preview-next-code', 'ns3').textContent).toBe('654321');
		vi.advanceTimersByTime(5000);
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').map((message) => message.account.id)).toEqual(['ns1', 'ns2', 'ns3', 'ns2', 'ns3']);
		emitVisibility({ ns1: true, ns3: false });
		await flushPromises();
		expect(field('preview-code', 'ns1').textContent).toBe('012345');
		expect(field('preview-code', 'ns3').textContent).toBe('------');
		expect(field('preview-next-code', 'ns3').textContent).toBe('------');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').at(-1).account.id).toBe('ns1');
	});

	it('serializes code requests, skips offscreen queued cards and discards an old card response', async () => {
		const sendMessage = installManyAccounts();
		const original = sendMessage.getMockImplementation();
		const pendingAlice = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODES' ? pendingAlice.promise : original(message)));
		await loadPopup();
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW', 'COPY_ACCOUNT_CODES']);
		emitVisibility({ ns1: false, ns2: false, ns3: true });
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(2);
		pendingAlice.resolve({ ok: true, data: ['ns1', 'ns2'].map((id) => ({ id, ...codeResponse('111111').data })) });
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').map((message) => [message.account.id, message.nonce])).toEqual([
			['ns1', 'nonce-1'],
			['ns2', 'nonce-1'],
			['ns3', 'nonce-2'],
		]);
		expect(field('preview-code', 'ns1').textContent).toBe('------');
		expect(field('preview-code', 'ns2').textContent).toBe('------');
		expect(field('preview-code', 'ns3').textContent).toBe('012345');
	});

	it('does not apply an old response to a newly rendered card for the same account', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		let firstCopy = true;
		sendMessage.mockImplementation((message) => {
			if (message.type === 'COPY_ACCOUNT_CODE' && firstCopy) {
				firstCopy = false;
				return pending.promise;
			}
			return original(message);
		});
		await loadPopup();
		const oldCard = card();
		inputSearch('does-not-exist');
		vi.advanceTimersByTime(130);
		inputSearch('');
		await flushPromises();
		expect(card()).not.toBe(oldCard);
		expect(oldCard.isConnected).toBe(false);
		pending.resolve(codeResponse('111111'));
		await flushPromises();
		expect(oldCard.querySelector('.preview-code').textContent).toBe('------');
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').map((message) => message.nonce)).toEqual(['nonce-1', 'nonce-2']);
	});

	it('copies the current code synchronously and shows a temporary toast without replacing the page status', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const status = document.getElementById('status').textContent;
		const toast = document.getElementById('copy-toast');
		expect(toast.hidden).toBe(true);
		expect(toast.getAttribute('role')).toBe('status');
		field('preview-code').click();
		// The clipboard call must start within this click's user gesture.
		expect(writeText).toHaveBeenCalledExactlyOnceWith('012345');
		await flushPromises(false);
		expect(document.getElementById('status').textContent).toBe(status);
		expect(toast.hidden).toBe(false);
		expect(toast.textContent).toContain('验证码已复制');
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage)).toHaveLength(2);
		vi.advanceTimersByTime(1999);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(1);
		expect(toast.hidden).toBe(true);
	});

	it('copies the current code from card content without filling or fetching again', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const requestCount = messages(sendMessage).length;
		for (const target of [card(), field('account-name'), field('account-detail'), field('service-icon'), field('progress-top-fill')]) {
			writeText.mockClear();
			target.click();
			expect(writeText).toHaveBeenCalledExactlyOnceWith('012345');
			await flushPromises(false);
			expect(document.getElementById('copy-toast-message').textContent).toBe('验证码已复制');
		}
		expect(messages(sendMessage)).toHaveLength(requestCount);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it('shows both codes immediately and copying either does not trigger filling', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		expect(field('preview-next').hidden).toBe(false);
		expect(field('preview-next-code').textContent).toBe('654321');
		expect(field('preview-next-time').textContent).toBe('5 秒后生效');
		expect(sendMessage).toHaveBeenLastCalledWith({ type: 'COPY_ACCOUNT_CODE', nonce: 'nonce-1', account: ACCOUNT, includeNext: true });
		field('preview-next-code').click();
		expect(writeText).toHaveBeenCalledExactlyOnceWith('654321');
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		field('preview-code').click();
		expect(writeText).toHaveBeenLastCalledWith('012345');
		await flushPromises();
		expect(field('preview-next').hidden).toBe(false);
		expect(field('preview-next-code').textContent).toBe('654321');
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage)).toHaveLength(2);
	});

	it('keeps focus on the code while copying and prevents repeated clipboard requests', async () => {
		installChromeMock();
		const writeText = installClipboard();
		const pending = deferred();
		writeText.mockImplementationOnce(() => pending.promise);
		await loadPopup();
		const code = field('preview-code');
		code.focus();
		code.click();
		expect(code.disabled).toBe(false);
		expect(code.getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(code);
		code.click();
		card().click();
		expect(writeText).toHaveBeenCalledExactlyOnceWith('012345');
		pending.resolve();
		await flushPromises();
		expect(code.getAttribute('aria-disabled')).not.toBe('true');
		expect(code.disabled).toBe(false);
		expect(document.activeElement).toBe(code);
		expect(document.getElementById('copy-toast').hidden).toBe(false);
	});

	it('resets the toast timer on another successful copy', async () => {
		installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const toast = document.getElementById('copy-toast');
		field('preview-code').click();
		await flushPromises(false);
		vi.advanceTimersByTime(1000);
		field('preview-code').click();
		await flushPromises(false);
		expect(writeText).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1000);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(999);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(1);
		expect(toast.hidden).toBe(true);
	});

	it('does not show a success toast when copying fails', async () => {
		installChromeMock();
		const writeText = installClipboard();
		writeText.mockRejectedValueOnce(new Error('Clipboard blocked'));
		await loadPopup();
		field('preview-code').click();
		await flushPromises();
		expect(document.getElementById('copy-toast').hidden).toBe(true);
		expect(document.getElementById('status').textContent).not.toBe('验证码已复制');
		expect(field('preview-code').disabled).toBe(false);
		expect(field('preview-code').getAttribute('aria-disabled')).not.toBe('true');
	});

	it('hides the toast and cancels its timer when the popup closes', async () => {
		installChromeMock();
		installClipboard();
		await loadPopup();
		field('preview-code').click();
		await flushPromises();
		const toast = document.getElementById('copy-toast');
		expect(toast.hidden).toBe(false);
		window.dispatchEvent(new Event('pagehide'));
		expect(toast.hidden).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(30000);
		expect(toast.hidden).toBe(true);
	});

	it('does not restore a toast when a pending clipboard operation completes after closing', async () => {
		installChromeMock();
		const writeText = installClipboard();
		const pending = deferred();
		writeText.mockImplementationOnce(() => pending.promise);
		await loadPopup();
		field('preview-code').click();
		window.dispatchEvent(new Event('pagehide'));
		pending.resolve();
		await flushPromises();
		expect(document.getElementById('copy-toast').hidden).toBe(true);
		expect(field('preview-code').textContent).toBe('------');
		expect(field('preview-next-code').textContent).toBe('------');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores a stale clipboard completion after its card leaves and reenters the viewport', async () => {
		installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const pending = deferred();
		writeText.mockImplementationOnce(() => pending.promise);
		field('preview-code').click();
		emitVisibility({ 'account-id': false });
		emitVisibility({ 'account-id': true });
		await flushPromises();
		const status = document.getElementById('status').textContent;
		pending.resolve();
		await flushPromises();
		expect(document.getElementById('status').textContent).toBe(status);
		expect(document.getElementById('status').textContent).not.toBe('验证码已复制');
		expect(document.getElementById('copy-toast').hidden).toBe(true);
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-code').disabled).toBe(false);
	});

	it('disables copying near expiry, clears expired codes and refreshes without overlapping requests', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODE' ? pending.promise : original(message)));
		vi.advanceTimersByTime(3999);
		expect(field('preview-code').disabled).toBe(false);
		vi.advanceTimersByTime(1);
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-code').disabled).toBe(true);
		field('preview-code').click();
		card().click();
		expect(writeText).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		await flushPromises();
		expect(field('preview-code').textContent).toBe('654321');
		expect(field('preview-next-code').textContent).toBe('------');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').map((message) => message.nonce)).toEqual(['nonce-1', 'nonce-2']);
		vi.advanceTimersByTime(5000);
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(2);
		pending.resolve(codeResponse('654321'));
		await flushPromises();
		expect(field('preview-code').textContent).toBe('654321');
		expect(field('progress-top').getAttribute('aria-valuenow')).toBe('5');
	});

	it('offers an explicit retry after a failed card request without repeated background requests', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		let firstCopy = true;
		sendMessage.mockImplementation((message) => {
			if (message.type === 'COPY_ACCOUNT_CODE' && firstCopy) {
				firstCopy = false;
				return Promise.resolve({ ok: false, error: { code: 'NO_BRIDGE', message: '请重新打开 2FA 页面' } });
			}
			return original(message);
		});
		await loadPopup();
		expect(field('preview-status').textContent).toBe('请重新打开 2FA 页面');
		expect(field('preview-retry').hidden).toBe(false);
		expect(field('preview-code').disabled).toBe(true);
		vi.advanceTimersByTime(30000);
		await flushPromises();
		expect(messages(sendMessage)).toHaveLength(2);
		field('preview-retry').click();
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-retry').hidden).toBe(true);
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE').at(-1).nonce).toBe('nonce-2');
	});

	it('clears all codes, drops pending/queued responses and stops timers when the popup closes', async () => {
		const sendMessage = installManyAccounts();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODES' ? pending.promise : original(message)));
		await loadPopup();
		window.dispatchEvent(new Event('pagehide'));
		pending.resolve(codeResponse());
		await flushPromises();
		vi.advanceTimersByTime(30000);
		await flushPromises();
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW', 'COPY_ACCOUNT_CODES']);
		for (const code of document.querySelectorAll('.preview-code, .preview-next-code')) {
			expect(code.textContent).toBe('------');
		}
		expect(vi.getTimerCount()).toBe(0);
		expect(MockIntersectionObserver.instances.every((observer) => observer.observed.size === 0)).toBe(true);
	});

	it('clears already displayed current and next codes and stops their countdowns when closed', async () => {
		const sendMessage = installChromeMock();
		await loadPopup();
		expect(field('preview-next-code').textContent).toBe('654321');
		window.dispatchEvent(new Event('pagehide'));
		expect(field('preview-code').textContent).toBe('------');
		expect(field('preview-next-code').textContent).toBe('------');
		expect(field('preview-next').hidden).toBe(false);
		vi.advanceTimersByTime(30000);
		await flushPromises();
		expect(messages(sendMessage)).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('Popup explicit source recovery', () => {
	it.each(['SOURCE_OFFLINE', 'AUTH_REQUIRED', 'SOURCE_UNAVAILABLE'])(
		'offers an action for %s without opening or retrying automatically',
		async (code) => {
			const sendMessage = installChromeMock();
			const original = sendMessage.getMockImplementation();
			sendMessage.mockImplementation((message) =>
				message.type === 'START_FLOW' ? Promise.resolve({ ok: false, error: { code, message: '来源页面需要处理' } }) : original(message),
			);
			await loadPopup();
			const open = document.getElementById('open-source');
			expect(open.hidden).toBe(false);
			expect(document.getElementById('actions').hidden).toBe(false);
			expect(document.getElementById('status').textContent).toBe(ERROR_LOCALES['zh-CN'][`error_${code}`]);
			expect(document.getElementById('status').hidden).toBe(false);
			vi.advanceTimersByTime(30000);
			await flushPromises();
			expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW']);
			document.getElementById('retry').click();
			await flushPromises();
			expect(messages(sendMessage, 'OPEN_INSTANCE')).toHaveLength(0);
			open.click();
			open.click();
			await flushPromises();
			expect(messages(sendMessage, 'OPEN_INSTANCE')).toEqual([{ type: 'OPEN_INSTANCE' }]);
			expect(document.getElementById('status').textContent).toContain('回到目标网站重试');
		},
	);

	it('shows recovery when the session expires during automatic refresh, and clears it after a successful retry', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		await loadPopup();
		sendMessage.mockImplementation((message) =>
			message.type === 'START_FLOW'
				? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '2FA 登录已失效' } })
				: original(message),
		);
		await vi.advanceTimersByTimeAsync(5000);
		await flushPromises();
		expect(document.getElementById('open-source').hidden).toBe(false);
		expect(field('preview-status').textContent).toBe(ERROR_LOCALES['zh-CN'].error_AUTH_REQUIRED);
		expect(messages(sendMessage, 'OPEN_INSTANCE')).toHaveLength(0);
		expect(field('preview-code').disabled).toBe(true);
		expect(field('preview-next-code').disabled).toBe(true);
		const count = sendMessage.mock.calls.length;
		await vi.advanceTimersByTimeAsync(60000);
		expect(sendMessage).toHaveBeenCalledTimes(count);
		sendMessage.mockImplementation(original);
		field('preview-retry').click();
		await flushPromises();
		expect(document.getElementById('open-source').hidden).toBe(true);
		expect(field('preview-code').textContent).toBe('012345');
	});

	it('does not offer source opening for an unrelated target error', async () => {
		const sendMessage = installChromeMock();
		sendMessage.mockResolvedValueOnce({ ok: false, error: { code: 'TARGET_UNAVAILABLE', message: '当前页面不支持' } });
		await loadPopup();
		expect(document.getElementById('open-source').hidden).toBe(true);
	});
});

describe('Popup explicit filling and target identity', () => {
	it('fills only from the explicit button and resumes visible codes when filling fails', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		await loadPopup();
		field('account-name').click();
		field('account-detail').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		writeText.mockClear();
		field('account-fill').click();
		expect(field('preview-code').textContent).toBe('------');
		expect(document.getElementById('account-search').disabled).toBe(true);
		await flushPromises();
		expect(writeText).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([
			expect.objectContaining({ account: ACCOUNT, nonce: 'nonce-2', remember: true }),
		]);
		expect(document.getElementById('status').textContent).toContain('未找到明确的验证码输入框');
		expect(document.getElementById('account-search').disabled).toBe(false);
		expect(field('preview-code').textContent).toBe('012345');
		expect(document.getElementById('copy-code')).toBeNull();
	});

	it('waits for an in-flight preview nonce, skips queued previews and sends fill before restarting previews', async () => {
		const sendMessage = installWebsiteAccounts();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		let firstCopy = true;
		sendMessage.mockImplementation((message) => {
			if (message.type === 'COPY_ACCOUNT_CODES' && firstCopy) {
				firstCopy = false;
				return pending.promise;
			}
			return original(message);
		});
		await loadPopup();
		field('account-fill', 'ns2').click();
		await flushPromises();
		expect(messages(sendMessage).map((message) => message.type)).toEqual(['START_FLOW', 'COPY_ACCOUNT_CODES']);
		pending.resolve({ ok: true, data: ['ns1', 'ns2'].map((id) => ({ id, ...codeResponse('111111').data })) });
		await flushPromises();
		expect(
			messages(sendMessage)
				.slice(0, 4)
				.map((message) => message.type),
		).toEqual(['START_FLOW', 'COPY_ACCOUNT_CODES', 'START_FLOW', 'FILL_ACCOUNT']);
		expect(messages(sendMessage, 'FILL_ACCOUNT')[0]).toEqual(
			expect.objectContaining({ nonce: 'nonce-2', account: expect.objectContaining({ id: 'ns2' }) }),
		);
		expect(field('preview-code', 'ns1').textContent).toBe('012345');
		expect(field('preview-code', 'ns2').textContent).toBe('012345');
	});

	it('keeps codes stopped after a successful fill and closes the popup', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'FILL_ACCOUNT' ? Promise.resolve({ ok: true, data: {} }) : original(message),
		);
		const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
		await loadPopup();
		// Filling without asking for this website's grant closes right away.
		document.getElementById('remember-binding').click();
		field('account-fill').click();
		await flushPromises();
		expect(document.getElementById('status').textContent).toBe('验证码已填入');
		expect(field('preview-code').textContent).toBe('------');
		vi.advanceTimersByTime(450);
		expect(close).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(30000);
		await flushPromises();
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(1);
	});

	it.each([
		['website', { targetOrigin: 'https://different.example' }],
		['document on the same website', { targetDocumentId: 'replacement-document' }],
		['tab on the same website', { targetTabId: 8 }],
	])('rejects automatic refresh and filling after the %s changes until an explicit retry', async (_label, changedTarget) => {
		const sendMessage = installChromeMock();
		await loadPopup();
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation(async (message) => {
			const response = await original(message);
			return message.type === 'START_FLOW' ? { ...response, data: { ...response.data, ...changedTarget } } : response;
		});
		vi.advanceTimersByTime(5000);
		await flushPromises();
		expect(field('preview-status').textContent).toBe('网站或账户已发生变化，请点击重试重新选择');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(1);
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(1);
		document.getElementById('retry').click();
		await flushPromises();
		expect(field('preview-code').textContent).toBe('012345');
		expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(2);
	});
});

describe('Popup account remembering choices', () => {
	const matchedAccount = { ...ACCOUNT, name: 'GitHub' };
	const otherAccount = { ...ACCOUNT, id: 'other', name: 'NodeSeek', account: 'another-user' };
	function uniqueMatch(overrides = {}) {
		return {
			targetOrigin: 'https://github.com',
			accounts: [matchedAccount, otherAccount],
			autoFillAccountId: matchedAccount.id,
			...overrides,
		};
	}
	function remember() {
		return document.getElementById('remember-binding');
	}

	it.each([
		['website', () => uniqueMatch()],
		[
			'Google login email',
			() =>
				uniqueMatch({
					targetOrigin: 'https://accounts.google.com',
					loginContext: { provider: 'google', email: ACCOUNT.account },
					accounts: [
						{ ...ACCOUNT, name: 'Google' },
						{ ...ACCOUNT, id: 'second-google', name: 'Google', account: 'other@example.com' },
					],
				}),
		],
	])('hides remembering for a unique reliable %s match without creating a binding', async (_name, createFlow) => {
		const sendMessage = installChromeMock(createFlow());
		await loadPopup();
		expect(remember().closest('label').hidden).toBe(true);
		expect(remember().checked).toBe(false);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([expect.objectContaining({ remember: false, automatic: true })]);
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toEqual(expect.objectContaining({ remember: false }));
	});

	it('keeps the choice for multiple candidates even when search shows only one', async () => {
		installChromeMock(
			uniqueMatch({
				accounts: [matchedAccount, { ...matchedAccount, id: 'other-github', account: 'another-user' }],
				autoFillAccountId: null,
			}),
		);
		await loadPopup();
		inputSearch('another-user');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['other-github']);
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(true);
	});

	it.each([
		['no reliable website match', { targetOrigin: 'https://unrelated.example', accounts: [otherAccount], autoFillAccountId: null }],
		[
			'a matching unavailable record',
			{
				accounts: [matchedAccount],
				autoFillAccountId: null,
				unavailableAccounts: [{ id: 'unavailable', name: 'GitHub' }],
			},
		],
	])('retains remembering for one visible account with %s', async (_name, overrides) => {
		installChromeMock(uniqueMatch(overrides));
		await loadPopup();
		expect(renderedAccountIds()).toHaveLength(1);
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(true);
	});

	it('reveals remembering in all accounts or cross-service search and preserves an explicit choice', async () => {
		const sendMessage = installChromeMock(uniqueMatch());
		await loadPopup();
		document.getElementById('scope-all').click();
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(false);
		document.getElementById('scope-site').click();
		expect(remember().closest('label').hidden).toBe(true);
		inputSearch('another-user');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['other']);
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(false);
		remember().click();
		inputSearch('');
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(true);
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toEqual(expect.objectContaining({ remember: true }));
	});

	it('keeps an existing binding visible and allows explicitly unchecking it', async () => {
		const sendMessage = installChromeMock(uniqueMatch({ boundAccountIds: [matchedAccount.id] }));
		await loadPopup();
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(true);
		expect(messages(sendMessage, 'FILL_ACCOUNT')[0]).toEqual(expect.objectContaining({ remember: true }));
		remember().click();
		expect(remember().checked).toBe(false);
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toEqual(expect.objectContaining({ remember: false }));
	});

	describe('for the account being filled', () => {
		const first = { ...ACCOUNT, id: 'first', name: 'Custom', account: 'first-user' };
		const second = { ...ACCOUNT, id: 'second', name: 'Custom', account: 'second-user' };
		const accountsFor = (boundAccountIds) => ({
			targetOrigin: 'https://custom.example',
			accounts: [first, second],
			boundAccountIds,
			autoFillAccountId: boundAccountIds.length === 1 ? boundAccountIds[0] : null,
		});
		const lastFill = (sendMessage) => messages(sendMessage, 'FILL_ACCOUNT').at(-1);
		const pageGrant = (targetOrigin) => ({ instanceOrigin: 'https://twofa.example', targetOrigin, targetPath: '/' });
		const rememberTitle = () => document.getElementById('remember-title').textContent;
		// A real pointer crosses the card before it can press the fill button.
		const hover = (element) => element.dispatchEvent(new window.Event('pointerover', { bubbles: true }));

		it('names the account about to be filled and follows a hovered card before its button is pressed', async () => {
			const sendMessage = installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			expect(rememberTitle()).toBe('记住 Custom（first-user）');
			expect(remember().getAttribute('aria-labelledby')).toBe('remember-title');
			expect(document.getElementById('remember-title').title).toBe('记住 Custom（first-user）');
			expect(remember().checked).toBe(true);
			hover(field('account-fill', 'second'));
			expect(rememberTitle()).toBe('记住 Custom（second-user）');
			expect(remember().checked).toBe(false);
			// Leaving the list on the way to the checkbox keeps that account named.
			hover(remember());
			expect(rememberTitle()).toBe('记住 Custom（second-user）');
			field('account-fill', 'second').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: false }));
		});

		it('names the first account as soon as the popup opens', async () => {
			installChromeMock(accountsFor(['first']));
			await loadPopup();
			expect(renderedAccountIds()[0]).toBe('first');
			expect(rememberTitle()).toBe('记住 Custom（first-user）');
			expect(remember().checked).toBe(true);
		});

		describe('when moving to the checkbox past other cards', () => {
			const third = { ...ACCOUNT, id: 'third', name: 'Custom', account: 'third-user' };
			const threeAccounts = () => installChromeMock({ ...accountsFor(['first']), accounts: [first, second, third] });

			it('keeps the middle card named after a pointer crosses the last card on its way', async () => {
				const sendMessage = threeAccounts();
				await loadPopup();
				document.getElementById('scope-all').click();
				expect(renderedAccountIds()).toEqual(['first', 'second', 'third']);
				hover(field('account-fill', 'second'));
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				// On the way down: the last card's empty space, its star and its code.
				hover(card('third'));
				hover(field('account-favorite', 'third'));
				hover(field('preview-code', 'third'));
				hover(remember());
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				expect(remember().checked).toBe(false);
				remember().click();
				field('account-fill', 'second').click();
				await flushPromises();
				expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: true }));
			});

			it('keeps the middle card named after Tab passes the buttons of the last card', async () => {
				const sendMessage = threeAccounts();
				await loadPopup();
				document.getElementById('scope-all').click();
				const key = (target, value) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true }));
				key(document.getElementById('account-search'), 'ArrowDown');
				key(document.activeElement, 'ArrowDown');
				expect(document.activeElement).toBe(card('second'));
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				// Tab visits every later button before it reaches the checkbox.
				for (const id of ['second', 'third']) {
					for (const className of ['account-favorite', 'account-fill', 'preview-code']) {
						field(className, id).focus();
					}
				}
				remember().focus();
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				expect(remember().checked).toBe(false);
				remember().click();
				field('account-fill', 'second').click();
				await flushPromises();
				expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: true }));
			});

			it('selects a clicked card, but not a card whose star is clicked', async () => {
				threeAccounts();
				await loadPopup();
				document.getElementById('scope-all').click();
				card('second').querySelector('.account-info').click();
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				field('account-favorite', 'third').click();
				expect(rememberTitle()).toBe('记住 Custom（second-user）');
				field('account-fill', 'third').dispatchEvent(new window.Event('pointerover', { bubbles: true }));
				expect(rememberTitle()).toBe('记住 Custom（third-user）');
				expect(remember().checked).toBe(false);
			});
		});

		it('names an account without account details by its service name', async () => {
			const solo = { ...ACCOUNT, id: 'solo', name: 'Solo', account: '' };
			installChromeMock({ ...accountsFor([]), accounts: [solo], initialAutofillSites: [pageGrant('https://custom.example')] });
			await loadPopup();
			document.getElementById('scope-all').click();
			expect(rememberTitle()).toBe('记住 Solo');
		});

		it('names the account to autofill on a website without a grant', async () => {
			const solo = { ...ACCOUNT, id: 'solo', name: 'Solo', account: '' };
			installChromeMock({ ...accountsFor([]), accounts: [solo] });
			await loadPopup();
			document.getElementById('scope-all').click();
			expect(rememberTitle()).toBe('以后在此网站自动填入 Solo');
			expect(remember().closest('label').title).toBe(LOCALES['zh-CN'].popupAutoAccountHint);
			expect(document.getElementById('remember-description').textContent).toBe(LOCALES['zh-CN'].popupAutoAccountDescription);
			expect(remember().checked).toBe(true);
		});

		it('translates the named account when another surface changes the language', async () => {
			installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			hover(field('account-fill', 'second'));
			for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
				listener({ type: 'LANGUAGE_CHANGED', preference: 'en' }, {});
			}
			expect(rememberTitle()).toBe('Remember Custom (second-user)');
			expect(remember().checked).toBe(false);
		});

		it('remembers the hovered account after the user checks the box for it', async () => {
			const sendMessage = installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			hover(field('account-fill', 'second'));
			expect(remember().checked).toBe(false);
			remember().click();
			expect(remember().checked).toBe(true);
			// An explicit choice survives later passing over cards and focus changes.
			hover(card('first'));
			hover(field('account-favorite', 'first'));
			field('account-fill', 'first').focus();
			expect(rememberTitle()).toBe('记住 Custom（second-user）');
			expect(remember().checked).toBe(true);
			field('account-fill', 'second').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: true }));
		});

		it('does not add a second binding when another account is filled from all accounts', async () => {
			const sendMessage = installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			expect(renderedAccountIds()).toEqual(['first', 'second']);
			// The first card is the Enter target, and it is already bound.
			expect(remember().checked).toBe(true);
			field('account-fill', 'second').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: false }));
			expect(remember().checked).toBe(false);
		});

		it('follows the selected card and returns to the Enter target from search', async () => {
			installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			card('second').focus();
			expect(remember().checked).toBe(false);
			card('first').focus();
			expect(remember().checked).toBe(true);
			card('second').focus();
			document.getElementById('account-search').focus();
			expect(remember().checked).toBe(true);
		});

		it('follows keyboard selection and fills the selected account with its own remembered state', async () => {
			const sendMessage = installChromeMock(accountsFor(['first']));
			await loadPopup();
			document.getElementById('scope-all').click();
			const key = (target, value) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true }));
			key(document.getElementById('account-search'), 'ArrowDown');
			expect(document.activeElement).toBe(card('first'));
			expect(remember().checked).toBe(true);
			key(document.activeElement, 'ArrowDown');
			expect(document.activeElement).toBe(card('second'));
			expect(remember().checked).toBe(false);
			key(document.activeElement, 'Enter');
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: false }));
		});

		it('applies an explicit uncheck to the account filled next', async () => {
			const sendMessage = installChromeMock(accountsFor(['first', 'second']));
			await loadPopup();
			expect(remember().checked).toBe(true);
			remember().click();
			expect(remember().checked).toBe(false);
			hover(field('account-fill', 'second'));
			expect(rememberTitle()).toBe('以后在此网站自动填入 Custom（second-user）');
			expect(remember().checked).toBe(false);
			field('account-fill', 'second').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: false }));
			expect(messages(sendMessage, 'BEGIN_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		});

		it('keeps an explicit check for the account filled next, even when that card was not selected first', async () => {
			const sendMessage = installChromeMock({ ...accountsFor([]), initialAutofillSites: [pageGrant('https://custom.example')] });
			await loadPopup();
			expect(remember().checked).toBe(false);
			remember().click();
			card('second').focus();
			expect(remember().checked).toBe(true);
			field('account-fill', 'second').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: second, remember: true }));
		});

		it('starts every newly opened view from the bound state instead of an earlier choice', async () => {
			const sendMessage = installChromeMock(accountsFor(['first']));
			await loadPopup();
			remember().click();
			expect(remember().checked).toBe(false);
			document.getElementById('retry').click();
			await flushPromises();
			expect(remember().checked).toBe(true);
			field('account-fill', 'first').click();
			await flushPromises();
			expect(lastFill(sendMessage)).toEqual(expect.objectContaining({ account: first, remember: true }));
		});
	});

	it('does not erase a newly created binding when a hidden choice renews its flow', async () => {
		const state = uniqueMatch();
		const sendMessage = installChromeMock(state);
		await loadPopup();
		expect(remember().closest('label').hidden).toBe(true);
		state.boundAccountIds = [matchedAccount.id];
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toEqual(expect.objectContaining({ remember: true }));
		expect(remember().closest('label').hidden).toBe(false);
		expect(remember().checked).toBe(true);
		field('account-fill').click();
		await flushPromises();
		expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toEqual(expect.objectContaining({ remember: true }));
	});
});

describe('Popup search and website filtering', () => {
	it.each([false, true])('updates a no-match fallback after source refresh while preserving explicit all=%s', async (explicitAll) => {
		const state = {
			targetOrigin: 'https://github.com',
			sourceRevision: 'before',
			accounts: [ACCOUNT, { ...ACCOUNT, id: 'other', name: 'Other', account: 'other@example.com' }],
		};
		installChromeMock(state);
		await loadPopup();
		const site = document.getElementById('scope-site');
		const all = document.getElementById('scope-all');
		expect(renderedAccountIds()).toHaveLength(2);
		expect(site.getAttribute('aria-pressed')).toBe('false');
		expect(all.getAttribute('aria-pressed')).toBe('true');
		expect(all.title).toContain('此网站暂无匹配');
		expect(document.getElementById('account-summary').hidden).toBe(true);
		expect(document.getElementById('account-search').title).toContain('Enter 填充');
		site.click();
		expect(all.getAttribute('aria-pressed')).toBe('true');
		inputSearch('user');
		await vi.advanceTimersByTimeAsync(130);
		expect(site.getAttribute('aria-pressed')).toBe('false');
		expect(all.getAttribute('aria-pressed')).toBe('false');
		expect(all.title).toBe('');
		inputSearch('');
		expect(all.getAttribute('aria-pressed')).toBe('true');
		if (explicitAll) {
			all.click();
		}
		state.accounts = [{ ...ACCOUNT, name: 'GitHub' }, state.accounts[1]];
		state.sourceRevision = 'after';
		notifyAccountsChanged('after');
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		expect(site.title).toBe('');
		expect(all.title).toBe('');
		expect(site.getAttribute('aria-pressed')).toBe(String(!explicitAll));
		expect(all.getAttribute('aria-pressed')).toBe(String(explicitAll));
		expect(renderedAccountIds()).toEqual(explicitAll ? [ACCOUNT.id, 'other'] : [ACCOUNT.id]);
	});

	it('defaults to the current website and searches the full vault without resetting the remember choice', async () => {
		installWebsiteAccounts();
		await loadPopup();
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
		expect(document.getElementById('status').textContent).toContain('2 个账户');
		const remember = document.getElementById('remember-binding');
		expect(remember.checked).toBe(true);
		remember.click();
		expect(remember.checked).toBe(false);
		const search = inputSearch('dev@');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['other']);
		expect(remember.checked).toBe(false);
		inputSearch('does-not-exist');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual([]);
		expect(document.getElementById('account-empty').hidden).toBe(false);
		document.getElementById('scope-all').click();
		expect(renderedAccountIds()).toHaveLength(3);
		expect(search.value).toBe('');
		document.getElementById('scope-site').click();
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
	});

	it('filters only the latest query after the same 130 ms delay as the main page', async () => {
		installWebsiteAccounts();
		await loadPopup();
		inputSearch('alice');
		vi.advanceTimersByTime(100);
		inputSearch('dev@');
		vi.advanceTimersByTime(129);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
		vi.advanceTimersByTime(1);
		expect(renderedAccountIds()).toEqual(['other']);
	});

	it.each(['', '   '])('restores the current website immediately for an empty query %j', async (query) => {
		installWebsiteAccounts();
		await loadPopup();
		inputSearch('dev@');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['other']);
		inputSearch('does-not-exist');
		inputSearch(query);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
		expect(document.getElementById('account-search-clear').hidden).toBe(true);
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
	});

	it('clears the search immediately, cancels a pending query and returns focus to the input', async () => {
		installWebsiteAccounts();
		await loadPopup();
		const search = inputSearch('dev@');
		expect(search.placeholder).toBe('搜索服务或账户名称');
		vi.advanceTimersByTime(130);
		const clear = document.getElementById('account-search-clear');
		expect(clear.hidden).toBe(false);
		inputSearch('does-not-exist');
		clear.focus();
		clear.click();
		expect(search.value).toBe('');
		expect(clear.hidden).toBe(true);
		expect(document.activeElement).toBe(search);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
	});

	it('cancels pending filtering when the account scope changes', async () => {
		installWebsiteAccounts();
		await loadPopup();
		inputSearch('does-not-exist');
		document.getElementById('scope-all').click();
		const cards = Array.from(document.querySelectorAll('.account-card'));
		expect(cards).toHaveLength(3);
		vi.advanceTimersByTime(130);
		expect(Array.from(document.querySelectorAll('.account-card'))).toEqual(cards);
	});

	it('does not reopen the account section from pending filtering while retrying', async () => {
		const sendMessage = installWebsiteAccounts();
		await loadPopup();
		inputSearch('does-not-exist');
		const pending = deferred();
		sendMessage.mockImplementationOnce(() => pending.promise);
		document.getElementById('retry').click();
		expect(document.getElementById('account-section').hidden).toBe(true);
		await flushPromises();
		vi.advanceTimersByTime(130);
		expect(document.getElementById('account-section').hidden).toBe(true);
		pending.resolve({ ok: true, data: flow('retry') });
		await flushPromises();
		expect(document.getElementById('account-search').value).toBe('');
		expect(renderedAccountIds()).toEqual(['account-id']);
	});

	it('defers pending filtering until filling finishes and keeps the remember choice and error', async () => {
		const sendMessage = installWebsiteAccounts();
		await loadPopup();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'FILL_ACCOUNT' ? pending.promise : original(message)));
		card('ns2').focus();
		expect(document.getElementById('remember-binding').checked).toBe(true);
		document.getElementById('remember-binding').click();
		inputSearch('does-not-exist');
		field('account-fill', 'ns2').click();
		expect(document.getElementById('account-search').disabled).toBe(true);
		expect(document.getElementById('account-search-clear').disabled).toBe(true);
		await flushPromises();
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'FILL_ACCOUNT', account: expect.objectContaining({ id: 'ns2' }), remember: false }),
		);
		pending.resolve({ ok: false, error: { code: 'NO_INPUT', message: '未找到明确的验证码输入框' } });
		await flushPromises();
		expect(document.getElementById('account-search').value).toBe('does-not-exist');
		expect(document.getElementById('account-search').disabled).toBe(false);
		expect(renderedAccountIds()).toEqual([]);
		expect(document.getElementById('account-search-clear').hidden).toBe(false);
		expect(document.getElementById('remember-binding').checked).toBe(false);
		expect(document.getElementById('status').textContent).toContain('未找到明确的验证码输入框');
	});

	it('keeps search available during automatic loading and discards a response whose card was filtered away', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODE' ? pending.promise : original(message)));
		await loadPopup();
		const oldCard = card();
		expect(document.getElementById('account-search').disabled).toBe(false);
		inputSearch('does-not-exist');
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual([]);
		pending.resolve(codeResponse());
		await flushPromises();
		expect(oldCard.isConnected).toBe(false);
		expect(oldCard.querySelector('.preview-code').textContent).toBe('------');
		expect(document.getElementById('account-search').disabled).toBe(false);
		vi.advanceTimersByTime(30000);
		await flushPromises();
		expect(messages(sendMessage)).toHaveLength(2);
	});

	it('cancels pending filtering when the popup closes', async () => {
		installWebsiteAccounts();
		await loadPopup();
		inputSearch('does-not-exist');
		window.dispatchEvent(new Event('pagehide'));
		vi.advanceTimersByTime(130);
		expect(renderedAccountIds()).toEqual(['ns1', 'ns2']);
	});
});

it('shows and copies codes in view-only mode while preventing fill and bindings', async () => {
	const sendMessage = installChromeMock({ canFill: false, targetOrigin: null, targetTabId: null, targetDocumentId: null });
	const writeText = installClipboard();
	await loadPopup();
	expect(document.getElementById('account-section').hidden).toBe(false);
	expect(document.getElementById('target-origin').textContent).toBe('当前页面仅支持复制');
	expect(document.getElementById('status').hidden).toBe(true);
	expect(document.getElementById('keyboard-help').hidden).toBe(true);
	expect(document.getElementById('account-search').title).toContain('Enter 复制');
	expect(document.getElementById('scope-site').hidden).toBe(true);
	expect(document.getElementById('remember-binding').closest('label').hidden).toBe(true);
	expect(field('account-fill').disabled).toBe(true);
	field('preview-code').click();
	await flushPromises();
	expect(writeText).toHaveBeenCalledWith('012345');
	field('account-fill').click();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
});

it('batches visible cards into one message and reuses retained cards while searching', async () => {
	const sendMessage = installManyAccounts();
	await loadPopup();
	const alice = card('ns1');
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODES')).toHaveLength(1);
	expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
	inputSearch('alice');
	vi.advanceTimersByTime(130);
	await flushPromises();
	expect(card('ns1')).toBe(alice);
	expect(field('preview-code', 'ns1').textContent).toBe('012345');
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODES')).toHaveLength(1);
	expect(messages(sendMessage, 'START_FLOW')).toHaveLength(1);
});

it('continues refreshing surviving accounts when the first visible account was removed', async () => {
	const sendMessage = installManyAccounts();
	await loadPopup();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) => {
		const response = await original(message);
		if (message.type === 'START_FLOW') {
			response.data.accounts = response.data.accounts.filter((account) => account.id !== 'ns1');
		}
		return response;
	});
	vi.advanceTimersByTime(5000);
	await flushPromises();
	expect(field('preview-status', 'ns1').textContent).toContain('账户已发生变化');
	expect(field('preview-code', 'ns2').textContent).toBe('012345');
	expect(field('preview-status', 'ns2').hidden).toBe(true);
});

it('coalesces periodic refreshes across independent interval tasks', async () => {
	const sendMessage = installManyAccounts();
	await loadPopup();
	await vi.advanceTimersByTimeAsync(5020);
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODES')).toHaveLength(2);
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'COPY_ACCOUNT_CODE')).toHaveLength(0);
	expect(messages(sendMessage, 'START_FLOW')).toHaveLength(2);
	expect(field('preview-code', 'ns1').textContent).toBe('012345');
	expect(field('preview-code', 'ns2').textContent).toBe('012345');
});

it('offers focused-input confirmation only after ordinary filling fails', async () => {
	const sendMessage = installChromeMock();
	await loadPopup();
	const confirm = document.getElementById('fill-focused');
	expect(confirm.hidden).toBe(true);
	field('account-fill').click();
	await flushPromises();
	expect(confirm.hidden).toBe(false);
	expect(messages(sendMessage, 'FILL_ACCOUNT')[0].confirmFocused).toBeUndefined();
	confirm.click();
	await flushPromises();
	expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1)).toMatchObject({ account: ACCOUNT, confirmFocused: true });
});

it('shows incompatible account details while healthy codes remain available', async () => {
	installChromeMock({ unavailableAccounts: [{ id: 'legacy', name: '<img src=x onerror=alert(1)>', reason: 'invalid' }] });
	await loadPopup();
	const warning = document.getElementById('account-warning');
	expect(warning.hidden).toBe(false);
	expect(warning.textContent).toContain('已跳过 1 个重复或不兼容的账户');
	expect(warning.querySelector('img')).toBeNull();
	expect(field('preview-code').textContent).toBe('012345');
});

it('navigates cards with arrows and flushes a pending query before Enter fills', async () => {
	const sendMessage = installManyAccounts();
	await loadPopup();
	const search = document.getElementById('account-search');
	search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(card('ns1'));
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(card('ns2'));
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await flushPromises();
	expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1).account.id).toBe('ns2');
	search.focus();
	inputSearch('carol');
	search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await flushPromises();
	expect(messages(sendMessage, 'FILL_ACCOUNT').at(-1).account.id).toBe('ns3');
});
it('does not fill while an IME composition confirms a search term', async () => {
	const sendMessage = installChromeMock();
	await loadPopup();
	document
		.getElementById('account-search')
		.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
	await flushPromises();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
});
it('uses Enter to copy in view-only mode', async () => {
	const sendMessage = installChromeMock({ canFill: false });
	const writeText = installClipboard();
	await loadPopup();
	document.getElementById('account-search').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(card());
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await flushPromises();
	expect(writeText).toHaveBeenCalledWith('012345');
	expect(document.activeElement).toBe(card());
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
});
it('pins a card without fetching new codes or changing website bindings', async () => {
	const sendMessage = installManyAccounts();
	const writeText = installClipboard();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'SET_FAVORITE' ? Promise.resolve({ ok: true, data: { favoriteAccountIds: [message.accountId] } }) : original(message),
	);
	await loadPopup();
	const before = messages(sendMessage, 'COPY_ACCOUNT_CODE').length;
	const star = field('account-favorite', 'ns2').querySelector('svg');
	expect(star.getAttribute('aria-hidden')).toBe('true');
	expect(star.getAttribute('focusable')).toBe('false');
	const unselectedPath = star.querySelector('path').getAttribute('d');
	star.querySelector('path').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	await flushPromises();
	expect(renderedAccountIds()[0]).toBe('ns2');
	expect(field('account-favorite', 'ns2').getAttribute('aria-pressed')).toBe('true');
	expect(field('account-favorite', 'ns2').querySelector('path').getAttribute('d')).not.toBe(unselectedPath);
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(before);
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	expect(writeText).not.toHaveBeenCalled();
});

describe('Popup account view invalidation', () => {
	function notifySettingsChanged(key) {
		for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
			listener({ [key]: { newValue: key === 'settings' ? { instanceOrigin: 'https://new-twofa.example' } : [] } }, 'local');
		}
	}

	it.each(
		['settings', 'offlineInstances'].flatMap((key) =>
			['success', 'error'].flatMap((outcome) => [false, true].map((retryFirst) => ({ key, outcome, retryFirst }))),
		),
	)('ignores a late favorite $outcome after $key changes (retry first: $retryFirst)', async ({ key, outcome, retryFirst }) => {
		const state = {};
		const sendMessage = installChromeMock(state);
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'SET_FAVORITE' ? pending.promise : original(message)));
		await loadPopup();
		field('account-favorite').click();
		if (key === 'settings') {
			state.instanceOrigin = 'https://new-twofa.example';
		}
		notifySettingsChanged(key);
		const section = document.getElementById('account-section');
		const status = document.getElementById('status');
		expect(section.hidden).toBe(true);
		expect(field('preview-code').textContent).toBe('------');
		if (retryFirst) {
			document.getElementById('retry').click();
			await flushPromises();
			expect(section.hidden).toBe(false);
		}
		const statusBeforeReply = status.textContent;
		pending.resolve(
			outcome === 'success'
				? { ok: true, data: { favoriteAccountIds: [ACCOUNT.id] } }
				: { ok: false, error: { code: 'REQUEST_EXPIRED', message: '过期的置顶失败' } },
		);
		await flushPromises();
		expect(section.hidden).toBe(!retryFirst);
		expect(status.textContent).toBe(statusBeforeReply);
		expect(field('account-favorite').getAttribute('aria-pressed')).toBe('false');
		if (!retryFirst) {
			document.getElementById('retry').click();
			await flushPromises();
		}
		expect(section.hidden).toBe(false);
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('account-fill').disabled).toBe(false);
	});

	it.each(['settings', 'offlineInstances'])('cancels pending search and rejects stale controls after %s changes', async (key) => {
		const sendMessage = installWebsiteAccounts();
		chrome.storage = { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } };
		await loadPopup();
		inputSearch('alice');
		const oldFill = field('account-fill', 'ns1');
		const oldFavorite = field('account-favorite', 'ns1');
		const requestsBeforeChange = sendMessage.mock.calls.length;
		notifySettingsChanged(key);
		await vi.advanceTimersByTimeAsync(150);
		expect(document.getElementById('account-section').hidden).toBe(true);
		expect(document.getElementById('remember-binding').closest('label').hidden).toBe(true);
		expect(document.getElementById('keyboard-help').hidden).toBe(true);
		oldFill.click();
		oldFavorite.click();
		inputSearch('bob').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		document.getElementById('scope-all').click();
		document.getElementById('account-search-clear').click();
		await vi.advanceTimersByTimeAsync(150);
		expect(document.getElementById('account-section').hidden).toBe(true);
		expect(sendMessage.mock.calls).toHaveLength(requestsBeforeChange);
		expect(document.getElementById('status').textContent).toBe('2FA 设置已变化，请重试');
		document.getElementById('retry').click();
		await flushPromises();
		inputSearch('bob');
		await vi.advanceTimersByTimeAsync(150);
		expect(document.getElementById('account-section').hidden).toBe(false);
		expect(renderedAccountIds()).toEqual(['ns2']);
	});

	it('keeps a pending favorite valid through an ordinary source refresh on the same instance', async () => {
		const state = { sourceRevision: 'before' };
		const sendMessage = installChromeMock(state);
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'SET_FAVORITE' ? pending.promise : original(message)));
		await loadPopup();
		field('account-favorite').click();
		state.sourceRevision = 'after';
		notifyAccountsChanged('after');
		await vi.advanceTimersByTimeAsync(100);
		await flushPromises();
		pending.resolve({ ok: true, data: { favoriteAccountIds: [ACCOUNT.id] } });
		await flushPromises();
		expect(document.getElementById('account-section').hidden).toBe(false);
		expect(field('account-favorite').getAttribute('aria-pressed')).toBe('true');
		expect(field('preview-code').textContent).toBe('012345');
	});
});

it('keeps arrow focus on cards before and after their view-only codes become available', async () => {
	installChromeMock({ canFill: false, accounts: ['a', 'b', 'c'].map((id) => ({ ...ACCOUNT, id, name: id })) });
	await loadPopup();
	field('preview-code', 'b').disabled = true;
	field('preview-code', 'a').focus();
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(card('b'));
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	expect(document.activeElement).toBe(card('c'));
	emitVisibility({ c: true });
	await flushPromises();
	expect(field('preview-code', 'c').disabled).toBe(false);
	expect(document.activeElement).toBe(card('c'));
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	expect(document.activeElement).toBe(card('b'));
	document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	expect(document.activeElement).toBe(card('a'));
});

it.each([false, true])('keeps favorite focus unless the user moved to search (%s)', async (moveToSearch) => {
	const sendMessage = installManyAccounts();
	const original = sendMessage.getMockImplementation();
	const pending = deferred();
	sendMessage.mockImplementation((message) => (message.type === 'SET_FAVORITE' ? pending.promise : original(message)));
	await loadPopup();
	const star = field('account-favorite', 'ns2');
	star.focus();
	star.click();
	star.click();
	expect(messages(sendMessage, 'SET_FAVORITE')).toHaveLength(1);
	expect(document.activeElement).toBe(star);
	const search = document.getElementById('account-search');
	if (moveToSearch) {
		search.focus();
	}
	pending.resolve({ ok: true, data: { favoriteAccountIds: ['ns2'] } });
	await flushPromises();
	expect(document.activeElement).toBe(moveToSearch ? search : star);
});

it('shows connection progress during a slow initial load and clears it after success', async () => {
	const sendMessage = installChromeMock();
	const pending = deferred();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) => (message.type === 'START_FLOW' ? pending.promise : original(message)));
	await loadPopup();
	const status = document.getElementById('status');
	expect(status.hidden).toBe(false);
	expect(status.getAttribute('aria-busy')).toBe('true');
	expect(status.textContent).toBe('正在读取账户…');
	pending.resolve({ ok: true, data: flow('first') });
	await flushPromises();
	expect(status.hidden).toBe(true);
	expect(status.getAttribute('aria-busy')).toBe('false');
});

it.each([
	['local', '请确认系统时间准确', '联网后会自动校准验证码时间'],
	['stale', '请确认系统时间准确', '恢复联网后会自动校准验证码时间'],
	['unverified', '请确认系统时间准确', '恢复联网后会自动校准验证码时间'],
	['changed', '请校准系统时间后重试', '请开启系统的自动日期与时间'],
	['unavailable', '暂时无法校准验证码时间', '已暂停取码和填充'],
])('shows an actionable %s clock hint without asking users to maintain the cache', async (clockStatus, warning, detail) => {
	installChromeMock({ offlineStatus: { cachedAt: Date.now(), clockStatus } });
	await loadPopup();
	const details = document.getElementById('offline-state');
	expect(details.hidden).toBe(false);
	expect(details.open).toBe(false);
	expect(details.dataset.warning).toBe('true');
	expect(document.getElementById('offline-summary').textContent).toBe(warning);
	expect(document.getElementById('offline-detail').textContent).toContain(detail);
	expect(details.textContent).not.toMatch(/缓存于|同步|清除/);
});

it('hides routine offline details when the clock is healthy', async () => {
	installChromeMock({ offlineStatus: { cachedAt: Date.now(), clockStatus: 'fresh' } });
	await loadPopup();
	const details = document.getElementById('offline-state');
	expect(details.hidden).toBe(true);
	expect(details.open).toBe(false);
	expect(details.dataset.warning).toBe('false');
	expect(document.getElementById('offline-summary').textContent).toBe('');
	expect(document.getElementById('offline-detail').textContent).toBe('');
	expect(details.textContent).not.toMatch(/缓存于|同步|清除/);
});

it('pauses automatic filling for an unavailable clock and offers a source refresh that restores previews', async () => {
	const state = {
		authMode: 'offline',
		autoFillAccountId: ACCOUNT.id,
		offlineStatus: { cachedAt: Date.now(), clockStatus: 'unavailable' },
	};
	const sendMessage = installChromeMock(state);
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		['COPY_ACCOUNT_CODE', 'COPY_ACCOUNT_CODES'].includes(message.type) && state.offlineStatus.clockStatus === 'unavailable'
			? Promise.resolve({ ok: false, error: { code: 'CLOCK_UNAVAILABLE', message: '暂时无法校准验证码时间，请重试连接后再取码' } })
			: original(message),
	);
	await loadPopup();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	expect(document.getElementById('actions').hidden).toBe(false);
	expect(document.getElementById('status').textContent).toContain('暂时无法校准');
	expect(field('preview-code').textContent).not.toMatch(/^\d{6}$/);
	state.offlineStatus.clockStatus = 'cached';
	state.autoFillAccountId = null;
	sendMessage.mockClear();
	document.getElementById('retry').click();
	await flushPromises();
	expect(messages(sendMessage, 'START_FLOW')[0]).toEqual({ type: 'START_FLOW', preferCache: true, refreshSource: true });
	expect(field('preview-code').textContent).toBe('012345');
	expect(document.getElementById('offline-state').hidden).toBe(true);
});

it('keeps the no-accounts message without routine offline details', async () => {
	installChromeMock({ accounts: [], offlineStatus: { cachedAt: Date.now(), clockStatus: 'fresh' } });
	await loadPopup();
	expect(document.getElementById('account-section').hidden).toBe(true);
	expect(document.getElementById('offline-state').hidden).toBe(true);
	expect(document.getElementById('offline-state').closest('#account-section')).toBeNull();
	expect(document.getElementById('keyboard-help').hidden).toBe(true);
	expect(document.getElementById('status').textContent).toBe('实例中没有可用的 TOTP 账户');
});

it('shows visible card and fill waiting feedback without changing card structure', async () => {
	const sendMessage = installChromeMock();
	const original = sendMessage.getMockImplementation();
	const pending = deferred();
	sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODE' ? pending.promise : original(message)));
	await loadPopup();
	expect(field('preview-next-time').textContent).toBe('正在获取…');
	expect(field('code-preview').getAttribute('aria-busy')).toBe('true');
	field('account-fill').click();
	expect(document.getElementById('status').hidden).toBe(false);
	expect(document.getElementById('status').textContent).toContain('临近换组');
	pending.resolve(codeResponse());
	await flushPromises();
	expect(document.getElementById('status').getAttribute('aria-busy')).toBe('false');
});

const GOOGLE_ACCOUNT = { ...ACCOUNT, name: 'Google', account: 'alice@example.com' };
function installGooglePopup(overrides = {}) {
	return installChromeMock({
		targetOrigin: 'https://accounts.google.com',
		loginContext: { provider: 'google', email: 'alice@example.com' },
		accounts: [GOOGLE_ACCOUNT],
		autoFillAccountId: GOOGLE_ACCOUNT.id,
		...overrides,
	});
}
const autoPopupSetups = [
	['Google', installGooglePopup],
	[
		'ordinary site',
		() =>
			installChromeMock({ targetOrigin: 'https://github.com', accounts: [{ ...ACCOUNT, name: 'GitHub' }], autoFillAccountId: ACCOUNT.id }),
	],
	['explicit binding', () => installChromeMock({ boundAccountIds: [ACCOUNT.id], autoFillAccountId: ACCOUNT.id })],
];
it.each(autoPopupSetups)('fills a unique %s account only on its authorized path before starting previews', async (_name, install) => {
	const sendMessage = install();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'FILL_ACCOUNT' ? Promise.resolve({ ok: true, data: {} }) : original(message),
	);
	const close = vi.spyOn(window, 'close').mockImplementation(() => {});
	await loadPopup();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toEqual([
		expect.objectContaining({ account: expect.objectContaining({ id: ACCOUNT.id }), automatic: true }),
	]);
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(0);
	vi.advanceTimersByTime(450);
	expect(close).toHaveBeenCalledOnce();
});
it('still closes after automatic success on an already authorized site', async () => {
	const sendMessage = installGooglePopup();
	await sendMessage({
		type: 'SET_AUTOFILL_SITE',
		instanceOrigin: 'https://twofa.example',
		targetOrigin: 'https://accounts.google.com',
		targetPath: '/',
		enabled: true,
	});
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'FILL_ACCOUNT' ? Promise.resolve({ ok: true, data: {} }) : original(message),
	);
	const close = vi.spyOn(window, 'close').mockImplementation(() => {});
	await loadPopup();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	expect(messages(sendMessage, 'COPY_ACCOUNT_CODE')).toHaveLength(0);
	vi.advanceTimersByTime(450);
	expect(close).toHaveBeenCalledOnce();
});
it('still closes after an explicitly chosen account fills without site authorization', async () => {
	const sendMessage = installChromeMock();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'FILL_ACCOUNT' ? Promise.resolve({ ok: true, data: {} }) : original(message),
	);
	const close = vi.spyOn(window, 'close').mockImplementation(() => {});
	await loadPopup();
	document.getElementById('remember-binding').click();
	field('account-fill').click();
	await flushPromises();
	vi.advanceTimersByTime(450);
	expect(close).toHaveBeenCalledOnce();
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});
it.each(autoPopupSetups)('retains manual choice and copying after one automatic %s fill fails', async (_name, install) => {
	const sendMessage = install();
	await loadPopup();
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	expect(field('preview-code').textContent).toBe('012345');
	expect(document.getElementById('status').textContent).toContain('未找到');
	await vi.advanceTimersByTimeAsync(5020);
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
});
it('keeps multiple Google matches visible and does not fill without a choice', async () => {
	const sendMessage = installGooglePopup({
		autoFillAccountId: null,
		accounts: [GOOGLE_ACCOUNT, { ...GOOGLE_ACCOUNT, id: 'other-google' }, { ...GOOGLE_ACCOUNT, id: 'github', name: 'GitHub' }],
	});
	await loadPopup();
	expect(renderedAccountIds()).toEqual([GOOGLE_ACCOUNT.id, 'other-google']);
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	expect(document.getElementById('account-summary').textContent).toContain('alice@example.com');
});

it('retains the Google login filter when that email has no matching account', async () => {
	const sendMessage = installGooglePopup({
		autoFillAccountId: null,
		accounts: [{ ...GOOGLE_ACCOUNT, account: 'bob@example.com' }],
	});
	await loadPopup();
	expect(renderedAccountIds()).toEqual([]);
	expect(document.getElementById('scope-site').getAttribute('aria-pressed')).toBe('true');
	expect(document.getElementById('scope-all').getAttribute('aria-pressed')).toBe('false');
	expect(document.getElementById('account-summary').textContent).toContain('匹配 0 个 Google 账户');
	expect(document.getElementById('scope-all').title).toBe('');
	document.getElementById('scope-all').click();
	expect(renderedAccountIds()).toEqual([GOOGLE_ACCOUNT.id]);
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
});

describe('Popup multilingual UI', () => {
	const languages = [...SUPPORTED_LANGUAGES.filter((language) => language !== 'en'), 'en'].map((language) => {
		const dictionary = LOCALES[language];
		const category = new Intl.PluralRules(language).select(5);
		const next = PLURAL_OVERRIDES[language]?.popupNextIn?.[category] || dictionary.popupNextIn;
		return [
			language,
			dictionary.popupTitle,
			dictionary.popupSettings,
			dictionary.popupFill,
			dictionary.popupCopyCode,
			dictionary.popupAllCount.replace('{count}', '1'),
			next.replace('{seconds}', '5'),
		];
	});
	function languageChanged(preference) {
		for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
			listener({ type: 'LANGUAGE_CHANGED', preference }, {});
		}
	}

	it('keeps one permission request and its pending choice when another surface changes language', async () => {
		const sendMessage = installChromeMock();
		const permission = deferred();
		chrome.permissions.request.mockReturnValue(permission.promise);
		await loadPopup();
		const checkbox = document.getElementById('autofill-site');
		checkbox.click();
		// The permission call must remain in the original user gesture.
		expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
		await flushPromises(false);
		const requests = sendMessage.mock.calls.length;
		languageChanged('en');
		expect(document.getElementById('status').textContent).toBe('Enabling autofill on this website…');
		expect(checkbox.checked).toBe(true);
		expect(checkbox.disabled).toBe(true);
		expect(checkbox.getAttribute('aria-busy')).toBe('true');
		expect(document.getElementById('account-search').disabled).toBe(true);
		expect(sendMessage).toHaveBeenCalledTimes(requests);
		expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		permission.resolve(false);
		await flushPromises(false);
		expect(document.getElementById('status').textContent).toBe(
			'Website access was not granted, so autofill is off. You can still copy codes or fill them manually.',
		);
		expect(checkbox.checked).toBe(false);
		expect(checkbox.disabled).toBe(false);
		expect(messages(sendMessage, 'CANCEL_AUTOFILL_AUTHORIZATION')).toHaveLength(1);
		expect(messages(sendMessage, 'COMPLETE_AUTOFILL_AUTHORIZATION')).toHaveLength(0);
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it('retains a focused code and a single pending clipboard write across language broadcasts', async () => {
		const sendMessage = installChromeMock();
		const writeText = installClipboard();
		const clipboard = deferred();
		writeText.mockReturnValue(clipboard.promise);
		await loadPopup();
		const code = field('preview-code');
		code.focus();
		code.click();
		expect(writeText).toHaveBeenCalledExactlyOnceWith('012345');
		const requests = sendMessage.mock.calls.length;
		const countdown = field('progress-top').getAttribute('aria-valuenow');
		languageChanged('zh-TW');
		expect(document.activeElement).toBe(code);
		expect(code.getAttribute('aria-disabled')).toBe('true');
		expect(code.getAttribute('aria-label')).toBe('複製目前驗證碼');
		expect(field('progress-top').getAttribute('aria-valuenow')).toBe(countdown);
		expect(field('preview-code').textContent).toBe('012345');
		expect(field('preview-next-code').textContent).toBe('654321');
		code.click();
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledTimes(requests);
		clipboard.resolve();
		await flushPromises(false);
		expect(document.getElementById('copy-toast-message').textContent).toBe('驗證碼已複製');
		expect(document.getElementById('copy-toast').hidden).toBe(false);
		expect(code.getAttribute('aria-disabled')).toBe('false');
		expect(document.activeElement).toBe(code);
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it.each(languages)(
		'renders static labels, template controls and live countdowns in %s',
		async (language, title, settings, fill, copy, scope, next) => {
			const sendMessage = installChromeMock({ languagePreference: language });
			await loadPopup();
			expect(document.documentElement.lang).toBe(language);
			expect(document.querySelector('h1').textContent).toBe(title);
			expect(document.getElementById('open-options').textContent).toBe(settings);
			expect(document.getElementById('scope-all').textContent).toBe(scope);
			expect(field('account-fill').textContent).toBe(fill);
			expect(field('preview-code').getAttribute('aria-label')).toBe(copy);
			expect(field('preview-next-time').textContent).toBe(next);
			expect(field('account-name').textContent).toBe(ACCOUNT.name);
			expect(field('account-detail').textContent).toBe(ACCOUNT.account);
			expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
		},
	);

	it('translates existing nodes without losing a pending search, focus, scroll, codes or issuing requests', async () => {
		const sendMessage = installChromeMock();
		await loadPopup();
		const search = inputSearch('user');
		search.focus();
		search.setSelectionRange(1, 3);
		const list = document.getElementById('accounts');
		list.scrollTop = 37;
		const accountCard = card();
		const code = field('preview-code');
		const requestCount = sendMessage.mock.calls.length;
		const timerCount = vi.getTimerCount();
		for (const [language, title, settings, fill, copy, scope, next] of languages) {
			languageChanged(language);
			expect(document.querySelector('h1').textContent).toBe(title);
			expect(document.getElementById('open-options').textContent).toBe(settings);
			expect(field('account-fill').textContent).toBe(fill);
			expect(code.getAttribute('aria-label')).toBe(copy);
			expect(document.getElementById('scope-all').textContent).toBe(scope);
			expect(field('preview-next-time').textContent).toBe(next);
			expect(card()).toBe(accountCard);
			expect(field('preview-code')).toBe(code);
			expect(code.textContent).toBe('012345');
			expect(field('preview-next-code').textContent).toBe('654321');
			expect(document.activeElement).toBe(search);
			expect(search.value).toBe('user');
			expect([search.selectionStart, search.selectionEnd]).toEqual([1, 3]);
			expect(list.scrollTop).toBe(37);
			expect(sendMessage).toHaveBeenCalledTimes(requestCount);
			expect(vi.getTimerCount()).toBe(timerCount);
		}
		await vi.advanceTimersByTimeAsync(130);
		expect(document.getElementById('account-summary').textContent).toBe('Found 1 match across all accounts');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
	});

	it('preserves the lifetime of a visible copy notification while translating it', async () => {
		const sendMessage = installChromeMock();
		installClipboard();
		await loadPopup();
		field('preview-next-code').click();
		await flushPromises(false);
		await vi.advanceTimersByTimeAsync(1000);
		const requests = sendMessage.mock.calls.length;
		languageChanged('en');
		expect(document.getElementById('copy-toast').hidden).toBe(false);
		expect(document.getElementById('copy-toast-message').textContent).toBe('Next code copied');
		expect(sendMessage).toHaveBeenCalledTimes(requests);
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.getElementById('copy-toast').hidden).toBe(true);
	});

	it('keeps a pending preview request and translates its later validation error', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'COPY_ACCOUNT_CODE' ? pending.promise : original(message)));
		await loadPopup();
		const accountCard = card();
		const requests = sendMessage.mock.calls.length;
		languageChanged('en');
		expect(field('code-preview').getAttribute('aria-busy')).toBe('true');
		expect(field('preview-next-time').textContent).toBe('Loading…');
		expect(sendMessage).toHaveBeenCalledTimes(requests);
		pending.resolve({ ok: true, data: { ...codeResponse().data, code: 'invalid' } });
		await flushPromises(false);
		expect(card()).toBe(accountCard);
		expect(field('preview-status').textContent).toBe('Invalid code response. Please retry.');
		expect(field('preview-code').disabled).toBe(true);
		languageChanged('zh-TW');
		expect(field('preview-status').textContent).toBe('驗證碼回應無效，請重試');
		expect(sendMessage).toHaveBeenCalledTimes(requests);
	});

	it('preserves a pending fill and translates its recovery action without replaying the fill', async () => {
		const sendMessage = installChromeMock();
		const original = sendMessage.getMockImplementation();
		const pending = deferred();
		sendMessage.mockImplementation((message) => (message.type === 'FILL_ACCOUNT' ? pending.promise : original(message)));
		await loadPopup();
		field('account-fill').click();
		await flushPromises(false);
		const requests = sendMessage.mock.calls.length;
		languageChanged('en');
		const status = document.getElementById('status');
		expect(status.textContent).toBe('Fetching and filling the code. Please wait if it is about to change…');
		expect(status.getAttribute('aria-busy')).toBe('true');
		expect(document.getElementById('account-search').disabled).toBe(true);
		expect(sendMessage).toHaveBeenCalledTimes(requests);
		pending.resolve({ ok: false, error: { code: 'NO_INPUT' } });
		await flushPromises(false);
		expect(document.getElementById('fill-focused').hidden).toBe(false);
		expect(document.getElementById('fill-focused').textContent).toBe('Fill the focused field with the code for Example (user@example.com)');
		expect(status.textContent).toContain('You can also click a code in its card to copy it.');
		languageChanged('zh-TW');
		expect(document.getElementById('fill-focused').textContent).toBe('將 Example（user@example.com） 的驗證碼填入已聚焦輸入框');
		expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(1);
	});

	it.each(SUPPORTED_LANGUAGES)('localizes source errors and clock warnings in %s', async (language) => {
		const sendMessage = installChromeMock({ offlineStatus: { clockStatus: 'local' } });
		const original = sendMessage.getMockImplementation();
		sendMessage.mockImplementation((message) =>
			message.type === 'COPY_ACCOUNT_CODE' ? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED' } }) : original(message),
		);
		await loadPopup();
		const requests = sendMessage.mock.calls.length;
		languageChanged(language);
		expect(field('preview-status').textContent).toBe(LOCALES[language].error_AUTH_REQUIRED);
		expect(document.getElementById('status').textContent).toBe(LOCALES[language].error_AUTH_REQUIRED);
		expect(document.getElementById('open-source').hidden).toBe(false);
		expect(document.getElementById('offline-summary').textContent).toBe(LOCALES[language].popupClockCheck);
		expect(sendMessage).toHaveBeenCalledTimes(requests);
	});
});

it('uses English singular forms for one second and one matching or unavailable account', async () => {
	const sendMessage = installChromeMock({
		languagePreference: 'en',
		targetOrigin: 'https://accounts.google.com',
		loginContext: { provider: 'google', email: ACCOUNT.account },
		accounts: [{ ...ACCOUNT, name: 'Google' }],
		unavailableAccounts: [{ name: 'Invalid', reason: 'invalid' }],
	});
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) => {
		if (message.type === 'COPY_ACCOUNT_CODE') {
			const expiresAt = Date.now() + 1000;
			return Promise.resolve({
				ok: true,
				data: { ...codeResponse().data, expiresAt, nextStartsAt: expiresAt, nextExpiresAt: expiresAt + 30000 },
			});
		}
		return original(message);
	});
	await loadPopup();
	expect(field('progress-top').getAttribute('aria-valuetext')).toBe('1 second remaining');
	expect(field('progress-top').title).toBe('Updates in 1 second');
	expect(field('preview-next-time').textContent).toBe('Active in 1 second');
	expect(document.getElementById('account-summary').textContent).toBe('Page account user@example.com: 1 matching Google account');
	expect(document.getElementById('account-warning').textContent).toBe(
		'Skipped 1 duplicate or incompatible account: Invalid. Fix it in your instance.',
	);
	inputSearch('user');
	await vi.advanceTimersByTimeAsync(130);
	expect(document.getElementById('account-summary').textContent).toBe('Found 1 match across all accounts');
	expect(messages(sendMessage, 'FILL_ACCOUNT')).toHaveLength(0);
});
