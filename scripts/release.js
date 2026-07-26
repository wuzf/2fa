#!/usr/bin/env node

/**
 * 发版脚本 - 一条命令完成版本号同步、提交和打 tag
 *
 * 版本号唯一数据源是 package.json，其余位置由本脚本同步：
 *   - src/utils/version.js  (APP_VERSION，前端 footer 和新版本检测依赖)
 *   - README.md / README_EN.md  (版本徽章)
 *
 * 使用方式：
 *   npm run release:patch          # 1.6.0 → 1.6.1
 *   npm run release:minor          # 1.6.0 → 1.7.0
 *   npm run release:major          # 1.6.0 → 2.0.0
 *   node scripts/release.js 1.8.0  # 指定版本号
 *   node scripts/release.js --sync # 仅同步（修复各处版本不一致，不提交）
 *
 * 发版流程：
 *   1. 检查 tag 未存在、版本相关文件无未提交修改（其他文件如 wrangler.toml 允许 dirty）
 *   2. 运行全量测试（--skip-tests 跳过）
 *   3. bump package.json + package-lock.json
 *   4. 同步 version.js 和 README 徽章
 *   5. 运行版本一致性测试自检
 *   6. git commit + git tag v{x.y.z}（tag 需符合 v{x.y.z} 格式，新版本检测依赖）
 *   7. 提示手动 push（不自动 push）
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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
		file: 'README_EN.md',
		pattern: /(badge\/version-)\d+\.\d+\.\d+(-blue)/,
		replacement: (v) => `$1${v}$2`,
	},
];

/** 发版 commit 包含的全部文件 */
const RELEASE_FILES = ['package.json', 'package-lock.json', ...SYNC_TARGETS.map((t) => t.file)];

function run(cmd, options = {}) {
	return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...options });
}

function readPackageVersion() {
	return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
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
	if (!type || (!['major', 'minor', 'patch'].includes(type) && !/^\d+\.\d+\.\d+$/.test(type))) {
		console.error('用法: node scripts/release.js <major|minor|patch|x.y.z> [--skip-tests]');
		console.error('      node scripts/release.js --sync');
		process.exit(1);
	}

	const currentVersion = readPackageVersion();
	const newVersion = bumpVersion(currentVersion, type);
	const tag = `v${newVersion}`;

	console.log(`\n🚀 发版: ${currentVersion} → ${newVersion}\n`);

	// 1. tag 不能已存在
	if (run(`git tag -l ${tag}`).trim()) {
		console.error(`❌ tag ${tag} 已存在，请检查版本号`);
		process.exit(1);
	}

	// 2. 版本相关文件必须干净，避免发版 commit 混入无关修改
	//    （其他文件如 wrangler.toml 允许有本地修改，仅提示）
	const dirty = run('git status --porcelain')
		.split('\n')
		.filter(Boolean)
		.map((line) => line.slice(3).trim());
	const dirtyReleaseFiles = dirty.filter((f) => RELEASE_FILES.includes(f));
	if (dirtyReleaseFiles.length > 0) {
		console.error(`❌ 以下版本相关文件有未提交修改，请先提交或还原:\n   ${dirtyReleaseFiles.join('\n   ')}`);
		process.exit(1);
	}
	const dirtyOthers = dirty.filter((f) => !RELEASE_FILES.includes(f));
	if (dirtyOthers.length > 0) {
		console.warn(`⚠️  工作区存在其他未提交修改（不会包含在发版 commit 中）:\n   ${dirtyOthers.join('\n   ')}\n`);
	}

	// 3. 全量测试
	if (skipTests) {
		console.warn('⚠️  已跳过测试 (--skip-tests)\n');
	} else {
		console.log('🧪 运行全量测试...\n');
		run('npx vitest run', { stdio: 'inherit' });
	}

	// 4. bump package.json（仅替换顶层 version 字段），并同步 package-lock.json
	const pkgPath = join(ROOT, 'package.json');
	const pkgContent = readFileSync(pkgPath, 'utf-8');
	writeFileSync(pkgPath, pkgContent.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${newVersion}$2`));
	console.log(`✅ package.json → ${newVersion}`);
	run('npm install --package-lock-only --ignore-scripts', { stdio: 'ignore' });
	console.log(`✅ package-lock.json → ${newVersion}`);

	// 5. 同步其余位置
	syncVersion(newVersion);

	// 6. 版本一致性自检（tests/utils/version.test.js 校验 APP_VERSION 和 README 徽章）
	console.log('\n🔍 版本一致性自检...\n');
	run('npx vitest run tests/utils/version.test.js', { stdio: 'inherit' });

	// 7. 提交并打 tag（commit message 符合 Conventional Commits，通过 husky commit-msg 校验）
	run(`git add ${RELEASE_FILES.join(' ')}`);
	run(`git commit -m "chore(release): bump version to ${newVersion}"`, { stdio: 'inherit' });
	run(`git tag ${tag}`);

	console.log(`\n✅ 发版完成: ${tag}（commit + tag 均已创建）`);
	console.log('\n📤 请推送以发布（用户端新版本检测依赖远端 tag）:');
	console.log('\n   git push && git push --tags\n');
}

main();
