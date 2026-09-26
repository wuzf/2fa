// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUICode } from '../../src/ui/scripts/ui.js';

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
const B = { ...A, id: 'b', name: 'Account B', account: 'bob' };

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function response(secret, ok = true) {
	return { ok, status: ok ? 200 : 500, json: async () => secret };
}

async function flush() {
	for (let i = 0; i < 30; i++) {
		await Promise.resolve();
	}
}

function harness({ storage, i18n = false } = {}) {
	document.body.innerHTML = `<div id="secretModal" style="display:none"><h2 id="modalTitle" data-i18n="addSecretTitle"></h2><form id="secretForm">
		<input id="secretId"><input id="secretName"><input id="secretService"><input id="secretKey">
		<select id="secretType"><option value="TOTP" selected>TOTP</option><option value="HOTP">HOTP</option></select>
		<input id="secretDigits" value="6"><input id="secretPeriod" value="30">
		<input id="secretAlgorithm" value="SHA1"><input id="secretCounter" value="0"><input id="showAdvanced" type="checkbox">
		<div id="advancedOptions"><div id="digitsGroup"></div><div id="periodGroup"></div>
		<div id="algorithmGroup"></div><div id="counterRow"></div>
		<div id="advancedInfo" data-i18n="secretAdvancedHelp">大多数2FA应用使用默认设置：TOTP、6位、30秒、SHA1算法</div></div>
		<button id="submitBtn" type="submit" data-i18n="save">保存</button></form></div>
		<div id="loading"></div><div id="emptyState"></div>
		<select id="settingsLanguage"><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en">English</option></select>`;
	const fetch = vi.fn();
	const render = vi.fn(async () => {});
	const toast = vi.fn();
	const lock = vi.fn();
	const unlock = vi.fn();
	const discardQueued = vi.fn(async () => true);
	const values = new Map([['language', 'zh-CN']]);
	storage ||= {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, String(value))),
		removeItem: vi.fn((key) => values.delete(key)),
	};
	// Execute the actual emitted UI/core functions, including dialog timers.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'authenticatedFetch',
		'render',
		'toast',
		'disableBodyScroll',
		'enableBodyScroll',
		'console',
		'setInterval',
		'localStorage',
		'showConfirmDialog',
		'navigator',
		'discardReplacedOfflineQueueOperation',
		`
		${getI18nCode()}
		${i18n ? getSettingsCode() : ''}
		${getStateCode()}
		${getUICode()}
		${getCoreCode()}
		renderSecrets = render;
		showCenterToast = toast;
		async function ensureServerTimeSynchronized() { return true; }
		return { editSecret, showAddModal, hideSecretModal, handleSubmit, deleteSecret, loadSecrets, showQueuedSecretEditor,
			toggleAdvancedOptions, updateAdvancedOptionsForType,
			${i18n ? 'setLanguage, loadPreferences,' : ''}
			setSecrets(value) { secrets = value; }, getSecrets() { return secrets; },
			setQueue(value) { saveQueue = value; }, getQueue() { return saveQueue; }
		};
	`,
	)(
		document,
		window,
		fetch,
		render,
		toast,
		lock,
		unlock,
		{ log() {}, warn() {}, error() {} },
		vi.fn(),
		storage,
		vi.fn(async () => true),
		{ language: 'zh-CN', onLine: true },
		discardQueued,
	);
	api.setSecrets(globalThis.structuredClone([A, B]));
	return {
		...api,
		fetch,
		render,
		toast,
		lock,
		unlock,
		storage,
		discardQueued,
		submit: () => api.handleSubmit({ preventDefault() {} }),
		field: (id) => document.getElementById(id),
		modal: document.getElementById('secretModal'),
		button: document.getElementById('submitBtn'),
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('secret dialog translations and delayed preferences', () => {
	it('keeps the edit labels and PUT target when preferences return after opening an edit', async () => {
		const h = harness({ i18n: true });
		const preferences = deferred();
		h.fetch.mockReturnValueOnce(preferences.promise).mockResolvedValueOnce(response(A));
		const loading = h.loadPreferences();
		h.editSecret(A.id);
		preferences.resolve(response({ language: 'zh-CN' }));
		await loading;

		expect(h.field('modalTitle').textContent).toBe('编辑密钥');
		expect(h.button.textContent).toBe('更新');
		expect(h.field('secretId').value).toBe(A.id);
		await h.submit();
		expect(h.fetch.mock.calls[1][0]).toBe('/api/secrets/a');
		expect(h.fetch.mock.calls[1][1].method).toBe('PUT');
	});

	it('restores add bindings after editing and keeps POST semantics across language changes', async () => {
		const h = harness({ i18n: true });
		const preferences = deferred();
		h.fetch.mockReturnValueOnce(preferences.promise).mockResolvedValueOnce(response({ ...A, id: 'new' }));
		const loading = h.loadPreferences();
		h.editSecret(A.id);
		h.showAddModal();
		h.field('secretName').value = 'New account';
		h.field('secretKey').value = A.secret;
		preferences.resolve(response({ language: 'en' }));
		await loading;

		expect(h.field('modalTitle').textContent).toBe('Add New Key');
		expect(h.button.textContent).toBe('Save');
		h.setLanguage('zh-TW');
		expect(h.field('modalTitle').textContent).toBe('新增金鑰');
		expect(h.button.textContent).toBe('儲存');
		await h.submit();
		expect(h.fetch.mock.calls[1][0]).toBe('/api/secrets');
		expect(h.fetch.mock.calls[1][1].method).toBe('POST');
	});

	it.each(['edit', 'add'])('keeps %s submission progress translated and restores the current language after failure', async (mode) => {
		const h = harness({ i18n: true });
		const preferences = deferred();
		const pendingSave = deferred();
		h.fetch.mockReturnValueOnce(preferences.promise).mockReturnValueOnce(pendingSave.promise);
		const loading = h.loadPreferences();
		if (mode === 'edit') {
			h.editSecret(A.id);
		} else {
			h.showAddModal();
			h.field('secretName').value = 'New account';
			h.field('secretKey').value = A.secret;
		}
		const saving = h.submit();
		await flush();
		preferences.resolve(response({ language: 'en' }));
		await loading;

		expect(h.field('modalTitle').textContent).toBe(mode === 'edit' ? 'Edit Key' : 'Add New Key');
		expect(h.button.textContent).toBe('Saving...');
		expect(h.button.disabled).toBe(true);
		pendingSave.reject(new Error('Disconnected'));
		await saving;
		expect(h.button.textContent).toBe(mode === 'edit' ? 'Update' : 'Save');
		expect(h.button.disabled).toBe(false);
		h.setLanguage('zh-TW');
		expect(h.button.textContent).toBe(mode === 'edit' ? '更新' : '儲存');

		h.fetch.mockResolvedValueOnce(response(mode === 'edit' ? A : { ...A, id: 'new' }));
		await h.submit();
		expect(h.fetch.mock.calls[2][0]).toBe(mode === 'edit' ? '/api/secrets/a' : '/api/secrets');
		expect(h.fetch.mock.calls[2][1].method).toBe(mode === 'edit' ? 'PUT' : 'POST');
	});
});

describe('advanced OTP help translations', () => {
	function expectLocalizedHOTPHelp(h, counter) {
		for (const [language, counterLabel] of [
			['en', 'counter'],
			['zh-TW', '計數器'],
			['zh-CN', '计数器'],
		]) {
			h.setLanguage(language);
			expect(h.field('advancedInfo').textContent).toContain('HOTP');
			expect(h.field('advancedInfo').textContent).not.toContain('TOTP');
			expect(h.field('advancedInfo').textContent.toLowerCase()).toContain(counterLabel);
			expect(h.field('secretType').value).toBe('HOTP');
			expect(h.field('secretCounter').value).toBe(String(counter));
			expect(h.field('periodGroup').style.display).toBe('none');
			expect(h.field('counterRow').style.display).toBe('block');
		}
	}

	it('keeps the selected HOTP help and counter when the language refreshes', () => {
		const h = harness({ i18n: true });
		h.showAddModal();
		h.field('showAdvanced').checked = true;
		h.toggleAdvancedOptions();
		h.field('secretType').value = 'HOTP';
		h.field('secretCounter').value = '37';
		h.updateAdvancedOptionsForType();

		expectLocalizedHOTPHelp(h, 37);
	});

	it('keeps HOTP edit help translated and returns to TOTP help when its type changes', () => {
		const h = harness({ i18n: true });
		h.setSecrets([{ ...A, type: 'HOTP', counter: 42 }]);
		h.editSecret(A.id);
		expect(h.field('showAdvanced').checked).toBe(true);
		expectLocalizedHOTPHelp(h, 42);

		h.field('secretType').value = 'TOTP';
		h.updateAdvancedOptionsForType();
		for (const language of ['en', 'zh-TW', 'zh-CN']) {
			h.setLanguage(language);
			expect(h.field('advancedInfo').textContent).toContain('TOTP');
			expect(h.field('advancedInfo').textContent).not.toContain('HOTP');
			expect(h.field('secretType').value).toBe('TOTP');
			expect(h.field('secretCounter').value).toBe('42');
			expect(h.field('periodGroup').style.display).toBe('block');
			expect(h.field('counterRow').style.display).toBe('none');
		}
	});

	it('restores TOTP help immediately when a HOTP edit closes and the add form resets', () => {
		const h = harness({ i18n: true });
		h.setSecrets([{ ...A, type: 'HOTP', counter: 42 }]);
		h.editSecret(A.id);
		h.hideSecretModal();
		h.showAddModal();

		expect(h.field('secretType').value).toBe('TOTP');
		expect(h.field('secretCounter').value).toBe('0');
		expect(h.field('advancedInfo').textContent).toContain('TOTP');
		expect(h.field('advancedInfo').textContent).not.toContain('HOTP');
		h.setLanguage('en');
		expect(h.field('advancedInfo').textContent).toContain('TOTP');
		h.field('showAdvanced').checked = true;
		h.toggleAdvancedOptions();
		expect(h.field('advancedInfo').textContent).toContain('TOTP');
		expect(h.field('periodGroup').style.display).toBe('block');
		expect(h.field('counterRow').style.display).toBe('none');
	});
});

describe('secret save identity and dialog lifetime', () => {
	it('uses the submitted ID and form snapshot after waiting behind another queued operation', async () => {
		const h = harness();
		const preceding = deferred();
		h.setQueue(preceding.promise);
		h.fetch.mockResolvedValue(response({ ...A, name: 'Saved A' }));
		h.editSecret(A.id);
		h.field('secretName').value = 'Saved A';
		h.field('secretDigits').value = '8';
		const saving = h.submit();
		h.hideSecretModal();
		h.editSecret(B.id);
		h.field('secretName').value = 'Unsaved B';
		preceding.resolve();
		await saving;
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a');
		expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({ name: 'Saved A', account: 'alice', digits: 8 });
		expect(h.getSecrets()).toEqual([{ ...A, name: 'Saved A' }, B]);
		expect(h.field('secretName').value).toBe('Unsaved B');
		expect(h.button.textContent).toBe('更新');
		expect(h.button.disabled).toBe(false);
		vi.advanceTimersByTime(400);
		expect(h.modal.style.display).toBe('flex');
		expect(h.modal.classList.contains('show')).toBe(true);
	});

	it('updates A only when its response arrives after another account has opened', async () => {
		const h = harness();
		const pending = deferred();
		h.fetch.mockReturnValueOnce(pending.promise);
		h.editSecret(A.id);
		h.field('secretName').value = 'Updated A';
		const saving = h.submit();
		await flush();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a');
		h.hideSecretModal();
		h.editSecret(B.id);
		pending.resolve(response({ data: { secret: { ...A, name: 'Updated A' } } }));
		await saving;
		expect(h.getSecrets()).toEqual([{ ...A, name: 'Updated A' }, B]);
		expect(h.field('secretId').value).toBe(B.id);
		expect(h.button.disabled).toBe(false);
		vi.advanceTimersByTime(400);
		expect(h.modal.style.display).toBe('flex');
	});

	it('keeps an add request as POST when another account is opened while it waits', async () => {
		const h = harness();
		const preceding = deferred();
		h.setQueue(preceding.promise);
		h.fetch.mockResolvedValue(response({ ...A, id: 'new', name: 'New account' }));
		h.showAddModal();
		h.field('secretName').value = 'New account';
		h.field('secretKey').value = A.secret;
		const saving = h.submit();
		h.editSecret(B.id);
		preceding.resolve();
		await saving;
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets');
		expect(h.fetch.mock.calls[0][1].method).toBe('POST');
		expect(h.getSecrets()).toEqual([A, B, { ...A, id: 'new', name: 'New account' }]);
		expect(h.field('secretId').value).toBe(B.id);
	});

	it('does not close or enable the new submission after closing and reopening the same account', async () => {
		const h = harness();
		const first = deferred();
		const second = deferred();
		h.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		h.editSecret(A.id);
		const firstSave = h.submit();
		await flush();
		h.hideSecretModal();
		h.editSecret(A.id);
		h.field('secretName').value = 'Second edit';
		const secondSave = h.submit();
		first.resolve(response(A));
		await firstSave;
		await flush();
		expect(h.fetch).toHaveBeenCalledTimes(2);
		expect(h.button.disabled).toBe(true);
		expect(h.button.textContent).toBe('保存中...');
		expect(h.field('secretName').value).toBe('Second edit');
		vi.advanceTimersByTime(400);
		expect(h.modal.style.display).toBe('flex');
		second.resolve(response({ ...A, name: 'Second edit' }));
		await secondSave;
		vi.advanceTimersByTime(300);
		expect(h.modal.style.display).toBe('none');
		expect(h.getSecrets()[0].name).toBe('Second edit');
	});

	it.each(['http', 'network', 'offline'])('ignores stale %s feedback while a new dialog is active', async (kind) => {
		const h = harness();
		const pending = deferred();
		h.fetch.mockReturnValueOnce(pending.promise);
		h.editSecret(A.id);
		const saving = h.submit();
		await flush();
		h.hideSecretModal();
		h.showAddModal();
		h.field('secretName').value = 'Draft';
		if (kind === 'network') {
			pending.reject(new Error('Disconnected'));
		} else {
			pending.resolve(response(kind === 'http' ? { message: 'Could not save A' } : { queued: true, offline: true }, kind !== 'http'));
		}
		await saving;
		expect(h.toast).not.toHaveBeenCalled();
		expect(h.button.textContent).toBe('保存');
		expect(h.button.disabled).toBe(false);
		expect(h.field('secretName').value).toBe('Draft');
		vi.advanceTimersByTime(400);
		expect(h.modal.style.display).toBe('flex');
	});

	it('allows retry after a current failure and deduplicates repeated submission events', async () => {
		const h = harness();
		const first = deferred();
		h.fetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response(A));
		h.editSecret(A.id);
		const saving = h.submit();
		const duplicate = h.submit();
		await flush();
		expect(h.fetch).toHaveBeenCalledOnce();
		first.reject(new Error('Disconnected'));
		await Promise.all([saving, duplicate]);
		expect(h.toast).toHaveBeenCalledOnce();
		expect(h.button.disabled).toBe(false);
		expect(h.button.textContent).toBe('更新');
		await h.submit();
		expect(h.fetch).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(300);
		expect(h.modal.style.display).toBe('none');
	});

	it('does not let an older render completion close a newly opened dialog', async () => {
		const h = harness();
		const rendering = deferred();
		h.render.mockReturnValueOnce(rendering.promise);
		h.fetch.mockResolvedValue(response(A));
		h.editSecret(A.id);
		const saving = h.submit();
		await flush();
		expect(h.render).toHaveBeenCalledOnce();
		h.hideSecretModal();
		h.editSecret(B.id);
		rendering.resolve();
		await saving;
		vi.advanceTimersByTime(400);
		expect(h.modal.style.display).toBe('flex');
		expect(h.field('secretId').value).toBe(B.id);
	});

	it('closes before the opening animation and never lets old hide timers hide a replacement', () => {
		const h = harness();
		h.showAddModal();
		h.hideSecretModal();
		vi.advanceTimersByTime(20);
		expect(h.modal.classList.contains('show')).toBe(false);
		h.editSecret(A.id);
		vi.advanceTimersByTime(400);
		expect(h.modal.classList.contains('show')).toBe(true);
		expect(h.modal.style.display).toBe('flex');
		expect(h.lock).toHaveBeenCalledTimes(2);
		expect(h.unlock).toHaveBeenCalledOnce();
	});

	it('recovers from a rejected preceding queue without modifying the replacement dialog', async () => {
		const h = harness();
		const preceding = deferred();
		h.setQueue(preceding.promise);
		h.editSecret(A.id);
		const saving = h.submit();
		h.hideSecretModal();
		h.showAddModal();
		preceding.reject(new Error('Earlier task failed'));
		await saving;
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.button.disabled).toBe(false);
		expect(h.button.textContent).toBe('保存');
		expect(h.toast).not.toHaveBeenCalled();
	});
});

