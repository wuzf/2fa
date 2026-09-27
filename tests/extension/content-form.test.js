// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MESSAGE } from '../../extension/src/shared/protocol.js';
import { detectOtpTarget, fillOtpTarget, waitForOtpTarget } from '../../extension/src/content/form.js';
import { createContentController, createRuntimeMessageListener } from '../../extension/src/content/index.js';

const NONCE = '0123456789abcdef0123456789abcdef0123';

function makeVisible(input) {
	Object.defineProperty(input, 'getClientRects', {
		configurable: true,
		value: () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }],
	});
	return input;
}

function appendInput(attributes = {}, parent = document.body) {
	const input = makeVisible(document.createElement('input'));
	for (const [name, value] of Object.entries(attributes)) {
		if (name === 'value') {
			input.value = value;
		} else if (typeof value === 'boolean') {
			input[name] = value;
		} else {
			input.setAttribute(name, String(value));
		}
	}
	parent.append(input);
	return input;
}

function appendSegmentedGroup(length) {
	const group = document.createElement('div');
	group.setAttribute('role', 'group');
	group.setAttribute('aria-label', 'Authenticator verification code');
	document.body.append(group);
	return Array.from({ length }, (_, index) =>
		appendInput(
			{
				'aria-label': `Digit ${index + 1} of ${length}`,
				inputmode: 'numeric',
				maxlength: '1',
			},
			group,
		),
	);
}

beforeEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('captured verification page paths', () => {
	it('reports the current route without query strings or ordinary anchors', async () => {
		const original = window.location.href;
		try {
			window.history.replaceState({}, '', '/app?session=private#/mfa?token=private');
			const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
			const result = await controller.handle({ type: MESSAGE.TARGET_PING });
			expect(result.targetPath).toBe('/app#/mfa');
			expect(JSON.stringify(result)).not.toContain('private');
			window.history.replaceState({}, '', '/mfa?session=private#details');
			expect((await controller.handle({ type: MESSAGE.TARGET_PING })).targetPath).toBe('/mfa');
		} finally {
			window.history.replaceState({}, '', original);
		}
	});
	it('refuses a prepared code after same-document navigation to another verification path', async () => {
		const original = window.location.href;
		try {
			window.history.replaceState({}, '', '/mfa');
			const input = appendInput({ autocomplete: 'one-time-code', maxlength: '6' });
			const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
			expect(
				await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, expectedTargetPath: '/mfa' }),
			).toMatchObject({ ok: true, status: 'ready' });
			window.history.replaceState({}, '', '/other-mfa');
			expect(
				await controller.handle({
					type: MESSAGE.FILL_CODE,
					nonce: NONCE,
					code: '012345',
					expiresAt: Date.now() + 10000,
					expectedTargetPath: '/mfa',
				}),
			).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
			expect(input.value).toBe('');
			controller.clearPending();
		} finally {
			window.history.replaceState({}, '', original);
		}
	});
});

