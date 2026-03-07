/**
 * WebDAV 客户端模块
 * 实现备份自动推送到 WebDAV 服务器（如 NextCloud、Alist）
 *
 * 设计原则：
 * - 推送失败只 warn 不抛异常，不阻断备份流程
 * - 配置支持加密存储（有 ENCRYPTION_KEY 时加密）
 * - 状态记录：成功写 webdav_last_success，失败写 webdav_last_error
 * - 15s 超时（AbortController）
 */

import { encryptData, decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';

const WEBDAV_USER_AGENT = '2FA-Manager/1.0 (Cloudflare Workers; WebDAV Client)';

/**
 * 推送备份到 WebDAV 服务器
 * 内部统一处理错误和状态记录，函数永远不抛异常
 *
 * @param {string} backupKey - 备份文件名
 * @param {string} backupContent - 备份内容
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 推送结果或 null
 */
export async function pushToWebDAV(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		// 读取 WebDAV 配置
		const config = await getWebDAVConfig(env);

		// 未配置时静默跳过
		if (!config) {
			logger.debug('WebDAV 未配置，跳过推送');
			return null;
		}

		// 构建目标 URL（确保 url 和 path 之间不出现双斜杠）
		const baseUrl = config.url.replace(/\/+$/, '');
		const cleanPath = config.path === '/' ? '' : config.path.replace(/\/+$/, '');
		const targetUrl = `${baseUrl}${cleanPath}/${backupKey}`;
		const authHeader = 'Basic ' + _encodeBasicAuth(config.username, config.password);

		logger.info('开始推送备份到 WebDAV', {
			backupKey,
			targetUrl,
			contentLength: backupContent.length,
		});

		// 15s 超时
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

			// 404/409 时尝试自动创建目录后重试（部分 WebDAV 服务对不存在的父目录返回 409）
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
					status: response.status,
				});

				// 记录成功状态
				await env.SECRETS_KV.put(
					'webdav_last_success',
					JSON.stringify({
						backupKey,
						timestamp: new Date().toISOString(),
					}),
				);

				// 清除错误状态
				await env.SECRETS_KV.delete('webdav_last_error');

				return { success: true, backupKey, status: response.status };
			}

			// 非成功状态
			const errorMsg = `WebDAV 服务器返回 ${response.status}: ${response.statusText}`;
			logger.warn('WebDAV 推送失败', { backupKey, status: response.status, statusText: response.statusText });

			await _recordWebDAVError(env, backupKey, errorMsg);
			return { success: false, backupKey, error: errorMsg };
		} catch (fetchError) {
			clearTimeout(timeoutId);

			const errorMsg = fetchError.name === 'AbortError' ? 'WebDAV 推送超时（15s）' : `WebDAV 推送失败: ${fetchError.message}`;
			logger.warn(errorMsg, { backupKey });

			await _recordWebDAVError(env, backupKey, errorMsg);
			return { success: false, backupKey, error: errorMsg };
		}
	} catch (error) {
		// 最外层兜底，确保永不抛异常
		logger.warn('WebDAV 推送过程异常', { backupKey, error: error.message });

		try {
			await _recordWebDAVError(env, backupKey, error.message);
		} catch {
			// 静默忽略
		}

		return null;
	}
}

/**
 * 读取 WebDAV 配置（含解密）
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object|null>} 配置对象 { url, username, password, path } 或 null
 */
export async function getWebDAVConfig(env) {
	try {
		const raw = await env.SECRETS_KV.get('webdav_config', 'text');

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
		logger.warn('读取 WebDAV 配置失败', { error: error.message });
		return null;
	}
}

/**
 * 保存 WebDAV 配置（含加密）
 * @param {Object} env - 环境变量对象
 * @param {Object} config - 配置对象 { url, username, password, path }
 * @returns {Promise<Object>} { success: boolean, encrypted: boolean, warning?: string }
 */
export async function saveWebDAVConfig(env, config) {
	let encrypted = false;
	let warning = null;

	if (env.ENCRYPTION_KEY) {
		const encryptedData = await encryptData(config, env);
		await env.SECRETS_KV.put('webdav_config', encryptedData);
		encrypted = true;
	} else {
		await env.SECRETS_KV.put('webdav_config', JSON.stringify(config));
		warning = 'ENCRYPTION_KEY 未配置，WebDAV 密码以明文存储。建议配置加密密钥。';
	}

	return { success: true, encrypted, warning };
}

/**
 * 测试 WebDAV 连接
 * 依次尝试 PROPFIND → HEAD → GET，遇到 520 提示 Cloudflare 不兼容
 *
 * @param {Object} config - 配置对象 { url, username, password, path }
 * @returns {Promise<Object>} { success: boolean, message: string, method?: string }
 */
export async function testWebDAVConnection(config) {
	const baseUrl = config.url.replace(/\/+$/, '');
	const path = config.path || '/';
	const cleanPath = path === '/' ? '' : path.replace(/\/+$/, '');
	const targetUrl = path === '/' ? `${baseUrl}/` : `${baseUrl}${path}`;
	const authHeader = 'Basic ' + _encodeBasicAuth(config.username, config.password);

	// 第一步：验证连接和认证
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

	// 第二步：写入测试文件，验证路径和写入权限
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

		// 目录不存在时尝试自动创建
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

		return { success: false, message: `写入测试异常：${error.message}` };
	}
}

/**
 * 确保 WebDAV 目标目录存在，逐级创建
 * @private
 * @param {string} baseUrl - WebDAV 基础 URL（不含尾部斜杠）
 * @param {string} path - 目标路径，如 /2fa-backup
 * @param {string} authHeader - Authorization 头
 * @param {Object} logger - 日志实例
 * @param {AbortSignal} [signal] - 超时信号
 * @returns {Promise<boolean>} 是否成功
 */
async function _ensureDirectory(baseUrl, path, authHeader, logger, signal) {
	// 逐级创建目录（如 /a/b/c → /a → /a/b → /a/b/c）
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
				// 405 = 目录已存在（部分服务返回），301 = 已存在重定向
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
 * 编码 Basic Auth 凭据（支持非 ASCII 字符如中文用户名/密码）
 * 使用 TextEncoder 将 UTF-8 字符串转为字节后再 base64 编码
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

/**
 * 记录 WebDAV 推送错误
 * @private
 */
async function _recordWebDAVError(env, backupKey, errorMsg) {
	try {
		await env.SECRETS_KV.put(
			'webdav_last_error',
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
