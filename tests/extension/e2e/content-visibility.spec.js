import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const ORIGIN = 'https://content-visibility.example';
const CODE = '123456';
const NONCE = '0123456789abcdef0123456789abcdef0123';
let contentBundle;

test.beforeAll(async () => {
	const result = await build({
		stdin: {
			contents: `
				export { detectOtpTarget, fillOtpTarget } from './extension/src/content/form.js';
				export { createContentController } from './extension/src/content/index.js';
				export { createAutomaticController } from './extension/src/content/automatic.js';
			`,
			resolveDir: resolve(import.meta.dirname, '../../..'),
		},
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'visibilityContent',
	});
	contentBundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
	// Exercise browser geometry using the production content modules. All pages
	// and account responses are fixtures; no external service receives a code.
	await page.route(/^https?:\/\//, (route) =>
		new URL(route.request().url()).origin === ORIGIN
			? route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}</style><body></body>' })
			: route.abort(),
	);
	await page.clock.install();
	await page.goto(`${ORIGIN}/login/otp`);
	await page.addScriptTag({ content: contentBundle });
});

async function mountFrame(page, { frameStyle = '', containerStyle = '', containerTag = 'div', nested = false } = {}) {
	await page.evaluate(
		async ({ frameStyle, containerStyle, containerTag, nested }) => {
			const container = document.createElement(containerTag);
			container.style.cssText = `width:360px;${containerStyle}`;
			document.body.append(container);
			const appendFrame = async (parent, html, style) => {
				const frame = parent.ownerDocument.createElement('iframe');
				frame.style.cssText = `display:block;width:320px;height:160px;border:0;${style}`;
				const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
				frame.srcdoc = html;
				parent.append(frame);
				await loaded;
				return frame;
			};
			const html = '<!doctype html><style>body{margin:0}input{box-sizing:border-box;width:160px;height:24px}</style>';
			const inputHtml = `${html}<input autocomplete="one-time-code" aria-label="Authenticator code">`;
			const outerFrame = await appendFrame(container, nested ? html : inputHtml, frameStyle);
			const inputFrame = nested ? await appendFrame(outerFrame.contentDocument.body, inputHtml, '') : outerFrame;
			const input = inputFrame.contentDocument.querySelector('input');
			window.visibilityFixture = { container, outerFrame, input, inputEvents: 0 };
			input.addEventListener('input', () => window.visibilityFixture.inputEvents++);
		},
		{ frameStyle, containerStyle, containerTag, nested },
	);
}

for (const scenario of [
	{ name: 'a zero-sized iframe', frameStyle: 'width:0;height:0' },
	{ name: 'an iframe in a fully clipped container', containerStyle: 'height:0;overflow:hidden' },
	{ name: 'a nested iframe behind a zero-height outer frame', frameStyle: 'height:0', nested: true },
	{ name: 'an iframe with an empty clip-path', frameStyle: 'clip-path:inset(100%)' },
	{ name: 'an iframe behind an ancestor clip-path', containerStyle: 'clip-path:inset(100%)' },
	{ name: 'a nested iframe behind an ancestor clip-path', containerStyle: 'clip-path:inset(100%)', nested: true },
	{ name: 'an iframe with an empty legacy clip', frameStyle: 'position:absolute;clip:rect(0px,auto,0px,auto)' },
	{ name: 'an iframe behind an empty legacy clip', containerStyle: 'position:absolute;clip:rect(0px,0px,0px,0px)' },
	{
		name: 'an iframe showing only padding above its clipped content',
		frameStyle: 'width:160px;height:24px;padding:20px;border:4px solid black',
		containerStyle: 'height:12px;overflow:hidden',
	},
	{
		name: 'a fixed iframe clipped by its transformed containing block',
		frameStyle: 'position:fixed;left:20px;top:20px',
		containerStyle: 'height:0;overflow:hidden;transform:translateZ(0)',
	},
	{
		name: 'an absolute iframe clipped by its positioned containing block',
		frameStyle: 'position:absolute;left:20px;top:20px',
		containerStyle: 'height:0;overflow:hidden;position:relative',
	},
]) {
	test(`does not discover ${scenario.name}`, async ({ page }) => {
		await mountFrame(page, scenario);
		const result = await page.evaluate(() => ({
			// The child input still has a normal layout rect in these regressions.
			inputHeight: window.visibilityFixture.input.getBoundingClientRect().height,
			status: window.visibilityContent.detectOtpTarget(document).status,
			value: window.visibilityFixture.input.value,
		}));
		expect(result.inputHeight).toBeGreaterThan(0);
		expect(result).toMatchObject({ status: 'not_found', value: '' });
	});
}