describe('OTP target detection and filling', () => {
	it('detects the observed JumpServer virtual MFA field and fills without submitting', () => {
		const html = readFileSync(resolve(process.cwd(), 'tests/extension/fixtures/jumpserver-mfa.html'), 'utf8');
		document.body.innerHTML = new window.DOMParser().parseFromString(html, 'text/html').body.innerHTML;
		const input = makeVisible(document.querySelector('input[name="code"]'));
		const submit = vi.fn((event) => event.preventDefault());
		document.querySelector('form').addEventListener('submit', submit);
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', target: { selection: 'unique' } });
		expect(detection.target.inputs).toEqual([input]);
		expect(fillOtpTarget(detection.target, '012345').status).toBe('filled');
		expect(input.value).toBe('012345');
		expect(document.querySelector('[name="csrfmiddlewaretoken"]').value).toBe('synthetic-csrf-token');
		expect(submit).not.toHaveBeenCalled();
	});
	it('detects the observed Vultr authentication input without autocomplete or maxlength', () => {
		const html = readFileSync(resolve(process.cwd(), 'tests/extension/fixtures/vultr-auth.html'), 'utf8');
		document.body.innerHTML = new window.DOMParser().parseFromString(html, 'text/html').body.innerHTML;
		const input = makeVisible(document.querySelector('input[name="token"]'));
		const submit = vi.fn((event) => event.preventDefault());
		document.querySelector('form').addEventListener('submit', submit);
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', target: { selection: 'unique' } });
		expect(detection.target.inputs).toEqual([input]);
		expect(fillOtpTarget(detection.target, '012345').status).toBe('filled');
		expect(input.value).toBe('012345');
		expect(document.querySelector('[name="csrf_token"]').value).toBe('synthetic-csrf-token');
		expect(document.querySelector('[name="action"]').value).toBe('authenticate');
		expect(submit).not.toHaveBeenCalled();
	});
	it.each([
		[6, '012345'],
		[8, '00123456'],
	])('recognizes the EU.org maxlength=30 field and fills a %i-digit OTP', (digits, code) => {
		const form = document.createElement('form');
		form.method = 'post';
		form.innerHTML = '<label for="id_otp">One-Time Password</label><p>Your one-time password</p>';
		document.body.append(form);
		const input = appendInput(
			{ id: 'id_otp', name: 'otp', type: 'text', placeholder: 'One-Time Password', autocomplete: 'off', maxlength: '30' },
			form,
		);
		const onSubmit = vi.fn((event) => event.preventDefault());
		form.addEventListener('submit', onSubmit);
		const result = detectOtpTarget(document, { expectedDigits: digits });
		expect(result).toMatchObject({ status: 'ready', kind: 'single', digits });
		expect(result.target.inputs).toEqual([input]);
		expect(fillOtpTarget(result.target, code).status).toBe('filled');
		expect(input.value).toBe(code);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('accepts a six-digit code when an OTP field has room for eight characters', () => {
		const input = appendInput({ autocomplete: 'one-time-code', maxlength: '8' });
		const result = detectOtpTarget(document, { expectedDigits: 6 });
		expect(result.status).toBe('ready');
		expect(fillOtpTarget(result.target, '012345').status).toBe('filled');
		expect(input.value).toBe('012345');
	});

	it.each(['0', '3', '5'])('refuses a field with insufficient maxlength=%s, including the focused fallback', (maxlength) => {
		const input = appendInput({ autocomplete: 'one-time-code', maxlength });
		input.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input })).toEqual({ status: 'not_found' });
		expect(input.value).toBe('');
	});

	it('honors an explicit numeric pattern separately from a generous maxlength', () => {
		const input = appendInput({ autocomplete: 'one-time-code', maxlength: '30', pattern: '[0-9]{8}' });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
		expect(detectOtpTarget(document, { expectedDigits: 8 }).target.inputs).toEqual([input]);
	});

	it('does not turn an unrelated maxlength=30 field into an OTP candidate', () => {
		appendInput({ id: 'username', autocomplete: 'username', maxlength: '30' });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});
	it('recognizes the observed NodeSeek 2FA field beside an unrelated site search input', () => {
		appendInput({ id: 'search-site2', name: 'q', placeholder: 'Search', 'aria-label': 'Enter your search term' });
		const label = document.createElement('label');
		label.htmlFor = '2fa';
		label.textContent = '2FA';
		document.body.append(label);
		const input = appendInput({ id: '2fa', type: 'text', placeholder: '输入6位数字' });
		const detection = detectOtpTarget(document, { expectedDigits: 6 });
		expect(detection.status).toBe('ready');
		expect(detection.target.inputs).toEqual([input]);
		expect(fillOtpTarget(detection.target, '012345').status).toBe('filled');
	});
	it('detects and fills one-time-code without using an instance value setter', () => {
		const input = appendInput({ autocomplete: 'one-time-code', inputmode: 'numeric' });
		const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
		const controlledSetter = vi.fn();
		Object.defineProperty(input, 'value', {
			configurable: true,
			get() {
				return nativeValue.get.call(this);
			},
			set: controlledSetter,
		});
		const events = [];
		for (const type of ['beforeinput', 'input', 'change']) {
			input.addEventListener(type, (event) => events.push([event.type, event.data]));
		}

		const detection = detectOtpTarget(document, { expectedDigits: 6 });
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', digits: 6 });
		expect(fillOtpTarget(detection.target, '012345')).toEqual({
			status: 'filled',
			kind: 'single',
			digits: 6,
		});
		expect(input.value).toBe('012345');
		expect(controlledSetter).not.toHaveBeenCalled();
		expect(events).toEqual([
			['beforeinput', '012345'],
			['input', '012345'],
			['change', undefined],
		]);
	});

	it.each([
		[6, '012345'],
		[8, '00123456'],
	])('fills a %i-cell segmented code and preserves leading zeroes', (length, code) => {
		const inputs = appendSegmentedGroup(length);
		const detection = detectOtpTarget(document, { expectedDigits: length });

		expect(detection).toMatchObject({ status: 'ready', kind: 'segmented', digits: length });
		expect(fillOtpTarget(detection.target, code)).toEqual({
			status: 'filled',
			kind: 'segmented',
			digits: length,
		});
		expect(inputs.map((input) => input.value).join('')).toBe(code);
	});

	it.each(['otp-card', 'verification-card', 'card'].flatMap((className) => ['single', 'segmented'].map((kind) => [className, kind])))(
		'fills a clear OTP inside the %s layout class (%s)',
		(className, kind) => {
			const inputs = kind === 'segmented' ? appendSegmentedGroup(6) : [appendInput({ autocomplete: 'one-time-code' })];
			if (kind === 'single') {
				const container = document.createElement('div');
				inputs[0].before(container);
				container.append(inputs[0]);
			}
			inputs[0].parentElement.className = className;
			const detection = detectOtpTarget(document);
			expect(detection).toMatchObject({ status: 'ready', kind, target: { selection: 'unique' } });
			expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled', kind, digits: 6 });
			expect(inputs.map((input) => input.value).join('')).toBe('012345');
		},
	);

	it('retains the OTP signal from a segmented group class when no label is present', () => {
		const inputs = appendSegmentedGroup(6);
		const group = inputs[0].parentElement;
		group.removeAttribute('aria-label');
		group.className = 'otp-card';
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
	});

	it.each(['credit-card', 'debit-card', 'bank-card', 'payment-card', 'card-number', 'card-security', 'recovery-card'])(
		'rejects a segmented group with the explicit credential class %s',
		(className) => {
			const inputs = appendSegmentedGroup(6);
			inputs[0].parentElement.className = className;
			for (const input of inputs) {
				input.autocomplete = 'one-time-code';
			}
			expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
		},
	);

	it.each(['single', 'segmented'])('keeps actual card labels excluded inside an OTP layout class (%s)', (kind) => {
		const inputs =
			kind === 'segmented'
				? appendSegmentedGroup(6)
				: [appendInput({ autocomplete: 'one-time-code', 'aria-label': 'Credit card security code', class: 'otp-card' })];
		if (kind === 'segmented') {
			inputs[0].parentElement.className = 'otp-card';
			inputs[0].parentElement.setAttribute('aria-label', 'Credit card security code');
			for (const input of inputs) {
				input.autocomplete = 'one-time-code';
			}
		}
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it.each(['single', 'segmented'])('never fills cc-* fields in an OTP layout, even with explicit focus (%s)', (kind) => {
		const inputs = kind === 'segmented' ? appendSegmentedGroup(6) : [appendInput({ 'aria-label': 'Authenticator code' })];
		if (kind === 'single') {
			const container = document.createElement('div');
			inputs[0].before(container);
			container.append(inputs[0]);
		}
		inputs[0].parentElement.className = 'otp-card';
		for (const input of inputs) {
			input.autocomplete = 'cc-csc';
		}
		inputs[0].focus();
		expect(detectOtpTarget(document, { focusedInput: inputs[0] })).toEqual({ status: 'not_found' });
	});

	it('uses the focused editable empty input as an explicit fallback', () => {
		const input = appendInput({ inputmode: 'numeric' });
		input.focus();

		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
		const detection = detectOtpTarget(document, { expectedDigits: 6, focusedInput: input });
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', digits: 6 });
		expect(detection.target.inputs).toEqual([input]);
	});

	it.each([
		['id', { id: 'verificationCode' }],
		['name', { name: 'two_factor_code' }],
		['aria-label', { 'aria-label': 'Authenticator code' }],
	])('recognizes an OTP signal from %s', (_source, attributes) => {
		appendInput(attributes);
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toMatchObject({
			status: 'ready',
			kind: 'single',
			digits: 6,
		});
	});

	it('recognizes an associated label and excludes recovery codes', () => {
		const label = document.createElement('label');
		label.htmlFor = 'challenge';
		label.textContent = 'Verification code';
		document.body.append(label);
		appendInput({ id: 'challenge' });
		expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('ready');

		document.body.replaceChildren();
		appendInput({ 'aria-label': 'Backup recovery code', autocomplete: 'one-time-code' });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('resolves hyphenated aria-labelledby references', () => {
		const label = document.createElement('span');
		label.id = 'verification-code-label';
		label.textContent = 'Authenticator code';
		document.body.append(label);
		appendInput({ 'aria-labelledby': label.id });

		expect(detectOtpTarget(document, { expectedDigits: 6 })).toMatchObject({
			status: 'ready',
			kind: 'single',
		});
	});

	it.each([
		['hidden', { type: 'hidden' }],
		['display:none', { style: 'display: none' }],
		['readonly', { readOnly: true }],
		['disabled', { disabled: true }],
	])('ignores a %s OTP input', (_name, attributes) => {
		appendInput({ autocomplete: 'one-time-code', ...attributes });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('replaces an existing OTP value and emits replacement input events', () => {
		const input = appendInput({ autocomplete: 'one-time-code', value: '654321' });
		const types = [];
		input.addEventListener('beforeinput', (event) => types.push(event.inputType));
		input.addEventListener('input', (event) => types.push(event.inputType));
		const detection = detectOtpTarget(document, { expectedDigits: 6 });
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', digits: 6 });
		expect(fillOtpTarget(detection.target, '012345').status).toBe('filled');
		expect(input.value).toBe('012345');
		expect(types).toEqual(['insertReplacementText', 'insertReplacementText']);
	});

	it('ignores inputs disabled by their enclosing fieldset', () => {
		const fieldset = document.createElement('fieldset');
		fieldset.disabled = true;
		document.body.append(fieldset);
		appendInput({ autocomplete: 'one-time-code' }, fieldset);
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('returns ambiguous for multiple OTP regions', () => {
		const first = appendInput({ autocomplete: 'one-time-code' });
		const second = appendInput({ 'aria-label': 'Authenticator code' });

		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({
			status: 'ambiguous',
			candidateCount: 2,
		});

		second.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('ambiguous');
		const focused = detectOtpTarget(document, { expectedDigits: 6, focusedInput: second });
		expect(focused).toMatchObject({ status: 'ready', kind: 'single' });
		expect(focused.target.inputs).toEqual([second]);
		expect(focused.target.inputs).not.toEqual([first]);
	});

	it.each(['SMS code', 'Email one-time code'])('returns ambiguous for channel-bound code: %s', (label) => {
		const input = appendInput({ 'aria-label': label });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({
			status: 'ambiguous',
			candidateCount: 1,
		});

		input.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input })).toMatchObject({
			status: 'ready',
			kind: 'single',
		});
	});

	it.each([
		['single', 'SMS'],
		['single', 'email'],
		['segmented', 'SMS'],
		['segmented', 'email'],
	])('requires explicit focus when a %s code is described as %s', (kind, channel) => {
		const help = document.createElement('p');
		help.id = 'delivery-help';
		help.textContent = `Enter the verification code sent via ${channel}.`;
		document.body.append(help);
		const inputs =
			kind === 'single'
				? [appendInput({ autocomplete: 'one-time-code', maxlength: '6', 'aria-describedby': help.id })]
				: appendSegmentedGroup(6);
		if (kind === 'segmented') {
			inputs[0].parentElement.setAttribute('aria-describedby', help.id);
		}
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'ambiguous', candidateCount: 1 });
		expect(inputs.every((input) => input.value === '')).toBe(true);
		inputs[0].focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: inputs[0] })).toMatchObject({
			status: 'ready',
			target: { selection: 'focused', channelAmbiguous: true },
		});
	});

	it('rejects filling when the referenced delivery instructions change after selection', () => {
		const help = document.createElement('p');
		help.id = 'delivery-help';
		help.textContent = 'Enter the authenticator verification code.';
		document.body.append(help);
		const input = appendInput({ autocomplete: 'one-time-code', 'aria-describedby': help.id });
		const result = detectOtpTarget(document, { expectedDigits: 6 });
		expect(result.status).toBe('ready');
		help.firstChild.textContent = 'Enter the verification code sent via SMS.';
		expect(fillOtpTarget(result.target, '012345')).toEqual({ status: 'failed', reason: 'target_changed' });
		expect(input.value).toBe('');
	});

	it.each([
		'Enter the verification code sent via SMS.',
		'Enter the verification code sent to your email.',
		'Enter your text message code.',
		'Email verification code',
		'请输入短信验证码。',
		'验证码已发送到您的邮箱。',
		'Enter the SMS code we sent. Alternatively, use your authenticator instead.',
		'请输入短信验证码。也可以改用身份验证器。',
	])('requires explicit focus for adjacent delivery instructions: %s', (instructions) => {
		const form = document.createElement('form');
		form.innerHTML = `<p>${instructions}</p><div class="field"><label for="otp">Verification code</label></div>`;
		document.body.append(form);
		const input = appendInput({ id: 'otp', autocomplete: 'one-time-code', maxlength: '6' }, form.querySelector('.field'));
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
		input.focus();
		const selected = detectOtpTarget(document, { expectedDigits: 6, focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
		expect(input.value).toBe('012345');
	});

	it.each([
		'<p hidden>Enter the verification code sent via SMS.</p>',
		'<p aria-hidden="true">Enter the verification code sent via SMS.</p>',
		'<div inert><p>Enter the verification code sent via SMS.</p></div>',
		'<p style="display:none">Enter the verification code sent via SMS.</p>',
		'<p style="visibility:hidden">Enter the verification code sent via SMS.</p>',
		'<p style="opacity:0">Enter the verification code sent via SMS.</p>',
		'<a href="#sms">Send verification code via SMS</a>',
		'<button type="button">Send verification code via SMS instead</button>',
		'<div role="button">Try another way</div>',
		'<p>Use an SMS code instead.</p>',
		'<p>也可以改用短信验证码。</p>',
		'<footer>SMS verification code help</footer>',
		'<p>Email: alice@example.com</p>',
		'<script>"SMS verification code"</script>',
		'<template>SMS verification code</template>',
		'<details><summary>Other ways to verify</summary><p>SMS verification code</p></details>',
		'<section><p>SMS verification code</p><input name="username"></section>',
		'<section><p>SMS verification code</p><label>Account<input name="username"></label></section>',
	])('keeps authenticator filling available beside unrelated or inactive content: %s', (content) => {
		const form = document.createElement('form');
		form.innerHTML = `<p>Enter your authenticator code.</p>${content}`;
		document.body.append(form);
		const input = appendInput({ 'aria-label': 'Authenticator code', autocomplete: 'one-time-code' }, form);
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', target: { selection: 'unique', channelAmbiguous: false } });
		expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
		expect(input.value).toBe('012345');
	});

	// On an authenticator page, a button that sends the first code offers SMS as
	// another method; only a resend would mean the current code was delivered.
	it.each(['<button type="button">Send verification code via SMS</button>', '<div role="button">Send verification code via SMS</div>'])(
		'keeps an authenticator page unique beside a code-sending button: %s',
		(content) => {
			const form = document.createElement('form');
			form.innerHTML = `<p>Enter your authenticator code.</p>${content}`;
			document.body.append(form);
			const input = appendInput({ 'aria-label': 'Authenticator code', autocomplete: 'one-time-code' }, form);
			const detection = detectOtpTarget(document);
			expect(detection).toMatchObject({ status: 'ready', target: { selection: 'unique', channelAmbiguous: false } });
			expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
			expect(input.value).toBe('012345');
		},
	);

	it.each(['<button type="button">Resend verification code via SMS</button>', '<div role="button">Resend SMS</div>'])(
		'still requires explicit focus beside a resend button on an authenticator page: %s',
		(content) => {
			const form = document.createElement('form');
			form.innerHTML = `<p>Enter your authenticator code.</p>${content}`;
			document.body.append(form);
			const input = appendInput({ 'aria-label': 'Authenticator code', autocomplete: 'one-time-code' }, form);
			expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
			input.focus();
			const selected = detectOtpTarget(document, { focusedInput: input });
			expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
			expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
		},
	);

	it('does not borrow a delivery hint from another form or the page body', () => {
		document.body.innerHTML =
			'<p>SMS verification code</p><form id="other"><p>Email verification code</p></form><form id="otp-form"></form>';
		const input = appendInput({ autocomplete: 'one-time-code' }, document.getElementById('otp-form'));
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
		input.remove();
		appendInput({ autocomplete: 'one-time-code' });
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});

	it('does not promote an unrelated input solely because a nearby hint mentions an SMS code', () => {
		const form = document.createElement('form');
		form.innerHTML = '<p>Enter the verification code sent via SMS.</p>';
		document.body.append(form);
		appendInput({ name: 'username', autocomplete: 'username' }, form);
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it.each(['before filling', 'beforeinput', 'input', 'change'])(
		'rejects a delivery-channel change %s and keeps only a delivered code',
		(phase) => {
			const form = document.createElement('form');
			form.innerHTML = '<p>Enter your authenticator code.</p>';
			document.body.append(form);
			const input = appendInput({ autocomplete: 'one-time-code' }, form);
			const changeChannel = () => {
				form.querySelector('p').textContent = 'Enter the verification code sent via SMS.';
			};
			const { target } = detectOtpTarget(document);
			if (phase === 'before filling') {
				changeChannel();
			} else {
				input.addEventListener(phase, changeChannel, { once: true });
			}
			const delivered = ['input', 'change'].includes(phase);
			const result = fillOtpTarget(target, '012345');
			expect(result).toMatchObject({ status: 'failed' });
			expect(Boolean(result.codeDelivered)).toBe(delivered);
			// The page already handled the complete code in its input event.
			expect(input.value).toBe(delivered ? '012345' : '');
		},
	);

	it('invalidates an explicitly selected SMS target if its delivery channel changes to email', () => {
		const form = document.createElement('form');
		form.innerHTML = '<p>Enter your SMS verification code.</p>';
		document.body.append(form);
		const input = appendInput({ autocomplete: 'one-time-code' }, form);
		input.focus();
		const { target } = detectOtpTarget(document, { focusedInput: input });
		form.querySelector('p').textContent = 'Enter your email verification code.';
		expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed', reason: 'target_changed' });
		expect(input.value).toBe('');
	});

	it.each(['before filling', 'beforeinput', 'input', 'change'])(
		'keeps segmented targets guarded when instructions outside the group change %s',
		(phase) => {
			const form = document.createElement('form');
			form.innerHTML = '<p>Enter your authenticator code.</p><a href="#sms">Send a code via SMS</a>';
			document.body.append(form);
			const inputs = appendSegmentedGroup(6);
			form.append(inputs[0].parentElement);
			const { target } = detectOtpTarget(document);
			const changeChannel = () => {
				form.querySelector('p').textContent = 'Enter the verification code sent via SMS.';
			};
			if (phase === 'before filling') {
				changeChannel();
			} else {
				inputs[0].addEventListener(phase, changeChannel, { once: true });
			}
			expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed' });
			expect(inputs.map((field) => field.value).join('')).toBe('');
			expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
			inputs[0].focus();
			const selected = detectOtpTarget(document, { focusedInput: inputs[0] });
			expect(selected.target.selection).toBe('focused');
			expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
		},
	);

	it('allows explicit focused fallback for an unlabelled segmented group beside SMS instructions', () => {
		const form = document.createElement('form');
		form.innerHTML = '<p>Enter the verification code sent via SMS.</p>';
		document.body.append(form);
		const inputs = appendSegmentedGroup(6);
		const group = inputs[0].parentElement;
		group.removeAttribute('aria-label');
		form.append(group);
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
		inputs[0].focus();
		const selected = detectOtpTarget(document, { focusedInput: inputs[0] });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'fallback' } });
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
		expect(inputs.map((field) => field.value).join('')).toBe('012345');
	});

	it('does not treat a short security-code field or unrelated single-character fields as OTP', () => {
		appendInput({ 'aria-label': 'Security code', maxlength: '3' });
		for (let index = 0; index < 6; index += 1) {
			appendInput({ maxlength: '1', name: `unrelated-${index}` });
		}
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('rejects a credit-card security field without maxlength', () => {
		appendInput({ 'aria-label': 'Security code', autocomplete: 'cc-csc' });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('does not merge separated single-character fields into one region', () => {
		const group = document.createElement('div');
		group.setAttribute('aria-label', 'Authenticator verification code');
		document.body.append(group);
		for (let index = 0; index < 6; index += 1) {
			appendInput({ maxlength: '1' }, group);
			if (index === 2) {
				appendInput({ 'aria-label': 'Unrelated text field' }, group);
			}
		}
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});

	it('stops when beforeinput is cancelled', () => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		input.addEventListener('beforeinput', (event) => event.preventDefault());
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });

		expect(fillOtpTarget(target, '123456')).toEqual({
			status: 'failed',
			reason: 'beforeinput_cancelled',
		});
		expect(input.value).toBe('');
	});

	it('rolls back segmented fields when a later field rejects beforeinput', () => {
		const inputs = appendSegmentedGroup(6);
		inputs[2].addEventListener('beforeinput', (event) => event.preventDefault());
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });

		expect(fillOtpTarget(target, '123456')).toEqual({
			status: 'failed',
			reason: 'beforeinput_cancelled',
		});
		expect(inputs.map((input) => input.value)).toEqual(['', '', '', '', '', '']);
	});

	it('checks code expiry again before the next digit even when the preceding target verification can be reused', () => {
		const inputs = appendSegmentedGroup(6);
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		const nextBeforeInput = vi.fn();
		inputs[1].addEventListener('beforeinput', nextBeforeInput);
		let clockChecks = 0;
		const isCodeCurrent = () => ++clockChecks < 5;

		expect(fillOtpTarget(target, '123456', { isCodeCurrent })).toEqual({ status: 'failed', reason: 'code_expired' });

		expect(clockChecks).toBe(5);
		expect(nextBeforeInput).not.toHaveBeenCalled();
		expect(inputs.every((input) => input.value === '')).toBe(true);
	});

	it('revalidates a target whose purpose changes during its native value setter and rolls back previous digits', () => {
		const inputs = appendSegmentedGroup(6);
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		const prototype = window.HTMLInputElement.prototype;
		const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
		vi.spyOn(prototype, 'value', 'set').mockImplementation(function (value) {
			nativeSetter.call(this, value);
			if (this === inputs[1] && value === '2') {
				this.setAttribute('autocomplete', 'cc-csc');
			}
		});
		const laterBeforeInput = vi.fn();
		inputs[2].addEventListener('beforeinput', laterBeforeInput);

		expect(fillOtpTarget(target, '123456')).toEqual({ status: 'failed', reason: 'target_changed' });

		expect(laterBeforeInput).not.toHaveBeenCalled();
		expect(inputs.every((input) => input.value === '')).toBe(true);
	});

	it('never submits or clicks the containing form', () => {
		const form = document.createElement('form');
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(button);
		document.body.append(form);
		const input = appendInput({ autocomplete: 'one-time-code' }, form);
		const onSubmit = vi.fn((event) => event.preventDefault());
		const onClick = vi.fn();
		form.addEventListener('submit', onSubmit);
		button.addEventListener('click', onClick);
		form.requestSubmit = vi.fn();
		form.submit = vi.fn();

		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '123456').status).toBe('filled');
		expect(onSubmit).not.toHaveBeenCalled();
		expect(onClick).not.toHaveBeenCalled();
		expect(form.requestSubmit).not.toHaveBeenCalled();
		expect(form.submit).not.toHaveBeenCalled();
		expect(input.value).toBe('123456');
	});

	it('waits for a delayed SPA input with a bounded observer', async () => {
		const waiting = waitForOtpTarget({ root: document, expectedDigits: 6, timeoutMs: 500 });
		setTimeout(() => appendInput({ autocomplete: 'one-time-code' }), 20);

		await expect(waiting).resolves.toMatchObject({ status: 'ready', kind: 'single', digits: 6 });
	});
});

