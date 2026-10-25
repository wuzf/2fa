import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createMainPage } from '../../src/ui/page.js';
import { getAppearanceHead } from '../../src/ui/appearance.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const buildId = 'a'.repeat(64);
const packageId = 'b'.repeat(64);
const marker = 'data-app-theme-startup';
const record = { id: 'startup', name: 'Startup', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', type: 'TOTP' };
const appearance = {
	kind: 'app',
	packageId,
	revision: 1,
	settings: {},
	branding: {},
	manifest: {
		kind: 'app',
		themeApiVersion: 2,
		sdkApiVersion: 1,
		id: 'startup',
		name: 'Startup',
		version: '1.0.0',
		entry: 'entry.js',
		styles: ['style.css'],
		settings: [],
		files: [
			{ path: 'entry.js', mime: 'text/javascript', size: 1, sha256: 'c'.repeat(64) },
			{ path: 'style.css', mime: 'text/css', size: 1, sha256: 'd'.repeat(64) },
		],
	},
};
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
	vi.restoreAllMocks();
});
const withoutScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
function headSource(snapshot = appearance, safeMode = false) {
	return /<script>([\s\S]*?)<\/script>/.exec(getAppearanceHead(snapshot, { buildId, safeMode }))[1];
}
async function htmlPage({ snapshot = appearance, safeMode = false, runHead = true } = {}) {
	const window = new Window({
		url: 'https://vault.test/',
		settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true },
	});
	cleanups.push(() => window.happyDOM.abort());
	const html = await (await createMainPage({ appearance: snapshot, safeMode, buildId })).text();
	const bodyOffset = html.indexOf('<body');
	window.document.write(withoutScripts(html.slice(0, bodyOffset)));
	if (runHead) {
		window.eval(headSource(safeMode ? null : snapshot, safeMode));
	}
	const beforeBody = window.document.documentElement.getAttribute(marker);
	window.document.body.innerHTML = withoutScripts(
		html
			.slice(bodyOffset)
			.replace(/^<body[^>]*>/, '')
			.replace(/<\/body>[\s\S]*$/, ''),
	);
	return { window, document: window.document, html, beforeBody };
}
// Resolve the exact emitted HTML/CSS afresh. Happy DOM caches some
// ancestor-dependent matches; real first-frame painting is checked in Chrome.
function computed(h, selectors) {
	const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
	cleanups.push(() => window.happyDOM.abort());
	window.document.write(withoutScripts(h.document.documentElement.outerHTML));
	return selectors.map((selector) => {
		const node = window.document.querySelector(selector);
		return node ? window.getComputedStyle(node).display : null;
	});
}
function officialHidden(h) {
	expect(computed(h, ['#officialThemeRoot', '#officialThemeActions', '#officialThemeFooter'])).toEqual(['none', 'none', 'none']);
}
function officialVisible(h) {
	for (const display of computed(h, ['#officialThemeRoot', '#officialThemeActions', '#officialThemeFooter'])) {
		expect(display).not.toBeNull();
		expect(display).not.toBe('none');
	}
}
function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const ready = { status: 'ready', compatible: true, resourcesReady: true, recoveryReady: true };
async function runtimePage({ authenticated = true } = {}) {
	const clipboard = { writeText: vi.fn(async () => {}) };
	const h = await createRuntimeFixture({ appearance, buildId, clipboard });
	cleanups.push(() => h.dispose());
	h.window.eval(headSource());
	h.setClock(59000);
	const runtime = h.getThemeRuntime();
	if (authenticated) {
		h.replaceSecretRecords([record], { source: 'server', accessVerified: true });
	}
	const official = h.getOfficialAccountView();
	await runtime.otp.refresh();
	const preparation = deferred(),
		attachment = deferred(),
		styles = deferred(),
		importing = deferred(),
		mounting = deferred(),
		startup = deferred();
	const permit = {};
	const transport = {
		prepare: vi.fn(() => preparation.promise),
		attach: vi.fn(() => attachment.promise),
		startup: vi.fn(() => startup.promise),
		isPermitCurrent: (value) => value === permit,
		subscribe: () => () => {},
	};
	const importModule = vi.fn(() => importing.promise);
	const loadStyles = vi.fn(() => styles.promise);
	const mount = vi.fn(({ root }) => {
		root.append(Object.assign(h.document.createElement('button'), { textContent: 'Independent theme' }));
		return mounting.promise;
	});
	const create = h.window.createAppThemeHost;
	let host;
	h.window.createAppThemeHost = (options) => {
		host = create({ ...options, transport, loadStyles, importModule });
		return host;
	};
	return {
		...h,
		runtime,
		official,
		clipboard,
		transport,
		importModule,
		loadStyles,
		mount,
		permit,
		preparation,
		attachment,
		styles,
		importing,
		mounting,
		startup,
		host: () => host,
		start: () => h.initializeAppThemeIntegration(),
		async toImport() {
			preparation.resolve(ready);
			await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledOnce());
			attachment.resolve({ status: 'ready', permit });
			await vi.waitFor(() => expect(loadStyles).toHaveBeenCalledOnce());
			styles.resolve();
			await vi.waitFor(() => expect(importModule).toHaveBeenCalledOnce());
		},
	};
}

