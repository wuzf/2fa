/**
 * Bulk export handlers.
 */

import { buildDownloadContent, normalizeBackupSecrets } from '../../utils/backup-format.js';
import { getLogger } from '../../utils/logger.js';
import { createErrorResponse } from '../../utils/response.js';
import { checkRateLimit, createRateLimitResponse, getClientIdentifier, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';

const EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];
export const MAX_EXPORT_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_EXPORT_REQUEST_SIZE_LABEL = '2 MB';
const EXPORT_RATE_LIMIT_KEY_PREFIX = 'export';

function parseRequestedProfile(rawProfile) {
	if (rawProfile === undefined || rawProfile === null || rawProfile === '') {
		return {
			valid: true,
			profile: 'backup',
		};
	}

	const normalized = String(rawProfile).trim().toLowerCase();
	return {
		valid: normalized === 'backup' || normalized === 'bulk-export-legacy',
		profile: 'backup',
	};
}

function parseContentLength(request) {
	const rawContentLength = request?.headers?.get?.('Content-Length');
	const parsed = Number.parseInt(rawContentLength || '', 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatByteSize(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}

	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	if (bytes >= 1024) {
		return `${Math.ceil(bytes / 1024)} KB`;
	}

	return `${bytes} B`;
}

function createRequestTooLargeResponse(request, byteLength) {
	return createErrorResponse(
		'导出请求过大',
		`单次导出请求体不能超过 ${MAX_EXPORT_REQUEST_SIZE_LABEL}（当前约 ${formatByteSize(byteLength)}）`,
		413,
		request,
	);
}

async function readRequestTextWithLimit(request, maxBytes) {
	const declaredContentLength = parseContentLength(request);
	if (declaredContentLength !== null && declaredContentLength > maxBytes) {
		return {
			tooLarge: true,
			byteLength: declaredContentLength,
		};
	}

	if (request?.body && typeof request.body.getReader === 'function') {
		const reader = request.body.getReader();
		const decoder = new TextDecoder();
		let text = '';
		let byteLength = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				byteLength += value.byteLength;
				if (byteLength > maxBytes) {
					try {
						await reader.cancel();
					} catch {
						// ignore cancellation failures
					}

					return {
						tooLarge: true,
						byteLength,
					};
				}

				text += decoder.decode(value, { stream: true });
			}

			text += decoder.decode();
			return {
				text,
				byteLength,
			};
		} catch (error) {
			return {
				error,
			};
		}
	}

	try {
		const text = await request.text();
		const byteLength = new TextEncoder().encode(text).length;

		if (byteLength > maxBytes) {
			return {
				tooLarge: true,
				byteLength,
			};
		}

		return {
			text,
			byteLength,
		};
	} catch (error) {
		return {
			error,
		};
	}
}

export async function handleExportSecrets(request, env) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(`${EXPORT_RATE_LIMIT_KEY_PREFIX}:${clientIP}`, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('批量导出操作速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const requestTextResult = await readRequestTextWithLimit(request, MAX_EXPORT_REQUEST_BYTES);
		if (requestTextResult.tooLarge) {
			logger.warn('批量导出请求体过大', {
				clientIP,
				byteLength: requestTextResult.byteLength,
				maxBytes: MAX_EXPORT_REQUEST_BYTES,
			});
			return createRequestTooLargeResponse(request, requestTextResult.byteLength);
		}

		if (requestTextResult.error) {
			logger.warn('批量导出请求体读取失败', {
				clientIP,
				errorMessage: requestTextResult.error.message,
			});
			return createErrorResponse('请求格式错误', '无法读取请求体', 400, request);
		}

		let body;
		try {
			body = JSON.parse(requestTextResult.text || '');
		} catch {
			return createErrorResponse('请求格式错误', '无效的 JSON 格式', 400, request);
		}

		const format = String(body?.format || '')
			.trim()
			.toLowerCase();
		if (!EXPORT_FORMATS.includes(format)) {
			return createErrorResponse('无效的导出格式', `支持的格式：${EXPORT_FORMATS.join(', ')}`, 400, request);
		}

		const requestedProfile = parseRequestedProfile(body?.profile);
		if (!requestedProfile.valid) {
			return createErrorResponse('无效的导出配置', '不支持的导出 profile', 400, request);
		}

		if (!Array.isArray(body?.secrets)) {
			return createErrorResponse('请求验证失败', '请提供密钥数组', 400, request);
		}
		if (body.secrets.length === 0) {
			return createErrorResponse('没有密钥可以导出', '当前没有可导出的密钥', 400, request);
		}

		const timestamp = new Date().toISOString();
		const secrets = normalizeBackupSecrets(body.secrets, timestamp, {
			strict: true,
		});
		const download = await buildDownloadContent(secrets, format, {
			format,
			timestamp,
			reason: 'export',
			filenamePrefix: body?.filenamePrefix,
			metadata: body?.metadata,
		});

		logger.info('批量导出成功', {
			format,
			profile: requestedProfile.profile,
			count: secrets.length,
			requestBytes: requestTextResult.byteLength,
			filename: download.filename,
		});

		return new Response(download.content, {
			status: 200,
			headers: {
				'Content-Type': download.contentType,
				'Content-Disposition': `attachment; filename="${download.filename}"`,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			},
		});
	} catch (error) {
		logger.error(
			'批量导出失败',
			{
				errorMessage: error.message,
			},
			error,
		);

		if (error.message?.startsWith('备份包含无效密钥')) {
			return createErrorResponse('导出数据无效', error.message, 400, request);
		}

		if (error.message?.startsWith('HTML 导出最多支持')) {
			return createErrorResponse('导出内容过大', error.message, 400, request);
		}

		return createErrorResponse('导出失败', `导出时发生错误：${error.message}`, 500, request);
	}
}
