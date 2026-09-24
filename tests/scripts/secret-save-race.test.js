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
		`
		${i18n ? getI18nCode() + getSettingsCode() : ''}
		${getStateCode()}
		${getUICode()}
		${getCoreCode()}
		renderSecrets = render;
		showCenterToast = toast;
		async function ensureServerTimeSynchronized() { return true; }
		function showModal(id, onShow) {
			const modal = document.getElementById(id);
			modal.style.display = 'flex';
			if (onShow) onShow();
			modal.classList.add('show');
		}
		return { editSecret, showAddModal, hideSecretModal, handleSubmit, deleteSecret, loadSecrets,
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
		submit: () => {
			api.handleSubmit({ preventDefault() {} });
			return api.getQueue();
		},
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
