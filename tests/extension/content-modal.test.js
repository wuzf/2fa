// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectOtpTarget, fillOtpTarget, isWritableInput } from '../../extension/src/content/form.js';

let modals;

function input(parent = document.body) {
	const element = parent.ownerDocument.createElement('input');
	element.autocomplete = 'one-time-code';
	Object.defineProperty(element, 'getClientRects', {
		value: () => [{ left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 }],
	});
	parent.append(element);
	return element;
}

function dialog(parent = document.body) {
	const element = parent.ownerDocument.createElement('dialog');
	parent.append(element);
	return element;
}

function showModal(element, focused = element) {
	element.showModal();
	modals.add(element);
	element.tabIndex = -1;
	focused.focus();
}

function frame(parent = document.body) {
	const element = document.createElement('iframe');
	parent.append(element);
	Object.defineProperty(element.contentWindow, 'frameElement', { configurable: true, value: element });
	Object.defineProperties(element, {
		clientWidth: { value: 300 },
		clientHeight: { value: 150 },
		offsetWidth: { value: 300 },
		offsetHeight: { value: 150 },
	});
	Object.defineProperty(element, 'getBoundingClientRect', {
		value: () => ({ left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 }),
	});
	return element;
}

beforeEach(() => {
	document.body.replaceChildren();
	modals = new WeakSet();
	// Happy DOM has no browser top layer. Model only its native :modal state;
	// actual inert focus behavior is verified separately with Chrome DevTools.
	const matches = window.Element.prototype.matches;
	vi.spyOn(window.Element.prototype, 'matches').mockImplementation(function (selector) {
		return selector === ':modal' ? this.open && modals.has(this) : matches.call(this, selector);
	});
});

afterEach(() => vi.restoreAllMocks());

describe('native modal boundaries', () => {
	it('excludes the inert background and restores it after the modal closes', () => {
		const background = input();
		const overlay = dialog();
		showModal(overlay);
		expect(isWritableInput(background)).toBe(false);
		expect(detectOtpTarget(document).status).toBe('not_found');
		overlay.close();
		expect(detectOtpTarget(document).target.inputs).toEqual([background]);
	});

	it('fills the sole active modal OTP without counting the background OTP', () => {
		const background = input();
		const overlay = dialog();
		const target = input(overlay);
		showModal(overlay, target);
		const detected = detectOtpTarget(document);
		expect(detected.target.inputs).toEqual([target]);
		expect(fillOtpTarget(detected.target, '123456').status).toBe('filled');
		expect(background.value).toBe('');
	});

	it.each([false, true])('uses the active sibling modal independent of DOM order (reverse: %s)', (reverse) => {
		const first = dialog();
		const firstInput = input(first);
		const second = dialog();
		const secondInput = input(second);
		const order = reverse
			? [
					[second, secondInput],
					[first, firstInput],
				]
			: [
					[first, firstInput],
					[second, secondInput],
				];
		for (const [modal, field] of order) {
			showModal(modal, field);
		}
		expect(detectOtpTarget(document).target.inputs).toEqual([order[1][1]]);
		order[1][0].close();
		order[0][1].focus();
		expect(detectOtpTarget(document).target.inputs).toEqual([order[0][1]]);
	});

	it('does not guess among multiple modals when native focus has been lost', () => {
		const first = dialog();
		const second = dialog();
		input(first);
		const target = input(second);
		showModal(first);
		showModal(second, target);
		target.blur();
		expect(detectOtpTarget(document).status).toBe('not_found');
	});

	it('does not treat a nonmodal show() dialog as a document blocker', () => {
		const background = input();
		dialog().show();
		expect(detectOtpTarget(document).target.inputs).toEqual([background]);
	});

	it('finds an active modal and its slotted input across open shadow boundaries', () => {
		const background = input();
		const host = document.createElement('div');
		document.body.append(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const overlay = dialog(shadow);
		const slot = document.createElement('slot');
		overlay.append(slot);
		const target = input(host);
		Object.defineProperty(target, 'assignedSlot', { configurable: true, value: slot });
		showModal(overlay);
		expect(detectOtpTarget(document).target.inputs).toEqual([target]);
		expect(isWritableInput(background)).toBe(false);
	});

	it('blocks a same-origin iframe behind a top-document modal', () => {
		const embedded = frame();
		const target = input(embedded.contentDocument.body);
		const overlay = dialog();
		showModal(overlay);
		expect(isWritableInput(target)).toBe(false);
		expect(detectOtpTarget(document).status).toBe('not_found');
		overlay.close();
		expect(detectOtpTarget(document).target.inputs).toEqual([target]);
	});

	it('allows an iframe inside the active top-document modal', () => {
		const overlay = dialog();
		const embedded = frame(overlay);
		const target = input(embedded.contentDocument.body);
		showModal(overlay);
		expect(detectOtpTarget(document).target.inputs).toEqual([target]);
	});

	it('limits a child-document modal to its own document', () => {
		const embedded = frame();
		const child = embedded.contentDocument;
		const background = input(child.body);
		const overlay = dialog(child.body);
		const target = input(overlay);
		showModal(overlay, target);
		expect(detectOtpTarget(document).target.inputs).toEqual([target]);
		expect(isWritableInput(background)).toBe(false);
		const top = input();
		expect(isWritableInput(top)).toBe(true);
		expect(detectOtpTarget(document).status).toBe('ambiguous');
	});

	it('rejects a prepared target when a modal opens before writing', () => {
		const target = input();
		const prepared = detectOtpTarget(document).target;
		showModal(dialog());
		expect(fillOtpTarget(prepared, '123456').status).toBe('failed');
		expect(target.value).toBe('');
	});

	it('rechecks modal state after a synchronous beforeinput handler opens a modal', () => {
		const target = input();
		const overlay = dialog();
		const prepared = detectOtpTarget(document).target;
		target.addEventListener('beforeinput', () => showModal(overlay), { once: true });
		expect(fillOtpTarget(prepared, '123456').status).toBe('failed');
		expect(target.value).toBe('');
	});

	it('shares one modal scan across all inputs in a detection', () => {
		for (let index = 0; index < 20; index++) {
			input();
		}
		const query = vi.spyOn(document, 'querySelectorAll');
		detectOtpTarget(document);
		expect(query.mock.calls.filter(([selector]) => selector === '*')).toHaveLength(1);
	});

	it.each([6, 8])('keeps modal scans proportional to page events when filling %i digits', (length) => {
		const group = document.createElement('div');
		group.setAttribute('aria-label', 'Authenticator code');
		document.body.append(group);
		for (let index = 0; index < length; index++) {
			input(group).maxLength = 1;
		}
		const target = detectOtpTarget(document).target;
		const query = vi.spyOn(document, 'querySelectorAll');
		expect(fillOtpTarget(target, '12345678'.slice(0, length)).status).toBe('filled');
		// One fresh snapshot per beforeinput/input/change boundary, shared by
		// every field; input count must not multiply these document traversals.
		expect(query.mock.calls.filter(([selector]) => selector === '*').length).toBeLessThanOrEqual(3 * length + 2);
	});
});
