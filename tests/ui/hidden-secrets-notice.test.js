// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getHiddenSecretsCode } from '../../src/ui/scripts/hiddenSecrets.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const zh = LOCALES['zh-CN'];
const ACCOUNT = { id: 'a', name: 'Example', account: 'alice', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1' };
const UNSUPPORTED = { id: 'b', name: 'Legacy bank', account: 'bob', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP', digits: 7 };
const BROKEN = { id: 'c', name: 'Broken', secret: 'not base32!' };
const DUPLICATE = { id: 'a', name: 'Copy of Example', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP', digits: 6 };
const NUMERIC = { id: 7, name: 'Numeric', secret: 'JBSWY3DPEHPK3PXP', type: 'STEAM' };

let noticeMarkup;

async function flush() {
	for (let i = 0; i < 50; i++) {
		await Promise.resolve();
	}
}

// deleteGate holds the DELETE response after the server has deleted the
// account; readGate(n) may hold the response of the nth list read, which
// reports the list as it was when the read arrived.
async function harness(serverList, { deleteStatus = 200, confirm = true, deleteGate = null, readGate = () => null } = {}) {
	if (!noticeMarkup) {
		const template = document.createElement('template');
		template.innerHTML = await (await createMainPage()).text();
		noticeMarkup = template.content.querySelector('#hiddenSecrets').outerHTML;
	}
	localStorage.setItem('language', 'zh-CN');
	document.body.innerHTML = noticeMarkup + '<div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div>';
	let list = serverList;
	let reads = 0;
	const fetch = vi.fn(async (url, options = {}) => {
		if (options.method === 'DELETE') {
			const id = decodeURIComponent(String(url).split('/').pop());
			if (deleteStatus === 200) {
				list = list.filter((item) => item.id !== id);
			}
			await deleteGate;
			return { ok: deleteStatus === 200, status: deleteStatus, headers: new Headers(), json: async () => ({ success: true }) };
		}
		const snapshot = list;
		await readGate(++reads);
		return { ok: true, status: 200, headers: new Headers(), json: async () => snapshot };
	});
	const toast = vi.fn();
	const confirmDialog = vi.fn(async () => confirm);
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
		'confirmStub',
		`
		${getI18nCode()}${getSharedTransferMessageLocalizerCode()}${getUtilsCode()}${getStateCode()}
		${getCoreCode()}
		${getHiddenSecretsCode()}
		authenticatedFetch = fetchStub;
		ensureServerTimeSynchronized = async () => true;
		renderSecrets = async () => {};
		showCenterToast = toastStub;
		showConfirmDialog = confirmStub;
		return { loadSecrets, setLanguage, invalidateSecretSession, getHiddenSecretsCount, toggleHiddenSecretsDetails };
	`,
	)(document, window, localStorage, { language: 'zh-CN', onLine: true }, { log() {}, warn() {}, error() {} }, vi.fn(), fetch, toast, confirmDialog);
	const bar = () => document.getElementById('hiddenSecrets');
	const items = () => [...document.querySelectorAll('#hiddenSecretsList li')];
	return { ...api, fetch, toast, confirmDialog, bar, items, toggle: () => document.getElementById('hiddenSecretsToggle') };
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('notice for accounts the page does not show', () => {
	it('stays hidden when every account is shown', async () => {
		const h = await harness([ACCOUNT]);
		await h.loadSecrets();
		expect(h.bar().hidden).toBe(true);
	});

	it('lists the hidden accounts with the reason and deletes one after confirmation', async () => {
		const h = await harness([ACCOUNT, UNSUPPORTED, BROKEN]);
		await h.loadSecrets();
		expect(h.bar().hidden).toBe(false);
		expect(document.getElementById('hiddenSecretsSummary').textContent).toBe(zh.coreInvalidRecordsHidden.replace('{count}', '2'));
		expect(h.items()).toHaveLength(0);

		h.toggleHiddenSecretsDetails();
		expect(h.toggle().getAttribute('aria-expanded')).toBe('true');
		expect(h.items().map((item) => item.querySelector('.offline-queue-label').textContent)).toEqual([
			'Legacy bank · bob' + zh.hiddenSecretUnsupported,
			'Broken' + zh.hiddenSecretInvalid,
		]);

		h.items()[0].querySelector('button').click();
		await flush();
		expect(h.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ danger: true, message: zh.hiddenSecretDeleteConfirm.replace('{name}', 'Legacy bank') }));
		expect(h.fetch).toHaveBeenCalledWith('/api/secrets/b', { method: 'DELETE' });
		expect(h.toast).toHaveBeenCalledWith('✅', zh.hiddenSecretDeleted);
		expect(h.getHiddenSecretsCount()).toBe(1);
		expect(JSON.parse(localStorage.getItem('2fa-secrets-cache')).hiddenCount).toBe(1);
		expect(h.items().map((item) => item.querySelector('.offline-queue-label').firstChild.textContent)).toEqual(['Broken']);

		h.items()[0].querySelector('button').click();
		await flush();
		expect(h.bar().hidden).toBe(true);
		expect(JSON.parse(localStorage.getItem('2fa-secrets-cache')).hiddenCount ?? 0).toBe(0);
	});

	it('does not offer to delete a record whose id is repeated or not text', async () => {
		const h = await harness([ACCOUNT, DUPLICATE, NUMERIC]);
		await h.loadSecrets();
		h.toggleHiddenSecretsDetails();
		expect(h.items()).toHaveLength(2);
		for (const item of h.items()) {
			expect(item.querySelector('button')).toBeNull();
		}
		expect(h.items()[0].textContent).toContain(zh.hiddenSecretNotDeletable);
	});

	it('keeps the account when the deletion is cancelled or fails', async () => {
		const cancelled = await harness([ACCOUNT, UNSUPPORTED], { confirm: false });
		await cancelled.loadSecrets();
		cancelled.toggleHiddenSecretsDetails();
		cancelled.items()[0].querySelector('button').click();
		await flush();
		expect(cancelled.fetch).not.toHaveBeenCalledWith(expect.anything(), { method: 'DELETE' });
		expect(cancelled.items()).toHaveLength(1);

		const failing = await harness([ACCOUNT, UNSUPPORTED], { deleteStatus: 500 });
		await failing.loadSecrets();
		failing.toggleHiddenSecretsDetails();
		failing.items()[0].querySelector('button').click();
		await flush();
		expect(failing.toast).toHaveBeenCalledWith('❌', zh.coreDeleteRetry);
		expect(failing.getHiddenSecretsCount()).toBe(1);
		expect(failing.items()).toHaveLength(1);
	});

	it('keeps the count of a read that already left out the deleted account', async () => {
		let answer;
		const h = await harness([ACCOUNT, UNSUPPORTED, BROKEN], { deleteGate: new Promise((resolve) => (answer = resolve)) });
		await h.loadSecrets();
		h.toggleHiddenSecretsDetails();
		h.items()[0].querySelector('button').click();
		await flush();
		// The server has deleted it; a refresh arrives before the delete's own response.
		await h.loadSecrets();
		expect(h.getHiddenSecretsCount()).toBe(1);

		answer();
		await flush();
		expect(h.getHiddenSecretsCount()).toBe(1);
		expect(h.bar().hidden).toBe(false);
		expect(JSON.parse(localStorage.getItem('2fa-secrets-cache')).hiddenCount).toBe(1);
		expect(h.items().map((item) => item.querySelector('.offline-queue-label').firstChild.textContent)).toEqual(['Broken']);
	});

	it('ignores a read that started before the deletion', async () => {
		let answer;
		const held = new Promise((resolve) => (answer = resolve));
		const h = await harness([ACCOUNT, UNSUPPORTED], { readGate: (n) => (n === 2 ? held : null) });
		await h.loadSecrets();
		h.toggleHiddenSecretsDetails();
		const stale = h.loadSecrets();
		await flush();
		h.items()[0].querySelector('button').click();
		await flush();
		expect(h.getHiddenSecretsCount()).toBe(0);

		answer();
		await stale;
		await flush();
		expect(h.getHiddenSecretsCount()).toBe(0);
		expect(h.bar().hidden).toBe(true);
		expect(JSON.parse(localStorage.getItem('2fa-secrets-cache')).hiddenCount ?? 0).toBe(0);
	});

	it('follows the interface language and disappears when the session ends', async () => {
		const h = await harness([ACCOUNT, UNSUPPORTED]);
		await h.loadSecrets();
		h.toggleHiddenSecretsDetails();
		h.setLanguage('en');
		expect(document.getElementById('hiddenSecretsSummary').textContent).toBe(
			'1 account(s) with invalid data or unsupported OTP parameters are not shown. The data on the server was not changed.',
		);
		expect(h.items()[0].textContent).toContain('Unsupported OTP parameters');
		expect(h.toggle().textContent).toBe('Collapse');

		h.invalidateSecretSession();
		expect(h.bar().hidden).toBe(true);
	});
});
