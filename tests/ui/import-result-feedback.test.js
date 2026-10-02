// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/utils/constants.js';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { transferI18n } from '../helpers/transfer-i18n.js';

const ACCOUNT = { name: 'Example', account: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP' };
const OTHER = { name: 'Other', account: 'bob@example.com', secret: 'GEZDGNBVGY3TQOJQ' };

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(respond) {
	document.body.innerHTML =
		'<div id="importModal"><textarea id="importText"></textarea>' +
		'<div id="importPreview"><div id="importPreviewList"></div></div><button id="executeImportBtn"></button></div>';
	const i18n = transferI18n('en');
	const context = createContext({
		...i18n,
		document,
		window: {},
		URL,
		URLSearchParams,
		console: { log() {}, warn() {}, error() {} },
		showCenterToast: vi.fn(),
		showImportResultModal: vi.fn(),
		authenticatedFetch: vi.fn(async () => respond()),
		loadSecrets: vi.fn(),
	});
	runInContext(getUtilsCode() + getImportCode(), context);
	return {
		context,
		t: i18n.t,
		async importAccounts(accounts) {
			document.getElementById('importText').value = JSON.stringify({ secrets: accounts });
			context.previewImport();
			await context.executeImport();
		},
	};
}

describe('batch import result feedback', () => {
	it('reports a batch queued by the offline Service Worker as saved for sync, not as imported', async () => {
		const h = harness(() => jsonResponse({ success: true, queued: true, offline: true, operationId: 1 }, 202));
		await h.importAccounts([ACCOUNT, OTHER]);

		expect(h.context.showCenterToast).toHaveBeenCalledWith('📥', h.t('coreQueued'));
		expect(h.context.showCenterToast).not.toHaveBeenCalledWith('✅', expect.anything());
		expect(h.context.showImportResultModal).not.toHaveBeenCalled();
	});

	describe('an import interrupted after a batch was queued offline', () => {
		const accounts = Array.from({ length: LIMITS.BULK_IMPORT_CHUNK_SIZE + 1 }, (_, index) => ({ ...ACCOUNT, name: 'Service ' + index }));
		const queued = () => jsonResponse({ success: true, queued: true, offline: true, operationId: 1 }, 202);
		const imported = (name) => jsonResponse({ successCount: 1, failCount: 0, results: [{ index: 0, success: true, secret: { name } }] });

		it('still reports the queued entries once the rest is imported', async () => {
			const responses = [queued(), jsonResponse({ error: 'Service Unavailable' }, 503), imported('Service 100')];
			const h = harness(() => responses.shift());
			await h.importAccounts(accounts);
			expect(h.context.authenticatedFetch).toHaveBeenCalledTimes(2);

			await h.context.executeImport();

			expect(h.context.authenticatedFetch).toHaveBeenCalledTimes(3);
			expect(h.context.showCenterToast).toHaveBeenLastCalledWith('📥', h.t('coreQueued'));
			expect(h.context.showCenterToast).not.toHaveBeenCalledWith('✅', expect.anything());
		});

		it('does not count them in a new import', async () => {
			const responses = [queued(), jsonResponse({ error: 'Service Unavailable' }, 503), imported(OTHER.name)];
			const h = harness(() => responses.shift());
			await h.importAccounts(accounts);

			await h.importAccounts([OTHER]);

			expect(h.context.showCenterToast).toHaveBeenLastCalledWith('✅', h.t('transferImported', { count: 1 }));
		});
	});

	it('lists every failed entry with its reason after the import', async () => {
		const h = harness(() =>
			jsonResponse({
				successCount: 1,
				failCount: 1,
				results: [
					{ index: 0, success: true, secret: { name: ACCOUNT.name } },
					{ index: 1, success: false, error: 'Account already exists' },
				],
			}),
		);
		await h.importAccounts([ACCOUNT, OTHER]);

		expect(h.context.showCenterToast).toHaveBeenCalledWith('⚠️', h.t('transferImportSummary', { success: 1, failed: 1 }));
		expect(h.context.showImportResultModal).toHaveBeenCalledWith(1, 1, [{ name: OTHER.name, error: 'Account already exists' }]);
	});

	it('shows no result dialog when every entry is imported', async () => {
		const h = harness(() =>
			jsonResponse({ successCount: 1, failCount: 0, results: [{ index: 0, success: true, secret: { name: ACCOUNT.name } }] }),
		);
		await h.importAccounts([ACCOUNT]);

		expect(h.context.showCenterToast).toHaveBeenCalledWith('✅', h.t('transferImported', { count: 1 }));
		expect(h.context.showImportResultModal).not.toHaveBeenCalled();
	});
});
