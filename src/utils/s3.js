/**
 * S3 兼容存储客户端模块
 * 实现备份自动推送到多个 S3 兼容存储（AWS S3、Cloudflare R2、MinIO、阿里云 OSS 等）
 *
 * 设计原则：
 * - 推送失败只 warn 不抛异常，不阻断备份流程
 * - 配置支持加密存储（有 ENCRYPTION_KEY 时加密）
 * - 支持多目标并行推送，每个目标独立记录状态
 * - 15s 超时（AbortController）
 * - 使用 aws4fetch 实现 AWS Signature V4 签名
 */

import { AwsClient } from 'aws4fetch';
import { encryptData, decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';

// ==================== 多目标配置管理 ====================

/**
 * 读取所有 S3 配置（含自动迁移）
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Array>} 配置数组
 */
export async function getS3Configs(env) {
	const logger = getLogger(env);

	try {
		// 先尝试读取新格式
		const raw = await env.SECRETS_KV.get('s3_configs', 'text');

		if (raw) {
			if (isEncrypted(raw)) {
				return await decryptData(raw, env);
			}
			return JSON.parse(raw);
		}

		// 新格式不存在，检查旧格式并迁移
		const oldRaw = await env.SECRETS_KV.get('s3_config', 'text');
		if (!oldRaw) {
			return [];
		}

		logger.info('检测到旧版 S3 配置，开始迁移');

		const oldConfig = isEncrypted(oldRaw) ? await decryptData(oldRaw, env) : JSON.parse(oldRaw);

		const id = crypto.randomUUID();
		const newConfig = {
			id,
			name: 'S3',
			enabled: true,
			endpoint: oldConfig.endpoint,
			bucket: oldConfig.bucket,
			region: oldConfig.region || 'auto',
			accessKeyId: oldConfig.accessKeyId,
			secretAccessKey: oldConfig.secretAccessKey,
			prefix: oldConfig.prefix || '',
			createdAt: new Date().toISOString(),
		};

		const configs = [newConfig];

		// 迁移状态
		const [oldSuccess, oldError] = await Promise.all([
			env.SECRETS_KV.get('s3_last_success', 'json'),
			env.SECRETS_KV.get('s3_last_error', 'json'),
		]);

		const status = {};
		if (oldSuccess) {
			status.lastSuccess = oldSuccess;
		}
		if (oldError) {
			status.lastError = oldError;
		}
		if (Object.keys(status).length > 0) {
			await env.SECRETS_KV.put(`s3_status_${id}`, JSON.stringify(status));
		}

		// 保存新格式
		await _saveConfigsToKV(env, 's3_configs', configs);

		// 删除旧 key
		await Promise.all([
			env.SECRETS_KV.delete('s3_config'),
			env.SECRETS_KV.delete('s3_last_success'),
			env.SECRETS_KV.delete('s3_last_error'),
		]);

		logger.info('S3 配置迁移完成', { id, name: newConfig.name });
		return configs;
	} catch (error) {
		logger.error('读取 S3 配置失败', { error: error.message }, error);
		throw error;
	}
}

/**
 * 保存整个 S3 配置数组
 * @param {Object} env - 环境变量对象
 * @param {Array} configs - 配置数组
 * @returns {Promise<Object>} { success, encrypted, warning? }
 */
export async function saveS3Configs(env, configs) {
	return _saveConfigsToKV(env, 's3_configs', configs);
}

/**
 * 新增或更新单个 S3 配置
 * @param {Object} env - 环境变量对象
 * @param {Object} config - 配置对象（有 id 则更新，无 id 则新增）
 * @returns {Promise<Object>} { success, id, encrypted, warning? }
 */
export async function saveS3SingleConfig(env, config) {
	const configs = await getS3Configs(env);

	if (config.id) {
		// 更新现有
		const idx = configs.findIndex((c) => c.id === config.id);
		if (idx === -1) {
			return { success: false, error: '未找到指定的 S3 目标' };
		}
		configs[idx] = { ...configs[idx], ...config };
	} else {
		// 新增
		config.id = crypto.randomUUID();
		config.enabled = config.enabled !== undefined ? config.enabled : true;
		config.createdAt = new Date().toISOString();
		configs.push(config);
	}

	const result = await _saveConfigsToKV(env, 's3_configs', configs);
	return { ...result, id: config.id };
}

/**
 * 删除单个 S3 配置
 * @param {Object} env - 环境变量对象
 * @param {string} id - 目标 ID
 * @returns {Promise<Object>} { success }
 */
export async function deleteS3SingleConfig(env, id) {
	const configs = await getS3Configs(env);
	const idx = configs.findIndex((c) => c.id === id);

	if (idx === -1) {
		return { success: false, error: '未找到指定的 S3 目标' };
	}

	configs.splice(idx, 1);
	await _saveConfigsToKV(env, 's3_configs', configs);

	// 清理状态 key
	try {
		await env.SECRETS_KV.delete(`s3_status_${id}`);
	} catch {
		// 静默忽略
	}

	return { success: true };
}

/**
 * 读取单个目标的状态
 * @param {Object} env - 环境变量对象
 * @param {string} id - 目标 ID
 * @returns {Promise<Object>} { lastSuccess?, lastError? }
 */
export async function getS3Status(env, id) {
	try {
		const status = await env.SECRETS_KV.get(`s3_status_${id}`, 'json');
		return status || {};
	} catch {
		return {};
	}
}

// ==================== 推送功能 ====================

/**
 * 推送备份到所有已启用的 S3 目标（并行）
 * @param {string} backupKey - 备份文件名
 * @param {string} backupContent - 备份内容
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 推送结果汇总或 null
 */
export async function pushToAllS3(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		const configs = await getS3Configs(env);
		const enabledConfigs = configs.filter((c) => c.enabled);

		if (enabledConfigs.length === 0) {
			logger.debug('S3 无已启用目标，跳过推送');
			return null;
		}

		logger.info('开始推送备份到所有 S3 目标', {
			backupKey,
			totalTargets: enabledConfigs.length,
		});

		const results = await Promise.all(enabledConfigs.map((config) => _pushToSingleS3(backupKey, backupContent, config, env)));

		const successCount = results.filter((r) => r && r.success).length;
		const failCount = results.filter((r) => r && !r.success).length;

		logger.info('S3 推送完成', {
			backupKey,
			successCount,
			failCount,
		});

		return { results, successCount, failCount };
	} catch (error) {
		logger.warn('S3 推送过程异常', { backupKey, error: error.message });
		return null;
	}
}

