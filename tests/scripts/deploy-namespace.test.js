import { describe, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';
import { applyKvBinding, readWorkerNameOverride, resolveKvBinding } from '../../scripts/deploy-namespace.js';

const configured = `name = "vault-app"
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "explicit-production-fixture-id"
[env.development]
name = "vault-app-dev"
[[env.development.kv_namespaces]]
binding = "SECRETS_KV"
id = "explicit-development-fixture-id"
`;
const withoutIds = configured.replace(/^id = .*\n/gm, '');
const namespace = (title, id = 'discovered-fixture-id') => ({ title, id });

describe('deployment KV namespace selection', () => {
	it.each([
		[null, 'explicit-production-fixture-id'],
		['development', 'explicit-development-fixture-id'],
	])('preserves the explicit %s namespace and never lists account-wide namespaces', async (environment, id) => {
		const list = vi.fn(() => {
			throw new Error('Must not inspect account namespaces');
		});
		expect(await resolveKvBinding(configured, environment, list)).toEqual({ kind: 'configured', id });
		expect(list).not.toHaveBeenCalled();
	});

	it('uses TOML structure rather than selecting the first textual KV identifier', async () => {
		const config = `name="vault-app"
kv_namespaces=[{binding="CACHE",id="unrelated-cache"},{binding="SECRETS_KV",id="chosen-vault"}]
[env."development"]
name="vault-app-dev"
kv_namespaces=[{binding="SECRETS_KV",id="chosen-dev-vault"}]
`;
		const list = vi.fn();
		expect(await resolveKvBinding(config, null, list)).toEqual({ kind: 'configured', id: 'chosen-vault' });
		expect(await resolveKvBinding(config, 'development', list)).toEqual({ kind: 'configured', id: 'chosen-dev-vault' });
		expect(list).not.toHaveBeenCalled();
	});

	it.each(['vault-app-secrets-kv', 'vault-app-SECRETS_KV'])('reuses the sole exact current-worker title %s', async (title) => {
		const list = vi.fn(async () => [namespace('another-app-SECRETS_KV', 'other-id'), namespace(title)]);
		expect(await resolveKvBinding(withoutIds, null, list)).toEqual({ kind: 'existing', id: 'discovered-fixture-id', title });
		expect(list).toHaveBeenCalledOnce();
	});

	it('allows synonymous exact titles only when they identify the same namespace', async () => {
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv'), namespace('vault-app-SECRETS_KV')]);
		expect(await resolveKvBinding(withoutIds, null, list)).toMatchObject({ kind: 'existing', id: 'discovered-fixture-id' });
	});

	it('refuses multiple matching namespace IDs instead of choosing the first result', async () => {
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv', 'first-vault'), namespace('vault-app-SECRETS_KV', 'second-vault')]);
		await expect(resolveKvBinding(withoutIds, null, list)).rejects.toThrow();
	});

	it.each([
		'unrelated-only-namespace',
		'secrets-kv',
		'SECRETS_KV',
		'vault-app',
		'vault-app-secrets-kv-extra',
		'other-vault-app-secrets-kv',
		'VAULT-APP-SECRETS-KV',
	])('never adopts an unrelated singleton or weak name match: %s', async (title) => {
		const list = vi.fn(async () => [namespace(title)]);
		expect(await resolveKvBinding(withoutIds, null, list)).toEqual({ kind: 'new' });
	});

	it('keeps development and production discovery isolated by effective worker name', async () => {
		const list = vi.fn(async () => [
			namespace('vault-app-secrets-kv', 'production-vault'),
			namespace('vault-app-dev-secrets-kv', 'development-vault'),
		]);
		expect(await resolveKvBinding(withoutIds, null, list)).toMatchObject({ kind: 'existing', id: 'production-vault' });
		expect(await resolveKvBinding(withoutIds, 'development', list)).toMatchObject({ kind: 'existing', id: 'development-vault' });
	});

	it('does not use top-level explicit IDs when the selected environment omits its ID', async () => {
		const config = configured.replace('id = "explicit-development-fixture-id"', '');
		const list = vi.fn(async () => []);
		expect(await resolveKvBinding(config, 'development', list)).toEqual({ kind: 'new' });
		expect(list).toHaveBeenCalledOnce();
	});

	it.each(['vault-app-secrets-kv-dev', 'vault-app-secrets-kv-development', 'dev-vault-app-SECRETS_KV', 'development-vault-app-SECRETS_KV'])(
		'reuses the exact development-qualified title %s without exposing it to default deployment',
		async (title) => {
			const list = vi.fn(async () => [namespace(title)]);
			expect(await resolveKvBinding(withoutIds, 'development', list)).toEqual({ kind: 'existing', id: 'discovered-fixture-id', title });
			expect(await resolveKvBinding(withoutIds, null, list)).toEqual({ kind: 'new' });
		},
	);

	it('requires an explicit environment worker name or ID instead of inheriting production discovery', async () => {
		const noName = withoutIds.replace('name = "vault-app-dev"', '');
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv')]);
		await expect(resolveKvBinding(noName, 'development', list)).rejects.toThrow();
		expect(list).not.toHaveBeenCalled();
		const withId = configured.replace('name = "vault-app-dev"', '');
		expect(await resolveKvBinding(withId, 'development', list)).toEqual({ kind: 'configured', id: 'explicit-development-fixture-id' });
		expect(list).not.toHaveBeenCalled();
	});

	it('returns new only after a successful empty namespace listing', async () => {
		expect(await resolveKvBinding(withoutIds, null, async () => [])).toEqual({ kind: 'new' });
		await expect(
			resolveKvBinding(withoutIds, null, async () => {
				throw new Error('Cloudflare authentication failed');
			}),
		).rejects.toThrow();
	});

	it.each([
		['missing selected environment', configured, 'staging'],
		[
			'missing environment KV binding',
			'name="vault-app"\n[[kv_namespaces]]\nbinding="SECRETS_KV"\nid="production"\n[env.development]\nname="vault-app-dev"',
			'development',
		],
		['missing production binding', 'name="vault-app"\n[[kv_namespaces]]\nbinding="CACHE"\nid="cache-only"', null],
		['duplicate production binding', 'name="vault-app"\nkv_namespaces=[{binding="SECRETS_KV",id="a"},{binding="SECRETS_KV",id="b"}]', null],
		[
			'duplicate environment binding',
			'name="vault-app"\n[env.development]\nname="vault-app-dev"\nkv_namespaces=[{binding="SECRETS_KV",id="a"},{binding="SECRETS_KV",id="a"}]',
			'development',
		],
		['explicit empty ID', configured.replace('explicit-production-fixture-id', ''), null],
		['explicit whitespace ID', configured.replace('explicit-production-fixture-id', '   '), null],
		['numeric ID', configured.replace('"explicit-production-fixture-id"', '123'), null],
		['invalid TOML', 'name = [', null],
	])('fails before namespace discovery for %s', async (_label, config, environment) => {
		const list = vi.fn(async () => []);
		await expect(resolveKvBinding(config, environment, list)).rejects.toThrow();
		expect(list).not.toHaveBeenCalled();
	});

	it.each([
		null,
		{},
		{ result: [] },
		'[]',
		[null],
		[{}],
		[{ title: 'vault-app-secrets-kv' }],
		[{ title: 'unrelated', id: '' }],
		[{ title: '', id: 'id' }],
		[{ title: '   ', id: 'id' }],
		[{ title: 123, id: 'id' }],
	])('refuses malformed namespace results instead of treating them as absence: %j', async (result) => {
		await expect(resolveKvBinding(withoutIds, null, async () => result)).rejects.toThrow();
	});
});

describe('Workers Builds connected Worker name', () => {
	it.each([
		[{}, undefined],
		[{ WRANGLER_CI_OVERRIDE_NAME: 'connected-vault' }, 'connected-vault'],
		// Wrangler adopts any value that is present, including an empty one.
		[{ WRANGLER_CI_OVERRIDE_NAME: '' }, ''],
	])('reads the override exactly as Wrangler does from %j', (environment, expected) => {
		expect(readWorkerNameOverride(environment)).toBe(expected);
	});

	it('does not adopt the storage of another deployment that uses the configured name', async () => {
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv', 'other-instance-vault')]);
		expect(await resolveKvBinding(withoutIds, null, list, { workerNameOverride: 'my-vault' })).toEqual({ kind: 'new' });
		expect(list).toHaveBeenCalledOnce();
	});

	it.each(['my-vault-secrets-kv', 'my-vault-SECRETS_KV'])('reuses the connected Worker’s own namespace %s', async (title) => {
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv', 'other-instance-vault'), namespace(title, 'own-vault')]);
		expect(await resolveKvBinding(withoutIds, null, list, { workerNameOverride: 'my-vault' })).toEqual({
			kind: 'existing',
			id: 'own-vault',
			title,
		});
	});

	it('uses the override for an environment without its own name, because it is the exact deployed name', async () => {
		const noName = withoutIds.replace('name = "vault-app-dev"', '');
		const list = vi.fn(async () => [
			namespace('vault-app-secrets-kv', 'production-vault'),
			namespace('my-vault-dev-secrets-kv', 'dev-vault'),
		]);
		expect(await resolveKvBinding(noName, 'development', list, { workerNameOverride: 'my-vault-dev' })).toMatchObject({
			kind: 'existing',
			id: 'dev-vault',
		});
	});

	it('uses the override instead of the environment name from the configuration', async () => {
		const list = vi.fn(async () => [namespace('vault-app-dev-secrets-kv', 'configured-name-vault')]);
		expect(await resolveKvBinding(withoutIds, 'development', list, { workerNameOverride: 'my-vault-dev' })).toEqual({ kind: 'new' });
	});

	it.each(['', '   '])('stops before listing namespaces when the override is blank (%j)', async (workerNameOverride) => {
		const list = vi.fn(async () => [namespace('vault-app-secrets-kv')]);
		await expect(resolveKvBinding(withoutIds, null, list, { workerNameOverride })).rejects.toThrow('WRANGLER_CI_OVERRIDE_NAME');
		expect(list).not.toHaveBeenCalled();
	});

	it('still keeps an explicit configured ID without listing namespaces', async () => {
		const list = vi.fn();
		expect(await resolveKvBinding(configured, null, list, { workerNameOverride: 'my-vault' })).toEqual({
			kind: 'configured',
			id: 'explicit-production-fixture-id',
		});
		expect(list).not.toHaveBeenCalled();
	});
});

describe('inserting a discovered namespace into exactly the selected TOML binding', () => {
	const existing = { kind: 'existing', id: 'selected-fixture-id', title: 'vault-app-SECRETS_KV' };
	it.each(['configured', 'new'])('preserves the complete original text for %s resolution', (kind) => {
		expect(applyKvBinding(configured, null, { kind, id: 'should-not-replace-explicit-id' })).toBe(configured);
	});

	it('handles single-quoted inline arrays without replacing other environment or unrelated KV data', () => {
		const source = `name='vault-app'
kv_namespaces=[{binding='CACHE',id='cache-id'},{binding='SECRETS_KV'}]
[vars]
NOTE='unchanged business setting'
[env.development]
name='vault-app-dev'
kv_namespaces=[{binding='SECRETS_KV',id='development-id'}]
`;
		const result = parse(applyKvBinding(source, null, existing));
		const expected = parse(source);
		expected.kv_namespaces[1].id = existing.id;
		expect(result).toEqual(expected);
	});

	it('adds the environment ID while preserving production and sibling environment IDs', () => {
		const source =
			configured.replace('id = "explicit-development-fixture-id"', '') +
			`
[env.staging]
name="vault-app-staging"
kv_namespaces=[{binding="SECRETS_KV",id="staging-fixture-id"}]
`;
		const result = parse(applyKvBinding(source, 'development', existing));
		const expected = parse(source);
		expected.env.development.kv_namespaces[0].id = existing.id;
		expect(result).toEqual(expected);
	});

	it('never overwrites an explicit ID even if a stale discovery result matches it', () => {
		expect(() => applyKvBinding(configured, null, existing)).toThrow();
		expect(() => applyKvBinding(configured, null, { ...existing, id: 'explicit-production-fixture-id' })).toThrow();
	});

	it.each([
		[withoutIds, 'missing'],
		['name="vault-app"', null],
		['name="vault-app"\nkv_namespaces=[{binding="SECRETS_KV"},{binding="SECRETS_KV"}]', null],
	])('refuses changed or ambiguous target binding configuration', (source, environment) => {
		expect(() => applyKvBinding(source, environment, existing)).toThrow();
	});

	it.each(['', '   ', 123, undefined])('rejects an invalid discovered ID: %s', (id) => {
		expect(() => applyKvBinding(withoutIds, null, { ...existing, id })).toThrow();
	});
});
