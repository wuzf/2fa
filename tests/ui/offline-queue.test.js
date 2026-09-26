import { describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { handleAddSecret } from '../../src/api/secrets/crud.js';
import { getAllSecrets, saveSecretsToKV } from '../../src/api/secrets/shared.js';

const ORIGIN = 'https://twofa.example';
const quietConsole = { debug() {}, log() {}, warn() {}, error() {} };
const copy = (value) => globalThis.structuredClone(value);
const queued = (id = 'first', changes = {}) => ({
	id,
	type: 'UPDATE',
	method: 'PUT',
	url: `/api/secrets/${id}`,
	data: { name: `Account ${id}`, secret: 'TEST-SECRET-NEVER-EXPOSE' },
	timestamp: 1,
	status: 'pending',
	retryCount: 0,
	...changes,
});

async function harness(records = [], sharedRecords = null) {
	const recordsById = sharedRecords || new Map(records.map((record) => [record.id, copy(record)]));
	const listeners = new Map();
	const notifications = [];
	let blockCommit = null;
	let abortWrite = false;
	const indexedDB = {
		open() {
			const request = {};
			globalThis.queueMicrotask(() => {
				request.result = {
					transaction(_stores, mode) {
						const transaction = {};
						const draft = new Map([...recordsById].map(([key, value]) => [key, copy(value)]));
						let pending = 0;
						let timer;
						function scheduleCompletion() {
							clearTimeout(timer);
							timer = setTimeout(() => {
								if (pending) {
									return;
								}
								const finish = () => {
									if (mode === 'readwrite' && abortWrite) {
										abortWrite = false;
										transaction.error = new Error('Aborted after request success');
										transaction.onabort?.();
										return;
									}
									if (mode === 'readwrite') {
										recordsById.clear();
										for (const [key, value] of draft) {
											recordsById.set(key, value);
										}
									}
									transaction.oncomplete?.();
								};
								if (mode === 'readwrite' && blockCommit) {
									const block = blockCommit;
									blockCommit = null;
									block(finish);
								} else {
									finish();
								}
							}, 0);
						}
						const perform = (action) => {
							const result = {};
							pending++;
							globalThis.queueMicrotask(() => {
								result.result = action();
								result.onsuccess?.();
								pending--;
								scheduleCompletion();
							});
							return result;
						};
						transaction.objectStore = () => ({
							index: () => ({ getAll: () => perform(() => copy([...draft.values()])) }),
							get: (id) => perform(() => copy(draft.get(id))),
							put: (record) => perform(() => draft.set(record.id, copy(record))),
							delete: (id) => perform(() => draft.delete(id)),
						});
						scheduleCompletion();
						return transaction;
					},
				};
				request.onsuccess();
			});
			return request;
		},
	};
	const self = {
		navigator: { onLine: true },
		location: new URL(`${ORIGIN}/sw.js`),
		registration: { sync: { register: vi.fn(async () => {}) } },
		clients: { matchAll: async () => [{ postMessage: (message) => notifications.push(copy(message)) }] },
		addEventListener(type, listener) {
			const callbacks = listeners.get(type) || [];
			callbacks.push(listener);
			listeners.set(type, callbacks);
		},
	};
	const fetch = vi.fn(async () => ({ ok: true }));
	const script = await createServiceWorker({ SW_VERSION: 'queue-test' }).text();
	// eslint-disable-next-line no-new-func
	const api = new Function('self', 'indexedDB', 'fetch', 'console', `${script}\nreturn { syncPendingOperations };`)(
		self,
		indexedDB,
		fetch,
		quietConsole,
	);
	function dispatch(type, data) {
		const tasks = [];
		let response;
		for (const listener of listeners.get(type) || []) {
			listener({
				...data,
				waitUntil: (task) => tasks.push(task),
				respondWith: (task) => {
					response = task;
				},
			});
		}
		return { done: Promise.all(tasks), response };
	}
	function command(type, fields = {}, source = { id: 'page', type: 'window', url: `${ORIGIN}/` }) {
		let resolveReply;
		const reply = new Promise((resolve) => {
			resolveReply = resolve;
		});
		const { done } = dispatch('message', { data: { type, ...fields }, source, ports: [{ postMessage: resolveReply }] });
		return { reply, done };
	}
	return {
		api,
		fetch,
		notifications,
		records: recordsById,
		self,
		command,
		dispatch,
		holdCommit: (block) => {
			blockCommit = block;
		},
		abortNextWrite: () => {
			abortWrite = true;
		},
	};
}

describe('offline queue authentication and management', () => {
	it('pauses the entire queue on 401 without consuming retries, including after worker restart', async () => {
		const first = queued('first', { retryCount: 3 });
		const second = queued('second', { timestamp: 2 });
		const app = await harness([first, second]);
		app.fetch.mockResolvedValue({ ok: false, status: 401 });
		await app.api.syncPendingOperations();
		expect(app.records.get('first')).toMatchObject({ status: 'awaiting_auth', retryCount: 3 });
		expect(app.records.get('second')).toEqual(second);
		for (let n = 0; n < 6; n++) {
			await app.api.syncPendingOperations();
		}
		expect(app.fetch).toHaveBeenCalledTimes(1);
		expect(app.notifications.filter((message) => message.type === 'SYNC_FAILED')).toEqual([]);
		expect(app.notifications.find((message) => message.type === 'SYNC_COMPLETE')).toMatchObject({
			authRequired: true,
			failCount: 0,
			deferredCount: 0,
		});
		const restarted = await harness([], app.records);
		await restarted.api.syncPendingOperations();
		expect(restarted.fetch).not.toHaveBeenCalled();
		const resume = restarted.command('OFFLINE_QUEUE_RESUME');
		expect(await resume.reply).toMatchObject({ ok: true, authRequired: false });
		await resume.done;
		expect(restarted.records.size).toBe(0);
		expect(restarted.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/first', '/api/secrets/second']);
	});
	it('keeps the remaining queue paused after cancelling the operation that received 401', async () => {
		const second = queued('second', { timestamp: 2, retryCount: 3 });
		const app = await harness([queued(), second]);
		app.fetch.mockResolvedValue({ ok: false, status: 401 });
		await app.api.syncPendingOperations();
		const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' });
		expect(await cancel.reply).toMatchObject({
			ok: true,
			authRequired: true,
			operations: [{ id: 'second', status: 'awaiting_auth' }],
		});
		await cancel.done;
		expect(app.records.has('first')).toBe(false);
		expect(app.records.get('second')).toEqual({ ...second, status: 'awaiting_auth', lastError: 'HTTP 401' });
		expect(app.fetch).toHaveBeenCalledTimes(1);
		const restarted = await harness([], app.records);
		await restarted.api.syncPendingOperations();
		expect(restarted.fetch).not.toHaveBeenCalled();
		const resume = restarted.command('OFFLINE_QUEUE_RESUME');
		expect(await resume.reply).toMatchObject({ ok: true, authRequired: false });
		await resume.done;
		expect(restarted.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/second']);
		expect(restarted.records.size).toBe(0);
	});
	it('preserves a legacy authentication pause through successive cancellations until the queue is empty', async () => {
		const app = await harness([
			queued('first', { status: 'failed', retryCount: 5, lastError: 'HTTP 401: Unauthorized' }),
			queued('third', { timestamp: 3 }),
			queued('second', { timestamp: 2 }),
		]);
		for (const [id, nextId] of [
			['first', 'second'],
			['second', 'third'],
			['third', null],
		]) {
			const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: id });
			const reply = await cancel.reply;
			await cancel.done;
			expect(reply).toMatchObject({ ok: true, authRequired: nextId !== null });
			expect(app.records.has(id)).toBe(false);
			if (nextId) {
				expect(reply.operations[0]).toMatchObject({ id: nextId, status: 'awaiting_auth' });
				await app.api.syncPendingOperations();
			} else {
				expect(reply.operations).toEqual([]);
			}
		}
		expect(app.records.size).toBe(0);
		expect(app.fetch).not.toHaveBeenCalled();
	});
	it('waits for the old in-flight 401 before resuming after login and acknowledges before slow replay finishes', async () => {
		const app = await harness([queued()]);
		let finishOld;
		let finishNew;
		app.fetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOld = resolve;
				}),
		);
		app.fetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishNew = resolve;
				}),
		);
		const old = app.api.syncPendingOperations();
		await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
		const resume = app.command('OFFLINE_QUEUE_RESUME');
		finishOld({ ok: false, status: 401 });
		await old;
		expect(await resume.reply).toMatchObject({ ok: true, operations: [{ status: 'pending' }] });
		await vi.waitFor(() => expect(finishNew).toBeTypeOf('function'));
		expect(app.records.size).toBe(1);
		finishNew({ ok: true });
		await resume.done;
		expect(app.records.size).toBe(0);
	});
	it('restores only exact legacy HTTP 401 failures and preserves other terminal failures', async () => {
		const app = await harness([
			queued('expired', { status: 'failed', retryCount: 5, lastError: 'HTTP 401: Unauthorized' }),
			queued('conflict', { status: 'failed', retryCount: 5, lastError: 'HTTP 409: Conflict' }),
			queued('other', { status: 'failed', retryCount: 5, lastError: 'HTTP 4010: Other' }),
		]);
		await app.api.syncPendingOperations();
		expect(app.fetch).not.toHaveBeenCalled();
		const resume = app.command('OFFLINE_QUEUE_RESUME');
		await resume.done;
		expect(app.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/expired']);
		expect([...app.records.keys()]).toEqual(['conflict', 'other']);
	});
	it('retries only the selected failed operation, stops again at the first 409, and can cancel it', async () => {
		const app = await harness([
			queued('first', { status: 'failed', retryCount: 5 }),
			queued('second', { status: 'failed', retryCount: 5 }),
		]);
		app.fetch.mockResolvedValue({ ok: false, status: 409, statusText: 'Conflict' });
		const retry = app.command('OFFLINE_QUEUE_RETRY', { operationId: 'first' });
		expect(await retry.reply).toMatchObject({ ok: true });
		await retry.done;
		for (let n = 0; n < 5; n++) {
			await app.api.syncPendingOperations();
		}
		// A conflict describes the request itself; it is not resent automatically.
		expect(app.fetch).toHaveBeenCalledTimes(1);
		expect(app.records.get('first')).toMatchObject({ status: 'failed', retryCount: 1, lastError: 'HTTP 409: Conflict' });
		expect(app.records.get('second')).toMatchObject({ status: 'failed', retryCount: 5 });
		const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' });
		await cancel.done;
		expect(app.records.has('first')).toBe(false);
		expect(app.records.has('second')).toBe(true);
		expect(app.fetch).toHaveBeenCalledTimes(1);
	});
	it.each([400, 403, 404, 409, 413, 422])('stops a change rejected with %i at once and keeps the server explanation', async (status) => {
		const app = await harness([queued('first'), queued('second', { timestamp: 2 })]);
		app.fetch.mockResolvedValueOnce({
			ok: false,
			status,
			statusText: 'Rejected',
			json: async () => ({ error: 'Request validation failed', message: 'Service name must be at most 50 characters (currently 51)' }),
		});
		await app.api.syncPendingOperations();
		expect(app.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/secrets/first', '/api/secrets/second']);
		expect(app.records.get('first')).toMatchObject({
			status: 'failed',
			retryCount: 1,
			lastError: `HTTP ${status}: Rejected`,
			failureMessage: 'Service name must be at most 50 characters (currently 51)',
		});
		expect(app.records.has('second')).toBe(false);
		expect(app.notifications.filter((message) => message.type === 'SYNC_FAILED')).toEqual([
			expect.objectContaining({ operationId: 'first', error: `HTTP ${status}` }),
		]);
		const summary = app.command('OFFLINE_QUEUE_STATUS');
		expect((await summary.reply).operations).toEqual([
			{
				id: 'first',
				type: 'UPDATE',
				name: 'Account first',
				timestamp: 1,
				status: 'failed',
				reason: 'Service name must be at most 50 characters (currently 51)',
				editable: true,
			},
		]);
		await summary.done;
	});
	it.each([408, 429, 500, 503])('keeps retrying %i responses up to the retry limit', async (status) => {
		const app = await harness([queued()]);
		app.fetch.mockResolvedValue({ ok: false, status, statusText: 'Temporary', json: async () => ({ message: 'Try later' }) });
		for (let n = 0; n < 4; n++) {
			await app.api.syncPendingOperations();
		}
		expect(app.records.get('first')).toMatchObject({ status: 'pending', retryCount: 4, failureMessage: 'Try later' });
		await app.api.syncPendingOperations();
		await app.api.syncPendingOperations();
		expect(app.fetch).toHaveBeenCalledTimes(5);
		expect(app.records.get('first')).toMatchObject({ status: 'failed', retryCount: 5 });
	});
	it('does not let a stalled or malformed error body hold the queue', async () => {
		vi.useFakeTimers();
		try {
			const app = await harness([queued()]);
			app.fetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', json: () => new Promise(() => {}) });
			const syncing = app.api.syncPendingOperations();
			await vi.advanceTimersByTimeAsync(3000);
			await vi.runAllTimersAsync();
			await syncing;
			expect(app.records.get('first')).toMatchObject({ status: 'failed', failureMessage: '' });
		} finally {
			vi.useRealTimers();
		}
		const app = await harness([queued()]);
		app.fetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ['unexpected'] });
		await app.api.syncPendingOperations();
		expect(app.records.get('first')).toMatchObject({ status: 'failed', failureMessage: '' });
	});
	describe('changes the server reports as already done or no longer possible', () => {
		const notFound = (operation, secretId) => ({
			ok: false,
			status: 404,
			statusText: 'Not Found',
			json: async () => ({ error: 'NotFoundError', message: 'Secret not found', details: { secretId, operation } }),
		});

		it('removes a queued deletion whose account is already gone', async () => {
			const app = await harness([queued('gone id', { type: 'DELETE', method: 'DELETE', url: '/api/secrets/gone%20id', data: null })]);
			app.fetch.mockResolvedValueOnce(notFound('deleteSecret', 'gone id'));
			const result = await app.api.syncPendingOperations();

			expect(app.records.size).toBe(0);
			expect(result).toMatchObject({ successCount: 1, failCount: 0 });
			expect(app.notifications.filter((message) => message.type === 'SYNC_FAILED')).toEqual([]);
			expect(app.notifications).toContainEqual(expect.objectContaining({ type: 'SYNC_SUCCESS', operationId: 'gone id' }));
		});

		it.each([
			['a 404 without the server explanation', { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }],
			['a 404 for another account', notFound('deleteSecret', 'someone-else')],
		])('keeps a deletion stopped after %s', async (_label, response) => {
			const app = await harness([queued('first', { type: 'DELETE', method: 'DELETE', data: null })]);
			app.fetch.mockResolvedValueOnce(response);
			await app.api.syncPendingOperations();
			expect(app.records.get('first')).toMatchObject({ status: 'failed', lastError: 'HTTP 404: Not Found' });
		});

		describe('a queued addition the server already has', () => {
			const STORED = {
				id: 'github',
				name: 'GitHub',
				account: 'user@example.com',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'TOTP',
				digits: 6,
				period: 30,
				algorithm: 'SHA1',
			};
			const { id: _id, ...ADDED } = STORED;

			function memoryKV() {
				const store = new Map();
				return {
					get: async (key, type) => (store.has(key) ? (type === 'json' ? JSON.parse(store.get(key)) : store.get(key)) : null),
					put: async (key, value) => store.set(key, value),
					delete: async (key) => store.delete(key),
					list: async ({ prefix = '' } = {}) => ({
						keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
						list_complete: true,
					}),
				};
			}

			// The replay reaches the real add handler, so the 409 has the structure the server sends.
			async function replayAgainstServer(data) {
				const env = {
					SECRETS_KV: memoryKV(),
					ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
					LOG_LEVEL: 'ERROR',
				};
				await saveSecretsToKV(env, [STORED], 'test');
				const app = await harness([queued('add', { type: 'ADD', method: 'POST', url: '/api/secrets', data })]);
				app.fetch.mockImplementation((url, options) =>
					handleAddSecret(new Request(new URL(url, ORIGIN), { method: options.method, headers: options.headers, body: options.body }), env),
				);
				const result = await app.api.syncPendingOperations();
				return { app, env, result };
			}

			it('removes it when the existing account has the same OTP parameters', async () => {
				const { app, env, result } = await replayAgainstServer({ ...ADDED });

				expect(app.fetch).toHaveBeenCalledOnce();
				expect(app.records.size).toBe(0);
				expect(result).toMatchObject({ successCount: 1, failCount: 0 });
				expect(await getAllSecrets(env)).toHaveLength(1);
				const summary = app.command('OFFLINE_QUEUE_STATUS');
				expect((await summary.reply).operations).toEqual([]);
				await summary.done;
			});

			it.each([
				['digit count', { digits: 8 }],
				['algorithm', { algorithm: 'SHA256' }],
				['period', { period: 60 }],
				['type', { type: 'HOTP', counter: 0 }],
			])('stops it for correction and explains why when the %s differs', async (_label, changes) => {
				const { app, env, result } = await replayAgainstServer({ ...ADDED, ...changes });

				expect(result).toMatchObject({ successCount: 0, failCount: 1 });
				expect(app.records.get('add')).toMatchObject({
					status: 'failed',
					duplicateDiffers: true,
					lastError: expect.stringMatching(/^HTTP 409/),
				});
				expect(await getAllSecrets(env)).toEqual([expect.objectContaining({ id: 'github', digits: 6, algorithm: 'SHA1', period: 30 })]);

				const summary = app.command('OFFLINE_QUEUE_STATUS');
				expect((await summary.reply).operations).toEqual([
					expect.objectContaining({ id: 'add', status: 'failed', editable: true, duplicateDiffers: true, reason: expect.any(String) }),
				]);
				await summary.done;
				const detail = app.command('OFFLINE_QUEUE_DETAIL', { operationId: 'add' });
				expect((await detail.reply).detail).toMatchObject({ type: 'ADD', duplicateDiffers: true });
				await detail.done;

				// A retry starts over and the flag describes only the next answer.
				app.fetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({}) });
				const retry = app.command('OFFLINE_QUEUE_RETRY', { operationId: 'add' });
				await retry.reply;
				await retry.done;
				expect(app.records.get('add')).toMatchObject({ status: 'pending', duplicateDiffers: false });
			});

			it('stops it for review when an older server does not say whether the parameters match', async () => {
				const app = await harness([queued('add', { type: 'ADD', method: 'POST', url: '/api/secrets' })]);
				app.fetch.mockResolvedValueOnce({
					ok: false,
					status: 409,
					statusText: 'Conflict',
					json: async () => ({
						error: 'ConflictError',
						message: 'Already exists',
						details: { operation: 'addSecret', name: 'Account add' },
					}),
				});
				const result = await app.api.syncPendingOperations();

				expect(result).toMatchObject({ successCount: 0, failCount: 1 });
				expect(app.records.get('add')).toMatchObject({ status: 'failed', duplicateDiffers: false, failureMessage: 'Already exists' });
				const summary = app.command('OFFLINE_QUEUE_STATUS');
				const [operation] = (await summary.reply).operations;
				await summary.done;
				expect(operation).toMatchObject({ id: 'add', editable: true, reason: 'Already exists' });
				expect(operation).not.toHaveProperty('duplicateDiffers');
			});
		});

		it('stops an edit whose account was deleted and tells the editor to save it as a new account', async () => {
			const app = await harness([queued('first')]);
			app.fetch.mockResolvedValueOnce(notFound('updateSecret', 'first'));
			await app.api.syncPendingOperations();
			expect(app.records.get('first')).toMatchObject({ status: 'failed', targetMissing: true });

			const detail = app.command('OFFLINE_QUEUE_DETAIL', { operationId: 'first' });
			expect((await detail.reply).detail).toMatchObject({ type: 'UPDATE', targetId: 'first', targetMissing: true });
			await detail.done;

			app.fetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({}) });
			const retry = app.command('OFFLINE_QUEUE_RETRY', { operationId: 'first' });
			await retry.reply;
			await retry.done;
			expect(app.records.get('first')).toMatchObject({ status: 'pending', targetMissing: false });
		});
	});

	describe('a stopped change corrected in two tabs', () => {
		const otherTab = { id: 'other-tab', type: 'window', url: `${ORIGIN}/` };
		const stopped = () => queued('first', { status: 'failed', retryCount: 1, lastError: 'HTTP 400: Bad Request' });

		async function send(app, type, source) {
			const request = app.command(type, { operationId: 'first' }, source);
			const reply = await request.reply;
			await request.done;
			return reply;
		}

		it('lets only the claiming tab replace the change while another tab tries to retry, cancel or claim it', async () => {
			const app = await harness([stopped()]);
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM')).toMatchObject({ ok: true });

			for (const type of ['OFFLINE_QUEUE_RETRY', 'OFFLINE_QUEUE_CANCEL', 'OFFLINE_QUEUE_CLAIM']) {
				expect(await send(app, type, otherTab)).toMatchObject({ ok: false, code: 'changeBusy' });
			}
			expect(app.records.get('first')).toMatchObject({ status: 'failed' });
			expect(app.fetch).not.toHaveBeenCalled();

			expect(await send(app, 'OFFLINE_QUEUE_CANCEL')).toMatchObject({ ok: true });
			expect(app.records.has('first')).toBe(false);
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM', otherTab)).toMatchObject({ ok: false, code: 'changeGone' });
		});

		it('refuses a claim at once while another tab is sending the change again', async () => {
			const app = await harness([stopped()]);
			let answer;
			app.fetch.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
			const retry = app.command('OFFLINE_QUEUE_RETRY', { operationId: 'first' }, otherTab);
			expect(await retry.reply).toMatchObject({ ok: true });
			await vi.waitFor(() => expect(app.fetch).toHaveBeenCalledOnce());
			// The claim does not wait for the replay that is still sending the change.
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM')).toMatchObject({ ok: false, code: 'changeBusy' });
			answer({ ok: true });
			await retry.done;
			expect(app.records.has('first')).toBe(false);
		});

		it('frees the change when the claiming tab releases it or stops answering', async () => {
			const app = await harness([stopped()]);
			await send(app, 'OFFLINE_QUEUE_CLAIM');
			expect(await send(app, 'OFFLINE_QUEUE_RELEASE', otherTab)).toMatchObject({ ok: true });
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM', otherTab)).toMatchObject({ ok: false, code: 'changeBusy' });
			await send(app, 'OFFLINE_QUEUE_RELEASE');
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM', otherTab)).toMatchObject({ ok: true });

			const now = Date.now();
			const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60 * 1000 + 1);
			try {
				expect(await send(app, 'OFFLINE_QUEUE_CLAIM')).toMatchObject({ ok: true });
			} finally {
				clock.mockRestore();
			}
		});

		it('treats a claim dated in the future as expired, so a clock set back cannot keep the change blocked', async () => {
			const leftBehind = { claimedBy: 'closed-tab', claimedAt: Date.now() + 60 * 60 * 1000 };
			const app = await harness([{ ...stopped(), ...leftBehind }]);
			expect(await send(app, 'OFFLINE_QUEUE_CLAIM', otherTab)).toMatchObject({ ok: true });
			expect(app.records.get('first')).toMatchObject({ claimedBy: 'other-tab' });

			const cancel = await harness([{ ...stopped(), ...leftBehind }]);
			expect(await send(cancel, 'OFFLINE_QUEUE_CANCEL', otherTab)).toMatchObject({ ok: true });
			expect(cancel.records.has('first')).toBe(false);

			// A claim taken a moment ago still blocks other tabs.
			const recent = await harness([{ ...stopped(), claimedBy: 'closed-tab', claimedAt: Date.now() - 1000 }]);
			expect(await send(recent, 'OFFLINE_QUEUE_CLAIM', otherTab)).toMatchObject({ ok: false, code: 'changeBusy' });
		});
	});

	it('clears a previous explanation when a failed change is retried', async () => {
		const app = await harness([
			queued('first', { status: 'failed', retryCount: 1, lastError: 'HTTP 400: Bad Request', failureMessage: 'Old reason' }),
		]);
		let finish;
		app.fetch.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		const retry = app.command('OFFLINE_QUEUE_RETRY', { operationId: 'first' });
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		expect(app.records.get('first')).toMatchObject({ status: 'pending', failureMessage: '', lastError: '' });
		finish({ ok: true });
		await retry.done;
		expect(app.records.size).toBe(0);
	});
	it('announces an idle replay so a reconnected page can revalidate its accounts', async () => {
		const app = await harness([queued('first', { status: 'failed' })]);
		const result = await app.api.syncPendingOperations();
		expect(app.fetch).not.toHaveBeenCalled();
		expect(result).toMatchObject({ type: 'SYNC_COMPLETE', successCount: 0, totalCount: 0, authRequired: false });
		expect(app.notifications).toEqual([
			{ type: 'SYNC_COMPLETE', successCount: 0, failCount: 0, deferredCount: 0, authRequired: false, totalCount: 0 },
		]);
	});
	it('returns account fields only for an explicit edit of a stopped add or edit', async () => {
		const app = await harness([
			queued('update', {
				status: 'failed',
				failureMessage: 'Rejected by server',
				lastError: 'HTTP 400: Bad Request',
				url: '/api/secrets/update%20id',
				data: JSON.stringify({
					name: 'Edited',
					account: 'me',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'HOTP',
					digits: 8,
					period: 60,
					algorithm: 'SHA256',
					counter: 3,
				}),
			}),
			queued('add', {
				type: 'ADD',
				method: 'POST',
				url: '/api/secrets',
				status: 'failed',
				timestamp: 2,
				data: { name: 'New', secret: 'JBSWY3DPEHPK3PXP', digits: 'bad' },
			}),
		]);
		const update = app.command('OFFLINE_QUEUE_DETAIL', { operationId: 'update' });
		const updateReply = await update.reply;
		await update.done;
		expect(updateReply).toMatchObject({ ok: true, authRequired: false });
		expect(updateReply.operations.map((item) => item.id)).toEqual(['update', 'add']);
		expect(updateReply.detail).toEqual({
			id: 'update',
			type: 'UPDATE',
			targetId: 'update id',
			targetMissing: false,
			duplicateDiffers: false,
			reason: 'Rejected by server',
			data: {
				name: 'Edited',
				account: 'me',
				secret: 'JBSWY3DPEHPK3PXP',
				type: 'HOTP',
				digits: 8,
				period: 60,
				algorithm: 'SHA256',
				counter: 3,
			},
		});
		const add = app.command('OFFLINE_QUEUE_DETAIL', { operationId: 'add' });
		const addReply = await add.reply;
		await add.done;
		expect(addReply.detail).toMatchObject({ id: 'add', type: 'ADD', targetId: '', reason: '' });
		expect(addReply.detail.data).toMatchObject({ name: 'New', account: '', secret: 'JBSWY3DPEHPK3PXP', digits: undefined });
		expect(app.records.size).toBe(2);
		expect(app.fetch).not.toHaveBeenCalled();
	});
	it.each([
		['pending changes', queued()],
		['login-paused changes', queued('first', { status: 'awaiting_auth' })],
		['legacy login failures', queued('first', { status: 'failed', lastError: 'HTTP 401: Unauthorized' })],
		['deletions', queued('first', { status: 'failed', type: 'DELETE', method: 'DELETE', data: null })],
		['batch imports', queued('first', { status: 'failed', type: 'BATCH_ADD', method: 'POST', url: '/api/secrets/batch' })],
		['missing operations', queued('other', { status: 'failed' })],
	])('never returns account fields for %s', async (_name, record) => {
		const app = await harness([record]);
		const detail = app.command('OFFLINE_QUEUE_DETAIL', { operationId: 'first' });
		const reply = await detail.reply;
		await detail.done;
		expect(reply).toMatchObject({ ok: false });
		expect(JSON.stringify(reply)).not.toContain('TEST-SECRET-NEVER-EXPOSE');
	});
	it('rejects account-field requests from another origin', async () => {
		const app = await harness([queued('first', { status: 'failed' })]);
		const detail = app.command(
			'OFFLINE_QUEUE_DETAIL',
			{ operationId: 'first' },
			{ id: 'page', type: 'window', url: 'https://other.example/' },
		);
		const reply = await detail.reply;
		await detail.done;
		expect(reply).toMatchObject({ ok: false });
		expect(JSON.stringify(reply)).not.toContain('TEST-SECRET-NEVER-EXPOSE');
	});
	it('never cancels an operation while it is being sent', async () => {
		const app = await harness([queued()]);
		let finish;
		app.fetch.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const sending = app.api.syncPendingOperations();
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' });
		expect(app.records.has('first')).toBe(true);
		finish({ ok: true });
		await Promise.all([sending, cancel.done]);
		expect(await cancel.reply).toMatchObject({ ok: true, operations: [] });
		expect(app.fetch).toHaveBeenCalledTimes(1);
	});
	it('shares duplicate resume commands without delivering an operation twice', async () => {
		const app = await harness([queued('first', { status: 'awaiting_auth' })]);
		const first = app.command('OFFLINE_QUEUE_RESUME');
		const second = app.command('OFFLINE_QUEUE_RESUME');
		await Promise.all([first.done, second.done]);
		expect(app.fetch).toHaveBeenCalledTimes(1);
		expect(app.records.size).toBe(0);
	});
	it('returns only whitelisted summary fields including names from old string bodies', async () => {
		const app = await harness([
			queued('first', {
				data: JSON.stringify({ name: 'My account', secret: 'TOPSECRET' }),
				status: 'failed',
				lastError: 'sensitive raw error',
			}),
		]);
		const status = app.command('OFFLINE_QUEUE_STATUS');
		const reply = await status.reply;
		expect(reply).toEqual({
			ok: true,
			authRequired: false,
			// Raw transport errors never become a displayed reason.
			operations: [{ id: 'first', type: 'UPDATE', name: 'My account', timestamp: 1, status: 'failed', editable: true }],
		});
		expect(JSON.stringify(reply)).not.toMatch(/TOPSECRET|lastError|url|data|sensitive/);
		await status.done;
	});
	it.each([{ id: 'page', type: 'window', url: 'https://other.example/' }, { id: 'worker', type: 'worker', url: `${ORIGIN}/` }, null])(
		'rejects queue control from unsupported client %j',
		async (source) => {
			const app = await harness([queued('first', { status: 'failed' })]);
			const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' }, source);
			expect(await cancel.reply).toMatchObject({ ok: false });
			await cancel.done;
			expect(app.records.size).toBe(1);
		},
	);
	it('does not acknowledge or broadcast a cancellation until its transaction commits', async () => {
		const app = await harness([queued('first', { status: 'failed' })]);
		let commit;
		app.holdCommit((finish) => {
			commit = finish;
		});
		const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' });
		const acknowledged = vi.fn();
		cancel.reply.then(acknowledged);
		await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
		expect(app.records.has('first')).toBe(true);
		expect(acknowledged).not.toHaveBeenCalled();
		expect(app.notifications).toEqual([]);
		commit();
		await cancel.done;
		expect(await cancel.reply).toMatchObject({ ok: true, operations: [] });
		expect(app.notifications).toEqual([{ type: 'OFFLINE_QUEUE_CHANGED' }]);
	});
	it('reports aborted writes as failure without losing the queued operation', async () => {
		const app = await harness([queued('first', { status: 'failed' })]);
		app.abortNextWrite();
		const cancel = app.command('OFFLINE_QUEUE_CANCEL', { operationId: 'first' });
		await cancel.done;
		expect(await cancel.reply).toMatchObject({ ok: false });
		expect(app.records.has('first')).toBe(true);
		expect(app.notifications).toEqual([]);
	});
	it.each([
		['POST', '/api/secrets', 'ADD'],
		['PUT', '/api/secrets/test', 'UPDATE'],
	])('queues %s bodies after the actual fetch consumes and rejects them', async (method, path, type) => {
		const app = await harness();
		app.fetch.mockImplementation(async (request) => {
			await request.text();
			throw new TypeError('Network unavailable');
		});
		const request = new Request(`${ORIGIN}${path}`, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Offline account', secret: 'TESTSECRET' }),
		});
		const { response } = app.dispatch('fetch', { request });
		expect((await response).status).toBe(202);
		expect(request.bodyUsed).toBe(true);
		expect([...app.records.values()]).toEqual([
			expect.objectContaining({ type, status: 'pending', data: { name: 'Offline account', secret: 'TESTSECRET' } }),
		]);
	});
	it('keeps an account id with / % ? # encoded from the offline edit to its replay', async () => {
		const id = 'a/b%c?d#e';
		const app = await harness();
		app.fetch.mockImplementationOnce(async () => {
			throw new TypeError('Network unavailable');
		});
		const request = new Request(`${ORIGIN}/api/secrets/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Edited', secret: 'JBSWY3DPEHPK3PXP' }),
		});
		const { response, done } = app.dispatch('fetch', { request });
		expect((await response).status).toBe(202);
		await done;
		const [queuedEdit] = [...app.records.values()];
		expect(queuedEdit).toMatchObject({ type: 'UPDATE', url: '/api/secrets/a%2Fb%25c%3Fd%23e' });

		app.fetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ message: 'Rejected' }) });
		await app.api.syncPendingOperations();
		expect(app.fetch.mock.lastCall[0]).toBe('/api/secrets/a%2Fb%25c%3Fd%23e');
		const detail = app.command('OFFLINE_QUEUE_DETAIL', { operationId: queuedEdit.id });
		expect((await detail.reply).detail).toMatchObject({ type: 'UPDATE', targetId: id });
		await detail.done;
	});
	it('never queues HOTP counter reservations after a consumed-body transport failure', async () => {
		const app = await harness();
		app.fetch.mockImplementation(async (request) => {
			await request.text();
			throw new TypeError('Network unavailable');
		});
		const request = new Request(`${ORIGIN}/api/secrets/test/counter`, {
			method: 'POST',
			body: JSON.stringify({ expectedCounter: 0, counter: 1 }),
		});
		const { response } = app.dispatch('fetch', { request });
		expect((await response).status).toBe(503);
		expect(app.records.size).toBe(0);
	});
});

describe('offline response language', () => {
	it.each([
		['zh-CN', '网络连接失败', '离线不可用', '您处于离线状态，操作已保存，网络恢复后将自动同步'],
		['zh-TW', '網路連線失敗', '離線時無法使用', '目前離線，操作已儲存，網路恢復後將自動同步'],
		[
			'en',
			'Network connection failed',
			'Unavailable offline',
			'You are offline. Your change has been saved and will sync when you reconnect.',
		],
	])('uses %s for network failures and queued writes', async (language, networkError, unavailable, queuedMessage) => {
		const app = await harness();
		app.fetch.mockRejectedValue(new TypeError('offline'));
		const headers = { 'Content-Type': 'application/json', 'X-Language': language };
		const read = app.dispatch('fetch', { request: new Request(`${ORIGIN}/api/settings`, { headers }) });
		expect(await (await read.response).json()).toMatchObject({ error: networkError, offline: true });
		const login = app.dispatch('fetch', { request: new Request(`${ORIGIN}/api/login`, { method: 'POST', headers, body: '{}' }) });
		expect(await (await login.response).json()).toMatchObject({ error: unavailable, offline: true, queued: false });
		const write = app.dispatch('fetch', {
			request: new Request(`${ORIGIN}/api/secrets`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ name: 'User input 用户原文', secret: 'JBSWY3DPEHPK3PXP' }),
			}),
		});
		expect(await (await write.response).json()).toMatchObject({ message: queuedMessage, offline: true, queued: true });
		expect([...app.records.values()][0]).toMatchObject({ headers: { 'X-Language': language }, data: { name: 'User input 用户原文' } });
	});
});
