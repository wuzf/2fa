import { describe, expect, it } from 'vitest';
import {
	deleteInactiveHOTPCounterStates,
	getHOTPCounterStateKey,
	HOTP_COUNTER_EPOCH_KEY,
	saveHOTPCounterState,
} from '../../src/api/secrets/counter-state.js';
import { cleanupHOTPCounterStates, runSecretsOperation } from '../../src/storage/secrets-store.js';
import { createStoreEnv, FakeKV, jsonRequest } from '../helpers/store-fakes.js';

const HOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('deleteInactiveHOTPCounterStates', () => {
	it('keeps the records the stored secrets read and deletes the others', async () => {
		const env = { SECRETS_KV: new FakeKV() };
		await env.SECRETS_KV.put(HOTP_COUNTER_EPOCH_KEY, 'e2');
		const secrets = [
			{ id: 'plain', type: 'HOTP', secret: HOTP_SECRET },
			{ id: 'edited', type: 'HOTP', secret: HOTP_SECRET, hotpCounterNamespace: 'ns-new' },
			{ id: 'totp', type: 'TOTP', secret: HOTP_SECRET },
		];
		const keep = [getHOTPCounterStateKey('plain', 'e2'), getHOTPCounterStateKey('edited', 'e2', 'ns-new')];
		const remove = [
			getHOTPCounterStateKey('plain', 'e1'), // earlier epoch
			getHOTPCounterStateKey('edited', 'e2', 'ns-old'), // replaced by an edit
			getHOTPCounterStateKey('edited', 'e2'), // before the record had a namespace
			getHOTPCounterStateKey('deleted', 'e2'), // secret no longer stored
			getHOTPCounterStateKey('totp', 'e2'), // no longer HOTP
		];
		for (const key of [...keep, ...remove]) {
			await env.SECRETS_KV.put(key, '{}');
		}
		await env.SECRETS_KV.put('secrets', '[]');

		expect(await deleteInactiveHOTPCounterStates(env, secrets)).toBe(remove.length);
		expect([...env.SECRETS_KV.store.keys()].sort()).toEqual([...keep, HOTP_COUNTER_EPOCH_KEY, 'secrets'].sort());
	});

	it('reads every page of the key list', async () => {
		const kv = new FakeKV();
		const keys = ['hotp-counter:legacy:a', 'hotp-counter:legacy:b', 'hotp-counter:legacy:c'];
		for (const key of keys) {
			await kv.put(key, '{}');
		}
		const pages = [];
		let names;
		kv.list = async ({ prefix, cursor }) => {
			pages.push(cursor ?? null);
			// A cursor continues the listing it came from, like the real KV cursor.
			names = cursor ? names : [...kv.store.keys()].filter((name) => name.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const done = start + 2 >= names.length;
			return { keys: names.slice(start, start + 2).map((name) => ({ name })), list_complete: done, cursor: done ? '' : String(start + 2) };
		};
		expect(await deleteInactiveHOTPCounterStates({ SECRETS_KV: kv }, [])).toBe(3);
		expect(pages).toEqual([null, '2']);
	});
});

describe('cleanupHOTPCounterStates', () => {
	it('removes the record of a replaced generation through the store and keeps the counter', async () => {
		const env = createStoreEnv();
		const added = await runSecretsOperation('secrets.add', jsonRequest('/api/secrets', { name: 'Bank', secret: HOTP_SECRET, type: 'HOTP', counter: 0 }), env);
		const secret = (await added.json()).data.secret;
		const advance = (current) =>
			runSecretsOperation(
				'secrets.counter',
				jsonRequest(`/api/secrets/${secret.id}/counter`, {
					expectedCounter: current.counter,
					expectedSecret: current.secret,
					expectedDigits: current.digits,
					expectedAlgorithm: current.algorithm,
					expectedNamespace: current.hotpCounterNamespace ?? null,
				}),
				env,
			);
		expect((await advance(secret)).status).toBe(200);
		const oldKey = getHOTPCounterStateKey(secret.id, 'legacy');
		expect(env.SECRETS_KV.store.has(oldKey)).toBe(true);

		// Changing the digits starts a new generation with its own record.
		const edited = await runSecretsOperation(
			'secrets.update',
			jsonRequest(`/api/secrets/${secret.id}`, { name: 'Bank', secret: HOTP_SECRET, type: 'HOTP', digits: 8, counter: 5 }, 'PUT'),
			env,
		);
		const current = (await edited.json()).data.secret;
		expect((await advance(current)).status).toBe(200);
		const newKey = getHOTPCounterStateKey(secret.id, 'legacy', current.hotpCounterNamespace);

		expect(await cleanupHOTPCounterStates(env)).toBe(1);
		expect(env.SECRETS_KV.store.has(oldKey)).toBe(false);
		expect(env.SECRETS_KV.store.has(newKey)).toBe(true);
		const [listed] = await (await runSecretsOperation('secrets.list', new Request('https://2fa.example.com/api/secrets'), env)).json();
		expect(listed.counter).toBe(6);
	});

	it('does nothing without the store', async () => {
		const env = createStoreEnv({ withStore: false });
		await saveHOTPCounterState(env, { id: 'gone', secret: HOTP_SECRET }, 3);
		expect(await cleanupHOTPCounterStates(env)).toBeNull();
		expect(env.SECRETS_KV.store.size).toBe(1);
	});
});
