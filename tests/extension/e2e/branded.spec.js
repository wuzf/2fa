import { chromium, expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { trackRealTabFocus } from './focus-fixture.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
// RFC 6238's public SHA-1 test seed; never use a real account in these fixtures.
const TEST_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SOURCE_PERMISSION = 'http://127.0.0.1/*';

function executableFor(brand) {
	const candidates = {
		chrome: [
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
		],
		edge: [
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/usr/bin/microsoft-edge',
			'/usr/bin/microsoft-edge-stable',
		],
	};
	return candidates[brand].find((candidate) => existsSync(candidate));
}

function removeProfile(directory) {
	const target = resolve(directory);
	const fromTemporaryRoot = relative(resolve(tmpdir()), target);
	if (fromTemporaryRoot.startsWith('..') || fromTemporaryRoot === '' || !basename(target).startsWith('twofa-branded-e2e-')) {
		throw new Error('Refusing to remove an unsafe browser test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

function sendJson(response, status, body) {
	response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
	response.end(JSON.stringify(body));
}

async function startFixture() {
	const requests = { secrets: [], time: 0, refresh: 0 };
	const serverTimeMs = Math.floor(Date.now() / 30_000) * 30_000 + 10_000;
	const server = createServer((request, response) => {
		const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
		if (pathname === '/source') {
			response.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				// Secure loopback cookies exercise browser cookie rules, not production TLS.
				'Set-Cookie': 'auth_token=branded-test-session; Secure; HttpOnly; SameSite=Strict; Path=/',
			});
			response.end('<!doctype html><title>2FA source fixture</title><main>Signed in test session</main>');
			return;
		}
		if (pathname === '/target') {
			response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			response.end(`<!doctype html><title>OTP target fixture</title>
<form id="login-form">
  <label for="otp">Authenticator verification code</label>
  <input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6">
  <button type="submit">Continue</button>
</form>
<script>
  window.fixtureState = { inputEvents: 0, changeEvents: 0, submits: 0 };
  document.querySelector('#otp').addEventListener('input', () => window.fixtureState.inputEvents += 1);
  document.querySelector('#otp').addEventListener('change', () => window.fixtureState.changeEvents += 1);
  document.querySelector('#login-form').addEventListener('submit', event => {
    event.preventDefault();
    window.fixtureState.submits += 1;
  });
</script>`);
			return;
		}
		if (pathname === '/api/time') {
			requests.time += 1;
			sendJson(response, 200, { serverTimeMs });
			return;
		}
		if (pathname === '/api/secrets') {
			requests.secrets.push({ cookie: request.headers.cookie || '', authorization: request.headers.authorization || '' });
			if (!request.headers.cookie?.includes('auth_token=branded-test-session')) {
				sendJson(response, 401, { error: 'Authentication required' });
				return;
			}
			sendJson(response, 200, [
				{
					id: 'branded-test-account',
					name: 'Browser Test Account',
					account: 'test@example.com',
					secret: TEST_SECRET,
					type: 'TOTP',
					algorithm: 'SHA1',
					period: 30,
					digits: 6,
				},
				...Array.from({ length: 12 }, (_, index) => ({
					id: `scroll-account-${index}`,
					name: `Scroll Account ${String(index).padStart(2, '0')}`,
					account: `user${index}@example.com`,
					secret: TEST_SECRET,
					type: 'TOTP',
					algorithm: 'SHA1',
					period: 30,
					digits: 6,
				})),
			]);
			return;
		}
		if (pathname === '/api/refresh-token') {
			requests.refresh += 1;
			sendJson(response, 500, { error: 'The extension must not refresh the management session' });
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '0.0.0.0', resolveListen);
	});
	const { port } = server.address();
	return {
		requests,
		serverTimeMs,
		sourceOrigin: `http://127.0.0.1:${port}`,
		// A different hostname is essential: Chrome host permissions ignore ports.
		targetOrigin: `http://127.0.0.2:${port}`,
		close: () => new Promise((resolveClose) => server.close(resolveClose)),
	};
}

function expectedCode(serverTimeMs) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(serverTimeMs / 30_000)));
	const digest = createHmac('sha1', Buffer.from('12345678901234567890')).update(counter).digest();
	return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function attachPopup(cdp, targetId) {
	// Toolbar popups are not normal tabs and Playwright does not expose them
	// through context.pages(). Address the real popup through its CDP target.
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
	let nextId = 0;
	const pending = new Map();
	const receive = (event) => {
		if (event.sessionId !== sessionId) {
			return;
		}
		const message = JSON.parse(event.message);
		const callback = pending.get(message.id);
		if (!callback) {
			return;
		}
		pending.delete(message.id);
		clearTimeout(callback.timer);
		if (message.error) {
			callback.reject(new Error(message.error.message));
		} else {
			callback.resolve(message.result);
		}
	};
	cdp.on('Target.receivedMessageFromTarget', receive);
	return {
		send: (method, params = {}) =>
			new Promise((resolveMessage, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Popup CDP command timed out: ${method}`));
				}, 5000);
				pending.set(id, { resolve: resolveMessage, reject, timer });
				cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
					clearTimeout(timer);
					pending.delete(id);
					reject(error);
				});
			}),
		dispose: () => cdp.off('Target.receivedMessageFromTarget', receive),
	};
}

for (const brand of ['chrome', 'edge']) {
	test(`${brand} branded browser previews and fills without a source tab using activeTab and a Strict HttpOnly cookie`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const executablePath = executableFor(brand);
		test.skip(!executablePath, `${brand} branded browser is not installed at a standard location`);
		const extensionPath = join(ROOT, 'dist', 'extension', brand);
		const manifestPath = join(extensionPath, 'manifest.json');
		const originalManifest = readFileSync(manifestPath, 'utf8');
		expect(JSON.parse(originalManifest).host_permissions).toBeUndefined();
		const fixture = await startFixture();
		const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-branded-e2e-'));
		let context;
		try {
			// Branded browsers disable --load-extension. Their experimental CDP
			// extension debugging API loads the unchanged artifact in this profile.
			context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
				executablePath,
				headless: true,
				ignoreDefaultArgs: ['--disable-extensions'],
				args: ['--enable-unsafe-extension-debugging'],
				// The unchanged artifact installs through CDP after launch, so its
				// first Options page opens before extension storage can be written.
				// Playwright Test otherwise applies its en-US default locale, which
				// the extension's "auto" language reads as the browser language.
				locale: 'zh-CN',
			});
			await context.tracing.start({ screenshots: true, snapshots: true });
			const cdp = await context.browser().newBrowserCDPSession();
			const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
			const serviceWorker =
				context.serviceWorkers().find((worker) => new URL(worker.url()).host === extensionId) ||
				(await context.waitForEvent('serviceworker', { predicate: (worker) => new URL(worker.url()).host === extensionId }));
			const optionsUrl = `chrome-extension://${extensionId}/options.html`;
			// Wait for the actual installation handler to finish opening Options;
			// otherwise it can steal the active target midway through this test.
			await expect.poll(() => context.pages().some((page) => page.url() === optionsUrl)).toBe(true);
			const optionsPage = context.pages().find((page) => page.url() === optionsUrl);
			const optionsFocus = await trackRealTabFocus(context, optionsPage);
			await expect(optionsPage.getByLabel('2FA 地址', { exact: true })).toBeVisible();
			expect((await serviceWorker.evaluate(() => chrome.permissions.getAll())).origins).toEqual([]);
			await expect(optionsPage.getByRole('link', { name: '查看部署指南' })).toHaveAttribute(
				'href',
				'https://github.com/wuzf/2fa/blob/main/docs/DEPLOYMENT.md',
			);
			await optionsPage.screenshot({ path: testInfo.outputPath('first-run-options.png'), fullPage: true });
			const setupPopup = await context.newPage();
			await setupPopup.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(setupPopup.locator('#setup-guide')).toBeVisible();
			await expect(setupPopup.locator('#actions')).toBeHidden();
			await expect(setupPopup.getByRole('link', { name: 'GitHub 项目 · wuzf/2fa' })).toHaveAttribute('href', 'https://github.com/wuzf/2fa');
			await setupPopup.screenshot({ path: testInfo.outputPath('first-run-popup.png') });
			await setupPopup.emulateMedia({ colorScheme: 'dark' });
			await setupPopup.screenshot({ path: testInfo.outputPath('first-run-popup-dark.png') });
			await setupPopup.setViewportSize({ width: 380, height: 280 });
			expect(await setupPopup.locator('#setup-guide').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
			await setupPopup.getByRole('button', { name: '已有实例，前往设置' }).click();
			await expect.poll(() => context.pages().filter((page) => page.url() === optionsUrl).length).toBe(1);
			expect(context.pages().every((page) => !page.url().startsWith('https://github.com'))).toBe(true);
			await setupPopup.close();

			const managerPage = await context.newPage();
			await managerPage.goto(`${brand === 'edge' ? 'edge' : 'chrome'}://extensions/`);
			// This browser-owned API preapproves only the source site. The real
			// Options handler still calls permissions.request and SAVE_INSTANCE.
			// Native permission-dialog presentation/acceptance is not tested here.
			await managerPage.evaluate(async ({ id, host }) => chrome.developerPrivate.addHostPermission(id, host), {
				id: extensionId,
				host: SOURCE_PERMISSION,
			});
			await managerPage.close();
			await optionsPage.getByLabel('2FA 地址', { exact: true }).fill(fixture.sourceOrigin);
			await optionsPage.locator('#connect-instance').click();
			await expect(optionsPage.locator('#status')).toHaveAttribute('data-tone', 'error');
			await expect(optionsPage.locator('#status')).toContainText('登录');
			await expect(optionsPage.locator('#check-instance')).toBeVisible();
			expect(fixture.requests.secrets).toHaveLength(1);
			expect(fixture.requests.secrets[0]).toEqual({ cookie: '', authorization: '' });
			expect((await serviceWorker.evaluate(() => chrome.permissions.getAll())).origins).toEqual([SOURCE_PERMISSION]);
			expect(await serviceWorker.evaluate(() => chrome.storage.local.get('settings'))).toEqual({
				settings: { instanceOrigin: fixture.sourceOrigin },
			});

			const sourcePage = await context.newPage();
			await trackRealTabFocus(context, sourcePage);
			await sourcePage.bringToFront();
			await expect.poll(optionsFocus).toMatchObject({ focused: false });
			await sourcePage.goto(`${fixture.sourceOrigin}/source`);
			expect(await context.cookies()).toContainEqual(
				expect.objectContaining({ name: 'auth_token', secure: true, httpOnly: true, sameSite: 'Strict' }),
			);
			expect(await sourcePage.evaluate(() => document.cookie)).not.toContain('auth_token');
			await sourcePage.close();
			await optionsPage.bringToFront();
			await expect.poll(optionsFocus).toMatchObject({ visibility: 'visible', focused: true });
			await expect(optionsPage.locator('#status')).toHaveText('已连接 · 13 个账户');
			expect((await optionsFocus()).events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'blur', focused: false, trusted: true }),
					expect.objectContaining({ type: 'focus', focused: true, trusted: true }),
				]),
			);
			await expect(optionsPage.locator('#check-instance')).toBeHidden();
			// The first connection correctly requested login; all subsequent account
			// reads must use only the source's HttpOnly cookie.
			fixture.requests.secrets.shift();
			const sourceTabCount = () =>
				serviceWorker.evaluate(
					async (sourceOrigin) => (await chrome.tabs.query({ url: `${sourceOrigin}/*` })).length,
					fixture.sourceOrigin,
				);
			expect(await sourceTabCount()).toBe(0);
			const targetPage = await context.newPage();
			const targetUrl = `${fixture.targetOrigin}/target`;
			await targetPage.goto(targetUrl);
			await targetPage.bringToFront();
			const targetTabId = await serviceWorker.evaluate(
				async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id,
			);
			const beforeAction = await serviceWorker.evaluate(async (tabId) => {
				try {
					await chrome.scripting.executeScript({ target: { tabId }, func: () => window.location.href });
					return { granted: true };
				} catch (error) {
					return { granted: false, message: error.message };
				}
			}, targetTabId);
			expect(beforeAction.granted).toBe(false);
			expect(beforeAction.message).toMatch(/Cannot access|permission/i);

			const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
			const target = targetInfos.find((entry) => entry.url === targetUrl);
			expect(target).toBeDefined();
			await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
			const popupUrl = `chrome-extension://${extensionId}/popup.html`;
			let popupTarget;
			await expect
				.poll(async () => {
					popupTarget = (await cdp.send('Target.getTargets')).targetInfos.find((entry) => entry.url === popupUrl);
					return Boolean(popupTarget);
				})
				.toBe(true);
			const popup = await attachPopup(cdp, popupTarget.targetId);
			try {
				await popup.send('Runtime.runIfWaitingForDebugger');
				const readPopup = async () => {
					const result = await popup.send('Runtime.evaluate', {
						expression: `JSON.stringify({ status: document.querySelector('#status')?.textContent,
              statusHidden: document.querySelector('#status')?.hidden,
              searchTitleCount: document.querySelectorAll('.search-label').length,
              origin: document.querySelector('#target-origin')?.textContent,
              originHidden: document.querySelector('#target-origin')?.hidden,
              account: document.querySelector('.account-name')?.textContent,
              accountDetail: document.querySelector('.account-detail')?.textContent,
              code: document.querySelector('.preview-code')?.textContent,
              nextCode: document.querySelector('.preview-next-code')?.textContent,
              nextHidden: document.querySelector('.preview-next')?.hidden,
              toastHidden: document.querySelector('#copy-toast')?.hidden,
              toastText: document.querySelector('#copy-toast-message')?.textContent,
              toastOpacity: document.querySelector('#copy-toast') ? window.getComputedStyle(document.querySelector('#copy-toast')).opacity : null,
              disabled: document.querySelector('.account-fill')?.disabled })`,
						returnByValue: true,
					});
					return JSON.parse(result.result.value);
				};
				await expect.poll(async () => (await readPopup()).account).toBe('Browser Test Account');
				expect(await readPopup()).toMatchObject({
					origin: '',
					originHidden: true,
					accountDetail: 'test@example.com',
					disabled: false,
					nextHidden: false,
					statusHidden: true,
					searchTitleCount: 0,
				});
				expect(await sourceTabCount()).toBe(0);
				const clickPopup = async (selector) => {
					const { result } = await popup.send('Runtime.evaluate', {
						expression: `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
						returnByValue: true,
					});
					await popup.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...result.value });
					await popup.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...result.value });
				};
				await expect.poll(async () => (await readPopup()).code).toBe(expectedCode(fixture.serverTimeMs));
				const layoutResult = await popup.send('Runtime.evaluate', {
					expression: `(() => {
                  const list = document.querySelector('#accounts');
                  const cards = [...list.querySelectorAll('.account-card')];
                  return {
                    viewportHeight: window.innerHeight,
                    documentHeight: document.documentElement.scrollHeight,
                    popupViewportBottom: document.querySelector('.popup-viewport').getBoundingClientRect().bottom,
                    bodyOverflow: window.getComputedStyle(document.body).overflow,
                    accountsBottom: list.getBoundingClientRect().bottom,
                    accountCount: cards.length,
                    loadedCodes: cards.filter(card => /^\\d{6}$/.test(card.querySelector('.preview-code').textContent)).length,
                    offscreenLoaded: cards.filter(card => card.getBoundingClientRect().top >= window.innerHeight
                      && /^\\d{6}$/.test(card.querySelector('.preview-code').textContent)).length
                  };
                })()`,
					returnByValue: true,
				});
				const layoutPath = testInfo.outputPath('real-toolbar-popup-layout.json');
				writeFileSync(layoutPath, JSON.stringify(layoutResult.result.value, null, 2));
				await testInfo.attach('real-toolbar-popup-layout', { path: layoutPath, contentType: 'application/json' });
				expect(layoutResult.result.value.accountCount).toBe(13);
				expect(layoutResult.result.value.loadedCodes).toBeGreaterThan(0);
				expect(layoutResult.result.value.loadedCodes).toBeLessThan(13);
				expect(layoutResult.result.value.offscreenLoaded).toBe(0);
				expect(layoutResult.result.value.accountsBottom).toBeLessThanOrEqual(layoutResult.result.value.viewportHeight);
				expect(layoutResult.result.value.popupViewportBottom).toBeLessThanOrEqual(layoutResult.result.value.viewportHeight);
				expect(layoutResult.result.value.bodyOverflow).toBe('hidden');
				await expect(targetPage.locator('#otp')).toHaveValue('');
				await expect.poll(async () => (await readPopup()).nextCode).toBe(expectedCode(fixture.serverTimeMs + 30000));
				await clickPopup('.preview-next-code');
				await expect.poll(async () => (await readPopup()).toastText?.trim()).toBe('下一组验证码已复制');
				await expect.poll(async () => (await readPopup()).toastOpacity).toBe('1');
				const toastLayout = await popup.send('Runtime.evaluate', {
					expression: `(() => {
                  const message = document.querySelector('#copy-toast-message');
                  const toast = document.querySelector('#copy-toast');
                  const range = document.createRange();
                  range.selectNodeContents(message);
                  const box = toast.getBoundingClientRect();
                  return {
                    lines: range.getClientRects().length,
                    whiteSpace: window.getComputedStyle(message).whiteSpace,
                    left: box.left,
                    right: box.right,
                    viewportWidth: window.innerWidth
                  };
                })()`,
					returnByValue: true,
				});
				expect(toastLayout.result.value.lines).toBe(1);
				expect(toastLayout.result.value.whiteSpace).toBe('nowrap');
				expect(toastLayout.result.value.left).toBeGreaterThanOrEqual(0);
				expect(toastLayout.result.value.right).toBeLessThanOrEqual(toastLayout.result.value.viewportWidth);
				await clickPopup('.preview-code');
				await expect.poll(async () => (await readPopup()).toastHidden).toBe(false);
				await expect.poll(async () => (await readPopup()).toastOpacity).toBe('1');
				expect((await readPopup()).toastText.trim()).toBe('验证码已复制');
				expect((await readPopup()).status).not.toBe('验证码已复制');
				const screenshot = await popup.send('Page.captureScreenshot', { format: 'png' });
				const screenshotPath = testInfo.outputPath('real-toolbar-popup.png');
				writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
				await testInfo.attach('real-toolbar-popup', { path: screenshotPath, contentType: 'image/png' });
				await clickPopup('.account-fill');
			} finally {
				popup.dispose();
			}
			await expect(targetPage.locator('#otp')).toHaveValue(expectedCode(fixture.serverTimeMs));
			expect(await sourceTabCount()).toBe(0);
			const targetState = await targetPage.evaluate(() => window.fixtureState);
			expect(targetState.inputEvents).toBeGreaterThanOrEqual(1);
			expect(targetState.changeEvents).toBeGreaterThanOrEqual(1);
			expect(targetState.submits).toBe(0);
			expect(fixture.requests.secrets.length).toBeGreaterThanOrEqual(4);
			expect(fixture.requests.secrets.every((request) => request.cookie.includes('auth_token=branded-test-session'))).toBe(true);
			expect(fixture.requests.secrets.every((request) => request.authorization === '')).toBe(true);
			expect(fixture.requests.time).toBeGreaterThanOrEqual(1);
			expect(fixture.requests.refresh).toBe(0);
			const permissions = await serviceWorker.evaluate(() => chrome.permissions.getAll());
			expect(permissions.origins).toEqual([SOURCE_PERMISSION]);
			const stored = await serviceWorker.evaluate(async () => ({
				local: await chrome.storage.local.get(null),
				session: await chrome.storage.session.get(null),
			}));
			expect(JSON.stringify(stored)).not.toContain(TEST_SECRET);
			expect(JSON.stringify(stored)).not.toContain(expectedCode(fixture.serverTimeMs));
			expect(JSON.stringify(stored)).not.toContain(expectedCode(fixture.serverTimeMs + 30000));
			await testInfo.attach('branded-browser-evidence', {
				body: JSON.stringify({
					brand,
					version: context.browser().version(),
					permissions,
					targetInjectionBeforeAction: beforeAction.granted,
					formSubmissions: targetState.submits,
					cookieAuthenticatedRequests: fixture.requests.secrets.length,
					sourceTabsAfterFill: await sourceTabCount(),
				}),
				contentType: 'application/json',
			});
		} catch (error) {
			if (context) {
				const tracePath = testInfo.outputPath('failure-trace.zip');
				await context.tracing.stop({ path: tracePath }).catch(() => {});
				await testInfo.attach('failure-trace', { path: tracePath, contentType: 'application/zip' }).catch(() => {});
			}
			throw error;
		} finally {
			await context?.close();
			await fixture.close();
			removeProfile(temporaryRoot);
			expect(readFileSync(manifestPath, 'utf8')).toBe(originalManifest);
		}
	});
}
