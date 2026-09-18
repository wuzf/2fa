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
 * - preview: 1 (JSON 模式下返回 TOTP 后续两期验证码及有效时间)
 *
 * @param {string} secret - Base32密钥
 * @param {Request} request - HTTP请求对象（可选，用于获取参数）
 * @returns {Response} HTTP响应
 */
export async function handleGenerateOTP(secret, request = null) {
	// 动态导入（减少初始加载）
	const { validateBase32, validateOTPParams } = await import('../../utils/validation.js');
	const { generateOTP } = await import('../../otp/generator.js');
	const { createQuickOtpPage, createOtpEntryPage } = await import('../../ui/quickOtp.js');

	if (!secret) {
		// 如果没有密钥，根据 Accept 头返回友好页面或纯文本使用说明
		const origin = request ? new URL(request.url).origin : '';
		const accept = request?.headers.get('Accept') || '';
		const wantsHtml = accept.includes('text/html');

		if (wantsHtml) {
			return createOtpEntryPage();
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
		let preview = false;

		if (request) {
			const url = new URL(request.url);
			type = (url.searchParams.get('type') || 'TOTP').toUpperCase();
			digits = parseInt(url.searchParams.get('digits')) || 6;
			period = parseInt(url.searchParams.get('period')) || 30;
			algorithm = url.searchParams.get('algorithm') || 'SHA1';
			const counterParam = url.searchParams.get('counter');
			counter = counterParam === null || counterParam === '' ? 0 : Number(counterParam);
			format = url.searchParams.get('format') || 'html'; // 支持 ?format=json
			preview = url.searchParams.get('preview') === '1';

			// 验证OTP参数
			const otpValidation = validateOTPParams({ type, digits, period, algorithm, counter });
			if (!otpValidation.valid) {
				return createErrorResponse('OTP参数验证失败', otpValidation.error, 400, request);
			}
		}

		const loadTime = Math.floor(Date.now() / 1000);
		const options = { type, digits, period, algorithm, counter };
		const otp = await generateOTP(secret, loadTime, options);

		// 默认 JSON 保持单验证码结构；HOTP 只读取请求指定的计数器。
		if (format === 'json' && (!preview || type === 'HOTP')) {
			return createJsonResponse({ token: otp }, 200, request, { 'Cache-Control': 'no-store' });
		}

		// 三个验证码固定使用同一时间基准，避免生成过程中跨周期导致错配。
		// 多预备一期，在下期码提升为当前码时即可连续显示新的下期码。
		const nextToken = type === 'TOTP' ? await generateOTP(secret, loadTime + period, options) : null;
		const followingToken = type === 'TOTP' ? await generateOTP(secret, loadTime + period * 2, options) : null;
		const validUntil = type === 'TOTP' ? (Math.floor(loadTime / period) + 1) * period * 1000 : null;
		const serverTime = Date.now();
		if (format === 'json') {
			return createJsonResponse({ token: otp, nextToken, followingToken, period, validUntil, serverTime }, 200, request, {
				'Cache-Control': 'no-store',
			});
		}

		const remainingTime = type === 'TOTP' ? Math.max(0, (validUntil - serverTime) / 1000) : 0;
		return createQuickOtpPage(otp, {
			period,
			remainingTime,
			type,
			counter,
			nextToken,
			followingToken,
			validUntil,
			serverTime,
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
