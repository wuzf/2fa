import { getOtherServiceGroupName, getServiceFamilyMetadata, resolveServiceGroupName } from './service-aggregation.js';

/**
 * Self-contained search closure, with explicit dependencies for the web adapter.
 * Object methods avoid external name-preservation helpers in Wrangler builds.
 * Extension consumers import the ready-to-use functions below directly.
 */
export function createSearchFilter({ getServiceFamilyMetadata, resolveServiceGroupName, getOtherServiceGroupName }) {
	const { getSearchFamilyNames, filterAccountsByQuery } = {
		getSearchFamilyNames(allAccounts) {
			const accounts = Array.isArray(allAccounts) ? allAccounts : [];
			const { familyMetadata, identityBySecret } = getServiceFamilyMetadata(accounts);
			const namesByFamily = new Map();
			familyMetadata.forEach((metadata, key) => {
				namesByFamily.set(
					key,
					metadata.totalCount >= 2
						? resolveServiceGroupName(metadata)
						: typeof getOtherServiceGroupName === 'function'
							? getOtherServiceGroupName()
							: '其他服务',
				);
			});

			const familyNames = new WeakMap();
			accounts.forEach((account) => {
				if (!account || typeof account !== 'object') {
					return;
				}
				const identity = identityBySecret.get(account);
				familyNames.set(account, identity ? namesByFamily.get(identity.key) || '' : '');
			});
			return familyNames;
		},

		filterAccountsByQuery(allAccounts, query, familyNames = null) {
			const accounts = Array.isArray(allAccounts) ? allAccounts : [];
			const normalizedQuery = String(query || '')
				.trim()
				.toLowerCase();
			if (!normalizedQuery) {
				return accounts.slice();
			}

			const searchableFamilyNames = familyNames || getSearchFamilyNames(accounts);
			return accounts.filter((account) => {
				const serviceName = String((account && account.name) || '').toLowerCase();
				const accountName = String((account && account.account) || '').toLowerCase();
				const familyName = String(searchableFamilyNames.get(account) || '').toLowerCase();
				return serviceName.includes(normalizedQuery) || accountName.includes(normalizedQuery) || familyName.includes(normalizedQuery);
			});
		},
	};

	return { getSearchFamilyNames, filterAccountsByQuery };
}

export const { getSearchFamilyNames, filterAccountsByQuery } = /* @__PURE__ */ createSearchFilter({
	getServiceFamilyMetadata,
	resolveServiceGroupName,
	getOtherServiceGroupName,
});
