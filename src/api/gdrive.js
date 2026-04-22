/**
 * Google Drive configuration and OAuth API endpoints.
 */

import {
	buildGoogleDriveAuthorizeUrl,
	completeGoogleDriveAuthorization,
	exchangeGoogleDriveCode,
	fetchGoogleDriveProfile,
	getGoogleDriveConfigs,
	getGoogleDriveStatus,
	isGoogleDriveOAuthConfigured,
	saveGoogleDriveSingleConfig,
	testGoogleDriveConnectionById,
	deleteGoogleDriveSingleConfig,
} from '../utils/gdrive.js';
import {
	createOAuthPopupResponse,
	createOAuthState,
	consumeOAuthState,
	extractOAuthStatePreview,
	getOAuthRedirectBase,
} from '../utils/oauth.js';
import { getLogger } from '../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../utils/rateLimit.js';
import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { validateRequest, cloudDriveConfigSchema, destinationIdSchema, toggleDestinationSchema } from '../utils/validation.js';

const MAX_ALLOWED = 5;

export async function handleGetGoogleDriveConfigs(request, env) {
	const logger = getLogger(env);

	try {
		const configs = await getGoogleDriveConfigs(env);
		const destinations = await Promise.all(
			configs.map(async (config) => {
				const status = await getGoogleDriveStatus(env, config.id);
				return {
					id: config.id,
					name: config.name,
					enabled: config.enabled,
					authorized: !!config.authorized,
					config: {
						folderPath: config.folderPath || '/2FA-Backups',
					},
					account: {
						displayName: config.accountDisplayName || '',
						email: config.accountEmail || '',
					},
					status: {
						lastSuccess: status.lastSuccess || null,
						lastError: status.lastError || null,
					},
					createdAt: config.createdAt,
				};
			}),
		);

		return createJsonResponse(
			{
				destinations,
				count: destinations.length,
				maxAllowed: MAX_ALLOWED,
				oauthConfigured: isGoogleDriveOAuthConfigured(env),
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('获取 Google Drive 配置失败', { error: error.message }, error);
		return createErrorResponse('获取配置失败', error.message, 500, request);
	}
}

export async function handleSaveGoogleDriveConfig(request, env) {
	const logger = getLogger(env);

	try {
		const rateLimitResponse = await checkSensitiveRateLimit(request, env);
		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const body = await validateRequest(cloudDriveConfigSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		if (!body.id) {
			const existing = await getGoogleDriveConfigs(env);
			if (existing.length >= MAX_ALLOWED) {
				return createErrorResponse('保存配置失败', `最多只允许配置 ${MAX_ALLOWED} 个 Google Drive 目标`, 400, request);
			}
		}

		const result = await saveGoogleDriveSingleConfig(env, body);
		if (!result.success) {
			return createErrorResponse('保存配置失败', result.error, 400, request);
		}

		return createJsonResponse(
			{
				success: true,
				message: 'Google Drive 配置已保存',
				id: result.id,
				encrypted: result.encrypted,
				warning: result.warning,
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('保存 Google Drive 配置失败', { error: error.message }, error);
		return createErrorResponse('保存配置失败', error.message, 500, request);
	}
}

export async function handleDeleteGoogleDriveConfig(request, env) {
	const logger = getLogger(env);

	try {
		const rateLimitResponse = await checkSensitiveRateLimit(request, env);
		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const url = new URL(request.url);
		const id = url.searchParams.get('id');
		if (!id) {
			return createErrorResponse('请求验证失败', '缺少目标 ID', 400, request);
		}

		const result = await deleteGoogleDriveSingleConfig(env, id);
		if (!result.success) {
			return createErrorResponse('删除配置失败', result.error, 404, request);
		}

		return createJsonResponse(
			{
				success: true,
				message: 'Google Drive 配置已删除',
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('删除 Google Drive 配置失败', { error: error.message }, error);
		return createErrorResponse('删除配置失败', error.message, 500, request);
	}
}

export async function handleToggleGoogleDrive(request, env) {
	const logger = getLogger(env);

	try {
		const rateLimitResponse = await checkSensitiveRateLimit(request, env);
		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const body = await validateRequest(toggleDestinationSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		const configs = await getGoogleDriveConfigs(env);
		const existing = configs.find((config) => config.id === body.id);
		if (!existing) {
			return createErrorResponse('操作失败', '未找到指定的 Google Drive 目标', 404, request);
		}

		if (body.enabled && !existing.authorized) {
			return createErrorResponse('操作失败', '请先完成 Google Drive 授权再启用同步', 400, request);
		}

		const result = await saveGoogleDriveSingleConfig(env, { id: body.id, enabled: body.enabled });
		if (!result.success) {
			return createErrorResponse('操作失败', result.error, 404, request);
		}

		return createJsonResponse(
			{
				success: true,
				message: body.enabled ? '已启用' : '已禁用',
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('切换 Google Drive 状态失败', { error: error.message }, error);
		return createErrorResponse('操作失败', error.message, 500, request);
	}
}

export async function handleStartGoogleDriveOAuth(request, env) {
	const logger = getLogger(env);

	try {
		const rateLimitResponse = await checkSensitiveRateLimit(request, env);
		if (rateLimitResponse) {
			return rateLimitResponse;
		}

		const body = await validateRequest(destinationIdSchema)(request);
		if (body instanceof Response) {
			return body;
		}

		if (!isGoogleDriveOAuthConfigured(env)) {
			return createErrorResponse('授权启动失败', '服务端未配置 Google Drive OAuth 凭据', 500, request);
		}

		const configs = await getGoogleDriveConfigs(env);
		const existing = configs.find((config) => config.id === body.id);
		if (!existing) {
			return createErrorResponse('授权启动失败', '未找到指定的 Google Drive 目标', 404, request);
		}

		const redirectUri = `${getOAuthRedirectBase(request, env)}/api/gdrive/oauth/callback`;
		const callbackOrigin = new URL(redirectUri).origin;
		const state = await createOAuthState(env, {
			provider: 'gdrive',
			configId: body.id,
			appOrigin: new URL(request.url).origin,
		});
		const authorizeUrl = buildGoogleDriveAuthorizeUrl(env, { redirectUri, state });

		return createJsonResponse(
			{
				success: true,
				authorizeUrl,
				callbackOrigin,
			},
			200,
			request,
		);
	} catch (error) {
		logger.error('启动 Google Drive OAuth 失败', { error: error.message }, error);
		return createErrorResponse('授权启动失败', error.message, 500, request);
	}
}

export async function handleGoogleDriveOAuthCallback(request, env) {
	const logger = getLogger(env);
	const url = new URL(request.url);
	const state = url.searchParams.get('state');
	const statePreview = await extractOAuthStatePreview(env, state, 'gdrive');
	let oauthState = null;
	let configId = statePreview?.configId || null;

	try {
		oauthState = await consumeOAuthState(env, state, 'gdrive');
		configId = oauthState.configId;
		const errorCode = url.searchParams.get('error');
		const errorDescription = url.searchParams.get('error_description');

		if (errorCode) {
			return createOAuthPopupResponse(request, {
				success: false,
				provider: 'gdrive',
				id: configId,
				appOrigin: oauthState.appOrigin,
				message: errorDescription || errorCode,
			});
		}

		const code = url.searchParams.get('code');
		if (!code) {
			throw new Error('缺少 Google Drive 授权 code');
		}

		const configs = await getGoogleDriveConfigs(env);
		const existing = configs.find((config) => config.id === configId);
		if (!existing) {
			throw new Error('对应的 Google Drive 目标不存在');
		}

		const redirectUri = `${getOAuthRedirectBase(request, env)}/api/gdrive/oauth/callback`;
		const tokenData = await exchangeGoogleDriveCode(env, { code, redirectUri });
		const profile = await fetchGoogleDriveProfile(tokenData.accessToken);
		const result = await completeGoogleDriveAuthorization(env, { id: configId, tokenData, profile });
		const testResult = await testGoogleDriveConnectionById(env, configId);

		if (!testResult.success) {
			return createOAuthPopupResponse(request, {
				success: true,
				severity: 'warning',
				provider: 'gdrive',
				id: configId,
				appOrigin: oauthState.appOrigin,
				message: result.warning ? `${testResult.message} ${result.warning}` : testResult.message,
			});
		}

		return createOAuthPopupResponse(request, {
			success: true,
			severity: 'success',
			provider: 'gdrive',
			id: configId,
			appOrigin: oauthState.appOrigin,
			message: result.warning ? `${testResult.message} ${result.warning}` : testResult.message,
		});
	} catch (error) {
		logger.error('处理 Google Drive OAuth 回调失败', { error: error.message }, error);
		return createOAuthPopupResponse(request, {
			success: false,
			provider: 'gdrive',
			id: configId || undefined,
			appOrigin: oauthState?.appOrigin || statePreview?.appOrigin,
			message: error.message || 'Google Drive 授权失败',
		});
	}
}

async function checkSensitiveRateLimit(request, env) {
	const clientIP = getClientIdentifier(request, 'ip');
	const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);
	if (!rateLimitInfo.allowed) {
		return createRateLimitResponse(rateLimitInfo, request);
	}
	return null;
}
