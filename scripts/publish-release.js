#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from './is-main-module.js';
import { releaseAssetNames } from './release-assets.js';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const repoPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
// Tags pushed together publish in parallel (the workflow's concurrency group is
// per tag). A run can only take the latest mark from a release published between
// its own latest check and its own publication, a few seconds apart, and its
// corrections follow within the retry delays below. Releases published within
// this distance of the current one, before or after, form its batch. Marks on
// anything outside the batch were set by the maintainer and are left alone.
const batchWindowMs = 2 * 60 * 1000;
const releaseListLimit = 1000;
const settleAttempts = 5;
// GitHub can briefly return the previous latest release after a change. Reading
// it too early could hide a wrong mark or report a correct one as failed, so
// every read after this run changed the mark, and every retry, first waits a
// little longer each time: 2, 4, 6, 8 and 10 seconds at most.
const settleRetryDelayMs = 2000;

function sleepSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function parseReleaseArgs(args) {
	const options = {};
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		if (!['--tag', '--repo'].includes(name) || !args[index + 1] || options[name.slice(2)] !== undefined) {
			throw new Error('Usage: node scripts/publish-release.js --tag vX.Y.Z --repo owner/name');
		}
		options[name.slice(2)] = args[index + 1];
	}
	return options;
}

function readNonemptyFile(path) {
	if (!lstatSync(path).isFile()) {
		throw new Error(`Release input must be a regular file: ${path}`);
	}
	const content = readFileSync(path);
	if (!content.toString('utf8').trim()) {
		throw new Error(`Release input is empty: ${path}`);
	}
	return content;
}

function isNotFound(error) {
	// Do not mistake authentication, rate-limit, network, or missing-executable
	// failures for a nonexistent release. These are gh's explicit 404 forms.
	const output = [error?.stderr, error?.stdout].filter(Boolean).join('\n');
	return /\bHTTP 404\b/.test(output) || /^\s*release not found\s*$/im.test(output);
}

/** Compare two validated vX.Y.Z tags numerically: negative, zero, or positive. */
function compareTags(left, right) {
	const leftParts = left.slice(1).split('.').map(BigInt);
	const rightParts = right.slice(1).split('.').map(BigInt);
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] > rightParts[index] ? 1 : -1;
		}
	}
	return 0;
}

function latestMayAdvance(currentTag, latest) {
	if (!latest) {
		return true;
	}
	if (!tagPattern.test(latest.tag_name)) {
		return false;
	}
	return compareTags(currentTag, latest.tag_name) >= 0;
}

function assertRelease(release, tag) {
	if (
		!release ||
		release.tagName !== tag ||
		typeof release.isDraft !== 'boolean' ||
		typeof release.isPrerelease !== 'boolean' ||
		!Array.isArray(release.assets)
	) {
		throw new Error('GitHub returned an invalid release response');
	}
}

function assertAssets(release, assets, { verifyContents = false, onlyAllowed = false } = {}) {
	if (onlyAllowed && release.assets.some((asset) => !assets.some((local) => local.name === asset.name))) {
		throw new Error('Draft contains unexpected assets; review them before publishing');
	}
	for (const local of assets) {
		const matching = release.assets.filter((asset) => asset.name === local.name);
		const remote = matching[0];
		if (matching.length !== 1 || remote.state !== 'uploaded' || !Number.isInteger(remote.size) || remote.size <= 0) {
			throw new Error(`Release asset is missing or incomplete: ${local.name}`);
		}
		if (verifyContents && (remote.size !== local.size || (remote.digest && remote.digest !== local.digest))) {
			throw new Error(`Uploaded release asset does not match the local build: ${local.name}`);
		}
	}
}