describe('confirmed mutations and the web offline snapshot', () => {
	const key = '2fa-secrets-cache';
	const edited = { ...A, name: 'Updated account', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
	const added = { ...A, id: 'created', name: 'New account' };
	const expected = { add: [A, B, added], edit: [edited, B], delete: [B] };
	const resultFor = (kind) => response(kind === 'add' ? { data: { secret: added } } : kind === 'edit' ? edited : { success: true });
	const readCache = (h) => JSON.parse(h.storage.getItem(key));
	function seedCache(h) {
		h.storage.setItem(key, JSON.stringify({ data: [A, B], timestamp: 1 }));
	}
	async function mutate(h, kind) {
		if (kind === 'delete') {
			await h.deleteSecret(A.id);
			return h.getQueue();
		}
		if (kind === 'add') {
			h.showAddModal();
			h.field('secretName').value = added.name;
			h.field('secretKey').value = added.secret;
		} else {
			h.editSecret(A.id);
			h.field('secretName').value = edited.name;
			h.field('secretKey').value = edited.secret;
		}
		return h.submit();
	}

	it.each(['add', 'edit', 'delete'])(
		'persists a confirmed %s before rendering and restores that snapshot offline after reopening',
		async (kind) => {
			const h = harness();
			seedCache(h);
			const rendering = deferred();
			h.render.mockReturnValueOnce(rendering.promise);
			h.fetch.mockResolvedValueOnce(resultFor(kind));
			const saving = mutate(h, kind);
			await flush();
			expect(h.render).toHaveBeenCalledOnce();
			expect(readCache(h).data).toEqual(expected[kind]);
			expect(readCache(h).timestamp).toBeGreaterThan(1);
			expect(Object.keys(readCache(h)).sort()).toEqual(['data', 'hiddenCount', 'timestamp']);
			expect(readCache(h).hiddenCount).toBe(0);
			rendering.resolve();
			await saving;
			const reopened = harness({ storage: h.storage });
			reopened.setSecrets([]);
			reopened.fetch.mockRejectedValueOnce(new TypeError('Offline'));
			await reopened.loadSecrets();
			expect(reopened.getSecrets()).toEqual(expected[kind]);
		},
	);

	it.each(['add', 'edit', 'delete'])('ignores an older list response that arrives after the confirmed %s', async (kind) => {
		const h = harness();
		seedCache(h);
		const oldList = deferred();
		h.fetch.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce(resultFor(kind));
		const reading = h.loadSecrets();
		await flush();
		await mutate(h, kind);
		oldList.resolve(response([A, B]));
		await reading;
		expect(h.getSecrets()).toEqual(expected[kind]);
		expect(readCache(h).data).toEqual(expected[kind]);
	});

	it('does not duplicate a created account already returned by a concurrent list response', async () => {
		const h = harness();
		seedCache(h);
		const posting = deferred();
		h.fetch.mockReturnValueOnce(posting.promise).mockResolvedValueOnce(response([A, B, added]));
		const saving = mutate(h, 'add');
		await flush();
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([A, B, added]);
		posting.resolve(resultFor('add'));
		await saving;
		expect(h.getSecrets()).toEqual([A, B, added]);
		expect(readCache(h).data).toEqual([A, B, added]);
	});

	it.each(['add', 'edit', 'delete'])('does not persist a queued or failed %s as a confirmed change', async (kind) => {
		for (const result of [response({ queued: true, offline: true }), response({ message: 'Could not save' }, false)]) {
			const h = harness();
			seedCache(h);
			const before = h.storage.getItem(key);
			h.fetch.mockResolvedValueOnce(result);
			await mutate(h, kind);
			expect(h.getSecrets()).toEqual([A, B]);
			expect(h.storage.getItem(key)).toBe(before);
		}
	});

	it.each(['add', 'edit', 'delete'])('discards the outdated cache if browser quota prevents persisting a confirmed %s', async (kind) => {
		const h = harness();
		seedCache(h);
		h.storage.setItem.mockImplementationOnce(() => {
			throw new Error('Quota exceeded');
		});
		h.fetch.mockResolvedValueOnce(resultFor(kind));
		await mutate(h, kind);
		expect(h.getSecrets()).toEqual(expected[kind]);
		expect(h.storage.getItem(key)).toBeNull();
		expect(h.toast).toHaveBeenCalledWith('⚠️', kind === 'delete' ? '已删除，暂时无法离线使用' : '已保存，暂时无法离线使用');
		expect(h.toast.mock.calls.some(([, message]) => message.includes('保存失败') || message.includes('删除失败'))).toBe(false);
	});

	it('uses confirmed in-memory data if both cache writing and removal fail, and resumes caching on recovery', async () => {
		const h = harness();
		seedCache(h);
		const originalSet = h.storage.setItem.getMockImplementation();
		h.storage.setItem.mockImplementationOnce(() => {
			throw new Error('Storage unavailable');
		});
		h.storage.removeItem.mockImplementationOnce(() => {
			throw new Error('Removal unavailable');
		});
		h.fetch.mockResolvedValueOnce(resultFor('delete')).mockRejectedValueOnce(new TypeError('Offline'));
		await mutate(h, 'delete');
		expect(readCache(h).data).toEqual([A, B]);
		h.field('emptyState').style.display = 'none';
		await h.loadSecrets();
		expect(h.getSecrets()).toEqual([B]);
		expect(h.field('emptyState').style.display).toBe('none');
		expect(h.render).toHaveBeenCalledTimes(2);
		h.storage.setItem.mockImplementation(originalSet);
		h.fetch.mockResolvedValueOnce(response([B])).mockRejectedValueOnce(new TypeError('Offline'));
		await h.loadSecrets();
		expect(readCache(h).data).toEqual([B]);
		const reopened = harness({ storage: h.storage });
		reopened.setSecrets([]);
		reopened.fetch.mockRejectedValueOnce(new TypeError('Offline'));
		await reopened.loadSecrets();
		expect(reopened.getSecrets()).toEqual([B]);
	});

	it('advances snapshot timestamps for successive successful writes in the same millisecond', async () => {
		const h = harness();
		h.fetch.mockResolvedValueOnce(resultFor('edit')).mockResolvedValueOnce(resultFor('delete'));
		await mutate(h, 'edit');
		const first = readCache(h).timestamp;
		await mutate(h, 'delete');
		expect(readCache(h).timestamp).toBeGreaterThan(first);
		expect(readCache(h).data).toEqual([B]);
	});

	it('does not cache a response naming a different account from the submitted edit', async () => {
		const h = harness();
		seedCache(h);
		h.fetch.mockResolvedValueOnce(response(B));
		await mutate(h, 'edit');
		expect(h.getSecrets()).toEqual([A, B]);
		expect(readCache(h).data).toEqual([A, B]);
		expect(h.toast).toHaveBeenCalledWith('❌', expect.stringContaining('服务器返回的账户与保存请求不一致'));
	});
});

describe('secret form validation mirrors the server rules', () => {
	function openAdd(h, values = {}) {
		h.showAddModal();
		h.field('secretName').value = 'Valid';
		h.field('secretKey').value = A.secret;
		for (const [id, value] of Object.entries(values)) {
			h.field(id).value = value;
		}
	}

	it.each([
		['a name longer than 50 characters', { secretName: 'N'.repeat(51) }, '服务名称过长，最多支持50个字符（当前：51）', 'secretName'],
		[
			'non-Base32 characters',
			{ secretKey: 'JBSWY3DP1XYZ' },
			'密钥格式无效，只能包含字母A-Z和数字2-7（例如：JBSWY3DPEHPK3PXP）',
			'secretKey',
		],
		['a secret shorter than 8 characters', { secretKey: 'JBSW Y3D' }, '密钥长度过短（7字符），至少需要8字符以确保基本安全性', 'secretKey'],
		['unsupported digits', { secretDigits: '7' }, '验证码位数仅支持6位或8位', 'secretDigits'],
		['an unsupported period', { secretPeriod: '45' }, 'TOTP周期仅支持30、60或120秒', 'secretPeriod'],
		['an unsupported algorithm', { secretAlgorithm: 'MD5' }, '哈希算法仅支持SHA1、SHA256或SHA512', 'secretAlgorithm'],
		[
			'an invalid HOTP counter',
			{ secretType: 'HOTP', secretCounter: '1.5' },
			'HOTP 计数器必须是 0 到 9007199254740991 之间的整数',
			'secretCounter',
		],
	])('keeps the dialog open and sends nothing for %s', async (_label, values, message, field) => {
		const h = harness();
		openAdd(h, values);
		await h.submit();
		vi.advanceTimersByTime(400);
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledWith('❌', message);
		expect(h.modal.style.display).toBe('flex');
		expect(h.button.disabled).toBe(false);
		expect(document.activeElement).toBe(h.field(field));
		expect(h.field('secretName').value).toBe(values.secretName ?? 'Valid');
	});

	it('checks the rules before an offline save can be queued and still queues valid changes', async () => {
		const h = harness();
		openAdd(h, { secretName: 'N'.repeat(51) });
		await h.submit();
		expect(h.fetch).not.toHaveBeenCalled();
		h.field('secretName').value = 'Offline account';
		h.fetch.mockResolvedValueOnce({
			ok: true,
			status: 202,
			json: async () => ({ success: true, queued: true, offline: true, operationId: 'op' }),
		});
		await h.submit();
		vi.advanceTimersByTime(400);
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.toast).toHaveBeenLastCalledWith('📥', '操作已保存，网络恢复后自动同步');
		expect(h.modal.style.display).toBe('none');
	});

	it('accepts what the server accepts, including spaced and padded secrets, and ignores an unused TOTP counter', async () => {
		const h = harness();
		openAdd(h, { secretName: '  ' + 'N'.repeat(50) + '  ', secretKey: ' jbsw y3dp ehpk 3pxp== ', secretCounter: '-1' });
		h.fetch.mockResolvedValueOnce(response({ ...A, id: 'new' }));
		await h.submit();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({
			name: 'N'.repeat(50),
			secret: 'JBSW Y3DP EHPK 3PXP==',
			type: 'TOTP',
			counter: 0,
		});
	});
});

