// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUICode } from '../../src/ui/scripts/ui.js';

const text = LOCALES['zh-CN'];
const ACCOUNT = {
	id: 'account-a',
	name: 'Example',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
	counter: 0,
};
const stoppedEdit = (changes = {}) => ({
	id: 'stopped',
	type: 'UPDATE',
	targetId: 'account-a',
	reason: 'Rejected',
	data: { ...ACCOUNT, name: 'Corrected' },
	...changes,
});

let pageMarkup;

async function flush() {
	for (let i = 0; i < 30; i++) {
		await Promise.resolve();
	}
}

// The emitted dialog and save code with the page's account form. The queue
// claim, release and removal are the page's worker messages, stubbed here.
async function harness({ claim = 'claimed', response = null } = {}) {
	if (!pageMarkup) {
		const template = document.createElement('template');
		template.innerHTML = await (await createMainPage()).text();
		pageMarkup = template.content.querySelector('#secretModal').outerHTML;
	}
	document.body.innerHTML = pageMarkup;
	const fetch = vi.fn(async (url, options) => {
		if (response) {
			return response;
		}
		const body = JSON.parse(options.body);
		const id = options.method === 'PUT' ? decodeURIComponent(url.split('/').pop()) : 'new-account';
		return { ok: true, status: 200, json: async () => ({ data: { secret: { ...body, id } } }) };
	});
	const toast = vi.fn();
	const queue = {
		claim: vi.fn(async () => claim),
		release: vi.fn(async () => {}),
		discard: vi.fn(async () => true),
	};
	const values = new Map([['language', 'zh-CN']]);
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: (key) => values.delete(key),
	};
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'authenticatedFetch',
		'toast',
		'console',
		'localStorage',
		'navigator',
		'claimOfflineQueueOperation',
		'releaseOfflineQueueOperation',
		'discardReplacedOfflineQueueOperation',
		'confirmDialog',
		`
		${getI18nCode()}
		${getStateCode()}
		${getUICode()}
		${getCoreCode()}
		renderSecrets = async () => {};
		showCenterToast = toast;
		disableBodyScroll = () => {};
		enableBodyScroll = () => {};
		showConfirmDialog = confirmDialog;
		return { handleSubmit, showQueuedSecretEditor, editSecret, deleteSecret, hideSecretModal, setSecrets(value) { secrets = value; },
			dialogOpen: () => secretDialogOpen, queuedOperation: () => secretDialogQueuedOperationId };
	`,
	)(
		document,
		window,
		fetch,
		toast,
		{ log() {}, warn() {}, error() {} },
		storage,
		{ language: 'zh-CN', onLine: true },
		queue.claim,
		queue.release,
		queue.discard,
		async () => true,
	);
	api.setSecrets([{ ...ACCOUNT }]);
	return {
		...api,
		fetch,
		toast,
		queue,
		submit: async () => {
			await api.handleSubmit({ preventDefault() {} });
			await flush();
		},
		title: () => document.getElementById('modalTitle').textContent,
		field: (id) => document.getElementById(id).value,
		// Starts a save whose claim answers only when resolved; the returned
		// function answers it and waits for the save to finish.
		startSaveWithPendingClaim() {
			let answer;
			queue.claim.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
			const saving = api.handleSubmit({ preventDefault() {} });
			return async (outcome) => {
				await flush();
				answer(outcome);
				await saving;
				await flush();
			};
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('correcting a stopped offline edit whose account was deleted', () => {
	it('opens it as a new account, explains why and never sends an edit to the missing account', async () => {
		const h = await harness();
		expect(h.showQueuedSecretEditor(stoppedEdit({ targetMissing: true }))).toBe(true);
		expect(h.toast).toHaveBeenCalledWith('⚠️', text.coreQueuedTargetMissing);
		expect(h.title()).toBe(text.addSecretTitle);

		await h.submit();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets');
		expect(h.fetch.mock.calls[0][1].method).toBe('POST');
		expect(h.queue.discard).toHaveBeenCalledExactlyOnceWith('stopped');
	});

	it('still edits the account when the server did not report it missing', async () => {
		const h = await harness();
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/account-a');
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
	});
});

describe('correcting a stopped offline addition the server already has with other parameters', () => {
	it('opens it as a new account and explains the conflict instead of the plain server reason', async () => {
		const h = await harness();
		const detail = { id: 'stopped', type: 'ADD', duplicateDiffers: true, reason: 'Already exists', data: { ...ACCOUNT, digits: 8 } };
		expect(h.showQueuedSecretEditor(detail)).toBe(true);
		expect(h.title()).toBe(text.addSecretTitle);
		expect(h.field('secretDigits')).toBe('8');
		expect(h.toast).toHaveBeenCalledExactlyOnceWith('⚠️', text.offlineQueueDuplicateDiffers);
	});

	it('keeps the server reason when the server did not compare the parameters', async () => {
		const h = await harness();
		h.showQueuedSecretEditor({ id: 'stopped', type: 'ADD', reason: 'Already exists', data: { ...ACCOUNT } });
		expect(h.toast).toHaveBeenCalledExactlyOnceWith('⚠️', 'Already exists');
	});
});

describe('saving the corrected copy of a stopped change', () => {
	it('claims the stopped change first and removes it after the save', async () => {
		const h = await harness();
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();

		expect(h.queue.claim).toHaveBeenCalledExactlyOnceWith('stopped');
		expect(h.queue.claim.mock.invocationCallOrder[0]).toBeLessThan(h.fetch.mock.invocationCallOrder[0]);
		expect(h.queue.discard).toHaveBeenCalledExactlyOnceWith('stopped');
		expect(h.queue.release).not.toHaveBeenCalled();
	});

	it('saves nothing and says so while another tab is syncing or saving the same change', async () => {
		const h = await harness({ claim: 'busy' });
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.queue.discard).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenLastCalledWith('⚠️', text.coreQueuedChangeBusy);
		expect(h.dialogOpen()).toBe(true);
		expect(h.queuedOperation()).toBe('stopped');
	});

	it('saves nothing when another tab already handled it, then saves an ordinary change on request', async () => {
		const h = await harness({ claim: 'gone' });
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenLastCalledWith('⚠️', text.coreQueuedChangeGone);
		expect(h.dialogOpen()).toBe(true);

		await h.submit();
		expect(h.queue.claim).toHaveBeenCalledOnce();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
		expect(h.queue.discard).not.toHaveBeenCalled();
	});

	it('releases the claim when the corrected copy is rejected', async () => {
		const h = await harness({ response: { ok: false, status: 400, json: async () => ({ message: 'Invalid' }) } });
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();

		expect(h.toast).toHaveBeenLastCalledWith('❌', 'Invalid');
		expect(h.queue.release).toHaveBeenCalledExactlyOnceWith('stopped');
		expect(h.queue.discard).not.toHaveBeenCalled();
	});

	it('goes ahead as before when the worker cannot be asked', async () => {
		const h = await harness({ claim: 'unavailable' });
		h.showQueuedSecretEditor(stoppedEdit());
		await h.submit();

		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.queue.discard).toHaveBeenCalledExactlyOnceWith('stopped');
		expect(h.queue.release).not.toHaveBeenCalled();
	});
});

