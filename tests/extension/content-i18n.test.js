// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomaticPanel } from '../../extension/src/content/automatic-panel.js';
import { createAutomaticController } from '../../extension/src/content/automatic.js';
import { createContentController, createRuntimeMessageListener } from '../../extension/src/content/index.js';
import { initI18n } from '../../extension/src/shared/i18n.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../extension/src/locales/index.js';

const NONCE = '0123456789abcdef0123456789abcdef0123';
const ACCOUNTS = [
	{ id: 'one', name: '账户名稱', account: 'alice@example.com', type: 'TOTP', digits: 6 },
	{ id: 'two', name: 'GitHub', account: 'bob@example.com', type: 'TOTP', digits: 6 },
];
let cleanups;
let shadows;

function runtimeFixture(language = 'zh-CN', languageResponse) {
	const listeners = new Set();
	const runtime = {
		id: 'extension-i18n-test',
		onMessage: {
			addListener: vi.fn((listener) => listeners.add(listener)),
			removeListener: vi.fn((listener) => listeners.delete(listener)),
		},
		sendMessage: vi.fn(async (message) => {
			if (message.type === MESSAGE.GET_LANGUAGE) {
				return languageResponse || { ok: true, data: { preference: language, language } };
			}
			if (message.type === MESSAGE.AUTO_STATUS) {
				return { ok: true, data: { enabled: true } };
			}
			if (message.type === MESSAGE.AUTO_DISCOVER) {
				return { ok: true, data: { nonce: NONCE, accounts: ACCOUNTS, autoFillAccountId: null } };
			}
			return { ok: false, error: { code: 'TARGET_UNAVAILABLE' } };
		}),
	};
	return {
		runtime,
		listenerCount: () => listeners.size,
		change(nextLanguage, sender = { id: runtime.id }) {
			for (const listener of listeners) {
				listener({ type: MESSAGE.LANGUAGE_CHANGED, preference: nextLanguage, language: nextLanguage }, sender, () => {});
			}
		},
	};
}

function otpInput() {
	const input = document.createElement('input');
	input.autocomplete = 'one-time-code';
	input.maxLength = 6;
	const box = { left: 20, right: 220, top: 20, bottom: 44, width: 200, height: 24 };
	Object.defineProperty(input, 'getClientRects', { value: () => [box] });
	Object.defineProperty(input, 'getBoundingClientRect', { value: () => box });
	document.body.append(input);
	return input;
}

function showPanel(input, failed = false) {
	const controller = createAutomaticPanel({ doc: document });
	cleanups.push(controller.dispose);
	const onSelect = vi.fn();
	const onRetry = vi.fn();
	const onClose = vi.fn();
	controller.show({ input, accounts: ACCOUNTS, failed, onSelect, onRetry, onClose });
	return { controller, shadow: shadows.at(-1), onSelect, onRetry, onClose };
}

beforeEach(() => {
	cleanups = [];
	shadows = [];
	document.body.replaceChildren();
	document.documentElement.lang = 'ja';
	document.title = 'ウェブサイト';
	const attachShadow = window.Element.prototype.attachShadow;
	vi.spyOn(window.Element.prototype, 'attachShadow').mockImplementation(function (options) {
		const shadow = attachShadow.call(this, options);
		if (this.hasAttribute('data-twofa-autofill')) {
			shadows.push(shadow);
		}
		return shadow;
	});
});

afterEach(() => {
	for (const cleanup of cleanups.reverse()) {
		cleanup();
	}
	vi.restoreAllMocks();
});

