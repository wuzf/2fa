/**
 * Shared secret storage helpers.
 */

import { encryptSecrets, decryptSecrets } from '../../utils/encryption.js';
import { getLogger } from '../../utils/logger.js';
import { triggerBackup } from '../../utils/backup.js';
import { KV_KEYS } from '../../utils/constants.js';
import { clearPendingDataHash, stageDataHash } from '../../utils/data-hash.js';

/**
 * Save secrets to KV and trigger event-driven backup.
 *
 * When a request context is available, non-immediate backups are scheduled
 * through `ctx.waitUntil()` so expensive formats such as HTML do not block
 * normal CRUD responses. Immediate backups still run in-request.
 */
export async function saveSecretsToKV(env, secrets, reason = 'update', options = {}, ctx) {
	const logger = getLogger(env);
	const { immediate = false } = options;
	const shouldStageDataHash = Boolean(ctx?.waitUntil) && immediate !== true;

	try {
		const encryptedData = await encryptSecrets(secrets, env);
		await env.SECRETS_KV.put(KV_KEYS.SECRETS, encryptedData);

		if (env.ENCRYPTION_KEY) {
			logger.info('✅ 密钥已加密保存', { count: secrets.length });
		} else {
			logger.warn('⚠️ 密钥以明文保存（未配置 ENCRYPTION_KEY）', { count: secrets.length });
		}

		try {
			if (shouldStageDataHash) {
				await stageDataHash(env, secrets);
			}

			const backupPromise = triggerBackup(secrets, env, {
				reason,
				immediate,
				ctx,
				waitForCompletion: shouldStageDataHash,
			})
				.then((backupResult) => {
					if (backupResult) {
						logger.debug('备份已触发', { reason, immediate, result: backupResult });
					}
				})
				.catch(async (err) => {
					if (shouldStageDataHash) {
						await clearPendingDataHash(env);
					}
					logger.warn('触发备份失败（不影响主流程）', { reason }, err);
				});

			if (shouldStageDataHash) {
				ctx.waitUntil(backupPromise);
				logger.debug('备份已转入后台执行', { reason, immediate });
			} else {
				await backupPromise;
			}
		} catch (err) {
			if (shouldStageDataHash) {
				await clearPendingDataHash(env);
			}
			logger.warn('触发备份失败（不影响主流程）', { reason }, err);
		}
	} catch (error) {
		logger.error('保存密钥到 KV 失败', {}, error);
		throw error;
	}
}

/**
 * Read and decrypt all stored secrets.
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