for (const scenario of [
	{ name: 'a visible iframe', frameStyle: 'border:4px solid black' },
	{ name: 'a partially clipped iframe', containerStyle: 'height:12px;overflow:hidden' },
	{ name: 'a visible nested iframe', nested: true },
	{ name: 'an iframe with a partially visible clip-path', frameStyle: 'clip-path:inset(0 50% 0 0)' },
	{ name: 'an iframe with an automatic legacy clip', frameStyle: 'position:absolute;clip:rect(auto,auto,auto,auto)' },
	{
		name: 'a fixed iframe outside a non-containing clipping ancestor',
		frameStyle: 'position:fixed;left:20px;top:20px',
		containerStyle: 'height:0;overflow:hidden',
	},
	{
		name: 'a padded iframe with some of its content still visible',
		frameStyle: 'width:160px;height:24px;padding:20px;border:4px solid black',
		containerStyle: 'height:36px;overflow:hidden',
	},
	{
		name: 'an absolute iframe outside a non-containing clipping ancestor',
		frameStyle: 'position:absolute;left:20px;top:20px',
		containerStyle: 'height:0;overflow:hidden',
	},
	{ name: 'an iframe inside an inline span with overflow hidden', containerTag: 'span', containerStyle: 'overflow:hidden' },
	{ name: 'an iframe inside a display-contents ancestor with overflow hidden', containerStyle: 'display:contents;overflow:hidden' },
]) {
	test(`fills ${scenario.name}`, async ({ page }) => {
		await mountFrame(page, scenario);
		const result = await page.evaluate((code) => {
			const detection = window.visibilityContent.detectOtpTarget(document);
			const filled = window.visibilityContent.fillOtpTarget(detection.target, code);
			return { detection: detection.status, filled, value: window.visibilityFixture.input.value };
		}, CODE);
		expect(result).toMatchObject({ detection: 'ready', filled: { status: 'filled' }, value: CODE });
	});
}

for (const wrapper of [
	{ name: 'inline span', tag: 'span', style: 'overflow:hidden' },
	{ name: 'display-contents div', tag: 'div', style: 'display:contents;overflow:hidden' },
]) {
	test(`fills a visible input inside a non-clipping ${wrapper.name}`, async ({ page }) => {
		const result = await page.evaluate(
			({ tag, style, code }) => {
				const container = document.createElement(tag);
				container.style.cssText = style;
				const input = document.createElement('input');
				input.autocomplete = 'one-time-code';
				container.append(input);
				document.body.append(container);
				const detection = window.visibilityContent.detectOtpTarget(document);
				const filled = window.visibilityContent.fillOtpTarget(detection.target, code);
				return {
					containerWidth: container.clientWidth,
					inputWidth: input.getBoundingClientRect().width,
					detection: detection.status,
					filled,
					value: input.value,
				};
			},
			{ ...wrapper, code: CODE },
		);
		expect(result.containerWidth).toBe(0);
		expect(result.inputWidth).toBeGreaterThan(0);
		expect(result).toMatchObject({ detection: 'ready', filled: { status: 'filled' }, value: CODE });
	});
}

for (const hiddenBy of ['frame size', 'container clipping', 'clip-path', 'legacy clip']) {
	test(`rejects a prepared target hidden by ${hiddenBy} while obtaining a code`, async ({ page }) => {
		await mountFrame(page);
		const prepared = await page.evaluate(async (nonce) => {
			const controller = window.visibilityContent.createContentController({ doc: document, detectionTimeoutMs: 0 });
			window.visibilityFixture.controller = controller;
			return controller.handle({ type: 'PREPARE_TARGET', nonce, expectedDigits: 6 });
		}, NONCE);
		expect(prepared).toMatchObject({ ok: true, status: 'ready' });
		const result = await page.evaluate(
			async ({ hiddenBy, nonce, code }) => {
				const { container, outerFrame, input, controller } = window.visibilityFixture;
				if (hiddenBy === 'frame size') {
					outerFrame.style.width = '0';
					outerFrame.style.height = '0';
				} else if (hiddenBy === 'container clipping') {
					container.style.height = '0';
					container.style.overflow = 'hidden';
				} else if (hiddenBy === 'clip-path') {
					outerFrame.style.clipPath = 'inset(100%)';
				} else {
					outerFrame.style.position = 'absolute';
					outerFrame.style.clip = 'rect(0px,auto,0px,auto)';
				}
				try {
					const filled = await controller.handle({ type: 'FILL_CODE', nonce, code, expiresAt: Date.now() + 30000 });
					return { filled, value: input.value, inputEvents: window.visibilityFixture.inputEvents };
				} finally {
					controller.dispose();
				}
			},
			{ hiddenBy, nonce: NONCE, code: CODE },
		);
		expect(result).toMatchObject({ filled: { ok: false, error: { code: 'TARGET_UNAVAILABLE' } }, value: '', inputEvents: 0 });
	});
}

