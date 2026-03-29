/**
 * 错误监控和追踪系统
 * 支持 Sentry 集成、自定义错误追踪、性能监控
 */

/* global Sentry */

import { getLogger } from './logger.js';

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
		// Sentry 配置
		this.sentryDsn = options.sentryDsn || null;
		this.sentryEnabled = options.sentryEnabled && this.sentryDsn;
		this.sentryEnvironment = options.sentryEnvironment || 'production';
		this.sentryRelease = options.sentryRelease || null;

		// 采样率配置
		this.errorSampleRate = options.errorSampleRate || 1.0; // 100% 错误采样
		this.traceSampleRate = options.traceSampleRate || 0.1; // 10% 性能追踪

		// 性能监控配置
		this.enablePerformanceMonitoring = options.enablePerformanceMonitoring !== false;
		this.slowRequestThreshold = options.slowRequestThreshold || 3000; // 3秒

		// 自定义配置
		this.environment = options.environment || 'production';
		this.serviceName = options.serviceName || '2fa';
		this.version = options.version || '1.3.0';
	}

	/**
	 * 是否应该采样（基于采样率）
	 */
	shouldSample(rate = 1.0) {
		return Math.random() < rate;
	}
}

/**
 * 错误监控类
 */
class ErrorMonitor {
	constructor(config) {
		this.config = config;
		this.logger = getLogger();
		this.sentryInitialized = false;
	}

	/**
	 * 初始化 Sentry（如果配置）
	 */
	async initSentry() {
		if (!this.config.sentryEnabled || this.sentryInitialized) {
			return;
		}

		try {
			// Sentry for Cloudflare Workers 初始化
			// 注意：需要安装 @sentry/cloudflare-workers
			if (typeof Sentry !== 'undefined') {
				Sentry.init({
					dsn: this.config.sentryDsn,
					environment: this.config.sentryEnvironment,
					release: this.config.sentryRelease,
					tracesSampleRate: this.config.traceSampleRate,
					beforeSend: (event) => this._beforeSendSentry(event),
				});

				this.sentryInitialized = true;
				this.logger.info('✅ Sentry initialized', {
					environment: this.config.sentryEnvironment,
					release: this.config.sentryRelease,
				});
			} else {
				this.logger.warn('⚠️ Sentry SDK not loaded');
			}
		} catch (error) {
			this.logger.error('Failed to initialize Sentry', {}, error);
		}
	}

	/**
	 * Sentry beforeSend 钩子（过滤敏感信息）
	 * @private
	 */
	_beforeSendSentry(event) {
		// 移除敏感数据
		if (event.request) {
			if (event.request.headers) {
				delete event.request.headers['authorization'];
				delete event.request.headers['cookie'];
				delete event.request.headers['x-api-key'];
			}
			if (event.request.cookies) {
				event.request.cookies = {};
			}
		}

		// 采样检查
		if (!this.config.shouldSample(this.config.errorSampleRate)) {
			return null; // 丢弃此事件
		}

		return event;
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

		// 发送到 Sentry
		if (this.config.sentryEnabled && this.sentryInitialized) {
			try {
				if (typeof Sentry !== 'undefined') {
					Sentry.captureException(error, {
						level: severity,
						tags: {
							service: this.config.serviceName,
							version: this.config.version,
							environment: this.config.environment,
						},
						extra: context,
					});
				}
			} catch (sentryError) {
				this.logger.warn('Failed to send error to Sentry', {}, sentryError);
			}
		}

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

		if (this.config.sentryEnabled && this.sentryInitialized) {
			try {
				if (typeof Sentry !== 'undefined') {
					Sentry.captureMessage(message, {
						level,
						tags: {
							service: this.config.serviceName,
							version: this.config.version,
						},
						extra: context,
					});
				}
			} catch (error) {
				this.logger.warn('Failed to send message to Sentry', {}, error);
			}
		}
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

		if (this.config.sentryEnabled && this.sentryInitialized) {
			try {
				if (typeof Sentry !== 'undefined') {
					Sentry.addBreadcrumb({
						message,
						category,
						data,
						timestamp: Date.now() / 1000,
					});
				}
			} catch {
				// 静默失败
			}
		}
	}

	/**
	 * 设置用户上下文
	 */
	setUser(userId, email = null, username = null) {
		if (this.config.sentryEnabled && this.sentryInitialized) {
			try {
				if (typeof Sentry !== 'undefined') {
					Sentry.setUser({
						id: userId,
						email,
						username,
					});
				}
			} catch {
				// 静默失败
			}
		}
	}

	/**
	 * 清除用户上下文
	 */
	clearUser() {
		if (this.config.sentryEnabled && this.sentryInitialized) {
			try {
				if (typeof Sentry !== 'undefined') {
					Sentry.setUser(null);
				}
			} catch {
				// 静默失败
			}
		}
	}
}

/**
 * 性能监控类
 */
class PerformanceMonitor {
	constructor(config) {
		this.config = config;
		this.logger = getLogger();
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
	constructor(config) {
		this.config = config;
		this.errorMonitor = new ErrorMonitor(config);
		this.performanceMonitor = new PerformanceMonitor(config);
		this.logger = getLogger();
	}

	/**
	 * 初始化监控系统
	 */
	async initialize() {
		this.logger.info('🚀 Initializing monitoring system', {
			sentryEnabled: this.config.sentryEnabled,
			performanceEnabled: this.config.enablePerformanceMonitoring,
			environment: this.config.environment,
		});

		if (this.config.sentryEnabled) {
			await this.errorMonitor.initSentry();
		}
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

/**
 * 获取默认监控实例
 */
export function getMonitoring(env = null) {
	if (!defaultMonitoring) {
		const config = new MonitoringConfig({
			sentryDsn: env?.SENTRY_DSN || null,
			sentryEnabled: !!env?.SENTRY_DSN,
			sentryEnvironment: env?.ENVIRONMENT || 'production',
			sentryRelease: env?.VERSION || '1.3.0',
			errorSampleRate: parseFloat(env?.ERROR_SAMPLE_RATE || '1.0'),
			traceSampleRate: parseFloat(env?.TRACE_SAMPLE_RATE || '0.1'),
			enablePerformanceMonitoring: env?.ENABLE_PERFORMANCE_MONITORING !== 'false',
			slowRequestThreshold: parseInt(env?.SLOW_REQUEST_THRESHOLD || '3000'),
			environment: env?.ENVIRONMENT || 'production',
			serviceName: '2fa',
			version: env?.VERSION || '1.3.0',
		});

		defaultMonitoring = new MonitoringManager(config);
	}

	return defaultMonitoring;
}

/**
 * 重置默认监控实例（主要用于测试）
 */
export function resetMonitoring() {
	defaultMonitoring = null;
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
