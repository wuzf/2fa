import { describe, expect, it } from 'vitest';

import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { getSearchFilterCode } from '../../src/ui/scripts/searchFilter.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { transferI18n } from '../helpers/transfer-i18n.js';

function createHarness() {
	const code = `
    const SERVICE_LOGOS = ${JSON.stringify(SERVICE_LOGOS)};
    ${getServiceAggregationCode()}
    ${getSearchFilterCode()}
    return { getSearchFamilyNames, filterAccountsByQuery };
  `;
	// eslint-disable-next-line no-new-func
	return new Function('i18n', `const { t, getLanguage } = i18n; ${code}`)(transferI18n('zh-CN'));
}

describe('shared account search', () => {
	it('matches service names and accounts case-insensitively and trims the query', () => {
		const { filterAccountsByQuery } = createHarness();
		const accounts = [
			{ name: 'NodeSeek', account: 'Alice@example.com' },
			{ name: 'EU.org', account: 'Bob@example.com' },
		];

		expect(filterAccountsByQuery(accounts, '  noDEseeK  ')).toEqual([accounts[0]]);
		expect(filterAccountsByQuery(accounts, 'BOB@')).toEqual([accounts[1]]);
		expect(filterAccountsByQuery(accounts, '.ORG')).toEqual([accounts[1]]);
	});

	it('treats the complete query as a continuous substring in each field', () => {
		const { filterAccountsByQuery } = createHarness();
		const accounts = [
			{ name: 'Alpha Beta', account: 'work@example.com' },
			{ name: 'Alpha', account: 'Beta@example.com' },
			{ name: 'Alpha Production Beta', account: 'other@example.com' },
		];

		expect(filterAccountsByQuery(accounts, 'alpha beta')).toEqual([accounts[0]]);
		expect(filterAccountsByQuery(accounts, 'alpha work')).toEqual([]);
		expect(filterAccountsByQuery(accounts, 'Alpha  Beta')).toEqual([]);
	});

	it('searches displayed family names based on the full account collection', () => {
		const { getSearchFamilyNames, filterAccountsByQuery } = createHarness();
		const accounts = [
			{ name: 'Gmail', account: 'alice' },
			{ name: 'YouTube', account: 'bob' },
			{ name: 'GitHub', account: 'carol' },
		];
		const familyNames = getSearchFamilyNames(accounts);

		expect(familyNames.get(accounts[0])).toBe('Google');
		expect(familyNames.get(accounts[1])).toBe('Google');
		expect(familyNames.get(accounts[2])).toBe('其他服务');
		expect(filterAccountsByQuery(accounts, 'GOOGLE')).toEqual(accounts.slice(0, 2));
		expect(filterAccountsByQuery(accounts, '其他服务')).toEqual([accounts[2]]);
	});

	it('uses provided full-library family labels when searching a subset', () => {
		const { getSearchFamilyNames, filterAccountsByQuery } = createHarness();
		const accounts = [{ name: 'Gmail' }, { name: 'YouTube' }];
		const familyNames = getSearchFamilyNames(accounts);

		expect(filterAccountsByQuery([accounts[0]], 'Google', familyNames)).toEqual([accounts[0]]);
		expect(filterAccountsByQuery([accounts[0]], '其他服务', familyNames)).toEqual([]);
		expect(filterAccountsByQuery([accounts[0]], 'Google')).toEqual([]);
	});

	it('does not expand a lone service to an undisplayed family name', () => {
		const { filterAccountsByQuery } = createHarness();
		const accounts = [{ name: 'Gmail', account: 'alice' }];

		expect(filterAccountsByQuery(accounts, 'Google')).toEqual([]);
		expect(filterAccountsByQuery(accounts, '其他')).toEqual(accounts);
	});

	it('returns a new array in the original order for empty queries without changing accounts', () => {
		const { filterAccountsByQuery } = createHarness();
		const accounts = Object.freeze([Object.freeze({ name: 'Zebra' }), Object.freeze({ name: 'Alpha' })]);
		const result = filterAccountsByQuery(accounts, '  ');

		expect(result).toEqual(accounts);
		expect(result).not.toBe(accounts);
		expect(result[0]).toBe(accounts[0]);
	});

	it('updates family labels after renaming an account in the same collection', () => {
		const { filterAccountsByQuery } = createHarness();
		const accounts = [{ name: 'Gmail' }, { name: 'YouTube' }];

		expect(filterAccountsByQuery(accounts, 'Google')).toEqual(accounts);
		accounts[1].name = 'GitHub';
		expect(filterAccountsByQuery(accounts, 'Google')).toEqual([]);
		expect(filterAccountsByQuery(accounts, '其他服务')).toEqual(accounts);
	});
});
