/**
 * 验证工具模块
 * 提供各种验证功能和请求验证中间件
 */

import { createErrorResponse } from './response.js';
import { LIMITS } from './constants.js';
import { normalizeGenerationParts } from '../api/secrets/counter-state.js';

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
			if (!v.trim()) {
				return '服务名称不能为空';
			}
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
		validator: (v) => (v >= 0 && Number.isSafeInteger(v)) || 'HOTP计数器必须是非负安全整数',
	},
});

/**
 * HOTP counter advance request validation rules.
 */
export const advanceHOTPCounterSchema = new Schema({
	expectedNamespace: {
		required: false,
		type: 'string',
		default: null,
		validator: (v) => v.length > 0 || 'expectedNamespace必须是非空字符串',
	},
	expectedCounter: {
		required: true,
		type: 'number',
		validator: (v) => (v >= 0 && Number.isSafeInteger(v)) || 'expectedCounter必须是非负安全整数',
	},
	expectedSecret: {
		required: true,
		type: 'string',
		transform: (v) => v.toUpperCase().trim(),
		validator: (v) => validateBase32(v).valid || 'expectedSecret不是有效的Base32密钥',
	},
	expectedDigits: {
		required: true,
		type: 'number',
		validator: (v) => [6, 8].includes(v) || 'expectedDigits仅支持6位或8位',
	},
	expectedAlgorithm: {
		required: true,
		type: 'string',
		transform: (v) => v.toUpperCase(),
		validator: (v) => ['SHA1', 'SHA256', 'SHA512'].includes(v.toUpperCase()) || 'expectedAlgorithm仅支持SHA1、SHA256或SHA512',
	},
});

const isOmittedField = (value) => value === undefined || value === null;

/**
 * Read a stored value the way the web UI does. Type and algorithm ignore letter case, and the
 * algorithm also ignores the hyphen ("SHA-256"). Numbers may be stored as digit strings. A
 * missing, empty or zero digit count or period means "not set".
 * @returns {*} the value to use, or undefined when the stored record does not set the field
 */
function readStoredSecretField(field, value) {
	if (isOmittedField(value)) {
		return undefined;
	}
	if ((field === 'type' || field === 'algorithm') && typeof value === 'string') {
		const upper = value.trim().toUpperCase();
		return field === 'algorithm' ? upper.replace('-', '') : upper;
	}
	if (field === 'digits' || field === 'period' || field === 'counter') {
		const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
		return field !== 'counter' && (number === 0 || number === '') ? undefined : number;
	}
	return value;
}

/**
 * PUT is a partial update: an omitted (or null) optional field keeps the value stored in the
 * record, and the merged record is then validated as a whole. Omitting a field is therefore the
 * same as sending its stored value. A field the record does not set gets the add default.
 *
 * - account, type, digits and algorithm always keep the stored value.
 * - period and counter keep it only while the type stays the same, because they belong to one
 *   type: when the type changes, the add defaults apply (period 30, counter 0).
 *   - TOTP keeps its period (a period that cannot be kept fails validation) but not the counter,
 *     which TOTP records do not save.
 *   - HOTP keeps its counter while the secret, digits and algorithm stay the same (otherwise an omitted
 *     counter restarts at 0), and its period when that is a safe integer; otherwise the unused
 *     period falls back to 30.
 */
function mergeStoredSecretFields(data, existingSecret) {
	if (!data || typeof data !== 'object' || Array.isArray(data) || !existingSecret) {
		return data;
	}

	const merged = { ...data };
	const keep = (field, accept = () => true) => {
		const stored = readStoredSecretField(field, existingSecret[field]);
		if (isOmittedField(merged[field]) && stored !== undefined && accept(stored)) {
			merged[field] = stored;
		}
	};
	['account', 'type', 'digits', 'algorithm'].forEach((field) => keep(field));

	const storedType = String(existingSecret.type || 'TOTP').toUpperCase();
	const requestedType = typeof merged.type === 'string' ? merged.type.toUpperCase() : isOmittedField(merged.type) ? 'TOTP' : null;
	if (requestedType === storedType && storedType === 'TOTP') {
		keep('period');
	}
	if (requestedType === storedType && storedType === 'HOTP') {
		// 省略的计数器只在生成参数（密钥、位数、算法）不变时沿用；换了参数就是新的计数序列，从 0 开始
		const sameGeneration = JSON.stringify(normalizeGenerationParts(merged)) === JSON.stringify(normalizeGenerationParts(existingSecret));
		if (sameGeneration) {
			keep('counter');
		} else if (isOmittedField(merged.counter)) {
			merged.counter = 0;
		}
		keep('period', Number.isSafeInteger);
	}

	return merged;
}

class EditSecretSchema extends Schema {
	constructor(definition, existingSecret) {
		super(definition);
		this.existingSecret = existingSecret;
	}

