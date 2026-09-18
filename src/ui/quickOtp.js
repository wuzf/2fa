import { dialogIcon } from './dialogIcons.js';
import { getStandaloneHead } from './standalone.js';
import { getQuickOtpScript } from './scripts/quickOtp.js';
import { getQuickOtpStyles } from './styles/quickOtp.js';

/** Public entry form; API clients still receive the plain-text usage response. */
export function createOtpEntryPage() {
	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>${getStandaloneHead('OTP 生成 - 2FA', getQuickOtpStyles())}</head>
<body>
  <main class="otp-shell" aria-labelledby="otpEntryTitle">
    <a class="otp-brand" href="/">${dialogIcon('key')}<span>2FA</span></a>
    <section class="standalone-card otp-card otp-entry" aria-label="输入验证器密钥">
      <header class="otp-header">
        <div class="otp-header-icon">${dialogIcon('lock')}</div>
        <div>
          <h1 class="page-title" id="otpEntryTitle">生成验证码</h1>
          <p class="otp-subtitle">查看当前与下一期验证码</p>
        </div>
      </header>
      <form id="otpEntryForm">
        <label class="page-label" for="s">Base32 密钥</label>
        <input class="page-input" id="s" name="secret" aria-describedby="otpEntryHint" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴或输入验证器密钥" required>
        <p class="otp-entry-hint" id="otpEntryHint">支持粘贴带空格的密钥</p>
        <button class="page-button" type="submit">生成验证码</button>
      </form>
    </section>
    <nav class="otp-footer" aria-label="页面导航">
      <a class="page-link" href="/">返回首页</a>
    </nav>
  </main>
  <script>
    document.getElementById('otpEntryForm').addEventListener('submit', function (event) {
      event.preventDefault();
      const secret = document.getElementById('s').value.trim().replace(/\\s+/g, '');
      if (secret) location.href = '/otp/' + encodeURIComponent(secret);
    });
  </script>
</body>
</html>`,
		{
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'public, max-age=300',
				Vary: 'Accept',
				'X-Content-Type-Options': 'nosniff',
			},
		},
	);
}

/** Render current/next TOTP codes or a fixed-counter HOTP code. */
export function createQuickOtpPage(otp, options = {}) {
	const {
		period = 30,
		remainingTime = 30,
		type = 'TOTP',
		counter = 0,
		nextToken = '',
		followingToken = '',
		validUntil = 0,
		serverTime,
	} = options;
	const isHOTP = String(type).toUpperCase() === 'HOTP';
	const safeCode = (value) => (/^([0-9]{6}|[0-9]{8})$/.test(String(value)) ? String(value) : '');
	const current = safeCode(otp);
	const next = safeCode(nextToken);
	const totalTime = [30, 60, 120].includes(period) ? period : 30;
	const remaining =
		Number.isFinite(serverTime) && Number.isFinite(validUntil) && validUntil > 0
			? (validUntil - serverTime) / 1000
			: Number.isFinite(remainingTime)
				? remainingTime
				: totalTime;
	const counterLabel = Number.isSafeInteger(counter) && counter >= 0 ? counter : 0;
	const copyIcon =
		'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
	const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>${getStandaloneHead('验证码 - 2FA', getQuickOtpStyles())}</head>
<body>
  <main class="otp-shell" aria-labelledby="otpTitle">
    <a class="otp-brand" href="/">${dialogIcon('key')}<span>2FA</span></a>
    <section class="standalone-card otp-card" aria-label="验证码">
      ${isHOTP ? '' : `<div class="progress-container"><div class="progress-bar" id="progress" role="progressbar" aria-label="验证码剩余有效期" aria-valuemin="0" aria-valuemax="100"></div></div>`}
      <header class="otp-header">
        <div class="otp-header-icon">${dialogIcon(isHOTP ? 'key' : 'clock')}</div>
        <div>
          <h1 class="page-title" id="otpTitle">两步验证码</h1>
          <p class="otp-subtitle">${isHOTP ? '基于计数器 · HOTP' : '每 ' + totalTime + ' 秒自动更新'}</p>
        </div>
      </header>
      <div class="otp-current-label">
        <span>当前验证码</span>
        ${isHOTP ? '' : '<p class="countdown" id="countdown"></p>'}
      </div>
      <button class="token-button token" id="token" type="button" aria-label="复制当前验证码" title="复制当前验证码">
        <span class="token-value" id="tokenValue">${current || '------'}</span>
        ${copyIcon}
      </button>
      ${
				isHOTP
					? `<p class="page-notice">计数器：${counterLabel}。此链接的验证码不会随时间变化，复制不会增加计数器。</p>`
					: `<div class="otp-next">
        <span class="otp-next-label">下一个验证码</span>
        <button class="token-button next-token" id="nextToken" type="button" aria-label="复制下一个验证码" title="复制下一个验证码">
          <span class="next-token-value" id="nextTokenValue">${next}</span>
          ${copyIcon}
        </button>
      </div>`
			}
      <p class="copied-message" id="copied" role="status" aria-live="polite">点击验证码即可复制</p>
      ${
				isHOTP
					? ''
					: `<div class="refresh-status">
        <p id="refreshMessage" role="status" aria-live="polite"></p>
        <button class="retry-button" id="retry" type="button" hidden>重试更新</button>
      </div>`
			}
    </section>
    <nav class="otp-footer" aria-label="页面导航">
      <a class="page-link" href="/otp">输入其他密钥</a>
      <a class="page-link" href="/">返回首页</a>
    </nav>
  </main>
  <script>${getQuickOtpScript({
		isHOTP,
		period: totalTime,
		remainingTime: remaining,
		validUntil: Number.isFinite(validUntil) ? validUntil : 0,
		followingToken: safeCode(followingToken),
	})}</script>
</body>
</html>`;

	return new Response(htmlContent, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Referrer-Policy': 'no-referrer',
		},
	});
}

/** Use the generated code's period, even if generation crossed its expiry. */
export function calculateRemainingTime(period = 30, generatedAt = Math.floor(Date.now() / 1000)) {
	const currentCounter = Math.floor(generatedAt / period);
	const expirationTime = (currentCounter + 1) * period * 1000;
	return Math.max(0, (expirationTime - Date.now()) / 1000);
}
