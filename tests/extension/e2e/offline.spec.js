import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTotp } from '../../../extension/src/shared/totp.js';
import { pinFixtureLanguage } from './language-fixture.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const SECRET = 'JBSWY3DPEHPK3PXP';
const TEST_TIME = 1800000010000;
const SERVICE_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#2563eb"/><path d="M6 12h12M12 6v12" stroke="#fff" stroke-width="3"/></svg>';
const SERVICE_ICON_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SERVICE_ICON).toString('base64')}`;

function copyDirectory(source, destination) {
	mkdirSync(destination, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			copyDirectory(join(source, entry.name), join(destination, entry.name));
		} else {
			copyFileSync(join(source, entry.name), join(destination, entry.name));
		}
	}
}

function removeTemporaryRoot(directory) {
	const target = resolve(directory);
	const inside = relative(resolve(tmpdir()), target);
	if (!inside || inside.startsWith('..') || isAbsolute(inside) || !basename(target).startsWith('twofa-offline-e2e-')) {
		throw new Error('Refusing to remove an unsafe browser test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

function account(index) {
	return {
		id: `offline-${index}`,
		name: 'Google',
		account: `synthetic-${String(index).padStart(2, '0')}@example.com`,
		secret: SECRET,
		type: 'TOTP',
		digits: 6,
		period: 30,
		algorithm: 'SHA1',
	};
}

// Advance only the test browser's clocks. Keeping wall and monotonic time in
// step exercises ordinary TOTP rollover without changing the machine's clock.
function installFixtureClock({ wallEpoch, testEpoch }) {
	const nativeNow = Date.now.bind(Date);
	const monotonicNow = performance.now.bind(performance);
	globalThis.fixtureClockOffset = 0;
	Date.now = () => testEpoch + nativeNow() - wallEpoch + globalThis.fixtureClockOffset;
	Object.defineProperty(performance, 'now', {
		configurable: true,
		value: () => monotonicNow() + globalThis.fixtureClockOffset,
	});
}

async function withOfflineFixture(brand, records, run, { serverOffsetMs = 0, extraPermissions = [] } = {}) {
	const clock = { wallEpoch: Date.now(), testEpoch: TEST_TIME };
	const serverPaths = [];
	let timeStatus = 200;
	const server = createServer((request, response) => {
		const path = new URL(request.url, 'http://fixture.invalid').pathname;
		serverPaths.push(path);
		if (path === '/api/favicon/google.com') {
			response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
			response.end(SERVICE_ICON);
			return;
		}
		if (path === '/source' || path === '/target') {
			response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
			response.end(
				path === '/source'
					? '<!doctype html><meta charset="utf-8"><title>Synthetic 2FA source</title>'
					: `<!doctype html><meta charset="utf-8"><title>Synthetic login</title>
