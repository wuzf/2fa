/**
 * Auth.js 集成测试
 *
 * 测试完整的身份验证流程，包括：
 * - 首次设置流程
 * - 登录流程
 * - Token刷新流程
 * - 认证中间件
 * - Rate Limiting集成
 * - Cookie和Authorization Header处理
 *
 * 目标覆盖率：70%+
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  verifyAuth,
  handleLogin,
  handleRefreshToken,
  checkIfSetupRequired,
  handleFirstTimeSetup,
  requiresAuth,
  createUnauthorizedResponse
} from '../../src/utils/auth.js';

// ==================== Mock KV Storage ====================

/**
 * 模拟 Cloudflare KV 存储
 */
class MockKV {
  constructor() {
    this.store = new Map();
  }

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (!value) return null;

    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }

  async put(key, value, options = {}) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const keys = Array.from(this.store.keys())
      .filter(key => {
        if (options.prefix) {
          return key.startsWith(options.prefix);
        }
        return true;
      })
      .map(name => ({ name }));

    return {
      keys,
      list_complete: true,
      cursor: null
    };
  }

  clear() {
    this.store.clear();
  }
}

// ==================== 测试辅助函数 ====================

/**
 * 创建 Mock Request
 */
function createMockRequest({
  method = 'GET',
  pathname = '/',
  headers = {},
  body = null,
  cookies = {}
} = {}) {
  const url = `https://example.com${pathname}`;
  const requestHeaders = new Headers({
    'Host': 'example.com',
    'Origin': 'https://example.com',
    ...headers
  });

  // Add cookies
  if (Object.keys(cookies).length > 0) {
    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
    requestHeaders.set('Cookie', cookieString);
  }

  const init = {
    method,
    headers: requestHeaders
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    init.body = JSON.stringify(body);
    requestHeaders.set('Content-Type', 'application/json');
  }

  return new Request(url, init);
}

/**
 * 创建 Mock Environment
 */
function createMockEnv(kvStore = null) {
  return {
    SECRETS_KV: kvStore || new MockKV(),
    LOG_LEVEL: 'ERROR' // 减少测试日志噪音
  };
}

/**
 * 从 Response 中提取 Cookie
 */
function extractCookie(response, cookieName) {
  const setCookieHeader = response.headers.get('Set-Cookie');
  if (!setCookieHeader) return null;

  const cookies = setCookieHeader.split(', ').map(c => c.trim());
  for (const cookie of cookies) {
    const [nameValue] = cookie.split(';');
    const [name, value] = nameValue.split('=');
    if (name === cookieName) {
      return value;
    }
  }
  return null;
}

/**
 * 从 Response 中提取 JSON body
 */
async function getResponseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

// ==================== 测试套件 ====================

