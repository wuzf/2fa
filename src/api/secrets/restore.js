/**
 * Backup restore and export handlers.
 */

import { saveSecretsToKV } from './shared.js';
import { getLogger } from '../../utils/logger.js';
import {
	buildDownloadContent,
	decodeBackupEntry,
	getBackupFormatFromKey,
	isValidBackupKey,
	normalizeBackupSecrets,
	parseBackupTimeFromKey,
} from '../../utils/backup-format.js';
import { createJsonResponse, createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import { ValidationError, NotFoundError, StorageError, CryptoError, errorToResponse, logError } from '../../utils/errors.js';
import { LIMITS } from '../../utils/constants.js';

const EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];
const MAX_RESTORE_CONTENT_BYTES = LIMITS.MAX_EXPORT_SIZE;
const MAX_RESTORE_REQUEST_BYTES = MAX_RESTORE_CONTENT_BYTES * 2 + 64 * 1024;
const MAX_RESTORE_CONTENT_SIZE_LABEL = '10 MB';

function buildIncompleteBackupMessage(decoded, actionLabel) {
	const skippedInvalidCount = Number.parseInt(decoded?.skippedInvalidCount, 10) || 0;
	return `该备份在创建或解析时已跳过 ${skippedInvalidCount} 条无效密钥，无法保证数据完整，已阻止${actionLabel}`;
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

function getTextByteLength(text) {
	return new TextEncoder().encode(String(text || '')).length;
}

function createRestoreRequestTooLargeResponse(request, byteLength) {
	return createErrorResponse(
		'恢复请求过大',
		`单次恢复请求体不能超过 ${formatByteSize(MAX_RESTORE_REQUEST_BYTES)}（当前约 ${formatByteSize(byteLength)}）`,
		413,
		request,
	);
}

function createRestoreContentTooLargeResponse(request, byteLength) {
	return createErrorResponse(
		'备份文件过大',
		`上传的备份文件内容不能超过 ${MAX_RESTORE_CONTENT_SIZE_LABEL}（当前约 ${formatByteSize(byteLength)}）`,
		413,
		request,
	);
}

async function readRestoreRequestJsonWithLimit(request) {
	const declaredContentLength = parseContentLength(request);
	if (declaredContentLength !== null && declaredContentLength > MAX_RESTORE_REQUEST_BYTES) {
		return {
			response: createRestoreRequestTooLargeResponse(request, declaredContentLength),
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
				if (byteLength > MAX_RESTORE_REQUEST_BYTES) {
					try {
						await reader.cancel();
					} catch {
						// ignore cancellation failures
					}

					return {
						response: createRestoreRequestTooLargeResponse(request, byteLength),
					};
				}

				text += decoder.decode(value, { stream: true });
			}

			text += decoder.decode();
		} catch (error) {
			return {
				response: createErrorResponse('请求读取失败', `读取恢复请求时发生错误：${error.message}`, 400, request),
			};
		}

		try {
			return { body: JSON.parse(text || '{}') };
		} catch {
			return {
				response: createErrorResponse('请求格式错误', '无效的 JSON 格式', 400, request),
			};
		}
	}

	if (typeof request.text === 'function') {
		let text;
		try {
			text = await request.text();
		} catch (error) {
			return {
				response: createErrorResponse('请求读取失败', `读取恢复请求时发生错误：${error.message}`, 400, request),
			};
		}

		const byteLength = getTextByteLength(text);
		if (byteLength > MAX_RESTORE_REQUEST_BYTES) {
			return {
				response: createRestoreRequestTooLargeResponse(request, byteLength),
			};
		}

		try {
			return { body: JSON.parse(text || '{}') };
		} catch {
			return {
				response: createErrorResponse('请求格式错误', '无效的 JSON 格式', 400, request),
			};
		}
	}

	try {
		const body = await request.json();
		const byteLength = getTextByteLength(JSON.stringify(body || {}));
		if (byteLength > MAX_RESTORE_REQUEST_BYTES) {
			return {
				response: createRestoreRequestTooLargeResponse(request, byteLength),
			};
		}
		return { body };
	} catch (error) {
		if (error.name === 'SyntaxError') {
			return {
				response: createErrorResponse('请求格式错误', '无效的 JSON 格式', 400, request),
			};
		}
		throw error;
	}
}

