/**
 * Google Drive backup provider.
 * Uses Google OAuth web server flow and Drive v3 file uploads.
 */

import { decryptData, isEncrypted } from './encryption.js';
import { getLogger } from './logger.js';
import { getBackupContentType } from './backup-format.js';
import {
	extractOAuthProviderError,
	parseOAuthJsonResponse as parseJsonResponse,
	saveOAuthConfigsToKv as saveConfigsToKv,
} from './oauth.js';

const GDRIVE_CONFIGS_KEY = 'gdrive_configs';
const GDRIVE_STATUS_PREFIX = 'gdrive_status_';
const GDRIVE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GDRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GDRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GDRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDRIVE_TEST_FILE_NAME = '.2fa-google-drive-test.json';
const GDRIVE_SCOPES = [
	'https://www.googleapis.com/auth/drive.file',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/userinfo.profile',
];
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export function isGoogleDriveOAuthConfigured(env) {
	return !!(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET);
}

export function getGoogleDriveDefaultFolderPath() {
	return '/2FA-Backups';
}

export function buildGoogleDriveAuthorizeUrl(env, { redirectUri, state }) {
	if (!isGoogleDriveOAuthConfigured(env)) {
		throw new Error('未配置 Google Drive OAuth 凭据');
	}

	const params = new URLSearchParams({
		client_id: env.GOOGLE_DRIVE_CLIENT_ID,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: GDRIVE_SCOPES.join(' '),
		access_type: 'offline',
		prompt: 'consent',
		include_granted_scopes: 'true',
		state,
	});

	return `${GDRIVE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGoogleDriveCode(env, { code, redirectUri }) {
	return exchangeGoogleDriveToken(env, {
		code,
		redirect_uri: redirectUri,
		grant_type: 'authorization_code',
	});
}

export async function refreshGoogleDriveToken(env, refreshToken) {
	return exchangeGoogleDriveToken(env, {
		refresh_token: refreshToken,
		grant_type: 'refresh_token',
	});
}

export async function fetchGoogleDriveProfile(accessToken) {
	const response = await fetch(GOOGLE_USERINFO_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, '获取 Google 账户信息失败'));
	}

	return {
		displayName: data.name || '',
		email: data.email || '',
	};
}

export async function getGoogleDriveConfigs(env) {
	const logger = getLogger(env);

	try {
		const raw = await env.SECRETS_KV.get(GDRIVE_CONFIGS_KEY, 'text');
		if (!raw) {
			return [];
		}

		if (isEncrypted(raw)) {
			return await decryptData(raw, env);
		}

		return JSON.parse(raw);
	} catch (error) {
		logger.error('读取 Google Drive 配置失败', { error: error.message }, error);
		throw error;
	}
}

export async function saveGoogleDriveConfigs(env, configs) {
	return saveConfigsToKv(env, GDRIVE_CONFIGS_KEY, configs, 'Google Drive');
}

export async function saveGoogleDriveSingleConfig(env, config) {
	const configs = await getGoogleDriveConfigs(env);

	if (config.id) {
		const index = configs.findIndex((item) => item.id === config.id);
		if (index === -1) {
			return { success: false, error: '未找到指定的 Google Drive 目标' };
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
		config.folderPath = config.folderPath || getGoogleDriveDefaultFolderPath();
		config.createdAt = new Date().toISOString();
		config.updatedAt = config.createdAt;
		configs.push(config);
	}

	const result = await saveConfigsToKv(env, GDRIVE_CONFIGS_KEY, configs, 'Google Drive');
	return { ...result, id: config.id };
}

export async function deleteGoogleDriveSingleConfig(env, id) {
	const configs = await getGoogleDriveConfigs(env);
	const index = configs.findIndex((item) => item.id === id);

	if (index === -1) {
		return { success: false, error: '未找到指定的 Google Drive 目标' };
	}

	configs.splice(index, 1);
	await saveConfigsToKv(env, GDRIVE_CONFIGS_KEY, configs, 'Google Drive');
	await env.SECRETS_KV.delete(`${GDRIVE_STATUS_PREFIX}${id}`).catch(() => {});
	return { success: true };
}

export async function getGoogleDriveStatus(env, id) {
	try {
		const status = await env.SECRETS_KV.get(`${GDRIVE_STATUS_PREFIX}${id}`, 'json');
		return status || {};
	} catch {
		return {};
	}
}

export async function pushToAllGoogleDrive(backupKey, backupContent, env) {
	const logger = getLogger(env);

	try {
		const configs = await getGoogleDriveConfigs(env);
		const enabledConfigs = configs.filter((config) => config.enabled);

		if (enabledConfigs.length === 0) {
			logger.debug('Google Drive 无已启用目标，跳过推送');
			return null;
		}

		logger.info('开始推送备份到所有 Google Drive 目标', {
			backupKey,
			totalTargets: enabledConfigs.length,
		});

		const results = await Promise.all(enabledConfigs.map((config) => pushToSingleGoogleDrive(backupKey, backupContent, config, env)));
		const successCount = results.filter((result) => result && result.success).length;
		const failCount = results.filter((result) => result && !result.success).length;

		logger.info('Google Drive 推送完成', {
			backupKey,
			successCount,
			failCount,
		});

		return { results, successCount, failCount };
	} catch (error) {
		logger.warn('Google Drive 推送过程异常', { backupKey, error: error.message });
		return null;
	}
}

export async function completeGoogleDriveAuthorization(env, { id, tokenData, profile }) {
	const configs = await getGoogleDriveConfigs(env);
	const existing = configs.find((config) => config.id === id);
	if (!existing) {
		throw new Error('未找到指定的 Google Drive 目标');
	}

	const refreshToken = tokenData.refreshToken || existing.refreshToken;
	if (!refreshToken) {
		throw new Error('Google Drive 未返回 refresh token，请删除旧授权后重试');
	}

	// First-time authorization → enable by default so the user doesn't need to
	// toggle the switch manually after authorizing (which was the most common
	// cause of "edits don't trigger Google Drive sync" reports). Re-authorization
	// preserves whatever the user had explicitly chosen.
	const isFirstAuthorization = !existing.authorized;
	const nextEnabled = isFirstAuthorization ? true : !!existing.enabled;

	const result = await saveGoogleDriveSingleConfig(env, {
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
		throw new Error(result.error || '保存 Google Drive 授权信息失败');
	}

	return result;
}

export async function testGoogleDriveConnectionById(env, id) {
	const configs = await getGoogleDriveConfigs(env);
	const config = configs.find((item) => item.id === id);
	if (!config) {
		throw new Error('未找到指定的 Google Drive 目标');
	}

	if (!config.authorized || !config.refreshToken) {
		throw new Error('Google Drive 目标尚未授权，请重新授权');
	}

	const testContent = JSON.stringify({
		test: true,
		provider: 'gdrive',
		timestamp: new Date().toISOString(),
		message: '2FA Manager Google Drive 连接测试文件，可安全删除。',
	});

	const result = await uploadGoogleDriveFile(GDRIVE_TEST_FILE_NAME, testContent, config, env, {
		recordSuccessStatus: false,
	});
	if (result.success) {
		await saveGoogleDriveSingleConfig(env, {
			id,
			lastValidatedAt: new Date().toISOString(),
		});
		return {
			success: true,
			message: config.enabled
				? 'Google Drive 授权成功，已完成自动连接测试，当前目标保持启用，后续备份会自动推送。'
				: 'Google Drive 授权成功，已完成自动连接测试。当前目标仍为关闭状态，你可以按需手动启用同步。',
		};
	}

	await saveGoogleDriveSingleConfig(env, { id, enabled: false });
	return {
		success: false,
		message: `Google Drive 授权已保存，但自动连接测试失败：${result.error}`,
	};
}

async function pushToSingleGoogleDrive(backupKey, backupContent, config, env) {
	const logger = getLogger(env);

	const result = await uploadGoogleDriveFile(backupKey, backupContent, config, env);
	if (!result.success) {
		logger.warn('Google Drive 推送失败', { backupKey, targetName: config.name, error: result.error });
	}
	return result;
}

async function uploadGoogleDriveFile(fileName, fileContent, config, env, options = {}) {
	const { recordSuccessStatus = true } = options;

	try {
		if (!config.authorized || !config.refreshToken) {
			throw new Error('Google Drive 目标尚未授权，请重新授权');
		}

		const { accessToken } = await ensureGoogleDriveAccessToken(env, config);
		const folderId = await ensureGoogleDriveFolder(accessToken, config.folderPath || getGoogleDriveDefaultFolderPath());
		const existingFile = await findGoogleDriveFile(accessToken, folderId, fileName);

		if (existingFile) {
			const updateResponse = await fetch(
				`${GDRIVE_UPLOAD_URL}/${existingFile.id}?${new URLSearchParams({ uploadType: 'media', fields: 'id,name' }).toString()}`,
				{
					method: 'PATCH',
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': getBackupContentType(fileName, { encrypted: fileContent.startsWith('v1:') }),
					},
					body: fileContent,
				},
			);

			const updateData = await parseJsonResponse(updateResponse);
			if (!updateResponse.ok) {
				throw new Error(extractProviderError(updateData, `Google Drive 更新文件失败 (${updateResponse.status})`));
			}
		} else {
			const boundary = `2fa-${crypto.randomUUID()}`;
			const metadata = JSON.stringify({
				name: fileName,
				mimeType: getBackupContentType(fileName, { encrypted: fileContent.startsWith('v1:') }).split(';')[0],
				parents: [folderId],
			});
			const multipartBody =
				`--${boundary}\r\n` +
				'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
				`${metadata}\r\n` +
				`--${boundary}\r\n` +
				`Content-Type: ${getBackupContentType(fileName, { encrypted: fileContent.startsWith('v1:') })}\r\n\r\n` +
				`${fileContent}\r\n` +
				`--${boundary}--`;

			const createResponse = await fetch(
				`${GDRIVE_UPLOAD_URL}?${new URLSearchParams({ uploadType: 'multipart', fields: 'id,name' }).toString()}`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': `multipart/related; boundary=${boundary}`,
					},
					body: multipartBody,
				},
			);

			const createData = await parseJsonResponse(createResponse);
			if (!createResponse.ok) {
				throw new Error(extractProviderError(createData, `Google Drive 上传失败 (${createResponse.status})`));
			}
		}

		if (recordSuccessStatus) {
			await recordGoogleDriveStatus(env, config.id, {
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
		await recordGoogleDriveStatusError(env, config.id, fileName, error.message).catch(() => {});
		return {
			success: false,
			id: config.id,
			name: config.name,
			backupKey: fileName,
			error: error.message,
		};
	}
}

async function ensureGoogleDriveAccessToken(env, config) {
	const expiresAt = Date.parse(config.accessTokenExpiresAt || '');
	if (config.accessToken && Number.isFinite(expiresAt) && expiresAt - Date.now() > ACCESS_TOKEN_REFRESH_BUFFER_MS) {
		return {
			accessToken: config.accessToken,
			refreshToken: config.refreshToken,
			accessTokenExpiresAt: config.accessTokenExpiresAt,
		};
	}

	if (!config.refreshToken) {
		throw new Error('Google Drive refresh token 不存在，请重新授权');
	}

	const refreshed = await refreshGoogleDriveToken(env, config.refreshToken);
	await saveGoogleDriveSingleConfig(env, {
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

async function ensureGoogleDriveFolder(accessToken, folderPath) {
	let parentId = 'root';
	const segments = getPathSegments(folderPath);

	for (const segment of segments) {
		const existing = await findGoogleDriveFolder(accessToken, parentId, segment);
		if (existing) {
			parentId = existing.id;
			continue;
		}

		const createResponse = await fetch(`${GDRIVE_FILES_URL}?${new URLSearchParams({ fields: 'id,name' }).toString()}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: segment,
				mimeType: GOOGLE_DRIVE_FOLDER_MIME,
				parents: [parentId],
			}),
		});

		const createData = await parseJsonResponse(createResponse);
		if (!createResponse.ok) {
			throw new Error(extractProviderError(createData, `创建 Google Drive 目录失败: ${segment}`));
		}

		parentId = createData.id;
	}

	return parentId;
}