describe('pages locking completed verification codes', () => {
	const lockKinds = ['disabled', 'readOnly', 'fieldset.disabled', 'aria-disabled'];
	function prepareLock(inputs, lock) {
		if (lock === 'fieldset.disabled') {
			const container = document.createElement('fieldset');
			const root = inputs.length === 1 ? inputs[0] : inputs[0].parentElement;
			root.before(container);
			container.append(root);
			return () => (container.disabled = true);
		}
		return () => inputs.forEach((input) => (lock === 'aria-disabled' ? input.setAttribute(lock, 'true') : (input[lock] = true)));
	}
	const completionCases = ['single', 'segmented'].flatMap((kind) =>
		['input', 'change'].flatMap((event) => lockKinds.map((lock) => [kind, event, lock])),
	);
	it.each(completionCases)('accepts %s fields made %s-handler %s after the complete code is received', (kind, event, lock) => {
		const inputs = kind === 'single' ? [appendInput({ autocomplete: 'one-time-code' })] : appendSegmentedGroup(6);
		const applyLock = prepareLock(inputs, lock);
		const received = [];
		inputs.at(-1).addEventListener(event, () => {
			received.push(inputs.map((input) => input.value).join(''));
			applyLock();
		});
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });

		expect(fillOtpTarget(target, '012345')).toEqual({ status: 'filled', kind, digits: 6 });
		expect(received).toEqual(['012345']);
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
		expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('not_found');
	});

	it.each(['single', 'segmented'].flatMap((kind) => lockKinds.map((lock) => [kind, lock])))(
		'still refuses %s fields made %s by beforeinput before the final write',
		(kind, lock) => {
			const inputs = kind === 'single' ? [appendInput({ autocomplete: 'one-time-code' })] : appendSegmentedGroup(6);
			inputs.at(-1).addEventListener('beforeinput', prepareLock(inputs, lock));
			const { target } = detectOtpTarget(document, { expectedDigits: 6 });
			expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed' });
			expect(inputs.at(-1).value).toBe('');
		},
	);

	it.each(['input', 'change'].flatMap((event) => lockKinds.map((lock) => [event, lock])))(
		'stops after an intermediate segmented %s event makes its fields %s',
		(event, lock) => {
			const inputs = appendSegmentedGroup(6);
			inputs[0].addEventListener(event, prepareLock(inputs, lock));
			const nextWrite = vi.fn();
			inputs[1].addEventListener('beforeinput', nextWrite);
			const { target } = detectOtpTarget(document, { expectedDigits: 6 });
			expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed' });
			expect(nextWrite).not.toHaveBeenCalled();
			expect(inputs.slice(1).every((input) => input.value === '')).toBe(true);
		},
	);

	it.each(
		lockKinds.flatMap((lock) =>
			['input', 'change'].flatMap((event) => ['purpose', 'type', 'value', 'guard'].map((change) => [lock, event, change])),
		),
	)('rejects a completed %s field whose %s handler also changes its %s', (lock, event, change) => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		const applyLock = prepareLock([input], lock);
		let authorized = true;
		input.addEventListener(event, () => {
			applyLock();
			if (change === 'purpose') {
				input.autocomplete = 'cc-csc';
			} else if (change === 'type') {
				input.type = 'password';
			} else if (change === 'value') {
				input.value = '654321';
			} else {
				authorized = false;
			}
		});
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345', { isTargetCurrent: () => authorized })).toMatchObject({
			status: 'failed',
			codeDelivered: true,
		});
	});

	it.each(['single', 'segmented'].flatMap((kind) => lockKinds.map((lock) => [kind, lock])))(
		'reports a completed %s code made %s as filled through the content message protocol',
		async (kind, lock) => {
			const inputs = kind === 'single' ? [appendInput({ autocomplete: 'one-time-code' })] : appendSegmentedGroup(6);
			inputs.at(-1).addEventListener('input', prepareLock(inputs, lock));
			const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
			try {
				expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).toMatchObject({
					ok: true,
					status: 'ready',
				});
				expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 })).toEqual({
					ok: true,
					status: 'filled',
					kind,
					digits: 6,
				});
				expect(inputs.map((input) => input.value).join('')).toBe('012345');
			} finally {
				controller.dispose();
			}
		},
	);
});

