import vm from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAppearanceController,
	getAppearancePreviewDocument,
	getAppearanceRuntimeCode,
} from '../../src/ui/scripts/appearanceRuntime.js';
import { createAccountRenderer } from '../../src/ui/themes/renderer.js';
import { getUICode } from '../../src/ui/scripts/ui.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { createOfficialAccountView } from '../../src/ui/scripts/officialAccountView.js';
import { getStyles } from '../../src/ui/styles/index.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { validateManifest } from '../../src/themes/schema.js';
import { createMainPage } from '../../src/ui/page.js';
import { createDefaultAppearance } from '../../src/api/themes.js';

const windows = [];
function page() {
	const window = new Window({ url: 'https://example.com' });
	windows.push(window);
	window.document.body.innerHTML = `<div class="container"><div class="content"><div class="search-section"><div class="search-action-row"><input id="searchInput"><div class="sort-controls"><button id="sortTrigger">Sort</button></div></div><span id="searchStats"></span></div><div id="menuOverlay"></div><div id="offlineQueue"></div><div id="hiddenSecrets"></div><div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div></div></div><div class="action-menu-float"><button id="mainActionBtn"></button><div id="actionSubmenu"></div></div><footer class="page-footer">Footer</footer><div class="modal"><input id="unsavedModalInput" value="keep me"></div>`;
	return window;
}
const layout = {
	header: ['brand', { id: 'actions', type: 'actions', mode: 'toolbar' }],
	leading: ['service-nav'],
	main: ['search', 'view-controls', 'system-status', 'accounts'],
	trailing: [{ id: 'note', type: 'text' }],
	footer: ['footer'],
};
afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

