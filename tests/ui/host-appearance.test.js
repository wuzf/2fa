import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import { normalizeHostAppearance, createHostAppearanceManager } from '../../src/ui/runtime/hostAppearance.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';
import { createAppThemePreviewDocument, createAppPreviewMockSdk, getAppThemePreviewCode } from '../../src/ui/scripts/appThemePreview.js';
import { getStyles } from '../../src/ui/styles/index.js';

const fixtures = [];
afterEach(async () => {
	for (const item of fixtures.splice(0)) {
		await (item.dispose?.() || item.happyDOM?.abort());
	}
});
function setup() {
	const window = new Window({ url: 'https://vault.test/' });
	fixtures.push(window);
	window.document.write(
		'<!doctype html><html data-theme="light"><head>' +
			getStyles() +
			'<body class="fluent-app"><section id="settingsModal" class="modal"><div class="modal-content"><button class="btn btn-primary">Save</button><button class="btn btn-danger">Delete</button><button class="btn btn-outline">Cancel</button><input><select><option>Option</option></select><span class="format-option">Export</span><div class="result-content">Result</div></div></section><section id="appearanceModal" class="modal"><div class="modal-content appearance-modal-content"><button class="appearance-theme-card">Theme</button><button class="appearance-tab">Tab</button><label class="appearance-field"><input></label><details class="appearance-disclosure"><summary>Advanced</summary></details></div></section><div class="center-toast"><div class="toast-content">Toast</div></div><div class="dialog-toast">Message</div><main id="appThemeRoot"><section class="modal"><div class="modal-content"><button class="btn">Independent theme</button></div></section></main></body></html>',
	);
	const manager = createHostAppearanceManager({ document: window.document, normalize: normalizeHostAppearance });
	return {
		window,
		document: window.document,
		manager,
		computed: (selector) => window.getComputedStyle(window.document.querySelector(selector)),
	};
}

