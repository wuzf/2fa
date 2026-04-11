import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('build-release script', () => {
	it('configures esbuild mainFields so browser-capable dependencies resolve in neutral bundles', () => {
		const script = readFileSync('scripts/build-release.js', 'utf8');

		expect(script).toContain("mainFields: ['browser', 'module', 'main']");
	});
});
