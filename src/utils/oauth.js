/**
 * OAuth utilities for cloud backup providers.
 * Handles one-time state storage/validation, provider persistence helpers, and popup callback responses.
 */

import { encryptData } from './encryption.js';
import { createHtmlResponse } from './response.js';

const OAUTH_STATE_PREFIX = 'oauth_state_';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_VERSION = 'v1';

/**
 * Create and persist a one-time OAuth state token.
 * @param {Object} env - Cloudflare Workers environment
 * @param {Object} payload - State payload to persist
 * @returns {Promise<string>} generated state token
 */
export async function createOAuthState(env, payload) {
	const createdAt = new Date().toISOString();
	const record = {
		...payload,
		createdAt,
	};
	const previewPayload = createOAuthStatePreviewPayload(payload, createdAt);
	const encodedPreview = encodeOAuthStatePreview(previewPayload);
	const signature = await signOAuthStatePreview(env, encodedPreview);
	const stateId = `${crypto.randomUUID()}-${Math.random().toString(36).slice(2, 10)}`;
	const state = `${OAUTH_STATE_VERSION}.${stateId}.${encodedPreview}.${signature}`;

	await env.SECRETS_KV.put(`${OAUTH_STATE_PREFIX}${state}`, JSON.stringify(record), {
		expirationTtl: OAUTH_STATE_TTL_SECONDS,
	});

	return state;
}

/**
 * Validate and consume a one-time OAuth state token.
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} state - state token from callback
 * @param {string} expectedProvider - expected provider id
 * @returns {Promise<Object>} persisted state payload
 */
export async function consumeOAuthState(env, state, expectedProvider) {
	if (!state || typeof state !== 'string') {
		throw new Error('缺少 OAuth state 参数');
	}

	const key = `${OAUTH_STATE_PREFIX}${state}`;
	const raw = await env.SECRETS_KV.get(key, 'text');
	await env.SECRETS_KV.delete(key).catch(() => {});

	if (!raw) {
		throw new Error('OAuth state 无效或已过期');
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('OAuth state 数据损坏');
	}

	if (parsed.provider !== expectedProvider) {
		throw new Error('OAuth state 与目标 provider 不匹配');
	}

	const createdAt = Date.parse(parsed.createdAt || '');
	if (!Number.isFinite(createdAt)) {
		throw new Error('OAuth state 缺少创建时间');
	}

	if (Date.now() - createdAt > OAUTH_STATE_TTL_SECONDS * 1000) {
		throw new Error('OAuth state 已过期，请重新授权');
	}

	return parsed;
}

/**
 * Recover the signed state preview without consuming the KV record.
 * Used as a safe fallback to return OAuth failures back to the originating app domain.
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} state - state token from callback
 * @param {string} expectedProvider - expected provider id
 * @returns {Promise<Object|null>} signed preview payload or null when unavailable
 */
export async function extractOAuthStatePreview(env, state, expectedProvider) {
	if (!state || typeof state !== 'string') {
		return null;
	}

	const parsedState = parseOAuthStateToken(state);
	if (!parsedState) {
		return null;
	}

	const signature = await signOAuthStatePreview(env, parsedState.encodedPreview).catch(() => null);
	if (!signature || signature !== parsedState.signature) {
		return null;
	}

	let preview;
	try {
		preview = JSON.parse(decodeOAuthStatePreview(parsedState.encodedPreview));
	} catch {
		return null;
	}

	if (!preview || preview.provider !== expectedProvider) {
		return null;
	}

	return {
		...preview,
		appOrigin: normalizeOrigin(preview.appOrigin),
	};
}

/**
 * Resolve the external origin used in OAuth redirect URIs.
 * @param {Request} request - HTTP request
 * @param {Object} env - Cloudflare Workers environment
 * @returns {string} origin without trailing slash
 */
export function getOAuthRedirectBase(request, env) {
	const explicitBase = typeof env.OAUTH_REDIRECT_BASE_URL === 'string' ? env.OAUTH_REDIRECT_BASE_URL.trim() : '';
	if (explicitBase) {
		return explicitBase.replace(/\/+$/, '');
	}

	return new URL(request.url).origin.replace(/\/+$/, '');
}

/**
 * Persist OAuth provider configs to KV, encrypting them when an encryption key is configured.
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} key - KV key
 * @param {Array|Object} configs - config payload
 * @param {string} providerName - provider display name
 * @returns {Promise<{success: boolean, encrypted: boolean, warning: string | null}>}
 */
export async function saveOAuthConfigsToKv(env, key, configs, providerName) {
	let encrypted = false;
	let warning = null;

	if (env.ENCRYPTION_KEY) {
		const encryptedData = await encryptData(configs, env);
		await env.SECRETS_KV.put(key, encryptedData);
		encrypted = true;
	} else {
		await env.SECRETS_KV.put(key, JSON.stringify(configs));
		warning = `ENCRYPTION_KEY 未配置，${providerName} 凭据将以明文存储。建议立即配置加密密钥。`;
	}

	return { success: true, encrypted, warning };
}

/**
 * Parse a provider JSON response and fall back to raw text when parsing fails.
 * @param {Response} response - fetch response
 * @returns {Promise<Object>}
 */
