// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getUICode } from '../../src/ui/scripts/ui.js';

const ACCOUNT = {
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

let pageMarkup;

async function flush() {
	for (let i = 0; i < 30; i++) {
		await Promise.resolve();
	}
}

// Runs the emitted dialog code against the real account form from the page,
// so the digits and period fields are the same <select> elements users see.
async function harness(accounts) {
	if (!pageMarkup) {
		const template = document.createElement('template');
		template.innerHTML = await (await createMainPage()).text();
		pageMarkup = template.content.querySelector('#secretModal').outerHTML;
	}
	document.body.innerHTML = pageMarkup;
	const fetch = vi.fn(async (url, options) => {
		const body = JSON.parse(options.body);
		const id = options.method === 'PUT' ? url.split('/').pop() : 'new';
		return { ok: true, status: 200, json: async () => ({ data: { secret: { ...body, id } } }) };
	});
	const toast = vi.fn();
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
		`
		${getI18nCode()}
		${getStateCode()}
		${getUICode()}
		${getCoreCode()}
		renderSecrets = async () => {};
		showCenterToast = toast;
		disableBodyScroll = () => {};
		enableBodyScroll = () => {};
		return { editSecret, showAddModal, hideSecretModal, handleSubmit, showQueuedSecretEditor,
			setSecrets(value) { secrets = value; } };
	`,
	)(document, window, fetch, toast, { log() {}, warn() {}, error() {} }, storage, { language: 'zh-CN', onLine: true });
	api.setSecrets(globalThis.structuredClone(accounts));
	return {
		...api,
		fetch,
		toast,
		submit: async () => {
			await api.handleSubmit({ preventDefault() {} });
			await flush();
		},
		select: (id) => document.getElementById(id),
		optionValues: (id) => [...document.getElementById(id).options].map((option) => option.value),
		sentBody: () => JSON.parse(fetch.mock.calls.at(-1)[1].body),
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('account form keeps stored values that its menus do not offer', () => {
	it('shows and saves an unchanged 45-second period instead of changing it to 30', async () => {
		const h = await harness([{ ...ACCOUNT, period: 45 }]);
		h.editSecret('a');

		expect(h.select('secretPeriod').value).toBe('45');
		expect(h.optionValues('secretPeriod')).toEqual(['30', '60', '120', '45']);
		await h.submit();

		expect(h.toast).not.toHaveBeenCalledWith('❌', expect.anything());
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(h.fetch.mock.calls[0][1].method).toBe('PUT');
		expect(h.sentBody().period).toBe(45);
	});

	it('saves an offered period when the user picks one for such an account', async () => {
		const h = await harness([{ ...ACCOUNT, period: 45 }]);
		h.editSecret('a');
		h.select('secretPeriod').value = '60';
		await h.submit();

		expect(h.sentBody().period).toBe(60);
	});

	it('removes the extra option when another account is opened or the dialog closes', async () => {
		const h = await harness([
			{ ...ACCOUNT, period: 45 },
			{ ...ACCOUNT, id: 'b', name: 'Account B' },
		]);
		h.editSecret('a');
		h.editSecret('b');
		expect(h.optionValues('secretPeriod')).toEqual(['30', '60', '120']);
		expect(h.select('secretPeriod').value).toBe('30');

		h.editSecret('a');
		h.hideSecretModal();
		// The value stays visible while the dialog fades out.
		expect(h.select('secretPeriod').value).toBe('45');
		vi.advanceTimersByTime(300);
		expect(h.optionValues('secretPeriod')).toEqual(['30', '60', '120']);

		h.showAddModal();
		expect(h.select('secretPeriod').value).toBe('30');
	});

	it('does not let a new account use a period only kept for existing accounts', async () => {
		const h = await harness([{ ...ACCOUNT, period: 45 }]);
		expect(h.showQueuedSecretEditor({ id: 'queued-add', type: 'ADD', data: { ...ACCOUNT, name: 'New', period: 45 } })).toBe(true);
		expect(h.select('secretPeriod').value).toBe('45');
		await h.submit();

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledWith('❌', 'TOTP周期仅支持30、60或120秒');
	});

	it('allows a corrected offline edit to keep the account period, but not a different unlisted one', async () => {
		const h = await harness([{ ...ACCOUNT, period: 45 }]);
		h.showQueuedSecretEditor({ id: 'queued-1', type: 'UPDATE', targetId: 'a', data: { ...ACCOUNT, name: 'Renamed', period: 45 } });
		await h.submit();
		expect(h.sentBody()).toMatchObject({ name: 'Renamed', period: 45 });

		h.showQueuedSecretEditor({ id: 'queued-2', type: 'UPDATE', targetId: 'a', data: { ...ACCOUNT, period: 90 } });
		expect(h.select('secretPeriod').value).toBe('90');
		await h.submit();
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(h.toast).toHaveBeenCalledWith('❌', 'TOTP周期仅支持30、60或120秒');
	});

	it('reports an unsupported digit count instead of silently saving 6 digits', async () => {
		const h = await harness([ACCOUNT]);
		h.showQueuedSecretEditor({ id: 'queued-1', type: 'UPDATE', targetId: 'a', data: { ...ACCOUNT, digits: 7 } });

		expect(h.select('secretDigits').value).toBe('7');
		await h.submit();
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledWith('❌', '验证码位数仅支持6位或8位');
	});

	it('keeps the type and algorithm of accounts saved in lower case or with a hyphen', async () => {
		const h = await harness([{ ...ACCOUNT, type: 'hotp', algorithm: 'SHA-256', counter: 4 }]);
		h.editSecret('a');

		expect(h.select('secretType').value).toBe('HOTP');
		expect(h.select('secretAlgorithm').value).toBe('SHA256');
		await h.submit();
		expect(h.sentBody()).toMatchObject({ type: 'HOTP', algorithm: 'SHA256', counter: 4 });
	});

	it('keeps the unlisted period of an HOTP account that stays HOTP', async () => {
		const h = await harness([{ ...ACCOUNT, type: 'HOTP', period: 45, counter: 3 }]);
		h.editSecret('a');
		await h.submit();
		expect(h.sentBody()).toMatchObject({ type: 'HOTP', period: 45, counter: 3 });
	});

	it('uses the default period once an account with an unlisted TOTP period becomes HOTP', async () => {
		const h = await harness([{ ...ACCOUNT, period: 45 }]);
		h.editSecret('a');
		h.select('secretType').value = 'HOTP';
		await h.submit();

		// The server keeps an unlisted period only for an unchanged type; HOTP does not use it.
		expect(h.toast).not.toHaveBeenCalledWith('❌', expect.anything());
		expect(h.sentBody()).toMatchObject({ type: 'HOTP', period: 30 });
	});

	it('keeps an HOTP account editable when its unused period is not a number', async () => {
		const h = await harness([{ ...ACCOUNT, type: 'HOTP', period: 'none', counter: 2 }]);
		h.editSecret('a');

		expect(h.optionValues('secretPeriod')).toEqual(['30', '60', '120']);
		await h.submit();
		expect(h.sentBody()).toMatchObject({ type: 'HOTP', period: 30, counter: 2 });
	});
});
