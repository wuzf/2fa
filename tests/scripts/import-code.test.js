import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getImportCode } from '../../src/ui/scripts/import/index.js';

function createImportApi() {
	const code = getImportCode();

	return new Function(
		'crypto',
		'TextEncoder',
		'TextDecoder',
		'URL',
		'URLSearchParams',
		'atob',
		'btoa',
		'showCenterToast',
		'document',
		'previewImport',
		'loadSecrets',
		'hideImportModal',
		`${code}; return { parseFreeOTPBackup, decryptFreeOTPBackup, decodeImportFileContent };`
	)(
		globalThis.crypto,
		TextEncoder,
		TextDecoder,
		URL,
		URLSearchParams,
		globalThis.atob,
		globalThis.btoa,
		() => {},
		{},
		() => {},
		() => {},
		() => {}
	);
}

function toSignedBytes(uint8Array) {
	return Array.from(uint8Array).map(byte => (byte > 127 ? byte - 256 : byte));
}

function buildGcmParams(iv, tagBytes = 16) {
	const params = new Uint8Array(19);
	params[0] = 0x30;
	params[1] = 0x11;
	params[2] = 0x04;
	params[3] = 0x0c;
	params.set(iv, 4);
	params[16] = 0x02;
	params[17] = 0x01;
	params[18] = tagBytes;
	return params;
}

function hashNameToFreeOTPAlgorithm(hashName) {
	return 'PBKDF2withHmac' + hashName.replace('-', '');
}

async function createSyntheticFreeOTPBackup({
	password,
	hashName,
	masterKeyAad,
	tokenAad,
	tagBytes,
}) {
	const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
	const rawMasterKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
	const secretBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	const uuid = '12345678-1234-1234-1234-1234567890ab';

	const passwordBytes = new TextEncoder().encode(password);
	const passwordKey = await globalThis.crypto.subtle.importKey(
		'raw',
		passwordBytes,
		'PBKDF2',
		false,
		['deriveBits', 'deriveKey']
	);

	const derivedKey = await globalThis.crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: 100000,
			hash: hashName,
		},
		passwordKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	);

	const masterKeyIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const masterKeyEncryptParams = {
		name: 'AES-GCM',
		iv: masterKeyIv,
		tagLength: tagBytes * 8,
	};
	if (masterKeyAad !== null) {
		masterKeyEncryptParams.additionalData = new TextEncoder().encode(masterKeyAad);
	}
	const encryptedMasterKeyBuffer = await globalThis.crypto.subtle.encrypt(
		masterKeyEncryptParams,
		derivedKey,
		rawMasterKey
	);

	const masterKey = await globalThis.crypto.subtle.importKey(
		'raw',
		rawMasterKey,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	const tokenIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const tokenEncryptParams = {
		name: 'AES-GCM',
		iv: tokenIv,
		tagLength: tagBytes * 8,
	};
	if (tokenAad !== null) {
		tokenEncryptParams.additionalData = new TextEncoder().encode(tokenAad);
	}
	const encryptedSecretBuffer = await globalThis.crypto.subtle.encrypt(
		tokenEncryptParams,
		masterKey,
		secretBytes
	);

	return {
		masterKey: {
			mAlgorithm: hashNameToFreeOTPAlgorithm(hashName),
			mEncryptedKey: {
				mCipher: 'AES/GCM/NoPadding',
				mCipherText: toSignedBytes(new Uint8Array(encryptedMasterKeyBuffer)),
				mParameters: toSignedBytes(buildGcmParams(masterKeyIv, tagBytes)),
				mToken: 'AES',
			},
			mIterations: 100000,
			mSalt: toSignedBytes(salt),
		},
		tokens: {
			[uuid]: {
				mCipher: 'AES/GCM/NoPadding',
				mCipherText: toSignedBytes(new Uint8Array(encryptedSecretBuffer)),
				mParameters: toSignedBytes(buildGcmParams(tokenIv, tagBytes)),
				mToken: 'HmacSHA1',
			},
		},
		tokenMeta: {
			[uuid]: {
				algo: 'SHA1',
				digits: 6,
				issuerExt: 'TestIssuer',
				label: 'user@example.com',
				period: 30,
				type: 'TOTP',
			},
		},
	};
}

describe('import module code generation', () => {
	it('includes the complete FreeOTP decrypt pipeline', () => {
		const code = getImportCode();

		expect(code).toContain('function parseFreeOTPBackup(content)');
		expect(code).toContain('function decryptFreeOTPBackup(backupData, password)');
		expect(code).toContain("result.tokens[uuid] = JSON.parse(keyData.key);");
		expect(code).toContain('function buildFreeOTPPbkdf2HashCandidates(algorithm)');
		expect(code).toContain('function decryptFreeOTPGcmWithFallback(key, cipherText, parameters, aadCandidates)');
	});

	it('does not reference removed password section containers', () => {
		const code = getImportCode();

		expect(code).not.toContain('freeotpPasswordSection');
		expect(code).not.toContain('totpAuthPasswordSection');
	});

	it('decodes Java-serialized FreeOTP backups from binary file content', () => {
		const api = createImportApi();
		const fileBuffer = readFileSync('tests/fixtures/exports/2fa-secrets-freeotp-encrypted.xml');
		const arrayBuffer = fileBuffer.buffer.slice(
			fileBuffer.byteOffset,
			fileBuffer.byteOffset + fileBuffer.byteLength
		);

		const content = api.decodeImportFileContent('backup.xml', arrayBuffer);
		const parsed = api.parseFreeOTPBackup(content);

		expect(content).toContain('java.util.HashMap');
		expect(parsed).not.toBeNull();
		expect(Object.keys(parsed.tokenMeta)).toHaveLength(87);
		expect(Object.keys(parsed.tokens)).toHaveLength(87);
	});

	it('decrypts the exported FreeOTP fixture with the generated runtime code', async () => {
		const api = createImportApi();
		const content = readFileSync('tests/fixtures/exports/2fa-secrets-freeotp-encrypted.xml', 'utf8');
		const parsed = api.parseFreeOTPBackup(content);

		expect(parsed).not.toBeNull();

		const otpauthUrls = await api.decryptFreeOTPBackup(parsed, '666666');

		expect(otpauthUrls).toHaveLength(87);
		expect(otpauthUrls[0]).toContain('otpauth://totp/');
		expect(otpauthUrls[0]).toContain('issuer=Adobe');
	});

	it('supports FreeOTP variants with fallback PBKDF2 hash, tag length and omitted AAD', async () => {
		const api = createImportApi();
		const backupData = await createSyntheticFreeOTPBackup({
			password: 'Fallback123!',
			hashName: 'SHA-1',
			masterKeyAad: null,
			tokenAad: null,
			tagBytes: 12,
		});

		const otpauthUrls = await api.decryptFreeOTPBackup(backupData, 'Fallback123!');

		expect(otpauthUrls).toHaveLength(1);
		expect(otpauthUrls[0]).toContain('otpauth://totp/TestIssuer:user%40example.com');
		expect(otpauthUrls[0]).toContain('issuer=TestIssuer');
	});
});
