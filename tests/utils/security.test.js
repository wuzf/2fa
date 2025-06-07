/**
 * Security 安全配置模块测试
 * 测试 CORS、CSP、预检请求等安全功能
 */

import { describe, it, expect } from 'vitest';
import {
  getAllowedOrigin,
  getSecurityHeaders,
  getCorsPreflightHeaders,
  isPreflightRequest,
  createPreflightResponse,
  mergeSecurityHeaders,
  getCSPPolicy
} from '../../src/utils/security.js';

// ==================== Mock 工具 ====================

/**
 * 创建 Mock Request
 * @param {Object} options - 配置选项
 * @param {string} options.host - Host header
 * @param {string} options.origin - Origin header
 * @param {string} options.method - HTTP 方法
 * @param {Object} options.headers - 额外的 headers
 */
function createMockRequest({
  host = 'example.com',
  origin = null,
  method = 'GET',
  headers = {}
} = {}) {
  const requestHeaders = new Headers({
    'Host': host,
    ...headers
  });

  if (origin) {
    requestHeaders.set('Origin', origin);
  }

  return {
    method,
    headers: requestHeaders,
    url: `https://${host}/api/test`
  };
}

// ==================== 测试套件 ====================

describe('Security Utils', () => {

  describe('getAllowedOrigin', () => {
    it('同源请求应该返回 Origin', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('https://example.com');
    });

    it('同源请求（HTTP）应该返回 Origin', () => {
      const request = createMockRequest({
        host: 'localhost:8787',
        origin: 'http://localhost:8787'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('http://localhost:8787');
    });

    it('不同源请求应该返回 null', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://evil.com'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBeNull();
    });

    it('没有 Origin header 应该返回 null', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: null
      });

      const result = getAllowedOrigin(request);
      expect(result).toBeNull();
    });

    it('localhost 不同端口应该允许', () => {
      const request = createMockRequest({
        host: 'localhost:8787',
        origin: 'http://localhost:3000'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('http://localhost:3000');
    });

    it('127.0.0.1 不同端口应该允许', () => {
      const request = createMockRequest({
        host: '127.0.0.1:8787',
        origin: 'http://127.0.0.1:3000'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('http://127.0.0.1:3000');
    });

    it('localhost 和 127.0.0.1 互相应该允许', () => {
      const request1 = createMockRequest({
        host: 'localhost:8787',
        origin: 'http://127.0.0.1:3000'
      });

      const result1 = getAllowedOrigin(request1);
      expect(result1).toBe('http://127.0.0.1:3000');

      const request2 = createMockRequest({
        host: '127.0.0.1:8787',
        origin: 'http://localhost:3000'
      });

      const result2 = getAllowedOrigin(request2);
      expect(result2).toBe('http://localhost:3000');
    });

    it('子域名应该被拒绝', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://sub.example.com'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBeNull();
    });

    it('同 Host 的 HTTP 协议应该被允许（本地开发支持）', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'http://example.com'  // HTTP 也被允许
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('http://example.com');
    });

    it('没有 Host header 应该返回 null', () => {
      const request = {
        method: 'GET',
        headers: new Headers({
          'Origin': 'https://example.com'
        })
      };

      const result = getAllowedOrigin(request);
      expect(result).toBeNull();
    });
  });

  describe('getSecurityHeaders', () => {
    it('应该返回完整的安全头（默认配置）', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getSecurityHeaders(request);

      // CORS headers
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['Vary']).toBe('Origin');

      // CSP header
      expect(headers['Content-Security-Policy']).toBeDefined();
      expect(headers['Content-Security-Policy']).toContain("default-src 'self'");

      // Other security headers
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['Permissions-Policy']).toBe('geolocation=(), microphone=(), camera=()');
    });

    it('不同源请求不应该包含 CORS headers', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://evil.com'
      });

      const headers = getSecurityHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
      expect(headers['Vary']).toBeUndefined();

      // 其他安全头应该存在
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Content-Security-Policy']).toBeDefined();
    });

    it('没有 Origin header 不应该包含 CORS headers', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: null
      });

      const headers = getSecurityHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
      expect(headers['Vary']).toBeUndefined();
    });

    it('includeCors: false 不应该包含 CORS headers', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getSecurityHeaders(request, { includeCors: false });

      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();

      // 其他安全头应该存在
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('includeCredentials: false 不应该包含凭据头', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getSecurityHeaders(request, { includeCredentials: false });

      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });

    it('includeCSP: false 不应该包含 CSP header', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getSecurityHeaders(request, { includeCSP: false });

      expect(headers['Content-Security-Policy']).toBeUndefined();

      // 其他安全头应该存在
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    });

    it('应该支持所有选项组合', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getSecurityHeaders(request, {
        includeCors: false,
        includeCredentials: false,
        includeCSP: false
      });

      // 只有基础安全头
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(headers['Content-Security-Policy']).toBeUndefined();
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });
  });

  describe('isPreflightRequest', () => {
    it('OPTIONS + Access-Control-Request-Method 应该识别为预检请求', () => {
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(isPreflightRequest(request)).toBe(true);
    });

    it('OPTIONS 但没有 Access-Control-Request-Method 不是预检请求', () => {
      const request = createMockRequest({
        method: 'OPTIONS'
      });

      expect(isPreflightRequest(request)).toBe(false);
    });

    it('GET 请求不是预检请求', () => {
      const request = createMockRequest({
        method: 'GET',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(isPreflightRequest(request)).toBe(false);
    });

    it('POST 请求不是预检请求', () => {
      const request = createMockRequest({
        method: 'POST'
      });

      expect(isPreflightRequest(request)).toBe(false);
    });
  });

  describe('getCorsPreflightHeaders', () => {
    it('同源预检请求应该返回完整的 CORS 头', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const headers = getCorsPreflightHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['Access-Control-Max-Age']).toBe('86400');
      expect(headers['Vary']).toBe('Origin');
    });

    it('不同源预检请求应该返回空对象', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://evil.com'
      });

      const headers = getCorsPreflightHeaders(request);

      expect(headers).toEqual({});
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('没有 Origin 应该返回空对象', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: null
      });

      const headers = getCorsPreflightHeaders(request);

      expect(headers).toEqual({});
    });
  });

  describe('createPreflightResponse', () => {
    it('有效的预检请求应该返回 204 响应', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com',
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = createPreflightResponse(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('不同源的预检请求应该返回 403', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://evil.com',
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = createPreflightResponse(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(403);
      expect(response.headers.get('Content-Type')).toBe('text/plain');
    });

    it('非预检请求应该返回 null', () => {
      const request = createMockRequest({
        method: 'GET'
      });

      const response = createPreflightResponse(request);

      expect(response).toBeNull();
    });

    it('OPTIONS 但缺少 Access-Control-Request-Method 应该返回 null', () => {
      const request = createMockRequest({
        method: 'OPTIONS'
      });

      const response = createPreflightResponse(request);

      expect(response).toBeNull();
    });
  });

  describe('mergeSecurityHeaders', () => {
    it('应该正确合并安全头和现有 headers', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const existingHeaders = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      };

      const merged = mergeSecurityHeaders(request, existingHeaders);

      // 应该包含安全头
      expect(merged['X-Frame-Options']).toBe('DENY');
      expect(merged['Access-Control-Allow-Origin']).toBe('https://example.com');

      // 应该包含现有 headers
      expect(merged['Content-Type']).toBe('application/json');
      expect(merged['Cache-Control']).toBe('no-cache');
    });

    it('现有 headers 应该优先于安全头', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const existingHeaders = {
        'X-Frame-Options': 'SAMEORIGIN'  // 覆盖默认的 'DENY'
      };

      const merged = mergeSecurityHeaders(request, existingHeaders);

      expect(merged['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('没有现有 headers 应该只返回安全头', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const merged = mergeSecurityHeaders(request);

      expect(merged['X-Frame-Options']).toBe('DENY');
      expect(merged['Access-Control-Allow-Origin']).toBe('https://example.com');
    });

    it('应该支持 options 参数', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const merged = mergeSecurityHeaders(request, {}, { includeCSP: false });

      expect(merged['Content-Security-Policy']).toBeUndefined();
      expect(merged['X-Frame-Options']).toBe('DENY');
    });
  });

  describe('getCSPPolicy', () => {
    it('应该返回完整的 CSP 策略字符串', () => {
      const csp = getCSPPolicy();

      expect(typeof csp).toBe('string');
      expect(csp).toBeTruthy();
    });

    it('CSP 策略应该包含必要的指令', () => {
      const csp = getCSPPolicy();

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src");
      expect(csp).toContain("style-src");
      expect(csp).toContain("img-src");
      expect(csp).toContain("connect-src");
      expect(csp).toContain("font-src");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("upgrade-insecure-requests");
    });

    it('CSP 策略应该允许必要的 CDN 域名', () => {
      const csp = getCSPPolicy();

      expect(csp).toContain('cdn.jsdelivr.net');
      expect(csp).toContain('cdnjs.cloudflare.com');
    });

    it('CSP 策略应该使用分号分隔', () => {
      const csp = getCSPPolicy();

      // 应该包含至少 10 个分号（有多个指令）
      const semicolonCount = (csp.match(/;/g) || []).length;
      expect(semicolonCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('集成测试', () => {
    it('完整的同源请求流程', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com',
        method: 'POST'
      });

      // 1. 检查不是预检请求
      expect(isPreflightRequest(request)).toBe(false);

      // 2. 获取允许的 Origin
      const allowedOrigin = getAllowedOrigin(request);
      expect(allowedOrigin).toBe('https://example.com');

      // 3. 获取安全头
      const headers = getSecurityHeaders(request);
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Content-Security-Policy']).toBeDefined();
    });

    it('完整的预检请求流程', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com',
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'DELETE'
        }
      });

      // 1. 识别为预检请求
      expect(isPreflightRequest(request)).toBe(true);

      // 2. 创建预检响应
      const response = createPreflightResponse(request);
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(204);

      // 3. 验证预检响应头
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('完整的跨域拒绝流程', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://evil.com',
        method: 'POST'
      });

      // 1. Origin 不被允许
      const allowedOrigin = getAllowedOrigin(request);
      expect(allowedOrigin).toBeNull();

      // 2. 安全头中不包含 CORS
      const headers = getSecurityHeaders(request);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();

      // 3. 但仍包含其他安全头
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Content-Security-Policy']).toBeDefined();
    });
  });

  describe('边界条件', () => {
    it('应该处理空的 Host', () => {
      const request = {
        method: 'GET',
        headers: new Headers({
          'Origin': 'https://example.com'
        })
      };

      const result = getAllowedOrigin(request);
      expect(result).toBeNull();
    });

    it('应该处理畸形的 Origin URL', () => {
      const request = createMockRequest({
        host: 'localhost:8787',
        origin: 'not-a-valid-url'
      });

      // 畸形 URL 会导致 new URL() 抛出 TypeError
      // 这是当前实现的行为（在 localhost 特殊处理时解析 URL）
      expect(() => getAllowedOrigin(request)).toThrow(TypeError);
    });

    it('应该处理端口号', () => {
      const request = createMockRequest({
        host: 'example.com:8080',
        origin: 'https://example.com:8080'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('https://example.com:8080');
    });

    it('应该处理 IPv6 地址', () => {
      const request = createMockRequest({
        host: '[::1]:8787',
        origin: 'http://[::1]:8787'
      });

      const result = getAllowedOrigin(request);
      expect(result).toBe('http://[::1]:8787');
    });

    it('mergeSecurityHeaders 应该处理 null existingHeaders', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const merged = mergeSecurityHeaders(request, null);

      expect(merged['X-Frame-Options']).toBe('DENY');
    });

    it('getCSPPolicy 不需要参数', () => {
      expect(() => getCSPPolicy()).not.toThrow();
      const csp = getCSPPolicy();
      expect(csp).toBeTruthy();
    });
  });

  describe('性能测试', () => {
    it('getAllowedOrigin 应该快速执行', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        getAllowedOrigin(request);
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(50); // 1000 次调用 < 50ms
    });

    it('getSecurityHeaders 应该快速执行', () => {
      const request = createMockRequest({
        host: 'example.com',
        origin: 'https://example.com'
      });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        getSecurityHeaders(request);
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // 1000 次调用 < 100ms
    });
  });
});
