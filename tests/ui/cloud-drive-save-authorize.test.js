// "Save and authorize" in the OneDrive / Google Drive form saves the form before authorizing, for new and existing destinations.
import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getToolsCode } from '../../src/ui/scripts/tools.js';

const html = await (await createMainPage()).text();
const providers = [
	['OneDrive', 'oneDrive', 'onedrive'],
	['GoogleDrive', 'googleDrive', 'gdrive'],
];
const AUTHORIZE_URL = 'https://login.example/authorize?state=abc';

function harness(name, prefix, api) {
	const window = new Window({ url: 'https://2fa.example/', settings: { disableJavaScriptEvaluation: true } });
	const document = window.document;
	document.write(html);
	window.localStorage.setItem('language', 'en');
	const popup = { location: { href: '' }, close: vi.fn(), closed: false };
	window.open = vi.fn(() => popup);
	const context = createContext({
		window,
		document,
		localStorage: window.localStorage,
		navigator: { language: 'en' },
		HTMLElement: window.HTMLElement,
		URL,
		setTimeout,
		clearTimeout,
		clearInterval,
		requestAnimationFrame: vi.fn(),
		cancelAnimationFrame: vi.fn(),
		showCenterToast: vi.fn(),
		console: { log() {}, warn() {}, error() {} },
	});
	const state = {
		count: 1,
		maxAllowed: 5,
		oauthConfigured: true,
		destinations: [{ id: 'one', name: 'Work', enabled: false, authorized: true, config: { folderPath: '/old-path' }, status: {} }],
	};
	const requests = [];
	const responses = {
		save: () => ({ ok: true, json: async () => ({ success: true, id: 'one' }) }),
		start: () => ({ ok: true, json: async () => ({ success: true, authorizeUrl: AUTHORIZE_URL, callbackOrigin: 'https://2fa.example' }) }),
	};
	context.authenticatedFetch = vi.fn(async (url, options = {}) => {
		const method = options.method || 'GET';
		requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
		if (url === `/api/${api}/config` && method === 'POST') {
			return responses.save();
		}
		if (url === `/api/${api}/oauth/start`) {
			return responses.start();
		}
		return { ok: true, json: async () => state };
	});
	runInContext(getI18nCode() + getUtilsCode() + getToolsCode(), context);
	context.applyTranslations();
	const element = (id) => document.getElementById(id);
	return {
		context,
		state,
		popup,
		requests,
		responses,
		element,
		saves: () => requests.filter((request) => request.url === `/api/${api}/config` && request.method === 'POST'),
		starts: () => requests.filter((request) => request.url === `/api/${api}/oauth/start`),
		// Runs the form button's own onclick, so the test also covers the wiring in page.js.
		clickSaveAndAuthorize: () => runInContext(element(prefix + 'AuthorizeBtn').getAttribute('onclick'), context),
		editExisting: async () => {
			await context[`load${name}Destinations`]();
			await context[`edit${name}Dest`]('one');
			element(prefix + 'Name').value = 'Renamed';
			element(prefix + 'FolderPath').value = '/new-path';
		},
	};
}

