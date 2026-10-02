#!/usr/bin/env node

/**
 * 本地发版准备 - 同步版本号、提交发布说明并创建 tag
 *
 * 版本号唯一数据源是 package.json，其余位置由本脚本同步：
 *   - src/utils/version.js  (APP_VERSION，前端 footer 和新版本检测依赖)
 *   - README.md / docs/en/README.md  (版本徽章)
 *
 * 使用方式：
 *   npm run release:patch          # 1.6.0 → 1.6.1
 *   npm run release:minor          # 1.6.0 → 1.7.0
 *   npm run release:major          # 1.6.0 → 2.0.0
 *   node scripts/release.js 1.8.0  # 指定版本号
 *   node scripts/release.js --sync # 仅同步（修复各处版本不一致，不提交）
 *
 * 发版流程：
 *   1. 检查 tag 未存在、发布说明已准备，且工作区除本次发布说明和未暂存的本地 wrangler.toml 外没有任何改动
 *      （含未跟踪文件）；发布说明以外的已暂存内容一律拒绝
 *   2. 按 Publish release 工作流的顺序运行 lint、全量测试（--skip-tests 跳过）、Worker 构建和扩展打包；
 *      任一失败即中止，此时尚未改动版本号，也没有提交或 tag
 *   3. 复查工作区，确认上述检查没有产生需要提交的文件（构建产物位于被忽略的 dist/）
 *   4. bump package.json + package-lock.json
 *   5. 同步 version.js 和 README 徽章
 *   6. 运行版本一致性测试自检
 *   7. 提交版本文件和 docs/releases/v{x.y.z}.md，创建对应 tag
 *   8. 提示手动执行 git push --atomic origin HEAD v{x.y.z}，同时推送发版提交和本次 tag；
 *      GitHub Actions 检查、构建并发布 Release
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { isMainModule } from './is-main-module.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** 版本号写入的所有位置（新增位置时在此登记，并同步更新 tests/utils/version.test.js 的一致性校验） */
const SYNC_TARGETS = [
	{
		file: 'src/utils/version.js',
		pattern: /(APP_VERSION = ')\d+\.\d+\.\d+(')/,
		replacement: (v) => `$1${v}$2`,
	},
	{
		file: 'README.md',
		pattern: /(badge\/version-)\d+\.\d+\.\d+(-blue)/,
		replacement: (v) => `$1${v}$2`,
	},
	{
		file: 'docs/en/README.md',
		pattern: /(badge\/version-)\d+\.\d+\.\d+(-blue)/,
		replacement: (v) => `$1${v}$2`,
	},
];

/** 发版 commit 包含的全部文件 */
const RELEASE_FILES = ['package.json', 'package-lock.json', ...SYNC_TARGETS.map((t) => t.file)];

/**
 * 打 tag 前在本地重跑的检查，命令和顺序与 .github/workflows/release.yml 的 Lint、Test、Build 步骤一致
 * （tests/scripts/release.test.js 校验两边不漂移）。tag 推送后工作流才失败时，前端版本检测已能看到新 tag，
 * 却没有对应的 Release，所以必须在本地先拦住。
 */
export const RELEASE_CHECKS = Object.freeze([
	Object.freeze({ label: 'ESLint 检查', command: 'npm run lint', skippable: false }),
	Object.freeze({ label: '全量测试', command: 'npm test -- --run', skippable: true }),
	Object.freeze({ label: 'Worker 构建', command: 'npm run build', skippable: false }),
	Object.freeze({ label: '扩展打包', command: 'npm run package:extension', skippable: false }),
]);

function run(cmd, options = {}) {
	return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...options });
}

function readPackageVersion() {
	return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
}

/**
 * Set the version of the project in package-lock.json and change nothing else.
 *
 * `npm install --package-lock-only` would resolve the whole tree again with the
 * local npm, and some npm versions drop fields such as `libc` of optional
 * platform packages. The lockfile is npm's two-space JSON, so the parsed file is
 * written back in the same format; a file that does not round-trip is rejected.
 */