async function findGoogleDriveFolder(accessToken, parentId, folderName) {
	const q = `name = '${escapeDriveQueryValue(folderName)}' and mimeType = '${GOOGLE_DRIVE_FOLDER_MIME}' and '${escapeDriveQueryValue(parentId)}' in parents and trashed = false`;
	const response = await fetch(
		`${GDRIVE_FILES_URL}?${new URLSearchParams({
			q,
			fields: 'files(id,name)',
			pageSize: '1',
		}).toString()}`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		},
	);

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, `读取 Google Drive 目录失败: ${folderName}`));
	}

	return (data.files || [])[0] || null;
}

async function findGoogleDriveFile(accessToken, parentId, fileName) {
	const q = `name = '${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(parentId)}' in parents and trashed = false`;
	const response = await fetch(
		`${GDRIVE_FILES_URL}?${new URLSearchParams({
			q,
			fields: 'files(id,name)',
			pageSize: '1',
		}).toString()}`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		},
	);

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, `查找 Google Drive 文件失败: ${fileName}`));
	}

	return (data.files || [])[0] || null;
}

async function exchangeGoogleDriveToken(env, params) {
	if (!isGoogleDriveOAuthConfigured(env)) {
		throw new Error('未配置 Google Drive OAuth 凭据');
	}

	const body = new URLSearchParams({
		client_id: env.GOOGLE_DRIVE_CLIENT_ID,
		client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
		...params,
	});

	const response = await fetch(GDRIVE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
	});

	const data = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(extractProviderError(data, 'Google Drive token 交换失败'));
	}

	return normalizeGoogleTokenData(data);
}

