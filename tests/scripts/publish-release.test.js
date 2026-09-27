import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseReleaseArgs, publishRelease } from '../../scripts/publish-release.js';

const tag = 'v1.10.0';
const repo = 'owner/2fa';
const commit = 'a'.repeat(40);
const otherCommit = 'b'.repeat(40);
const extensionPackages = ['chrome', 'edge', 'firefox'].map((browser) => `2fa-extension-${browser}-1.1.1.zip`);
const names = ['worker.js', 'worker.metadata.json', 'DEPLOY.md', ...extensionPackages];
let rootDir;

function commandError(message = 'release not found') {
	return Object.assign(new Error(message), { status: 1, stderr: Buffer.from(`${message}\n`) });
}

function expectedAssets() {
	return names.map((name) => {
		const content = readFileSync(join(rootDir, 'dist', name));
		return { name, state: 'uploaded', size: content.length, digest: `sha256:${createHash('sha256').update(content).digest('hex')}` };
	});
}

function release({ isDraft = true, assets = [], isPrerelease = false } = {}) {
	return { tagName: tag, isDraft, isPrerelease, assets };
}

const publishedNow = '2026-09-25T10:00:00Z';

function published(tagName, publishedAt = publishedNow, flags = {}) {
	return { tagName, isDraft: false, isPrerelease: false, publishedAt, ...flags };
}

function mockCommands(overrides = {}) {
	const state = {
		dirty: '',
		head: commit,
		tagCommit: commit,
		remote: { ref: `refs/tags/${tag}`, object: { type: 'commit', sha: commit } },
		annotations: {},
		release: null,
		latest: { tag_name: 'v1.8.1' },
		// Other releases in the repository, as returned by `gh release list`.
		others: [],
		// Models another tag's run acting between this run's latest check and its publication.
		beforePublish: null,
		// Models another tag's run acting right after this run publishes.
		afterPublishEdit: null,
		frozenLatest: false,
		// For this long after each latest change, reads still return the previous value.
		staleMs: 0,
		staleUntil: 0,
		previousLatest: null,
		// Simulated time: only the injected sleep advances it.
		clock: 0,
		...overrides,
	};
	state.sleep = vi.fn((milliseconds) => {
		state.clock += milliseconds;
	});
	const run = vi.fn((binary, args, options) => {
		expect(options.cwd).toBe(rootDir);
		expect(options).not.toHaveProperty('shell');
		if (binary === 'git') {
			if (args[0] === 'status') {
				expect(args).toEqual(['status', '--porcelain', '--untracked-files=normal']);
				return state.dirty;
			}
			if (args[0] === 'rev-parse') {
				return args[2] === 'HEAD^{commit}' ? state.head : state.tagCommit;
			}
		}
		if (binary === 'gh') {
			if (args[0] === 'api') {
				if (args[1] === `repos/${repo}/git/ref/tags/${tag}`) {
					if (state.refError) {
						throw state.refError;
					}
					return JSON.stringify(state.remote);
				}
				if (args[1].startsWith(`repos/${repo}/git/tags/`)) {
					return JSON.stringify(state.annotations[args[1].split('/').at(-1)]);
				}
				expect(args[1]).toBe(`repos/${repo}/releases/latest`);
				if (state.latestError) {
					throw state.latestError;
				}
				if (state.clock < state.staleUntil) {
					return JSON.stringify(state.previousLatest);
				}
				if (!state.latest) {
					throw commandError('gh: Not Found (HTTP 404)');
				}
				return JSON.stringify(state.latest);
			}
			if (args[1] === 'view') {
				if (state.viewError) {
					throw state.viewError;
				}
				if (state.rawView !== undefined) {
					return state.rawView;
				}
				if (!state.release) {
					throw commandError();
				}
				return JSON.stringify(state.release);
			}
			if (args[1] === 'create') {
				state.release = release();
				return 'created';
			}
			if (args[1] === 'upload') {
				if (state.uploadError) {
					state.release.assets = expectedAssets().slice(0, 1);
					throw state.uploadError;
				}
				state.release.assets = state.uploadedAssets || expectedAssets();
				if (state.latestAfterUpload) {
					state.latest = state.latestAfterUpload;
				}
				if (state.latestErrorAfterUpload) {
					state.latestError = state.latestErrorAfterUpload;
				}
				return 'uploaded';
			}
			if (args[1] === 'list') {
				expect(args).toEqual(['release', 'list', '--repo', repo, '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease,publishedAt']);
				if (state.rawList !== undefined) {
					return state.rawList;
				}
				const own = state.release
					? [
							{
								tagName: tag,
								isDraft: state.release.isDraft,
								isPrerelease: state.release.isPrerelease,
								publishedAt: state.release.publishedAt ?? null,
							},
						]
					: [];
				return JSON.stringify([...own, ...state.others]);
			}
			if (args[1] === 'edit') {
				const publishing = args.includes('--draft=false');
				if (publishing) {
					state.beforePublish?.(state);
					state.release.isDraft = false;
					state.release.publishedAt = publishedNow;
					if (state.afterPublish) {
						Object.assign(state.release, state.afterPublish);
					}
					if (state.viewErrorAfterPublish) {
						state.viewError = state.viewErrorAfterPublish;
					}
				}
				if (args.includes('--latest=true') && !state.frozenLatest) {
					if (state.latest?.tag_name !== args[2]) {
						state.previousLatest = state.latest;
						state.staleUntil = state.clock + state.staleMs;
					}
					state.latest = { tag_name: args[2] };
				}
				if (publishing) {
					state.afterPublishEdit?.(state);
				}
				return 'updated';
			}
		}
		throw new Error(`Unexpected command: ${binary} ${args.join(' ')}`);
	});
	const writes = () => run.mock.calls.filter(([binary, args]) => binary === 'gh' && ['create', 'upload', 'edit'].includes(args[1]));
	return {
		state,
		run,
		writes,
		publish: (options = {}) => publishRelease({ tag, repo, rootDir, run, sleep: state.sleep, ...options }),
	};
}

