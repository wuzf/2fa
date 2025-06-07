/**
 * Response 工具模块测试
 * 测试标准化响应格式和安全头处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createJsonResponse,
  createErrorResponse,
  createSuccessResponse,
  createHtmlResponse
} from '../../src/utils/response.js';

// Mock security.js module
vi.mock('../../src/utils/security.js', () => ({
  getSecurityHeaders: vi.fn((request) => ({
    'Access-Control-Allow-Origin': 'https://example.com',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=()'
  }))
}));

// 创建 Mock Request
function createMockRequest(origin = 'https://example.com') {
  return {
    headers: new Headers({
      'Origin': origin,
      'User-Agent': 'Mozilla/5.0'
    }),
    url: 'https://api.example.com/test'
  };
}

describe('Response Utils', () => {

  describe('createJsonResponse', () => {
    it('应该创建基本的 JSON 响应', async () => {
      const data = { message: 'Hello World' };
      const response = createJsonResponse(data);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('应该使用默认的 200 状态码', async () => {
      const response = createJsonResponse({ test: 'data' });
      expect(response.status).toBe(200);
    });

    it('应该支持自定义状态码', async () => {
      const response = createJsonResponse({ error: 'Not Found' }, 404);
      expect(response.status).toBe(404);
    });

    it('带 request 参数时应该包含安全头', async () => {
      const request = createMockRequest();
      const response = createJsonResponse({ test: 'data' }, 200, request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('不带 request 参数时应该使用默认 CORS 配置', async () => {
      // 导入重置函数（用于测试）
      const { _resetWarningFlag } = await import('../../src/utils/response.js');
      _resetWarningFlag(); // 重置警告标志，确保此测试能触发警告

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const response = createJsonResponse({ test: 'data' });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('createJsonResponse 未提供 request 参数')
      );

      consoleWarnSpy.mockRestore();
    });

    it('应该支持额外的响应头', async () => {
      const additionalHeaders = {
        'X-Custom-Header': 'custom-value',
        'Cache-Control': 'no-cache'
      };

      const response = createJsonResponse(
        { test: 'data' },
        200,
        null,
        additionalHeaders
      );

      expect(response.headers.get('X-Custom-Header')).toBe('custom-value');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('额外的响应头应该优先于安全头', async () => {
      const request = createMockRequest();
      const additionalHeaders = {
        'Access-Control-Allow-Origin': 'https://override.com'
      };

      const response = createJsonResponse(
        { test: 'data' },
        200,
        request,
        additionalHeaders
      );

      // 额外的 headers 优先级更高，应该覆盖安全头
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://override.com');
    });

    it('应该正确序列化复杂对象', async () => {
      const complexData = {
        user: { id: 1, name: 'Test User' },
        items: [1, 2, 3],
        nested: { deep: { value: 'test' } },
        中文: '支持中文',
        emoji: '🚀'
      };

      const response = createJsonResponse(complexData);
      const body = await response.json();

      expect(body).toEqual(complexData);
    });

    it('应该处理 null 和 undefined 数据', async () => {
      const response1 = createJsonResponse(null);
      const body1 = await response1.json();
      expect(body1).toBeNull();

      const response2 = createJsonResponse({ value: undefined });
      const body2 = await response2.json();
      expect(body2).toEqual({}); // JSON.stringify 会移除 undefined 值
    });
  });

  describe('createErrorResponse', () => {
    it('应该创建标准错误响应', async () => {
      const response = createErrorResponse(
        '验证失败',
        '密钥格式不正确'
      );

      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const body = await response.json();
      expect(body.error).toBe('验证失败');
      expect(body.message).toBe('密钥格式不正确');
      expect(body.timestamp).toBeDefined();
    });

    it('应该使用默认的 500 状态码', async () => {
      const response = createErrorResponse('错误', '详细信息');
      expect(response.status).toBe(500);
    });

    it('应该支持自定义状态码', async () => {
      const response = createErrorResponse('未找到', '资源不存在', 404);
      expect(response.status).toBe(404);
    });

    it('timestamp 应该是有效的 ISO 8601 格式', async () => {
      const before = new Date();
      const response = createErrorResponse('错误', '详细信息');
      const after = new Date();

      const body = await response.json();
      const timestamp = new Date(body.timestamp);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('带 request 参数时应该包含安全头', async () => {
      const request = createMockRequest();
      const response = createErrorResponse('错误', '详细信息', 500, request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('应该处理中文错误消息', async () => {
      const response = createErrorResponse(
        '服务器内部错误',
        '数据库连接失败，请稍后重试'
      );

      const body = await response.json();
      expect(body.error).toBe('服务器内部错误');
      expect(body.message).toBe('数据库连接失败，请稍后重试');
    });
  });

  describe('createSuccessResponse', () => {
    it('应该创建标准成功响应', async () => {
      const data = { id: 1, name: 'Test' };
      const response = createSuccessResponse(data, '操作成功');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('操作成功');
      expect(body.data).toEqual(data);
    });

    it('应该固定使用 200 状态码', async () => {
      const response = createSuccessResponse({ test: 'data' }, '成功');
      expect(response.status).toBe(200);
    });

    it('带 request 参数时应该包含安全头', async () => {
      const request = createMockRequest();
      const response = createSuccessResponse(
        { test: 'data' },
        '成功',
        request
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });

    it('应该支持空数据对象', async () => {
      const response = createSuccessResponse({}, '操作完成');
      const body = await response.json();

      expect(body.success).toBe(true);
      expect(body.data).toEqual({});
    });

    it('应该支持数组数据', async () => {
      const data = [1, 2, 3, 4, 5];
      const response = createSuccessResponse(data, '获取列表成功');
      const body = await response.json();

      expect(body.data).toEqual(data);
    });
  });

  describe('createHtmlResponse', () => {
    it('应该创建基本的 HTML 响应', async () => {
      const html = '<html><body>Hello World</body></html>';
      const response = createHtmlResponse(html);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');

      const body = await response.text();
      expect(body).toBe(html);
    });

    it('应该使用默认的 200 状态码', async () => {
      const response = createHtmlResponse('<html></html>');
      expect(response.status).toBe(200);
    });

    it('应该支持自定义状态码', async () => {
      const html = '<html><body>404 Not Found</body></html>';
      const response = createHtmlResponse(html, 404);
      expect(response.status).toBe(404);
    });

    it('带 request 参数时应该包含安全头', async () => {
      const request = createMockRequest();
      const html = '<html><body>Test</body></html>';
      const response = createHtmlResponse(html, 200, request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('不带 request 参数时应该只有 Content-Type 头', async () => {
      const html = '<html><body>Test</body></html>';
      const response = createHtmlResponse(html);

      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('X-Frame-Options')).toBeNull();
    });

    it('应该处理包含中文的 HTML', async () => {
      const html = '<html><body><h1>你好世界</h1><p>测试内容🎉</p></body></html>';
      const response = createHtmlResponse(html);
      const body = await response.text();

      expect(body).toBe(html);
    });

    it('应该处理空 HTML 字符串', async () => {
      const response = createHtmlResponse('');
      const body = await response.text();
      expect(body).toBe('');
    });
  });

  describe('集成测试', () => {
    it('所有响应函数都应该返回 Response 对象', () => {
      const jsonResp = createJsonResponse({ test: 'data' });
      const errorResp = createErrorResponse('错误', '详情');
      const successResp = createSuccessResponse({ test: 'data' }, '成功');
      const htmlResp = createHtmlResponse('<html></html>');

      expect(jsonResp).toBeInstanceOf(Response);
      expect(errorResp).toBeInstanceOf(Response);
      expect(successResp).toBeInstanceOf(Response);
      expect(htmlResp).toBeInstanceOf(Response);
    });

    it('错误响应应该通过 createJsonResponse 实现', async () => {
      const errorResp = createErrorResponse('错误', '详情', 400);

      expect(errorResp.headers.get('Content-Type')).toBe('application/json');

      const body = await errorResp.json();
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
    });

    it('成功响应应该通过 createJsonResponse 实现', async () => {
      const successResp = createSuccessResponse({ id: 1 }, '完成');

      expect(successResp.headers.get('Content-Type')).toBe('application/json');

      const body = await successResp.json();
      expect(body.success).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('应该处理极大的数据对象', async () => {
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          data: 'x'.repeat(100)
        }))
      };

      const response = createJsonResponse(largeData);
      const body = await response.json();

      expect(body.items).toHaveLength(1000);
    });

    it('应该处理极长的错误消息', async () => {
      const longMessage = 'Error: ' + 'x'.repeat(10000);
      const response = createErrorResponse('错误', longMessage);
      const body = await response.json();

      expect(body.message).toBe(longMessage);
    });

    it('应该处理特殊字符', async () => {
      const specialData = {
        quote: '"quoted"',
        backslash: 'path\\to\\file',
        newline: 'line1\nline2',
        unicode: '\u0000\u001f',
        emoji: '😀🎉🚀'
      };

      const response = createJsonResponse(specialData);
      const body = await response.json();

      expect(body.quote).toBe('"quoted"');
      expect(body.emoji).toBe('😀🎉🚀');
    });
  });

  describe('性能测试', () => {
    it('创建 JSON 响应应该很快', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        createJsonResponse({ index: i });
      }

      const end = performance.now();
      expect(end - start).toBeLessThan(200); // 1000 次调用应该在 200ms 内（允许性能波动）
    });

    it('创建错误响应应该很快', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        createErrorResponse('错误', `错误 ${i}`);
      }

      const end = performance.now();
      expect(end - start).toBeLessThan(200); // 1000 次调用应该在 200ms 内（允许性能波动）
    });
  });
});
