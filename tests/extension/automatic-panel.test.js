// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomaticPanel } from '../../extension/src/content/automatic-panel.js';

const ACCOUNTS = [
	{ id: 'one', name: 'GitHub', account: 'alice' },
	{ id: 'two', name: 'GitHub', account: 'bob' },
];
let controllers;
let shadows;
let shownPopovers;

function box(element, { left = 40, top = 50, width = 200, height = 24 } = {}) {
	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ left, top, right: left + width, bottom: top + height, width, height }),
	});
	return element;
}

function input(parent = document.body) {
	const element = box(parent.ownerDocument.createElement('input'));
	parent.append(element);
	return element;
}

function modal(parent = document.body) {
	const element = parent.ownerDocument.createElement('dialog');
	element.setAttribute('data-modal-fixture', '');
	parent.append(element);
	element.showModal();
	return element;
}

function frame(parent = document.body) {
	const element = parent.ownerDocument.createElement('iframe');
	parent.append(element);
	// Happy DOM does not expose the browser's child-window frameElement link.
	if (element.contentWindow.frameElement !== element) {
		Object.defineProperty(element.contentWindow, 'frameElement', { configurable: true, value: element });
	}
	return element;
}

function trusted(element, type, details = {}) {
	const event = new window.Event(type, { bubbles: true, composed: true, cancelable: true });
	Object.defineProperty(event, 'isTrusted', { value: true });
	for (const [name, value] of Object.entries(details)) {
		Object.defineProperty(event, name, { value });
	}
	element.dispatchEvent(event);
}

function show(target, options = {}) {
	const controller = createAutomaticPanel({ doc: document });
	controllers.push(controller);
	const selected = vi.fn();
	const retried = vi.fn();
	const closed = vi.fn(() => controller.remove());
	controller.show({ input: target, accounts: ACCOUNTS, onSelect: selected, onRetry: retried, onClose: closed, ...options });
	const shadow = shadows.at(-1);
	return { controller, shadow, host: shadow.host, selected, retried, closed };
}

beforeEach(() => {
	document.body.replaceChildren();
	controllers = [];
	shadows = [];
	shownPopovers = new Set();
	const attachShadow = window.Element.prototype.attachShadow;
	vi.spyOn(window.Element.prototype, 'attachShadow').mockImplementation(function (options) {
		const root = attachShadow.call(this, options);
		if (this.hasAttribute('data-twofa-autofill')) {
			shadows.push(root);
		}
		return root;
	});
	// Happy DOM does not implement modal top-layer state or the Popover API.
	// Model those API boundaries here; actual hit testing/focus is browser-tested.
	const matches = window.Element.prototype.matches;
	vi.spyOn(window.Element.prototype, 'matches').mockImplementation(function (selector) {
		return selector === ':modal' ? this.open && this.hasAttribute('data-modal-fixture') : matches.call(this, selector);
	});
	Object.defineProperty(window.HTMLElement.prototype, 'showPopover', {
		configurable: true,
		value: vi.fn(function () {
			shownPopovers.add(this);
		}),
	});
	Object.defineProperty(window.HTMLElement.prototype, 'hidePopover', {
		configurable: true,
		value: vi.fn(function () {
			shownPopovers.delete(this);
		}),
	});
});

