import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { MAX_CUSTOM_CODE_LENGTH } from '../../src/utils/settings.js';

const windows = [];

function parsePage(html) {
	const window = new Window({ url: 'https://vault.example/', settings: { disableJavaScriptEvaluation: true } });
	windows.push(window);
	window.document.write(html);
	return window.document;
}

afterEach(async () => {
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
});

describe('custom code in the main document', () => {
	it.each([true, false])('preserves HTML, CSS and script order after application code (lazyLoad: %s)', async (lazyLoad) => {
		const customCode = [
			'<style id="custom-style">.custom-banner::after { content: "<style> & 中文"; }</style>',
			'<aside id="custom-banner" class="custom-banner">Custom &amp; HTML</aside>',
			'<script id="custom-library" src="https://cdn.example/library.js" defer></script>',
			'<script id="custom-script">document.addEventListener("DOMContentLoaded", () => { window.customReady = true; }); window.addEventListener("load", () => { window.customLoaded = true; });</script>',
		].join('\n');
		const html = await (await createMainPage({ lazyLoad, customCode })).text();
		const document = parsePage(html);
		const scripts = [...document.scripts];
		const script = document.getElementById('custom-script');

		expect(html.endsWith(customCode + '</body>\n</html>')).toBe(true);
		expect(html.split(customCode)).toHaveLength(2);
		expect(scripts.at(-3).textContent).toContain('function showSettingsModal(');
		expect(scripts.at(-2).id).toBe('custom-library');
		expect(scripts.at(-2).src).toBe('https://cdn.example/library.js');
		expect(scripts.at(-2).defer).toBe(true);
		expect(scripts.at(-1)).toBe(script);
		expect(script.textContent).toContain('document.addEventListener("DOMContentLoaded"');
		expect(script.textContent).toContain('window.addEventListener("load"');
		expect(document.getElementById('custom-banner').textContent).toBe('Custom & HTML');
		expect(document.getElementById('custom-style').textContent).toContain('content: "<style> & 中文"');
	});

	it('leaves the list empty until the authenticated settings request fills the editors', async () => {
		const customCode = '</textarea><script id="raw-source">window.text = `quoted ${"value"} & <tag>`;</script>';
		const document = parsePage(await (await createMainPage({ customCode })).text());
		expect(document.getElementById('settingsCustomCodeList').children).toHaveLength(0);
		expect(document.getElementById('settingsCustomCodeAdd').disabled).toBe(true);
		expect(document.getElementById('settingsCustomCodeSave')).toBeNull();
		expect(document.getElementById('settingsCustomCodeReload')).toBeNull();
		expect(document.querySelectorAll('#raw-source')).toHaveLength(1);
		expect(document.getElementById('settingsModal').contains(document.getElementById('raw-source'))).toBe(false);
		expect(document.querySelector('[href="/?disableCustomCode=1"]')).not.toBeNull();
	});

	it('renders only enabled snippets in their saved order', async () => {
		const customCodes = [
			{ id: 'style', name: 'Theme', enabled: true, code: '<style id="enabled-style">body{color:red}</style>' },
			{ id: 'off', name: 'Off', enabled: false, code: '<script id="disabled-script">window.shouldNotRun=true</script>' },
			{ id: 'script', name: 'Script', enabled: true, code: '<script id="enabled-script">window.customLoaded=true</script>' },
		];
		const html = await (await createMainPage({ customCodes })).text();
		expect(html).toContain(customCodes[0].code + '\n' + customCodes[2].code);
		expect(html).not.toContain(customCodes[1].code);
		expect(parsePage(html).getElementById('disabled-script')).toBeNull();
	});

	it('does not resurrect legacy code when the list is empty or invalid', async () => {
		const customCode = '<script id="legacy-should-not-run">window.legacy = true</script>';
		for (const customCodes of [[], null, {}, [{ id: 'invalid' }]]) {
			const html = await (await createMainPage({ customCode, customCodes })).text();
			expect(html).not.toContain(customCode);
		}
	});

	it('allows the total code limit plus separators between valid snippets', async () => {
		const customCodes = [
			{ id: 'first', name: '', enabled: true, code: 'a'.repeat(MAX_CUSTOM_CODE_LENGTH - 1) },
			{ id: 'last', name: '', enabled: true, code: 'b' },
		];
		const html = await (await createMainPage({ customCodes })).text();
		expect(html.endsWith(customCodes[0].code + '\nb</body>\n</html>')).toBe(true);
	});

	it.each([undefined, null, false, 42, {}, [], 'x'.repeat(MAX_CUSTOM_CODE_LENGTH + 1)])(
		'ignores missing, non-string or oversized code (%#)',
		async (customCode) => {
			const baseline = await (await createMainPage()).text();
			expect(await (await createMainPage({ customCode })).text()).toBe(baseline);
		},
	);

	it('preserves the security and cache headers when custom scripts are enabled', async () => {
		const baseline = await createMainPage();
		const response = await createMainPage({ customCode: '<script src="https://cdn.example/custom.js"></script>' });

		const stableHeaders = (headers) => [...headers].filter(([name]) => name !== 'x-2fa-shell-config');
		expect(stableHeaders(response.headers)).toEqual(stableHeaders(baseline.headers));
		// Custom code changes the exact shell identity, while all security/cache headers remain identical.
		expect(response.headers.get('X-2FA-Shell-Config')).toMatch(/^[a-f0-9]{64}$/);
		expect(response.headers.get('X-2FA-Shell-Config')).not.toBe(baseline.headers.get('X-2FA-Shell-Config'));
		expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Cache-Control')).toContain('no-store');
	});
});