<form id="login-form"><label for="otp">Authenticator verification code</label>
<input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6">
<button type="submit">Continue</button></form>
<script>window.fixtureSubmits = 0;
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); window.fixtureSubmits += 1;
});</script>`,
			);
			return;
		}
		response.writeHead(path === '/api/time' ? timeStatus : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
		response.end(
			JSON.stringify(
				path === '/api/secrets'
					? records
					: path === '/api/time'
						? { serverTimeMs: clock.testEpoch + Date.now() - clock.wallEpoch + serverOffsetMs }
						: {},
			),
		);
	});
	await new Promise((done, reject) => {
		server.once('error', reject);
		server.listen(0, '0.0.0.0', done);
	});
	const instanceOrigin = `http://127.0.0.1:${server.address().port}`;
	const targetOrigin = `http://127.0.0.2:${server.address().port}`;
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-offline-e2e-'));
	let context;
	const stopServer = async () => {
		if (server.listening) {
			await new Promise((done) => {
				server.close(done);
				server.closeAllConnections();
			});
		}
	};
	try {
		const extensionPath = join(temporaryRoot, brand);
		copyDirectory(join(ROOT, 'dist/extension', brand), extensionPath);
		const manifestPath = join(extensionPath, 'manifest.json');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		manifest.host_permissions = ['http://127.0.0.1/*', 'http://127.0.0.2/*', ...extraPermissions];
		writeFileSync(manifestPath, JSON.stringify(manifest));
		context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
			channel: 'chromium',
			headless: true,
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		});
		await context.addInitScript(installFixtureClock, clock);
		const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
		await worker.evaluate(installFixtureClock, clock);
		await worker.evaluate(() => {
			const fetch = globalThis.fetch.bind(globalThis);
			globalThis.fixtureFetchPaths = [];
			globalThis.fetch = (input, options) => {
				globalThis.fixtureFetchPaths.push(new URL(typeof input === 'string' ? input : input.url || input.href).pathname);
				return fetch(input, options);
			};
		});
		const extensionId = new URL(worker.url()).host;
		await expect.poll(() => context.pages().some((page) => page.url() === `chrome-extension://${extensionId}/options.html`)).toBe(true);
		const options = context.pages().find((page) => page.url() === `chrome-extension://${extensionId}/options.html`);
		await pinFixtureLanguage(worker, [options]);
		const browserPaths = [];
		context.on('request', (request) => {
			const url = new URL(request.url());
			if (url.origin === instanceOrigin) {
				browserPaths.push(url.pathname);
			}
		});
		const source = await context.newPage();
		await source.goto(instanceOrigin + '/source');
		const target = await context.newPage();
		await target.goto(targetOrigin + '/target');
		await options.locator('#instance-origin').fill(instanceOrigin);
		await expect(options.locator('#connect-instance')).toBeEnabled();
		await options.locator('#offline-enabled').check();
		await options.locator('#connect-instance').click();
		await expect(options.locator('#status')).toContainText(`可离线使用 · ${records.length} 个账户`);
		await expect(options.locator('#offline-enabled')).toBeChecked();
		await expect(options.locator('#connection-editor')).toBeVisible();
		await expect(options.locator('#import-offline')).toBeHidden();
		// Ordinary connection now fills icons asynchronously. Wait for that work
		// before measuring the existing strictly offline, zero-fetch scenarios.
		await expect
			.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache?.serviceIcons?.['google.com']))
			.toBe(SERVICE_ICON_DATA_URL);
		const requestCounts = async () => ({
			server: serverPaths.length,
			browser: browserPaths.length,
			background: await worker.evaluate(() => globalThis.fixtureFetchPaths.length),
		});
		const openPopup = async () => {
			const popup = await context.newPage();
			await popup.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(popup.locator('.account-card')).toHaveCount(records.length);
			await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
			return popup;
		};
		const setFixtureOffline = async () => {
			await context.setOffline(true);
			// Playwright blocks network traffic but does not guarantee that an
			// extension service worker's OS connectivity state changes with it.
			// Model a genuinely offline device in this isolated fixture as well.
			await worker.evaluate(() => {
				Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false });
			});
			expect(await worker.evaluate(() => globalThis.navigator.onLine)).toBe(false);
		};
		const disconnect = async () => {
			await source.close();
			await stopServer();
			await setFixtureOffline();
		};
		await run({
			context,
			worker,
			options,
			source,
			target,
			instanceOrigin,
			targetOrigin,
			requestCounts,
			openPopup,
			disconnect,
			setFixtureOffline,
			setTimeStatus: (status) => {
				timeStatus = status;
			},
		});
	} finally {
		await context?.close();
		await stopServer();
		removeTemporaryRoot(temporaryRoot);
	}
}

async function assertCurrentCode(locator, worker) {
	await expect
		.poll(async () => {
			const expected = await generateTotp(SECRET, await worker.evaluate(() => Date.now()));
			return (await locator.textContent()) === expected;
		})
		.toBe(true);
}

