import { readAutofillSites } from '../shared/autofill-sites.js';
import { originToPermissionPattern, targetOriginToPermissionPattern } from '../shared/origin.js';
import { getConnectionStatus, getSettings } from '../shared/storage.js';
import { MESSAGE } from '../shared/protocol.js';
import { createRegistrationController } from './registration-controller.js';

async function permittedScopes() {
	const { instanceOrigin } = await getSettings();
	const scopes = new Map();
	if (!instanceOrigin) {
		return scopes;
	}
	const permissionChecks = new Map();
	const permitted = (pattern) => {
		if (!permissionChecks.has(pattern)) {
			permissionChecks.set(pattern, chrome.permissions.contains({ origins: [pattern] }));
		}
		return permissionChecks.get(pattern);
	};
	if ((await permitted(originToPermissionPattern(instanceOrigin))) !== true) {
		return scopes;
	}
	const { mode } = await getConnectionStatus(instanceOrigin);
	const paths = new Map();
	for (const site of await readAutofillSites(instanceOrigin)) {
		if ((await permitted(targetOriginToPermissionPattern(site.targetOrigin))) !== true) {
			continue;
		}
		if (!paths.has(site.targetOrigin)) {
			paths.set(site.targetOrigin, []);
		}
		paths.get(site.targetOrigin).push(site.targetPath);
	}
	for (const [origin, routes] of paths) {
		scopes.set(origin, JSON.stringify([instanceOrigin, mode, routes.sort()]));
	}
	return scopes;
}

const registration = createRegistrationController({
	id: 'twofa-auto-sites',
	ownsScript: (script) => typeof script.id === 'string' && script.id.startsWith('twofa-auto-'),
	file: 'automatic.js',
	stopMessage: MESSAGE.AUTO_STOP,
	getScopes: permittedScopes,
	permissionPattern: targetOriginToPermissionPattern,
	stopIncognito: true,
});

export const reconcileAutofillScripts = registration.reconcile;
export const observeAutofillRenderer = registration.observeRenderer;
