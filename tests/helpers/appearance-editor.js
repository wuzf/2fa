import vm from 'node:vm';
import { setImmediate } from 'node:timers';
import { Window } from 'happy-dom';
import { afterEach, vi } from 'vitest';
import { createAppearanceDraft, getAppearanceEditorCode } from '../../src/ui/scripts/appearanceEditor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const windows = [];
const timers = new Set();
export const flush = async () => {
	for (let i = 0; i < 10; i++) {
		await new Promise(setImmediate);
	}
};

export function harness({
	theme = getBuiltinTheme('document'),
	online = true,
	write = true,
	error,
	code = getAppearanceEditorCode(),
} = {}) {
	const window = new Window({ url: 'https://example.com', settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	window.document.documentElement.lang = 'zh-CN';
	const initial = { ...createAppearanceDraft(theme).draft, revision: 1 };
	let saved;
	const storage = { holdNextPut: false, release: null, log: [] };
	const operations = [];
	let processing = false;
	function processStorage() {
		if (processing || !operations.length) {
			return;
		}
		processing = true;
		const operation = operations[0];
		const finish = () =>
			globalThis.queueMicrotask(() => {
				operation.request.result = operation.perform();
				storage.log.push(operation.mode);
				operation.transaction.oncomplete?.();
				operations.shift();
				processing = false;
				processStorage();
			});
		if (operation.mode === 'put' && storage.holdNextPut) {
			storage.holdNextPut = false;
			storage.release = () => {
				storage.release = null;
				finish();
			};
		} else {
			finish();
		}
	}
	const database = {
		createObjectStore() {},
		transaction() {
			const transaction = {};
			const request = (mode, perform) => {
				const item = {};
				operations.push({ mode, perform, request: item, transaction });
				processStorage();
				return item;
			};
			transaction.objectStore = () => ({
				get: () => request('get', () => saved),
				put: (value) =>
					request('put', () => {
						saved = value;
						return 'current';
					}),
				delete: () =>
					request('delete', () => {
						saved = undefined;
					}),
			});
			return transaction;
		},
	};
	const indexedDB = {
		open: () => {
			const request = { result: database };
			globalThis.queueMicrotask(() => request.onsuccess());
			return request;
		},
	};
	window.t = (key, params = {}) =>
		Object.entries(params).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', value), LOCALES['zh-CN'][key] || key);
	window.__2FA_BUILD_ID__ = 'a'.repeat(64);
	window.__2FA_BUILTIN_THEMES__ = [theme];
	window.__2FA_APPEARANCE__ = initial;
	window.showModal = (id) => {
		window.document.getElementById(id).style.display = 'block';
	};
	window.hideModal = (id) => {
		window.document.getElementById(id).style.display = 'none';
	};
	window.showConfirmDialog = vi.fn(async () => true);
	window.authenticatedFetch = vi.fn(async (url, options = {}) => {
		if (options.method === 'DELETE' && error) {
			return new Response(JSON.stringify(error), { status: 409 });
		}
		if (url === '/api/themes?format=app') {
			return new Response(JSON.stringify({ themes: [] }));
		}
		if (url === '/api/themes') {
			return new Response(JSON.stringify({ themes: [theme] }));
		}
		return new Response(JSON.stringify({ revision: 1, active: initial, capabilities: { write } }));
	});
	const network = { onLine: online };
	const context = vm.createContext({
		window,
		document: window.document,
		navigator: network,
		indexedDB,
		URL,
		Blob,
		FormData,
		CustomEvent: window.CustomEvent,
		setTimeout: (fn, ms) => {
			const timer = setTimeout(fn, ms);
			timers.add(timer);
			return timer;
		},
		clearTimeout,
	});
	vm.runInContext(code, context);
	return { window, document: window.document, saved: () => saved, initial, network, storage };
}

afterEach(async () => {
	for (const timer of timers) {
		clearTimeout(timer);
	}
	timers.clear();
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});
