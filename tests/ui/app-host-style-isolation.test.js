import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import { scopeHostStyles } from '../../src/ui/styles/hostScope.js';
import { getStyles } from '../../src/ui/styles/index.js';
import { getVariables } from '../../src/ui/styles/variables.js';
import { getBaseStyles } from '../../src/ui/styles/base.js';
import { getComponentStyles } from '../../src/ui/styles/components.js';
import { getModalStyles } from '../../src/ui/styles/modals.js';
import { getResponsiveStyles } from '../../src/ui/styles/responsive.js';
import { getDialogStyles } from '../../src/ui/styles/dialogs.js';
import { getWorkspaceStyles } from '../../src/ui/styles/workspace.js';
import { getAppearanceStyles } from '../../src/ui/styles/appearance.js';
import { getAppearanceEditorStyles } from '../../src/ui/styles/appearanceEditor.js';
import { getAppThemeStatusStyles } from '../../src/ui/styles/appThemeStatus.js';
import { createMainPage } from '../../src/ui/page.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const windows = [];
afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});
const css = () => getStyles().match(/<style>([\s\S]*?)<\/style>/)[1];
const rawCss = () =>
	[
		getVariables(),
		getBaseStyles(),
		getComponentStyles(),
		getModalStyles(),
		getResponsiveStyles(),
		getWorkspaceStyles(),
		getDialogStyles(),
		getAppearanceStyles(),
		getAppearanceEditorStyles(),
		getAppThemeStatusStyles(),
	].join('\n');
function documentWithStyles(source, width = 390) {
	const window = new Window();
	windows.push(window);
	window.happyDOM.setWindowSize({ width, height: 900 });
	window.document.head.innerHTML = '<style></style>';
	window.document.querySelector('style').textContent = source;
	return window;
}

