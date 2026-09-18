import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';
import * as generator from '../../src/otp/generator.js';
import * as quickOtp from '../../src/ui/quickOtp.js';

// RFC 4226 / RFC 6238 public test key (ASCII "12345678901234567890").
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function request(query, secret = RFC_SECRET) {
	return handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}?${query}`));
}

describe('public OTP preview API', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		[6, 30, '287082', '359152', '969429'],
		[8, 30, '94287082', '37359152', '26969429'],
		[6, 60, '287082', '359152', '969429'],
		[8, 60, '94287082', '37359152', '26969429'],
		[6, 120, '287082', '359152', '969429'],
		[8, 120, '94287082', '37359152', '26969429'],
	])(
		'returns three consecutive RFC codes for %i digits and a %i-second period',
		async (digits, period, token, nextToken, followingToken) => {
			const serverTime = (period * 2 - 1) * 1000 + 250;
			vi.spyOn(Date, 'now').mockReturnValue(serverTime);

			const response = await request(`format=json&preview=1&type=totp&digits=${digits}&period=${period}`);

			expect(response.status).toBe(200);
			expect(response.headers.get('Cache-Control')).toBe('no-store');
			await expect(response.json()).resolves.toEqual({ token, nextToken, followingToken, period, validUntil: period * 2000, serverTime });
		},
	);

	it.each([
		['SHA256', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA', '68084774', '67062674', '88267535'],
		[
			'SHA512',
			'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA',
			'25091201',
			'99943326',
			'77914268',
		],
	])('preserves %s across all three time windows and supported periods', async (algorithm, secret, token, nextToken, followingToken) => {
		const now = vi.spyOn(Date, 'now');
		for (const period of [30, 60, 120]) {
			const validUntil = (Math.floor(1111111109 / 30) + 1) * period * 1000;
			const serverTime = validUntil - 1000;
			now.mockReturnValue(serverTime);

			const response = await request(`format=json&preview=1&digits=8&algorithm=${algorithm}&period=${period}`, secret);

			await expect(response.json()).resolves.toEqual({ token, nextToken, followingToken, period, validUntil, serverTime });
		}
	});

	it.each(['', '&preview=0', '&preview=true'])('keeps the original JSON shape without explicit preview=1 (%s)', async (preview) => {
		vi.spyOn(Date, 'now').mockReturnValue(59000);
		const generate = vi.spyOn(generator, 'generateOTP');

		const response = await request(`format=json${preview}`);

		await expect(response.json()).resolves.toEqual({ token: '287082' });
		expect(generate).toHaveBeenCalledOnce();
	});

	it('keeps all three codes in consecutive windows when generation crosses the current boundary', async () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(59900).mockReturnValue(60050);

		const response = await request('format=json&preview=1');

		await expect(response.json()).resolves.toEqual({
			token: '287082',
			nextToken: '359152',
			followingToken: '969429',
			period: 30,
			validUntil: 60000,
			serverTime: 60050,
		});
	});

	it('passes HTML the same time window and a clamped remaining lifetime', async () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(59900).mockReturnValue(60050);
		const render = vi.spyOn(quickOtp, 'createQuickOtpPage').mockReturnValue(new Response('preview'));

		await request('digits=8');

		expect(render).toHaveBeenCalledWith('94287082', {
			period: 30,
			remainingTime: 0,
			type: 'TOTP',
			counter: 0,
			nextToken: '37359152',
			followingToken: '26969429',
			validUntil: 60000,
			serverTime: 60050,
		});
	});

	it('preserves subsecond time when passing the remaining lifetime to HTML', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(59750);
		const render = vi.spyOn(quickOtp, 'createQuickOtpPage').mockReturnValue(new Response('preview'));

		await request('');

		expect(render).toHaveBeenCalledWith('287082', expect.objectContaining({ remainingTime: 0.25, validUntil: 60000, serverTime: 59750 }));
	});

	it.each([0, Number.MAX_SAFE_INTEGER])('returns only the requested HOTP counter %i even with preview=1', async (counter) => {
		const expected = await generator.generateOTP(RFC_SECRET, 59000, { type: 'HOTP', counter });
		const generate = vi.spyOn(generator, 'generateOTP');

		const response = await request(`format=json&preview=1&type=hotp&counter=${counter}`);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ token: expected });
		expect(generate).toHaveBeenCalledOnce();
		expect(generate).toHaveBeenCalledWith(RFC_SECRET, expect.any(Number), expect.objectContaining({ type: 'HOTP', counter }));
	});

	it('does not generate a future HOTP code for HTML at the safe counter limit', async () => {
		const generate = vi.spyOn(generator, 'generateOTP');
		const render = vi.spyOn(quickOtp, 'createQuickOtpPage').mockReturnValue(new Response('HOTP'));

		const response = await request(`type=HOTP&counter=${Number.MAX_SAFE_INTEGER}`);

		expect(response.status).toBe(200);
		expect(generate).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledWith(
			expect.stringMatching(/^\d{6}$/),
			expect.objectContaining({
				type: 'HOTP',
				counter: Number.MAX_SAFE_INTEGER,
				remainingTime: 0,
				nextToken: null,
				followingToken: null,
				validUntil: null,
			}),
		);
	});
});