describe('optional host appearance contract', () => {
	it('validates a bounded pure replacement and retains distinct reset and no-shadow meanings', () => {
		expect(normalizeHostAppearance(null)).toBeNull();
		expect(normalizeHostAppearance({ shadow: null, surface: '#AbC', fontFamily: [' Pixel Face ', 'sans-serif'], radius: -0 })).toEqual({
			surface: '#abc',
			radius: 0,
			shadow: null,
			fontFamily: ['Pixel Face', 'sans-serif'],
		});
		expect(
			normalizeHostAppearance({
				radius: 24,
				controlRadius: 16,
				borderWidth: 3,
				controlShadow: { x: -8, y: 8, blur: 64, spread: 8, color: '#12345678' },
			}),
		).toMatchObject({ radius: 24, controlRadius: 16, borderWidth: 3 });
	});
	it.each([
		undefined,
		new Date(),
		new Map(),
		{ [Symbol('unknown')]: 'value' },
		Object.defineProperty({}, 'surface', { get: () => '#fff', enumerable: true }),
		[],
		'blue',
		{ unknown: '#fff' },
		{ radius: '0' },
		{ radius: NaN },
		{ radius: Infinity },
		{ radius: 25 },
		{ radius: -1 },
		{ borderWidth: 0 },
		{ controlRadius: 17 },
		{ surface: 'red' },
		{ surface: '#12345' },
		{ surface: 'var(--x)' },
		{ shadow: {} },
		{ shadow: { x: 0, y: 0, blur: 1, spread: 0, color: '#000', extra: true } },
		{ shadow: { x: 0, y: 0, blur: 1, spread: -1, color: '#000' } },
		{ controlShadow: { x: Infinity, y: 0, blur: 0, spread: 0, color: '#000' } },
		{ fontFamily: [] },
		{ fontFamily: Array(1) },
		{ fontFamily: [''] },
		{ fontFamily: ['x'.repeat(81)] },
		{ fontFamily: ['x; color:red'] },
		{ fontFamily: ['url(font)'] },
		{ fontFamily: ['foo\nbar'] },
	])('rejects invalid visual input %j', (input) => expect(() => normalizeHostAppearance(input)).toThrow('invalid-appearance'));
	it('stages before activation, deduplicates values, rejects invalid updates, replaces and clears without touching existing styles', async () => {
		const h = setup(),
			scope = h.manager.createScope();
		h.document.documentElement.style.setProperty('--user-original', 'keep');
		expect(scope.setAppearance({ surface: '#ABC', radius: 0 })).toEqual({ status: 'completed' });
		expect(h.document.querySelector('[data-app-host-appearance]')).toBeNull();
		scope.activate();
		const style = h.document.head.querySelector('style[data-app-host-appearance]');
		const before = style.textContent;
		expect(h.computed('#settingsModal').getPropertyValue('--dialog-surface')).toBe('#abc');
		const records = [];
		const observer = new h.window.MutationObserver((changes) => records.push(...changes));
		observer.observe(style, { childList: true, subtree: true, characterData: true });
		scope.setAppearance({ radius: 0, surface: '#abc' });
		await Promise.resolve();
		expect(records).toHaveLength(0);
		expect(scope.setAppearance({ surface: 'url(x)' })).toEqual({ status: 'rejected', reason: 'invalid-appearance' });
		expect(style.textContent).toBe(before);
		scope.setAppearance({ radius: 2 });
		expect(h.computed('#settingsModal').getPropertyValue('--dialog-surface')).toBe('#ffffff');
		scope.setAppearance(null);
		expect(h.document.querySelector('[data-app-host-appearance]')).toBeNull();
		expect(h.document.documentElement.style.getPropertyValue('--user-original')).toBe('keep');
		observer.disconnect();
	});
	it('does not let a failed candidate or late owner change the active presentation', () => {
		const h = setup(),
			old = h.manager.createScope();
		old.setAppearance({ surface: '#111' });
		old.activate();
		const failed = h.manager.createScope();
		failed.setAppearance({ surface: '#222' });
		failed.dispose();
		expect(h.computed('#settingsModal').getPropertyValue('--dialog-surface')).toBe('#111');
		const current = h.manager.createScope();
		current.setAppearance({ surface: '#333' });
		current.activate();
		expect(old.setAppearance(null)).toMatchObject({ reason: 'mount-invalidated' });
		old.dispose();
		expect(h.computed('#settingsModal').getPropertyValue('--dialog-surface')).toBe('#333');
		current.dispose();
		expect(h.document.querySelector('style[data-app-host-appearance]')).toBeNull();
		expect(current.setAppearance({})).toMatchObject({ reason: 'mount-invalidated' });
	});
	it.each(['light', 'dark'])(
		'applies actual host control, editor, backup, tool and toast styles and restores their %s defaults',
		(mode) => {
			const h = setup();
			h.document.documentElement.dataset.theme = mode;
			const selectors = [
				'#settingsModal .modal-content',
				'#settingsModal .btn-primary',
				'#settingsModal .btn-danger',
				'#settingsModal .btn-outline',
				'#settingsModal input',
				'#settingsModal select',
				'#settingsModal .format-option',
				'#settingsModal .result-content',
				'#appearanceModal .appearance-theme-card',
				'#appearanceModal .appearance-tab',
				'#appearanceModal input',
				'#appearanceModal .appearance-disclosure',
				'.center-toast .toast-content',
				'.dialog-toast',
				'#appThemeRoot .btn',
			];
			const pick = (selector) => {
				const style = h.computed(selector);
				return [style.backgroundColor, style.color, style.borderRadius, style.borderTopWidth, style.fontFamily, style.boxShadow];
			};
			const defaults = selectors.map(pick);
			const scope = h.manager.createScope();
			scope.setAppearance({
				surface: '#fffdf7',
				text: '#121212',
				stroke: '#1b1b1f',
				accent: '#a8d49b',
				accentText: '#123456',
				dangerFill: '#800000',
				dangerText: '#abcdef',
				radius: 0,
				controlRadius: 1,
				borderWidth: 2,
				fontFamily: ['Pixel Face', 'sans-serif'],
				shadow: { x: 4, y: 4, blur: 0, spread: 0, color: '#111' },
				controlShadow: null,
			});
			scope.activate();
			expect(h.computed('#settingsModal .modal-content').borderRadius).toBe('0px');
			expect(['#a8d49b', 'rgb(168, 212, 155)']).toContain(h.computed('#settingsModal .btn-primary').backgroundColor);
			expect(['#123456', 'rgb(18, 52, 86)']).toContain(h.computed('#settingsModal .btn-primary').color);
			expect(['#800000', 'rgb(128, 0, 0)']).toContain(h.computed('#settingsModal .btn-danger').backgroundColor);
			expect(['#abcdef', 'rgb(171, 205, 239)']).toContain(h.computed('#settingsModal .btn-danger').color);
			for (const selector of selectors.slice(1, 12)) {
				expect(h.computed(selector).borderRadius, selector).toBe('1px');
			}
			for (const selector of [
				'#settingsModal .btn-outline',
				'#settingsModal input',
				'#appearanceModal .appearance-theme-card',
				'#appearanceModal .appearance-disclosure',
			]) {
				expect(h.computed(selector).borderTopWidth, selector).toBe('2px');
			}
			expect(h.computed('#settingsModal .btn-primary').fontFamily).toBe('"Pixel Face", sans-serif');
			expect(h.computed('#settingsModal .btn-primary').boxShadow).toBe('none');
			expect(h.computed('.dialog-toast').borderRadius).toBe('0px');
			expect(h.computed('.center-toast .toast-content').boxShadow).toContain('4px 4px 0px 0px');
			// happy-dom cannot evaluate descendant selectors within :not. Check every
			// actual selector and the DOM boundary; Chrome owns computed isolation.
			const activeCss = h.document.querySelector('style[data-app-host-appearance]').textContent;
			walk(parse(activeCss), {
				visit: 'Rule',
				enter(rule) {
					rule.prelude.children.forEach((selector) => expect(generate(selector)).toContain(':where(:not(#appThemeRoot,#appThemeRoot *))'));
				},
			});
			expect(h.document.querySelector('#appThemeRoot .btn').matches('#appThemeRoot *')).toBe(true);
			expect(h.document.querySelector('#settingsModal .btn').matches('#appThemeRoot *')).toBe(false);
			scope.dispose();
			expect(selectors.map(pick)).toEqual(defaults);
		},
	);
	it('exercises the emitted browser SDK, denies the official scope and cleans a stale app scope', async () => {
		const h = await createRuntimeFixture({
			accountDOM: false,
			extraSource: 'window.__runtimeFixture.createScope = createAppThemeSdkScope;',
		});
		fixtures.push(h);
		expect(h.getThemeRuntime().sdk.host.setAppearance({ radius: 0 })).toEqual({ status: 'rejected', reason: 'unavailable' });
		let live = true;
		const scope = h.createScope({ identity: { packageId: 'b'.repeat(64) }, isCurrent: () => live });
		expect(scope.sdk.host.setAppearance({ radius: 0, surface: '#abcdef' })).toEqual({ status: 'completed' });
		expect(h.document.querySelector('style[data-app-host-appearance]')).toBeNull();
		scope.activateHostAppearance();
		expect(h.document.querySelector('style[data-app-host-appearance]')).not.toBeNull();
		live = false;
		expect(scope.sdk.host.setAppearance(null)).toEqual({ status: 'rejected', reason: 'mount-invalidated' });
		scope.dispose();
		expect(h.document.querySelector('style[data-app-host-appearance]')).toBeNull();
	});
	it('keeps preview validation and state local, including the explicitly serialized iframe validator', () => {
		const call = vi.fn(),
			report = vi.fn();
		const mock = createAppPreviewMockSdk({ config: { appearance: { packageId: 'preview' } }, call, report });
		expect(mock.sdk.host.setAppearance({ surface: '#FFF', shadow: null })).toEqual({ status: 'completed' });
		expect(mock.getHostAppearance()).toEqual({ surface: '#fff', shadow: null });
		expect(mock.sdk.host.setAppearance({ radius: NaN })).toMatchObject({ reason: 'invalid-appearance' });
		expect(mock.getHostAppearance()).toEqual({ surface: '#fff', shadow: null });
		expect(call).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
		mock.dispose();
		expect(mock.getHostAppearance()).toBeNull();
		expect(mock.sdk.host.setAppearance(null)).toMatchObject({ reason: 'mount-invalidated' });
		const bootstrap = `(config, createMock) => { const mock = createMock({config,call:()=>{throw new Error('parent RPC')}}); globalThis.previewResult = mock.sdk.host.setAppearance({radius:0,fontFamily:['sans-serif']}); globalThis.previewTokens = mock.getHostAppearance(); }`;
		const config = { scriptNonce: 'nonce', baseUrl: 'https://vault.test/theme-preview/', appearance: { packageId: 'preview' } };
		const html = createAppThemePreviewDocument(config, bootstrap, createAppPreviewMockSdk.toString());
		const context = vm.createContext({});
		vm.runInContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
		expect(context.previewResult).toEqual({ status: 'completed' });
		expect(context.previewTokens).toEqual({ radius: 0, fontFamily: ['sans-serif'] });
		// Parse the complete production factory too: module closure imports must not be required.
		vm.runInNewContext(getAppThemePreviewCode(), { window: {} });
	});
});