describe.each(providers)('%s save and authorize', (name, prefix, api) => {
	it('saves the edited form of an existing destination before starting authorization', async () => {
		const h = harness(name, prefix, api);
		await h.editExisting();

		await h.clickSaveAndAuthorize();

		expect(h.saves().map((request) => request.body)).toEqual([{ id: 'one', name: 'Renamed', folderPath: '/new-path' }]);
		expect(h.starts().map((request) => request.body)).toEqual([{ id: 'one' }]);
		expect(h.requests.indexOf(h.saves()[0])).toBeLessThan(h.requests.indexOf(h.starts()[0]));
		expect(h.context.window.open).toHaveBeenCalledTimes(1);
		expect(h.popup.location.href).toBe(AUTHORIZE_URL);
	});

	it('falls back to a full-page redirect after saving when the popup is blocked', async () => {
		const h = harness(name, prefix, api);
		await h.editExisting();
		const location = { origin: 'https://2fa.example', href: 'https://2fa.example/' };
		h.context.window = { open: vi.fn(() => null), location };

		await h.clickSaveAndAuthorize();

		expect(h.saves()).toHaveLength(1);
		expect(h.starts()).toHaveLength(1);
		expect(location.href).toBe(AUTHORIZE_URL);
	});

	it('does not start authorization and reports the save error when saving fails', async () => {
		const h = harness(name, prefix, api);
		await h.editExisting();
		h.responses.save = () => ({ ok: false, json: async () => ({ success: false, message: 'Folder path is too long' }) });

		await h.clickSaveAndAuthorize();

		expect(h.saves()).toHaveLength(1);
		expect(h.starts()).toHaveLength(0);
		expect(h.context.window.open).not.toHaveBeenCalled();
		expect(h.context.showCenterToast).toHaveBeenCalledWith('❌', h.context.t('toolSyncSaveError', { message: 'Folder path is too long' }));
		const button = h.element(prefix + 'AuthorizeBtn');
		expect(button.disabled).toBe(false);
		expect(button.textContent).toBe(h.context.t('pageSaveAuthorize'));
	});

	it('keeps the form on another destination opened while the first one was saving', async () => {
		const h = harness(name, prefix, api);
		h.state.count = 2;
		h.state.destinations.push({ id: 'two', name: 'Home', enabled: true, authorized: true, config: { folderPath: '/home' }, status: {} });
		await h.editExisting();
		let finishSave;
		h.responses.save = () => new Promise((resolve) => (finishSave = resolve));
		h.responses.start = () => ({ ok: false, json: async () => ({ success: false, message: 'OAuth is not configured' }) });

		const authorizing = h.clickSaveAndAuthorize();
		// While the first destination is saving, the form is cancelled and the second one opened.
		h.context[`hide${name}Form`]();
		await h.context[`edit${name}Dest`]('two');
		finishSave({ ok: true, json: async () => ({ success: true, id: 'one' }) });
		await authorizing;

		expect(h.element(prefix + 'EditId').value).toBe('two');
		expect(h.element(prefix + 'Name').value).toBe('Home');
		h.responses.save = () => ({ ok: true, json: async () => ({ success: true, id: 'two' }) });
		await h.context[`save${name}Config`]();
		expect(h.saves().at(-1).body).toEqual({ id: 'two', name: 'Home', folderPath: '/home' });
	});

	it('updates the destination created by the first click when authorization is retried', async () => {
		const h = harness(name, prefix, api);
		await h.context[`load${name}Destinations`]();
		h.context[`show${name}Form`]();
		h.element(prefix + 'Name').value = 'Personal';
		h.responses.save = () => ({ ok: true, json: async () => ({ success: true, id: 'created' }) });
		h.responses.start = () => ({ ok: false, json: async () => ({ success: false, message: 'OAuth is not configured' }) });

		await h.clickSaveAndAuthorize();
		await h.clickSaveAndAuthorize();

		expect(h.saves().map((request) => request.body)).toEqual([
			{ name: 'Personal', folderPath: '/2FA-Backups' },
			{ id: 'created', name: 'Personal', folderPath: '/2FA-Backups' },
		]);
		expect(h.starts().map((request) => request.body)).toEqual([{ id: 'created' }, { id: 'created' }]);
	});

	it('reauthorizes from the destination card without saving the open form', async () => {
		const h = harness(name, prefix, api);
		await h.editExisting();
		const cardButton = h.element(prefix + 'DestinationList').querySelector('.dest-card .btn-info');
		const onclick = runInContext(`(function (event) { ${cardButton.getAttribute('onclick')} })`, h.context);

		onclick.call(cardButton, { stopPropagation() {} });

		await vi.waitFor(() => expect(h.popup.location.href).toBe(AUTHORIZE_URL));
		expect(h.starts().map((request) => request.body)).toEqual([{ id: 'one' }]);
		expect(h.saves()).toHaveLength(0);
	});
});
