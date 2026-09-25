import { describe, expect, it } from 'vitest';

import { injectWorkerVersion } from '../../scripts/deploy-config.js';

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

	it('replaces SW_VERSION in every env block, not just the first', () => {
		const config = `name = "2fa"

[vars]
SW_VERSION = "v1"
ENVIRONMENT = "production"

[env.development]
name = "2fa-dev"

[env.development.vars]
ENVIRONMENT = "development"
SW_VERSION = "v1"
`;

		const updated = injectWorkerVersion(config, 'v1.7.0');

		// 漏替换任一处都会让该环境的 Service Worker 缓存版本停在旧值，用户拿不到更新
		expect(updated.match(/SW_VERSION = "v1\.7\.0"/g)).toHaveLength(2);
		expect(updated).not.toContain('SW_VERSION = "v1"');
	});

	it('throws when SW_VERSION is missing', () => {
		expect(() => injectWorkerVersion('[vars]\n', 'v20260325-123456')).toThrow('在 wrangler.toml 中未找到 SW_VERSION 配置');
	});
});
