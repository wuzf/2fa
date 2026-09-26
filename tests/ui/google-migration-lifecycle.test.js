import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/utils/constants.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { getGoogleMigrationCode } from '../../src/ui/scripts/googleMigration.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';

const secret = { issuer: 'Example', name: 'user@example.test', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' };

function createHarness() {
	const window = new Window({ url: 'https://example.test', settings: { disableJavaScriptEvaluation: true } });
	const timers = [];
	const api = createContext({
		window,
		document: window.document,
		navigator: window.navigator,
		localStorage: window.localStorage,
		URL,
		URLSearchParams,
		TextEncoder,
		btoa,
		AbortController,
		console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		setTimeout(callback, milliseconds) {
			const timer = { callback, milliseconds, completed: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			if (timer) {
				timer.completed = true;
			}
		},
		secrets: [{ ...secret, name: secret.issuer, account: secret.name }],
		loadSecrets: vi.fn(async () => {}),
	});
	runInContext(getI18nCode() + getUtilsCode() + getSharedTransferMessageLocalizerCode() + getGoogleMigrationCode(), api);
	api.showCenterToast = vi.fn();
	api.generateQRCodeDataURL = vi.fn(async () => 'data:image/png;base64,fixture');
	api.setLanguage('en');
	return {
		api,
		window,
		document: window.document,
		flushTimers(milliseconds) {
			for (const timer of timers) {
				if (!timer.completed && timer.milliseconds === milliseconds) {
					timer.completed = true;
					timer.callback();
				}
			}
		},
		changeLanguage(language) {
			const oldValue = window.localStorage.getItem('language');
			window.localStorage.setItem('language', language);
			window.dispatchEvent(new window.StorageEvent('storage', { key: 'language', newValue: language, oldValue }));
			expect(api.getLanguage()).toBe(language);
		},
	};
}

const successResponse = (successCount = 1) => ({ ok: true, json: async () => ({ successCount, failCount: 0, results: [] }) });

describe('Google migration dialog lifecycle', () => {
	it('preserves selections, scroll and pending data when a storage event translates an opening preview', () => {
		const { api, document, window, flushTimers, changeLanguage } = createHarness();
		const pending = [secret, { ...secret, issuer: 'Second' }];
		api.showGoogleMigrationPreview(pending);
		document.getElementById('migrate-1').checked = false;
		document.querySelector('.migration-preview-list').scrollTop = 120;
		changeLanguage('ja');
		flushTimers(10);
		expect(document.querySelectorAll('#migrationPreviewModal')).toHaveLength(1);
		expect(document.getElementById('migrationPreviewModal').classList.contains('show')).toBe(true);
		expect(document.querySelector('#migrationPreviewModal h2').textContent).toBe(api.t('transferGoogleImport'));
		expect(document.getElementById('migrate-1').checked).toBe(false);
		expect(document.querySelector('.migration-preview-list').scrollTop).toBe(120);
		expect(window.pendingMigrationSecrets).toBe(pending);
		api.closeMigrationPreview();
		expect(document.body.style.overflow).toBe('');
	});

	it('does not reopen a closing preview or submit again while its batch request is pending', async () => {
		const { api, document, window, flushTimers, changeLanguage } = createHarness();
		let completeRequest;
		api.authenticatedFetch = vi.fn(
			() =>
				new Promise((resolve) => {
					completeRequest = resolve;
				}),
		);
		api.showGoogleMigrationPreview([secret]);
		flushTimers(10);
		const original = document.getElementById('migrationPreviewModal');
		const importing = api.confirmGoogleMigration();
		expect(api.authenticatedFetch).toHaveBeenCalledOnce();
		expect(original.classList.contains('show')).toBe(false);
		changeLanguage('ja');
		expect(document.getElementById('migrationPreviewModal')).toBe(original);
		const duplicate = api.confirmGoogleMigration();
		expect(api.authenticatedFetch).toHaveBeenCalledOnce();
		flushTimers(10);
		expect(original.classList.contains('show')).toBe(false);
		flushTimers(300);
		expect(document.getElementById('migrationPreviewModal')).toBeNull();
		completeRequest(successResponse());
		await importing;
		await duplicate;
		expect(window.pendingMigrationSecrets).toBeNull();
		expect(api.loadSecrets).toHaveBeenCalledOnce();
		expect(api.showCenterToast).toHaveBeenLastCalledWith('✅', api.t('transferImported', { count: 1 }));

		api.authenticatedFetch.mockResolvedValue(successResponse());
		api.showGoogleMigrationPreview([secret]);
		await api.confirmGoogleMigration();
		expect(api.authenticatedFetch).toHaveBeenCalledTimes(2);
	});

	it.each([
		['migrationPreviewModal', 'closeMigrationPreview', (api) => api.showGoogleMigrationPreview([secret])],
		['exportToGoogleModal', 'closeExportToGoogleModal', (api) => api.showExportToGoogleModal()],
		['importResultModal', 'closeImportResultModal', (api) => api.showImportResultModal(0, 1, [{ name: 'Example', error: 'Failed' }])],
		['exportQRCodeModal', 'closeExportQRCodeModal', (api) => api.showExportQRCodeModal([api.secrets], 0, 12)],
	])('keeps %s closed across storage events and delayed opening callbacks', async (id, close, open) => {
		for (const finishOpening of [false, true]) {
			const { api, document, flushTimers, changeLanguage } = createHarness();
			await open(api);
			if (finishOpening) {
				flushTimers(10);
			}
			const original = document.getElementById(id);
			api[close]();
			changeLanguage('ja');
			expect(document.getElementById(id)).toBe(original);
			flushTimers(10);
			expect(original.classList.contains('show')).toBe(false);
			flushTimers(300);
			expect(document.getElementById(id)).toBeNull();
			expect(document.body.style.overflow).toBe('');
		}
	});

	it('opens a fresh QR dialog during the old exit animation and keeps its scroll lock until it closes', async () => {
		const { api, document, flushTimers } = createHarness();
		await api.showExportQRCodeModal([api.secrets], 0, 12);
		const original = document.getElementById('exportQRCodeModal');
		api.closeExportQRCodeModal();
		await api.showExportQRCodeModal([api.secrets], 0, 13);
		const replacement = document.getElementById('exportQRCodeModal');
		expect(replacement).not.toBe(original);
		flushTimers(300);
		flushTimers(10);
		expect(document.getElementById('exportQRCodeModal')).toBe(replacement);
		expect(replacement.classList.contains('show')).toBe(true);
		expect(document.body.style.overflow).toBe('hidden');
		api.closeExportQRCodeModal();
		expect(document.body.style.overflow).toBe('');
	});

	it.each([429, 503])(
		'allows a failed batch to be retried after HTTP %s without an old close timer removing its preview',
		async (status) => {
			const { api, document, window, flushTimers, changeLanguage } = createHarness();
			api.authenticatedFetch = vi.fn().mockResolvedValueOnce({ ok: false, status }).mockResolvedValueOnce(successResponse());
			api.showGoogleMigrationPreview([secret]);
			const original = document.getElementById('migrationPreviewModal');
			await api.confirmGoogleMigration();
			const retryPreview = document.getElementById('migrationPreviewModal');
			expect(retryPreview).not.toBe(original);
			expect(window.pendingMigrationSecrets).toEqual([secret]);
			flushTimers(300);
			flushTimers(10);
			expect(document.getElementById('migrationPreviewModal')).toBe(retryPreview);
			changeLanguage('ja');
			await api.confirmGoogleMigration();
			expect(api.authenticatedFetch).toHaveBeenCalledTimes(2);
			// Each attempt carries its own timeout signal; the request itself is repeated as is.
			const [first, retry] = api.authenticatedFetch.mock.calls.map(([url, { signal, ...options }]) => [
				url,
				options,
				signal instanceof AbortSignal,
			]);
			expect(retry).toEqual(first);
			expect(first[2]).toBe(true);
			expect(window.pendingMigrationSecrets).toBeNull();
		},
	);

	describe('a second migration code scanned while an import is running', () => {
		const first = [secret, { ...secret, issuer: 'Second' }];
		const next = [{ ...secret, issuer: 'Third', name: 'third@example.test' }];

		function startFirstImport(harness) {
			const { api, flushTimers } = harness;
			let completeFirst;
			api.authenticatedFetch = vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							completeFirst = resolve;
						}),
				)
				.mockResolvedValue(successResponse());
			api.showGoogleMigrationPreview(first);
			flushTimers(10);
			const importing = api.confirmGoogleMigration();
			flushTimers(300);
			api.showGoogleMigrationPreview(next);
			flushTimers(10);
			return { importing, complete: (response) => completeFirst(response) };
		}

		it('says an import is running and keeps the new preview open', async () => {
			const harness = createHarness();
			const { api, document, window } = harness;
			const { importing, complete } = startFirstImport(harness);
			const preview = document.getElementById('migrationPreviewModal');

			await api.confirmGoogleMigration();
			expect(api.showCenterToast).toHaveBeenLastCalledWith('⏳', api.t('transferImporting'));
			expect(api.authenticatedFetch).toHaveBeenCalledOnce();
			expect(document.getElementById('migrationPreviewModal')).toBe(preview);
			expect(window.pendingMigrationSecrets).toBe(next);

			complete(successResponse(2));
			await importing;
			await api.confirmGoogleMigration();
			expect(api.authenticatedFetch).toHaveBeenCalledTimes(2);
			expect(JSON.parse(api.authenticatedFetch.mock.calls[1][1].body).secrets.map((item) => item.name)).toEqual(['Third']);
		});

		it('keeps the new preview and its selection when the earlier import finishes', async () => {
			const harness = createHarness();
			const { api, document, window } = harness;
			const { importing, complete } = startFirstImport(harness);
			const preview = document.getElementById('migrationPreviewModal');

			complete(successResponse(2));
			await importing;
			expect(api.showCenterToast).toHaveBeenLastCalledWith('✅', api.t('transferImported', { count: 2 }));
			expect(document.getElementById('migrationPreviewModal')).toBe(preview);
			expect(window.pendingMigrationSecrets).toBe(next);
		});

		it('reports an earlier failure without replacing the new preview', async () => {
			const harness = createHarness();
			const { api, document, window, flushTimers } = harness;
			const { importing, complete } = startFirstImport(harness);
			const preview = document.getElementById('migrationPreviewModal');

			complete({ ok: false, status: 503 });
			await importing;
			expect(api.showCenterToast).toHaveBeenLastCalledWith(
				'❌',
				api.t('transferMigrationInterrupted', { remaining: 2, error: api.t('transferBatchResponseError', { index: 1, count: 1 }) }),
			);
			expect(document.querySelectorAll('#migrationPreviewModal')).toHaveLength(1);
			expect(document.getElementById('migrationPreviewModal')).toBe(preview);
			expect(window.pendingMigrationSecrets).toBe(next);

			await api.confirmGoogleMigration();
			flushTimers(300);
			expect(JSON.parse(api.authenticatedFetch.mock.calls[1][1].body).secrets.map((item) => item.name)).toEqual(['Third']);
			expect(document.body.style.position).toBe('');
		});

		it('does not offer to continue an earlier import that stopped part way once the new preview owns the pending state', async () => {
			const harness = createHarness();
			const { api, document, window, flushTimers } = harness;
			const chunkSize = LIMITS.BULK_IMPORT_CHUNK_SIZE;
			const earlier = Array.from({ length: chunkSize + 1 }, (_, index) => ({ ...secret, issuer: 'Service ' + index }));
			let failSecondChunk;
			api.authenticatedFetch = vi
				.fn()
				.mockResolvedValueOnce(successResponse(chunkSize))
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							failSecondChunk = resolve;
						}),
				)
				.mockResolvedValue(successResponse());
			api.showGoogleMigrationPreview(earlier);
			flushTimers(10);
			const importing = api.confirmGoogleMigration();
			flushTimers(300);
			await vi.waitFor(() => expect(failSecondChunk).toBeTypeOf('function'));
			api.showGoogleMigrationPreview(next);
			flushTimers(10);
			const preview = document.getElementById('migrationPreviewModal');

			failSecondChunk({ ok: false, status: 503 });
			await importing;
			const error = api.t('transferBatchResponseError', { index: 2, count: 2 });
			expect(api.showCenterToast).toHaveBeenLastCalledWith('⚠️', api.t('transferMigrationStopped', { success: chunkSize, error }));
			expect(api.showCenterToast.mock.calls.map(([, message]) => message)).not.toContain(
				api.t('transferMigrationPaused', { success: chunkSize, remaining: 1, error }),
			);
			// The new preview keeps its own selection and no totals of the earlier import.
			expect(document.getElementById('migrationPreviewModal')).toBe(preview);
			expect(window.pendingMigrationSecrets).toBe(next);
			expect(window.pendingMigrationPriorSuccessCount ?? 0).toBe(0);
		});

		it('offers to continue a partly finished import while its own preview is still current', async () => {
			const { api, window } = createHarness();
			const chunkSize = LIMITS.BULK_IMPORT_CHUNK_SIZE;
			const pending = Array.from({ length: chunkSize + 1 }, (_, index) => ({ ...secret, issuer: 'Service ' + index }));
			api.authenticatedFetch = vi.fn().mockResolvedValueOnce(successResponse(chunkSize)).mockResolvedValueOnce({ ok: false, status: 503 });
			api.showGoogleMigrationPreview(pending);
			await api.confirmGoogleMigration();
			const error = api.t('transferBatchResponseError', { index: 2, count: 2 });
			expect(api.showCenterToast).toHaveBeenLastCalledWith(
				'⚠️',
				api.t('transferMigrationPaused', { success: chunkSize, remaining: 1, error }),
			);
			expect(window.pendingMigrationSecrets).toEqual([pending[chunkSize]]);
		});

		it('does not count the earlier import in the totals of the new one', async () => {
			const harness = createHarness();
			const { api, window } = harness;
			window.pendingMigrationPriorSuccessCount = 4;
			const payload = api.generateGoogleMigrationURL([{ name: 'Fresh', account: 'fresh@example.test', secret: secret.secret }]);
			Object.assign(api, { atob, TextDecoder, hideQRScanner: vi.fn(), showScannerError: vi.fn() });
			api.processGoogleMigration(payload);
			expect(window.pendingMigrationPriorSuccessCount).toBe(0);
			expect(window.pendingMigrationSecrets.map((item) => item.issuer)).toEqual(['Fresh']);
		});
	});

	it('previews an entry without issuer and name under the name it is saved with', async () => {
		const { api, document } = createHarness();
		api.authenticatedFetch = vi.fn().mockResolvedValue(successResponse(2));
		api.showGoogleMigrationPreview([
			{ ...secret, issuer: '', name: '' },
			{ ...secret, issuer: '  ', name: ' ' },
		]);
		const titles = [...document.querySelectorAll('#migrationPreviewModal .migration-preview-item')].map(
			(item) => item.querySelector('[style*="font-weight: 600"]').textContent,
		);
		expect(titles).toEqual([api.t('transferImportedKey'), api.t('transferImportedKey')]);
		expect(titles[0]).not.toBe(api.t('transferUnknownService'));

		await api.confirmGoogleMigration();
		const saved = JSON.parse(api.authenticatedFetch.mock.calls[0][1].body).secrets.map((item) => item.name);
		expect(saved).toEqual(titles);
	});

	it('lists a rejected entry without issuer and name under the name it was sent with', async () => {
		const { api, document } = createHarness();
		api.authenticatedFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ successCount: 0, failCount: 1, results: [{ index: 0, success: false, error: 'Secret is required' }] }),
		});
		api.showGoogleMigrationPreview([{ ...secret, issuer: '', name: '' }]);
		await api.confirmGoogleMigration();

		const result = document.getElementById('importResultModal').textContent;
		expect(result).toContain(api.t('transferImportedKey'));
		expect(result).not.toContain(api.t('transferUnknownService'));
	});

	it('releases the scroll lock of a preview that a new preview replaces while still open', () => {
		const { api, document, flushTimers } = createHarness();
		api.showGoogleMigrationPreview([secret]);
		api.showGoogleMigrationPreview([{ ...secret, issuer: 'Replacement' }]);
		expect(document.querySelectorAll('#migrationPreviewModal')).toHaveLength(1);
		expect(document.body.style.position).toBe('fixed');
		api.closeMigrationPreview();
		flushTimers(300);
		expect(document.body.style.position).toBe('');
		expect(document.body.style.overflow).toBe('');
	});

	it('stops waiting for a batch request that never answers and offers the batch again', async () => {
		const { api, document, window, flushTimers } = createHarness();
		api.authenticatedFetch = vi.fn(
			(url, options) =>
				new Promise((resolve, reject) => {
					options.signal.addEventListener('abort', () =>
						reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
					);
				}),
		);
		api.showGoogleMigrationPreview([secret]);
		const importing = api.confirmGoogleMigration();
		flushTimers(60000);
		await importing;

		expect(api.authenticatedFetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(api.showCenterToast).toHaveBeenLastCalledWith(
			'❌',
			api.t('transferMigrationInterrupted', { remaining: 1, error: api.t('transferBatchRequestError', { index: 1, count: 1 }) }),
		);
		expect(api.loadSecrets).toHaveBeenCalledOnce();
		expect(document.getElementById('migrationPreviewModal')).not.toBeNull();
		expect(window.pendingMigrationSecrets).toEqual([secret]);

		api.authenticatedFetch.mockResolvedValueOnce(successResponse());
		await api.confirmGoogleMigration();
		expect(api.authenticatedFetch).toHaveBeenCalledTimes(2);
		expect(window.pendingMigrationSecrets).toBeNull();
	});

	it('resumes only the unfinished chunk and includes prior successes and failures in the final result', async () => {
		const { api, document, window, changeLanguage } = createHarness();
		const chunkSize = LIMITS.BULK_IMPORT_CHUNK_SIZE;
		const pending = Array.from({ length: chunkSize + 1 }, (_, index) => ({ ...secret, issuer: 'Service ' + index }));
		api.authenticatedFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					successCount: chunkSize - 1,
					failCount: 1,
					results: [{ index: 0, success: false, error: 'Secret is required' }],
				}),
			})
			.mockResolvedValueOnce({ ok: false, status: 503 })
			.mockResolvedValueOnce(successResponse());
		api.showGoogleMigrationPreview(pending);
		await api.confirmGoogleMigration();
		expect(window.pendingMigrationSecrets).toEqual([pending[chunkSize]]);
		changeLanguage('ja');
		await api.confirmGoogleMigration();
		const bodies = api.authenticatedFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
		expect(bodies.map((body) => body.secrets.length)).toEqual([chunkSize, 1, 1]);
		expect(bodies[2].secrets).toEqual(bodies[1].secrets);
		expect(bodies[0].immediateBackup).toBe(false);
		expect(bodies[2].immediateBackup).toBe(true);
		const result = document.getElementById('importResultModal');
		expect(result.textContent).toContain(String(chunkSize));
		expect(result.textContent).toContain('Service 0');
		expect(window.pendingMigrationSecrets).toBeNull();
		expect(window.pendingMigrationPriorSuccessCount).toBe(0);
		expect(window.pendingMigrationPriorFailures).toEqual([]);
	});
});
