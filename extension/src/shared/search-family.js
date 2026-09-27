import { getServiceFamilyMetadata } from '../../../src/shared/service-aggregation.js';

/** Identify system groups from the full vault, never from a translated label. */
export function getOtherServiceAccounts(accounts) {
	const { familyMetadata, identityBySecret } = getServiceFamilyMetadata(accounts);
	return new WeakSet(
		accounts.filter((account) => {
			const identity = identityBySecret.get(account);
			return identity && familyMetadata.get(identity.key)?.totalCount < 2;
		}),
	);
}
