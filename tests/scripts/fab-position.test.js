import { describe, expect, it } from 'vitest';

import { getUICode } from '../../src/ui/scripts/ui.js';

function createClamp({ controlsRect = null, width = 390, height = 844 } = {}) {
	const document = {
		addEventListener: () => {},
		documentElement: { clientHeight: height, clientWidth: width },
		querySelector: (selector) =>
			selector === '.search-action-row' && controlsRect
				? { getBoundingClientRect: () => controlsRect }
				: null,
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
	it('moves a restored mobile position away from the search controls', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 122, left: 30, right: 375, top: 16 },
		});

		expect(clamp(342, 39, 40, 40)).toEqual({ x: 342, y: 796 });
	});

	it('keeps a non-overlapping saved position unchanged', () => {
		const clamp = createClamp({
			controlsRect: { bottom: 122, left: 30, right: 375, top: 16 },
		});

		expect(clamp(342, 300, 40, 40)).toEqual({ x: 342, y: 300 });
	});
});