async function recoveryNavigation(fetchImpl, initialEntries) {
	const listeners = new Map();
	const self = { location: { origin: 'https://vault.example' }, addEventListener: (type, listener) => listeners.set(type, listener) };
	const entries = new Map(initialEntries);
	const put = vi.fn(async (request, response) => entries.set(request.url, response));
	const caches = {
		match: vi.fn(async (request) => entries.get(request.url)),
		open: vi.fn(async () => ({ put })),
	};
	const source = await createServiceWorker({ SW_VERSION: 'custom-code-recovery-test' }).text();
	// Exercise the emitted worker, including its query-sensitive navigation cache.
	// eslint-disable-next-line no-new-func
	new Function('self', 'fetch', 'caches', 'console', source)(self, fetchImpl, caches, { log() {}, warn() {}, error() {} });
	const request = new Request('https://vault.example/?disableCustomCode=1');
	let response;
	let background;
	listeners.get('fetch')({
		request,
		respondWith: (promise) => {
			response = promise;
		},
		waitUntil: (promise) => {
			background = promise;
		},
	});
	return { response: await response, background, request, entries, put, caches };
}

describe('custom code recovery with a controlling service worker', () => {
	it('does not fall back to ordinary cached custom code when recovery has no network', async () => {
		const broken = new Response('<script>document.body.remove()</script>');
		const h = await recoveryNavigation(vi.fn().mockRejectedValue(new TypeError('Offline')), [['https://vault.example/', broken]]);

		expect(h.response.status).toBe(503);
		expect(await h.response.text()).not.toContain('document.body.remove()');
		expect(h.caches.match).toHaveBeenCalledWith(h.request);
		expect(h.put).not.toHaveBeenCalled();
	});

	it('caches recovery separately and leaves the ordinary document available', async () => {
		const ordinary = new Response('Ordinary page with custom code');
		const h = await recoveryNavigation(
			vi.fn(async () => new Response('Recovery page')),
			[['https://vault.example/', ordinary]],
		);
		await h.background;

		expect(await h.response.text()).toBe('Recovery page');
		expect(h.entries.get('https://vault.example/')).toBe(ordinary);
		expect(await h.entries.get('https://vault.example/?disableCustomCode=1').text()).toBe('Recovery page');
	});
});