afterEach(() => {
	for (const controller of controllers) {
		controller.dispose();
	}
	delete window.HTMLElement.prototype.showPopover;
	delete window.HTMLElement.prototype.hidePopover;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('automatic account panel placement', () => {
	it('preserves the ordinary closed-shadow picker and rejects synthetic account clicks', () => {
		const app = show(input());
		expect(app.host.parentElement).toBe(document.documentElement);
		expect(app.host.shadowRoot).toBeNull();
		expect(app.host.hasAttribute('popover')).toBe(false);
		expect(app.host.style.left).toBe('40px');
		expect(app.host.style.top).toBe('82px');
		const button = app.shadow.querySelector('button.account');
		button.click();
		expect(app.selected).not.toHaveBeenCalled();
		trusted(button, 'click');
		expect(app.selected).toHaveBeenCalledWith('one');
	});

	it('puts an account picker into its modal and gives it its own top-layer popover', () => {
		const dialog = modal();
		dialog.style.cssText = 'transform:translate(30px,20px);overflow:hidden';
		const app = show(input(dialog));
		expect(app.host.parentElement).toBe(dialog);
		expect(app.host.getAttribute('popover')).toBe('manual');
		expect(shownPopovers.has(app.host)).toBe(true);
		expect(app.host.style.margin).toBe('0px');
		expect(app.host.style.inset).toBe('auto');
		trusted(app.shadow.querySelectorAll('button.account')[1], 'click');
		expect(app.selected).toHaveBeenCalledWith('two');
	});

	it('keeps retry and Escape usable inside the modal picker', () => {
		const target = input(modal());
		const app = show(target, { failed: true });
		const retry = app.shadow.querySelector('button.retry');
		trusted(retry, 'click');
		expect(app.retried).toHaveBeenCalledOnce();
		trusted(retry, 'keydown', { key: 'Escape' });
		expect(app.closed).toHaveBeenCalledOnce();
		expect(app.host.isConnected).toBe(false);
		expect(document.activeElement).toBe(target);
	});

	it.each(['shadow input', 'slotted input'])('finds the modal across a %s boundary', (kind) => {
		const host = document.createElement('section');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		const dialog = modal(root);
		let target;
		if (kind === 'shadow input') {
			target = input(dialog);
		} else {
			const slot = document.createElement('slot');
			dialog.append(slot);
			target = input(host);
			if (!target.assignedSlot) {
				Object.defineProperty(target, 'assignedSlot', { value: slot });
			}
		}
		const app = show(target);
		expect(app.host.parentElement).toBe(dialog);
		expect(shownPopovers.has(app.host)).toBe(true);
	});

	it('uses the child viewport when a modal lives inside a same-origin iframe', () => {
		const iframe = frame();
		const child = iframe.contentDocument;
		Object.defineProperty(child.defaultView, 'innerWidth', { configurable: true, value: 280 });
		Object.defineProperty(child.defaultView, 'innerHeight', { configurable: true, value: 600 });
		const dialog = modal(child.body);
		const app = show(input(dialog));
		expect(app.host.ownerDocument).toBe(child);
		expect(app.host.parentElement).toBe(dialog);
		expect(app.host.style.width).toBe('264px');
		expect(app.host.style.left).toBe('8px');
		expect(app.host.style.top).toBe('82px');
	});

	it('maps iframe borders, padding and scaling into a containing modal viewport', () => {
		const dialog = modal();
		const iframe = box(frame(dialog), { left: 100, top: 120, width: 400, height: 300 });
		iframe.style.cssText = 'padding-left:3px;padding-top:4px';
		for (const [property, value] of Object.entries({ offsetWidth: 200, offsetHeight: 150, clientLeft: 2, clientTop: 2 })) {
			Object.defineProperty(iframe, property, { configurable: true, value });
		}
		const target = box(input(iframe.contentDocument.body), { left: 10, top: 20, height: 24 });
		const app = show(target);
		expect(app.host.parentElement).toBe(dialog);
		expect(app.host.ownerDocument).toBe(document);
		expect(app.host.style.left).toBe('130px');
		expect(app.host.style.top).toBe('228px');
	});

	it.each(['close', 'remove dialog', 'remove input', 'remove iframe'])('removes an orphaned picker after %s', async (action) => {
		const iframe = action === 'remove iframe' ? frame() : null;
		const dialog = modal(iframe ? iframe.contentDocument.body : document.body);
		const target = input(dialog);
		const app = show(target);
		if (action === 'close') {
			dialog.close();
		} else if (action === 'remove dialog') {
			dialog.remove();
		} else if (action === 'remove input') {
			target.remove();
		} else {
			iframe.remove();
		}
		await vi.waitFor(() => expect(app.controller.isHost(app.host)).toBe(false));
		expect(app.host.isConnected).toBe(false);
	});

	it('removes an iframe picker on its document lifecycle change and releases listeners', () => {
		const iframe = frame();
		const childView = iframe.contentDocument.defaultView;
		const removeListener = vi.spyOn(childView, 'removeEventListener');
		const app = show(input(modal(iframe.contentDocument.body)));
		childView.dispatchEvent(new childView.Event('pagehide'));
		expect(app.host.isConnected).toBe(false);
		expect(removeListener.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['resize', 'pagehide']));
	});

	it('reparents a live picker when its input moves into or out of a modal', async () => {
		const target = input();
		const app = show(target);
		const dialog = modal();
		dialog.append(target);
		await vi.waitFor(() => expect(app.host.parentElement).toBe(dialog));
		expect(shownPopovers.has(app.host)).toBe(true);
		document.body.append(target);
		await vi.waitFor(() => expect(app.host.parentElement).toBe(document.documentElement));
		expect(app.host.hasAttribute('popover')).toBe(false);
		expect(shownPopovers.has(app.host)).toBe(false);
	});

	it('releases modal listeners on dispose and can create a fresh picker after reopening', async () => {
		const dialog = modal();
		const target = input(dialog);
		const removed = vi.spyOn(dialog, 'removeEventListener');
		const app = show(target);
		app.controller.dispose();
		expect(removed).toHaveBeenCalledWith('close', expect.any(Function));
		dialog.close();
		dialog.showModal();
		const next = show(target);
		expect(next.host.parentElement).toBe(dialog);
		expect(next.host.isConnected).toBe(true);
		expect(app.host.isConnected).toBe(false);
	});

	it('notifies its owner once after passive detachment, after clearing the old panel', async () => {
		const dialog = modal();
		const detached = vi.fn(() => expect(app.controller.isHost(app.host)).toBe(false));
		const app = show(input(dialog), { onDetached: detached });
		dialog.close();
		await vi.waitFor(() => expect(detached).toHaveBeenCalledOnce());
		app.controller.position();
		app.controller.remove();
		app.controller.dispose();
		expect(detached).toHaveBeenCalledOnce();
	});

	it.each(['remove', 'dispose'])('does not report owner-requested %s as passive detachment', (action) => {
		const detached = vi.fn();
		const app = show(input(modal()), { onDetached: detached });
		app.controller[action]();
		expect(detached).not.toHaveBeenCalled();
	});
});
