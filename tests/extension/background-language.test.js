import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE, getErrorResponse } from '../../extension/src/shared/protocol.js';
import { ERROR_LOCALES } from '../../extension/src/locales/errors.js';
import { ExtensionError, throwFromResponse } from '../../extension/src/background/errors.js';
import { BridgeError, listTotpAccounts, serializeBridgeError } from '../../extension/src/bridge/api.js';
import { localizedError } from '../../extension/src/shared/localized-error.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../extension/src/locales/index.js';

vi.mock('../../extension/src/background/autofill-registration.js', () => ({
	reconcileAutofillScripts: vi.fn(async () => {}),
	observeAutofillRenderer: vi.fn(),
}));
vi.mock('../../extension/src/background/source-registration.js', () => ({
	reconcileSourceWatcher: vi.fn(async () => {}),
	observeSourceRenderer: vi.fn(),
}));
vi.mock('../../extension/src/background/source-updates.js', () => ({
	SOURCE_MESSAGES: [],
	startSourceUpdates: vi.fn(),
	routeSourceMessage: vi.fn(),
}));
const flows = vi.hoisted(() => ({ invalidateAutomaticFlows: vi.fn(), startFlow: vi.fn() }));
vi.mock('../../extension/src/background/automatic-workflow.js', () => ({
	AUTO_MESSAGES: [],
	invalidateAutomaticFlows: flows.invalidateAutomaticFlows,
	routeAutomaticMessage: vi.fn(),
}));
vi.mock('../../extension/src/background/autofill-authorization.js', () => ({
	beginAutofillAuthorization: vi.fn(),
	completeAutofillAuthorization: vi.fn(async () => ({ status: 'cancelled' })),
	cancelAutofillAuthorization: vi.fn(),
	clearAutofillAuthorization: vi.fn(),
}));
vi.mock('../../extension/src/background/workflow.js', async () => ({
	ExtensionError: (await import('../../extension/src/background/errors.js')).ExtensionError,
	startFlow: flows.startFlow,
}));
vi.mock('../../extension/src/background/offline-source.js', () => ({
	clearOfflineSource: vi.fn(),
	cancelOfflineRequests: vi.fn(),
}));

let values;
let onMessage;
let browserLanguage;
const INSTANCE = 'https://vault.example';
const TARGET = 'https://login.example';

function pageSender() {
	return { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') };
}
function contentSender(overrides = {}) {
	return { id: chrome.runtime.id, url: `${TARGET}/login`, frameId: 0, tab: { id: 7, url: `${TARGET}/login` }, ...overrides };
}
function send(message, sender = pageSender()) {
	return new Promise((resolve) => {
		if (!onMessage(message, sender, resolve)) {
			resolve(undefined);
		}
	});
}

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	values = {
		settings: { instanceOrigin: INSTANCE },
		favorites: [{ instanceOrigin: INSTANCE, accountId: 'a' }],
		offlineInstances: [INSTANCE],
	};
	browserLanguage = 'en-US';
	globalThis.chrome = {
		i18n: { getUILanguage: () => browserLanguage },
		runtime: {
			id: 'extension-id',
			getURL: (path) => `chrome-extension://extension-id/${path}`,
			onMessage: {
				addListener: (listener) => {
					onMessage = listener;
				},
			},
			onInstalled: { addListener: vi.fn() },
			sendMessage: vi.fn(async () => {}),
		},
		storage: {
			local: {
				get: vi.fn(async (keys) =>
					Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(values[key])])),
				),
				set: vi.fn(async (entries) => Object.assign(values, structuredClone(entries))),
				setAccessLevel: vi.fn(async () => {}),
			},
			session: { setAccessLevel: vi.fn(async () => {}) },
		},
		commands: { onCommand: { addListener: vi.fn() } },
		permissions: {
			onRemoved: { addListener: vi.fn() },
			onAdded: { addListener: vi.fn() },
			contains: vi.fn(async ({ origins }) => origins[0] === `${TARGET}/*`),
			request: vi.fn(),
		},
		tabs: {
			query: vi.fn(async () => [
				{ id: 7, url: `${TARGET}/login` },
				{ id: 8, url: 'https://ungranted.example/' },
				{ id: 9, url: 'chrome://settings' },
				{ id: 10, url: `${TARGET}/login`, incognito: true },
			]),
			sendMessage: vi.fn(async () => {}),
		},
	};
	await import('../../extension/src/background/index.js');
});
afterEach(() => {
	delete globalThis.chrome;
});

