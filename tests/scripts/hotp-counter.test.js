import { describe, expect, it, vi } from 'vitest';

import { getOTPCode } from '../../src/ui/scripts/otp.js';

function createCalculator() {
	const document = {
		hidden: false,
		addEventListener: vi.fn(),
		getElementById: vi.fn(() => null),
	};
	const window = {
		addEventListener: vi.fn(),
		crypto: globalThis.crypto,
		matchMedia: vi.fn(() => ({ matches: false })),
	};
	const localStorage = {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
	};
	const quietConsole = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

	// The generated UI modules execute in one browser scope in production.
	// eslint-disable-next-line no-new-func
	return new Function(
		'crypto',
		'document',
		'localStorage',
		'window',
		'console',
		`
      let secrets = [];
      let otpIntervals = {};
      function getCorrectedNowMs() { return Date.UTC(2030, 0, 1); }
      function getTrustedClockGeneration() { return 0; }
      function getTrustedMonotonicNowMs() { return 0; }
      ${getOTPCode()}
      return otpCalculator;
    `,
	)(globalThis.crypto, document, localStorage, window, quietConsole);
}

describe('browser HOTP counter semantics', () => {
	it('uses stored counter 0 and counter 1 for the first RFC 4226 vectors', async () => {
		const calculator = createCalculator();
		const secret = {
			secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
			type: 'HOTP',
			counter: 0,
			digits: 6,
			algorithm: 'SHA1',
		};

		await expect(calculator.calculateCurrentOTP(secret)).resolves.toBe('755224');
		await expect(calculator.calculateNextOTP(secret)).resolves.toBe('287082');
	});

	it('encodes counter high and low words as an eight-byte big-endian value', () => {
		const calculator = createCalculator();

		expect(Array.from(new Uint8Array(calculator.getCounterBytes(0x100000001)))).toEqual([
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			1,
		]);
	});

	it.each([-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid stored counter %s without generating a token',
		async (counter) => {
			const calculator = createCalculator();
			calculator.generateTOTP = vi.fn();
			const secret = {
				secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
				type: 'HOTP',
				counter,
				digits: 6,
				algorithm: 'SHA1',
			};

			await expect(calculator.calculateCurrentOTP(secret)).resolves.toBe('------');
			expect(calculator.generateTOTP).not.toHaveBeenCalled();
		},
	);
});
