import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/router/handler.js';
import { runSecretsOperation, SECRETS_STORE_OPERATION_HEADER } from '../../src/storage/secrets-store.js';
import { createStoreEnv, jsonRequest } from '../helpers/store-fakes.js';

const ORIGIN = 'https://vault.example';
const CUSTOM_CODE =
	'<style id="saved-custom-style">body { color: rebeccapurple; }</style><script id="saved-custom-script">window.savedCustomCode = true;</script>';

function fixture({ settings = JSON.stringify({ customCode: CUSTOM_CODE }), setupRequired = false, readError = null } = {}) {
	const get = vi.fn(async (key) => {
		if (key === 'user_password') {
			return setupRequired ? null : 'password-hash';
		}
		if (key === 'settings') {
			if (readError) {
				throw readError;
			}
			return settings;
		}
		return null;
	});
	const put = vi.fn();
	const env = { SECRETS_KV: { get, put }, LOG_LEVEL: 'ERROR' };
	const call = (path = '/', options) => handleRequest(new Request(ORIGIN + path, options), env);
	return { call, get, put };
}

describe('custom code homepage routing', () => {
	it('loads the site customization on the public homepage', async () => {
		const h = fixture();
		const response = await h.call();

		expect(response.status).toBe(200);
		expect(await response.text()).toContain(CUSTOM_CODE);
		expect(h.get).toHaveBeenCalledWith('settings');
	});

	it('renders current stored code even when KV returns an older version', async () => {
		const env = createStoreEnv();
		await env.SECRETS_KV.put('user_password', 'password-hash');
		const oldSettings = JSON.stringify({ customCode: '<style id="old-custom-style">body{color:red}</style>' });
		await env.SECRETS_KV.put('settings', oldSettings);
		const saved = await runSecretsOperation('settings.save', jsonRequest('/api/settings', { customCode: CUSTOM_CODE }), env);
		expect(saved.status).toBe(200);
		env.SECRETS_KV.serveStale('settings', oldSettings);

		const html = await (await handleRequest(new Request(ORIGIN + '/'), env)).text();
		expect(html).toContain(CUSTOM_CODE);
		expect(html).not.toContain('id="old-custom-style"');
		expect(env.SECRETS_STORE.requests.at(-1).headers.get(SECRETS_STORE_OPERATION_HEADER)).toBe('settings.get');
		const requestCount = env.SECRETS_STORE.requests.length;
		const recovery = await (await handleRequest(new Request(ORIGIN + '/?disableCustomCode=1'), env)).text();
		expect(recovery).not.toContain(CUSTOM_CODE);
		expect(env.SECRETS_STORE.requests).toHaveLength(requestCount);
	});

	it('keeps the homepage usable without stale custom code when the store is unavailable', async () => {
		const env = createStoreEnv();
		await env.SECRETS_KV.put('user_password', 'password-hash');
		await env.SECRETS_KV.put('settings', JSON.stringify({ customCode: CUSTOM_CODE }));
		env.SECRETS_STORE.failFetch = new Error('Durable Object unavailable');
		const response = await handleRequest(new Request(ORIGIN + '/'), env);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('id="settingsModal"');
		expect(html).not.toContain(CUSTOM_CODE);
	});

	it('bypasses settings storage in recovery mode without changing stored code', async () => {
		const h = fixture({ readError: new Error('Storage unavailable') });
		const response = await h.call('/?disableCustomCode=1');

		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain(CUSTOM_CODE);
		expect(h.get).not.toHaveBeenCalledWith('settings');
		expect(h.put).not.toHaveBeenCalled();
	});

	it('applies per-item switches and preserves the enabled snippets order', async () => {
		const first = '<style id="first-custom-style">body{color:blue}</style>';
		const last = '<script id="last-custom-script">window.lastCustom=true</script>';
		const h = fixture({
			settings: JSON.stringify({
				customCode: CUSTOM_CODE,
				customCodes: [
					{ id: 'first', name: 'First', enabled: true, code: first },
					{ id: 'disabled', name: 'Disabled', enabled: false, code: CUSTOM_CODE },
					{ id: 'last', name: 'Last', enabled: true, code: last },
				],
			}),
		});
		const html = await (await h.call()).text();
		expect(html).toContain(first + '\n' + last);
		expect(html).not.toContain(CUSTOM_CODE);
		const recovery = await (await h.call('/?disableCustomCode=1')).text();
		expect(recovery).not.toContain(first);
		expect(recovery).not.toContain(last);
	});

	it.each(['', '0', 'true'])('only disables code for the explicit value 1, not "%s"', async (value) => {
		const response = await fixture().call('/?disableCustomCode=' + value);
		expect(await response.text()).toContain(CUSTOM_CODE);
	});

	it('keeps the homepage available when settings storage fails', async () => {
		const response = await fixture({ readError: new Error('private-storage-error') }).call();
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="settingsModal"');
		expect(html).not.toContain(CUSTOM_CODE);
		expect(html).not.toContain('private-storage-error');
	});

	it.each(['not-json', 'null', '[]', '{"customCode":{"unexpected":"object"}}'])('ignores damaged settings: %s', async (settings) => {
		const response = await fixture({ settings }).call();
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain(CUSTOM_CODE);
	});

	it.each(['/setup', '/otp/JBSWY3DPEHPK3PXP'])('does not inject code into %s', async (path) => {
		const h = fixture({ setupRequired: path === '/setup' });
		const response = await h.call(path);

		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain(CUSTOM_CODE);
		expect(h.get).not.toHaveBeenCalledWith('settings');
	});

	it.each(['GET', 'POST'])('keeps settings %s authenticated even with the recovery query', async (method) => {
		const h = fixture();
		const response = await h.call('/api/settings?disableCustomCode=1', {
			method,
			headers: { 'Content-Type': 'application/json' },
			...(method === 'POST' ? { body: JSON.stringify({ customCode: '<script>untrusted()</script>' }) } : {}),
		});

		expect(response.status).toBe(401);
		expect(h.get).not.toHaveBeenCalledWith('settings');
		expect(h.put).not.toHaveBeenCalled();
	});

	it.each(['GET', 'POST'])('authenticates settings %s before forwarding to a configured store', async (method) => {
		const env = createStoreEnv();
		await env.SECRETS_KV.put('user_password', 'password-hash');
		const response = await handleRequest(
			new Request(ORIGIN + '/api/settings?disableCustomCode=1', {
				method,
				headers: { 'Content-Type': 'application/json', [SECRETS_STORE_OPERATION_HEADER]: 'settings.get' },
				...(method === 'POST' ? { body: JSON.stringify({ customCode: CUSTOM_CODE }) } : {}),
			}),
			env,
		);
		expect(response.status).toBe(401);
		expect(env.SECRETS_STORE.requests).toHaveLength(0);
		expect(env.SECRETS_KV.store.has('settings')).toBe(false);
	});
});
