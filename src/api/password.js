/**
 * 修改密码 API 处理模块
 */

import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { checkRateLimit, createRateLimitResponse, getClientIdentifier, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { getLogger } from '../utils/logger.js';
import { ValidationError, AuthenticationError, ConfigurationError, ErrorFactory, errorToResponse, logError } from '../utils/errors.js';

// KV 存储键
const KV_USER_PASSWORD_KEY = 'user_password';

// 密码配置
const PASSWORD_MIN_LENGTH = 8;
const PBKDF2_ITERATIONS = 100000;

/**
 * 验证密码强度
 * @param {string} password - 密码
 * @returns {Object} { valid: boolean, message: string }
 */
function validatePasswordStrength(password) {
	if (!password || password.length < PASSWORD_MIN_LENGTH) {
		return {
			valid: false,
			message: `密码长度至少为 ${PASSWORD_MIN_LENGTH} 位`,
		};
	}

	const hasUpperCase = /[A-Z]/.test(password);
	const hasLowerCase = /[a-z]/.test(password);
	const hasNumber = /[0-9]/.test(password);
	const hasSymbol = /[^A-Za-z0-9]/.test(password);

	if (!hasUpperCase) {
		return { valid: false, message: '密码必须包含至少一个大写字母' };
	}
	if (!hasLowerCase) {
		return { valid: false, message: '密码必须包含至少一个小写字母' };
	}
	if (!hasNumber) {
		return { valid: false, message: '密码必须包含至少一个数字' };
	}
	if (!hasSymbol) {
		return { valid: false, message: '密码必须包含至少一个特殊字符' };
	}

	return { valid: true, message: '密码强度符合要求' };
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} storedHash - 存储的哈希值（格式：salt$hash）
 * @returns {Promise<boolean>} 是否匹配
 */
async function verifyPassword(password, storedHash) {
	try {
		const [saltB64, hashB64] = storedHash.split('$');
		if (!saltB64 || !hashB64) {
			return false;
		}

		const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
		const encoder = new TextEncoder();
		const passwordBuffer = encoder.encode(password);
		const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);

		const hashBuffer = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: salt,
				iterations: PBKDF2_ITERATIONS,
				hash: 'SHA-256',
			},
			keyMaterial,
			256,
		);

		const calculatedHashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
		return calculatedHashB64 === hashB64;
	} catch {
		return false;
	}
}

/**
 * 使用 PBKDF2 加密密码
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 加密后的密码（格式：salt$hash）
 */
async function hashPassword(password) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const encoder = new TextEncoder();
	const passwordBuffer = encoder.encode(password);
	const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);

	const hashBuffer = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256',
		},
		keyMaterial,
		256,
	);

	const saltB64 = btoa(String.fromCharCode(...salt));
	const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
	return `${saltB64}$${hashB64}`;
}

/**
 * 处理修改密码请求
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Response>} 响应
 */
export async function handleChangePassword(request, env) {
	const logger = getLogger(env);

	try {
		// 速率限制
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('修改密码速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const { currentPassword, newPassword, confirmPassword } = await request.json();

		// 参数验证
		if (!currentPassword || !newPassword || !confirmPassword) {
			throw new ValidationError('请提供当前密码、新密码和确认密码', {
				missing: [!currentPassword && 'currentPassword', !newPassword && 'newPassword', !confirmPassword && 'confirmPassword'].filter(
					Boolean,
				),
			});
		}

		// 验证新密码一致
		if (newPassword !== confirmPassword) {
			throw new ValidationError('两次输入的新密码不一致', {
				issue: 'password_mismatch',
			});
		}

		// 检查 KV 存储
		if (!env.SECRETS_KV) {
			throw new ConfigurationError('服务器未配置 KV 存储', {
				missingConfig: 'SECRETS_KV',
			});
		}

		// 获取当前密码哈希
		const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);
		if (!storedPasswordHash) {
			throw new ConfigurationError('未设置密码，请先完成首次设置', {
				setupRequired: true,
			});
		}

		// 验证当前密码
		const isValid = await verifyPassword(currentPassword, storedPasswordHash);
		if (!isValid) {
			throw ErrorFactory.passwordIncorrect({
				operation: 'change_password',
			});
		}

		// 验证新密码强度
		const validation = validatePasswordStrength(newPassword);
		if (!validation.valid) {
			throw ErrorFactory.passwordWeak(validation.message, {
				operation: 'change_password',
			});
		}

		// 加密新密码
		const newPasswordHash = await hashPassword(newPassword);

		// 更新 KV
		await env.SECRETS_KV.put(KV_USER_PASSWORD_KEY, newPasswordHash);

		logger.info('密码修改成功', {
			changedAt: new Date().toISOString(),
		});

		return createJsonResponse(
			{
				success: true,
				message: '密码修改成功，请重新登录',
			},
			200,
			request,
		);
	} catch (error) {
		if (error instanceof ValidationError || error instanceof AuthenticationError || error instanceof ConfigurationError) {
			logError(error, logger, { operation: 'change_password' });
			return errorToResponse(error, request);
		}

		logger.error(
			'修改密码失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('修改密码失败', '处理修改密码请求时发生错误', 500, request);
	}
}
