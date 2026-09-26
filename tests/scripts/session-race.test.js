// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUICode } from '../../src/ui/scripts/ui.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getPWACode } from '../../src/ui/scripts/pwa.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';

const CACHE_KEY = '2fa-secrets-cache';
const A = {
	id: 'a',
	name: 'Account A',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
	counter: 0,
};
const FRESH = { ...A, name: 'Current session account' };

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function response(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? 'OK' : 'Synthetic error',
		headers: new Headers(),
		json: vi.fn(async () => body),
	};
}

async function flush() {
	for (let index = 0; index < 40; index += 1) {
		await Promise.resolve();
	}
}

function harness() {
	document.body.innerHTML = `<div id="secretModal" style="display:none"><h2 id="modalTitle"></h2><form id="secretForm">
		<input id="secretId"><input id="secretName"><input id="secretService"><input id="secretKey">
		<input id="secretType" value="TOTP"><input id="secretDigits" value="6"><input id="secretPeriod" value="30">
		<input id="secretAlgorithm" value="SHA1"><input id="secretCounter" value="0"><input id="showAdvanced" type="checkbox">
		<div id="advancedOptions"></div><button id="submitBtn">保存</button></form></div>
		<div id="loginModal" style="display:none"><input id="loginToken"><button id="loginPasswordToggle"></button>
		<div id="loginError"></div><div id="loginInsecureWarning"></div></div>
		<div id="loading"></div><div id="emptyState"></div><div id="secretsList"></div><input id="searchInput">
		<button id="otp-a">123456</button><span id="counter-a">计数器: 7</span>`;
	const values = new Map();
	const storage = {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, String(value))),
		removeItem: vi.fn((key) => values.delete(key)),
	};
	const fetch = vi.fn(async (url) => {
		if (url === '/api/login' || url === '/api/logout') {
			return response({ success: true });
		}
		if (url === '/api/secrets') {
			return response([FRESH]);
		}
		throw new Error('Unexpected fixture request');
	});
	const time = vi.fn(async () => true);
	const render = vi.fn(async () => {});
	const toast = vi.fn();
	const confirm = vi.fn(async () => true);
	const updateOTP = vi.fn(async () => {});
	const updateBatch = vi.fn(async () => {});
	const startInterval = vi.fn();
	const browserWindow = { isSecureContext: true, addEventListener: vi.fn(), matchMedia: vi.fn(() => ({ matches: false })) };
	const navigator = { onLine: true, clipboard: { writeText: vi.fn(async () => {}) } };
	browserWindow.navigator = navigator;
	// Run complete emitted modules together, so auth invalidation and core
	// continuations share the same actual lexical state and save queue.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'fetch',
		'ensureServerTimeSynchronized',
		'render',
		'toast',
		'showConfirmDialog',
		'updateOTP',
		'updateOTPSecretsInBatch',
		'startOTPInterval',
		'console',
		'setInterval',
		'clearInterval',
		'setTimeout',
		'clearTimeout',
		'requestAnimationFrame',
		`
		function disableBodyScroll() {}
		function enableBodyScroll() {}
		function hideModal() {}
		function escapeHTML(value) { return String(value); }
		function sortSecrets(value) { return value; }
		let currentSortType = 'name';
		let currentViewMode = 'grid';
		function getCommittedHOTPToken() { return '123456'; }
		${getI18nCode()}${getStateCode()}
		${getUICode()}
		${getAuthCode()}
		${getCoreCode()}
		${getPWACode()}
		const renderActual = renderFilteredSecrets;
		renderFilteredSecrets = render;
		showCenterToast = toast;
		return { loadSecrets, logout, handleUnauthorized, handleLoginSubmit, showLoginModal,
			renderActual,
			refreshAuthToken,
			editSecret, showAddModal, hideSecretModal, handleSubmit, deleteSecret, copyOTP,
			handleServiceWorkerMessage, authenticatedFetch,
			setSecrets(value) { secrets = value; filteredSecrets = [...value]; cacheSecretsLocally(); },
			getSecrets() { return secrets; }, getQueue() { return saveQueue; }, setQueue(value) { saveQueue = value; },
			getSession() { return { generation: secretSessionGeneration, blocked: secretReadsBlocked }; }
		};
	`,
	)(
		document,
		browserWindow,
		navigator,
		storage,
		fetch,
		time,
		render,
		toast,
		confirm,
		updateOTP,
		updateBatch,
		startInterval,
		{ log() {}, error() {}, warn() {} },
		vi.fn(),
		vi.fn(),
		setTimeout,
		clearTimeout,
		(callback) => callback(),
	);
	api.setSecrets(globalThis.structuredClone([A]));
	storage.setItem.mockClear();
	return {
		...api,
		fetch,
		time,
		render,
		toast,
		confirm,
		updateOTP,
		updateBatch,
		startInterval,
		storage,
		navigator,
		field: (id) => document.getElementById(id),
		submit: () => api.handleSubmit({ preventDefault() {} }),
	};
}

