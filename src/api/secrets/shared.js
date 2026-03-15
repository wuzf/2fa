/**
 * 共享工具函数 - 被多个 API 处理器使用
 *
 * 包含功能:
 * - saveSecretsToKV: 保存密钥到 KV（自动加密、触发备份）
 * - getAllSecrets: 获取所有密钥（自动解密）
 */

import { encryptSecrets, decryptSecrets } from '../../utils/encryption.js';
import { saveDataHash } from '../../worker.js';
import { getLogger } from '../../utils/logger.js';
import { triggerBackup } from '../../utils/backup.js';
import { KV_KEYS } from '../../utils/constants.js';

/**
 * 保存密钥到 KV 存储
 *
 * 自动执行以下操作:
 * 1. 加密数据（如果配置了 ENCRYPTION_KEY）
 * 2. 保存到 KV
 * 3. 更新数据哈希值（防止定时任务重复备份）
 * 4. 触发事件驱动备份
 *
 * @param {Object} env - Cloudflare Workers 环境对象
 * @param {Array} secrets - 密钥数组
 * @param {string} reason - 操作原因 (用于备份元数据)
 * @param {Object} options - 可选配置
 * @param {boolean} options.immediate - 是否立即执行备份（忽略防抖）
 * @param {Object} [ctx] - Cloudflare Workers 执行上下文（用于 waitUntil 托管后台任务）
 * @throws {Error} 保存失败时抛出异常
 */
export async function saveSecretsToKV(env, secrets, reason = 'update', options = {}, ctx) {
	const logger = getLogger(env);
	const { immediate = false } = options;

	try {
		// 🔒 加密数据（如果配置了 ENCRYPTION_KEY）
		const encryptedData = await encryptSecrets(secrets, env);

		// 保存加密后的数据
		await env.SECRETS_KV.put(KV_KEYS.SECRETS, encryptedData);

		if (env.ENCRYPTION_KEY) {
			logger.info(`✅ 密钥已加密保存`, { count: secrets.length });
		} else {
			logger.warn('⚠️ 密钥以明文保存（未配置 ENCRYPTION_KEY）', { count: secrets.length });
		}

		// 💾 立即更新数据哈希值，防止定时任务重复备份
		try {
			await saveDataHash(env, secrets);
			logger.debug('数据哈希已更新', { count: secrets.length });
		} catch (hashErr) {
			logger.warn('更新数据哈希失败（不影响主流程）', {}, hashErr);
		}

		// 🔄 触发事件驱动备份（异步，不阻塞）
		try {
			const backupResult = await triggerBackup(secrets, env, { reason, immediate, ctx });
			if (backupResult) {
				logger.debug('备份已触发', { reason, immediate, result: backupResult });
			}
		} catch (err) {
			logger.warn('触发备份失败（不影响主流程）', { reason }, err);
		}
	} catch (error) {
		logger.error('保存密钥到 KV 失败', {}, error);
		throw error;
	}
}

/**
 * 获取所有密钥
 *
 * 自动解密数据（如果已加密）
 *
 * @param {Object} env - Cloudflare Workers 环境对象
 * @returns {Promise<Array>} 密钥数组
 * @throws {Error} 当存储数据无法安全读取时抛出异常，避免误把异常当作空数据覆盖保存
 */
export async function getAllSecrets(env) {
	const logger = getLogger(env);

	try {
		const secretsData = await env.SECRETS_KV.get(KV_KEYS.SECRETS, 'text');
		return await decryptSecrets(secretsData, env);
	} catch (error) {
		logger.error('获取密钥列表失败', { errorMessage: error.message }, error);
		throw error;
	}
}
