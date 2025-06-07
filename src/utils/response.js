/**
 * HTTP响应工具模块
 * 提供标准化的响应格式，包含安全头
 *
 * 🔒 安全特性：
 * - CORS: 动态验证请求来源
 * - CSP: 内容安全策略
 * - 其他安全头：X-Frame-Options, X-Content-Type-Options 等
 */

import { getSecurityHeaders } from './security.js';

// 性能优化：缓存默认 CORS headers，避免重复创建对象
const DEFAULT_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
};

// 性能优化：只警告一次（避免在循环中重复打印降低性能）
let hasWarnedMissingRequest = false;

/**
 * 重置警告标志（仅供测试使用）
 * @internal
 */
export function _resetWarningFlag() {
	hasWarnedMissingRequest = false;
}

/**
 * 创建标准JSON响应（带安全头）
 * @param {any} data - 响应数据
 * @param {number} status - HTTP状态码
 * @param {Request} request - HTTP 请求对象（用于获取安全头）
 * @param {Object} additionalHeaders - 额外的响应头
 * @returns {Response} HTTP响应对象
 */
export function createJsonResponse(data, status = 200, request = null, additionalHeaders = {}) {
	let headers;

	// 添加安全头（如果提供了 request）
	if (request) {
		const securityHeaders = getSecurityHeaders(request);
		// 性能优化：减少对象展开次数
		headers = {
			'Content-Type': 'application/json',
			...securityHeaders,
			...additionalHeaders, // 额外的 headers 优先级更高
		};
	} else {
		// 向后兼容：如果没有提供 request，使用旧的 CORS 配置
		// 性能优化：只警告一次
		if (!hasWarnedMissingRequest) {
			console.warn('⚠️ createJsonResponse 未提供 request 参数，使用默认 CORS 配置');
			hasWarnedMissingRequest = true;
		}

		// 性能优化：复用缓存的默认 headers
		if (Object.keys(additionalHeaders).length === 0) {
			headers = {
				'Content-Type': 'application/json',
				...DEFAULT_CORS_HEADERS,
			};
		} else {
			headers = {
				'Content-Type': 'application/json',
				...DEFAULT_CORS_HEADERS,
				...additionalHeaders,
			};
		}
	}

	return new Response(JSON.stringify(data), {
		status,
		headers,
	});
}

/**
 * 创建错误响应
 * @param {string} title - 错误标题
 * @param {string} message - 错误详细信息
 * @param {number} status - HTTP状态码
 * @param {Request} request - HTTP 请求对象（用于获取安全头）
 * @returns {Response} 错误响应对象
 */
export function createErrorResponse(title, message, status = 500, request = null) {
	const errorData = {
		error: title,
		message: message,
		timestamp: new Date().toISOString(),
	};

	return createJsonResponse(errorData, status, request);
}

/**
 * 创建成功响应
 * @param {any} data - 成功响应数据
 * @param {string} message - 成功消息
 * @param {Request} request - HTTP 请求对象（用于获取安全头）
 * @returns {Response} 成功响应对象
 */
export function createSuccessResponse(data, message, request = null) {
	return createJsonResponse(
		{
			success: true,
			message,
			data,
		},
		200,
		request,
	);
}

/**
 * 创建HTML响应（带安全头）
 * @param {string} html - HTML内容
 * @param {number} status - HTTP状态码
 * @param {Request} request - HTTP 请求对象（用于获取安全头）
 * @returns {Response} HTML响应对象
 */
export function createHtmlResponse(html, status = 200, request = null) {
	let headers = {
		'Content-Type': 'text/html; charset=utf-8',
	};

	// 添加安全头（如果提供了 request）
	if (request) {
		const securityHeaders = getSecurityHeaders(request);
		headers = {
			...securityHeaders,
			...headers,
		};
	}

	return new Response(html, {
		status,
		headers,
	});
}
