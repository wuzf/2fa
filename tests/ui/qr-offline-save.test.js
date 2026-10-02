// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const URI = 'otpauth://totp/Example:alice?issuer=Example&secret=JBSWY3DPEHPK3PXP';

function createHarness(body, status) {
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
	api.authenticatedFetch = vi.fn(async () => ({ ok: true, status, json: async () => body }));
	api.loadSecrets = vi.fn(async () => {});
	api.showCenterToast = vi.fn();
	api.hideQRScanner = vi.fn();
	api.setLanguage('en');
	return api;
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('saving a scanned otpauth code', () => {
	it('reports a code queued by the offline Service Worker as saved for sync, not as added', async () => {
		const api = createHarness({ success: true, queued: true, offline: true, operationId: 1 }, 202);
		api.processScannedQRCode(URI);
		await vi.waitFor(() => expect(api.hideQRScanner).toHaveBeenCalledOnce());

		expect(api.showCenterToast).toHaveBeenLastCalledWith('📥', api.t('coreQueued'));
		expect(api.showCenterToast).not.toHaveBeenCalledWith('✅', expect.anything());
	});

	it('reports a code the server saved as added', async () => {
		const api = createHarness({ success: true, data: { id: '1' } }, 201);
		api.processScannedQRCode(URI);
		await vi.waitFor(() => expect(api.hideQRScanner).toHaveBeenCalledOnce());

		expect(api.showCenterToast).toHaveBeenLastCalledWith('✅', api.t('transferKeyAdded') + 'Example');
	});
});
