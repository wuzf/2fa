// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

const operation = (overrides = {}) => ({
	id: 'operation-a',
	type: 'UPDATE',
	name: 'Example',
	timestamp: 1700000000000,
	status: 'pending',
	...overrides,
});
const summary = (operations = [], authRequired = false) => ({ ok: true, operations, authRequired });

async function flush() {
	for (let i = 0; i < 100; i++) {
		await Promise.resolve();
	}
}

async function harness({ controlled = true, supportsWorker = true } = {}) {
	const template = document.createElement('template');
	template.innerHTML = await (await createMainPage()).text();
	document.body.replaceChildren(template.content.querySelector('#offlineQueue'), template.content.querySelector('#loginModal'));
	const listeners = new Map();
	const workerListeners = new Map();
	const channels = [];
	const pending = [];
	class Channel {
		constructor() {
			this.port1 = { onmessage: null, close: vi.fn() };
			this.port2 = { close: vi.fn(), reply: (data) => this.port1.onmessage?.({ data }) };
			channels.push(this);
		}
	}
	const controller = {
		postMessage: vi.fn((message, ports) => {
			if (ports) {
				pending.push({ message, reply: ports[0].reply });
			}
		}),
	};
	const registration = { active: controlled ? controller : null, addEventListener: vi.fn(), update: vi.fn(async () => {}) };
	const serviceWorker = {
		controller: controlled ? controller : null,
		register: vi.fn(async () => registration),
		addEventListener: (name, cb) => workerListeners.set(name, cb),
		ready: Promise.resolve(registration),
	};
	const navigator = { onLine: true, language: 'zh-CN', ...(supportsWorker ? { serviceWorker } : {}) };
	const window = {
		navigator,
		isSecureContext: true,
		addEventListener: (name, cb) => listeners.set(name, cb),
		matchMedia: () => ({ matches: false }),
	};
	const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
	const loadSecrets = vi.fn();
	const toast = vi.fn();
	const confirm = vi.fn(async () => true);
	const editor = vi.fn(() => true);
	// Evaluate the real emitted scripts and use the queue markup from the page.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'MessageChannel',
		'fetch',
		'loadSecrets',
		'showCenterToast',
		'showConfirmDialog',
		'showQueuedSecretEditor',
		'console',
		'setInterval',
		'requestAnimationFrame',
		`
		${getI18nCode()}${getStateCode()}
		${getAuthCode()}
		${getPWACode()}
		return { handleLoginSubmit, refreshOfflineQueue, handleServiceWorkerMessage, requestPendingOperationSync,
			resumeOfflineQueueAfterLogin, toggleOfflineQueueDetails, retryOfflineQueueStatus, changeOfflineQueueOperation,
			openOfflineQueueEditor, discardReplacedOfflineQueueOperation, invalidateSecretSession, markSecretAccessVerified,
			claimOfflineQueueOperation, releaseOfflineQueueOperation };
	`,
	)(document, window, navigator, Channel, fetch, loadSecrets, toast, confirm, editor, { log() {}, warn() {}, error() {} }, vi.fn(), (cb) =>
		cb(),
	);
	return {
		...api,
		fetch,
		loadSecrets,
		toast,
		confirm,
		editor,
		online: () => listeners.get('online')?.(),
		offline: () => listeners.get('offline')?.(),
		channels,
		pending,
		controller,
		serviceWorker,
		registration,
		navigator,
		load: () => listeners.get('load')?.(),
		controllerChange: () => workerListeners.get('controllerchange')?.(),
		login: async () => {
			document.getElementById('loginToken').value = 'SyntheticPassword';
			await api.handleLoginSubmit();
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('offline queue status and recovery', () => {
	it('shows a queue summary only when unsynchronized changes exist and never renders sensitive response fields', async () => {
		const h = await harness();
		const read = h.refreshOfflineQueue();
		h.pending.shift().reply(summary());
		await read;
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
		h.handleServiceWorkerMessage({ type: 'OFFLINE_QUEUE_CHANGED' });
		h.pending
			.shift()
			.reply(
				summary([
					operation({ name: '<img src=x onerror=attack()>', data: { secret: 'SECRET-SEED' }, url: '/private-url', lastError: 'HTTP 401' }),
				]),
			);
		await flush();
		expect(document.getElementById('offlineQueue').hidden).toBe(false);
		expect(document.getElementById('offlineQueueSummary').textContent).toBe('有 1 项未同步更改');
		expect(document.getElementById('offlineQueueList').hidden).toBe(true);
		h.toggleOfflineQueueDetails();
		expect(document.getElementById('offlineQueueToggle').getAttribute('aria-expanded')).toBe('true');
		expect(document.getElementById('offlineQueueList').textContent).toContain('更新账户 · <img src=x onerror=attack()>');
		expect(document.querySelector('#offlineQueueList img')).toBeNull();
		expect(document.getElementById('offlineQueueList').textContent).not.toMatch(/SECRET-SEED|private-url|HTTP 401/);
		expect(document.querySelector('#offlineQueueList time').dateTime).toBe('2023-11-14T22:13:20.000Z');
		expect(document.querySelectorAll('#offlineQueueList button')).toHaveLength(0);
	});

	it('shows login recovery for paused operations without scheduling another automatic replay', async () => {
		const h = await harness();
		h.handleServiceWorkerMessage({ type: 'SYNC_COMPLETE', successCount: 0, failCount: 0, deferredCount: 0, authRequired: true });
		h.pending.shift().reply(summary([operation({ status: 'awaiting_auth' })], true));
		await flush();
		expect(document.getElementById('offlineQueueLogin').hidden).toBe(false);
		expect(document.getElementById('offlineQueueSummary').textContent).toBe('有更改等待登录后同步');
		h.requestPendingOperationSync();
		vi.advanceTimersByTime(60000);
		expect(h.controller.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['OFFLINE_QUEUE_STATUS']);
	});

	it('resumes after successful login without waiting for the worker reply and leaves failed login paused', async () => {
		const h = await harness();
		h.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Incorrect password' }) });
		await h.login();
		expect(h.pending).toHaveLength(0);
		expect(h.loadSecrets).not.toHaveBeenCalled();
		await h.login();
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_RESUME', language: 'zh-CN' });
		h.pending.shift().reply(summary([operation()]));
		await flush();
		expect(document.getElementById('offlineQueueLogin').hidden).toBe(true);
		expect(document.getElementById('offlineQueueSummary').textContent).toBe('有 1 项未同步更改');
	});

	it('keeps successful login usable without service worker support', async () => {
		const h = await harness({ supportsWorker: false });
		await h.login();
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		expect(h.pending).toHaveLength(0);
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
	});

	it('retains login recovery until an initially uncontrolled page receives a worker', async () => {
		const h = await harness({ controlled: false });
		await h.load();
		await h.login();
		expect(h.pending).toHaveLength(0);
		h.serviceWorker.controller = h.controller;
		h.controllerChange();
		expect(h.pending.at(-1).message.type).toBe('OFFLINE_QUEUE_RESUME');
		h.pending.at(-1).reply(summary());
		await flush();
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
	});

	it('bounds unresponsive requests, closes message ports, and never blocks login', async () => {
		const h = await harness();
		const read = h.refreshOfflineQueue();
		h.pending.shift().reply(summary([operation({ status: 'awaiting_auth' })], true));
		await read;
		await h.login();
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		const channel = h.channels.at(-1);
		await vi.advanceTimersByTimeAsync(3000);
		expect(channel.port1.close).toHaveBeenCalledOnce();
		expect(channel.port2.close).toHaveBeenCalledOnce();
		expect(document.getElementById('offlineQueueFeedback').textContent).toBe('暂时无法处理未同步更改，请稍后重试');
		expect(document.getElementById('offlineQueueReload').hidden).toBe(false);
		h.retryOfflineQueueStatus();
		expect(h.pending.at(-1).message.type).toBe('OFFLINE_QUEUE_RESUME');
		h.pending.at(-1).reply(summary());
		await flush();
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
	});

	it('offers retry and cancellation only for recoverable rows and preserves changes when cancellation is declined', async () => {
		const h = await harness();
		const read = h.refreshOfflineQueue();
		h.pending
			.shift()
			.reply(
				summary([operation({ status: 'failed' }), operation({ id: 'auth', status: 'awaiting_auth' }), operation({ id: 'pending' })], true),
			);
		await read;
		h.toggleOfflineQueueDetails();
		const rows = document.querySelectorAll('#offlineQueueList li');
		expect([...rows[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['重试', '取消更改']);
		expect([...rows[1].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['取消更改']);
		expect(rows[2].querySelectorAll('button')).toHaveLength(0);
		expect(rows[2].textContent).toContain('登录后继续');
		h.confirm.mockResolvedValueOnce(false);
		await h.changeOfflineQueueOperation('OFFLINE_QUEUE_CANCEL', 'operation-a');
		expect(h.pending).toHaveLength(0);
		rows[0].querySelector('button').click();
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_RETRY', operationId: 'operation-a', language: 'zh-CN' });
		h.pending.shift().reply(summary([operation()]));
		await flush();
		expect(document.querySelectorAll('#offlineQueueList button')).toHaveLength(0);
	});

	it('does not resurrect an operation from an older status reply after cancellation', async () => {
		const h = await harness();
		const oldReading = h.refreshOfflineQueue();
		const oldReply = h.pending.shift();
		const cancelling = h.changeOfflineQueueOperation('OFFLINE_QUEUE_CANCEL', 'operation-a');
		await flush();
		h.pending.shift().reply(summary());
		await cancelling;
		oldReply.reply(summary([operation({ status: 'failed' })]));
		await oldReading;
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
	});

	it('drains a login recovery intent after a queue action completes', async () => {
		const h = await harness();
		const retrying = h.changeOfflineQueueOperation('OFFLINE_QUEUE_RETRY', 'operation-a');
		expect(h.pending[0].message.type).toBe('OFFLINE_QUEUE_RETRY');
		await h.login();
		expect(h.pending).toHaveLength(1);
		h.pending.shift().reply(summary([operation({ status: 'awaiting_auth' })], true));
		await retrying;
		expect(h.pending.at(-1).message.type).toBe('OFFLINE_QUEUE_RESUME');
		h.pending.at(-1).reply(summary());
		await flush();
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
	});

	it('keeps a later login recovery intent when an earlier resume finishes', async () => {
		const h = await harness();
		await h.login();
		const first = h.pending.shift();
		await h.login();
		expect(h.pending).toHaveLength(0);
		first.reply(summary([operation({ status: 'awaiting_auth' })], true));
		await flush();
		expect(h.pending.at(-1).message.type).toBe('OFFLINE_QUEUE_RESUME');
		h.pending.shift().reply(summary());
		await flush();
		expect(document.getElementById('offlineQueue').hidden).toBe(true);
		expect(h.controller.postMessage.mock.calls.filter(([message]) => message.type === 'OFFLINE_QUEUE_RESUME')).toHaveLength(2);
	});
});

describe('stopped offline changes', () => {
	async function showRows(h, operations, authRequired = false) {
		const read = h.refreshOfflineQueue();
		h.pending.shift().reply(summary(operations, authRequired));
		await read;
		h.toggleOfflineQueueDetails();
		return [...document.querySelectorAll('#offlineQueueList li')];
	}

	it('shows the server explanation as text and offers editing only for stopped adds and edits', async () => {
		const h = await harness();
		const rows = await showRows(h, [
			operation({ status: 'failed', editable: true, reason: '<b>Service name must be at most 50 characters (currently 51)</b>' }),
			operation({ id: 'delete', type: 'DELETE', status: 'failed', reason: 'Not found' }),
			operation({ id: 'paused', status: 'awaiting_auth', editable: true, reason: 'hidden while paused' }),
		]);
		expect(rows[0].querySelector('.offline-queue-reason').textContent).toBe(
			'原因：<b>Service name must be at most 50 characters (currently 51)</b>',
		);
		expect(rows[0].querySelector('b')).toBeNull();
		expect([...rows[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['编辑后重试', '重试', '取消更改']);
		expect([...rows[1].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['重试', '取消更改']);
		expect(rows[2].querySelector('.offline-queue-reason')).toBeNull();
		expect([...rows[2].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['取消更改']);
	});

	it('explains a stopped addition whose account exists with other parameters in the page language', async () => {
		const h = await harness();
		const rows = await showRows(h, [
			operation({ type: 'ADD', status: 'failed', editable: true, duplicateDiffers: true, reason: 'Service "GitHub" already exists' }),
			operation({ id: 'plain', type: 'ADD', status: 'failed', editable: true, reason: 'Service "GitHub" already exists' }),
		]);
		expect(rows[0].querySelector('.offline-queue-reason').textContent).toBe('原因：' + LOCALES['zh-CN'].offlineQueueDuplicateDiffers);
		expect([...rows[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['编辑后重试', '重试', '取消更改']);
		// Without the flag (an older server) the server's own explanation stays.
		expect(rows[1].querySelector('.offline-queue-reason').textContent).toBe('原因：Service "GitHub" already exists');
	});

	it('reopens a stopped change in the account dialog through an explicit detail request', async () => {
		const h = await harness();
		h.markSecretAccessVerified();
		const rows = await showRows(h, [operation({ status: 'failed', editable: true, reason: 'Rejected' })]);
		rows[0].querySelector('button').click();
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_DETAIL', operationId: 'operation-a', language: 'zh-CN' });
		expect([...document.querySelectorAll('#offlineQueueList button')].every((button) => button.disabled)).toBe(true);
		const detail = { id: 'operation-a', type: 'UPDATE', targetId: 'account-a', reason: 'Rejected', data: { name: 'Example' } };
		h.pending.shift().reply({ ...summary([operation({ status: 'failed', editable: true })]), detail });
		await flush();
		expect(h.editor).toHaveBeenCalledExactlyOnceWith(detail);
		expect(h.confirm).not.toHaveBeenCalled();
		expect([...document.querySelectorAll('#offlineQueueList button')].some((button) => button.disabled)).toBe(false);
	});

	it('asks for login instead of revealing a stopped change after the session ended', async () => {
		const h = await harness();
		h.markSecretAccessVerified();
		await showRows(h, [operation({ status: 'failed', editable: true })]);
		h.invalidateSecretSession();
		await h.openOfflineQueueEditor('operation-a');
		expect(h.pending).toHaveLength(0);
		expect(h.editor).not.toHaveBeenCalled();
		expect(document.getElementById('loginModal').style.display).toBe('flex');
	});

	it('asks for login on a page that has not confirmed the login yet', async () => {
		const h = await harness();
		const rows = await showRows(h, [operation({ status: 'failed', editable: true })]);
		rows[0].querySelector('button').click();
		await flush();
		expect(h.pending).toHaveLength(0);
		expect(h.editor).not.toHaveBeenCalled();
		expect(document.getElementById('loginModal').style.display).toBe('flex');

		await h.login();
		await flush();
		// Answer the queue recovery that a login starts.
		while (h.pending.length) {
			h.pending.shift().reply(summary([operation({ status: 'failed', editable: true })]));
			await flush();
		}
		const opening = h.openOfflineQueueEditor('operation-a');
		expect(h.pending).toHaveLength(1);
		expect(h.pending[0].message.type).toBe('OFFLINE_QUEUE_DETAIL');
		const detail = { id: 'operation-a', type: 'ADD', data: { name: 'Example' } };
		h.pending.shift().reply({ ...summary([operation({ status: 'failed', editable: true })]), detail });
		await opening;
		expect(h.editor).toHaveBeenCalledExactlyOnceWith(detail);
	});

	it('does not open the dialog when the detail request fails or the session changes meanwhile', async () => {
		const h = await harness();
		h.markSecretAccessVerified();
		const failing = h.openOfflineQueueEditor('operation-a');
		h.pending.shift().reply({ ok: false, error: 'unavailable' });
		await failing;
		expect(document.getElementById('offlineQueueFeedback').hidden).toBe(false);
		const stale = h.openOfflineQueueEditor('operation-a');
		h.invalidateSecretSession();
		h.pending.shift().reply({ ...summary([]), detail: { id: 'operation-a', type: 'ADD', data: {} } });
		await stale;
		expect(h.editor).not.toHaveBeenCalled();
	});

	it('drops the stopped copy without a confirmation once its corrected version is saved', async () => {
		const h = await harness();
		const discarding = h.discardReplacedOfflineQueueOperation('operation-a');
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_CANCEL', operationId: 'operation-a', language: 'zh-CN' });
		h.pending.shift().reply(summary());
		await flush();
		expect(h.pending.at(-1).message.type).toBe('OFFLINE_QUEUE_STATUS');
		h.pending.shift().reply(summary());
		expect(await discarding).toBe(true);
		expect(h.confirm).not.toHaveBeenCalled();
		const failing = h.discardReplacedOfflineQueueOperation('operation-a');
		h.pending.shift().reply({ ok: false });
		expect(await failing).toBe(false);
		expect(document.getElementById('offlineQueueFeedback').hidden).toBe(false);
	});
});

describe('a stopped change handled in two tabs', () => {
	it.each([
		['claimed', summary([operation({ status: 'failed' })])],
		['busy', { ok: false, error: 'queue unavailable', code: 'changeBusy' }],
		['gone', { ok: false, error: 'queue unavailable', code: 'changeGone' }],
		['unavailable', { ok: false, error: 'queue unavailable' }],
	])('reports a claim as %s', async (outcome, reply) => {
		const h = await harness();
		const claiming = h.claimOfflineQueueOperation('operation-a');
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_CLAIM', operationId: 'operation-a', language: 'zh-CN' });
		h.pending.shift().reply(reply);
		expect(await claiming).toBe(outcome);
	});

	it('releases a claim through the worker', async () => {
		const h = await harness();
		const releasing = h.releaseOfflineQueueOperation('operation-a');
		expect(h.pending[0].message).toEqual({ type: 'OFFLINE_QUEUE_RELEASE', operationId: 'operation-a', language: 'zh-CN' });
		h.pending.shift().reply({ ok: false });
		await expect(releasing).resolves.toBeUndefined();
	});

	it('explains a retry refused because another tab is editing the change', async () => {
		const h = await harness();
		const read = h.refreshOfflineQueue();
		h.pending.shift().reply(summary([operation({ status: 'failed' })]));
		await read;
		const retry = h.changeOfflineQueueOperation('OFFLINE_QUEUE_RETRY', 'operation-a');
		h.pending.shift().reply({ ok: false, error: 'queue unavailable', code: 'changeBusy' });
		await retry;
		const feedback = document.getElementById('offlineQueueFeedback');
		expect(feedback.hidden).toBe(false);
		expect(feedback.textContent).toBe(LOCALES['zh-CN'].offlineQueueChangeBusy);
		expect(feedback.textContent).not.toBe(LOCALES['zh-CN'].offlineQueueUnavailable);
	});
});

describe('account list revalidation after reconnecting', () => {
	async function withQueue(operations, authRequired = false) {
		const h = await harness();
		const read = h.refreshOfflineQueue();
		h.pending.shift().reply(summary(operations, authRequired));
		await read;
		h.offline();
		h.navigator.onLine = true;
		return h;
	}

	it.each([
		['no queued changes', []],
		['only stopped changes', [operation({ status: 'failed' })]],
		['only login-paused changes', [operation({ status: 'awaiting_auth' })]],
		['changes paused for login', [operation({ status: 'pending' })], true],
	])('reads the server list at once when there are %s', async (_label, operations, authRequired = false) => {
		const h = await withQueue(operations, authRequired);
		h.online();
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 0,
			deferredCount: 0,
			authRequired: false,
			totalCount: 0,
		});
		expect(h.loadSecrets).toHaveBeenCalledOnce();
	});

	it('waits for pending changes to replay and then reads once even when none were applied', async () => {
		const h = await withQueue([operation(), operation({ id: 'stopped', status: 'failed' })]);
		h.online();
		expect(h.loadSecrets).not.toHaveBeenCalled();
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 1,
			deferredCount: 0,
			authRequired: false,
			totalCount: 1,
		});
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 0,
			deferredCount: 0,
			authRequired: false,
			totalCount: 0,
		});
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(10000);
		expect(h.loadSecrets).toHaveBeenCalledOnce();
	});

	it('still reads the list when a replay never reports completion', async () => {
		const h = await withQueue([operation()]);
		h.online();
		await vi.advanceTimersByTimeAsync(9999);
		expect(h.loadSecrets).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.loadSecrets).toHaveBeenCalledOnce();
	});

	it('verifies the session after a login pause so an expired one is cleared like an online 401', async () => {
		const h = await withQueue([operation()]);
		h.online();
		h.handleServiceWorkerMessage({
			type: 'SYNC_COMPLETE',
			successCount: 0,
			failCount: 0,
			deferredCount: 0,
			authRequired: true,
			totalCount: 1,
		});
		expect(h.loadSecrets).toHaveBeenCalledOnce();
		// The queue itself is untouched: no cancellation is sent for paused changes.
		expect(h.controller.postMessage.mock.calls.map(([message]) => message.type)).not.toContain('OFFLINE_QUEUE_CANCEL');
	});

	it('skips the read for a logged-out page', async () => {
		const h = await withQueue([]);
		h.invalidateSecretSession();
		h.online();
		expect(h.loadSecrets).not.toHaveBeenCalled();
	});
});
