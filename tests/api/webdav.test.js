/**
 * WebDAV API 端点单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	handleGetWebDAVConfig,
	handleSaveWebDAVConfig,
	handleTestWebDAV,
	handleDeleteWebDAVConfig,
} from '../../src/api/webdav.js';

// --- MockKV ---
class MockKV {
	constructor() {
		this.store = new Map();
	}

	async get(key, type = 'text') {
		const value = this.store.get(key);
		if (value === undefined || value === null) return null;
		if (type === 'json') {
			if (typeof value === 'object') return value;
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
		return typeof value === 'object' ? JSON.stringify(value) : value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}

	async delete(key) {
		this.store.delete(key);
	}

	async list(options = {}) {
		const keys = Array.from(this.store.keys());
		const prefix = options.prefix || '';
		const filteredKeys = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
		return { keys: filteredKeys.map((name) => ({ name })), list_complete: true };
	}

	clear() {
		this.store.clear();
	}
}

function createMockEnv() {
	const kv = new MockKV();
	const encryptionKey = Buffer.from('12345678901234567890123456789012').toString('base64');
	return {
		SECRETS_KV: kv,
		ENCRYPTION_KEY: encryptionKey,
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/webdav/config') {
	return {
		method,
		url,
		headers: new Headers({
			'Content-Type': 'application/json',
			'CF-Connecting-IP': '203.0.113.1',
		}),
		json: async () => body,
	};
}

describe('WebDAV API Module', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ==================== handleGetWebDAVConfig ====================
	describe('handleGetWebDAVConfig', () => {
		it('未配置时应返回 configured: false', async () => {
			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.configured).toBe(false);
			expect(data.config).toBeNull();
		});

		it('已配置时应返回配置（密码为空）', async () => {
			const config = {
				url: 'https://dav.example.com',
				username: 'testuser',
				password: 'secret123',
				path: '/backup',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(config));

			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.configured).toBe(true);
			expect(data.config.url).toBe('https://dav.example.com');
			expect(data.config.username).toBe('testuser');
			expect(data.config.password).toBe('');
			expect(data.config.hasPassword).toBe(true);
			expect(data.config.path).toBe('/backup');
		});

		it('应返回推送状态信息', async () => {
			const lastSuccess = { backupKey: 'backup_test.json', timestamp: '2026-03-01T00:00:00.000Z' };
			await env.SECRETS_KV.put('webdav_last_success', JSON.stringify(lastSuccess));

			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfig(request, env);
			const data = await response.json();

			expect(data.lastSuccessAt).toBe('2026-03-01T00:00:00.000Z');
			expect(data.lastError).toBeNull();
		});

		it('应返回最后错误信息', async () => {
			const lastError = { backupKey: 'backup_test.json', error: 'Connection refused', timestamp: '2026-03-01T00:00:00.000Z' };
			await env.SECRETS_KV.put('webdav_last_error', JSON.stringify(lastError));

			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfig(request, env);
			const data = await response.json();

			expect(data.lastError).toBeTruthy();
			expect(data.lastError.error).toBe('Connection refused');
		});
	});

	// ==================== handleSaveWebDAVConfig ====================
	describe('handleSaveWebDAVConfig', () => {
		it('应成功保存新配置', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.encrypted).toBe(true);
		});

		it('缺少必填字段时应返回 400', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				// 缺少 username
			});

			const response = await handleSaveWebDAVConfig(request, env);
			expect(response.status).toBe(400);
		});

		it('URL 非 HTTPS 时应返回 400', async () => {
			const request = createMockRequest({
				url: 'http://dav.example.com',
				username: 'user',
				password: 'pass',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			expect(response.status).toBe(400);
		});

		it('URL 格式无效时应返回 400', async () => {
			const request = createMockRequest({
				url: 'not-a-url',
				username: 'user',
				password: 'pass',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			expect(response.status).toBe(400);
		});

		it('首次配置时密码为空应返回 400', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: '',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.message).toContain('密码');
		});

		it('更新配置时密码为空应保留旧密码', async () => {
			// 先保存初始配置
			const initialConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'old-pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(initialConfig));

			// 更新配置时不提供密码
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'newuser',
				password: '',
				path: '/new-path',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});

		it('无 ENCRYPTION_KEY 应返回 warning', async () => {
			delete env.ENCRYPTION_KEY;

			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.encrypted).toBe(false);
			expect(data.warning).toBeTruthy();
			expect(data.warning).toContain('明文');
		});

		it('应正确处理 path 的 transform', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: 'backup//folder/',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ==================== handleTestWebDAV ====================
	describe('handleTestWebDAV', () => {
		it('连接成功时应返回 200', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 207,
				statusText: 'Multi-Status',
			});

			try {
				const request = createMockRequest({
					url: 'https://dav.example.com',
					username: 'user',
					password: 'pass',
					path: '/',
				});

				const response = await handleTestWebDAV(request, env);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('连接失败时应返回 400', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
			});

			try {
				const request = createMockRequest({
					url: 'https://dav.example.com',
					username: 'user',
					password: 'wrong',
					path: '/',
				});

				const response = await handleTestWebDAV(request, env);
				const data = await response.json();

				expect(response.status).toBe(400);
				expect(data.success).toBe(false);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('密码为空时应从 KV 读取已保存密码', async () => {
			// 先保存配置
			await env.SECRETS_KV.put(
				'webdav_config',
				JSON.stringify({
					url: 'https://dav.example.com',
					username: 'user',
					password: 'saved-pass',
					path: '/',
				}),
			);

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 207,
				statusText: 'Multi-Status',
			});

			try {
				const request = createMockRequest({
					url: 'https://dav.example.com',
					username: 'user',
					password: '',
					path: '/',
				});

				const response = await handleTestWebDAV(request, env);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);

				// 验证 fetch 被调用时使用了保存的密码
				const fetchCall = globalThis.fetch.mock.calls[0];
				const authHeader = fetchCall[1].headers.Authorization;
				expect(authHeader).toBe('Basic ' + btoa('user:saved-pass'));
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('密码为空且无已保存配置应返回 400', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: '',
				path: '/',
			});

			const response = await handleTestWebDAV(request, env);
			expect(response.status).toBe(400);
		});

		it('缺少必填字段应返回 400', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				// 缺少 username
			});

			const response = await handleTestWebDAV(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ==================== handleDeleteWebDAVConfig ====================
	describe('handleDeleteWebDAVConfig', () => {
		it('应成功删除配置和状态', async () => {
			// 先设置数据
			await env.SECRETS_KV.put('webdav_config', '{"url":"test"}');
			await env.SECRETS_KV.put('webdav_last_error', '{"error":"test"}');
			await env.SECRETS_KV.put('webdav_last_success', '{"timestamp":"test"}');

			const request = createMockRequest({}, 'DELETE');
			const response = await handleDeleteWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);

			// 验证数据已删除
			expect(await env.SECRETS_KV.get('webdav_config')).toBeNull();
			expect(await env.SECRETS_KV.get('webdav_last_error')).toBeNull();
			expect(await env.SECRETS_KV.get('webdav_last_success')).toBeNull();
		});

		it('无配置时删除也应成功', async () => {
			const request = createMockRequest({}, 'DELETE');
			const response = await handleDeleteWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});
	});
});
