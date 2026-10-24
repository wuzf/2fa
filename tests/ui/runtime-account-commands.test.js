import { describe, expect, it, vi } from 'vitest';
import { createAccountStore } from '../../src/ui/runtime/accountStore.js';
import { createAccountCommands } from '../../src/ui/runtime/accountCommands.js';
import { createOtpCalculator, createOtpEngine } from '../../src/ui/runtime/otpEngine.js';
import { createBrowserClipboardPort } from '../../src/ui/scripts/browserClipboard.js';

const record = (patch = {}) => ({
	id: 'a',
	name: 'Example',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'HOTP',
	digits: 6,
	algorithm: 'SHA1',
	counter: 3,
	hotpCounterNamespace: 'generation-1',
	...patch,
});
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush() {
	for (let n = 0; n < 20; n += 1) {
		await Promise.resolve();
	}
}
function harness(overrides = {}) {
	const accounts = createAccountStore({ records: [record(overrides.record)] });
	const tickets = new Set();
	const otp = {
		readCopyTarget(id, slot) {
			const current = accounts.getRecord(id);
			if (!current) {
				return { status: 'not-ready', reason: 'account-missing' };
			}
			const target = Object.freeze({
				accountId: id,
				slot,
				value: current.counter === 3 ? '012345' : '87654321',
				sessionGeneration: accounts.getSessionGeneration(),
				accountGeneration: accounts.getAccountGeneration(id),
			});
			tickets.add(target);
			return { status: 'ready', target };
		},
		validateCopyTarget(target) {
			return tickets.has(target) &&
				target.sessionGeneration === accounts.getSessionGeneration() &&
				target.accountGeneration === accounts.getAccountGeneration(target.accountId)
				? { status: 'ready', target }
				: { status: 'not-ready', reason: 'stale-target' };
		},
	};
	const clipboard = { writeText: vi.fn(() => Promise.resolve(true)), ...overrides.clipboard };
	const reserveCounter =
		overrides.reserveCounter || vi.fn(async (snapshot) => ({ ...accounts.getRecord(snapshot.id), counter: snapshot.nextCounter }));
	const reconcile = overrides.reconcile || vi.fn(async () => true);
	const feedback = vi.fn();
	const commands = createAccountCommands({
		accounts,
		otp,
		clipboard,
		reserveCounter,
		reconcile,
		feedback,
		online: overrides.online || (() => true),
		origin: () => 'https://example.test',
	});
	return { accounts, commands, otp, clipboard, reserveCounter, reconcile, feedback };
}

