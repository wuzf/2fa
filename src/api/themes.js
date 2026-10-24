/** Authenticated theme APIs and the deliberately separate public asset endpoint. */
import { getBuiltinThemes } from '../themes/index.js';
import { createJsonResponse, createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';

export const THEME_OPERATION_HEADER = 'X-2FA-Theme-Operation';
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
		branding: {},
		customCss: '',
		resources: [],
	};
}

async function forward(request, env, operation) {
	const headers = new Headers(request.headers);
	// These names cannot be selected by an external caller, even if supplied as headers.
	headers.delete('X-2FA-Store-Operation');
	headers.set(THEME_OPERATION_HEADER, operation);
	const init = { method: request.method, headers };
	if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = request.body;
		init.duplex = 'half';
	}
	return themeStub(env).fetch(new Request(request.url, init));
}

/** The router must authenticate this handler; no write falls back to Workers KV. */
export async function handleThemeRequest(request, env) {
	if (!env.SECRETS_STORE) {
		const pathname = new URL(request.url).pathname;
		if (request.method === 'GET' && pathname === '/api/themes') {
			return createJsonResponse({ themes: getBuiltinThemes().map((theme) => ({ ...theme, builtIn: true })) }, 200, request);
		}
		if (request.method === 'GET' && pathname === '/api/appearance') {
			return createJsonResponse(
				{ revision: 0, active: createDefaultAppearance(), previous: false, capabilities: { write: false } },
				200,
				request,
			);
		}
		return createErrorResponse(
			'需要配置主题存储',
			'请按部署文档绑定 SECRETS_STORE 后安装或保存主题。内置主题仍可在本机预览。',
			503,
			request,
		);
	}
	try {
		return await forward(request, env, 'api');
	} catch (error) {
		getLogger(env).error('主题存储暂时不可用', { errorMessage: error.message });
		return createErrorResponse('主题存储暂时不可用', '无法确认本次操作结果。请保留草稿并使用相同操作标识重试。', 503, request);
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
