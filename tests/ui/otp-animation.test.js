import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import { createMainPage } from '../../src/ui/page.js';
import { getComponentStyles } from '../../src/ui/styles/components.js';

const animations = [
	['otp-promote-current', 'otp-promote-current-slide', 360],
	['otp-promote-next', 'otp-promote-next-settle', 180],
	['otp-promote-flip-current', 'otp-promote-flip-current', 520],
	['otp-promote-flip-next', 'otp-promote-flip-next', 520],
	['otp-promote-spotlight-current', 'otp-promote-spotlight-current', 460],
	['otp-promote-spotlight-next', 'otp-promote-spotlight-next', 460],
	['otp-promotion-flyer-active', 'otp-promote-fly', 360],
	['otp-promotion-flyer-flip', 'otp-promote-source-flip', 520],
	['otp-promotion-flyer-spotlight', 'otp-promote-source-spotlight', 460],
];
const windows = [];
afterEach(async () => {
	await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

/** Parse semantic selectors/declarations, independent of whitespace and host scope suffixes. */
function inspect(source) {
	const keyframes = new Map();
	const rules = [];
	walk(parse(source), {
		enter(node) {
			if (node.type === 'Atrule' && node.name === 'keyframes') {
				keyframes.set(generate(node.prelude), node.block);
			}
			if (node.type !== 'Rule' || this.atrule?.name === 'keyframes') {
				return;
			}
			const classes = [];
			node.prelude.children.forEach((selector) =>
				selector.children.forEach((part) => {
					if (part.type === 'ClassSelector') {
						classes.push(part.name);
					}
				}),
			);
			rules.push({
				classes,
				reduced: this.atrule?.name === 'media' && generate(this.atrule.prelude).replace(/\s/g, '') === '(prefers-reduced-motion:reduce)',
				declarations: node.block.children.toArray().filter((part) => part.type === 'Declaration'),
			});
		},
	});
	return { keyframes, rules };
}
function verifyAnimationContract(source) {
	const parsed = inspect(source);
	for (const [className, name, milliseconds] of animations) {
		const declaration = parsed.rules
			.find((rule) => !rule.reduced && rule.classes.includes(className))
			?.declarations.find((item) => item.property === 'animation');
		expect(declaration, className).toBeDefined();
		const values = declaration.value.children.toArray();
		expect(values.find((item) => item.type === 'Identifier')?.name, className).toBe(name);
		const duration = values.find((item) => item.type === 'Dimension' && ['ms', 's'].includes(item.unit));
		expect(Number(duration.value) * (duration.unit === 's' ? 1000 : 1), className).toBe(milliseconds);
		expect(parsed.keyframes.has(name), name).toBe(true);
		expect(parsed.keyframes.get(name).children.size, name).toBeGreaterThanOrEqual(2);
	}
	for (const className of [...animations.map(([name]) => name), 'otp-promotion-flyer']) {
		const declarations = parsed.rules
			.filter((rule) => rule.reduced && rule.classes.includes(className))
			.flatMap((rule) => rule.declarations);
		expect(
			declarations.some((item) => item.property === 'animation' && generate(item.value) === 'none'),
			className,
		).toBe(true);
		if (className.startsWith('otp-promotion-flyer')) {
			expect(
				declarations.some((item) => item.property === 'display' && generate(item.value) === 'none' && item.important),
				className,
			).toBe(true);
		} else {
			expect(
				declarations.some((item) => item.property === 'transform' && generate(item.value) === 'none'),
				className,
			).toBe(true);
			expect(
				declarations.some((item) => item.property === 'opacity' && generate(item.value) === '1'),
				className,
			).toBe(true);
		}
	}
}
let inlineStyles;
async function getInlineStyles() {
	if (!inlineStyles) {
		const html = await (await createMainPage({ lazyLoad: false })).text();
		inlineStyles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
		expect(inlineStyles).toBeTruthy();
	}
	return inlineStyles;
}

describe('OTP promotion animation styles', () => {
	it('defines working promotion animations with named keyframes, exact durations and reduced-motion fallback', () => {
		verifyAnimationContract(getComponentStyles());
	});
	it('keeps flow travel separate from fixed-source flip and spotlight effects', () => {
		const { keyframes } = inspect(getComponentStyles());
		const flow = generate(keyframes.get('otp-promote-fly'));
		const flip = generate(keyframes.get('otp-promote-source-flip'));
		const spotlight = generate(keyframes.get('otp-promote-source-spotlight'));
		expect(flow).toContain('var(--otp-fly-x');
		expect(flow).toContain('var(--otp-fly-y');
		for (const source of [flip, spotlight]) {
			expect(source).toContain('translate(-50%,-50%)');
			expect(source).not.toContain('var(--otp-fly-x');
			expect(source).not.toContain('var(--otp-fly-y');
		}
	});
	it('preserves the complete contract in the actual main-page scoped inline CSS', async () => {
		verifyAnimationContract(await getInlineStyles());
	});
	it.each(['no-preference', 'reduce'])('applies the actual inline animation and visibility behavior with motion=%s', async (motion) => {
		const window = new Window({ settings: { device: { prefersReducedMotion: motion } } });
		windows.push(window);
		const document = window.document;
		const style = document.createElement('style');
		style.textContent = await getInlineStyles();
		document.head.append(style);
		for (const [className, name] of animations) {
			const node = document.createElement('span');
			node.className = className;
			document.body.append(node);
			const computed = window.getComputedStyle(node);
			// happy-dom exposes the cascaded shorthand but does not expand its animationName longhand.
			const animation = computed.getPropertyValue('animation');
			if (motion === 'reduce') {
				expect(animation, className).toBe('none');
				if (className.startsWith('otp-promotion-flyer')) {
					expect(computed.display, className).toBe('none');
				} else {
					expect(computed.transform, className).toBe('none');
					expect(computed.opacity, className).toBe('1');
				}
			} else {
				const identifier = parse(animation, { context: 'value' })
					.children.toArray()
					.find((item) => item.type === 'Identifier');
				expect(identifier?.name, className).toBe(name);
			}
		}
	});
});
