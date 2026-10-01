import { localizedError } from './localized-error.js';
import {
	normalizeInstanceOrigin,
	normalizeAutofillTargetOrigin,
	normalizeAutofillPath,
	normalizeAutofillScope,
	AUTOFILL_SITE_SCOPE,
	autofillCoverage,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	permissionPatternCoversOrigin,
} from './origin.js';
import { getSettings } from './storage.js';

const STORAGE_KEY = 'autofillSites';
const MAX_SITES = 128;

// Only the background worker writes this metadata; no account or secret is stored here.
let writeQueue = Promise.resolve();

function serializeWrite(operation) {
	const next = writeQueue.then(operation);
	writeQueue = next.catch(() => {});
	return next;
}

function policyError(code, messageKey) {
	return localizedError(messageKey, code);
}

function normalizeOrigin(value, normalize = normalizeInstanceOrigin) {
	try {
		return normalize(value);
	} catch {
		throw policyError('INVALID_REQUEST', 'error_AUTOFILL_ORIGIN_INVALID');
	}
}

function normalizeScope(instanceOrigin, targetOrigin, targetPath) {
	const scope = {
		instanceOrigin: normalizeOrigin(instanceOrigin),
		targetOrigin: normalizeOrigin(targetOrigin, normalizeAutofillTargetOrigin),
		targetPath: normalizeOrigin(targetPath, normalizeAutofillScope),
	};
	if (scope.instanceOrigin === scope.targetOrigin) {
		throw policyError('INVALID_REQUEST', 'error_AUTOFILL_SELF');
	}
	return scope;
}

// A site-wide grant also keeps the page where it was made, so the settings page
// can narrow it back to that page. A page grant has exactly three fields.
function normalizeSite(instanceOrigin, targetOrigin, targetPath, pagePath) {
	const site = normalizeScope(instanceOrigin, targetOrigin, targetPath);
	if (site.targetPath === AUTOFILL_SITE_SCOPE) {
		site.pagePath = normalizeOrigin(pagePath, normalizeAutofillPath);
	}
	return site;
}

function sameSite(left, right) {
	return left.instanceOrigin === right.instanceOrigin && left.targetOrigin === right.targetOrigin && left.targetPath === right.targetPath;
}

function sameOrigin(left, right) {
	return left.instanceOrigin === right.instanceOrigin && left.targetOrigin === right.targetOrigin;
}

function sameRecord(stored, site) {
	return (
		sameSite(stored || {}, site) &&
		stored.pagePath === site.pagePath &&
		Object.keys(stored).length === (site.targetPath === AUTOFILL_SITE_SCOPE ? 4 : 3)
	);
}

async function requireCurrentInstance(instanceOrigin) {
	if ((await getSettings()).instanceOrigin !== instanceOrigin) {
		throw policyError('REQUEST_EXPIRED', 'error_INSTANCE_CHANGED');
	}
}

async function hasPermission(targetOrigin) {
	try {
		return (await chrome.permissions.contains({ origins: [targetOriginToPermissionPattern(targetOrigin)] })) === true;
	} catch {
		return false;
	}
}

// An omitted instance returns all saved configurations, including inactive instances.
// Every result is a fresh, validated object. Reading never changes stored metadata.
export async function readAutofillSites(instanceOrigin) {
	const source = instanceOrigin === undefined ? undefined : normalizeOrigin(instanceOrigin);
	const result = await chrome.storage.local.get(STORAGE_KEY);
	if (!Array.isArray(result[STORAGE_KEY])) {
		return [];
	}
	const sites = [];
	const seen = new Set();
	for (const item of result[STORAGE_KEY]) {
		try {
			// Older origin-only grants must never become a wildcard or a root-page grant.
			const site = normalizeSite(item?.instanceOrigin, item?.targetOrigin, item?.targetPath, item?.pagePath);
			const key = JSON.stringify([site.instanceOrigin, site.targetOrigin, site.targetPath]);
			if (!seen.has(key)) {
				seen.add(key);
				sites.push(site);
				if (sites.length === MAX_SITES) {
					break;
				}
			}
		} catch {
			// Ignore corrupt or obsolete records without making them active.
		}
	}
	return source === undefined ? sites : sites.filter((site) => site.instanceOrigin === source);
}

function nextSites(sites, site, enabled) {
	if (site.targetPath === AUTOFILL_SITE_SCOPE) {
		// One site-wide grant replaces the origin's page grants; turning it off
		// removes every grant of the origin.
		const others = sites.filter((item) => !sameOrigin(item, site));
		return enabled ? [...others, site] : others;
	}
	if (!enabled) {
		return sites.filter((item) => !sameSite(item, site));
	}
	// Enabling one page of a site-wide origin narrows the grant to that page.
	const kept = sites.filter((item) => !sameOrigin(item, site) || item.targetPath !== AUTOFILL_SITE_SCOPE);
	return kept.some((item) => sameSite(item, site)) ? kept : [...kept, site];
}

