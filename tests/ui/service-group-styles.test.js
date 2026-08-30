import { describe, expect, it } from 'vitest';

import { getBaseStyles } from '../../src/ui/styles/base.js';
import { getComponentStyles } from '../../src/ui/styles/components.js';
import { getResponsiveStyles } from '../../src/ui/styles/responsive.js';
import { getVariables } from '../../src/ui/styles/variables.js';

function relativeLuminance(hex) {
	const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
	const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
	const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

function getRuleDeclarations(styles, selectorPattern) {
	const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 's'));
	if (!match) {
		throw new Error(`Missing CSS rule: ${selectorPattern}`);
	}
	return match[1];
}

function getHexCustomProperty(declarations, property) {
	const match = declarations.match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i'));
	if (!match) {
		throw new Error(`Missing CSS custom property: ${property}`);
	}
	return match[1];
}

describe('automatic service grouping styles', () => {
	it('keeps the outer grouped list unframed and the inner content in a grid', () => {
		const styles = getComponentStyles();

		expect(styles).toMatch(/\.secrets-list\.is-grouped\s*{[^}]*display:\s*block/s);
		expect(styles).toMatch(/\.service-group-grid\s*{[^}]*min-width:\s*0/s);
		expect(styles).toContain('.service-group-header::after');
		expect(styles).not.toMatch(/\.service-group\s*{[^}]*background:/s);
	});

	it('applies every existing responsive grid breakpoint to group grids', () => {
		const styles = getResponsiveStyles();

		expect(styles.match(/\.service-group-grid/g)).toHaveLength(3);
		expect(styles).toContain('minmax(240px, 1fr)');
		expect(styles).toContain('gap: 14px');
		expect(styles).toContain('gap: 16px');
	});

	it('provides stable mode controls and visible keyboard focus', () => {
		const styles = getBaseStyles();
		const optionDeclarations = getRuleDeclarations(styles, '\\.view-mode-option\\s*,\\s*\\.group-sort-option');
		const focusDeclarations = getRuleDeclarations(
			styles,
			'\\.view-mode-option:focus-visible\\s*,\\s*\\.group-sort-option:focus-visible\\s*,\\s*\\.sort-option:focus-visible',
		);

		expect(optionDeclarations).toMatch(/min-height:\s*36px/);
		expect(optionDeclarations).toMatch(/color:\s*var\(--segmented-option-text,\s*var\(--text-secondary\)\)/);
		expect(focusDeclarations).toMatch(/outline:\s*2px solid var\(--border-focus\)/);
		expect(focusDeclarations).toMatch(/outline-offset:\s*1px/);
	});

	it('bounds the sort menu by its measured placement without trapping scroll', () => {
		const styles = getBaseStyles();
		const menuDeclarations = getRuleDeclarations(styles, '\\.sort-menu');
		const upwardDeclarations = getRuleDeclarations(styles, '\\.sort-menu\\.opens-upward');

		expect(menuDeclarations).toMatch(/max-height:\s*calc\(100vh - 12px\)/);
		expect(menuDeclarations).toMatch(/max-height:\s*calc\(100dvh - 12px\)/);
		expect(menuDeclarations).toMatch(/overflow-y:\s*auto/);
		expect(menuDeclarations).not.toMatch(/90px|overscroll-behavior/);
		expect(upwardDeclarations).toMatch(/top:\s*auto/);
		expect(upwardDeclarations).toMatch(/bottom:\s*calc\(100% \+ 6px\)/);
	});

	it('keeps unselected segmented text above WCAG AA contrast in both themes', () => {
		const styles = getBaseStyles();
		const variables = getVariables();
		const segmentedDeclarations = getRuleDeclarations(styles, '\\.view-mode-segmented');
		const lightDeclarations = getRuleDeclarations(variables, ':root');
		const darkDeclarations = getRuleDeclarations(variables, '\\[data-theme="dark"\\]');
		const lightText = getHexCustomProperty(lightDeclarations, '--segmented-option-text');
		const lightBackground = getHexCustomProperty(lightDeclarations, '--bg-secondary');
		const darkText = getHexCustomProperty(darkDeclarations, '--segmented-option-text');
		const darkBackground = getHexCustomProperty(darkDeclarations, '--bg-secondary');

		expect(segmentedDeclarations).toMatch(/background:\s*var\(--bg-secondary\)/);
		expect(contrastRatio(lightText, lightBackground)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(darkText, darkBackground)).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps the empty search status in the accessibility tree', () => {
		const styles = getBaseStyles();
		const emptyStatusDeclarations = getRuleDeclarations(styles, '\\.search-stats:empty');

		expect(emptyStatusDeclarations).toMatch(/position:\s*absolute/);
		expect(emptyStatusDeclarations).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
		expect(emptyStatusDeclarations).not.toMatch(/display:\s*none|visibility:\s*hidden/);
	});
});
