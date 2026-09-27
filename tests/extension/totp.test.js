import { describe, expect, it } from 'vitest';
import { TotpError, decodeBase32, generateTotp, normalizeTotpOptions } from '../../extension/src/shared/totp.js';
import { generateOTP } from '../../src/otp/generator.js';

describe('extension TOTP', () => {
	const vectors = [
		{
			algorithm: 'SHA1',
			secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
			expected: ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
		},
		{
			algorithm: 'SHA256',
			secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA',
			expected: ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
		},
		{
			algorithm: 'SHA512',
			secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA',
			expected: ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826'],
		},
	];
	const timestamps = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];

	it.each(vectors)('matches every RFC 6238 $algorithm vector', async ({ algorithm, secret, expected }) => {
		for (const [index, timestamp] of timestamps.entries()) {
			await expect(generateTotp(secret, timestamp * 1000, { digits: 8, period: 30, algorithm })).resolves.toBe(expected[index]);
		}
	});

	it('preserves leading zeroes and defaults to six digits, SHA1 and 30 seconds', async () => {
		const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
		await expect(generateTotp(secret, 1111111109 * 1000, { digits: 8 })).resolves.toBe('07081804');
		await expect(generateTotp(secret, 59 * 1000)).resolves.toBe('287082');
		expect(normalizeTotpOptions()).toEqual({ digits: 6, period: 30, algorithm: 'SHA1' });
	});

	it.each([
		[30, 59 * 1000],
		[60, 119 * 1000],
		[120, 239 * 1000],
	])('supports a %i-second period', async (period, timestampMs) => {
		await expect(
			generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', timestampMs, {
				digits: 8,
				period,
				algorithm: 'SHA1',
			}),
		).resolves.toBe('94287082');
	});

	it('decodes lowercase, whitespace and accepted trailing Base32 padding', () => {
		expect(new TextDecoder().decode(decodeBase32('mzxw6ytb oi======'))).toBe('foobar');
		expect(new TextDecoder().decode(decodeBase32('MZXW6YTBOI===='))).toBe('foobar');
	});

	it.each([
		['invalid digits', { digits: 7 }],
		['invalid period', { period: 45 }],
		['invalid algorithm', { algorithm: 'MD5' }],
	])('rejects %s', async (_description, options) => {
		await expect(generateTotp('JBSWY3DPEHPK3PXP', 0, options)).rejects.toMatchObject({
			name: 'TotpError',
			code: 'UNSUPPORTED_PARAMETERS',
		});
	});

	it.each(['', 'INVALID1', 'MZXW6YTB!', 'MZ=AA'])('rejects malformed Base32 without including it in the error', async (secret) => {
		let error;
		try {
			await generateTotp(secret, 0);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TotpError);
		expect(error.code).toBe('INVALID_SECRET');
		if (secret) {
			expect(error.message).not.toContain(secret);
		}
	});

	it.each(['JBSWY3DPEHPK3PXPX', 'KRSXG5CTMVRXEZLUXYZAB', 'JBSWY3DPEHPK3PXP===='])(
		'matches the vault for accepted legacy key %s',
		async (secret) => {
			const options = { digits: 6, period: 30, algorithm: 'SHA1' };
			const actual = await generateTotp(secret, 1234567890000, options);
			expect(actual).toBe(await generateOTP(secret, 1234567890, options));
		},
	);
});
