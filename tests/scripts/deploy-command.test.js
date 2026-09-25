import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';

// Same resolution as deploy.js (scripts/../wrangler.toml). Only an in-memory copy is used; the real file is never read.
const wranglerPath = join(fileURLToPath(new URL('../../scripts/', import.meta.url)), '..', 'wrangler.toml');

const fixtures = vi.hoisted(() => ({
	files: new Map(),
	writes: [],
	removals: [],
	commands: [],
	namespaces: [],
	wranglerPath: '',
	failDeployment: false,
	failTemporaryWrite: false,
}));
vi.mock('fs', () => ({
	readFileSync: (path) => {
		if (!fixtures.files.has(String(path))) {
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
		}
		return fixtures.files.get(String(path));
	},
	writeFileSync: (path, text) => {
		fixtures.writes.push({ path: String(path), text });
		if (fixtures.failTemporaryWrite) {
			fixtures.files.set(String(path), text.slice(0, 8));
			throw new Error('Synthetic disk full');
		}
		fixtures.files.set(String(path), text);
	},
	rmSync: (path, options) => {
		fixtures.removals.push({ path: String(path), options });
		fixtures.files.delete(String(path));
	},
}));
vi.mock('node:child_process', () => ({
	execFileSync: (_command, args, options) => {
		const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : null;
		fixtures.commands.push({
			args,
			options,
			configPath,
			config: configPath ? fixtures.files.get(configPath) : null,
			// What wrangler.toml would contain if the process were killed (for example by Ctrl+C) while this command runs.
			wranglerToml: fixtures.files.get(fixtures.wranglerPath),
		});
		if (args[0].endsWith('generate-version.js')) {
			return 'test-version\n';
		}
		if (args[1] === 'kv') {
			return JSON.stringify(fixtures.namespaces);
		}
		if (args[1] === 'deploy') {
			if (fixtures.failDeployment) {
				throw new Error('Synthetic deploy failed');
			}
			return '';
		}
		throw new Error('Unexpected subprocess');
	},
}));

