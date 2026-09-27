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

function otpInputs() {
	return Array.from(document.querySelectorAll('[autocomplete="one-time-code"]'));
}

function expectFocusedAmbiguous(input = otpInputs()[0]) {
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
const appOtp = '<label for="otp">Authentication code</label><input id="otp" autocomplete="one-time-code">';
const cnCode = '<input id="otp" placeholder="请输入验证码" autocomplete="one-time-code">';
const digits = '<input maxlength="1" inputmode="numeric" autocomplete="one-time-code">'.repeat(6);
const cnForm = (tip, button = '获取验证码') =>
	`<form><input type="tel" placeholder="手机号"><div>${cnCode}<button type="button">${button}</button></div><p>${tip}</p></form>`;
const enForm = (tip, button = 'Send code') => `<form>${singleOtp}<button type="button">${button}</button><p>${tip}</p></form>`;

beforeEach(() => document.body.replaceChildren());

describe('resend labels that also read as a first send', () => {
	it.each(['重新获取验证码', '重新发送验证码', '重新获取验证码(59s)'])(
		'requires explicit focus with a separate resend form "%s"',
		(label) => {
			renderVisible(
				`<div class="card"><h2>验证手机</h2><form action="/verify">${cnCode}<button type="submit">提交</button></form><form action="/resend"><button type="submit">${label}</button></form></div>`,
			);
			expectFocusedAmbiguous();
		},
	);

	it('requires explicit focus with a resend three levels away in main', () => {
		renderVisible(
			`<main><h1>安全验证</h1><div class="item"><div class="control"><div class="wrap">${cnCode}</div></div></div><div class="actions"><button type="button">重新获取验证码</button></div></main>`,
		);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus with a resend beside a tip naming the authenticator', () => {
		renderVisible(cnForm('没有收到短信？可使用身份验证器中的验证码登录', '重新获取验证码(59s)'));
		expectFocusedAmbiguous();
	});
});

describe('cards whose class looks like a page layout', () => {
	const card = (cls, resend = '重新发送短信') =>
		`<div class="${cls}"><div class="title">安全验证</div><div class="body"><div class="field">${cnCode}</div></div><div class="footer"><button type="button">${resend}</button></div></div>`;

	it.each(['login-page', 'page-login', 'verify-page', 'sms-layout', 'main-content', 'login-main'])(
		'requires explicit focus with a footer resend in a titled .%s',
		(cls) => {
			renderVisible(card(cls));
			expectFocusedAmbiguous();
		},
	);

	it('requires explicit focus with an English footer resend in a titled .site-dialog', () => {
		renderVisible(
			`<div class="site-dialog"><div class="title">Security check</div><div class="body"><div class="field">${singleOtp}</div></div><div class="footer"><button type="button">Resend SMS</button></div></div>`,
		);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus with a resend three levels away in a .login-page with a heading', () => {
		renderVisible(
			`<div class="login-page"><h2>验证码登录</h2><div class="item"><div class="control"><div class="wrap">${cnCode}</div></div></div><div class="actions"><button type="button">重新发送验证码</button></div></div>`,
		);
		expectFocusedAmbiguous();
	});

	it('still treats a .login-page around a card as the page', () => {
		renderVisible(
			`<div class="login-page"><div class="banner">Please verify your email address. <a href="#resend">Resend email</a></div><div class="card"><div class="title">Two-factor authentication</div><div class="body"><div class="field">${appOtp}</div></div></div></div>`,
		);
		expectUniqueFill();
	});
});

describe('first sends three levels away in a page container', () => {
	it('requires explicit focus in a .login-page with a heading and a phone field', () => {
		renderVisible(
			`<div class="login-page"><h2>欢迎登录</h2><div class="item"><input type="tel" placeholder="手机号"></div><div class="item"><div class="control"><div class="wrap">${cnCode}</div></div></div><div class="actions"><button type="button">获取验证码</button></div></div>`,
		);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus in main without another field', () => {
		renderVisible(
			`<main><h1>Sign in with your phone</h1><div class="row"><div class="control"><div class="wrap">${singleOtp}</div></div></div><div class="actions"><button type="button">Send code</button></div></main>`,
		);
		expectFocusedAmbiguous();
	});

	// This was unique in round 6, when a first send in main counted only up to
	// three levels away. Main holds no other entry field, so the send can only
	// belong to this field wherever it sits, and nothing on the page names the
	// authenticator: the field may be the SMS one.
	it('requires explicit focus when the send button in main is four levels away', () => {
		renderVisible(
			`<main><h1>Account security</h1><div class="col"><button type="button">Send code</button></div><div class="col"><div><div><div>${singleOtp}</div></div></div></div></main>`,
		);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus in main without another field when the send button is five levels away', () => {
		renderVisible(
			`<main><h1>安全验证</h1><div class="page-body"><div class="wrap"><div class="form"><div class="item"><div class="control">${cnCode}</div></div></div></div></div><div class="actions"><button type="button">获取验证码</button></div></main>`,
		);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'the field label',
			'<main><h1>Verify</h1><div class="wrap"><div class="form"><div class="item"><div class="control"><label for="otp">Authenticator code</label><input id="otp" autocomplete="one-time-code"></div></div></div></div><div class="actions"><button type="button">Send code</button></div></main>',
		],
		[
			'a sentence',
			`<main><h1>Two-factor authentication</h1><p>Enter the code from your authenticator app.</p><div class="wrap"><div class="form"><div class="item"><div class="control">${appOtp}</div></div></div></div><div class="actions"><button type="button">Text me a code</button></div></main>`,
		],
	])('keeps a TOTP field unique when %s names the authenticator and the send button in main is four levels away', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('segmented groups beside a method toggle', () => {
	it.each([
		['English', '<span class="active">Phone</span><span>Authenticator app</span>', 'Enter the 6-digit code.', 'Send code'],
		['Chinese', '<span class="active">手机</span><span>身份验证器</span>', '请输入6位验证码', '获取验证码'],
	])('requires explicit focus with a %s toggle and a first send', (_name, tabs, text, button) => {
		renderVisible(`<form><div class="tabs">${tabs}</div><p>${text}</p>${digits}<button type="button">${button}</button></form>`);
		expectFocusedAmbiguous();
	});

	it('keeps a segmented group unique when its legend names the authenticator', () => {
		renderVisible(
			`<form><fieldset><legend>Code from your authenticator app</legend><div>${digits}</div></fieldset><button type="button">Send code</button></form>`,
		);
		expectUniqueFill();
	});
});

describe('sentences naming the authenticator on an SMS page', () => {
	it.each([
		['没有收到短信？可使用身份验证器中的验证码登录', cnForm],
		['已绑定身份验证器的用户，请在安全设置中查看动态码', cnForm],
		['You can also use a code from your authenticator app.', enForm],
		['Tired of waiting for texts? Use an authenticator app to generate codes.', enForm],
		['Codes from your authenticator app also work.', enForm],
		['Or enter the code from your authenticator app.', enForm],
		['Authenticator app users: open Settings to enable app codes.', enForm],
	])('requires explicit focus beside a generic first send and "%s"', (tip, form) => {
		renderVisible(form(tip));
		expectFocusedAmbiguous();
	});
});

describe('TOTP pages beside page notices', () => {
	it.each([
		[
			'a titled wrapper whose site header holds a logo, links and a resend link',
			`<div class="wrapper"><header><a href="/"><img alt="Acme"></a><a href="/help">Help</a><a href="/resend">Resend verification email</a></header><h1>Two-factor authentication</h1><form>${singleOtp}<button type="submit">Verify</button></form></div>`,
		],
		[
			'a wrapper without an id whose first child is the brand',
			`<div class="wrapper"><div class="brand">Acme</div><div class="banner">Your email is not verified. <a href="#resend">Resend email</a></div><div class="content"><div class="inner"><div class="field">${appOtp}</div></div></div></div>`,
		],
		[
			'a content box around the whole content',
			`<div class="content-box"><div class="notice">Please verify your email address. <a href="#resend">Resend email</a></div><div class="inner"><div class="row"><div class="field">${appOtp}</div></div></div></div>`,
		],
		[
			'a notice inside a titled loose card',
			`<div class="card"><div class="title">Two-factor authentication</div><div class="notice">Your email address is not verified. <a href="#resend">Resend email</a></div><div class="field">${singleOtp}</div></div>`,
		],
		[
			'a notice asking to confirm the email address in a titled loose card',
			`<div class="verify-box"><div class="title">Two-factor authentication</div><div class="notice">Please confirm your email address. <a href="#resend">Resend</a></div><div class="field">${appOtp}</div></div>`,
		],
		[
			'a notice saying the email is not activated in a titled loose card',
			'<div class="verify-box"><div class="title">两步验证</div><div class="notice">邮箱尚未激活 <a href="#resend">重新发送激活邮件</a></div><div class="field"><input placeholder="请输入身份验证器中的验证码" autocomplete="one-time-code"></div></div>',
		],
	])('keeps a single field unique in %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it('still counts a loose card notice about the code', () => {
		renderVisible(
			`<div class="card"><div class="title">Security check</div><div class="notice">Didn't receive the code? <a href="#resend">Resend</a></div><div class="field">${singleOtp}</div></div>`,
		);
		expectFocusedAmbiguous();
	});
});

describe('sentences that do not describe a delivered code', () => {
	it.each([
		['a recovery code sent by email', 'Lost your device? Check your email for a recovery code.'],
		['a warning about messages', 'We will never send you messages asking for this code.'],
		['the authenticator on the phone', '请在手机上的身份验证器中查看验证码'],
	])('keeps a TOTP field unique beside %s', (_name, text) => {
		renderVisible(`<form><p>Enter the code from your authenticator app.</p>${appOtp}<p>${text}</p></form>`);
		expectUniqueFill();
	});

	it('keeps a TOTP field unique beside a step label reading 获取验证码', () => {
		renderVisible(
			'<div class="bind"><div class="steps"><div class="step">下载身份验证器</div><div class="step">扫描二维码</div><div class="step">获取验证码</div></div><div class="qrcode"><img alt=""></div><div class="field"><input placeholder="请输入 6 位验证码" autocomplete="one-time-code"></div><button type="button">绑定</button></div>',
		);
		expectUniqueFill();
	});

	it('still requires explicit focus beside a sentence saying a text message was sent', () => {
		renderVisible(`<form><p>We sent you a text message with your code.</p>${singleOtp}</form>`);
		expectFocusedAmbiguous();
	});
});

describe('delivered codes described without a channel word', () => {
	it.each([
		[
			'a login code with "check your inbox" in a separate sentence',
			'<div class="login"><p>We just sent you a temporary login code. Please check your inbox.</p><form><input placeholder="Enter code" autocomplete="one-time-code"><button type="submit">Continue with login code</button></form></div>',
		],
		[
			'a sent code without a channel',
			`<div class="card"><h2>Confirm it's you</h2><p>We sent you a 6-digit code. It expires in 10 minutes.</p><form><input aria-label="Code" autocomplete="one-time-code"><button type="submit">Continue</button></form></div>`,
		],
		['请查看手机中的验证码', `<form><p>请查看手机中的验证码</p>${cnCode}</form>`],
		['请查看邮箱中的验证码', `<form><p>请查看邮箱中的验证码</p>${cnCode}</form>`],
		['请查看手机短信', `<form><p>请查看手机短信</p>${cnCode}</form>`],
	])('requires explicit focus with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('send buttons counting down without words', () => {
	it.each([
		['a form', `<form><input type="tel" placeholder="手机号"><div>${cnCode}<button type="button" disabled>59s</button></div></form>`],
		[
			'a card',
			`<div class="card"><h2>安全验证</h2><div class="row"><div class="control">${cnCode}</div></div><div class="footer"><button type="button" disabled>59s</button></div></div>`,
		],
		['a clickable span', `<div class="row">${cnCode}<span class="send">(59)</span></div>`],
	])('requires explicit focus with a bare countdown in %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it('keeps a TOTP field unique beside a keypad of digit buttons', () => {
		renderVisible(
			`<form><p>Enter the code from your authenticator app.</p>${appOtp}<div class="keypad">${[1, 2, 3].map((n) => `<button type="button">${n}</button>`).join('')}</div></form>`,
		);
		expectUniqueFill();
	});

	it.each(['60秒后重新获取', '59s'])('keeps the target when a clickable span 获取验证码 turns into "%s"', (next) => {
		renderVisible(`<div class="row">${cnCode}<span class="send">获取验证码</span></div>`);
		const [input] = otpInputs();
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused' } });
		document.querySelector('span.send').textContent = next;
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});
});

describe('field wrappers whose class names a page or main', () => {
	it('requires explicit focus with a send link beside an antd-mobile List.Item field', () => {
		const inputs = renderVisible(
			'<div class="login"><div class="row"><input type="tel" placeholder="请输入手机号"></div><div class="adm-list-item"><div class="adm-list-item-content"><div class="adm-list-item-content-prefix">验证码</div><div class="adm-list-item-content-main"><div class="adm-input"><input class="adm-input-element" placeholder="请输入验证码"></div></div><div class="adm-list-item-content-extra"><a class="adm-link">获取验证码</a></div></div></div></div>',
		);
		expectFocusedAmbiguous(inputs[1]);
	});

	it('requires explicit focus with a footer resend around a .form-item-main field in a titled card', () => {
		renderVisible(
			`<div class="card"><div class="title">安全验证</div><div class="form-item"><div class="form-item-main">${cnCode}</div></div><div class="footer"><button type="button">重新发送</button></div></div>`,
		);
		expectFocusedAmbiguous();
	});
});

describe('send buttons counting down two levels away in a bare layout', () => {
	const layout = (action) =>
		`<div class="login"><div class="row"><input type="tel" placeholder="请输入手机号"></div><div class="code-row"><div class="input-wrap"><span class="prefix">验证码</span><div class="inner">${cnCode}</div></div>${action}</div></div>`;

	it.each([
		'<button type="button">60秒后重新获取</button>',
		'<button type="button" disabled>59s</button>',
		'<span class="send-btn">重新发送(59)</span>',
	])('requires explicit focus with %s beside the input wrapper', (action) => {
		renderVisible(layout(action));
		expectFocusedAmbiguous();
	});

	it('keeps a focused target when the send button beside the input wrapper turns into its countdown', () => {
		renderVisible(layout('<button type="button">获取验证码</button>'));
		const [input] = otpInputs();
		input.focus();
		const selected = detectOtpTarget(document, { focusedInput: input });
		expect(selected).toMatchObject({ status: 'ready', target: { selection: 'focused', channelAmbiguous: true } });
		document.querySelector('.code-row button').textContent = '60秒后重新获取';
		expect(fillOtpTarget(selected.target, '012345')).toMatchObject({ status: 'filled' });
	});
});

describe('notices beside a resend in a loose card', () => {
	const box = (row, field = cnCode, title = '安全验证') =>
		`<div class="verify-box"><div class="title">${title}</div><div class="field">${field}</div>${row}</div>`;

	it.each([
		['收不到？', box('<p>收不到？<a href="#resend">重新发送</a></p>')],
		['Having trouble?', box('<p>Having trouble? <button type="button">Resend</button></p>', singleOtp, 'Security check')],
		[
			'Wrong number?',
			box(
				'<div class="links"><span>Wrong number?</span> <a href="#change">Change</a> <a href="#resend">Resend</a></div>',
				singleOtp,
				'Security check',
			),
		],
		['a wait hint', box('<div class="row"><span>60 秒后可</span><button type="button" disabled>重新发送</button></div>')],
		['请确认邮箱地址是否正确', box('<p>请确认邮箱地址是否正确 <a href="#resend">重新发送</a></p>', cnCode, '邮箱验证')],
		[
			'Check your spam folder or confirm your email address.',
			box('<p>Check your spam folder or confirm your email address. <a href="#resend">Resend email</a></p>', singleOtp, 'Security check'),
		],
	])('requires explicit focus with a resend after %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus with a first send in a notice asking to verify the phone', () => {
		renderVisible(
			`<div class="dialog-box"><div class="title">安全验证</div><div class="row">验证手机 <button type="button">获取验证码</button></div><div class="row">${cnCode}</div></div>`,
		);
		expectFocusedAmbiguous();
	});
});

describe('send spans inside tip wrappers', () => {
	it.each([
		['div.input-tip > span.send-code', '<div class="input-tip"><span class="send-code">获取验证码</span></div>'],
		['p.tips > span.link', '<p class="tips"><span class="link">获取验证码</span></p>'],
	])('requires explicit focus with a first send in %s', (_name, send) => {
		renderVisible(
			`<div class="login"><div class="row"><input type="tel" placeholder="请输入手机号"></div><div class="row">${cnCode}${send}</div></div>`,
		);
		expectFocusedAmbiguous();
	});

	it.each([
		['a step bar', `<form><div class="steps"><span>获取验证码</span><span>输入验证码</span></div>${cnCode}</form>`],
		['a form tip', `<form>${cnCode}<div class="form-tips"><span>获取验证码请打开身份验证器</span></div></form>`],
		['a section title', `<div class="verify-box"><div class="title"><span>获取验证码</span></div><div class="field">${cnCode}</div></div>`],
	])('keeps a single field unique beside 获取验证码 in %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});
});

describe('headings that do not title the challenge', () => {
	it.each([
		[
			'a Chinese heading toggle in a loose card',
			`<div class="verify-box"><div class="title">安全验证</div><div class="tabs"><h4 class="tab active">短信验证</h4><h4 class="tab">身份验证器</h4></div><div class="field">${cnCode}</div><button type="button">获取验证码</button></div>`,
		],
		[
			'an English heading toggle in a form',
			`<form><div class="tabs"><h4 class="tab active">Text message</h4><h4 class="tab">Authenticator app</h4></div>${singleOtp}<button type="button">Send code</button></form>`,
		],
		[
			'an authenticator section beside the SMS block of a form',
			`<form><div class="block"><h3>Authenticator app</h3><p>Not set up.</p></div><div class="block"><p>Verify your phone number</p><div class="row">${singleOtp}<button type="button">Send code</button></div></div></form>`,
		],
		[
			'an authenticator section beside the SMS section of a card',
			`<div class="card"><h2>Two-factor authentication</h2><div class="section"><h4>Authenticator app</h4><p>Configured on your phone.</p></div><div class="section"><div class="title">SMS</div><div class="row">${singleOtp}<button type="button">Send code</button></div></div></div>`,
		],
		[
			'an accordion of methods with the authenticator collapsed',
			`<form><div class="method"><h4>Authenticator app</h4></div><div class="method open"><h4>Text message</h4><div class="row">${singleOtp}<button type="button">Send code</button></div></div></form>`,
		],
	])('requires explicit focus beside a first send with %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});

	it.each([
		[
			'a card subtitle',
			`<div class="card"><h2>Two-step verification</h2><h3>Authenticator app</h3><div class="field">${singleOtp}</div><button type="button">Send code</button></div>`,
		],
		[
			'a form title',
			`<form><h2>Authenticator app</h2><h3>Enter the 6-digit code</h3>${singleOtp}<button type="button">Send code</button></form>`,
		],
		[
			'the only content of a card header block',
			`<div class="card"><h2>Two-factor authentication</h2><div class="card-header"><h3>Authenticator app</h3></div><div class="card-body"><div class="row">${singleOtp}<button type="button">Send code</button></div></div></div>`,
		],
		[
			'the card title beside a help block whose heading names the phone',
			`<div class="wrap"><div class="card"><h2>Authenticator app</h2><div class="row">${singleOtp}<button type="button">Send code</button></div></div><div class="help"><h3>Lost your phone?</h3><p>Use one of your recovery codes.</p></div></div>`,
		],
	])('keeps a single field unique beside a first send with an authenticator heading as %s', (_name, html) => {
		renderVisible(html);
		expectUniqueFill();
	});

	it.each([
		['without a send button', cnCode, ''],
		[
			'with a field naming the authenticator beside a send button',
			'<input placeholder="请输入身份验证器中的验证码" autocomplete="one-time-code">',
			'<button type="button">获取验证码</button>',
		],
	])('keeps a TOTP field unique under a heading toggle with the authenticator tab selected %s', (_name, field, send) => {
		renderVisible(
			`<div class="verify-box"><div class="title">安全验证</div><div class="tabs"><h4 class="tab">短信验证</h4><h4 class="tab active">身份验证器</h4></div><div class="field">${field}</div>${send}</div>`,
		);
		expectUniqueFill();
	});
});

describe('wording that refuses authenticator codes', () => {
	const described = (help, button = 'Send code', label = 'Verification code') =>
		`<form><label for="otp">${label}</label><input id="otp" autocomplete="one-time-code" aria-describedby="otp-help"><p id="otp-help">${help}</p><button type="button">${button}</button></form>`;

	it.each([
		['Codes from authenticator apps are not accepted.', 'Send code', 'Verification code'],
		['Do not enter a code from your authenticator app.', 'Send code', 'Verification code'],
		['不支持身份验证器生成的验证码', '获取验证码', '验证码'],
		["Authenticator codes can't be used here.", 'Send code', 'Verification code'],
		['Authenticator app codes do not work for this step.', 'Send code', 'Verification code'],
		['身份验证器中的验证码无法使用', '获取验证码', '验证码'],
		['Do not enter the 6-digit code from your authenticator app.', 'Send code', 'Verification code'],
		["Please don't use codes generated by third-party authenticator apps.", 'Send code', 'Verification code'],
		['请勿使用 Google Authenticator 等第三方应用生成的验证码', '获取验证码', '验证码'],
		['Never enter a one-time code from an authenticator app here.', 'Send code', 'Verification code'],
		['Do not enter the verification code generated by your Microsoft Authenticator app.', 'Send code', 'Verification code'],
		['不要使用 Microsoft Authenticator 中的验证码', '获取验证码', '验证码'],
		['If you use a security key, authenticator codes do not work here.', 'Send code', 'Verification code'],
		["When signing in from a new device, authenticator codes won't work.", 'Send code', 'Verification code'],
	])('requires explicit focus beside a first send when the field description says "%s"', (help, button, label) => {
		renderVisible(described(help, button, label));
		expectFocusedAmbiguous();
	});

	it('requires explicit focus beside a first send when the label says authenticator codes are not accepted', () => {
		renderVisible(
			'<form><label for="otp">Verification code (authenticator codes not accepted)</label><input id="otp" autocomplete="one-time-code"><button type="button">Send code</button></form>',
		);
		expectFocusedAmbiguous();
	});

	it('requires explicit focus beside a send button naming its channel when a sentence refuses authenticator codes', () => {
		renderVisible(`<form>${singleOtp}<p>Authenticator codes are not accepted.</p><button type="button">Text me a code</button></form>`);
		expectFocusedAmbiguous();
	});

	// Each source of the field's own wording is judged on its own: a validation
	// message or input hint beside the label "Authenticator code" is no refusal,
	// and neither is one that names the authenticator code as invalid or empty,
	// says what to do when it does not work, or asks for one not used before.
	it.each([
		['Code is not valid', 'Send code', 'Authenticator code'],
		['验证码不能为空', '获取验证码', '身份验证器验证码'],
		['Do not enter spaces', 'Send code', 'Authenticator code'],
		['The authenticator code is not valid', 'Send code', 'Authenticator code'],
		['身份验证器验证码不能为空', '获取验证码', '身份验证器验证码'],
		["If your authenticator code doesn't work, check your device time.", 'Send code', 'Authenticator code'],
		['身份验证器的验证码无法使用时，请检查手机时间', '获取验证码', '身份验证器验证码'],
		["Enter a code from your authenticator app that you haven't used before.", 'Send code', 'Authenticator code'],
	])('keeps an authenticator field unique beside a first send when its description says "%s"', (help, button, label) => {
		renderVisible(described(help, button, label));
		expectUniqueFill();
	});

	// Guards the per-source refusal check in inputNamesAuthenticator: joined
	// with the label, this hint would read "Never enter this code on another site
	// Authenticator code", a refusal, while neither source on its own is one.
	it('keeps an authenticator field unique beside a first send when a hint reads as a refusal only joined with the label', () => {
		renderVisible(described('Never enter this code on another site', 'Send code', 'Authenticator code'));
		expectUniqueFill();
	});

	// An instruction not to enter something is a refusal only when the
	// authenticator follows it, and never when its object is a formatting word.
	it.each([
		[
			'label "Enter the code from your authenticator app (do not enter spaces)"',
			'<label for="otp">Enter the code from your authenticator app (do not enter spaces)</label><input id="otp" autocomplete="one-time-code"><button type="button">Send code</button>',
		],
		[
			'placeholder 请输入身份验证器中的6位验证码，不要输入空格',
			'<input id="otp" placeholder="请输入身份验证器中的6位验证码，不要输入空格" autocomplete="one-time-code"><button type="button">获取验证码</button>',
		],
	])('keeps an authenticator field unique beside a first send with the %s', (_name, html) => {
		renderVisible(`<form>${html}</form>`);
		expectUniqueFill();
	});

	// A formatting word right after "enter" is no refusal, even when the
	// authenticator follows later in the same sentence.
	it('keeps an authenticator field unique beside a first send when a formatting hint names the authenticator later in the sentence', () => {
		renderVisible(described("Don't enter spaces in the code from your authenticator app", 'Send code', 'Authenticator code'));
		expectUniqueFill();
	});
});

describe('sentences about a backup or recovery code', () => {
	const authOtp = '<label for="otp">Authenticator code</label><input id="otp" autocomplete="one-time-code">';

	it.each(['手机丢了？请查看邮箱中的恢复码', '手机丢了？请查看您的邮箱获取备用码', '请查看短信中的恢复码'])(
		'keeps an authenticator field unique beside "%s"',
		(text) => {
			renderVisible(`<form>${authOtp}<p>${text}</p></form>`);
			expectUniqueFill();
		},
	);

	it.each([
		['Enter the code we sent to your phone or one of your backup codes.', singleOtp],
		['请输入短信验证码或备用码', cnCode],
		['请输入发送至 138****1234 的验证码，或使用恢复码', cnCode],
		['Enter the code we texted to (***) ***-1234, or use a recovery code', singleOtp],
		['We emailed a code to j***@example.com, or use a recovery code.', singleOtp],
	])('still requires explicit focus when "%s" also names the delivered code', (text, field) => {
		renderVisible(`<form>${field}<p>${text}</p></form>`);
		expectFocusedAmbiguous();
	});
});

describe('check-your-inbox wording without a code word', () => {
	it.each(['Check your inbox.', 'Check your texts.'])('requires explicit focus beside "%s"', (text) => {
		renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
		expectFocusedAmbiguous();
	});

	it.each(['Check your email settings.', 'Check your email address in account settings.'])(
		'keeps a single field unique beside "%s"',
		(text) => {
			renderVisible(`<form><p>${text}</p>${singleOtp}</form>`);
			expectUniqueFill();
		},
	);
});

describe('alerts showing only where the code went', () => {
	it.each([
		[
			'a masked number',
			`<div class="card"><h2>安全验证</h2><div role="alert">138****1234 <a href="#resend">重新发送</a></div><div class="field">${cnCode}</div></div>`,
		],
		[
			'a masked email address',
			`<div class="card"><h2>Verify</h2><div role="alert">j***@example.com <a href="#resend">Resend</a></div><div class="field">${singleOtp}</div></div>`,
		],
	])('requires explicit focus with a resend in an alert showing %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});

describe('email-code guidance in a card header or alert', () => {
	it.each([
		[
			'an alert asking to check the email address',
			`<div class="card"><h2>邮箱验证</h2><div role="alert">请确认邮箱地址是否正确 <a href="#resend">重新发送</a></div><div class="field">${cnCode}</div></div>`,
		],
		[
			'a header pointing to the spam folder',
			`<div class="card"><header>Check your spam folder or confirm your email address. <a href="#resend">Resend email</a></header><h2>Security check</h2><div class="field">${singleOtp}</div></div>`,
		],
	])('requires explicit focus with a resend in %s', (_name, html) => {
		renderVisible(html);
		expectFocusedAmbiguous();
	});
});
