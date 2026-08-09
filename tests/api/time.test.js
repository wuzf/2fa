import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGetTime } from '../../src/api/time.js';

describe('Time API', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('返回当前 Unix 毫秒时间并禁止缓存', async () => {
		const serverTimeMs = 1786248000123;
		vi.spyOn(Date, 'now').mockReturnValue(serverTimeMs);

		const response = handleGetTime(new Request('https://example.com/api/time'));

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		await expect(response.json()).resolves.toEqual({ serverTimeMs });
	});
});
