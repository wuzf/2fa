/**
 * WebDAV 客户端模块
 * 实现备份自动推送到多个 WebDAV 服务器（如 NextCloud、Alist）
 *
 * 设计原则：
 * - 推送失败只 warn 不抛异常，不阻断备份流程
 * - 配置支持加密存储（有 ENCRYPTION_KEY 时加密）
 * - 支持多目标并行推送，每个目标独立记录状态
 * - 15s 超时（AbortController）
 */

import { encryptData, decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';

const WEBDAV_USER_AGENT = '2FA-Manager/1.0 (Cloudflare Workers; WebDAV Client)';
// ==================== 多目标配置管理 ====================

/**
 * 读取所有 WebDAV 配置（含自动迁移）
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Array>} 配置数组
 */
export async function getWebDAVConfigs(env) {
	const logger = getLogger(env);

	try {
		// 先尝试读取新格式
		const raw = await env.SECRETS_KV.get('webdav_configs', 'text');

		if (raw) {
			if (isEncrypted(raw)) {
				return await decryptData(raw, env);
			}
			return JSON.parse(raw);
		}

		// 新格式不存在，检查旧格式并迁移
		const oldRaw = await env.SECRETS_KV.get('webdav_config', 'text');
		if (!oldRaw) {
			return [];
		}

		logger.info('检测到旧版 WebDAV 配置，开始迁移');

		const oldConfig = isEncrypted(oldRaw) ? await decryptData(oldRaw, env) : JSON.parse(oldRaw);

		const id = crypto.randomUUID();
		const newConfig = {
			id,
			name: 'WebDAV',
			enabled: true,
			url: oldConfig.url,
			username: oldConfig.username,
			password: oldConfig.password,
			path: oldConfig.path || '/',
			createdAt: new Date().toISOString(),
		};

		const configs = [newConfig];

		// 迁移状态
		const [oldSuccess, oldError] = await Promise.all([
			env.SECRETS_KV.get('webdav_last_success', 'json'),
			env.SECRETS_KV.get('webdav_last_error', 'json'),
		]);

		const status = {};
		if (oldSuccess) {
			status.lastSuccess = oldSuccess;
		}
		if (oldError) {
			status.lastError = oldError;
		}
		if (Object.keys(status).length > 0) {
			await env.SECRETS_KV.put(`webdav_status_${id}`, JSON.stringify(status));
		}

		// 保存新格式
		await _saveConfigsToKV(env, 'webdav_configs', configs);

		// 删除旧 key
		await Promise.all([
			env.SECRETS_KV.delete('webdav_config'),
			env.SECRETS_KV.delete('webdav_last_success'),
			env.SECRETS_KV.delete('webdav_last_error'),
		]);

		logger.info('WebDAV 配置迁移完成', { id, name: newConfig.name });
		return configs;
	} catch (error) {
		logger.error('读取 WebDAV 配置失败', { error: error.message }, error);
		throw error;
	}
}

/**
 * 保存整个 WebDAV 配置数组
 * @param {Object} env - 环境变量对象
 * @param {Array} configs - 配置数组
 * @returns {Promise<Object>} { success, encrypted, warning? }
 */
export async function saveWebDAVConfigs(env, configs) {
	return _saveConfigsToKV(env, 'webdav_configs', configs);
}

/**
 * 新增或更新单个 WebDAV 配置
 * @param {Object} env - 环境变量对象
 * @param {Object} config - 配置对象（有 id 则更新，无 id 则新增）
 * @returns {Promise<Object>} { success, id, encrypted, warning? }
 */
export async function saveWebDAVSingleConfig(env, config) {
	const configs = await getWebDAVConfigs(env);

	if (config.id) {
		// 更新现有
		const idx = configs.findIndex((c) => c.id === config.id);
		if (idx === -1) {
			return { success: false, error: '未找到指定的 WebDAV 目标' };
		}
		configs[idx] = { ...configs[idx], ...config };
	} else {
		// 新增
		config.id = crypto.randomUUID();
		config.enabled = config.enabled !== undefined ? config.enabled : true;
		config.createdAt = new Date().toISOString();
		configs.push(config);
	}

	const result = await _saveConfigsToKV(env, 'webdav_configs', configs);
	return { ...result, id: config.id };
}

/**
 * 删除单个 WebDAV 配置
 * @param {Object} env - 环境变量对象
 * @param {string} id - 目标 ID
 * @returns {Promise<Object>} { success }
 */
export async function deleteWebDAVSingleConfig(env, id) {
	const configs = await getWebDAVConfigs(env);
	const idx = configs.findIndex((c) => c.id === id);

	if (idx === -1) {
		return { success: false, error: '未找到指定的 WebDAV 目标' };
	}

	configs.splice(idx, 1);
	await _saveConfigsToKV(env, 'webdav_configs', configs);

	// 清理状态 key
	try {
		await env.SECRETS_KV.delete(`webdav_status_${id}`);
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
export async function getWebDAVStatus(env, id) {
	try {
		const status = await env.SECRETS_KV.get(`webdav_status_${id}`, 'json');
		return status || {};
	} catch {
		return {};
	}
}

// ==================== 推送功能 ====================

/**
 * 推送备份到所有已启用的 WebDAV 目标（并行）
 * @param {string} backupKey - 备份文件名
 * @param {string} backupContent - 备份内容
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 推送结果汇总或 null
 */
export async function pushToAllWebDAV(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		const configs = await getWebDAVConfigs(env);
		const enabledConfigs = configs.filter((c) => c.enabled);

		if (enabledConfigs.length === 0) {
			logger.debug('WebDAV 无已启用目标，跳过推送');
			return null;
		}

		logger.info('开始推送备份到所有 WebDAV 目标', {
			backupKey,
			totalTargets: enabledConfigs.length,
		});

		const results = await Promise.all(enabledConfigs.map((config) => _pushToSingleWebDAV(backupKey, backupContent, config, env)));

		const successCount = results.filter((r) => r && r.success).length;
		const failCount = results.filter((r) => r && !r.success).length;

		logger.info('WebDAV 推送完成', {
			backupKey,
			successCount,
			failCount,
		});

		return { results, successCount, failCount };
	} catch (error) {
		logger.warn('WebDAV 推送过程异常', { backupKey, error: error.message });
		return null;
	}
}

/**
 * 推送备份到单个 WebDAV 目标
 * @private
 */
async function _pushToSingleWebDAV(backupKey, backupContent, config, env) {
	const logger = getLogger(env);

	try {
		const baseUrl = config.url.replace(/\/+$/, '');
		const cleanPath = config.path === '/' ? '' : config.path.replace(/\/+$/, '');
		const targetUrl = `${baseUrl}${cleanPath}/${backupKey}`;
		const authHeader = 'Basic ' + _encodeBasicAuth(config.username, config.password);

		logger.info('开始推送备份到 WebDAV', {
			backupKey,
			targetName: config.name,
			targetUrl,
			contentLength: backupContent.length,
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		try {
			let response = await fetch(targetUrl, {
				method: 'PUT',
				signal: controller.signal,
				headers: {
					Authorization: authHeader,
					'Content-Type': 'application/json',
					'User-Agent': WEBDAV_USER_AGENT,
				},
				body: backupContent,
			});

			// 404/409 时尝试自动创建目录后重试
			if ((response.status === 404 || response.status === 409) && cleanPath) {
				logger.info('目标目录不存在，尝试自动创建', { path: cleanPath });
				const mkcolOk = await _ensureDirectory(baseUrl, cleanPath, authHeader, logger, controller.signal);
				if (mkcolOk) {
					response = await fetch(targetUrl, {
						method: 'PUT',
						signal: controller.signal,
						headers: {
							Authorization: authHeader,
							'Content-Type': 'application/json',
							'User-Agent': WEBDAV_USER_AGENT,
						},
						body: backupContent,
					});
				}
			}

			clearTimeout(timeoutId);

			if (response.ok || response.status === 201 || response.status === 204) {
				logger.info('WebDAV 推送成功', {
					backupKey,
					targetName: config.name,
					status: response.status,
				});

				await _recordWebDAVStatus(env, config.id, {
					lastSuccess: { backupKey, timestamp: new Date().toISOString() },
					lastError: null,
				});

				return { success: true, id: config.id, name: config.name, backupKey, status: response.status };
			}

			const errorMsg = `WebDAV 服务器返回 ${response.status}: ${response.statusText}`;
			logger.warn('WebDAV 推送失败', { backupKey, targetName: config.name, status: response.status });

			await _recordWebDAVStatusError(env, config.id, backupKey, errorMsg);
			return { success: false, id: config.id, name: config.name, backupKey, error: errorMsg };
		} catch (fetchError) {
			clearTimeout(timeoutId);

			const errorMsg = fetchError.name === 'AbortError' ? 'WebDAV 推送超时（15s）' : `WebDAV 推送失败: ${fetchError.message}`;
			logger.warn(errorMsg, { backupKey, targetName: config.name });

			try {
				await _recordWebDAVStatusError(env, config.id, backupKey, errorMsg);
			} catch {
				// 静默忽略
			}
			return { success: false, id: config.id, name: config.name, backupKey, error: errorMsg };
		}
	} catch (error) {
		logger.warn('WebDAV 推送过程异常', { backupKey, targetName: config.name, error: error.message });

		try {
			await _recordWebDAVStatusError(env, config.id, backupKey, error.message);
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
		return `${prefix}失败：服务器地址不正确或存在重定向`;
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

	const short = msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
	return `${prefix}失败：${short}`;
}

/**
 * 测试 WebDAV 连接
 * @param {Object} config - 配置对象 { url, username, password, path }
 * @returns {Promise<Object>} { success, message, method? }
 */
export async function testWebDAVConnection(config) {
	const baseUrl = config.url.replace(/\/+$/, '');
	const path = config.path || '/';
	const cleanPath = path === '/' ? '' : path.replace(/\/+$/, '');
	const targetUrl = path === '/' ? `${baseUrl}/` : `${baseUrl}${path}`;
	const authHeader = 'Basic ' + _encodeBasicAuth(config.username, config.password);

	const methods = [
		{
			method: 'PROPFIND',
			headers: { Authorization: authHeader, Depth: '0', 'Content-Type': 'application/xml', 'User-Agent': WEBDAV_USER_AGENT },
		},
		{ method: 'OPTIONS', headers: { Authorization: authHeader, 'User-Agent': WEBDAV_USER_AGENT } },
		{ method: 'HEAD', headers: { Authorization: authHeader, 'User-Agent': WEBDAV_USER_AGENT } },
		{ method: 'GET', headers: { Authorization: authHeader, 'User-Agent': WEBDAV_USER_AGENT } },
	];

	let all520 = true;
	let connectOk = false;
	let successMethod = null;

	for (const { method, headers } of methods) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		try {
			const response = await fetch(targetUrl, {
				method,
				signal: controller.signal,
				headers,
			});

			clearTimeout(timeoutId);

			if (response.ok || response.status === 207) {
				connectOk = true;
				successMethod = method;
				break;
			}

			if (response.status === 401 || response.status === 403) {
				return { success: false, message: '认证失败，请检查用户名和密码' };
			}

			if (response.status !== 520) {
				all520 = false;
			}

			if (response.status === 520 || response.status === 405) {
				continue;
			}

			if (response.status === 404 && method !== 'PROPFIND') {
				connectOk = true;
				successMethod = method;
				break;
			}

			continue;
		} catch (error) {
			clearTimeout(timeoutId);
			all520 = false;

			if (error.name === 'AbortError') {
				return { success: false, message: '连接超时（15s），请检查服务器地址' };
			}

			continue;
		}
	}

	if (!connectOk) {
		if (all520) {
			return {
				success: false,
				message:
					'该 WebDAV 服务器使用了 Cloudflare CDN，Cloudflare Workers 内部请求到 Cloudflare 代理的域名会触发路由冲突（错误 520）。请使用未经 Cloudflare 代理的 WebDAV 服务，如自建 NextCloud、Alist 等。',
			};
		}
		return { success: false, message: '连接失败：所有测试方法均不可用，请检查服务器地址和网络' };
	}

	// 写入测试文件
	const testFileName = '.2fa-webdav-test.txt';
	const testFileUrl = `${baseUrl}${cleanPath}/${testFileName}`;
	const testContent = JSON.stringify({
		test: true,
		timestamp: new Date().toISOString(),
		message: '2FA Manager WebDAV 连接测试文件，可安全删除',
	});

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 15000);

	try {
		let putResponse = await fetch(testFileUrl, {
			method: 'PUT',
			signal: controller.signal,
			headers: {
				Authorization: authHeader,
				'Content-Type': 'application/json',
				'User-Agent': WEBDAV_USER_AGENT,
			},
			body: testContent,
		});

		if ((putResponse.status === 404 || putResponse.status === 409) && cleanPath) {
			const mkcolOk = await _ensureDirectory(
				baseUrl,
				cleanPath,
				authHeader,
				{ info: () => {}, debug: () => {}, warn: () => {} },
				controller.signal,
			);
			if (mkcolOk) {
				putResponse = await fetch(testFileUrl, {
					method: 'PUT',
					signal: controller.signal,
					headers: {
						Authorization: authHeader,
						'Content-Type': 'application/json',
						'User-Agent': WEBDAV_USER_AGENT,
					},
					body: testContent,
				});
			}
		}

		clearTimeout(timeoutId);

		if (putResponse.ok || putResponse.status === 201 || putResponse.status === 204) {
			return { success: true, message: `连接成功，已验证写入权限（测试文件：${testFileName}）`, method: successMethod };
		}

		if (putResponse.status === 404) {
			return { success: false, message: '写入测试失败：目标路径不存在且无法自动创建，请检查备份路径配置' };
		}

		if (putResponse.status === 401 || putResponse.status === 403) {
			return { success: false, message: '写入测试失败：没有写入权限，请检查账号权限' };
		}

		return { success: false, message: `写入测试失败：服务器返回 ${putResponse.status} ${putResponse.statusText}` };
	} catch (error) {
		clearTimeout(timeoutId);

		if (error.name === 'AbortError') {
			return { success: false, message: '写入测试超时（15s）' };
		}

		return { success: false, message: _friendlyFetchError(error, '写入测试') };
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
		warning = 'ENCRYPTION_KEY 未配置，WebDAV 密码以明文存储。建议配置加密密钥。';
	}

	return { success: true, encrypted, warning };
}

/**
 * 记录 WebDAV 目标状态（合并 lastSuccess/lastError）
 * @private
 */
async function _recordWebDAVStatus(env, id, statusUpdate) {
	try {
		const existing = await getWebDAVStatus(env, id);
		const merged = { ...existing, ...statusUpdate };
		await env.SECRETS_KV.put(`webdav_status_${id}`, JSON.stringify(merged));
	} catch {
		// 静默忽略
	}
}

/**
 * 记录 WebDAV 推送错误
 * @private
 */
async function _recordWebDAVStatusError(env, id, backupKey, errorMsg) {
	await _recordWebDAVStatus(env, id, {
		lastError: {
			backupKey,
			error: errorMsg,
			timestamp: new Date().toISOString(),
		},
	});
}

/**
 * 确保 WebDAV 目标目录存在，逐级创建
 * @private
 */
async function _ensureDirectory(baseUrl, path, authHeader, logger, signal) {
	const parts = path.split('/').filter(Boolean);
	let currentPath = '';

	for (const part of parts) {
		currentPath += '/' + part;
		const dirUrl = `${baseUrl}${currentPath}/`;

		try {
			const response = await fetch(dirUrl, {
				method: 'MKCOL',
				headers: { Authorization: authHeader, 'User-Agent': WEBDAV_USER_AGENT },
				signal,
			});

			if (response.ok || response.status === 201) {
				logger.info('WebDAV 目录已创建', { path: currentPath });
			} else if (response.status === 405 || response.status === 301) {
				logger.debug('WebDAV 目录已存在', { path: currentPath, status: response.status });
			} else {
				logger.warn('WebDAV 创建目录失败', { path: currentPath, status: response.status, statusText: response.statusText });
				return false;
			}
		} catch (error) {
			logger.warn('WebDAV MKCOL 请求失败', { path: currentPath, error: error.message });
			return false;
		}
	}

	return true;
}

/**
 * 编码 Basic Auth 凭据
 * @private
 */
function _encodeBasicAuth(username, password) {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(`${username}:${password}`);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

// ==================== 兼容性导出 ====================

/**
 * 读取单个 WebDAV 配置（兼容旧 API，返回第一个启用的配置）
 * @deprecated 使用 getWebDAVConfigs 代替
 */
export async function getWebDAVConfig(env) {
	const configs = await getWebDAVConfigs(env);
	return configs.find((c) => c.enabled) || configs[0] || null;
}

/**
 * 保存单个 WebDAV 配置（兼容旧 API）
 * @deprecated 使用 saveWebDAVSingleConfig 代替
 */
export async function saveWebDAVConfig(env, config) {
	return saveWebDAVSingleConfig(env, config);
}

/**
 * 推送到 WebDAV（兼容旧 API，推送到所有目标）
 * @deprecated 使用 pushToAllWebDAV 代替
 */
export async function pushToWebDAV(backupKey, backupContent, env) {
	return pushToAllWebDAV(backupKey, backupContent, env);
}
