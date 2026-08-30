import { describe, expect, it, vi } from 'vitest';

import { getSearchCode } from '../../src/ui/scripts/search.js';

function createOption(dataset) {
	const attributes = new Map();
	const classes = new Set();
	return {
		dataset,
		classList: {
			toggle(name, enabled) {
				if (enabled) {
					classes.add(name);
				} else {
					classes.delete(name);
				}
			},
			contains(name) {
				return classes.has(name);
			},
		},
		setAttribute(name, value) {
			attributes.set(name, value);
		},
		getAttribute(name) {
			return attributes.get(name);
		},
	};
}

function createHarness(savedValue, savedGroupSortValue, savedSortValue, savedFlatSortValue, savedGroupedItemSortValue) {
	const values = new Map();
	if (savedValue !== undefined) {
		values.set('2fa-view-mode', savedValue);
	}
	if (savedGroupSortValue !== undefined) {
		values.set('2fa-group-sort-preference', savedGroupSortValue);
	}
	if (savedSortValue !== undefined) {
		values.set('2fa-sort-preference', savedSortValue);
	}
	if (savedFlatSortValue !== undefined) {
		values.set('2fa-flat-sort-preference', savedFlatSortValue);
	}
	if (savedGroupedItemSortValue !== undefined) {
		values.set('2fa-group-item-sort-preference', savedGroupedItemSortValue);
	}

	const options = [createOption({ viewMode: 'grouped' }), createOption({ viewMode: 'flat' })];
	const groupSortOptions = [createOption({ groupSort: 'name-asc' }), createOption({ groupSort: 'name-desc' })];
	const sortOptions = ['oldest-first', 'newest-first', 'name-asc', 'name-desc', 'account-asc', 'account-desc'].map((sort) =>
		createOption({ sort }),
	);
	const groupSortOnly = [{ hidden: false }, { hidden: false }];
	const flatSortOnly = [sortOptions[2], sortOptions[3]];
	const sortModeLabel = { textContent: '' };
	const sortSelect = { value: 'oldest-first' };
	const trigger = { focus: vi.fn() };
	const dropdown = {
		open: true,
		removeAttribute(name) {
			if (name === 'open') {
				this.open = false;
			}
		},
		querySelector(selector) {
			return selector === '.sort-trigger' ? trigger : null;
		},
	};
	const storage = {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, value)),
	};
	const renderFilteredSecrets = vi.fn(async () => {});
	const document = {
		querySelectorAll: vi.fn((selector) => {
			if (selector === '.view-mode-option') {
				return options;
			}
			if (selector === '.group-sort-option') {
				return groupSortOptions;
			}
			if (selector === '.group-sort-only') {
				return groupSortOnly;
			}
			if (selector === '.sort-option') {
				return sortOptions;
			}
			if (selector === '.flat-sort-only') {
				return flatSortOnly;
			}
			return [];
		}),
		getElementById: vi.fn((id) => {
			if (id === 'sortDropdown') {
				return dropdown;
			}
			if (id === 'sortModeLabel') {
				return sortModeLabel;
			}
			if (id === 'sortSelect') {
				return sortSelect;
			}
			return null;
		}),
		addEventListener: vi.fn(),
	};

	const code = `${getSearchCode()}
    return {
      restoreViewModePreference,
      restoreGroupSortPreference,
      restoreSortPreference,
      selectViewMode,
      selectGroupSort,
      selectSort,
      calculateSortMenuPlacement,
      getCurrentViewMode: () => currentViewMode,
      getCurrentGroupSortType: () => currentGroupSortType,
      getCurrentSortType: () => currentSortType,
      getCurrentFlatSortType: () => currentFlatSortType,
      getCurrentGroupedItemSortType: () => currentGroupedItemSortType
    };
  `;
	// eslint-disable-next-line no-new-func
	const api = new Function('document', 'localStorage', 'renderFilteredSecrets', code)(document, storage, renderFilteredSecrets);

	return {
		api,
		dropdown,
		groupSortOnly,
		groupSortOptions,
		flatSortOnly,
		options,
		renderFilteredSecrets,
		sortModeLabel,
		sortOptions,
		storage,
		trigger,
	};
}

