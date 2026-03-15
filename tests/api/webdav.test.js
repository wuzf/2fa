/**
 * WebDAV API 端点单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	handleGetWebDAVConfigs,
	handleSaveWebDAVConfig,
	handleTestWebDAV,
	handleDeleteWebDAVConfig,
	handleToggleWebDAV,
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

describe('WebDAV API Module (Multi-Destination)', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ==================== handleGetWebDAVConfigs ====================
	describe('handleGetWebDAVConfigs', () => {
		it('未配置时应返回空目标列表', async () => {
			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfigs(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.destinations).toEqual([]);
			expect(data.count).toBe(0);
			expect(data.maxAllowed).toBe(5);
		});

		it('已配置时应返回目标列表（密码为空）', async () => {
			const configs = [
				{
					id: 'uuid-1',
					name: 'NAS',
					enabled: true,
					url: 'https://dav.example.com',
					username: 'testuser',
					password: 'secret123',
					path: '/backup',
					createdAt: '2026-01-01T00:00:00Z',
				},
			];
			await env.SECRETS_KV.put('webdav_configs', JSON.stringify(configs));

			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfigs(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.destinations.length).toBe(1);
			expect(data.count).toBe(1);

			const dest = data.destinations[0];
			expect(dest.id).toBe('uuid-1');
			expect(dest.name).toBe('NAS');
			expect(dest.enabled).toBe(true);
			expect(dest.config.url).toBe('https://dav.example.com');
			expect(dest.config.password).toBe('');
			expect(dest.config.hasPassword).toBe(true);
		});

		it('应返回各目标的推送状态', async () => {
			const configs = [
				{
					id: 'uuid-1',
					name: 'NAS',
					enabled: true,
					url: 'https://dav.example.com',
					username: 'u',
					password: 'p',
					path: '/',
				},
			];
			await env.SECRETS_KV.put('webdav_configs', JSON.stringify(configs));
			await env.SECRETS_KV.put(
				'webdav_status_uuid-1',
				JSON.stringify({
					lastSuccess: { backupKey: 'backup.json', timestamp: '2026-03-01T00:00:00Z' },
				}),
			);

			const request = createMockRequest({}, 'GET');
			const response = await handleGetWebDAVConfigs(request, env);
			const data = await response.json();

			expect(data.destinations[0].status.lastSuccess.timestamp).toBe('2026-03-01T00:00:00Z');
			expect(data.destinations[0].status.lastError).toBeNull();
		});
	});

	// ==================== handleSaveWebDAVConfig ====================
	describe('handleSaveWebDAVConfig', () => {
		it('应成功保存新配置', async () => {
			const request = createMockRequest({
				name: 'TestNAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.id).toBeTruthy();
			expect(data.encrypted).toBe(true);
		});

		it('缺少 name 字段时应返回 400', async () => {
			const request = createMockRequest({
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
			});

			const response = await handleSaveWebDAVConfig(request, env);
			expect(response.status).toBe(400);
		});

		it('首次配置时密码为空应返回 400', async () => {
			const request = createMockRequest({
				name: 'NAS',
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
			const addReq = createMockRequest({
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'old-pass',
				path: '/',
			});
			const addResp = await handleSaveWebDAVConfig(addReq, env);
			const addData = await addResp.json();

			// 更新配置时不提供密码
			const updateReq = createMockRequest({
				id: addData.id,
				name: 'NAS-Updated',
				url: 'https://dav.example.com',
				username: 'newuser',
				password: '',
				path: '/new-path',
			});

			const response = await handleSaveWebDAVConfig(updateReq, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});

		it('缺少 ENCRYPTION_KEY 时不应覆盖已有加密配置', async () => {
			const addResp = await handleSaveWebDAVConfig(
				createMockRequest({
					name: 'NAS',
					url: 'https://dav.example.com',
					username: 'user',
					password: 'old-pass',
					path: '/',
				}),
				env,
			);
			const addData = await addResp.json();
			const rawBefore = await env.SECRETS_KV.get('webdav_configs', 'text');
			delete env.ENCRYPTION_KEY;

			const response = await handleSaveWebDAVConfig(
				createMockRequest({
					id: addData.id,
					name: 'NAS-Updated',
					url: 'https://dav.example.com',
					username: 'newuser',
					password: '',
					path: '/new-path',
				}),
				env,
			);
			const data = await response.json();
			const rawAfter = await env.SECRETS_KV.get('webdav_configs', 'text');

			expect(response.status).toBe(500);
			expect(data.message).toContain('ENCRYPTION_KEY');
			expect(rawAfter).toBe(rawBefore);
		});
	});

	// ==================== handleDeleteWebDAVConfig ====================
	describe('handleDeleteWebDAVConfig', () => {
		it('应成功删除指定配置', async () => {
			// 先添加
			const addReq = createMockRequest({
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			});
			const addResp = await handleSaveWebDAVConfig(addReq, env);
			const addData = await addResp.json();

			// 删除
			const deleteReq = createMockRequest({}, 'DELETE', `https://example.com/api/webdav/config?id=${addData.id}`);
			const response = await handleDeleteWebDAVConfig(deleteReq, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});

		it('缺少 id 参数应返回 400', async () => {
			const request = createMockRequest({}, 'DELETE', 'https://example.com/api/webdav/config');
			const response = await handleDeleteWebDAVConfig(request, env);

			expect(response.status).toBe(400);
		});

		it('删除不存在的 id 应返回 404', async () => {
			const request = createMockRequest({}, 'DELETE', 'https://example.com/api/webdav/config?id=non-existent');
			const response = await handleDeleteWebDAVConfig(request, env);

			expect(response.status).toBe(404);
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
					name: 'NAS',
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

		it('密码为空且有已保存配置（通过 id）应使用保存的密码', async () => {
			// 先保存配置
			const addReq = createMockRequest({
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'saved-pass',
				path: '/',
			});
			const addResp = await handleSaveWebDAVConfig(addReq, env);
			const addData = await addResp.json();

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 207,
				statusText: 'Multi-Status',
			});

			try {
				const request = createMockRequest({
					id: addData.id,
					name: 'NAS',
					url: 'https://dav.example.com',
					username: 'user',
					password: '',
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
		it('无 id 且密码为空时应返回 400（不得回退已保存凭据）', async () => {
			// 先保存一个配置（确保 KV 中有凭据可被误用）
			await handleSaveWebDAVConfig(
				createMockRequest({
					name: 'NAS',
					url: 'https://dav.example.com',
					username: 'user',
					password: 'saved-pass',
					path: '/',
				}),
				env,
			);

			// 不带 id、密码为空 → 必须 400，不能回退使用已保存的密码
			const request = createMockRequest({
				name: 'Other',
				url: 'https://evil.example.com',
				username: 'attacker',
				password: '',
				path: '/',
			});

			const response = await handleTestWebDAV(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ==================== handleToggleWebDAV ====================
	describe('handleToggleWebDAV', () => {
		it('应成功启用/禁用目标', async () => {
			// 先添加
			const addReq = createMockRequest({
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			});
			const addResp = await handleSaveWebDAVConfig(addReq, env);
			const addData = await addResp.json();

			// 禁用
			const toggleReq = createMockRequest(
				{ id: addData.id, enabled: false },
				'POST',
				'https://example.com/api/webdav/toggle',
			);
			const response = await handleToggleWebDAV(toggleReq, env);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.message).toBe('已禁用');
		});

		it('不存在的 id 应返回 404', async () => {
			const request = createMockRequest(
				{ id: 'non-existent', enabled: false },
				'POST',
				'https://example.com/api/webdav/toggle',
			);
			const response = await handleToggleWebDAV(request, env);

			expect(response.status).toBe(404);
		});
	});
});
