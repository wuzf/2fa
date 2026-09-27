// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../extension/src/locales/index.js';
const HTML = readFileSync(resolve(process.cwd(), 'extension/src/options/options.html'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(resolve(process.cwd(), 'extension/manifest.base.json'), 'utf8'));
const A = 'https://a.example';
const B = 'https://b.example';
let values;
let sendMessage;
async function flush() {
	for (let i = 0; i < 100; i++) {
		await Promise.resolve();
	}
}
async function openOptions() {
	const template = document.createElement('template');
	template.innerHTML = HTML;
	document.body.replaceChildren(template.content.querySelector('header'), template.content.querySelector('main'));
	await import('../../extension/src/options/index.js');
	await flush();
}
function editAddress(origin = document.getElementById('instance-origin').value) {
	const input = document.getElementById('instance-origin');
	input.value = origin;
	input.dispatchEvent(new Event('input'));
}
async function save(origin) {
	if (document.getElementById('instance-origin').value !== origin) {
		editAddress(origin);
		await flush();
	}
	document.getElementById('connect-instance').click();
	await flush();
}
function setOffline(enabled) {
	const checkbox = document.getElementById('offline-enabled');
	checkbox.checked = enabled;
	checkbox.dispatchEvent(new Event('change'));
}

const connectionChecks = () => sendMessage.mock.calls.filter(([message]) => message.type === 'CHECK_INSTANCE');
async function selectLanguage(preference) {
	const select = document.getElementById('extension-language');
	select.value = preference;
	select.dispatchEvent(new Event('change'));
	await flush();
}
const siteCard = (origin) => [...document.querySelectorAll('.site-card')].find((card) => card.dataset.origin === origin);
function emitSiteStorageChange(changes) {
	for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
		listener(changes, 'local');
	}
}

