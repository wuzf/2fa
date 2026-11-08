import vm from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppearanceClientCode } from '../../src/ui/appearance.js';

const windows = [];
const flush = async () => {
	for (let index = 0; index < 10; index++) {
		await Promise.resolve();
	}
};
function harness() {
	const window = new Window({ url: 'https://example.com' });
	windows.push(window);
	window.__2FA_BUILD_ID__ = 'a'.repeat(64);
	window.__2FA_APPEARANCE__ = { revision: 1 };
	const pending = [];
	window.authenticatedFetch = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
	window.applyAppearance = vi.fn((snapshot) => {
		window.__2FA_APPEARANCE__ = snapshot;
		window.dispatchEvent(new window.CustomEvent('appearance-applied', { detail: snapshot }));
	});
	const context = vm.createContext({
		window,
		document: window.document,
		navigator: { onLine: true },
		CustomEvent: window.CustomEvent,
		sessionStorage: window.sessionStorage,
	});
	vm.runInContext(getAppearanceClientCode(), context);
	return {
		window,
		context,
		resolve: async (index, revision) => {
			pending[index]({ ok: true, json: async () => ({ revision, active: { revision } }) });
			await flush();
		},
	};
}
afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

describe('core appearance synchronization', () => {
	it('checks focus and online without loading the editor and only applies newer revisions', async () => {
		const { window, resolve } = harness();
		window.dispatchEvent(new window.Event('focus'));
		await resolve(0, 2);
		expect(window.applyAppearance).toHaveBeenLastCalledWith({ revision: 2 });
		window.dispatchEvent(new window.Event('online'));
		await resolve(1, 1);
		expect(window.__2FA_APPEARANCE__.revision).toBe(2);
		expect(window.applyAppearance).toHaveBeenCalledTimes(1);
	});
	it('discards an earlier request even when its response arrives last', async () => {
		const { window, resolve } = harness();
		window.dispatchEvent(new window.Event('focus'));
		window.dispatchEvent(new window.Event('online'));
		await resolve(1, 3);
		await resolve(0, 2);
		expect(window.__2FA_APPEARANCE__.revision).toBe(3);
		expect(window.applyAppearance).toHaveBeenCalledTimes(1);
	});
	it('invalidates a pending check when the local editor applies a change', async () => {
		const { window, resolve } = harness();
		window.dispatchEvent(new window.Event('focus'));
		window.applyAppearance({ revision: 4 });
		await resolve(0, 3);
		expect(window.__2FA_APPEARANCE__.revision).toBe(4);
		expect(window.applyAppearance).toHaveBeenCalledTimes(1);
	});
	it('preserves an open or pending editor draft and emits a reload notification', async () => {
		const { window, resolve } = harness();
		window.hasAppearancePendingChanges = () => true;
		const notification = vi.fn();
		window.addEventListener('appearance-updated-elsewhere', notification);
		window.dispatchEvent(new window.Event('focus'));
		await resolve(0, 2);
		expect(window.applyAppearance).not.toHaveBeenCalled();
		expect(notification).toHaveBeenCalledOnce();
		expect(notification.mock.calls[0][0].detail).toEqual({ revision: 2 });
	});
	it('preserves other unsaved settings and modal interactions', async () => {
		const { window, context, resolve } = harness();
		context.hasUnsavedSettingsChanges = () => true;
		window.dispatchEvent(new window.Event('focus'));
		await resolve(0, 2);
		expect(window.applyAppearance).not.toHaveBeenCalled();
	});
	it('does not fetch in safe mode, offline, or a source-only build', () => {
		const { window, context } = harness();
		window.__2FA_SAFE_MODE__ = true;
		window.dispatchEvent(new window.Event('focus'));
		window.__2FA_SAFE_MODE__ = false;
		context.navigator.onLine = false;
		window.dispatchEvent(new window.Event('online'));
		context.navigator.onLine = true;
		window.__2FA_BUILD_ID__ = '';
		window.dispatchEvent(new window.Event('focus'));
		expect(window.authenticatedFetch).not.toHaveBeenCalled();
	});
});

describe('catching up after a page opened with the previous theme', () => {
	function stale() {
		const h = harness();
		// Another package was saved: the page cannot switch in place.
		h.window.applyAppearance = vi.fn(() => ({ status: 'reload-required' }));
		h.window.reloadForSavedAppearance = vi.fn(async () => ({ status: 'completed' }));
		return h;
	}
	it('reloads once on load when the server already has another theme', async () => {
		const { window, resolve } = stale();
		window.dispatchEvent(new window.Event('load'));
		await resolve(0, 2);
		expect(window.reloadForSavedAppearance).toHaveBeenCalledOnce();
		expect(window.reloadForSavedAppearance).toHaveBeenCalledWith();
	});
	it('does not reload again for the same saved revision', async () => {
		const { window, resolve } = stale();
		window.sessionStorage.setItem('2fa-appearance-catch-up:2', '1');
		window.dispatchEvent(new window.Event('load'));
		await resolve(0, 2);
		expect(window.applyAppearance).toHaveBeenCalledOnce();
		expect(window.reloadForSavedAppearance).not.toHaveBeenCalled();
	});
	it('leaves focus checks to the reload notice', async () => {
		const { window, resolve } = stale();
		window.dispatchEvent(new window.Event('focus'));
		await resolve(0, 2);
		expect(window.reloadForSavedAppearance).not.toHaveBeenCalled();
	});
	it('does nothing when the page is current', async () => {
		const { window, resolve } = stale();
		window.dispatchEvent(new window.Event('load'));
		await resolve(0, 1);
		expect(window.applyAppearance).not.toHaveBeenCalled();
		expect(window.reloadForSavedAppearance).not.toHaveBeenCalled();
	});
});
