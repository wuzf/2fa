// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { detectOtpTarget, fillOtpTarget } from '../../extension/src/content/form.js';
import { createContentController } from '../../extension/src/content/index.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

function appendSegmentedForm({ hint = 'Authenticator verification code', autocomplete = true, extra = '' } = {}) {
	document.body.innerHTML = `<form><p>${hint}</p>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}${extra}</form>`;
	const inputs = Array.from(document.querySelectorAll('input'));
	for (const input of inputs) {
		if (autocomplete) {
			input.autocomplete = 'one-time-code';
		}
		input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
	}
	return inputs;
}

beforeEach(() => document.body.replaceChildren());

describe('segmented OTP fieldset legends outside layout wrappers', () => {
	function appendFieldset({ digits = 6, legend = 'Authenticator verification code', autocomplete = false, extra = '' } = {}) {
		document.body.innerHTML = `<form><fieldset><legend>${legend}</legend><div class="flex gap-2"><div>${'<input maxlength="1" inputmode="numeric">'.repeat(digits)}</div></div>${extra}</fieldset></form>`;
		const inputs = Array.from(document.querySelectorAll('input[maxlength="1"]'));
		for (const input of document.querySelectorAll('input')) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 }];
		}
		if (autocomplete) {
			inputs[0].autocomplete = 'one-time-code';
		}
		return inputs;
	}

	it.each([6, 8])('detects and fills %i nested digits using the fieldset legend', (digits) => {
		const inputs = appendFieldset({ digits });
		const detection = detectOtpTarget(document, { expectedDigits: digits });
		expect(detection).toMatchObject({ status: 'ready', kind: 'segmented', digits, target: { selection: 'unique' } });
		const code = digits === 6 ? '012345' : '00123456';
		expect(fillOtpTarget(detection.target, code)).toEqual({ status: 'filled', kind: 'segmented', digits });
		expect(inputs.map((input) => input.value).join('')).toBe(code);
	});

	it.each([6, 8])('excludes %i recovery digits despite autocomplete and explicit focus', (digits) => {
		const inputs = appendFieldset({ digits, legend: 'Recovery code', autocomplete: true });
		expect(detectOtpTarget(document, { expectedDigits: digits })).toEqual({ status: 'not_found' });
		inputs[0].focus();
		expect(detectOtpTarget(document, { expectedDigits: digits, focusedInput: inputs[0] })).toEqual({ status: 'not_found' });
	});

	it('keeps an outer SMS legend ambiguous even when it is beyond nearby hint traversal', () => {
		const inputs = appendFieldset({ legend: 'SMS verification code' });
		const group = inputs[0].parentElement;
		group.innerHTML = `<div><div><div>${group.innerHTML}</div></div></div>`;
		for (const input of group.querySelectorAll('input')) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 }];
		}
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	it.each([
		'<div><label for="other">Recovery code</label><input id="other"></div>',
		'<fieldset><legend>Recovery code</legend><input></fieldset>',
		'<a href="/recovery">Use a recovery code instead</a>',
		'<div hidden>Recovery code</div>',
	])('does not inherit an unrelated region from the enclosing fieldset: %s', (extra) => {
		const inputs = appendFieldset({ extra });
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
		expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
	});

	it.each(['hidden', 'style="display:none"', 'aria-hidden="true"', 'role="button"'])(
		'does not infer OTP from an inactive or action legend (%s)',
		(attributes) => {
			appendFieldset();
			document.querySelector('legend').outerHTML = `<legend ${attributes}>Authenticator verification code</legend>`;
			expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
		},
	);

	it('ignores alternative actions inside a legend', () => {
		appendFieldset({ legend: 'Enter the code <a href="/authenticator">Use an authenticator code instead</a>' });
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it('does not borrow the legend of a more distant fieldset', () => {
		const inputs = appendFieldset({ legend: 'Enter the code' });
		const outer = document.createElement('fieldset');
		outer.innerHTML = '<legend>Authenticator verification code</legend>';
		const inner = document.querySelector('fieldset');
		inner.replaceWith(outer);
		outer.append(inner);
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
		inputs[0].focus();
		expect(detectOtpTarget(document, { focusedInput: inputs[0] })).toMatchObject({ status: 'ready', target: { selection: 'fallback' } });
	});

	it.each(['before filling', 'beforeinput', 'input', 'change'])(
		'rejects a legend switching to recovery code %s and rolls back owned digits',
		(phase) => {
			const inputs = appendFieldset({ autocomplete: true });
			const { target } = detectOtpTarget(document);
			const switchChallenge = () => {
				document.querySelector('legend').textContent = 'Recovery code';
			};
			if (phase === 'before filling') {
				switchChallenge();
			} else {
				inputs[0].addEventListener(phase, switchChallenge, { once: true });
			}
			expect(fillOtpTarget(target, '012345')).toMatchObject({ status: 'failed' });
			expect(inputs.map((input) => input.value).join('')).toBe('');
			expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
		},
	);

	it('prepares and fills wrapped fields through the content protocol without explicit focus', async () => {
		const inputs = appendFieldset();
		const nonce = '0123456789abcdef0123456789abcdef0123';
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0, getExplicitFocusedInput: () => null });
		try {
			expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce, expectedDigits: 6 })).toMatchObject({
				ok: true,
				status: 'ready',
				kind: 'segmented',
			});
			expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce, code: '012345', expiresAt: Date.now() + 30000 })).toMatchObject({
				ok: true,
				status: 'filled',
			});
			expect(inputs.map((input) => input.value).join('')).toBe('012345');
		} finally {
			controller.dispose();
		}
	});
});