it('lists and searches separate paths on the same host, disabling only the selected path and preserving remembered accounts', async () => {
	values.autofillSites = [
		{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/mfa' },
		{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/admin#/otp' },
	];
	await openOptions();
	const card = siteCard('https://site-a.example');
	expect([...card.querySelectorAll('.site-path')].map((element) => element.textContent)).toEqual(['/admin#/otp', '/mfa']);
	const bindings = structuredClone(values.bindings);
	const search = document.getElementById('binding-search');
	search.value = '/admin#/otp';
	search.dispatchEvent(new Event('input'));
	await flush();
	expect(siteCard('https://site-a.example')).toBeDefined();
	siteCard('https://site-a.example').querySelector('[data-path="/admin#/otp"] .autofill-disable').click();
	await flush();
	expect(values.autofillSites).toEqual([{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/mfa' }]);
	expect(values.bindings).toEqual(bindings);
	expect(sendMessage).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'SET_AUTOFILL_SITE', targetPath: '/admin#/otp', enabled: false }),
	);
});
beforeEach(() => {
	vi.resetModules();
	values = {
		settings: { instanceOrigin: A },
		instances: [A, B],
		bindings: [
			{ instanceOrigin: A, targetOrigin: 'https://site-a.example', accountId: 'same-id' },
			{ instanceOrigin: B, targetOrigin: 'https://site-b.example', accountId: 'same-id' },
		],
		autofillSites: [],
	};
	sendMessage = vi.fn(async (message) => {
		if (message.type === 'GET_LANGUAGE') {
			const preference = values.language || 'auto';
			return { ok: true, data: { preference, language: preference === 'auto' ? chrome.i18n.getUILanguage() : preference } };
		}
		if (message.type === 'SAVE_LANGUAGE') {
			values.language = message.preference;
			return {
				ok: true,
				data: {
					preference: message.preference,
					language: message.preference === 'auto' ? chrome.i18n.getUILanguage() : message.preference,
				},
			};
		}
		if (message.type === 'GET_AUTOFILL_SITES') {
			return {
				ok: true,
				data: {
					instanceOrigin: values.settings.instanceOrigin,
					sites: values.autofillSites
						.filter((site) => site.instanceOrigin === values.settings.instanceOrigin)
						.map((site) => ({ ...site, targetPath: site.targetPath || '/' })),
				},
			};
		}
		if (message.type === 'SET_AUTOFILL_SITE') {
			values.autofillSites = values.autofillSites.filter(
				(site) =>
					site.instanceOrigin !== message.instanceOrigin ||
					site.targetOrigin !== message.targetOrigin ||
					(site.targetPath || '/') !== message.targetPath,
			);
			return {
				ok: true,
				data: {
					instanceOrigin: message.instanceOrigin,
					sites: values.autofillSites
						.filter((site) => site.instanceOrigin === message.instanceOrigin)
						.map((site) => ({ ...site, targetPath: site.targetPath || '/' })),
				},
			};
		}
		if (message.type === 'GET_SETTINGS') {
			return { ok: true, data: (await chrome.storage.local.get('settings')).settings };
		}
		if (message.type === 'SAVE_INSTANCE') {
			const savedMode = values.offlineInstances?.includes(message.instanceOrigin) ? 'offline' : 'session';
			if (
				message.expectedConnection &&
				(message.expectedConnection.instanceOrigin !== values.settings.instanceOrigin || message.expectedConnection.mode !== savedMode)
			) {
				return { ok: false, error: { code: 'REQUEST_EXPIRED', message: '连接设置已变化，请重新打开设置' } };
			}
			values.settings.instanceOrigin = message.instanceOrigin;
			values.offlineInstances = (values.offlineInstances || []).filter((origin) => origin !== message.instanceOrigin);
			if (message.connection.mode === 'offline') {
				values.offlineInstances.push(message.instanceOrigin);
			}
			return { ok: true, data: { instanceOrigin: message.instanceOrigin } };
		}
		if (message.type === 'OFFLINE_STATUS') {
			return {
				ok: true,
				data: {
					instanceOrigin: values.settings.instanceOrigin,
					available: Boolean(values.offlineStatus?.available),
					...values.offlineStatus,
				},
			};
		}
		if (message.type === 'CLEAR_OFFLINE') {
			values.offlineInstances = (values.offlineInstances || []).filter((origin) => origin !== message.instanceOrigin);
			values.offlineStatus = { available: false };
			return { ok: true, data: { instanceOrigin: message.instanceOrigin } };
		}
		if (message.type === 'CHECK_INSTANCE') {
			const offline = values.offlineInstances?.includes(values.settings.instanceOrigin);
			if (offline && !values.offlineStatus?.available) {
				values.offlineStatus = { available: true, accountCount: 1, cachedAt: Date.now() };
			}
			return {
				ok: true,
				data: {
					instanceOrigin: values.settings.instanceOrigin,
					accountCount: offline ? values.offlineStatus.accountCount : 1,
					...(offline ? { offlineStatus: { usingCache: true, clockStatus: values.offlineStatus.clockStatus } } : {}),
					accounts: [
						{ id: 'same-id', name: 'Example', account: values.settings.instanceOrigin === A ? 'alice@example.com' : 'bob@example.com' },
					],
				},
			};
		}
		if (message.type === 'REMOVE_BINDING') {
			values.bindings = values.bindings.filter(
				(binding) =>
					binding.instanceOrigin !== message.instanceOrigin ||
					binding.targetOrigin !== message.targetOrigin ||
					binding.accountId !== message.accountId,
			);
			return { ok: true, data: {} };
		}
		return { ok: true, data: {} };
	});
	globalThis.chrome = {
		i18n: { getUILanguage: vi.fn(() => 'zh-CN') },
		runtime: { getManifest: () => MANIFEST, sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
		permissions: { request: vi.fn(async () => true) },
		storage: {
			local: { get: vi.fn(async (key) => ({ [key]: structuredClone(values[key]) })) },
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	};
});
afterEach(() => {
	window.dispatchEvent(new Event('pagehide'));
	vi.useRealTimers();
	delete globalThis.chrome;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

it.each([
	['zh-CN', '2FA 验证助手 · 设置', '网站设置', '已连接 · 1 个账户', '停用', '忘记账户', '扩展版本'],
	['zh-TW', '2FA 驗證助手 · 設定', '網站設定', '已連線 · 1 個帳戶', '停用', '忘記帳戶', '擴充功能版本'],
	[
		'en',
		'2FA Authenticator Assistant · Settings',
		'Website settings',
		'Connected · 1 account',
		'Disable',
		'Forget account',
		'Extension version',
	],
])('renders static and live website settings in %s', async (language, title, siteHeading, status, disable, forget, version) => {
	values.language = language;
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/mfa' }];
	await openOptions();
	expect(document.documentElement.lang).toBe(language);
	expect(document.title).toBe(title);
	expect(document.getElementById('site-heading').textContent).toBe(siteHeading);
	expect(document.getElementById('status').textContent).toBe(status);
	expect(document.querySelector('.autofill-disable').textContent).toBe(disable);
	expect(document.querySelector('.binding-forget').textContent).toBe(forget);
	expect(document.querySelector('.autofill-disable').getAttribute('aria-label')).toContain('https://site-a.example/mfa');
	expect(document.querySelector('.binding-forget').getAttribute('aria-label')).toContain('alice@example.com');
	expect(document.getElementById('extension-version').getAttribute('aria-label')).toBe(`${version} ${MANIFEST.version}`);
	expect(document.getElementById('extension-language').value).toBe(language);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('switches all registered languages while preserving address and offline drafts, recent selection, search and privacy state', async () => {
	await openOptions();
	const selector = document.getElementById('extension-language');
	expect([...selector.options].map((option) => option.value)).toEqual(['auto', ...SUPPORTED_LANGUAGES]);
	expect([...selector.options].slice(1).map((option) => option.textContent)).toEqual(LANGUAGE_OPTIONS.map((option) => option.label));
	const saved = document.getElementById('saved-instances');
	saved.value = B;
	saved.dispatchEvent(new Event('change'));
	await flush();
	setOffline(true);
	const search = document.getElementById('binding-search');
	search.value = 'alice';
	search.dispatchEvent(new Event('input'));
	document.getElementById('privacy-toggle').click();
	const previousStorage = structuredClone(values);
	sendMessage.mockClear();
	for (const language of SUPPORTED_LANGUAGES) {
		await selectLanguage(language);
		expect(document.documentElement.lang).toBe(language);
		expect(document.title).toBe(LOCALES[language].optionsTitle);
		expect(document.getElementById('instance-heading').textContent).toBe(LOCALES[language].optionsConnectionHeading);
		expect(document.getElementById('instance-origin').value).toBe(B);
		expect(document.getElementById('offline-enabled').checked).toBe(true);
		expect(saved.value).toBe(B);
		expect(search.value).toBe('alice');
		expect(document.querySelectorAll('.site-card')).toHaveLength(1);
		expect(document.getElementById('privacy-content').hidden).toBe(false);
		expect(document.getElementById('privacy-toggle').getAttribute('aria-expanded')).toBe('true');
		expect(document.getElementById('cancel-connection').hidden).toBe(false);
		expect(document.getElementById('current-instance').textContent).toBe(A);
		expect(values).toEqual({ ...previousStorage, language });
	}
	expect(sendMessage.mock.calls.map(([message]) => message)).toEqual(
		SUPPORTED_LANGUAGES.map((preference) => ({ type: 'SAVE_LANGUAGE', preference })),
	);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('keeps an in-flight connection and disabled save controls intact while changing language', async () => {
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation(async (message) => {
		if (message.type === 'CHECK_INSTANCE') {
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	await save(B);
	expect(release).toBeTypeOf('function');
	const checksBefore = connectionChecks().length;
	expect(document.getElementById('connect-instance').disabled).toBe(true);
	expect(document.getElementById('extension-language').disabled).toBe(false);
	await selectLanguage('en');
	expect(document.getElementById('status').textContent).toBe('Connecting to 2FA…');
	expect(document.getElementById('connect-instance').textContent).toBe('Connecting…');
	expect(document.getElementById('connect-instance').disabled).toBe(true);
	expect(document.getElementById('instance-form').getAttribute('aria-busy')).toBe('true');
	expect(connectionChecks()).toHaveLength(checksBefore);
	expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
	release({ ok: true, data: { instanceOrigin: B, accountCount: 7, unavailableCount: 1, accounts: [] } });
	await flush();
	expect(document.getElementById('status').textContent).toBe('Connected · 7 accounts; 1 account is not supported yet');
	expect(document.getElementById('connect-instance').textContent).toBe('Check connection');
	expect(document.getElementById('connect-instance').disabled).toBe(false);
});

it('retranslates an existing sign-in failure and its recovery controls without retrying or requesting access', async () => {
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) =>
		message.type === 'CHECK_INSTANCE' ? { ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录 2FA' } } : original(message),
	);
	await openOptions();
	sendMessage.mockClear();
	await selectLanguage('en');
	expect(document.getElementById('status').textContent).toBe('Your 2FA session has expired. Sign in again on the instance page');
	expect(document.getElementById('open-instance').textContent).toBe('Sign in');
	expect(document.getElementById('open-instance').hidden).toBe(false);
	expect(document.getElementById('open-instance').classList.contains('primary-button')).toBe(true);
	expect(document.getElementById('login-next-step').hidden).toBe(false);
	await selectLanguage('zh-TW');
	expect(document.getElementById('status').textContent).toBe('2FA 登入已失效，請回到實例頁面重新登入');
	expect(document.getElementById('open-instance').textContent).toBe('前往登入');
	expect(document.getElementById('status').dataset.code).toBe('AUTH_REQUIRED');
	expect(connectionChecks()).toHaveLength(0);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('translates completed website mutation feedback and returns to the browser language without connection side effects', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/mfa' }];
	await openOptions();
	document.querySelector('.autofill-disable').click();
	await flush();
	sendMessage.mockClear();
	await selectLanguage('en');
	expect(document.getElementById('site-status').textContent).toBe('Autofill disabled for https://site-a.example/mfa');
	expect(document.querySelector('.site-autofill-state').textContent).toBe('Autofill disabled');
	expect(document.querySelector('.binding-account').textContent).toContain('alice@example.com');
	chrome.i18n.getUILanguage.mockReturnValue('zh-TW');
	await selectLanguage('auto');
	expect(document.documentElement.lang).toBe('zh-TW');
	expect(document.getElementById('extension-language').value).toBe('auto');
	expect(document.getElementById('site-status').textContent).toBe('已停用 https://site-a.example/mfa 的自動填入');
	expect(connectionChecks()).toHaveLength(0);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('keeps connection feedback and drafts when saving the language fails', async () => {
	await openOptions();
	editAddress('unsaved.example');
	await flush();
	const previousStatus = document.getElementById('status').textContent;
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) =>
		message.type === 'SAVE_LANGUAGE' ? { ok: false, error: { i18nKey: 'languageSaveFailed' } } : original(message),
	);
	await selectLanguage('en');
	expect(document.documentElement.lang).toBe('zh-CN');
	expect(document.getElementById('extension-language').value).toBe('auto');
	expect(document.getElementById('extension-language').disabled).toBe(false);
	expect(document.getElementById('language-status').textContent).toBe('语言偏好保存失败，请重试');
	expect(document.getElementById('status').textContent).toBe(previousStatus);
	expect(document.getElementById('instance-origin').value).toBe('unsaved.example');
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('applies a language notification from another extension surface while keeping the current draft', async () => {
	await openOptions();
	editAddress('draft.example');
	await flush();
	sendMessage.mockClear();
	for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
		listener({ type: 'LANGUAGE_CHANGED', preference: 'en' }, { id: chrome.runtime.id });
	}
	await flush();
	expect(document.documentElement.lang).toBe('en');
	expect(document.getElementById('extension-language').value).toBe('en');
	expect(document.getElementById('status').textContent).toBe('Select “Save and connect” to apply changes.');
	expect(document.getElementById('instance-origin').value).toBe('draft.example');
	expect(document.getElementById('connect-instance').textContent).toBe('Save and connect');
	expect(sendMessage).not.toHaveBeenCalled();
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('retranslates local permission errors without retrying or saving the rejected instance', async () => {
	await openOptions();
	chrome.permissions.request.mockResolvedValue(false);
	await save(B);
	expect(values.settings.instanceOrigin).toBe(A);
	sendMessage.mockClear();
	await selectLanguage('en');
	expect(document.getElementById('status').textContent).toBe('Access to the instance was not granted. Settings were not saved.');
	expect(document.getElementById('instance-origin').value).toBe(B);
	expect(values.settings.instanceOrigin).toBe(A);
	expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['SAVE_LANGUAGE']);
	expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
});

it.each(['autofill-disable', 'binding-forget'])(
	'preserves focus on the same %s action after an external language change',
	async (action) => {
		values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example', targetPath: '/mfa' }];
		await openOptions();
		const button = document.querySelector(`.${action}`);
		button.focus();
		sendMessage.mockClear();
		for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
			listener({ type: 'LANGUAGE_CHANGED', preference: 'en' }, { id: chrome.runtime.id });
		}
		await flush();
		expect(document.activeElement).toBe(document.querySelector(`.${action}`));
		expect(document.activeElement.closest('.site-card').dataset.origin).toBe('https://site-a.example');
		if (action === 'autofill-disable') {
			expect(document.activeElement.closest('.site-autofill-path').dataset.path).toBe('/mfa');
		} else {
			expect(document.activeElement.closest('.binding-item').dataset.accountId).toBe('same-id');
		}
		expect(sendMessage).not.toHaveBeenCalled();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
	},
);
it('automatically creates the offline cache after explicit mode save even with no bindings', async () => {
	values.bindings = [];
	await openOptions();
	expect(document.getElementById('connection-mode')).toBeNull();
	sendMessage.mockClear();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) => {
		if (message.type === 'CHECK_INSTANCE') {
			values.offlineStatus = { available: true, accountCount: 7, cachedAt: Date.now() };
		}
		return original(message);
	});
	editAddress();
	setOffline(true);
	await save(A);
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CHECK_INSTANCE')).toHaveLength(1);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'IMPORT_OFFLINE')).toBe(false);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 7 个账户');
	expect(document.getElementById('status').closest('details')).toBeNull();
	for (const id of ['offline-status', 'offline-fields', 'offline-management-wrapper', 'clear-offline', 'sync-offline']) {
		expect(document.getElementById(id)).toBeNull();
	}
});
it('updates cached account status from source or storage notifications without another network refresh', async () => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now() };
	await openOptions();
	const checks = () => sendMessage.mock.calls.filter(([message]) => message.type === 'CHECK_INSTANCE').length;
	const count = checks();
	values.offlineStatus.accountCount = 3;
	for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
		listener({ type: 'ACCOUNTS_CHANGED', instanceOrigin: A, revision: 'new' }, {});
	}
	await flush();
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 3 个账户');
	values.offlineStatus.accountCount = 4;
	for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
		listener({ offlineCache: {} }, 'local');
	}
	await flush();
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 4 个账户');
	expect(checks()).toBe(count);
});
it.each(['storage', 'message', 'both'])('clears stale offline availability after a cache-removal %s notification', async (notification) => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now(), clockStatus: 'cached' };
	await openOptions();
	const previousChecks = connectionChecks().length;
	values.offlineStatus = { available: false, accountCount: 0, cachedAt: null };
	if (notification !== 'message') {
		emitSiteStorageChange({ offlineCache: { oldValue: { instanceOrigin: A } } });
	}
	if (notification !== 'storage') {
		for (const [listener] of chrome.runtime.onMessage.addListener.mock.calls) {
			listener({ type: 'ACCOUNTS_CHANGED', instanceOrigin: A, revision: 'removed' }, {});
		}
	}
	await flush();
	expect(document.getElementById('status').dataset.code).toBe('OFFLINE_CACHE_UNAVAILABLE');
	expect(document.getElementById('status').textContent).not.toContain('可离线使用');
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('open-instance').hidden).toBe(false);
	expect(document.getElementById('import-offline').hidden).toBe(true);
	expect(connectionChecks()).toHaveLength(previousChecks);
	values.offlineStatus = { available: true, accountCount: 3, cachedAt: Date.now(), clockStatus: 'cached' };
	emitSiteStorageChange({ offlineCache: { newValue: { instanceOrigin: A } } });
	await flush();
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 3 个账户');
	expect(document.getElementById('check-instance').hidden).toBe(true);
	expect(connectionChecks()).toHaveLength(previousChecks);
});
it('keeps an explicit authentication failure when the revoked-cache notification arrives later', async () => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now() };
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE'
			? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请重新登录 2FA' } })
			: original(message),
	);
	window.dispatchEvent(new Event('online'));
	await flush();
	values.offlineStatus = { available: false, accountCount: 0, cachedAt: null };
	emitSiteStorageChange({ offlineCache: { oldValue: { instanceOrigin: A } } });
	await flush();
	expect(document.getElementById('status').dataset.code).toBe('AUTH_REQUIRED');
	expect(document.getElementById('open-instance').textContent).toBe('去登录');
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('import-offline').hidden).toBe(true);
});
it('checks the connection on explicit retry after the offline cache disappears', async () => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now() };
	await openOptions();
	const previousChecks = connectionChecks().length;
	values.offlineStatus = { available: false, accountCount: 0, cachedAt: null };
	emitSiteStorageChange({ offlineCache: { oldValue: { instanceOrigin: A } } });
	await flush();
	document.getElementById('check-instance').click();
	await flush();
	expect(connectionChecks()).toHaveLength(previousChecks + 1);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
	expect(document.getElementById('check-instance').hidden).toBe(true);
});
it('does not restore stale success when the cache is removed during an automatic connection check', async () => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now(), clockStatus: 'cached' };
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let finishCheck;
	const pending = new Promise((resolve) => {
		finishCheck = resolve;
	});
	sendMessage.mockImplementation((message) => (message.type === 'CHECK_INSTANCE' ? pending : original(message)));
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(document.getElementById('status').textContent).toBe('正在连接 2FA…');
	values.offlineStatus = { available: false, accountCount: 0, cachedAt: null };
	emitSiteStorageChange({ offlineCache: { oldValue: { instanceOrigin: A } } });
	await flush();
	finishCheck({
		ok: true,
		data: {
			instanceOrigin: A,
			accounts: [],
			accountCount: 2,
			offlineStatus: { usingCache: true, clockStatus: 'cached' },
		},
	});
	await flush();
	expect(document.getElementById('status').dataset.code).toBe('OFFLINE_CACHE_UNAVAILABLE');
	expect(document.getElementById('status').textContent).not.toContain('可离线使用');
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('import-offline').hidden).toBe(true);
});
it.each([
	['unavailable', 'CLOCK_UNAVAILABLE', '暂时无法校准'],
	['changed', 'CLOCK_CHANGED', '设备时间发生变化'],
])('keeps a %s clock recovery action after synchronization and clears it after retry', async (clockStatus, errorCode, hint) => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now(), clockStatus };
	await openOptions();
	expect(document.getElementById('status').dataset.code).toBe(errorCode);
	expect(document.getElementById('status').textContent).toContain(hint);
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('import-offline').hidden).toBe(true);
	const previousChecks = connectionChecks().length;
	values.offlineStatus.clockStatus = 'cached';
	document.getElementById('check-instance').click();
	await flush();
	expect(connectionChecks()).toHaveLength(previousChecks + 1);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 2 个账户');
	expect(document.getElementById('check-instance').hidden).toBe(true);
});
it.each([
	['unavailable', 'CLOCK_UNAVAILABLE'],
	['changed', 'CLOCK_CHANGED'],
])('reflects %s and recovered clock notifications without claiming the cache is ready', async (clockStatus, errorCode) => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2, cachedAt: Date.now(), clockStatus: 'cached' };
	await openOptions();
	const previousChecks = connectionChecks().length;
	values.offlineStatus.clockStatus = clockStatus;
	emitSiteStorageChange({ offlineCache: {} });
	await flush();
	expect(document.getElementById('status').dataset.code).toBe(errorCode);
	expect(document.getElementById('check-instance').hidden).toBe(false);
	values.offlineStatus.clockStatus = 'cached';
	emitSiteStorageChange({ offlineCache: {} });
	await flush();
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 2 个账户');
	expect(document.getElementById('check-instance').hidden).toBe(true);
	expect(connectionChecks()).toHaveLength(previousChecks);
});
it('refreshes saved offline accounts on reconnect and keeps authentication failures visible outside offline management', async () => {
	values.offlineInstances = [A];
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE' ? Promise.resolve({ ok: false, error: { message: '请打开 2FA 重新登录' } }) : original(message),
	);
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(document.getElementById('status').dataset.tone).toBe('error');
	expect(document.getElementById('status').textContent).toContain('重新登录');
	expect(document.getElementById('status').closest('details')).toBeNull();
	window.dispatchEvent(new Event('pagehide'));
	const count = sendMessage.mock.calls.length;
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(sendMessage).toHaveBeenCalledTimes(count);
	expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
	expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
});
it('does not enable or build offline caches merely by editing the unsaved connection mode or reconnecting', async () => {
	values.bindings = [];
	await openOptions();
	sendMessage.mockClear();
	editAddress();
	setOffline(true);
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(sendMessage.mock.calls.some(([message]) => ['CHECK_INSTANCE', 'SAVE_INSTANCE'].includes(message.type))).toBe(false);
	expect(values.offlineInstances).toBeUndefined();
});

