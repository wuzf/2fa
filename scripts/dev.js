import { spawn } from 'node:child_process';
import { watch, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuntime, writeRuntime } from './build-runtime.js';
import { useBuiltRuntime } from './deploy-config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.wrangler', `runtime-dev-${process.pid}`, 'worker.js');
const configPath = join(root, `wrangler.dev.${process.pid}.tmp.toml`);
const config = readFileSync(join(root, 'wrangler.toml'), 'utf8');
let timer;
let building = false;
let pending = false;
let lastBuildId = '';
async function rebuild() {
	if (building) { pending = true; return; }
	building = true;
	try {
		const result = await buildRuntime();
		if (lastBuildId !== result.buildId) {
			writeRuntime(output, result.code);
			lastBuildId = result.buildId;
			console.log(`2FA build ${result.buildId.slice(0, 12)}`);
		}
	} catch (error) {
		console.error(error);
	} finally {
		building = false;
		if (pending) { pending = false; await rebuild(); }
	}
}

try {
	// Initial failures must stop rather than launch an old or missing artifact.
	const result = await buildRuntime();
	writeRuntime(output, result.code);
	lastBuildId = result.buildId;
	writeFileSync(configPath, useBuiltRuntime(config, `.wrangler/runtime-dev-${process.pid}/worker.js`));
	const watcher = watch(join(root, 'src'), { recursive: true }, () => {
		clearTimeout(timer);
		timer = setTimeout(() => void rebuild(), 100);
	});
	const cli = fileURLToPath(import.meta.resolve('wrangler'));
	const child = spawn(process.execPath, [cli, 'dev', '--config', configPath, '--env', 'development', ...process.argv.slice(2)], {
		cwd: root, stdio: 'inherit', windowsHide: true,
	});
	const cleanup = () => {
		clearTimeout(timer);
		watcher.close();
		rmSync(configPath, { force: true });
	};
	child.on('exit', code => { cleanup(); process.exitCode = code || 0; });
	child.on('error', error => { cleanup(); console.error(error); process.exitCode = 1; });
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => { cleanup(); child.kill(signal); });
	}
} catch (error) {
	rmSync(configPath, { force: true });
	console.error(error);
	process.exitCode = 1;
}
