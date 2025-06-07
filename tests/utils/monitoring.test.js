/**
 * Monitoring 监控系统测试
 * 测试错误追踪、性能监控、Sentry 集成
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorSeverity,
  MonitoringConfig,
  MonitoringManager,
  ErrorMonitor,
  PerformanceMonitor,
  getMonitoring,
  resetMonitoring,
  monitoring
} from '../../src/utils/monitoring.js';

// ==================== Mock 设置 ====================

// Mock logger module
vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

// ==================== 测试辅助工具 ====================

/**
 * 创建 Mock Sentry 对象
 */
function createMockSentry() {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
    setUser: vi.fn()
  };
}

/**
 * 创建 Mock 环境变量
 */
function createMockEnv(overrides = {}) {
  return {
    SENTRY_DSN: null,
    ENVIRONMENT: 'test',
    VERSION: '1.0.0',
    ERROR_SAMPLE_RATE: '1.0',
    TRACE_SAMPLE_RATE: '0.1',
    ENABLE_PERFORMANCE_MONITORING: 'true',
    SLOW_REQUEST_THRESHOLD: '3000',
    ...overrides
  };
}

/**
 * 创建 Mock Request
 */
function createMockRequest(method = 'GET', url = 'https://example.com/api/test') {
  return {
    method,
    url,
    headers: new Headers({
      'user-agent': 'Test Agent'
    })
  };
}

// ==================== 测试套件 ====================