describe('application theme host CSS boundary', () => {
	it('guards every actual host selector with the app subtree exclusion while keeping theme rules independent', () => {
		const window = documentWithStyles(css());
		const document = window.document;
		document.body.className = 'fluent-app';
		document.body.innerHTML =
			'<div id="host"><button class="btn btn-primary">Host</button><input class="form-control"><div class="container">Host container</div></div><div id="appThemeRoot"><button class="btn btn-primary">Theme</button><input class="form-control"><div class="container">Theme container</div></div>';
		const appButton = document.querySelector('#appThemeRoot button');
		const hostButton = document.querySelector('#host button');
		// happy-dom 20 cannot evaluate complex selectors within :not (even though
		// it matches the same positive selector). Verify the actual CSS AST plus
		// the target DOM sets here; root owns real Chrome computed-style checks.
		expect(appButton.matches('#appThemeRoot *')).toBe(true);
		expect(hostButton.matches('#appThemeRoot *')).toBe(false);
		let guarded = 0;
		walk(parse(css()), {
			visit: 'Rule',
			enter(rule) {
				if (this.atrule && /keyframes$/i.test(this.atrule.name)) {
					return;
				}
				expect(rule.prelude.type).toBe('SelectorList');
				const selector = generate(rule.prelude);
				if (selector === ':where(#appThemeRoot)' || selector === '#appThemeRoot[hidden]') {
					return;
				}
				rule.prelude.children.forEach((subject) => {
					expect(generate(subject)).toContain(':where(:not(#appThemeRoot,#appThemeRoot *))');
					guarded++;
				});
			},
		});
		expect(guarded).toBeGreaterThan(500);
		const custom = document.createElement('style');
		custom.textContent = '#appThemeRoot .btn{padding:13px;border-radius:0;background:rgb(12,34,56)}';
		document.head.append(custom);
		expect(window.getComputedStyle(appButton).padding).toBe('13px');
		expect(window.getComputedStyle(appButton).backgroundColor).toBe('rgb(12, 34, 56)');
		expect(window.getComputedStyle(hostButton).backgroundColor).not.toBe('rgb(12, 34, 56)');
	});
	it.each([320, 390, 481, 600, 767, 768, 1440])('preserves actual host form/status/v1 geometry and color at %ipx', async (width) => {
		const window = documentWithStyles(rawCss(), width);
		const document = window.document;
		const html = await (await createMainPage()).text();
		const body = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/);
		document.body.className = 'fluent-app';
		document.body.innerHTML = body[2].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
		const selectors = [
			'#secretModal',
			'.modal-content',
			'#secretName',
			'#settingsModal',
			'.search-input',
			'#mainActionBtn',
			'#searchStats',
		];
		const properties = [
			'display',
			'padding',
			'margin',
			'width',
			'maxWidth',
			'fontFamily',
			'fontSize',
			'color',
			'backgroundColor',
			'borderRadius',
			'position',
			'zIndex',
		];
		const capture = () =>
			selectors.map((selector) => {
				const element = document.querySelector(selector);
				expect(element, selector).not.toBeNull();
				const style = window.getComputedStyle(element);
				return Object.fromEntries(properties.map((property) => [property, style[property]]));
			});
		for (const scheme of ['light', 'dark']) {
			document.documentElement.dataset.theme = scheme;
			document.querySelector('style').textContent = rawCss();
			const before = capture();
			document.querySelector('style').textContent = css();
			expect(capture()).toEqual(before);
		}
	});
	it('handles selector lists, combinators, pseudo-elements and nested media without changing animations/fonts', () => {
		const input =
			'@font-face{font-family:Host;src:url(host.woff2)} @keyframes pulse{from{opacity:0}50%{opacity:.5}to{opacity:1}} @-webkit-keyframes spin{to{transform:rotate(1turn)}} @media(max-width:400px){body .control:hover, input::placeholder, .text:before{color:red}} @supports(display:grid){:is(button,input){display:grid}}';
		const output = scopeHostStyles(input);
		const prelude = [];
		walk(parse(output), {
			visit: 'Rule',
			enter(node) {
				prelude.push(generate(node.prelude));
			},
		});
		expect(prelude).toContain(
			'body .control:hover:where(:not(#appThemeRoot,#appThemeRoot *)),input:where(:not(#appThemeRoot,#appThemeRoot *))::placeholder,.text:where(:not(#appThemeRoot,#appThemeRoot *)):before',
		);
		expect(prelude).toContain(':is(button,input):where(:not(#appThemeRoot,#appThemeRoot *))');
		expect(output).toContain('@keyframes pulse{from{opacity:0}50%{opacity:.5}to{opacity:1}}');
		expect(output).toContain('@-webkit-keyframes spin{to{transform:rotate(1turn)}}');
		expect(output).toContain('@font-face{font-family:Host;src:url(host.woff2)}');
	});
	it('fails closed on malformed selectors instead of leaking unscoped host rules', () => {
		expect(() => scopeHostStyles('} @media(min-width:481px){button{padding:99px}}')).toThrow('Cannot isolate');
	});
	it('does not activate the historically invalid 481–767 media segment during isolation', () => {
		const source = scopeHostStyles(getResponsiveStyles());
		const nested = [];
		walk(parse(source), {
			visit: 'Rule',
			enter(rule) {
				const condition = this.atrule?.name === 'media' ? generate(this.atrule.prelude) : '';
				if (condition.includes('min-width:481px') && condition.includes('max-width:767px')) {
					nested.push(generate(rule));
				}
			},
		});
		expect(nested).toEqual([]);
	});
	it.each([481, 600, 767])('retains the published container width through the official theme wrapper at %ipx', async (width) => {
		const window = documentWithStyles(css(), width);
		const document = window.document;
		const html = await (await createMainPage()).text();
		document.body.className = 'fluent-app';
		document.body.innerHTML = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/)[2].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
		for (const theme of ['light', 'dark']) {
			document.documentElement.dataset.theme = theme;
			const container = window.getComputedStyle(document.querySelector('#officialThemeRoot .container'));
			const content = window.getComputedStyle(document.querySelector('#officialThemeRoot .content'));
			const grid = window.getComputedStyle(document.getElementById('secretsList'));
			// Fixed pre-change expectations from the complete original stylesheet in
			// Chrome, not expectations derived from the newly scoped source itself.
			expect(container.maxWidth).toBe('1400px');
			expect(content.paddingLeft).toBe('16px');
			expect(content.paddingRight).toBe('16px');
			expect(grid.gridTemplateColumns.replace(/\s/g, '')).toBe('repeat(auto-fill,minmax(260px,1fr))');
			expect(grid.gap).toBe('12px');
		}
	});
	it('keeps hidden staging roots hidden even if a theme styles the root display', () => {
		const window = documentWithStyles(css());
		const document = window.document;
		document.body.innerHTML = '<div id="appThemeRoot" class="theme" hidden>Hidden staging root</div>';
		const appRoot = document.getElementById('appThemeRoot');
		const custom = document.createElement('style');
		custom.textContent = '.theme{display:grid}';
		document.head.append(custom);
		expect(window.getComputedStyle(appRoot).display).toBe('none');
		appRoot.hidden = false;
		expect(window.getComputedStyle(appRoot).display).toBe('grid');
		appRoot.hidden = true;
		expect(window.getComputedStyle(appRoot).display).toBe('none');
	});
	it('keeps runtime status hidden until shown and places it in the normal page flow', () => {
		const window = documentWithStyles(css());
		window.document.body.innerHTML = '<div id="appThemeRuntimeStatus" class="app-theme-status" hidden>Preparing resources</div>';
		const status = window.document.getElementById('appThemeRuntimeStatus');
		expect(window.getComputedStyle(status).display).toBe('none');
		status.hidden = false;
		expect(window.getComputedStyle(status).display).toBe('flex');
		expect(window.getComputedStyle(status).position).toBe('relative');
		expect(window.getComputedStyle(status).transform).toBe('none');
	});
	it.each([390, 1440])('keeps dialog action rows inside the app-theme dialog padding at %ipx', (width) => {
		// App themes give dialogs 20px of padding; action rows that still reached
		// out by 24px made every dialog with buttons scroll by 4px.
		const window = documentWithStyles(css(), width);
		window.document.documentElement.setAttribute('data-app-host-appearance', '');
		window.document.body.innerHTML =
			'<div class="modal confirm-dialog-modal show"><div class="modal-content confirm-dialog-content"><div class="confirm-dialog-actions"></div></div><div class="modal-content"><div class="form-actions"></div></div></div>';
		for (const actions of window.document.querySelectorAll('.confirm-dialog-actions, .form-actions')) {
			const padding = window.getComputedStyle(actions.parentElement).paddingRight;
			const style = window.getComputedStyle(actions);
			expect(padding).toBe('20px');
			expect(style.marginRight).toBe('-20px');
			expect(style.marginLeft).toBe('-20px');
			expect(style.marginBottom).toBe('-20px');
		}
	});
	it.each([390, 1440])('keeps the scaled preview frames out of the viewport flow at %ipx', (width) => {
		// The frames are sized from the viewport height; in flow, their unscaled
		// height stretched the viewport and every resize made the preview taller.
		const window = documentWithStyles(css(), width);
		window.document.body.innerHTML =
			'<div id="appearanceModal"><section class="appearance-preview-section"><div class="appearance-preview-viewport"><iframe id="appearancePreview"></iframe><div id="appearanceAppPreview"><iframe></iframe></div></div></section></div>';
		const style = (selector) => window.getComputedStyle(window.document.querySelector(selector));
		expect(style('.appearance-preview-viewport').position).toBe('relative');
		expect(style('#appearancePreview').position).toBe('absolute');
		expect(style('#appearanceAppPreview').position).toBe('absolute');
		expect(style('#appearanceAppPreview').overflow).toBe('hidden');
		expect(style('.appearance-preview-viewport').flexGrow).toBe(width < 760 ? '0' : '1');
	});
	it.each([320, 390, 768, 1440])('keeps startup actions content-sized and neutral at %ipx', async (width) => {
		const window = documentWithStyles(css(), width);
		const document = window.document;
		document.body.innerHTML =
			'<div id="appThemeRuntimeStatus" class="app-theme-status"><span class="app-theme-status-message">Preparing theme</span><div class="app-theme-status-actions"><button class="btn btn-secondary">Use default interface</button></div></div>';
		const status = document.getElementById('appThemeRuntimeStatus');
		const action = status.querySelector('button');
		for (const mode of ['light', 'dark']) {
			document.documentElement.dataset.theme = mode;
			const expected = document.createElement('div');
			expected.style.background = 'var(--bg-secondary)';
			expected.style.color = 'var(--text-secondary)';
			document.body.append(expected);
			const style = window.getComputedStyle(status);
			expect(style.backgroundColor).toBe(window.getComputedStyle(expected).backgroundColor);
			expect(style.color).toBe(window.getComputedStyle(expected).color);
			expect(style.flexWrap).toBe('wrap');
			expect(style.position).toBe('relative');
			expect(window.getComputedStyle(action).width).toBe('auto');
			expect(window.getComputedStyle(action).minHeight).toBe('44px');
			expected.remove();
		}
	});
	it('returns the build-time style string without invoking the fallback compiler', async () => {
		vi.resetModules();
		const scopes = await import('../../src/ui/styles/hostScope.js');
		const compile = vi.spyOn(scopes, 'scopeHostStyles');
		const index = await import('../../src/ui/styles/index.js');
		try {
			vi.stubGlobal('__2FA_HOST_STYLES__', '<style>precompiled fixture</style></head>');
			expect(index.getStyles()).toBe('<style>precompiled fixture</style></head>');
			expect(compile).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
			compile.mockRestore();
		}
	});
	it('caches the compiled stylesheet instead of parsing it for every page request', async () => {
		vi.resetModules();
		const scopes = await import('../../src/ui/styles/hostScope.js');
		const compile = vi.spyOn(scopes, 'scopeHostStyles');
		const index = await import('../../src/ui/styles/index.js');
		const first = index.getStyles();
		for (let count = 0; count < 25; count++) {
			expect(index.getStyles()).toBe(first);
		}
		expect(compile).toHaveBeenCalledOnce();
		compile.mockRestore();
	});
});