it('shows only the saved instance automatic-fill sites and disables one without requesting browser permissions', async () => {
	values.autofillSites = [
		{ instanceOrigin: A, targetOrigin: 'https://login-a.example', targetPath: '/' },
		{ instanceOrigin: B, targetOrigin: 'https://login-b.example', targetPath: '/' },
	];
	await openOptions();
	expect(document.getElementById('site-list').textContent).toContain('login-a.example');
	expect(document.getElementById('site-list').textContent).not.toContain('login-b.example');
	document.querySelector('.autofill-disable').click();
	await flush();
	expect(values.autofillSites).toEqual([{ instanceOrigin: B, targetOrigin: 'https://login-b.example', targetPath: '/' }]);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
	expect(document.querySelector('.site-card[data-origin="https://login-a.example"]')).toBeNull();
	expect(document.getElementById('site-status').textContent).toContain('已停用');
});
it('retains the automatic-fill site and allows retry when disabling fails', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://login-a.example', targetPath: '/' }];
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'SET_AUTOFILL_SITE' ? Promise.resolve({ ok: false, error: { message: '保存失败' } }) : original(message),
	);
	document.querySelector('.autofill-disable').click();
	await flush();
	expect(document.querySelectorAll('.autofill-disable')).toHaveLength(1);
	expect(document.querySelector('.autofill-disable').disabled).toBe(false);
	expect(document.getElementById('site-status').textContent).toBe('保存失败');
});
it('refreshes automatic-fill sites only after saving a switched instance', async () => {
	values.autofillSites = [
		{ instanceOrigin: A, targetOrigin: 'https://login-a.example', targetPath: '/' },
		{ instanceOrigin: B, targetOrigin: 'https://login-b.example', targetPath: '/' },
	];
	await openOptions();
	const saved = document.getElementById('saved-instances');
	saved.value = B;
	saved.dispatchEvent(new Event('change'));
	await flush();
	expect(document.getElementById('site-list').textContent).toContain('login-a.example');
	await save(B);
	expect(document.getElementById('site-list').textContent).toContain('login-b.example');
	expect(document.getElementById('site-list').textContent).not.toContain('login-a.example');
});
it('ignores a late automatic-fill list from the previous instance', async () => {
	values.autofillSites = [{ instanceOrigin: B, targetOrigin: 'https://login-b.example', targetPath: '/' }];
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'GET_AUTOFILL_SITES' && values.settings.instanceOrigin === A
			? new Promise((resolve) => {
					release = resolve;
				})
			: original(message),
	);
	await openOptions();
	await save(B);
	release({ ok: true, data: { instanceOrigin: A, sites: [{ instanceOrigin: A, targetOrigin: 'https://late-a.example' }] } });
	await flush();
	expect(document.getElementById('site-list').textContent).toContain('login-b.example');
	expect(document.getElementById('site-list').textContent).not.toContain('late-a.example');
});

it('disposes website listeners and connection work before late results can update a closed settings page', async () => {
	await openOptions();
	let finishSites;
	let finishAccounts;
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) => {
		if (message.type === 'GET_AUTOFILL_SITES') {
			return new Promise((resolve) => {
				finishSites = resolve;
			});
		}
		if (message.type === 'CHECK_INSTANCE') {
			return new Promise((resolve) => {
				finishAccounts = resolve;
			});
		}
		return original(message);
	});
	emitSiteStorageChange({ autofillSites: {} });
	window.dispatchEvent(new Event('focus'));
	await flush();
	expect(finishSites).toBeTypeOf('function');
	expect(finishAccounts).toBeTypeOf('function');
	const siteMarkup = document.getElementById('site-settings').innerHTML;
	const status = document.getElementById('status').textContent;
	window.dispatchEvent(new Event('pagehide'));
	window.dispatchEvent(new Event('pagehide'));
	finishSites({
		ok: true,
		data: { instanceOrigin: A, sites: [{ instanceOrigin: A, targetOrigin: 'https://late.example', targetPath: '/otp' }] },
	});
	finishAccounts({
		ok: true,
		data: { instanceOrigin: A, accountCount: 1, accounts: [{ id: 'same-id', name: 'Late account', account: 'late' }] },
	});
	await flush();
	expect(document.getElementById('site-settings').innerHTML).toBe(siteMarkup);
	expect(document.getElementById('status').textContent).toBe(status);
	const requests = sendMessage.mock.calls.length;
	document.getElementById('binding-search').dispatchEvent(new Event('input'));
	document.getElementById('retry-site-settings').click();
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(sendMessage).toHaveBeenCalledTimes(requests);
	for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
		expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
	}
});
it('shows current-instance names, searches usernames and deletes only the selected instance binding', async () => {
	await openOptions();
	expect(document.querySelectorAll('.binding-item')).toHaveLength(1);
	expect(document.getElementById('site-list').textContent).toContain('alice@example.com');
	const search = document.getElementById('binding-search');
	search.value = 'bob';
	search.dispatchEvent(new Event('input'));
	await flush();
	expect(document.querySelectorAll('.binding-item')).toHaveLength(0);
	search.value = 'alice';
	search.dispatchEvent(new Event('input'));
	await flush();
	document.querySelector('.binding-forget').click();
	await flush();
	expect(values.bindings).toEqual([{ instanceOrigin: B, targetOrigin: 'https://site-b.example', accountId: 'same-id' }]);
	expect(JSON.stringify(values)).not.toContain('alice@example.com');
});
it('switches between saved instances while preserving bindings and scoped account names', async () => {
	await openOptions();
	sendMessage.mockClear();
	const saved = document.getElementById('saved-instances');
	expect(saved.value).toBe('');
	saved.value = B;
	saved.dispatchEvent(new Event('change'));
	expect(document.getElementById('instance-origin').value).toBe(B);
	await flush();
	expect(document.getElementById('connect-instance').textContent).toBe('保存并连接');
	expect(document.getElementById('current-instance').href).toBe(A + '/');
	expect(values.settings.instanceOrigin).toBe(A);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CHECK_INSTANCE'].includes(message.type))).toBe(false);
	await save(B);
	expect(document.getElementById('site-list').textContent).toContain('bob@example.com');
	expect(document.getElementById('site-list').textContent).not.toContain('alice@example.com');
	expect(values.bindings).toHaveLength(2);
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(document.getElementById('connection-summary').hidden).toBe(true);
});
it('keeps ID-based binding management usable when the instance is offline', async () => {
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE' ? Promise.resolve({ ok: false, error: { message: 'Offline' } }) : original(message),
	);
	await openOptions();
	expect(document.getElementById('site-list').textContent).toContain('账户暂不可用');
	expect(document.getElementById('site-list').textContent).not.toContain('same-id');
	expect(document.querySelector('.binding-forget').disabled).toBe(false);
});

it('groups authorized sites and remembered accounts together and searches every account without exposing IDs', async () => {
	values.autofillSites = [
		{ instanceOrigin: A, targetOrigin: 'https://site-a.example' },
		{ instanceOrigin: A, targetOrigin: 'https://authorized-only.example' },
	];
	values.bindings.push(
		{ instanceOrigin: A, targetOrigin: 'https://site-a.example', accountId: 'unavailable-id' },
		{ instanceOrigin: A, targetOrigin: 'https://remembered-only.example', accountId: 'same-id' },
	);
	await openOptions();
	expect(document.querySelectorAll('.site-card')).toHaveLength(3);
	expect(document.getElementById('site-count').textContent).toBe('3 个网站');
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(2);
	expect(siteCard('https://authorized-only.example').querySelectorAll('.binding-item')).toHaveLength(0);
	expect(siteCard('https://remembered-only.example').querySelector('.site-autofill-state').textContent).toBe('自动填充未开启');
	expect(document.getElementById('site-list').textContent).not.toContain('unavailable-id');
	const search = document.getElementById('binding-search');
	search.value = 'unavailable-id';
	search.dispatchEvent(new Event('input'));
	expect(document.querySelectorAll('.site-card')).toHaveLength(1);
	expect(document.getElementById('site-count').textContent).toBe('1 / 3 个网站');
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(2);
	search.value = 'not-found';
	search.dispatchEvent(new Event('input'));
	expect(document.getElementById('site-empty').textContent).toBe('没有匹配的网站或账户。');
	document.getElementById('clear-site-search').click();
	expect(search.value).toBe('');
	expect(document.querySelectorAll('.site-card')).toHaveLength(3);
	expect(document.getElementById('clear-site-search').hidden).toBe(true);
	expect(values.bindings).toHaveLength(4);
});

