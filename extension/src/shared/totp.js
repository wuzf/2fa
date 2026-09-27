const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HASH_ALGORITHMS = Object.freeze({
	SHA1: 'SHA-1',
	SHA256: 'SHA-256',
	SHA512: 'SHA-512',
});
const SUPPORTED_DIGITS = new Set([6, 8]);
const SUPPORTED_PERIODS = new Set([30, 60, 120]);
const MAX_SECRET_LENGTH = 2048;

export class TotpError extends Error {
	constructor(code) {
		super(code === 'INVALID_SECRET' ? 'TOTP secret is invalid' : 'TOTP parameters are unsupported');
		this.name = 'TotpError';
		this.code = code;
	}
}

function normalizeAlgorithm(algorithm) {
	if (typeof algorithm !== 'string') {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}

	const normalized = algorithm.toUpperCase();
	if (!Object.hasOwn(HASH_ALGORITHMS, normalized)) {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}
	return normalized;
}

export function normalizeTotpOptions(options = {}) {
	if (options === null || typeof options !== 'object' || Array.isArray(options)) {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}

	const digits = options.digits === undefined ? 6 : options.digits;
	const period = options.period === undefined ? 30 : options.period;
	const algorithm = options.algorithm === undefined ? 'SHA1' : options.algorithm;

	if (!SUPPORTED_DIGITS.has(digits) || !SUPPORTED_PERIODS.has(period)) {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}

	return Object.freeze({ digits, period, algorithm: normalizeAlgorithm(algorithm) });
}

export function decodeBase32(secret) {
	if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
		throw new TotpError('INVALID_SECRET');
	}

	const normalized = secret.toUpperCase().replace(/\s/g, '');
	const paddingIndex = normalized.indexOf('=');
	const unpadded = paddingIndex === -1 ? normalized : normalized.slice(0, paddingIndex);
	const padding = paddingIndex === -1 ? '' : normalized.slice(paddingIndex);

	if (unpadded.length === 0 || !/^[A-Z2-7]+$/.test(unpadded) || (padding && !/^=+$/.test(padding))) {
		throw new TotpError('INVALID_SECRET');
	}

	const bytes = [];
	let buffer = 0;
	let bitCount = 0;

	for (const character of unpadded) {
		buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
		bitCount += 5;

		while (bitCount >= 8) {
			bitCount -= 8;
			bytes.push((buffer >>> bitCount) & 0xff);
		}

		buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
	}

	// Match the existing vault decoder: accept legacy unpadded keys and ignore
	// incomplete trailing bits rather than making one old key block the list.
	if (bytes.length === 0) {
		throw new TotpError('INVALID_SECRET');
	}

	return new Uint8Array(bytes);
}

function encodeCounter(counter) {
	if (!Number.isSafeInteger(counter) || counter < 0) {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}

	const bytes = new Uint8Array(8);
	let remaining = BigInt(counter);
	for (let index = bytes.length - 1; index >= 0; index -= 1) {
		bytes[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	return bytes;
}

export async function generateTotp(secret, timestampMs, options = {}) {
	if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > Number.MAX_SAFE_INTEGER) {
		throw new TotpError('UNSUPPORTED_PARAMETERS');
	}

	const { digits, period, algorithm } = normalizeTotpOptions(options);
	const keyBytes = decodeBase32(secret);
	const counter = Math.floor(timestampMs / (period * 1000));
	const counterBytes = encodeCounter(counter);

	let signature;
	try {
		const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: HASH_ALGORITHMS[algorithm] } }, false, [
			'sign',
		]);
		signature = await crypto.subtle.sign('HMAC', key, counterBytes);
	} catch {
		throw new TotpError('CRYPTO_FAILURE');
	}

	const digest = new Uint8Array(signature);
	const offset = digest[digest.length - 1] & 0x0f;
	const binary =
		((digest[offset] & 0x7f) << 24) |
		((digest[offset + 1] & 0xff) << 16) |
		((digest[offset + 2] & 0xff) << 8) |
		(digest[offset + 3] & 0xff);
	const code = binary % 10 ** digits;
	return code.toString().padStart(digits, '0');
}
