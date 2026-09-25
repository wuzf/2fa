import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';

const scriptsDirectory = new URL('../../scripts/', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const declared = new Set([...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})]);
const builtins = new Set(builtinModules);

function packageName(specifier) {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages(source) {
	const specifiers = [
		...source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
		...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
		...source.matchAll(/\bimport\.meta\.resolve\(\s*['"]([^'"]+)['"]\s*\)/g),
	].map((match) => match[1]);
	return specifiers.filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:')).map(packageName);
}

describe('packages imported by project scripts', () => {
	const scripts = readdirSync(scriptsDirectory).filter((name) => name.endsWith('.js'));

	it('finds the scripts and their imports', () => {
		expect(scripts).toContain('generate-extension-icons.js');
		expect(importedPackages(readFileSync(new URL('generate-extension-icons.js', scriptsDirectory), 'utf8'))).toContain('@playwright/test');
	});

	it.each(scripts)('%s imports only Node built-ins and declared packages', (name) => {
		const source = readFileSync(new URL(name, scriptsDirectory), 'utf8');
		// A transitive package may be hoisted into node_modules today and disappear with the next install.
		const undeclared = importedPackages(source).filter((specifier) => !builtins.has(specifier) && !declared.has(specifier));
		expect(undeclared).toEqual([]);
	});
});