describe('language messages and sender boundaries', () => {
	it.each(SUPPORTED_LANGUAGES)('saves %s without changing account state or requesting access', async (language) => {
		const original = structuredClone(values);
		const response = await send({ type: MESSAGE.SAVE_LANGUAGE, preference: language });
		expect(response).toEqual({ ok: true, data: { preference: language, language } });
		expect(values).toEqual({ ...original, language });
		expect((await send({ type: MESSAGE.GET_LANGUAGE }, contentSender())).data).toEqual({ preference: language, language });
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		expect(flows.invalidateAutomaticFlows).not.toHaveBeenCalled();
		expect(flows.startFlow).not.toHaveBeenCalled();
	});
	it('uses English when the browser language is unsupported', async () => {
		browserLanguage = 'ar-SA';
		expect(await send({ type: MESSAGE.GET_LANGUAGE })).toEqual({ ok: true, data: { preference: 'auto', language: 'en' } });
	});
	it('lets extension pages and eligible contents read only the resolved preference without account work', async () => {
		for (const sender of [pageSender(), contentSender()]) {
			expect(await send({ type: MESSAGE.GET_LANGUAGE }, sender)).toEqual({ ok: true, data: { preference: 'auto', language: 'en' } });
		}
		expect(flows.startFlow).not.toHaveBeenCalled();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
		expect(await send({ type: MESSAGE.GET_SETTINGS }, contentSender())).toBeUndefined();
		expect(await send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'en' }, contentSender())).toBeUndefined();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});
	it.each([
		{ id: 'other-extension' },
		{ url: 'chrome://settings' },
		{ url: 'https://elsewhere.example' },
		{ frameId: 1 },
		{ tab: { id: -1, url: TARGET } },
		{ tab: { id: 7, url: TARGET, incognito: true } },
		{ tab: { id: 7, url: TARGET, pendingUrl: 'https://elsewhere.example' } },
		{ tab: undefined },
	])('rejects a non-content sender %j', async (overrides) => {
		expect(await send({ type: MESSAGE.GET_LANGUAGE }, contentSender(overrides))).toBeUndefined();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});
	it('saves and broadcasts only to extension views and already authorized non-private tabs', async () => {
		const original = structuredClone(values);
		const result = await send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'zh-TW' });
		expect(result).toEqual({ ok: true, data: { preference: 'zh-TW', language: 'zh-TW' } });
		const update = { type: MESSAGE.LANGUAGE_CHANGED, preference: 'zh-TW', language: 'zh-TW' };
		expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith(update);
		expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(7, update);
		expect(values).toEqual({ ...original, language: 'zh-TW' });
		expect(flows.invalidateAutomaticFlows).not.toHaveBeenCalled();
		expect(chrome.permissions.request).not.toHaveBeenCalled();
		for (const area of [chrome.storage.local, chrome.storage.session]) {
			expect(area.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
		}
	});
	it('serializes simultaneous language changes and returns the last saved language after them', async () => {
		const first = send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'zh-TW' });
		const second = send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'en' });
		await Promise.all([first, second]);
		expect((await send({ type: MESSAGE.GET_LANGUAGE }, contentSender())).data).toEqual({ preference: 'en', language: 'en' });
		expect(chrome.runtime.sendMessage.mock.calls.map(([message]) => message.preference)).toEqual(['zh-TW', 'en']);
	});
	it('survives unavailable receivers while preserving the saved preference', async () => {
		chrome.runtime.sendMessage.mockRejectedValue(new Error('No receiver'));
		chrome.tabs.sendMessage.mockRejectedValue(new Error('No content script'));
		expect(await send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'en' })).toMatchObject({ ok: true });
		expect(values.language).toBe('en');
	});
	it('rejects malformed preferences using the currently saved language without broadcasts', async () => {
		values.language = 'en';
		expect(await send({ type: MESSAGE.SAVE_LANGUAGE, preference: { language: 'zh-CN' } })).toEqual({
			ok: false,
			error: { code: 'INVALID_REQUEST', messageKey: 'error_LANGUAGE_INVALID', message: 'The language preference is invalid' },
		});
		expect(values.language).toBe('en');
		expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
	});
	it('uses the current preference for worker errors and browser language for auto without global locale mutation', async () => {
		flows.startFlow.mockRejectedValue(new ExtensionError('AUTH_REQUIRED'));
		for (const language of SUPPORTED_LANGUAGES) {
			values.language = language;
			expect((await send({ type: MESSAGE.START_FLOW })).error.message).toBe(LOCALES[language].error_AUTH_REQUIRED);
		}
		values.language = 'auto';
		browserLanguage = 'zh-HK';
		expect((await send({ type: MESSAGE.START_FLOW })).error.message).toBe(ERROR_LOCALES['zh-TW'].error_AUTH_REQUIRED);
	});
	it.each(SUPPORTED_LANGUAGES)('falls back to browser language %s when preference storage is unavailable', async (language) => {
		browserLanguage = language;
		flows.startFlow.mockRejectedValue(new ExtensionError('AUTH_REQUIRED'));
		const originalGet = chrome.storage.local.get.getMockImplementation();
		chrome.storage.local.get.mockImplementation(async (key) => {
			if (key === 'language') {
				throw new Error('Storage unavailable');
			}
			return originalGet(key);
		});
		expect((await send({ type: MESSAGE.START_FLOW })).error.message).toBe(LOCALES[language].error_AUTH_REQUIRED);
	});
	it('uses the newly saved language for an operation that started before a language change', async () => {
		values.language = 'zh-CN';
		let rejectFlow;
		flows.startFlow.mockReturnValueOnce(
			new Promise((resolve, reject) => {
				rejectFlow = reject;
			}),
		);
		const pending = send({ type: MESSAGE.START_FLOW });
		await vi.waitFor(() => expect(flows.startFlow).toHaveBeenCalledOnce());
		expect(await send({ type: MESSAGE.SAVE_LANGUAGE, preference: 'en' })).toMatchObject({ ok: true });
		rejectFlow(new ExtensionError('AUTH_REQUIRED'));
		expect((await pending).error.message).toBe(ERROR_LOCALES.en.error_AUTH_REQUIRED);
	});
});

