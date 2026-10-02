// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const SECRET = 'JBSWY3DPEHPK3PXP';

// Real QR scan code; only the network and timers are stubbed.
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
		status: 201,
		json: async () => ({ success: true }),
	}));
	api.loadSecrets = vi.fn(async () => {});
	api.showCenterToast = vi.fn();
	api.hideQRScanner = vi.fn();
	api.disableBodyScroll = vi.fn();
	api.enableBodyScroll = vi.fn();
	api.setLanguage('en');
	return {
		api,
		savedSecret: () => JSON.parse(api.authenticatedFetch.mock.calls[0][1].body),
	};
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('scanned otpauth type', () => {
	it('saves an otpauth://hotp/ code as HOTP with its counter', async () => {
		const { api, savedSecret } = createHarness();
		api.processScannedQRCode(`otpauth://hotp/Example:alice?secret=${SECRET}&issuer=Example&counter=7&digits=8&algorithm=SHA256`);
		await vi.waitFor(() => expect(api.authenticatedFetch).toHaveBeenCalledOnce());
		expect(savedSecret()).toMatchObject({ name: 'Example', account: 'alice', type: 'HOTP', counter: 7, digits: 8, algorithm: 'SHA256' });
	});

	it('keeps saving an otpauth://totp/ code as TOTP', async () => {
		const { api, savedSecret } = createHarness();
		api.processScannedQRCode(`otpauth://totp/Example:alice?secret=${SECRET}&issuer=Example&period=60`);
		await vi.waitFor(() => expect(api.authenticatedFetch).toHaveBeenCalledOnce());
		expect(savedSecret()).toMatchObject({ name: 'Example', account: 'alice', type: 'TOTP', period: 60 });
	});
});