describe('pages withdrawing fields after a complete verification code', () => {
	const withdrawals = {
		removed: (root) => root.remove(),
		hidden: (root) => (root.hidden = true),
		'display none': (root) => (root.style.display = 'none'),
		replaced: (root) => {
			const replacement = root.cloneNode(true);
			for (const input of replacement.tagName === 'INPUT' ? [replacement] : replacement.querySelectorAll('input')) {
				makeVisible(input).value = '';
			}
			root.replaceWith(replacement);
		},
	};
	function appendTarget(kind) {
		const inputs = kind === 'single' ? [appendInput({ autocomplete: 'one-time-code' })] : appendSegmentedGroup(6);
		return { inputs, root: kind === 'single' ? inputs[0] : inputs[0].parentElement };
	}
	const withdrawalCases = ['single', 'segmented'].flatMap((kind) =>
		['input', 'change'].flatMap((event) => Object.keys(withdrawals).map((withdrawal) => [kind, event, withdrawal])),
	);

	it.each(withdrawalCases)('reports %s fields as filled when the final %s handler leaves them %s', (kind, event, withdrawal) => {
		const { inputs, root } = appendTarget(kind);
		const received = [];
		const finalChange = vi.fn();
		inputs.at(-1).addEventListener('change', finalChange);
		inputs.at(-1).addEventListener(event, () => {
			received.push(inputs.map((input) => input.value).join(''));
			withdrawals[withdrawal](root);
		});
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });

		expect(fillOtpTarget(target, '012345')).toEqual({ status: 'filled', kind, digits: 6 });
		expect(received).toEqual(['012345']);
		// A field withdrawn by its input handler receives no later change event.
		expect(finalChange).toHaveBeenCalledTimes(event === 'input' ? 0 : 1);
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
	});

	it.each(Object.keys(withdrawals))('still fails when an intermediate segmented input handler leaves the group %s', (withdrawal) => {
		const { inputs, root } = appendTarget('segmented');
		inputs[2].addEventListener('input', () => withdrawals[withdrawal](root));
		const nextWrite = vi.fn();
		inputs[3].addEventListener('beforeinput', nextWrite);
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		const result = fillOtpTarget(target, '012345');
		expect(result).toMatchObject({ status: 'failed', reason: 'target_changed' });
		expect(result).not.toHaveProperty('codeDelivered');
		expect(nextWrite).not.toHaveBeenCalled();
	});

	it.each(Object.keys(withdrawals))('still fails when the final beforeinput handler leaves the field %s', (withdrawal) => {
		const { inputs, root } = appendTarget('single');
		inputs[0].addEventListener('beforeinput', () => withdrawals[withdrawal](root));
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		const result = fillOtpTarget(target, '012345');
		expect(result).toMatchObject({ status: 'failed' });
		expect(result).not.toHaveProperty('codeDelivered');
		expect(inputs[0].value).toBe('');
	});

	it('does not treat one withdrawn digit of a still visible group as delivery success', () => {
		const inputs = appendSegmentedGroup(6);
		inputs.at(-1).addEventListener('input', () => (inputs.at(-1).hidden = true));
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed', reason: 'target_changed', codeDelivered: true });
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
	});

	const describedChanges = {
		label: () => (document.querySelector('label').textContent = 'Verifying…'),
		description: () => (document.getElementById('otp-help').textContent = 'Checking the code sent via SMS'),
		purpose: (inputs) => inputs.forEach((input) => input.setAttribute('autocomplete', 'cc-csc')),
		'group label': (inputs) => inputs[0].parentElement.setAttribute('aria-label', 'Recovery code'),
	};
	it.each(
		['single', 'segmented'].flatMap((kind) =>
			Object.keys(describedChanges)
				.filter((change) => kind === 'segmented' || change !== 'group label')
				.map((change) => [kind, change]),
		),
	)('does not roll back a delivered %s code after the page changes its %s', (kind, change) => {
		const help = document.createElement('p');
		help.id = 'otp-help';
		help.textContent = 'Enter the code from your authenticator app';
		document.body.append(help);
		const inputs =
			kind === 'single' ? [appendInput({ autocomplete: 'one-time-code', 'aria-describedby': 'otp-help' })] : appendSegmentedGroup(6);
		const label = document.createElement('label');
		label.textContent = 'Authenticator code';
		label.htmlFor = inputs[0].id = 'first-digit';
		document.body.prepend(label);
		if (kind === 'segmented') {
			inputs[0].parentElement.setAttribute('aria-describedby', 'otp-help');
		}
		const events = [];
		for (const input of inputs) {
			input.addEventListener('input', (event) => events.push([event.inputType, input.value]));
		}
		inputs.at(-1).addEventListener('input', () => describedChanges[change](inputs), { once: true });
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed', codeDelivered: true });
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
		expect(events.filter(([type]) => type === 'deleteContentBackward')).toEqual([]);
	});

	it.each(['012 345', '', '0123'])('reports a visible field rewritten by the page to "%s" as failed but delivered', (rewritten) => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		input.addEventListener('input', () => (input.value = rewritten));
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed', codeDelivered: true });
		expect(input.value).toBe(rewritten);
	});

	it.each(['single', 'segmented'].flatMap((kind) => Object.keys(withdrawals).map((withdrawal) => [kind, withdrawal])))(
		'reports a %s code as filled through the content protocol when its field is %s',
		async (kind, withdrawal) => {
			const { inputs, root } = appendTarget(kind);
			inputs.at(-1).addEventListener('input', () => withdrawals[withdrawal](root));
			const onCodeDelivered = vi.fn();
			const controller = createContentController({ doc: document, detectionTimeoutMs: 0, onCodeDelivered });
			try {
				expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).toMatchObject({
					ok: true,
					status: 'ready',
				});
				expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 })).toEqual({
					ok: true,
					status: 'filled',
					kind,
					digits: 6,
				});
				expect(onCodeDelivered).toHaveBeenCalledTimes(1);
			} finally {
				controller.dispose();
			}
		},
	);

	it.each([
		['a visible rewritten value', (input) => input.addEventListener('input', () => (input.value = '')), 1],
		['a cancelled beforeinput', (input) => input.addEventListener('beforeinput', (event) => event.preventDefault()), 0],
	])('notifies delivery through the content protocol only after the complete code was dispatched: %s', async (_case, prepare, calls) => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		prepare(input);
		const onCodeDelivered = vi.fn();
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0, onCodeDelivered });
		try {
			await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 });
			expect(
				await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 }),
			).toMatchObject({
				ok: false,
			});
			expect(onCodeDelivered).toHaveBeenCalledTimes(calls);
		} finally {
			controller.dispose();
		}
	});
});