it('forgets only one remembered account and leaves its site authorization and other instances intact', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }];
	values.bindings.push({ instanceOrigin: A, targetOrigin: 'https://site-a.example', accountId: 'second-id' });
	await openOptions();
	siteCard('https://site-a.example').querySelector('.binding-forget').click();
	await flush();
	expect(values.bindings).toEqual([
		{ instanceOrigin: B, targetOrigin: 'https://site-b.example', accountId: 'same-id' },
		{ instanceOrigin: A, targetOrigin: 'https://site-a.example', accountId: 'second-id' },
	]);
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(1);
	siteCard('https://site-a.example').querySelector('.binding-forget').click();
	await flush();
	expect(siteCard('https://site-a.example')).toBeDefined();
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(0);
	expect(siteCard('https://site-a.example').querySelector('.autofill-disable')).not.toBeNull();
	expect(values.autofillSites).toEqual([{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }]);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SET_AUTOFILL_SITE')).toBe(false);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('turns off automatic fill independently from remembered account choices', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }];
	await openOptions();
	siteCard('https://site-a.example').querySelector('.autofill-disable').click();
	await flush();
	expect(siteCard('https://site-a.example').querySelector('.site-autofill-state').textContent).toBe('自动填充未开启');
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(1);
	expect(values.bindings).toHaveLength(2);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'REMOVE_BINDING')).toBe(false);
	siteCard('https://site-a.example').querySelector('.binding-forget').click();
	await flush();
	expect(siteCard('https://site-a.example')).toBeUndefined();
	expect(document.getElementById('site-empty').textContent).toBe('到需要填写验证码的网站打开扩展，即可开启自动填充。');
	expect(document.getElementById('site-search-wrapper').hidden).toBe(true);
});

it('keeps remembered accounts available when reading authorization fails and recovers via retry', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }];
	const original = sendMessage.getMockImplementation();
	let failed = true;
	sendMessage.mockImplementation((message) =>
		message.type === 'GET_AUTOFILL_SITES' && failed
			? Promise.resolve({ ok: false, error: { message: '网站授权暂时无法读取' } })
			: original(message),
	);
	await openOptions();
	expect(siteCard('https://site-a.example').querySelector('.site-autofill-state').textContent).toBe('自动填充状态暂不可用');
	expect(siteCard('https://site-a.example').querySelector('.binding-forget').disabled).toBe(false);
	expect(document.getElementById('site-status').textContent).toBe('网站授权暂时无法读取');
	failed = false;
	document.getElementById('retry-site-settings').click();
	await flush();
	expect(siteCard('https://site-a.example').querySelector('.site-autofill-state').textContent).toBe('自动填充已开启');
	expect(document.getElementById('site-status').textContent).toBe('');
	expect(document.getElementById('retry-site-settings').hidden).toBe(true);
});

it('preserves existing website cards and actions when later metadata reads fail', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }];
	await openOptions();
	const originalMessage = sendMessage.getMockImplementation();
	const originalStorage = chrome.storage.local.get.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'GET_AUTOFILL_SITES' ? Promise.resolve({ ok: false, error: { message: '授权读取失败' } }) : originalMessage(message),
	);
	chrome.storage.local.get.mockImplementation((key) =>
		key === 'bindings' ? Promise.reject(new Error('账户选择读取失败')) : originalStorage(key),
	);
	emitSiteStorageChange({ bindings: {}, autofillSites: {} });
	await flush();
	expect(siteCard('https://site-a.example').querySelector('.binding-forget').disabled).toBe(false);
	expect(siteCard('https://site-a.example').querySelector('.autofill-disable').disabled).toBe(false);
	expect(document.getElementById('site-status').textContent).toContain('授权读取失败');
	expect(document.getElementById('site-status').textContent).toContain('账户选择读取失败');
	siteCard('https://site-a.example').querySelector('.binding-forget').click();
	await flush();
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(0);
	expect(siteCard('https://site-a.example').querySelector('.autofill-disable')).not.toBeNull();
});

it('keeps a remembered choice and allows retry after forgetting it fails', async () => {
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'REMOVE_BINDING' ? Promise.resolve({ ok: false, error: { message: '暂时无法忘记账户' } }) : original(message),
	);
	document.querySelector('.binding-forget').click();
	await flush();
	expect(document.querySelectorAll('.binding-item')).toHaveLength(1);
	expect(document.querySelector('.binding-forget').disabled).toBe(false);
	expect(document.getElementById('site-status').textContent).toBe('暂时无法忘记账户');
	expect(values.bindings).toHaveLength(2);
});

it('updates website metadata after popup changes without requesting accounts or permissions', async () => {
	await openOptions();
	const checks = connectionChecks().length;
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://new-site.example' }];
	values.bindings.push({ instanceOrigin: A, targetOrigin: 'https://new-site.example', accountId: 'same-id' });
	emitSiteStorageChange({ bindings: {}, autofillSites: {} });
	await flush();
	expect(siteCard('https://new-site.example').querySelectorAll('.binding-item')).toHaveLength(1);
	expect(siteCard('https://new-site.example').querySelector('.autofill-disable')).not.toBeNull();
	expect(connectionChecks()).toHaveLength(checks);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('queues local website changes during a mutation and never resurrects the forgotten account', async () => {
	values.autofillSites = [{ instanceOrigin: A, targetOrigin: 'https://site-a.example' }];
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'REMOVE_BINDING'
			? new Promise((resolve) => {
					release = async () => resolve(await original(message));
				})
			: original(message),
	);
	document.querySelector('.binding-forget').click();
	await flush();
	values.autofillSites.push({ instanceOrigin: A, targetOrigin: 'https://new-site.example' });
	emitSiteStorageChange({ bindings: {}, autofillSites: {} });
	emitSiteStorageChange({ bindings: {}, autofillSites: {} });
	await release();
	await flush();
	expect(siteCard('https://site-a.example').querySelectorAll('.binding-item')).toHaveLength(0);
	expect(siteCard('https://new-site.example')).toBeDefined();
	expect(document.querySelector('.autofill-disable').disabled).toBe(false);
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_AUTOFILL_SITES')).toHaveLength(2);
});

it('ignores late binding data after the saved instance changes', async () => {
	await openOptions();
	const original = chrome.storage.local.get.getMockImplementation();
	let release;
	let delayed = true;
	chrome.storage.local.get.mockImplementation((key) => {
		if (key === 'bindings' && delayed) {
			delayed = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(key);
	});
	emitSiteStorageChange({ bindings: {} });
	await flush();
	await save(B);
	release({ bindings: [{ instanceOrigin: A, targetOrigin: 'https://late-old.example', accountId: 'same-id' }] });
	await flush();
	expect(siteCard('https://site-b.example')).toBeDefined();
	expect(siteCard('https://late-old.example')).toBeUndefined();
	expect(document.getElementById('site-list').textContent).not.toContain('alice@example.com');
});
it('does not apply late metadata from a previously selected instance', async () => {
	let resolveOld;
	const original = sendMessage.getMockImplementation();
	let delayed = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'CHECK_INSTANCE' && delayed) {
			delayed = false;
			return new Promise((resolve) => {
				resolveOld = resolve;
			});
		}
		return original(message);
	});
	await openOptions();
	await save(B);
	resolveOld({ ok: true, data: { instanceOrigin: A, accounts: [{ id: 'same-id', name: 'Late old name', account: 'alice' }] } });
	await flush();
	expect(document.getElementById('site-list').textContent).toContain('bob@example.com');
	expect(document.getElementById('site-list').textContent).not.toContain('Late old name');
});
it('retains the active instance and its bindings if host permission is denied', async () => {
	await openOptions();
	chrome.permissions.request.mockResolvedValue(false);
	await save(B);
	expect(values.settings.instanceOrigin).toBe(A);
	expect(values.bindings).toHaveLength(2);
	expect(document.getElementById('status').textContent).toContain('未授予');
	expect(document.getElementById('instance-origin').value).toBe(B);
	expect(document.getElementById('connect-instance').textContent).toBe('保存并连接');
	expect(document.getElementById('cancel-connection').hidden).toBe(false);
	expect(document.getElementById('connection-summary').hidden).toBe(false);
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_INSTANCE')).toBe(false);
});

it.each([
	[A, 'alice'],
	[B, 'bob'],
])('reloads names despite an active account search when saving %s', async (origin, query) => {
	await openOptions();
	const search = document.getElementById('binding-search');
	search.value = query;
	search.dispatchEvent(new Event('input'));
	await flush();
	await save(origin);
	expect(document.getElementById('site-list').textContent).toContain(query + '@example.com');
});

it('still fetches names when searching supersedes the render started by an instance save', async () => {
	await openOptions();
	const original = chrome.storage.local.get.getMockImplementation();
	let release;
	let blocked = false;
	chrome.storage.local.get.mockImplementation((key) => {
		if (key === 'bindings' && !blocked) {
			blocked = true;
			return new Promise((resolve) => {
				release = () => resolve({ bindings: structuredClone(values.bindings) });
			});
		}
		return original(key);
	});
	await save(B);
	const search = document.getElementById('binding-search');
	search.value = 'bob';
	search.dispatchEvent(new Event('input'));
	await flush();
	release();
	await flush();
	expect(document.getElementById('site-list').textContent).toContain('bob@example.com');
});

it('captures the offline choice and origin together before asynchronous permission approval', async () => {
	await openOptions();
	let release;
	chrome.permissions.request.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editAddress();
	setOffline(true);
	sendMessage.mockClear();
	document.getElementById('connect-instance').click();
	expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [`${A}/*`] });
	expect(sendMessage).not.toHaveBeenCalled();
	expect(document.getElementById('connect-instance').textContent).toBe('正在连接…');
	expect(document.getElementById('instance-form').getAttribute('aria-busy')).toBe('true');
	expect(document.getElementById('offline-enabled').disabled).toBe(true);
	document.getElementById('instance-origin').value = B;
	document.getElementById('offline-enabled').checked = false;
	release(true);
	await flush();
	expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_INSTANCE', instanceOrigin: A, connection: { mode: 'offline' } });
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(document.getElementById('instance-form').getAttribute('aria-busy')).toBe('false');
});

it('blocks saving until a switched instance finishes loading its offline preference', async () => {
	values.offlineInstances = [B];
	await openOptions();
	const original = chrome.storage.local.get.getMockImplementation();
	let release;
	chrome.storage.local.get.mockImplementation((key) =>
		key === 'offlineInstances'
			? new Promise((resolve) => {
					release = () => resolve({ offlineInstances: structuredClone(values.offlineInstances) });
				})
			: original(key),
	);
	const select = document.getElementById('saved-instances');
	select.value = B;
	select.dispatchEvent(new Event('change'));
	await flush();
	expect(document.querySelector('button[type=submit]').disabled).toBe(true);
	await save(B);
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_INSTANCE')).toHaveLength(0);
	release();
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.querySelector('button[type=submit]').disabled).toBe(false);
	chrome.storage.local.get.mockImplementation(original);
	await save(B);
	expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_INSTANCE', instanceOrigin: B, connection: { mode: 'offline' } });
});

