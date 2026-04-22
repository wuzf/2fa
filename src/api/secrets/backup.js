/**
 * Backup creation and listing handlers.
 */

import { getAllSecrets } from './shared.js';
import { getLogger } from '../../utils/logger.js';
import { checkRateLimit, getClientIdentifier, createRateLimitResponse, RATE_LIMIT_PRESETS } from '../../utils/rateLimit.js';
import { createJsonResponse, createErrorResponse } from '../../utils/response.js';
import { ValidationError, StorageError, CryptoError, BusinessLogicError, errorToResponse, logError } from '../../utils/errors.js';
import { resolveConfiguredBackupFormat } from '../../utils/backup.js';
import { pushToWebDAV } from '../../utils/webdav.js';
import { pushToS3 } from '../../utils/s3.js';
import { pushToOneDrive } from '../../utils/onedrive.js';
import { pushToGoogleDrive } from '../../utils/gdrive.js';
import { saveDataHash } from '../../utils/data-hash.js';
import {
	ensureBackupIndexes,
	getBackupIndexState,
	getBackupKeyFromIndexKey,
	listAllBackupIndexEntries,
	listAllBackupKeys,
	listBackupIndexPage,
	putBackupRecord,
} from '../../utils/backup-index.js';
import {
	createBackupEntry,
	decodeBackupEntry,
	getBackupFormatFromKey,
	getPortableSkippedInvalidCount,
	isValidBackupKey,
	parseBackupTimeFromKey,
} from '../../utils/backup-format.js';

const INDEX_CURSOR_PREFIX = 'idx:';

/**
 * Handle manual backup creation.
 */
