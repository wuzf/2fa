import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createSetupPage } from '../../src/ui/setupPage.js';

const html = await (await createSetupPage()).text();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

function createHarness({ browserLanguage, savedLanguage = null }) {
	const elements = new Map(
		['setupLangSelect', 'setupTitle', 'password', 'confirmPassword', 'submitButton', 'successMessage'].map((id) => [
			id,
			{ value: '', textContent: '', placeholder: '', style: {} },
		]),
	);
	const document = { documentElement: { setAttribute: vi.fn() }, getElementById: (id) => elements.get(id) };
	const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
	const context = createContext({
		document,
		fetch,
		setTimeout: vi.fn(),
		localStorage: { getItem: (key) => (key === 'language' ? savedLanguage : null), setItem: vi.fn() },
		navigator: { languages: [browserLanguage], language: browserLanguage },
		window: { isSecureContext: true, matchMedia: () => ({ matches: false }), addEventListener: vi.fn() },
	});
	for (const script of scripts) {
		runInContext(script, context);
	}
	return { document, elements, api: context, fetch };
}

describe('setup page language detection', () => {
	it.each([
		['en-US', 'en'],
		['en', 'en'],
		['zh-TW', 'zh-TW'],
		['zh-HK', 'zh-TW'],
		['zh-Hant', 'zh-TW'],
		['zh-CN', 'zh-CN'],
		['fr-FR', 'fr'],
		['unsupported', 'en'],
	])('uses %s from the browser to select %s', (browserLanguage, expectedLanguage) => {
		const h = createHarness({ browserLanguage });
		expect(h.document.documentElement.lang).toBe(expectedLanguage);
		expect(h.elements.get('setupLangSelect').value).toBe(expectedLanguage);
	});

	it('translates the initial setup form for English browsers', () => {
		const h = createHarness({ browserLanguage: 'en-US' });
		expect(h.elements.get('setupTitle').textContent).toBe('Set Admin Password');
		expect(h.document.title).toBe('Initial Setup - 2FA Authenticator');
	});

	it('prefers an explicitly saved language over browser detection', () => {
		const h = createHarness({ browserLanguage: 'en-US', savedLanguage: 'zh-TW' });
		expect(h.document.documentElement.lang).toBe('zh-TW');
		expect(h.elements.get('setupLangSelect').value).toBe('zh-TW');
	});

	it.each([
		{ browserLanguage: 'zh-CN', selectedLanguage: 'en', expectedLanguage: 'en' },
		{ browserLanguage: 'zh-CN', savedLanguage: 'zh-TW', expectedLanguage: 'zh-TW' },
		{ browserLanguage: 'en-US', expectedLanguage: 'auto' },
	])('submits the language preference with setup: $expectedLanguage', async (options) => {
		const h = createHarness(options);
		if (options.selectedLanguage) {
			h.api.changeSetupLanguage(options.selectedLanguage);
		}
		h.elements.get('password').value = 'StrongPass1!';
		h.elements.get('confirmPassword').value = 'StrongPass1!';
		await h.api.handleSetup({ preventDefault: vi.fn() });
		expect(h.fetch).toHaveBeenCalledOnce();
		const [url, request] = h.fetch.mock.calls[0];
		expect(url).toBe('/api/setup');
		expect(JSON.parse(request.body)).toEqual({
			password: 'StrongPass1!',
			confirmPassword: 'StrongPass1!',
			language: options.expectedLanguage,
		});
	});
});
