import vm from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { getStandaloneHead, getStandaloneI18nScript } from '../../src/ui/standalone.js';
import { createOAuthPopupResponse } from '../../src/utils/oauth.js';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';

const hash = 'a'.repeat(64);
const appearance = {
	branding: {
		name: 'Personal <2FA>',
		description: 'My authenticator',
		logo: `/theme-assets/${hash}/logo.png`,
		icon192: `/theme-assets/${hash}/icon.png`,
	},
	manifest: {
		tokens: { light: { '--2fa-accent': '#654321' }, dark: { '--2fa-accent': '#abcdef' } },
		settings: [{ key: 'size', type: 'number', default: 15, binding: { type: 'variable', name: '--2fa-font-size', unit: 'px' } }],
	},
	settings: { size: 17 },
	css: '.public-theme { color: rebeccapurple; }',
	customCss: 'body { letter-spacing: .02em; }',
};

describe('appearance on standalone pages', () => {
	it('shares public colors, fonts and safe brand assets with OTP entry and code pages', async () => {
		for (const response of [
			createOtpEntryPage(new Request('https://example.com/otp?lang=en'), appearance),
			createQuickOtpPage('123456', { appearance }),
		]) {
			const html = await response.text();
			expect(html).toContain('--2fa-accent:#654321');
			expect(html).toContain('--2fa-font-size:17px');
			expect(html).toContain('.public-theme');
			expect(html).toContain('letter-spacing: .02em');
			expect(html).toContain(`/theme-assets/${hash}/logo.png`);
			expect(html).toContain('Personal &lt;2FA&gt;');
			expect(html).not.toContain('appearance-layout');
		}
	});

	it('preserves the brand title across language changes without interpreting markup', async () => {
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
		expect(window.document.title).toBe('OTP Generator - Personal <2FA>');
		context.changeStandaloneLanguage('zh-CN');
		expect(window.document.title).toContain('Personal <2FA>');
		expect(window.document.querySelector('.otp-brand span').textContent).toBe('Personal <2FA>');
		await window.happyDOM.close();
	});

	it('uses only safe brand fields in setup and OAuth result pages', async () => {
		const request = new Request('https://example.com/?lang=en');
		for (const response of [
			await createSetupPage(request, appearance),
			createOAuthPopupResponse(request, { success: true, provider: 'onedrive' }, appearance),
		]) {
			const html = await response.text();
			expect(html).toContain('Personal &lt;2FA&gt;');
			expect(html).toContain(`/theme-assets/${hash}/icon.png`);
			expect(html).not.toContain('.public-theme');
			expect(html).not.toContain('letter-spacing: .02em');
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
