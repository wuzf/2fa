/**
 * 验证工具模块
 * 提供各种验证功能和请求验证中间件
 */

import { createErrorResponse } from './response.js';

// ==================== 验证中间件系统 ====================

/**
 * Schema 验证器类
 * 用于定义和验证请求数据结构
 */
class Schema {
	constructor(definition) {
		this.definition = definition;
	}

	/**
	 * 验证数据是否符合schema定义
	 * @param {Object} data - 要验证的数据
	 * @returns {Object} { valid: boolean, errors: string[], data: Object }
	 */
	validate(data) {
		const errors = [];
		const validated = {};

		for (const [field, rules] of Object.entries(this.definition)) {
			const value = data[field];

			// 处理必填字段
			if (rules.required && (value === undefined || value === null || value === '')) {
				errors.push(rules.message || `字段 "${field}" 是必填项`);
				continue;
			}

			// 可选字段且未提供值，使用默认值
			if (!rules.required && (value === undefined || value === null)) {
				if (rules.default !== undefined) {
					validated[field] = rules.default;
				}
				continue;
			}

			// 类型验证
			if (rules.type && value !== undefined && value !== null) {
				const typeValid = this._validateType(value, rules.type);
				if (!typeValid) {
					errors.push(`字段 "${field}" 类型错误，期望 ${rules.type}`);
					continue;
				}
			}

			// 自定义验证函数
			if (rules.validator) {
				const result = rules.validator(value, data);
				if (result !== true) {
					errors.push(typeof result === 'string' ? result : `字段 "${field}" 验证失败`);
					continue;
				}
			}

			// 值转换
			let finalValue = value;
			if (rules.transform) {
				finalValue = rules.transform(value);
			}

			validated[field] = finalValue;
		}

		return {
			valid: errors.length === 0,
			errors,
			data: validated,
		};
	}

	_validateType(value, type) {
		switch (type) {
			case 'string':
				return typeof value === 'string';
			case 'number':
				return typeof value === 'number' && !isNaN(value);
			case 'boolean':
				return typeof value === 'boolean';
			case 'array':
				return Array.isArray(value);
			case 'object':
				return typeof value === 'object' && !Array.isArray(value);
			default:
				return true;
		}
	}
}

/**
 * 请求验证中间件
 * 自动解析 JSON body 并验证
 *
 * @param {Schema|Object} schema - 验证规则（Schema实例或定义对象）
 * @returns {Function} 验证中间件函数
 *
 * @example
 * const body = await validateRequest(addSecretSchema)(request, env);
 * if (body instanceof Response) return body; // 验证失败
 * // body 现在是验证并规范化后的数据
 */
export function validateRequest(schema) {
	const schemaInstance = schema instanceof Schema ? schema : new Schema(schema);

	return async (request) => {
		try {
			// 解析请求体
			const body = await request.json();

			// 验证数据
			const result = schemaInstance.validate(body);

			if (!result.valid) {
				return createErrorResponse('请求验证失败', result.errors.join('; '), 400, request);
			}

			// 返回验证后的数据
			return result.data;
		} catch (error) {
			if (error.name === 'SyntaxError') {
				return createErrorResponse('请求格式错误', '无效的JSON格式', 400, request);
			}
			throw error;
		}
	};
}

// ==================== 预定义验证规则 ====================

/**
 * 添加密钥的验证规则
 */
export const addSecretSchema = new Schema({
	name: {
		required: true,
		type: 'string',
		message: '服务名称不能为空',
		transform: (v) => v.trim(),
		validator: (v) => {
			if (v.trim().length > 50) {
				return `服务名称过长，最多支持50个字符（当前：${v.trim().length}）`;
			}
			return true;
		},
	},
	secret: {
		required: true,
		type: 'string',
		message: '密钥不能为空',
		transform: (v) => v.toUpperCase().trim(),
		validator: (v) => {
			const validation = validateBase32(v);
			if (!validation.valid) {
				return `密钥验证失败：${validation.error}`;
			}
			return true;
		},
	},
	account: {
		required: false,
		type: 'string',
		default: '',
		transform: (v) => (v ? v.trim() : ''),
	},
	type: {
		required: false,
		type: 'string',
		default: 'TOTP',
		transform: (v) => v.toUpperCase(),
		validator: (v) => ['TOTP', 'HOTP'].includes(v.toUpperCase()) || '不支持的OTP类型，仅支持TOTP或HOTP',
	},
	digits: {
		required: false,
		type: 'number',
		default: 6,
		transform: (v) => parseInt(v, 10),
		validator: (v) => [6, 8].includes(parseInt(v, 10)) || '验证码位数仅支持6位或8位',
	},
	period: {
		required: false,
		type: 'number',
		default: 30,
		transform: (v) => parseInt(v, 10),
		validator: (v) => [30, 60, 120].includes(parseInt(v, 10)) || 'TOTP周期仅支持30、60或120秒',
	},
	algorithm: {
		required: false,
		type: 'string',
		default: 'SHA1',
		transform: (v) => v.toUpperCase(),
		validator: (v) => ['SHA1', 'SHA256', 'SHA512'].includes(v.toUpperCase()) || '哈希算法仅支持SHA1、SHA256或SHA512',
	},
	counter: {
		required: false,
		type: 'number',
		default: 0,
		transform: (v) => parseInt(v, 10),
		validator: (v) => {
			const num = parseInt(v, 10);
			return (num >= 0 && Number.isInteger(num)) || 'HOTP计数器必须是非负整数';
		},
	},
});