describe('content message protocol', () => {
	it('accepts only extension-owned prepare/fill messages', async () => {
		const controller = { handle: vi.fn().mockResolvedValue({ ok: true, status: 'not_found' }) };
		const listener = createRuntimeMessageListener({ runtime: { id: 'extension-id' }, controller });
		const sendResponse = vi.fn();

		expect(listener({ type: MESSAGE.PREPARE_TARGET }, { id: 'foreign-id' }, sendResponse)).toBe(false);
		expect(listener({ type: 'OTHER' }, { id: 'extension-id' }, sendResponse)).toBe(false);
		expect(controller.handle).not.toHaveBeenCalled();

		expect(listener({ type: MESSAGE.PREPARE_TARGET }, { id: 'extension-id' }, sendResponse)).toBe(true);
		await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, status: 'not_found' }));
		expect(controller.handle).toHaveBeenCalledOnce();
	});

	it('binds a prepared target to a one-use nonce', async () => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
		await expect(controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).resolves.toEqual({
			ok: true,
			status: 'ready',
			kind: 'single',
			digits: 6,
		});

		expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 })).toEqual({
			ok: true,
			status: 'filled',
			kind: 'single',
			digits: 6,
		});
		expect(input.value).toBe('012345');
		expect((await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345' })).ok).toBe(false);
	});

	it('consumes the nonce before rejecting an invalid code', async () => {
		appendInput({ autocomplete: 'one-time-code' });
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
		await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 });

		const invalid = await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: 'not-a-code' });
		expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_CODE' } });
		const replay = await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '123456' });
		expect(replay).toMatchObject({ ok: false, error: { code: 'NONCE_INVALID' } });
	});

	it('refuses to fill when the prepared input changes purpose', async () => {
		const input = appendInput({ autocomplete: 'one-time-code' });
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
		await expect(controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).resolves.toMatchObject({
			ok: true,
			status: 'ready',
		});

		input.setAttribute('autocomplete', 'cc-csc');
		input.setAttribute('aria-label', 'Security code');
		const response = await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '123456', expiresAt: Date.now() + 30000 });
		expect(response).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(input.value).toBe('');
	});

	it.each(['late delivery', 'under one second left', 'clock rollback', 'slow beforeinput', 'slow segmented input'])(
		'does not leave an expired code in the form after %s',
		async (scenario) => {
			let wallTime = 100000;
			let monotonicTime = 1000;
			const inputs = scenario === 'slow segmented input' ? appendSegmentedGroup(6) : [appendInput({ autocomplete: 'one-time-code' })];
			const controller = createContentController({
				doc: document,
				now: () => wallTime,
				monotonicNow: () => monotonicTime,
				detectionTimeoutMs: 0,
			});
			await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 });
			const expire = () => {
				wallTime = scenario === 'clock rollback' ? 99000 : scenario === 'under one second left' ? 104500 : 106000;
				monotonicTime = scenario === 'under one second left' ? 5500 : 7000;
			};
			if (scenario === 'slow beforeinput' || scenario === 'slow segmented input') {
				inputs[0].addEventListener(scenario === 'slow beforeinput' ? 'beforeinput' : 'input', expire, { once: true });
			} else {
				expire();
			}
			const message = { type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: 105000 };
			expect(await controller.handle(message)).toMatchObject({ ok: false, error: { code: 'CODE_EXPIRED' } });
			expect(inputs.every((input) => input.value === '')).toBe(true);
			expect(await controller.handle(message)).toMatchObject({ ok: false, error: { code: 'NONCE_INVALID' } });
		},
	);

	it.each([undefined, NaN, Infinity, '123456'])(
		'rejects a missing or invalid expiry %s and consumes the fill attempt',
		async (expiresAt) => {
			const input = appendInput({ autocomplete: 'one-time-code' });
			const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
			await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 });
			const message = { type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt };
			expect(await controller.handle(message)).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
			expect(await controller.handle({ ...message, expiresAt: Date.now() + 30000 })).toMatchObject({
				ok: false,
				error: { code: 'NONCE_INVALID' },
			});
			expect(input.value).toBe('');
		},
	);
});

