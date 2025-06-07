import { getSecurityHeaders } from './security.js';
import { getLogger } from './logger.js';

/**
 * Rate Limiting 工具模块 V2 - 滑动窗口算法
 * 基于 Cloudflare KV 实现的请求频率限制
 *
 * 🎯 解决问题：
 * - 消除固定窗口的窗口边界效应
 * - 防止攻击者利用窗口切换时机突发大量请求
 *
 * 🔧 算法：滑动窗口 (Sliding Window)
 *
 * 工作原理：
 * 1. 存储每个请求的精确时间戳（数组形式）
 * 2. 每次检查时，过滤掉窗口外的旧时间戳
 * 3. 计算窗口内的有效请求数
 * 4. 如果超过限制，拒绝请求
 *
 * 优点：
 * ✅ 无窗口边界效应，真正的滑动窗口
 * ✅ 精确的速率控制
 * ✅ 更好的用户体验（不会因窗口切换突然重置）
 * ✅ 有效防止突发攻击
 *
 * 性能优化：
 * ✅ 自动清理过期时间戳，控制存储大小
 * ✅ 单次 KV 操作，减少延迟
 * ✅ 时间戳数组限制最大长度
 * ✅ 使用 expirationTtl 自动清理过期数据
 *
 * 对比固定窗口：
 * - 存储成本：略高（存储时间戳数组 vs 单个计数）
 * - 计算成本：略高（过滤数组 vs 简单计数）
 * - 安全性：显著提升（无窗口边界漏洞）
 * - 用户体验：更好（平滑的限流）
 */

/**
 * 检查是否超过速率限制（滑动窗口算法）
 * @param {string} key - 限流键（如 IP 地址、用户 ID）
 * @param {Object} env - 环境变量对象
 * @param {Object} options - 配置选项
 * @param {number} options.maxAttempts - 时间窗口内最大请求次数
 * @param {number} options.windowSeconds - 时间窗口大小（秒）
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, limit: number, algorithm: string}>}
 */
export async function checkRateLimitSlidingWindow(key, env, options = {}) {
	const { maxAttempts = 5, windowSeconds = 60 } = options;

	const rateLimitKey = `ratelimit:v2:${key}`;
	const logger = getLogger(env);
	const now = Date.now();
	const windowMs = windowSeconds * 1000;
	const windowStart = now - windowMs;

	try {
		// 获取当前限流数据
		const data = await env.SECRETS_KV.get(rateLimitKey, 'json');

		// 初始化或获取时间戳数组
		let timestamps = [];
		if (data && Array.isArray(data.timestamps)) {
			// 过滤掉窗口外的旧时间戳（滑动窗口的核心）
			timestamps = data.timestamps.filter((ts) => ts > windowStart);
		}

		// 检查是否超过限制
		if (timestamps.length >= maxAttempts) {
			logger.warn('速率限制超出（滑动窗口）', {
				key,
				count: timestamps.length,
				maxAttempts,
				windowSeconds,
				oldestRequest: new Date(timestamps[0]).toISOString(),
				newestRequest: new Date(timestamps[timestamps.length - 1]).toISOString(),
			});

			// 计算最早的请求何时过期（即何时可以再次请求）
			const oldestTimestamp = timestamps[0];
			const resetAt = oldestTimestamp + windowMs;

			return {
				allowed: false,
				remaining: 0,
				resetAt: resetAt,
				limit: maxAttempts,
				algorithm: 'sliding-window',
			};
		}

		// 添加当前请求时间戳
		timestamps.push(now);

		// 性能优化：限制数组最大长度，防止无限增长
		// 只保留最近的 maxAttempts * 2 个时间戳（足够判断 + 历史记录）
		const maxStoredTimestamps = Math.max(maxAttempts * 2, 20);
		if (timestamps.length > maxStoredTimestamps) {
			timestamps = timestamps.slice(-maxStoredTimestamps);
		}

		// 保存更新后的时间戳数组
		await env.SECRETS_KV.put(
			rateLimitKey,
			JSON.stringify({
				timestamps: timestamps,
				lastUpdate: now,
			}),
			{
				// 过期时间设置为窗口大小 + 缓冲时间
				expirationTtl: windowSeconds + 60,
			},
		);

		// 计算下一次重置时间（最早的请求过期的时间）
		const oldestTimestamp = timestamps[0];
		const resetAt = oldestTimestamp + windowMs;

		return {
			allowed: true,
			remaining: maxAttempts - timestamps.length,
			resetAt: resetAt,
			limit: maxAttempts,
			algorithm: 'sliding-window',
		};
	} catch (error) {
		logger.error(
			'速率限制检查失败（滑动窗口）',
			{
				key,
				errorMessage: error.message,
			},
			error,
		);

		// 失败时允许请求（fail open）
		return {
			allowed: true,
			remaining: maxAttempts,
			resetAt: now + windowMs,
			limit: maxAttempts,
			algorithm: 'sliding-window',
		};
	}
}

