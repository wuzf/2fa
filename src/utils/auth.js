/**
 * 身份验证工具模块
 * 提供 JWT Token 认证功能，支持自动过期
 */

import { createErrorResponse } from './response.js';
import { checkRateLimit, createRateLimitResponse, getClientIdentifier, RATE_LIMIT_PRESETS } from './rateLimit.js';
import { getSecurityHeaders } from './security.js';
import { getLogger } from './logger.js';
import {
	ValidationError,
	AuthenticationError,
	AuthorizationError,
	ConflictError,
	ConfigurationError,
	ErrorFactory,
	errorToResponse,
	logError,
} from './errors.js';

// JWT 配置
const JWT_EXPIRY_DAYS = 30; // JWT 有效期：30天
const JWT_ALGORITHM = 'HS256';
const JWT_AUTO_REFRESH_THRESHOLD_DAYS = 7; // 剩余时间少于7天时自动续期

// Cookie 配置
const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = JWT_EXPIRY_DAYS * 24 * 60 * 60; // 30天（秒）

// KV 存储键
const KV_USER_PASSWORD_KEY = 'user_password';
const KV_SETUP_COMPLETED_KEY = 'setup_completed';

// 密码配置
const PASSWORD_MIN_LENGTH = 8;
const PBKDF2_ITERATIONS = 100000; // PBKDF2 迭代次数

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
 * 使用 PBKDF2 加密密码
 * ⚠️ 强制验证密码强度，不符合要求将抛出错误
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 加密后的密码（格式：salt$hash）
 * @throws {ValidationError} 密码强度不符合要求时抛出错误
 */
async function hashPassword(password) {
	// 🔒 强制验证密码强度（防御性编程）
	const validation = validatePasswordStrength(password);
	if (!validation.valid) {
		throw ErrorFactory.passwordWeak(validation.message, { password: '***' });
	}

	// 生成随机盐值
	const salt = crypto.getRandomValues(new Uint8Array(16));

	// 将密码转换为 ArrayBuffer
	const encoder = new TextEncoder();
	const passwordBuffer = encoder.encode(password);

	// 导入密码作为密钥
	const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);

	// 使用 PBKDF2 派生密钥
	const hashBuffer = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256',
		},
		keyMaterial,
		256, // 输出 256 位
	);

	// 将盐值和哈希值转换为 Base64
	const saltB64 = btoa(String.fromCharCode(...salt));
	const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

	// 返回格式：salt$hash
	return `${saltB64}$${hashB64}`;
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} storedHash - 存储的哈希值（格式：salt$hash）
 * @param {Object} env - 环境变量对象（可选，用于日志）
 * @returns {Promise<boolean>} 是否匹配
 */
async function verifyPassword(password, storedHash, env = null) {
	try {
		// 分离盐值和哈希值
		const [saltB64, hashB64] = storedHash.split('$');
		if (!saltB64 || !hashB64) {
			return false;
		}

		// 解码盐值
		const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));

		// 将密码转换为 ArrayBuffer
		const encoder = new TextEncoder();
		const passwordBuffer = encoder.encode(password);

		// 导入密码作为密钥
		const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);

		// 使用相同的盐值派生密钥
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

		// 将计算的哈希值转换为 Base64
		const calculatedHashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

		// 比较哈希值
		return calculatedHashB64 === hashB64;
	} catch (error) {
		if (env) {
			const logger = getLogger(env);
			logger.error(
				'密码验证失败',
				{
					errorMessage: error.message,
				},
				error,
			);
		}
		return false;
	}
}

/**
 * 生成 JWT Token
 * @param {Object} payload - 要编码的数据
 * @param {string} secret - 签名密钥
 * @param {number} expiryDays - 过期天数
 * @returns {Promise<string>} JWT token
 */
