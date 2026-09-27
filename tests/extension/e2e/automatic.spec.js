import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTotp } from '../../../extension/src/shared/totp.js';
import { openToolbarPopup } from './toolbar-fixture.js';
import { pinFixtureLanguage } from './language-fixture.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const GOOGLE = 'https://accounts.google.com';
const GITHUB = 'https://github.com';
const CLOUDFLARE = 'https://dash.cloudflare.com';
const VULTR = 'https://console.vultr.com';
const VULTR_INPUT = 'input[type="text"][name="token"]';
// Plain-HTTP network pages are manual-only. Automatic JumpServer scenarios use
// the same private addresses over HTTPS, which can still be authorized per site.
const JUMPSERVER = 'https://172.16.0.10';
const JUMPSERVER_OTHER_PORT = JUMPSERVER + ':8080';
const JUMPSERVER_NEIGHBOR = 'https://172.16.0.11';
const JUMPSERVER_HTTP = 'http://172.16.0.10';
const JUMPSERVER_ORIGINS = [JUMPSERVER, JUMPSERVER_OTHER_PORT, JUMPSERVER_NEIGHBOR, JUMPSERVER_HTTP];
const JUMPSERVER_INPUT = 'input[type="text"][name="code"]';
const JUMPSERVER_PATH = '/core/auth/login/mfa/';

function defaultTargetPath(origin) {
	return origin === GOOGLE
		? '/v3/signin/challenge/totp'
		: origin === VULTR
			? '/login/authenticate/'
			: JUMPSERVER_ORIGINS.includes(origin)
				? JUMPSERVER_PATH
				: '/login/single';
}
const SECRET = 'JBSWY3DPEHPK3PXP';
const SECOND_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const TIME = 1800000010000;
const GOOGLE_HTML = readFileSync(join(ROOT, 'tests/extension/fixtures/google-totp.html'), 'utf8');
const VULTR_HTML = readFileSync(join(ROOT, 'tests/extension/fixtures/vultr-auth.html'), 'utf8').replace(
	'</body>',
	`<script>
window.fixtureState = { submits: 0, automaticInputs: 0 };
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); window.fixtureState.submits += 1;
});
document.querySelector('form').addEventListener('input', event => {
  if (!event.isTrusted) window.fixtureState.automaticInputs += 1;
});
</script></body>`,
);

function record(id, name, { digits = 6, secret = SECRET, account = `${id}@example.com` } = {}) {
	return { id, name, account, secret, digits, type: 'TOTP', period: 30, algorithm: 'SHA1' };
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
	if (!inside || inside.startsWith('..') || isAbsolute(inside) || !basename(target).startsWith('twofa-automatic-e2e-')) {
		throw new Error('Refusing to remove an unsafe browser test directory');
	}
	rmSync(target, { recursive: true, force: true });
}

function targetHtml(variant) {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic OTP page</title></head><body>
<form id="login-form"><div id="fields"></div><button type="submit">Continue</button></form>
<script>
window.fixtureState = { submits: 0, automaticInputs: 0 };
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); window.fixtureState.submits += 1;
});
document.querySelector('form').addEventListener('input', event => {
  if (!event.isTrusted) window.fixtureState.automaticInputs += 1;
});
window.mountOtp = function(kind) {
  const fields = document.querySelector('#fields');
  if (kind === 'empty') { fields.replaceChildren(); return; }
  if (kind === 'split') {
    fields.innerHTML = '<fieldset><legend>Authenticator verification code</legend>' +
      Array.from({length: 6}, (_, index) => '<input aria-label="OTP digit ' + (index + 1) + '" name="otp-' + index + '" inputmode="numeric" maxlength="1" style="width:32px">').join('') + '</fieldset>';
    return;
  }
  fields.innerHTML = '<label for="otp">Authenticator verification code</label><input id="otp" name="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="' + (kind === 'eight' ? 8 : 6) + '"' + (kind === 'occupied' ? ' value="123456"' : '') + '>';
};
window.mountOtp(${JSON.stringify(variant)});
</script></body></html>`;
}

async function withAutomaticFixture(brand, records, run, { pregrantTargets = true, toolbarAction = false } = {}) {
	const startedAt = Date.now();
	const requestPaths = [];
	let secretsPaused = false;
	let secretsStatus = 200;
	const heldSecrets = [];
	const releaseSecretResponses = () => {
		secretsPaused = false;
		for (const release of heldSecrets.splice(0)) {
			release();
		}
	};
	const server = createServer((request, response) => {
		const path = new URL(request.url, 'http://fixture.invalid').pathname;
		requestPaths.push(path);
		if (path === '/source') {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end('<!doctype html><title>Synthetic 2FA instance</title>');
			return;
		}
		const reply = () => {
			const status = path === '/api/secrets' ? secretsStatus : 200;
			response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			response.end(
				JSON.stringify(
					status === 401
						? { error: 'Login required' }
						: path === '/api/time'
							? { serverTimeMs: TIME + Date.now() - startedAt }
							: path === '/api/secrets'
								? records
								: {},
				),
			);
		};
		if (secretsPaused && path === '/api/secrets') {
			heldSecrets.push(reply);
		} else {
			reply();
		}
	});
	await new Promise((done, reject) => {
		server.once('error', reject);
		server.listen(0, '0.0.0.0', done);
	});
	const instanceOrigin = `http://127.0.0.1:${server.address().port}`;
	const localTarget = `http://localhost:${server.address().port}`;
	const allowedTargets = [GITHUB, CLOUDFLARE, GOOGLE, VULTR, ...JUMPSERVER_ORIGINS, localTarget];
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twofa-automatic-e2e-'));
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
		// Only this temporary build receives predetermined permissions. Tests still
		// require a separate explicit per-site preference before any automatic work.
		// JumpServer scenarios always obtain their host permission through the popup.
		const pregrantedOrigins = allowedTargets.filter((origin) => origin.startsWith('https:') && !JUMPSERVER_ORIGINS.includes(origin));
		manifest.host_permissions = [
			'http://127.0.0.1/*',
			...(pregrantTargets ? ['http://localhost/*', ...pregrantedOrigins.map((origin) => origin + '/*')] : []),
		];
		writeFileSync(manifestPath, JSON.stringify(manifest));
		context = await chromium.launchPersistentContext(join(temporaryRoot, 'profile'), {
			channel: 'chromium',
			headless: true,
			args: [
				`--disable-extensions-except=${extensionPath}`,
				`--load-extension=${extensionPath}`,
				...(toolbarAction ? ['--enable-unsafe-extension-debugging'] : []),
			],
		});
		await context.route(/^https?:\/\//, (route) => {
			const url = new URL(route.request().url());
			if (url.origin === instanceOrigin || (url.origin === localTarget && url.pathname.startsWith('/api/'))) {
				return route.continue();
			}
			if (!allowedTargets.includes(url.origin)) {
				return route.abort();
			}
			return route.fulfill({
				contentType: 'text/html',
				body:
					url.origin === GOOGLE
						? GOOGLE_HTML
						: url.origin === VULTR
							? VULTR_HTML
							: JUMPSERVER_ORIGINS.includes(url.origin)
								? readFileSync(join(ROOT, 'tests/extension/fixtures/jumpserver-mfa.html'), 'utf8')
								: targetHtml(url.pathname.split('/').filter(Boolean).at(-1) || 'single'),
			});
		});
		const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
		await worker.evaluate(() => {
			const originalFetch = globalThis.fetch.bind(globalThis);
			globalThis.fixtureRequestCount = 0;
			globalThis.fetch = (...args) => {
				globalThis.fixtureRequestCount += 1;
				return originalFetch(...args);
			};
		});
		const extensionId = new URL(worker.url()).host;
		await expect.poll(() => context.pages().some((page) => page.url() === `chrome-extension://${extensionId}/options.html`)).toBe(true);
		const options = context.pages().find((page) => page.url() === `chrome-extension://${extensionId}/options.html`);
		await pinFixtureLanguage(worker, [options]);
		await expect(options.locator('#instance-origin')).toBeEnabled();
		const save = await options.evaluate(
			(instanceOrigin) => chrome.runtime.sendMessage({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'session' } }),
			instanceOrigin,
		);
		expect(save.ok, save.error?.message).toBe(true);
		// Settings now observe saved configuration changes and check the source.
		// Finish that setup work before measuring target-page-only activity.
		await expect(options.locator('#current-instance')).toHaveText(instanceOrigin);
		await expect(options.locator('#status')).toHaveAttribute('data-tone', 'success');
		requestPaths.length = 0;
		await worker.evaluate(() => {
			globalThis.fixtureRequestCount = 0;
		});
		const send = (message) => options.evaluate((message) => chrome.runtime.sendMessage(message), message);
		const setSite = async (targetOrigin, enabled = true, targetPath = defaultTargetPath(targetOrigin)) => {
			const result = await send({ type: 'SET_AUTOFILL_SITE', instanceOrigin, targetOrigin, targetPath, enabled });
			expect(result.ok, result.error?.message).toBe(true);
		};
		const openTarget = async (origin, variant = 'single') => {
			const page = await context.newPage();
			await page.goto(
				origin +
					(origin === GOOGLE
						? '/v3/signin/challenge/totp'
						: origin === VULTR
							? '/login/authenticate/'
							: JUMPSERVER_ORIGINS.includes(origin)
								? '/core/auth/login/mfa/'
								: `/login/${variant}`),
			);
			return page;
		};
		const expectedCode = (account) => generateTotp(account.secret, TIME + Date.now() - startedAt, account);
		const assertFilled = async (page, account, { split = false, selector = page.url().startsWith(GOOGLE) ? '#totpPin' : '#otp' } = {}) => {
			await expect
				.poll(
					async () => {
						const value = split
							? await page.locator('#fields input').evaluateAll((inputs) => inputs.map((input) => input.value).join(''))
							: await page.locator(selector).inputValue();
						return value === (await expectedCode(account));
					},
					{ timeout: 10000 },
				)
				.toBe(true);
			if (!page.url().startsWith(GOOGLE)) {
				expect(await page.evaluate(() => window.fixtureState.submits)).toBe(0);
			}
		};
		await run({
			context,
			worker,
			options,
			extensionId,
			instanceOrigin,
			localTarget,
			requestPaths,
			setSecretsStatus: (status) => {
				secretsStatus = status;
			},
			setSite,
			send,
			openTarget,
			expectedCode,
			assertFilled,
			stopServer,
			pauseSecretResponses: () => {
				secretsPaused = true;
			},
			heldSecretResponseCount: () => heldSecrets.length,
			releaseSecretResponses,
		});
	} finally {
		releaseSecretResponses();
		await context?.close();
		await stopServer();
		removeTemporaryRoot(temporaryRoot);
	}
}

