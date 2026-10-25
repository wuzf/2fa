import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { getAppearanceHead } from '../../src/ui/appearance.js';
import { getAppThemeIntegrationCode } from '../../src/ui/scripts/appThemeIntegration.js';
import { getAppThemeStatusStyles } from '../../src/ui/styles/appThemeStatus.js';

const windows = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function fixture() {
	const window = new Window({
		url: 'https://vault.test/',
		settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true },
	});
	windows.push(window);
	const { document } = window;
	document.head.innerHTML = '<style>' + getAppThemeStatusStyles() + '</style>';
	document.body.innerHTML =
		'<section id="appThemeStartup"><span class="app-theme-status-message">Loading</span><a id="appThemeStartupRecovery" href="/?safeMode=1">Safe mode</a></section><div id="appThemeRuntimeStatus" hidden></div><main id="appThemeRoot" hidden></main><div id="officialThemeRoot"><input id="searchInput"></div>';
	let now = 0;
	let sequence = 0;
	const tasks = new Map();
	vi.spyOn(window.Date, 'now').mockImplementation(() => now);
	window.setTimeout = (callback, delay) => {
		const id = ++sequence;
		tasks.set(id, { callback, at: now + delay });
		return id;
	};
	window.clearTimeout = (id) => tasks.delete(id);
	const appearance = { kind: 'app', packageId: 'b'.repeat(64), revision: 1, manifest: { kind: 'app', themeApiVersion: 2, settings: [] } };
	window.eval(/<script>([\s\S]*?)<\/script>/.exec(getAppearanceHead(appearance, { buildId: 'a'.repeat(64) }))[1]);
	const guards = { busy: false, dirty: false, modal: false, custom: false, busyError: false, refreshError: false, customError: false };
	const accountStore = {
		getOperationState: () => {
			if (guards.busyError) {
				throw new Error('Unreadable operation state');
			}
			return { busy: guards.busy };
		},
	};
	window.__2FA_REFRESH_BLOCKED__ = () => {
		if (guards.refreshError) {
			throw new Error('Unreadable form state');
		}
		return guards.dirty || guards.modal;
	};
	const customCodeReloadBlocked = () => {
		if (guards.customError) {
			throw new Error('Unreadable code state');
		}
		return guards.custom;
	};
	const getThemeRuntime = vi.fn(() => {
		throw new Error('Synthetic first SDK construction failure');
	});
	const factory = vi.fn();
	window.createAppThemeHost = factory;
	const official = vi.fn(() => {
		throw new Error('Must not re-enter failed SDK construction');
	});
	const toast = vi.fn();
	const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
	// Keep the real emitted recovery handler and initialization catch. Only SDK
	// construction, existing state guards and navigation are replaceable ports.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'window',
		'document',
		'getComputedStyle',
		'getThemeRuntime',
		'accountStore',
		'customCodeReloadBlocked',
		'getOfficialAccountView',
		'showCenterToast',
		't',
		'getTopModal',
		'console',
		'let themeRuntimeInstance=null;let secretDialogSubmission=null;' +
			getAppThemeIntegrationCode() +
			';return {recover:requestAppThemeRecovery,initialize:initializeAppThemeIntegration,boot:()=>getThemeRuntime(),setRuntime:value=>{themeRuntimeInstance=value;},setSubmission:value=>{secretDialogSubmission=value;}};',
	)(
		window,
		document,
		window.getComputedStyle.bind(window),
		getThemeRuntime,
		accountStore,
		customCodeReloadBlocked,
		official,
		toast,
		(key) => key,
		() => (guards.modal ? {} : null),
		{ error() {} },
	);
	const advance = (ms) => {
		now += ms;
		for (const [id, task] of [...tasks]) {
			if (task.at <= now) {
				tasks.delete(id);
				task.callback();
			}
		}
	};
	const display = (selector) => {
		// Reparse CSS to avoid Happy DOM's ancestor-attribute selector cache.
		const probe = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
		windows.push(probe);
		probe.document.write(document.documentElement.outerHTML);
		return probe.getComputedStyle(probe.document.querySelector(selector)).display;
	};
	const click = async (anchor) => {
		let prevented;
		anchor.addEventListener(
			'click',
			(event) => {
				// Observe the production listener before stopping Happy DOM's default
				// navigation. No network request is made by this test.
				prevented = event.defaultPrevented;
				event.preventDefault();
			},
			{ once: true },
		);
		anchor.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		await Promise.resolve();
		return prevented;
	};
	return { window, document, api, guards, getThemeRuntime, factory, official, toast, assign, advance, display, click, tasks };
}