const originalArgs = process.argv;
afterEach(() => {
	process.argv = originalArgs;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function invoke(
	config,
	{
		envName = null,
		namespaces = [],
		failDeployment = false,
		failTemporaryWrite = false,
		args = null,
		cloudflareEnv = '',
		workerNameOverride = undefined,
	} = {},
) {
	vi.resetModules();
	vi.stubEnv('CLOUDFLARE_ENV', cloudflareEnv);
	// undefined removes the variable, matching a local deployment outside Workers Builds.
	vi.stubEnv('WRANGLER_CI_OVERRIDE_NAME', workerNameOverride);
	Object.assign(fixtures, {
		files: new Map([[wranglerPath, config]]),
		writes: [],
		removals: [],
		commands: [],
		namespaces,
		wranglerPath,
		failDeployment,
		failTemporaryWrite,
	});
	process.argv = ['node', 'scripts/deploy.js', ...(args || (envName ? ['--env', envName] : []))];
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
	await import('../../scripts/deploy.js');
	return exit;
}

function deployCommand() {
	return fixtures.commands.find(({ args }) => args[1] === 'deploy');
}

function expectOriginalUntouched(original) {
	expect(fixtures.writes.some(({ path }) => path === wranglerPath)).toBe(false);
	expect(fixtures.removals.some(({ path }) => path === wranglerPath)).toBe(false);
	expect(fixtures.files.get(wranglerPath)).toBe(original);
	// No temporary copy is left behind either.
	expect([...fixtures.files.keys()]).toEqual([wranglerPath]);
}

const base = `name = "vault"
main = "src/worker.js"
[[kv_namespaces]]
binding = "SECRETS_KV"
id = "explicit-vault"
[vars]
SW_VERSION = "original-version"
`;

describe('deployment command storage isolation', () => {
	it.each([null, 'development'])('resolves CLOUDFLARE_ENV consistently while explicit CLI takes priority (%s)', async (explicit) => {
		const original =
			base + '\n[env.development]\nname="vault-dev"\n[[env.development.kv_namespaces]]\nbinding="SECRETS_KV"\nid="dev-vault"\n';
		await invoke(original, { envName: explicit, cloudflareEnv: explicit ? 'unknown-environment' : 'development' });
		expect(deployCommand().args.slice(-2)).toEqual(['--env', 'development']);
		expect(fixtures.commands.some(({ args }) => args[1] === 'kv')).toBe(false);
	});
	it.each([['--env=development'], ['-e', 'development']])('retains the requested environment with %j', async (...args) => {
		const original =
			base + '\n[env.development]\nname="vault-dev"\n[[env.development.kv_namespaces]]\nbinding="SECRETS_KV"\nid="dev-vault"\n';
		await invoke(original, { args });
		expect(deployCommand().args.slice(-2)).toEqual(['--env', 'development']);
		expect(fixtures.commands.some(({ args }) => args[1] === 'kv')).toBe(false);
	});

	it.each([['--dry-run'], ['--env'], ['--env='], ['--env', '--git'], ['--env=a', '--env=b'], ['--git', '--package']])(
		'rejects ambiguous or unsupported arguments %j before running any command',
		async (...args) => {
			await expect(invoke(base, { args })).rejects.toThrow();
			expect(fixtures.commands).toEqual([]);
			expect(fixtures.writes).toEqual([]);
		},
	);

	it.each([false, true])('deploys from a temporary copy and never writes wrangler.toml (failure=%s)', async (failure) => {
		const original = '# retain comments and original formatting\r\n' + base.replaceAll('\n', '\r\n');
		const exit = await invoke(original, { failDeployment: failure });
		expect(fixtures.commands.some(({ args }) => args[1] === 'kv')).toBe(false);
		const deploy = deployCommand();
		expect(parse(deploy.config).kv_namespaces[0].id).toBe('explicit-vault');
		expect(parse(deploy.config).vars.SW_VERSION).toBe('test-version');
		expect(parse(deploy.config).durable_objects).toBeUndefined();
		expect(parse(deploy.config).migrations).toBeUndefined();
		// Wrangler resolves main, assets and build paths from the config file's directory, so the copy sits beside the original.
		expect(dirname(deploy.configPath)).toBe(dirname(wranglerPath));
		expect(basename(deploy.configPath)).toMatch(/^wrangler\.deploy\.\d+\.tmp\.toml$/);
		expect(deploy.options.cwd).toBe(dirname(wranglerPath));
		expect(deploy.wranglerToml).toBe(original);
		expect(fixtures.writes.map(({ path }) => path)).toEqual([deploy.configPath]);
		expect(fixtures.removals).toEqual([{ path: deploy.configPath, options: { force: true } }]);
		expectOriginalUntouched(original);
		if (failure) {
			expect(exit).toHaveBeenCalledWith(1);
		} else {
			expect(exit).not.toHaveBeenCalled();
		}
	});

	it('removes a partially written temporary copy without deploying', async () => {
		const exit = await invoke(base, { failTemporaryWrite: true });
		expect(deployCommand()).toBeUndefined();
		expect(fixtures.writes).toHaveLength(1);
		expect(fixtures.writes[0].path).not.toBe(wranglerPath);
		expect(fixtures.removals.map(({ path }) => path)).toEqual([fixtures.writes[0].path]);
		expectOriginalUntouched(base);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('looks up and deploys in the same named environment and project directory', async () => {
		const original = base + '\n[env.development]\nname="vault-dev"\n[[env.development.kv_namespaces]]\nbinding="SECRETS_KV"\n';
		await invoke(original, { envName: 'development', namespaces: [{ title: 'vault-dev-secrets-kv', id: 'dev-vault' }] });
		const discovery = fixtures.commands.find(({ args }) => args[1] === 'kv');
		const deploy = deployCommand();
		for (const command of [discovery, deploy]) {
			expect(command.args.slice(-2)).toEqual(['--env', 'development']);
			expect(command.args).toContain('--config');
		}
		// Listing namespaces only reads the original configuration; the discovered ID goes into the temporary copy.
		expect(discovery.configPath).toBe(wranglerPath);
		expect(dirname(deploy.configPath)).toBe(dirname(discovery.configPath));
		expect(discovery.options.cwd).toBe(deploy.options.cwd);
		expect(fixtures.commands.find(({ args }) => args[0].endsWith('generate-version.js')).options.cwd).toBe(deploy.options.cwd);
		expect(parse(deploy.config).env.development.kv_namespaces[0].id).toBe('dev-vault');
		expect(parse(deploy.config).kv_namespaces[0].id).toBe('explicit-vault');
		expect(deploy.wranglerToml).toBe(original);
		expectOriginalUntouched(original);
	});

	it('finds storage by the connected Worker name that Workers Builds deploys to', async () => {
		const original = base.replace('id = "explicit-vault"\n', '');
		const namespaces = [{ title: 'vault-secrets-kv', id: 'other-instance-vault' }];
		await invoke(original, { namespaces, workerNameOverride: 'my-vault' });
		expect(process.env.WRANGLER_CI_OVERRIDE_NAME).toBe('my-vault');
		// The configured name matches another deployment's namespace; it must not be bound.
		expect(parse(deployCommand().config).kv_namespaces[0].id).toBeUndefined();
		expectOriginalUntouched(original);

		await invoke(original, {
			namespaces: [...namespaces, { title: 'my-vault-secrets-kv', id: 'own-vault' }],
			workerNameOverride: 'my-vault',
		});
		expect(parse(deployCommand().config).kv_namespaces[0].id).toBe('own-vault');
	});

	it('keeps using the configured name outside Workers Builds', async () => {
		const original = base.replace('id = "explicit-vault"\n', '');
		await invoke(original, { namespaces: [{ title: 'vault-secrets-kv', id: 'local-vault' }] });
		expect('WRANGLER_CI_OVERRIDE_NAME' in process.env).toBe(false);
		expect(parse(deployCommand().config).kv_namespaces[0].id).toBe('local-vault');
	});

	it('stops before deploying when the connected Worker name is blank', async () => {
		const original = base.replace('id = "explicit-vault"\n', '');
		const exit = await invoke(original, { namespaces: [{ title: 'vault-secrets-kv', id: 'a' }], workerNameOverride: '' });
		expect(deployCommand()).toBeUndefined();
		expect(fixtures.commands.some(({ args }) => args[1] === 'kv')).toBe(false);
		expect(fixtures.writes).toEqual([]);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('stops before changing configuration or deploying when candidates are ambiguous', async () => {
		const original = base.replace('id = "explicit-vault"\n', '');
		await invoke(original, {
			namespaces: [
				{ title: 'vault-secrets-kv', id: 'a' },
				{ title: 'vault-SECRETS_KV', id: 'b' },
			],
		});
		expect(deployCommand()).toBeUndefined();
		expect(fixtures.writes).toEqual([]);
		expectOriginalUntouched(original);
	});
});
