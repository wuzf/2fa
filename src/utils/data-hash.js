/**
 * Data hash helpers used to detect whether the current secrets have already
 * been fully backed up.
 */

import { getLogger } from './logger.js';

export const LAST_BACKUP_HASH_KEY = 'last_backup_hash';
export const PENDING_BACKUP_HASH_KEY = 'pending_backup_hash';
export const PENDING_BACKUP_HASH_TTL_MS = 10 * 60 * 1000;

function buildPendingDataHashPayload(hash) {
	return JSON.stringify({
		hash,
		updatedAt: new Date().toISOString(),
	});
}

function parsePendingDataHashPayload(rawValue) {
	if (!rawValue) {
		return null;
	}

	try {
		const parsed = JSON.parse(rawValue);
		if (parsed && typeof parsed === 'object' && typeof parsed.hash === 'string' && parsed.hash) {
			return {
				hash: parsed.hash,
				updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
			};
		}
	} catch {
		// Backward compatibility for legacy plain-string payloads.
	}

	return typeof rawValue === 'string' && rawValue
		? {
				hash: rawValue,
				updatedAt: null,
			}
		: null;
}

function sanitizeSkippedInvalidCount(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function generateDataHash(secrets, env = null) {
	const logger = env ? getLogger(env) : null;

	const hashData = secrets.map((secret) => ({
		id: secret.id,
		name: secret.name,
		secret: secret.secret,
		account: secret.account,
		type: secret.type,
		digits: secret.digits,
		period: secret.period,
		algorithm: secret.algorithm,
		counter: secret.counter,
	}));

	hashData.sort((a, b) => (a.id || '').localeCompare(b.id || ''));

	const dataString = JSON.stringify(hashData);

	if (hashData.length > 0 && logger) {
		const sampleData = hashData.slice(0, 3).map((item) => ({
			name: item.name,
			account: item.account || '',
			type: item.type,
			secretLength: item.secret?.length || 0,
		}));
		logger.debug('哈希计算数据样本', { sampleData });
	}

	const encoder = new TextEncoder();
	const data = encoder.encode(dataString);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

	if (logger) {
		logger.debug('SHA-256 哈希生成', {
			hashPreview: `${hashHex.substring(0, 16)}...`,
			secretCount: secrets.length,
		});
	}

	return hashHex;
}

export function isPendingDataHashFresh(entry, now = Date.now()) {
	if (!entry?.hash || !entry.updatedAt) {
		return false;
	}

	const updatedAt = Date.parse(entry.updatedAt);
	return Number.isFinite(updatedAt) && now - updatedAt <= PENDING_BACKUP_HASH_TTL_MS;
}

export async function getPendingDataHash(env) {
	if (!env?.SECRETS_KV) {
		return null;
	}

	try {
		return parsePendingDataHashPayload(await env.SECRETS_KV.get(PENDING_BACKUP_HASH_KEY, 'text'));
	} catch (error) {
		getLogger(env).warn('读取待完成数据哈希失败', {}, error);
		return null;
	}
}

export async function stageDataHash(env, secrets) {
	const logger = getLogger(env);

	try {
		const hash = await generateDataHash(secrets, env);
		await env.SECRETS_KV.put(PENDING_BACKUP_HASH_KEY, buildPendingDataHashPayload(hash));
		logger.info('待完成数据哈希已保存', {
			hashPreview: `${hash.substring(0, 16)}...`,
			secretCount: secrets.length,
		});
		return hash;
	} catch (error) {
		logger.error('保存待完成数据哈希失败', {}, error);
		return null;
	}
}

export async function clearPendingDataHash(env, options = {}) {
	if (!env?.SECRETS_KV) {
		return;
	}

	const logger = getLogger(env);

	try {
		await env.SECRETS_KV.delete(PENDING_BACKUP_HASH_KEY);
		if (options.silent !== true) {
			logger.debug('待完成数据哈希已清理');
		}
	} catch (error) {
		logger.warn('清理待完成数据哈希失败', {}, error);
	}
}

export async function saveDataHash(env, secrets, options = {}) {
	const logger = getLogger(env);
	const skippedInvalidCount = sanitizeSkippedInvalidCount(options.skippedInvalidCount);
	const reason = typeof options.reason === 'string' ? options.reason : null;

	if (skippedInvalidCount > 0) {
		logger.warn('备份不完整，保留现有数据哈希', {
			reason,
			skippedInvalidCount,
			secretCount: secrets.length,
		});
		return false;
	}

	try {
		const hash = await generateDataHash(secrets, env);
		const pendingHashEntry = await getPendingDataHash(env);
		await env.SECRETS_KV.put(LAST_BACKUP_HASH_KEY, hash);
		if (!pendingHashEntry?.hash || pendingHashEntry.hash === hash) {
			await clearPendingDataHash(env, { silent: true });
		} else {
			logger.debug('保留更新后的待完成数据哈希', {
				hashPreview: `${hash.substring(0, 16)}...`,
				pendingHashPreview: `${pendingHashEntry.hash.substring(0, 16)}...`,
			});
		}
		logger.info('数据哈希值已保存', {
			hashPreview: `${hash.substring(0, 16)}...`,
			secretCount: secrets.length,
		});
		return true;
	} catch (error) {
		logger.error('保存数据哈希值失败', {}, error);
		return false;
	}
}
