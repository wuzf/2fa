// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const SECRET = 'JBSWY3DPEHPK3PXP';

// Real Google migration and QR scan code; only the network and timers are stubbed.
function createHarness() {
	localStorage.setItem('language', 'en');
	const api = createContext({
		document,
		window,
		localStorage,
		navigator: { language: 'en' },
		URL,
		URLSearchParams,
		TextEncoder,
		TextDecoder,
		AbortController,
		atob,
		btoa,
		setTimeout: () => 0,
		clearTimeout: () => {},
		console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		secrets: [],
	});
	runInContext(getI18nCode() + getSharedTransferMessageLocalizerCode() + getUtilsCode() + getGoogleMigrationCode() + getQRCodeCode(), api);
	api.authenticatedFetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ successCount: 1, failCount: 0, results: [] }),
	}));
	api.loadSecrets = vi.fn(async () => {});
	api.showCenterToast = vi.fn();
	api.hideQRScanner = vi.fn();
	api.disableBodyScroll = vi.fn();
	api.enableBodyScroll = vi.fn();
	api.setLanguage('en');
	return {
		api,
		sentNames: () =>
			api.authenticatedFetch.mock.calls.flatMap(([, options]) => {
				const body = JSON.parse(options.body);
				return (body.secrets || [body]).map(({ name, account }) => ({ name, account }));
			}),
	};
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('Google migration names with a blank or padded issuer', () => {
	it.each([
		['a padded issuer', { issuer: '  Example  ', name: 'alice@example.test' }, { name: 'Example', account: 'alice@example.test' }],
		['a blank issuer with a service label', { issuer: '   ', name: 'Example:alice' }, { name: 'Example', account: 'alice' }],
		['a blank issuer', { issuer: '\t', name: 'alice@example.test' }, { name: 'alice@example.test', account: 'alice@example.test' }],
		['no names at all', { issuer: ' ', name: '  ' }, { name: 'Imported key', account: '' }],
	])('imports %s with the name the server will keep', async (_label, entry, expected) => {
		const { api, sentNames } = createHarness();
		api.showGoogleMigrationPreview([{ ...entry, secret: SECRET, type: 'TOTP' }]);
		// The preview shows the name the entry is saved with.
		expect(document.querySelector('.migration-preview-item div div').textContent).toBe(expected.name);
		await api.confirmGoogleMigration();
		expect(sentNames()).toEqual([expected]);
	});
});

describe('scanned otpauth names with a blank or padded issuer', () => {
	it.each([
		['a padded issuer', 'otpauth://totp/alice?issuer=%20Example%20&secret=' + SECRET, { name: 'Example', account: 'alice' }],
		[
			'a blank issuer with a label prefix',
			'otpauth://totp/Example:alice?issuer=%20%20&secret=' + SECRET,
			{ name: 'Example', account: 'alice' },
		],
		['a blank issuer', 'otpauth://totp/alice?issuer=%20&secret=' + SECRET, { name: 'alice', account: 'alice' }],
		['a blank issuer and label prefix', 'otpauth://totp/%20:alice?issuer=%20&secret=' + SECRET, { name: 'alice', account: 'alice' }],
		[
			'an issuer with a percent sign',
			'otpauth://totp/alice?issuer=100%25%20Corp&secret=' + SECRET,
			{ name: '100% Corp', account: 'alice' },
		],
	])('saves %s under the name the server will keep', async (_label, uri, expected) => {
		const { api, sentNames } = createHarness();
		api.processScannedQRCode(uri);
		await vi.waitFor(() => expect(api.authenticatedFetch).toHaveBeenCalledOnce());
		expect(sentNames()).toEqual([expected]);
	});
});