/**
 * 推送备份到单个 S3 目标
 * @private
 */
async function _pushToSingleS3(backupKey, backupContent, config, env) {
	const logger = getLogger(env);

	try {
		const endpoint = config.endpoint.replace(/\/+$/, '');
		const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
		const targetUrl = `${endpoint}/${config.bucket}/${prefix}${backupKey}`;

		logger.info('开始推送备份到 S3', {
			backupKey,
			targetName: config.name,
			bucket: config.bucket,
			contentLength: backupContent.length,
		});

		const client = new AwsClient({
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			region: config.region || 'auto',
			service: 's3',
		});

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
					targetName: config.name,
					status: response.status,
				});

				await _recordS3Status(env, config.id, {
					lastSuccess: { backupKey, timestamp: new Date().toISOString() },
					lastError: null,
				});

				return { success: true, id: config.id, name: config.name, backupKey, status: response.status };
			}

			const errorMsg = `S3 服务器返回 ${response.status}: ${response.statusText}`;
			logger.warn('S3 推送失败', { backupKey, targetName: config.name, status: response.status });

			await _recordS3StatusError(env, config.id, backupKey, errorMsg);
			return { success: false, id: config.id, name: config.name, backupKey, error: errorMsg };
		} catch (fetchError) {
			clearTimeout(timeoutId);

			const errorMsg = fetchError.name === 'AbortError' ? 'S3 推送超时（15s）' : `S3 推送失败: ${fetchError.message}`;
			logger.warn(errorMsg, { backupKey, targetName: config.name });

			try {
				await _recordS3StatusError(env, config.id, backupKey, errorMsg);
			} catch {
				// 静默忽略
			}
			return { success: false, id: config.id, name: config.name, backupKey, error: errorMsg };
		}
	} catch (error) {
		logger.warn('S3 推送过程异常', { backupKey, targetName: config.name, error: error.message });

		try {
			await _recordS3StatusError(env, config.id, backupKey, error.message);
		} catch {
			// 静默忽略
		}

		return { success: false, id: config.id, name: config.name, backupKey, error: error.message };
	}
}

// ==================== 连接测试 ====================

/**
 * 将 fetch 异常转换为简短友好提示
 * @private
 */
function _friendlyFetchError(error, prefix = '连接') {
	const msg = error.message || '';

	if (/redirect/i.test(msg) || msg.length > 200) {
		return `${prefix}失败：Endpoint 地址不正确或存在重定向`;
	}
	if (/dns|getaddrinfo|ENOTFOUND/i.test(msg)) {
		return `${prefix}失败：域名无法解析`;
	}
	if (/ECONNREFUSED/i.test(msg)) {
		return `${prefix}失败：连接被拒绝`;
	}
	if (/certificate|ssl|tls/i.test(msg)) {
		return `${prefix}失败：SSL 证书错误`;
	}

	// 兜底：截断过长的消息
	const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
	return `${prefix}失败：${short}`;
}