async function expectOfflineServiceIcon(card) {
	const icon = card.locator('.service-icon img');
	await expect(icon).toHaveAttribute('src', SERVICE_ICON_DATA_URL);
	await expect.poll(() => icon.evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
	await expect(icon).toBeVisible();
	await expect(card.locator('.service-icon-fallback')).toBeHidden();
}

async function expectOfflineServiceIcons(popup, minimumVisibleCards) {
	for (const colorScheme of ['light', 'dark']) {
		await popup.emulateMedia({ colorScheme });
		await expectOfflineServiceIcon(popup.locator('.account-card').first());
		if (minimumVisibleCards !== undefined) {
			await expectPopupLayout(popup, minimumVisibleCards);
		}
	}
	await popup.emulateMedia({ colorScheme: 'light' });
}

async function expectPopupLayout(popup, minimumVisibleCards) {
	const layout = await popup.evaluate(() => {
		const list = document.getElementById('accounts');
		const bounds = list.getBoundingClientRect();
		const top = Math.max(bounds.top, 0);
		const bottom = Math.min(bounds.bottom, window.innerHeight);
		const cards = [...list.querySelectorAll('.account-card')];
		return {
			visibleCards: cards.filter((card) => {
				const rect = card.getBoundingClientRect();
				return rect.top >= top && rect.bottom <= bottom;
			}).length,
			horizontalOverflow: [document.documentElement, document.body, list].some((node) => node.scrollWidth > node.clientWidth),
			listHeight: bottom - top,
		};
	});
	expect(layout.visibleCards).toBeGreaterThanOrEqual(minimumVisibleCards);
	expect(layout.horizontalOverflow).toBe(false);
	expect(layout.listHeight).toBeGreaterThan(0);
}

async function savePopupScreenshot(popup, testInfo, name) {
	const path = testInfo.outputPath(`${name}.png`);
	await popup.screenshot({ path });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function fillFromTrustedPage({ options, target, targetOrigin, worker }) {
	await options.evaluate(async (origin) => {
		const [tab] = await chrome.tabs.query({ url: origin + '/*' });
		await chrome.tabs.update(tab.id, { active: true });
	}, targetOrigin);
	const flow = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'START_FLOW' }));
	expect(flow.ok, flow.error?.message).toBe(true);
	expect(flow.data).toMatchObject({ authMode: 'offline', canFill: true });
	expect(flow.data.serviceIcons).toEqual({ 'google.com': SERVICE_ICON_DATA_URL });
	expect(JSON.stringify(flow)).not.toContain(SECRET);
	const filled = await options.evaluate(
		({ nonce, accounts }) => chrome.runtime.sendMessage({ type: 'FILL_ACCOUNT', nonce, account: accounts[0] }),
		flow.data,
	);
	expect(filled.ok, filled.error?.message).toBe(true);
	await expect(target.locator('#otp')).toHaveValue(await generateTotp(SECRET, await worker.evaluate(() => Date.now())));
	expect(await target.evaluate(() => window.fixtureSubmits)).toBe(0);
}

