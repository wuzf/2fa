import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';

function runPage(html) {
	const elements = new Map();
	for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/g)) {
		const listeners = {};
		elements.set(match[3], {
			textContent: match[4],
			value: '',
			style: {},
			attributes: {},
			listeners,
			classList: { add: vi.fn(), remove: vi.fn() },
			addEventListener: (name, listener) => {
				listeners[name] = listener;
			},
			setAttribute(name, value) {
				this.attributes[name] = value;
			},
		});
	}
	const documentListeners = {};
	let elapsed = 0;
	const location = { href: '', reload: vi.fn() };
	const writeText = vi.fn().mockResolvedValue(undefined);
	const setInterval = vi.fn();
	const clearInterval = vi.fn();
	const context = createContext({
		document: {
			documentElement: { setAttribute: vi.fn() },
			hidden: false,
			getElementById: (id) => elements.get(id) || null,
			addEventListener: (name, listener) => {
				documentListeners[name] = listener;
			},
		},
		window: { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }), addEventListener: vi.fn() },
		localStorage: { getItem: () => 'light' },
		navigator: { clipboard: { writeText } },
		performance: { now: () => elapsed },
		location,
		setInterval,
		clearInterval,
		setTimeout: vi.fn(),
		clearTimeout: vi.fn(),
	});
	for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {runInContext(match[1], context);}
	return {
		elements,
		location,
		writeText,
		setInterval,
		clearInterval,
		documentListeners,
		advance: (ms) => {
			elapsed = ms;
		},
	};
}

describe('public OTP pages', () => {
	it.each([
		['HOTP', 0],
		['hotp', 4294967297],
	])('never auto-refreshes %s links with counter %s', async (type, counter) => {
		const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
		const response = await handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}?type=${type}&counter=${counter}`));
		const html = await response.text();
		const h = runPage(html);
		expect(response.status).toBe(200);
		expect(html).toContain(`计数器：${counter}`);
		expect(h.elements.has('progress')).toBe(false);
		expect(h.setInterval).not.toHaveBeenCalled();
		h.advance(120000);
		h.documentListeners.visibilitychange?.();
		await h.elements.get('token').listeners.click();
		expect(h.writeText).toHaveBeenCalledWith(h.elements.get('token').textContent);
		if (counter === 0) {expect(h.writeText).toHaveBeenCalledWith('755224');}
		expect(h.location.reload).not.toHaveBeenCalled();
		expect(h.elements.get('copied').textContent).toBe('验证码已复制');
	});

	it('refreshes a TOTP code once at expiry, even after a throttled timer', async () => {
		const h = runPage(await createQuickOtpPage('123456', { period: 30, remainingTime: 2 }).text());
		const tick = h.setInterval.mock.calls[0][0];
		expect(h.elements.get('countdown').textContent).toBe('2 秒后更新');
		h.advance(1000);
		tick();
		expect(h.elements.get('countdown').textContent).toBe('1 秒后更新');
		expect(h.location.reload).not.toHaveBeenCalled();
		h.advance(65000);
		h.documentListeners.visibilitychange();
		tick();
		expect(h.location.reload).toHaveBeenCalledTimes(1);
		expect(h.clearInterval).toHaveBeenCalledTimes(1);
		expect(h.elements.get('progress').attributes['aria-valuenow']).toBe('0');
	});

	it('reports a failed clipboard write without advancing or reloading HOTP', async () => {
		const h = runPage(await createQuickOtpPage('755224', { type: 'HOTP' }).text());
		h.writeText.mockRejectedValue(new Error('Permission denied'));
		await h.elements.get('token').listeners.click();
		expect(h.elements.get('copied').textContent).toContain('复制失败');
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('does not extend an expired TOTP when generation crosses a period boundary', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValueOnce(59000).mockReturnValue(60000);
		try {
			const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
			const response = await handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}`));
			const h = runPage(await response.text());
			expect(h.elements.get('token').textContent).toBe('287082');
			expect(h.elements.get('countdown').textContent).toBe('正在更新验证码…');
			expect(h.location.reload).toHaveBeenCalledOnce();
		} finally {
			now.mockRestore();
		}
	});

	it('normalizes whitespace and escapes the entry form path', async () => {
		const h = runPage(await createOtpEntryPage().text());
		h.elements.get('s').value = ' JBSW Y3DP\nEHPK3PXP==== ';
		const event = { preventDefault: vi.fn() };
		h.elements.get('otpEntryForm').listeners.submit(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(h.location.href).toBe('/otp/JBSWY3DPEHPK3PXP%3D%3D%3D%3D');
	});

	it('keeps JSON mode and plain-text usage responses unchanged', async () => {
		const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
		const json = await handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}?type=HOTP&counter=0&format=json`));
		expect(await json.json()).toEqual({ token: '755224' });
		const usage = await handleGenerateOTP('', new Request('https://example.com/otp'));
		expect(usage.status).toBe(400);
		expect(await usage.text()).toContain('Usage: https://example.com/otp/YOUR_SECRET_KEY');
		const entry = await handleGenerateOTP('', new Request('https://example.com/otp', { headers: { Accept: 'text/html' } }));
		expect(entry.status).toBe(200);
		expect(await entry.text()).toContain('id="otpEntryForm"');
	});
});
