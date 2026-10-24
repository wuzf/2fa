import { describe, it, expect } from 'vitest';
import { createAccountViewState } from '../../src/ui/runtime/accountViewState.js';
import { filterAccountsByQuery } from '../../src/shared/search-filter.js';
import { groupSecretsByServiceFamily } from '../../src/shared/service-aggregation.js';

const records = [
	{ id: 'g1', name: 'Google', account: 'first@example.test', secret: 'SEED' },
	{ id: 'g2', name: 'Google', account: 'second@example.test' },
	{ id: 'x', name: 'Other', account: 'first@example.test' },
];
const create = () => createAccountViewState({ filterAccountsByQuery, groupSecretsByServiceFamily });

describe('pure account view selection', () => {
	it('intersects service filters with the existing shared query algorithm and uses full-library group names', () => {
		const view = create();
		const google = view.derive(records).services.find((group) => group.ids.includes('g1'));
		view.setServiceFilter(google.groupId);
		view.setQuery(' FIRST@EXAMPLE ');
		const selection = view.derive(records);
		expect(selection.resultIds).toEqual(['g1']);
		expect(selection.groups[0]).toMatchObject({ groupId: google.groupId, label: 'Google', matchedCount: 1, totalCount: 2 });
		expect(selection.queryFound).toBe(2);
		expect(selection.found).toBe(1);
		expect(selection.total).toBe(3);
		expect(JSON.stringify(selection)).not.toContain('SEED');
	});
	it('clears a deleted service selection and retains independent flat/grouped sorts', () => {
		const view = create();
		const google = view.derive(records).services.find((group) => group.ids.includes('g1'));
		view.setServiceFilter(google.groupId);
		expect(view.derive([records[2]]).serviceFilter).toBeNull();
		view.setSort({ flatSort: 'newest-first', groupedItemSort: 'account-asc', groupSort: 'name-desc' });
		view.setMode('flat');
		expect(view.derive(records).resultIds).toEqual(['x', 'g2', 'g1']);
		view.setMode('grouped');
		expect(view.derive(records).resultIds).toEqual(['g1', 'x', 'g2']);
		view.setMode('flat');
		expect(view.derive(records).resultIds).toEqual(['x', 'g2', 'g1']);
	});
	it('rejects unsupported commands atomically and stops invalidation callbacks after unsubscribe', () => {
		const view = create();
		const before = view.getState();
		expect(view.setSort({ flatSort: 'name-desc', groupedItemSort: 'name-desc' })).toMatchObject({ status: 'rejected' });
		expect(view.getState()).toEqual(before);
		expect(view.setQuery({})).toMatchObject({ status: 'rejected' });
		const changes = [];
		const unsubscribe = view.subscribe((change) => changes.push(change));
		view.invalidate('language');
		expect(changes).toEqual([{ reason: 'language', revision: 1 }]);
		unsubscribe();
		view.setMode('flat');
		expect(changes).toHaveLength(1);
	});
});