async function expectUnfilled(page, selector = '#otp') {
	// Allow the mutation debounce and any accidental request to finish before
	// proving that the page remained untouched; no machine clock is changed.
	await page.waitForTimeout(800);
	await expect(page.locator(selector)).toHaveValue('');
}

async function clickClosedPickerAccount(context, page, email, excludedEmail) {
	await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
	expect(await page.locator('[data-twofa-autofill]').evaluate((host) => host.shadowRoot === null)).toBe(true);
	const session = await context.newCDPSession(page);
	try {
		let accountNode;
		await expect
			.poll(async () => {
				const { nodes } = await session.send('Accessibility.getFullAXTree');
				accountNode = nodes.find((node) => node.role?.value === 'button' && node.name?.value?.includes(email));
				return Boolean(accountNode?.backendDOMNodeId);
			})
			.toBe(true);
		const { nodes } = await session.send('Accessibility.getFullAXTree');
		expect(nodes.some((node) => node.role?.value === 'button' && node.name?.value?.includes(excludedEmail))).toBe(false);
		const { quads } = await session.send('DOM.getContentQuads', { backendNodeId: accountNode.backendDOMNodeId });
		expect(quads.length).toBeGreaterThan(0);
		const quad = quads[0];
		// A real browser pointer event reaches the closed shadow tree. Page JS is
		// never given access to the extension's picker or its private account data.
		await page.mouse.click((quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4);
	} finally {
		await session.detach();
	}
}

async function restartExtensionWorker(context, options, workerUrl) {
	const session = await context.newCDPSession(options);
	const versions = new Map();
	session.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
		for (const version of updates) {
			versions.set(version.versionId, version);
		}
	});
	try {
		await session.send('ServiceWorker.enable');
		let original;
		await expect
			.poll(() => {
				original = [...versions.values()].find((version) => version.scriptURL === workerUrl && version.runningStatus === 'running');
				return Boolean(original?.versionId);
			})
			.toBe(true);
		const { versionId } = original;
		// Stop this extension's real service worker, leaving its target pages and
		// closed-shadow picker intact. Its in-memory request nonce is now gone.
		await session.send('ServiceWorker.stopWorker', { versionId });
		await expect.poll(() => versions.get(versionId)?.runningStatus).toBe('stopped');
		// A normal message from a trusted extension page wakes a fresh worker.
		const awake = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_AUTOFILL_SITES' }));
		expect(awake.ok, awake.error?.message).toBe(true);
		// Chrome can reuse its DevTools target ID. The observed stopped -> running
		// transition proves the worker restarted without depending on that ID.
		await expect.poll(() => versions.get(versionId)?.runningStatus).toBe('running');
	} finally {
		await session.detach();
	}
}

async function clickClosedAutofillRetry(context, page) {
	await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
	const session = await context.newCDPSession(page);
	try {
		let retry;
		await expect
			.poll(async () => {
				const { nodes } = await session.send('Accessibility.getFullAXTree');
				retry = nodes.find((node) => node.role?.value === 'button' && node.name?.value === '重试');
				return Boolean(retry?.backendDOMNodeId);
			})
			.toBe(true);
		const { quads } = await session.send('DOM.getContentQuads', { backendNodeId: retry.backendDOMNodeId });
		const quad = quads[0];
		expect(quad).toHaveLength(8);
		await page.mouse.click((quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4);
	} finally {
		await session.detach();
	}
}

async function authorizeJumpserverThroughPopup({ context, options, extensionId, target }, { suppressPopupFill = true } = {}) {
	const targetPattern = JUMPSERVER + '/*';
	expect(await options.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), targetPattern)).toBe(false);
	// Isolate persistent site authorization from the popup's existing one-shot
	// autofill: the real fixture field is temporarily unavailable during setup.
	if (suppressPopupFill) {
		await target.locator(JUMPSERVER_INPUT).evaluate((input) => (input.disabled = true));
	}
	const manager = await context.newPage();
	await manager.goto('chrome://extensions/');
	await expect.poll(() => manager.evaluate(() => typeof chrome.developerPrivate?.addHostPermission)).toBe('function');
	await manager.evaluate(({ id, host }) => chrome.developerPrivate.addHostPermission(id, host), { id: extensionId, host: targetPattern });
	await manager.close();
	// Opening the real toolbar popup supplies activeTab. Its trusted checkbox
	// click must itself request the optional permission and save the site policy.
	const popup = await openToolbarPopup(context, extensionId, target);
	let beforeClick;
	try {
		await expect
			.poll(() =>
				popup.evaluate(`(() => {
					const input = document.querySelector('#autofill-site');
					return Boolean(input && !input.disabled && !input.closest('label').hidden);
				})()`),
			)
			.toBe(true);
		expect(await popup.evaluate(`document.querySelector('#autofill-site').closest('label').textContent`)).toContain('在此页面自动填充');
		beforeClick = await target.evaluate(() => ({ value: document.querySelector('input[name="code"]').value, ...window.fixtureState }));
		await popup.click('#autofill-site');
		await expect
			.poll(() => popup.evaluate(`chrome.runtime.sendMessage({type:'GET_AUTOFILL_SITES'}).then(response => response.data?.sites || [])`))
			.toContainEqual(expect.objectContaining({ targetOrigin: JUMPSERVER, targetPath: JUMPSERVER_PATH }));
		await expect.poll(() => popup.evaluate(`document.querySelector('#autofill-site').checked`)).toBe(true);
	} finally {
		await popup.close();
	}
	expect(await options.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), targetPattern)).toBe(true);
	expect((await options.evaluate(() => chrome.permissions.getAll())).origins.sort()).toEqual(['http://127.0.0.1/*', targetPattern].sort());
	expect(await options.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), JUMPSERVER_NEIGHBOR + '/*')).toBe(false);
	await target.bringToFront();
	if (suppressPopupFill) {
		await target.locator(JUMPSERVER_INPUT).evaluate((input) => (input.disabled = false));
	}
	return beforeClick;
}

