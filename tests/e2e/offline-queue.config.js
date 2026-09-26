import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: 'offline-queue.spec.js',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	outputDir: '../../test-results/web-offline',
	expect: { timeout: 8000 },
	reporter: [['list']],
});