it.each(['session', 'offline'])('checks an unchanged saved %s connection without saving or clearing its cache', async (mode) => {
	values.bindings = [];
	if (mode === 'offline') {
		values.offlineInstances = [A];
	}
	await openOptions();
	expect(connectionChecks()).toHaveLength(1);
	expect(document.getElementById('offline-enabled').checked).toBe(mode === 'offline');
	expect(document.getElementById('status').textContent).toContain(`${mode === 'offline' ? '可离线使用' : '已连接'} · 1 个账户`);
	expect(document.getElementById('check-instance').hidden).toBe(true);
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	await save(A);
	expect(connectionChecks()).toHaveLength(2);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [`${A}/*`] });
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
});

it('keeps first setup explicit and hides the single-instance switcher and advanced settings', async () => {
	values.settings.instanceOrigin = null;
	values.instances = [];
	await openOptions();
	expect(document.getElementById('setup-guide').open).toBe(true);
	expect(document.getElementById('advanced-settings')).toBeNull();
	expect(document.getElementById('saved-instances-wrapper').hidden).toBe(true);
	expect(document.getElementById('offline-enabled').checked).toBe(false);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('connection-summary').hidden).toBe(true);
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(document.getElementById('site-settings').hidden).toBe(true);
	expect(document.getElementById('connect-instance').textContent).toBe('连接 2FA');
	expect(document.getElementById('cancel-connection').hidden).toBe(true);
	expect(connectionChecks()).toHaveLength(0);
	await save(A);
	expect(document.getElementById('setup-guide').hidden).toBe(true);
	expect(document.getElementById('saved-instances-wrapper').hidden).toBe(true);
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(document.getElementById('site-settings').hidden).toBe(false);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(document.getElementById('cancel-connection').hidden).toBe(true);
	expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_INSTANCE', instanceOrigin: A, connection: { mode: 'session' } });
	expect(connectionChecks()).toHaveLength(1);
});

it.each(['a.example', ' a.example/accounts?view=all#security ', `${A}/accounts?view=all#security`])(
	'connects a new instance from pasted address %j and displays its normalized origin',
	async (address) => {
		values.settings.instanceOrigin = null;
		values.instances = [];
		await openOptions();
		editAddress(address);
		await flush();
		expect(document.getElementById('connect-instance').textContent).toBe('连接 2FA');
		expect(document.getElementById('connection-summary').hidden).toBe(true);
		expect(document.getElementById('cancel-connection').hidden).toBe(true);
		expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CHECK_INSTANCE'].includes(message.type))).toBe(false);
		document.getElementById('connect-instance').click();
		expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [`${A}/*`] });
		await flush();
		expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_INSTANCE', instanceOrigin: A, connection: { mode: 'session' } });
		expect(values.settings.instanceOrigin).toBe(A);
		expect(document.getElementById('instance-origin').value).toBe(A);
		expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
		expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	},
);

it('waits for the upgrade to finish and offers the previous address without automatically reconnecting', async () => {
	const original = sendMessage.getMockImplementation();
	let finishUpgrade;
	sendMessage.mockImplementation((message) =>
		message.type === 'GET_SETTINGS'
			? new Promise((resolve) => {
					finishUpgrade = () => {
						values.settings.instanceOrigin = null;
						values.instances = [A];
						resolve({ ok: true, data: values.settings });
					};
				})
			: original(message),
	);
	await openOptions();
	expect(connectionChecks()).toHaveLength(0);
	expect(document.querySelector('button[type=submit]').disabled).toBe(true);
	finishUpgrade();
	await flush();
	expect(document.getElementById('instance-origin').value).toBe(A);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('offline-enabled').checked).toBe(false);
	expect(document.getElementById('status').textContent).toContain('重新连接');
	expect(connectionChecks()).toHaveLength(0);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_INSTANCE')).toBe(false);
	await save(A);
	expect(values.settings.instanceOrigin).toBe(A);
	expect(connectionChecks()).toHaveLength(1);
});

it('preserves the saved offline choice without exposing connection modes or expanding maintenance', async () => {
	values.offlineInstances = [A];
	await openOptions();
	expect(document.getElementById('connection-mode')).toBeNull();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('connection-summary').hidden).toBe(true);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('advanced-settings')).toBeNull();
	expect(document.getElementById('manage-devices')).toBeNull();
	expect(document.getElementById('saved-instances-wrapper').hidden).toBe(false);
	await save(A);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	expect(connectionChecks()).toHaveLength(2);
});

it('does not call cached offline availability an online connection check', async () => {
	values.offlineInstances = [A];
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) => {
		const response = await original(message);
		if (message.type === 'CHECK_INSTANCE') {
			response.data.offlineStatus = { usingCache: true };
		}
		return response;
	});
	await openOptions();
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
	expect(document.getElementById('status').dataset.tone).toBe('success');
});

it('reports login failure after checking and recovers automatically when the user returns', async () => {
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let loggedIn = false;
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE' && !loggedIn
			? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录 2FA' } })
			: original(message),
	);
	await save(A);
	expect(document.getElementById('status').textContent).toBe('2FA 登录已失效，请回到实例页面重新登录');
	expect(document.getElementById('status').dataset.code).toBe('AUTH_REQUIRED');
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('open-instance').textContent).toBe('去登录');
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('open-instance').classList.contains('primary-button')).toBe(true);
	expect(document.getElementById('login-next-step').hidden).toBe(false);
	expect(document.getElementById('login-next-step').textContent).toContain('登录完成后回到此页');
	document.getElementById('open-instance').click();
	await flush();
	loggedIn = true;
	const before = connectionChecks().length;
	window.dispatchEvent(new Event('focus'));
	document.dispatchEvent(new Event('visibilitychange'));
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(connectionChecks()).toHaveLength(before + 1);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	expect(document.getElementById('status').dataset.code).toBeUndefined();
	expect(document.getElementById('check-instance').hidden).toBe(true);
	expect(document.getElementById('open-instance').textContent).toBe('打开 2FA');
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('login-next-step').hidden).toBe(true);
	expect(document.getElementById('open-instance').classList.contains('secondary-button')).toBe(true);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_INSTANCE')).toBe(false);
});

it('hides the saved instance login action while editing another address and restores it after cancelling', async () => {
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE'
			? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录 2FA' } })
			: original(message),
	);
	await openOptions();
	expect(document.getElementById('login-next-step').hidden).toBe(false);
	sendMessage.mockClear();
	editAddress(B);
	await flush();
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(document.getElementById('login-next-step').hidden).toBe(true);
	expect(document.getElementById('connect-instance').textContent).toBe('保存并连接');
	expect(connectionChecks()).toHaveLength(0);
	document.getElementById('cancel-connection').click();
	await flush();
	expect(document.getElementById('instance-origin').value).toBe(A);
	expect(document.getElementById('open-instance').hidden).toBe(false);
	expect(document.getElementById('open-instance').textContent).toBe('去登录');
	expect(document.getElementById('login-next-step').hidden).toBe(false);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_INSTANCE')).toBe(false);
});

it('checks once more after returning from login when the previous check is still pending', async () => {
	const original = sendMessage.getMockImplementation();
	let release;
	let firstCheck = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'CHECK_INSTANCE' && firstCheck) {
			firstCheck = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	await openOptions();
	document.getElementById('open-instance').click();
	await flush();
	window.dispatchEvent(new Event('focus'));
	document.dispatchEvent(new Event('visibilitychange'));
	await flush();
	expect(connectionChecks()).toHaveLength(1);
	release({ ok: false, error: { code: 'AUTH_REQUIRED', message: '旧检查的登录状态已失效' } });
	await flush();
	expect(connectionChecks()).toHaveLength(2);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	window.dispatchEvent(new Event('focus'));
	await flush();
	expect(connectionChecks()).toHaveLength(2);
});

it('keeps a trailing connection check when external login returns within the focus throttle window', async () => {
	vi.useFakeTimers();
	const original = sendMessage.getMockImplementation();
	let loggedIn = false;
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE' && !loggedIn
			? Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录 2FA' } })
			: original(message),
	);
	await openOptions();
	window.dispatchEvent(new Event('focus'));
	await flush();
	expect(document.getElementById('status').dataset.code).toBe('AUTH_REQUIRED');
	const beforeReturn = connectionChecks().length;
	await vi.advanceTimersByTimeAsync(100);
	loggedIn = true;
	window.dispatchEvent(new Event('focus'));
	document.dispatchEvent(new Event('visibilitychange'));
	await flush();
	expect(connectionChecks()).toHaveLength(beforeReturn);
	await vi.advanceTimersByTimeAsync(1400);
	await flush();
	expect(connectionChecks()).toHaveLength(beforeReturn + 1);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	await vi.advanceTimersByTimeAsync(10000);
	expect(connectionChecks()).toHaveLength(beforeReturn + 1);
});

it('checks again after an external login return even when the earlier request has not finished', async () => {
	vi.useFakeTimers();
	const original = sendMessage.getMockImplementation();
	let release;
	let firstCheck = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'CHECK_INSTANCE' && firstCheck) {
			firstCheck = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	await openOptions();
	window.dispatchEvent(new Event('focus'));
	await flush();
	expect(connectionChecks()).toHaveLength(1);
	release({ ok: false, error: { code: 'AUTH_REQUIRED', message: '旧请求的登录状态已失效' } });
	await flush();
	expect(connectionChecks()).toHaveLength(2);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	await vi.advanceTimersByTimeAsync(10000);
	expect(connectionChecks()).toHaveLength(2);
});

it('cancels a deferred resume check when the user edits the configuration or closes settings', async () => {
	vi.useFakeTimers();
	await openOptions();
	window.dispatchEvent(new Event('focus'));
	await flush();
	window.dispatchEvent(new Event('focus'));
	editAddress();
	setOffline(true);
	const checksBeforeEdit = connectionChecks().length;
	await vi.advanceTimersByTimeAsync(2000);
	expect(connectionChecks()).toHaveLength(checksBeforeEdit);
	setOffline(false);
	window.dispatchEvent(new Event('focus'));
	await flush();
	window.dispatchEvent(new Event('focus'));
	const checksBeforeClose = connectionChecks().length;
	window.dispatchEvent(new Event('pagehide'));
	await vi.advanceTimersByTimeAsync(2000);
	expect(connectionChecks()).toHaveLength(checksBeforeClose);
});

it('defers a scheduled resume check until the settings page becomes visible again', async () => {
	vi.useFakeTimers();
	const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	await openOptions();
	window.dispatchEvent(new Event('focus'));
	await flush();
	window.dispatchEvent(new Event('focus'));
	const beforeHide = connectionChecks().length;
	visibility.mockReturnValue('hidden');
	document.dispatchEvent(new Event('visibilitychange'));
	await vi.advanceTimersByTimeAsync(2000);
	expect(connectionChecks()).toHaveLength(beforeHide);
	visibility.mockReturnValue('visible');
	document.dispatchEvent(new Event('visibilitychange'));
	await flush();
	expect(connectionChecks()).toHaveLength(beforeHide + 1);
});

it('refreshes saved offline accounts on reconnect even while the settings page is hidden', async () => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 1 };
	await openOptions();
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) => {
		if (message.type === 'CHECK_INSTANCE') {
			values.offlineStatus.accountCount = 2;
		}
		return original(message);
	});
	const beforeReconnect = connectionChecks().length;
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(connectionChecks()).toHaveLength(beforeReconnect + 1);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 2 个账户');
	editAddress();
	setOffline(false);
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(connectionChecks()).toHaveLength(beforeReconnect + 1);
	expect(values.offlineInstances).toEqual([A]);
});

