/* global structuredClone */
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getPublicAppearanceStyles,
	getPublicAppearanceHead,
	getPublicAppearanceClientCode,
	isAppearanceSafeMode,
} from '../../src/ui/publicAppearance.js';
import { getStandaloneHead } from '../../src/ui/standalone.js';
import { createSetupPage } from '../../src/ui/setupPage.js';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';
import { createOAuthPopupResponse } from '../../src/utils/oauth.js';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';
import { handleRequest } from '../../src/router/handler.js';
import { handleGoogleDriveOAuthCallback } from '../../src/api/gdrive.js';
import { handleOneDriveOAuthCallback } from '../../src/api/onedrive.js';
import { createOfflinePage } from '../../src/ui/offlinePage.js';
import { createMainPage } from '../../src/ui/page.js';
import { getShellConfigId } from '../../src/ui/runtimeIdentity.js';
import { publicThemeSnapshot } from '../helpers/public-appearance.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function environment(snapshot) {
	const fetch = vi.fn(async () => Response.json(snapshot));
	return {
		fetch,
		env: {
			SECRETS_KV: { get: vi.fn(async () => null) },
			SECRETS_STORE: { idFromName: vi.fn((name) => name), get: vi.fn(() => ({ fetch })) },
			LOG_LEVEL: 'ERROR',
		},
	};
}

