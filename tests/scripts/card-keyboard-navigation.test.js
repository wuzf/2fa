import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { getCoreCode } from '../../src/ui/scripts/core.js';

// A small DOM fixture with explicit screen rectangles; navigation runs through the real keydown listener.
class Element {
	constructor(document, classes = '', attributes = {}) {
		this.document = document;
		this.children = [];
		this.parentElement = null;
		this.attributes = new Map(Object.entries(attributes));
		this.classes = new Set(classes.split(' ').filter(Boolean));
		this.classList = {
			contains: (name) => this.classes.has(name),
			add: (name) => this.classes.add(name),
			remove: (name) => this.classes.delete(name),
			toggle: (name) => (this.classes.has(name) ? this.classes.delete(name) : this.classes.add(name)),
		};
		this.style = {};
		this.disabled = false;
		this.tagName = 'BUTTON';
		this.rect = { left: 0, top: 0, right: 300, bottom: 180, width: 300, height: 180 };
	}

	get id() {
		return this.getAttribute('id');
	}

	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}

	matches(selector) {
		return selector.split(',').some((part) => {
			const value = part.trim();
			if (value === '[contenteditable]:not([contenteditable="false"])') {
				return this.attributes.has('contenteditable') && this.getAttribute('contenteditable') !== 'false';
			}
			if (value.startsWith('.')) {
				return value
					.slice(1)
					.split('.')
					.every((name) => this.classes.has(name));
			}
			const attribute = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
			if (attribute) {
				return this.attributes.has(attribute[1]) && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
			}
			return this.tagName.toLowerCase() === value;
		});
	}

	closest(selector) {
		return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
	}

	append(child) {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	querySelectorAll(selector) {
		return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}

	getBoundingClientRect() {
		for (let element = this; element; element = element.parentElement) {
			if (
				element.style.display === 'none' ||
				element.attributes.has('hidden') ||
				(element.classes.has('card-menu-dropdown') && !element.classes.has('show'))
			) {
				return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
			}
		}
		return this.rect;
	}

	focus() {
		this.document.activeElement = this;
	}
}

function createHarness() {
	const keydownListeners = [];
	const document = {
		activeElement: null,
		addEventListener: (name, listener) => {
			if (name === 'keydown') {
				keydownListeners.push(listener);
			}
		},
		querySelectorAll: (selector) => document.body.querySelectorAll(selector),
		querySelector: (selector) => document.body.querySelector(selector),
		getElementById: (id) => document.body.querySelector(`[id="${id}"]`),
	};
	document.body = new Element(document);
	document.body.tagName = 'BODY';
	const api = {
		document,
		window: {
			addEventListener: vi.fn(),
			getComputedStyle: (element) => {
				let visibility = 'visible';
				for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
					if (ancestor.style.visibility) {
						visibility = ancestor.style.visibility;
						break;
					}
				}
				return { display: element.style.display || 'block', visibility };
			},
		},
		setInterval: vi.fn(),
		hideSecretModal: vi.fn(),
		hideQRModal: vi.fn(),
		hideQRScanner: vi.fn(),
		hideImportModal: vi.fn(),
	};
	runInNewContext(getCoreCode(), api);
	api.copyOTP = vi.fn();
	api.copyNextOTP = vi.fn();
	api.deleteSecret = vi.fn();

	function addCard(id, left, top, { hotp = false, parent = document.body } = {}) {
		const card = parent.append(new Element(document, 'secret-card'));
		card.rect = { left, top, right: left + 300, bottom: top + 180, width: 300, height: 180 };
		const current = card.append(new Element(document, 'otp-code'));
		const next = hotp ? null : card.append(new Element(document, 'otp-next-container'));
		const menuContainer = card.append(new Element(document, 'card-menu'));
		const trigger = menuContainer.append(
			new Element(document, 'card-menu-trigger', {
				'aria-controls': `menu-${id}`,
				'aria-expanded': 'false',
			}),
		);
		const menu = menuContainer.append(new Element(document, 'card-menu-dropdown', { id: `menu-${id}` }));
		const actions = Array.from({ length: 5 }, () => menu.append(new Element(document, 'menu-item')));
		return { id, card, current, next, trigger, menu, actions };
	}

	function press(key, properties = {}) {
		const event = { key, target: document.activeElement, preventDefault: vi.fn(), ...properties };
		keydownListeners.forEach((listener) => listener(event));
		return event;
	}

	return { api, document, addCard, press };
}

