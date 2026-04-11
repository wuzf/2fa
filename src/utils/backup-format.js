/**
 * Backup format codec helpers.
 */

import QRCode from 'qrcode/lib/core/qrcode.js';
import SvgRenderer from 'qrcode/lib/renderer/svg-tag.js';

import { decryptData, encryptData } from './encryption.js';
import { DEFAULT_EXPORT_FORMAT } from './settings.js';
import { validateBase32 } from './validation.js';

export const BACKUP_FILE_FORMATS = ['txt', 'json', 'csv', 'html'];
export const DOWNLOAD_CONTENT_PROFILES = ['backup'];
const BACKUP_KEY_EXTENSION_PATTERN = 'txt|json|csv|html';
const BACKUP_CSV_HEADERS = ['服务名称', '账户信息', '密钥', '类型', '位数', '周期(秒)', '算法', '计数器'];
const BACKUP_KEY_REGEX = new RegExp(`^backup_\\d{4}-\\d{2}-\\d{2}(?:_[\\w-]+)?\\.(${BACKUP_KEY_EXTENSION_PATTERN})$`);
const BACKUP_TIME_REGEX = new RegExp(
	`backup_(\\d{4}-\\d{2}-\\d{2})_(\\d{2}-\\d{2}-\\d{2})(?:-(\\d{3}))?(?:-UTC)?(?:-[a-z0-9]{2,6})?\\.(${BACKUP_KEY_EXTENSION_PATTERN})$`,
);
const LEGACY_BACKUP_TIME_REGEX = /^backup_(\d{4}-\d{2}-\d{2})\.json$/;
const HTML_BACKUP_JSON_ID = '__2fa_backup_data__';
const HTML_BACKUP_META_NAME = '2fa-backup-meta';
export const MAX_HTML_QR_EXPORT_SECRETS = 250;
const HTML_QR_BATCH_SIZE = 20;
const BACKUP_METADATA_PREFIX = '# 2FA-BACKUP-META';
const HTML_PARTIAL_WARNING_REGEX = /2FA-BACKUP-PARTIAL\s+skippedInvalidCount=(\d+)/i;
const DEFAULT_DOWNLOAD_CONTENT_PROFILE = 'backup';

