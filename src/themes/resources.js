import { LIMITS, ThemeError, hashBytes, invariant } from './schema.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', woff2: 'font/woff2' };

export function assetUrl(asset) {
	return '/theme-assets/' + asset.hash + '/' + encodeURIComponent(asset.name);
}

export function assetHashFromUrl(value) {
	return /^\/(?:theme-assets|api\/appearance\/assets)\/([a-f0-9]{64})(?:\/[^?#]*)?$/.exec(value)?.[1] ?? null;
}

export function cleanPath(value) {
	invariant(typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= 240, 'THEME_INVALID_PATH');
	invariant(
		!/[\\?#%:]/.test(value) && !Array.from(value).some((char) => char.charCodeAt(0) < 32) && !value.startsWith('/'),
		'THEME_INVALID_PATH',
		{ path: value },
	);
	const parts = value.normalize('NFC').split('/');
	invariant(
		parts.every((part) => part && part !== '.' && part !== '..'),
		'THEME_INVALID_PATH',
		{ path: value },
	);
	return parts.join('/');
}

export function resolvePackagePath(value, basePath) {
	invariant(
		!/[\\?#%:]/.test(value) && !Array.from(value).some((char) => char.charCodeAt(0) < 32) && !value.startsWith('/'),
		'THEME_INVALID_PATH',
		{ path: value },
	);
	const parts = basePath.split('/').slice(0, -1);
	for (const part of value.split('/')) {
		if (part === '..') {
			invariant(parts.length > 0, 'THEME_INVALID_PATH', { path: value });
			parts.pop();
		} else if (part !== '.' && part !== '') {
			parts.push(part);
		}
	}
	return cleanPath(parts.join('/'));
}

export function decodeText(bytes, kind = 'file') {
	try {
		return decoder.decode(bytes);
	} catch {
		throw new ThemeError('THEME_INVALID_ENCODING', { kind });
	}
}

export function assertPublicUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new ThemeError('THEME_INVALID_URL');
	}
	invariant(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 'THEME_INVALID_URL');
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	invariant(host.includes('.') && !host.includes(':') && !/^\[/.test(host), 'THEME_PRIVATE_URL');
	invariant(!/(^|\.)(localhost|local|internal|test|invalid|example|lan|home|onion)$/.test(host), 'THEME_PRIVATE_URL');
	invariant(!host.endsWith('.localdomain') && !host.endsWith('.arpa') && !/^\d+$/.test(host), 'THEME_PRIVATE_URL');
	if (/^[0-9.]+$/.test(host)) {
		const octets = host.split('.').map(Number);
		invariant(octets.length === 4 && octets.every((part) => part >= 0 && part <= 255), 'THEME_PRIVATE_URL');
		const [a, b] = octets;
		invariant(
			!(
				a === 0 ||
				a === 10 ||
				a === 127 ||
				a >= 224 ||
				(a === 169 && b === 254) ||
				(a === 172 && b >= 16 && b <= 31) ||
				(a === 192 && (b === 168 || b === 0)) ||
				(a === 100 && b >= 64 && b <= 127) ||
				(a === 198 && (b === 18 || b === 19))
			),
			'THEME_PRIVATE_URL',
		);
	}
	url.hash = '';
	return url;
}

/** Incremental body guard also applies when a server omits or lies about Content-Length. */
export async function readBodyLimited(response, limit, { deadline = Infinity, onBytes } = {}) {
	const declared = Number(response.headers?.get('content-length'));
	invariant(!Number.isFinite(declared) || declared <= limit, 'THEME_SIZE_LIMIT', { limit });
	if (!response.body) {
		return new Uint8Array();
	}
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			invariant(Date.now() <= deadline, 'THEME_TIMEOUT');
			let timer;
			const remaining = deadline - Date.now();
			const read = reader.read();
			const result = Number.isFinite(remaining)
				? await Promise.race([
						read,
						new Promise((_, reject) => {
							timer = setTimeout(() => reject(new ThemeError('THEME_TIMEOUT')), Math.max(1, remaining));
						}),
					]).finally(() => clearTimeout(timer))
				: await read;
			if (result.done) {
				break;
			}
			total += result.value.length;
			invariant(total <= limit, 'THEME_SIZE_LIMIT', { limit });
			onBytes?.(result.value.length);
			chunks.push(result.value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

export class ImportBudget {
	constructor({ fetcher = fetch } = {}) {
		this.fetcher = fetcher;
		this.deadline = Date.now() + LIMITS.totalMs;
		this.requests = 0;
		this.bytes = 0;
		this.files = new Set();
		this.downloads = new Map();
	}

	countFile(key, bytes) {
		invariant(Date.now() <= this.deadline, 'THEME_TIMEOUT');
		if (!this.files.has(key)) {
			this.files.add(key);
			this.bytes += bytes;
		}
		invariant(this.files.size <= LIMITS.files && this.bytes <= LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
	}

	async download(value, { maxBytes = LIMITS.totalBytes, resource = true } = {}) {
		const initial = assertPublicUrl(value).href;
		if (this.downloads.has(initial)) {
			return this.downloads.get(initial);
		}
		const work = this.downloadUncached(initial, maxBytes, resource);
		this.downloads.set(initial, work);
		return work;
	}

	async downloadUncached(initial, maxBytes, resource) {
		let url = initial;
		for (let redirects = 0; redirects <= LIMITS.redirects; redirects++) {
			invariant(Date.now() < this.deadline, 'THEME_TIMEOUT');
			invariant(++this.requests <= LIMITS.requests, 'THEME_REQUEST_LIMIT');
			const controller = new AbortController();
			const timeout = Math.min(LIMITS.requestMs, this.deadline - Date.now());
			const requestDeadline = Date.now() + timeout;
			let timer;
			const timeoutResult = new Promise((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new ThemeError('THEME_TIMEOUT'));
				}, timeout);
			});
			let response;
			try {
				response = await Promise.race([
					this.fetcher(url, {
						redirect: 'manual',
						signal: controller.signal,
						headers: { Accept: '*/*', 'User-Agent': '2FA-Theme-Importer' },
					}),
					timeoutResult,
				]);
				if ([301, 302, 303, 307, 308].includes(response.status)) {
					invariant(redirects < LIMITS.redirects, 'THEME_REDIRECT_LIMIT');
					const location = response.headers.get('location');
					invariant(location, 'THEME_INVALID_URL');
					url = assertPublicUrl(new URL(location, url).href).href;
					await response.body?.cancel();
					continue;
				}
				invariant(response.ok, 'THEME_DOWNLOAD_FAILED', { status: response.status });
				const bytes = await readBodyLimited(response, Math.min(maxBytes, resource ? LIMITS.totalBytes - this.bytes : maxBytes), {
					deadline: requestDeadline,
				});
				if (resource) {
					this.countFile(url, bytes.length);
				}
				return { bytes, url, mime: response.headers.get('content-type')?.split(';')[0] ?? '' };
			} catch (error) {
				if (error instanceof ThemeError) {
					throw error;
				}
				throw new ThemeError(controller.signal.aborted ? 'THEME_TIMEOUT' : 'THEME_DOWNLOAD_FAILED');
			} finally {
				clearTimeout(timer);
			}
		}
		throw new ThemeError('THEME_REDIRECT_LIMIT');
	}
}

export async function normalizeAsset(input, filename = 'asset') {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	invariant(bytes.length > 0 && bytes.length <= LIMITS.totalBytes, 'THEME_SIZE_LIMIT');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const starts = (signature) => signature.every((byte, index) => bytes[index] === byte);
	const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
	let extension;
	if (
		bytes.length >= 45 &&
		starts([137, 80, 78, 71, 13, 10, 26, 10]) &&
		ascii(12, 16) === 'IHDR' &&
		ascii(bytes.length - 8, bytes.length - 4) === 'IEND'
	) {
		extension = 'png';
	} else if (bytes.length >= 12 && starts([255, 216, 255]) && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
		extension = 'jpg';
	} else if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length) {
		extension = 'webp';
	} else if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) && bytes[bytes.length - 1] === 59) {
		extension = 'gif';
	} else if (bytes.length >= 48 && ascii(0, 4) === 'wOF2' && view.getUint32(8) === bytes.length) {
		extension = 'woff2';
	}
	invariant(extension, 'THEME_ASSET_TYPE');
	const claimed = filename.split('.').pop().toLowerCase();
	if (Object.hasOwn(MIME, claimed)) {
		invariant(MIME[claimed] === MIME[extension], 'THEME_ASSET_TYPE');
	} else if (/\.(?:html?|js|mjs|svg|xml|exe|css|json)$/i.test(filename)) {
		throw new ThemeError('THEME_ASSET_TYPE');
	}
	const hash = await hashBytes(bytes);
	return { hash, name: hash + '.' + extension, mime: MIME[extension], bytes };
}

export async function importAsset(input, options = {}) {
	if (input.url) {
		const result = await new ImportBudget(options).download(input.url);
		return normalizeAsset(result.bytes, new URL(result.url).pathname.split('/').pop() || 'asset');
	}
	return normalizeAsset(input.bytes, input.name);
}