describe('closing the dialog while the corrected copy is being saved', () => {
	it('reopens the correction when another tab is syncing or saving the same change', async () => {
		const h = await harness();
		h.showQueuedSecretEditor(stoppedEdit());
		document.getElementById('secretName').value = 'Corrected again';
		const answerClaim = h.startSaveWithPendingClaim();
		h.hideSecretModal();
		h.toast.mockClear();
		await answerClaim('busy');

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.dialogOpen()).toBe(true);
		expect(h.title()).toBe(text.editSecretTitle);
		expect(h.field('secretName')).toBe('Corrected again');
		expect(h.queuedOperation()).toBe('stopped');
		expect(h.toast).toHaveBeenCalledExactlyOnceWith('⚠️', text.coreQueuedChangeBusy);

		// Saving the reopened correction replaces the stopped change as before.
		await h.submit();
		expect(h.queue.claim).toHaveBeenCalledTimes(2);
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(JSON.parse(h.fetch.mock.calls[0][1].body).name).toBe('Corrected again');
		expect(h.queue.discard).toHaveBeenCalledExactlyOnceWith('stopped');
	});

	it('reopens the correction as an ordinary change when another tab already handled it', async () => {
		const h = await harness();
		h.showQueuedSecretEditor(stoppedEdit());
		const answerClaim = h.startSaveWithPendingClaim();
		h.hideSecretModal();
		h.toast.mockClear();
		await answerClaim('gone');

		expect(h.dialogOpen()).toBe(true);
		expect(h.field('secretName')).toBe('Corrected');
		expect(h.queuedOperation()).toBeNull();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith('⚠️', text.coreQueuedChangeGone);

		await h.submit();
		expect(h.queue.claim).toHaveBeenCalledOnce();
		expect(h.fetch).toHaveBeenCalledOnce();
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
		expect(h.queue.discard).not.toHaveBeenCalled();
	});

	it.each([
		['busy', 'coreQueuedChangeBusy'],
		['gone', 'coreQueuedCorrectionDiscarded'],
	])('leaves a dialog opened meanwhile alone and says the correction was not saved (%s)', async (outcome, message) => {
		const h = await harness();
		h.showQueuedSecretEditor(stoppedEdit());
		const answerClaim = h.startSaveWithPendingClaim();
		h.hideSecretModal();
		h.editSecret(ACCOUNT.id);
		h.toast.mockClear();
		await answerClaim(outcome);

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.dialogOpen()).toBe(true);
		expect(h.field('secretName')).toBe(ACCOUNT.name);
		expect(h.queuedOperation()).toBeNull();
		expect(h.toast).toHaveBeenCalledExactlyOnceWith('⚠️', text[message]);
	});
});

describe('account ids with / % ? #', () => {
	const id = 'a/b%c?d#e';

	it('encodes the id when an edit is saved', async () => {
		const h = await harness();
		h.setSecrets([{ ...ACCOUNT, id }]);
		h.editSecret(id);
		await h.submit();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a%2Fb%25c%3Fd%23e');
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
	});

	it('encodes the id when an account is deleted', async () => {
		const h = await harness({ response: { ok: true, status: 200, json: async () => ({ success: true }) } });
		h.setSecrets([{ ...ACCOUNT, id }]);
		await h.deleteSecret(id);
		await flush();
		expect(h.fetch.mock.calls[0][0]).toBe('/api/secrets/a%2Fb%25c%3Fd%23e');
		expect(h.fetch.mock.calls[0][1].method).toBe('DELETE');
	});
});
