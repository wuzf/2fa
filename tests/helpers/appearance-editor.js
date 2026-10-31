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
/** Waits past the editor's 120 ms preview debounce. */
export const tickPreview = () => new Promise((resolve) => setTimeout(resolve, 160));
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export function control(h, name, value) {
	const selector = '[data-appearance-action="' + name + '"]' + (value === undefined ? '' : '[data-value="' + value + '"]');
	return h.document.querySelector(selector);
}
export async function act(h, name, value) {
	control(h, name, value).click();
	await flush();
}
export function themeCard(h, packageId) {
	return h.document.querySelector('#appearancePanel [data-appearance-action="select"][data-package="' + packageId + '"]');
}
export async function chooseTheme(h, packageId) {
	themeCard(h, packageId).click();
	await flush();
}
export function editSetting(h, key, value) {
	const input = h.document.querySelector('[data-theme-setting="' + key + '"]');
	input.value = value;
	input.dispatchEvent(new h.window.Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}
export const status = (h) => h.document.getElementById('appearanceStatus');
export const methods = (h) => h.window.authenticatedFetch.mock.calls.map(([, options]) => options?.method || 'GET');
export const putBodies = (h) =>
	h.window.authenticatedFetch.mock.calls.filter(([, options]) => options?.method === 'PUT').map(([, options]) => JSON.parse(options.body));

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
			return json(error, 409);
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: theme.kind === 'app' ? [theme] : [] });
		}
		if (url === '/api/themes') {
			return json({ themes: theme.kind === 'app' ? [] : [theme] });
		}
		if (url === '/api/themes/catalog') {
			return json({ themes: [] });
		}
		return json({ revision: 1, active: initial, capabilities: { write } });
	});
	const network = { onLine: online };
	const context = vm.createContext({
		window,
		document: window.document,
		navigator: network,
		URL,
		Blob,
		CustomEvent: window.CustomEvent,
		setTimeout: (fn, ms) => {
			const timer = setTimeout(fn, ms);
			timers.add(timer);
			return timer;
		},
		clearTimeout,
	});
	vm.runInContext(code, context);
	return { window, document: window.document, initial, network };
}

afterEach(async () => {
	for (const timer of timers) {
		clearTimeout(timer);
	}
	timers.clear();
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});
