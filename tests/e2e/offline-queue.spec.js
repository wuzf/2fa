import { chromium, expect, test } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createMainPage } from '../../src/ui/page.js';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { createManifest, createDefaultIcon } from '../../src/ui/manifest.js';

// Synthetic fixture only. The actual page scripts, service worker and browser
// IndexedDB run unchanged; the HTTP backend supplies controlled auth failures.
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const PASSWORD = 'Offline-fixture-password!';

function chromeExecutable() {
	return [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
	].find((candidate) => existsSync(candidate));
}

function record(id, name) {
	return { id, name, account: `${id}@example.test`, secret: SEED, type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1' };
}

async function startFixture() {
	const html = await (await createMainPage()).text();
	const sw = await createServiceWorker({ SW_VERSION: 'offline-queue-fixture' }).text();
	const state = {
		expired: false,
		writeStatus: 200,
		loginCount: 0,
		writeAttempts: [],
		records: [record('existing', 'Existing account')],
		reads: { time: 0, secrets: 0 },
		holds: new Map(),
	};
	const heldResponses = [];
	const sendOrHold = (key, response, status, headers, body) => {
		const mode = state.holds.get(key);
		if (!mode) {
			response.writeHead(status, headers);
			response.end(body);
			return;
		}
		if (mode === 'body') {
			response.writeHead(status, headers);
			response.flushHeaders();
			response.write(body.slice(0, 1));
		}
		heldResponses.push({
			key,
			release() {
				if (response.destroyed) {
					return;
				}
				if (mode !== 'body') {
					response.writeHead(status, headers);
				}
				response.end(mode === 'body' ? body.slice(1) : body);
			},
		});
	};
	const sendJson = (response, status, data, headers = {}) => {
		response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
		response.end(JSON.stringify(data));
	};
	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://fixture.invalid');
		try {
			if (url.pathname === '/') {
				sendOrHold(
					'navigation',
					response,
					200,
					{
						'Content-Type': 'text/html; charset=utf-8',
						'Cache-Control': 'no-store',
						'Set-Cookie': 'fixture_session=valid; HttpOnly; SameSite=Strict; Path=/',
					},
					html,
				);
				return;
			}
			if (url.pathname === '/sw.js') {
				response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
				response.end(sw);
				return;
			}
			if (url.pathname === '/manifest.json' || url.pathname.startsWith('/icon-')) {
				const result =
					url.pathname === '/manifest.json' ? createManifest(new Request('http://localhost/manifest.json')) : createDefaultIcon(192);
				response.writeHead(result.status, Object.fromEntries(result.headers));
				response.end(await result.text());
				return;
			}
			let body = '';
			for await (const chunk of request) {
				body += chunk;
			}
			const data = body ? JSON.parse(body) : {};
			if (url.pathname === '/api/login') {
				if (data.credential !== PASSWORD) {
					return sendJson(response, 401, { success: false });
				}
				state.expired = false;
				state.loginCount += 1;
				return sendJson(response, 200, { success: true }, { 'Set-Cookie': 'fixture_session=valid; HttpOnly; SameSite=Strict; Path=/' });
			}
			if (url.pathname === '/api/time') {
				state.reads.time += 1;
				return sendOrHold(
					'time',
					response,
					200,
					{ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
					JSON.stringify({ serverTimeMs: Date.now() }),
				);
			}
			if (url.pathname === '/api/secrets' && request.method === 'GET') {
				state.reads.secrets += 1;
				return state.expired
					? sendJson(response, 401, { error: 'Login required' })
					: sendOrHold(
							'secrets',
							response,
							200,
							{ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
							JSON.stringify(state.records),
						);
			}
			if (url.pathname.startsWith('/api/secrets') && ['POST', 'PUT'].includes(request.method)) {
				const status = state.expired ? 401 : state.writeStatus;
				state.writeAttempts.push({ path: url.pathname, method: request.method, status, name: data.name });
				if (status !== 200) {
					return sendJson(response, status, { error: 'Synthetic write failure' });
				}
				const saved = { ...data, id: request.method === 'PUT' ? url.pathname.split('/').at(-1) : `added-${state.records.length}` };
				state.records =
					request.method === 'PUT' ? state.records.map((item) => (item.id === saved.id ? saved : item)) : [...state.records, saved];
				return sendJson(response, request.method === 'POST' ? 201 : 200, { success: true, data: { secret: saved } });
			}
			if (url.pathname === '/api/settings') {
				return sendJson(response, 200, { settings: {} });
			}
			if (url.pathname.endsWith('/config')) {
				return sendJson(response, 200, { configs: [] });
			}
			if (url.pathname.startsWith('/api/favicon/')) {
				response.writeHead(404);
				response.end();
				return;
			}
			sendJson(response, 404, { error: 'Not found' });
		} catch {
			sendJson(response, 500, { error: 'Fixture error' });
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		state,
		heldCount: (key) => heldResponses.filter((item) => item.key === key).length,
		release(key) {
			state.holds.delete(key);
			for (let index = heldResponses.length - 1; index >= 0; index -= 1) {
				if (heldResponses[index].key === key) {
					heldResponses.splice(index, 1)[0].release();
				}
			}
		},
		origin: `http://127.0.0.1:${server.address().port}`,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(resolve);
			}),
	};
}

async function queueEntries(page) {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const opening = indexedDB.open('2fa-offline-db', 1);
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const db = opening.result;
					const read = db.transaction('pending-operations').objectStore('pending-operations').getAll();
					read.onsuccess = () => {
						db.close();
						resolve(read.result.map(({ id, type, status, retryCount, lastError }) => ({ id, type, status, retryCount, lastError })));
					};
					read.onerror = () => {
						db.close();
						reject(read.error);
					};
				};
			}),
	);
}