async function generateJWT(payload, secret, expiryDays = JWT_EXPIRY_DAYS) {
	const header = {
		alg: JWT_ALGORITHM,
		typ: 'JWT',
	};

	const now = Math.floor(Date.now() / 1000);
	const jwtPayload = {
		...payload,
		iat: now, // 签发时间
		exp: now + expiryDays * 24 * 60 * 60, // 过期时间
	};

	// Base64URL 编码
	const base64UrlEncode = (str) => {
		return btoa(String.fromCharCode(...new Uint8Array(typeof str === 'string' ? new TextEncoder().encode(str) : str)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
	};

	const headerB64 = base64UrlEncode(JSON.stringify(header));
	const payloadB64 = base64UrlEncode(JSON.stringify(jwtPayload));
	const data = `${headerB64}.${payloadB64}`;

	// 使用 HMAC-SHA256 签名
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

	const signatureB64 = base64UrlEncode(signature);
	return `${data}.${signatureB64}`;
}

/**
 * 验证并解析 JWT Token
 * @param {string} token - JWT token
 * @param {string} secret - 签名密钥
 * @param {Object} env - 环境变量对象（可选，用于日志）
 * @returns {Promise<Object|null>} 解析后的 payload，验证失败返回 null
 */
async function verifyJWT(token, secret, env = null) {
	const logger = env ? getLogger(env) : null;

	try {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return null;
		}

		const [headerB64, payloadB64, signatureB64] = parts;
		const data = `${headerB64}.${payloadB64}`;

		// Base64URL 解码
		const base64UrlDecode = (str) => {
			str = str.replace(/-/g, '+').replace(/_/g, '/');
			const pad = str.length % 4;
			if (pad) {
				str += '='.repeat(4 - pad);
			}
			const binary = atob(str);
			return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
		};

		// 验证签名
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);

		const signatureBytes = base64UrlDecode(signatureB64);
		const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data));

		if (!isValid) {
			if (logger) {
				logger.warn('JWT 签名验证失败');
			}
			return null;
		}

		// 解析 payload
		const payloadBytes = base64UrlDecode(payloadB64);
		const payloadJson = new TextDecoder().decode(payloadBytes);
		const payload = JSON.parse(payloadJson);

		// 检查是否过期
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp && payload.exp < now) {
			if (logger) {
				logger.warn('JWT 已过期', {
					exp: new Date(payload.exp * 1000).toISOString(),
					now: new Date(now * 1000).toISOString(),
				});
			}
			return null;
		}

		return payload;
	} catch (error) {
		if (logger) {
			logger.error(
				'JWT 验证失败',
				{
					errorMessage: error.message,
				},
				error,
			);
		}
		return null;
	}
}

/**
 * 创建 Set-Cookie header 值
 * @param {string} token - JWT token
 * @param {number} maxAge - Cookie 最大有效期（秒）
 * @returns {string} Set-Cookie header 值
 */
function createSetCookieHeader(token, maxAge = COOKIE_MAX_AGE) {
	const cookieAttributes = [
		`${COOKIE_NAME}=${token}`,
		`Max-Age=${maxAge}`,
		'Path=/',
		'HttpOnly', // 防止 XSS 攻击访问 Cookie
		'SameSite=Strict', // 防止 CSRF 攻击
		'Secure', // 仅在 HTTPS 下传输
	];

	return cookieAttributes.join('; ');
}

/**
 * 从请求中获取 Cookie 中的 token
 * @param {Request} request - HTTP 请求对象
 * @returns {string|null} Token 或 null
 */
function getTokenFromCookie(request) {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) {
		return null;
	}

	// 解析 Cookie header
	const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
		const [name, value] = cookie.trim().split('=');
		acc[name] = value;
		return acc;
	}, {});

	return cookies[COOKIE_NAME] || null;
}

/**
 * 验证请求的 Authorization Token
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<boolean>} 是否验证通过
 */
export async function verifyAuth(request, env) {
	const logger = getLogger(env);

	// 🔑 检查 KV 中的用户密码
	if (env.SECRETS_KV) {
		const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);

		if (!storedPasswordHash) {
			// 未设置密码，需要首次设置
			logger.info('未设置用户密码，需要首次设置');
			return false;
		}

		// 从 Cookie 或 Authorization header 获取 token
		let token = getTokenFromCookie(request);
		if (!token) {
			const authHeader = request.headers.get('Authorization');
			if (authHeader) {
				token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
			}
		}

		if (!token) {
			return false;
		}

		// 尝试作为 JWT 验证（使用用户密码哈希作为密钥）
		if (token.includes('.')) {
			const payload = await verifyJWT(token, storedPasswordHash, env);
			if (payload) {
				logger.debug('JWT 验证成功', {
					exp: new Date(payload.exp * 1000).toISOString(),
				});
				return true;
			}
		}

		return false;
	}

	// ❌ 没有配置 KV 存储
	logger.error('未配置 KV 存储，拒绝访问');
	return false;
}

