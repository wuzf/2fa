/**
 * WebDAV 工具模块单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	pushToAllWebDAV,
	getWebDAVConfigs,
	saveWebDAVConfigs,
	saveWebDAVSingleConfig,
	deleteWebDAVSingleConfig,
	getWebDAVStatus,
	getWebDAVConfig,
	saveWebDAVConfig,
	pushToWebDAV,
	testWebDAVConnection,
} from '../../src/utils/webdav.js';

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
			return JSON.parse(value);
		}
		return value;
	}

	async put(key, value) {
		this.store.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
	}

	async delete(key) {
		this.store.delete(key);
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

describe('WebDAV Utils Module (Multi-Destination)', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ==================== getWebDAVConfigs ====================
	describe('getWebDAVConfigs', () => {
		it('未配置时应返回空数组', async () => {
			const configs = await getWebDAVConfigs(env);
			expect(configs).toEqual([]);
		});

		it('应读取新格式配置数组', async () => {
			const testConfigs = [
				{ id: 'uuid-1', name: 'NAS', enabled: true, url: 'https://nas.example.com', username: 'u', password: 'p', path: '/' },
			];
			await env.SECRETS_KV.put('webdav_configs', JSON.stringify(testConfigs));

			const configs = await getWebDAVConfigs(env);
			expect(configs).toEqual(testConfigs);
			expect(configs.length).toBe(1);
		});

		it('应自动迁移旧格式到新格式', async () => {
			const oldConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(oldConfig));
			await env.SECRETS_KV.put(
				'webdav_last_success',
				JSON.stringify({ backupKey: 'test.json', timestamp: '2026-01-01T00:00:00Z' }),
			);

			const configs = await getWebDAVConfigs(env);

			expect(configs.length).toBe(1);
			expect(configs[0].url).toBe('https://dav.example.com');
			expect(configs[0].name).toBe('WebDAV');
			expect(configs[0].enabled).toBe(true);
			expect(configs[0].id).toBeTruthy();

			// 旧 key 应被删除
			expect(await env.SECRETS_KV.get('webdav_config')).toBeNull();
			expect(await env.SECRETS_KV.get('webdav_last_success')).toBeNull();

			// 新格式应已保存
			const saved = await env.SECRETS_KV.get('webdav_configs');
			expect(saved).toBeTruthy();

			// 状态应迁移到新 key
			const status = await env.SECRETS_KV.get(`webdav_status_${configs[0].id}`, 'json');
			expect(status.lastSuccess.backupKey).toBe('test.json');
		});

		it('KV 读取失败时应抛出错误', async () => {
			env.SECRETS_KV.get = vi.fn().mockRejectedValue(new Error('KV error'));

			await expect(getWebDAVConfigs(env)).rejects.toThrow('KV error');
		});
	});

	// ==================== saveWebDAVSingleConfig ====================
	describe('saveWebDAVSingleConfig', () => {
		it('应成功新增配置', async () => {
			const config = {
				name: 'TestNAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};

			const result = await saveWebDAVSingleConfig(env, config);

			expect(result.success).toBe(true);
			expect(result.id).toBeTruthy();

			const configs = await getWebDAVConfigs(env);
			expect(configs.length).toBe(1);
			expect(configs[0].name).toBe('TestNAS');
			expect(configs[0].enabled).toBe(true);
			expect(configs[0].createdAt).toBeTruthy();
		});

		it('应成功更新已有配置', async () => {
			// 先新增
			const result1 = await saveWebDAVSingleConfig(env, {
				name: 'NAS1',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			});

			// 更新
			const result2 = await saveWebDAVSingleConfig(env, {
				id: result1.id,
				name: 'NAS1-Updated',
				url: 'https://dav2.example.com',
				username: 'user2',
				password: 'pass2',
				path: '/new',
			});

			expect(result2.success).toBe(true);

			const configs = await getWebDAVConfigs(env);
			expect(configs.length).toBe(1);
			expect(configs[0].name).toBe('NAS1-Updated');
			expect(configs[0].url).toBe('https://dav2.example.com');
		});

		it('更新不存在的 id 时应返回错误', async () => {
			const result = await saveWebDAVSingleConfig(env, {
				id: 'non-existent',
				name: 'Test',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				path: '/',
			});

			expect(result.success).toBe(false);
		});
	});

	// ==================== deleteWebDAVSingleConfig ====================
	describe('deleteWebDAVSingleConfig', () => {
		it('应成功删除配置和状态', async () => {
			const result = await saveWebDAVSingleConfig(env, {
				name: 'ToDelete',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				path: '/',
			});

			await env.SECRETS_KV.put(`webdav_status_${result.id}`, JSON.stringify({ lastSuccess: {} }));

			const deleteResult = await deleteWebDAVSingleConfig(env, result.id);
			expect(deleteResult.success).toBe(true);

			const configs = await getWebDAVConfigs(env);
			expect(configs.length).toBe(0);

			const status = await env.SECRETS_KV.get(`webdav_status_${result.id}`);
			expect(status).toBeNull();
		});

		it('删除不存在的 id 应返回错误', async () => {
			const result = await deleteWebDAVSingleConfig(env, 'non-existent');
			expect(result.success).toBe(false);
		});
	});

	// ==================== pushToAllWebDAV ====================
	describe('pushToAllWebDAV', () => {
		it('无配置时应返回 null', async () => {
			const result = await pushToAllWebDAV('backup_test.json', '{}', env);
			expect(result).toBeNull();
		});

		it('所有目标禁用时应返回 null', async () => {
			await saveWebDAVSingleConfig(env, {
				name: 'Disabled',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				path: '/',
			});
			// 获取配置然后禁用
			const configs = await getWebDAVConfigs(env);
			configs[0].enabled = false;
			await saveWebDAVConfigs(env, configs);

			const result = await pushToAllWebDAV('backup_test.json', '{}', env);
			expect(result).toBeNull();
		});

		it('应并行推送到多个启用的目标', async () => {
			await saveWebDAVSingleConfig(env, {
				name: 'NAS1',
				url: 'https://dav1.example.com',
				username: 'u1',
				password: 'p1',
				path: '/',
			});
			await saveWebDAVSingleConfig(env, {
				name: 'NAS2',
				url: 'https://dav2.example.com',
				username: 'u2',
				password: 'p2',
				path: '/',
			});

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 201,
				statusText: 'Created',
			});

			try {
				const result = await pushToAllWebDAV('backup_test.json', '{}', env);

				expect(result).toBeTruthy();
				expect(result.successCount).toBe(2);
				expect(result.failCount).toBe(0);
				expect(result.results.length).toBe(2);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('单目标推送成功时应记录状态', async () => {
			const addResult = await saveWebDAVSingleConfig(env, {
				name: 'NAS1',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				path: '/backup',
			});

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 201,
				statusText: 'Created',
			});

			try {
				const result = await pushToAllWebDAV('backup_test.json', '{}', env);

				expect(result.successCount).toBe(1);

				// 验证状态记录
				const status = await getWebDAVStatus(env, addResult.id);
				expect(status.lastSuccess).toBeTruthy();
				expect(status.lastSuccess.backupKey).toBe('backup_test.json');
				expect(status.lastError).toBeNull();

				// 验证 fetch URL
				const fetchCall = globalThis.fetch.mock.calls[0];
				expect(fetchCall[0]).toBe('https://dav.example.com/backup/backup_test.json');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('单目标推送失败时应记录错误状态', async () => {
			const addResult = await saveWebDAVSingleConfig(env, {
				name: 'NAS1',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				path: '/',
			});

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: 'Forbidden',
			});

			try {
				const result = await pushToAllWebDAV('backup_test.json', '{}', env);

				expect(result.successCount).toBe(0);
				expect(result.failCount).toBe(1);

				const status = await getWebDAVStatus(env, addResult.id);
				expect(status.lastError).toBeTruthy();
				expect(status.lastError.error).toContain('403');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	// ==================== 兼容性导出 ====================
	describe('Backward Compatibility', () => {
		it('getWebDAVConfig 应返回第一个配置', async () => {
			await saveWebDAVSingleConfig(env, {
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			});

			const config = await getWebDAVConfig(env);
			expect(config).toBeTruthy();
			expect(config.url).toBe('https://dav.example.com');
		});

		it('getWebDAVConfig 无配置时应返回 null', async () => {
			const config = await getWebDAVConfig(env);
			expect(config).toBeNull();
		});

		it('saveWebDAVConfig 应等价于 saveWebDAVSingleConfig', async () => {
			const result = await saveWebDAVConfig(env, {
				name: 'NAS',
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			});

			expect(result.success).toBe(true);
			expect(result.id).toBeTruthy();
		});
	});

	// ==================== testWebDAVConnection ====================
	describe('testWebDAVConnection', () => {
		const testConfig = {
			url: 'https://dav.example.com',
			username: 'user',
			password: 'pass',
			path: '/',
		};

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('PROPFIND 成功（207）应返回连接成功', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 207,
				statusText: 'Multi-Status',
			});

			try {
				const result = await testWebDAVConnection(testConfig);
				expect(result.success).toBe(true);
				expect(result.method).toBe('PROPFIND');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('PROPFIND 返回 405 应回退 HEAD', async () => {
			const originalFetch = globalThis.fetch;
			let callCount = 0;
			globalThis.fetch = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount <= 2) {
					return Promise.resolve({ ok: false, status: 405, statusText: 'Method Not Allowed' });
				}
				return Promise.resolve({ ok: true, status: 200, statusText: 'OK' });
			});

			try {
				const result = await testWebDAVConnection(testConfig);
				expect(result.success).toBe(true);
				expect(result.method).toBe('HEAD');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('认证失败（401）应返回错误', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
			});

			try {
				const result = await testWebDAVConnection(testConfig);
				expect(result.success).toBe(false);
				expect(result.message).toContain('认证失败');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('超时应返回超时错误', async () => {
			const originalFetch = globalThis.fetch;
			const abortError = new Error('The operation was aborted');
			abortError.name = 'AbortError';
			globalThis.fetch = vi.fn().mockRejectedValue(abortError);

			try {
				const result = await testWebDAVConnection(testConfig);
				expect(result.success).toBe(false);
				expect(result.message).toContain('超时');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
