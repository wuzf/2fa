import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertReleaseWorktree, RELEASE_CHECKS, runReleaseChecks, setLockfileVersion } from '../../scripts/release.js';

const notes = 'docs/releases/v1.0.1.md';
let fixture;
let initialHead;

function git(...args) {
	return execFileSync('git', args, { cwd: fixture, encoding: 'utf8', windowsHide: true });
}

function write(name, contents) {
	const path = join(fixture, name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents);
}

function inspect() {
	return assertReleaseWorktree(notes, (command) => {
		expect(command).toBe('git status --porcelain=v1 -z --untracked-files=all');
		return git('status', '--porcelain=v1', '-z', '--untracked-files=all');
	});
}

function expectRejectedWithoutChanges(pattern) {
	const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all');
	const staged = git('diff', '--cached', '--binary');
	expect(inspect).toThrow(pattern);
	expect(git('status', '--porcelain=v1', '-z', '--untracked-files=all')).toBe(status);
	expect(git('diff', '--cached', '--binary')).toBe(staged);
	expect(git('rev-parse', 'HEAD')).toBe(initialHead);
	expect(git('tag', '--list')).toBe('');
}

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), 'twofa-release-preflight-'));
	git('init', '--quiet');
	git('config', 'user.name', 'Release fixture');
	git('config', 'user.email', 'release-fixture@example.test');
	git('config', 'core.autocrlf', 'false');
	git('config', 'core.hooksPath', '.disabled-hooks');
	write('package.json', JSON.stringify({ type: 'module', version: '1.0.0' }));
	write('src/work file.js', 'export const version = 1;\n');
	write('wrangler.toml', 'name = "public-fixture"\n');
	write('draft notes.md', '# Fixture release notes\n');
	git('add', '.');
	git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture baseline');
	initialHead = git('rev-parse', 'HEAD');
	write(notes, '# Version 1.0.1\n');
});

afterEach(() => {
	vi.restoreAllMocks();
	if (fixture) {
		const target = resolve(fixture);
		const temporaryRoot = resolve(tmpdir());
		if (!target.startsWith(temporaryRoot + '\\') && !target.startsWith(temporaryRoot + '/')) {
			throw new Error('Refusing cleanup outside the temporary directory');
		}
		if (!target.includes('twofa-release-preflight-')) {
			throw new Error('Refusing cleanup of an unexpected fixture');
		}
		rmSync(target, { recursive: true, force: true });
	}
});