describe('view mode preference', () => {
	it('defaults invalid or missing values to automatic grouping', () => {
		for (const savedValue of [undefined, 'invalid']) {
			const { api, options } = createHarness(savedValue);
			api.restoreViewModePreference();

			expect(api.getCurrentViewMode()).toBe('grouped');
			expect(options[0].classList.contains('active')).toBe(true);
			expect(options[0].getAttribute('aria-pressed')).toBe('true');
			expect(options[1].getAttribute('aria-pressed')).toBe('false');
		}
	});

	it('restores the flat view and synchronizes the segmented control', () => {
		const { api, options } = createHarness('flat');
		api.restoreViewModePreference();

		expect(api.getCurrentViewMode()).toBe('flat');
		expect(options[1].classList.contains('active')).toBe(true);
		expect(options[1].getAttribute('aria-pressed')).toBe('true');
	});

	it('restores aggregate group order independently from item sorting', () => {
		const { api, groupSortOptions } = createHarness('grouped', 'name-desc');
		api.restoreGroupSortPreference();

		expect(api.getCurrentGroupSortType()).toBe('name-desc');
		expect(groupSortOptions[0].getAttribute('aria-pressed')).toBe('false');
		expect(groupSortOptions[1].getAttribute('aria-pressed')).toBe('true');
	});

	it('falls back to oldest-first when a saved item sort is invalid', () => {
		const { api, sortOptions } = createHarness('grouped', 'name-asc', 'removed-sort');
		api.restoreSortPreference();

		expect(api.getCurrentSortType()).toBe('oldest-first');
		expect(sortOptions[0].getAttribute('aria-pressed')).toBe('true');
		expect(sortOptions.slice(1).every((option) => option.getAttribute('aria-pressed') === 'false')).toBe(true);
	});

	it('persists a selection, keeps the menu open, and renders once', async () => {
		const { api, dropdown, renderFilteredSecrets, storage, trigger } = createHarness('grouped');
		await api.selectViewMode('flat');

		expect(api.getCurrentViewMode()).toBe('flat');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-view-mode', 'flat');
		expect(dropdown.open).toBe(true);
		expect(trigger.focus).not.toHaveBeenCalled();
		expect(renderFilteredSecrets).toHaveBeenCalledTimes(1);
	});

	it('shows group sorting only in grouped mode', async () => {
		const { api, flatSortOnly, groupSortOnly, sortModeLabel } = createHarness('grouped');
		api.restoreViewModePreference();

		expect(groupSortOnly.every((element) => element.hidden === false)).toBe(true);
		expect(flatSortOnly.every((element) => element.hidden === true)).toBe(true);
		expect(sortModeLabel.textContent).toBe('组内排序');

		await api.selectViewMode('flat');
		expect(groupSortOnly.every((element) => element.hidden === true)).toBe(true);
		expect(flatSortOnly.every((element) => element.hidden === false)).toBe(true);
		expect(sortModeLabel.textContent).toBe('列表排序');
	});

	it('migrates a legacy service-name preference without losing it in grouped mode', async () => {
		const { api, sortOptions, storage } = createHarness('grouped', 'name-asc', 'name-desc');
		api.restoreSortPreference();
		api.restoreViewModePreference();

		expect(api.getCurrentSortType()).toBe('oldest-first');
		expect(api.getCurrentFlatSortType()).toBe('name-desc');
		expect(sortOptions[0].getAttribute('aria-pressed')).toBe('true');
		expect(sortOptions[3].getAttribute('aria-pressed')).toBe('false');
		expect(storage.setItem).not.toHaveBeenCalledWith('2fa-sort-preference', 'oldest-first');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-flat-sort-preference', 'name-desc');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-group-item-sort-preference', 'oldest-first');

		await api.selectViewMode('flat');
		expect(api.getCurrentSortType()).toBe('name-desc');
		expect(sortOptions[3].getAttribute('aria-pressed')).toBe('true');
	});

	it('prefers mode-specific preferences and restores each one after a mode round trip', async () => {
		const { api, storage } = createHarness('grouped', 'name-asc', 'name-desc', 'newest-first', 'account-desc');
		api.restoreSortPreference();
		api.restoreViewModePreference();

		expect(api.getCurrentSortType()).toBe('account-desc');
		expect(api.getCurrentFlatSortType()).toBe('newest-first');
		expect(api.getCurrentGroupedItemSortType()).toBe('account-desc');
		expect(storage.setItem).not.toHaveBeenCalledWith('2fa-flat-sort-preference', expect.any(String));
		expect(storage.setItem).not.toHaveBeenCalledWith('2fa-group-item-sort-preference', expect.any(String));

		await api.selectViewMode('flat');
		expect(api.getCurrentSortType()).toBe('newest-first');

		await api.selectViewMode('grouped');
		expect(api.getCurrentSortType()).toBe('account-desc');
	});

	it('keeps view mode, group order, and item order as independent simultaneous choices', async () => {
		const { api, dropdown, groupSortOptions, options, renderFilteredSecrets, storage } = createHarness('grouped');
		api.restoreViewModePreference();
		await api.selectGroupSort('name-desc');
		api.selectSort('newest-first');
		await Promise.resolve();

		expect(api.getCurrentViewMode()).toBe('grouped');
		expect(api.getCurrentGroupSortType()).toBe('name-desc');
		expect(api.getCurrentSortType()).toBe('newest-first');
		expect(options[0].getAttribute('aria-pressed')).toBe('true');
		expect(groupSortOptions[1].getAttribute('aria-pressed')).toBe('true');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-group-sort-preference', 'name-desc');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-group-item-sort-preference', 'newest-first');
		expect(dropdown.open).toBe(true);
		expect(renderFilteredSecrets).toHaveBeenCalledTimes(2);
	});

	it('remembers flat and grouped item sorting independently', async () => {
		const { api, storage } = createHarness('grouped');
		api.restoreSortPreference();
		api.restoreViewModePreference();

		api.selectSort('newest-first');
		await Promise.resolve();
		await api.selectViewMode('flat');
		api.selectSort('name-desc');
		await Promise.resolve();

		expect(api.getCurrentGroupedItemSortType()).toBe('newest-first');
		expect(api.getCurrentFlatSortType()).toBe('name-desc');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-group-item-sort-preference', 'newest-first');
		expect(storage.setItem).toHaveBeenCalledWith('2fa-flat-sort-preference', 'name-desc');

		await api.selectViewMode('grouped');
		expect(api.getCurrentSortType()).toBe('newest-first');
		await api.selectViewMode('flat');
		expect(api.getCurrentSortType()).toBe('name-desc');
	});

	it('keeps the menu inside a short visual viewport and flips upward when that offers more room', () => {
		const { api } = createHarness('grouped');
		const belowPlacement = api.calculateSortMenuPlacement({ top: 93.33, bottom: 137.33 }, 0, 320);
		const upwardPlacement = api.calculateSortMenuPlacement({ top: 270, bottom: 314 }, 0, 320);

		expect(belowPlacement).toEqual({ opensUpward: false, maxHeight: 168 });
		expect(137.33 + 6 + belowPlacement.maxHeight).toBeLessThanOrEqual(312);
		expect(upwardPlacement).toEqual({ opensUpward: true, maxHeight: 256 });
	});
});