beforeEach(() => {
	rootDir = mkdtempSync(join(tmpdir(), '2fa-publish-release-'));
	mkdirSync(join(rootDir, 'docs', 'releases'), { recursive: true });
	mkdirSync(join(rootDir, 'dist'));
	mkdirSync(join(rootDir, 'extension'));
	writeFileSync(join(rootDir, 'docs', 'releases', `${tag}.md`), '- Release notes\n');
	writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ version: '1.10.0' }));
	writeFileSync(join(rootDir, 'dist', 'worker.js'), '/**\n * @version 1.10.0\n */\nexport default {};\n');
	writeFileSync(join(rootDir, 'dist', 'worker.metadata.json'), JSON.stringify({ version: '1.10.0' }));
	writeFileSync(join(rootDir, 'dist', 'DEPLOY.md'), 'Deployment instructions\n');
	writeFileSync(join(rootDir, 'extension', 'manifest.base.json'), JSON.stringify({ version: '1.1.1' }));
	for (const name of extensionPackages) {
		writeFileSync(join(rootDir, 'dist', name), `PK archive ${name}`);
	}
});

afterEach(() => {
	if (rootDir && dirname(resolve(rootDir)) === resolve(tmpdir()) && basename(rootDir).startsWith('2fa-publish-release-')) {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

describe('release command arguments', () => {
	it('accepts tag and repository without evaluating shell text', () => {
		expect(parseReleaseArgs(['--repo', repo, '--tag', tag])).toEqual({ tag, repo });
	});

	it.each([['--tag'], ['--unknown', 'value'], ['--tag', tag, '--tag', tag]])('rejects malformed CLI arguments %j', (...args) => {
		expect(() => parseReleaseArgs(args)).toThrow('Usage:');
	});
});

describe('release preflight', () => {
	it.each(['1.10.0', 'v01.10.0', 'v1.10.0-beta', 'v1.10.0;echo nope', '../v1.10.0'])(
		'rejects invalid tag %s before any command',
		(invalid) => {
			const task = mockCommands();
			expect(() => task.publish({ tag: invalid })).toThrow('exact vX.Y.Z');
			expect(task.run).not.toHaveBeenCalled();
		},
	);

	it.each(['owner', 'https://github.com/owner/2fa', 'owner/2fa.git', '../2fa', 'owner/repo;echo nope', '-owner/2fa'])(
		'rejects invalid repository %s',
		(invalid) => {
			const task = mockCommands();
			expect(() => task.publish({ repo: invalid })).toThrow('owner/name');
			expect(task.run).not.toHaveBeenCalled();
		},
	);

	it.each([
		['empty notes', () => writeFileSync(join(rootDir, 'docs', 'releases', `${tag}.md`), ' \n')],
		['missing notes', () => rmSync(join(rootDir, 'docs', 'releases', `${tag}.md`))],
		['package mismatch', () => writeFileSync(join(rootDir, 'package.json'), '{"version":"1.9.0"}')],
		['metadata mismatch', () => writeFileSync(join(rootDir, 'dist', 'worker.metadata.json'), '{"version":"1.9.0"}')],
		['banner mismatch', () => writeFileSync(join(rootDir, 'dist', 'worker.js'), '/**\n * @version 1.9.0\n */')],
		['version outside banner', () => writeFileSync(join(rootDir, 'dist', 'worker.js'), 'const fake = "@version 1.10.0";')],
		['missing asset', () => rmSync(join(rootDir, 'dist', 'DEPLOY.md'))],
		['missing extension package', () => rmSync(join(rootDir, 'dist', '2fa-extension-firefox-1.1.1.zip'))],
		['extension package of another version', () => writeFileSync(join(rootDir, 'extension', 'manifest.base.json'), '{"version":"1.1.2"}')],
		['invalid extension version', () => writeFileSync(join(rootDir, 'extension', 'manifest.base.json'), '{"version":"../1.1.1"}')],
		['missing extension manifest', () => rmSync(join(rootDir, 'extension', 'manifest.base.json'))],
	])('does not issue remote writes for %s', (_name, change) => {
		change();
		const task = mockCommands();
		expect(() => task.publish()).toThrow();
		expect(task.writes()).toEqual([]);
	});

	it.each([
		['working tree has uncommitted sources', { dirty: ' M src/worker.js\n' }],
		['index has staged changes', { dirty: 'M  docs/releases/v1.10.0.md\n' }],
		['working tree has untracked files', { dirty: '?? src/untracked.js\n' }],
		['HEAD differs from tag', { tagCommit: otherCommit }],
		['remote tag missing', { refError: commandError('HTTP 404: Not Found') }],
		['remote ref differs', { remote: { ref: 'refs/tags/v1.9.0', object: { type: 'commit', sha: commit } } }],
		['remote tag differs', { remote: { ref: `refs/tags/${tag}`, object: { type: 'commit', sha: otherCommit } } }],
		[
			'annotated remote tag differs',
			{
				remote: { ref: `refs/tags/${tag}`, object: { type: 'tag', sha: commit } },
				annotations: { [commit]: { sha: commit, object: { type: 'commit', sha: otherCommit } } },
			},
		],
	])('does not issue remote writes when %s', (_name, state) => {
		const task = mockCommands(state);
		expect(() => task.publish()).toThrow();
		expect(task.writes()).toEqual([]);
	});

	it('accepts an annotated remote tag only when its peeled commit matches HEAD', () => {
		const task = mockCommands({
			remote: { ref: `refs/tags/${tag}`, object: { type: 'tag', sha: otherCommit } },
			annotations: { [otherCommit]: { sha: otherCommit, object: { type: 'commit', sha: commit } } },
		});
		expect(task.publish().status).toBe('published');
	});

	it('resolves nested annotated tags to the actual release commit', () => {
		const annotation = 'c'.repeat(40);
		const task = mockCommands({
			remote: { ref: `refs/tags/${tag}`, object: { type: 'tag', sha: annotation } },
			annotations: {
				[annotation]: { sha: annotation, object: { type: 'tag', sha: otherCommit } },
				[otherCommit]: { sha: otherCommit, object: { type: 'commit', sha: commit } },
			},
		});
		expect(task.publish().status).toBe('published');
	});

	it('rejects an annotated-tag cycle without writes', () => {
		const task = mockCommands({
			remote: { ref: `refs/tags/${tag}`, object: { type: 'tag', sha: otherCommit } },
			annotations: { [otherCommit]: { sha: otherCommit, object: { type: 'tag', sha: otherCommit } } },
		});
		expect(() => task.publish()).toThrow('cannot be resolved safely');
		expect(task.writes()).toEqual([]);
	});

	it.each(['HTTP 401: Bad credentials', 'HTTP 403: API rate limit exceeded', 'connection reset by peer', 'repository not found'])(
		'does not treat %s as a missing release',
		(message) => {
			const task = mockCommands({ viewError: commandError(message) });
			expect(() => task.publish()).toThrow(message);
			expect(task.writes()).toEqual([]);
		},
	);

	it.each(['null', '{}', '[]', 'not JSON'])('rejects malformed release response %s without writes', (rawView) => {
		const task = mockCommands({ rawView });
		expect(() => task.publish()).toThrow();
		expect(task.writes()).toEqual([]);
	});

	it('does not treat an unknown latest-release failure as no latest release', () => {
		const task = mockCommands({ latestError: commandError('HTTP 500: server error') });
		expect(() => task.publish()).toThrow('HTTP 500');
		expect(task.writes()).toEqual([]);
	});
});

describe('publishing and retries', () => {
	it('creates a draft for an existing tag and publishes only after uploading and verifying three allowed assets', () => {
		writeFileSync(join(rootDir, 'dist', 'unrelated-private-file.txt'), 'Must not be uploaded');
		const task = mockCommands({ latest: null });
		expect(task.publish()).toEqual({ status: 'published', tag, latest: true });
		const writes = task.writes().map(([, args]) => args);
		expect(writes).toHaveLength(3);
		expect(writes[0]).toEqual([
			'release',
			'create',
			tag,
			'--repo',
			repo,
			'--verify-tag',
			'--draft',
			'--latest=false',
			'--title',
			tag,
			'--notes-file',
			join(rootDir, 'docs', 'releases', `${tag}.md`),
		]);
		expect(writes[1]).toEqual(['release', 'upload', tag, ...names.map((name) => join(rootDir, 'dist', name)), '--repo', repo, '--clobber']);
		expect(writes[2]).toEqual(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=true']);
		expect(task.state.release.isDraft).toBe(false);
	});

	it('keeps a partial upload in draft and completes a later retry without creating another release', () => {
		const task = mockCommands({ uploadError: commandError('upload connection failed') });
		expect(() => task.publish()).toThrow('upload connection failed');
		expect(task.state.release.isDraft).toBe(true);
		expect(task.state.release.assets).toHaveLength(1);
		expect(task.writes().some(([, args]) => args.includes('--draft=false'))).toBe(false);
		task.state.uploadError = null;
		expect(task.publish().status).toBe('published');
		expect(task.writes().filter(([, args]) => args[1] === 'create')).toHaveLength(1);
		expect(task.writes().filter(([, args]) => args[1] === 'upload')).toHaveLength(2);
	});

	it.each(['missing', 'pending', 'wrong size', 'wrong digest', 'unexpected'])('does not publish when uploaded assets are %s', (failure) => {
		const uploadedAssets = expectedAssets();
		if (failure === 'missing') {
			uploadedAssets.pop();
		} else if (failure === 'pending') {
			uploadedAssets[0].state = 'new';
		} else if (failure === 'wrong size') {
			uploadedAssets[0].size += 1;
		} else if (failure === 'wrong digest') {
			uploadedAssets[0].digest = `sha256:${'0'.repeat(64)}`;
		} else {
			uploadedAssets.push({ name: 'unwanted.zip', state: 'uploaded', size: 10 });
		}
		const task = mockCommands({ uploadedAssets });
		expect(() => task.publish()).toThrow();
		expect(task.state.release.isDraft).toBe(true);
		expect(task.writes().some(([, args]) => args.includes('--draft=false'))).toBe(false);
	});

	it('keeps the draft when rechecking latest fails after a successful upload', () => {
		const task = mockCommands({ latestErrorAfterUpload: commandError('HTTP 502: gateway failure') });
		expect(() => task.publish()).toThrow('HTTP 502');
		expect(task.state.release.isDraft).toBe(true);
	});

	it.each([
		['a prerelease', () => release({ isPrerelease: true })],
		['unexpected assets', () => release({ assets: [{ name: 'unwanted.zip', state: 'uploaded', size: 10 }] })],
	])('does not modify an existing draft with %s', (_name, makeRelease) => {
		const task = mockCommands({ release: makeRelease() });
		expect(() => task.publish()).toThrow('review it before publishing');
		expect(task.writes()).toEqual([]);
	});

	it('leaves an already published release unchanged when its required assets are complete', () => {
		const existing = release({ isDraft: false, assets: expectedAssets() });
		const task = mockCommands({ release: existing });
		expect(task.publish()).toEqual({ status: 'unchanged', tag });
		expect(task.writes()).toEqual([]);
		expect(task.state.release).toEqual(existing);
	});

	it('rejects an already published prerelease instead of reporting stable success', () => {
		const task = mockCommands({ release: release({ isDraft: false, isPrerelease: true, assets: expectedAssets() }) });
		expect(() => task.publish()).toThrow('existing prerelease');
		expect(task.writes()).toEqual([]);
	});

	it.each([{ isDraft: true }, { isPrerelease: true }])('verifies the final release state after publishing: %j', (afterPublish) => {
		const task = mockCommands({ afterPublish });
		expect(() => task.publish()).toThrow('Could not verify');
		expect(task.writes().some(([, args]) => args.includes('--draft=false'))).toBe(true);
	});

	it('verifies the final published assets rather than assuming edit success proves their presence', () => {
		const task = mockCommands({ afterPublish: { assets: expectedAssets().slice(0, 2) } });
		expect(() => task.publish()).toThrow('missing or incomplete: DEPLOY.md');
	});

	it('reports a failed final verification without deleting the published release', () => {
		const task = mockCommands({ viewErrorAfterPublish: commandError('HTTP 502: gateway failure') });
		expect(() => task.publish()).toThrow('HTTP 502');
		expect(task.state.release.isDraft).toBe(false);
		expect(task.run.mock.calls.some(([, args]) => args.includes('delete'))).toBe(false);
	});

	it('reports missing assets on an already published release without modifying it', () => {
		const task = mockCommands({ release: release({ isDraft: false, assets: expectedAssets().slice(0, 2) }) });
		expect(() => task.publish()).toThrow('missing or incomplete: DEPLOY.md');
		expect(task.writes()).toEqual([]);
	});

	it.each(['v1.9.0', 'v1.10.0'])('allows this version to be latest when the current latest is %s', (latestTag) => {
		const task = mockCommands({ latest: { tag_name: latestTag } });
		expect(task.publish().latest).toBe(true);
	});

	it.each(['v1.11.0', 'v2.0.0', 'custom-release'])('preserves a higher or unrecognized latest release %s', (latestTag) => {
		const task = mockCommands({ latest: { tag_name: latestTag } });
		expect(task.publish().latest).toBe(false);
		expect(task.writes().at(-1)[1]).toContain('--latest=false');
	});

	it('preserves a newer release that becomes latest while uploading', () => {
		const task = mockCommands({ latestAfterUpload: { tag_name: 'v1.11.0' } });
		expect(task.publish().latest).toBe(false);
	});
});

describe('parallel publication of several tags', () => {
	const editArgs = (task) => task.writes().map(([, args]) => args);

	it('returns the latest mark to a higher tag whose run published between this run’s check and publication', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			beforePublish: (state) => {
				state.others = [published('v1.10.1', '2026-09-25T09:59:58Z')];
				state.latest = { tag_name: 'v1.10.1' };
			},
		});
		expect(task.publish()).toEqual({ status: 'published', tag, latest: true });
		expect(task.state.latest).toEqual({ tag_name: 'v1.10.1' });
		expect(editArgs(task).at(-1)).toEqual(['release', 'edit', 'v1.10.1', '--repo', repo, '--latest=true']);
		expect(task.state.release.isDraft).toBe(false);
	});

	it('takes the mark back when a lower tag’s run overwrites it right after this run publishes', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			afterPublishEdit: (state) => {
				state.others = [published('v1.9.9', '2026-09-25T10:00:01Z')];
				state.latest = { tag_name: 'v1.9.9' };
			},
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.latest).toEqual({ tag_name: tag });
		expect(editArgs(task).at(-1)).toEqual(['release', 'edit', tag, '--repo', repo, '--latest=true']);
	});

	it('does not move the mark to higher tags that are still drafts or prereleases', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			others: [
				{ tagName: 'v1.10.1', isDraft: true, isPrerelease: false, publishedAt: null },
				published('v1.11.0', publishedNow, { isPrerelease: true }),
				published('v1.12.0-rc.1'),
			],
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.latest).toEqual({ tag_name: tag });
		expect(editArgs(task)).toHaveLength(3);
	});

	it('leaves an older higher release that the maintainer kept off latest untouched', () => {
		const task = mockCommands({ latest: { tag_name: 'v1.9.0' }, others: [published('v1.11.0', '2026-08-01T00:00:00Z')] });
		expect(task.publish()).toEqual({ status: 'published', tag, latest: true });
		expect(task.state.latest).toEqual({ tag_name: tag });
		expect(editArgs(task).some((args) => args.includes('v1.11.0'))).toBe(false);
	});

	it('keeps a higher latest release that is already marked without extra writes', () => {
		const task = mockCommands({ latest: { tag_name: 'v1.10.1' }, others: [published('v1.10.1', '2026-09-25T09:59:59Z')] });
		expect(task.publish().latest).toBe(false);
		expect(editArgs(task)).toHaveLength(3);
		expect(task.state.latest).toEqual({ tag_name: 'v1.10.1' });
	});

	it('reports a latest mark that never settles after waiting between attempts, without undoing the publication', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			afterPublishEdit: (state) => {
				state.others = [published('v1.10.1')];
				state.frozenLatest = true;
			},
		});
		expect(() => task.publish()).toThrow(`${tag} is published, but its latest-release mark could not be verified`);
		expect(task.state.release.isDraft).toBe(false);
		// Each correction is re-read twice (a recheck of the unexpected value) before it is repeated.
		expect(editArgs(task).filter((args) => args[2] === 'v1.10.1')).toHaveLength(3);
		expect(task.state.sleep.mock.calls).toEqual([[2000], [4000], [6000], [8000], [10000]]);
		expect(task.run.mock.calls.some(([, args]) => args.includes('delete'))).toBe(false);
	});

	it('does not mistake the previous latest value, briefly returned by GitHub, for a settled mark', () => {
		// The higher release took the mark just before this run overwrote it; for three seconds after
		// the overwrite GitHub still returns the higher release, which would look settled.
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			staleMs: 3000,
			beforePublish: (state) => {
				state.others = [published('v1.10.1', '2026-09-25T09:59:58Z')];
				state.latest = { tag_name: 'v1.10.1' };
			},
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.latest).toEqual({ tag_name: 'v1.10.1' });
		expect(editArgs(task).at(-1)).toEqual(['release', 'edit', 'v1.10.1', '--repo', repo, '--latest=true']);
		expect(task.state.sleep.mock.calls).toEqual([[2000], [4000], [6000]]);
	});

	it('confirms a corrected mark despite a stale read instead of reporting failure within seconds', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			staleMs: 5000,
			afterPublishEdit: (state) => {
				state.others = [published('v1.10.1', '2026-09-25T10:00:01Z')];
			},
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.latest).toEqual({ tag_name: 'v1.10.1' });
	});

	it('waits once before confirming the mark it set on publication, then stops', () => {
		const task = mockCommands({ latest: null });
		expect(task.publish().status).toBe('published');
		expect(task.state.sleep.mock.calls).toEqual([[2000]]);
		expect(editArgs(task)).toHaveLength(3);
	});

	it('checks immediately when publication left the mark on a higher release', () => {
		const task = mockCommands({ latest: { tag_name: 'v1.11.0' } });
		expect(task.publish().latest).toBe(false);
		expect(task.state.sleep).not.toHaveBeenCalled();
	});

	it('retries a release list that has not caught up with the publication yet', () => {
		let lagging = 2;
		const task = mockCommands({ latest: { tag_name: 'v1.9.0' } });
		const list = task.run.getMockImplementation();
		task.run.mockImplementation((binary, args, options) => {
			if (binary === 'gh' && args[1] === 'list' && lagging > 0) {
				lagging -= 1;
				return '[]';
			}
			return list(binary, args, options);
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.sleep.mock.calls).toEqual([[2000], [4000], [6000]]);
	});

	it('leaves a mark that the maintainer moved to an older release right after publication', () => {
		const task = mockCommands({
			latest: { tag_name: 'v1.9.0' },
			others: [published('v1.9.0', '2026-08-01T00:00:00Z'), published('v1.10.1', '2026-09-25T09:59:58Z')],
			afterPublishEdit: (state) => {
				state.latest = { tag_name: 'v1.9.0' };
			},
		});
		expect(task.publish().status).toBe('published');
		expect(task.state.latest).toEqual({ tag_name: 'v1.9.0' });
		expect(editArgs(task)).toHaveLength(3);
	});

	it('does not treat a release published ten minutes earlier as part of the batch', () => {
		const task = mockCommands({ latest: { tag_name: 'v1.9.0' }, others: [published('v1.10.1', '2026-09-25T09:50:00Z')] });
		expect(task.publish()).toEqual({ status: 'published', tag, latest: true });
		expect(task.state.latest).toEqual({ tag_name: tag });
		expect(editArgs(task).some((args) => args.includes('v1.10.1'))).toBe(false);
	});

	it.each([
		['malformed', '{}', 'invalid release list'],
		['missing required fields', JSON.stringify([{ tagName: tag }]), 'invalid release list'],
		['invalid publication time', JSON.stringify([published(tag, 'not a date')]), 'invalid release list'],
		['missing the published release', '[]', 'missing from the release list'],
	])('reports an unusable release list after publishing: %s', (_label, rawList, message) => {
		const task = mockCommands({ rawList });
		expect(() => task.publish()).toThrow(message);
		expect(task.state.release.isDraft).toBe(false);
	});
});

