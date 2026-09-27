import { expect, test, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { trackRealTabFocus } from './focus-fixture.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TEST_SECRET = 'JBSWY3DPEHPK3PXP';
const EU_ORG_FIXTURE = readFileSync(join(ROOT, 'tests', 'extension', 'fixtures', 'eu-org-otp.html'), 'utf8');

let server;
let sourceOrigin;
let targetOrigin;
let requests;
let extraAccounts = [];
let clockAnchor = null;
let secretResponseDelayMs = 0;

function htmlResponse(response, body, headers = {}) {
	response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
	response.end(body);
}

function jsonResponse(response, status, body) {
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	response.end(JSON.stringify(body));
}

test.beforeAll(async () => {
	requests = { secrets: [], time: 0, refresh: 0 };
	server = createServer((request, response) => {
		const url = new URL(request.url, 'http://fixture.invalid');
		if (url.pathname === '/api/favicon/github.com') {
			response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
			response.end(
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" rx="6" fill="#24292f"/><text x="15" y="22" font-size="22" text-anchor="middle" fill="white">G</text></svg>',
			);
			return;
		}
		if (url.pathname === '/arf/en/2fa/login/') {
			htmlResponse(response, EU_ORG_FIXTURE);
			return;
		}
		if (url.pathname === '/source') {
			htmlResponse(response, '<!doctype html><title>2FA source</title><main>Signed in fixture</main>', {
				// Chromium permits Secure cookies on loopback HTTP. This fixture verifies
				// cookie semantics without claiming to exercise a production TLS endpoint.
				'Set-Cookie': 'auth_token=e2e-session; Secure; HttpOnly; SameSite=Strict; Path=/',
			});
			return;
		}
		if (url.pathname === '/target') {
			htmlResponse(
				response,
				`<!doctype html>
<title>OTP target</title>
<form id="login-form">
	<label for="otp">Authenticator verification code</label>
	<input id="otp" name="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6">
	<button type="submit">Continue</button>
</form>
<script>
	window.fixtureState = { inputEvents: 0, changeEvents: 0, submits: 0 };
	document.querySelector('#otp').addEventListener('input', () => window.fixtureState.inputEvents += 1);
	document.querySelector('#otp').addEventListener('change', () => window.fixtureState.changeEvents += 1);
	document.querySelector('#login-form').addEventListener('submit', (event) => {
		event.preventDefault();
		window.fixtureState.submits += 1;
	});
</script>`,
			);
			return;
		}
		if (url.pathname === '/api/time') {
			requests.time += 1;
			const currentPeriod = Math.floor(Date.now() / 30_000) * 30_000;
			const serverTimeMs = clockAnchor ? clockAnchor.serverTimeMs + Date.now() - clockAnchor.wallTimeMs : currentPeriod + 10_000;
			jsonResponse(response, 200, { serverTimeMs });
			return;
		}
		if (url.pathname === '/api/secrets') {
			requests.secrets.push({
				cookie: request.headers.cookie || '',
				authorization: request.headers.authorization || '',
			});
			if (!request.headers.cookie?.includes('auth_token=e2e-session')) {
				jsonResponse(response, 401, { error: '身份验证失败', message: '请重新登录' });
				return;
			}
			const records = [
				{
					id: 'e2e-account',
					name: 'E2E Account',
					account: 'test@example.com',
					secret: TEST_SECRET,
					type: 'TOTP',
					digits: 6,
					period: 30,
					algorithm: 'SHA1',
				},
				...extraAccounts,
			];
			if (secretResponseDelayMs > 0) {
				setTimeout(() => jsonResponse(response, 200, records), secretResponseDelayMs);
			} else {
				jsonResponse(response, 200, records);
			}
			return;
		}
		if (url.pathname === '/api/refresh-token') {
			requests.refresh += 1;
			jsonResponse(response, 500, { error: 'bridge must not call refresh' });
			return;
		}
		response.writeHead(404);
		response.end('Not found');
	});

	await new Promise((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '0.0.0.0', () => resolveListen());
	});
	const { port } = server.address();
	sourceOrigin = `http://127.0.0.1:${port}`;
	targetOrigin = `http://127.0.0.2:${port}`;
});

test.afterAll(async () => {
	if (server) {
		await new Promise((resolveClose) => server.close(resolveClose));
	}
});