export function setLockfileVersion(lockfileText, version) {
	const lockfile = JSON.parse(lockfileText);
	if (JSON.stringify(lockfile, null, 2) + '\n' !== lockfileText.replace(/\r\n/g, '\n')) {
		throw new Error('package-lock.json 不是 npm 的标准格式，请先运行 npm install 重新生成后再发版');
	}
	const root = lockfile.packages?.[''];
	if (typeof lockfile.version !== 'string' || typeof root?.version !== 'string') {
		throw new Error('package-lock.json 缺少项目版本字段');
	}
	lockfile.version = version;
	root.version = version;
	return JSON.stringify(lockfile, null, 2) + '\n';
}

/** Reject changes that would make the tested tree differ from the release tag. */
export function assertReleaseWorktree(notesFile, runCommand = run) {
	const records = runCommand('git status --porcelain=v1 -z --untracked-files=all').split('\0');
	const changes = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record) {
			continue;
		}
		const status = record.slice(0, 2);
		const paths = [record.slice(3)];
		// Porcelain -z writes a rename/copy destination before its original path.
		// Neither path is quoted, even when it contains spaces or newlines.
		if (/[RC]/.test(status)) {
			paths.push(records[++index]);
		}
		if (record[2] !== ' ' || paths.some((path) => !path)) {
			throw new Error('无法解析 Git 工作区状态，已停止发版');
		}
		changes.push({ status, paths });
	}

	const staged = changes.filter(({ status, paths }) => status[0] !== ' ' && status[0] !== '?' && paths.some((path) => path !== notesFile));
	if (staged.length) {
		throw new Error(`以下内容已暂存，请先独立提交或取消暂存，避免混入发版提交:\n   ${staged.flatMap((item) => item.paths).join('\n   ')}`);
	}
	const otherChanges = changes.filter(({ paths }) => paths.some((path) => path !== notesFile && path !== 'wrangler.toml'));
	if (otherChanges.length) {
		throw new Error(`以下内容尚未提交，请先提交功能修改再发版:\n   ${otherChanges.flatMap((item) => item.paths).join('\n   ')}`);
	}
}

/**
 * 依次运行 RELEASE_CHECKS，任一失败立即抛错，后续检查不再运行。
 * 必须在 bump 版本号之前调用：失败时版本文件、提交和 tag 都还没有改动。
 */
export function runReleaseChecks({ skipTests = false } = {}, runCommand = run) {
	for (const { label, command, skippable } of RELEASE_CHECKS) {
		if (skippable && skipTests) {
			console.warn(`⚠️  已跳过${label} (--skip-tests)\n`);
			continue;
		}
		console.log(`🧪 ${label}: ${command}\n`);
		try {
			runCommand(command, { stdio: 'inherit' });
		} catch {
			throw new Error(`${label}未通过（${command}），已停止发版；版本号、提交和 tag 均未改动`);
		}
	}
}

function bumpVersion(current, type) {
	const [major, minor, patch] = current.split('.').map(Number);
	switch (type) {
		case 'major':
			return `${major + 1}.0.0`;
		case 'minor':
			return `${major}.${minor + 1}.0`;
		case 'patch':
			return `${major}.${minor}.${patch + 1}`;
		default:
			return type; // 显式版本号
	}
}

/** 将版本号同步到 SYNC_TARGETS 中的所有文件，任一文件匹配失败则报错退出 */
function syncVersion(version) {
	let failed = false;
	for (const { file, pattern, replacement } of SYNC_TARGETS) {
		const path = join(ROOT, file);
		const content = readFileSync(path, 'utf-8');
		if (!pattern.test(content)) {
			console.error(`❌ ${file}: 未匹配到版本号模式 ${pattern}，请检查文件内容或更新 SYNC_TARGETS`);
			failed = true;
			continue;
		}
		const updated = content.replace(pattern, replacement(version));
		if (updated === content) {
			console.log(`✓  ${file} 已是 ${version}`);
		} else {
			writeFileSync(path, updated);
			console.log(`✅ ${file} → ${version}`);
		}
	}
	if (failed) {
		process.exit(1);
	}
}

