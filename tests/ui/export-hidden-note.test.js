// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getExportCode } from '../../src/ui/scripts/export.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const ACCOUNT = {
	id: 'a',
	name: 'Example',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};
const INVALID = { id: 'b', name: 'Broken', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP', digits: 7 };

let modalMarkup;

async function flush() {
	for (let i = 0; i < 50; i++) {
		await Promise.resolve();
	}
}

// The real account read, export dialog and translations; the network is stubbed.
async function harness(serverList, { online = true } = {}) {
	if (!modalMarkup) {
		const template = document.createElement('template');
		template.innerHTML = await (await createMainPage()).text();
		modalMarkup = template.content.querySelector('#exportFormatModal').outerHTML;
	}
	localStorage.setItem('language', 'zh-CN');
	document.body.innerHTML = '<div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div>' + modalMarkup;
	const fetch = vi.fn(async (url) => ({
		ok: true,
		status: 200,
		headers: new Headers(),
		json: async () => (String(url).startsWith('/api/settings') ? { defaultExportFormat: 'html' } : serverList),
	}));
	const toast = vi.fn();
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'localStorage',
		'navigator',
		'console',
		'setInterval',
		'fetchStub',
		'toastStub',
		`
		${getI18nCode()}${getSharedTransferMessageLocalizerCode()}${getUtilsCode()}${getStateCode()}
		${getCoreCode()}
		${getExportCode()}
		authenticatedFetch = fetchStub;
		ensureServerTimeSynchronized = async () => true;
		renderSecrets = async () => {};
		showCenterToast = toastStub;
		disableBodyScroll = () => {};
		enableBodyScroll = () => {};
		return { loadSecrets, exportAllSecrets, hideExportFormatModal, setLanguage, invalidateSecretSession };
	`,
	)(document, window, localStorage, { language: 'zh-CN', onLine: online }, { log() {}, warn() {}, error() {} }, vi.fn(), fetch, toast);
	return { ...api, fetch, toast, note: () => document.getElementById('exportHiddenNote') };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
	localStorage.clear();
});

describe('export dialog and accounts hidden for invalid data', () => {
	it('says how many accounts will not be exported', async () => {
		const h = await harness([ACCOUNT, INVALID]);
		await h.loadSecrets();
		h.exportAllSecrets();
		await flush();

		expect(document.getElementById('exportCount').textContent).toBe('1');
		expect(h.note().hidden).toBe(false);
		expect(h.note().textContent).toBe(LOCALES['zh-CN'].transferExportHiddenNote.replace('{count}', '1'));

		h.setLanguage('en');
		expect(h.note().textContent).toBe(
			'1 account(s) with invalid data or unsupported OTP parameters are not shown and will not be included in this export.',
		);
	});

	it('shows no note when every account is exported', async () => {
		const h = await harness([ACCOUNT]);
		await h.loadSecrets();
		h.exportAllSecrets();
		await flush();
		expect(h.note().hidden).toBe(true);
	});

	it('keeps reporting the hidden accounts on a page opened offline from the local copy', async () => {
		const online = await harness([ACCOUNT, INVALID]);
		await online.loadSecrets();
		expect(JSON.parse(localStorage.getItem('2fa-secrets-cache')).hiddenCount).toBe(1);

		const offline = await harness([], { online: false });
		await offline.loadSecrets();
		expect(offline.fetch).not.toHaveBeenCalledWith('/api/secrets', expect.anything());
		expect(offline.toast).toHaveBeenCalledExactlyOnceWith('⚠️', LOCALES['zh-CN'].coreInvalidRecordsHidden.replace('{count}', '1'));
		offline.exportAllSecrets();
		await flush();
		expect(document.getElementById('exportCount').textContent).toBe('1');
		expect(offline.note().hidden).toBe(false);
		expect(offline.note().textContent).toBe(LOCALES['zh-CN'].transferExportHiddenNote.replace('{count}', '1'));
	});

	it('does not repeat the notice when the server confirms the count of the local copy', async () => {
		const first = await harness([ACCOUNT, INVALID]);
		await first.loadSecrets();

		const reopened = await harness([ACCOUNT, INVALID]);
		await reopened.loadSecrets();
		expect(reopened.fetch).toHaveBeenCalledWith('/api/secrets', expect.anything());
		expect(reopened.toast).toHaveBeenCalledOnce();
	});

	it.each([
		['no count', undefined],
		['a negative count', -2],
		['a fractional count', 1.5],
		['a text count', '3'],
	])('shows no note offline for a local copy with %s', async (_label, hiddenCount) => {
		localStorage.setItem('2fa-secrets-cache', JSON.stringify({ data: [ACCOUNT], timestamp: 1, hiddenCount }));
		const offline = await harness([], { online: false });
		await offline.loadSecrets();
		offline.exportAllSecrets();
		await flush();
		expect(offline.toast).not.toHaveBeenCalled();
		expect(offline.note()?.hidden ?? true).toBe(true);
	});

	it('forgets the count of a previous login', async () => {
		const h = await harness([ACCOUNT, INVALID]);
		await h.loadSecrets();
		h.invalidateSecretSession({ blocked: false });
		h.exportAllSecrets();
		await flush();
		expect(h.note()?.hidden ?? true).toBe(true);
	});
});
