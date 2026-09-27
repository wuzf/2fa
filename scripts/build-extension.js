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
const outputRoot = join(rootDir, 'dist', 'extension');
const targets = ['chrome', 'edge'];
const forbiddenPermissions = new Set(['cookies', 'tabs', 'declarativeNetRequest', 'webRequest', 'debugger', 'nativeMessaging']);

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function createManifest(browser) {
	if (!targets.includes(browser)) {
		throw new Error(`Unsupported browser target: ${browser}`);
	}
	const base = readJson(join(sourceDir, 'manifest.base.json'));
	const override = readJson(join(sourceDir, `manifest.${browser}.json`));
	// Chrome and Edge share the extension's own version, independent of the Worker.
	const manifest = { ...base, ...override, version: base.version };

	for (const permission of manifest.permissions || []) {
		if (forbiddenPermissions.has(permission) || permission === '<all_urls>') {
			throw new Error(`Forbidden extension permission: ${permission}`);
		}
	}
	if ((manifest.host_permissions || []).length > 0) {
		throw new Error('Persistent host_permissions are not allowed');
	}
	return manifest;
}

function resetOutputRoot() {
	const expectedParent = resolve(rootDir, 'dist');
	const resolvedOutput = resolve(outputRoot);
	if (relative(expectedParent, resolvedOutput).startsWith('..') || resolvedOutput === expectedParent) {
		throw new Error('Refusing to clear an unsafe extension output path');
	}
	rmSync(resolvedOutput, { recursive: true, force: true });
	mkdirSync(resolvedOutput, { recursive: true });
}

async function bundleTarget(browser) {
	const outdir = join(outputRoot, browser);
	mkdirSync(join(outdir, 'icons'), { recursive: true });

	const common = {
		bundle: true,
		target: 'chrome127',
		platform: 'browser',
		minify: false,
		sourcemap: false,
		logLevel: 'warning',
		legalComments: 'none',
	};

	await Promise.all([
		build({
			...common,
			entryPoints: [join(sourceDir, 'src', 'background', 'index.js')],
			outfile: join(outdir, 'background.js'),
			format: 'esm',
		}),
		build({ ...common, entryPoints: [join(sourceDir, 'src', 'content', 'index.js')], outfile: join(outdir, 'content.js'), format: 'iife' }),
		build({
			...common,
			entryPoints: [join(sourceDir, 'src', 'content', 'source-watch.js')],
			outfile: join(outdir, 'source-watch.js'),
			format: 'iife',
		}),
		build({
			...common,
			entryPoints: [join(sourceDir, 'src', 'content', 'automatic.js')],
			outfile: join(outdir, 'automatic.js'),
			format: 'iife',
		}),
		build({ ...common, entryPoints: [join(sourceDir, 'src', 'popup', 'index.js')], outfile: join(outdir, 'popup.js'), format: 'esm' }),
		build({ ...common, entryPoints: [join(sourceDir, 'src', 'options', 'index.js')], outfile: join(outdir, 'options.js'), format: 'esm' }),
	]);

	for (const [from, to] of [
		['src/popup/popup.html', 'popup.html'],
		['src/options/options.html', 'options.html'],
		['src/options/options.css', 'options.css'],
		['src/shared/theme.css', 'theme.css'],
		['src/shared/controls.css', 'controls.css'],
		['assets/fluent-system-icons.LICENSE.txt', 'FLUENT_ICONS_LICENSE.txt'],
	]) {
		cpSync(join(sourceDir, from), join(outdir, to));
	}
	const popupStyles = readFileSync(join(sourceDir, 'src/popup/popup.css'), 'utf8');
	writeFileSync(
		join(outdir, 'popup.css'),
		`${popupStyles}\n:root { --progress-height: ${PROGRESS_HEIGHT}; --progress-fill: ${PROGRESS_GRADIENT}; }\n${getCardProgressStyles()}\n`,
	);
	for (const size of [16, 32, 48, 128]) {
		const iconPath = join(sourceDir, 'assets', `icon-${size}.png`);
		if (!existsSync(iconPath)) {
			throw new Error(`Missing extension icon: ${iconPath}`);
		}
		cpSync(iconPath, join(outdir, 'icons', `icon-${size}.png`));
	}
	writeNativeLocales(outdir);

	writeFileSync(join(outdir, 'manifest.json'), `${JSON.stringify(createManifest(browser), null, '\t')}\n`);
	return outdir;
}

export async function buildExtensions() {
	resetOutputRoot();
	const outputs = [];
	for (const browser of targets) {
		outputs.push(await bundleTarget(browser));
	}
	return outputs;
}

if (isMainModule(import.meta.url)) {
	buildExtensions()
		.then((outputs) => {
			for (const output of outputs) {
				console.log(`Built ${relative(rootDir, output)}`);
			}
		})
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