/**
 * 验证认证并返回详细信息（用于自动续期）
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 认证信息对象 { valid: boolean, payload: Object, remainingDays: number, needsRefresh: boolean } 或 null
 */
export async function verifyAuthWithDetails(request, env) {
	const logger = getLogger(env);

	// 🔑 检查 KV 中的用户密码
	if (!env.SECRETS_KV) {
		logger.error('未配置 KV 存储，拒绝访问');
		return null;
	}

	const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);

	if (!storedPasswordHash) {
		logger.info('未设置用户密码，需要首次设置');
		return null;
	}

	// 从 Cookie 或 Authorization header 获取 token
	let token = getTokenFromCookie(request);
	if (!token) {
		const authHeader = request.headers.get('Authorization');
		if (authHeader) {
			token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
		}
	}

	if (!token) {
		return null;
	}

	// 尝试作为 JWT 验证（使用用户密码哈希作为密钥）
	if (token.includes('.')) {
		const payload = await verifyJWT(token, storedPasswordHash, env);
		if (payload && payload.exp) {
			const now = Math.floor(Date.now() / 1000);
			const remainingSeconds = payload.exp - now;
			const remainingDays = remainingSeconds / (24 * 60 * 60);
			const needsRefresh = remainingDays < JWT_AUTO_REFRESH_THRESHOLD_DAYS;

			logger.debug('JWT 验证成功（详细）', {
				exp: new Date(payload.exp * 1000).toISOString(),
				remainingDays: remainingDays.toFixed(2),
				needsRefresh,
			});

			return {
				valid: true,
				payload,
				remainingDays,
				needsRefresh,
				token,
			};
		}
	}

	return null;
}

/**
 * 创建未授权响应
 * @param {string} message - 错误消息（可选）
 * @param {Request} request - HTTP 请求对象（用于安全头）
 * @returns {Response} 401 未授权响应
 */
export function createUnauthorizedResponse(message = '未授权访问', request = null) {
	return createErrorResponse('身份验证失败', message || '请提供有效的访问令牌。如果您忘记了令牌，请联系管理员重新配置。', 401, request);
}

/**
 * 检查是否需要首次设置
 * @param {Object} env - 环境变量对象
 * @returns {Promise<boolean>} 是否需要首次设置
 */
export async function checkIfSetupRequired(env) {
	// 检查 KV 中是否已设置密码
	if (env.SECRETS_KV) {
		const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);
		return !storedPasswordHash; // 未设置则需要首次设置
	}

	return true; // 没有 KV 也需要设置
}

/**
 * 处理首次设置请求
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Response>} 响应
 */