/**
 * 检查是否超过速率限制（自动选择算法）
 * 默认使用滑动窗口算法，可选降级到固定窗口
 * @param {string} key - 限流键
 * @param {Object} env - 环境变量对象
 * @param {Object} options - 配置选项
 * @param {string} options.algorithm - 算法选择 ('sliding-window' | 'fixed-window')
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, limit: number}>}
 */
export async function checkRateLimit(key, env, options = {}) {
	const algorithm = options.algorithm || 'sliding-window'; // 默认使用滑动窗口

	if (algorithm === 'sliding-window') {
		return checkRateLimitSlidingWindow(key, env, options);
	} else {
		// 固定窗口实现（向后兼容）
		return checkRateLimitFixedWindow(key, env, options);
	}
}

/**
 * 检查是否超过速率限制（固定窗口算法 - 向后兼容）
 * @param {string} key - 限流键
 * @param {Object} env - 环境变量对象
 * @param {Object} options - 配置选项
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number, limit: number}>}
 */
async function checkRateLimitFixedWindow(key, env, options = {}) {
	const { maxAttempts = 5, windowSeconds = 60 } = options;

	const rateLimitKey = `ratelimit:${key}`;
	const logger = getLogger(env);

	try {
		const data = await env.SECRETS_KV.get(rateLimitKey, 'json');
		const now = Date.now();

		if (!data || now > data.resetAt) {
			const newResetAt = now + windowSeconds * 1000;

			await env.SECRETS_KV.put(
				rateLimitKey,
				JSON.stringify({
					count: 1,
					resetAt: newResetAt,
					firstRequest: now,
				}),
				{ expirationTtl: windowSeconds + 10 },
			);

			return {
				allowed: true,
				remaining: maxAttempts - 1,
				resetAt: newResetAt,
				limit: maxAttempts,
				algorithm: 'fixed-window',
			};
		}

		if (data.count >= maxAttempts) {
			logger.warn('速率限制超出（固定窗口）', {
				key,
				count: data.count,
				maxAttempts,
				resetAt: new Date(data.resetAt).toISOString(),
			});

			return {
				allowed: false,
				remaining: 0,
				resetAt: data.resetAt,
				limit: maxAttempts,
				algorithm: 'fixed-window',
			};
		}

		data.count++;
		const ttl = Math.ceil((data.resetAt - now) / 1000) + 10;

		await env.SECRETS_KV.put(rateLimitKey, JSON.stringify(data), { expirationTtl: Math.max(ttl, windowSeconds + 10) });

		return {
			allowed: true,
			remaining: maxAttempts - data.count,
			resetAt: data.resetAt,
			limit: maxAttempts,
			algorithm: 'fixed-window',
		};
	} catch (error) {
		logger.error(
			'速率限制检查失败（固定窗口）',
			{
				key,
				errorMessage: error.message,
			},
			error,
		);

		return {
			allowed: true,
			remaining: maxAttempts,
			resetAt: Date.now() + windowSeconds * 1000,
			limit: maxAttempts,
			algorithm: 'fixed-window',
		};
	}
}

/**
 * 重置指定键的速率限制
 * @param {string} key - 限流键
 * @param {Object} env - 环境变量对象
 * @returns {Promise<void>}
 */