describe('account commands without a document', () => {
	it('runs real OTP calculation and the unified HOTP transaction without any account DOM', async () => {
		const accounts = createAccountStore({ records: [record({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', counter: 0 })] });
		const clock = { now: () => 59000, getGeneration: () => 0, monotonicNow: () => 0 };
		const calculator = createOtpCalculator({ clock, crypto: globalThis.crypto });
		const otp = createOtpEngine({ accounts, clock, calculator, timers: { setInterval: vi.fn(() => 1), clearInterval: vi.fn() } });
		await otp.refresh();
		const target = otp.readCopyTarget('a', 'current').target;
		expect(target.value).toBe('755224');
		const clipboard = { writeText: vi.fn(async () => true) };
		const commands = createAccountCommands({
			accounts,
			otp,
			clipboard,
			reserveCounter: async () => record({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', counter: 1 }),
			afterCounterCommit: () => otp.refreshOne('a'),
		});
		expect(await commands.copy(target)).toMatchObject({ clipboard: 'copied', reservation: 'confirmed', counterAdvanced: true });
		expect(clipboard.writeText.mock.calls[0][0]).toBe('755224');
		expect(accounts.getRecord('a').counter).toBe(1);
		expect(otp.readCommitted('a').current).toBe('287082');
		expect(await commands.copy(target)).toMatchObject({ status: 'not-started' });
		expect(clipboard.writeText).toHaveBeenCalledOnce();
		otp.dispose();
	});
	it('starts native copy and reservation synchronously, preserving leading zeros and one transaction', async () => {
		const h = harness();
		const result = h.commands.copyCurrent('a');
		expect(h.clipboard.writeText.mock.calls[0][0]).toBe('012345');
		expect(h.reserveCounter).toHaveBeenCalledOnce();
		expect(await result).toMatchObject({ clipboard: 'copied', reservation: 'confirmed', localCommit: 'committed', counterAdvanced: true });
		expect(h.accounts.getRecord('a').counter).toBe(4);
	});
	it.each(['success', 'failure', 'cancel'])('rejects new HOTP while an earlier edit is %s, never automatically replays', async (ending) => {
		const h = harness();
		const write = h.accounts.beginWrite({ type: 'edit', accountId: 'a' });
		expect(await h.commands.copyCurrent('a')).toMatchObject({ status: 'not-started', reason: 'write-busy-reclick' });
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
		expect(h.reserveCounter).not.toHaveBeenCalled();
		if (ending === 'success') {
			h.accounts.replaceRecords([record({ secret: 'GEZDGNBVGY3TQOJQ', counter: 50, digits: 8 })]);
		}
		h.accounts.endWrite(write, { reason: ending });
		await flush();
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
		await h.commands.copyCurrent('a');
		expect(h.clipboard.writeText.mock.calls[0][0]).toBe(ending === 'success' ? '87654321' : '012345');
		expect(h.reserveCounter.mock.calls[0][0]).toMatchObject(
			ending === 'success' ? { counter: 50, digits: 8, secret: 'GEZDGNBVGY3TQOJQ' } : { counter: 3, digits: 6, secret: 'JBSWY3DPEHPK3PXP' },
		);
	});
	it('shares a running operation before checking a later queued edit', async () => {
		const waiting = deferred();
		const h = harness({ reserveCounter: vi.fn(() => waiting.promise) });
		const first = h.commands.copyCurrent('a');
		const edit = h.accounts.beginWrite({ type: 'edit' });
		expect(h.commands.copyCurrent('a')).toBe(first);
		waiting.resolve(record({ counter: 4 }));
		await first;
		expect(h.reserveCounter).toHaveBeenCalledOnce();
		h.accounts.endWrite(edit);
	});
	it('keeps the original mount guard when a new mount joins a pending HOTP transaction', async () => {
		const native = deferred();
		const navigator = { clipboard: { writeText: vi.fn(() => native.promise) } };
		const document = { body: {}, createElement: vi.fn(), execCommand: vi.fn(() => true) };
		const clipboard = createBrowserClipboardPort({ navigator, document });
		const h = harness({ clipboard });
		let mounted = true;
		const target = h.otp.readCopyTarget('a', 'current').target;
		const first = h.commands.copy(target, { isCurrent: () => mounted });
		await flush();
		expect(h.accounts.getRecord('a').counter).toBe(4);
		mounted = false;
		const newTarget = h.otp.readCopyTarget('a', 'current').target;
		expect(h.commands.copy(newTarget, { isCurrent: () => true })).toBe(first);
		native.reject(new Error('late permission denial'));
		expect(await first).toMatchObject({ clipboard: 'failed', reservation: 'confirmed', localCommit: 'committed', counterAdvanced: true });
		expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
		expect(h.reserveCounter).toHaveBeenCalledOnce();
		expect(document.createElement).not.toHaveBeenCalled();
		expect(document.execCommand).not.toHaveBeenCalled();
		expect(h.feedback).not.toHaveBeenCalled();
	});
	it('rejects already disposed mount commands before native or server effects', async () => {
		const h = harness();
		const guard = { isCurrent: () => false };
		const target = h.otp.readCopyTarget('a', 'current').target;
		for (const command of [
			() => h.commands.copy(target, guard),
			() => h.commands.copyURI('a', guard),
			() => h.commands.copyShareLink('a', guard),
		]) {
			expect(await command()).toMatchObject({ status: 'not-started', reason: 'mount-invalidated' });
		}
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
		expect(h.reserveCounter).not.toHaveBeenCalled();
		expect(h.accounts.getOperationState().busy).toBe(false);
	});
	it('publishes server advancement and recovery while clipboard remains pending, without unlocking or resending', async () => {
		const waiting = deferred();
		const h = harness({ clipboard: { writeText: vi.fn(() => waiting.promise) } });
		const first = h.commands.copyCurrent('a');
		await flush();
		const state = h.accounts.getOperationState();
		expect(state.operations[0]).toMatchObject({
			clipboard: 'pending',
			reservation: 'confirmed',
			localCommit: 'committed',
			counterAdvanced: true,
		});
		expect(h.accounts.getRecord('a').counter).toBe(4);
		expect(h.commands.canReloadAfterReconcile()).toBe(false);
		expect(await h.commands.recoverOperation(state.operations[0].operationId)).toBe(true);
		expect(h.accounts.getOperationState().operations[0].recovery).toBe('reload-required');
		expect(h.commands.canReloadAfterReconcile()).toBe(true);
		const queuedEdit = h.accounts.beginWrite({ type: 'edit', accountId: 'a' });
		expect(h.commands.canReloadAfterReconcile()).toBe(false);
		h.accounts.endWrite(queuedEdit);
		expect(h.commands.canReloadAfterReconcile()).toBe(true);
		expect(h.accounts.getOperationState().busy).toBe(true);
		expect(h.commands.copyCurrent('a')).toBe(first);
		expect(h.reserveCounter).toHaveBeenCalledOnce();
		waiting.resolve(true);
		expect(await first).toMatchObject({ clipboard: 'copied', reservation: 'confirmed' });
		expect(h.accounts.getOperationState().busy).toBe(false);
		expect(h.commands.canReloadAfterReconcile()).toBe(false);
	});
	it('does not share a previous namespace operation as success for a replacement account', async () => {
		const waiting = deferred();
		const h = harness({ clipboard: { writeText: vi.fn(() => waiting.promise) } });
		const first = h.commands.copyCurrent('a');
		await flush();
		h.accounts.replaceRecords([record({ hotpCounterNamespace: 'new-namespace' })]);
		expect(await h.commands.copyCurrent('a')).toMatchObject({ status: 'not-started', reason: 'operation-pending-account-changed' });
		expect(h.reserveCounter).toHaveBeenCalledOnce();
		waiting.resolve(true);
		await first;
	});
	it('records failed clipboard with successful reservation instead of pretending rollback', async () => {
		const h = harness({ clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } });
		expect(await h.commands.copyCurrent('a')).toMatchObject({ clipboard: 'failed', reservation: 'confirmed', counterAdvanced: true });
		expect(h.accounts.getRecord('a').counter).toBe(4);
	});
	it('records copied code with rejected reservation and reconciles without automatic retry', async () => {
		const h = harness({ reserveCounter: vi.fn(() => Promise.reject(Object.assign(new Error('conflict'), { reservationRejected: true }))) });
		expect(await h.commands.copyCurrent('a')).toMatchObject({ clipboard: 'copied', reservation: 'rejected', reconciliation: 'succeeded' });
		expect(h.reconcile).toHaveBeenCalledOnce();
		expect(h.reserveCounter).toHaveBeenCalledOnce();
	});
	it('keeps a completed operation settled when a manual reconciliation is retried', async () => {
		const h = harness({
			reserveCounter: vi.fn(() => Promise.reject(new Error('lost response'))),
			reconcile: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
		});
		const result = await h.commands.copyCurrent('a');
		expect(result).toMatchObject({ status: 'settled', reconciliation: 'failed' });
		await h.commands.recoverOperation(result.operationId);
		expect(h.accounts.getOperationState()).toMatchObject({
			busy: false,
			operations: [{ status: 'settled', reservation: 'unknown', reconciliation: 'succeeded', recovery: 'reconciled' }],
		});
		expect(h.reserveCounter).toHaveBeenCalledOnce();
	});
	it('does not let a late failed reconciliation resurrect a completed confirmed operation', async () => {
		const reservation = deferred();
		const reading = deferred();
		const h = harness({ reserveCounter: vi.fn(() => reservation.promise), reconcile: vi.fn(() => reading.promise) });
		const copying = h.commands.copyCurrent('a');
		const id = h.accounts.getOperationState().operations[0].operationId;
		const recovery = h.commands.recoverOperation(id);
		reservation.resolve(record({ counter: 4 }));
		expect(await copying).toMatchObject({ status: 'settled', reservation: 'confirmed', recovery: 'none' });
		reading.resolve(false);
		await recovery;
		expect(h.accounts.getOperationState()).toMatchObject({
			busy: false,
			operations: [{ status: 'settled', reservation: 'confirmed', localCommit: 'committed', recovery: 'none' }],
		});
	});
	it('keeps a transport failure unknown when reconciliation also fails', async () => {
		const h = harness({ reserveCounter: vi.fn(() => Promise.reject(new Error('network'))), reconcile: vi.fn(async () => false) });
		expect(await h.commands.copyCurrent('a')).toMatchObject({
			clipboard: 'copied',
			reservation: 'unknown',
			counterAdvanced: 'unknown',
			reconciliation: 'failed',
		});
	});
	it.each([undefined, null])('does not treat an inconclusive reconciliation result %s as a successful read', async (readResult) => {
		const h = harness({ reserveCounter: vi.fn(() => Promise.reject(new Error('network'))), reconcile: vi.fn(async () => readResult) });
		expect(await h.commands.copyCurrent('a')).toMatchObject({
			reservation: 'unknown',
			reconciliation: 'failed',
			recovery: 'retry-reconcile',
		});
	});
	it('does not commit old-session reservation or send feedback to a new session', async () => {
		const waiting = deferred();
		const h = harness({ reserveCounter: vi.fn(() => waiting.promise) });
		const first = h.commands.copyCurrent('a');
		h.accounts.invalidateSession({ blocked: false });
		h.accounts.replaceRecords([record({ counter: 20 })]);
		waiting.resolve(record({ counter: 4 }));
		expect(await first).toMatchObject({ status: 'session-invalidated', reservation: 'pending', localCommit: 'not-attempted' });
		await flush();
		expect(h.accounts.getRecord('a').counter).toBe(20);
		expect(h.feedback).not.toHaveBeenCalled();
	});

	it('releases old-session host waiting without claiming to cancel an unresolved native clipboard', async () => {
		const waiting = deferred();
		const h = harness({ clipboard: { writeText: vi.fn(() => waiting.promise) } });
		const copying = h.commands.copyCurrent('a');
		await flush();
		h.accounts.invalidateSession({ blocked: false });
		expect(await copying).toMatchObject({
			status: 'session-invalidated',
			clipboard: 'pending',
			reservation: 'confirmed',
			localCommit: 'committed',
			counterAdvanced: true,
		});
		h.accounts.replaceRecords([record({ counter: 20 })]);
		const edit = h.accounts.beginWrite({ type: 'edit', accountId: 'a' });
		expect(h.accounts.getOperationState().pendingWrites).toBe(1);
		waiting.resolve(true);
		await flush();
		expect(h.accounts.getRecord('a').counter).toBe(20);
		expect(h.accounts.getOperationState().pendingWrites).toBe(1);
		expect(h.feedback).not.toHaveBeenCalled();
		h.accounts.endWrite(edit);
	});
	it.each([{ online: () => false }, { record: { counter: Number.MAX_SAFE_INTEGER } }])(
		'rejects unsafe HOTP before either side effect',
		async (settings) => {
			const h = harness(settings);
			expect(await h.commands.copyCurrent('a')).toMatchObject({ status: 'not-started' });
			expect(h.clipboard.writeText).not.toHaveBeenCalled();
			expect(h.reserveCounter).not.toHaveBeenCalled();
		},
	);
	it('rejects fabricated and outdated copy targets', async () => {
		const h = harness({ record: { type: 'TOTP' } });
		const target = h.otp.readCopyTarget('a', 'current').target;
		expect(await h.commands.copy({ ...target, value: '999999' })).toMatchObject({ reason: 'stale-target' });
		h.accounts.replaceRecords([record({ type: 'TOTP', secret: 'GEZDGNBVGY3TQOJQ' })]);
		expect(await h.commands.copy(target)).toMatchObject({ reason: 'stale-target' });
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
	});
	it('copies fixed HOTP link parameters through the same clipboard port without advancing the counter', async () => {
		const h = harness({ record: { digits: 8, algorithm: 'SHA256' } });
		await h.commands.copyShareLink('a');
		const url = new URL(h.clipboard.writeText.mock.calls[0][0]);
		expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'HOTP', counter: '3', digits: '8', algorithm: 'SHA256' });
		expect(h.reserveCounter).not.toHaveBeenCalled();
	});
});
