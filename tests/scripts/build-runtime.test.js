import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { buildRuntime } from '../../scripts/build-runtime.js';
import { useBuiltRuntime } from '../../scripts/deploy-config.js';

const temporary = [];
afterEach(() => { for (const path of temporary.splice(0)) { rmSync(path, { recursive: true, force: true }); } });

describe('content based shared build', () => {
	it('identical artifacts have identical identities, code changes produce new identity at the same package version', async () => {
		const rootDir = mkdtempSync(join(tmpdir(), '2fa-build-test-'));
		temporary.push(rootDir);
		writeFileSync(join(rootDir, 'package.json'), '{"version":"1.0.0"}');
		const entryPoint = join(rootDir, 'worker.js');
		writeFileSync(entryPoint, "export const id = globalThis.__2FA_BUILD_ID__; export const value = 1;");
		const one = await buildRuntime({ rootDir, entryPoint });
		const repeated = await buildRuntime({ rootDir, entryPoint });
		expect(repeated).toEqual(one);
		expect(one.buildId).toMatch(/^[a-f0-9]{64}$/);
		expect(one.code).toContain(one.buildId);
		writeFileSync(entryPoint, "export const id = globalThis.__2FA_BUILD_ID__; export const value = 2;");
		const changed = await buildRuntime({ rootDir, entryPoint });
		expect(changed.buildId).not.toBe(one.buildId);
	});
	it('temporary config preserves deployment bindings and environment routes while selecting the built artifact', () => {
		const original = 'main="src/worker.js"\n[build]\ncommand="unsafe build"\n[env.development]\nmain="src/dev.js"\nroutes=[]\n[[env.development.durable_objects.bindings]]\nname="SECRETS_STORE"\nclass_name="SecretsStore"\n';
		const configured = parse(useBuiltRuntime(original, '.wrangler/runtime.js'));
		expect(configured.main).toBe('.wrangler/runtime.js');
		expect(configured.env.development.main).toBe(configured.main);
		expect(configured.no_bundle).toBe(true);
		expect(configured.build).toBeUndefined();
		expect(configured.env.development.routes).toEqual([]);
		expect(configured.env.development.durable_objects.bindings[0].name).toBe('SECRETS_STORE');
	});
});
