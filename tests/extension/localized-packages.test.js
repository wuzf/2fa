import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildExtensions, createManifest } from '../../scripts/build-extension.js';
import { buildFirefoxExtension, createFirefoxManifest } from '../../scripts/build-firefox-extension.js';
import { LANGUAGE_OPTIONS } from '../../src/shared/languages.js';
import { createNativeLocale } from '../../extension/native-locales.js';

const root = resolve(import.meta.dirname, '../..');
const outputs = new Map();

beforeAll(async () => {
	// The Chromium build resets its output root, so build Firefox afterwards.
	const chromium = await buildExtensions();
	outputs.set('chrome', chromium[0]);
	outputs.set('edge', chromium[1]);
	outputs.set('firefox', (await buildFirefoxExtension()).outdir);
}, 30000);

describe.each(['chrome', 'edge', 'firefox'])('%s localized package', (browser) => {
	it('ships every native locale and resolves every manifest token without changing browser capabilities', () => {
		const outdir = outputs.get(browser);
		const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf8'));
		expect(manifest).toEqual(browser === 'firefox' ? createFirefoxManifest() : createManifest(browser));
		expect(manifest.version).toBe(JSON.parse(readFileSync(join(root, 'extension', 'manifest.base.json'), 'utf8')).version);
		expect(manifest.permissions).toEqual(
			browser === 'firefox' ? ['activeTab', 'scripting', 'storage', 'clipboardWrite'] : ['activeTab', 'scripting', 'storage'],
		);
		expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
		expect(manifest).not.toHaveProperty('host_permissions');
		expect(manifest.commands['fill-otp'].suggested_key).toEqual({ default: 'Ctrl+Shift+U', mac: 'Command+Shift+U' });
		for (const { value, nativeLocale: locale } of LANGUAGE_OPTIONS) {
			const raw = readFileSync(join(outdir, '_locales', locale, 'messages.json'), 'utf8');
			const messages = JSON.parse(raw);
			expect(messages).toEqual(createNativeLocale(value));
			const resolved = JSON.stringify(manifest).replace(/__MSG_(\w+)__/g, (_token, key) => {
				expect(messages[key]?.message, `${browser}/${locale}/${key}`).toEqual(expect.any(String));
				return messages[key].message;
			});
			expect(resolved).not.toContain('__MSG_');
		}
	});

	it('includes the local resources referenced by its manifest and extension pages', () => {
		const outdir = outputs.get(browser);
		const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf8'));
		const resources = [
			manifest.action.default_popup,
			manifest.options_page,
			...Object.values(manifest.icons),
			...Object.values(manifest.action.default_icon),
			...(manifest.background.scripts || [manifest.background.service_worker]),
			'content.js',
			'source-watch.js',
			'automatic.js',
		];
		for (const page of [manifest.action.default_popup, manifest.options_page]) {
			const html = readFileSync(join(outdir, page), 'utf8');
			for (const [, resource] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
				expect(resource).not.toMatch(/^(?:https?:)?\/\//);
				resources.push(resource);
			}
		}
		for (const resource of resources) {
			expect(existsSync(join(outdir, resource)), `${browser}/${resource}`).toBe(true);
		}
		const firefoxAdapter = join(root, 'extension', 'firefox', 'browser-api.js');
		if (browser === 'firefox') {
			const inputs = JSON.parse(readFileSync(join(root, 'dist', 'firefox-build-inputs.json'), 'utf8'));
			expect(inputs.map((input) => resolve(root, input))).toContain(firefoxAdapter);
		}
	});
});
