/**
 * 数据加密/解密工具模块
 * 使用 AES-GCM 256位加密算法保护敏感数据
 *
 * 配置说明：
 * - ENCRYPTION_KEY 是可选配置项
 * - 如果配置了 ENCRYPTION_KEY，数据将被加密存储（推荐）
 * - 如果未配置 ENCRYPTION_KEY，数据将以明文存储
 * - 可以随时从明文模式切换到加密模式，但反向切换会导致无法读取已加密的数据
 *
 * 安全特性：
 * - AES-GCM：现代、快速、带认证的加密算法
 * - 256位密钥：业界标准的强加密
 * - 随机IV：每次加密使用不同的初始化向量
 * - 认证标签：防止数据被篡改
 */

import { ValidationError, ConfigurationError, ErrorFactory } from './errors.js';

/**
 * 从环境变量获取加密密钥（内部函数）
 * @param {Object} env - 环境变量对象
 * @returns {Promise<CryptoKey>} 加密密钥
 * @throws {Error} 如果未配置 ENCRYPTION_KEY
 */
async function getEncryptionKey(env) {
	if (!env.ENCRYPTION_KEY) {
		throw ErrorFactory.missingConfig('ENCRYPTION_KEY', {
			hint: '请使用 "wrangler secret put ENCRYPTION_KEY" 设置加密密钥',
		});
	}

	// 将 base64 编码的密钥转换为 CryptoKey
	const keyData = base64ToArrayBuffer(env.ENCRYPTION_KEY);

	return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * 加密数据
 * @param {Object} data - 要加密的数据对象
 * @param {Object} env - 环境变量对象
 * @returns {Promise<string>} 加密后的数据（格式：version:iv:encryptedData）
 */
export async function encryptData(data, env) {
	try {
		// 获取加密密钥
		const key = await getEncryptionKey(env);

		// 将数据转换为 JSON 字符串
		const jsonString = JSON.stringify(data);
		const encoder = new TextEncoder();
		const dataBuffer = encoder.encode(jsonString);

		// 生成随机 IV（初始化向量）
		const iv = crypto.getRandomValues(new Uint8Array(12)); // 96位 IV 用于 GCM

		// 加密数据
		const encryptedBuffer = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: iv,
				tagLength: 128, // 128位认证标签
			},
			key,
			dataBuffer,
		);

		// 将 IV 和加密数据转换为 base64
		const ivBase64 = arrayBufferToBase64(iv);
		const encryptedBase64 = arrayBufferToBase64(encryptedBuffer);

		// 格式：版本号:IV:加密数据
		// 版本号用于将来可能的加密算法升级
		return `v1:${ivBase64}:${encryptedBase64}`;
	} catch (error) {
		// 如果是已知的配置错误，直接抛出
		if (error instanceof ConfigurationError) {
			throw error;
		}

		console.error('数据加密失败:', error);
		throw ErrorFactory.encryptionFailed({
			originalError: error.message,
		});
	}
}

/**
 * 解密数据
 * @param {string} encryptedString - 加密的字符串
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Object>} 解密后的数据对象
 * @throws {Error} 如果解密失败或数据已损坏
 */
export async function decryptData(encryptedString, env) {
	try {
		// 解析加密字符串
		const parts = encryptedString.split(':');

		if (parts.length !== 3) {
			throw new ValidationError('加密数据格式无效', {
				format: 'expected "version:iv:encryptedData"',
				received: `${parts.length} parts`,
			});
		}

		const [version, ivBase64, encryptedBase64] = parts;

		// 检查版本
		if (version !== 'v1') {
			throw new ValidationError(`不支持的加密版本: ${version}`, {
				supportedVersions: ['v1'],
				receivedVersion: version,
			});
		}

		// 获取加密密钥
		const key = await getEncryptionKey(env);

		// 将 base64 转换回 ArrayBuffer
		const iv = base64ToArrayBuffer(ivBase64);
		const encryptedBuffer = base64ToArrayBuffer(encryptedBase64);

		// 解密数据
		const decryptedBuffer = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: iv,
				tagLength: 128,
			},
			key,
			encryptedBuffer,
		);

		// 将解密后的数据转换为字符串和对象
		const decoder = new TextDecoder();
		const jsonString = decoder.decode(decryptedBuffer);

		return JSON.parse(jsonString);
	} catch (error) {
		// 如果是已知的配置或验证错误，直接抛出
		if (error instanceof ConfigurationError || error instanceof ValidationError) {
			throw error;
		}

		console.error('数据解密失败:', error);
		throw ErrorFactory.decryptionFailed({
			originalError: error.message,
			hint: '数据可能已损坏或使用了错误的密钥',
		});
	}
}