describe('theme bootstrap failure recovery', () => {
	it('keeps the head safe link usable after two seconds when the first core SDK construction failed', async () => {
		const h = fixture();
		expect(h.api.boot).toThrow('Synthetic first SDK construction failure');
		h.advance(1999);
		expect(h.display('#appThemeStartupRecovery')).toBe('none');
		h.advance(1);
		expect(h.display('#appThemeStartupRecovery')).not.toBe('none');
		const link = h.document.getElementById('appThemeStartupRecovery');
		expect(link.href).toBe('https://vault.test/?safeMode=1');
		expect(await h.click(link)).toBe(false);
		expect(h.assign).not.toHaveBeenCalled();
	});

	it('shows an immediately usable safe anchor when explicit integration initialization cannot construct its SDK', async () => {
		const h = fixture();
		h.api.initialize();
		const status = h.document.getElementById('appThemeRuntimeStatus');
		const link = status.querySelector('a[data-runtime-action="recovery"]');
		expect(status.hidden).toBe(false);
		expect(status.dataset.phase).toBe('official-fallback');
		expect(link?.href).toBe('https://vault.test/?safeMode=1');
		expect(h.display('#appThemeRuntimeStatus')).not.toBe('none');
		expect(h.display('#appThemeRuntimeStatus a')).not.toBe('none');
		expect(h.document.documentElement.hasAttribute('data-app-theme-startup')).toBe(false);
		expect(h.tasks.size).toBe(0);
		expect(h.getThemeRuntime).toHaveBeenCalledOnce();
		expect(h.official).not.toHaveBeenCalled();
		expect(h.factory).not.toHaveBeenCalled();
		expect(await h.click(link)).toBe(false);
	});

	it('hands focused slow-start recovery to the immediate fallback safe link', () => {
		const h = fixture();
		h.advance(2000);
		h.document.getElementById('appThemeStartupRecovery').focus();
		h.api.initialize();
		expect(h.document.activeElement).toBe(h.document.querySelector('#appThemeRuntimeStatus a'));
	});

	it.each(['busy', 'submission', 'dirty', 'modal', 'custom', 'busyError', 'refreshError', 'customError'])(
		'blocks native and dynamic recovery when the %s guard is set or unreadable',
		async (guard) => {
			const h = fixture();
			if (guard === 'submission') {
				h.api.setSubmission({ pending: true });
			} else {
				h.guards[guard] = true;
			}
			h.advance(2000);
			expect(await h.click(h.document.getElementById('appThemeStartupRecovery'))).toBe(true);
			await h.api.recover();
			expect(h.assign).not.toHaveBeenCalled();
			expect(h.toast).toHaveBeenCalledWith('⚠️', 'moduleRefreshBlocked');
		},
	);

	it('allows a dynamic recovery button to navigate safely only before any SDK exists', async () => {
		const h = fixture();
		await h.api.recover();
		expect(h.assign).toHaveBeenCalledOnce();
		expect(h.assign).toHaveBeenCalledWith('/?safeMode=1');
	});

	it.each(['completed', 'rejected'])('always uses an existing SDK lifecycle even if its getter later throws (%s)', async (status) => {
		const h = fixture();
		const reload = vi.fn(async () => ({ status, reason: 'unsaved-or-pending' }));
		h.api.setRuntime({ sdk: { lifecycle: { requestReload: reload } } });
		h.advance(2000);
		expect(await h.click(h.document.getElementById('appThemeStartupRecovery'))).toBe(true);
		expect(reload).toHaveBeenCalledExactlyOnceWith('recovery');
		expect(h.getThemeRuntime).not.toHaveBeenCalled();
		expect(h.assign).not.toHaveBeenCalled();
		if (status === 'rejected') {
			expect(h.toast).toHaveBeenCalledWith('⚠️', 'moduleRefreshBlocked');
		}
	});

	it('does not authorize native fallback if an SDK appeared before its constructor threw', async () => {
		const h = fixture();
		h.getThemeRuntime.mockImplementation(() => {
			h.api.setRuntime({ sdk: {} });
			throw new Error('Late initialization error');
		});
		h.advance(2000);
		expect(await h.click(h.document.getElementById('appThemeStartupRecovery'))).toBe(true);
		expect(h.assign).not.toHaveBeenCalled();
	});
});
