/**
 * Favicon 代理 API
 * 在 Worker 层代理 favicon 请求，支持多个上游源
 * 解决中国网络环境无法访问 Google Favicon API 的问题
 */

import { createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';

/**
 * Favicon API 上游源配置
 * 按优先级排序，失败时自动降级到下一个源
 *
 * 🌐 源选择说明：
 * 1. Google - 国际用户首选（中国大陆可能无法访问）
 * 2. Yandex - 俄罗斯搜索引擎（全球包括中国通常可访问）
 * 3. Direct HTTPS - 直接访问网站标准位置的favicon
 * 4. Direct HTTP - 兜底方案（某些老旧网站仍使用HTTP）
 */
const FAVICON_SOURCES = [
	{
		name: 'Google',
		url: (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
		timeout: 5000,
	},
	{
		name: 'Yandex',
		url: (domain) => `https://favicon.yandex.net/favicon/${domain}`,
		timeout: 5000,
	},
	{
		name: 'Direct-HTTPS',
		url: (domain) => `https://${domain}/favicon.ico`,
		timeout: 3000,
	},
	{
		name: 'Direct-HTTP',
		url: (domain) => `http://${domain}/favicon.ico`,
		timeout: 3000,
	},
];

/**
 * 处理 favicon 代理请求
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量
 * @param {string} domain - 域名
 * @returns {Response} favicon 图片响应
 */
export async function handleFaviconProxy(request, env, domain) {
	const logger = getLogger(env);

	// 验证域名格式
	if (!domain || !isValidDomain(domain)) {
		return createErrorResponse('无效域名', '请提供有效的域名', 400, request);
	}

	// 尝试从多个源获取 favicon
	let lastError = null;

	for (const source of FAVICON_SOURCES) {
		try {
			const faviconUrl = source.url(domain);
			logger.debug(`尝试从 ${source.name} 获取 favicon`, { domain, url: faviconUrl });

			// 使用 AbortController 实现超时
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), source.timeout);

			try {
				const response = await fetch(faviconUrl, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
						Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
					},
				});

				clearTimeout(timeoutId);

				// 检查响应状态
				if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
					logger.info(`成功从 ${source.name} 获取 favicon`, { domain });

					// 克隆响应并添加缓存头
					return new Response(response.body, {
						status: response.status,
						statusText: response.statusText,
						headers: {
							'Content-Type': response.headers.get('content-type') || 'image/x-icon',
							'Cache-Control': 'public, max-age=86400', // 缓存24小时
							'X-Favicon-Source': source.name,
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				// 非图片响应或错误状态，尝试下一个源
				lastError = new Error(`${source.name} 返回非成功状态: ${response.status}`);
				logger.warn(`${source.name} 获取失败`, { domain, status: response.status });
			} catch (fetchError) {
				clearTimeout(timeoutId);

				if (fetchError.name === 'AbortError') {
					lastError = new Error(`${source.name} 请求超时`);
					logger.warn(`${source.name} 请求超时`, { domain, timeout: source.timeout });
				} else {
					lastError = fetchError;
					logger.warn(`${source.name} 请求失败`, { domain, error: fetchError.message });
				}
			}
		} catch (error) {
			lastError = error;
			logger.error(`${source.name} 处理失败`, { domain, error: error.message });
		}
	}

	// 所有源都失败，返回错误
	logger.error('所有 favicon 源都失败', { domain, lastError: lastError?.message });

	// 返回 404，但不返回错误 JSON（让客户端的 img onerror 处理）
	return new Response('', {
		status: 404,
		statusText: 'Not Found',
		headers: {
			'Content-Type': 'text/plain',
			'Cache-Control': 'no-cache',
			'X-Favicon-Error': lastError?.message || 'All sources failed',
		},
	});
}

/**
 * 验证域名格式
 * @param {string} domain - 域名
 * @returns {boolean} 是否有效
 */
function isValidDomain(domain) {
	// 基本的域名格式验证
	const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

	// 检查是否包含危险字符
	if (domain.includes('..') || domain.includes('//') || domain.includes('@')) {
		return false;
	}

	return domainRegex.test(domain) && domain.length <= 253;
}