/**
 * 检查数据是否已加密
 * @param {string|Object} data - 要检查的数据
 * @returns {boolean} 是否已加密
 */
export function isEncrypted(data) {
	// 如果是字符串且以 "v1:" 开头，则认为已加密
	if (typeof data === 'string' && data.startsWith('v1:')) {
		return true;
	}
	return false;
}

/**
 * 生成新的加密密钥（用于初始化设置）
 * @returns {Promise<string>} Base64 编码的 256 位密钥
 */
export async function generateEncryptionKey() {
	// 生成 256 位（32 字节）随机密钥
	const keyBuffer = crypto.getRandomValues(new Uint8Array(32));
	return arrayBufferToBase64(keyBuffer);
}

/**
 * 加密密钥列表（便捷函数）
 * @param {Array} secrets - 密钥数组
 * @param {Object} env - 环境变量对象
 * @returns {Promise<string>} 加密后的密钥列表
 */
export async function encryptSecrets(secrets, env) {
	if (!env.ENCRYPTION_KEY) {
		console.warn('⚠️  ENCRYPTION_KEY 未配置，数据将以明文存储！强烈建议配置加密密钥。');
		// 向后兼容：如果没有配置加密密钥，返回明文 JSON
		return JSON.stringify(secrets);
	}

	return encryptData(secrets, env);
}

/**
 * 解密密钥列表（便捷函数，自动检测是否加密）
 * @param {string} data - 可能已加密的数据
 * @param {Object} env - 环境变量对象
 * @returns {Promise<Array>} 解密后的密钥数组
 */
export async function decryptSecrets(data, env) {
	if (!data) {
		return [];
	}

	// 检查是否已加密
	if (isEncrypted(data)) {
		// 数据已加密，需要解密
		if (!env.ENCRYPTION_KEY) {
			console.error('⚠️  数据已加密但未配置 ENCRYPTION_KEY。');
			console.error('⚠️  无法读取加密的数据，将返回空列表。');
			console.error('⚠️  如果需要访问加密数据，请配置正确的 ENCRYPTION_KEY。');
			console.error('⚠️  如果想重新开始，旧的加密数据将被忽略。');
			return [];
		}
		return decryptData(data, env);
	} else {
		// 数据未加密（旧数据），直接解析
		if (!env.ENCRYPTION_KEY) {
			console.log('✅ 未配置 ENCRYPTION_KEY，使用明文模式');
		} else {
			console.warn('⚠️  检测到未加密的数据，建议尽快迁移到加密存储');
		}
		try {
			return JSON.parse(data);
		} catch (error) {
			console.error('解析未加密数据失败:', error);
			return [];
		}
	}
}

/**
 * 将 ArrayBuffer 转换为 Base64 字符串
 * @param {ArrayBuffer|Uint8Array} buffer - 要转换的缓冲区
 * @returns {string} Base64 字符串
 */
function arrayBufferToBase64(buffer) {
	const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < uint8Array.length; i++) {
		binary += String.fromCharCode(uint8Array[i]);
	}
	return btoa(binary);
}

/**
 * 将 Base64 字符串转换为 ArrayBuffer
 * @param {string} base64 - Base64 字符串
 * @returns {Uint8Array} ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
	const binary = atob(base64);
	const uint8Array = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		uint8Array[i] = binary.charCodeAt(i);
	}
	return uint8Array;
}

/**
 * 验证加密配置是否正确
 * @param {Object} env - 环境变量对象
 * @returns {Object} 验证结果 {configured: boolean, valid: boolean, message: string}
 */
export async function validateEncryptionConfig(env) {
	// 检查是否配置了加密密钥
	if (!env.ENCRYPTION_KEY) {
		return {
			configured: false,
			valid: true, // 未配置密钥也是有效的（使用明文模式）
			message: '未配置 ENCRYPTION_KEY。将使用明文模式存储数据。建议配置加密密钥以增强安全性。',
		};
	}

	try {
		// 尝试导入密钥以验证格式
		await getEncryptionKey(env);

		// 测试加密和解密
		const testData = { test: 'encryption-test', timestamp: Date.now() };
		const encrypted = await encryptData(testData, env);
		const decrypted = await decryptData(encrypted, env);

		if (JSON.stringify(testData) === JSON.stringify(decrypted)) {
			return {
				configured: true,
				valid: true,
				message: '✅ 加密配置正确，数据将被加密存储',
			};
		} else {
			return {
				configured: true,
				valid: false,
				message: '加密配置异常：加密后无法正确解密',
			};
		}
	} catch (error) {
		return {
			configured: true,
			valid: false,
			message: `加密配置错误: ${error.message}`,
		};
	}
}
