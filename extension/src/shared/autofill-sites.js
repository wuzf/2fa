import { localizedError } from './localized-error.js';
import {
	normalizeInstanceOrigin,
	normalizeAutofillTargetOrigin,
	normalizeAutofillPath,
	originToPermissionPattern,
	targetOriginToPermissionPattern,
	permissionPatternCoversOrigin,
	isManualOnlyTargetOrigin,
	isPrivateIPv4Host,
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

function normalizeSite(instanceOrigin, targetOrigin, targetPath) {
	const site = {
		instanceOrigin: normalizeOrigin(instanceOrigin),
		targetOrigin: normalizeOrigin(targetOrigin, normalizeAutofillTargetOrigin),
		targetPath: normalizeOrigin(targetPath, normalizeAutofillPath),
	};
	if (site.instanceOrigin === site.targetOrigin) {
		throw policyError('INVALID_REQUEST', 'error_AUTOFILL_SELF');
	}
	return site;
}

function sameSite(left, right) {
	return left.instanceOrigin === right.instanceOrigin && left.targetOrigin === right.targetOrigin && left.targetPath === right.targetPath;
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
			const site = normalizeSite(item?.instanceOrigin, item?.targetOrigin, item?.targetPath);
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

// Permission requests/removal belong to the caller so shared host permissions survive.
// Resolve to the current instance's saved sites after the requested change.
export async function setAutofillSite(instanceOrigin, targetOrigin, targetPath, enabled) {
	const site = normalizeSite(instanceOrigin, targetOrigin, targetPath);
	if (typeof enabled !== 'boolean') {
		throw policyError('INVALID_REQUEST', 'error_AUTOFILL_TOGGLE_INVALID');
	}
	return serializeWrite(async () => {
		await requireCurrentInstance(site.instanceOrigin);
		if (enabled && !(await hasPermission(site.targetOrigin))) {
			throw policyError('PERMISSION_REQUIRED', 'error_AUTOFILL_PERMISSION');
		}
		const sites = await readAutofillSites();
		const exists = sites.some((item) => sameSite(item, site));
		if (enabled && !exists && sites.length === MAX_SITES) {
			throw policyError('INVALID_REQUEST', 'error_AUTOFILL_LIMIT');
		}
		const next = enabled ? (exists ? sites : [...sites, site]) : sites.filter((item) => !sameSite(item, site));
		// Permissions/storage reads can yield while the user switches instances.
		await requireCurrentInstance(site.instanceOrigin);
		if (enabled !== exists) {
			await chrome.storage.local.set({ [STORAGE_KEY]: next });
		}
		return next.filter((item) => item.instanceOrigin === site.instanceOrigin);
	});
}

// Private IPv4 grants saved before plain-HTTP network pages became manual-only.
// Neither a supported site nor an instance can use their http://host/* pattern.
function manualOnlyPermissionPatterns(raw) {
	const patterns = new Set();
	for (const item of Array.isArray(raw) ? raw : []) {
		if (!isManualOnlyTargetOrigin(item?.targetOrigin)) {
			continue;
		}
		const url = new URL(item.targetOrigin);
		if (url.origin === item.targetOrigin && isPrivateIPv4Host(url.hostname)) {
			patterns.add(`http://${url.hostname}/*`);
		}
	}
	return [...patterns];
}

// Removing revoked preferences prevents an unrelated future host grant from reviving them.
export function pruneRevokedAutofillSites(removedPatterns = []) {
	return serializeWrite(async () => {
		const raw = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
		const obsoletePatterns = manualOnlyPermissionPatterns(raw);
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
			(!Array.isArray(raw) ||
				raw.length !== next.length ||
				raw.some((site, index) => !sameSite(site || {}, next[index]) || Object.keys(site).length !== 3))
		) {
			await chrome.storage.local.set({ [STORAGE_KEY]: next });
		}
		if (obsoletePatterns.length) {
			try {
				// Manual filling uses the active tab, not these host grants.
				await chrome.permissions.remove({ origins: obsoletePatterns });
			} catch {
				// Browser-managed grants may not be removable; no site uses them now.
			}
		}
		return next;
	});
}

// Saved preferences from an inactive instance or a revoked permission never authorize work.
export async function hasAutofillSite(instanceOrigin, targetOrigin, targetPath) {
	if (isManualOnlyTargetOrigin(targetOrigin)) {
		// A grant saved for a plain-HTTP network page is never executed.
		return false;
	}
	const site = normalizeSite(instanceOrigin, targetOrigin, targetPath);
	if ((await getSettings()).instanceOrigin !== site.instanceOrigin) {
		return false;
	}
	const sites = await readAutofillSites(site.instanceOrigin);
	if (!sites.some((item) => sameSite(item, site)) || !(await hasPermission(site.targetOrigin))) {
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
