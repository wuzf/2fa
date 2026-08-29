import { describe, expect, it } from 'vitest';

import { createMainPage } from '../../src/ui/page.js';
import { getComponentStyles } from '../../src/ui/styles/components.js';

const promotionClassNames = [
	'otp-promote-current',
	'otp-promote-next',
	'otp-promote-flip-current',
	'otp-promote-flip-next',
	'otp-promote-spotlight-current',
	'otp-promote-spotlight-next',
];

const animationMarkers = [
	...promotionClassNames.map((className) => `.${className}`),
	'.otp-promotion-flyer',
	'.otp-promotion-flyer-active',
	'.otp-promotion-flyer-flip',
	'.otp-promotion-flyer-spotlight',
	'@keyframes otp-promote-current-slide',
	'@keyframes otp-promote-next-settle',
	'@keyframes otp-promote-fly',
	'@keyframes otp-promote-flip-current',
	'@keyframes otp-promote-flip-next',
	'@keyframes otp-promote-spotlight-current',
	'@keyframes otp-promote-spotlight-next',
	'@keyframes otp-promote-source-flip',
	'@keyframes otp-promote-source-spotlight',
	'@media (prefers-reduced-motion: reduce)',
];

const flyerClassNames = ['otp-promotion-flyer-active', 'otp-promotion-flyer-flip', 'otp-promotion-flyer-spotlight'];

function expectClassAnimationHasKeyframes(styles, className) {
	const classRule = styles.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
	expect(classRule, `missing .${className} rule`).not.toBeNull();

	const animationName = classRule[1].match(/animation:\s*([\w-]+)/)?.[1];
	expect(animationName, `missing animation declaration for .${className}`).toBeTruthy();
	expect(styles).toContain(`@keyframes ${animationName}`);
}

function getKeyframeStyles(styles, keyframeName) {
	const marker = `@keyframes ${keyframeName}`;
	const start = styles.indexOf(marker);
	expect(start, `missing ${marker}`).toBeGreaterThanOrEqual(0);
	const nextStart = styles.indexOf('@keyframes ', start + marker.length);
	return styles.slice(start, nextStart === -1 ? styles.length : nextStart);
}

describe('OTP promotion animation styles', () => {
	it('defines the promotion classes, keyframes, and reduced-motion fallback', () => {
		const styles = getComponentStyles();

		for (const marker of animationMarkers) {
			expect(styles).toContain(marker);
		}
		for (const className of promotionClassNames) {
			expectClassAnimationHasKeyframes(styles, className);
		}
		for (const className of flyerClassNames) {
			expectClassAnimationHasKeyframes(styles, className);
		}

		const reducedMotionStart = styles.indexOf('@media (prefers-reduced-motion: reduce)');
		const reducedMotionEnd = styles.indexOf('.progress-mini', reducedMotionStart);
		const reducedMotionStyles = styles.slice(reducedMotionStart, reducedMotionEnd);
		for (const className of [...promotionClassNames, 'otp-promotion-flyer', ...flyerClassNames]) {
			expect(reducedMotionStyles).toContain(`.${className}`);
		}

		expect(styles).toContain('animation: otp-promote-current-slide 360ms');
		expect(styles).toContain('animation: otp-promote-next-settle 180ms');
		expect(styles).toContain('animation: otp-promote-fly 360ms');
		expect(styles).toContain('animation: otp-promote-flip-current 520ms');
		expect(styles).toContain('animation: otp-promote-flip-next 520ms');
		expect(styles).toContain('animation: otp-promote-spotlight-current 460ms');
		expect(styles).toContain('animation: otp-promote-spotlight-next 460ms');
		expect(styles).toContain('animation: otp-promote-source-flip 520ms');
		expect(styles).toContain('animation: otp-promote-source-spotlight 460ms');
		expect(styles).toContain('animation: none;');
	});

	it('keeps flow travel separate from fixed-source flip and spotlight effects', () => {
		const styles = getComponentStyles();
		const flowFlyStyles = getKeyframeStyles(styles, 'otp-promote-fly');
		const flipSourceStyles = getKeyframeStyles(styles, 'otp-promote-source-flip');
		const spotlightSourceStyles = getKeyframeStyles(styles, 'otp-promote-source-spotlight');

		expect(flowFlyStyles).toContain('var(--otp-fly-x');
		expect(flowFlyStyles).toContain('var(--otp-fly-y');
		expect(flipSourceStyles).toContain('translate(-50%, -50%)');
		expect(spotlightSourceStyles).toContain('translate(-50%, -50%)');
		expect(flipSourceStyles).not.toContain('var(--otp-fly-x');
		expect(flipSourceStyles).not.toContain('var(--otp-fly-y');
		expect(spotlightSourceStyles).not.toContain('var(--otp-fly-x');
		expect(spotlightSourceStyles).not.toContain('var(--otp-fly-y');
	});

	it('keeps the animation CSS visible in the main page inline style', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();
		const styleStart = html.indexOf('<style>');
		const styleEnd = html.indexOf('</style>', styleStart);

		expect(styleStart).toBeGreaterThanOrEqual(0);
		expect(styleEnd).toBeGreaterThan(styleStart);

		const inlineStyles = html.slice(styleStart, styleEnd);
		for (const marker of animationMarkers) {
			expect(inlineStyles).toContain(marker);
		}
		for (const className of promotionClassNames) {
			expectClassAnimationHasKeyframes(inlineStyles, className);
		}
		for (const className of flyerClassNames) {
			expectClassAnimationHasKeyframes(inlineStyles, className);
		}
	});
});
