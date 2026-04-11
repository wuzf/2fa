import { describe, expect, it, vi } from 'vitest';

import { handleExportSecrets, MAX_EXPORT_REQUEST_BYTES } from '../../src/api/secrets/export.js';
import { createBackupEntry } from '../../src/utils/backup-format.js';

class MockKV {
	constructor() {
		this.store = new Map();
	}

	async get(key, type = 'text') {
		const value = this.store.get(key);
		if (value === undefined) {
			return null;
		}

		if (type === 'json') {
			return JSON.parse(value);
		}

		return value;
	}

	async put(key, value) {
		this.store.set(key, value);
	}

	async delete(key) {
		this.store.delete(key);
	}
}

function createMockEnv(overrides = {}) {
	return {
		LOG_LEVEL: 'ERROR',
		SECRETS_KV: new MockKV(),
		...overrides,
	};
}

function createMockRequest(body = {}, method = 'POST', url = 'https://example.com/api/secrets/export', options = {}) {
	const rawBody = options.rawBody ?? JSON.stringify(body);
	const headers = new Headers({
		'Content-Type': 'application/json',
		'CF-Connecting-IP': options.clientIP || '203.0.113.1',
		...(options.headers || {}),
	});

	if (!headers.has('Content-Length')) {
		headers.set('Content-Length', String(new TextEncoder().encode(rawBody).length));
	}

	return {
		method,
		url,
		headers,
		text: async () => rawBody,
		json: async () => JSON.parse(rawBody),
	};
}

function createMockStreamRequest(body = {}, method = 'POST', url = 'https://example.com/api/secrets/export', options = {}) {
	const rawBody = options.rawBody ?? JSON.stringify(body);
	const bytes = new TextEncoder().encode(rawBody);
	const chunkSize = options.chunkSize || 64 * 1024;
	const chunks = [];

	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		chunks.push(bytes.slice(offset, offset + chunkSize));
	}

	const headers = new Headers({
		'Content-Type': 'application/json',
		'CF-Connecting-IP': options.clientIP || '203.0.113.1',
		...(options.headers || {}),
	});
	headers.delete('Content-Length');

	const state = {
		cancelled: false,
		index: 0,
	};

	return {
		method,
		url,
		headers,
		body: {
			getReader() {
				return {
					async read() {
						if (state.index >= chunks.length) {
							return { done: true, value: undefined };
						}

						const value = chunks[state.index];
						state.index += 1;
						return { done: false, value };
					},
					async cancel() {
						state.cancelled = true;
					},
				};
			},
		},
		text: async () => {
			throw new Error('text() should not be called for stream-backed requests');
		},
		json: async () => JSON.parse(rawBody),
		_streamState: state,
	};
}

function createSecrets() {
	return [
		{
			id: '1',
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
		},
		{
			id: '2',
			name: 'Acme',
			account: 'ops@example.com',
			secret: 'MFRGGZDFMZTWQ2LK',
			type: 'HOTP',
			digits: 8,
			period: 30,
			algorithm: 'SHA256',
			counter: 12,
		},
	];
}

function createManySecrets(count) {
	return Array.from({ length: count }, (_, index) => ({
		id: String(index + 1),
		name: `Service ${index + 1}`,
		account: `user${index + 1}@example.com`,
		secret: index % 2 === 0 ? 'JBSWY3DPEHPK3PXP' : 'MFRGGZDFMZTWQ2LK',
		type: 'TOTP',
		digits: 6,
		period: 30,
		algorithm: 'SHA1',
		counter: 0,
	}));
}

