import { createSearchFilter } from '../../shared/search-filter.js';

/** Emit the closure; callbacks allow aggregation to initialize later in the page. */
export function getSearchFilterCode() {
	return `const { getSearchFamilyNames, filterAccountsByQuery } = (${createSearchFilter.toString()})({
	getServiceFamilyMetadata: (...args) => getServiceFamilyMetadata(...args),
	resolveServiceGroupName: (...args) => resolveServiceGroupName(...args),
	getOtherServiceGroupName: () => getOtherServiceGroupName()
});
`;
}
