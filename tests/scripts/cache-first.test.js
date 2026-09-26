// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

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
const UPDATED = { ...ACCOUNT, name: 'Updated account' };

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function response(data, status = 200) {
	return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => data };
}

async function flush() {
	for (let index = 0; index < 50; index += 1) {
		await Promise.resolve();
	}
}

function harness({ cached, online = true } = {}) {
	document.body.innerHTML =
		'<div id="loading">正在加载密钥</div><div id="secretsList"></div><div id="emptyState"></div><input id="searchInput">';
	const values = new Map(cached === undefined ? [] : [[CACHE_KEY, JSON.stringify({ data: cached, timestamp: 1 })]]);
	const storage = {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, value)),
		removeItem: vi.fn((key) => values.delete(key)),
	};
	const fetch = vi.fn(async () => response([ACCOUNT]));
	const clock = vi.fn(async () => true);
	const render = vi.fn(async (accounts) => {
		document.getElementById('loading').style.display = 'none';
		document.getElementById('emptyState').style.display = 'none';
		document.getElementById('secretsList').innerHTML = '';
		for (const account of accounts) {
			const button = document.createElement('button');
			button.dataset.id = account.id;
			button.textContent = account.name;
			document.getElementById('secretsList').append(button);
		}
	});
	const navigator = { onLine: online, language: 'zh-CN' };
	const toast = vi.fn();
	// Real emitted reads and authentication boundaries, with only card rendering
	// substituted. Browser tests cover real local OTP generation and copying.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'fetch',
		'ensureServerTimeSynchronized',
		'render',
		'showCenterToast',
		'console',
		'setInterval',
		`
		${getI18nCode()}
      ${getStateCode()}
		${getAuthCode()}
		${getUtilsCode()}
		${getCoreCode()}
		function showSecretModal(fill) { fill(); }
		function toggleAdvancedOptions() {}
		const originalRenderSecrets = renderSecrets;
		renderSecrets = () => secrets.length ? render(secrets) : originalRenderSecrets();
		return { loadSecrets, handleUnauthorized, commitSecretListChange, createSecretCard, editSecret,
			getSecrets: () => secrets,
			getBlocked: () => secretReadsBlocked,
			newSession: () => invalidateSecretSession({blocked:false})
		};
	`,
	)(document, { addEventListener() {} }, navigator, storage, fetch, clock, render, toast, { log() {}, warn() {}, error() {} }, vi.fn());
	return { ...api, fetch, clock, render, storage, navigator, toast, readCache: () => JSON.parse(storage.getItem(CACHE_KEY)) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('main-page cache-first account reads', () => {
	it('renders a cached account before clock synchronization or the account request can complete', async () => {
		const h = harness({ cached: [ACCOUNT] });
		const clock = deferred();
		const request = deferred();
		h.clock.mockReturnValueOnce(clock.promise);
		h.fetch.mockReturnValueOnce(request.promise);
		const reading = h.loadSecrets();
		expect(h.render).toHaveBeenCalledOnce();
		expect(document.getElementById('secretsList').textContent).toBe('Example');
		expect(h.fetch).not.toHaveBeenCalled();
		clock.resolve(true);
		await flush();
		expect(h.fetch).toHaveBeenCalledWith('/api/secrets', expect.objectContaining({ signal: expect.any(AbortSignal) }));
		request.resolve(response([UPDATED]));
		await reading;
		expect(h.getSecrets()).toEqual([UPDATED]);
		expect(h.readCache().data).toEqual([UPDATED]);
	});

	it('preserves the existing card and focus when an online response contains the same accounts', async () => {
		const h = harness({ cached: [ACCOUNT] });
		const request = deferred();
		h.fetch.mockReturnValueOnce(request.promise);
		const reading = h.loadSecrets();
		const card = document.querySelector('[data-id="example"]');
		card.focus();
		await flush();
		request.resolve(response([ACCOUNT]));
		await reading;
		expect(h.render).toHaveBeenCalledOnce();
		expect(document.querySelector('[data-id="example"]')).toBe(card);
		expect(document.activeElement).toBe(card);
	});

	it('uses a cached snapshot offline without clock or account network work', async () => {
		const h = harness({ cached: [ACCOUNT], online: false });
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([ACCOUNT]);
		expect(h.clock).not.toHaveBeenCalled();
		expect(h.fetch).not.toHaveBeenCalled();
	});

	it('shows a useful retry state when offline with no cache and replaces it with a legitimate empty vault', async () => {
		const h = harness({ online: false });
		await h.loadSecrets();
		expect(document.getElementById('emptyState').textContent).toContain('当前离线');
		expect(document.getElementById('emptyState').textContent).not.toContain('还没有密钥');
		h.navigator.onLine = true;
		h.fetch.mockResolvedValueOnce(response([]));
		await h.loadSecrets();
		expect(document.getElementById('emptyState').textContent).toContain('还没有密钥');
		expect(document.getElementById('emptyState').textContent).not.toContain('重试');
	});

	it.each(['clock', 'headers', 'body'])('bounds a stalled %s without hiding cached cards or applying its late result', async (stage) => {
		const h = harness({ cached: [ACCOUNT] });
		const stalled = deferred();
		if (stage === 'clock') {
			h.clock.mockReturnValueOnce(stalled.promise);
		}
		if (stage === 'headers') {
			h.fetch.mockReturnValueOnce(stalled.promise);
		}
		if (stage === 'body') {
			h.fetch.mockResolvedValueOnce({ ...response(null), json: () => stalled.promise });
		}
		const reading = h.loadSecrets();
		await flush();
		await vi.advanceTimersByTimeAsync(8001);
		await reading;
		expect(h.getSecrets()).toEqual([ACCOUNT]);
		expect(document.getElementById('secretsList').textContent).toBe('Example');
		if (stage !== 'clock') {
			expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		}
		stalled.resolve(stage === 'clock' ? true : stage === 'headers' ? response([UPDATED]) : [UPDATED]);
		await flush();
		expect(h.getSecrets()).toEqual([ACCOUNT]);
		expect(h.readCache().data).toEqual([ACCOUNT]);
		if (stage === 'clock') {
			expect(h.fetch).not.toHaveBeenCalled();
		}
	});

	it.each(['body network failure', 'server error'])('retains valid local data on %s', async (kind) => {
		const h = harness({ cached: [ACCOUNT] });
		h.fetch.mockResolvedValueOnce(
			kind === 'server error'
				? response({}, 503)
				: {
						...response(null),
						json: async () => {
							throw new TypeError('Connection reset');
						},
					},
		);
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([ACCOUNT]);
		expect(h.readCache().data).toEqual([ACCOUNT]);
		expect(h.render).toHaveBeenCalledOnce();
	});

	it.each([401, 403])('clears previously shown cached codes on a current %i and blocks offline fallback', async (status) => {
		const h = harness({ cached: [ACCOUNT] });
		h.fetch.mockResolvedValueOnce(response({}, status));
		await h.loadSecrets();
		expect(h.getBlocked()).toBe(true);
		expect(h.getSecrets()).toEqual([]);
		expect(h.storage.getItem(CACHE_KEY)).toBeNull();
		expect(document.getElementById('secretsList').textContent).toBe('');
		h.navigator.onLine = false;
		await h.loadSecrets();
		expect(h.render).toHaveBeenCalledOnce();
	});

	it.each([{}, null, 'accounts', { data: [ACCOUNT] }])(
		'fails closed for a successful response that is not an account list: %j',
		async (invalid) => {
			const h = harness({ cached: [ACCOUNT] });
			h.fetch.mockResolvedValueOnce(response(invalid));
			await h.loadSecrets();
			expect(h.getSecrets()).toEqual([]);
			expect(h.storage.getItem(CACHE_KEY)).toBeNull();
			expect(document.getElementById('secretsList').textContent).toBe('');
			expect(document.getElementById('emptyState').textContent).toContain('账户数据暂时无法读取');
			h.fetch.mockResolvedValueOnce(response([UPDATED]));
			await h.loadSecrets();
			expect(h.getSecrets()).toEqual([UPDATED]);
		},
	);

	it.each([
		['a null entry', null],
		['an invalid secret', { ...ACCOUNT, id: 'bad', secret: '<invalid>' }],
		['unsupported digits', { ...ACCOUNT, id: 'bad', digits: 7 }],
		['an unsupported algorithm', { ...ACCOUNT, id: 'bad', algorithm: 'MD5' }],
		['a non-string name', { ...ACCOUNT, id: 'bad', name: null }],
		['a repeated identifier', { ...UPDATED }],
	])('keeps every usable server account when one record has %s', async (_label, invalid) => {
		const other = { ...ACCOUNT, id: 'other', name: 'Other' };
		const h = harness({ cached: [ACCOUNT] });
		h.fetch.mockResolvedValueOnce(response([ACCOUNT, invalid, other]));
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([ACCOUNT, other]);
		expect(document.getElementById('secretsList').textContent).toBe('ExampleOther');
		expect(h.readCache().data).toEqual([ACCOUNT, other]);
		expect(h.toast).toHaveBeenCalledWith('⚠️', '有 1 个账户的数据无效或 OTP 参数不受支持，未显示。服务器上的数据未被修改。');
		expect(document.getElementById('emptyState').textContent).not.toContain('账户数据暂时无法读取');
	});

	it.each(['', '   ', '\t\n\u3000'])(
		'keeps a legacy blank name %j visible and editable online and after an offline reopen',
		async (name) => {
			const legacy = { ...ACCOUNT, id: 'legacy', name };
			const h = harness();
			h.fetch.mockResolvedValueOnce(response([ACCOUNT, legacy, { ...ACCOUNT, id: 'bad', secret: 'invalid!' }]));
			await h.loadSecrets();
			expect(h.getSecrets()).toEqual([ACCOUNT, legacy]);
			expect(h.readCache().data).toEqual([ACCOUNT, legacy]);
			expect(h.toast).toHaveBeenCalledWith('⚠️', '有 1 个账户的数据无效或 OTP 参数不受支持，未显示。服务器上的数据未被修改。');

			const offline = harness({ cached: h.readCache().data, online: false });
			await offline.loadSecrets();
			expect(offline.getSecrets()).toEqual([ACCOUNT, legacy]);
			expect(offline.fetch).not.toHaveBeenCalled();
			document.getElementById('secretsList').innerHTML = offline.createSecretCard(legacy);
			expect(document.querySelector('.secret-name').textContent).toBe('未命名');
			expect(document.querySelector('[onclick*="editSecret"]').getAttribute('onclick')).toContain('legacy');

			for (const id of [
				'secretId',
				'secretName',
				'secretService',
				'secretKey',
				'secretType',
				'secretDigits',
				'secretPeriod',
				'secretAlgorithm',
				'secretCounter',
				'showAdvanced',
			]) {
				const input = document.createElement('input');
				input.id = id;
				if (id === 'secretName') {
					input.type = 'hidden'; // Preserve tabs/newlines when checking the original value.
				}
				document.body.append(input);
			}
			offline.editSecret('legacy');
			expect(document.getElementById('secretId').value).toBe('legacy');
			expect(document.getElementById('secretName').value).toBe(name);
			expect(document.getElementById('secretKey').value).toBe(ACCOUNT.secret);
		},
	);

	it('announces hidden records once per list and again when the count changes', async () => {
		const invalid = { ...ACCOUNT, id: 'bad', digits: 9 };
		const h = harness();
		h.fetch.mockResolvedValue(response([ACCOUNT, invalid]));
		await h.loadSecrets();
		await h.loadSecrets();
		expect(h.toast).toHaveBeenCalledTimes(1);
		h.fetch.mockResolvedValue(response([ACCOUNT, invalid, { ...invalid, id: 'bad-2' }]));
		await h.loadSecrets();
		expect(h.toast).toHaveBeenLastCalledWith('⚠️', '有 2 个账户的数据无效或 OTP 参数不受支持，未显示。服务器上的数据未被修改。');
		h.fetch.mockResolvedValue(response([ACCOUNT]));
		await h.loadSecrets();
		h.fetch.mockResolvedValue(response([ACCOUNT, invalid]));
		await h.loadSecrets();
		expect(h.toast).toHaveBeenCalledTimes(3);
	});

	it('shows the empty vault state instead of a read failure when every server record is unusable', async () => {
		const h = harness({ cached: [ACCOUNT] });
		h.fetch.mockResolvedValueOnce(response([{ ...ACCOUNT, secret: '1' }]));
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([]);
		expect(h.readCache().data).toEqual([]);
		expect(document.getElementById('emptyState').textContent).not.toContain('账户数据暂时无法读取');
		expect(h.toast).toHaveBeenCalledWith('⚠️', '有 1 个账户的数据无效或 OTP 参数不受支持，未显示。服务器上的数据未被修改。');
	});

	it('keeps rejecting a local snapshot that contains any unusable record', async () => {
		const h = harness({ cached: [ACCOUNT, { ...ACCOUNT, id: 'bad', digits: 7 }], online: false });
		await h.loadSecrets();
		expect(h.render).not.toHaveBeenCalled();
		expect(h.getSecrets()).toEqual([]);
		expect(document.getElementById('emptyState').textContent).toContain('当前离线');
	});

	it('distinguishes malformed JSON from a transport error', async () => {
		const h = harness({ cached: [ACCOUNT] });
		h.fetch.mockResolvedValueOnce({
			...response(null),
			json: async () => {
				throw new SyntaxError('Invalid JSON');
			},
		});
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([]);
		expect(h.storage.getItem(CACHE_KEY)).toBeNull();
	});

	it('never renders malformed cached records and accepts legacy numeric identifiers from the network', async () => {
		const h = harness({ cached: [null] });
		h.fetch.mockResolvedValueOnce(response([{ id: 42, name: 'Legacy', secret: ACCOUNT.secret }]));
		await h.loadSecrets();
		expect(h.render).toHaveBeenCalledOnce();
		expect(h.getSecrets()[0].id).toBe(42);
	});

	it('restores more than 5000 accounts from the persisted web cache on an offline reopen', async () => {
		const h = harness();
		const records = Array.from({ length: 5001 }, (_, index) => ({ ...ACCOUNT, id: String(index) }));
		h.fetch.mockResolvedValueOnce(response(records));
		await h.loadSecrets();
		expect(h.getSecrets()).toHaveLength(5001);

		const reopened = harness({ cached: h.readCache().data, online: false });
		await reopened.loadSecrets();
		expect(reopened.getSecrets()).toEqual(records);
		expect(reopened.render).toHaveBeenCalledOnce();
		expect(reopened.fetch).not.toHaveBeenCalled();
		expect(reopened.clock).not.toHaveBeenCalled();
	});

	it('does not let an older read replace a confirmed mutation or restore a removed account', async () => {
		const h = harness({ cached: [ACCOUNT] });
		const oldRead = deferred();
		h.fetch.mockReturnValueOnce(oldRead.promise);
		const reading = h.loadSecrets();
		await flush();
		h.commitSecretListChange([]);
		h.navigator.onLine = false;
		await h.loadSecrets();
		oldRead.resolve(response([ACCOUNT]));
		await reading;
		expect(h.getSecrets()).toEqual([]);
		expect(h.readCache().data).toEqual([]);
	});

	it('retries rendering unchanged data after the first local render failed', async () => {
		const h = harness({ cached: [ACCOUNT] });
		h.render.mockRejectedValueOnce(new Error('Temporary render failure'));
		await h.loadSecrets();
		expect(h.render).toHaveBeenCalledTimes(2);
		expect(document.getElementById('secretsList').textContent).toBe('Example');
	});

	it('does not reuse an obsolete local render after an invalid response and recovery with the same accounts', async () => {
		const h = harness({ cached: [ACCOUNT] });
		const staleRendering = deferred();
		h.render.mockReturnValueOnce(staleRendering.promise);
		h.fetch.mockResolvedValueOnce(response({ invalid: true }));
		await h.loadSecrets();
		expect(document.getElementById('secretsList').textContent).toBe('');
		staleRendering.resolve();
		await flush();
		await h.loadSecrets();
		expect(h.render).toHaveBeenCalledTimes(2);
		expect(document.getElementById('secretsList').textContent).toBe('Example');
	});
});
