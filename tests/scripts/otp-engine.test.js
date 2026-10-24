import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { createAccountStore } from '../../src/ui/runtime/accountStore.js';
import { createOtpCalculator, createOtpEngine } from '../../src/ui/runtime/otpEngine.js';

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture(records = [{ id: 'a', secret: seed, type: 'TOTP', period: 30, digits: 6 }], deferredCalculation = false) {
	const state = { now: 59_000, generation: 0, monotonic: 0 };
	const accounts = createAccountStore({ records });
	const clock = { now: () => state.now, getGeneration: () => state.generation, monotonicNow: () => state.monotonic };
	const calculator = createOtpCalculator({ clock, crypto: webcrypto, diagnostics: { warn: vi.fn(), error: vi.fn() } });
	const pending = [];
	if (deferredCalculation) {
		calculator.generateTOTP = vi.fn((secret, counter) => {
			const task = deferred();
			pending.push({ ...task, secret, counter });
			return task.promise;
		});
	}
	const intervals = new Map();
	const timers = {
		setInterval: vi.fn((callback, delay) => {
			const id = Symbol();
			intervals.set(id, { callback, delay });
			return id;
		}),
		clearInterval: vi.fn((id) => intervals.delete(id)),
	};
	const diagnostics = { warn: vi.fn() };
	const engine = createOtpEngine({ accounts, clock, calculator, timers, diagnostics });
	const frames = [];
	engine.subscribeCommits((frame) => frames.push(frame));
	async function settle(index, current = '111111', next = '222222') {
		pending[index].resolve(current);
		pending[index + 1].resolve(next);
		for (let i = 0; i < 12; i++) {
			await Promise.resolve();
		}
	}
	return { accounts, state, calculator, engine, pending, frames, settle, intervals, timers, diagnostics };
}