it('preserves hidden reconnect through the resume throttle and any earlier in-flight check', async () => {
	vi.useFakeTimers();
	await openOptions();
	window.dispatchEvent(new Event('focus'));
	await flush();
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
	const original = sendMessage.getMockImplementation();
	let release;
	let delayed = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'CHECK_INSTANCE' && delayed) {
			delayed = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	const beforeReconnect = connectionChecks().length;
	window.dispatchEvent(new Event('online'));
	await vi.advanceTimersByTimeAsync(1500);
	expect(connectionChecks()).toHaveLength(beforeReconnect + 1);
	await vi.advanceTimersByTimeAsync(1500);
	window.dispatchEvent(new Event('online'));
	await flush();
	release({ ok: false, error: { code: 'SOURCE_OFFLINE', message: '旧检查失败' } });
	await flush();
	expect(connectionChecks()).toHaveLength(beforeReconnect + 2);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	await vi.advanceTimersByTimeAsync(10000);
	expect(connectionChecks()).toHaveLength(beforeReconnect + 2);
});

it('does not report a saved address as connected until the actual check succeeds', async () => {
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE'
			? new Promise((resolve) => {
					release = resolve;
				})
			: original(message),
	);
	await save(B);
	expect(document.getElementById('status').textContent).toBe('正在连接 2FA…');
	expect(document.getElementById('status').dataset.tone).toBe('info');
	release({ ok: false, error: { code: 'SOURCE_OFFLINE', message: '暂时无法连接 2FA' } });
	await flush();
	expect(values.settings.instanceOrigin).toBe(B);
	expect(document.getElementById('status').textContent).toBe('无法连接 2FA 服务，请检查网络或使用已有离线缓存');
	expect(document.getElementById('check-instance').hidden).toBe(false);
});

it('keeps edits intact when a pending connection check finishes and only checks the saved configuration', async () => {
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE'
			? new Promise((resolve) => {
					release = resolve;
				})
			: original(message),
	);
	await openOptions();
	const input = document.getElementById('instance-origin');
	input.value = B;
	input.dispatchEvent(new Event('input'));
	await flush();
	setOffline(true);
	window.dispatchEvent(new Event('focus'));
	window.dispatchEvent(new Event('online'));
	release({ ok: true, data: { instanceOrigin: A, accounts: [], accountCount: 0 } });
	await flush();
	expect(input.value).toBe(B);
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('status').textContent).toBe('点击“保存并连接”应用修改');
	expect(connectionChecks()).toHaveLength(1);
	expect(values.settings.instanceOrigin).toBe(A);
	expect(values.offlineInstances).toBeUndefined();
});

it('never overwrites a new offline choice with a delayed address configuration lookup', async () => {
	await openOptions();
	const original = chrome.storage.local.get.getMockImplementation();
	let release;
	chrome.storage.local.get.mockImplementation((key) =>
		key === 'offlineInstances'
			? new Promise((resolve) => {
					release = () => resolve({});
				})
			: original(key),
	);
	const input = document.getElementById('instance-origin');
	input.value = B;
	input.dispatchEvent(new Event('input'));
	await flush();
	setOffline(true);
	release();
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('offline-help').textContent).toContain('密钥保存在此浏览器');
	expect(document.querySelector('button[type=submit]').disabled).toBe(false);
});

it.each([true, false])(
	'preserves an explicit offline choice of %s through same-origin URL edits and saves that choice',
	async (enabled) => {
		values.offlineInstances = enabled ? [] : [A];
		await openOptions();
		editAddress();
		setOffline(enabled);
		const input = document.getElementById('instance-origin');
		const reads = chrome.storage.local.get.mock.calls.filter(([key]) => key === 'offlineInstances').length;
		for (const address of [`${A}/`, `${A}/account?view=1`, `${A}?tab=security#help`, 'https://', `${A}/restored`]) {
			input.value = address;
			input.dispatchEvent(new Event('input'));
			await flush();
			expect(document.getElementById('offline-enabled').checked).toBe(enabled);
		}
		expect(chrome.storage.local.get.mock.calls.filter(([key]) => key === 'offlineInstances').length).toBeGreaterThan(reads);
		expect(values.offlineInstances.includes(A)).toBe(!enabled);
		await save(A);
		expect(sendMessage).toHaveBeenCalledWith({
			type: 'SAVE_INSTANCE',
			instanceOrigin: A,
			connection: { mode: enabled ? 'offline' : 'session' },
		});
		expect(values.offlineInstances.includes(A)).toBe(enabled);
		expect(document.getElementById('offline-enabled').checked).toBe(enabled);
		expect(document.getElementById('connection-editor').hidden).toBe(false);
	},
);

it.each([true, false])('preserves an initial offline choice of %s made before entering a valid address', async (enabled) => {
	values.settings.instanceOrigin = null;
	values.instances = [];
	values.offlineInstances = enabled ? [] : [A];
	await openOptions();
	setOffline(enabled);
	const input = document.getElementById('instance-origin');
	for (const address of ['https://', 'https://a', 'https://a.e', 'https://a.exam', A, `${A}/accounts`]) {
		input.value = address;
		input.dispatchEvent(new Event('input'));
		await flush();
		expect(document.getElementById('offline-enabled').checked).toBe(enabled);
	}
	expect(values.settings.instanceOrigin).toBeNull();
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	await save(A);
	expect(sendMessage).toHaveBeenCalledWith({
		type: 'SAVE_INSTANCE',
		instanceOrigin: A,
		connection: { mode: enabled ? 'offline' : 'session' },
	});
});

it('loads another instance preference until that instance has its own explicit draft', async () => {
	await openOptions();
	editAddress();
	setOffline(true);
	const input = document.getElementById('instance-origin');
	for (const address of ['https://b', 'https://b.e', B]) {
		input.value = address;
		input.dispatchEvent(new Event('input'));
		await flush();
		expect(document.getElementById('offline-enabled').checked).toBe(false);
	}
	const saved = document.getElementById('saved-instances');
	setOffline(true);
	for (const origin of [A, B]) {
		saved.value = origin;
		saved.dispatchEvent(new Event('change'));
		await flush();
		expect(document.getElementById('offline-enabled').checked).toBe(true);
	}
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
});

it('ends the initial pre-address choice when an existing instance is explicitly selected', async () => {
	values.settings.instanceOrigin = null;
	await openOptions();
	const input = document.getElementById('instance-origin');
	input.value = '';
	input.dispatchEvent(new Event('input'));
	setOffline(true);
	input.value = 'https://new.example';
	input.dispatchEvent(new Event('input'));
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	const saved = document.getElementById('saved-instances');
	saved.value = A;
	saved.dispatchEvent(new Event('change'));
	await flush();
	expect(input.value).toBe(A);
	expect(document.getElementById('offline-enabled').checked).toBe(false);
});

it('keeps a new choice made after clearing an existing address while the replacement is typed', async () => {
	await openOptions();
	editAddress();
	const input = document.getElementById('instance-origin');
	input.value = '';
	input.dispatchEvent(new Event('input'));
	setOffline(true);
	for (const address of ['https://b', 'https://b.e', B]) {
		input.value = address;
		input.dispatchEvent(new Event('input'));
		await flush();
		expect(document.getElementById('offline-enabled').checked).toBe(true);
	}
	await save(B);
	expect(values.offlineInstances).toContain(B);
});

it.each(['cancel', 'save'])('clears other instance drafts after %s finishes the edit session', async (action) => {
	await openOptions();
	editAddress();
	setOffline(true);
	const input = document.getElementById('instance-origin');
	input.value = B;
	input.dispatchEvent(new Event('input'));
	await flush();
	setOffline(true);
	if (action === 'save') {
		await save(B);
	} else {
		document.getElementById('cancel-connection').click();
		await flush();
	}
	editAddress();
	input.value = action === 'save' ? A : B;
	input.dispatchEvent(new Event('input'));
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(false);
});

it('preserves the latest explicit choice across invalid input and an older configuration response', async () => {
	await openOptions();
	editAddress();
	const original = chrome.storage.local.get.getMockImplementation();
	let release;
	let pendingRead = true;
	chrome.storage.local.get.mockImplementation((key) => {
		if (key === 'offlineInstances' && pendingRead) {
			pendingRead = false;
			return new Promise((resolve) => {
				release = () => resolve({ offlineInstances: [] });
			});
		}
		return original(key);
	});
	const input = document.getElementById('instance-origin');
	input.value = B;
	input.dispatchEvent(new Event('input'));
	await flush();
	input.value = 'https://';
	input.dispatchEvent(new Event('input'));
	setOffline(true);
	input.value = `${B}/account`;
	input.dispatchEvent(new Event('input'));
	await flush();
	release();
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.querySelector('button[type=submit]').disabled).toBe(false);
	await save(B);
	expect(values.offlineInstances).toContain(B);
});

it('recovers a failed connection configuration lookup with the retry action', async () => {
	const original = chrome.storage.local.get.getMockImplementation();
	let storageFailed = true;
	chrome.storage.local.get.mockImplementation((key) =>
		key === 'offlineInstances' && storageFailed ? Promise.reject(new Error('无法读取连接配置')) : original(key),
	);
	await openOptions();
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.querySelector('button[type=submit]').disabled).toBe(true);
	expect(connectionChecks()).toHaveLength(0);
	storageFailed = false;
	document.getElementById('check-instance').click();
	await flush();
	expect(document.querySelector('button[type=submit]').disabled).toBe(false);
	expect(connectionChecks()).toHaveLength(1);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
});

it('recovers failed initial settings reads without requiring a page reload', async () => {
	const original = chrome.storage.local.get.getMockImplementation();
	let storageFailed = true;
	chrome.storage.local.get.mockImplementation((key) =>
		key === 'settings' && storageFailed ? Promise.reject(new Error('无法读取设置')) : original(key),
	);
	await openOptions();
	expect(document.getElementById('check-instance').hidden).toBe(false);
	storageFailed = false;
	document.getElementById('check-instance').click();
	await flush();
	expect(document.getElementById('instance-origin').value).toBe(A);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	expect(connectionChecks()).toHaveLength(1);
});

it('keeps the saved address editable and reveals the current address only while there is a draft', async () => {
	await openOptions();
	expect(document.getElementById('connection-summary').hidden).toBe(true);
	expect(document.getElementById('current-instance').textContent).toBe(A);
	expect(document.getElementById('current-instance').href).toBe(A + '/');
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('setup-guide').hidden).toBe(true);
	expect(document.getElementById('footer-instance').href).toBe(A + '/');
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(document.getElementById('edit-connection')).toBeNull();
	expect(document.getElementById('cancel-connection').hidden).toBe(true);
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	const input = document.getElementById('instance-origin');
	input.focus();
	editAddress(B);
	await flush();
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('connection-summary').hidden).toBe(false);
	expect(document.getElementById('connection-summary').textContent).toContain('当前使用');
	expect(document.getElementById('current-instance').href).toBe(A + '/');
	expect(document.activeElement).toBe(input);
	expect(document.getElementById('cancel-connection').hidden).toBe(false);
	expect(document.getElementById('cancel-connection').textContent).toBe('撤销修改');
	expect(document.getElementById('connect-instance').textContent).toBe('保存并连接');
	expect(values.settings.instanceOrigin).toBe(A);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_INSTANCE')).toBe(false);
});

