import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRuntimeManifest } from '../../src/ui/runtimeManifest.js';
import { createMainPage } from '../../src/ui/page.js';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { createDefaultAppearance } from '../../src/api/themes.js';
import { createManifest } from '../../src/ui/manifest.js';
import { Window } from 'happy-dom';

const buildId = 'b'.repeat(64);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function description({ appearance = createDefaultAppearance(), mode = 'official', customCodes = [] } = {}) {
	return (
		await createRuntimeManifest(
			new Request(
				'https://vault.test/api/runtime-manifest?build=' +
					buildId +
					'&appearance=' +
					(mode === 'safe' ? 0 : appearance.revision) +
					'&mode=' +
					mode,
			),
			{ appearance, buildId, customCodes },
		)
	).json();
}

describe('runtime descriptor response-byte contract', () => {
	it('keeps safe-mode launch shortcuts and protocol imports inside the recovery shell', async () => {
		for (const query of ['safeMode=1', 'disableCustomCode=1']) {
			const manifest = await createManifest(new Request('https://vault.test/manifest.json?' + query), {
				branding: { name: 'Custom theme', icon192: '/theme-assets/' + 'a'.repeat(64) + '/icon.png' },
			}).json();
			for (const url of [
				manifest.start_url,
				...manifest.shortcuts.map((item) => item.url),
				...manifest.protocol_handlers.map((item) => item.url),
			]) {
				expect(new URL(url, 'https://vault.test').searchParams.get('safeMode')).toBe('1');
			}
			expect(manifest.name).not.toBe('Custom theme');
			expect(manifest.icons.every((icon) => icon.src.includes('safeMode=1'))).toBe(true);
		}
	});
	it('includes all lazy host modules and both local QR dependencies with real response hashes', async () => {
		const manifest = await description();
		const modules = manifest.resources.filter((resource) => resource.role === 'module');
		expect(modules).toHaveLength(7);
		for (const module of modules) {
			const name = new URL(module.url, 'https://vault.test').pathname.split('/').pop().slice(0, -3);
			expect(module.sha256).toBe(digest(getModuleCode(name)));
			expect(module.access).toBe('authenticated');
		}
		expect(manifest.resources.filter((resource) => resource.role === 'vendor')).toHaveLength(2);
		expect(manifest.resources.filter((resource) => resource.role === 'manifest')).toHaveLength(30);
		const response = await createMainPage({ appearance: createDefaultAppearance(), buildId, customCodes: [], lazyLoad: true });
		expect(manifest.shellConfigId).toBe(response.headers.get('X-2FA-Shell-Config'));
		expect(manifest.resources.find((resource) => resource.url === '/').sha256).toBe(digest(new Uint8Array(await response.arrayBuffer())));
	});
	it('distinguishes changed administrator code even with the same build and appearance revision', async () => {
		const before = await description();
		const after = await description({
			customCodes: [{ id: 'example', name: 'Example', enabled: true, code: '<style>.example{color:red}</style>' }],
		});
		expect(after.tuple).toEqual(before.tuple);
		expect(after.shellConfigId).not.toBe(before.shellConfigId);
		expect(after.inventoryHash).not.toBe(before.inventoryHash);
	});
	it('makes recovery independent of installed theme files, branding images and administrator code', async () => {
		const appearance = {
			...createDefaultAppearance(),
			kind: 'app',
			packageId: 'a'.repeat(64),
			files: [
				{
					path: 'entry.js',
					url: '/theme-packages/' + 'a'.repeat(64) + '/entry.js',
					mime: 'text/javascript',
					size: 1,
					hash: 'c'.repeat(64),
				},
			],
			branding: { name: 'INSTALLED_THEME', icon192: '/theme-assets/' + 'a'.repeat(64) + '/icon.png' },
		};
		const manifest = await description({
			mode: 'safe',
			appearance,
			customCodes: [{ id: 'bad', name: 'bad', enabled: true, code: '<script>UNSAFE_CUSTOM_CODE()</script>' }],
		});
		expect(manifest.tuple).toMatchObject({ mode: 'safe', packageId: null, appearanceRevision: 0 });
		expect(manifest.resources.some((resource) => ['package', 'asset', 'module'].includes(resource.role))).toBe(false);
		expect(manifest.resources.find((resource) => resource.role === 'recovery').url).toBe('/?safeMode=1');
		const response = await createMainPage({ appearance, buildId, safeMode: true, customCode: '<script>UNSAFE_CUSTOM_CODE()</script>' });
		const html = await response.text();
		expect(html).not.toContain('UNSAFE_CUSTOM_CODE()');
		expect(html).not.toContain('INSTALLED_THEME');
		expect(html).toContain('href="/icon-192.png?safeMode=1"');
		expect(manifest.shellConfigId).toBe(response.headers.get('X-2FA-Shell-Config'));
		expect(manifest.resources.filter((resource) => resource.role === 'vendor')).toHaveLength(2);
		const window = new Window({ settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
		try {
			window.fetch = async () => new Response('{}', { status: 503 });
			window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
			const addListener = window.document.addEventListener.bind(window.document);
			window.document.addEventListener = (type, ...args) => {
				if (type !== 'DOMContentLoaded') {
					addListener(type, ...args);
				}
			};
			const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
			for (const script of scripts) {
				window.eval(script);
			}
			expect(window.__2FA_SAFE_MODE__).toBe(true);
			expect(typeof window.showAppearanceEditor).toBe('function');
			expect(window.eval('typeof showQRCode')).toBe('function');
			expect(window.eval('typeof showImportModal')).toBe('function');
			expect(window.eval('typeof showExportFormatModal')).toBe('function');
		} finally {
			await window.happyDOM.abort();
		}
	});
	it('rejects mismatched build or appearance instead of returning a different runtime', async () => {
		const options = { appearance: createDefaultAppearance(), buildId };
		expect(
			(await createRuntimeManifest(new Request('https://vault.test/api/runtime-manifest?build=old&appearance=0&mode=official'), options))
				.status,
		).toBe(409);
		expect(
			(
				await createRuntimeManifest(
					new Request('https://vault.test/api/runtime-manifest?build=' + buildId + '&appearance=2&mode=official'),
					options,
				)
			).status,
		).toBe(409);
	});
});
