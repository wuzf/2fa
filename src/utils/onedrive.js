/**
 * OneDrive backup provider.
 * Uses Microsoft Graph app folder with OAuth authorization code flow.
 */

import { decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';
import { getBackupContentType } from './backup-format.js';
import {
	extractOAuthProviderError as extractProviderError,
	parseOAuthJsonResponse as parseJsonResponse,
	saveOAuthConfigsToKv as saveConfigsToKv,
} from './oauth.js';

const ONEDRIVE_CONFIGS_KEY = 'onedrive_configs';
const ONEDRIVE_STATUS_PREFIX = 'onedrive_status_';
const ONEDRIVE_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const ONEDRIVE_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const ONEDRIVE_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ONEDRIVE_SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite.AppFolder'];
const ONEDRIVE_TEST_FILE_NAME = '.2fa-onedrive-test.json';
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export function isOneDriveOAuthConfigured(env) {
	return !!(env.ONEDRIVE_CLIENT_ID && env.ONEDRIVE_CLIENT_SECRET);
}

export function getOneDriveDefaultFolderPath() {
	return '/2FA-Backups';
}

export function buildOneDriveAuthorizeUrl(env, { redirectUri, state }) {
	if (!isOneDriveOAuthConfigured(env)) {
		throw new Error('未配置 OneDrive OAuth 凭据');
	}

	const params = new URLSearchParams({
		client_id: env.ONEDRIVE_CLIENT_ID,
		response_type: 'code',
		redirect_uri: redirectUri,
		response_mode: 'query',
		scope: ONEDRIVE_SCOPES.join(' '),
		state,
	});

	return `${ONEDRIVE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeOneDriveCode(env, { code, redirectUri }) {
	return exchangeOneDriveToken(env, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
	});
}

export async function refreshOneDriveToken(env, refreshToken) {
	return exchangeOneDriveToken(env, {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	});
}

export async function fetchOneDriveProfile(accessToken) {
	const response = await fetch(`${ONEDRIVE_GRAPH_BASE}/me?$select=displayName,mail,userPrincipalName`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, '获取 OneDrive 账户信息失败'));
	}

	return {
		displayName: data.displayName || '',
		email: data.mail || data.userPrincipalName || '',
	};
}

export async function getOneDriveConfigs(env) {
	const logger = getLogger(env);

	try {
		const raw = await env.SECRETS_KV.get(ONEDRIVE_CONFIGS_KEY, 'text');
		if (!raw) {
			return [];
		}

		if (isEncrypted(raw)) {
			return await decryptData(raw, env);
		}

		return JSON.parse(raw);
	} catch (error) {
		logger.error('读取 OneDrive 配置失败', { error: error.message }, error);
		throw error;
	}
}

export async function saveOneDriveConfigs(env, configs) {
	return saveConfigsToKv(env, ONEDRIVE_CONFIGS_KEY, configs, 'OneDrive');
}

export async function saveOneDriveSingleConfig(env, config) {
	const configs = await getOneDriveConfigs(env);

	if (config.id) {
		const index = configs.findIndex((item) => item.id === config.id);
		if (index === -1) {
			return { success: false, error: '未找到指定的 OneDrive 目标' };
		}

		configs[index] = {
			...configs[index],
			...config,
			updatedAt: new Date().toISOString(),
		};
	} else {
		config.id = crypto.randomUUID();
		config.enabled = config.enabled !== undefined ? config.enabled : false;
		config.authorized = config.authorized !== undefined ? config.authorized : false;
		config.folderPath = config.folderPath || getOneDriveDefaultFolderPath();
		config.createdAt = new Date().toISOString();
		config.updatedAt = config.createdAt;
		configs.push(config);
	}

	const result = await saveConfigsToKv(env, ONEDRIVE_CONFIGS_KEY, configs, 'OneDrive');
	return { ...result, id: config.id };
}

export async function deleteOneDriveSingleConfig(env, id) {
	const configs = await getOneDriveConfigs(env);
	const index = configs.findIndex((item) => item.id === id);

	if (index === -1) {
		return { success: false, error: '未找到指定的 OneDrive 目标' };
	}

	configs.splice(index, 1);
	await saveConfigsToKv(env, ONEDRIVE_CONFIGS_KEY, configs, 'OneDrive');
	await env.SECRETS_KV.delete(`${ONEDRIVE_STATUS_PREFIX}${id}`).catch(() => {});
	return { success: true };
}

export async function getOneDriveStatus(env, id) {
	try {
		const status = await env.SECRETS_KV.get(`${ONEDRIVE_STATUS_PREFIX}${id}`, 'json');
		return status || {};
	} catch {
		return {};
	}
}

export async function pushToAllOneDrive(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		const configs = await getOneDriveConfigs(env);
		const enabledConfigs = configs.filter((config) => config.enabled);

		if (enabledConfigs.length === 0) {
			logger.debug('OneDrive 无已启用目标，跳过推送');
			return null;
		}

		logger.info('开始推送备份到所有 OneDrive 目标', {
			backupKey,
			totalTargets: enabledConfigs.length,
		});

		const results = await Promise.all(enabledConfigs.map((config) => pushToSingleOneDrive(backupKey, backupContent, config, env)));
		const successCount = results.filter((result) => result && result.success).length;
		const failCount = results.filter((result) => result && !result.success).length;

		logger.info('OneDrive 推送完成', {
			backupKey,
			successCount,
			failCount,
		});

		return { results, successCount, failCount };
	} catch (error) {
		logger.warn('OneDrive 推送过程异常', { backupKey, error: error.message });
		return null;
	}
}

export async function completeOneDriveAuthorization(env, { id, tokenData, profile }) {
	const configs = await getOneDriveConfigs(env);
	const existing = configs.find((config) => config.id === id);
	if (!existing) {
		throw new Error('未找到指定的 OneDrive 目标');
	}

	const refreshToken = tokenData.refreshToken || existing.refreshToken;
	if (!refreshToken) {
		throw new Error('OneDrive 未返回 refresh token，请删除旧授权后重试');
	}

	// First-time authorization → enable by default so the user doesn't need to
	// toggle the switch manually after authorizing (which was the most common
	// cause of "edits don't trigger OneDrive sync" reports). Re-authorization
	// preserves whatever the user had explicitly chosen.
	const isFirstAuthorization = !existing.authorized;
	const nextEnabled = isFirstAuthorization ? true : !!existing.enabled;

	const result = await saveOneDriveSingleConfig(env, {
		id,
		authorized: true,
		enabled: nextEnabled,
		refreshToken,
		accessToken: tokenData.accessToken,
		accessTokenExpiresAt: tokenData.accessTokenExpiresAt,
		accountDisplayName: profile.displayName || '',
		accountEmail: profile.email || '',
		authorizedAt: new Date().toISOString(),
	});

	if (!result.success) {
		throw new Error(result.error || '保存 OneDrive 授权信息失败');
	}

	return result;
}

export async function testOneDriveConnectionById(env, id) {
	const configs = await getOneDriveConfigs(env);
	const config = configs.find((item) => item.id === id);
	if (!config) {
		throw new Error('未找到指定的 OneDrive 目标');
	}

	if (!config.authorized || !config.refreshToken) {
		throw new Error('OneDrive 目标尚未授权，请重新授权');
	}

	const testContent = JSON.stringify({
		test: true,
		provider: 'onedrive',
		timestamp: new Date().toISOString(),
		message: '2FA Manager OneDrive 连接测试文件，可安全删除。',
	});

	const result = await uploadOneDriveFile(ONEDRIVE_TEST_FILE_NAME, testContent, config, env, {
		recordSuccessStatus: false,
	});
	if (result.success) {
		await saveOneDriveSingleConfig(env, {
			id,
			lastValidatedAt: new Date().toISOString(),
		});
		return {
			success: true,
			message: config.enabled
				? 'OneDrive 授权成功，已完成自动连接测试，当前目标保持启用，后续备份会自动推送。'
				: 'OneDrive 授权成功，已完成自动连接测试。当前目标仍为关闭状态，你可以按需手动启用同步。',
		};
	}

	await saveOneDriveSingleConfig(env, { id, enabled: false });
	return {
		success: false,
		message: `OneDrive 授权已保存，但自动连接测试失败：${result.error}`,
	};
}

async function pushToSingleOneDrive(backupKey, backupContent, config, env) {
	const logger = getLogger(env);

	const result = await uploadOneDriveFile(backupKey, backupContent, config, env);
	if (!result.success) {
		logger.warn('OneDrive 推送失败', { backupKey, targetName: config.name, error: result.error });
	}
	return result;
}

async function uploadOneDriveFile(fileName, fileContent, config, env, options = {}) {
	const { recordSuccessStatus = true } = options;

	try {
		if (!config.authorized || !config.refreshToken) {
			throw new Error('OneDrive 目标尚未授权，请重新授权');
		}

		const { accessToken } = await ensureOneDriveAccessToken(env, config);
		const folder = await ensureOneDriveFolder(env, accessToken, config.folderPath || getOneDriveDefaultFolderPath());
		const uploadUrl = `${ONEDRIVE_GRAPH_BASE}/me/drive/items/${folder.id}:/${encodeURIComponent(fileName)}:/content`;

		const response = await fetch(uploadUrl, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': getBackupContentType(fileName, { encrypted: fileContent.startsWith('v1:') }),
			},
			body: fileContent,
		});

		if (!response.ok) {
			const data = await parseJsonResponse(response);
			throw new Error(extractProviderError(data, `OneDrive 上传失败 (${response.status})`));
		}

		if (recordSuccessStatus) {
			await recordOneDriveStatus(env, config.id, {
				lastSuccess: {
					backupKey: fileName,
					timestamp: new Date().toISOString(),
				},
				lastError: null,
			});
		}

		return {
			success: true,
			id: config.id,
			name: config.name,
			backupKey: fileName,
		};
	} catch (error) {
		await recordOneDriveStatusError(env, config.id, fileName, error.message).catch(() => {});
		return {
			success: false,
			id: config.id,
			name: config.name,
			backupKey: fileName,
			error: error.message,
		};
	}
}

async function ensureOneDriveAccessToken(env, config) {
	const expiresAt = Date.parse(config.accessTokenExpiresAt || '');
	if (config.accessToken && Number.isFinite(expiresAt) && expiresAt - Date.now() > ACCESS_TOKEN_REFRESH_BUFFER_MS) {
		return {
			accessToken: config.accessToken,
			refreshToken: config.refreshToken,
			accessTokenExpiresAt: config.accessTokenExpiresAt,
		};
	}

	if (!config.refreshToken) {
		throw new Error('OneDrive refresh token 不存在，请重新授权');
	}

	const refreshed = await refreshOneDriveToken(env, config.refreshToken);
	await saveOneDriveSingleConfig(env, {
		id: config.id,
		authorized: true,
		accessToken: refreshed.accessToken,
		accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
		refreshToken: refreshed.refreshToken || config.refreshToken,
	});

	return {
		accessToken: refreshed.accessToken,
		refreshToken: refreshed.refreshToken || config.refreshToken,
		accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
	};
}

async function ensureOneDriveFolder(env, accessToken, folderPath) {
	const appRootResponse = await fetch(`${ONEDRIVE_GRAPH_BASE}/me/drive/special/approot`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const appRootData = await parseJsonResponse(appRootResponse);
	if (!appRootResponse.ok) {
		throw new Error(extractProviderError(appRootData, '获取 OneDrive 应用目录失败'));
	}

	let parentId = appRootData.id;
	const segments = getPathSegments(folderPath);

	for (const segment of segments) {
		const existing = await findOneDriveChildFolder(accessToken, parentId, segment);
		if (existing) {
			parentId = existing.id;
			continue;
		}

		const createResponse = await fetch(`${ONEDRIVE_GRAPH_BASE}/me/drive/items/${parentId}/children`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: segment,
				folder: {},
			}),
		});

		const createData = await parseJsonResponse(createResponse);
		if (!createResponse.ok) {
			if (createResponse.status === 409) {
				const conflicted = await findOneDriveChildFolder(accessToken, parentId, segment);
				if (conflicted) {
					parentId = conflicted.id;
					continue;
				}
			}
			throw new Error(extractProviderError(createData, `创建 OneDrive 目录失败: ${segment}`));
		}

		parentId = createData.id;
	}

	return { id: parentId };
}

async function findOneDriveChildFolder(accessToken, parentId, folderName) {
	const response = await fetch(`${ONEDRIVE_GRAPH_BASE}/me/drive/items/${parentId}/children?$select=id,name,folder`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, `读取 OneDrive 目录失败: ${folderName}`));
	}

	return (data.value || []).find((item) => item.folder && item.name === folderName) || null;
}

async function exchangeOneDriveToken(env, params) {
	if (!isOneDriveOAuthConfigured(env)) {
		throw new Error('未配置 OneDrive OAuth 凭据');
	}

	const body = new URLSearchParams({
		client_id: env.ONEDRIVE_CLIENT_ID,
		client_secret: env.ONEDRIVE_CLIENT_SECRET,
		scope: ONEDRIVE_SCOPES.join(' '),
		...params,
	});

	const response = await fetch(ONEDRIVE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
	});

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, 'OneDrive token 交换失败'));
	}

	return normalizeOneDriveTokenData(data);
}

function normalizeOneDriveTokenData(data) {
	const expiresIn = Number(data.expires_in || 0);
	const expiresAt = new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString();

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token || '',
		accessTokenExpiresAt: expiresAt,
	};
}

async function recordOneDriveStatus(env, id, statusUpdate) {
	try {
		const existing = await getOneDriveStatus(env, id);
		const merged = { ...existing, ...statusUpdate };
		await env.SECRETS_KV.put(`${ONEDRIVE_STATUS_PREFIX}${id}`, JSON.stringify(merged));
	} catch {
		// ignore status persistence failures
	}
}

async function recordOneDriveStatusError(env, id, backupKey, errorMessage) {
	await recordOneDriveStatus(env, id, {
		lastError: {
			backupKey,
			error: errorMessage,
			timestamp: new Date().toISOString(),
		},
	});
}

function getPathSegments(path) {
	return String(path || getOneDriveDefaultFolderPath())
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
}

// Backward-compatible helper for manual backup path.
export async function pushToOneDrive(backupKey, backupContent, env) {
	return pushToAllOneDrive(backupKey, backupContent, env);
}
