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
const verify = '<button type="submit">Verify</button>';
// A form with one sentence above the field.
const said = (text, field = singleOtp) => `<form><p>${text}</p>${field}${verify}</form>`;
// A card with its own heading, an alert or header in it, then the field.
const card = (chrome, field = singleOtp, heading = 'Verify') =>
	`<div class="card"><h2>${heading}</h2>${chrome}<div class="field">${field}</div></div>`;

beforeEach(() => document.body.replaceChildren());

describe("resend actions beside the input's own form", () => {
	it.each([
		['a resend link', `<div class="verify"><form>${singleOtp}${verify}</form><a href="#r">Resend code</a></div>`],
		[
			'a resend link after guidance',
			`<div class="verify"><form>${singleOtp}${verify}</form><p>Didn't get it? <a href="#r">Resend</a></p></div>`,
		],
		[
			'a Chinese resend link in a links block',
			`<div class="login-box"><form>${cnCode}<button type="submit">验证</button></form><div class="links"><a href="#r">重新发送</a></div></div>`,
		],
		['a resend countdown', `<div class="verify"><form>${singleOtp}${verify}</form><button type="button">Resend in 30s</button></div>`],
		[
			'a separate resend form',
			`<div class="verify"><form>${singleOtp}${verify}</form><form action="/resend"><button type="submit">Resend code</button></form></div>`,
		],
	])('requires explicit focus with %s beside the form', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a GitHub-like list of other methods',
			'<div class="auth-form-body"><form action="/sessions/two-factor"><label for="app_totp">Authentication code</label><input id="app_totp" autocomplete="one-time-code"><button type="submit">Verify</button><p>Open your two-factor authenticator (TOTP) app or browser extension to view your authentication code.</p></form><div class="mt-3"><p>Having problems?</p><ul><li><a href="/webauthn">Use your passkey</a></li><li><form action="/sms/request"><button type="submit">Send a code via SMS</button></form></li><li><a href="/recovery">Use a recovery code</a></li></ul></div></div>',
		],
		[
			'links to other methods',
			`<div class="verify"><form>${authOtp}${verify}</form><p><a href="#b">Use a recovery code</a> <a href="#o">Try another way</a></p></div>`,
		],
		[
			'a link offering a text message instead',
			`<div class="verify"><form>${appOtp}${verify}</form><p><a href="#s">Text me a code instead</a></p></div>`,
		],
		['a first send button', `<div class="verify"><form>${authOtp}${verify}</form><button type="button">Send code</button></div>`],
		[
			'a separate phone form with its send button',
			`<div class="settings"><form>${appOtp}${verify}</form><form><label for="tel">Phone</label><input id="tel" type="tel"><button type="button">Send code</button></form></div>`,
		],
		[
			'a resend link in the site header',
			`<div class="verify"><header><a href="/">Home</a> <a href="#r">Resend code</a></header><form>${appOtp}${verify}</form></div>`,
		],
		[
			'a resend link in the navigation',
			`<div class="verify"><nav><a href="/">Home</a> <a href="#r">Resend</a></nav><form>${appOtp}${verify}</form></div>`,
		],
		[
			'a resend link in the footer',
			`<div class="verify"><form>${appOtp}${verify}</form><footer><a href="#r">Resend code</a></footer></div>`,
		],
		[
			'a notice asking to confirm the account email',
			`<div class="verify"><div class="notice">Please confirm your email address. <a href="#r">Resend</a></div><form>${appOtp}${verify}</form></div>`,
		],
		[
			'a notice saying the email is not confirmed',
			`<div class="verify"><form>${appOtp}${verify}</form><div class="alert">Your email is not confirmed. <a href="#r">Resend</a></div></div>`,
		],
		[
			'a notice saying the email is not activated',
			`<div class="verify"><div class="notice">邮箱尚未激活 <a href="#r">重新发送激活邮件</a></div><form>${cnApp}${verify}</form></div>`,
		],
	])('keeps an authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it('keeps an authenticator field unique beside a notice saying the email is not verified in a card without a heading', () => {
		renderVisible(
			`<div class="verify-box"><div class="title">Two-factor authentication</div><div class="field">${appOtp}</div><p>Your email is not verified. <a href="#r">Resend</a></p></div>`,
		);
		expectUniqueFill();
	});
});

