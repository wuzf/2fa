import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSearchCode } from '../../src/ui/scripts/search.js';

function createHarness() {
	const searchClear = { style: {} };
	const searchStats = { style: {}, textContent: '' };
	const searchInput = { value: '', focus: vi.fn() };
	const sortSelect = { value: 'oldest-first' };
	const document = {
		addEventListener: vi.fn(),
		getElementById(id) {
			if (id === 'searchClear') {
				return searchClear;
			}
			if (id === 'searchStats') {
				return searchStats;
			}
			if (id === 'searchInput') {
				return searchInput;
			}
			if (id === 'sortSelect') {
				return sortSelect;
			}
			return null;
		},
		querySelectorAll: vi.fn(() => []),
	};
	const localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };

	const code = `
    let currentSearchQuery = '';
    let filteredSecrets = [];
    let secrets = [
      { id: 'google', name: 'Google', account: 'one@example.com' },
      { id: 'github', name: 'GitHub', account: 'two@example.com' }
    ];
    let renderCount = 0;
    async function renderFilteredSecrets() { renderCount++; }
    function getServiceFamilyMetadata() {
      return { familyMetadata: new Map(), identityBySecret: new WeakMap() };
    }
    function resolveServiceGroupName() { return ''; }
    ${getSearchCode()}
    return {
      scheduleSecretFilter,
      getQuery: () => currentSearchQuery,
      getFilteredIds: () => filteredSecrets.map(item => item.id),
      getRenderCount: () => renderCount
    };
  `;

	// eslint-disable-next-line no-new-func
	return new Function('document', 'localStorage', code)(document, localStorage);
}

describe('search filtering debounce', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders only the latest non-empty query after the debounce window', async () => {
		vi.useFakeTimers();
		const api = createHarness();

		api.scheduleSecretFilter('g');
		api.scheduleSecretFilter('go');
		api.scheduleSecretFilter('goog');
		await vi.advanceTimersByTimeAsync(129);
		expect(api.getRenderCount()).toBe(0);

		await vi.advanceTimersByTimeAsync(1);
		expect(api.getRenderCount()).toBe(1);
		expect(api.getQuery()).toBe('goog');
		expect(api.getFilteredIds()).toEqual(['google']);
	});

	it('applies an empty query immediately', () => {
		vi.useFakeTimers();
		const api = createHarness();

		api.scheduleSecretFilter('goog');
		api.scheduleSecretFilter('');

		expect(api.getRenderCount()).toBe(1);
		expect(api.getQuery()).toBe('');
		expect(api.getFilteredIds()).toEqual(['google', 'github']);
	});
});