it.each(['offline', 'session'])('cancel restores the saved %s connection and discards unsaved address and offline edits', async (mode) => {
	values.offlineInstances = mode === 'offline' ? [A] : [];
	await openOptions();
	sendMessage.mockClear();
	editAddress();
	const input = document.getElementById('instance-origin');
	input.value = B;
	input.dispatchEvent(new Event('input'));
	await flush();
	setOffline(mode !== 'offline');
	document.getElementById('cancel-connection').click();
	await flush();
	expect(input.value).toBe(A);
	expect(document.getElementById('offline-enabled').checked).toBe(mode === 'offline');
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.activeElement).toBe(document.getElementById('instance-origin'));
	expect(document.getElementById('connection-summary').hidden).toBe(true);
	expect(document.getElementById('cancel-connection').hidden).toBe(true);
	expect(document.getElementById('connect-instance').textContent).toBe('检查连接');
	expect(values.settings.instanceOrigin).toBe(A);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('enables offline use for the unchanged saved address immediately and creates the cache without another save action', async () => {
	await openOptions();
	sendMessage.mockClear();
	setOffline(true);
	await flush();
	expect(sendMessage).toHaveBeenCalledWith({
		type: 'SAVE_INSTANCE',
		instanceOrigin: A,
		connection: { mode: 'offline' },
		expectedConnection: { instanceOrigin: A, mode: 'session' },
	});
	expect(values.offlineInstances).toEqual([A]);
	expect(connectionChecks()).toHaveLength(1);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(sendMessage.mock.calls.some(([message]) => message.type === 'IMPORT_OFFLINE')).toBe(false);
});

it('disables offline use and clears saved keys immediately without permissions or a network check', async () => {
	values.offlineInstances = [A, B];
	values.offlineStatus = { available: true, accountCount: 2 };
	await openOptions();
	sendMessage.mockClear();
	setOffline(false);
	await flush();
	expect(sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_OFFLINE', instanceOrigin: A });
	expect(values.offlineInstances).toEqual([B]);
	expect(values.offlineStatus.available).toBe(false);
	expect(document.getElementById('offline-enabled').checked).toBe(false);
	expect(document.getElementById('status').textContent).toBe('已关闭离线使用，本地密钥已清除');
	expect(document.getElementById('open-instance').hidden).toBe(true);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
	expect(connectionChecks()).toHaveLength(0);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'IMPORT_OFFLINE'].includes(message.type))).toBe(false);
});

it('allows clearing local keys after access permission is revoked even when cache diagnostics fail', async () => {
	values.offlineInstances = [A];
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		['OFFLINE_STATUS', 'CHECK_INSTANCE'].includes(message.type)
			? Promise.resolve({ ok: false, error: { code: 'PERMISSION_REQUIRED', message: '实例权限已撤销' } })
			: original(message),
	);
	await openOptions();
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(document.getElementById('status').dataset.code).toBe('PERMISSION_REQUIRED');
	sendMessage.mockClear();
	setOffline(false);
	await flush();
	expect(sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_OFFLINE', instanceOrigin: A });
	expect(values.offlineInstances).toEqual([]);
	expect(document.getElementById('offline-enabled').checked).toBe(false);
	expect(document.getElementById('status').textContent).toBe('已关闭离线使用，本地密钥已清除');
	expect(chrome.permissions.request).not.toHaveBeenCalled();
	expect(connectionChecks()).toHaveLength(0);
});

it.each([true, false])('restores the saved offline toggle if changing it to %s fails', async (enabled) => {
	values.offlineInstances = enabled ? [] : [A];
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === (enabled ? 'SAVE_INSTANCE' : 'CLEAR_OFFLINE')
			? Promise.resolve({ ok: false, error: { message: '无法保存离线设置' } })
			: original(message),
	);
	setOffline(enabled);
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(!enabled);
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(values.offlineInstances).toEqual(enabled ? [] : [A]);
	expect(document.getElementById('status').textContent).toBe('无法保存离线设置');
	expect(document.getElementById('status').dataset.tone).toBe('error');
});

it('keeps the initial offline choice local until the user connects an instance', async () => {
	values.settings.instanceOrigin = null;
	values.instances = [];
	await openOptions();
	setOffline(true);
	await flush();
	expect(values.offlineInstances).toBeUndefined();
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CHECK_INSTANCE'].includes(message.type))).toBe(false);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
	expect(document.getElementById('setup-guide').hidden).toBe(false);
	await save(A);
	expect(values.offlineInstances).toEqual([A]);
	expect(document.getElementById('setup-guide').hidden).toBe(true);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
});

it.each([
	{
		ok: true,
		data: { instanceOrigin: A, accounts: [{ id: 'same-id', name: 'Stale cache' }], accountCount: 99, offlineStatus: { usingCache: true } },
	},
	{ ok: false, error: { code: 'AUTH_REQUIRED', message: '过时的登录错误' } },
])('ignores a pending connection check after clearing the offline cache: %j', async (lateResponse) => {
	values.offlineInstances = [A];
	values.offlineStatus = { available: true, accountCount: 2 };
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE'
			? new Promise((resolve) => {
					release = resolve;
				})
			: original(message),
	);
	await openOptions();
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	setOffline(false);
	await flush();
	expect(document.getElementById('status').textContent).toBe('已关闭离线使用，本地密钥已清除');
	release(lateResponse);
	await flush();
	expect(document.getElementById('status').textContent).toBe('已关闭离线使用，本地密钥已清除');
	expect(document.getElementById('offline-enabled').checked).toBe(false);
	expect(document.getElementById('site-list').textContent).not.toContain('Stale cache');
	expect(document.getElementById('import-offline').hidden).toBe(true);
	expect(connectionChecks()).toHaveLength(1);
});

it.each([
	['AUTH_REQUIRED', false, false],
	['SOURCE_UNAVAILABLE', false, true],
	['SOURCE_UNAVAILABLE', true, false],
])('offers webpage recovery for %s with cache=%s only when usable: %s', async (code, available, recovery) => {
	values.offlineInstances = [A];
	values.offlineStatus = { available, accountCount: available ? 2 : 0 };
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation((message) =>
		message.type === 'CHECK_INSTANCE' ? Promise.resolve({ ok: false, error: { code, message: '连接失败' } }) : original(message),
	);
	await openOptions();
	expect(document.getElementById('import-offline').hidden).toBe(!recovery);
	expect(document.getElementById('check-instance').hidden).toBe(false);
	expect(document.getElementById('status').dataset.code).toBe(code);
	if (code === 'AUTH_REQUIRED') {
		expect(document.getElementById('open-instance').textContent).toBe('去登录');
	}
});

it('shows search at five websites and preserves the active search when local updates reduce the list', async () => {
	values.bindings = [];
	values.autofillSites = Array.from({ length: 4 }, (_, index) => ({ instanceOrigin: A, targetOrigin: `https://site-${index}.example` }));
	await openOptions();
	expect(document.getElementById('site-search-wrapper').hidden).toBe(true);
	values.autofillSites.push({ instanceOrigin: A, targetOrigin: 'https://site-4.example' });
	emitSiteStorageChange({ autofillSites: {} });
	await flush();
	expect(document.getElementById('site-search-wrapper').hidden).toBe(false);
	const search = document.getElementById('binding-search');
	search.value = 'site-4';
	search.dispatchEvent(new Event('input'));
	expect(document.querySelectorAll('.site-card')).toHaveLength(1);
	values.autofillSites = [];
	emitSiteStorageChange({ autofillSites: {} });
	await flush();
	expect(document.getElementById('site-search-wrapper').hidden).toBe(false);
	expect(search.value).toBe('site-4');
	expect(document.getElementById('site-empty').textContent).toBe('没有匹配的网站或账户。');
	const clear = document.getElementById('clear-site-search');
	expect(clear.getAttribute('aria-label')).toBe('清空搜索');
	expect(clear.textContent.trim()).toBe('×');
	clear.click();
	expect(search.value).toBe('');
	expect(document.getElementById('site-search-wrapper').hidden).toBe(true);
});

it('exposes privacy details only through an accessible expandable footer control', async () => {
	await openOptions();
	const toggle = document.getElementById('privacy-toggle');
	const content = document.getElementById(toggle.getAttribute('aria-controls'));
	expect(content.id).toBe('privacy-content');
	expect(content.hidden).toBe(true);
	expect(toggle.getAttribute('aria-expanded')).toBe('false');
	toggle.click();
	expect(content.hidden).toBe(false);
	expect(toggle.getAttribute('aria-expanded')).toBe('true');
	expect(content.textContent).toContain('账户密钥会保存在此浏览器');
	toggle.click();
	expect(content.hidden).toBe(true);
	expect(toggle.getAttribute('aria-expanded')).toBe('false');
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
});

it.each(['instance', 'mode'])('does not overwrite a saved %s changed elsewhere when enabling offline use', async (changed) => {
	await openOptions();
	if (changed === 'instance') {
		values.settings.instanceOrigin = B;
	} else {
		values.offlineInstances = [A];
	}
	sendMessage.mockClear();
	setOffline(true);
	await flush();
	expect(values.settings.instanceOrigin).toBe(changed === 'instance' ? B : A);
	expect(values.offlineInstances).toEqual(changed === 'mode' ? [A] : undefined);
	expect(document.getElementById('offline-enabled').checked).toBe(changed === 'mode');
	expect(document.getElementById('status').dataset.code).toBe('REQUEST_EXPIRED');
	expect(connectionChecks()).toHaveLength(0);
	if (changed === 'mode') {
		expect(document.getElementById('offline-enabled').checked).toBe(true);
		expect(values.offlineInstances).toEqual([A]);
	}
});

