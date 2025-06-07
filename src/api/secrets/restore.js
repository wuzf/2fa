/**
 * 备份恢复和导出处理器
 *
 * 包含功能:
 * - handleExportBackup: 导出备份（支持 txt/json/csv 格式）
 * - handleRestoreBackup: 恢复备份（支持预览模式）
 *
 * 注意: 使用 decryptData 解密整个备份对象
 */

import { saveSecretsToKV } from './shared.js';
import { getLogger } from '../../utils/logger.js';
import { decryptData } from '../../utils/encryption.js';
import { validateRequest, restoreBackupSchema } from '../../utils/validation.js';
import { createJsonResponse, createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import { ValidationError, NotFoundError, StorageError, CryptoError, errorToResponse, logError } from '../../utils/errors.js';

/**
 * 处理导出单个备份 - 支持多种格式
 * 🔒 自动解密加密的备份
 *
 * 支持的导出格式:
 * - txt: OTPAuth URI 格式（每行一个 otpauth:// URL）
 * - json: JSON 格式（包含完整密钥信息）
 * - csv: CSV 格式（带 BOM，Excel 友好）
 *
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象
 * @param {string} backupKey - 备份文件名
 * @returns {Response} HTTP响应
 */
export async function handleExportBackup(request, env, backupKey) {
	const logger = getLogger(env);

	try {
		logger.info('📤 开始导出备份', { backupKey });

		// 获取导出格式参数（默认为 txt）
		const url = new URL(request.url);
		const format = url.searchParams.get('format') || 'txt';

		// 验证格式
		const validFormats = ['txt', 'json', 'csv'];
		if (!validFormats.includes(format)) {
			return createErrorResponse('无效的导出格式', `支持的格式：${validFormats.join(', ')}`, 400, request);
		}

		// 验证备份文件名格式
		if (!backupKey || !backupKey.startsWith('backup_') || !backupKey.endsWith('.json')) {
			return createErrorResponse('无效的备份文件名', '备份文件名格式不正确', 400, request);
		}

		// 获取备份数据（可能是加密的）
		const backupContent = await env.SECRETS_KV.get(backupKey, 'text');

		if (!backupContent) {
			return createErrorResponse('备份不存在', `备份文件 "${backupKey}" 不存在`, 404, request);
		}

		// 🔒 检测并解密备份数据
		let backupData;
		const isEncrypted = backupContent.startsWith('v1:');

		if (isEncrypted) {
			// 加密的备份，需要解密
			if (!env.ENCRYPTION_KEY) {
				return createErrorResponse(
					'无法导出',
					'备份文件已加密，但未配置 ENCRYPTION_KEY。如需访问加密备份，请先配置正确的加密密钥。',
					400,
					request,
				);
			}

			try {
				backupData = await decryptData(backupContent, env);
				logger.info('备份已解密', {
					backupKey,
					encrypted: true,
				});
			} catch (error) {
				return createErrorResponse('解密失败', `无法解密备份文件：${error.message}。可能使用了错误的加密密钥。`, 500, request);
			}
		} else {
			// 明文备份，直接解析
			try {
				backupData = JSON.parse(backupContent);
				logger.info('备份是明文格式', {
					backupKey,
					encrypted: false,
				});
			} catch (error) {
				return createErrorResponse('解析失败', `备份文件格式错误：${error.message}`, 400, request);
			}
		}

		// 验证备份数据格式
		if (!backupData.secrets || !Array.isArray(backupData.secrets)) {
			return createErrorResponse('备份数据格式错误', '备份文件数据格式不正确', 400, request);
		}

		// 按服务名称排序
		const sortedSecrets = [...backupData.secrets].sort((a, b) => {
			const nameA = a.name.toLowerCase();
			const nameB = b.name.toLowerCase();
			if (nameA < nameB) {
				return -1;
			}
			if (nameA > nameB) {
				return 1;
			}
			return 0;
		});

		// 生成文件名（从备份文件名中提取日期）
		const dateMatch = backupKey.match(/backup_(\d{4}-\d{2}-\d{2})/);
		const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

		let content, contentType, filename, extension;

		// 根据格式生成不同的内容
		switch (format) {
			case 'txt': {
				// OTPAuth URI 格式
				const otpauthUrls = sortedSecrets.map((secret) => {
					const serviceName = secret.name.trim();
					const accountName = secret.account ? secret.account.trim() : '';

					let label;
					if (accountName) {
						label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
					} else {
						label = encodeURIComponent(serviceName);
					}

					const params = new URLSearchParams({
						secret: secret.secret.toUpperCase(),
						digits: (secret.digits || 6).toString(),
						period: (secret.period || 30).toString(),
						algorithm: secret.algorithm || 'SHA1',
						issuer: serviceName,
					});

					return 'otpauth://totp/' + label + '?' + params.toString();
				});

				content = otpauthUrls.join('\n');
				contentType = 'text/plain;charset=utf-8';
				extension = 'txt';
				filename = `2FA-backup-${dateStr}.${extension}`;
				break;
			}

			case 'json': {
				// JSON 格式
				const jsonData = {
					version: '1.0',
					exportDate: new Date().toISOString(),
					count: sortedSecrets.length,
					secrets: sortedSecrets.map((secret) => ({
						name: secret.name,
						account: secret.account || '',
						secret: secret.secret.toUpperCase(),
						type: secret.type || 'TOTP',
						digits: secret.digits || 6,
						period: secret.period || 30,
						algorithm: secret.algorithm || 'SHA1',
						counter: secret.counter || 0,
						createdAt: secret.createdAt || new Date().toISOString(),
					})),
				};
				content = JSON.stringify(jsonData, null, 2);
				contentType = 'application/json;charset=utf-8';
				extension = 'json';
				filename = `2FA-backup-${dateStr}.${extension}`;
				break;
			}

			case 'csv': {
				// CSV 格式
				const escapeCSV = (str) => {
					if (str === null || str === undefined) {
						return '""';
					}
					const s = String(str);
					if (s.includes(',') || s.includes('"') || s.includes('\n')) {
						return '"' + s.replace(/"/g, '""') + '"';
					}
					return '"' + s + '"';
				};

				const headers = ['服务名称', '账户信息', '密钥', '类型', '位数', '周期(秒)', '算法', '计数器', '创建时间'];
				const csvRows = [headers.join(',')];

				sortedSecrets.forEach((secret) => {
					const row = [
						escapeCSV(secret.name),
						escapeCSV(secret.account || ''),
						escapeCSV(secret.secret.toUpperCase()),
						escapeCSV(secret.type || 'TOTP'),
						secret.digits || 6,
						secret.period || 30,
						escapeCSV(secret.algorithm || 'SHA1'),
						secret.counter || 0,
						escapeCSV(secret.createdAt || new Date().toISOString()),
					];
					csvRows.push(row.join(','));
				});

				// 添加 BOM 以确保 Excel 正确识别 UTF-8
				const bom = '\uFEFF';
				content = bom + csvRows.join('\n');
				contentType = 'text/csv;charset=utf-8';
				extension = 'csv';
				filename = `2FA-backup-${dateStr}.${extension}`;
				break;
			}

			default:
				return createErrorResponse('不支持的格式', `格式 ${format} 不受支持`, 400, request);
		}

		logger.info('导出备份成功', {
			backupKey,
			format,
			secretCount: sortedSecrets.length,
			encrypted: isEncrypted,
		});

		// 返回文件
		const response = new Response(content, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			},
		});

		return response;
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof NotFoundError ||
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ValidationError
		) {
			logError(error, logger, { operation: 'handleExportBackup', backupKey: backupKey || 'unknown' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'导出备份失败',
			{
				backupKey: backupKey || 'unknown',
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('导出备份失败', `导出备份时发生错误：${error.message}`, 500, request);
	}
}

/**
 * 处理恢复备份
 * 🔒 自动解密加密的备份
 *
 * 支持两种模式:
 * - preview: true - 仅预览备份内容，不执行恢复
 * - preview: false - 实际执行恢复操作
 *
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象
 * @returns {Response} HTTP响应
 */
export async function handleRestoreBackup(request, env) {
	const logger = getLogger(env);

	try {
		let backupKey;
		let isPreview = false;

		// 支持GET和POST请求
		if (request.method === 'GET') {
			const url = new URL(request.url);
			backupKey = url.searchParams.get('key');

			if (!backupKey) {
				return createErrorResponse('备份键缺失', '请提供要恢复的备份键名', 400, request);
			}

			// 手动验证备份键格式
			if (!backupKey.startsWith('backup_') || !backupKey.endsWith('.json')) {
				return createErrorResponse('备份键格式错误', '备份键格式不正确', 400, request);
			}
		} else if (request.method === 'POST') {
			// 🔍 使用验证中间件解析和验证POST请求
			const data = await validateRequest(restoreBackupSchema)(request);
			if (data instanceof Response) {
				return data;
			} // 验证失败

			backupKey = data.backupKey;
			isPreview = data.preview;
		} else {
			return createErrorResponse('方法不支持', '只支持GET和POST请求', 405, request);
		}

		// 获取备份数据（可能是加密的）
		const backupContent = await env.SECRETS_KV.get(backupKey, 'text');

		if (!backupContent) {
			return createErrorResponse('备份不存在', `找不到备份文件：${backupKey}`, 404, request);
		}

		// 🔒 检测并解密备份数据
		let backupData;
		const isEncrypted = backupContent.startsWith('v1:');

		if (isEncrypted) {
			// 加密的备份，需要解密
			if (!env.ENCRYPTION_KEY) {
				return createErrorResponse(
					'无法恢复',
					'备份文件已加密，但未配置 ENCRYPTION_KEY。如需恢复加密备份，请先配置正确的加密密钥。',
					400,
					request,
				);
			}

			try {
				backupData = await decryptData(backupContent, env);
				logger.info('备份已解密', {
					backupKey,
					encrypted: true,
				});
			} catch (error) {
				return createErrorResponse('解密失败', `无法解密备份文件：${error.message}。可能使用了错误的加密密钥。`, 500);
			}
		} else {
			// 明文备份，直接解析
			try {
				backupData = JSON.parse(backupContent);
				logger.info('备份是明文格式', {
					backupKey,
					encrypted: false,
				});
			} catch (error) {
				return createErrorResponse('解析失败', `备份文件格式错误：${error.message}`, 400);
			}
		}

		// 如果是预览模式，只返回备份内容
		if (isPreview) {
			return createSuccessResponse({
				message: '备份预览获取成功',
				backupKey: backupKey,
				secrets: backupData.secrets || [],
				count: backupData.count || 0,
				timestamp: backupData.timestamp,
				encrypted: isEncrypted,
			});
		}

		if (!backupData.secrets || !Array.isArray(backupData.secrets)) {
			return createErrorResponse('备份数据无效', '备份文件格式不正确或已损坏', 400, request);
		}

		// 恢复密钥到主存储（使用加密保存）
		// 🔄 立即备份（恢复操作使用 immediate: true 强制立即备份）
		// 注意：saveSecretsToKV 内部会自动调用 saveDataHash 和 triggerBackup
		await saveSecretsToKV(env, backupData.secrets, 'backup-restored', { immediate: true });

		logger.info('✅ 备份恢复完成', {
			backupKey,
			secretCount: backupData.secrets.length,
			wasEncrypted: isEncrypted,
		});

		return createJsonResponse({
			success: true,
			message: `恢复备份成功，共恢复 ${backupData.secrets.length} 个密钥`,
			backupKey: backupKey,
			count: backupData.secrets.length,
			timestamp: backupData.timestamp,
			sourceEncrypted: isEncrypted,
		});
	} catch (error) {
		// 如果是已知的错误类型，记录并转换
		if (
			error instanceof NotFoundError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError
		) {
			logError(error, logger, { operation: 'handleRestoreBackup' });
			return errorToResponse(error, request);
		}

		// 未知错误
		logger.error(
			'恢复备份失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('恢复备份失败', `恢复备份时发生错误：${error.message}`, 500, request);
	}
}
