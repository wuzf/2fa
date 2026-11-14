import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

import { getWorkspaceStyles } from '../../src/ui/styles/workspace.js';
import { getAppearanceStyles } from '../../src/ui/styles/appearance.js';

const windows = [];
afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function searchSection(width) {
	const window = new Window();
	windows.push(window);
	window.happyDOM.setWindowSize({ width, height: 900 });
	window.document.head.innerHTML = '<style></style>';
	window.document.querySelector('style').textContent = getWorkspaceStyles();
	window.document.body.className = 'fluent-app';
	window.document.body.innerHTML = '<div class="container"><div class="content"><div class="search-section"></div></div></div>';
	return window.getComputedStyle(window.document.querySelector('.search-section'));
}

describe('official theme search row', () => {
	it('stays at the top while the accounts scroll, on desktops and phones', () => {
		for (const width of [1440, 390]) {
			const style = searchSection(width);
			expect(style.position).toBe('sticky');
			expect(style.top).toBe('0px');
			expect(Number(style.zIndex)).toBeGreaterThan(0);
		}
	});

	it('keeps the earlier spacing: the padding sits in the content padding above and the old gap below', () => {
		const desktop = searchSection(1440);
		expect(desktop.marginTop).toBe('-12px');
		expect(desktop.paddingTop).toBe('12px');
		// 24px below the search box as before: 12px padding + 12px margin.
		expect(parseFloat(desktop.paddingBottom) + parseFloat(desktop.marginBottom)).toBe(24);
		const phone = searchSection(390);
		expect(parseFloat(phone.paddingBottom) + parseFloat(phone.marginBottom)).toBe(20);
	});

	it('paints the page backdrop, so cards do not show through', () => {
		expect(getWorkspaceStyles()).toMatch(
			/\(?\.fluent-app\)? \.search-section \{[^}]*background: var\(--workspace-bg\) var\(--2fa-background-image, none\) center \/ cover fixed;/,
		);
	});

	it('keeps the same spacing inside a custom appearance layout', () => {
		// That layout zeroed the margin; the row's padding needs the same negative margin there.
		expect(getAppearanceStyles()).toContain('.appearance-layout .search-section {margin:-12px 0;}');
	});
});