it('updates the instance links, websites and account names after an external settings change without saving', async () => {
	values.autofillSites = [
		{ instanceOrigin: A, targetOrigin: 'https://login-a.example', targetPath: '/otp' },
		{ instanceOrigin: B, targetOrigin: 'https://login-b.example', targetPath: '/mfa' },
	];
	await openOptions();
	sendMessage.mockClear();
	values.settings.instanceOrigin = B;
	emitSiteStorageChange({ settings: { oldValue: { instanceOrigin: A }, newValue: { instanceOrigin: B } } });
	await flush();

	expect(document.getElementById('instance-origin').value).toBe(B);
	expect(document.getElementById('current-instance').textContent).toBe(B);
	expect(document.getElementById('current-instance').href).toBe(B + '/');
	expect(document.getElementById('footer-instance').href).toBe(B + '/');
	expect(siteCard('https://login-a.example')).toBeUndefined();
	expect(siteCard('https://site-a.example')).toBeUndefined();
	expect(siteCard('https://login-b.example')).toBeDefined();
	expect(siteCard('https://site-b.example').textContent).toContain('bob@example.com');
	expect(document.getElementById('site-list').textContent).not.toContain('alice@example.com');
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	expect(connectionChecks()).toHaveLength(1);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it.each([true, false])('updates the saved offline toggle to %s after external mode changes without writing back', async (enabled) => {
	values.offlineInstances = enabled ? [] : [A];
	await openOptions();
	sendMessage.mockClear();
	const oldValue = [...values.offlineInstances];
	values.offlineInstances = enabled ? [A] : [];
	emitSiteStorageChange({ offlineInstances: { oldValue, newValue: values.offlineInstances } });
	await flush();

	expect(document.getElementById('offline-enabled').checked).toBe(enabled);
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(document.getElementById('instance-origin').value).toBe(A);
	expect(document.getElementById('status').textContent).toBe(`${enabled ? '可离线使用' : '已连接'} · 1 个账户`);
	expect(connectionChecks()).toHaveLength(1);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it.each(['cancel', 'submit'])('preserves both fields of an offline address draft on external changes until explicit %s', async (action) => {
	const draftOrigin = 'https://draft.example';
	await openOptions();
	editAddress();
	const address = document.getElementById('instance-origin');
	address.value = draftOrigin;
	address.dispatchEvent(new Event('input'));
	await flush();
	setOffline(true);
	await flush();
	sendMessage.mockClear();
	values.settings.instanceOrigin = B;
	values.offlineInstances = [];
	emitSiteStorageChange({ settings: {}, offlineInstances: {} });
	await flush();

	expect(address.value).toBe(draftOrigin);
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(document.getElementById('current-instance').href).toBe(B + '/');
	expect(document.getElementById('status').textContent).toContain('保留未保存的输入');
	expect(siteCard('https://site-a.example')).toBeUndefined();
	expect(siteCard('https://site-b.example')).toBeDefined();
	expect(connectionChecks()).toHaveLength(0);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	address.value = `${draftOrigin}/accounts?view=all`;
	address.dispatchEvent(new Event('input'));
	await flush();
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	if (action === 'cancel') {
		document.getElementById('cancel-connection').click();
		await flush();
		expect(address.value).toBe(B);
		expect(document.getElementById('offline-enabled').checked).toBe(false);
		expect(values.settings.instanceOrigin).toBe(B);
		expect(siteCard('https://site-b.example').textContent).toContain('bob@example.com');
		expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
		expect(chrome.permissions.request).not.toHaveBeenCalled();
	} else {
		await save(draftOrigin);
		expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_INSTANCE', instanceOrigin: draftOrigin, connection: { mode: 'offline' } });
		expect(values.settings.instanceOrigin).toBe(draftOrigin);
		expect(values.offlineInstances).toContain(draftOrigin);
		expect(address.value).toBe(draftOrigin);
		expect(document.getElementById('offline-enabled').checked).toBe(true);
		expect(document.getElementById('current-instance').href).toBe(draftOrigin + '/');
	}
	expect(document.getElementById('connection-editor').hidden).toBe(false);
	expect(connectionChecks()).toHaveLength(1);
});

it.each([
	{ ok: true, data: { instanceOrigin: A, accountCount: 99, accounts: [{ id: 'same-id', name: 'Old account', account: 'stale-alice' }] } },
	{ ok: false, error: { code: 'SOURCE_OFFLINE', message: 'Old instance is unavailable' } },
])('discards late connection results after another page switches instances: %j', async (lateResponse) => {
	const original = sendMessage.getMockImplementation();
	let release;
	let firstCheck = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'CHECK_INSTANCE' && firstCheck) {
			firstCheck = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	await openOptions();
	expect(release).toBeTypeOf('function');
	values.settings.instanceOrigin = B;
	emitSiteStorageChange({ settings: {} });
	await flush();
	expect(siteCard('https://site-b.example').textContent).toContain('bob@example.com');
	const siteMarkup = document.getElementById('site-list').innerHTML;
	release(lateResponse);
	await flush();

	expect(document.getElementById('site-list').innerHTML).toBe(siteMarkup);
	expect(document.getElementById('current-instance').href).toBe(B + '/');
	expect(document.getElementById('instance-origin').value).toBe(B);
	expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
	expect(document.getElementById('site-list').textContent).not.toContain('stale-alice');
	expect(connectionChecks()).toHaveLength(2);
});

it('does not apply an outdated settings read when a newer storage event arrives before it completes', async () => {
	const latestOrigin = 'https://latest.example';
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let release;
	let firstRead = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'GET_SETTINGS' && firstRead) {
			firstRead = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	const linkUpdates = vi.spyOn(document.getElementById('current-instance'), 'href', 'set');
	values.settings.instanceOrigin = B;
	emitSiteStorageChange({ settings: {} });
	await flush();
	expect(release).toBeTypeOf('function');
	values.settings.instanceOrigin = latestOrigin;
	values.offlineInstances = [latestOrigin];
	emitSiteStorageChange({ settings: {}, offlineInstances: {} });
	release({ ok: true, data: { instanceOrigin: B } });
	await flush();

	expect(linkUpdates).not.toHaveBeenCalledWith(B);
	expect(document.getElementById('current-instance').href).toBe(latestOrigin + '/');
	expect(document.getElementById('instance-origin').value).toBe(latestOrigin);
	expect(document.getElementById('offline-enabled').checked).toBe(true);
	expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(3);
	expect(connectionChecks()).toHaveLength(2);
});

it('removes settings listeners on close and ignores an external configuration read that finishes afterward', async () => {
	await openOptions();
	const original = sendMessage.getMockImplementation();
	let release;
	sendMessage.mockImplementation((message) =>
		message.type === 'GET_SETTINGS'
			? new Promise((resolve) => {
					release = resolve;
				})
			: original(message),
	);
	values.settings.instanceOrigin = B;
	emitSiteStorageChange({ settings: {} });
	await flush();
	expect(release).toBeTypeOf('function');
	window.dispatchEvent(new Event('pagehide'));
	const markup = document.body.innerHTML;
	const calls = sendMessage.mock.calls.length;
	for (const [listener] of chrome.storage.onChanged.addListener.mock.calls) {
		expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
	}
	release({ ok: true, data: { instanceOrigin: B } });
	await flush();
	emitSiteStorageChange({ settings: {}, offlineInstances: {} });
	window.dispatchEvent(new Event('online'));
	await flush();
	expect(document.body.innerHTML).toBe(markup);
	expect(sendMessage).toHaveBeenCalledTimes(calls);
});

it.each(['save', 'clear'])('coalesces storage events caused by its own %s without recursive writes or duplicate checks', async (action) => {
	values.offlineInstances = action === 'clear' ? [A] : [];
	await openOptions();
	const original = sendMessage.getMockImplementation();
	sendMessage.mockImplementation(async (message) => {
		const response = await original(message);
		if (message.type === 'SAVE_INSTANCE' || message.type === 'CLEAR_OFFLINE') {
			emitSiteStorageChange({ settings: {}, offlineInstances: {}, offlineCache: {} });
			emitSiteStorageChange({ offlineInstances: {} });
		}
		return response;
	});
	sendMessage.mockClear();
	if (action === 'save') {
		editAddress(B);
		await flush();
		setOffline(true);
		await save(B);
		expect(values.settings.instanceOrigin).toBe(B);
		expect(document.getElementById('offline-enabled').checked).toBe(true);
		expect(document.getElementById('status').textContent).toBe('可离线使用 · 1 个账户');
	} else {
		setOffline(false);
		await flush();
		expect(values.offlineInstances).toEqual([]);
		expect(document.getElementById('offline-enabled').checked).toBe(false);
		expect(document.getElementById('status').textContent).toBe('已关闭离线使用，本地密钥已清除');
	}
	await flush();
	expect(sendMessage.mock.calls.filter(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toHaveLength(1);
	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(1);
	expect(connectionChecks()).toHaveLength(action === 'save' ? 1 : 0);
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
});

it.each(['session', 'offline'])(
	'retry discovers the latest %s connection after a settings conflict without a storage event',
	async (mode) => {
		await openOptions();
		values.settings.instanceOrigin = B;
		values.offlineInstances = mode === 'offline' ? [B] : [];
		setOffline(true);
		await flush();
		expect(document.getElementById('status').dataset.code).toBe('REQUEST_EXPIRED');
		expect(document.getElementById('check-instance').hidden).toBe(false);
		sendMessage.mockClear();
		document.getElementById('check-instance').click();
		await flush();

		expect(document.getElementById('current-instance').href).toBe(B + '/');
		expect(document.getElementById('instance-origin').value).toBe(B);
		expect(document.getElementById('offline-enabled').checked).toBe(mode === 'offline');
		expect(siteCard('https://site-b.example').textContent).toContain('bob@example.com');
		expect(document.getElementById('status').textContent).toBe(`${mode === 'offline' ? '可离线使用' : '已连接'} · 1 个账户`);
		expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SETTINGS' });
		expect(connectionChecks()).toHaveLength(1);
		expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	},
);

it.each(['session', 'offline'])('does not repeat checks or clear account names for unchanged %s settings notifications', async (mode) => {
	values.offlineInstances = mode === 'offline' ? [A] : [];
	await openOptions();
	const siteMarkup = document.getElementById('site-list').innerHTML;
	const status = document.getElementById('status').textContent;
	sendMessage.mockClear();
	emitSiteStorageChange({ settings: { oldValue: { instanceOrigin: A }, newValue: { instanceOrigin: A } } });
	emitSiteStorageChange({ offlineInstances: { oldValue: [...values.offlineInstances], newValue: [...values.offlineInstances] } });
	await flush();
	emitSiteStorageChange({ settings: {}, offlineInstances: {} });
	await flush();

	expect(connectionChecks()).toHaveLength(0);
	expect(document.getElementById('site-list').innerHTML).toBe(siteMarkup);
	expect(document.getElementById('status').textContent).toBe(status);
	expect(document.getElementById('offline-enabled').checked).toBe(mode === 'offline');
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
});

it.each([B, null])('uses the latest saved instance %j when settings change before the initial read completes', async (latestOrigin) => {
	const original = sendMessage.getMockImplementation();
	let release;
	let initialRead = true;
	sendMessage.mockImplementation((message) => {
		if (message.type === 'GET_SETTINGS' && initialRead) {
			initialRead = false;
			return new Promise((resolve) => {
				release = resolve;
			});
		}
		return original(message);
	});
	await openOptions();
	expect(release).toBeTypeOf('function');
	values.settings.instanceOrigin = latestOrigin;
	emitSiteStorageChange({ settings: {} });
	release({ ok: true, data: { instanceOrigin: A } });
	await flush();

	expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(2);
	expect(document.getElementById('site-list').textContent).not.toContain('alice@example.com');
	expect(document.querySelector('button[type="submit"]').disabled).toBe(false);
	expect(document.getElementById('offline-enabled').disabled).toBe(false);
	expect(sendMessage.mock.calls.some(([message]) => ['SAVE_INSTANCE', 'CLEAR_OFFLINE'].includes(message.type))).toBe(false);
	if (latestOrigin) {
		expect(document.getElementById('instance-origin').value).toBe(latestOrigin);
		expect(document.getElementById('current-instance').href).toBe(latestOrigin + '/');
		expect(document.getElementById('footer-instance').href).toBe(latestOrigin + '/');
		expect(siteCard('https://site-b.example').textContent).toContain('bob@example.com');
		expect(document.getElementById('status').textContent).toBe('已连接 · 1 个账户');
		expect(connectionChecks()).toHaveLength(1);
	} else {
		expect(document.getElementById('connection-summary').hidden).toBe(true);
		expect(document.getElementById('footer-instance').hidden).toBe(true);
		expect(document.getElementById('connection-editor').hidden).toBe(false);
		expect(document.getElementById('setup-guide').hidden).toBe(false);
		expect(document.querySelectorAll('.site-card')).toHaveLength(0);
		expect(document.getElementById('status').textContent).toBe('请连接你的 2FA 实例');
		expect(connectionChecks()).toHaveLength(0);
	}
});
