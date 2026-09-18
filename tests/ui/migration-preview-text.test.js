import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

function createHarness(secrets) {
	const children = [];
	const document = {
		createElement() {
			return {
				style: {},
				children: [],
				innerHTML: '',
				set textContent(value) {
					this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
				},
				appendChild(child) {
					this.children.push(child);
				},
			};
		},
		getElementById: () => null,
		body: { appendChild: (node) => children.push(node) },
	};
	const context = createContext({ document, secrets, window: {}, setTimeout: () => 0 });
	runInContext(getUtilsCode() + getGoogleMigrationCode(), context);
	context.disableBodyScroll = () => {};
	return { api: context, html: () => children.at(-1).children[0].innerHTML };
}

describe('Google Authenticator preview text', () => {
	const service = '<img src=x onerror="alert(1)"> & 服务';
	const account = 'A <B> & "C"';
	it('renders literal service and account names in the export selection without creating markup', () => {
		const { api, html } = createHarness([{ name: service, account, type: 'TOTP' }]);
		api.showExportToGoogleModal();
		expect(html()).toContain('&lt;img src=x onerror="alert(1)"&gt; &amp; 服务');
		expect(html()).toContain('A &lt;B&gt; &amp; "C"');
		expect(html()).not.toContain('<img');
		expect(html()).not.toContain('<B>');
	});

	it('renders imported labels as text while preserving the original data for confirmation', () => {
		const { api, html } = createHarness([]);
		const items = [{ issuer: service, name: account, type: '<em>HOTP</em>' }];
		api.showGoogleMigrationPreview(items);
		expect(html()).toContain('&lt;img src=x onerror="alert(1)"&gt; &amp; 服务');
		expect(html()).toContain('A &lt;B&gt; &amp; "C"');
		expect(html()).toContain('&lt;em&gt;HOTP&lt;/em&gt;');
		expect(html()).not.toContain('<img');
		expect(api.window.pendingMigrationSecrets).toBe(items);
		expect(items[0].name).toBe(account);
	});
});