describe('host flows after official action DOM removal', () => {
	it('opens actual account dialogs and handles Escape safely with no FAB/submenu/overlay', async () => {
		const h = await createRuntimeFixture({
			accountDOM: false,
			extraSource: 'window.__actionTest={openActionMenu,closeActionMenu,toggleActionMenu};',
		});
		try {
			for (const id of ['mainActionBtn', 'actionSubmenu', 'menuOverlay']) {
				h.document.getElementById(id)?.remove();
			}
			for (const call of Object.values(h.window.__actionTest)) {
				expect(() => call()).not.toThrow();
			}
			expect(() => h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow();
			h.replaceSecretRecords([{ id: 'a', name: 'Synthetic', account: 'user@example.invalid', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }], {
				source: 'server',
				accessVerified: true,
			});
			const runtime = h.getThemeRuntime();
			const handle = runtime.sdk.host.open({ kind: 'account-edit', account: runtime.sdk.getSnapshot().library.accounts[0].ref });
			expect(handle.status).toBe('opening');
			expect(h.document.getElementById('secretName').value).toBe('Synthetic');
			expect(h.document.getElementById('secretService').value).toBe('user@example.invalid');
			h.window.hideSecretModal();
		} finally {
			await h.dispose();
		}
	});
	it('retains ordinary FAB open/toggle/close and cleans partially detached action nodes', async () => {
		const h = await createRuntimeFixture({ extraSource: 'window.__actionTest={openActionMenu,closeActionMenu,toggleActionMenu};' });
		try {
			const action = h.window.__actionTest;
			const button = h.document.getElementById('mainActionBtn');
			const submenu = h.document.getElementById('actionSubmenu');
			const overlay = h.document.getElementById('menuOverlay');
			action.openActionMenu();
			expect(button.getAttribute('aria-expanded')).toBe('true');
			expect(submenu.classList.contains('show')).toBe(true);
			action.toggleActionMenu();
			expect(button.getAttribute('aria-expanded')).toBe('false');
			expect(overlay.classList.contains('show')).toBe(false);
			action.openActionMenu();
			button.remove();
			expect(() => action.closeActionMenu()).not.toThrow();
			expect(submenu.classList.contains('show')).toBe(false);
			expect(overlay.classList.contains('show')).toBe(false);
			expect(() => action.openActionMenu()).not.toThrow();
			expect(submenu.classList.contains('show')).toBe(false);
		} finally {
			await h.dispose();
		}
	});
});
