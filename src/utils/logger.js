/**
 * 结构化日志系统
 * 提供统一的日志记录、错误追踪和性能监控
 *
 * 日志级别: DEBUG < INFO < WARN < ERROR < FATAL
 * 支持上下文信息、用户标识、性能指标
 */

/**
 * 日志级别枚举
 */
export const LogLevel = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
	FATAL: 4,
};

/**
 * 日志级别名称映射
 */
const LogLevelNames = {
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.ERROR]: 'ERROR',
	[LogLevel.FATAL]: 'FATAL',
};

/**
 * 日志级别图标
 */
const LogLevelIcons = {
	[LogLevel.DEBUG]: '🔍',
	[LogLevel.INFO]: 'ℹ️',
	[LogLevel.WARN]: '⚠️',
	[LogLevel.ERROR]: '❌',
	[LogLevel.FATAL]: '💀',
};

/**
 * Logger 类 - 结构化日志记录器
 */
class Logger {
	constructor(options = {}) {
		this.minLevel = options.minLevel || LogLevel.INFO;
		this.environment = options.environment || 'development';
		this.serviceName = options.serviceName || '2fa';
		this.version = options.version || '1.0.0';
		this.enableConsole = options.enableConsole !== false;
		this.enableRemote = options.enableRemote || false;
		this.remoteEndpoint = options.remoteEndpoint || null;
		this.context = options.context || {};
	}

	/**
	 * 格式化日志消息
	 * @private
	 */
	_formatMessage(level, message, data = {}, error = null) {
		const timestamp = new Date().toISOString();
		const levelName = LogLevelNames[level];
		const icon = LogLevelIcons[level];

		const logEntry = {
			timestamp,
			level: levelName,
			service: this.serviceName,
			version: this.version,
			environment: this.environment,
			message,
			...this.context,
			...data,
		};

		// 添加错误信息
		if (error) {
			logEntry.error = {
				name: error.name,
				message: error.message,
				stack: error.stack,
				cause: error.cause,
			};
		}

		// 添加请求信息（如果存在）
		if (data.request) {
			const req = data.request;
			logEntry.request = {
				method: req.method,
				url: req.url,
				headers: this._sanitizeHeaders(req.headers),
				cf: req.cf, // Cloudflare 特有信息
			};
			delete logEntry.request; // 从顶层移除
		}

		return { logEntry, icon, levelName };
	}

	/**
	 * 清理敏感头信息
	 * @private
	 */
	_sanitizeHeaders(headers) {
		const sanitized = {};
		const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

		if (headers && headers.forEach) {
			headers.forEach((value, key) => {
				const lowerKey = key.toLowerCase();
				if (sensitiveHeaders.includes(lowerKey)) {
					sanitized[key] = '***REDACTED***';
				} else {
					sanitized[key] = value;
				}
			});
		}

		return sanitized;
	}

	/**
	 * 输出日志到控制台
	 * @private
	 */
	_logToConsole(level, icon, levelName, message, logEntry) {
		if (!this.enableConsole) {
			return;
		}

		const consoleMessage = `${icon} [${levelName}] ${message}`;

		switch (level) {
			case LogLevel.DEBUG:
				console.debug(consoleMessage, logEntry);
				break;
			case LogLevel.INFO:
				console.log(consoleMessage, logEntry);
				break;
			case LogLevel.WARN:
				console.warn(consoleMessage, logEntry);
				break;
			case LogLevel.ERROR:
			case LogLevel.FATAL:
				console.error(consoleMessage, logEntry);
				break;
			default:
				console.log(consoleMessage, logEntry);
		}
	}

	/**
	 * 发送日志到远程服务（异步，不阻塞）
	 * @private
	 */
	async _logToRemote(logEntry) {
		if (!this.enableRemote || !this.remoteEndpoint) {
			return;
		}

		try {
			// 非阻塞发送，不等待响应
			fetch(this.remoteEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(logEntry),
			}).catch((err) => {
				// 静默失败，避免日志系统本身产生错误
				console.warn('Failed to send log to remote:', err.message);
			});
		} catch {
			// 静默失败
		}
	}

	/**
	 * 记录日志的通用方法
	 * @private
	 */
	_log(level, message, data = {}, error = null) {
		// 检查日志级别
		if (level < this.minLevel) {
			return;
		}

		const { logEntry, icon, levelName } = this._formatMessage(level, message, data, error);

		// 输出到控制台
		this._logToConsole(level, icon, levelName, message, logEntry);

		// 发送到远程（非阻塞）
		this._logToRemote(logEntry);

		return logEntry;
	}

	/**
	 * DEBUG 级别日志
	 */
	debug(message, data = {}) {
		return this._log(LogLevel.DEBUG, message, data);
	}

	/**
	 * INFO 级别日志
	 */
	info(message, data = {}) {
		return this._log(LogLevel.INFO, message, data);
	}

	/**
	 * WARN 级别日志
	 */
	warn(message, data = {}, error = null) {
		return this._log(LogLevel.WARN, message, data, error);
	}

	/**
	 * ERROR 级别日志
	 */
	error(message, data = {}, error = null) {
		return this._log(LogLevel.ERROR, message, data, error);
	}

	/**
	 * FATAL 级别日志（严重错误）
	 */
	fatal(message, data = {}, error = null) {
		return this._log(LogLevel.FATAL, message, data, error);
	}

	/**
	 * 创建子 Logger（带上下文）
	 */
	child(context = {}) {
		return new Logger({
			minLevel: this.minLevel,
			environment: this.environment,
			serviceName: this.serviceName,
			version: this.version,
			enableConsole: this.enableConsole,
			enableRemote: this.enableRemote,
			remoteEndpoint: this.remoteEndpoint,
			context: { ...this.context, ...context },
		});
	}

	/**
	 * 设置最小日志级别
	 */
	setMinLevel(level) {
		this.minLevel = level;
	}

	/**
	 * 启用/禁用远程日志
	 */
	setRemoteLogging(enabled, endpoint = null) {
		this.enableRemote = enabled;
		if (endpoint) {
			this.remoteEndpoint = endpoint;
		}
	}
}

