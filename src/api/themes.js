/** Authenticated theme APIs and the deliberately separate public asset endpoint. */
import { getBuiltinThemes } from '../themes/index.js';
import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';
import { readThemeCatalog } from '../themes/catalog.js';

export const THEME_OPERATION_HEADER = 'X-2FA-Theme-Operation';
export const THEME_PREVIEW_OWNER_HEADER = 'X-2FA-Preview-Owner';
export const THEME_STORE_NAME = 'appearance:v1';

function themeStub(env) {
	return env.SECRETS_STORE.get(env.SECRETS_STORE.idFromName(THEME_STORE_NAME));
}

export function createDefaultAppearance() {
	const theme = getBuiltinThemes()[0];
	return {
		revision: 0,
		packageId: theme.packageId,
		themeId: theme.manifest.id,
		manifest: theme.manifest,
		css: theme.css,
		settings: Object.fromEntries((theme.manifest.settings || []).map((field) => [field.key, field.default])),
		layout: theme.manifest.layout,
		content: theme.manifest.content || {},
		resources: [],
	};
}

async function forward(request, env, operation, owner) {
	const headers = new Headers(request.headers);
	// These names cannot be selected by an external caller, even if supplied as headers.
	headers.delete('X-2FA-Store-Operation');
	headers.delete(THEME_PREVIEW_OWNER_HEADER);
	headers.set(THEME_OPERATION_HEADER, operation);
	if (owner) {
		headers.set(THEME_PREVIEW_OWNER_HEADER, owner);
	}
	const init = { method: request.method, headers };
	if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = request.body;
		init.duplex = 'half';
	}
	return themeStub(env).fetch(new Request(request.url, init));
}

/** Single-user vault owner survives JWT refresh; never accept a client owner header. */
async function previewOwner(request, env) {
	if (!request.authDetails?.valid || !env.SECRETS_KV) {
		return null;
	}
	const passwordHash = await env.SECRETS_KV.get('user_password');
	if (!passwordHash) {
		return null;
	}
	const value = new TextEncoder().encode('2fa-theme-preview-owner\n' + new URL(request.url).origin + '\n' + passwordHash);
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The router must authenticate this handler; no write falls back to Workers KV. */
export async function handleThemeRequest(request, env) {
	// Without the theme store only the official catalog can be listed (installing
	// still needs the store). With it, the store adds the owner's catalogs.
	if (!env.SECRETS_STORE && request.method === 'GET' && new URL(request.url).pathname === '/api/themes/catalog') {
		try {
			return createJsonResponse(await readThemeCatalog(), 200, request, { 'Cache-Control': 'no-store' });
		} catch (error) {
			return createJsonResponse({ error: error.code || 'THEME_CATALOG_UNAVAILABLE' }, 503, request, { 'Cache-Control': 'no-store' });
		}
	}
	if (!env.SECRETS_STORE) {
		const pathname = new URL(request.url).pathname;
		if (request.method === 'GET' && pathname === '/api/themes') {
			const themes =
				new URL(request.url).searchParams.get('format') === 'app' ? [] : getBuiltinThemes().map((theme) => ({ ...theme, builtIn: true }));
			return createJsonResponse({ themes }, 200, request);
		}
		if (request.method === 'GET' && pathname === '/api/appearance') {
			return createJsonResponse({ revision: 0, active: createDefaultAppearance(), capabilities: { write: false } }, 200, request);
		}
		return createErrorResponse(
			'需要配置主题存储',
			'请按部署文档绑定 SECRETS_STORE 后安装或保存主题。内置主题仍可在本机预览。',
			503,
			request,
		);
	}
	try {
		const needsOwner = new URL(request.url).pathname.startsWith('/api/themes/preview-capabilities');
		const owner = needsOwner ? await previewOwner(request, env) : null;
		if (needsOwner && !owner) {
			return createErrorResponse('身份验证失败', '请重新登录后创建预览', 401, request);
		}
		return await forward(request, env, 'api', owner);
	} catch (error) {
		getLogger(env).error('主题存储暂时不可用', { errorMessage: error.message });
		return createErrorResponse('主题存储暂时不可用', '无法确认本次操作结果。请保留草稿并使用相同操作标识重试。', 503, request);
	}
}

/** No credentials or API CORS are granted to these opaque-preview resources. */
export async function handleThemePreviewRequest(request, env) {
	if (!env.SECRETS_STORE || !['GET', 'HEAD'].includes(request.method)) {
		return new Response('Not found', { status: 404 });
	}
	try {
		return await forward(request, env, 'preview');
	} catch {
		return new Response('Preview unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
	}
}

/** Called only after a same-origin logout succeeded and its old authentication was verified. */
export async function revokeThemePreviewOwner(request, env) {
	if (!env.SECRETS_STORE) {
		return;
	}
	const owner = await previewOwner(request, env);
	if (!owner) {
		return;
	}
	const response = await forward(new Request(request.url, { method: 'POST' }), env, 'preview-logout', owner);
	if (!response.ok) {
		throw new Error('Theme preview revocation unavailable');
	}
}

/** A public URL is not proof of publication; the DO checks its publication record. */
export async function handleThemeAssetRequest(request, env) {
	if (!env.SECRETS_STORE || !['GET', 'HEAD'].includes(request.method)) {
		return new Response('Not found', { status: 404 });
	}
	try {
		return await forward(request, env, 'public');
	} catch {
		return new Response('Theme asset unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
	}
}

/** Scheduled job: updates themes from the official catalog when the owner turned it on. */
export async function runThemeAutoUpdate(env) {
	if (!env.SECRETS_STORE) {
		return null;
	}
	const response = await forward(new Request('https://appearance.internal/api/themes/auto-update', { method: 'POST' }), env, 'auto-update');
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}

/** Only a published snapshot is returned to login pages, manifests and the HTML shell. */
export async function getPublicAppearance(env) {
	if (!env.SECRETS_STORE) {
		return createDefaultAppearance();
	}
	try {
		const response = await forward(new Request('https://appearance.internal/api/appearance'), env, 'appearance');
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return await response.json();
	} catch (error) {
		getLogger(env).warn('主题暂时无法读取，使用内置主题', { errorMessage: error.message });
		return createDefaultAppearance();
	}
}