function normalizeRestoreRequestBody(body, request) {
	const preview = body?.preview === undefined ? false : body.preview;
	if (typeof preview !== 'boolean') {
		return createErrorResponse('请求验证失败', '字段 "preview" 类型错误，期望 boolean', 400, request);
	}

	const backupKey = typeof body?.backupKey === 'string' ? body.backupKey.trim() : '';
	const backupFileName = typeof body?.backupFileName === 'string' ? body.backupFileName.trim() : '';
	const hasBackupContent = Object.prototype.hasOwnProperty.call(body || {}, 'backupContent');
	const backupContent = typeof body?.backupContent === 'string' ? body.backupContent : '';
	const hasKvSource = Boolean(backupKey);
	const hasUploadSource = hasBackupContent || Boolean(backupFileName);

	if (hasKvSource && hasUploadSource) {
		return createErrorResponse('请求验证失败', '请只提供一种恢复来源：backupKey 或 backupContent + backupFileName', 400, request);
	}

	if (hasKvSource) {
		if (!isValidBackupKey(backupKey)) {
			return createErrorResponse('备份键格式错误', '备份键格式不正确', 400, request);
		}
		return {
			source: 'kv',
			backupKey,
			preview,
		};
	}

	if (!hasUploadSource) {
		return createErrorResponse('备份来源缺失', '请提供要恢复的备份键或上传的备份文件内容', 400, request);
	}

	if (!backupFileName) {
		return createErrorResponse('备份文件名缺失', '请提供上传备份文件的文件名', 400, request);
	}

	if (!isValidBackupKey(backupFileName)) {
		return createErrorResponse('无效的备份文件名', '备份文件名格式不正确', 400, request);
	}

	if (typeof body.backupContent !== 'string') {
		return createErrorResponse('备份内容格式错误', '上传的备份内容必须是字符串', 400, request);
	}

	if (!backupContent) {
		return createErrorResponse('备份内容为空', '上传的备份文件内容为空', 400, request);
	}

	const backupContentByteLength = getTextByteLength(backupContent);
	if (backupContentByteLength > MAX_RESTORE_CONTENT_BYTES) {
		return createRestoreContentTooLargeResponse(request, backupContentByteLength);
	}

	return {
		source: 'upload',
		backupKey: backupFileName,
		backupContent,
		backupContentByteLength,
		preview,
	};
}

async function resolveRestoreSource(request, env) {
	let data;

	if (request.method === 'GET') {
		const url = new URL(request.url);
		const backupKey = url.searchParams.get('key');

		if (!backupKey) {
			return createErrorResponse('备份键缺失', '请提供要恢复的备份键名', 400, request);
		}

		if (!isValidBackupKey(backupKey)) {
			return createErrorResponse('备份键格式错误', '备份键格式不正确', 400, request);
		}

		data = {
			source: 'kv',
			backupKey,
			preview: false,
		};
	} else if (request.method === 'POST') {
		const bodyResult = await readRestoreRequestJsonWithLimit(request);
		if (bodyResult.response) {
			return bodyResult.response;
		}

		data = normalizeRestoreRequestBody(bodyResult.body, request);
		if (data instanceof Response) {
			return data;
		}
	} else {
		return createErrorResponse('方法不支持', '仅支持 GET 和 POST 请求', 405, request);
	}

	if (data.source === 'upload') {
		return {
			...data,
			metadata: {
				created: parseBackupTimeFromKey(data.backupKey),
				format: getBackupFormatFromKey(data.backupKey),
				encrypted: data.backupContent.startsWith('v1:'),
				size: data.backupContentByteLength,
			},
		};
	}

	const backupContent = await env.SECRETS_KV.get(data.backupKey, 'text');
	if (!backupContent) {
		return createErrorResponse('备份不存在', `找不到备份文件：${data.backupKey}`, 404, request);
	}

	const listResult = await env.SECRETS_KV.list({ prefix: data.backupKey, limit: 1 });
	const keyEntry = listResult.keys.find((item) => item.name === data.backupKey);

	return {
		...data,
		backupContent,
		metadata: keyEntry?.metadata,
	};
}

/**
 * Export a stored backup as a selected format.
 */
