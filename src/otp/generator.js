/**
 * OTP（一次性密码）生成模块
 * 实现TOTP（时间基准一次性密码）算法
 */

import { getLogger } from '../utils/logger.js';

/**
 * 生成 OTP 验证码（支持 TOTP、HOTP）
 * @param {string} secret - Base32编码的密钥
 * @param {number} loadTime - 页面加载时间戳
 * @param {Object} options - 可选参数
 * @param {number} options.digits - OTP位数，默认6
 * @param {number} options.period - 时间步长（秒），默认30
 * @param {string} options.algorithm - 算法，默认SHA1
 * @param {string} options.type - OTP类型：TOTP、HOTP，默认TOTP
 * @param {number} options.counter - HOTP计数器（仅HOTP需要）
 * @param {Object} options.env - 环境变量对象（可选，用于日志）
 * @returns {Promise<string>} OTP验证码
 */
export async function generateOTP(secret, loadTime, options = {}) {
	const logger = options.env ? getLogger(options.env) : null;

	try {
		const digits = options.digits || 6;
		const period = options.period || 30;
		const algorithm = options.algorithm || 'SHA1';
		const type = options.type || 'TOTP';

		let counter;

		// 根据类型计算 counter
		switch (type.toUpperCase()) {
			case 'HOTP':
				counter = options.counter || 0;
				break;
			case 'TOTP':
			default: {
				// 如果提供了 loadTime，直接使用它（用于测试和客户端预览）
				// 否则使用当前时间
				const timeForCalculation = loadTime || Math.floor(Date.now() / 1000);
				counter = Math.floor(timeForCalculation / period);
				break;
			}
		}

		// 将counter转换为8字节大端序数组
		const counterBytes = new ArrayBuffer(8);
		const counterView = new DataView(counterBytes);

		// 将 counter 分解为高 32 位和低 32 位（大端序）
		// JavaScript 数字是 64 位浮点数，但整数运算精确到 53 位
		// 对于超大的计数器值，需要正确拆分为两个 32 位值
		const highBits = Math.floor(counter / 0x100000000); // 高 32 位
		const lowBits = counter >>> 0; // 低 32 位（无符号右移确保正数）

		counterView.setUint32(0, highBits, false); // 偏移 0：高 32 位（大端序）
		counterView.setUint32(4, lowBits, false); // 偏移 4：低 32 位（大端序）

		const secretBytes = base32toByteArray(secret);

		// 支持多种哈希算法
		const hashAlgorithm = getHashAlgorithm(algorithm);

		const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: { name: hashAlgorithm } }, false, ['sign']);

		const hmacBuffer = await crypto.subtle.sign('HMAC', key, counterBytes);
		const hmacArray = Array.from(new Uint8Array(hmacBuffer));

		const offset = hmacArray[hmacArray.length - 1] & 0xf;
		const truncatedHash = hmacArray.slice(offset, offset + 4);
		const otpValue = new DataView(new Uint8Array(truncatedHash).buffer).getUint32(0) & 0x7fffffff;

		// 生成标准数字 OTP
		const modulus = Math.pow(10, digits);
		const otp = (otpValue % modulus).toString().padStart(digits, '0');
		return otp;
	} catch (error) {
		if (logger) {
			logger.error(
				'OTP 生成失败',
				{
					errorMessage: error.message,
					type: options.type || 'TOTP',
				},
				error,
			);
		}
		throw new Error('Failed to generate OTP: ' + error.message);
	}
}

/**
 * 获取哈希算法名称
 * @param {string} algorithm - 算法名称
 * @returns {string} Web Crypto API支持的算法名称
 */
export function getHashAlgorithm(algorithm) {
	const algMap = {
		SHA1: 'SHA-1',
		'SHA-1': 'SHA-1',
		SHA256: 'SHA-256',
		'SHA-256': 'SHA-256',
		SHA512: 'SHA-512',
		'SHA-512': 'SHA-512',
	};

	return algMap[algorithm.toUpperCase()] || 'SHA-1';
}

/**
 * 将Base32编码的密钥转换为字节数组
 * @param {string} base32 - Base32编码的字符串
 * @returns {Uint8Array} 转换后的字节数组
 * @throws {Error} 当Base32格式无效时抛出错误
 */
