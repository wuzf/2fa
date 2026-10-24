import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('bundled service worker browser closures', () => {
	it.each([[false, false], [false, true], [true, false], [true, true]])(
		'boots emitted snapshot factories with keepNames=%s minify=%s', async (keepNames, minify) => {
			const output = await build({
				stdin: { contents: "export {createServiceWorker} from './src/ui/serviceworker.js';", resolveDir: process.cwd() },
				bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022', keepNames, minify,
				define: { 'globalThis.__2FA_BUILD_ID__': JSON.stringify('a'.repeat(64)) },
			});
			const module = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
			const script = await module.createServiceWorker().text();
			const events = new Map();
			const log = vi.fn();
			runInNewContext(script, {
				self: { location: { origin: 'https://2fa.test' }, clients: {}, addEventListener: (name, callback) => events.set(name, callback) },
				caches: {}, fetch: vi.fn(), indexedDB: {}, console: { log, warn: log, error: log }, URL,
			});
			expect(events.has('fetch')).toBe(true);
			expect(events.has('message')).toBe(true);
		},
	);
});
