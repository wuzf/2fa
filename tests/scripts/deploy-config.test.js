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
});
