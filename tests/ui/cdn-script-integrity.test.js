import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

// Records the script elements the loader appends instead of fetching them.
function loadUtils() {
	const scripts = [];
	const document = {
		createElement: () => ({}),
		head: { appendChild: (element) => scripts.push(element) },
	};
	const context = createContext({ document, window: {}, console: { log() {}, warn() {}, error() {} }, t: (key) => key });
	runInContext(getUtilsCode(), context);
	return { context, scripts };
}

describe('third-party QR scripts', () => {
	it.each([
		['ensureJsQR', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'],
		['ensureQRCodeGen', 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'],
	])('%s loads a pinned file with an integrity digest', async (loader, url) => {
		const { context, scripts } = loadUtils();
		const loading = context[loader]();

		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toBe(url);
		expect(scripts[0].crossOrigin).toBe('anonymous');
		expect(scripts[0].integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
		scripts[0].onload();
		await loading;
	});

	it('does not load a jsQR file the CDN minifies on the fly', async () => {
		const { context, scripts } = loadUtils();
		const loading = context.ensureJsQR();
		// jsQR ships no .min.js; jsDelivr generates one whose bytes can change.
		expect(scripts[0].src).not.toMatch(/\.min\.js$/);
		scripts[0].onload();
		await loading;
	});

	it('lets the Service Worker cache the same files the page loads', async () => {
		const source = await createServiceWorker({ SW_VERSION: 'cdn-test' }).text();
		expect(source).toContain("'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'");
		expect(source).toContain("'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'");
	});

	it('lets a script the browser refused be loaded again', async () => {
		const { context, scripts } = loadUtils();
		const first = context.ensureQRCodeGen();
		scripts[0].onerror();
		await expect(first).rejects.toThrow('scriptLoadFailed');

		const retry = context.ensureQRCodeGen();
		expect(scripts).toHaveLength(2);
		scripts[1].onload();
		await retry;
	});
});