/**
 * 更新密钥的验证规则（与添加相同，但需要ID）
 */
export const updateSecretSchema = new Schema({
	id: {
		required: true,
		type: 'string',
		message: '密钥ID不能为空',
	},
	...addSecretSchema.definition,
});

/**
 * 批量导入验证规则
 */
export const batchImportSchema = new Schema({
	secrets: {
		required: true,
		type: 'array',
		message: '请提供密钥数组',
		validator: (v) => {
			if (!Array.isArray(v)) {
				return '密钥数据必须是数组格式';
			}
			if (v.length === 0) {
				return '密钥数组不能为空';
			}
			if (v.length > 100) {
				return `批量导入数量过多（${v.length}个），单次最多支持100个`;
			}
			return true;
		},
	},
});

/**
 * 备份恢复验证规则
 */
export const restoreBackupSchema = new Schema({
	backupKey: {
		required: true,
		type: 'string',
		message: '备份键不能为空',
		validator: (v) => {
			if (!v.startsWith('backup_') || !v.endsWith('.json')) {
				return '备份文件名格式不正确，应为 backup_YYYY-MM-DD_HH-MM-SS.json';
			}
			return true;
		},
	},
	preview: {
		required: false,
		type: 'boolean',
		default: false,
	},
});

// ==================== 原有验证函数 ====================

/**
 * 验证Base32密钥格式和安全性
 * @param {string} secret - Base32编码的密钥
 * @returns {Object} 验证结果 {valid: boolean, error?: string, warning?: string}
 */
export function validateBase32(secret) {
	if (!secret || !secret.trim()) {
		return { valid: false, error: '密钥不能为空' };
	}

	const cleanSecret = secret.toUpperCase().trim().replace(/\s/g, '');
	const base32Regex = /^[A-Z2-7]+=*$/;

	if (!base32Regex.test(cleanSecret)) {
		return {
			valid: false,
			error: '密钥格式无效，只能包含字母A-Z和数字2-7（例如：JBSWY3DPEHPK3PXP）',
		};
	}

	// 计算解码后的字节长度 (Base32每8个字符编码5个字节)
	const paddingCount = (cleanSecret.match(/=/g) || []).length;
	const encodedLength = cleanSecret.length - paddingCount;
	const byteLength = Math.floor((encodedLength * 5) / 8);
	const bitLength = byteLength * 8;

	if (cleanSecret.length < 8) {
		return {
			valid: false,
			error: `密钥长度过短（${cleanSecret.length}字符），至少需要8字符以确保基本安全性`,
		};
	}

	if (bitLength < 80) {
		return {
			valid: true,
			warning: `密钥强度较弱（${bitLength}位），建议使用至少128位（21字符）的密钥以提高安全性`,
		};
	}

	if (bitLength >= 128) {
		return { valid: true }; // 强密钥，无警告
	}

	return {
		valid: true,
		warning: `密钥强度一般（${bitLength}位），推荐使用128位以上的密钥`,
	};
}

/**
 * 验证密钥数据的完整性
 * @param {Object} secretData - 密钥数据对象
 * @returns {Object} 验证结果 {valid: boolean, error?: string}
 */
export function validateSecretData(secretData) {
	const { name, secret } = secretData;

	if (!name || !name.trim()) {
		return { valid: false, error: '服务名称不能为空，请输入服务提供商名称（如：GitHub、Google、Microsoft等）' };
	}

	if (name.trim().length > 50) {
		return { valid: false, error: `服务名称"${name.trim()}"过长，最多支持50个字符` };
	}

	if (!secret || !secret.trim()) {
		return { valid: false, error: '密钥不能为空，请输入2FA应用提供的Base32格式密钥' };
	}

	const secretValidation = validateBase32(secret);
	if (!secretValidation.valid) {
		return { valid: false, error: `密钥验证失败：${secretValidation.error}` };
	}

	// 如果有安全警告，也包含在返回结果中
	if (secretValidation.warning) {
		return {
			valid: true,
			warning: `密钥安全提醒：${secretValidation.warning}`,
		};
	}

	return { valid: true };
}

