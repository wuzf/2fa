import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleGetSecrets } from '../../src/api/secrets/index.js';
import { ConfigurationError } from '../../src/utils/errors.js';

function createEnv(get = vi.fn().mockResolvedValue(null)) {
	return {
		SECRETS_KV: {
			get,
			list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
		},
		LOG_LEVEL: 'ERROR',
	};
}

function createRequest() {
	return new Request('https://2fa.example.com/api/secrets', {
		headers: {
			Host: '2fa.example.com',
			Origin: 'https://2fa.example.com',
		},
	});
}

function expectSensitiveResponseHeaders(response) {
	expect(response.headers.get('Cache-Control')).toBe('no-store');
	expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
	expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	expect(response.headers.get('Permissions-Policy')).toBe('geolocation=(), microphone=(), camera=()');
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('extension-facing secrets response headers', () => {
	it('sets no-store and security headers on a successful request-aware response', async () => {
		const response = await handleGetSecrets(createEnv(), createRequest());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
		expectSensitiveResponseHeaders(response);
	});

	it('sets no-store and security headers when reading secrets fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = createEnv(vi.fn().mockRejectedValue(new Error('KV unavailable')));

		const response = await handleGetSecrets(env, createRequest());

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ error: '获取密钥列表失败' });
		expectSensitiveResponseHeaders(response);
	});

	it('hardens known application errors without exposing wildcard CORS', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = createEnv(vi.fn().mockRejectedValue(new ConfigurationError('Missing encryption key')));
		const request = new Request('https://2fa.example.com/api/secrets', {
			headers: { Host: '2fa.example.com', Origin: 'https://foreign.example' },
		});
		const response = await handleGetSecrets(env, request);
		expect(response.status).toBe(500);
		expectSensitiveResponseHeaders(response);
		expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
	});

	it('keeps the legacy single-argument call usable', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const response = await handleGetSecrets(createEnv());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});
});
