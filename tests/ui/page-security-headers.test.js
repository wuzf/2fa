import { describe, expect, it } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { createSetupPage } from '../../src/ui/setupPage.js';

const pages = [
	['main page', () => createMainPage()],
	['setup page', () => createSetupPage(new Request('https://example.test/setup'))],
];

describe('HTML page security headers', () => {
	it.each(pages)('forbids other sites from framing the %s', async (_name, create) => {
		const response = await create();
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it.each(pages)('keeps the camera and the version check available on the %s', async (_name, create) => {
		const response = await create();
		// The QR scanner needs the camera, and the version check requests the GitHub API.
		expect(response.headers.get('Permissions-Policy')).toBeNull();
		expect(response.headers.get('Content-Security-Policy') || '').not.toContain('connect-src');
	});
});
