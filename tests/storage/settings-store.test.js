import { describe, expect, it, vi } from 'vitest';
import { readSettingsSnapshot, runSecretsOperation } from '../../src/storage/secrets-store.js';
import { createStoreEnv, jsonRequest } from '../helpers/store-fakes.js';

const OLD_CODE = '<style id="old-custom-code">body { color: red; }</style>';
const NEW_CODE = '<style id="new-custom-code">body { color: blue; }</style>';
const customCodes = [{ id: 'theme', name: 'Theme', enabled: true, code: NEW_CODE }];

const save = (env, body) => runSecretsOperation('settings.save', jsonRequest('/api/settings', body), env);
const read = (env) => runSecretsOperation('settings.get', jsonRequest('/api/settings', undefined, 'GET'), env);

describe('settings in the secrets store', () => {
	it('keeps saved code through stale reads, object eviction and a later language-only save', async () => {
		const env = createStoreEnv();
		const oldSettings = JSON.stringify({ customCode: OLD_CODE, language: 'en', maxBackups: 25 });
		await env.SECRETS_KV.put('settings', oldSettings);
		expect((await save(env, { customCodes })).status).toBe(200);
		env.SECRETS_STORE.evict();

		env.SECRETS_KV.serveStale('settings', oldSettings);
		const response = await read(env);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ customCodes, customCode: NEW_CODE, language: 'en', maxBackups: 25 });

		env.SECRETS_KV.serveStale('settings', oldSettings);
		const updated = await save(env, { language: 'fr' });
		expect(updated.status).toBe(200);
		expect((await updated.json()).settings).toMatchObject({ customCodes, customCode: NEW_CODE, language: 'fr', maxBackups: 25 });
		expect(JSON.parse(env.SECRETS_KV.store.get('settings').value)).toMatchObject({ customCodes, customCode: NEW_CODE, language: 'fr' });
	});

	it('preserves concurrent code and preference updates', async () => {
		const env = createStoreEnv();
		const responses = await Promise.all([save(env, { customCodes }), save(env, { language: 'fr' })]);
		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		expect(await readSettingsSnapshot(env)).toMatchObject({ customCodes, customCode: NEW_CODE, language: 'fr' });
	});

	it.each(['settings.get', 'settings.save'])('does not fall back to KV when %s cannot reach the configured store', async (operation) => {
		const env = createStoreEnv();
		await env.SECRETS_KV.put('settings', JSON.stringify({ customCode: OLD_CODE }));
		env.SECRETS_STORE.failFetch = new Error('Durable Object unavailable');
		const get = vi.spyOn(env.SECRETS_KV, 'get');
		const put = vi.spyOn(env.SECRETS_KV, 'put');
		const request =
			operation === 'settings.get' ? jsonRequest('/api/settings', undefined, 'GET') : jsonRequest('/api/settings', { customCodes });
		const response = await runSecretsOperation(operation, request, env);
		expect(response.status).toBe(503);
		expect(get).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
		expect(await response.text()).not.toContain(OLD_CODE);
		await expect(readSettingsSnapshot(env)).rejects.toThrow('Durable Object unavailable');
		expect(get).not.toHaveBeenCalled();
	});

	it('continues saving and reading settings without the Durable Object binding', async () => {
		const env = createStoreEnv({ withStore: false });
		const responses = await Promise.all([save(env, { customCodes }), save(env, { language: 'fr' })]);
		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		expect(await (await read(env)).json()).toMatchObject({ customCodes, language: 'fr' });
		expect(await readSettingsSnapshot(env)).toMatchObject({ customCodes, language: 'fr' });
	});

	it('spaces settings writes without delaying unrelated secret reads', async () => {
		vi.useFakeTimers();
		try {
			const env = createStoreEnv();
			const writeTimes = [];
			env.SECRETS_KV.beforeOperation = async (kind, key) => {
				if (kind === 'put' && key === 'settings') {
					writeTimes.push(Date.now());
				}
			};
			expect((await save(env, { customCodes })).status).toBe(200);
			const pendingSave = save(env, { language: 'fr' });
			await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));

			const listed = await runSecretsOperation('secrets.list', jsonRequest('/api/secrets', undefined, 'GET'), env);
			expect(listed.status).toBe(200);
			expect(writeTimes).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1100);
			expect((await pendingSave).status).toBe(200);
			expect(writeTimes).toHaveLength(2);
			expect(writeTimes[1] - writeTimes[0]).toBeGreaterThanOrEqual(1100);
		} finally {
			vi.useRealTimers();
		}
	});
});
