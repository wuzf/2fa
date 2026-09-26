import { createServiceAggregation } from '../../shared/service-aggregation.js';
import { SERVICE_FAMILY_ALIASES, SERVICE_FAMILY_NAMES, SERVICE_FUZZY_MATCH_KEYS } from '../config/serviceLogos.js';

/** Emit the self-contained shared closure with stable browser bindings. */
export function getServiceAggregationCode() {
	return `const {
	OTHER_SERVICE_GROUP_KEY,
	UNNAMED_SERVICE_GROUP_KEY,
	normalizeServiceExactName,
	splitServiceWords,
	resolveServiceDomain,
	resolveServiceFamilyDomain,
	resolveServiceIdentity,
	getOtherServiceGroupName,
	resolveServiceGroupName,
	getServiceFamilyMetadata,
	groupSecretsByServiceFamily,
	getServiceCacheSizes
} = (${createServiceAggregation.toString()})({
	SERVICE_LOGOS,
	SERVICE_FAMILY_ALIASES: ${JSON.stringify(SERVICE_FAMILY_ALIASES)},
	SERVICE_FAMILY_NAMES: ${JSON.stringify(SERVICE_FAMILY_NAMES)},
	SERVICE_FUZZY_MATCH_KEYS: ${JSON.stringify(SERVICE_FUZZY_MATCH_KEYS)},
	getOtherServiceGroupName: () => (typeof t === 'function' ? t('otherServices') : 'Other Services'),
	// The label a card shows for an account without a name.
	getUnnamedServiceGroupName: () => (typeof t === 'function' ? t('transferUnnamed') : 'Untitled'),
	getSortingLanguage: () => (typeof getLanguage === 'function' ? getLanguage() : 'en')
});
`;
}