describe('authoritative OTP engine without DOM', () => {
	it.each([false, true])('executes the emitted engine after bundling with keepNames and minify=%s', async (minify) => {
		const result = await build({
			stdin: { contents: "export { getOTPCode } from './src/ui/scripts/otp.js';", resolveDir: process.cwd(), sourcefile: 'otp-probe.js' },
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'node',
			target: 'es2022',
			minify,
			keepNames: true,
		});
		const bundled = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
		const accounts = createAccountStore({ records: [{ id: 'a', type: 'HOTP', secret: seed, counter: 0 }] });
		// No account nodes, DOM, window, animation frames, or localStorage are provided.
		// eslint-disable-next-line no-new-func
		const engine = new Function(
			'accountStore',
			'getCorrectedNowMs',
			'getTrustedClockGeneration',
			'getTrustedMonotonicNowMs',
			bundled.getOTPCode() + '; return getOtpEngine();',
		)(
			accounts,
			() => 59_000,
			() => 0,
			() => 0,
		);
		await engine.refresh();
		expect(engine.readCommitted('a')).toMatchObject({ current: '755224', next: '287082' });
		engine.dispose();
	});

	it('runs the real RFC 4226 calculator and commits immutable current/next values without document or RAF', async () => {
		const h = fixture([{ id: 7, secret: seed, type: 'HOTP', counter: 0, digits: 6, algorithm: 'SHA1' }]);
		const outcome = await h.engine.refresh();
		expect(outcome.status).toBe('committed');
		expect(h.engine.readCommitted(7)).toMatchObject({ accountId: 7, kind: 'HOTP', current: '755224', next: '287082', counter: 0 });
		const record = h.engine.readCommitted(7);
		expect(Object.isFrozen(record)).toBe(true);
		expect(JSON.stringify(record)).not.toContain(seed);
		expect(Object.isFrozen(h.frames[0].changes)).toBe(true);
		const { target } = h.engine.readCopyTarget(7, 'current');
		expect(target.accountId).toBe(7);
		expect(h.engine.validateCopyTarget(target)).toEqual({ status: 'ready', target });
		expect(h.engine.validateCopyTarget({ ...target }).reason).toBe('invalid-target');
		expect(h.engine.readCopyTarget(7, 'next')).toEqual({ status: 'not-ready', reason: 'unsupported-slot' });
		h.engine.dispose();
	});

	it('preserves RFC 6238 SHA-256 real Web Crypto output with the same algorithm implementation', async () => {
		const h = fixture([
			{
				id: 'sha256',
				type: 'TOTP',
				secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====',
				algorithm: 'SHA256',
				digits: 8,
				period: 30,
			},
		]);
		await h.engine.refresh();
		expect(h.engine.readCommitted('sha256').current).toBe('46119246');
		h.engine.dispose();
	});

	it('rejects time-window and trusted-clock stale tickets synchronously', async () => {
		const h = fixture();
		await h.engine.refresh();
		const first = h.engine.readCopyTarget('a', 'next').target;
		h.state.now = 60_000;
		expect(h.engine.readCommitted('a')).toBeNull();
		expect(h.engine.validateCopyTarget(first).reason).toBe('stale-target');
		await h.engine.refresh();
		const second = h.engine.readCopyTarget('a', 'current').target;
		h.state.generation += 1;
		expect(h.engine.validateCopyTarget(second).status).toBe('not-ready');
		expect(h.engine.readCopyTarget('a', 'unknown').reason).toBe('invalid-slot');
		h.engine.dispose();
	});

	it('invalidates edited records before account public subscribers and rejects late crypto', async () => {
		const h = fixture(undefined, true);
		const stale = h.engine.refreshOne('a');
		const observations = [];
		h.accounts.subscribe(() => observations.push(h.engine.readCommitted('a')));
		h.accounts.replaceRecords([{ ...h.accounts.getRecord('a'), secret: 'JBSWY3DPEHPK3PXP' }]);
		const fresh = h.engine.refreshOne('a');
		await h.settle(2, '333333', '444444');
		await fresh;
		await h.settle(0);
		expect((await stale).status).toBe('superseded');
		expect(observations).toEqual([null]);
		expect(h.engine.readCommitted('a').current).toBe('333333');
		h.engine.dispose();
	});

	it.each(['counter', 'hotpCounterNamespace', 'secret', 'digits', 'algorithm'])(
		'invalidates HOTP tickets when %s changes',
		async (field) => {
			const h = fixture([{ id: 'a', secret: seed, type: 'HOTP', counter: 1, hotpCounterNamespace: 'old', digits: 6, algorithm: 'SHA1' }]);
			await h.engine.refresh();
			const { target } = h.engine.readCopyTarget('a', 'current');
			const values = { counter: 2, hotpCounterNamespace: 'new', secret: 'JBSWY3DPEHPK3PXP', digits: 8, algorithm: 'SHA256' };
			h.accounts.replaceRecords([{ ...h.accounts.getRecord('a'), [field]: values[field] }]);
			expect(h.engine.readCommitted('a')).toBeNull();
			expect(h.engine.validateCopyTarget(target).reason).toBe('stale-target');
			h.engine.dispose();
		},
	);

	it('does not invalidate committed or pending HOTP when the trusted clock changes', async () => {
		const h = fixture([{ id: 'a', secret: seed, type: 'HOTP', counter: 42 }], true);
		const task = h.engine.refreshOne('a');
		h.state.generation += 1;
		await h.engine.clockChanged();
		expect(h.pending).toHaveLength(2);
		await h.settle(0);
		expect((await task).status).toBe('committed');
		const target = h.engine.readCopyTarget('a', 'current').target;
		h.state.generation += 1;
		await h.engine.clockChanged();
		expect(h.engine.validateCopyTarget(target).status).toBe('ready');
		h.engine.dispose();
	});

	it('publishes a complete mixed-account batch only after every candidate settles', async () => {
		const h = fixture(
			[
				{ id: 'a', secret: seed },
				{ id: 'b', secret: 'JBSWY3DPEHPK3PXP' },
			],
			true,
		);
		const task = h.engine.refresh();
		await h.settle(0);
		expect(h.engine.readCommitted('a')).toBeNull();
		expect(h.frames).toHaveLength(0);
		await h.settle(2, '333333', '444444');
		expect((await task).status).toBe('committed');
		expect(h.frames).toHaveLength(1);
		expect(h.frames[0].changes.map(({ after }) => after.current)).toEqual(['111111', '333333']);
		expect(h.frames[0].changes[0].after.revision).toBe(h.frames[0].changes[1].after.revision);
		h.engine.dispose();
	});

	it('commits successful candidates while returning explicit failure for placeholders', async () => {
		const h = fixture(
			[
				{ id: 'a', secret: seed },
				{ id: 'b', secret: 'JBSWY3DPEHPK3PXP' },
			],
			true,
		);
		const task = h.engine.refresh();
		await h.settle(0);
		await h.settle(2, '------', '------');
		const result = await task;
		expect(result.outcomes.map(({ status }) => status)).toEqual(['committed', 'failed']);
		expect(h.engine.readCommitted('a').current).toBe('111111');
		expect(h.engine.readCommitted('b')).toBeNull();
		expect(h.engine.readCopyTarget('b', 'current').status).toBe('not-ready');
		h.engine.dispose();
	});

	it('invalidates session immediately and cannot repopulate from old in-flight batches', async () => {
		const h = fixture(undefined, true);
		h.engine.setActiveIds(['a']);
		const task = h.engine.refresh();
		expect(h.intervals.size).toBe(1);
		h.accounts.invalidateSession();
		expect(h.intervals.size).toBe(0);
		await h.settle(0);
		expect((await task).outcomes[0].status).toBe('superseded');
		expect(h.engine.readCommitted('a')).toBeNull();
		expect(h.engine.readCopyTarget('a', 'current').status).toBe('not-ready');
		expect(h.frames.some((frame) => frame.changes.some((change) => change.after))).toBe(false);
		h.engine.dispose();
	});

	it('runs window scheduling from explicit account demand without countdown timers', async () => {
		const h = fixture(
			[
				{ id: 'a', secret: seed },
				{ id: 'b', secret: 'JBSWY3DPEHPK3PXP' },
			],
			true,
		);
		h.engine.setActiveIds(['b']);
		const tick = [...h.intervals.values()][0].callback;
		tick();
		expect(h.pending).toHaveLength(2);
		expect(h.pending[0].secret).toBe('JBSWY3DPEHPK3PXP');
		await h.settle(0);
		expect(h.engine.readCommitted('a')).toBeNull();
		expect(h.engine.readCommitted('b').current).toBe('111111');
		h.engine.suspend();
		expect(h.intervals.size).toBe(0);
		h.state.now = 60_000;
		tick();
		expect(h.pending).toHaveLength(2);
		h.engine.resume('focus');
		expect(h.pending).toHaveLength(3); // Current reuses the previous next value from the calculator cache.
		h.pending[2].resolve('333333');
		for (let i = 0; i < 12; i++) {
			await Promise.resolve();
		}
		expect(h.engine.readCommitted('b').current).toBe('222222');
		h.engine.dispose();
		expect(h.intervals.size).toBe(0);
	});

	it('initializes and advances demanded HOTP records without any account rendering', async () => {
		const h = fixture([{ id: 'a', secret: seed, type: 'HOTP', counter: 0 }]);
		h.engine.setActiveIds(['a']);
		const tick = [...h.intervals.values()][0].callback;
		const frame = () =>
			new Promise((resolve) => {
				const stop = h.engine.subscribeCommits((value) => {
					stop();
					resolve(value);
				});
			});
		const initial = frame();
		tick();
		await initial;
		expect(h.engine.readCommitted('a').current).toBe('755224');
		const revision = h.engine.readCommitted('a').revision;
		tick();
		expect(h.engine.readCommitted('a').revision).toBe(revision);
		h.accounts.replaceRecords([{ ...h.accounts.getRecord('a'), counter: 1 }]);
		expect(h.engine.readCommitted('a')).toBeNull();
		const next = frame();
		tick();
		await next;
		expect(h.engine.readCommitted('a')).toMatchObject({ current: '287082', counter: 1 });
		h.engine.dispose();
	});

	it('isolates subscriber errors and honours unsubscribe after core commit', async () => {
		const h = fixture();
		h.engine.subscribeCommits(() => {
			throw new Error('broken theme');
		});
		const listener = vi.fn();
		const unsubscribe = h.engine.subscribeCommits(listener);
		await h.engine.refresh();
		expect(h.engine.readCommitted('a')).not.toBeNull();
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		h.state.now = 60_000;
		await h.engine.refresh();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(h.diagnostics.warn).toHaveBeenCalledTimes(2);
		h.engine.dispose();
	});
});
