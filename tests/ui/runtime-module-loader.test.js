// @vitest-environment happy-dom
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModuleLoaderCode } from '../../src/ui/scripts/moduleLoader.js';

function fixture() {
	let session = 1,
		mount = 1;
	const fetch = vi.fn();
	const api = createContext({
		window: {
			__2FA_BUILD_ID__: 'a'.repeat(64),
			__2FA_APP_MODULE_GUARD__: () => {
				const active = mount;
				return () => active === mount;
			},
		},
		document,
		CustomEvent,
		AbortController,
		setTimeout,
		clearTimeout,
		console: { log() {}, error() {} },
		authenticatedFetch: fetch,
		showCenterToast: vi.fn(),
		t: (key) => key,
		accountStore: { getSessionGeneration: () => session, isSessionCurrent: (value) => value === session },
	});
	runInContext(getModuleLoaderCode(), api);
	const response = (code) => ({ ok: true, status: 200, headers: new Headers({ 'X-2FA-Build': 'a'.repeat(64) }), text: async () => code });
	return {
		api,
		fetch,
		response,
		expireSession: () => {
			session++;
		},
		expireMount: () => {
			mount++;
		},
	};
}
afterEach(() => {
	vi.useRealTimers();
	document.head.replaceChildren();
	document.body.replaceChildren();
});

describe('actual emitted host module loader', () => {
	it.each(['headers', 'body'])('bounds hanging %s, permits retry and rejects late bytes without disturbing the retry', async (phase) => {
		vi.useFakeTimers();
		const h = fixture();
		let releaseOld;
		if (phase === 'headers') {
			h.fetch.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseOld = () => resolve(h.response('window.stale = true;'));
					}),
			);
		} else {
			h.fetch.mockResolvedValueOnce({
				...h.response(''),
				text: () =>
					new Promise((resolve) => {
						releaseOld = () => resolve('window.stale = true;');
					}),
			});
		}
		let result = 'pending';
		const loading = h.api.loadModule('tools');
		void loading.then(
			() => {
				result = 'ready';
			},
			(error) => {
				result = error.message;
			},
		);
		await vi.advanceTimersByTimeAsync(15000);
		expect(result).toBe('moduleLoadTimeout');
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(runInContext('moduleLoadState.tools.promise', h.api)).toBeNull();
		expect(runInContext('moduleLoadState.tools.loading', h.api)).toBe(false);
		expect(document.head.querySelector('script')).toBeNull();
		let finishRetry;
		h.fetch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishRetry = () => resolve(h.response('window.current = true;'));
				}),
		);
		const retry = h.api.loadModule('tools');
		expect(h.fetch).toHaveBeenCalledTimes(2);
		releaseOld();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.api.loadModule('tools')).toBe(retry);
		expect(runInContext('moduleLoadState.tools.loading', h.api)).toBe(true);
		expect(document.getElementById('loadingToast').style.display).not.toBe('none');
		expect(document.head.querySelector('script')).toBeNull();
		finishRetry();
		await retry;
		expect(document.head.querySelectorAll('script')).toHaveLength(1);
		expect(document.head.querySelector('script').textContent).toBe('window.current = true;');
	});
	it('shares one fetch and promise between concurrent callers without a polling timeout', async () => {
		const h = fixture();
		let release;
		h.fetch.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const first = h.api.loadModule('backup');
		const second = h.api.loadModule('backup');
		expect(first).toBe(second);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		release(h.response('window.backupLoaded = true;'));
		await Promise.all([first, second]);
		expect(document.head.querySelectorAll('script')).toHaveLength(1);
		expect(document.head.querySelector('script').textContent).toBe('window.backupLoaded = true;');
		await h.api.loadModule('backup');
		expect(h.fetch).toHaveBeenCalledTimes(1);
	});
	it.each(['expireSession', 'expireMount'])('does not inject a late authenticated module after %s', async (expire) => {
		const h = fixture();
		let body;
		h.fetch.mockResolvedValue({
			...h.response(''),
			text: () =>
				new Promise((resolve) => {
					body = resolve;
				}),
		});
		const loading = h.api.loadModule('tools');
		await vi.waitFor(() => expect(body).toBeTypeOf('function'));
		h[expire]();
		body('window.shouldNeverRun = true;');
		await expect(loading).rejects.toThrow('expired');
		expect(document.head.querySelector('script')).toBeNull();
		h.fetch.mockResolvedValue(h.response('window.currentModule = true;'));
		await h.api.loadModule('tools');
		expect(document.head.querySelector('script').textContent).toBe('window.currentModule = true;');
	});
	it('rejects wrong-build bytes before DOM injection and routes refresh through the host gate', async () => {
		const h = fixture();
		h.api.window.dispatchEvent = vi.fn();
		h.api.requestThemeRuntimeReload = vi.fn(async () => ({ status: 'rejected' }));
		h.fetch.mockResolvedValue({ ...h.response('wrong build'), headers: new Headers({ 'X-2FA-Build': 'b'.repeat(64) }) });
		await expect(h.api.loadModule('tools')).rejects.toThrow('moduleBuildChanged');
		expect(document.head.querySelector('script')).toBeNull();
		await document.querySelector('#moduleBuildUpdate button').onclick();
		expect(h.api.requestThemeRuntimeReload).toHaveBeenCalledWith('update');
	});
});
