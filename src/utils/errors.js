/**
 * 统一错误分类系统
 * 提供一致的错误处理和响应格式
 */

/**
 * 应用基础错误类
 * 所有自定义错误的基类
 */
export class AppError extends Error {
	/**
	 * @param {string} message - 错误消息（用户友好）
	 * @param {number} statusCode - HTTP 状态码
	 * @param {Object} details - 额外的错误详情（可选）
	 * @param {boolean} isOperational - 是否为可操作的错误（vs 程序错误）
	 */
	constructor(message, statusCode = 500, details = {}, isOperational = true) {
		super(message);

		// 维护正确的堆栈跟踪（V8引擎）
		Error.captureStackTrace(this, this.constructor);

		this.name = this.constructor.name;
		this.statusCode = statusCode;
		this.details = details;
		this.isOperational = isOperational; // 区分可恢复的业务错误 vs 程序bug
		this.timestamp = new Date().toISOString();
	}

	/**
	 * 转换为 HTTP 响应格式
	 */
	toJSON() {
		return {
			error: this.name,
			message: this.message,
			statusCode: this.statusCode,
			details: this.details,
			timestamp: this.timestamp,
		};
	}
}

/**
 * 认证错误 (401 Unauthorized)
 * 用于：未认证、Token失效、密码错误等
 */
export class AuthenticationError extends AppError {
	constructor(message = '认证失败', details = {}) {
		super(message, 401, details);
	}
}

/**
 * 授权错误 (403 Forbidden)
 * 用于：权限不足、禁止访问等
 */
export class AuthorizationError extends AppError {
	constructor(message = '权限不足', details = {}) {
		super(message, 403, details);
	}
}

/**
 * 验证错误 (400 Bad Request)
 * 用于：输入验证失败、格式错误、参数缺失等
 */
export class ValidationError extends AppError {
	constructor(message = '数据验证失败', details = {}) {
		super(message, 400, details);
	}
}

/**
 * 资源未找到错误 (404 Not Found)
 * 用于：请求的资源不存在
 */
export class NotFoundError extends AppError {
	constructor(resource = '资源', details = {}) {
		super(`${resource}不存在`, 404, details);
	}
}

/**
 * 冲突错误 (409 Conflict)
 * 用于：资源已存在、状态冲突等
 */
export class ConflictError extends AppError {
	constructor(message = '资源冲突', details = {}) {
		super(message, 409, details);
	}
}

/**
 * 速率限制错误 (429 Too Many Requests)
 * 用于：请求频率超限
 */
export class RateLimitError extends AppError {
	constructor(message = '请求过于频繁', details = {}) {
		super(message, 429, details);
	}
}

/**
 * 加密/解密错误 (500 Internal Server Error)
 * 用于：加密、解密、签名等操作失败
 */
export class CryptoError extends AppError {
	constructor(message = '加密操作失败', details = {}) {
		super(message, 500, details);
	}
}

/**
 * 数据库/存储错误 (500 Internal Server Error)
 * 用于：KV存储、数据库操作失败
 */
export class StorageError extends AppError {
	constructor(message = '存储操作失败', details = {}) {
		super(message, 500, details);
	}
}

/**
 * 配置错误 (500 Internal Server Error)
 * 用于：缺少必需的配置、配置格式错误
 * 注意：这是程序错误，不是操作错误
 */
export class ConfigurationError extends AppError {
	constructor(message = '配置错误', details = {}) {
		super(message, 500, details, false); // isOperational = false
	}
}

/**
 * 外部服务错误 (502 Bad Gateway / 503 Service Unavailable)
 * 用于：第三方API调用失败、外部服务不可用
 */
export class ExternalServiceError extends AppError {
	constructor(message = '外部服务错误', statusCode = 502, details = {}) {
		super(message, statusCode, details);
	}
}

/**
 * 业务逻辑错误 (400 Bad Request)
 * 用于：不符合业务规则的操作
 */
export class BusinessLogicError extends AppError {
	constructor(message = '操作不符合业务规则', details = {}) {
		super(message, 400, details);
	}
}

/**
 * 判断错误是否为可操作的（业务错误）
 * @param {Error} error
 * @returns {boolean}
 */