for (const brand of ['chrome', 'edge']) {
	for (const channel of ['SMS', 'email']) {
		test(`${brand} waits for adjacent ${channel} instructions to change before automatically filling TOTP`, async () => {
			const github = record('github', 'GitHub');
			await withAutomaticFixture(brand, [github], async ({ openTarget, setSite, assertFilled }) => {
				const target = await openTarget(GITHUB);
				await target.evaluate((channel) => {
					const fields = document.querySelector('#fields');
					fields.querySelector('label').textContent = 'Verification code';
					const description = document.createElement('p');
					description.id = 'channel-description';
					description.textContent = `Enter the verification code sent via ${channel}.`;
					fields.prepend(description);
				}, channel);
				await setSite(GITHUB);
				await target.bringToFront();
				await expectUnfilled(target);
				expect(await target.evaluate(() => window.fixtureState)).toMatchObject({ automaticInputs: 0, submits: 0 });
				await target.evaluate(() => {
					document.querySelector('#channel-description').textContent = 'Enter the code from your authenticator app.';
					const alternative = document.createElement('a');
					alternative.href = '#other-method';
					alternative.textContent = 'Send a verification code via SMS instead';
					document.querySelector('form').append(alternative);
				});
				await assertFilled(target, github);
			});
		});
	}
	test(`${brand} waits for adjacent SMS instructions outside a segmented OTP group`, async () => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ openTarget, setSite, assertFilled }) => {
			const target = await openTarget(GITHUB, 'split');
			await target.evaluate(() => {
				const description = document.createElement('p');
				description.id = 'channel-description';
				description.textContent = 'Enter the verification code sent via SMS.';
				document.querySelector('#fields').prepend(description);
			});
			await setSite(GITHUB, true, '/login/split');
			await target.bringToFront();
			await expectUnfilled(target, '#fields input:first-of-type');
			expect(await target.locator('#fields input').evaluateAll((inputs) => inputs.every((input) => input.value === ''))).toBe(true);
			await target.locator('#channel-description').evaluate((description) => {
				description.textContent = 'Enter the code from your authenticator app.';
			});
			await assertFilled(target, github, { split: true });
		});
	});
	test(`${brand} stops automatic filling when beforeinput changes adjacent instructions to SMS`, async () => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ openTarget, setSite }) => {
			const target = await openTarget(GITHUB);
			await target.evaluate(() => {
				const description = document.createElement('p');
				description.textContent = 'Enter the code from your authenticator app.';
				document.querySelector('#fields').prepend(description);
				document.querySelector('#otp').addEventListener(
					'beforeinput',
					() => {
						description.textContent = 'Enter the verification code sent via SMS.';
						window.fixtureState.channelChanged = true;
					},
					{ once: true },
				);
			});
			await setSite(GITHUB);
			await target.bringToFront();
			await expect.poll(() => target.evaluate(() => window.fixtureState.channelChanged)).toBe(true);
			await expectUnfilled(target);
			expect(await target.evaluate(() => window.fixtureState.automaticInputs)).toBe(0);
		});
	});
	for (const phase of ['beforeinput', 'input', 'change']) {
		test(`${brand} stops segmented autofill when ${phase} reveals another OTP through CSSOM`, async () => {
			const github = record('github', 'GitHub');
			await withAutomaticFixture(brand, [github], async ({ openTarget, setSite }) => {
				const target = await openTarget(GITHUB, 'split');
				await target.evaluate((eventType) => {
					const style = document.createElement('style');
					style.textContent = '#alternate-otp { display: none; }';
					document.head.append(style);
					const alternate = document.createElement('form');
					alternate.id = 'alternate-otp';
					alternate.innerHTML =
						'<label for="other-otp">Authenticator verification code</label><input id="other-otp" autocomplete="one-time-code" maxlength="6">';
					document.body.append(alternate);
					window.fixtureState.cssomReveals = 0;
					const observer = new window.MutationObserver(() => {});
					observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
					document.querySelector('#fields input').addEventListener(
						eventType,
						() => {
							observer.takeRecords();
							style.sheet.insertRule('#alternate-otp { display: block; }', style.sheet.cssRules.length);
							window.fixtureState.cssomMutationRecords = observer.takeRecords().length;
							window.fixtureState.cssomReveals += 1;
							observer.disconnect();
						},
						{ once: true },
					);
				}, phase);
				await expect(target.locator('#alternate-otp')).toBeHidden();
				await setSite(GITHUB, true, '/login/split');
				await expect.poll(() => target.evaluate(() => window.fixtureState.cssomReveals)).toBe(1);
				await expect(target.locator('#alternate-otp')).toBeVisible();
				expect(await target.evaluate(() => window.fixtureState.cssomMutationRecords)).toBe(0);
				expect(await target.locator('#fields input').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(
					Array(6).fill(''),
				);
				await expect(target.locator('#other-otp')).toHaveValue('');
				expect(await target.evaluate(() => window.fixtureState.submits)).toBe(0);
			});
		});
	}

	test(`${brand} does not refill a delivered path after leaving and returning while preserving the same OTP input`, async () => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ context, setSite, assertFilled, requestPaths }) => {
			await setSite(GITHUB, true, '/totp');
			await setSite(GITHUB, true, '/verify');
			const page = await context.newPage();
			await page.goto(GITHUB + '/totp');
			await assertFilled(page, github);
			await page.evaluate(() => {
				window.originalOtpInput = document.querySelector('#otp');
			});
			const afterFillReads = requestPaths.filter((path) => path === '/api/secrets').length;
			await page.evaluate(() => {
				document.querySelector('#otp').value = '';
			});
			await expectUnfilled(page);
			await page.evaluate(() => window.history.pushState({}, '', '/totp?challenge=another#input'));
			await expectUnfilled(page);
			expect(await page.evaluate(() => window.fixtureState.automaticInputs)).toBe(1);
			expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(afterFillReads);

			await page.evaluate(() => {
				window.history.pushState({}, '', '/home');
				document.querySelector('#otp').value = '';
			});
			await expectUnfilled(page);
			expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(afterFillReads);
			// The code was already delivered on this path during this page load, so
			// returning to it does not fill it again or read the source.
			await page.evaluate(() => window.history.pushState({}, '', '/totp?challenge=return'));
			await expectUnfilled(page);
			expect(await page.evaluate(() => document.querySelector('#otp') === window.originalOtpInput)).toBe(true);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
			expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(afterFillReads);

			// Another authorized path has not received a code yet and reuses the same input.
			await page.evaluate(() => window.history.pushState({}, '', '/verify'));
			await assertFilled(page, github);
			expect(await page.evaluate(() => document.querySelector('#otp') === window.originalOtpInput)).toBe(true);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 2 });

			// A reload starts a new page load, which may fill the delivered path once more.
			await page.evaluate(() => {
				window.history.pushState({}, '', '/totp');
				document.querySelector('#otp').value = '';
			});
			await expectUnfilled(page);
			await page.reload();
			await assertFilled(page, github);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
		});
	});

	test(`${brand} pauses automatic source requests after authentication fails until explicit retry or configuration recovery`, async () => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(
			brand,
			[github],
			async ({ context, setSite, openTarget, assertFilled, requestPaths, setSecretsStatus, send, instanceOrigin }) => {
				await setSite(GITHUB);
				setSecretsStatus(401);
				const page = await openTarget(GITHUB);
				await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
				await expect.poll(() => requestPaths.filter((path) => path === '/api/secrets').length).toBeGreaterThan(0);
				const unauthorizedReads = requestPaths.filter((path) => path === '/api/secrets').length;
				// Cross the actual 30-second retry boundary. Do not rewrite timers or
				// instrument extension functions to prove absence of periodic requests.
				await page.waitForTimeout(32_000);
				expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
				expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(unauthorizedReads);
				await page.evaluate(() => {
					window.history.pushState({}, '', '/login/single?challenge=changed');
					window.dispatchEvent(new Event('online'));
				});
				await expectUnfilled(page);
				expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(unauthorizedReads);
				setSecretsStatus(200);
				await clickClosedAutofillRetry(context, page);
				await assertFilled(page, github);
				await page.close();

				setSecretsStatus(401);
				const next = await openTarget(GITHUB);
				await expect(next.locator('[data-twofa-autofill]')).toHaveCount(1);
				setSecretsStatus(200);
				const restored = await send({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'session' } });
				expect(restored.ok, restored.error?.message).toBe(true);
				await next.bringToFront();
				await assertFilled(next, github);
			},
		);
	});
	test(`${brand} restricts automatic filling to an exact authorized path while ignoring query and ordinary anchors`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ context, setSite, assertFilled, requestPaths }) => {
			await setSite(GITHUB, true, '/aaa');
			const approved = await context.newPage();
			await approved.goto(GITHUB + '/aaa?challenge=first#code');
			await assertFilled(approved, github);
			await approved.goto(GITHUB + '/aaa?challenge=second#details');
			await assertFilled(approved, github);
			const readsBefore = requestPaths.filter((path) => path.startsWith('/api/')).length;
			for (const path of ['/bbb', '/aaa/child', '/aaa/']) {
				const unapproved = await context.newPage();
				await unapproved.goto(GITHUB + path);
				await expectUnfilled(unapproved);
				await expect(unapproved.locator('[data-twofa-autofill]')).toHaveCount(0);
			}
			expect(requestPaths.filter((path) => path.startsWith('/api/'))).toHaveLength(readsBefore);
			await setSite(GITHUB, true, '/bbb');
			await setSite(GITHUB, false, '/aaa');
			await approved.goto(GITHUB + '/aaa');
			await expectUnfilled(approved);
			const otherApproved = await context.newPage();
			await otherApproved.goto(GITHUB + '/bbb');
			await assertFilled(otherApproved, github);
		});
	});

	for (const hashPrefix of ['#/', '#!/']) {
		test(`${brand} isolates ${hashPrefix} route paths and ignores route query parameters`, async ({ browserName: _browserName }) => {
			const github = record('github', 'GitHub');
			await withAutomaticFixture(brand, [github], async ({ context, setSite, assertFilled }) => {
				const authorizedPath = '/app' + hashPrefix + 'aaa';
				await setSite(GITHUB, true, authorizedPath);
				const approved = await context.newPage();
				await approved.goto(GITHUB + '/app?session=one' + hashPrefix + 'aaa?challenge=one');
				await assertFilled(approved, github);
				await approved.goto(GITHUB + '/app?session=two' + hashPrefix + 'aaa?challenge=two');
				await assertFilled(approved, github);
				for (const path of ['/app' + hashPrefix + 'bbb', authorizedPath + '/child', '/app']) {
					const other = await context.newPage();
					await other.goto(GITHUB + path);
					await expectUnfilled(other);
				}
			});
		});
	}

	test(`${brand} resumes detection after pushState enters an authorized path and stops on leaving it`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ context, setSite, assertFilled, requestPaths }) => {
			await setSite(GITHUB, true, '/aaa');
			await setSite(GITHUB, true, '/ccc');
			const page = await context.newPage();
			await page.goto(GITHUB + '/bbb');
			await expectUnfilled(page);
			// The first entry into an authorized path fills it, even through pushState.
			await page.evaluate(() => window.history.pushState({}, '', '/aaa?challenge=one'));
			await assertFilled(page, github);
			expect(await page.evaluate(() => window.fixtureState.automaticInputs)).toBe(1);
			await page.evaluate(() => {
				window.history.pushState({}, '', '/bbb');
				window.mountOtp('single');
			});
			await expectUnfilled(page);
			const afterLeavingReads = requestPaths.filter((path) => path === '/api/secrets').length;

			// Returning to the delivered path does not fill a new input there again.
			await page.evaluate(() => window.history.pushState({}, '', '/aaa?challenge=two'));
			await expectUnfilled(page);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
			expect(requestPaths.filter((path) => path === '/api/secrets').length).toBe(afterLeavingReads);

			// Another authorized path that has not received a code is still filled.
			await page.evaluate(() => window.history.pushState({}, '', '/ccc'));
			await assertFilled(page, github);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 2 });
			await page.evaluate(() => {
				window.history.pushState({}, '', '/bbb');
				window.mountOtp('single');
			});
			await expectUnfilled(page);
			expect(await page.evaluate(() => window.fixtureState.automaticInputs)).toBe(2);

			// A reload starts a new page load, which may fill the delivered path once more.
			await page.evaluate(() => window.history.pushState({}, '', '/aaa'));
			await expectUnfilled(page);
			await page.reload();
			await assertFilled(page, github);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
		});
	});

	test(`${brand} does not reuse legacy origin-only authorization after a worker restart`, async ({ browserName: _browserName }) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(
			brand,
			[github],
			async ({ context, worker, options, instanceOrigin, send, setSite, requestPaths, assertFilled }) => {
				await worker.evaluate(
					(instanceOrigin) => chrome.storage.local.set({ autofillSites: [{ instanceOrigin, targetOrigin: 'https://github.com' }] }),
					instanceOrigin,
				);
				await restartExtensionWorker(context, options, worker.url());
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([]);
				const page = await context.newPage();
				await page.goto(GITHUB + '/aaa');
				await expectUnfilled(page);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				await setSite(GITHUB, true, '/aaa');
				await assertFilled(page, github);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
					{ instanceOrigin, targetOrigin: GITHUB, targetPath: '/aaa' },
				]);
			},
		);
	});

	test(`${brand} completes the first HTTPS JumpServer authorization when the popup closes before the real host permission arrives`, async ({
		browserName: _browserName,
	}) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		await withAutomaticFixture(
			brand,
			[jumpserver],
			async ({ context, options, extensionId, instanceOrigin, send, openTarget, assertFilled }) => {
				const page = await openTarget(JUMPSERVER);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				const pattern = JUMPSERVER + '/*';
				expect(await options.evaluate((origin) => chrome.permissions.contains({ origins: [origin] }), pattern)).toBe(false);
				// The first popup has already exhausted its one-shot attempt before
				// authorization. Only the new site authorization may fill this page.
				await page.locator(JUMPSERVER_INPUT).evaluate((input) => (input.disabled = true));
				const popup = await openToolbarPopup(context, extensionId, page);
				try {
					await expect
						.poll(() =>
							popup.evaluate(`(() => {
								const input = document.querySelector('#autofill-site');
								return Boolean(input && !input.disabled && !input.closest('label').hidden);
							})()`),
						)
						.toBe(true);
					await page.locator(JUMPSERVER_INPUT).evaluate((input) => (input.disabled = false));
					await popup.evaluate(`(() => {
						// A pending promise models the browser permission prompt lifetime.
						// The actual host permission is granted below through browser APIs;
						// this does not claim to automate native prompt presentation.
						chrome.permissions.request = details => {
							window.fixturePendingPermission = details;
							return new Promise(() => {});
						};
					})()`);
					await popup.click('#autofill-site');
					await expect.poll(() => popup.evaluate('window.fixturePendingPermission')).toEqual({ origins: [pattern] });
					await expect
						.poll(() => options.evaluate(async () => (await chrome.storage.session.get('autofillAuthorization')).autofillAuthorization))
						.toMatchObject({
							status: 'pending',
							instanceOrigin,
							targetOrigin: JUMPSERVER,
							targetPath: JUMPSERVER_PATH,
							expectedTarget: expect.objectContaining({ targetPath: JUMPSERVER_PATH }),
						});
					await expect.poll(() => popup.evaluate(`document.querySelector('#autofill-site').checked`)).toBe(true);
				} finally {
					await popup.close();
				}
				await expect(page.locator(JUMPSERVER_INPUT)).toHaveValue('');
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([]);
				const manager = await context.newPage();
				await manager.goto('chrome://extensions/');
				await page.bringToFront();
				await manager.evaluate(({ id, host }) => chrome.developerPrivate.addHostPermission(id, host), { id: extensionId, host: pattern });
				expect(await options.evaluate((origin) => chrome.permissions.request({ origins: [origin] }), pattern)).toBe(true);
				await manager.close();
				await page.bringToFront();
				await expect
					.poll(async () => (await send({ type: 'GET_AUTOFILL_SITES' })).data.sites)
					.toEqual([{ instanceOrigin, targetOrigin: JUMPSERVER, targetPath: JUMPSERVER_PATH }]);
				await assertFilled(page, jumpserver, { selector: JUMPSERVER_INPUT });
				expect(await page.evaluate(() => window.fixtureState)).toMatchObject({ submits: 0, automaticInputs: 1 });
				expect((await options.evaluate(() => chrome.permissions.getAll())).origins.sort()).toEqual(['http://127.0.0.1/*', pattern].sort());
				for (const path of ['/other/mfa/', JUMPSERVER_PATH + 'child']) {
					const other = await context.newPage();
					await other.goto(JUMPSERVER + path);
					await expectUnfilled(other, JUMPSERVER_INPUT);
				}
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} fills an HTTPS JumpServer on the first checkbox click after its pending cached-source refresh completes`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		await withAutomaticFixture(
			brand,
			[jumpserver],
			async ({
				context,
				options,
				extensionId,
				instanceOrigin,
				send,
				openTarget,
				assertFilled,
				pauseSecretResponses,
				heldSecretResponseCount,
				releaseSecretResponses,
			}) => {
				expect(await send({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'offline' } })).toMatchObject({ ok: true });
				expect(await send({ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin })).toMatchObject({ ok: true });
				const page = await openTarget(JUMPSERVER);
				// Let the successful-refresh throttle expire so the popup starts a
				// genuinely pending source read while keeping its local cards usable.
				await page.waitForTimeout(1100);
				pauseSecretResponses();
				try {
					const beforeClick = await authorizeJumpserverThroughPopup(
						{ context, options, extensionId, target: page },
						{ suppressPopupFill: false },
					);
					await expect.poll(heldSecretResponseCount).toBeGreaterThan(0);
					expect(beforeClick).toMatchObject({ value: '', submits: 0, automaticInputs: 0 });
					await expect(page.locator(JUMPSERVER_INPUT)).toHaveValue('');
					expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
						{ instanceOrigin, targetOrigin: JUMPSERVER, targetPath: JUMPSERVER_PATH },
					]);
					releaseSecretResponses();
					await assertFilled(page, jumpserver, { selector: JUMPSERVER_INPUT });
					const afterClick = await page.evaluate(() => ({
						value: document.querySelector('input[name="code"]').value,
						...window.fixtureState,
					}));
					expect(afterClick).toMatchObject({ submits: 0, automaticInputs: 1 });
					const timingPath = testInfo.outputPath('jumpserver-pending-first-authorization.json');
					writeFileSync(timingPath, JSON.stringify({ beforeClick, afterClick }, null, 2));
					await testInfo.attach('jumpserver-pending-first-authorization', { path: timingPath, contentType: 'application/json' });
				} finally {
					releaseSecretResponses();
				}
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} enables HTTPS JumpServer automation with its first checkbox click while the MFA field is already usable`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		await withAutomaticFixture(
			brand,
			[jumpserver],
			async ({ context, options, extensionId, instanceOrigin, requestPaths, send, openTarget, assertFilled }) => {
				const page = await openTarget(JUMPSERVER);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				const beforeClick = await authorizeJumpserverThroughPopup(
					{ context, options, extensionId, target: page },
					{ suppressPopupFill: false },
				);
				await assertFilled(page, jumpserver, { selector: JUMPSERVER_INPUT });
				const afterClick = await page.evaluate(() => ({
					value: document.querySelector('input[name="code"]').value,
					...window.fixtureState,
				}));
				expect(afterClick.submits).toBe(0);
				expect(afterClick.automaticInputs).toBe(1);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
					{ instanceOrigin, targetOrigin: JUMPSERVER, targetPath: JUMPSERVER_PATH },
				]);
				const timingPath = testInfo.outputPath('jumpserver-first-authorization.json');
				writeFileSync(timingPath, JSON.stringify({ beforeClick, afterClick }, null, 2));
				await testInfo.attach('jumpserver-first-authorization', { path: timingPath, contentType: 'application/json' });
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} authorizes an HTTPS JumpServer IP through the real popup and fills only that exact address without submitting`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		const neighbor = record('neighbor', '172.16.0.11 堡垒机', { secret: SECOND_SECRET });
		await withAutomaticFixture(
			brand,
			[jumpserver, neighbor, record('github', 'GitHub')],
			async ({ context, worker, options, extensionId, instanceOrigin, requestPaths, send, openTarget, assertFilled }) => {
				const page = await openTarget(JUMPSERVER);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				expect(await options.evaluate(() => chrome.permissions.getAll())).toMatchObject({ origins: ['http://127.0.0.1/*'] });
				await expect(page.locator('#submit_button')).toHaveAttribute('type', 'submit');
				await expect(page.locator('#submit_button')).toHaveText('下一步');
				await expect(page.locator('body')).toContainText('MFA 多因子认证');
				expect(
					await page.locator(JUMPSERVER_INPUT).evaluate((input) => ({
						id: input.getAttribute('id'),
						autocomplete: input.getAttribute('autocomplete'),
						maxlength: input.getAttribute('maxlength'),
						placeholder: input.getAttribute('placeholder'),
					})),
				).toEqual({ id: null, autocomplete: null, maxlength: null, placeholder: '虚拟 MFA 验证码' });
				await authorizeJumpserverThroughPopup({ context, options, extensionId, target: page });
				await assertFilled(page, jumpserver, { selector: JUMPSERVER_INPUT });
				expect(await page.evaluate(() => window.fixtureState)).toMatchObject({ submits: 0, automaticInputs: 1 });
				expect((await options.evaluate(() => chrome.storage.local.get('bindings'))).bindings || []).toEqual([]);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([
					{ instanceOrigin, targetOrigin: JUMPSERVER, targetPath: JUMPSERVER_PATH },
				]);
				await page.screenshot({ path: testInfo.outputPath('jumpserver-https-filled.png'), fullPage: true });
				const repeated = await openTarget(JUMPSERVER);
				await assertFilled(repeated, jumpserver, { selector: JUMPSERVER_INPUT });
				expect(await repeated.evaluate(() => window.fixtureState)).toMatchObject({ submits: 0, automaticInputs: 1 });
				const requestsBeforeUnauthorizedOrigins = requestPaths.length;
				for (const origin of [JUMPSERVER_OTHER_PORT, JUMPSERVER_NEIGHBOR]) {
					const unrelated = await openTarget(origin);
					await expectUnfilled(unrelated, JUMPSERVER_INPUT);
					await expect(unrelated.locator('[data-twofa-autofill]')).toHaveCount(0);
				}
				expect(requestPaths.length).toBe(requestsBeforeUnauthorizedOrigins);
				expect(await options.evaluate((pattern) => chrome.permissions.remove({ origins: [pattern] }), JUMPSERVER + '/*')).toBe(true);
				await expect.poll(async () => (await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([]);
				await expect
					.poll(() =>
						worker.evaluate(async () =>
							(await chrome.scripting.getRegisteredContentScripts()).filter((registration) => registration.js.includes('automatic.js')),
						),
					)
					.toEqual([]);
				const requestsBeforeRevokedVisit = requestPaths.length;
				const revoked = await openTarget(JUMPSERVER);
				await expectUnfilled(revoked, JUMPSERVER_INPUT);
				expect(requestPaths.length).toBe(requestsBeforeRevokedVisit);
				await expect(revoked.locator('[data-twofa-autofill]')).toHaveCount(0);
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} keeps a plain-HTTP JumpServer page manual-only and fills its IP-named account from the real popup without submitting`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		const neighbor = record('neighbor', '172.16.0.11 堡垒机', { secret: SECOND_SECRET });
		await withAutomaticFixture(
			brand,
			[jumpserver, neighbor, record('github', 'GitHub')],
			async ({ context, options, extensionId, requestPaths, send, openTarget, assertFilled }) => {
				const page = await openTarget(JUMPSERVER_HTTP);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				expect(await options.evaluate(() => chrome.permissions.getAll())).toMatchObject({ origins: ['http://127.0.0.1/*'] });
				await expect(page.locator('#submit_button')).toHaveAttribute('type', 'submit');
				// Opening the real toolbar popup supplies activeTab for this one page only.
				const popup = await openToolbarPopup(context, extensionId, page);
				try {
					await expect
						.poll(() => popup.evaluate(`Array.from(document.querySelectorAll('.account-card'), (card) => card.dataset.accountId)`))
						.toEqual([jumpserver.id]);
					const httpManual = '这是 HTTP 页面，只能手动填充；每个账户的填充按钮仍可使用。';
					const toggleState = () =>
						popup.evaluate(`(() => {
							const input = document.querySelector('#autofill-site');
							const label = input.closest('label');
							return {
								hidden: label.hidden,
								disabled: input.disabled,
								checked: input.checked,
								title: label.title,
								description: document.querySelector('#autofill-description').textContent,
								note: document.querySelector('#autofill-note').hidden ? null : document.querySelector('#autofill-note').textContent.trim(),
							};
						})()`);
					// The reason is shown on screen, not only as a tooltip.
					await expect
						.poll(toggleState)
						.toEqual({ hidden: false, disabled: true, checked: false, title: httpManual, description: httpManual, note: httpManual });
					await popup.evaluate(`(() => {
						window.fixturePermissionRequests = [];
						const request = chrome.permissions.request.bind(chrome.permissions);
						chrome.permissions.request = details => {
							window.fixturePermissionRequests.push(details);
							return request(details);
						};
					})()`);
					// A real pointer click on the unavailable switch neither enables
					// automation nor asks for the network host.
					await popup.click('#autofill-site');
					await page.waitForTimeout(300);
					expect(await toggleState()).toMatchObject({ disabled: true, checked: false });
					expect(await popup.evaluate('window.fixturePermissionRequests')).toEqual([]);
					await expect(page.locator(JUMPSERVER_INPUT)).toHaveValue('');
					await popup.click(`.account-card[data-account-id="${jumpserver.id}"] .account-fill`);
					await assertFilled(page, jumpserver, { selector: JUMPSERVER_INPUT });
				} finally {
					// A successful manual fill closes the popup by itself.
					await popup.close().catch(() => {});
				}
				expect(await page.evaluate(() => window.fixtureState)).toMatchObject({ submits: 0 });
				expect((await options.evaluate(() => chrome.permissions.getAll())).origins).toEqual(['http://127.0.0.1/*']);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([]);
				expect((await options.evaluate(() => chrome.storage.local.get('bindings'))).bindings || []).toEqual([]);
				await page.screenshot({ path: testInfo.outputPath('jumpserver-private-http-manual-fill.png'), fullPage: true });
				const requestsBeforeRevisit = requestPaths.length;
				const revisit = await openTarget(JUMPSERVER_HTTP);
				await expectUnfilled(revisit, JUMPSERVER_INPUT);
				await expect(revisit.locator('[data-twofa-autofill]')).toHaveCount(0);
				expect(requestPaths.length).toBe(requestsBeforeRevisit);
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} removes a plain-HTTP JumpServer authorization saved before the upgrade and never fills it automatically`, async ({
		browserName: _browserName,
	}) => {
		const jumpserver = record('jumpserver', '172.16.0.10 堡垒机');
		await withAutomaticFixture(
			brand,
			[jumpserver],
			async ({ context, worker, options, extensionId, instanceOrigin, requestPaths, send, openTarget }) => {
				const page = await openTarget(JUMPSERVER_HTTP);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				const legacyPattern = JUMPSERVER_HTTP + '/*';
				const legacySite = { instanceOrigin, targetOrigin: JUMPSERVER_HTTP, targetPath: JUMPSERVER_PATH };
				const otherSite = { instanceOrigin, targetOrigin: GITHUB, targetPath: '/login/single' };
				// Earlier versions saved this site preference and its host grant.
				// The GitHub preference already has its pre-granted host permission.
				await worker.evaluate((autofillSites) => chrome.storage.local.set({ autofillSites }), [legacySite, otherSite]);
				const requestsBeforeGrant = requestPaths.length;
				// Restoring the old host grant runs the same reconciliation the
				// upgrade runs. It must retire the site instead of registering it.
				// The browser-owned grant is completed through permissions.request,
				// which reports the permission change to the extension.
				const manager = await context.newPage();
				await manager.goto('chrome://extensions/');
				await expect.poll(() => manager.evaluate(() => typeof chrome.developerPrivate?.addHostPermission)).toBe('function');
				await manager.evaluate(({ id, host }) => chrome.developerPrivate.addHostPermission(id, host), {
					id: extensionId,
					host: legacyPattern,
				});
				expect(await options.evaluate((pattern) => chrome.permissions.request({ origins: [pattern] }), legacyPattern)).toBe(true);
				await manager.close();
				await expect
					.poll(async () => (await options.evaluate(() => chrome.storage.local.get('autofillSites'))).autofillSites)
					.toEqual([otherSite]);
				await expect
					.poll(() => options.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), legacyPattern))
					.toBe(false);
				expect((await options.evaluate(() => chrome.permissions.getAll())).origins).not.toContain(legacyPattern);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data.sites).toEqual([otherSite]);
				// The still-authorized HTTPS site keeps its automatic script; the
				// plain-HTTP network host never receives one.
				const automaticMatches = () =>
					worker.evaluate(async () =>
						(await chrome.scripting.getRegisteredContentScripts())
							.filter((registration) => registration.js.includes('automatic.js'))
							.flatMap((registration) => registration.matches),
					);
				await expect.poll(automaticMatches).toContain(GITHUB + '/*');
				expect((await automaticMatches()).filter((match) => match.startsWith(JUMPSERVER_HTTP))).toEqual([]);
				await page.bringToFront();
				await expectUnfilled(page, JUMPSERVER_INPUT);
				await expect(page.locator('[data-twofa-autofill]')).toHaveCount(0);
				const revisit = await openTarget(JUMPSERVER_HTTP);
				await expectUnfilled(revisit, JUMPSERVER_INPUT);
				await expect(revisit.locator('[data-twofa-autofill]')).toHaveCount(0);
				expect(requestPaths.slice(requestsBeforeGrant).filter((path) => path.startsWith('/api/'))).toEqual([]);
			},
		);
	});

	test(`${brand} waits for a choice when multiple accounts share an authorized HTTPS JumpServer IP`, async ({
		browserName: _browserName,
	}) => {
		const alice = record('jumpserver-alice', '172.16.0.10 堡垒机');
		const bob = record('jumpserver-bob', '172.16.0.10 JumpServer', { secret: SECOND_SECRET });
		const unrelated = record('neighbor', '172.16.0.11 堡垒机');
		await withAutomaticFixture(
			brand,
			[alice, bob, unrelated],
			async ({ context, options, extensionId, requestPaths, openTarget, assertFilled }) => {
				const page = await openTarget(JUMPSERVER);
				await expectUnfilled(page, JUMPSERVER_INPUT);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				await authorizeJumpserverThroughPopup({ context, options, extensionId, target: page });
				await expectUnfilled(page, JUMPSERVER_INPUT);
				await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
				await clickClosedPickerAccount(context, page, bob.account, unrelated.account);
				await assertFilled(page, bob, { selector: JUMPSERVER_INPUT });
				expect(await page.evaluate(() => window.fixtureState)).toMatchObject({ submits: 0, automaticInputs: 1 });
				expect((await options.evaluate(() => chrome.storage.local.get('bindings'))).bindings || []).toEqual([]);
			},
			{ pregrantTargets: false, toolbarAction: true },
		);
	});

	test(`${brand} removes legacy device credentials on upgrade and requires an explicit reconnection`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(
			brand,
			[github],
			async ({ context, worker, options, extensionId, instanceOrigin, localTarget, requestPaths, send, openTarget }) => {
				// Seed the old installation with the new settings UI disposed, as it
				// would be before an upgrade starts the new worker and settings page.
				await options.evaluate(() => window.dispatchEvent(new Event('pagehide')));
				const legacyToken = `2fae_${'a'.repeat(32)}.${'b'.repeat(64)}`;
				const savedBinding = { instanceOrigin, targetOrigin: GITHUB, accountId: github.id };
				const otherSite = { instanceOrigin: localTarget, targetOrigin: CLOUDFLARE, targetPath: '/login/single' };
				await worker.evaluate(
					({ instanceOrigin, localTarget, legacyToken, savedBinding, otherSite }) =>
						chrome.storage.local.set({
							settings: { instanceOrigin },
							instances: [instanceOrigin, localTarget],
							deviceAuth: [{ instanceOrigin, token: legacyToken }],
							offlineInstances: [instanceOrigin],
							autofillSites: [{ instanceOrigin, targetOrigin: 'https://github.com', targetPath: '/login/single' }, otherSite],
							bindings: [savedBinding],
						}),
					{ instanceOrigin, localTarget, legacyToken, savedBinding, otherSite },
				);
				const requestsBeforeRestart = requestPaths.length;
				await restartExtensionWorker(context, options, worker.url());
				const local = await options.evaluate(() => chrome.storage.local.get(null));
				expect(local.deviceAuth).toBeUndefined();
				expect(JSON.stringify(local)).not.toContain(legacyToken);
				expect(local.settings?.instanceOrigin ?? null).toBeNull();
				expect(local.offlineInstances).toEqual([]);
				expect(local.autofillSites).toEqual([otherSite]);
				expect(local.bindings).toEqual([savedBinding]);
				expect(local.instances).toEqual([localTarget, instanceOrigin]);
				expect(await send({ type: 'GET_SETTINGS' })).toMatchObject({ ok: true, data: { instanceOrigin: null } });
				expect(await send({ type: 'START_FLOW' })).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
				const target = await openTarget(GITHUB);
				await expectUnfilled(target);
				await expect(target.locator('[data-twofa-autofill]')).toHaveCount(0);
				await options.reload();
				await expect(options.locator('#connection-editor')).toBeVisible();
				await expect(options.locator('#instance-origin')).toHaveValue(instanceOrigin);
				await expect(options.locator('#connect-instance')).toBeVisible();
				await expect(options.locator('#advanced-settings, #connection-mode, #device-token, #save-connection, #manage-devices')).toHaveCount(
					0,
				);
				await options.screenshot({ path: testInfo.outputPath('legacy-device-reconnect.png'), fullPage: true });
				const popup = await context.newPage();
				await popup.goto(`chrome-extension://${extensionId}/popup.html`);
				await expect(popup.locator('#setup-guide')).toBeVisible();
				await expect(popup.locator('.account-card')).toHaveCount(0);
				expect(requestPaths.slice(requestsBeforeRestart).filter((path) => path.startsWith('/api/'))).toEqual([]);
				await popup.close();
				// Reconnecting can resume normal session reads, but previous website
				// automation must remain disabled until separately authorized again.
				await options.locator('#instance-origin').fill(instanceOrigin);
				await options.locator('#connect-instance').click();
				await expect(options.locator('#status')).toContainText('1 个账户');
				const revisit = await openTarget(GITHUB);
				await expectUnfilled(revisit);
				const sites = await options.evaluate(() => chrome.storage.local.get('autofillSites'));
				expect(sites.autofillSites).not.toContainEqual({ instanceOrigin, targetOrigin: GITHUB, targetPath: '/login/single' });
				expect(requestPaths.some((path) => path.startsWith('/api/extension') || path.startsWith('/api/devices'))).toBe(false);
			},
		);
	});

	test(`${brand} requires site opt-in, fills an already-open page and stops after disabling or switching instances`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(
			brand,
			[github],
			async ({ context, worker, options, instanceOrigin, localTarget, requestPaths, setSite, send, openTarget, assertFilled }) => {
				const page = await openTarget(GITHUB);
				await expectUnfilled(page);
				expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
				await setSite(GITHUB);
				await assertFilled(page, github);
				const revisited = await openTarget(GITHUB);
				await assertFilled(revisited, github);
				expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
				await setSite(GITHUB, false);
				await revisited.evaluate(() => window.mountOtp('single'));
				await expectUnfilled(revisited);
				const disabledVisit = await openTarget(GITHUB);
				await expectUnfilled(disabledVisit);
				await setSite(GITHUB);
				await assertFilled(disabledVisit, github);
				const checksBeforeSwitch = requestPaths.filter((path) => path === '/api/secrets').length;
				const switched = await send({ type: 'SAVE_INSTANCE', instanceOrigin: localTarget, connection: { mode: 'session' } });
				expect(switched.ok, switched.error?.message).toBe(true);
				await expect(options.locator('#current-instance')).toHaveText(localTarget);
				await expect.poll(() => requestPaths.filter((path) => path === '/api/secrets').length).toBeGreaterThan(checksBeforeSwitch);
				await expect(options.locator('#status')).toHaveAttribute('data-tone', 'success');
				await disabledVisit.evaluate(() => window.mountOtp('single'));
				const requestsBefore = requestPaths.length;
				await expectUnfilled(disabledVisit);
				const otherInstanceVisit = await openTarget(GITHUB);
				await expectUnfilled(otherInstanceVisit);
				expect(requestPaths.length).toBe(requestsBefore);
				const savedSites = await options.evaluate(() => chrome.storage.local.get('autofillSites'));
				expect(savedSites.autofillSites).toContainEqual({ instanceOrigin, targetOrigin: GITHUB, targetPath: '/login/single' });
				const registrations = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
				expect(registrations.filter((registration) => registration.js.includes('automatic.js'))).toEqual([]);
			},
		);
	});

	test(`${brand} enables site automation through the popup and fills a delayed SPA form without reopening it`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(brand, [github], async ({ context, extensionId, instanceOrigin, send, openTarget, assertFilled }) => {
			const target = await openTarget(GITHUB, 'empty');
			const popup = await context.newPage();
			await popup.setViewportSize({ width: 380, height: 600 });
			await popup.goto(`chrome-extension://${extensionId}/popup.html`);
			await expect(popup.locator('.preview-code').first()).toHaveText(/^\d{6}$/);
			await popup.evaluate(async (origin) => {
				const [tab] = await chrome.tabs.query({ url: origin + '/*' });
				await chrome.tabs.update(tab.id, { active: true });
			}, GITHUB);
			await popup.locator('#retry').evaluate((button) => button.click());
			await expect(popup.locator('#autofill-site')).toBeVisible();
			await expect(popup.locator('#autofill-site')).toBeEnabled();
			await popup.screenshot({ path: test.info().outputPath('autofill-popup.png'), fullPage: true });
			// The checkbox shows committed policy while permission/validation is pending.
			await popup.locator('#autofill-site').click();
			await expect
				.poll(async () => (await send({ type: 'GET_AUTOFILL_SITES' })).data?.sites)
				.toContainEqual({ instanceOrigin, targetOrigin: GITHUB, targetPath: '/login/empty' });
			await popup.close();
			await target.bringToFront();
			await target.evaluate(() => {
				window.history.pushState({}, '', '/login/empty?step=second');
				window.mountOtp('single');
			});
			await assertFilled(target, github);
			const revisited = await openTarget(GITHUB, 'empty');
			await revisited.evaluate(() => window.mountOtp('single'));
			await assertFilled(revisited, github);
			expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
		});
	});

	test(`${brand} independently fills six digits, eight digits and segmented inputs from offline cache`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		const cloudflare = record('cloudflare', 'Cloudflare', { digits: 8, secret: SECOND_SECRET });
		const local = record('private', 'Private fixture', { secret: SECOND_SECRET });
		await withAutomaticFixture(
			brand,
			[github, cloudflare, local],
			async ({ context, worker, instanceOrigin, localTarget, requestPaths, setSite, send, openTarget, assertFilled, stopServer }) => {
				const source = await context.newPage();
				await source.goto(instanceOrigin + '/source');
				const save = await send({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'offline' } });
				expect(save.ok).toBe(true);
				const synced = await send({ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin });
				expect(synced.ok, synced.error?.message).toBe(true);
				await worker.evaluate(
					({ instanceOrigin, targetOrigin, accountId }) =>
						chrome.storage.local.set({ bindings: [{ instanceOrigin, targetOrigin, accountId }] }),
					{ instanceOrigin, targetOrigin: localTarget, accountId: local.id },
				);
				await setSite(GITHUB);
				await setSite(CLOUDFLARE, true, '/login/eight');
				await setSite(localTarget, true, '/login/split');
				await setSite(GITHUB, true, '/login/occupied');
				await source.close();
				await stopServer();
				const requestsBefore = requestPaths.length;
				const fetchesBefore = await worker.evaluate(() => globalThis.fixtureRequestCount);
				const pages = await Promise.all([openTarget(GITHUB), openTarget(CLOUDFLARE, 'eight'), openTarget(localTarget, 'split')]);
				await Promise.all([
					assertFilled(pages[0], github),
					assertFilled(pages[1], cloudflare),
					assertFilled(pages[2], local, { split: true }),
				]);
				expect(requestPaths.length).toBe(requestsBefore);
				expect(context.pages().some((tab) => tab.url().startsWith(instanceOrigin))).toBe(false);
				expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
				const page = pages[0];
				const initial = await page.evaluate(() => window.fixtureState.automaticInputs);
				await page.locator('#otp').fill('');
				await expectUnfilled(page);
				expect(await page.evaluate(() => window.fixtureState.automaticInputs)).toBe(initial);
				const occupied = await openTarget(GITHUB, 'occupied');
				await occupied.waitForTimeout(800);
				await expect(occupied.locator('#otp')).toHaveValue('123456');
				await occupied.locator('#otp').fill('');
				await expectUnfilled(occupied);
				expect(await occupied.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 0 });
				expect(await worker.evaluate(() => globalThis.fixtureRequestCount)).toBeLessThanOrEqual(fetchesBefore + 1);
				await setSite(GITHUB, false);
				const cache = await send({ type: 'OFFLINE_STATUS' });
				expect(cache).toMatchObject({ ok: true, data: { instanceOrigin, available: true, accountCount: 3 } });
				const remainingSite = await openTarget(CLOUDFLARE, 'eight');
				await assertFilled(remainingSite, cloudflare);
				expect(await worker.evaluate(() => globalThis.fixtureRequestCount)).toBeLessThanOrEqual(fetchesBefore + 1);
			},
		);
	});

	test(`${brand} uses the exact Google account identity without a popup or cross-service choice`, async ({ browserName: _browserName }) => {
		const alice = record('alice', 'Google', { account: 'Google:alice@example.com' });
		const bob = record('bob', 'Google', { account: 'bob@example.com', secret: SECOND_SECRET });
		const otherService = record('github', 'GitHub', { account: 'alice@example.com', secret: SECOND_SECRET });
		await withAutomaticFixture(
			brand,
			[alice, bob, otherService],
			async ({ context, worker, instanceOrigin, setSite, openTarget, assertFilled }) => {
				const bindings = [{ instanceOrigin, targetOrigin: GOOGLE, accountId: bob.id }];
				await worker.evaluate((bindings) => chrome.storage.local.set({ bindings }), bindings);
				await setSite(GOOGLE);
				const page = await openTarget(GOOGLE);
				await assertFilled(page, alice);
				expect((await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings).toEqual(bindings);
				expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
			},
		);
	});

	test(`${brand} automatically fills the real Vultr field structure only after site authorization`, async ({
		browserName: _browserName,
	}) => {
		const vultr = record('vultr-alice', 'Vultr');
		const unrelated = record('github', 'GitHub', { secret: SECOND_SECRET });
		await withAutomaticFixture(brand, [vultr, unrelated], async ({ context, requestPaths, setSite, openTarget, assertFilled }) => {
			const page = await openTarget(VULTR);
			await expectUnfilled(page, VULTR_INPUT);
			expect(requestPaths.filter((path) => path.startsWith('/api/'))).toEqual([]);
			expect(
				await page.locator(VULTR_INPUT).evaluate((input) => ({
					id: input.getAttribute('id'),
					maxlength: input.getAttribute('maxlength'),
					labelCount: input.labels.length,
					autocomplete: input.getAttribute('autocomplete'),
					placeholder: input.getAttribute('placeholder'),
				})),
			).toEqual({ id: null, maxlength: null, labelCount: 0, autocomplete: 'off', placeholder: 'Authentication code' });
			await setSite(VULTR);
			await assertFilled(page, vultr, { selector: VULTR_INPUT });
			await expect(page.locator('[data-twofa-autofill]')).toHaveCount(0);
			await expect(page.locator('input[type="hidden"][name="csrf_token"]')).toHaveValue('synthetic-csrf-token');
			await expect(page.locator('input[type="hidden"][name="action"]')).toHaveValue('authenticate');
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
			expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
		});
	});

	test(`${brand} shows both Vultr accounts and waits for a trusted choice on its authentication form`, async ({
		browserName: _browserName,
	}) => {
		const alice = record('vultr-alice', 'Vultr');
		const bob = record('vultr-bob', 'vultr.com', { secret: SECOND_SECRET });
		const unrelated = record('github', 'GitHub');
		await withAutomaticFixture(brand, [alice, bob, unrelated], async ({ context, setSite, openTarget, assertFilled }) => {
			await setSite(VULTR);
			const page = await openTarget(VULTR);
			await expectUnfilled(page, VULTR_INPUT);
			await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
			const session = await context.newCDPSession(page);
			try {
				const { nodes } = await session.send('Accessibility.getFullAXTree');
				const choices = nodes.filter((node) => node.role?.value === 'button').map((node) => node.name?.value || '');
				expect(choices.some((name) => name.includes(alice.account))).toBe(true);
				expect(choices.some((name) => name.includes(bob.account))).toBe(true);
				expect(choices.some((name) => name.includes(unrelated.account))).toBe(false);
			} finally {
				await session.detach();
			}
			await page.screenshot({ path: test.info().outputPath('vultr-account-choice.png'), fullPage: true });
			await clickClosedPickerAccount(context, page, bob.account, unrelated.account);
			await assertFilled(page, bob, { selector: VULTR_INPUT });
			await expect(page.locator('[data-twofa-autofill]')).toHaveCount(0);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
			expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
		});
	});

	test(`${brand} automatically selects the explicitly bound Vultr account when two accounts exist`, async ({
		browserName: _browserName,
	}) => {
		const alice = record('vultr-alice', 'Vultr');
		const bob = record('vultr-bob', 'Vultr', { secret: SECOND_SECRET });
		await withAutomaticFixture(brand, [alice, bob], async ({ context, worker, instanceOrigin, setSite, openTarget, assertFilled }) => {
			const bindings = [{ instanceOrigin, targetOrigin: VULTR, accountId: bob.id }];
			await worker.evaluate((bindings) => chrome.storage.local.set({ bindings }), bindings);
			await setSite(VULTR);
			const page = await openTarget(VULTR);
			await assertFilled(page, bob, { selector: VULTR_INPUT });
			await expect(page.locator('[data-twofa-autofill]')).toHaveCount(0);
			expect((await worker.evaluate(() => chrome.storage.local.get('bindings'))).bindings).toEqual(bindings);
			expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
			expect(context.pages().some((tab) => /\/popup\.html$/.test(tab.url()))).toBe(false);
		});
	});

	test(`${brand} waits for a trusted account choice and preserves user-entered values`, async ({ browserName: _browserName }) => {
		const alice = record('alice', 'GitHub');
		const bob = record('bob', 'GitHub', { secret: SECOND_SECRET });
		const unrelated = record('google', 'Google');
		await withAutomaticFixture(brand, [alice, bob, unrelated], async ({ context, setSite, openTarget, assertFilled }) => {
			await setSite(GITHUB);
			const page = await openTarget(GITHUB);
			await expectUnfilled(page);
			await clickClosedPickerAccount(context, page, bob.account, unrelated.account);
			await assertFilled(page, bob);
			const filledEvents = await page.evaluate(() => window.fixtureState.automaticInputs);
			await page.locator('#otp').fill('');
			await expectUnfilled(page);
			expect(await page.evaluate(() => window.fixtureState.automaticInputs)).toBe(filledEvents);
			await setSite(GITHUB, true, '/login/occupied');
			const occupied = await openTarget(GITHUB, 'occupied');
			await occupied.waitForTimeout(800);
			await expect(occupied.locator('#otp')).toHaveValue('123456');
			await occupied.locator('#otp').fill('654321');
			await occupied.waitForTimeout(800);
			await expect(occupied.locator('#otp')).toHaveValue('654321');
			expect(await occupied.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 0 });
		});
	});

	test(`${brand} refreshes a waiting account picker after the extension service worker restarts`, async ({ browserName: _browserName }) => {
		const alice = record('alice', 'GitHub');
		const bob = record('bob', 'GitHub', { secret: SECOND_SECRET });
		const unrelated = record('google', 'Google');
		await withAutomaticFixture(
			brand,
			[alice, bob, unrelated],
			async ({ context, worker, options, requestPaths, setSite, openTarget, assertFilled }) => {
				await setSite(GITHUB);
				const page = await openTarget(GITHUB);
				await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
				await expect(page.locator('#otp')).toHaveValue('');
				const originalPanel = await page.locator('[data-twofa-autofill]').elementHandle();
				await restartExtensionWorker(context, options, worker.url());
				const readsBefore = requestPaths.filter((path) => path === '/api/secrets').length;
				await clickClosedPickerAccount(context, page, bob.account, unrelated.account);
				await expect.poll(() => originalPanel.evaluate((host) => host.isConnected)).toBe(false);
				await expect.poll(() => requestPaths.filter((path) => path === '/api/secrets').length).toBeGreaterThan(readsBefore);
				await expect(page.locator('[data-twofa-autofill]')).toHaveCount(1);
				await expect(page.locator('#otp')).toHaveValue('');
				await clickClosedPickerAccount(context, page, bob.account, unrelated.account);
				await assertFilled(page, bob);
				expect(await page.evaluate(() => window.fixtureState)).toEqual({ submits: 0, automaticInputs: 1 });
				await originalPanel.dispose();
			},
		);
	});

	test(`${brand} removes site automation after a real optional host permission revocation and does not restore it on regrant`, async ({
		browserName: _browserName,
	}) => {
		const github = record('github', 'GitHub');
		await withAutomaticFixture(
			brand,
			[github],
			async ({ context, worker, options, extensionId, instanceOrigin, setSite, send, openTarget, assertFilled, stopServer }) => {
				const targetPattern = GITHUB + '/*';
				const hasTargetPermission = () => options.evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), targetPattern);
				expect(await hasTargetPermission()).toBe(false);
				const save = await send({ type: 'SAVE_INSTANCE', instanceOrigin, connection: { mode: 'offline' } });
				expect(save.ok).toBe(true);
				const synced = await send({ type: 'REFRESH_OFFLINE_ACCOUNTS', instanceOrigin });
				expect(synced.ok, synced.error?.message).toBe(true);
				await stopServer();
				const fetchesBefore = await worker.evaluate(() => globalThis.fixtureRequestCount);
				const page = await openTarget(GITHUB);
				await expectUnfilled(page);
				const manager = await context.newPage();
				// Both distribution builds run in isolated Chrome for Testing profiles.
				// This browser-owned API grants a real optional host permission without
				// changing the shipped manifest or replacing extension permission APIs.
				await manager.goto('chrome://extensions/');
				await expect.poll(() => manager.evaluate(() => typeof chrome.developerPrivate?.addHostPermission)).toBe('function');
				const grantTarget = async () => {
					await manager.evaluate(({ id, host }) => chrome.developerPrivate.addHostPermission(id, host), {
						id: extensionId,
						host: targetPattern,
					});
					// Site-access preapproval still needs the extension's optional
					// permission request, as in the branded Options test.
					expect(await options.evaluate((pattern) => chrome.permissions.request({ origins: [pattern] }), targetPattern)).toBe(true);
					await expect.poll(hasTargetPermission).toBe(true);
				};
				await grantTarget();
				await setSite(GITHUB);
				await page.bringToFront();
				await assertFilled(page, github);
				const removed = await options.evaluate((pattern) => chrome.permissions.remove({ origins: [pattern] }), targetPattern);
				expect(removed).toBe(true);
				await expect.poll(hasTargetPermission).toBe(false);
				await expect.poll(async () => (await send({ type: 'GET_AUTOFILL_SITES' })).data?.sites).toEqual([]);
				await expect
					.poll(() =>
						worker.evaluate(async () =>
							(await chrome.scripting.getRegisteredContentScripts()).filter((item) => item.js.includes('automatic.js')),
						),
					)
					.toEqual([]);
				await page.evaluate(() => window.mountOtp('single'));
				await expectUnfilled(page);
				const revokedVisit = await openTarget(GITHUB);
				await expectUnfilled(revokedVisit);
				expect(await send({ type: 'OFFLINE_STATUS' })).toMatchObject({
					ok: true,
					data: { instanceOrigin, available: true, accountCount: 1 },
				});
				expect(await options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
				await grantTarget();
				await revokedVisit.bringToFront();
				await revokedVisit.evaluate(() => window.mountOtp('single'));
				await expectUnfilled(revokedVisit);
				const regrantedVisit = await openTarget(GITHUB);
				await expectUnfilled(regrantedVisit);
				expect((await send({ type: 'GET_AUTOFILL_SITES' })).data?.sites).toEqual([]);
				expect(await worker.evaluate(() => globalThis.fixtureRequestCount)).toBeLessThanOrEqual(fetchesBefore + 1);
				expect(context.pages().some((tab) => tab.url().startsWith(instanceOrigin))).toBe(false);
			},
			{ pregrantTargets: false },
		);
	});
}
