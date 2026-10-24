import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.dispose()));
});

async function fixture(kind) {
	let server = {
		id: 'account',
		name: 'Example',
		account: 'person@example.test',
		secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
		type: kind === 'hotp' ? 'HOTP' : 'TOTP',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		...(kind === 'hotp' ? { counter: 0, hotpCounterNamespace: 'first' } : {}),
	};
	let rejectNative;
	let resolveNative;
	const clipboard = {
		writeText: vi.fn(
			() =>
				new Promise((resolve, reject) => {
					resolveNative = resolve;
					rejectNative = reject;
				}),
		),
	};
	const fetch = vi.fn(async (url, options = {}) => {
		if (url === '/api/secrets/account/counter' && options.method === 'POST') {
			server = { ...server, counter: server.counter + 1 };
			return Response.json({ data: { secret: server } });
		}
		if (url === '/api/secrets') {
			return Response.json([server]);
		}
		return Response.json({});
	});
	const h = await createRuntimeFixture({ accountDOM: false, clipboard, fetch });
	fixtures.push(h);
	h.setClock(59000);
	const runtime = h.getThemeRuntime();
	h.replaceSecretRecords([server], { source: 'server', accessVerified: true });
	await runtime.otp.refresh();
	const fallback = vi.fn(() => true);
	h.document.execCommand = fallback;
	const feedback = vi.fn();
	h.window.showCenterToast = feedback;
	return {
		...h,
		runtime,
		clipboard,
		fallback,
		feedback,
		fetch,
		rejectNative: () => rejectNative(new Error('permission denied')),
		resolveNative: () => resolveNative(),
		copy() {
			if (kind === 'uri') {
				return runtime.sdk.accounts.copyURI(runtime.sdk.getSnapshot().library.accounts[0].ref);
			}
			if (kind === 'link') {
				return runtime.sdk.accounts.copyShareLink(runtime.sdk.getSnapshot().library.accounts[0].ref);
			}
			return runtime.sdk.otp.copy(runtime.sdk.otp.readCopyTarget('account', 'current').target);
		},
		posts: () => fetch.mock.calls.filter(([url, options]) => url === '/api/secrets/account/counter' && options?.method === 'POST'),
	};
}

describe('clipboard effects bound to the originating SDK mount', () => {
	it.each(['totp', 'hotp', 'uri', 'link'])('never starts fallback for a disposed %s SDK after native rejection', async (kind) => {
		const h = await fixture(kind);
		const copying = h.copy();
		expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
		if (kind === 'hotp') {
			await vi.waitFor(() =>
				expect(h.runtime.accounts.getOperationState().operations[0]).toMatchObject({
					reservation: 'confirmed',
					localCommit: 'committed',
					clipboard: 'pending',
				}),
			);
		}
		h.feedback.mockClear();
		h.runtime.dispose();
		h.rejectNative();
		expect(await copying).toMatchObject({ status: 'rejected', reason: 'mount-invalidated' });
		expect(h.fallback).not.toHaveBeenCalled();
		expect(h.document.querySelector('textarea[readonly]')).toBeNull();
		expect(h.feedback).not.toHaveBeenCalled();
		if (kind === 'hotp') {
			expect(h.posts()).toHaveLength(1);
			expect(h.runtime.accounts.getRecord('account').counter).toBe(1);
			expect(h.runtime.accounts.getOperationState().operations[0]).toMatchObject({
				clipboard: 'failed',
				reservation: 'confirmed',
				localCommit: 'committed',
			});
		}
	});

	it('keeps successful late native and server facts while suppressing the disposed UI result', async () => {
		const h = await fixture('hotp');
		const copying = h.copy();
		await vi.waitFor(() => expect(h.runtime.accounts.getOperationState().operations[0].reservation).toBe('confirmed'));
		h.runtime.dispose();
		h.resolveNative();
		expect(await copying).toMatchObject({ reason: 'mount-invalidated' });
		expect(h.runtime.accounts.getOperationState().operations[0]).toMatchObject({
			clipboard: 'copied',
			reservation: 'confirmed',
			localCommit: 'committed',
		});
		expect(h.posts()).toHaveLength(1);
		expect(h.fallback).not.toHaveBeenCalled();
	});

	it('still uses the single verified fallback for a live mount', async () => {
		const h = await fixture('totp');
		const copying = h.copy();
		h.rejectNative();
		expect(await copying).toMatchObject({ clipboard: 'copied' });
		expect(h.fallback).toHaveBeenCalledExactlyOnceWith('copy');
	});
});