function createTestExtension(browserTarget, temporaryRoot) {
	const source = join(ROOT, 'dist', 'extension', browserTarget);
	const destination = join(temporaryRoot, browserTarget);
	copyDirectory(source, destination);
	const manifestPath = join(destination, 'manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.host_permissions = ['http://127.0.0.1/*', 'http://127.0.0.2/*'];
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	return destination;
}

function copyDirectory(source, destination) {
	mkdirSync(destination, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		const from = join(source, entry.name);
		const to = join(destination, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(from, to);
		} else if (entry.isFile()) {
			copyFileSync(from, to);
		}
	}
}

function removeTemporaryRoot(path) {
	const temporaryBase = resolve(tmpdir());
	const target = resolve(path);
	const pathFromBase = relative(temporaryBase, target);
	if (pathFromBase.startsWith('..') || pathFromBase === '' || !basename(target).startsWith('twofa-extension-e2e-')) {
		throw new Error('Refusing to remove an unsafe extension test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

async function activateTarget(extensionPage) {
	await extensionPage.evaluate(async (pattern) => {
		const tabs = await chrome.tabs.query({ url: pattern });
		if (!tabs[0]?.id) {
			throw new Error('Target fixture tab not found');
		}
		await chrome.tabs.update(tabs[0].id, { active: true });
	}, `${targetOrigin}/*`);
}

async function startFlow(extensionPage) {
	await activateTarget(extensionPage);
	return extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'START_FLOW' }));
}

async function fillAccount(extensionPage, startResponse) {
	expect(startResponse.ok).toBe(true);
	return extensionPage.evaluate(
		async ({ nonce, account }) => chrome.runtime.sendMessage({ type: 'FILL_ACCOUNT', nonce, account, remember: true }),
		{ nonce: startResponse.data.nonce, account: startResponse.data.accounts[0] },
	);
}

async function saveScreenshot(page, testInfo, name) {
	const path = testInfo.outputPath(`${name}.png`);
	await page.screenshot({ path, fullPage: true });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function expectReadableText(locator) {
	const contrast = await locator.evaluate((element) => {
		const luminance = (color) => {
			const channels = color
				.match(/[\d.]+/g)
				.slice(0, 3)
				.map(Number)
				.map((value) => {
					const channel = value / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
			return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
		};
		let surface = element;
		while (surface.parentElement && window.getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') {
			surface = surface.parentElement;
		}
		const foreground = luminance(window.getComputedStyle(element).color);
		const background = luminance(window.getComputedStyle(surface).backgroundColor);
		return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
	});
	expect(contrast).toBeGreaterThanOrEqual(4.5);
}

async function expectProjectCountdown(card) {
	const progress = card.locator('.progress-top');
	await expect(progress).toHaveAttribute('role', 'progressbar');
	await expect(progress).toHaveAttribute('aria-valuemax', '30');
	await expect(progress).toHaveAttribute('aria-valuetext', /^剩余 \d+ 秒$/);
	const style = await progress.evaluate((element) => {
		const track = window.getComputedStyle(element);
		const fill = window.getComputedStyle(element.firstElementChild);
		const cardStyle = window.getComputedStyle(element.closest('.account-card'));
		return {
			height: track.height,
			left: track.left,
			right: track.right,
			cornerLeft: cardStyle.borderTopLeftRadius,
			cornerRight: cardStyle.borderTopRightRadius,
			background: fill.backgroundImage,
			transitionProperty: fill.transitionProperty,
			transitionDuration: fill.transitionDuration,
			transitionTimingFunction: fill.transitionTimingFunction,
			visibleText: element.textContent.trim(),
		};
	});
	expect(style).toEqual({
		height: '1px',
		left: '16px',
		right: '16px',
		cornerLeft: '16px',
		cornerRight: '16px',
		background: 'linear-gradient(90deg, rgb(76, 175, 80), rgb(33, 150, 243))',
		transitionProperty: 'width, background-color',
		transitionDuration: '1s, 0.5s',
		transitionTimingFunction: 'linear, ease',
		visibleText: '',
	});
}

async function withExtension(browserTarget, testInfo, run) {
	requests = { secrets: [], time: 0, refresh: 0 };
	extraAccounts = [];
	clockAnchor = null;
	secretResponseDelayMs = 0;
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-extension-e2e-'));
	const extensionPath = createTestExtension(browserTarget, temporaryRoot);
	let context;
	try {
		// Both store packages run in actual Chromium with MV3 enabled. This does
		// not replace an acceptance run in the branded Microsoft Edge browser.
		context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
			channel: 'chromium',
			headless: true,
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		});
		await context.tracing.start({ screenshots: true, snapshots: true });
		let serviceWorker = context.serviceWorkers()[0];
		if (!serviceWorker) {
			serviceWorker = await context.waitForEvent('serviceworker');
		}
		const extensionId = new URL(serviceWorker.url()).host;
		const optionsUrl = `chrome-extension://${extensionId}/options.html`;
		await expect.poll(() => context.pages().some((page) => page.url() === optionsUrl)).toBe(true);
		for (const page of context.pages().filter((page) => page.url() === optionsUrl)) {
			await page.close();
		}
		// The fixture's UI assertions use Chinese independently of the browser locale.
		await serviceWorker.evaluate(
			(origin) => chrome.storage.local.set({ settings: { instanceOrigin: origin }, language: 'zh-CN' }),
			sourceOrigin,
		);

		const sourcePage = await context.newPage();
		await sourcePage.goto(`${sourceOrigin}/source`);
		const targetPage = await context.newPage();
		await targetPage.goto(`${targetOrigin}/target`);
		const extensionPage = await context.newPage();
		await extensionPage.goto(optionsUrl);
		await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');
		// Every configured Options page now checks automatically. Start network
		// assertions after that successful setup so tests still measure only the
		// fill/preview operations they exercise.
		expect(requests.secrets.every((entry) => entry.cookie.includes('auth_token=e2e-session'))).toBe(true);
		expect(requests.secrets.every((entry) => entry.authorization === '')).toBe(true);
		expect(requests.refresh).toBe(0);
		requests = { secrets: [], time: 0, refresh: 0 };
		await run({ context, serviceWorker, extensionId, sourcePage, targetPage, extensionPage });
	} catch (error) {
		if (context) {
			const tracePath = testInfo.outputPath('failure-trace.zip');
			await context.tracing.stop({ path: tracePath }).catch(() => {});
			await testInfo.attach('failure-trace', { path: tracePath, contentType: 'application/zip' }).catch(() => {});
		}
		throw error;
	} finally {
		await context?.close();
		removeTemporaryRoot(temporaryRoot);
	}
}

for (const browserTarget of ['chrome', 'edge']) {
	test(`${browserTarget} connects without bindings and keeps everyday settings simple`, async ({ browserName: _browserName }, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, extensionPage, sourcePage, serviceWorker }) => {
			const optionsFocus = await trackRealTabFocus(context, extensionPage);
			await trackRealTabFocus(context, sourcePage);
			await extensionPage.bringToFront();
			await expect.poll(optionsFocus).toMatchObject({ visibility: 'visible', focused: true });
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');
			expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('bindings')).bindings || [])).toEqual([]);
			await expect(extensionPage.locator('#instance-origin')).toHaveValue(sourceOrigin);
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			await expect(extensionPage.locator('#connect-instance')).toHaveText('检查连接');
			await expect(extensionPage.locator('#connection-summary')).toBeHidden();
			await expect(extensionPage.locator('#cancel-connection')).toBeHidden();
			await expect(extensionPage.locator('#current-instance')).toHaveAttribute('href', sourceOrigin);
			await expect(extensionPage.locator('#edit-connection')).toHaveCount(0);
			await expect(extensionPage.locator('#offline-enabled')).not.toBeChecked();
			await expect(extensionPage.locator('#saved-instances')).toBeHidden();
			await expect(
				extensionPage.locator('#advanced-settings, #connection-mode, #device-token, #save-connection, #manage-devices'),
			).toHaveCount(0);
			await expect(extensionPage.locator('#check-instance')).toBeHidden();
			await expect(extensionPage.locator('#open-instance')).toBeHidden();
			await expect(extensionPage.locator('#footer-instance')).toHaveAttribute('href', sourceOrigin);
			const requestsBeforeConnect = requests.secrets.length;
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			await extensionPage.locator('#connect-instance').click();
			await expect.poll(() => requests.secrets.length).toBe(requestsBeforeConnect + 1);
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');
			expect(requests.secrets.at(-1).cookie).toContain('auth_token=e2e-session');
			await expect(extensionPage.locator('#setup-guide')).toBeHidden();
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			await expect(extensionPage.locator('#site-search-wrapper')).toBeHidden();
			await expect(extensionPage.locator('#import-offline')).toBeHidden();
			await expect(extensionPage.locator('#offline-status, #sync-offline, #clear-offline')).toHaveCount(0);
			await expect(extensionPage.locator('#check-instance')).toBeHidden();
			await saveScreenshot(extensionPage, testInfo, 'simple-options-light');
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			await saveScreenshot(extensionPage, testInfo, 'simple-options-dark');
			await extensionPage.setViewportSize({ width: 380, height: 720 });
			await extensionPage.emulateMedia({ colorScheme: 'light' });
			expect(await extensionPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await saveScreenshot(extensionPage, testInfo, 'simple-options-mobile');
			await expect(extensionPage.locator('#privacy-content')).toBeHidden();
			await extensionPage.locator('#privacy-toggle').click();
			await expect(extensionPage.locator('#privacy-toggle')).toHaveAttribute('aria-expanded', 'true');
			await expect(extensionPage.locator('#privacy-content')).toContainText('账户密钥会保存在此浏览器');
			await extensionPage.locator('#privacy-toggle').click();
			await expect(extensionPage.locator('#privacy-content')).toBeHidden();
			await extensionPage.locator('#instance-origin').fill('twofa.example.com');
			await expect(extensionPage.locator('#connect-instance')).toHaveText('保存并连接');
			await expect(extensionPage.locator('#connect-instance')).toBeEnabled();
			await expect(extensionPage.locator('#connection-summary')).toBeVisible();
			await expect(extensionPage.locator('#current-instance')).toHaveAttribute('href', sourceOrigin);
			await expect(extensionPage.locator('#cancel-connection')).toBeVisible();
			await saveScreenshot(extensionPage, testInfo, 'connection-address-draft');
			await extensionPage.locator('#cancel-connection').click();
			await expect(extensionPage.locator('#instance-origin')).toHaveValue(sourceOrigin);
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');

			await context.clearCookies();
			await extensionPage.locator('#connect-instance').click();
			await expect(extensionPage.locator('#status')).toHaveAttribute('data-tone', 'error');
			await expect(extensionPage.locator('#status')).toContainText('登录');
			await expect(extensionPage.locator('#connect-instance')).toHaveText('检查连接');
			await expect(extensionPage.locator('#open-instance')).toHaveText('去登录');
			await expect(extensionPage.locator('#login-next-step')).toContainText('登录完成后回到此页');
			await expect(extensionPage.locator('#check-instance')).toBeVisible();
			await expect(extensionPage.locator('#import-offline')).toBeHidden();
			await expect(extensionPage.locator('#login-next-step')).toBeVisible();
			await expect(extensionPage.locator('#open-instance')).toHaveClass('primary-button');
			await saveScreenshot(extensionPage, testInfo, 'connection-login-required');
			await extensionPage.locator('#open-instance').click();
			await expect.poll(optionsFocus).toMatchObject({ focused: false });
			await sourcePage.goto(`${sourceOrigin}/source?after-login=1`);
			await extensionPage.bringToFront();
			await expect.poll(optionsFocus).toMatchObject({ visibility: 'visible', focused: true });
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');
			expect((await optionsFocus()).events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'blur', focused: false, trusted: true }),
					expect.objectContaining({ type: 'focus', focused: true, trusted: true }),
				]),
			);
			await expect(extensionPage.locator('#check-instance')).toBeHidden();
			await expect(extensionPage.locator('#login-next-step')).toBeHidden();
			const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(null));
			expect(JSON.stringify(stored)).not.toContain(TEST_SECRET);
			expect(stored.offlineCache).toBeUndefined();
			expect(stored.bindings || []).toEqual([]);
			expect(await serviceWorker.evaluate(() => chrome.permissions.getAll())).toMatchObject({
				origins: ['http://127.0.0.1/*', 'http://127.0.0.2/*'],
			});
		});
	});

	test(`${browserTarget} saves the offline switch immediately and clears local keys without a network check`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, extensionPage, serviceWorker }) => {
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			await extensionPage.locator('#offline-enabled').check();
			await expect(extensionPage.locator('#status')).toHaveText('可离线使用 · 1 个账户');
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('offlineInstances')).offlineInstances)).toEqual([
				sourceOrigin,
			]);
			expect(await serviceWorker.evaluate(async () => Boolean((await chrome.storage.local.get('offlineCache')).offlineCache))).toBe(true);
			await extensionPage.reload();
			await expect(extensionPage.locator('#status')).toHaveText('可离线使用 · 1 个账户');
			await expect(extensionPage.locator('#offline-enabled')).toBeChecked();
			await context.setOffline(true);
			await serviceWorker.evaluate(() => {
				Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false });
				const fetch = globalThis.fetch.bind(globalThis);
				globalThis.fixtureRequestsAfterDisconnect = 0;
				globalThis.fetch = (...args) => {
					globalThis.fixtureRequestsAfterDisconnect += 1;
					return fetch(...args);
				};
			});
			await extensionPage.locator('#offline-enabled').uncheck();
			await expect(extensionPage.locator('#status')).toHaveText('已关闭离线使用，本地密钥已清除');
			await expect(extensionPage.locator('#offline-enabled')).not.toBeChecked();
			await expect(extensionPage.locator('#open-instance')).toBeHidden();
			const state = await serviceWorker.evaluate(async () => ({
				local: await chrome.storage.local.get(null),
				session: await chrome.storage.session.get(null),
				fetches: globalThis.fixtureRequestsAfterDisconnect,
			}));
			expect(state.local.offlineCache).toBeUndefined();
			expect(state.local.offlineInstances).not.toContain(sourceOrigin);
			expect(JSON.stringify(state)).not.toContain(TEST_SECRET);
			expect(state.fetches).toBe(0);
		});
	});

	test(`${browserTarget} cancels unsaved address and offline edits without changing the connected instance`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, serviceWorker }) => {
			await extensionPage.locator('#offline-enabled').check();
			await expect(extensionPage.locator('#status')).toHaveText('可离线使用 · 1 个账户');
			const before = await serviceWorker.evaluate(() => chrome.storage.local.get(['settings', 'offlineInstances', 'offlineCache']));
			const previousRequests = requests.secrets.length;
			await extensionPage.locator('#instance-origin').fill('https://unsaved.example');
			await expect(extensionPage.locator('#connect-instance')).toHaveText('保存并连接');
			await expect(extensionPage.locator('#connection-summary')).toBeVisible();
			await expect(extensionPage.locator('#current-instance')).toHaveAttribute('href', sourceOrigin);
			await expect(extensionPage.locator('#connect-instance')).toBeEnabled();
			await extensionPage.locator('#offline-enabled').check();
			await extensionPage.locator('#offline-enabled').uncheck();
			expect(await serviceWorker.evaluate(() => chrome.storage.local.get(['settings', 'offlineInstances', 'offlineCache']))).toEqual(
				before,
			);
			expect(requests.secrets).toHaveLength(previousRequests);
			await extensionPage.locator('#cancel-connection').click();
			await expect(extensionPage.locator('#connection-editor')).toBeVisible();
			await expect(extensionPage.locator('#instance-origin')).toBeFocused();
			await expect(extensionPage.locator('#connect-instance')).toHaveText('检查连接');
			await expect(extensionPage.locator('#connection-summary')).toBeHidden();
			await expect(extensionPage.locator('#cancel-connection')).toBeHidden();
			await expect(extensionPage.locator('#current-instance')).toHaveAttribute('href', sourceOrigin);
			await expect(extensionPage.locator('#instance-origin')).toHaveValue(sourceOrigin);
			await expect(extensionPage.locator('#offline-enabled')).toBeChecked();
			await expect(extensionPage.locator('#status')).toHaveText('可离线使用 · 1 个账户');
			expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.instanceOrigin)).toBe(
				sourceOrigin,
			);
		});
	});

	test(`${browserTarget} keeps refreshing after the source closes without opening a tab`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, extensionPage, sourcePage, serviceWorker }) => {
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await activateTarget(extensionPage);
			clockAnchor = { serverTimeMs: Math.floor(Date.now() / 30_000) * 30_000 + 23000, wallTimeMs: Date.now() };
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(extensionPage.locator('.preview-next-code')).toHaveText(/^\d{6}$/);
			const nextCode = await extensionPage.locator('.preview-next-code').textContent();
			await sourcePage.close();
			await expect(extensionPage.locator('.preview-code')).toHaveText(nextCode, { timeout: 10000 });
			await expect(extensionPage.locator('.preview-next-code')).toHaveText(/^\d{6}$/);
			await expect(extensionPage.locator('#open-source')).toBeHidden();
			await expect(extensionPage.locator('#status')).toBeHidden();
			const state = await serviceWorker.evaluate(
				async (origin) => ({
					sources: (await chrome.tabs.query({ url: `${origin}/*` })).length,
					active: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url,
				}),
				sourceOrigin,
			);
			expect(state).toEqual({ sources: 0, active: `${targetOrigin}/target` });
		});
	});

	test(`${browserTarget} requires explicit opening after login expires with no source tab and reuses it`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, sourcePage, extensionPage, extensionId, serviceWorker }) => {
			await sourcePage.close();
			await context.clearCookies();
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#status')).toHaveAttribute('data-tone', 'error');
			await activateTarget(extensionPage);
			const browserState = () =>
				serviceWorker.evaluate(
					async (origin) => ({
						sources: await chrome.tabs.query({ url: `${origin}/*` }),
						active: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url,
					}),
					sourceOrigin,
				);
			await expect(extensionPage.locator('#retry')).toBeEnabled();
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('#open-source')).toBeVisible();
			await expect(extensionPage.locator('#status')).toContainText('登录已失效');
			expect((await browserState()).sources).toHaveLength(0);
			expect((await browserState()).active).toBe(`${targetOrigin}/target`);
			await expect(extensionPage.locator('#retry')).toBeEnabled();
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('#status')).toContainText('登录已失效');
			expect((await browserState()).sources).toHaveLength(0);
			await expect(extensionPage.locator('#open-source')).toBeEnabled();
			await extensionPage.locator('#open-source').evaluate((button) => button.click());
			await expect.poll(async () => (await browserState()).sources.length).toBe(1);
			await expect(extensionPage.locator('#status')).toContainText('回到目标网站重试');
			const sourceId = (await browserState()).sources[0].id;
			await activateTarget(extensionPage);
			await expect(extensionPage.locator('#open-source')).toBeEnabled();
			await extensionPage.locator('#open-source').evaluate((button) => button.click());
			await expect.poll(async () => (await browserState()).active).toBe(`${sourceOrigin}/`);
			expect((await browserState()).sources.map((tab) => tab.id)).toEqual([sourceId]);
		});
	});

	test(`${browserTarget} keeps an expired login in the popup and reuses the existing source only on explicit action`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, extensionPage, extensionId, serviceWorker }) => {
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await activateTarget(extensionPage);
			const sourceId = await serviceWorker.evaluate(async (origin) => {
				const source = (await chrome.tabs.query({ url: `${origin}/*` }))[0];
				return source.id;
			}, sourceOrigin);
			await context.clearCookies();
			await expect(extensionPage.locator('#retry')).toBeEnabled();
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('#open-source')).toBeVisible();
			await expect(extensionPage.locator('#status')).toContainText('登录已失效');
			expect(await serviceWorker.evaluate(async (id) => (await chrome.tabs.get(id)).active, sourceId)).toBe(false);
			await expect(extensionPage.locator('#open-source')).toBeEnabled();
			await extensionPage.locator('#open-source').evaluate((button) => button.click());
			await expect
				.poll(() =>
					serviceWorker.evaluate(async (id) => {
						const tab = await chrome.tabs.get(id);
						return tab.active;
					}, sourceId),
				)
				.toBe(true);
			expect(await serviceWorker.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` })).length, sourceOrigin)).toBe(
				1,
			);
		});
	});

	test(`${browserTarget} shows the instance service icon and uses a letter when the icon fails`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, extensionId }) => {
			extraAccounts = [{ id: 'icon', name: 'GitHub', account: 'icon@example.com', secret: TEST_SECRET, type: 'TOTP' }];
			await extensionPage.setViewportSize({ width: 380, height: 600 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			const card = extensionPage.locator('[data-account-id="icon"]');
			await expect(card).toBeVisible();
			await card.evaluate((node) => node.scrollIntoView({ block: 'nearest' }));
			const icon = card.locator('.service-icon img');
			await expect(icon).toBeVisible();
			expect(await icon.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
			await expect(icon).toHaveAttribute('src', `${sourceOrigin}/api/favicon/github.com`);
			await saveScreenshot(extensionPage, testInfo, 'service-icons');
			await icon.evaluate((img) => {
				img.src = new URL('/api/favicon/missing.example', img.src).href;
			});
			await expect(card.locator('.service-icon-fallback')).toBeVisible();
			await expect(card.locator('.service-icon-fallback')).toHaveText('G');
		});
	});

	test(`${browserTarget} shows both codes, an outside focus ring, and a transient copy toast`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, extensionPage }) => {
			extraAccounts = Array.from({ length: 4 }, (_, index) => ({
				id: `keyboard-account-${index}`,
				name: `Keyboard Account ${index}`,
				secret: TEST_SECRET,
				type: 'TOTP',
			}));
			await extensionPage.setViewportSize({ width: 380, height: 600 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			const viewCards = extensionPage.locator('.account-card');
			await expect(viewCards).toHaveCount(5);
			await expect(viewCards.first().locator('.preview-code')).toHaveText(/^\d{6}$/);
			await extensionPage.locator('#account-search').focus();
			for (let index = 0; index < 5; index += 1) {
				await extensionPage.keyboard.press('ArrowDown');
				await expect(viewCards.nth(index)).toBeFocused();
				await expect(viewCards.nth(index).locator(':focus-visible')).toHaveCount(0);
				if (index === 0) {
					await extensionPage.keyboard.press('Enter');
					await expect(extensionPage.locator('#copy-toast')).toHaveText('验证码已复制');
				}
			}
			await expect(viewCards.last().locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(viewCards.last()).toBeFocused();
			await expect(viewCards.last().locator(':focus-visible')).toHaveCount(0);
			await saveScreenshot(extensionPage, testInfo, 'view-only-card-arrow-focus');
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('#account-search')).toBeEnabled();
			await extensionPage.locator('#account-search').focus();
			await extensionPage.keyboard.press('ArrowDown');
			const card = extensionPage.locator('.account-card').first();
			await expect(card.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(card.locator('.preview-next-code')).toHaveText(/^\d{6}$/);
			await expect(extensionPage.locator('.preview-next-toggle')).toHaveCount(0);
			// Reach the first card with actual keyboard navigation from the search box.
			await extensionPage.emulateMedia({ colorScheme: 'light' });
			await extensionPage.locator('#account-search').focus();
			await expect(extensionPage.locator('#account-search')).toHaveCSS('outline-style', 'none');
			const cardBounds = await card.boundingBox();
			await extensionPage.keyboard.press('ArrowDown');
			await expect(card).toBeFocused();
			await expect(card.locator(':focus-visible')).toHaveCount(0);
			const ring = () =>
				card.evaluate((node) => {
					const style = window.getComputedStyle(node);
					return { width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle, color: style.outlineColor };
				});
			const lightBorder = { width: '2px', offset: '3px', style: 'solid', color: 'rgb(15, 108, 189)' };
			await expectReadableText(extensionPage.locator('#open-options'));
			await expect(extensionPage.locator('#account-search')).toHaveAttribute('title', '↑↓ 切换 · Enter 填充');
			expect(await ring()).toEqual(lightBorder);
			expect(await card.boundingBox()).toEqual(cardBounds);
			const clearance = await card.evaluate((node) => {
				const cardRect = node.getBoundingClientRect();
				const listRect = node.parentElement.getBoundingClientRect();
				return { left: cardRect.left - listRect.left, right: listRect.right - cardRect.right, top: cardRect.top - listRect.top };
			});
			for (const space of Object.values(clearance)) {
				expect(space).toBeGreaterThanOrEqual(5);
			}
			await saveScreenshot(extensionPage, testInfo, 'card-keyboard-outline');
			// Code readiness must not move arrow focus into the card's buttons.
			await expect(card).toBeFocused();
			expect(await ring()).toEqual(lightBorder);
			expect(await card.boundingBox()).toEqual(cardBounds);
			await saveScreenshot(extensionPage, testInfo, 'card-self-focus-outline');
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			const darkBorder = { ...lightBorder, color: 'rgb(98, 171, 245)' };
			await expectReadableText(extensionPage.locator('#open-options'));
			await expect(extensionPage.locator('#keyboard-help')).toBeHidden();
			expect(await ring()).toEqual(darkBorder);
			expect(await card.boundingBox()).toEqual(cardBounds);
			await saveScreenshot(extensionPage, testInfo, 'card-self-focus-outline-dark');
			await extensionPage.keyboard.press('ArrowUp');
			await expect(card).toBeFocused();
			await expect(card.locator(':focus-visible')).toHaveCount(0);
			expect(await ring()).toEqual(darkBorder);
			await saveScreenshot(extensionPage, testInfo, 'card-keyboard-outline-dark');
			await extensionPage.emulateMedia({ forcedColors: 'active' });
			await expect(extensionPage.locator('#scope-all')).toHaveCSS('text-decoration-line', 'underline');
			expect((await ring()).width).toBe('2px');
			await expect(card.locator('.progress-top-fill')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
			await saveScreenshot(extensionPage, testInfo, 'card-keyboard-high-contrast');
			await extensionPage.emulateMedia({ forcedColors: 'none' });
			await extensionPage.emulateMedia({ colorScheme: 'light' });
			const cards = extensionPage.locator('.account-card');
			await expect(cards).toHaveCount(5);
			for (const [key, indices] of [
				['ArrowDown', [1, 2, 3, 4]],
				['ArrowUp', [3, 2, 1, 0]],
			]) {
				for (const index of indices) {
					await extensionPage.keyboard.press(key);
					const currentCard = cards.nth(index);
					await expect(currentCard).toBeFocused();
					await expect(currentCard.locator(':focus-visible')).toHaveCount(0);
					const visibleRing = await currentCard.evaluate((node) => {
						const rect = node.getBoundingClientRect();
						const list = node.parentElement.getBoundingClientRect();
						const style = window.getComputedStyle(node);
						const outerSize = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
						return { top: rect.top - outerSize - list.top, bottom: list.bottom - rect.bottom - outerSize };
					});
					expect(visibleRing.top).toBeGreaterThanOrEqual(0);
					expect(visibleRing.bottom).toBeGreaterThanOrEqual(0);
				}
			}
			await saveScreenshot(extensionPage, testInfo, 'first-card-after-arrow-up');
			await expect(card.locator('.preview-code')).toHaveText(/^\d{6}$/);
			const heading = await card.locator('.account-name').boundingBox();
			await extensionPage.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2);
			await extensionPage.mouse.down();
			expect(await ring()).toEqual(lightBorder);
			await extensionPage.mouse.up();
			expect((await ring()).style).toBe('none');
			await expect(extensionPage.locator('#copy-toast')).toBeVisible();
			await expect(extensionPage.locator('#copy-toast')).toHaveText('验证码已复制');
			await expect(extensionPage.locator('#copy-toast')).toBeHidden({ timeout: 3000 });
			// The card's border/padding is also a copy target.
			await card.click({ position: { x: 10, y: 16 } });
			await expect(extensionPage.locator('#copy-toast')).toBeVisible();
			await expect(extensionPage.locator('#copy-toast')).toHaveText('验证码已复制');
			await expect(extensionPage.locator('#copy-toast')).toBeHidden({ timeout: 3000 });
			const statusBefore = await extensionPage.locator('#status').textContent();
			await card.locator('.preview-code').click();
			await expect(extensionPage.locator('#copy-toast')).toBeVisible();
			await expect(extensionPage.locator('#copy-toast')).toHaveText('验证码已复制');
			await expect(extensionPage.locator('#copy-toast')).toHaveCSS('opacity', '1');
			await expect(extensionPage.locator('#status')).toHaveText(statusBefore);
			expect((await ring()).style).toBe('none');
			await saveScreenshot(extensionPage, testInfo, 'copy-toast');
			await expect(extensionPage.locator('#copy-toast')).toBeHidden({ timeout: 3000 });
			await card.locator('.preview-next-code').click();
			await expect(extensionPage.locator('#copy-toast')).toHaveText('下一组验证码已复制');
			await expect(extensionPage.locator('#copy-toast')).toBeVisible();
			await expect(extensionPage.locator('#copy-toast')).toHaveCSS('opacity', '1');
			const toastLayout = await extensionPage.locator('#copy-toast-message').evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				const bounds = element.closest('#copy-toast').getBoundingClientRect();
				return { lines: range.getClientRects().length, left: bounds.left, right: bounds.right, viewport: window.innerWidth };
			});
			expect(toastLayout.lines).toBe(1);
			expect(toastLayout.left).toBeGreaterThanOrEqual(0);
			expect(toastLayout.right).toBeLessThanOrEqual(toastLayout.viewport);
			await saveScreenshot(extensionPage, testInfo, 'next-copy-toast');
			await extensionPage.locator('#account-search').fill('E2E');
			await expect(extensionPage.locator('#account-search-clear')).toBeVisible();
			await extensionPage.keyboard.press('Tab');
			await expect(extensionPage.locator('#account-search-clear')).toBeFocused();
			await expect(extensionPage.locator('#account-search-clear')).toHaveCSS('outline-offset', '-4px');
		});
	});

	test(`${browserTarget} automatically shows current codes with the project countdown and refreshes without losing focus`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, extensionPage, targetPage, serviceWorker }) => {
			await extensionPage.setViewportSize({ width: 380, height: 580 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await activateTarget(extensionPage);
			clockAnchor = { serverTimeMs: Math.floor(Date.now() / 30_000) * 30_000 + 23000, wallTimeMs: Date.now() };
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			const card = extensionPage.locator('.account-card[data-account-id="e2e-account"]');
			await expect(card.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(extensionPage.locator('.account-view')).toHaveCount(0);
			const initialCode = await card.locator('.preview-code').textContent();
			await expect(card.locator('.progress-top')).toHaveAttribute('aria-valuenow', /^[1-7]$/);
			await expectProjectCountdown(card);
			await expect(card.locator('.preview-next')).toBeVisible();
			await expect(targetPage.locator('#otp')).toHaveValue('');
			await expect(card.locator('.preview-next-code')).toHaveText(/^\d{6}$/);
			const futureCode = await card.locator('.preview-next-code').textContent();
			expect(futureCode).not.toBe(initialCode);
			await expect(card.locator('.preview-next-time')).toHaveText(/秒后生效$/);
			await card.locator('.account-fill').evaluate((button) => button.focus());
			const countdownBefore = await card.locator('.progress-top').getAttribute('aria-valuenow');
			await expect(card.locator('.progress-top')).not.toHaveAttribute('aria-valuenow', countdownBefore);
			expect(await card.locator('.account-fill').evaluate((button) => document.activeElement === button)).toBe(true);
			await saveScreenshot(extensionPage, testInfo, 'preview-light');
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			await expectProjectCountdown(card);
			await saveScreenshot(extensionPage, testInfo, 'preview-dark');
			await expect(card.locator('.preview-code')).toHaveText(futureCode, { timeout: 10000 });
			await expect(card.locator('.progress-top')).toHaveAttribute('aria-valuenow', /^(?:2\d|30)$/);
			expect(await card.locator('.account-fill').evaluate((button) => document.activeElement === button)).toBe(true);
			await expect(targetPage.locator('#otp')).toHaveValue('');
			const stored = await serviceWorker.evaluate(async () => ({
				local: await chrome.storage.local.get(null),
				session: await chrome.storage.session.get(null),
			}));
			for (const sensitive of [TEST_SECRET, initialCode, futureCode]) {
				expect(JSON.stringify(stored)).not.toContain(sensitive);
			}
			await extensionPage.locator('#account-search').evaluate((input) => {
				input.value = 'no matching account';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await expect(extensionPage.locator('.account-card')).toHaveCount(0);
			const requestCount = requests.time;
			// Removed cards must stop refreshing and release their code controllers.
			await extensionPage.clock.install();
			await extensionPage.clock.fastForward(31000);
			expect(requests.time).toBe(requestCount);
		});
	});

	test(`${browserTarget} only loads visible cards and clears codes while scrolling them out of view`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, extensionPage, serviceWorker }) => {
			secretResponseDelayMs = 250;
			extraAccounts = Array.from({ length: 24 }, (_, index) => ({
				id: `scroll-account-${index}`,
				name: `Scroll Account ${String(index).padStart(2, '0')}`,
				account: `user${index}@example.com`,
				secret: TEST_SECRET,
				type: 'TOTP',
			}));
			await extensionPage.setViewportSize({ width: 380, height: 600 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			const cards = extensionPage.locator('.account-card');
			await expect(cards).toHaveCount(25);
			const first = cards.first();
			const last = cards.last();
			await expect(first).toBeVisible();
			const initialCardHeight = await first.evaluate((card) => card.getBoundingClientRect().height);
			await expect(first.locator('.preview-code')).toHaveText(/^\d{6}$/);
			expect(await first.evaluate((card) => card.getBoundingClientRect().height)).toBe(initialCardHeight);
			await expect(last.locator('.preview-code')).toHaveText('------');
			await expect(last.locator('.progress-top')).toBeHidden();
			await expect(last.locator('.preview-code')).toBeDisabled();
			await expect(first.locator('.preview-next-code')).toHaveText(/^\d{6}$/);
			const initialCode = await first.locator('.preview-code').textContent();
			const initialRequestCount = requests.time;
			expect(initialRequestCount).toBeGreaterThan(0);
			expect(initialRequestCount).toBeLessThan(25);
			await saveScreenshot(extensionPage, testInfo, 'visible-cards');
			await extensionPage.locator('#accounts').evaluate((list) => {
				list.scrollTop = list.scrollHeight;
			});
			await expect(last.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(first.locator('.preview-code')).toHaveText('------');
			await expect(first.locator('.progress-top')).toBeHidden();
			await expect(first.locator('.preview-code')).toBeDisabled();
			await expect(first.locator('.preview-next')).not.toHaveAttribute('hidden');
			await expect(first.locator('.preview-next-code')).toHaveText('------');
			expect(requests.time).toBeGreaterThan(initialRequestCount);
			expect(requests.time).toBeLessThan(25);
			const beforeReturn = requests.time;
			await extensionPage.locator('#accounts').evaluate((list) => {
				list.scrollTop = 0;
			});
			await expect(first.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(first.locator('.preview-next')).not.toHaveAttribute('hidden');
			await expect(last.locator('.preview-code')).toHaveText('------');
			expect(requests.time).toBeGreaterThan(beforeReturn);
			const stored = await serviceWorker.evaluate(async () => ({
				local: await chrome.storage.local.get(null),
				session: await chrome.storage.session.get(null),
			}));
			expect(JSON.stringify(stored)).not.toContain(TEST_SECRET);
			expect(JSON.stringify(stored)).not.toContain(initialCode);
		});
	});

	test(`${browserTarget} Popup searches full-vault group names and continuous phrases like the main page`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, extensionPage }) => {
			extraAccounts = [
				{ id: 'gmail', name: 'Gmail', account: 'alice', secret: TEST_SECRET, type: 'TOTP' },
				{ id: 'youtube', name: 'YouTube', account: 'bob', secret: TEST_SECRET, type: 'HOTP' },
			];
			await extensionPage.setViewportSize({ width: 380, height: 500 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await expect(extensionPage.locator('.account-fill').first()).toBeDisabled();
			await expect(extensionPage.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('.account-card')).toHaveCount(2);
			const search = extensionPage.getByPlaceholder('搜索服务或账户名称');
			await expect(search).toBeEnabled();
			const enterQuery = (query) =>
				search.evaluate((input, value) => {
					input.value = value;
					input.dispatchEvent(new Event('input', { bubbles: true }));
				}, query);
			await enterQuery('  GOOGLE  ');
			await expect(extensionPage.locator('.account-card')).toHaveCount(1);
			await expect(extensionPage.locator('.account-card')).toHaveAttribute('data-account-id', 'gmail');
			await saveScreenshot(extensionPage, testInfo, 'popup-search-group');
			await enterQuery('Gmail alice');
			await expect(extensionPage.locator('#account-empty')).toBeVisible();
			await expect(extensionPage.locator('.account-card')).toHaveCount(0);
			await enterQuery('TEST@');
			await expect(extensionPage.locator('.account-card')).toHaveAttribute('data-account-id', 'e2e-account');
			await enterQuery('其他服务');
			await expect(extensionPage.locator('.account-card')).toHaveAttribute('data-account-id', 'e2e-account');
			await extensionPage.locator('#account-search-clear').evaluate((button) => button.click());
			await expect(search).toHaveValue('');
			await expect(extensionPage.locator('.account-card')).toHaveCount(2);
			expect(await search.evaluate((input) => document.activeElement === input)).toBe(true);
		});
	});

	test(`${browserTarget} fills the EU.org OTP field with maxlength=30 without focus or submit`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			await targetPage.goto(`${targetOrigin}/arf/en/2fa/login/`);
			const startResponse = await startFlow(extensionPage);
			const fillResponse = await fillAccount(extensionPage, startResponse);
			expect(fillResponse).toMatchObject({ ok: true, data: { status: 'filled' } });
			await expect(targetPage.locator('#id_otp')).toHaveValue(/^\d{6}$/);
			expect(await targetPage.evaluate(() => window.fixtureState)).toEqual({ inputEvents: 1, changeEvents: 1, submits: 0 });
			await expect(targetPage.locator('[name="csrfmiddlewaretoken"]')).toHaveValue('fixture-csrf');
			await saveScreenshot(targetPage, testInfo, 'eu-org-field-filled');
		});
	});

	for (const kind of ['single', 'segmented']) {
		test(`${browserTarget} replaces an existing ${kind} OTP without exposing mixed codes or changing unrelated fields`, async ({
			browserName: _browserName,
		}, testInfo) => {
			await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
				await targetPage.evaluate((kind) => {
					const form = document.getElementById('login-form');
					if (kind === 'segmented') {
						form.innerHTML = `<div role="group" aria-label="Authenticator code">${Array.from(
							{ length: 6 },
							(_, index) => `<input data-otp-digit="${index}" inputmode="numeric" maxlength="1" value="${'654321'[index]}">`,
						).join('')}</div><button type="submit">Continue</button>`;
					} else {
						document.getElementById('otp').value = '654321';
					}
					form.insertAdjacentHTML(
						'beforeend',
						'<input id="password" type="password" value="test-password"><input id="username" autocomplete="username" value="unchanged-user">',
					);
					const inputs = [...form.querySelectorAll(kind === 'segmented' ? '[data-otp-digit]' : '#otp')];
					const state = inputs.map((input) => input.value);
					window.replacementState = { fullStateValues: [], fullDomValues: [], inputTypes: [] };
					inputs.forEach((input, index) => {
						input.addEventListener('input', (event) => {
							// Model a controlled form that validates as soon as all digits exist.
							state[index] = input.value;
							window.replacementState.inputTypes.push(event.inputType);
							if (state.every(Boolean)) {
								window.replacementState.fullStateValues.push(state.join(''));
							}
							const domValues = inputs.map((field) => field.value);
							if (domValues.every(Boolean)) {
								window.replacementState.fullDomValues.push(domValues.join(''));
							}
						});
					});
				}, kind);
				const flow = await startFlow(extensionPage);
				// TEST_SECRET at the first TOTP window is 282760. Keep a stable window
				// so replacement assertions cannot pass because the old code reappears.
				clockAnchor = { serverTimeMs: 10000, wallTimeMs: Date.now() };
				expect(await fillAccount(extensionPage, flow)).toMatchObject({ ok: true, data: { status: 'filled' } });
				const inputs = targetPage.locator(kind === 'segmented' ? '[data-otp-digit]' : '#otp');
				expect(await inputs.evaluateAll((elements) => elements.map((input) => input.value).join(''))).toBe('282760');
				const observed = await targetPage.evaluate(() => window.replacementState);
				expect(observed.fullStateValues).toEqual(['282760']);
				expect(observed.fullDomValues).toEqual(['282760']);
				if (kind === 'single') {
					expect(observed.inputTypes).toEqual(['insertReplacementText']);
				} else {
					expect(observed.inputTypes).toEqual([...Array(6).fill('deleteContentBackward'), ...Array(6).fill('insertText')]);
				}
				await expect(targetPage.locator('#password')).toHaveValue('test-password');
				await expect(targetPage.locator('#username')).toHaveValue('unchanged-user');
				expect(await targetPage.evaluate(() => window.fixtureState.submits)).toBe(0);
			});
		});
	}

	test(`${browserTarget} remembers a successful fill when the page locks the completed OTP`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage, serviceWorker }) => {
			await targetPage.evaluate(() => {
				const input = document.getElementById('otp');
				window.submittedCodes = [];
				input.addEventListener('input', () => {
					if (/^\d{6}$/.test(input.value)) {
						window.submittedCodes.push(input.value);
						input.disabled = true;
					}
				});
			});
			const flow = await startFlow(extensionPage);
			clockAnchor = { serverTimeMs: 10000, wallTimeMs: Date.now() };
			expect(await fillAccount(extensionPage, flow)).toMatchObject({ ok: true, data: { status: 'filled' } });
			await expect(targetPage.locator('#otp')).toBeDisabled();
			await expect(targetPage.locator('#otp')).toHaveValue('282760');
			expect(await targetPage.evaluate(() => window.submittedCodes)).toEqual(['282760']);
			expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('bindings')).bindings)).toEqual([
				{ instanceOrigin: sourceOrigin, targetOrigin, accountId: 'e2e-account' },
			]);
		});
	});

	test(`${browserTarget} build carries the Strict HttpOnly Secure cookie and never persists secrets or codes`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, serviceWorker, sourcePage, targetPage, extensionPage }) => {
			// URL-filtered cookies(http://...) omits Secure cookies even though
			// Chromium sends them on this trustworthy loopback origin.
			const cookies = await context.cookies();
			expect(cookies).toContainEqual(expect.objectContaining({ name: 'auth_token', httpOnly: true, secure: true, sameSite: 'Strict' }));
			expect(await sourcePage.evaluate(() => document.cookie)).not.toContain('auth_token');
			const startResponse = await startFlow(extensionPage);
			expect(startResponse.ok).toBe(true);
			expect(startResponse.data.accounts).toEqual([
				expect.objectContaining({ id: 'e2e-account', name: 'E2E Account', account: 'test@example.com', type: 'TOTP', digits: 6 }),
			]);
			expect(JSON.stringify(startResponse)).not.toContain(TEST_SECRET);

			const fillResponse = await fillAccount(extensionPage, startResponse);
			expect(fillResponse).toMatchObject({ ok: true, data: { status: 'filled', targetOrigin } });
			const targetState = await targetPage.evaluate(() => ({ value: document.querySelector('#otp').value, ...window.fixtureState }));
			expect(targetState.value).toMatch(/^\d{6}$/);
			expect(targetState.inputEvents).toBeGreaterThanOrEqual(1);
			expect(targetState.changeEvents).toBeGreaterThanOrEqual(1);
			expect(targetState.submits).toBe(0);
			expect(requests.secrets).toHaveLength(2);
			expect(requests.secrets.every((entry) => entry.cookie.includes('auth_token=e2e-session'))).toBe(true);
			expect(requests.secrets.every((entry) => entry.authorization === '')).toBe(true);
			expect(requests.time).toBeGreaterThanOrEqual(1);
			expect(requests.refresh).toBe(0);

			const stored = await serviceWorker.evaluate(async () => ({
				local: await chrome.storage.local.get(null),
				session: await chrome.storage.session.get(null),
			}));
			expect(JSON.stringify(stored)).not.toContain(TEST_SECRET);
			expect(JSON.stringify(stored)).not.toContain(targetState.value);
		});
	});

	test(`${browserTarget} Popup renders accounts and its real click handler fills the selected account`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionId, targetPage, extensionPage }) => {
			await expect(extensionPage.locator('#instance-origin')).toHaveValue(sourceOrigin);
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 1 个账户');
			await saveScreenshot(extensionPage, testInfo, 'options-connected');
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			for (const selector of ['#instance-origin', '#instance-form .primary-button']) {
				await expectReadableText(extensionPage.locator(selector).first());
			}
			await saveScreenshot(extensionPage, testInfo, 'options-connected-dark');
			await expectReadableText(extensionPage.locator('#instance-origin'));
			await extensionPage.locator('#instance-origin').focus();
			await expect(extensionPage.locator('#instance-origin')).toHaveCSS('outline-width', '2px');
			await expect(extensionPage.locator('#instance-origin')).toHaveCSS('outline-color', 'rgb(98, 171, 245)');
			const project = extensionPage.locator('footer').getByRole('link', { name: /GitHub/ });
			await expect(project).toHaveAttribute('href', 'https://github.com/wuzf/2fa');
			await expectReadableText(project);
			const guide = extensionPage.locator('footer').getByRole('link', { name: /部署指南/ });
			await extensionPage.keyboard.press('Tab');
			await guide.focus();
			await expect(guide).toHaveCSS('outline-color', 'rgb(98, 171, 245)');
			await extensionPage.emulateMedia({ colorScheme: 'light' });

			await extensionPage.setViewportSize({ width: 380, height: 500 });
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			// A popup opened as a normal tab initially targets itself. Retry after
			// making the login tab active, preserving actual popup script/DOM code.
			await expect(extensionPage.locator('#target-origin')).toHaveText('当前页面仅支持复制');
			await expect(extensionPage.locator('#account-section')).toBeVisible();
			await expect(extensionPage.locator('.account-fill').first()).toBeDisabled();
			await expect(extensionPage.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			const account = extensionPage.locator('.account-card[data-account-id="e2e-account"]');
			await expect(account).toBeVisible();
			await expect(account.locator('.account-name')).toHaveText('E2E Account');
			await expect(account.locator('.account-detail')).toHaveText('test@example.com');
			await expect(account.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await expect(extensionPage.locator('#target-origin')).toBeHidden();
			await expect(extensionPage.locator('#actions')).toBeHidden();
			await expect(extensionPage.locator('#status')).toBeHidden();
			await expect(extensionPage.locator('.search-label')).toHaveCount(0);
			await expect(extensionPage.getByRole('searchbox', { name: '搜索服务或账户名称' })).toBeVisible();
			await saveScreenshot(extensionPage, testInfo, 'popup-accounts');
			await extensionPage.locator('#remember-binding').evaluate((checkbox) => {
				checkbox.checked = true;
			});
			// Locator.click can activate the extension tab; DOM click keeps the
			// captured login tab active as it is when using the browser toolbar.
			await account.locator('.account-fill').evaluate((button) => button.click());
			await expect(targetPage.locator('#otp')).toHaveValue(/^\d{6}$/);
			expect(await targetPage.evaluate(() => window.fixtureState.submits)).toBe(0);
			await saveScreenshot(targetPage, testInfo, 'target-filled');
		});
	});

	for (const operation of ['fill', 'preview']) {
		test(`${browserTarget} refuses ${operation} after same-origin navigation to a new document`, async ({
			browserName: _browserName,
		}, testInfo) => {
			await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
				const startResponse = await startFlow(extensionPage);
				expect(startResponse.ok).toBe(true);
				await targetPage.goto(`${targetOrigin}/target?new-document=1`);
				const response =
					operation === 'fill'
						? await fillAccount(extensionPage, startResponse)
						: await extensionPage.evaluate(
								({ nonce, accounts }) =>
									chrome.runtime.sendMessage({ type: 'COPY_ACCOUNT_CODE', nonce, account: accounts[0], includeNext: true }),
								startResponse.data,
							);
				expect(response).toMatchObject({ ok: false, error: { code: 'TARGET_CHANGED' } });
				await expect(targetPage.locator('#otp')).toHaveValue('');
				expect(await targetPage.evaluate(() => window.fixtureState)).toEqual({ inputEvents: 0, changeEvents: 0, submits: 0 });
				expect(requests.secrets).toHaveLength(1);
			});
		});
	}

	test(`${browserTarget} drops preview codes when the captured document changes during generation`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			const startResponse = await startFlow(extensionPage);
			expect(startResponse.ok).toBe(true);
			secretResponseDelayMs = 2000;
			const pending = extensionPage.evaluate(
				({ nonce, accounts }) => chrome.runtime.sendMessage({ type: 'COPY_ACCOUNT_CODE', nonce, account: accounts[0], includeNext: true }),
				startResponse.data,
			);
			await expect.poll(() => requests.secrets.length).toBe(2);
			await targetPage.goto(`${targetOrigin}/target?new-document=1`);
			expect(await pending).toMatchObject({ ok: false, error: { code: 'TARGET_CHANGED' } });
			await expect(targetPage.locator('#otp')).toHaveValue('');
		});
	});

	test(`${browserTarget} does not fill a code described as SMS without explicit selection`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			await targetPage.evaluate(() => {
				const help = document.createElement('p');
				help.id = 'sms-help';
				help.textContent = 'Enter the verification code sent via SMS.';
				document.body.append(help);
				document.getElementById('otp').setAttribute('aria-describedby', help.id);
			});
			const flow = await startFlow(extensionPage);
			const response = await fillAccount(extensionPage, flow);
			expect(response).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_INPUT' } });
			await expect(targetPage.locator('#otp')).toHaveValue('');
			expect(requests.secrets).toHaveLength(1);
		});
	});

	test(`${browserTarget} explicitly confirms the input selected before first injection`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			await targetPage.evaluate(() => {
				const second = document.getElementById('otp').cloneNode();
				second.id = 'second-otp';
				document.body.append(second);
			});
			await targetPage.locator('#second-otp').click();
			const first = await startFlow(extensionPage);
			expect(await fillAccount(extensionPage, first)).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_INPUT' } });
			const next = await startFlow(extensionPage);
			const response = await extensionPage.evaluate(
				({ nonce, accounts }) => chrome.runtime.sendMessage({ type: 'FILL_ACCOUNT', nonce, account: accounts[0], confirmFocused: true }),
				next.data,
			);
			expect(response).toMatchObject({ ok: true, data: { status: 'filled' } });
			await expect(targetPage.locator('#second-otp')).toHaveValue(/^\d{6}$/);
			await expect(targetPage.locator('#otp')).toHaveValue('');
		});
	});

	test(`${browserTarget} keeps healthy codes usable with an unsupported vault record`, async ({ browserName: _browserName }, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, extensionId }) => {
			extraAccounts = [
				{
					id: 'legacy',
					name: 'Legacy account',
					account: 'legacy@example.com',
					secret: TEST_SECRET,
					type: 'TOTP',
					digits: 6,
					period: 45,
					algorithm: 'SHA1',
				},
			];
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('#account-warning')).toContainText('已跳过 1 个重复或不兼容的账户');
			await expect(extensionPage.locator('#account-warning')).toContainText('Legacy account');
			await expect(extensionPage.locator('.account-card')).toHaveCount(1);
			await expect(extensionPage.locator('.preview-code')).toHaveText(/^\d{6}$/);
		});
	});

	test(`${browserTarget} rolls over without blanking a revalidated pair during slow refresh`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, extensionId }) => {
			clockAnchor = { serverTimeMs: Math.floor(Date.now() / 30000) * 30000 + 23000, wallTimeMs: Date.now() };
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			const current = extensionPage.locator('.preview-code');
			await expect(current).toHaveText(/^\d{6}$/);
			const next = await extensionPage.locator('.preview-next-code').textContent();
			await expect.poll(() => requests.time, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
			await expect(extensionPage.locator('.code-preview')).toHaveAttribute('aria-busy', 'false');
			secretResponseDelayMs = 2000;
			await extensionPage.evaluate(() => {
				window.observedBlank = false;
				window.observeRollover = setInterval(() => {
					if (document.querySelector('.preview-code').textContent === '------') {
						window.observedBlank = true;
					}
				}, 25);
			});
			await expect(current).toHaveText(next, { timeout: 10000 });
			await expect.poll(() => requests.time, { timeout: 10000 }).toBeGreaterThanOrEqual(3);
			expect(
				await extensionPage.evaluate(() => {
					clearInterval(window.observeRollover);
					return window.observedBlank;
				}),
			).toBe(false);
			await expect(current).toBeEnabled();
		});
	});

	test(`${browserTarget} searches named bindings and deletes only the current instance binding`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, serviceWorker }) => {
			await serviceWorker.evaluate(
				({ instanceOrigin, targetOrigin }) =>
					chrome.storage.local.set({
						bindings: [
							{ instanceOrigin, targetOrigin, accountId: 'e2e-account' },
							{ instanceOrigin: 'https://other.example', targetOrigin, accountId: 'e2e-account' },
							...Array.from({ length: 4 }, (_, index) => ({
								instanceOrigin,
								targetOrigin: `https://remembered-${index}.example`,
								accountId: `unavailable-${index}`,
							})),
						],
					}),
				{ instanceOrigin: sourceOrigin, targetOrigin },
			);
			await extensionPage.reload();
			await expect(extensionPage.locator('.binding-item')).toHaveCount(5);
			await expect(extensionPage.locator('#site-search-wrapper')).toBeVisible();
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			await expectReadableText(extensionPage.locator('#binding-search'));
			await extensionPage.locator('#binding-search').focus();
			await expect(extensionPage.locator('#binding-search')).toHaveCSS('outline-width', '2px');
			await expect(extensionPage.locator('#binding-search')).toHaveCSS('outline-color', 'rgb(98, 171, 245)');
			await extensionPage.locator('#binding-search').fill('missing');
			await expect(extensionPage.locator('.binding-item')).toHaveCount(0);
			await expect(extensionPage.locator('#clear-site-search')).toHaveAccessibleName('清空搜索');
			await extensionPage.locator('#clear-site-search').click();
			await expect(extensionPage.locator('#binding-search')).toHaveValue('');
			await expect(extensionPage.locator('.binding-item')).toHaveCount(5);
			await extensionPage.locator('#binding-search').fill('test@example.com');
			await expect(extensionPage.locator('.binding-account')).toContainText('test@example.com');
			await extensionPage.locator('.binding-forget').click();
			await expect(extensionPage.locator('.binding-item')).toHaveCount(0);
			await expect(extensionPage.locator('#site-search-wrapper')).toBeVisible();
			await extensionPage.locator('#clear-site-search').click();
			await expect(extensionPage.locator('.binding-item')).toHaveCount(4);
			await expect(extensionPage.locator('#site-search-wrapper')).toBeHidden();
			const { bindings } = await serviceWorker.evaluate(() => chrome.storage.local.get('bindings'));
			expect(bindings).toContainEqual({ instanceOrigin: 'https://other.example', targetOrigin, accountId: 'e2e-account' });
			expect(bindings).not.toContainEqual({ instanceOrigin: sourceOrigin, targetOrigin, accountId: 'e2e-account' });
			expect(bindings).toHaveLength(5);
		});
	});

	test(`${browserTarget} groups website settings while keeping autofill and remembered accounts independent`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, serviceWorker }) => {
			// Autofill accepts HTTPS or the explicit localhost exceptions. Reuse
			// the fixture's existing host grant and keep each site's full origin.
			const targetOrigin = 'http://127.0.0.1:31000';
			const authorizedOnlyOrigin = 'http://127.0.0.1:31001';
			const rememberedOnlyOrigin = 'https://remembered.example';
			const otherInstance = 'https://other.example';
			extraAccounts = [
				{
					id: 'backup-account',
					name: 'Backup Account',
					account: 'backup@example.com',
					secret: TEST_SECRET,
					type: 'TOTP',
					digits: 6,
					period: 30,
				},
			];
			await serviceWorker.evaluate(
				({ instanceOrigin, targetOrigin, rememberedOnlyOrigin, otherInstance }) =>
					chrome.storage.local.set({
						bindings: [
							{ instanceOrigin, targetOrigin, accountId: 'e2e-account' },
							{ instanceOrigin, targetOrigin, accountId: 'backup-account' },
							{ instanceOrigin, targetOrigin: rememberedOnlyOrigin, accountId: 'e2e-account' },
							{ instanceOrigin: otherInstance, targetOrigin, accountId: 'e2e-account' },
						],
						autofillSites: [{ instanceOrigin: otherInstance, targetOrigin, targetPath: '/login' }],
					}),
				{ instanceOrigin: sourceOrigin, targetOrigin, rememberedOnlyOrigin, otherInstance },
			);
			for (const origin of [targetOrigin, authorizedOnlyOrigin]) {
				const response = await extensionPage.evaluate(
					({ instanceOrigin, targetOrigin }) =>
						chrome.runtime.sendMessage({ type: 'SET_AUTOFILL_SITE', instanceOrigin, targetOrigin, targetPath: '/login', enabled: true }),
					{ instanceOrigin: sourceOrigin, targetOrigin: origin },
				);
				expect(response.ok, response.error?.message).toBe(true);
			}
			await extensionPage.reload();
			await expect(extensionPage.locator('#status')).toHaveText('已连接 · 2 个账户');
			const sites = extensionPage.locator('#site-list > .site-card');
			const both = extensionPage.locator(`.site-card[data-origin="${targetOrigin}"]`);
			const authorizedOnly = extensionPage.locator(`.site-card[data-origin="${authorizedOnlyOrigin}"]`);
			const rememberedOnly = extensionPage.locator(`.site-card[data-origin="${rememberedOnlyOrigin}"]`);
			await expect(sites).toHaveCount(3);
			await expect(extensionPage.locator('#site-count')).toHaveText('3 个网站');
			await expect(extensionPage.locator('#site-search-wrapper')).toBeHidden();
			await expect(both.locator('.binding-item')).toHaveCount(2);
			await expect(both.locator('.site-autofill-state')).toHaveText('自动填充已开启');
			await expect(authorizedOnly.locator('.binding-item')).toHaveCount(0);
			await expect(authorizedOnly.locator('.autofill-disable')).toBeVisible();
			await expect(rememberedOnly.locator('.binding-account')).toContainText('test@example.com');
			await expect(rememberedOnly.locator('.site-autofill-state')).toHaveText('自动填充未开启');
			await expect(rememberedOnly.locator('.autofill-disable')).toHaveCount(0);
			await saveScreenshot(extensionPage, testInfo, 'website-settings-light');
			await extensionPage.emulateMedia({ colorScheme: 'dark' });
			await saveScreenshot(extensionPage, testInfo, 'website-settings-dark');
			await extensionPage.setViewportSize({ width: 380, height: 720 });
			await extensionPage.emulateMedia({ colorScheme: 'light' });
			expect(await extensionPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await saveScreenshot(extensionPage, testInfo, 'website-settings-mobile');

			const addPath = await extensionPage.evaluate(
				({ instanceOrigin, targetOrigin }) =>
					chrome.runtime.sendMessage({ type: 'SET_AUTOFILL_SITE', instanceOrigin, targetOrigin, targetPath: '/second', enabled: true }),
				{ instanceOrigin: sourceOrigin, targetOrigin },
			);
			expect(addPath.ok, addPath.error?.message).toBe(true);
			await extensionPage.reload();
			await expect(both.locator('.site-autofill-path')).toHaveCount(2);
			await expect(both.locator('.binding-item')).toHaveCount(2);
			await both.locator('.site-autofill-path[data-path="/login"] .autofill-disable').click();
			await expect(both.locator('.site-autofill-path')).toHaveCount(1);
			await expect(both.locator('.site-path')).toHaveText('/second');
			await expect(both.locator('.site-autofill-state')).toHaveText('自动填充已开启');
			await expect(both.locator('.binding-item')).toHaveCount(2);
			const remaining = await serviceWorker.evaluate(() => chrome.storage.local.get('autofillSites'));
			expect(remaining.autofillSites).toContainEqual({ instanceOrigin: sourceOrigin, targetOrigin, targetPath: '/second' });
			expect(remaining.autofillSites).not.toContainEqual({ instanceOrigin: sourceOrigin, targetOrigin, targetPath: '/login' });
			expect(await serviceWorker.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
			const restorePath = await extensionPage.evaluate(
				({ instanceOrigin, targetOrigin }) =>
					chrome.runtime.sendMessage({ type: 'SET_AUTOFILL_SITE', instanceOrigin, targetOrigin, targetPath: '/login', enabled: true }),
				{ instanceOrigin: sourceOrigin, targetOrigin },
			);
			expect(restorePath.ok, restorePath.error?.message).toBe(true);
			await extensionPage.reload();
			await both.locator('.site-autofill-path[data-path="/second"] .autofill-disable').click();
			await expect(both.locator('.site-autofill-path')).toHaveCount(1);
			await expect(both.locator('.site-path')).toHaveText('/login');

			await both.locator('.binding-item').filter({ hasText: 'test@example.com' }).locator('.binding-forget').click();
			await expect(both.locator('.binding-item')).toHaveCount(1);
			await expect(both.locator('.binding-account')).toContainText('backup@example.com');
			await expect(both.locator('.site-autofill-state')).toHaveText('自动填充已开启');
			expect(await serviceWorker.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
			let stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['bindings', 'autofillSites']));
			expect(stored.autofillSites).toEqual(
				expect.arrayContaining([
					{ instanceOrigin: sourceOrigin, targetOrigin, targetPath: '/login' },
					{ instanceOrigin: sourceOrigin, targetOrigin: authorizedOnlyOrigin, targetPath: '/login' },
					{ instanceOrigin: otherInstance, targetOrigin, targetPath: '/login' },
				]),
			);
			await both.locator('.autofill-disable').click();
			await expect(both.locator('.site-autofill-state')).toHaveText('自动填充未开启');
			await expect(both.locator('.binding-account')).toContainText('backup@example.com');
			stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['bindings', 'autofillSites']));
			expect(stored.autofillSites).toEqual([
				{ instanceOrigin: otherInstance, targetOrigin, targetPath: '/login' },
				{ instanceOrigin: sourceOrigin, targetOrigin: authorizedOnlyOrigin, targetPath: '/login' },
			]);
			expect(stored.bindings).toEqual([
				{ instanceOrigin: sourceOrigin, targetOrigin, accountId: 'backup-account' },
				{ instanceOrigin: sourceOrigin, targetOrigin: rememberedOnlyOrigin, accountId: 'e2e-account' },
				{ instanceOrigin: otherInstance, targetOrigin, accountId: 'e2e-account' },
			]);
			await authorizedOnly.locator('.autofill-disable').click();
			await expect(authorizedOnly).toHaveCount(0);
			await expect(sites).toHaveCount(2);
			await both.locator('.binding-forget').click();
			await expect(both).toHaveCount(0);
			await expect(rememberedOnly).toBeVisible();
			await expect(extensionPage.locator('#site-count')).toHaveText('1 个网站');
			stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['bindings', 'autofillSites']));
			expect(stored.autofillSites).toEqual([{ instanceOrigin: otherInstance, targetOrigin, targetPath: '/login' }]);
			expect(stored.bindings).toEqual([
				{ instanceOrigin: sourceOrigin, targetOrigin: rememberedOnlyOrigin, accountId: 'e2e-account' },
				{ instanceOrigin: otherInstance, targetOrigin, accountId: 'e2e-account' },
			]);
		});
	});

	for (const kind of ['shadow', 'iframe']) {
		test(`${browserTarget} fills an OTP inside an open ${kind}`, async ({ browserName: _browserName }, testInfo) => {
			await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
				await targetPage.evaluate((kind) => {
					document.getElementById('login-form').remove();
					const html = '<label for="inner">Authenticator code</label><input id="inner" autocomplete="one-time-code">';
					if (kind === 'shadow') {
						const host = document.createElement('div');
						document.body.append(host);
						host.attachShadow({ mode: 'open' }).innerHTML = html;
					} else {
						const frame = document.createElement('iframe');
						frame.srcdoc = html;
						document.body.append(frame);
					}
				}, kind);
				const input = kind === 'shadow' ? targetPage.locator('#inner') : targetPage.frameLocator('iframe').locator('#inner');
				await expect(input).toBeVisible();
				const state = await startFlow(extensionPage);
				expect(await fillAccount(extensionPage, state)).toMatchObject({ ok: true, data: { status: 'filled' } });
				await expect(input).toHaveValue(/^\d{6}$/);
			});
		});
	}

	test(`${browserTarget} refuses a cross-origin iframe and drops a navigated iframe target`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			await targetPage.evaluate((url) => {
				document.getElementById('login-form').remove();
				const frame = document.createElement('iframe');
				frame.src = url;
				document.body.append(frame);
			}, `${sourceOrigin}/target`);
			await expect(targetPage.frameLocator('iframe').locator('#otp')).toBeVisible();
			expect(await fillAccount(extensionPage, await startFlow(extensionPage))).toMatchObject({ ok: false, error: { code: 'NO_INPUT' } });
			await targetPage.locator('iframe').evaluate((frame) => {
				frame.srcdoc = '<input id="inner" autocomplete="one-time-code">';
			});
			await expect(targetPage.frameLocator('iframe').locator('#inner')).toBeVisible();
			const state = await startFlow(extensionPage);
			secretResponseDelayMs = 1000;
			const before = requests.secrets.length;
			const pending = fillAccount(extensionPage, state);
			await expect.poll(() => requests.secrets.length).toBeGreaterThan(before);
			await targetPage.locator('iframe').evaluate((frame) => {
				frame.srcdoc = '<input id="replacement" autocomplete="one-time-code">';
			});
			await expect(targetPage.frameLocator('iframe').locator('#replacement')).toBeVisible();
			expect((await pending).ok).toBe(false);
			await expect(targetPage.frameLocator('iframe').locator('#replacement')).toHaveValue('');
		});
	});

	test(`${browserTarget} refuses a field distributed through a hidden shadow slot`, async ({ browserName: _browserName }, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ targetPage, extensionPage }) => {
			await targetPage.evaluate(() => {
				document.getElementById('login-form').remove();
				const host = document.createElement('div');
				document.body.append(host);
				host.attachShadow({ mode: 'open' }).innerHTML = '<div aria-hidden="true" style="opacity:0"><slot></slot></div>';
				host.innerHTML = '<input id="slotted" autocomplete="one-time-code">';
			});
			expect(await fillAccount(extensionPage, await startFlow(extensionPage))).toMatchObject({ ok: false, error: { code: 'NO_INPUT' } });
			await expect(targetPage.locator('#slotted')).toHaveValue('');
		});
	});

	test(`${browserTarget} persists a favorite and fills a keyboard-selected search result`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ extensionPage, extensionId, targetPage, serviceWorker }) => {
			await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(extensionPage.locator('.preview-code')).toHaveText(/^\d{6}$/);
			await extensionPage.locator('.account-favorite').click();
			await expect(extensionPage.locator('.account-favorite')).toHaveAttribute('aria-pressed', 'true');
			expect(await serviceWorker.evaluate(() => chrome.storage.local.get('favorites'))).toEqual({
				favorites: [{ instanceOrigin: sourceOrigin, accountId: 'e2e-account' }],
			});
			await activateTarget(extensionPage);
			await extensionPage.locator('#retry').evaluate((button) => button.click());
			await expect(extensionPage.locator('.account-fill')).toBeEnabled();
			await extensionPage.locator('#account-search').evaluate((input) => {
				input.value = 'test@example.com';
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			});
			await expect(targetPage.locator('#otp')).toHaveValue(/^\d{6}$/);
		});
	});

	test(`${browserTarget} fills after the source page closes following account selection`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ sourcePage, targetPage, extensionPage, serviceWorker }) => {
			const startResponse = await startFlow(extensionPage);
			await sourcePage.close();
			const fillResponse = await fillAccount(extensionPage, startResponse);
			expect(fillResponse).toMatchObject({ ok: true, data: { status: 'filled' } });
			await expect(targetPage.locator('#otp')).toHaveValue(/^\d{6}$/);
			expect(requests.secrets).toHaveLength(2);
			expect(requests.refresh).toBe(0);
			expect(await serviceWorker.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` })).length, sourceOrigin)).toBe(
				0,
			);
		});
	});

	test(`${browserTarget} reports an expired source session without silently refreshing it`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withExtension(browserTarget, testInfo, async ({ context, targetPage, extensionPage }) => {
			const startResponse = await startFlow(extensionPage);
			await context.clearCookies();
			const fillResponse = await fillAccount(extensionPage, startResponse);
			expect(fillResponse).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
			await expect(targetPage.locator('#otp')).toHaveValue('');
			const unauthorized = await startFlow(extensionPage);
			expect(unauthorized).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
			expect(requests.secrets.at(-1).cookie).toBe('');
			expect(requests.refresh).toBe(0);
		});
	});
}
