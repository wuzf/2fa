import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { getCoreCode } from '../../src/ui/scripts/core.js';

const TEST_SECRET = {
	id: 'test',
	name: 'Google',
	account: 'owner@example.com',
	secret: 'jbswy3dpehpk3pxp',
};

function createHarness(overrides = {}) {
	const secret = { ...TEST_SECRET, ...overrides };
	const writeText = vi.fn().mockResolvedValue(undefined);
	const showCenterToast = vi.fn();
	const context = {
		URL,
		URLSearchParams,
		secrets: [secret],
		document: { addEventListener: vi.fn() },
		window: {
			addEventListener: vi.fn(),
			location: { origin: 'https://custom.example:8443' },
		},
		navigator: { clipboard: { writeText } },
		console: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
		setInterval: vi.fn(),
		showCenterToast,
	};

	runInNewContext(getCoreCode(), context);
	return { api: context, secret, showCenterToast, writeText };
}

function copiedURL(writeText) {
	expect(writeText).toHaveBeenCalled();
	return new URL(writeText.mock.lastCall[0]);
}

describe('OTP link copying', () => {
	it('copies an importable TOTP URI with encoded labels and custom settings', async () => {
		const { api, showCenterToast, writeText } = createHarness({
			name: '  Google / 工作?  ',
			account: ' owner+otp@example.com ',
			type: 'totp',
			algorithm: 'SHA256',
			digits: 8,
			period: 60,
		});

		await api.copyOTPAuthURL('test');

		const url = copiedURL(writeText);
		expect(url.protocol).toBe('otpauth:');
		expect(url.hostname).toBe('totp');
		expect(decodeURIComponent(url.pathname)).toBe('/Google / 工作?:owner+otp@example.com');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			secret: 'JBSWY3DPEHPK3PXP',
			issuer: 'Google / 工作?',
			algorithm: 'SHA256',
			digits: '8',
			period: '60',
		});
		expect(showCenterToast).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('验证器 URI'));
	});

	it('copies a URI without an account using the standard TOTP defaults', async () => {
		const { api, writeText } = createHarness({ account: '' });

		await api.copyOTPAuthURL('test');

		const url = copiedURL(writeText);
		expect(url.pathname).toBe('/Google');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			secret: 'JBSWY3DPEHPK3PXP',
			issuer: 'Google',
			algorithm: 'SHA1',
			digits: '6',
			period: '30',
		});
	});

	it('preserves the HOTP counter and omits the TOTP period in a verifier URI', async () => {
		const { api, secret, writeText } = createHarness({
			type: 'hotp',
			counter: 42,
			algorithm: 'SHA512',
			digits: 8,
			period: 120,
		});

		await api.copyOTPAuthURL('test');

		const url = copiedURL(writeText);
		expect(url.hostname).toBe('hotp');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			secret: 'JBSWY3DPEHPK3PXP',
			issuer: 'Google',
			algorithm: 'SHA512',
			digits: '8',
			counter: '42',
		});
		expect(secret.counter).toBe(42);
	});

	it.each([{}, { type: 'TOTP', algorithm: 'SHA1', digits: 6, period: 30 }])(
		'copies a short page URL on the current origin for default settings %j',
		async (settings) => {
			const { api, showCenterToast, writeText } = createHarness(settings);

			await api.copyOTPPageURL('test');

			expect(writeText).toHaveBeenCalledWith('https://custom.example:8443/otp/JBSWY3DPEHPK3PXP');
			expect(showCenterToast).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('验证码链接'));
		},
	);

	it('preserves custom TOTP settings and encodes Base32 padding in the page URL', async () => {
		const { api, writeText } = createHarness({
			secret: 'jbswy3dpehpk3pxp====',
			type: 'totp',
			algorithm: 'sha256',
			digits: 8,
			period: 120,
		});

		await api.copyOTPPageURL('test');

		const url = copiedURL(writeText);
		expect(url.origin).toBe('https://custom.example:8443');
		expect(url.pathname).toBe('/otp/JBSWY3DPEHPK3PXP%3D%3D%3D%3D');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			algorithm: 'SHA256',
			digits: '8',
			period: '120',
		});
	});

	it('copies the current HOTP counter, including zero, without advancing it', async () => {
		const { api, secret, writeText } = createHarness({ type: 'hotp', counter: 0, period: 120 });

		await api.copyOTPPageURL('test');

		expect(Object.fromEntries(copiedURL(writeText).searchParams)).toEqual({ type: 'HOTP', counter: '0' });
		expect(secret.counter).toBe(0);

		secret.counter = 4294967297;
		secret.algorithm = 'SHA512';
		secret.digits = 8;
		await api.copyOTPPageURL('test');

		expect(Object.fromEntries(copiedURL(writeText).searchParams)).toEqual({
			type: 'HOTP',
			counter: '4294967297',
			algorithm: 'SHA512',
			digits: '8',
		});
		expect(secret.counter).toBe(4294967297);
	});

	it.each(['copyOTPAuthURL', 'copyOTPPageURL'])('%s does not write when the secret no longer exists', async (method) => {
		const { api, showCenterToast, writeText } = createHarness();

		await api[method]('missing');

		expect(writeText).not.toHaveBeenCalled();
		expect(showCenterToast).toHaveBeenCalledWith('❌', '未找到密钥');
	});

	it.each(['copyOTPAuthURL', 'copyOTPPageURL'])('%s reports a rejected clipboard write', async (method) => {
		const { api, showCenterToast, writeText } = createHarness();
		writeText.mockRejectedValueOnce(new Error('Clipboard permission denied'));

		await expect(api[method]('test')).resolves.toBeUndefined();

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(showCenterToast).toHaveBeenCalledTimes(1);
		expect(showCenterToast).toHaveBeenCalledWith('❌', expect.stringContaining('Clipboard permission denied'));
	});
});