/** Publish a verified existing tag. This function never pushes or creates tags. */
export function publishRelease({ tag, repo, rootDir = defaultRoot, run = execFileSync, sleep = sleepSync } = {}) {
	if (typeof tag !== 'string' || !tagPattern.test(tag)) {
		throw new Error('Release tag must use the exact vX.Y.Z format');
	}
	if (typeof repo !== 'string' || !repoPattern.test(repo) || repo.endsWith('.git')) {
		throw new Error('Repository must use the owner/name format');
	}
	const root = resolve(rootDir);
	const version = tag.slice(1);
	const notesPath = join(root, 'docs', 'releases', `${tag}.md`);
	readNonemptyFile(notesPath);
	const packageJson = JSON.parse(readNonemptyFile(join(root, 'package.json')).toString('utf8'));
	// The Worker files and one extension package per browser, named with the
	// extension's own version.
	const extensionManifest = JSON.parse(readNonemptyFile(join(root, 'extension', 'manifest.base.json')).toString('utf8'));
	const assetNames = releaseAssetNames(extensionManifest.version);
	const assets = assetNames.map((name) => {
		const path = join(root, 'dist', name);
		const content = readNonemptyFile(path);
		return { name, path, content, size: content.length, digest: `sha256:${createHash('sha256').update(content).digest('hex')}` };
	});
	const metadata = JSON.parse(assets.find((asset) => asset.name === 'worker.metadata.json').content.toString('utf8'));
	const worker = assets.find((asset) => asset.name === 'worker.js').content.toString('utf8');
	const banner = worker.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1] || '';
	const bannerVersions = [...banner.matchAll(/^\s*\*\s*@version\s+(\S+)\s*$/gm)].map((match) => match[1]);
	if (packageJson.version !== version || metadata.version !== version || bannerVersions.length !== 1 || bannerVersions[0] !== version) {
		throw new Error('Tag, package.json, worker metadata, and Worker banner versions must match');
	}

	const command = (binary, args) =>
		String(run(binary, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })).trim();
	if (command('git', ['status', '--porcelain', '--untracked-files=normal'])) {
		throw new Error('Release publishing requires a clean working tree and index');
	}
	const head = command('git', ['rev-parse', '--verify', 'HEAD^{commit}']);
	const tagCommit = command('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
	if (!commitPattern.test(head) || head !== tagCommit) {
		throw new Error('HEAD must be the commit referenced by the release tag');
	}
	const ref = `refs/tags/${tag}`;
	// Validate the exact target repository using gh's credentials, independently
	// of origin or checkout credentials. Annotated tags may point to other tags.
	const remote = JSON.parse(command('gh', ['api', `repos/${repo}/git/ref/tags/${tag}`]));
	if (remote?.ref !== ref) {
		throw new Error('Remote release tag is missing or does not match HEAD');
	}
	let object = remote.object;
	const visited = new Set();
	while (object?.type === 'tag') {
		if (!commitPattern.test(object.sha) || visited.has(object.sha) || visited.size >= 16) {
			throw new Error('Remote annotated tag cannot be resolved safely');
		}
		visited.add(object.sha);
		const annotation = JSON.parse(command('gh', ['api', `repos/${repo}/git/tags/${object.sha}`]));
		if (annotation?.sha !== object.sha) {
			throw new Error('Remote annotated tag response does not match its object ID');
		}
		object = annotation.object;
	}
	if (object?.type !== 'commit' || object.sha !== head) {
		throw new Error('Remote release tag is missing or does not match HEAD');
	}

	const readJsonOrMissing = (args) => {
		let output;
		try {
			output = command('gh', args);
		} catch (error) {
			if (isNotFound(error)) {
				return null;
			}
			throw error;
		}
		const result = JSON.parse(output);
		if (!result || typeof result !== 'object' || Array.isArray(result)) {
			throw new Error('GitHub returned an invalid JSON response');
		}
		return result;
	};
	const readRelease = () => {
		const release = readJsonOrMissing(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,assets']);
		if (release) {
			assertRelease(release, tag);
		}
		return release;
	};
	const readLatest = () => {
		const latest = readJsonOrMissing(['api', `repos/${repo}/releases/latest`]);
		if (latest && (typeof latest.tag_name !== 'string' || !latest.tag_name)) {
			throw new Error('GitHub returned an invalid latest release response');
		}
		return latest;
	};
	const listPublishedStableReleases = () => {
		const releases = JSON.parse(
			command('gh', [
				'release',
				'list',
				'--repo',
				repo,
				'--limit',
				String(releaseListLimit),
				'--json',
				'tagName,isDraft,isPrerelease,publishedAt',
			]),
		);
		if (
			!Array.isArray(releases) ||
			releases.some(
				(item) => !item || typeof item.tagName !== 'string' || typeof item.isDraft !== 'boolean' || typeof item.isPrerelease !== 'boolean',
			)
		) {
			throw new Error('GitHub returned an invalid release list response');
		}
		return releases
			.filter((item) => !item.isDraft && !item.isPrerelease && tagPattern.test(item.tagName))
			.map((item) => {
				const publishedAt = Date.parse(item.publishedAt);
				if (!Number.isFinite(publishedAt)) {
					throw new Error('GitHub returned an invalid release list response');
				}
				return { tag: item.tagName, publishedAt };
			});
	};
	// Each run decides latest from its own snapshot. When a lower tag's snapshot
	// predates a higher tag's publication but its write lands afterwards, the
	// lower tag takes the mark. Every run therefore re-checks after publishing and
	// moves a mark left on a lower release of the same batch to the batch's
	// highest stable release, then re-reads, so the run that wrote last always
	// confirms the final state. A re-run of an already published release only
	// repairs a mark on its own tag, the one mark an earlier attempt could have
	// written; any other mark may be the maintainer's choice.
	const settleLatest = ({ publishedNow, markedOnPublish }) => {
		let problem = 'the latest mark kept changing while parallel releases were published';
		// The release this run last marked latest, until a read shows it.
		let expected = markedOnPublish ? tag : null;
		let mismatchRechecked = false;
		for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
			if (expected !== null || attempt > 0) {
				sleep(settleRetryDelayMs * (attempt + 1));
			}
			const latest = readLatest();
			const current = latest?.tag_name ?? null;
			if (expected !== null && current !== expected && !mismatchRechecked) {
				// Either GitHub still returns the value from before this run's change,
				// which may look settled although the change took effect, or another run
				// or the maintainer changed the mark since. Look once more before deciding.
				mismatchRechecked = true;
				problem = 'GitHub kept returning a different latest release than the one just set';
				continue;
			}
			expected = null;
			mismatchRechecked = false;
			if (current !== null && !tagPattern.test(current)) {
				return;
			}
			if (!publishedNow && current !== tag) {
				return;
			}
			const published = listPublishedStableReleases();
			const self = published.find((item) => item.tag === tag);
			if (!self) {
				// The list can lag behind a publication that just happened.
				problem = 'the published release is missing from the release list';
				continue;
			}
			const batch = published.filter((item) => Math.abs(item.publishedAt - self.publishedAt) <= batchWindowMs);
			const highest = batch.reduce((best, item) => (compareTags(item.tag, best.tag) > 0 ? item : best), self);
			if (current !== null && compareTags(current, highest.tag) >= 0) {
				return;
			}
			if (current !== null && !batch.some((item) => item.tag === current)) {
				return;
			}
			// Also reached when GitHub still returns the value from before a change
			// this run made; repeating the same change is harmless.
			problem = 'the latest mark kept changing while parallel releases were published';
			command('gh', ['release', 'edit', highest.tag, '--repo', repo, '--latest=true']);
			expected = highest.tag;
		}
		throw new Error(problem);
	};

	const existing = readRelease();
	if (existing && !existing.isDraft) {
		if (existing.isPrerelease) {
			throw new Error('An existing prerelease cannot be treated as a completed stable release');
		}
		assertAssets(existing, assets);
		// An earlier attempt may have published and marked this release, then
		// failed before its latest check finished; complete that check now.
		try {
			settleLatest({ publishedNow: false, markedOnPublish: false });
		} catch (error) {
			throw new Error(
				`${tag} is already published, but its latest-release mark could not be verified (${error.message}); check the Releases page`,
			);
		}
		return { status: 'unchanged', tag };
	}
	if (existing && (existing.isPrerelease || existing.assets.some((asset) => !assetNames.includes(asset.name)))) {
		throw new Error('Existing draft is a prerelease or contains unexpected assets; review it before publishing');
	}
	// Resolve read-only failures before creating or changing a draft.
	readLatest();
	if (!existing) {
		command('gh', [
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
			notesPath,
		]);
	} else {
		command('gh', ['release', 'edit', tag, '--repo', repo, '--title', tag, '--notes-file', notesPath]);
	}
	command('gh', ['release', 'upload', tag, ...assets.map((asset) => asset.path), '--repo', repo, '--clobber']);
	const ready = readRelease();
	if (!ready?.isDraft || ready.isPrerelease) {
		throw new Error('Expected a stable-release draft until all assets are verified');
	}
	assertAssets(ready, assets, { verifyContents: true, onlyAllowed: true });
	// A newer release may have appeared while this one was uploading.
	const latest = latestMayAdvance(tag, readLatest());
	command('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', `--latest=${latest}`]);
	const published = readRelease();
	if (!published || published.isDraft || published.isPrerelease) {
		throw new Error('Could not verify that the release is published as a stable release');
	}
	assertAssets(published, assets, { verifyContents: true, onlyAllowed: true });
	try {
		settleLatest({ publishedNow: true, markedOnPublish: latest });
	} catch (error) {
		throw new Error(`${tag} is published, but its latest-release mark could not be verified (${error.message}); check the Releases page`);
	}
	return { status: 'published', tag, latest };
}

if (isMainModule(import.meta.url)) {
	try {
		const result = publishRelease(parseReleaseArgs(process.argv.slice(2)));
		console.log(
			result.status === 'unchanged' ? `${result.tag}: existing published release is complete; unchanged.` : `${result.tag}: published.`,
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