describe('browser theme color under an app theme', () => {
	function colorSetup({ painted = '#000000', hidden = false } = {}) {
		const window = new Window({ url: 'https://vault.test/' });
		fixtures.push(window);
		window.document.write(
			'<!doctype html><html><head><meta name="theme-color" content="#2196F3"></head><body><main id="appThemeRoot">' +
				`<div data-app-mount="1"${hidden ? ' style="visibility:hidden"' : ''}><div class="theme"${painted ? ` style="background:${painted}"` : ''}></div></div>` +
				'</main></body></html>',
		);
		const manager = createHostAppearanceManager({ document: window.document, normalize: normalizeHostAppearance });
		const meta = () => window.document.querySelector('meta[name="theme-color"]').getAttribute('content');
		const frame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
		return { window, manager, meta, frame };
	}

	it('follows the background the theme painted and restores the page color when the theme leaves', async () => {
		const h = colorSetup();
		const scope = h.manager.createScope();
		scope.setAppearance({ surface: '#1b1b1b', subtle: '#111111' });
		expect(h.meta()).toBe('#2196F3');
		scope.activate();
		await h.frame();
		expect(['rgb(0, 0, 0)', '#000000']).toContain(h.meta());
		h.window.document.querySelector('.theme').style.background = '#ffffff';
		scope.setAppearance({ surface: '#ffffff', subtle: '#fbfbfb' });
		await h.frame();
		expect(['rgb(255, 255, 255)', '#ffffff']).toContain(h.meta());
		scope.dispose();
		expect(h.meta()).toBe('#2196F3');
	});

	it('uses the theme palette when no visible mount paints a background', async () => {
		for (const options of [{ painted: '' }, { hidden: true }]) {
			const h = colorSetup(options);
			const scope = h.manager.createScope();
			scope.setAppearance({ surface: '#ffffff', subtle: '#faf9f5' });
			scope.activate();
			await h.frame();
			expect(h.meta()).toBe('#faf9f5');
			scope.dispose();
			expect(h.meta()).toBe('#2196F3');
		}
	});

	it('leaves the page color alone for a theme that sets no appearance', async () => {
		const h = colorSetup();
		const scope = h.manager.createScope();
		scope.activate();
		await h.frame();
		expect(h.meta()).toBe('#2196F3');
		scope.dispose();
		expect(h.meta()).toBe('#2196F3');
	});
});