describe('localized injected content', () => {
	it('cleans up both content controllers when shared language initialization discovers an invalidated runtime', async () => {
		let rejectLanguage;
		const pendingLanguage = new Promise((resolve, reject) => {
			rejectLanguage = reject;
		});
		const fixture = runtimeFixture('en', pendingLanguage);
		const target = otpInput();
		const manual = createRuntimeMessageListener({ runtime: fixture.runtime, initializeLanguage: true });
		fixture.runtime.onMessage.addListener(manual);
		const automatic = createAutomaticController({ doc: document, runtime: fixture.runtime, initializeLanguage: true });
		cleanups.push(manual.dispose, automatic.dispose);
		const refresh = automatic.refresh();
		rejectLanguage(new Error('Extension context invalidated.'));
		await refresh;
		await vi.waitFor(() => {
			expect(manual.isDisposed()).toBe(true);
			expect(automatic.isDisposed()).toBe(true);
			expect(fixture.listenerCount()).toBe(0);
		});
		expect(fixture.runtime.sendMessage.mock.calls.map(([message]) => message.type)).toEqual([MESSAGE.GET_LANGUAGE]);
		expect(target.value).toBe('');
		expect(shadows).toHaveLength(0);
	});

	it('releases a pending shared language listener after both controllers are disposed before initialization resolves', async () => {
		let resolveLanguage;
		const pendingLanguage = new Promise((resolve) => {
			resolveLanguage = resolve;
		});
		const fixture = runtimeFixture('en', pendingLanguage);
		otpInput();
		const manual = createRuntimeMessageListener({ runtime: fixture.runtime, initializeLanguage: true });
		fixture.runtime.onMessage.addListener(manual);
		const automatic = createAutomaticController({ doc: document, runtime: fixture.runtime, initializeLanguage: true });
		cleanups.push(manual.dispose, automatic.dispose);
		const refresh = automatic.refresh();
		manual.dispose();
		automatic.dispose();
		resolveLanguage({ ok: true, data: { preference: 'en', language: 'en' } });
		await refresh;
		await vi.waitFor(() => expect(fixture.listenerCount()).toBe(0));
		expect(fixture.runtime.sendMessage.mock.calls.map(([message]) => message.type)).toEqual([MESSAGE.GET_LANGUAGE]);
		expect(shadows).toHaveLength(0);
		expect(document.documentElement.lang).toBe('ja');
	});

	it('ignores forged language broadcasts from tabs and other extensions while a picker is visible', async () => {
		const fixture = runtimeFixture('en');
		cleanups.push(await initI18n({ root: null, runtime: fixture.runtime }));
		const picker = showPanel(otpInput());
		const control = picker.shadow.querySelector('.account');
		control.focus();
		fixture.change('zh-TW', { id: fixture.runtime.id, tab: { id: 7 } });
		fixture.change('zh-CN', { id: 'another-extension' });
		expect(picker.shadow.querySelector('strong').textContent).toBe('Choose a 2FA account');
		expect(picker.shadow.activeElement).toBe(control);
		expect(document.documentElement.lang).toBe('ja');
		expect(picker.onSelect).not.toHaveBeenCalled();
	});

	it.each([
		['zh-CN', '选择 2FA 账户', '暂时无法填充验证码', '关闭自动填充提示', '重试'],
		['zh-TW', '選擇 2FA 帳戶', '暫時無法填入驗證碼', '關閉自動填入提示', '重試'],
		['en', 'Choose a 2FA account', 'Unable to fill the code right now', 'Close autofill prompt', 'Retry'],
	])(
		'localizes account and retry panels in %s without translating the website or account names',
		async (language, title, failedTitle, close, retry) => {
			const { runtime } = runtimeFixture(language);
			cleanups.push(await initI18n({ root: null, runtime }));
			const target = otpInput();
			const picker = showPanel(target);
			expect(picker.shadow.host.lang).toBe(language);
			expect(picker.shadow.querySelector('strong').textContent).toBe(title);
			expect(picker.shadow.querySelector('.close').getAttribute('aria-label')).toBe(close);
			expect(picker.shadow.querySelector('.account').textContent).toBe('账户名稱alice@example.com');
			expect(picker.shadow.querySelector('section').getAttribute('aria-label')).toBeTruthy();
			picker.controller.remove();
			const failed = showPanel(target, true);
			expect(failed.shadow.querySelector('strong').textContent).toBe(failedTitle);
			expect(failed.shadow.querySelector('.retry').textContent).toBe(retry);
			expect(document.documentElement.lang).toBe('ja');
			expect(document.title).toBe('ウェブサイト');
			expect(target.value).toBe('');
		},
	);

	it('updates text in place while preserving focused controls and pending selection state', async () => {
		const fixture = runtimeFixture();
		cleanups.push(await initI18n({ root: null, runtime: fixture.runtime }));
		const picker = showPanel(otpInput());
		const accounts = [...picker.shadow.querySelectorAll('.account')];
		accounts[1].focus();
		for (const language of SUPPORTED_LANGUAGES) {
			fixture.change(language);
			expect(picker.shadow.host.lang).toBe(language);
			expect(picker.shadow.querySelector('strong').textContent).toBe(LOCALES[language].contentChooseAccount);
			expect(picker.shadow.querySelector('.close').getAttribute('aria-label')).toBe(LOCALES[language].contentCloseAutofill);
			expect(picker.shadow.activeElement).toBe(accounts[1]);
			expect([...picker.shadow.querySelectorAll('.account')]).toEqual(accounts);
			expect(picker.shadow.querySelector('.account').textContent).toBe('账户名稱alice@example.com');
		}
		picker.controller.setSelecting();
		fixture.change('zh-TW');
		expect(picker.shadow.querySelector('strong').textContent).toBe('選擇 2FA 帳戶');
		expect(accounts.every((button) => button.disabled)).toBe(true);
		expect(picker.onSelect).not.toHaveBeenCalled();
		expect(picker.onRetry).not.toHaveBeenCalled();
		expect(picker.onClose).not.toHaveBeenCalled();
		picker.controller.dispose();
		fixture.change('en');
		expect(picker.shadow.querySelector('strong').textContent).toBe('選擇 2FA 帳戶');
	});

	it('preserves prepared nonces across language changes and localizes the subsequent one-shot error', async () => {
		const fixture = runtimeFixture();
		cleanups.push(await initI18n({ root: null, runtime: fixture.runtime }));
		const target = otpInput();
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
		cleanups.push(controller.dispose);
		expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).toMatchObject({
			ok: true,
			status: 'ready',
		});
		fixture.change('en');
		const fill = { type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 10000 };
		expect(await controller.handle(fill)).toMatchObject({ ok: true, status: 'filled' });
		expect(target.value).toBe('012345');
		expect(await controller.handle(fill)).toMatchObject({
			ok: false,
			error: { code: 'NONCE_INVALID', message: 'This fill request does not exist or has already been used' },
		});
		fixture.change('zh-TW');
		expect(await controller.handle(fill)).toMatchObject({
			error: { code: 'NONCE_INVALID', message: '填入請求不存在或已使用' },
		});
	});

	it('does not rediscover accounts or fill codes when an active picker changes language', async () => {
		const fixture = runtimeFixture('en');
		const target = otpInput();
		const controller = createAutomaticController({ doc: document, runtime: fixture.runtime, initializeLanguage: true });
		cleanups.push(controller.dispose);
		await controller.refresh();
		await vi.waitFor(() => expect(shadows).toHaveLength(1));
		const picker = shadows[0];
		expect(picker.querySelector('strong').textContent).toBe('Choose a 2FA account');
		const requests = fixture.runtime.sendMessage.mock.calls.length;
		fixture.change('zh-TW');
		expect(picker.querySelector('strong').textContent).toBe('選擇 2FA 帳戶');
		expect(fixture.runtime.sendMessage).toHaveBeenCalledTimes(requests);
		expect(target.value).toBe('');
		expect(picker.host.isConnected).toBe(true);
	});

	it('keeps an automatic stop effective while initial language loading is pending', async () => {
		let resolveLanguage;
		const languageResponse = new Promise((resolve) => {
			resolveLanguage = resolve;
		});
		const fixture = runtimeFixture('en', languageResponse);
		otpInput();
		const controller = createAutomaticController({ doc: document, runtime: fixture.runtime, initializeLanguage: true });
		cleanups.push(controller.dispose);
		const pending = controller.refresh();
		controller.stop();
		resolveLanguage({ ok: true, data: { preference: 'en', language: 'en' } });
		await pending;
		expect(fixture.runtime.sendMessage.mock.calls.map(([message]) => message.type)).not.toContain(MESSAGE.AUTO_STATUS);
		expect(shadows).toHaveLength(0);
	});

	it('waits for the saved language before replying to an initial manual fill error', async () => {
		let resolveLanguage;
		const languageResponse = new Promise((resolve) => {
			resolveLanguage = resolve;
		});
		const fixture = runtimeFixture('en', languageResponse);
		const listener = createRuntimeMessageListener({ runtime: fixture.runtime, initializeLanguage: true });
		cleanups.push(listener.dispose);
		const respond = vi.fn();
		expect(listener({ type: MESSAGE.FILL_CODE, nonce: NONCE }, { id: fixture.runtime.id }, respond)).toBe(true);
		await Promise.resolve();
		expect(respond).not.toHaveBeenCalled();
		resolveLanguage({ ok: true, data: { preference: 'en', language: 'en' } });
		await vi.waitFor(() =>
			expect(respond).toHaveBeenCalledWith({
				ok: false,
				error: { code: 'NONCE_INVALID', message: 'This fill request does not exist or has already been used' },
			}),
		);
	});
});