async function login(h) {
	h.field('loginToken').value = 'new-session-password';
	await h.handleLoginSubmit();
	await flush();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('secret work belongs to the login session that started it', () => {
	it('ignores an old list 401 after a newer login succeeds', async () => {
		const h = harness();
		const old = deferred();
		h.fetch.mockReturnValueOnce(old.promise);
		const reading = h.loadSecrets();
		await flush();
		await login(h);
		const cached = h.storage.getItem(CACHE_KEY);
		old.resolve(response({}, 401));
		await reading;
		expect(h.getSecrets()).toEqual([FRESH]);
		expect(h.storage.getItem(CACHE_KEY)).toBe(cached);
		expect(h.getSession().blocked).toBe(false);
		vi.advanceTimersByTime(2000);
		expect(h.field('loginModal').style.display).toBe('none');
	});

	it('lets an explicit pending login succeed after an older edit returns 401', async () => {
		const h = harness();
		const edit = deferred();
		const authentication = deferred();
		h.fetch.mockReturnValueOnce(edit.promise).mockReturnValueOnce(authentication.promise);
		h.editSecret('a');
		h.field('secretName').value = 'Expired session edit';
		const saving = h.submit();
		await flush();
		h.field('loginToken').value = 'new login from offline queue';
		const entering = h.handleLoginSubmit();
		await flush();
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/a', '/api/login']);
		edit.resolve(response({ message: 'Expired' }, 401));
		await saving;
		expect(h.getSession().blocked).toBe(true);
		authentication.resolve(response({ success: true }));
		await entering;
		await flush();
		expect(h.getSession().blocked).toBe(false);
		expect(h.getSecrets()).toEqual([FRESH]);
		expect(h.fetch.mock.calls.filter(([url]) => url === '/api/secrets')).toHaveLength(1);
		vi.advanceTimersByTime(2000);
		expect(h.field('loginModal').style.display).toBe('none');
	});

	it.each(['response', 'json', 'network rejection'])(
		'does not restore accounts/cache after logout when a list %s arrives late',
		async (phase) => {
			const h = harness();
			const old = deferred();
			const reply = response([A]);
			if (phase === 'json') {
				reply.json.mockReturnValue(old.promise);
			}
			h.fetch.mockReturnValueOnce(phase === 'json' ? Promise.resolve(reply) : old.promise);
			const reading = h.loadSecrets();
			await flush();
			await h.logout();
			h.render.mockClear();
			h.storage.setItem.mockClear();
			if (phase === 'network rejection') {
				old.reject(new Error('Old connection failed'));
			} else {
				old.resolve(phase === 'json' ? [A] : reply);
			}
			await reading;
			expect(h.getSecrets()).toEqual([]);
			expect(h.storage.getItem(CACHE_KEY)).toBeNull();
			expect(h.storage.setItem).not.toHaveBeenCalled();
			expect(h.render).not.toHaveBeenCalled();
			expect(h.getSession().blocked).toBe(true);
		},
	);

	it('cancels a list waiting for clock synchronization before it fetches after logout', async () => {
		const h = harness();
		const clock = deferred();
		h.time.mockReturnValueOnce(clock.promise);
		const reading = h.loadSecrets();
		await h.logout();
		clock.resolve(true);
		await reading;
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/logout']);
		expect(h.getSecrets()).toEqual([]);
	});

	it('does not restart old OTP intervals when a real render batch resolves after logout', async () => {
		const h = harness();
		const batch = deferred();
		h.updateBatch.mockReturnValueOnce(batch.promise);
		const rendering = h.renderActual();
		await flush();
		expect(h.updateBatch).toHaveBeenCalledOnce();
		expect(h.field('secretsList').textContent).toContain('Account A');
		await h.logout();
		batch.resolve();
		await rendering;
		expect(h.startInterval).not.toHaveBeenCalled();
		expect(h.field('secretsList').innerHTML).toBe('');
		expect(h.field('secretsList').style.display).toBe('none');
	});

	it('does not let an old unauthorized timer reopen the login dialog after login succeeds', async () => {
		const h = harness();
		h.handleUnauthorized();
		await login(h);
		vi.advanceTimersByTime(2000);
		expect(h.field('loginModal').style.display).toBe('none');
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it('orders a new login behind pending logout so late cookie deletion cannot invalidate it', async () => {
		const h = harness();
		const old = deferred();
		h.fetch.mockReturnValueOnce(old.promise);
		const leaving = h.logout();
		await flush();
		const entering = login(h);
		await flush();
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/logout']);
		old.resolve(response({ success: true }));
		await leaving;
		await entering;
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/logout', '/api/login', '/api/secrets']);
		vi.advanceTimersByTime(2000);
		expect(h.getSecrets()).toEqual([FRESH]);
		expect(h.getSession().blocked).toBe(false);
		expect(h.field('loginModal').style.display).toBe('none');
	});

	it('orders logout after an in-flight login and ignores that login response locally', async () => {
		const h = harness();
		const old = deferred();
		h.fetch.mockReturnValueOnce(old.promise);
		h.field('loginToken').value = 'old login';
		const entering = h.handleLoginSubmit();
		await flush();
		const leaving = h.logout();
		await flush();
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/login']);
		old.resolve(response({ success: true }));
		await Promise.all([entering, leaving]);
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/login', '/api/logout']);
		expect(h.getSecrets()).toEqual([]);
		expect(h.getSession().blocked).toBe(true);
		expect(h.storage.getItem(CACHE_KEY)).toBeNull();
	});

	it('waits for an in-flight refresh cookie before logout and then applies the new login last', async () => {
		const h = harness();
		const refresh = deferred();
		h.fetch.mockReturnValueOnce(refresh.promise);
		const refreshing = h.refreshAuthToken();
		await flush();
		const leaving = h.logout();
		const entering = login(h);
		await flush();
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/refresh-token']);
		refresh.resolve(response({ success: true }));
		await Promise.all([refreshing, leaving, entering]);
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/refresh-token', '/api/logout', '/api/login', '/api/secrets']);
		expect(h.getSecrets()).toEqual([FRESH]);
		expect(h.getSession().blocked).toBe(false);
	});

	it.each([
		['refresh', 'headers'],
		['login', 'headers'],
		['logout', 'headers'],
		['refresh', 'body'],
		['login', 'body'],
		['logout', 'body'],
	])('recovers logout and a new login when %s stalls while reading %s', async (operation, phase) => {
		const h = harness();
		const held = deferred();
		const oldReply = response({ success: true }, operation === 'logout' && phase === 'body' ? 500 : 200);
		if (phase === 'body') {
			oldReply.json.mockReturnValue(held.promise);
			h.fetch.mockResolvedValueOnce(oldReply);
		} else {
			h.fetch.mockReturnValueOnce(held.promise);
		}
		h.field('loginToken').value = 'previous login';
		const pending = operation === 'refresh' ? h.refreshAuthToken() : operation === 'login' ? h.handleLoginSubmit() : h.logout();
		await flush();
		const stalledSignal = h.fetch.mock.calls[0][1].signal;
		const leaving = operation === 'logout' ? pending : h.logout();
		const entering = login(h);
		await vi.advanceTimersByTimeAsync(14999);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(stalledSignal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await Promise.all([pending, leaving, entering]);
		expect(stalledSignal.aborted).toBe(true);
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([
			operation === 'refresh' ? '/api/refresh-token' : '/api/' + operation,
			...(operation === 'logout' ? [] : ['/api/logout']),
			'/api/login',
			'/api/secrets',
		]);
		expect(h.getSession().blocked).toBe(false);
		expect(h.getSecrets()).toEqual([FRESH]);
		// Even an adapter that resolves after abort must not restore the old session.
		held.resolve(phase === 'body' ? { success: true } : oldReply);
		await flush();
		expect(h.getSession().blocked).toBe(false);
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it('coalesces concurrent renewals so one stalled refresh cannot build an authentication backlog', async () => {
		const h = harness();
		h.fetch.mockReturnValueOnce(new Promise(() => {}));
		const renewing = [h.refreshAuthToken(), h.refreshAuthToken(), h.refreshAuthToken()];
		await flush();
		const leaving = h.logout();
		const entering = login(h);
		await vi.advanceTimersByTimeAsync(15000);
		expect(await Promise.all(renewing)).toEqual([false, false, false]);
		await Promise.all([leaving, entering]);
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/refresh-token', '/api/logout', '/api/login', '/api/secrets']);
		expect(h.getSession().blocked).toBe(false);
		// The failed renewal must not suppress renewal attempts in the new session.
		h.fetch.mockResolvedValueOnce(response({ success: true }));
		expect(await h.refreshAuthToken()).toBe(true);
		expect(h.fetch.mock.calls.filter(([url]) => url === '/api/refresh-token')).toHaveLength(2);
	});

	it('shows the login error after a stalled response body and allows retrying the password', async () => {
		const h = harness();
		const stalled = response({ success: true });
		stalled.json.mockReturnValue(new Promise(() => {}));
		h.fetch.mockResolvedValueOnce(stalled);
		h.field('loginToken').value = 'first password';
		const entering = h.handleLoginSubmit();
		await flush();
		await vi.advanceTimersByTimeAsync(15000);
		await entering;
		expect(h.field('loginError').style.display).toBe('block');
		await login(h);
		expect(h.getSession().blocked).toBe(false);
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it('ignores a late authenticated response renewal hint after logout', async () => {
		const h = harness();
		const late = deferred();
		h.fetch.mockReturnValueOnce(late.promise);
		const reading = h.authenticatedFetch('/api/secrets');
		await flush();
		await h.logout();
		const reply = response([A]);
		reply.headers.set('X-Token-Refresh-Needed', 'true');
		late.resolve(reply);
		await reading;
		await flush();
		expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets', '/api/logout']);
	});

	it('does not confirm a deletion in a session different from the one that opened the confirmation', async () => {
		const h = harness();
		const confirmation = deferred();
		h.confirm.mockReturnValueOnce(confirmation.promise);
		const removing = h.deleteSecret('a');
		await login(h);
		confirmation.resolve(true);
		await removing;
		await h.getQueue();
		expect(h.fetch.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it.each(['save', 'delete'])('ignores a late %s result after the same account ID appears in a new session', async (operation) => {
		const h = harness();
		const old = deferred();
		h.fetch.mockReturnValueOnce(old.promise);
		if (operation === 'save') {
			h.editSecret('a');
			h.field('secretName').value = 'Old session save';
			h.submit();
		} else {
			await h.deleteSecret('a');
		}
		await flush();
		const oldQueue = h.getQueue();
		await login(h);
		old.resolve(response(operation === 'save' ? { ...A, name: 'Old session save' } : { success: true }));
		await oldQueue;
		expect(h.getSecrets()).toEqual([FRESH]);
		expect(JSON.parse(h.storage.getItem(CACHE_KEY)).data).toEqual([FRESH]);
	});

	it.each(['save', 'delete'])('never sends an old queued %s after the session changes', async (operation) => {
		const h = harness();
		const preceding = deferred();
		h.setQueue(preceding.promise);
		if (operation === 'save') {
			h.editSecret('a');
			h.submit();
		} else {
			await h.deleteSecret('a');
		}
		await flush();
		const oldQueue = h.getQueue();
		await login(h);
		preceding.resolve();
		await oldQueue;
		expect(h.fetch.mock.calls.filter(([, options]) => ['PUT', 'DELETE'].includes(options?.method))).toEqual([]);
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it('still commits a completed edit after its dialog closes within the same session', async () => {
		const h = harness();
		const old = deferred();
		h.fetch.mockReturnValueOnce(old.promise);
		h.editSecret('a');
		h.field('secretName').value = 'Valid closed-dialog save';
		const saving = h.submit();
		await flush();
		h.hideSecretModal();
		old.resolve(response({ ...A, name: 'Valid closed-dialog save' }));
		await saving;
		expect(h.getSecrets()[0].name).toBe('Valid closed-dialog save');
		expect(JSON.parse(h.storage.getItem(CACHE_KEY)).data[0].name).toBe('Valid closed-dialog save');
	});

	it('does not reconcile a stale HOTP reservation failure into a newer session', async () => {
		const h = harness();
		h.setSecrets([{ ...A, type: 'HOTP', counter: 7 }]);
		const reservation = deferred();
		h.fetch.mockReturnValueOnce(reservation.promise);
		const copying = h.copyOTP('a');
		await flush();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a/counter');
		await login(h);
		const reads = h.fetch.mock.calls.filter(([url]) => url === '/api/secrets').length;
		reservation.reject(new Error('Old reservation failed'));
		await copying;
		await h.getQueue();
		expect(h.fetch.mock.calls.filter(([url]) => url === '/api/secrets').length).toBe(reads);
		expect(h.getSecrets()).toEqual([FRESH]);
	});

	it('does not commit a late successful HOTP reservation into a new session using the same seed and ID', async () => {
		const h = harness();
		const hotp = { ...A, type: 'HOTP', counter: 7 };
		h.setSecrets([hotp]);
		const reservation = deferred();
		h.fetch.mockReturnValueOnce(reservation.promise);
		const copying = h.copyOTP('a');
		await flush();
		await login(h);
		h.setSecrets([{ ...hotp, name: 'Fresh HOTP session', counter: 20 }]);
		h.updateOTP.mockClear();
		reservation.resolve(response({ success: true, data: { secret: { ...hotp, counter: 8 } } }));
		await copying;
		await h.getQueue();
		expect(h.getSecrets()[0].counter).toBe(20);
		expect(h.getSecrets()[0].name).toBe('Fresh HOTP session');
		expect(h.updateOTP).not.toHaveBeenCalled();
	});
});
