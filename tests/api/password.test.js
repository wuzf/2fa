/**
 * Change Password API 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleChangePassword } from '../../src/api/password.js';

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

	async put(key, value, options) {
		this.store.set(key, value);
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
	return {
		SECRETS_KV: kv,
		LOG_LEVEL: 'ERROR',
	};
}

function createMockRequest(body = {}) {
	return {
		method: 'POST',
		url: 'https://example.com/api/change-password',
		headers: new Headers({
			'Content-Type': 'application/json',
			'CF-Connecting-IP': '203.0.113.1',
		}),
		json: async () => body,
	};
}

/**
 * 使用 PBKDF2 加密密码（测试辅助函数，与 auth.js 中的逻辑一致）
 */
async function hashPasswordForTest(password) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const encoder = new TextEncoder();
	const passwordBuffer = encoder.encode(password);
	const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);

	const hashBuffer = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt,
			iterations: 100000,
			hash: 'SHA-256',
		},
		keyMaterial,
		256,
	);

	const saltB64 = btoa(String.fromCharCode(...salt));
	const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
	return `${saltB64}$${hashB64}`;
}

describe('Change Password API', () => {
	let env;

	beforeEach(() => {
		env = createMockEnv();
		vi.clearAllMocks();
	});

	it('应该成功修改密码', async () => {
		const currentPassword = 'OldPass123!';
		const newPassword = 'NewPass456@';

		// 设置当前密码哈希
		const storedHash = await hashPasswordForTest(currentPassword);
		await env.SECRETS_KV.put('user_password', storedHash);

		const request = createMockRequest({
			currentPassword,
			newPassword,
			confirmPassword: newPassword,
		});

		const response = await handleChangePassword(request, env);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.message).toContain('密码修改成功');

		// 验证密码已更新（新哈希不同于旧哈希）
		const newHash = await env.SECRETS_KV.get('user_password');
		expect(newHash).not.toBe(storedHash);
	});

	it('当前密码错误时应该返回 401', async () => {
		const storedHash = await hashPasswordForTest('CorrectPass123!');
		await env.SECRETS_KV.put('user_password', storedHash);

		const request = createMockRequest({
			currentPassword: 'WrongPass123!',
			newPassword: 'NewPass456@',
			confirmPassword: 'NewPass456@',
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.message).toContain('密码错误');
	});

	it('新密码不一致时应该返回 400', async () => {
		const storedHash = await hashPasswordForTest('OldPass123!');
		await env.SECRETS_KV.put('user_password', storedHash);

		const request = createMockRequest({
			currentPassword: 'OldPass123!',
			newPassword: 'NewPass456@',
			confirmPassword: 'DifferentPass789!',
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.message).toContain('不一致');
	});

	it('缺少参数时应该返回 400', async () => {
		const request = createMockRequest({
			currentPassword: 'OldPass123!',
			// missing newPassword and confirmPassword
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.message).toContain('请提供');
	});

	it('新密码强度不够时应该返回 400', async () => {
		const currentPassword = 'OldPass123!';
		const storedHash = await hashPasswordForTest(currentPassword);
		await env.SECRETS_KV.put('user_password', storedHash);

		const request = createMockRequest({
			currentPassword,
			newPassword: 'weakpass',
			confirmPassword: 'weakpass',
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(400);
	});

	it('新密码缺少大写字母时应该返回 400', async () => {
		const currentPassword = 'OldPass123!';
		const storedHash = await hashPasswordForTest(currentPassword);
		await env.SECRETS_KV.put('user_password', storedHash);

		const request = createMockRequest({
			currentPassword,
			newPassword: 'nouppcase123!',
			confirmPassword: 'nouppcase123!',
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.message).toContain('大写字母');
	});

	it('未配置 KV 存储时应该返回 500', async () => {
		const envNoKV = { LOG_LEVEL: 'ERROR' };

		const request = createMockRequest({
			currentPassword: 'OldPass123!',
			newPassword: 'NewPass456@',
			confirmPassword: 'NewPass456@',
		});

		const response = await handleChangePassword(request, envNoKV);

		expect(response.status).toBe(500);
	});

	it('未设置密码时应该返回 500', async () => {
		// KV 存在但没有存储密码
		const request = createMockRequest({
			currentPassword: 'OldPass123!',
			newPassword: 'NewPass456@',
			confirmPassword: 'NewPass456@',
		});

		const response = await handleChangePassword(request, env);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.message).toContain('未设置密码');
	});

	it('应该受到速率限制', async () => {
		const currentPassword = 'OldPass123!';
		const storedHash = await hashPasswordForTest(currentPassword);
		await env.SECRETS_KV.put('user_password', storedHash);

		// 发送超过限制的请求（sensitive preset: 10/min）
		let rateLimited = false;
		for (let i = 0; i < 12; i++) {
			const request = createMockRequest({
				currentPassword: 'WrongPass' + i + '!A',
				newPassword: 'NewPass456@',
				confirmPassword: 'NewPass456@',
			});

			const response = await handleChangePassword(request, env);
			if (response.status === 429) {
				rateLimited = true;
				break;
			}
		}

		expect(rateLimited).toBe(true);
	});
});
