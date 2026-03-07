/**
 * WebDAV 配置 API 端点
 * 提供多目标 WebDAV 配置的 CRUD 操作、启用/禁用切换和连接测试
 *
 * 所有写操作接口使用 checkRateLimit + RATE_LIMIT_PRESETS.sensitive
 */

import {
	getWebDAVConfigs,
	saveWebDAVSingleConfig,
	deleteWebDAVSingleConfig,
	getWebDAVStatus,
	testWebDAVConnection,
} from '../utils/webdav.js';
import { getLogger } from '../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { validateRequest, webdavConfigSchema, toggleDestinationSchema } from '../utils/validation.js';

const MAX_ALLOWED = 5;

/**
 * 获取所有 WebDAV 配置
 * 密码字段返回空字符串，附加 hasPassword 标记
 * 同时返回各目标的推送状态
 */
export async function handleGetWebDAVConfigs(request, env) {
	const logger = getLogger(env);

	try {
		const configs = await getWebDAVConfigs(env);

		const destinations = await Promise.all(
			configs.map(async (c) => {
				const status = await getWebDAVStatus(env, c.id);
				return {
					id: c.id,
					name: c.name,
					enabled: c.enabled,
					config: {
						url: c.url,
						username: c.username,
						password: '',
						hasPassword: !!(c.password && c.password.length > 0),
						path: c.path || '/',
					},
					status: {
						lastSuccess: status.lastSuccess || null,
						lastError: status.lastError || null,
					},
					createdAt: c.createdAt,
				};
			}),
		);

		return createJsonResponse(
			{
				destinations,
				count: destinations.length,
				maxAllowed: MAX_ALLOWED,
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('获取 WebDAV 配置失败', { error: error.message }, error);
		return createErrorResponse('获取配置失败', error.message, 500, request);
	}
}

/**
 * 保存 WebDAV 配置（新增或更新）
 * body 含 id 时更新，不含 id 时新增
 * password 为空时保留已保存的密码
 */
export async function handleSaveWebDAVConfig(request, env) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const body = await validateRequest(webdavConfigSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		// password 为空时保留旧密码
		if (!body.password) {
			if (body.id) {
				// 更新已有配置：从已保存的目标中找密码
				const configs = await getWebDAVConfigs(env);
				const existing = configs.find((c) => c.id === body.id);
				if (existing && existing.password) {
					body.password = existing.password;
				} else {
					return createErrorResponse('请求验证失败', '密码不能为空（无已保存的配置）', 400, request);
				}
			} else {
				// 新增配置：首次必须提供密码
				return createErrorResponse('请求验证失败', '首次配置时密码不能为空', 400, request);
			}
		}

		const result = await saveWebDAVSingleConfig(env, body);

		if (!result.success) {
			return createErrorResponse('保存配置失败', result.error, 400, request);
		}

		logger.info('WebDAV 配置已保存', {
			id: result.id,
			name: body.name,
			url: body.url,
			encrypted: result.encrypted,
		});

		const response = {
			success: true,
			message: 'WebDAV 配置已保存',
			id: result.id,
			encrypted: result.encrypted,
		};

		if (result.warning) {
			response.warning = result.warning;
		}

		return createJsonResponse(response, 200, request);
	} catch (error) {
		logger.error('保存 WebDAV 配置失败', { error: error.message }, error);
		return createErrorResponse('保存配置失败', error.message, 500, request);
	}
}

/**
 * 删除 WebDAV 配置
 * 通过 query param id 指定要删除的目标
 */
export async function handleDeleteWebDAVConfig(request, env) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const url = new URL(request.url);
		const id = url.searchParams.get('id');

		if (!id) {
			return createErrorResponse('请求验证失败', '缺少目标 ID', 400, request);
		}

		const result = await deleteWebDAVSingleConfig(env, id);

		if (!result.success) {
			return createErrorResponse('删除配置失败', result.error, 404, request);
		}

		logger.info('WebDAV 配置已删除', { id });

		return createJsonResponse(
			{
				success: true,
				message: 'WebDAV 配置已删除',
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('删除 WebDAV 配置失败', { error: error.message }, error);
		return createErrorResponse('删除配置失败', error.message, 500, request);
	}
}

/**
 * 测试 WebDAV 连接
 * password 为空时从已保存的配置中读取（需提供 id）
 */
export async function handleTestWebDAV(request, env) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const body = await validateRequest(webdavConfigSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		// password 为空时从 KV 读取已保存的密码
		if (!body.password) {
			if (body.id) {
				const configs = await getWebDAVConfigs(env);
				const existing = configs.find((c) => c.id === body.id);
				if (existing && existing.password) {
					body.password = existing.password;
				} else {
					return createErrorResponse('请求验证失败', '密码不能为空（无已保存的配置）', 400, request);
				}
			} else {
				return createErrorResponse('请求验证失败', '密码不能为空', 400, request);
			}
		}

		logger.info('开始测试 WebDAV 连接', { url: body.url, path: body.path });
		const result = await testWebDAVConnection(body);

		if (result.success) {
			logger.info('WebDAV 连接测试成功', { method: result.method });
		} else {
			logger.warn('WebDAV 连接测试失败', { message: result.message });
		}

		return createJsonResponse(result, result.success ? 200 : 400, request);
	} catch (error) {
		logger.error('测试 WebDAV 连接失败', { error: error.message }, error);
		return createErrorResponse('测试连接失败', error.message, 500, request);
	}
}

/**
 * 启用/禁用 WebDAV 目标
 */
export async function handleToggleWebDAV(request, env) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			return createRateLimitResponse(rateLimitInfo, request);
		}

		const body = await validateRequest(toggleDestinationSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		const result = await saveWebDAVSingleConfig(env, { id: body.id, enabled: body.enabled });

		if (!result.success) {
			return createErrorResponse('操作失败', result.error, 404, request);
		}

		logger.info('WebDAV 目标状态已更新', { id: body.id, enabled: body.enabled });

		return createJsonResponse(
			{
				success: true,
				message: body.enabled ? '已启用' : '已禁用',
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('切换 WebDAV 目标状态失败', { error: error.message }, error);
		return createErrorResponse('操作失败', error.message, 500, request);
	}
}
