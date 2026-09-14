import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = join(projectRoot, 'tests/fixtures/sync-upstream');
// Frozen before the fix: execute the real legacy commit step, including its pre-stage diff check.
const legacyWorkflow = readFileSync(join(fixtureRoot, 'legacy-workflow.yml'), 'utf8').replace(/\r\n/g, '\n');
const currentWorkflow = readFileSync(join(projectRoot, '.github/workflows/sync-upstream.yml'), 'utf8').replace(/\r\n/g, '\n');
const sandboxes = [];
const rsyncCommand = process.platform === 'win32' ? 'wsl' : 'rsync';
const rsyncPrefix = process.platform === 'win32' ? ['--exec', 'rsync'] : [];
const hasRsync = spawnSync(rsyncCommand, [...rsyncPrefix, '--version'], { windowsHide: true, timeout: 15000 }).status === 0;

const localConfig = `name = "my-existing-worker"
main = "src/worker.js"
compatibility_date = "2024-01-13"
workers_dev = false
preview_urls = false
routes = [
  { pattern = "2fa.example.test", custom_domain = true }
]

[[kv_namespaces]]
binding = "SECRETS_KV"
id = "existing-production-kv"
preview_id = "existing-production-preview"

[triggers]
crons = ["0 5 * * *"]

[vars]
SW_VERSION = "old-version"
ENVIRONMENT = "production"
CUSTOM_SETTING = "keep-this"

[env.development]
name = "my-existing-dev-worker"
routes = []

[[env.development.kv_namespaces]]
binding = "SECRETS_KV"
id = "existing-development-kv"
preview_id = "existing-development-preview"

[env.development.vars]
SW_VERSION = "old-version"
ENVIRONMENT = "development"
CUSTOM_SETTING = "keep-dev-setting"
`;

function cleanEnv(extra = {}) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith('GIT_') || key.startsWith('GITHUB_') || key.startsWith('UPSTREAM_')) {
			delete env[key];
		}
	}
	return { ...env, GIT_TERMINAL_PROMPT: '0', ...extra };
}

function run(command, args, cwd, env = {}, allowFailure = false) {
	const result = spawnSync(command, args, {
		cwd,
		env: cleanEnv(env),
		encoding: 'utf8',
		windowsHide: true,
		timeout: 15000,
	});
	if (result.error || (!allowFailure && result.status !== 0)) {
		throw new Error(`${command} ${args.join(' ')} failed:\n${result.error || ''}\n${result.stdout}\n${result.stderr}`);
	}
	return result;
}

function git(context, args, allowFailure = false) {
	return run('git', args, context.repo, {}, allowFailure);
}

function write(root, name, contents) {
	const path = join(root, name);
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, contents);
}

function safeRemove(context, path) {
	const absoluteRoot = resolve(context.root);
	const absoluteTarget = resolve(path);
	const suffix = relative(absoluteRoot, absoluteTarget);
	if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
		throw new Error(`Refusing to remove outside test sandbox: ${absoluteTarget}`);
	}
	if (!absoluteRoot.startsWith(`${resolve(tmpdir())}${sep}2fa-sync-test-`)) {
		throw new Error(`Unexpected sandbox root: ${absoluteRoot}`);
	}
	rmSync(absoluteTarget, { recursive: true, force: true });
}

function files(root, prefix = '') {
	const result = new Map();
	for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
		if (!prefix && entry.name === '.git') {
			continue;
		}
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			for (const item of files(root, name)) {
				result.set(...item);
			}
		} else {
			result.set(name, readFileSync(join(root, name)));
		}
	}
	return result;
}

function step(workflow, name) {
	const block = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0];
	if (!block || !block.includes('        run: |\n')) {
		throw new Error(`Workflow shell step missing: ${name}`);
	}
	return block
		.split('        run: |\n')[1]
		.split('\n')
		.map((line) => line.slice(10))
		.join('\n');
}

// Mirror rsync's relevant file effects without requiring rsync on Windows. The exclusion
// directories come from the chosen YAML; merge, diff, commit and push run their actual code.
function syncFiles(context, upstream, workflow = legacyWorkflow) {
	// Keep the cloned source available to the legacy compatibility entry point.
	const source = join(context.root, 'upstream');
	if (existsSync(source)) {
		safeRemove(context, source);
	}
	for (const [name, content] of upstream) {
		write(source, name, content);
	}
	const excludes = [...step(workflow, 'Sync files from upstream').matchAll(/--exclude\s+'([^']+)'/g)].map((match) =>
		match[1].replace(/^\//, '').replace(/\/$/, ''),
	);
	const excluded = (name) => excludes.some((directory) => name === directory || name.startsWith(`${directory}/`));
	for (const name of files(context.repo).keys()) {
		if (!excluded(name) && !upstream.has(name)) {
			safeRemove(context, join(context.repo, name));
		}
	}
	for (const [name, content] of upstream) {
		if (!excluded(name)) {
			write(context.repo, name, content);
		}
	}
}