export function isOperationalError(error) {
	if (error instanceof AppError) {
		return error.isOperational;
	}
	return false;
}

/**
 * 从错误对象创建标准响应
 * @param {Error} error - 错误对象
 * @param {Request} request - 请求对象（可选）
 * @returns {Response} HTTP响应
 */
export function errorToResponse(error, _request = null) {
	// 导入 response 工具
	// 注意：为避免循环依赖，这里内联实现
	const getSecurityHeaders = () => {
		return {
			'Content-Type': 'application/json',
			'X-Content-Type-Options': 'nosniff',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};
	};

	if (error instanceof AppError) {
		return new Response(JSON.stringify(error.toJSON()), {
			status: error.statusCode,
			headers: getSecurityHeaders(),
		});
	}

	// 未知错误 - 不暴露内部细节
	return new Response(
		JSON.stringify({
			error: 'InternalServerError',
			message: '服务器内部错误',
			statusCode: 500,
			timestamp: new Date().toISOString(),
		}),
		{
			status: 500,
			headers: getSecurityHeaders(),
		},
	);
}

/**
 * 错误日志记录辅助函数
 * @param {Error} error
 * @param {Object} logger - 日志记录器
 * @param {Object} context - 上下文信息
 */
export function logError(error, logger, context = {}) {
	const errorInfo = {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...context,
	};

	if (error instanceof AppError) {
		errorInfo.statusCode = error.statusCode;
		errorInfo.details = error.details;
		errorInfo.isOperational = error.isOperational;

		if (error.isOperational) {
			// 操作错误（业务错误）- 使用 warn 级别
			logger.warn(error.message, errorInfo);
		} else {
			// 程序错误 - 使用 error 级别
			logger.error(error.message, errorInfo, error);
		}
	} else {
		// 未知错误 - 使用 error 级别
		logger.error('未捕获的错误', errorInfo, error);
	}
}

/**
 * 错误工厂函数 - 用于快速创建常见错误
 */
export const ErrorFactory = {
	/**
	 * JWT相关错误
	 */
	jwtExpired: (details = {}) => new AuthenticationError('JWT已过期，请重新登录', details),

	jwtInvalid: (details = {}) => new AuthenticationError('JWT无效', details),

	jwtMissing: (details = {}) => new AuthenticationError('未提供认证凭证', details),

	/**
	 * 密码相关错误
	 */
	passwordWeak: (message, details = {}) => new ValidationError(message, details),

	passwordIncorrect: (details = {}) => new AuthenticationError('密码错误', details),

	/**
	 * 资源相关错误
	 */
	secretNotFound: (id, details = {}) => new NotFoundError('密钥', { secretId: id, ...details }),

	backupNotFound: (key, details = {}) => new NotFoundError('备份文件', { backupKey: key, ...details }),

	/**
	 * 加密相关错误
	 */
	encryptionFailed: (details = {}) => new CryptoError('数据加密失败', details),

	decryptionFailed: (details = {}) => new CryptoError('数据解密失败', details),

	/**
	 * 速率限制错误
	 */
	rateLimitExceeded: (limit, resetAt, details = {}) =>
		new RateLimitError('请求过于频繁，请稍后再试', {
			limit,
			resetAt,
			...details,
		}),

	/**
	 * 配置错误
	 */
	missingConfig: (configName, details = {}) => new ConfigurationError(`缺少必需的配置: ${configName}`, details),

	/**
	 * 存储错误
	 */
	storageFailed: (operation, details = {}) => new StorageError(`存储操作失败: ${operation}`, details),
};

/**
 * 使用示例：
 *
 * // 基本使用
 * throw new ValidationError('密码长度不足', { minLength: 8 });
 *
 * // 使用工厂函数
 * throw ErrorFactory.jwtExpired({ token: 'abc123' });
 *
 * // 错误处理
 * try {
 *   // ... 操作
 * } catch (error) {
 *   if (error instanceof AuthenticationError) {
 *     // 处理认证错误
 *   }
 *   return errorToResponse(error, request);
 * }
 *
 * // 错误日志
 * logError(error, logger, { operation: 'login', userId: 123 });
 */
