import { describe, expect, it, vi } from 'vitest';
import { getThemeRuntimeCode } from '../../src/ui/scripts/themeRuntime.js';

// Runs the emitted reload functions with only the globals they read.
function harness({ waiting = false, controller = true, update = { status: 'ready' } } = {}) {
	const source = getThemeRuntimeCode();
	const emitted = source.slice(source.indexOf('    function requestThemeRuntimeReload'), source.indexOf('    function createThemeSdkScope'));
	const posted = [];
	const worker = {
		postMessage: vi.fn((message, [port]) => {
			posted.push(message.type);
			port.postMessage({ ok: true });
		}),
	};
	const navigator = {
		serviceWorker: { controller: controller ? worker : null, getRegistration: async () => ({ waiting: waiting ? {} : null }) },
	};
	const window = { location: { reload: vi.fn() }, __2FA_REFRESH_BLOCKED__: () => false };
	const requestRuntimeUpdate = vi.fn(async () => update);
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'window',
		'navigator',
		'accountStore',
		'secretDialogSubmission',
		'requestRuntimeUpdate',
		'MessageChannel',
		'setTimeout',
		'clearTimeout',
		emitted + ';return {requestThemeRuntimeReload,reloadForSavedAppearance};',
	)(window, navigator, { getOperationState: () => ({ busy: false }) }, false, requestRuntimeUpdate, MessageChannel, setTimeout, clearTimeout);
	return { api, window, posted, requestRuntimeUpdate };
}

describe('reload for a saved appearance', () => {
	it('asks the worker to wait for the server page before reloading', async () => {
		const h = harness();
		const result = await h.api.requestThemeRuntimeReload('theme-change');
		expect(h.posted).toEqual(['EXPECT_FRESH_SHELL']);
		expect(h.window.location.reload).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: 'completed', reason: 'reload-requested' });
	});

	it('reloads without a controlling worker', async () => {
		const h = harness({ controller: false });
		await h.api.requestThemeRuntimeReload('theme-change');
		expect(h.window.location.reload).toHaveBeenCalledOnce();
	});

	it('takes a waiting app update in the same reload, so the updated worker serves it', async () => {
		const h = harness({ waiting: true });
		const result = await h.api.reloadForSavedAppearance();
		expect(h.requestRuntimeUpdate).toHaveBeenCalledOnce();
		expect(h.window.location.reload).toHaveBeenCalledOnce();
		expect(result.status).toBe('completed');
	});

	it('falls back to a plain reload when the waiting update cannot be taken', async () => {
		const h = harness({ waiting: true, update: { status: 'blocked', reason: 'runtime-update-blocked' } });
		const result = await h.api.reloadForSavedAppearance();
		expect(h.window.location.reload).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: 'completed', reason: 'reload-requested' });
	});

	it('reloads for the theme alone when no update is waiting', async () => {
		const h = harness();
		await h.api.reloadForSavedAppearance();
		expect(h.requestRuntimeUpdate).not.toHaveBeenCalled();
		expect(h.posted).toEqual(['EXPECT_FRESH_SHELL']);
		expect(h.window.location.reload).toHaveBeenCalledOnce();
	});
});
