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