describe('card arrow-key navigation', () => {
	it('follows screen rows across uneven grids and service groups independently of DOM order', () => {
		const { document, addCard, press } = createHarness();
		const groupA = document.body.append(new Element(document, 'service-group-grid'));
		const groupB = document.body.append(new Element(document, 'service-group-grid'));
		const c = addCard('c', 0, 220, { parent: groupA });
		const b = addCard('b', 330, 0, { parent: groupA });
		const a = addCard('a', 0, 0, { parent: groupA });
		const e = addCard('e', 330, 500, { parent: groupB });
		const d = addCard('d', 0, 500, { parent: groupB });
		a.current.focus();

		for (const [key, expected] of [
			['ArrowRight', b],
			['ArrowDown', c],
			['ArrowDown', d],
			['ArrowRight', e],
			['ArrowUp', c],
			['ArrowUp', a],
		]) {
			expect(press(key).preventDefault).toHaveBeenCalledOnce();
			expect(document.activeElement).toBe(expected.current);
		}
	});

	it('uses the current responsive layout instead of remembering a column count', () => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const b = addCard('b', 330, 0);
		a.current.focus();
		press('ArrowRight');
		expect(document.activeElement).toBe(b.current);
		b.card.rect = { left: 0, top: 220, right: 300, bottom: 400, width: 300, height: 180 };
		press('ArrowUp');
		expect(document.activeElement).toBe(a.current);
		press('ArrowRight');
		expect(document.activeElement).toBe(a.current);
		press('ArrowDown');
		expect(document.activeElement).toBe(b.current);
	});

	it.each(['current', 'next', 'trigger'])('preserves the %s control when moving between cards', (control) => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const b = addCard('b', 330, 0);
		a[control].focus();
		press('ArrowRight');
		expect(document.activeElement).toBe(b[control]);
		press('ArrowLeft');
		expect(document.activeElement).toBe(a[control]);
	});

	it('falls back to the current code when the adjacent HOTP card has no next code', () => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const b = addCard('b', 330, 0, { hotp: true });
		a.next.focus();
		press('ArrowRight');
		expect(document.activeElement).toBe(b.current);
	});

	it.each(['hidden', 'display', 'visibility', 'inert', 'aria-hidden'])('skips cards hidden by %s, including hidden groups', (kind) => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const group = document.body.append(new Element(document, 'service-group'));
		addCard('hidden', 330, 0, { parent: group });
		const b = addCard('b', 660, 0);
		if (kind === 'display') {
			group.style.display = 'none';
		} else if (kind === 'visibility') {
			group.style.visibility = 'hidden';
		} else {
			group.setAttribute(kind, kind === 'aria-hidden' ? 'true' : '');
		}
		a.current.focus();
		press('ArrowRight');
		expect(document.activeElement).toBe(b.current);
	});

	it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('keeps focus and prevents scrolling at the %s boundary', (key) => {
		const { api, document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		a.current.focus();
		expect(press(key).preventDefault).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(a.current);
		expect(api.copyOTP).not.toHaveBeenCalled();
		expect(api.copyNextOTP).not.toHaveBeenCalled();
		expect(api.deleteSecret).not.toHaveBeenCalled();
	});
});

