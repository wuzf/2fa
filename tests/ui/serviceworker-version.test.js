import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

afterEach(() => vi.useRealTimers());

describe('Service Worker update identity', () => {
	it.each([{ SW_VERSION: 'same-release' }, { BUILD_TIMESTAMP: 'fixed-build' }, {}])(
		'emits identical bytes across requests to the same deployment: %j',
		async (environment) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
			const first = await createServiceWorker(environment).text();
			vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
			const later = await createServiceWorker(environment).text();
			expect(later).toBe(first);
		},
	);

	it('still emits a new script and cache names for an actual deployment update', async () => {
		const before = await createServiceWorker({ SW_VERSION: 'release-before' }).text();
		const after = createServiceWorker({ SW_VERSION: 'release-after' });
		const updated = await after.text();
		expect(updated).not.toBe(before);
		expect(updated).toContain('2fa-cache-release-after');
		expect(updated).toContain('2fa-runtime-release-after');
		expect(updated).not.toContain('release-before');
		expect(after.headers.get('Cache-Control')).toContain('no-cache');
	});
});