describe('re-running an already published release', () => {
	const editArgs = (task) => task.writes().map(([, args]) => args);
	const publishedRelease = () => ({ ...release({ isDraft: false, assets: expectedAssets() }), publishedAt: publishedNow });

	it('completes the latest check that an earlier attempt could not finish', () => {
		// The earlier attempt marked this tag over a higher release of the same batch, then failed verification.
		const task = mockCommands({
			release: publishedRelease(),
			latest: { tag_name: tag },
			others: [published('v1.10.1', '2026-09-25T09:59:58Z')],
		});
		expect(task.publish()).toEqual({ status: 'unchanged', tag });
		expect(task.state.latest).toEqual({ tag_name: 'v1.10.1' });
		expect(editArgs(task)).toEqual([['release', 'edit', 'v1.10.1', '--repo', repo, '--latest=true']]);
	});

	it('makes no change when this tag is correctly the latest release', () => {
		const task = mockCommands({
			release: publishedRelease(),
			latest: { tag_name: tag },
			others: [published('v1.9.9', '2026-09-25T09:59:58Z')],
		});
		expect(task.publish()).toEqual({ status: 'unchanged', tag });
		expect(editArgs(task)).toEqual([]);
	});

	it.each([
		['an older release', { tag_name: 'v1.9.0' }, [published('v1.9.0', '2026-08-01T00:00:00Z')]],
		['a lower release of the same batch', { tag_name: 'v1.9.9' }, [published('v1.9.9', '2026-09-25T09:59:59Z')]],
		['a custom release', { tag_name: 'custom-release' }, []],
	])('leaves a mark on %s alone without listing releases, since it may be the maintainer’s choice', (_label, latest, others) => {
		const task = mockCommands({ release: publishedRelease(), latest, others: [...others, published('v1.10.1', '2026-09-25T09:59:58Z')] });
		expect(task.publish()).toEqual({ status: 'unchanged', tag });
		expect(task.state.latest).toEqual(latest);
		expect(editArgs(task)).toEqual([]);
		expect(task.run.mock.calls.some(([, args]) => args[1] === 'list')).toBe(false);
	});

	it('does not promote a higher release published well after this one', () => {
		const task = mockCommands({
			release: publishedRelease(),
			latest: { tag_name: tag },
			others: [published('v1.10.1', '2026-09-25T10:05:00Z')],
		});
		expect(task.publish()).toEqual({ status: 'unchanged', tag });
		expect(task.state.latest).toEqual({ tag_name: tag });
		expect(editArgs(task)).toEqual([]);
	});

	it('reports an unverifiable mark on re-run without modifying the release', () => {
		const task = mockCommands({ release: publishedRelease(), latest: { tag_name: tag }, rawList: '{}' });
		expect(() => task.publish()).toThrow(`${tag} is already published, but its latest-release mark could not be verified`);
		expect(editArgs(task)).toEqual([]);
	});
});

describe('release workflow concurrency', () => {
	const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

	it('queues runs per tag so pushing several tags at once cannot cancel an intermediate version', () => {
		const block = workflow.match(/^concurrency:\n((?: {2}.*\n)+)/m)?.[1];
		expect(block).toBeDefined();
		expect(block).toMatch(/^ {2}group: publish-release-\$\{\{ github\.ref \}\}$/m);
		expect(block).toMatch(/^ {2}cancel-in-progress: false$/m);
	});
});
