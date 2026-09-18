import { describe, expect, it, vi } from 'vitest';

import { createOAuthPopupResponse, createOAuthState, extractOAuthStatePreview } from '../../src/utils/oauth.js';

describe('OAuth Utils', () => {
	it.each([
		{ success: true, severity: 'success', status: 200 },
		{ success: true, severity: 'warning', status: 200 },
		{ success: false, severity: 'error', status: 400 },
	])('should notify and close the styled $severity callback', async ({ success, severity, status }) => {
		const response = createOAuthPopupResponse(new Request('https://callback.example.com/api/gdrive/oauth/callback'), {
			success,
			severity,
			provider: 'gdrive',
			appOrigin: 'https://app.example.com/settings',
			message: 'Authorization result',
		});
		const html = await response.text();
		const popup = { opener: { closed: false, postMessage: vi.fn() }, close: vi.fn() };
		const callbackScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)[1];
		// eslint-disable-next-line no-new-func
		new Function('window', callbackScript)(popup);

		expect(response.status).toBe(status);
		expect(popup.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
			{ type: 'cloudBackupAuthComplete', success, severity, provider: 'gdrive', message: 'Authorization result' },
			'https://app.example.com',
		);
		expect(popup.close).toHaveBeenCalledOnce();
	});

	it('should retain a usable return link without an open parent window', async () => {
		const response = createOAuthPopupResponse(new Request('https://callback.example.com/api/onedrive/oauth/callback'), {
			success: false,
			provider: 'onedrive',
			appOrigin: 'invalid-url',
		});
		const html = await response.text();
		const popup = { opener: null, close: vi.fn() };
		const callbackScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)[1];
		// eslint-disable-next-line no-new-func
		new Function('window', callbackScript)(popup);

		expect(popup.close).not.toHaveBeenCalled();
		expect(html).toContain('href="https://callback.example.com/"');
	});

	it('should post popup results back to the original app origin when provided', async () => {
		const request = new Request('https://callback.example.com/api/gdrive/oauth/callback', {
			headers: {
				Origin: 'https://callback.example.com',
			},
		});

		const response = createOAuthPopupResponse(request, {
			success: true,
			provider: 'gdrive',
			appOrigin: 'https://app.example.com',
			message: 'OAuth completed',
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('const targetOrigin = "https://app.example.com"');
		expect(html).toContain('href="https://app.example.com/"');
	});

	it('should serialize popup payload safely inside inline scripts', async () => {
		const request = new Request('https://callback.example.com/api/gdrive/oauth/callback', {
			headers: {
				Origin: 'https://callback.example.com',
			},
		});

		const response = createOAuthPopupResponse(request, {
			success: false,
			provider: 'gdrive',
			message: '</script><script>alert(1)</script>',
		});
		const html = await response.text();

		expect(response.status).toBe(400);
		expect(html).toContain('\\u003C/script\\u003E\\u003Cscript\\u003Ealert(1)\\u003C/script\\u003E');
		expect(html).not.toContain(
			'const payload = {"type":"cloudBackupAuthComplete","success":false,"provider":"gdrive","message":"</script><script>alert(1)</script>"};',
		);
	});

	it('should recover a signed app origin preview from OAuth state without reading KV', async () => {
		const env = {
			GOOGLE_DRIVE_CLIENT_SECRET: 'test-google-secret',
			SECRETS_KV: {
				put: async () => {},
			},
		};
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: 'dest-1',
			appOrigin: 'https://app.example.com/path?ignored=yes',
		});

		const preview = await extractOAuthStatePreview(env, state, 'gdrive');

		expect(preview).toEqual({
			provider: 'gdrive',
			configId: 'dest-1',
			appOrigin: 'https://app.example.com',
			createdAt: expect.any(String),
		});
	});
});