describe('appearance runtime', () => {
	it.each([390, 600, 1440])('restores the published Fluent layout and styles after theme switches at %ipx', async (width) => {
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		windows.push(window);
		window.happyDOM.setWindowSize({ width, height: 900 });
		const document = window.document;
		document.write(await (await createMainPage()).text());
		const list = document.getElementById('secretsList');
		list.style.display = 'grid';
		list.innerHTML = createAccountRenderer().card({ id: 'native', name: 'Example', code: '123456' });
		const search = document.getElementById('searchInput');
		const controls = document.querySelector('.sort-controls');
		const row = controls.parentNode;
		const footer = document.querySelector('.page-footer');
		const footerParent = footer.parentNode;
		const button = document.getElementById('otp-native');
		const copied = vi.fn();
		button.addEventListener('click', copied);
		search.value = 'retained';
		const properties = ['fontFamily', 'color', 'backgroundColor', 'borderRadius', 'padding', 'margin', 'maxWidth'];
		const selectors = ['body', '.container', '.content', '.search-section', '.secret-card', '.otp-code', '.otp-next-code', '.page-footer'];
		const capture = () =>
			selectors.map((selector) => {
				const style = window.getComputedStyle(document.querySelector(selector));
				return Object.fromEntries(properties.map((property) => [property, style[property]]));
			});
		const baselines = {};
		for (const mode of ['light', 'dark']) {
			document.documentElement.dataset.theme = mode;
			baselines[mode] = capture();
		}
		const controller = createAppearanceController(document);
		for (const previous of [null, 'compact', 'document']) {
			if (previous) {
				controller.apply(getBuiltinTheme(previous));
			}
			controller.apply(createDefaultAppearance());
			expect(document.querySelector('.appearance-layout')).toBeNull();
			expect(document.querySelector('[data-part="brand"]')).toBeNull();
			expect(controls.closest('.search-action-row')).toBe(row);
			expect(footer.parentNode.parentNode).toBe(footerParent);
			expect(document.querySelector('[data-part="view-controls"] .sort-controls')).toBe(controls);
			expect(document.querySelector('[data-part="accounts"] #secretsList')).toBe(list);
			expect(document.getElementById('otp-native')).toBe(button);
			expect(search.value).toBe('retained');
			button.click();
			for (const mode of ['light', 'dark']) {
				document.documentElement.dataset.theme = mode;
				expect(capture()).toEqual(baselines[mode]);
			}
		}
		expect(copied).toHaveBeenCalledTimes(3);
	});

	it('keeps Fluent customization and restores its native layout without a custom brand row', () => {
		const window = page();
		const document = window.document;
		const controller = createAppearanceController(document);
		const original = createDefaultAppearance();
		const customized = { ...original, settings: { ...original.settings, accent: '#fedcba' } };
		for (let i = 0; i < 2; i++) {
			controller.apply(customized);
			expect(document.querySelector('.search-action-row .sort-controls')).not.toBeNull();
			expect(document.getElementById('appearance-config-css').textContent).toContain('--2fa-accent:#fedcba');
			expect(document.getElementById('appearance-custom-css')).toBeNull();
			expect(document.querySelector('[data-part="brand"]')).toBeNull();
			expect(document.querySelector('[data-part="custom-footer"]')).toBeNull();
		}
		controller.apply(original);
		expect(document.querySelector('[data-part="brand"]')).toBeNull();
		expect(document.getElementById('appearance-config-css').textContent).toBe('');
	});
	it('routes app configuration through its host without applying v1 layout or replacing the mounted app DOM', async () => {
		const window = page();
		const document = window.document;
		const first = {
			kind: 'app',
			packageId: 'a'.repeat(64),
			revision: 1,
			manifest: { themeApiVersion: 2, kind: 'app' },
			settings: { density: 'compact' },
		};
		window.__2FA_APPEARANCE__ = first;
		const branding = vi.fn();
		const context = vm.createContext({ window, document, CustomEvent: window.CustomEvent, updateAppearanceBranding: branding });
		vm.runInContext(getAppearanceRuntimeCode(), context);
		const list = document.getElementById('secretsList');
		expect(context.applyAppearance(first)).toMatchObject({ status: 'pending' });
		expect(document.getElementById('appearance-package-css')).toBeNull();
		expect(branding).toHaveBeenCalledWith(first);
		const changed = { ...first, revision: 2, settings: { density: 'comfortable' } };
		const mounted = document.createElement('main');
		mounted.id = 'appThemeRoot';
		mounted.textContent = 'Live app';
		document.body.append(mounted);
		window.updateAppThemeAppearance = vi.fn(async () => ({ status: 'running' }));
		expect(await context.applyAppearance(changed)).toEqual({ status: 'running' });
		expect(window.updateAppThemeAppearance).toHaveBeenCalledWith(changed);
		expect(document.getElementById('secretsList')).toBe(list);
		expect(mounted.textContent).toBe('Live app');
		const navigation = vi.fn();
		window.addEventListener('appearance-navigation-required', navigation);
		const other = { ...changed, packageId: 'b'.repeat(64) };
		expect(context.applyAppearance(other)).toMatchObject({ status: 'reload-required' });
		expect(window.__2FA_PENDING_APPEARANCE__).toBe(other);
		expect(context.applyAppearance(getBuiltinTheme('compact'))).toMatchObject({ status: 'reload-required' });
		expect(navigation).toHaveBeenCalledTimes(2);
		expect(window.updateAppThemeAppearance).toHaveBeenCalledTimes(1);
	});
	it('keeps v1 theme application and requires navigation before entering an app theme', () => {
		const window = page();
		const document = window.document;
		const context = vm.createContext({ window, document, CustomEvent: window.CustomEvent });
		vm.runInContext(getAppearanceRuntimeCode(), context);
		const compact = getBuiltinTheme('compact');
		context.applyAppearance(compact);
		expect(window.__2FA_APPEARANCE__).toEqual(compact);
		expect(document.querySelector('[data-part="account-grid"]')).toBe(document.getElementById('secretsList'));
		const app = { kind: 'app', packageId: 'a'.repeat(64), revision: 1 };
		expect(context.applyAppearance(app)).toMatchObject({ status: 'reload-required' });
		expect(window.__2FA_APPEARANCE__).toEqual(compact);
	});
	it.each(['document', 'compact'].flatMap((theme) => [320, 390, 768, 1440].map((width) => [theme, width])))(
		'raises only the open menu owner below app popups and dialogs in %s at %ipx',
		async (theme, width) => {
			const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
			windows.push(window);
			window.happyDOM.setWindowSize({ width, height: 900 });
			const document = window.document;
			document.write(await (await createMainPage()).text());
			const list = document.getElementById('secretsList');
			list.style.removeProperty('display');
			list.innerHTML = ['first', 'second'].map((id) => createAccountRenderer().card({ id, name: 'Google', code: '123456' })).join('');
			const snapshot = {
				session: { state: 'authenticated' },
				host: { operations: [] },
				library: {
					state: 'ready',
					accounts: ['first', 'second'].map((id) => ({
						ref: { id, generation: 1 },
						service: { label: 'Google' },
						accountLabel: '',
						type: 'TOTP',
						otp: { current: { value: '123456' }, next: { value: '654321' } },
					})),
					view: { query: '', mode: 'flat', resultIds: ['first', 'second'], groups: [], services: [], total: 2, found: 2 },
				},
			};
			const open = vi.fn(() => ({ closed: Promise.resolve({ status: 'closed' }) }));
			const official = createOfficialAccountView({
				document,
				window: { getComputedStyle: window.getComputedStyle.bind(window) },
				renderer: createAccountRenderer(),
				sdk: {
					getSnapshot: () => snapshot,
					subscribe: (listener) => {
						listener(snapshot);
						return () => {};
					},
					host: { open },
				},
			});
			const cards = [...list.querySelectorAll('.secret-card')];
			const triggers = cards.map((card) => card.querySelector('.card-menu-trigger'));
			const menus = cards.map((card) => card.querySelector('.card-menu-dropdown'));
			// Happy DOM has no layout engine; rectangles only enable the real keyboard visibility checks.
			for (const node of [...cards, ...list.querySelectorAll('.menu-item')]) {
				node.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
			}
			const controller = createAppearanceController(document, {
				setActionMode: (mode) => {
					document.documentElement.dataset.actionsMode = mode;
				},
			});
			let styleRevision = 0;
			const style = (node) => {
				// Happy DOM does not invalidate an ancestor's :has cache after a descendant class changes.
				// An unused custom property forces a fresh match without affecting the properties under test.
				node.style.setProperty('--test-style-revision', String(++styleRevision));
				return window.getComputedStyle(node);
			};
			const layer = (node) => Number.parseInt(style(node).zIndex, 10) || 0;
			const floatingActionLayer = layer(document.querySelector('.action-menu-float'));
			for (const mode of ['light', 'dark']) {
				document.documentElement.dataset.theme = mode;
				for (const density of ['comfortable', 'compact']) {
					controller.apply({ ...getBuiltinTheme(theme), settings: { density } });
					const closedLayer = style(cards[0]).zIndex;
					const closedDisplay = style(cards[0]).display;
					triggers[0].click();
					expect(menus[0].classList.contains('show')).toBe(true);
					expect(triggers[0].getAttribute('aria-expanded')).toBe('true');
					expect(document.activeElement).toBe(menus[0].querySelector('.menu-item'));
					expect(layer(cards[0])).toBeGreaterThan(layer(cards[1]));
					expect(layer(cards[0])).toBeGreaterThan(layer(document.querySelector('.action-menu-float')));
					expect(layer(cards[0])).toBeLessThan(floatingActionLayer);
					expect(layer(cards[0])).toBeLessThan(layer(document.querySelector('.sort-menu')));
					expect(layer(cards[0])).toBeLessThan(layer(document.getElementById('secretModal')));
					expect(style(cards[0]).display).toBe(closedDisplay);
					document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
					expect(document.activeElement).toBe(menus[0].querySelectorAll('.menu-item')[1]);
					document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
					expect(document.activeElement).toBe(triggers[0]);
					expect(style(cards[0]).zIndex).toBe(closedLayer);
					triggers[0].click();
					triggers[1].click();
					expect(triggers[0].getAttribute('aria-expanded')).toBe('false');
					expect(style(cards[0]).zIndex).toBe(closedLayer);
					expect(layer(cards[1])).toBeGreaterThan(layer(cards[0]));
					menus[1].querySelector('[data-account-action="edit"]').click();
					expect(open).toHaveBeenLastCalledWith({ kind: 'account-edit', account: { id: 'second', generation: 1 } }, expect.any(Object));
					expect(style(cards[1]).zIndex).toBe(closedLayer);
					triggers[0].click();
					document.body.click();
					expect(menus[0].classList.contains('show')).toBe(false);
					expect(style(cards[0]).zIndex).toBe(closedLayer);
				}
			}
			official.dispose();
		},
	);
	it.each([320, 390, 768, 1440])('marks the real account grid and keeps each theme column layout at %ipx', async (width) => {
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		windows.push(window);
		window.happyDOM.setWindowSize({ width, height: 900 });
		const document = window.document;
		document.write(await (await createMainPage()).text());
		const list = document.getElementById('secretsList');
		list.style.removeProperty('display');
		list.dataset.view = 'flat';
		const controller = createAppearanceController(document);
		for (const mode of ['light', 'dark']) {
			document.documentElement.dataset.theme = mode;
			for (const snapshot of [getBuiltinTheme('compact'), getBuiltinTheme('document'), getBuiltinTheme('compact')]) {
				controller.apply(snapshot);
				list.innerHTML = createAccountRenderer().card({ id: 'account', name: 'GitHub', code: '123456' });
				expect(document.getElementById('secretsList')).toBe(list);
				expect(list.dataset.part).toBe('account-grid');
				expect(document.querySelectorAll('[data-part="account-grid"]')).toHaveLength(1);
				const computed = window.getComputedStyle(list);
				expect(computed.display).toBe('grid');
				if (snapshot.manifest.id === 'compact') {
					expect(computed.gridTemplateColumns).toBe('1fr');
				} else if (width >= 768) {
					expect(computed.gridTemplateColumns).toContain('repeat(auto-fill,');
				}
			}
		}
	});

	it.each([320, 390, 768, 1440])('uses the marked single-column Compact grid in the isolated preview at %ipx', (width) => {
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		windows.push(window);
		window.happyDOM.setWindowSize({ width, height: 900 });
		const document = window.document;
		document.write(getAppearancePreviewDocument({ nonce: 'grid-review' }));
		const parent = { postMessage: vi.fn() };
		const context = vm.createContext({ window, document, parent, ArrayBuffer, Blob, URL, structuredClone: global.structuredClone });
		vm.runInContext(document.querySelector('script').textContent, context);
		const list = document.getElementById('secretsList');
		for (const mode of ['light', 'dark']) {
			for (const snapshot of [getBuiltinTheme('compact'), getBuiltinTheme('document'), getBuiltinTheme('compact')]) {
				window.dispatchEvent(
					new window.MessageEvent('message', {
						source: parent,
						data: { type: 'appearance-preview', nonce: 'grid-review', mode, snapshot },
					}),
				);
				expect(document.getElementById('secretsList')).toBe(list);
				expect(list.dataset.part).toBe('account-grid');
				expect(list.querySelectorAll('[data-part="account"]')).toHaveLength(5);
				const columns = window.getComputedStyle(list).gridTemplateColumns;
				if (snapshot.manifest.id === 'compact') {
					expect(columns).toBe('1fr');
				} else if (width >= 768) {
					expect(columns).toContain('repeat(auto-fill,');
				}
			}
		}
	});
	it('keeps built-in nodes and actions when valid custom IDs overlap every built-in type', async () => {
		const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		windows.push(window);
		window.document.write(await (await createMainPage()).text());
		const document = window.document;
		const ids = ['secretsList', 'loading', 'emptyState', 'searchInput', 'sortDropdown', 'mainActionBtn', 'actionSubmenu'];
		const originals = ids.map((id) => document.getElementById(id));
		originals.forEach((node) => expect(node).not.toBeNull());
		const copy = document.createElement('button');
		const copied = vi.fn();
		copy.addEventListener('click', copied);
		originals[0].append(copy);
		document.getElementById('searchInput').value = 'retained search';
		const builtin = getBuiltinTheme('fluent');
		const types = ['accounts', 'search', 'view-controls', 'system-status', 'actions', 'brand', 'footer', 'service-nav'];
		const manifest = validateManifest({
			...builtin.manifest,
			layout: {
				header: types.map((id) => ({ id, type: 'text' })),
				leading: [],
				main: types.map((type) => ({ id: 'native-' + type, type })),
				trailing: [],
				footer: [],
			},
			content: Object.fromEntries(types.map((id) => [id, { text: 'Custom ' + id }])),
		});
		const controller = createAppearanceController(document);
		for (const snapshot of [{ manifest }, builtin, { manifest }, builtin]) {
			controller.apply(snapshot);
			ids.forEach((id, index) => {
				expect(document.getElementById(id), id).toBe(originals[index]);
				expect(originals[index].isConnected, id).toBe(true);
			});
			expect(document.getElementById('searchInput').value).toBe('retained search');
			copy.click();
			if (snapshot.manifest === manifest) {
				for (const type of types) {
					expect(document.querySelector('[data-component-id="' + type + '"]').textContent).toBe('Custom ' + type);
				}
			}
		}
		expect(copied).toHaveBeenCalledTimes(4);
	});
	it.each([390, 768, 1440])('preserves Fluent base styles after lowering only ancestor specificity at %ipx', (width) => {
		const window = page();
		const document = window.document;
		window.happyDOM.setWindowSize({ width, height: 900 });
		document.body.className = 'fluent-app';
		document.getElementById('secretsList').innerHTML = createAccountRenderer().card({
			id: 'baseline',
			name: 'Google',
			account: 'work@example.com',
		});
		const source = getStyles().match(/<style>([\s\S]*?)<\/style>/)[1];
		const style = document.createElement('style');
		document.head.append(style);
		const properties = ['display', 'fontSize', 'fontFamily', 'color', 'backgroundColor', 'padding', 'borderRadius', 'gap', 'minWidth'];
		const selectors = [
			'body',
			'.content',
			'.secret-card',
			'.card-header',
			'.secret-info',
			'.service-icon',
			'.secret-name',
			'.otp-code',
			'.otp-next-code',
			'.card-menu-trigger',
		];
		const capture = () =>
			selectors.map((selector) => {
				const computed = window.getComputedStyle(document.querySelector(selector));
				return Object.fromEntries(properties.map((property) => [property, computed[property]]));
			});
		for (const mode of ['light', 'dark']) {
			document.documentElement.dataset.theme = mode;
			style.textContent = source.replaceAll(':where(.fluent-app)', '.fluent-app');
			const baseline = capture();
			style.textContent = source;
			expect(capture()).toEqual(baseline);
		}
	});

	it.each([390, 768, 1440])('lets compact and public part selectors override base CSS at %ipx', (width) => {
		const window = page();
		const document = window.document;
		window.happyDOM.setWindowSize({ width, height: 900 });
		document.body.className = 'fluent-app';
		document.documentElement.dataset.theme = 'light';
		const styles = document.createElement('style');
		styles.textContent = getStyles().match(/<style>([\s\S]*?)<\/style>/)[1];
		document.head.append(styles);
		document.getElementById('secretsList').innerHTML = createAccountRenderer().card({
			id: 'long',
			name: 'Google Workspace',
			account: 'a-very-long-account-name-that-must-not-expand-the-header@example.com',
		});
		const controller = createAppearanceController(document);
		const compact = getBuiltinTheme('compact');
		controller.apply(compact);
		const card = document.querySelector('[data-part="account"]');
		expect(window.getComputedStyle(card).display).toBe('grid');
		expect(window.getComputedStyle(card).gridTemplateColumns.includes('auto')).toBe(width >= 768);
		expect(window.getComputedStyle(document.querySelector('[data-part="account-header"]')).minWidth).toBe('0');
		expect(window.getComputedStyle(document.querySelector('[data-part="account-name"]')).textOverflow).toBe('ellipsis');
		expect(window.getComputedStyle(document.querySelector('[data-part="code"]')).fontSize).toBe('25px');
		controller.apply({
			...compact,
			css: '[data-part="account"]{display:block;padding:7px}[data-part="code"]{font-size:31px}[data-part="region-main"]{display:grid}',
		});
		expect(window.getComputedStyle(card).display).toBe('block');
		expect(window.getComputedStyle(card).paddingTop).toBe('7px');
		expect(window.getComputedStyle(document.querySelector('[data-part="code"]')).fontSize).toBe('31px');
		expect(window.getComputedStyle(document.querySelector('[data-part="region-main"]')).display).toBe('grid');
	});

	it('moves existing nodes without replacing codes, values, listeners, selection or modal state', () => {
		const window = page();
		const document = window.document;
		const list = document.getElementById('secretsList');
		list.innerHTML = createAccountRenderer().card({ id: '1', name: 'Google', account: 'a@example.com', code: '123456' });
		const code = document.getElementById('otp-1');
		const clicked = vi.fn();
		code.addEventListener('click', clicked);
		const search = document.getElementById('searchInput');
		search.value = 'Google';
		search.focus();
		search.setSelectionRange(1, 4);
		const setActionMode = vi.fn();
		const controller = createAppearanceController(document, { setActionMode });
		controller.apply({
			revision: 1,
			manifest: { id: 'document', layout, content: { note: { title: 'Title', text: '<script>unsafe</script>' } } },
		});
		expect(document.getElementById('otp-1')).toBe(code);
		expect(document.getElementById('secretsList')).toBe(list);
		expect(document.activeElement).toBe(search);
		expect(search.selectionStart).toBe(1);
		expect(search.selectionEnd).toBe(4);
		expect(document.getElementById('unsavedModalInput').value).toBe('keep me');
		code.click();
		expect(clicked).toHaveBeenCalledOnce();
		expect(document.querySelector('[data-part="text"]').textContent).toBe('Title<script>unsafe</script>');
		expect(document.querySelector('[data-part="text"] script')).toBeNull();
		expect(document.querySelectorAll('[data-component-id="accounts"]')).toHaveLength(1);
		expect(setActionMode).toHaveBeenCalledWith('toolbar');
		controller.apply({ revision: 2, manifest: { id: 'compact' } });
		expect(document.getElementById('otp-1')).toBe(code);
		expect(document.querySelector('[data-part="service-nav"]')).toBeNull();
		expect(setActionMode).toHaveBeenLastCalledWith('floating');
	});

	it('intersects the search result with canonical service groups and clears a removed group', () => {
		const window = page();
		const onFilter = vi.fn();
		const accounts = [
			{ id: '1', name: 'Google' },
			{ id: '2', name: 'Google' },
			{ id: '3', name: 'GitHub' },
		];
		const controller = createAppearanceController(window.document, {
			onFilter,
			groupServices: (items) =>
				items.length === 1
					? [{ key: 'other', name: 'Other', items, totalCount: 1 }]
					: [
							{ key: 'domain:google.com', name: 'Google', items: items.slice(0, 2), totalCount: 2 },
							{ key: 'other', name: 'Other', items: items.slice(2), totalCount: 1 },
						],
		});
		controller.apply({ manifest: { layout } });
		controller.filterServices(accounts, accounts);
		const selectedService = window.document.querySelector('[data-service-key="domain:google.com"]');
		selectedService.focus();
		selectedService.click();
		expect(window.document.activeElement.getAttribute('data-service-key')).toBe('domain:google.com');
		expect(onFilter).toHaveBeenCalledOnce();
		expect(controller.filterServices([accounts[1], accounts[2]], accounts)).toEqual([accounts[1]]);
		expect(controller.filterServices(accounts, accounts)).toEqual(accounts.slice(0, 2));
		expect(controller.filterServices([accounts[2]], [accounts[2]])).toEqual([accounts[2]]);
		expect(controller.hasFilter()).toBe(false);
		expect(window.document.activeElement.getAttribute('data-service-key')).toBe('');
	});

	it('applies typed settings and removes prior attributes when changing theme', () => {
		const window = page();
		const controller = createAppearanceController(window.document);
		controller.apply({
			manifest: {
				layout,
				tokens: { light: { '--2fa-accent': '#123456' } },
				settings: [
					{ key: 'color', default: '#abcdef', type: 'color', binding: { type: 'variable', name: '--2fa-accent' } },
					{ key: 'density', default: 'dense', type: 'select', binding: { type: 'attribute', name: 'data-theme-option-density' } },
					{ key: 'text', default: 'Hello', type: 'text', binding: { type: 'content', component: 'note', field: 'text' } },
				],
			},
			settings: { color: '#fedcba' },
		});
		expect(window.document.getElementById('appearance-config-css').textContent).toContain('--2fa-accent:#fedcba');
		expect(window.document.documentElement.getAttribute('data-theme-option-density')).toBe('dense');
		expect(window.document.querySelector('[data-part="text"]').textContent).toBe('Hello');
		controller.apply({ manifest: { layout } });
		expect(window.document.documentElement.hasAttribute('data-theme-option-density')).toBe(false);
	});

	it('renders validated mail links while rejecting script URLs in content', () => {
		const window = page();
		const document = window.document;
		createAppearanceController(document).apply({
			manifest: {
				layout: { ...layout, trailing: [{ id: 'contacts', type: 'links' }] },
				content: {
					contacts: {
						items: [
							{ label: 'Email', href: 'mailto:owner@example.com' },
							{ label: 'Invalid', href: 'javascript:alert(1)' },
						],
					},
				},
			},
		});
		expect(document.querySelector('[data-part="links"] a').getAttribute('href')).toBe('mailto:owner@example.com');
		expect(document.querySelector('[data-part="links"] a:last-child').getAttribute('href')).toBe('#');
	});

	it.each(['hidden', 'omitted'])('keeps a service filter removable when the new theme navigation is %s, preserving text search', (mode) => {
		const window = page();
		const document = window.document;
		const accounts = [
			{ id: '1', name: 'Google' },
			{ id: '2', name: 'GitHub' },
		];
		const queries = [];
		const controller = createAppearanceController(document, {
			onFilter: () => queries.push(document.getElementById('searchInput').value),
			groupServices: (items) => items.map((item) => ({ key: item.name, name: item.name, items: [item], totalCount: 1 })),
		});
		controller.apply({ manifest: { layout } });
		document.getElementById('searchInput').value = 'work account';
		controller.filterServices(accounts, accounts);
		document.querySelector('[data-service-key="Google"]').click();
		const nextLayout = { ...layout, leading: mode === 'hidden' ? [{ id: 'service-nav', type: 'service-nav', hidden: true }] : [] };
		controller.apply({ manifest: { layout: nextLayout } });
		expect(controller.hasFilter()).toBe(true);
		const clear = document.querySelector('[data-part="search"] .appearance-service-clear');
		expect(clear.hidden).toBe(false);
		clear.click();
		expect(controller.hasFilter()).toBe(false);
		expect(clear.hidden).toBe(true);
		expect(queries).toEqual(['work account', 'work account']);
		expect(document.getElementById('searchInput').value).toBe('work account');
	});

	it('escapes presentation text and dispatches account controls once without inline script', () => {
		const window = page();
		const container = window.document.getElementById('secretsList');
		const renderer = createAccountRenderer();
		const dispatch = vi.fn();
		container.innerHTML = renderer.card({
			id: '1" onclick="alert(1)',
			name: '<img src=x>',
			account: '"bad"',
			code: '123456',
			secret: 'SHOULD_NOT_RENDER',
		});
		const dispose = renderer.bind(container, dispatch);
		expect(container.querySelector('[onclick]')).toBeNull();
		expect(container.querySelector('.secret-name').textContent).toBe('<img src=x>');
		expect(container.innerHTML).not.toContain('SHOULD_NOT_RENDER');
		container.querySelector('[data-account-action="copy"]').click();
		expect(dispatch).toHaveBeenCalledOnce();
		expect(dispatch.mock.calls[0].slice(0, 2)).toEqual(['copy', '1" onclick="alert(1)']);
		container.querySelector('[data-account-action="edit"]').click();
		expect(dispatch).toHaveBeenCalledTimes(2);
		dispose();
		container.querySelector('.secret-card').click();
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	it('preserves outside-sort dismissal when copying from the card surface', () => {
		const window = page();
		const document = window.document;
		const dropdown = document.createElement('details');
		dropdown.id = 'sortDropdown';
		dropdown.open = true;
		dropdown.innerHTML = '<summary class="sort-trigger">Sort</summary>';
		document.body.prepend(dropdown);
		const container = document.getElementById('secretsList');
		const renderer = createAccountRenderer();
		container.innerHTML = renderer.card({ id: '1', name: 'Google' });
		const dispatch = vi.fn();
		renderer.bind(container, dispatch);
		const context = vm.createContext({ document, window, setTimeout, clearTimeout });
		vm.runInContext(getSearchCode(), context);
		context.initSortDropdownOutsideClose();
		container.querySelector('.secret-name').click();
		expect(dispatch.mock.calls[0][0]).toBe('copy');
		expect(dropdown.open).toBe(false);
	});

	it('stops an active FAB drag and removes its handlers when entering toolbar mode', () => {
		const window = page();
		const document = window.document;
		const context = vm.createContext({ document, window, localStorage: window.localStorage, setTimeout, clearTimeout });
		vm.runInContext(getUICode(), context);
		context.initFABDrag();
		context.initFABDrag();
		const button = document.getElementById('mainActionBtn');
		const fab = document.querySelector('.action-menu-float');
		button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
		expect(fab.classList.contains('dragging')).toBe(true);
		context.setActionPresentation('toolbar');
		document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
		document.dispatchEvent(new window.MouseEvent('mouseup'));
		window.dispatchEvent(new window.Event('resize'));
		expect(fab.classList.contains('dragging')).toBe(false);
		expect(fab.style.left).toBe('');
		expect(fab.style.top).toBe('');
		expect(window.localStorage.getItem('2fa-fab-position')).toBeNull();
		context.setActionPresentation('floating');
		button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
		expect(fab.classList.contains('dragging')).toBe(true);
		context.setActionPresentation('toolbar');
	});

	it('emits an isolated preview with no business startup or network permissions', () => {
		const html = getAppearancePreviewDocument({ nonce: 'session_123' });
		expect(html).toContain("connect-src 'none'");
		expect(html).toContain("script-src 'nonce-session_123'");
		expect(html).not.toContain('checkAuth(');
		expect(html).not.toContain('loadSecrets(');
		expect(html).not.toContain('fetch(');
		expect(html).toContain('event.source !== parent');
		expect(html).toContain('message.nonce !== nonce');
		expect(html).toContain('data-account-action');
		const script = html.match(/<script nonce="session_123">([\s\S]*)<\/script>/)[1];
		expect(() => new vm.Script(script)).not.toThrow();
		expect(() => new vm.Script(getAppearanceRuntimeCode())).not.toThrow();
	});

	it('accepts only its parent session and replaces local resources throughout preview configuration', () => {
		const window = page();
		const html = getAppearancePreviewDocument({ nonce: 'session_123' });
		const script = html.match(/<script nonce="session_123">([\s\S]*)<\/script>/)[1];
		window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
		const parent = { postMessage: vi.fn() };
		const createObjectURL = vi.fn(() => 'blob:https://example.com/preview-image');
		const context = vm.createContext({
			window,
			document: window.document,
			parent,
			ArrayBuffer,
			Blob,
			URL: { createObjectURL, revokeObjectURL: vi.fn() },
			structuredClone: global.structuredClone,
		});
		vm.runInContext(script, context);
		const deliver = (nonce) =>
			window.dispatchEvent(
				new window.MessageEvent('message', {
					source: parent,
					data: {
						type: 'appearance-preview',
						nonce,
						snapshot: {
							manifest: {
								layout: {
									...layout,
									trailing: [
										{ id: 'note', type: 'text' },
										{ id: 'picture', type: 'image' },
									],
								},
								content: { note: { text: 'Preview notes' }, picture: { src: 'p.png', alt: '' } },
							},
							resources: [{ hash: 'c'.repeat(64), name: 'p.png', url: 'local:upload-1' }],
						},
						resources: [{ url: 'local:upload-1', mime: 'image/png', bytes: new ArrayBuffer(4) }],
					},
				}),
			);
		deliver('wrong-session');
		expect(createObjectURL).not.toHaveBeenCalled();
		deliver('session_123');
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(window.document.querySelector('[data-part="image"] img').getAttribute('src')).toBe('blob:https://example.com/preview-image');
		expect(window.document.querySelectorAll('[data-part="account"]')).toHaveLength(5);
		expect(window.document.querySelector('[data-part="brand"] strong').textContent).toBe('2FA');
		const link = window.document.createElement('a');
		link.href = '/';
		window.document.body.append(link);
		expect(link.dispatchEvent(new window.MouseEvent('click', { cancelable: true, bubbles: true }))).toBe(false);
	});
});