describe('release preparation worktree boundary', () => {
	it('allows new or staged release notes with an unstaged local deployment configuration', () => {
		write('wrangler.toml', 'name = "local-fixture"\n');
		expect(inspect).not.toThrow();
		git('add', notes);
		expect(inspect).not.toThrow();
		write(notes, '# Updated version 1.0.1\n');
		expect(inspect).not.toThrow();
	});

	it('rejects unrelated staged code even when its path contains a space', () => {
		write('src/work file.js', 'export const version = 2;\n');
		git('add', 'src/work file.js');
		expectRejectedWithoutChanges(/已暂存[\s\S]*src\/work file\.js/);
	});

	it('rejects partially staged code without discarding either version', () => {
		write('src/work file.js', 'export const version = 2;\n');
		git('add', 'src/work file.js');
		write('src/work file.js', 'export const version = 3;\n');
		expectRejectedWithoutChanges(/已暂存/);
		expect(readFileSync(join(fixture, 'src/work file.js'), 'utf8')).toContain('version = 3');
		expect(git('show', ':src/work file.js')).toContain('version = 2');
	});

	it('rejects unstaged code so the tested worktree cannot differ from the tagged code', () => {
		write('src/work file.js', 'export const version = 2;\n');
		expectRejectedWithoutChanges(/尚未提交[\s\S]*src\/work file\.js/);
	});

	it('rejects an untracked code file and separately lists notes inside the same directory', () => {
		write('docs/releases/unrelated draft.js', 'export const unfinished = true;\n');
		expectRejectedWithoutChanges(/尚未提交[\s\S]*docs\/releases\/unrelated draft\.js/);
	});

	it('rejects a rename into the permitted notes path because its original file would also be committed', () => {
		rmSync(join(fixture, notes));
		renameSync(join(fixture, 'draft notes.md'), join(fixture, notes));
		git('add', '-A');
		expect(git('status', '--porcelain=v1', '-z')).toContain('R  ' + notes + '\0draft notes.md\0');
		expectRejectedWithoutChanges(/已暂存[\s\S]*draft notes\.md/);
	});

	it('rejects staged deployment configuration', () => {
		write('wrangler.toml', 'name = "local-fixture"\n');
		git('add', 'wrangler.toml');
		expectRejectedWithoutChanges(/已暂存[\s\S]*wrangler\.toml/);
	});

	it('rejects uncommitted version-file edits', () => {
		write('package.json', JSON.stringify({ type: 'module', version: '1.0.2' }));
		expectRejectedWithoutChanges(/尚未提交[\s\S]*package\.json/);
	});

	it.each(['01.2.3', '1.02.3', '1.2.03'])('rejects the leading-zero version %s before changing versions or tags', (version) => {
		mkdirSync(join(fixture, 'scripts'), { recursive: true });
		copyFileSync(new URL('../../scripts/release.js', import.meta.url), join(fixture, 'scripts', 'release.js'));
		copyFileSync(new URL('../../scripts/is-main-module.js', import.meta.url), join(fixture, 'scripts', 'is-main-module.js'));
		const before = readFileSync(join(fixture, 'package.json'), 'utf8');
		const result = spawnSync(process.execPath, ['scripts/release.js', version, '--skip-tests'], {
			cwd: fixture,
			encoding: 'utf8',
			windowsHide: true,
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('用法');
		expect(readFileSync(join(fixture, 'package.json'), 'utf8')).toBe(before);
		expect(git('rev-parse', 'HEAD')).toBe(initialHead);
		expect(git('tag', '--list')).toBe('');
	});
});

describe('release checks before any version change', () => {
	const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

	function recordRuns(failing = null) {
		const calls = [];
		const runCommand = (command, options) => {
			calls.push({ command, options });
			if (command === failing) {
				throw new Error(`Synthetic failure: ${command}`);
			}
			return '';
		};
		return { calls, runCommand };
	}

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('runs the same lint, test, build and packaging commands as the tag-triggered workflow, in the same order', () => {
		const steps = [
			...workflow.matchAll(/^ {6}- name: (Lint|Test|Build Worker release assets|Package browser extensions)\n {8}run: (.+)$/gm),
		].map((match) => match[2]);
		expect(steps).toHaveLength(4);
		expect(RELEASE_CHECKS.map(({ command }) => command)).toEqual(steps);
	});

	it('runs every check with inherited output', () => {
		const { calls, runCommand } = recordRuns();
		runReleaseChecks({}, runCommand);
		expect(calls).toEqual([
			{ command: 'npm run lint', options: { stdio: 'inherit' } },
			{ command: 'npm test -- --run', options: { stdio: 'inherit' } },
			{ command: 'npm run build', options: { stdio: 'inherit' } },
			{ command: 'npm run package:extension', options: { stdio: 'inherit' } },
		]);
	});

	it('skips only the test suite with --skip-tests', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { calls, runCommand } = recordRuns();
		runReleaseChecks({ skipTests: true }, runCommand);
		expect(calls.map(({ command }) => command)).toEqual(['npm run lint', 'npm run build', 'npm run package:extension']);
	});

	it.each([
		['npm run lint', ['npm run lint'], 'ESLint 检查未通过'],
		['npm test -- --run', ['npm run lint', 'npm test -- --run'], '全量测试未通过'],
		['npm run build', ['npm run lint', 'npm test -- --run', 'npm run build'], 'Worker 构建未通过'],
		['npm run package:extension', ['npm run lint', 'npm test -- --run', 'npm run build', 'npm run package:extension'], '扩展打包未通过'],
	])('stops at the first failing check %s', (failing, expected, message) => {
		const { calls, runCommand } = recordRuns(failing);
		expect(() => runReleaseChecks({}, runCommand)).toThrow(message);
		expect(calls.map(({ command }) => command)).toEqual(expected);
	});
});

describe('release script aborts on a failed check without leaving changes', () => {
	// Minimal project whose lint, test, build and packaging scripts log their order and fail on request.
	function prepareProject() {
		mkdirSync(join(fixture, 'scripts'), { recursive: true });
		copyFileSync(new URL('../../scripts/release.js', import.meta.url), join(fixture, 'scripts', 'release.js'));
		copyFileSync(new URL('../../scripts/is-main-module.js', import.meta.url), join(fixture, 'scripts', 'is-main-module.js'));
		write(
			'package.json',
			JSON.stringify({
				type: 'module',
				version: '1.0.0',
				scripts: {
					lint: 'node check.js lint',
					test: 'node check.js test',
					build: 'node check.js build',
					'package:extension': 'node check.js package',
				},
			}),
		);
		write(
			'check.js',
			[
				"import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
				'const step = process.argv[2];',
				"appendFileSync('checks.log', `${step}\\n`);",
				"if (step === 'build') {",
				"\tmkdirSync('dist', { recursive: true });",
				"\twriteFileSync('dist/worker.js', 'export default {};\\n');",
				'}',
				'if (process.env.RELEASE_FIXTURE_DIRTY === step) {',
				"\twriteFileSync('src/work file.js', 'export const version = 99;\\n');",
				'}',
				'process.exit(process.env.RELEASE_FIXTURE_FAIL === step ? 1 : 0);',
				'',
			].join('\n'),
		);
		write('.gitignore', 'checks.log\ndist/\n');
		git('add', 'scripts/release.js', 'scripts/is-main-module.js', 'package.json', 'check.js', '.gitignore');
		git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'release fixture scripts');
		initialHead = git('rev-parse', 'HEAD');
	}

	function release(env, ...extraArgs) {
		const packageBefore = readFileSync(join(fixture, 'package.json'), 'utf8');
		const result = spawnSync(process.execPath, ['scripts/release.js', 'patch', ...extraArgs], {
			cwd: fixture,
			encoding: 'utf8',
			env: { ...process.env, RELEASE_FIXTURE_FAIL: '', RELEASE_FIXTURE_DIRTY: '', ...env },
			windowsHide: true,
		});
		expect(result.status).toBe(1);
		expect(readFileSync(join(fixture, 'package.json'), 'utf8')).toBe(packageBefore);
		expect(git('rev-parse', 'HEAD')).toBe(initialHead);
		expect(git('tag', '--list')).toBe('');
		expect(git('diff', '--cached', '--name-only')).toBe('');
		return { ...result, log: readFileSync(join(fixture, 'checks.log'), 'utf8').trim().split('\n') };
	}

	beforeEach(prepareProject);

	it.each([
		['lint', [], ['lint'], 'ESLint 检查未通过'],
		['test', [], ['lint', 'test'], '全量测试未通过'],
		['build', [], ['lint', 'test', 'build'], 'Worker 构建未通过'],
		['build', ['--skip-tests'], ['lint', 'build'], 'Worker 构建未通过'],
		['package', [], ['lint', 'test', 'build', 'package'], '扩展打包未通过'],
		['package', ['--skip-tests'], ['lint', 'build', 'package'], '扩展打包未通过'],
	])(
		'stops when %s fails (%j) before bumping, committing or tagging',
		(step, extraArgs, expectedLog, message) => {
			const result = release({ RELEASE_FIXTURE_FAIL: step }, ...extraArgs);
			expect(result.log).toEqual(expectedLog);
			expect(result.stderr).toContain(message);
			// Only the untracked release notes remain; the ignored build output does not dirty the worktree.
			expect(git('status', '--porcelain=v1', '--untracked-files=all').trim()).toBe(`?? ${notes}`);
		},
		30000,
	);

	it('stops when a passing check leaves a change that the release commit would not contain', () => {
		const result = release({ RELEASE_FIXTURE_DIRTY: 'build' });
		expect(result.log).toEqual(['lint', 'test', 'build', 'package']);
		expect(result.stderr).toContain('工作区出现了新的改动');
		expect(result.stderr).toContain('src/work file.js');
	}, 30000);
});

