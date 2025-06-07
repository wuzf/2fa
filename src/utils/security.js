/**
 * 安全配置模块
 * 统一管理 CORS、CSP 等安全头配置
 *
 * 🔒 安全特性：
 * - CORS: 限制允许的来源（防止跨域攻击）
 * - CSP: 内容安全策略（防止 XSS 和数据注入）
 * - 其他安全头：X-Frame-Options, X-Content-Type-Options 等
 */

/**
 * 动态同源检查策略
 *
 * 🔒 安全说明：
 * - 前后端部署在同一域名下（Cloudflare Workers）
 * - 只允许与当前 Host 同源的请求
 * - 自动适配任何部署域名（无需硬编码）
 * - 仍然阻止来自其他网站的跨站请求（CSRF 防护）
 */

/**
 * 内容安全策略 (CSP) 配置
 *
 * 说明：
 * - default-src 'self': 默认只允许同源资源
 * - script-src: 允许内联脚本 + 必需的 CDN 库（jsQR、QRCode）
 * - style-src 'self' 'unsafe-inline': 允许内联样式
 * - img-src: 允许同源、data URI、blob 和外部 Logo 图片
 * - connect-src 'self': 仅允许同源 AJAX 请求
 * - font-src 'self': 仅允许同源字体
 * - object-src 'none': 禁止插件（Flash、Java 等）
 * - base-uri 'self': 限制 <base> 标签
 * - form-action 'self': 限制表单提交目标
 * - frame-ancestors 'none': 禁止被嵌入 iframe（防点击劫持）
 * - upgrade-insecure-requests: 自动升级 HTTP 到 HTTPS
 */
const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https://logo.clearbit.com https://www.google.com https:",
	"connect-src 'self'",
	"font-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	'upgrade-insecure-requests',
].join('; ');

/**
 * 检查请求来源是否与当前 Host 同源
 * @param {string} origin - 请求的 Origin header
 * @param {Request} request - HTTP 请求对象
 * @returns {boolean} 是否允许该来源
 */
function isOriginAllowed(origin, request) {
	if (!origin) {
		return false;
	}

	// 获取当前请求的 Host
	const host = request.headers.get('Host');
	if (!host) {
		return false;
	}

	// 构建允许的来源列表（同源策略）
	const allowedOrigins = [
		`https://${host}`, // HTTPS（生产环境）
		`http://${host}`, // HTTP（本地开发）
	];

	// 检查 Origin 是否与当前 Host 同源
	if (allowedOrigins.includes(origin)) {
		return true;
	}

	// 额外兼容：localhost 的不同端口
	// 例如：http://localhost:8787、http://localhost:3000
	if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
		const originUrl = new URL(origin);
		const hostWithoutPort = host.split(':')[0];
		if (originUrl.hostname === hostWithoutPort || originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
			return true;
		}
	}

	return false;
}

/**
 * 获取允许的 CORS Origin
 * @param {Request} request - HTTP 请求对象
 * @returns {string} 允许的 Origin 或 'null'
 */
export function getAllowedOrigin(request) {
	const origin = request.headers.get('Origin');

	// 如果没有 Origin header（同源请求），返回 null
	if (!origin) {
		return null;
	}

	// 检查是否与当前 Host 同源
	if (isOriginAllowed(origin, request)) {
		return origin; // 返回请求的 Origin（而不是 '*'）
	}

	// 不同源，不设置 CORS header（浏览器会阻止）
	return null;
}

/**
 * 获取标准安全响应头
 * @param {Request} request - HTTP 请求对象
 * @param {Object} options - 可选配置
 * @param {boolean} options.includeCors - 是否包含 CORS 头（默认 true）
 * @param {boolean} options.includeCredentials - 是否允许携带凭据（默认 true，用于 Cookie）
 * @param {boolean} options.includeCSP - 是否包含 CSP 头（默认 true）
 * @returns {Object} 安全响应头对象
 */
export function getSecurityHeaders(request, options = {}) {
	const {
		includeCors = true,
		includeCredentials = true, // HttpOnly Cookie 需要
		includeCSP = true,
	} = options;

	const headers = {};

	// ========== CORS 配置 ==========
	if (includeCors) {
		const allowedOrigin = getAllowedOrigin(request);

		if (allowedOrigin) {
			// 返回具体的 Origin（不是 '*'）
			headers['Access-Control-Allow-Origin'] = allowedOrigin;

			// 当使用具体 Origin 时，必须设置 Vary header
			headers['Vary'] = 'Origin';

			// 如果使用 Cookie，必须允许凭据
			if (includeCredentials) {
				headers['Access-Control-Allow-Credentials'] = 'true';
			}
		}
		// 如果 Origin 不在允许列表，不设置 CORS header，浏览器会阻止请求
	}

	// ========== CSP 配置 ==========
	if (includeCSP) {
		headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
	}

	// ========== 其他安全头 ==========

	// 防止点击劫持（禁止页面被嵌入 iframe）
	headers['X-Frame-Options'] = 'DENY';

	// 防止 MIME 类型嗅探（强制浏览器遵守 Content-Type）
	headers['X-Content-Type-Options'] = 'nosniff';

	// 启用浏览器 XSS 过滤器
	headers['X-XSS-Protection'] = '1; mode=block';

	// Referrer 策略（控制 Referer header 发送）
	headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

	// 权限策略（限制浏览器功能访问）
	headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()';

	return headers;
}

/**
 * 获取 CORS 预检请求的响应头
 * @param {Request} request - HTTP 请求对象
 * @returns {Object} CORS 预检响应头
 */
export function getCorsPreflightHeaders(request) {
	const allowedOrigin = getAllowedOrigin(request);

	if (!allowedOrigin) {
		// Origin 不在允许列表，返回空对象（浏览器会阻止）
		return {};
	}

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Allow-Credentials': 'true', // 允许 Cookie
		'Access-Control-Max-Age': '86400', // 预检缓存 24 小时
		Vary: 'Origin',
	};
}

/**
 * 检查是否为预检请求
 * @param {Request} request - HTTP 请求对象
 * @returns {boolean} 是否为预检请求
 */
export function isPreflightRequest(request) {
	return request.method === 'OPTIONS' && request.headers.has('Access-Control-Request-Method');
}

/**
 * 创建 CORS 预检响应
 * @param {Request} request - HTTP 请求对象
 * @returns {Response|null} 预检响应或 null
 */
export function createPreflightResponse(request) {
	if (!isPreflightRequest(request)) {
		return null;
	}

	const headers = getCorsPreflightHeaders(request);

	// 如果没有允许的 Origin，返回 403
	if (Object.keys(headers).length === 0) {
		return new Response('CORS policy violation', {
			status: 403,
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	}

	return new Response(null, {
		status: 204,
		headers,
	});
}

/**
 * 合并安全头到现有 headers 对象
 * @param {Request} request - HTTP 请求对象
 * @param {Object} existingHeaders - 现有的 headers 对象
 * @param {Object} options - 可选配置
 * @returns {Object} 合并后的 headers 对象
 */
export function mergeSecurityHeaders(request, existingHeaders = {}, options = {}) {
	const securityHeaders = getSecurityHeaders(request, options);
	return {
		...securityHeaders,
		...existingHeaders, // 现有 headers 优先级更高
	};
}

/**
 * 获取 CSP 策略（用于文档和调试）
 * @returns {string} CSP 策略字符串
 */
export function getCSPPolicy() {
	return CONTENT_SECURITY_POLICY;
}