async function enqueueAdd(page, name) {
	await page.getByRole('button', { name: '打开操作菜单', exact: true }).click();
	await page.locator('#actionSubmenu').getByRole('button', { name: /添加/ }).click();
	await page.locator('#secretName').fill(name);
	await page.locator('#secretService').fill('offline@example.test');
	await page.locator('#secretKey').fill(SEED);
	await page.locator('#submitBtn').click();
	await expect(page.locator('#secretModal')).toBeHidden();
}

async function enqueueEdit(page) {
	const card = page.locator('.secret-card').filter({ hasText: 'Existing account' });
	await card.getByRole('button', { name: '账户操作', exact: true }).click();
	await card.getByRole('button', { name: '编辑', exact: true }).click();
	await page.locator('#secretName').fill('Edited while offline');
	await page.locator('#submitBtn').click();
	await expect(page.locator('#secretModal')).toBeHidden();
}

async function syncOnce(page) {
	await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					navigator.serviceWorker.removeEventListener('message', receive);
					reject(new Error('Sync response timed out'));
				}, 8000);
				function receive(event) {
					if (event.data?.type !== 'SYNC_COMPLETE') {
						return;
					}
					clearTimeout(timeout);
					navigator.serviceWorker.removeEventListener('message', receive);
					resolve();
				}
				navigator.serviceWorker.addEventListener('message', receive);
				navigator.serviceWorker.controller.postMessage({ type: 'SYNC_OPERATIONS' });
			}),
	);
}

