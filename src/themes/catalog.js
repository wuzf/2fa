/**
 * A catalog repository owns every ZIP it lists; author URLs are attribution only.
 * The official catalog is always available. The owner may add other public
 * GitHub repositories with the same layout; each is read only from its own
 * main branch and raw files.
 */
import { APP_LIMITS } from './appSchema.js';
import { ThemeError, hashBytes, isRecord } from './schema.js';
import { ImportBudget, decodeText } from './resources.js';

export const OFFICIAL_CATALOG = 'wuzf/2fa-theme-mytheme';
export const THEME_CATALOG_REPOSITORY = `https://github.com/${OFFICIAL_CATALOG}`;
export const MAX_CUSTOM_CATALOGS = 5;
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const cached = new Map();

/** Returns the canonical owner/name form, or null for anything else. */
export function normalizeCatalogRepository(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const text = value
		.trim()
		.replace(/^https:\/\/github\.com\//i, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '');
	const name = text.split('/')[1];
	if (!REPOSITORY_PATTERN.test(text) || name === '.' || name === '..') {
		return null;
	}
	return text;
}

function sameRepository(left, right) {
	return left.toLowerCase() === right.toLowerCase();
}

export function isOfficialCatalog(repository) {
	return sameRepository(repository, OFFICIAL_CATALOG);
}

/** True for a package downloaded from the official catalog; uploads and owner catalogs are not. */
export function isOfficialCatalogSource(url) {
	return typeof url === 'string' && url.toLowerCase().startsWith(rawRoot(OFFICIAL_CATALOG).toLowerCase());
}

function refUrl(repository) {
	return `https://api.github.com/repos/${repository}/git/ref/heads/main`;
}

function rawRoot(repository) {
	return `https://raw.githubusercontent.com/${repository}/`;
}

function assert(condition, code = 'THEME_CATALOG_INVALID', status = 502) {
	if (!condition) {
		throw new ThemeError(code, {}, status);
	}
}

function label(value, limit, required = false) {
	return (
		typeof value === 'string' &&
		value.length <= limit &&
		(!required || value.trim().length > 0) &&
		Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
	);
}

function parse(bytes) {
	try {
		return JSON.parse(decodeText(bytes));
	} catch {
		throw new ThemeError('THEME_CATALOG_INVALID', {}, 502);
	}
}

export function validateThemeCatalog(input) {
	assert(isRecord(input) && input.schemaVersion === 1 && Array.isArray(input.themes) && input.themes.length <= 500);
	assert(Object.keys(input).every((key) => ['schemaVersion', 'themes'].includes(key)));
	const ids = new Set();
	return input.themes.map((entry) => {
		assert(isRecord(entry));
		assert(
			Object.keys(entry).every((key) =>
				['id', 'kind', 'name', 'version', 'description', 'author', 'packageId', 'path', 'sha256', 'size', 'source'].includes(key),
			),
		);
		assert(typeof entry.id === 'string' && ID.test(entry.id) && !entry.id.startsWith('builtin-') && !FORBIDDEN_IDS.has(entry.id));
		assert(!ids.has(entry.id.toLowerCase()));
		ids.add(entry.id.toLowerCase());
		assert(['app', 'v1'].includes(entry.kind));
		assert(label(entry.name, 128, true) && label(entry.description, 2048) && label(entry.author, 128));
		assert(typeof entry.version === 'string' && entry.version.length <= 128 && VERSION.test(entry.version));
		assert(typeof entry.packageId === 'string' && HEX.test(entry.packageId) && typeof entry.sha256 === 'string' && HEX.test(entry.sha256));
		assert(entry.path === `themes/${entry.id}/2fa-theme.zip`);
		assert(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= APP_LIMITS.upload);
		if (entry.source !== undefined) {
			assert(typeof entry.source === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(entry.source));
		}
		return Object.freeze({ ...entry });
	});
}

function budgetFor(fetcher, repository) {
	const ref = refUrl(repository);
	const root = rawRoot(repository);
	return new ImportBudget({
		fetcher(url, options) {
			// Redirects are checked too. Neither a catalog entry nor a redirect can
			// make the importer fetch outside this catalog repository.
			assert(
				url === ref ||
					(url.startsWith(root) &&
						/^[a-f0-9]{40}\/(?:catalog\.json|themes\/[A-Za-z0-9_-]{1,64}\/2fa-theme\.zip)$/.test(url.slice(root.length))),
			);
			return fetcher(url, { ...options, credentials: 'omit', cf: { cacheTtl: 60, cacheEverything: true } });
		},
	});
}

function catalogRepository(value = OFFICIAL_CATALOG) {
	const repository = normalizeCatalogRepository(value);
	assert(repository, 'THEME_CATALOG_SOURCE_INVALID', 400);
	return repository;
}

async function fetchCatalog(fetcher, repository) {
	const budget = budgetFor(fetcher, repository);
	const ref = parse((await budget.download(refUrl(repository), { maxBytes: 64 * 1024, resource: false })).bytes);
	assert(isRecord(ref) && isRecord(ref.object) && ref.object.type === 'commit' && /^[a-f0-9]{40}$/.test(ref.object.sha));
	const revision = ref.object.sha;
	const input = parse(
		(await budget.download(`${rawRoot(repository)}${revision}/catalog.json`, { maxBytes: 1024 * 1024, resource: false })).bytes,
	);
	return Object.freeze({
		repository: `https://github.com/${repository}`,
		revision,
		themes: Object.freeze(validateThemeCatalog(input)),
	});
}

export async function readThemeCatalog({ fetcher = fetch, cache = true, repository } = {}) {
	repository = catalogRepository(repository);
	const key = repository.toLowerCase();
	const current = cached.get(key);
	if (cache && current?.fetcher === fetcher && current.expiresAt > Date.now()) {
		return current.promise;
	}
	const promise = fetchCatalog(fetcher, repository);
	const entry = { fetcher, expiresAt: Date.now() + 60000, promise };
	if (cache) {
		cached.set(key, entry);
	}
	try {
		return await promise;
	} catch (error) {
		if (cached.get(key) === entry) {
			cached.delete(key);
		}
		throw error;
	}
}

export async function downloadCatalogTheme(selection, options = {}) {
	assert(
		isRecord(selection) &&
			Object.keys(selection).every((key) => ['id', 'packageId', 'repository'].includes(key)) &&
			typeof selection.id === 'string' &&
			ID.test(selection.id) &&
			typeof selection.packageId === 'string' &&
			HEX.test(selection.packageId),
		'THEME_INVALID',
		400,
	);
	const repository = catalogRepository(selection.repository);
	const catalog = await readThemeCatalog({ ...options, repository });
	const entry = catalog.themes.find((theme) => theme.id === selection.id);
	assert(entry, 'THEME_NOT_FOUND', 404);
	assert(entry.packageId === selection.packageId, 'THEME_CATALOG_CHANGED', 409);
	const sourceUrl = `${rawRoot(repository)}${catalog.revision}/${entry.path}`;
	const { bytes } = await budgetFor(options.fetcher || fetch, repository).download(sourceUrl, { maxBytes: entry.size, resource: false });
	assert(bytes.length === entry.size && (await hashBytes(bytes)) === entry.sha256, 'THEME_HASH_MISMATCH', 400);
	return { bytes, name: '2fa-theme.zip', sourceUrl, expectedPackageId: entry.packageId };
}
