/**
 * WebDAV 工具模块单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { pushToWebDAV, getWebDAVConfig, saveWebDAVConfig, testWebDAVConnection } from '../../src/utils/webdav.js';

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

describe('WebDAV Utils Module', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ==================== getWebDAVConfig ====================
	describe('getWebDAVConfig', () => {
		it('未配置时应返回 null', async () => {
			const config = await getWebDAVConfig(env);
			expect(config).toBeNull();
		});

		it('应读取明文配置', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const config = await getWebDAVConfig(env);
			expect(config).toEqual(testConfig);
		});

		it('应读取加密配置', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			};

			// 先通过 saveWebDAVConfig 加密保存
			await saveWebDAVConfig(env, testConfig);

			// 再读取
			const config = await getWebDAVConfig(env);
			expect(config).toEqual(testConfig);
		});

		it('KV 读取失败时返回 null', async () => {
			env.SECRETS_KV.get = vi.fn().mockRejectedValue(new Error('KV error'));

			const config = await getWebDAVConfig(env);
			expect(config).toBeNull();
		});
	});

	// ==================== saveWebDAVConfig ====================
	describe('saveWebDAVConfig', () => {
		it('有 ENCRYPTION_KEY 时应加密保存', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			const result = await saveWebDAVConfig(env, testConfig);

			expect(result.success).toBe(true);
			expect(result.encrypted).toBe(true);
			expect(result.warning).toBeNull();

			// 验证 KV 中存储的是加密数据
			const stored = await env.SECRETS_KV.get('webdav_config', 'text');
			expect(stored).toMatch(/^v1:/);
		});

		it('无 ENCRYPTION_KEY 时应明文保存并返回 warning', async () => {
			delete env.ENCRYPTION_KEY;

			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			const result = await saveWebDAVConfig(env, testConfig);

			expect(result.success).toBe(true);
			expect(result.encrypted).toBe(false);
			expect(result.warning).toContain('明文');

			// 验证 KV 中存储的是 JSON 明文
			const stored = await env.SECRETS_KV.get('webdav_config', 'text');
			const parsed = JSON.parse(stored);
			expect(parsed).toEqual(testConfig);
		});

		it('加密保存后可以正确解密读取', async () => {
			const testConfig = {
				url: 'https://nextcloud.example.com/remote.php/dav/files/user',
				username: 'testuser',
				password: 's3cret!@#',
				path: '/2fa-backups',
			};

			await saveWebDAVConfig(env, testConfig);
			const config = await getWebDAVConfig(env);

			expect(config).toEqual(testConfig);
		});
	});

	// ==================== pushToWebDAV ====================
	describe('pushToWebDAV', () => {
		it('未配置时应静默返回 null', async () => {
			const result = await pushToWebDAV('backup_2026-03-01_00-00-00.json', '{"test": true}', env);
			expect(result).toBeNull();
		});

		it('推送成功时应记录成功状态', async () => {
			// 设置配置
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/backup',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			// Mock fetch 成功
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 201,
				statusText: 'Created',
			});

			try {
				const result = await pushToWebDAV('backup_2026-03-01_00-00-00.json', '{"test": true}', env);

				expect(result).toEqual({
					success: true,
					backupKey: 'backup_2026-03-01_00-00-00.json',
					status: 201,
				});

				// 验证成功状态已记录
				const lastSuccess = JSON.parse(await env.SECRETS_KV.get('webdav_last_success', 'text'));
				expect(lastSuccess.backupKey).toBe('backup_2026-03-01_00-00-00.json');
				expect(lastSuccess.timestamp).toBeTruthy();

				// 验证错误状态已清除
				const lastError = await env.SECRETS_KV.get('webdav_last_error', 'text');
				expect(lastError).toBeNull();

				// 验证 fetch 调用参数
				expect(globalThis.fetch).toHaveBeenCalledTimes(1);
				const fetchCall = globalThis.fetch.mock.calls[0];
				expect(fetchCall[0]).toBe('https://dav.example.com/backup/backup_2026-03-01_00-00-00.json');
				expect(fetchCall[1].method).toBe('PUT');
				expect(fetchCall[1].headers.Authorization).toMatch(/^Basic /);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('推送失败时应记录错误状态', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: 'Forbidden',
			});

			try {
				const result = await pushToWebDAV('backup_2026-03-01_00-00-00.json', '{"test": true}', env);

				expect(result.success).toBe(false);
				expect(result.error).toContain('403');

				// 验证错误状态已记录
				const lastError = JSON.parse(await env.SECRETS_KV.get('webdav_last_error', 'text'));
				expect(lastError.backupKey).toBe('backup_2026-03-01_00-00-00.json');
				expect(lastError.error).toContain('403');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('网络错误时应记录错误状态而非抛异常', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

			try {
				const result = await pushToWebDAV('backup_2026-03-01_00-00-00.json', '{"test": true}', env);

				// 不应抛异常
				expect(result.success).toBe(false);
				expect(result.error).toContain('Network error');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('超时时应记录超时错误', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const originalFetch = globalThis.fetch;
			const abortError = new Error('The operation was aborted');
			abortError.name = 'AbortError';
			globalThis.fetch = vi.fn().mockRejectedValue(abortError);

			try {
				const result = await pushToWebDAV('backup_2026-03-01_00-00-00.json', '{"test": true}', env);

				expect(result.success).toBe(false);
				expect(result.error).toContain('超时');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('路径为 / 时应正确构建 URL', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

			try {
				await pushToWebDAV('backup_test.json', '{}', env);

				const fetchCall = globalThis.fetch.mock.calls[0];
				expect(fetchCall[0]).toBe('https://dav.example.com/backup_test.json');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('status 204 也应视为成功', async () => {
			const testConfig = {
				url: 'https://dav.example.com',
				username: 'user',
				password: 'pass',
				path: '/',
			};
			await env.SECRETS_KV.put('webdav_config', JSON.stringify(testConfig));

			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 204, statusText: 'No Content' });

			try {
				const result = await pushToWebDAV('backup_test.json', '{}', env);
				expect(result.success).toBe(true);
				expect(result.status).toBe(204);
			} finally {
				globalThis.fetch = originalFetch;
			}
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
					// PROPFIND 和 OPTIONS 都返回 405
					return Promise.resolve({ ok: false, status: 405, statusText: 'Method Not Allowed' });
				}
				// HEAD 返回 200
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

		it('网络错误时应尝试 HEAD 回退', async () => {
			const originalFetch = globalThis.fetch;
			let callCount = 0;
			globalThis.fetch = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount <= 2) {
					return Promise.reject(new Error('Connection refused'));
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

		it('PROPFIND 返回 403 应提示认证失败', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: 'Forbidden',
			});

			try {
				const result = await testWebDAVConnection(testConfig);
				expect(result.success).toBe(false);
				expect(result.message).toContain('认证失败');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
