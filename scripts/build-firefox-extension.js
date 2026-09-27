#!/usr/bin/env node

import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCardProgressStyles, PROGRESS_GRADIENT, PROGRESS_HEIGHT } from '../src/ui/styles/progress.js';
import { writeNativeLocales } from '../extension/native-locales.js';
import { isMainModule } from './is-main-module.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const sourceDir = join(rootDir, 'extension');
const outputDir = join(rootDir, 'dist', 'extension', 'firefox');
const forbiddenPermissions = new Set([
	'cookies',
	'tabs',
	'declarativeNetRequest',
	'webRequest',
	'debugger',
	'nativeMessaging',
	'<all_urls>',
]);

export function createFirefoxManifest() {
	const base = JSON.parse(readFileSync(join(sourceDir, 'manifest.base.json'), 'utf8'));
	const override = JSON.parse(readFileSync(join(sourceDir, 'manifest.firefox.json'), 'utf8'));
	const manifest = { ...base, ...override, version: base.version };
	delete manifest.minimum_chrome_version;

	for (const permission of [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]) {
		if (forbiddenPermissions.has(permission)) {
			throw new Error(`Forbidden extension permission: ${permission}`);
		}
	}
	if ((manifest.host_permissions || []).length > 0) {
		throw new Error('Persistent host_permissions are not allowed');
	}
	return manifest;
}

function resetFirefoxOutput() {
	const expectedParent = resolve(rootDir, 'dist', 'extension');
	const resolvedOutput = resolve(outputDir);
	if (relative(expectedParent, resolvedOutput) !== 'firefox') {
		throw new Error('Refusing to clear an unsafe Firefox output path');
	}
	// This build must never remove the already-published Chrome or Edge packages.
	rmSync(resolvedOutput, { recursive: true, force: true });
	mkdirSync(join(resolvedOutput, 'icons'), { recursive: true });
}

export async function buildFirefoxExtension() {
	const manifest = createFirefoxManifest();
	resetFirefoxOutput();
	const common = {
		absWorkingDir: rootDir,
		bundle: true,
		target: 'firefox153',
		platform: 'browser',
		minify: false,
		sourcemap: false,
		metafile: true,
		logLevel: 'warning',
		legalComments: 'none',
		// The Firefox adapter retains native Promise-based APIs and isolates tabs
		// from private windows and containers. Content scripts use the property form.
		inject: [join(sourceDir, 'firefox', 'browser-api.js')],
		define: { chrome: 'firefox', 'globalThis.chrome': 'firefox' },
	};
	const bundles = await Promise.all(
		[
			['background/index.js', 'background.js', 'esm'],
			['content/index.js', 'content.js', 'iife'],
			['content/source-watch.js', 'source-watch.js', 'iife'],
			['content/automatic.js', 'automatic.js', 'iife'],
			['popup/index.js', 'popup.js', 'esm'],
			['options/index.js', 'options.js', 'esm'],
		].map(([entry, output, format]) =>
			build({
				...common,
				entryPoints: [join(sourceDir, 'src', entry)],
				outfile: join(outputDir, output),
				format,
			}),
		),
	);

	for (const [from, to] of [
		['src/popup/popup.html', 'popup.html'],
		['src/options/options.html', 'options.html'],
		['src/options/options.css', 'options.css'],
		['src/shared/theme.css', 'theme.css'],
		['src/shared/controls.css', 'controls.css'],
		['assets/fluent-system-icons.LICENSE.txt', 'FLUENT_ICONS_LICENSE.txt'],
	]) {
		cpSync(join(sourceDir, from), join(outputDir, to));
	}
	const popupStyles = readFileSync(join(sourceDir, 'src/popup/popup.css'), 'utf8');
	writeFileSync(
		join(outputDir, 'popup.css'),
		`${popupStyles}\n:root { --progress-height: ${PROGRESS_HEIGHT}; --progress-fill: ${PROGRESS_GRADIENT}; }\n${getCardProgressStyles()}\n`,
	);
	for (const size of [16, 32, 48, 128]) {
		const iconPath = join(sourceDir, 'assets', `icon-${size}.png`);
		if (!existsSync(iconPath)) {
			throw new Error(`Missing extension icon: ${iconPath}`);
		}
		cpSync(iconPath, join(outputDir, 'icons', `icon-${size}.png`));
	}
	writeNativeLocales(outputDir);
	writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	const inputs = [...new Set(bundles.flatMap(({ metafile }) => Object.keys(metafile.inputs)))].sort();
	writeFileSync(join(rootDir, 'dist', 'firefox-build-inputs.json'), `${JSON.stringify(inputs, null, '\t')}\n`);
	return { outdir: outputDir, inputs };
}

if (isMainModule(import.meta.url)) {
	buildFirefoxExtension()
		.then(({ outdir }) => console.log(`Built ${relative(rootDir, outdir)}`))
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
