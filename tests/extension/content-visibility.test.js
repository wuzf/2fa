// @vitest-environment happy-dom

import { afterEach, expect, it } from 'vitest';
import { detectOtpTarget, fillOtpTarget } from '../../extension/src/content/form.js';

function box(element, left = 0, top = 0, width = 200, height = 40) {
	const rect = { left, top, width, height, right: left + width, bottom: top + height };
	Object.defineProperties(element, {
		getBoundingClientRect: { value: () => rect },
		getClientRects: { value: () => [rect] },
		offsetWidth: { value: width },
		offsetHeight: { value: height },
	});
	return element;
}

function fixture(style, onAncestor = false) {
	const container = box(document.createElement('div'));
	const input = box(document.createElement('input'));
	input.autocomplete = 'one-time-code';
	(onAncestor ? container : input).style.cssText = style;
	container.append(input);
	document.body.append(container);
	return { container, input };
}

afterEach(() => document.body.replaceChildren());

it.each([
	'clip-path:inset(100%)',
	'clip-path:inset(50% 0)',
	'clip-path:inset(0 100px)',
	'position:absolute;clip:rect(0px,0px,0px,0px)',
	'position:fixed;clip:rect(0px,200px,0px,0px)',
	'clip-path:circle(0%)',
	'clip-path:url(#unknown-shape)',
])('excludes a completely clipped or unverified input: %s', (style) => {
	const { input } = fixture(style);
	expect(detectOtpTarget(document).status).toBe('not_found');
	expect(input.value).toBe('');
});

it.each(['clip-path:inset(100%)', 'position:absolute;clip:rect(0px,0px,0px,0px)'])(
	'excludes an input clipped by its ancestor: %s',
	(style) => {
		fixture(style, true);
		expect(detectOtpTarget(document).status).toBe('not_found');
	},
);

it.each([
	'clip-path:inset(0)',
	'clip-path:inset(10% 25%)',
	'clip-path:inset(2px 10px 4px 20px)',
	'position:absolute;clip:rect(0px,100px,20px,0px)',
	'position:static;clip:rect(0px,0px,0px,0px)',
])('fills the surviving visible area: %s', (style) => {
	const { input } = fixture(style);
	const detected = detectOtpTarget(document);
	expect(detected.status).toBe('ready');
	expect(fillOtpTarget(detected.target, '123456').status).toBe('filled');
	expect(input.value).toBe('123456');
});

it('does not count a clipped duplicate as a second OTP region', () => {
	fixture('clip-path:inset(100%)');
	const { input } = fixture('');
	expect(detectOtpTarget(document).target.inputs).toEqual([input]);
});

it('rejects a prepared target when its ancestor becomes clipped', () => {
	const { container, input } = fixture('');
	const detected = detectOtpTarget(document);
	container.style.clipPath = 'inset(100%)';
	expect(fillOtpTarget(detected.target, '123456').status).toBe('failed');
	expect(input.value).toBe('');
});

it('stops before writing if beforeinput clips the target', () => {
	const { container, input } = fixture('');
	const detected = detectOtpTarget(document);
	input.addEventListener('beforeinput', () => (container.style.clipPath = 'inset(100%)'), { once: true });
	expect(fillOtpTarget(detected.target, '123456').status).toBe('failed');
	expect(input.value).toBe('');
});
