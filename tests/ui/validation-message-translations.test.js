import { describe, expect, it } from 'vitest';
import { translateEnglish } from '../../src/shared/locales/index.js';
import { LOCALES } from '../../src/ui/locales/index.js';

// Reviewed wording for the account-form validation messages shared by the web
// app, the server and the extension. These replaced literal English word order.
const REVIEWED = [
	['vi', 'OTP codes must have 6 or 8 digits', 'Mã OTP phải có 6 hoặc 8 chữ số'],
	['vi', 'TOTP periods must be 30, 60, or 120 seconds', 'Chu kỳ TOTP phải là 30, 60 hoặc 120 giây'],
	['id', 'TOTP periods must be 30, 60, or 120 seconds', 'Periode TOTP harus 30, 60, atau 120 detik'],
	['tr', 'TOTP periods must be 30, 60, or 120 seconds', 'TOTP süresi 30, 60 veya 120 saniye olmalıdır'],
	['th', 'TOTP periods must be 30, 60, or 120 seconds', 'ระยะเวลาของ TOTP ต้องเป็น 30, 60 หรือ 120 วินาที'],
	['ja', 'Unsupported OTP type. Use TOTP or HOTP.', 'サポートされていない OTP タイプです。TOTP または HOTP を使用してください。'],
];

describe('reviewed validation message translations', () => {
	it.each(REVIEWED)('%s uses natural word order for "%s"', (language, source, expected) => {
		expect(translateEnglish(language, source)).toBe(expected);
	});

	it.each(REVIEWED)('%s shows the reviewed text in the account form for "%s"', (language, source, expected) => {
		const key = Object.keys(LOCALES.en).find((name) => LOCALES.en[name] === source && name.startsWith('core'));
		expect(key).toBeTruthy();
		expect(LOCALES[language][key]).toBe(expected);
	});
});
