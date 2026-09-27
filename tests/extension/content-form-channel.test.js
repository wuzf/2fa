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
const smsOtp = '<input placeholder="验证码" autocomplete="one-time-code">';

beforeEach(() => document.body.replaceChildren());

describe('app wording that does not name the authenticator', () => {
	it.each([
		[
			'a QR login hint naming the site app',
			`<div class="login"><p>打开抖音 App 扫码登录</p><input type="tel" placeholder="手机号"><div>${smsOtp}<button type="button">获取验证码</button></div></div>`,
		],
		[
			'a span toggle between text message and the authenticator app',
			`<form><div class="switch"><span>Text message</span><span>Authenticator app</span></div>${singleOtp}<button type="button">Send code</button></form>`,
		],
		[
			'a div tab bar with an app QR login tab',
			`<div class="login"><h2>账号登录</h2><div class="tabs"><div>短信登录</div><div>密码登录</div><div>App扫码登录</div></div><form><input type="tel" placeholder="手机号"><div>${smsOtp}<button type="button">获取验证码</button></div></form></div>`,
		],
		[
			'an app download invitation',
			`<form><p>New here? Get the app for iOS and Android.</p>${singleOtp}<button type="button">Send code</button></form>`,
		],
		['a download promotion in the form', `<form>${smsOtp}<button type="button">获取验证码</button><p>下载App，登录更便捷</p></form>`],
		[
			'another sign-in method with the authenticator',
			`<form>${smsOtp}<button type="button">获取验证码</button><p>也可以使用身份验证器应用登录</p></form>`,
		],
		[
			'a tip promoting an authenticator app',
			`<form><p>Tip: download our Authenticator app to get your code faster.</p>${singleOtp}<button type="button">Send code</button></form>`,
		],
		[
			'an input named appCode',
			'<form><input name="appCode" placeholder="验证码" autocomplete="one-time-code"><button type="button">获取验证码</button></form>',
		],
	])('requires explicit focus beside a first send with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['an authenticator heading', `<form><h2>Authenticator app</h2>${singleOtp}<button type="button">Send code</button></form>`],
		[
			'an authenticator label on the field',
			'<form><label for="otp">Authenticator code</label><input id="otp" autocomplete="one-time-code"><button type="button">Send code</button></form>',
		],
		[
			'an authenticator legend',
			`<form><fieldset><legend>Code from your authenticator app</legend>${singleOtp}<button type="button">Send code</button></fieldset></form>`,
		],
	])('keeps a single field unique beside a first send with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	// These two were unique in round 5. A sentence naming the authenticator is
	// only weak evidence now: SMS pages also say "You can also use a code from
	// your authenticator app", so a generic first send ("Send code") beside it
	// still counts. Only the field's own label, a heading or a legend discards it.
	it.each([
		[
			'a code from your app instruction',
			`<form><p>Enter the code from your app.</p>${singleOtp}<button type="button">Send code</button></form>`,
		],
		[
			'an authenticator sentence split by inline markup',
			`<form><p>Enter the code shown in your <strong>authenticator</strong> app.</p>${singleOtp}<button type="button">Send code</button></form>`,
		],
	])('requires explicit focus beside a generic first send with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		['Text me a code', 'Enter the code from your authenticator app.'],
		['Email me a code', 'Enter the code from your authenticator app.'],
		['获取短信验证码', '请输入身份验证器中的 6 位验证码'],
	])('keeps a single field unique when a sentence names the authenticator beside "%s"', (button, text) => {
		renderVisible(`<form><p>${text}</p>${singleOtp}<button type="button">${button}</button></form>`);
		expectUniqueFill();
	});
});