describe('Monitoring System', () => {

  beforeEach(() => {
    resetMonitoring();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // 清除全局 Sentry
    global.Sentry = undefined;
  });

  afterEach(() => {
    resetMonitoring();
  });

  // ==================== ErrorSeverity 枚举 ====================

  describe('ErrorSeverity 枚举', () => {
    it('应该定义所有严重度级别', () => {
      expect(ErrorSeverity.DEBUG).toBe('debug');
      expect(ErrorSeverity.INFO).toBe('info');
      expect(ErrorSeverity.WARNING).toBe('warning');
      expect(ErrorSeverity.ERROR).toBe('error');
      expect(ErrorSeverity.FATAL).toBe('fatal');
    });
  });

  // ==================== MonitoringConfig ====================

  describe('MonitoringConfig', () => {
    it('应该使用默认配置创建', () => {
      const config = new MonitoringConfig();

      expect(config.sentryDsn).toBeNull();
      expect(config.sentryEnabled).toBeFalsy(); // undefined when no DSN
      expect(config.sentryEnvironment).toBe('production');
      expect(config.sentryRelease).toBeNull();
      expect(config.errorSampleRate).toBe(1.0);
      expect(config.traceSampleRate).toBe(0.1);
      expect(config.enablePerformanceMonitoring).toBe(true);
      expect(config.slowRequestThreshold).toBe(3000);
      expect(config.environment).toBe('production');
      expect(config.serviceName).toBe('2fa');
      expect(config.version).toBe('2.0.0');
    });

    it('应该使用自定义配置创建', () => {
      const config = new MonitoringConfig({
        sentryDsn: 'https://example.com/sentry',
        sentryEnabled: true,
        sentryEnvironment: 'staging',
        sentryRelease: '1.2.3',
        errorSampleRate: 0.5,
        traceSampleRate: 0.2,
        enablePerformanceMonitoring: false,
        slowRequestThreshold: 5000,
        environment: 'development',
        serviceName: 'test-service',
        version: '3.0.0'
      });

      expect(config.sentryDsn).toBe('https://example.com/sentry');
      expect(config.sentryEnabled).toBeTruthy(); // Truthy (DSN string) when both provided
      expect(config.sentryEnvironment).toBe('staging');
      expect(config.sentryRelease).toBe('1.2.3');
      expect(config.errorSampleRate).toBe(0.5);
      expect(config.traceSampleRate).toBe(0.2);
      expect(config.enablePerformanceMonitoring).toBe(false);
      expect(config.slowRequestThreshold).toBe(5000);
      expect(config.environment).toBe('development');
      expect(config.serviceName).toBe('test-service');
      expect(config.version).toBe('3.0.0');
    });

    it('sentryEnabled 应该依赖 sentryDsn', () => {
      const config1 = new MonitoringConfig({ sentryEnabled: true });
      expect(config1.sentryEnabled).toBeFalsy(); // No DSN → falsy

      const config2 = new MonitoringConfig({
        sentryDsn: 'https://example.com',
        sentryEnabled: true
      });
      expect(config2.sentryEnabled).toBeTruthy(); // Has DSN → truthy
    });

    it('enablePerformanceMonitoring 默认为 true', () => {
      const config = new MonitoringConfig({ enablePerformanceMonitoring: undefined });
      expect(config.enablePerformanceMonitoring).toBe(true);
    });

    describe('shouldSample', () => {
      it('采样率 1.0 应该总是返回 true', () => {
        const config = new MonitoringConfig();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        expect(config.shouldSample(1.0)).toBe(true);
      });

      it('采样率 0.0 应该总是返回 false', () => {
        const config = new MonitoringConfig();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        expect(config.shouldSample(0.0)).toBe(false);
      });

      it('应该根据随机数采样', () => {
        const config = new MonitoringConfig();

        // random() < 0.5 → true
        vi.spyOn(Math, 'random').mockReturnValue(0.3);
        expect(config.shouldSample(0.5)).toBe(true);

        // random() >= 0.5 → false
        vi.spyOn(Math, 'random').mockReturnValue(0.6);
        expect(config.shouldSample(0.5)).toBe(false);
      });
    });
  });

  // ==================== ErrorMonitor ====================

  describe('ErrorMonitor', () => {
    let config;
    let monitor;

    beforeEach(() => {
      config = new MonitoringConfig();
      monitor = new ErrorMonitor(config);
    });

    describe('构造函数', () => {
      it('应该创建 ErrorMonitor 实例', () => {
        expect(monitor.config).toBe(config);
        expect(monitor.logger).toBeDefined();
        expect(monitor.sentryInitialized).toBe(false);
      });
    });

    describe('initSentry', () => {
      it('sentryEnabled=false 时应该不初始化', async () => {
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await monitor.initSentry();

        expect(mockSentry.init).not.toHaveBeenCalled();
        expect(monitor.sentryInitialized).toBe(false);
      });

      it('已初始化时应该不重复初始化', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();
        await enabledMonitor.initSentry(); // 第二次调用

        expect(mockSentry.init).toHaveBeenCalledTimes(1);
      });

      it('Sentry SDK 可用时应该初始化', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com/sentry',
          sentryEnabled: true,
          sentryEnvironment: 'staging',
          sentryRelease: '1.0.0',
          traceSampleRate: 0.2
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        expect(mockSentry.init).toHaveBeenCalledWith({
          dsn: 'https://example.com/sentry',
          environment: 'staging',
          release: '1.0.0',
          tracesSampleRate: 0.2,
          beforeSend: expect.any(Function)
        });
        expect(enabledMonitor.sentryInitialized).toBe(true);
        expect(enabledMonitor.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Sentry initialized'),
          expect.any(Object)
        );
      });

      it('Sentry SDK 不可用时应该记录警告', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        // 不设置 global.Sentry

        await enabledMonitor.initSentry();

        expect(enabledMonitor.sentryInitialized).toBe(false);
        expect(enabledMonitor.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Sentry SDK not loaded')
        );
      });

      it('Sentry 初始化失败应该记录错误', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.init.mockImplementation(() => {
          throw new Error('Init failed');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        expect(enabledMonitor.logger.error).toHaveBeenCalledWith(
          'Failed to initialize Sentry',
          {},
          expect.any(Error)
        );
      });
    });

    describe('_beforeSendSentry', () => {
      it('应该移除敏感请求头', () => {
        const event = {
          request: {
            headers: {
              'authorization': 'Bearer token',
              'cookie': 'session=abc',
              'x-api-key': 'secret',
              'content-type': 'application/json'
            }
          }
        };

        vi.spyOn(Math, 'random').mockReturnValue(0.5); // 采样通过
        const result = monitor._beforeSendSentry(event);

        expect(result.request.headers).not.toHaveProperty('authorization');
        expect(result.request.headers).not.toHaveProperty('cookie');
        expect(result.request.headers).not.toHaveProperty('x-api-key');
        expect(result.request.headers).toHaveProperty('content-type');
      });

      it('应该清空 cookies', () => {
        const event = {
          request: {
            cookies: { session: 'abc', auth: 'xyz' }
          }
        };

        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const result = monitor._beforeSendSentry(event);

        expect(result.request.cookies).toEqual({});
      });

      it('采样失败应该返回 null', () => {
        config.errorSampleRate = 0.5;
        vi.spyOn(Math, 'random').mockReturnValue(0.6); // > 0.5, 采样失败

        const event = { request: {} };
        const result = monitor._beforeSendSentry(event);

        expect(result).toBeNull();
      });

      it('采样成功应该返回事件', () => {
        config.errorSampleRate = 0.5;
        vi.spyOn(Math, 'random').mockReturnValue(0.3); // < 0.5, 采样成功

        const event = { request: {} };
        const result = monitor._beforeSendSentry(event);

        expect(result).toBe(event);
      });
    });

    describe('captureError', () => {
      it('应该记录错误到日志', () => {
        const error = new Error('Test error');
        const context = { userId: '123', operation: 'test' };

        monitor.captureError(error, context, ErrorSeverity.ERROR);

        expect(monitor.logger.error).toHaveBeenCalledWith(
          'Error captured',
          {
            errorName: 'Error',
            errorMessage: 'Test error',
            severity: ErrorSeverity.ERROR,
            userId: '123',
            operation: 'test'
          },
          error
        );
      });

      it('应该返回错误信息', () => {
        const error = new Error('Test error');
        error.stack = 'Error stack';
        const context = { foo: 'bar' };

        const result = monitor.captureError(error, context, ErrorSeverity.WARNING);

        expect(result).toMatchObject({
          errorId: expect.stringMatching(/^err_\d+_[a-z0-9]+$/),
          error: {
            name: 'Error',
            message: 'Test error',
            stack: 'Error stack'
          },
          context: { foo: 'bar' },
          severity: ErrorSeverity.WARNING,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('Sentry 已启用时应该发送到 Sentry', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true,
          serviceName: 'test-service',
          version: '1.0.0',
          environment: 'staging'
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        const error = new Error('Test error');
        const context = { userId: '123' };
        enabledMonitor.captureError(error, context, ErrorSeverity.ERROR);

        expect(mockSentry.captureException).toHaveBeenCalledWith(error, {
          level: ErrorSeverity.ERROR,
          tags: {
            service: 'test-service',
            version: '1.0.0',
            environment: 'staging'
          },
          extra: { userId: '123' }
        });
      });

      it('Sentry 未初始化时不应该发送', () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        // 不调用 initSentry()

        const error = new Error('Test');
        enabledMonitor.captureError(error, {});

        expect(mockSentry.captureException).not.toHaveBeenCalled();
      });

      it('Sentry 发送失败应该记录警告', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.captureException.mockImplementation(() => {
          throw new Error('Sentry error');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        const error = new Error('Test');
        enabledMonitor.captureError(error, {});

        expect(enabledMonitor.logger.warn).toHaveBeenCalledWith(
          'Failed to send error to Sentry',
          {},
          expect.any(Error)
        );
      });
    });

    describe('captureMessage', () => {
      it('应该记录消息到日志', () => {
        monitor.captureMessage('Test message', ErrorSeverity.INFO, { foo: 'bar' });

        expect(monitor.logger.info).toHaveBeenCalledWith(
          'Message captured',
          {
            message: 'Test message',
            level: ErrorSeverity.INFO,
            foo: 'bar'
          }
        );
      });

      it('Sentry 已启用时应该发送到 Sentry', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true,
          serviceName: 'test-service',
          version: '1.0.0'
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        enabledMonitor.captureMessage('Test message', ErrorSeverity.WARNING, { userId: '456' });

        expect(mockSentry.captureMessage).toHaveBeenCalledWith('Test message', {
          level: ErrorSeverity.WARNING,
          tags: {
            service: 'test-service',
            version: '1.0.0'
          },
          extra: { userId: '456' }
        });
      });

      it('Sentry 发送失败应该记录警告', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.captureMessage.mockImplementation(() => {
          throw new Error('Sentry error');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        enabledMonitor.captureMessage('Test message');

        expect(enabledMonitor.logger.warn).toHaveBeenCalledWith(
          'Failed to send message to Sentry',
          {},
          expect.any(Error)
        );
      });
    });

    describe('_generateErrorId', () => {
      it('应该生成唯一的错误 ID', () => {
        const id1 = monitor._generateErrorId();
        const id2 = monitor._generateErrorId();

        expect(id1).toMatch(/^err_\d+_[a-z0-9]+$/);
        expect(id2).toMatch(/^err_\d+_[a-z0-9]+$/);
        expect(id1).not.toBe(id2);
      });
    });

    describe('addBreadcrumb', () => {
      it('应该记录面包屑到日志', () => {
        monitor.addBreadcrumb('User clicked button', 'user-action', { buttonId: 'add' });

        expect(monitor.logger.debug).toHaveBeenCalledWith(
          'Breadcrumb',
          {
            message: 'User clicked button',
            category: 'user-action',
            buttonId: 'add'
          }
        );
      });

      it('Sentry 已启用时应该添加到 Sentry', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        enabledMonitor.addBreadcrumb('Navigation', 'navigation', { to: '/settings' });

        expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith({
          message: 'Navigation',
          category: 'navigation',
          data: { to: '/settings' },
          timestamp: expect.any(Number)
        });
      });

      it('Sentry 失败应该静默处理', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.addBreadcrumb.mockImplementation(() => {
          throw new Error('Sentry error');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        // 不应该抛出错误
        expect(() => {
          enabledMonitor.addBreadcrumb('Test');
        }).not.toThrow();
      });
    });

    describe('setUser', () => {
      it('Sentry 已启用时应该设置用户', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        enabledMonitor.setUser('user123', 'user@example.com', 'testuser');

        expect(mockSentry.setUser).toHaveBeenCalledWith({
          id: 'user123',
          email: 'user@example.com',
          username: 'testuser'
        });
      });

      it('Sentry 失败应该静默处理', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.setUser.mockImplementation(() => {
          throw new Error('Sentry error');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        expect(() => {
          enabledMonitor.setUser('user123');
        }).not.toThrow();
      });
    });

    describe('clearUser', () => {
      it('Sentry 已启用时应该清除用户', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        enabledMonitor.clearUser();

        expect(mockSentry.setUser).toHaveBeenCalledWith(null);
      });

      it('Sentry 失败应该静默处理', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledMonitor = new ErrorMonitor(enabledConfig);
        const mockSentry = createMockSentry();
        mockSentry.setUser.mockImplementation(() => {
          throw new Error('Sentry error');
        });
        global.Sentry = mockSentry;

        await enabledMonitor.initSentry();

        expect(() => {
          enabledMonitor.clearUser();
        }).not.toThrow();
      });
    });
  });

  // ==================== PerformanceMonitor ====================

  describe('PerformanceMonitor', () => {
    let config;
    let monitor;

    beforeEach(() => {
      config = new MonitoringConfig();
      monitor = new PerformanceMonitor(config);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('构造函数', () => {
      it('应该创建 PerformanceMonitor 实例', () => {
        expect(monitor.config).toBe(config);
        expect(monitor.logger).toBeDefined();
        expect(monitor.metrics).toBeInstanceOf(Map);
        expect(monitor.metrics.size).toBe(0);
      });
    });

    describe('startTrace', () => {
      it('性能监控禁用时应该返回 null', () => {
        const disabledConfig = new MonitoringConfig({ enablePerformanceMonitoring: false });
        const disabledMonitor = new PerformanceMonitor(disabledConfig);

        const traceId = disabledMonitor.startTrace('Test');

        expect(traceId).toBeNull();
      });

      it('应该创建追踪并返回 traceId', () => {
        const traceId = monitor.startTrace('Test Operation', { userId: '123' });

        expect(traceId).toBeDefined();
        expect(traceId).toMatch(/^Test Operation_\d+_[a-z0-9]+$/);
        expect(monitor.metrics.has(traceId)).toBe(true);

        const trace = monitor.metrics.get(traceId);
        expect(trace).toMatchObject({
          id: traceId,
          name: 'Test Operation',
          startTime: expect.any(Number),
          context: { userId: '123' },
          spans: []
        });
      });

      it('应该记录调试日志', () => {
        monitor.startTrace('Test', { foo: 'bar' });

        expect(monitor.logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Trace started'),
          expect.objectContaining({
            traceId: expect.any(String),
            name: 'Test',
            foo: 'bar'
          })
        );
      });
    });

    describe('addSpan', () => {
      it('应该添加 span 到追踪', () => {
        const traceId = monitor.startTrace('Test');

        vi.advanceTimersByTime(100);
        monitor.addSpan(traceId, 'Database Query');

        vi.advanceTimersByTime(50);
        monitor.addSpan(traceId, 'API Call', 75);

        const trace = monitor.metrics.get(traceId);
        expect(trace.spans).toHaveLength(2);
        expect(trace.spans[0]).toMatchObject({
          name: 'Database Query',
          timestamp: expect.any(Number),
          duration: expect.any(Number)
        });
        expect(trace.spans[1]).toMatchObject({
          name: 'API Call',
          timestamp: expect.any(Number),
          duration: 75
        });
      });

      it('追踪不存在时应该静默处理', () => {
        expect(() => {
          monitor.addSpan('invalid-trace-id', 'Test Span');
        }).not.toThrow();
      });

      it('应该记录调试日志', () => {
        const traceId = monitor.startTrace('Test');

        monitor.addSpan(traceId, 'Test Span', 100);

        expect(monitor.logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Span added'),
          expect.objectContaining({
            traceId,
            spanName: 'Test Span',
            duration: 100
          })
        );
      });
    });

    describe('endTrace', () => {
      it('追踪不存在时应该返回 null', () => {
        const result = monitor.endTrace('invalid-trace-id');

        expect(result).toBeNull();
      });

      it('应该结束追踪并返回结果', () => {
        const traceId = monitor.startTrace('Test');

        vi.advanceTimersByTime(200);
        monitor.addSpan(traceId, 'Span 1', 100);

        vi.advanceTimersByTime(100);
        const result = monitor.endTrace(traceId, { status: 'success' });

        expect(result).toMatchObject({
          id: traceId,
          name: 'Test',
          duration: expect.any(Number),
          startTime: expect.any(Number),
          endTime: expect.any(Number),
          spans: [
            expect.objectContaining({ name: 'Span 1' })
          ],
          metadata: { status: 'success' }
        });
      });

      it('应该清理追踪', () => {
        const traceId = monitor.startTrace('Test');

        monitor.endTrace(traceId);

        expect(monitor.metrics.has(traceId)).toBe(false);
      });

      it('慢请求应该记录警告日志', () => {
        const traceId = monitor.startTrace('Slow Operation');

        vi.advanceTimersByTime(4000); // > slowRequestThreshold (3000ms)
        monitor.endTrace(traceId, { route: '/api/slow' });

        expect(monitor.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Slow trace detected'),
          expect.objectContaining({
            traceId,
            name: 'Slow Operation',
            duration: expect.any(Number),
            threshold: 3000,
            route: '/api/slow'
          })
        );
      });

      it('正常请求应该记录信息日志', () => {
        const traceId = monitor.startTrace('Fast Operation');

        vi.advanceTimersByTime(500); // < slowRequestThreshold
        monitor.endTrace(traceId);

        expect(monitor.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Trace completed'),
          expect.objectContaining({
            traceId,
            name: 'Fast Operation',
            duration: expect.any(Number),
            spanCount: 0
          })
        );
      });
    });

    describe('recordMetric', () => {
      it('应该记录指标到日志', () => {
        monitor.recordMetric('response_time', 123, 'ms', { endpoint: '/api/test' });

        expect(monitor.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Metric recorded'),
          {
            name: 'response_time',
            value: 123,
            unit: 'ms',
            endpoint: '/api/test'
          }
        );
      });

      it('默认单位应该为 ms', () => {
        monitor.recordMetric('count', 10);

        expect(monitor.logger.info).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            unit: 'ms'
          })
        );
      });
    });

    describe('getActiveTracesCount', () => {
      it('没有追踪时应该返回 0', () => {
        expect(monitor.getActiveTracesCount()).toBe(0);
      });

      it('应该返回活跃追踪数量', () => {
        monitor.startTrace('Trace 1');
        monitor.startTrace('Trace 2');
        monitor.startTrace('Trace 3');

        expect(monitor.getActiveTracesCount()).toBe(3);
      });

      it('结束追踪后应该减少计数', () => {
        const traceId1 = monitor.startTrace('Trace 1');
        const traceId2 = monitor.startTrace('Trace 2');

        expect(monitor.getActiveTracesCount()).toBe(2);

        monitor.endTrace(traceId1);

        expect(monitor.getActiveTracesCount()).toBe(1);

        monitor.endTrace(traceId2);

        expect(monitor.getActiveTracesCount()).toBe(0);
      });
    });
  });

  // ==================== MonitoringManager ====================

  describe('MonitoringManager', () => {
    let config;
    let manager;

    beforeEach(() => {
      config = new MonitoringConfig();
      manager = new MonitoringManager(config);
    });

    describe('构造函数', () => {
      it('应该创建 MonitoringManager 实例', () => {
        expect(manager.config).toBe(config);
        expect(manager.errorMonitor).toBeInstanceOf(ErrorMonitor);
        expect(manager.performanceMonitor).toBeInstanceOf(PerformanceMonitor);
        expect(manager.logger).toBeDefined();
      });
    });

    describe('initialize', () => {
      it('应该记录初始化日志', async () => {
        await manager.initialize();

        expect(manager.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Initializing monitoring system'),
          {
            sentryEnabled: undefined, // undefined when no DSN provided
            performanceEnabled: true,
            environment: 'production'
          }
        );
      });

      it('Sentry 已启用时应该初始化 Sentry', async () => {
        const enabledConfig = new MonitoringConfig({
          sentryDsn: 'https://example.com',
          sentryEnabled: true
        });
        const enabledManager = new MonitoringManager(enabledConfig);
        const mockSentry = createMockSentry();
        global.Sentry = mockSentry;

        await enabledManager.initialize();

        expect(mockSentry.init).toHaveBeenCalled();
      });
    });

    describe('getErrorMonitor', () => {
      it('应该返回错误监控器', () => {
        const errorMonitor = manager.getErrorMonitor();

        expect(errorMonitor).toBeInstanceOf(ErrorMonitor);
        expect(errorMonitor).toBe(manager.errorMonitor);
      });
    });

    describe('getPerformanceMonitor', () => {
      it('应该返回性能监控器', () => {
        const perfMonitor = manager.getPerformanceMonitor();

        expect(perfMonitor).toBeInstanceOf(PerformanceMonitor);
        expect(perfMonitor).toBe(manager.performanceMonitor);
      });
    });

    describe('createMiddleware', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('应该创建中间件函数', () => {
        const middleware = manager.createMiddleware();

        expect(middleware).toBeInstanceOf(Function);
      });

      it('成功请求应该记录性能', async () => {
        const middleware = manager.createMiddleware();
        const request = createMockRequest('POST', 'https://example.com/api/secrets');
        const mockResponse = { status: 201 };
        const mockNext = vi.fn(async () => mockResponse);

        const result = await middleware(request, {}, {}, mockNext);

        expect(result).toBe(mockResponse);
        // Check performance monitor's logger (not manager's logger)
        expect(manager.performanceMonitor.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Trace completed'),
          expect.objectContaining({
            status: 201,
            success: true
          })
        );
      });

      it('失败请求应该捕获错误并记录', async () => {
        const middleware = manager.createMiddleware();
        const request = createMockRequest();
        const error = new Error('Request failed');
        const mockNext = vi.fn(async () => {
          throw error;
        });

        await expect(middleware(request, {}, {}, mockNext)).rejects.toThrow('Request failed');

        // Check error monitor's logger (not manager's logger)
        expect(manager.errorMonitor.logger.error).toHaveBeenCalledWith(
          'Error captured',
          expect.objectContaining({
            method: 'GET',
            url: 'https://example.com/api/test'
          }),
          error
        );
      });

      it('失败请求应该记录失败的追踪', async () => {
        const middleware = manager.createMiddleware();
        const request = createMockRequest();
        const mockNext = vi.fn(async () => {
          throw new Error('Test error');
        });

        await expect(middleware(request, {}, {}, mockNext)).rejects.toThrow();

        // 验证 endTrace 被调用，且 success=false
        // Check performance monitor's logger (not manager's logger)
        expect(manager.performanceMonitor.logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Trace completed'),
          expect.objectContaining({
            success: false,
            errorId: expect.stringMatching(/^err_/)
          })
        );
      });
    });
  });

  // ==================== 工厂函数 ====================

  describe('getMonitoring', () => {
    it('应该返回单例实例', () => {
      const monitoring1 = getMonitoring();
      const monitoring2 = getMonitoring();

      expect(monitoring1).toBe(monitoring2);
    });

    it('应该使用环境变量配置', () => {
      const env = createMockEnv({
        SENTRY_DSN: 'https://sentry.example.com',
        ENVIRONMENT: 'staging',
        VERSION: '2.5.0',
        ERROR_SAMPLE_RATE: '0.8',
        TRACE_SAMPLE_RATE: '0.3',
        ENABLE_PERFORMANCE_MONITORING: 'false',
        SLOW_REQUEST_THRESHOLD: '5000'
      });

      const monitoring = getMonitoring(env);

      expect(monitoring.config.sentryDsn).toBe('https://sentry.example.com');
      expect(monitoring.config.sentryEnabled).toBeTruthy(); // Truthy (DSN string) when configured
      expect(monitoring.config.sentryEnvironment).toBe('staging');
      expect(monitoring.config.sentryRelease).toBe('2.5.0');
      expect(monitoring.config.errorSampleRate).toBe(0.8);
      expect(monitoring.config.traceSampleRate).toBe(0.3);
      expect(monitoring.config.enablePerformanceMonitoring).toBe(false);
      expect(monitoring.config.slowRequestThreshold).toBe(5000);
    });

    it('应该使用默认配置', () => {
      const monitoring = getMonitoring();

      expect(monitoring.config.sentryEnabled).toBe(false);
      expect(monitoring.config.environment).toBe('production');
      expect(monitoring.config.serviceName).toBe('2fa');
      expect(monitoring.config.version).toBe('2.0.0');
      expect(monitoring.config.errorSampleRate).toBe(1.0);
      expect(monitoring.config.traceSampleRate).toBe(0.1);
      expect(monitoring.config.enablePerformanceMonitoring).toBe(true);
      expect(monitoring.config.slowRequestThreshold).toBe(3000);
    });
  });

  describe('resetMonitoring', () => {
    it('应该重置全局实例', () => {
      const monitoring1 = getMonitoring();
      resetMonitoring();
      const monitoring2 = getMonitoring();

      expect(monitoring1).not.toBe(monitoring2);
    });
  });

  // ==================== 快捷方法对象 ====================

  describe('monitoring 快捷方法', () => {
    it('captureError 应该调用 ErrorMonitor.captureError', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getErrorMonitor(), 'captureError');

      const error = new Error('Test');
      monitoring.captureError(error, { foo: 'bar' }, ErrorSeverity.ERROR);

      expect(monitoringInstance.getErrorMonitor().captureError).toHaveBeenCalledWith(
        error,
        { foo: 'bar' },
        ErrorSeverity.ERROR
      );
    });

    it('captureMessage 应该调用 ErrorMonitor.captureMessage', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getErrorMonitor(), 'captureMessage');

      monitoring.captureMessage('Test message', ErrorSeverity.INFO, { foo: 'bar' });

      expect(monitoringInstance.getErrorMonitor().captureMessage).toHaveBeenCalledWith(
        'Test message',
        ErrorSeverity.INFO,
        { foo: 'bar' }
      );
    });

    it('addBreadcrumb 应该调用 ErrorMonitor.addBreadcrumb', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getErrorMonitor(), 'addBreadcrumb');

      monitoring.addBreadcrumb('Test', 'category', { data: 'value' });

      expect(monitoringInstance.getErrorMonitor().addBreadcrumb).toHaveBeenCalledWith(
        'Test',
        'category',
        { data: 'value' }
      );
    });

    it('startTrace 应该调用 PerformanceMonitor.startTrace', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getPerformanceMonitor(), 'startTrace');

      monitoring.startTrace('Test Trace', { foo: 'bar' });

      expect(monitoringInstance.getPerformanceMonitor().startTrace).toHaveBeenCalledWith(
        'Test Trace',
        { foo: 'bar' }
      );
    });

    it('endTrace 应该调用 PerformanceMonitor.endTrace', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getPerformanceMonitor(), 'endTrace');

      monitoring.endTrace('trace-id', { metadata: 'value' });

      expect(monitoringInstance.getPerformanceMonitor().endTrace).toHaveBeenCalledWith(
        'trace-id',
        { metadata: 'value' }
      );
    });

    it('recordMetric 应该调用 PerformanceMonitor.recordMetric', () => {
      const monitoringInstance = getMonitoring();
      vi.spyOn(monitoringInstance.getPerformanceMonitor(), 'recordMetric');

      monitoring.recordMetric('metric_name', 123, 'ms', { tag: 'value' });

      expect(monitoringInstance.getPerformanceMonitor().recordMetric).toHaveBeenCalledWith(
        'metric_name',
        123,
        'ms',
        { tag: 'value' }
      );
    });
  });

  // ==================== 集成测试 ====================

  describe('集成测试', () => {
    it('完整的错误监控流程', async () => {
      const env = createMockEnv({
        SENTRY_DSN: 'https://sentry.example.com'
      });
      const monitoring = getMonitoring(env);
      const mockSentry = createMockSentry();
      global.Sentry = mockSentry;

      // 初始化
      await monitoring.initialize();
      expect(mockSentry.init).toHaveBeenCalled();

      // 设置用户
      monitoring.getErrorMonitor().setUser('user123', 'user@example.com');
      expect(mockSentry.setUser).toHaveBeenCalledWith({
        id: 'user123',
        email: 'user@example.com',
        username: null
      });

      // 添加面包屑
      monitoring.getErrorMonitor().addBreadcrumb('User action', 'navigation');
      expect(mockSentry.addBreadcrumb).toHaveBeenCalled();

      // 捕获错误
      const error = new Error('Test error');
      monitoring.getErrorMonitor().captureError(error);
      expect(mockSentry.captureException).toHaveBeenCalledWith(
        error,
        expect.any(Object)
      );

      // 清除用户
      monitoring.getErrorMonitor().clearUser();
      expect(mockSentry.setUser).toHaveBeenCalledWith(null);
    });

    it('完整的性能监控流程', () => {
      vi.useFakeTimers();
      const monitoring = getMonitoring();
      const perfMonitor = monitoring.getPerformanceMonitor();

      // 开始追踪
      const traceId = perfMonitor.startTrace('API Request', { endpoint: '/api/test' });
      expect(traceId).toBeDefined();

      // 添加 spans
      vi.advanceTimersByTime(50);
      perfMonitor.addSpan(traceId, 'Database Query', 45);

      vi.advanceTimersByTime(30);
      perfMonitor.addSpan(traceId, 'External API', 25);

      // 结束追踪
      vi.advanceTimersByTime(20);
      const result = perfMonitor.endTrace(traceId, { status: 200 });

      expect(result).toMatchObject({
        name: 'API Request',
        spans: [
          expect.objectContaining({ name: 'Database Query' }),
          expect.objectContaining({ name: 'External API' })
        ],
        metadata: { status: 200 }
      });

      vi.useRealTimers();
    });

    it('中间件应该集成错误和性能监控', async () => {
      vi.useFakeTimers();
      const monitoring = getMonitoring();
      const middleware = monitoring.createMiddleware();

      // 成功请求
      const request = createMockRequest('POST', 'https://example.com/api/test');
      const mockResponse = { status: 200 };
      const mockNext = vi.fn(async () => mockResponse);

      const result = await middleware(request, {}, {}, mockNext);

      expect(result).toBe(mockResponse);
      // Check performance monitor's logger (not monitoring's logger)
      expect(monitoring.performanceMonitor.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Trace completed'),
        expect.objectContaining({
          status: 200,
          success: true
        })
      );

      vi.useRealTimers();
    });
  });

  // ==================== 边界条件 ====================

  describe('边界条件', () => {
    it('应该处理空上下文', () => {
      const config = new MonitoringConfig();
      const monitor = new ErrorMonitor(config);

      const error = new Error('Test');
      const result = monitor.captureError(error);

      expect(result.context).toEqual({});
    });

    it('应该处理极长的错误消息', () => {
      const config = new MonitoringConfig();
      const monitor = new ErrorMonitor(config);

      const longMessage = 'A'.repeat(10000);
      const error = new Error(longMessage);

      const result = monitor.captureError(error);

      expect(result.error.message).toHaveLength(10000);
    });

    it('应该处理特殊字符', () => {
      const config = new MonitoringConfig();
      const monitor = new ErrorMonitor(config);

      const error = new Error('测试错误 🎉 <script>alert(1)</script>');
      const result = monitor.captureError(error);

      expect(result.error.message).toContain('测试错误');
      expect(result.error.message).toContain('🎉');
    });

    it('应该处理循环引用（captureError context）', () => {
      const config = new MonitoringConfig();
      const monitor = new ErrorMonitor(config);

      const context = { name: 'test' };
      context.self = context;

      const error = new Error('Test');
      // 不应该崩溃
      expect(() => {
        monitor.captureError(error, context);
      }).not.toThrow();
    });

    it('性能监控禁用时不应该创建追踪', () => {
      const config = new MonitoringConfig({ enablePerformanceMonitoring: false });
      const monitor = new PerformanceMonitor(config);

      const traceId = monitor.startTrace('Test');

      expect(traceId).toBeNull();
      expect(monitor.metrics.size).toBe(0);
    });

    it('应该处理极大数量的活跃追踪', () => {
      vi.useFakeTimers();
      const config = new MonitoringConfig();
      const monitor = new PerformanceMonitor(config);

      for (let i = 0; i < 1000; i++) {
        monitor.startTrace(`Trace ${i}`);
      }

      expect(monitor.getActiveTracesCount()).toBe(1000);

      vi.useRealTimers();
    });

    it('无效采样率应该处理', () => {
      const config = new MonitoringConfig();

      // 负数采样率
      expect(config.shouldSample(-0.5)).toBe(false);

      // 超过 1.0 的采样率
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(config.shouldSample(1.5)).toBe(true);
    });
  });

  // ==================== 性能测试 ====================

  describe('性能测试', () => {
    it('捕获 1000 个错误应该很快', () => {
      vi.useRealTimers();
      const config = new MonitoringConfig();
      const monitor = new ErrorMonitor(config);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const error = new Error(`Error ${i}`);
        monitor.captureError(error, { index: i });
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(1000); // < 1秒

      vi.useFakeTimers();
    });

    it('创建 100 个追踪应该很快', () => {
      vi.useRealTimers();
      const config = new MonitoringConfig();
      const monitor = new PerformanceMonitor(config);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        monitor.startTrace(`Trace ${i}`, { index: i });
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // < 100ms

      vi.useFakeTimers();
    });
  });
});