export async function resetRateLimit(key, env) {
	const logger = getLogger(env);

	try {
		// 清理两个版本的数据
		await Promise.all([
			env.SECRETS_KV.delete(`ratelimit:${key}`), // v1 固定窗口
			env.SECRETS_KV.delete(`ratelimit:v2:${key}`), // v2 滑动窗口
		]);
		logger.info('速率限制已重置', { key });
	} catch (error) {
		logger.error(
			'重置速率限制失败',
			{
				key,
				errorMessage: error.message,
			},
			error,
		);
	}
}

/**
 * 获取速率限制信息（不增加计数）
 * @param {string} key - 限流键
 * @param {Object} env - 环境变量对象
 * @param {Object|number} optionsOrMaxAttempts - 配置选项或最大尝试次数（向后兼容）
 * @returns {Promise<{count: number, remaining: number, resetAt: number, limit: number}>}
 */
export async function getRateLimitInfo(key, env, optionsOrMaxAttempts = {}) {
	// 向后兼容：如果传入的是数字，转换为options对象
	let options;
	if (typeof optionsOrMaxAttempts === 'number') {
		options = {
			maxAttempts: optionsOrMaxAttempts,
			windowSeconds: 60,
			algorithm: 'sliding-window',
		};
	} else {
		options = optionsOrMaxAttempts;
	}

	const { maxAttempts = 5, windowSeconds = 60, algorithm = 'sliding-window' } = options;

	const rateLimitKey = algorithm === 'sliding-window' ? `ratelimit:v2:${key}` : `ratelimit:${key}`;
	const logger = getLogger(env);
	const now = Date.now();
	const windowMs = windowSeconds * 1000;

	try {
		const data = await env.SECRETS_KV.get(rateLimitKey, 'json');

		if (!data) {
			return {
				count: 0,
				remaining: maxAttempts,
				resetAt: now,
				limit: maxAttempts,
				algorithm,
			};
		}

		if (algorithm === 'sliding-window' && Array.isArray(data.timestamps)) {
			// 滑动窗口：过滤有效时间戳
			const windowStart = now - windowMs;
			const validTimestamps = data.timestamps.filter((ts) => ts > windowStart);
			const oldestTimestamp = validTimestamps[0] || now;
			const resetAt = oldestTimestamp + windowMs;

			return {
				count: validTimestamps.length,
				remaining: Math.max(0, maxAttempts - validTimestamps.length),
				resetAt: resetAt,
				limit: maxAttempts,
				algorithm,
			};
		} else {
			// 固定窗口
			if (now > data.resetAt) {
				return {
					count: 0,
					remaining: maxAttempts,
					resetAt: now,
					limit: maxAttempts,
					algorithm: 'fixed-window',
				};
			}

			return {
				count: data.count || 0,
				remaining: Math.max(0, maxAttempts - (data.count || 0)),
				resetAt: data.resetAt,
				limit: maxAttempts,
				algorithm: 'fixed-window',
			};
		}
	} catch (error) {
		logger.error(
			'获取速率限制信息失败',
			{
				key,
				errorMessage: error.message,
			},
			error,
		);
		return {
			count: 0,
			remaining: maxAttempts,
			resetAt: now,
			limit: maxAttempts,
			algorithm,
		};
	}
}

/**
 * 创建 429 Too Many Requests 响应
 * @param {Object} rateLimitInfo - 速率限制信息
 * @param {Request} request - HTTP 请求对象（用于安全头）
 * @returns {Response}
 */
export function createRateLimitResponse(rateLimitInfo, request = null) {
	const retryAfter = Math.ceil((rateLimitInfo.resetAt - Date.now()) / 1000);

	let headers = {
		'Content-Type': 'application/json',
		'Retry-After': retryAfter.toString(),
		'X-RateLimit-Limit': rateLimitInfo.limit.toString(),
		'X-RateLimit-Remaining': rateLimitInfo.remaining.toString(),
		'X-RateLimit-Reset': rateLimitInfo.resetAt.toString(),
		'X-RateLimit-Algorithm': rateLimitInfo.algorithm || 'sliding-window',
	};

	// 添加安全头（如果提供了 request）
	if (request) {
		const securityHeaders = getSecurityHeaders(request);
		headers = {
			...securityHeaders,
			...headers,
		};
	} else {
		headers['Access-Control-Allow-Origin'] = '*';
		headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
		headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
	}

	return new Response(
		JSON.stringify({
			error: '请求过于频繁',
			message: `您的请求次数过多，请在 ${retryAfter} 秒后重试`,
			retryAfter: retryAfter,
			limit: rateLimitInfo.limit,
			remaining: rateLimitInfo.remaining,
			resetAt: new Date(rateLimitInfo.resetAt).toISOString(),
			algorithm: rateLimitInfo.algorithm || 'sliding-window',
		}),
		{
			status: 429,
			headers,
		},
	);
}

