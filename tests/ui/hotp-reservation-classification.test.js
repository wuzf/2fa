import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const account = {
	id: 'hotp',
	name: 'Synthetic HOTP',
	secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
	type: 'HOTP',
	digits: 6,
	algorithm: 'SHA1',
	counter: 0,
	hotpCounterNamespace: 'first',
};
const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

async function copyWithResponse(status, advanced = true) {
	let server = { ...account };
	const clipboard = { writeText: vi.fn(async () => {}) };
	const fetch = vi.fn(async (url, options = {}) => {
		if (url === '/api/secrets/hotp/counter' && options.method === 'POST') {
			if (advanced) {
				server = { ...server, counter: 1 };
			}
			if (status === 'network') {
				throw new TypeError('Connection lost after sending the request');
			}
			return Response.json({ success: false, error: 'Reservation was not confirmed' }, { status });
		}
		if (url === '/api/secrets') {
			return Response.json([server]);
		}
		return Response.json({});
	});
	const fixture = await createRuntimeFixture({ accountDOM: false, fetch, clipboard });
	fixtures.push(fixture);
	fixture.setClock(59000);
	const runtime = fixture.getThemeRuntime();
	fixture.replaceSecretRecords([account], { source: 'server', accessVerified: true });
	await runtime.otp.refresh();
	const { target } = runtime.sdk.otp.readCopyTarget('hotp');
	const result = await runtime.sdk.otp.copy(target);
	return { fixture, runtime, fetch, clipboard, result };
}

describe('emitted HOTP reservation response classification', () => {
	it.each([500, 503, 408, 'network'])('keeps %s unknown when reconciliation observes an advanced counter', async (status) => {
		const { fixture, runtime, fetch, clipboard, result } = await copyWithResponse(status);
		expect(result).toMatchObject({ clipboard: 'copied', reservation: 'unknown', counterAdvanced: 'unknown', reconciliation: 'succeeded' });
		expect(fixture.getPrivateRecords()[0].counter).toBe(1);
		expect(runtime.sdk.getSnapshot().host.operations[0]).toMatchObject({ reservation: 'unknown', reconciliation: 'succeeded' });
		expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
		expect(fetch.mock.calls.filter(([url]) => url === '/api/secrets')).toHaveLength(1);
		expect(clipboard.writeText).toHaveBeenCalledOnce();
	});
	it('preserves an explicit 409 rejection even if another writer advanced the counter', async () => {
		const { fixture, result, fetch } = await copyWithResponse(409);
		expect(result).toMatchObject({ clipboard: 'copied', reservation: 'rejected', reconciliation: 'succeeded' });
		expect(fixture.getPrivateRecords()[0].counter).toBe(1);
		expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
	});
	it.each([400, 404, 405, 422, 429])('recognizes a definite %s rejection without retrying the reservation', async (status) => {
		const { fixture, result, fetch } = await copyWithResponse(status, false);
		expect(result).toMatchObject({ reservation: 'rejected', reconciliation: 'succeeded' });
		expect(fixture.getPrivateRecords()[0].counter).toBe(0);
		expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
	});
	it.each([401, 403])('invalidates the current session on %s instead of reconciling into it', async (status) => {
		const { fixture, result, fetch } = await copyWithResponse(status, false);
		expect(fixture.getState().blocked).toBe(true);
		expect(fixture.getPrivateRecords()).toEqual([]);
		expect(result).toMatchObject({ reason: 'session-invalidated' });
		expect(fetch.mock.calls.filter(([url]) => url === '/api/secrets')).toHaveLength(0);
	});
});