describe('a div named like a form without a form element', () => {
	it.each([
		[
			'a Chinese resend link beside a div.login-form',
			`<div class="login-box"><div class="login-form">${cnCode}<button type="submit">验证</button></div><a href="#r">重新发送</a></div>`,
		],
		[
			'a delivery sentence above a div.otp-form',
			`<div class="verify"><p>We sent a code to your phone.</p><div class="otp-form">${singleOtp}${verify}</div></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('deliveries announced in the future tense', () => {
	it.each([
		["We'll text you a code.", singleOtp],
		['We will email you a code.', singleOtp],
		["We'll email you a 6-digit code shortly.", singleOtp],
		['We will text a code to the number ending in 1234.', singleOtp],
		["We're going to text you a code.", singleOtp],
		["We're texting you a code.", singleOtp],
		["You'll get a code by email.", singleOtp],
		["We're going to send you a code.", singleOtp],
		['我们将向您发送验证码', cnCode],
		['稍后会收到短信验证码', cnCode],
		['我们会把验证码发给您', cnCode],
	])('requires explicit focus after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectFocusedAmbiguous();
	});

	it.each([
		'We will never text you a code.',
		"We'll never email you asking for your code.",
		"We'll email you a recovery code if you lose your phone.",
		"We'll text you when your sign-in is approved.",
		"We'll email you a receipt.",
		'We can also text you a code.',
		"You'll get a code from your authenticator app.",
		'Your code will get refreshed every 30 seconds.',
		"If your authenticator code doesn't work, check the time on your device.",
	])('keeps an authenticator field unique after "%s"', (sentence) => {
		renderVisible(said(sentence, authOtp));
		expectUniqueFill();
	});
});

describe('a delivery clause beside a clause offering another way', () => {
	it.each([
		['验证码已发送至您的邮箱，也可使用恢复码登录', cnCode],
		['验证码已发送至 138****1234，也可以使用备用码登录', cnCode],
		['验证码已通过短信发送，或者使用身份验证器登录', cnCode],
		['验证码已发送至您的手机，如未收到可切换其他方式', cnCode],
		['We sent a code to your email, or you can use a recovery code instead.', singleOtp],
		['We texted a code to your phone, alternatively, use a backup code.', singleOtp],
		['We emailed you a code, or use a recovery code.', singleOtp],
	])('requires explicit focus after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectFocusedAmbiguous();
	});

	it.each([
		['请输入身份验证器中的验证码，也可以使用短信验证码登录', cnCode],
		['请打开身份验证器查看验证码，或者改用邮箱验证', cnCode],
		['或者，我们可以通过短信发送验证码', cnApp],
		['Enter the code from your authenticator app, or get a code by SMS instead.', singleOtp],
		['Open your authenticator app, or switch to a code sent by email.', authOtp],
		['Alternatively, we can send you a code by text message.', authOtp],
		["Enter your authenticator code. Alternatively, we'll text you a code.", singleOtp],
	])('keeps the field unique after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectUniqueFill();
	});
});

describe('delivery help before a resend in an alert or header of a card', () => {
	it.each([
		['收不到？ in an alert', card('<div role="alert">收不到？<a href="#r">重新发送</a></div>', cnCode, '安全验证')],
		['"Having trouble?" in an alert', card('<div role="alert">Having trouble? <button type="button">Resend</button></div>')],
		['"Having trouble?" in a header', card('<header>Having trouble? <button type="button">Resend code</button></header>')],
		['"Didn\'t get it?" in an alert', card('<div role="alert">Didn\'t get it? <button type="button">Resend</button></div>')],
		['没收到？ in an alert', card('<div role="alert">没收到？<a href="#r">重新发送</a></div>', cnCode, '安全验证')],
		[
			'收不到？ in an alert of a card without a heading',
			`<div class="verify"><div class="title">安全验证</div><div class="field">${cnCode}</div><div role="alert">收不到？<a href="#r">重新发送</a></div></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a request to confirm the account email',
			card('<div role="alert">Please confirm your email address. <a href="#r">Resend</a></div>', appOtp, 'Two-factor authentication'),
		],
		['邮箱尚未激活', card('<div role="alert">邮箱尚未激活 <a href="#r">重新发送激活邮件</a></div>', cnApp, '两步验证')],
		[
			'"Having trouble?" before a request to confirm the account email',
			card(
				'<div role="alert">Having trouble? Please confirm your email address. <a href="#r">Resend</a></div>',
				appOtp,
				'Two-factor authentication',
			),
		],
		[
			'"Having trouble?" before another method and a resend',
			card(
				'<div role="alert">Having trouble? <a href="#b">Use a recovery code</a> <a href="#r">Resend confirmation email</a></div>',
				authOtp,
				'Two-factor authentication',
			),
		],
	])('keeps an authenticator field unique with %s in an alert', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('spam folder guidance before a resend in an alert or header of a card', () => {
	it.each([
		['"Check your spam folder." in an alert', card('<div role="alert">Check your spam folder. <a href="#r">Resend</a></div>')],
		['"Check your junk folder." in a header', card('<header>Check your junk folder. <button type="button">Resend code</button></header>')],
		['请查看垃圾箱 in an alert', card('<div role="alert">请查看垃圾箱 <a href="#r">重新发送</a></div>', cnCode, '安全验证')],
		[
			'"Check your spam folder." in an alert of a card without a heading',
			`<div class="verify-box"><div class="title">Security check</div><div class="field">${singleOtp}</div><div role="alert">Check your spam folder. <a href="#r">Resend</a></div></div>`,
		],
		[
			'"Check your spam folder." in a notice of a card without a heading',
			`<div class="verify-box"><div class="title">Security check</div><div class="field">${singleOtp}</div><p>Check your spam folder. <a href="#r">Resend</a></p></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'in the site header outside the card',
			`<div id="app"><header>Check your spam folder. <a href="#r">Resend</a></header><main><div class="card"><h2>Two-factor authentication</h2><div class="field">${appOtp}</div></div></main></div>`,
		],
		[
			'about an unverified email in an alert',
			card(
				'<div role="alert">Your email address is not verified. <a href="#r">Resend email</a></div>',
				appOtp,
				'Two-factor authentication',
			),
		],
	])('keeps an authenticator field unique with a resend %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('"also" offering another way', () => {
	const appCodeOtp = '<input id="otp" placeholder="Code from your authenticator app" autocomplete="one-time-code">';

	it.each([
		['You can also use a code from your authenticator app.', 'Text me a code', singleOtp],
		['You can also enter the code from your authenticator app.', 'Send SMS code', singleOtp],
		['Authenticator codes also work here.', 'Text me a code', singleOtp],
		['Codes from your authenticator app are also accepted.', 'Text me a code', singleOtp],
		['也可以使用身份验证器中的验证码', '发送短信验证码', cnCode],
	])('requires explicit focus after "%s" beside %s', (sentence, label, field) => {
		renderVisible(said(sentence, field).replace(verify, `<button type="button">${label}</button>`));
		expectFocusedAmbiguous();
	});

	it.each([
		["We've also sent the code to your email.", singleOtp],
		['We also sent a code to (***) ***-1234.', singleOtp],
		['The code was also sent by email.', singleOtp],
		["We've sent a code to your phone and also to your email.", singleOtp],
		["Didn't get it? You can also resend the code.", singleOtp],
		['我们也已将验证码发送至您的邮箱', cnCode],
	])('requires explicit focus after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectFocusedAmbiguous();
	});

	it.each([
		['You can also receive a code by email.', appCodeOtp],
		['You can also get a code by text message.', authOtp],
		['也可以通过短信获取验证码', authOtp],
	])('keeps an authenticator field unique after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectUniqueFill();
	});
});

describe('getting a new QR code, recovery codes or key', () => {
	it.each([
		['重新获取二维码', `<form><img alt="QR"><button type="button">重新获取二维码</button>${cnApp}${verify}</form>`],
		['重新获取恢复码', `<form>${cnApp}${verify}<a href="#r">重新获取恢复码</a></form>`],
		['重新获取密钥', `<form>${cnApp}${verify}<a href="#k">重新获取密钥</a></form>`],
		['Resend QR code', `<form><img alt="QR"><button type="button">Resend QR code</button>${authOtp}${verify}</form>`],
		['Resend recovery codes', `<form>${authOtp}${verify}<a href="#r">Resend recovery codes</a></form>`],
		['Send the QR code again', `<form><img alt="QR"><button type="button">Send the QR code again</button>${authOtp}${verify}</form>`],
		['Get a new QR code', `<form><img alt="QR"><button type="button">Get a new QR code</button>${authOtp}${verify}</form>`],
		['Regenerate recovery codes', `<form>${authOtp}${verify}<a href="#r">Regenerate recovery codes</a></form>`],
		['重新获取二维码 beside the form', `<div class="verify"><form>${authOtp}${verify}</form><p><a href="#q">重新获取二维码</a></p></div>`],
		['遇到问题？重新获取二维码 in an alert', card('<div role="alert">遇到问题？<a href="#q">重新获取二维码</a></div>', cnApp, '两步验证')],
	])('keeps an authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['重新获取验证码', cnCode],
		['重新获取', cnCode],
		['重新获取短信验证码', cnCode],
		['重新获取验证码或二维码', cnCode],
		['Resend code', singleOtp],
		['Resend the code', singleOtp],
	])('requires explicit focus beside %s', (label, field) => {
		renderVisible(`<form>${field}<button type="button">${label}</button>${verify}</form>`);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus beside a link to resend the email', () => {
		renderVisible(`<form>${singleOtp}${verify}<a href="#r">Resend the email</a></form>`);
		expectFocusedAmbiguous();
	});
});

describe('countdowns without a unit', () => {
	it.each([
		['a disabled button reading 59', '<button type="button" disabled>59</button>', cnCode],
		['a disabled button reading 00:59', '<button type="button" disabled>00:59</button>', cnCode],
		['a send span reading 00:59', '<span class="send-btn">00:59</span>', cnCode],
		['a disabled button reading 0:45', '<button type="button" disabled>0:45</button>', singleOtp],
		['an enabled send button reading 59', '<button type="button" class="send-code">59</button>', cnCode],
		['a resend link reading 00:59', '<a class="resend" href="#r">00:59</a>', cnCode],
		['a disabled button reading 59s', '<button type="button" disabled>59s</button>', cnCode],
	])('requires explicit focus beside %s', (_name, countdown, field) => {
		renderVisible(`<form>${field}${countdown}${verify}</form>`);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'numeric keypad buttons',
			`<form>${cnApp}<div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => `<button type="button">${digit}</button>`).join('')}</div>${verify}</form>`,
		],
		['an enabled button reading 59', `<form>${cnApp}<button type="button">59</button>${verify}</form>`],
		['a timer reading 00:25', `<form>${cnApp}<span class="timer">00:25</span>${verify}</form>`],
		['a clickable span reading 00:25 without a send class', `<form>${cnApp}<span class="btn">00:25</span>${verify}</form>`],
		['"Code refreshes in 00:25"', `<form>${authOtp}<p>Code refreshes in 00:25</p>${verify}</form>`],
		[
			'pagination buttons',
			`<div class="page"><form>${authOtp}${verify}</form><nav class="pagination"><button type="button">1</button><button type="button">2</button><button type="button">3</button></nav></div>`,
		],
	])('keeps an authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('a nav bar whose back key is a button', () => {
	const backKey =
		'<div class="van-nav-bar__left" role="button" tabindex="0"><i class="van-icon van-icon-arrow-left"></i><span class="van-nav-bar__text">返回</span></div>';
	const navBar = (title, left = backKey, right = '') =>
		`<div class="van-nav-bar"><div class="van-nav-bar__content">${left}<div class="van-nav-bar__title">${title}</div>${right}</div></div>`;
	// A Vant page: the nav bar, a field cell group and a footer.
	const navPage = (nav, field, footer) =>
		`<div class="verify-page">${nav}<div class="van-cell-group"><div class="van-cell van-field"><div class="van-cell__value"><div class="van-field__body">${field}</div></div></div></div><div class="footer">${footer}</div></div>`;
	const resend = '<button type="button" class="van-button">重新发送</button>';

	it.each([
		['a back key with role=button', navPage(navBar('安全验证'), cnCode, resend)],
		['a <button> back key', navPage(navBar('安全验证', '<button type="button" class="van-nav-bar__left">返回</button>'), cnCode, resend)],
		['收不到？ before 重新获取', navPage(navBar('验证手机'), cnCode, '<span>收不到？</span><a href="#r">重新获取</a>')],
		['a back key without role=button', navPage(navBar('安全验证', '<div class="van-nav-bar__left">返回</div>'), cnCode, resend)],
		['a div.title instead of a nav bar', navPage('<div class="title">安全验证</div>', cnCode, resend)],
	])('requires explicit focus with a resend in the footer and %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	const accountPage = (field) =>
		`<div class="page">${navBar('我的账户')}<div class="card"><div class="title">绑定邮箱</div><div class="van-field"><input type="email" placeholder="请输入邮箱"></div><button type="button">发送验证码</button></div><div class="card"><div class="title">两步验证</div><div class="van-field">${field}</div></div></div>`;

	it.each([
		['身份验证器 and a recovery code link', navPage(navBar('身份验证器'), cnApp, '<a href="#r">使用恢复码</a>')],
		[
			'两步验证 with a help key and a link to another way',
			navPage(
				navBar('两步验证', backKey, '<div class="van-nav-bar__right" role="button" tabindex="0">帮助</div>'),
				cnApp,
				'<a href="#o">换一种方式</a>',
			),
		],
		['我的账户 above a card sending an email code', accountPage(cnApp)],
		[
			'我的账户 above a card sending an email code, with a generic field',
			accountPage('<input id="otp" placeholder="请输入动态码" autocomplete="one-time-code">'),
		],
	])('keeps an authenticator field unique below a nav bar titled %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('asking to be sent a new code', () => {
	it.each([
		['Send me a new code', singleOtp],
		['Get me another code', singleOtp],
		['Send me another one', singleOtp],
		['给我发一个新的验证码', cnCode],
		['发送新的短信验证码', cnCode],
	])('requires explicit focus beside a link reading %s', (label, field) => {
		renderVisible(`<form>${field}${verify}<a href="#r">${label}</a></form>`);
		expectFocusedAmbiguous();
	});

	it.each([
		['Send me a new QR code', `<form><img alt="QR"><button type="button">Send me a new QR code</button>${authOtp}${verify}</form>`],
		['Send me new recovery codes', `<form>${authOtp}${verify}<a href="#r">Send me new recovery codes</a></form>`],
		['给我发一个新的二维码', `<form><img alt="QR"><button type="button">给我发一个新的二维码</button>${cnApp}${verify}</form>`],
	])('keeps an authenticator field unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('Ant Design Mobile form items', () => {
	// A Form.Item: the input sits 9 levels below the form, its extra slot 4 levels up.
	const item = (label, input, extra = '') =>
		`<div class="adm-list-item adm-form-item"><div class="adm-list-item-content"><div class="adm-list-item-content-prefix"><div class="adm-form-item-label">${label}</div></div><div class="adm-list-item-content-main"><div class="adm-form-item-child"><div class="adm-form-item-child-inner"><div class="adm-input">${input}</div></div></div></div>${extra ? `<div class="adm-list-item-content-extra">${extra}</div>` : ''}</div></div>`;
	const form = (items, footer = '') =>
		`<form class="adm-form"><div class="adm-list"><div class="adm-list-body"><div class="adm-list-body-inner">${items}</div></div></div><div class="adm-form-footer"><button type="submit" class="adm-button">登录</button>${footer}</div></form>`;
	const phone = (extra) => item('手机号', '<input class="adm-input-element" type="tel" placeholder="请输入手机号">', extra);
	const code = '<input class="adm-input-element" placeholder="请输入验证码" autocomplete="one-time-code">';
	const app = '<input class="adm-input-element" placeholder="请输入身份验证器中的验证码" autocomplete="one-time-code">';

	it.each([
		['a send link in the phone item', form(phone('<a class="adm-link">发送验证码</a>') + item('验证码', code))],
		['a send button in the phone item', form(phone('<button type="button" class="adm-button">获取验证码</button>') + item('验证码', code))],
		['a countdown in the phone item', form(phone('<button type="button" class="adm-button" disabled>59s</button>') + item('验证码', code))],
		['a resend link in the phone item', form(phone('<a class="adm-link">重新发送</a>') + item('验证码', code))],
		['a resend link in the form footer', form(item('验证码', code), '<a class="adm-link">重新获取验证码</a>')],
		[
			'a send link in the phone item of a div.adm-form',
			form(phone('<a class="adm-link">发送验证码</a>') + item('验证码', code))
				.replace('<form class="adm-form">', '<div class="adm-form">')
				.replace('</form>', '</div>'),
		],
		[
			'a resend link in the footer of a div.adm-form',
			form(item('验证码', code), '<a class="adm-link">重新获取验证码</a>')
				.replace('<form class="adm-form">', '<div class="adm-form">')
				.replace('</form>', '</div>'),
		],
		['a send link in the code item', form(phone() + item('验证码', code, '<a class="adm-link">发送验证码</a>'))],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['no extra', form(item('动态码', app))],
		['a paste link in its extra', form(item('动态码', app, '<a class="adm-link">粘贴</a>'))],
		['a recovery code link in the form footer', form(item('动态码', app), '<a class="adm-link">使用恢复码</a>')],
		[
			'a recovery code link in the footer of a div.adm-form',
			form(item('动态码', app), '<a class="adm-link">使用恢复码</a>')
				.replace('<form class="adm-form">', '<div class="adm-form">')
				.replace('</form>', '</div>'),
		],
		[
			'a phone item above whose extra sends a code',
			form(phone('<button type="button" class="adm-button">获取验证码</button>') + item('动态码', app)),
		],
		[
			'a separate email form sending a code',
			`<div class="settings">${form(item('邮箱', '<input class="adm-input-element" type="email" placeholder="请输入邮箱">', '<a class="adm-link">发送验证码</a>'))}${form(item('两步验证码', '<input class="adm-input-element" placeholder="请输入 6 位动态码" autocomplete="one-time-code">'))}</div>`,
		],
	])('keeps an authenticator item unique with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	// The same phone row outside a component library, once its send button has been used.
	const phoneRow = (action) => `<div class="row"><input type="tel" placeholder="请输入手机号">${action}</div>`;

	it.each([
		['a countdown', `<form>${phoneRow('<button type="button" disabled>59s</button>')}<div class="row">${cnCode}</div>${verify}</form>`],
		['a resend button', `<form>${phoneRow('<button type="button">重新发送</button>')}<div class="row">${cnCode}</div>${verify}</form>`],
		[
			'a resend countdown without a form',
			`<div class="login">${phoneRow('<button type="button" disabled>60秒后重新获取</button>')}<div class="row">${cnCode}</div>${verify}</div>`,
		],
	])('requires explicit focus with %s in the phone row', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['Resend verification email', '<a href="#v">Resend verification email</a>'],
		['重新发送激活邮件', '<a href="#v">重新发送激活邮件</a>'],
	])('keeps an authenticator field unique beside an email row with %s', (_name, link) => {
		renderVisible(
			`<form><div class="row"><input type="email" value="user@example.com">${link}</div><div class="row">${authOtp}</div>${verify}</form>`,
		);
		expectUniqueFill();
	});
});

describe("a heading-only block beside the field's own titled block", () => {
	const sms = `<div class="row">${singleOtp}<button type="button">Send code</button></div>`;

	it.each([
		[
			'an SMS section',
			`<div class="card"><h2>Two-factor authentication</h2><div class="section"><h4>Authenticator app</h4></div><div class="section"><div class="title">SMS</div>${sms}</div></div>`,
		],
		[
			'a 短信验证 section',
			`<div class="card"><h2>两步验证</h2><div class="section"><h4>身份验证器</h4></div><div class="section"><div class="title">短信验证</div><div class="row">${cnCode}<button type="button">获取验证码</button></div></div></div>`,
		],
		[
			'a "Verify your phone number" block',
			`<form><div class="block"><h3>Authenticator app</h3></div><div class="block"><p>Verify your phone number</p>${sms}</div></form>`,
		],
		[
			'a Text message section above it',
			`<div class="card"><h2>Two-factor authentication</h2><div class="section"><div class="title">Text message</div>${sms}</div><div class="section"><h4>Authenticator app</h4></div></div>`,
		],
		[
			'an SMS section, the other one with body text',
			`<div class="card"><h2>Two-factor authentication</h2><div class="section"><h4>Authenticator app</h4><p>Configured on your phone.</p></div><div class="section"><div class="title">SMS</div>${sms}</div></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a card body without a title',
			`<div class="card"><h2>Two-factor authentication</h2><div class="card-header"><h3>Authenticator app</h3></div><div class="card-body">${sms}</div></div>`,
		],
		[
			'the heading as the card subtitle',
			`<div class="card"><h2>Two-step verification</h2><h3>Authenticator app</h3><div class="field">${singleOtp}</div><button type="button">Send code</button></div>`,
		],
		[
			'a field block titled "Enter the 6-digit code"',
			`<div class="card"><h2>Two-factor authentication</h2><div class="section"><h3>Authenticator app</h3></div><div class="section"><div class="title">Enter the 6-digit code</div>${sms}</div></div>`,
		],
		[
			'a field block titled 安全验证',
			`<div class="card"><h2>两步验证</h2><div class="section"><h3>身份验证器</h3></div><div class="section"><div class="title">安全验证</div><div class="row">${cnCode}<button type="button">获取验证码</button></div></div></div>`,
		],
	])('keeps an authenticator field unique with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('far sends and resends in a layout without a heading', () => {
	// The field in `depth` wrappers; an action beside the outermost one is then `depth` levels up.
	const nest = (field, depth) => {
		let html = field;
		for (let index = depth; index >= 1; index -= 1) {
			html = `<div class="w${index}">${html}</div>`;
		}
		return html;
	};
	const action = (label) => `<div class="actions"><button type="button">${label}</button></div>`;
	const twoStep = '<input id="otp" placeholder="请输入两步验证码" autocomplete="one-time-code">';

	it.each([
		['#app, 获取验证码 two levels up', `<div id="app">${nest(cnCode, 2)}${action('获取验证码')}</div>`],
		['#app, 60秒后重新获取 two levels up', `<div id="app">${nest(cnCode, 2)}${action('60秒后重新获取')}</div>`],
		['#app, 重新发送 two levels up', `<div id="app">${nest(cnCode, 2)}${action('重新发送')}</div>`],
		['main, 获取验证码 three levels up', `<main>${nest(cnCode, 3)}${action('获取验证码')}</main>`],
		['main, Resend SMS three levels up', `<main>${nest(singleOtp, 3)}${action('Resend SMS')}</main>`],
		['div.page, 获取验证码 two levels up', `<div class="page">${nest(cnCode, 2)}${action('获取验证码')}</div>`],
		['div.layout, 重新发送 two levels up', `<div class="layout">${nest(cnCode, 2)}${action('重新发送')}</div>`],
		['div.login, 重新发送 two levels up', `<div class="login">${nest(cnCode, 2)}${action('重新发送')}</div>`],
		['div.login, 获取验证码 three levels up', `<div class="login">${nest(cnCode, 3)}${action('获取验证码')}</div>`],
		[
			'#app, a phone block with 获取验证码 after the code block',
			`<div id="app">${nest(cnCode, 2)}<div class="bind"><input type="tel" placeholder="请输入手机号"><button type="button">获取验证码</button></div></div>`,
		],
		['div.login, 获取验证码 two levels up', `<div class="login">${nest(cnCode, 2)}${action('获取验证码')}</div>`],
		['main with a heading, 重新发送 three levels up', `<main><h1>安全验证</h1>${nest(cnCode, 3)}${action('重新发送')}</main>`],
	])('requires explicit focus in %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['#app, an authenticator label and Send code three levels up', `<div id="app">${nest(authOtp, 3)}${action('Send code')}</div>`],
		[
			'#app, a separate form with a phone field and 获取验证码',
			`<div id="app"><form>${nest(twoStep, 2)}<button type="submit">验证</button></form><form class="bind"><input type="tel" placeholder="请输入手机号"><button type="button">获取验证码</button></form></div>`,
		],
		[
			'main, a newsletter sidebar with an email field and Send code',
			`<main>${nest(appOtp, 3)}<aside class="newsletter"><input type="email" placeholder="Email"><button type="button">Send code</button></aside></main>`,
		],
		[
			'#app, a site header resending the verification email',
			`<div id="app"><header class="site-header"><span>Your email is not verified.</span> <a href="#v">Resend verification email</a></header>${nest(appOtp, 2)}</div>`,
		],
		[
			'#app, a notice resending the verification email two levels up',
			`<div id="app"><div class="notice">Your email is not verified. <a href="#v">Resend verification email</a></div>${nest(appOtp, 2)}</div>`,
		],
		['div.page, 重新获取二维码 two levels up', `<div class="page">${nest(cnApp, 2)}${action('重新获取二维码')}</div>`],
		[
			'#app, navigation and footer links',
			`<div id="app"><nav><a href="/">首页</a></nav>${nest(twoStep, 2)}<footer><a href="#s">联系客服</a> <a href="#r">使用恢复码</a></footer></div>`,
		],
	])('keeps an authenticator field unique in %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('accordion items whose state class comes first', () => {
	const accordion = (authClass, smsClass, auth = 'Authenticator app', sms = 'Text message', field = singleOtp, send = 'Send code') =>
		`<form><div class="${authClass}"><h4>${auth}</h4></div><div class="${smsClass}"><h4>${sms}</h4><div class="row">${field}<button type="button">${send}</button></div></div></form>`;

	it.each([
		['.method and .open.method', accordion('method', 'open method')],
		['.item and .active.item', accordion('item', 'active item')],
		['.is-collapsed.method-item and .is-open.method-item', accordion('is-collapsed method-item', 'is-open method-item')],
		['.method and .expanded.method in Chinese', accordion('method', 'expanded method', '身份验证器', '短信验证', cnCode, '获取验证码')],
		['.method and .method.open', accordion('method', 'method open')],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	const help = (cardClass, helpClass) =>
		`<div class="wrap"><div class="${cardClass}"><h2>Authenticator app</h2><div class="row">${singleOtp}<button type="button">Send code</button></div></div><div class="${helpClass}"><h3>Lost your phone?</h3><p>Use one of your recovery codes.</p></div></div>`;

	it.each([
		['a help block with no class in common', help('card auth-card', 'help-box')],
		['a help block sharing a class that is not its first', help('panel main-panel', 'panel-help panel')],
	])('keeps an authenticator card unique beside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('a resend naming the code in a notice about the account email', () => {
	// A card without a heading: its title, the field, then a notice.
	const loose = (notice, field = singleOtp, title = 'Security check') =>
		`<div class="verify-box"><div class="title">${title}</div><div class="field">${field}</div><p>${notice}</p></div>`;

	it.each([
		['Your email is not verified.', 'Resend code'],
		['Unverified email.', 'Resend code'],
		['Your email is unverified.', 'Resend verification code'],
	])('requires explicit focus after "%s" beside %s', (notice, label) => {
		renderVisible(loose(`${notice} <a href="#r">${label}</a>`));
		expectFocusedAmbiguous();
	});

	it('requires explicit focus after "Your email is unverified." beside Resend in a card titled "Verify your email"', () => {
		renderVisible(loose('Your email is unverified. <a href="#r">Resend</a>', singleOtp, 'Verify your email'));
		expectFocusedAmbiguous();
	});

	it('requires explicit focus beside a notice saying the email address is not verified in the immediate block of a bare layout', () => {
		renderVisible(
			`<div class="verify"><div class="row">${singleOtp}</div><p>Your email address is not verified. <a href="#r">Resend</a></p></div>`,
		);
		expectFocusedAmbiguous();
	});

	it.each([
		['Your email is not verified.', 'Resend email', appOtp, 'Two-factor authentication'],
		['邮箱尚未激活', '重新发送激活邮件', cnApp, '两步验证'],
	])('keeps an authenticator field unique after "%s" beside %s', (notice, label, field, title) => {
		renderVisible(loose(`${notice} <a href="#r">${label}</a>`, field, title));
		expectUniqueFill();
	});
});

describe('another way naming its channel beside a generic field', () => {
	it.each([
		['You can also receive a code by email.', singleOtp],
		['也可以通过邮箱接收验证码', cnCode],
		['Enter the code below, or you can also receive it by SMS.', singleOtp],
	])('requires explicit focus after "%s"', (sentence, field) => {
		renderVisible(said(sentence, field));
		expectFocusedAmbiguous();
	});

	it('keeps a generic field unique in an "Authenticator app" card whose form offers another way by email', () => {
		renderVisible(`<div class="card"><h2>Authenticator app</h2>${said('You can also receive a code by email.')}</div>`);
		expectUniqueFill();
	});

	it('keeps a generic field unique after a sentence naming the authenticator before another way', () => {
		renderVisible(said('Enter the code from your authenticator app, or you can also receive a code by email.'));
		expectUniqueFill();
	});
});
