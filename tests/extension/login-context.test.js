// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readLoginContext } from '../../extension/src/content/login-context.js';
import { createContentController } from '../../extension/src/content/index.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

const HTML = readFileSync(resolve(process.cwd(), 'tests/extension/fixtures/google-totp.html'), 'utf8');
const URL = 'https://accounts.google.com/v3/signin/challenge/totp';
const LOGIN = { provider: 'google', email: 'alice@example.com' };
const NONCE = 'a'.repeat(36);
function setEmail(email) {
	document.querySelector('[data-profile-identifier]').textContent = email;
	document.getElementById('identifierId').value = email;
}
function show(element) {
	Object.defineProperty(element, 'getClientRects', { configurable: true, value: () => [{ width: 100, height: 20 }] });
}
beforeEach(() => {
	window.happyDOM.setURL(URL);
	document.body.innerHTML = HTML;
	for (const element of document.querySelectorAll('*')) {
		show(element);
	}
});
afterEach(() => {
	document.body.replaceChildren();
	window.happyDOM.setURL('http://localhost:3000');
	vi.restoreAllMocks();
});

it('extracts only the visible selected email corroborated by the hidden identifier', () => {
	setEmail('Alice@Example.com');
	expect(readLoginContext(document)).toEqual(LOGIN);
	const text = document.createElement('p');
	text.textContent = 'Recovery mail: someone@example.org';
	document.body.append(text);
	expect(readLoginContext(document)).toEqual(LOGIN);
});
it.each([
	'http://accounts.google.com/v3/signin/challenge/totp',
	'https://accounts.google.com.evil.example/v3/signin/challenge/totp',
	'https://accounts.google.com:8443/v3/signin/challenge/totp',
	'https://accounts.google.com/v3/signin/challenge/pwd',
])('ignores unsupported origin or challenge %s', (url) => {
	window.happyDOM.setURL(url);
	expect(readLoginContext(document)).toBeNull();
});
it.each(['hidden', 'mismatch', 'masked', 'missing', 'ambiguous', 'no-pin'])(
	'does not infer an account from %s identification',
	(scenario) => {
		const identifier = document.querySelector('[data-profile-identifier]');
		if (scenario === 'hidden') {
			identifier.parentElement.style.opacity = '0';
		}
		if (scenario === 'mismatch') {
			document.getElementById('identifierId').value = 'bob@example.com';
		}
		if (scenario === 'masked') {
			setEmail('a***@example.com');
		}
		if (scenario === 'missing') {
			document.getElementById('identifierId').remove();
		}
		if (scenario === 'ambiguous') {
			const other = identifier.parentElement.cloneNode(true);
			document.body.append(other);
			show(other);
			show(other.querySelector('[data-profile-identifier]'));
		}
		if (scenario === 'no-pin') {
			document.getElementById('totpPin').remove();
		}
		expect(readLoginContext(document)).toBeNull();
	},
);
it('includes the login context in target discovery without touching the form', async () => {
	const controller = createContentController({ doc: document });
	expect(await controller.handle({ type: MESSAGE.TARGET_PING })).toEqual({
		ok: true,
		origin: 'https://accounts.google.com',
		targetPath: '/v3/signin/challenge/totp',
		loginContext: LOGIN,
	});
	expect(document.getElementById('totpPin').value).toBe('');
});
it('refuses a code after Google switches account within the same document', async () => {
	const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
	expect(
		(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, expectedLoginContext: LOGIN })).status,
	).toBe('ready');
	setEmail('bob@example.com');
	expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '123456', expiresAt: Date.now() + 30000 })).toMatchObject({
		ok: false,
		error: { code: 'LOGIN_CHANGED' },
	});
	expect(document.getElementById('totpPin').value).toBe('');
	controller.clearPending();
});
it('rechecks the login context after beforeinput handlers run', async () => {
	const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
	await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, expectedLoginContext: LOGIN });
	document.getElementById('totpPin').addEventListener('beforeinput', () => setEmail('bob@example.com'));
	expect((await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '123456', expiresAt: Date.now() + 30000 })).ok).toBe(
		false,
	);
	expect(document.getElementById('totpPin').value).toBe('');
	controller.clearPending();
});