function merge(context, overrides = {}) {
	const {
		env = {},
		local = context.local,
		upstream = join(context.repo, 'wrangler.toml'),
		output = join(context.repo, 'wrangler.toml'),
		cwd = context.repo,
		allowFailure = false,
	} = overrides;
	return run(
		'node',
		[join(context.repo, 'scripts/merge-wrangler-config.js'), local, upstream, output],
		cwd,
		{
			GITHUB_ACTIONS: 'true',
			GITHUB_EVENT_NAME: 'workflow_dispatch',
			GITHUB_WORKSPACE: context.repo,
			GITHUB_STEP_SUMMARY: join(context.root, 'summary.md'),
			UPSTREAM_REPO: 'wuzf/2fa',
			...env,
		},
		allowFailure,
	);
}

function commitStep(context, workflow = legacyWorkflow, allowFailure = false) {
	return run(
		'bash',
		['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step(workflow, 'Commit and push changes')],
		context.repo,
		{ UPSTREAM_REF: 'main' },
		allowFailure,
	);
}

function createSandbox({ legacy = false, remote = false, workflows = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), '2fa-sync-test-'));
	const context = { root, repo: join(root, 'repository'), local: join(root, 'local-wrangler.toml') };
	sandboxes.push(context);
	mkdirSync(context.repo);
	git(context, ['init', '-b', 'main']);
	git(context, ['config', 'user.name', 'Sync regression tests']);
	git(context, ['config', 'user.email', 'sync-test@example.invalid']);
	git(context, ['config', 'commit.gpgSign', 'false']);
	git(context, ['config', 'core.autocrlf', 'false']);
	git(context, ['config', 'core.hooksPath', join(root, 'no-local-hooks')]);
	write(context.repo, 'package.json', '{"type":"module"}\n');
	write(context.repo, '.gitignore', '.github/workflows/ignored.yml\n');
	write(context.repo, 'wrangler.toml', localConfig);
	write(context.repo, 'src/worker.js', 'export default "old application";\n');
	write(context.repo, 'obsolete.txt', 'old file to remove\n');
	write(context.repo, 'scripts/merge-wrangler-config.js', readFileSync(join(projectRoot, 'scripts/merge-wrangler-config.js')));
	write(context.repo, 'scripts/sync-upstream-compat.js', readFileSync(join(projectRoot, 'scripts/sync-upstream-compat.js')));
	if (workflows) {
		write(context.repo, '.github/workflows/sync-upstream.yml', legacyWorkflow);
		write(context.repo, '.github/workflows/custom.yml', 'name: User custom workflow\non: workflow_dispatch\n');
		write(context.repo, '.github/workflows/removed-upstream.yml', 'name: Keep this local workflow\n');
	}
	writeFileSync(context.local, localConfig);
	// Normalize with the real merger once so add-only/no-op tests cannot pass via incidental TOML edits.
	merge(context, { env: { GITHUB_ACTIONS: '' } });
	writeFileSync(context.local, readFileSync(join(context.repo, 'wrangler.toml')));
	context.upstream = files(context.repo);
	context.upstream.set('.github/workflows/sync-upstream.yml', currentWorkflow);
	context.upstream.set('.github/workflows/new-upstream.yml', 'name: Upstream-only workflow\n');
	context.upstream.delete('.github/workflows/custom.yml');
	context.upstream.delete('.github/workflows/removed-upstream.yml');
	if (legacy) {
		write(context.repo, 'scripts/merge-wrangler-config.js', readFileSync(join(fixtureRoot, 'legacy-merge-wrangler-config.js')));
		safeRemove(context, join(context.repo, 'scripts/sync-upstream-compat.js'));
	}
	git(context, ['add', '-A']);
	git(context, ['commit', '-m', 'Initial deployed repository']);
	context.initialHead = git(context, ['rev-parse', 'HEAD']).stdout.trim();
	context.originalWorkflows = workflows ? files(join(context.repo, '.github/workflows')) : new Map();
	if (remote) {
		context.remote = join(root, 'remote.git');
		git(context, ['init', '--bare', context.remote]);
		git(context, ['remote', 'add', 'origin', context.remote]);
		git(context, ['push', '-u', 'origin', 'main']);
		// Model GitHub's default-token rejection with a real server-side Git hook.
		write(
			context.remote,
			'hooks/pre-receive',
			'#!/bin/sh\nwhile read old new ref; do\n' +
				'  if ! git diff --quiet "$old" "$new" -- .github/workflows; then\n' +
				'    echo "Default token cannot update workflow files" >&2\n    exit 1\n  fi\ndone\n',
		);
		chmodSync(join(context.remote, 'hooks/pre-receive'), 0o755);
	}
	return context;
}

