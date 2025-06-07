/**
 * Router Handler 路由处理器测试
 * 测试请求路由和分发逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequest, handleCORS } from '../../src/router/handler.js';

// ==================== Mock 模块 ====================

// Mock API handlers
vi.mock('../../src/api/secrets/index.js', () => ({
  handleGetSecrets: vi.fn(async (env) => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  handleAddSecret: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 201 })),
  handleUpdateSecret: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
  handleDeleteSecret: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
  handleGenerateOTP: vi.fn(async (secret, request) => new Response(JSON.stringify({ token: '123456' }), { status: 200 })),
  handleBatchAddSecrets: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
  handleBackupSecrets: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
  handleGetBackups: vi.fn(async (request, env) => new Response(JSON.stringify({ backups: [] }), { status: 200 })),
  handleRestoreBackup: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
  handleExportBackup: vi.fn(async (request, env, key) => new Response(JSON.stringify({ data: {} }), { status: 200 }))
}));

// Mock UI generators
vi.mock('../../src/ui/page.js', () => ({
  createMainPage: vi.fn(async () => new Response('<html>Main Page</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
}));

vi.mock('../../src/ui/setupPage.js', () => ({
  createSetupPage: vi.fn(async () => new Response('<html>Setup Page</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
}));

vi.mock('../../src/ui/manifest.js', () => ({
  createManifest: vi.fn((request) => new Response(JSON.stringify({ name: 'Test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  createDefaultIcon: vi.fn((size) => new Response('icon', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }))
}));

vi.mock('../../src/ui/serviceworker.js', () => ({
  createServiceWorker: vi.fn(() => new Response('// Service Worker', { status: 200, headers: { 'Content-Type': 'application/javascript' } }))
}));

// Mock authentication
vi.mock('../../src/utils/auth.js', () => ({
  verifyAuth: vi.fn(async (request, env) => true),
  verifyAuthWithDetails: vi.fn(async (request, env) => ({ valid: true, token: 'test-token' })),
  requiresAuth: vi.fn((pathname) => {
    // Public routes
    const publicPaths = ['/', '/api/login', '/api/refresh-token', '/api/setup', '/setup', '/manifest.json', '/sw.js', '/icon-192.png', '/icon-512.png'];
    if (publicPaths.includes(pathname)) return false;
    if (pathname.startsWith('/otp')) return false;
    return true;
  }),
  createUnauthorizedResponse: vi.fn((message, request) => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
  handleLogin: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true, token: 'test-token' }), { status: 200 })),
  handleRefreshToken: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true, token: 'new-token' }), { status: 200 })),
  checkIfSetupRequired: vi.fn(async (env) => false),
  handleFirstTimeSetup: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 }))
}));

// Mock response utilities
vi.mock('../../src/utils/response.js', () => ({
  createErrorResponse: vi.fn((error, message, status = 500, request = null) => {
    return new Response(
      JSON.stringify({ error, message, timestamp: new Date().toISOString() }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  })
}));

// Mock security
vi.mock('../../src/utils/security.js', () => ({
  createPreflightResponse: vi.fn((request) => {
    if (request.method === 'OPTIONS' && request.headers.get('Access-Control-Request-Method')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
    return null;
  })
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn((env) => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

// ==================== Mock 工具 ====================

/**
 * 创建 Mock Request
 */