describe('correcting a stopped offline change', () => {
	const rejectedEdit = {
		id: 'op-1',
		type: 'UPDATE',
		targetId: 'a',
		reason: '服务名称过长，最多支持50个字符（当前：51）',
		data: {
			name: 'N'.repeat(51),
			account: 'alice',
			secret: A.secret,
			type: 'hotp',
			digits: 8,
			period: 30,
			algorithm: 'sha256',
			counter: 4,
		},
	};

	it('reopens a rejected edit with its content and replaces the stopped copy only after saving', async () => {
		const h = harness();
		expect(h.showQueuedSecretEditor(rejectedEdit)).toBe(true);
		expect(h.field('modalTitle').textContent).toBe('编辑密钥');
		expect(h.field('secretName').value).toBe('N'.repeat(51));
		expect(h.field('secretService').value).toBe('alice');
		expect(h.field('secretKey').value).toBe(A.secret);
		expect(h.field('secretType').value).toBe('HOTP');
		expect(h.field('secretDigits').value).toBe('8');
		expect(h.field('secretAlgorithm').value).toBe('SHA256');
		expect(h.field('secretCounter').value).toBe('4');
		expect(h.toast).toHaveBeenCalledWith('⚠️', rejectedEdit.reason);

		await h.submit();
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.discardQueued).not.toHaveBeenCalled();

		h.field('secretName').value = 'Fixed';
		h.fetch.mockResolvedValueOnce(response({ ...A, name: 'Fixed', type: 'HOTP', digits: 8, algorithm: 'SHA256', counter: 4 }));
		await h.submit();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a');
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
		expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({
			name: 'Fixed',
			type: 'HOTP',
			digits: 8,
			algorithm: 'SHA256',
			counter: 4,
		});
		expect(h.discardQueued).toHaveBeenCalledExactlyOnceWith('op-1');
		expect(h.getSecrets().find((item) => item.id === 'a').name).toBe('Fixed');
	});

	it('queues a corrected add again while offline and drops the stopped copy', async () => {
		const h = harness();
		h.showQueuedSecretEditor({ id: 'op-2', type: 'ADD', targetId: '', data: { name: 'New', secret: 'JBSWY3DP1' } });
		expect(h.field('modalTitle').textContent).toBe('添加新密钥');
		expect(h.field('secretType').value).toBe('TOTP');
		h.field('secretKey').value = A.secret;
		h.fetch.mockResolvedValueOnce({
			ok: true,
			status: 202,
			json: async () => ({ success: true, queued: true, offline: true, operationId: 'op-3' }),
		});
		await h.submit();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets');
		expect(h.fetch.mock.calls[0][1].method).toBe('POST');
		expect(h.discardQueued).toHaveBeenCalledExactlyOnceWith('op-2');
	});

	it('keeps the stopped copy when the corrected save is rejected and forgets it for later dialogs', async () => {
		const h = harness();
		h.showQueuedSecretEditor({ id: 'op-4', type: 'ADD', data: { name: 'New', secret: A.secret } });
		h.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: 'Duplicate account' }) });
		await h.submit();
		expect(h.toast).toHaveBeenLastCalledWith('❌', 'Duplicate account');
		expect(h.discardQueued).not.toHaveBeenCalled();

		h.showAddModal();
		h.field('secretName').value = 'Other';
		h.field('secretKey').value = A.secret;
		h.fetch.mockResolvedValueOnce(response({ ...A, id: 'other', name: 'Other' }));
		await h.submit();
		h.editSecret(A.id);
		h.fetch.mockResolvedValueOnce(response(A));
		await h.submit();
		expect(h.fetch).toHaveBeenCalledTimes(3);
		expect(h.discardQueued).not.toHaveBeenCalled();
	});

	it.each([
		['an edit without its account', { type: 'UPDATE', targetId: '' }],
		['a deletion', { type: 'DELETE' }],
		['missing content', { type: 'ADD', data: null }],
		['a missing identifier', { type: 'ADD', id: 7 }],
	])('does not open the dialog for %s', (_label, changes) => {
		const h = harness();
		expect(h.showQueuedSecretEditor({ id: 'op-5', type: 'ADD', data: { name: 'New', secret: A.secret }, ...changes })).toBe(false);
		expect(h.modal.style.display).toBe('none');
	});
});