test('real service worker pauses offline add/edit on 401, resumes on login, and supports failed retry/cancel', async () => {
	const testInfo = test.info();
	const fixture = await startFixture();
	const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
	// This scenario uses Chinese action labels and queue messages throughout.
	const context = await browser.newContext({ serviceWorkers: 'allow', locale: 'zh-CN' });
	const page = await context.newPage();
	try {
		// Avoid external project/CDN/version-check traffic from this synthetic page.
		await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort()));
		await page.goto(fixture.origin);
		await expect(page.locator('.secret-card').filter({ hasText: 'Existing account' })).toBeVisible();
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
		await context.setOffline(true);
		await enqueueAdd(page, 'Added while offline');
		await enqueueEdit(page);
		await expect.poll(async () => (await queueEntries(page)).map((item) => item.type).sort()).toEqual(['ADD', 'UPDATE']);

		fixture.state.expired = true;
		await context.setOffline(false);
		await expect(page.locator('#offlineQueueSummary')).toHaveText('有更改等待登录后同步');
		await expect.poll(async () => (await queueEntries(page)).some((item) => item.status === 'awaiting_auth')).toBe(true);
		// The replay's login pause is confirmed with an account read: the expired
		// session clears cached codes exactly like an online 401, keeping the queue.
		await expect(page.locator('.secret-card')).toHaveCount(0);
		expect(await page.evaluate(() => localStorage.getItem('2fa-secrets-cache'))).toBeNull();
		await expect(page.locator('#loginModal')).toBeVisible();
		const before = await queueEntries(page);
		const authFailures = fixture.state.writeAttempts.filter((item) => item.status === 401).length;
		for (let attempt = 0; attempt < 6; attempt += 1) {
			await syncOnce(page);
		}
		expect(await queueEntries(page)).toEqual(before);
		expect(fixture.state.writeAttempts.filter((item) => item.status === 401).length).toBe(authFailures);
		expect(before.every((item) => item.retryCount === 0 && item.status !== 'failed')).toBe(true);
		await page.screenshot({ path: testInfo.outputPath('auth-paused-desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 380, height: 820 });
		await page.screenshot({ path: testInfo.outputPath('auth-paused-mobile.png'), fullPage: true });
		await page.setViewportSize({ width: 1280, height: 720 });

		// Logging in through the dialog opened by the expired session resumes the queue.
		await page.locator('#loginToken').fill(PASSWORD);
		await page
			.locator('#loginForm')
			.getByRole('button', { name: /登录|验证/ })
			.click();
		await expect.poll(async () => (await queueEntries(page)).length).toBe(0);
		expect(fixture.state.loginCount).toBe(1);
		expect(fixture.state.records.map((item) => item.name).sort()).toEqual(['Added while offline', 'Edited while offline']);
		await expect(page.locator('#offlineQueue')).toBeHidden();

		await context.setOffline(true);
		await enqueueAdd(page, 'Retry this change');
		await enqueueAdd(page, 'Cancel this change');
		fixture.state.writeStatus = 500;
		await context.setOffline(false);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			if ((await queueEntries(page)).every((item) => item.status === 'failed')) {
				break;
			}
			await syncOnce(page);
		}
		await expect.poll(async () => (await queueEntries(page)).map((item) => item.status)).toEqual(['failed', 'failed']);
		await page.locator('#offlineQueueToggle').click();
		const cancel = page.locator('#offlineQueueList li').filter({ hasText: 'Cancel this change' });
		await cancel.getByRole('button', { name: '取消更改', exact: true }).click();
		await page.locator('#confirmDialogConfirm').click();
		await expect.poll(async () => (await queueEntries(page)).length).toBe(1);
		fixture.state.writeStatus = 200;
		await page
			.locator('#offlineQueueList li')
			.filter({ hasText: 'Retry this change' })
			.getByRole('button', { name: '重试', exact: true })
			.click();
		await expect.poll(async () => (await queueEntries(page)).length).toBe(0);
		expect(fixture.state.records.some((item) => item.name === 'Retry this change')).toBe(true);
		expect(fixture.state.records.some((item) => item.name === 'Cancel this change')).toBe(false);
		await expect(page.locator('#offlineQueue')).toBeHidden();
	} finally {
		await context.close();
		await browser.close();
		await fixture.close();
	}
});

test('real service worker stops a rejected offline change at once and reopens it for correction', async () => {
	const fixture = await startFixture();
	// One stored record the page cannot use must not hide the others.
	fixture.state.records = [record('existing', 'Existing account'), { ...record('broken', 'Broken record'), digits: 7 }];
	const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
	const context = await browser.newContext({ serviceWorkers: 'allow', locale: 'zh-CN' });
	const page = await context.newPage();
	try {
		await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort()));
		await page.goto(fixture.origin);
		await expect(page.locator('.secret-card').filter({ hasText: 'Existing account' })).toBeVisible();
		await expect(page.locator('.secret-card')).toHaveCount(1);
		await expect(page.locator('#emptyState')).not.toContainText('账户数据暂时无法读取');
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

		await context.setOffline(true);
		await page.getByRole('button', { name: '打开操作菜单', exact: true }).click();
		await page.locator('#actionSubmenu').getByRole('button', { name: /添加/ }).click();
		await page.locator('#secretName').fill('N'.repeat(51));
		await page.locator('#secretKey').fill(SEED);
		await page.locator('#submitBtn').click();
		// The server limit is checked before queueing; nothing unsendable is saved.
		await expect(page.locator('#secretModal')).toBeVisible();
		await expect(page.locator('#secretName')).toHaveValue('N'.repeat(51));
		expect(await queueEntries(page)).toEqual([]);
		await page.locator('#secretName').fill('Rejected by server');
		await page.locator('#submitBtn').click();
		await expect(page.locator('#secretModal')).toBeHidden();
		await expect.poll(async () => (await queueEntries(page)).length).toBe(1);

		fixture.state.writeStatus = 400;
		await context.setOffline(false);
		await expect.poll(async () => (await queueEntries(page)).map((item) => [item.status, item.retryCount])).toEqual([['failed', 1]]);
		expect(fixture.state.writeAttempts.filter((item) => item.status === 400)).toHaveLength(1);
		await page.locator('#offlineQueueToggle').click();
		const row = page.locator('#offlineQueueList li').filter({ hasText: 'Rejected by server' });
		await expect(row.locator('.offline-queue-reason')).toHaveText('原因：Synthetic write failure');

		fixture.state.writeStatus = 200;
		await row.getByRole('button', { name: '编辑后重试', exact: true }).click();
		await expect(page.locator('#secretModal')).toBeVisible();
		await expect(page.locator('#secretName')).toHaveValue('Rejected by server');
		await expect(page.locator('#secretKey')).toHaveValue(SEED);
		await page.locator('#secretName').fill('Corrected change');
		await page.locator('#submitBtn').click();
		await expect(page.locator('#secretModal')).toBeHidden();
		await expect.poll(async () => (await queueEntries(page)).length).toBe(0);
		expect(fixture.state.records.map((item) => item.name)).toEqual(['Existing account', 'Broken record', 'Corrected change']);
		await expect(page.locator('.secret-card').filter({ hasText: 'Corrected change' })).toBeVisible();
		await expect(page.locator('#offlineQueue')).toBeHidden();
	} finally {
		await context.close();
		await browser.close();
		await fixture.close();
	}
});