async function startAutomatic(page) {
	await page.evaluate(
		async ({ nonce, code }) => {
			const messages = [];
			const runtime = {
				id: 'visibility-test',
				onMessage: { addListener() {}, removeListener() {} },
				async sendMessage(message) {
					messages.push(message.type);
					if (message.type === 'AUTO_STATUS') {
						return { ok: true, data: { enabled: true } };
					}
					if (message.type === 'AUTO_DISCOVER') {
						return {
							ok: true,
							data: {
								nonce,
								accounts: [{ id: 'fixture', name: 'Fixture', account: 'alice', type: 'TOTP', digits: 6 }],
								autoFillAccountId: 'fixture',
							},
						};
					}
					if (message.type === 'AUTO_SELECT') {
						const target = {
							nonce,
							episodeNonce: message.episodeNonce,
							expectedOrigin: window.location.origin,
							expectedTargetPath: window.location.pathname,
						};
						const prepared = await controller.handle({ ...target, type: 'AUTO_PREPARE', expectedDigits: 6 });
						if (!prepared.ok) {
							return prepared;
						}
						const filled = await controller.handle({ ...target, type: 'AUTO_FILL', code, expiresAt: Date.now() + 30000 });
						return { ok: filled.ok, data: { status: filled.status } };
					}
					return { ok: false };
				},
			};
			const controller = window.visibilityContent.createAutomaticController({ doc: document, runtime });
			Object.assign(window.visibilityFixture, { controller, messages });
			await controller.refresh();
		},
		{ nonce: NONCE, code: CODE },
	);
}

test('starts automatic filling only after a collapsed iframe becomes visible', async ({ page }) => {
	await mountFrame(page, { frameStyle: 'width:0;height:0' });
	await startAutomatic(page);
	try {
		await page.clock.runFor(250);
		expect(await page.evaluate(() => window.visibilityFixture.messages)).toEqual(['AUTO_STATUS']);
		expect(await page.evaluate(() => window.visibilityFixture.input.value)).toBe('');
		await page.evaluate(() => {
			window.visibilityFixture.outerFrame.style.width = '320px';
			window.visibilityFixture.outerFrame.style.height = '160px';
		});
		await page.clock.runFor(250);
		expect(await page.evaluate(() => window.visibilityFixture.messages)).toEqual(['AUTO_STATUS', 'AUTO_DISCOVER', 'AUTO_SELECT']);
		expect(await page.evaluate(() => window.visibilityFixture.input.value)).toBe(CODE);
	} finally {
		await page.evaluate(() => window.visibilityFixture.controller.dispose());
	}
});

for (const style of ['clip-path:inset(100%)', 'position:absolute;clip:rect(0px,auto,0px,auto)']) {
	test(`does not automatically fill a clipped input: ${style}`, async ({ page }) => {
		await page.evaluate((style) => {
			const input = document.createElement('input');
			input.autocomplete = 'one-time-code';
			input.style.cssText = style;
			document.body.append(input);
			window.visibilityFixture = { input };
		}, style);
		await startAutomatic(page);
		try {
			await page.clock.runFor(250);
			expect(await page.evaluate(() => window.visibilityFixture.messages)).toEqual(['AUTO_STATUS']);
			expect(await page.evaluate(() => window.visibilityFixture.input.value)).toBe('');
			await page.evaluate(() => (window.visibilityFixture.input.style.cssText = ''));
			await page.clock.runFor(250);
			expect(await page.evaluate(() => window.visibilityFixture.input.value)).toBe(CODE);
		} finally {
			await page.evaluate(() => window.visibilityFixture.controller.dispose());
		}
	});
}

test('fills an OTP after its delayed CSS animation ends without a resize or DOM update', async ({ page }) => {
	await page.evaluate(() => {
		const style = document.createElement('style');
		style.textContent = '@keyframes reveal{from{opacity:0}to{opacity:1}} input{opacity:0}.reveal{animation:reveal 100ms 400ms forwards}';
		const input = document.createElement('input');
		input.autocomplete = 'one-time-code';
		document.body.append(style, input);
		window.visibilityFixture = { input };
	});
	await startAutomatic(page);
	try {
		await page.clock.runFor(250);
		expect(await page.evaluate(() => window.visibilityFixture.messages)).toEqual(['AUTO_STATUS']);
		await page.evaluate(() => window.visibilityFixture.input.classList.add('reveal'));
		await expect.poll(() => page.evaluate(() => window.visibilityFixture.input.value)).toBe(CODE);
		expect(await page.evaluate(() => window.visibilityFixture.messages)).toEqual(['AUTO_STATUS', 'AUTO_DISCOVER', 'AUTO_SELECT']);
	} finally {
		await page.evaluate(() => window.visibilityFixture.controller.dispose());
	}
});
