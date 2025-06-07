/**
 * 快速 OTP 显示页面模块
 * 提供简洁的 HTML 页面用于显示 OTP 验证码
 * 与原 2fa 项目界面完全一致
 */

/**
 * 创建简单的 HTML 页面用于显示 OTP 验证码（原始风格）
 * @param {string} otp - 要显示的 OTP 验证码
 * @param {Object} options - OTP 生成选项
 * @param {number} options.period - 时间周期（秒），默认：30
 * @param {number} options.remainingTime - 剩余时间（秒）
 * @param {string} options.type - OTP 类型（TOTP/HOTP）
 * @returns {Response} HTML 响应
 */
export function createQuickOtpPage(otp, options = {}) {
	const { period = 30, remainingTime = 30, type: _type = 'TOTP' } = options;

	const htmlContent = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>2FA OTP Generator</title>
    <style>
      body {
        font-family: monospace;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #1a1a1a;
        color: #fff;
      }
      .container {
        text-align: center;
        padding: 20px;
        max-width: 400px;
      }
      .token {
        font-size: 48px;
        font-weight: bold;
        letter-spacing: 8px;
        margin: 20px 0;
        color: #4CAF50;
        cursor: pointer;
        user-select: none;
        transition: transform 0.1s;
      }
      .token:hover {
        transform: scale(1.05);
      }
      .token:active {
        transform: scale(0.95);
      }
      .copied-message {
        font-size: 14px;
        color: #4CAF50;
        opacity: 0;
        transition: opacity 0.3s;
        margin-top: 10px;
        height: 20px;
      }
      .copied-message.show {
        opacity: 1;
      }
      .progress-container {
        width: 100%;
        height: 6px;
        background: #333;
        border-radius: 3px;
        overflow: hidden;
        margin-top: 20px;
      }
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #4CAF50, #2196F3);
        border-radius: 3px;
        transition: width 1s linear;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="token" id="token" title="点击复制">${otp}</div>
      <div class="copied-message" id="copied">已复制!</div>
      <div class="progress-container">
        <div class="progress-bar" id="progress"></div>
      </div>
    </div>
    <script>
      const tokenEl = document.getElementById('token');
      const copiedEl = document.getElementById('copied');
      const totalTime = ${period};
      let remaining = ${remainingTime};
      const progressBar = document.getElementById('progress');

      // 点击复制功能
      tokenEl.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(tokenEl.textContent);
          copiedEl.classList.add('show');
          setTimeout(() => {
            copiedEl.classList.remove('show');
          }, 2000);
        } catch (err) {
          console.error('复制失败:', err);
        }
      });

      // 设置初始进度
      progressBar.style.width = (remaining / totalTime * 100) + '%';

      const interval = setInterval(() => {
        remaining--;
        progressBar.style.width = (remaining / totalTime * 100) + '%';

        if (remaining <= 0) {
          clearInterval(interval);
          location.reload();
        }
      }, 1000);
    </script>
  </body>
</html>
  `;

	return new Response(htmlContent, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
			'Access-Control-Allow-Origin': '*', // 公开 API 允许跨域访问
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
		},
	});
}

/**
 * Calculate remaining time for current TOTP period
 * @param {number} period - Time period in seconds
 * @returns {number} Remaining seconds
 */
export function calculateRemainingTime(period = 30) {
	const epochTime = Math.floor(Date.now() / 1000);
	const currentCounter = Math.floor(epochTime / period);
	const expirationTime = (currentCounter + 1) * period;
	return expirationTime - epochTime;
}
