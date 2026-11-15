import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { workerBannerVersions } from '../../scripts/publish-release.js';

describe('build-release script', () => {
	it('opens the Worker with the version that publishing checks against the tag', () => {
		const outputDir = mkdtempSync(join(tmpdir(), '2fa-release-build-test-'));
		try {
			const result = spawnSync(process.execPath, ['scripts/build-release.js', `--output=${join(outputDir, 'worker.js')}`], {
				encoding: 'utf8',
			});
			expect(result.status, result.stderr).toBe(0);
			const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
			const worker = readFileSync(join(outputDir, 'worker.js'), 'utf8');
			const metadata = JSON.parse(readFileSync(join(outputDir, 'worker.metadata.json'), 'utf8'));

			expect(workerBannerVersions(worker)).toEqual([version]);
			expect(metadata.version).toBe(version);
			// The banner stays outside the hashed bundle, which still carries its own identity.
			expect(worker).toContain(`"${metadata.buildId}"`);
		} finally {
			rmSync(outputDir, { recursive: true, force: true });
		}
	}, 120_000);

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
			"const version = getBuildId() || env.SW_VERSION || env.BUILD_TIMESTAMP || embeddedBuildVersion || 'v1';",
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
