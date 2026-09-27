import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTotp } from '../../../extension/src/shared/totp.js';
import { pinFixtureLanguage } from './language-fixture.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const TARGET = 'https://github.com';
const TIME = 1800000010000;
const SECRET = 'JBSWY3DPEHPK3PXP';
const SECOND_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SERVICE_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#2563eb"/><path d="M6 12h12M12 6v12" stroke="#fff" stroke-width="3"/></svg>';
const SERVICE_ICON_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SERVICE_ICON).toString('base64')}`;
const TARGET_HTML = `<!doctype html><title>Synthetic account synchronization target</title>
<form><label for="otp">Authenticator verification code</label>
<input id="otp" autocomplete="one-time-code" maxlength="6"><button type="submit">Continue</button></form>
<script>window.fixtureSubmits = 0; window.fixtureInputEvents = 0;
document.querySelector('#otp').addEventListener('input', () => { window.fixtureInputEvents += 1; });
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); window.fixtureSubmits += 1;
});</script>`;

function account(id, name = 'GitHub', email = `${id}@example.com`, secret = SECRET) {
	return { id, name, account: email, secret, type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1' };
}

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
	if (!inside || inside.startsWith('..') || isAbsolute(inside) || !basename(target).startsWith('twofa-sync-e2e-')) {
		throw new Error('Refusing to remove an unsafe browser test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

async function withSyncFixture(brand, records, run, fixtureOptions = {}) {
	const state = {
		records,
		secretsDelayMs: 0,
		secretsStatus: 200,
		holdSecrets: false,
		heldIconDomains: new Set(fixtureOptions.heldIconDomains || []),
	};
	const startedAt = Date.now();
	const requestPaths = [];
	const iconRequests = [];
	const heldIcons = new Map();
	const heldSecrets = new Set();
	const timers = new Set();
	const server = createServer((request, response) => {
		const path = new URL(request.url, 'http://fixture.invalid').pathname;
		requestPaths.push(path);
		if (path.startsWith('/api/favicon/')) {
			const domain = decodeURIComponent(path.slice('/api/favicon/'.length));
			iconRequests.push({ domain, cookie: request.headers.cookie || '', authorization: request.headers.authorization || '' });
			const respond = () => {
				if (!response.destroyed) {
					response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
					response.end(SERVICE_ICON);
				}
			};
			if (state.heldIconDomains.has(domain)) {
				const pending = heldIcons.get(domain) || [];
				pending.push(respond);
				heldIcons.set(domain, pending);
			} else {
				respond();
			}
			return;
		}
		if (path === '/source') {
			response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
			response.end('<!doctype html><title>Synthetic main webpage</title><main>Local 2FA cache fixture</main>');
			return;
		}
		const body = JSON.stringify(
			path === '/api/secrets' ? state.records : path === '/api/time' ? { serverTimeMs: TIME + Date.now() - startedAt } : {},
		);
		const respond = () => {
			if (!response.destroyed) {
				response.writeHead(path === '/api/secrets' ? state.secretsStatus : 200, {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
				});
				response.end(body);
			}
		};
		if (path === '/api/secrets' && state.holdSecrets) {
			heldSecrets.add(respond);
			response.once('close', () => heldSecrets.delete(respond));
		} else if (path === '/api/secrets' && state.secretsDelayMs) {
			const timer = setTimeout(() => {
				timers.delete(timer);
				respond();
			}, state.secretsDelayMs);
			timers.add(timer);
		} else {
			respond();
		}
	});
	await new Promise((done, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', done);
	});
	const instanceOrigin = `http://127.0.0.1:${server.address().port}`;
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-sync-e2e-'));
	let context;
	try {
		const extensionPath = join(temporaryRoot, brand);
		copyDirectory(join(ROOT, 'dist/extension', brand), extensionPath);
		const manifestPath = join(extensionPath, 'manifest.json');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		manifest.host_permissions = ['http://127.0.0.1/*', TARGET + '/*'];
		writeFileSync(manifestPath, JSON.stringify(manifest));
		context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
			channel: 'chromium',
			headless: true,
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		});
		await context.route(/^https?:\/\//, (route) => {
			const origin = new URL(route.request().url()).origin;
			return origin === instanceOrigin
				? route.continue()
				: origin === TARGET
					? route.fulfill({ contentType: 'text/html', body: TARGET_HTML })
					: route.abort();
		});
		const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
		const extensionId = new URL(worker.url()).host;
		if (fixtureOptions.authCookie) {
			await context.addCookies([{ url: instanceOrigin, name: 'auth_token', value: 'synthetic-icon-session', httpOnly: true }]);
		}
		await worker.evaluate(() => {
			globalThis.fixtureSourceHints = [];
			globalThis.fixtureFetchPaths = [];
			globalThis.fixtureFetchRequests = [];
			globalThis.fixturePendingIconFetches = 0;
			const fetch = globalThis.fetch.bind(globalThis);
			globalThis.fetch = (input, options) => {
				const url = new URL(typeof input === 'string' ? input : input.url || input.href);
				globalThis.fixtureFetchPaths.push(url.pathname);
				globalThis.fixtureFetchRequests.push({ origin: url.origin, path: url.pathname, credentials: options?.credentials || null });
				const icon = url.pathname.startsWith('/api/favicon/');
				if (icon) {
					globalThis.fixturePendingIconFetches += 1;
				}
				return fetch(input, options).finally(() => {
					if (icon) {
						globalThis.fixturePendingIconFetches -= 1;
					}
				});
			};
			chrome.runtime.onMessage.addListener((message) => {
				if (message.type === 'SOURCE_STATUS' || message.type === 'SOURCE_DIRTY') {
					globalThis.fixtureSourceHints.push({ type: message.type, keys: Object.keys(message) });
				}
				return false;
			});
		});
		await expect.poll(() => context.pages().some((page) => page.url() === `chrome-extension://${extensionId}/options.html`)).toBe(true);
		const options = context.pages().find((page) => page.url() === `chrome-extension://${extensionId}/options.html`);
		await pinFixtureLanguage(worker, [options]);
		await options.locator('#instance-origin').fill(instanceOrigin);
		await expect(options.locator('#connect-instance')).toBeEnabled();
		await options.locator('#offline-enabled').check();
		await options.locator('#connect-instance').click();
		await expect(options.locator('#status')).toContainText(`可离线使用 · ${records.length} 个账户`);
		const cacheIds = () =>
			worker.evaluate(
				async () => (await chrome.storage.local.get('offlineCache')).offlineCache?.snapshot?.data?.map((record) => record.id) || [],
			);
		// Connecting in offline mode prepares the cache automatically.
		await expect.poll(cacheIds, { timeout: 10000 }).toEqual(records.map((record) => record.id));
		const send = (message) => options.evaluate((message) => chrome.runtime.sendMessage(message), message);
		const enableTarget = async () => {
			const response = await send({
				type: 'SET_AUTOFILL_SITE',
				instanceOrigin,
				targetOrigin: TARGET,
				targetPath: '/sessions/two-factor',
				enabled: true,
			});
			expect(response.ok, response.error?.message).toBe(true);
		};
		const openTarget = async () => {
			const page = await context.newPage();
			await page.goto(TARGET + '/sessions/two-factor');
			return page;
		};
		const openPopup = async ({ keepTargetActive = false } = {}) => {
			let popup;
			if (keepTargetActive) {
				// A real toolbar popup leaves its web tab active. Create an inactive
				// extension tab to preserve that same target selection in this fixture.
				const opened = context.waitForEvent('page');
				await options.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: false }));
				popup = await opened;
			} else {
				popup = await context.newPage();
			}
			await popup.setViewportSize({ width: 380, height: 600 });
			await popup.addInitScript(() => {
				window.fixturePopupRequests = [];
				window.fixturePopupResponses = [];
				const send = chrome.runtime.sendMessage.bind(chrome.runtime);
				chrome.runtime.sendMessage = (message) => {
					window.fixturePopupRequests.push(message);
					return send(message).then((response) => {
						window.fixturePopupResponses.push({ type: message.type, ok: response.ok });
						return response;
					});
				};
			});
			await popup.goto(`chrome-extension://${extensionId}/popup.html`);
			return popup;
		};
		const openSource = async () => {
			const source = await context.newPage();
			await source.goto(instanceOrigin + '/source');
			await source.bringToFront();
			return source;
		};
		const writeWebCache = (source, data) =>
			source.evaluate((data) => {
				localStorage.setItem('2fa-secrets-cache', JSON.stringify({ data, timestamp: Date.now() }));
			}, data);
		const assertFilled = async (page, record) => {
			await expect
				.poll(
					async () =>
						(await page.locator('#otp').inputValue()) === (await generateTotp(record.secret, TIME + Date.now() - startedAt, record)),
					{ timeout: 12000 },
				)
				.toBe(true);
			expect(await page.evaluate(() => window.fixtureSubmits)).toBe(0);
		};
		const dirtyHints = () =>
			worker.evaluate(() => globalThis.fixtureSourceHints.filter((message) => message.type === 'SOURCE_DIRTY').length);
		const releaseIcons = (domain) => {
			state.heldIconDomains.delete(domain);
			for (const respond of heldIcons.get(domain) || []) {
				respond();
			}
			heldIcons.delete(domain);
		};
		const releaseSecrets = () => {
			state.holdSecrets = false;
			for (const respond of heldSecrets) {
				respond();
			}
			heldSecrets.clear();
		};
		const assertPreview = async (card, record) => {
			await expect
				.poll(
					async () =>
						(await card.locator('.preview-code').textContent()) ===
						(await generateTotp(record.secret, TIME + Date.now() - startedAt, record)),
				)
				.toBe(true);
		};
		await run({
			context,
			worker,
			options,
			state,
			instanceOrigin,
			cacheIds,
			requestPaths,
			iconRequests,
			releaseIcons,
			releaseSecrets,
			pendingSecrets: () => heldSecrets.size,
			send,
			enableTarget,
			openTarget,
			openPopup,
			openSource,
			writeWebCache,
			assertFilled,
			assertPreview,
			dirtyHints,
		});
	} finally {
		await context?.close();
		for (const timer of timers) {
			clearTimeout(timer);
		}
		await new Promise((done) => {
			server.close(done);
			server.closeAllConnections();
		});
		removeTemporaryRoot(temporaryRoot);
	}
}

