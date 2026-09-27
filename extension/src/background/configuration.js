import { originToPermissionPattern } from '../shared/origin.js';
import { getSettings, getConnectionStatus } from '../shared/storage.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError } from './errors.js';

// Configuration and source-permission checks have one owner. Target-specific
// checks are supplied by a flow so this module never depends on a workflow.

export async function requireSettings() {
	const settings = await getSettings();
	if (!settings.instanceOrigin) {
		throw new ExtensionError('NOT_CONFIGURED');
	}
	return settings;
}

export async function requireInstancePermission(instanceOrigin) {
	const pattern = originToPermissionPattern(instanceOrigin);
	const granted = await chrome.permissions.contains({ origins: [pattern] });
	if (!granted) {
		throw new ExtensionError('PERMISSION_REQUIRED');
	}
	return pattern;
}

export async function validateFlowConfiguration(flow) {
	const settings = await requireSettings();
	if (settings.instanceOrigin !== flow.instanceOrigin) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	await requireInstancePermission(flow.instanceOrigin);
	assertCurrentGeneration(flow);
	await flow.assertAutomaticTarget?.();
	assertCurrentGeneration(flow);
}

export function assertCurrentGeneration(flow) {
	if (flow.configurationGeneration !== getConfigurationGeneration()) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
}

export async function requireOfflineConfiguration() {
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await requireSettings();
	const configuration = { instanceOrigin, configurationGeneration };
	await validateFlowConfiguration(configuration);
	if ((await getConnectionStatus(instanceOrigin)).mode !== 'offline') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	await validateFlowConfiguration(configuration);
	return configuration;
}

export async function validateOfflineConfiguration(configuration) {
	await validateFlowConfiguration(configuration);
	if ((await getConnectionStatus(configuration.instanceOrigin)).mode !== 'offline') {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	await validateFlowConfiguration(configuration);
}
