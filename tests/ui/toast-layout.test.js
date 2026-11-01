import { describe, expect, it } from 'vitest';
import { getDialogStyles } from '../../src/ui/styles/dialogs.js';
import { getResponsiveStyles } from '../../src/ui/styles/responsive.js';

const rules = (css, selector) =>
	[...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]);

describe('default theme toasts', () => {
	it('sizes the center toast to its message at every breakpoint', () => {
		const content = rules(getResponsiveStyles(), '.toast-content');
		expect(content.length).toBeGreaterThan(1);
		for (const body of content) {
			expect(body).not.toMatch(/min-width/);
		}
		expect(content[0]).toMatch(/max-width: min\(90vw, 560px\)/);
	});
	it('keeps the center and loading toasts in the middle of the viewport', () => {
		const center = rules(getResponsiveStyles(), '.center-toast')[0];
		expect(center).toMatch(/top: 50%/);
		expect(center).toMatch(/transform: translate\(-50%, -50%\)/);
		const loading = rules(getDialogStyles(), '.dialog-toast').find((body) => body.includes('position: fixed'));
		expect(loading).toMatch(/top: 50%/);
		expect(loading).toMatch(/transform: translate\(-50%, -50%\)/);
	});
});
