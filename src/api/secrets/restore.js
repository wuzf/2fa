/**
 * Backup restore and export handlers.
 */

import { saveSecretsToKV } from './shared.js';
import { getLogger } from '../../utils/logger.js';
import {
	buildDownloadContent,
	decodeBackupEntry,
	isValidBackupKey,
	normalizeBackupSecrets,
	parseBackupTimeFromKey,
} from '../../utils/backup-format.js';
import { validateRequest, restoreBackupSchema } from '../../utils/validation.js';
import { createJsonResponse, createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import { ValidationError, NotFoundError, StorageError, CryptoError, errorToResponse, logError } from '../../utils/errors.js';

const EXPORT_FORMATS = ['txt', 'json', 'csv', 'html'];

function buildIncompleteBackupMessage(decoded, actionLabel) {
	const skippedInvalidCount = Number.parseInt(decoded?.skippedInvalidCount, 10) || 0;
	return `该备份在创建或解析时已跳过 ${skippedInvalidCount} 条无效密钥，无法保证数据完整，已阻止${actionLabel}`;
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
		let backupKey;
		let isPreview = false;

		if (request.method === 'GET') {
			const url = new URL(request.url);
			backupKey = url.searchParams.get('key');

			if (!backupKey) {
				return createErrorResponse('备份键缺失', '请提供要恢复的备份键名', 400, request);
			}

			if (!isValidBackupKey(backupKey)) {
				return createErrorResponse('备份键格式错误', '备份键格式不正确', 400, request);
			}
		} else if (request.method === 'POST') {
			const data = await validateRequest(restoreBackupSchema)(request);
			if (data instanceof Response) {
				return data;
			}

			backupKey = data.backupKey;
			isPreview = data.preview;
		} else {
			return createErrorResponse('方法不支持', '仅支持 GET 和 POST 请求', 405, request);
		}

		const backupContent = await env.SECRETS_KV.get(backupKey, 'text');
		if (!backupContent) {
			return createErrorResponse('备份不存在', `找不到备份文件：${backupKey}`, 404, request);
		}

		const listResult = await env.SECRETS_KV.list({ prefix: backupKey, limit: 1 });
		const keyEntry = listResult.keys.find((item) => item.name === backupKey);
		const decoded = await decodeBackupEntry(backupContent, env, {
			backupKey,
			metadata: keyEntry?.metadata,
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