describe('handleExportSecrets', () => {
	it('exports unified TXT content while keeping the export filename', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'txt',
				secrets: createSecrets(),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/plain');
		expect(response.headers.get('Content-Disposition')).toMatch(/filename="2FA-secrets-otpauth-\d{4}-\d{2}-\d{2}\.txt"/);

		const content = await response.text();
		expect(content).toContain(
			'otpauth://totp/GitHub:user%40example.com?secret=JBSWY3DPEHPK3PXP&digits=6&period=30&algorithm=SHA1&issuer=GitHub',
		);
		expect(content).toContain(
			'otpauth://hotp/Acme:ops%40example.com?secret=MFRGGZDFMZTWQ2LK&digits=8&counter=12&algorithm=SHA256&issuer=Acme',
		);
	});

	it('exports unified JSON content and filename', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'json',
				secrets: createSecrets(),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('application/json');
		expect(response.headers.get('Content-Disposition')).toMatch(/filename="2FA-secrets-data-\d{4}-\d{2}-\d{2}\.json"/);

		const content = JSON.parse(await response.text());
		expect(content.version).toBe('1.0');
		expect(content.format).toBe('json');
		expect(content.timestamp).toBeTruthy();
		expect(content.reason).toBe('export');
		expect(content.skippedInvalidCount).toBe(0);
		expect(content.count).toBe(2);
		expect(content.secrets[0]).toEqual({
			id: '1',
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
		});
		expect(content.secrets[1]).toEqual({
			id: '2',
			name: 'Acme',
			account: 'ops@example.com',
			secret: 'MFRGGZDFMZTWQ2LK',
			type: 'HOTP',
			digits: 8,
			period: 30,
			algorithm: 'SHA256',
			counter: 12,
		});
	});

	it('exports unified CSV content', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'csv',
				secrets: createSecrets(),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/csv');
		expect(response.headers.get('Content-Disposition')).toMatch(/filename="2FA-secrets-table-\d{4}-\d{2}-\d{2}\.csv"/);

		const content = await response.text();
		const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/);
		expect(rows[0].split(',')).toHaveLength(8);
		expect(rows[1]).toContain('GitHub');
		expect(rows[1].split(',')).toHaveLength(8);
		expect(rows[2]).toContain('Acme');
		expect(rows[2]).toContain(',12');
	});

	it('exports unified HTML content and filename', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'html',
				secrets: createSecrets(),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/html');
		expect(response.headers.get('Content-Disposition')).toMatch(/filename="2FA-secrets-backup-\d{4}-\d{2}-\d{2}\.html"/);

		const content = await response.text();
		expect(content).toContain('<!DOCTYPE html>');
		expect(content).toContain('data-skipped-invalid-count="0"');
		expect(content).toContain('__2fa_backup_data__');
		expect(content).toContain('GitHub');
	});

	it('allows standard exports above the previous 1000-secret limit', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'json',
				secrets: createManySecrets(1001),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('application/json');

		const content = JSON.parse(await response.text());
		expect(content.count).toBe(1001);
		expect(content.secrets).toHaveLength(1001);
		expect(content.secrets[1000]).toMatchObject({
			id: '1001',
			name: 'Service 1001',
			account: 'user1001@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
		});
	});

	it('falls back to table-only HTML for oversized unified exports instead of failing', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'html',
				secrets: createManySecrets(1001),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/html');

		const content = await response.text();
		expect(content).toContain('<!DOCTYPE html>');
		expect(content).toContain('__2fa_backup_data__');
		expect(content).toContain('Service 1');
		expect(content).toContain('Service 1001');
		expect(content).not.toContain('<img src="data:image/');
	});

	it('matches backup serialization for every standard export format', async () => {
		const formats = ['txt', 'json', 'csv', 'html'];
		const timestamp = new Date('2026-04-17T08:22:29.000Z');

		vi.useFakeTimers();
		vi.setSystemTime(timestamp);

		try {
			for (const format of formats) {
				const secrets = createSecrets();
				const response = await handleExportSecrets(
					createMockRequest({
						format,
						secrets,
					}),
					createMockEnv(),
				);

				expect(response.status).toBe(200);
				const content = await response.text();
				const backupEntry = await createBackupEntry(secrets, {}, {
					format,
					reason: 'export',
					strict: true,
					timestamp: timestamp.toISOString(),
				});

				const expectedContent =
					format === 'csv' ? String(backupEntry.backupContent).replace(/^\uFEFF/, '') : backupEntry.backupContent;
				expect(content).toBe(expectedContent);
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it('rate-limits repeated export requests', async () => {
		const env = createMockEnv();
		const requestBody = {
			format: 'txt',
			secrets: createSecrets(),
		};

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const response = await handleExportSecrets(createMockRequest(requestBody), env);
			expect(response.status).toBe(200);
		}

		const response = await handleExportSecrets(createMockRequest(requestBody), env);
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBeTruthy();
	});

	it('rejects oversized export payloads before serialization', async () => {
		const oversizedBody = {
			format: 'json',
			secrets: createSecrets(),
			metadata: {
				note: 'x'.repeat(MAX_EXPORT_REQUEST_BYTES),
			},
		};

		const response = await handleExportSecrets(createMockRequest(oversizedBody), createMockEnv());

		expect(response.status).toBe(413);
		const payload = await response.json();
		expect(payload.error).toBe('导出请求过大');
	});

	it('rejects oversized streamed export payloads and cancels the reader', async () => {
		const oversizedBody = {
			format: 'json',
			secrets: createSecrets(),
			metadata: {
				note: 'x'.repeat(MAX_EXPORT_REQUEST_BYTES),
			},
		};
		const request = createMockStreamRequest(oversizedBody);

		const response = await handleExportSecrets(request, createMockEnv());

		expect(response.status).toBe(413);
		expect(request._streamState.cancelled).toBe(true);
		const payload = await response.json();
		expect(payload.error).toBe('导出请求过大');
	});

	it('rejects unsupported format, removed legacy profile, and empty exports', async () => {
		const env = createMockEnv();

		const invalidFormatResponse = await handleExportSecrets(
			createMockRequest({
				format: 'xml',
				secrets: createSecrets(),
			}),
			env,
		);
		expect(invalidFormatResponse.status).toBe(400);

		const invalidProfileResponse = await handleExportSecrets(
			createMockRequest({
				format: 'txt',
				profile: 'legacy-bulk',
				secrets: createSecrets(),
			}),
			env,
		);
		expect(invalidProfileResponse.status).toBe(400);

		const emptyResponse = await handleExportSecrets(
			createMockRequest({
				format: 'txt',
				secrets: [],
			}),
			env,
		);
		expect(emptyResponse.status).toBe(400);
	});

	it('accepts legacy profile as an alias for unified exports', async () => {
		const response = await handleExportSecrets(
			createMockRequest({
				format: 'txt',
				profile: 'bulk-export-legacy',
				secrets: createSecrets(),
			}),
			createMockEnv(),
		);

		expect(response.status).toBe(200);
		const content = await response.text();
		expect(content).toContain('otpauth://totp/GitHub:user%40example.com');
	});
});
