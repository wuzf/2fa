import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
	testDir: './e2e',
	// This only skips installed-browser smoke tests; every extension scenario
	// still exercises both Chrome and Edge builds using Playwright Chromium.
	testIgnore: process.env.EXTENSION_E2E_SKIP_BRANDED === '1' ? ['**/branded.spec.js'] : [],
	forbidOnly: Boolean(process.env.CI),
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	outputDir: '../../test-results/extension',
	expect: {
		timeout: 5000,
	},
	reporter: process.env.CI
		? [['list'], ['html', { outputFolder: resolve(import.meta.dirname, '../../test-results/extension-report'), open: 'never' }]]
		: [['list']],
	// Persistent extension contexts own their tracing start/stop lifecycle.
	// Runner-managed tracing would conflict with those explicit calls.
	use: {
		screenshot: 'only-on-failure',
	},
});
