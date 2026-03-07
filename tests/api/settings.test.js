/**
 * Settings API 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleGetSettings, handleSaveSettings } from '../../src/api/settings.js';

// --- MockKV ---
class MockKV {
	constructor() {
		this.store = new Map();
	}

	async get(key) {
		const value = this.store.get(key);
		return value === undefined ? null : value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}
}

function createMockEnv() {
	return {
		SECRETS_KV: new MockKV(),
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body) {
	return {
		method: 'POST',
		url: 'https://example.com/api/settings',
		headers: new Headers({ 'Content-Type': 'application/json' }),
		json: async () => body,
	};
}

function createGetRequest() {
	return {
		method: 'GET',
		url: 'https://example.com/api/settings',
		headers: new Headers(),
	};
}

describe('Settings API', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
	});

	describe('handleGetSettings', () => {
		it('KV 为空时应返回默认值', async () => {
			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.jwtExpiryDays).toBe(30);
			expect(data.maxBackups).toBe(100);
		});

		it('KV 有值时应合并默认值', async () => {
			await env.SECRETS_KV.put('settings', JSON.stringify({ maxBackups: 50 }));

			const resp = await handleGetSettings(createGetRequest(), env);
			const data = await resp.json();

			expect(data.maxBackups).toBe(50);
			expect(data.jwtExpiryDays).toBe(30); // 默认值补全
		});
	});

	describe('handleSaveSettings - maxBackups 校验', () => {
		it('合法整数 50 应保存成功', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 50 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.settings.maxBackups).toBe(50);
		});

		it('0 应保存成功（表示不限制）', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 0 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(0);
		});

		it('1000 应保存成功（上界）', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 1000 }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(1000);
		});

		it('null 应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: null }), env);
			expect(resp.status).toBe(400);
		});

		it('false 应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: false }), env);
			expect(resp.status).toBe(400);
		});

		it('true 应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: true }), env);
			expect(resp.status).toBe(400);
		});

		it('空字符串应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: '' }), env);
			expect(resp.status).toBe(400);
		});

		it('纯空白字符串应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: '   ' }), env);
			expect(resp.status).toBe(400);
		});

		it('负数应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: -1 }), env);
			expect(resp.status).toBe(400);
		});

		it('超范围 1001 应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 1001 }), env);
			expect(resp.status).toBe(400);
		});

		it('小数应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: 3.5 }), env);
			expect(resp.status).toBe(400);
		});

		it('空数组应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: [] }), env);
			expect(resp.status).toBe(400);
		});

		it('单元素数组 [5] 应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: [5] }), env);
			expect(resp.status).toBe(400);
		});

		it('对象应被拒绝', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: {} }), env);
			expect(resp.status).toBe(400);
		});

		it('字符串数字 "50" 应保存成功', async () => {
			const resp = await handleSaveSettings(createMockRequest({ maxBackups: '50' }), env);
			const data = await resp.json();

			expect(resp.status).toBe(200);
			expect(data.settings.maxBackups).toBe(50);
		});

		it('拒绝的值不应写入 KV', async () => {
			// 先写入合法值
			await handleSaveSettings(createMockRequest({ maxBackups: 50 }), env);

			// 尝试写入非法值
			await handleSaveSettings(createMockRequest({ maxBackups: '   ' }), env);

			// 确认 KV 中仍然是 50
			const raw = await env.SECRETS_KV.get('settings');
			const settings = JSON.parse(raw);
			expect(settings.maxBackups).toBe(50);
		});
	});
});