export async function handleFirstTimeSetup(request, env) {
	const logger = getLogger(env);

	try {
		// 🛡️ Rate Limiting: 防止暴力破解
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.login);

		if (!rateLimitInfo.allowed) {
			logger.warn('首次设置速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const { password, confirmPassword } = await request.json();

		// 验证密码
		if (!password || !confirmPassword) {
			throw new ValidationError('请提供密码和确认密码', {
				missing: !password ? 'password' : 'confirmPassword',
			});
		}

		if (password !== confirmPassword) {
			throw new ValidationError('两次输入的密码不一致', {
				issue: 'password_mismatch',
			});
		}

		// 检查是否已经设置过
		const existingHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);
		if (existingHash) {
			throw new ConflictError('密码已设置，无法重复设置。如需修改密码，请联系管理员。', {
				operation: 'first_time_setup',
				alreadyCompleted: true,
			});
		}

		// 验证密码强度（快速失败，提供友好的错误消息）
		// 注意：hashPassword() 也会进行验证作为最后的防线
		const validation = validatePasswordStrength(password);
		if (!validation.valid) {
			throw ErrorFactory.passwordWeak(validation.message, {
				operation: 'first_time_setup',
			});
		}

		// 加密密码（内部会再次验证密码强度）
		const passwordHash = await hashPassword(password);

		// 存储到 KV
		await env.SECRETS_KV.put(KV_USER_PASSWORD_KEY, passwordHash);
		await env.SECRETS_KV.put(KV_SETUP_COMPLETED_KEY, new Date().toISOString());

		logger.info('首次设置完成', {
			setupAt: new Date().toISOString(),
			passwordEncrypted: true,
		});

		// 生成 JWT token
		const jwtToken = await generateJWT(
			{
				auth: true,
				setupAt: new Date().toISOString(),
			},
			passwordHash,
			JWT_EXPIRY_DAYS,
		);

		const expiryDate = new Date(Date.now() + JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

		// 🍪 使用 HttpOnly Cookie 存储 JWT token
		const securityHeaders = getSecurityHeaders(request);

		return new Response(
			JSON.stringify({
				success: true,
				message: '密码设置成功，已自动登录',
				expiresAt: expiryDate.toISOString(),
				expiresIn: `${JWT_EXPIRY_DAYS}天`,
			}),
			{
				status: 200,
				headers: {
					...securityHeaders,
					'Content-Type': 'application/json',
					'Set-Cookie': createSetCookieHeader(jwtToken),
					'X-RateLimit-Limit': rateLimitInfo.limit.toString(),
					'X-RateLimit-Remaining': rateLimitInfo.remaining.toString(),
					'X-RateLimit-Reset': rateLimitInfo.resetAt.toString(),
				},
			},
		);
	} catch (error) {
		// 如果是已知的应用错误，直接转换为响应
		if (error instanceof ValidationError || error instanceof ConflictError || error instanceof AuthenticationError) {
			logError(error, logger, { operation: 'first_time_setup' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'首次设置失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('设置失败', '处理设置请求时发生错误', 500, request);
	}
}

/**
 * 验证登录请求并返回 JWT
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Response|null>} 如果验证失败返回错误响应，否则返回 null
 */
export async function handleLogin(request, env) {
	const logger = getLogger(env);

	try {
		// 🛡️ Rate Limiting: 防止暴力破解
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.login);

		if (!rateLimitInfo.allowed) {
			logger.warn('登录速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const { credential } = await request.json();

		if (!credential) {
			throw new ValidationError('请提供密码', {
				missing: 'credential',
			});
		}

		// 🔑 KV 密码认证
		if (!env.SECRETS_KV) {
			throw new ConfigurationError('服务器未配置 KV 存储，请联系管理员', {
				missingConfig: 'SECRETS_KV',
			});
		}

		const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);

		if (!storedPasswordHash) {
			throw new AuthorizationError('请先完成首次设置', {
				operation: 'login',
				setupRequired: true,
			});
		}

		// 验证密码
		const isValid = await verifyPassword(credential, storedPasswordHash, env);

		if (!isValid) {
			throw ErrorFactory.passwordIncorrect({
				operation: 'login',
			});
		}

		// 生成 JWT token
		const jwtToken = await generateJWT(
			{
				auth: true,
				loginAt: new Date().toISOString(),
			},
			storedPasswordHash,
			JWT_EXPIRY_DAYS,
		);

		const expiryDate = new Date(Date.now() + JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
		const securityHeaders = getSecurityHeaders(request);

		return new Response(
			JSON.stringify({
				success: true,
				message: '登录成功',
				token: jwtToken, // 同时在响应 body 中返回 token（供测试和客户端使用）
				expiresAt: expiryDate.toISOString(),
				expiresIn: `${JWT_EXPIRY_DAYS}天`,
			}),
			{
				status: 200,
				headers: {
					...securityHeaders,
					'Content-Type': 'application/json',
					'Set-Cookie': createSetCookieHeader(jwtToken),
					'X-RateLimit-Limit': rateLimitInfo.limit.toString(),
					'X-RateLimit-Remaining': rateLimitInfo.remaining.toString(),
					'X-RateLimit-Reset': rateLimitInfo.resetAt.toString(),
				},
			},
		);
	} catch (error) {
		// 如果是已知的应用错误，直接转换为响应
		if (
			error instanceof ValidationError ||
			error instanceof AuthenticationError ||
			error instanceof AuthorizationError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'login' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'登录处理失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('登录失败', '处理登录请求时发生错误', 500, request);
	}
}

/**
 * 刷新 JWT Token
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Response>} 包含新 token 的响应
 */
export async function handleRefreshToken(request, env) {
	const logger = getLogger(env);

	try {
		// 优先从 Cookie 获取 token，向后兼容 Authorization header
		let token = getTokenFromCookie(request);

		if (!token) {
			const authHeader = request.headers.get('Authorization');
			if (!authHeader) {
				throw ErrorFactory.jwtMissing({
					operation: 'refresh_token',
				});
			}
			token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
		}

		// 获取 KV 中的密码哈希作为 JWT 密钥
		if (!env.SECRETS_KV) {
			throw new ConfigurationError('服务器未配置 KV 存储', {
				missingConfig: 'SECRETS_KV',
			});
		}

		const storedPasswordHash = await env.SECRETS_KV.get(KV_USER_PASSWORD_KEY);
		if (!storedPasswordHash) {
			throw new AuthorizationError('请先完成首次设置', {
				operation: 'refresh_token',
				setupRequired: true,
			});
		}

		// 验证当前 token
		const payload = await verifyJWT(token, storedPasswordHash, env);
		if (!payload) {
			throw ErrorFactory.jwtInvalid({
				operation: 'refresh_token',
			});
		}

		// 生成新的 JWT token
		const newToken = await generateJWT(
			{
				auth: true,
				loginAt: payload.loginAt || new Date().toISOString(),
				refreshedAt: new Date().toISOString(),
			},
			storedPasswordHash,
			JWT_EXPIRY_DAYS,
		);

		const expiryDate = new Date(Date.now() + JWT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

		// 🍪 使用 HttpOnly Cookie 存储刷新后的 JWT token
		// 🔒 使用安全头（CORS, CSP 等）
		const securityHeaders = getSecurityHeaders(request);

		return new Response(
			JSON.stringify({
				success: true,
				message: '令牌刷新成功',
				token: newToken, // 同时在响应 body 中返回 token（供测试和客户端使用）
				expiresAt: expiryDate.toISOString(),
				expiresIn: `${JWT_EXPIRY_DAYS}天`,
			}),
			{
				status: 200,
				headers: {
					...securityHeaders, // 🔒 包含 CORS, CSP 等安全头
					'Content-Type': 'application/json',
					// 🍪 设置新的 HttpOnly Cookie
					'Set-Cookie': createSetCookieHeader(newToken),
				},
			},
		);
	} catch (error) {
		// 如果是已知的应用错误，直接转换为响应
		if (
			error instanceof ValidationError ||
			error instanceof AuthenticationError ||
			error instanceof AuthorizationError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'refresh_token' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'刷新令牌失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('刷新失败', '刷新令牌时发生错误', 500, request);
	}
}

/**
 * 检查路径是否需要认证
 * @param {string} pathname - 请求路径
 * @returns {boolean} 是否需要认证
 */
export function requiresAuth(pathname) {
	// 不需要认证的路径
	const publicPaths = [
		'/', // 主页（会显示登录界面）
		'/api/login', // 登录接口
		'/api/refresh-token', // Token 刷新接口（已在内部验证）
		'/api/setup', // 首次设置接口
		'/setup', // 设置页面
		'/manifest.json', // PWA manifest
		'/sw.js', // Service Worker
		'/icon-192.png', // PWA 图标
		'/icon-512.png', // PWA 图标
		'/favicon.ico', // 网站图标
		'/otp', // OTP 生成页面（无参数）
	];

	// 精确匹配公开路径
	if (publicPaths.includes(pathname)) {
		return false;
	}

	// OTP 生成路径不需要认证（公开访问）
	if (pathname.startsWith('/otp/')) {
		return false;
	}

	// Favicon 代理路径不需要认证（公开访问）
	if (pathname.startsWith('/api/favicon/')) {
		return false;
	}

	// 所有其他路径默认需要认证（包括 /api/, /admin, /settings 等）
	return true;
}