export async function handleBackupSecrets(request, env, ctx) {
	const logger = getLogger(env);

	try {
		const clientIP = getClientIdentifier(request, 'ip');
		const rateLimitInfo = await checkRateLimit(clientIP, env, RATE_LIMIT_PRESETS.sensitive);

		if (!rateLimitInfo.allowed) {
			logger.warn('备份操作速率限制超出', {
				clientIP,
				limit: rateLimitInfo.limit,
				resetAt: rateLimitInfo.resetAt,
			});
			return createRateLimitResponse(rateLimitInfo);
		}

		logger.info('开始执行手动备份任务', {
			clientIP,
			timestamp: new Date().toISOString(),
		});

		const secrets = await getAllSecrets(env);

		if (secrets && secrets.length > 0) {
			const backupFormat = await resolveConfiguredBackupFormat(env, logger);
			const backupEntry = await createBackupEntry(secrets, env, {
				format: backupFormat,
				reason: 'manual',
				strict: true,
			});
			const {
				backupKey,
				backupContent,
				encrypted: isEncrypted,
				format: storedFormat,
				timestamp,
				count: storedCount,
				metadata,
			} = backupEntry;

			if (isEncrypted) {
				logger.info('备份数据已加密', {
					backupKey,
					encrypted: true,
					format: storedFormat,
				});
			} else {
				logger.warn('备份数据以明文保存', {
					backupKey,
					reason: '未配置 ENCRYPTION_KEY',
					format: storedFormat,
				});
			}

			await putBackupRecord(env, backupKey, backupContent, metadata);

			const webdavPromise = pushToWebDAV(backupKey, backupContent, env).catch((err) => {
				logger.warn('WebDAV 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(webdavPromise);
			}

			const s3Promise = pushToS3(backupKey, backupContent, env).catch((err) => {
				logger.warn('S3 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(s3Promise);
			}

			const oneDrivePromise = pushToOneDrive(backupKey, backupContent, env).catch((err) => {
				logger.warn('OneDrive 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(oneDrivePromise);
			}

			const googleDrivePromise = pushToGoogleDrive(backupKey, backupContent, env).catch((err) => {
				logger.warn('Google Drive 推送异常（不影响备份）', {}, err);
			});
			if (ctx) {
				ctx.waitUntil(googleDrivePromise);
			}

			logger.info('手动备份完成', {
				backupKey,
				secretCount: storedCount,
				encrypted: isEncrypted,
				format: storedFormat,
			});

			await saveDataHash(env, secrets, {
				reason: 'manual',
				skippedInvalidCount: backupEntry.skippedInvalidCount,
			});

			return createJsonResponse({
				success: true,
				message: `备份完成，共备份 ${storedCount} 个密钥`,
				backupKey,
				count: storedCount,
				timestamp,
				encrypted: isEncrypted,
				format: storedFormat,
			});
		}

		throw new BusinessLogicError('没有密钥需要备份', {
			operation: 'backup',
			secretsCount: 0,
		});
	} catch (error) {
		if (error.message?.startsWith('备份包含无效密钥')) {
			return createErrorResponse('备份数据无效', error.message, 400, request);
		}

		if (error instanceof BusinessLogicError || error instanceof StorageError || error instanceof CryptoError) {
			logError(error, logger, { operation: 'handleBackupSecrets' });
			return errorToResponse(error);
		}

		logger.error(
			'手动备份任务执行失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('备份失败', `备份过程中发生错误：${error.message}`, 500);
	}
}

function parseBackupListOffset(cursor) {
	if (!cursor) {
		return 0;
	}

	const offset = Number.parseInt(cursor, 10);
	return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function getBackupListStartIndex(entries, cursor) {
	if (!cursor) {
		return 0;
	}

	if (/^\d+$/.test(cursor)) {
		return parseBackupListOffset(cursor);
	}

	if (!isValidBackupKey(cursor)) {
		return 0;
	}

	const exactIndex = entries.findIndex((entry) => entry.name === cursor);
	if (exactIndex !== -1) {
		return exactIndex + 1;
	}

	const insertionIndex = entries.findIndex((entry) => entry.name.localeCompare(cursor) < 0);
	return insertionIndex === -1 ? entries.length : insertionIndex;
}

function parseIndexedCursor(cursor) {
	if (typeof cursor !== 'string' || !cursor.startsWith(INDEX_CURSOR_PREFIX)) {
		return null;
	}

	const rawCursor = cursor.slice(INDEX_CURSOR_PREFIX.length);
	if (!rawCursor) {
		return null;
	}

	const separatorIndex = rawCursor.indexOf('|');
	if (separatorIndex === -1) {
		return {
			rawCursor: decodeIndexedCursorValue(rawCursor),
			anchorBackupKey: null,
			offset: /^\d+$/.test(rawCursor) ? parseBackupListOffset(rawCursor) : null,
		};
	}

	const indexCursorPart = rawCursor.slice(0, separatorIndex);
	const anchorBackupKey = rawCursor.slice(separatorIndex + 1);
	const offsetMatch = indexCursorPart.match(/^(\d+):(.*)$/);
	const rawCursorValue = offsetMatch ? offsetMatch[2] : indexCursorPart;

	return {
		rawCursor: decodeIndexedCursorValue(rawCursorValue),
		anchorBackupKey: isValidBackupKey(anchorBackupKey) ? anchorBackupKey : null,
		offset: offsetMatch ? parseBackupListOffset(offsetMatch[1]) : null,
	};
}

function decodeIndexedCursorValue(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function buildIndexedCursor(cursor, anchorBackupKey, offset = null) {
	if (!cursor) {
		return null;
	}

	if (/^\d+$/.test(cursor) || !isValidBackupKey(anchorBackupKey)) {
		return `${INDEX_CURSOR_PREFIX}${cursor}`;
	}

	const encodedCursor = encodeURIComponent(cursor);
	if (Number.isInteger(offset) && offset >= 0) {
		return `${INDEX_CURSOR_PREFIX}${offset}:${encodedCursor}|${anchorBackupKey}`;
	}

	return `${INDEX_CURSOR_PREFIX}${encodedCursor}|${anchorBackupKey}`;
}

function getIndexedCursorOffset(cursor, parsedIndexedCursor = null) {
	if (!cursor) {
		return 0;
	}

	if (Number.isInteger(parsedIndexedCursor?.offset)) {
		return parsedIndexedCursor.offset;
	}

	if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) {
		return null;
	}

	return parseBackupListOffset(cursor);
}

function resolveKeyListingCursor(cursor, parsedIndexedCursor) {
	if (parsedIndexedCursor?.anchorBackupKey) {
		return parsedIndexedCursor.anchorBackupKey;
	}

	if (typeof parsedIndexedCursor?.rawCursor === 'string' && /^\d+$/.test(parsedIndexedCursor.rawCursor)) {
		return parsedIndexedCursor.rawCursor;
	}

	if (cursor && !String(cursor).startsWith(INDEX_CURSOR_PREFIX)) {
		return cursor;
	}

	return undefined;
}

function isOpaqueLegacyBackupCursor(cursor) {
	return (
		typeof cursor === 'string' &&
		cursor.length > 0 &&
		!cursor.startsWith(INDEX_CURSOR_PREFIX) &&
		!/^\d+$/.test(cursor) &&
		!isValidBackupKey(cursor)
	);
}

function mapBackupEntriesToIndexEntries(entries) {
	return entries.map((entry) => ({
		...entry,
		metadata: {
			backupKey: entry.name,
			...(entry.metadata || {}),
		},
	}));
}

function listBackupEntriesFromLoadedKeys(allBackupEntries, options = {}) {
	const loadAll = options.loadAll === true;
	const limit = options.limit || 50;
	const cursor = options.cursor;
	const startIndex = loadAll ? 0 : getBackupListStartIndex(allBackupEntries, cursor);
	const endIndex = loadAll ? allBackupEntries.length : startIndex + limit;
	const pageEntries = allBackupEntries.slice(startIndex, endIndex);

	return {
		backupIndexEntries: mapBackupEntriesToIndexEntries(pageEntries),
		hasMore: !loadAll && endIndex < allBackupEntries.length,
		nextCursor: loadAll ? null : endIndex < allBackupEntries.length ? pageEntries[pageEntries.length - 1]?.name || null : null,
	};
}

async function listBackupEntriesFromKeys(env, options = {}) {
	const allBackupEntries = (await listAllBackupKeys(env)).sort((a, b) => b.name.localeCompare(a.name));
	return listBackupEntriesFromLoadedKeys(allBackupEntries, options);
}

async function listBackupEntriesFromLegacyKvCursor(env, options = {}) {
	const listResult = await env.SECRETS_KV.list({
		prefix: 'backup_',
		limit: options.limit || 50,
		...(options.cursor ? { cursor: options.cursor } : {}),
	});
	const validEntries = listResult.keys.filter((entry) => isValidBackupKey(entry.name)).reverse();
	const nextCursor =
		!listResult.list_complete && validEntries.length > 0
			? validEntries[validEntries.length - 1].name
			: !listResult.list_complete
				? listResult.cursor || null
				: null;

	return {
		backupIndexEntries: mapBackupEntriesToIndexEntries(validEntries),
		hasMore: !listResult.list_complete,
		nextCursor,
	};
}

async function findMissingIndexedBackupKeys(env, indexEntries = [], options = {}) {
	const maxChecks =
		Number.isInteger(options.maxChecks) && options.maxChecks > 0 ? Math.min(indexEntries.length, options.maxChecks) : indexEntries.length;
	const entriesToCheck = indexEntries.slice(0, maxChecks);
	const existenceChecks = await Promise.all(
		entriesToCheck.map(async (indexEntry) => {
			const backupKey = indexEntry.metadata?.backupKey || getBackupKeyFromIndexKey(indexEntry.name);
			if (!isValidBackupKey(backupKey)) {
				return backupKey || indexEntry.name;
			}

			const backupContent = await env.SECRETS_KV.get(backupKey, 'text');
			return backupContent ? null : backupKey;
		}),
	);

	return existenceChecks.filter(Boolean);
}

/**
 * Handle backup listing.
 */
export async function handleGetBackups(request, env, ctx) {
	const logger = getLogger(env);

	try {
		const url = new URL(request.url);
		const limitParam = url.searchParams.get('limit') || '50';
		const cursor = url.searchParams.get('cursor') || undefined;
		const includeDetails = url.searchParams.get('details') !== 'false';

		let limit;
		let loadAll = false;

		if (limitParam.toLowerCase() === 'all' || limitParam === '0') {
			loadAll = true;
			limit = 1000;
		} else {
			const parsedLimit = Number.parseInt(limitParam, 10);
			limit = Number.isInteger(parsedLimit) ? Math.min(parsedLimit, 1000) : 50;
		}

		logger.debug('获取备份列表', { limit, loadAll, cursor, includeDetails });

		const indexState = await getBackupIndexState(env);
		const parsedIndexedCursor = parseIndexedCursor(cursor);
		const indexCursor = parsedIndexedCursor?.rawCursor || null;
		const keyListingCursor = resolveKeyListingCursor(cursor, parsedIndexedCursor);
		const useOpaqueLegacyCursor = !loadAll && isOpaqueLegacyBackupCursor(cursor);
		const stateCount = Number.isInteger(indexState?.count) ? indexState.count : null;
		const canFallbackToKeyListing = loadAll || !cursor || keyListingCursor !== undefined;
		const useLegacyOffsetCursor = !loadAll && cursor && /^\d+$/.test(cursor);
		const useBackupAnchorCursor = !loadAll && cursor && isValidBackupKey(cursor);
		const useIndexedListing = indexState?.version === 2 && !useLegacyOffsetCursor && !useBackupAnchorCursor && !useOpaqueLegacyCursor;
		let backupIndexEntries;
		let hasMore;
		let nextCursor;
		let usedKeyListing = false;

		const scheduleIndexRebuild = () => {
			if (ctx?.waitUntil) {
				ctx.waitUntil(
					ensureBackupIndexes(env, { force: true }).catch((error) => {
						logger.warn('备份索引缺失，后台重建失败', { errorMessage: error.message }, error);
					}),
				);
			}
		};

		if (useOpaqueLegacyCursor) {
			const legacyListing = await listBackupEntriesFromLegacyKvCursor(env, { limit, cursor });
			backupIndexEntries = legacyListing.backupIndexEntries;
			hasMore = legacyListing.hasMore;
			nextCursor = legacyListing.nextCursor;
			usedKeyListing = true;
		} else if (useIndexedListing) {
			if (loadAll) {
				backupIndexEntries = await listAllBackupIndexEntries(env);
				hasMore = false;
				nextCursor = null;
				const missingIndexedBackupKeys = backupIndexEntries.length > 0 ? await findMissingIndexedBackupKeys(env, backupIndexEntries) : [];

				if ((stateCount !== null && backupIndexEntries.length !== stateCount) || missingIndexedBackupKeys.length > 0) {
					const keyListing = listBackupEntriesFromLoadedKeys(
						(await listAllBackupKeys(env)).sort((a, b) => b.name.localeCompare(a.name)),
						{ limit, loadAll, cursor: keyListingCursor },
					);
					backupIndexEntries = keyListing.backupIndexEntries;
					hasMore = keyListing.hasMore;
					nextCursor = keyListing.nextCursor;
					usedKeyListing = true;

					logger.warn('备份索引不完整，已回退到真实备份键列表', {
						expectedCount: stateCount,
						actualIndexCount: backupIndexEntries.length,
						missingIndexedBackupKeys: missingIndexedBackupKeys.slice(0, 3),
					});
					scheduleIndexRebuild();
				}
			} else {
				const pageResult = await listBackupIndexPage(env, {
					limit,
					...(indexCursor ? { cursor: indexCursor } : {}),
				});
				backupIndexEntries = pageResult.keys;
				hasMore = !pageResult.list_complete;
				const currentOffset = getIndexedCursorOffset(indexCursor, parsedIndexedCursor);
				nextCursor =
					hasMore && pageResult.cursor
						? buildIndexedCursor(
								pageResult.cursor,
								backupIndexEntries[backupIndexEntries.length - 1]?.metadata?.backupKey ||
									getBackupKeyFromIndexKey(backupIndexEntries[backupIndexEntries.length - 1]?.name),
								currentOffset === null ? null : currentOffset + backupIndexEntries.length,
							)
						: null;

				const remainingCountFromState = stateCount === null || currentOffset === null ? null : Math.max(stateCount - currentOffset, 0);
				const expectedPageSize = remainingCountFromState === null ? null : Math.min(limit, remainingCountFromState);
				const indexLooksIncomplete =
					(expectedPageSize !== null && backupIndexEntries.length < expectedPageSize) ||
					(expectedPageSize === null && backupIndexEntries.length === 0 && stateCount !== 0);
				const indexLooksOverflowed = remainingCountFromState !== null && backupIndexEntries.length > remainingCountFromState;
				const missingIndexedBackupKeys = backupIndexEntries.length > 0 ? await findMissingIndexedBackupKeys(env, backupIndexEntries) : [];
				const indexContainsMissingBackups = missingIndexedBackupKeys.length > 0;
				const indexPageDisagreesWithState = indexLooksIncomplete || indexLooksOverflowed || indexContainsMissingBackups;

				if (indexPageDisagreesWithState && canFallbackToKeyListing) {
					const keyListing = await listBackupEntriesFromKeys(env, { limit, loadAll, cursor: keyListingCursor });
					backupIndexEntries = keyListing.backupIndexEntries;
					hasMore = keyListing.hasMore;
					nextCursor = keyListing.nextCursor;
					usedKeyListing = true;

					logger.warn('备份索引不完整，已回退到真实备份键列表', {
						expectedPageSize,
						remainingCountFromState,
						actualPageSize: pageResult.keys.length,
						offset: currentOffset,
						missingIndexedBackupKeys: missingIndexedBackupKeys.slice(0, 3),
					});
					scheduleIndexRebuild();
				} else if (indexPageDisagreesWithState) {
					logger.warn('备份索引不完整，但当前游标缺少可回退锚点，保留索引分页结果并安排重建', {
						offset: currentOffset,
						remainingCountFromState,
						actualPageSize: pageResult.keys.length,
						missingIndexedBackupKeys: missingIndexedBackupKeys.slice(0, 3),
					});
					scheduleIndexRebuild();
				}
			}
		} else {
			const keyListing = await listBackupEntriesFromKeys(env, { limit, loadAll, cursor: keyListingCursor ?? cursor });
			backupIndexEntries = keyListing.backupIndexEntries;
			hasMore = keyListing.hasMore;
			nextCursor = keyListing.nextCursor;
			usedKeyListing = true;

			if (ctx?.waitUntil && indexState?.version !== 2 && !useBackupAnchorCursor) {
				ctx.waitUntil(
					ensureBackupIndexes(env).catch((error) => {
						logger.warn('备份索引后台回填失败', { errorMessage: error.message }, error);
					}),
				);
			}
		}

		let backupDetails;

		if (includeDetails) {
			backupDetails = await Promise.all(
				backupIndexEntries.map(async (indexEntry) => {
					try {
						const backupKey = indexEntry.metadata?.backupKey || getBackupKeyFromIndexKey(indexEntry.name);
						const backupMetadata = { ...(indexEntry.metadata || {}) };
						delete backupMetadata.backupKey;

						const hasStoredSkippedInvalidCount = Object.prototype.hasOwnProperty.call(backupMetadata, 'skippedInvalidCount');
						const metadataCount = Number.isInteger(backupMetadata.count) ? backupMetadata.count : null;
						const metadataEncrypted = typeof backupMetadata.encrypted === 'boolean' ? backupMetadata.encrypted : null;
						let count = metadataCount ?? -1;
						let encrypted = metadataEncrypted ?? false;
						let format = typeof backupMetadata.format === 'string' ? backupMetadata.format : getBackupFormatFromKey(backupKey);
						let skippedInvalidCount = hasStoredSkippedInvalidCount ? Number.parseInt(backupMetadata.skippedInvalidCount, 10) || 0 : 0;
						let size =
							typeof backupMetadata.size === 'number' ? backupMetadata.size : typeof indexEntry.size === 'number' ? indexEntry.size : null;
						const shouldDecodeBackupContent = metadataCount === null || !hasStoredSkippedInvalidCount;

						let backupContent = null;
						if (metadataCount === null || metadataEncrypted === null || !hasStoredSkippedInvalidCount) {
							backupContent = await env.SECRETS_KV.get(backupKey, 'text');
							encrypted = metadataEncrypted ?? Boolean(backupContent && backupContent.startsWith('v1:'));
							size = backupContent?.length || size || 0;
						}

						if (backupContent && !hasStoredSkippedInvalidCount && !encrypted) {
							skippedInvalidCount = getPortableSkippedInvalidCount(backupContent, format);
						}

						if (backupContent && shouldDecodeBackupContent) {
							try {
								const decoded = await decodeBackupEntry(backupContent, env, {
									backupKey,
									metadata: backupMetadata,
									encrypted,
									strict: false,
								});
								count = metadataCount ?? decoded.count;
								encrypted = decoded.encrypted;
								format = decoded.format || format;
								skippedInvalidCount = Number.isInteger(decoded.skippedInvalidCount) ? decoded.skippedInvalidCount : skippedInvalidCount;
							} catch (error) {
								logger.error(
									'读取备份详情失败',
									{
										backupKey,
										errorMessage: error.message,
									},
									error,
								);
								if (metadataCount === null) {
									count = -1;
								}
							}
						}

						return {
							key: backupKey,
							created: backupMetadata.created || parseBackupTimeFromKey(backupKey),
							count,
							encrypted,
							format,
							partial: skippedInvalidCount > 0,
							skippedInvalidCount,
							size,
							metadata: backupMetadata,
						};
					} catch (error) {
						logger.error(
							'获取备份详情失败',
							{
								backupKey: indexEntry.metadata?.backupKey || getBackupKeyFromIndexKey(indexEntry.name),
								errorMessage: error.message,
							},
							error,
						);

						const backupKey = indexEntry.metadata?.backupKey || getBackupKeyFromIndexKey(indexEntry.name);
						const backupMetadata = { ...(indexEntry.metadata || {}) };
						delete backupMetadata.backupKey;

						return {
							key: backupKey,
							created: backupMetadata.created || 'unknown',
							count: -1,
							encrypted: false,
							partial: false,
							skippedInvalidCount: 0,
							size: 0,
							metadata: backupMetadata,
						};
					}
				}),
			);
		} else {
			backupDetails = backupIndexEntries.map((indexEntry) => {
				const backupKey = indexEntry.metadata?.backupKey || getBackupKeyFromIndexKey(indexEntry.name);
				const backupMetadata = { ...(indexEntry.metadata || {}) };
				delete backupMetadata.backupKey;

				return {
					key: backupKey,
					created: backupMetadata.created || parseBackupTimeFromKey(backupKey),
					metadata: backupMetadata,
				};
			});
		}

		const response = {
			success: true,
			backups: backupDetails,
			count: backupDetails.length,
			pagination: {
				limit: loadAll ? backupDetails.length : limit,
				hasMore: loadAll ? false : hasMore,
				cursor: loadAll ? null : nextCursor,
				loadedAll: loadAll,
			},
		};

		logger.info('备份列表获取成功', {
			count: backupDetails.length,
			includeDetails,
			loadAll,
			hasMore: loadAll ? false : hasMore,
			listingSource: useOpaqueLegacyCursor ? 'legacy-cursor' : usedKeyListing ? 'keys' : useIndexedListing ? 'index' : 'keys',
		});

		return createJsonResponse(response, 200, request);
	} catch (error) {
		if (error instanceof StorageError || error instanceof CryptoError || error instanceof ValidationError) {
			logError(error, logger, { operation: 'handleGetBackups' });
			return errorToResponse(error, request);
		}

		logger.error(
			'获取备份列表失败',
			{
				errorMessage: error.message,
			},
			error,
		);
		return createErrorResponse('获取备份列表失败', `获取备份列表时发生错误：${error.message}`, 500, request);
	}
}
