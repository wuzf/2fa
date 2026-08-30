/**
 * Shared secret storage helpers.
 */

import { encryptSecrets, decryptSecrets } from '../../utils/encryption.js';
import { getLogger } from '../../utils/logger.js';
import { triggerBackup } from '../../utils/backup.js';
import { KV_KEYS } from '../../utils/constants.js';
import { clearPendingDataHash, stageDataHash } from '../../utils/data-hash.js';
import { overlayHOTPCounterStates, overlaySingleHOTPCounterState } from './counter-state.js';

/**
 * Save secrets to KV and trigger event-driven backup.
 *
 * When a request context is available, non-immediate backups are scheduled
 * through `ctx.waitUntil()` so expensive formats such as HTML do not block
 * normal CRUD responses. Immediate backups still run in-request.
 */
export async function saveSecretsToKV(env, secrets, reason = 'update', options = {}, ctx) {
	const logger = getLogger(env);
	const { immediate = false, skipBackup = false, skipEventBackup = false } = options;
	const shouldStageDataHash = Boolean(ctx?.waitUntil) && immediate !== true && skipBackup !== true && skipEventBackup !== true;

	try {
		const encryptedData = await encryptSecrets(secrets, env);
		await env.SECRETS_KV.put(KV_KEYS.SECRETS, encryptedData);

		if (env.ENCRYPTION_KEY) {
			logger.info('✅ 密钥已加密保存', { count: secrets.length });
		} else {
			logger.warn('⚠️ 密钥以明文保存（未配置 ENCRYPTION_KEY）', { count: secrets.length });
		}

		if (skipEventBackup === true) {
			const stagedHash = await stageDataHash(env, secrets);
			if (stagedHash === null) {
				throw new Error('无法stage compact后的数据哈希');
			}
			logger.debug('已跳过事件备份并stage数据哈希', { reason });
			return;
		}

		if (skipBackup === true) {
			// 事件驱动备份被跳过（分片导入的中间片）：仍然 stage 当前数据哈希，
			// 这样即使后续分片丢失或客户端伪造元数据，定时 cron 也能通过哈希比对兜底
			const stagedHash = await stageDataHash(env, secrets);
			if (stagedHash === null) {
				// pending hash 未写入：失去 cron 跳过冗余备份的兜底信号，且若末片永远不到，
				// 中间片数据可能得不到即时备份。回退为触发一次即时备份，确保本片已落盘备份。
				logger.warn('stage pending data hash 失败，回退触发即时备份以兜底中间片', { reason });
				try {
					await triggerBackup(secrets, env, {
						reason: `${reason}-stage-failed-fallback`,
						immediate: true,
						ctx,
					});
				} catch (err) {
					logger.warn('回退即时备份失败（不影响主流程）', { reason }, err);
				}
				return;
			}
			logger.debug('跳过即时备份，已 stage pending hash 供 cron 兜底', { reason, immediate });
			return;
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
		const secrets = await decryptSecrets(secretsData, env);
		return await overlayHOTPCounterStates(env, secrets);
	} catch (error) {
		logger.error('获取密钥列表失败', { errorMessage: error.message }, error);
		throw error;
	}
}

/**
 * Read one base secret and overlay only its HOTP sidecar.
 */
export async function getSecretByIdWithHOTPState(env, secretId) {
	const secretsData = await env.SECRETS_KV.get(KV_KEYS.SECRETS, 'text');
	const secrets = await decryptSecrets(secretsData, env);
	const secret = secrets.find((item) => String(item.id) === String(secretId));
	if (!secret) {
		return { secret: null, epoch: null };
	}
	return overlaySingleHOTPCounterState(env, secret);
}