/**
 * 测试 S3 连接
 * @param {Object} config - 配置对象
 * @returns {Promise<Object>} { success, message }
 */
export async function testS3Connection(config) {
	const endpoint = config.endpoint.replace(/\/+$/, '');
	const region = config.region || 'auto';

	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region,
		service: 's3',
	});

	// 第一步：ListObjectsV2 验证认证和 Bucket 访问
	const listUrl = `${endpoint}/${config.bucket}?list-type=2&max-keys=1`;

	// 每个网络请求独立 15s 超时，避免第一步耗时挤占第二步预算
	const fetchWithTimeout = async (url, options) => {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);
		try {
			return await client.fetch(url, {
				...options,
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	};

	try {
		const listResponse = await fetchWithTimeout(listUrl, {
			method: 'GET',
		});

		if (listResponse.status === 401 || listResponse.status === 403) {
			return { success: false, message: '认证失败，请检查 Access Key ID 和 Secret Access Key' };
		}

		if (listResponse.status === 404) {
			return { success: false, message: 'Bucket 不存在，请检查 Bucket 名称' };
		}

		if (!listResponse.ok) {
			return { success: false, message: `连接失败：服务器返回 ${listResponse.status} ${listResponse.statusText}` };
		}
	} catch (error) {
		if (error.name === 'AbortError') {
			return { success: false, message: '连接超时（15s），请检查 Endpoint 地址' };
		}

		return { success: false, message: _friendlyFetchError(error) };
	}

	// 第二步：上传测试文件
	const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
	const testFileName = '.2fa-s3-test.txt';
	const testFileUrl = `${endpoint}/${config.bucket}/${prefix}${testFileName}`;
	const testContent = JSON.stringify({
		test: true,
		timestamp: new Date().toISOString(),
		message: '2FA Manager S3 连接测试文件，可安全删除',
	});

	try {
		const putResponse = await fetchWithTimeout(testFileUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
			},
			body: testContent,
		});

		if (putResponse.ok) {
			return { success: true, message: `连接成功，已验证写入权限（测试文件：${prefix}${testFileName}）` };
		}

		if (putResponse.status === 401 || putResponse.status === 403) {
			return { success: false, message: '写入测试失败：没有写入权限，请检查 Access Key 权限' };
		}

		return { success: false, message: `写入测试失败：服务器返回 ${putResponse.status} ${putResponse.statusText}` };
	} catch (error) {
		if (error.name === 'AbortError') {
			return { success: false, message: '写入测试超时（15s）' };
		}

		return { success: false, message: _friendlyFetchError(error, '写入') };
	}
}

// ==================== 内部工具函数 ====================

/**
 * 保存配置数组到 KV（含加密）
 * @private
 */
async function _saveConfigsToKV(env, key, configs) {
	let encrypted = false;
	let warning = null;

	if (env.ENCRYPTION_KEY) {
		const encryptedData = await encryptData(configs, env);
		await env.SECRETS_KV.put(key, encryptedData);
		encrypted = true;
	} else {
		await env.SECRETS_KV.put(key, JSON.stringify(configs));
		warning = 'ENCRYPTION_KEY 未配置，S3 密钥以明文存储。建议配置加密密钥。';
	}

	return { success: true, encrypted, warning };
}

/**
 * 记录 S3 目标状态
 * @private
 */
async function _recordS3Status(env, id, statusUpdate) {
	try {
		const existing = await getS3Status(env, id);
		const merged = { ...existing, ...statusUpdate };
		await env.SECRETS_KV.put(`s3_status_${id}`, JSON.stringify(merged));
	} catch {
		// 静默忽略
	}
}

/**
 * 记录 S3 推送错误
 * @private
 */
async function _recordS3StatusError(env, id, backupKey, errorMsg) {
	await _recordS3Status(env, id, {
		lastError: {
			backupKey,
			error: errorMsg,
			timestamp: new Date().toISOString(),
		},
	});
}

// ==================== 兼容性导出 ====================

/**
 * 读取单个 S3 配置（兼容旧 API）
 * @deprecated 使用 getS3Configs 代替
 */
export async function getS3Config(env) {
	const configs = await getS3Configs(env);
	return configs.find((c) => c.enabled) || configs[0] || null;
}

/**
 * 保存单个 S3 配置（兼容旧 API）
 * @deprecated 使用 saveS3SingleConfig 代替
 */
export async function saveS3Config(env, config) {
	return saveS3SingleConfig(env, config);
}

/**
 * 推送到 S3（兼容旧 API）
 * @deprecated 使用 pushToAllS3 代替
 */
export async function pushToS3(backupKey, backupContent, env) {
	return pushToAllS3(backupKey, backupContent, env);
}