it('requires an explicit popup confirmation to use an input focused before injection', async () => {
	appendInput({ autocomplete: 'one-time-code' });
	const selected = appendInput({ autocomplete: 'one-time-code' });
	selected.focus();
	const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
	expect((await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).status).toBe('ambiguous');
	const nonce = 'b'.repeat(36);
	expect((await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce, expectedDigits: 6, confirmFocused: true })).status).toBe('ready');
	expect((await controller.handle({ type: MESSAGE.FILL_CODE, nonce, code: '123456', expiresAt: Date.now() + 30000 })).status).toBe(
		'filled',
	);
	expect(selected.value).toBe('123456');
	controller.clearPending();
});

it('keeps payment fields excluded while allowing confirmed replacement of an existing OTP', async () => {
	const input = appendInput({ autocomplete: 'cc-csc', maxlength: 6 });
	input.focus();
	const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
	expect((await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, confirmFocused: true })).status).toBe(
		'not_found',
	);
	input.setAttribute('autocomplete', 'one-time-code');
	input.value = '654321';
	expect(
		(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: 'b'.repeat(36), expectedDigits: 6, confirmFocused: true })).status,
	).toBe('ready');
	expect(
		(await controller.handle({ type: MESSAGE.FILL_CODE, nonce: 'b'.repeat(36), code: '123456', expiresAt: Date.now() + 30000 })).status,
	).toBe('filled');
	expect(input.value).toBe('123456');
	controller.clearPending();
});

