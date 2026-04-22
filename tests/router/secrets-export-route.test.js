import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/secrets/index.js', () => ({
	handleGetSecrets: vi.fn(),
	handleAddSecret: vi.fn(),
	handleUpdateSecret: vi.fn(),
	handleDeleteSecret: vi.fn(),
	handleGenerateOTP: vi.fn(),
	handleBatchAddSecrets: vi.fn(),
	handleBackupSecrets: vi.fn(),
	handleGetBackups: vi.fn(),
	handleRestoreBackup: vi.fn(),
	handleExportBackup: vi.fn(),
	handleExportSecrets: vi.fn(async (request, env) => new Response(JSON.stringify({ success: true }), { status: 200 })),
}));

vi.mock('../../src/api/favicon.js', () => ({ handleFaviconProxy: vi.fn() }));
vi.mock('../../src/api/webdav.js', () => ({
	handleGetWebDAVConfigs: vi.fn(),
	handleSaveWebDAVConfig: vi.fn(),
	handleTestWebDAV: vi.fn(),
	handleDeleteWebDAVConfig: vi.fn(),
	handleToggleWebDAV: vi.fn(),
}));
vi.mock('../../src/api/s3.js', () => ({
	handleGetS3Configs: vi.fn(),
	handleSaveS3Config: vi.fn(),
	handleTestS3: vi.fn(),
	handleDeleteS3Config: vi.fn(),
	handleToggleS3: vi.fn(),
}));
vi.mock('../../src/api/onedrive.js', () => ({
	handleDeleteOneDriveConfig: vi.fn(),
	handleGetOneDriveConfigs: vi.fn(),
	handleOneDriveOAuthCallback: vi.fn(),
	handleSaveOneDriveConfig: vi.fn(),
	handleStartOneDriveOAuth: vi.fn(),
	handleToggleOneDrive: vi.fn(),
}));
vi.mock('../../src/api/gdrive.js', () => ({
	handleDeleteGoogleDriveConfig: vi.fn(),
	handleGetGoogleDriveConfigs: vi.fn(),
	handleGoogleDriveOAuthCallback: vi.fn(),
	handleSaveGoogleDriveConfig: vi.fn(),
	handleStartGoogleDriveOAuth: vi.fn(),
	handleToggleGoogleDrive: vi.fn(),
}));
vi.mock('../../src/api/password.js', () => ({ handleChangePassword: vi.fn() }));
vi.mock('../../src/api/settings.js', () => ({
	handleGetSettings: vi.fn(),
	handleSaveSettings: vi.fn(),
}));
vi.mock('../../src/ui/page.js', () => ({
	createMainPage: vi.fn(async () => new Response('<html></html>', { status: 200 })),
}));
vi.mock('../../src/ui/setupPage.js', () => ({
	createSetupPage: vi.fn(async () => new Response('<html></html>', { status: 200 })),
}));
vi.mock('../../src/ui/manifest.js', () => ({
	createManifest: vi.fn(() => new Response('{}', { status: 200 })),
	createDefaultIcon: vi.fn(() => new Response('icon', { status: 200 })),
}));
vi.mock('../../src/ui/serviceworker.js', () => ({
	createServiceWorker: vi.fn(() => new Response('// sw', { status: 200 })),
}));
vi.mock('../../src/ui/scripts/index.js', () => ({
	getModuleCode: vi.fn(() => ''),
}));
vi.mock('../../src/utils/response.js', () => ({
	createErrorResponse: vi.fn((error, message, status = 500) => new Response(JSON.stringify({ error, message }), { status })),
}));
vi.mock('../../src/utils/auth.js', () => ({
	verifyAuthWithDetails: vi.fn(async () => ({ valid: true, needsRefresh: false })),
	requiresAuth: vi.fn(() => true),
	createUnauthorizedResponse: vi.fn(() => new Response('{}', { status: 401 })),
	handleLogin: vi.fn(),
	handleRefreshToken: vi.fn(),
	checkIfSetupRequired: vi.fn(async () => false),
	handleFirstTimeSetup: vi.fn(),
}));
vi.mock('../../src/utils/security.js', () => ({
	createPreflightResponse: vi.fn(() => null),
}));
vi.mock('../../src/utils/logger.js', () => ({
	getLogger: vi.fn(() => ({
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	})),
}));

import { handleRequest } from '../../src/router/handler.js';
import { handleExportSecrets } from '../../src/api/secrets/index.js';

function createMockRequest({ method = 'GET', pathname = '/', body = {} } = {}) {
	return {
		method,
		url: `https://example.com${pathname}`,
		headers: new Headers({
			'Content-Type': 'application/json',
		}),
		json: async () => body,
	};
}

describe('secrets export route', () => {
	it('dispatches POST /api/secrets/export to handleExportSecrets', async () => {
		const request = createMockRequest({
			method: 'POST',
			pathname: '/api/secrets/export',
			body: {
				format: 'txt',
				secrets: [{ id: '1', name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }],
			},
		});
		const env = {};

		const response = await handleRequest(request, env);

		expect(handleExportSecrets).toHaveBeenCalledWith(request, env);
		expect(response.status).toBe(200);
	});

	it('rejects unsupported methods for /api/secrets/export', async () => {
		const request = createMockRequest({
			method: 'GET',
			pathname: '/api/secrets/export',
		});
		const env = {};

		const response = await handleRequest(request, env);

		expect(response.status).toBe(405);
	});
});
