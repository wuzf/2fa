import { describe, expect, it } from 'vitest';

import { getUICode } from '../../src/ui/scripts/ui.js';

function createClamp({ controlsRect = null, width = 390, height = 844 } = {}) {
	const document = {
		addEventListener: () => {},
		documentElement: { clientHeight: height, clientWidth: width },
		querySelector: (selector) => (selector === '.search-action-row' && controlsRect ? { getBoundingClientRect: () => controlsRect } : null),
	};
	const window = { addEventListener: () => {}, innerHeight: height, innerWidth: width };

	// eslint-disable-next-line no-new-func
	return new Function(
		'document',
		'window',
		`${getUICode()}
      return clampFABPosition;
    `,
	)(document, window);
}

describe('floating action button positioning', () => {
	it('keeps a position near the search controls instead of jumping to the bottom', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 122, left: 30, right: 375, top: 16 },
		});

		expect(clamp(342, 39, 40, 40)).toEqual({ x: 342, y: 130 });
	});

	it('keeps a non-overlapping saved position unchanged', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 122, left: 30, right: 375, top: 16 },
		});

		expect(clamp(342, 300, 40, 40)).toEqual({ x: 342, y: 300 });
	});

	it('allows dragging past the controls when there is room above them', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 200, left: 30, right: 375, top: 150 },
		});

		expect(clamp(200, 130, 40, 40)).toEqual({ x: 200, y: 102 });
	});

	it('uses space beside the controls when it is the nearest available position', () => {
		const clamp = createClamp({
			width: 1200,
			controlsRect: { bottom: 100, left: 200, right: 1000, top: 20 },
		});

		expect(clamp(170, 40, 48, 48)).toEqual({ x: 144, y: 40 });
	});

	it('keeps the stored position stable when it is restored or constrained again', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 122, left: 30, right: 375, top: 16 },
		});
		const position = clamp(342, 39, 40, 40);

		expect(clamp(position.x, position.y, 40, 40)).toEqual(position);
	});

	it('keeps the button within the viewport after a resize', () => {
		const clamp = createClamp({ width: 320, height: 600 });

		expect(clamp(1000, 900, 40, 40)).toEqual({ x: 272, y: 552 });
		expect(clamp(-20, -30, 40, 40)).toEqual({ x: 8, y: 8 });
	});
});
