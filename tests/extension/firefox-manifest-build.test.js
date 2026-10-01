import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { createManifest } from '../../scripts/build-extension.js';
import { createFirefoxManifest } from '../../scripts/build-firefox-extension.js';

const extensionVersion = JSON.parse(readFileSync(new URL('../../extension/manifest.base.json', import.meta.url), 'utf8')).version;

describe('Firefox extension manifest generation', () => {
	it('uses a Firefox background page with explicit data disclosures and Android support', () => {
		const manifest = createFirefoxManifest();

		expect(manifest.manifest_version).toBe(3);
		expect(manifest.version).toBe(extensionVersion);
		expect(manifest.background).toEqual({ scripts: ['background.js'], type: 'module' });
		expect(manifest.incognito).toBe('not_allowed');
		expect(manifest.browser_specific_settings).toEqual({
			gecko: {
				id: '2fa-verification-assistant@wuzf.github.io',
				strict_min_version: '153.0',
				data_collection_permissions: { required: ['authenticationInfo', 'personallyIdentifyingInfo'] },
			},
			gecko_android: { strict_min_version: '153.0' },
		});
		expect(manifest).not.toHaveProperty('minimum_chrome_version');
		expect(manifest.default_locale).toBe('en');
		expect(manifest.name).toBe('__MSG_extensionName__');
		expect(manifest.description).toBe('__MSG_extensionDescription__');
		expect(manifest.action.default_title).toBe('__MSG_actionTitle__');
		expect(manifest.commands['fill-otp'].description).toBe('__MSG_fillOtpCommandDescription__');
	});

	it('requires only extension storage, user-initiated access and clipboard writes', () => {
		const manifest = createFirefoxManifest();

		expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'clipboardWrite']);
		expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
		expect(manifest).not.toHaveProperty('host_permissions');
		expect(manifest).not.toHaveProperty('optional_permissions');
		expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
	});

	it.each(['chrome', 'edge'])('leaves the published %s manifest unchanged', (browser) => {
		const before = createManifest(browser);
		const firefox = createFirefoxManifest();
		firefox.permissions.push('tabs');
		firefox.background.scripts.push('unwanted.js');
		const after = createManifest(browser);

		expect(after).toEqual(before);
		expect(after.version).toBe(extensionVersion);
		expect(after.permissions).toEqual(['activeTab', 'scripting', 'storage']);
		expect(after.background).toEqual({ service_worker: 'background.js', type: 'module' });
		expect(after.minimum_chrome_version).toBe('127');
		expect(after).not.toHaveProperty('browser_specific_settings');
		expect(after).not.toHaveProperty('incognito');
	});
});
