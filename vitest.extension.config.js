import { defineConfig } from 'vitest/config';
import sharedConfig from './vitest.config.js';

export default defineConfig({
	...sharedConfig,
	test: {
		...sharedConfig.test,
		include: ['tests/extension/**/*.test.js'],
		coverage: {
			...sharedConfig.test.coverage,
			include: ['extension/src/**/*.js', 'src/shared/**/*.js'],
			exclude: [],
			reportsDirectory: 'coverage/extension',
			reporter: ['text', 'html', 'json-summary', 'lcov'],
		},
	},
});