describe('localized public errors and diagnostic metadata', () => {
	it.each([
		'INVALID_MESSAGE',
		'NONCE_REUSED',
		'NONCE_INVALID',
		'NONCE_EXPIRED',
		'PENDING_LIMIT',
		'INVALID_CODE',
		'DIGIT_MISMATCH',
		'CONNECTION_FAILED',
	])('preserves content error %s through the background response boundary', (code) => {
		let forwarded;
		try {
			throwFromResponse({ ok: false, error: { code, message: ERROR_LOCALES['zh-CN'][`error_${code}`] } }, 'FILL_FAILED');
		} catch (error) {
			forwarded = error;
		}
		for (const language of ['en', 'zh-TW']) {
			expect(getErrorResponse(forwarded, language).error.message).toBe(ERROR_LOCALES[language][`error_${code}`]);
			expect(getErrorResponse(forwarded, language).error.messageKey).not.toBe('error_UNKNOWN_ERROR');
		}
	});
	it('preserves detailed error semantics and interpolation when serialized in any locale', () => {
		for (const language of ['en', 'zh-CN', 'zh-TW']) {
			const detailed = new ExtensionError('PERMISSION_REQUIRED', 'error_AUTOFILL_NOT_ENABLED');
			expect(getErrorResponse(detailed, language).error).toEqual({
				code: 'PERMISSION_REQUIRED',
				messageKey: 'error_AUTOFILL_NOT_ENABLED',
				message: ERROR_LOCALES[language].error_AUTOFILL_NOT_ENABLED,
			});
			const storageError = localizedError('error_STORAGE_UNAVAILABLE', 'UNKNOWN_ERROR', { area: 'local' });
			expect(getErrorResponse(storageError, language).error.message).toBe(
				ERROR_LOCALES[language].error_STORAGE_UNAVAILABLE.replace('{area}', 'local'),
			);
			const bridge = serializeBridgeError(new BridgeError('AUTH_REQUIRED'));
			expect(getErrorResponse(bridge, language).error.message).toBe(ERROR_LOCALES[language].error_AUTH_REQUIRED);
		}
	});
	it('does not expose raw diagnostics or an unknown translation key in public responses', () => {
		const error = Object.assign(new Error('secret=private'), { code: 'UNRECOGNIZED', messageKey: 'secret=private' });
		expect(getErrorResponse(error, 'en').error.message).toBe(ERROR_LOCALES.en.error_UNKNOWN_ERROR);
		expect(JSON.stringify(getErrorResponse(error, 'en'))).not.toContain('private');
	});
	it('distinguishes missing names from user names that happen to equal a translated placeholder', async () => {
		const result = await listTotpAccounts({
			instanceOrigin: INSTANCE,
			withDiagnostics: true,
			fetchImpl: async () => ({
				status: 200,
				headers: { get: () => 'application/json' },
				json: async () => [
					{ id: 'missing', secret: '!!!' },
					{ id: 'named', name: '未命名账户', secret: '!!!' },
				],
			}),
		});
		expect(result.unavailableAccounts).toEqual([
			{ id: 'missing', name: '', nameKey: 'error_UNNAMED_ACCOUNT', reason: 'invalid' },
			{ id: 'named', name: '未命名账户', reason: 'invalid' },
		]);
	});
});