/**
 * 验证OTP参数的有效性
 * @param {Object} params - OTP参数
 * @param {string} params.type - OTP类型 (TOTP/HOTP)
 * @param {number} params.digits - 验证码位数
 * @param {number} params.period - TOTP周期（秒）
 * @param {string} params.algorithm - 哈希算法 (SHA1/SHA256/SHA512)
 * @param {number} params.counter - HOTP计数器值
 * @returns {Object} 验证结果 {valid: boolean, error?: string}
 */
export function validateOTPParams({ type = 'TOTP', digits = 6, period = 30, algorithm = 'SHA1', counter = 0 }) {
	// 验证OTP类型
	const validTypes = ['TOTP', 'HOTP'];
	const normalizedType = type.toUpperCase();

	if (!validTypes.includes(normalizedType)) {
		return {
			valid: false,
			error: `不支持的OTP类型"${type}"，请选择以下类型之一：TOTP（时间基准）或HOTP（计数器基准）`,
		};
	}

	// 验证验证码位数
	if (![6, 8].includes(digits)) {
		return {
			valid: false,
			error: `验证码位数设置为${digits}位无效，仅支持6位或8位数字验证码`,
		};
	}

	// 验证TOTP周期
	if (normalizedType === 'TOTP' && ![30, 60, 120].includes(period)) {
		return {
			valid: false,
			error: `TOTP刷新周期设置为${period}秒无效，仅支持30秒、60秒或120秒`,
		};
	}

	// 验证哈希算法
	const validAlgorithms = ['SHA1', 'SHA256', 'SHA512'];
	const normalizedAlgorithm = algorithm.toUpperCase();

	if (!validAlgorithms.includes(normalizedAlgorithm)) {
		return {
			valid: false,
			error: `哈希算法"${algorithm}"不受支持，请选择SHA1、SHA256或SHA512算法`,
		};
	}

	// 验证HOTP计数器
	if (normalizedType === 'HOTP' && (counter < 0 || !Number.isInteger(counter))) {
		return {
			valid: false,
			error: `HOTP计数器值"${counter}"无效，必须是大于或等于0的整数（如：0, 1, 2...）`,
		};
	}

	return { valid: true };
}

/**
 * 创建标准化的密钥对象
 * @param {Object} data - 密钥数据
 * @param {string} data.name - 服务名称
 * @param {string} data.service - 账户名称（可选）
 * @param {string} data.secret - Base32密钥
 * @param {string} data.type - OTP类型
 * @param {number} data.digits - 验证码位数
 * @param {number} data.period - TOTP周期
 * @param {string} data.algorithm - 哈希算法
 * @param {number} data.counter - HOTP计数器
 * @param {string} existingId - 现有ID（用于更新）
 * @returns {Object} 标准化的密钥对象
 */
export function createSecretObject(
	{ name, service, secret, type = 'TOTP', digits = 6, period = 30, algorithm = 'SHA1', counter = 0 },
	existingId = null,
) {
	const normalizedType = type.toUpperCase();

	const secretObject = {
		id: existingId || crypto.randomUUID(),
		name: name.trim(),
		account: service ? service.trim() : '',
		secret: secret.toUpperCase().trim(),
		type: normalizedType,
		digits: parseInt(digits),
		period: parseInt(period),
		algorithm: algorithm.toUpperCase(),
		counter: normalizedType === 'HOTP' ? parseInt(counter) : undefined,
	};

	// 如果是新建密钥，添加创建时间
	if (!existingId) {
		secretObject.createdAt = new Date().toISOString();
	}

	return secretObject;
}

/**
 * 按服务名称排序密钥列表
 * @param {Array} secrets - 密钥数组
 * @returns {Array} 排序后的密钥数组
 */
export function sortSecretsByName(secrets) {
	return secrets.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * 检查密钥是否重复
 * 只有当服务名+账户名+密钥都相同时才视为重复
 * @param {Array} secrets - 密钥数组
 * @param {string} name - 服务名称
 * @param {string} account - 账户名称
 * @param {string} secret - 密钥
 * @param {number} excludeIndex - 要排除的索引（用于更新时排除自己）
 * @returns {boolean} 是否存在重复
 */
export function checkDuplicateSecret(secrets, name, account, secret = '', excludeIndex = -1) {
	// 规范化密钥用于比较（移除空格，转大写）
	const normalizedSecret = secret.replace(/\s+/g, '').toUpperCase();

	return secrets.some((s, index) => {
		if (index === excludeIndex) {
			return false;
		}
		const existingSecret = (s.secret || '').replace(/\s+/g, '').toUpperCase();
		// 只有名称、账户、密钥都相同时才视为重复
		return s.name === name && s.account === account && existingSecret === normalizedSecret;
	});
}