export function base32toByteArray(base32) {
	const charTable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const cleanBase32 = base32.toUpperCase().replace(/=/g, '');

	for (const c of cleanBase32) {
		if (charTable.indexOf(c) === -1) {
			throw new Error('Invalid Base32 character: ' + c);
		}
	}

	const bits = cleanBase32
		.split('')
		.map((char) => {
			const index = charTable.indexOf(char);
			if (index === -1) {
				throw new Error('Invalid Base32 character: ' + char);
			}
			return index.toString(2).padStart(5, '0');
		})
		.join('');

	const bytes = [];
	for (let i = 0; i < bits.length; i += 8) {
		const byte = bits.slice(i, i + 8);
		if (byte.length === 8) {
			bytes.push(parseInt(byte, 2));
		}
	}

	return new Uint8Array(bytes);
}

/**
 * 客户端OTP生成函数（用于预览下一个代码，支持所有类型）
 * @param {string} secret - Base32编码的密钥
 * @param {number} counter - 时间计数器或HOTP计数器
 * @param {Object} options - 可选参数
 * @param {number} options.digits - OTP位数，默认6
 * @param {string} options.algorithm - 算法，默认SHA1
 * @param {string} options.type - OTP类型：TOTP、HOTP，默认TOTP
 * @returns {Promise<string>} OTP验证码
 */
export async function generateTOTP(secret, counter, options = {}) {
	try {
		const digits = options.digits || 6;
		const algorithm = options.algorithm || 'SHA1';
		const _type = options.type || 'TOTP';

		// Base32解码
		const key = base32toByteArray(secret);

		// 将counter转换为8字节数组
		const counterBytes = new ArrayBuffer(8);
		const counterView = new DataView(counterBytes);
		counterView.setUint32(4, counter, false); // 大端序

		// 支持多种哈希算法
		const hashAlgorithm = getHashAlgorithm(algorithm);

		// 使用Web Crypto API进行HMAC
		const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: hashAlgorithm }, false, ['sign']);

		const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
		const hmac = new Uint8Array(signature);

		// 动态截取
		const offset = hmac[hmac.length - 1] & 0x0f;
		const binary =
			((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);

		// 生成标准数字 OTP (TOTP/HOTP)
		const modulus = Math.pow(10, digits);
		const otp = binary % modulus;
		return otp.toString().padStart(digits, '0');
	} catch {
		// 客户端预览失败时返回占位符（不记录日志，避免污染客户端控制台）
		return '-'.repeat(options.digits || 6);
	}
}

/**
 * 生成OTP Auth URL用于二维码
 * @param {string} serviceName - 服务名称
 * @param {string} accountName - 账户名称
 * @param {string} secret - Base32密钥
 * @param {Object} options - 可选参数
 * @param {number} options.digits - OTP位数，默认6
 * @param {number} options.period - 时间步长（秒），默认30
 * @param {string} options.algorithm - 算法，默认SHA1
 * @param {string} options.type - OTP类型：TOTP、HOTP，默认TOTP
 * @param {number} options.counter - HOTP计数器（仅HOTP需要）
 * @returns {string} otpauth:// URL
 */
export function generateOTPAuthURL(serviceName, accountName, secret, options = {}) {
	const digits = options.digits || 6;
	const period = options.period || 30;
	const algorithm = options.algorithm || 'SHA1';
	const type = options.type || 'TOTP';
	const counter = options.counter || 0;

	// 构建标签，格式：服务名:账户名
	const label = serviceName + (accountName ? ':' + encodeURIComponent(accountName) : '');

	// 根据类型构建不同的 URL
	let scheme, params;

	switch (type.toUpperCase()) {
		case 'HOTP':
			scheme = 'hotp';
			params = new URLSearchParams({
				secret: secret.toUpperCase(),
				issuer: serviceName,
				algorithm: algorithm.toUpperCase(),
				digits: digits.toString(),
				counter: counter.toString(),
			});
			break;
		case 'TOTP':
		default:
			scheme = 'totp';
			params = new URLSearchParams({
				secret: secret.toUpperCase(),
				issuer: serviceName,
				algorithm: algorithm.toUpperCase(),
				digits: digits.toString(),
				period: period.toString(),
			});
			break;
	}

	return `otpauth://${scheme}/${encodeURIComponent(label)}?${params.toString()}`;
}
