import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const BUILD_PLACEHOLDER = '__2FA_CONTENT_BUILD_ID_5f0dc53e__';

/** Hash the complete, reproducible bundle before substituting its own identity. */
export async function buildRuntime({ rootDir = projectRoot, entryPoint = join(rootDir, 'src/worker.js'), minify = false } = {}) {
	const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
	const result = await build({
		absWorkingDir: rootDir,
		entryPoints: [entryPoint],
		bundle: true,
		write: false,
		format: 'esm',
		target: 'es2022',
		platform: 'neutral',
		mainFields: ['browser', 'module', 'main'],
		minify,
		sourcemap: false,
		metafile: true,
		define: {
			'process.env.VERSION': JSON.stringify(pkg.version),
			'process.env.BUILD_DATE': JSON.stringify(''),
			'globalThis.__2FA_BUILD_ID__': JSON.stringify(BUILD_PLACEHOLDER),
			'globalThis.__BUILD_SW_VERSION__': JSON.stringify(BUILD_PLACEHOLDER),
		},
		logLevel: 'silent',
	});
	const unversioned = result.outputFiles[0].text;
	const buildId = createHash('sha256').update(unversioned).digest('hex');
	return { code: unversioned.replaceAll(BUILD_PLACEHOLDER, buildId), buildId, metafile: result.metafile };
}

/** Atomic replacement prevents Wrangler from reading a half-written bundle. */
export function writeRuntime(outputPath, code) {
	mkdirSync(dirname(outputPath), { recursive: true });
	const staging = `${outputPath}.${process.pid}.pending`;
	writeFileSync(staging, code, 'utf8');
	renameSync(staging, outputPath);
}
