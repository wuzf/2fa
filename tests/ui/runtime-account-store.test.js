import { describe, expect, it, vi } from 'vitest';
import { createAccountStore } from '../../src/ui/runtime/accountStore.js';

const account = (patch = {}) => ({
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

describe('host-private account store', () => {
	it('isolates input and returned records and preserves generation across identical reads', () => {
		const input = account();
		const store = createAccountStore({ records: [input] });
		const generation = store.getAccountGeneration('a');
		input.counter = 99;
		expect(store.getRecord('a').counter).toBe(3);
		expect(() => {
			store.getRecord('a').counter = 9;
		}).toThrow();
		store.replaceRecords([account()]);
		expect(store.getAccountGeneration('a')).toBe(generation);
		store.replaceRecords([account({ hotpCounterNamespace: 'generation-2' })]);
		expect(store.getAccountGeneration('a')).not.toBe(generation);
	});
	it('clears invalid OTP state through internal subscribers before public listeners see new account data', () => {
		const store = createAccountStore({ records: [account()] });
		let token = 'old-token';
		const observed = [];
		store.subscribe(() => observed.push([store.getRecord('a').counter, token]));
		store.subscribe(
			() => {
				token = null;
			},
			{ phase: 'internal' },
		);
		store.replaceRecords([account({ counter: 4 })]);
		expect(observed).toEqual([[4, null]]);
	});
	it('rejects stale reads after a confirmed mutation and old-session commits after logout', () => {
		const store = createAccountStore({ records: [account()] });
		const session = store.getSessionGeneration();
		const read = store.beginRead();
		store.replaceRecords([account({ counter: 4 })], { invalidateReads: true });
		expect(store.replaceRecords([account()], { expectedRead: read, expectedSession: session })).toBe(false);
		store.invalidateSession();
		expect(store.getRecords()).toEqual([]);
		expect(store.replaceRecords([account()], { expectedSession: session })).toBe(false);
	});
	it('does not let a reentrant newer read lend its identity to the original request', () => {
		const store = createAccountStore();
		let newer;
		let started = false;
		store.subscribe((change) => {
			if (change.reason === 'read-start' && !started) {
				started = true;
				newer = store.beginRead();
			}
		});
		const older = store.beginRead();
		expect(older).not.toBe(newer);
		expect(store.replaceRecords([account()], { expectedRead: older })).toBe(false);
		expect(store.replaceRecords([account({ counter: 4 })], { expectedRead: newer })).toBe(true);
	});
	it('keeps counter namespace and exact generation parameters in the commit condition', () => {
		const store = createAccountStore({ records: [account()] });
		const snapshot = { ...account(), sessionGeneration: 0 };
		expect(store.commitCounter(snapshot, 4)).toBe(true);
		expect(store.getRecord('a').counter).toBe(4);
		store.replaceRecords([account({ hotpCounterNamespace: 'replacement' })]);
		expect(store.commitCounter(snapshot, 4)).toBe(false);
		expect(store.getRecord('a').counter).toBe(3);
	});
	it('registers queued writes synchronously and reports only sanitized operation facts', () => {
		const store = createAccountStore();
		const edit = store.beginWrite({ type: 'edit', accountId: 'a', secret: 'DO-NOT-EXPOSE' });
		expect(store.getOperationState().pendingWrites).toBe(1);
		store.updateOperation(edit.operationId, { clipboard: 'pending', secret: 'DO-NOT-EXPOSE', body: { seed: 'x' } });
		expect(JSON.stringify(store.getOperationState())).not.toContain('DO-NOT-EXPOSE');
		store.endWrite(edit);
		expect(store.getOperationState().busy).toBe(false);
	});
	it('publishes immediate session reset and survives a failing consumer', () => {
		const onError = vi.fn();
		const store = createAccountStore({ records: [account()], onError });
		const observed = [];
		store.subscribe(() => {
			throw new Error('view failed');
		});
		store.subscribe(() => observed.push(store.getRecords()));
		store.invalidateSession();
		expect(observed).toEqual([[]]);
		expect(onError).toHaveBeenCalledOnce();
	});
});