describe('delivery context of an inherited fieldset legend', () => {
	const digits = '<input maxlength="1" inputmode="numeric">'.repeat(6);
	function render(html) {
		document.body.innerHTML = html;
		const inputs = Array.from(document.querySelectorAll('input[maxlength="1"]'));
		for (const input of inputs) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 }];
		}
		return inputs;
	}
	const fieldset = (legend) => `<fieldset><legend>${legend}</legend><div class="flex gap-2"><div>${digits}</div></div></fieldset>`;

	it.each([
		'<p>We sent a verification code to your phone.</p>',
		'<p>验证码已发送至 138****1234</p>',
		'<p>We sent the code to a***@example.com</p>',
	])('reads delivery instructions beside the fieldset: %s', (outside) => {
		const inputs = render(`<form>${outside}${fieldset('Verification code')}</form>`);
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
		inputs[0].focus();
		expect(detectOtpTarget(document, { focusedInput: inputs[0] })).toMatchObject({
			status: 'ready',
			target: { selection: 'focused', channelAmbiguous: true },
		});
	});

	it('does not read delivery instructions outside the form around the fieldset', () => {
		render(`<p>验证码已发送至 138****1234</p><form>${fieldset('Verification code')}</form>`);
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});

	it.each([
		'Verification code <button type="button">重新发送短信</button>',
		'Verification code <a href="#resend">Resend SMS in 30s</a>',
		'Verification code <span role="button">Resend code to your email</span>',
	])('treats a resend action inside the legend as delivery-channel evidence: %s', (legend) => {
		render(`<form>${fieldset(legend)}</form>`);
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	it.each(['<button type="button">重新发送短信</button>', '<a href="#resend">Resend code to your email</a>'])(
		'uses a resend action in the legend when the fieldset is beyond nearby traversal: %s',
		(action) => {
			const wrapped = `<div><div><div><div><div>${digits}</div></div></div></div></div>`;
			render(`<form><fieldset><legend>Verification code ${action}</legend>${wrapped}</fieldset></form>`);
			expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
		},
	);

	it.each([
		['a countdown in the legend text', 'Authenticator verification code (59s)', 'Authenticator verification code (58s)', 'filled'],
		['a countdown in a legend resend action', 'Code <a>Resend SMS in 30s</a>', 'Code <a>Resend SMS in 29s</a>', 'filled'],
		['a masked destination', 'Code sent to 138****1234', 'Code sent to 139****5678', 'filled'],
		['a channel change', 'Authenticator verification code', 'SMS verification code', 'failed'],
		['a recovery challenge', 'Authenticator verification code', 'Recovery code', 'failed'],
	])('fingerprints only the legend signal classes across %s', (_change, before, after, status) => {
		const inputs = render(`<form>${fieldset(before)}</form>`);
		inputs[0].focus();
		const detection = detectOtpTarget(document, { focusedInput: inputs[0] });
		expect(detection.status).toBe('ready');
		document.querySelector('legend').innerHTML = after;
		expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status });
	});
});

describe('channel words when only one-time-code autocomplete marks the OTP', () => {
	const digits = '<input maxlength="1" autocomplete="one-time-code">'.repeat(6);
	function render(html) {
		document.body.innerHTML = html;
		const inputs = Array.from(document.querySelectorAll('input'));
		for (const input of inputs) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
		}
		return inputs;
	}

	it.each(['短信验证', 'SMS verification', 'Email verification', '邮箱验证', 'Text message'])(
		'requires explicit focus for a segmented group under the legend "%s"',
		(legend) => {
			const inputs = render(`<form><fieldset><legend>${legend}</legend><div><div>${digits}</div></div></fieldset></form>`);
			expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
			inputs[0].focus();
			expect(detectOtpTarget(document, { focusedInput: inputs[0] })).toMatchObject({
				status: 'ready',
				target: { selection: 'focused', channelAmbiguous: true },
			});
		},
	);

	it.each(['SMS verification', '短信验证'])('requires explicit focus for a single field labelled "%s"', (label) => {
		render(`<form><input aria-label="${label}" autocomplete="one-time-code"></form>`);
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	it.each(['Two-step verification', '两步验证', 'Verify it is you'])('keeps a channel-free legend "%s" unique', (legend) => {
		render(`<form><fieldset><legend>${legend}</legend><div><div>${digits}</div></div></fieldset></form>`);
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});

	it('keeps a push-device legend unique', () => {
		render(
			`<form><fieldset><legend>Approve the push on your phone or enter a code</legend><div><div>${digits}</div></div></fieldset></form>`,
		);
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});
});

describe('resend actions and push notifications outside the current challenge', () => {
	function render(html) {
		document.body.innerHTML = html;
		const inputs = Array.from(document.querySelectorAll('input'));
		for (const input of inputs) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
		}
		return inputs;
	}
	const single = '<label for="otp">Authentication code</label><input id="otp" autocomplete="one-time-code">';

	it.each([
		`<div id="app"><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><div class="page"><div class="card">${single}</div></div></div>`,
		`<div id="app"><header><div><button type="button">Resend SMS</button></div></header><main><section><div>${single}</div></section></main></div>`,
		`<div id="app"><form id="other"><button type="button">Resend SMS</button></form><div><div>${single}</div></div></div>`,
	])('keeps a single authenticator field unique beside a resend action outside its block: %s', (html) => {
		render(html);
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});

	it.each([
		`<div class="card"><p>Enter the code</p>${single}<button type="button">Resend SMS</button></div>`,
		`<div class="card"><div class="row">${single}</div><div class="links"><a href="#resend">Resend email</a></div></div>`,
		`<form><div><div><div>${single}</div></div></div><div class="actions"><button type="button">Resend SMS</button></div></form>`,
	])('still requires explicit focus beside a resend action in the same block or form: %s', (html) => {
		render(html);
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	it.each([
		'<p>We sent a push notification to your phone. Approve it, or enter the code from your authenticator app.</p>',
		'<p>Approve the sign-in request on your phone, or enter the authentication code.</p><button type="button">Resend push notification to my phone</button>',
		'<p>我们已向你的手机发送推送通知，请输入身份验证器中的验证码。</p>',
	])('keeps a single field on a push and authenticator page unique: %s', (content) => {
		render(`<form>${content}${single}</form>`);
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	});

	it.each([
		'We sent a push notification to your phone. Or enter the code from your authenticator app.',
		'已向你的手机推送登录通知，也可以输入身份验证器中的验证码。',
	])('keeps a segmented form on a push and authenticator page unique: %s', (hint) => {
		appendSegmentedForm({ hint, extra: '<button type="button">Resend push to my phone</button>' });
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
	});

	it.each([
		'<p>Enter the code we sent to your phone, or approve the push notification.</p>',
		'<button type="button">Resend SMS notification</button>',
	])('still treats an SMS delivery beside a push option as a channel: %s', (content) => {
		render(`<form>${content}${single}</form>`);
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});
});

describe('actions judged by the single channel-action rule', () => {
	it.each(['<a href="/lost">Lost your phone?</a>', '<a href="/lost">手机丢了？</a>', '<button type="button">Change phone number</button>'])(
		'keeps a segmented authenticator form unique beside an unrelated action: %s',
		(extra) => {
			const inputs = appendSegmentedForm({ hint: 'Enter the authentication code', extra });
			const detection = detectOtpTarget(document);
			expect(detection).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
			expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
			expect(inputs.map((input) => input.value).join('')).toBe('012345');
		},
	);

	it.each(['<a href="/lost">Lost your phone?</a>', '<a href="/lost">手机丢了？</a>'])(
		'keeps an inherited legend unique beside an unrelated action in it: %s',
		(action) => {
			document.body.innerHTML = `<form><fieldset><legend>Authenticator verification code ${action}</legend><div><div>${'<input maxlength="1">'.repeat(6)}</div></div></fieldset></form>`;
			for (const input of document.querySelectorAll('input')) {
				input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 }];
			}
			expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
		},
	);
});

