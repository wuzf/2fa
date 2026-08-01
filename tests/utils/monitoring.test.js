/**
 * Monitoring 监控系统测试
 * 测试错误追踪、性能监控
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
import { APP_VERSION } from '../../src/utils/version.js';
import { getLogger } from '../../src/utils/logger.js';

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
 * 创建 Mock 环境变量
 */
function createMockEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'test',
    VERSION: '1.0.0',
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

      expect(config.enablePerformanceMonitoring).toBe(true);
      expect(config.slowRequestThreshold).toBe(3000);
      expect(config.environment).toBe('production');
      expect(config.serviceName).toBe('2fa');
      expect(config.version).toBe(APP_VERSION);
    });

    it('应该使用自定义配置创建', () => {
      const config = new MonitoringConfig({
        enablePerformanceMonitoring: false,
        slowRequestThreshold: 5000,
        environment: 'development',
        serviceName: 'test-service',
        version: '3.0.0'
      });

      expect(config.enablePerformanceMonitoring).toBe(false);
      expect(config.slowRequestThreshold).toBe(5000);
      expect(config.environment).toBe('development');
      expect(config.serviceName).toBe('test-service');
      expect(config.version).toBe('3.0.0');
    });

    it('enablePerformanceMonitoring 默认为 true', () => {
      const config = new MonitoringConfig({ enablePerformanceMonitoring: undefined });
      expect(config.enablePerformanceMonitoring).toBe(true);
    });

    it('slowRequestThreshold 为 0 时不应被默认值吞掉', () => {
      const config = new MonitoringConfig({ slowRequestThreshold: 0 });
      expect(config.slowRequestThreshold).toBe(0);
    });

    it('slowRequestThreshold 为非法值时应回退默认值', () => {
      // NaN 若被保留，duration > NaN 恒为 false，会静默关闭慢请求告警
      expect(new MonitoringConfig({ slowRequestThreshold: NaN }).slowRequestThreshold).toBe(3000);
      expect(new MonitoringConfig({ slowRequestThreshold: Infinity }).slowRequestThreshold).toBe(3000);
      expect(new MonitoringConfig({ slowRequestThreshold: -Infinity }).slowRequestThreshold).toBe(3000);
      expect(new MonitoringConfig({ slowRequestThreshold: -1 }).slowRequestThreshold).toBe(3000);
      expect(new MonitoringConfig({ slowRequestThreshold: 'abc' }).slowRequestThreshold).toBe(3000);
      expect(new MonitoringConfig({ slowRequestThreshold: '5000' }).slowRequestThreshold).toBe(3000); // 数字字符串不接受
      expect(new MonitoringConfig({ slowRequestThreshold: true }).slowRequestThreshold).toBe(3000);
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
            performanceEnabled: true,
            environment: 'production'
          }
        );
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
        ENVIRONMENT: 'staging',
        VERSION: '2.5.0',
        ENABLE_PERFORMANCE_MONITORING: 'false',
        SLOW_REQUEST_THRESHOLD: '5000'
      });

      const monitoring = getMonitoring(env);

      expect(monitoring.config.environment).toBe('staging');
      expect(monitoring.config.version).toBe('2.5.0');
      expect(monitoring.config.enablePerformanceMonitoring).toBe(false);
      expect(monitoring.config.slowRequestThreshold).toBe(5000);
    });

    it('应该使用默认配置', () => {
      const monitoring = getMonitoring();

      expect(monitoring.config.environment).toBe('production');
      expect(monitoring.config.serviceName).toBe('2fa');
      expect(monitoring.config.version).toBe(APP_VERSION);
      expect(monitoring.config.enablePerformanceMonitoring).toBe(true);
      expect(monitoring.config.slowRequestThreshold).toBe(3000);
    });

    it('无 env 创建后，首次携带 env 的调用应该就地更新配置', () => {
      // 模拟模块加载阶段的无 env 调用（如 monitoring 快捷方法）
      const early = getMonitoring();
      expect(early.config.slowRequestThreshold).toBe(3000);

      // 首个请求携带 env
      const configured = getMonitoring(createMockEnv({
        ENVIRONMENT: 'staging',
        SLOW_REQUEST_THRESHOLD: '5000'
      }));

      // 同一实例，且内部监控器持有的 config 引用同样生效
      expect(configured).toBe(early);
      expect(early.config.slowRequestThreshold).toBe(5000);
      expect(early.config.environment).toBe('staging');
      expect(early.getPerformanceMonitor().config.slowRequestThreshold).toBe(5000);
    });

    it('已用 env 配置后不应被后续调用重复覆盖', () => {
      getMonitoring(createMockEnv({ SLOW_REQUEST_THRESHOLD: '5000' }));
      const monitoring = getMonitoring(createMockEnv({ SLOW_REQUEST_THRESHOLD: '9000' }));

      expect(monitoring.config.slowRequestThreshold).toBe(5000);
    });

    it('冷启动时应把 env 透传给内部 logger（不依赖先调用 getLogger）', () => {
      const env = createMockEnv({ LOG_LEVEL: 'ERROR' });
      getLogger.mockClear();

      // 未先调用 getLogger(env)，直接 getMonitoring(env)
      getMonitoring(env);

      // 断言 env 真的传到了 getLogger —— 只断言 logger 存在的话，不传 env 的旧实现也能通过
      expect(getLogger).toHaveBeenCalledWith(env);
      // manager + errorMonitor + performanceMonitor 三处构造都应携带 env
      expect(getLogger.mock.calls.filter((args) => args[0] === env)).toHaveLength(3);
    });

    it('env 后到时应触发 logger 单例更新', () => {
      getMonitoring(); // 冷启动无 env（模拟模块加载阶段）
      const env = createMockEnv({ LOG_LEVEL: 'ERROR' });
      getLogger.mockClear();

      getMonitoring(env);

      // 三个构造函数不会重跑，只能靠 getMonitoring 内部补调 getLogger(env) 更新单例
      expect(getLogger).toHaveBeenCalledWith(env);
    });

    it('env 中 SLOW_REQUEST_THRESHOLD 为空串或非法值时应回退默认值', () => {
      expect(getMonitoring(createMockEnv({ SLOW_REQUEST_THRESHOLD: '' })).config.slowRequestThreshold).toBe(3000);

      resetMonitoring();
      expect(getMonitoring(createMockEnv({ SLOW_REQUEST_THRESHOLD: 'abc' })).config.slowRequestThreshold).toBe(3000);

      resetMonitoring();
      expect(getMonitoring(createMockEnv({ SLOW_REQUEST_THRESHOLD: '0' })).config.slowRequestThreshold).toBe(0);
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