function main() {
	const args = process.argv.slice(2);
	const skipTests = args.includes('--skip-tests');
	const positional = args.filter((a) => !a.startsWith('--'));

	// --sync 模式：仅把 package.json 的版本同步到其他位置
	if (args.includes('--sync')) {
		const version = readPackageVersion();
		console.log(`🔄 同步版本号 ${version}（数据源: package.json）\n`);
		syncVersion(version);
		return;
	}

	const type = positional[0];
	if (!type || (!['major', 'minor', 'patch'].includes(type) && !VERSION_PATTERN.test(type))) {
		console.error('用法: node scripts/release.js <major|minor|patch|x.y.z> [--skip-tests]');
		console.error('      node scripts/release.js --sync');
		process.exit(1);
	}

	const currentVersion = readPackageVersion();
	const newVersion = bumpVersion(currentVersion, type);
	if (!VERSION_PATTERN.test(currentVersion) || !VERSION_PATTERN.test(newVersion)) {
		console.error('❌ 版本号必须为不含前导零的 x.y.z 格式');
		process.exit(1);
	}
	const tag = `v${newVersion}`;
	const notesFile = `docs/releases/${tag}.md`;
	const notesPath = join(ROOT, notesFile);

	console.log(`\n🚀 发版: ${currentVersion} → ${newVersion}\n`);

	// 1. tag 不能已存在
	if (run(`git tag -l ${tag}`).trim()) {
		console.error(`❌ tag ${tag} 已存在，请检查版本号`);
		process.exit(1);
	}
	if (!existsSync(notesPath) || !readFileSync(notesPath, 'utf-8').trim()) {
		console.error(`❌ 请先编写 ${notesFile}，记录本版本的功能、修复和升级说明。`);
		process.exit(1);
	}
	const releaseFiles = [...RELEASE_FILES, notesFile];

	// 2. Only this release's notes and unstaged local deployment config may differ.
	try {
		assertReleaseWorktree(notesFile);
	} catch (error) {
		console.error(`❌ ${error.message}`);
		process.exit(1);
	}

	// 3. 与发布工作流相同的 lint、测试和构建，全部通过后才开始改版本号
	try {
		runReleaseChecks({ skipTests });
	} catch (error) {
		console.error(`\n❌ ${error.message}`);
		process.exit(1);
	}
	// 被测试和构建的工作区必须与即将打 tag 的内容一致；构建产物在被忽略的 dist/ 下，不应出现在这里
	try {
		assertReleaseWorktree(notesFile);
	} catch (error) {
		console.error(`❌ 发版检查运行后工作区出现了新的改动，已停止发版；版本号、提交和 tag 均未改动\n   ${error.message}`);
		process.exit(1);
	}

	// 4. bump package.json（仅替换顶层 version 字段），并同步 package-lock.json
	const pkgPath = join(ROOT, 'package.json');
	const pkgContent = readFileSync(pkgPath, 'utf-8');
	writeFileSync(pkgPath, pkgContent.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${newVersion}$2`));
	console.log(`✅ package.json → ${newVersion}`);
	const lockPath = join(ROOT, 'package-lock.json');
	writeFileSync(lockPath, setLockfileVersion(readFileSync(lockPath, 'utf-8'), newVersion));
	console.log(`✅ package-lock.json → ${newVersion}`);

	// 5. 同步其余位置
	syncVersion(newVersion);

	// 6. 版本一致性自检（tests/utils/version.test.js 校验 APP_VERSION 和 README 徽章）
	console.log('\n🔍 版本一致性自检...\n');
	run('npx vitest run tests/utils/version.test.js', { stdio: 'inherit' });

	// 7. 提交并打 tag（commit message 符合 Conventional Commits，通过 husky commit-msg 校验）
	run(`git add ${releaseFiles.join(' ')}`);
	run(`git commit -m "chore(release): bump version to ${newVersion}"`, { stdio: 'inherit' });
	run(`git tag ${tag}`);

	console.log(`\n✅ 本地发版准备完成: ${tag}（版本、发布说明和 tag 均已准备）`);
	console.log('\n📤 确认发布后，推送代码和本次标签:');
	console.log(`\n   git push --atomic origin HEAD ${tag}\n`);
	console.log('GitHub Actions 将检查版本、运行测试、构建 Worker 和扩展安装包，并发布带这些附件的 Release。');
	console.log('请确认 Publish release 工作流成功，并核对 Release 说明和附件后再结束发版。');
}

if (isMainModule(import.meta.url)) {
	main();
}
