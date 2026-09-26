// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { handleBatchAddSecrets, handleGetSecrets } from '../../src/api/secrets/index.js';
import { getImportCode } from '../../src/ui/scripts/import/index.js';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';
import { transferI18n } from '../helpers/transfer-i18n.js';

const ACCOUNT = { name: 'Example', account: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP' };

function harness() {
	document.body.innerHTML =
		'<div id="importModal"><textarea id="importText"></textarea>' +
		'<div id="importPreview"><div id="importPreviewList"></div></div><button id="executeImportBtn"></button></div>';
	const values = new Map();
	const env = {
		LOG_LEVEL: 'ERROR',
		ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
		SECRETS_KV: {
			async get(key, type) {
				const value = values.get(key);
				return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
			},
			async put(key, value) {
				values.set(key, String(value));
			},
			async delete(key) {
				values.delete(key);
			},
			async list({ prefix = '' } = {}) {
				return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
			},
		},
	};
	const sendBatch = (payload) =>
		handleBatchAddSecrets(
			new Request('https://fixture.invalid/api/secrets/batch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			}),
			env,
		);
	const authenticatedFetch = vi.fn((path, options) => {
		expect(path).toBe('/api/secrets/batch');
		return sendBatch(JSON.parse(options.body));
	});
	const context = createContext({
		...transferI18n('en'),
		document,
		window: {},
		URL,
		URLSearchParams,
		console: { log() {}, warn() {}, error() {} },
		showCenterToast: vi.fn(),
		authenticatedFetch,
		loadSecrets: vi.fn(),
	});
	runInContext(getUtilsCode() + getImportCode(), context);
	return {
		context,
		authenticatedFetch,
		sendBatch,
		preview(text) {
			document.getElementById('importText').value = text;
			context.previewImport();
			return runInContext('importPreviewData', context);
		},
		readSecrets: async () => (await handleGetSecrets(env)).json(),
	};
}

describe('blank service names through import preview and API storage', () => {
	it.each(['JSON', 'URI'])('excludes whitespace-only %s entries while importing usable accounts', async (format) => {
		const h = harness();
		const text =
			format === 'JSON'
				? JSON.stringify({ secrets: [ACCOUNT, { ...ACCOUNT, name: ' \t\u3000 ' }] })
				: 'otpauth://totp/Example:alice%40example.com?secret=' +
					ACCOUNT.secret +
					'\n' +
					'otpauth://totp/%20%09%E3%80%80:alice%40example.com?issuer=%20%09%E3%80%80&secret=' +
					ACCOUNT.secret;
		const preview = h.preview(text);
		expect(preview).toHaveLength(2);
		expect(preview[0]).toMatchObject({ serviceName: ACCOUNT.name, valid: true });
		expect(preview[1]).toMatchObject({ valid: false });
		expect(document.querySelectorAll('.import-preview-item.invalid')).toHaveLength(1);
		await h.context.executeImport();
		expect(h.authenticatedFetch).toHaveBeenCalledOnce();
		expect(JSON.parse(h.authenticatedFetch.mock.calls[0][1].body).secrets).toEqual([expect.objectContaining(ACCOUNT)]);
		expect(await h.readSecrets()).toEqual([expect.objectContaining(ACCOUNT)]);
	});

	it('disables an entirely blank-name preview and sends no batch even if execute is invoked directly', async () => {
		const h = harness();
		h.preview(JSON.stringify({ secrets: [{ ...ACCOUNT, name: '\t\u3000' }] }));
		expect(document.getElementById('executeImportBtn').disabled).toBe(true);
		await h.context.executeImport();
		expect(h.authenticatedFetch).not.toHaveBeenCalled();
		expect(await h.readSecrets()).toEqual([]);
	});

	it('rejects blank names at the API boundary when a client bypasses preview, preserving usable entries', async () => {
		const h = harness();
		const result = await (await h.sendBatch({ secrets: [ACCOUNT, { ...ACCOUNT, name: ' \t\u3000 ' }] })).json();
		expect(result).toMatchObject({ successCount: 1, failCount: 1 });
		expect(result.results[1]).toMatchObject({ success: false, error: '服务名称不能为空' });
		expect(await h.readSecrets()).toEqual([expect.objectContaining(ACCOUNT)]);
	});
});
