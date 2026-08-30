/**
 * Service identity and automatic aggregation module.
 */

import { SERVICE_FAMILY_ALIASES, SERVICE_FAMILY_NAMES, SERVICE_FUZZY_MATCH_KEYS } from '../config/serviceLogos.js';

/**
 * Get client-side service aggregation code.
 * @returns {string} JavaScript code
 */
export function getServiceAggregationCode() {
	const familyAliasesJSON = JSON.stringify(SERVICE_FAMILY_ALIASES, null, 2);
	const familyNamesJSON = JSON.stringify(SERVICE_FAMILY_NAMES, null, 2);
	const fuzzyMatchKeysJSON = JSON.stringify(SERVICE_FUZZY_MATCH_KEYS, null, 2);

	return `    // ========== Service identity and automatic aggregation ==========
    const SERVICE_FAMILY_ALIASES = ${familyAliasesJSON};
    const SERVICE_FAMILY_NAMES = ${familyNamesJSON};
    const SERVICE_FUZZY_MATCH_KEYS = ${fuzzyMatchKeysJSON};
    const SERVICE_DOMAINS = Array.from(new Set(Object.values(SERVICE_LOGOS).map(domain => String(domain).toLowerCase())));
    const SERVICE_DOMAIN_SET = new Set(SERVICE_DOMAINS);
    const OTHER_SERVICE_GROUP_KEY = '__other-services__';
    const MAX_SERVICE_IDENTITY_CACHE_SIZE = 4096;
    const MAX_SERVICE_FAMILY_DOMAIN_CACHE_SIZE = 4096;

    function normalizeServiceExactName(value) {
      return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .replace(/\\s+/g, ' ');
    }

    function splitServiceWords(value) {
      return String(value || '')
        .normalize('NFKC')
        .replace(/[+]/g, ' plus ')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .trim()
        .split(/[^\\p{L}\\p{N}]+/u)
        .filter(Boolean);
    }

    function getFuzzyServicePrefixWordCount(serviceWords, keyWords) {
      const compactKey = keyWords.join('');
      if (!compactKey || serviceWords.length === 0) return 0;

      let compactPrefix = '';
      for (let i = 0; i < serviceWords.length && compactPrefix.length <= compactKey.length; i++) {
        compactPrefix += serviceWords[i];
        if (compactPrefix === compactKey) return i + 1;
      }

      return 0;
    }

    function isFuzzyServicePrefixMatch(serviceWords, keyWords) {
      return getFuzzyServicePrefixWordCount(serviceWords, keyWords) > 0;
    }

    function buildServiceLookupIndexes() {
      const normalizedNames = new Map();
      const ambiguousNormalizedNames = new Set();

      Object.entries(SERVICE_LOGOS).forEach(([key, rawDomain]) => {
        const normalizedKey = splitServiceWords(key).join('');
        const domain = String(rawDomain).toLowerCase();
        if (!normalizedKey || ambiguousNormalizedNames.has(normalizedKey)) return;

        const existingDomain = normalizedNames.get(normalizedKey);
        if (existingDomain && existingDomain !== domain) {
          normalizedNames.delete(normalizedKey);
          ambiguousNormalizedNames.add(normalizedKey);
          return;
        }

        normalizedNames.set(normalizedKey, domain);
      });

      const fuzzyMatchers = SERVICE_FUZZY_MATCH_KEYS
        .filter(key => Object.prototype.hasOwnProperty.call(SERVICE_LOGOS, key))
        .map(key => {
          const keyWords = splitServiceWords(key);
          return {
            keyWords,
            compactKey: keyWords.join(''),
            domain: String(SERVICE_LOGOS[key]).toLowerCase()
          };
        });

      function findIndexedParentDomain(rawDomain) {
        const normalizedDomain = String(rawDomain || '').toLowerCase().replace(/^\\.+|\\.+$/g, '');
        if (!normalizedDomain) return '';

        const labels = normalizedDomain.split('.');
        for (let index = 0; index <= labels.length - 2; index++) {
          const candidate = labels.slice(index).join('.');
          if (Object.prototype.hasOwnProperty.call(SERVICE_FAMILY_ALIASES, candidate)) return candidate;
        }

        for (let index = labels.length - 2; index >= 0; index--) {
          const candidate = labels.slice(index).join('.');
          if (SERVICE_DOMAIN_SET.has(candidate)) return candidate;
        }

        return normalizedDomain;
      }

      function resolveIndexedFamilyDomain(rawDomain) {
        let current = String(rawDomain || '').toLowerCase().replace(/^\\.+|\\.+$/g, '');
        const visited = new Set();

        for (let i = 0; i < 8 && current && !visited.has(current); i++) {
          visited.add(current);
          current = findIndexedParentDomain(current);
          if (!Object.prototype.hasOwnProperty.call(SERVICE_FAMILY_ALIASES, current)) break;
          current = String(SERVICE_FAMILY_ALIASES[current]).toLowerCase();
        }

        return current;
      }

      const familyDomains = new Map();
      const indexedDomains = new Set([
        ...SERVICE_DOMAINS,
        ...Object.keys(SERVICE_FAMILY_ALIASES),
        ...Object.values(SERVICE_FAMILY_ALIASES)
      ]);
      indexedDomains.forEach(domain => {
        const normalizedDomain = String(domain).toLowerCase().replace(/^\\.+|\\.+$/g, '');
        familyDomains.set(normalizedDomain, resolveIndexedFamilyDomain(normalizedDomain));
      });

      return { normalizedNames, fuzzyMatchers, familyDomains };
    }

    const SERVICE_LOOKUP_INDEXES = buildServiceLookupIndexes();
    const SERVICE_IDENTITY_CACHE = new Map();
    const SERVICE_FAMILY_DOMAIN_CACHE = new Map(SERVICE_LOOKUP_INDEXES.familyDomains);
    const SERVICE_GROUP_METADATA_CACHE = new WeakMap();

    function parseServiceAddress(serviceName) {
      const candidate = String(serviceName || '').normalize('NFKC').trim();
      if (!candidate) return { hostname: null, rejected: false };

      const hasScheme = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(candidate);
      const isProtocolRelative = candidate.startsWith('//');
      let parsed;

      try {
        parsed = new URL(hasScheme ? candidate : isProtocolRelative ? 'https:' + candidate : 'https://' + candidate);
      } catch (_error) {
        // Malformed account addresses must not regain a brand through fallback.
        return { hostname: null, rejected: candidate.includes('@') };
      }

      if (parsed.username || parsed.password) return { hostname: null, rejected: true };

      const hostname = String(parsed.hostname || '').toLowerCase().replace(/\\.$/, '');
      const validHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;
      return { hostname: validHostname.test(hostname) ? hostname : null, rejected: false };
    }

    function resolveKnownHostname(hostname) {
      const parentDomain = findConfiguredParentDomain(hostname);
      const isKnown =
        SERVICE_DOMAIN_SET.has(hostname) ||
        parentDomain !== hostname ||
        SERVICE_LOOKUP_INDEXES.familyDomains.has(hostname);
      return isKnown ? hostname : null;
    }

    function isSafeDottedServiceLabel(value, serviceWords, matchedWordCount) {
      const candidate = String(value || '').normalize('NFKC').trim();
      const labels = candidate.split('.');
      if (
        labels.length !== 2 ||
        candidate.includes('/') ||
        candidate.includes('@') ||
        labels.some(label => !/^[a-z0-9-]+$/i.test(label))
      ) {
        return false;
      }

      const suffixWords = serviceWords.slice(matchedWordCount);
      const connectorWords = new Set(['com', 'net', 'org']);
      const allowedSuffixWords = new Set([
        'account', 'backup', 'business', 'console', 'enterprise',
        'platform', 'premium', 'team'
      ]);
      return (
        suffixWords.some(word => allowedSuffixWords.has(word)) &&
        suffixWords.every(word => connectorWords.has(word) || allowedSuffixWords.has(word))
      );
    }

    function resolveServiceDomain(serviceName) {
      const normalizedName = normalizeServiceExactName(serviceName);
      if (!normalizedName) return null;

      // Reject URL userinfo (including bare emails) before name normalization or
      // fuzzy matching. An @ in the URL path/query does not contain userinfo.
      const { hostname, rejected } = parseServiceAddress(serviceName);
      if (rejected) return null;

      if (Object.prototype.hasOwnProperty.call(SERVICE_LOGOS, normalizedName)) {
        return String(SERVICE_LOGOS[normalizedName]).toLowerCase();
      }

      const serviceWords = splitServiceWords(serviceName);
      const normalizedWordName = serviceWords.join('');
      const normalizedDomain = SERVICE_LOOKUP_INDEXES.normalizedNames.get(normalizedWordName);
      if (normalizedDomain) return normalizedDomain;

      const knownHostname = hostname && resolveKnownHostname(hostname);
      if (knownHostname) return knownHostname;

      let bestMatch = null;
      let ambiguous = false;

      SERVICE_LOOKUP_INDEXES.fuzzyMatchers.forEach(matcher => {
        const matchedWordCount = getFuzzyServicePrefixWordCount(serviceWords, matcher.keyWords);
        if (!matchedWordCount) return;

        const { compactKey, domain } = matcher;
        const score = compactKey.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { domain, score, matchedWordCount };
          ambiguous = false;
        } else if (score === bestMatch.score && domain !== bestMatch.domain) {
          ambiguous = true;
        }
      });

      if (!bestMatch || ambiguous) return null;
      if (hostname && !isSafeDottedServiceLabel(serviceName, serviceWords, bestMatch.matchedWordCount)) return null;
      return bestMatch.domain;
    }

    function findConfiguredParentDomain(domain) {
      const normalizedDomain = String(domain || '').toLowerCase().replace(/^\\.+|\\.+$/g, '');
      if (!normalizedDomain) return '';

      const labels = normalizedDomain.split('.');
      for (let index = 0; index <= labels.length - 2; index++) {
        const candidate = labels.slice(index).join('.');
        if (Object.prototype.hasOwnProperty.call(SERVICE_FAMILY_ALIASES, candidate)) return candidate;
      }

      for (let index = labels.length - 2; index >= 0; index--) {
        const candidate = labels.slice(index).join('.');
        if (SERVICE_DOMAIN_SET.has(candidate)) return candidate;
      }

      return normalizedDomain;
    }

    function resolveServiceFamilyDomain(domain) {
      const originalDomain = String(domain || '').toLowerCase().replace(/^\\.+|\\.+$/g, '');
      if (SERVICE_FAMILY_DOMAIN_CACHE.has(originalDomain)) {
        return SERVICE_FAMILY_DOMAIN_CACHE.get(originalDomain);
      }

      const parentDomain = findConfiguredParentDomain(originalDomain);
      const familyDomain =
        SERVICE_LOOKUP_INDEXES.familyDomains.get(parentDomain) ||
        SERVICE_LOOKUP_INDEXES.familyDomains.get(originalDomain) ||
        parentDomain;

      if (SERVICE_FAMILY_DOMAIN_CACHE.size < MAX_SERVICE_FAMILY_DOMAIN_CACHE_SIZE) {
        SERVICE_FAMILY_DOMAIN_CACHE.set(originalDomain, familyDomain);
      }
      return familyDomain;
    }

    function resolveServiceIdentity(serviceName) {
      const originalName = String(serviceName || '').trim() || '未知服务';
      if (SERVICE_IDENTITY_CACHE.has(originalName)) {
        return SERVICE_IDENTITY_CACHE.get(originalName);
      }

      const normalizedName = splitServiceWords(originalName).join(' ') || normalizeServiceExactName(originalName) || '未知服务';
      const serviceDomain = resolveServiceDomain(originalName);

      let identity;

      if (!serviceDomain) {
        identity = {
          key: 'name:' + normalizedName,
          domain: null,
          originalName,
          normalizedName
        };
      } else {
        const familyDomain = resolveServiceFamilyDomain(serviceDomain);
        identity = {
          key: 'domain:' + familyDomain,
          domain: familyDomain,
          originalName,
          normalizedName
        };
      }

      if (SERVICE_IDENTITY_CACHE.size >= MAX_SERVICE_IDENTITY_CACHE_SIZE) {
        SERVICE_IDENTITY_CACHE.delete(SERVICE_IDENTITY_CACHE.keys().next().value);
      }
      SERVICE_IDENTITY_CACHE.set(originalName, identity);
      return identity;
    }

    function humanizeFamilyDomain(domain) {
      const brand = String(domain || '').split('.')[0].replace(/[-_]+/g, ' ').trim();
      if (!brand) return '其他服务';
      return brand.charAt(0).toLocaleUpperCase() + brand.slice(1);
    }

    function resolveServiceGroupName(metadata) {
      if (metadata.normalizedNames.size === 1) {
        return metadata.originalNames[0];
      }

      if (metadata.domain && SERVICE_FAMILY_NAMES[metadata.domain]) {
        return SERVICE_FAMILY_NAMES[metadata.domain];
      }

      if (metadata.domain) {
        return humanizeFamilyDomain(metadata.domain);
      }

      return metadata.originalNames[0] || '其他服务';
    }

    function isServiceGroupMetadataCacheValid(cached, allSecrets) {
      if (!cached || cached.names.length !== allSecrets.length) return false;

      for (let index = 0; index < allSecrets.length; index++) {
        const secret = allSecrets[index];
        const currentName = secret && secret.name;
        if (cached.items[index] !== secret || cached.names[index] !== currentName) return false;
      }

      return true;
    }

    function getServiceFamilyMetadata(allSecrets) {
      const sourceSecrets = Array.isArray(allSecrets) ? allSecrets : [];
      const cached = SERVICE_GROUP_METADATA_CACHE.get(sourceSecrets);
      if (isServiceGroupMetadataCacheValid(cached, sourceSecrets)) return cached;

      const familyMetadata = new Map();
      const identityBySecret = new WeakMap();
      const names = new Array(sourceSecrets.length);

      sourceSecrets.forEach((secret, index) => {
        names[index] = secret && secret.name;
        const identity = resolveServiceIdentity(secret && secret.name);
        if (secret && typeof secret === 'object') {
          identityBySecret.set(secret, identity);
        }

        let metadata = familyMetadata.get(identity.key);
        if (!metadata) {
          metadata = {
            key: identity.key,
            domain: identity.domain,
            totalCount: 0,
            normalizedNames: new Set(),
            originalNames: [],
            originalNameSet: new Set()
          };
          familyMetadata.set(identity.key, metadata);
        }

        metadata.totalCount++;
        metadata.normalizedNames.add(identity.normalizedName);
        if (!metadata.originalNameSet.has(identity.originalName)) {
          metadata.originalNameSet.add(identity.originalName);
          metadata.originalNames.push(identity.originalName);
        }
      });

      const metadata = { familyMetadata, identityBySecret, names, items: sourceSecrets.slice() };
      SERVICE_GROUP_METADATA_CACHE.set(sourceSecrets, metadata);
      return metadata;
    }

    function groupSecretsByServiceFamily(visibleSecrets, allSecrets, groupSortType = 'name-asc') {
      const { familyMetadata, identityBySecret } = getServiceFamilyMetadata(allSecrets);

      const groupedFamilies = new Map();
      const otherGroup = {
        key: OTHER_SERVICE_GROUP_KEY,
        name: '其他服务',
        items: [],
        matchedCount: 0,
        totalCount: 0,
        isOther: true
      };

      familyMetadata.forEach(metadata => {
        if (metadata.totalCount < 2) {
          otherGroup.totalCount += metadata.totalCount;
        }
      });

      (visibleSecrets || []).forEach(secret => {
        const cachedIdentity = secret && typeof secret === 'object' ? identityBySecret.get(secret) : null;
        const identity = cachedIdentity || resolveServiceIdentity(secret && secret.name);
        const metadata = familyMetadata.get(identity.key);

        if (!metadata || metadata.totalCount < 2) {
          otherGroup.items.push(secret);
          otherGroup.matchedCount++;
          return;
        }

        let group = groupedFamilies.get(identity.key);
        if (!group) {
          group = {
            key: identity.key,
            name: resolveServiceGroupName(metadata),
            items: [],
            matchedCount: 0,
            totalCount: metadata.totalCount,
            isOther: false
          };
          groupedFamilies.set(identity.key, group);
        }

        group.items.push(secret);
        group.matchedCount++;
      });

      const groupNameDirection = groupSortType === 'name-desc' ? -1 : 1;
      const groups = Array.from(groupedFamilies.values()).sort((a, b) =>
        groupNameDirection * a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
      );

      if (otherGroup.items.length > 0) {
        groups.push(otherGroup);
      }

      return groups;
    }
`;
}
