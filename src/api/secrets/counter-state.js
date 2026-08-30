/**
 * Per-secret HOTP counter state stored outside the encrypted secrets document.
 *
 * A generation change selects a fresh random namespace in the base document.
 * Previous namespaces remain logically inactive: retaining their sidecars keeps
 * interrupted edits and late writes from losing another generation's counter.
 * Records without a namespace continue to use their existing legacy keys.
 */

import { decryptData, encryptData, isEncrypted } from '../../utils/encryption.js';

export const HOTP_COUNTER_STATE_PREFIX = 'hotp-counter:';
export const HOTP_COUNTER_EPOCH_KEY = 'hotp-counter-epoch';
const HOTP_COUNTER_BULK_GET_SIZE = 100;
const DEFAULT_HOTP_COUNTER_EPOCH = 'legacy';

function isSafeCounter(counter) {
	return Number.isSafeInteger(counter) && counter >= 0;
}

function normalizeGenerationParts(secret) {
	return {
		secret: String(secret?.secret || '')
			.replace(/\s+/g, '')
			.toUpperCase(),
		digits: secret?.digits ?? 6,
		algorithm: String(secret?.algorithm || 'SHA1').toUpperCase(),
	};
}

function bytesToHex(buffer) {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export async function generateHOTPGenerationHash(secret) {
	const encoded = new TextEncoder().encode(JSON.stringify(normalizeGenerationParts(secret)));
	return bytesToHex(await crypto.subtle.digest('SHA-256', encoded));
}

export function getHOTPCounterStateKey(secretId, epoch = DEFAULT_HOTP_COUNTER_EPOCH, namespace = null) {
	const legacyKey = `${HOTP_COUNTER_STATE_PREFIX}${encodeURIComponent(String(epoch))}:${encodeURIComponent(String(secretId))}`;
	return namespace ? `${legacyKey}:${encodeURIComponent(String(namespace))}` : legacyKey;
}

function normalizeCounterState(value, secretId) {
	if (!value || typeof value !== 'object') {
		throw new Error('HOTP计数器sidecar格式无效');
	}
	if (value.secretId !== undefined && String(value.secretId) !== secretId) {
		throw new Error('HOTP计数器sidecar密钥ID不匹配');
	}
	if (
		!isSafeCounter(value.counter) ||
		typeof value.generationHash !== 'string' ||
		!value.generationHash ||
		typeof value.epoch !== 'string' ||
		!value.epoch
	) {
		throw new Error('HOTP计数器sidecar状态无效');
	}

	return {
		secretId,
		counter: value.counter,
		generationHash: value.generationHash,
		epoch: value.epoch,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
	};
}

export async function getHOTPCounterEpoch(env) {
	const epoch = await env.SECRETS_KV.get(HOTP_COUNTER_EPOCH_KEY, 'text');
	return typeof epoch === 'string' && epoch ? epoch : DEFAULT_HOTP_COUNTER_EPOCH;
}

async function decodeCounterState(env, rawValue, secretId) {
	if (!rawValue) {
		return null;
	}
	const value = isEncrypted(rawValue) ? await decryptData(rawValue, env) : JSON.parse(rawValue);
	return normalizeCounterState(value, secretId);
}

export async function overlaySingleHOTPCounterState(env, secret) {
	if (String(secret?.type || '').toUpperCase() !== 'HOTP' || secret?.id === undefined) {
		return { secret, epoch: null };
	}

	const epoch = await getHOTPCounterEpoch(env);
	const rawValue = await env.SECRETS_KV.get(getHOTPCounterStateKey(secret.id, epoch, secret.hotpCounterNamespace), 'text');
	const state = await decodeCounterState(env, rawValue, String(secret.id));
	if (!state || state.epoch !== epoch || state.generationHash !== (await generateHOTPGenerationHash(secret))) {
		return { secret, epoch };
	}

	const baseCounter = isSafeCounter(secret.counter) ? secret.counter : 0;
	return {
		secret: {
			...secret,
			counter: Math.max(baseCounter, state.counter),
		},
		epoch,
	};
}

export async function overlayHOTPCounterStates(env, secrets) {
	const hotpSecrets = secrets.filter((secret) => String(secret?.type || '').toUpperCase() === 'HOTP' && secret?.id !== undefined);
	if (hotpSecrets.length === 0) {
		return secrets;
	}

	const epoch = await getHOTPCounterEpoch(env);
	const states = new Map();
	const batches = [];
	for (let index = 0; index < hotpSecrets.length; index += HOTP_COUNTER_BULK_GET_SIZE) {
		batches.push(hotpSecrets.slice(index, index + HOTP_COUNTER_BULK_GET_SIZE));
	}

	for (const batch of batches) {
		const keys = batch.map((secret) => getHOTPCounterStateKey(secret.id, epoch, secret.hotpCounterNamespace));
		const values = await env.SECRETS_KV.get(keys, 'text');
		if (values === null || values === undefined || (!(values instanceof Map) && typeof values !== 'object')) {
			throw new Error('HOTP计数器sidecar批量读取结果格式无效');
		}

		await Promise.all(
			batch.map(async (secret, index) => {
				const key = keys[index];
				const rawValue = values instanceof Map ? values.get(key) : values?.[key];
				const state = await decodeCounterState(env, rawValue, String(secret.id));
				if (state?.epoch === epoch) {
					states.set(String(secret.id), state);
				}
			}),
		);
	}

	return Promise.all(
		secrets.map(async (secret) => {
			if (String(secret?.type || '').toUpperCase() !== 'HOTP' || secret?.id === undefined) {
				return secret;
			}
			const state = states.get(String(secret.id));
			if (!state || state.generationHash !== (await generateHOTPGenerationHash(secret))) {
				return secret;
			}
			const baseCounter = isSafeCounter(secret.counter) ? secret.counter : 0;
			return {
				...secret,
				counter: Math.max(baseCounter, state.counter),
			};
		}),
	);
}

export async function saveHOTPCounterState(env, secret, counter, knownEpoch = null) {
	if (!secret?.id) {
		throw new Error('HOTP计数器sidecar缺少密钥ID');
	}
	if (!isSafeCounter(counter)) {
		throw new Error('HOTP计数器sidecar必须使用非负安全整数');
	}

	const epoch = knownEpoch || (await getHOTPCounterEpoch(env));
	const state = {
		secretId: String(secret.id),
		counter,
		generationHash: await generateHOTPGenerationHash(secret),
		epoch,
		updatedAt: new Date().toISOString(),
	};
	const storedValue = env.ENCRYPTION_KEY ? await encryptData(state, env) : JSON.stringify(state);
	await env.SECRETS_KV.put(getHOTPCounterStateKey(secret.id, epoch, secret.hotpCounterNamespace), storedValue);
	return state;
}

export async function deleteHOTPCounterState(env, secret) {
	if (String(secret?.type || '').toUpperCase() !== 'HOTP') {
		return;
	}
	const epoch = await getHOTPCounterEpoch(env);
	await env.SECRETS_KV.delete(getHOTPCounterStateKey(secret.id, epoch, secret.hotpCounterNamespace));
}

export async function rotateHOTPCounterEpoch(env) {
	const epoch = crypto.randomUUID();
	await env.SECRETS_KV.put(HOTP_COUNTER_EPOCH_KEY, epoch);
	return epoch;
}
