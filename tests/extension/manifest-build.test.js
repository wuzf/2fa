import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createManifest } from '../../scripts/build-extension.js';
import { LANGUAGE_OPTIONS } from '../../src/shared/languages.js';
import { createNativeLocale } from '../../extension/native-locales.js';

const extensionManifest = JSON.parse(readFileSync(new URL('../../extension/manifest.base.json', import.meta.url), 'utf8'));
const REQUIRED_PERMISSIONS = ['activeTab', 'scripting', 'storage'];
const FORBIDDEN_PERMISSIONS = ['cookies', 'tabs', 'declarativeNetRequest', 'webRequest', 'debugger', 'nativeMessaging', '<all_urls>'];

function expectValidExtensionVersion(version) {
	expect(version).toMatch(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/);
	for (const component of version.split('.')) {
		expect(Number(component)).toBeLessThanOrEqual(65535);
	}
}

describe('extension manifest generation', () => {
	it.each(['chrome', 'edge'])('creates a least-privilege Manifest V3 build for %s', (browser) => {
		const manifest = createManifest(browser);
		const declaredPermissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];

		expect(manifest.manifest_version).toBe(3);
		expect(manifest.permissions).toEqual(REQUIRED_PERMISSIONS);
		expect(manifest).not.toHaveProperty('host_permissions');
		expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
		for (const permission of FORBIDDEN_PERMISSIONS) {
			expect(declaredPermissions).not.toContain(permission);
		}
		expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
		expect(manifest.minimum_chrome_version).toMatch(/^\d+$/);
		expectValidExtensionVersion(manifest.version);
		expect(manifest.version).toBe(extensionManifest.version);
	});

	it('rejects an unknown browser target', () => {
		expect(() => createManifest('firefox')).toThrow('Unsupported browser target');
	});

	it.each(['chrome', 'edge'])('resolves every %s manifest message in all supported browser languages', (browser) => {
		const manifest = createManifest(browser);
		expect(manifest.default_locale).toBe('en');
		expect(manifest.name).toBe('__MSG_extensionName__');
		expect(manifest.description).toBe('__MSG_extensionDescription__');
		expect(manifest.action.default_title).toBe('__MSG_actionTitle__');
		expect(manifest.commands['fill-otp'].description).toBe('__MSG_fillOtpCommandDescription__');
		const keys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
		for (const { value: locale } of LANGUAGE_OPTIONS) {
			const messages = createNativeLocale(locale);
			for (const key of keys) {
				expect(messages[key]?.message, `${locale}/${key}`).toEqual(expect.any(String));
				expect(messages[key].message.trim().length).toBeGreaterThan(0);
				expect(messages[key].message).not.toContain('__MSG_');
			}
			expect(messages.extensionName.message.length).toBeLessThanOrEqual(75);
			expect(messages.extensionDescription.message.length).toBeLessThanOrEqual(132);
			expect(messages.actionTitle.message).toBe(messages.extensionName.message);
		}
	});
});
