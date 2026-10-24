import { LIMITS, ThemeError, invariant, isRecord } from './schema.js';
import { APP_LIMITS } from './appSchema.js';
import { ImportBudget, decodeText } from './resources.js';
import { readArchiveManifest } from './archive.js';
import { downloadThemeSource, normalizeThemeImport } from './package.js';
import { normalizeAppThemeImport } from './appPackage.js';

function manifestFormat(bytes) {
	let manifest;
	try {
		manifest = JSON.parse(decodeText(bytes));
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_JSON');
	}
	invariant(isRecord(manifest), 'THEME_INVALID_JSON');
	// A declared app always reaches the app validator. Never retry a rejected app
	// as CSS/layout: detection grants neither execution nor publication rights.
	return manifest.themeApiVersion === 2 || manifest.kind === 'app' ? 'app' : 'v1';
}

/** Download once and select one protocol validator while preserving its limits. */
export async function normalizeDetectedThemeImport(input, options = {}) {
	const budget = new ImportBudget(options);
	const source = await downloadThemeSource(input, options, budget);
	let format = options.format;
	if (!format || format === 'auto') {
		if (/\.(?:css|json)$/i.test(source.name)) {
			// Standalone CSS/JSON is the existing v1 format; app themes require a
			// complete ZIP with an integrity-checked file inventory.
			format = 'v1';
		} else {
			format = manifestFormat(
				readArchiveManifest(source.bytes, {
					maxEntries: Math.max(LIMITS.files + 32, APP_LIMITS.files),
					manifestBytes: Math.max(LIMITS.manifestBytes, APP_LIMITS.manifestBytes),
				}),
			);
		}
	}
	return format === 'app' ? normalizeAppThemeImport(source) : normalizeThemeImport(source, options, budget);
}
