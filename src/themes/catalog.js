/** The community repository owns every listed ZIP; author URLs are attribution only. */
import { APP_LIMITS } from './appSchema.js';
import { ThemeError, hashBytes, isRecord } from './schema.js';
import { ImportBudget, decodeText } from './resources.js';

export const THEME_CATALOG_REPOSITORY = 'https://github.com/wuzf/2fa-theme-mytheme';
const REPOSITORY = 'wuzf/2fa-theme-mytheme';
const REF_URL = `https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}/`;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
let cached;

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

function budgetFor(fetcher) {
	return new ImportBudget({
		fetcher(url, options) {
			// Redirects are checked too. Neither a catalog entry nor a redirect can
			// make the importer fetch from a contributor's repository or server.
			assert(
				url === REF_URL ||
					(url.startsWith(RAW_ROOT) &&
						/^[a-f0-9]{40}\/(?:catalog\.json|themes\/[A-Za-z0-9_-]{1,64}\/2fa-theme\.zip)$/.test(url.slice(RAW_ROOT.length))),
			);
			return fetcher(url, { ...options, credentials: 'omit', cf: { cacheTtl: 60, cacheEverything: true } });
		},
	});
}

async function fetchCatalog(fetcher) {
	const budget = budgetFor(fetcher);
	const ref = parse((await budget.download(REF_URL, { maxBytes: 64 * 1024, resource: false })).bytes);
	assert(isRecord(ref) && isRecord(ref.object) && ref.object.type === 'commit' && /^[a-f0-9]{40}$/.test(ref.object.sha));
	const revision = ref.object.sha;
	const input = parse((await budget.download(`${RAW_ROOT}${revision}/catalog.json`, { maxBytes: 1024 * 1024, resource: false })).bytes);
	return Object.freeze({ repository: THEME_CATALOG_REPOSITORY, revision, themes: Object.freeze(validateThemeCatalog(input)) });
}

export async function readThemeCatalog({ fetcher = fetch, cache = true } = {}) {
	if (cache && cached?.fetcher === fetcher && cached.expiresAt > Date.now()) {
		return cached.promise;
	}
	const promise = fetchCatalog(fetcher);
	const entry = { fetcher, expiresAt: Date.now() + 60000, promise };
	if (cache) {
		cached = entry;
	}
	try {
		return await promise;
	} catch (error) {
		if (cached === entry) {
			cached = undefined;
		}
		throw error;
	}
}

export async function downloadCatalogTheme(selection, options = {}) {
	assert(
		isRecord(selection) &&
			Object.keys(selection).every((key) => ['id', 'packageId'].includes(key)) &&
			typeof selection.id === 'string' &&
			ID.test(selection.id) &&
			typeof selection.packageId === 'string' &&
			HEX.test(selection.packageId),
		'THEME_INVALID',
		400,
	);
	const catalog = await readThemeCatalog(options);
	const entry = catalog.themes.find((theme) => theme.id === selection.id);
	assert(entry, 'THEME_NOT_FOUND', 404);
	assert(entry.packageId === selection.packageId, 'THEME_CATALOG_CHANGED', 409);
	const sourceUrl = `${RAW_ROOT}${catalog.revision}/${entry.path}`;
	const { bytes } = await budgetFor(options.fetcher || fetch).download(sourceUrl, { maxBytes: entry.size, resource: false });
	assert(bytes.length === entry.size && (await hashBytes(bytes)) === entry.sha256, 'THEME_HASH_MISMATCH', 400);
	return { bytes, name: '2fa-theme.zip', sourceUrl, expectedPackageId: entry.packageId };
}
