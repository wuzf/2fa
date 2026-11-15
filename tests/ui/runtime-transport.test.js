import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { createRuntimeTransport } from '../../src/ui/runtime/runtimeTransport.js';
const tuple = { hostBuild: 'a'.repeat(64), sdkApiVersion: 1, packageId: 'b'.repeat(64), appearanceRevision: 1, mode: 'app' };
const shell = 'c'.repeat(64),
	hash = 'd'.repeat(64);
const transports = [];
afterEach(() => {
	transports.splice(0).forEach((t) => t.dispose());
	vi.useRealTimers();
});
function fixture() {
	const window = Object.assign(new EventTarget(), { __2FA_SHELL_CONFIG_ID__: shell });
	const serviceWorker = Object.assign(new EventTarget(), { controller: null });
	const requests = [];
	const worker = {
		postMessage: (request, ports) => {
			requests.push({ request, port: ports[0] });
		},
	};
	serviceWorker.controller = worker;
	const t = createRuntimeTransport({ window, navigator: { serviceWorker }, MessageChannel });
	transports.push(t);
	function reply(index, changes = {}) {
		const { request, port } = requests[index];
		port.postMessage({
			...request,
			status: 'ready',
			compatible: true,
			resourcesReady: true,
			recoveryReady: true,
			workerBuild: tuple.hostBuild,
			permitId: 'permit-' + index,
			shellConfigId: shell,
			inventoryHash: hash,
			...changes,
		});
	}
	async function prepare() {
		const task = t.prepare(tuple);
		reply(requests.length - 1);
		expect((await task).status).toBe('ready');
	}
	async function attach() {
		const task = t.attach(tuple);
		reply(requests.length - 1);
		return task;
	}
	return { t, window, serviceWorker, worker, requests, reply, prepare, attach };
}
describe('runtime transport permit lifecycle', () => {
	it('requires an actual controller and prepared inventory before attach', async () => {
		const h = fixture();
		expect((await h.t.attach(tuple)).reason).toBe('not-prepared');
		h.serviceWorker.controller = null;
		expect((await h.t.prepare(tuple)).reason).toBe('no-controller');
		expect(h.requests).toHaveLength(0);
	});
	it('binds a permit to the actual controller, tuple, shell config and immutable inventory', async () => {
		const h = fixture();
		await h.prepare();
		const result = await h.attach();
		expect(result.permit).toMatchObject({ tuple, shellConfigId: shell, inventoryHash: hash });
		expect(Object.isFrozen(result.permit.tuple)).toBe(true);
		expect(h.t.isPermitCurrent(result.permit)).toBe(true);
		expect(h.t.isPermitCurrent({ ...result.permit })).toBe(false);
		h.serviceWorker.controller = {};
		expect(h.t.isPermitCurrent(result.permit)).toBe(false);
	});
	it('ignores nonce/tuple mismatches and rejects a changed shell configuration', async () => {
		const h = fixture();
		const request = h.t.prepare(tuple);
		h.reply(0, { nonce: 'wrong' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		h.reply(0, { shellConfigId: 'e'.repeat(64) });
		expect((await request).reason).toBe('shell-configuration-changed');
	});
	it('cannot let a late old-controller reply grant execution even before controllerchange is delivered', async () => {
		const h = fixture();
		await h.prepare();
		const request = h.t.attach(tuple);
		h.serviceWorker.controller = {};
		h.reply(1);
		expect((await request).reason).toBe('controller-changed');
	});
	it('keeps the old permit while preparing an update, but invalidates it permanently after attach succeeds', async () => {
		const h = fixture();
		await h.prepare();
		const previous = (await h.attach()).permit;
		const next = { ...tuple, appearanceRevision: 2 };
		const prepare = h.t.prepare(next);
		expect(h.t.isPermitCurrent(previous)).toBe(true);
		h.reply(2, { status: 'blocked', reason: 'download-failed' });
		await prepare;
		expect(h.t.isPermitCurrent(previous)).toBe(true);
		const retry = h.t.prepare(next);
		h.reply(3);
		await retry;
		const attach = h.t.attach(next);
		h.reply(4);
		const replacement = (await attach).permit;
		expect(h.t.isPermitCurrent(previous)).toBe(false);
		expect(h.t.isPermitCurrent(replacement)).toBe(true);
	});
	it('rejects attach when inventory changed after prepare', async () => {
		const h = fixture();
		await h.prepare();
		const request = h.t.attach(tuple);
		h.reply(1, { inventoryHash: 'e'.repeat(64) });
		expect((await request).reason).toBe('inventory-changed');
	});
	it('invalidates pending channels and old permits on pagehide without reviving them on BFCache pageshow', async () => {
		const h = fixture();
		await h.prepare();
		const old = (await h.attach()).permit;
		const pending = h.t.status(tuple);
		h.window.dispatchEvent(new Event('pagehide'));
		expect((await pending).reason).toBe('page-hidden');
		expect(h.t.isPermitCurrent(old)).toBe(false);
		const showing = new Event('pageshow');
		Object.defineProperty(showing, 'persisted', { value: true });
		h.window.dispatchEvent(showing);
		expect(h.t.isPermitCurrent(old)).toBe(false);
		expect((await h.t.attach(tuple)).reason).toBe('not-prepared');
	});
	it('never equates timeout to readiness and ignores late messages', async () => {
		vi.useFakeTimers();
		const h = fixture();
		await h.prepare();
		const task = h.t.attach(tuple);
		await vi.advanceTimersByTimeAsync(4000);
		expect((await task).reason).toBe('worker-timeout');
		h.reply(1);
		expect(h.t.getState().status).not.toBe('ready');
	});
	it('waits for actual activation before resolving an update and invalidates old permits', async () => {
		const h = fixture();
		await h.prepare();
		const permit = (await h.attach()).permit;
		const waiting = { postMessage: h.worker.postMessage };
		h.serviceWorker.getRegistration = async () => ({ waiting });
		let completed = false;
		const pending = h.t.requestUpdate().then((result) => {
			completed = true;
			return result;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		h.reply(2, { reason: 'activation-requested' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(completed).toBe(false);
		expect(h.t.isPermitCurrent(permit)).toBe(true);
		h.serviceWorker.controller = waiting;
		h.serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(await pending).toEqual({ status: 'ready', reason: 'activated' });
		expect(h.t.isPermitCurrent(permit)).toBe(false);
	});
	it('rejects an unexpected controller replacement during update', async () => {
		const h = fixture();
		h.serviceWorker.getRegistration = async () => ({ waiting: { postMessage: h.worker.postMessage } });
		const pending = h.t.requestUpdate();
		await new Promise((resolve) => setTimeout(resolve, 0));
		h.serviceWorker.controller = {};
		h.serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect((await pending).reason).toBe('controller-changed');
	});
	it('cannot let a superseded ATTACH reply revoke the newest running permit', async () => {
		const h = fixture();
		await h.prepare();
		const second = { ...tuple, appearanceRevision: 2 };
		const preparing = h.t.prepare(second);
		h.reply(1);
		await preparing;
		const old = h.t.attach(tuple);
		const current = h.t.attach(second);
		h.reply(3);
		const latest = await current;
		h.reply(2);
		expect((await old).reason).toBe('superseded-attach');
		expect(h.t.isPermitCurrent(latest.permit)).toBe(true);
		expect(h.t.getState().tuple.appearanceRevision).toBe(2);
	});
	it('invalidates the old permit when an ATTACH outcome is unknown after timeout', async () => {
		vi.useFakeTimers();
		const h = fixture();
		await h.prepare();
		const old = (await h.attach()).permit;
		const events = [];
		h.t.subscribe((event) => events.push(event));
		const attaching = h.t.attach(tuple);
		await vi.advanceTimersByTimeAsync(4000);
		expect((await attaching).reason).toBe('worker-timeout');
		expect(h.t.isPermitCurrent(old)).toBe(false);
		expect(events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: 'worker-timeout' }));
		h.reply(2);
		expect(h.t.isPermitCurrent(old)).toBe(false);
	});
});

describe('telling a controller from before the runtime protocol apart', () => {
	const answer = (h, index, changes = {}) =>
		h.requests[index].port.postMessage({
			protocol: '2fa-runtime-v1',
			nonce: h.requests[index].request.nonce,
			workerBuild: tuple.hostBuild,
			...changes,
		});
	it('asks the controller once and remembers that it answers', async () => {
		const h = fixture();
		const asking = h.t.controllerAnswers();
		expect(h.requests[0].request.type).toBe('RUNTIME_PROTOCOL_INFO');
		answer(h, 0);
		expect(await asking).toBe(true);
		expect(await h.t.controllerAnswers()).toBe(true);
		expect(h.requests).toHaveLength(1);
	});
	it('reports a silent controller after the timeout and asks again the next time', async () => {
		vi.useFakeTimers();
		const h = fixture();
		const asking = h.t.controllerAnswers();
		// An answer to another question does not count.
		answer(h, 0, { nonce: 'other-question' });
		await vi.advanceTimersByTimeAsync(3999);
		answer(h, 0, { protocol: 'other-protocol' });
		await vi.advanceTimersByTimeAsync(1);
		expect(await asking).toBe(false);
		const again = h.t.controllerAnswers();
		expect(h.requests).toHaveLength(2);
		answer(h, 1);
		expect(await again).toBe(true);
	});
	it('asks a new controller again and needs no question without one', async () => {
		const h = fixture();
		const first = h.t.controllerAnswers();
		answer(h, 0);
		await first;
		h.serviceWorker.controller = { postMessage: h.worker.postMessage };
		const second = h.t.controllerAnswers();
		expect(h.requests).toHaveLength(2);
		answer(h, 1);
		expect(await second).toBe(true);
		h.serviceWorker.controller = null;
		expect(await h.t.controllerAnswers()).toBe(false);
		expect(h.requests).toHaveLength(2);
	});
});

describe('verified cached ATTACH admission', () => {
	it('uses an old worker ATTACH reply directly and establishes STARTED proof before ready observers run', async () => {
		const h = fixture();
		expect(await h.t.attach(tuple, { tryCachedAttach: true })).toMatchObject({ status: 'blocked', reason: 'not-prepared' });
		let started;
		h.t.subscribe((event) => {
			if (event.type === 'ready') {
				started = h.t.startup(tuple);
			}
		});
		const attaching = h.t.tryAttachCached(tuple);
		expect(h.requests.map(({ request }) => request.type)).toEqual(['RUNTIME_ATTACH']);
		expect(h.requests[0].request.inventoryHash).toBeUndefined();
		h.reply(0, { workerBuild: 'e'.repeat(64) });
		const result = await attaching;
		expect(result).toMatchObject({ status: 'ready', permit: { workerBuild: 'e'.repeat(64), inventoryHash: hash } });
		expect(h.t.isPermitCurrent(result.permit)).toBe(true);
		expect(h.requests[1].request).toMatchObject({ type: 'RUNTIME_STARTED', inventoryHash: hash, shellConfigId: shell, tuple });
		h.reply(1);
		expect((await started).status).toBe('ready');
	});
	it.each(['not-prepared', 'evicted'])('recognizes only the current old-shaped %s reply as a repairable miss', async (reason) => {
		const h = fixture();
		const events = [];
		h.t.subscribe((event) => events.push(event));
		const attaching = h.t.tryAttachCached(tuple);
		const { request, port } = h.requests[0];
		port.postMessage({
			protocol: request.protocol,
			nonce: request.nonce,
			generation: request.generation,
			tuple,
			workerBuild: 'e'.repeat(64),
			status: 'blocked',
			reason,
		});
		expect(await attaching).toMatchObject({ status: 'miss', reason, resourcesReady: false, recoveryReady: false });
		expect(events.some((event) => event.type === 'invalidated')).toBe(false);
		expect(h.t.getState().status).toBe('idle');
		expect(await h.t.startup(tuple)).toMatchObject({ status: 'blocked', reason: 'not-prepared' });
		await h.prepare();
		expect((await h.attach()).status).toBe('ready');
		expect(h.requests.map(({ request: item }) => item.type)).toEqual(['RUNTIME_ATTACH', 'RUNTIME_PREPARE', 'RUNTIME_ATTACH']);
	});
	it.each([
		{ status: 'miss', reason: 'not-prepared' },
		{ status: 'blocked', reason: 'storage-unavailable' },
		{ status: 'blocked', reason: 'activation-blocked' },
	])('invalidates uncertain or unsupported worker failure $status/$reason', async (failure) => {
		const h = fixture();
		const events = [];
		h.t.subscribe((event) => events.push(event));
		const attaching = h.t.tryAttachCached(tuple);
		h.reply(0, failure);
		expect(await attaching).toMatchObject({ status: 'blocked', reason: failure.reason });
		expect(events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: failure.reason }));
	});
	it.each([
		{ compatible: 1 },
		{ resourcesReady: 'true' },
		{ recoveryReady: false },
		{ shellConfigId: 'e'.repeat(64) },
		{ inventoryHash: 'invalid' },
		{ permitId: '' },
		{ workerBuild: 'invalid' },
	])('rejects incomplete ready proof %j without establishing preparations', async (changes) => {
		const h = fixture();
		const attaching = h.t.tryAttachCached(tuple);
		h.reply(0, changes);
		expect((await attaching).status).toBe('blocked');
		expect(await h.t.startup(tuple)).toMatchObject({ status: 'blocked', reason: 'not-prepared' });
		expect(h.requests).toHaveLength(1);
	});
	it('still compares an existing preparation hash on the cached path', async () => {
		const h = fixture();
		await h.prepare();
		const attaching = h.t.tryAttachCached(tuple);
		expect(h.requests[1].request.inventoryHash).toBe(hash);
		h.reply(1, { inventoryHash: 'e'.repeat(64) });
		expect(await attaching).toMatchObject({ status: 'blocked', reason: 'inventory-changed' });
	});
	it.each([{ nonce: 'forged' }, { generation: 99 }, { tuple: { ...tuple, appearanceRevision: 2 } }, { protocol: 'unknown' }])(
		'ignores an uncorrelated miss %j',
		async (changes) => {
			const h = fixture();
			let settled = false;
			const attaching = h.t.tryAttachCached(tuple).then((result) => {
				settled = true;
				return result;
			});
			h.reply(0, { status: 'blocked', reason: 'not-prepared', ...changes });
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(settled).toBe(false);
			h.reply(0, { status: 'blocked', reason: 'evicted' });
			expect(await attaching).toMatchObject({ status: 'miss', reason: 'evicted' });
		},
	);
	it('does not accept an old controller miss before controllerchange is delivered', async () => {
		const h = fixture();
		const attaching = h.t.tryAttachCached(tuple);
		h.serviceWorker.controller = {};
		h.reply(0, { status: 'blocked', reason: 'evicted' });
		expect(await attaching).toMatchObject({ status: 'blocked', reason: 'controller-changed' });
	});
	it.each(['pagehide', 'controllerchange'])(
		'invalidates a pending cached attach on %s rather than accepting a late miss',
		async (event) => {
			const h = fixture();
			const attaching = h.t.tryAttachCached(tuple);
			(event === 'pagehide' ? h.window : h.serviceWorker).dispatchEvent(new Event(event));
			h.reply(0, { status: 'blocked', reason: 'not-prepared' });
			expect((await attaching).status).toBe('blocked');
			expect(h.t.getState().reason).toBe(event === 'pagehide' ? 'page-hidden' : 'controller-changed');
		},
	);
	it('cannot let a superseded miss revoke a newer cached permit', async () => {
		const h = fixture();
		const older = h.t.tryAttachCached(tuple);
		const newer = h.t.tryAttachCached({ ...tuple, appearanceRevision: 2 });
		h.reply(1);
		const current = await newer;
		h.reply(0, { status: 'blocked', reason: 'not-prepared' });
		expect(await older).toMatchObject({ status: 'blocked', reason: 'superseded-attach' });
		expect(h.t.isPermitCurrent(current.permit)).toBe(true);
	});
	it('does not downgrade a timeout or a late miss when the pin outcome is unknown', async () => {
		vi.useFakeTimers();
		const h = fixture();
		await h.prepare();
		const previous = (await h.attach()).permit;
		const events = [];
		h.t.subscribe((event) => events.push(event));
		const attaching = h.t.tryAttachCached(tuple);
		await vi.advanceTimersByTimeAsync(4000);
		expect(await attaching).toMatchObject({ status: 'blocked', reason: 'worker-timeout' });
		expect(h.t.isPermitCurrent(previous)).toBe(false);
		expect(events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: 'worker-timeout' }));
		h.reply(2, { status: 'blocked', reason: 'not-prepared' });
		expect(h.t.getState().status).toBe('blocked');
	});
	it('keeps local same-name failures and caller-supplied workers out of the miss path', async () => {
		const h = fixture();
		const foreign = { postMessage: vi.fn() };
		h.worker.postMessage = () => {
			throw new Error('not-prepared');
		};
		expect(await h.t.tryAttachCached(tuple, { worker: foreign, requireController: false })).toMatchObject({
			status: 'blocked',
			reason: 'message-failed',
		});
		expect(foreign.postMessage).not.toHaveBeenCalled();
		h.serviceWorker.controller = null;
		expect(await h.t.tryAttachCached(tuple, { worker: foreign, requireController: false })).toMatchObject({
			status: 'blocked',
			reason: 'no-controller',
		});
	});
});
