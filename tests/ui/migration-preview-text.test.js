import { LOCALES } from '../../src/ui/locales/index.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { transferI18n } from '../helpers/transfer-i18n.js';
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
		querySelectorAll: () => [],
		body: { appendChild: (node) => children.push(node) },
	};
	const context = createContext({ I18N_LOCALES: LOCALES, ...transferI18n(), document, secrets, window: {}, setTimeout: () => 0 });
	runInContext(getUtilsCode() + getSharedTransferMessageLocalizerCode() + getGoogleMigrationCode(), context);
	context.disableBodyScroll = () => {};
	return { api: context, html: () => children.at(-1).children[0].innerHTML };
}

describe('Google Authenticator preview text', () => {
	const service = '<img src=x onerror="alert(1)"> & 服务';
	const account = 'A <B> & "C"';
	it('renders literal service and account names in the export selection without creating markup', () => {
		const { api, html } = createHarness([{ name: service, account, type: 'TOTP' }]);
		api.showExportToGoogleModal();
		// Quotes are escaped too, so the same text is also safe inside attributes.
		expect(html()).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 服务');
		expect(html()).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
		expect(html()).not.toContain('<img');
		expect(html()).not.toContain('<B>');
	});

	it('labels accounts whose name is only spaces like their cards, without changing the exported data', () => {
		const secrets = [
			{ name: '   ', account: 'alice', type: 'TOTP' },
			{ name: '', account: 'bob', type: 'TOTP' },
		];
		const { api, html } = createHarness(secrets);
		api.showExportToGoogleModal();
		const labels = [...html().matchAll(/font-weight: 600[^>]*>([^<]*)</g)].map((match) => match[1]);
		expect(labels).toEqual([api.t('transferUnnamed'), api.t('transferUnnamed')]);
		expect(api.secrets.map((item) => item.name)).toEqual(['   ', '']);
	});

	it('renders imported labels as text while preserving the original data for confirmation', () => {
		const { api, html } = createHarness([]);
		const items = [{ issuer: service, name: account, type: '<em>HOTP</em>' }];
		api.showGoogleMigrationPreview(items);
		// Quotes are escaped too, so the same text is also safe inside attributes.
		expect(html()).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 服务');
		expect(html()).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
		expect(html()).toContain('&lt;em&gt;HOTP&lt;/em&gt;');
		expect(html()).not.toContain('<img');
		expect(api.window.pendingMigrationSecrets).toBe(items);
		expect(items[0].name).toBe(account);
	});
});