describe('Auth.js Integration Tests', () => {

  describe('首次设置流程集成', () => {
    let kvStore;
    let env;

    beforeEach(() => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);
    });

    it('应该检测到需要首次设置', async () => {
      const setupRequired = await checkIfSetupRequired(env);
      expect(setupRequired).toBe(true);
    });

    it('应该完成首次设置并返回JWT token', async () => {
      const password = 'SecurePassword123!';
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password, confirmPassword: password }
      });

      const response = await handleFirstTimeSetup(request, env);
      expect(response.status).toBe(200);

      const data = await getResponseJson(response);
      expect(data.success).toBe(true);
      expect(data.message).toContain('设置成功');

      // 验证密码已保存到KV
      const storedHash = await kvStore.get('user_password');
      expect(storedHash).toBeDefined();
      expect(storedHash).toContain('$'); // salt$hash格式

      // 验证 Cookie 头包含 token
      const setCookieHeader = response.headers.get('Set-Cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('auth_token=');

      // 验证密码正确 - 通过尝试登录
      const loginRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: password }
      });
      const loginResponse = await handleLogin(loginRequest, env);
      expect(loginResponse.status).toBe(200);

      // 验证不再需要设置
      const setupRequired = await checkIfSetupRequired(env);
      expect(setupRequired).toBe(false);
    });

    it('应该拒绝弱密码', async () => {
      const weakPasswords = [
        'short',           // 太短
        'alllowercase1',   // 缺少大写
        'ALLUPPERCASE1',   // 缺少小写
        'NoNumbers!',      // 缺少数字
        'NoSpecial123'     // 缺少特殊字符
      ];

      for (const password of weakPasswords) {
        const request = createMockRequest({
          method: 'POST',
          pathname: '/api/setup',
          body: { password, confirmPassword: password }
        });

        const response = await handleFirstTimeSetup(request, env);
        expect(response.status).toBe(400);

        const data = await getResponseJson(response);
        expect(data).toBeDefined();
        expect(data.error).toBeDefined();
      }
    });

    it('应该在已设置后拒绝重复设置', async () => {
      // 第一次设置
      const password1 = 'FirstPassword123!';
      const request1 = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: password1, confirmPassword: password1 }
      });
      await handleFirstTimeSetup(request1, env);

      // 尝试再次设置
      const password2 = 'SecondPassword456!';
      const request2 = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: password2, confirmPassword: password2 }
      });

      const response2 = await handleFirstTimeSetup(request2, env);
      expect(response2.status).toBeGreaterThanOrEqual(400);

      const data = await getResponseJson(response2);
      expect(data.error).toBeDefined();
    });
  });

  describe('登录流程集成', () => {
    let kvStore;
    let env;
    const testPassword = 'TestPassword123!';

    beforeEach(async () => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);

      // 预先通过首次设置来配置密码
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: testPassword, confirmPassword: testPassword }
      });
      await handleFirstTimeSetup(setupRequest, env);
    });

    it('应该使用正确密码成功登录并返回HttpOnly cookie', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword }
      });

      const response = await handleLogin(request, env);
      expect(response.status).toBe(200);

      const data = await getResponseJson(response);
      expect(data.success).toBe(true);

      // 验证 Cookie
      const setCookieHeader = response.headers.get('Set-Cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('auth_token=');
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('Secure');
      expect(setCookieHeader).toContain('SameSite=Strict');

      // 验证 token 有效 - 通过使用它访问受保护资源
      const tokenMatch = setCookieHeader.match(/auth_token=([^;]+)/);
      const token = tokenMatch ? tokenMatch[1] : null;
      expect(token).toBeDefined();

      const authRequest = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: token }
      });
      const isAuthorized = await verifyAuth(authRequest, env);
      expect(isAuthorized).toBe(true);
    });

    it('应该拒绝错误密码', async () => {
      const wrongPassword = 'WrongPassword123!';
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: wrongPassword }
      });

      const response = await handleLogin(request, env);
      expect(response.status).toBe(401);

      const data = await getResponseJson(response);
      expect(data.message).toContain('密码错误');
    });

    it('应该拒绝缺少密码的请求', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: {}
      });

      const response = await handleLogin(request, env);
      expect(response.status).toBe(400);

      const data = await getResponseJson(response);
      expect(data.message).toContain('密码');
    });

    it('应该在多次失败后触发 rate limiting', async () => {
      // 清空 rate limit 计数器
      const clientIP = '127.0.0.1';

      // 尝试6次错误登录（rate limit是5次/分钟）
      for (let i = 0; i < 6; i++) {
        const request = createMockRequest({
          method: 'POST',
          pathname: '/api/login',
          body: { credential: 'WrongPassword123!' },
          headers: {
            'CF-Connecting-IP': clientIP
          }
        });

        const response = await handleLogin(request, env);

        if (i < 5) {
          // 前5次应该返回401（密码错误）
          expect(response.status).toBe(401);
        } else {
          // 第6次应该被 rate limit 阻止
          expect(response.status).toBe(429);
          const data = await getResponseJson(response);
          expect(data.error).toContain('请求过于频繁');
        }
      }
    });
  });

  describe('认证中间件集成 (verifyAuth)', () => {
    let kvStore;
    let env;
    const testPassword = 'TestPassword123!';
    let validToken;

    beforeEach(async () => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);

      // 预先通过首次设置来配置密码
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: testPassword, confirmPassword: testPassword }
      });
      await handleFirstTimeSetup(setupRequest, env);

      // 通过登录获取有效 token
      const loginRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword }
      });
      const loginResponse = await handleLogin(loginRequest, env);
      const loginData = await getResponseJson(loginResponse);
      // 从 Cookie 头提取 token
      const setCookieHeader = loginResponse.headers.get('Set-Cookie');
      const tokenMatch = setCookieHeader?.match(/auth_token=([^;]+)/);
      validToken = tokenMatch ? tokenMatch[1] : null;
    });

    it('应该接受有效的 Cookie token', async () => {
      const request = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: validToken }
      });

      const isAuthorized = await verifyAuth(request, env);
      expect(isAuthorized).toBe(true);
    });

    it('应该接受有效的 Authorization header token', async () => {
      const request = createMockRequest({
        pathname: '/api/secrets',
        headers: {
          'Authorization': `Bearer ${validToken}`
        }
      });

      const isAuthorized = await verifyAuth(request, env);
      expect(isAuthorized).toBe(true);
    });

    it('应该拒绝过期或无效的 token', async () => {
      // 使用明显无效的token格式
      const invalidToken = 'invalid.token.signature';

      const request = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: invalidToken }
      });

      const isAuthorized = await verifyAuth(request, env);
      expect(isAuthorized).toBe(false);
    });

    it('应该拒绝缺少 token 的请求', async () => {
      const request = createMockRequest({
        pathname: '/api/secrets'
        // No cookies or Authorization header
      });

      const isAuthorized = await verifyAuth(request, env);
      expect(isAuthorized).toBe(false);
    });

    it('应该拒绝格式错误的 token', async () => {
      const malformedTokens = [
        'not-a-jwt',
        'header.payload', // 缺少签名
        'a.b.c.d', // 太多部分
        '', // 空字符串
      ];

      for (const token of malformedTokens) {
        const request = createMockRequest({
          pathname: '/api/secrets',
          cookies: { auth_token: token }
        });

        const isAuthorized = await verifyAuth(request, env);
        expect(isAuthorized).toBe(false);
      }
    });
  });

  describe('Token 刷新流程集成', () => {
    let kvStore;
    let env;
    const testPassword = 'TestPassword123!';
    let validToken;

    beforeEach(async () => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);

      // 预先通过首次设置来配置密码
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: testPassword, confirmPassword: testPassword }
      });
      await handleFirstTimeSetup(setupRequest, env);

      // 通过登录获取有效 token
      const loginRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword }
      });
      const loginResponse = await handleLogin(loginRequest, env);
      const loginData = await getResponseJson(loginResponse);
      // 从 Cookie 头提取 token
      const setCookieHeader = loginResponse.headers.get('Set-Cookie');
      const tokenMatch = setCookieHeader?.match(/auth_token=([^;]+)/);
      validToken = tokenMatch ? tokenMatch[1] : null;
    });

    it('应该使用有效 token 刷新并获得新 token', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token',
        cookies: { auth_token: validToken }
      });

      const response = await handleRefreshToken(request, env);
      expect(response.status).toBe(200);

      const data = await getResponseJson(response);
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.token).not.toBe(validToken); // 新token应该不同

      // 验证新 token 有效 - 通过使用它访问受保护资源
      const authRequest = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: data.token }
      });
      const isAuthorized = await verifyAuth(authRequest, env);
      expect(isAuthorized).toBe(true);
    });

    it('应该拒绝无效 token 的刷新', async () => {
      // 使用无效token
      const invalidToken = 'invalid.token.here';

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token',
        cookies: { auth_token: invalidToken }
      });

      const response = await handleRefreshToken(request, env);
      expect(response.status).toBe(401);

      const data = await getResponseJson(response);
      expect(data.message).toContain('JWT');
    });

    it('应该拒绝缺少 token 的刷新请求', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token'
        // No token
      });

      const response = await handleRefreshToken(request, env);
      expect(response.status).toBe(401);

      const data = await getResponseJson(response);
      expect(data.message).toContain('认证');
    });

    it('应该刷新后的 token 包含新的过期时间', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token',
        cookies: { auth_token: validToken }
      });

      const response = await handleRefreshToken(request, env);
      const data = await getResponseJson(response);
      const newToken = data.token;

      // 解析新 token 的过期时间
      const parts = newToken.split('.');
      const payload = JSON.parse(atob(parts[1]));

      // 验证新的过期时间应该在未来
      const expiryTime = payload.exp * 1000; // 转为毫秒
      const now = Date.now();
      expect(expiryTime).toBeGreaterThan(now);

      // 验证过期时间约为30天后
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const timeDiff = expiryTime - now;
      expect(timeDiff).toBeGreaterThan(thirtyDaysMs * 0.9); // 至少27天
      expect(timeDiff).toBeLessThan(thirtyDaysMs * 1.1); // 最多33天
    });
  });

  describe('路由认证集成 (requiresAuth)', () => {
    it('应该正确识别公开路由', () => {
      const publicRoutes = [
        '/',
        '/api/login',
        '/api/refresh-token',
        '/api/setup',
        '/setup',
        '/manifest.json',
        '/sw.js',
        '/icon-192.png',
        '/icon-512.png',
        '/otp',
        '/otp/JBSWY3DPEHPK3PXP'
      ];

      for (const route of publicRoutes) {
        expect(requiresAuth(route)).toBe(false);
      }
    });

    it('应该正确识别受保护路由', () => {
      const protectedRoutes = [
        '/api/secrets',
        '/api/secrets/123',
        '/api/secrets/batch',
        '/api/backup',
        '/api/backup/restore',
        '/api/backup/export/backup-123',
        '/admin',
        '/settings'
      ];

      for (const route of protectedRoutes) {
        expect(requiresAuth(route)).toBe(true);
      }
    });
  });

  describe('未授权响应集成 (createUnauthorizedResponse)', () => {
    it('应该返回标准的401响应', async () => {
      const request = createMockRequest({ pathname: '/api/secrets' });
      const response = createUnauthorizedResponse(null, request);

      expect(response.status).toBe(401);

      const data = await getResponseJson(response);
      expect(data.error).toContain('身份验证失败');
    });

    it('应该支持自定义错误消息', async () => {
      const customMessage = '自定义认证错误';
      const request = createMockRequest({ pathname: '/api/secrets' });
      const response = createUnauthorizedResponse(customMessage, request);

      expect(response.status).toBe(401);

      const data = await getResponseJson(response);
      expect(data.error).toContain('身份验证失败');
      expect(data.message).toBe(customMessage);
    });

    it('应该包含安全响应头', () => {
      const request = createMockRequest({ pathname: '/api/secrets' });
      const response = createUnauthorizedResponse(null, request);

      // 验证 CORS headers
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();

      // 验证内容类型
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  describe('完整认证流程端到端测试', () => {
    let kvStore;
    let env;
    const testPassword = 'EndToEndTest123!';

    beforeEach(() => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);
    });

    it('完整流程：首次设置 → 登录 → 访问受保护资源 → 刷新token', async () => {
      // Step 1: 首次设置
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: testPassword, confirmPassword: testPassword }
      });

      const setupResponse = await handleFirstTimeSetup(setupRequest, env);
      expect(setupResponse.status).toBe(200);

      // Step 2: 登录
      const loginRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword }
      });

      const loginResponse = await handleLogin(loginRequest, env);
      expect(loginResponse.status).toBe(200);

      const loginData = await getResponseJson(loginResponse);
      const setCookieHeader = loginResponse.headers.get('Set-Cookie');
      const tokenMatch = setCookieHeader?.match(/auth_token=([^;]+)/);
      const token = tokenMatch ? tokenMatch[1] : null;
      expect(token).toBeDefined();

      // Step 3: 使用 token 访问受保护资源
      const authRequest = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: token }
      });

      const isAuthorized = await verifyAuth(authRequest, env);
      expect(isAuthorized).toBe(true);

      // Step 4: 刷新 token
      const refreshRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token',
        cookies: { auth_token: token }
      });

      const refreshResponse = await handleRefreshToken(refreshRequest, env);
      expect(refreshResponse.status).toBe(200);

      const refreshData = await getResponseJson(refreshResponse);
      const newToken = refreshData.token;

      // Step 5: 使用新 token 访问受保护资源
      const newAuthRequest = createMockRequest({
        pathname: '/api/secrets',
        cookies: { auth_token: newToken }
      });

      const isStillAuthorized = await verifyAuth(newAuthRequest, env);
      expect(isStillAuthorized).toBe(true);
    });

    it('完整流程：登录失败 → Rate Limiting → 等待 → 成功登录', async () => {
      // 预先通过首次设置来配置密码
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: testPassword, confirmPassword: testPassword }
      });
      await handleFirstTimeSetup(setupRequest, env);

      const clientIP = '192.168.1.100';

      // Step 1: 连续5次错误登录
      for (let i = 0; i < 5; i++) {
        const request = createMockRequest({
          method: 'POST',
          pathname: '/api/login',
          body: { credential: 'WrongPassword123!' },
          headers: { 'CF-Connecting-IP': clientIP }
        });

        const response = await handleLogin(request, env);
        expect(response.status).toBe(401);
      }

      // Step 2: 第6次应该被 rate limit
      const rateLimitedRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword },
        headers: { 'CF-Connecting-IP': clientIP }
      });

      const rateLimitedResponse = await handleLogin(rateLimitedRequest, env);
      expect(rateLimitedResponse.status).toBe(429);

      // Step 3: 清空 rate limit 计数器（模拟时间过去）
      // 清理两个版本的 rate limit 数据（固定窗口和滑动窗口）
      await kvStore.delete(`ratelimit:${clientIP}`);      // v1 固定窗口
      await kvStore.delete(`ratelimit:v2:${clientIP}`);   // v2 滑动窗口

      // Step 4: 使用正确密码登录
      const successRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: testPassword },
        headers: { 'CF-Connecting-IP': clientIP }
      });

      const successResponse = await handleLogin(successRequest, env);
      expect(successResponse.status).toBe(200);

      const data = await getResponseJson(successResponse);
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
    });
  });

  describe('边界条件和错误处理', () => {
    let kvStore;
    let env;

    beforeEach(() => {
      kvStore = new MockKV();
      env = createMockEnv(kvStore);
    });

    it('应该处理KV存储失败', async () => {
      // 模拟KV存储失败
      const mockEnv = {
        SECRETS_KV: {
          get: vi.fn().mockRejectedValue(new Error('KV Storage Error'))
        },
        LOG_LEVEL: 'ERROR'
      };

      // checkIfSetupRequired应该安全处理KV失败
      let isSetupRequired;
      try {
        isSetupRequired = await checkIfSetupRequired(mockEnv);
      } catch (error) {
        // 如果抛出错误，这也是可以接受的行为
        isSetupRequired = true;
      }

      // 应该假设需要设置（安全默认）或抛出错误
      expect(isSetupRequired).toBe(true);
    });

    it('应该处理密码哈希验证失败', async () => {
      // 存储一个无效的哈希格式
      await kvStore.put('user_password', 'invalid-hash-format');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { credential: 'AnyPassword123!' }
      });

      const response = await handleLogin(request, env);
      // 无效哈希格式会导致验证失败，返回401或500
      expect([401, 500]).toContain(response.status);
    });

    it('应该处理JWT验证中的各种异常', async () => {
      // 先设置有效密码
      const setupRequest = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: 'ValidPassword123!', confirmPassword: 'ValidPassword123!' }
      });
      await handleFirstTimeSetup(setupRequest, env);

      const invalidTokens = [
        null,
        undefined,
        '',
        'not.a.jwt',
        'a.b', // 缺少部分
      ];

      for (const token of invalidTokens) {
        const request = createMockRequest({
          pathname: '/api/secrets',
          cookies: { auth_token: token || '' }
        });

        const isAuthorized = await verifyAuth(request, env);
        expect(isAuthorized).toBe(false);
      }
    });

    it('应该处理JSON解析错误', async () => {
      const request = new Request('https://example.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{{'
      });

      const response = await handleLogin(request, env);
      // JSON解析错误可能返回400或500
      expect([400, 500]).toContain(response.status);

      const data = await getResponseJson(response);
      expect(data.error).toBeDefined();
    });
  });
});
