/**
 * 路由处理器模块
 * 负责解析请求并分发到对应的处理函数
 */

// API 处理器
import {
	handleGetSecrets,
	handleAddSecret,
	handleUpdateSecret,
	handleDeleteSecret,
	handleGenerateOTP,
	handleBatchAddSecrets,
	handleBackupSecrets,
	handleGetBackups,
	handleRestoreBackup,
	handleExportBackup,
} from '../api/secrets/index.js';
import { handleFaviconProxy } from '../api/favicon.js';
import {
	handleGetWebDAVConfigs,
	handleSaveWebDAVConfig,
	handleTestWebDAV,
	handleDeleteWebDAVConfig,
	handleToggleWebDAV,
} from '../api/webdav.js';
import { handleGetS3Configs, handleSaveS3Config, handleTestS3, handleDeleteS3Config, handleToggleS3 } from '../api/s3.js';
import { handleChangePassword } from '../api/password.js';
import { handleGetSettings, handleSaveSettings } from '../api/settings.js';

// UI 页面生成器
import { createMainPage } from '../ui/page.js';
import { createSetupPage } from '../ui/setupPage.js';
import { createManifest, createDefaultIcon } from '../ui/manifest.js';
import { createServiceWorker } from '../ui/serviceworker.js';
import { getModuleCode } from '../ui/scripts/index.js';

// 工具函数
import { createErrorResponse } from '../utils/response.js';
import {
	verifyAuthWithDetails,
	requiresAuth,
	createUnauthorizedResponse,
	handleLogin,
	handleRefreshToken,
	checkIfSetupRequired,
	handleFirstTimeSetup,
} from '../utils/auth.js';
import { createPreflightResponse } from '../utils/security.js';
import { getLogger } from '../utils/logger.js';

/**
 * 处理HTTP请求的主要函数
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象，包含KV存储
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} HTTP响应
 */
