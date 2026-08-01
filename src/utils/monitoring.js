/**
 * 错误监控和追踪系统
 * 自定义错误追踪、性能监控
 */

import { getLogger } from './logger.js';
import { APP_VERSION } from './version.js';

/**
 * 错误严重程度级别
 */
export const ErrorSeverity = {
	DEBUG: 'debug',
	INFO: 'info',
	WARNING: 'warning',
	ERROR: 'error',
	FATAL: 'fatal',
};

/**
 * 监控配置类
 */
class MonitoringConfig {
	constructor(options = {}) {
		// 性能监控配置
		this.enablePerformanceMonitoring = options.enablePerformanceMonitoring !== false;
		// 显式校验数值：既保留合法的 0（耗时 > 0ms 的请求均视为慢请求），又让 NaN / 负数 / 非数字回退默认值
		this.slowRequestThreshold =
			Number.isFinite(options.slowRequestThreshold) && options.slowRequestThreshold >= 0 ? options.slowRequestThreshold : 3000; // 3秒

		// 自定义配置
		this.environment = options.environment || 'production';
		this.serviceName = options.serviceName || '2fa';
		this.version = options.version || APP_VERSION;
	}
}

/**
 * 错误监控类
 */
class ErrorMonitor {
	constructor(config, env = null) {
		this.config = config;
		this.logger = getLogger(env);
	}

