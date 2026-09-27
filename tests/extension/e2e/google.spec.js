import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTotp } from '../../../extension/src/shared/totp.js';
import { pinFixtureLanguage } from './language-fixture.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const GOOGLE = 'https://accounts.google.com';
const CHALLENGE = GOOGLE + '/v3/signin/challenge/totp';
const HTML = readFileSync(join(ROOT, 'tests/extension/fixtures/google-totp.html'), 'utf8');
const SECRET = 'JBSWY3DPEHPK3PXP';
const TIME = 1800000010000;
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

for (const browserTarget of ['chrome', 'edge']) {
	for (const scenario of ['unique', 'imported-label', 'multiple', 'account-switch']) {
		test(`${browserTarget} matches Google challenge email: ${scenario}`, async ({ browserName: _browserName }) => {
			const accounts = [
				{
					id: 'google-alice',
					name: 'Google',
					account: 'alice@example.com',
					secret: SECRET,
					type: 'TOTP',
					digits: 6,
					period: 30,
					algorithm: 'SHA1',
				},
				{
					id: 'google-bob',
					name: 'Google',
					account: 'bob@example.com',
					secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
					type: 'TOTP',
					digits: 6,
					period: 30,
					algorithm: 'SHA1',
				},
				{
					id: 'github-alice',
					name: 'GitHub',
					account: 'alice@example.com',
					secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
					type: 'TOTP',
					digits: 6,
					period: 30,
					algorithm: 'SHA1',
				},
			];
			if (scenario === 'imported-label') {
				accounts[0].account = 'Google:alice@example.com';
				accounts[2].account = 'Google:alice@example.com';
			}
			if (scenario === 'multiple') {
				accounts.push({ ...accounts[0], id: 'second-google', name: 'Gmail', account: 'Google:alice@example.com' });
			}
			let changeAccount = null;
			let timeReads = 0;
			let fillStartedAtTimeRead = null;
			let accountChangedAtTimeRead = null;
			const server = createServer(async (request, response) => {
				const path = new URL(request.url, 'http://fixture.invalid').pathname;
				if (path === '/api/time') {
					timeReads += 1;
				}
				if (path === '/api/time' && changeAccount) {
					const change = changeAccount;
					changeAccount = null;
					accountChangedAtTimeRead = timeReads;
					await change();
				}
				response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				response.end(JSON.stringify(path === '/api/time' ? { serverTimeMs: TIME } : path === '/api/secrets' ? accounts : {}));
			});
			await new Promise((done) => server.listen(0, '127.0.0.1', done));
			const instanceOrigin = `http://127.0.0.1:${server.address().port}`;
			const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-google-e2e-'));
			let context;
			try {
				const extensionPath = join(temporaryRoot, browserTarget);
				copyDirectory(join(ROOT, 'dist/extension', browserTarget), extensionPath);
				const manifestPath = join(extensionPath, 'manifest.json');
				const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
				manifest.host_permissions = ['http://127.0.0.1/*', GOOGLE + '/*'];
				writeFileSync(manifestPath, JSON.stringify(manifest));
				context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
					channel: 'chromium',
					headless: true,
					args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
				});
				await context.route(GOOGLE + '/**', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
				const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
				const extensionId = new URL(worker.url()).host;
				await pinFixtureLanguage(worker);
				const binding = { instanceOrigin, targetOrigin: GOOGLE, accountId: 'google-bob' };
				await worker.evaluate(
					({ instanceOrigin, binding }) => chrome.storage.local.set({ settings: { instanceOrigin }, bindings: [binding] }),
					{ instanceOrigin, binding },
				);
				const target = await context.newPage();
				await target.goto(CHALLENGE);
				const popup = await context.newPage();
				await popup.goto(`chrome-extension://${extensionId}/popup.html`);
				await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				await popup.evaluate(async (url) => {
					const [tab] = await chrome.tabs.query({ url });
					await chrome.tabs.update(tab.id, { active: true });
				}, GOOGLE + '/*');
				await popup.locator('#retry').evaluate((button) => button.click());
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				await expect(target.locator('#totpPin')).toHaveValue('');
				if (scenario !== 'multiple') {
					const fill = popup.locator('.account-card[data-account-id=google-alice] .account-fill');
					await expect(fill).toBeEnabled();
					// This remains a one-time manual fill. The pre-existing Bob binding
					// must not be changed by the remembered-account checkbox default.
					await popup.locator('#remember-binding').evaluate((checkbox) => (checkbox.checked = false));
					if (scenario === 'account-switch') {
						// Arm only when the serialized manual-fill message is sent, after
						// every queued preview has completed. The next clock read must
						// belong to generation for this fill, not a previous preview.
						await popup.exposeFunction('fixtureArmGoogleAccountSwitch', () => {
							fillStartedAtTimeRead = timeReads;
							changeAccount = () =>
								target.evaluate(() => {
									document.querySelector('[data-profile-identifier]').textContent = 'bob@example.com';
									document.getElementById('identifierId').value = 'bob@example.com';
								});
						});
						await popup.evaluate(() => {
							const send = chrome.runtime.sendMessage.bind(chrome.runtime);
							chrome.runtime.sendMessage = async (message) => {
								if (message.type !== 'FILL_ACCOUNT') {
									return send(message);
								}
								await window.fixtureArmGoogleAccountSwitch();
								const response = await send(message);
								window.fixtureFillResult = response;
								return response;
							};
						});
					}
					await fill.evaluate((button) => button.click());
				}
				if (scenario === 'unique' || scenario === 'imported-label') {
					await expect(target.locator('#totpPin')).toHaveValue(await generateTotp(SECRET, TIME));
					expect((await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings).toEqual([binding]);
				} else if (scenario === 'multiple') {
					await expect(popup.locator('.account-card')).toHaveCount(2);
					await expect(popup.locator('.account-card[data-account-id=google-bob]')).toHaveCount(0);
					await expect(popup.locator('.account-card[data-account-id=github-alice]')).toHaveCount(0);
					await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
					await expect(target.locator('#totpPin')).toHaveValue('');
				} else {
					await expect(popup.locator('#status')).toContainText('账号已变化');
					await expect(target.locator('#totpPin')).toHaveValue('');
					expect(fillStartedAtTimeRead).not.toBeNull();
					expect(accountChangedAtTimeRead).toBe(fillStartedAtTimeRead + 1);
					expect(await popup.evaluate(() => window.fixtureFillResult)).toMatchObject({ ok: false, error: { code: 'LOGIN_CHANGED' } });
				}
			} finally {
				await context?.close();
				await new Promise((done) => server.close(done));
				const inside = relative(resolve(tmpdir()), resolve(temporaryRoot));
				if (inside && !inside.startsWith('..') && basename(temporaryRoot).startsWith('twofa-google-e2e-')) {
					rmSync(temporaryRoot, { recursive: true, force: true });
				}
			}
		});
	}
}
