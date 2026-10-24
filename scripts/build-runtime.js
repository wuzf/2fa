import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const BUILD_PLACEHOLDER = '__2FA_CONTENT_BUILD_ID_5f0dc53e__';

/** Hash the complete, reproducible bundle before substituting its own identity. */
export async function buildRuntime({ rootDir = projectRoot, entryPoint = join(rootDir, 'src/worker.js'), minify = false } = {}) {
	const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
	// Compile host selector isolation at build time, not on a cold Worker request.
	// Bundle first so dev rebuilds observe changed style modules instead of Node's
	// cached ESM imports; identical source reuses the same deterministic data URL.
	let hostStyles;
	if (existsSync(join(rootDir, 'src/ui/styles/index.js'))) {
		const styles = await build({
			absWorkingDir: rootDir,
			entryPoints: [join(rootDir, 'src/ui/styles/index.js')],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			mainFields: ['browser', 'module', 'main'],
			// Compilation must use source CSS, never an ambient runtime injection
			// left on the build process by a test or previously evaluated artifact.
			define: { 'globalThis.__2FA_HOST_STYLES__': 'undefined' },
			logLevel: 'silent',
		});
		const styleModule = await import('data:text/javascript;base64,' + Buffer.from(styles.outputFiles[0].text).toString('base64'));
		hostStyles = styleModule.getStyles();
		if (typeof hostStyles !== 'string') {
			throw new TypeError('Host getStyles() must return a string during precompilation');
		}
	}
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
			...(hostStyles === undefined ? {} : { 'globalThis.__2FA_HOST_STYLES__': JSON.stringify(hostStyles) }),
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