describe('lockfile version update', () => {
	const lockfile = {
		name: '2fa',
		version: '1.0.0',
		lockfileVersion: 3,
		requires: true,
		packages: {
			'': { name: '2fa', version: '1.0.0', dependencies: { a: '^1.0.0' } },
			'node_modules/@esbuild/linux-x64': { version: '0.25.0', cpu: ['x64'], os: ['linux'], libc: ['glibc'], optional: true },
			'node_modules/a': { version: '1.0.0' },
		},
	};
	const text = JSON.stringify(lockfile, null, 2) + '\n';

	it('changes only the version of the project', () => {
		const updated = setLockfileVersion(text, '1.0.1');
		const before = text.split('\n');
		const after = updated.split('\n');
		expect(after.filter((line, index) => line !== before[index])).toEqual(['  "version": "1.0.1",', '      "version": "1.0.1",']);
		expect(JSON.parse(updated).packages['node_modules/@esbuild/linux-x64'].libc).toEqual(['glibc']);
		expect(JSON.parse(updated).packages['node_modules/a'].version).toBe('1.0.0');
	});

	it('accepts a lockfile checked out with CRLF line endings', () => {
		expect(setLockfileVersion(text.replace(/\n/g, '\r\n'), '1.0.1')).toBe(setLockfileVersion(text, '1.0.1'));
	});

	it('rejects a lockfile that npm did not write', () => {
		expect(() => setLockfileVersion(JSON.stringify(lockfile), '1.0.1')).toThrow('不是 npm 的标准格式');
		const { packages, ...withoutPackages } = lockfile;
		expect(packages).toBeDefined();
		expect(() => setLockfileVersion(JSON.stringify(withoutPackages, null, 2) + '\n', '1.0.1')).toThrow('缺少项目版本字段');
	});
});
