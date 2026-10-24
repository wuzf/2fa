import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { createMainPage } from '../../src/ui/page.js';
import { createHostAppearanceManager, normalizeHostAppearance } from '../../src/ui/runtime/hostAppearance.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	for (const item of fixtures.splice(0)) {
		if (item.dispose) {
			await item.dispose();
		} else {
			await item.happyDOM.abort();
		}
	}
});
async function page(mode = 'light', width = 1440) {
	const window = new Window({
		url: 'https://vault.test/',
		settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true },
	});
	fixtures.push(window);
	window.happyDOM.setWindowSize({ width, height: 1000 });
	window.document.write((await (await createMainPage()).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
	window.document.documentElement.dataset.theme = mode;
	const manager = createHostAppearanceManager({ document: window.document, normalize: normalizeHostAppearance });
	return {
		window,
		width,
		document: window.document,
		scope: manager.createScope(),
		style: (selector) => window.getComputedStyle(window.document.querySelector(selector)),
	};
}
function recalculateStyles(h) {
	// happy-dom caches ancestor-dependent selector matches across an html data
	// attribute change. Render the exact resulting DOM/CSS in a fresh document;
	// Chrome verifies the in-place transition separately.
	const snapshot = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
	fixtures.push(snapshot);
	snapshot.happyDOM.setWindowSize({ width: h.width, height: 1000 });
	snapshot.document.write(h.document.documentElement.outerHTML);
	h.style = (selector) => snapshot.getComputedStyle(snapshot.document.querySelector(selector));
}
describe('complete host component appearance', () => {
	it.each([false, true])('suspends transitions only for the owned parent subtree (app appearance=%s)', async (appAppearance) => {
		const h = await page();
		if (appAppearance) {
			h.scope.setAppearance({ surface: '#fffdf7' });
			h.scope.activate();
			recalculateStyles(h);
		}
		const selectors = ['#toolsModal', '#toolsModal .modal-content', '#toolsModal .tool-item', '#toolsModal .tool-title'];
		const unaffected = [
			'#settingsModal .sync-card',
			'#settingsModal .modal-content',
			'#qrModal .modal-content',
			'#secretModal .modal-content',
		];
		const baseline = selectors.map((selector) => h.style(selector).transition);
		const ordinary = unaffected.map((selector) => h.style(selector).transition);
		for (const transition of baseline.slice(1, 3)) {
			expect(transition).toBeTruthy();
			expect(transition).not.toBe('none');
		}
		const parent = h.document.getElementById('toolsModal');
		parent.setAttribute('data-theme-host-suspended', '');
		recalculateStyles(h);
		expect(selectors.map((selector) => h.style(selector).transition)).toEqual(['none', 'none', 'none', 'none']);
		expect(unaffected.map((selector) => h.style(selector).transition)).toEqual(ordinary);
		parent.removeAttribute('data-theme-host-suspended');
		recalculateStyles(h);
		expect(selectors.map((selector) => h.style(selector).transition)).toEqual(baseline);
		expect(unaffected.map((selector) => h.style(selector).transition)).toEqual(ordinary);
	});
	it.each([
		['light', 390],
		['light', 1440],
		['dark', 390],
		['dark', 1440],
	])('uses horizontal flex sizing for theme options at %s %ipx and preserves the original column fallback', async (mode, width) => {
		const h = await page(mode, width);
		const read = () => ({
			direction: h.style('#settingsModal .theme-options').flexDirection,
			wrap: h.style('#settingsModal .theme-options').flexWrap,
			basis: h.style('#settingsModal .theme-option').flexBasis,
			minHeight: h.style('#settingsModal .theme-option').minHeight,
		});
		const baseline = read();
		expect(baseline.direction).toBe('column');
		h.scope.setAppearance({ surface: '#fffdf7' });
		h.scope.activate();
		recalculateStyles(h);
		expect(read()).toEqual({ direction: 'row', wrap: 'wrap', basis: '130px', minHeight: '44px' });
		expect(h.style('#settingsModal .theme-option').flexGrow).toBe('1');
		expect(h.style('#settingsModal .theme-option').flexShrink).toBe('1');
		h.scope.dispose();
		recalculateStyles(h);
		expect(read()).toEqual(baseline);
	});
	it('emits the public baseline inside the head and omits it completely from the safe shell', async () => {
		const packageId = 'b'.repeat(64);
		const appearance = {
			kind: 'app',
			packageId,
			revision: 1,
			manifest: { themeApiVersion: 2 },
			publicAppearance: { formatVersion: 1, packageId, light: { surface: '#abc123' }, dark: { surface: '#def456' }, fonts: [] },
		};
		const normal = await (await createMainPage({ appearance })).text();
		expect(normal.indexOf('<style id="public-appearance-baseline">')).toBeGreaterThan(0);
		expect(normal.indexOf('<style id="public-appearance-baseline">')).toBeLessThan(normal.indexOf('</head>'));
		const safe = await (await createMainPage({ appearance, safeMode: true })).text();
		expect(safe).not.toContain('<style id="public-appearance-baseline">');
		expect(safe).not.toContain('#abc123');
	});
	it.each(['light', 'dark'])(
		'covers the real modal inventory and formerly inline %s parts while restoring the official layout',
		async (mode) => {
			const h = await page(mode);
			const modalIds = [...h.document.querySelectorAll('.modal')].map((node) => node.id);
			expect(modalIds).toEqual(
				expect.arrayContaining([
					'secretModal',
					'settingsModal',
					'toolsModal',
					'importModal',
					'restoreModal',
					'exportFormatModal',
					'freeotpExportModal',
					'totpAuthExportModal',
					'webdavModal',
					's3Modal',
					'oneDriveModal',
					'googleDriveModal',
					'browserExtensionModal',
					'loginModal',
				]),
			);
			expect(modalIds.length).toBe(24);
			const parts = [
				'#settingsModal .theme-option',
				'#encodedResult',
				'#decodedResult',
				'#timestampModal .time-info',
				'#checkResultContent',
				'#keyGeneratorModal .key-result',
				'#qrDecodeModal .decode-result',
				'#oneDriveOauthWarning',
				'#googleDriveOauthWarning',
				'#freeotpExportModal .dialog-export-help',
				'#totpAuthExportModal .dialog-export-help',
				'#generatedQRCode',
				'#decodeQRCode',
			];
			const inspected = [
				...modalIds.map((id) => '#' + id + ' .modal-content'),
				...parts,
				'#settingsModal .settings-layout',
				'#settingsModal .settings-tabs',
				'#settingsModal .settings-tab',
				'#timestampModal #progressBar',
			];
			const read = (selector) => {
				const style = h.style(selector);
				return Object.fromEntries(
					[
						'background',
						'backgroundColor',
						'backgroundImage',
						'borderRadius',
						'borderTopWidth',
						'fontFamily',
						'boxShadow',
						'padding',
						'margin',
						'position',
						'zIndex',
						'flexDirection',
						'width',
					].map((key) => [key, style[key]]),
				);
			};
			const baseline = inspected.map(read);
			expect(h.style('#settingsModal .theme-option').borderRadius).toBe('4px');
			expect(h.style('#encodedResult').borderRadius).toBe('6px');
			expect(h.style('#settingsModal .settings-tabs').width).toBe('164px');
			h.scope.setAppearance({
				surface: '#fcf5df',
				text: '#121212',
				subtle: '#f0e6cc',
				line: '#332211',
				stroke: '#332211',
				accent: '#553377',
				radius: 0,
				controlRadius: 0,
				borderWidth: 2,
				fontFamily: ['Example UI', 'sans-serif'],
				controlShadow: null,
			});
			h.scope.activate();
			recalculateStyles(h);
			for (const id of modalIds) {
				expect(h.style('#' + id + ' .modal-content').borderRadius, id).toBe('0px');
				expect(h.style('#' + id + ' .modal-content').borderTopWidth, id).toBe('2px');
			}
			for (const selector of parts) {
				expect(h.style(selector).borderRadius, selector).toBe('0px');
			}
			expect(h.style('#settingsModal .theme-option').borderTopWidth).toBe('2px');
			expect(h.style('#timestampModal #progressBar').backgroundImage).not.toContain('gradient');
			expect(h.style('#settingsModal .settings-layout').flexDirection).toBe('column');
			expect(h.style('#settingsModal .settings-tabs').display).toBe('flex');
			expect(h.style('#settingsModal .settings-tab').minHeight).toBe('44px');
			expect(h.style('#secretKey').fontFamily).toContain('monospace');
			h.scope.dispose();
			recalculateStyles(h);
			expect(inspected.map(read)).toEqual(baseline);
		},
	);
	it('uses real lazy migration templates and moved queue parts without changing QR paper or result semantics', async () => {
		const h = await createRuntimeFixture({
			full: true,
			fetch: async () => Response.json({ success: true }),
			extraSource: 'window.__runtimeFixture.createScope=createAppThemeSdkScope;',
		});
		fixtures.push(h);
		h.replaceSecretRecords([{ id: 'demo', name: 'Example', account: 'demo@example.invalid', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }], {
			source: 'server',
			accessVerified: true,
		});
		h.window.eval('showExportToGoogleModal()');
		h.window.showGoogleMigrationPreview([{ name: 'Example', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }]);
		const scope = h.createScope({ isCurrent: () => true });
		const style = (node) => h.window.getComputedStyle(node);
		const lists = [...h.document.querySelectorAll('.dialog-transfer-list')];
		expect(lists).toHaveLength(2);
		expect(style(lists[0]).borderRadius).toBe('8px');
		scope.sdk.host.setAppearance({
			radius: 0,
			controlRadius: 0,
			borderWidth: 2,
			surface: '#fcf5df',
			subtle: '#f0e6cc',
			text: '#121212',
			line: '#332211',
			stroke: '#332211',
		});
		scope.activateHostAppearance();
		for (const list of lists) {
			expect(style(list).borderRadius).toBe('0px');
			expect(style(list).borderTopWidth).toBe('2px');
		}
		expect(h.document.querySelector('.migration-preview-item input[type=checkbox]').checked).toBe(true);
		const modal = h.document.createElement('div');
		modal.className = 'modal';
		modal.innerHTML = '<div class="modal-content"></div>';
		h.document.body.append(modal);
		modal.firstElementChild.append(h.document.getElementById('offlineQueue'));
		expect(style(h.document.getElementById('offlineQueue')).borderRadius).toBe('0px');
		const paper = h.document.createElement('div');
		paper.className = 'dialog-qr-paper';
		paper.append(h.document.createElement('img'));
		modal.firstElementChild.append(paper);
		expect(['white', 'rgb(255, 255, 255)']).toContain(style(paper).backgroundColor);
		scope.dispose();
	});
});
