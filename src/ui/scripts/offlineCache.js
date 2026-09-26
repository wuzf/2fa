import { parseOfflineSecretsCache, parseOfflineClockCache } from '../../shared/offline-cache.js';

// The parsers have no free module dependencies. Assign explicit browser names
// instead of relying on the function names preserved by Worker minification.
export function getOfflineSecretsCode() {
	return `const parseOfflineSecretsCache = (${parseOfflineSecretsCache.toString()});
`;
}

export function getOfflineClockCode() {
	return `const parseOfflineClockCache = (${parseOfflineClockCache.toString()});
`;
}
