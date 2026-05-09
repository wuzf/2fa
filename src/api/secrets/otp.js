/**
 * OTP 生成处理器
 *
 * 包含功能:
 * - handleGenerateOTP: 生成 OTP（公开 API，支持高级参数）
 *
 * 特点:
 * - 公开访问（无需认证）
 * - 支持 CORS（跨域访问）
 * - 支持 HTML 和 JSON 两种响应格式
 * - 支持高级 OTP 参数（type, digits, period, algorithm, counter）
 */

import { createJsonResponse, createErrorResponse } from '../../utils/response.js';
import { getLogger } from '../../utils/logger.js';

/**
 * 处理生成OTP（支持高级参数）
 *
 * 公开 API，无需认证，允许跨域访问
 *
 * 支持的查询参数:
 * - type: TOTP|HOTP (默认 TOTP)
 * - digits: 6|8 (默认 6)
 * - period: 30|60|120 (默认 30，仅 TOTP)
 * - algorithm: SHA1|SHA256|SHA512 (默认 SHA1)
 * - counter: 非负整数 (默认 0，仅 HOTP)
 * - format: html|json (默认 html)
 *
 * @param {string} secret - Base32密钥
 * @param {Request} request - HTTP请求对象（可选，用于获取参数）
 * @returns {Response} HTTP响应
 */
export async function handleGenerateOTP(secret, request = null) {
	// 动态导入（减少初始加载）
	const { validateBase32, validateOTPParams } = await import('../../utils/validation.js');
	const { generateOTP } = await import('../../otp/generator.js');
	const { createQuickOtpPage, calculateRemainingTime } = await import('../../ui/quickOtp.js');

	if (!secret) {
		// 如果没有密钥，根据 Accept 头返回友好页面或纯文本使用说明
		const origin = request ? new URL(request.url).origin : '';
		const accept = request?.headers.get('Accept') || '';
		const wantsHtml = accept.includes('text/html');

		if (wantsHtml) {
			// 浏览器访问：渲染极简引导页（无登录态可用），引导用户输入密钥跳到 /otp/{secret}
			const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>2FA OTP 生成 - 访客模式</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f5f7fa; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { background: #fff; border-radius: 12px; padding: 32px 28px; box-shadow: 0 8px 32px rgba(0,0,0,.08); max-width: 420px; width: 100%; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { color: #5a6268; margin: 0 0 20px; line-height: 1.6; font-size: 14px; }
  label { display: block; font-size: 14px; margin-bottom: 6px; color: #2d3748; font-weight: 500; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e0; border-radius: 6px; font-size: 15px; font-family: ui-monospace, SFMono-Regular, monospace; box-sizing: border-box; }
  input:focus { outline: none; border-color: #2196f3; box-shadow: 0 0 0 3px rgba(33,150,243,.15); }
  button { margin-top: 16px; width: 100%; padding: 11px; background: #2196f3; color: #fff; border: 0; border-radius: 6px; font-size: 15px; cursor: pointer; }
  button:hover { background: #1976d2; }
  .back { display: block; text-align: center; margin-top: 14px; font-size: 13px; color: #5a6268; text-decoration: none; }
  .back:hover { color: #2196f3; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a202c; }
    .card { background: #2d3748; }
    h1 { color: #e2e8f0; }
    p { color: #a0aec0; }
    label { color: #e2e8f0; }
    input { background: #1a202c; color: #e2e8f0; border-color: #4a5568; }
    .back { color: #a0aec0; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>🔐 OTP 生成（访客模式）</h1>
    <p>无需登录，输入 Base32 密钥即可在线生成 TOTP 验证码。</p>
    <form onsubmit="event.preventDefault(); var s=document.getElementById('s').value.trim().replace(/\\s+/g,''); if(s) location.href='${origin}/otp/'+encodeURIComponent(s);">
      <label for="s">Base32 密钥</label>
      <input id="s" name="secret" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例如 JBSWY3DPEHPK3PXP" required>
      <button type="submit">生成 OTP</button>
    </form>
    <a class="back" href="/">← 返回登录页</a>
  </main>
</body>
</html>`;
			return new Response(html, {
				status: 200,
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'Cache-Control': 'public, max-age=300',
					Vary: 'Accept',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}

		// 非浏览器（curl / API 调用）保留原有 400 + 文本说明
		return new Response(
			`Missing secret parameter!\n\nUsage: ${origin}/otp/YOUR_SECRET_KEY\nExample: ${origin}/otp/JBSWY3DPEHPK3PXP\n\nAPI Mode: ${origin}/otp/YOUR_SECRET_KEY?format=json\n\nAdvanced Options:\n- ?type=TOTP|HOTP\n- ?digits=6|8\n- ?period=30|60\n- ?algorithm=SHA1|SHA256|SHA512\n- ?counter=0 (for HOTP)`,
			{
				status: 400,
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'Access-Control-Allow-Origin': '*', // 公开 API 允许跨域
					'Access-Control-Allow-Methods': 'GET, OPTIONS',
					'Cache-Control': 'no-store', // 不缓存错误响应
				},
			},
		);
	}

	const validation = validateBase32(secret);
	if (!validation.valid) {
		return createErrorResponse(
			'密钥格式错误',
			`密钥"${secret}"不是有效的Base32格式。Base32密钥应只包含字母A-Z和数字2-7，且长度至少8位`,
			400,
			request,
		);
	}

	try {
		// 从请求参数中获取高级设置
		let digits = 6;
		let period = 30;
		let algorithm = 'SHA1';
		let type = 'TOTP';
		let counter = 0;
		let format = 'html'; // 默认HTML格式

		if (request) {
			const url = new URL(request.url);
			type = url.searchParams.get('type') || 'TOTP';
			digits = parseInt(url.searchParams.get('digits')) || 6;
			period = parseInt(url.searchParams.get('period')) || 30;
			algorithm = url.searchParams.get('algorithm') || 'SHA1';
			counter = parseInt(url.searchParams.get('counter')) || 0;
			format = url.searchParams.get('format') || 'html'; // 支持 ?format=json

			// 验证OTP参数
			const otpValidation = validateOTPParams({ type, digits, period, algorithm, counter });
			if (!otpValidation.valid) {
				return createErrorResponse('OTP参数验证失败', otpValidation.errors.join('; '), 400, request);
			}
		}

		const loadTime = Math.floor(Date.now() / 1000);
		const otp = await generateOTP(secret, loadTime, { type, digits, period, algorithm, counter });

		// 如果请求JSON格式，返回JSON
		if (format === 'json') {
			return createJsonResponse({ token: otp }, 200, request);
		}

		// 默认返回漂亮的HTML页面
		const remainingTime = type === 'TOTP' ? calculateRemainingTime(period) : 0;
		return createQuickOtpPage(otp, {
			period,
			remainingTime,
			type,
		});
	} catch (error) {
		const logger = getLogger(null);
		logger.error(
			'OTP生成失败',
			{
				secretPreview: secret ? secret.substring(0, 8) + '...' : 'null',
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('OTP生成失败', `生成验证码时发生内部错误：${error.message}。请检查密钥格式是否正确或稍后重试`, 500, request);
	}
}
