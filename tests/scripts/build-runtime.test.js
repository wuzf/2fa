import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { buildRuntime } from '../../scripts/build-runtime.js';
import { useBuiltRuntime } from '../../scripts/deploy-config.js';

const temporary = [];
afterEach(() => {
	for (const path of temporary.splice(0)) {
		if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith('2fa-build-test-')) {
			throw new Error('Refusing to remove a path outside the test directory');
		}
		rmSync(path, { recursive: true, force: true });
	}
});

function fixtureWithStyles() {
	const rootDir = mkdtempSync(join(tmpdir(), '2fa-build-test-'));
	temporary.push(rootDir);
	writeFileSync(join(rootDir, 'package.json'), '{"version":"1.0.0"}');
	const directory = join(rootDir, 'src/ui/styles');
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, 'index.js'),
		`import { color } from './tokens.js';
let cached;
export function getStyles() {
  if (typeof globalThis.__2FA_HOST_STYLES__ === 'string') return globalThis.__2FA_HOST_STYLES__;
  return cached ??= '<style>button{color:' + color + '}</style></head>';
}`,
	);
	const tokensPath = join(directory, 'tokens.js');
	writeFileSync(tokensPath, 'export const color = "red";');
	const entryPoint = join(rootDir, 'worker.js');
	writeFileSync(
		entryPoint,
		'import { getStyles } from "./src/ui/styles/index.js"; export const html = getStyles(); export const id = globalThis.__2FA_BUILD_ID__;',
	);
	return { rootDir, entryPoint, tokensPath };
}

async function execute(output) {
	return import('data:text/javascript;base64,' + Buffer.from(output.code).toString('base64'));
}

describe('content based shared build', () => {
	it('identical artifacts have identical identities, code changes produce new identity at the same package version', async () => {
		const rootDir = mkdtempSync(join(tmpdir(), '2fa-build-test-'));
		temporary.push(rootDir);
		writeFileSync(join(rootDir, 'package.json'), '{"version":"1.0.0"}');
		const entryPoint = join(rootDir, 'worker.js');
		writeFileSync(entryPoint, 'export const id = globalThis.__2FA_BUILD_ID__; export const value = 1;');
		const one = await buildRuntime({ rootDir, entryPoint });
		const repeated = await buildRuntime({ rootDir, entryPoint });
		expect(repeated).toEqual(one);
		expect(one.buildId).toMatch(/^[a-f0-9]{64}$/);
		expect(one.code).toContain(one.buildId);
		writeFileSync(entryPoint, 'export const id = globalThis.__2FA_BUILD_ID__; export const value = 2;');
		const changed = await buildRuntime({ rootDir, entryPoint });
		expect(changed.buildId).not.toBe(one.buildId);
	});
	it('temporary config preserves deployment bindings and environment routes while selecting the built artifact', () => {
		const original =
			'main="src/worker.js"\n[build]\ncommand="unsafe build"\n[env.development]\nmain="src/dev.js"\nroutes=[]\n[[env.development.durable_objects.bindings]]\nname="SECRETS_STORE"\nclass_name="SecretsStore"\n';
		const configured = parse(useBuiltRuntime(original, '.wrangler/runtime.js'));
		expect(configured.main).toBe('.wrangler/runtime.js');
		expect(configured.env.development.main).toBe(configured.main);
		expect(configured.no_bundle).toBe(true);
		expect(configured.build).toBeUndefined();
		expect(configured.env.development.routes).toEqual([]);
		expect(configured.env.development.durable_objects.bindings[0].name).toBe('SECRETS_STORE');
	});
	it.each([false, true])(
		'rebuilds changed transitive CSS and restores deterministic prior bytes without ESM cache pollution (minify=%s)',
		async (minify) => {
			const fixture = fixtureWithStyles();
			const first = await buildRuntime({ ...fixture, minify });
			expect((await execute(first)).html).toBe('<style>button{color:red}</style></head>');
			const repeated = await buildRuntime({ ...fixture, minify });
			expect(repeated.code).toBe(first.code);
			expect(repeated.buildId).toBe(first.buildId);
			writeFileSync(fixture.tokensPath, 'export const color = "blue";');
			const changed = await buildRuntime({ ...fixture, minify });
			expect(changed.buildId).not.toBe(first.buildId);
			expect((await execute(changed)).html).toBe('<style>button{color:blue}</style></head>');
			expect((await execute(changed)).id).toBe(changed.buildId);
			writeFileSync(fixture.tokensPath, 'export const color = "red";');
			const restored = await buildRuntime({ ...fixture, minify });
			expect(restored.code).toBe(first.code);
			expect(restored.buildId).toBe(first.buildId);
			expect(existsSync(join(fixture.rootDir, 'dist'))).toBe(false);
		},
	);
	it('precompiles from source even if an earlier caller set the runtime injection global', async () => {
		const fixture = fixtureWithStyles();
		const previous = Object.getOwnPropertyDescriptor(globalThis, '__2FA_HOST_STYLES__');
		try {
			globalThis.__2FA_HOST_STYLES__ = '<style>stale external build</style>';
			const output = await buildRuntime(fixture);
			expect((await execute(output)).html).toBe('<style>button{color:red}</style></head>');
			expect(globalThis.__2FA_HOST_STYLES__).toBe('<style>stale external build</style>');
		} finally {
			if (previous) {
				Object.defineProperty(globalThis, '__2FA_HOST_STYLES__', previous);
			} else {
				delete globalThis.__2FA_HOST_STYLES__;
			}
		}
	});
	it('rejects a broken style entry instead of silently falling back to request-time compilation', async () => {
		const fixture = fixtureWithStyles();
		writeFileSync(join(fixture.rootDir, 'src/ui/styles/index.js'), 'export function getStyles(){return undefined;}');
		await expect(buildRuntime(fixture)).rejects.toThrow('must return a string');
	});
	it('a temporary project without a styles directory remains a supported build input', async () => {
		const rootDir = mkdtempSync(join(tmpdir(), '2fa-build-test-'));
		temporary.push(rootDir);
		writeFileSync(join(rootDir, 'package.json'), '{"version":"2.0.0"}');
		const entryPoint = join(rootDir, 'worker.js');
		writeFileSync(entryPoint, 'export default { version:process.env.VERSION, build:globalThis.__2FA_BUILD_ID__ };');
		const output = await buildRuntime({ rootDir, entryPoint });
		expect((await execute(output)).default).toEqual({ version: '2.0.0', build: output.buildId });
	});
});
