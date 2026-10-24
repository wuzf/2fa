import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const record = {
	id: 'totp',
	name: 'Google',
	account: 'pixel@example.test',
	secret: seed,
	type: 'TOTP',
	period: 30,
	digits: 6,
	algorithm: 'SHA1',
};
const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.dispose()));
});
async function fixture(options) {
	const h = await createRuntimeFixture(options);
	fixtures.push(h);
	return h;
}

describe('actual browser host assembly', () => {
	it.each([false, true])('emits one working runtime with no account DOM (full=%s)', async (full) => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		const h = await fixture({ full, accountDOM: false, clipboard });
		h.setClock(59000);
		const runtime = h.getThemeRuntime();
		expect(h.getThemeRuntime()).toBe(runtime);
		expect(runtime.otp).toBe(h.getOtpEngine());
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
		await runtime.otp.refresh();
		const snapshot = runtime.sdk.getSnapshot();
		expect(snapshot.library.accounts[0].otp.current.value).toBe('287082');
		expect(JSON.stringify(snapshot)).not.toContain(seed);
		expect(h.document.querySelector('#secretsList, [id^="otp-"]')).toBeNull();
		const { target } = runtime.sdk.otp.readCopyTarget('totp', 'next');
		const copying = runtime.sdk.otp.copy(target);
		expect(clipboard.writeText).toHaveBeenCalledWith(snapshot.library.accounts[0].otp.next.value);
		expect(await copying).toMatchObject({ clipboard: 'copied' });
		expect(runtime.sdk.host.listActions().find((item) => item.actionId === 'account-add').enabled).toBe(true);
	});

	it('renders official cards from the same SDK, ignores a tampered display and clears them on logout', async () => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		const h = await fixture({ clipboard });
		h.setClock(59000);
		const runtime = h.getThemeRuntime();
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
		await runtime.otp.refresh();
		const official = h.getOfficialAccountView();
		expect(h.document.getElementById('otp-totp').textContent).toBe('287082');
		h.document.getElementById('otp-totp').textContent = '000000';
		await official.copy('totp');
		expect(clipboard.writeText).toHaveBeenCalledWith('287082');
		expect(h.document.getElementById('secretsList').dataset.part).toBe('account-grid');
		runtime.sdk.view.setMode('flat');
		expect(h.document.getElementById('secretsList').dataset.view).toBe('flat');
		h.invalidateSecretSession();
		expect(runtime.sdk.getSnapshot().library.accounts).toEqual([]);
		expect(h.document.querySelector('.secret-card')).toBeNull();
	});

	it('does not allow a runtime reload to abandon registered writes', async () => {
		const h = await fixture({ accountDOM: false });
		const runtime = h.getThemeRuntime();
		const write = h.beginWrite({ type: 'edit' });
		expect(await runtime.sdk.lifecycle.requestReload('update')).toEqual({ status: 'rejected', reason: 'unsaved-or-pending' });
		h.endWrite(write);
		expect(runtime.sdk.getSnapshot().host.busy).toBe(false);
	});

	it('publishes dynamically created host dialogs without treating OTP animation as a host change', async () => {
		const h = await fixture({ accountDOM: false });
		const runtime = h.getThemeRuntime();
		h.replaceSecretRecords([], { source: 'server', accessVerified: true, hidden: { count: 1, records: [] } });
		const listener = vi.fn();
		runtime.sdk.subscribe(listener);
		const flow = runtime.sdk.host.open({ kind: 'hidden-accounts' });
		await vi.waitFor(() => expect(runtime.sdk.getSnapshot().host.dialogOpen).toBe(true));
		await vi.waitFor(() => expect(h.document.getElementById('themeHostStatusModal').classList.contains('show')).toBe(true));
		await new Promise(resolve => setTimeout(resolve, 20));
		const before = listener.mock.calls.length;
		const animation = h.document.createElement('div');
		h.document.body.append(animation);
		animation.style.opacity = '0.5';
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(listener).toHaveBeenCalledTimes(before);
		h.document.getElementById('themeHostStatusModal').style.display = 'none';
		h.document.getElementById('themeHostStatusModal').classList.remove('show');
		expect(await flow.closed).toEqual({ status: 'closed' });
		await vi.waitFor(() => expect(runtime.sdk.getSnapshot().host.dialogOpen).toBe(false));
	});

	it('loads, edits and saves through real host flows without creating legacy account nodes', async () => {
		let saved = { ...record };
		const fetch = vi.fn(async (url, options = {}) => {
			if (url === '/api/secrets/totp' && options.method === 'PUT') {
				saved = { ...saved, ...JSON.parse(options.body) };
				return Response.json(saved);
			}
			if (url === '/api/secrets') {
				return Response.json([saved]);
			}
			if (url === '/api/settings') {
				return Response.json({ language: 'en' });
			}
			return new Response('{}', { status: 503 });
		});
		const h = await fixture({ accountDOM: false, fetch });
		h.setClock(59000);
		const runtime = h.getThemeRuntime();
		expect(await h.loadSecrets()).toBe(true);
		expect(runtime.sdk.getSnapshot().library).toMatchObject({ state: 'ready', source: 'server' });
		const account = runtime.sdk.getSnapshot().library.accounts[0];
		const dialog = runtime.sdk.host.open({ kind: 'account-edit', account: account.ref });
		expect(h.document.getElementById('secretModal').style.display).toBe('flex');
		expect(h.document.getElementById('secretName').value).toBe('Google');
		h.document.getElementById('secretName').value = 'Pixel vault';
		await h.handleSubmit({ preventDefault() {} });
		expect(saved.name).toBe('Pixel vault');
		expect(runtime.sdk.getSnapshot().library.accounts[0].service.label).toBe('Pixel vault');
		expect(h.getPrivateRecords()[0].name).toBe('Pixel vault');
		expect(await dialog.closed).toEqual({ status: 'closed' });
		expect(h.document.querySelector('#secretsList, .secret-card, [id^="otp-"]')).toBeNull();
		expect(await runtime.sdk.host.open({ kind: 'account-edit', account: account.ref }).closed).toEqual({
			status: 'rejected',
			reason: 'account-changed',
		});
	});

	it('offers safe recovery only after checking a pending HOTP operation, without retrying its effects', async () => {
		let finishClipboard;
		const clipboard = {
			writeText: vi.fn(
				() =>
					new Promise((resolve) => {
						finishClipboard = resolve;
					}),
			),
		};
		let saved = { ...record, type: 'HOTP', counter: 0 };
		const fetch = vi.fn(async (url, options = {}) => {
			if (url === '/api/secrets/totp/counter' && options.method === 'POST') {
				saved = { ...saved, counter: saved.counter + 1 };
				return Response.json({ data: { secret: saved } });
			}
			if (url === '/api/secrets') {
				return Response.json([saved]);
			}
			if (url === '/api/settings') {
				return Response.json({ language: 'en' });
			}
			return new Response('{}', { status: 503 });
		});
		const h = await fixture({ clipboard, fetch });
		h.setClock(59000);
		const runtime = h.getThemeRuntime();
		h.replaceSecretRecords([saved], { source: 'server', accessVerified: true });
		await runtime.otp.refresh();
		h.getOfficialAccountView();
		const copying = runtime.sdk.otp.copy(runtime.sdk.otp.readCopyTarget('totp').target);
		await vi.waitFor(() => expect(runtime.sdk.getSnapshot().library.accounts[0].counter).toBe(1));
		const operationId = runtime.sdk.getSnapshot().host.operations[0].operationId;
		expect(runtime.sdk.getSnapshot().host.operations[0]).toMatchObject({ reservation: 'confirmed', clipboard: 'pending' });
		expect(await runtime.sdk.lifecycle.requestReload('recovery')).toMatchObject({ status: 'rejected' });
		expect(await runtime.sdk.otp.reconcile(operationId)).toMatchObject({ status: 'committed' });
		const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
		const confirm = (h.window.confirm = vi.fn(() => false));
		expect(await runtime.sdk.lifecycle.requestReload('recovery')).toEqual({ status: 'cancelled' });
		expect(assign).not.toHaveBeenCalled();
		const write = h.beginWrite({ type: 'edit', accountId: 'totp' });
		confirm.mockReturnValue(true);
		expect(await runtime.sdk.lifecycle.requestReload('recovery')).toMatchObject({ status: 'rejected' });
		h.endWrite(write);
		expect(await runtime.sdk.lifecycle.requestReload('recovery')).toMatchObject({ status: 'completed' });
		expect(assign).toHaveBeenCalledWith('https://vault.test/?safeMode=1');
		expect(clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls.filter(([url]) => url.endsWith('/counter'))).toHaveLength(1);
		finishClipboard();
		await copying;
	});
});
