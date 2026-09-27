import { getConnectionStatus, getSettings } from '../shared/storage.js';
import { originToPermissionPattern } from '../shared/origin.js';
import { MESSAGE } from '../shared/protocol.js';
import { createRegistrationController } from './registration-controller.js';

async function enabledScopes() {
	const { instanceOrigin } = await getSettings();
	const scopes = new Map();
	if (!instanceOrigin || !(await chrome.permissions.contains({ origins: [originToPermissionPattern(instanceOrigin)] }))) {
		return scopes;
	}
	if ((await getConnectionStatus(instanceOrigin)).mode === 'offline') {
		scopes.set(instanceOrigin, 'offline');
	}
	return scopes;
}

const registration = createRegistrationController({
	id: 'twofa-source-watch',
	ownsScript: (script) => script.id === 'twofa-source-watch',
	file: 'source-watch.js',
	stopMessage: MESSAGE.SOURCE_STOP,
	getScopes: enabledScopes,
	permissionPattern: originToPermissionPattern,
});

export const reconcileSourceWatcher = registration.reconcile;
export const observeSourceRenderer = registration.observeRenderer;
