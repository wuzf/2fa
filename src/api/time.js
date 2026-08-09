import { createJsonResponse } from '../utils/response.js';

/**
 * 返回 Worker 当前的 Unix 毫秒时间，供客户端校准 TOTP 时钟。
 *
 * @param {Request|null} request - HTTP 请求，用于生成安全响应头
 * @returns {Response} 包含服务端时间的 JSON 响应
 */
export function handleGetTime(request = null) {
	return createJsonResponse({ serverTimeMs: Date.now() }, 200, request, {
		'Cache-Control': 'no-store',
	});
}