for (const stall of ['headers', 'body']) {
	test(`cached startup remains usable while navigation and API ${stall} stall`, async () => {
		const fixture = await startFixture();
		const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
		const context = await browser.newContext({ serviceWorkers: 'allow' });
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixture.origin });
		const page = await context.newPage();
		const accountRequests = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/api/secrets') {
				accountRequests.push(request.method());
			}
		});
		try {
			await context.route('**/*', (route) => (new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort()));
			await page.goto(fixture.origin);
			await expect(page.locator('#otp-existing')).toHaveText(/^\d{6}$/);
			await page.waitForFunction(async () => Boolean(navigator.serviceWorker.controller && (await caches.match('/'))));
			await page.waitForFunction(() => Boolean(localStorage.getItem('2fa-secrets-cache')));
			await page.evaluate(() => localStorage.removeItem('2fa-clock-sync-v1'));
			fixture.state.records = [record('existing', 'Updated after reconnect')];
			for (const endpoint of ['navigation', 'time', 'secrets']) {
				fixture.state.holds.set(endpoint, stall);
			}
			const start = Date.now();
			await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });
			await expect(page.locator('.secret-card').filter({ hasText: 'Existing account' })).toBeVisible({ timeout: 1500 });
			await expect(page.locator('#otp-existing')).toHaveText(/^\d{6}$/, { timeout: 1500 });
			const cachedCodeVisibleMs = Date.now() - start;
			expect(cachedCodeVisibleMs).toBeLessThan(4000);
			const timingPath = test.info().outputPath(`cached-startup-${stall}.json`);
			writeFileSync(timingPath, JSON.stringify({ stall, cachedCodeVisibleMs }), 'utf-8');
			await test.info().attach(`cached-startup-${stall}.json`, { path: timingPath, contentType: 'application/json' });
			expect(fixture.heldCount('navigation')).toBeGreaterThan(0);
			await expect.poll(() => fixture.heldCount('time')).toBeGreaterThan(0);
			await page.locator('#otp-existing').click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{6}$/);

			fixture.release('navigation');
			fixture.release('time');
			await expect.poll(() => fixture.heldCount('secrets'), { timeout: 8000 }).toBeGreaterThan(0);
			await expect(page.locator('.secret-card').filter({ hasText: 'Existing account' })).toBeVisible();
			fixture.release('secrets');
			await expect(page.locator('.secret-card').filter({ hasText: 'Updated after reconnect' })).toBeVisible();

			await context.setOffline(true);
			const requestsBeforeOffline = accountRequests.length;
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page.locator('#otp-existing')).toHaveText(/^\d{6}$/);
			await expect(page.locator('.secret-card').filter({ hasText: 'Updated after reconnect' })).toBeVisible();
			expect(await page.evaluate(() => navigator.onLine)).toBe(false);
			// Observe the actual browser request events, not only server arrivals:
			// an unnecessary offline fetch would never reach the fixture server.
			expect(accountRequests.length).toBe(requestsBeforeOffline);
			fixture.state.records = [record('existing', 'Online event refreshed')];
			await context.setOffline(false);
			await expect(page.locator('.secret-card').filter({ hasText: 'Online event refreshed' })).toBeVisible();
		} finally {
			await context.close();
			await browser.close();
			await fixture.close();
		}
	});
}