async function expectServiceIcon(card) {
	const icon = card.locator('.service-icon img');
	await expect(icon).toHaveAttribute('src', SERVICE_ICON_DATA_URL);
	await expect.poll(() => icon.evaluate((element) => element.naturalWidth > 0)).toBe(true);
	await expect(icon).toBeVisible();
	await expect(card.locator('.service-icon-fallback')).toBeHidden();
}

for (const brand of ['chrome', 'edge']) {
	test(`${brand} opens cached cards and usable codes before the network responds, including a second preview batch`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const records = Array.from({ length: 14 }, (_, index) => account(`cached-${index}`, 'GitHub', `user${index}@example.com`));
		await withSyncFixture(
			brand,
			records,
			async ({ options, state, cacheIds, openPopup, assertPreview, pendingSecrets, releaseSecrets }) => {
				await options.waitForTimeout(1100);
				state.holdSecrets = true;
				state.secretsStatus = 503;
				const startedOpeningAt = Date.now();
				const popup = await openPopup();
				await expect.poll(pendingSecrets).toBe(1);
				await expect(popup.locator('.account-card')).toHaveCount(records.length);
				await assertPreview(popup.locator('.account-card').first(), records[0]);
				await expect(popup.locator('#status')).not.toContainText('正在连接');
				const firstPreviewElapsedMs = Date.now() - startedOpeningAt;
				const screenshotPath = testInfo.outputPath('cached-popup-before-network.png');
				await popup.screenshot({ path: screenshotPath });
				await testInfo.attach('cached-popup-before-network', {
					path: screenshotPath,
					contentType: 'image/png',
				});
				const timingPath = testInfo.outputPath('cached-popup-startup.json');
				writeFileSync(timingPath, JSON.stringify({ firstPreviewElapsedMs, releasedServerResponses: 0 }));
				await testInfo.attach('cached-popup-startup', {
					path: timingPath,
					contentType: 'application/json',
				});
				const firstBatchCount = await popup.evaluate(
					() => window.fixturePopupRequests.filter((message) => message.type === 'START_FLOW').length,
				);
				const last = popup.locator(`.account-card[data-account-id="${records.at(-1).id}"]`);
				await last.scrollIntoViewIfNeeded();
				await assertPreview(last, records.at(-1));
				expect(
					await popup.evaluate(() => window.fixturePopupRequests.filter((message) => message.type === 'START_FLOW').length),
				).toBeGreaterThan(firstBatchCount);
				await last.locator('.preview-code').click();
				await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
				// No server headers or body have been released: both first paint and a
				// later nonce/preview batch demonstrably completed without the network.
				expect(pendingSecrets()).toBe(1);
				expect(
					await popup.evaluate(() => window.fixturePopupResponses.some((message) => message.type === 'REFRESH_OFFLINE_ACCOUNTS')),
				).toBe(false);
				releaseSecrets();
				await expect
					.poll(() => popup.evaluate(() => window.fixturePopupResponses.some((message) => message.type === 'REFRESH_OFFLINE_ACCOUNTS')))
					.toBe(true);
				await expect(popup.locator('.account-card')).toHaveCount(records.length);
				await assertPreview(last, records.at(-1));
				await last.locator('.preview-code').click();
				await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
				expect(await cacheIds()).toEqual(records.map((record) => record.id));
			},
		);
	});

	test(`${brand} never automatically fills a cached unique match while the fresh account list is pending`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
		await withSyncFixture(
			brand,
			[alice],
			async ({ options, state, cacheIds, openTarget, openPopup, assertPreview, pendingSecrets, releaseSecrets }) => {
				await options.waitForTimeout(1100);
				state.records = [alice, bob];
				state.holdSecrets = true;
				const target = await openTarget();
				const popup = await openPopup({ keepTargetActive: true });
				await expect.poll(pendingSecrets).toBe(1);
				await expect(popup.locator('.account-card')).toHaveCount(1);
				await assertPreview(popup.locator('.account-card'), alice);
				await expect(target.locator('#otp')).toHaveValue('');
				expect(await target.evaluate(() => window.fixtureInputEvents)).toBe(0);
				expect(await popup.evaluate(() => window.fixturePopupRequests.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual([]);
				releaseSecrets();
				await expect(popup.locator('.account-card')).toHaveCount(2);
				await expect.poll(cacheIds).toEqual([alice.id, bob.id]);
				await assertPreview(popup.locator('.account-card[data-account-id="bob"]'), bob);
				await expect(target.locator('#otp')).toHaveValue('');
				expect(await target.evaluate(() => window.fixtureInputEvents)).toBe(0);
			},
		);
	});

	for (const interaction of ['untouched', 'search-and-copy']) {
		test(`${brand} handles a fresh unique match after cached popup startup when ${interaction}`, async ({ browserName: _browserName }) => {
			const alice = account('alice');
			const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
			await withSyncFixture(
				brand,
				[alice, bob],
				async ({ options, state, cacheIds, openTarget, openPopup, assertPreview, assertFilled, pendingSecrets, releaseSecrets }) => {
					await options.waitForTimeout(1100);
					state.records = [alice];
					state.holdSecrets = true;
					const target = await openTarget();
					const popup = await openPopup({ keepTargetActive: true });
					await expect.poll(pendingSecrets).toBe(1);
					await expect(popup.locator('.account-card')).toHaveCount(2);
					const aliceCard = popup.locator('.account-card[data-account-id="alice"]');
					await assertPreview(aliceCard, alice);
					await expect(target.locator('#otp')).toHaveValue('');
					if (interaction === 'search-and-copy') {
						await popup.locator('#account-search').fill('alice');
						await expect(popup.locator('.account-card')).toHaveCount(1);
						await aliceCard.locator('.preview-code').click();
						await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
					}
					expect(pendingSecrets()).toBe(1);
					releaseSecrets();
					await expect.poll(cacheIds).toEqual([alice.id]);
					await expect(popup.locator('.account-card')).toHaveCount(1);
					if (interaction === 'untouched') {
						await expect(target.locator('#otp')).toHaveValue('');
						expect(await popup.evaluate(() => window.fixturePopupRequests.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual(
							[],
						);
						await aliceCard.locator('.account-fill').evaluate((button) => button.click());
						await assertFilled(target, alice);
						expect(await target.evaluate(() => window.fixtureInputEvents)).toBe(1);
						expect(await popup.evaluate(() => window.fixturePopupRequests.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual([
							expect.objectContaining({ account: expect.objectContaining({ id: alice.id }) }),
						]);
					} else {
						await assertPreview(aliceCard, alice);
						await expect(popup.locator('#account-search')).toHaveValue('alice');
						await expect(target.locator('#otp')).toHaveValue('');
						expect(await popup.evaluate(() => window.fixturePopupRequests.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual(
							[],
						);
					}
				},
			);
		});
	}

	test(`${brand} removes cached cards and codes if the pending startup refresh reports expired login`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		await withSyncFixture(
			brand,
			[alice],
			async ({ options, state, cacheIds, openTarget, openPopup, assertPreview, pendingSecrets, releaseSecrets }) => {
				await options.waitForTimeout(1100);
				state.secretsStatus = 401;
				state.holdSecrets = true;
				const target = await openTarget();
				const popup = await openPopup({ keepTargetActive: true });
				await expect.poll(pendingSecrets).toBe(1);
				await assertPreview(popup.locator('.account-card'), alice);
				await expect(target.locator('#otp')).toHaveValue('');
				releaseSecrets();
				await expect.poll(cacheIds).toEqual([]);
				await expect(popup.locator('#status')).toContainText('登录');
				await expect(popup.locator('.account-card:visible')).toHaveCount(0);
				await expect(popup.locator('.preview-code:visible')).toHaveCount(0);
				await expect(target.locator('#otp')).toHaveValue('');
				expect(await target.evaluate(() => window.fixtureInputEvents)).toBe(0);
			},
		);
	});

	test(`${brand} automatically fills service icons without blocking codes or replaying popup autofill`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const google = account('google', 'Google');
		await withSyncFixture(
			brand,
			[alice],
			async ({
				context,
				worker,
				state,
				instanceOrigin,
				iconRequests,
				releaseIcons,
				cacheIds,
				openTarget,
				openPopup,
				openSource,
				writeWebCache,
				assertFilled,
			}) => {
				await expect.poll(() => iconRequests.map((request) => request.domain)).toEqual(['github.com']);
				expect(await context.cookies()).toContainEqual(
					expect.objectContaining({ name: 'auth_token', value: 'synthetic-icon-session', httpOnly: true }),
				);
				const target = await openTarget();
				const popup = await openPopup();
				await expect(popup.locator('.preview-code')).toHaveText(/^\d{6}$/);
				await expect(popup.locator('.service-icon-fallback')).toBeVisible();
				// The server deliberately has not sent icon headers yet. Accounts,
				// previews and filling must all work before the image is released.
				expect(await worker.evaluate(() => globalThis.fixturePendingIconFetches)).toBe(1);
				await popup.evaluate(async (origin) => {
					const [tab] = await chrome.tabs.query({ url: origin + '/*' });
					await chrome.tabs.update(tab.id, { active: true });
				}, TARGET);
				await popup.locator('#retry').evaluate((button) => button.click());
				await expect(popup.locator('.account-fill')).toBeEnabled();
				await expect(target.locator('#otp')).toHaveValue('');
				// Exercise the explicit manual fill path without closing this test's
				// popup; its subsequent icon updates must preserve the live cards.
				const manualFill = await popup.evaluate(async () => {
					const flow = await chrome.runtime.sendMessage({ type: 'START_FLOW' });
					if (!flow.ok) {
						return flow;
					}
					return chrome.runtime.sendMessage({
						type: 'FILL_ACCOUNT',
						nonce: flow.data.nonce,
						account: flow.data.accounts[0],
						remember: false,
					});
				});
				expect(manualFill.ok, manualFill.error?.message).toBe(true);
				await assertFilled(target, alice);
				// The trusted fixture's independent flow consumed the shared nonce;
				// refresh this popup before observing in-place image updates.
				await expect(popup.locator('#retry')).toBeEnabled();
				await popup.locator('#retry').evaluate((button) => button.click());
				await expect(popup.locator('.preview-code')).toHaveText(/^\d{6}$/);
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				await expect(popup.locator('#retry')).toBeEnabled();
				const inputsBeforeIcon = await target.evaluate(() => window.fixtureInputEvents);
				expect(inputsBeforeIcon).toBe(1);
				await popup.evaluate(() => {
					window.fixtureIconMessages = [];
					window.fixturePopupRequests = [];
					window.fixtureOriginalCard = document.querySelector('.account-card');
					const send = chrome.runtime.sendMessage.bind(chrome.runtime);
					chrome.runtime.sendMessage = (message) => {
						window.fixturePopupRequests.push(message.type);
						return send(message);
					};
					chrome.runtime.onMessage.addListener((message) => {
						if (message.type === 'ICONS_CHANGED') {
							window.fixtureIconMessages.push(message);
						}
						return false;
					});
				});
				releaseIcons('github.com');
				await expectServiceIcon(popup.locator('.account-card'));
				expect(await popup.evaluate(() => document.querySelector('.account-card') === window.fixtureOriginalCard)).toBe(true);
				expect(
					await popup.evaluate(() => window.fixturePopupRequests.filter((type) => ['START_FLOW', 'FILL_ACCOUNT'].includes(type))),
				).toEqual([]);
				expect(await target.evaluate(() => window.fixtureInputEvents)).toBe(inputsBeforeIcon);
				await expect.poll(() => popup.evaluate(() => window.fixtureIconMessages)).toContainEqual({ type: 'ICONS_CHANGED', instanceOrigin });

				state.records = [alice, google];
				state.heldIconDomains.add('google.com');
				const source = await openSource();
				await writeWebCache(source, [alice, google]);
				// This popup still belongs to the captured GitHub login. Restore that
				// active tab before the debounced source notification refreshes its flow.
				await target.bringToFront();
				await expect.poll(cacheIds).toEqual([alice.id, google.id]);
				await expect(popup.locator('#scope-all')).toHaveText('全部账户 (2)');
				await popup.locator('#scope-all').click();
				await expect(popup.locator('.account-card')).toHaveCount(2);
				const googleCard = popup.locator('.account-card[data-account-id="google"]');
				await expect(googleCard.locator('.preview-code')).toHaveText(/^\d{6}$/);
				await expect(googleCard.locator('.service-icon-fallback')).toBeVisible();
				await expect.poll(() => iconRequests.map((request) => request.domain)).toEqual(['github.com', 'google.com']);
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				const flowsBeforeIcon = await popup.evaluate(() =>
					window.fixturePopupRequests.filter((type) => ['START_FLOW', 'FILL_ACCOUNT'].includes(type)),
				);
				releaseIcons('google.com');
				await expectServiceIcon(googleCard);
				expect(
					await popup.evaluate(() => window.fixturePopupRequests.filter((type) => ['START_FLOW', 'FILL_ACCOUNT'].includes(type))),
				).toEqual(flowsBeforeIcon);
				expect(iconRequests).toEqual([
					{ domain: 'github.com', cookie: '', authorization: '' },
					{ domain: 'google.com', cookie: '', authorization: '' },
				]);
				const imageFetches = await worker.evaluate(() =>
					globalThis.fixtureFetchRequests.filter((request) => request.path.startsWith('/api/favicon/')),
				);
				expect(imageFetches).toEqual([
					{ origin: instanceOrigin, path: '/api/favicon/github.com', credentials: 'omit' },
					{ origin: instanceOrigin, path: '/api/favicon/google.com', credentials: 'omit' },
				]);
				await source.close();
				await context.setOffline(true);
				await worker.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
				await popup.close();
				const offlineFetches = await worker.evaluate(() => globalThis.fixtureFetchPaths.length);
				const reopened = await openPopup();
				await expect(reopened.locator('.account-card')).toHaveCount(2);
				for (const card of await reopened.locator('.account-card').all()) {
					await expectServiceIcon(card);
				}
				await expect(reopened.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
				expect(await worker.evaluate(() => globalThis.fixtureFetchPaths.length)).toBe(offlineFetches);
			},
			{ heldIconDomains: ['github.com'], authCookie: true },
		);
	});

	for (const change of ['clear', 'session', 'switch-instance']) {
		test(`${brand} discards pending icon downloads after ${change}`, async ({ browserName: _browserName }) => {
			await withSyncFixture(
				brand,
				[account('alice')],
				async ({ worker, options, instanceOrigin, iconRequests, releaseIcons, send }) => {
					await expect.poll(() => iconRequests.length).toBe(1);
					expect(await worker.evaluate(() => globalThis.fixturePendingIconFetches)).toBe(1);
					const nextOrigin = change === 'switch-instance' ? 'http://127.0.0.1:31002' : instanceOrigin;
					const changed = await send(
						change === 'clear'
							? { type: 'CLEAR_OFFLINE' }
							: { type: 'SAVE_INSTANCE', instanceOrigin: nextOrigin, connection: { mode: change === 'session' ? 'session' : 'offline' } },
					);
					expect(changed.ok, changed.error?.message).toBe(true);
					releaseIcons('github.com');
					await expect.poll(() => worker.evaluate(() => globalThis.fixturePendingIconFetches)).toBe(0);
					await options.waitForTimeout(100);
					expect(await worker.evaluate(async () => (await chrome.storage.local.get('offlineCache')).offlineCache)).toBeUndefined();
					expect(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.instanceOrigin)).toBe(nextOrigin);
					const icons = await send({ type: 'OFFLINE_ICONS' });
					if (change === 'switch-instance') {
						expect(icons).toEqual({ ok: true, data: { instanceOrigin: nextOrigin, serviceIcons: {} } });
					} else {
						expect(icons.ok).toBe(false);
					}
				},
				{ heldIconDomains: ['github.com'] },
			);
		});
	}

	test(`${brand} automatically builds its offline cache and refreshes new popup and automatic interactions`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
		await withSyncFixture(
			brand,
			[alice, bob],
			async ({ context, state, options, cacheIds, requestPaths, enableTarget, openTarget, openPopup, assertFilled }) => {
				expect(requestPaths).toContain('/api/secrets');
				state.records = [alice];
				state.secretsDelayMs = 2000;
				// Exceed only the one-second interaction coalescing window, not the old
				// five-minute cache age. A healthy two-second response must be honored.
				await options.waitForTimeout(1100);
				const popup = await openPopup();
				await expect(popup.locator('.account-card')).toHaveCount(1, { timeout: 12000 });
				await expect(popup.locator('.account-card')).toHaveAttribute('data-account-id', alice.id);
				await expect.poll(cacheIds).toEqual([alice.id]);
				await popup.close();
				state.secretsDelayMs = 0;
				state.records = [alice, bob];
				await enableTarget();
				await options.waitForTimeout(1100);
				const earlier = await openTarget();
				await expect(earlier.locator('[data-twofa-autofill]')).toHaveCount(1);
				await expect(earlier.locator('#otp')).toHaveValue('');
				await earlier.close();
				state.records = [bob];
				await options.waitForTimeout(1100);
				const current = await openTarget();
				await assertFilled(current, bob);
				await expect.poll(cacheIds).toEqual([bob.id]);
				expect(context.pages().some((page) => /\/popup\.html$/.test(page.url()))).toBe(false);
			},
		);
	});

	test(`${brand} refreshes an open chooser and popup from same-page source cache changes while preserving search`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
		const backup = account('backup', 'Cloudflare', 'alice+backup@example.com');
		const pageOnly = account('page-only', 'Untrusted cached metadata');
		await withSyncFixture(
			brand,
			[alice, bob, backup],
			async ({
				context,
				worker,
				state,
				cacheIds,
				enableTarget,
				openTarget,
				openPopup,
				openSource,
				writeWebCache,
				assertFilled,
				dirtyHints,
			}) => {
				await enableTarget();
				const source = await openSource();
				await writeWebCache(source, [alice, bob, backup]);
				await expect.poll(dirtyHints).toBeGreaterThan(0);
				const target = await openTarget();
				await expect(target.locator('[data-twofa-autofill]')).toHaveCount(1);
				const popup = await openPopup();
				await expect(popup.locator('.account-card')).toHaveCount(3);
				await popup.locator('#account-search').fill('alice');
				await expect(popup.locator('.account-card')).toHaveCount(2);
				const hintsBefore = await dirtyHints();
				state.records = [alice];
				await source.bringToFront();
				// The webpage cache is only a change hint. The extension must fetch the
				// server's Alice record, never import this different synthetic payload.
				await writeWebCache(source, [pageOnly]);
				await expect.poll(dirtyHints, { timeout: 10000 }).toBeGreaterThan(hintsBefore);
				await expect.poll(cacheIds, { timeout: 10000 }).toEqual([alice.id]);
				await expect(popup.locator('#account-search')).toHaveValue('alice');
				await expect(popup.locator('.account-card')).toHaveCount(1);
				await expect(popup.locator('.account-card')).toHaveAttribute('data-account-id', alice.id);
				await target.bringToFront();
				await assertFilled(target, alice);
				state.records = [alice, backup];
				await source.bringToFront();
				await writeWebCache(source, [pageOnly, bob]);
				await expect.poll(cacheIds, { timeout: 10000 }).toEqual([alice.id, backup.id]);
				await expect(popup.locator('#account-search')).toHaveValue('alice');
				await expect(popup.locator('.account-card')).toHaveCount(2);
				expect(
					await worker.evaluate(() =>
						globalThis.fixtureSourceHints.every((message) => message.keys.length === 1 && message.keys[0] === 'type'),
					),
				).toBe(true);
				expect(context.pages().filter((page) => page.url().endsWith('/popup.html'))).toHaveLength(1);
			},
		);
	});

	test(`${brand} works offline with the main webpage closed, refreshes on reconnect, and stops watching in session mode`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
		await withSyncFixture(
			brand,
			[alice],
			async ({
				context,
				worker,
				options,
				state,
				instanceOrigin,
				cacheIds,
				send,
				enableTarget,
				openTarget,
				openPopup,
				openSource,
				writeWebCache,
				assertFilled,
				dirtyHints,
			}) => {
				const source = await openSource();
				await writeWebCache(source, [alice]);
				await expect.poll(dirtyHints).toBeGreaterThan(0);
				await source.close();
				await context.setOffline(true);
				let popup = await openPopup();
				await expect(popup.locator('.account-card')).toHaveCount(1);
				await expect(popup.locator('.preview-code')).toHaveText(/^\d{6}$/);
				const offlineFetches = await worker.evaluate(() => globalThis.fixtureFetchPaths.length);
				await popup.locator('.preview-code').click();
				await expect(popup.locator('#copy-toast')).toContainText('验证码已复制');
				await popup.close();
				await enableTarget();
				const target = await openTarget();
				await assertFilled(target, alice);
				await target.close();
				popup = await openPopup();
				await expect(popup.locator('.preview-code')).toHaveText(/^\d{6}$/);
				expect(await worker.evaluate(() => globalThis.fixtureFetchPaths.length)).toBe(offlineFetches);
				expect(context.pages().some((page) => page.url().startsWith(instanceOrigin))).toBe(false);
				state.records = [alice, bob];
				state.secretsDelayMs = 2000;
				await context.setOffline(false);
				await expect(popup.locator('.account-card')).toHaveCount(2, { timeout: 15000 });
				await expect.poll(cacheIds).toEqual([alice.id, bob.id]);
				await popup.close();
				state.secretsDelayMs = 0;
				const resumedSource = await openSource();
				const previousHints = await dirtyHints();
				await writeWebCache(resumedSource, [alice, bob]);
				await expect.poll(dirtyHints).toBeGreaterThan(previousHints);
				const saved = await send({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'session' } });
				expect(saved.ok, saved.error?.message).toBe(true);
				await expect
					.poll(() =>
						worker.evaluate(async () =>
							(await chrome.scripting.getRegisteredContentScripts()).filter((script) => script.js.includes('source-watch.js')),
						),
					)
					.toEqual([]);
				// The open settings page checks the session-mode login once after the
				// mode changes (one /api/secrets request). It is queued behind the
				// configuration change and may land after the watcher stops, so wait
				// for its result before counting requests caused by the webpage.
				await expect(options.locator('#status')).toHaveText('已连接 · 2 个账户');
				const stoppedHints = await dirtyHints();
				const stoppedFetches = await worker.evaluate(() => globalThis.fixtureFetchPaths.length);
				await writeWebCache(resumedSource, [bob]);
				await resumedSource.waitForTimeout(2200);
				expect(await dirtyHints()).toBe(stoppedHints);
				// List the extra paths, if any, so a failure names the request.
				expect((await worker.evaluate(() => globalThis.fixtureFetchPaths)).slice(stoppedFetches)).toEqual([]);
			},
		);
	});

	test(`${brand} clears unauthorized cached accounts without a refresh loop and recovers after a source login change`, async ({
		browserName: _browserName,
	}) => {
		const alice = account('alice');
		const bob = account('bob', 'GitHub', 'bob@example.com', SECOND_SECRET);
		await withSyncFixture(
			brand,
			[alice, bob],
			async ({
				options,
				state,
				cacheIds,
				requestPaths,
				enableTarget,
				openTarget,
				openPopup,
				openSource,
				writeWebCache,
				assertFilled,
				dirtyHints,
			}) => {
				await options.evaluate(() => {
					window.fixtureCacheNotices = 0;
					chrome.runtime.onMessage.addListener((message) => {
						if (message.type === 'ACCOUNTS_CHANGED') {
							window.fixtureCacheNotices += 1;
						}
						return false;
					});
				});
				await enableTarget();
				const source = await openSource();
				await writeWebCache(source, [alice, bob]);
				await expect.poll(dirtyHints).toBeGreaterThan(0);
				const target = await openTarget();
				await expect(target.locator('[data-twofa-autofill]')).toHaveCount(1);
				const popup = await openPopup();
				await expect(popup.locator('.account-card')).toHaveCount(2);
				state.secretsStatus = 401;
				await source.bringToFront();
				await writeWebCache(source, [bob]);
				await expect.poll(cacheIds, { timeout: 10000 }).toEqual([]);
				await expect(popup.locator('#status')).toContainText('登录', { timeout: 10000 });
				await expect(target.locator('#otp')).toHaveValue('');
				// The first clear notification can cause one reread. Once those
				// handlers settle, repeated clearing of an empty cache must be quiet.
				await source.waitForTimeout(1200);
				const activity = async () => ({
					requests: requestPaths.filter((path) => path === '/api/secrets').length,
					notices: await options.evaluate(() => window.fixtureCacheNotices),
					hints: await dirtyHints(),
				});
				const settled = await activity();
				await source.waitForTimeout(3000);
				expect(await activity()).toEqual(settled);
				state.secretsStatus = 200;
				state.records = [alice];
				await writeWebCache(source, [alice]);
				await expect.poll(cacheIds, { timeout: 10000 }).toEqual([alice.id]);
				await expect(popup.locator('.account-card')).toHaveCount(1, { timeout: 10000 });
				await expect(popup.locator('.account-card')).toHaveAttribute('data-account-id', alice.id);
				await expect(popup.locator('#status')).toBeHidden();
				await target.bringToFront();
				await assertFilled(target, alice);
			},
		);
	});
}
