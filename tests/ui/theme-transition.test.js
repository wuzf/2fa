import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUICode } from '../../src/ui/scripts/ui.js';

function createHarness({ reduced = false, hidden = false, systemDark = false, cards = [], headings = [] } = {}) {
	const classes = new Set();
	const attributes = new Map([['data-theme', 'light']]);
	const root = {
		classList: {
			add: (...names) => names.forEach((name) => classes.add(name)),
			remove: (...names) => names.forEach((name) => classes.delete(name)),
		},
		getAttribute: (name) => attributes.get(name) ?? null,
		setAttribute: (name, value) => attributes.set(name, value),
	};
	const api = createContext({
		document: {
			documentElement: root,
			hidden,
			addEventListener: vi.fn(),
			querySelectorAll: (selector) => [
				...(selector.includes('.secret-card') ? cards : []),
				...(selector.includes('.service-group-header') ? headings : []),
			],
		},
		window: {
			innerHeight: 800,
			innerWidth: 1200,
			matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reduced : systemDark }),
			addEventListener: vi.fn(),
		},
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (callback) => setTimeout(callback, 16),
		cancelAnimationFrame: clearTimeout,
	});
	runInContext(getUICode(), api);
	return { api, classes, theme: () => root.getAttribute('data-theme') };
}

describe('theme transition lifecycle', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('applies the choice immediately and keeps transition styles through the painted fade', async () => {
		const h = createHarness();
		h.api.applyTheme('dark', true);
		expect(h.theme()).toBe('dark');
		expect(h.classes.has('theme-transition')).toBe(true);
		await vi.advanceTimersByTimeAsync(240);
		expect(h.classes.has('theme-transition')).toBe(true);
		await vi.advanceTimersByTimeAsync(20);
		expect(h.classes.size).toBe(0);
	});

	it('does not let an old timeout end a newer transition', async () => {
		const h = createHarness();
		h.api.applyTheme('dark', true);
		await vi.advanceTimersByTimeAsync(160);
		h.api.applyTheme('light', true);
		await vi.advanceTimersByTimeAsync(110);
		expect(h.theme()).toBe('light');
		expect(h.classes.has('theme-transition')).toBe(true);
		await vi.advanceTimersByTimeAsync(160);
		expect(h.classes.size).toBe(0);
	});

	it('keeps the last choice when toggled several times before the first paint', async () => {
		const h = createHarness();
		h.api.applyTheme('dark', true);
		h.api.applyTheme('light', true);
		h.api.applyTheme('dark', true);
		expect(h.theme()).toBe('dark');
		await vi.runAllTimersAsync();
		expect(h.theme()).toBe('dark');
		expect(h.classes.size).toBe(0);
	});

	it('does not extend the fade when switching to an equivalent automatic theme', async () => {
		const h = createHarness({ systemDark: true });
		h.api.applyTheme('dark', true);
		await vi.advanceTimersByTimeAsync(160);
		h.api.applyTheme('auto', true);
		await vi.advanceTimersByTimeAsync(100);
		expect(h.theme()).toBe('dark');
		expect(h.classes.size).toBe(0);
	});

	it.each([{ reduced: true }, { hidden: true }])('suppresses existing transitions for %j', async (options) => {
		const h = createHarness(options);
		h.api.applyTheme('dark', true);
		expect(h.theme()).toBe('dark');
		expect(h.classes.has('theme-instant')).toBe(true);
		expect(h.classes.has('theme-transition')).toBe(false);
		await vi.advanceTimersByTimeAsync(40);
		expect(h.classes.size).toBe(0);
	});

	it('cancels an active fade when a caller requests an immediate update', async () => {
		const h = createHarness();
		h.api.applyTheme('dark', true);
		await vi.advanceTimersByTimeAsync(100);
		h.api.applyTheme('light', false);
		expect(h.theme()).toBe('light');
		expect(h.classes.has('theme-transition')).toBe(false);
		expect(h.classes.has('theme-instant')).toBe(true);
		await vi.runAllTimersAsync();
		expect(h.classes.size).toBe(0);
	});

	it.each(['cards', 'headings'])('animates only %s intersecting the viewport and clears markers after a reversal', async (kind) => {
		const bounds = [
			{ top: 20, bottom: 200, left: 20, right: 300, width: 280, height: 180 },
			{ top: -160, bottom: 20, left: 20, right: 300, width: 280, height: 180 },
			{ top: 820, bottom: 1000, left: 20, right: 300, width: 280, height: 180 },
			{ top: -200, bottom: -20, left: 20, right: 300, width: 280, height: 180 },
			{ top: 20, bottom: 200, left: 1200, right: 1480, width: 280, height: 180 },
			{ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
		];
		const cards = bounds.map((rect) => ({
			getBoundingClientRect: () => rect,
			classList: { add: vi.fn(), remove: vi.fn() },
		}));
		const h = createHarness({ [kind]: cards });
		h.api.applyTheme('dark', true);
		cards.forEach((card, index) => {
			expect(card.classList.add).toHaveBeenCalledTimes(index < 2 ? 1 : 0);
		});
		await vi.advanceTimersByTimeAsync(100);
		h.api.applyTheme('light', false);
		cards.slice(0, 2).forEach((card) => {
			expect(card.classList.remove).toHaveBeenCalledWith('theme-viewport-transition');
		});
		await vi.runAllTimersAsync();
		expect(h.classes.size).toBe(0);
	});

	it('keeps the active fade intact when layout is read for a reversal', async () => {
		const cardClasses = new Set();
		const samples = [];
		const card = {
			classList: {
				add: (name) => cardClasses.add(name),
				remove: (name) => cardClasses.delete(name),
			},
			getBoundingClientRect: () => {
				samples.push({
					theme: h.theme(),
					rootFading: h.classes.has('theme-transition'),
					cardFading: cardClasses.has('theme-viewport-transition'),
				});
				return { top: 20, bottom: 200, left: 20, right: 300, width: 280, height: 180 };
			},
		};
		const h = createHarness({ cards: [card] });
		h.api.applyTheme('dark', true);
		await vi.advanceTimersByTimeAsync(85);
		h.api.applyTheme('light', true);
		expect(samples[1]).toEqual({ theme: 'dark', rootFading: true, cardFading: true });
		expect(h.theme()).toBe('light');
		await vi.runAllTimersAsync();
		expect(h.classes.size).toBe(0);
		expect(cardClasses.size).toBe(0);
	});
});
