// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getQRCodeCode } from '../../src/ui/scripts/qrcode.js';
import { getStateCode } from '../../src/ui/scripts/state.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

const ACCOUNT = {
	id: 'a',
	name: '   ',
	account: 'alice',
	secret: 'JBSWY3DPEHPK3PXP',
	type: 'TOTP',
	digits: 6,
	period: 30,
	algorithm: 'SHA1',
};

// The real page scripts; the QR image, dialogs and toasts are stubbed.
function createHarness({ withCore = true } = {}) {
	localStorage.setItem('language', 'zh-CN');
	document.body.innerHTML =
		'<div id="qrModal" style="display:none"><h2 id="qrTitle"></h2><p id="qrSubtitle"></p><div class="qr-code-container"></div></div>';
	const confirm = vi.fn(async () => false);
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'localStorage',
		'navigator',
		'console',
		'setInterval',
		'confirmDialog',
		`
		${getI18nCode()}${getSharedTransferMessageLocalizerCode()}${getUtilsCode()}${getStateCode()}
		${withCore ? getCoreCode() : ''}
		${getQRCodeCode()}
		disableBodyScroll = () => {};
		showConfirmDialog = confirmDialog;
		generateQRCodeDataURL = async () => 'data:image/png;base64,fixture';
		return { showQRCode, deleteSecret: typeof deleteSecret === 'function' ? deleteSecret : null,
			setSecrets(value) { secrets = value; }, getURI: () => currentOTPAuthURL };
	`,
	)(document, window, localStorage, { language: 'zh-CN' }, { log() {}, warn() {}, error() {} }, vi.fn(), confirm);
	api.setSecrets([{ ...ACCOUNT }]);
	return { ...api, confirm };
}

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

describe('accounts saved with a blank name', () => {
	it('names the account in the delete confirmation like its card', async () => {
		const h = createHarness();
		await h.deleteSecret('a');

		expect(h.confirm).toHaveBeenCalledOnce();
		const [options] = h.confirm.mock.calls[0];
		expect(options.message).toContain('未命名');
		expect(options.i18n.params).toEqual({ name: '未命名' });
	});

	it.each([true, false])('titles the QR code and labels its URI like the card (page scripts loaded: %s)', (withCore) => {
		const h = createHarness({ withCore });
		h.showQRCode('a');

		expect(document.getElementById('qrTitle').textContent).toContain('未命名');
		const uri = new URL(h.getURI());
		expect(decodeURIComponent(uri.pathname)).toBe('/未命名:alice');
		expect(uri.searchParams.get('issuer')).toBe('未命名');
	});
});