describe('first-send buttons further from the field', () => {
	it.each([
		[
			'a card footer three levels up',
			`<div class="card"><div class="body"><div class="content"><div class="field">${singleOtp}</div></div></div><div class="footer"><button type="button">Send code</button></div></div>`,
		],
		[
			'a titled card footer three levels up',
			`<div class="card"><h2>Verify</h2><div class="body"><div class="content"><div class="field">${singleOtp}</div></div></div><div class="footer"><button type="button">Send code</button></div></div>`,
		],
		[
			'a suffix beside wrapped form-item controls in a titled login box',
			`<div class="login-box"><h2>账号登录</h2><div class="form-item"><div class="form-item-control"><div class="control-input"><span class="affix-wrapper"><span class="input-wrap">${smsOtp}</span></span></div></div><div class="form-item-extra"><span class="suffix"><button type="button">获取验证码</button></span></div></div></div>`,
		],
		[
			'an adjacent grid item',
			`<div class="paper"><h1>Sign in</h1><div class="grid-container"><div class="grid-item"><div class="form-control"><div class="input-base">${singleOtp}</div></div></div><div class="grid-item"><button type="button">Send code</button></div></div></div>`,
		],
		[
			'a phone row holding the send button',
			`<div class="login"><div class="row"><input type="tel" placeholder="手机号"><button type="button">获取验证码</button></div><div class="row">${smsOtp}</div></div>`,
		],
		['a clickable span', `<div class="row">${smsOtp}<span class="send">获取验证码</span></div>`],
		['a clickable div with English wording', `<div class="row">${singleOtp}<div class="send-btn" tabindex="0">Send code</div></div>`],
		[
			'a bare layout two levels up',
			`<div class="login"><div class="actions"><button type="button">获取验证码</button></div><div class="line"><div class="wrap">${smsOtp}</div></div></div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'GitHub',
			'<div class="auth-form"><div class="auth-form-header"><h1>Two-factor authentication</h1></div><form action="/sessions/two-factor"><div class="auth-form-body"><label for="app_totp">Authentication code</label><input id="app_totp" autocomplete="one-time-code"><p>Open your two-factor authenticator (TOTP) app or browser extension to view your authentication code.</p></div></form><form action="/sessions/two-factor/sms"><button type="submit">Send a code via SMS</button></form></div>',
		],
		[
			'Google',
			'<div class="card"><h1>2-Step Verification</h1><p>Get a verification code from the Google Authenticator app</p><form><div class="field"><div class="wrap"><input aria-label="Enter code" autocomplete="one-time-code"></div></div><button type="submit">Next</button></form><button type="button">Try another way</button></div>',
		],
		[
			'Microsoft',
			'<div class="card"><div role="heading">Enter code</div><p>Enter the code displayed in the Microsoft Authenticator app on your mobile device</p><form><input name="otc" aria-label="Code" autocomplete="one-time-code"><button type="submit">Verify</button></form><a href="#other">I can\'t use my Microsoft Authenticator app right now</a></div>',
		],
		[
			'AWS',
			'<main><div class="panel"><h2>Multi-factor authentication</h2><p>Your account is secured using multi-factor authentication (MFA). To finish signing in, enter the code from your MFA device.</p><div class="field"><label for="mfa">MFA code</label><input id="mfa" autocomplete="one-time-code"></div><button type="submit">Submit</button><a href="#troubleshoot">Troubleshoot MFA</a></div></main>',
		],
		[
			'Cloudflare',
			'<div id="root"><div class="page"><div class="card"><h1>Two-factor authentication</h1><p>Enter the code from your authenticator app.</p><form><div class="form-item"><div class="form-label">Code</div><div class="form-control"><input autocomplete="one-time-code"></div></div><button type="submit">Log in</button></form></div></div></div>',
		],
		[
			'a send button in the site header of main',
			`<main><header><h1><img alt=""></h1><button type="button">Send code</button></header><div class="content"><div><div>${singleOtp}</div></div></div></main>`,
		],
	])('keeps a %s-style TOTP page unique', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('loose challenge cards around an input row', () => {
	const resend = '<div class="footer"><button type="button">重新发送短信</button></div>';

	it.each([
		[
			'a Chinese form item',
			`<div class="card"><div class="form-item"><div class="form-label">验证码</div><div class="form-control">${smsOtp}</div></div>${resend}</div>`,
		],
		[
			'an English caption',
			`<div class="card"><div class="form-item"><span class="caption">Code</span><div class="form-control">${singleOtp}</div></div>${resend}</div>`,
		],
		[
			'a code-box wrapper',
			`<div class="panel"><div class="code-box"><div class="input-box"><div>${smsOtp}</div><i class="icon"></i></div></div>${resend}</div>`,
		],
		[
			'a close button before the title',
			`<div class="wrap"><button type="button">×</button><div class="title">安全验证</div><div class="body"><div class="field">${smsOtp}</div></div>${resend}</div>`,
		],
		[
			'an empty icon before the title',
			`<div class="wrap"><i class="icon"></i><div class="title">安全验证</div><div class="body"><div class="field">${smsOtp}</div></div>${resend}</div>`,
		],
		[
			'a title ending in a period',
			`<div class="wrap"><p class="title">Enter verification code.</p><div class="body"><div class="field">${singleOtp}</div></div><div class="footer"><button type="button">Resend SMS</button></div></div>`,
		],
		[
			'a title with a help link',
			`<div class="wrap"><div class="title">安全验证 <a href="#help">帮助</a></div><div class="body"><div class="field">${smsOtp}</div></div>${resend}</div>`,
		],
	])('requires explicit focus with a footer resend around %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'#app with a brand name first',
			`<div id="app"><div class="brand">Acme</div><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><div class="content"><div class="field">${singleOtp}</div></div></div>`,
		],
		[
			'a page box with a breadcrumb first',
			`<div class="page-box"><div class="breadcrumb">Home / Security</div><div class="notice">Please verify your email address. <a href="#resend">Resend email</a></div><div class="content"><div class="field">${singleOtp}</div></div></div>`,
		],
		[
			'a main panel with a breadcrumb list first',
			`<div class="main-panel"><ol class="crumbs"><li>Home</li><li>Security</li></ol><div class="notice">Please verify your email address. <a href="#resend">Resend email</a></div><div class="content"><div class="field">${singleOtp}</div></div></div>`,
		],
	])('keeps a single authenticator field unique inside %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('sent notices naming only the channel', () => {
	const field = `<div class="field">${singleOtp}</div>`;

	it.each([
		[
			'a text alert with a masked number',
			`<div class="card"><h2>Verify</h2><div role="alert">We sent a text to (***) ***-1234. <button type="button">Resend</button></div>${field}</div>`,
		],
		[
			'a Chinese SMS alert',
			`<div class="card"><h2>安全验证</h2><div role="alert" class="ant-alert">短信已发送至 138****1234 <a href="#resend">重新发送</a></div>${field}</div>`,
		],
		[
			'a header saying the text was sent',
			`<div class="card"><header>Text message sent <button type="button">Resend</button></header>${field}</div>`,
		],
		[
			'an email alert with a masked address',
			`<div class="card"><h2>Verify</h2><div role="alert">Email sent to j***@example.com <a href="#resend">Resend email</a></div>${field}</div>`,
		],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'an alert holding only a resend link',
			`<div class="card"><h2>Two-step verification</h2><div role="alert"><a href="#resend">Resend verification email</a></div>${field}</div>`,
		],
		[
			'a site header with a logo, links and a resend link inside a titled wrapper',
			`<div class="wrapper"><header><a href="/"><img alt="Acme"></a><a href="/help">Help</a><a href="/resend">Resend verification email</a></header><h1>Two-factor authentication</h1><form>${singleOtp}<button type="submit">Verify</button></form></div>`,
		],
	])('keeps a single authenticator field unique with %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('delivery instructions in the page region or a card with several forms', () => {
	it.each([
		[
			'main with the instruction outside the form',
			`<main><h1>Verify your phone</h1><p>We texted a code to (***) ***-1234.</p><form>${singleOtp}<button type="submit">Verify</button></form></main>`,
		],
		[
			'role=main with a separate resend form',
			`<div role="main"><h1>Verify</h1><form>${singleOtp}</form><form action="/resend"><button type="submit">Resend SMS</button></form></div>`,
		],
		[
			'a card with a language form',
			`<div class="card"><h2>Verify</h2><form class="lang"><select><option>English</option></select></form><p>We texted a code to (***) ***-1234.</p><form>${singleOtp}</form></div>`,
		],
		[
			'a card with a search form',
			`<section><h2>Verify</h2><form role="search"><input type="search" aria-label="Search"></form><p>We emailed you a verification code.</p><form>${singleOtp}</form></section>`,
		],
		[
			'a dialog with a separate resend form and another form',
			`<div role="dialog"><h2>Verify</h2><form class="lang"><select><option>English</option></select></form><form>${singleOtp}</form><form action="/resend"><button type="submit">Resend code</button></form></div>`,
		],
	])('requires explicit focus in %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('texts and messages as the channel', () => {
	it.each(['Check your texts for the code.', 'Check your messages for the code.'])('requires explicit focus beside "%s"', (text) => {
		renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
		expectFocusedAmbiguous();
	});

	it.each(['Enter the code from your authenticator app.', 'Error message: the code has expired.'])(
		'keeps a single field unique beside "%s"',
		(text) => {
			renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
			expectUniqueFill();
		},
	);
});

describe('a legend send button turning into a countdown', () => {
	it('keeps the target when the first send becomes a resend countdown', () => {
		document.body.innerHTML = `<form><fieldset><legend>Verification code <button type="button">获取验证码</button></legend><div>${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div></fieldset></form>`;
		const inputs = Array.from(document.querySelectorAll('input'));
		for (const input of inputs) {
			input.getClientRects = () => [{ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 }];
		}
		inputs[0].focus();
		const selected = detectOtpTarget(document, { focusedInput: inputs[0] });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused' } });
		document.querySelector('legend button').textContent = '60秒后重新获取';
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});
});