	validate(data) {
		return super.validate(mergeStoredSecretFields(data, this.existingSecret));
	}
}

/**
 * 编辑已有密钥时的验证规则：与添加相同，只有两处不同。
 *
 * 1. 部分更新：省略（或为 null）的可选字段沿用记录当前保存的值，合并后的整条记录再按下面的规则校验，
 *    见 mergeStoredSecretFields()。
 * 2. 周期例外：从备份恢复的记录可能保存着 30、60、120 以外的周期；类型不变且原样提交（或省略）该周期时，
 *    视为保留原值，以便修改其他字段：
 *    - TOTP：现存周期须为正安全整数（周期参与生成验证码）；
 *    - HOTP：现存周期为任意安全整数即可（HOTP 不使用周期，旧备份可能存为 0）。
 *    其他周期值（包括把标准周期改成非标准值、同时切换类型）照常校验。
 *
 * @param {Object} existingSecret - 当前存储的记录
 * @returns {Schema}
 */
export function createEditSecretSchema(existingSecret) {
	const periodRules = addSecretSchema.definition.period;
	const storedPeriod = existingSecret?.period;
	const storedType = String(existingSecret?.type || 'TOTP').toUpperCase();
	const storedPeriodIsKeepable =
		Number.isSafeInteger(storedPeriod) && (storedType === 'HOTP' || (storedType === 'TOTP' && storedPeriod > 0));

	return new EditSecretSchema(
		{
			...addSecretSchema.definition,
			period: {
				...periodRules,
				validator: (value, data) => {
					const result = periodRules.validator(value, data);
					if (result === true) {
						return true;
					}
					const requestedType = String(data?.type ?? 'TOTP').toUpperCase();
					const keepsStoredPeriod = storedPeriodIsKeepable && requestedType === storedType && value === storedPeriod;
					return keepsStoredPeriod || result;
				},
			},
		},
		existingSecret,
	);
}

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
			if (v.length > LIMITS.BULK_IMPORT_CHUNK_SIZE) {
				return `批量导入数量过多（${v.length}个），单次最多支持${LIMITS.BULK_IMPORT_CHUNK_SIZE}个`;
			}
			return true;
		},
	},
	immediateBackup: {
		required: false,
		type: 'boolean',
		default: true,
	},
	chunkIndex: {
		required: false,
		type: 'number',
		validator: (v) => (Number.isInteger(v) && v >= 1) || 'chunkIndex 必须是大于等于 1 的整数',
	},
	chunkCount: {
		required: false,
		type: 'number',
		validator: (v) => (Number.isInteger(v) && v >= 1) || 'chunkCount 必须是大于等于 1 的整数',
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
			if (!/^backup_\d{4}-\d{2}-\d{2}(?:_[\w-]+)?\.(?:json|txt|csv|html)$/.test(v)) {
				return '备份文件名格式不正确，应为 backup_YYYY-MM-DD_HH-MM-SS-mmm-xxxx.(json|txt|csv|html)';
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

/**
 * WebDAV 配置验证规则
 */
export const webdavConfigSchema = new Schema({
	id: { required: false, type: 'string' },
	name: {
		required: true,
		type: 'string',
		message: '目标名称不能为空',
		transform: (v) => v.trim(),
		validator: (v) => {
			if (v.trim().length > 30) {
				return `目标名称过长，最多支持30个字符（当前：${v.trim().length}）`;
			}
			return true;
		},
	},
	url: {
		required: true,
		type: 'string',
		message: 'WebDAV URL 不能为空',
		validator: (v) => {
			try {
				const u = new URL(v);
				return u.protocol === 'https:' || 'URL 必须使用 HTTPS';
			} catch {
				return 'URL 格式无效';
			}
		},
		transform: (v) => v.replace(/\/+$/, ''),
	},
	username: { required: true, type: 'string', message: '用户名不能为空' },
	password: { required: false, type: 'string', default: '' },
	path: {
		required: false,
		type: 'string',
		default: '/',
		transform: (v) => {
			const p = v.trim().replace(/\/+/g, '/').replace(/\/+$/, '');
			return p.startsWith('/') ? p || '/' : '/' + p;
		},
	},
});

/**
 * S3 配置验证规则
 */
export const s3ConfigSchema = new Schema({
	id: { required: false, type: 'string' },
	name: {
		required: true,
		type: 'string',
		message: '目标名称不能为空',
		transform: (v) => v.trim(),
		validator: (v) => {
			if (v.trim().length > 30) {
				return `目标名称过长，最多支持30个字符（当前：${v.trim().length}）`;
			}
			return true;
		},
	},
	endpoint: {
		required: true,
		type: 'string',
		message: 'Endpoint 不能为空',
		validator: (v) => {
			try {
				const u = new URL(v);
				return u.protocol === 'https:' || 'URL 必须使用 HTTPS';
			} catch {
				return 'URL 格式无效';
			}
		},
		transform: (v) => v.replace(/\/+$/, ''),
	},
	bucket: { required: true, type: 'string', message: 'Bucket 不能为空' },
	region: { required: false, type: 'string', default: 'auto' },
	accessKeyId: { required: true, type: 'string', message: 'Access Key ID 不能为空' },
	secretAccessKey: { required: false, type: 'string', default: '' },
	prefix: {
		required: false,
		type: 'string',
		default: '',
		transform: (v) => {
			if (!v || !v.trim()) {
				return '';
			}
			const p = v.trim().replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
			return p ? p + '/' : '';
		},
	},
});

/**
 * OAuth 网盘配置验证规则
 */
export const cloudDriveConfigSchema = new Schema({
	id: { required: false, type: 'string' },
	name: {
		required: true,
		type: 'string',
		message: '目标名称不能为空',
		transform: (v) => v.trim(),
		validator: (v) => {
			if (v.trim().length > 30) {
				return `目标名称过长，最多支持30个字符（当前：${v.trim().length}）`;
			}
			return true;
		},
	},
	folderPath: {
		required: false,
		type: 'string',
		default: '/2FA-Backups',
		transform: (v) => {
			const normalized = (v || '/2FA-Backups').trim().replace(/\/+/g, '/').replace(/\/+$/, '');
			return normalized.startsWith('/') ? normalized || '/' : '/' + normalized;
		},
		validator: (v) => {
			const normalized = (v || '/2FA-Backups').trim().replace(/\/+/g, '/').replace(/\/+$/, '');
			const finalPath = normalized.startsWith('/') ? normalized || '/' : '/' + normalized;

			if (finalPath.length > 200) {
				return '备份目录过长，最多支持 200 个字符';
			}

			const segments = finalPath.split('/').filter(Boolean);
			if (segments.some((segment) => segment === '.' || segment === '..')) {
				return '备份目录不能包含 "." 或 ".."';
			}

			return true;
		},
	},
});

/**
 * 仅包含目标 ID 的验证规则
 */
export const destinationIdSchema = new Schema({
	id: { required: true, type: 'string', message: '目标 ID 不能为空' },
});

/**
 * 目标启用/禁用切换验证规则
 */
export const toggleDestinationSchema = new Schema({
	id: { required: true, type: 'string', message: '目标 ID 不能为空' },
	enabled: { required: true, type: 'boolean', message: '启用状态不能为空' },
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
	if (normalizedType === 'HOTP' && (counter < 0 || !Number.isSafeInteger(counter))) {
		return {
			valid: false,
			error: `HOTP计数器值"${counter}"无效，必须是大于或等于0的安全整数（如：0, 1, 2...）`,
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
 * 查找重复的密钥记录
 * 只有当服务名+账户名+密钥都相同时才视为重复
 * @param {Array} secrets - 密钥数组
 * @param {string} name - 服务名称
 * @param {string} account - 账户名称
 * @param {string} secret - 密钥
 * @param {number} excludeIndex - 要排除的索引（用于更新时排除自己）
 * @returns {Object|undefined} 重复的现有记录；没有时为 undefined
 */
export function findDuplicateSecret(secrets, name, account, secret = '', excludeIndex = -1) {
	// 规范化密钥用于比较（移除空格，转大写）
	const normalizedSecret = secret.replace(/\s+/g, '').toUpperCase();

	return secrets.find((s, index) => {
		if (index === excludeIndex) {
			return false;
		}
		const existingSecret = (s.secret || '').replace(/\s+/g, '').toUpperCase();
		// 只有名称、账户、密钥都相同时才视为重复
		return s.name === name && s.account === account && existingSecret === normalizedSecret;
	});
}

/**
 * 检查密钥是否重复，规则见 findDuplicateSecret()
 * @returns {boolean} 是否存在重复
 */
export function checkDuplicateSecret(secrets, name, account, secret = '', excludeIndex = -1) {
	return findDuplicateSecret(secrets, name, account, secret, excludeIndex) !== undefined;
}

/**
 * Whether a stored record generates the same codes as a validated add request: type, digits
 * and algorithm match, and for TOTP also the period. The HOTP counter is not compared.
 * Stored values are read like the web UI reads them: a missing, empty or zero value means the
 * default, and an unusable value (e.g. digits "abc") never matches.
 * @param {Object} existing - stored record
 * @param {Object} requested - request data validated by addSecretSchema
 * @returns {boolean}
 */
export function hasSameOtpParameters(existing, requested) {
	const type = String(existing?.type || 'TOTP').toUpperCase();
	const digits = Number(existing?.digits || 6);
	const algorithm = String(existing?.algorithm || 'SHA1')
		.toUpperCase()
		.replace('-', '');
	const sameParameters = type === requested.type && digits === requested.digits && algorithm === requested.algorithm;

	return sameParameters && (type !== 'TOTP' || Number(existing?.period || 30) === requested.period);
}