/**
 * 从请求中提取客户端标识
 * @param {Request} request - HTTP 请求对象
 * @param {string} type - 标识类型 ('ip' | 'token' | 'combined')
 * @returns {string} 客户端标识
 */
export function getClientIdentifier(request, type = 'ip') {
	switch (type) {
		case 'ip':
			return (
				request.headers.get('CF-Connecting-IP') ||
				request.headers.get('X-Real-IP') ||
				request.headers.get('X-Forwarded-For')?.split(',')[0] ||
				'unknown'
			);

		case 'token': {
			const authHeader = request.headers.get('Authorization');
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.substring(7);
				return `token:${token.substring(0, 16)}`;
			}
			return 'no-token';
		}

		case 'combined': {
			const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
			const auth = request.headers.get('Authorization');
			if (auth && auth.startsWith('Bearer ')) {
				const token = auth.substring(7);
				return `${ip}:${token.substring(0, 16)}`;
			}
			return ip;
		}

		default:
			return request.headers.get('CF-Connecting-IP') || 'unknown';
	}
}

/**
 * Rate Limiting 预设配置（滑动窗口优化版）
 */
export const RATE_LIMIT_PRESETS = {
	// 登录端点：5 次尝试 / 分钟
	login: {
		maxAttempts: 5,
		windowSeconds: 60,
		algorithm: 'sliding-window',
	},

	// 登录端点（严格）：3 次尝试 / 分钟
	loginStrict: {
		maxAttempts: 3,
		windowSeconds: 60,
		algorithm: 'sliding-window',
	},

	// API 操作：30 次请求 / 分钟
	api: {
		maxAttempts: 30,
		windowSeconds: 60,
		algorithm: 'sliding-window',
	},

	// 敏感操作：10 次请求 / 分钟
	sensitive: {
		maxAttempts: 10,
		windowSeconds: 60,
		algorithm: 'sliding-window',
	},

	// 批量操作：20 次请求 / 5 分钟
	bulk: {
		maxAttempts: 20,
		windowSeconds: 300,
		algorithm: 'sliding-window',
	},

	// 全局保护：100 次请求 / 分钟
	global: {
		maxAttempts: 100,
		windowSeconds: 60,
		algorithm: 'sliding-window',
	},
};

/**
 * Rate Limiting 中间件包装器
 * @param {Function} handler - 原始处理函数
 * @param {Object} options - Rate limiting 配置
 * @returns {Function} 包装后的处理函数
 */
export function withRateLimit(handler, options = {}) {
	const { preset = 'api', identifierType = 'ip', customKey = null } = options;

	return async (request, env, ...args) => {
		// 生成限流键
		let key;
		if (customKey) {
			key = typeof customKey === 'function' ? customKey(request) : customKey;
		} else {
			key = getClientIdentifier(request, identifierType);
		}

		// 获取预设配置
		const rateLimitConfig = RATE_LIMIT_PRESETS[preset] || RATE_LIMIT_PRESETS.api;

		// 检查速率限制
		const rateLimitInfo = await checkRateLimit(key, env, rateLimitConfig);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		// 调用原始处理函数
		const response = await handler(request, env, ...args);

		// 在响应中添加 rate limit headers
		if (response instanceof Response) {
			const newHeaders = new Headers(response.headers);
			newHeaders.set('X-RateLimit-Limit', rateLimitInfo.limit.toString());
			newHeaders.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString());
			newHeaders.set('X-RateLimit-Reset', rateLimitInfo.resetAt.toString());
			newHeaders.set('X-RateLimit-Algorithm', rateLimitInfo.algorithm || 'sliding-window');

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: newHeaders,
			});
		}

		return response;
	};
}