export async function handleExportBackup(request, env, backupKey) {
	const logger = getLogger(env);

	try {
		logger.info('📤 开始导出备份', { backupKey });

		const url = new URL(request.url);
		const format = String(url.searchParams.get('format') || 'txt')
			.trim()
			.toLowerCase();

		if (!EXPORT_FORMATS.includes(format)) {
			return createErrorResponse('无效的导出格式', `支持的格式：${EXPORT_FORMATS.join(', ')}`, 400, request);
		}

		if (!backupKey || !isValidBackupKey(backupKey)) {
			return createErrorResponse('无效的备份文件名', '备份文件名格式不正确', 400, request);
		}

		const backupContent = await env.SECRETS_KV.get(backupKey, 'text');
		if (!backupContent) {
			return createErrorResponse('备份不存在', `备份文件 "${backupKey}" 不存在`, 404, request);
		}

		const listResult = await env.SECRETS_KV.list({ prefix: backupKey, limit: 1 });
		const keyEntry = listResult.keys.find((item) => item.name === backupKey);
		const decoded = await decodeBackupEntry(backupContent, env, {
			backupKey,
			metadata: keyEntry?.metadata,
			strict: true,
		});
		if (decoded.partial) {
			return createErrorResponse('备份不完整', buildIncompleteBackupMessage(decoded, '导出'), 400, request);
		}
		const sortedSecrets = [...normalizeBackupSecrets(decoded.secrets, decoded.timestamp)].sort((a, b) =>
			a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' }),
		);
		const download = await buildDownloadContent(sortedSecrets, format, {
			format,
			timestamp: decoded.timestamp,
			reason: decoded.reason,
			includeQRCodes: format === 'html',
		});
		const dateMatch = backupKey.match(/backup_(\d{4}-\d{2}-\d{2})/);
		const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
		const filename = `2FA-backup-${dateStr}.${download.extension}`;

		logger.info('导出备份成功', {
			backupKey,
			format,
			secretCount: sortedSecrets.length,
			encrypted: decoded.encrypted,
		});

		return new Response(download.content, {
			status: 200,
			headers: {
				'Content-Type': download.contentType,
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			},
		});
	} catch (error) {
		if (
			error instanceof NotFoundError ||
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ValidationError
		) {
			logError(error, logger, { operation: 'handleExportBackup', backupKey: backupKey || 'unknown' });
			return errorToResponse(error, request);
		}

		logger.error(
			'导出备份失败',
			{
				backupKey: backupKey || 'unknown',
				errorMessage: error.message,
			},
			error,
		);
		if (error.message.includes('ENCRYPTION_KEY')) {
			return createErrorResponse('无法导出', error.message, 400, request);
		}
		if (error.message.startsWith('HTML 导出最多支持 ')) {
			return createErrorResponse('导出内容过大', error.message, 400, request);
		}
		if (error.message.startsWith('解密失败：')) {
			return createErrorResponse('解密失败', error.message.replace('解密失败：', ''), 500, request);
		}
		if (error.message.startsWith('解析失败：')) {
			return createErrorResponse('解析失败', error.message.replace('解析失败：', ''), 400, request);
		}
		return createErrorResponse('导出备份失败', `导出备份时发生错误：${error.message}`, 500, request);
	}
}

/**
 * Restore a stored backup.
 */
export async function handleRestoreBackup(request, env, ctx) {
	const logger = getLogger(env);

	try {
		const restoreSource = await resolveRestoreSource(request, env);
		if (restoreSource instanceof Response) {
			return restoreSource;
		}

		const { backupKey, backupContent, metadata, preview: isPreview, source } = restoreSource;
		const decoded = await decodeBackupEntry(backupContent, env, {
			backupKey,
			metadata,
			strict: true,
		});

		if (isPreview) {
			const warningMessage = decoded.partial ? buildIncompleteBackupMessage(decoded, '恢复或导出') : null;
			return createSuccessResponse({
				message: '备份预览获取成功',
				backupKey,
				secrets: decoded.secrets,
				count: decoded.count,
				timestamp: decoded.timestamp,
				encrypted: decoded.encrypted,
				format: decoded.format,
				source,
				partial: decoded.partial === true,
				skippedInvalidCount: decoded.skippedInvalidCount || 0,
				warnings: warningMessage ? [warningMessage] : [],
			});
		}

		if (!decoded.secrets || !Array.isArray(decoded.secrets)) {
			return createErrorResponse('备份数据无效', '备份文件格式不正确或已损坏', 400, request);
		}

		if (decoded.partial) {
			return createErrorResponse('备份不完整', buildIncompleteBackupMessage(decoded, '恢复'), 400, request);
		}

		if (decoded.secrets.length === 0) {
			return createErrorResponse('备份内容为空', '备份中没有可恢复的密钥，已阻止覆盖当前数据', 400, request);
		}

		await saveSecretsToKV(env, decoded.secrets, 'backup-restored', { immediate: true }, ctx);

		logger.info('✅ 备份恢复完成', {
			backupKey,
			secretCount: decoded.secrets.length,
			wasEncrypted: decoded.encrypted,
			format: decoded.format,
		});

		return createJsonResponse({
			success: true,
			message: `恢复备份成功，共恢复 ${decoded.secrets.length} 个密钥`,
			backupKey,
			count: decoded.secrets.length,
			timestamp: decoded.timestamp || parseBackupTimeFromKey(backupKey),
			sourceEncrypted: decoded.encrypted,
			format: decoded.format,
			source,
		});
	} catch (error) {
		if (
			error instanceof NotFoundError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError
		) {
			logError(error, logger, { operation: 'handleRestoreBackup' });
			return errorToResponse(error, request);
		}

		logger.error(
			'恢复备份失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		if (error.message.includes('ENCRYPTION_KEY')) {
			return createErrorResponse('无法恢复', error.message, 400, request);
		}
		if (error.message.startsWith('解密失败：')) {
			return createErrorResponse('解密失败', error.message.replace('解密失败：', ''), 500, request);
		}
		if (error.message.startsWith('解析失败：')) {
			return createErrorResponse('解析失败', error.message.replace('解析失败：', ''), 400, request);
		}
		return createErrorResponse('恢复备份失败', `恢复备份时发生错误：${error.message}`, 500, request);
	}
}