async function writeSites(instanceOrigin, sites, next) {
	// Permissions/storage reads can yield while the user switches instances.
	await requireCurrentInstance(instanceOrigin);
	if (JSON.stringify(next) !== JSON.stringify(sites)) {
		await chrome.storage.local.set({ [STORAGE_KEY]: next });
	}
	return next.filter((item) => item.instanceOrigin === instanceOrigin);
}

// Permission requests/removal belong to the caller so shared host permissions survive.
// Resolve to the current instance's saved sites after the requested change.
// targetPath is a page path or AUTOFILL_SITE_SCOPE; a site-wide grant needs
// the page it was made on as pagePath.
export async function setAutofillSite(instanceOrigin, targetOrigin, targetPath, enabled, { pagePath } = {}) {
	const site =
		enabled === true
			? normalizeSite(instanceOrigin, targetOrigin, targetPath, pagePath)
			: normalizeScope(instanceOrigin, targetOrigin, targetPath);
	if (typeof enabled !== 'boolean') {
		throw policyError('INVALID_REQUEST', 'error_AUTOFILL_TOGGLE_INVALID');
	}
	return serializeWrite(async () => {
		await requireCurrentInstance(site.instanceOrigin);
		if (enabled && !(await hasPermission(site.targetOrigin))) {
			throw policyError('PERMISSION_REQUIRED', 'error_AUTOFILL_PERMISSION');
		}
		const sites = await readAutofillSites();
		const next = nextSites(sites, site, enabled);
		if (enabled && next.length > MAX_SITES) {
			throw policyError('INVALID_REQUEST', 'error_AUTOFILL_LIMIT');
		}
		return writeSites(site.instanceOrigin, sites, next);
	});
}

// Puts back one origin's grants exactly as they were read before a change
// whose follow-up work failed. The permission check already passed for them.
export async function restoreAutofillSites(instanceOrigin, targetOrigin, previous) {
	const origin = {
		instanceOrigin: normalizeOrigin(instanceOrigin),
		targetOrigin: normalizeOrigin(targetOrigin, normalizeAutofillTargetOrigin),
	};
	const restored = previous
		.filter((item) => sameOrigin(item, origin))
		.map((item) => normalizeSite(item.instanceOrigin, item.targetOrigin, item.targetPath, item.pagePath));
	return serializeWrite(async () => {
		await requireCurrentInstance(origin.instanceOrigin);
		const sites = await readAutofillSites();
		return writeSites(origin.instanceOrigin, sites, [...sites.filter((item) => !sameOrigin(item, origin)), ...restored]);
	});
}

// Removing revoked preferences prevents an unrelated future host grant from reviving them.
export function pruneRevokedAutofillSites(removedPatterns = []) {
	return serializeWrite(async () => {
		const raw = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
		const sites = await readAutofillSites();
		const permissionChecks = new Map();
		for (const site of sites) {
			const pattern = targetOriginToPermissionPattern(site.targetOrigin);
			if (!permissionChecks.has(pattern)) {
				permissionChecks.set(pattern, hasPermission(site.targetOrigin));
			}
		}
		const granted = new Map(await Promise.all([...permissionChecks].map(async ([pattern, check]) => [pattern, await check])));
		const next = sites.filter(
			(site) =>
				granted.get(targetOriginToPermissionPattern(site.targetOrigin)) &&
				!removedPatterns.some((pattern) => permissionPatternCoversOrigin(pattern, site.targetOrigin)),
		);
		// Clean obsolete origin-only records as part of startup/revocation cleanup.
		if (
			raw !== undefined &&
			(!Array.isArray(raw) || raw.length !== next.length || raw.some((site, index) => !sameRecord(site, next[index])))
		) {
			await chrome.storage.local.set({ [STORAGE_KEY]: next });
		}
		return next;
	});
}

// Saved preferences from an inactive instance or a revoked permission never authorize work.
// targetPath is the live page path; a site-wide grant covers every path of its origin.
export async function hasAutofillSite(instanceOrigin, targetOrigin, targetPath) {
	const site = normalizeScope(instanceOrigin, targetOrigin, normalizeOrigin(targetPath, normalizeAutofillPath));
	if ((await getSettings()).instanceOrigin !== site.instanceOrigin) {
		return false;
	}
	const sites = await readAutofillSites(site.instanceOrigin);
	if (!autofillCoverage(sites, site.instanceOrigin, site.targetOrigin, site.targetPath) || !(await hasPermission(site.targetOrigin))) {
		return false;
	}
	return (await getSettings()).instanceOrigin === site.instanceOrigin;
}

// Chrome host permissions cover every port, while site preferences remain exact origins.
export async function isPermissionPatternInUse(pattern, instanceOrigin) {
	const source = instanceOrigin === undefined ? (await getSettings()).instanceOrigin : instanceOrigin;
	if (source === null) {
		return false;
	}
	const normalized = normalizeOrigin(source);
	if (originToPermissionPattern(normalized) === pattern) {
		return true;
	}
	return (await readAutofillSites(normalized)).some((site) => targetOriginToPermissionPattern(site.targetOrigin) === pattern);
}
