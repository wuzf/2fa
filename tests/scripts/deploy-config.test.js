import { describe, expect, it } from 'vitest';

import { extractWorkerName, injectKvNamespaceId, injectWorkerVersion } from '../../scripts/deploy-config.js';

describe('injectWorkerVersion', () => {
	it('replaces SW_VERSION without touching KV bindings', () => {
		const config = `name = "2fa"
main = "src/worker.js"

[[kv_namespaces]]
binding = "SECRETS_KV"

[vars]
SW_VERSION = "v1"
`;

		const updated = injectWorkerVersion(config, 'v20260325-123456');

		expect(updated).toContain('SW_VERSION = "v20260325-123456"');
		expect(updated).toContain('[[kv_namespaces]]\nbinding = "SECRETS_KV"');
		expect(updated.match(/\[\[kv_namespaces\]\]/g)).toHaveLength(1);
	});

	it('throws when SW_VERSION is missing', () => {
		expect(() => injectWorkerVersion('[vars]\n', 'v20260325-123456')).toThrow(
			'在 wrangler.toml 中未找到 SW_VERSION 配置'
		);
	});
});

describe('extractWorkerName', () => {
	it('extracts name from config', () => {
		expect(extractWorkerName('name = "2fa"\nmain = "src/worker.js"')).toBe('2fa');
	});

	it('returns null when name is missing', () => {
		expect(extractWorkerName('main = "src/worker.js"')).toBeNull();
	});

	it('extracts env-specific name when envName is provided', () => {
		const config = `name = "2fa"

[env.development]
name = "2fa-dev"

[env.development.vars]
SW_VERSION = "v1"
`;
		expect(extractWorkerName(config, 'development')).toBe('2fa-dev');
	});

	it('falls back to top-level name when env block has no name', () => {
		const config = `name = "2fa"

[env.staging]

[env.staging.vars]
SW_VERSION = "v1"
`;
		expect(extractWorkerName(config, 'staging')).toBe('2fa');
	});

	it('returns top-level name when env block does not exist', () => {
		const config = `name = "2fa"
main = "src/worker.js"
`;
		expect(extractWorkerName(config, 'production')).toBe('2fa');
	});
});

describe('injectKvNamespaceId', () => {
	const baseConfig = `name = "2fa"
main = "src/worker.js"

[[kv_namespaces]]
binding = "SECRETS_KV"

[vars]
SW_VERSION = "v1"

[env.development]
name = "2fa-dev"

[[env.development.kv_namespaces]]
binding = "SECRETS_KV"
`;

	it('inserts id when none exists', () => {
		const result = injectKvNamespaceId(baseConfig, 'abc123');
		expect(result).toContain('binding = "SECRETS_KV"\nid = "abc123"');
	});

	it('replaces existing id', () => {
		const configWithId = baseConfig.replace(
			'binding = "SECRETS_KV"\n\n[vars]',
			'binding = "SECRETS_KV"\nid = "old-id"\n\n[vars]'
		);
		const result = injectKvNamespaceId(configWithId, 'new-id');
		expect(result).toContain('id = "new-id"');
		expect(result).not.toContain('old-id');
	});

	it('does not modify env.development kv_namespaces', () => {
		const result = injectKvNamespaceId(baseConfig, 'abc123');
		// The env.development block should not have id injected
		const devBlock = result.split('[[env.development.kv_namespaces]]')[1];
		expect(devBlock).not.toContain('id = "abc123"');
	});

	it('returns config unchanged when no SECRETS_KV binding found', () => {
		const noKvConfig = 'name = "2fa"\n[vars]\nSW_VERSION = "v1"\n';
		expect(injectKvNamespaceId(noKvConfig, 'abc123')).toBe(noKvConfig);
	});

	it('injects id into env.development block when envName is provided', () => {
		const result = injectKvNamespaceId(baseConfig, 'dev-id', 'development');
		const devBlock = result.split('[[env.development.kv_namespaces]]')[1];
		expect(devBlock).toContain('id = "dev-id"');
	});

	it('does not modify top-level kv_namespaces when envName is provided', () => {
		const result = injectKvNamespaceId(baseConfig, 'dev-id', 'development');
		const topBlock = result.split('[[kv_namespaces]]')[1].split('[')[0];
		expect(topBlock).not.toContain('id = "dev-id"');
	});

	it('replaces existing env id when envName is provided', () => {
		const configWithDevId = baseConfig.replace(
			'[[env.development.kv_namespaces]]\nbinding = "SECRETS_KV"',
			'[[env.development.kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "old-dev-id"'
		);
		const result = injectKvNamespaceId(configWithDevId, 'new-dev-id', 'development');
		expect(result).toContain('id = "new-dev-id"');
		expect(result).not.toContain('old-dev-id');
	});

	it('does not match a different env block when envName is provided', () => {
		const configWithStaging = baseConfig + `
[[env.staging.kv_namespaces]]
binding = "SECRETS_KV"
`;
		const result = injectKvNamespaceId(configWithStaging, 'dev-id', 'development');
		const stagingBlock = result.split('[[env.staging.kv_namespaces]]')[1];
		expect(stagingBlock).not.toContain('id = "dev-id"');
	});
});
