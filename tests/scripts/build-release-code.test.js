import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('build-release script', () => {
	it('configures esbuild mainFields so browser-capable dependencies resolve in neutral bundles', () => {
		const script = readFileSync('scripts/build-release.js', 'utf8');

		expect(script).toContain("mainFields: ['browser', 'module', 'main']");
	});

	it('embeds a service worker version fallback for standalone release builds', () => {
		const script = readFileSync('scripts/build-release.js', 'utf8');
		const serviceWorkerSource = readFileSync('src/ui/serviceworker.js', 'utf8');

		expect(script).toContain('globalThis.__BUILD_SW_VERSION__');
		expect(serviceWorkerSource).toContain(
			"const embeddedBuildVersion = typeof globalThis.__BUILD_SW_VERSION__ === 'string' ? globalThis.__BUILD_SW_VERSION__ : '';",
		);
		expect(serviceWorkerSource).toContain(
			"const version = env.SW_VERSION || env.BUILD_TIMESTAMP || embeddedBuildVersion || 'v1';",
		);
	});

	it('mentions optional cloud drive OAuth secrets in the generated deploy guide', () => {
		const script = readFileSync('scripts/build-release.js', 'utf8');

		expect(script).toContain('ONEDRIVE_CLIENT_ID');
		expect(script).toContain('ONEDRIVE_CLIENT_SECRET');
		expect(script).toContain('GOOGLE_DRIVE_CLIENT_ID');
		expect(script).toContain('GOOGLE_DRIVE_CLIENT_SECRET');
		expect(script).toContain('OAUTH_REDIRECT_BASE_URL');
		expect(script).toContain('CLOUD_DRIVE_SETUP.md');
	});
});
