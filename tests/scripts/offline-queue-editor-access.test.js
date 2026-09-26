// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

const CACHE_KEY = '2fa-secrets-cache';
const ACCOUNT = {
	id: 'example',
	name: 'Example',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const STOPPED = { id: 'stopped', type: 'UPDATE', name: 'Example', timestamp: 1, status: 'failed', editable: true, reason: 'Rejected' };
const DETAIL = { id: 'stopped', type: 'UPDATE', targetId: 'example', reason: 'Rejected', data: { ...ACCOUNT, name: 'Queued edit' } };

function response(data, status = 200) {
	return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => data };
}

async function flush() {
	for (let index = 0; index < 100; index += 1) {
		await Promise.resolve();
	}
}

// One browser page: the real account read, login, logout and queue scripts.
// Pages opened in turn share browser storage, like tabs of one browser.
function openPage(values, { online, read = () => response([ACCOUNT]) }) {
	document.body.innerHTML =
		'<div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div><input id="searchInput">' +
		'<div id="loginModal" style="display:none"><input id="loginToken"><div id="loginError"></div></div>' +
		'<section id="offlineQueue" hidden><span id="offlineQueueSummary"></span><button id="offlineQueueLogin"></button>' +
		'<button id="offlineQueueReload"></button><button id="offlineQueueToggle"></button>' +
		'<p id="offlineQueueFeedback"></p><ul id="offlineQueueList"></ul></section>';
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
	const workerMessages = [];
	class Channel {
		constructor() {
			this.port1 = { onmessage: null, close() {} };
			this.port2 = { close() {}, reply: (data) => this.port1.onmessage?.({ data }) };
		}
	}
	const controller = {
		postMessage: vi.fn((message, ports) => {
			workerMessages.push(message.type);
			if (!ports) {
				return;
			}
			const reply = { ok: true, operations: [STOPPED], authRequired: false };
			ports[0].reply(message.type === 'OFFLINE_QUEUE_DETAIL' ? { ...reply, detail: DETAIL } : reply);
		}),
	};
	const registration = { active: controller, addEventListener() {}, update: async () => {} };
	const navigator = {
		onLine: online,
		language: 'zh-CN',
		serviceWorker: { controller, register: async () => registration, addEventListener() {}, ready: Promise.resolve(registration) },
	};
	const window = { navigator, isSecureContext: true, addEventListener() {}, matchMedia: () => ({ matches: false }) };
	const fetch = vi.fn(async (url) => (String(url).includes('/api/logout') ? response({ success: true }) : read()));
	const editor = vi.fn(() => true);
	const showCenterToast = vi.fn();
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'fetch',
		'MessageChannel',
		'ensureServerTimeSynchronized',
		'editor',
		'showCenterToast',
		'console',
		'setInterval',
		'requestAnimationFrame',
		`
		${getI18nCode()}${getStateCode()}${getAuthCode()}${getCoreCode()}${getPWACode()}
		renderSecrets = async () => {};
		showQueuedSecretEditor = editor;
		return { loadSecrets, logout, refreshOfflineQueue };
	`,
	)(
		document,
		window,
		navigator,
		storage,
		fetch,
		Channel,
		async () => true,
		editor,
		showCenterToast,
		{ log() {}, warn() {}, error() {} },
		vi.fn(),
		(callback) => callback(),
	);
	return {
		...api,
		editor,
		showCenterToast,
		workerMessages,
		async editStoppedChange() {
			await api.refreshOfflineQueue();
			await flush();
			const button = [...document.querySelectorAll('#offlineQueueList button')].find((item) => item.textContent === '编辑后重试');
			expect(button).toBeTruthy();
			button.click();
			await flush();
		},
		loginShown: () => document.getElementById('loginModal').style.display === 'flex',
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('reopening a stopped offline change', () => {
	it('says a connection and login are needed, and never requests the queued keys, on a page opened offline after logout', async () => {
		const values = new Map([[CACHE_KEY, JSON.stringify({ data: [ACCOUNT], timestamp: 1 })]]);
		const before = openPage(values, { online: true });
		await before.loadSecrets();
		await before.logout();
		expect(values.has(CACHE_KEY)).toBe(false);

		const page = openPage(values, { online: false });
		await page.loadSecrets();
		page.showCenterToast.mockClear();
		await page.editStoppedChange();

		expect(page.workerMessages).not.toContain('OFFLINE_QUEUE_DETAIL');
		expect(page.editor).not.toHaveBeenCalled();
		// The login dialog cannot be closed offline: leaving it opens /otp, which cannot load.
		expect(page.loginShown()).toBe(false);
		expect(page.showCenterToast).toHaveBeenCalledExactlyOnceWith(expect.any(String), '需要联网并登录后才能编辑这项更改');
	});

	it('asks for login in the page that just logged out', async () => {
		const page = openPage(new Map(), { online: true });
		await page.loadSecrets();
		await page.logout();
		await page.editStoppedChange();

		expect(page.workerMessages).not.toContain('OFFLINE_QUEUE_DETAIL');
		expect(page.loginShown()).toBe(true);
		expect(page.showCenterToast).not.toHaveBeenCalledWith(expect.any(String), '需要联网并登录后才能编辑这项更改');
	});

	it('asks for login when neither the server nor a logged-in local copy confirmed the account list', async () => {
		const page = openPage(new Map(), { online: true, read: () => response({ error: 'Unavailable' }, 503) });
		await page.loadSecrets();
		await page.editStoppedChange();

		expect(page.workerMessages).not.toContain('OFFLINE_QUEUE_DETAIL');
		expect(page.loginShown()).toBe(true);
	});

	it('reopens the change on a page showing the logged-in local copy offline', async () => {
		const values = new Map([[CACHE_KEY, JSON.stringify({ data: [ACCOUNT], timestamp: 1 })]]);
		const page = openPage(values, { online: false });
		await page.loadSecrets();
		await page.editStoppedChange();

		expect(page.workerMessages).toContain('OFFLINE_QUEUE_DETAIL');
		expect(page.editor).toHaveBeenCalledExactlyOnceWith(DETAIL);
		expect(page.loginShown()).toBe(false);
	});

	it('reopens the change on a page that read the account list from the server', async () => {
		const page = openPage(new Map(), { online: true });
		await page.loadSecrets();
		await page.editStoppedChange();

		expect(page.editor).toHaveBeenCalledExactlyOnceWith(DETAIL);
	});
});
