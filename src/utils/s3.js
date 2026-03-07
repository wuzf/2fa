/**
 * S3 兼容存储客户端模块
 * 实现备份自动推送到 S3 兼容存储（AWS S3、Cloudflare R2、MinIO、阿里云 OSS 等）
 *
 * 设计原则：
 * - 推送失败只 warn 不抛异常，不阻断备份流程
 * - 配置支持加密存储（有 ENCRYPTION_KEY 时加密）
 * - 状态记录：成功写 s3_last_success，失败写 s3_last_error
 * - 15s 超时（AbortController）
 * - 使用 aws4fetch 实现 AWS Signature V4 签名
 */

import { AwsClient } from 'aws4fetch';
import { encryptData, decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';

/**
 * 推送备份到 S3 兼容存储
 * 内部统一处理错误和状态记录，函数永远不抛异常
 *
 * @param {string} backupKey - 备份文件名
 * @param {string} backupContent - 备份内容
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 推送结果或 null
 */
export async function pushToS3(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		// 读取 S3 配置
		const config = await getS3Config(env);

		// 未配置时静默跳过
		if (!config) {
			logger.debug('S3 未配置，跳过推送');
			return null;
		}

		// 构建目标 URL（Path-Style）
		const endpoint = config.endpoint.replace(/\/+$/, '');
		const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
		const targetUrl = `${endpoint}/${config.bucket}/${prefix}${backupKey}`;

		logger.info('开始推送备份到 S3', {
			backupKey,
			bucket: config.bucket,
			contentLength: backupContent.length,
		});

		// 创建 AWS 签名客户端
		const client = new AwsClient({
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			region: config.region || 'auto',
			service: 's3',
		});

		// 15s 超时
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		try {
			const response = await client.fetch(targetUrl, {
				method: 'PUT',
				signal: controller.signal,
				headers: {
					'Content-Type': 'application/json',
				},
				body: backupContent,
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				logger.info('S3 推送成功', {
					backupKey,
					status: response.status,
				});

				// 记录成功状态
				await env.SECRETS_KV.put(
					's3_last_success',
					JSON.stringify({
						backupKey,
						timestamp: new Date().toISOString(),
					}),
				);

				// 清除错误状态
				await env.SECRETS_KV.delete('s3_last_error');

				return { success: true, backupKey, status: response.status };
			}

			// 非成功状态
			const errorMsg = `S3 服务器返回 ${response.status}: ${response.statusText}`;
			logger.warn('S3 推送失败', { backupKey, status: response.status, statusText: response.statusText });

			await _recordS3Error(env, backupKey, errorMsg);
			return { success: false, backupKey, error: errorMsg };
		} catch (fetchError) {
			clearTimeout(timeoutId);

			const errorMsg = fetchError.name === 'AbortError' ? 'S3 推送超时（15s）' : `S3 推送失败: ${fetchError.message}`;
			logger.warn(errorMsg, { backupKey });

			await _recordS3Error(env, backupKey, errorMsg);
			return { success: false, backupKey, error: errorMsg };
		}
	} catch (error) {
		// 最外层兜底，确保永不抛异常
		logger.warn('S3 推送过程异常', { backupKey, error: error.message });

		try {
			await _recordS3Error(env, backupKey, error.message);
		} catch {
			// 静默忽略
		}

		return null;
	}
}

/**
 * 读取 S3 配置（含解密）
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 配置对象或 null
 */
export async function getS3Config(env) {
	try {
		const raw = await env.SECRETS_KV.get('s3_config', 'text');

		if (!raw) {
			return null;
		}

		// 检测是否加密
		if (isEncrypted(raw)) {
			return await decryptData(raw, env);
		}

		return JSON.parse(raw);
	} catch (error) {
		const logger = getLogger(env);
		logger.warn('读取 S3 配置失败', { error: error.message });
		return null;
	}
}

/**
 * 保存 S3 配置（含加密）
 * @param {Object} env - 环境变量对象
 * @param {Object} config - 配置对象
 * @returns {Promise<Object>} { success: boolean, encrypted: boolean, warning?: string }
 */
export async function saveS3Config(env, config) {
	let encrypted = false;
	let warning = null;

	if (env.ENCRYPTION_KEY) {
		const encryptedData = await encryptData(config, env);
		await env.SECRETS_KV.put('s3_config', encryptedData);
		encrypted = true;
	} else {
		await env.SECRETS_KV.put('s3_config', JSON.stringify(config));
		warning = 'ENCRYPTION_KEY 未配置，S3 密钥以明文存储。建议配置加密密钥。';
	}

	return { success: true, encrypted, warning };
}

/**
 * 测试 S3 连接
 * 使用 ListObjectsV2 验证认证和 Bucket 访问，再上传测试文件验证写入权限
 *
 * @param {Object} config - 配置对象
 * @returns {Promise<Object>} { success: boolean, message: string }
 */
export async function testS3Connection(config) {
	const endpoint = config.endpoint.replace(/\/+$/, '');
	const region = config.region || 'auto';

	// 创建 AWS 签名客户端
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region,
		service: 's3',
	});

	// 第一步：ListObjectsV2 验证认证和 Bucket 访问
	const listUrl = `${endpoint}/${config.bucket}?list-type=2&max-keys=1`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 15000);

	try {
		const listResponse = await client.fetch(listUrl, {
			method: 'GET',
			signal: controller.signal,
		});

		if (listResponse.status === 401 || listResponse.status === 403) {
			clearTimeout(timeoutId);
			return { success: false, message: '认证失败，请检查 Access Key ID 和 Secret Access Key' };
		}

		if (listResponse.status === 404) {
			clearTimeout(timeoutId);
			return { success: false, message: 'Bucket 不存在，请检查 Bucket 名称' };
		}

		if (!listResponse.ok) {
			clearTimeout(timeoutId);
			return { success: false, message: `连接失败：服务器返回 ${listResponse.status} ${listResponse.statusText}` };
		}
	} catch (error) {
		clearTimeout(timeoutId);

		if (error.name === 'AbortError') {
			return { success: false, message: '连接超时（15s），请检查 Endpoint 地址' };
		}

		return { success: false, message: `连接失败：${error.message}` };
	}

	// 第二步：上传测试文件，验证写入权限
	const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
	const testFileName = '.2fa-s3-test.txt';
	const testFileUrl = `${endpoint}/${config.bucket}/${prefix}${testFileName}`;
	const testContent = JSON.stringify({
		test: true,
		timestamp: new Date().toISOString(),
		message: '2FA Manager S3 连接测试文件，可安全删除',
	});

	try {
		const putResponse = await client.fetch(testFileUrl, {
			method: 'PUT',
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
			},
			body: testContent,
		});

		clearTimeout(timeoutId);

		if (putResponse.ok) {
			return { success: true, message: `连接成功，已验证写入权限（测试文件：${prefix}${testFileName}）` };
		}

		if (putResponse.status === 401 || putResponse.status === 403) {
			return { success: false, message: '写入测试失败：没有写入权限，请检查 Access Key 权限' };
		}

		return { success: false, message: `写入测试失败：服务器返回 ${putResponse.status} ${putResponse.statusText}` };
	} catch (error) {
		clearTimeout(timeoutId);

		if (error.name === 'AbortError') {
			return { success: false, message: '写入测试超时（15s）' };
		}

		return { success: false, message: `写入测试异常：${error.message}` };
	}
}

/**
 * 记录 S3 推送错误
 * @private
 */
async function _recordS3Error(env, backupKey, errorMsg) {
	try {
		await env.SECRETS_KV.put(
			's3_last_error',
			JSON.stringify({
				backupKey,
				error: errorMsg,
				timestamp: new Date().toISOString(),
			}),
		);
	} catch {
		// 静默忽略
	}
}