describe('segmented OTP form context', () => {
	it.each([
		'<a href="/recovery"><span>Use a recovery code instead</span></a>',
		'<button type="button">Use a backup code instead</button>',
		'<span role="link">Use a recovery code instead</span>',
		'<span role="button">Use a backup code instead</span>',
		'<div hidden>Enter your recovery code</div>',
		'<div style="display:none">Enter your recovery code</div>',
	])('fills a segmented OTP alongside an unrelated alternative: %s', (extra) => {
		const inputs = appendSegmentedForm({ extra });
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
		expect(fillOtpTarget(detection.target, '012345')).toEqual({ status: 'filled', kind: 'segmented', digits: 6 });
		expect(inputs.map((input) => input.value).join('')).toBe('012345');
	});

	it('keeps a visible authenticator instruction as a positive signal without autocomplete', () => {
		appendSegmentedForm({ autocomplete: false, extra: '<a href="/recovery">Use a recovery code instead</a>' });
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
	});

	it.each(['Recovery code', 'Credit card security code'])('still excludes the actual %s instruction', (hint) => {
		appendSegmentedForm({ hint });
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it.each(['aria-labelledby', 'aria-describedby'])('retains explicit %s references to an otherwise ignored link', (attribute) => {
		appendSegmentedForm({ extra: '<a id="field-description">Recovery code</a>' });
		document.querySelector('form').setAttribute(attribute, 'field-description');
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it('retains labels describing the actual segmented fields', () => {
		appendSegmentedForm({ extra: '<label for="first-digit">Recovery code</label>' });
		document.querySelector('input').id = 'first-digit';
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it('does not mistake a link to authenticator verification for the current challenge', () => {
		appendSegmentedForm({ hint: 'Enter the code', autocomplete: false, extra: '<a>Use an authenticator code instead</a>' });
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});

	it('keeps visible SMS delivery instructions ambiguous', () => {
		appendSegmentedForm({ hint: 'Enter the verification code sent to your phone', extra: '<a>Use a recovery code instead</a>' });
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	it('prepares and fills through the content protocol without requiring explicit focus', async () => {
		const inputs = appendSegmentedForm({ extra: '<a href="/recovery">Use a recovery code instead</a>' });
		const nonce = '0123456789abcdef0123456789abcdef0123';
		const controller = createContentController({ doc: document, detectionTimeoutMs: 0, getExplicitFocusedInput: () => null });
		try {
			expect(await controller.handle({ type: MESSAGE.PREPARE_TARGET, nonce, expectedDigits: 6 })).toMatchObject({
				ok: true,
				status: 'ready',
				kind: 'segmented',
				digits: 6,
			});
			expect(await controller.handle({ type: MESSAGE.FILL_CODE, nonce, code: '012345', expiresAt: Date.now() + 30000 })).toEqual({
				ok: true,
				status: 'filled',
				kind: 'segmented',
				digits: 6,
			});
			expect(inputs.map((input) => input.value).join('')).toBe('012345');
		} finally {
			controller.dispose();
		}
	});
});

describe('segmented OTP actions naming the current delivery channel', () => {
	const resendActions = [
		'<button type="button">Resend SMS</button>',
		'<a href="#resend">Send the code by text message again</a>',
		'<button type="button">Resend code to your email</button>',
		'<a href="#resend">重新发送短信</a>',
		'<span role="button">Resend SMS</span>',
		'<span role="link">Re-send the code to your phone</span>',
	];

	it.each(resendActions)('requires explicit focus beside a resend action: %s', (extra) => {
		const inputs = appendSegmentedForm({ hint: 'Enter the 6-digit verification code', extra });
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
		inputs[0].focus();
		const selected = detectOtpTarget(document, { focusedInput: inputs[0] });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});

	it.each(['<button type="button">Resend SMS</button>', '<a href="#resend">重新发送短信</a>'])(
		'requires explicit focus when a resend action is beside a smaller OTP group: %s',
		(extra) => {
			document.body.innerHTML = `<form><p>Enter the 6-digit verification code</p><div role="group">${'<input maxlength="1" autocomplete="one-time-code">'.repeat(6)}</div>${extra}</form>`;
			for (const input of document.querySelectorAll('input')) {
				input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
			}
			expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
		},
	);

	it('requires explicit focus when a resend action is beside a single OTP field', () => {
		document.body.innerHTML =
			'<form><p>Enter the verification code</p><input autocomplete="one-time-code"><button type="button">Resend SMS</button></form>';
		document.querySelector('input').getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});

	// The user chose this field, and the resend switching its channel leaves the
	// field as it was, so the fill goes ahead. A channel change in a delivery
	// instruction or the legend still stops it.
	it.each([
		['a countdown tick', 'Resend SMS in 29s', 'filled'],
		['a channel change', 'Resend email in 29s', 'filled'],
	])('keeps a focused target beside a resend action stable across %s', (_change, nextText, status) => {
		document.body.innerHTML =
			'<form><p>Enter the verification code</p><input autocomplete="one-time-code"><button type="button">Resend SMS in 30s</button></form>';
		const input = document.querySelector('input');
		input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('button').textContent = nextText;
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status });
	});

	it('rejects a focused target when the delivery instruction beside it switches channel', () => {
		document.body.innerHTML =
			'<form><p>We sent a code to your phone.</p><input autocomplete="one-time-code"><button type="button">Resend in 30s</button></form>';
		const input = document.querySelector('input');
		input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('p').textContent = 'We sent a code to your email.';
		expect(fillOtpTarget(selected.target, '012345')).toEqual({ status: 'failed', reason: 'target_changed' });
		expect(input.value).toBe('');
	});

	it.each([
		'<button type="button">Send a code by SMS instead</button>',
		'<a href="#email">Switch to email verification</a>',
		'<a href="#sms">改用短信验证码</a>',
		'<button type="button" hidden>Resend SMS</button>',
		'<footer><a href="#resend">Resend SMS</a></footer>',
	])('keeps unique filling beside an alternative or inactive channel action: %s', (extra) => {
		appendSegmentedForm({ extra });
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
	});

	it('does not exclude a segmented OTP because of a recovery action without "instead"', () => {
		appendSegmentedForm({ extra: '<a href="/recovery">Use a recovery code</a>' });
		expect(detectOtpTarget(document)).toMatchObject({ status: 'ready', kind: 'segmented', target: { selection: 'unique' } });
	});

	it('does not treat an authenticator action as the current challenge', () => {
		appendSegmentedForm({ hint: 'Enter the code', autocomplete: false, extra: '<a href="#totp">Use your authenticator app</a>' });
		expect(detectOtpTarget(document)).toEqual({ status: 'not_found' });
	});
});

function renderVisible(html) {
	document.body.innerHTML = html;
	const inputs = Array.from(document.querySelectorAll('input'));
	for (const input of inputs) {
		input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
	}
	return inputs;
}

function expectFocusedAmbiguous(input) {
	expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	input.focus();
	const selected = detectOtpTarget(document, { focusedInput: input });
	expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
	expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
}

function expectUniqueFill() {
	const detection = detectOtpTarget(document);
	expect(detection).toMatchObject({ status: 'ready', target: { selection: 'unique' } });
	expect(fillOtpTarget(detection.target, '012345')).toMatchObject({ status: 'filled' });
	expect(detection.target.inputs.map((input) => input.value).join('')).toBe('012345');
}

const singleOtp = '<label for="otp">Verification code</label><input id="otp" autocomplete="one-time-code">';

describe('masked destinations and texting wording', () => {
	const delivered = [
		'We texted a code to (***) ***-1234.',
		'We sent a code to ***-***-1234.',
		'We sent a code to •••• 1234.',
		'We texted you a verification code.',
		'Enter the code we sent you by text.',
		'Code we texted you',
		'We emailed you a verification code.',
		'Enter the 6-digit code sent to the number ending in 1234.',
		'请输入发送到尾号 1234 的验证码',
	];
	const unrelated = [
		'Order #1234567 was sent to your shipping address.',
		'Call us at 1-800-555-0199',
		'Need help? Call 400-123-4567 or email support@example.com',
		'Signed in as j***@example.com',
		'账号 138****0000 已开启两步验证',
		'We will send a notification to your phone',
	];

	it.each(delivered)('requires explicit focus beside the delivery instruction "%s"', (text) => {
		const [input] = renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
		expectFocusedAmbiguous(input);
	});

	it.each(delivered)('requires explicit focus for a segmented group described by "%s"', (text) => {
		const inputs = appendSegmentedForm({ hint: text });
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each(delivered)('requires explicit focus for a single field described by "%s"', (text) => {
		const [input] = renderVisible(
			`<input autocomplete="one-time-code" aria-describedby="hint"><div><div><p id="hint">${text}</p></div></div>`,
		);
		expectFocusedAmbiguous(input);
	});

	it('reads the masked destination beside a fieldset legend', () => {
		const inputs = renderVisible(
			`<form><fieldset><legend>Verification code</legend><div><div>${'<input maxlength="1">'.repeat(6)}</div></div></fieldset><p>We texted a code to (***) ***-1234.</p></form>`,
		);
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each(unrelated)('keeps a single authenticator field unique beside "%s"', (text) => {
		renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
		expectUniqueFill();
	});

	it.each(unrelated)('keeps a segmented authenticator group unique under "%s"', (text) => {
		appendSegmentedForm({ hint: `Enter the code from your authenticator app. ${text}` });
		expectUniqueFill();
	});

	it.each(unrelated)('keeps a single field described by "%s" unique', (text) => {
		renderVisible(`<input autocomplete="one-time-code" aria-describedby="hint"><p id="hint">${text}</p>`);
		expectUniqueFill();
	});
});

describe('resend actions without a channel word', () => {
	const resendActions = [
		'<button type="button">Resend text</button>',
		'<a href="#resend">Didn&#39;t get a text? Resend</a>',
		'<button type="button">重新获取</button>',
		'<button type="button" disabled>60秒后重新获取验证码</button>',
		'<button type="button">Send again</button>',
		'<a href="#resend">Resend</a>',
		'<button type="button">Get a new code</button>',
		'<input type="submit" value="Resend code">',
	];
	const otherMethods = [
		'<a href="#sms">Send a code to my phone instead</a>',
		'<a href="#sms">改用短信</a>',
		'<button type="button">Resend push notification</button>',
		'<a href="#push">Send another push</a>',
		'<a href="/recovery">Didn&#39;t get a code? Use a recovery code</a>',
		'<a href="#totp">Get a code from your authenticator app</a>',
	];

	it.each(resendActions)('requires explicit focus for a segmented group beside %s', (extra) => {
		const inputs = appendSegmentedForm({ hint: 'Enter the 6-digit code', extra });
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each(resendActions)('requires explicit focus for a single field beside %s', (action) => {
		const [input] = renderVisible(`<form>${singleOtp}<div class="actions">${action}</div></form>`);
		expectFocusedAmbiguous(input);
	});

	it.each(['<span>60秒后重新获取验证码</span>', '<p>Didn&#39;t get a text? <span>Resend in 30s</span></p>'])(
		'treats resend wording in plain text as delivery evidence: %s',
		(text) => {
			const [input] = renderVisible(`<form>${singleOtp}${text}</form>`);
			expectFocusedAmbiguous(input);
		},
	);

	it.each(otherMethods)('keeps a segmented authenticator group unique beside %s', (extra) => {
		appendSegmentedForm({ extra });
		expectUniqueFill();
	});

	it.each(otherMethods)('keeps a single authenticator field unique beside %s', (action) => {
		renderVisible(`<form>${singleOtp}<div class="actions">${action}</div></form>`);
		expectUniqueFill();
	});

	it('keeps a focused target stable while a channel-free resend countdown ticks', () => {
		const [input] = renderVisible(`<form>${singleOtp}<button type="button">重新获取(60s)</button></form>`);
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('button').textContent = '重新获取(59s)';
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});
});

describe('channel words without a delivery context', () => {
	it.each([
		'如果手机丢失，请联系客服 400-123-4567',
		'Lost your phone? Contact support by email.',
		'Your account email is j***@example.com',
		'Keep your phone nearby',
		'Update your phone number in account settings',
		'邮箱：j***@example.com',
	])('keeps an autocomplete-only segmented group unique beside "%s"', (hint) => {
		appendSegmentedForm({ hint });
		expectUniqueFill();
	});

	it.each([
		'手机验证',
		'Email verification',
		'Check your email for the code',
		'验证码已发送到你的手机',
		'Code sent via email',
		'Enter the code from your email',
		'通过短信接收验证码',
		'Enter the SMS code',
	])('still requires explicit focus for an autocomplete-only segmented group beside "%s"', (hint) => {
		const inputs = appendSegmentedForm({ hint });
		expectFocusedAmbiguous(inputs[0]);
	});
});

describe('the phone as the device running an authenticator app', () => {
	it.each([
		[
			'an aria-describedby',
			'<input autocomplete="one-time-code" aria-describedby="hint"><p id="hint">Enter the code displayed in the authenticator app on your mobile device</p>',
		],
		['a label', '<label for="otp">Code from the authenticator app on your phone</label><input id="otp" autocomplete="one-time-code">'],
		[
			'a placeholder',
			'<input autocomplete="one-time-code" placeholder="Open the Google Authenticator app on your phone and enter the 6-digit code">',
		],
	])('keeps a single authenticator field unique when %s names the phone', (_name, html) => {
		renderVisible(`<form>${html}</form>`);
		expectUniqueFill();
	});

	it.each(['请打开手机上的身份验证器，输入 6 位验证码', '打开手机令牌，输入动态码', 'Use the authenticator app on your phone'])(
		'keeps a segmented group unique under "%s"',
		(hint) => {
			appendSegmentedForm({ hint, autocomplete: false });
			expectUniqueFill();
		},
	);

	it.each([
		'Enter the code we sent to your phone, not the one from your authenticator app',
		'请输入发送到手机的短信验证码，不是身份验证器中的验证码',
		'We sent a code to your mobile. Authenticator apps are not supported.',
	])('still requires explicit focus when a separate clause sends the code to the phone: "%s"', (hint) => {
		const inputs = appendSegmentedForm({ hint });
		expectFocusedAmbiguous(inputs[0]);
	});
});

describe('resend actions in the challenge card without a form', () => {
	const field = `<div class="content"><div class="field">${singleOtp}</div></div>`;
	const digits = '<input maxlength="1" autocomplete="one-time-code">'.repeat(6);

	it.each([
		[
			'a footer button two levels up',
			`<div class="card"><h2>Two-step verification</h2>${field}<div class="footer"><button type="button">Resend SMS</button></div></div>`,
		],
		[
			'a footer link three levels up',
			`<div class="card"><h2>Two-step verification</h2><div class="body">${field}</div><div class="footer"><a href="#resend">Resend code via SMS</a></div></div>`,
		],
		[
			'an ARIA heading',
			`<div class="card"><div role="heading" aria-level="2">Verify it is you</div>${field}<div class="footer"><button type="button">Resend SMS</button></div></div>`,
		],
		['a section without a heading', `<section>${field}<div class="footer"><button type="button">Resend SMS</button></div></section>`],
	])('requires explicit focus for a single field with %s', (_name, html) => {
		const [input] = renderVisible(html);
		expectFocusedAmbiguous(input);
	});

	it('requires explicit focus for a segmented group with a resend action in the card footer', () => {
		const inputs = renderVisible(
			`<div class="card"><h2>Enter the code</h2><div class="body"><div class="content"><div class="digits">${digits}</div></div></div><div class="footer"><button type="button">Resend SMS</button></div></div>`,
		);
		expectFocusedAmbiguous(inputs[0]);
	});

	// As beside a form resend: the user chose this field, and the footer resend
	// switching its channel leaves the field as it was.
	it.each([
		['a countdown tick', 'Resend SMS in 29s', 'filled'],
		['a channel change', 'Resend email in 29s', 'filled'],
	])('keeps a focused card target stable across %s', (_change, nextText, status) => {
		const [input] = renderVisible(
			`<div class="card"><h2>Two-step verification</h2>${field}<div class="footer"><button type="button">Resend SMS in 30s</button></div></div>`,
		);
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('button').textContent = nextText;
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status });
	});

	it.each([
		[
			'a site banner outside the card',
			`<div id="app"><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><div class="page"><div class="card"><h2>Two-step verification</h2>${field}</div></div></div>`,
		],
		[
			'a banner landmark with its own heading',
			`<div id="app"><div role="banner"><h1>Acme</h1><button type="button">Resend SMS</button></div><div class="page">${field}</div></div>`,
		],
		[
			'a page header holding the heading',
			`<div class="page"><header><h1>Acme</h1><a href="#resend">Resend verification email</a></header>${field}</div>`,
		],
		[
			'an alert inside the card',
			`<div class="card"><h2>Two-step verification</h2><div role="alert">Your email address is not verified. <a href="#resend">Resend email</a></div>${field}</div>`,
		],
		[
			'a neighbouring card',
			`<div class="page"><div class="card"><h2>Recovery email</h2><a href="#resend">Resend email</a></div><div class="card"><h2>Authenticator app</h2>${field}</div></div>`,
		],
		[
			'a heading beyond the card level limit',
			`<div class="page"><h1>Account</h1><div class="notice"><a href="#resend">Resend email</a></div>${'<div>'.repeat(6)}${singleOtp}${'</div>'.repeat(6)}</div>`,
		],
		[
			'an alternative method in the card',
			`<div class="card"><h2>Two-step verification</h2>${field}<div class="footer"><a href="#sms">Send a code to my phone instead</a></div></div>`,
		],
	])('keeps a single authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('resend actions in the challenge card outside the form', () => {
	const card = (after, formExtra = '') =>
		`<div class="card"><h2>Two-step verification</h2><form action="/verify">${singleOtp}${formExtra}<button type="submit">Verify</button></form>${after}</div>`;

	it.each([
		['a resend link after the form', card('<a href="#resend">Resend SMS</a>')],
		[
			'a separate resend form',
			card(
				'<form action="/resend" method="post"><input type="hidden" name="csrf" value="token"><button type="submit">Resend SMS</button></form>',
			),
		],
		['a resend form with a submit input', card('<form action="/resend" method="post"><input type="submit" value="Resend code"></form>')],
		[
			'a resend form with a remember checkbox',
			card('<form action="/resend"><input type="checkbox" name="remember"><button>重新发送短信</button></form>'),
		],
	])('requires explicit focus for a single field with %s', (_name, html) => {
		const [input] = renderVisible(html);
		expectFocusedAmbiguous(input);
	});

	it('requires explicit focus for a segmented form with a separate resend form in the card', () => {
		const inputs = renderVisible(
			`<div class="card"><h2>Enter the code</h2><form>${'<input maxlength="1" autocomplete="one-time-code">'.repeat(6)}</form><form action="/resend"><button type="submit">Resend SMS</button></form></div>`,
		);
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each([
		[
			'a resend form outside the card',
			`<form action="/resend"><button type="submit">Resend SMS</button></form><div class="card"><h2>Two-step verification</h2><form>${singleOtp}</form></div>`,
		],
		[
			'a sibling form with another text field',
			card(
				'<form action="/phone"><label for="phone">New phone number</label><input id="phone" type="tel"><button type="submit">Resend SMS</button></form>',
			),
		],
		['an alternative method after the form', card('<a href="#sms">Send a code to my phone instead</a>')],
		[
			'a site banner beside a form without a card',
			`<div id="app"><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><form>${singleOtp}</form></div>`,
		],
	])('keeps a single authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('delivery instructions around a wrapped fieldset', () => {
	const fieldset = (legend = 'Verification code') =>
		`<div class="wrap"><fieldset><legend>${legend}</legend><div class="flex gap-2"><div>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div></div></fieldset></div>`;

	it.each([
		['a card', `<div class="card"><h2>Verify it is you</h2>${fieldset()}<p>We texted a code to (***) ***-1234.</p></div>`],
		['a form', `<form>${fieldset()}<p>验证码已发送至 138****1234</p></form>`],
		['a bare layout', `<div>${fieldset()}<p>We sent a verification code to your phone.</p></div>`],
	])('reads the delivery instruction beside the wrapper in %s', (_name, html) => {
		const inputs = renderVisible(html);
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each([
		['outside the card', `<p>验证码已发送至 138****1234</p><div class="card"><h2>Verify it is you</h2>${fieldset()}</div>`],
		['outside the form', `<p>We sent a verification code to your phone.</p><form>${fieldset()}</form>`],
		[
			'an authenticator instruction',
			`<form>${fieldset('Two-step verification')}<p>Open your authenticator app to view your code.</p></form>`,
		],
	])('keeps the wrapped fieldset unique with an instruction %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('buttons that send the first code', () => {
	const sendActions = [
		'<button type="button">获取验证码</button>',
		'<button type="button">发送验证码</button>',
		'<button type="button">获取短信验证码</button>',
		'<a href="#send">获取验证码</a>',
		'<button type="button">Send code</button>',
		'<button type="button">Get code</button>',
		'<input type="button" value="Send verification code">',
		'<input type="submit" value="Get a code">',
		'<span role="button">Text me a code</span>',
	];
	const otherMethods = [
		'<a href="#send">Send code</a>',
		'<a href="#sms">Send a code via SMS</a>',
		'<a href="#other">Try another way</a>',
		'<button type="button">Try another way</button>',
		'<a href="#sms">改用短信验证</a>',
		'<button type="button">Send code another way</button>',
		'<button type="button">Get a code from your authenticator app</button>',
		'<button type="button">在身份验证器中获取验证码</button>',
	];

	it.each(sendActions)('requires explicit focus for a segmented group beside %s', (extra) => {
		const inputs = appendSegmentedForm({ hint: 'Enter the 6-digit code', extra });
		expectFocusedAmbiguous(inputs[0]);
	});

	it.each(sendActions)('requires explicit focus for a single field beside %s', (action) => {
		const [input] = renderVisible(`<form>${singleOtp}<div class="actions">${action}</div></form>`);
		expectFocusedAmbiguous(input);
	});

	it.each(otherMethods)('keeps a segmented authenticator group unique beside %s', (extra) => {
		appendSegmentedForm({ extra });
		expectUniqueFill();
	});

	it.each(otherMethods)('keeps a single authenticator field unique beside %s', (action) => {
		renderVisible(`<form>${singleOtp}<div class="actions">${action}</div></form>`);
		expectUniqueFill();
	});

	it('requires explicit focus on an SMS login form with a phone field and a send button', () => {
		const inputs = renderVisible(
			'<form><input type="tel" placeholder="手机号"><div><input placeholder="验证码" autocomplete="one-time-code"><button type="button">获取验证码</button></div></form>',
		);
		expectFocusedAmbiguous(inputs[1]);
	});

	it('requires explicit focus for a send button in the challenge card footer', () => {
		const [input] = renderVisible(
			`<div class="card"><h2>Verify your phone</h2><div class="content"><div class="field">${singleOtp}</div></div><div class="footer"><button type="button">Send code</button></div></div>`,
		);
		expectFocusedAmbiguous(input);
	});

	it('keeps a focused target stable when the send button turns into a resend countdown', () => {
		const [input] = renderVisible(`<form>${singleOtp}<button type="button">获取验证码</button></form>`);
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('button').textContent = '60秒后重新获取';
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});

	it.each([
		['获取短信验证码', '60秒后重新获取'],
		['Send code by SMS', 'Resend in 59s'],
	])('keeps a focused target stable when "%s" turns into "%s"', (before, after) => {
		const [input] = renderVisible(`<form>${singleOtp}<button type="button">${before}</button></form>`);
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('button').textContent = after;
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});

	it.each([
		[
			'a site banner outside the card',
			`<div id="app"><div class="banner"><button type="button">Send code</button></div><div class="page"><div class="card"><h2>Two-step verification</h2><div class="content"><div class="field">${singleOtp}</div></div></div></div></div>`,
		],
		[
			'a bare layout two levels up',
			`<div id="app"><div class="tools"><button type="button">获取验证码</button></div><div class="page"><div class="content">${singleOtp}</div></div></div>`,
		],
		[
			'a TOTP card offering other methods',
			`<div class="card"><h2>Two-step verification</h2><form>${singleOtp}<button type="submit">Verify</button></form><a href="#other">Try another way</a> <a href="#sms">改用短信验证</a></div>`,
		],
	])('keeps a single authenticator field unique with a send action in %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('send buttons as backup methods on an authenticator page', () => {
	it.each([
		[
			'buttons for other channels in the card',
			`<div class="card"><h2>Two-step verification</h2><p>Enter the code from your authenticator app.</p><form>${singleOtp}<button type="submit">Verify</button></form><button type="button">Send code to my phone</button><button type="button">Text me a code</button><button type="button">Email me a code</button></div>`,
		],
		[
			'a separate SMS form',
			`<div class="card"><h2>Two-step verification</h2><form action="/verify"><p>Open your authenticator app to view your code.</p>${singleOtp}</form><form action="/sms"><button type="submit">Send me a code by text message</button></form></div>`,
		],
		[
			'a GitHub-like TOTP page with its heading outside the form',
			'<div class="auth-form"><div class="auth-form-header"><h1>Two-factor authentication</h1></div><form action="/sessions/two-factor"><div class="auth-form-body"><label for="app_totp">Authentication code</label><input id="app_totp" autocomplete="one-time-code"><p>Open your two-factor authenticator (TOTP) app or browser extension to view your authentication code.</p></div></form><form action="/sessions/two-factor/sms"><button type="submit">Send a code via SMS</button></form></div>',
		],
		[
			'a send button beside a Chinese authenticator field',
			'<form><label for="otp">身份验证器验证码</label><input id="otp" autocomplete="one-time-code"><button type="button">获取短信验证码</button></form>',
		],
		[
			'a send button in the own form of an app field',
			'<form><label for="otp">Code from your authenticator app</label><input id="otp" autocomplete="one-time-code"><button type="button">Send code</button></form>',
		],
		[
			'a first-send button in another form without authenticator wording',
			`<div class="card"><h2>Verify it is you</h2><form action="/verify">${singleOtp}</form><form action="/sms"><button type="submit">Send me a code by text message</button></form></div>`,
		],
	])('keeps a single authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		[
			'a resend in the authenticator card',
			`<div class="card"><h2>Two-step verification</h2><p>Enter the code from your authenticator app.</p><form>${singleOtp}</form><button type="button">Resend SMS</button></div>`,
		],
		[
			'a send button without authenticator wording in the own form',
			`<form>${singleOtp}<button type="button">Text me a code</button></form>`,
		],
		[
			'a send button in the adjacent block',
			`<div class="card"><h2>Verify your phone</h2><div class="row">${singleOtp}</div><div class="actions"><button type="button">Send code</button></div></div>`,
		],
	])('still requires explicit focus with %s', (_name, html) => {
		const [input] = renderVisible(html);
		expectFocusedAmbiguous(input);
	});

	it('keeps a segmented authenticator group unique beside a send button', () => {
		appendSegmentedForm({ hint: 'Enter the code from your authenticator app', extra: '<button type="button">Text me a code</button>' });
		expectUniqueFill();
	});

	it('still requires explicit focus for a segmented group beside a send button without authenticator wording', () => {
		const inputs = appendSegmentedForm({ hint: 'Enter the 6-digit code', extra: '<button type="button">Text me a code</button>' });
		expectFocusedAmbiguous(inputs[0]);
	});
});

describe('challenge cards without a heading element', () => {
	const field = `<div class="body"><div class="field">${singleOtp}</div></div>`;

	it.each([
		[
			'a Chinese title',
			`<div class="card"><div class="title">安全验证</div>${field}<div class="footer"><button type="button">重新发送短信</button></div></div>`,
		],
		[
			'an English title',
			`<div class="wrap"><p class="title">Enter verification code</p>${field}<div class="footer"><button type="button">Resend SMS</button></div></div>`,
		],
		[
			'a panel class',
			`<div class="login-panel"><div class="body">${field}</div><div class="footer"><a href="#resend">Resend SMS</a></div></div>`,
		],
		['a header inside the card', `<div class="card"><header><a href="#resend">Resend SMS</a></header>${field}</div>`],
		[
			'an alert inside the card',
			`<div class="card"><h2>Two-step verification</h2><div role="alert">Code sent. <button type="button">Resend SMS</button></div>${field}</div>`,
		],
	])('requires explicit focus with a resend action in %s', (_name, html) => {
		const [input] = renderVisible(html);
		expectFocusedAmbiguous(input);
	});

	it.each([
		[
			'a plain div site banner',
			`<div id="app"><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><div class="page"><div class="card">${singleOtp}</div></div></div>`,
		],
		[
			'a plain div notice beside a titled card',
			`<div id="app"><div class="notice"><button type="button">Resend SMS</button></div><div class="page"><div class="card"><div class="title">安全验证</div>${field}</div></div></div>`,
		],
		[
			'a site header outside the card',
			`<div id="app"><header><button type="button">Resend SMS</button></header><div class="card"><div class="title">Verify</div>${field}</div></div>`,
		],
		[
			'a first paragraph that is not a title',
			`<div class="wrap"><p>Your account settings were updated. Review them now.</p><div><div>${field}</div></div><div class="footer"><button type="button">Resend SMS</button></div></div>`,
		],
	])('keeps a single authenticator field unique with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('page regions that are not a challenge card', () => {
	// This was unique in round 6, when a first send in main counted only up to
	// three levels away. Main holds no other entry field, so the send can only
	// belong to this field wherever it sits, and nothing on the page names the
	// authenticator: the field may be the SMS one.
	it('requires explicit focus beside a send button in another column of main', () => {
		const [input] = renderVisible(
			`<main><h1>Account security</h1><div class="col"><button type="button">Send code</button></div><div class="col"><div><div><div>${singleOtp}</div></div></div></div></main>`,
		);
		expectFocusedAmbiguous(input);
	});

	it('keeps a single authenticator field unique beside a send button in a container with several forms', () => {
		renderVisible(
			`<div class="page"><h1>Settings</h1><form><label for="email">Email</label><input id="email" type="email"><button type="button">Send code</button></form><div class="gap"></div><form>${singleOtp}</form></div>`,
		);
		expectUniqueFill();
	});

	it('still requires explicit focus for a resend in a card inside main', () => {
		const [input] = renderVisible(
			`<main><h1>Account</h1><div class="card"><h2>Verify</h2><div class="field">${singleOtp}</div><div class="footer"><button type="button">Resend SMS</button></div></div></main>`,
		);
		expectFocusedAmbiguous(input);
	});

	it('keeps an alert about something else inside the card excluded', () => {
		renderVisible(
			`<div class="card"><h2>Two-step verification</h2><div role="alert">Your email address is not verified. <a href="#resend">Resend email</a></div><div class="field">${singleOtp}</div></div>`,
		);
		expectUniqueFill();
	});
});

describe('check your phone or inbox', () => {
	it.each(['Check your phone for the code.', 'Check your inbox for the code.', 'Check your email for a verification code.'])(
		'requires explicit focus beside "%s"',
		(text) => {
			const [input] = renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
			expectFocusedAmbiguous(input);
		},
	);

	it.each(['Check your authenticator app on your phone for the code.', 'Check your phone number in settings.'])(
		'keeps a single field unique beside "%s"',
		(text) => {
			renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
			expectUniqueFill();
		},
	);
});
