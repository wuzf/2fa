import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workflowsPath = '.github/workflows';

/**
 * Old Sync Upstream workflows run the newly downloaded config merger after rsync.
 * Keep that entry point working without asking users to edit YAML or supply a PAT.
 * This must never run as a side effect of an ordinary local config merge.
 */
export function preserveWorkflowsForSync({ localPath, upstreamPath, outputPath }) {
	if (
		process.env.GITHUB_ACTIONS !== 'true' ||
		process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
		process.env.UPSTREAM_REPO !== 'wuzf/2fa' ||
		!process.env.GITHUB_WORKSPACE
	) {
		return;
	}

	const cwd = process.cwd();
	const configPath = resolve(cwd, 'wrangler.toml');
	if (
		resolve(upstreamPath) !== configPath ||
		resolve(outputPath) !== configPath ||
		basename(localPath) !== 'local-wrangler.toml' ||
		isWithin(cwd, resolve(localPath))
	) {
		return;
	}

	const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
	if (realpathSync(cwd) !== repository || realpathSync(process.env.GITHUB_WORKSPACE) !== repository) {
		throw new Error('Sync compatibility must run in the checked-out repository.');
	}

	const git = (args, input) =>
		execFileSync('git', ['--literal-pathspecs', ...args], {
			cwd: repository,
			encoding: 'utf8',
			input,
			maxBuffer: 16 * 1024 * 1024,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

	if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== repository) {
		throw new Error('Sync compatibility requires the repository root.');
	}

	// Reject redirected directories before Git or filesystem operations can follow them.
	assertDirectoryPath(repository, resolve(repository, workflowsPath));
	const originalWorkflows = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', workflowsPath]);
	if (originalWorkflows) {
		git(['restore', '--source=HEAD', '--staged', '--worktree', '--', workflowsPath]);
	}

	// Do not use --exclude-standard: even an ignored upstream workflow must be removed.
	// Only untracked files in this directory are removed; user workflows come from HEAD.
	const addedWorkflows = git(['ls-files', '--others', '-z', '--', workflowsPath]);
	for (const name of addedWorkflows.split('\0').filter(Boolean)) {
		const target = resolve(repository, name);
		if (!isWithin(resolve(repository, workflowsPath), target)) {
			throw new Error('Refusing to remove a file outside the workflows directory.');
		}
		assertDirectoryPath(repository, dirname(target));
		// unlink removes a symlink itself, never its destination. No recursive removal.
		unlinkSync(target);
	}

	git(['diff', '--exit-code', 'HEAD', '--', workflowsPath]);
	if (git(['ls-files', '--others', '-z', '--', workflowsPath])) {
		throw new Error('Upstream workflows remain after preserving local workflows.');
	}

	// Old YAML checks `git diff` BEFORE staging. Intent-to-add exposes new files
	// (including empty files) to that check without staging the application changes.
	const addedFiles = git(['ls-files', '--others', '--exclude-standard', '-z']);
	if (addedFiles) {
		git(['add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'], addedFiles);
	}

	const message = 'Existing upgrade and custom workflows were preserved. No manual workflow changes or extra token are needed.';
	console.log(message);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Upgrade compatibility\n\n${message}\n`, 'utf8');
	}
}

function isWithin(parent, target) {
	const path = relative(parent, target);
	return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function assertDirectoryPath(repository, target) {
	if (!isWithin(repository, target)) {
		throw new Error('Sync path is outside the repository.');
	}
	let current = repository;
	for (const part of relative(repository, target).split(sep).filter(Boolean)) {
		current = resolve(current, part);
		let stat;
		try {
			stat = lstatSync(current);
		} catch (error) {
			if (error.code === 'ENOENT') {
				return;
			}
			throw error;
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			throw new Error('Sync workflow directories must be real directories.');
		}
	}
}
