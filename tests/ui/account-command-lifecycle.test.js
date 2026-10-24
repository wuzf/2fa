import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const account = {
	id: 'a',
	name: 'Original account',
	account: 'owner@example.test',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	period: 30,
	digits: 6,
	algorithm: 'SHA1',
};
const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function setup(fetch = vi.fn(async () => Response.json({ success: true }))) {
	const fixture = await createRuntimeFixture({
		accountDOM: false,
		fetch,
		extraSource: `
      window.__runtimeFixture.blockWrites = promise => {
        saveQueue = queueSecretWrite('edit', 'other', secretSessionGeneration, () => promise);
        return saveQueue;
      };
      window.__runtimeFixture.drainWrites = () => saveQueue;
    `,
	});
	fixtures.push(fixture);
	fixture.setClock(59000);
	const runtime = fixture.getThemeRuntime();
	fixture.replaceSecretRecords([account], { source: 'server', accessVerified: true });
	const ref = runtime.sdk.getSnapshot().library.accounts[0].ref;
	return { fixture, runtime, ref, fetch };
}
async function confirm(fixture) {
	await vi.waitFor(() => expect(fixture.document.getElementById('confirmDialogConfirm')).not.toBeNull());
	fixture.document.getElementById('confirmDialogConfirm').click();
}
function writes(fetch) {
	return fetch.mock.calls.filter(([, options]) => ['POST', 'PUT', 'DELETE'].includes(options?.method));
}

describe('host mutations remain bound to the mount that requested them', () => {
	it('does not send DELETE after the originating runtime is disposed while confirmation is open', async () => {
		const { fixture, runtime, ref, fetch } = await setup();
		const flow = runtime.sdk.host.open({ kind: 'account-delete', account: ref });
		await vi.waitFor(() => expect(fixture.document.getElementById('confirmDialogConfirm')).not.toBeNull());
		runtime.dispose();
		await confirm(fixture);
		await flow.closed;
		await fixture.drainWrites();
		expect(writes(fetch)).toEqual([]);
		expect(fixture.getPrivateRecords()).toEqual([account]);
	});
	it('does not delete a replacement generation with the same account ID after confirmation', async () => {
		const { fixture, runtime, ref, fetch } = await setup();
		const flow = runtime.sdk.host.open({ kind: 'account-delete', account: ref });
		const replacement = { ...account, name: 'Replacement', secret: 'GEZDGNBVGY3TQOJQ' };
		fixture.replaceSecretRecords([replacement]);
		await confirm(fixture);
		await flow.closed;
		await fixture.drainWrites();
		expect(writes(fetch)).toEqual([]);
		expect(fixture.getPrivateRecords()).toEqual([replacement]);
	});
	it.each(['dispose', 'replace'])('revalidates a confirmed delete after its earlier queued write settles (%s)', async (invalidate) => {
		const { fixture, runtime, ref, fetch } = await setup();
		const gate = deferred();
		void fixture.blockWrites(gate.promise);
		const flow = runtime.sdk.host.open({ kind: 'account-delete', account: ref });
		await confirm(fixture);
		await vi.waitFor(() => expect(runtime.sdk.getSnapshot().host.pendingWrites).toBe(2));
		if (invalidate === 'dispose') {
			runtime.dispose();
		} else {
			fixture.replaceSecretRecords([{ ...account, name: 'Replacement' }]);
		}
		gate.resolve();
		await fixture.drainWrites();
		await flow.closed;
		expect(writes(fetch)).toEqual([]);
		expect(fixture.getPrivateRecords()).toHaveLength(1);
	});
	it.each(['account-add', 'account-edit'])('does not accept a new form submission after disposing %s', async (kind) => {
		const { fixture, runtime, ref, fetch } = await setup();
		const flow = runtime.sdk.host.open({ kind, ...(kind === 'account-edit' ? { account: ref } : {}) });
		await vi.waitFor(() => expect(fixture.document.getElementById('secretModal').style.display).toBe('flex'));
		fixture.document.getElementById('secretName').value = 'Stale submission';
		fixture.document.getElementById('secretKey').value = account.secret;
		runtime.dispose();
		await fixture.handleSubmit({ preventDefault() {} });
		await flow.closed;
		expect(writes(fetch)).toEqual([]);
		expect(fixture.getPrivateRecords()).toEqual([account]);
	});
	it('revalidates an accepted edit before sending it after the write queue releases', async () => {
		const { fixture, runtime, ref, fetch } = await setup();
		const flow = runtime.sdk.host.open({ kind: 'account-edit', account: ref });
		await vi.waitFor(() => expect(fixture.document.getElementById('secretModal').style.display).toBe('flex'));
		fixture.document.getElementById('secretName').value = 'Stale queued submission';
		const gate = deferred();
		void fixture.blockWrites(gate.promise);
		const submitting = fixture.handleSubmit({ preventDefault() {} });
		await vi.waitFor(() => expect(runtime.sdk.getSnapshot().host.pendingWrites).toBe(2));
		runtime.dispose();
		gate.resolve();
		await submitting;
		await flow.closed;
		expect(writes(fetch)).toEqual([]);
		expect(fixture.getPrivateRecords()).toEqual([account]);
	});
	it('still records a confirmed edit whose HTTP request started before the runtime was disposed', async () => {
		const response = deferred();
		const fetch = vi.fn(() => response.promise);
		const { fixture, runtime, ref } = await setup(fetch);
		const flow = runtime.sdk.host.open({ kind: 'account-edit', account: ref });
		await vi.waitFor(() => expect(fixture.document.getElementById('secretModal').style.display).toBe('flex'));
		fixture.document.getElementById('secretName').value = 'Confirmed before navigation';
		const submitting = fixture.handleSubmit({ preventDefault() {} });
		await vi.waitFor(() => expect(writes(fetch)).toHaveLength(1));
		runtime.dispose();
		response.resolve(Response.json({ ...account, name: 'Confirmed before navigation' }));
		await submitting;
		await flow.closed;
		expect(fixture.getPrivateRecords()[0].name).toBe('Confirmed before navigation');
		expect(writes(fetch)).toHaveLength(1);
	});
});