describe('app-theme first-frame presentation', () => {
	it('sets a host-only marker before body parsing, with a script-independent recovery entry', async () => {
		const h = await htmlPage();
		expect(h.beforeBody).toBe('pending');
		officialHidden(h);
		expect(computed(h, ['#appThemeStartup', '#appThemeRoot'])).toEqual(['flex', 'none']);
		expect(h.document.querySelector('#appThemeStartupRecovery').getAttribute('href')).toBe('/?safeMode=1');
		expect(h.document.querySelector('#appThemeStartup').textContent).toContain('正在验证访问权限');
		expect(h.document.querySelector('link[data-app-theme]')).toBeNull();
		expect(h.document.querySelector('script[src*="theme-packages"]')).toBeNull();
		expect(h.html.indexOf("setAttribute('data-app-theme-startup'")).toBeLessThan(h.html.indexOf('<body'));
		const modal = h.document.getElementById('loginModal');
		modal.classList.add('show');
		modal.style.display = 'flex';
		expect(computed(h, ['#loginModal'])).toEqual(['flex']);
	});
	it('keeps original DOM usable without JS or when the head script is blocked', async () => {
		const h = await htmlPage({ runHead: false });
		expect(h.beforeBody).toBeNull();
		officialVisible(h);
		expect(computed(h, ['#appThemeStartup'])).toEqual(['none']);
		expect(h.document.querySelector('#officialThemeActions button')).not.toBeNull();
	});
	it('retains an actual safe URL if core never executes after the head marker', async () => {
		const h = await htmlPage();
		expect(typeof h.window.requestAppearanceRuntimeReload).toBe('undefined');
		expect(h.document.getElementById('appThemeStartupRecovery').href).toBe('https://vault.test/?safeMode=1');
		expect(computed(h, ['#appThemeStartupRecovery'])).not.toContain('none');
		officialHidden(h);
	});
	it.each([
		['default', null, false],
		['v1', { manifest: { settings: [] } }, false],
		['safe app', appearance, true],
	])('does not gate the %s shell', async (_name, snapshot, safeMode) => {
		const h = await htmlPage({ snapshot, safeMode });
		expect(h.beforeBody).toBeNull();
		expect(h.document.getElementById('appThemeStartup')).toBeNull();
		officialVisible(h);
	});
	it('keeps the real account DOM concealed through every delayed permission/startup stage', async () => {
		const h = await runtimePage({ authenticated: false });
		h.document.getElementById('appThemeStartupRecovery').focus();
		const focus = vi.spyOn(h.window.HTMLElement.prototype, 'focus');
		h.start();
		expect(h.document.activeElement).toBe(h.document.querySelector('#appThemeRuntimeStatus [data-runtime-action="recovery"]'));
		officialHidden(h);
		expect(h.transport.prepare).not.toHaveBeenCalled();
		expect(h.importModule).not.toHaveBeenCalled();
		h.replaceSecretRecords([record], { source: 'local', accessVerified: true });
		await vi.waitFor(() => expect(h.transport.prepare).toHaveBeenCalledOnce());
		officialHidden(h);
		expect(h.loadStyles).not.toHaveBeenCalled();
		expect(h.importModule).not.toHaveBeenCalled();
		h.preparation.resolve(ready);
		await vi.waitFor(() => expect(h.transport.attach).toHaveBeenCalledOnce());
		officialHidden(h);
		expect(h.importModule).not.toHaveBeenCalled();
		h.attachment.resolve({ status: 'ready', permit: h.permit });
		await vi.waitFor(() => expect(h.loadStyles).toHaveBeenCalledOnce());
		officialHidden(h);
		expect(h.importModule).not.toHaveBeenCalled();
		h.styles.resolve();
		await vi.waitFor(() => expect(h.importModule).toHaveBeenCalledOnce());
		officialHidden(h);
		h.importing.resolve({ mount: h.mount });
		await vi.waitFor(() => expect(h.mount).toHaveBeenCalledOnce());
		officialHidden(h);
		const candidate = h.document.querySelector('[data-app-mount]');
		expect(candidate.inert).toBe(true);
		expect(candidate.style.visibility).toBe('hidden');
		h.mounting.resolve({ unmount() {} });
		await vi.waitFor(() => expect(h.transport.startup).toHaveBeenCalledOnce());
		officialHidden(h);
		expect(candidate.inert).toBe(true);
		h.startup.resolve(ready);
		await vi.waitFor(() => expect(h.host().getState().status).toBe('running'));
		expect(h.document.documentElement.hasAttribute(marker)).toBe(false);
		expect(h.document.querySelector('#officialThemeRoot,#officialThemeActions,#officialThemeFooter')).toBeNull();
		expect(h.document.getElementById('appThemeRoot').hidden).toBe(false);
		expect(candidate.inert).toBe(false);
		expect(candidate.style.visibility).toBe('');
		expect(h.document.activeElement).toBe(h.document.getElementById('appThemeRoot'));
		expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
		expect(computed(h, ['#appThemeStartup', '#appThemeRuntimeStatus', '#appThemeRoot'])).toEqual(['none', 'none', 'block']);
		expect(h.runtime.sdk.getSnapshot().library.accounts).toHaveLength(1);
	});
	it('does not move dialog focus when startup finishes and the runtime status hides', async () => {
		const h = await runtimePage();
		h.document.getElementById('appThemeStartupRecovery').focus();
		h.start();
		await h.toImport();
		h.importing.resolve({ mount: h.mount });
		await vi.waitFor(() => expect(h.mount).toHaveBeenCalledOnce());
		h.mounting.resolve({ unmount() {} });
		await vi.waitFor(() => expect(h.transport.startup).toHaveBeenCalledOnce());
		h.runtime.sdk.host.open({ kind: 'account-add' });
		const field = h.document.getElementById('secretName');
		field.focus();
		const focus = vi.spyOn(h.document.getElementById('appThemeRoot'), 'focus');
		h.startup.resolve(ready);
		await vi.waitFor(() => expect(h.host().getState().status).toBe('running'));
		expect(h.document.getElementById('appThemeRuntimeStatus').hidden).toBe(true);
		expect(h.document.activeElement).toBe(field);
		expect(focus).not.toHaveBeenCalled();
	});
	it('hands focus from the visible startup link to the new runtime recovery action without scrolling', async () => {
		const h = await runtimePage({ authenticated: false });
		const link = h.document.getElementById('appThemeStartupRecovery');
		link.focus();
		expect(computed(h, ['#appThemeStartup'])).toEqual(['flex']);
		const focus = vi.spyOn(h.window.HTMLElement.prototype, 'focus');
		h.start();
		const recovery = h.document.querySelector('#appThemeRuntimeStatus [data-runtime-action="recovery"]');
		expect(h.document.activeElement).toBe(recovery);
		expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
		expect(computed(h, ['#appThemeStartup', '#appThemeRuntimeStatus'])).toEqual(['none', 'flex']);
		expect(h.transport.prepare).not.toHaveBeenCalled();
	});
	it.each(['login', 'account-add'])('does not reclaim startup focus after a %s dialog takes it', async (kind) => {
		const h = await runtimePage();
		h.document.getElementById('appThemeStartupRecovery').focus();
		h.runtime.sdk.host.open({ kind });
		const field = h.document.getElementById(kind === 'login' ? 'loginToken' : 'secretName');
		field.focus();
		const focus = vi.spyOn(field, 'focus');
		h.start();
		expect(h.document.activeElement).toBe(field);
		expect(focus).not.toHaveBeenCalled();
	});
	it('does not steal focus if a login opens while the replacement status controls are created', async () => {
		const h = await runtimePage();
		const status = h.document.getElementById('appThemeRuntimeStatus');
		const append = status.append.bind(status);
		h.document.getElementById('appThemeStartupRecovery').focus();
		vi.spyOn(status, 'append').mockImplementationOnce((...nodes) => {
			append(...nodes);
			h.runtime.sdk.host.open({ kind: 'login' });
			h.document.getElementById('loginToken').focus();
		});
		h.start();
		expect(h.document.activeElement).toBe(h.document.getElementById('loginToken'));
	});
	it.each(['no-controller', 'runtime-incomplete'])('restores working official copy for pre-entry %s failure', async (reason) => {
		const h = await runtimePage();
		h.start();
		h.preparation.resolve({ status: 'blocked', reason });
		await vi.waitFor(() => expect(h.host().getState().status).toBe('official-fallback'));
		officialVisible(h);
		expect(h.document.documentElement.hasAttribute(marker)).toBe(false);
		expect(h.importModule).not.toHaveBeenCalled();
		expect(h.document.querySelector('[data-runtime-action="retry"]')).not.toBeNull();
		await h.official.copy(record.id);
		expect(h.clipboard.writeText).toHaveBeenCalledOnce();
	});
	it('never reveals official controls after entry starts, including later unavailable access', async () => {
		const h = await runtimePage();
		h.start();
		await h.toImport();
		h.importing.reject(new Error('synthetic entry failure'));
		await vi.waitFor(() => expect(h.document.getElementById('appThemeRuntimeStatus').dataset.phase).toBe('recovery-required'));
		officialHidden(h);
		h.invalidateSecretSession({ blocked: false });
		h.runtime.accounts.setReadStatus({ state: 'ready', refreshState: 'error', errorKey: 'coreConnectionFailed' });
		expect(h.document.getElementById('appThemeRuntimeStatus').dataset.phase).toBe('recovery-required');
		officialHidden(h);
		expect(h.document.querySelector('[data-runtime-action="recovery"]')).not.toBeNull();
	});
	it.each(['factory', 'root', 'status', 'throw'])(
		'restores official presentation when initialization has no usable %s',
		async (missing) => {
			const h = await runtimePage();
			h.document.getElementById('appThemeStartupRecovery').focus();
			const focus = vi.spyOn(h.window.HTMLElement.prototype, 'focus');
			if (missing === 'factory') {
				h.window.createAppThemeHost = null;
			} else if (missing === 'throw') {
				h.window.createAppThemeHost = () => {
					throw new Error('synthetic factory failure');
				};
			} else {
				h.document.getElementById(missing === 'root' ? 'appThemeRoot' : 'appThemeRuntimeStatus').remove();
			}
			h.start();
			officialVisible(h);
			expect(h.document.documentElement.hasAttribute(marker)).toBe(false);
			expect(h.document.activeElement).toBe(
				missing === 'throw'
					? h.document.querySelector('#appThemeRuntimeStatus [data-runtime-action="recovery"]')
					: h.document.getElementById('searchInput'),
			);
			expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
		},
	);
	it('preserves dialog focus when initialization must restore the official view', async () => {
		const h = await runtimePage();
		h.document.getElementById('appThemeStartupRecovery').focus();
		h.runtime.sdk.host.open({ kind: 'account-add' });
		const field = h.document.getElementById('secretName');
		field.focus();
		h.window.createAppThemeHost = null;
		h.start();
		officialVisible(h);
		expect(h.document.activeElement).toBe(field);
	});
	it('claims the static recovery link with the existing dirty-form and pending-write guard', async () => {
		const h = await runtimePage();
		const link = h.document.getElementById('appThemeStartupRecovery');
		const assign = vi.spyOn(h.window.location, 'assign').mockImplementation(() => {});
		const click = () => {
			const event = new h.window.MouseEvent('click', { bubbles: true, cancelable: true });
			link.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(true);
		};
		const write = h.beginWrite({ type: 'hotp', accountId: record.id });
		click();
		await Promise.resolve();
		expect(assign).not.toHaveBeenCalled();
		h.endWrite(write);
		h.runtime.sdk.host.open({ kind: 'account-add' });
		const field = h.document.getElementById('secretName');
		field.value = 'unsaved startup draft';
		click();
		await Promise.resolve();
		expect(assign).not.toHaveBeenCalled();
		expect(field.value).toBe('unsaved startup draft');
		h.window.eval('hideSecretModal()');
		await vi.waitFor(() => expect(h.document.getElementById('secretModal').style.display).toBe('none'));
		click();
		await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://vault.test/?safeMode=1'));
	});
});
