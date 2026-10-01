// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { detectOtpTarget, fillOtpTarget } from '../../extension/src/content/form.js';

function renderVisible(html) {
	document.body.innerHTML = html;
	const inputs = Array.from(document.querySelectorAll('input'));
	for (const input of inputs) {
		input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 210, top: 20, width: 200 }];
	}
	return inputs;
}

function otpInput() {
	return document.querySelector('[autocomplete="one-time-code"]');
}

function expectFocusedAmbiguous(input = otpInput()) {
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
const authOtp = '<label for="otp">Authenticator code</label><input id="otp" autocomplete="one-time-code">';
const appOtp = '<label for="otp">Authentication code</label><input id="otp" autocomplete="one-time-code">';
const cnCode = '<input id="otp" placeholder="请输入验证码" autocomplete="one-time-code">';
const cnApp = '<input id="otp" placeholder="请输入身份验证器中的验证码" autocomplete="one-time-code">';
// A field whose own wording names no kind of code.
const codeOnly = '<label for="otp">Enter the 6-digit code</label><input id="otp" autocomplete="one-time-code">';
const verify = '<button type="submit">Verify</button>';
const verifyCn = '<button type="submit">验证</button>';
// A form with one sentence above the field.
const said = (text, field = singleOtp) => `<form><p>${text}</p>${field}${verify}</form>`;
// A field in a form of its own.
const own = (field) => `<form>${field}${verify}</form>`;
// A card with its own heading, the field, then an alert.
const alertCard = (notice, field = singleOtp, heading = 'Verify') =>
	`<div class="card"><h2>${heading}</h2><div class="field">${field}</div><div role="alert">${notice}</div></div>`;
// A card without a heading, named by its class and titled by its first child.
const looseCard = (notice, field = singleOtp, title = 'Security check') =>
	`<div class="verify-box"><div class="title">${title}</div><div class="field">${field}</div><p>${notice}</p></div>`;
// A block beside the input's own form.
const beside = (block, field = singleOtp, submit = verify) => `<div class="verify"><form>${field}${submit}</form>${block}</div>`;

beforeEach(() => document.body.replaceChildren());

describe("the field's own wording telling of a delivery without a channel", () => {
	it.each([
		['a label', own('<label for="otp">Enter the code we sent you</label><input id="otp" autocomplete="one-time-code">')],
		['an ARIA label', own('<input id="otp" aria-label="Code we sent you" autocomplete="one-time-code">')],
		['a title', own('<input id="otp" title="Enter the code we sent" autocomplete="one-time-code">')],
		['a Chinese placeholder', own('<input id="otp" placeholder="请输入收到的验证码" autocomplete="one-time-code">')],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a label naming Google Authenticator',
			own('<label for="otp">Enter the code displayed in Google Authenticator</label><input id="otp" autocomplete="one-time-code">'),
		],
		[
			'a label receiving the code in the authenticator app',
			own('<label for="otp">Code you received in your authenticator app</label><input id="otp" autocomplete="one-time-code">'),
		],
		[
			'a placeholder denying the delivery',
			own(
				'<label for="otp">Authentication code</label><input id="otp" placeholder="We never send this code by text" autocomplete="one-time-code">',
			),
		],
		[
			'a label denying the SMS delivery',
			own('<label for="otp">Enter the code we will never send you by SMS</label><input id="otp" autocomplete="one-time-code">'),
		],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('a help notice holding a resend and another method', () => {
	it.each([
		[
			'a resend and a recovery code link',
			alertCard('Having trouble? <button type="button">Resend</button> <a href="#b">Use a recovery code</a>'),
		],
		['a resend and another way', alertCard('Having trouble? <a href="#r">Resend code</a> <a href="#o">Try another way</a>')],
		[
			'a Chinese resend and a backup code link',
			alertCard('收不到？<a href="#r">重新发送</a> <a href="#b">使用备用码</a>', cnCode, '安全验证'),
		],
		[
			'a resend and another way in the card header',
			`<div class="card"><h2>Verify</h2><header>Having trouble? <a href="#r">Resend</a> <a href="#o">Try another way</a></header><div class="field">${singleOtp}</div></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'another method and an activation email',
			alertCard(
				'Having trouble? <a href="#a">Resend activation email</a> <a href="#o">Use another method</a>',
				authOtp,
				'Two-factor authentication',
			),
		],
		['only another method', alertCard('Having trouble? <a href="#o">Use another method</a>', appOtp, 'Two-factor authentication')],
		[
			'a resend and a support link',
			alertCard('Having trouble? <a href="#r">Resend</a> <a href="#s">Contact support</a>', appOtp, 'Two-factor authentication'),
		],
	])('fills automatically with %s on an authenticator card', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe("alerts and headers beside the input's own form", () => {
	it.each([
		['a plea for help', beside('<div role="alert">Having trouble? <a href="#r">Resend</a></div>')],
		['a Chinese plea for help', beside('<div role="alert">收不到？<a href="#r">重新发送</a></div>', cnCode, verifyCn)],
		['a header with a plea for help', beside('<header>收不到？<a href="#r">重新发送</a></header>', cnCode, verifyCn)],
		['spam folder guidance', beside('<div role="alert">Check your spam folder. <a href="#r">Resend</a></div>')],
	])('requires explicit focus with %s before a resend', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a site header with its logo and navigation',
			`<div class="wrapper"><header class="site-header"><a href="/">Logo</a> <nav><a href="/help">Help</a></nav><div role="alert">Having trouble? <a href="#r">Resend</a></div></header><form>${appOtp}${verify}</form></div>`,
		],
		[
			'a header in the page layout',
			`<div id="app"><header><div role="alert">Having trouble? <a href="#r">Resend</a></div></header><form>${appOtp}${verify}</form></div>`,
		],
		[
			'a header about an invite',
			`<div class="verify"><header>Account settings <a href="#i">Resend invite</a></header><form>${appOtp}${verify}</form></div>`,
		],
	])('fills automatically beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('future deliveries', () => {
	it.each([
		['a text with a code', "You'll get a text with a code."],
		['an email with the code', 'You will get an email with your code.'],
		['a code in the inbox', "In a moment you'll get a code in your inbox."],
		['a code via SMS', "You'll get the code via SMS."],
		['a text on a new device', "When you sign in from a new device, we'll text you a code."],
		['a code to regain access', "We'll email you a code to regain access."],
		['a code for account recovery', "We'll text you a code to confirm account recovery."],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});

	it.each([
		['an email if the app is lost', "If you can't access your authenticator app, we'll email you a code."],
		['a text if the device is lost', 'In case you lose your device, we will text you a code.'],
		['a text only if the device is lost', 'We will only text you a code if you lose your device.'],
		['an email to regain access', "If you lose your phone, we'll email you a code to regain access."],
		['an email if recovery is needed', "If you need account recovery, we'll email you a code."],
		['a text if access must be regained', 'In case you ever need to regain access, we will text you a code.'],
		['a code after scanning the QR code', "Scan the QR code and you'll get a 6-digit code."],
	])('fills automatically with %s', (_name, text) => {
		renderVisible(said(text, authOtp));
		expectUniqueFill();
	});
});

describe('warnings not to pass the code on', () => {
	it.each([
		['切勿将验证码发给陌生人'],
		['请不要把动态码发给别人'],
		['验证码仅用于登录，禁止发给第三方'],
		['请勿将验证码发送给他人'],
		['验证码请勿泄露或发给他人'],
	])('fills an authenticator field automatically with %s', (text) => {
		renderVisible(said(text, cnApp));
		expectUniqueFill();
	});

	it.each([
		['a warning beside a generic field', '验证码请勿泄露或发给他人'],
		['a delivery before the warning', '我们已将验证码发给您，请勿转发给他人'],
		['a delivery to a masked number', '验证码已发给 138****1234'],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text, cnCode));
		expectFocusedAmbiguous();
	});
});

describe('denied deliveries', () => {
	it.each([
		['never by SMS or email', 'We will never send you a code by SMS or email.', authOtp],
		['not delivered by SMS', 'This code is not delivered by SMS.', authOtp],
		['我们不会通过短信发送验证码', '我们不会通过短信发送验证码', cnApp],
		['验证码不会通过邮件发送', '验证码不会通过邮件发送', cnApp],
		['never by email or text', 'We will never send you a code by email or text.', authOtp],
	])('fills automatically with %s', (_name, text, field) => {
		renderVisible(said(text, field));
		expectUniqueFill();
	});

	it.each([
		['a contrast', 'Your code was not sent by email but by SMS.'],
		['only a further delivery denied', '验证码已发送，我们不会再次发送', cnCode],
		['a delivery before the denial', 'We sent a code to your phone and will never email it.'],
		['a denial of another channel', "We don't send codes by email, check your text messages."],
		['sharing forbidden', 'Do not share the code sent to your phone.'],
	])('requires explicit focus with %s', (_name, text, field = singleOtp) => {
		renderVisible(said(text, field));
		expectFocusedAmbiguous();
	});
});

describe('resends of an account email', () => {
	it.each([
		['in a card alert', alertCard('Problems signing in? <a href="#a">Resend activation link</a>', authOtp, 'Two-factor authentication')],
		['in a Chinese card alert', alertCard('遇到问题？<a href="#a">重新发送激活邮件</a>', cnApp, '两步验证')],
		['in a loose card', looseCard('Having trouble? <a href="#c">Resend confirmation email</a>', authOtp, 'Two-factor authentication')],
		['beside the form', beside('<p>Account not active? <a href="#a">Resend activation link</a></p>', authOtp)],
		[
			'beside a field naming the authenticator',
			looseCard('Having trouble? <a href="#v">Resend verification email</a>', authOtp, 'Verify your account'),
		],
	])('fills automatically with the resend %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		[
			'an activation code field',
			looseCard(
				'Having trouble? <a href="#a">Resend activation email</a>',
				'<label for="otp">Activation code</label><input id="otp" autocomplete="one-time-code">',
				'Activate your account',
			),
		],
		['a resend naming the code', alertCard('Having trouble? <a href="#a">Resend activation code</a>')],
		['spam folder guidance', looseCard('Check your spam folder. <a href="#v">Resend verification email</a>')],
		['Chinese spam folder guidance', looseCard('请检查垃圾邮件 <a href="#v">重新发送验证邮件</a>', cnCode, '邮箱验证')],
		[
			'a field naming no kind of code',
			looseCard('Having trouble? <a href="#v">Resend verification email</a>', codeOnly, 'Verify your account'),
		],
		['a field naming no kind of code beside the form', beside('<p><a href="#v">Resend verification email</a></p>', codeOnly)],
		[
			'a field naming a two-factor code',
			alertCard('Problems signing in? <a href="#a">Resend activation link</a>', appOtp, 'Two-factor authentication'),
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	// Only the authenticator named by the field keeps the email apart: these may take the code it carries.
	it.each([['Enter the one-time code'], ['OTP'], ['Passcode'], ['Authentication code']])(
		'requires explicit focus beside a field labelled %s',
		(label) => {
			const field = `<label for="otp">${label}</label><input id="otp" autocomplete="one-time-code">`;
			renderVisible(looseCard('Having trouble? <a href="#v">Resend verification email</a>', field, 'Verify your account'));
			expectFocusedAmbiguous();
		},
	);
});

describe("account rows beside an authenticator field's form", () => {
	it.each([
		[
			'an email row',
			beside('<div class="email-row">邮箱：j***@example.com <button type="button">重新发送验证邮件</button></div>', cnApp, verifyCn),
		],
		[
			'a phone row',
			`<div class="settings"><form>${cnApp}${verifyCn}</form><div class="phone-row">手机：138****1234 <button type="button">重新发送</button></div></div>`,
		],
	])('fills automatically beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['a number alone', beside('<p>138****1234 <a href="#r">重新发送</a></p>', cnCode, verifyCn)],
		['an address alone', beside('<p>j***@example.com <a href="#r">Resend email</a></p>')],
		['a delivery to a masked number', beside('<p>Sent to +1 ***-***-1234. <a href="#r">Resend</a></p>')],
	])('requires explicit focus beside %s on a generic field', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('deliveries beside a negation, messages without the word code and plural codes', () => {
	it.each([
		['a negation in another clause', "We sent you a code, don't share it."],
		['an email not received', "Haven't received the email? Check your spam folder."],
		['an SMS asked about without a verb', 'SMS not sent? Try again.'],
		['a text message not received', 'If you have not received the text message, wait a minute.'],
		['a code on its way', "A code is on its way. We don't send codes by email."],
		['no further text for a while', "We won't text you again for 60 seconds."],
		['plural codes', "We've sent codes to your phone."],
		['a Chinese SMS not received', '短信未收到？请稍候', cnCode],
	])('requires explicit focus with %s', (_name, text, field = singleOtp) => {
		renderVisible(said(text, field));
		expectFocusedAmbiguous();
	});

	it.each([
		['a request not to send the code', 'We will never ask you to send us this code.'],
		['an emailed link', "We've emailed you a link to reset your password."],
		['a sign-in alert', "We'll email you if someone signs in from a new device."],
		['a denial with an auxiliary', "Codes aren't sent by SMS."],
		['a check of the email address', 'Check your email address below.'],
		['an approval notice', "We'll text you when your sign-in is approved."],
	])('fills automatically with %s', (_name, text) => {
		renderVisible(said(text, authOtp));
		expectUniqueFill();
	});
});

describe("a first send in a block beside the input's own form", () => {
	it.each([
		['a Send code button', beside('<div class="links"><button type="button">Send code</button></div>')],
		['a Chinese link', beside('<div class="links"><a href="#s">获取验证码</a></div>', cnCode, verifyCn)],
		['a span standing in for a button', beside('<div class="tip"><span class="send-btn">获取验证码</span></div>', cnCode, verifyCn)],
		[
			'a phone row',
			`<div class="box"><div class="phone-row"><input type="tel" placeholder="手机号"><button type="button">获取验证码</button></div><form>${cnCode}${verifyCn}</form></div>`,
		],
		// The field names no authenticator, so the send may be its own.
		['a Send code button beside an authentication code field', beside('<button type="button">Send code</button>', appOtp)],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['a send naming its channel', beside('<p>Lost access to your app? <button type="button">Send code by SMS</button></p>', appOtp)],
		[
			'a list of other methods',
			beside(
				'<div><p>Having problems?</p><ul><li><a href="#p">Use your passkey</a></li><li><button type="button">Send a code via SMS</button></li></ul></div>',
				appOtp,
			),
		],
		[
			'a send in another form',
			`<div class="box"><form>${appOtp}${verify}</form><form action="/sms"><button type="submit">Send code</button></form></div>`,
		],
		['a generic send and an authenticator field', beside('<div class="links"><button type="button">Send code</button></div>', authOtp)],
	])('fills automatically beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('clock advice after a question about a missing code', () => {
	it.each([
		['an authenticator field', "Didn't get a code? Make sure your device's time is correct.", authOtp],
		['advice naming the authenticator', "Didn't receive a code? Resync the clock in your authenticator app.", appOtp],
		['a Chinese authenticator field', '没有收到验证码？请确认手机时间是否准确', cnApp],
	])('fills automatically with %s', (_name, text, field) => {
		renderVisible(said(text, field));
		expectUniqueFill();
	});

	it('fills automatically in a card titled for the authenticator', () => {
		renderVisible(
			`<div class="card"><h2>Authenticator app</h2>${said("Didn't get a code? Make sure your device's time is correct.")}</div>`,
		);
		expectUniqueFill();
	});

	it.each([
		['nothing naming the authenticator', "Didn't get a code? Make sure the time on your phone is correct and try again."],
		['a missing SMS', "Didn't get the SMS? Make sure your phone's time is correct."],
		['the authenticator only as another way', "Didn't get a code? You can also use your authenticator app if its clock is correct."],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});
});

describe('a new code every 30 seconds', () => {
	it.each([
		["You'll get a new code every 30 seconds."],
		['Your app will get a new code every 30 seconds.'],
		['Your authenticator app will get a new code every minute.'],
	])('fills automatically with "%s"', (text) => {
		renderVisible(said(text, authOtp));
		expectUniqueFill();
	});

	it.each([
		['a request for a new code', "Didn't get it? Request a new code."],
		['a new code after a wait', 'You can get a new code in 30 seconds.'],
		['a new code every sign-in', 'Get a new code every time you sign in.'],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});
});

describe('numbers that are not a countdown', () => {
	const digits = (numbers, disabled = []) =>
		numbers.map((digit) => `<button type="button"${disabled.includes(digit) ? ' disabled' : ''}>${digit}</button>`).join('');

	it.each([
		['a keypad with one disabled key', own(`${appOtp}<div class="keypad">${digits([1, 2, 3, 4, 5, 6, 7, 8, 9, 0], [0])}</div>`)],
		[
			'pagination with the current page disabled',
			`<div class="verify"><form>${appOtp}${verify}</form><div class="pager"><button type="button">1</button><button type="button" disabled aria-current="page">2</button><button type="button">3</button></div></div>`,
		],
		[
			'pagination in list items',
			`<div class="verify"><form>${authOtp}${verify}</form><ul class="pagination"><li><button type="button">1</button></li><li><button type="button" disabled>2</button></li></ul></div>`,
		],
		[
			'disabled steps of a stepper',
			`<div class="card"><h2>Set up two-step verification</h2><div class="steps">${digits([1, 2, 3], [2, 3])}</div>${own(authOtp)}</div>`,
		],
		['a timer in a disabled button beside an authenticator field', own(`${authOtp}<button type="button" disabled>00:25</button>`)],
		['a feedback score', `<div class="verify"><form>${appOtp}${verify}</form><div><a class="send-feedback" href="#f">5</a></div></div>`],
	])('fills automatically beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['a disabled countdown', own(`${singleOtp}<button type="button" disabled>59</button>`)],
		['a countdown on a resend button', own(`${singleOtp}<button type="button" class="resend-btn">00:42</button>`)],
		['a countdown in a single list item', own(`${cnCode}<ul class="actions"><li><button type="button" disabled>45</button></li></ul>`)],
		['a countdown beside an authentication code field', own(`${appOtp}<button type="button" disabled>00:59</button>`)],
		['a countdown on a resend link', own(`${singleOtp}<a class="resend-link" href="#r">59</a>`)],
		['a countdown on a send-message key', own(`${cnCode}<a class="send-message" href="#s">60</a>`)],
		['a countdown not marked current', own(`${singleOtp}<a class="send-code" href="#s" aria-current="false">59</a>`)],
		['a timer showing each digit in a key of its own', own(`${singleOtp}<span class="timer">${digits([5, 9], [5, 9])}</span>`)],
	])('requires explicit focus beside %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('countdowns without a unit beside segmented fields', () => {
	const boxes = (label) =>
		`<form><div class="otp" aria-label="${label}">${'<input maxlength="1" inputmode="numeric" autocomplete="one-time-code">'.repeat(6)}</div><button type="button" disabled>00:25</button></form>`;

	it('fills a group named for the authenticator automatically', () => {
		renderVisible(boxes('Authenticator code'));
		const detection = detectOtpTarget(document);
		expect(detection).toMatchObject({ status: 'ready', target: { kind: 'segmented', selection: 'unique' } });
	});

	it('requires explicit focus on a generic group', () => {
		renderVisible(boxes('Verification code'));
		expect(detectOtpTarget(document)).toEqual({ status: 'ambiguous', candidateCount: 1 });
	});
});

describe('resends of invites, welcome and account emails in a bare layout', () => {
	const app = (bar, field) => `<div id="app">${bar}<div class="content"><div class="row">${field}</div></div></div>`;

	it.each([
		['an account email resend in a top bar', app('<div class="topbar"><a href="#v">Resend verification email</a></div>', authOtp)],
		['an invite resend in a toolbar', app('<div class="toolbar"><button type="button">Resend invite</button></div>', appOtp)],
		[
			'a welcome email resend in a header block',
			app('<div class="header"><span>Welcome</span> <a href="#w">Resend welcome email</a></div>', appOtp),
		],
		['a welcome email resend beside the form', beside('<a href="#w">Resend welcome email</a>', appOtp)],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['a plain resend in a top bar', app('<div class="topbar"><a href="#r">重新发送</a></div>', cnCode)],
		[
			'a verification email resend beside a verification code field',
			app('<div class="topbar"><a href="#v">Resend verification email</a></div>', singleOtp),
		],
		['a code resend in a toolbar', app('<div class="toolbar"><button type="button">Resend code</button></div>', singleOtp)],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('account rows beside a field naming the authenticator', () => {
	it.each([
		[
			'a readonly masked phone input with a resend',
			`<form><div class="row">${cnApp}</div><div class="row"><label for="tel">手机</label><input id="tel" type="tel" value="138****1234" readonly><button type="button">重新发送</button></div>${verifyCn}</form>`,
		],
		[
			'a new phone input with a countdown',
			`<div class="card"><h2>账户安全</h2><div class="row">${cnApp}</div><div class="row"><input type="tel" placeholder="新手机号"><button type="button" disabled>59s</button></div></div>`,
		],
		[
			'a text row naming the phone',
			`<div class="card"><h2>账户安全</h2><div class="row">${cnApp}</div><div class="row">手机：138****1234 <button type="button">重新发送</button></div></div>`,
		],
		[
			'a notice asking to verify the email',
			`<div class="card"><h2>账户安全</h2><div class="row">${cnApp}</div><div>邮箱尚未验证 <a href="#r">重新发送</a></div></div>`,
		],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		[
			'a readonly masked phone input on a generic field',
			`<form><div class="row"><label for="tel">手机</label><input id="tel" type="tel" value="138****1234" readonly><button type="button">重新发送</button></div><div class="row">${cnCode}</div>${verifyCn}</form>`,
		],
		[
			'a text row on a generic field',
			`<div class="card"><h2>安全验证</h2><div class="row">${cnCode}</div><div class="row">手机：138****1234 <button type="button">重新发送</button></div></div>`,
		],
		[
			'an email row resending a confirmation on an authentication code field',
			`<form><div class="row">${appOtp}</div><div class="row"><input type="email" value="j***@example.com"><button type="button">Resend confirmation</button></div>${verify}</form>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('notices about the email in a challenge that verifies the email', () => {
	const enterCode = '<input id="otp" placeholder="Enter code" autocomplete="one-time-code">';

	it.each([
		['a card titled to verify the email', looseCard('Your email is not verified. <a href="#r">Resend</a>', enterCode, 'Verify your email')],
		[
			'an alert in a card titled to confirm the email',
			alertCard('Your email is not confirmed. Having trouble? <a href="#r">Resend</a>', singleOtp, 'Confirm your email address'),
		],
		['a verification code field beside the notice', beside('<p>Email not verified. <a href="#v">Resend verification email</a></p>')],
		[
			'a confirmation code field beside the notice',
			beside(
				'<p>Please confirm your email. <a href="#r">Resend</a></p>',
				'<label for="otp">Confirmation code</label><input id="otp" autocomplete="one-time-code">',
			),
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a card titled for two-factor sign-in',
			looseCard('Your email is not verified. <a href="#r">Resend</a>', appOtp, 'Two-factor authentication'),
		],
		['an authentication code field beside the notice', beside('<p>Your email is not verified. <a href="#r">Resend</a></p>', appOtp)],
		[
			'a notice that is the first child of the card',
			`<div class="verify-box"><p>Email not verified <a href="#r">Resend</a></p><div class="field">${authOtp}</div></div>`,
		],
		['a Chinese verification code field beside the notice', beside('<p>邮箱尚未验证 <a href="#r">重新发送</a></p>', cnApp, verifyCn)],
		[
			'a verification code field in a page layout beside a site banner',
			`<div id="app"><p class="banner">Email not verified. <a href="#v">Resend verification email</a></p><form>${singleOtp}${verify}</form></div>`,
		],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('getting the code by a channel in the present tense', () => {
	it.each([
		['a code by text message', said('You can also get a code by text message.')],
		['the code via email', said('Get your code via email.')],
		['a text with a code', said('You can also get a text with a code.')],
		['a code by SMS in Chinese', said('也可以通过短信获取验证码', cnCode)],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['a code by text message beside an authenticator field', said('You can also get a code by text message.', authOtp)],
		['a text about unusual sign-ins', said('You can get an SMS from us about unusual sign-ins.', appOtp)],
		['recovery codes by email in Chinese', said('也可以通过邮件获取恢复码', cnApp)],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('a caption div before the field naming the authenticator', () => {
	// An Ant Design Mobile Form.Item: the caption is a div in the item's prefix
	// slot, the send button sits in its extra slot.
	const admItem = (caption, input, extra) =>
		`<form class="adm-form"><div class="adm-list-item adm-form-item"><div class="adm-list-item-content"><div class="adm-list-item-content-prefix"><div class="adm-form-item-label">${caption}</div></div><div class="adm-list-item-content-main"><div class="adm-form-item-child"><div class="adm-input">${input}</div></div></div><div class="adm-list-item-content-extra">${extra}</div></div></div><button type="submit">登录</button></form>`;
	const row = (caption, input, extra, captionClass = 'form-label') =>
		`<form><div class="form-item"><div class="${captionClass}">${caption}</div><div class="form-control">${input}</div>${extra}</div>${verify}</form>`;
	const dynamic = '<input id="otp" placeholder="请输入 6 位动态码" autocomplete="one-time-code">';
	const getCode = '<button type="button">获取验证码</button>';

	it.each([
		['an Ant Design Mobile prefix', admItem('身份验证器', dynamic, getCode)],
		['a caption naming a security token', admItem('安全令牌', dynamic, getCode)],
		[
			'a form-label div',
			row('Authenticator code', '<input id="otp" autocomplete="one-time-code">', '<button type="button">Send code</button>'),
		],
	])('fills automatically with %s beside a generic send', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['a generic caption', admItem('验证码', cnCode, getCode)],
		['a caption naming both the authenticator and SMS', admItem('身份验证器或短信验证码', dynamic, getCode)],
		['a tip that is no caption', row('请使用身份验证器或短信获取验证码', cnCode, getCode, 'tip')],
		['a long caption', row('如未安装身份验证器，请点击获取验证码通过短信接收', cnCode, getCode)],
		['a caption naming an SMS token', admItem('短信令牌', dynamic, getCode)],
	])('requires explicit focus with %s beside a generic send', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('help blocks beside a card are no accordion items', () => {
	const sendRow = `<div class="row">${singleOtp}<button type="button">Send code</button></div>`;

	it.each([
		['a help block', 'box help', '<h3>Contact us by email</h3><p>support@example.com</p>'],
		['a support block', 'box support', '<h3>Email support</h3><p>support@example.com</p>'],
	])('fills automatically beside %s sharing the card class', (_name, helpClass, help) => {
		renderVisible(
			`<div class="wrap"><div class="box"><h2>Authenticator app</h2>${sendRow}</div><div class="${helpClass}">${help}</div></div>`,
		);
		expectUniqueFill();
	});

	it.each([
		[
			'a collapsed authenticator item classed as help',
			`<form><div class="box help"><h4>Authenticator app</h4></div><div class="box"><h4>Text message</h4>${sendRow}</div></form>`,
		],
		[
			'an open text message item classed as help',
			`<form><div class="box"><h4>Authenticator app</h4></div><div class="box help"><h4>Text message</h4>${sendRow}</div></form>`,
		],
	])('requires explicit focus in an accordion with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('future deliveries without a channel and deliveries to a destination', () => {
	it.each([
		['a code shortly', said("You'll get a code shortly.")],
		['a code within a minute', said('You should get a code within a minute.')],
		['a code on the phone', said("You'll get a code on your phone.")],
		['a code at a masked address', said("You'll get a code at j***@example.com.")],
		['the code on the phone in the present tense', said('You can get the code on your phone.')],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['a code after scanning the QR code', said("Scan the QR code and you'll get a 6-digit code.")],
		['a code from the app on the phone', said("Open the authenticator app on your phone and you'll get a code.")],
		['a new code every 30 seconds', said("You'll get a new code every 30 seconds.", appOtp)],
	])('fills automatically with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('requests for a new code at intervals', () => {
	it.each([
		['a request every 60 seconds', 'You can request a new code every 60 seconds.'],
		['asking for a new code once a minute', 'You can ask for a new code once every 60 seconds.'],
		['new codes requested every 2 minutes', 'New codes can be requested every 2 minutes.'],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});

	it('fills automatically when the authenticator gets a new code every minute', () => {
		renderVisible(said('Your authenticator app will get a new code every minute.', authOtp));
		expectUniqueFill();
	});
});

describe('conditions about the code rather than a lost device', () => {
	it.each([
		['a text not found', "If you can't find the text, we'll text you another code."],
		['a code not yet there', "If you don't have the code yet, we'll text you a new one."],
		['a message not found', "If you can't find it, we'll email you a new code."],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});

	it.each([
		['a lost phone', "Keep your phone safe. If you lose it, we'll email you a code."],
		['an app out of reach', "If you can't access your authenticator app, we'll email you a code."],
	])('fills automatically with %s', (_name, text) => {
		renderVisible(said(text, authOtp));
		expectUniqueFill();
	});
});

describe('codes that failed to go', () => {
	it.each([
		['a code that did not send', "Code didn't send? Try again."],
		['a code that was not sent', "The code wasn't sent? Request another."],
		['a new code not sent yet', "We can't send a new code yet."],
	])('requires explicit focus with %s', (_name, text) => {
		renderVisible(said(text));
		expectFocusedAmbiguous();
	});

	it.each([
		['codes denied a channel', "Codes aren't sent by SMS."],
		['new codes denied a channel', 'We never send new codes by email.'],
		['a code denied a channel', "We won't send you a code by SMS."],
	])('fills automatically with %s', (_name, text) => {
		renderVisible(said(text, authOtp));
		expectUniqueFill();
	});
});

describe('a code that cannot be received', () => {
	it.each([['收不到验证码？请稍后重试'], ['收不到验证码？请确认手机号是否正确']])('requires explicit focus with %s', (text) => {
		renderVisible(said(text, cnCode));
		expectFocusedAmbiguous();
	});

	it('fills automatically beside advice to sync the authenticator', () => {
		renderVisible(said('收不到验证码？请同步身份验证器时间', cnApp));
		expectUniqueFill();
	});
});