	/**
	 * 捕获错误
	 */
	captureError(error, context = {}, severity = ErrorSeverity.ERROR) {
		// 记录到日志
		this.logger.error(
			'Error captured',
			{
				errorName: error.name,
				errorMessage: error.message,
				severity,
				...context,
			},
			error,
		);

		return {
			errorId: this._generateErrorId(),
			error: {
				name: error.name,
				message: error.message,
				stack: error.stack,
			},
			context,
			severity,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * 捕获异常消息（非 Error 对象）
	 */
	captureMessage(message, level = ErrorSeverity.INFO, context = {}) {
		this.logger.info('Message captured', {
			message,
			level,
			...context,
		});
	}

	/**
	 * 生成唯一的错误 ID
	 * @private
	 */
	_generateErrorId() {
		return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * 添加面包屑（用户操作轨迹）
	 */
	addBreadcrumb(message, category = 'default', data = {}) {
		this.logger.debug('Breadcrumb', {
			message,
			category,
			...data,
		});
	}
}

/**
 * 性能监控类
 */
class PerformanceMonitor {
	constructor(config, env = null) {
		this.config = config;
		this.logger = getLogger(env);
		this.metrics = new Map();
	}

	/**
	 * 开始性能追踪
	 */
	startTrace(name, context = {}) {
		if (!this.config.enablePerformanceMonitoring) {
			return null;
		}

		const traceId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const trace = {
			id: traceId,
			name,
			startTime: Date.now(),
			context,
			spans: [],
		};

		this.metrics.set(traceId, trace);

		this.logger.debug('⏱️ Trace started', {
			traceId,
			name,
			...context,
		});

		return traceId;
	}

	/**
	 * 添加 Span（子追踪）
	 */
	addSpan(traceId, spanName, duration = null) {
		const trace = this.metrics.get(traceId);
		if (!trace) {
			return;
		}

		const span = {
			name: spanName,
			timestamp: Date.now(),
			duration: duration || Date.now() - trace.startTime,
		};

		trace.spans.push(span);

		this.logger.debug('⏱️ Span added', {
			traceId,
			spanName,
			duration: span.duration,
		});
	}

	/**
	 * 结束性能追踪
	 */
	endTrace(traceId, metadata = {}) {
		const trace = this.metrics.get(traceId);
		if (!trace) {
			return null;
		}

		const duration = Date.now() - trace.startTime;
		const result = {
			...trace,
			duration,
			endTime: Date.now(),
			metadata,
		};

		// 检查是否为慢请求
		const isSlow = duration > this.config.slowRequestThreshold;

		if (isSlow) {
			this.logger.warn('🐌 Slow trace detected', {
				traceId,
				name: trace.name,
				duration,
				threshold: this.config.slowRequestThreshold,
				spans: trace.spans,
				...metadata,
			});
		} else {
			this.logger.info('⏱️ Trace completed', {
				traceId,
				name: trace.name,
				duration,
				spanCount: trace.spans.length,
				...metadata,
			});
		}

		// 清理
		this.metrics.delete(traceId);

		return result;
	}

	/**
	 * 记录自定义指标
	 */
	recordMetric(name, value, unit = 'ms', tags = {}) {
		this.logger.info('📊 Metric recorded', {
			name,
			value,
			unit,
			...tags,
		});

		// 可以发送到监控系统（如 Prometheus、DataDog）
		// 这里只记录到日志
	}

	/**
	 * 获取当前活跃的追踪数量
	 */
	getActiveTracesCount() {
		return this.metrics.size;
	}
}

/**
 * 统一的监控管理器
 */
class MonitoringManager {
	constructor(config, env = null) {
		this.config = config;
		this.errorMonitor = new ErrorMonitor(config, env);
		this.performanceMonitor = new PerformanceMonitor(config, env);
		this.logger = getLogger(env);
	}

	/**
	 * 初始化监控系统
	 */
	async initialize() {
		this.logger.info('🚀 Initializing monitoring system', {
			performanceEnabled: this.config.enablePerformanceMonitoring,
			environment: this.config.environment,
		});
	}

	/**
	 * 获取错误监控器
	 */
	getErrorMonitor() {
		return this.errorMonitor;
	}

	/**
	 * 获取性能监控器
	 */
	getPerformanceMonitor() {
		return this.performanceMonitor;
	}

	/**
	 * 创建监控中间件（用于 Worker）
	 */
	createMiddleware() {
		return async (request, env, ctx, next) => {
			const traceId = this.performanceMonitor.startTrace(`${request.method} ${new URL(request.url).pathname}`, {
				method: request.method,
				url: request.url,
			});

			try {
				// 执行请求处理
				const response = await next(request, env, ctx);

				// 记录性能
				this.performanceMonitor.endTrace(traceId, {
					status: response?.status,
					success: true,
				});

				return response;
			} catch (error) {
				// 捕获错误
				const errorInfo = this.errorMonitor.captureError(
					error,
					{
						method: request.method,
						url: request.url,
						traceId,
					},
					ErrorSeverity.ERROR,
				);

				// 记录失败的追踪
				this.performanceMonitor.endTrace(traceId, {
					success: false,
					errorId: errorInfo.errorId,
				});

				// 重新抛出错误
				throw error;
			}
		};
	}
}

/**
 * 默认监控实例
 */
let defaultMonitoring = null;
let defaultMonitoringConfigured = false; // 单例是否已用运行时 env 完成配置

/**
 * 根据环境变量解析监控配置
 * @private
 */
function resolveMonitoringOptions(env) {
	return {
		enablePerformanceMonitoring: env?.ENABLE_PERFORMANCE_MONITORING !== 'false',
		slowRequestThreshold: parseInt(env?.SLOW_REQUEST_THRESHOLD ?? '3000'),
		environment: env?.ENVIRONMENT || 'production',
		serviceName: '2fa',
		version: env?.VERSION || APP_VERSION,
	};
}

/**
 * 获取默认监控实例
 *
 * 与 getLogger 同理：单例可能先被无 env 的快捷方法调用创建，
 * 因此首次携带 env 的调用会就地更新 config，
 * 保证已持有该 config 引用的 ErrorMonitor / PerformanceMonitor 同样生效。
 */
export function getMonitoring(env = null) {
	if (!defaultMonitoring) {
		defaultMonitoring = new MonitoringManager(new MonitoringConfig(resolveMonitoringOptions(env)), env);
		defaultMonitoringConfigured = Boolean(env);
	} else if (env && !defaultMonitoringConfigured) {
		Object.assign(defaultMonitoring.config, new MonitoringConfig(resolveMonitoringOptions(env)));
		// 内部监控器持有的 logger 也可能是无 env 创建的单例，一并触发其配置更新
		getLogger(env);
		defaultMonitoringConfigured = true;
	}

	return defaultMonitoring;
}

/**
 * 重置默认监控实例（主要用于测试）
 */
export function resetMonitoring() {
	defaultMonitoring = null;
	defaultMonitoringConfigured = false;
}

/**
 * 快捷方法
 */
export const monitoring = {
	/**
	 * 捕获错误
	 */
	captureError: (error, context, severity) => {
		return getMonitoring().getErrorMonitor().captureError(error, context, severity);
	},

	/**
	 * 捕获消息
	 */
	captureMessage: (message, level, context) => {
		return getMonitoring().getErrorMonitor().captureMessage(message, level, context);
	},

	/**
	 * 添加面包屑
	 */
	addBreadcrumb: (message, category, data) => {
		return getMonitoring().getErrorMonitor().addBreadcrumb(message, category, data);
	},

	/**
	 * 开始性能追踪
	 */
	startTrace: (name, context) => {
		return getMonitoring().getPerformanceMonitor().startTrace(name, context);
	},

	/**
	 * 结束性能追踪
	 */
	endTrace: (traceId, metadata) => {
		return getMonitoring().getPerformanceMonitor().endTrace(traceId, metadata);
	},

	/**
	 * 记录指标
	 */
	recordMetric: (name, value, unit, tags) => {
		return getMonitoring().getPerformanceMonitor().recordMetric(name, value, unit, tags);
	},
};

/**
 * 导出类和配置
 */
export { MonitoringConfig, MonitoringManager, ErrorMonitor, PerformanceMonitor };

/**
 * 使用示例：
 *
 * // 初始化监控
 * const monitoring = getMonitoring(env);
 * await monitoring.initialize();
 *
 * // 捕获错误
 * try {
 *   // ... 操作 ...
 * } catch (error) {
 *   monitoring.getErrorMonitor().captureError(error, {
 *     operation: 'addSecret',
 *     userId: '123'
 *   });
 * }
 *
 * // 性能追踪
 * const traceId = monitoring.getPerformanceMonitor().startTrace('DatabaseQuery');
 * // ... 执行查询 ...
 * monitoring.getPerformanceMonitor().endTrace(traceId, { rows: 10 });
 *
 * // 面包屑
 * monitoring.getErrorMonitor().addBreadcrumb('User clicked button', 'user-action', {
 *   buttonId: 'add-secret'
 * });
 */