describe('replacing previously entered verification codes', () => {
	it.each(['65____', '654321', '87654321'])('replaces old segmented values %s without presenting a complete mixed code', (original) => {
		const inputs = appendSegmentedGroup(original.length);
		const state = original.split('').map((value) => (value === '_' ? '' : value));
		inputs.forEach((input, index) => {
			input.value = state[index];
		});
		const completed = [];
		inputs.forEach((input, index) =>
			input.addEventListener('input', () => {
				state[index] = input.value;
				// Simulate a controlled component re-rendering every field on each input.
				inputs.forEach((field, position) => {
					field.value = state[position];
				});
				if (state.every(Boolean)) {
					completed.push(state.join(''));
				}
			}),
		);
		const next = original.length === 6 ? '012345' : '00123456';
		const { target } = detectOtpTarget(document, { expectedDigits: original.length });
		expect(fillOtpTarget(target, next).status).toBe('filled');
		expect(inputs.map((input) => input.value).join('')).toBe(next);
		expect(completed).toEqual([next]);
	});
	it('restores the complete original segmented value when a later new digit is rejected', () => {
		const inputs = appendSegmentedGroup(6);
		const original = '654321'.split('');
		const state = [...original];
		const completed = [];
		inputs.forEach((input, index) => {
			input.value = state[index];
			input.addEventListener('input', () => {
				state[index] = input.value;
				inputs.forEach((field, position) => {
					field.value = state[position];
				});
				if (state.every(Boolean)) {
					completed.push(state.join(''));
				}
			});
		});
		inputs[2].addEventListener('beforeinput', (event) => {
			if (event.inputType === 'insertText') {
				event.preventDefault();
			}
		});
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345')).toEqual({ status: 'failed', reason: 'beforeinput_cancelled' });
		expect(inputs.map((input) => input.value)).toEqual(original);
		expect(completed).toEqual(['654321']);
	});
	it('does not overwrite values changed after preparation while a code was being fetched', () => {
		const input = appendInput({ autocomplete: 'one-time-code', value: '654321' });
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		input.value = '987';
		expect(fillOtpTarget(target, '012345').status).toBe('failed');
		expect(input.value).toBe('987');
	});
	it('keeps the original single value when replacement beforeinput is cancelled', () => {
		const input = appendInput({ autocomplete: 'one-time-code', value: '654321' });
		input.addEventListener('beforeinput', (event) => event.preventDefault());
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345').status).toBe('failed');
		expect(input.value).toBe('654321');
	});
	it('preserves values changed by the page while rolling back only its own writes', () => {
		const inputs = appendSegmentedGroup(6);
		inputs.forEach((input) => {
			input.value = '9';
		});
		inputs[0].addEventListener('input', () => {
			inputs[1].value = '8';
		});
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345').status).toBe('failed');
		expect(inputs.map((input) => input.value).join('')).toBe('989999');
	});
	it('refuses replacement if beforeinput changes an OTP into a payment field', () => {
		const input = appendInput({ autocomplete: 'one-time-code', value: '654321' });
		input.addEventListener('beforeinput', () => input.setAttribute('autocomplete', 'cc-csc'));
		const { target } = detectOtpTarget(document, { expectedDigits: 6 });
		expect(fillOtpTarget(target, '012345').status).toBe('failed');
		expect(input.value).toBe('654321');
	});
	it('does not use generic focus fallback to replace an unrelated existing password', () => {
		const input = appendInput({ autocomplete: 'current-password', type: 'password', value: 'existing-password' });
		input.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input }).status).toBe('not_found');
		expect(input.value).toBe('existing-password');
	});
	it.each([false, true])('uses generic segmented focus fallback only when the entire group is empty (existing=%s)', (existing) => {
		const group = document.createElement('div');
		group.setAttribute('role', 'group');
		document.body.append(group);
		const inputs = Array.from({ length: 6 }, () => appendInput({ maxlength: 1, inputmode: 'numeric' }, group));
		inputs[1].value = existing ? '7' : '';
		inputs[0].focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: inputs[0] }).status).toBe(existing ? 'not_found' : 'ready');
		expect(inputs[1].value).toBe(existing ? '7' : '');
	});
});

describe('explicit focus fallback exclusions', () => {
	const excludedSingles = [
		['an empty password', { type: 'password' }],
		['a current-password field', { autocomplete: 'current-password' }],
		['a new-password field', { autocomplete: 'section-login new-password' }],
		['a recovery code field', { 'aria-label': 'Recovery code' }],
		['a backup code field', { placeholder: 'Backup code' }],
		['a promo code field', { name: 'promo_code' }],
		['a coupon field', { id: 'couponCode' }],
		['a postal code field', { autocomplete: 'postal-code' }],
		['a ZIP field', { title: 'ZIP' }],
		['a Chinese recovery code field', { 'aria-label': '恢复码' }],
	];

	it.each(excludedSingles)('does not use the focus fallback for %s', (_name, attributes) => {
		const input = appendInput(attributes);
		input.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input })).toEqual({ status: 'not_found' });
		expect(input.value).toBe('');
	});

	it('does not use the focus fallback for a field labelled as a recovery code', () => {
		const label = document.createElement('label');
		label.htmlFor = 'recovery';
		label.textContent = 'Enter one of your recovery codes';
		document.body.append(label);
		const input = appendInput({ id: 'recovery' });
		input.focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input })).toEqual({ status: 'not_found' });
	});

	it.each([
		['recovery-labelled', (group) => group.setAttribute('aria-label', 'Backup code')],
		['password', (_group, inputs) => inputs.forEach((input) => input.setAttribute('type', 'password'))],
	])('does not use the focus fallback for a %s segmented group', (_name, prepare) => {
		const group = document.createElement('div');
		group.setAttribute('role', 'group');
		document.body.append(group);
		const inputs = Array.from({ length: 6 }, () => appendInput({ maxlength: 1, inputmode: 'numeric' }, group));
		prepare(group, inputs);
		inputs[0].focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: inputs[0] })).toEqual({ status: 'not_found' });
	});

	it.each([
		['a keyboard shortcut', { type: 'password' }, false],
		['a confirmed popup fill', { 'aria-label': 'Recovery code' }, true],
	])('reports no target through the content protocol for %s', async (_path, attributes, confirmFocused) => {
		const input = appendInput(attributes);
		input.focus();
		const controller = createContentController({
			doc: document,
			detectionTimeoutMs: 0,
			getExplicitFocusedInput: () => input,
		});
		try {
			expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, confirmFocused })).toEqual({
				ok: true,
				status: 'not_found',
			});
			expect(input.value).toBe('');
		} finally {
			controller.dispose();
		}
	});

	it('keeps the focus fallback for an unlabelled numeric field', async () => {
		const input = appendInput({ inputmode: 'numeric', name: 'code' });
		input.focus();
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0, getExplicitFocusedInput: () => input });
		try {
			expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).toMatchObject({
				ok: true,
				status: 'ready',
			});
			expect(
				await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 }),
			).toMatchObject({
				ok: true,
				status: 'filled',
			});
			expect(input.value).toBe('012345');
		} finally {
			controller.dispose();
		}
	});
});

