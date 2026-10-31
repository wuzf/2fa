import { afterEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import {
	createAppThemePreview,
	createAppThemePreviewDocument,
	createAppPreviewMockSdk,
	appThemePreviewFrame,
	getAppThemePreviewCode,
} from '../../src/ui/scripts/appThemePreview.js';
const packageId = 'b'.repeat(64),
	id = 'a'.repeat(64),
	hash = 'c'.repeat(64);
const input = (title = 'Demo') => ({
	packageId,
	appearance: { settings: { title, picture: '' } },
	mode: 'light',
	language: 'en',
	scene: 'workspace',
});
function capability() {
	const baseUrl = '/theme-preview/' + id + '/';
	return {
		capabilityId: id,
		expiresAt: Date.now() + 300000,
		baseUrl,
		entryUrl: baseUrl + 'entry.js',
		styles: [],
		appearance: {
			kind: 'app',
			packageId,
			package: { id: 'demo', name: 'Demo', version: '1.0.0' },
			settings: {},
			manifest: {
				themeApiVersion: 2,
				kind: 'app',
				sdkApiVersion: 1,
				id: 'demo',
				name: 'Demo',
				version: '1.0.0',
				settings: [
					{ key: 'title', type: 'text', default: 'Demo' },
					{ key: 'picture', type: 'text', default: '' },
				],
			},
			files: [
				{ path: 'entry.js', url: baseUrl + 'entry.js', mime: 'text/javascript', size: 10, hash },
				{ path: 'images/p.png', url: baseUrl + 'images/p.png', mime: 'image/png', size: 68, hash: 'd'.repeat(64) },
			],
		},
	};
}
const fixtures = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const h of fixtures.splice(0)) {
		h.preview.dispose();
		await h.window.happyDOM.abort();
	}
	vi.unstubAllGlobals();
});
function setup(options = {}) {
	const window = new Window({ url: 'https://vault.test/' }),
		container = window.document.createElement('section');
	window.document.body.append(container);
	const channels = [],
		configs = [],
		messages = [];
	class Channel {
		constructor() {
			this.port1 = { onmessage: null, postMessage: (data) => messages.push(data), start() {}, close: vi.fn() };
			this.port2 = { close() {} };
			channels.push(this);
		}
	}
	window.MessageChannel = Channel;
	const request = vi.fn(async (url, init) => Response.json(init?.method === 'POST' ? capability() : { revoked: true }));
	const action = vi.fn(),
		status = vi.fn();
	let logout;
	if (options.emitted) {
		window.eval(getAppThemePreviewCode());
	}
	const preview = (options.emitted ? window.createAppThemePreview : createAppThemePreview)({
		window,
		container,
		request,
		onStatus: status,
		onMockAction: action,
		subscribeSession: (listener) => {
			logout = listener;
			return () => {};
		},
		createDocument: (config) => {
			configs.push(config);
			return '<html><body>Controlled test frame</body></html>';
		},
		...options,
	});
	const h = {
		preview,
		window,
		container,
		request,
		channels,
		configs,
		messages,
		action,
		status,
		logout: () => logout(),
		hello(source, overrides = {}) {
			const config = configs.at(-1),
				frame = container.querySelector('iframe');
			vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
			window.dispatchEvent(
				new window.MessageEvent('message', {
					source: source || frame.contentWindow,
					origin: 'null',
					data: { type: 'preview-hello', nonce: config.nonce, session: config.session, ...overrides },
				}),
			);
		},
		port(data) {
			const config = configs.at(-1);
			channels.at(-1).port1.onmessage?.({ data: { nonce: config.nonce, session: config.session, ...data } });
		},
		ready() {
			this.hello();
			this.port({ type: 'report', value: { type: 'ready', imageFailures: 0 } });
		},
	};
	fixtures.push(h);
	return h;
}