export async function handleRequest(request, env, ctx) {
	const url = new URL(request.url);
	const method = request.method;
	const pathname = url.pathname;
	const logger = getLogger(env);

	try {
		// 🔧 首次设置路由（不需要认证）
		if (pathname === '/setup') {
			// 检查是否需要首次设置
			const setupRequired = await checkIfSetupRequired(env);
			if (!setupRequired) {
				// 已完成设置，重定向到首页
				return Response.redirect(new URL('/', request.url).toString(), 302);
			}
			return await createSetupPage();
		}

		// 🔧 首次设置 API（不需要认证）
		if (pathname === '/api/setup' && method === 'POST') {
			return await handleFirstTimeSetup(request, env);
		}

		// 检查是否需要首次设置
		const setupRequired = await checkIfSetupRequired(env);
		if (setupRequired && pathname === '/') {
			// 需要首次设置，重定向到设置页面
			return Response.redirect(new URL('/setup', request.url).toString(), 302);
		}

		// 🔐 检查是否需要身份验证（使用详细验证以支持自动续期）
		let authDetails = null;
		if (requiresAuth(pathname)) {
			authDetails = await verifyAuthWithDetails(request, env);

			if (!authDetails || !authDetails.valid) {
				// 检查是否未配置 KV 存储
				if (!env.SECRETS_KV) {
					return createErrorResponse('服务未配置', '服务器未配置 KV 存储。请联系管理员配置 SECRETS_KV。', 503, request);
				}

				// 检查是否未设置密码
				const storedPasswordHash = await env.SECRETS_KV.get('user_password');
				if (!storedPasswordHash) {
					return createErrorResponse('未设置密码', '请访问 /setup 进行首次设置。', 503, request);
				}

				return createUnauthorizedResponse(null, request);
			}

			// 📊 记录认证详情（用于自动续期）
			request.authDetails = authDetails;
		}

		// 静态路由处理
		if (pathname === '/' || pathname === '') {
			return await createMainPage();
		}

		// PWA Manifest
		if (pathname === '/manifest.json') {
			return createManifest(request);
		}

		// Service Worker
		if (pathname === '/sw.js') {
			return createServiceWorker(env);
		}

		// PWA 图标（使用默认SVG图标）
		if (pathname === '/icon-192.png' || pathname === '/icon-512.png') {
			const size = pathname.includes('512') ? 512 : 192;
			return createDefaultIcon(size);
		}

		// 懒加载模块路由（需要认证）
		if (pathname.startsWith('/modules/')) {
			const moduleName = pathname.substring(9).replace('.js', ''); // 去掉 '/modules/' 和 '.js'
			const allowedModules = ['import', 'export', 'backup', 'qrcode', 'tools', 'googleMigration'];

			if (!allowedModules.includes(moduleName)) {
				return createErrorResponse('模块未找到', `不存在的模块: ${moduleName}`, 404, request);
			}

			try {
				const moduleCode = getModuleCode(moduleName);
				return new Response(moduleCode, {
					headers: {
						'Content-Type': 'application/javascript; charset=utf-8',
						'Cache-Control': 'public, max-age=3600', // 缓存1小时
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				logger.error(`加载模块 ${moduleName} 失败`, { errorMessage: error.message }, error);
				return createErrorResponse('模块加载失败', error.message, 500, request);
			}
		}

		// 登录路由
		if (pathname === '/api/login' && method === 'POST') {
			return await handleLogin(request, env);
		}

		// Token 刷新路由
		if (pathname === '/api/refresh-token' && method === 'POST') {
			return await handleRefreshToken(request, env);
		}

		// API路由处理
		if (pathname.startsWith('/api/')) {
			const response = await handleApiRequest(pathname, method, request, env, ctx);

			// 🔄 自动续期：如果 Token 剩余时间 < 7天，在响应头中添加标记
			if (request.authDetails && request.authDetails.needsRefresh) {
				const newResponse = new Response(response.body, response);
				newResponse.headers.set('X-Token-Refresh-Needed', 'true');
				newResponse.headers.set('X-Token-Remaining-Days', request.authDetails.remainingDays.toFixed(2));

				logger.info('Token 即将过期，建议客户端刷新', {
					remainingDays: request.authDetails.remainingDays.toFixed(2),
				});

				return newResponse;
			}

			return response;
		}

		// OTP生成路由（支持高级参数）
		// 处理 /otp（显示使用说明）
		if (pathname === '/otp') {
			return await handleGenerateOTP('', request);
		}

		// 处理 /otp/{secret}（生成OTP）
		if (pathname.startsWith('/otp/')) {
			const secret = pathname.substring(5); // 去掉 '/otp/'
			return await handleGenerateOTP(secret, request);
		}

		// 404处理
		return createErrorResponse('页面未找到', '请求的页面不存在', 404, request);
	} catch (error) {
		logger.error(
			'请求处理失败',
			{
				method,
				pathname,
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('服务器错误', '请求处理失败，请稍后重试', 500, request);
	}
}

/**
 * 处理API请求
 * @param {string} pathname - 请求路径
 * @param {string} method - HTTP方法
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量对象
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文
 * @returns {Response} HTTP响应
 */
async function handleApiRequest(pathname, method, request, env, ctx) {
	// 密钥管理API
	if (pathname === '/api/secrets') {
		switch (method) {
			case 'GET':
				return handleGetSecrets(env);
			case 'POST':
				return handleAddSecret(request, env, ctx);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}

	// 批量导入API（必须在 /api/secrets/{id} 之前匹配）
	if (pathname === '/api/secrets/batch') {
		if (method === 'POST') {
			return handleBatchAddSecrets(request, env, ctx);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// 单个密钥操作API
	if (pathname.startsWith('/api/secrets/')) {
		const secretId = pathname.substring('/api/secrets/'.length);
		if (!secretId) {
			return createErrorResponse('无效路径', '缺少密钥ID', 400, request);
		}

		switch (method) {
			case 'PUT':
				return handleUpdateSecret(request, env, ctx);
			case 'DELETE':
				return handleDeleteSecret(request, env, ctx);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}

	// 备份管理API
	if (pathname === '/api/backup') {
		switch (method) {
			case 'POST':
				return handleBackupSecrets(request, env, ctx);
			case 'GET':
				return handleGetBackups(request, env);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}

	// 恢复备份API
	if (pathname === '/api/backup/restore') {
		if (method === 'POST') {
			return handleRestoreBackup(request, env, ctx);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// 导出备份API
	if (pathname.startsWith('/api/backup/export/')) {
		if (method === 'GET') {
			const backupKey = pathname.replace('/api/backup/export/', '');
			return handleExportBackup(request, env, backupKey);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// 修改密码 API
	if (pathname === '/api/change-password') {
		if (method === 'POST') {
			return handleChangePassword(request, env);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// 系统设置 API
	if (pathname === '/api/settings') {
		switch (method) {
			case 'GET':
				return handleGetSettings(request, env);
			case 'POST':
				return handleSaveSettings(request, env);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}

	// WebDAV 配置 API
	if (pathname === '/api/webdav/config') {
		switch (method) {
			case 'GET':
				return handleGetWebDAVConfigs(request, env);
			case 'POST':
				return handleSaveWebDAVConfig(request, env);
			case 'DELETE':
				return handleDeleteWebDAVConfig(request, env);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}
	if (pathname === '/api/webdav/test') {
		if (method === 'POST') {
			return handleTestWebDAV(request, env);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}
	if (pathname === '/api/webdav/toggle') {
		if (method === 'POST') {
			return handleToggleWebDAV(request, env);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// S3 配置 API
	if (pathname === '/api/s3/config') {
		switch (method) {
			case 'GET':
				return handleGetS3Configs(request, env);
			case 'POST':
				return handleSaveS3Config(request, env);
			case 'DELETE':
				return handleDeleteS3Config(request, env);
			default:
				return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
		}
	}
	if (pathname === '/api/s3/test') {
		if (method === 'POST') {
			return handleTestS3(request, env);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}
	if (pathname === '/api/s3/toggle') {
		if (method === 'POST') {
			return handleToggleS3(request, env);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// Favicon 代理 API（不需要认证，公开访问）
	if (pathname.startsWith('/api/favicon/')) {
		if (method === 'GET') {
			const domain = pathname.replace('/api/favicon/', '');
			return handleFaviconProxy(request, env, domain);
		}
		return createErrorResponse('方法不允许', `不支持的HTTP方法: ${method}`, 405, request);
	}

	// 未知API路径
	return createErrorResponse('API未找到', '请求的API端点不存在', 404, request);
}

/**
 * 处理CORS预检请求
 * @param {Request} request - HTTP请求对象
 * @returns {Response|null} CORS响应或 null
 */
export function handleCORS(request) {
	return createPreflightResponse(request);
}