function expectWorkflowsPreserved(context) {
	expect(files(join(context.repo, '.github/workflows'))).toEqual(context.originalWorkflows);
	expect(git(context, ['diff', 'HEAD', '--', '.github/workflows']).stdout).toBe('');
	expect(git(context, ['ls-files', '--others', '--', '.github/workflows']).stdout).toBe('');
}

afterEach(() => {
	for (const context of sandboxes.splice(0)) {
		safeRemove(context, context.root);
	}
});

describe('Sync Upstream compatibility using real Git repositories', () => {
	it.skipIf(!hasRsync).each([
		['legacy workflow with compatibility repair', legacyWorkflow, true],
		['current workflow without compatibility repair', currentWorkflow, false],
	])(
		'syncs equal-size, equal-mtime files using real rsync: %s',
		(_, workflow, useCompatibility) => {
			const context = createSandbox({ remote: true });
			const oldVersion = "export const APP_VERSION = '1.6.0';\n";
			const newVersion = oldVersion.replace('1.6.0', '1.8.0');
			const upstream = new Map(context.upstream).set('src/utils/version.js', newVersion);
			upstream.set('scripts/build-release.js', 'export const fixed = true;\n');
			upstream.set('wrangler.toml', readFileSync(context.local, 'utf8').replaceAll('old-version', 'new-version'));
			syncFiles(context, upstream, currentWorkflow);
			write(context.repo, 'src/utils/version.js', oldVersion);
			write(context.repo, 'scripts/build-release.js', 'export const fixed = null;\n');
			write(context.repo, 'wrangler.toml', readFileSync(context.local));
			// Commit a partially upgraded installation with the original workflows.
			for (const [name, content] of context.originalWorkflows) {
				write(context.repo, `.github/workflows/${name}`, content);
			}
			for (const name of ['src/utils/version.js', 'scripts/build-release.js']) {
				git(context, ['add', name]);
			}
			git(context, ['commit', '-m', 'Partially upgraded application']);
			git(context, ['push']);
			for (const root of [context.repo, join(context.root, 'upstream')]) {
				for (const name of ['src/utils/version.js', 'scripts/build-release.js', 'wrangler.toml']) {
					utimesSync(join(root, name), 1700000000, 1700000000);
				}
			}
			const linuxPath = (path) => path.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/');
			const script = step(workflow, 'Sync files from upstream');
			const args = script
				.split('\\\n')
				.join(' ')
				.trim()
				.split(/\s+/)
				.slice(1, -2)
				.map((arg) => arg.replace(/^'|'$/g, ''));
			args.push(`${linuxPath(join(context.root, 'upstream'))}/`, `${linuxPath(context.repo)}/`);
			run(rsyncCommand, [...rsyncPrefix, ...args], context.repo);
			expect(readFileSync(join(context.repo, 'src/utils/version.js'), 'utf8')).toBe(useCompatibility ? oldVersion : newVersion);
			if (useCompatibility) {
				merge(context);
			} else {
				merge(context, { env: { GITHUB_ACTIONS: '' } });
			}
			expectWorkflowsPreserved(context);
			commitStep(context, workflow);
			expect(git(context, ['show', 'origin/main:src/utils/version.js']).stdout).toBe(newVersion);
			expect(git(context, ['show', 'origin/main:scripts/build-release.js']).stdout).toBe(upstream.get('scripts/build-release.js'));
			const merged = readFileSync(join(context.repo, 'wrangler.toml'), 'utf8');
			expect(merged).toContain('my-existing-worker');
			expect(merged).toContain('existing-production-kv');
			expect(merged).toContain('new-version');
			expect(merged).not.toContain('old-version');
		},
		60000,
	);

	it('reproduces the reported rejection with the frozen legacy workflow and merger', () => {
		const context = createSandbox({ legacy: true, remote: true });
		const oldUpstream = new Map(context.upstream);
		oldUpstream.set('scripts/merge-wrangler-config.js', readFileSync(join(fixtureRoot, 'legacy-merge-wrangler-config.js')));
		oldUpstream.delete('scripts/sync-upstream-compat.js');
		syncFiles(context, oldUpstream);
		merge(context);
		const result = commitStep(context, legacyWorkflow, true);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Default token cannot update workflow files');
		expect(git(context, ['rev-parse', 'origin/main']).stdout.trim()).toBe(context.initialHead);
	});

	it('upgrades a legacy installation in place, preserving workflows and deployment identities', () => {
		const context = createSandbox({ legacy: true, remote: true });
		const upstream = new Map(context.upstream);
		upstream.set('src/worker.js', 'export default "new application";\n');
		upstream.set('src/new feature.js', 'export const upgraded = true;\n');
		upstream.set('new-empty.txt', '');
		upstream.delete('obsolete.txt');
		upstream.set('.github/workflows/ignored.yml', 'name: Ignored upstream workflow\n');
		upstream.set(
			'wrangler.toml',
			localConfig
				.replaceAll('my-existing', 'upstream-default')
				.replaceAll('existing-production', 'upstream-production')
				.replaceAll('existing-development', 'upstream-development')
				.replaceAll('old-version', 'new-version')
				.replace('2fa.example.test', 'upstream.example.test')
				.replace('keep-this', 'default-setting')
				.replace('keep-dev-setting', 'default-dev-setting')
				.replace('0 5 * * *', '0 16 * * *'),
		);
		syncFiles(context, upstream);
		merge(context);
		expectWorkflowsPreserved(context);
		const merged = readFileSync(join(context.repo, 'wrangler.toml'), 'utf8');
		for (const value of [
			'my-existing-worker',
			'my-existing-dev-worker',
			'existing-production-kv',
			'existing-production-preview',
			'existing-development-kv',
			'existing-development-preview',
			'2fa.example.test',
			'keep-this',
			'keep-dev-setting',
			'0 5 * * *',
			'workers_dev = false',
			'preview_urls = false',
			'routes = []',
		]) {
			expect(merged).toContain(value);
		}
		expect(merged.match(/SW_VERSION = "new-version"/g)).toHaveLength(2);
		// Cloudflare Secrets stay attached to the preserved Worker; the sync performs only Git operations.
		expect(merged).not.toContain('ENCRYPTION_KEY');
		commitStep(context);
		expect(git(context, ['status', '--porcelain']).stdout).toBe('');
		expect(git(context, ['show', 'origin/main:src/worker.js']).stdout).toContain('new application');
		expect(git(context, ['show', 'origin/main:src/new feature.js']).stdout).toContain('upgraded');
		expect(git(context, ['show', 'origin/main:new-empty.txt']).stdout).toBe('');
		expect(git(context, ['cat-file', '-e', 'origin/main:obsolete.txt'], true).status).not.toBe(0);
		expect(git(context, ['diff', context.initialHead, 'origin/main', '--', '.github/workflows']).stdout).toBe('');
	}, 20000);

	it.each([
		['a regular new file', 'src/新 feature.js', 'export const added = true;\n'],
		['an empty new file', 'empty-file.txt', ''],
	])('lets the unchanged legacy diff check detect %s as the only application change', (_, name, content) => {
		const context = createSandbox({ remote: true });
		const upstream = new Map(context.upstream).set(name, content);
		syncFiles(context, upstream);
		merge(context);
		expectWorkflowsPreserved(context);
		// Intent-to-add must leave content unstaged so the old YAML can see it.
		expect(git(context, ['diff', '--cached', '--quiet'], true).status).toBe(0);
		commitStep(context);
		expect(git(context, ['rev-parse', 'HEAD']).stdout.trim()).not.toBe(context.initialHead);
		expect(git(context, ['show', `origin/main:${name}`]).stdout).toBe(content);
		expect(git(context, ['status', '--porcelain']).stdout).toBe('');
	});

	it('restores deleted/custom workflows, removes ignored additions and is a repeatable no-op', () => {
		const context = createSandbox({ remote: true });
		const upstream = new Map(context.upstream).set('.github/workflows/ignored.yml', 'name: Ignored addition\n');
		for (let attempt = 0; attempt < 2; attempt++) {
			syncFiles(context, upstream);
			merge(context);
			expectWorkflowsPreserved(context);
			expect(commitStep(context).stdout).toContain('No upstream changes to commit.');
			expect(git(context, ['rev-parse', 'HEAD']).stdout.trim()).toBe(context.initialHead);
			expect(git(context, ['status', '--porcelain']).stdout).toBe('');
		}
	});

	it('handles a repository with no tracked workflow directory', () => {
		const context = createSandbox({ workflows: false });
		syncFiles(context, context.upstream);
		merge(context);
		expect(git(context, ['ls-files', '--others', '--', '.github/workflows']).stdout).toBe('');
		expect(git(context, ['status', '--porcelain']).stdout).toBe('');
	});

	it('uses the new template to exclude workflows and commit an add-only update without the compatibility hook', () => {
		const context = createSandbox({ remote: true });
		const upstream = new Map(context.upstream).set('new-empty.txt', '');
		syncFiles(context, upstream, currentWorkflow);
		expectWorkflowsPreserved(context);
		// Disable the hook so this separately verifies the new YAML's cached diff behavior.
		merge(context, { env: { GITHUB_ACTIONS: '' } });
		commitStep(context, currentWorkflow);
		expect(git(context, ['show', 'origin/main:new-empty.txt']).stdout).toBe('');
		expect(git(context, ['diff', context.initialHead, 'HEAD', '--name-only']).stdout.trim()).toBe('new-empty.txt');
		expect(commitStep(context, currentWorkflow).stdout).toContain('No upstream changes to commit.');
	});

	it.each([
		['ordinary local invocation', { GITHUB_ACTIONS: '' }],
		['another CI event', { GITHUB_EVENT_NAME: 'push' }],
		['another upstream repository', { UPSTREAM_REPO: 'someone/another-repo' }],
		['no Actions workspace', { GITHUB_WORKSPACE: '' }],
	])('leaves the Git index and workflows untouched during %s', (_, env) => {
		const context = createSandbox();
		syncFiles(context, new Map(context.upstream).set('ordinary-new-file.txt', 'untracked\n'));
		const beforeWorkflows = files(join(context.repo, '.github/workflows'));
		const beforeUntracked = git(context, ['ls-files', '--others', '--exclude-standard']).stdout;
		const beforeIndex = readFileSync(join(context.repo, '.git/index'));
		merge(context, { env });
		expect(files(join(context.repo, '.github/workflows'))).toEqual(beforeWorkflows);
		expect(git(context, ['ls-files', '--others', '--exclude-standard']).stdout).toBe(beforeUntracked);
		expect(readFileSync(join(context.repo, '.git/index'))).toEqual(beforeIndex);
	});

	it.each(['local inside repository', 'different upstream path', 'different output path', 'different workspace'])(
		'does not alter workflow files or index for %s',
		(mismatch) => {
			const context = createSandbox();
			syncFiles(context, new Map(context.upstream).set('ordinary-new-file.txt', 'untracked\n'));
			write(context.repo, 'alternate.toml', readFileSync(context.local));
			const options = {};
			if (mismatch === 'local inside repository') {
				write(context.repo, 'local-wrangler.toml', readFileSync(context.local));
				options.local = join(context.repo, 'local-wrangler.toml');
			} else if (mismatch === 'different upstream path') {
				options.upstream = join(context.repo, 'alternate.toml');
			} else if (mismatch === 'different output path') {
				options.output = join(context.repo, 'alternate.toml');
			} else {
				options.env = { GITHUB_WORKSPACE: context.root };
				options.allowFailure = true;
			}
			const beforeWorkflows = files(join(context.repo, '.github/workflows'));
			const beforeIndex = readFileSync(join(context.repo, '.git/index'));
			const result = merge(context, options);
			if (mismatch === 'different workspace') {
				expect(result.status).not.toBe(0);
			}
			expect(files(join(context.repo, '.github/workflows'))).toEqual(beforeWorkflows);
			expect(readFileSync(join(context.repo, '.git/index'))).toEqual(beforeIndex);
		},
	);

	it('rejects a workflow directory redirected outside the repository without touching its target', () => {
		const context = createSandbox();
		const outside = join(context.root, 'outside-workflows');
		write(outside, 'sentinel.yml', 'must stay untouched\n');
		const workflowDirectory = join(context.repo, '.github/workflows');
		safeRemove(context, workflowDirectory);
		symlinkSync(outside, workflowDirectory, process.platform === 'win32' ? 'junction' : 'dir');
		const beforeIndex = readFileSync(join(context.repo, '.git/index'));
		const result = merge(context, { allowFailure: true });
		expect(result.status).not.toBe(0);
		expect(readFileSync(join(outside, 'sentinel.yml'), 'utf8')).toBe('must stay untouched\n');
		expect(lstatSync(workflowDirectory).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(context.repo, '.git/index'))).toEqual(beforeIndex);
		expect(existsSync(join(context.repo, '.github/workflows/sync-upstream.yml'))).toBe(false);
	});
});
