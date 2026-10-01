import { originFromTabUrl, originToPermissionPattern } from '../shared/origin.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError } from './errors.js';
import { requireSettings, validateFlowConfiguration, assertCurrentGeneration } from './configuration.js';

// Browser I/O and bounded document messaging do not read account data.
// openInstance is called only for the explicit "open 2FA" action.
let openingInstance = null;

export async function withTimeout(operation, code, controller = null) {
	let timer;
	try {
		return await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					controller?.abort();
					reject(new ExtensionError(code));
				}, 25000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function eligibleSourceTab(tab, instanceOrigin) {
	return (
		Number.isInteger(tab?.id) &&
		!tab.incognito &&
		originFromTabUrl(tab.url) === instanceOrigin &&
		(!tab.pendingUrl || originFromTabUrl(tab.pendingUrl) === instanceOrigin)
	);
}

export async function querySourceTabs(instanceOrigin) {
	const pattern = originToPermissionPattern(instanceOrigin);
	let tabs;
	try {
		tabs = await chrome.tabs.query({ url: pattern });
	} catch {
		throw new ExtensionError('SOURCE_UNAVAILABLE');
	}
	return tabs.filter((tab) => eligibleSourceTab(tab, instanceOrigin));
}

export async function getSourceTab(tabId, instanceOrigin) {
	try {
		const tab = await chrome.tabs.get(tabId);
		return eligibleSourceTab(tab, instanceOrigin) ? tab : null;
	} catch {
		return null;
	}
}

// A tab created by an earlier "open 2FA" click has an empty url until its first
// navigation commits. Reuse it instead of opening another one; it is only activated,
// never scripted, so eligibleSourceTab stays strict for the other callers.
function openableInstanceTab(tab, instanceOrigin) {
	return (
		eligibleSourceTab(tab, instanceOrigin) ||
		(Number.isInteger(tab?.id) &&
			!tab.incognito &&
			!originFromTabUrl(tab.url) &&
			Boolean(tab.pendingUrl) &&
			originFromTabUrl(tab.pendingUrl) === instanceOrigin)
	);
}

async function getOpenableInstanceTab(tabId, instanceOrigin) {
	try {
		const tab = await chrome.tabs.get(tabId);
		return openableInstanceTab(tab, instanceOrigin) ? tab : null;
	} catch {
		return null;
	}
}

async function openConfiguredInstance(configurationGeneration) {
	const { instanceOrigin } = await requireSettings();
	const configuration = { instanceOrigin, configurationGeneration };
	await validateFlowConfiguration(configuration);
	const pattern = originToPermissionPattern(instanceOrigin);
	let tabs;
	try {
		tabs = (await chrome.tabs.query({ url: pattern })).filter((tab) => openableInstanceTab(tab, instanceOrigin));
	} catch {
		throw new ExtensionError('SOURCE_UNAVAILABLE');
	}
	// Prefer an already usable page, but activation also wakes discarded/frozen tabs.
	tabs.sort((left, right) => Number(Boolean(left.discarded || left.frozen)) - Number(Boolean(right.discarded || right.frozen)));
	for (const candidate of tabs) {
		await validateFlowConfiguration(configuration);
		const tab = await getOpenableInstanceTab(candidate.id, instanceOrigin);
		if (!tab) {
			continue;
		}
		assertCurrentGeneration(configuration);
		let activated;
		try {
			activated = await chrome.tabs.update(tab.id, { active: true });
		} catch {
			// The user may have closed the tab after the last check. Try another one.
			continue;
		}
		if (!openableInstanceTab(activated, instanceOrigin)) {
			continue;
		}
		await validateFlowConfiguration(configuration);
		// Firefox for Android has tabs but no window-management API. Activation is
		// sufficient there; keep the same source/configuration checks on both paths.
		const canFocusWindow = typeof chrome.windows?.get === 'function' && typeof chrome.windows?.update === 'function';
		const window = canFocusWindow ? await chrome.windows.get(activated.windowId) : null;
		const current = await getOpenableInstanceTab(tab.id, instanceOrigin);
		if (!current || (window && current.windowId !== window.id)) {
			continue;
		}
		assertCurrentGeneration(configuration);
		await validateFlowConfiguration(configuration);
		if (window) {
			await chrome.windows.update(window.id, {
				focused: true,
				...(window.state === 'minimized' ? { state: 'normal' } : {}),
			});
		}
		return { status: 'activated', instanceOrigin };
	}

	await validateFlowConfiguration(configuration);
	assertCurrentGeneration(configuration);
	await chrome.tabs.create({ url: instanceOrigin, active: true });
	return { status: 'opened', instanceOrigin };
}

export function openInstance() {
	const configurationGeneration = getConfigurationGeneration();
	if (openingInstance?.configurationGeneration === configurationGeneration) {
		return openingInstance.operation;
	}
	const operation = openConfiguredInstance(configurationGeneration).catch((error) => {
		throw error instanceof ExtensionError ? error : new ExtensionError('SOURCE_UNAVAILABLE');
	});
	openingInstance = { configurationGeneration, operation };
	const release = () => {
		if (openingInstance?.operation === operation) {
			openingInstance = null;
		}
	};
	operation.then(release, release);
	return operation;
}

export async function injectScript(tabId, file) {
	let results;
	try {
		results = await withTimeout(
			chrome.scripting.executeScript({
				target: { tabId, frameIds: [0] },
				files: [file],
			}),
			'TARGET_UNAVAILABLE',
		);
	} catch {
		throw new ExtensionError('TARGET_UNAVAILABLE');
	}

	const result = results?.find((item) => item.frameId === 0) || results?.[0];
	if (!result?.documentId) {
		throw new ExtensionError('TARGET_UNAVAILABLE');
	}
	return result.documentId;
}

export async function sendDocumentMessage(tabId, documentId, message, fallbackCode) {
	try {
		return await withTimeout(chrome.tabs.sendMessage(tabId, message, { frameId: 0, documentId }), fallbackCode);
	} catch {
		throw new ExtensionError(fallbackCode);
	}
}
