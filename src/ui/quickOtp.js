import { dialogIcon } from './dialogIcons.js';
import { getStandaloneHead } from './standalone.js';
import { PROGRESS_GRADIENT, PROGRESS_HEIGHT } from './styles/progress.js';

/** Public entry form; API clients still receive the plain-text usage response. */
export function createOtpEntryPage() {
	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>${getStandaloneHead('OTP 生成 - 2FA')}</head>
<body>
  <main class="standalone-card">
    <div class="page-icon">${dialogIcon('key')}</div>
    <h1 class="page-title">生成验证码</h1>
    <p class="page-description">无需登录，输入 Base32 密钥即可获取验证码。</p>
    <form id="otpEntryForm">
      <label class="page-label" for="s">Base32 密钥</label>
      <input class="page-input" id="s" name="secret" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例如 JBSWY3DPEHPK3PXP" required>
      <div class="page-actions">
        <button class="page-button" type="submit">生成验证码</button>
        <a class="page-link" href="/">返回首页</a>
      </div>
    </form>
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

/** Render a TOTP countdown or a fixed-counter HOTP code. */
export function createQuickOtpPage(otp, options = {}) {
	const { period = 30, remainingTime = 30, type = 'TOTP', counter = 0 } = options;
	const isHOTP = String(type).toUpperCase() === 'HOTP';
	const safeOTP = String(otp).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const counterLabel = Number.isSafeInteger(counter) && counter >= 0 ? counter : 0;
	const styles = `
    .token {
      display: block;
      width: 100%;
      padding: 16px 0;
      margin: 8px 0 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--page-text);
      font: 600 clamp(28px, 8vw, 44px)/1.3 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
      font-variant-numeric: tabular-nums;
      letter-spacing: 2px;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }
    .token:hover { color: var(--page-brand); }
    .token:active { background: var(--page-hover); }
    .copied-message { min-height: 20px; margin: 0 0 16px; color: var(--page-muted); font-size: 12px; }
    .copied-message.error { color: var(--page-danger); }
    .progress-container { height: ${PROGRESS_HEIGHT}; background: var(--page-line); overflow: hidden; }
    .progress-bar { height: 100%; width: 100%; background: ${PROGRESS_GRADIENT}; transform-origin: left; }
    .countdown { margin: 8px 0 0; color: var(--page-muted); font-size: 12px; }
  `;
	const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>${getStandaloneHead('验证码 - 2FA', styles)}</head>
<body>
  <main class="standalone-card">
    <div class="page-icon">${dialogIcon(isHOTP ? 'key' : 'clock')}</div>
    <h1 class="page-title">${isHOTP ? 'HOTP 验证码' : '验证码'}</h1>
    <button class="token" id="token" type="button" title="点击复制验证码" aria-label="复制验证码 ${safeOTP}">${safeOTP}</button>
    <p class="copied-message" id="copied" role="status" aria-live="polite">点击验证码复制</p>
    ${
			isHOTP
				? `<p class="page-notice">计数器：${counterLabel}。此链接的验证码不会随时间变化，复制不会增加计数器。</p>`
				: `<div class="progress-container">
      <div class="progress-bar" id="progress" role="progressbar" aria-label="验证码剩余有效期" aria-valuemin="0" aria-valuemax="100"></div>
    </div>
    <p class="countdown" id="countdown"></p>`
		}
    <div class="page-actions">
      <a class="page-link" href="/otp">输入其他密钥</a>
      <a class="page-link" href="/">返回首页</a>
    </div>
  </main>
  <script>
    const tokenEl = document.getElementById('token');
    const copiedEl = document.getElementById('copied');
    let copyMessageTimer = null;
    tokenEl.addEventListener('click', async function () {
      if (copyMessageTimer !== null) clearTimeout(copyMessageTimer);
      try {
        await navigator.clipboard.writeText(tokenEl.textContent);
        copiedEl.classList.remove('error');
        copiedEl.textContent = '验证码已复制';
      } catch {
        copiedEl.classList.add('error');
        copiedEl.textContent = '复制失败，请检查浏览器的剪贴板权限';
      }
      copyMessageTimer = setTimeout(function () {
        copiedEl.classList.remove('error');
        copiedEl.textContent = '点击验证码复制';
        copyMessageTimer = null;
      }, 2000);
    });
    ${
			isHOTP
				? ''
				: `
    const totalTime = ${Number(period)};
    const expiresAt = performance.now() + ${Number(remainingTime)} * 1000;
    const progressBar = document.getElementById('progress');
    const countdown = document.getElementById('countdown');
    let refreshing = false;
    function updateCountdown() {
      if (refreshing) return;
      const remaining = Math.max(0, Math.ceil((expiresAt - performance.now()) / 1000));
      const fraction = Math.min(1, remaining / totalTime);
      progressBar.style.transform = 'scaleX(' + fraction + ')';
      progressBar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      countdown.textContent = remaining > 0 ? remaining + ' 秒后更新' : '正在更新验证码…';
      if (remaining === 0) {
        refreshing = true;
        clearInterval(interval);
        location.reload();
      }
    }
    const interval = setInterval(updateCountdown, 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) updateCountdown();
    });
    updateCountdown();`
		}
  </script>
</body>
</html>`;

	return new Response(htmlContent, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
			'Access-Control-Allow-Origin': '*', // Public API allows cross-origin access.
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
		},
	});
}

/** Use the generated code's period, even if generation crossed its expiry. */
export function calculateRemainingTime(period = 30, generatedAt = Math.floor(Date.now() / 1000)) {
	const currentCounter = Math.floor(generatedAt / period);
	const expirationTime = (currentCounter + 1) * period * 1000;
	return Math.max(0, (expirationTime - Date.now()) / 1000);
}
