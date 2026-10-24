import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.dispose()));
});
const flush = async () => {
	for (let i = 0; i < 40; i += 1) {
		await Promise.resolve();
	}
};
async function fixture({ reconcileFails = false } = {}) {
	let server = {
		id: 'hotp',
		name: 'Google',
		secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
		type: 'HOTP',
		digits: 6,
		algorithm: 'SHA1',
		counter: 0,
		hotpCounterNamespace: 'first',
	};
	let finishClipboard;
	const clipboard = {
		writeText: vi.fn(
			() =>
				new Promise((resolve) => {
					finishClipboard = resolve;
				}),
		),
	};
	const reload = vi.fn(() => ({ status: 'completed', reason: 'reload-requested' }));
	const fetch = vi.fn(async (url, options = {}) => {
		if (url === '/api/secrets/hotp/counter' && options.method === 'POST') {
			server = { ...server, counter: server.counter + 1 };
			return Response.json({ data: { secret: server } });
		}
		if (url === '/api/secrets') {
			return reconcileFails ? new Response('{}', { status: 503 }) : Response.json([server]);
		}
		return Response.json({});
	});
	const h = await createRuntimeFixture({
		fetch,
		clipboard,
		setupWindow: (window) => {
			window.__recoveryReload = reload;
		},
		extraSource: 'requestThemeRuntimeReload=window.__recoveryReload;',
	});
	fixtures.push(h);
	h.setClock(59000);
	const runtime = h.getThemeRuntime();
	h.replaceSecretRecords([server], { source: 'server', accessVerified: true });
	await runtime.otp.refresh();
	const official = h.getOfficialAccountView();
	return {
		...h,
		runtime,
		official,
		fetch,
		clipboard,
		reload,
		finishClipboard: () => finishClipboard(),
		posts: () => fetch.mock.calls.filter(([, options]) => options?.method === 'POST'),
	};
}

describe('official pending HOTP recovery', () => {
	it('shows confirmed reservation before clipboard settles and reconciles without another copy or reservation', async () => {
		const h = await fixture();
		const copying = h.official.copy('hotp');
		await flush();
		const panel = h.document.getElementById('officialHotpOperations');
		expect(panel).not.toBeNull();
		expect(panel.querySelector('[data-operation-fact="clipboard"]').textContent).toBe(
			h.window.t('coreHotpClipboardState', { state: h.window.t('coreHotpStatePending') }),
		);
		expect(panel.querySelector('[data-operation-fact="reservation"]').textContent).toBe(
			h.window.t('coreHotpReservationState', { state: h.window.t('coreHotpStateConfirmed') }),
		);
		expect(h.runtime.sdk.getSnapshot().host.pendingWrites).toBe(1);
		const card = h.document.querySelector('.secret-card');
		panel.querySelector('[data-operation-action="reconcile"]').click();
		await vi.waitFor(() => expect(h.runtime.sdk.getSnapshot().host.operations[0].reconciliation).toBe('succeeded'));
		expect(h.document.querySelector('.secret-card')).toBe(card);
		expect(h.posts()).toHaveLength(1);
		expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(h.runtime.sdk.getSnapshot().host.pendingWrites).toBe(1);
		panel.querySelector('[data-operation-action="recovery"]').click();
		await flush();
		expect(h.reload).toHaveBeenCalledWith('recovery');
		h.finishClipboard();
		await copying;
		expect(h.document.getElementById('officialHotpOperations')).toBeNull();
	});

	it('keeps failed reconciliation explicit, refuses unknown operations, and hides recovery after session invalidation', async () => {
		const h = await fixture({ reconcileFails: true });
		const copying = h.official.copy('hotp');
		await flush();
		const operationId = h.runtime.sdk.getSnapshot().host.operations[0].operationId;
		expect(await h.runtime.sdk.otp.reconcile('unknown')).toMatchObject({ reason: 'operation-unavailable' });
		expect(await h.runtime.sdk.otp.reconcile(operationId)).toMatchObject({ status: 'rejected', reason: 'reconciliation-failed' });
		expect(h.document.querySelector('[data-operation-action="recovery"]')).toBeNull();
		expect(h.posts()).toHaveLength(1);
		expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
		h.invalidateSecretSession();
		await copying;
		expect(h.document.getElementById('officialHotpOperations')).toBeNull();
		expect(await h.runtime.sdk.otp.reconcile(operationId)).toMatchObject({ reason: 'operation-unavailable' });
		h.finishClipboard();
	});
});