describe('combined authenticator and backup code fields', () => {
	async function prepareFocused(input, confirmFocused) {
		input.focus();
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0, getExplicitFocusedInput: () => input });
		const prepared = await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, confirmFocused });
		return { controller, prepared };
	}
	const combined = [
		['aria-label', { 'aria-label': 'Authentication code or backup code' }],
		['placeholder', { placeholder: 'Enter the 6-digit code from your authenticator app or one of your recovery codes' }],
		['Chinese label', { 'aria-label': '验证码或备用码' }],
		['masked input', { type: 'password', 'aria-label': 'Authenticator code or recovery code' }],
		['masked input with OTP autocomplete', { type: 'password', autocomplete: 'one-time-code', name: 'backup_code' }],
		['uppercase 2FA label', { 'aria-label': 'Enter your 2FA code or a backup code' }],
		['authenticator app wording', { placeholder: 'Code from your authenticator app, or a recovery code' }],
		['short auth wording', { 'aria-label': 'Enter Discord Auth/Backup Code' }],
		['code from your app wording', { placeholder: 'Enter the code from your app, or a backup code' }],
	];

	it.each(combined)('fills a combined field (%s) after the user confirms the focused input', async (_name, attributes) => {
		const input = appendInput(attributes);
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
		const { controller, prepared } = await prepareFocused(input, true);
		try {
			expect(prepared).toMatchObject({ ok: true, status: 'ready', kind: 'single' });
			expect(
				await controller.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '012345', expiresAt: Date.now() + 30000 }),
			).toMatchObject({ ok: true, status: 'filled' });
			expect(input.value).toBe('012345');
		} finally {
			controller.dispose();
		}
	});

	it.each(combined)('still refuses a combined field (%s) without explicit confirmation', async (_name, attributes) => {
		const input = appendInput(attributes);
		const { controller, prepared } = await prepareFocused(input, false);
		try {
			expect(prepared).toEqual({ ok: true, status: 'not_found' });
		} finally {
			controller.dispose();
		}
	});

	it.each([
		['a recovery code field', { 'aria-label': 'Recovery code' }],
		['a 2FA recovery code field', { 'aria-label': 'Enter your 2FA recovery code' }],
		['a backup verification code field', { placeholder: 'Backup verification code' }],
		['a Chinese backup code field', { 'aria-label': '备用码' }],
		['a password field without an OTP signal', { type: 'password', name: 'pin' }],
		['a current-password field', { autocomplete: 'current-password', 'aria-label': 'Password' }],
		['an account recovery field', { 'aria-label': 'Account recovery verification code' }],
		['a gift card field', { 'aria-label': 'Gift card or verification code' }],
		['a backup code field for two-factor authentication', { 'aria-label': 'Enter a backup code for your two-factor authentication' }],
		['a backup code field for 2FA', { 'aria-label': 'Use a backup code for 2FA' }],
		['a recovery code field for MFA sign-in', { placeholder: 'Use a recovery code to sign in with MFA' }],
		['a Chinese two-step backup code field', { 'aria-label': '两步验证备用码' }],
		['a recovery code field naming its authenticator setup', { 'aria-label': 'Recovery code (from when you set up your authenticator)' }],
		['a recovery code field saved at authenticator setup', { placeholder: 'Backup code from when you set up your authenticator app' }],
		['a backup code field with an auth word elsewhere', { 'aria-label': 'Backup code for auth' }],
		['a recovery code field for an OAuth account', { 'aria-label': 'Recovery code for your OAuth/SSO account' }],
		['a recovery code field for a lost auth device', { placeholder: 'Enter a recovery code if you lost your auth or phone' }],
		['a recovery code field denying the authenticator code', { 'aria-label': 'Recovery code, not the code from your authenticator app' }],
		['a recovery code field from the authenticator setup', { 'aria-label': 'Recovery code from your authenticator setup' }],
	])('refuses %s even after the user confirms the focused input', async (_name, attributes) => {
		const input = appendInput(attributes);
		const { controller, prepared } = await prepareFocused(input, true);
		try {
			expect(prepared).toEqual({ ok: true, status: 'not_found' });
			expect(input.value).toBe('');
		} finally {
			controller.dispose();
		}
	});

	it('fills a confirmed combined segmented group', () => {
		const inputs = appendSegmentedGroup(6);
		inputs[0].parentElement.setAttribute('aria-label', 'Authenticator or backup code');
		inputs[0].focus();
		expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: inputs[0] })).toEqual({ status: 'not_found' });
		const detection = detectOtpTarget(document, { expectedDigits: 6, focusedInput: inputs[0], confirmedFocus: true });
		expect(detection).toMatchObject({ status: 'ready', target: { selection: 'fallback', confirmedFocus: true } });
		expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
	});
});

it('does not fill another unique OTP field when confirming the focused input', async () => {
	appendInput({ autocomplete: 'one-time-code' });
	const focused = appendInput({ id: 'unrelated' });
	focused.focus();
	const controller = createContentController({ doc: document, detectionTimeoutMs: 0 });
	expect((await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6, confirmFocused: true })).status).toBe(
		'not_found',
	);
});

describe('open shadow roots and same-origin frames', () => {
	it('finds a labelled OTP in an open shadow root and fills it', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		root.innerHTML = '<label id="label">Authenticator verification code</label><input aria-labelledby="label">';
		const input = makeVisible(root.querySelector('input'));
		const result = detectOtpTarget(document, { expectedDigits: 6 });
		expect(result.status).toBe('ready');
		expect(fillOtpTarget(result.target, '123456').status).toBe('filled');
		expect(input.value).toBe('123456');
	});
	it('fills segmented inputs directly inside an open shadow root', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		const inputs = Array.from({ length: 6 }, () => appendInput({ maxlength: 1, autocomplete: 'one-time-code' }, root));
		const result = detectOtpTarget(document, { expectedDigits: 6 });
		expect(result.kind).toBe('segmented');
		expect(fillOtpTarget(result.target, '123456').status).toBe('filled');
		expect(inputs.map((input) => input.value).join('')).toBe('123456');
	});
	it('rejects a shadow input whose host becomes hidden or detached', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		appendInput({ autocomplete: 'one-time-code' }, root);
		const result = detectOtpTarget(document, { expectedDigits: 6 });
		host.hidden = true;
		expect(fillOtpTarget(result.target, '123456').status).toBe('failed');
		host.remove();
		expect(fillOtpTarget(result.target, '123456').status).toBe('failed');
	});
	it('does not inspect closed shadow roots or inaccessible frames', () => {
		const host = document.createElement('div');
		document.body.append(host);
		appendInput({ autocomplete: 'one-time-code' }, host.attachShadow({ mode: 'closed' }));
		const frame = document.createElement('iframe');
		document.body.append(frame);
		Object.defineProperty(frame, 'contentDocument', {
			get: () => {
				throw new Error('Cross-origin access denied');
			},
		});
		expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('not_found');
	});
	it('waits for an OTP added later inside an open shadow root', async () => {
		const host = document.createElement('div');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		const pending = waitForOtpTarget({ root: document, expectedDigits: 6, timeoutMs: 500 });
		setTimeout(() => appendInput({ autocomplete: 'one-time-code' }, root), 20);
		expect((await pending).status).toBe('ready');
	});
});

it('never resolves a shadow ARIA label against a same-named top-document element', () => {
	const label = document.createElement('p');
	label.id = 'hint';
	label.textContent = 'Authenticator verification code';
	document.body.append(label);
	const host = document.createElement('div');
	document.body.append(host);
	const root = host.attachShadow({ mode: 'open' });
	appendInput({ 'aria-labelledby': 'hint' }, root);
	expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('not_found');
});

it('checks hidden slot ancestors for distributed light-DOM inputs', () => {
	const host = document.createElement('div');
	document.body.append(host);
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = '<div aria-hidden="true"><slot></slot></div>';
	const input = appendInput({ autocomplete: 'one-time-code' }, host);
	// Happy DOM may omit slot assignment; this property models browser distribution.
	if (!input.assignedSlot) {
		Object.defineProperty(input, 'assignedSlot', { value: root.querySelector('slot') });
	}
	expect(detectOtpTarget(document, { expectedDigits: 6 }).status).toBe('not_found');
});

describe('uppercase 2FA wording', () => {
	it.each([
		['a label', '<label for="code">2FA</label><input id="code">'],
		['an aria-label', '<input aria-label="2FA code">'],
		['a placeholder', '<input placeholder="Enter your 2FA code">'],
		['a camelCase name', '<input name="2FACode">'],
	])('detects and fills a field named by %s', (_name, html) => {
		document.body.innerHTML = html;
		const input = makeVisible(document.querySelector('input'));
		const detection = detectOtpTarget(document, { expectedDigits: 6 });
		expect(detection).toMatchObject({ status: 'ready', kind: 'single', target: { selection: 'unique' } });
		expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
		expect(input.value).toBe('012345');
	});

	it('detects a segmented group labelled "2FA code"', () => {
		const inputs = appendSegmentedGroup(6);
		inputs[0].parentElement.setAttribute('aria-label', '2FA code');
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toMatchObject({
			status: 'ready',
			kind: 'segmented',
			target: { selection: 'unique' },
		});
	});

	it.each(['Enter your 2FA recovery code', '2FA backup code', 'Disable 2FA with a recovery code'])(
		'still excludes the non-OTP field "%s"',
		(label) => {
			const input = appendInput({ 'aria-label': label });
			expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
			input.focus();
			expect(detectOtpTarget(document, { expectedDigits: 6, focusedInput: input })).toEqual({ status: 'not_found' });
		},
	);

	it('does not read 2FA inside a longer word', () => {
		appendInput({ 'aria-label': 'Model B2FA serial' });
		expect(detectOtpTarget(document, { expectedDigits: 6 })).toEqual({ status: 'not_found' });
	});
});