for (const brand of ['chrome', 'edge']) {
	test(`${brand} refreshes saved connection changes across settings pages without losing a draft`, async () => {
		await withOfflineFixture(
			brand,
			[account(0)],
			async ({ context, options, instanceOrigin }) => {
				const second = await context.newPage();
				await second.goto(options.url());
				await expect(second.locator('#connection-summary')).toBeHidden();
				await expect(second.locator('#offline-enabled')).toBeEnabled();
				await second.locator('#offline-enabled').uncheck();
				await expect(options.locator('#offline-enabled')).not.toBeChecked();
				const otherOrigin = instanceOrigin.replace('127.0.0.1', 'localhost');
				const draft = 'https://draft.example';
				await options.locator('#instance-origin').fill(draft);
				await expect(options.locator('#connect-instance')).toHaveText('保存并连接');
				await second.locator('#instance-origin').fill(otherOrigin);
				await expect(second.locator('#connect-instance')).toBeEnabled();
				await expect(second.locator('#connect-instance')).toHaveText('保存并连接');
				await second.locator('#connect-instance').click();
				await expect(second.locator('#current-instance')).toHaveText(otherOrigin);
				await expect(second.locator('#instance-origin')).toHaveValue(otherOrigin);
				await expect(second.locator('#connect-instance')).toHaveText('检查连接');
				await options.bringToFront();
				await expect(options.locator('#instance-origin')).toHaveValue(draft);
				await expect(options.locator('#connection-summary')).toBeVisible();
				await expect(options.locator('#current-instance')).toHaveText(otherOrigin);
				await expect(options.locator('#cancel-connection')).toBeEnabled();
				await options.locator('#cancel-connection').click();
				await expect(options.locator('#current-instance')).toHaveText(otherOrigin);
				await expect(options.locator('#connection-editor')).toBeVisible();
				await expect(options.locator('#instance-origin')).toHaveValue(otherOrigin);
				await expect(options.locator('#instance-origin')).toBeFocused();
				await expect(options.locator('#connect-instance')).toHaveText('检查连接');
				await expect(options.locator('#connection-summary')).toBeHidden();
				await expect(options.locator('#offline-enabled')).not.toBeChecked();
				await expect(options.locator('#status')).toContainText('1 个账户');
				await expect(options.locator('#status')).not.toHaveAttribute('data-tone', 'error');
				await expect(options.locator('#check-instance')).toBeHidden();
			},
			{ extraPermissions: ['http://localhost/*'] },
		);
	});
	test(`${brand} retains valid clock calibration when only the time endpoint fails during account refresh`, async () => {
		const records = [account(0), account(1)];
		await withOfflineFixture(
			brand,
			records,
			async ({ worker, options, instanceOrigin, setTimeStatus, disconnect, openPopup }) => {
				const previousClock = await worker.evaluate(
					async () => (await chrome.storage.local.get('offlineCache')).offlineCache.snapshot.clock,
				);
				expect(previousClock.offsetMs).toBeGreaterThan(89000);
				records.pop();
				setTimeStatus(503);
				await expect
					.poll(async () => {
						const refreshed = await options.evaluate(
							(instanceOrigin) => chrome.runtime.sendMessage({ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin }),
							instanceOrigin,
						);
						expect(refreshed.ok, refreshed.error?.message).toBe(true);
						return worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache.snapshot.data.length);
					})
					.toBe(1);
				expect(await worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache.snapshot.clock)).toEqual(
					previousClock,
				);
				await disconnect();
				const popup = await openPopup();
				await expect
					.poll(async () => {
						const expected = await generateTotp(SECRET, (await worker.evaluate(() => Date.now())) + previousClock.offsetMs);
						return (await popup.locator('.preview-code').first().textContent()) === expected;
					})
					.toBe(true);
				await expect(popup.locator('#offline-state')).toBeHidden();
			},
			{ serverOffsetMs: 90000 },
		);
	});
	test(`${brand} keeps offline previews, scrolling, rollover and filling working after closing the source`, async ({
		browserName: _browserName,
	}, testInfo) => {
		await withOfflineFixture(
			brand,
			Array.from({ length: 187 }, (_, index) => account(index)),
			async (fixture) => {
				const { context, worker, options, instanceOrigin, targetOrigin, requestCounts, openPopup, disconnect } = fixture;
				await expect(options.locator('#status')).toHaveText('可离线使用 · 187 个账户');
				expect(await worker.evaluate(() => globalThis.fixtureFetchPaths)).toEqual(
					expect.arrayContaining(['/api/secrets', '/api/time', '/api/favicon/google.com']),
				);
				expect(await worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache.serviceIcons)).toEqual({
					'google.com': SERVICE_ICON_DATA_URL,
				});
				await disconnect();
				const requestsBefore = await requestCounts();
				const popup = await openPopup();
				await popup.setViewportSize({ width: 380, height: 600 });
				await expect(popup.locator('#target-origin')).toHaveText('当前页面仅支持复制');
				await expect(popup.locator('#status')).toBeHidden();
				await expectPopupLayout(popup, 3);
				const searchBounds = await popup.locator('#account-search').boundingBox();
				const headerBounds = await popup.locator('.topbar').boundingBox();
				const firstBounds = await popup.locator('.account-card').first().boundingBox();
				expect(searchBounds.y - headerBounds.y - headerBounds.height).toBeLessThanOrEqual(12);
				expect(firstBounds.y).toBeLessThanOrEqual(150);
				await savePopupScreenshot(popup, testInfo, 'view-only-top-aligned-380x600');
				await popup.emulateMedia({ colorScheme: 'dark' });
				await savePopupScreenshot(popup, testInfo, 'view-only-top-aligned-dark');
				await popup.emulateMedia({ colorScheme: 'light' });
				await expect(popup.locator('#offline-state')).toBeHidden();
				// A popup opened in a test tab initially sees its own extension URL.
				// Retry against the real OTP fixture to reproduce the normal popup UI.
				await options.evaluate(async (origin) => {
					const [tab] = await chrome.tabs.query({ url: origin + '/*' });
					await chrome.tabs.update(tab.id, { active: true });
				}, targetOrigin);
				await popup.locator('#retry').evaluate((button) => button.click());
				await expect(popup.locator('.account-fill').first()).toBeEnabled();
				await expect(popup.locator('#scope-all')).toContainText('187');
				await expect(popup.locator('#status')).toBeHidden();
				await assertCurrentCode(popup.locator('.preview-code').first(), worker);
				await expectOfflineServiceIcons(popup, 3);
				await savePopupScreenshot(popup, testInfo, 'compact-offline-380x600');
				await expectPopupLayout(popup, 3);
				await expect(popup.locator('#offline-state')).toBeHidden();
				await popup.setViewportSize({ width: 380, height: 500 });
				const search = popup.locator('#account-search');
				await expect(search).toBeInViewport({ ratio: 1 });
				await search.fill('synthetic-186');
				await expect(popup.locator('.account-card')).toHaveCount(1);
				await expect(popup.locator('.account-detail')).toHaveText('synthetic-186@example.com');
				await popup.locator('#account-search-clear').click();
				await expect(popup.locator('.account-card')).toHaveCount(187);
				await popup.locator('.account-card').last().scrollIntoViewIfNeeded();
				await assertCurrentCode(popup.locator('.account-card').last().locator('.preview-code'), worker);
				await expectPopupLayout(popup, 1);
				await expect(search).toBeInViewport({ ratio: 1 });
				await savePopupScreenshot(popup, testInfo, 'compact-offline-scroll-380x500');
				await popup.setViewportSize({ width: 380, height: 600 });
				await popup.locator('.account-card').first().scrollIntoViewIfNeeded();
				await assertCurrentCode(popup.locator('.preview-code').first(), worker);
				await popup.locator('.preview-code').first().click();
				await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
				const lastCard = popup.locator('.account-card').last();
				await lastCard.scrollIntoViewIfNeeded();
				await assertCurrentCode(lastCard.locator('.preview-code'), worker);
				await expectOfflineServiceIcon(lastCard);
				await popup.locator('.account-card').first().scrollIntoViewIfNeeded();
				await assertCurrentCode(popup.locator('.preview-code').first(), worker);
				for (let period = 0; period < 2; period += 1) {
					const previous = await popup.locator('.preview-code').first().textContent();
					await worker.evaluate(() => (globalThis.fixtureClockOffset += 30_000));
					await Promise.all(context.pages().map((page) => page.evaluate(() => (globalThis.fixtureClockOffset += 30_000))));
					await assertCurrentCode(popup.locator('.preview-code').first(), worker);
					await expect(popup.locator('.preview-code').first()).not.toHaveText(previous);
				}
				await popup.close();
				const reopenedPopup = await openPopup();
				await expectOfflineServiceIcons(reopenedPopup);
				await reopenedPopup.close();
				await fillFromTrustedPage(fixture);
				expect(await requestCounts()).toEqual(requestsBefore);
				expect(context.pages().some((page) => page.url().startsWith(instanceOrigin + '/'))).toBe(false);
			},
		);
	});

	test(`${brand} offers webpage recovery only after losing its cache and clears keys when switching off offline use`, async ({
		browserName: _browserName,
	}) => {
		const records = [account(0), account(1)];
		await withOfflineFixture(brand, records, async (fixture) => {
			const { context, worker, options, source, instanceOrigin, requestCounts, openPopup, disconnect, setFixtureOffline } = fixture;
			await setFixtureOffline();
			await source.evaluate(
				async ({ data, icon }) => {
					localStorage.setItem('2fa-secrets-cache', JSON.stringify({ data, timestamp: Date.now() }));
					localStorage.removeItem('2fa-clock-sync-v1');
					const cache = await caches.open('twofa-offline-service-icons-fixture');
					await cache.put(
						new URL('/api/favicon/google.com', window.location.origin).href,
						new Response(icon, { headers: { 'Content-Type': 'image/svg+xml' } }),
					);
				},
				{ data: records, icon: SERVICE_ICON },
			);
			// Clear through the real switch so both the background's memory and
			// its persistent cache are gone before reconnecting while offline.
			await options.locator('#offline-enabled').uncheck();
			await expect(options.locator('#status')).toHaveText('已关闭离线使用，本地密钥已清除');
			await options.locator('#offline-enabled').check();
			await expect(options.locator('#status')).toHaveAttribute('data-tone', 'error');
			await expect(options.locator('#import-offline')).toBeVisible();
			const requestsBeforeImport = await requestCounts();
			await options.locator('#import-offline').click();
			await expect(options.locator('#status')).toHaveText('可离线使用 · 2 个账户');
			await expect(options.locator('#import-offline')).toBeHidden();
			expect(await requestCounts()).toEqual(requestsBeforeImport);
			expect(await worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache.serviceIcons)).toEqual({
				'google.com': SERVICE_ICON_DATA_URL,
			});
			expect(
				await worker.evaluate(
					async ({ origin, secret }) => {
						const { offlineCache } = await chrome.storage.local.get('offlineCache');
						return offlineCache?.instanceOrigin === origin && offlineCache.snapshot.data.every((item) => item.secret === secret);
					},
					{ origin: instanceOrigin, secret: SECRET },
				),
			).toBe(true);
			await disconnect();
			const requestsBefore = await requestCounts();
			const popup = await openPopup();
			await assertCurrentCode(popup.locator('.preview-code').first(), worker);
			await expectOfflineServiceIcons(popup);
			await popup.locator('.preview-code').first().click();
			await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
			await popup.close();
			const reopenedPopup = await openPopup();
			await expectOfflineServiceIcons(reopenedPopup);
			await reopenedPopup.close();
			await fillFromTrustedPage(fixture);
			expect(await requestCounts()).toEqual(requestsBefore);
			expect(context.pages().some((page) => page.url().startsWith(instanceOrigin + '/'))).toBe(false);
			await options.locator('#offline-enabled').uncheck();
			await expect(options.locator('#status')).toHaveText('已关闭离线使用，本地密钥已清除');
			await expect(options.locator('#connection-mode')).toHaveCount(0);
			await expect(options.locator('#offline-enabled')).not.toBeChecked();
			expect(
				await worker.evaluate(
					async ({ origin, secret }) => {
						const local = await chrome.storage.local.get(null);
						const session = await chrome.storage.session.get(null);
						return !local.offlineCache && !local.offlineInstances?.includes(origin) && !JSON.stringify([local, session]).includes(secret);
					},
					{ origin: instanceOrigin, secret: SECRET },
				),
			).toBe(true);
			expect(await requestCounts()).toEqual(requestsBefore);
		});
	});
}
