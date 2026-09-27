import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodePreview } from '../../extension/src/popup/code-preview.js';

const ACCOUNT = Object.freeze({ id: 'first', name: 'Example', account: 'alice', type: 'TOTP', digits: 6 });
const OTHER_ACCOUNT = Object.freeze({ ...ACCOUNT, id: 'second', account: 'bob' });
const START_TIME = 1800000000000;

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function response(overrides = {}) {
	const current = { code: '012345', digits: 6, expiresAt: Date.now() + 30000, period: 30, ...overrides };
	return {
		nextCode: '678901',
		nextStartsAt: current.expiresAt,
		nextExpiresAt: current.expiresAt + current.period * 1000,
		...current,
	};
}

function setup(requestCode = vi.fn(async () => response())) {
	const onChange = vi.fn();
	const preview = createCodePreview({ requestCode, onChange, prefetchMs: 0 });
	return { preview, requestCode, onChange };
}

describe('popup code preview', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(START_TIME);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('copies the next code before activation but drops it immediately at rollover or close', async () => {
		const pending = deferred();
		const { preview } = setup(vi.fn().mockResolvedValueOnce(response()).mockReturnValue(pending.promise));
		await preview.open(ACCOUNT);
		expect(preview.getCopyableNextCode()).toBe('678901');
		expect(preview.getCopyableCode()).toBe('012345');
		await vi.advanceTimersByTimeAsync(29999);
		expect(preview.getCopyableCode()).toBeNull();
		expect(preview.getCopyableNextCode()).toBe('678901');
		await vi.advanceTimersByTimeAsync(1);
		expect(preview.getCopyableNextCode()).toBeNull();
		pending.resolve(response({ code: '678901', nextCode: '222222' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(preview.getCopyableNextCode()).toBe('222222');
		preview.close();
		expect(preview.getCopyableNextCode()).toBeNull();
	});

	it('preserves a source recovery code and clears it after retry', async () => {
		const error = Object.assign(new Error('2FA 页面已休眠'), { code: 'SOURCE_TAB_INACTIVE' });
		const { preview } = setup(vi.fn().mockRejectedValueOnce(error).mockResolvedValue(response()));
		await preview.open(ACCOUNT);
		expect(preview.getState()).toMatchObject({ error: error.message, errorCode: error.code });
		await preview.retry();
		expect(preview.getState()).toMatchObject({ error: null, errorCode: null, status: 'ready' });
	});

	it('starts empty, loads only the selected account, and counts down using its actual period', async () => {
		const { preview, requestCode } = setup(vi.fn(async () => response({ expiresAt: Date.now() + 120000, period: 120 })));
		expect(preview.getState()).toMatchObject({ account: null, status: 'idle', code: null, nextCode: null });
		await preview.open(ACCOUNT);
		expect(requestCode).toHaveBeenCalledWith(ACCOUNT, { includeNext: true, isCurrent: expect.any(Function) });
		expect(requestCode).toHaveBeenCalledTimes(1);
		expect(preview.getState()).toMatchObject({
			account: ACCOUNT,
			status: 'ready',
			code: '012345',
			nextCode: '678901',
			remainingSeconds: 120,
			nextInSeconds: 120,
			period: 120,
		});
		await vi.advanceTimersByTimeAsync(1250);
		expect(preview.getState().remainingSeconds).toBe(119);
		expect(preview.getCopyableCode()).toBe('012345');
	});

	it('clears an expired code before one refresh, including when refresh takes several ticks', async () => {
		const nextRequest = deferred();
		const requestCode = vi
			.fn()
			.mockResolvedValueOnce(response({ expiresAt: START_TIME + 2000 }))
			.mockReturnValue(nextRequest.promise);
		const { preview, onChange } = setup(requestCode);
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(2000);
		expect(preview.getState()).toMatchObject({
			code: null,
			expiresAt: null,
			remainingSeconds: 0,
			nextCode: null,
			nextStartsAt: null,
			nextExpiresAt: null,
			nextInSeconds: 0,
			status: 'loading',
		});
		expect(preview.getCopyableCode()).toBeNull();
		expect(onChange.mock.calls.at(-1)[0].code).toBeNull();
		await vi.advanceTimersByTimeAsync(2000);
		expect(requestCode).toHaveBeenCalledTimes(2);
		nextRequest.resolve(response({ code: '234567' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(preview.getState()).toMatchObject({ code: '234567', remainingSeconds: 30, status: 'ready' });
	});

	it('does not copy a current code with one second or less left', async () => {
		const { preview } = setup();
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(28750);
		expect(preview.getCopyableCode()).toBe('012345');
		await vi.advanceTimersByTimeAsync(250);
		expect(preview.getState().code).toBe('012345');
		expect(preview.getCopyableCode()).toBeNull();
	});

	it('loads both codes in one request and counts down next-code activation without copying it', async () => {
		const requestCode = vi.fn(async () => response());
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		expect(preview.getState()).toMatchObject({ nextCode: '678901', nextInSeconds: 30 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(preview.getState().nextInSeconds).toBe(29);
		expect(preview.getCopyableCode()).toBe('012345');
		expect(requestCode).toHaveBeenCalledTimes(1);
	});

	it('never promotes next code to current and refreshes both codes together at expiry', async () => {
		const refresh = deferred();
		const requestCode = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(refresh.promise);
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(30000);
		expect(requestCode.mock.calls[1][1].includeNext).toBe(true);
		expect(preview.getState()).toMatchObject({ code: null, nextCode: null, status: 'loading' });
		expect(preview.getCopyableCode()).toBeNull();
		refresh.resolve(response({ code: '345678', nextCode: '456789' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(preview.getState()).toMatchObject({ code: '345678', nextCode: '456789', nextInSeconds: 30 });
		expect(preview.getCopyableCode()).toBe('345678');
	});

	it('expiry during a pending retry clears both codes without starting a duplicate refresh', async () => {
		const refresh = deferred();
		const requestCode = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(refresh.promise);
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		const retrying = preview.retry();
		expect(preview.getState()).toMatchObject({ status: 'loading', code: '012345', nextCode: '678901' });
		await vi.advanceTimersByTimeAsync(31000);
		expect(preview.getState()).toMatchObject({ status: 'loading', code: null, nextCode: null });
		expect(requestCode).toHaveBeenCalledTimes(2);
		refresh.resolve(response({ code: '999999', nextCode: '888888' }));
		await retrying;
		expect(preview.getState()).toMatchObject({ status: 'ready', code: '999999', nextCode: '888888' });
	});

	it.each(['resolve', 'reject'])('switching accounts discards an old request that later %ss', async (outcome) => {
		const previous = deferred();
		const requestCode = vi
			.fn()
			.mockReturnValueOnce(previous.promise)
			.mockResolvedValueOnce(response({ code: '234567' }));
		const { preview } = setup(requestCode);
		const opening = preview.open(ACCOUNT);
		const oldIsCurrent = requestCode.mock.calls[0][1].isCurrent;
		await preview.open(OTHER_ACCOUNT);
		expect(oldIsCurrent()).toBe(false);
		previous[outcome](outcome === 'resolve' ? response() : new Error('old failure'));
		await opening;
		expect(preview.getState()).toMatchObject({ account: OTHER_ACCOUNT, code: '234567', nextCode: '678901', error: null });
	});

	it.each(['resolve', 'reject'])('closing removes all data and ignores a pending request that later %ss', async (outcome) => {
		const request = deferred();
		const { preview, onChange, requestCode } = setup(vi.fn(() => request.promise));
		const opening = preview.open(ACCOUNT);
		preview.close();
		expect(preview.getState()).toMatchObject({
			account: null,
			code: null,
			nextCode: null,
			nextStartsAt: null,
			nextExpiresAt: null,
			nextInSeconds: 0,
		});
		const changeCount = onChange.mock.calls.length;
		expect(requestCode.mock.calls[0][1].isCurrent()).toBe(false);
		request[outcome](outcome === 'resolve' ? response() : new Error('after close'));
		await opening;
		await vi.advanceTimersByTimeAsync(60000);
		expect(onChange).toHaveBeenCalledTimes(changeCount);
		expect(requestCode).toHaveBeenCalledTimes(1);
		expect(preview.getState()).toMatchObject({ account: null, code: null, status: 'idle' });
	});

	it('closing a ready preview stops ticking and automatic refresh', async () => {
		const { preview, requestCode, onChange } = setup();
		await preview.open(ACCOUNT);
		preview.close();
		const changeCount = onChange.mock.calls.length;
		await vi.advanceTimersByTimeAsync(120000);
		expect(onChange).toHaveBeenCalledTimes(changeCount);
		expect(requestCode).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('destroy clears data and prevents all future updates and requests', async () => {
		const { preview, onChange, requestCode } = setup();
		await preview.open(ACCOUNT);
		preview.destroy();
		const changeCount = onChange.mock.calls.length;
		await preview.open(OTHER_ACCOUNT);
		await preview.retry();
		preview.close();
		await vi.advanceTimersByTimeAsync(60000);
		expect(onChange).toHaveBeenCalledTimes(changeCount);
		expect(requestCode).toHaveBeenCalledTimes(1);
		expect(preview.getState()).toMatchObject({ account: null, code: null, nextCode: null, status: 'idle' });
	});

	it('stops automatic retries after failure and resumes only after an explicit retry', async () => {
		const requestCode = vi
			.fn()
			.mockResolvedValueOnce(response({ expiresAt: START_TIME + 1000 }))
			.mockRejectedValueOnce(new Error('连接断开'))
			.mockImplementation(async () => response({ code: '456789' }));
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(1000);
		expect(preview.getState()).toMatchObject({ code: null, status: 'error', error: '连接断开' });
		await vi.advanceTimersByTimeAsync(60000);
		expect(requestCode).toHaveBeenCalledTimes(2);
		await preview.retry();
		expect(preview.getState()).toMatchObject({ code: '456789', status: 'ready', error: null });
		await vi.advanceTimersByTimeAsync(30000);
		expect(requestCode).toHaveBeenCalledTimes(4);
	});

	it('a failed retry keeps valid codes but clears both at expiry without retrying', async () => {
		const requestCode = vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('连接断开'));
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		await preview.retry();
		expect(preview.getState()).toMatchObject({ code: '012345', nextCode: '678901', status: 'error', error: '连接断开' });
		expect(preview.getCopyableCode()).toBe('012345');
		await vi.advanceTimersByTimeAsync(90000);
		expect(preview.getState()).toMatchObject({ code: null, nextCode: null, status: 'error', remainingSeconds: 0 });
		expect(requestCode).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('repeated retries while a request is pending do not create additional requests', async () => {
		const request = deferred();
		const { preview, requestCode } = setup(vi.fn(() => request.promise));
		const opening = preview.open(ACCOUNT);
		await preview.retry();
		await preview.retry();
		expect(requestCode).toHaveBeenCalledTimes(1);
		request.resolve(response());
		await opening;
	});

	it('a response already expired in transit produces an error instead of an automatic request loop', async () => {
		const request = deferred();
		const { preview, requestCode } = setup(vi.fn(() => request.promise));
		const opening = preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(30000);
		request.resolve(response({ expiresAt: START_TIME + 1000 }));
		await opening;
		expect(preview.getState()).toMatchObject({ status: 'error', code: null, error: '验证码已过期，请重试' });
		await vi.advanceTimersByTimeAsync(60000);
		expect(requestCode).toHaveBeenCalledTimes(1);
	});

	it.each([-60000, 60000])('a wall-clock jump of %i ms clears current and next codes before refreshing', async (jump) => {
		const refresh = deferred();
		const requestCode = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(refresh.promise);
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		vi.setSystemTime(Date.now() + jump);
		expect(preview.getCopyableCode()).toBeNull();
		expect(preview.getState()).toMatchObject({ status: 'loading', code: null, nextCode: null });
		expect(requestCode).toHaveBeenCalledTimes(2);
		refresh.resolve(response());
		await vi.advanceTimersByTimeAsync(0);
		expect(preview.getState().status).toBe('ready');
	});

	it('rejects a response if the wall clock changes while the first request is in flight', async () => {
		const request = deferred();
		const { preview } = setup(vi.fn(() => request.promise));
		const opening = preview.open(ACCOUNT);
		vi.setSystemTime(START_TIME - 60000);
		request.resolve(response());
		await opening;
		expect(preview.getState()).toMatchObject({ status: 'error', code: null, error: '系统时间已改变，请重试' });
	});

	it('does not let callers mutate internal state through snapshots', async () => {
		const { preview } = setup();
		await preview.open(ACCOUNT);
		const snapshot = preview.getState();
		snapshot.code = '999999';
		snapshot.account.id = 'another-id';
		expect(preview.getState()).toMatchObject({ account: ACCOUNT, code: '012345' });
	});

	it.each([
		['missing next code', { nextCode: undefined }],
		['wrong next-code digits', { nextCode: '12345678' }],
		['non-numeric next code', { nextCode: '123abc' }],
		['wrong activation', { nextStartsAt: START_TIME + 31000 }],
		['missing expiration', { nextExpiresAt: undefined }],
		['non-finite expiration', { nextExpiresAt: Infinity }],
		['wrong interval', { nextExpiresAt: START_TIME + 61000 }],
	])('rejects both codes on initial load with %s', async (_label, overrides) => {
		const { preview, requestCode } = setup(vi.fn(async () => response(overrides)));
		await preview.open(ACCOUNT);
		expect(preview.getState()).toMatchObject({
			code: null,
			nextCode: null,
			status: 'error',
			error: '下一组验证码响应无效，请重试',
		});
		expect(preview.getCopyableCode()).toBeNull();
		await vi.advanceTimersByTimeAsync(60000);
		expect(requestCode).toHaveBeenCalledTimes(1);
	});

	it('validates current and next-code digits against the selected account', async () => {
		const requestCode = vi.fn(async () => response({ code: '12345678', nextCode: '87654321', digits: 8 }));
		const { preview } = setup(requestCode);
		await preview.open(ACCOUNT);
		expect(preview.getState()).toMatchObject({ code: null, nextCode: null, status: 'error' });
		await preview.open({ ...ACCOUNT, digits: 8 });
		expect(preview.getState()).toMatchObject({ code: '12345678', nextCode: '87654321', status: 'ready' });
	});
});

describe('revalidated smooth rollover', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(START_TIME);
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it.each([30, 60, 120])('prevalidates once and keeps a %i-second code visible through a slow boundary request', async (period) => {
		const boundary = START_TIME + period * 1000;
		const pending = deferred();
		const requestCode = vi.fn(async () => (Date.now() < boundary ? response({ period, expiresAt: boundary }) : pending.promise));
		const onChange = vi.fn();
		const preview = createCodePreview({ requestCode, onChange });
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(period * 1000 - 4750);
		expect(requestCode).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(4750);
		expect(requestCode).toHaveBeenCalledTimes(3);
		expect(preview.getCopyableCode()).toBe('678901');
		expect(preview.getCopyableNextCode()).toBeNull();
		await vi.advanceTimersByTimeAsync(2000);
		expect(preview.getCopyableCode()).toBe('678901');
		pending.resolve(response({ code: '678901', nextCode: '222222', period, expiresAt: boundary + period * 1000 }));
		await vi.advanceTimersByTimeAsync(0);
		expect(preview.getCopyableNextCode()).toBe('222222');
		preview.destroy();
	});

	it.each(['AUTH_REQUIRED', 'TARGET_CHANGED', 'SOURCE_OFFLINE'])('clears both codes and stops promotion after %s', async (code) => {
		const requestCode = vi
			.fn()
			.mockResolvedValueOnce(response())
			.mockRejectedValue(Object.assign(new Error('Unavailable'), { code }));
		const preview = createCodePreview({ requestCode, onChange: () => {} });
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(25000);
		expect(preview.getCopyableCode()).toBeNull();
		expect(preview.getCopyableNextCode()).toBeNull();
		await vi.advanceTimersByTimeAsync(10000);
		expect(requestCode).toHaveBeenCalledTimes(2);
		preview.destroy();
	});

	it('does not promote an old pair while revalidation remains pending', async () => {
		const pending = deferred();
		const requestCode = vi.fn().mockResolvedValueOnce(response()).mockReturnValue(pending.promise);
		const preview = createCodePreview({ requestCode, onChange: () => {} });
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(30000);
		expect(preview.getCopyableCode()).toBeNull();
		expect(requestCode).toHaveBeenCalledTimes(2);
		preview.destroy();
	});

	it('revokes a freshly validated pair after a clock jump', async () => {
		const preview = createCodePreview({ requestCode: vi.fn(async () => response({ expiresAt: START_TIME + 30000 })), onChange: () => {} });
		await preview.open(ACCOUNT);
		await vi.advanceTimersByTimeAsync(25000);
		vi.setSystemTime(START_TIME + 31000);
		expect(preview.getCopyableCode()).toBeNull();
		expect(preview.getCopyableNextCode()).toBeNull();
		preview.destroy();
	});
});
