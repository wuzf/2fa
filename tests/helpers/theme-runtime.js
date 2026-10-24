import { Window } from 'happy-dom';
import { getCoreScripts, getScripts } from '../../src/ui/scripts/index.js';
import { createMainPage } from '../../src/ui/page.js';

/** Runs the actual emitted host script, with network/clipboard as explicit effects. */
export async function createRuntimeFixture({
	full = false,
	accountDOM = true,
	fetch,
	clipboard,
	extraSource = '',
	setupWindow,
	appearance = null,
	buildId = 'runtime-integration-test',
} = {}) {
	const window = new Window({
		url: 'https://vault.test/',
		settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
	});
	const { document } = window;
	const response = await createMainPage({ lazyLoad: !full, appearance, buildId });
	const html = await response.text();
	document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
	if (!accountDOM) {
		['secretsList', 'loading', 'emptyState', 'searchInput', 'serviceNav'].forEach((id) => document.getElementById(id)?.remove());
	}
	window.__2FA_BUILD_ID__ = buildId;
	window.__2FA_APPEARANCE__ = appearance;
	window.__2FA_SHELL_CONFIG_ID__ = response.headers.get('X-2FA-Shell-Config');
	window.__2FA_ADMIN_CODE_ID__ = await crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(''))
		.then((bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''));
	window.localStorage.setItem('language', 'en');
	window.fetch = fetch || (async () => new Response('{}', { status: 503 }));
	Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: clipboard || { writeText: async () => {} } });
	setupWindow?.(window);
	// Prevent unrelated automatic startup while preserving the exported real bootstrap.
	const addListener = document.addEventListener.bind(document);
	document.addEventListener = (type, ...args) => {
		if (type !== 'DOMContentLoaded') {
			addListener(type, ...args);
		}
	};
	const source = full ? getScripts() : getCoreScripts();
	window.eval(
		source +
			`\nwindow.__runtimeFixture = {
      getThemeRuntime, getOtpEngine, getOfficialAccountView, initializeThemeApplication, initializeAppThemeIntegration,
      replaceSecretRecords, invalidateSecretSession, loadSecrets, handleSubmit,
      getState: () => accountStore.getState(),
      getPrivateRecords: () => accountStore.getRecords(),
      beginWrite: details => accountStore.beginWrite(details),
      endWrite: handle => accountStore.endWrite(handle),
      setClock: now => { trustedClock.now = () => now; trustedClock.ensureReady = async () => true; },
      dispose: () => { activeAppThemeHost?.dispose(); officialAccountView?.dispose(); themeRuntimeInstance?.dispose(); otpEngineInstance?.dispose(); otpPresentation.dispose(); }
    };` +
			extraSource,
	);
	return {
		window,
		document,
		...window.__runtimeFixture,
		async dispose() {
			window.__runtimeFixture?.dispose();
			await window.happyDOM.abort();
		},
	};
}
