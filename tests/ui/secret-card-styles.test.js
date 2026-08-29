import { describe, expect, it } from 'vitest';

import { getComponentStyles } from '../../src/ui/styles/components.js';
import { getResponsiveStyles } from '../../src/ui/styles/responsive.js';

describe('secret card styles', () => {
	it('uses the large card radius at every viewport size', () => {
		const styles = getComponentStyles();
		const responsiveStyles = getResponsiveStyles();
		const responsiveCardRules = Array.from(responsiveStyles.matchAll(/\.secret-card\s*\{([\s\S]*?)\}/g), (match) => match[1]);

		expect(styles).toMatch(/\.secret-card\s*\{[\s\S]*?border-radius: var\(--radius-lg\);/);
		expect(responsiveCardRules).toHaveLength(2);
		for (const rule of responsiveCardRules) {
			expect(rule).not.toContain('border-radius:');
		}
	});

	it('overlays the top border without entering the rounded corners', () => {
		const styles = getComponentStyles();
		const progressTopRule = styles.match(/\.progress-top\s*\{([\s\S]*?)\}/)?.[1];

		expect(progressTopRule).toBeDefined();
		expect(progressTopRule).toContain('top: -1px;');
		expect(progressTopRule).toContain('background: transparent;');
		expect(progressTopRule).toContain('left: var(--radius-lg);');
		expect(progressTopRule).toContain('right: var(--radius-lg);');
		expect(progressTopRule).not.toContain('width: 100%;');
	});
});