describe('opaque app preview client', () => {
	it('uses only allow-scripts and authenticated capability creation, with no real account data', async () => {
		const h = setup();
		expect((await h.preview.open(input())).status).toBe('loading');
		expect(h.container.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts');
		expect(h.request.mock.calls[0][0]).toBe('/api/themes/preview-capabilities');
		expect(JSON.parse(h.request.mock.calls[0][1].body)).toEqual({
			packageId,
			settings: { title: 'Demo', picture: '' },
		});
		expect(h.configs[0].appearance.package.name).toBe('Demo');
		expect(JSON.stringify(h.configs[0])).not.toContain('secret');
		h.ready();
		expect(h.preview.getState().status).toBe('ready');
	});
	it('rejects another opaque window, wrong nonce and duplicate handshakes; only valid mock commands execute once', async () => {
		const h = setup();
		await h.preview.open(input());
		h.hello(h.window);
		h.hello(null, { nonce: 'forged' });
		expect(h.channels).toHaveLength(0);
		h.hello();
		h.hello();
		expect(h.channels).toHaveLength(1);
		h.port({ type: 'command', seq: 1, command: 'otp.copy', args: { id: 'preview-mail' }, session: 'stale' });
		expect(h.action).not.toHaveBeenCalled();
		h.port({ type: 'command', seq: 1, command: 'otp.copy', args: { id: 'preview-mail' } });
		h.port({ type: 'command', seq: 1, command: 'otp.copy', args: { id: 'preview-mail' } });
		expect(h.action).toHaveBeenCalledTimes(1);
		h.port({ type: 'command', seq: 2, command: 'export-secrets' });
		h.port({ type: 'command', seq: 3, command: 'otp.copy', args: { id: 'real-account' } });
		expect(h.action).toHaveBeenCalledTimes(1);
	});
	it('revokes locally before waiting for remote DELETE and refuses late port messages', async () => {
		const h = setup();
		await h.preview.open(input());
		h.ready();
		const handler = h.channels[0].port1.onmessage;
		h.request.mockImplementationOnce(() => new Promise(() => {}));
		expect(h.preview.close().status).toBe('closed');
		expect(h.container.querySelector('iframe')).toBeNull();
		expect(h.channels[0].port1.close).toHaveBeenCalled();
		handler({ data: { type: 'command', seq: 1, command: 'accounts.refresh', nonce: h.configs[0].nonce, session: h.configs[0].session } });
		expect(h.action).not.toHaveBeenCalled();
		expect(h.request).toHaveBeenLastCalledWith('/api/themes/preview-capabilities/' + id, { method: 'DELETE' });
	});
	it('reuses a fixed capability for updates, preserving pending edits before first ready', async () => {
		const h = setup();
		await h.preview.open(input());
		await h.preview.update({ ...input('Changed during import'), scene: 'offline' });
		expect(h.channels).toHaveLength(0);
		h.ready();
		const update = h.messages.find((message) => message.type === 'update');
		expect(update.value.appearance.settings.title).toBe('Changed during import');
		expect(update.value.scene).toBe('offline');
		h.port({ type: 'report', value: { type: 'updated', version: update.version } });
		expect(h.preview.getState().status).toBe('ready');
		const expiresAt = h.preview.getState().expiresAt;
		await h.preview.update({ ...input('Again'), mode: 'dark' });
		expect(h.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
		expect(h.preview.getState().expiresAt).toBe(expiresAt);
	});
	it('retains updates while capability creation is pending and revokes a response arriving after close', async () => {
		let resolve;
		const h = setup();
		h.request.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const opening = h.preview.open(input());
		await h.preview.update(input('Latest draft'));
		resolve(Response.json(capability()));
		await opening;
		expect(h.configs[0].appearance.settings.title).toBe('Latest draft');
		h.preview.close();
		h.request.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const late = h.preview.open(input());
		h.preview.close();
		resolve(Response.json(capability()));
		await late;
		expect(h.container.querySelector('iframe')).toBeNull();
		expect(h.request).toHaveBeenLastCalledWith('/api/themes/preview-capabilities/' + id, { method: 'DELETE' });
	});
	it('rejects an undeclared setting without consuming another capability and allows a corrected update', async () => {
		const h = setup();
		await h.preview.open(input());
		h.ready();
		expect(await h.preview.update({ ...input(), appearance: { settings: { title: 'Demo', unknown: 'x' } } })).toMatchObject({
			reason: 'preview-invalid-config',
		});
		await h.preview.update({ ...input(), appearance: { settings: { title: 'Fixed', picture: 'images/p.png' } } });
		expect(h.messages.at(-1).value.appearance.settings).toEqual({ title: 'Fixed', picture: 'images/p.png' });
		expect(h.messages.at(-1).value.appearance).not.toHaveProperty('branding');
		expect(h.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
	});
	it('blocks new offline previews, expires fixed capabilities and closes on session invalidation', async () => {
		const h = setup();
		Object.defineProperty(h.window.navigator, 'onLine', { configurable: true, value: false });
		expect(await h.preview.open(input())).toMatchObject({ reason: 'offline-preview-unavailable' });
		expect(h.request).not.toHaveBeenCalled();
		Object.defineProperty(h.window.navigator, 'onLine', { configurable: true, value: true });
		await h.preview.open(input());
		h.ready();
		const expiry = h.preview.getState().expiresAt;
		vi.spyOn(Date, 'now').mockReturnValue(expiry);
		expect(await h.preview.update(input())).toMatchObject({ reason: 'preview-expired' });
		expect(h.container.children).toHaveLength(0);
		vi.restoreAllMocks();
		await h.preview.open(input());
		h.logout();
		expect(h.preview.getState().status).toBe('closed');
		expect(h.container.children).toHaveLength(0);
	});
	it('rejects foreign or unlisted capability URLs and revokes the rejected capability', async () => {
		const h = setup();
		const cap = capability();
		cap.entryUrl = 'https://external.test/entry.js';
		h.request.mockResolvedValueOnce(Response.json(cap));
		expect(await h.preview.open(input())).toMatchObject({ reason: 'preview-invalid-resource' });
		expect(h.container.children).toHaveLength(0);
		expect(h.request.mock.calls[1][1].method).toBe('DELETE');
	});
	it('uses the emitted wrapper session observer to remove the frame before notifying its editor', async () => {
		const window = new Window({ url: 'https://vault.test/', settings: { disableJavaScriptEvaluation: true } });
		const container = window.document.createElement('section');
		window.document.body.append(container);
		let session = { sessionGeneration: 1, blocked: false };
		let notify;
		const unsubscribe = vi.fn();
		const accounts = {
			getSessionGeneration: () => session.sessionGeneration,
			getState: () => session,
			subscribe: (listener) => {
				notify = listener;
				return unsubscribe;
			},
		};
		vm.runInNewContext(getAppThemePreviewCode(), {
			window,
			document: window.document,
			getThemeRuntime: () => ({ accounts }),
			URL,
			AbortController,
		});
		const request = vi.fn(async (_, init) => Response.json(init.method === 'POST' ? capability() : { revoked: true }));
		const onSessionInvalidated = vi.fn(() => expect(container.querySelector('iframe')).toBeNull());
		const preview = window.createAppThemePreview({ container, request, onSessionInvalidated });
		fixtures.push({ preview, window });
		expect((await preview.open(input())).status).toBe('loading');
		expect(container.querySelector('iframe').srcdoc).toContain("connect-src 'none'");
		notify();
		expect(onSessionInvalidated).not.toHaveBeenCalled();
		session = { sessionGeneration: 2, blocked: true };
		notify();
		expect(onSessionInvalidated).toHaveBeenCalledOnce();
		expect(preview.getState().status).toBe('closed');
		expect(request).toHaveBeenLastCalledWith('/api/themes/preview-capabilities/' + id, { method: 'DELETE' });
		preview.dispose();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
	it('keeps synthetic offline state and SDK shape without native clipboard/API access', async () => {
		const call = vi.fn(async () => ({ status: 'completed' }));
		const mock = createAppPreviewMockSdk({ config: { ...input(), scene: 'offline', appearance: { packageId } }, call, now: () => 59000 });
		expect(mock.sdk.getSnapshot().connectivity.onlineHint).toBe(false);
		expect(mock.sdk.getSnapshot().library.source).toBe('local');
		expect(mock.sdk.getSnapshot().queue.operations).toHaveLength(1);
		const target = mock.sdk.otp.readCopyTarget('preview-hotp').target;
		expect(await mock.sdk.otp.copy(target)).toMatchObject({ preview: true, clipboard: 'copied' });
		expect(call).toHaveBeenCalledWith('otp.copy', { id: 'preview-hotp', slot: 'current' });
		expect(JSON.stringify(mock.sdk.getSnapshot())).not.toContain('secret');
		mock.dispose();
		expect(mock.sdk.clock.now()).toBeNull();
		expect((await mock.sdk.accounts.refresh()).status).toBe('rejected');
	});
	it('keeps the synthetic clock within its published OTP window and advances both together on publication', async () => {
		let time = 59000;
		const call = vi.fn(async () => ({ status: 'completed', preview: true }));
		const mock = createAppPreviewMockSdk({ config: { ...input(), appearance: { packageId } }, call, now: () => time });
		const initial = mock.sdk.getSnapshot();
		expect(initial.library.source).toBe('server');
		expect(initial.clock.status).toBe('ready');
		expect(mock.sdk.identity.mode).toBe('preview');
		expect(mock.sdk.clock.now()).toBe(initial.clock.correctedNow);
		time += 90000;
		expect(mock.sdk.getSnapshot()).toBe(initial);
		expect(mock.sdk.clock.now()).toBe(59000);
		expect(mock.sdk.clock.now()).toBeLessThan(initial.library.accounts[0].otp.current.validUntil);
		const target = mock.sdk.otp.readCopyTarget('preview-mail').target;
		expect(await mock.sdk.otp.copy(target)).toMatchObject({ preview: true, clipboard: 'copied' });
		expect(call).toHaveBeenCalledWith('otp.copy', { id: 'preview-mail', slot: 'current' });
		const published = mock.sdk.getSnapshot();
		expect(published).not.toBe(initial);
		expect(mock.sdk.clock.now()).toBe(time);
		expect(published.clock.correctedNow).toBe(time);
		expect(published.library.accounts[0].otp.current.validFrom).toBeLessThanOrEqual(time);
		expect(published.library.accounts[0].otp.current.validUntil).toBeGreaterThan(time);
		time += 90000;
		mock.update({ ...input(), scene: 'offline', appearance: { packageId } });
		expect(mock.sdk.getSnapshot()).toMatchObject({
			library: { source: 'local' },
			connectivity: { onlineHint: false },
			clock: { correctedNow: time },
		});
		expect(mock.sdk.clock.now()).toBe(time);
		mock.dispose();
		expect(mock.sdk.clock.now()).toBeNull();
	});
	it('expires a real preview capability using wall time even though the synthetic display clock is frozen', async () => {
		const h = setup();
		await h.preview.open(input());
		h.ready();
		const wallTime = Date.now();
		const mock = createAppPreviewMockSdk({ config: { ...input(), appearance: { packageId } }, call: vi.fn(), now: () => Date.now() });
		const initialDisplayTime = mock.sdk.clock.now();
		vi.spyOn(Date, 'now').mockReturnValue(h.preview.getState().expiresAt);
		expect(Date.now()).toBeGreaterThan(wallTime + 30000);
		expect(mock.sdk.clock.now()).toBe(initialDisplayTime);
		expect(await h.preview.update(input())).toMatchObject({ status: 'blocked', reason: 'preview-expired' });
		expect(h.container.querySelector('iframe')).toBeNull();
		expect(h.channels[0].port1.close).toHaveBeenCalledOnce();
		expect(h.request).toHaveBeenLastCalledWith('/api/themes/preview-capabilities/' + id, { method: 'DELETE' });
		mock.dispose();
	});
	it.each(['object', 'cleanup'])('remounts a legal %s-only theme in the same opaque frame when optional update is absent', async (kind) => {
		const window = new Window({ url: 'https://vault.test/', settings: { disableJavaScriptEvaluation: true } });
		window.document.body.innerHTML = '<main id="app"></main>';
		Object.defineProperty(window.document, 'images', { get: () => [] });
		window.postMessage = vi.fn();
		const mounts = [],
			cleanups = vi.fn(),
			reports = [];
		vi.stubGlobal('window', window);
		vi.stubGlobal('document', window.document);
		vi.stubGlobal('__previewTestMounts', mounts);
		vi.stubGlobal('__previewTestCleanup', cleanups);
		const source = `export function mount(args) { globalThis.__previewTestMounts.push(args); args.root.textContent=args.appearance.settings.title; const cleanup=()=>globalThis.__previewTestCleanup(); return ${kind === 'object' ? '{unmount:cleanup}' : 'cleanup'}; }`;
		const config = {
			nonce: 'session-nonce',
			session: 'session-id',
			parentOrigin: 'https://vault.test',
			expiresAt: Date.now() + 300000,
			styles: [],
			appearance: input('First').appearance,
			entryUrl: 'data:text/javascript,' + encodeURIComponent(source),
		};
		const port = { onmessage: null, postMessage: (data) => reports.push(data), start() {}, close: vi.fn() };
		const dispose = () => port.onmessage?.({ data: { type: 'dispose', nonce: config.nonce, session: config.session } });
		fixtures.push({ window, preview: { dispose } });
		appThemePreviewFrame(config, createAppPreviewMockSdk);
		window.dispatchEvent(
			new window.MessageEvent('message', {
				source: window.parent,
				origin: config.parentOrigin,
				data: { type: 'preview-connect', nonce: config.nonce, session: config.session },
				ports: [port],
			}),
		);
		await vi.waitFor(() => expect(reports.some((message) => message.value?.type === 'ready')).toBe(true));
		const old = mounts[0];
		await port.onmessage({
			data: {
				type: 'update',
				nonce: config.nonce,
				session: config.session,
				version: 1,
				value: { ...input('Second'), appearance: input('Second').appearance, mode: 'dark', scene: 'offline' },
			},
		});
		await vi.waitFor(() => expect(reports.some((message) => message.value?.type === 'updated' && message.value.version === 1)).toBe(true));
		expect(reports.some((message) => message.value?.type === 'error')).toBe(false);
		expect(mounts).toHaveLength(2);
		expect(cleanups).toHaveBeenCalledOnce();
		expect(old.root.isConnected).toBe(false);
		expect(old.signal.aborted).toBe(true);
		expect(old.sdk.clock.now()).toBeNull();
		expect(mounts[1].signal.aborted).toBe(false);
		expect(mounts[1].sdk.getSnapshot().connectivity.onlineHint).toBe(false);
		expect(window.document.documentElement.dataset.theme).toBe('dark');
		expect(window.document.getElementById('app').textContent).toBe('Second');
		await dispose();
		expect(cleanups).toHaveBeenCalledTimes(2);
		expect(mounts[1].signal.aborted).toBe(true);
	});
	it('reports an updated image failure as blocked and allows a corrected config to recover within the same cap', async () => {
		const h = setup();
		await h.preview.open(input());
		h.hello();
		h.port({ type: 'report', value: { type: 'ready', imageFailures: 1 } });
		expect(h.preview.getState()).toMatchObject({ status: 'blocked', reason: 'preview-image-failed' });
		await h.preview.update(input('Fixed image'));
		const version = h.messages.at(-1).version;
		h.port({ type: 'report', value: { type: 'updated', version, imageFailures: 1 } });
		expect(h.preview.getState()).toMatchObject({ status: 'blocked', reason: 'preview-image-failed' });
		await h.preview.update(input('Fixed again'));
		h.port({ type: 'report', value: { type: 'updated', version: h.messages.at(-1).version, imageFailures: 0 } });
		expect(h.preview.getState().status).toBe('ready');
		expect(h.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
	});
	it('ignores source-free optional image placeholders but reports a configured broken image even when hidden', async () => {
		const window = new Window({ url: 'https://vault.test/', settings: { disableJavaScriptEvaluation: true } });
		window.document.body.innerHTML = '<main id="app"></main>';
		Object.defineProperty(window.document, 'images', { get: () => window.document.querySelectorAll('img') });
		window.postMessage = vi.fn();
		vi.stubGlobal('window', window);
		vi.stubGlobal('document', window.document);
		const source = `export function mount({root}) {
			const placeholder = root.ownerDocument.createElement('img'); placeholder.hidden = true;
			Object.defineProperties(placeholder, { complete: {value:false}, naturalWidth: {value:0} });
			const optional = root.ownerDocument.createElement('img'); optional.hidden = true;
			Object.defineProperties(optional, { complete: {value:true}, naturalWidth: {value:0} });
			root.append(placeholder, optional);
			return { update(appearance) {
				optional.removeAttribute('src'); optional.removeAttribute('srcset');
				if (appearance.settings.picture) optional.setAttribute(appearance.settings.kind || 'src', appearance.settings.picture);
			} };
		}`;
		const config = {
			nonce: 'images-nonce',
			session: 'images-session',
			parentOrigin: 'https://vault.test',
			expiresAt: Date.now() + 300000,
			styles: [],
			appearance: input().appearance,
			entryUrl: 'data:text/javascript,' + encodeURIComponent(source),
		};
		const reports = [];
		const port = { onmessage: null, postMessage: (data) => reports.push(data), start() {}, close: vi.fn() };
		const dispose = () => port.onmessage?.({ data: { type: 'dispose', nonce: config.nonce, session: config.session } });
		fixtures.push({ window, preview: { dispose } });
		appThemePreviewFrame(config, createAppPreviewMockSdk);
		window.dispatchEvent(
			new window.MessageEvent('message', {
				source: window.parent,
				origin: config.parentOrigin,
				data: { type: 'preview-connect', nonce: config.nonce, session: config.session },
				ports: [port],
			}),
		);
		await vi.waitFor(() => expect(reports.find((message) => message.value?.type === 'ready')?.value.imageFailures).toBe(0));
		expect(window.document.querySelectorAll('img[hidden]')).toHaveLength(2);
		const update = async (version, picture, kind = 'src') => {
			await port.onmessage({
				data: {
					type: 'update',
					nonce: config.nonce,
					session: config.session,
					version,
					value: { appearance: { ...input().appearance, settings: { picture, kind } } },
				},
			});
			await vi.waitFor(() =>
				expect(reports.some((message) => message.value?.type === 'updated' && message.value.version === version)).toBe(true),
			);
			return reports.find((message) => message.value?.type === 'updated' && message.value.version === version).value.imageFailures;
		};
		expect(await update(1, 'https://vault.test/missing-logo.png')).toBe(1);
		expect(await update(2, 'https://vault.test/missing-logo.png 2x', 'srcset')).toBe(1);
		expect(await update(3, '')).toBe(0);
		expect(reports.some((message) => message.value?.type === 'error')).toBe(false);
	});
	it('runs the emitted production factory with its explicitly injected preview appearance validator', async () => {
		const h = setup({ emitted: true });
		await h.preview.open(input());
		expect(h.preview.getState().status).toBe('loading');
		const frame = h.container.querySelector('iframe');
		expect(frame).not.toBeNull();
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
		const source = frame.srcdoc.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
		expect(source).toMatch(/normalizeAppearance:\s*\(+function normalizeHostAppearance/);
		expect(source).toContain('setAppearance(input)');
		expect(() => new vm.Script(source)).not.toThrow();
		expect(h.window.document.querySelector('style[data-app-host-appearance]')).toBeNull();
	});
	it('emits a strict opaque document and a browser factory without host SDK or account ports', () => {
		const cap = capability();
		const config = {
			baseUrl: 'https://vault.test' + cap.baseUrl,
			scriptNonce: 'nonce',
			appearance: { packageId },
			parentOrigin: 'https://vault.test',
		};
		const html = createAppThemePreviewDocument(config, appThemePreviewFrame.toString(), createAppPreviewMockSdk.toString());
		expect(html).toContain("connect-src 'none'");
		expect(html).toContain("form-action 'none'");
		expect(html).toContain('window.parent');
		expect(html).not.toContain('allow-same-origin');
		expect(getAppThemePreviewCode()).toContain('accounts.subscribe');
		expect(getAppThemePreviewCode()).not.toContain('getPrivateRecords');
	});
});