describe('finite public appearance rendering', () => {
	it.each(['safeMode=1', 'disableCustomCode=1'])(
		'preserves %s across setup redirects without reading public theme or administrator code',
		async (query) => {
			const snapshot = await publicThemeSnapshot();
			const { env, fetch } = environment(snapshot);
			vi.stubGlobal('__2FA_BUILD_ID__', 'a'.repeat(64));
			let configured = true;
			env.SECRETS_KV.get.mockImplementation(async (key) => (key === 'user_password' && configured ? 'synthetic-existing-hash' : null));
			fetch.mockImplementation(async (request) =>
				Response.json(
					request.headers.get('X-2FA-Store-Operation') === 'settings.get'
						? {
								customCodes: [
									{ id: 'setup-probe', name: 'Probe', enabled: true, code: '<script>window.__setupRedirectAdminProbe=true</script>' },
								],
							}
						: snapshot,
				),
			);
			const normal = await (await handleRequest(new Request('https://vault.example/'), env)).text();
			expect(normal).toContain('public-appearance-baseline');
			expect(normal).toContain('__setupRedirectAdminProbe');
			fetch.mockClear();
			const start = new Request('https://vault.example/setup?' + query);
			const redirect = await handleRequest(start, env);
			expect(redirect.status).toBe(302);
			expect(redirect.headers.get('Location')).toBe('https://vault.example/?safeMode=1');
			const destination = await handleRequest(new Request(redirect.headers.get('Location')), env);
			expect(destination.status).toBe(200);
			const html = await destination.text();
			expect(destination.headers.get('X-2FA-Runtime-Mode')).toBe('safe');
			expect(html).toContain('window.__2FA_SAFE_MODE__ = true');
			expect(html).toContain('window.__2FA_APPEARANCE__ = null');
			expect(html).not.toContain('<style id="public-appearance-baseline">');
			expect(html).not.toContain('/theme-packages/' + snapshot.packageId + '/');
			expect(html).not.toContain('__setupRedirectAdminProbe');
			expect(fetch).not.toHaveBeenCalled();
			configured = false;
			const setup = await handleRequest(start, env);
			expect(setup.status).toBe(200);
			const setupHtml = await setup.text();
			expect(setupHtml).toContain('id="setupForm"');
			expect(setupHtml).not.toContain('public-appearance-baseline');
			expect(setupHtml).not.toContain('/theme-packages/');
			expect(setupHtml).not.toContain('__setupRedirectAdminProbe');
			const toSetup = await handleRequest(new Request('https://vault.example/?' + query), env);
			expect(toSetup.status).toBe(302);
			expect(toSetup.headers.get('Location')).toBe('https://vault.example/setup?safeMode=1');
			const followedSetup = await handleRequest(new Request(toSetup.headers.get('Location')), env);
			expect(followedSetup.status).toBe(200);
			expect(await followedSetup.text()).not.toContain('public-appearance-baseline');
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it('keeps ordinary setup/root redirects unchanged for missing or inactive recovery flags', async () => {
		const { env } = environment(null);
		let configured = true;
		env.SECRETS_KV.get.mockImplementation(async (key) => (key === 'user_password' && configured ? 'synthetic-existing-hash' : null));
		for (const query of ['', '?safeMode=0', '?disableCustomCode=0', '?safeMode=true']) {
			configured = true;
			const home = await handleRequest(new Request('https://vault.example/setup' + query), env);
			expect(home.status).toBe(302);
			expect(home.headers.get('Location')).toBe('https://vault.example/');
			configured = false;
			const setup = await handleRequest(new Request('https://vault.example/' + query), env);
			expect(setup.status).toBe(302);
			expect(setup.headers.get('Location')).toBe('https://vault.example/setup');
		}
	});

	it.each(['light', 'dark'])('paints the theme background behind the startup screen until the theme mounts (%s)', async (mode) => {
		const snapshot = await publicThemeSnapshot();
		const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
		try {
			const html = await (await createMainPage({ appearance: snapshot })).text();
			window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
			const document = window.document;
			document.documentElement.dataset.theme = mode;
			const rules = [];
			const collect = (items) => {
				for (const rule of items) {
					if (rule.selectorText) {
						rules.push(rule);
					}
					if (rule.cssRules) {
						collect(rule.cssRules);
					}
				}
			};
			collect(document.getElementById('public-appearance-baseline').sheet.cssRules);
			const backgrounds = () => rules.filter((rule) => rule.style.backgroundImage === 'none' && document.body.matches(rule.selectorText));
			expect(backgrounds()).toHaveLength(0);
			document.documentElement.setAttribute('data-app-theme-startup', 'pending');
			expect(backgrounds()).toHaveLength(1);
			expect(backgrounds()[0].style.backgroundColor).toBe(mode === 'light' ? '#f4f0e6' : '#111111');
			document.documentElement.setAttribute('data-app-host-appearance', 'running');
			expect(backgrounds()).toHaveLength(0);
		} finally {
			await window.happyDOM.abort();
		}
	});

	it.each(['light', 'dark'])('scopes login background concealment to real official DOM and restores it on close (%s)', async (mode) => {
		const snapshot = await publicThemeSnapshot();
		const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
		try {
			const html = await (await createMainPage({ appearance: snapshot })).text();
			window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
			const document = window.document;
			document.documentElement.dataset.theme = mode;
			const login = document.getElementById('loginModal');
			const status = document.getElementById('appThemeRuntimeStatus');
			status.hidden = false;
			status.dataset.phase = 'login-required';
			const search = document.getElementById('searchInput'),
				app = document.getElementById('appThemeRoot');
			app.hidden = false;
			app.append(document.createElement('button'));
			const changes = vi.fn();
			search.addEventListener('input', changes);
			search.value = 'preserved';
			const rules = [];
			const collect = (items) => {
				for (const rule of items) {
					if (rule.selectorText) {
						rules.push(rule);
					}
					if (rule.cssRules) {
						collect(rule.cssRules);
					}
				}
			};
			collect(document.getElementById('public-appearance-baseline').sheet.cssRules);
			// Match the actual emitted CSS selectors against the real page DOM.
			// Chrome separately checks the in-place computed visibility/painting.
			const concealed = () =>
				new Set(
					rules.filter((rule) => rule.style.visibility === 'hidden').flatMap((rule) => [...document.querySelectorAll(rule.selectorText)]),
				);
			expect(concealed().size).toBe(0);
			login.style.display = 'flex';
			login.classList.add('show');
			const hidden = concealed();
			for (const id of [
				'officialThemeRoot',
				'officialThemeActions',
				'officialThemeFooter',
				'appThemeRuntimeStatus',
				'searchInput',
				'mainActionBtn',
			]) {
				expect(hidden.has(document.getElementById(id)), id).toBe(true);
			}
			expect(hidden.has(login)).toBe(false);
			expect(hidden.has(document.getElementById('loginToken'))).toBe(false);
			expect(hidden.has(app)).toBe(false);
			expect(hidden.has(app.firstElementChild)).toBe(false);
			const backgrounds = rules.filter((rule) => rule.style.backgroundImage === 'none' && document.body.matches(rule.selectorText));
			expect(backgrounds).toHaveLength(1);
			expect(backgrounds[0].style.backgroundColor).toBe(mode === 'light' ? '#f4f0e6' : '#111111');
			status.append(Object.assign(document.createElement('p'), { className: 'app-theme-status-recovery' }));
			expect(concealed().has(status)).toBe(false);
			status.replaceChildren();
			status.dataset.phase = 'access-unavailable';
			expect(concealed().has(status)).toBe(false);
			document.documentElement.setAttribute('data-app-host-appearance', 'running');
			expect(concealed().size).toBe(0);
			document.documentElement.removeAttribute('data-app-host-appearance');
			login.classList.remove('show');
			expect(concealed().size).toBe(0);
			expect(document.getElementById('searchInput')).toBe(search);
			expect(search.value).toBe('preserved');
			search.dispatchEvent(new window.Event('input'));
			expect(changes).toHaveBeenCalledOnce();
			expect(document.getElementById('loginModal')).toBe(login);
		} finally {
			await window.happyDOM.close();
		}
	});

	it('does not conceal background in default, v1, legacy app or safe main pages', async () => {
		const snapshot = await publicThemeSnapshot();
		for (const options of [
			{},
			{ appearance: { kind: 'v1', manifest: { settings: [] } } },
			{ appearance: { ...snapshot, publicAppearance: undefined } },
			{ appearance: snapshot, safeMode: true },
		]) {
			const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
			try {
				window.document.write((await (await createMainPage(options)).text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
				window.document.getElementById('loginModal').classList.add('show');
				expect(window.document.getElementById('public-appearance-baseline')).toBeNull();
				expect(window.document.getElementById('officialThemeRoot')).not.toBeNull();
			} finally {
				await window.happyDOM.close();
			}
		}
	});

	it('renders only selected font faces and finite host/standalone/setup properties with independent scope', async () => {
		const snapshot = await publicThemeSnapshot({ accent: 'blue' });
		for (const surface of ['host', 'standalone', 'setup']) {
			const css = getPublicAppearanceStyles({ ...snapshot, css: 'RAW_PACKAGE_CSS', customCss: 'RAW_USER_CSS' }, { surface });
			expect(css).toContain('public-appearance-baseline');
			expect(css).toContain('#123456');
			expect(css).toContain('#abcdef');
			expect(css).toContain('font-display:swap');
			expect(css).toContain('font-weight:400 700');
			expect(css).toContain('unicode-range:U+0-17F');
			expect(css).toContain(':not(#appThemeRoot):not(#appThemeRoot *)');
			expect(css).not.toContain('RAW_');
			expect(css).not.toContain('entry.js');
		}
		expect(getPublicAppearanceStyles(snapshot)).toContain('--dialog-subtle:');
		expect(getPublicAppearanceStyles(snapshot)).toContain(':not([data-app-host-appearance])');
		expect(getPublicAppearanceStyles(snapshot, { surface: 'standalone' })).toContain('--page-bg:');
		expect(getPublicAppearanceStyles(snapshot, { surface: 'setup' })).toContain('--setup-bg:');
		expect(getPublicAppearanceStyles(await publicThemeSnapshot({ handwriting: false }))).not.toContain('@font-face');
		expect(getPublicAppearanceHead({ ...snapshot, publicAppearance: undefined })).toBe('');
		expect(getPublicAppearanceHead({ ...snapshot, kind: 'v1' })).toBe('');
		expect(getPublicAppearanceHead(snapshot, { safeMode: true })).toBe('');
		const unsafe = structuredClone(snapshot);
		unsafe.publicAppearance.fonts[0].url = 'https://evil.example/font.woff2';
		expect(getPublicAppearanceHead(unsafe)).toBe('');
		unsafe.publicAppearance.fonts[0].url = snapshot.publicAppearance.fonts[0].url;
		unsafe.publicAppearance.light.fontFamily = ['</style><script>alert(1)</script>'];
		expect(getPublicAppearanceHead(unsafe)).toBe('');
	});

	it('updates only its own baseline from emitted code and leaves runtime ownership intact', async () => {
		const first = await publicThemeSnapshot(),
			second = await publicThemeSnapshot({ accent: 'blue', handwriting: false });
		const window = new Window({ url: 'https://vault.example/' }),
			document = window.document;
		document.head.innerHTML = getPublicAppearanceHead(first) + '<style data-app-host-appearance="owner">.x{color:red}</style>';
		document.documentElement.setAttribute('data-app-host-appearance', 'owner');
		const context = vm.createContext({ window, document, location: window.location, URL });
		vm.runInContext(getPublicAppearanceClientCode(), context);
		window.updatePublicAppearanceBaseline(second);
		expect(document.querySelector('#public-appearance-baseline').textContent).toContain('#123456');
		expect(document.querySelector('#public-appearance-baseline').textContent).not.toContain('@font-face');
		expect(document.documentElement.getAttribute('data-app-host-appearance')).toBe('owner');
		window.updatePublicAppearanceBaseline(null);
		expect(document.querySelector('#public-appearance-baseline')).toBeNull();
		expect(document.querySelector('style[data-app-host-appearance]').textContent).toContain('color:red');
		window.__2FA_SAFE_MODE__ = true;
		window.updatePublicAppearanceBaseline(first);
		expect(document.querySelector('#public-appearance-baseline')).toBeNull();
		await window.happyDOM.close();
	});

	it('styles real standalone templates without changing OAuth message/origin guards or importing v1 CSS', async () => {
		const snapshot = await publicThemeSnapshot(),
			request = new Request('https://vault.example/otp');
		for (const response of [
			createOtpEntryPage(request, snapshot),
			createQuickOtpPage('123456', { request, appearance: snapshot }),
			await createSetupPage(request, snapshot),
			createOAuthPopupResponse(request, { success: true, provider: 'onedrive', appOrigin: 'https://vault.example' }, snapshot),
		]) {
			const html = await response.text();
			expect(html).toContain('id="public-appearance-baseline"');
			expect(html).toContain('/theme-packages/' + snapshot.packageId + '/fonts/test.woff2');
			expect(html).not.toContain('/entry.js');
		}
		const oauth = await createOAuthPopupResponse(
			request,
			{ success: true, provider: 'onedrive', appOrigin: 'https://vault.example' },
			snapshot,
		).text();
		expect(oauth).toContain('window.opener.postMessage(payload, targetOrigin)');
		expect(oauth).toContain('const targetOrigin = "https://vault.example"');
		const v1 = { branding: { name: 'Brand' }, css: '.v1-package{}', customCss: '.v1-custom{}', manifest: { settings: [] } };
		const old = await createOAuthPopupResponse(request, { success: false, provider: 'onedrive' }, v1).text();
		expect(old).not.toContain('Brand');
		expect(old).not.toContain('.v1-package');
		expect(old).not.toContain('.v1-custom');
	});

	it.each(['safeMode=1', 'disableCustomCode=1'])('all templates suppress every theme resource for %s', async (query) => {
		const snapshot = await publicThemeSnapshot();
		snapshot.branding = { logo: '/theme-assets/' + 'a'.repeat(64) + '/logo.png', name: 'Custom Brand' };
		const request = new Request('https://vault.example/otp?' + query);
		expect(isAppearanceSafeMode(request)).toBe(true);
		for (const response of [
			createOtpEntryPage(request, snapshot),
			createQuickOtpPage('123456', { request, appearance: snapshot }),
			await createSetupPage(request, snapshot),
			createOAuthPopupResponse(request, { success: true, provider: 'onedrive' }, snapshot),
		]) {
			const html = await response.text();
			expect(html).not.toMatch(/\/theme-(?:packages|assets|preview)\//);
			expect(html).not.toContain('public-appearance-baseline');
			expect(html).not.toContain('Custom Brand');
		}
	});

	it.each(['', 'safeMode=1', 'disableCustomCode=1'])(
		'real public HTML entries read the published projection only when enabled (%s)',
		async (query) => {
			const snapshot = await publicThemeSnapshot(),
				{ env, fetch } = environment(snapshot);
			vi.stubGlobal('__2FA_BUILD_ID__', 'a'.repeat(64));
			const request = (path) =>
				new Request('https://vault.example' + path + (query ? '?' + query : ''), { headers: { Accept: 'text/html' } });
			const responses = [
				await handleGenerateOTP('', request('/otp'), env),
				await handleGenerateOTP('JBSWY3DPEHPK3PXP', request('/otp/JBSWY3DPEHPK3PXP'), env),
				await handleRequest(request('/setup'), env),
				await handleGoogleDriveOAuthCallback(request('/api/gdrive/oauth/callback'), env),
				await handleOneDriveOAuthCallback(request('/api/onedrive/oauth/callback'), env),
			];
			for (const response of responses) {
				const html = await response.text();
				if (query) {
					expect(html).not.toContain('public-appearance-baseline');
				} else {
					expect(html).toContain('public-appearance-baseline');
				}
			}
			if (query) {
				expect(fetch).not.toHaveBeenCalled();
			} else {
				expect(fetch).toHaveBeenCalledTimes(5);
			}
		},
	);

	it('keeps OTP JSON/errors and standalone offline/export fallbacks independent of theme storage', async () => {
		const { env, fetch } = environment(await publicThemeSnapshot());
		for (const path of ['/otp/JBSWY3DPEHPK3PXP?format=json', '/otp/!invalid', '/otp/JBSWY3DPEHPK3PXP?digits=7']) {
			const secret = path.split('/')[2].split('?')[0],
				response = await handleGenerateOTP(secret, new Request('https://vault.example' + path), env);
			expect(response.headers.get('Content-Type')).toContain('application/json');
		}
		expect(fetch).not.toHaveBeenCalled();
		expect(getStandaloneHead('Export backup')).not.toContain('public-appearance-baseline');
		expect(createOfflinePage()).not.toContain('public-appearance-baseline');
		expect(getStandaloneHead('Export backup')).not.toContain('/theme-packages/');
		const a = await publicThemeSnapshot(),
			b = await publicThemeSnapshot({ accent: 'blue' });
		expect(await getShellConfigId({ appearance: a })).not.toBe(await getShellConfigId({ appearance: b }));
	});
});

describe('installed app colors', () => {
	it('colors the navigation bar and splash with the app theme background, and keeps the defaults otherwise', async () => {
		const { createManifest } = await import('../../src/ui/manifest.js');
		const colors = async (appearance, url = 'https://vault.example/manifest.json') => {
			const data = await createManifest(new Request(url), appearance).json();
			return [data.theme_color, data.background_color];
		};
		const snapshot = await publicThemeSnapshot();
		expect(await colors(snapshot)).toEqual(['#f4f0e6', '#f4f0e6']);
		const surfaceOnly = structuredClone(snapshot);
		delete surfaceOnly.publicAppearance.light.subtle;
		expect(await colors(surfaceOnly)).toEqual(['#fffdf7', '#fffdf7']);
		expect(await colors(snapshot, 'https://vault.example/manifest.json?safeMode=1')).toEqual(['#2196F3', '#ffffff']);
		expect(await colors(null)).toEqual(['#2196F3', '#ffffff']);
		expect(await colors({ ...snapshot, publicAppearance: undefined })).toEqual(['#2196F3', '#ffffff']);
		expect(await colors({ ...snapshot, publicAppearance: { ...snapshot.publicAppearance, packageId: 'b'.repeat(64) } })).toEqual([
			'#2196F3',
			'#ffffff',
		]);
		const invalid = structuredClone(snapshot);
		invalid.publicAppearance.light.subtle = 'red;}';
		expect(await colors(invalid)).toEqual(['#2196F3', '#ffffff']);
	});
});