describe('card menu keyboard navigation', () => {
	it('opens at the first available action and cycles in both directions, skipping unavailable actions', () => {
		const { api, document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		a.actions[0].disabled = true;
		a.actions[2].setAttribute('aria-disabled', 'true');
		a.actions[3].style.display = 'none';
		api.toggleCardMenu(a.id);
		expect(document.activeElement).toBe(a.actions[1]);
		expect(a.trigger.getAttribute('aria-expanded')).toBe('true');
		for (const [key, index] of [
			['ArrowDown', 4],
			['ArrowDown', 1],
			['ArrowUp', 4],
			['ArrowUp', 1],
		]) {
			expect(press(key).preventDefault).toHaveBeenCalledOnce();
			expect(document.activeElement).toBe(a.actions[index]);
			expect(a.menu.classList.contains('show')).toBe(true);
		}
	});

	it.each(['ArrowLeft', 'ArrowRight'])('closes the menu and moves %s to the adjacent menu trigger', (key) => {
		const { api, document, addCard, press } = createHarness();
		const a = addCard('a', 330, 0);
		const b = addCard('b', key === 'ArrowLeft' ? 0 : 660, 0);
		api.toggleCardMenu(a.id);
		a.actions[4].focus();
		press(key);
		expect(a.menu.classList.contains('show')).toBe(false);
		expect(a.trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(b.trigger);
		expect(b.trigger.getAttribute('aria-expanded')).toBe('false');
		expect(api.deleteSecret).not.toHaveBeenCalled();
	});

	it('returns to its own trigger at a horizontal boundary and still supports Escape', () => {
		const { api, document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		api.toggleCardMenu(a.id);
		expect(press('ArrowLeft').preventDefault).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(a.trigger);
		expect(a.menu.classList.contains('show')).toBe(false);
		api.toggleCardMenu(a.id);
		press('Escape');
		expect(document.activeElement).toBe(a.trigger);
		expect(a.menu.classList.contains('show')).toBe(false);
		expect(api.hideSecretModal).not.toHaveBeenCalled();
	});

	it('closes a menu left open by Tab when moving from another card control', () => {
		const { api, document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const b = addCard('b', 330, 0);
		api.toggleCardMenu(a.id);
		a.current.focus();
		press('ArrowRight');
		expect(a.menu.classList.contains('show')).toBe(false);
		expect(document.activeElement).toBe(b.current);
	});
});

describe('card keyboard event scope', () => {
	it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing', 'defaultPrevented'])('ignores arrows with %s', (modifier) => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		addCard('b', 330, 0);
		a.current.focus();
		expect(press('ArrowRight', { [modifier]: true }).preventDefault).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(a.current);
	});

	it.each(['input', 'textarea', 'select', 'contenteditable', 'textbox'])(
		'does not capture arrows from %s even inside a card control',
		(kind) => {
			const { document, addCard, press } = createHarness();
			const a = addCard('a', 0, 0);
			addCard('b', 330, 0);
			const editor = a.current.append(new Element(document));
			if (kind === 'contenteditable') {
				editor.setAttribute('contenteditable', 'true');
			} else if (kind === 'textbox') {
				editor.setAttribute('role', 'textbox');
			} else {
				editor.tagName = kind.toUpperCase();
			}
			editor.focus();
			expect(press('ArrowRight').preventDefault).not.toHaveBeenCalled();
			expect(document.activeElement).toBe(editor);
		},
	);

	it('does not capture arrows from the search box, dialog controls or card text', () => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		const search = document.body.append(new Element(document, '', { id: 'searchInput' }));
		search.tagName = 'INPUT';
		const dialog = document.body.append(new Element(document, 'modal'));
		const dialogButton = dialog.append(new Element(document));
		const label = a.card.append(new Element(document, 'secret-name'));
		for (const target of [search, dialogButton, label]) {
			target.focus();
			expect(press('ArrowDown').preventDefault).not.toHaveBeenCalled();
			expect(document.activeElement).toBe(target);
		}
	});

	it.each(['Tab', 'Enter', ' '])('preserves native %s behavior', (key) => {
		const { document, addCard, press } = createHarness();
		const a = addCard('a', 0, 0);
		a.current.focus();
		expect(press(key).preventDefault).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(a.current);
	});
});