/**
 * 创建默认 Logger 实例
 */
let defaultLogger = null;

/**
 * 获取默认 Logger 实例
 */
export function getLogger(env = null) {
	if (!defaultLogger) {
		const minLevel = env?.LOG_LEVEL
			? LogLevel[env.LOG_LEVEL.toUpperCase()]
			: env?.ENVIRONMENT === 'production'
				? LogLevel.INFO
				: LogLevel.DEBUG;

		defaultLogger = new Logger({
			minLevel,
			environment: env?.ENVIRONMENT || 'development',
			serviceName: '2fa',
			version: '2.0.0',
			enableConsole: true,
			enableRemote: env?.LOG_REMOTE_ENDPOINT ? true : false,
			remoteEndpoint: env?.LOG_REMOTE_ENDPOINT || null,
		});
	}
	return defaultLogger;
}

/**
 * 重置默认 Logger（主要用于测试）
 */
export function resetLogger() {
	defaultLogger = null;
}

/**
 * 快捷日志方法
 */
export const log = {
	debug: (message, data) => getLogger().debug(message, data),
	info: (message, data) => getLogger().info(message, data),
	warn: (message, data, error) => getLogger().warn(message, data, error),
	error: (message, data, error) => getLogger().error(message, data, error),
	fatal: (message, data, error) => getLogger().fatal(message, data, error),
};

/**
 * 性能计时器
 */
export class PerformanceTimer {
	constructor(name, logger = null) {
		this.name = name;
		this.logger = logger || getLogger();
		this.startTime = Date.now();
		this.checkpoints = [];
	}

	/**
	 * 添加检查点
	 */
	checkpoint(label) {
		const elapsed = Date.now() - this.startTime;
		this.checkpoints.push({ label, elapsed });
		this.logger.debug(`⏱️ [${this.name}] Checkpoint: ${label}`, { elapsed });
		return elapsed;
	}

	/**
	 * 结束计时并记录
	 */
	end(data = {}) {
		const totalTime = Date.now() - this.startTime;

		this.logger.info(`⏱️ [${this.name}] Completed`, {
			duration: totalTime,
			checkpoints: this.checkpoints,
			...data,
		});

		return {
			name: this.name,
			duration: totalTime,
			checkpoints: this.checkpoints,
		};
	}

	/**
	 * 取消计时（不记录）
	 */
	cancel() {
		this.logger.debug(`⏱️ [${this.name}] Cancelled`);
	}
}

/**
 * 请求日志中间件
 * 自动记录 HTTP 请求和响应
 */
export function createRequestLogger(logger = null) {
	const log = logger || getLogger();

	return {
		/**
		 * 记录请求开始
		 */
		logRequest(request, _env = {}) {
			const timer = new PerformanceTimer(`Request ${request.method} ${new URL(request.url).pathname}`, log);

			log.info('📥 Incoming request', {
				method: request.method,
				url: request.url,
				headers: this._sanitizeHeaders(request.headers),
				cf: request.cf,
				userAgent: request.headers.get('user-agent'),
			});

			return timer;
		},

		/**
		 * 记录响应
		 */
		logResponse(timer, response, error = null) {
			const responseData = {
				status: response?.status,
				statusText: response?.statusText,
				headers: response?.headers ? Object.fromEntries(response.headers) : {},
			};

			if (error) {
				log.error('📤 Request failed', responseData, error);
			} else if (response?.status >= 500) {
				log.error('📤 Server error', responseData);
			} else if (response?.status >= 400) {
				log.warn('📤 Client error', responseData);
			} else {
				log.info('📤 Response sent', responseData);
			}

			if (timer) {
				timer.end(responseData);
			}
		},

		_sanitizeHeaders(headers) {
			const sanitized = {};
			const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

			if (headers && headers.forEach) {
				headers.forEach((value, key) => {
					const lowerKey = key.toLowerCase();
					if (sensitiveHeaders.includes(lowerKey)) {
						sanitized[key] = '***REDACTED***';
					} else {
						sanitized[key] = value;
					}
				});
			}

			return sanitized;
		},
	};
}

/**
 * 导出 Logger 类
 */
export { Logger };

/**
 * 使用示例：
 *
 * // 基础使用
 * import { getLogger } from './utils/logger.js';
 * const logger = getLogger(env);
 * logger.info('User logged in', { userId: '123' });
 *
 * // 子 Logger（带上下文）
 * const apiLogger = logger.child({ module: 'api' });
 * apiLogger.error('API failed', { endpoint: '/secrets' }, error);
 *
 * // 性能计时
 * const timer = new PerformanceTimer('Database Query', logger);
 * timer.checkpoint('Connected');
 * // ... 执行操作 ...
 * timer.checkpoint('Query executed');
 * timer.end({ rows: 10 });
 *
 * // 请求日志
 * const requestLogger = createRequestLogger(logger);
 * const timer = requestLogger.logRequest(request, env);
 * // ... 处理请求 ...
 * requestLogger.logResponse(timer, response);
 */
