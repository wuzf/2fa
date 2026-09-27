// Files attached to every GitHub Release. All of them are read from dist/.
export const WORKER_ASSET_NAMES = Object.freeze(['worker.js', 'worker.metadata.json', 'DEPLOY.md']);
export const EXTENSION_BROWSERS = Object.freeze(['chrome', 'edge', 'firefox']);

// The extension keeps its own version in extension/manifest.base.json, which
// browsers accept as one to four dot-separated integers.
const extensionVersionPattern = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;

export function extensionPackageName(browser, version) {
	if (!EXTENSION_BROWSERS.includes(browser)) {
		throw new Error(`Unsupported browser target: ${browser}`);
	}
	if (typeof version !== 'string' || !extensionVersionPattern.test(version)) {
		throw new Error('Extension version must be one to four dot-separated integers');
	}
	return `2fa-extension-${browser}-${version}.zip`;
}

export function releaseAssetNames(extensionVersion) {
	return [...WORKER_ASSET_NAMES, ...EXTENSION_BROWSERS.map((browser) => extensionPackageName(browser, extensionVersion))];
}