function sanitizeSkippedInvalidCount(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sanitizeBackupSecretValue(value) {
	return String(value || '')
		.replace(/[\s\-+]/g, '')
		.toUpperCase();
}

function isValidBackupSecretValue(value) {
	const cleanSecret = sanitizeBackupSecretValue(value);
	return Boolean(cleanSecret) && validateBase32(cleanSecret).valid === true;
}

export function sanitizeBackupFormat(value) {
	return resolveBackupFormat(value);
}

export function sanitizeDownloadContentProfile(value) {
	const profile = String(value || '')
		.trim()
		.toLowerCase();
	if (!profile) {
		return DEFAULT_DOWNLOAD_CONTENT_PROFILE;
	}

	return DOWNLOAD_CONTENT_PROFILES.includes(profile) ? profile : '';
}

export function isValidBackupKey(backupKey) {
	return BACKUP_KEY_REGEX.test(backupKey);
}

export function getBackupFormatFromKey(backupKey) {
	const match = backupKey.match(new RegExp(`\\.(${BACKUP_KEY_EXTENSION_PATTERN})$`));
	return resolveBackupFormat(match ? match[1] : DEFAULT_EXPORT_FORMAT);
}

export function generateBackupKey(format = DEFAULT_EXPORT_FORMAT, options = {}) {
	const now = options.now instanceof Date ? options.now : new Date();
	const includeUtcMarker = options.includeUtcMarker === true;
	const dateStr = now.toISOString().split('T')[0];
	const timeStr = now.toISOString().split('T')[1].replace(/:/g, '-').replace('.', '-').replace('Z', '');
	const rand = Math.random().toString(36).slice(2, 6);
	const extension = sanitizeBackupFormat(format);

	return `backup_${dateStr}_${timeStr}${includeUtcMarker ? '-UTC' : ''}-${rand}.${extension}`;
}

export function parseBackupTimeFromKey(backupKey) {
	try {
		const match = backupKey.match(BACKUP_TIME_REGEX);
		if (match) {
			const dateStr = match[1];
			const timeStr = match[2];
			const ms = match[3] || '000';
			return `${dateStr}T${timeStr.replace(/-/g, ':')}.${ms}Z`;
		}

		const legacyMatch = backupKey.match(LEGACY_BACKUP_TIME_REGEX);
		if (legacyMatch) {
			return `${legacyMatch[1]}T00:00:00.000Z`;
		}
	} catch {
		// ignore
	}

	return 'unknown';
}

export function getBackupContentType(formatOrKey, options = {}) {
	const encrypted = options.encrypted === true;
	if (encrypted) {
		return 'application/octet-stream';
	}

	const format = formatOrKey?.includes?.('backup_') ? getBackupFormatFromKey(formatOrKey) : sanitizeBackupFormat(formatOrKey);
	switch (format) {
		case 'txt':
			return 'text/plain;charset=utf-8';
		case 'csv':
			return 'text/csv;charset=utf-8';
		case 'html':
			return 'text/html;charset=utf-8';
		case 'json':
		default:
			return 'application/json;charset=utf-8';
	}
}

export function getPortableSkippedInvalidCount(content, formatOrKey) {
	const format = formatOrKey?.includes?.('backup_') ? getBackupFormatFromKey(formatOrKey) : sanitizeBackupFormat(formatOrKey);
	switch (format) {
		case 'txt':
		case 'csv':
			return extractInlineBackupMetadata(content).skippedInvalidCount;
		case 'html':
			return extractHtmlBackupMetadata(content).skippedInvalidCount;
		case 'json':
		default:
			return extractJsonBackupMetadata(content).skippedInvalidCount;
	}
}

export function normalizeBackupSecrets(secrets = [], _timestamp = new Date().toISOString(), options = {}) {
	const strict = options.strict === true;
	const onInvalid = typeof options.onInvalid === 'function' ? options.onInvalid : null;
	const invalidSecrets = [];
	const normalizedSecrets = secrets
		.map((secret, index) => {
			const normalizedName = String(secret?.name || secret?.issuer || secret?.issuerExt || 'Unknown').trim() || 'Unknown';
			const cleanSecret = sanitizeBackupSecretValue(secret?.secret);

			if (!cleanSecret || !isValidBackupSecretValue(cleanSecret)) {
				const invalidSecret = {
					index,
					name: normalizedName,
				};
				invalidSecrets.push(invalidSecret);
				onInvalid?.(invalidSecret);
				return null;
			}

			return {
				id: typeof secret.id === 'string' && secret.id ? secret.id : crypto.randomUUID(),
				name: normalizedName,
				account: String(secret.account || secret.label || '').trim(),
				secret: cleanSecret,
				type: String(secret.type || secret.tokenType || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP',
				digits: parseInteger(secret.digits, 6),
				period: parseInteger(secret.period ?? secret.timeStep, 30),
				algorithm: String(secret.algorithm || secret.algo || 'SHA1').toUpperCase(),
				counter: parseInteger(secret.counter, 0),
			};
		})
		.filter(Boolean);

	if (strict && invalidSecrets.length > 0) {
		throw new Error(buildInvalidBackupSecretsError(invalidSecrets));
	}

	return normalizedSecrets;
}

export async function encodeBackupContent(secrets, options = {}) {
	const format = sanitizeBackupFormat(options.format);
	const timestamp = options.timestamp || new Date().toISOString();
	const reason = options.reason || 'manual';
	const invalidSecrets = [];
	const includeQRCodes = format === 'html' ? options.includeQRCodes !== false : options.includeQRCodes === true;
	const normalizedSecrets = normalizeBackupSecrets(secrets, timestamp, {
		strict: options.strict === true,
		onInvalid: (item) => invalidSecrets.push(item),
	});
	if (normalizedSecrets.length === 0 && Array.isArray(secrets) && secrets.length > 0 && invalidSecrets.length > 0) {
		throw new Error(buildInvalidBackupSecretsError(invalidSecrets));
	}
	const skippedInvalidCount = invalidSecrets.length;
	const payload = {
		version: '1.0',
		format,
		timestamp,
		reason,
		count: normalizedSecrets.length,
		skippedInvalidCount,
		secrets: normalizedSecrets,
	};

	if (options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata)) {
		payload.metadata = options.metadata;
	}

	switch (format) {
		case 'txt':
			return {
				format,
				timestamp,
				count: normalizedSecrets.length,
				content: embedInlineBackupMetadata(buildOTPAuthText(normalizedSecrets), skippedInvalidCount),
				skippedInvalidCount,
				invalidSecrets,
			};
		case 'csv':
			return {
				format,
				timestamp,
				count: normalizedSecrets.length,
				content: embedInlineBackupMetadata(buildCSVContent(normalizedSecrets), skippedInvalidCount),
				skippedInvalidCount,
				invalidSecrets,
			};
		case 'html':
			return {
				format,
				timestamp,
				count: normalizedSecrets.length,
				content: await buildHTMLContent(payload, {
					includeQRCodes,
				}),
				skippedInvalidCount,
				invalidSecrets,
			};
		case 'json':
		default:
			return {
				format: 'json',
				timestamp,
				count: normalizedSecrets.length,
				content: JSON.stringify(payload, null, 2),
				skippedInvalidCount,
				invalidSecrets,
			};
	}
}

export async function createBackupEntry(secrets, env, options = {}) {
	const format = sanitizeBackupFormat(options.format);
	const timestamp = options.timestamp || new Date().toISOString();
	const reason = options.reason || 'manual';
	const encoded = await encodeBackupContent(secrets, {
		format,
		timestamp,
		reason,
		strict: options.strict === true,
		includeQRCodes: options.includeQRCodes,
	});
	const backupKey =
		options.backupKey || generateBackupKey(format, { includeUtcMarker: options.includeUtcMarker, now: new Date(timestamp) });

	let backupContent = encoded.content;
	let encrypted = false;

	if (env?.ENCRYPTION_KEY) {
		backupContent = await encryptData(
			{
				type: 'formatted-backup',
				format,
				timestamp,
				reason,
				count: encoded.count,
				skippedInvalidCount: encoded.skippedInvalidCount,
				content: encoded.content,
			},
			env,
		);
		encrypted = true;
	}

	const metadata = {
		created: timestamp,
		format,
		count: encoded.count,
		encrypted,
		skippedInvalidCount: encoded.skippedInvalidCount,
		size: typeof backupContent === 'string' ? backupContent.length : 0,
		version: 2,
	};

	return {
		backupKey,
		backupContent,
		format,
		timestamp,
		count: encoded.count,
		encrypted,
		skippedInvalidCount: encoded.skippedInvalidCount,
		invalidSecrets: encoded.invalidSecrets,
		metadata,
	};
}

export async function decodeBackupEntry(backupContent, env, options = {}) {
	const metadata = options.metadata || {};
	const backupKey = options.backupKey || '';
	const encrypted = typeof options.encrypted === 'boolean' ? options.encrypted : String(backupContent || '').startsWith('v1:');
	const strict = options.strict === true;

	if (!backupContent) {
		throw new Error('备份内容为空');
	}

	if (encrypted) {
		if (!env?.ENCRYPTION_KEY) {
			throw new Error('备份文件已加密，但未配置 ENCRYPTION_KEY');
		}

		let decrypted;
		try {
			decrypted = await decryptData(backupContent, env);
		} catch (error) {
			throw new Error(`解密失败：${error.message}`);
		}

		if (decrypted?.type === 'formatted-backup' && typeof decrypted.content === 'string') {
			const storedSkippedInvalidCount = sanitizeSkippedInvalidCount(metadata.skippedInvalidCount ?? decrypted.skippedInvalidCount);
			const decoded = decodeBackupContent(
				decrypted.content,
				resolveBackupFormat(decrypted.format, metadata.format, getBackupFormatFromKey(backupKey)),
				{
					timestamp: decrypted.timestamp,
					reason: decrypted.reason,
					strict,
				},
			);
			return finalizeDecodedBackup(
				{
					...decoded,
					encrypted: true,
				},
				{ storedSkippedInvalidCount },
			);
		}

		if (Array.isArray(decrypted?.secrets)) {
			const timestamp = decrypted.timestamp || metadata.created || parseBackupTimeFromKey(backupKey);
			const invalidSecrets = [];
			let secrets;
			try {
				secrets = normalizeBackupSecrets(decrypted.secrets, timestamp, {
					strict,
					onInvalid: (item) => invalidSecrets.push(item),
				});
			} catch (error) {
				throw new Error(`解析失败：${error.message}`);
			}

			return finalizeDecodedBackup(
				{
					format: resolveBackupFormat(decrypted.format, metadata.format, getBackupFormatFromKey(backupKey)),
					timestamp,
					reason: decrypted.reason || 'legacy',
					count: secrets.length,
					secrets,
					encrypted: true,
					content: JSON.stringify(decrypted, null, 2),
					skippedInvalidCount: invalidSecrets.length,
				},
				{ storedSkippedInvalidCount: sanitizeSkippedInvalidCount(metadata.skippedInvalidCount) },
			);
		}

		throw new Error('解析失败：无法识别的加密备份格式');
	}

	const format = resolveBackupFormat(metadata.format, getBackupFormatFromKey(backupKey));
	const decoded = decodeBackupContent(backupContent, format, {
		timestamp: metadata.created || parseBackupTimeFromKey(backupKey),
		strict,
	});
	return finalizeDecodedBackup(
		{
			...decoded,
			encrypted: false,
		},
		{ storedSkippedInvalidCount: sanitizeSkippedInvalidCount(metadata.skippedInvalidCount) },
	);
}

export function decodeBackupContent(content, format, options = {}) {
	const normalizedFormat = sanitizeBackupFormat(format);
	switch (normalizedFormat) {
		case 'txt':
			return decodeTextBackupContent(content, options);
		case 'csv':
			return decodeCsvBackupContent(content, options);
		case 'html':
			return decodeHtmlBackupContent(content, options);
		case 'json':
		default:
			return decodeJsonBackupContent(content, options);
	}
}

export async function buildDownloadContent(secrets, format, options = {}) {
	const encoded = await encodeBackupContent(secrets, options);
	return {
		content: encoded.content,
		contentType: getBackupContentType(format),
		extension: encoded.format,
		filename: getDownloadFilename(encoded.format, {
			timestamp: options.timestamp || encoded.timestamp,
			reason: options.reason,
			filenamePrefix: options.filenamePrefix,
		}),
	};
}

export function getDownloadFilename(format, options = {}) {
	const normalizedFormat = sanitizeBackupFormat(format);
	const dateStr = getDownloadDateString(options.timestamp);

	if (options.reason === 'export') {
		const prefix = String(options.filenamePrefix || '2FA-secrets').trim() || '2FA-secrets';
		switch (normalizedFormat) {
			case 'txt':
				return `${prefix}-otpauth-${dateStr}.txt`;
			case 'json':
				return `${prefix}-data-${dateStr}.json`;
			case 'csv':
				return `${prefix}-table-${dateStr}.csv`;
			case 'html':
				return `${prefix}-backup-${dateStr}.html`;
			default:
				return `${prefix}-${dateStr}.${normalizedFormat}`;
		}
	}

	const prefix = String(options.filenamePrefix || '2FA-backup').trim() || '2FA-backup';
	return `${prefix}-${dateStr}.${normalizedFormat}`;
}

function decodeJsonBackupContent(content, options = {}) {
	let jsonData;
	try {
		jsonData = JSON.parse(content);
	} catch (error) {
		throw new Error(`解析失败：${error.message}`);
	}
	if (!Array.isArray(jsonData?.secrets)) {
		throw new Error('解析失败：备份 JSON 数据格式不正确');
	}

	const timestamp = jsonData.timestamp || jsonData.exportDate || options.timestamp || new Date().toISOString();
	const invalidSecrets = [];
	let secrets;
	try {
		secrets = normalizeBackupSecrets(jsonData.secrets, timestamp, {
			strict: options.strict === true,
			onInvalid: (item) => invalidSecrets.push(item),
		});
	} catch (error) {
		throw new Error(`解析失败：${error.message}`);
	}

	return {
		format: 'json',
		timestamp,
		reason: jsonData.reason || options.reason || 'legacy',
		count: secrets.length,
		secrets,
		content,
		skippedInvalidCount: sanitizeSkippedInvalidCount(jsonData.skippedInvalidCount) + invalidSecrets.length,
	};
}

function decodeTextBackupContent(content, options = {}) {
	const extracted = extractInlineBackupMetadata(content);
	const lines = String(extracted.content)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const timestamp = options.timestamp || new Date().toISOString();
	const invalidLines = [];
	const secrets = lines
		.map((line, index) => {
			const parsed = parseOTPAuthUrl(line);
			if (!parsed) {
				invalidLines.push(index + 1);
				return null;
			}
			return parsed;
		})
		.filter(Boolean);

	if (options.strict === true && invalidLines.length > 0) {
		throw new Error(`解析失败：${buildInvalidBackupRowsError('TXT', invalidLines, '不是有效的 OTPAuth URL')}`);
	}

	return {
		format: 'txt',
		timestamp,
		reason: options.reason || 'manual',
		count: secrets.length,
		secrets,
		content,
		skippedInvalidCount: extracted.skippedInvalidCount + invalidLines.length,
	};
}

function decodeCsvBackupContent(content, options = {}) {
	const extracted = extractInlineBackupMetadata(content);
	const text = String(extracted.content).replace(/^\uFEFF/, '');
	const rows = parseCSVRows(text);
	if (rows.length < 2) {
		return {
			format: 'csv',
			timestamp: options.timestamp || new Date().toISOString(),
			reason: options.reason || 'manual',
			count: 0,
			secrets: [],
			content,
			skippedInvalidCount: extracted.skippedInvalidCount,
		};
	}

	const headers = rows[0].map((header) =>
		String(header)
			.replace(/^\uFEFF/, '')
			.trim(),
	);
	const serviceIndex = findHeaderIndex(headers, ['服务名称', 'service', 'name']);
	const accountIndex = findHeaderIndex(headers, ['账户信息', '账户', 'account']);
	const secretIndex = findHeaderIndex(headers, ['密钥', 'secret']);
	const typeIndex = findHeaderIndex(headers, ['类型', 'type']);
	const digitsIndex = findHeaderIndex(headers, ['位数', 'digits']);
	const periodIndex = findHeaderIndex(headers, ['周期(秒)', '周期', 'period']);
	const algorithmIndex = findHeaderIndex(headers, ['算法', 'algorithm']);
	const counterIndex = findHeaderIndex(headers, ['计数器', 'counter']);

	if (secretIndex === -1) {
		throw new Error('解析失败：备份 CSV 数据格式不正确');
	}

	const timestamp = options.timestamp || new Date().toISOString();
	const secrets = [];
	const invalidRows = [];

	for (let i = 1; i < rows.length; i += 1) {
		const fields = rows[i];
		const cleanSecret = sanitizeBackupSecretValue(fields[secretIndex]);
		if (!cleanSecret || !isValidBackupSecretValue(cleanSecret)) {
			invalidRows.push(i + 1);
			continue;
		}

		secrets.push({
			id: crypto.randomUUID(),
			name: String(fields[serviceIndex] || 'Unknown').trim() || 'Unknown',
			account: String(fields[accountIndex] || '').trim(),
			secret: cleanSecret,
			type: String(fields[typeIndex] || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP',
			digits: parseInteger(fields[digitsIndex], 6),
			period: parseInteger(fields[periodIndex], 30),
			algorithm:
				String(fields[algorithmIndex] || 'SHA1')
					.trim()
					.toUpperCase() || 'SHA1',
			counter: parseInteger(fields[counterIndex], 0),
		});
	}

	if (options.strict === true && invalidRows.length > 0) {
		throw new Error(`解析失败：${buildInvalidBackupRowsError('CSV', invalidRows, '缺少有效密钥')}`);
	}

	return {
		format: 'csv',
		timestamp,
		reason: options.reason || 'manual',
		count: secrets.length,
		secrets,
		content,
		skippedInvalidCount: extracted.skippedInvalidCount + invalidRows.length,
	};
}

function decodeHtmlBackupContent(content, options = {}) {
	const parseErrors = [];
	const htmlMetadata = extractHtmlBackupMetadata(content);
	const fallbackOptions = options.strict === true ? { ...options, strict: false } : options;
	const embeddedJson = extractEmbeddedJsonFromHtml(content);
	if (embeddedJson) {
		try {
			const decoded = decodeJsonBackupContent(embeddedJson, options);
			return {
				...decoded,
				format: 'html',
				content,
				skippedInvalidCount: Math.max(htmlMetadata.skippedInvalidCount, sanitizeSkippedInvalidCount(decoded.skippedInvalidCount)),
			};
		} catch (error) {
			parseErrors.push(error);
		}
	}

	const embeddedOtpauthUrls = extractOTPAuthUrlsFromHtml(content);
	if (embeddedOtpauthUrls.length > 0) {
		try {
			const decoded = decodeTextBackupContent(embeddedOtpauthUrls.join('\n'), fallbackOptions);
			return {
				...decoded,
				format: 'html',
				content,
				skippedInvalidCount: htmlMetadata.skippedInvalidCount + sanitizeSkippedInvalidCount(decoded.skippedInvalidCount),
			};
		} catch (error) {
			parseErrors.push(error);
		}
	}

	try {
		return decodeHtmlTableBackupContent(content, {
			...fallbackOptions,
			htmlMetadataSkippedInvalidCount: htmlMetadata.skippedInvalidCount,
		});
	} catch (error) {
		parseErrors.push(error);
	}

	throw parseErrors[0] || new Error('解析失败：HTML 备份中未找到可恢复的数据块');
}

function decodeHtmlTableBackupContent(content, options = {}) {
	const timestamp = options.timestamp || new Date().toISOString();
	const htmlMetadataSkippedInvalidCount = sanitizeSkippedInvalidCount(options.htmlMetadataSkippedInvalidCount);
	const secrets = [];
	const invalidRows = [];
	const rows = extractHtmlTableRows(content);

	rows.forEach((row, index) => {
		const cells = row.cells;
		if (cells.length < 3) {
			invalidRows.push(row.rowNumber || index + 1);
			return;
		}

		const cleanSecret = sanitizeBackupSecretValue(cells[2]);
		if (!cleanSecret || !isValidBackupSecretValue(cleanSecret)) {
			invalidRows.push(row.rowNumber || index + 1);
			return;
		}

		const hasCounterColumn = cells.length >= 9;
		const account = normalizeLegacyHtmlAccount(cells[1]);
		secrets.push({
			id: crypto.randomUUID(),
			name: String(cells[0] || 'Unknown').trim() || 'Unknown',
			account,
			secret: cleanSecret,
			type: String(cells[3] || 'TOTP').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP',
			digits: parseInteger(cells[4], 6),
			period: parseInteger(cells[5], 30),
			algorithm:
				String(cells[6] || 'SHA1')
					.trim()
					.toUpperCase() || 'SHA1',
			counter: hasCounterColumn ? parseInteger(cells[7], 0) : 0,
		});
	});

	if (options.strict === true && invalidRows.length > 0) {
		throw new Error(`解析失败：${buildInvalidBackupRowsError('HTML', invalidRows, '缺少有效密钥')}`);
	}

	if (secrets.length === 0) {
		throw new Error('解析失败：HTML 备份中未找到可恢复的数据块');
	}

	return {
		format: 'html',
		timestamp,
		reason: options.reason || 'legacy',
		count: secrets.length,
		secrets,
		content,
		skippedInvalidCount: htmlMetadataSkippedInvalidCount + invalidRows.length,
	};
}

function buildOTPAuthText(secrets) {
	return secrets.map((secret) => buildOTPAuthUrl(secret)).join('\n');
}

function buildCSVContent(secrets) {
	const rows = [BACKUP_CSV_HEADERS.join(',')];

	secrets.forEach((secret) => {
		rows.push(
			[
				escapeCSV(secret.name),
				escapeCSV(secret.account || ''),
				escapeCSV(secret.secret),
				escapeCSV(secret.type || 'TOTP'),
				secret.digits || 6,
				secret.period || 30,
				escapeCSV(secret.algorithm || 'SHA1'),
				secret.counter || 0,
			].join(','),
		);
	});

	return `\uFEFF${rows.join('\n')}`;
}

function embedInlineBackupMetadata(content, skippedInvalidCount) {
	const sanitizedCount = sanitizeSkippedInvalidCount(skippedInvalidCount);
	if (sanitizedCount === 0) {
		return content;
	}

	const metadataLine = `${BACKUP_METADATA_PREFIX} skippedInvalidCount=${sanitizedCount}`;
	const textContent = String(content);

	if (textContent.startsWith('\uFEFF')) {
		return `\uFEFF${metadataLine}\n${textContent.slice(1)}`;
	}

	return `${metadataLine}\n${textContent}`;
}

function extractInlineBackupMetadata(content) {
	const rawContent = String(content);
	const hasBom = rawContent.startsWith('\uFEFF');
	const textContent = hasBom ? rawContent.slice(1) : rawContent;
	const lines = textContent.split(/\r?\n/);
	const firstLine = String(lines[0] || '').trim();

	if (!firstLine.startsWith(BACKUP_METADATA_PREFIX)) {
		return {
			content: rawContent,
			skippedInvalidCount: 0,
		};
	}

	const match = firstLine.match(/skippedInvalidCount=(\d+)/i);
	const sanitizedCount = sanitizeSkippedInvalidCount(match ? match[1] : 0);
	const body = lines.slice(1).join('\n');

	return {
		content: hasBom ? `\uFEFF${body}` : body,
		skippedInvalidCount: sanitizedCount,
	};
}

function extractHtmlBackupMetadata(content) {
	const rawContent = String(content);
	const dataAttributeMatch = rawContent.match(/data-skipped-invalid-count=["'](\d+)["']/i);
	if (dataAttributeMatch) {
		return {
			skippedInvalidCount: sanitizeSkippedInvalidCount(dataAttributeMatch[1]),
		};
	}

	const metaMatch = rawContent.match(
		new RegExp(`<meta[^>]*name=["']${HTML_BACKUP_META_NAME}["'][^>]*content=["'][^"']*skippedInvalidCount=(\\d+)`, 'i'),
	);

	return {
		skippedInvalidCount: sanitizeSkippedInvalidCount(metaMatch ? metaMatch[1] : rawContent.match(HTML_PARTIAL_WARNING_REGEX)?.[1] || 0),
	};
}

function extractJsonBackupMetadata(content) {
	const match = String(content).match(/"skippedInvalidCount"\s*:\s*(\d+)/i);
	return {
		skippedInvalidCount: sanitizeSkippedInvalidCount(match ? match[1] : 0),
	};
}

async function buildHTMLContent(payload, options = {}) {
	const includeQRCodes = options.includeQRCodes !== false;
	const shouldEmbedQRCodes = includeQRCodes && payload.secrets.length <= MAX_HTML_QR_EXPORT_SECRETS;
	const qrGenerationSkipped = includeQRCodes && !shouldEmbedQRCodes;
	const skippedInvalidCount = sanitizeSkippedInvalidCount(payload.skippedInvalidCount);
	const secretRows = shouldEmbedQRCodes
		? await buildHtmlQrRows(payload.secrets)
		: payload.secrets.map((secret) => {
				const qrPlaceholder = qrGenerationSkipped ? '数量过多，未嵌入' : '未嵌入';
				return `<tr>
  <td>${escapeHtml(secret.name)}</td>
  <td>${escapeHtml(secret.account || '')}</td>
  <td><code>${escapeHtml(secret.secret)}</code></td>
  <td>${escapeHtml(secret.type || 'TOTP')}</td>
  <td>${secret.digits || 6}</td>
  <td>${secret.period || 30}</td>
  <td>${escapeHtml(secret.algorithm || 'SHA1')}</td>
  <td>${secret.counter || 0}</td>
  <td class="qr-cell qr-cell-placeholder">${qrPlaceholder}</td>
</tr>`;
			});
	const rows = secretRows.join('\n');
	const embeddedJson = escapeHtml(JSON.stringify(payload, null, 2));
	const partialWarning =
		skippedInvalidCount > 0
			? `Warning: 2FA-BACKUP-PARTIAL skippedInvalidCount=${skippedInvalidCount}. This backup only preserves ${payload.count} recoverable entries.`
			: '';
	const formatLabel = shouldEmbedQRCodes ? 'HTML（含二维码）' : 'HTML（未嵌入二维码）';
	const qrDescription = shouldEmbedQRCodes
		? '每行二维码可直接扫码导入到支持 OTPAuth 的验证器。'
		: qrGenerationSkipped
			? `当前备份共有 ${payload.count} 条密钥，超过 ${MAX_HTML_QR_EXPORT_SECRETS} 条二维码内嵌上限，已保留完整可恢复数据和密钥表格，但未嵌入二维码。`
			: '当前文件未嵌入二维码，但已保留完整可恢复数据和密钥表格。';

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="2FA Backup">
  <meta name="${HTML_BACKUP_META_NAME}" content="skippedInvalidCount=${skippedInvalidCount}">
  <title>2FA Backup</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2937; background: #f8fafc; }
    h1 { margin-bottom: 8px; }
    p { margin: 6px 0; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; background: #ffffff; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #e2e8f0; }
    code { word-break: break-all; }
    .qr-cell { text-align: center; }
    .qr-cell img { width: 96px; height: 96px; display: block; margin: 0 auto; }
    .qr-cell-placeholder { color: #64748b; font-size: 12px; }
    .partial-warning { margin-top: 12px; padding: 12px 14px; border-radius: 10px; border: 1px solid #f59e0b; background: #fff7ed; color: #9a3412; }
  </style>
</head>
<body data-skipped-invalid-count="${skippedInvalidCount}">
  <h1>2FA 备份</h1>
  <p>创建时间: ${escapeHtml(payload.timestamp)}</p>
  <p>备份数量: ${payload.count}</p>
  <p>格式: ${formatLabel}</p>
  <p>${escapeHtml(qrDescription)}</p>
  ${partialWarning ? `<p class="partial-warning">${escapeHtml(partialWarning)}</p>` : ''}
  <table data-skipped-invalid-count="${skippedInvalidCount}">
    <thead>
      <tr>
        <th>服务名称</th>
        <th>账户信息</th>
        <th>密钥</th>
        <th>类型</th>
        <th>位数</th>
        <th>周期(秒)</th>
        <th>算法</th>
        <th>计数器</th>
        <th>二维码</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <script id="${HTML_BACKUP_JSON_ID}" type="application/json">${embeddedJson}</script>
</body>
</html>`;
}

async function buildHtmlQrRows(secrets) {
	if (secrets.length > MAX_HTML_QR_EXPORT_SECRETS) {
		throw new Error(`HTML 导出最多支持 ${MAX_HTML_QR_EXPORT_SECRETS} 条密钥生成二维码，请改用 txt/json/csv 导出，或减少备份内容后再试`);
	}

	const rows = [];
	for (let i = 0; i < secrets.length; i += HTML_QR_BATCH_SIZE) {
		const batch = secrets.slice(i, i + HTML_QR_BATCH_SIZE);
		const batchRows = await Promise.all(
			batch.map(async (secret) => {
				const qrCode = QRCode.create(buildOTPAuthUrl(secret), {
					errorCorrectionLevel: 'M',
				});
				const qrDataUrl = buildSvgDataUrl(
					SvgRenderer.render(qrCode, {
						margin: 1,
						width: 160,
					}),
				);

				return `<tr>
  <td>${escapeHtml(secret.name)}</td>
  <td>${escapeHtml(secret.account || '')}</td>
  <td><code>${escapeHtml(secret.secret)}</code></td>
  <td>${escapeHtml(secret.type || 'TOTP')}</td>
  <td>${secret.digits || 6}</td>
  <td>${secret.period || 30}</td>
  <td>${escapeHtml(secret.algorithm || 'SHA1')}</td>
  <td>${secret.counter || 0}</td>
  <td class="qr-cell"><img src="${qrDataUrl}" alt="QR for ${escapeHtml(secret.name)}"></td>
</tr>`;
			}),
		);
		rows.push(...batchRows);
	}

	return rows;
}

function buildSvgDataUrl(svgMarkup) {
	return `data:image/svg+xml;base64,${toBase64(svgMarkup)}`;
}

function toBase64(value) {
	const text = String(value);

	if (typeof globalThis.Buffer !== 'undefined') {
		return globalThis.Buffer.from(text, 'utf8').toString('base64');
	}

	if (typeof btoa === 'function') {
		const bytes = new TextEncoder().encode(text);
		let binary = '';
		const chunkSize = 0x8000;

		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
		}

		return btoa(binary);
	}

	throw new Error('无法生成二维码数据 URL：缺少 Base64 编码能力');
}

function buildOTPAuthUrl(secret) {
	const serviceName = String(secret.name || 'Unknown').trim() || 'Unknown';
	const accountName = String(secret.account || '').trim();
	const label = accountName ? `${encodeURIComponent(serviceName)}:${encodeURIComponent(accountName)}` : encodeURIComponent(serviceName);
	const params = new URLSearchParams();

	params.set(
		'secret',
		String(secret.secret || '')
			.replace(/[\s\-+]/g, '')
			.toUpperCase(),
	);
	params.set('digits', String(secret.digits || 6));

	if (String(secret.type || 'TOTP').toUpperCase() === 'HOTP') {
		params.set('counter', String(secret.counter || 0));
		params.set('algorithm', String(secret.algorithm || 'SHA1').toUpperCase());
		if (serviceName) {
			params.set('issuer', serviceName);
		}
		return `otpauth://hotp/${label}?${params.toString()}`;
	}

	params.set('period', String(secret.period || 30));
	params.set('algorithm', String(secret.algorithm || 'SHA1').toUpperCase());
	if (serviceName) {
		params.set('issuer', serviceName);
	}
	return `otpauth://totp/${label}?${params.toString()}`;
}

function parseOTPAuthUrl(uri) {
	const normalized = String(uri || '')
		.trim()
		.replace(/&amp;/g, '&');
	if (!normalized.startsWith('otpauth://')) {
		return null;
	}

	const url = new URL(normalized);
	const type = String(url.hostname || 'totp').toUpperCase() === 'HOTP' ? 'HOTP' : 'TOTP';
	const rawLabel = url.pathname.replace(/^\//, '');
	const separatorIndex = rawLabel.indexOf(':');
	const issuerParam = url.searchParams.get('issuer') || '';
	const label = safeDecodeURIComponent(rawLabel);
	const issuerFromLabel = separatorIndex >= 0 ? safeDecodeURIComponent(rawLabel.slice(0, separatorIndex)) : '';
	const accountFromLabel = separatorIndex >= 0 ? safeDecodeURIComponent(rawLabel.slice(separatorIndex + 1)) : '';
	const inferredIssuer = issuerParam || issuerFromLabel || '';
	const account = accountFromLabel || (inferredIssuer ? (label && label !== inferredIssuer ? label : '') : label);
	const issuer = issuerParam || issuerFromLabel || label || 'Unknown';
	const cleanSecret = sanitizeBackupSecretValue(url.searchParams.get('secret'));

	if (!cleanSecret || !isValidBackupSecretValue(cleanSecret)) {
		return null;
	}

	return {
		id: crypto.randomUUID(),
		name: issuer || 'Unknown',
		account: account || '',
		secret: cleanSecret,
		type,
		digits: parseInteger(url.searchParams.get('digits'), 6),
		period: parseInteger(url.searchParams.get('period'), 30),
		algorithm: String(url.searchParams.get('algorithm') || 'SHA1').toUpperCase(),
		counter: parseInteger(url.searchParams.get('counter'), 0),
	};
}

function parseCSVRows(content) {
	const rows = [];
	let row = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				current += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (char === ',' && !inQuotes) {
			row.push(current);
			current = '';
			continue;
		}

		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && nextChar === '\n') {
				i += 1;
			}

			row.push(current);
			pushCSVRow(rows, row);
			row = [];
			current = '';
			continue;
		}

		current += char;
	}

	row.push(current);
	pushCSVRow(rows, row);
	return rows;
}

function findHeaderIndex(headers, candidates) {
	const normalizedCandidates = candidates.map((item) => item.toLowerCase());
	return headers.findIndex((header) => normalizedCandidates.includes(String(header || '').toLowerCase()));
}

function pushCSVRow(rows, row) {
	if (row.length === 1 && row[0] === '') {
		return;
	}

	if (!row.some((field) => String(field || '').trim())) {
		return;
	}

	rows.push(row);
}

function escapeCSV(value) {
	if (value === null || value === undefined) {
		return '""';
	}

	const text = String(value);
	if (text.includes(',') || text.includes('"') || text.includes('\n')) {
		return `"${text.replace(/"/g, '""')}"`;
	}

	return `"${text}"`;
}

function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
	return String(value)
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

function extractEmbeddedJsonFromHtml(content) {
	const scriptMatch = String(content).match(
		new RegExp(`<script[^>]*id=["']${HTML_BACKUP_JSON_ID}["'][^>]*type=["']application/json["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i'),
	);

	return scriptMatch ? decodeHtmlEntities(scriptMatch[1].trim()) : '';
}

function extractOTPAuthUrlsFromHtml(content) {
	const matches = String(content).match(/otpauth:\/\/(?:totp|hotp)\/[^"'<>\s]+/gi) || [];
	return matches.map((item) => decodeHtmlEntities(item));
}

function extractHtmlTableRows(content) {
	const rows = [];
	const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	let match;
	let rowNumber = 0;

	while ((match = rowRegex.exec(String(content))) !== null) {
		rowNumber += 1;
		const cellMatches = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
		if (cellMatches.length === 0) {
			continue;
		}

		rows.push({
			rowNumber,
			cells: cellMatches.map((cellMatch) => normalizeHtmlTableCell(cellMatch[1])),
		});
	}

	return rows;
}

function normalizeHtmlTableCell(value) {
	return decodeHtmlEntities(String(value || ''))
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\u00A0/g, ' ')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\r?\n\s*/g, '\n')
		.trim();
}

function normalizeLegacyHtmlAccount(value) {
	const normalized = String(value || '').trim();
	return normalized === '-' ? '' : normalized;
}

function safeDecodeURIComponent(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return String(value || '');
	}
}

function parseInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function getDownloadDateString(timestamp) {
	const parsedDate = timestamp ? new Date(timestamp) : new Date();
	const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
	return safeDate.toISOString().split('T')[0];
}

function resolveBackupFormat(...values) {
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}

		const normalized = value.trim().toLowerCase();
		if (BACKUP_FILE_FORMATS.includes(normalized)) {
			return normalized;
		}
	}

	return DEFAULT_EXPORT_FORMAT;
}

function finalizeDecodedBackup(decoded, options = {}) {
	const storedSkippedInvalidCount = sanitizeSkippedInvalidCount(options.storedSkippedInvalidCount);
	const decodedSkippedInvalidCount = sanitizeSkippedInvalidCount(decoded.skippedInvalidCount);
	const skippedInvalidCount = Math.max(storedSkippedInvalidCount, decodedSkippedInvalidCount);

	return {
		...decoded,
		skippedInvalidCount,
		partial: decoded.partial === true || skippedInvalidCount > 0,
	};
}

function buildInvalidBackupRowsError(formatLabel, invalidRows, reason) {
	const preview = invalidRows
		.slice(0, 3)
		.map((rowNumber) => `第 ${rowNumber} 行${reason}`)
		.join('；');
	const remainingCount = invalidRows.length - Math.min(invalidRows.length, 3);

	return `备份 ${formatLabel} 数据包含无效条目：${preview}${remainingCount > 0 ? `；另有 ${remainingCount} 行` : ''}`;
}

function buildInvalidBackupSecretsError(invalidSecrets) {
	const preview = invalidSecrets
		.slice(0, 3)
		.map((item) => `第 ${item.index + 1} 条${item.name ? `（${item.name}）` : ''}缺少有效密钥`)
		.join('；');
	const remainingCount = invalidSecrets.length - Math.min(invalidSecrets.length, 3);

	return `备份包含无效密钥，已阻止生成：${preview}${remainingCount > 0 ? `；另有 ${remainingCount} 条` : ''}`;
}
