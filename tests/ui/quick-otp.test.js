import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGenerateOTP } from '../../src/api/secrets/otp.js';
import { createOtpEntryPage, createQuickOtpPage } from '../../src/ui/quickOtp.js';

function runPage(html, { startTime = 0 } = {}) {
	const elements = new Map();
	for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/g)) {
		const listeners = {};
		elements.set(match[3], {
			textContent: match[4].trim(),
			value: '',
			style: {},
			attributes: {},
			disabled: false,
			hidden: match[2].includes('hidden'),
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
	const windowListeners = {};
	let elapsed = startTime;
	let wallOffset = 0;
	const location = { href: 'https://example.com/otp/JBSWY3DPEHPK3PXP?digits=6&period=30&algorithm=SHA256', reload: vi.fn() };
	const writeText = vi.fn().mockResolvedValue(undefined);
	const setInterval = vi.fn();
	const requests = [];
	const fetch = vi.fn(() => new Promise((resolve) => requests.push(resolve)));
	const timers = new Map();
	let timerId = 0;
	const document = {
		documentElement: { setAttribute: vi.fn() },
		hidden: false,
		getElementById: (id) => elements.get(id) || null,
		addEventListener: (name, listener) => {
			documentListeners[name] = listener;
		},
	};
	const context = createContext({
		document,
		window: {
			matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
			addEventListener: (name, listener) => {
				windowListeners[name] = listener;
			},
		},
		localStorage: { getItem: () => 'light' },
		navigator: { clipboard: { writeText } },
		performance: { now: () => elapsed },
		Date: { now: () => elapsed + wallOffset },
		location,
		URL,
		AbortController,
		fetch,
		setInterval,
		setTimeout: (callback, delay) => {
			timers.set(++timerId, { callback, delay });
			return timerId;
		},
		clearTimeout: (id) => timers.delete(id),
	});
	for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
		runInContext(match[1], context);
	}
	return {
		elements,
		location,
		writeText,
		setInterval,
		fetch,
		document,
		documentListeners,
		windowListeners,
		timers,
		advance: (ms) => {
			elapsed = ms;
		},
		advanceWall: (ms) => {
			wallOffset += ms;
		},
		tick: () => setInterval.mock.calls[0][0](),
		async respond(data, { ok = true, index = 0 } = {}) {
			requests[index]({ ok, json: async () => data });
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
		},
	};
}

const preview = { period: 30, remainingTime: 2, nextToken: '654321', followingToken: '345678', validUntil: 60000 };
async function totpHarness(options = {}, runtime = {}) {
	return runPage(await createQuickOtpPage('123456', { ...preview, ...options }).text(), runtime);
}

describe('public OTP pages', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		['HOTP', 0],
		['hotp', 4294967297],
	])('never advances or auto-refreshes %s links with counter %s', async (type, counter) => {
		const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
		const response = await handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}?type=${type}&counter=${counter}`));
		const html = await response.text();
		const h = runPage(html);
		expect(response.status).toBe(200);
		expect(html).toContain(`计数器：${counter}`);
		expect(h.elements.has('progress')).toBe(false);
		expect(h.elements.has('nextToken')).toBe(false);
		expect(h.setInterval).not.toHaveBeenCalled();
		h.advance(120000);
		h.documentListeners.visibilitychange?.();
		await h.elements.get('token').listeners.click();
		expect(h.writeText).toHaveBeenCalledWith(h.elements.get('tokenValue').textContent);
		if (counter === 0) {
			expect(h.writeText).toHaveBeenCalledWith('755224');
		}
		expect(h.location.reload).not.toHaveBeenCalled();
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.elements.get('copied').textContent).toBe('验证码已复制');
	});

	it('copies current and next codes separately and preserves leading zeroes', async () => {
		const h = await totpHarness({ nextToken: '001234' });
		await h.elements.get('token').listeners.click();
		await h.elements.get('nextToken').listeners.click();
		expect(h.writeText.mock.calls.map((args) => args[0])).toEqual(['123456', '001234']);
		expect(h.elements.get('copied').textContent).toBe('下一个验证码已复制');
		expect(h.fetch).not.toHaveBeenCalled();
	});

	it('promotes the preview and refreshes both codes without reloading or losing query parameters', async () => {
		const h = await totpHarness();
		h.advance(1000);
		h.tick();
		expect(h.elements.get('countdown').textContent).toBe('1 秒后更新');
		h.advance(2000);
		h.tick();
		h.tick();
		expect(h.elements.get('tokenValue').textContent).toBe('654321');
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.elements.get('nextToken').disabled).toBe(false);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		const url = new URL(h.fetch.mock.calls[0][0]);
		expect(Object.fromEntries(url.searchParams)).toEqual({ digits: '6', period: '30', algorithm: 'SHA256', format: 'json', preview: '1' });
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 60000 });
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.elements.get('nextToken').disabled).toBe(false);
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('does not promote early or allow expired copying during the initial network uncertainty gap', async () => {
		const h = await totpHarness({}, { startTime: 500 });
		h.advance(2000);
		h.tick();
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.elements.get('nextToken').disabled).toBe(true);
		expect(h.elements.get('tokenValue').textContent).toBe('123456');
		expect(h.elements.get('nextTokenValue').textContent).toBe('654321');
		await h.elements.get('token').listeners.click();
		await h.elements.get('nextToken').listeners.click();
		expect(h.writeText).not.toHaveBeenCalled();
		h.advance(2500);
		h.tick();
		expect(h.elements.get('tokenValue').textContent).toBe('654321');
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.fetch).toHaveBeenCalledTimes(1);
	});

	it('removes stale codes after multiple missed windows and allows an explicit retry', async () => {
		const h = await totpHarness();
		h.document.hidden = true;
		h.advance(65000);
		h.tick();
		expect(h.fetch).not.toHaveBeenCalled();
		h.document.hidden = false;
		h.documentListeners.visibilitychange();
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.elements.get('nextToken').disabled).toBe(true);
		await h.respond({}, { ok: false });
		expect(h.elements.get('retry').hidden).toBe(false);
		expect(h.elements.get('refreshMessage').textContent).toContain('检查网络');
		h.tick();
		expect(h.fetch).toHaveBeenCalledTimes(1);
		h.elements.get('retry').listeners.click();
		await h.respond(
			{ token: '234567', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 150000, serverTime: 125000 },
			{ index: 1 },
		);
		expect(h.elements.get('tokenValue').textContent).toBe('234567');
		expect(h.elements.get('retry').hidden).toBe(true);
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('does not let a delayed previous-window response overwrite the promoted code', async () => {
		const h = await totpHarness();
		h.advance(2000);
		h.tick();
		await h.respond({ token: '123456', nextToken: '654321', followingToken: '345678', period: 30, validUntil: 60000, serverTime: 60000 });
		expect(h.elements.get('tokenValue').textContent).toBe('654321');
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.elements.get('nextToken').disabled).toBe(false);
		expect(h.elements.get('retry').hidden).toBe(false);
	});

	it('rejects a response that expired during transit', async () => {
		const h = await totpHarness();
		h.advance(2000);
		h.tick();
		h.advance(35000);
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 60000 });
		expect(h.elements.get('tokenValue').textContent).toBe('345678');
		expect(h.elements.get('token').disabled).toBe(false);
		expect(h.elements.get('nextToken').disabled).toBe(true);
		expect(h.elements.get('retry').hidden).toBe(false);
	});

	it('keeps both digit displays across consecutive handoffs even while the refresh is slow', async () => {
		const h = await totpHarness({}, { startTime: 500 });
		const frames = [];
		const sample = (at) => {
			h.advance(at);
			h.tick();
			frames.push([h.elements.get('tokenValue').textContent, h.elements.get('nextTokenValue').textContent]);
		};
		for (let at = 500; at <= 6500; at += 250) {
			sample(at);
		}
		expect(frames.every((pair) => pair.every((code) => /^[0-9]{6}$/.test(code)))).toBe(true);
		expect(frames.at(-1)).toEqual(['654321', '345678']);
		expect(h.fetch).toHaveBeenCalledTimes(1);
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 61000 });
		for (let at = 6750; at <= 35500; at += 250) {
			sample(at);
		}
		expect(frames.every((pair) => pair.every((code) => /^[0-9]{6}$/.test(code)))).toBe(true);
		expect(frames.at(-1)).toEqual(['345678', '456789']);
		await h.elements.get('token').listeners.click();
		await h.elements.get('nextToken').listeners.click();
		expect(h.writeText.mock.calls.map((args) => args[0])).toEqual(['345678', '456789']);
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('resynchronizes immediately when a slow navigation arrives outside the safe window', async () => {
		const h = await totpHarness({ remainingTime: 20 }, { startTime: 40000 });
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.fetch).toHaveBeenCalledOnce();
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 80000 });
		expect(h.elements.get('tokenValue').textContent).toBe('654321');
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.elements.get('token').disabled).toBe(false);
	});

	it('automatically retries a failed initial time calibration even with a full buffer', async () => {
		const h = await totpHarness({ remainingTime: 20 }, { startTime: 40000 });
		await h.respond({}, { ok: false });
		h.advance(42999);
		h.tick();
		expect(h.fetch).toHaveBeenCalledTimes(1);
		h.advance(43000);
		h.tick();
		expect(h.fetch).toHaveBeenCalledTimes(2);
		await h.respond(
			{ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 83000 },
			{ index: 1 },
		);
		expect(h.elements.get('token').disabled).toBe(false);
		expect(h.elements.get('retry').hidden).toBe(true);
	});

	it('aborts a hung refresh and ignores its eventual response', async () => {
		const h = await totpHarness();
		h.advance(2000);
		h.tick();
		const timeout = [...h.timers.values()].find((timer) => timer.delay === 8000);
		expect(timeout).toBeDefined();
		timeout.callback();
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 60000 });
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
		expect(h.elements.get('nextToken').disabled).toBe(false);
		expect(h.elements.get('retry').hidden).toBe(false);
	});

	it('reports clipboard failure without altering a fixed HOTP', async () => {
		const h = runPage(await createQuickOtpPage('755224', { type: 'HOTP' }).text());
		h.writeText.mockRejectedValue(new Error('Permission denied'));
		await h.elements.get('token').listeners.click();
		expect(h.elements.get('copied').textContent).toContain('复制失败');
		expect(h.elements.get('tokenValue').textContent).toBe('755224');
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('blocks stale copying after system sleep even when the monotonic clock barely advances', async () => {
		const h = await totpHarness({ remainingTime: 20 });
		h.advanceWall(120000);
		h.advance(100);
		await h.elements.get('token').listeners.click();
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.writeText).not.toHaveBeenCalled();
		expect(h.fetch).toHaveBeenCalledOnce();
	});

	it('discards an in-flight response when returning from the background and resynchronizes', async () => {
		const h = await totpHarness();
		h.advance(2000);
		h.tick();
		h.advanceWall(120000);
		h.documentListeners.visibilitychange();
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		await h.respond({ token: '654321', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 90000, serverTime: 60000 });
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.fetch).toHaveBeenCalledTimes(2);
		await h.respond(
			{ token: '234567', nextToken: '345678', followingToken: '456789', period: 30, validUntil: 210000, serverTime: 182000 },
			{ index: 1 },
		);
		expect(h.elements.get('tokenValue').textContent).toBe('234567');
		expect(h.elements.get('nextTokenValue').textContent).toBe('345678');
	});

	it('revalidates codes restored from the back-forward cache', async () => {
		const h = await totpHarness();
		h.windowListeners.pageshow({ persisted: true });
		expect(h.elements.get('token').disabled).toBe(true);
		expect(h.fetch).toHaveBeenCalledOnce();
	});

	it('never displays an already expired current code when generation crosses the boundary', async () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(59000).mockReturnValue(60000);
		const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
		const response = await handleGenerateOTP(secret, new Request(`https://example.com/otp/${secret}`));
		const html = await response.text();
		const expected = html.match(/id="nextTokenValue">([0-9]+)/)[1];
		const h = runPage(html);
		expect(h.elements.get('tokenValue').textContent).toBe(expected);
		expect(h.elements.get('tokenValue').textContent).not.toBe('287082');
		expect(h.fetch).toHaveBeenCalledTimes(1);
		expect(h.location.reload).not.toHaveBeenCalled();
	});

	it('normalizes whitespace and escapes the entry form path', async () => {
		const h = runPage(await createOtpEntryPage().text());
		h.elements.get('s').value = ' JBSW Y3DP\nEHPK3PXP==== ';
		const event = { preventDefault: vi.fn() };
		h.elements.get('otpEntryForm').listeners.submit(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(h.location.href).toBe('/otp/JBSWY3DPEHPK3PXP%3D%3D%3D%3D');
	});

	it('keeps JSON mode and plain-text usage responses compatible', async () => {
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
