import vm from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { getStandaloneHead, getStandaloneI18nScript } from '../../src/ui/standalone.js';
import { createOAuthPopupResponse } from '../../src/utils/oauth.js';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';

const appearance = {
	manifest: {
		tokens: { light: { '--2fa-accent': '#654321' }, dark: { '--2fa-accent': '#abcdef' } },
		settings: [{ key: 'size', type: 'number', default: 15, binding: { type: 'variable', name: '--2fa-font-size', unit: 'px' } }],
	},
	settings: { size: 17 },
	css: '.public-theme { color: rebeccapurple; }',
};

describe('appearance on standalone pages', () => {
	it('shares public colors and fonts with OTP entry and code pages under the fixed product name', async () => {
		for (const response of [
			createOtpEntryPage(new Request('https://example.com/otp?lang=en'), appearance),
			createQuickOtpPage('123456', { appearance }),
		]) {
			const html = await response.text();
			expect(html).toContain('--2fa-accent:#654321');
			expect(html).toContain('--2fa-font-size:17px');
			expect(html).toContain('.public-theme');
			expect(html).toContain('<span>2FA</span>');
			expect(html).not.toContain('/theme-assets/');
			expect(html).not.toContain('appearance-layout');
		}
	});

	it('keeps the translated title across language changes', async () => {
		const window = new Window({ url: 'https://example.com/otp?lang=en' });
		window.document.write(await createOtpEntryPage(undefined, appearance).text());
		const context = vm.createContext({
			window,
			document: window.document,
			navigator: { languages: ['en'] },
			localStorage: window.localStorage,
			location: window.location,
			URL,
		});
		vm.runInContext(getStandaloneI18nScript({ titleKey: 'otpEntryPageTitle' }), context);
		expect(window.document.title).toBe('OTP Generator - 2FA');
		context.changeStandaloneLanguage('zh-CN');
		expect(window.document.title).toContain('2FA');
		expect(window.document.querySelector('.otp-brand span').textContent).toBe('2FA');
		await window.happyDOM.close();
	});

	it('keeps theme CSS out of setup and OAuth result pages', async () => {
		const request = new Request('https://example.com/?lang=en');
		for (const response of [
			await createSetupPage(request, appearance),
			createOAuthPopupResponse(request, { success: true, provider: 'onedrive' }, appearance),
		]) {
			const html = await response.text();
			expect(html).not.toContain('.public-theme');
			expect(html).not.toContain('/theme-assets/');
			expect(html).not.toContain('application-name');
		}
	});

	it('never adds instance resources to the default standalone head used by exported backups', () => {
		expect(getStandaloneHead('Backup')).not.toContain('/theme-assets/');
		expect(getStandaloneHead('Backup')).not.toContain('Personal');
	});

	it('reads no appearance data on the public JSON OTP API', async () => {
		const read = vi.fn(() => {
			throw new Error('unexpected appearance read');
		});
		const response = await handleGenerateOTP('JBSWY3DPEHPK3PXP', new Request('https://example.com/otp/JBSWY3DPEHPK3PXP?format=json'), {
			SECRETS_STORE: { idFromName: read },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toHaveProperty('token');
		expect(read).not.toHaveBeenCalled();
	});
});
