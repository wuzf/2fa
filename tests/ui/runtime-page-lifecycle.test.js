import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const record = {
	id: 'lifecycle',
	name: 'Lifecycle account',
	account: 'lifecycle@example.test',
	secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
	type: 'TOTP',
	period: 30,
	digits: 6,
	algorithm: 'SHA1',
};
const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});
function transition(window, type, persisted) {
	const event = new window.Event(type);
	Object.defineProperty(event, 'persisted', { value: persisted });
	window.dispatchEvent(event);
}
async function fixture(options = {}) {
	const clipboard = { writeText: vi.fn(async () => {}) };
	const frameCallbacks = new Map();
	let nextFrame = 0;
	const h = await createRuntimeFixture({
		...options,
		clipboard,
		setupWindow(window) {
			window.requestAnimationFrame = (callback) => {
				const id = ++nextFrame;
				frameCallbacks.set(id, callback);
				return id;
			};
			window.cancelAnimationFrame = (id) => frameCallbacks.delete(id);
		},
	});
	fixtures.push(h);
	h.setClock(59_000);
	const runtime = h.getThemeRuntime();
	h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
	await runtime.otp.refresh();
	const view = h.getOfficialAccountView();
	return {
		...h,
		runtime,
		clipboard,
		view,
		flushFrames() {
			const callbacks = [...frameCallbacks.values()];
			frameCallbacks.clear();
			callbacks.forEach((callback) => callback(0));
		},
	};
}

describe('emitted runtime page lifecycle', () => {
	it.each([false, true])('retains subscriptions and copy after cancelling beforeunload (full=%s)', async (full) => {
		const h = await fixture({ full });
		const snapshots = [];
		const unsubscribe = h.runtime.sdk.subscribe((snapshot) => snapshots.push(snapshot));
		h.window.addEventListener('beforeunload', (event) => event.preventDefault());
		const leaving = new h.window.Event('beforeunload', { cancelable: true });
		h.window.dispatchEvent(leaving);
		expect(leaving.defaultPrevented).toBe(true);
		expect(h.runtime.otp.isScheduled('lifecycle')).toBe(true);
		const before = snapshots.length;
		h.setClock(60_000);
		await h.runtime.otp.refresh();
		expect(snapshots.length).toBeGreaterThan(before);
		expect(snapshots.at(-1).library.accounts[0].otp.current.value).toBe('359152');
		expect(h.document.getElementById('otp-lifecycle').textContent).toBe('359152');
		expect(await h.view.copy('lifecycle')).toMatchObject({ clipboard: 'copied' });
		expect(h.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('359152');
		unsubscribe();
	});

	it('suspends and clears a BFCache page, then restores real OTP state, notifications, and copy on pageshow', async () => {
		const h = await fixture();
		const current = h.document.getElementById('otp-lifecycle');
		const next = h.document.getElementById('next-otp-lifecycle');
		vi.spyOn(current, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 20, right: 200, bottom: 60, width: 180, height: 40 });
		vi.spyOn(next, 'getBoundingClientRect').mockReturnValue({ left: 220, top: 30, right: 300, bottom: 55, width: 80, height: 25 });
		h.window.setOTPAnimationMode('flow');
		h.setClock(60_000);
		await h.runtime.otp.refresh();
		h.flushFrames();
		expect(h.document.querySelectorAll('.otp-promotion-flyer')).toHaveLength(1);
		expect(current.classList.contains('otp-promote-current')).toBe(true);
		const listener = vi.fn();
		h.runtime.sdk.subscribe(listener);
		transition(h.window, 'pagehide', true);
		expect(h.runtime.otp.isScheduled('lifecycle')).toBe(false);
		expect(h.document.querySelectorAll('.otp-promotion-flyer')).toHaveLength(0);
		expect(current.classList.contains('otp-promote-current')).toBe(false);
		expect(next.classList.contains('otp-promote-next')).toBe(false);
		const observations = listener.mock.calls.length;
		h.setClock(90_000);
		expect(h.runtime.otp.readCopyTarget('lifecycle').status).toBe('not-ready');
		transition(h.window, 'pageshow', true);
		// Environment subscribers resume synchronously, before Web Crypto can
		// publish the replacement OTP frame.
		expect(listener.mock.calls.length).toBeGreaterThan(observations);
		expect(listener.mock.calls.at(-1)[0].clock.correctedNow).toBe(90_000);
		expect(h.getThemeRuntime()).toBe(h.runtime);
		expect(h.getOfficialAccountView()).toBe(h.view);
		expect(h.runtime.otp.isScheduled('lifecycle')).toBe(true);
		await vi.waitFor(() => expect(h.runtime.otp.readCommitted('lifecycle')?.current).toBe('969429'));
		expect(listener.mock.calls.length).toBeGreaterThan(observations);
		expect(listener.mock.calls.at(-1)[0].clock.correctedNow).toBe(90_000);
		expect(h.document.getElementById('otp-lifecycle').textContent).toBe('969429');
		expect(await h.view.copy('lifecycle')).toMatchObject({ clipboard: 'copied' });
		expect(h.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('969429');
	});

	it('disposes only after a non-persisted pagehide and rejects the old SDK ticket', async () => {
		const h = await fixture();
		const target = h.runtime.sdk.otp.readCopyTarget('lifecycle').target;
		const listener = vi.fn();
		h.runtime.sdk.subscribe(listener);
		const observations = listener.mock.calls.length;
		transition(h.window, 'pagehide', false);
		expect(h.runtime.otp.isScheduled('lifecycle')).toBe(false);
		expect(h.runtime.otp.readCommitted('lifecycle')).toBeNull();
		expect(await h.runtime.sdk.otp.copy(target)).toEqual({ status: 'rejected', reason: 'mount-invalidated' });
		expect(h.runtime.sdk.otp.readCopyTarget('lifecycle')).toEqual({ status: 'not-ready', reason: 'mount-invalidated' });
		h.replaceSecretRecords([{ ...record, name: 'Should not notify the old page' }], { source: 'server', accessVerified: true });
		expect(listener).toHaveBeenCalledTimes(observations);
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
	});
});
