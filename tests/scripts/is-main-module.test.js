import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isMainModule } from '../../scripts/is-main-module.js';

let root;
let real;
let link;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), '2fa-entry-check-'));
	// Real directory with a non-ASCII name and a space, reached through a junction (a directory symlink elsewhere).
	real = join(root, '真实 目录');
	mkdirSync(join(real, 'scripts'), { recursive: true });
	writeFileSync(join(real, 'package.json'), JSON.stringify({ type: 'module' }));
	for (const name of ['release.js', 'publish-release.js', 'release-assets.js', 'is-main-module.js']) {
		copyFileSync(new URL(`../../scripts/${name}`, import.meta.url), join(real, 'scripts', name));
	}
	link = join(root, 'link');
	symlinkSync(real, link, 'junction');
});

afterEach(() => {
	if (root && dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('2fa-entry-check-')) {
		// Remove the link itself first so cleanup never walks through it.
		unlinkSync(link);
		rmSync(root, { recursive: true, force: true });
	}
});

describe('entry module detection', () => {
	const moduleUrl = () => pathToFileURL(join(real, 'scripts', 'release.js')).href;

	it.each([
		['the real path', () => join(real, 'scripts', 'release.js'), true],
		['a junction or symlink to it', () => join(link, 'scripts', 'release.js'), true],
		['the path without its extension', () => join(link, 'scripts', 'release'), true],
		['a same-named script in another directory', () => fileURLToPath(new URL('../../scripts/release.js', import.meta.url)), false],
		['another script', () => join(link, 'scripts', 'publish-release.js'), false],
		['a missing file', () => join(link, 'scripts', 'missing.js'), false],
		['no entry script', () => undefined, false],
	])('recognizes %s', (_label, entry, expected) => {
		expect(isMainModule(moduleUrl(), entry())).toBe(expected);
	});

	it.each([
		['release.js', '用法'],
		['publish-release.js', 'Release tag must use the exact vX.Y.Z format'],
		['release', '用法'],
	])('runs the main code of scripts/%s started through a junction', (script, message) => {
		// Without arguments both scripts stop with a usage error before touching any file or remote.
		const result = spawnSync(process.execPath, [join(link, 'scripts', script)], { cwd: root, encoding: 'utf8', windowsHide: true });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(message);
	});
});