export async function parseOAuthJsonResponse(response) {
	const text = await response.text();
	if (!text) {
		return {};
	}

	try {
		return JSON.parse(text);
	} catch {
		return { raw: text };
	}
}

/**
 * Extract a human-friendly provider error from a parsed OAuth/API response.
 * @param {Object} data - parsed response payload
 * @param {string} fallbackMessage - default error message
 * @param {Function} [translateError] - optional provider-specific translator
 * @returns {string}
 */
export function extractOAuthProviderError(data, fallbackMessage, translateError) {
	if (!data || typeof data !== 'object') {
		return fallbackMessage;
	}

	if (typeof translateError === 'function') {
		const translated = translateError(data);
		if (translated) {
			return translated;
		}
	}

	if (typeof data.error === 'string' && typeof data.error_description === 'string') {
		return `${data.error}: ${data.error_description}`;
	}

	if (typeof data.error?.message === 'string') {
		return data.error.message;
	}

	if (typeof data.message === 'string') {
		return data.message;
	}

	if (typeof data.raw === 'string') {
		return `${fallbackMessage}: ${data.raw}`;
	}

	return fallbackMessage;
}

/**
 * Build a small callback page that notifies the opener window and closes itself.
 * Falls back to a link back to the app when popup messaging is unavailable.
 * @param {Request} request - HTTP request
 * @param {Object} payload - callback result
 * @returns {Response} HTML response
 */
export function createOAuthPopupResponse(request, payload) {
	const { appOrigin, ...messageData } = payload || {};
	const messagePayload = {
		type: 'cloudBackupAuthComplete',
		...messageData,
	};

	const safeJson = serializeForInlineScript(messagePayload);
	const targetOrigin = resolvePopupAppOrigin(request, appOrigin);
	const safeTargetOrigin = serializeForInlineScript(targetOrigin);
	const appUrl = `${targetOrigin}/`;
	const appearance = resolvePopupAppearance(payload);
	const title = payload.title || appearance.title;
	const description = payload.message || (payload.success ? '云盘授权已完成。' : '云盘授权未完成。');

	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f8fb;
      color: #1f2937;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
      text-align: center;
    }
    .icon {
      font-size: 40px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
    }
    p {
      margin: 0 0 18px;
      line-height: 1.6;
      color: #475569;
    }
    a {
      color: #2563eb;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${appearance.icon}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>如果窗口没有自动关闭，请返回应用继续操作。</p>
    <a href="${escapeHtml(appUrl)}">返回应用</a>
  </div>
  <script>
    (function () {
      const payload = ${safeJson};
      const targetOrigin = ${safeTargetOrigin};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
          window.close();
          return;
        }
      } catch (error) {
        console.error('OAuth popup notify failed', error);
      }
    })();
  </script>
</body>
</html>`;

	return createHtmlResponse(html, appearance.httpStatus, request);
}

function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function resolvePopupAppearance(payload) {
	const severity = payload.severity || (payload.success ? 'success' : 'error');

	switch (severity) {
		case 'warning':
			return {
				icon: '⚠️',
				title: '授权成功，但连接测试失败',
				httpStatus: 200,
			};
		case 'error':
			return {
				icon: '❌',
				title: '授权失败',
				httpStatus: 400,
			};
		case 'success':
		default:
			return {
				icon: '✅',
				title: '授权成功',
				httpStatus: 200,
			};
	}
}

function resolvePopupAppOrigin(request, appOrigin) {
	const normalizedAppOrigin = normalizeOrigin(appOrigin);
	if (normalizedAppOrigin) {
		return normalizedAppOrigin;
	}

	return new URL(request.url).origin;
}

function serializeForInlineScript(value) {
	return JSON.stringify(value)
		.replace(/</g, '\\u003C')
		.replace(/>/g, '\\u003E')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

function createOAuthStatePreviewPayload(payload, createdAt) {
	return {
		provider: payload.provider || '',
		configId: payload.configId || '',
		appOrigin: normalizeOrigin(payload.appOrigin),
		createdAt,
	};
}

function parseOAuthStateToken(state) {
	const parts = String(state).split('.');
	if (parts.length !== 4 || parts[0] !== OAUTH_STATE_VERSION) {
		return null;
	}

	return {
		stateId: parts[1],
		encodedPreview: parts[2],
		signature: parts[3],
	};
}

async function signOAuthStatePreview(env, encodedPreview) {
	const secret = getOAuthStateSigningSecret(env);
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPreview));
	return base64UrlEncode(signatureBuffer);
}

function getOAuthStateSigningSecret(env) {
	const candidates = [env.ENCRYPTION_KEY, env.GOOGLE_DRIVE_CLIENT_SECRET, env.ONEDRIVE_CLIENT_SECRET];

	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim()) {
			return candidate.trim();
		}
	}

	throw new Error('缺少 OAuth state 签名密钥');
}

function encodeOAuthStatePreview(value) {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeOAuthStatePreview(value) {
	return new TextDecoder().decode(base64UrlDecode(value));
}

function base64UrlEncode(buffer) {
	const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < uint8Array.length; i++) {
		binary += String.fromCharCode(uint8Array[i]);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
	const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	const binary = atob(normalized + padding);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}

function normalizeOrigin(value) {
	if (typeof value !== 'string' || !value.trim()) {
		return null;
	}

	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}