function createMockRequest({
  method = 'GET',
  pathname = '/',
  origin = 'https://example.com',
  headers = {},
  body = null
} = {}) {
  const url = `${origin}${pathname}`;
  const requestHeaders = new Headers({
    'Host': 'example.com',
    'Origin': origin,
    ...headers
  });

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
function createMockEnv() {
  return {
    SECRETS_KV: {
      get: vi.fn(async (key) => null),
      put: vi.fn(async (key, value) => {}),
      delete: vi.fn(async (key) => {}),
      list: vi.fn(async () => ({ keys: [] }))
    },
    ENCRYPTION_KEY: 'test-encryption-key',
    LOG_LEVEL: 'ERROR'
  };
}

// ==================== 测试套件 ====================

describe('Router Handler', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleRequest - 首次设置流程', () => {
    it('应该在需要设置时渲染设置页面', async () => {
      const { checkIfSetupRequired } = await import('../../src/utils/auth.js');
      checkIfSetupRequired.mockResolvedValueOnce(true);

      const request = createMockRequest({ pathname: '/setup' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('Setup Page');
    });

    it('应该在已完成设置时重定向到首页', async () => {
      const { checkIfSetupRequired } = await import('../../src/utils/auth.js');
      checkIfSetupRequired.mockResolvedValueOnce(false);

      const request = createMockRequest({ pathname: '/setup' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('/');
    });

    it('应该处理首次设置 API 请求', async () => {
      const { handleFirstTimeSetup } = await import('../../src/utils/auth.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/setup',
        body: { password: 'TestPassword123!' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleFirstTimeSetup).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该在需要设置时重定向根路径到 /setup', async () => {
      const { checkIfSetupRequired } = await import('../../src/utils/auth.js');
      checkIfSetupRequired.mockResolvedValueOnce(true);

      const request = createMockRequest({ pathname: '/' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('/setup');
    });
  });

  describe('handleRequest - 认证检查', () => {
    it('认证成功后应该允许访问受保护路由', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      verifyAuthWithDetails.mockResolvedValueOnce({ valid: true, token: 'test-token' });
      requiresAuth.mockReturnValueOnce(true);

      const request = createMockRequest({ pathname: '/api/secrets' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(verifyAuthWithDetails).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('认证失败时应该返回 401', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      verifyAuthWithDetails.mockResolvedValueOnce({ valid: false });
      requiresAuth.mockReturnValueOnce(true);

      const env = createMockEnv();
      env.SECRETS_KV.get.mockResolvedValueOnce('hashed-password'); // 有密码

      const request = createMockRequest({ pathname: '/api/secrets' });

      const response = await handleRequest(request, env);

      expect(response.status).toBe(401);
    });

    it('未配置 KV 存储时应该返回 503', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      verifyAuthWithDetails.mockResolvedValueOnce({ valid: false });
      requiresAuth.mockReturnValueOnce(true);

      const env = { SECRETS_KV: null }; // 未配置 KV

      const request = createMockRequest({ pathname: '/api/secrets' });

      const response = await handleRequest(request, env);

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toContain('服务未配置');
    });

    it('未设置密码时应该返回 503 并提示访问 /setup', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      verifyAuthWithDetails.mockResolvedValueOnce({ valid: false });
      requiresAuth.mockReturnValueOnce(true);

      const env = createMockEnv();
      env.SECRETS_KV.get.mockResolvedValueOnce(null); // 无密码

      const request = createMockRequest({ pathname: '/api/secrets' });

      const response = await handleRequest(request, env);

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toContain('未设置密码');
      expect(body.message).toContain('/setup');
    });

    it('公开路由应该不需要认证', async () => {
      const { requiresAuth } = await import('../../src/utils/auth.js');
      requiresAuth.mockReturnValueOnce(false);

      const request = createMockRequest({ pathname: '/' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe('handleRequest - 静态资源路由', () => {
    it('应该渲染主页面', async () => {
      const request = createMockRequest({ pathname: '/' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('Main Page');
    });

    it('应该处理空路径', async () => {
      const request = createMockRequest({ pathname: '' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
    });

    it('应该返回 PWA manifest', async () => {
      const request = createMockRequest({ pathname: '/manifest.json' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('应该返回 Service Worker', async () => {
      const request = createMockRequest({ pathname: '/sw.js' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('javascript');
    });

    it('应该返回 192px PWA 图标', async () => {
      const request = createMockRequest({ pathname: '/icon-192.png' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
    });

    it('应该返回 512px PWA 图标', async () => {
      const request = createMockRequest({ pathname: '/icon-512.png' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe('handleRequest - 登录和 Token 刷新', () => {
    it('应该处理登录请求', async () => {
      const { handleLogin } = await import('../../src/utils/auth.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/login',
        body: { password: 'test' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleLogin).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该处理 Token 刷新请求', async () => {
      const { handleRefreshToken } = await import('../../src/utils/auth.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/refresh-token'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleRefreshToken).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });
  });

  describe('handleRequest - API 路由分发', () => {
    it('应该处理 GET /api/secrets', async () => {
      const { handleGetSecrets } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({ pathname: '/api/secrets' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleGetSecrets).toHaveBeenCalledWith(env);
      expect(response.status).toBe(200);
    });

    it('应该处理 POST /api/secrets', async () => {
      const { handleAddSecret } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/secrets',
        body: { name: 'Test', secret: 'JBSWY3DPEHPK3PXP' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleAddSecret).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(201);
    });

    it('应该拒绝 /api/secrets 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'PATCH',
        pathname: '/api/secrets'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
      const body = await response.json();
      expect(body.error).toContain('方法不允许');
    });

    it('应该处理 POST /api/secrets/batch', async () => {
      const { handleBatchAddSecrets } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/secrets/batch',
        body: [{ name: 'Test1' }, { name: 'Test2' }]
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleBatchAddSecrets).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该拒绝 /api/secrets/batch 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'GET',
        pathname: '/api/secrets/batch'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('应该处理 PUT /api/secrets/{id}', async () => {
      const { handleUpdateSecret } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'PUT',
        pathname: '/api/secrets/test-id',
        body: { name: 'Updated' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleUpdateSecret).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该处理 DELETE /api/secrets/{id}', async () => {
      const { handleDeleteSecret } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'DELETE',
        pathname: '/api/secrets/test-id'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleDeleteSecret).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该拒绝 /api/secrets/{id} 缺少 ID', async () => {
      const request = createMockRequest({
        method: 'PUT',
        pathname: '/api/secrets/'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('无效路径');
    });

    it('应该拒绝 /api/secrets/{id} 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'GET',
        pathname: '/api/secrets/test-id'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('应该处理 POST /api/backup', async () => {
      const { handleBackupSecrets } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/backup'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleBackupSecrets).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该处理 GET /api/backup', async () => {
      const { handleGetBackups } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({ pathname: '/api/backup' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleGetBackups).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该拒绝 /api/backup 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'DELETE',
        pathname: '/api/backup'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('应该处理 POST /api/backup/restore', async () => {
      const { handleRestoreBackup } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/backup/restore',
        body: { backupKey: 'backup-123' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleRestoreBackup).toHaveBeenCalledWith(request, env);
      expect(response.status).toBe(200);
    });

    it('应该拒绝 /api/backup/restore 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'GET',
        pathname: '/api/backup/restore'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('应该处理 GET /api/backup/export/{key}', async () => {
      const { handleExportBackup } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({
        pathname: '/api/backup/export/backup-123'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleExportBackup).toHaveBeenCalledWith(request, env, 'backup-123');
      expect(response.status).toBe(200);
    });

    it('应该拒绝 /api/backup/export/{key} 的不支持方法', async () => {
      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/backup/export/backup-123'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(405);
    });

    it('应该返回 404 对未知 API 路径', async () => {
      const request = createMockRequest({ pathname: '/api/unknown' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('API未找到');
    });
  });

  describe('handleRequest - OTP 生成路由', () => {
    it('应该处理 /otp（无 secret）', async () => {
      const { handleGenerateOTP } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({ pathname: '/otp' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleGenerateOTP).toHaveBeenCalledWith('', request);
      expect(response.status).toBe(200);
    });

    it('应该处理 /otp/{secret}', async () => {
      const { handleGenerateOTP } = await import('../../src/api/secrets/index.js');

      const request = createMockRequest({ pathname: '/otp/JBSWY3DPEHPK3PXP' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleGenerateOTP).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', request);
      expect(response.status).toBe(200);
    });

    it('应该处理带参数的 /otp/{secret}', async () => {
      const { handleGenerateOTP } = await import('../../src/api/secrets/index.js');

      // 查询参数在 URL 中，不在 pathname 中
      const request = createMockRequest({ pathname: '/otp/JBSWY3DPEHPK3PXP' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      // 路由器只从 pathname 提取 secret，查询参数通过 request 传递
      expect(handleGenerateOTP).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', request);
      expect(response.status).toBe(200);
    });
  });

  describe('handleRequest - 404 和错误处理', () => {
    it('应该返回 404 对未知路径', async () => {
      const request = createMockRequest({ pathname: '/unknown-path' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('页面未找到');
    });

    it('应该捕获并处理异常', async () => {
      const { createMainPage } = await import('../../src/ui/page.js');
      createMainPage.mockRejectedValueOnce(new Error('Test error'));

      const request = createMockRequest({ pathname: '/' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain('服务器错误');
    });

    it('应该记录错误日志', async () => {
      const { getLogger } = await import('../../src/utils/logger.js');
      const { createMainPage } = await import('../../src/ui/page.js');

      // 创建一个持久的 mock logger
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      };
      getLogger.mockReturnValue(mockLogger);

      createMainPage.mockRejectedValueOnce(new Error('Test error'));

      const request = createMockRequest({ pathname: '/' });
      const env = createMockEnv();

      await handleRequest(request, env);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleCORS', () => {
    it('应该返回 CORS 预检响应', () => {
      const request = createMockRequest({
        method: 'OPTIONS',
        pathname: '/api/secrets',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = handleCORS(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    });

    it('非预检请求应该返回 null', () => {
      const request = createMockRequest({ method: 'GET', pathname: '/' });

      const response = handleCORS(request);

      expect(response).toBeNull();
    });

    it('OPTIONS 但缺少 Access-Control-Request-Method 应该返回 null', () => {
      const request = createMockRequest({ method: 'OPTIONS', pathname: '/api/secrets' });

      const response = handleCORS(request);

      expect(response).toBeNull();
    });
  });

  describe('集成测试', () => {
    it('完整的密钥添加流程', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      const { handleAddSecret } = await import('../../src/api/secrets/index.js');

      verifyAuthWithDetails.mockResolvedValueOnce({ valid: true, token: 'test-token' });
      requiresAuth.mockReturnValueOnce(true);

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/secrets',
        body: { name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(verifyAuthWithDetails).toHaveBeenCalled();
      expect(handleAddSecret).toHaveBeenCalled();
      expect(response.status).toBe(201);
    });

    it('完整的备份创建流程', async () => {
      const { verifyAuthWithDetails, requiresAuth } = await import('../../src/utils/auth.js');
      const { handleBackupSecrets } = await import('../../src/api/secrets/index.js');

      verifyAuthWithDetails.mockResolvedValueOnce({ valid: true, token: 'test-token' });
      requiresAuth.mockReturnValueOnce(true);

      const request = createMockRequest({
        method: 'POST',
        pathname: '/api/backup'
      });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(verifyAuthWithDetails).toHaveBeenCalled();
      expect(handleBackupSecrets).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('公开 OTP 路由不需要认证', async () => {
      const { requiresAuth } = await import('../../src/utils/auth.js');
      const { handleGenerateOTP } = await import('../../src/api/secrets/index.js');

      requiresAuth.mockReturnValueOnce(false);

      const request = createMockRequest({ pathname: '/otp/JBSWY3DPEHPK3PXP' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(handleGenerateOTP).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe('边界条件', () => {
    it('应该处理没有 KV 环境的情况', async () => {
      const { requiresAuth, verifyAuthWithDetails } = await import('../../src/utils/auth.js');
      requiresAuth.mockReturnValueOnce(true);
      verifyAuthWithDetails.mockResolvedValueOnce({ valid: false });

      const env = {}; // 没有 SECRETS_KV

      const request = createMockRequest({ pathname: '/api/secrets' });

      const response = await handleRequest(request, env);

      expect(response.status).toBe(503);
    });

    it('应该处理极长的路径', async () => {
      const longPath = '/api/' + 'a'.repeat(10000);
      const request = createMockRequest({ pathname: longPath });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(404);
    });

    it('应该处理 URL 中的特殊字符', async () => {
      const request = createMockRequest({ pathname: '/api/secrets/test%20id%2F123' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      // 应该正确处理 URL 编码
      expect(response).toBeDefined();
    });

    it('应该处理查询参数', async () => {
      const request = createMockRequest({ pathname: '/api/secrets?limit=10&offset=0' });
      const env = createMockEnv();

      const response = await handleRequest(request, env);

      expect(response.status).toBe(200);
    });
  });

  describe('性能测试', () => {
    it('路由匹配应该快速执行', async () => {
      const request = createMockRequest({ pathname: '/api/secrets' });
      const env = createMockEnv();

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await handleRequest(request, env);
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(500); // 100 次路由 < 500ms
    });
  });
});
