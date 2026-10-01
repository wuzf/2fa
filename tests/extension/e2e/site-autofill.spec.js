import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTotp } from '../../../extension/src/shared/totp.js';
import { pinFixtureLanguage } from './language-fixture.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const SECRET = 'JBSWY3DPEHPK3PXP';
const TIME = 1800000010000;
const SCENARIOS = [
	{ name: 'unique-service', origin: 'https://github.com', automaticAccountId: 'github-alice' },
	{ name: 'unique-binding', origin: 'https://custom.example', automaticAccountId: 'private-alice' },
	{ name: 'multiple', origin: 'https://github.com', automaticAccountId: null },
	{ name: 'deceptive-host', origin: 'https://github.com.evil.example', automaticAccountId: null },
	{ name: 'tenant-host', origin: 'https://tenant.github.io', automaticAccountId: null },
	{ name: 'no-input', origin: 'https://github.com', automaticAccountId: 'github-alice' },
];

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
	if (!inside || inside.startsWith('..') || isAbsolute(inside) || !basename(target).startsWith('twofa-site-autofill-e2e-')) {
		throw new Error('Refusing to remove an unsafe browser test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

function account(id, name, email = 'alice@example.com') {
	return { id, name, account: email, secret: SECRET, type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1' };
}

function fixtureHtml(noInput) {
	return `<!doctype html><meta charset="utf-8"><title>Local sign-in fixture</title>
<form id="login-form">
  ${
		noInput
			? '<label for="search">Search</label><input id="search" name="search" type="search">'
			: '<label for="otp">Authenticator verification code</label><input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6">'
	}
  <button type="submit">Continue</button>
</form>
<script>
  window.fixtureState = { inputEvents: 0, submits: 0 };
  document.querySelector('input').addEventListener('input', () => window.fixtureState.inputEvents += 1);
  document.querySelector('#login-form').addEventListener('submit', event => {
    event.preventDefault();
    window.fixtureState.submits += 1;
  });
</script>`;
}

for (const browserTarget of ['chrome', 'edge']) {
	for (const scenario of SCENARIOS) {
		test(`${browserTarget} matches site accounts without implicitly filling an unauthorized page: ${scenario.name}`, async ({
			browserName: _browserName,
		}) => {
			const accounts = [account('github-alice', 'GitHub'), account('google-alice', 'Google')];
			if (scenario.name === 'multiple') {
				accounts.push(account('github-bob', 'GitHub', 'bob@example.com'));
			}
			if (scenario.name === 'unique-binding') {
				accounts.push(account('private-alice', '私人服务'));
			}
			const server = createServer((request, response) => {
				const path = new URL(request.url, 'http://fixture.invalid').pathname;
				response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				response.end(JSON.stringify(path === '/api/time' ? { serverTimeMs: TIME } : path === '/api/secrets' ? accounts : {}));
			});
			await new Promise((done, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', done);
			});
			const instanceOrigin = `http://127.0.0.1:${server.address().port}`;
			const bindings = [{ instanceOrigin, targetOrigin: 'https://existing.example', accountId: 'google-alice' }];
			if (scenario.name === 'unique-binding') {
				bindings.push({ instanceOrigin, targetOrigin: scenario.origin, accountId: 'private-alice' });
			}
			const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-site-autofill-e2e-'));
			let context;
			try {
				const extensionPath = join(temporaryRoot, browserTarget);
				copyDirectory(join(ROOT, 'dist/extension', browserTarget), extensionPath);
				const manifestPath = join(extensionPath, 'manifest.json');
				const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
				manifest.host_permissions = ['http://127.0.0.1/*', scenario.origin + '/*'];
				writeFileSync(manifestPath, JSON.stringify(manifest));
				context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
					channel: 'chromium',
					headless: true,
					args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
				});
				// Every sign-in page is local fixture content. No real service receives a code.
				await context.route(/^https?:\/\//, (route) => {
					const origin = new URL(route.request().url()).origin;
					if (origin === instanceOrigin) {
						return route.continue();
					}
					return origin === scenario.origin
						? route.fulfill({ contentType: 'text/html', body: fixtureHtml(scenario.name === 'no-input') })
						: route.abort();
				});
				const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
				const extensionId = new URL(worker.url()).host;
				await expect.poll(() => context.pages().some((page) => page.url() === `chrome-extension://${extensionId}/options.html`)).toBe(true);
				await pinFixtureLanguage(worker);
				await worker.evaluate(({ instanceOrigin, bindings }) => chrome.storage.local.set({ settings: { instanceOrigin }, bindings }), {
					instanceOrigin,
					bindings,
				});
				const target = await context.newPage();
				await target.goto(scenario.origin + '/sessions/two-factor');
				const popup = await context.newPage();
				await popup.goto(`chrome-extension://${extensionId}/popup.html`);
				await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				// Opening popup.html as a tab initially uses copy mode. Re-select the target
				// and invoke Retry to exercise the same start() path as the toolbar popup.
				await popup.evaluate(async (origin) => {
					window.fixtureMessages = [];
					const send = chrome.runtime.sendMessage.bind(chrome.runtime);
					chrome.runtime.sendMessage = async (message) => {
						const record = { type: message.type, automatic: message.automatic === true };
						window.fixtureMessages.push(record);
						const response = await send(message);
						if (message.type === 'START_FLOW') {
							record.automaticAccountId = response.data?.autoFillAccountId ?? null;
						}
						return response;
					};
					const [tab] = await chrome.tabs.query({ url: origin + '/*' });
					await chrome.tabs.update(tab.id, { active: true });
				}, scenario.origin);
				await popup.locator('#retry').evaluate((button) => button.click());
				await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
				expect(await popup.evaluate(() => window.fixtureMessages.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual([]);
				if (scenario.name === 'unique-service' || scenario.name === 'unique-binding') {
					await expect(target.locator('#otp')).toHaveValue('');
					expect(await target.evaluate(() => window.fixtureState)).toEqual({ inputEvents: 0, submits: 0 });
				} else {
					await expect(popup.locator('#account-section')).toBeVisible();
					await expect(popup.locator('#retry')).toBeEnabled();
					await expect(popup.locator('#target-origin')).toBeHidden();
					await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
					await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
					const initialFlow = await popup.evaluate(() => window.fixtureMessages.find((message) => message.type === 'START_FLOW'));
					expect(initialFlow.automaticAccountId).toBe(scenario.automaticAccountId);
					if (scenario.name === 'no-input') {
						await popup
							.locator('.account-fill')
							.first()
							.evaluate((button) => button.click());
						await expect(popup.locator('#status')).toContainText('复制');
						await expect(popup.locator('#fill-focused')).toBeVisible();
						await expect(popup.locator('.preview-code').first()).toBeEnabled();
						// Refreshing a preview consumes another flow, but must not replay
						// filling after the user's original attempt failed.
						const copiesBefore = await popup.evaluate(
							() => window.fixtureMessages.filter((message) => message.type.startsWith('COPY_ACCOUNT_CODE')).length,
						);
						await popup
							.locator('.preview-retry')
							.first()
							.evaluate((button) => button.click());
						await expect
							.poll(() =>
								popup.evaluate(() => window.fixtureMessages.filter((message) => message.type.startsWith('COPY_ACCOUNT_CODE')).length),
							)
							.toBeGreaterThan(copiesBefore);
						await expect(popup.locator('.code-preview[aria-busy=true]')).toHaveCount(0);
						const fills = await popup.evaluate(() => window.fixtureMessages.filter((message) => message.type === 'FILL_ACCOUNT'));
						expect(fills).toEqual([{ type: 'FILL_ACCOUNT', automatic: false }]);
						await expect(target.locator('#search')).toHaveValue('');
					} else {
						if (scenario.name === 'multiple') {
							await expect(popup.locator('.account-card')).toHaveCount(2);
							await expect(popup.locator('.account-card[data-account-id="google-alice"]')).toHaveCount(0);
						}
						expect(await popup.evaluate(() => window.fixtureMessages.filter((message) => message.type === 'FILL_ACCOUNT'))).toEqual([]);
						await expect(target.locator('#otp')).toHaveValue('');
					}
					expect(await target.evaluate(() => window.fixtureState)).toEqual({ inputEvents: 0, submits: 0 });
				}
				const rememberChoice = popup.locator('label:has(#remember-binding)');
				// The no-input fill above kept the default choice checked. Although the
				// page had no code field and the code was copied instead, it remembered
				// the account and turned on autofill for the website, as the choice says.
				const filledEarlier = scenario.name === 'no-input';
				const expectedBindings = filledEarlier
					? [...bindings, { instanceOrigin, targetOrigin: scenario.origin, accountId: 'github-alice' }]
					: bindings;
				await expect
					.poll(async () => (await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings)
					.toEqual(expectedBindings);
				// The other websites have no autofill grant, so the choice also asks for
				// one and stays visible, even for a unique match. It starts checked for
				// the remembered account, or on a website that remembers none.
				await expect(rememberChoice).toBeVisible();
				await expect(rememberChoice).toContainText('以后在此网站自动填入');
				await expect(popup.locator('#remember-binding')).toBeChecked();
				await expect(popup.locator('#autofill-site')).toBeChecked({ checked: filledEarlier });
				if (scenario.name === 'unique-service' || scenario.name === 'no-input') {
					await popup.locator('#scope-all').evaluate((button) => button.click());
					await expect(rememberChoice).toBeVisible();
					await expect(popup.locator('.account-card')).toHaveCount(2);
					await popup.locator('#scope-site').evaluate((button) => button.click());
					await expect(rememberChoice).toBeVisible();
				} else {
					if (scenario.name === 'multiple') {
						await popup.setViewportSize({ width: 380, height: 600 });
						const automaticChoice = popup.locator('label:has(#autofill-site)');
						await expect(automaticChoice).toBeVisible();
						const remembered = await rememberChoice.boundingBox();
						const automatic = await automaticChoice.boundingBox();
						expect(remembered.y).toBe(automatic.y);
						expect(remembered.x + remembered.width).toBeLessThan(automatic.x);
						const preferences = popup.locator('.fill-preferences');
						const preferenceBounds = await preferences.boundingBox();
						expect(preferenceBounds.height).toBeLessThanOrEqual(30);
						expect(remembered.x).toBe(preferenceBounds.x);
						expect(automatic.x + automatic.width).toBe(preferenceBounds.x + preferenceBounds.width);
						for (const colorScheme of ['light', 'dark']) {
							await popup.emulateMedia({ colorScheme });
							await popup.screenshot({ path: test.info().outputPath(`fill-preferences-${colorScheme}.png`) });
						}
						await popup.emulateMedia({ colorScheme: 'light' });
						await popup.locator('#account-search').fill('bob@example.com');
						await expect(popup.locator('.account-card')).toHaveCount(1);
						await expect(rememberChoice).toBeVisible();
					}
				}
				expect((await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings).toEqual(expectedBindings);
				const websiteGrant = { instanceOrigin, targetOrigin: scenario.origin, targetPath: '*', pagePath: '/sessions/two-factor' };
				expect((await worker.evaluate(() => chrome.storage.local.get('autofillSites'))).autofillSites || []).toEqual(
					filledEarlier ? [websiteGrant] : [],
				);
				if (scenario.name === 'unique-service' || scenario.name === 'unique-binding') {
					await popup
						.locator('.account-fill')
						.first()
						.evaluate((button) => button.click());
					await expect(target.locator('#otp')).toHaveValue(await generateTotp(SECRET, TIME));
					expect(await target.evaluate(() => window.fixtureState)).toEqual({ inputEvents: 1, submits: 0 });
					// The host permission is already granted here, so filling with the
					// choice checked remembers the account and turns on website autofill.
					const accountId = scenario.name === 'unique-service' ? 'github-alice' : 'private-alice';
					await expect
						.poll(async () => (await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings)
						.toEqual([bindings[0], { instanceOrigin, targetOrigin: scenario.origin, accountId }]);
					await expect
						.poll(async () => (await worker.evaluate(() => chrome.storage.local.get('autofillSites'))).autofillSites)
						.toEqual([websiteGrant]);
				}
			} finally {
				await context?.close();
				await new Promise((done) => server.close(done));
				removeTemporaryRoot(temporaryRoot);
			}
		});
	}
}