function normalizeGoogleTokenData(data) {
	const expiresIn = Number(data.expires_in || 0);
	const expiresAt = new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000).toISOString();

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token || '',
		accessTokenExpiresAt: expiresAt,
	};
}

async function recordGoogleDriveStatus(env, id, statusUpdate) {
	try {
		const existing = await getGoogleDriveStatus(env, id);
		const merged = { ...existing, ...statusUpdate };
		await env.SECRETS_KV.put(`${GDRIVE_STATUS_PREFIX}${id}`, JSON.stringify(merged));
	} catch {
		// ignore status persistence failures
	}
}

async function recordGoogleDriveStatusError(env, id, backupKey, errorMessage) {
	await recordGoogleDriveStatus(env, id, {
		lastError: {
			backupKey,
			error: errorMessage,
			timestamp: new Date().toISOString(),
		},
	});
}

function extractProviderError(data, fallbackMessage) {
	return extractOAuthProviderError(data, fallbackMessage, translateGoogleDriveError);
}

function translateGoogleDriveError(data) {
	const errorObject = typeof data.error === 'object' && data.error ? data.error : null;
	const message = String(errorObject?.message || data.message || '');
	const status = String(errorObject?.status || data.status || '').toUpperCase();
	const errorList = Array.isArray(errorObject?.errors) ? errorObject.errors : [];
	const details = Array.isArray(errorObject?.details) ? errorObject.details : [];
	const reasons = [
		...errorList.map((item) => String(item?.reason || '').toUpperCase()),
		...details.map((item) => String(item?.reason || item?.metadata?.reason || '').toUpperCase()),
	];

	if (
		/insufficient authentication scopes/i.test(message) ||
		/insufficient permission/i.test(message) ||
		reasons.includes('INSUFFICIENTPERMISSIONS') ||
		reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
	) {
		return 'Google Drive 已授权，但当前授权不包含网盘写入权限。请在 Google Cloud 控制台的数据访问中添加 drive.file 权限范围，然后到 Google 账号权限页面删除旧授权，最后回到本应用重新授权。';
	}

	if (/access not configured/i.test(message) || /api has not been used/i.test(message) || reasons.includes('ACCESSNOTCONFIGURED')) {
		return 'Google Drive API 尚未启用。请到 Google Cloud Console 中启用 Google Drive API 后再重试。';
	}

	if (/invalid_grant/i.test(message) || /token has been expired or revoked/i.test(message)) {
		return 'Google Drive 授权已失效或已被撤销，请重新授权。';
	}

	if (status === 'PERMISSION_DENIED' && /drive/i.test(message)) {
		return 'Google Drive 拒绝了当前操作。请检查当前账号是否有目标目录权限，并确认授权未失效。';
	}

	return null;
}

function getPathSegments(path) {
	return String(path || getGoogleDriveDefaultFolderPath())
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function escapeDriveQueryValue(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Backward-compatible helper for manual backup path.
export async function pushToGoogleDrive(backupKey, backupContent, env) {
	return pushToAllGoogleDrive(backupKey, backupContent, env);
}
